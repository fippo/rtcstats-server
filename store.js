'use strict';

const AWS = require('aws-sdk');
const zlib = require('zlib');

module.exports = function createStore(config) {
  AWS.config = config.s3;

  const s3bucket = new AWS.S3({
    params: {
      Bucket: config.s3.bucket
    }
  });


  return {
    put(key, putData) {
      zlib.gzip(putData, (gzipErr, gzipData) => {
        if (gzipErr) {
          console.log('Error gzipping data: ', gzipErr);
        } else {
          s3bucket.upload({ Key: `${key}.gz`, Body: gzipData }, (s3Error) => {
            if (s3Error) {
              console.log('Error uploading data: ', s3Error);
            } else {
              console.log('Successfully uploaded data to myBucket/myKey');
            }
          });
        }
      });
    },
  };
};
