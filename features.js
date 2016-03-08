// https://en.wikipedia.org/wiki/Feature_extraction for peerconnection
// API traces and getStats data.

var platform = require('platform');

function filterIceConnectionStateChange(peerConnectionLog) {
    return peerConnectionLog.filter(function(entry) {
        return entry.type === 'oniceconnectionstatechange';
    });
}

function filterSignalingStateChange(peerConnectionLog) {
    return peerConnectionLog.filter(function(entry) {
        return entry.type === 'onsignalingstatechange';
    });
}

function getPeerConnectionConfig(peerConnectionLog) {
    for (var i = 0; i < peerConnectionLog.length; i++) {
        if (peerConnectionLog[i].type === 'create') {
            return peerConnectionLog[i].value;
        }
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
    Object.keys(statsReport).forEach(function(id) {
        // type outboundrtp && mediaType video
        var report = statsReport[id];
        if (report.type === 'outboundrtp' && report.mediaType === 'video') {
            count = report[type];
        }
    });
    return count;
}

function extractMaxVideoStat(peerConnectionLog, statName) {
    var max = -1;
    for (var i = 0; i < peerConnectionLog.length; i++) {
        if (peerConnectionLog[i].type === 'getStats') {
            var statsReport = peerConnectionLog[i].value;
            Object.keys(statsReport).forEach(function(id) {
                var report = statsReport[id];
                if (report.type === 'ssrc' && report.mediaType === 'video' && report[statName]) {
                    var t = parseInt(report[statName], 10);
                    max = Math.max(max, t);
                }
            });
        }
    }
    return max !== -1 ? max : undefined;
}

function extractMinVideoStat(peerConnectionLog, statName) {
    var min = Number.MAX_VALUE;
    for (var i = 0; i < peerConnectionLog.length; i++) {
        if (peerConnectionLog[i].type === 'getStats') {
            var statsReport = peerConnectionLog[i].value;
            Object.keys(statsReport).forEach(function(id) {
                var report = statsReport[id];
                if (report.type === 'ssrc' && report.mediaType === 'video' && report[statName]) {
                    var t = parseInt(report[statName], 10);
                    min = Math.min(min, t);
                }
            });
        }
    }
    return min !== Number.MAX_VALUE ? min : undefined;
}

// might not be useful for things like frameWidth/Height which
// have discrete values. mode might be better.
function extractMeanVideoStat(peerConnectionLog, statName) {
    var sum = 0;
    var count = 0;
    for (var i = 0; i < peerConnectionLog.length; i++) {
        if (peerConnectionLog[i].type === 'getStats') {
            var statsReport = peerConnectionLog[i].value;
            Object.keys(statsReport).forEach(function(id) {
                var report = statsReport[id];
                if (report.type === 'ssrc' && report.mediaType === 'video' && report[statName]) {
                    var t = parseInt(report[statName], 10);
                    sum += t;
                    count++;
                }
            });
        }
    }
    return count > 0 ? Math.round(sum / count) : undefined;
}

function wasVideoStatEverTrue(peerConnectionLog, statName) {
    var found = false;
    var wasTrue = false;
    for (var i = 0; i < peerConnectionLog.length && !wasTrue; i++) {
        if (peerConnectionLog[i].type === 'getStats') {
            var statsReport = peerConnectionLog[i].value;
            Object.keys(statsReport).forEach(function(id) {
                var report = statsReport[id];
                if (report.type === 'ssrc' && report[statName]) {
                    found = true;
                    if (report[statName] === 'true') wasTrue = true;
                }
            });
        }
    }
    return found ? wasTrue : undefined;
}

// mode, better suited for things with discrete distributions like
// frame width/height
function extractMostCommonVideoStat(peerConnectionLog, statName) {
    var modes = {};
    for (var i = 0; i < peerConnectionLog.length; i++) {
        if (peerConnectionLog[i].type === 'getStats') {
            var statsReport = peerConnectionLog[i].value;
            Object.keys(statsReport).forEach(function(id) {
                var report = statsReport[id];
                if (report.type === 'ssrc' && report[statName]) {
                    var t = parseInt(report[statName], 10);
                    if (!modes[t]) modes[t] = 0;
                    modes[t]++;
                }
            });
        }
    }
    var mode = undefined;
    var max = -1;
    Object.keys(modes).forEach(function(key) {
        if (modes[key] > max) {
            max = modes[key];
            mode = parseInt(key, 10);
        }
    });
    return mode;
}

// Calculate standardized moment.
// order=1: 0
// order=2: variance
// order=3: skewness
// order=4: kurtosis
function standardizedMoment(series, order) {
    var len = series.length || 1;
    var mean = series.reduce(function(a, b) { return a + b; }, 0) / len;
    return series.reduce(function(a, b) { return a + Math.pow(b - mean, order); }, 0) / len;
}

// extracts the central moment from video statistics.
function extractCentralMomentFromVideoStat(peerConnectionLog, statName, order) {
    var series = [];
    for (var i = 0; i < peerConnectionLog.length; i++) {
        if (peerConnectionLog[i].type === 'getStats') {
            var statsReport = peerConnectionLog[i].value;
            Object.keys(statsReport).forEach(function(id) {
                var report = statsReport[id];
                if (report.type === 'ssrc' && report.mediaType === 'video' && report[statName]) {
                    series.push(parseInt(report[statName], 10));
                }
            });
        }
    }
    return series.length ? standardizedMoment(series, order) : undefined;
}

// there are two types of features
// 1) features which only take the client as argument. E.g. extracting the browser version
// 2) features which take the client and a connection argument. Those do something with the connection.
module.exports = {
    browserName: function(client) {
        return platform.parse(client.userAgent).name;
    },

    browserVersion: function(client) {
        return platform.parse(client.userAgent).version;
    },

    browserMajorVersion: function(client) {
        return platform.parse(client.userAgent).version.split('.')[0];
    },

    browserOS: function(client) {
        return platform.parse(client.userAgent).os.toString();
    },

    browserNameVersion: function(client) {
        var ua = platform.parse(client.userAgent);
        return ua.name + '/' + ua.version;
    },
    browserNameOS: function(client) {
        var ua = platform.parse(client.userAgent);
        return ua.name + '/' + ua.os;
    },
    browserNameVersionOS: function(client) {
        var ua = platform.parse(client.userAgent);
        return ua.name + '/' + ua.version + '/' + ua.os;
    },

    // did the page call getUserMedia at all?
    calledGetUserMedia: function(client) {
        return client.getUserMedia && client.getUserMedia.length > 0;
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
    // TODO: was enumerateDevices used? snoop does not hook this and I do not think
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

    // was there a getUserMedia error which was actually a getUserMediaFailure? Hi https://code.google.com/p/chromium/issues/detail?id=167160
    // typically happens when another application is using the camera.
    getUserMediaSuccessNotReally: function(client) {
        var gum = client.getUserMedia || [];
        for (var i = 0; i < gum.length; i++) {
            if (gum[i].type === 'navigator.mediaDevices.getUserMediaOnSuccess' || gum[i].type === 'getUserMediaOnSuccess') {
                var stream = gum[i].value;
                var tracks = stream && stream.tracks || [];
                for (var j = 0; j < tracks.length; j++) {
                    if (tracks[j].readyState === 'ended') {
                        return true;
                    }
                }
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
        return undefined;
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
    calledGetUserMediaRequestingScreen: function(client) {
        var gum = client.getUserMedia || [];
        var requested = false;
        for (var i = 0; i < gum.length; i++) {
            if (gum[i].type === 'navigator.mediaDevices.getUserMedia' || gum[i].type === 'getUserMedia') {
                var options = gum[i].value;
                if (options.video && typeof options.video === 'object') {
                    // Firefox
                    if (options.video.mozMediaSource || options.video.mediaSource) {
                        requested = true;
                        break;
                    }
                    // Chrome
                    if (options.video.chromeMediaSource) {
                        requested = true;
                        break;
                    }
                }
            }
        }
        return requested;
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
        return client.peerConnections.length;
    },

    // the webrtc platform type -- webkit or moz
    // TODO: edge, mobile platforms?
    browserType: function(client, peerConnectionLog) {
        var peerConnectionConfig = getPeerConnectionConfig(peerConnectionLog);
        return peerConnectionConfig.browserType || 'unknown';
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
        return peerConnectionConfig && peerConnectionConfig.nullConfig === true;
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
        return peerConnectionLog.filter(function(entry) {
            return entry.type === 'onicecandidate' && entry.value === null;
        }).length > 0;
    },

    // was an ice failure detected.
    ICEFailure: function(client, peerConnectionLog) {
        return peerConnectionLog.filter(function(entry) {
            return entry.type === 'oniceconnectionstatechange' && entry.value === 'failed';
        }).length > 0;
    },

    // was an ice failure after a successful connection detected.
    ICEFailureSubsequent: function(client, peerConnectionLog) {
        var log = filterIceConnectionStateChange(peerConnectionLog);
        var failures = log.filter(function(entry) {
            return entry.type === 'oniceconnectionstatechange' && entry.value === 'failed';
        }).length;
        if (failures > 0) {
            return log.filter(function(entry) {
                return entry.type === 'oniceconnectionstatechange' && (entry.value === 'connected' || entry.value === 'completed');
            }).length > 0;
        }
        return false;
    },

    // did ice connect/complete?
    ICEConnectedOrCompleted: function(client, peerConnectionLog) {
        return peerConnectionLog.filter(function(entry) {
            return entry.type === 'oniceconnectionstatechange' && (entry.value === 'connected' || entry.value === 'completed');
        }).length > 0;
    },

    // is the session using ICE lite?
    usingICELite: function(client, peerConnectionLog) {
        var usingIceLite = false;
        peerConnectionLog.forEach(function(entry) {
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
        peerConnectionLog.forEach(function(entry) {
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
        peerConnectionLog.forEach(function(entry) {
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
        peerConnectionLog.forEach(function(entry) {
            if (!iceRestart && entry.type === 'createOffer') {
                if (entry.value && entry.value.iceRestart) {
                    iceRestart = true;
                }
            }
        });
        return iceRestart;
    },

    // was the signaling state stable at least once?
    signalingStableAtLeastOnce: function(client, peerConnectionLog) {
        return peerConnectionLog.filter(function(entry) {
            return entry.type === 'onsignalingstatechange' && entry.value === 'stable';
        }).length > 0;
    },

    // was more than one remote stream added?
    usingMultistream: function(client, peerConnectionLog) {
        return peerConnectionLog.filter(function(entry) {
            return entry.type === 'onaddstream';
        }).length > 1;
    },

    // maximum number of concurrent streams
    maxStreams: function(client, peerConnectionLog) {
        var max = 0;
        peerConnectionLog.forEach(function(entry) {
            if (entry.type === 'onaddstream') max++;
            else if (entry.type === 'onremovestream' && max > 0) max--;
        });
        return max;
    },

    // was there a peerconnection api failure?
    peerConnectionSetDescriptionFailure: function(client, peerConnectionLog) {
        return peerConnectionLog.filter(function(entry) {
            switch(entry.type) {
                case 'SetLocalDescriptionOnFailure':
                case 'SetRemoteDescriptionOnFailure':
                    return true;
            }
            return false;
        }).length > 0;
    },

    // was there an addIceCandidate failure
    peerConnectionAddIceCandidateFailure: function(client, peerConnectionLog) {
        return peerConnectionLog.filter(function(entry) {
            return entry.type === 'AddIceCandidateOnFailure';
        }).length > 0;
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
        return undefined;
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
        return false;
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
        return false;
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
    // was there a remote candidate TURN added?
    // that is about as much as we can tell unless we snoop onto the
    // peerconnection and determine remote browser.
    hadRemoteTURNCandidate: function(client, peerConnectionLog) {
        // TODO: might be hiding in setRemoteDescription, too.
        for (var i = 0; i < peerConnectionLog.length; i++) {
            if (peerConnectionLog[i].type === 'addIceCandidate') {
                var cand = peerConnectionLog[i].value;
                if (cand && cand.candidate.indexOf('relay') !== -1) {
                    return true;
                }
            }
        }
        return false;
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
        return peerConnectionLog.filter(function(entry) {
            return entry.type === 'onicecandidate' && entry.value;
        }).length;
    },

    // number of remote ice candidates.
    numberOfRemoteIceCandidates: function(client, peerConnectionLog) {
        var candsInSdp = -1;
        // needs sentinel to avoid adding candidates from subsequent generations.
        peerConnectionLog.forEach(function(entry) {
            if (candsInSdp === -1 && entry.type === 'setRemoteDescription') {
                if (entry.value.sdp) {
                    candsInSdp = entry.value.sdp.split('\n').filter(function (line) {
                        return line.indexOf('a=candidate:') === 0;
                    }).length;
                }
            }
        });
        if (candsInSdp === -1) candsInSdp = 0;
        return candsInSdp + peerConnectionLog.filter(function(entry) {
            return entry.type === 'addIceCandidate';
        }).length;
    },

    // session duration, defined by ICE states.
    sessionDuration: function(client, peerConnectionLog) {
        var startTime = -1;
        var endTime = -1;
        peerConnectionLog.forEach(function(entry) {
            if (entry.type === 'oniceconnectionstatechange') {
                if (entry.value === 'checking') {
                    startTime = new Date(entry.time).getTime();
                } else if (entry.value === 'closed') {
                    endTime = new Date(entry.time).getTime();
                }
            }
        });
        if (startTime > 0 && endTime > 0) {
            return endTime - startTime;
        }
        return -1;
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
                var lines = desc.sdp.split('\n').filter(function(line) {
                    return line.indexOf('m=') === 0;
                });
                lines.forEach(function(line) {
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
            Object.keys(statsReport).forEach(function(id) {
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
            Object.keys(statsReport).forEach(function(id) {
                var report = statsReport[id];
                if (report.type === 'googComponent' && report.srtpCipher) {
                    srtpCipher = report.srtpCipher;
                }
            });
            if (srtpCipher) return srtpCipher;
        }
    },

    // mean audio level sent. Between 0 and 1
    statsMeanAudioLevel: function(client, peerConnectionLog) {
        var audioLevels = {};
        peerConnectionLog.forEach(function(entry) {
            if (entry.type !== 'getStats') return;
            var statsReport = entry.value;
            // look for type track, remoteSource: false, audioLevel (0..1)
            Object.keys(statsReport).forEach(function(id) {
                var report = statsReport[id];
                if (report.type === 'track' && report.remoteSource === false && report.audioLevel !== undefined) {
                    if (!audioLevels[id]) audioLevels[id] = [];
                    audioLevels[id].push(report.audioLevel);
                }
            });
        });
        var means = Object.keys(audioLevels).map(function(id) {
            return audioLevels[id].reduce(function(a, b) {
                return a + b;
            }, 0) / (audioLevels[id].length || 1);
        });
        // TODO: support multiple local streams?
        if (means.length) {
            return means[0];
        }
        return 0;
    },

    // mean RTT of the selected candidate pair.
    statsMeanRoundTripTime: function(client, peerConnectionLog) {
        var rtts = [];
        peerConnectionLog.forEach(function(entry) {
            if (entry.type !== 'getStats') return;
            var statsReport = entry.value;
            // look for type track, remoteSource: false, audioLevel (0..1)
            Object.keys(statsReport).forEach(function(id) {
                var report = statsReport[id];
                if (report.type === 'candidatepair' && report.selected === true) {
                    rtts.push(report.roundTripTime);
                }
            });
        });
        return Math.floor(rtts.reduce(function(a, b) {
            return a + b;
        }, 0) / (rtts.length || 1));
    },

    // mean recv bitrate
    // TODO: only when receiving tracks? not really interested in rtcp
    statsMeanReceivingBitrate: function(client, peerConnectionLog) {
        var bitrates = [];
        var lastStatsReport;
        var lastTime;
        for (var i = 0; i < peerConnectionLog.length; i++) {
            if (peerConnectionLog[i].type !== 'getStats') continue;
            var statsReport = peerConnectionLog[i].value;
            if (lastStatsReport) {
                Object.keys(statsReport).forEach(function(id) {
                    var report = statsReport[id];
                    if (report.type === 'candidatepair' && report.selected === true && lastStatsReport[id]) {
                        var bitrate = 8 * (report.bytesReceived - lastStatsReport[id].bytesReceived) / (peerConnectionLog[i].time - lastTime);
                        // needs to work around resetting counters -- https://bugs.chromium.org/p/webrtc/issues/detail?id=5361
                        if (bitrate > 0) {
                            bitrates.push(bitrate);
                        }
                    }
                });
            }
            lastStatsReport = statsReport;
            lastTime = peerConnectionLog[i].time;
        }
        return Math.floor(bitrates.reduce(function(a, b) {
            return a + b;
        }, 0) / (bitrates.length || 1));
    },

    // mean send bitrate
    // TODO: only when sending tracks? not really interested in rtcp
    statsMeanSendingBitrate: function(client, peerConnectionLog) {
        var bitrates = [];
        var lastStatsReport;
        var lastTime;
        for (var i = 0; i < peerConnectionLog.length; i++) {
            if (peerConnectionLog[i].type !== 'getStats') continue;
            var statsReport = peerConnectionLog[i].value;
            if (lastStatsReport) {
                Object.keys(statsReport).forEach(function(id) {
                    var report = statsReport[id];
                    if (report.type === 'candidatepair' && report.selected === true && lastStatsReport[id]) {
                        var bitrate = 8 * (report.bytesSent - lastStatsReport[id].bytesSent) / (peerConnectionLog[i].time - lastTime);
                        // needs to work around resetting counters -- https://bugs.chromium.org/p/webrtc/issues/detail?id=5361
                        if (bitrate > 0) {
                            bitrates.push(bitrate);
                        }
                    }
                });
            }
            lastStatsReport = statsReport;
            lastTime = peerConnectionLog[i].time;
        }
        return Math.floor(bitrates.reduce(function(a, b) {
            return a + b;
        }, 0) / (bitrates.length || 1));
    },


    firstCandidatePairType: function(client, peerConnectionLog) {
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
            Object.keys(statsReport).forEach(function(id) {
                var report = statsReport[id];
                if (report.type === 'candidatepair' && report.selected === true) {
                    pair = statsReport[report.localCandidateId].candidateType +
                        ';' + statsReport[report.remoteCandidateId].candidateType;
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
            Object.keys(statsReport).forEach(function(id) {
                var report = statsReport[id];
                if (report.type === 'candidatepair' && report.selected === true) {
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
                if (report.type === 'candidatepair' && report.selected === true) {
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
            Object.keys(statsReport).forEach(function(id) {
                var report = statsReport[id];
                if (report.type === 'candidatepair' && report.selected === true) {
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

    // the ssrc rtt is based on rtcp and requires audio input sent.
    // We suspect this correlates to the getUserMediaSuccessNotReally bug.
    sendAudioRTTNeverGreaterZero: function(client, peerConnectionLog) {
        var value = -2;
        for (var i = 0; i < peerConnectionLog.length; i++) {
            if (peerConnectionLog[i].type === 'getStats') {
                var statsReport = peerConnectionLog[i].value;
                Object.keys(statsReport).forEach(function(id) {
                    var report = statsReport[id];
                    if (report.type === 'ssrc' && report.mediaType === 'audio' && report.audioInputLevel && report.googRtt) {
                        value = parseInt(report.googRtt, 10);
                    }
                });
                if (value > 0) return false;
            }
        }
        return value === -1 ? true : undefined;
    },

    // TODO: jitter
    // TODO: packets lost (audio and video separated)
    // TODO: packets sent
    // TODO: packets received
    // TODO: goog things possibly discarded by snoop?
    // TODO: packetsDiscardedOnSend
    // TODO: goog aec thingies and typing noise states
    // TODO: goog plc things
};

// frame rate is not discrete, so mode does not make sense.
['googFrameRateInput', 'googFrameRateSent', 'googFrameRateReceived', 'googFrameRateOutput'].forEach(function(stat) {
    module.exports['max' + stat[0].toUpperCase() + stat.substr(1)] = function(client, peerConnectionLog) {
        return extractMaxVideoStat(peerConnectionLog, stat);
    };
    module.exports['min' + stat[0].toUpperCase() + stat.substr(1)] = function(client, peerConnectionLog) {
        return extractMinVideoStat(peerConnectionLog, stat);
    };
    module.exports['mean' + stat[0].toUpperCase() + stat.substr(1)] = function(client, peerConnectionLog) {
        return extractMeanVideoStat(peerConnectionLog, stat);
    };
});

// discrete values, mean does not make sense but mode does
['googFrameHeightInput', 'googFrameHeightSent', 'googFrameWidthInput', 'googFrameWidthSent',
   'googFrameHeightReceived', 'googFrameWidthReceived'].forEach(function(stat) {
    module.exports['max' + stat[0].toUpperCase() + stat.substr(1)] = function(client, peerConnectionLog) {
        return extractMaxVideoStat(peerConnectionLog, stat);
    };
    module.exports['min' + stat[0].toUpperCase() + stat.substr(1)] = function(client, peerConnectionLog) {
        return extractMinVideoStat(peerConnectionLog, stat);
    };
    module.exports['mode' + stat[0].toUpperCase() + stat.substr(1)] = function(client, peerConnectionLog) {
        return extractMostCommonVideoStat(peerConnectionLog, stat);
    };
});

// googMinPlayoutDelayMs -- may be used to detect desync between audio and video
//          Minimum playout delay (used for lip-sync). This is the minimum delay required
//          to sync with audio. Not included in  VideoCodingModule::Delay()
//          Defaults to 0 ms.
// for these stats, mode does not make sense
['googCurrentDelayMs', 'googJitterBufferMs', 'googMinPlayoutDelayMs', 'googTargetDelayMs'].forEach(function(stat) {
    module.exports['max' + stat[0].toUpperCase() + stat.substr(1)] = function(client, peerConnectionLog) {
        return extractMaxVideoStat(peerConnectionLog, stat);
    };
    // min seem to be 0?
    module.exports['min' + stat[0].toUpperCase() + stat.substr(1)] = function(client, peerConnectionLog) {
        return extractMinVideoStat(peerConnectionLog, stat);
    };
    module.exports['mean' + stat[0].toUpperCase() + stat.substr(1)] = function(client, peerConnectionLog) {
        return extractMeanVideoStat(peerConnectionLog, stat);
    };
});

['googCpuLimitedResolution', 'googViewLimitedResolution', 'googBandwidthLimitedResolution'].forEach(function(stat) {
    module.exports['was' + stat[0].toUpperCase() + stat.substr(1) + 'EverTrue'] = function(client, peerConnectionLog) {
        return wasVideoStatEverTrue(peerConnectionLog, stat);
    };
});

// calculate central moment of jitter, assmuning it is a random variable.
['googJitterBufferMs', 'googRtt'].forEach(function(stat) {
    module.exports['variance' + stat[0].toUpperCase() + stat.substr(1)] = function(client, peerConnectionLog) {
        return extractCentralMomentFromVideoStat(peerConnectionLog, stat, 2);
    };
    module.exports['skewness' + stat[0].toUpperCase() + stat.substr(1)] = function(client, peerConnectionLog) {
        return extractCentralMomentFromVideoStat(peerConnectionLog, stat, 3);
    };
    module.exports['kurtosis' + stat[0].toUpperCase() + stat.substr(1)] = function(client, peerConnectionLog) {
        return extractCentralMomentFromVideoStat(peerConnectionLog, stat, 4);
    };
});

if (require.main === module) {
    console.log(Object.keys(module.exports).length + ' features implemented.');
}
