'use strict';
// https://en.wikipedia.org/wiki/Feature_extraction for peerconnection
// API traces and getStats data.
// there are two types of features
// 1) features which only take the client as argument. E.g. extracting the browser version
// 2) features which take the client and a connection argument. Those do something with the connection.
// 3) features which are specific to a track.
// The third type of feature is contained in this file.

const {capitalize, mode, standardizedMoment} = require('./utils');
// each feature expects {kind, direction, trackId, stats} as argument.
module.exports = {
    numberOfStats: ({stats}) => stats.length, 
    kind: ({kind}) => kind,
    direction: ({direction}) => direction,
    duration: ({kind, direction, trackId, stats}) => {
        if (stats.length < 2) {
            return 0;
        }
        const first = stats[0];
        const last = stats[stats.length - 1];
        return last.timestamp.getTime() - first.timestamp.getTime();
    },
};

/* these features operate on stats of each track, in send and recv direction */
['audio', 'video'].forEach(statKind => {
    ['send', 'recv'].forEach(statDirection => {
        module.exports[statKind + capitalize(statDirection)] = function({kind, direction, trackId, stats}) {
            if (kind !== statKind || direction !== statDirection) {
                return;
            }
            const feature = {};
            ['audioLevel', 'googJitterReceived',
                'googRtt', 'googEncodeUsagePercent',
                'googCurrentDelayMs', 'googJitterBufferMs',
                'googPreferredJitterBufferMs', 'googJitterBufferMs',
                'googDecodeMs', 'googMaxDecodeMs',
                'googMinPlayoutDelayMs', 'googRenderDelayMs', 'googTargetDelayMs'
            ].forEach(statName => {
                if (kind !== 'audio' || typeof stats[0][statName] === 'undefined') {
                    return;
                }
                const series = stats.map(item => parseInt(item[statName], 10));

                feature[statName + 'Mean'] = series.reduce((a, b) => a + b, 0) / series.length;

                feature[statName + 'Max'] = Math.max.apply(null, series);
                feature[statName + 'Min'] = Math.min.apply(null, series);

                feature[statName + 'Variance'] = standardizedMoment(series, 2);
                feature[statName + 'Skewness'] = standardizedMoment(series, 3);
                feature[statName + 'Kurtosis'] = standardizedMoment(series, 4);
            });
            ['googFrameHeightInput', 'googFrameHeightSent', 'googFrameWidthInput', 'googFrameWidthSent',
               'googFrameHeightReceived', 'googFrameWidthReceived'].forEach(statName => {
                if (kind !== 'video' || typeof stats[0][statName] === 'undefined') {
                    return;
                }
                // mode, max, min
                const series = stats.map(item => parseInt(item[statName], 10));

                feature[statName + 'Max'] = Math.max.apply(null, series);
                feature[statName + 'Min'] = Math.min.apply(null, series);
                feature[statName + 'Mode'] = mode(series);
            });

            ['googCpuLimitedResolution', 'googBandwidthLimitedResolution'].forEach(statName => {
                if (kind !== 'video' || typeof stats[0][statName] === 'undefined') {
                    return;
                }
                const series = stats.map(item => (item[statName] === 'true' ? 1 : 0));

                feature[statName + 'Mean'] = series.reduce((a, b) => a + b, 0) / series.length;
                feature[statName + 'Max'] = Math.max.apply(null, series);
                feature[statName + 'Min'] = Math.min.apply(null, series);
                feature[statName + 'Mode'] = mode(series);
            });

            // RecentMax is over a 10s window.
            ['googResidualEchoLikelihoodRecentMax'].forEach(statName => {
                if (kind !== 'audio' || typeof stats[0][statName] === 'undefined') {
                    return;
                }

                const series = stats.map(item => parseFloat(item[statName], 10));

                feature[statName + 'Mean'] = series.reduce((a, b) => a + b, 0) / series.length;
                feature[statName + 'Max'] = Math.max.apply(null, series);

                feature[statName + 'Variance'] = standardizedMoment(series, 2);
                feature[statName + 'Skewness'] = standardizedMoment(series, 3);
                feature[statName + 'Kurtosis'] = standardizedMoment(series, 4);
            });

            // statNames for which we are interested in the difference between values.
            ['packetsReceived', 'packetsSent', 'packetsLost', 'bytesSent', 'bytesReceived'].forEach(statName => {
                if (typeof stats[0][statName] === 'undefined') {
                    return;
                }
                let i;
                const conversionFactor = statName.indexOf('bytes') === 0 ? 8 : 1; // we want bits/second
                if (typeof stats[0][statName] === 'undefined') {
                    return;
                }
                const series = stats.map(item => parseInt(item[statName], 10));
                const dt = stats.map(item => item.timestamp);
                // calculate the difference
                for (i = 1; i < series.length; i++) {
                    series[i - 1] = series[i] - series[i - 1];
                    dt[i - 1] = dt[i] - dt[i - 1];
                }
                series.length = series.length - 1;
                dt.length = dt.length - 1;
                for (i = 0; i < series.length; i++) {
                    series[i] = Math.floor(series[i] * 1000 / dt[i]) * conversionFactor;
                }

                // filter negative values -- https://bugs.chromium.org/p/webrtc/issues/detail?id=5361
                series.filter(x => isFinite(x) && !isNaN(x) && x >= 0);

                feature[statName + 'Delta' + 'Mean'] = series.reduce((a, b) => a + b, 0) / series.length;
                feature[statName + 'Max'] = Math.max.apply(null, series);
                feature[statName + 'Min'] = Math.min.apply(null, series);
                feature[statName + 'Mode'] = mode(series);

                feature[statName + 'Variance'] = standardizedMoment(series, 2);
                feature[statName + 'Skewness'] = standardizedMoment(series, 3);
                feature[statName + 'Kurtosis'] = standardizedMoment(series, 4);
            });
            if (Object.keys(feature).length === 0) {
                return;
            }
            return feature;
        };
    });
});