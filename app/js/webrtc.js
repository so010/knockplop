"use strict";
var localVideo;
var localStream;
var socket;
var participantList={};
var videoContainer,videoContainerChanged,bigVideoContainer;
var room;
var dragLastOver,dragSource;
var hidingElementsStatus = "visible";
var restTURN;
var fadeOutTimer;

function redrawVideoContainer () {
  videoContainer.style.display = 'none'
  setTimeout(function(){videoContainer.style.display = 'inline-block'},10);
}

function getUserMediaSuccess(stream) {
    localStream = stream;
    participantList["localVideo"] = {};
    addStream( stream, "localVideo" );
    initSocket();
}

function RttTester (callback,turnServer){
  var dataChannelOptions = {
    ordered: false, 
    maxRetransmits: 0,
  }
  this.pingTime = 0
  this.pingCount = 0
  this.rtt = null
  this.pongTime = 0
  this.pingTimer
  this.watchDogCounter = 0
  this.watchDogTimeoutStartValue = 1000
  this.watchDogTimeout = this.watchDogTimeoutStartValue
  this.turnServer = turnServer

  this.setStatus = function(status){
    this.turnServer.status = status;
  //  console.log('rttTester: ' + this.turnServer.urls + ' status changed: ' + status) 
    if ( status == 'tested' || status == 'disabled') {
      this.turnServer.rtt = this.rtt
      callback(this.turnServer)
      return
    }
  }

  this.gotLocalIceCandidate = function(e){
    if ( e.candidate ) {
      // filter only for the relay candidate:
      if ( e.candidate.candidate.indexOf('relay') !== -1 ) {
 //       console.log('addIceCandidate to remotePC:',e.candidate.candidate,this.turnServer.urls);
        this.remotePC.addIceCandidate(e.candidate)
      }
    }
  }

  this.gotRemoteIceCandidate = function(e){
    if ( e.candidate ) {
      // filter only for the relay candidate:
      if ( e.candidate.candidate.indexOf('relay') !== -1 ) {
  //      console.log('addIceCandidate to localPC:',e.candidate.candidate,this.turnServer.urls);
        this.localPC.addIceCandidate(e.candidate)
      }
    }
  }

  this.gotLocalDescription = function(desc){
    this.answerCreated = function(desc){
      this.remotePC.setLocalDescription(desc).then(function () {},function () {});
      this.localPC.setRemoteDescription(desc).then(function () {},function () {});
    }
    this.setRemoteDescriptionSuccess = function(desc) {
      this.remotePC.createAnswer().then(function(desc) {this.answerCreated(desc)}.bind(this), 
          function(error) { console.log('ERROR: remotePC.createAnswer()',error)});
    }
    this.localPC.setLocalDescription(desc);
    this.remotePC.setRemoteDescription(desc).then(
        function () {this.setRemoteDescriptionSuccess(desc)}.bind(this),
        function (error) {console.log('ERROR: remotePC.setRemoteDescription(desc)',error)}); 
  }

  this.iceConnectionStateChanged = function(e){
//    console.log('rttTester: iceConnectionStateChanged: ' + this.turnServer.urls + ': ' + e.target.iceConnectionState)
  }

  this.watchDog = function(){
    if ( this.watchDogCounter >= 2 ) {
      this.setStatus("disabled")
      this.localPC.close()
      this.localPC = {}
      this.remotePC.close()
      this.remotePC = {}
      return
    }
    this.watchDogCounter++;
//    console.log('watchDog: ' + this.turnServer.urls + ' ' + this.watchDogCounter + '. WOOF!');
//    this.watchDogTimeout = this.watchDogTimeout + 1000;
    this.watchDogTimer = window.setTimeout(this.watchDog.bind(this), this.watchDogTimeout);
    if ( this.localPC.iceConnectionState == 'connected'  ) {
      this.startPing.bind(this);
    }
  }

  this.startPing = function(){
    var d = new Date();
    var pingStart = d.getTime()
    this.localDataChannel.send(JSON.stringify(pingStart))
//    console.log(this.turnServer.urls +': pingStart: '/
  }

  this.onDataChannel = function(event){
    this.remoteDataChannel = event.channel;
    this.remoteDataChannel.onmessage = this.receivedPing.bind(this)
  }

  this.receivedPing = function(event){
    var d = new Date(); 
    var pingEnd = d.getTime();
    var pingTime = pingEnd - JSON.parse(event.data); 
    this.remoteDataChannel.send(JSON.stringify(pingEnd))
//    console.log(this.turnServer.urls +': Ping: ' + pingTime + 'ms')
    this.pingTime = (this.pingTime * this.pingCount + pingTime) / ( this.pingCount + 1 ) 
    clearTimeout(this.watchDogTimer)
    this.watchDogTimeout = this.watchDogTimeoutStartValue
    this.watchDogTimer = window.setTimeout(this.watchDog.bind(this), this.watchDogTimeout)
  }

  this.receivedPong = function(event){
    this.watchDogCounter = 0;
    var d = new Date();
    var pongEnd = d.getTime(); 
    var pongTime = pongEnd - JSON.parse(event.data);
  //    this.pingTimer = window.setTimeout(this.startPing.bind(this), 200); 
    this.pongTime = ( this.pongTime * this.pingCount + pongTime ) / ( this.pingCount + 1 )
    var rtt = this.pingTime + this.pongTime;
    this.rtt = ( this.rtt * this.pingCount + rtt ) / ( this.pingCount + 1 )
//    console.log('rttTester: ' + this.turnServer.urls +': received Pong: ' + pongTime + 'ms -> rtt:' + this.rtt + 'ms')
    clearTimeout(this.watchDogTimer)
    this.watchDogTimeout = this.watchDogTimeoutStartValue
    this.watchDogTimer = window.setTimeout(this.watchDog.bind(this), this.watchDogTimeout)
    if ( this.pingCount < 10 ){
      this.pingCount++
      this.startPing.bind(this)()
    }
    else {
      clearTimeout(this.watchDogTimer)
      this.localPC.close()
      this.remotePC.close()
      this.setStatus('tested')
    }
  }
  this.setStatus('testing')
  if(callback && typeof callback == "function"){
    this.callback = callback;
  }
  this.localPC = new RTCPeerConnection({'iceServers':[this.turnServer]});
  this.localPC.onicecandidate = function(e) {this.gotLocalIceCandidate(e)}.bind(this) 
  this.localPC.oniceconnectionstatechange = function(e) {this.iceConnectionStateChanged(e)}.bind(this)
  this.localDataChannel = this.localPC.createDataChannel("rtt",dataChannelOptions);
  this.localDataChannel.onopen = this.startPing.bind(this);
  this.localDataChannel.onmessage = this.receivedPong.bind(this); 
  this.remotePC = new RTCPeerConnection({'iceServers':[this.turnServer]});
  this.remotePC.onicecandidate = function(e) {this.gotRemoteIceCandidate(e)}.bind(this)
  this.remotePC.ondatachannel = this.onDataChannel.bind(this);
  this.localPC.createOffer().then(
    function(offer) {this.gotLocalDescription(offer)}.bind(this),
    function (error) {console.log('ERROR: localPC.createOffer()',this.turnServer.urls,error)}.bind(this));
  this.watchDogTimer = window.setTimeout(this.watchDog.bind(this), this.watchDogTimeout);
}

