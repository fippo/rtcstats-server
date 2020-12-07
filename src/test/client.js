/* eslint-disable no-multi-str */
const assert = require('assert').strict;
const config = require('config');
const fs = require('fs');
const LineByLine = require('line-by-line');
const WebSocket = require('ws');

const server = require('../app');
const logger = require('../logging');
const { ResponseType } = require('../utils/utils');

let testCheckRouter;

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
    LEGACY: '2',
    STANDARD: '3'
});


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

        appServer.workerPool.on(ResponseType.PROCESSING, body => {
            this.routeProcessingResponse(body);
        });

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
        assert('clientId' in responseBody);
        assert(responseBody.clientId in this.testCheckMap);
    }

    /**
     *
     * @param {*} body
     */
    routeProcessingResponse(body) {
        this.checkResponseFormat(body);
        this.testCheckMap[body.clientId].checkProcessingResponse(body);
    }

    /**
     *
     * @param {*} body
     */
    routeDoneResponse(body) {
        this.checkResponseFormat(body);
        this.testCheckMap[body.clientId].checkDoneResponse(body);
    }

    /**
     *
     * @param {*} body
     */
    routeErrorResponse(body) {
        this.checkResponseFormat(body);
        this.testCheckMap[body.clientId].checkErrorResponse(body);
    }

    /**
     *
     * @param {]} body
     */
    routeMetricsResponse(body) {
        this.checkResponseFormat(body);
        this.testCheckMap[body.clientId].checkMetricsResponse(body);
    }

    /**
     *
     * @param {*} testCheck
     */
    attachTest(testCheck) {
        // Make sure that the test object contains at least the clientId key so we can route results to their
        // appropriate tests.
        assert('clientId' in testCheck);

        this.testCheckMap[testCheck.clientId] = testCheck;
    }
}

/**
 *
 * @param {*} server
 */
function checkTestCompletion(appServer) {
    if (appServer.processed.get().values[0].value === 7) {
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
    const resultObject = JSON.parse(resultString);
    const dumpFile = dumpPath.split('/').filter(Boolean)
                             .pop();

    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; // ignore self-signed cert

    const ws = new WebSocket(`ws://localhost:${config.get('server').port}/${dumpFile}`,
        protocolV,
        {
            headers: {
                'User-Agent': ua,
                'warning': `integration-test/${dumpFile}`
            },
            origin: 'https://localhost'
        });

    ws.on('open', function open() {
        testCheckRouter.attachTest({
            clientId: dumpFile,
            checkDoneResponse: body => {
                logger.info('[TEST] Handling DONE event with body %j', body);
            },
            checkProcessingResponse: body => {
                logger.debug('[TEST] Handling PROCESSING event with clientId %j, features %j', body.clientId, body);
                body.clientId = dumpFile;

                const parsedBody = JSON.parse(JSON.stringify(body));

                assert.deepStrictEqual(parsedBody, resultObject.shift());
            },
            checkErrorResponse: body => {
                logger.info('[TEST] Handling ERROR event with body %j', body);
            },
            checkMetricsResponse: body => {
                logger.info('[TEST] Handling METRICS event with body %j', body);

                // assert.fail(body.extractDurationMs < 400);
            }
        });

        const lr = new LineByLine(dumpPath);

        lr.on('error', err => {
            logger.error('Error reading line: %j', err);
        });

        lr.on('line', line => {
            ws.send(line);
        });

        lr.on('end', () => {
            ws.close();
        });
    });
}

/**
 *
 */
function runTest() {
    testCheckRouter = new TestCheckRouter(server);

    simulateConnection(
        './src/test/dumps/google-legacy-stats-sfu',
        './src/test/results/google-legacy-stats-sfu-result.json',
        BrowserUASamples.CHROME,
        ProtocolV.LEGACY
    );

    simulateConnection(
        './src/test/dumps/google-legacy-stats-p2p',
        './src/test/results/google-legacy-stats-p2p-result.json',
        BrowserUASamples.CHROME,
        ProtocolV.LEGACY
    );

    simulateConnection(
        './src/test/dumps/google-legacy-stats-multiple-pc',
        './src/test/results/google-legacy-stats-multiple-pc-result.json',
        BrowserUASamples.CHROME,
        ProtocolV.LEGACY
    );

    simulateConnection(
        './src/test/dumps/google-standard-stats-p2p',
        './src/test/results/google-standard-stats-p2p-result.json',
        BrowserUASamples.CHROME,
        ProtocolV.STANDARD
    );

    simulateConnection(
        './src/test/dumps/google-standard-stats-sfu',
        './src/test/results/google-standard-stats-sfu-result.json',
        BrowserUASamples.CHROME,
        ProtocolV.STANDARD
    );

    simulateConnection(
        './src/test/dumps/firefox-standard-stats-sfu',
        './src/test/results/firefox-standard-stats-sfu-result.json',
        BrowserUASamples.FIREFOX,
        ProtocolV.STANDARD
    );

    simulateConnection(
        './src/test/dumps/safari-standard-stats',
        './src/test/results/safari-standard-stats-result.json',
        BrowserUASamples.SAFARI,
        ProtocolV.STANDARD
    );
}

setTimeout(runTest, 2000);

checkTestCompletion(server);
