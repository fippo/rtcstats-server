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

var server;
var tempPath = 'temp';

function setupWorkDirectory() {
    try {
        fs.readdirSync(tempPath).forEach(function(fname) {
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
        var tempStream = fs.createWriteStream(tempPath + '/' + clientid);
        tempStream.on('finish', function() {
            child_process.fork('extract.js', [clientid]).on('exit', function() {
                console.log('done', clientid);
            });
        });

        var meta = {
            path: client.upgradeReq.url,
            origin: client.upgradeReq.headers['origin'],
            url: referer,
            userAgent: ua,
            time: Date.now()
        };
        tempStream.write(JSON.stringify(meta) + '\n');


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
                data.time = Date.now();
                tempStream.write(JSON.stringify(data) + '\n');
                break;
            default:
                obfuscate(data);
                data.time = Date.now();
                tempStream.write(JSON.stringify(data) + '\n');
                break;
            }
        });

        client.on('close', function() {
            tempStream.end();
            delete tempStream;
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
