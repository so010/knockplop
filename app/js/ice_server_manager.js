"use strict";

var iceServerManager = {
  iceServers:[], // here put we all tested and working iceServers in
  testIceServers:[], // the array of iceServers we are going to test (queue)
  disabledIceServers:[], // iceServers that are not working 
  fastestUdpTurnServer:null, // fastest found TURN server for udp
  fastestTcpTurnServer:null, // fastest found TURN server for tcp
  callbacks:[], // array of callback functions
  progressEvent:null, // this will be called for progress info
  runningTests:{}, // list of running tests

  restart : function(callback){
    this.fastestUdpTurnServer = null
    this.fastestTcpTurnServer = null
    var servers = this.iceServers.splice(0,this.iceServers.length - 1)
    for ( var i = 0 ; i < this.disabledIceServers.length; i++ ) {
      servers.push(this.disabledIceServers.splice(i,1)[0])
    }
    this.startTesting(servers,callback)
  },

  startTesting : function(iceServers,callback,progressEvent){ 
    if(callback && typeof callback == "function"){
      this.callbacks.push(callback)
    }
    if(progressEvent && typeof progressEvent == "function"){
      this.progressEvent = progressEvent
    }
    if ( iceServers.length == 0 ) return
    var workerCount = 18 // number of max peerconnection to open for testing
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
      setTimeout(this.turnServerTest.bind(this) ,0)
    }
  },

  onTurnServerTested : function(turnServer){
    delete this.runningTests[turnServer.urls]
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
    // sending progress info
    if ( this.progressEvent != null ) { 
      var progress = ( this.disabledIceServers.length + this.iceServers.length ) / 
        ( this.testIceServers.length + Object.keys(this.runningTests).length + this.iceServers.length + this.disabledIceServers.length ) 
      this.progressEvent(progress) 
    }
    // call the callbacks if nothing left to test and no tests are still running
    if ( this.testIceServers.length == 0 ) {
      if ( Object.keys(this.runningTests).length == 0 ) { 
        while ( this.callbacks.length > 0 ) {
          this.callbacks.pop()()
        }
      }
    } else { 
      // test next Server
      this.turnServerTest()
    }
  },

  turnServerTest : function(){
    if ( this.testIceServers.length == 0 ) { return }
    console.log('turnServerTest 1 worker started, testQueue: ' + 
                this.testIceServers.length + ' tested: ' + 
                this.iceServers.length) 
   var testIceServer = this.testIceServers.shift()
    console.log('turnServerTest: ' + testIceServer.urls) 
    if ( testIceServer.urls.indexOf('turn') != -1 ) { // TURN-servers only
      testIceServer.rttTester = new RttTester(this.onTurnServerTested.bind(this), testIceServer)
      this.runningTests[testIceServer.urls] = true
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
    if ( servers.length == 0 ) servers.push(this.disabledIceServers)
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
    if ( servers.length == 0 ) servers.push(this.disabledIceServers)
    return servers
  },
}
