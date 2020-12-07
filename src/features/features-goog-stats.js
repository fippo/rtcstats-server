module.exports = {
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

    /**
     * TODO Not working atm.
     * @param {*} client
     * @param {*} peerConnectionLog
     */
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
    stats(client, peerConnectionLog) {
        const feature = {};
        const rtts = [];
        const recv = [];
        const send = [];

        const packetsLostMap = {};
        const usedResolutions = {};

        /**
         * @type {ResStatsMap}
         */
        const resStatsMap = {
            totalSamples: 0,
            resTimeShare: {
                noVideo: 0,
                ldVideo: 0,
                sdVideo: 0,
                hdVideo: 0
            }
        };

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

                        const packetsLost = report.packetsLost || 0;
                        const packetsSent = report.packetsSent || 0;
                        const prevPacketsLost = packetsLostMap[report.ssrc].packetsLost || 0;
                        const prevPacketsSent = packetsLostMap[report.ssrc].packetsSent || 0;

                        if (prevPacketsLost <= packetsLost) {
                            packetsLostMap[report.ssrc].packetsLost = packetsLost;
                        }

                        if (prevPacketsSent <= packetsSent) {
                            packetsLostMap[report.ssrc].packetsSent = packetsSent;
                        }

                        ++packetsLostMap[report.ssrc].samples;
                    }
                    if (report.mediaType === 'video') {
                        const resolution = extractValidResolution(report.frameHeight);

                        fitResToDefinition(resStatsMap, resolution);
                        fitResToAggregateMap(usedResolutions, resolution);
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

        // We could have multiple sent tracks both of type video and audio, create an average between them.
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

                trackResult.packetsLostMean = fixedDecMean([ trackResult.packetsLostMean, ssrcPacketsLostMean ], 2);

                // Calculate packets lost as a percentage, if there are more tracks of the same kind average them
                let ssrcPacketsLostPct = 0;

                if (currentSsrc.packetsSent > 0) {
                    ssrcPacketsLostPct = percentOf(currentSsrc.packetsLost, currentSsrc.packetsSent);
                }

                if (trackResult.packetsLostPct === undefined) {
                    trackResult.packetsLostPct = ssrcPacketsLostPct;
                } else {
                    trackResult.packetsLostPct = fixedDecMean([ ssrcPacketsLostPct, trackResult.packetsLostPct ], 2);
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

                if (currentSsrc.packetsSent > 0) {
                    result[currentSsrc.mediaType].packetsLostPct = percentOf(
                        currentSsrc.packetsLost,
                        currentSsrc.packetsSent
                    );
                } else {
                    result[currentSsrc.mediaType].packetsLostPct = 0;
                }

            }

            return result;
        }, {});

        const restTimeSharePct = calculateResTimeSharePct(resStatsMap);
        const resAggregates = calculateResAggregates(usedResolutions);

        feature.NoVideoPct = restTimeSharePct.noVideo;
        feature.LDVideoPct = restTimeSharePct.ldVideo;
        feature.SDVideoPct = restTimeSharePct.sdVideo;
        feature.HDVideoPct = restTimeSharePct.hdVideo;
        feature.minVideoRes = resAggregates.min;
        feature.medianVideoRes = resAggregates.median;
        feature.maxVideoRes = resAggregates.max;

        feature.meanRoundTripTime = Math.floor(rtts.reduce((a, b) => a + b, 0) / (rtts.length || 1));
        feature.meanReceivingBitrate = Math.floor(recv.reduce((a, b) => a + b, 0) / (recv.length || 1));
        feature.meanSendingBitrate = Math.floor(send.reduce((a, b) => a + b, 0) / (send.length || 1));

        if (sentMediaSummary.video) {
            feature.videoPacketsLostTotal = sentMediaSummary.video.packetsLost;
            feature.videoPacketsSentTotal = sentMediaSummary.video.packetsSent;
            feature.videoPacketsLostPct = sentMediaSummary.video.packetsLostPct;
            feature.meanVideoPacketsLost = sentMediaSummary.video.packetsLostMean;
        }

        if (sentMediaSummary.audio) {
            feature.audioPacketsLostTotal = sentMediaSummary.audio.packetsLost;
            feature.audioPacketsSentTotal = sentMediaSummary.audio.packetsSent;
            feature.audioPacketsLostPct = sentMediaSummary.audio.packetsLostPct;
            feature.meanAudioPacketsLost = sentMediaSummary.audio.packetsLostMean;
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
    }

};
