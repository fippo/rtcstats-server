/* eslint-disable no-invalid-this */
/* eslint-disable require-jsdoc */
const { EventEmitter } = require('events');
const LineByLine = require('line-by-line');
const uuid = require('uuid');
const WebSocket = require('ws');

require('console-stamp')(console, 'HH:MM:ss.l');

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; // ignore self-signed cert
const chromeUA
    = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_6) AppleWebKit/537.36 (KHTML, like Gecko)'
    + ' Chrome/84.0.4147.30 Safari/537.36';

/**
 *
 * @param {*} minMs
 * @param {*} maxMs
 */
function generateRandom(minMs, maxMs) {
    return Math.floor(Math.random() * (maxMs - minMs)) + minMs;
}

class RtcstatsConnection extends EventEmitter {
    constructor({ id, serverUrl, dumpPath, readDelay = 1000, wsOptions, minCloseMs, maxCloseMs }) {
        super();
        this.id = id;
        this.dumpPath = dumpPath;
        this.serverUrl = serverUrl;
        this.wsOptions = wsOptions;
        this.readDelay = readDelay;
        this.minCloseMs = minCloseMs;
        this.maxCloseMs = maxCloseMs;
        this.statsSessionId = uuid.v4();
    }

    connect() {
        this.startWSOpen = new Date();
        this.ws = new WebSocket(this.serverUrl, this.wsOptions);
        this.ws.on('open', this._open);
        this.ws.on('close', this._close);
        this.ws.on('error', this._error);
    }

    _sendIdentity() {
        const identityData = [
            'identity',
            null,
            {
                sessionId: new Date().getTime(),
                deviceId: uuid.v4(),
                applicationName: 'Load Test',
                confID: `192.168.1.1/conf-${this.statsSessionId}`,
                displayName: `test-${this.statsSessionId}`,
                meetingUniqueId: uuid.v4()
            },
            new Date()
        ];

        const identityRequest = {
            statsSessionId: this.statsSessionId,
            type: 'identity',
            data: identityData
        };

        this._sendRequest(identityRequest);
    }

    _sendStats(data) {
        const statsRequest = {
            statsSessionId: this.statsSessionId,
            type: 'stats-entry',
            data
        };

        this._sendRequest(statsRequest);
    }

    _sendRequest(request) {
        this.ws.send(JSON.stringify(request));
    }

    _open = () => {
        const endWSOpen = new Date() - this.startWSOpen;

        console.log(`Connected ws ${this.id} setup time ${endWSOpen}`);
        this._sendIdentity();

        this.lineReader = new LineByLine(this.dumpPath);

        this.lineReader.on('line', line => {
            // pause emitting of lines...
            this.lineReader.pause();

            setTimeout(() => {
                this._sendStats(line);
                this.lineReader.resume();
            }, this.readDelay);
        });

        this.lineReader.on('error', err => {
            console.log('LineReader error:', err);
        });

        this.lineReader.on('end', () => {
            this.ws.close();
        });
        const timeout = generateRandom(this.minCloseMs, this.maxCloseMs);

        setTimeout(() => {
            console.log(`Finishing rtcstats connection ${this.id} after ${timeout}`);
            this.ws.close();
            this.lineReader.close();
        }, timeout);
    };

    _close = () => {
        const closedAfter = new Date() - this.startWSOpen;

        console.log(`Closed ws ${this.id} in ${closedAfter}`);
        this.emit('finished', { id: this.id });
    };

    _error = e => {
        const errorAfter = new Date() - this.startWSOpen;

        console.log(`Failed ws ${this.id}, error %o in ${errorAfter}`, e);
        this.emit('finished', { id: this.id });
    };
}

const wsOptions = {
    headers: {
        'User-Agent': chromeUA
    },
    origin: 'localhost'
};

const minCloseMs = 20 * 1000;
const maxCloseMs = 40 * 1000;

const rtcstatsWsOptions = {
    id: 0,
    serverUrl: 'wss://localhost:3000/',
    dumpPath: './3bc291e8-852e-46da-bf9d-403e98c6bf3c_test',
    readDelay: 100,
    wsOptions,
    minCloseMs,
    maxCloseMs
};

let requestCount = 0;
const maxRequests = 10000;
const concurrentRequestCount = 150;
const delayBetweenConnectMs = 20;

function initializeRtcstatsConnection() {
    const currentWsOptions = { ...rtcstatsWsOptions };

    currentWsOptions.id = ++requestCount;
    const rtcstatsWs = new RtcstatsConnection(currentWsOptions);

    rtcstatsWs.on('finished', ({ id }) => {
        console.log(`Connection ${id} finished`);
        if (requestCount >= maxRequests) {
            console.log('Max requests reached.');

            return;
        }
        initializeRtcstatsConnection();
    });

    rtcstatsWs.connect();
}

function queueConnections() {

    if (requestCount >= concurrentRequestCount) {
        console.log('Max requests reached.');

        return;
    }

    setTimeout(() => {
        initializeRtcstatsConnection();

        queueConnections();
    }, delayBetweenConnectMs);
}

queueConnections();


