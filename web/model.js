var uuid = require('uuid');
var AWS = require('aws-sdk');
var Promise = require("bluebird");

var docClient = new AWS.DynamoDB.DocumentClient();

var pgp = require('pg-promise')({
});
var connString = "postgres://skunkworks:G~z^MaSuh3!E9S>@snoop-cluster.cqf3sr8w0afh.us-west-2.redshift.amazonaws.com:5439/snoop";
var db = pgp(connString);

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

var Summary = {
  find: function(id, callback) {
    var d = new Date();
    d.setHours(0,0,0,0);

    var queries = [];
    queries.push(db.query('select COUNT(*) as count1, COUNT(CASE WHEN iceconnectedorcompleted THEN 1 END) as count2 from features'));
    queries.push(db.query('select COUNT(*) as count1, COUNT(CASE WHEN iceconnectedorcompleted THEN 1 END) as count2 from features where datetime > ' + d.getTime()));

    Promise.all(queries)
    .then(function(results) {
      callback(null, {
        today: {
          count: results[0][0].count1,
          successful: results[0][0].count2,
        },
        total: {
          count: results[1][0].count1,
          successful: results[1][0].count2,
        }
      });
    });
  },
};

// User.findOrCreate({ githubId: "51edd2252" }, function(err, data) {
//   console.log(data);
// });

// Summary.find('', function(err, data) {
//   console.log(err, data);
// })

exports.User = User;

exports.Project = {
  find: function(id, callback) {
  },
};

exports.Features = {
  findById: function(connectionId, projectId, callback) {
    docClient.query({
      TableName: 'Snoop',
      Key: {
        ConnectionId: connectionId,
      },
    }, function(err, data) {
      if (err) {
        return callback(err);
      }
      callback(null, data.Count ? data.Items[0] : null);
    });
  },
};

exports.Summary = Summary;
