CREATE TABLE features (
    date bigint,
    datetime bigint,
    clientidentifier character varying(255),
    conferenceidentifier character varying(4096),
    peeridentifier character varying(255),
    clientid character varying(255),
    connectionid character varying(255),
    streamid character varying(255),

    tags character varying(1023),

    origin character varying(255),
    pageurl character varying(4096),

    browsername character varying(255),
    browserversion character varying(255),
    browseros character varying(255),
    browseruseragent character varying(1023),
    browsernameversion character varying(255),
    browsernameos character varying(255),
    browsernameversionos character varying(255),
    browsermajorversion integer,
    browsertype character varying(255),

    locationCountry character varying(255),
    locationCity character varying(255),
    locationContinent character varying(16),
    locationLon real,
    locationLat real,
    locationLonLat character varying(255),

    calledgetusermedia boolean,
    calledlegacygetusermedia boolean,
    calledmediadevicesgetusermedia boolean,
    calledgetusermediarequestingaudio boolean,
    calledgetusermediarequestingscreen character varying(255),
    calledgetusermediarequestingvideo boolean,
    calledgetusermediarequestingaec3 boolean,
    getusermediaerror character varying(4096),
    getusermediasuccess boolean,
    timebetweengetusermediaandgetusermediasuccess integer,
    timebetweengetusermediaandgetusermediafailure integer,
    firstaudiotracklabel character varying(255),
    firstvideotracklabel character varying(255),

    numberofpeerconnections integer,
    userfeedbackaudio integer,
    userfeedbackvideo integer,

    starttime bigint,
    stoptime bigint,
    lifetime integer,
    sessionduration integer,

    remotetype character varying(255),
    isinitiator boolean,
    signalingstableatleastonce boolean,

    configured boolean,
    configuredbundlepolicy boolean,
    configuredcertificate boolean,
    configuredicetransportpolicy boolean,
    configuredrtcpmuxpolicy boolean,
    configuredwithiceservers boolean,
    configuredwithstun boolean,
    configuredwithturn boolean,
    configuredwithturntcp boolean,
    configuredwithturntls boolean,
    configuredwithturnudp boolean,
    sdpsemantics character varying(32),
    calledaddtrack boolean,
    calledaddstream boolean,

    localcreatedelay integer,
    maxstreams integer,
    maxremotestreams integer,
    numberOfRemoteStreams integer,
    mediatypes character varying(255),
    usingbundle boolean,
    usingicelite boolean,
    usingmultistream boolean,
    usingrtcpmux boolean,
    usingsimulcast boolean,
    setlocaldescriptionfailure character varying(4096),
    setremotedescriptionfailure character varying(4096),
    addicecandidatefailure character varying(4096),
    dtlsciphersuite character varying(255),
    srtpciphersuite character varying(255),

    icegatheringcomplete boolean,
    iceconnectedorcompleted boolean,
    icefailure boolean,
    icefailuresubsequent boolean,
    icerestart boolean,
    icerestartsuccess boolean,
    icerestartfollowedbysetremotedescription boolean,
    icerestartfollowedbyrelaycandidate boolean,
    timebetweensetlocaldescriptionandonicecandidate integer,
    timebetweensetremotedescriptionandaddicecandidate integer,
    numberofcandidatepairchanges integer,
    numberoflocalicecandidates integer,
    numberofremoteicecandidates integer,
    connectiontime integer,
    numberofinterfaces integer,
    firstcandidatepairtype character varying(255),
    firstcandidatepairlocaltype character varying(255),
    firstcandidatepairremotetype character varying(255),
    firstcandidatepairlocalipaddress character varying(255),
    firstcandidatepairremoteipaddress character varying(255),
    firstcandidatepairlocaltypepreference integer,
    firstcandidatepairremotetypepreference integer,
    gatheredhost boolean,
    gatheredstun boolean,
    gatheredturntcp boolean,
    gatheredturntls boolean,
    gatheredturnudp boolean,
    gatheredrfc1918addressprefix16 boolean,
    gatheredrfc1918addressprefix12 boolean,
    gatheredrfc1918addressprefix10 boolean,
    gatheringtime integer,
    gatheringtimeturntcp integer,
    gatheringtimeturntls integer,
    gatheringtimeturnudp integer,
    hadremoteturncandidate boolean,
    relayaddress character varying(255),
    publicipaddress character varying(255),

    bwegoogactualencbitratemean real,
    bwegoogactualencbitratemax real,
    bwegoogactualencbitratemin real,
    bwegoogactualencbitratevariance real,
    bwegoogretransmitbitratemean real,
    bwegoogretransmitbitratemax real,
    bwegoogretransmitbitratemin real,
    bwegoogretransmitbitratevariance real,
    bwegoogtargetencbitratemean real,
    bwegoogtargetencbitratemax real,
    bwegoogtargetencbitratemin real,
    bwegoogtargetencbitratevariance real,
    bwegoogbucketdelaymean real,
    bwegoogbucketdelaymax real,
    bwegoogbucketdelaymin real,
    bwegoogbucketdelayvariance real,
    bwegoogtransmitbitratemean real,
    bwegoogtransmitbitratemax real,
    bwegoogtransmitbitratemin real,
    bwegoogtransmitbitratevariance real,
    bweavailableoutgoingbitratemean real,
    bweavailableoutgoingbitratemax real,
    bweavailableoutgoingbitratemin real,
    bweavailableoutgoingbitratevariance real,
    bweavailableincomingbitratemean real,
    bweavailableincomingbitratemax real,
    bweavailableincomingbitratemin real,
    bweavailableincomingbitratevariance real,

    statsmeanreceivingbitrate integer,
    statsmeanroundtriptime integer,
    statsmeansendingbitrate integer,

    direction character varying(4),
    numberofstats integer,
    duration integer,

    audiolevelmean real,
    audiolevelmax real,
    audiolevelmin real,
    audiolevelvariance real,
    audiogoogjitterreceivedmean real,
    audiogoogjitterreceivedmax real,
    audiogoogjitterreceivedmin real,
    audiogoogjitterreceivedvariance real,
    audiogoogjitterbuffermsmean real,
    audiogoogjitterbuffermsmax real,
    audiogoogjitterbuffermsmin real,
    audiogoogjitterbuffermsvariance real,
    audiogoogpreferredjitterbuffermsmean real,
    audiogoogpreferredjitterbuffermsmax real,
    audiogoogpreferredjitterbuffermsmin real,
    audiogoogpreferredjitterbuffermsvariance real,
    audiogoogpreferredjitterbuffermsskewness real,
    audiogoogpreferredjitterbuffermskurtosis real,
    audiogoogcurrentdelaymsmean real,
    audiogoogcurrentdelaymsmax real,
    audiogoogcurrentdelaymsmin real,
    audiogoogcurrentdelaymsvariance real,

    audiopacketssentmean real,
    audiopacketssentmax real,
    audiopacketssentmin real,
    audiopacketssentvariance real,
    audiobytessentmean real,
    audiobytessentmax real,
    audiobytessentmin real,
    audiobytessentvariance real,

    audiopacketsreceivedmean real,
    audiopacketsreceivedmax real,
    audiopacketsreceivedmin real,
    audiopacketsreceivedvariance real,
    audiobytesreceivedmean real,
    audiobytesreceivedmax real,
    audiobytesreceivedmin real,
    audiobytesreceivedvariance real,
    audiopacketslostmean real,
    audiopacketslostmax real,
    audiopacketslostmin real,
    audiopacketslostvariance real,

    videogoogframewidthsentmax real,
    videogoogframewidthsentmin real,
    videogoogframewidthsentmode real,
    videogoogframeheightsentmax real,
    videogoogframeheightsentmin real,
    videogoogframeheightsentmode real,

    videopacketssentmean real,
    videopacketssentmax real,
    videopacketssentmin real,
    videopacketssentvariance real,
    videobytessentmean real,
    videobytessentmax real,
    videobytessentmin real,
    videobytessentvariance real,

    videogoogframewidthreceivedmax real,
    videogoogframewidthreceivedmin real,
    videogoogframewidthreceivedmode real,
    videogoogframeheightreceivedmax real,
    videogoogframeheightreceivedmin real,
    videogoogframeheightreceivedmode real,

    videopacketsreceivedmean real,
    videopacketsreceivedmax real,
    videopacketsreceivedmin real,
    videopacketsreceivedvariance real,
    videobytesreceivedmean real,
    videobytesreceivedmax real,
    videobytesreceivedmin real,
    videobytesreceivedvariance real,
    videopacketslostmean real,
    videopacketslostmax real,
    videopacketslostmin real,
    videopacketslostvariance real,

    videogoogcpulimitedresolutionmean real,
    videogoogcpulimitedresolutionmax real,
    videogoogcpulimitedresolutionmin real,
    videogoogcpulimitedresolutionmode real,
    videogoogbandwidthlimitedresolutionmean real,
    videogoogbandwidthlimitedresolutionmax real,
    videogoogbandwidthlimitedresolutionmin real,
    videogoogbandwidthlimitedresolutionmode real,

    audiocodec character varying(64),
    videocodec character varying(64),

    websocketconnectiontime integer,
    sendingduration integer,
    websocketerror character varying(255),
    active integer,
    firstcandidatepairlocalnetworktype character varying(255),
    timeforfirstsetremotedescription integer,
);
