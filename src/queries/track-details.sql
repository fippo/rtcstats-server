SELECT rtcstats_track_metrics.isp2p AS isp2p,
  mediatype, 
  rtcstats_pc_metrics.usesrelay AS usesrelay,
  COUNT(mediatype) AS count,
  AVG(packetslostpct) AS loss_pct,
  AVG(packetslostvariance) AS loss_variance
FROM rtcstats_track_metrics
INNER JOIN rtcstats_pc_metrics
    ON rtcstats_pc_metrics.id = rtcstats_track_metrics.pcid
WHERE rtcstats_track_metrics.isp2p IS NOT NULL
GROUP BY rtcstats_track_metrics.isp2p, mediatype, usesrelay
ORDER BY rtcstats_track_metrics.isp2p, mediatype, usesrelay
