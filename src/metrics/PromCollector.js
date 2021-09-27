// Initialize prometheus metrics.
const getFolderSize = require('get-folder-size');
const prom = require('prom-client');

const logger = require('../logging');

const PromCollector = {
    connected: new prom.Gauge({
        name: 'rtcstats_websocket_connections',
        help: 'number of open websocket connections'
    }),

    connectionError: new prom.Counter({
        name: 'rtcstats_websocket_connection_error',
        help: 'number of open websocket connections that failed with an error'
    }),

    diskQueueSize: new prom.Gauge({
        name: 'rtcstats_disk_queue_size',
        help: 'Size occupied on disk by queued dumps'
    }),

    dumpSize: new prom.Summary({
        name: 'rtcstats_dump_size',
        help: 'Size of processed rtcstats dumps',
        maxAgeSeconds: 600,
        ageBuckets: 5,
        percentiles: [ 0.1, 0.25, 0.5, 0.75, 0.9 ]
    }),

    dynamoErrorCount: new prom.Counter({
        name: 'rtcstats_dynamo_error_count',
        help: 'number of dynamo inserts failed'
    }),

    processErrorCount: new prom.Counter({
        name: 'rtcstats_process_error_count',
        help: 'number of files with errors during processing'
    }),

    processed: new prom.Counter({
        name: 'rtcstats_files_processed',
        help: 'number of files processed'
    }),

    processTime: new prom.Summary({
        name: 'rtcstats_processing_time',
        help: 'Processing time for a request',
        maxAgeSeconds: 600,
        ageBuckets: 5,
        percentiles: [ 0.1, 0.25, 0.5, 0.75, 0.9 ]

    }),

    queuedDumps: new prom.Counter({
        name: 'rtcstats_queued_dumps',
        help: 'Number of rtcstats dumps queued up for future processing'
    }),

    queueSize: new prom.Gauge({
        name: 'rtcstats_queue_size',
        help: 'Number of dumps currently queued for processing'
    }),

    rejectedPromiseCount: new prom.Counter({
        name: 'rtcstats_rejected_promise_count',
        help: 'app wide rejected promise count'
    }),

    sessionCount: new prom.Counter({
        name: 'rtcstats_session_count',
        help: 'number of total sessions received over the websocket endpoint'
    }),

    sessionErrorCount: new prom.Counter({
        name: 'rtcstats_session_error_count',
        help: 'number of total sessions that failed for various reasons'
    }),

    storageErrorCount: new prom.Counter({
        name: 'rtcstats_storage_error_count',
        help: 'number of failed dump storage attempts'
    }),

    metrics: () => prom.register.metrics(),

    collectDefaultMetrics: () => prom.collectDefaultMetrics(),

    getPromContentType: () => prom.contentType

};

setInterval(() => {
    getFolderSize('temp', (err, size) => {
        if (err) {
            logger.debug('Could not get disk queue dir size %o', err);

            return;
        }
        PromCollector.diskQueueSize.set(size);
    });
}, 10000);

module.exports = PromCollector;
