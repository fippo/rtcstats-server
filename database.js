var AWS = require('aws-sdk');

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
          ConnectionId: connectionId,
          PageUrl: pageUrl,
          ClientFeatures: clientFeatures,
          ConnectionFeatures: connectionFeatures,
        }
      };

      docClient.put(params, function(err, data) {
        if (err) {
          console.log("Error saving data: ", err);
        } else {
          console.log("Successfully saved data");
        }
      });
    },
  }
}
