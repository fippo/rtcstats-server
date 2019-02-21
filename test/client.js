var WebSocket = require('ws');
var fs = require('fs');
var config = require('config');
var server = require('../app');
var statsCompressor = require('../getstats-deltacompression').compress;

var data = JSON.parse(fs.readFileSync('test/clienttest.json'));
var url = data.url;
var origin = url.split('/').splice(0, 3).join('/');
var path = url.split('/').splice(3).join('/');

// using setTimeout here is bad obviously. This should wait for the server to listen
setTimeout(function() {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; // ignore self-signed cert
    var ws = new WebSocket('ws://localhost:' + config.get('server').port + '/' + path, {
        headers: {
            "User-Agent": data.userAgent,
        },
        origin: origin
    });
    ws.on('open', function open() {
      var events = data.getUserMedia;
      // TODO: handle multiple connections
      Object.keys(data.peerConnections).forEach(function(id) {
        events = events.concat(data.peerConnections[id]);
      });
      var prev = {}
      var process = function() {
        var evt = events.shift();
        if (!evt) {
          ws.close();
          server.stop();
          return;
        }
        if (evt.type === 'getStats') {
          evt.type = 'getstats';
          var base = JSON.parse(JSON.stringify(evt.value)); // our new prev
          evt.value = statsCompressor(prev, evt.value);
          //console.log(JSON.stringify(base).length, 'reduced to', JSON.stringify(evt.value).length);
          prev = base;
        }
        ws.send(JSON.stringify([evt.type, 'testid', evt.value, new Date(evt.time).getTime()]));
        setTimeout(process, 10);
      };
      process();
    });
}, 2000);
