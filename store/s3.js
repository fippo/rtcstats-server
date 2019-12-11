const zlib = require('zlib');
const fs = require('fs');

const AWS = require('aws-sdk');

module.exports = function(config) {
  AWS.config = config.s3;

  const s3bucket = new AWS.S3({
    params: {
      Bucket: config.s3.bucket
    }
  });
  const configured = !!config.s3.bucket;

  return {
    put: function(key, filename) {
      return new Promise((resolve, reject) => {
        if (!configured) {
          console.log('no bucket configured for storage');
          return resolve(); // not an error.
        }
        fs.readFile(filename, {encoding: 'utf-8'}, (err, data) => {
          if (err) {
            return reject(err);
          }
          zlib.gzip(data, (err, data) => {
            if (err) {
              return reject(err);
            } else {
              s3bucket.upload({ Key: key + '.gz', Body: data }, (err, data) => {
                if (err) {
                  return reject(err);
                }
                resolve();
              });
            }
          });
        });
      });
    },
  };
}
