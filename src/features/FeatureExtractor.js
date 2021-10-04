/* eslint-disable no-invalid-this */

const assert = require('assert').strict;
const fs = require('fs');
const sizeof = require('object-sizeof');
const { AggregatorRegistry } = require('prom-client');
const readline = require('readline');

const logger = require('../logging');

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
            endpointId
        } = dumpInfo;

        this.dumpPath = dumpPath;
        this.endpointId = endpointId;
        this.conferenceStartTime = 0;
        this.conferenceEndTime = 0;

        this.dominantSpeakerData = {
            dominantSpeakerStartTimeStamp: undefined,
            currentDominantSpeaker: undefined,
            speakerStats: {}
        };

        this.features = {
            dominantSpeakerChanges: 0,
            speakerTime: 0,
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
                totalProcessedCount: 0
            }
        };

        this.extractFunctions = {
            dominantSpeaker: this._handleDominantSpeaker,
            createAnswerOnSuccess: this._handleSDPRequest,
            setLocalDescription: this._handleSDPRequest,
            setRemoteDescription: this._handleSDPRequest,
            other: this._handleOtherRequest,
            getstats: this._handleStatsRequest
        };
    }

    /**
     *
     * @param {*} data
     * @param {*} timestamp
     */
    _handleDominantSpeaker = (data, timestamp, requestSize) => {
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
    }

    /**
     *
     * @param {*} data
     * @param {*} timestamp
     * @param {*} requestSize
     */
    _handleSDPRequest = (data, timestamp, requestSize) => {
        const { metrics } = this.features;

        metrics.sdpRequestBytes += requestSize;
        metrics.sdpRequestCount++;
    }

    /**
     *
     * @param {*} data
     * @param {*} timestamp
     * @param {*} requestSize
     */
    _handleStatsRequest = (data, timestamp, requestSize) => {
        const { metrics } = this.features;

        metrics.statsRequestBytes += requestSize;
        metrics.statsRequestCount++;
    }

    /**
     *
     * @param {*} data
     * @param {*} timestamp
     * @param {*} requestSize
     */
    _handleOtherRequest = (data, timestamp, requestSize) => {
        const { metrics } = this.features;

        metrics.otherRequestBytes += requestSize;
        metrics.otherRequestCount++;
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
    }

    /**
     *
     * @param {*} requestType
     * @param {*} timestamp
     */
    _recordSessionDuration(requestType, timestamp) {

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

            const [ requestType, peerCon, data, timestamp ] = dumpLineObj;

            this._recordSessionDuration(requestType, timestamp);

            if (this.extractFunctions[requestType]) {
                this.extractFunctions[requestType](data, timestamp, requestSize);
            } else {
                this.extractFunctions.other(data, timestamp, requestSize);
            }
        }

        this.extractDominantSpeakerFeatures();

        const { metrics } = this.features;
        const { dsRequestBytes, sdpRequestBytes, statsRequestBytes, otherRequestBytes } = metrics;
        const { dsRequestCount, sdpRequestCount, statsRequestCount, otherRequestCount } = metrics;

        metrics.sessionDurationMs = this.conferenceEndTime - this.conferenceStartTime;
        metrics.totalProcessedBytes = sdpRequestBytes + dsRequestBytes + statsRequestBytes + otherRequestBytes;
        metrics.totalProcessedCount = sdpRequestCount + dsRequestCount + statsRequestCount + otherRequestCount;
        metrics.dumpFileSizeBytes = dumpFileSizeBytes;

        return this.features;
    }
}

module.exports = FeatureExtractor;
