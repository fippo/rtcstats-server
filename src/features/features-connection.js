/* eslint-disable no-continue */
/* eslint-disable no-bitwise */


// https://en.wikipedia.org/wiki/Feature_extraction for peerconnection
// API traces and getStats data.
// there are three types of features
// 1) features which only take the client as argument. E.g. extracting the browser version
// 2) features which take the client and a connection argument. Those do something with the connection.
// 3) features which are specific to a track.
// The second type of feature is contained in this file.

const SDPUtils = require('sdp');

const {
    capitalize,
    fixedDecMean,
    standardizedMoment,
    timeBetween,
    isIceConnected,
    percentOf,
    round
} = require('../utils/utils');

/**
 *
 * @param {*} peerConnectionLog
 */
function getPeerConnectionConfig(peerConnectionLog) {
    for (let i = 0; i < peerConnectionLog.length; i++) {
        if (peerConnectionLog[i].type === 'create') {
            return peerConnectionLog[i].value || { nullConfig: true };
        }
    }
}

/**
 *
 * @param {*} peerConnectionLog
 */
function getPeerConnectionConstraints(peerConnectionLog) {
    for (let i = 0; i < peerConnectionLog.length; i++) {
        if (peerConnectionLog[i].type === 'constraints') {
            return peerConnectionLog[i].value;
        }
    }

    return {};
}

/**
 *
 * @param {*} sdp
 */
function determineBrowserFromOLine(sdp) {
    if (sdp.indexOf('v=0\r\no=mozilla...THIS_IS_SDPARTA') === 0) {
        return 'moz';
    } else if (sdp.indexOf('v=0\r\no=thisisadapterortc') === 0) {
        return 'edge';
    } else if (sdp.indexOf('a=msid-semantic: WMS APPEAR\r\n') === 0) {
        return 'appear.in mobile';
    }

    return 'webrtc.org'; // maybe?

}

/**
 *
 * @param {*} protocol
 * @param {*} client
 * @param {*} peerConnectionLog
 */