var iceServerManager = {
  iceServers:[], // here put we all tested and working iceServers in
  testIceServers:[], // the array of iceServers we are going to test (queue)
  disabledIceServers:[], // iceServers that are not working 
  fastestUdpTurnServer:null, // fastest found TURN server for udp
  fastestTcpTurnServer:null, // fastest found TURN server for tcp
  callbacks:[], // array of callback functions

  restart : function(callback){
    this.fastestUdpTurnServer = null
    this.fastestTcpTurnServer = null
    var servers = this.iceServers.splice(0,this.iceServers.length - 1)
    for ( var i = 0 ; i < this.disabledIceServers.length; i++ ) {
      servers.push(this.disabledIceServers.splice(i,1)[0])
    }
    this.startTesting(servers,callback)
  },

  startTesting : function(iceServers,callback){ 
    if(callback && typeof callback == "function"){
      this.callbacks.push(callback)
    }
    if ( iceServers.length == 0 ) return
    var workerCount = 20 // number of max peerconnection to open for testing
    //  no STUN-server testing yet so just moving them to iceServers array:    
    for ( var i = 0 ; i < iceServers.length; i++ ) {
      if ( iceServers[i].urls.indexOf('stun') != -1 ) {
        this.iceServers.push(iceServers.splice(i,1)[0])
      }
    }
    // pushing iceServers to my local testIceServers array for later use    
    Array.prototype.push.apply(this.testIceServers,iceServers)
    // TURN Server testing: not all at the same time to reduce network issues and Firefox problems with to many PeerConnections
    for ( var i = 1; i <= workerCount; i++ ){
      this.turnServerTest()
    }
  },

  onTurnServerTested : function(turnServer){
    if ( turnServer.status == 'tested' ) { 
      this.iceServers.push(turnServer)
      if ( turnServer.urls.indexOf('udp') != -1 ) {
        if ( this.fastestUdpTurnServer == null || turnServer.rtt < this.fastestUdpTurnServer.rtt ) {
          this.fastestUdpTurnServer = turnServer
        }
      } else { // tcp
        if ( this.fastestTcpTurnServer == null || turnServer.rtt < this.fastestTcpTurnServer.rtt ) {
          this.fastestTcpTurnServer = turnServer
        }
      }
    }
    else { 
      if ( turnServer.status == 'disabled' ) {
        this.disabledIceServers.push(turnServer)
      }
    }
    delete turnServer.rttTester
    console.log ( 'onTurnServerTested: ' + turnServer.urls + ' status: ' + turnServer.status + ' rtt: ' + turnServer.rtt) 
    // test next Server
    this.turnServerTest()
  },

  turnServerTest : function(){
    console.log('turnServerTest 1 worker started, testQueue: ' + 
                this.testIceServers.length + ' tested: ' + 
                this.iceServers.length) 
    if ( this.testIceServers.length == 0 ) {
      if ( this.callbacks.length == 0 ) {
        return
      }
      else { // call all callbacks
        while ( this.callbacks.length > 0 ) {
          this.callbacks.pop()()
        }
        return
      }
    }
    var testIceServer = this.testIceServers.shift()
    console.log('turnServerTest: ' + testIceServer.urls) 
    if ( testIceServer.urls.indexOf('turn') != -1 ) { // TURN-servers only
      testIceServer.rttTester = new RttTester(this.onTurnServerTested.bind(this), testIceServer)
    }
    else{ // this should not happen(all STUN servers should be moved before this is executed) but you never know
      this.iceServers.push(testIceServer)
      this.turnServerTest()
    }
  },

// this returns all known TURN servers including STUN []
  getIceServers : function(){
    var servers = []
    for ( var i in this.iceServers ) {
    var server = {}
      server.urls = this.iceServers[i].urls
      if ( typeof this.iceServers[i].credential != 'undefined' ) server.credential = this.iceServers[i].credential
      if ( typeof this.iceServers[i].username != 'undefined' ) server.username = this.iceServers[i].username
      if ( typeof this.iceServers[i].rtt != 'undefined' ) server.rtt = this.iceServers[i].rtt
      servers.push(server)
    }
    return servers
  },

// this returns all known TURN servers []
  getTurnServers : function(){
    var servers = []
    for ( var i in this.iceServers ) {
      if ( this.iceServers[i].urls.indexOf('turn') != -1 ) {
        var server = {}
        server.urls = this.iceServers[i].urls
        if ( typeof this.iceServers[i].credential != 'undefined' ) server.credential = this.iceServers[i].credential
        if ( typeof this.iceServers[i].username != 'undefined' ) server.username = this.iceServers[i].username
        if ( typeof this.iceServers[i].rtt != 'undefined' ) server.rtt = this.iceServers[i].rtt
        servers.push(server)
      }
    }
    return servers
  },


// this returns one UDP-TURN, one TCP-TURN and one STUN server []
// , returned TURN servers are the ones with fastest measured round trip time
  getFastestIceServers : function() {
    var servers = []
    // get one stunserver:
    var i = 0
    while ( ( this.iceServers[i].urls.indexOf('stun') == -1 ) && ( i < this.iceServers.length - 1 ) ) { i++ }
    if ( i < this.iceServers.length ) servers.push(this.iceServers[i])
    // and the fastest udp TURN server:
    if ( this.fastestUdpTurnServer != null) servers.push(this.fastestUdpTurnServer)
    // and the fastest tcp TURN server:
    if ( this.fastestTcpTurnServer != null) servers.push(this.fastestTcpTurnServer)
    return servers
  },

// this returns one UDP-TURN and one TCP-TURN server [], no STUN Server here included
// returned TURN servers are the ones with fastest measured round trip time
  getFastestTurnServers : function() {
    var servers = []
    // get the fastest udp TURN server:
    if ( this.fastestUdpTurnServer != null) servers.push(this.fastestUdpTurnServer)
    // and the fastest tcp TURN server:
    if ( this.fastestTcpTurnServer != null) servers.push(this.fastestTcpTurnServer)
    return servers
  },
}

