module.exports = {
    numberOfStats: ({stats}) => stats.length, 
    duration: ({kind, direction, trackId, stats}) => {
        if (stats.length < 2) {
            return 0;
        }
        const first = stats[0];
        const last = stats[stats.length - 1];
        return last.timestamp.getTime() - first.timestamp.getTime();
    }
};
