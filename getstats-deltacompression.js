module.exports = {
  decompress: function(baseStats, newStats) {
    Object.keys(newStats).forEach(id => {
      if (!baseStats[id]) {
        baseStats[id] = newStats[id];
      } else {
        const report = newStats[id];
        Object.keys(report).forEach(name => {
          baseStats[id][name] = report[name];
        });
      }
    });
    return baseStats;
  },
  compress: function(baseStats, newStats) {
    Object.keys(newStats).forEach(id => {
      if (!baseStats[id]) {
        return;
      }
      const report = newStats[id];
      Object.keys(report).forEach(name => {
        if (report[name] === baseStats[id][name]) {
          delete newStats[id][name];
        }
        delete report.timestamp;
        if (Object.keys(report).length === 0) {
          delete newStats[id];
        }
      });
    });
    // TODO: moving the timestamp to the top-level is not compression but...
    newStats.timestamp = new Date();
    return newStats;
  }
};
