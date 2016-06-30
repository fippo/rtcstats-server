var AWS = require('aws-sdk');
var zlib = require('zlib');

module.exports = function(config) {
  AWS.config = config.s3;

  var s3bucket = new AWS.S3({
    params: {
      Bucket: config.s3.bucket
    }
  });


  return {
    put: function(key, data) {
      zlib.gzip(data, function(err, data) {
        if (err) {
          console.log("Error gzipping data: ", err);
        } else {
          s3bucket.upload({ Key: key + '.gz', Body: data }, function(err, data) {
            if (err) {
              console.log("Error uploading data: ", err);
            } else {
              console.log("Successfully uploaded data to myBucket/myKey");
            }
          });
        }
      })
    },
  }
}