function mirrorMe () {
  var participant = new Object();
  participant.pid = 'mirrorReceiver'
  participant.turn = iceServerManager.getFastestTurnServers()
  callParticipant(participant)
}

function initSocket() {
  socket = io('https://' + document.domain + ':' + document.location.port);
  socket.on('connection',function(socket){
    console.log('Socket connected!');
  });
  socket.on('restTURN',function(msg){
    if ( msg.restTURN != null ) {
      console.log('received restTURN from server :)');
      var restTURN = msg.restTURN;
      var testIceServers = []
      for (var j in restTURN.urls) {
        var turnServer = {};
        turnServer.username = restTURN.username;
        turnServer.credential = restTURN.credential;
        turnServer.urls = restTURN.urls[j]
        testIceServers.push(turnServer);
        console.log(turnServer.urls);
      }
      iceServerManager.startTesting(testIceServers,function(){socket.emit('ready',{'room':room,'turn':iceServerManager.getFastestTurnServers()})});
    }
    else {
      console.log('received empty restTURN config from server :(');
    }
  });
  socket.on('sdp',function(msg){
    // Only create answers in response to offers
    console.log('received sdp from',msg.pid,msg.turn);
    receivedDescription(msg)
  });
  socket.on('iceCandidate',function(msg){
    console.log('got iceCandidate from %s: %s',msg.pid, msg.candidate.candidate );
    participantList[msg.pid].peerConnection.addIceCandidate(new RTCIceCandidate(msg.candidate)).catch(errorHandler);
  });
  socket.on('participantReady',function(msg){
    console.log('got participantReady:',msg );
    callParticipant(msg);
  });
  socket.on('bye',function(msg){
    console.log('got bye from:',msg.pid );
    deleteParticipant(msg.pid);
  });
  socket.on('participantDied',function(msg){
    console.log('received participantDied from server: removing participant from my participantList');
    deleteParticipant(msg.pid);
  });

  window.onunload = function(){socket.emit('bye')};
}

