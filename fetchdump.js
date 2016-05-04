var AWS = require('aws-sdk');
var config = require('config');

AWS.config = config.s3;

var s3bucket = new AWS.S3({
  params: {
    Bucket: config.s3.bucket
  }
});
if (process.argv.length >= 3) {
    var file = require('fs').createWriteStream(process.argv[3]);
    s3bucket.getObject({
      Bucket: config.s3.bucket,
      Key: process.argv[2],
    }).createReadStream().pipe(file);
} else {
    console.log('usage: node fetchdump.js <key> <outputfile>');
}
