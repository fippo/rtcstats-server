
/**
 * @typedef {Object} ResStatsMap Object containing resolution usage data.
 * @property {Number} totalSamples Number of times the resolution stat was sampled.
 * @property {Object} resTimeShare Object Data referring to how much of the total sample number each definition was used
 * @property {Number} resTimeShare.noVideo Something
 * @property {Number} resTimeShare.ldVideo Something
 * @property {Number} resTimeShare.sdVideo Something
 * @property {Number} resTimeShare.hdVideo Something
 */

/**
 * @typedef {Object} ResTimeSharePct Percentage of time from total that a standard definition was used.
 * @property {Number} hdVideo Percent of time spent in HD definitions.
 * @property {Number} sdVideo Percent of time spent in SD definitions.
 * @property {Number} ldVideo Percent of time spent in LD definitions.
 * @property {Number} noVideo Percent of time no video was sent.
 */

