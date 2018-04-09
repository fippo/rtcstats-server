const AWS = require('aws-sdk');
const zlib = require('zlib');

module.exports = function(config) {
  AWS.config = config.s3;

  const s3bucket = new AWS.S3({
    params: {
      Bucket: config.s3.bucket
    }
  });


  return {
    put: function(key, data) {
      zlib.gzip(data, (err, data) => {
        if (err) {
          console.log("Error gzipping data: ", err);
        } else {
          s3bucket.upload({ Key: key + '.gz', Body: data }, (err, data) => {
            if (err) {
              console.log("Error uploading data: ", err);
            } else {
              console.log("Successfully uploaded data to myBucket/myKey");
            }
          });
        }
      })
    },
  };
}