function callParticipant(msg) {
    participantList[msg.pid] = {};
    participantList[msg.pid].peerConnectionConfig = {}
    participantList[msg.pid].peerConnectionConfig.iceServers = iceServerManager.getFastestIceServers()
    if ( typeof(msg.turn) != 'undefined') {
      participantList[msg.pid].turn=msg.turn;
      participantList[msg.pid].peerConnectionConfig.iceServers = 
        participantList[msg.pid].turn.concat(participantList[msg.pid].peerConnectionConfig.iceServers)
    }
    participantList[msg.pid].peerConnection = new RTCPeerConnection(participantList[msg.pid].peerConnectionConfig);
    participantList[msg.pid].peerConnection.onicecandidate = function (event){gotIceCandidate(event.candidate,msg.pid)};
    participantList[msg.pid].peerConnection.onaddstream = function (event){addStream(event.stream,msg.pid)};
    participantList[msg.pid].peerConnection.addStream(localStream);
    participantList[msg.pid].peerConnection.createOffer().then(function (description){createdDescription(description,msg.pid)}).catch(errorHandler);
}

function deleteParticipant(pid){
  if (typeof(participantList[pid]) != 'undefined'){
    console.log('removing participant: ',pid)
    participantList[pid].peerConnection.close();
    participantList[pid].videoDiv.parentNode.removeChild(participantList[pid].videoDiv);
    delete participantList[pid];
  }
  else{
    console.log('removing participant: participant does not exist: ',pid)
  }
}

