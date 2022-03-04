/**
 * Initial schema for redshift rtcstats table
 */
CREATE TABLE IF NOT EXISTS rtcstats (
    appEnv VARCHAR(128),
    statssessionid VARCHAR ( 256 ),
    displayname VARCHAR ( 256 ),
    meetingname VARCHAR ( 256 ),
    meetingurl VARCHAR ( 2048 ),
    meetinguniqueid VARCHAR ( 256 ),
    createdate TIMESTAMP,
    endpointid VARCHAR (256),
    sessionduration BIGINT,
    dominantspeakerchanges BIGINT,
    speakertime BIGINT,
    sentimentAngry INT DEFAULT 0,
    sentimentSurprised INT DEFAULT 0,
    sentimentDisgusted INT DEFAULT 0,
    sentimentFearful INT DEFAULT 0,
    sentimentHappy INT DEFAULT 0,
    sentimentNeutral INT DEFAULT 0,
    sentimentSad INT DEFAULT 0,
    crossRegion BOOLEAN,
    environment VARCHAR ( 256 ),
    region VARCHAR ( 256 ),
    releaseNumber INT DEFAULT 0,
    shard VARCHAR ( 256 ),
    userRegion VARCHAR ( 256 ),
)

/**
 * Initial schema for redshift rtcstats_pc_metrics table
 */
CREATE TABLE IF NOT EXISTS rtcstats_pc_metrics (
    statssessionid VARCHAR ( 256 ),
    dtlsErrors INT,
    dtlsFailure INT,
    receivedPacketsLostPct REAL,
    sentPacketsLostPct REAL,
    totalPacketsReceived BIGINT,
    totalPacketsSent BIGINT,
    totalReceivedPacketsLost BIGINT,
    totalSentPacketsLost BIGINT,
    meanRtt REAL,
    isP2P BOOLEAN,
    usesRelay BOOLEAN,
    meanUpperBoundFrameHeight REAL,
    meanUpperBoundFramesPerSecond REAL,
    meanLowerBoundFrameHeight REAL,
    meanLowerBoundFramesPerSecond REAL
)

/**
 * Initial schema for redshift rtcstats_track_metrics table
 */
CREATE TABLE IF NOT EXISTS rtcstats_track_metrics (
    statssessionid VARCHAR ( 256 ),
    isP2P BOOLEAN,
    direction VARCHAR(128),
    mediaType VARCHAR(128),
    packets BIGINT,
    packetsLost BIGINT,
    packetsLostPct REAL,
    packetsLostVariance REAL
)
