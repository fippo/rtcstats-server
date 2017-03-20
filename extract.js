'use strict';

const fs = require('fs');
const config = require('config');

const Store = require('./store')({
  s3: config.get('s3'),
});
const Database = require('./database')({
  dynamodb: config.get('dynamodb'),
  firehose: config.get('firehose'),
});

const isProduction = process.env.NODE_ENV && process.env.NODE_ENV === 'production';

function capitalize(str) {
  return str[0].toUpperCase() + str.substr(1);
}

function safeFeature(feature) {
  if (typeof feature === 'number' && isNaN(feature)) return -1;
  if (typeof feature === 'number' && !isFinite(feature)) return -2;
  if (feature === false) return 0;
  if (feature === true) return 1;

  return feature;
}

const features = require('./features');
const statsDecompressor = require('./getstats-deltacompression').decompress;
const statsMangler = require('./getstats-mangle');

// dumps all peerconnections to Store
function dump(url, client, clientid, data) {
    // ignore connections that never send getUserMedia or peerconnection events.
  if (client.getUserMedia.length === 0 && Object.keys(client.peerConnections).length === 0) return;
  if (!isProduction) {
    let total = 0;
    Object.keys(client.peerConnections).forEach((id) => {
      total += client.peerConnections[id].length;
    });
    console.log('DUMP', client.getUserMedia.length, Object.keys(client.peerConnections).length, total);
  }
  if (isProduction) {
    Store.put(clientid, data);
  }
}

// Feature generation
function generateFeatures(url, client, clientid) {
    // ignore connections that never send getUserMedia or peerconnection events.
  if (client.getUserMedia.length === 0 && Object.keys(client.peerConnections).length === 0) return;

    // clientFeatures are the same for all peerconnections but are saved together
    // with each peerconnection anyway to make correlation easier.
  const clientFeatures = {};
  Object.keys(features).forEach((fname) => {
    if (features[fname].length === 1) {
      let feature = features[fname].apply(null, [client]);
      if (feature !== undefined) {
        if (typeof feature === 'object') {
          Object.keys(feature).forEach((subname) => {
            feature[subname] = safeFeature(feature[subname]);
            if (!isProduction) {
              console.log('PAGE', 'FEATURE', fname + capitalize(subname), '=>', safeFeature(feature[subname]));
            }
            clientFeatures[fname + capitalize(subname)] = feature[subname];
          });
        } else {
          feature = safeFeature(feature);
          if (!isProduction) {
            console.log('PAGE', 'FEATURE', fname, '=>', feature);
          }
          clientFeatures[fname] = feature;
        }
      }
    }
  });
  Object.keys(client.peerConnections).forEach((connid) => {
    if (connid === 'null') return; // ignore the null connid
    const conn = client.peerConnections[connid];
    const connectionFeatures = {};
    Object.keys(features).forEach((fname) => {
      if (features[fname].length === 2) {
        let feature = features[fname].apply(null, [client, conn]);
        if (feature !== undefined) {
          if (typeof feature === 'object') {
            Object.keys(feature).forEach((subname) => {
              feature[subname] = safeFeature(feature[subname]);
              if (!isProduction) {
                console.log(connid, 'FEATURE', fname + capitalize(subname), '=>', safeFeature(feature[subname]));
              }
              connectionFeatures[fname + capitalize(subname)] = feature[subname];
            });
          } else {
            feature = safeFeature(feature);
            if (!isProduction) {
              console.log(connid, 'FEATURE', fname, '=>', safeFeature(feature));
            }
            connectionFeatures[fname] = feature;
          }
        }
      }
    });
    // save memory
    delete client.peerConnections[connid]; // eslint-disable-line no-param-reassign
    if (isProduction) {
      Database.put(url, clientid, connid, clientFeatures, connectionFeatures);
    }
  });
}

const clientid = process.argv[2];
const path = `temp/${clientid}`;
fs.readFile(path, { encoding: 'utf-8' }, (err, clientData) => {
    // remove the file
  fs.unlink(path, () => {
        // we're good...
  });
  if (!err) {
    const baseStats = {};
    const lines = clientData.split('\n');
    const client = JSON.parse(lines.shift());
    client.peerConnections = {};
    client.getUserMedia = [];
    lines.forEach((line) => {
      if (line.length) {
        const data = JSON.parse(line);
        const time = new Date(data.time);
        delete data.time;
        switch (data[0]) {
          case 'location':
            client.location = data[2];
            break;
          case 'userfeedback': // TODO: might be renamed
            client.feedback = data[2];
            break;
          case 'getUserMedia':
          case 'getUserMediaOnSuccess':
          case 'getUserMediaOnFailure':
          case 'navigator.mediaDevices.getUserMedia':
          case 'navigator.mediaDevices.getUserMediaOnSuccess':
          case 'navigator.mediaDevices.getUserMediaOnFailure':
            client.getUserMedia.push({
              time,
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
              time,
              type: data[0],
              value: data[2]
            });
            break;
        }
      }
    });

    dump(client.url, client, clientid, clientData);
    generateFeatures(client.url, client, clientid);
  }
});
