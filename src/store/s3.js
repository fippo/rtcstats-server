const AWS = require('aws-sdk');
const fs = require('fs');
const zlib = require('zlib');

const logger = require('../logging');

module.exports = function(config) {
    AWS.config.update({ region: config.region });

    if (!config.useIAMAuth) {
        AWS.config = config;
    }

    const s3bucket = new AWS.S3({
        params: {
            Bucket: config.bucket
        }
    });

    const configured = Boolean(config.bucket);

    return {
        put(key, filename) {
            return new Promise((resolve, reject) => {
                if (!configured) {
                    logger.warn('[S3] No bucket configured for storage');

                    return resolve(); // not an error.
                }
                fs.readFile(filename, { encoding: 'utf-8' }, (fsErr, fsData) => {
                    if (fsErr) {
                        return reject(fsErr);
                    }
                    zlib.gzip(fsData, (err, data) => {
                        if (err) {
                            return reject(err);
                        }
                        s3bucket.upload({
                            Key: `${key}.gz`,
                            Body: data
                        }, s3Err => {
                            if (s3Err) {
                                return reject(s3Err);
                            }
                            resolve();
                        });
                    });
                });
            });
        }
    };
};
