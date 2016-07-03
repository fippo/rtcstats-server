var fs = require('fs');
var config = require('config');
var uuid = require('uuid');
var obfuscate = require('./obfuscator');
var express = require('express');
var os = require('os');
var child_process = require('child_process');

var WebSocketServer = require('ws').Server;
var app = require('./web/server')();

var WebSocketServer = require('ws').Server;

var wss = null;

var db = {};
var server;
var tempPath = 'temp';

function run(keys) {
    try {
        fs.mkdirSync(tempPath);
    } catch(e) {
        console.log('work dir already exists');
    }
    app.use('/static', express.static(__dirname + '/static'));

    if (keys === undefined) {
      server = require('http').Server(app);
    } else {
      server = require('https').Server({
          key: keys.serviceKey,
          cert: keys.certificate,
      }, app);
    }

    server.listen(config.get('server').port);
    wss = new WebSocketServer({ server: server });

    wss.on('connection', function(client) {
        // the url the client is coming from
        var referer = client.upgradeReq.headers['origin'] + client.upgradeReq.url;
        // TODO: check against known/valid urls

        var ua = client.upgradeReq.headers['user-agent'];
        var clientid = uuid.v4();

        if (!db[referer]) db[referer] = {};
        db[referer][clientid] = {
            getUserMedia: [],
            path: client.upgradeReq.url,
            peerConnections: {},
            origin: client.upgradeReq.headers['origin'],
            url: referer,
            userAgent: ua
        };
        var tempStream = fs.createWriteStream(tempPath + '/' + clientid);


        console.log('connected', ua, referer);
        client.on('message', function (msg) {
            var data = JSON.parse(msg);
            switch(data[0]) {
            case 'getUserMedia':
            case 'getUserMediaOnSuccess':
            case 'getUserMediaOnFailure':
            case 'navigator.mediaDevices.getUserMedia':
            case 'navigator.mediaDevices.getUserMediaOnSuccess':
            case 'navigator.mediaDevices.getUserMediaOnFailure':
                db[referer][clientid].getUserMedia.push({
                    time: new Date(),
                    type: data[0],
                    value: data[2]
                });
                break;
            default:
                obfuscate(data);
                data.time = new Date().getTime();
                tempStream.write(JSON.stringify(data) + '\n');
                break;
            }
        });

        client.on('close', function() {
            tempStream.on('finish', function() {
                fs.writeFile(tempStream.path + '-meta', JSON.stringify(db[referer][clientid]), function(err) {
                    if (err) {
                        console.log('error writing GUM file, data lost :-(');
                        fs.unlink(tempStream.path, function(err, data) {
                        });
                        return;
                    }
                    delete db[referer][clientid];

                    child_process.fork('extract.js', [clientid]).on('exit', function() {
                        console.log('done', clientid);
                    });
                });
            });
            tempStream.end();
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
