// obfuscate ip addresses which should not be stored long-term.

var SDPUtils = require('sdp');

// obfuscate ip, keeping address family intact.
// TODO: keep private addresses and only strip certain parts?
function obfuscateIP(ip) {
    return ip.indexOf(':') === -1 ? '0.0.0.0' : '::1';
}

// obfuscate the ip in ice candidates. Does NOT obfuscate the ip of the TURN server to allow
// selecting/grouping sessions by TURN server.
function obfuscateCandidate(candidate) {
    var cand = SDPUtils.parseCandidate(candidate);
    if (cand.type !== 'relay') {
        cand.ip = obfuscateIP(cand.ip);
    }
    if (cand.relatedAddress) {
        cand.relatedAddress = obfuscateIP(cand.relatedAddress);
    }
    return SDPUtils.writeCandidate(cand);
}

module.exports = function(data) {
    var lines;
    switch(data[0]) {
    case 'addIceCandidate':
    case 'onicecandidate':
        if (data[2] && data[2].candidate) {
            data[2].candidate = obfuscateCandidate(data[2].candidate);
        }
        break;
    }
};
