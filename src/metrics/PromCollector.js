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

    firehoseErrorCount: new prom.Counter({
        name: 'rtcstats_firehose_error_count',
        help: 'number of firehose put fails'
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

    requestSizeBytes: new prom.Summary({
        name: 'rtcstats_requests_size_bytes',
        help: 'Summary for inbound request size in bytes',
        maxAgeSeconds: 600,
        ageBuckets: 5,
        percentiles: [ 0.1, 0.25, 0.5, 0.75, 0.9 ]
    }),

    sentimentRequestSizeBytes: new prom.Summary({
        name: 'rtcstats_sentiment_request_size_bytes',
        help: 'Summary for inbound sentiment request size in bytes',
        maxAgeSeconds: 600,
        ageBuckets: 5,
        percentiles: [ 0.1, 0.25, 0.5, 0.75, 0.9 ]
    }),

    statsRequestSizeBytes: new prom.Summary({
        name: 'rtcstats_stats_request_size_bytes',
        help: 'Summary for inbound stats request size in bytes',
        maxAgeSeconds: 600,
        ageBuckets: 5,
        percentiles: [ 0.1, 0.25, 0.5, 0.75, 0.9 ]
    }),

    otherRequestSizeBytes: new prom.Summary({
        name: 'rtcstats_other_request_size_bytes',
        help: 'Summary for inbound other request size in bytes',
        maxAgeSeconds: 600,
        ageBuckets: 5,
        percentiles: [ 0.1, 0.25, 0.5, 0.75, 0.9 ]
    }),

    sdpRequestSizeBytes: new prom.Summary({
        name: 'rtcstats_sdp_request_size_bytes',
        help: 'Summary for inbound sdp request size in bytes',
        maxAgeSeconds: 600,
        ageBuckets: 5,
        percentiles: [ 0.1, 0.25, 0.5, 0.75, 0.9 ]
    }),

    dsRequestSizeBytes: new prom.Summary({
        name: 'rtcstats_ds_request_size_bytes',
        help: 'Summary for inbound dominant speaker request size in bytes',
        maxAgeSeconds: 600,
        ageBuckets: 5,
        percentiles: [ 0.1, 0.25, 0.5, 0.75, 0.9 ]
    }),

    sessionDurationMs: new prom.Summary({
        name: 'rtcstats_session_duration_ms',
        help: 'Summary for session duration in ms',
        maxAgeSeconds: 600,
        ageBuckets: 5,
        percentiles: [ 0.1, 0.25, 0.5, 0.75, 0.9 ]
    }),

    totalProcessedBytes: new prom.Summary({
        name: 'rtcstats_total_processed_bytes',
        help: 'Summary of how many bytes were processed by the feature extractor in bytes',
        maxAgeSeconds: 600,
        ageBuckets: 5,
        percentiles: [ 0.1, 0.25, 0.5, 0.75, 0.9 ]
    }),

    totalProcessedCount: new prom.Summary({
        name: 'rtcstats_total_processed_count',
        help: 'Summary of how many requests were processed by the feature extractor',
        maxAgeSeconds: 600,
        ageBuckets: 5,
        percentiles: [ 0.1, 0.25, 0.5, 0.75, 0.9 ]
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
