const assert = require('assert').strict;
const config = require('config');
const fs = require('fs');
const LineByLine = require('line-by-line');
const WebSocket = require('ws');

const server = require('../app');
const logger = require('../logging');
const { ResponseType } = require('../utils/utils');

let testCheckRouter;

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
    if (appServer.processed.get().values[0].value === 4) {
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
function simulateConnection(dumpPath, resultPath) {
    const resultString = fs.readFileSync(resultPath);
    const resultObject = JSON.parse(resultString);
    const dumpFile = dumpPath.split('/').filter(Boolean)
                             .pop();

    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; // ignore self-signed cert

    const ws = new WebSocket(`ws://localhost:${config.get('server').port}/${dumpFile}`, {
        headers: {
            'User-Agent': `integration-test/${dumpFile}`
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
                logger.info('[TEST] Handling PROCESSING event with body %j', body);
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
        './src/test/dumps/3bc291e8-852e-46da-bf9d-403e98c6bf3c',
        './src/test/results/3bc291e8-852e-46da-bf9d-403e98c6bf3c-result.json'
    );
    simulateConnection(
        './src/test/dumps/24a93962-f981-43b4-8501-48e43f91a4e0',
        './src/test/results/24a93962-f981-43b4-8501-48e43f91a4e0-result.json'
    );
    simulateConnection(
        './src/test/dumps/130a38c4-2f8f-4bfa-a168-38825f4dedf8',
        './src/test/results/130a38c4-2f8f-4bfa-a168-38825f4dedf8-result.json'
    );
    simulateConnection(
        './src/test/dumps/0bad2cf1-c644-46bb-8c18-d454ce8a3f4a',
        './src/test/results/0bad2cf1-c644-46bb-8c18-d454ce8a3f4a-result.json'
    );
}

setTimeout(runTest, 2000);

checkTestCompletion(server);
