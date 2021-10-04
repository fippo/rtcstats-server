const JSONStream = require('JSONStream');
const config = require('config');
const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const { pipeline } = require('stream');
const WebSocket = require('ws');

const { name: appName, version: appVersion } = require('../package');

const AmplitudeConnector = require('./database/AmplitudeConnector');
const DemuxSink = require('./demux');
const logger = require('./logging');
const PromCollector = require('./metrics/PromCollector');
const saveEntryAssureUnique = require('./store/dynamo').saveEntryAssureUnique;
const { asyncDeleteFile, getEnvName, getIdealWorkerCount, RequestType, ResponseType } = require('./utils/utils');
const WorkerPool = require('./worker-pool/WorkerPool');

// Configure store, fall back to S3
let store;

if (!store) {
    store = require('./store/s3.js')(config.s3);
}

// Configure Amplitude backend
let amplitude;

if (config.amplitude && config.amplitude.key) {
    amplitude = new AmplitudeConnector(config.amplitude.key);
} else {
    logger.warn('Amplitude is not configured!');
}

const tempPath = config.server.tempPath;

/**
 * Store the dump to the configured store. The dump file might be stored under a different
 * name, this is to account for the reconnect mechanism currently in place.
 *
 * @param {string} clientId - name that the dump file will actually have on disk.
 * @param {string} uniqueClientId - name that the dump will have on the store.
 */
async function storeDump(clientId, uniqueClientId) {
    const dumpPath = `${tempPath}/${clientId}`;

    try {
        await store.put(uniqueClientId, dumpPath);
    } catch (err) {
        PromCollector.storageErrorCount.inc();

        logger.error('Error storing: %s uniqueId: %s - %s', dumpPath, uniqueClientId, err);
    } finally {
        await asyncDeleteFile(dumpPath);
    }
}

/**
 * Persist the dump file to the configured store and save the  associated metadata. At the time of writing the
 * only supported store for metadata is dynamo.
 *
 * @param {Object} sinkMeta - metadata associated with the dump file.
 */
async function persistDumpData(sinkMeta) {

    // Metadata associated with a dump can get large so just select the necessary fields.
    const { clientId } = sinkMeta;
    let uniqueClientId = clientId;

    if (saveEntryAssureUnique) {
        // Because of the current reconnect mechanism some files might have the same clientId, in which case the
        // underlying call will add an associated uniqueId to the clientId and return it.
        uniqueClientId = await saveEntryAssureUnique(sinkMeta);
    }

    // Store the dump file associated with the clientId using uniqueClientId as the key value. In the majority of
    // cases the input parameter will have the same values.
    storeDump(clientId, uniqueClientId);
}

const workerScriptPath = path.join(__dirname, './worker-pool/ExtractWorker.js');
const workerPool = new WorkerPool(workerScriptPath, getIdealWorkerCount());

workerPool.on(ResponseType.DONE, body => {
    logger.info('[App] Handling DONE event with body %o', body);

    const { dumpInfo = {}, features = {} } = body;
    const { metrics: { dsRequestBytes = 0,
        dumpFileSizeBytes = 0,
        otherRequestBytes = 0,
        statsRequestBytes = 0,
        sdpRequestBytes = 0,
        sessionDurationMs = 0,
        totalProcessedBytes = 0,
        totalProcessedCount = 0 } } = features;

    PromCollector.processed.inc();
    PromCollector.dsRequestSizeBytes.observe(dsRequestBytes);
    PromCollector.otherRequestSizeBytes.observe(otherRequestBytes);
    PromCollector.statsRequestSizeBytes.observe(statsRequestBytes);
    PromCollector.sdpRequestSizeBytes.observe(sdpRequestBytes);
    PromCollector.sessionDurationMs.observe(sessionDurationMs);
    PromCollector.totalProcessedBytes.observe(totalProcessedBytes);
    PromCollector.totalProcessedCount.observe(totalProcessedCount);
    PromCollector.dumpSize.observe(dumpFileSizeBytes);

    // Amplitude has constraints and limits of what information one sends, so it has a designated backend which
    // only sends specific features.
    if (amplitude) {
        amplitude.track(dumpInfo, features);
    }

    persistDumpData(dumpInfo);

});

workerPool.on(ResponseType.METRICS, body => {
    logger.info('[App] Handling METRICS event with body %o', body);
    PromCollector.processTime.observe(body.extractDurationMs);
    PromCollector.dumpSize.observe(body.dumpFileSizeMb);
});

workerPool.on(ResponseType.ERROR, body => {
    logger.error('[App] Handling ERROR event with body %o', body);
    PromCollector.processErrorCount.inc();

    const { dumpInfo = {} } = body;

    // If feature extraction failed at least attempt to store the dump in s3.
    if (dumpInfo.clientId) {
        persistDumpData(dumpInfo);
    } else {
        logger.error('[App] Handling ERROR without a clientId field!');
    }
});

/**
 *
 */
function setupWorkDirectory() {
    try {
        if (fs.existsSync(tempPath)) {
            fs.readdirSync(tempPath).forEach(fname => {
                try {
                    logger.debug(`[App] Removing file ${`${tempPath}/${fname}`}`);
                    fs.unlinkSync(`${tempPath}/${fname}`);
                } catch (e) {
                    logger.error(`[App] Error while unlinking file ${fname} - ${e}`);
                }
            });
        } else {
            logger.debug(`[App] Creating working dir ${tempPath}`);
            fs.mkdirSync(tempPath);
        }
    } catch (e) {
        logger.error(`[App] Error while accessing working dir ${tempPath} - ${e}`);

        // The app is probably in an inconsistent state at this point, throw and stop process.
        throw e;
    }
}

