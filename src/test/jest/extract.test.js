/* eslint-disable */
const sizeof = require('object-sizeof');

const FeatureExtractor = require('../../features/FeatureExtractor');
const logger = require('../../logging');
const { StatsFormat } = require('../../utils/stats-detection');
const { strict: assert } = require('assert');
const fs = require('fs');

async function simulateConnection(dumpPath, resultPath, statsFormat) {

    const dumpMeta = {
        endpointId: '1a404b1b',
        dumpPath: dumpPath,
        statsFormat: statsFormat
    };

    const featExtractor = new FeatureExtractor(dumpMeta);
    const results = await featExtractor.extract();

    const resultString = fs.readFileSync(resultPath);
    const resultList = JSON.parse(resultString);
    const resultTemplate = resultList.shift();

    assert.deepStrictEqual(results, resultTemplate.features);
}

describe('Feature extraction tests', () => {

    test('Chrome PC reconnect', async () => {
        await simulateConnection(
            './src/test/dumps/chrome-standard-pc-reconnect',
            './src/test/jest/results/chrome-standard-pc-reconnect.json',
            StatsFormat.CHROME_STANDARD
        );
    });

    test('Chrome PC failure', async () => {
        await simulateConnection(
            './src/test/dumps/chrome-standard-pc-failed',
            './src/test/jest/results/chrome-standard-pc-failed.json',
            StatsFormat.CHROME_STANDARD
        );
    });

    test('Undefined ICE candidate from production', async () => {
        await simulateConnection(
            './src/test/dumps/undefined-ice-candidate',
            './src/test/jest/results/undefined-ice-candidate-result.json',
            StatsFormat.CHROME_STANDARD
        );
    });

    test.skip('SFU dump feature extraction', async () => {
        await simulateConnection(
            './src/test/jest/sfu',
            '',
            StatsFormat.CHROME_STANDARD
        );
    });

    test.skip('SFU and P2P dump feature extraction', async () => {
        await simulateConnection(
            './src/test/jest/sfu-p2p',
            '',
            StatsFormat.CHROME_STANDARD
        );
    });

    test('Chrome in a peer-to-peer call', async () => {
        await simulateConnection(
            './src/test/dumps/google-standard-stats-p2p',
            './src/test/jest/results/google-standard-stats-p2p-result.json',
            StatsFormat.CHROME_STANDARD
        );
    });

    test('Chrome 96 in a peer-to-peer call with addTransceiver', async () => {
        await simulateConnection(
            './src/test/dumps/chrome96-standard-stats-p2p-add-transceiver',
            './src/test/jest/results/chrome96-standard-stats-p2p-add-transceiver-result.json',
            StatsFormat.CHROME_STANDARD
        );
    });

    test('Chrome in a multi-party call', async () => {
        await simulateConnection(
            './src/test/dumps/google-standard-stats-sfu',
            './src/test/jest/results/google-standard-stats-sfu-result.json',
            StatsFormat.CHROME_STANDARD
        );
    });

    test('Firefox in a multi-party call', async () => {
        await simulateConnection(
            './src/test/dumps/firefox-standard-stats-sfu',
            './src/test/jest/results/firefox-standard-stats-sfu-result.json',
            StatsFormat.FIREFOX
        );
    });

    test('Firefox 97 in a multi-party call', async () => {
        await simulateConnection(
            './src/test/dumps/firefox97-standard-stats-sfu',
            './src/test/jest/results/firefox97-standard-stats-sfu-result.json',
            StatsFormat.FIREFOX
        );
    });

    test('Safari in a peer-to-peer call', async () => {
        await simulateConnection(
            './src/test/dumps/safari-standard-stats',
            './src/test/jest/results/safari-standard-stats-result.json',
            StatsFormat.SAFARI
        );
    });

    test('Chrome multiple peer-to-peer connections', async () => {
        await simulateConnection(
            './src/test/dumps/chrome-standard-multiple-p2p',
            './src/test/jest/results/chrome-standard-multiple-p2p.json',
            StatsFormat.CHROME_STANDARD
        );
    });
});


