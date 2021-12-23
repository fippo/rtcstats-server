const { isObject, percentOf, round } = require('../../utils/utils');

/**
 *
 */
class StatsAggregator {
    /**
     * Calculate aggregates associated with the peer connection tracks
     *
     * @param {Object} extractedData - Data associated with a single peer connection.
     * @returns
     */
    _calculateTrackAggregates(pcData) {
        let totalPacketsLost = 0;
        let totalPacketsSent = 0;
        let packetsLostPct = 0;

        const tracks = Object.keys(pcData).filter(
            pcDataEntry => isObject(pcData[pcDataEntry]) && pcData[pcDataEntry].hasOwnProperty('mediaType')
        );

        // packetsLost and packetsSent are sent as totals for each point in time they were collected, thus
        // the last value in the array is going to be the total lost/sent for a track.
        // We then add them together to get the totals for the peer connection.
        tracks.forEach(trackSsrc => {
            const { packetsLost = [], packetsSent = [] } = pcData[trackSsrc];

            if (!(packetsLost.length && packetsSent.length)) {
                return;
            }

            totalPacketsLost += packetsLost.at(-1);
            totalPacketsSent += packetsSent.at(-1);

        });

        packetsLostPct = totalPacketsSent && percentOf(totalPacketsLost, totalPacketsSent);

        return {
            totalPacketsLost,
            totalPacketsSent,
            packetsLostPct
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
            resultMap[pc] = { isP2P: extractedData[pc].isP2P };

            const pcTrackResults = this._calculateTrackAggregates(extractedData[pc]);
            const pcTransportResults = this._calculateTransportAggregates(extractedData[pc]);

            resultMap[pc].trackAggregates = pcTrackResults;
            resultMap[pc].transportAggregates = pcTransportResults;
        });

        return resultMap;
    }
}

module.exports = StatsAggregator;
