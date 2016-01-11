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

module.exports = {
    // did ice gathering complete (aka: onicecandidate called with a null candidate)
    feature_ICEGatheringComplete: function(peerConnectionLog, stats) {
        return peerConnectionLog.filter(function(entry) {
            return entry.type === 'onicecandidate' && entry.value === null;
        }).length > 0;
    },

    // was an ice failure detected.
    feature_ICEFailure: function(peerConnectionLog, stats) {
        return peerConnectionLog.filter(function(entry) {
            return entry.type === 'oniceconnectionstatechange' && entry.value === 'failed';
        }).length > 0;
    },

    // was an ice failure after a successful connection detected.
    feature_ICEFailureSubsequent: function(peerConnectionLog, stats) {
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
    feature_ICEConnectedOrCompleted: function(peerConnectionLog, stats) {
        return peerConnectionLog.filter(function(entry) {
            return entry.type === 'oniceconnectionstatechange' && (entry.value === 'connected' || entry.value === 'completed');
        }).length > 0;
    },

    // is the session using ICE lite?
    feature_usingICELite: function(peerConnectionLog, stats) {
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
    feature_usingRTCPMux: function(peerConnectionLog, stats) {
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
    feature_usingBundle: function(peerConnectionLog, stats) {
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

    feature_ICERestart: function(peerConnectionLog, stats) {
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
    feature_SignalingStableAtLeastOnce: function(peerConnectionLog, stats) {
        return peerConnectionLog.filter(function(entry) {
            return entry.type === 'onsignalingstatechange' && entry.value === 'stable';
        }).length > 0;
    },

    // was more than one remote stream added?
    feature_Multistream: function(peerConnectionLog, stats) {
        return peerConnectionLog.filter(function(entry) {
            return entry.type === 'onaddstream';
        }).length > 1;
    },

    // maximum number of concurrent streams
    feature_MaxStreams: function(peerConnectionLog, stats) {
        var max = 0;
        peerConnectionLog.forEach(function(entry) {
            if (entry.type === 'onaddstream') max++;
            else if (entry.type === 'onremovestream' && max > 0) max--;
        });
        return max;
    },

    // was there a peerconnection api failure?
    feature_PeerConnectionSetDescriptionFailure: function(peerConnectionLog, stats) {
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
    feature_PeerConnectionAddIceCandidateFailure: function(peerConnectionLog, stats) {
        return peerConnectionLog.filter(function(entry) {
            return entry.type === 'AddIceCandidateOnFailure';
        }).length > 0;
    },

    // how long does it take to establish the connection?
    // TODO: also figure out connection type so we don't lump relayed and non-relayed connections
    feature_ConnectionTime: function(peerConnectionLog, stats) {
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
    feature_localCreateDelay: function(peerConnectionLog, stats) {
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
    feature_numberOfLocalIceCandidates: function(peerConnectionLog, stats) {
        return peerConnectionLog.filter(function(entry) {
            return entry.type === 'onicecandidate' && entry.value;
        }).length;
    },

    // number of remote ice candidates.
    feature_numberOfRemoteIceCandidates: function(peerConnectionLog, stats) {
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
    feature_sessionDuration: function(peerConnectionLog, stats) {
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
    feature_mediaTypes: function(peerConnectionLog, stats) {
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
    feature_statsMeanAudioLevel: function(peerConnectionLog, stats) {
        var audioLevels = {};
        stats.forEach(function(entry) {
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
    feature_statsMeanRoundTripTime: function(peerConnectionLog, stats) {
        var rtts = [];
        stats.forEach(function(entry) {
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

    // how did the selected candidate pair change? Could happen e.g. because of an ice restart
    // so there should be a strong correlation.
    feature_numberOfCandidatePairChanges: function(peerConnectionLog, stats) {
        var selectedCandidatePairList = [null];
        for (var i = 0; i < stats.length; i++) {
            var statsReport = stats[i].value;
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
    feature_flakyActive: function(peerConnectionLog, stats) {
        var selectedCandidatePairList = [null];
        for (var i = 0; i < stats.length; i++) {
            var statsReport = stats[i].value;
            Object.keys(statsReport).forEach(function(id) {
                var report = statsReport[id];
                if (report.type === 'candidatepair' && report.selected === true) {
                    /* this is interesting as it shows flakyness in -1-0 and -1-1 and back at the
                     * receiver during  ice restart but that is not what we are looking for. */
                    if (report.id !== selectedCandidatePairList[selectedCandidatePairList.length - 1]) {
                        selectedCandidatePairList.push(report.id);
                        console.log('candidate pair change', i, stats[i].time, report.id);
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
        return 0;
    }
};
