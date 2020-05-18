const util = require('util');
const os = require('os');
const config = require('config');
const { threadId } = require('worker_threads');

const { createLogger, format, transports } = require('winston');
require('winston-daily-rotate-file');

const { isProduction } = require('./utils');

if (!config.get('server').logLevel) {
    throw new Error('Please set the logLevel config!');
}

const { json, colorize } = format;
const LEVEL = Symbol.for('level');

function splatTransform(info) {
    const args = info[Symbol.for('splat')];

    if (args) {
        info.message = util.format(info.message, ...args);
    }
    return info;
}

function metaTransform(logEntry) {
    const customMeta = {
        timestamp: logEntry.timestamp,
        level: logEntry[LEVEL],
        PID: process.pid,
        TID: threadId,
        host: os.hostname(),
    };

    logEntry = { ...customMeta, ...logEntry };
    return logEntry;
}

const fileLogger = format.combine(
    format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
    format(splatTransform)(),
    format(metaTransform)(),
    json()
);

const logFileCommonCfg = {
    format: fileLogger,
    auditFile: 'logs/app-log-audit.json',
    datePattern: 'YYYY-MM-DD',
    zippedArchive: true,
    maxSize: '100m',
    maxFiles: '90d',
};

const appLogTransport = new transports.DailyRotateFile({
    ...logFileCommonCfg,
    level: config.get('server').logLevel,
    filename: 'logs/app-%DATE%.log',
});

const appErrorLogTransport = new transports.DailyRotateFile({
    ...logFileCommonCfg,
    level: 'error',
    filename: 'logs/app-error-%DATE%.log',
});

const appExceptionLogTransportCfg = { ...logFileCommonCfg };
delete appExceptionLogTransportCfg.format;

const appExceptionLogTransport = new transports.DailyRotateFile({
    ...appExceptionLogTransportCfg,
    filename: 'logs/app-error-%DATE%.log',
});

const logger = createLogger({
    transports: [appLogTransport, appErrorLogTransport],
    exceptionHandlers: [appExceptionLogTransport],
});

if (!isProduction()) {

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
    // If we're not in production then also log to the `console`
    logger.add(
        new transports.Console({
            format: consoleLogger,
            level: config.get('server').logLevel,
            prettyPrint: true,
            handleExceptions: true,
        })
    );
}

logger.info('Logger successfully initialized.');

module.exports = logger;