/**
 *
 * @param {*} request
 * @param {*} response
 */
function serverHandler(request, response) {
    switch (request.url) {
    case '/healthcheck':
        response.writeHead(200);
        response.end();
        break;
    case '/bindcheck':
        logger.info('Accessing bind check!');
        response.writeHead(200);
        response.end();
        break;
    default:
        response.writeHead(404);
        response.end();
    }
}

/**
 * In case one wants to run the server locally, https is required, as browsers normally won't allow non
 * secure web sockets on a https domain, so something like the bello
 * server instead of http.
 *
 * @param {number} port
 */
function setupHttpsServer(port) {
    const options = {
        key: fs.readFileSync(config.get('server').keyPath),
        cert: fs.readFileSync(config.get('server').certPath)
    };

    return https.createServer(options, serverHandler).listen(port);
}

/**
 *
 * @param {*} port
 */
function setupHttpServer(port) {
    return http.createServer(serverHandler).listen(port);
}

/**
 *
 * @param {*} port
 */
function setupMetricsServer(port) {
    const metricsServer = http
        .createServer((request, response) => {
            switch (request.url) {
            case '/metrics':
                PromCollector.queueSize.set(workerPool.getTaskQueueSize());
                PromCollector.collectDefaultMetrics();
                response.writeHead(200, { 'Content-Type': PromCollector.getPromContentType() });
                response.end(PromCollector.metrics());
                break;
            default:
                response.writeHead(404);
                response.end();
            }
        })
        .listen(port);

    return metricsServer;
}

/**
 *
 * @param {*} client
 * @param {*} upgradeReq
 */
function wsConnectionHandler(client, upgradeReq) {
    PromCollector.connected.inc();

    // the url the client is coming from
    const referer = upgradeReq.headers.origin + upgradeReq.url;

    // TODO: check against known/valid urls
    const ua = upgradeReq.headers['user-agent'];

    // During feature extraction we need information about the browser in order to decide which algorithms use.
    const connectionInfo = {
        path: upgradeReq.url,
        origin: upgradeReq.headers.origin,
        url: referer,
        userAgent: ua,
        clientProtocol: client.protocol
    };

    const demuxSinkOptions = {
        connectionInfo,
        dumpFolder: './temp',
        log: logger
    };

    const demuxSink = new DemuxSink(demuxSinkOptions);

    demuxSink.on('close-sink', ({ id, meta }) => {
        logger.info('[App] Queue for processing id %s', id);

        // Metadata associated with a dump can get large so just select the necessary fields.
        const dumpData = {
            app: meta.applicationName || 'Undefined',
            clientId: id,
            conferenceId: meta.confName,
            conferenceUrl: meta.confID,
            dumpPath: meta.dumpPath,
            endDate: Date.now(),
            endpointId: meta.endpointId,
            startDate: meta.startDate,
            sessionId: String(meta.meetingUniqueId),
            userId: meta.displayName,
            ampSessionId: meta.sessionId,
            ampUserId: meta.userId,
            ampDeviceId: meta.deviceId
        };

        // Don't process dumps generated by JVB, there should be a more formal process to
        if (config.features.disableFeatExtraction || connectionInfo.clientProtocol?.includes('JVB')) {
            persistDumpData(dumpData);
        } else {
        // Add the clientId in the worker pool so it can process the associated dump file.
            workerPool.addTask({ type: RequestType.PROCESS,
                body: dumpData });
        }
    });

    const connectionPipeline = pipeline(
        WebSocket.createWebSocketStream(client),
        JSONStream.parse(),
        demuxSink,
        err => {
            if (err) {
                // A pipeline can multiplex multiple sessions however if one fails
                // the whole pipeline does as well,
                PromCollector.sessionErrorCount.inc();

                logger.error('[App] Connection pipeline: %o;  error: %o', connectionInfo, err);
            }
        });

    connectionPipeline.on('finish', () => {
        logger.info('[App] Connection pipeline successfully finished %o', connectionInfo);

        // We need to explicity close the ws, you might notice that we don't do the same in case of an error
        // that's because in that case the error will propagate up the pipeline chain and the ws stream will also
        // close the ws.
        client.close();
    });

    logger.info(
        '[App] New app connected: ua: %s, protocol: %s, referer: %s',
        ua,
        client.protocol,
        referer,
    );

    client.on('error', e => {
        logger.error('[App] Websocket error: %s', e);
        PromCollector.connectionError.inc();
    });

    client.on('close', () => {
        PromCollector.connected.dec();
    });
}

/**
 *
 * @param {*} wsServer
 */
function setupWebSocketsServer(wsServer) {
    const wss = new WebSocket.Server({ server: wsServer });

    wss.on('connection', wsConnectionHandler);
}

/**
 *
 */
function run() {
    logger.info('[App] Initializing: %s; version: %s; env: %s ...', appName, appVersion, getEnvName());
    let server;

    setupWorkDirectory();

    if (config.get('server').useHTTPS) {
        server = setupHttpsServer(config.get('server').port);
    } else {
        server = setupHttpServer(config.get('server').port);
    }

    if (config.get('server').metrics) {
        setupMetricsServer(config.get('server').metrics);
    }

    setupWebSocketsServer(server);

    logger.info('[App] Initialization complete.');
}

/**
 * Currently used from test script.
 */
function stop() {
    process.exit();
}

// For now just log unhandled promise rejections, as the initial code did not take them into account and by default
// node just silently eats them.
process.on('unhandledRejection', reason => {
    logger.error('[App] Unhandled rejection: %s', reason);
});

run();

module.exports = {
    stop,

    // We expose the number of processed items for use in the test script
    PromCollector,
    workerPool
};
