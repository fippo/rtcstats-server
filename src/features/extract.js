/* eslint-disable no-unused-vars */
/* eslint-disable no-loop-func */
const config = require('config');
const fs = require('fs');
const readline = require('readline');
const { parentPort, workerData, isMainThread } = require('worker_threads');

const logger = require('../logging');
const statsDecompressor = require('../utils//getstats-deltacompression').decompress;
const statsMangler = require('../utils/getstats-mangle');
const { StatsFormat,
    getStatsFormat } = require('../utils/stats-detection');
const {
    extractTracks,
    extractStreams,
    isProduction,
    ResponseType,
    RequestType
} = require('../utils/utils');

const clientFeaturesFns = require('./features-client');
const connectionFeaturesFns = require('./features-connection');
const streamFeaturesFns = require('./features-stream');


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
 * White list the feature functions array based on a config parameter.
 *
 * @param {Array} whiteList - White list config array, functions listed here will be included.
 * @param {Array} featureFns - Complete list of functions to be filtered.
 * @return {Array} - Feature function list to run over data.
 */
function whiteListFeatureFns(whiteList, featureFns) {

    // If white list is empty no features will be returned.
    if (!whiteList.length) {
        return [];
    }

    // Wild card representing all functions.
    if (whiteList.includes('*')) {
        return featureFns;
    }

    return featureFns.filter(feature => whiteList.includes(feature));
}

/**
 * Extract features as described in the featured-client.js file. These mostly describe GUM flows.
 *
 * @param {Object} client - JSON view of the complete rtcstats client dump.
 * @return {Object} - Key value object containing an entry for each white listed feature function.
 */
function extractClientFeatures(client) {

    const clientFeatures = {};
    const { features: { clientFeat: clientFeatWhiteList = [] } } = config;

    const filterClientFeatFns = whiteListFeatureFns(clientFeatWhiteList, Object.keys(clientFeaturesFns));

    filterClientFeatFns.forEach(fname => {
        let feature = clientFeaturesFns[fname].apply(null, [ client ]);

        if (feature !== undefined) {
            if (typeof feature === 'object') {
                Object.keys(feature).forEach(subname => {
                    feature[subname] = safeFeature(feature[subname]);
                    logger.debug('PAGE', 'FEATURE', fname + capitalize(subname), '=>', safeFeature(feature[subname]));

                    clientFeatures[fname + capitalize(subname)] = feature[subname];
                });
            } else {
                feature = safeFeature(feature);
                logger.debug('PAGE', 'FEATURE', fname, '=>', feature);

                clientFeatures[fname] = feature;
            }
        }
    });

    return clientFeatures;
}


/**
 * Extract features as described in the featured-connection.js file.
 *
 * @param {Object} client
 * @param {String} connId
 */
function extractConnectionFeatures(client, connId) {
    // ignore the null connid and empty strings
    if (connId === 'null' || connId === '') {
        return;
    }
    const conn = client.peerConnections[connId];
    const connectionFeatures = {};
    const { features: { connectionFeat: connectionFeatWhiteList = [] } } = config;

    const filterConnFeatFns = whiteListFeatureFns(connectionFeatWhiteList, Object.keys(connectionFeaturesFns));

    filterConnFeatFns.forEach(fname => {
        let feature = connectionFeaturesFns[fname].apply(null, [ client, conn ]);

        if (feature !== undefined) {
            if (typeof feature === 'object') {
                Object.keys(feature).forEach(subname => {
                    feature[subname] = safeFeature(feature[subname]);
                    logger.debug(connId, 'FEATURE', fname + capitalize(subname), '=>', safeFeature(feature[subname]));

                    connectionFeatures[fname + capitalize(subname)] = feature[subname];
                });
            } else {
                feature = safeFeature(feature);
                logger.debug(connId, 'FEATURE', fname, '=>', safeFeature(feature));

                connectionFeatures[fname] = feature;
            }
        }
    });

    return connectionFeatures;
}

/**
 * @deprecated This is not currently in use and was not actively maintained throughout refactors.
 * Might require some extra work before it can be used.
 *
 * Extract features as described in the featured-streams.js file.
 *
 * @param {Object} client
 * @param {String} connId
 */
