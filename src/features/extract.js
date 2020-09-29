const fs = require('fs');
const { parentPort, workerData, isMainThread } = require('worker_threads');

const logger = require('../logging');
const statsDecompressor = require('../utils//getstats-deltacompression').decompress;
const statsMangler = require('../utils/getstats-mangle');
const {
    // extractTracks,
    // extractStreams,
    isProduction,
    ResponseType,
    RequestType
} = require('../utils/utils');

const clientfeatures = require('./features-client');
const connectionfeatures = require('./features-connection');

// const streamfeatures = require('./features-stream');


/**
 *
 * @param {*} str
 */
function capitalize(str) {
    return str[0].toUpperCase() + str.substr(1);
}

/**
 *
 * @param {*} feature
 */
function safeFeature(feature) {
    let safeValue = feature;

    if (typeof feature === 'number' && isNaN(feature)) {
        safeValue = -1;
    }
    if (typeof feature === 'number' && !isFinite(feature)) {
        safeValue = -2;
    }

    return safeValue;
}

// check that the sorter was called as a worker thread
if (isMainThread) {
    const clientid = process.argv[2];

    if (!clientid) {
        logger.error('[Extract] Please provide a valid clientId!');

        return -1;
    }

    logger.info(`[Extract] Running feature extraction on ${clientid}...`);
    processDump(clientid);
} else {
    logger.info('[Extract] Running feature extract worker thread: %j', workerData);

    // throw new Error("Heavy");
    // Handle parent requests
    parentPort.on('message', request => {
        switch (request.type) {
        case RequestType.PROCESS: {
            logger.info('[Extract] Worker is processing request: %j', request);
            try {
                // Update the worker state with the current operation metadata, in case the worker crashes
                // from something that is out of our control. Thus the client app can have some context
                // about what operation failed.
                parentPort.postMessage({
                    type: ResponseType.STATE_UPDATE,
                    body: { clientId: request.body.clientId }
                });
                processDump(request.body.clientId);
            } catch (error) {
                parentPort.postMessage({
                    type: ResponseType.ERROR,
                    body: { clientId: request.body.clientId,
                        error: error.stack }
                });
            }
            break;
        }
        default: {
            logger.warn('[Extract] Unsupported request: %j', request);
        }
        }
    });
}

/**
 * dumps all peerconnections.
 * @param {*} url
 * @param {*} client
 */
function dump(url, client) {
    // ignore connections that never send getUserMedia or peerconnection events.
    if (client.getUserMedia.length === 0 && Object.keys(client.peerConnections).length === 0) {
        return;
    }
    if (!isProduction()) {
        let total = 0;

        Object.keys(client.peerConnections).forEach(id => {
            total += client.peerConnections[id].length;
        });
        logger.info(
            '[Extract] DUMP',
            client.getUserMedia.length,
            Object.keys(client.peerConnections).length,
            total
        );

        return;
    }
}

/**
 * Feature generation
 *
 **/
function generateFeatures(url, client, clientId) {
    // ignore connections that never send getUserMedia or peerconnection events.
    if (client.getUserMedia.length === 0 && Object.keys(client.peerConnections).length === 0) {
        return;
    }

    const identity = client.identity;

    // logger.info(JSON.stringify(client.identity));
    // clientFeatures are the same for all peerconnections but are saved together
    // with each peerconnection anyway to make correlation easier.
    const clientFeatures = {};

    Object.keys(clientfeatures).forEach(fname => {
        let feature = clientfeatures[fname].apply(null, [ client ]);

        if (feature !== undefined) {
            if (typeof feature === 'object') {
                Object.keys(feature).forEach(subname => {
                    feature[subname] = safeFeature(feature[subname]);
                    logger.debug(
                        'PAGE',
                        'FEATURE',
                        fname + capitalize(subname),
                        '=>',
                        safeFeature(feature[subname])
                    );

                    clientFeatures[fname + capitalize(subname)] = feature[subname];
                });
            } else {
                feature = safeFeature(feature);
                logger.debug('PAGE', 'FEATURE', fname, '=>', feature);

                clientFeatures[fname] = feature;
            }
        }
    });

    if (Object.keys(client.peerConnections).length === 0) {
        // We only have GUM and potentially GUM errors.
        parentPort.postMessage({
            type: ResponseType.PROCESSING,
            body: { url,
                clientId,
                connid: '',
                identity,
                clientFeatures }
        });
    }

    logger.debug('Client features: %j', clientFeatures);

    const streamList = [];

    Object.keys(client.peerConnections).forEach(connid => {
        if (connid === 'null' || connid === '') {
            return;
        } // ignore the null connid and empty strings
        const conn = client.peerConnections[connid];
        const connectionFeatures = {};

        Object.keys(connectionfeatures).forEach(fname => {
            let feature = connectionfeatures[fname].apply(null, [ client, conn ]);

            if (feature !== undefined) {
                if (typeof feature === 'object') {
                    Object.keys(feature).forEach(subname => {
                        feature[subname] = safeFeature(feature[subname]);
                        logger.debug(
                            connid,
                            'FEATURE',
                            fname + capitalize(subname),
                            '=>',
                            safeFeature(feature[subname])
                        );

                        connectionFeatures[fname + capitalize(subname)] = feature[subname];
                    });
                } else {
                    feature = safeFeature(feature);
                    logger.debug(connid, 'FEATURE', fname, '=>', safeFeature(feature));

                    connectionFeatures[fname] = feature;
                }
            }
        });

        // const tracks = extractTracks(conn);
        // const streams = extractStreams(tracks);

        // for (const [streamId, tracks] of streams.entries()) {
        //     const streamFeatures = { streamId };
        //     for (const { trackId, kind, direction, stats } of tracks) {
        //         Object.keys(streamfeatures).forEach((fname) => {
        //             let feature = streamfeatures[fname].apply(null, [{ kind,
        //                                         direction, trackId, stats, peerConnectionLog: conn }]);
        //             if (feature !== undefined) {
        //                 feature = safeFeature(feature);
        //                 if (typeof feature === 'object') {
        //                     Object.keys(feature).forEach((subname) => {
        //                         feature[subname] = safeFeature(feature[subname]);
        //                         streamFeatures[fname + capitalize(subname)] = feature[subname];
        //                         logger.debug(
        //                             connid,
        //                             'STREAM',
        //                             streamId,
        //                             'TRACK',
        //                             trackId,
        //                             'FEATURE',
        //                             fname + capitalize(subname),
        //                             '=>',
        //                             safeFeature(feature[subname])
        //                         );
        //                     });
        //                 } else {
        //                     feature = safeFeature(feature);
        //                     streamFeatures[fname] = feature;
        //                     logger.debug(connid,
        //                      'STREAM', streamId, 'TRACK', trackId, 'FEATURE', fname, '=>', safeFeature(feature));
        //                 }
        //             }
        //         });
        //     }

        //     streamList.push(streamFeatures);
        // }

        connectionFeatures.streams = streamList;

        if (!isMainThread) {
            parentPort.postMessage({
                type: ResponseType.PROCESSING,
                body: { url,
                    clientId,
                    connid,
                    clientFeatures,
                    identity,
                    connectionFeatures }
            });
        }

        delete client.peerConnections[connid]; // save memory
    });

    if (!isMainThread) {
        parentPort.postMessage({ type: ResponseType.DONE,
            body: { clientId } });
    }
}

