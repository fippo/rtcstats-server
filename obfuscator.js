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

function obfuscateSDP(sdp) {
    var lines = SDPUtils.splitLines(sdp);
    return lines.map(function(line) {
        // obfuscate a=candidate, c= and a=rtcp
        if (line.indexOf('a=candidate:') === 0) {
            return obfuscateCandidate(line);
        } else if (line.indexOf('c=') === 0) {
            return 'c=IN IP4 0.0.0.0';
        } else if (line.indexOf('a=rtcp:') === 0) {
            return 'a=rtcp:9 IN IP4 0.0.0.0';
        } else {
            return line;
        }
    }).join('\r\n').trim() + '\r\n';
}

module.exports = function(data) {
    switch(data[0]) {
    case 'addIceCandidate':
    case 'onicecandidate':
        if (data[2] && data[2].candidate) {
            data[2].candidate = obfuscateCandidate(data[2].candidate);
        }
        break;
    case 'setLocalDescription':
    case 'setRemoteDescription':
    case 'createOfferOnSuccess':
    case 'createAnswerOnSuccess':
        if (data[2] && data[2].sdp) {
            data[2].sdp = obfuscateSDP(data[2].sdp);
        }
        break;
    }
};
