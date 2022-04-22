/* eslint-disable no-invalid-this */

const assert = require('assert').strict;
const fs = require('fs');
const sizeof = require('object-sizeof');
const readline = require('readline');

const logger = require('../logging');
const statsDecompressor = require('../utils//getstats-deltacompression').decompress;
const { getStatsFormat } = require('../utils/stats-detection');

const QualityStatsCollector = require('./quality-stats/QualityStatsCollector');
const StatsAggregator = require('./quality-stats/StatsAggregator');


/**
 *
 */
class FeatureExtractor {

    /**
     *
     * @param {*} statsDumpInfo
     */
    constructor(dumpInfo) {

        const {
            dumpPath,
            endpointId,
            statsFormat
        } = dumpInfo;

        this.dumpPath = dumpPath;
        this.endpointId = endpointId;
        if (statsFormat) {
            this.statsFormat = statsFormat;
            this.collector = new QualityStatsCollector(statsFormat);
        }
        this.conferenceStartTime = 0;
        this.conferenceEndTime = 0;

        this.aggregator = new StatsAggregator();


        this.baseStats = {};

        this.dominantSpeakerData = {
            dominantSpeakerStartTimeStamp: undefined,
            currentDominantSpeaker: undefined,
            speakerStats: {}
        };

        this.features = {
            dominantSpeakerChanges: 0,
            speakerTime: 0,
            sentiment: {
                angry: 0,
                disgusted: 0,
                fearful: 0,
                happy: 0,
                neutral: 0,
                sad: 0,
                surprised: 0
            },
            metrics: {
                statsRequestBytes: 0,
                statsRequestCount: 0,
                otherRequestBytes: 0,
                otherRequestCount: 0,
                sdpRequestBytes: 0,
                sdpRequestCount: 0,
                dsRequestBytes: 0,
                dsRequestCount: 0,
                totalProcessedBytes: 0,
                totalProcessedCount: 0,
                sentimentRequestBytes: 0,
                sentimentRequestCount: 0
            }
        };

        this.extractFunctions = {
            identity: this._handleIdentity,
            connectionInfo: this._handleConnectionInfo,
            constraints: this._handleConstraints,
            create: this._handleCreate,
            createAnswerOnSuccess: this._handleSDPRequest,
            dominantSpeaker: this._handleDominantSpeaker,
            e2eRtt: this._handleE2eRtt,
            facialExpression: this._handleFacialExpression,
            getstats: this._handleStatsRequest,
            onconnectionstatechange: this._handleConnectionStateChange,
            other: this._handleOtherRequest,
            ondtlserror: this._handleDtlsError,
            ondtlsstatechange: this._handleDtlsStateChange,
            setLocalDescription: this._handleSDPRequest,
            setRemoteDescription: this._handleSDPRequest
        };

        // try {
        //     fs.unlinkSync('decompress.txt');
        // } catch (e) {
        //     //
        // }

        // this.decompressFile = fs.createWriteStream('decompress.txt', {
        //     flags: 'a' // 'a' means appending (old data will be preserved)
        // });
    }


    _handleCreate = dumpLineObj => {
        const [ , pc, pcConstraints ] = dumpLineObj;

        this.collector.processPcConstraintsEntry(pc, pcConstraints);
    };

    _handleConstraints = dumpLineObj => {
        const [ , pc, constraintsEntry ] = dumpLineObj;

        this.collector.processConstraintsEntry(pc, constraintsEntry);
    };

    _handleConnectionInfo = dumpLineObj => {
        const [ , , connectionInfo ] = dumpLineObj;

        if (!this.statsFormat) {
            this.statsFormat = getStatsFormat(JSON.parse(connectionInfo));
            this.collector = new QualityStatsCollector(this.statsFormat);
        }
    };

    _handleIdentity = dumpLineObj => {
        const [ , , identityEntry ] = dumpLineObj;
        const { deploymentInfo: { crossRegion,
            envType,
            environment,
            region,
            releaseNumber,
            shard,
            userRegion } = { } } = identityEntry;

        if (!this.endpointId) {
            const { endpointId } = identityEntry;

            this.endpointId = endpointId;
        }

        // We copy the individual properties instead of just the whole object to protect against
        // unexpected changes in the deploymentInfo format that the client is sending.

        this.features.deploymentInfo = {
            crossRegion,
            envType,
            environment,
            region,
            releaseNumber,
            shard,
            userRegion
        };
    };

    /**
     *
     * @param {*} dumpLineObj
     */
    _handleConnectionStateChange = dumpLineObj => {

        this.collector.processConnectionState(dumpLineObj);
    };

