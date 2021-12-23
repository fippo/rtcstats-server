// https://en.wikipedia.org/wiki/Feature_extraction for peerconnection
// API traces and getStats data.
// there are two types of features
// 1) features which only take the client as argument. E.g. extracting the browser version
// 2) features which take the client and a connection argument. Those do something with the connection.
// 3) features which are specific to a track.
// The third type of feature is contained in this file.

const { mode, standardizedMoment } = require('../utils/utils');


// each feature expects {kind, direction, trackId, stats} as argument.
module.exports = {
    numberOfStats: ({ stats }) => stats.length,
    direction: ({ direction }) => direction,
    duration: ({ stats }) => {
        if (stats.length < 2) {
            return 0;
        }
        const first = stats[0];
        const last = stats[stats.length - 1];

        return last.timestamp.getTime() - first.timestamp.getTime();
    },
    active: ({ direction, stats }) => {
        if (stats.length < 2) {
            return 0;
        }
        const statName = direction === 'send' ? 'bytesSent' : 'bytesReceived';
        let duration = 0;

        for (let i = 1; i < stats.length; i++) {
            if (stats[i][statName] !== stats[i - 1][statName]) {
                duration += stats[i].timestamp.getTime() - stats[i - 1].timestamp.getTime();
            }
        }

        return duration;
    },
    qpSum: ({ kind, stats }) => {
        if (kind !== 'video' || !stats.length) {
            return;
        }
        const last = stats[stats.length - 1];

        return last.qpSum;
    },
    frameCount: ({ kind, stats }) => {
        if (kind !== 'video' || !stats.length) {
            return;
        }
        const last = stats[stats.length - 1];

        return last.framesEncoded || last.framesDecoded;
    }
};

/* these features operate on stats of each track, in send and recv direction */
module.exports.audio = function({ kind, direction, stats }) {
    const feature = {};

    [ 'send', 'recv' ].forEach(statDirection => {
        if (kind !== 'audio' || direction !== statDirection) {
            return;
        }
        [ 'codec' ].forEach(statName => {
            const codecName = stats
                .filter(stat => Boolean(stat.googCodecName))
                .map(stat => stat.googCodecName)[0];

            if (codecName !== '') {
                feature[statName] = codecName;
            }
        });
        [
            'audioLevel',
            'googJitterReceived',
            'googRtt',
            'googEncodeUsagePercent',
            'googCurrentDelayMs',
            'googJitterBufferMs',
            'googPreferredJitterBufferMs',
            'googJitterBufferMs',
            'googDecodeMs',
            'googMaxDecodeMs',
            'googMinPlayoutDelayMs',
            'googRenderDelayMs',
            'googTargetDelayMs'
        ].forEach(statName => {
            if (!stats.length || typeof stats[0][statName] === 'undefined') {
                return;
            }
            const series = stats.map(item => parseInt(item[statName], 10));

            if (statName === 'audioLevel') {
                // eslint-disable-next-line no-param-reassign
                statName = 'level';
            }
            feature[`${statName}Mean`] = series.reduce((a, b) => a + b, 0) / series.length;

            feature[`${statName}Max`] = Math.max.apply(null, series);
            feature[`${statName}Min`] = Math.min.apply(null, series);

            feature[`${statName}Variance`] = standardizedMoment(series, 2);

            /*
            feature[statName + 'Skewness'] = standardizedMoment(series, 3);
            feature[statName + 'Kurtosis'] = standardizedMoment(series, 4);
            */
        });

        // RecentMax is over a 10s window.
        [ 'googResidualEchoLikelihoodRecentMax' ].forEach(statName => {
            if (!stats.length || typeof stats[0][statName] === 'undefined') {
                return;
            }

            const series = stats.map(item => parseFloat(item[statName], 10));

            feature[`${statName}Mean`] = series.reduce((a, b) => a + b, 0) / series.length;
            feature[`${statName}Max`] = Math.max.apply(null, series);

            feature[`${statName}Variance`] = standardizedMoment(series, 2);

            /*
            feature[statName + 'Skewness'] = standardizedMoment(series, 3);
            feature[statName + 'Kurtosis'] = standardizedMoment(series, 4);
            */
        });

        // statNames for which we are interested in the difference between values.
        // Also these have the same name for audio and video so we need to include the kind.
        [ 'packetsReceived', 'packetsSent', 'packetsLost', 'bytesSent', 'bytesReceived' ].forEach(
            statName => {
                if (!stats.length || typeof stats[0][statName] === 'undefined') {
                    return;
                }
                const conversionFactor = statName.indexOf('bytes') === 0 ? 8 : 1; // we want bits/second
                let series = stats.map(item => parseInt(item[statName], 10));
                const dt = stats.map(item => item.timestamp);


                // calculate the difference
                for (let i = 1; i < series.length; i++) {
                    series[i - 1] = series[i] - series[i - 1];
                    dt[i - 1] = dt[i] - dt[i - 1];
                }
                series.length = series.length - 1;
                dt.length = dt.length - 1;
                for (let i = 0; i < series.length; i++) {
                    series[i] = Math.floor((series[i] * 1000) / dt[i]) * conversionFactor;
                }

                // filter negative values -- https://bugs.chromium.org/p/webrtc/issues/detail?id=5361
                series = series.filter(x => isFinite(x) && !isNaN(x) && x >= 0);

                feature[`${statName}Mean`] = series.reduce((a, b) => a + b, 0) / series.length;
                feature[`${statName}Max`] = Math.max.apply(null, series);
                feature[`${statName}Min`] = Math.min.apply(null, series);

                feature[`${statName}Variance`] = standardizedMoment(series, 2);

                /*
            feature[statName + 'Skewness'] = standardizedMoment(series, 3);
            feature[statName + 'Kurtosis'] = standardizedMoment(series, 4);
            */
            }
        );
    });
    if (Object.keys(feature).length === 0) {
        return;
    }

    return feature;
};

