var fs = require('fs');
var config = require('config');
var uuid = require('uuid');
var statsMangler = require('./getstats-mangle');
var express = require('express');

var WebSocketServer = require('ws').Server;
var app = require('./web/server')();

var Store = require('./store')({
  s3: config.get('s3')
});
var Database = require('./database')({
  dynamodb: config.get('dynamodb')
});

var isProduction = process.env.NODE_ENV && process.env.NODE_ENV === 'production';

var WebSocketServer = require('ws').Server;
var features = require('./features');

var wss = null;

// dumps all peerconnections to Store
function dump(url, client, clientid) {
    var fmt = {
        PeerConnections: {},
        url: url
    };

    fmt.userAgent = client.userAgent;
    fmt.getUserMedia = client.getUserMedia;
    fmt.peerConnections = client.peerConnections;

    // ignore connections that never send getUserMedia or peerconnection events.
    if (fmt.getUserMedia.length === 0 && Object.keys(fmt.peerConnections).length === 0) return;

    if (isProduction) {
        Store.put(clientid, JSON.stringify(fmt));
    }

    // Feature generation
    // clientFeatures are the same for all peerconnections but are saved together

    // with each peerconnection anyway to make correlation easier.
    var clientFeatures = {};
    Object.keys(features).forEach(function (fname) {
        if (features[fname].length === 1) {
            var feature = features[fname].apply(null, [client]);
            if (feature !== undefined) {
                console.log('PAGE', 'FEATURE', fname, '=>', feature);
                if (feature === false) feature = 0;
                if (feature === true) feature = 1;
                clientFeatures[fname] = feature;
            }
        }
    });
    Object.keys(client.peerConnections).forEach(function(connid) {
        if (connid === 'null') return; // ignore the null connid
        var conn = client.peerConnections[connid];
        var connectionFeatures = {};
        Object.keys(features).forEach(function (fname) {
            if (features[fname].length === 2) {
                var feature = features[fname].apply(null, [client, conn]);
                if (feature !== undefined) {
                    console.log(connid, 'FEATURE', fname, '=>', feature);
                    if (feature === false) feature = 0;
                    if (feature === true) feature = 1;
                    connectionFeatures[fname] = feature;
                }
            }
        });
        if (isProduction) {
            Database.put(url, clientid, connid, clientFeatures, connectionFeatures);
        }
    });

}

var db = {};
var server;

function run(keys) {
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
        // TODO: separate origin and pathname (url)

        if (!db[referer]) db[referer] = {};
        db[referer][clientid] = {
            getUserMedia: [],
            userAgent: ua,
            peerConnections: {}
        };

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
                if (!db[referer][clientid].peerConnections[data[1]]) {
                    db[referer][clientid].peerConnections[data[1]] = [];
                }
                if (data[0] === 'getStats') {
                    data[2] = statsMangler(data[2]);
                }
                db[referer][clientid].peerConnections[data[1]].push({
                    time: new Date(),
                    type: data[0],
                    value: data[2]
                });
                break;
            }
        });

        client.on('close', function() {
            console.log('closed');

            var client = db[referer][clientid];
            dump(referer, client, clientid);
            delete db[referer][clientid];
        });
    });
}

function stop() {
    if (server) {
        server.close();
    }
}

if (isProduction) {
    run();
} else {
    // on localhost, dynamically generate certificates. Enable #allow-insecure-localhost
    // in chrome://flags for ease of development.
    require('pem').createCertificate({ days: 1, selfSigned: true }, function (err, keys) {
        if (err) {
            console.err('error creating cert', err);
            return;
        } else {
            run(keys);
        }
    });
}

module.exports = {
    stop: stop
};
