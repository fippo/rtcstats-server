const { isObject, percentOf, round, standardizedMoment } = require('../../utils/utils');

/**
 *
 */
class StatsAggregator {
    /**
     * Converts a series of ever increasing values and returns a series of differences
     *
     * @param {Array} series - an array of increasing numbers
     * @return {Array}
     */
    _calculateSeriesDifferences(series) {
        const result = [];

        if (series.length > 0) {
            for (let i = 1; i < series.length; i++) {
                result.push(series[i] - series[i - 1]);
            }
        }

        return result;
    }

    /**
     * Calculate the stats for a single track.
     *
     * @param {Array} packets - a list of numbers of received/send packets
     * @param {Array} packetsLost - a list of number of missing packets
     * @param {String} mediaType - indicated if the track was audio or video
     * @return {Object}
     */
    _calculateSingleTrackStats(packets, packetsLost, mediaType) {
        const stats = {
            mediaType,
            packets: 0,
            packetsLost: 0,
            packetsLostPct: 0,
            packetsLostVariance: 0
        };

        if (!packets.length) {
            return stats;
        }
        const pcts = packets.at(-1);

        stats.packets = pcts;
        const pctsLost = packetsLost.at(-1);

        stats.packetsLost = pctsLost;

        if (pcts
            && pctsLost > 0
            && pctsLost < pcts) {
            stats.packetsLostPct = percentOf(pctsLost, pcts) || 0;
        }

        stats.packetsLostVariance = standardizedMoment(
            this._calculateSeriesDifferences(packetsLost), 2);

        return stats;
    }

    /**
     * Calculate the stats for all tracks within a single peer connection
     *
     * @param {Object} pcData - Data associated with a single peer connection.
     * @return {Object} - two maps with stats for all received and send tracks.
     */
    _calculateTrackStats(pcData) {
        const senderTracks = {};
        const receiverTracks = {};

        const tracks = Object.keys(pcData).filter(
            pcDataEntry => isObject(pcData[pcDataEntry]) && pcData[pcDataEntry].hasOwnProperty('mediaType')
        );

        tracks.forEach(trackSsrc => {
            const { packetsSentLost = [], packetsSent = [], packetsReceivedLost = [],
                packetsReceived = [], mediaType = '' } = pcData[trackSsrc];

            if (packetsSentLost.length && packetsSent.length) {
                senderTracks[trackSsrc] = this._calculateSingleTrackStats(packetsSent,
                    packetsSentLost, mediaType);
            }

            if (packetsReceivedLost.length && packetsReceived.length) {
                receiverTracks[trackSsrc] = this._calculateSingleTrackStats(packetsReceived,
                    packetsReceivedLost, mediaType);
            }
        });

        return {
            receiverTracks,
            senderTracks
        };
    }

    /**
     * Calculate aggregates associated with the peer connection tracks
     *
     * @param {Object} pcData - Data associated with a single peer connection.
     * @returns
     */
    _calculateTrackAggregates(pcData) {
        let totalPacketsSent = 0;
        let totalSentPacketsLost = 0;
        let totalPacketsReceived = 0;
        let totalReceivedPacketsLost = 0;

        const tracks = Object.keys(pcData).filter(
            pcDataEntry => isObject(pcData[pcDataEntry]) && pcData[pcDataEntry].hasOwnProperty('mediaType')
        );

        // packetsLost and packetsSent are sent as totals for each point in time they were collected, thus
        // the last value in the array is going to be the total lost/sent for a track.
        // We then add them together to get the totals for the peer connection.
        tracks.forEach(trackSsrc => {
            const { packetsSentLost = [], packetsSent = [],
                packetsReceivedLost = [], packetsReceived = [] } = pcData[trackSsrc];

            if (packetsSentLost.length && packetsSent.length) {
                totalPacketsSent += packetsSent.at(-1);
                totalSentPacketsLost += packetsSentLost.at(-1);
            }

            if (packetsReceivedLost.length && packetsReceived.length) {
                totalReceivedPacketsLost += packetsReceivedLost.at(-1);
                totalPacketsReceived += packetsReceived.at(-1);
            }
        });

        let sentPacketsLostPct = 0;

        if (totalPacketsSent
            && totalSentPacketsLost > 0
            && totalSentPacketsLost < totalPacketsSent) {
            sentPacketsLostPct = percentOf(totalSentPacketsLost, totalPacketsSent) || 0;
        }
        let receivedPacketsLostPct = 0;

        if (totalPacketsReceived
            && totalReceivedPacketsLost > 0
            && totalReceivedPacketsLost < totalPacketsReceived) {
            receivedPacketsLostPct = percentOf(totalReceivedPacketsLost, totalPacketsReceived) || 0;
        }

        return {
            totalSentPacketsLost,
            totalPacketsSent,
            sentPacketsLostPct,
            totalReceivedPacketsLost,
            totalPacketsReceived,
            receivedPacketsLostPct
        };
    }

    /**
     * Calculate aggregates associated with the transport report of a peer connection.
     *
     * @param {*} pcData - Data associated with a single peer connection.
     */
    _calculateTransportAggregates(pcData) {
        const { transport = {} } = pcData;
        const { rtts = [] } = transport;


        // Simply calculate the average rtt for this peer connection, more calculations can be added as needed.
        return {
            meanRtt: round(rtts.reduce((a, b) => a + b, 0) / (rtts.length || 1), 2)
        };
    }

    /**
     *
     * @param {*} extractedData - Data extracted by the QualityStatsCollector.
     */
    calculateAggregates(extractedData) {
        const resultMap = {};

        // Go through each peer connection and compute aggregates.
        Object.keys(extractedData).forEach(pc => {
            resultMap[pc] = { isP2P: extractedData[pc].isP2P,
                dtlsErrors: extractedData[pc].dtlsErrors,
                dtlsFailure: extractedData[pc].dtlsFailure };

            const pcTrackStats = this._calculateTrackStats(extractedData[pc]);
            const pcTrackResults = this._calculateTrackAggregates(extractedData[pc]);
            const pcTransportResults = this._calculateTransportAggregates(extractedData[pc]);

            resultMap[pc].tracks = pcTrackStats;
            resultMap[pc].trackAggregates = pcTrackResults;
            resultMap[pc].transportAggregates = pcTransportResults;
        });

        return resultMap;
    }
}

module.exports = StatsAggregator;
