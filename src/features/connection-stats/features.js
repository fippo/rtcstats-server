const {
    isStatisticEntry,
    getBitRateFn,
    getRTTFn,
    getTotalPacketsFn,
    getUsedResolutionFn
} = require('../../utils/stats-detection');
const {
    fixedDecMean,
    percentOf,
    round
} = require('../../utils/utils');


/**
 * Groups resolutions to High Definition, Standard Definition, Low Definition and No Video buckets.
 * Count the total samples as well so we can establish a usage percentage for each of those.
 * @param {ResStatsMap} resStatsMap
 * @param {Number} resolution
 */
function fitResToDefinition(resStatsMap, resolution) {
    if (!resolution) {
        return;
    }

    ++resStatsMap.totalSamples;

    // Not very elegant but we need it to be fast.
    if (resolution >= 720) {
        // HD
        ++resStatsMap.resTimeShare.hdVideo;
    } else if (resolution >= 360) {
        // SD
        ++resStatsMap.resTimeShare.sdVideo;
    } else if (resolution > 0) {
        // LD
        ++resStatsMap.resTimeShare.ldVideo;
    } else {
        // NV
        ++resStatsMap.resTimeShare.noVideo;
    }
}

/**
 * Compute how much time as a percentage of the total, this session spent send each standard definition.
 *
 * @param {ResStatsMap} resStatsMap
 * @returns {ResTimeSharePct} - Computed time share as a percentage for each video definition
 */
function calculateResTimeSharePct(resStatsMap) {

    const { totalSamples, resTimeShare } = resStatsMap;

    const resTimeSharePct = {};

    // resTimeSharePct values should amount
    resTimeSharePct.hdVideo = percentOf(resTimeShare.hdVideo, totalSamples);
    resTimeSharePct.sdVideo = percentOf(resTimeShare.sdVideo, totalSamples);
    resTimeSharePct.ldVideo = percentOf(resTimeShare.ldVideo, totalSamples);
    resTimeSharePct.noVideo = percentOf(resTimeShare.noVideo, totalSamples);

    return resTimeSharePct;
}

/**
 * Calculate aggregates of the provided resolution map.
 *
 * @param {Object} usedResolutions Contains a map of the used definitions throughout the session.
 * @returns {{min: Number,max: Number, median: Number}}
 */
function calculateResAggregates(usedResolutions) {

    const sortedRes = Object.values(usedResolutions).sort();

    const aggregateValues = {
        min: 0,
        max: 0,
        median: 0
    };

    if (!sortedRes.length) {
        return aggregateValues;
    }

    aggregateValues.min = sortedRes[0];
    aggregateValues.max = sortedRes[sortedRes.length - 1];
    aggregateValues.median = sortedRes[Math.floor(sortedRes.length / 2)];

    return aggregateValues;
}

/**
 * Map resolution to object properties, so we have an aggregated view of what resolutions were used.
 *
 * @param {Object} usedResolutions
 * @param {Number} resolution
 */
function fitResToAggregateMap(usedResolutions, resolution) {
    if (!resolution) {
        return;
    }

    usedResolutions[resolution] = resolution;
}

/**
 *
 * @param {*} outputAggregates
 * @param {*} totalPackets
 */
function aggregateTotalPackets(outputPacketsAggregate, ssrcPackets) {
    if (!ssrcPackets) {
        return;
    }
    const { ssrc } = ssrcPackets;

    const {
        packetsLost: prevPacketsLost = 0,
        packetsSent: prevPacketsSent = 0,
        samples = 0
    } = outputPacketsAggregate[ssrc] || {};
    const {
        packetsLost = 0,
        packetsSent = 0,
        mediaType
    } = ssrcPackets;

    Object.assign(outputPacketsAggregate, {
        [ssrc]: {
            packetsLost: prevPacketsLost <= packetsLost ? packetsLost : prevPacketsLost,
            packetsSent: prevPacketsSent <= packetsSent ? packetsSent : prevPacketsSent,
            samples: samples + 1,
            mediaType
        }
    });
}


/**
 *
 * @param {*} packetsLostMap
 */
