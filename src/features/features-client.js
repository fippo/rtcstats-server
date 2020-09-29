

// https://en.wikipedia.org/wiki/Feature_extraction for peerconnection
// API traces and getStats data.
// there are two types of features
// 1) features which only take the client as argument. E.g. extracting the browser version
// 2) features which take the client and a connection argument. Those do something with the connection.
// 3) features which are specific to a track.
// The first type of feature is contained in this file.

const platform = require('platform');

const { timeBetween } = require('../utils/utils');

module.exports = {
    origin(client) {
        return client.origin;
    },

    browser(client) {
        if (!(client.userAgent && client.userAgent.length)) {
            return;
        }
        const ua = platform.parse(client.userAgent);
        const parts = {
            name: ua.name || 'unknown',
            version: ua.version || '-1',
            os: ua.os.toString(),
            userAgent: client.userAgent,
            nameVersion: `${ua.name}/${ua.version}`,
            nameOs: `${ua.name}/${ua.os.toString()}`,
            nameVersionOs: `${ua.name}/${ua.version}/${ua.os.toString()}`
        };

        if (ua.version) {
            parts.majorVersion = ua.version.split('.')[0];
        }

        return parts;
    },

    // did the page call getUserMedia at all?
    calledGetUserMedia(client) {
        return client.getUserMedia && client.getUserMedia.length > 0;
    },

    // did the page use the old getUserMedia?
    calledLegacyGetUserMedia(client) {
        const gum = client.getUserMedia || [];

        for (let i = 0; i < gum.length; i++) {
            if (gum[i].type === 'getUserMedia') {
                return true;
            }
        }

        return false;
    },

    // did the page use the new navigator.mediaDevices.getUserMedia?
    calledMediadevicesGetUserMedia(client) {
        const gum = client.getUserMedia || [];

        for (let i = 0; i < gum.length; i++) {
            if (gum[i].type === 'navigator.mediaDevices.getUserMedia') {
                return true;
            }
        }

        return false;
    },

    // TODO: was enumerateDevices used? rtcstats does not hook this and I do not think
    // that tracing every call would be useful but enumerating hardware once might
    // be nice for features like numberOfMicrophones, numberOfCameras, ...

    // was there at least one getUserMedia success?
    getUserMediaSuccess(client) {
        const gum = client.getUserMedia || [];

        for (let i = 0; i < gum.length; i++) {
            if (
                gum[i].type === 'navigator.mediaDevices.getUserMediaOnSuccess'
                || gum[i].type === 'getUserMediaOnSuccess'
            ) {
                return true;
            }
        }

        return false;
    },

    // was there at least one getUserMedia error? If so, what was the error?
    getUserMediaError(client) {
        const gum = client.getUserMedia || [];

        for (let i = 0; i < gum.length; i++) {
            if (
                gum[i].type === 'navigator.mediaDevices.getUserMediaOnFailure'
                || gum[i].type === 'getUserMediaOnFailure'
            ) {
                return gum[i].value;
            }
        }
    },

    // did the client ever request audio?
    calledGetUserMediaRequestingAudio(client) {
        const gum = client.getUserMedia || [];
        let requested = false;

        for (let i = 0; i < gum.length; i++) {
            if (gum[i].type === 'navigator.mediaDevices.getUserMedia' || gum[i].type === 'getUserMedia') {
                const options = gum[i].value;

                if (options.audio && options.audio !== false) {
                    requested = true;
                }
            }
        }

        return requested;
    },

    // did the client ever request video (not screenshare)?
    // screensharing is defined as
    //      mozMediaSource || mediaSource in FF (look for window || screen?)
    //      mandatory.chromeMediaSource: desktop in chrome
    calledGetUserMediaRequestingVideo(client) {
        const gum = client.getUserMedia || [];
        let requested = false;

        for (let i = 0; i < gum.length; i++) {
            if (gum[i].type === 'navigator.mediaDevices.getUserMedia' || gum[i].type === 'getUserMedia') {
                const options = gum[i].value;

                if (options.video === true) {
                    requested = true;
                    break;
                }
                if (options.video && typeof options.video === 'object') {
                    if (
                        !(
                            options.video.mozMediaSource
                            || options.video.mediaSource
                            || options.video.chromeMediaSource
                        )
                    ) {
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
    calledGetUserMediaRequestingScreen(client) {
        const gum = client.getUserMedia || [];

        for (let i = 0; i < gum.length; i++) {
            if (gum[i].type === 'navigator.mediaDevices.getUserMedia' || gum[i].type === 'getUserMedia') {
                const options = gum[i].value;

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
            if (
                gum[i].type === 'navigator.getDisplayMedia'
                || gum[i].type === 'navigator.mediaDevices.getDisplayMedia'
            ) {
                const { value } = gum[i];

                return value && value.video === true;
            }
        }

        return false;
    },

    calledGetUserMediaRequestingAEC3(client) {
        const gum = client.getUserMedia || [];
        let requested = false;

        for (let i = 0; i < gum.length; i++) {
            if (gum[i].type === 'navigator.mediaDevices.getUserMedia' || gum[i].type === 'getUserMedia') {
                const options = gum[i].value;

                if (options.audio && options.audio.echoCancellationType === 'aec3') {
                    requested = true;
                }
            }
        }

        return requested;
    },

    timeBetweenGetUserMediaAndGetUserMediaSuccess(client) {
        return timeBetween(
            client.getUserMedia || [],
            [ 'navigator.mediaDevices.getUserMedia', 'getUserMedia' ],
            [ 'navigator.mediaDevices.getUserMediaOnSuccess', 'getUserMediaOnSuccess' ]
        );
    },

    timeBetweenGetUserMediaAndGetUserMediaFailure(client) {
        return timeBetween(
            client.getUserMedia || [],
            [ 'navigator.mediaDevices.getUserMedia', 'getUserMedia' ],
            [ 'navigator.mediaDevices.getUserMediaOnFailure', 'getUserMediaOnFailure' ]
        );
    },

    // return the label of the first audio device
    firstAudioTrackLabel(client) {
        const gum = client.getUserMedia || [];

        for (let i = 0; i < gum.length; i++) {
            if (
                gum[i].type === 'navigator.mediaDevices.getUserMediaOnSuccess'
                || gum[i].type === 'getUserMediaOnSuccess'
            ) {
                const stream = gum[i].value;
                const tracks = (stream && stream.tracks) || [];

                for (let j = 0; j < tracks.length; j++) {
                    if (tracks[j].kind === 'audio') {
                        return tracks[j].label;
                    }
                }
            }
        }
    },

    // return the label of the first video device
    firstVideoTrackLabel(client) {
        const gum = client.getUserMedia || [];

        for (let i = 0; i < gum.length; i++) {
            if (
                gum[i].type === 'navigator.mediaDevices.getUserMediaOnSuccess'
                || gum[i].type === 'getUserMediaOnSuccess'
            ) {
                const stream = gum[i].value;
                const tracks = (stream && stream.tracks) || [];

                for (let j = 0; j < tracks.length; j++) {
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
    numberOfPeerConnections(client) {
        return Object.keys(client.peerConnections).length;
    },

    userfeedback(client) {
        if (!client.feedback) {
            return;
        }
        const feature = {};

        feature[client.feedback.mediaType] = client.feedback.score;

        return feature;
    },

    tags(client) {
        return client.tags;
    },
    websocketConnectionTime(client) {
        return client.websocketConnectionTime;
    },

    websocketError(client) {
        return client.websocketError;
    },

    // which public address was used - taken from rtcstats websocket.
    // can be a list of proxies from the x-forwarded-for header,
    // take the last one.
    publicIPAddress(client) {
        return client.publicIP[client.publicIP.length - 1];
    },

    usesHTTPProxy(client) {
        return client.publicIP.length > 1;
    }
};
