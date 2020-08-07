const Amplitude = require('amplitude');

const logger = require('../logging');

class AmplitudeConnector {
    constructor(key, options) {
        if (!key) {
            throw new Error('[Amplitude] Please provide an amplitude key!');
        }

        this.amplitude = new Amplitude(key, options);
    }

    /**
     * Extract a subset of features considered to be more relevant.
     *
     * @param {Object} connectionFeatures
     */
    extractRelevantStats(connectionFeatures) {
        const filteredFeature = {};

        // TODO Use object destructuring for a more clean approach.
        filteredFeature.lifeTime = connectionFeatures.lifeTime;
        filteredFeature.ICEFailure = connectionFeatures.ICEFailure;
        filteredFeature.connectionTime = connectionFeatures.connectionTime;
        filteredFeature.numberOfRemoteStreams = connectionFeatures.numberOfRemoteStreams;
        filteredFeature.sessionDuration = connectionFeatures.sessionDuration;
        filteredFeature.numberOfLocalSimulcastStreams = connectionFeatures.numberOfLocalSimulcastStreams;
        filteredFeature.bytesTotalSent = connectionFeatures.bytesTotalSent;
        filteredFeature.bytesTotalReceived = connectionFeatures.bytesTotalReceived;
        filteredFeature.statsMeanRoundTripTime = connectionFeatures.statsMeanRoundTripTime;
        filteredFeature.statsMeanReceivingBitrate = connectionFeatures.statsMeanReceivingBitrate;
        filteredFeature.statsMeanSendingBitrate = connectionFeatures.statsMeanSendingBitrate;
        filteredFeature.firstCandidatePairType = connectionFeatures.firstCandidatePairType;
        filteredFeature.bweGoogActualEncBitrateMean = connectionFeatures.bweGoogActualEncBitrateMean;
        filteredFeature.bweGoogRetransmitBitrateMean = connectionFeatures.bweGoogRetransmitBitrateMean;
        filteredFeature.bweGoogTargetEncBitrateMean = connectionFeatures.bweGoogTargetEncBitrateMean;
        filteredFeature.bweGoogTransmitBitrateMean = connectionFeatures.bweGoogTransmitBitrateMean;
        filteredFeature.bweAvailableOutgoingBitrateMean = connectionFeatures.bweAvailableOutgoingBitrateMean;
        filteredFeature.bweAvailableIncomingBitrateMean = connectionFeatures.bweAvailableIncomingBitrateMean;

        return filteredFeature;
    }

    track(rtcstatsFeatures) {
        try {
            // TODO Add checks for identity info using object destructuring.
            if (!rtcstatsFeatures.identity.userId && !rtcstatsFeatures.identity.deviceId) {
                logger.warn('[Amplitude] userId or deviceId must be present');
                return;
            }

            const amplitudeEvent = {
                event_type: 'rtcstats-publish',
                user_id: rtcstatsFeatures.identity.userId,
                device_id: rtcstatsFeatures.identity.deviceId,
                session_id: rtcstatsFeatures.identity.sessionId,
                event_properties: {
                    rtcstatsIdentity: rtcstatsFeatures.clientId,
                    displayName: rtcstatsFeatures.identity.displayName,
                    confID: rtcstatsFeatures.identity.confID,
                    ...rtcstatsFeatures.identity.hosts,
                    ...rtcstatsFeatures.identity.deploymentInfo,
                    ...this.extractRelevantStats(rtcstatsFeatures.connectionFeatures),
                },
            };

            this.amplitude
                .track(amplitudeEvent)
                .then(() =>
                    logger.info(
                        '[Amplitude] Sent event: rtcstats clientId: %s, user_id: %s, device_id: %s, session_id: %s',
                        rtcstatsFeatures.clientId,
                        amplitudeEvent.user_id,
                        amplitudeEvent.device_id,
                        amplitudeEvent.session_id
                    )
                )
                .catch((error) => logger.error('[Amplitude] track promise failed for event %j error: %s', amplitudeEvent, error.message));
        } catch (error) {
            logger.error('[Amplitude] Failed to send rtcstats features %j with error: %s', rtcstatsFeatures, error.message);
        }
    }
}

module.exports = AmplitudeConnector;
