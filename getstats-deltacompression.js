module.exports = function(baseStats, newStats) {
  Object.keys(newStats).forEach(function(id) {
    if (!baseStats[id]) {
      baseStats[id] = newStats[id];
    } else {
      var report = newStats[id];
      Object.keys(report).forEach(function(name) {
        baseStats[id][name] = report[name];
      });
    }
  });
  return baseStats;
};