    _handleFacialExpression = (dumpLineObj, requestSize) => {

        const [ , , data ] = dumpLineObj;

        const { sentiment, metrics } = this.features;

        metrics.sentimentRequestBytes += requestSize;
        metrics.sentimentRequestCount++;

        // {\"duration\":9,\"facialExpression\":\"neutral\"}
        // Expected data format for facialExpression:
        // {duration: <seconds>, facialExpression: <string>}
        // duration is expressed in seconds and, facial expression can be one of:
        // angry, disgusted, fearful, happy, neutral, sad, surprised
        const { duration, facialExpression } = data;

        if (facialExpression in sentiment) {
            sentiment[facialExpression] += duration;
        }
    };

    /**
     *
     * @param {*} data
     * @param {*} timestamp
     */
    _handleDominantSpeaker = (dumpLineObj, requestSize) => {

        const [ , , data, timestamp ] = dumpLineObj;

        assert(timestamp, 'timestamp field missing from dominantSpeaker data');

        const { metrics } = this.features;

        metrics.dsRequestBytes += requestSize;
        metrics.dsRequestCount++;

        // Expected data format for dominant speaker:
        // {"dominantSpeakerEndpoint": "1a404b1b","previousSpeakers": ["bb211808","1a4dqdb",
        //  "1adqwdqw", "312f4b1b"], "endpointId": "1a404b1b"}
        const { dominantSpeakerEndpoint } = data;

        assert(dominantSpeakerEndpoint, 'dominantSpeakerEndpoint field missing from dominantSpeaker data');

        const { speakerStats, dominantSpeakerStartTimeStamp } = this.dominantSpeakerData;

        // Initialize speakerStats for endpoint if not present.
        if (!speakerStats[dominantSpeakerEndpoint]) {
            speakerStats[dominantSpeakerEndpoint] = { speakerTime: 0,
                dominantSpeakerChanges: 0 };
        }

        const { [dominantSpeakerEndpoint]: endpointSpeakerStats } = speakerStats;

        endpointSpeakerStats.dominantSpeakerChanges++;

        // Calculate speaker time for the previous dominant speaker
        if (this.dominantSpeakerData.currentDominantSpeaker) {
            const speakerTime = timestamp - dominantSpeakerStartTimeStamp;

            endpointSpeakerStats.speakerTime += speakerTime;
        }

        this.dominantSpeakerData.currentDominantSpeaker = dominantSpeakerEndpoint;
        this.dominantSpeakerData.dominantSpeakerStartTimeStamp = timestamp;
    };

    /**
     *
     * @param {*} data
     * @param {*} timestamp
     * @param {*} requestSize
     */
    _handleSDPRequest = (dumpLineObj, requestSize) => {
        const { metrics } = this.features;

        metrics.sdpRequestBytes += requestSize;
        metrics.sdpRequestCount++;
    };

    _handleDtlsError = dumpLineObj => {
        const [ , pc, errormsg ] = dumpLineObj;

        this.collector.processDtlsErrorEntry(pc, errormsg);
    };

    _handleDtlsStateChange = dumpLineObj => {
        const [ , pc, state ] = dumpLineObj;

        this.collector.processDtlsStateEntry(pc, state);
    };

    _handleE2eRtt = dumpLineObj => {
        const [ , , line ] = dumpLineObj;

        const { remoteEndpointId, rtt, remoteRegion } = line;

        if (!('e2epings' in this.features)) {
            this.features.e2epings = {};
        }

        this.features.e2epings[remoteEndpointId] = {
            remoteRegion,
            rtt
        };
    };

    /**
     *
     * @param {*} data
     * @param {*} timestamp
     * @param {*} requestSize
     */
    _handleStatsRequest = (dumpLineObj, requestSize) => {
        const { metrics } = this.features;

        const [ , pc, statsReport ] = dumpLineObj;

        // The rtcstats client applies a delta compression for sent stats entries, i.e. it only sends the difference
        // from the prior stat entry, so we need to decompress them.
        if (this.baseStats[pc]) {
            this.baseStats[pc] = statsDecompressor(this.baseStats[pc], statsReport);
        } else {
            this.baseStats[pc] = statsReport;
        }

        // this.decompressFile.write(JSON.stringify([ pc, null, this.baseStats[pc] ]));

        this.collector.processStatsEntry(pc, this.baseStats[pc]);

        metrics.statsRequestBytes += requestSize;
        metrics.statsRequestCount++;
    };

