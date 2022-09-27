/**
 * Initial schema for redshift rtcstats table
 */
CREATE TABLE IF NOT EXISTS rtcstats (
    appEnv VARCHAR(128),
    statssessionid VARCHAR ( 256 ) NOT NULL,
    displayname VARCHAR ( 256 ),
    meetingname VARCHAR ( 256 ),
    meetingurl VARCHAR ( 2048 ),
    meetinguniqueid VARCHAR ( 256 ),
    createdate TIMESTAMP,
    endpointid VARCHAR (256),
    conferenceStartTime TIMESTAMP,
    sessionStartTime TIMESTAMP,
    sessionEndTime TIMESTAMP,
    sessiondurationms BIGINT,
    conferencedurationms BIGINT,
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
    os VARCHAR ( 256 ),
    browserName VARCHAR ( 100 ),
    browserVersion VARCHAR ( 50 ),
    isBreakoutRoom: BOOLEAN,
    breakoutRoomId: VARCHAR ( 256 ),
    parentStatsSessionId: VARCHAR ( 256 ),
    PRIMARY KEY(statssessionid)
)

/**
 * Initial schema for redshift rtcstats_pc_metrics table
 * Note, redshift does not enforce primary/foreign key constraints however the planner can use them
 * to improve performance.
 */
CREATE TABLE IF NOT EXISTS rtcstats_pc_metrics (
    id VARCHAR(128) NOT NULL,
    createdate TIMESTAMP,
    statssessionid VARCHAR ( 256 ),
    dtlsErrors INT,
    dtlsFailure INT,
    sdpCreateFailure INT,
    sdpSetFailure INT,
    pcname VARCHAR(128),
    pcSessionDurationMs: BIGINT,
    connectionFailed: BOOLEAN,
    lastIceFailure: BIGINT,
    lastIceDisconnect: BIGINT,
    iceReconnects INT,
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
    meanLowerBoundFramesPerSecond REAL,
    PRIMARY KEY(id),
    FOREIGN KEY (statssessionid) REFERENCES rtcstats(statssessionid)
)

/**
 * Initial schema for redshift rtcstats_track_metrics table
 */
CREATE TABLE IF NOT EXISTS rtcstats_track_metrics (
    id VARCHAR(128) NOT NULL,
    pcId VARCHAR(128),
    createdate TIMESTAMP,
    starttime TIMESTAMP,
    endtime TIMESTAMP,
    statssessionid VARCHAR ( 256 ),
    isP2P BOOLEAN,
    direction VARCHAR(128),
    mediaType VARCHAR(128),
    /* the ssrc is an unsigned 32 bit integer, so it can never reach 128 characters in length but we define it as such for uniformity */
    ssrc VARCHAR(128),
    packets BIGINT,
    packetsLost BIGINT,
    packetsLostPct REAL,
    packetsLostVariance REAL,
    concealedPercentage REAL,
    PRIMARY KEY(id),
    FOREIGN KEY (pcId) REFERENCES rtcstats_pc_metrics(id)
)

/**
 * Initial schema for redshift rtcstats_e2e_ping table
 */
CREATE TABLE IF NOT EXISTS rtcstats_e2e_ping (
    id VARCHAR(128) NOT NULL,
    statssessionid VARCHAR ( 256 ),
    remoteEndpointId VARCHAR ( 256 ),
    remoteRegion VARCHAR ( 256 ),
    rtt REAL,
    PRIMARY KEY(id),
    FOREIGN KEY (statssessionid) REFERENCES rtcstats(statssessionid)
)

/**
 * Initial schema for redshift rtcstats_face_landmarks table
 */
CREATE TABLE IF NOT EXISTS rtcstats_face_landmarks(
    id VARCHAR(128) NOT NULL,
    statssessionid VARCHAR(256),
    timestamp      BIGINT,
    facelandmarks   VARCHAR(256),
    PRIMARY KEY(id),
    FOREIGN KEY (statssessionid) REFERENCES rtcstats(statssessionid)
)
