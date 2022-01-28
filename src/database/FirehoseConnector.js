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
    constructor({ region, meetingStatsStream, pcStatsStream, appEnv }) {
        this._awsRegion = region;
        this._meetingStatsStream = meetingStatsStream;
        this._pcStatsStream = pcStatsStream;
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

    _putRecord = (schemaObj, stream) => {
        this._firehose.putRecord(
            {
                DeliveryStreamName: stream /* required */,
                Record: {
                    Data: JSON.stringify(schemaObj)
                }
            },
            err => {
                if (err) {
                    logger.error('[Firehose] Error sending data to firehose: %o', err);
                    PromCollector.firehoseErrorCount.inc();

                    return;
                }
                logger.info('[Firehose] Sent data: %o', schemaObj);
            }
        );
    };

    /**
     * Send data to the firehose stream.
     * @param {*} param0
     */
    put = ({ dumpInfo, features }) => {
        const {
            clientId: statsSessionId,
            userId: displayName,
            conferenceId: meetingName,
            conferenceUrl: meetingUrl,
            sessionId: meetingUniqueId,
            endpointId
        } = dumpInfo;

        const {
            aggregates = {},
            metrics: { sessionDurationMs: sessionDuration },
            dominantSpeakerChanges,
            speakerTime,
            sentiment: {
                angry: sentimentAngry,
                disgusted: sentimentDisgusted,
                fearful: sentimentFearful,
                happy: sentimentHappy,
                neutral: sentimentNeutral,
                sad: sentimentSad,
                surprised: sentimentSurprised
            }
        } = features;

        // The schemaObj needs to match the redshift table schema.
        const schemaObj = {
            appEnv: this._appEnv,
            createDate: getSQLTimestamp(),
            statsSessionId,
            displayName,
            meetingName,
            meetingUrl,
            meetingUniqueId,
            endpointId,
            sessionDuration,
            dominantSpeakerChanges,
            speakerTime,
            sentimentAngry,
            sentimentDisgusted,
            sentimentFearful,
            sentimentHappy,
            sentimentNeutral,
            sentimentSad,
            sentimentSurprised
        };

        this._putRecord(schemaObj, this._meetingStatsStream);

        Object.keys(aggregates).forEach(pc => {
            const {
                dtlsErrors,
                dtlsFailure,
                isP2P,
                trackAggregates: {
                    receivedPacketsLostPct,
                    sentPacketsLostPct,
                    totalPacketsReceived,
                    totalPacketsSent,
                    totalReceivedPacketsLost,
                    totalSentPacketsLost
                },
                transportAggregates: { meanRtt }
            } = aggregates[pc];

            const aggregateSchemaObj = {
                statsSessionId,
                dtlsErrors,
                dtlsFailure,
                isP2P,
                receivedPacketsLostPct,
                sentPacketsLostPct,
                totalPacketsReceived,
                totalPacketsSent,
                totalReceivedPacketsLost,
                totalSentPacketsLost,
                meanRtt
            };

            this._putRecord(aggregateSchemaObj, this._pcStatsStream);
        });
    };
}

module.exports = FirehoseConnector;
