const fs = require('fs');
const EventEmitter = require("events");
const { BigQuery } = require('@google-cloud/bigquery');

const logger = require('../logging');

const isProduction = process.env.NODE_ENV && process.env.NODE_ENV === 'production';

class RecordBuffer extends EventEmitter {
    constructor({ maxFlushTime, bufferSize }) {
        super();

        this.maxFlushTime = maxFlushTime;
        this.nextFlush = setTimeout(this.flush.bind(this), this.maxFlushTime);

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
        this.nextFlush = setTimeout(this.flush.bind(this), this.maxFlushTime);
        if (this.bufferedItems === 0) {
            logger.debug('No content to flush');
            return;
        }
        const pendingFile = this.currentFile;

        this.bufferedItems = 0;
        this.fileCount++;
        this.currentFile = fs.createWriteStream('bigquery-' + this.fileCount);
        pendingFile.end();
        pendingFile.on('finish', () => {
            logger.debug(`Flushing file ${pendingFile.path}`);
            this.emit('flush', pendingFile.path);
        });
    }

}

module.exports = function (config) {
    if (!config) {
        console.warn('No GCP/Bigquery configuration present. Skipping Bigquery database.')
        return;
    }

    const bigquery = new BigQuery();

    let recordBuffer = null;
    if (!config.streaming)
    {
        recordBuffer = new RecordBuffer({
            maxFlushTime: config.maxFlushTime || 5 * 60 * 1000,
            bufferSize: config.bufferSize || 100
        });
        recordBuffer.on('flush', (filename) => {
            bigquery
                .dataset(config.dataset)
                .table(config.table)
                .load(filename, { format: 'JSON', ignoreUnknownValues: true })
                .then(() => {
                    if (isProduction) {
                        fs.unlink(filename, () => { });
                    }
                })
                .catch(e => console.error('error loading into bigquery', e));
        });
    }

    return {
        put: function (pageUrl, clientId, connectionId, clientFeatures, connectionFeatures, streamFeatures) {
            const d = new Date().getTime();
            const item = {
                Date: d - (d % (86400 * 1000)), // just the UTC day
                DateTime: d,
                ClientId: clientId,
                ConnectionId: clientId + '_' + connectionId,
                PageUrl: pageUrl,
            };

            Object.assign(item, clientFeatures, connectionFeatures, streamFeatures);

            if (config.streaming)
            {
                bigquery
                    .dataset(config.dataset)
                    .table(config.table)
                    .insert(item, { ignoreUnknownValues: true })
                    .then((res) => {
                        logger.debug("Successful streaming insert into BigQuery", res);
                    })
                    .catch(e => console.error('error insert into bigquery', e));
            }
            else
            {
                recordBuffer.put(item);
            }
        },
    };
}
