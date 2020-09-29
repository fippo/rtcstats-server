const AWS = require('aws-sdk');
const config = require('config');

AWS.config = config.s3;

const s3bucket = new AWS.S3({
    params: {
        Bucket: config.s3.bucket
    }
});

if (process.argv.length >= 3) {
    const file = require('fs').createWriteStream(process.argv[3]);

    s3bucket
        .getObject({
            Bucket: config.s3.bucket,
            Key: process.argv[2]
        })
        .createReadStream()
        .pipe(file);
} else {
    console.log('usage: node fetchdump.js <key> <outputfile>');
}
