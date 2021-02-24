# rtcstats protocol v3.0
Protocol description for the rtcstats-server websocket endpoint version 3.0.
## Usage
The transport layer is provided by a websocket connection (secure or not depending on the config).

Websocket negotiation should provide a protocol version via the `Sec-WebSocket-Protocol` header, containing the protocol version prefixed by the statistics format, as described bellow.
 - `Sec-WebSocket-Protocol: X.X_LEGACY`  For google chrome legacy webrtc statistics
 - `Sec-WebSocket-Protocol: X.X_STANDARD` For standard compliant webrtc statistics
 - `Sec-WebSocket-Protocol: X.X_JVB`  For statistics send by the jitsi video bridge

Where X.X should be the protocol format to be used.
E.g. if a client wants to send legacy statistics using the 3.0 protocol, the following header would be send  when negotiating the websocket: `Sec-WebSocket-Protocol: 3.0_LEGACY`.
The protocol version is provided so we can have backwards compatibility between future iterations that might brake the initial API.
## API
Default request message format, JSON:
```javascript
{
	clientId: String, // mandatory
	data: Object/String, // optional depending on request
	type: String // mandatory
}
```
- `data` can have different meanings depending on the message type as described in a subsequent section.
- `clientId` associates a request with a statistics dump, the value is a client side generated uuid v4. This allows for sending stats associated with different entities on the same websocket.
- `type` determines the request type being sent.

### identity request
Contains data that will allow clients to correlate generated statistic dumps with participants/conferences, plus any usefull metadata. The entirety of `data` will be added to the dump file, also some fields will be pushed to dyanamodb, if configured.

In this case data will have the following format:
```javascript
{
	type: "identity",
	clientId: String,
	data:  {
	    applicationName: String, // mandatoy
        confID: String, // mandatory
        displayName: String, // optional
        meetingUniqueId: String, // optional
        ... // additional metadata we want associated with a dump
    }
}
```
The specified fields will be persisted to dynamodb under the following schema:
```javascript
{
    conferenceId: String, // associated with confID
    dumpId: String, // assciated with clientId
    baseDumpId: String, // associated with clientId
    userId: String, // associated with displayName
    app: String, // associated with applicationName
    sessionId: String, // associated with meetingUniqueId
    startDate: Number, // date at which client connected to rtcstats-server
    endDate: Number // date at which client closed the statistics dump.
}
```
Sample request:
```javascript
{
	type: "identity",
	clientId: "3bc291e8-852e-46da-bf9d-403e98c6bf3c",
	data:  {
		confID: "RandomConferenceNameIsRandom",
		displayName: "John Doe",
		applicationName: "Jitsi Meet",
		meetingUniqueId: "d823kas-32fvb-4551-ggq1-d3mc1k1cpmmc",
        domain: "meet.jit.si"
		… // additional metadata we want associated with a dump
    }
}
```
### stats-entry request
The data value of this request will be saved in the dump file as is, so in order to avoid deserializing large objects unecessarely it needs to be a string.
```javascript
{
	type: "stats-entry",
	clientId: String,
	data: String
}
```
Most clients will want to send an object, so it first needs to be encoded into a string (i.e. using `JSON.stringify()`) added to the request object and then send via the websocket which will require an additional string encode.
Sample request:
```javascript
{
	type: "stats-entry",
	clientId: "3bc291e8-852e-46da-bf9d-403e98c6bf3c",
	data: "[\n\"getstats\", \n\"PC_0\", \n{\"8dc5feb0\":{ \n\"timestamp\": 1604057071438, \"bytesReceived\": 83363,\"bytesSent\": 9313547, \"lastPacketReceivedTimestamp\": 363635983420, \"lastPacketSentTimestamp\": 363635983428}}, \n1604057071458\n]\n"
}
```
### close request
 Mark a specific `clientId` as done. This means that feature extraction will first run on it depending on the type. For the time being JVB dumps might not go through this step. The second step involves having the dump archived and uploaded to s3, push the features to amplitude and identity metadata to dynamo.
 Sample request:
 ```javascript
{
	type: "close",
	clientId: "3bc291e8-852e-46da-bf9d-403e98c6bf3c",
}
 ```
 ### keepalive request
 A connection will expire after 60 seconds if no requests are sent. The same applies for statistic dumps associated with `clientId`, if no requests are sent for it, the server will trigger a close.
 Sample request:
```javascript
{
	type: "keepalive",
	clientId: "3bc291e8-852e-46da-bf9d-403e98c6bf3c",
}
 ```