/**
 *
 * @param {*} clientId
 */
function processDump(clientId) {
    let path = clientId;

    if (!isMainThread) {
        path = `temp/${clientId}`;
    }

    const extractStartTime = new Date().getTime();
    const dumpFileStats = fs.statSync(path);
    const dumpFileSizeMb = dumpFileStats.size / 1000000.0;

    fs.readFile(path, { encoding: 'utf-8' }, (err, dumpData) => {
        try {
            if (err) {
                throw err;
            }

            const baseStats = {};
            const lines = dumpData.split('\n');
            const client = JSON.parse(lines.shift());

            client.peerConnections = {};
            client.getUserMedia = [];
            lines.forEach(line => {
                if (line.length) {
                    const data = JSON.parse(line);
                    const time = new Date(data.time || data[3]);

                    delete data.time;
                    switch (data[0]) {
                    case 'publicIP':
                        client.publicIP = data[2];
                        break;
                    case 'userfeedback': // TODO: might be renamed
                        client.feedback = data[2];
                        break;
                    case 'tags': // experiment variation tags
                        client.tags = data[2];
                        break;
                    case 'wsconnect':
                        // eslint-disable-next-line no-bitwise
                        client.websocketConnectionTime = data[2] >>> 0;
                        break;
                    case 'wsconnecterror':
                        client.websocketError = data[2];
                        break;
                    case 'identity': // identity meta-information when its not possible to feed into RTCPeerConnection.
                        client.identity = data[2];
                        break;
                    case 'getUserMedia':
                    case 'getUserMediaOnSuccess':
                    case 'getUserMediaOnFailure':
                    case 'navigator.mediaDevices.getUserMedia':
                    case 'navigator.mediaDevices.getUserMediaOnSuccess':
                    case 'navigator.mediaDevices.getUserMediaOnFailure':
                    case 'navigator.getDisplayMedia':
                    case 'navigator.getDisplayMediaOnSucces':
                    case 'navigator.mediaDevices.getDisplayMedia':
                    case 'navigator.mediaDevices.getDisplayMediaOnSuccess':
                        client.getUserMedia.push({
                            time,
                            timestamp: time.getTime(),
                            type: data[0],
                            value: data[2]
                        });
                        break;
                    default:
                        if (!client.peerConnections[data[1]]) {
                            client.peerConnections[data[1]] = [];
                            baseStats[data[1]] = {};
                        }
                        if (data[0] === 'getstats') {
                            // delta-compressed
                            data[2] = statsDecompressor(baseStats[data[1]], data[2]);
                            baseStats[data[1]] = JSON.parse(JSON.stringify(data[2]));
                        }
                        if (data[0] === 'getStats' || data[0] === 'getstats') {
                            data[2] = statsMangler(data[2]);
                            data[0] = 'getStats';
                        }
                        client.peerConnections[data[1]].push({
                            time,
                            timestamp: time.getTime(),
                            type: data[0],
                            value: data[2]
                        });
                        break;
                    }
                }
            });

            dump(client.url, client);
            generateFeatures(client.url, client, clientId);
            const extractDurationMs = new Date().getTime() - extractStartTime;

            if (!isMainThread) {
                parentPort.postMessage({
                    type: ResponseType.METRICS,
                    body: { clientId,
                        extractDurationMs,
                        dumpFileSizeMb }
                });
            }
        } catch (error) {
            if (isMainThread) {
                logger.error('%s', error);
            } else {
                parentPort.postMessage({
                    type: ResponseType.ERROR,
                    body: { clientId,
                        error: error.stack }
                });
            }
        }
    });
}