module.exports.video = function({ kind, direction, stats }) {
    const feature = {};

    [ 'send', 'recv' ].forEach(statDirection => {
        if (kind !== 'video' || direction !== statDirection) {
            return;
        }
        [ 'codec' ].forEach(statName => {
            const codecName = stats
                .filter(stat => Boolean(stat.googCodecName))
                .map(stat => stat.googCodecName)[0];

            if (codecName !== '') {
                feature[statName] = codecName;
            }
        });
        [
            'googFrameHeightInput',
            'googFrameHeightSent',
            'googFrameWidthInput',
            'googFrameWidthSent',
            'googFrameHeightReceived',
            'googFrameWidthReceived',
            'googInterframeDelayMax'
        ].forEach(statName => {
            if (!stats.length || typeof stats[0][statName] === 'undefined') {
                return;
            }

            // mode, max, min
            const series = stats.map(item => parseInt(item[statName], 10));

            feature[`${statName}Max`] = Math.max.apply(null, series);
            feature[`${statName}Min`] = Math.min.apply(null, series);
            feature[`${statName}Mean`] = mode(series);
        });

        [ 'googCpuLimitedResolution', 'googBandwidthLimitedResolution' ].forEach(statName => {
            if (!stats.length || typeof stats[0][statName] === 'undefined') {
                return;
            }
            // eslint-disable-next-line no-confusing-arrow
            const series = stats.map(item => item[statName] === 'true' ? 1 : 0);

            feature[`${statName}Mean`] = series.reduce((a, b) => a + b, 0) / series.length;
            feature[`${statName}Max`] = Math.max.apply(null, series);
            feature[`${statName}Min`] = Math.min.apply(null, series);
            feature[`${statName}Mode`] = mode(series);
        });

        // statNames for which we are interested in the difference between values.
        // Also these have the same name for audio and video so we need to include the kind.
        [ 'packetsReceived', 'packetsSent', 'packetsLost', 'bytesSent', 'bytesReceived' ].forEach(
            statName => {
                const conversionFactor = statName.indexOf('bytes') === 0 ? 8 : 1; // we want bits/second

                if (!stats.length || typeof stats[0][statName] === 'undefined') {
                    return;
                }
                let series = stats.map(item => parseInt(item[statName], 10));
                const dt = stats.map(item => item.timestamp);


                // calculate the difference
                for (let i = 1; i < series.length; i++) {
                    series[i - 1] = series[i] - series[i - 1];
                    dt[i - 1] = dt[i] - dt[i - 1];
                }
                series.length = series.length - 1;
                dt.length = dt.length - 1;
                for (let i = 0; i < series.length; i++) {
                    series[i] = Math.floor((series[i] * 1000) / dt[i]) * conversionFactor;
                }

                // filter negative values -- https://bugs.chromium.org/p/webrtc/issues/detail?id=5361
                series = series.filter(x => isFinite(x) && !isNaN(x) && x >= 0);

                feature[`${statName}Mean`] = series.reduce((a, b) => a + b, 0) / series.length;
                feature[`${statName}Max`] = Math.max.apply(null, series);
                feature[`${statName}Min`] = Math.min.apply(null, series);

                feature[`${statName}Variance`] = standardizedMoment(series, 2);

                /*
            feature[statName + 'Skewness'] = standardizedMoment(series, 3);
            feature[statName + 'Kurtosis'] = standardizedMoment(series, 4);
            */
            }
        );
    });
    if (Object.keys(feature).length === 0) {
        return;
    }

    return feature;
};
