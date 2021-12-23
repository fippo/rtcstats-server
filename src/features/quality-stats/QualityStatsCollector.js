const { StatsFormat } = require('../../utils/stats-detection');
const { isObject } = require('../../utils/utils');

const FirefoxStatsExtractor = require('./FirefoxStatsExtractor');
const StandardStatsExtractor = require('./StandardStatsExtractor');


/**
 * Collects quality related data points from webrtc stats entries into a single object.
 */
class QualityStatsCollector {

    /**
     *
     * @param {StatsFormat} statsFormat - Browsers have different webrtc statistics formats
     * this parameter tells the collector which type we are using.
     */
    constructor(statsFormat) {

        this.statsFormat = statsFormat;

        // Currently we support standard stats, which is what chrome and safari are sending,
        // and firefox, which is somewhat close to standard but with deviations that need
        // to be taken into consideration.
        // The collectors contain sets of functions which allows us to extract data from a
        // report such as rtt, jitter, etc.
        if (this.statsFormat === StatsFormat.CHROME_STANDARD) {
            this.statsExtractor = new StandardStatsExtractor();
        } else if (this.statsFormat === StatsFormat.FIREFOX) {
            this.statsExtractor = new FirefoxStatsExtractor();
        }

        // The stats collector will run through all statistics gathered in a dump and collect
        // the important ones in a single object. That data can then be used to apply any
        // aggregations necessary by different consumers.
        // Object has the following format:
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
        this.extractedData = {};
    }

    /**
     * Returns the collected data associated with a specific pc (PeerConnection). If it does not exists
     * the initial object structure will be created.
     *
     * @param {string} pc - PeerConnection identifier usually in this form: "PC_0", "PC_1" etc.
     * @returns {Object} - PeerConnection collected data.
     */
    _getPcData(pc) {
        if (!this.extractedData[pc]) {
            // Initially any PC will have a transport associated with it, which is where the standard stats
            // also have RTT data (round trip time)
            this.extractedData[pc] = {
                transport: {
                    rtts: []
                },
                isP2P: null
            };
        }

        return this.extractedData[pc];
    }

    /**
     * Returns the collected data associated with a specific track within a PC. If it does not exists
     * the initial object structure will be created.
     * @param {Object} pcData - Object containing PC collected data, including multiple ssrc data
     * @param {string} ssrc - ssrc of the track from which we want to obtain collected data
     * @param {string} mediaType - media type of the track, we need this to initialize the object structure
     * in case it doesn't exist yet.
     * @returns {Object}`- Track collected data.
     */
    _getTrackData(pcData, ssrc, mediaType) {
        if (!pcData[ssrc]) {
            // At this point track data for a PC just contain packet information, additional data points will
            // be added.
            pcData[ssrc] = {
                packetsLost: [],
                packetsSent: [],
                mediaType
            };
        }

        return pcData[ssrc];
    }

    /**
     * Get packet data (sent and lost) from the current report, and push it to the data collection object.
     *
     * @param {Object} pcData- Output param, collected data gets put here.
     * @param {Object} statsEntry - The complete webrtc statistics entry which contains multiple reports.
     * @param {Object} report - A single report from a stats entry.
     */
    _collectPacketLossData(pcData, statsEntry, report) {
        // We currently only collect the data from outbound tracks.
        const packetLossData = this.statsExtractor.extractOutboundPacketLoss(statsEntry, report);

        if (!packetLossData) {
            return;
        }

        const { ssrc, mediaType, packetsLost, packetsSent } = packetLossData;

        const trackData = this._getTrackData(pcData, ssrc, mediaType);

        trackData.packetsLost.push(packetsLost);
        trackData.packetsSent.push(packetsSent);
    }

    /**
     * Get rtt data from the current report, and push it to the data collection object.
     *
     * @param {Array} rtts - Output param, collected rrt data gets put here.
     * @param {Object} statsEntry - The complete webrtc statistics entry which contains multiple reports.
     * @param {Object} report - a single report from a stats entry.
     */
    _collectRttData(rtts, statsEntry, report) {
        const rtt = this.statsExtractor.extractRtt(statsEntry, report);

        rtt && rtts.push(rtt);
    }

    /**
     * Constraints entries contain additional parameters passed to PeerConnections, including custom
     * ones like rtcStatsSFUP2P which tells us whether or not the pc was peer to peer.
     *
     * @param {string} pc - Associated PeerConnection.
     * @param {*} constraintsEntry - Constraints data as passed to the PeerConnection.
     */
    processConstraintsEntry(pc, constraintsEntry) {

        const { optional = [] } = constraintsEntry;
        const pcData = this._getPcData(pc);

        for (let i = 0; i < optional.length; i++) {
            if (optional[i].hasOwnProperty('rtcStatsSFUP2P')) {
                pcData.isP2P = optional[i].rtcStatsSFUP2P;
            }
        }
    }

    /**
     * Process a webrtc stats entry and extract data points of interest such as rtt, packet loss, jitter, etc.
     *
     * @param {string} pc - Associated PeerConnection.
     * @param {Object} statsEntry - Complete stats entry.
     */
    processStatsEntry(pc, statsEntry) {
        // If no collector was present simply skip.
        // TODO at this point we should avoid this call altogether.
        if (!this.statsExtractor) {
            return;
        }

        // Get the collected data associated with this PC.
        const pcData = this._getPcData(pc);
        const { transport: { rtts } } = pcData;

        // Go through each report in the stats entry (inbound-rtp, outbound-rtp, transport, local-candidate etc.)
        // And extract data that might be relevant from it. Certain data points require information from different
        // reports im the same statsEntry, that's why you'll see both the complete stats entry and the current report
        // being sent as parameters to the collection functions.
        // The idea here is to do a single pass of the reports and extract data from them if the report matches
        // certain criteria, we do this for performance reasons in order to avoid multiple iterations over the reports.
        Object.keys(statsEntry).forEach(id => {
            const report = statsEntry[id];

            if (!isObject(report)) {
                return;
            }

            // Some reports like firefox don't have the stats id as a field, it's needed in some feature extraction
            // functions.
            report.id = id;

            this._collectRttData(rtts, statsEntry, report);
            this._collectPacketLossData(pcData, statsEntry, report);
        });
    }

    /**
     * Needs to be called after the required stats entries have been processed.
     *
     * @returns Collected data.
     */
    getProcessedStats() {
        return this.extractedData;
    }

}

module.exports = QualityStatsCollector;
