const config = require('config');
const dynamoose = require('dynamoose');

const logger = require('../logging');
const PromCollector = require('../metrics/PromCollector');

// Set region to avoid aws config error
dynamoose.aws.sdk.config.update({
    region: config.s3.region
});

// Used for working with local data
// Requires a local DynamoDB instance running
if (config.dynamo.endpoint) {
    logger.info('[Dynamo] Using local dynamo instance');
    dynamoose.aws.ddb.local(config.dynamo.endpoint);
}

const Document = dynamoose.model(
    config.dynamo.tableName,
    {
        conferenceId: String,
        conferenceUrl: String,
        dumpId: String,
        baseDumpId: String,
        userId: String,
        app: String,
        sessionId: String,
        startDate: Number,
        endDate: Number
    },
    { create: false }
);


const getDumpId = ({ clientId }) => `${clientId}.gz`;

/**
 *
 * @param {*} data
 */
async function saveEntry(data) {
    try {
        const { conferenceId = 'undefined',
            conferenceUrl = 'undefined',
            userId = 'undefined',
            app = 'undefined',
            baseDumpId,
            sessionId,
            startDate,
            endDate
        } = data;

        const entry = { dumpId: getDumpId(data),
            conferenceId: conferenceId.toLowerCase(),
            conferenceUrl: conferenceUrl.toLowerCase(),
            userId,
            baseDumpId,
            app,
            sessionId,
            startDate,
            endDate
        };

        const document = new Document(entry);

        // overwrite: false will returns an exception in case the entry already exists
        await document.save({ overwrite: false });
        logger.info('[Dynamo] Saved metadata %o', entry);

        return true;
    } catch (error) {
        // Dynamo returns this error code in case there is a duplicate entry
        if (error.code === 'ConditionalCheckFailedException') {
            logger.warn('[Dynamo] duplicate entry: %o; error: %o', data, error);

            return false;
        }

        PromCollector.dynamoErrorCount.inc();

        logger.error('[Dynamo] Error saving metadata %o, %o', data, error);

        // we don't want any exception leaving the boundaries of the dynamo client. At this point
        // just logging them will suffice, although it would be healthier for whoever is using this client
        // to make that decision.
        return true;
    }
}

/**
 *
 * @param {*} data
 */
async function saveEntryAssureUnique({ ...data }) {
    if (!config.dynamo.tableName) {
        return;
    }

    const { clientId } = data;
    const [ baseClientId, order ] = clientId.split('_');

    data.baseDumpId = baseClientId;

    let saveSuccessful = false;
    let clientIdIncrement = Number(order) || 0;

    while (!saveSuccessful) {
        saveSuccessful = await saveEntry(data);

        if (!saveSuccessful) {
            logger.warn('[Dynamo] duplicate cliendId %s, incrementing reconnect count', data.clientId);
            data.clientId = `${baseClientId}_${++clientIdIncrement}`;
        }
    }

    return data.clientId;
}

module.exports = {
    saveEntryAssureUnique
};
