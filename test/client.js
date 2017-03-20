'use strict';

const WebSocket = require('ws');
const fs = require('fs');
const config = require('config');
const server = require('../app');
const statsCompressor = require('../getstats-deltacompression').compress;

const data = JSON.parse(fs.readFileSync('test/clienttest.json'));
const url = data.url;
const origin = url.split('/').splice(0, 3).join('/');
const path = url.split('/').splice(3).join('/');

// using setTimeout here is bad obviously. This should wait for the server to listen
setTimeout(() => {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; // ignore self-signed cert
  const ws = new WebSocket(`ws://localhost:${config.get('server').port}/${path}`, {
    headers: {
      'User-Agent': data.userAgent,
    },
    origin
  });
  ws.on('open', () => {
    let events = data.getUserMedia;
      // TODO: handle multiple connections
    Object.keys(data.peerConnections).forEach((id) => {
      events = events.concat(data.peerConnections[id]);
    });
    let prev = {};
    const process = function process() {
      const evt = events.shift();
      if (!evt) {
        ws.close();
        server.stop();
        return;
      }
      if (evt.type === 'getStats') {
        evt.type = 'getstats';
        const base = JSON.parse(JSON.stringify(evt.value)); // our new prev
        evt.value = statsCompressor(prev, evt.value);
          // console.log(JSON.stringify(base).length, 'reduced to', JSON.stringify(evt.value).length);
        prev = base;
      }
      ws.send(JSON.stringify([evt.type, 'testid', evt.value]));
      setTimeout(process, 10);
    };
    process();
  });
}, 2000);
