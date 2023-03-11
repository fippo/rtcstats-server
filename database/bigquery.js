const fs = require('fs');
const EventEmitter = require("events");
const { BigQuery } = require('@google-cloud/bigquery');

const logger = require('../logging');

const isProduction = process.env.NODE_ENV && process.env.NODE_ENV === 'production';

const TEMP_FOLDER = 'temp/bigquery';

class RecordBuffer extends EventEmitter {
    constructor({ maxFlushTime, bufferSize }) {
        super();

        this.maxFlushTime = maxFlushTime;

        this.bufferSize = bufferSize;
        this.fileCount = 0;
        this.bufferedItems = 0;

        this.currentFile = fs.createWriteStream(`${TEMP_FOLDER}/features-${this.fileCount}`);

        this.nextFlush = setTimeout(this.flush.bind(this), this.maxFlushTime);
    }

    put(record) {
        logger.debug('new record added');
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
        this.currentFile = fs.createWriteStream(`${TEMP_FOLDER}/features-${this.fileCount}`);
        pendingFile.on('finish', () => {
            logger.debug(`Flushing file ${pendingFile.path}`);
            this.emit('flush', pendingFile.path);
        });
        pendingFile.end();
    }
}

module.exports = function (config) {
    if (!config) {
        logger.warn('No GCP/Bigquery configuration present. Skipping Bigquery database.')
        return;
    }

    try {
        if (fs.existsSync(TEMP_FOLDER)) {
            fs.readdirSync(TEMP_FOLDER).forEach(fname => {
                try {
                    const file = TEMP_FOLDER + '/' + fname;
                    logger.debug(`Removing file ${file}`)
                    fs.unlinkSync(file);
                } catch (e) {
                    logger.error(`Error while unlinking file ${fname} - ${e.message}`);
                }
            });
        } else {
            logger.debug(`Creating working dir ${TEMP_FOLDER}`)
            fs.mkdirSync(TEMP_FOLDER, { recursive: true });
        }
    } catch (e) {
        logger.error(`Error while accessing working dir ${TEMP_FOLDER} - ${e.message}`);
    }
    
    const bigquery = new BigQuery();
    const recordBuffer = new RecordBuffer({
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
            .catch(e => {
                if (isProduction) {
                    fs.unlink(filename, () => { });
                } 
                logger.error('Error loading into bigquery', e);
            });
    });
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
            recordBuffer.put(item);
        },
    };
}
