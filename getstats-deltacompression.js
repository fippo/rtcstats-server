'use strict';

module.exports = {
  decompress(baseStats, newStats) {
    Object.keys(newStats).forEach((id) => {
      if (!baseStats[id]) {
        baseStats[id] = newStats[id]; // eslint-disable-line no-param-reassign
      } else {
        const report = newStats[id];
        Object.keys(report).forEach((name) => {
          baseStats[id][name] = report[name]; // eslint-disable-line no-param-reassign
        });
      }
    });
    return baseStats;
  },
  compress(baseStats, newStats) {
    Object.keys(newStats).forEach((id) => {
      if (!baseStats[id]) {
        return;
      }
      const report = newStats[id];
      Object.keys(report).forEach((name) => {
        if (report[name] === baseStats[id][name]) {
          delete newStats[id][name]; // eslint-disable-line no-param-reassign
        }
        delete report.timestamp;
        if (Object.keys(report).length === 0) {
          delete newStats[id]; // eslint-disable-line no-param-reassign
        }
      });
    });
    // TODO: moving the timestamp to the top-level is not compression but...
    newStats.timestamp = new Date(); // eslint-disable-line no-param-reassign
    return newStats;
  }
};
