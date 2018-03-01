var AWS = require('aws-sdk');
var _ = require('lodash');

function lower(obj) {
  var key, keys = Object.keys(obj);
  var n = keys.length;
  var newobj={}
  while (n--) {
    key = keys[n];
    newobj[key.toLowerCase()] = obj[key];
  }
  return newobj;
}

module.exports = function(config) {
  var firehose;
  if (config.firehose && config.firehose.stream) {
    AWS.config = config.firehose;
    firehose = new AWS.Firehose();
  } else {
    console.warn('No Firehose configuration present.  Skipping firehose storage.')
  }

  return {
    put: function(pageUrl, clientId, connectionId, clientFeatures, connectionFeatures) {
      var d = new Date().getTime();
      var item = {
        Date: d - (d % (86400 * 1000)), // just the UTC day
        DateTime: d,
        ClientId: clientId,
        ConnectionId: clientId + '_' + connectionId,
        PageUrl: pageUrl,
      };

      _.forEach(clientFeatures, function(value, key) {
        item[key] = value;
      });
      _.forEach(connectionFeatures, function(value, key) {
        item[key] = value;
      });

      if (firehose) {
        firehose.putRecord({
          DeliveryStreamName: config.firehose.stream, /* required */
          Record: {
            Data: JSON.stringify(lower(item))
          },
        }, function(err, data) {
          if (err) {
            console.log("Error firehosing data: ", err, JSON.stringify(lower(item)));
          } else {
            console.log("Successfully firehosed data");
          }
        });
      }
    },
}
