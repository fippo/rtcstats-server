'use strict';
const fs = require('fs');
const config = require('config');
const uuid = require('uuid');
const os = require('os');
const child_process = require('child_process');
const http = require('http');
const https = require('https');

const WebSocketServer = require('ws').Server;

const maxmind = require('maxmind');
const cityLookup = maxmind.open('./GeoLite2-City.mmdb');

const {tempStreamPath, tempPath} = require('./utils');
const obfuscate = require('./obfuscator');
const Database = require('./database')({
    firehose: config.get('firehose'),
});
const Store = require('./store')({
  s3: config.get('s3'),
});

let server;

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
    enqueue(clientid, peerConnectionId) {
        this.q.push({clientid, peerConnectionId});
        if (this.numProc < this.maxProc) {
            process.nextTick(this.process.bind(this));
        } else {
            console.log('process Q too long:', this.numProc);
        }
    }
    process() {
        const next = this.q.shift();
        if (!next) return;
        const {clientid, peerConnectionId} = next;
        const p = child_process.fork('extract.js', [clientid, peerConnectionId]);
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
            fs.readFile(tempStreamPath(clientid, peerConnectionId), {encoding: 'utf-8'}, (err, data) => {
                if (err) {
                    console.error('Could not open file for store upload', err);
                    return;
                }
                // remove the file
                fs.unlink(tempStreamPath(clientid, peerConnectionId), () => {
                    // we're good...
                });
                Store.put(`${clientid}-${peerConnectionId}`, data);
            });
        });
        p.on('message', (msg) => {
            const {url, clientid, connid, clientFeatures, connectionFeatures, streamFeatures} = msg;
            Database.put(url, clientid, connid, clientFeatures, connectionFeatures, streamFeatures);
        });
        p.on('error', () => {
            this.numProc--;
            console.log('failed to spawn, rescheduling', clientid, this.numProc);
            this.q.push({clientid, peerConnectionId}); // do not immediately retry
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
        fs.readdirSync(tempPath).forEach(fname => {
            fs.unlinkSync(tempPath + '/' + fname);
        });
        fs.rmdirSync(tempPath);
    } catch(e) {
        console.error('work dir does not exist');
    }
    fs.mkdirSync(tempPath);
}

function run(keys) {
    setupWorkDirectory();

    if (keys === undefined) {
      server = http.Server(() => { });
    } else {
      server = https.Server({
          key: keys.serviceKey,
          cert: keys.certificate,
      }, () => { });
    }

    server.listen(config.get('server').port);
    server.on('request', (request, response) => {
        // look at request.url
        switch (request.url) {
        case '/healthcheck':
            response.writeHead(200);
            response.end();
            break;
        default:
            response.writeHead(404);
            response.end();
        }
    });

    const metricsPort = config.get('server').metrics;
    if (metricsPort) {
        const metricsServer = http.Server();
        metricsServer.listen(config.get('server').metrics);
        metricsServer.on('request', (request, response) => {
            switch (request.url) {
            case '/metrics':
                response.writeHead(200, {'Content-Type': prom.contentType});
                response.end(prom.register.metrics());
                break;
            default:
                response.writeHead(404);
                response.end();
            }
        });
    }

    const wss = new WebSocketServer({ server: server });
    wss.on('connection', (client, upgradeReq) => {
        connected.inc();
        // the url the client is coming from
        const referer = upgradeReq.headers['origin'] + upgradeReq.url;
        // TODO: check against known/valid urls

        const ua = upgradeReq.headers['user-agent'];
        const clientid = uuid.v4();

        const meta = () => {
            return {
                path: upgradeReq.url,
                origin: upgradeReq.headers['origin'],
                url: referer,
                userAgent: ua,
                time: Date.now(),
                fileFormat: 2
            }
        }

        const tempStreams = {}
        const write = (data, peerConnectionId) => {
            if (!peerConnectionId) {
                return;
            }
            let tempStream = tempStreams[peerConnectionId];
            if (!tempStream) {
                //Create new temp file
                const streamPath = tempStreamPath(clientid, peerConnectionId);
                tempStream = fs.createWriteStream(streamPath);
                tempStream.on('finish', () => {
                    q.enqueue(clientid, peerConnectionId);
                });
                tempStream.write(JSON.stringify(meta()) + '\n');
                const forwardedFor = upgradeReq.headers['x-forwarded-for'];
                const {remoteAddress} = upgradeReq.connection;
                const address = forwardedFor || remoteAddress;
                if (address) {
                    process.nextTick(() => {
                        const city = cityLookup.get(address);
                        if (tempStream) {
                            write(['location', null, city, Date.now()], peerConnectionId);
                        }
                    });
                }
                tempStreams[peerConnectionId] = tempStream;
            }
            if(tempStream.writable) {
                tempStream.write(JSON.stringify(data) + '\n');
            } else {
                console.error("Unable to write to stream: ", data, clientid, peerConnectionId);
            }
        }

        const closeStream = (peerConnectionId) => {
            if (!peerConnectionId) {
                return;
            }
            let tempStream = tempStreams[peerConnectionId];
            if (tempStream) {
                write(['close', peerConnectionId, null, Date.now()], peerConnectionId);
                tempStream.end();
            }
        }

        const timeouts = {};
        const handlePeerConnectionEnd = (peerConnectionId) => {
            if (!peerConnectionId) return;
            clearTimeout(timeouts[peerConnectionId]);
            // Allow time for remaining events to come in
            timeouts[peerConnectionId] = setTimeout(() => {
                closeStream(peerConnectionId);
            }, 5000);
        }

        console.log('connected', ua, referer, clientid);

        client.on('message', msg => {
            try {
                const data = JSON.parse(msg);
                const peerConnectionId = data[1];

                if (data[0].endsWith('OnError')) {
                    // monkey-patch java/swift sdk bugs.
                    data[0] = data[0].replace('OnError', 'OnFailure');
                }
                switch(data[0]) {
                case 'close':
                    handlePeerConnectionEnd(peerConnectionId);
                    break;
                case 'getUserMedia':
                case 'getUserMediaOnSuccess':
                case 'getUserMediaOnFailure':
                case 'navigator.mediaDevices.getUserMedia':
                case 'navigator.mediaDevices.getUserMediaOnSuccess':
                case 'navigator.mediaDevices.getUserMediaOnFailure':
                    write(data, peerConnectionId);
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
                    write(data, peerConnectionId);
                    break;
                default:
                    if (data[0] === 'getstats' && data[2].values) { // workaround for RtcStats.java bug.
                        const {timestamp, values} = data[2];
                        data[2] = values;
                        data[2].timestamp = timestamp;
                    }
                    obfuscate(data);
                    write(data, peerConnectionId);
                    break;
                }
            } catch(e) {
                console.error('error while processing', e, msg);
            }
        });

        client.on('close', () => {
            connected.dec();
            const remainingStreams = Object.keys(tempStreams);
            remainingStreams.forEach(closeStream);
        });
    });
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
