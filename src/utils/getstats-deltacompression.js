module.exports = {
    decompress(baseStats, newStats) {
        const timestamp = newStats.timestamp;

        delete newStats.timestamp;
        Object.keys(newStats).forEach(id => {
            if (baseStats[id]) {
                const report = newStats[id];

                if (report.timestamp === 0) {
                    report.timestamp = timestamp;
                } else if (!report.timestamp) {
                    report.timestamp = new Date(baseStats[id].timestamp).getTime();
                }
                Object.keys(report).forEach(name => {
                    baseStats[id][name] = report[name];
                });
            } else {
                if (newStats[id].timestamp === 0) {
                    newStats[id].timestamp = timestamp;
                }
                baseStats[id] = newStats[id];
            }
        });

        return baseStats;
    },
    compress(baseStats, newStats) {
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
