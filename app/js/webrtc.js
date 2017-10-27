"use strict";
var localVideo;
var localStream;
var socket;
var participantList={};
var userPid;
var videoContainer,videoContainerChanged,bigVideoContainer;
var room;
var dragLastOver,dragSource;
var hidingElementsStatus = "visible";
var restTURN;
var fadeOutTimer;
var progressBar = {}
var webtorrentClient = {}
var dragDrop = {}
var screensharing = false;
var renegotiationNeeded = false;
var chatHidden = true;
var notificationHidden = true;
var unreadMessages = 0;
var userName = "";
var chatMessages = [];

function redrawVideoContainer () {
  videoContainer.style.display = 'none'
  setTimeout(function(){videoContainer.style.display = 'inline-block'},10);
}

function setIsScreensharing(isScreensharing) {
  screensharing = isScreensharing;
  document.getElementById('screenshareIcon').innerHTML = screensharing ? 'stop_screen_share' : 'screen_share';
}

function getScreenSuccess (stream) {
  setIsScreensharing(true);
  stream.type = 'screen'
  var prevLocalStream = localStream;
  localStream = stream;
  participantList["localVideo"].screenStream = stream
  document.querySelector('video').srcObject = stream;
  changeStreamsInPeerConnections(prevLocalStream, stream);
}

function getChromeScreenSuccess(screenStream) {
  // Chrome (as of 59) doesn't allow the microphone to be retrieved when requesting screen sharing, so the workaround
  // (as described in https://stackoverflow.com/a/20063211) is to request the microphone separately, and then add its audio track to the screen stream.
  var audioOnlyConstraints = {
    audio: true,
    video: false
  }
  console.debug("Chrome: attempting to retrieve local microphone for screensharing");
  navigator.mediaDevices.getUserMedia(audioOnlyConstraints).then(function(audioStream) {
    screenStream.addTrack(audioStream.getAudioTracks()[0]);
    console.log("Chrome: using screen stream with audio track");
    getScreenSuccess(screenStream);
  }).catch(errorHandler);
}

function getCamSuccess(stream) {
  setIsScreensharing(false);
  stream.type = 'camera'
  var prevLocalStream = localStream;
  localStream = stream;
  if (participantList["localVideo"]) {
    delete participantList["localVideo"].screenStream;
    document.querySelector('video').srcObject = stream;
    changeStreamsInPeerConnections(prevLocalStream, stream);
  } else {
    participantList["localVideo"] = {};
    addStream( stream, "localVideo" );
    setGlobalMessage('Test remote streaming:')
    mirrorMe()
    audioAnalyser(stream)
  }
}

function changeStreamsInPeerConnections(oldStream, newStream) {
  for (var pid in participantList) {
    if (pid != "localVideo") {
      // Changing streams of a connected peer connection will trigger SDP renegotiation.
      renegotiationNeeded = true;

      var pc = participantList[pid].peerConnection;
      if ("removeTrack" in pc) {
        pc.removeTrack(pc.getSenders()[0]);
      } else {
        pc.removeStream(oldStream);
      }

      // TODO use addTrack instead of addStream?
      // pc.addTrack(stream.getVideoTracks()[0], stream);
      pc.addStream(newStream);
    }
  }
}

function handleRenegotiation() {
  if (!renegotiationNeeded) {
    return;
  }
  // TODO The onnegotiationneeded callback seems to be called multiple times in Chrome, but only once (per addStream call?) in FF.
  // Not sure if this is a Chrome bug, or just stems from not fully understanding when this event is fired, but this results in multiple offer SDPs
  // and multiple answer SDPs being received, causing "harmless" error messages in the console. Screen sharing still seems to work though.
  console.debug("handleRenegotiation() called!");
  // Go through the list of participants and send each one a new SDP.
  for (var pid in participantList) {
    if (pid != "localVideo") {
      var pc = participantList[pid].peerConnection;
      pc.createOffer().then(function(offer) {
        return pc.setLocalDescription(offer);
      }).then(function() {
        // Send this new offer to this participant.
        sendSDP(pc.localDescription, pid);
      }).catch(errorHandler);
    }
  }
}