function receivedDescription(msg){
  if(msg.sdp.type == 'offer') {
    participantList[msg.pid]={};
    participantList[msg.pid].peerConnectionConfig = {}
    participantList[msg.pid].peerConnectionConfig.iceServers = iceServerManager.getFastestIceServers()
    if ( typeof(msg.turn) != 'undefined' ) {
      participantList[msg.pid].turn = msg.turn;
      participantList[msg.pid].peerConnectionConfig.iceServers =
        participantList[msg.pid].turn.concat(participantList[msg.pid].peerConnectionConfig.iceServers)
    }
    participantList[msg.pid].peerConnection = new RTCPeerConnection(participantList[msg.pid].peerConnectionConfig)
    participantList[msg.pid].peerConnection.onicecandidate = function (event){gotIceCandidate(event.candidate,msg.pid)};
    participantList[msg.pid].peerConnection.onaddstream = function (event){addStream(event.stream,msg.pid)};
    if ( msg.pid.indexOf('mirrorSender') == -1 ){ // just receiving mirror stream
      participantList[msg.pid].peerConnection.addStream(localStream)
    }
    participantList[msg.pid].peerConnection.setRemoteDescription(new RTCSessionDescription(msg.sdp))
    participantList[msg.pid].peerConnection.createAnswer().then(function (description){createdDescription(description,msg.pid)}).catch(errorHandler);
  }
  else if (msg.sdp.type == 'answer') {
    participantList[msg.pid].peerConnection.setRemoteDescription(new RTCSessionDescription(msg.sdp))
  }

}

function gotIceCandidate(candidate, pid) {
  if(candidate != null) {
    console.log('send gathered iceCandidate:%s to %s',candidate.candidate, pid);
    if ( pid.indexOf('mirror') == -1 ){ // send all candidates that are not mirror 
      socket.emit('iceCandidate',{'candidate':candidate,'pid':pid});
    }
    else{ // candidates from mirroring set we directly ( but only relay candidates ) 
      if ( candidate.candidate.split("typ")[1].split(" ",2 )[1] == 'relay' )  {
        if (pid == 'mirrorReceiver') { pid = 'mirrorSender' }
        else { pid = 'mirrorReceiver' }
        participantList[pid].peerConnection.addIceCandidate(new RTCIceCandidate(candidate)).catch(errorHandler);
      }
    }
  }
}

function createdDescription(description,pid) {
  console.log('created localDescription sending to', pid);
  var msg = {};
  if ( description.type == 'offer' ){
    msg.turn = iceServerManager.getFastestTurnServers() // sending my own TURN servers along
  }
  participantList[pid].peerConnection.setLocalDescription(description).then(function() {
	  msg.sdp = participantList[pid].peerConnection.localDescription
	  msg.pid = pid
    // mirroring description are not sent via signalling server but managed locally:
    if ( pid.indexOf('mirror') == -1 ){ 
      socket.emit('sdp',msg)
      console.log('sending message:',msg)
    } else {
       // changing sender <> receiver ( this is what the signalling server would doing otherwise ):
      if (pid == 'mirrorReceiver') { msg.pid = 'mirrorSender' }
      else { msg.pid = 'mirrorReceiver' } 
      receivedDescription(msg)
    }
  }).catch(errorHandler)
}

function addStream( stream, pid ) {
  var videoDiv = document.getElementById("templateVideoDiv").cloneNode(true);
  participantList[pid].mediaStream = stream;
  var video = document.createElement('video');
  video.srcObject = stream;
  video.autoplay = true;
  if ( pid == "localVideo" ) {
    video.muted = true;
    videoDiv.style.height = "100%";
    video.style.cssText = "-moz-transform: scale(-1, 1); \
      -webkit-transform: scale(-1, 1); -o-transform: scale(-1, 1); \
      transform: scale(-1, 1); filter: FlipH;";
  } else {
  videoDiv.style.opacity = "0"; // invisible until layout is settled
  }
  videoDiv.appendChild(video);
  var lastVideoDiv = videoContainer.lastElementChild;
  videoContainer.appendChild(videoDiv);
  videoDiv.addEventListener("drop",drop);
  videoDiv.addEventListener("dragstart",dragStart);
  videoDiv.addEventListener("dragover",allowDrop);
  videoDiv.addEventListener("dragend", dragEnd);
  videoDiv.addEventListener("dragleave", dragLeave);
  videoDiv.addEventListener("dragenter", dragEnter);
  videoDiv.draggable="true";
  videoDiv.id = pid;
  participantList[pid].videoDiv = videoDiv;
  if ( lastVideoDiv ) {
    videoDiv.style.height =  lastVideoDiv.style.height;
  }
  videoDiv.classList.remove('hidden');
  fadeOutTimer = window.setTimeout(fadeOutElements, [4000],pid);
}

