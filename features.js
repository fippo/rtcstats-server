'use strict';
// https://en.wikipedia.org/wiki/Feature_extraction for peerconnection
// API traces and getStats data.

var fs = require('fs');
var platform = require('platform');

function capitalize(str) {
    return str[0].toUpperCase() + str.substr(1);
}

function getPeerConnectionConfig(peerConnectionLog) {
    for (var i = 0; i < peerConnectionLog.length; i++) {
        if (peerConnectionLog[i].type === 'create') {
            return peerConnectionLog[i].value;
        }
    }
}

function getPeerConnectionConstraints(peerConnectionLog) {
    for (var i = 0; i < peerConnectionLog.length; i++) {
        if (peerConnectionLog[i].type === 'constraints') {
            return peerConnectionLog[i].value;
        }
    }
}

function determineBrowserFromOLine(sdp) {
    if (sdp.indexOf('v=0\r\no=mozilla...THIS_IS_SDPARTA') === 0) {
        return 'moz';
    } else if (sdp.indexOf('v=0\r\no=thisisadapterortc') === 0) {
        return 'edge';
    } else if (sdp.indexOf('a=msid-semantic: WMS APPEAR\r\n') === 0) {
        return 'appear.in mobile';
    } else {
        return 'webrtc.org'; // maybe?
    }
}

function gatheringTimeTURN(protocol, client, peerConnectionLog) {
    var peerConnectionConfig = getPeerConnectionConfig(peerConnectionLog);
    var typepref;
    switch(peerConnectionConfig.browserType) {
    case 'webkit':
        typepref = {
            udp: 2,
            tcp: 1,
            tls: 0
        }[protocol];
        break;
    case 'moz':
        typepref = {
            udp: 5,
            tcp: 0
        }[protocol];
        break;
    default:
        typepref = 'unknown';
        break;
    }

    var first;
    var second;
    for (first = 0; first < peerConnectionLog.length; first++) {
        // TODO: is setLocalDescriptionOnSuccess better?
        if (peerConnectionLog[first].type === 'setLocalDescription') break;
    }
    if (first < peerConnectionLog.length) {
        for (second = first + 1; second < peerConnectionLog.length; second++) {
            if (peerConnectionLog[second].type === 'onicecandidate') {
                var cand = peerConnectionLog[second].value;
                if (cand === null) return; // give up
                if (cand && cand.candidate.indexOf('relay') !== -1) {
                    var localTypePref = cand.candidate.split(' ')[3] >> 24;
                    if (localTypePref === typepref) {
                        break;
                    }
                }
            }
        }
        if (second < peerConnectionLog.length) {
            return (new Date(peerConnectionLog[second].time).getTime() -
                new Date(peerConnectionLog[first].time).getTime());
        }
    }
}

