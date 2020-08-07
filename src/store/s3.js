const zlib = require('zlib');
const fs = require('fs');

const AWS = require('aws-sdk');

const logger = require('../logging');

module.exports = function (config) {
    AWS.config.update({ region: config.region });

    if (!config.useIAMAuth) {
        AWS.config = config;
    }

    const s3bucket = new AWS.S3({
        params: {
            Bucket: config.bucket,
        },
    });

    const configured = !!config.bucket;

    return {
        put: function (key, filename) {
            return new Promise((resolve, reject) => {
                if (!configured) {
                    logger.warn('[S3] No bucket configured for storage');
                    return resolve(); // not an error.
                }
                fs.readFile(filename, { encoding: 'utf-8' }, (err, data) => {
                    if (err) {
                        return reject(err);
                    }
                    zlib.gzip(data, (err, data) => {
                        if (err) {
                            return reject(err);
                        } else {
                            s3bucket.upload({ Key: key + '.gz', Body: data }, (err) => {
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
};

if (require.main === module) {
    // For manual testing of the upload
    if (process.argv.length !== 4) {
        console.log('usage: node ' + process.argv[1] + ' <s3-bucket-name> <file-to-upload>');
    }
    const bucket = process.argv[2];
    const filename = process.argv[3];
    const instance = module.exports({ bucket });
    instance
        .put(filename, filename)
        .then(() => {
            console.log('uploaded ' + filename + ' to ' + bucket);
        })
        .catch((e) => {
            console.error(e);
        });
}
