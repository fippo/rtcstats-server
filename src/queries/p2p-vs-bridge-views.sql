SELECT appenv, isp2p,
	COUNT(sentpacketslostpct) AS samples_count,
    AVG(sentpacketslostpct) AS sentpacketslostpct_avg,
    AVG(receivedpacketslostpct) AS receivedpacketslostpct_avg,
    AVG(meanrtt) AS meanrtt_avg
FROM rtcstats_pc_metrics
INNER JOIN rtcstats ON rtcstats.statssessionid = rtcstats_pc_metrics.statssessionid
WHERE sessionduration >= 10000
	AND sentpacketslostpct > 0
    AND sentpacketslostpct < 100
    AND receivedpacketslostpct > 0
    AND receivedpacketslostpct < 100
GROUP BY isp2p, appenv