function forceRedraw (element){
  var disp = element.style.display;
  element.style.display = 'none';
  var trick = element.offsetHeight;
  element.style.display = disp;
};

function muteAudio(pid){
  var muteIcon = document.getElementById(pid).getElementsByClassName('audioMuteIcon')[0];
  var unMuteIcon = document.getElementById(pid).getElementsByClassName('audioUnMuteIcon')[0];
  participantList[pid].mediaStream.getAudioTracks()[0].enabled = false;
  muteIcon.classList.remove('hidden');
  unMuteIcon.classList.add('hidden');
}

function unMuteAudio(pid){
  var muteIcon = document.getElementById(pid).getElementsByClassName('audioMuteIcon')[0];
  var unMuteIcon = document.getElementById(pid).getElementsByClassName('audioUnMuteIcon')[0];
  participantList[pid].mediaStream.getAudioTracks()[0].enabled = true;
  muteIcon.classList.add('hidden');
  unMuteIcon.classList.remove('hidden');
}

function unMuteVideo(pid){
  var muteIcon = document.getElementById(pid).getElementsByClassName('videoMuteIcon')[0];
  var unMuteIcon = document.getElementById(pid).getElementsByClassName('videoUnMuteIcon')[0];
  participantList[pid].mediaStream.getVideoTracks()[0].enabled = true;
  muteIcon.classList.add('hidden');
  unMuteIcon.classList.remove('hidden');
}

function muteVideo(pid){
  var muteIcon = document.getElementById(pid).getElementsByClassName('videoMuteIcon')[0];
  var unMuteIcon = document.getElementById(pid).getElementsByClassName('videoUnMuteIcon')[0];
  participantList[pid].mediaStream.getVideoTracks()[0].enabled = false;
  muteIcon.classList.remove('hidden');
  unMuteIcon.classList.add('hidden');
}

function setBigVideo(pid){
  if ( bigVideoContainer.getElementsByTagName('video').length != 0 ){
    bigVideoContainer.removeChild( bigVideoContainer.getElementsByTagName('video')[0] );
  }
  var video = document.createElement('video');
  video.srcObject = participantList[pid].mediaStream;
  video.autoplay = true;
  if ( pid == "localVideo" ) {
    video.muted = true;
    video.style.cssText = "-moz-transform: scale(-1, 1); \
      -webkit-transform: scale(-1, 1); -o-transform: scale(-1, 1); \
      transform: scale(-1, 1); filter: FlipH;";
  }
  videoContainer.style.top = "80%";
  bigVideoContainer.appendChild(video);
  var exitBigVideoIcon = document.getElementById('bigVideoContainer').getElementsByClassName('exitBigVideoIcon')[0];
  exitBigVideoIcon.classList.remove('hidden');
}

function exitBigVideo(){
  console.log('exitBigVideo()');
  if ( bigVideoContainer.getElementsByTagName('video').length != 0 ){
    bigVideoContainer.removeChild( bigVideoContainer.getElementsByTagName('video')[0] );
  }
  videoContainer.style.top = "0%";
  var bigVideoIcon = document.getElementById('bigVideoContainer').getElementsByClassName('bigVideoIcon')[0];
  var exitBigVideoIcon = document.getElementById('bigVideoContainer').getElementsByClassName('exitBigVideoIcon')[0];
  exitBigVideoIcon.classList.add('hidden');
}

