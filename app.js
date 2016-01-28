var fs = require('fs');
var config = require('config');
var uuid = require('uuid');
var statsMangler = require('./getstats-mangle');

var WebSocketServer = require('ws').Server;
var express = require('express');

var Store = require('./store')({
  s3: config.get('s3')
});
var Database = require('./database')({
  dynamodb: config.get('dynamodb')
});


var WebSocketServer = require('ws').Server;
var features = require('./features');

var wss = null;

// dumps all peerconnections to Store
function dump(url, client) {
    var fmt = {
        PeerConnections: {},
        url: url
    };

    fmt.userAgent = client.userAgent;
    fmt.getUserMedia = client.getUserMedia;
    fmt.peerConnections = client.peerConnections;

    var clientFeatures = {};
    Object.keys(features).forEach(function (fname) {
        if (features[fname].length === 1) {
            var feature = features[fname].apply(null, [client]);
            if (feature !== undefined) {
                console.log('PAGE', 'FEATURE', fname, '=>', feature);
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
                    connectionFeatures[fname] = feature;
                }
            }
        });
        Database.put(clientid, connid, clientFeatures, connectionFeatures);
    });

    Store.put(clientid, JSON.stringify(fmt));
}

var db = {};

function run(keys) {
    var app = express();
    app.use('/static', express.static(__dirname + '/static'));

    if (keys === undefined) {
      var server = require('http').Server(app);
    } else {
      var server = require('https').Server({
          key: keys.serviceKey,
          cert: keys.certificate
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
        console.log(referer);

        if (!db[referer]) db[referer] = {};
        db[referer][clientid] = {
            getUserMedia: [],
            userAgent: ua,
            peerConnections: {}
        };

        console.log('connected', ua, referer);
        client.on('message', function (msg) {
            var data = JSON.parse(msg);
            console.log(data);
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
                console.log(clientid, data[0], data[1], data[2]);
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
            dump(referer, client);
            delete db[referer][clientid];
        });
    });
}

if (process.env.NODE_ENV && process.env.NODE_ENV === 'production') {
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
