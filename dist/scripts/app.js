
var localVideo;
var socket;
var participantList={};
var videoContainer,videoContainerChanged,bigVideoContainer;
var room;
var dragLastOver,dragSource;
var hidingElementsStatus = "visible";

function pageReady() {
  room = document.URL.split("/")[3];
  localVideo = document.getElementById('localVideo');
  videoContainer = document.getElementById('videoContainer');
  bigVideoContainer = document.getElementById('bigVideoContainer');

  var constraints = {
    audio: true,
    video: {
        "width": {"min": "50","ideal":"1280",  "max": "1920"},
        "height": {"min": "50","ideal":"768",  "max": "1050"}
      }
  };

  if(navigator.mediaDevices.getUserMedia) {
      navigator.mediaDevices.getUserMedia(constraints).then(getUserMediaSuccess).catch(pageReady);
  } else {
      alert('Your browser does not support getUserMedia API');
  }
  window.addEventListener('resize', redrawVideoContainer);
  window.setTimeout(checkVideoContainer, 2500);
  fadeOutTimer = window.setTimeout(fadeOutElements, [3000]);
}

function redrawVideoContainer () {
  videoContainer.style.display = 'none'
  setTimeout(function(){videoContainer.style.display = 'inline-block'},10);
}

function getUserMediaSuccess(stream) {
    localStream = stream;
    participantList["localStream"] = {};
    addStream( stream, "localStream" );
    initSocket();
}

function initSocket() {
  socket = io('https://'+document.domain);
  socket.on('connection',function(socket){
    console.log('Socket connected!');
  });
  socket.on('sdp',function(msg){
    // Only create answers in response to offers
    console.log('received sdp from',msg.pid);
    if(msg.sdp.type == 'offer') {
      participantList[msg.pid]={};
      participantList[msg.pid].peerConnection = new RTCPeerConnection(peerConnectionConfig)
      participantList[msg.pid].peerConnection.onicecandidate = function (event){gotIceCandidate(event.candidate,msg.pid)};
      participantList[msg.pid].peerConnection.onaddstream = function (event){addStream(event.stream,msg.pid)};
      participantList[msg.pid].peerConnection.addStream(localStream)
      participantList[msg.pid].peerConnection.setRemoteDescription(new RTCSessionDescription(msg.sdp))
      participantList[msg.pid].peerConnection.createAnswer().then(function (description){createdDescription(description,msg.pid)}).catch(errorHandler);
    }
    else if (msg.sdp.type == 'answer') {
      participantList[msg.pid].peerConnection.setRemoteDescription(new RTCSessionDescription(msg.sdp))
    }
  });
  socket.on('iceCandidate',function(msg){
    console.log('got iceCandidate from %s: %s',msg.pid, msg.candidate.candidate );
    participantList[msg.pid].peerConnection.addIceCandidate(new RTCIceCandidate(msg.candidate)).catch(errorHandler);
  });
  socket.on('participantReady',function(msg){
    console.log('got participantReady:',msg );
    callParticipant(msg.pid);
  });
  socket.on('bye',function(msg){
    console.log('got bye from:',msg.pid );
    deleteParticipant(msg.pid);
  });
  socket.on('participantDied',function(msg){
    console.log('received participantDied from server: removing participant from my participantList');
    deleteParticipant(msg.pid);
  });
  // inform the server that this client is ready to stream:
  socket.emit('ready',room);
  window.onunload = function(){socket.emit('bye')};
}

function callParticipant(pid) {
    participantList[pid] = {};
    participantList[pid].peerConnection = new RTCPeerConnection(peerConnectionConfig);
    participantList[pid].peerConnection.onicecandidate = function (event){gotIceCandidate(event.candidate,pid)};
    participantList[pid].peerConnection.onaddstream = function (event){addStream(event.stream,pid)};
    participantList[pid].peerConnection.addStream(localStream);
    participantList[pid].peerConnection.createOffer().then(function (description){createdDescription(description,pid)}).catch(errorHandler);
}

function deleteParticipant(pid){
  console.log('removing participant: ',pid)
  participantList[pid].peerConnection.close();
  participantList[pid].videoDiv.parentNode.removeChild(participantList[pid].videoDiv);
  delete participantList[pid];
}

function gotIceCandidate(candidate, pid) {
    if(candidate != null) {
        console.log('send gathered iceCandidate:%s to %s',candidate.candidate, pid);
        socket.emit('iceCandidate',{'candidate':candidate,'pid':pid});
    }
}

function createdDescription(description,pid) {
    console.log('created localDescription sending to', pid);

    participantList[pid].peerConnection.setLocalDescription(description).then(function() {
        socket.emit('sdp',{ 'sdp': participantList[pid].peerConnection.localDescription, 'pid':pid} );
    }).catch(errorHandler);
}

function addStream( stream, pid ) {
  videoDiv = document.getElementById("templateVideoDiv").cloneNode(true);
  participantList[pid].mediaStream = stream;
  var video = document.createElement('video');
  var source = document.createElement('source');
  source.src = window.URL.createObjectURL(stream);
  video.appendChild(source)
  video.autoplay = true;
  if ( pid == "localStream" ) {
    video.muted = true;
    videoDiv.style.height = "100%";
  }
  videoDiv.appendChild(video);
  lastVideoDiv = videoContainer.lastElementChild;
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
}

