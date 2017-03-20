'use strict';

const AWS = require('aws-sdk');
const _ = require('lodash');

function lower(obj) {
  const newobj = {};
  Object.keys(obj).forEach((key) => { newobj[key.toLowerCase()] = obj[key]; });
  return newobj;
}

module.exports = function database(config) {
  let dynamodb;
  if (config.dynamodb && config.dynamodb.table) {
    AWS.config = config.dynamodb;
    dynamodb = new AWS.DynamoDB.DocumentClient();
  } else {
    console.warn('No DynamoDB configuration present.  Skipping dynamodb storage.');
  }

  let firehose;
  if (config.firehose && config.firehose.stream) {
    AWS.config = config.firehose;
    firehose = new AWS.Firehose();
  } else {
    console.warn('No Firehose configuration present.  Skipping firehose storage.');
  }

  return {
    put(pageUrl, clientId, connectionId, clientFeatures, connectionFeatures) {
      const d = new Date().getTime();
      const item = {
        Date: d - (d % (86400 * 1000)), // just the UTC day
        DateTime: d,
        ClientId: clientId,
        ConnectionId: `${clientId}_${connectionId}`,
        PageUrl: pageUrl,
      };

      _.forEach(clientFeatures, (value, key) => {
        item[key] = value;
      });
      _.forEach(connectionFeatures, (value, key) => {
        item[key] = value;
      });

      if (dynamodb) {
        dynamodb.put({
          TableName: config.dynamodb.table,
          Item: item,
        }, (err, data) => { // eslint-disable-line no-unused-vars
          if (err) {
            console.log('Error saving data: ', err, JSON.stringify(item));
          } else {
            console.log('Successfully saved data');
          }
        });
      }

      if (firehose) {
        firehose.putRecord({
          DeliveryStreamName: config.firehose.stream, /* required */
          Record: {
            Data: JSON.stringify(lower(item))
          },
        }, (err, data) => { // eslint-disable-line no-unused-vars
          if (err) {
            console.log('Error firehosing data: ', err, JSON.stringify(lower(item)));
          } else {
            console.log('Successfully firehosed data');
          }
        });
      }
    },

    get(clientId, connectionId, callback) {
      callback(new Error('Database.get is not implemented'));
      // const params = {
      //   TableName: config.dynamodb.table,
      //   Key: {
      //     ConnectionId: `${clientId}_${connectionId}`,
      //   }
      // };
      // I'm not sure what docClient is, and this method appears unused. Erroring out for safety.
      // docClient.get(params, callback);
    }
  };
};
