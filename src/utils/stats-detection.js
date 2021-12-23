const uaParser = require('ua-parser-js');


const StatsFormat = Object.freeze({
    CHROME_STANDARD: 'chrome_standard',
    CHROME_LEGACY: 'chrome_legacy',
    FIREFOX: 'firefox',
    SAFARI: 'safari',
    UNSUPPORTED: 'unsupported'
});


/**
 *
 * @param {*} report - rtcstats stats report.
 * @returns {Boolean}
 */
function isCandidatePairReport(report) {
    return report.type === 'candidate-pair' && report.selected === true;
}

/**
 *
 * @param {*} report
 * @returns {Boolean}
 */
function isTransportReport(report) {
    return report.type === 'transport' && report.selectedCandidatePairId;
}

/**
 * Determine if the report is of type google legacy stats ssrc
 *
 * @param {*} report
 * @returns {Boolean}
 */
function isLegacySsrcReport(report) {
    return report.type === 'ssrc' && report.id.endsWith('_send') === true;
}

/**
 * Determine if the report is of type google legacy stats video ssrc
 *
 * @param {*} report
 */
function isLegacyVideoSsrcReport(report) {
    return isLegacySsrcReport(report) && report.mediaType === 'video';
}

/**
 * Get transport report check function.
 * At the time of writing there were only two options either 'candidate-pair' report for firefox and chrome legacy
 * stats, or the standard compliant 'transport' report used by safari and chrome-standard report types.
 *
 * @param {Object} client - Object view of the rtcstats dump.
 * @return {Function}
 */
function getTransportInfoFn(client) {
    if (client.statsFormat === StatsFormat.FIREFOX
        || client.statsFormat === StatsFormat.CHROME_LEGACY) {
        return isCandidatePairReport;
    }

    return isTransportReport;

}

/**
 * Used for chrome legacy stats that were mangled by rtcstats-server.
 *
 * @param {Object} statsEntry
 * @param {Object} report
 * @returns {Number|undefined} - RTT value in seconds or undefined if report doesn't match
 */
function getRTTChromeLegacy(statsEntry, report) {
    if (isCandidatePairReport(report)) {
        return report.roundTripTime / 1000;
    }
}

/**
 * Standard compliant way to get RTT. currently supported by chrome standard stats and safari stats.
 *
 * @param {Object} statsEntry
 * @param {Object} report
 * @returns {Number|undefined} RTT value in seconds or undefined if report doesn't match or associated candidate pair is
 * not found
 */
function getRTTStandard(statsEntry, report) {
    if (isTransportReport(report) && statsEntry[report.selectedCandidatePairId]) {
        return statsEntry[report.selectedCandidatePairId].currentRoundTripTime;
    }
}

/**
 * For firefox attempt a best effort approach as rtt stats in only present in remote-inbound-rtp reports, we'll
 * assume that RTT is roughly the same across all remote-inbound-rtp entries (usually one for video and one for audio)
 *
 * @param {Object} statsEntry - Complete rtcstats entry
 * @param {Object} report - Individual stat report.
 * @returns {Number|undefined} - RTT value or undefined if report doesn't match
 */
function getRTTFirefox(statsEntry, report) {
    if (report.type === 'remote-inbound-rtp') {
        return report.roundTripTime;
    }
}

/**
 *
 *
 * @param {Object} client - Object view of the rtcstats dump.
 * @returns {Function}
 */
function getRTTFn(client) {
    if (client.statsFormat === StatsFormat.FIREFOX) {
        return getRTTFirefox;
    } else if (client.statsFormat === StatsFormat.CHROME_LEGACY) {
        return getRTTChromeLegacy;
    }

    return getRTTStandard;
}

/**
 * Determine if a dump entry is a statistic.
 *
 * @param {String} entryType - rtcstats dump entry type
 * @returns {Boolean}
 */
function isStatisticEntry(entryType) {
    return entryType === 'getStats' || entryType === 'getstats';
}

/**
 * Depending on the browser and the protocol used by the client, determine which stats format is being used. This info
 * will be used in feature extraction for browser specific logic.
 *
 * @param {Object} clientMeta
 * @returns {StatsFormat}
 */
