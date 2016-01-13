var fs = require('fs');
var config = require('config');
var uuid = require('uuid');

var Store = require('./store')({
  s3: config.get('s3')
});

var WebSocketServer = require('ws').Server;

var server = null;
var wss = null;

// dumps all peerconnections to Store
// The format reensembles chrome://webrtc-internals (minus google names)
// and can be imported again using tools like 
// https://fippo.github.io/webrtc-dump-importer
function dump(url, clientid) {
    var fmt = {
        PeerConnections: {},
        url: url
    };
    var client = db[url][clientid];

    fmt.userAgent = client.userAgent;
    fmt.getUserMedia = client.getUserMedia;

    Object.keys(client.peerConnections).forEach(function(connid) {
        var conn = client.peerConnections[connid];
        // TODO: why don't we just do = conn?
        fmt.PeerConnections[connid] = {
            config: conn.config,
            updateLog: conn.updateLog,
            stats: conn.stats
        };
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
            userAgent: ua,
            getUserMedia: [],
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
                    db[referer][clientid].peerConnections[data[1]] = {
                        config: {},
                        updateLog: [],
                        stats: []
                    };
                }
                switch(data[0]) {
                case 'getStats':
                    db[referer][clientid].peerConnections[data[1]].stats.push({
                        time: new Date(),
                        value: data[2]
                    });
                    break;
                case 'create':
                    db[referer][clientid].peerConnections[data[1]].config = data[2];
                    break;
                default:
                    db[referer][clientid].peerConnections[data[1]].updateLog.push({
                        time: new Date(),
                        type: data[0],
                        value: data[2]
                    });
                }
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

process.on('SIGINT', function() {
    var silly = {
        PeerConnections: {}
    };
    Object.keys(db).forEach(function(origin) {
        Object.keys(db[origin]).forEach(function(clientid) {
            var client = db[origin][clientid];
            Object.keys(client.peerConnections).forEach(function(connid) {
                var conn = client.peerConnections[connid];
                silly.PeerConnections[origin + '#' + clientid + '_' + connid] = {
                    config: conn.config,
                    updateLog: conn.updateLog,
                    stats: conn.stats
                };
            });
        });
    });
    fs.writeFileSync('dump.json', JSON.stringify(silly));
    process.exit();
});
