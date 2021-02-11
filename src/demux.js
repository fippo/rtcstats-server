const fs = require('fs');
const path = require('path');
const { Writable } = require('stream');
const util = require('util');

const cwd = process.cwd();

// we are using this because we want the regular file descriptors returned,
// not the FileHandle objects from fs.promises.open
const fsOpen = util.promisify(fs.open);

/**
 * Stream designed to handle API requests and write them to a sink (file WritableStream at this point)
 */
class DemuxSink extends Writable {
    /**
     *
     * C'tor
     *
     * @param {string} dumpFolder - Path to where sink files will be temporarily stored.
     * @param {Object} connMeta - Object containing information about the ws connection which stream the data.
     * @param {Object} log - Log object.
     */
    constructor({ dumpFolder, connMeta, log }) {
        super({ objectMode: true });

        this.dumpFolder = dumpFolder;
        this.connMeta = connMeta;
        this.log = log;
        this.timeoutId = -1;
        this.sinkMap = new Map();
    }

    /**
     * Close all the opened sinks and stop the timeout, this should be called once
     * the stream has ended.
     *
     */
    _clearState() {
        this.log.debug('[Demux] Clearing demux state');

        clearTimeout(this.timeoutId);

        for (const sinkData of this.sinkMap.values()) {
            this._sinkClose(sinkData);
        }
    }

    /**
     * Stream level timeout, this will trigger if nothing gets written to stream for a predefined amount of time.
     */
    _timeout() {
        this.log.debug('[Demux] Timeout reached');

        // The stream will eventually call _destroy which will properly handle the cleanup.
        this.end();
    }

    /**
     * Implementation of the stream api, will be called when stream closes regardless if it's because of an error
     * or happy flow. We use this chance to clear the states of the demux.
     *
     * @param {Error} - Error or null if nothing went wrong.
     * @param {Function} - Needs to be called in order to successfully end the state of the stream.
     */
    _destroy(err, cb) {
        this.log.info('[Demux] Destroy called with err:', err);
        this._clearState();

        // Forward the state in which the stream closed, required by the stream api.
        cb(err);
    }

    /**
     * Implementation of the stream API. Receive inbound objects and direct them to the API implemented
     * in _handSinkEvent.
     *
     * @param {Object} obj - Object and not buffer because of object mode.
     * @param {string} encoding - Would be the string encoding, ignore because we're in object mode.
     * @param {Function} cb - Needs to be called as dictated by the stream api.
     */
    _write(obj, encoding, cb) {

        // We received something so reset the timeout.
        clearTimeout(this.timeoutId);
        this.timeoutId = setTimeout(this._timeout.bind(this), 30000);
        this._handleRequest(obj)
            .then(cb)
            .catch(cb);
    }

    /**
     *  Close the target sink.
     *
     * @param {string} id - UniqueId associated with the sink
     * @param {WriteStream} sink - Opened file writable stream associated with the id
     */
    _sinkClose({ id, sink }) {
        this.log.info('[Demux] close-sink %s', id);

        sink.end();
    }

    /**
     * Once the sink has notified us that it finished writing we can notify the clients that they can now, process
     * the generated file.
     *
     * @param {string} id - sink id as saved in the sinkMap
     */
    _handleSinkClose(id) {
        const sinkData = this.sinkMap.get(id);

        // Sanity check, make sure the data is available if not log an error and just send the id such that any
        // listening client has s chance to handle the sink.
        if (sinkData) {
            // we need to emit this on file stream finish
            this.emit('close-sink', { id: sinkData.id,
                meta: { ...sinkData.meta } });

        } else {
            this.log.error('[Demux] sink on close meta should be available id:', id);

            this.emit('close-sink', { id });
        }
        this.sinkMap.delete(id);
    }

