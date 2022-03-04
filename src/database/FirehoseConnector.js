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
    constructor({ region, meetingStatsStream, pcStatsStream, trackStatsStream, appEnv }) {
        this._awsRegion = region;
        this._meetingStatsStream = meetingStatsStream;
        this._pcStatsStream = pcStatsStream;
        this._trackStatsStream = trackStatsStream;
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

    _putTrackRecord = (track, dir, id, p2p) => {
        const {
            mediaType,
            packets,
            packetsLost,
            packetsLostPct,
            packetsLostVariance
        } = track;

        const trackSchemaObj = {
            statsSessionId: id,
            isP2P: p2p,
            direction: dir,
            mediaType,
            packets,
            packetsLost,
            packetsLostPct,
            packetsLostVariance
        };

        this._putRecord(trackSchemaObj, this._trackStatsStream);
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
            deploymentInfo: {
                crossRegion,
                environment,
                region,
                releaseNumber,
                shard,
                userRegion
            },
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
            crossRegion,
            environment,
            region,
            releaseNumber,
            shard,
            userRegion,
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
                usesRelay,
                trackAggregates: {
                    receivedPacketsLostPct,
                    sentPacketsLostPct,
                    totalPacketsReceived,
                    totalPacketsSent,
                    totalReceivedPacketsLost,
                    totalSentPacketsLost
                },
                tracks: {
                    receiverTracks,
                    senderTracks
                },
                transportAggregates: { meanRtt },
                inboundVideoExperience: {
                    upperBoundAggregates,
                    lowerBoundAggregates
                }
            } = aggregates[pc];

            // TODO make sure that values missing won't break stuff and simply insert a null

            const aggregateSchemaObj = {
                statsSessionId,
                dtlsErrors,
                dtlsFailure,
                isP2P,
                usesRelay,
                receivedPacketsLostPct,
                sentPacketsLostPct,
                totalPacketsReceived,
                totalPacketsSent,
                totalReceivedPacketsLost,
                totalSentPacketsLost,
                meanRtt,
                meanUpperBoundFrameHeight: upperBoundAggregates.meanFrameHeight,
                meanUpperBoundFramesPerSecond: upperBoundAggregates.meanFramesPerSecond,
                meanLowerBoundFrameHeight: lowerBoundAggregates.meanFrameHeight,
                meanLowerBoundFramesPerSecond: lowerBoundAggregates.meanFramesPerSecond
            };

            this._putRecord(aggregateSchemaObj, this._pcStatsStream);

            Object.keys(receiverTracks).forEach(rtrack => {
                this._putTrackRecord(receiverTracks[rtrack], 'received', statsSessionId, isP2P);
            });

            Object.keys(senderTracks).forEach(strack => {
                this._putTrackRecord(senderTracks[strack], 'send', statsSessionId, isP2P);
            });
        });
    };
}

module.exports = FirehoseConnector;
