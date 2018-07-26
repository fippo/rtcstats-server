const AWS = require('aws-sdk');
const _ = require('lodash');
const Muckraker = require('muckraker');

function lower(obj) {
  let key, keys = Object.keys(obj);
  let n = keys.length;
  const newobj={};
  while (n--) {
    key = keys[n];
    newobj[key.toLowerCase()] = obj[key];
  }
  return newobj;
}

module.exports = function(config) {
  let firehose;

  console.log(config.postgres);

  if (config.firehose && config.firehose.stream) {
    AWS.config = config.firehose;
    firehose = new AWS.Firehose();

    return {
      put: function(pageUrl, clientId, connectionId, clientFeatures, connectionFeatures) {
        const d = new Date().getTime();
        const item = {
          Date: d - (d % (86400 * 1000)), // just the UTC day
          DateTime: d,
          ClientId: clientId,
          ConnectionId: clientId + '_' + connectionId,
          PageUrl: pageUrl,
        };

        _.forEach(clientFeatures, (value, key) => {
          item[key] = value;
        });
        _.forEach(connectionFeatures, (value, key) => {
          item[key] = value;
        });

        if (firehose) {
          firehose.putRecord({
            DeliveryStreamName: config.firehose.stream, /* required */
            Record: {
              Data: JSON.stringify(lower(item))
            },
          }, (err, data) => {
            if (err) {
              console.log("Error firehosing data: ", err, JSON.stringify(lower(item)));
            } else {
              console.log("Successfully firehosed data");
            }
          });
        }
      },
    };

  } else if (config.postgres && config.postgres.host) {

    const pgDb = new Muckraker({ connection: config.postgres });

    const boolSet = new Set([
	  'calledgetusermedia',
	  'calledgetusermediarequestingaudio',
	  'calledgetusermediarequestingvideo',
	  'calledlegacygetusermedia',
	  'calledmediadevicesgetusermedia',
	  'configured',
	  'configuredbundlepolicy',
	  'configuredcertificate',
	  'configuredicetransportpolicy',
	  'configuredrtcpmuxpolicy',
	  'configuredwithiceservers',
	  'configuredwithstun',
	  'configuredwithturn',
	  'configuredwithturntcp',
	  'configuredwithturntls',
	  'configuredwithturnudp',
	  'gatheredhost',
	  'gatheredstun',
	  'gatheredturntcp',
	  'gatheredturntls',
	  'gatheredturnudp',
	  'gatheredrfc1918addressprefix16',
	  'gatheredrfc1918addressprefix12',
	  'gatheredrfc1918addressprefix10',
	  'getusermediasuccess',
	  'hadremoteturncandidate',
	  'iceconnectedorcompleted',
	  'icefailure',
	  'icefailuresubsequent',
	  'icegatheringcomplete',
	  'icerestart',
	  'isinitiator',
	  'signalingstableatleastonce',
	  'usingbundle',
	  'usingicelite',
	  'usingmultistream',
	  'usingrtcpmux',
	  'wasgoogbandwidthlimitedresolutionevertrue',
	  'wasgoogcpulimitedresolutionevertrue',
	  'notsendingaudio',
	  'notsendingvideo',
	  'icerestartsuccess',
	  'icerestartfollowedbysetremotedescription',
	  'icerestartfollowedbyrelaycandidate',
	  'usingsimulcast'
    ]);


    return {
      put: function (pageUrl, clientId, connectionId, clientFeatures, connectionFeatures) {
        const d = new Date().getTime();
        const item = {
          Date: d - (d % (86400 * 1000)), // just the UTC day
          DateTime: d,
          ClientId: clientId,
          ConnectionId: clientId + '_' + connectionId,
          PageUrl: pageUrl,
        };

        const transform = (value, key) => {
          key = key.toLowerCase();
          if (boolSet.has(key)) {
            item[key] = !!value;
          } else {
            item[key] = value;
          }
        }

        _.forEach(clientFeatures, transform);
        _.forEach(connectionFeatures, transform);

        pgDb.features_import.insert(item);
      }
    };

  } else {
    console.warn('No Firehose configuration present.  Skipping firehose storage.')
  }
}
