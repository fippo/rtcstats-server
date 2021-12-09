/* eslint-disable no-invalid-this */
const AWS = require('aws-sdk');

const logger = require('../logging');
const PromCollector = require('../metrics/PromCollector');
const { getSQLTimestamp } = require('../utils/utils');

/**
 * Service that sends data to AWS Firehose.
 * Firehose will send data to s3 and then issue a COPY command to redshift.
 */
class FirehoseConnector {

    /**
     *
     * @param {*} param0
     */
    constructor({ region, stream, appEnv }) {
        this._awsRegion = region;
        this._awsFirehoseStream = stream;
        this._appEnv = appEnv;
    }

    /**
     * Initiate connection to firehose stream.
     */
    connect = () => {
        this._firehose = new AWS.Firehose({
            region: this._awsRegion
        });

        logger.info('[Firehose] Successfully connected.');
    };

    /**
     * Send data to the firehose stream.
     * @param {*} param0
     */
    put = ({ dumpInfo, features }) => {

        const { sentiment } = features;

        // The schemaObj needs to match the redshift table schema.
        const schemaObj = { appEnv: this._appEnv,
            statsSessionId: dumpInfo.clientId,
            displayName: dumpInfo.userId,
            createDate: getSQLTimestamp(),
            meetingName: dumpInfo.conferenceId,
            meetingUrl: dumpInfo.conferenceUrl,
            meetingUniqueId: dumpInfo.sessionId,
            endpointId: dumpInfo.endpointId,
            sessionDuration: features.metrics.sessionDurationMs,
            dominantSpeakerChanges: features.dominantSpeakerChanges,
            speakerTime: features.speakerTime,
            sentimentAngry: sentiment.angry,
            sentimentDisgusted: sentiment.disgusted,
            sentimentFearful: sentiment.fearful,
            sentimentHappy: sentiment.happy,
            sentimentNeutral: sentiment.neutral,
            sentimentSad: sentiment.sad,
            sentimentSurprised: sentiment.surprised
        };

        this._firehose.putRecord({
            DeliveryStreamName: this._awsFirehoseStream, /* required */
            Record: {
                Data: JSON.stringify(schemaObj)
            }
        }, err => {
            if (err) {
                logger.error('[Firehose] Error sending data to firehose: %o', err);
                PromCollector.firehoseErrorCount.inc();

                return;
            }
            logger.info('[Firehose] Sent data: %o', schemaObj);
        });
    };
}

module.exports = FirehoseConnector;