function toggleFullScreen() {
  var element = document.documentElement;
  // Supports most browsers and their versions.
  var requestFullscreen = element.requestFullScreen ||
                      element.webkitRequestFullScreen ||
                      element.mozRequestFullScreen;
  if (requestFullscreen) { // Native full screen.
    var fullscreenElement = document.fullscreenElement ||
                            document.webkitFullscreenElement ||
                            document.mozFullScreenElement;
    var exitFullscreen = document.exitFullscreen ||
                         document.mozCancelFullScreen ||
                         document.webkitExitFullscreen;
    var fullscreenIcon = document.getElementById('bigVideoContainer').
                         getElementsByClassName('fullscreenIcon')[0];
    var exitFullscreenIcon = document.getElementById('bigVideoContainer').
                             getElementsByClassName('exitFullscreenIcon')[0];
    if (!fullscreenElement) {
      requestFullscreen.call(element);
      exitFullscreenIcon.classList.remove('hidden');
      fullscreenIcon.classList.add('hidden');
    } else {
      exitFullscreen.call(document);
      fullscreenIcon.classList.remove('hidden');
      exitFullscreenIcon.classList.add('hidden');
    }
  }
}

function unHideOpaqueElements(container){
  var children = container.children
  for(var i=0;i < children.length ;i++){
    if ( children[i].style.opacity == '0'  ) { children[i].style.opacity = '1' }
  }

}

// checks if the last videoDiv fits on the screen
// checks if there is to much space between bottom of last videoDiv and bottom of screen
// and scale videoDiv height up or down
function checkVideoContainer(){
  var last = videoContainer.lastElementChild;
  if ( last == null ) {
    window.setTimeout(checkVideoContainer, 1000 );
    return;
  }
  var height = last.style.height.split("%")[0] / 100; // 1 = 100%
  // only if last element's video is connected otherwise wait
  if ( ( last.getElementsByTagName("video")[0].networkState == 2 ||
         last.getElementsByTagName("video")[0].networkState == 1 ) ) {
    // if last element is out of window:
    var videoDivList = videoContainer.getElementsByClassName("videoDiv")
    if ( last.getBoundingClientRect().bottom > window.innerHeight ) {
      for(var i=0;i<videoDivList.length;i++){
        videoDivList[i].style.height =
          ( 100 / ( ( 1 / height ) + 0.1 ) ) + "%"
      }
      videoContainerChanged = true;
      window.setTimeout(checkVideoContainer,20 );
    // if there is enough space in the bottom AND in the left
    } else if ( ( ( window.innerHeight - last.getBoundingClientRect().bottom ) >
                    ( window.innerHeight * 0.1 ) ) &&
                  ( ( videoContainer.firstElementChild.getBoundingClientRect().left ) >
                    ( window.innerWidth * 0.012 ) ) ) {
        for(i=0;i<videoDivList.length;i++){
          videoDivList[i].style.height = height * 100 +
            ( ( videoContainer.firstElementChild.getBoundingClientRect().left -
                window.innerWidth * 0.01 ) * 100 / window.innerWidth * 0.99 ) / 10 + "%"
        }
        videoContainerChanged = true;
        unHideOpaqueElements(videoContainer)
        window.setTimeout(checkVideoContainer,20 );
    } else {
        // check if videoContainer was modified before so it should be finished
        // now - so we can redraw it ( because chrome live rendering is not perfect )
        if ( videoContainerChanged == true ) {
          forceRedraw(videoContainer)
        }
        unHideOpaqueElements(videoContainer)
        window.setTimeout(checkVideoContainer, 200 ); // standard recheck timeframe
        videoContainerChanged = false;
    }
  } else {
      // wait until new video stream for last participant is settled
      window.setTimeout(checkVideoContainer, 200 );
  }
}

function dragLeave( ev ) {
  console.log("dragLeave")
//   event.target.style.padding = "1px";
}

function dragEnter( ev ) {
  if ( this.id == dragLastOver ) {return};
  console.log("dragEnter",this.id, ev.dataTransfer.getData("text") )
  var videoList = videoContainer.getElementsByTagName("video")
  for(var i=0;i<videoList.length;i++)
    { videoList[i].style.padding = "1px" }
  dragLastOver = this.id;
}

function dragEnd ( ev ) {
    // reset the transparency and padding of drag source and size of videoContainer
    ev.target.style.opacity = "";
    var videoList = videoContainer.getElementsByTagName("video")
    for(var i=0;i<videoList.length;i++)
          { videoList[i].style.padding = "1px" }
}

