const config = require('config');
const fs = require('fs');
const http = require('http');
const https = require('https');
const os = require('os');
const path = require('path');
const uuid = require('uuid');
const WebSocketServer = require('ws').Server;

const { name: appName, version: appVersion } = require('../package');

const AmplitudeConnector = require('./database/AmplitudeConnector');
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
const WorkerPool = require('./utils/WorkerPool');
const obfuscate = require('./utils/obfuscator');
const { getEnvName, RequestType, ResponseType } = require('./utils/utils');

// Configure database, fall back to redshift-firehose.
let database;

if (config.gcp && config.gcp.dataset && config.gcp.table) {
    database = require('./database/bigquery.js')(config.gcp);
}

if (!database) {
    database = require('./database/redshift-firehose.js')(config.firehose);
}

if (!database) {
    logger.warn('No database configured!');
}

// Configure store, fall back to S3
let store;

if (config.gcp && config.gcp.bucket) {
    store = require('./store/gcp.js')(config.gcp);
}

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

let server;
const tempPath = 'temp';

/**
 *
 * @param {*} clientId
 */
function storeDump(clientId) {
    const dumpPath = `${tempPath}/${clientId}`;

    store
        .put(clientId, dumpPath)
        .then(() => {
            fs.unlink(dumpPath, () => {
                // do nothing.
            });
        })
        .catch(err => {
            logger.error('Error storing: %s - %s', path, err);
            fs.unlink(dumpPath, () => {
                // do nothing.
            });
        });
}

/**
 *
 */
function getIdealWorkerCount() {
    // Using all the CPUs available might slow down the main node.js thread which is responsible for handling
    // requests.
    if (os.cpus().length <= 2) {
        return 1;
    }

    return os.cpus().length - 2;
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

    // Current supported databases are big data type so we can send bulk data without having to worry about
    // volume.
    if (database) {
        const { url, clientId, connid, clientFeatures, connectionFeatures } = body;

        if (connectionFeatures) {
            // When using a database backend the streams features are stored separately, so we don't need them
            // in the connectionFeatures object.
            const streams = connectionFeatures.streams;

            delete connectionFeatures.streams;

            for (const streamFeatures of streams) {
                database.put(url, clientId, connid, clientFeatures, connectionFeatures, streamFeatures);
            }
        } else {
            database.put(url, clientId, connid, clientFeatures);
        }
    }
});

workerPool.on(ResponseType.DONE, body => {
    logger.debug('Handling DONE event with body %j', body);

    processed.inc();

    storeDump(body.clientId);
});

workerPool.on(ResponseType.METRICS, body => {
    logger.info('[App] Handling METRICS event with body %j', body);
    processTime.observe(body.extractDurationMs);
    dumpSize.observe(body.dumpFileSizeMb);
});

workerPool.on(ResponseType.ERROR, body => {
    // TODO handle requeue of the request, this also requires logic in extract.js
    // i.e. we need to catch all potential errors and send back a request with
    // the client id.
    logger.error('[App] Handling ERROR event with body %j', body);

    errored.inc();

    // If feature extraction failed at least attempt to store the dump in s3.
    if (body.clientId) {
        storeDump(body.clientId);
    } else {
        logger.error('[App] Handling ERROR without a clientId field!');
    }

    // TODO At this point adding a retry mechanism can become detrimental, e.g.
    // If there is a error with the dump file structure the error would just requeue ad infinitum,
    // a smarter mechanism is required here, with some sort of maximum retry per request and so on.
    // if (body.clientId) {
    //     logger.info('Requeued clientId %s', body.clientId);
    //     workerPool.addTask({ type: RequestType.PROCESS, body: { clientId: body.clientId } });
    // }
});

/**
 *
 */
