const AWS = require('aws-sdk');

const logger = require('../logging');

function lower(obj) {
  let key, keys = Object.keys(obj);
  let n = keys.length;
  const newobj = {};
  while (n--) {
    key = keys[n];
    newobj[key.toLowerCase()] = obj[key];
  }
  return newobj;
}

module.exports = function (config) {
  let firehose;
  if (config && config.stream) {
    AWS.config = config;
    firehose = new AWS.Firehose();
  } else {
    logger.warn('No Firehose configuration present.  Skipping firehose storage.')
  }

  return {
    put: function (pageUrl, clientId, connectionId, clientFeatures, connectionFeatures, streamFeatures) {
      const d = new Date().getTime();
      const item = {
        Date: d - (d % (86400 * 1000)), // just the UTC day
        DateTime: d,
        ClientId: clientId,
        ConnectionId: clientId + '_' + connectionId,
        PageUrl: pageUrl,
      };

      Object.assign(item, clientFeatures, connectionFeatures, streamFeatures);

      if (firehose) {
        firehose.putRecord({
          DeliveryStreamName: config.stream, /* required */
          Record: {
            Data: JSON.stringify(lower(item))
          },
        }, (err, data) => {
          if (err) {
            logger.info("Error firehosing data: %s - %s", err, JSON.stringify(lower(item)));
          }
        });
      }
    },
  };
}
