const assert = require('assert').strict;
var WebSocket = require('ws');
var fs = require('fs');
var config = require('config');

const LineByLine = require('line-by-line');

var server = require('../app');
const logger = require('../logging');
const { ResponseType } = require('../utils/utils');
class TestCheckRouter {
    constructor(server) {
        this.testCheckMap = {};

        server.workerPool.on(ResponseType.PROCESSING, (body) => {
            this.routeProcessingResponse(body);
        });

        server.workerPool.on(ResponseType.DONE, (body) => {
            this.routeDoneResponse(body);
        });

        server.workerPool.on(ResponseType.METRICS, (body) => {
            this.routeMetricsResponse(body);
        });

        server.workerPool.on(ResponseType.ERROR, (body) => {
            this.routeErrorResponse(body);
        });
    }

    checkResponseFormat(responseBody) {
        assert('clientId' in responseBody);
        assert(responseBody.clientId in this.testCheckMap);
    }

    routeProcessingResponse(body) {
        this.checkResponseFormat(body);
        this.testCheckMap[body.clientId].checkProcessingResponse(body);
    }

    routeDoneResponse(body) {
        this.checkResponseFormat(body);
        this.testCheckMap[body.clientId].checkDoneResponse(body);
    }

    routeErrorResponse(body) {
        this.checkResponseFormat(body);
        this.testCheckMap[body.clientId].checkErrorResponse(body);
    }

    routeMetricsResponse(body) {
        this.checkResponseFormat(body);
        this.testCheckMap[body.clientId].checkMetricsResponse(body);
    }

    attachTest(testCheck) {
        // Make sure that the test object contains at least the clientId key so we can route results to their
        // appropriate tests.
        assert('clientId' in testCheck);

        this.testCheckMap[testCheck.clientId] = testCheck;
    }
}

function checkTestCompletion(server) {
    if (server.processed.get().values[0].value === 2) {
        server.stop();
    } else {
        setTimeout(checkTestCompletion, 4000, server);
    }
}

function simulateConnection(dumpPath,resultPath) {
    let resultString = fs.readFileSync(resultPath);
    let resultObject = JSON.parse(resultString);
    let dumpFile = dumpPath.split('/').filter(Boolean).pop();

    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; // ignore self-signed cert

    let ws = new WebSocket('ws://localhost:' + config.get('server').port + '/' + dumpFile, {
        headers: {
            'User-Agent': 'integration-test/' + dumpFile,
        },
        origin: 'https://localhost',
    });

    ws.on('open', function open() {
        testCheckRouter.attachTest({
            clientId: dumpFile,
            checkDoneResponse: (body) => {
                logger.info('[TEST] Handling DONE event with body %j', body);
            },
            checkProcessingResponse: (body) => {
                logger.info('[TEST] Handling PROCESSING event with body %j', body);
                body.clientId = dumpFile;
                const parsedBody = JSON.parse(JSON.stringify(body));
                //assert.deepStrictEqual(parsedBody, resultObject);
            },
            checkErrorResponse: (body) => {
                logger.info('[TEST] Handling ERROR event with body %j', body);
            },
            checkMetricsResponse: (body) => {
                logger.info('[TEST] Handling METRICS event with body %j', body);
                //assert.fail(body.extractDurationMs < 400);
            },
        });

        let lr = new LineByLine(dumpPath);

        lr.on('error', function (err) {
            logger.error('Error reading line: %j', err);
        });

        lr.on('line', function (line) {
            ws.send(line);
        });

        lr.on('end', function () {
            ws.close();
        });
    });
}

var testCheckRouter = undefined;

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
}

setTimeout(runTest, 2000);

checkTestCompletion(server);
