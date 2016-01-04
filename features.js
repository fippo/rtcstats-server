// https://en.wikipedia.org/wiki/Feature_extraction for peerconnection API traces.
module.exports = function(peerConnectionLog) {
};

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

// was an ice failure detected.
function feature_ICEFailure(peerConnectionLog) {
    return peerConnectionLog.filter(function(entry) {
        return entry.type === 'oniceconnectionstatechange' && entry.value === 'failed';
    }).length > 0;
}

// did ice gathering complete (aka: onicecandidate called with a null candidate)
function feature_ICEGatheringComplete(peerConnectionLog) {
    return peerConnectionLog.filter(function(entry) {
        return entry.type === 'onicecandidate' && entry.value === 'null';
    }).length > 0;
}

// was an ice failure after a successful connection detected.
function feature_ICEFailureSubsequent(peerConnectionLog) {
    var log = filterIceConnectionStateChange(peerConnectionLog);
    var failures = log.filter(function(entry) {
        return entry.type === 'oniceconnectionstatechange' && entry.value === 'failed';
    }).length; 
    if (failures.length > 0) {
        return log.filter(function(entry) {
            return entry.type === 'oniceconnectionstatechange' && (entry.value === 'connected' || entry.value === 'completed');
        }).length > 0;
    }
    return 0;
}

// did ice connect/complete?
function feature_ICEConnectedOrCompleted(peerConnectionLog) {
    return peerConnectionLog.filter(function(entry) {
        return entry.type === 'oniceconnectionstatechange' && (entry.value === 'connected' || entry.value === 'completed');
    }).length > 0;
}

// is the session using ICE lite?
function feature_ICELite(peerConnectionLog) {
    var usingIceLite = false;
    peerConnectionLog.forEach(function(entry) {
        if (!usingIceLite && event.type === 'setRemoteDescription') {
            if (event.value.sdp && event.value.sdp.indexOf('\r\na=ice-lite\r\n')) {
                usingIceLite = true;
                }
        }
    });
    return usingIceLite;
}

function feature_ICERestart(peerConnectionLog) {
    var iceRestart = false;
    peerConnectionLog.forEach(function(entry) {
        if (!iceRestart && event.type === 'createOffer') {
            if (event.value.iceRestart) {
                usingIceLite = true;
            }
        }
    });
    return false;
}

// was the signaling state stable at least once?
function feature_SignalingStableAtLeastOnce(peerConnectionLog) {
    return peerConnectionLog.filter(function(entry) {
        return entry.type === 'onsignalingstatechange' && entry.value === 'stable';
    }).length > 0;
}

// was more than one remote stream added?
function feature_Multistream(peerConnectionLog) {
    return peerConnectionLog.filter(function(entry) {
        return entry.type === 'onaddstream';
    }).length > 1;
}

// maximum number of concurrent streams
function feature_MaxStreams(peerConnectionLog) {
    var max = 0;
    peerConnectionLog.forEach(function(entry) {
        if (event.type === 'onaddstream') max++;
        else if (event.type === 'onremovestream' && max > 0) max--;
    });
    return max;
}

// was there a peerconnection api failure?
function feature_PeerConnectionSetDescriptionFailure(peerConnectionLog) {
    return peerConnectionLog.filter(function(entry) {
        switch(entry.method) {
            case 'SetLocalDescriptionOnFailure':
            case 'SetRemoteDescriptionOnFailure':
                return true;
        }
        return false;
    }).length > 0;
}

// was there an addIceCandidate failure
function feature_PeerConnectionAddIceCandidateFailure(peerConnectionLog) {
    return peerConnectionLog.filter(function(entry) {
        return entry.method === 'AddIceCandidateOnFailure';
    }).length > 0;
}

// how long does it take to establish the connection?
// TODO: also figure out connection type so we don't lump relayed and non-relayed connections
function connectionTime(peerConnectionLog) {
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
}

// how long does it take to create a local offer/answer (mostly DTLS key generation)
function localCreateDelay(peerConnectionLog) {
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
