/* eslint-disable */

const {
    capitalize,
    standardizedMoment
} = require('../utils/utils');

/**
 *
 * @param {*} peerConnectionLog
 */
function extractBWE(peerConnectionLog) {
    const reports = [];

    for (let i = 0; i < peerConnectionLog.length; i++) {
        if (peerConnectionLog[i].type === 'getStats') {
            const statsReport = peerConnectionLog[i].value;

            Object.keys(statsReport).forEach(id => {
                const report = statsReport[id];

                if (report.type === 'VideoBwe') {
                    reports.push(report);
                }
            });
        }
    }

    return reports;
}


/**
 * @deprecated
 * TODO Not working atm.
 * @param {*} client
 * @param {*} peerConnectionLog
 */
function dtlsCipherSuite(client, peerConnectionLog) {
    let dtlsCipher;

    for (let i = 0; i < peerConnectionLog.length; i++) {
        if (peerConnectionLog[i].type !== 'getStats') {
            continue;
        }
        const statsReport = peerConnectionLog[i].value;

        // eslint-disable-next-line no-loop-func
        Object.keys(statsReport).forEach(id => {
            const report = statsReport[id];

            if (report.type === 'googComponent' && report.dtlsCipher) {
                dtlsCipher = report.dtlsCipher;
            }
        });
        if (dtlsCipher) {
            return dtlsCipher;
        }
    }
}

/**
     * @deprecated
     * TODO Not working atm.
     * @param {*} client
     * @param {*} peerConnectionLog
     */
function srtpCipherSuite(client, peerConnectionLog) {
    let srtpCipher;

    for (let i = 0; i < peerConnectionLog.length; i++) {
        if (peerConnectionLog[i].type !== 'getStats') {
            continue;
        }
        const statsReport = peerConnectionLog[i].value;

        // eslint-disable-next-line no-loop-func
        Object.keys(statsReport).forEach(id => {
            const report = statsReport[id];

            if (report.type === 'googComponent' && report.srtpCipher) {
                srtpCipher = report.srtpCipher;
            }
        });
        if (srtpCipher) {
            return srtpCipher;
        }
    }
}

/**
     * @deprecated
     * Calculate mean RTT and max RTT for the first 30 seconds of the connectio.n
     * As it stands this report is only supported for google-legacy type format,
     * i.e. 'candidate-pair' with 'selected' field is only available for chrome legacy and firefox,
     * however on firefox 'roundTripTime' isn't available on 'candidate-pair', deprecating for now.
     *
     * @param {*} client
     * @param {*} peerConnectionLog
     */
function stunRTTInitial30s(client, peerConnectionLog) {
    let startTime;
    const rtts = [];

    for (let i = 0; i < peerConnectionLog.length; i++) {
        const { type, value, timestamp } = peerConnectionLog[i];

        if (type !== 'getStats') {
            continue;
        }
        if (!startTime) {
            startTime = timestamp;
        }
        Object.keys(value).forEach(id => {
            const report = value[id];

            if (report.type === 'candidate-pair' && report.selected === true) {
                rtts.push(report.roundTripTime);
            }
        });
        if (timestamp - startTime > 30 * 1000) {
            break;
        }
    }
    if (rtts.length > 2) {
        return {
            mean: Math.floor(rtts.reduce((a, b) => a + b, 0) / rtts.length),
            max: Math.max.apply(null, rtts)
        };
    }
}

/**
 * @deprecated
 * how did the selected interface type change? e.g. a wifi->mobile transition
 * eslint-disable-next-line max-len
 * see https://code.google.com/p/chromium/codesearch#chromium/src/third_party/libjingle/source/talk/app/webrtc/statscollector.cc&q=statscollector&sq=package:chromium&l=53
 * TODO: check if this really allows detecting such transitions
 *
 * @param {*} client
 * @param {*} peerConnectionLog
 */
function candidatePairChangeInterfaceTypes(client, peerConnectionLog) {
    const interfaceTypesList = [ null ];

    for (let i = 0; i < peerConnectionLog.length; i++) {
        if (peerConnectionLog[i].type !== 'getStats') {
            continue;
        }
        const statsReport = peerConnectionLog[i].value;

        Object.keys(statsReport).forEach(id => {
            const report = statsReport[id];

            if (
                report.type === 'candidate-pair'
                    && report.selected === true
                    && statsReport[report.localCandidateId]
            ) {
                const type = statsReport[report.localCandidateId].networkType;

                if (type && type !== interfaceTypesList[interfaceTypesList.length - 1]) {
                    interfaceTypesList.push(type);
                }
            }
        });
    }
    interfaceTypesList.shift();

    return interfaceTypesList.join(';') || 'unknown';
}

/**
 * @deprecated
 *
 * @param {*} client
 * @param {*} peerConnectionLog
 */
function bwe(client, peerConnectionLog) {
    let bwe = extractBWE(peerConnectionLog);

    if (!bwe.length) {
        return;
    }
    const stats = [
        'googActualEncBitrate',
        'googRetransmitBitrate',
        'googTargetEncBitrate',
        'googBucketDelay',
        'googTransmitBitrate'
    ];

    bwe = bwe.map(item => {
        stats.forEach(stat => {
            item[stat] = parseInt(item[stat], 10);
        });
        delete item.googAvailableSendBandwidth;
        delete item.googAvailableReceiveBandwidth;

        return item;
    });
    stats.push('availableOutgoingBitrate');
    stats.push('availableIncomingBitrate');

    const feature = {};

    stats.forEach(stat => {
        const series = bwe.map(item => item[stat]);

        feature[`${capitalize(stat)}Mean`] = series.reduce((a, b) => a + b, 0) / series.length;
        feature[`${capitalize(stat)}Max`] = Math.max.apply(null, series);
        feature[`${capitalize(stat)}Min`] = Math.min.apply(null, series);

        feature[`${capitalize(stat)}Variance`] = standardizedMoment(series, 2);

        /*
            feature[capitalize(stat) + 'Skewness'] = standardizedMoment(series, 3);
            feature[capitalize(stat) + 'Kurtosis'] = standardizedMoment(series, 4);
            */
    });

    return feature;
}
