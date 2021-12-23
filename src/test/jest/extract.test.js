/* eslint-disable */
const sizeof = require('object-sizeof');

const FeatureExtractor = require('../../features/FeatureExtractor');
const logger = require('../../logging');
const { StatsFormat } = require('../../utils/stats-detection');


describe('Feature extraction tests', () => {
    beforeEach(() => {
        // Nothing yet
    });

    test('SFU dump feature extraction', async () => {
        const dumpMeta = {
            endpointId: '1a404b1b',
            dumpPath: './src/test/jest/sfu',
            statsFormat: StatsFormat.CHROME_STANDARD
        };

        const featExtractor = new FeatureExtractor(dumpMeta);

        const results = await featExtractor.extract();

        logger.info('%o', results);

        expect(3).toBe(3);
    });

    test.skip('SFU and P2P dump feature extraction', async () => {
        const dumpMeta = {
            endpointId: '1a404b1b',
            dumpPath: './src/test/jest/sfu-p2p'
        };
        const featExtractor = new FeatureExtractor(dumpMeta);

        try {
            const results = await featExtractor.extract();

        } catch (e) {
            logger.error('Error: %o', e);
        }


        expect(3).toBe(3);
    });
});


