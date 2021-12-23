const { getRTTStandard, getTotalPacketsStandard } = require('../../utils/stats-detection');

/**
 * Collection of functions used to extract data from standard formatted webrtc stats.
 */
class StandardStatsExtractor {
    /**
     * Extract round trip time.
     *
     * @param {Object} report - Individual stat report.
     * @param {Object} statsEntry - Complete rtcstats entry
     * @returns {Number|undefined} - Extracted rtt, or undefined if the report isn't of the necessary type.
     */
    extractRtt(statsEntry, report) {
        return getRTTStandard(statsEntry, report);
    }


    /**
     *
     * @param {Object} report - Individual stat report.
     * @param {Object} statsEntry - Complete rtcstats entry
     */
    // extractJitter(statsEntry, report) {
    //     // TODO
    // }

    /**
     * Extract packet data.
     *
     * @param {Object} report - Individual stat report.
     * @param {Object} statsEntry - Complete rtcstats entry
     * @returns {PacketsSummary|undefined} - Packet summary or undefined if the report isn't of the necessary type.
     */
    extractOutboundPacketLoss(statsEntry, report) {
        return getTotalPacketsStandard(statsEntry, report);
    }
}
module.exports = StandardStatsExtractor;
