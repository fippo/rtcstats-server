
const { Storage } = require('@google-cloud/storage');

const logger = require('../logging');

/**
 *
 * @param {*} config
 */
module.exports = function(config) {
    const { bucket } = config;
    const configured = Boolean(bucket);
    const storage = new Storage();

    return {
        put(key, filename) {
            return new Promise(resolve => {
                if (!configured) {
                    logger.warn('no bucket configured for storage');

                    return resolve(); // not an error.
                }
                logger.debug(`Adding file: ${filename} to GCP bucket`);

                return storage.bucket(bucket).upload(filename, { gzip: true });
            });
        }
    };
};

/**
 *
 */
if (require.main === module) {
    // For manual testing of the upload
    if (process.argv.length !== 4) {
        console.log(`usage: node ${process.argv[1]} <gcp-bucket-name> <file-to-upload>`);
    }
    const bucket = process.argv[2];
    const filename = process.argv[3];
    const instance = module.exports({ bucket });

    instance.put(filename, filename)
    .then(() => {
        console.log(`uploaded ${filename} to ${bucket}`);
    })
    .catch(e => {
        console.error(e);
    });
}
