const winston = require('winston');

const { DEBUG } = process.env;

const { combine, splat, timestamp, json } = winston.format;

const addSeverity = winston.format(logEntry => {
    return { severity: logEntry.level.toUpperCase(), ...logEntry };
});

const loggerOptions = {
    level: DEBUG ? 'debug' : 'info',
    format: combine(timestamp(), splat(), addSeverity(), json()),
    transports: [new winston.transports.Console()],
};

const logger = winston.createLogger(loggerOptions);

module.exports = logger;
