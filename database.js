const AWS = require('aws-sdk');

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
  if (config.firehose && config.firehose.stream) {
    AWS.config = config.firehose;
    firehose = new AWS.Firehose();
  } else {
    console.warn('No Firehose configuration present.  Skipping firehose storage.')
  }

  return {
    put: function(pageUrl, clientId, connectionId, clientFeatures, connectionFeatures, streamFeatures) {
      const d = new Date().getTime();
      const item = {
        Date: d - (d % (86400 * 1000)), // just the UTC day
        DateTime: d,
        ClientId: clientId,
        ConnectionId: clientId + '_' + connectionId,
        PageUrl: pageUrl,
      };

      Object.keys(clientFeatures).forEach(key => item[key] = clientFeatures[key]);
      Object.keys(connectionFeatures).forEach(key => item[key] = connectionFeatures[key]);
      Object.keys(streamFeatures).forEach(key => item[key] = streamFeatures[key]);

      if (firehose) {
        firehose.putRecord({
          DeliveryStreamName: config.firehose.stream, /* required */
          Record: {
            Data: JSON.stringify(lower(item))
          },
        }, (err, data) => {
          if (err) {
            console.log("Error firehosing data: ", err, JSON.stringify(lower(item)));
          }
        });
      }
    },
  };
}