function forceRedraw (element){
  var disp = element.style.display;
  element.style.display = 'none';
  var trick = element.offsetHeight;
  element.style.display = disp;
};

function muteAudio(pid){
  muteIcon = document.getElementById(pid).getElementsByClassName('audioMuteIcon')[0];
  unMuteIcon = document.getElementById(pid).getElementsByClassName('audioUnMuteIcon')[0];
  participantList[pid].mediaStream.getAudioTracks()[0].enabled = false;
  muteIcon.classList.remove('hidden');
  unMuteIcon.classList.add('hidden');
}

function unMuteAudio(pid){
  muteIcon = document.getElementById(pid).getElementsByClassName('audioMuteIcon')[0];
  unMuteIcon = document.getElementById(pid).getElementsByClassName('audioUnMuteIcon')[0];
  participantList[pid].mediaStream.getAudioTracks()[0].enabled = true;
  muteIcon.classList.add('hidden');
  unMuteIcon.classList.remove('hidden');
}

function unMuteVideo(pid){
  muteIcon = document.getElementById(pid).getElementsByClassName('videoMuteIcon')[0];
  unMuteIcon = document.getElementById(pid).getElementsByClassName('videoUnMuteIcon')[0];
  participantList[pid].mediaStream.getVideoTracks()[0].enabled = true;
  muteIcon.classList.add('hidden');
  unMuteIcon.classList.remove('hidden');
}

function muteVideo(pid){
  muteIcon = document.getElementById(pid).getElementsByClassName('videoMuteIcon')[0];
  unMuteIcon = document.getElementById(pid).getElementsByClassName('videoUnMuteIcon')[0];
  participantList[pid].mediaStream.getVideoTracks()[0].enabled = false;
  muteIcon.classList.remove('hidden');
  unMuteIcon.classList.add('hidden');
}

function setBigVideo(pid){
  if ( bigVideoContainer.getElementsByTagName('video').length != 0 ){
    bigVideoContainer.removeChild( bigVideoContainer.getElementsByTagName('video')[0] );
  }
  var video = document.createElement('video');
  var source = document.createElement('source');
  source.src = window.URL.createObjectURL(participantList[pid].mediaStream);
  video.appendChild(source);
  video.autoplay = true;
  if ( pid == "localStream" ) {
    video.muted = true;
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

// checks if the last videoDiv fits on the screen
// checks if there is to much space between bottom of last videoDiv and bottom of screen
// and scale videoDiv height up or down
function checkVideoContainer(){
  last = videoContainer.lastElementChild;
  if ( last == null ) {
    window.setTimeout(checkVideoContainer, 1000 );
    return;
  }
  height = last.style.height.split("%")[0] / 100; // 1 = 100%
  // only if last element's video is connected otherwise wait
  if ( ( last.getElementsByTagName("video")[0].networkState == 2 ||
         last.getElementsByTagName("video")[0].networkState == 1 ) ) {
    // if last element is out of window:
    if ( last.getBoundingClientRect().bottom > window.innerHeight ) {
      videoDivList = videoContainer.getElementsByClassName("videoDiv")
      for(i=0;i<videoDivList.length;i++){
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
        videoDivList = videoContainer.getElementsByClassName("videoDiv")
        for(i=0;i<videoDivList.length;i++){
          videoDivList[i].style.height = height * 100 +
            ( ( videoContainer.firstElementChild.getBoundingClientRect().left -
                window.innerWidth * 0.01 ) * 100 / window.innerWidth * 0.99 ) / 10 + "%"
        }
        videoContainerChanged = true;
        window.setTimeout(checkVideoContainer,20 );
    } else {
        // check if videoContainer was modified before so it should be finished
        // now - so we can redraw it ( because chrome live rendering is not perfect )
        if ( videoContainerChanged == true ) { forceRedraw(videoContainer) }
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
  videoList = videoContainer.getElementsByTagName("video")
  for(i=0;i<videoList.length;i++)
    { videoList[i].style.padding = "1px" }
  dragLastOver = this.id;
}

function dragEnd ( ev ) {
    // reset the transparency and padding of drag source and size of videoContainer
    ev.target.style.opacity = "";
    videoList = videoContainer.getElementsByTagName("video")
    for(i=0;i<videoList.length;i++)
          { videoList[i].style.padding = "1px" }
}

function allowDrop(ev) {
    ev.preventDefault();
    if ( this.id == dragSource ) {return};
    var element = document.getElementById(this.id);
    var elementVideo = element.getElementsByTagName("video")[0]

    destElement = document.getElementById(this.id);
    destElementVideo = destElement.getElementsByTagName("video")[0]

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
    destElement = document.getElementById(this.id);
    destElementVideo = destElement.getElementsByTagName("video")[0];

    if ( ev.offsetX > destElementVideo.offsetWidth / 2 ) {
      if ( destElement.nextSibling == null ){ // insert at end
        videoContainer.appendChild(document.getElementById( data ) )
      } else { // insert before next element
        videoContainer.insertBefore(document.getElementById( data ), destElement.nextSibling);
      }
    } else { // insert here
      videoContainer.insertBefore(document.getElementById(data), element);
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
    console.log(error);
}
