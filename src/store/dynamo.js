const config = require('config');
const dynamoose = require('dynamoose');

const logger = require('../logging');

if (!config.dynamo.tableName) {
    return;
}

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
        dumpId: String,
        userId: String,
        app: String,
        startDate: Number,
        endDate: Number
    },
    { create: false },
);

const formatConferenceId = ({ conferenceId }) => {
    const fullUrl = conferenceId.startsWith('http') ? conferenceId : `http://${conferenceId}`;

    return new URL(fullUrl)
      .pathname
      .slice(1)
      .toLowerCase();
};

const getDumpId = ({ clientId }) => `${clientId}.gz`;


const saveEntry = async data => {
    const entry = Object.assign(data, {
        conferenceId: formatConferenceId(data),
        dumpId: getDumpId(data)
    });

    const document = new Document(entry);

    try {
        await document.save();
        logger.info('[Dynamo] Saved metadata %j', entry);
    } catch (error) {
        console.error('[Dynamo] Error saving metadata %j', entry);
    }
};

module.exports = {
    saveEntry
};