function gatheringTimeTURN(protocol, client, peerConnectionLog) {
    const peerConnectionConfig = getPeerConnectionConfig(peerConnectionLog);

    if (!peerConnectionConfig) {
        return;
    }
    let typepref;

    switch (peerConnectionConfig.browserType) {
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

    let first;
    let second;

    for (first = 0; first < peerConnectionLog.length; first++) {
        // TODO: is setLocalDescriptionOnSuccess better?
        if (peerConnectionLog[first].type === 'setLocalDescription') {
            break;
        }
    }
    if (first < peerConnectionLog.length) {
        for (second = first + 1; second < peerConnectionLog.length; second++) {
            if (peerConnectionLog[second].type === 'onicecandidate') {
                const cand = peerConnectionLog[second].value;

                if (cand === null) {
                    return;
                } // give up
                if (cand && cand.candidate.indexOf('relay') !== -1) {
                    // eslint-disable-next-line no-bitwise
                    const localTypePref = cand.candidate.split(' ')[3] >> 24;

                    // eslint-disable-next-line max-depth
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

module.exports = {
    // client and conference identifiers, specified as optional peerconnection constraints
    // (which are not a thing any longer). See https://github.com/opentok/rtcstats/issues/28
    clientIdentifier(client, peerConnectionLog) {
        let constraints = getPeerConnectionConstraints(peerConnectionLog);

        if (!constraints.optional) {
            return;
        }
        constraints = constraints.optional;
        for (let i = 0; i < constraints.length; i++) {
            if (constraints[i].rtcStatsClientId) {
                return constraints[i].rtcStatsClientId;
            }
        }
        if (client.identity) {
            return client.identity.user;
        }
    },
    peerIdentifier(client, peerConnectionLog) {
        let constraints = getPeerConnectionConstraints(peerConnectionLog);

        if (!constraints.optional) {
            return;
        }
        constraints = constraints.optional;
        for (let i = 0; i < constraints.length; i++) {
            if (constraints[i].rtcStatsPeerId) {
                return constraints[i].rtcStatsPeerId;
            }
        }
    },
    conferenceIdentifier(client, peerConnectionLog) {
        let constraints = getPeerConnectionConstraints(peerConnectionLog);

        if (!constraints.optional) {
            return;
        }
        constraints = constraints.optional;
        for (let i = 0; i < constraints.length; i++) {
            if (constraints[i].rtcStatsConferenceId) {
                return constraints[i].rtcStatsConferenceId;
            }
        }
        if (client.identity) {
            return client.identity.conference;
        }
    },

    sfuP2P(client, peerConnectionLog) {
        let constraints = getPeerConnectionConstraints(peerConnectionLog) || [];

        if (!constraints.optional) {
            return;
        }
        constraints = constraints.optional;
        for (let i = 0; i < constraints.length; i++) {
            if (constraints[i].rtcStatsSFUP2P) {
                return constraints[i].rtcStatsSFUP2P;
            }
        }
    },

    // when did the session start
    startTime(client, peerConnectionLog) {
        for (let i = 0; i < peerConnectionLog.length; i++) {
            if (peerConnectionLog[i].type === 'create') {
                return peerConnectionLog[i].timestamp;
            }
        }
    },

    // when did the session end
    stopTime(client, peerConnectionLog) {
        return peerConnectionLog[peerConnectionLog.length - 1].timestamp;
    },

    // how long did the peerconnection live?
    // not necessarily connected which is different from session duration
    lifeTime(client, peerConnectionLog) {
        const lifeTime
            = peerConnectionLog[peerConnectionLog.length - 1].timestamp - peerConnectionLog[0].timestamp;

        return lifeTime > 0 ? lifeTime : undefined;
    },

    // Time in which the connection was in a potential sending state. Calculated
    // as the difference between the first setLocalDescription call and the last PC log.
    sendingDuration(client, peerConnectionLog) {
        let sendingDuration = 0;
        let prevTime = peerConnectionLog[0].timestamp;
        let prevSending = false;

        peerConnectionLog.forEach(({ type, value, timestamp }) => {
            if (type !== 'setLocalDescription') {
                return;
            }
            const sections = SDPUtils.getMediaSections(value.sdp);

            if (!sections.length) {
                return;
            }
            const direction = SDPUtils.getDirection(sections[0]);
            const logSending = [ 'sendonly', 'sendrecv' ].includes(direction);

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
    browserType(client, peerConnectionLog) {
        const peerConnectionConfig = getPeerConnectionConfig(peerConnectionLog);

        return (peerConnectionConfig && peerConnectionConfig.browserType) || 'unknown';
    },

    // the remote platform, extracted from the remote description.
    // only works for firefox and edge (using adapter)
    // returns webrtc.org when unknown.
    // TODO: look at chrome specifics?
    remoteType(client, peerConnectionLog) {
        for (let i = 0; i < peerConnectionLog.length; i++) {
            if (peerConnectionLog[i].type === 'setRemoteDescription') {
                const sdp = peerConnectionLog[i].value.sdp;

                return determineBrowserFromOLine(sdp);
            }
        }
    },

    // check if we are initiator/receiver (i.e. first called createOffer or createAnswer)
    // this likely has implications for number and types of candidates gathered.
    isInitiator(client, peerConnectionLog) {
        for (let i = 0; i < peerConnectionLog.length; i++) {
            if (peerConnectionLog[i].type === 'createOffer') {
                return true;
            }
            if (peerConnectionLog[i].type === 'setRemoteDescription') {
                return false;
            }
        }

        return undefined;
    },

    // was the peerconnection configured properly?
    // basically check if RTCPeerConnection was created with config parameters
    configured(client, peerConnectionLog) {
        const peerConnectionConfig = getPeerConnectionConfig(peerConnectionLog);

        return peerConnectionConfig && peerConnectionConfig.nullConfig !== true;
    },

    // were ice servers configured? Not sure whether this is useful and/or should check if any empty list
    // was configured
    configuredWithICEServers(client, peerConnectionLog) {
        const peerConnectionConfig = getPeerConnectionConfig(peerConnectionLog);

        return Boolean(peerConnectionConfig && peerConnectionConfig.iceServers !== undefined);
    },

    // was STUN configured in the peerconnection config?
    configuredWithSTUN(client, peerConnectionLog) {
        const peerConnectionConfig = getPeerConnectionConfig(peerConnectionLog);

        if (!(peerConnectionConfig && peerConnectionConfig.iceServers)) {
            return;
        }
        for (let i = 0; i < peerConnectionConfig.iceServers.length; i++) {
            let urls = peerConnectionConfig.iceServers[i].urls || [];

            if (typeof urls === 'string') {
                urls = [ urls ];
            }
            for (let j = 0; j < urls.length; j++) {
                if (urls[j].indexOf('stun:') === 0) {
                    return true;
                }
            }
        }
    },

    // was TURN (any kind) configured in the peerconnection config?
    configuredWithTURN(client, peerConnectionLog) {
        const peerConnectionConfig = getPeerConnectionConfig(peerConnectionLog);

        if (!(peerConnectionConfig && peerConnectionConfig.iceServers)) {
            return;
        }
        for (let i = 0; i < peerConnectionConfig.iceServers.length; i++) {
            const urls = peerConnectionConfig.iceServers[i].urls || [];

            for (let j = 0; j < urls.length; j++) {
                if (urls[j].indexOf('turn:') === 0 || urls[j].indexOf('turns:') === 0) {
                    return true;
                }
            }
        }
    },

    // was TURN/UDP configured in the peerconnection config?
    configuredWithTURNUDP(client, peerConnectionLog) {
        const peerConnectionConfig = getPeerConnectionConfig(peerConnectionLog);

        if (!(peerConnectionConfig && peerConnectionConfig.iceServers)) {
            return;
        }
        for (let i = 0; i < peerConnectionConfig.iceServers.length; i++) {
            const urls = peerConnectionConfig.iceServers[i].urls || [];

            for (let j = 0; j < urls.length; j++) {
                if (urls[j].indexOf('turn:') === 0 && urls[j].indexOf('?transport=tcp') === -1) {
                    return true;
                }
            }
        }
    },

    // was TURN/TCP configured in the peerconnection config?
    configuredWithTURNTCP(client, peerConnectionLog) {
        const peerConnectionConfig = getPeerConnectionConfig(peerConnectionLog);

        if (!(peerConnectionConfig && peerConnectionConfig.iceServers)) {
            return;
        }
        for (let i = 0; i < peerConnectionConfig.iceServers.length; i++) {
            const urls = peerConnectionConfig.iceServers[i].urls || [];

            for (let j = 0; j < urls.length; j++) {
                if (urls[j].indexOf('turn:') === 0 && urls[j].indexOf('?transport=tcp') !== -1) {
                    return true;
                }
            }
        }
    },

    // was TURN/TLS configured in the peerconnection config?
    // TODO: do we also want the port for this? does it make a difference whether turns is
    //     run on 443?
    configuredWithTURNTLS(client, peerConnectionLog) {
        const peerConnectionConfig = getPeerConnectionConfig(peerConnectionLog);

        if (!(peerConnectionConfig && peerConnectionConfig.iceServers)) {
            return;
        }
        for (let i = 0; i < peerConnectionConfig.iceServers.length; i++) {
            const urls = peerConnectionConfig.iceServers[i].urls || [];

            for (let j = 0; j < urls.length; j++) {
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
    configuredBundlePolicy(client, peerConnectionLog) {
        const peerConnectionConfig = getPeerConnectionConfig(peerConnectionLog);

        return peerConnectionConfig ? peerConnectionConfig.bundlePolicy !== undefined : false; // default: 'balanced'
    },

    // what rtcp-mux configuration was supplied?
    // TODO: return default or do we want to measure explicit configuration?
    configuredRtcpMuxPolicy(client, peerConnectionLog) {
        const peerConnectionConfig = getPeerConnectionConfig(peerConnectionLog);

        return peerConnectionConfig ? peerConnectionConfig.rtcpMuxPolicy !== undefined : false; // default: 'require'
    },

    // what iceTransportPolicy configuration was supplied?
    // TODO: return default or do we want to measure explicit configuration?
    configuredIceTransportPolicy(client, peerConnectionLog) {
        const peerConnectionConfig = getPeerConnectionConfig(peerConnectionLog);

        return peerConnectionConfig ? peerConnectionConfig.iceTransportPolicy !== undefined : false; // default: 'all'
    },

    // was the peerconnection created with a RTCCertificate
    configuredCertificate(client, peerConnectionLog) {
        const peerConnectionConfig = getPeerConnectionConfig(peerConnectionLog);

        return peerConnectionConfig ? peerConnectionConfig.certificates !== undefined : false;
    },

    // was the peerconnection created with non-spec SDES?
    configuredSDES(client, peerConnectionLog) {
        const constraints = getPeerConnectionConstraints(peerConnectionLog);

        return constraints && constraints.mandatory && constraints.mandatory.DtlsSrtpKeyAgreement === false;
    },

    // SDP semantics used
    sdpSemantics(client, peerConnectionLog) {
        const peerConnectionConfig = getPeerConnectionConfig(peerConnectionLog);

        return peerConnectionConfig ? peerConnectionConfig.sdpSemantics : '';
    },

    // did ice gathering complete (aka: onicecandidate called with a null candidate)
    ICEGatheringComplete(client, peerConnectionLog) {
        return (
            peerConnectionLog.filter(entry => entry.type === 'onicecandidate' && entry.value === null)
                .length > 0
        );
    },

    // was an ice failure detected.
    ICEFailure(client, peerConnectionLog) {
        for (let i = 0; i < peerConnectionLog.length; i++) {
            if (
                peerConnectionLog[i].type === 'oniceconnectionstatechange'
                && peerConnectionLog[i].value === 'failed'
            ) {
                return true;
            }
        }

        return false;
    },

    // was an ice failure after a successful connection detected.
    ICEFailureSubsequent(client, peerConnectionLog) {
        let i = 0;
        let connected = false;

        for (; i < peerConnectionLog.length; i++) {
            if (isIceConnected(peerConnectionLog[i])) {
                connected = true;
                break;
            }
        }
        if (connected) {
            for (; i < peerConnectionLog.length; i++) {
                if (
                    peerConnectionLog[i].type === 'oniceconnectionstatechange'
                    && peerConnectionLog[i].value === 'failed'
                ) {
                    return true;
                }
            }
        }

        return false;
    },

    // did ice connect/complete?
    ICEConnectedOrCompleted(client, peerConnectionLog) {
        return peerConnectionLog.filter(entry => isIceConnected(entry)).length > 0;
    },

    // ICE connected but connectionState indicates a DTLS failure, basically ICE process successfully completed
    // but it did not connect
    dtlsFailure(client, peerConnectionLog) {
        let iceConnected = false;
        let connected = false;

        for (let i = 0; i < peerConnectionLog.length; i++) {
            if (isIceConnected(peerConnectionLog[i])) {
                iceConnected = true;
            }
            if (
                peerConnectionLog[i].type === 'onconnectionstatechange'
                && peerConnectionLog[i].value === 'connected'
            ) {
                connected = true;
            }
        }
        if (iceConnected && !connected) {
            return true;
        } else if (iceConnected && connected) {
            return false;
        }
    },

    // The bug seems to have been fixed, remove for now.
    // iceconnectionstateCheckingBeforeSRD: function(client, peerConnectionLog) {
    //     // https://bugs.chromium.org/p/chromium/issues/detail?id=959128#c65
    //     // Sometimes, iceconnectionstatechange can fire before
    //     // SRD/addIceCandidate. This happens when we are offering and
    //     // the remote does a valid stun ping to the port before the answer
    //     // arrives.
    //     let hadSRD = false;
    //     for (let i = 0; i < peerConnectionLog.length; i++) {
    //         const {type, value} = peerConnectionLog[i];
    //         if (type === 'setRemoteDescription') {
    //             hadSRD = true;
    //         } else if (type === 'oniceconnectionstatechange' && value === 'checking') {
    //             return !hadSRD;
    //         }
    //     }
    // },

    // Firefox has a timeout of ~5 seconds where addIceCandidate needs to happen after SRD.
    // This calculates the delay between SRD and addIceCandidate which should allow
    // correlation with ICE failures caused by this.
    // returns -1 if addIceCandidate is called before setRemoteDescription
    timeBetweenSetRemoteDescriptionAndAddIceCandidate(client, peerConnectionLog) {
        return timeBetween(peerConnectionLog, [ 'setRemoteDescription' ], [ 'addIceCandidate' ]);
    },

    // This calculates the delay between SLD and onicecandidate.
    timeBetweenSetLocalDescriptionAndOnIceCandidate(client, peerConnectionLog) {
        return timeBetween(peerConnectionLog, [ 'setLocalDescription' ], [ 'onicecandidate' ]);
    },

    // This calculates the time between the first SRD and resolving.
    timeForFirstSetRemoteDescription(client, peerConnectionLog) {
        return timeBetween(peerConnectionLog, [ 'setRemoteDescription' ], [ 'setRemoteDescriptionOnSuccess' ]);
    },

    // determines whether the first setRemoteDescription resulted in an ontrack event.
    ontrackAfterFirstSetRemoteDescription(client, peerConnectionLog) {
        let i;

        for (i = 0; i < peerConnectionLog.length; i++) {
            // search for setRemoteDescription.
            if (peerConnectionLog[i].type === 'setRemoteDescription') {
                break;
            }
        }
        for (; i < peerConnectionLog.length; i++) {
            if (peerConnectionLog[i].type === 'ontrack') {
                return true;
            }
            if (peerConnectionLog[i].type === 'setRemoteDescriptionOnSuccess') {
                return false;
            }
        }
    },

    // This calculates the time between the second SRD and resolving.
    timeForSecondSetRemoteDescription(client, peerConnectionLog) {
        let i;

        for (i = 0; i < peerConnectionLog.length; i++) {
            if (peerConnectionLog[i].type === 'setRemoteDescriptionOnSuccess') {
                return timeBetween(
                    peerConnectionLog.slice(i + 1),
                    [ 'setRemoteDescription' ],
                    [ 'setRemoteDescriptionOnSuccess' ]
                );
            }
        }
    },

    // is the session using ICE lite?
    usingICELite(client, peerConnectionLog) {
        let usingIceLite = false;

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
    usingRTCPMux(client, peerConnectionLog) {
        let usingRTCPMux = false;


        // search for SLD/SRD with type = answer and look for a=rtcp-mux
        peerConnectionLog.forEach(entry => {
            if (
                !usingRTCPMux
                && (entry.type === 'setRemoteDescription' || entry.type === 'setLocalDescription')
            ) {
                if (
                    entry.value.type === 'answer'
                    && entry.value.sdp
                    && entry.value.sdp.indexOf('\r\na=rtcp-mux\r\n') !== -1
                ) {
                    usingRTCPMux = true;
                }
            }
        });

        return usingRTCPMux;
    },

    // is the session using BUNDLE?
    usingBundle(client, peerConnectionLog) {
        let usingBundle = false;


        // search for SLD/SRD with type = answer and look for a=GROUP
        peerConnectionLog.forEach(entry => {
            if (
                !usingBundle
                && (entry.type === 'setRemoteDescription' || entry.type === 'setLocalDescription')
            ) {
                if (
                    entry.value.type === 'answer'
                    && entry.value.sdp
                    && entry.value.sdp.indexOf('\r\na=group:BUNDLE ') !== -1
                ) {
                    usingBundle = true;
                }
            }
        });

        return usingBundle;
    },

    // was iceRestart parameter provided during a createOffer call
    ICERestart(client, peerConnectionLog) {
        let iceRestart = false;

        peerConnectionLog.forEach(entry => {
            if (!iceRestart && entry.type === 'createOffer') {
                if (entry.value && entry.value.iceRestart) {
                    iceRestart = true;
                }
            }
        });

        return iceRestart;
    },

    // was the initiated iceRestart successful
    ICERestartSuccess(client, peerConnectionLog) {
        let i = 0;
        let iceRestart = false;

        for (; i < peerConnectionLog.length; i++) {
            if (
                peerConnectionLog[i].type === 'createOffer'
                && peerConnectionLog[i].value
                && peerConnectionLog[i].value.iceRestart
            ) {
                iceRestart = true;
                break;
            }
        }
        if (iceRestart) {
            for (; i < peerConnectionLog.length; i++) {
                if (isIceConnected(peerConnectionLog[i])) {
                    return true;
                }
            }
        }

        return false;
    },

    // was setRemoteDescription called after the ice restart? If not the peer
    // went away.
    ICERestartFollowedBySetRemoteDescription(client, peerConnectionLog) {
        let i = 0;
        let iceRestart = false;

        for (; i < peerConnectionLog.length; i++) {
            if (
                peerConnectionLog[i].type === 'createOffer'
                && peerConnectionLog[i].value
                && peerConnectionLog[i].value.iceRestart
            ) {
                iceRestart = true;
                break;
            }
        }
        if (iceRestart) {
            for (; i < peerConnectionLog.length; i++) {
                if (peerConnectionLog[i].type === 'setRemoteDescription') {
                    return true;
                }
            }

            return false;
        }
    },

    // was there a relay candidate gathered after the ice restart?
    ICERestartFollowedByRelayCandidate(client, peerConnectionLog) {
        let i = 0;
        let iceRestart = false;

        for (; i < peerConnectionLog.length; i++) {
            if (
                peerConnectionLog[i].type === 'createOffer'
                && peerConnectionLog[i].value
                && peerConnectionLog[i].value.iceRestart
            ) {
                iceRestart = true;
                break;
            }
        }
        if (iceRestart) {
            for (; i < peerConnectionLog.length; i++) {
                if (peerConnectionLog[i].type === 'onicecandidate') {
                    const cand = peerConnectionLog[i].value;

                    if (cand === null) {
                        return false;
                    } // give up
                    if (cand && cand.candidate.indexOf('relay') !== -1) {
                        return true;
                    }
                }
            }

            return false;
        }
    },

    // was the signaling state stable at least once?
    signalingStableAtLeastOnce(client, peerConnectionLog) {
        return (
            peerConnectionLog.filter(
                entry => entry.type === 'onsignalingstatechange' && entry.value === 'stable'
            ).length > 0
        );
    },

    // was more than one remote stream added?
    usingMultistream(client, peerConnectionLog) {
        return peerConnectionLog.filter(entry => entry.type === 'onaddstream').length > 1;
    },

    // maximum number of concurrent streams
    maxStreams(client, peerConnectionLog) {
        let max = 0;

        peerConnectionLog.forEach(entry => {
            if (entry.type === 'onaddstream') {
                max++;
            } else if (entry.type === 'onremovestream' && max > 0) {
                max--;
            }
        });

        return max;
    },

    // number of remote distinct streams
    numberOfRemoteStreams(client, peerConnectionLog) {
        const remoteStreams = {};

        for (let i = 0; i < peerConnectionLog.length; i++) {
            if (peerConnectionLog[i].type === 'ontrack') {
                const { value } = peerConnectionLog[i];
                const streamId = value.split(' ')[1];

                remoteStreams[streamId] = true;
            }
        }

        return Object.keys(remoteStreams).length;
    },

    // check to see id the local SDP has simulcast related fields.
    usingSimulcast(client, peerConnectionLog) {
        for (let i = 0; i < peerConnectionLog.length; i++) {
            const { type, value } = peerConnectionLog[i];

            if (type === 'setLocalDescription') {
                const simulcast
                    = value
                    && value.sdp
                    && (value.sdp.indexOf('a=ssrc-group:SIM ') !== -1
                        || value.sdp.indexOf('a=simulcast:') !== -1);

                if (simulcast) {
                    return true;
                }
            }
        }

        return false;
    },

    // verify how many streams are part of the simulcast groups
    numberOfLocalSimulcastStreams(client, peerConnectionLog) {
        for (let i = 0; i < peerConnectionLog.length; i++) {
            const { type, value } = peerConnectionLog[i];

            if (type === 'setLocalDescription') {
                const simulcast = value
                                && value.sdp
                                && (value.sdp.indexOf('a=ssrc-group:SIM ') !== -1); // Chrome-only definition.

                if (simulcast) {
                    const line = SDPUtils.splitLines(value.sdp).filter(
                        sdpLine => sdpLine.indexOf('a=ssrc-group:SIM ') === 0
                    );

                    return line[0].substr(17).split(' ').length;
                }
            }
        }
    },

    // was there a setLocalDescription failure?
    setLocalDescriptionFailure(client, peerConnectionLog) {
        for (let i = 0; i < peerConnectionLog.length; i++) {
            if (peerConnectionLog[i].type === 'setLocalDescriptionOnFailure') {
                return peerConnectionLog[i].value;
            }
        }
    },

    // was there a setRemoteDescription failure?
    setRemoteDescriptionFailure(client, peerConnectionLog) {
        for (let i = 0; i < peerConnectionLog.length; i++) {
            if (peerConnectionLog[i].type === 'setRemoteDescriptionOnFailure') {
                return peerConnectionLog[i].value;
            }
        }
    },

    // was there an addIceCandidate failure
    addIceCandidateFailure(client, peerConnectionLog) {
        for (let i = 0; i < peerConnectionLog.length; i++) {
            if (peerConnectionLog[i].type === 'addIceCandidateOnFailure') {
                return peerConnectionLog[i].value;
            }
        }
    },

    // how long did it take to gather all ice candidates?
    gatheringTime(client, peerConnectionLog) {
        let first;
        let second;

        for (first = 0; first < peerConnectionLog.length; first++) {
            // TODO: is setLocalDescriptionOnSuccess better?
            if (peerConnectionLog[first].type === 'setLocalDescription') {
                break;
            }
        }
        if (first < peerConnectionLog.length) {
            for (second = first + 1; second < peerConnectionLog.length; second++) {
                if (
                    peerConnectionLog[second].type === 'onicecandidate'
                    && peerConnectionLog[second].value === null
                ) {
                    break;
                }
            }
            if (second < peerConnectionLog.length) {
                return peerConnectionLog[second].timestamp - peerConnectionLog[first].timestamp;
            }
        }
    },

    // was a local host candidate gathered. This should always be true.
    // And yet I saw a pig flying with Firefox 46 on Windows which did
    // not like a teredo interface and did not gather candidates.
    gatheredHost(client, peerConnectionLog) {
        for (let i = 0; i < peerConnectionLog.length; i++) {
            if (peerConnectionLog[i].type === 'onicecandidate') {
                const cand = peerConnectionLog[i].value;

                if (cand === null) {
                    return false;
                } // gathering finished so we have seen all candidates.
                if (cand.candidate.indexOf('host') !== -1) {
                    return true;
                }
            }
        }
    },

    // was a local STUN candidate gathered?
    // TODO: do we care about timing?
    gatheredSTUN(client, peerConnectionLog) {
        for (let i = 0; i < peerConnectionLog.length; i++) {
            if (peerConnectionLog[i].type === 'onicecandidate') {
                const cand = peerConnectionLog[i].value;

                if (cand === null) {
                    return false;
                } // gathering finished so we have seen all candidates.
                if (cand.candidate.indexOf('srflx') !== -1) {
                    return true;
                }
            }
        }

        return false;
    },

    // was a local TURN/UDP relay candidate gathered?
    gatheredTURNUDP(client, peerConnectionLog) {
        return gatheringTimeTURN('udp', client, peerConnectionLog) !== undefined;
    },

    // how long did it take to gather a TURN/UDP relay candidate
    gatheringTimeTURNUDP(client, peerConnectionLog) {
        return gatheringTimeTURN('udp', client, peerConnectionLog);
    },

    // was a local TURN/TCP relay candidate gathered?
    gatheredTURNTCP(client, peerConnectionLog) {
        return gatheringTimeTURN('tcp', client, peerConnectionLog) !== undefined;
    },

    // how long did it take to gather a TURN/TCP relay candidate
    gatheringTimeTURNTCP(client, peerConnectionLog) {
        return gatheringTimeTURN('tcp', client, peerConnectionLog);
    },

    // was a local TURN/TLS relay candidate gathered?
    gatheredTURNTLS(client, peerConnectionLog) {
        return gatheringTimeTURN('tls', client, peerConnectionLog) !== undefined;
    },

    // how long did it take to gather a TURN/TLS relay candidate
    gatheringTimeTURNTLS(client, peerConnectionLog) {
        return gatheringTimeTURN('tls', client, peerConnectionLog);
    },

    // which turn server was used? returns the relay address.
    relayAddress(client, peerConnectionLog) {
        for (let i = 0; i < peerConnectionLog.length; i++) {
            if (peerConnectionLog[i].type === 'onicecandidate') {
                const cand = peerConnectionLog[i].value;

                if (cand === null) {
                    return;
                } // give up
                if (cand && cand.candidate.indexOf('relay') !== -1) {
                    return cand.candidate.split(' ')[4];
                }
            }
        }
    },

    // was there a remote candidate TURN added?
    // that is about as much as we can tell unless we snoop onto the
    // peerconnection and determine remote browser.
    hadRemoteTURNCandidate(client, peerConnectionLog) {
        // TODO: might be hiding in setRemoteDescription, too.
        for (let i = 0; i < peerConnectionLog.length; i++) {
            if (peerConnectionLog[i].type === 'addIceCandidate') {
                const cand = peerConnectionLog[i].value;

                if (cand && cand.candidate && cand.candidate.indexOf('relay') !== -1) {
                    return true;
                }
            }
        }

        return false;
    },

    // what types of RFC 1918 private ip addresses were gathered?
    gatheredrfc1918address(client, peerConnectionLog) {
        const gathered = {};

        for (let i = 0; i < peerConnectionLog.length; i++) {
            if (peerConnectionLog[i].type === 'onicecandidate') {
                const cand = peerConnectionLog[i].value;

                if (cand === null) {
                    break;
                } // gathering done
                if (cand.candidate) {
                    const ip = cand.candidate.split(' ')[4];

                    if (ip.indexOf('192.168.') === 0) {
                        gathered.prefix16 = true;
                    } else if (ip.indexOf('172.') === 0) {
                        // eslint-disable-next-line no-bitwise
                        const secondByte = ip.split('.')[1] >>> 0;

                        // eslint-disable-next-line max-depth
                        if (secondByte >= 16 && secondByte <= 31) {
                            gathered.prefix12 = true;
                        }
                    } else if (ip.indexOf('10.') === 0) {
                        gathered.prefix10 = true;
                    }
                }
            }
        }
        if (Object.keys(gathered).length) {
            return gathered;
        }
    },

    // estimates the number of network interfaces, by analyzing gathered host ice candidates.
    numberOfInterfaces(client, peerConnectionLog) {
        const ips = {};

        for (let i = 0; i < peerConnectionLog.length; i++) {
            if (peerConnectionLog[i].type === 'onicecandidate') {
                const cand = peerConnectionLog[i].value;

                if (cand === null) {
                    break;
                } // gathering finished so we have seen all candidates.
                const parts = cand.candidate.split(' ');

                if (parts[7] === 'host') {
                    if (!ips[parts[4]]) {
                        ips[parts[4]] = 0;
                    }
                    ips[parts[4]]++;
                }
            }
        }

        return Object.keys(ips).length;
    },

    // determines how long it took to establish the connection, by checking connection state
    // changes.
    connectionTime(client, peerConnectionLog) {
        let first;
        let second;

        for (first = 0; first < peerConnectionLog.length; first++) {
            if (
                peerConnectionLog[first].type === 'onconnectionstatechange'
                && peerConnectionLog[first].value === 'connecting'
            ) {
                break;
            }
        }
        if (first < peerConnectionLog.length) {
            for (second = first + 1; second < peerConnectionLog.length; second++) {
                if (
                    peerConnectionLog[second].type === 'onconnectionstatechange'
                    && peerConnectionLog[second].value === 'connected'
                ) {
                    break;
                }
            }
            if (second < peerConnectionLog.length) {
                return peerConnectionLog[second].timestamp - peerConnectionLog[first].timestamp;
            }
        }
    },

    // how long does it take to establish the ice connection?
    iceConnectionTime(client, peerConnectionLog) {
        let first;
        let second;

        for (first = 0; first < peerConnectionLog.length; first++) {
            if (
                peerConnectionLog[first].type === 'oniceconnectionstatechange'
                && peerConnectionLog[first].value === 'checking'
            ) {
                break;
            }
        }
        if (first < peerConnectionLog.length) {
            for (second = first + 1; second < peerConnectionLog.length; second++) {
                if (isIceConnected(peerConnectionLog[second])) {
                    break;
                }
            }
            if (second < peerConnectionLog.length) {
                return peerConnectionLog[second].timestamp - peerConnectionLog[first].timestamp;
            }
        }
    },

    // how long does it take to create a local offer/answer (mostly DTLS key generation)
    localCreateDelay(client, peerConnectionLog) {
        let first;
        let second;

        for (first = 0; first < peerConnectionLog.length; first++) {
            if (
                peerConnectionLog[first].type === 'createOffer'
                || peerConnectionLog[first].type === 'createAnswer'
            ) {
                break;
            }
        }
        if (first < peerConnectionLog.length) {
            for (second = first + 1; second < peerConnectionLog.length; second++) {
                if (peerConnectionLog[second].type === `${peerConnectionLog[first].type}OnSuccess`) {
                    break;
                }
            }
            if (second < peerConnectionLog.length) {
                return peerConnectionLog[second].timestamp - peerConnectionLog[first].timestamp;
            }
        }

        return -1;
    },

    // number of local ice candidates.
    numberOfLocalIceCandidates(client, peerConnectionLog) {
        return peerConnectionLog.filter(entry => entry.type === 'onicecandidate' && entry.value).length;
    },

    // number of remote ice candidates.
    numberOfRemoteIceCandidates(client, peerConnectionLog) {
        let candsInSdp = -1;


        // needs sentinel to avoid adding candidates from subsequent generations.
        peerConnectionLog.forEach(entry => {
            if (candsInSdp === -1 && entry.type === 'setRemoteDescription') {
                if (entry.value.sdp) {
                    candsInSdp = entry.value.sdp
                        .split('\n')
                        .filter(line => line.indexOf('a=candidate:') === 0).length;
                }
            }
        });
        if (candsInSdp === -1) {
            candsInSdp = 0;
        }

        return candsInSdp + peerConnectionLog.filter(entry => entry.type === 'addIceCandidate').length;
    },

    // session duration, defined by ICE states.
    sessionDuration(client, peerConnectionLog) {
        let startTime = -1;
        let endTime = -1;
        let i;

        for (i = 0; i < peerConnectionLog.length; i++) {
            if (isIceConnected(peerConnectionLog[i]) && startTime === -1) {
                startTime = peerConnectionLog[i].timestamp;
                break;
            }
        }
        if (startTime > 0) {
            // TODO: this is too simplistic. What if the ice connection state went to failed?
            for (let j = peerConnectionLog.length - 1; j > i; j--) {
                endTime = peerConnectionLog[j].timestamp;
                if (startTime < endTime && endTime > 0) {
                    return endTime - startTime;
                }
            }
        }
    },

    // determine media types used in session.
    mediaTypes(client, peerConnectionLog) {
        // looking for SRD/SLD is easier than tracking createDataChannel + addStreams
        // TODO: also look for value.type=answer and handle rejected m-lines?
        let i;

        for (i = 0; i < peerConnectionLog.length; i++) {
            if (
                peerConnectionLog[i].type === 'setLocalDescription'
                || peerConnectionLog[i].type === 'setRemoteDescription'
            ) {
                break;
            }
        }
        if (i < peerConnectionLog.length) {
            const desc = peerConnectionLog[i].value;

            if (desc && desc.sdp) {
                const mediaTypes = {};
                const lines = desc.sdp.split('\n').filter(line => line.indexOf('m=') === 0);

                lines.forEach(line => {
                    mediaTypes[line.split(' ', 1)[0].substr(2)] = true;
                });

                return Object.keys(mediaTypes)
                        .sort()
                        .join(';');
            }
        }

        return 'unknown';
    },

    // dlts cipher suite used
    // TODO: what is the standard thing for that?
    dtlsCipherSuite(client, peerConnectionLog) {
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
    },

    // srtp cipher suite used
    srtpCipherSuite(client, peerConnectionLog) {
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
    },

    // mean RTT, send and recv bitrate of the active candidate pair
    statsMean(client, peerConnectionLog) {
        const feature = {};
        const rtts = [];
        const recv = [];
        const send = [];

        const packetsLostMap = {};

        let lastStatsReport;
        let lastTime;

        // Iterate over the getStats entries for this specific PC and calculate the average roundTripTime
        // data from the candidate-pair statistic.
        peerConnectionLog.forEach(entry => {
            if (entry.type !== 'getStats') {
                return;
            }
            const statsReport = entry.value;


            // look for type track, remoteSource: false, audioLevel (0..1)
            Object.keys(statsReport).forEach(id => {
                const report = statsReport[id];

                if (report.type === 'candidate-pair' && report.selected === true) {
                    rtts.push(report.roundTripTime);
                }

                // packetsLost is a cumulative stats thus we just overwrite the value so we don't have to find
                // the last type of stats of a certain type.
                if (report.type === 'ssrc' && id.endsWith('_send') === true) {
                    if (report.mediaType === 'audio' || report.mediaType === 'video') {
                        if (!packetsLostMap[report.ssrc]) {
                            packetsLostMap[report.ssrc] = {};
                            packetsLostMap[report.ssrc].mediaType = report.mediaType;
                            packetsLostMap[report.ssrc].samples = 0;
                        }

                        packetsLostMap[report.ssrc].packetsLost = report.packetsLost || 0;
                        packetsLostMap[report.ssrc].packetsSent = report.packetsSent || 0;
                        ++packetsLostMap[report.ssrc].samples;
                    }
                }
            });
            if (lastStatsReport) {
                Object.keys(statsReport).forEach(id => {
                    const report = statsReport[id];
                    let bitrate;

                    if (report.type === 'candidate-pair' && report.selected === true && lastStatsReport[id]) {
                        bitrate
                            = (8 * (report.bytesReceived - lastStatsReport[id].bytesReceived))
                            / (entry.time - lastTime);

                        // needs to work around resetting counters -
                        // - https://bugs.chromium.org/p/webrtc/issues/detail?id=5361
                        if (bitrate > 0) {
                            recv.push(bitrate);
                        }
                    }
                    if (report.type === 'candidate-pair' && report.selected === true && lastStatsReport[id]) {
                        bitrate
                            = (8 * (report.bytesSent - lastStatsReport[id].bytesSent))
                            / (entry.time - lastTime);

                        // needs to work around resetting counters
                        // -- https://bugs.chromium.org/p/webrtc/issues/detail?id=5361
                        if (bitrate > 0) {
                            send.push(bitrate);
                        }
                    }
                });
            }
            lastStatsReport = statsReport;
            lastTime = entry.time;
        });

        // The reduced value will have the following format:
        // { audio: {packetsLostMean: 0.133213, packetsLostPct: 5}, video: {packetsLostMean:2.3, packetsLostPct: 3}}
        const sentMediaSummary = Object.values(packetsLostMap).reduce((result, currentSsrc) => {
            // the ssrcs were build in the same function so we assume at least a value of 1
            // if this is to be refactored and control moved out of this function consider
            // additional checks.
            if (result[currentSsrc.mediaType]) {
                const trackResult = result[currentSsrc.mediaType];

                trackResult.packetsLost += currentSsrc.packetsLost;
                trackResult.packetsSent += currentSsrc.packetsSent;

                // Calculate average packets with other media tracks of the same kind.
                const ssrcPacketsLostMean = currentSsrc.packetsLost / currentSsrc.samples;

                trackResult.packetsLostMean = fixedDecMean(
                    [ trackResult.packetsLostMean, ssrcPacketsLostMean ],
                    2
                );

                // Calculate packets lost as a percentage, if there are more tracks of the same kind average them
                const ssrcPacketsLostPct = percentOf(currentSsrc.packetsLost, currentSsrc.packetsSent);

                if (trackResult.packetsLostPct === undefined) {
                    trackResult.packetsLostPct = ssrcPacketsLostPct;
                } else {
                    trackResult.packetsLostPct = fixedDecMean(
                        [ ssrcPacketsLostPct, trackResult.packetsLostPct ],
                        2
                    );
                }
            } else {
                // If this is the first value there is no previous with which to divide, also reduce the
                // float number to 2 decimals
                result[currentSsrc.mediaType] = {};
                result[currentSsrc.mediaType].packetsLost = currentSsrc.packetsLost;
                result[currentSsrc.mediaType].packetsSent = currentSsrc.packetsSent;
                result[currentSsrc.mediaType].packetsLostMean = round(
                    currentSsrc.packetsLost / currentSsrc.samples,
                    2
                );
                result[currentSsrc.mediaType].packetsLostPct = percentOf(
                    currentSsrc.packetsLost,
                    currentSsrc.packetsSent
                );
            }

            return result;
        }, {});

        feature.roundTripTime = Math.floor(rtts.reduce((a, b) => a + b, 0) / (rtts.length || 1));
        feature.receivingBitrate = Math.floor(recv.reduce((a, b) => a + b, 0) / (recv.length || 1));
        feature.sendingBitrate = Math.floor(send.reduce((a, b) => a + b, 0) / (send.length || 1));

        if (sentMediaSummary.video) {
            feature.videoPacketsLostTotal = sentMediaSummary.video.packetsLost;
            feature.videoPacketsSentTotal = sentMediaSummary.video.packetsSent;
            feature.videoPacketsLostPct = sentMediaSummary.video.packetsLostPct;
            feature.videoPacketsLost = sentMediaSummary.video.packetsLostMean;
        }

        if (sentMediaSummary.audio) {
            feature.audioPacketsLostTotal = sentMediaSummary.audio.packetsLost;
            feature.audioPacketsSentTotal = sentMediaSummary.audio.packetsSent;
            feature.audioPacketsLostPct = sentMediaSummary.audio.packetsLostPct;
            feature.audioPacketsLost = sentMediaSummary.audio.packetsLostMean;
        }

        return feature;
    },

    // calculate mean RTT and max RTT for the first 30 seconds of the connection
    stunRTTInitial30s(client, peerConnectionLog) {
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
    },

    bytesTotal(client, peerConnectionLog) {
        // TODO: does this reset during a restart? See
        // https://bugs.chromium.org/p/webrtc/issues/detail?id=5361
        let lastReport;

        for (let i = 0; i < peerConnectionLog.length; i++) {
            const { type, value } = peerConnectionLog[i];

            if (type !== 'getStats') {
                continue;
            }
            // eslint-disable-next-line no-loop-func
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
                received: lastReport.bytesReceived
            };
        }
    },

    // information regarding the active candidate pair
    firstCandidatePair(client, peerConnectionLog) {
        // search for first getStats after iceconnection->connected
        let i;

        for (i = 0; i < peerConnectionLog.length; i++) {
            if (isIceConnected(peerConnectionLog[i])) {
                break;
            }
        }
        for (; i < peerConnectionLog.length; i++) {
            if (peerConnectionLog[i].type !== 'getStats') {
                continue;
            }
            const statsReport = peerConnectionLog[i].value;
            let pair = null;

            Object.keys(statsReport).forEach(id => {
                const report = statsReport[id];


                // spec. Also Chrome with mangled stats.
                if (report.type === 'transport' && report.selectedCandidatePairId) {
                    const candidatePair = statsReport[report.selectedCandidatePairId];
                    const localCandidate = statsReport[candidatePair.localCandidateId];
                    const remoteCandidate = statsReport[candidatePair.remoteCandidateId];

                    pair = {
                        // mostly for backward compat reasons
                        type: `${localCandidate.candidateType};${remoteCandidate.candidateType}`,
                        localType: localCandidate.candidateType,
                        remoteType: remoteCandidate.candidateType,
                        localIPAddress:
                            localCandidate.address || localCandidate.ip || localCandidate.ipAddress,
                        remoteIPAddress:
                            remoteCandidate.address || remoteCandidate.ip || remoteCandidate.ipAddress,
                        localTypePreference: localCandidate.priority >> 24,
                        remoteTypePreference: remoteCandidate.priority >> 24,
                        localNetworkType: localCandidate.networkType
                    };
                }

                // Firefox.
                if (report.type === 'candidate-pair' && report.selected === true) {
                    const localCandidate = statsReport[report.localCandidateId];
                    const remoteCandidate = statsReport[report.remoteCandidateId];

                    pair = {
                        // mostly for backward compat reasons
                        type: `${localCandidate.candidateType};${remoteCandidate.candidateType}`,
                        localType: localCandidate.candidateType,
                        remoteType: remoteCandidate.candidateType,
                        localIPAddress:
                            localCandidate.address || localCandidate.ip || localCandidate.ipAddress,
                        remoteIPAddress:
                            remoteCandidate.address || remoteCandidate.ip || remoteCandidate.ipAddress,
                        localTypePreference: localCandidate.priority >> 24,
                        remoteTypePreference: remoteCandidate.priority >> 24,
                        localNetworkType: localCandidate.networkType
                    };
                }
            });
            if (pair) {
                return pair;
            }
        }
    },

    // extracts the cellular network type, a non-standard stat.
    networkType(client, peerConnectionLog) {
        let i;

        for (i = 0; i < peerConnectionLog.length; i++) {
            if (isIceConnected(peerConnectionLog[i])) {
                break;
            }
        }
        for (; i < peerConnectionLog.length; i++) {
            if (peerConnectionLog[i].type !== 'getStats') {
                continue;
            }
            const statsReport = peerConnectionLog[i].value;
            let deviceReport;

            Object.keys(statsReport).forEach(id => {
                const report = statsReport[id];

                if (report.type === 'rtcstats-device-report') {
                    deviceReport = report;
                }
            });
            if (deviceReport && deviceReport.networkType) {
                return deviceReport.networkType;
            }
        }
    },

    // How many times did the active ice candidate-pair change over time.
    // how did the selected candidate pair change? Could happen e.g. because of an ice restart
    // so there should be a strong correlation.
    numberOfCandidatePairChanges(client, peerConnectionLog) {
        const selectedCandidatePairList = [ null ];

        for (let i = 0; i < peerConnectionLog.length; i++) {
            if (peerConnectionLog[i].type !== 'getStats') {
                continue;
            }
            const statsReport = peerConnectionLog[i].value;

            Object.keys(statsReport).forEach(id => {
                const report = statsReport[id];

                if (report.type === 'candidate-pair' && report.selected === true) {
                    const pair = `${report.localCandidateId} ${report.remoteCandidateId}`;

                    if (pair !== selectedCandidatePairList[selectedCandidatePairList.length - 1]) {
                        selectedCandidatePairList.push(pair);
                    }
                }
            });
        }

        return selectedCandidatePairList.length - 1;
    },

    // how did the selected interface type change? e.g. a wifi->mobile transition
    // eslint-disable-next-line max-len
    // see https://code.google.com/p/chromium/codesearch#chromium/src/third_party/libjingle/source/talk/app/webrtc/statscollector.cc&q=statscollector&sq=package:chromium&l=53
    // TODO: check if this really allows detecting such transitions
    candidatePairChangeInterfaceTypes(client, peerConnectionLog) {
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
    },

    bwe(client, peerConnectionLog) {
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
    },

    // Was addStream called on the PC
    calledAddStream(client, peerConnectionLog) {
        for (let i = 0; i < peerConnectionLog.length; i++) {
            const type = peerConnectionLog[i].type;

            if (type === 'addStream') {
                return true;
            }
        }

        return false;
    },

    // Was addTrack called on the PC
    calledAddTrack(client, peerConnectionLog) {
        for (let i = 0; i < peerConnectionLog.length; i++) {
            const type = peerConnectionLog[i].type;

            if (type === 'addTrack') {
                return true;
            }
        }

        return false;
    },

    closeReason(client, peerConnectionLog) {
        /* We allow close("some reason") which is non-spec but useful */
        for (let i = 0; i < peerConnectionLog.length; i++) {
            const { type, value } = peerConnectionLog[i];

            if (type === 'close' && value) {
                return value[0];
            }
        }
    },

    batteryLevel(client, peerConnectionLog) {
        let first;
        let last;
        let i;

        for (i = 0; i < peerConnectionLog.length && !first; i++) {
            const { type, value } = peerConnectionLog[i];

            if (type === 'getStats') {
                // eslint-disable-next-line no-loop-func
                Object.keys(value).forEach(id => {
                    const report = value[id];

                    if (report.type === 'rtcstats-device-report') {
                        first = report;
                    }
                });
            }
        }
        for (let j = peerConnectionLog.length - 1; j > i && !last; j--) {
            const { type, value } = peerConnectionLog[j];

            if (type === 'getStats') {
                // eslint-disable-next-line no-loop-func
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
                end: last.batteryLevel
            };
        }
    }
};
