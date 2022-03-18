/* eslint-disable no-invalid-this */
/* eslint-disable no-multi-str */
const assert = require('assert').strict;
const { EventEmitter } = require('events');
const fs = require('fs');
const LineByLine = require('line-by-line');
const WebSocket = require('ws');


const server = require('../app');
const logger = require('../logging');
const { uuidV4, ResponseType } = require('../utils/utils');

let testCheckRouter;

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; // ignore self-signed cert

const BrowserUASamples = Object.freeze({
    CHROME:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_6) AppleWebKit/537.36 (KHTML, like Gecko)'
        + ' Chrome/87.0.4280.27 Safari/537.36',
    FIREFOX: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:83.0) Gecko/20100101 Firefox/83.0',
    SAFARI:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_6) AppleWebKit/605.1.15 (KHTML, like Gecko)'
        + ' Version/14.0 Safari/605.1.15'
});

const ProtocolV = Object.freeze({
    LEGACY: '3_LEGACY',
    STANDARD: '3_STANDARD'
});

/**
 *
 */
class RtcstatsConnection extends EventEmitter {
    /**
     *
     * @param {*} param0
     */
    constructor({ id, serverUrl, dumpPath, readDelay = 1000, wsOptions, protocolV }) {
        super();
        this.id = id;
        this.dumpPath = dumpPath;
        this.serverUrl = serverUrl;
        this.wsOptions = wsOptions;
        this.readDelay = readDelay;
        this.protocolV = protocolV;
        this.statsSessionId = uuidV4();

        this._createIdentityData();
    }

    /**
     *
     */
    getStatsSessionId() {
        return this.statsSessionId;
    }

    /**
     *
     */
    getIdentityData() {
        return this.identityData;
    }

    /**
     *
     */
    connect() {
        this.startWSOpen = new Date();
        this.ws = new WebSocket(this.serverUrl, this.protocolV, this.wsOptions);
        this.ws.on('open', this._open);
        this.ws.on('close', this._close);
        this.ws.on('error', this._error);
    }

    /**
     *
     */
    _createIdentityData() {
        this.identityData = {
            sessionId: new Date().getTime(),
            deviceId: uuidV4(),
            applicationName: 'Integration Test',
            confID: `192.168.1.1/conf-${this.statsSessionId}`,
            displayName: `test-${this.statsSessionId}`,
            meetingUniqueId: uuidV4()
        };
    }

    /**
     *
     */
    _sendIdentity() {
        const identity = [
            'identity',
            null,
            this.identityData,
            new Date()
        ];

        const identityRequest = {
            statsSessionId: this.statsSessionId,
            type: 'identity',
            data: identity
        };

        this._sendRequest(identityRequest);
    }

    /**
     *
     * @param {*} data
     */
    _sendStats(data) {
        const statsRequest = {
            statsSessionId: this.statsSessionId,
            type: 'stats-entry',
            data
        };

        this._sendRequest(statsRequest);
    }

    /**
     *
     * @param {*} request
     */
    _sendRequest(request) {
        this.ws.send(JSON.stringify(request));
    }

    /**
     *
     */
    _open = () => {
        const endWSOpen = new Date() - this.startWSOpen;

        logger.info(`Connected ws ${this.id} setup time ${endWSOpen}`);

        this._sendIdentity();

        this.lineReader = new LineByLine(this.dumpPath);

        this.lineReader.on('line', line => {
            this._sendStats(line);
        });

        this.lineReader.on('end', () => {
            this.ws.close();
        });
        this.lineReader.on('error', err => {

            logger.error('LineReader error:', err);
        });
    };

    _close = () => {
        const closedAfter = new Date() - this.startWSOpen;

        logger.info(`Closed ws ${this.id} in ${closedAfter}`);
        this.emit('finished', { id: this.id });
    };

    _error = e => {
        const errorAfter = new Date() - this.startWSOpen;

        logger.info(`Failed ws ${this.id}, error %o in ${errorAfter}`, e);
        this.emit('finished', { id: this.id });
    };
}


/**
 *
 */
class TestCheckRouter {
    /**
     *
     * @param {*} appServer
     */
    constructor(appServer) {
        this.testCheckMap = {};

        appServer.workerPool.on(ResponseType.DONE, body => {
            this.routeDoneResponse(body);
        });

        appServer.workerPool.on(ResponseType.METRICS, body => {
            this.routeMetricsResponse(body);
        });

        appServer.workerPool.on(ResponseType.ERROR, body => {
            this.routeErrorResponse(body);
        });
    }

    /**
     *
     * @param {*} responseBody
     */
    checkResponseFormat(responseBody) {
        assert('clientId' in responseBody.dumpInfo);
        assert(responseBody.dumpInfo.clientId in this.testCheckMap);
    }

    /**
     *
     * @param {*} body
     */
    routeDoneResponse(body) {
        this.checkResponseFormat(body);
        this.testCheckMap[body.dumpInfo.clientId].checkDoneResponse(body);
    }

    /**
     *
     * @param {*} body
     */
    routeErrorResponse(body) {
        this.checkResponseFormat(body);
        this.testCheckMap[body.dumpInfo.clientId].checkErrorResponse(body);
    }

    /**
     *
     * @param {]} body
     */
    routeMetricsResponse(body) {
        this.checkResponseFormat(body);
        this.testCheckMap[body.dumpInfo.clientId].checkMetricsResponse(body);
    }

    /**
     *
     * @param {*} testCheck
     */
    attachTest(testCheck) {
        // Make sure that the test object contains at least the statsSessionId key so we can route results to their
        // appropriate tests.
        assert('statsSessionId' in testCheck);

        this.testCheckMap[testCheck.statsSessionId] = testCheck;
    }
}

/**
 *
 * @param {*} server
 */
