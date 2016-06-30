var fs = require('fs');
var config = require('config');
var uuid = require('uuid');
var statsMangler = require('./getstats-mangle');
var statsDecompressor = require('./getstats-deltacompression').decompress;
var obfuscate = require('./obfuscator');
var express = require('express');
var cluster = require('cluster');
var os = require('os');

var Store = require('./store')({
  s3: config.get('s3')
});
var Database = require('./database')({
  dynamodb: config.get('dynamodb')
});

var WebSocketServer = require('ws').Server;
var app = require('./web/server')();

var isProduction = process.env.NODE_ENV && process.env.NODE_ENV === 'production';

var WebSocketServer = require('ws').Server;
var features = require('./features');

var wss = null;

// dumps all peerconnections to Store
function dump(url, client, clientid) {
    // ignore connections that never send getUserMedia or peerconnection events.
    if (client.getUserMedia.length === 0 && Object.keys(client.peerConnections).length === 0) return;
    var total = 0;
    Object.keys(client.peerConnections).forEach(function(id) {
        total += client.peerConnections[id].length;
    });
    console.log('DUMP', client.getUserMedia.length, Object.keys(client.peerConnections).length, total);
    if (isProduction) {
        Store.put(clientid, JSON.stringify(client));
    }
}

// Feature generation
function generateFeatures(url, client, clientid) {
    // ignore connections that never send getUserMedia or peerconnection events.
    if (client.getUserMedia.length === 0 && Object.keys(client.peerConnections).length === 0) return;

    // clientFeatures are the same for all peerconnections but are saved together
    // with each peerconnection anyway to make correlation easier.
    var clientFeatures = {};
    Object.keys(features).forEach(function (fname) {
        if (features[fname].length === 1) {
            var feature = features[fname].apply(null, [client]);
            if (feature !== undefined) {
                console.log('PAGE', 'FEATURE', fname, '=>', feature);
                if (typeof feature === 'number' && isNaN(feature)) feature = -1;
                if (typeof feature === 'number' && !isFinite(feature)) feature = -2;
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
                    if (typeof feature === 'number' && isNaN(feature)) feature = -1;
                    if (typeof feature === 'number' && !isFinite(feature)) feature = -2;
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
var tempPath = 'temp' + (cluster.isWorker ? '-' + cluster.worker.process.pid: '');

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

        var baseStats = {};

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
                fs.readFile(tempStream.path, {encoding: 'utf-8'}, function(err, data) {
                    if (!err) {
                        data.split('\n').forEach(function(line) {
                            if (line.length) {
                                var data = JSON.parse(line);
                                var time = new Date(data.time);
                                delete data.time;
                                if (!db[referer][clientid].peerConnections[data[1]]) {
                                    db[referer][clientid].peerConnections[data[1]] = [];
                                    baseStats[data[1]] = {};
                                }
                                if (data[0] === 'getstats') { // delta-compressed
                                    data[2] = statsDecompressor(baseStats[data[1]], data[2]);
                                    baseStats[data[1]] = JSON.parse(JSON.stringify(data[2]));
                                }
                                if (data[0] === 'getStats' || data[0] === 'getstats') {
                                    data[2] = statsMangler(data[2]);
                                    data[0] = 'getStats';
                                }
                                db[referer][clientid].peerConnections[data[1]].push({
                                    time: time,
                                    type: data[0],
                                    value: data[2]
                                });
                            }
                        });
                    }
                    // we proceed even if there was an error.
                    var client = db[referer][clientid];
                    delete db[referer][clientid];
                    fs.unlink(tempStream.path, function(err, data) {
                        // we're good...
                    });
                    dump(referer, client, clientid);
                    generateFeatures(referer, client, clientid);
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

if (require.main === module && cluster.isMaster) {
    os.cpus().forEach(function() {
        cluster.fork()
    });
    cluster.on('exit', function(worker, code, signal) {
        console.log('worker', worker.process.pid, 'died, restarting');
        cluster.fork();

        // clean up after worker.
        // TODO: Possibly recover data. For now: throw it away.
        var path = 'temp-' + worker.process.pid;
        var count = 0;
        fs.readdirSync(path).forEach(function(fname) {
            count++;
            fs.unlinkSync(path + '/' + fname); 
        });
        fs.rmdirSync(path);
        console.log(count, 'datasets gone :-(');
    });
} else {
    run();
}

module.exports = {
    stop: stop
};
