'use strict';
//const child_process = require('child_process');
const fs = require('fs');
const os = require('os');
const http = require('http');
const https = require('https');
const path = require('path');
const WebSocketServer = require('ws').Server;

const config = require('config');
const uuid = require('uuid');

const logger = require('./logging');
const obfuscate = require('./obfuscator');
const { name: appName, version: appVersion } = require('./package');
const { getEnvName, RequestType, ResponseType } = require('./utils');
const WorkerPool = require('./WorkerPool');
// const Amplitude = require('amplitude');

// Configure database, fall back to redshift-firehose.
let database;
if (config.gcp && config.gcp.dataset && config.gcp.table) {
    database = require('./database/bigquery.js')(config.gcp);
}
if (!database) {
    database = require('./database/redshift-firehose.js')(config.firehose);
}

// Configure store, fall back to S3
let store;
if (config.gcp && config.gcp.bucket) {
    store = require('./store/gcp.js')(config.gcp);
}
if (!store) {
    store = require('./store/s3.js')(config.s3);
}

let server;
const tempPath = 'temp';

const prom = require('prom-client');

const connected = new prom.Gauge({
    name: 'rtcstats_websocket_connections',
    help: 'number of open websocket connections',
});

const processed = new prom.Counter({
    name: 'rtcstats_files_processed',
    help: 'number of files processed',
});

const errored = new prom.Counter({
    name: 'rtcstats_files_errored',
    help: 'number of files with errors during processing',
});

// class ProcessQueue {
//     constructor() {
//         this.maxProc = os.cpus().length;
//         this.q = [];
//         this.numProc = 0;
//     }
//     enqueue(clientid) {
//         this.q.push(clientid);
//         if (this.numProc < this.maxProc) {
//             process.nextTick(this.process.bind(this));
//         } else {
//             logger.info('process Q too long: %s', this.numProc);
//         }
//     }
//     process() {
//         const clientid = this.q.shift();
//         if (!clientid) return;
//         // const p = child_process.fork('extract.js', [clientid], {
//         //     execArgv: process.execArgv.concat([ '--inspect-port=5800' ]),
//         //   });
//         const p = child_process.fork("extract.js", [clientid]);
//         p.on('exit', (code) => {
//             this.numProc--;
//             logger.info(`Done clientid: <${clientid}> proc: <${this.numProc}> code: <${code}>`);
//             if (code === 0) {
//                 processed.inc();
//             } else {
//                 errored.inc();
//             }
//             if (this.numProc < 0) {
//                 this.numProc = 0;
//             }
//             if (this.numProc < this.maxProc) {
//                 process.nextTick(this.process.bind(this));
//             }
//             const path = tempPath + '/' + clientid;
//             store
//                 .put(clientid, path)
//                 .then(() => {
//                     fs.unlink(path, () => {});
//                 })
//                 .catch((err) => {
//                     logger.error('Error storing: %s - %s', path, err);
//                     fs.unlink(path, () => {});
//                 });
//         });
//         p.on('message', (msg) => {
//             logger.info('Received message from child process: ', msg);
//             const { url, clientid, connid, clientFeatures, connectionFeatures, streamFeatures } = msg;

//             if (database) {
//                 database.put(url, clientid, connid, clientFeatures, connectionFeatures, streamFeatures);
//             } else {
//                 logger.warn('No database configured!');
//             }
//         });
//         p.on('error', () => {
//             this.numProc--;
//             logger.warn(`Failed to spawn, rescheduling clientid: <${clientid}> proc: <${this.numProc}>`);
//             this.q.push(clientid); // do not immediately retry
//         });
//         this.numProc++;
//         if (this.numProc > 10) {
//             logger.info('Process Q: %n', this.numProc);
//         }
//     }
// }

function storeDump(clientId){
    const path = tempPath + '/' + clientId;
    store
        .put(clientId, path)
        .then(() => {
            fs.unlink(path, () => {});
        })
        .catch((err) => {
            logger.error('Error storing: %s - %s', path, err);
            fs.unlink(path, () => {});
        });
}

function getIdealWorkerCount() {
    return os.cpus().length;
}

const workerScriptPath = path.join(__dirname, './extract.js');
const workerPool = new WorkerPool(workerScriptPath, getIdealWorkerCount());

workerPool.on(ResponseType.PROCESSING, (body) => {
    logger.info('Handling PROCESSING event with body %o', body);
    const { url, clientId, connid, clientFeatures, connectionFeatures, streamFeatures } = body;

    if (database) {
        database.put(url, clientId, connid, clientFeatures, connectionFeatures, streamFeatures);
    } else {
        logger.warn('No database configured!');
    }
});
workerPool.on(ResponseType.DONE, (body) => {
    logger.info('Handling DONE event with body %o', body);
    storeDump(body.clientId);
});
workerPool.on(ResponseType.ERROR, (body) => {
    // TODO handle requeue of the request, this also requires logic in extract.js
    // i.e. we need to catch all potential errors and send back a request with
    // the client id.
    logger.error('Handling ERROR event with body %o', body);

    // If feature extraction failed at least attempt to store the dump in s3.
    if (body.clientId) {
        storeDump(body.clientId);
    } else {
        logger.error('Handling ERROR without a clientId field!');
    }

    // TODO At this point adding a retry mechanism can become detrimental, e.g.
    // If there is a error with the dump file structure the error would just requeue ad infinitum,
    // a smarter mechanism is required here, with some sort of maximum retry per request and so on.
    // if (body.clientId) {
    //     logger.info('Requeued clientId %s', body.clientId);
    //     workerPool.addTask({ type: RequestType.PROCESS, body: { clientId: body.clientId } });
    // }
});