function extractTrackFeatures(client, connId) {
    const conn = client.peerConnections[connId];
    const extractedTracks = extractTracks(conn);
    const streams = extractStreams(extractedTracks);

    const streamList = [];

    for (const [ streamId, tracks ] of streams.entries()) {
        const streamFeatures = { streamId };

        for (const { trackId, kind, direction, stats } of tracks) {
            Object.keys(streamFeaturesFns).forEach(fname => {
                let feature = streamFeaturesFns[fname].apply(null, [ { kind,
                    direction,
                    trackId,
                    stats,
                    peerConnectionLog: conn } ]);

                if (feature !== undefined) {
                    feature = safeFeature(feature);
                    if (typeof feature === 'object') {
                        Object.keys(feature).forEach(subname => {
                            feature[subname] = safeFeature(feature[subname]);
                            streamFeatures[fname + capitalize(subname)] = feature[subname];
                            logger.debug(
                                connId,
                                'STREAM',
                                streamId,
                                'TRACK',
                                trackId,
                                'FEATURE',
                                fname + capitalize(subname),
                                '=>',
                                safeFeature(feature[subname])
                            );
                        });
                    } else {
                        feature = safeFeature(feature);
                        streamFeatures[fname] = feature;
                        logger.debug(connId,
                         'STREAM', streamId, 'TRACK', trackId, 'FEATURE', fname, '=>', safeFeature(feature));
                    }
                }
            });
        }

        streamList.push(streamFeatures);
    }

    return streamList;
}

/**
 * Run feature extraction process for client, connection and track data.
 *
 * @param {String} url - Meeting url
 * @param {Object} client - rtcstats dump parsed into an Object
 * @param {String} clientId - Unique ID generated by rtcstats
 */
function extractFeatures(url, client, clientId) {
    // ignore connections that never send getUserMedia or peerconnection events.
    if (client.getUserMedia.length === 0 && Object.keys(client.peerConnections).length === 0) {
        return;
    }

    const { identity = {} } = client;
    const clientFeatures = extractClientFeatures(client);

    if (Object.keys(client.peerConnections).length === 0) {
        // We only have GUM and potentially GUM errors.
        if (!isMainThread) {
            parentPort.postMessage({
                type: ResponseType.PROCESSING,
                body: { url,
                    clientId,
                    connid: '',
                    identity,
                    clientFeatures }
            });
        }
    }

    Object.keys(client.peerConnections).forEach(connId => {
        const connectionFeatures = extractConnectionFeatures(client, connId);

        if (!connectionFeatures) {
            return;
        }

        // @deprecated - as it stands the track features weren't of interest so they are disabled for the time being in
        // order to avoid any unnecessary processing.
        // connectionFeatures.streams = extractTrackFeatures(client, connId);

        if (!isMainThread) {
            parentPort.postMessage({
                type: ResponseType.PROCESSING,
                body: { url,
                    clientId,
                    connId,
                    clientFeatures,
                    identity,
                    connectionFeatures }
            });
        }

        delete client.peerConnections[connId]; // save memory
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

    const readInterface = readline.createInterface({
        input: fs.createReadStream(path),
        console: false
    });

    let first = true;
    let client = {};
    const baseStats = {};

    client.peerConnections = {};
    client.getUserMedia = [];

    readInterface.on('line', line => {

        if (first) {
            const meta = JSON.parse(line);

            meta.statsFormat = getStatsFormat(meta);
            logger.debug('Stats Format: ', meta.statsFormat);

            client = { ...client,
                ...meta };

            first = false;
        } else {
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
                    data[2] = statsDecompressor(baseStats[data[1]], data[2], client);
                    baseStats[data[1]] = JSON.parse(JSON.stringify(data[2]));
                }

                if ((data[0] === 'getStats' || data[0] === 'getstats')
                    && client.statsFormat === StatsFormat.CHROME_LEGACY) {
                    data[2] = statsMangler(data[2]);
                    const mangleEndTime = new Date().getTime();

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

    readInterface.on('close', () => {

        dump(client.url, client);
        extractFeatures(client.url, client, clientId);
        const extractDurationMs = new Date().getTime() - extractStartTime;

        if (!isMainThread) {
            parentPort.postMessage({
                type: ResponseType.METRICS,
                body: { clientId,
                    extractDurationMs,
                    dumpFileSizeMb }
            });
        }
    });
}
