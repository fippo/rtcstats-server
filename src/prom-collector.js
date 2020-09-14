// Initialize prometheus metrics.
const getFolderSize = require('get-folder-size');
const prom = require('prom-client');

const logger = require('./logging');

const connected = new prom.Gauge({
    name: 'rtcstats_websocket_connections',
    help: 'number of open websocket connections',
});

const connection_error = new prom.Counter({
    name: 'rtcstats_websocket_connection_error',
    help: 'number of open websocket connections that failed with an error',
});

const queuedDumps = new prom.Counter({
    name: 'rtcstats_queued_dumps',
    help: 'Number of rtcstats dumps queued up for future processing',
});

const queueSize = new prom.Gauge({
    name: 'rtcstats_queue_size',
    help: 'Number of dumps currently queued for processing',
});

const diskQueueSize = new prom.Gauge({
    name: 'rtcstats_disk_queue_size',
    help: 'Size occupied on disk by queued dumps',
});

const processed = new prom.Counter({
    name: 'rtcstats_files_processed',
    help: 'number of files processed',
});

const errored = new prom.Counter({
    name: 'rtcstats_files_errored',
    help: 'number of files with errors during processing',
});

const processTime = new prom.Summary({
    name: 'rtcstats_processing_time',
    help: 'Processing time for a request',
    maxAgeSeconds: 600,
    ageBuckets: 5,
    percentiles: [0.1, 0.25, 0.5, 0.75, 0.9],

});

const dumpSize = new prom.Summary({
    name: 'rtcstats_dump_size',
    help: 'Size of processed rtcstats dumps',
    maxAgeSeconds: 600,
    ageBuckets: 5,
    percentiles: [0.1, 0.25, 0.5, 0.75, 0.9],
});

setInterval(() => {
    getFolderSize('temp', (err, size) => {
        if (err) {
            logger.error('Could not get disk queue dir size %j', err);
            return;
        }
        diskQueueSize.set(size);
    });
},10000);

module.exports = {
    connected,
    connection_error,
    diskQueueSize,
    dumpSize,
    errored,
    processed,
    processTime,
    prom,
    queuedDumps,
    queueSize
}