function setupWorkDirectory() {
    try {
        if (fs.existsSync(tempPath)) {
            fs.readdirSync(tempPath).forEach(fname => {
                try {
                    logger.debug(`Removing file ${`${tempPath}/${fname}`}`);
                    fs.unlinkSync(`${tempPath}/${fname}`);
                } catch (e) {
                    logger.error(`[App] Error while unlinking file ${fname} - ${e}`);
                }
            });
        } else {
            logger.debug(`Creating working dir ${tempPath}`);
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
    default:
        response.writeHead(404);
        response.end();
    }
}

/**
 * In case one wants to run the server locally, https is required, as browsers normally won't allow non
 * secure web sockets on a https domain, so something like the bellow config is required along with a https
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
    const wss = new WebSocketServer({ server: wsServer });

    wss.on('connection', (client, upgradeReq) => {
        connected.inc();
        let numberOfEvents = 0;

        // the url the client is coming from
        const referer = upgradeReq.headers.origin + upgradeReq.url;

        // TODO: check against known/valid urls

        const ua = upgradeReq.headers['user-agent'];

        let clientId;

        // In case this dump is send from the integration test suite, we need to maintain the ID used
        // there, the user-agent will have the following format 'integration-test/<clientId>'
        if (ua.startsWith('integration-test')) {
            clientId = ua.split('/').pop();
        } else {
            clientId = uuid.v4();
        }

        let tempStream = fs.createWriteStream(`${tempPath}/${clientId}`);

        tempStream.on('finish', () => {
            if (numberOfEvents > 0) {
                // q.enqueue(clientid);
                workerPool.addTask({ type: RequestType.PROCESS,
                    body: { clientId } });
            } else {
                fs.unlink(`${tempPath}/${clientId}`, () => {
                    // we're good...
                });
            }
        });

        const meta = {
            path: upgradeReq.url,
            origin: upgradeReq.headers.origin,
            url: referer,
            userAgent: ua,
            time: Date.now(),
            fileFormat: 2
        };

        tempStream.write(`${JSON.stringify(meta)}\n`);

        const forwardedFor = upgradeReq.headers['x-forwarded-for'];

        if (forwardedFor) {
            const forwardedIPs = forwardedFor.split(',');

            if (config.server.skipLoadBalancerIp) {
                forwardedIPs.pop();
            }
            const obfuscatedIPs = forwardedIPs.map(ip => {
                const publicIP = [ 'publicIP', null, ip.trim() ];

                obfuscate(publicIP);

                return publicIP[2];
            });

            const publicIP = [ 'publicIP', null, obfuscatedIPs, Date.now() ];

            tempStream.write(`${JSON.stringify(publicIP)}\n`);
        } else {
            const { remoteAddress } = upgradeReq.connection;
            const publicIP = [ 'publicIP', null, remoteAddress ];

            obfuscate(publicIP);
            tempStream.write(`${JSON.stringify([ 'publicIP', null, [ publicIP[2] ], Date.now() ])}\n`);
        }

        logger.info(
            '[App] New app connected: ua: <%s>, referer: <%s>, clientid: <%s>',
            ua,
            referer,
            clientId
        );

        client.on('message', msg => {
            try {
                if (!msg.localeCompare('__ping__')) {
                    logger.debug('[App] Received ping for client: %s', clientId);

                    return;
                }

                const data = JSON.parse(msg);

                numberOfEvents++;

                if (data[0].endsWith('OnError')) {
                    // monkey-patch java/swift sdk bugs.
                    data[0] = data[0].replace(/OnError$/, 'OnFailure');
                }
                switch (data[0]) {
                case 'getUserMedia':
                case 'getUserMediaOnSuccess':
                case 'getUserMediaOnFailure':
                case 'navigator.mediaDevices.getUserMedia':
                case 'navigator.mediaDevices.getUserMediaOnSuccess':
                case 'navigator.mediaDevices.getUserMediaOnFailure':
                    tempStream.write(`${JSON.stringify(data)}\n`);
                    break;
                case 'constraints':
                    if (data[2].constraintsOptional) {
                        // workaround for RtcStats.java bug.
                        data[2].optional = [];
                        Object.keys(data[2].constraintsOptional).forEach(key => {
                            const pair = {};

                            pair[key] = data[2].constraintsOptional[key];
                        });
                        delete data[2].constraintsOptional;
                    }
                    tempStream.write(`${JSON.stringify(data)}\n`);
                    break;
                default:
                    if (data[0] === 'getstats' && data[2].values) {
                        // workaround for RtcStats.java bug.
                        const { timestamp, values } = data[2];

                        data[2] = values;
                        data[2].timestamp = timestamp;
                    }
                    obfuscate(data);
                    tempStream.write(`${JSON.stringify(data)}\n`);
                    break;
                }
            } catch (e) {
                logger.error('[App] Error while processing clientId %s: %s - %s', clientId, e.message, msg);
            }
        });

        client.on('error', e => {
            logger.error('[App] Websocket error: %s', e);
            connectionError.inc();
        });

        client.on('close', () => {
            connected.dec();
            tempStream.write(JSON.stringify([ 'close', null, null, Date.now() ]));
            tempStream.end();
            tempStream = null;
        });
    });
}

/**
 *
 */
function run() {
    logger.info('[App] Initializing <%s>, version <%s>, env <%s> ...', appName, appVersion, getEnvName());

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
