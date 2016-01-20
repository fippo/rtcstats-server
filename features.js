// https://en.wikipedia.org/wiki/Feature_extraction for peerconnection API traces.
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

// there are two types of features
// 1) features which only take the client as argument. E.g. extracting the browser version
// 2) features which take the client and a connection argument. Those do something with the connection.
module.exports = {
    browserVersion: function(client) {
        // parse client.userAgent and return something
        // e.g. Firefox/43 or Chrome/48
        // TODO
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
            }
        }
        return requested;
    },
    // TODO: resolution, framerate
    // TODO: special goog constraints?
    // TODO: feature for "were the promise-ified apis used or the legacy variants?"

    // number of peerConnections created
    numberOfPeerConnections: function(client) {
        return client.peerConnections.length;
    },

    // check if we are initiator/receiver (i.e. first called createOffer or createAnswer)
    // this likely has implications for number and types of candidates gathered.
    feature_isInitiator: function(client, peerConnectionLog) {
        for (var i = 0; i < peerConnectionLog.length; i++) {
            if (peerConnectionLog[i].type === 'createOffer') return true;
            if (peerConnectionLog[i].type === 'setRemoteDescription') return false;
        }
        return undefined;
    },

    // were ice servers configured? Not sure whether this is useful and/or should check if any empty list
    // was configured
    feature_configuredWithICEServers: function(client, peerConnectionLog) {
        var peerConnectionConfig = getPeerConnectionConfig(peerConnectionLog);
        return !!(peerConnectionConfig && peerConnectionConfig.iceServers !== undefined)
    },

    // was STUN configured in the peerconnection config?
    feature_configuredWithSTUN: function(client, peerConnectionLog) {
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
    feature_configuredWithTURN: function(client, peerConnectionLog) {
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
    feature_configuredWithTURNUDP: function(client, peerConnectionLog) {
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
    feature_configuredWithTURNTCP: function(client, peerConnectionLog) {
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
    feature_configuredWithTURNTLS: function(client, peerConnectionLog) {
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

    // what bundle policy was supplied?
    // TODO: return default or do we want to measure explicit configuration?
    feature_configuredBundlePolicy: function(client, peerConnectionLog) {
        var peerConnectionConfig = getPeerConnectionConfig(peerConnectionLog);
        return peerConnectionConfig ? peerConnectionConfig.bundlePolicy !== undefined : false; // default: 'balanced'
    },

    // what rtcp-mux configuration was supplied?
    // TODO: return default or do we want to measure explicit configuration?
    feature_configuredRtcpMuxPolicy: function(client, peerConnectionLog) {
        var peerConnectionConfig = getPeerConnectionConfig(peerConnectionLog);
        return peerConnectionConfig ? peerConnectionConfig.rtcpMuxPolicy !== undefined : false; // default: 'require'
    },
    // what iceTransportPolicy configuration was supplied?
    // TODO: return default or do we want to measure explicit configuration?
    feature_configuredIceTransportPolicy: function(client, peerConnectionLog) {
        var peerConnectionConfig = getPeerConnectionConfig(peerConnectionLog);
        return peerConnectionConfig ? peerConnectionConfig.iceTransportPolicy !== undefined : false; // default: 'all'
    },

    // did ice gathering complete (aka: onicecandidate called with a null candidate)
    feature_ICEGatheringComplete: function(client, peerConnectionLog) {
        return peerConnectionLog.filter(function(entry) {
            return entry.type === 'onicecandidate' && entry.value === null;
        }).length > 0;
    },

    // was an ice failure detected.
    feature_ICEFailure: function(client, peerConnectionLog) {
        return peerConnectionLog.filter(function(entry) {
            return entry.type === 'oniceconnectionstatechange' && entry.value === 'failed';
        }).length > 0;
    },

    // was an ice failure after a successful connection detected.
    feature_ICEFailureSubsequent: function(client, peerConnectionLog) {
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
    feature_ICEConnectedOrCompleted: function(client, peerConnectionLog) {
        return peerConnectionLog.filter(function(entry) {
            return entry.type === 'oniceconnectionstatechange' && (entry.value === 'connected' || entry.value === 'completed');
        }).length > 0;
    },

    // is the session using ICE lite?
    feature_usingICELite: function(client, peerConnectionLog) {
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
    feature_usingRTCPMux: function(client, peerConnectionLog) {
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
    feature_usingBundle: function(client, peerConnectionLog) {
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

    feature_ICERestart: function(client, peerConnectionLog) {
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
    feature_SignalingStableAtLeastOnce: function(client, peerConnectionLog) {
        return peerConnectionLog.filter(function(entry) {
            return entry.type === 'onsignalingstatechange' && entry.value === 'stable';
        }).length > 0;
    },

    // was more than one remote stream added?
    feature_Multistream: function(client, peerConnectionLog) {
        return peerConnectionLog.filter(function(entry) {
            return entry.type === 'onaddstream';
        }).length > 1;
    },

    // maximum number of concurrent streams
    feature_MaxStreams: function(client, peerConnectionLog) {
        var max = 0;
        peerConnectionLog.forEach(function(entry) {
            if (entry.type === 'onaddstream') max++;
            else if (entry.type === 'onremovestream' && max > 0) max--;
        });
        return max;
    },

    // was there a peerconnection api failure?
    feature_PeerConnectionSetDescriptionFailure: function(client, peerConnectionLog) {
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
    feature_PeerConnectionAddIceCandidateFailure: function(client, peerConnectionLog) {
        return peerConnectionLog.filter(function(entry) {
            return entry.type === 'AddIceCandidateOnFailure';
        }).length > 0;
    },

    // how long does it take to establish the connection?
    // TODO: also figure out connection type so we don't lump relayed and non-relayed connections
    feature_ConnectionTime: function(client, peerConnectionLog) {
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
    feature_localCreateDelay: function(client, peerConnectionLog) {
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
    feature_numberOfLocalIceCandidates: function(client, peerConnectionLog) {
        return peerConnectionLog.filter(function(entry) {
            return entry.type === 'onicecandidate' && entry.value;
        }).length;
    },

    // number of remote ice candidates.
    feature_numberOfRemoteIceCandidates: function(client, peerConnectionLog) {
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
    feature_sessionDuration: function(client, peerConnectionLog) {
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
    feature_mediaTypes: function(client, peerConnectionLog) {
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

    // mean audio level sent. Between 0 and 1
    feature_statsMeanAudioLevel: function(client, peerConnectionLog) {
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
            }, 0) / audioLevels[id].length;
        });
        // TODO: support multiple local streams?
        if (means.length) {
            return means[0];
        }
        return 0;
    },

    // mean RTT of the selected candidate pair.
    feature_statsMeanRoundTripTime: function(client, peerConnectionLog) {
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
        }, 0) / rtts.length);
    },

    // mean recv bitrate
    // TODO: only when receiving tracks? not really interested in rtcp
    feature_statsMeanReceivingBitrate: function(client, peerConnectionLog) {
        var bitrates = [];
        var lastStatsReport;
        var lastTime;
        for (var i = 0; i < peerConnectionLog.length; i++) {
            if (peerConnectionLog[i].type !== 'getStats') continue;
            var statsReport = peerConnectionLog[i].value;
            if (lastStatsReport) {
                Object.keys(statsReport).forEach(function(id) {
                    var report = statsReport[id];
                    if (report.type === 'candidatepair' && report.selected === true) {
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
        }, 0) / bitrates.length);
    },

    // mean send bitrate
    // TODO: only when sending tracks? not really interested in rtcp
    feature_statsMeanSendingBitrate: function(client, peerConnectionLog) {
        var bitrates = [];
        var lastStatsReport;
        var lastTime;
        for (var i = 0; i < peerConnectionLog.length; i++) {
            if (peerConnectionLog[i].type !== 'getStats') continue;
            var statsReport = peerConnectionLog[i].value;
            if (lastStatsReport) {
                Object.keys(statsReport).forEach(function(id) {
                    var report = statsReport[id];
                    if (report.type === 'candidatepair' && report.selected === true) {
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
        }, 0) / bitrates.length);
    },

    // how did the selected candidate pair change? Could happen e.g. because of an ice restart
    // so there should be a strong correlation.
    feature_numberOfCandidatePairChanges: function(client, peerConnectionLog) {
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
    feature_flakyActive: function(client, peerConnectionLog) {
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

    // how often did the selected interface type change? e.g. a wifi->mobile transition
    // see https://code.google.com/p/chromium/codesearch#chromium/src/third_party/libjingle/source/talk/app/webrtc/statscollector.cc&q=statscollector&sq=package:chromium&l=53
    // TODO: check if this really allows detecting such transitions
    feature_numberOfCandidatePairChanges: function(client, peerConnectionLog) {
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
    feature_numberOfPLISent: function(client, peerConnectionLog) {
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
                count = report.pliCount;
            }
        });
        return count;
    },

    // count # of FIRs sent
    // TODO: recv but that might be more difficult with multiple streams
    feature_numberOfFIRSent: function(client, peerConnectionLog) {
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
                count = report.firCount;
            }
        });
        return count;
    },

    // count # of NACKs sent
    // TODO: recv but that might be more difficult with multiple streams
    feature_numberOfNACKSent: function(client, peerConnectionLog) {
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
                count = report.nackCount;
            }
        });
        return count;
    },

    // TODO: gum statistics (audio, video, number of tracks, errors, fail-to-acquire aka ended readyState)
    // TODO: jitter
    // TODO: packets lost (audio and video separated)
    // TODO: packets sent
    // TODO: packets received
    // TODO: goog things possibly discarded by snoop?
    // TODO: packetsDiscardedOnSend 
    // TODO: goog aec thingies and typing noise states
    // TODO: goog plc things
    // TODO: googMinPlayoutDelayMs -- may be used to detect desync between audio and video
    //          Minimum playout delay (used for lip-sync). This is the minimum delay required
    //          to sync with audio. Not included in  VideoCodingModule::Delay()
    //          Defaults to 0 ms.

    // statistics on windowed statistics... thanks STFT and kurtogram.
    // not sure if this one makes much sense so might be more of a prototype
    // for more advanced statistics
    feature_windowedMaximumPacketLoss: function(client, peerConnectionLog) {
        // find audio stream, look at packet loss (or something), then window (60s? currently 10)
        // generate mean over window, return max/mean (min should be 0)
        var win = [];
        var start;
        var streamid;
        var statsReport;
        for (var i = 0; i < peerConnectionLog.length && !streamid; i++) {
            if (peerConnectionLog[i].type === 'getStats') {
                statsReport = peerConnectionLog[i].value;
                Object.keys(statsReport).forEach(function(id) {
                    var report = statsReport[id];
                    if (report.type === 'outboundrtp' && report.isRemote === true && report.associateStatsId && statsReport[report.associateStatsId]
                            && statsReport[report.associateStatsId].mediaType === 'audio') {
                        streamid = id;
                        start = i;
                    }
                });
                break;
            }
        }
        var losses = [];
        if (streamid) {
            var lastReport = peerConnectionLog[start].value;
            for (i = start + 1; i < peerConnectionLog.length; i++) {
                if (peerConnectionLog[i].type !== 'getStats') return;
                statsReport = peerConnectionLog[i].value;
                if (peerConnectionLog[i].time - peerConnectionLog[start].time > 10000) {
                    start = i;
                    losses.push(win.reduce(function(a, b) { return a + b; }, 0) / win.length); // mean
                    win = [];
                }
                win.push(statsReport[streamid].packetsLost - lastReport[streamid].packetsLost);
            }
            return losses.reduce(function(a, b) { return b > a ? b : a; }, 0); // maximum
        }
    },
};
