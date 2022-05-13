/* eslint-disable no-unused-vars */
const { StatsFormat } = require('../../utils/stats-detection');
const { isObject, isConnectionSuccessful } = require('../../utils/utils');

const FirefoxStatsExtractor = require('./FirefoxStatsExtractor');
const StandardStatsExtractor = require('./StandardStatsExtractor');

/**
 * Creates a new track data structure with the specified ssrc preset.
 * 
 * @param {string} ssrc - the ssrc of the new track data structure.
 * @returns the newly created track data structure.
 */
function newTrack(ssrc) {
    return {
        ssrc,
        packetsReceived: [],
        packetsReceivedLost: [],
        packetsSent: [],
        packetsSentLost: [],
    };
}

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
        if (this.statsFormat === StatsFormat.CHROME_STANDARD
            || this.statsFormat === StatsFormat.SAFARI) {
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
                connectionStates: [],
                isP2P: null,
                isCallstats: false,
                dtlsErrors: 0,
                dtlsFailure: 0,
                usesRelay: null,
                inboundVideoExperiences: [],
                startTime: 0,
                endTime: 0
            };
        }

        return this.extractedData[pc];
    }

    /**
     * Returns the collected data associated with a specific track within a PC. If it does not exists
     * the initial object structure will be created.
     * @param {Object} pcData - Object containing PC collected data, including multiple ssrc data
     * @param {string} ssrc - ssrc of the track from which we want to obtain collected data
     * @returns {Object}`- Track collected data.
     */
    _getTrackData(pcData, ssrc) {
        if (!pcData[ssrc]) {
            // At this point track data for a PC just contain packet information, additional data points will
            // be added.
            pcData[ssrc] = newTrack(ssrc);
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
        const outboundPacketLossData = this.statsExtractor.extractOutboundPacketLoss(statsEntry, report);
        const inboundPacketLossData = this.statsExtractor.extractInboundPacketLoss(statsEntry, report);

        if (outboundPacketLossData) {
            const { ssrc, mediaType, packetsLost, packetsSent } = outboundPacketLossData;

            const trackData = this._getTrackData(pcData, ssrc);

            trackData.mediaType = mediaType;
            trackData.packetsSentLost.push(packetsLost);
            trackData.packetsSent.push(packetsSent);
        }

        if (inboundPacketLossData) {
            const { ssrc, mediaType, packetsLost, packetsReceived } = inboundPacketLossData;

            const trackData = this._getTrackData(pcData, ssrc);

            trackData.mediaType = mediaType;
            trackData.packetsReceivedLost.push(packetsLost);
            trackData.packetsReceived.push(packetsReceived);
        }
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
     * Get packet data (sent and lost) from the current report, and push it to the data collection object.
     *
     * @param {Object} pcData- Output param, collected data gets put here.
     * @param {Object} statsEntry - The complete webrtc statistics entry which contains multiple reports.
     * @param {Object} report - A single report from a stats entry.
     */
    _collectIsUsingRelayData(pcData, statsEntry, report) {
        const isUsingRelay = this.statsExtractor.isUsingRelay(statsEntry, report);

        if (isUsingRelay !== undefined) {
            pcData.usesRelay = isUsingRelay;
        }
    }

    /**
     * Updates the video experience data of a particular peer connection with the video summary extracted from the
     * report.
     *
     * @param {VideoExperience} videoExperience
     * @param statsEntry
     * @param report
     * @private
     */
    _updateInboundVideoExperience(videoExperience, statsEntry, report) {
        const inboundVideoSummary = this.statsExtractor.extractInboundVideoSummary(statsEntry, report);

        if (inboundVideoSummary && inboundVideoSummary.frameHeight > 0) {

            // if this report has different frame resolution, we update the principal/secondary resolution/frame rate
            if (!videoExperience.upperBound
                || videoExperience.upperBound.frameHeight < inboundVideoSummary.frameHeight) {
                videoExperience.upperBound = inboundVideoSummary;
            }

            if (!videoExperience.lowerBound
                || videoExperience.lowerBound.frameHeight > inboundVideoSummary.frameHeight) {
                videoExperience.lowerBound = inboundVideoSummary;
            }

            // if this report has the same frame resolution but different frame rate, we update the principal/secondary
            // frame rate
            if (videoExperience.upperBound
                && videoExperience.upperBound.frameHeight === inboundVideoSummary.frameHeight
                && videoExperience.upperBound.framesPerSecond < inboundVideoSummary.framesPerSecond) {
                videoExperience.upperBound = inboundVideoSummary;
            }

            if (videoExperience.lowerBound
                && videoExperience.lowerBound.frameHeight === inboundVideoSummary.frameHeight
                && videoExperience.lowerBound.framesPerSecond > inboundVideoSummary.framesPerSecond) {
                videoExperience.lowerBound = inboundVideoSummary;
            }
        }
    }

    /**
     * Handler used for all stat entries
     *
     * @param {*} dumpLineObj
     */
    processGenericEntry(dumpLineObj) {
        const [ , pc, state, timestamp ] = dumpLineObj;

        // Stat dumps contain entries without any PeerConnection associations, ignore them in order
        // to avoid creation of "null" pc entries.
        if (!pc) {
            return;
        }

        const pcData = this._getPcData(pc);

        // Make an educated guess about how long this peerconnection lasted.
        // If startTime has a value that means that ice successfully connected prior to this point
        if (pcData.startTime) {
            pcData.endTime = timestamp;
        }
    }

    /**
     * Handle connection state entries, calculate the session time and creates a timeline
     * of ice states throgout the connection's durration.
     *
     * @param {*} dumpLineObj
     */
    processConnectionState(dumpLineObj) {
        const [ , pc, state, timestamp ] = dumpLineObj;

        const pcData = this._getPcData(pc);

        if (isConnectionSuccessful(state) && !pcData.startTime) {
            pcData.startTime = timestamp;
        }

        pcData.connectionStates.push({ state,
            timestamp });
    }

    /**
     * Each PeerConnection at creation takes an optional constraints object, including the iceServers
     * which we use to identify the PeerConnection created by CallStats to test the connection before
     * a call.
     *
     * @param {string} pc - Associated PeerConnection.
     * @param {*} constraintsEntry - The PeerConnection constraints object per W3C spec
     */
    processPcConstraintsEntry(pc, constraintsEntry) {
        const pcData = this._getPcData(pc);

        if (constraintsEntry.iceServers) {
            constraintsEntry.iceServers.forEach(server => {
                if (typeof server.urls === 'string'
                    && server.urls.includes('callstats.io')) {
                    pcData.isCallstats = true;
                } else if (typeof server.urls === 'object') {
                    server.urls.forEach(url => {
                        if (url.includes('callstats.io')) {
                            pcData.isCallstats = true;
                        }
                    });
                }
            });
        }
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
     * Dtls error entries contain an explanation of the error, which we ignore for now.
     *
     * @param {string} pc - Associated PeerConnection
     * @param {string} errormsg - The Dtls error message from the client
     */
    processDtlsErrorEntry(pc, errormsg) {
        const pcData = this._getPcData(pc);

        pcData.dtlsErrors += 1;
    }

    /**
     * Dtls state entries are generated for every state transition. Currently we are only
     * counting the failures.
     *
     * @param {string} pc - Associated PeerConnection
     * @param {string} state - The name of the new Dtls connection state
     */
    processDtlsStateEntry(pc, state) {
        const pcData = this._getPcData(pc);

        // Possible states are: new, connecting, connected, closed, failed
        if (state === 'failed') {
            pcData.dtlsFailure += 1;
        }
    }

    /**
     * @returns {Array} - an array with all the peer connection ids that are seen so far.
     */
    getPeerConnectionKeys() {
        return Object.keys(this.extractedData).filter(key => key.toString().startsWith("PC_"));
    }

    /**
     * Handles the video type information signaled by the client.
     * 
     * @param {Object} videoTypeData - the video metadata.
     */
    processVideoTypeEntry(videoTypeData) {
        const { ssrc, videoType } = videoTypeData;
        // The `setVideoType` message does not carry the peer connection id, so we
        // propagate the information to all the peer connections that we know about.
        //
        // NOTE that by doing this we are prone to ssrc conflicts, i.e. two peer
        // connections (e.g. a p2p peer connection and a jvb peer connection) may
        // have the same ssrcs but the risk of this happenning in should be small in
        // practice.
        this.getPeerConnectionKeys().forEach(pc => {
            const pcData = this._getPcData(pc);

            // Setting the video type properly is a bit tricky because ssrcs can be
            // re-used depending on the following 3 different cases that need to be
            // considered here:
            // 
            // 1. in Plan-b (obsolette) there would be change in the ssrc of the
            // video track when the videoType changes.
            // 
            // 2. In Unified-plan, the existing ssrc is re-used when the videoType
            // changes.
            // 
            // 3. In the new multi-stream mode, if there is a new videoType, its
            // always a different track, i.e., there can be 2 tracks one as camera
            // and the other as desktop and the source-name for each of these tracks
            // is sent in presence along with videoType. 
            // 
            // Now, the client sends the videoType when a track is created or the
            // videoType is updated. What we do here on the server side is, if a
            // track with the specified ssrc does not exist, then we create a new
            // track with the specified video type. If a track already exists with
            // the specified ssrc *and* its video type is different from the one
            // specified as an argument, the existing track will be "vacummed" and a
            // new one will be created.
            // 
            // Vacuum here means that the track is removed from the pcData map and
            // is put in an array (not a map, because there may be multiple tracks
            // with the same ssrc) and so we also stop the stats accumulation. Any
            // new stats that we find with the specified ssrc is collected against a
            // new track with the new video type.

            const currentTrackData = pcData[ssrc];
            if (!currentTrackData || currentTrackData.videoType != videoType) {

                if (currentTrackData) {
                    // "Vacuum" the track for later processing.
                    if (!pcData.vacuumedTracks) {
                        pcData.vacuumedTracks = []
                    }
                    pcData.vacuumedTracks.push(currentTrackData);
                    delete pcData[ssrc];
                }

                const newTrackData = newTrack(ssrc)
                newTrackData.videoType = videoType
                pcData[ssrc] = newTrackData
            }
        });
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
        const { transport: { rtts }, inboundVideoExperiences } = pcData;

        // Go through each report in the stats entry (inbound-rtp, outbound-rtp, transport, local-candidate etc.)
        // And extract data that might be relevant from it. Certain data points require information from different
        // reports im the same statsEntry, that's why you'll see both the complete stats entry and the current report
        // being sent as parameters to the collection functions.
        // The idea here is to do a single pass of the reports and extract data from them if the report matches
        // certain criteria, we do this for performance reasons in order to avoid multiple iterations over the reports.

        const inboundVideoExperience = {
            upperBound: undefined,
            lowerBound: undefined
        };

        Object.keys(statsEntry).forEach(id => {
            const report = statsEntry[id];

            if (!isObject(report)) {
                return;
            }

            // Some reports like firefox don't have the stats id as a field, it's needed in some feature extraction
            // functions.
            report.id = id;

            this._collectRttData(rtts, statsEntry, report);
            this._collectIsUsingRelayData(pcData, statsEntry, report);
            this._collectPacketLossData(pcData, statsEntry, report);
            this._updateInboundVideoExperience(inboundVideoExperience, statsEntry, report);
        });

        if (inboundVideoExperience.upperBound) {
            // note that inboundVideoExperience.upperBound is implied
            inboundVideoExperiences.push(inboundVideoExperience);
        }
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
