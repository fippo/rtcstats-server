const config = require('config');
const os = require('os');
const util = require('util');
const { createLogger, format, transports } = require('winston');
const { threadId, isMainThread } = require('worker_threads');

require('winston-daily-rotate-file');

if (!config.get('server').logLevel) {
    throw new Error('Please set the logLevel config!');
}

const { json, colorize } = format;
const LEVEL = Symbol.for('level');

/**
 * We use this formatter to get a console.log like logging system
 *
 * @param {Object} logEntry - info object passed by winston
 */
function splatTransform(logEntry) {
    const args = logEntry[Symbol.for('splat')];

    if (args) {
        logEntry.message = util.format(logEntry.message, ...args);
    }

    return logEntry;
}

/**
 * Formatter that adds additional metadata to the log line.
 * @param {Object} logEntry
 */
function metaTransform(logEntry) {
    const customMeta = {
        timestamp: logEntry.timestamp,
        level: logEntry[LEVEL],
        PID: process.pid,
        TID: threadId,
        host: os.hostname()
    };

    return { ...customMeta,
        ...logEntry };
}

// Combine the various custom formatters along with the winston's json to obtain a json like log line.
// This formatter will be used only for file logging as it's json thus more parser friendly in
// case we externalize this somewhere.
const fileLogger = format.combine(
    format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
    format(splatTransform)(),
    format(metaTransform)(),
    json()
);

// Winston rolling file common configuration used for both error and and normal logs file transports.
const logFileCommonCfg = {
    format: fileLogger,
    auditFile: 'logs/app-log-audit.json',
    datePattern: 'YYYY-MM-DD',
    zippedArchive: true,
    maxSize: '100m',
    maxFiles: '60d'
};

// Error logs along with uncaught exceptions will have their own individual files.
// Normal log rolling file transport configuration based on common cfg.
const appLogTransport = new transports.DailyRotateFile({
    ...logFileCommonCfg,
    level: config.get('server').logLevel,
    filename: 'logs/app-%DATE%.log'

    // handleExceptions: false
});

// Error log rolling file transport configuration based on common cfg.
const appErrorLogTransport = new transports.DailyRotateFile({
    ...logFileCommonCfg,
    level: 'error',
    filename: 'logs/app-error-%DATE%.log'

    // handleExceptions: false
});

// Uncaught exception log transport configuration, we remove the custom formatters as it interferes with
// winston's way of logging exceptions.
// Warning! this transports swallows uncaught exceptions, logs and the exits the process with an error,
// uncaught exception handlers might not work.
const appExceptionLogTransportCfg = { ...logFileCommonCfg };

delete appExceptionLogTransportCfg.format;

// Log uncaught exceptions in both error log and normal log in case we need to track some particular flow.
const appExceptionLogTransport = new transports.DailyRotateFile({
    ...appExceptionLogTransportCfg,
    filename: 'logs/app-error-%DATE%.log'
});
const appExceptionCommonLogTransport = new transports.DailyRotateFile({
    ...appExceptionLogTransportCfg,
    filename: 'logs/app-%DATE%.log'
});

// We don't want winston to swallow uncaught exceptions in worker threads, as this will prevent the error event
// from being emitted to the service that manages them.
const handleUncaughtExceptions = isMainThread;
const exceptionHandlers = handleUncaughtExceptions
    ? [ appExceptionLogTransport, appExceptionCommonLogTransport ] : undefined;

// Create actual loggers with specific transports
const logger = createLogger({
    transports: [ appLogTransport, appErrorLogTransport ],
    exceptionHandlers
});

// The JSON format is more suitable for production deployments that use the console.
// The alternative is a single line log format that is easier to read, useful for local development.
if (config.get('server').jsonConsoleLog) {
    logger.add(
            new transports.Console({
                format: fileLogger,
                level: config.get('server').logLevel,
                handleExceptions: handleUncaughtExceptions
            })
    );
} else {
    const consoleLogger = format.combine(
            format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
            colorize(),
            format(splatTransform)(),
            format(metaTransform)(),
            format.printf(
                ({ level, message, timestamp, PID, TID, host }) =>
                    `${timestamp} ${PID} ${TID} ${host} ${level}: ${message}`
            )
    );

    logger.add(
            new transports.Console({
                format: consoleLogger,
                level: config.get('server').logLevel,
                handleExceptions: handleUncaughtExceptions
            })
    );
}

logger.info('Logger successfully initialized.');


module.exports = logger;
