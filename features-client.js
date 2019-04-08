'use strict';
// https://en.wikipedia.org/wiki/Feature_extraction for peerconnection
// API traces and getStats data.
// there are two types of features
// 1) features which only take the client as argument. E.g. extracting the browser version
// 2) features which take the client and a connection argument. Those do something with the connection.
// 3) features which are specific to a track.
// The first type of feature is contained in this file.

var platform = require('platform');

module.exports = {
    origin: function(client) {
        return client.origin;
    },

    browser: function(client) {
        if (!(client.userAgent && client.userAgent.length)) return;
        var ua = platform.parse(client.userAgent);
        var parts = {
            name: ua.name || 'unknown',
            version: ua.version || '-1',
            os: ua.os.toString(),
            userAgent: client.userAgent,
            nameVersion: ua.name + '/' + ua.version,
            nameOs: ua.name + '/' + ua.os.toString(),
            nameVersionOs: ua.name + '/' + ua.version + '/' + ua.os.toString()
        };
        if (ua.version) {
            parts.majorVersion = ua.version.split('.')[0];
        }
        return parts;
    },

    // did the page call getUserMedia at all?
    calledGetUserMedia: function(client) {
        return client.getUserMedia && client.getUserMedia.length > 0;
    },
    location: function(client) {
        if (!client.location) return;
        var location = client.location;
        return {
            lon: location.location.longitude,
            lat: location.location.latitude,
            lonLat: JSON.stringify([location.location.longitude, location.location.latitude]),
            continent: location.continent.code,
            country: location.country ? location.country.names.en : 'unknown county',
            city: location.city ? location.city.names.en : 'unknown city'
        };
    },

    // did the page use the old getUserMedia?
    calledLegacyGetUserMedia: function(client) {
        var gum = client.getUserMedia || [];
        for (var i = 0; i < gum.length; i++) {
            if (gum[i].type === 'getUserMedia') return true;
        }
        return false;
    },

    // did the page use the new navigator.mediaDevices.getUserMedia?
    calledMediadevicesGetUserMedia: function(client) {
        var gum = client.getUserMedia || [];
        for (var i = 0; i < gum.length; i++) {
            if (gum[i].type === 'navigator.mediaDevices.getUserMedia') return true;
        }
        return false;
    },
    // TODO: was enumerateDevices used? rtcstats does not hook this and I do not think
    // that tracing every call would be useful but enumerating hardware once might
    // be nice for features like numberOfMicrophones, numberOfCameras, ...

    // was there at least one getUserMedia success?
    getUserMediaSuccess: function(client) {
        var gum = client.getUserMedia || [];
        for (var i = 0; i < gum.length; i++) {
            if (gum[i].type === 'navigator.mediaDevices.getUserMediaOnSuccess' || gum[i].type === 'getUserMediaOnSuccess') {
                return true;
            }
        }
        return false;
    },

    // was there at least one getUserMedia error? If so, what was the error?
    getUserMediaError: function(client) {
        var gum = client.getUserMedia || [];
        for (var i = 0; i < gum.length; i++) {
            if (gum[i].type === 'navigator.mediaDevices.getUserMediaOnFailure' || gum[i].type === 'getUserMediaOnFailure') {
                return gum[i].value;
            }
        }
        return false;
    },

    // did the client ever request audio?
    calledGetUserMediaRequestingAudio: function(client) {
        var gum = client.getUserMedia || [];
        var requested = false;
        for (var i = 0; i < gum.length; i++) {
            if (gum[i].type === 'navigator.mediaDevices.getUserMedia' || gum[i].type === 'getUserMedia') {
                var options = gum[i].value;
                if (options.audio && options.audio !== false) requested = true;
            }
        }
        return requested;
    },

    // did the client ever request video (not screenshare)?
    // screensharing is defined as
    //      mozMediaSource || mediaSource in FF (look for window || screen?)
    //      mandatory.chromeMediaSource: desktop in chrome
    calledGetUserMediaRequestingVideo: function(client) {
        var gum = client.getUserMedia || [];
        var requested = false;
        for (var i = 0; i < gum.length; i++) {
            if (gum[i].type === 'navigator.mediaDevices.getUserMedia' || gum[i].type === 'getUserMedia') {
                var options = gum[i].value;
                if (options.video === true) {
                    requested = true;
                    break;
                }
                if (options.video && typeof options.video === 'object') {
                    if (!(options.video.mozMediaSource || options.video.mediaSource || options.video.chromeMediaSource)) {
                        requested = true;
                        break;
                    }
                }
            }
        }
        return requested;
    },

    // did the client ever request the screen?
    // also returns the type even though (in chrome) that is not relevant.
    calledGetUserMediaRequestingScreen: function(client) {
        var gum = client.getUserMedia || [];
        for (var i = 0; i < gum.length; i++) {
            if (gum[i].type === 'navigator.mediaDevices.getUserMedia' || gum[i].type === 'getUserMedia') {
                var options = gum[i].value;
                if (options.video && typeof options.video === 'object') {
                    // Firefox
                    if (options.video.mozMediaSource || options.video.mediaSource) {
                        return options.video.mozMediaSource || options.video.mediaSource;
                    }
                    // Chrome
                    if (options.video.mandatory && options.video.mandatory.chromeMediaSource) {
                        return options.video.mandatory.chromeMediaSource;
                    }
                }
            }
            if (gum[i].type === 'navigator.getDisplayMedia' || gum[i].type === 'navigator.mediaDevices.getDisplayMedia') {
                return true;
            }
        }
        return false;
    },

    calledGetUserMediaRequestingAEC3: function(client) {
        var gum = client.getUserMedia || [];
        var requested = false;
        for (var i = 0; i < gum.length; i++) {
            if (gum[i].type === 'navigator.mediaDevices.getUserMedia' || gum[i].type === 'getUserMedia') {
                var options = gum[i].value;
                if (options.audio && options.audio.echoCancellationType === 'aec3') requested = true;
            }
        }
        return requested;
    },

    timeBetweenGetUserMediaAndGetUserMediaSuccess: function(client) {
        var gum = client.getUserMedia || [];
        var first;
        for (var i = 0; i < gum.length; i++) {
            if (gum[i].type === 'navigator.mediaDevices.getUserMedia' || gum[i].type === 'getUserMedia') {
                first = gum[i];
            } else if (gum[i].type === 'navigator.mediaDevices.getUserMediaOnSuccess' || gum[i].type === 'getUserMediaOnSuccess') {
                if (first) {
                    return gum[i].timestamp - first.timestamp;
                } else {
                    return -1;
                }
            }
        }
    },

    timeBetweenGetUserMediaAndGetUserMediaFailure: function(client) {
        var gum = client.getUserMedia || [];
        var first;
        for (var i = 0; i < gum.length; i++) {
            if (gum[i].type === 'navigator.mediaDevices.getUserMedia' || gum[i].type === 'getUserMedia') {
                first = gum[i];
            } else if (gum[i].type === 'navigator.mediaDevices.getUserMediaOnFailure' || gum[i].type === 'getUserMediaOnFailure') {
                if (first) {
                    return gum[i].timestamp - fіrst.timestamp;
                } else {
                    return -1;
                }
            }
        }
    },

    // return the label of the first audio device
    firstAudioTrackLabel: function(client) {
        var gum = client.getUserMedia || [];
        for (var i = 0; i < gum.length; i++) {
            if (gum[i].type === 'navigator.mediaDevices.getUserMediaOnSuccess' || gum[i].type === 'getUserMediaOnSuccess') {
                var stream = gum[i].value;
                var tracks = stream && stream.tracks || [];
                for (var j = 0; j < tracks.length; j++) {
                    if (tracks[j].kind === 'audio') {
                        return tracks[j].label;
                    }
                }
            }
        }
    },

    // return the label of the first video device
    firstVideoTrackLabel: function(client) {
        var gum = client.getUserMedia || [];
        var gum = client.getUserMedia || [];
        for (var i = 0; i < gum.length; i++) {
            if (gum[i].type === 'navigator.mediaDevices.getUserMediaOnSuccess' || gum[i].type === 'getUserMediaOnSuccess') {
                var stream = gum[i].value;
                var tracks = stream && stream.tracks || [];
                for (var j = 0; j < tracks.length; j++) {
                    if (tracks[j].kind === 'video') {
                        return tracks[j].label;
                    }
                }
            }
        }
    },
    // TODO: gum statistics (audio, video, number of tracks, errors, fail-to-acquire aka ended readyState)
    // TODO: resolution, framerate
    // TODO: special goog constraints?
    // TODO: feature for "were the promise-ified apis used or the legacy variants?"

    // number of peerConnections created
    numberOfPeerConnections: function(client) {
        return Object.keys(client.peerConnections).length;
    },

    userfeedback: function(client) {
        if (!client.feedback) return;
        var feature = {};
        feature[client.feedback.mediaType] = client.feedback.score;
        return feature;
    },

    tags: function(client) {
        return client.tags;
    },
    websocketConnectionTime: function(client) {
        return client.websocketConnectionTime;
    },

    websocketError: function(client) {
        return client.websocketError;
    }
};
