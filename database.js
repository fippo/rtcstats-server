var AWS = require('aws-sdk');

module.exports = function(config) {
  AWS.config = config.dynamodb;

  var docClient = new AWS.DynamoDB.DocumentClient();

  return {
    put: function(clientId, connectionId, clientFeatures, connectionFeatures) {
      var params = {
        TableName : config.dynamodb.table,
        Item: {
          ClientId: clientId,
          ConnectionId: connectionId,
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
