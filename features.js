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
    // was an ice failure detected.
    feature_ICEFailure: function(peerConnectionLog) {
        return peerConnectionLog.filter(function(entry) {
            return entry.type === 'oniceconnectionstatechange' && entry.value === 'failed';
        }).length > 0;
    },

    // did ice gathering complete (aka: onicecandidate called with a null candidate)
    feature_ICEGatheringComplete: function(peerConnectionLog) {
        return peerConnectionLog.filter(function(entry) {
            return entry.type === 'onicecandidate' && entry.value === 'null';
        }).length > 0;
    },

    // was an ice failure after a successful connection detected.
    feature_ICEFailureSubsequent: function(peerConnectionLog) {
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
    feature_ICEConnectedOrCompleted: function(peerConnectionLog) {
        return peerConnectionLog.filter(function(entry) {
            return entry.type === 'oniceconnectionstatechange' && (entry.value === 'connected' || entry.value === 'completed');
        }).length > 0;
    },

    // is the session using ICE lite?
    feature_ICELite: function(peerConnectionLog) {
        var usingIceLite = false;
        peerConnectionLog.forEach(function(entry) {
            if (!usingIceLite && entry.type === 'setRemoteDescription') {
                if (entry.value.sdp && entry.value.sdp.indexOf('\r\na=ice-lite\r\n')) {
                    usingIceLite = true;
                    }
            }
        });
        return usingIceLite;
    },

    feature_ICERestart: function(peerConnectionLog) {
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
    feature_SignalingStableAtLeastOnce: function(peerConnectionLog) {
        return peerConnectionLog.filter(function(entry) {
            return entry.type === 'onsignalingstatechange' && entry.value === 'stable';
        }).length > 0;
    },

    // was more than one remote stream added?
    feature_Multistream: function(peerConnectionLog) {
        return peerConnectionLog.filter(function(entry) {
            return entry.type === 'onaddstream';
        }).length > 1;
    },

    // maximum number of concurrent streams
    feature_MaxStreams: function(peerConnectionLog) {
        var max = 0;
        peerConnectionLog.forEach(function(entry) {
            if (entry.type === 'onaddstream') max++;
            else if (entry.type === 'onremovestream' && max > 0) max--;
        });
        return max;
    },

    // was there a peerconnection api failure?
    feature_PeerConnectionSetDescriptionFailure: function(peerConnectionLog) {
        return peerConnectionLog.filter(function(entry) {
            switch(entry.method) {
                case 'SetLocalDescriptionOnFailure':
                case 'SetRemoteDescriptionOnFailure':
                    return true;
            }
            return false;
        }).length > 0;
    },

    // was there an addIceCandidate failure
    feature_PeerConnectionAddIceCandidateFailure: function(peerConnectionLog) {
        return peerConnectionLog.filter(function(entry) {
            return entry.method === 'AddIceCandidateOnFailure';
        }).length > 0;
    },

    // how long does it take to establish the connection?
    // TODO: also figure out connection type so we don't lump relayed and non-relayed connections
    feature_ConnectionTime: function(peerConnectionLog) {
        var first;
        var second;
        for (first = 0; first < peerConnectionLog.length; first++) {
            if (peerConnectionLog[first].method === 'oniceconnectionstatechange' &&
                peerConnectionLog[first].value === 'checking') break;
        }
        if (first < peerConnectionLog.length) {
            for (second = first + 1; second < peerConnectionLog.length; second++) {
                if (peerConnectionLog[second].method === 'oniceconnectionstatechange' &&
                    (peerConnectionLog[second].value === 'connected' || peerConnectionLog[second].value === 'completed')) break;
            }
            if (second < peerConnectionLog) {
                return (new Date(peerConnectionLog[second].time).getTime() - 
                    new Date(peerConnectionLog[first].time).getTime());
            }
        }
        return -1;
    },

    // how long does it take to create a local offer/answer (mostly DTLS key generation)
    feature_localCreateDelay: function(peerConnectionLog) {
        var first;
        var second;
        for (first = 0; first < peerConnectionLog.length; first++) {
            if (peerConnectionLog[first].method === 'CreateOffer' ||
                peerConnectionLog[first].method === 'CreateAnswer') break;
        }
        if (first < peerConnectionLog.length) {
            for (second = first + 1; second < peerConnectionLog.length; second++) {
                if (peerConnectionLog[second].method === peerConnectionLog[first].method + 'OnSuccess') break;
            }
            if (second < peerConnectionLog) {
                return (new Date(peerConnectionLog[second].time).getTime() - 
                    new Date(peerConnectionLog[first].time).getTime());
            }
        }
        return -1;
    }
};
