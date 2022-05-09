/* eslint-disable no-invalid-this */
const AWS = require('aws-sdk');
const uuid = require('uuid');

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
    constructor({
        region,
        meetingStatsStream,
        pcStatsStream,
        trackStatsStream,
        e2ePingStream,
        faceExpressionStream,
        appEnv
    }) {
        this._awsRegion = region;
        this._meetingStatsStream = meetingStatsStream;
        this._pcStatsStream = pcStatsStream;
        this._trackStatsStream = trackStatsStream;
        this._e2ePingStream = e2ePingStream;
        this._faceExpressionStream = faceExpressionStream;
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

    _putRecordBatch = (schemaObjBatch, stream) => {
        this._firehose.putRecordBatch(
            {
                DeliveryStreamName: stream /* required */,
                Records: schemaObjBatch.map(obj => {
                    return {
                        Data: JSON.stringify(obj)
                    };
                })
            },
            err => {
                if (err) {
                    logger.error('[Firehose] Error sending data to firehose: %o', err);
                    PromCollector.firehoseErrorCount.inc();

                    return;
                }
                logger.info('[Firehose] Sent data: %o', schemaObjBatch);
            }
        );
    };

    _putRecords = (schemaObjs, stream) => {
        let i = 0;
        const batchSize = 500;

        while (i < schemaObjs.length) {
            const schemaObjBatch = schemaObjs.slice(i, i + batchSize);

            this._putRecordBatch(schemaObjBatch, stream);
            i += batchSize;
        }
    };

    _putTrackRecord = (track, { direction, statsSessionId, isP2P, pcId, createDate }) => {
        const {
            mediaType,
            ssrc,
            packets,
            packetsLost,
            packetsLostPct,
            packetsLostVariance
        } = track;

        const id = uuid.v4();

        const trackSchemaObj = {
            id,
            createDate,
            pcId,
            statsSessionId,
            isP2P,
            direction,
            mediaType,
            ssrc,
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
            e2epings = {},
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
            },
            faceExpressionTimestamps
        } = features;

        const createDate = getSQLTimestamp();

        // The schemaObj needs to match the redshift table schema.
        const schemaObj = {
            appEnv: this._appEnv,
            createDate,
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

        const faceExpressionSchemaObj = faceExpressionTimestamps.map(({ timestamp, faceExpression }) => {
            return {
                id: uuid.v4(),
                statsSessionId,
                timestamp,
                faceExpression
            };
        });

        this._putRecords(faceExpressionSchemaObj, this._faceExpressionStream);

        Object.keys(e2epings).forEach(remoteEndpointId => {
            const {
                remoteRegion,
                rtt
            } = e2epings[remoteEndpointId];

            const pingSchemaObj = {
                id: uuid.v4(),
                statsSessionId,
                remoteEndpointId,
                remoteRegion,
                rtt
            };

            this._putRecord(pingSchemaObj, this._e2ePingStream);
        });

        Object.keys(aggregates).forEach(pc => {
            const {
                dtlsErrors,
                dtlsFailure,
                isP2P,
                usesRelay,
                isCallstats,
                iceReconnects,
                pcSessionDurationMs,
                iceFailed,
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
                    upperBoundAggregates = { },
                    lowerBoundAggregates = { }
                } = { }
            } = aggregates[pc];

            /* for now we don't care about recording stats for Callstats PeerConnections */
            if (isCallstats) {
                return;
            }

            const id = uuid.v4();
            const aggregateSchemaObj = {
                pcname: pc,
                id,
                createDate,
                statsSessionId,
                dtlsErrors,
                dtlsFailure,
                isP2P,
                usesRelay,
                iceReconnects,
                pcSessionDurationMs,
                iceFailed,
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
                this._putTrackRecord(receiverTracks[rtrack], { direction: 'received',
                    statsSessionId,
                    isP2P,
                    pcId: id,
                    createDate });
            });

            Object.keys(senderTracks).forEach(strack => {
                this._putTrackRecord(senderTracks[strack], { direction: 'send',
                    statsSessionId,
                    isP2P,
                    pcId: id,
                    createDate });
            });
        });
    };
}

module.exports = FirehoseConnector;
