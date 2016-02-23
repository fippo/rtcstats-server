var uuid = require('uuid');
var AWS = require('aws-sdk');

var docClient = new AWS.DynamoDB.DocumentClient();

// TODO(ggb): I hate this code, I need somebody knowing how to use dynamodb
var User = {
  find: function(user, callback) {
    docClient.query({
      TableName: 'SnoopUsers',
      IndexName: "GithubId-index",
      Limit: 1,
      KeyConditions: {
        "GithubId": {
					ComparisonOperator: 'EQ',
					AttributeValueList: [ user.githubId ]
				},
      },
    }, function(err, data) {
      if (err) {
        return callback(err);
      }
      callback(null, data.Count ? data.Items[0] : null);
    });
  },
  findOrCreate: function(user, callback) {
    var self = this;
    self.find(user, function(err, data) {
      if (!err && data) {
        return callback(err, data);
      }
      var params = {
        TableName: 'SnoopUsers',
        Item: {
          Id: uuid.v4(),
          CreatedAt: (new Date).getTime(),
          GithubId: user.githubId,
          Email: user.email,
          Username: user.username,
          Name: user.name,
          Projects: [ {
            Id: uuid.v4(),
            Secret: uuid.v4(),
            Name: 'default',
            CreatedAt: (new Date).getTime(),
          } ]
        },
      };
      docClient.put(params, function(err, data) {
        self.find(user, callback);
      });
    });
  }
};

// User.findOrCreate({ githubId: "51edd2252" }, function(err, data) {
//   console.log(data);
// });

exports.User = User;

exports.Project = {
  find: function(id, callback) {
  },
};

exports.Features = {
  findById: function(connectionId, projectId, callback) {
  },
};

exports.Summary = {
  find: function(id, callback) {
  },
};
