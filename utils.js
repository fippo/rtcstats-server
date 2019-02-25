/* feature extraction utils */

function capitalize(str) {
    return str[0].toUpperCase() + str.substr(1);
}

// determine mode (most common) element in a series.
function mode(series) {
    var modes = {};
    series.forEach(item => {
        if (!modes[item]) modes[item] = 0;
        modes[item]++;
    });

    var value = -1;
    var max = -1;
    Object.keys(modes).forEach(key => {
        if (modes[key] > max) {
            max = modes[key];
            value = key;
        }
    });
    return value;
}

// Calculate standardized moment.
// order=1: 0
// order=2: variance
// order=3: skewness
// order=4: kurtosis
function standardizedMoment(series, order) {
    var len = series.length || 1;
    var mean = series.reduce((a, b) => a + b, 0) / len;
    return series.reduce((a, b) => a + Math.pow(b - mean, order), 0) / len;
}

// extracts stream id, track id and kind from the format used in addTrack/ontrack
function extractFromTrackFormat(value) {
    const [kind, trackId] = value.split(' ')[0].split(':');
    const streamId = value.split(' ')[1].split(':')[1];
    return {kind, trackId, streamId};
}

// extracts stream id, track id and kind from the format used in legacy addStream/onaddstream
function extractFromStreamFormat(value) {
    const [streamId, trackList] = value.split(' ');
    const tracks = [];
    trackList.split(',').forEach(id => {
        const [kind, trackId] = id.split(':');
        tracks.push({kind, trackId});
    });
    return {streamId, tracks};
}

// extracts a Map with all local and remote audio/video tracks.
function extractTracks(peerConnectionLog) {
    const tracks = new Map();
    for (let i = 0; i < peerConnectionLog.length; i++) {
        const {type, value} = peerConnectionLog[i];
        if (type === 'addStream') {
            const {streamId, tracks: listOfTracks} = extractFromStreamFormat(value);
            listOfTracks.forEach(({kind, trackId}) => {
                tracks.set(trackId, {kind, streamId, direction: 'send', stats: []});
            });
        } else if (type === 'addTrack' || type === 'ontrack') {
            const direction = type === 'addTrack' ? 'send' : 'recv';
            const {kind, trackId, streamId} = extractFromTrackFormat(value);
            tracks.set(trackId, {kind, streamId, direction, stats: []});
        } else if (type === 'getStats') {
            Object.keys(value).forEach(id => {
                const report = value[id];
                if (report.type === 'ssrc') {
                    const {trackIdentifier} =  report;
                    if (tracks.has(trackIdentifier)) {
                        if (!report.timestamp) {
                            report.timestamp = peerConnectionLog[i].time;
                        } else {
                            report.timestamp = new Date(report.timestamp);
                        }
                        const currentStats = tracks.get(trackIdentifier).stats;
                        const lastStat = currentStats[currentStats.length - 1];
                        if (!lastStat || (report.timestamp.getTime() - lastStat.timestamp.getTime() > 0)) {
                            tracks.get(trackIdentifier).stats.push(report);
                        }
                    } else if (trackIdentifier !== undefined) {
                        console.log('NO ONTRACK FOR', trackIdentifier, report.ssrc);
                    }
                }
            });
        }
    }
    return tracks;
}

module.exports = {
    capitalize,
    extractTracks,
    mode,
    standardizedMoment,
}
