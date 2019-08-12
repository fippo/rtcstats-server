const fs = require('fs');
const config = require('config');

const canUseProcessSend = !!process.send;
const isProduction = process.env.NODE_ENV && process.env.NODE_ENV === 'production';

function capitalize(str) {
    return str[0].toUpperCase() + str.substr(1);
}

function safeFeature(feature) {
    if (typeof feature === 'number' && isNaN(feature)) feature = -1;
    if (typeof feature === 'number' && !isFinite(feature)) feature = -2;
    if (feature === false) feature = 0;
    if (feature === true) feature = 1;

    return feature;
}

const connectionfeatures = require('./features-connection');
const clientfeatures = require('./features-client');
const streamfeatures = require('./features-stream');
const statsDecompressor = require('./getstats-deltacompression').decompress;
const statsMangler = require('./getstats-mangle');
const {extractTracks, extractStreams, tempStreamPath} = require('./utils');

// dumps all peerconnections.
function dump(url, client, clientid, data) {
    // ignore connections that never send getUserMedia or peerconnection events.
    if (client.getUserMedia.length === 0 && Object.keys(client.peerConnections).length === 0) return;
    if (!isProduction) {
        let total = 0;
        Object.keys(client.peerConnections).forEach(id => {
            total += client.peerConnections[id].length;
        });
        console.log('DUMP', client.getUserMedia.length, Object.keys(client.peerConnections).length, total);
        return;
    }
}

// Feature generation
function generateFeatures(url, client, clientid) {
    // ignore connections that never send getUserMedia or peerconnection events.
    if (client.getUserMedia.length === 0 && Object.keys(client.peerConnections).length === 0) return;

    // clientFeatures are the same for all peerconnections but are saved together
    // with each peerconnection anyway to make correlation easier.
    const clientFeatures = {};
    Object.keys(clientfeatures).forEach(fname => {
        let feature = clientfeatures[fname].apply(null, [client]);
        if (feature !== undefined) {
            if (typeof feature === 'object') {
                Object.keys(feature).forEach(subname => {
                    feature[subname] = safeFeature(feature[subname]);
                    if (!isProduction) {
                        console.log('PAGE', 'FEATURE', fname + capitalize(subname), '=>', safeFeature(feature[subname]));
                    }
                    clientFeatures[fname + capitalize(subname)] = feature[subname];
                });
            }  else {
                feature = safeFeature(feature);
                if (!isProduction) {
                    console.log('PAGE', 'FEATURE', fname, '=>', feature);
                }
                clientFeatures[fname] = feature;
            }
        }
    });
    if (Object.keys(client.peerConnections).length === 0) {
        // we only have GUM and potentially GUM errors.
        if (canUseProcessSend && isProduction) {
            process.send({url, clientid, connid: '', clientFeatures});
        }
    }

    Object.keys(client.peerConnections).forEach(connid => {
        if (connid === 'null' || connid === '') return; // ignore the null connid and empty strings
        const conn = client.peerConnections[connid];
        const connectionFeatures = {};
        Object.keys(connectionfeatures).forEach(fname => {
            let feature = connectionfeatures[fname].apply(null, [client, conn]);
            if (feature !== undefined) {
                if (typeof feature === 'object') {
                    Object.keys(feature).forEach(subname => {
                        feature[subname] = safeFeature(feature[subname]);
                        if (!isProduction) {
                            console.log(connid, 'FEATURE', fname + capitalize(subname), '=>', safeFeature(feature[subname]));
                        }
                        connectionFeatures[fname + capitalize(subname)] = feature[subname];
                    });
                }  else {
                    feature = safeFeature(feature);
                    if (!isProduction) {
                        console.log(connid, 'FEATURE', fname, '=>', safeFeature(feature));
                    }
                    connectionFeatures[fname] = feature;
                }
            }
        });

        const tracks = extractTracks(conn);
        const streams = extractStreams(tracks);
        for (const [streamId, tracks] of streams.entries()) {
            const streamFeatures = {streamId};
            for (const {trackId, kind, direction, stats} of tracks) {
                Object.keys(streamfeatures).forEach(fname => {
                    let feature = streamfeatures[fname].apply(null, [{kind, direction, trackId, stats, peerConnectionLog: conn}]);
                    if (feature !== undefined) {
                        feature = safeFeature(feature);
                        if (typeof feature === 'object') {
                            Object.keys(feature).forEach(subname => {
                                feature[subname] = safeFeature(feature[subname]);
                                if (!isProduction) {
                                    console.log(connid, 'STREAM', streamId, 'TRACK', trackId, 'FEATURE', fname + capitalize(subname), '=>', safeFeature(feature[subname]));
                                }
                                streamFeatures[fname + capitalize(subname)] = feature[subname];
                            });
                        }  else {
                            feature = safeFeature(feature);
                            if (!isProduction) {
                                console.log(connid, 'STREAM', streamId, 'TRACK', trackId, 'FEATURE', fname, '=>', safeFeature(feature));
                            }
                            streamFeatures[fname] = feature;
                        }
                    }
                });
            }
            if (canUseProcessSend && isProduction) {
                process.send({url, clientid, connid, clientFeatures, connectionFeatures, streamFeatures});
            }
        }
        delete client.peerConnections[connid]; // save memory
    });
}

const clientid = process.argv[2];
const peerConnectionId = process.argv[3];
const path = tempStreamPath(clientid, peerConnectionId);
fs.readFile(path, {encoding: 'utf-8'}, (err, data) => {
    if (err) {
        console.error(err, path);
        return;
    }
    const baseStats = {};
    const lines = data.split('\n');
    const client = JSON.parse(lines.shift());
    client.peerConnections = {};
    client.getUserMedia = [];
    lines.forEach(line => {
        if (line.length) {
            const data = JSON.parse(line);
            const time = new Date(data.time || data[3]);
            delete data.time;
            switch(data[0]) {
            case 'location':
                client.location = data[2];
                break;
            case 'userfeedback': // TODO: might be renamed
                client.feedback = data[2];
                break;
            case 'tags': // experiment variation tags
                client.tags = data[2];
                break;
            case 'wsconnect':
                client.websocketConnectionTime = data[2] >>> 0;
                break;
            case 'wsconnecterror':
                client.websocketError = data[2];
                break;
            case 'getUserMedia':
            case 'getUserMediaOnSuccess':
            case 'getUserMediaOnFailure':
            case 'navigator.mediaDevices.getUserMedia':
            case 'navigator.mediaDevices.getUserMediaOnSuccess':
            case 'navigator.mediaDevices.getUserMediaOnFailure':
            case 'navigator.getDisplayMedia':
            case 'navigator.getDisplayMediaOnSucces':
            case 'navigator.mediaDevices.getDisplayMedia':
            case 'navigator.mediaDevices.getDisplayMediaOnSuccess':
                client.getUserMedia.push({
                    time: time,
                    timestamp: time.getTime(),
                    type: data[0],
                    value: data[2]
                });
                break;
            default:
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
                    timestamp: time.getTime(),
                    type: data[0],
                    value: data[2],
                });
                break;
            }
        }
    });

    dump(client.url, client, clientid, data);
    generateFeatures(client.url, client, clientid);
});
