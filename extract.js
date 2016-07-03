var fs = require('fs');
var config = require('config');

var Store = require('./store')({
  s3: config.get('s3')
});
var Database = require('./database')({
  dynamodb: config.get('dynamodb')
});
var isProduction = process.env.NODE_ENV && process.env.NODE_ENV === 'production';

var features = require('./features');
var statsDecompressor = require('./getstats-deltacompression').decompress;
var statsMangler = require('./getstats-mangle');

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
        delete client.peerConnections[connid]; // save memory
        if (isProduction) {
            Database.put(url, clientid, connid, clientFeatures, connectionFeatures);
        }
    });
}

var clientid = process.argv[2];
var path = 'temp/' + clientid;
var meta = fs.readFileSync(path + '-meta', {encoding: 'utf-8'});
fs.unlink(path + '-meta', function() {
    // we're good...
});
var client = JSON.parse(meta);
var url = meta.url;
fs.readFile(path, {encoding: 'utf-8'}, function(err, data) {
    if (!err) {
        var baseStats = {};
        data.split('\n').forEach(function(line) {
            if (line.length) {
                var data = JSON.parse(line);
                var time = new Date(data.time);
                delete data.time;
                if (!client.peerConnections[data[1]]) {
                    client.peerConnections[data[1]] = [];
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
                client.peerConnections[data[1]].push({
                    time: time,
                    type: data[0],
                    value: data[2]
                });
            }
        });
    }
    // we proceed even if there was an error.
    fs.unlink(path, function() {
        // we're good...
    });
    dump(url, client, clientid);
    generateFeatures(url, client, clientid);
});