function mirrorMe () {
  var participant = new Object();
  participant.pid = 'mirrorReceiver'
  participant.turn = iceServerManager.getFastestTurnServers()
  callParticipant(participant)
}

function initSocket() {
  socket = io('https://' + document.domain + ':' + document.location.port);
  socket.on('connect', () => {
    console.log('Socket connected!');
    userPid = socket.id;
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
      setGlobalMessage('Testing network conditions')
      iceServerManager.startTesting(testIceServers,function(){
        setGlobalMessage('Getting access to your camera and microphone...')
        getCam()
      },progressBarManager.updateProgress.bind(progressBarManager));
    }
    else {
      console.log('received empty restTURN config from server :(');
    }
  });
  socket.on('sdp',function(msg){
    console.log('received sdp from',msg.pid,msg.turn);
    receivedDescription(msg)
    sendName();
  });
  socket.on('iceCandidate',function(msg){
    // console.log('got iceCandidate from %s: %s',msg.pid, msg.candidate.candidate );
    participantList[msg.pid].peerConnection.addIceCandidate(new RTCIceCandidate(msg.candidate)).catch(errorHandler);
  });
  socket.on('participantReady',function(msg){
    console.log('got participantReady:',msg );
    callParticipant(msg);
    $('#chatAudio')[0].play();
  });
  socket.on('bye',function(msg){
    console.log('got bye from:',msg.pid );
    deleteParticipant(msg.pid);
  });
  socket.on('participantDied',function(msg){
    console.log('received participantDied from server: removing participant from my participantList');
    deleteParticipant(msg.pid);
  });
  socket.on('magnetURI',function(msg){
    participantList[msg.pid].progressBar._container.classList.remove('hidden')
    participantList[msg.pid].progressBar.set(0)
    webtorrentClient.add(msg.magnetURI,function(torrent) {
      torrent.on('done', function () {
        participantList[msg.pid].progressBar._container.classList.add('hidden')
        console.log('torrent download finished from ',msg.pid,' ',torrent.files[0].name)
        torrent.files[0].getBlobURL(function callback (err, url) {
          if (err) console.log('Error on getting torrent-file: ',torrent.files[0].name)
          var a = document.createElement('a')
          a.download = torrent.files[0].name
          a.href = url
          a.textContent = 'Download ' + torrent.files[0].name
          document.body.appendChild(a)
        }.bind(msg))
      }.bind(msg))
      torrent.on('download',function (bytes) {
        participantList[msg.pid].progressBar.set(torrent.progress)
        console.log('torrent progress: ',torrent.progress,torrent.files[0].name,msg.pid)
      }.bind(msg))
    }.bind(msg))
  });
  socket.on('chat', function(msg) {
    console.log('received chat from ', msg.pid, msg.chat);
    appendChat(msg.chat);
  });
  socket.on('requestchat', function(msg) {
    console.log('received request for chat history from ', msg.pid);
    chatRequest(msg.pid);
  });
  socket.on('chathistory', function(msg) {
    console.log('received chat history from ', msg.pid, msg.history.chatMessages);
    receivedChatHistory(msg.history.chatMessages);
  });
  socket.on('name', function(msg) {
    console.log('received name from ', msg.pid, msg.name);
    receiveName(msg);
  });
  window.onunload = function(){socket.emit('bye')};
}

function createPeerConnection(pid,turn) {
    console.log("Creating PeerConnection for pid: " + pid);
    var peerConnectionConfig = {}
    peerConnectionConfig.iceServers = iceServerManager.getFastestIceServers()

    /*
    if ( typeof(msg.turn) != 'undefined') {
      participantList[pid].turn=turn;
      peerConnectionConfig.iceServers =
        participantList[pid].turn.concat(peerConnectionConfig.iceServers)
    }
    */

    if ( pid.indexOf('mirror') != -1 ) {
      peerConnectionConfig.iceTransportPolicy = 'relay'
    }

    var pc = new RTCPeerConnection(peerConnectionConfig);
    pc.onicecandidate = function (event){gotIceCandidate(event.candidate,pid)};
    pc.onaddstream = function (event){addStream(event.stream,pid)};
    pc.onnegotiationneeded = handleRenegotiation;
    return pc;
}

