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
const {
    connected,
    connectionError,
    dumpSize,
    errored,
    processed,
    processTime,
    prom,
    queueSize
} = require('./prom-collector');
const saveEntryAssureUnique = require('./store/dynamo').saveEntryAssureUnique;
const WorkerPool = require('./utils/WorkerPool');
const { asyncDeleteFile, getEnvName, getIdealWorkerCount, RequestType, ResponseType } = require('./utils/utils');

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
        logger.error('Error storing: %s - %s', dumpPath, err);
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
    // casses the input parameter will have the same values.
    storeDump(clientId, uniqueClientId);
}

const workerScriptPath = path.join(__dirname, './features/extract.js');
const workerPool = new WorkerPool(workerScriptPath, getIdealWorkerCount());

workerPool.on(ResponseType.PROCESSING, body => {
    logger.debug('Handling PROCESSING event with body %j', body);

    // Amplitude has constraints and limits of what information one sends, so it has a designated backend which
    // only sends specific features.
    if (amplitude) {
        amplitude.track(body);
    }
});

workerPool.on(ResponseType.DONE, body => {
    logger.debug('Handling DONE event with body %j', body);

    processed.inc();

    persistDumpData(body);

});

workerPool.on(ResponseType.METRICS, body => {
    logger.info('[App] Handling METRICS event with body %j', body);
    processTime.observe(body.extractDurationMs);
    dumpSize.observe(body.dumpFileSizeMb);
});

workerPool.on(ResponseType.ERROR, body => {
    logger.error('[App] Handling ERROR event with body %j', body);

    errored.inc();

    // If feature extraction failed at least attempt to store the dump in s3.
    if (body.clientId) {
        persistDumpData(body);
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
                queueSize.set(workerPool.getTaskQueueSize());
                prom.collectDefaultMetrics();
                response.writeHead(200, { 'Content-Type': prom.contentType });
                response.end(prom.register.metrics());
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
 * @param {*} wsServer
 */
function setupWebSocketsServer(wsServer) {
    const wss = new WebSocket.Server({ server: wsServer });

    wss.on('connection', (client, upgradeReq) => {
        connected.inc();

        // the url the client is coming from
        const referer = upgradeReq.headers.origin + upgradeReq.url;

        // TODO: check against known/valid urls
        const ua = upgradeReq.headers['user-agent'];

        // During feature extraction we need information about the browser in order to decide which algorithms use.
        const connMeta = {
            path: upgradeReq.url,
            origin: upgradeReq.headers.origin,
            url: referer,
            userAgent: ua,
            time: Date.now(),
            clientProtocol: client.protocol
        };

        const demuxSinkOptions = {
            connMeta,
            dumpFolder: './temp',
            log: logger
        };

        const demuxSink = new DemuxSink(demuxSinkOptions);

        demuxSink.on('close-sink', ({ id, meta }) => {
            logger.info('[App] Queue for processing id %s', id);

            // Metadata associated with a dump can get large so just select the necessary fields.
            const sinkMetadata = {
                clientId: id,
                startDate: meta.startDate,
                endDate: Date.now(),
                userId: meta.displayName,
                conferenceId: meta.confName,
                conferenceUrl: meta.confID,
                app: meta.applicationName,
                sessionId: String(meta.meetingUniqueId)
            };

            if (config.features.disableFeatExtraction) {
                persistDumpData(sinkMetadata);
            } else {
            // Add the clientId in the worker pool so it can process the associated dump file.
                workerPool.addTask({ type: RequestType.PROCESS,
                    body: sinkMetadata });
            }

        });

        const connectionPipeline = pipeline(
            WebSocket.createWebSocketStream(client),
            JSONStream.parse(),
            demuxSink,
            err => err && logger.error('[App] Pipeline error: ', err)
        );

        connectionPipeline.on('finish', () => {
            logger.info('[App] Pipeline successfully finished');

            // We need to explicity close the ws, you might notice that we don't do the same in case of an error
            // that's because in that case the error will propagate up the pipeline chain and the ws stream will also
            // close the ws.
            client.close();
        });

        logger.info(
            '[App] New app connected: ua: <%s>, protocolV: <%s>, referer: <%s>',
            ua,
            client.protocol,
            referer,
        );

        client.on('error', e => {
            logger.error('[App] Websocket error: %s', e);
            connectionError.inc();
        });

        client.on('close', () => {
            connected.dec();
        });
    });
}

/**
 *
 */
function run() {
    logger.info('[App] Initializing <%s>, version <%s>, env <%s> ...', appName, appVersion, getEnvName());
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
    processed,
    workerPool
};
