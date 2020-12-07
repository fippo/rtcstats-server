
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


module.exports = {


};