function checkTestCompletion(appServer) {
    if (appServer.PromCollector.processed.get().values[0].value === 6) {
        appServer.stop();
    } else {
        setTimeout(checkTestCompletion, 4000, appServer);
    }
}

/**
 *
 * @param {*} dumpPath
 * @param {*} resultPath
 */
function simulateConnection(dumpPath, resultPath, ua, protocolV) {
    const resultString = fs.readFileSync(resultPath);
    const resultList = JSON.parse(resultString);

    const wsOptions = {
        headers: {
            'User-Agent': ua
        },
        origin: 'localhost'
    };

    const rtcstatsWsOptions = {
        id: dumpPath,
        serverUrl: 'ws://localhost:3000/',
        dumpPath,
        readDelay: 1,
        wsOptions,
        protocolV
    };

    const connection = new RtcstatsConnection(rtcstatsWsOptions);
    const statsSessionId = connection.getStatsSessionId();
    const identityData = connection.getIdentityData();


    testCheckRouter.attachTest({
        statsSessionId,
        checkDoneResponse: body => {
            logger.info('[TEST] Handling DONE event with statsSessionId %j, body %j',
              body.dumpInfo.clientId, body);

            const parsedBody = JSON.parse(JSON.stringify(body));
            const resultTemplate = resultList.shift();

            resultTemplate.dumpInfo.clientId = statsSessionId;
            resultTemplate.dumpInfo.userId = identityData.displayName;
            resultTemplate.dumpInfo.app = identityData.applicationName;
            resultTemplate.dumpInfo.sessionId = identityData.meetingUniqueId;
            resultTemplate.dumpInfo.ampDeviceId = identityData.deviceId;
            resultTemplate.dumpInfo.ampSessionId = identityData.sessionId;
            resultTemplate.dumpInfo.conferenceUrl = identityData.confID;

            resultTemplate.dumpInfo.startDate = body.dumpInfo.startDate;
            resultTemplate.dumpInfo.endDate = body.dumpInfo.endDate;
            resultTemplate.dumpInfo.dumpPath = body.dumpInfo.dumpPath;

            // The size of the dump changes with every iteration as the application will add an additional
            // 'connectionInfo' entry, thus metrics won't match.
            delete parsedBody.features?.metrics;
            delete resultTemplate.features?.metrics;

            assert.deepStrictEqual(parsedBody, resultTemplate);
        },
        checkErrorResponse: body => {
            logger.info('[TEST] Handling ERROR event with body %o', body);
            throw Error(`[TEST] Processing failed with: ${JSON.stringify(body)}`);
        },
        checkMetricsResponse: body => {
            logger.info('[TEST] Handling METRICS event with body %j', body);

            // assert.fail(body.extractDurationMs < 400);
        }
    });

    connection.connect();
}

/**
 *
 */
function runTest() {
    testCheckRouter = new TestCheckRouter(server);

    // Chrome legacy stats have been disabled for time being.

    // simulateConnection(
    //     './src/test/dumps/google-legacy-screenshare-p2p',
    //     './src/test/results/google-legacy-screenshare-p2p-result.json',
    //     BrowserUASamples.CHROME,
    //     ProtocolV.LEGACY
    // );

    // simulateConnection(
    //     './src/test/dumps/google-legacy-screenshare-msessions',
    //     './src/test/results/google-legacy-screenshare-msessions-result.json',
    //     BrowserUASamples.CHROME,
    //     ProtocolV.LEGACY
    // );

    // simulateConnection(
    //     './src/test/dumps/google-legacy-stats-sfu',
    //     './src/test/results/google-legacy-stats-sfu-result.json',
    //     BrowserUASamples.CHROME,
    //     ProtocolV.LEGACY
    // );

    // simulateConnection(
    //     './src/test/dumps/google-legacy-stats-p2p',
    //     './src/test/results/google-legacy-stats-p2p-result.json',
    //     BrowserUASamples.CHROME,
    //     ProtocolV.LEGACY
    // );

    // simulateConnection(
    //     './src/test/dumps/google-legacy-stats-multiple-pc',
    //     './src/test/results/google-legacy-stats-multiple-pc-result.json',
    //     BrowserUASamples.CHROME,
    //     ProtocolV.LEGACY
    // );

    simulateConnection(
        './src/test/dumps/google-standard-stats-p2p',
        './src/test/jest/results/google-standard-stats-p2p-result.json',
        BrowserUASamples.CHROME,
        ProtocolV.STANDARD
    );

    simulateConnection(
        './src/test/dumps/google-standard-stats-sfu',
        './src/test/jest/results/google-standard-stats-sfu-result.json',
        BrowserUASamples.CHROME,
        ProtocolV.STANDARD
    );

    simulateConnection(
        './src/test/dumps/firefox-standard-stats-sfu',
        './src/test/jest/results/firefox-standard-stats-sfu-result.json',
        BrowserUASamples.FIREFOX,
        ProtocolV.STANDARD
    );

    simulateConnection(
        './src/test/dumps/firefox97-standard-stats-sfu',
        './src/test/jest/results/firefox97-standard-stats-sfu-result.json',
        BrowserUASamples.FIREFOX,
        ProtocolV.STANDARD
    );

    simulateConnection(
        './src/test/dumps/safari-standard-stats',
        './src/test/jest/results/safari-standard-stats-result.json',
        BrowserUASamples.SAFARI,
        ProtocolV.STANDARD
    );

    simulateConnection(
        './src/test/dumps/chrome96-standard-stats-p2p-add-transceiver',
        './src/test/jest/results/chrome96-standard-stats-p2p-add-transceiver-result.json',
        BrowserUASamples.CHROME,
        ProtocolV.STANDARD
    );
}

setTimeout(runTest, 2000);

checkTestCompletion(server);
