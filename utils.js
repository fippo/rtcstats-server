/* feature extraction utils */

function capitalize(str) {
    return str[0].toUpperCase() + str.substr(1);
}

// determine mode (most common) element in a series.
function mode(series) {
    const modes = {};
    series.forEach(item => {
        if (!modes[item]) modes[item] = 0;
        modes[item]++;
    });

    let value = -1;
    let max = -1;
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
    const len = series.length || 1;
    const mean = series.reduce((a, b) => a + b, 0) / len;
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
            const direction = 'send';
            listOfTracks.forEach(({kind, trackId}) => {
                tracks.set(direction + ':' + trackId, {kind, streamId, trackId, direction, stats: []});
            });
        } else if (type === 'addTrack' || type === 'ontrack') {
            const direction = type === 'addTrack' ? 'send' : 'recv';
            const {kind, trackId, streamId} = extractFromTrackFormat(value);
            tracks.set(direction + ':' + trackId, {kind, streamId, trackId, direction, stats: []});
        } else if (type === 'getStats') {
            Object.keys(value).forEach(id => {
                const report = value[id];
                if (report.type === 'ssrc') {
                    const {trackIdentifier} =  report;
                    const direction = id.endsWith('_recv') ? 'recv' : 'send';
                    const key = direction + ':' + trackIdentifier;
                    if (tracks.has(key)) {
                        if (!report.timestamp) {
                            report.timestamp = peerConnectionLog[i].time;
                        } else {
                            report.timestamp = new Date(report.timestamp);
                        }
                        const currentStats = tracks.get(key).stats;
                        const lastStat = currentStats[currentStats.length - 1];
                        if (!lastStat || (report.timestamp.getTime() - lastStat.timestamp.getTime() > 0)) {
                            tracks.get(key).stats.push(report);
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

function timeBetween(logs, startEvents, endEvents) {
    let first;
    for (let i = 0; i < logs.length; i++) {
        const log = logs[i];
        if (startEvents.includes(log.type)) {
            first = log;
        } else if (endEvents.includes(log.type)) {
            if (first) {
                return log.timestamp - first.timestamp;
            } else {
                return -1;
            }
        }
    }
}

function extractStreams(tracks) {
    const streams = new Map();
    for (const [trackId, {streamId}] of tracks.entries()) {
        if (streams.has(streamId)) {
            streams.get(streamId).push(tracks.get(trackId));
        } else {
            streams.set(streamId, [tracks.get(trackId)]);
        }
    }
    return streams;
}

function isIceConnected({type, value}) {
    return type === 'oniceconnectionstatechange' && ['connected', 'completed'].includes(value);
}

const tempPath = 'temp';

function tempStreamPath(clientid, peerConnectionId) {
    return `${tempPath}/${clientid}-${peerConnectionId}`;
}

module.exports = {
    capitalize,
    extractTracks,
    extractStreams,
    isIceConnected,
    mode,
    standardizedMoment,
    timeBetween,
    tempStreamPath,
    tempPath
}