function allowDrop(ev) {
    ev.preventDefault();
    if ( this.id == dragSource ) {return};
    var element = document.getElementById(this.id);
    var elementVideo = element.getElementsByTagName("video")[0]

    var destElement = document.getElementById(this.id);
    var destElementVideo = destElement.getElementsByTagName("video")[0]

    if ( ev.offsetX > destElementVideo.offsetWidth / 2 ) {
      if ( destElement.nextSibling == null ){ // insert at end
        videoContainer.appendChild(document.getElementById( dragSource ) )
      } else { // insert before next element
        videoContainer.insertBefore(document.getElementById( dragSource ),
          destElement.nextSibling);
      }
    } else { // insert here
      videoContainer.insertBefore(document.getElementById(dragSource), element);
    }
    document.getElementById(dragSource).getElementsByTagName("video")[0].play();
}

function dragStart(ev) {
  ev.dataTransfer.setData( "text", ev.target.id );
  ev.dataTransfer.effectAllowed = 'move';
  var video = document.getElementById(ev.target.id).getElementsByTagName("video")[0];
  dragSource = ev.target.id;
  ev.dataTransfer.setDragImage(video,20,20);
  console.log("drag start! ",ev.target)
}

function drop(ev) {
    ev.preventDefault();
    if ( this.id == dragSource ) {return};
    var data = ev.dataTransfer.getData("text");
    var destElement = document.getElementById(this.id);
    var destElementVideo = destElement.getElementsByTagName("video")[0];

    if ( ev.offsetX > destElementVideo.offsetWidth / 2 ) {
      if ( destElement.nextSibling == null ){ // insert at end
        videoContainer.appendChild(document.getElementById( data ) )
      } else { // insert before next element
        videoContainer.insertBefore(document.getElementById( data ), destElement.nextSibling);
      }
    } else { // insert here
      videoContainer.insertBefore(document.getElementById(data), destElement);
    }
    document.getElementById(data).getElementsByTagName("video")[0].play();
    document.getElementById(data).style.opacity = "1";
}
function fadeOutElements(pid) {
  $(document.getElementById(pid).getElementsByClassName('fadeOutElements')).fadeOut();
  participantList[pid].hidingElementsStatus = "hidden"
}

function fadeInElements(pid) {
  $(document.getElementById(pid).getElementsByClassName('fadeOutElements')).fadeIn("fast");
  participantList[pid].hidingElementsStatus = "visible";
  participantList[pid].fadeOutTimer = window.setTimeout(fadeOutElements, [4000],pid);
}

function onMouseMoveAction(pid) {
  console.log(pid);
  if ( participantList[pid].hidingElementsStatus === "hidden" ) {
    fadeInElements(pid);
  }
  window.clearTimeout(participantList[pid].fadeOutTimer);
  participantList[pid].fadeOutTimer = window.setTimeout(fadeOutElements, [4000],pid);
}

function toggleStickyness(pid) {
  $("#"+pid).toggleClass("fadeOutElements");
  $("#stickyButton").toggleClass("black");
}



function errorHandler(error) {
    console.log(error.code);
}

function pageReady() {
  // getting some HTML-elements we need later and roomname:
  room = document.URL.split("/")[3];
  localVideo = document.getElementById('localVideo');
  videoContainer = document.getElementById('videoContainer');
  bigVideoContainer = document.getElementById('bigVideoContainer');

  // move initially configured ICE servers to testing before we use them
  if ( typeof(peerConnectionConfig.iceServers) != 'undefined' && peerConnectionConfig.iceServers.length > 0 ) {
    iceServerManager.startTesting(peerConnectionConfig.iceServers)
  }

  var constraints = {
    audio: true,
    video: {
        "width": {"min": "50","ideal":"1280",  "max": "1920"},
        "height": {"min": "50","ideal":"768",  "max": "1050"}
      }
  };

  // get camera and mic:
  if(navigator.mediaDevices.getUserMedia) {
      navigator.mediaDevices.getUserMedia(constraints).then(getUserMediaSuccess).catch(errorHandler);
  } else {
      alert('Your browser does not support getUserMedia API: sorry you can\'t use this service');
  }

  window.addEventListener('resize', redrawVideoContainer);
  window.setTimeout(checkVideoContainer, 2500);
}