function callParticipant(msg) {
    console.log("callParticipant with pid: " + msg.pid);
    participantList[msg.pid] = {};
    participantList[msg.pid].peerConnection = createPeerConnection(msg.pid, msg.turn);
    participantList[msg.pid].peerConnection.addStream(localStream);
    // Create offer for target pid and then send through signalling.
    participantList[msg.pid].peerConnection.createOffer().then(function (description){createdDescription(description,msg.pid,true)}).catch(errorHandler);
}

function receivedDescription(msg){
  if(msg.sdp.type == 'offer') {
    console.log("OFFER SDP received from pid: " + msg.pid);
    // Create a PeerConnection object only if we don't already have one for this pid.
    if (participantList[msg.pid] == undefined) {
      participantList[msg.pid]={};
      participantList[msg.pid].peerConnection = createPeerConnection(msg.pid, msg.turn);
      if ( msg.pid.indexOf('mirrorSender') == -1 ){ // sending mirror stream only sender -> receiver
        participantList[msg.pid].peerConnection.onaddstream = function (event){addStream(event.stream,msg.pid)};
        participantList[msg.pid].peerConnection.addStream(localStream)
      } else {
        // TODO: this is a ugly hack and should be handled somewhere else:
        participantList[msg.pid].peerConnection.onaddstream = function (event){
          replaceStream(event.stream,'localVideo')
          document.getElementById("joinButton").classList.remove('hidden')
        }
      }
    }
    participantList[msg.pid].peerConnection.setRemoteDescription(new RTCSessionDescription(msg.sdp))
    participantList[msg.pid].peerConnection.createAnswer().then(function (description){createdDescription(description,msg.pid,false)}).catch(errorHandler);
    if (chatMessages.length === 0) {
      socket.emit('requestchat', {'pid' : msg.pid});
    }
  }
  else if (msg.sdp.type == 'answer') {
    console.log("Received ANSWER SDP from pid: " + msg.pid);
    participantList[msg.pid].peerConnection.setRemoteDescription(new RTCSessionDescription(msg.sdp)).catch(errorHandler);
  }
}

function deleteParticipant(pid){
  if (typeof(participantList[pid]) != 'undefined'){
    console.log('removing participant: ',pid)
    participantList[pid].peerConnection.close();
    if ( typeof participantList[pid].videoDiv == 'object' ) {
      participantList[pid].videoDiv.parentNode.removeChild(participantList[pid].videoDiv);
    }
    delete participantList[pid];
  }
  else{
    console.log('removing participant: participant does not exist: ',pid)
  }
}

function gotIceCandidate(candidate, pid) {
  if(candidate != null) {
    // console.log('send gathered iceCandidate:%s to %s',candidate.candidate, pid);
    if ( pid.indexOf('mirror') == -1 ){ // send all candidates that are not mirror
      socket.emit('iceCandidate',{'candidate':candidate,'pid':pid});
    }
    else { // candidates from mirroring set we directly ( but only relay candidates )
      if ( candidate.candidate.split("typ")[1].split(" ",2 )[1] == 'relay' )  {
        if (pid == 'mirrorReceiver') { pid = 'mirrorSender' }
        else { pid = 'mirrorReceiver' }
        participantList[pid].peerConnection.addIceCandidate(new RTCIceCandidate(candidate)).catch(errorHandler);
      }
    }
  }
}

function createdDescription(description,pid,isOffer) {
  console.log('Setting local ' + (isOffer ? 'OFFER' : 'ANSWER') + ' SDP and sending to ' + pid);
  participantList[pid].peerConnection.setLocalDescription(description).then(function() {
    sendSDP(participantList[pid].peerConnection.localDescription, pid);
  }).catch(errorHandler)
}

function sendSDP(sdp, pid) {
  console.log('Sending SDP to', pid);
  var msg = {};
  if ( sdp.type == 'offer' ){
    msg.turn = iceServerManager.getFastestTurnServers() // sending my own TURN servers along
  }
  msg.sdp = sdp
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
}

