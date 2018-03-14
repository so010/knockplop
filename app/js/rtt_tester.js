"use strict";

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
  this.watchDogTimeoutStartValue = 2600
  this.watchDogTimeout = this.watchDogTimeoutStartValue
  this.turnServer = turnServer

  this.setStatus = function(status){
    this.turnServer.status = status;
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
    if ( this.watchDogCounter >= 1 ) {
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
    this.pongTime = ( this.pongTime * this.pingCount + pongTime ) / ( this.pingCount + 1 )
    var rtt = this.pingTime + this.pongTime;
    this.rtt = ( this.rtt * this.pingCount + rtt ) / ( this.pingCount + 1 )
    clearTimeout(this.watchDogTimer)
    this.watchDogTimeout = this.watchDogTimeoutStartValue
    this.watchDogTimer = window.setTimeout(this.watchDog.bind(this), this.watchDogTimeout)
    if ( this.pingCount < 15 ){
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
