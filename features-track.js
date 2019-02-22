'use strict';
// https://en.wikipedia.org/wiki/Feature_extraction for peerconnection
// API traces and getStats data.
// there are two types of features
// 1) features which only take the client as argument. E.g. extracting the browser version
// 2) features which take the client and a connection argument. Those do something with the connection.
// 3) features which are specific to a track.
// The third type of feature is contained in this file.

// each feature expects {kind, direction, trackId, stats} as argument.
module.exports = {
    numberOfStats: ({stats}) => stats.length, 
    duration: ({kind, direction, trackId, stats}) => {
        if (stats.length < 2) {
            return 0;
        }
        const first = stats[0];
        const last = stats[stats.length - 1];
        return last.timestamp.getTime() - first.timestamp.getTime();
    },
    kind: ({kind}) => kind,
};