function getStatsFormat(clientMeta) {

    const { browser: { name: browserName = 'Unsupported' } } = uaParser(clientMeta.userAgent);
    const { clientProtocol } = clientMeta;

    let statsFormat = StatsFormat.UNSUPPORTED;

    // We expect stats type to be of two types, LEGACY or STANDARD, this will only be used when determining which type
    // of chrome statistic to use, firefox and sfarai ua will ignore it.
    const [ , statsType ] = clientProtocol.split('_');

    // Take into account Chromium as well, possible match values Chrome / Headless / Chrome WebView / Chromium
    // In case it's chromium based we need to check if the stats format is legacy or according to the spec
    if (browserName.startsWith('Chrom')) {
        // Starting with protocol 3 the client switched to standard stats.
        if (statsType === 'STANDARD') {
            statsFormat = StatsFormat.CHROME_STANDARD;
        } else {
            statsFormat = StatsFormat.CHROME_LEGACY;
        }
    } else if (browserName.startsWith('Firefox')) {
        statsFormat = StatsFormat.FIREFOX;
    } else if (browserName.startsWith('Safari')) {
        statsFormat = StatsFormat.SAFARI;
    }

    return statsFormat;
}


/**
 * Chrome legacy format uses a "ssrc" type report with a name ending in either "_send" or "_recv"
 *
 * @param {Object} report - Individual stat report.
 * @returns {PacketsSummary}
 */
function getTotalPacketsLegacy(report) {
    if (isLegacySsrcReport(report)) {
        return {
            packetsLost: report.packetsLost,
            packetsSent: report.packetsSent,
            ssrc: report.ssrc,
            mediaType: report.mediaType
        };
    }
}

/**
 * Firefox has both packetsLost and packetsSent entries in the remote-inbound-rtp report.
 *
 * @param {Object} report - Individual stat report.
 * @returns {PacketsSummary}
 */
function getTotalPacketsFirefox(report) {
    if (report.type === 'remote-inbound-rtp') {
        return {
            packetsLost: report.packetsLost,
            packetsSent: report.packetsSent,
            ssrc: report.ssrc,
            mediaType: report.mediaType
        };
    }
}

/**
 * Standard statistics have this info split accross two reports, packetsSent is in the outbound-rtp report and
 * packetsLost in remote-inbound-rtp report, which has a reference in outbound-rtp under the remoteId key.
 *
 * @param {Object} report - Individual stat report.
 * @param {Object} statsEntry - Complete rtcstats entry
 * @returns {PacketsSummary}
 */
function getTotalPacketsStandard(statsEntry, report) {
    if (report.type === 'outbound-rtp' && statsEntry[report.remoteId]) {

        return {
            packetsLost: statsEntry[report.remoteId].packetsLost,
            packetsSent: report.packetsSent,
            ssrc: report.ssrc,
            mediaType: report.mediaType
        };
    }
}

/**
 * Return the resolution as a valid number, guard against Object/Null/NaN/Undefined/Infinity values
 *
 * @param {Number} resolution
 * @returns {Number} Valid resolution as a number.
 */
function extractValidResolution(resolution) {

    if (Number.isFinite(resolution)) {
        return resolution;
    }

    return 0;
}


/**
 * Obtain a function that allows the extraction of packetsLost and packetsSent values for the supported browsers.
 *
 * @param {Object} client - Object view of the rtcstats dump.
 * @returns {Function}
 */
function getTotalPacketsFn(client) {
    if (client.statsFormat === StatsFormat.CHROME_LEGACY) {
        return getTotalPacketsLegacy;
    } else if (client.statsFormat === StatsFormat.FIREFOX) {
        return getTotalPacketsFirefox;
    }

    return getTotalPacketsStandard;
}

/**
 * At the time of writing firefox didn't have any way to get the send resolution from stats, so we just ignore it.
 */
function getUsedResolutionFirefox() {
    return undefined;
}

/**
 *
 * @param {Object} report - Individual stat report.
 * @return {Number} Used send resolution.
 */
function getUsedResolutionStandard(report, statsEntry) {

    // Standard reports have the send video frameHeight in the 'track' report, make sure that one exists and if so
    // extract the used resolution.
    // In case of simulcast the 'track' report will show the highest sent resolution
    if (report.type === 'outbound-rtp'
        && report.mediaType === 'video'
        && report.contentType !== 'screenshare'
        && statsEntry[report.trackId]) {

        return extractValidResolution(statsEntry[report.trackId].frameHeight);
    }
}

/**
 *
 * @param {Object} report - Individual stat report.
 * @return {Number} Used send resolution.
 */
function getUsedResolutionLegacy(report) {
    if (isLegacyVideoSsrcReport(report) && report.googContentType === 'realtime') {
        return extractValidResolution(report.frameHeight);
    }
}