    /**
     *
     * @param {*} data
     * @param {*} timestamp
     * @param {*} requestSize
     */
    _handleOtherRequest = (dumpLineObj, requestSize) => {
        const { metrics } = this.features;

        metrics.otherRequestBytes += requestSize;
        metrics.otherRequestCount++;
    };

    /**
     *
     * @param {*} dumpLineObj
     */
    _handleGenericEntry(dumpLineObj) {
        this._recordSessionDuration(dumpLineObj);
        this.collector.processGenericEntry(dumpLineObj);
    }

    /**
     *
     */
    extractDominantSpeakerFeatures = () => {
        const { speakerStats, currentDominantSpeaker, dominantSpeakerStartTimeStamp } = this.dominantSpeakerData;
        const { [currentDominantSpeaker]: lastSpeakerStats } = speakerStats;

        // No dominant speaker events were generated during this conference,
        if (!currentDominantSpeaker) {
            return;
        }

        // Calculate how much time the last dominant speaker spent until this participant left the meeting.
        const lastSpeakerTime = this.conferenceEndTime - dominantSpeakerStartTimeStamp;

        lastSpeakerStats.speakerTime += lastSpeakerTime;

        // Extract dominant speaker features for this participant if any were processed.
        if (speakerStats[this.endpointId]) {
            const { dominantSpeakerChanges, speakerTime } = speakerStats[this.endpointId];

            this.features.dominantSpeakerChanges = dominantSpeakerChanges;
            this.features.speakerTime = speakerTime;
        }
    };

    /**
     *
     * @param {*} dumpLineObj
     */
    _recordSessionDuration(dumpLineObj) {
        const [ requestType, , , timestamp ] = dumpLineObj;

        if (requestType !== 'connectionInfo' && requestType !== 'identity') {
            if (!this.conferenceStartTime && timestamp) {
                this.conferenceStartTime = timestamp;
            }

            this.conferenceEndTime = timestamp;
        }
    }

    /**
     *
     */
    async extract() {

        const dumpFileStats = fs.statSync(this.dumpPath);
        const dumpFileSizeBytes = dumpFileStats.size;

        const dumpReadLineI = readline.createInterface({
            input: fs.createReadStream(this.dumpPath),
            console: false
        });


        for await (const dumpLine of dumpReadLineI) {
            const requestSize = sizeof(dumpLine);
            const dumpLineObj = JSON.parse(dumpLine);

            assert(Array.isArray(dumpLineObj), 'Unexpected dump format');

            const [ requestType, , , ] = dumpLineObj;

            if (this.extractFunctions[requestType]) {
                this.extractFunctions[requestType](dumpLineObj, requestSize);
            } else {
                this.extractFunctions.other(dumpLineObj, requestSize);
            }

            this._handleGenericEntry(dumpLineObj);
        }

        this.extractDominantSpeakerFeatures();

        const { metrics } = this.features;
        const { dsRequestBytes, sdpRequestBytes, statsRequestBytes, otherRequestBytes } = metrics;
        const { dsRequestCount, sdpRequestCount, statsRequestCount, otherRequestCount } = metrics;

        metrics.sessionDurationMs = this.conferenceEndTime - this.conferenceStartTime;
        metrics.totalProcessedBytes = sdpRequestBytes + dsRequestBytes + statsRequestBytes + otherRequestBytes;
        metrics.totalProcessedCount = sdpRequestCount + dsRequestCount + statsRequestCount + otherRequestCount;
        metrics.dumpFileSizeBytes = dumpFileSizeBytes;

        // Expected result format.
        // PC_0: {
        //     transport: {
        //         rtts: [],
        //     },
        //     ssrc1: {
        //         mediaType: 'audio',
        //         packetsLost: [],
        //         packetsSent: [],
        //         jitter: []
        //     },
        //     ssrc2: {
        //         mediaType: 'video',
        //         packetsLost: [],
        //         packetsSent: [],
        //         jitter: []
        //     },
        // }
        // PC_1: { ... }
        const processedStats = this.collector.getProcessedStats();

        logger.debug('Collected stats: %o', processedStats);

        // Expected result format.
        // PC_0: {
        //     isP2P: false,
        //     trackAggregates: {
        //       totalPacketsLost: 100,
        //       totalPacketsSent: 10676,
        //       packetsLostPct: 0.94
        //     },
        //     transportAggregates: { meanRtt: 0.19 }
        //  },
        // PC_1: { ... }
        const aggregateResults = this.aggregator.calculateAggregates(processedStats);

        this.features.aggregates = aggregateResults;

        logger.debug('Aggregate results: %o', aggregateResults);

        return this.features;
    }
}

module.exports = FeatureExtractor;