function setupWorkDirectory() {
    try {
        if (fs.existsSync(tempPath)) {
            fs.readdirSync(tempPath).forEach((fname) => {
                try {
                    logger.debug(`Removing file ${tempPath + '/' + fname}`);
                    fs.unlinkSync(tempPath + '/' + fname);
                } catch (e) {
                    logger.error(`Error while unlinking file ${fname} - ${e.message}`);
                }
            });
        } else {
            logger.debug(`Creating working dir ${tempPath}`);
            fs.mkdirSync(tempPath);
        }
    } catch (e) {
        logger.error(`Error while accessing working dir ${tempPath} - ${e.message}`);
        // The app is probably in an inconsistent state at this point, throw and stop process.
        throw e;
    }
}

function setupHttpServer(port, keys) {
    const options = {
        key: fs.readFileSync('key.pem'),
        cert: fs.readFileSync('cert.pem'),
    };

    const server = https
        .Server(options, () => {})
        .on('request', (request, response) => {
            switch (request.url) {
                case '/healthcheck':
                    response.writeHead(200);
                    response.end();
                    break;
                default:
                    response.writeHead(404);
                    response.end();
            }
        })
        .listen(port);
    return server;
}

function setupMetricsServer(port) {
    const metricsServer = http
        .Server()
        .on('request', (request, response) => {
            switch (request.url) {
                case '/metrics':
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

function setupWebSocketsServer(server) {
    const wss = new WebSocketServer({ server });
    wss.on('connection', (client, upgradeReq) => {
        connected.inc();
        let numberOfEvents = 0;
        // the url the client is coming from
        const referer = upgradeReq.headers['origin'] + upgradeReq.url;
        // TODO: check against known/valid urls

        const ua = upgradeReq.headers['user-agent'];
        const clientId = uuid.v4();
        let tempStream = fs.createWriteStream(tempPath + '/' + clientId);
        tempStream.on('finish', () => {
            if (numberOfEvents > 0) {
                //q.enqueue(clientid);
                workerPool.addTask({ type: RequestType.PROCESS, body: { clientId } });
            } else {
                fs.unlink(tempPath + '/' + clientId, () => {
                    // we're good...
                });
            }
        });

        const meta = {
            path: upgradeReq.url,
            origin: upgradeReq.headers['origin'],
            url: referer,
            userAgent: ua,
            time: Date.now(),
            fileFormat: 2,
        };
        tempStream.write(JSON.stringify(meta) + '\n');

        const forwardedFor = upgradeReq.headers['x-forwarded-for'];
        if (forwardedFor) {
            const forwardedIPs = forwardedFor.split(',');
            if (config.server.skipLoadBalancerIp) {
                forwardedIPs.pop();
            }
            const obfuscatedIPs = forwardedIPs.map((ip) => {
                const publicIP = ['publicIP', null, ip.trim()];
                obfuscate(publicIP);
                return publicIP[2];
            });

            const publicIP = ['publicIP', null, obfuscatedIPs, Date.now()];
            tempStream.write(JSON.stringify(publicIP) + '\n');
        } else {
            const { remoteAddress } = upgradeReq.connection;
            const publicIP = ['publicIP', null, remoteAddress];
            obfuscate(publicIP);
            tempStream.write(JSON.stringify(['publicIP', null, [publicIP[2]], Date.now()]) + '\n');
        }

        logger.info('New app connected: ua: <%s>, referer: <%s>, clientid: <%s>', ua, referer, clientId);

        client.on('message', (msg) => {
            try {
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
                        tempStream.write(JSON.stringify(data) + '\n');
                        break;
                    case 'constraints':
                        if (data[2].constraintsOptional) {
                            // workaround for RtcStats.java bug.
                            data[2].optional = [];
                            Object.keys(data[2].constraintsOptional).forEach((key) => {
                                const pair = {};
                                pair[key] = data[2].constraintsOptional[key];
                            });
                            delete data[2].constraintsOptional;
                        }
                        tempStream.write(JSON.stringify(data) + '\n');
                        break;
                    default:
                        if (data[0] === 'getstats' && data[2].values) {
                            // workaround for RtcStats.java bug.
                            const { timestamp, values } = data[2];
                            data[2] = values;
                            data[2].timestamp = timestamp;
                        }
                        obfuscate(data);
                        tempStream.write(JSON.stringify(data) + '\n');
                        break;
                }
            } catch (e) {
                logger.error('Error while processing: %s - %s', e, msg);
            }
        });

        client.on('error', (e) => {
            logger.error('Websocket error: %s', e);
        });

        client.on('close', () => {
            connected.dec();
            tempStream.write(JSON.stringify(['close', null, null, Date.now()]));
            tempStream.end();
            tempStream = null;
        });
    });
}

function run(keys) {
    logger.info('Initializing <%s>, version <%s>, env <%s> ...', appName, appVersion, getEnvName());

    // const amplitude = new Amplitude('43df878c9fd741a83e0c80bec3a5ddf4')
    // data.event_properties = trackObject;

    // amplitude.track(data);
    setupWorkDirectory();

    server = setupHttpServer(config.get('server').port, keys);

    if (config.get('server').metrics) {
        setupMetricsServer(config.get('server').metrics);
    }

    setupWebSocketsServer(server);

    logger.info('Initialization complete.');
}

function stop() {
    if (server) {
        server.close();
    }
}

run();

module.exports = {
    stop: stop,
};
