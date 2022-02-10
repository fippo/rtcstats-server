/* eslint-disable camelcase */
const Amplitude = require('amplitude');

const logger = require('../logging');

/**
 *
 */
class AmplitudeConnector {
    /**
     *
     * @param {*} key
     * @param {*} options
     */
    constructor(key, options) {
        if (!key) {
            throw new Error('[Amplitude] Please provide an amplitude key!');
        }

        this.amplitude = new Amplitude(key, options);
    }

    /**
     *
     * @param {*} rtcstatsFeatures
     */
    track(dumpInfo, features = {}) {
        try {
            const { ampDeviceId: device_id,
                ampSessionId: session_id,
                ampUserId: user_id,
                clientId: statsSessionId,
                userId: displayName } = dumpInfo;

            if (!user_id && !device_id) {
                logger.warn('[Amplitude] user_id or device_id must be present');

                return;
            }

            const amplitudeEvent = {
                event_type: 'rtcstats-publish',
                user_id,
                device_id,
                session_id,
                event_properties: {
                    statsSessionId,
                    displayName,
                    ...features.metrics,
                    ...features.sentiment
                }
            };

            this.amplitude
                .track(amplitudeEvent)
                .then(() => logger.info('[Amplitude] Sent event: %o', amplitudeEvent))
                .catch(error =>
                    logger.error(
                        '[Amplitude] track promise failed for event %o error: %o',
                        amplitudeEvent,
                        error
                    )
                );
        } catch (error) {
            logger.error(
                '[Amplitude] Failed to send event for dump %o, features: %o, error: %o',
                dumpInfo,
                features,
                error
            );
        }
    }
}

module.exports = AmplitudeConnector;
