'use strict';

const fs = require('fs');
const config = require('config');
const http = require('http');
const https = require('https');
const uuid = require('uuid');
const obfuscate = require('./obfuscator');
const os = require('os');
const fork = require('child_process').fork;

const WebSocketServer = require('ws').Server;

const maxmind = require('maxmind');

const cityLookup = maxmind.open('./GeoLite2-City.mmdb');

let wss = null;

let server;
const tempPath = 'temp';

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
    const p = fork('extract.js', [clientid]);
    p.on('exit', () => {
      this.numProc -= 1;
      console.log('done', clientid, this.numProc);
      if (this.numProc < 0) this.numProc = 0;
      if (this.numProc < this.maxProc) process.nextTick(this.process.bind(this));
    });
    p.on('error', () => {
      this.numProc -= 1;
      console.log('failed to spawn, rescheduling', clientid, this.numProc);
      this.q.push(clientid); // do not immediately retry
    });
    this.numProc += 1;
    console.log('process Q:', this.numProc);
  }
}
const q = new ProcessQueue();

function setupWorkDirectory() {
  try {
    fs.readdirSync(tempPath).forEach((fname) => {
      fs.unlinkSync(`${tempPath}/${fname}`);
    });
    fs.rmdirSync(tempPath);
  } catch (e) {
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
        return;
      default:
        response.writeHead(404);
        response.end();
    }
  });

  wss = new WebSocketServer({ server });

  wss.on('connection', (client) => {
        // the url the client is coming from
    const referer = client.upgradeReq.headers.origin + client.upgradeReq.url;
        // TODO: check against known/valid urls

    const ua = client.upgradeReq.headers['user-agent'];
    const clientid = uuid.v4();
    let tempStream = fs.createWriteStream(`${tempPath}/${clientid}`);
    tempStream.on('finish', () => {
      q.enqueue(clientid);
    });

    const meta = {
      path: client.upgradeReq.url,
      origin: client.upgradeReq.headers.origin,
      url: referer,
      userAgent: ua,
      time: Date.now()
    };
    tempStream.write(`${JSON.stringify(meta)}\n`);

    const forwardedFor = client.upgradeReq.headers['x-forwarded-for'];
    if (forwardedFor) {
      process.nextTick(() => {
        const city = cityLookup.get(forwardedFor);
        if (tempStream) {
          tempStream.write(`${JSON.stringify({
            0: 'location',
            1: null,
            2: city,
            time: Date.now()
          })}\n`
                    );
        }
      });
    }

    console.log('connected', ua, referer);
    client.on('message', (msg) => {
      const data = JSON.parse(msg);
      switch (data[0]) {
        case 'getUserMedia':
        case 'getUserMediaOnSuccess':
        case 'getUserMediaOnFailure':
        case 'navigator.mediaDevices.getUserMedia':
        case 'navigator.mediaDevices.getUserMediaOnSuccess':
        case 'navigator.mediaDevices.getUserMediaOnFailure':
          data.time = Date.now();
          tempStream.write(`${JSON.stringify(data)}\n`);
          break;
        default:
          obfuscate(data);
          data.time = Date.now();
          tempStream.write(`${JSON.stringify(data)}\n`);
          break;
      }
    });

    client.on('close', () => {
      tempStream.end();
      tempStream = null;
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
  stop
};
