# rtcstats-server

The rtcstats-server represents the server side component of the rtcstats ecosystem, the client side being
https://github.com/jitsi/rtcstats which collects and sends WebRTC related statistics.

## Requirements

- node v12 or above
- npm v6 or above

## Architecture

Comming soon...

## How to use
### Run
```
$ npm install
$ npm run start
```
### Configure
The server is configured using the node [config](https://github.com/jitsi/rtcstats-server/blob/master/config/) module thus it will use one of the available config yaml files
found under the ./config directory in accordance to the NODE_ENV (debug|production) environment variable.

Default values can be seen here [default](https://github.com/jitsi/rtcstats-server/blob/master/config/default.yaml).

There are also some additional env variables that can be set in order do overwrite config options from
the command line, these can be found here [custom-env-var](https://github.com/jitsi/rtcstats-server/blob/master/config/custom-environment-variables.yaml)

### Configure feature database connector.
One function of the server is to extract a feature set from the gathered stats, these extracted features
are then sent do a database endpoint of some sort, such as bigquery, firehose or amplitude.

Bellow is a list of the current supported features:
```
# Features that describe statistics pertaining to client specific actions like getUserMedia and the
# associated options.
client:
	# url that started the connection
	origin
	# Probably not needed at this point
	# Object type, enabling it will generate the following substats:
	# - browserName
	# - browserVersion
	# - browserOs
	# - browserUserAgent
	# - browserNameVersion
	# - browserNameOs
	# - browserNameVersionOs
	browser
	# did the page call getUserMedia at all?
	calledGetUserMedia
	# did the page use the old getUserMedia?
	calledLegacyGetUserMedia
	# did the page use the new navigator.mediaDevices.getUserMedia?
	calledMediadevicesGetUserMedia
	# was there at least one getUserMedia success?
	getUserMediaSuccess
	# was there at least one getUserMedia error? If so, what was the error?
	getUserMediaError
	# did the client ever request audio?
	calledGetUserMediaRequestingAudio
	# did the client ever request video (not screenshare)?
	# screensharing is defined as
	#      mozMediaSource || mediaSource in FF (look for window || screen?)
	#      mandatory.chromeMediaSource: desktop in chrome
	calledGetUserMediaRequestingVideo
	# did the client ever request the screen?
	# also returns the type even though (in chrome) that is not relevant.
	calledGetUserMediaRequestingScreen
	calledGetUserMediaRequestingAEC3
	timeBetweenGetUserMediaAndGetUserMediaSuccess
	timeBetweenGetUserMediaAndGetUserMediaFailure
	# return the label of the first audio device
	firstAudioTrackLabel
	# return the label of the first video device
	firstVideoTrackLabel
	# number of peerConnections created
	numberOfPeerConnections
# RTCPeerConnection specific statistics like ICE and getStats
connection:
	# when did the session start
	startTime
	# when did the session end
	stopTime
	# how long did the peerconnection live?
	# not necessarily connected which is different from session duration
	lifeTime
	# Time in which the connection was in a potential sending state. Calculated
	# as the difference between the first setLocalDescription call and the last PC log.
	sendingDuration
	# the webrtc platform type -- webkit or moz
	browserType
	# check if we are initiator/receiver (i.e. first called createOffer or createAnswer)
	# this likely has implications for number and types of candidates gathered.
	isInitiator
	# was the peerconnection configured properly?
	# basically check if RTCPeerConnection was created with config parameters
	configured
	# were ice servers configured? Checks if the iceServer list is empty or not.
	configuredWithICEServers
	# was STUN configured in the peerconnection config?
	configuredWithSTUN
	# was TURN (any kind) configured in the peerconnection config?
	configuredWithTURN
	# was TURN/UDP configured in the peerconnection config?
	configuredWithTURNUDP
	# was TURN/TCP configured in the peerconnection config?
	configuredWithTURNTCP
	# was TURN/TLS configured in the peerconnection config?
	configuredWithTURNTLS
	# what bundle policy was supplied?
	configuredBundlePolicy
	# SDP semantics used
	sdpSemantics
	# did ice gathering complete (aka: onicecandidate called with a null candidate)
	ICEGatheringComplete
	# was an ice failure detected.
	ICEFailure
	# was an ice failure after a successful connection detected.
	ICEFailureSubsequent
	# did ice connect/complete?
	ICEConnectedOrCompleted
	# ICE connected but connectionState indicates a DTLS failure, basically ICE process successfully completed
	# but it did not connect
	dtlsFailure
	# Firefox has a timeout of ~5 seconds where addIceCandidate needs to happen after SRD.
	# This calculates the delay between SRD and addIceCandidate which should allow
	# correlation with ICE failures caused by this.
	timeBetweenSetRemoteDescriptionAndAddIceCandidate
	# This calculates the delay between SLD and onicecandidate.
	timeBetweenSetLocalDescriptionAndOnIceCandidate
	# This calculates the time between the first SRD and resolving.
	timeForFirstSetRemoteDescription
	# determines whether the first setRemoteDescription resulted in an ontrack event.
	ontrackAfterFirstSetRemoteDescription
	# This calculates the time between the second SRD and resolving.
	timeForSecondSetRemoteDescription
	# is the session using ICE lite?
	usingICELite
	# is the session using rtcp-mux?
	usingRTCPMux
	# is the session using BUNDLE?
	usingBundle
	# was iceRestart parameter provided during a createOffer call
	ICERestart
	# was the initiated iceRestart successful
	ICERestartSuccess
	# was setRemoteDescription called after the ice restart? If not the peer
	# went away.
	ICERestartFollowedBySetRemoteDescription
	# was there a relay candidate gathered after the ice restart?
	ICERestartFollowedByRelayCandidate
	# was the signaling state stable at least once?
	signalingStableAtLeastOnce
	# was more than one remote stream added?
	usingMultistream
	# maximum number of concurrent streams
	maxStreams
	# number of remote distinct streams
	numberOfRemoteStreams
	# check to see id the local SDP has simulcast related fields.
	usingSimulcast
	# verify how many streams are part of the simulcast groups
	numberOfLocalSimulcastStreams
	# was there a setLocalDescription failure?
	setLocalDescriptionFailure
	# was there a setRemoteDescription failure?
	setRemoteDescriptionFailure
	# was there an addIceCandidate failure
	addIceCandidateFailure
	# how long did it take to gather all ice candidates?
	gatheringTime
	# cases can occur where the ICE process doesn't gather a host candidate,
	# check if at least one host was gathered.
	gatheredHost
	# was a local STUN candidate gathered?
	gatheredSTUN
	# was a local TURN/UDP relay candidate gathered?
	gatheredTURNUDP
	# how long did it take to gather a TURN/UDP relay candidate
	gatheringTimeTURNUDP
	# was a local TURN/TCP relay candidate gathered?
	gatheredTURNTCP
	# how long did it take to gather a TURN/TCP relay candidate
	gatheringTimeTURNTCP
	# was a local TURN/TLS relay candidate gathered?
	gatheredTURNTLS
	# how long did it take to gather a TURN/TLS relay candidate
	gatheringTimeTURNTLS
	# which turn server was used? returns the relay address.
	relayAddress
	# was there a remote candidate TURN added?
	hadRemoteTURNCandidate
	# what types of RFC 1918 private ip addresses were gathered?
	gatheredrfc1918address
	# estimates the number of interfaces network, by analyzing gathered host ice candidates.
	numberOfInterfaces:
	# determines how long it took to establish the connection, by checking connection state
	# changes.
	connectionTime
	# how long does it take to establish the ice connection?
	iceConnectionTime
	# how long does it take to create a local offer/answer (mostly DTLS key generation)
	localCreateDelay
	# number of local ice candidates.
	numberOfLocalIceCandidates
	# number of remote ice candidates.
	numberOfRemoteIceCandidates
	# session duration, defined by ICE states.
	sessionDuration
	# determine media types used in session.
	mediaTypes
	# dlts cipher suite used
	dtlsCipherSuite
	# srtp cipher suite used
	srtpCipherSuite
	# mean RTT, send and recv bitrate of the active candidate pair
	# Object type, enabling it will generate the following substats:
	# - statsMeanRoundTripTime
	# - statsMeanReceivingBitrate
	# - statsMeanSendingBitrate
	# - statsMeanAudioPacketsLost
	# - statsMeanVideoPacketsLost
	statsMean
	# calculate mean RTT and max RTT for the first 30 seconds of the connection
	# Object type, enabling it will generate the following substats:
	# - stunRTTInitial30sMean
	# - stunRTTInitial30sMax
	stunRTTInitial30s
	# information regarding the active candidate pair
	# Object type, enabling it will generate the following substats:
	# - firstCandidatePairType": "peerreflexive;serverreflexive",
	# - firstCandidatePairLocalType": "peerreflexive",
	# - firstCandidatePairRemoteType": "serverreflexive",
	# - firstCandidatePairLocalIPAddress": "xxx.xxx.xxx.x",
	# - firstCandidatePairRemoteIPAddress": "xxx.xxx.xxx.x",
	# - firstCandidatePairLocalTypePreference: 110,
	# - firstCandidatePairRemoteTypePreference: 100,
	# - firstCandidatePairLocalNetworkType: "lan",
	firstCandidatePair
	# How many times did the active ice candidate-pair change over time.
	numberOfCandidatePairChanges
	# how did the selected interface type change? e.g. a wifi->mobile transition
	candidatePairChangeInterfaceTypes
	# chrome specific statistic video bandwidth estimation (bweforvideo)
	# Object type, enabling it will generate the following substats
	# - bweGoogActualEncBitrateMean
	# - bweGoogActualEncBitrateMax
	# - bweGoogActualEncBitrateMin
	# - bweGoogActualEncBitrateVariance
	# - bweGoogRetransmitBitrateMean
	# - bweGoogRetransmitBitrateMax
	# - bweGoogRetransmitBitrateMin
	# - bweGoogRetransmitBitrateVariance
	# - bweGoogTargetEncBitrateMean
	# - bweGoogTargetEncBitrateMax
	# - bweGoogTargetEncBitrateMin
	# - bweGoogTargetEncBitrateVariance
	# - bweGoogBucketDelayMean
	# - bweGoogBucketDelayMax
	# - bweGoogBucketDelayMin
	# - bweGoogBucketDelayVariance
	# - bweGoogTransmitBitrateMean
	# - bweGoogTransmitBitrateMax
	# - bweGoogTransmitBitrateMin
	# - bweGoogTransmitBitrateVariance
	# - bweAvailableOutgoingBitrateMean
	# - bweAvailableOutgoingBitrateMax
	# - bweAvailableOutgoingBitrateMin
	# - bweAvailableOutgoingBitrateVariance
	# - bweAvailableIncomingBitrateMean
	# - bweAvailableIncomingBitrateMax
	# - bweAvailableIncomingBitrateMin
	# - bweAvailableIncomingBitrateVariance
	bwe
	# Was addStream called on the PC
	calledAddStream
	# Was addTrack called on the PC
	calledAddTrack
```
__Important note!!__ There are more features available, mostly related to track specific stats, but as it
stands the only enabled database endpoint is amplitude! limiting the format of a sent feature object.

Because of this limitation we can't send track specific statistics as they contain multiple nested
objects and arrays; as mentioned above amplitude doesn't play well with that type of structuring.
So for time being track stats are disabled.

### Amplitude Integration
Amplitude can be enabled by simply setting the following config value:
```
amplitude:
    key: xxxxxxxxxxxxxxxxxxx
```
Enabling Amplitude will send a `rtctats-publish` event for each RTCPeerConnection associated with a client.
Currently the extracted features sent are a hardcoded list, this will change in a future iteration.

List of features sent as an amplitude event:
```
- calledGetUserMediaRequestingScreen
- calledGetUserMediaRequestingAudio
- calledGetUserMediaRequestingVideo
- firstAudioTrackLabel
- firstVideoTrackLabel
- lifeTime
- ICEFailure
- connectionTime
- numberOfRemoteStreams
- sessionDuration
- bytesTotalSent
- bytesTotalReceived
- statsMeanRoundTripTime
- statsMeanReceivingBitrate
- statsMeanSendingBitrate
- statsMeanAudioPacketsLost
- statsMeanVideoPacketsLost
- firstCandidatePairType
- bweGoogActualEncBitrateMean
- bweGoogRetransmitBitrateMean
- bweGoogTargetEncBitrateMean
- bweGoogTransmitBitrateMean
- bweAvailableOutgoingBitrateMean
- bweAvailableIncomingBitrateMean

```
Information regarding the amplitude identity of the associated client is also sent. It's gathered
by the rtcstats client and send along with the rest of the statistics. This is required so we can associate
the rtcstats event with the amplitude events generated client side.


## Authors and acknowledgment
The project is a fork of https://github.com/fippo/rtcstats-server thus proper thanks are in order for the original
contributors.