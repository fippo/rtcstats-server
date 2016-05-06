var AWS = require('aws-sdk');
var _ = require('lodash');

module.exports = function(config) {
  AWS.config = config.dynamodb;

  var docClient = new AWS.DynamoDB.DocumentClient();

  return {
    put: function(pageUrl, clientId, connectionId, clientFeatures, connectionFeatures) {
      var d = new Date().getTime();
      var params = {
        TableName : config.dynamodb.table,
        Item: {
          Date: d - (d % (86400 * 1000)), // just the UTC day
          DateTime: d,
          ClientId: clientId,
          ConnectionId: clientId + '_' + connectionId,
          PageUrl: pageUrl,
        }
      };

      _.forEach(clientFeatures, function(value, key) {
        params.Item[key] = value;
      });
      _.forEach(connectionFeatures, function(value, key) {
        params.Item[key] = value;
      });

      docClient.put(params, function(err, data) {
        if (err) {
          console.log("Error saving data: ", err);
        } else {
          console.log("Successfully saved data");
        }
      });
    },

    get: function(clientId, connectionId, callback) {
      
     var params = {
        TableName : config.dynamodb.table,
        Key: {
          ConnectionId: clientId + '_' + connectionId,
        }
      };
      docClient.get(params, callback);
    }
  }
}
