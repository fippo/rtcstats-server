var WebSocket = require('ws');
var fs = require('fs');
var config = require('config');
var server = require('../app');

var data = JSON.parse(fs.readFileSync('test/clienttest.json'));
var url = data.url;
var origin = url.split('/').splice(0, 3).join('/');
var path = url.split('/').splice(3).join('/');

setTimeout(function() {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; // ignore self-signed cert
    var ws = new WebSocket('wss://localhost:' + config.get('server').port + '/' + path, {
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
      var process = function() {
        var evt = events.shift();
        if (!evt) {
          ws.close();
          server.stop();
          return;
        }
        ws.send(JSON.stringify([evt.type, 'testid', evt.value]));
        setTimeout(process, 10);
      };
      process();
    });
}, 1000);
