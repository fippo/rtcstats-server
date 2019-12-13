'use strict';
const fs = require('fs');
const config = require('config');
const uuid = require('uuid');
const os = require('os');
const child_process = require('child_process');
const http = require('http');

const WebSocketServer = require('ws').Server;

const maxmind = require('maxmind');
const cityLookup = maxmind.open('./GeoLite2-City.mmdb');

const obfuscate = require('./obfuscator');

// Configure database, fall back to redshift-firehose.
let database;
if (config.gcp && (config.gcp.dataset && config.gcp.table)) {
    database = require('./database/bigquery.js')({gcp: config.gcp});
}
if (!database) {
    database = require('./database/redshift-firehose.js')({
        firehose: config.get('firehose'),
    });
}

// Configure store, fall back to S3
let store;
if (config.gcp && config.gcp.bucket) {
    store = require('./store/gcp.js')({
        s3: config.get('gcp'),
    });
}
if (!store) {
    store = require('./store/s3.js')({
        s3: config.get('s3'),
    });
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

class ProcessQueue {
    constructor() {
        this.maxProc = os.cpus().length;
        this.q = [];
        this.numProc = 0;
    }
    enqueue(clientid) {
        this.q.push(clientid);
        if (this.numProc < this.maxProc) {
            process.nextTick(this.process.bind(this));
        } else {
            console.log('process Q too long:', this.numProc);
        }
    }
    process() {
        const clientid = this.q.shift();
        if (!clientid) return;
        const p = child_process.fork('extract.js', [clientid]);
        p.on('exit', (code) => {
            this.numProc--;
            console.log('done', clientid, this.numProc, 'code=' + code);
            if (code === 0) {
                processed.inc();
            } else {
                errored.inc();
            }
            if (this.numProc < 0) this.numProc = 0;
            if (this.numProc < this.maxProc) process.nextTick(this.process.bind(this));
            const path = tempPath + '/' + clientid;
            store.put(clientid, path)
                .then(() => {
                    fs.unlink(path, () => {});
                })
                .catch((err) => {
                    console.error('Error storing', path, err);
                    fs.unlink(path, () => {});
                })
        });
        p.on('message', (msg) => {
            const {url, clientid, connid, clientFeatures, connectionFeatures, streamFeatures} = msg;
            database.put(url, clientid, connid, clientFeatures, connectionFeatures, streamFeatures);
        });
        p.on('error', () => {
            this.numProc--;
            console.log('failed to spawn, rescheduling', clientid, this.numProc);
            this.q.push(clientid); // do not immediately retry
        });
        this.numProc++;
        if (this.numProc > 10) {
            console.log('process Q:', this.numProc);
        }
    }
}
const q = new ProcessQueue();

function setupWorkDirectory() {
    try {
        if (fs.existsSync(tempPath)) {
            fs.readdirSync(tempPath).forEach(fname => {
                try {
                    console.debug(`Removing file ${tempPath + '/' + fname}`)
                    fs.unlinkSync(tempPath + '/' + fname);
                } catch(e) {
                    console.error(`Error while unlinking file ${fname} - ${e.message}`);
                }
            });
        } else {
            console.debug(`Creating working dir ${tempPath}`)
            fs.mkdirSync(tempPath);
        }
    } catch(e) {
        console.error(`Error while accessing working dir ${tempPath} - ${e.message}`);
    }
}

function setupHttpServer(port, keys) {
    const options = !!keys ? {
        key: keys.serviceKey,
        cert: keys.certificate,
    }: {}

    const server = http.Server(options, () => {})
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
    const metricsServer = http.Server()
        .on('request', (request, response) => {
            switch (request.url) {
            case '/metrics':
                response.writeHead(200, {'Content-Type': prom.contentType});
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
        const clientid = uuid.v4();
        let tempStream = fs.createWriteStream(tempPath + '/' + clientid);
        tempStream.on('finish', () => {
            if (numberOfEvents > 0) {
                q.enqueue(clientid);
            } else {
                fs.unlink(tempPath + '/' + clientid, () => {
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
        const {remoteAddress} = upgradeReq.connection;
        const address = forwardedFor || remoteAddress;
        if (address) {
            process.nextTick(() => {
                const city = cityLookup.get(address);
                if (tempStream) {
                    tempStream.write(JSON.stringify(['location', null, city, Date.now()]) + '\n');
                }
            });
        }

        console.log('connected', ua, referer, clientid);

        client.on('message', msg => {
            try {
                const data = JSON.parse(msg);

                numberOfEvents++;

                if (data[0].endsWith('OnError')) {
                    // monkey-patch java/swift sdk bugs.
                    data[0] = data[0].replace(/OnError$/, 'OnFailure');
                }
                switch(data[0]) {
                case 'getUserMedia':
                case 'getUserMediaOnSuccess':
                case 'getUserMediaOnFailure':
                case 'navigator.mediaDevices.getUserMedia':
                case 'navigator.mediaDevices.getUserMediaOnSuccess':
                case 'navigator.mediaDevices.getUserMediaOnFailure':
                    tempStream.write(JSON.stringify(data) + '\n');
                    break;
                case 'constraints':
                    if (data[2].constraintsOptional) { // workaround for RtcStats.java bug.
                        data[2].optional = [];
                        Object.keys(data[2].constraintsOptional).forEach(key => {
                            const pair = {};
                            pair[key] = data[2].constraintsOptional[key]
                        });
                        delete data[2].constraintsOptional;
                    }
                    tempStream.write(JSON.stringify(data) + '\n');
                    break;
                default:
                    if (data[0] === 'getstats' && data[2].values) { // workaround for RtcStats.java bug.
                        const {timestamp, values} = data[2];
                        data[2] = values;
                        data[2].timestamp = timestamp;
                    }
                    obfuscate(data);
                    tempStream.write(JSON.stringify(data) + '\n');
                    break;
                }
            } catch(e) {
                console.error('error while processing', e, msg);
            }
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
    setupWorkDirectory();

    server = setupHttpServer(config.get('server').port, keys);

    if (config.get('server').metrics) {
        setupMetricsServer(config.get('server').metrics);
    }

    setupWebSocketsServer(server);
}

function stop() {
    if (server) {
        server.close();
    }
}

run();

module.exports = {
    stop: stop
};
