// https://en.wikipedia.org/wiki/Feature_extraction for peerconnection API traces.
module.exports = function(peerConnectionLog) {
}

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