/**
 * Obtain a function that extracts the used send resolution at a given point in time.
 *
 * @param {Object} client - Object view of the rtcstats dump.
 * @returns {Function}
 */
function getUsedResolutionFn(client) {
    if (client.statsFormat === StatsFormat.CHROME_LEGACY) {
        return getUsedResolutionLegacy;
    } else if (client.statsFormat === StatsFormat.FIREFOX) {
        return getUsedResolutionFirefox;
    }

    return getUsedResolutionStandard;
}

/**
 *
 * @param {*} report
 * @param {*} lastStatsEntry
 */
function getBitRateLegacy(report, lastStatsEntry) {
    if (!lastStatsEntry) {
        return;
    }
    const { id } = report;

    if (report.type === 'candidate-pair' && report.selected === true && lastStatsEntry[id]) {
        const recvBitRate
            = (8 * (report.bytesReceived - lastStatsEntry[id].bytesReceived))
            / (report.timestamp - lastStatsEntry[id].timestamp);

        const sendBitRate
            = (8 * (report.bytesSent - lastStatsEntry[id].bytesSent))
            / (report.timestamp - lastStatsEntry[id].timestamp);

        return { recvBitRate,
            sendBitRate };
    }

}

/**
 *
 * @param {*} report
 * @param {*} lastStatsEntry
 */
function getBitRateStandard(report, lastStatsEntry, currentStatsEntry) {
    if (!lastStatsEntry) {
        return;
    }

    const candidatePair = currentStatsEntry[report.selectedCandidatePairId];
    const lastCandidatePair = lastStatsEntry[report.selectedCandidatePairId];

    if (isTransportReport(report) && candidatePair && lastCandidatePair) {

        const recvBitRate
            = (8 * (candidatePair.bytesReceived - lastCandidatePair.bytesReceived))
            / (candidatePair.timestamp - lastCandidatePair.timestamp);

        const sendBitRate
        = (8 * (candidatePair.bytesSent - lastCandidatePair.bytesSent))
        / (candidatePair.timestamp - lastCandidatePair.timestamp);

        return { recvBitRate,
            sendBitRate };
    }
}

/**
 * Obtain a function that extracts the used send resolution at a given point in time.
 *
 * @param {Object} client - Object view of the rtcstats dump.
 * @returns {Function}
 */
function getBitRateFn(client) {
    if (client.statsFormat === StatsFormat.CHROME_LEGACY) {
        return getBitRateLegacy;
    } else if (client.statsFormat === StatsFormat.FIREFOX) {
        return getBitRateLegacy;
    }

    return getBitRateStandard;
}

/**
 * Not supported.
 *
 * @param {*} report
 */
function getScreenShareDataStandard() {
    return;
}

/**
 * Not supported.
 *
 * @param {*} report
 */
function getScreenShareDataFirefox() {
    return;
}

/**
 * Extract screen-share resolution stats from legacy chrome video report.
 *
 * @param {*} report
 * @returns {Object}
 */
function getScreenShareDataLegacy(report) {
    // googContentType can be either screen for screen-sharing or realtime for video
    if (isLegacyVideoSsrcReport(report) && report.googContentType === 'screen') {
        const {
            googCpuLimitedResolution: cpuLimited,
            googBandwidthLimitedResolution: bandwidthLimited,
            googFrameHeightInput: frameHeightInput,
            googFrameHeightSent: frameHeightSent
        } = report;

        // Boolean values come in as strings for legacy reports.
        return {
            cpuLimited: cpuLimited === 'true',
            bandwidthLimited: bandwidthLimited === 'true',
            frameHeightInput,
            frameHeightSent
        };
    }
}

/**
 *  Obtain a function that extracts screen-sharing statistics regarding resolution quality.
 *
 * @param {*} client
 */
function getScreenShareDataFn(client) {

    if (client.statsFormat === StatsFormat.CHROME_LEGACY) {
        return getScreenShareDataLegacy;
    } else if (client.statsFormat === StatsFormat.FIREFOX) {
        return getScreenShareDataFirefox;
    }

    return getScreenShareDataStandard;
}


module.exports = {
    isStatisticEntry,
    getBitRateFn,
    getRTTFn,
    getRTTStandard,
    getRTTFirefox,
    getScreenShareDataFn,
    getStatsFormat,
    getTotalPacketsFn,
    getTotalPacketsStandard,
    getTotalPacketsFirefox,
    getTransportInfoFn,
    getUsedResolutionFn,
    StatsFormat
};
