const fs = require('fs');
const EventEmitter = require("events");
const {BigQuery} = require('@google-cloud/bigquery');

const isProduction = process.env.NODE_ENV && process.env.NODE_ENV === 'production';

class RecordBuffer extends EventEmitter {
    constructor(maximumTimeBetweenWrites = 5 * 60 * 1000, bufferSize = 100) {
        super();

        this.maximumTimeBetweenWrites = maximumTimeBetweenWrites;
        this.nextFlush = setTimeout(this.flush.bind(this), this.maximumTimeBetweenWrites);

        this.bufferSize = bufferSize;
        this.fileCount = 0;
        this.bufferedItems = 0;
        this.currentFile = fs.createWriteStream('bigquery-' + this.fileCount);
    }
    put(record) {
        this.currentFile.write(JSON.stringify(record) + '\n');
        this.bufferedItems++;
        if (this.bufferedItems >= this.bufferSize) {
            this.flush();
        }
    }
    flush() {
        clearTimeout(this.nextFlush);
        this.nextFlush = setTimeout(this.flush.bind(this), this.maximumTimeBetweenWrites);
        if (this.bufferedItems === 0) {
            return;
        }
        const pendingFile = this.currentFile;

        this.bufferedItems = 0;
        this.fileCount++;
        this.currentFile = fs.createWriteStream('bigquery-' + this.fileCount);
        pendingFile.end();
        pendingFile.on('finish', () => {
            this.emit('flush', pendingFile.path);
        });
    }

}

module.exports = function(config) {
    if (config.gcp) {
    } else {
        console.warn('No GCP/Bigquery configuration present. Skipping Bigquery database.')
        return;
    }

    const bigquery = new BigQuery();
    const recordBuffer = new RecordBuffer();
    recordBuffer.on('flush', (filename) => {
        bigquery
            .dataset(config.gcp.dataset)
            .table(config.gcp.table)
            .load(filename, {format: 'JSON'})
        .then(() => {
            if (isProduction) {
                fs.unlink(filename, () => {});
            }
        })
        .catch(e => console.error('error loading into bigquery', e));
    });
    return {
        put: function(pageUrl, clientId, connectionId, clientFeatures, connectionFeatures, streamFeatures) {
            const d = new Date().getTime();
            const item = {
                Date: d - (d % (86400 * 1000)), // just the UTC day
                DateTime: d,
                ClientId: clientId,
                ConnectionId: clientId + '_' + connectionId,
                PageUrl: pageUrl,
            };

            Object.assign(item, clientFeatures, connectionFeatures, streamFeatures);
            if (config.gcp.fields.length) {
                Object.keys(item).forEach(key => {
                    if (!config.gcp.fields.includes(key.toLowerCase())) {
                        delete item[key]
                    }
                }); // ideally we'd use .entries and .fromEntries but that is unavailable in node.
            }
            recordBuffer.put(item);
        },
    };
}
