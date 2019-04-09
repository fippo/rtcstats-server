'use strict';
// https://en.wikipedia.org/wiki/Feature_extraction for peerconnection
// API traces and getStats data.
// there are three types of features
// 1) features which only take the client as argument. E.g. extracting the browser version
// 2) features which take the client and a connection argument. Those do something with the connection.
// 3) features which are specific to a track.
// The second type of feature is contained in this file.

const {capitalize, standardizedMoment, timeBetween} = require('./utils');
const SDPUtils = require('sdp');

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
            return peerConnectionLog[second].timestamp - peerConnectionLog[first].timestamp;
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
        // type outbound-rtp && kind video
        var report = statsReport[id];
        if (report.type === 'outbound-rtp' && (report.kind === 'video' || report.mediaType === 'video')) {
            count = report[type];
        }
    });
    return count;
}

// extract a local/remote audio or video track.
function extractTrack(peerConnectionLog, kind, direction) {
    const allTracks = extractTracks(peerConnectionLog);
    for (const [trackId, value] of allTracks.entries()) {
        if (value.kind === kind && value.direction === direction) {
            return value.stats;
        }
    }
    return [];
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

module.exports = {
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
                return peerConnectionLog[i].timestamp;
            }
        }
    },

    // when did the session end
    stopTime: function(client, peerConnectionLog) {
        return peerConnectionLog[peerConnectionLog.length - 1].timestamp;
    },

    // how long did the peerconnection live?
    // not necessarily connected which is different from session duration
    lifeTime: function(client, peerConnectionLog) {
        const lifeTime = peerConnectionLog[peerConnectionLog.length - 1].timestamp - peerConnectionLog[0].timestamp;
        return lifeTime > 0 ? lifeTime : null;
    },

    sendingDuration: function(client, peerConnectionLog) {
        let sendingDuration = 0;
        let prevTime = peerConnectionLog[0].timestamp;
        let prevSending = false;

        peerConnectionLog.forEach(({type, value, timestamp}) => {
            if (type !== 'setLocalDescription') {
                return;
            }
            const sections = SDPUtils.getMediaSections(value.sdp);
            const direction = SDPUtils.getDirection(sections[0]);
            const logSending = ['sendonly', 'sendrecv'].includes(direction);
            if (prevSending) {
                sendingDuration += timestamp - prevTime;
            }
            prevTime = timestamp;
            prevSending = logSending;
        });
        if (prevSending) {
            sendingDuration += peerConnectionLog[peerConnectionLog.length - 1].timestamp - prevTime;
        }
        return sendingDuration;
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
            if (typeof urls === 'string') {
                urls = [urls];
            }
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

    // was the peerconnection created with non-spec SDES?
    configuredSDES: function(client, peerConnectionLog) {
        const constraints = getPeerConnectionConstraints(peerConnectionLog) || {};
        return constraints && constraints.mandatory && constraints.mandatory.DtlsSrtpKeyAgreement === false;
    },

    sdpSemantics: function(client, peerConnectionLog) {
        var peerConnectionConfig = getPeerConnectionConfig(peerConnectionLog);
        return peerConnectionConfig ? peerConnectionConfig.sdpSemantics : '';
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

    // ICE connected but connectionState not indicates a DTLS failure
    dtlsFailure: function(client, peerConnectionLog) {
        let iceConnected = false;
        let connected = false;
        for (let i = 0; i < peerConnectionLog.length; i++) {
            if (peerConnectionLog[i].type === 'oniceconnectionstatechange' && (peerConnectionLog[i].value === 'connected' || peerConnectionLog[i].value === 'completed')) {
                iceConnected = true;
            }
            if (peerConnectionLog[i].type === 'onconnectionstatechange' && peerConnectionLog[i].value === 'connected') {
                connected = true;
            }
        }
        if (iceConnected && !connected) {
            return false;
        } else if (iceConnected && connected) {
            return true;
        }
    },

    // Firefox has a timeout of ~5 seconds where addIceCandidate needs to happen after SRD.
    // This calculates the delay between SRD and addIceCandidate which should allow
    // correlation with ICE failures caused by this.
    // returns -1 if addIceCandidate is called before setRemoteDescription
    timeBetweenSetRemoteDescriptionAndAddIceCandidate: function(client, peerConnectionLog) {
        return timeBetween(peerConnectionLog, ['setRemoteDescription'], ['addIceCandidate']);
    },

    // This calculates the delay between SLD and onicecandidate.
    timeBetweenSetLocalDescriptionAndOnIceCandidate: function(client, peerConnectionLog) {
        return timeBetween(peerConnectionLog, ['setLocalDescription'], ['onicecandidate']);
    },

    // This calculates the time between the first SRD and resolving.
    timeForFirstSetRemoteDescription: function(client, peerConnectionLog) {
        return timeBetween(peerConnectionLog, ['setRemoteDescription'], ['setRemoteDescriptionOnSuccess']);
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

    numberOfRemoteStreams: function(client, peerConnectionLog) {
        const remoteStreams = {};
        for (let i = 0; i < peerConnectionLog.length; i++) {
            if (peerConnectionLog[i].type === 'ontrack') {
                const {value} = peerConnectionLog[i];
                const streamId = value.split(' ')[1];
                remoteStreams[streamId] = true;
            }
        }
        return Object.keys(remoteStreams).length;
    },

    usingSimulcast: function(client, peerConnectionLog) {
        for (var i = 0; i < peerConnectionLog.length; i++) {
            if (peerConnectionLog[i].type === 'setLocalDescription') {
                const value = peerConnectionLog[i].value;
                const simulcast = value && value.sdp && (value.sdp.indexOf('a=ssrc-group:SIM') !== -1 || value.sdp.indexOf('a=simulcast:') !== -1);
                if (simulcast) {
                    return true;
                }
            }
        }
        return false;
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
                return peerConnectionLog[second].timestamp - peerConnectionLog[first].timestamp;
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
                if (cand === null) break; // gathering finished so we have seen all candidates.
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
    connectionTime: function(client, peerConnectionLog) {
        var first;
        var second;
        for (first = 0; first < peerConnectionLog.length; first++) {
            if (peerConnectionLog[first].type === 'onconnectionstatechange' &&
                peerConnectionLog[first].value === 'connecting') break;
        }
        if (first < peerConnectionLog.length) {
            for (second = first + 1; second < peerConnectionLog.length; second++) {
                if (peerConnectionLog[second].type === 'onconnectionstatechange' &&
                    peerConnectionLog[second].value === 'connected') break;
            }
            if (second < peerConnectionLog.length) {
                return peerConnectionLog[second].timestamp - peerConnectionLog[first].timestamp;
            }
        }
    },

    // how long does it take to establish the ice connection?
    iceConnectionTime: function(client, peerConnectionLog) {
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
                return peerConnectionLog[second].timestamp - peerConnectionLog[first].timestamp;
            }
        }
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
                return peerConnectionLog[second].timestamp - peerConnectionLog[first].timestamp;
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
                    startTime = entry.timestamp;
                    break;
                }
            }
        }
        if (startTime > 0) {
            // TODO: this is too simplistic. What if the ice connection state went to failed?
            for (var j = peerConnectionLog.length - 1; j > i; j--) {
                endTime = peerConnectionLog[j].timestamp;
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

    bytesTotal: function(client, peerConnectionLog) {
        // TODO: does this reset during a restart? See
        // https://bugs.chromium.org/p/webrtc/issues/detail?id=5361
        let lastReport;
        for (let i = 0; i < peerConnectionLog.length; i++) {
            const {type, value} = peerConnectionLog[i];
            if (type !== 'getStats') continue;
            Object.keys(value).forEach(id => {
                const report = value[id];
                if (report.type === 'candidate-pair' && report.selected === true) {
                    lastReport = report;
                }
            });
        }
        if (lastReport) {
            return {
                sent: lastReport.bytesSent,
                received: lastReport.bytesReceived,
            };
        }
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
                        remoteTypePreference: remoteCandidate.priority >> 24,
                        localNetworkType: localCandidate.networkType
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
            /*
            feature[capitalize(stat) + 'Skewness'] = standardizedMoment(series, 3);
            feature[capitalize(stat) + 'Kurtosis'] = standardizedMoment(series, 4);
            */
        });
        return feature;
    },

    calledAddStream: function(client, peerConnectionLog) {
        for (var i = 0; i < peerConnectionLog.length; i++) {
            var type = peerConnectionLog[i].type;
            if (type === 'addStream') {
                return true;
            }
        }
        return false;
    },

    calledAddTrack: function(client, peerConnectionLog) {
        for (var i = 0; i < peerConnectionLog.length; i++) {
            var type = peerConnectionLog[i].type;
            if (type === 'addTrack') {
                return true;
            }
        }
        return false;
    },

    closeReason: function(client, peerConnectionLog) {
        /* We allow close("some reason") which is non-spec but useful */
        for (let i = 0; i < peerConnectionLog.length; i++) {
            const {type, value} = peerConnectionLog[i];
            if (type === 'close') {
                return value[0];
            }
        }
    },

    batteryLevel: function(client, peerConnectionLog) {
        let first;
        let last;
        let i;
        for (i = 0; i < peerConnectionLog.length && !first; i++) {
            const {type, value} = peerConnectionLog[i];
            if (type === 'getStats') {
                Object.keys(value).forEach(id => {
                    const report = value[id];
                    if (report.type === 'rtcstats-device-report') {
                        first = report;
                    }
                });
            }
        }
        for (let j = peerConnectionLog.length - 1; j > i && !last; j--) {
            const {type, value} = peerConnectionLog[j];
            if (type === 'getStats') {
                Object.keys(value).forEach(id => {
                    const report = value[id];
                    if (report.type === 'rtcstats-device-report') {
                        last = report;
                    }
                });
            }
        }
        if (first && last && first.batteryLevel && last.batteryLevel) {
            return {
                beginTime: first.timestamp,
                endTime: last.timestamp,
                begin: first.batteryLevel,
                end: last.batteryLevel,
            };
        }
    },
};