// this is about creating a video view for participant and
// adding and activating video
function addStream( stream, pid ) {
  console.debug("*** addStream() called for pid: " + pid);
  var videoDiv = document.getElementById(pid);
  if (videoDiv) {
    // Video element already exists for this pid, so just replace the source with the given stream.
    replaceStream(stream, pid)
  } else {
      var videoDiv = {}
      participantList[pid].mediaStream = stream;
      var video = document.createElement('video');
      video.srcObject = stream;
      video.autoplay = true;
      if ( pid == "localVideo" ) {
        video.muted = true;
        videoDiv = document.getElementById("localVideoDiv").cloneNode(true)
        videoDiv.style.height = "100%";
        video.style.cssText = "-moz-transform: scale(-1, 1); \
          -webkit-transform: scale(-1, 1); -o-transform: scale(-1, 1); \
          transform: scale(-1, 1); filter: FlipH;";
      } else {
        videoDiv = document.getElementById("templateVideoDiv").cloneNode(true)
        videoDiv.style.opacity = "0"; // invisible until layout is settled
      }
      videoDiv.appendChild(video);
      var progressBarDiv = document.createElement('div')
      progressBarDiv.classList.add('overlayBottom','hidden')
      var progressBar = new ProgressBar.Line(progressBarDiv, {
        strokeWidth: 5,
        easing: 'easeInOut',
        duration: 100,
        color: '#FFEA82',
        trailColor: '#eee',
        trailWidth: 1,
        svgStyle: {width: '85%'},
        text: {
          style: {
            // Text color.
            // Default: same as stroke color (options.color)
            color: '#fff',
            position: 'absolute',
            // display:'block',
            right: '0px',
            // bottom: '0px',
            width:'15%',
            padding: '2px',
            margin: '2px',
            top: '50%',
            transform: 'translate(0,-50%)',
          },
          autoStyleContainer: false
        },
        from: {color: '#FFEA82'},
        to: {color: '#ED6A5A'},
        step: (state, bar) => {
          bar.setText(Math.round(bar.value() * 100) + ' %')
        }
      })
      participantList[pid].progressBar = progressBar
      videoDiv.appendChild(progressBarDiv)
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
}

function replaceStream( stream, pid ) {
  document.getElementById(pid).getElementsByTagName('video')[0].srcObject = stream
}

function forceRedraw (element){
  var disp = element.style.display;
  element.style.display = 'none';
  var trick = element.offsetHeight;
  element.style.display = disp;
};

function muteLocalAudio() {
  var muteIcon = document.getElementById('global-controls').getElementsByClassName('audioMuteIcon')[0];
  var unMuteIcon = document.getElementById('global-controls').getElementsByClassName('audioUnMuteIcon')[0];
  muteIcon.classList.remove('hidden');
  unMuteIcon.classList.add('hidden');
  muteAudio('localVideo');
}

function unMuteLocalAudio() {
  var muteIcon = document.getElementById('global-controls').getElementsByClassName('audioMuteIcon')[0];
  var unMuteIcon = document.getElementById('global-controls').getElementsByClassName('audioUnMuteIcon')[0];
  muteIcon.classList.add('hidden');
  unMuteIcon.classList.remove('hidden');
  unMuteAudio('localVideo');
}

function muteLocalVideo() {
  var muteIcon = document.getElementById('global-controls').getElementsByClassName('videoMuteIcon')[0];
  var unMuteIcon = document.getElementById('global-controls').getElementsByClassName('videoUnMuteIcon')[0];
  muteIcon.classList.remove('hidden');
  unMuteIcon.classList.add('hidden');
  muteVideo('localVideo');
}

function unMuteLocalVideo() {
  var muteIcon = document.getElementById('global-controls').getElementsByClassName('videoMuteIcon')[0];
  var unMuteIcon = document.getElementById('global-controls').getElementsByClassName('videoUnMuteIcon')[0];
  muteIcon.classList.add('hidden');
  unMuteIcon.classList.remove('hidden');
  unMuteVideo('localVideo');
}

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
  videoContainer.style.top = "90%";
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

function toggleScreenshare() {
  if (!screensharing) {
    // Currently using the camera, so switch to the screen.
    getScreen();
  } else {
    // Currently sharing the screen, so switch to camera.
    getCam();
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
  // console.log(pid);
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
    console.error(error);
}

function joinRoom(){
  socket.emit('ready',{'room':room,'turn':iceServerManager.getFastestTurnServers()})
  document.getElementById('joinButton').classList.add('hidden')
  document.getElementById('localMessage').classList.add('hidden')
  document.getElementById('localTopLeft').insertBefore(document.getElementById('audioIndicator'),document.getElementById('localTopLeft').childNodes[0])
  replaceStream(localStream,'localVideo')
  deleteParticipant('mirrorReceiver')
  deleteParticipant('mirrorSender')
}

var progressBarManager = {
  progressBar:null,
  init:function(){
    this.progressBar = new ProgressBar.Circle(globalMessageProgressBar, {
      color: '#aaa',
      // This has to be the same size as the maximum width to
      // prevent clipping
      strokeWidth: 4,
      trailWidth: 1,
      easing: 'easeInOut',
      from: { color: '#aaa', width: 1 },
      to: { color: '#333', width: 4 },
      duration:200,
      step: function(state, circle) {
        circle.path.setAttribute('stroke', state.color);
        circle.path.setAttribute('stroke-width', state.width);
        var value = Math.round(circle.value() * 100);
        if (value === 0) {
          circle.setText('');
        } else {
          circle.setText(value+'%');
        }
      }
    })
  },
  updateProgress:function(progress){
    document.getElementById('globalMessage').classList.remove('hidden')
    this.progressBar.animate(progress)
    if ( progress > 0.99999999 ) {
      fadeOut(document.getElementById('globalMessage'))
    }
  },
}

function setGlobalMessage(msg){
//  document.getElementById('globalMessage').classList.remove('hidden')
  document.getElementById('globalMessageTextField').innerHTML = msg
}

function fadeOut(element){
  var op = 1;  // initial opacity
  var timer = setInterval(function () {
    if (op <= 0.1){
      clearInterval(timer);
      element.classList.add('hidden');
    }
    element.style.opacity = op;
//    element.style.filter = 'alpha(opacity=' + op * 100 + ")";
    op -= op * 0.1;
  }, 70);
}

function audioAnalyser(stream) {
  var audioContext = new AudioContext()
  var analyser = audioContext.createAnalyser()
  var microphone = audioContext.createMediaStreamSource(stream)
  var javascriptNode = audioContext.createScriptProcessor(2048, 1, 1)

  analyser.smoothingTimeConstant = 0
  analyser.fftSize = 1024

  microphone.connect(analyser)
  analyser.connect(javascriptNode)
  javascriptNode.connect(audioContext.destination)
  var maxAudioLvl = 0
  var oldAudioLvl = 0
  var speakerDetected = false

  javascriptNode.onaudioprocess = function() {
    var array = new Uint8Array(analyser.frequencyBinCount)
    analyser.getByteFrequencyData(array)
    var values = 0
    var length = array.length;
    for (var i = 0; i < length; i++) {
      values += (array[i]*array[i]);
    }

    var average = Math.sqrt(values / length);
    maxAudioLvl = Math.max(maxAudioLvl,average);
    average = Math.max( average, oldAudioLvl-oldAudioLvl*0.1);
    oldAudioLvl = average;
    var averagePercent = average / maxAudioLvl
    var audioIndicator = document.getElementById('audioIndicator')
    audioIndicator.style.opacity = averagePercent
    if ( averagePercent > 0.25 ) {
      if ( averagePercent > 0.8 ) {
        audioIndicator.style.color = 'red'
      }
      else {
        audioIndicator.style.color = 'yellow'
        speakerDetected = true
      }
    }
    else {
      audioIndicator.style.color = null
      speakerDetected = false
    }
  }
}

function getScreen(){
  var constraints = {
    audio: true,
    video: { mediaSource: "screen" }
  };

  if(adapter.browserDetails.browser === 'chrome') {
    // Chrome 34+ requires an extension
    var pending = window.setTimeout(function () {
      alert('The required Chrome extension is not installed. To install it, go to https://chrome.google.com/webstore/detail/janus-webrtc-screensharin/hapfgfdkleiggjjpfpenajgdnfckjpaj (you might have to reload the page afterwards).');
    }, 1000);
    window.postMessage({ type: 'janusGetScreen', id: pending }, '*');
  } else {
    if(navigator.mediaDevices.getUserMedia) {
      navigator.mediaDevices.getUserMedia(constraints).then(getScreenSuccess).catch(errorHandler);
    } else {
      alert('Your browser does not support getUserMedia API: sorry you can\'t use this service');
    }
  }
}

function getCam(){
  var constraints = {
    audio: true,
    video: {
        "width": {"min": "50","ideal":"1280",  "max": "1920"},
        "height": {"min": "50","ideal":"768",  "max": "1050"}
      }
  };

  // get camera and mic:
  if(navigator.mediaDevices.getUserMedia) {
      navigator.mediaDevices.getUserMedia(constraints).then(getCamSuccess).catch(errorHandler);
  } else {
      alert('Your browser does not support getUserMedia API: sorry you can\'t use this service');
  }
}

function pageReady() {
  // JQuery GUI stuff
  $('#chat header').on('click', function() {
    if (chatHidden) { // Clicked on hidden chat
      $('.chat').slideToggle(300, 'swing');
      $('.chat-message-counter').fadeOut(300, 'swing');
      chatHidden = false;
      unreadMessages = 0;
      notificationHidden = true;
    } else { // Clicked on open chat
      $('.chat').slideToggle(300, 'swing');
      // $('.chat-message-counter').fadeToggle(300, 'swing');

      chatHidden = true;
      unreadMessages = 0;
      notificationHidden = true;
    }
  });

  $('.chat').slideToggle(0);
  // $('.chat-message-counter').fadeToggle(0, 'swing');;

  // appending HTML5 Audio Tag in HTML Body
  $('<audio id="chatAudio"><source src="css/notify.mp3" type="audio/mpeg"></audio>').appendTo('body');

  // Editable name tag
  $(document).on("click", "#nametag", function() {
    var original_text = $(this).text();
    document.getElementById('localTopCenter').classList.remove('fadeOutElements')
    var new_input = $("<input class=\"nameeditor\"/>");
    if (original_text != "Enter name...") {
      new_input.val(original_text);
    }
    $(this).replaceWith(new_input);
    new_input.focus();
    new_input.keypress( function(e) {
      let key = e.keyCode
      if (key == 13) {
        $(this).blur()
        return false;
      }
    });
  });

  $(document).on("blur", ".nameeditor", function() {
    var new_input = $(this).val();
    document.getElementById('localTopCenter').classList.add('fadeOutElements')
    var updated_text = $("<span id=\"nametag\">");
    if (new_input.trim() == "") {
      userName = "";
      updated_text.text("Enter name...");
    } else {
      userName = new_input;
      updated_text.text(new_input);
    }
    sendName();
    $(this).replaceWith(updated_text);
  });

  // End JQuery GUI stuff

  // getting some HTML-elements we need later and roomname:
  room = document.URL.split("/")[3];
  localVideo = document.getElementById('localVideo');
  videoContainer = document.getElementById('videoContainer');
  bigVideoContainer = document.getElementById('bigVideoContainer');
  webtorrentClient = new WebTorrent({
    tracker: {
      rtcConfig: peerConnectionConfig
    }
  })
  dragDrop = new DragDrop('#videoDivWrapper', function (files, pos) {
    console.log('Here are the dropped files', files)
    console.log('Dropped at coordinates', pos.x, pos.y)
    webtorrentClient.seed(files, function (torrent) {
      console.log('Client is seeding ' + torrent.magnetURI)
      socket.emit('magnetURI',torrent.magnetURI)
    })
  })


  progressBarManager.init()

  // move initially configured ICE servers to testing before we use them
  setGlobalMessage('Testing connection step 1')
  if ( typeof(peerConnectionConfig.iceServers) != 'undefined' && peerConnectionConfig.iceServers.length > 0 ) {
    iceServerManager.startTesting(peerConnectionConfig.iceServers,undefined,
          progressBarManager.updateProgress.bind(progressBarManager))
  }
  setGlobalMessage('Initializing...')
  initSocket()

  window.addEventListener('resize', redrawVideoContainer);
  window.setTimeout(checkVideoContainer, 2500);
}


if (adapter.browserDetails.browser === 'chrome') {
  // Listen for events from the Chrome extension used for screensharing.
  // Code from Janus project (Copyright (c) 2016 Meetecho)
  window.addEventListener('message', function (event) {
    if(event.origin != window.location.origin)
      return;
    if (event.data.type == 'janusGotScreen') {
      if (event.data.sourceId === '') {
        // user canceled
        console.log('You cancelled the request for permission, giving up...');
      } else {
        var constraints = {
          audio: false,             // Chrome currently does not support retrieving the one with the screen
          video: {
            mandatory: {
              chromeMediaSource: 'desktop',
              maxWidth: window.screen.width,
              maxHeight: window.screen.height,
              maxFrameRate: 3
            },
            optional: [
              {googTemporalLayeredScreencast: true}
            ]
          }
        };

        constraints.video.mandatory.chromeMediaSourceId = event.data.sourceId;
        // console.log("janusGotScreen: constraints=" + JSON.stringify(constraints));
        navigator.mediaDevices.getUserMedia(constraints).then(getChromeScreenSuccess).catch(errorHandler);
      }
    } else if (event.data.type == 'janusGetScreenPending') {
        window.clearTimeout(event.data.id);
    }
  });
}

/* Chat */

// Chat message submitted
function chatMessage() {
  var form = document.getElementById('chat-form');
  var messageText = form.elements['message'].value;

  // Empty name for now
  var msg = {pid: userPid, name : userName, time : Date.now(), message : messageText};

  chatMessages.push(msg);

  sendChat(msg);
  appendChat(msg);

  form.reset();

  return false; // Return false to disable normal form submition
}

function receiveChat(msg) {
  chatMessages.push(msg);

  appendChat(msg);
}

function receivedChatHistory(history) {
  if (chatMessages.length === 0) {
    for (var chat in history) {
      receiveChat(history[chat]);
    }
  }
}

function chatRequest(pid) {
  socket.emit('chathistory', {'history' : { chatMessages }, 'pid' : pid});
}

/*

msg = {"name" : "displayname", "time" : "timestamp", "message" : "messagetext"}

<div class="chat-message clearfix">
  <div class="chat-message-content clearfix">
    <span class="chat-time">13:35</span>
    <h5>John Doe</h5>
    <p>Lorem ipsum dolor sit amet, consectetur adipisicing elit. Error,
      explicabo quasi ratione odio dolorum harum.</p>
  </div> <!-- end chat-message-content -->
</div> <!-- end chat-message -->
<hr>

*/

// Chat appended to history
function appendChat(msg) {
  var chatHistory = document.getElementById('chat-history');

  var chatText = document.createElement('p');
  chatText.appendChild(document.createTextNode(msg.message));

  var chatName = document.createElement('h5');
  chatName.appendChild(document.createTextNode(msg.name));

  var time = new Date(msg.time);
  var chatTime = document.createElement('span');
  chatTime.className = 'chat-time';
  chatTime.appendChild(document.createTextNode((time.getHours() < 10 ? '0' : '') + time.getHours() + ':' + (time.getMinutes() < 10 ? '0' : '') + time.getMinutes()));

  var chatMessageContent = document.createElement('div');
  chatMessageContent.className = 'chat-message-content clearfix';
  chatMessageContent.appendChild(chatTime);
  chatMessageContent.appendChild(chatName);
  chatMessageContent.appendChild(chatText);

  var chatMessage = document.createElement('div');
  chatMessage.className = 'chat-message clearfix';
  chatMessage.appendChild(chatMessageContent);

  chatHistory.appendChild(chatMessage);
  chatHistory.appendChild(document.createElement('hr'));

  chatHistory.scrollTop = chatHistory.scrollHeight - chatHistory.clientHeight;

  if (chatHidden) { // Update unread count and show notification if hidden
    unreadMessages++;
    var unreadCounter = document.getElementById('chat-message-counter');
    unreadCounter.innerHTML = unreadMessages;

    if (notificationHidden) {
      $('#chatAudio')[0].play();
      $('.chat-message-counter').fadeIn(300, 'swing');
      notificationHidden = false;
    }
  }
}

function sendName() {
  socket.emit('name', userName);
}

function sendChat(msg) {
  socket.emit('chat', msg);
}

// msg = {pid: pid, name: name}
function receiveName(msg) {
  var nameholder = participantList[msg.pid]["videoDiv"]["children"]["remoteTopCenter"]["children"][0];
  nameholder.innerHTML = msg.name;
}
