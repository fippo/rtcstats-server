/* eslint-disable */
const sizeof = require('object-sizeof');

const FeatureExtractor = require('../../features/FeatureExtractor');
const logger = require('../../logging');
const { StatsFormat } = require('../../utils/stats-detection');
const { strict: assert } = require('assert');
const fs = require('fs');

// The JSON.stringify spec does not garantee the sort order of the object keys (i.e. different objects with the same
// properties can have different string serialization). This replacer can be used to sort the object keys for a stable
// JSON serialization, even across different objects.
const replacer = (key, val) => val instanceof Object && !(val instanceof Array)
    ? Object.keys(val).sort().reduce((sorted, key) => { sorted[key] = val[key]; return sorted }, {}) : val;

async function simulateConnection(dumpPath, expectedResultPath, statsFormat) {

    const dumpMeta = {
        dumpPath: dumpPath,
        statsFormat: statsFormat
    };

    const featExtractor = new FeatureExtractor(dumpMeta);
    const actualFeatures = await featExtractor.extract();

    const expectedResultString = fs.readFileSync(expectedResultPath);
    const expectedResultList = JSON.parse(expectedResultString);

    const fix = process.argv.filter((x) => x.startsWith('--fix'))[0]
    if (fix) {
        expectedResultList[0].features = actualFeatures;

        fs.writeFile(expectedResultPath, JSON.stringify(expectedResultList, replacer, 2), err => {
            if (err) {
                console.error(err);
            }
        });
    }

    assert.deepStrictEqual(actualFeatures, expectedResultList[0].features);
}

describe('Feature extraction tests', () => {

    test('jvb call with camera/desktop video type successions', async () => {
        await simulateConnection(
            './src/test/dumps/9c93a447-c9f8-489d-87ca-21263dec0642',
            './src/test/jest/results/9c93a447-c9f8-489d-87ca-21263dec0642.json'
        );
    });

    test('p2p call with video type set', async () => {
        await simulateConnection(
            './src/test/dumps/59c86272-03ea-42e9-a62d-1c8a272e8ab0',
            './src/test/jest/results/59c86272-03ea-42e9-a62d-1c8a272e8ab0.json'
        );
    });

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
        );
    });

    test('Undefined ICE candidate from production', async () => {
        await simulateConnection(
            './src/test/dumps/undefined-ice-candidate',
            './src/test/jest/results/undefined-ice-candidate-result.json',
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


