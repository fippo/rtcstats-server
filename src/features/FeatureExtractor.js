/* eslint-disable no-invalid-this */

const assert = require('assert').strict;
const fs = require('fs');
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

        this.dominantSpeakerData = {
            dominantSpeakerStartTimeStamp: undefined,
            currentDominantSpeaker: undefined,
            speakerStats: {}
        };

        this.features = {
            dominantSpeakerChanges: 0,
            speakerTime: 0
        };

        this.extractFunctions = {
            dominantSpeaker: this._handleDominantSpeaker
        };
    }

    /**
     *
     * @param {*} data
     * @param {*} timestamp
     */
    _handleDominantSpeaker = (data, timestamp) => {
        assert(timestamp, 'timestamp field missing from dominantSpeaker data');

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
     */
    async extract() {
        const dumpReadLineI = readline.createInterface({
            input: fs.createReadStream(this.dumpPath),
            console: false
        });

        for await (const dumpLine of dumpReadLineI) {

            const dumpLineObj = JSON.parse(dumpLine);

            assert(Array.isArray(dumpLineObj), 'Unexpected dump format');

            const [ requestType, peerCon, data, timestamp ] = dumpLineObj;

            if (!this.conferenceStartTime && timestamp) {
                this.conferenceStartTime = timestamp;
            }

            if (this.extractFunctions[requestType]) {
                this.extractFunctions[requestType](data, timestamp);
            }

            this.conferenceEndTime = timestamp;
        }

        this.extractDominantSpeakerFeatures();

        return this.features;
    }
}

module.exports = FeatureExtractor;
