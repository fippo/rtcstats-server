var fs = require('fs');
var config = require('config');
var uuid = require('uuid');

var Store = require('./store')({
  s3: config.get('s3')
});

var WebSocketServer = require('ws').Server;
var features = require('./features');

var server = null;
var wss = null;

// dumps all peerconnections to Store
function dump(url, clientid) {
    var fmt = {
        PeerConnections: {},
        url: url
    };
    var client = db[url][clientid];

    fmt.userAgent = client.userAgent;
    fmt.getUserMedia = client.getUserMedia;
    fmt.peerConnections = client.peerConnections;

    Object.keys(features).forEach(function (fname) {
        if (features[fname].length === 1) {
            var feature = features[fname].apply(null, [client]);
            if (feature !== undefined) {
                console.log('PAGE', 'FEATURE', fname, '=>', feature);
            }
        }
    });
    Object.keys(client.peerConnections).forEach(function(connid) {
        if (connid === 'null') return; // ignore the null connid
        var conn = client.peerConnections[connid];
        Object.keys(features).forEach(function (fname) {
            if (features[fname].length === 2) {
                var feature = features[fname].apply(null, [client, conn]);
                if (feature !== undefined) {
                    console.log(connid, 'FEATURE', fname, '=>', feature);
                }
            }
        });
    });
    Store.put(clientid, JSON.stringify(fmt));
    delete db[url][clientid];
}

var db = {};

function run(keys) {
    server = require('https').Server({
        key: keys.serviceKey,
        cert: keys.certificate
    });
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
            dump(referer, clientid);
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