    /**
     * Open a writable file stream and associate it with the provided unique id.
     *
     * @param {string} id - unique id.
     * @returns {Object} - Associated metadata object that will be saved in the local map.
     */
    async _sinkCreate(id) {

        let resolvedId = id;
        let i = 0;
        let fd;

        const idealPath = path.resolve(cwd, this.dumpFolder, id);
        let filePath = idealPath;

        // If a client reconnects the same client id will be provided thus cases can occur where the previous dump
        // with the same id is still present on the disk, in order to avoid conflicts and states where multiple
        // handles are taken on the same file, we establish a convention appending an incremental number at the end
        // of the file ${id}_${i}. Thus any client that needs to read the dumps can search for ${id} and get an incremental
        // list.
        // Warning. This will resolve local reconnect conflicts, when uploading the associated metadata to a store
        // logic that handles conflicts at the store level also needs to be added e.g. when uploading to dynamodb
        // if the entry already exists because some other instance uploaded first, the same incremental approach needs
        // to be taken.
        while (!fd) {
            try {
                fd = await fsOpen(filePath, 'wx');
            } catch (err) {
                if (err.code !== 'EEXIST') {
                    throw err;
                }
                resolvedId = `${id}_${++i}`;
                filePath = path.resolve(cwd, this.dumpFolder, resolvedId);
            }
        }

        this.log.info('[Demux] open-sink for id %s, path %s', id, filePath);

        const sink = fs.createWriteStream(idealPath, { fd });

        // Add the associated data to a map in order to properly direct requests to the appropriate sink.
        const sinkData = {
            id: resolvedId,
            sink,
            meta: {
                startDate: Date.now()
            }
        };

        this.sinkMap.set(id, sinkData);

        sink.on('error', error => this.log.error('[Demux] sink on error id: ', id, ' error:', error));

        // The close event should be emitted both on error and happy flow.
        sink.on('close', this._handleSinkClose.bind(this, id));

        // Initialize the dump file by adding the connection metadata at the beginning. This data is usually used
        // by visualizer tools for identifying the originating client (browser, jvb or other).
        sink.write(JSON.stringify(this.connMeta));
        sink.write('\n');

        return sinkData;
    }

    /**
     * Update metadata in the local map and write it to the sink.
     *
     * @param {Object} sinkData - Current sink metadata
     * @param {Object} data - New metadata.
     */
    _sinkUpdateMetadata(sinkData, data) {

        let metadata;

        // Browser clients will send identity data as an array so we need to extract the element that contains
        // the actual metadata
        if (Array.isArray(data)) {
            metadata = data[2];
        } else {
            metadata = data;
        }

        // A first level update of the properties will suffice.
        sinkData.meta = { ...sinkData.meta,
            ...metadata };

        // We expect metadata to be objects thus we need to stringify them before writing to the sink.
        this._sinkWrite(sinkData.sink, JSON.stringify(data));
    }

    /**
     * Self explanatory.
     *
     * @param {WritableStream} sink - Target sink.
     * @param {string} data - Data to write as a string.
     */
    _sinkWrite(sink, data) {
        if (data) {
            sink.write(data);
            sink.write('\n');
        }
    }

    /**
     * Precondition that checks that a requests has the expected fields.
     *
     * @param {string} clientId
     * @param {string} type
     */
    _requestPrecondition({ clientId, type }) {

        if (!clientId) {
            throw new Error('[Demux] clientId missing from request!');
        }

        if (!type) {
            throw new Error('[Demux] type missing from request!');
        }
    }

    /**
     * Handle API requests.
     *
     * @param {Object} request - Request object
     */
    async _handleRequest(request) {
        this._requestPrecondition(request);

        const { clientId, type, data } = request;

        // If this is the first request coming from this client id ,create a new sink (file write stream in this case)
        // and it's associated metadata.
        // In case of reconnects the incremental sink naming convention described in _sinkCreate
        // will take care of it.
        const sinkData = this.sinkMap.get(clientId) || await this._sinkCreate(clientId);

        if (!sinkData) {
            this.log.warn('[Demux] Received data for already closed sink: ', clientId);

            return;
        }

        switch (type) {

        // Close will be sent by a client when operations on a clientId have been completed.
        // Subsequent operations will be taken by services in the upper level, like upload to store and persist
        // metadata do a db.
        case 'close':
            return this._sinkClose(sinkData);

        // Identity requests will update the local metadata and also write it to the sink.
        // Metadata associated with a sink will be propagated through an event to listeners when the sink closes,
        // either on an explicit close or when the timeout mechanism triggers.
        case 'identity':
            return this._sinkUpdateMetadata(sinkData, data);

        // Generic request with stats data, simply write it to the sink.
        case 'stats-entry':
            return this._sinkWrite(sinkData.sink, data);

        default:
            this.log.warning('[Demux] Invalid API Request: ', event);

            return;
        }
    }
}

module.exports = DemuxSink;
