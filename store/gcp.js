const zlib = require('zlib');
const fs = require('fs');

const {Storage} = require('@google-cloud/storage');

module.exports = function(config) {
  const {bucket} = config.gcp;
  const configured = !!bucket;
  const storage = new Storage();

  return {
    put: function(key, filename) {
      return new Promise((resolve, reject) => {
        if (!configured) {
          console.log('no bucket configured for storage');
          return resolve(); // not an error.
        }
        return storage.bucket(bucket).upload(key, {gzip: true});
      });
    },
  };
}

if (require.main === module) {
    // For manual testing of the upload
    if (process.argv.length !== 4) {
        console.log('usage: node ' + process.argv[1] + ' <gcp-bucket-name> <file-to-upload>');
    }
    const bucket = process.argv[2];
    const filename = process.argv[3];
    const instance = module.exports({gcp: {bucket}});
    instance.put(filename, filename)
    .then(() => {
        console.log('uploaded ' + filename + ' to ' + bucket);
    })
    .catch((e) => {
        console.error(e);
    });
}
