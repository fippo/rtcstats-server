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
    speakertime BIGINT
    )