function calculatePacketStats(packetsLostMap) {
    const sentMediaTotals = Object.values(packetsLostMap).reduce((acc, currentSsrc) => {

        const { mediaType, packetsLost, packetsSent, samples } = currentSsrc;
        const {
            packetsLost: packetsLostResult = 0,
            packetsSent: packetsSentResult = 0,
            samples: samplesResult = 0
        } = acc[mediaType] || {};

        return { ...acc,
            [mediaType]: {
                packetsLost: packetsLost + packetsLostResult,
                packetsSent: packetsSent + packetsSentResult,
                samples: samples + samplesResult
            }
        };
    }, {});

    return Object.entries(sentMediaTotals).reduce((acc, [ mediaType, packetSummary ]) => {
        const { packetsLost, packetsSent, samples } = packetSummary;

        return { ...acc,
            [mediaType]: {
                ...packetSummary,
                packetsLostMean: round(packetsLost / samples, 2),
                packetsLostPct: percentOf(packetsLost, packetsSent)
            }
        };
    }, {});
}

/**
 * Mean RTT, send and recv bitrate of the active candidate pair
 *
 * @param {*} client
 * @param {*} peerConnectionLog
 */
function stats(client, peerConnectionLog) {
    const feature = {};
    const rtts = [];
    const recv = [];
    const send = [];
    const packetsLostMap = {};
    const usedResolutions = {};

    /**
     * @type {ResStatsMap}
     */
    const resStatsMap = {
        totalSamples: 0,
        resTimeShare: {
            noVideo: 0,
            ldVideo: 0,
            sdVideo: 0,
            hdVideo: 0
        }
    };

    let lastStatsReport;

    const getBitRate = getBitRateFn(client);
    const getRTT = getRTTFn(client);
    const getTotalPackets = getTotalPacketsFn(client);
    const getUsedResolution = getUsedResolutionFn(client);


    // Iterate over the getStats entries for this specific PC and calculate the average roundTripTime
    // data from the candidate-pair statistic.
    peerConnectionLog.forEach(entry => {
        if (!isStatisticEntry(entry.type)) {
            return;
        }
        const statsReport = entry.value;

        // look for type track, remoteSource: false, audioLevel (0..1)
        Object.keys(statsReport).forEach(id => {
            const report = statsReport[id];

            // Some reports like firefox don't have the stats id as a field, it's needed in some feature extraction
            // functions.
            report.id = id;

            const rtt = getRTT(statsReport, report);

            rtt && rtts.push(rtt);

            aggregateTotalPackets(packetsLostMap, getTotalPackets(report, statsReport));
            const resolution = getUsedResolution(report, statsReport);

            fitResToDefinition(resStatsMap, resolution);
            fitResToAggregateMap(usedResolutions, resolution);
            const { sendBitRate, recvBitRate } = getBitRate(report, lastStatsReport, statsReport) || {};

            recvBitRate && recv.push(recvBitRate);
            sendBitRate && send.push(sendBitRate);
        });

        lastStatsReport = statsReport;
    });

    const packetAggregates = calculatePacketStats(packetsLostMap);
    const restTimeSharePct = calculateResTimeSharePct(resStatsMap);
    const resAggregates = calculateResAggregates(usedResolutions);

    feature.NoVideoPct = restTimeSharePct.noVideo;
    feature.LDVideoPct = restTimeSharePct.ldVideo;
    feature.SDVideoPct = restTimeSharePct.sdVideo;
    feature.HDVideoPct = restTimeSharePct.hdVideo;
    feature.minVideoRes = resAggregates.min;
    feature.medianVideoRes = resAggregates.median;
    feature.maxVideoRes = resAggregates.max;

    feature.meanRoundTripTime = round(rtts.reduce((a, b) => a + b, 0) / (rtts.length || 1), 2);
    feature.meanReceivingBitrate = Math.floor(recv.reduce((a, b) => a + b, 0) / (recv.length || 1));
    feature.meanSendingBitrate = Math.floor(send.reduce((a, b) => a + b, 0) / (send.length || 1));

    if (packetAggregates.video) {
        feature.videoPacketsLostTotal = packetAggregates.video.packetsLost;
        feature.videoPacketsSentTotal = packetAggregates.video.packetsSent;
        feature.videoPacketsLostPct = packetAggregates.video.packetsLostPct;
        feature.meanVideoPacketsLost = packetAggregates.video.packetsLostMean;
    }

    if (packetAggregates.audio) {
        feature.audioPacketsLostTotal = packetAggregates.audio.packetsLost;
        feature.audioPacketsSentTotal = packetAggregates.audio.packetsSent;
        feature.audioPacketsLostPct = packetAggregates.audio.packetsLostPct;
        feature.meanAudioPacketsLost = packetAggregates.audio.packetsLostMean;
    }

    return feature;
}


module.exports = { stats };
