var AWS = require('aws-sdk');

module.exports = function(config) {
  AWS.config = config.s3;

  var s3bucket = new AWS.S3({
    params: {
      Bucket: config.s3.bucket
    }
  });


  return {
    put: function(key, data) {
      s3bucket.upload({ Key: key, Body: data }, function(err, data) {
        if (err) {
          console.log("Error uploading data: ", err);
        } else {
          console.log("Successfully uploaded data to myBucket/myKey");
        }
      });
    },
  }
}