function extractLastVideoStat(peerConnectionLog, type) {
    var statsReport;
    for (var i = peerConnectionLog.length - 1; i >= 0; i--) {
        if (peerConnectionLog[i].type === 'getStats') {
            statsReport = peerConnectionLog[i].value;
            break;
        }
    }
    if (!statsReport) return;
    var count;
    Object.keys(statsReport).forEach(id => {
        // type outboundrtp && mediaType video
        var report = statsReport[id];
        if (report.type === 'outboundrtp' && report.mediaType === 'video') {
            count = report[type];
        }
    });
    return count;
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

// extracts the central moment from video statistics.
function extractCentralMomentFromSsrcStat(peerConnectionLog, statName, order, mediaType) {
    var series = [];
    for (var i = 0; i < peerConnectionLog.length; i++) {
        if (peerConnectionLog[i].type === 'getStats') {
            var statsReport = peerConnectionLog[i].value;
            Object.keys(statsReport).forEach(id => {
                var report = statsReport[id];
                if (report.type === 'ssrc' && report.mediaType === mediaType && report[statName]) {
                    series.push(parseInt(report[statName], 10));
                }
            });
        }
    }
    return series.length ? standardizedMoment(series, order) : undefined;
}

function extractCentralMomentFromVideoStat(peerConnectionLog, statName, order) {
    return extractCentralMomentFromSsrcStat(peerConnectionLog, statName, order, 'video');
}

function extractCentralMomentFromAudioStat(peerConnectionLog, statName, order) {
    return extractCentralMomentFromSsrcStat(peerConnectionLog, statName, order, 'audio');
}

// extract the codec used. Has to happen after the connection is up and packets have
// been received or sent.
function getCodec(peerConnectionLog, mediaType, direction) { 
    var codecName;
    var connected = false;
    for (var i = 0; i < peerConnectionLog.length; i++) {
        if (peerConnectionLog[i].type === 'oniceconnectionstatechange') {
            if (peerConnectionLog[i].value === 'connected' || peerConnectionLog[i].value === 'completed') {
                connected = true;
            }
        }
        if (!connected) continue;
        if (peerConnectionLog[i].type !== 'getStats') continue;
        var statsReport = peerConnectionLog[i].value;
        Object.keys(statsReport).forEach(id => {
            var report = statsReport[id];
            if (report.type === 'ssrc' && report.mediaType === mediaType &&
              report.googCodecName && report.googCodecName.length
              && id.indexOf(direction) !== -1) {
                codecName = report.googCodecName;
            }
        });
        if (codecName) return codecName;
    }
}

// extract a local/remote audio or video track.
function extractTrack(peerConnectionLog, kind, direction) {
    var trackId;
    var reports = [];
    var streamevent = 'onaddstream';
    if (direction === 'send') {
        streamevent = 'addStream';
    }
    // search for the (first) track of that kind.
    for (var i = 0; i < peerConnectionLog.length; i++) {
        var type = peerConnectionLog[i].type;
        if (type === streamevent || (direction === 'send' && type === 'addTrack')) {
            if (type === 'addTrack') {
                var kindAndTrack = peerConnectionLog[i].value.split(' ')[0].split(':');
                if (kindAndTrack[0] === kind) {
                    trackId = kindAndTrack[1];
                    break;
                }
            } else {
                var tracks = peerConnectionLog[i].value.split(' ', 2);
                tracks.shift();
                tracks = tracks[0].split(',');
                for (var j = 0; j < tracks.length; j++) {
                    if (tracks[j].split(':')[0] === kind) {
                        trackId = tracks[j].split(':')[1];
                        break;
                    }
                }
            }
            if (trackId) break;
        }
    }
    if (!trackId) return []; // bail out

    // search for signs of that track
    for (; i < peerConnectionLog.length; i++) {
        if (trackId && peerConnectionLog[i].type === 'getStats') {
            var statsReport = peerConnectionLog[i].value;
            Object.keys(statsReport).forEach(id => {
                var report = statsReport[id];
                if (report.type === 'ssrc' && report.trackIdentifier === trackId) {
                    report.timestamp = peerConnectionLog[i].time;
                    reports.push(report);
                }
            });
        }
    }
    return reports;
}

function extractBWE(peerConnectionLog) {
    var reports = [];
    for (var i = 0; i < peerConnectionLog.length; i++) {
        if (peerConnectionLog[i].type === 'getStats') {
            var statsReport = peerConnectionLog[i].value;
            Object.keys(statsReport).forEach(id => {
                var report = statsReport[id];
                if (report.type === 'VideoBwe') {
                    reports.push(report);
                }
            });
        }
    }
    return reports;
}

// there are two types of features
// 1) features which only take the client as argument. E.g. extracting the browser version
// 2) features which take the client and a connection argument. Those do something with the connection.
module.exports = {
    origin: function(client) {
        return client.origin;
    },

    browser: function(client) {
        if (!(client.userAgent && client.userAgent.length)) return;
        var ua = platform.parse(client.userAgent);
        var parts = {
            name: ua.name || 'unknown',
            version: ua.version || '-1',
            os: ua.os.toString(),
            userAgent: client.userAgent,
            nameVersion: ua.name + '/' + ua.version,
            nameOs: ua.name + '/' + ua.os.toString(),
            nameVersionOs: ua.name + '/' + ua.version + '/' + ua.os.toString()
        };
        if (ua.version) {
            parts.majorVersion = ua.version.split('.')[0];
        }
        return parts;
    },

    // did the page call getUserMedia at all?
    calledGetUserMedia: function(client) {
        return client.getUserMedia && client.getUserMedia.length > 0;
    },
    location: function(client) {
        if (!client.location) return;
        var location = client.location;
        return {
            lon: location.location.longitude,
            lat: location.location.latitude,
            lonLat: JSON.stringify([location.location.longitude, location.location.latitude]),
            continent: location.continent.code,
            country: location.country ? location.country.names.en : 'unknown county',
            city: location.city ? location.city.names.en : 'unknown city'
        };
    },

    // did the page use the old getUserMedia?
    calledLegacyGetUserMedia: function(client) {
        var gum = client.getUserMedia || [];
        for (var i = 0; i < gum.length; i++) {
            if (gum[i].type === 'getUserMedia') return true;
        }
        return false;
    },

    // did the page use the new navigator.mediaDevices.getUserMedia?
    calledMediadevicesGetUserMedia: function(client) {
        var gum = client.getUserMedia || [];
        for (var i = 0; i < gum.length; i++) {
            if (gum[i].type === 'navigator.mediaDevices.getUserMedia') return true;
        }
        return false;
    },
    // TODO: was enumerateDevices used? rtcstats does not hook this and I do not think
    // that tracing every call would be useful but enumerating hardware once might
    // be nice for features like numberOfMicrophones, numberOfCameras, ...

    // was there at least one getUserMedia success?
    getUserMediaSuccess: function(client) {
        var gum = client.getUserMedia || [];
        for (var i = 0; i < gum.length; i++) {
            if (gum[i].type === 'navigator.mediaDevices.getUserMediaOnSuccess' || gum[i].type === 'getUserMediaOnSuccess') {
                return true;
            }
        }
        return false;
    },

    // was there at least one getUserMedia error? If so, what was the error?
    getUserMediaError: function(client) {
        var gum = client.getUserMedia || [];
        for (var i = 0; i < gum.length; i++) {
            if (gum[i].type === 'navigator.mediaDevices.getUserMediaOnFailure' || gum[i].type === 'getUserMediaOnFailure') {
                return gum[i].value;
            }
        }
        return false;
    },

    // did the client ever request audio?
    calledGetUserMediaRequestingAudio: function(client) {
        var gum = client.getUserMedia || [];
        var requested = false;
        for (var i = 0; i < gum.length; i++) {
            if (gum[i].type === 'navigator.mediaDevices.getUserMedia' || gum[i].type === 'getUserMedia') {
                var options = gum[i].value;
                if (options.audio && options.audio !== false) requested = true;
            }
        }
        return requested;
    },

    // did the client ever request video (not screenshare)?
    // screensharing is defined as
    //      mozMediaSource || mediaSource in FF (look for window || screen?)
    //      mandatory.chromeMediaSource: desktop in chrome
    calledGetUserMediaRequestingVideo: function(client) {
        var gum = client.getUserMedia || [];
        var requested = false;
        for (var i = 0; i < gum.length; i++) {
            if (gum[i].type === 'navigator.mediaDevices.getUserMedia' || gum[i].type === 'getUserMedia') {
                var options = gum[i].value;
                if (options.video === true) {
                    requested = true;
                    break;
                }
                if (options.video && typeof options.video === 'object') {
                    if (!(options.video.mozMediaSource || options.video.mediaSource || options.video.chromeMediaSource)) {
                        requested = true;
                        break;
                    }
                }
            }
        }
        return requested;
    },

    // did the client ever request the screen?
    // also returns the type even though (in chrome) that is not relevant.
    calledGetUserMediaRequestingScreen: function(client) {
        var gum = client.getUserMedia || [];
        for (var i = 0; i < gum.length; i++) {
            if (gum[i].type === 'navigator.mediaDevices.getUserMedia' || gum[i].type === 'getUserMedia') {
                var options = gum[i].value;
                if (options.video && typeof options.video === 'object') {
                    // Firefox
                    if (options.video.mozMediaSource || options.video.mediaSource) {
                        return options.video.mozMediaSource || options.video.mediaSource;
                    }
                    // Chrome
                    if (options.video.mandatory && options.video.mandatory.chromeMediaSource) {
                        return options.video.mandatory.chromeMediaSource;
                    }
                }
            }
        }
        return false;
    },

    timeBetweenGetUserMediaAndGetUserMediaSuccess: function(client) {
        var gum = client.getUserMedia || [];
        var first;
        for (var i = 0; i < gum.length; i++) {
            if (gum[i].type === 'navigator.mediaDevices.getUserMedia' || gum[i].type === 'getUserMedia') {
                first = gum[i].time;
            } else if (gum[i].type === 'navigator.mediaDevices.getUserMediaOnSuccess' || gum[i].type === 'getUserMediaOnSuccess') {
                if (first) {
                    return new Date(gum[i].time).getTime() - new Date(first).getTime();
                } else {
                    return -1;
                }
            }
        }
    },

    timeBetweenGetUserMediaAndGetUserMediaFailure: function(client) {
        var gum = client.getUserMedia || [];
        var first;
        for (var i = 0; i < gum.length; i++) {
            if (gum[i].type === 'navigator.mediaDevices.getUserMedia' || gum[i].type === 'getUserMedia') {
                first = gum[i].time;
            } else if (gum[i].type === 'navigator.mediaDevices.getUserMediaOnFailure' || gum[i].type === 'getUserMediaOnFailure') {
                if (first) {
                    return new Date(gum[i].time).getTime() - new Date(first).getTime();
                } else {
                    return -1;
                }
            }
        }
    },

    // return the label of the first audio device
    firstAudioTrackLabel: function(client) {
        var gum = client.getUserMedia || [];
        for (var i = 0; i < gum.length; i++) {
            if (gum[i].type === 'navigator.mediaDevices.getUserMediaOnSuccess' || gum[i].type === 'getUserMediaOnSuccess') {
                var stream = gum[i].value;
                var tracks = stream && stream.tracks || [];
                for (var j = 0; j < tracks.length; j++) {
                    if (tracks[j].kind === 'audio') {
                        return tracks[j].label;
                    }
                }
            }
        }
    },

    // return the label of the first video device
    firstVideoTrackLabel: function(client) {
        var gum = client.getUserMedia || [];
        var gum = client.getUserMedia || [];
        for (var i = 0; i < gum.length; i++) {
            if (gum[i].type === 'navigator.mediaDevices.getUserMediaOnSuccess' || gum[i].type === 'getUserMediaOnSuccess') {
                var stream = gum[i].value;
                var tracks = stream && stream.tracks || [];
                for (var j = 0; j < tracks.length; j++) {
                    if (tracks[j].kind === 'video') {
                        return tracks[j].label;
                    }
                }
            }
        }
    },
    // TODO: gum statistics (audio, video, number of tracks, errors, fail-to-acquire aka ended readyState)
    // TODO: resolution, framerate
    // TODO: special goog constraints?
    // TODO: feature for "were the promise-ified apis used or the legacy variants?"

    // number of peerConnections created
    numberOfPeerConnections: function(client) {
        return Object.keys(client.peerConnections).length;
    },

    // client and conference identifiers, specified as optional peerconnection constraints
    // (which are not a thing any longer). See https://github.com/opentok/rtcstats/issues/28
    clientIdentifier: function(client, peerConnectionLog) {
        var constraints = getPeerConnectionConstraints(peerConnectionLog) || [];
        if (!constraints.optional) return;
        constraints = constraints.optional;
        for (var i = 0; i < constraints.length; i++) {
            if (constraints[i].rtcStatsClientId) {
                return constraints[i].rtcStatsClientId;
            }
        }
    },
    peerIdentifier: function(client, peerConnectionLog) {
        var constraints = getPeerConnectionConstraints(peerConnectionLog) || [];
        if (!constraints.optional) return;
        constraints = constraints.optional;
        for (var i = 0; i < constraints.length; i++) {
            if (constraints[i].rtcStatsPeerId) {
                return constraints[i].rtcStatsPeerId;
            }
        }
    },
    conferenceIdentifier: function(client, peerConnectionLog) {
        var constraints = getPeerConnectionConstraints(peerConnectionLog) || [];
        if (!constraints.optional) return;
        constraints = constraints.optional;
        for (var i = 0; i < constraints.length; i++) {
            if (constraints[i].rtcStatsConferenceId) {
                return constraints[i].rtcStatsConferenceId;
            }
        }
    },

    // when did the session start
    startTime: function(client, peerConnectionLog) {
        for (var i = 0; i < peerConnectionLog.length; i++) {
            if (peerConnectionLog[i].type === 'create') {
                return new Date(peerConnectionLog[i].time).getTime();
            }
        }
    },

    // when did the session end
    stopTime: function(client, peerConnectionLog) {
        return new Date(peerConnectionLog[peerConnectionLog.length - 1].time).getTime();
    },

    // how long did the peerconnection live?
    // not necessarily connected which is different from session duration
    lifeTime: function(client, peerConnectionLog) {
        return new Date(peerConnectionLog[peerConnectionLog.length - 1].time).getTime() - new Date(peerConnectionLog[0].time).getTime();
    },

    // the webrtc platform type -- webkit or moz
    // TODO: edge, mobile platforms?
    browserType: function(client, peerConnectionLog) {
        var peerConnectionConfig = getPeerConnectionConfig(peerConnectionLog);
        return peerConnectionConfig.browserType || 'unknown';
    },

    // the remote platform, extracted from the remote description.
    // only works for firefox and edge (using adapter)
    // returns webrtc.org when unknown.
    // TODO: look at chrome specifics?
    remoteType: function(client, peerConnectionLog) {
        for (var i = 0; i < peerConnectionLog.length; i++) {
            if (peerConnectionLog[i].type === 'setRemoteDescription') {
                var sdp = peerConnectionLog[i].value.sdp;
                return determineBrowserFromOLine(sdp);
            }
        }
    },

    // check if we are initiator/receiver (i.e. first called createOffer or createAnswer)
    // this likely has implications for number and types of candidates gathered.
    isInitiator: function(client, peerConnectionLog) {
        for (var i = 0; i < peerConnectionLog.length; i++) {
            if (peerConnectionLog[i].type === 'createOffer') return true;
            if (peerConnectionLog[i].type === 'setRemoteDescription') return false;
        }
        return undefined;
    },

    // was the peerconnection configured properly?
    configured: function(client, peerConnectionLog) {
        var peerConnectionConfig = getPeerConnectionConfig(peerConnectionLog);
        return peerConnectionConfig && peerConnectionConfig.nullConfig !== true;
    },

    // were ice servers configured? Not sure whether this is useful and/or should check if any empty list
    // was configured
    configuredWithICEServers: function(client, peerConnectionLog) {
        var peerConnectionConfig = getPeerConnectionConfig(peerConnectionLog);
        return !!(peerConnectionConfig && peerConnectionConfig.iceServers !== undefined)
    },

    // was STUN configured in the peerconnection config?
    configuredWithSTUN: function(client, peerConnectionLog) {
        var peerConnectionConfig = getPeerConnectionConfig(peerConnectionLog);
        if (!(peerConnectionConfig && peerConnectionConfig.iceServers)) return;
        for (var i = 0; i < peerConnectionConfig.iceServers.length; i++) {
            var urls = peerConnectionConfig.iceServers[i].urls || [];
            for (var j = 0; j < urls.length; j++) {
                if (urls[j].indexOf('stun:') === 0) return true;
            }
        }
    },

    // was TURN (any kind) configured in the peerconnection config?
    configuredWithTURN: function(client, peerConnectionLog) {
        var peerConnectionConfig = getPeerConnectionConfig(peerConnectionLog);
        if (!(peerConnectionConfig && peerConnectionConfig.iceServers)) return;
        for (var i = 0; i < peerConnectionConfig.iceServers.length; i++) {
            var urls = peerConnectionConfig.iceServers[i].urls || [];
            for (var j = 0; j < urls.length; j++) {
                if (urls[j].indexOf('turn:') === 0 || urls[j].indexOf('turns:') === 0) return true;
            }
        }
    },
    // was TURN/UDP configured in the peerconnection config?
    configuredWithTURNUDP: function(client, peerConnectionLog) {
        var peerConnectionConfig = client.config;
        if (!(peerConnectionConfig && peerConnectionConfig.iceServers)) return;
        for (var i = 0; i < peerConnectionConfig.iceServers.length; i++) {
            var urls = peerConnectionConfig.iceServers[i].urls || [];
            for (var j = 0; j < urls.length; j++) {
                if (urls[j].indexOf('turn:') === 0 && urls[j].indexOf('?transport=tcp') === -1) {
                    return true;
                }
            }
        }
    },
    // was TURN/TCP configured in the peerconnection config?
    configuredWithTURNTCP: function(client, peerConnectionLog) {
        var peerConnectionConfig = getPeerConnectionConfig(peerConnectionLog);
        if (!(peerConnectionConfig && peerConnectionConfig.iceServers)) return;
        for (var i = 0; i < peerConnectionConfig.iceServers.length; i++) {
            var urls = peerConnectionConfig.iceServers[i].urls || [];
            for (var j = 0; j < urls.length; j++) {
                if (urls[j].indexOf('turn:') === 0 && urls[j].indexOf('?transport=tcp') !== -1) {
                    return true;
                }
            }
        }
    },
    // was TURN/TLS configured in the peerconnection config?
    // TODO: do we also want the port for this? does it make a difference whether turns is
    //     run on 443?
    configuredWithTURNTLS: function(client, peerConnectionLog) {
        var peerConnectionConfig = getPeerConnectionConfig(peerConnectionLog);
        if (!(peerConnectionConfig && peerConnectionConfig.iceServers)) return;
        for (var i = 0; i < peerConnectionConfig.iceServers.length; i++) {
            var urls = peerConnectionConfig.iceServers[i].urls || [];
            for (var j = 0; j < urls.length; j++) {
                if (urls[j].indexOf('turns:') === 0 && urls[j].indexOf('?transport=tcp') !== -1) {
                    return true;
                }
            }
        }
    },
    // TODO: how long did it take to gather the respective candidates?
    // we need to know the browsertype to figure out the correct local type preference
    // since those differ in FF and Chrome

    // what bundle policy was supplied?
    // TODO: return default or do we want to measure explicit configuration?
    configuredBundlePolicy: function(client, peerConnectionLog) {
        var peerConnectionConfig = getPeerConnectionConfig(peerConnectionLog);
        return peerConnectionConfig ? peerConnectionConfig.bundlePolicy !== undefined : false; // default: 'balanced'
    },

    // what rtcp-mux configuration was supplied?
    // TODO: return default or do we want to measure explicit configuration?
    configuredRtcpMuxPolicy: function(client, peerConnectionLog) {
        var peerConnectionConfig = getPeerConnectionConfig(peerConnectionLog);
        return peerConnectionConfig ? peerConnectionConfig.rtcpMuxPolicy !== undefined : false; // default: 'require'
    },
    // what iceTransportPolicy configuration was supplied?
    // TODO: return default or do we want to measure explicit configuration?
    configuredIceTransportPolicy: function(client, peerConnectionLog) {
        var peerConnectionConfig = getPeerConnectionConfig(peerConnectionLog);
        return peerConnectionConfig ? peerConnectionConfig.iceTransportPolicy !== undefined : false; // default: 'all'
    },


    // was the peerconnection created with a RTCCertificate
    configuredCertificate: function(client, peerConnectionLog) {
        var peerConnectionConfig = getPeerConnectionConfig(peerConnectionLog);
        return peerConnectionConfig ? peerConnectionConfig.certificates !== undefined : false;
    },

    // did ice gathering complete (aka: onicecandidate called with a null candidate)
    ICEGatheringComplete: function(client, peerConnectionLog) {
        return peerConnectionLog.filter(entry => entry.type === 'onicecandidate' && entry.value === null).length > 0;
    },

    // was an ice failure detected.
    ICEFailure: function(client, peerConnectionLog) {
        var i = 0;
        var iceRestart = false;
        for (; i < peerConnectionLog.length; i++) {
            if (peerConnectionLog[i].type === 'oniceconnectionstatechange' && peerConnectionLog[i].value === 'failed') {
                return true;
            }
        }
        return false;
    },

    // was an ice failure after a successful connection detected.
    ICEFailureSubsequent: function(client, peerConnectionLog) {
        var i = 0;
        var connected = false;
        for (; i < peerConnectionLog.length; i++) {
            if (peerConnectionLog[i].type === 'oniceconnectionstatechange' && (peerConnectionLog[i].value === 'connected' || peerConnectionLog[i].value === 'completed')) {
                connected = true;
                break;
            }
        }
        if (connected) {
            for (; i < peerConnectionLog.length; i++) {
                if (peerConnectionLog[i].type === 'oniceconnectionstatechange' && peerConnectionLog[i].value === 'failed') {
                    return true;
                }
            }
        }
        return false;
    },

    // did ice connect/complete?
    ICEConnectedOrCompleted: function(client, peerConnectionLog) {
        return peerConnectionLog.filter(entry => entry.type === 'oniceconnectionstatechange' && (entry.value === 'connected' || entry.value === 'completed')).length > 0;
    },

    // Firefox has a timeout of ~5 seconds where addIceCandidate needs to happen after SRD.
    // This calculates the delay between SRD and addIceCandidate which should allow
    // correlation with ICE failures caused by this.
    // returns -1 if addIceCandidate is called before setRemoteDescription
    timeBetweenSetRemoteDescriptionAndAddIceCandidate: function(client, peerConnectionLog) {
        var srd;
        for (var i = 0; i < peerConnectionLog.length; i++) {
            if (peerConnectionLog[i].type === 'setRemoteDescription') {
                srd = peerConnectionLog[i].time;
            } else if (peerConnectionLog[i].type === 'addIceCandidate') {
                if (srd) {
                    return new Date(peerConnectionLog[i].time).getTime() - new Date(srd).getTime();
                } else {
                    return -1;
                }
            }
        }
    },

    // This calculates the delay between SLD and onicecandidate.
    timeBetweenSetLocalDescriptionAndOnIceCandidate: function(client, peerConnectionLog) {
        var sld;
        for (var i = 0; i < peerConnectionLog.length; i++) {
            if (peerConnectionLog[i].type === 'setLocalDescription') {
                sld = peerConnectionLog[i].time;
            } else if (peerConnectionLog[i].type === 'onicecandidate') {
                if (sld) {
                    return new Date(peerConnectionLog[i].time).getTime() - new Date(sld).getTime();
                } else {
                    return -1; // should not happen but...
                }
            }
        }
    },

    // detects the osx audio bug which manifests as "audio seems to work but
    // no audio is ever sent (which manifests as bytesSent always being 0)
    //  https://bugs.chromium.org/p/webrtc/issues/detail?id=4799
    notsendingaudio: function(client, peerConnectionLog) {
        var track = extractTrack(peerConnectionLog, 'audio', 'send');
        if (!(track && track.length)) return false;
        var count = 0;
        for (var i = 0; i < track.length; i++) {
            if (parseInt(track[i].bytesSent, 10) > 0) return false;
            count++;
        }
        return count > 0;
    },
    // detect cam being used by another application (no bytes sent for video)
    //  https://bugs.chromium.org/p/chromium/issues/detail?id=403710#c7
    notsendingvideo: function(client, peerConnectionLog) {
        var track = extractTrack(peerConnectionLog, 'video', 'send');
        if (!(track && track.length)) return false;
        var count = 0;
        for (var i = 0; i < track.length; i++) {
            if (parseInt(track[i].bytesSent, 10) > 0) return false;
            count++;
        }
        return count > 0;
    },

    // check whether video is received after 10 seconds
    receivingvideo10s: function(client, peerConnectionLog) {
        var count = 0;
        var receivedVideo = undefined;
        for (var i = 0; i < peerConnectionLog.length; i++) {
            if (peerConnectionLog[i].type === 'getStats') {
                if (count++ === 10) {
                    Object.keys(peerConnectionLog[i].value).forEach(id => {
                        var report = peerConnectionLog[i].value[id];
                        if (report.type === 'ssrc' && report.mediaType === 'video' && id.indexOf('_recv')) {
                            receivedVideo = {
                                packetsReceived: report.packetsReceived,
                                frameWidth: report.frameWidth,
                                frameHeight: report.frameHeight
                            };
                        }
                    });
                    return receivedVideo;
                }
            }
        }
    },

    // how long did it take until video arrived?
    // in particular a keyframe which causes width and height to be set.
    timeuntilreceivingvideo: function(client, peerConnectionLog) {
        let timeConnected = false;
        let timeReceived = false;
        for (var i = 0; i < peerConnectionLog.length; i++) {
            if (peerConnectionLog[i].type === 'oniceconnectionstatechange' && !timeConnected) {
                if (peerConnectionLog[i].value === 'connected' || peerConnectionLog[i].value === 'completed') {
                    timeConnected = new Date(peerConnectionLog[i].time).getTime();
                }
            }
            if (peerConnectionLog[i].type === 'getStats') {
                Object.keys(peerConnectionLog[i].value).forEach(id => {
                    var report = peerConnectionLog[i].value[id];
                    if (report.type === 'ssrc' && report.mediaType === 'video' && report.googFrameWidthReceived) {
                        let width = parseInt(report.googFrameWidthReceived, 10);
                        if (width > 0) {
                            timeReceived = new Date(peerConnectionLog[i].time).getTime(); 
                        }
                    }
                });
            }
            if (timeReceived && timeConnected) {
                return timeReceived - timeConnected;
            }
        }
    },

    // check whether audio is received after 10 seconds
    receivingaudio10s: function(client, peerConnectionLog) {
        var count = 0;
        var receivedAudio = undefined;
        for (var i = 0; i < peerConnectionLog.length; i++) {
            if (peerConnectionLog[i].type === 'getStats') {
                if (count++ === 10) {
                    Object.keys(peerConnectionLog[i].value).forEach(id => {
                        var report = peerConnectionLog[i].value[id];
                        if (report.type === 'ssrc' && report.mediaType === 'audio' && id.indexOf('_recv')) {
                            receivedAudio = {
                                packetsReceived: report.packetsReceived,
                                jitterbufferms: report.googJitterBufferMs
                            };
                        }
                    });
                    return receivedAudio;
                }
            }
        }
    },

    // is the session using ICE lite?
    usingICELite: function(client, peerConnectionLog) {
        var usingIceLite = false;
        peerConnectionLog.forEach(entry => {
            if (!usingIceLite && entry.type === 'setRemoteDescription') {
                if (entry.value.sdp && entry.value.sdp.indexOf('\r\na=ice-lite\r\n') !== -1) {
                    usingIceLite = true;
                }
            }
        });
        return usingIceLite;
    },

    // is the session using rtcp-mux?
    usingRTCPMux: function(client, peerConnectionLog) {
        var usingRTCPMux = false;
        // search for SLD/SRD with type = answer and look for a=rtcp-mux
        peerConnectionLog.forEach(entry => {
            if (!usingRTCPMux && (entry.type === 'setRemoteDescription' || entry.type === 'setLocalDescription')) {
                if (entry.value.type === 'answer' && entry.value.sdp && entry.value.sdp.indexOf('\r\na=rtcp-mux\r\n') !== -1) {
                    usingRTCPMux = true;
                }
            }
        });
        return usingRTCPMux;
    },

    // is the session using BUNDLE?
    usingBundle: function(client, peerConnectionLog) {
        var usingBundle = false;
        // search for SLD/SRD with type = answer and look for a=GROUP
        peerConnectionLog.forEach(entry => {
            if (!usingBundle && (entry.type === 'setRemoteDescription' || entry.type === 'setLocalDescription')) {
                if (entry.value.type === 'answer' && entry.value.sdp && entry.value.sdp.indexOf('\r\na=group:BUNDLE ') !== -1) {
                    usingBundle = true;
                }
            }
        });
        return usingBundle;
    },

    ICERestart: function(client, peerConnectionLog) {
        var iceRestart = false;
        peerConnectionLog.forEach(entry => {
            if (!iceRestart && entry.type === 'createOffer') {
                if (entry.value && entry.value.iceRestart) {
                    iceRestart = true;
                }
            }
        });
        return iceRestart;
    },

    ICERestartSuccess: function(client, peerConnectionLog) {
        var i = 0;
        var iceRestart = false;
        for (; i < peerConnectionLog.length; i++) {
            if (peerConnectionLog[i].type === 'createOffer' && peerConnectionLog[i].value && peerConnectionLog[i].value.iceRestart) {
                iceRestart = true;
                break;
            }
        }
        if (iceRestart) {
            for (; i < peerConnectionLog.length; i++) {
                if (peerConnectionLog[i].type === 'oniceconnectionstatechange' &&
                    (peerConnectionLog[i].value === 'connected' || peerConnectionLog[i].value === 'completed')) return true;
            }
        }
        return false;
    },

    // was setRemoteDescription called after the ice restart? If not the peer
    // went away.
    ICERestartFollowedBySetRemoteDescription: function(client, peerConnectionLog) {
        var i = 0;
        var iceRestart = false;
        for (; i < peerConnectionLog.length; i++) {
            if (peerConnectionLog[i].type === 'createOffer' && peerConnectionLog[i].value && peerConnectionLog[i].value.iceRestart) {
                iceRestart = true;
                break;
            }
        }
        if (iceRestart) {
            for (; i < peerConnectionLog.length; i++) {
                if (peerConnectionLog[i].type === 'setRemoteDescription') return true;
            }
            return false;
        }
    },

    // was there a relay candidate gathered after the ice restart?
    ICERestartFollowedByRelayCandidate: function(client, peerConnectionLog) {
        var i = 0;
        var iceRestart = false;
        for (; i < peerConnectionLog.length; i++) {
            if (peerConnectionLog[i].type === 'createOffer' && peerConnectionLog[i].value && peerConnectionLog[i].value.iceRestart) {
                iceRestart = true;
                break;
            }
        }
        if (iceRestart) {
            for (; i < peerConnectionLog.length; i++) {
                if (peerConnectionLog[i].type === 'onicecandidate') {
                    var cand = peerConnectionLog[i].value;
                    if (cand === null) return false; // give up
                    if (cand && cand.candidate.indexOf('relay') !== -1) {
                        return true;
                    }
                }
            }
            return false;
        }
    },

    // was the signaling state stable at least once?
    signalingStableAtLeastOnce: function(client, peerConnectionLog) {
        return peerConnectionLog.filter(entry => entry.type === 'onsignalingstatechange' && entry.value === 'stable').length > 0;
    },

    // was more than one remote stream added?
    usingMultistream: function(client, peerConnectionLog) {
        return peerConnectionLog.filter(entry => entry.type === 'onaddstream').length > 1;
    },

    // maximum number of concurrent streams
    maxStreams: function(client, peerConnectionLog) {
        var max = 0;
        peerConnectionLog.forEach(entry => {
            if (entry.type === 'onaddstream') max++;
            else if (entry.type === 'onremovestream' && max > 0) max--;
        });
        return max;
    },

    firstRemoteStream: function(client, peerConnectionLog) {
        for (var i = 0; i < peerConnectionLog.length; i++) {
            if (peerConnectionLog[i].type === 'onaddstream') {
                let value = peerConnectionLog[i].value;
                let feature = {
                    id: value.split(' ')[0]
                };
                value.split(' ')[1].split(',').forEach((kindAndTrack) => {
                    let parts = kindAndTrack.split(':', 2);
                    feature[parts[0]] = parts[1];
                });
                return feature;
            }
        }
    },

    usingSimulcast: function(client, peerConnectionLog) {
        for (var i = 0; i < peerConnectionLog.length; i++) {
            if (peerConnectionLog[i].type === 'setLocalDescription') {
                var value = peerConnectionLog[i].value;
                return value && value.sdp && (value.sdp.indexOf('a=ssrc-group:SIM') !== -1 || value.sdp.indexOf('a=simulcast:') !== -1);
            }
        }
    },

    // was there a setLocalDescription failure?
    setLocalDescriptionFailure: function(client, peerConnectionLog) {
        for (var i = 0; i < peerConnectionLog.length; i++) {
            if (peerConnectionLog[i].type === 'setLocalDescriptionOnFailure') {
                return peerConnectionLog[i].value;
            }
        }
    },

    // was there a setRemoteDescription failure?
    setRemoteDescriptionFailure: function(client, peerConnectionLog) {
        for (var i = 0; i < peerConnectionLog.length; i++) {
            if (peerConnectionLog[i].type === 'setRemoteDescriptionOnFailure') {
                return peerConnectionLog[i].value;
            }
        }
    },

    // was there an addIceCandidate failure
    addIceCandidateFailure: function(client, peerConnectionLog) {
        for (var i = 0; i < peerConnectionLog.length; i++) {
            if (peerConnectionLog[i].type === 'addIceCandidateOnFailure') {
                return peerConnectionLog[i].value;
            }
        }
    },

    // how long did it take to gather all ice candidates?
    gatheringTime: function(client, peerConnectionLog) {
        var first;
        var second;
        for (first = 0; first < peerConnectionLog.length; first++) {
            // TODO: is setLocalDescriptionOnSuccess better?
            if (peerConnectionLog[first].type === 'setLocalDescription') break;
        }
        if (first < peerConnectionLog.length) {
            for (second = first + 1; second < peerConnectionLog.length; second++) {
                if (peerConnectionLog[second].type === 'onicecandidate' && peerConnectionLog[second].value === null) break;
            }
            if (second < peerConnectionLog.length) {
                return (new Date(peerConnectionLog[second].time).getTime() -
                    new Date(peerConnectionLog[first].time).getTime());
            }
        }
    },

    // was a local host candidate gathered. This should always be true.
    // And yet I saw a pig flying with Firefox 46 on Windows which did
    // not like a teredo interface and did not gather candidates.
    gatheredHost: function(client, peerConnectionLog) {
        for (var i = 0; i < peerConnectionLog.length; i++) {
            if (peerConnectionLog[i].type === 'onicecandidate') {
                var cand = peerConnectionLog[i].value;
                if (cand === null) return false; // gathering finished so we have seen all candidates.
                if (cand.candidate.indexOf('host') !== -1) {
                    return true;
                }
            }
        }
    },

    // was a local STUN candidate gathered?
    // TODO: do we care about timing?
    gatheredSTUN: function(client, peerConnectionLog) {
        for (var i = 0; i < peerConnectionLog.length; i++) {
            if (peerConnectionLog[i].type === 'onicecandidate') {
                var cand = peerConnectionLog[i].value;
                if (cand === null) return false; // gathering finished so we have seen all candidates.
                if (cand.candidate.indexOf('srflx') !== -1) {
                    return true;
                }
            }
        }
    },

    // was a local TURN/UDP relay candidate gathered?
    gatheredTURNUDP: function(client, peerConnectionLog) {
        return gatheringTimeTURN('udp', client, peerConnectionLog) !== undefined;
    },
    // how long did it take to gather a TURN/UDP relay candidate
    gatheringTimeTURNUDP: function(client, peerConnectionLog) {
        return gatheringTimeTURN('udp', client, peerConnectionLog);
    },

    // was a local TURN/TCP relay candidate gathered?
    gatheredTURNTCP: function(client, peerConnectionLog) {
        return gatheringTimeTURN('tcp', client, peerConnectionLog) !== undefined;
    },
    // how long did it take to gather a TURN/TCP relay candidate
    gatheringTimeTURNTCP: function(client, peerConnectionLog) {
        return gatheringTimeTURN('tcp', client, peerConnectionLog);
    },

    // was a local TURN/TLS relay candidate gathered?
    gatheredTURNTLS: function(client, peerConnectionLog) {
        return gatheringTimeTURN('tls', client, peerConnectionLog) !== undefined;
    },
    // how long did it take to gather a TURN/TLS relay candidate
    gatheringTimeTURNTLS: function(client, peerConnectionLog) {
        return gatheringTimeTURN('tls', client, peerConnectionLog);
    },

    // which turn server was used? returns the relay address.
    relayAddress: function(client, peerConnectionLog) {
        for (var i = 0; i < peerConnectionLog.length; i++) {
            if (peerConnectionLog[i].type === 'onicecandidate') {
                var cand = peerConnectionLog[i].value;
                if (cand === null) return; // give up
                if (cand && cand.candidate.indexOf('relay') !== -1) {
                    return cand.candidate.split(' ')[4];
                }
            }
        }
    },

    // which public address was used?
    // either srflx or raddr from relay. Host is not considered (yet)
    publicIPAddress: function(client, peerConnectionLog) {
        for (var i = 0; i < peerConnectionLog.length; i++) {
            if (peerConnectionLog[i].type === 'onicecandidate') {
                var cand = peerConnectionLog[i].value;
                if (cand === null) return; // give up
                if (cand && cand.candidate.indexOf('srflx') !== -1) {
                    return cand.candidate.split(' ')[4];
                }
                if (cand && cand.candidate.indexOf('relay') !== -1) {
                    var parts = cand.candidate.split(' ');
                    for (var j = 8; j < parts.length; j += 2) {
                        if (parts[j] === 'raddr') {
                            return parts[j + 1];
                        }
                    }
                }
            }
        }
    },

    // was there a remote candidate TURN added?
    // that is about as much as we can tell unless we snoop onto the
    // peerconnection and determine remote browser.
    hadRemoteTURNCandidate: function(client, peerConnectionLog) {
        // TODO: might be hiding in setRemoteDescription, too.
        for (var i = 0; i < peerConnectionLog.length; i++) {
            if (peerConnectionLog[i].type === 'addIceCandidate') {
                var cand = peerConnectionLog[i].value;
                if (cand && cand.candidate && cand.candidate.indexOf('relay') !== -1) {
                    return true;
                }
            }
        }
        return false;
    },

    // what types of RFC 1918 private ip addresses were gathered?
    gatheredrfc1918address: function(client, peerConnectionLog) {
        var gathered = {};
        for (var i = 0; i < peerConnectionLog.length; i++) {
            if (peerConnectionLog[i].type === 'onicecandidate') {
                var cand = peerConnectionLog[i].value;
                if (cand === null) break; // gathering done
                if (cand.candidate) {
                    var ip = cand.candidate.split(' ')[4];
                    if (ip.indexOf('192.168.') === 0) gathered.prefix16 = true;
                    else if (ip.indexOf('172.16.') === 0) gathered.prefix12 = true;
                    else if (ip.indexOf('10.') === 0) gathered.prefix10 = true;
                }
            }
        }
        if (Object.keys(gathered).length) {
            return gathered;
        }
    },

    // estimates the number of interfaces
    numberOfInterfaces: function(client, peerConnectionLog) {
        var ips = {};
        for (var i = 0; i < peerConnectionLog.length; i++) {
            if (peerConnectionLog[i].type === 'onicecandidate') {
                var cand = peerConnectionLog[i].value;
                if (cand === null) return false; // gathering finished so we have seen all candidates.
                var parts = cand.candidate.split(' ');
                if (parts[7] === 'host') {
                    if (!ips[parts[4]]) ips[parts[4]] = 0;
                    ips[parts[4]]++;
                }
            }
        }
        return Object.keys(ips).length;
    },

    // how long does it take to establish the connection?
    // TODO: also figure out connection type so we don't lump relayed and non-relayed connections
    connectionTime: function(client, peerConnectionLog) {
        var first;
        var second;
        for (first = 0; first < peerConnectionLog.length; first++) {
            if (peerConnectionLog[first].type === 'oniceconnectionstatechange' &&
                peerConnectionLog[first].value === 'checking') break;
        }
        if (first < peerConnectionLog.length) {
            for (second = first + 1; second < peerConnectionLog.length; second++) {
                if (peerConnectionLog[second].type === 'oniceconnectionstatechange' &&
                    (peerConnectionLog[second].value === 'connected' || peerConnectionLog[second].value === 'completed')) break;
            }
            if (second < peerConnectionLog.length) {
                return (new Date(peerConnectionLog[second].time).getTime() -
                    new Date(peerConnectionLog[first].time).getTime());
            }
        }
        return -1;
    },

    // how long does it take to create a local offer/answer (mostly DTLS key generation)
    localCreateDelay: function(client, peerConnectionLog) {
        var first;
        var second;
        for (first = 0; first < peerConnectionLog.length; first++) {
            if (peerConnectionLog[first].type === 'createOffer' ||
                peerConnectionLog[first].type === 'createAnswer') break;
        }
        if (first < peerConnectionLog.length) {
            for (second = first + 1; second < peerConnectionLog.length; second++) {
                if (peerConnectionLog[second].type === peerConnectionLog[first].type + 'OnSuccess') break;
            }
            if (second < peerConnectionLog.length) {
                return (new Date(peerConnectionLog[second].time).getTime() -
                    new Date(peerConnectionLog[first].time).getTime());
            }
        }
        return -1;
    },

    // number of local ice candidates.
    numberOfLocalIceCandidates: function(client, peerConnectionLog) {
        return peerConnectionLog.filter(entry => entry.type === 'onicecandidate' && entry.value).length;
    },

    // number of remote ice candidates.
    numberOfRemoteIceCandidates: function(client, peerConnectionLog) {
        var candsInSdp = -1;
        // needs sentinel to avoid adding candidates from subsequent generations.
        peerConnectionLog.forEach(entry => {
            if (candsInSdp === -1 && entry.type === 'setRemoteDescription') {
                if (entry.value.sdp) {
                    candsInSdp = entry.value.sdp.split('\n').filter(line => line.indexOf('a=candidate:') === 0).length;
                }
            }
        });
        if (candsInSdp === -1) candsInSdp = 0;
        return candsInSdp + peerConnectionLog.filter(entry => entry.type === 'addIceCandidate').length;
    },

    // session duration, defined by ICE states.
    sessionDuration: function(client, peerConnectionLog) {
        var startTime = -1;
        var endTime = -1;
        var i;
        for (i = 0; i < peerConnectionLog.length; i++) {
            var entry = peerConnectionLog[i];
            if (entry.type === 'oniceconnectionstatechange') {
                if ((entry.value === 'connected' || entry.value === 'completed') && startTime === -1) {
                    startTime = new Date(entry.time).getTime();
                    break;
                }
            }
        }
        if (startTime > 0) {
            // TODO: this is too simplistic. What if the ice connection state went to failed?
            for (var j = peerConnectionLog.length - 1; j > i; j--) {
                endTime = new Date(peerConnectionLog[j].time).getTime();
                if (startTime < endTime && endTime > 0) {
                    return endTime - startTime;
                }
            }
        }
    },

    // determine media types used in session.
    mediaTypes: function(client, peerConnectionLog) {
        // looking for SRD/SLD is easier than tracking createDataChannel + addStreams
        // TODO: also look for value.type=answer and handle rejected m-lines?
        for (var i = 0; i < peerConnectionLog.length; i++) {
            if (peerConnectionLog[i].type === 'setLocalDescription' ||
                peerConnectionLog[i].type === 'setRemoteDescription') break;
        }
        if (i < peerConnectionLog.length) {
            var desc = peerConnectionLog[i].value;
            if (desc && desc.sdp) {
                var mediaTypes = {};
                var lines = desc.sdp.split('\n').filter(line => line.indexOf('m=') === 0);
                lines.forEach(line => {
                    mediaTypes[line.split(' ', 1)[0].substr(2)] = true;
                });
                return Object.keys(mediaTypes).sort().join(';');
            }
        }
        return 'unknown';
    },

    // dlts cipher suite used
    // TODO: what is the standard thing for that?
    dtlsCipherSuite: function(client, peerConnectionLog) {
        var dtlsCipher;
        for (var i = 0; i < peerConnectionLog.length; i++) {
            if (peerConnectionLog[i].type !== 'getStats') continue;
            var statsReport = peerConnectionLog[i].value;
            Object.keys(statsReport).forEach(id => {
                var report = statsReport[id];
                if (report.type === 'googComponent' && report.dtlsCipher) {
                    dtlsCipher = report.dtlsCipher;
                }
            });
            if (dtlsCipher) return dtlsCipher;
        }
    },

    // srtp cipher suite used
    srtpCipherSuite: function(client, peerConnectionLog) {
        var srtpCipher;
        for (var i = 0; i < peerConnectionLog.length; i++) {
            if (peerConnectionLog[i].type !== 'getStats') continue;
            var statsReport = peerConnectionLog[i].value;
            Object.keys(statsReport).forEach(id => {
                var report = statsReport[id];
                if (report.type === 'googComponent' && report.srtpCipher) {
                    srtpCipher = report.srtpCipher;
                }
            });
            if (srtpCipher) return srtpCipher;
        }
    },

    // video codec used
    sendVideoCodec: function(client, peerConnectionLog) {
        return getCodec(peerConnectionLog, 'video', 'send');
    },
    recvVideoCodec: function(client, peerConnectionLog) {
        return getCodec(peerConnectionLog, 'video', 'recv');
    },

    // audio codec used
    sendAudioCodec: function(client, peerConnectionLog) {
        return getCodec(peerConnectionLog, 'audio', 'send');
    },
    recvAudioCodec: function(client, peerConnectionLog) {
        return getCodec(peerConnectionLog, 'audio', 'recv');
    },

    // mean RTT, send and recv bitrate of the active candidate pair
    statsMean: function(client, peerConnectionLog) {
        var feature = {};
        var rtts = [];
        var recv = [];
        var send = [];
        var lastStatsReport;
        var lastTime;
        peerConnectionLog.forEach(entry => {
            if (entry.type !== 'getStats') return;
            var statsReport = entry.value;
            // look for type track, remoteSource: false, audioLevel (0..1)
            Object.keys(statsReport).forEach(id => {
                var report = statsReport[id];
                if (report.type === 'candidate-pair' && report.selected === true) {
                    rtts.push(report.roundTripTime);
                }
            });
            if (lastStatsReport) {
                Object.keys(statsReport).forEach(id => {
                    var report = statsReport[id];
                    var bitrate;
                    if (report.type === 'candidate-pair' && report.selected === true && lastStatsReport[id]) {
                        bitrate = 8 * (report.bytesReceived - lastStatsReport[id].bytesReceived) / (entry.time - lastTime);
                        // needs to work around resetting counters -- https://bugs.chromium.org/p/webrtc/issues/detail?id=5361
                        if (bitrate > 0) {
                            recv.push(bitrate);
                        }
                    }
                    if (report.type === 'candidate-pair' && report.selected === true && lastStatsReport[id]) {
                        bitrate = 8 * (report.bytesSent - lastStatsReport[id].bytesSent) / (entry.time - lastTime);
                        // needs to work around resetting counters -- https://bugs.chromium.org/p/webrtc/issues/detail?id=5361
                        if (bitrate > 0) {
                            send.push(bitrate);
                        }
                    }
                });
            }
            lastStatsReport = statsReport;
            lastTime = entry.time;
        });

        feature['roundTripTime'] = Math.floor(rtts.reduce((a, b) => a + b, 0) / (rtts.length || 1));
        feature['receivingBitrate'] = Math.floor(recv.reduce((a, b) => a + b, 0) / (recv.length || 1));
        feature['sendingBitrate'] = Math.floor(send.reduce((a, b) => a + b, 0) / (send.length || 1));
        return feature;
    },

    firstCandidatePair: function(client, peerConnectionLog) {
        // search for first getStats after iceconnection->connected
        for (var i = 0; i < peerConnectionLog.length; i++) {
            if (peerConnectionLog[i].type === 'oniceconnectionstatechange' &&
                (peerConnectionLog[i].value=== 'connected'
                || peerConnectionLog[i].value === 'completed')) break;
        }
        for (; i < peerConnectionLog.length; i++) {
            if (peerConnectionLog[i].type !== 'getStats') continue;
            var statsReport = peerConnectionLog[i].value;
            var pair = null;
            Object.keys(statsReport).forEach(id => {
                var report = statsReport[id];
                var localCandidate = statsReport[report.localCandidateId];
                var remoteCandidate = statsReport[report.remoteCandidateId];
                if (report.type === 'candidate-pair' && report.selected === true && localCandidate && remoteCandidate) {
                    pair = {
                        type: localCandidate.candidateType + ';' + remoteCandidate.candidateType, // mostly for backward compat reasons
                        localType: localCandidate.candidateType,
                        remoteType: remoteCandidate.candidateType,
                        localIPAddress: localCandidate.ipAddress,
                        remoteIPAddress: remoteCandidate.ipAddress,
                        localTypePreference: localCandidate.priority >> 24,
                        remoteTypePreference: remoteCandidate.priority >> 24
                    };
                }
            });
            if (pair) return pair;
        }
    },

    // how did the selected candidate pair change? Could happen e.g. because of an ice restart
    // so there should be a strong correlation.
    numberOfCandidatePairChanges: function(client, peerConnectionLog) {
        var selectedCandidatePairList = [null];
        for (var i = 0; i < peerConnectionLog.length; i++) {
            if (peerConnectionLog[i].type !== 'getStats') continue;
            var statsReport = peerConnectionLog[i].value;
            Object.keys(statsReport).forEach(id => {
                var report = statsReport[id];
                if (report.type === 'candidate-pair' && report.selected === true) {
                    var pair = report.localCandidateId + ' ' + report.remoteCandidateId;
                    if (pair !== selectedCandidatePairList[selectedCandidatePairList.length - 1]) {
                        selectedCandidatePairList.push(pair);
                    }
                }
            });
        }
        return selectedCandidatePairList.length - 1;
    },


    // experimental fippo feature, don't use this
    /*
    flakyActive: function(client, peerConnectionLog) {
        var selectedCandidatePairList = [null];
        for (var i = 0; i < peerConnectionLog.length; i++) {
            if (peerConnectionLog[i].type !== 'getStats') continue;
            var statsReport = peerConnectionLog[i].value;
            Object.keys(statsReport).forEach(function(id) {
                var report = statsReport[id];
                if (report.type === 'candidate-pair' && report.selected === true) {
                    // this is interesting as it shows flakyness in -1-0 and -1-1 and back at the
                    // receiver during  ice restart but that is not what we are looking for.
                    if (report.id !== selectedCandidatePairList[selectedCandidatePairList.length - 1]) {
                        selectedCandidatePairList.push(report.id);
                        console.log('candidate pair change', i, peerConnectionLog[i].time, report.id);
                        console.log('local', statsReport[report.localCandidateId].ipAddress,
                            statsReport[report.localCandidateId].portNumber,
                            'remote', statsReport[report.remoteCandidateId].ipAddress,
                            statsReport[report.remoteCandidateId].portNumber);
                    }
                }
            });
        }
        peerConnectionLog.forEach(function(entry) {
            if (entry.type === 'createOffer') {
                if (entry.value && entry.value.iceRestart) {
                    console.log('icerestart', entry.time);
                }
            }
        });
    },
    */

    // how did the selected interface type change? e.g. a wifi->mobile transition
    // see https://code.google.com/p/chromium/codesearch#chromium/src/third_party/libjingle/source/talk/app/webrtc/statscollector.cc&q=statscollector&sq=package:chromium&l=53
    // TODO: check if this really allows detecting such transitions
    candidatePairChangeInterfaceTypes: function(client, peerConnectionLog) {
        var interfaceTypesList = [null];
        for (var i = 0; i < peerConnectionLog.length; i++) {
            if (peerConnectionLog[i].type !== 'getStats') continue;
            var statsReport = peerConnectionLog[i].value;
            Object.keys(statsReport).forEach(id => {
                var report = statsReport[id];
                if (report.type === 'candidate-pair' && report.selected === true && statsReport[report.localCandidateId]) {
                    var type = statsReport[report.localCandidateId].networkType;
                    if (type && type !== interfaceTypesList[interfaceTypesList.length - 1]) {
                        interfaceTypesList.push(type);
                    }
                }
            });
        }
        interfaceTypesList.shift();
        return interfaceTypesList.join(';') || 'unknown';
    },

    // count # of PLIs sent
    // TODO: recv but that might be more difficult with multiple streams
    numberOfPLISent: function(client, peerConnectionLog) {
        return extractLastVideoStat(peerConnectionLog, 'pliCount');
    },

    // count # of FIRs sent
    // TODO: recv but that might be more difficult with multiple streams
    numberOfFIRSent: function(client, peerConnectionLog) {
        return extractLastVideoStat(peerConnectionLog, 'firCount');
    },

    // count # of NACKs sent
    // TODO: recv but that might be more difficult with multiple streams
    numberOfNACKSent: function(client, peerConnectionLog) {
        return extractLastVideoStat(peerConnectionLog, 'nackCount');
    },

    // determine maximum number of frame size (w/h) changes in 60 second window
    framesizeChanges: function(client, peerConnectionLog) {
        var windowLength = 60 * 1000;
        var trackid;
        var i;
        for (i = 0; i < peerConnectionLog.length; i++) {
            if (peerConnectionLog[i].type === 'getStats') {
                var statsReport = peerConnectionLog[i].value;
                Object.keys(statsReport).forEach(id => {
                    var report = statsReport[id];
                    if (report.type === 'ssrc' && report.mediaType === 'video' && report.googFrameWidthReceived) {
                        trackid = id;
                    }
                });
                if (trackid) break;
            }
        }
        if (!trackid) return;
        var width = '-1';
        var numChanges = 0;
        var allChanges = [];
        var lastTime;
        for (; i < peerConnectionLog.length; i++) {
            if (peerConnectionLog[i].type === 'getStats') {
                var statsReport = peerConnectionLog[i].value;
                var report = statsReport[trackid];
                if (!lastTime) lastTime = report.timestamp;
                if (report.timestamp - lastTime > windowLength) {
                    allChanges.push(numChanges);
                    numChanges = 0;
                }
                if (report && report.googFrameWidthReceived !== width) {
                    width = report.googFrameWidthReceived;
                    numChanges++;
                }
            }
        }
        if (allChanges.length === 0) return;
        return Math.max.apply(null, allChanges);;
    },
    // TODO: jitter
    // TODO: packets lost (audio and video separated)
    // TODO: packets sent
    // TODO: packets received
    // TODO: goog things possibly discarded by rtcstats?
    // TODO: packetsDiscardedOnSend
    // TODO: goog aec thingies and typing noise states
    // TODO: goog plc things

    bwe: function(client, peerConnectionLog) {
        var bwe = extractBWE(peerConnectionLog);
        if (!bwe.length) return;
        var stats = ['googActualEncBitrate', 'googRetransmitBitrate', 'googTargetEncBitrate',
            'googBucketDelay', 'googTransmitBitrate'];
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

        var feature = {};
        stats.forEach(stat => {
            var series = bwe.map(item => item[stat]);

            feature[capitalize(stat) + 'Mean'] = series.reduce((a, b) => a + b, 0) / series.length;
            feature[capitalize(stat) + 'Max'] = Math.max.apply(null, series);
            feature[capitalize(stat) + 'Min'] = Math.min.apply(null, series);

            feature[capitalize(stat) + 'Variance'] = standardizedMoment(series, 2);
            feature[capitalize(stat) + 'Skewness'] = standardizedMoment(series, 3);
            feature[capitalize(stat) + 'Kurtosis'] = standardizedMoment(series, 4);
        });
        return feature;
    },

    userfeedback: function(client) {
        if (!client.feedback) return;
        var feature = {};
        feature[client.feedback.mediaType] = client.feedback.score;
        return feature;
    }
};

['audio', 'video'].forEach(kind => {
    ['send', 'recv'].forEach(direction => {
        module.exports[kind + capitalize(direction)] = function(client, peerConnectionLog) {
            var track = extractTrack(peerConnectionLog, kind, direction);
            if (!track.length) return;
            var feature = {};
            ['audioLevel', 'googJitterReceived',
                'googRtt', 'googEncodeUsagePercent',
                'googCurrentDelayMs', 'googJitterBufferMs',
                'googPreferredJitterBufferMs', 'googJitterBufferMs',
                'googDecodeMs', 'googMaxDecodeMs',
                'googMinPlayoutDelayMs', 'googRenderDelayMs', 'googTargetDelayMs'
            ].forEach(stat => {
                if (typeof track[0][stat] === 'undefined') return;
                var series = track.map(item => parseInt(item[stat], 10));

                feature[stat + 'Mean'] = series.reduce((a, b) => a + b, 0) / series.length;

                feature[stat + 'Max'] = Math.max.apply(null, series);
                feature[stat + 'Min'] = Math.min.apply(null, series);

                feature[stat + 'Variance'] = standardizedMoment(series, 2);
                feature[stat + 'Skewness'] = standardizedMoment(series, 3);
                feature[stat + 'Kurtosis'] = standardizedMoment(series, 4);
            });
            ['googFrameHeightInput', 'googFrameHeightSent', 'googFrameWidthInput', 'googFrameWidthSent',
               'googFrameHeightReceived', 'googFrameWidthReceived'].forEach(stat => {
                if (typeof track[0][stat] === 'undefined') return;
                // mode, max, min
                var series = track.map(item => parseInt(item[stat], 10));

                feature[stat + 'Max'] = Math.max.apply(null, series);
                feature[stat + 'Min'] = Math.min.apply(null, series);
                feature[stat + 'Mode'] = mode(series);
            });

            ['googCpuLimitedResolution', 'googBandwidthLimitedResolution'].forEach(stat => {
                if (typeof track[0][stat] === 'undefined') return;
                var series = track.map(item => (item[stat] === 'true' ? 1 : 0));

                feature[stat + 'Mean'] = series.reduce((a, b) => a + b, 0) / series.length;
                feature[stat + 'Max'] = Math.max.apply(null, series);
                feature[stat + 'Min'] = Math.min.apply(null, series);
                feature[stat + 'Mode'] = mode(series);
            });

            // RecentMax is over a 10s window.
            ['googResidualEchoLikelihoodRecentMax'].forEach(stat => {
                if (typeof track[0][stat] === 'undefined') return;

                var series = track.map(item => parseFloat(item[stat], 10));

                feature[stat + 'Mean'] = series.reduce((a, b) => a + b, 0) / series.length;
                feature[stat + 'Max'] = Math.max.apply(null, series);

                feature[stat + 'Variance'] = standardizedMoment(series, 2);
                feature[stat + 'Skewness'] = standardizedMoment(series, 3);
                feature[stat + 'Kurtosis'] = standardizedMoment(series, 4);
            });

            // stats for which we are interested in the difference between values.
            ['packetsReceived', 'packetsSent', 'packetsLost', 'bytesSent', 'bytesReceived'].forEach(stat => {
                var i;
                var conversionFactor = stat.indexOf('bytes') === 0 ? 8 : 1; // we want bits/second
                if (typeof track[0][stat] === 'undefined') return;
                var series = track.map(item => parseInt(item[stat], 10));
                var dt = track.map(item => item.timestamp);
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

                feature[stat + 'Delta' + 'Mean'] = series.reduce((a, b) => a + b, 0) / series.length;
                feature[stat + 'Max'] = Math.max.apply(null, series);
                feature[stat + 'Min'] = Math.min.apply(null, series);
                feature[stat + 'Mode'] = mode(series);

                feature[stat + 'Variance'] = standardizedMoment(series, 2);
                feature[stat + 'Skewness'] = standardizedMoment(series, 3);
                feature[stat + 'Kurtosis'] = standardizedMoment(series, 4);
            });
            return feature;
        };
    });
});

function safeFeature(feature) {
    if (typeof feature === 'number' && isNaN(feature)) feature = -1;
    if (typeof feature === 'number' && !isFinite(feature)) feature = -2;
    if (feature === false) feature = 0;
    if (feature === true) feature = 1;

    return feature;
}

if (require.main === module && process.argv.length === 3) {
    var features = module.exports;
    fs.readFile(process.argv[2], (err, data) => {
        if (err) return;
        // TODO: this is copy-paste from extract.js
        var client = JSON.parse(data);
        Object.keys(features).forEach(fname => {
            if (features[fname].length === 1) {
                var feature = features[fname].apply(null, [client]);
                if (feature !== undefined) {
                    if (typeof feature === 'object') {
                        Object.keys(feature).forEach(subname => {
                            console.log('PAGE', 'FEATURE', fname + capitalize(subname), '=>', safeFeature(feature[subname]));
                        });
                    }  else {
                        console.log('PAGE', 'FEATURE', fname, '=>', safeFeature(feature));
                    }
                }
            }
        });
        Object.keys(client.peerConnections).forEach(connid => {
            if (connid === 'null') return; // ignore the null connid
            var conn = client.peerConnections[connid];
            var connectionFeatures = {};
            Object.keys(features).forEach(fname => {
                if (features[fname].length === 2) {
                    var feature = features[fname].apply(null, [client, conn]);
                    if (feature !== undefined) {
                        if (typeof feature === 'object') {
                            Object.keys(feature).forEach(subname => {
                                console.log(connid, 'FEATURE', fname + capitalize(subname), '=>', safeFeature(feature[subname]));
                            });
                        }  else {
                            console.log(connid, 'FEATURE', fname, '=>', safeFeature(feature));
                        }
                    }
                }
            });
        });
    });
}
