var HTTPS_PORT = 8443;
var HTTP_PORT = 8080;

var fs = require('fs');
var express = require('express');
var app = express();
var httpApp = express();
var http = require('http');
var https = require('https');
var WebSocketServer = require('ws').Server;
var config = require('./server-config');

// Yes, SSL is required
var httpsServer = https.createServer(config.httpsConfig, app);
var httpServer = http.createServer(httpApp);
var io = require('socket.io')(httpsServer);

// ----------------------------------------------------------------------------------------


// app.use(express.static(__dirname + '/dist'));
app.use(express.static(__dirname + '/bower_components'));
app.use('/pix',express.static(__dirname + '/pix'));
app.use('/scripts',express.static(__dirname + '/dist/scripts'));
app.use('/css',express.static(__dirname + '/dist/css'));
app.use('/client-config.js',express.static(__dirname + '/client-config.js'));
app.get('/', function (req, res) {
   console.log(req.url);
   res.sendFile(__dirname + '/' + 'dist/chooseRoom.html');
})
app.all('/*', function (req, res) {
   console.log(req.url);
   res.sendFile(__dirname + '/' +'dist/index.html');
})
httpsServer.listen(HTTPS_PORT, '0.0.0.0');

// redirect to https
httpApp.all('*',function (req, res) {
    res.redirect(301, "https://" + req.hostname + ":" + HTTPS_PORT + req.path);
    console.log('HTTP request -> redirecting: ' + "https://" + req.hostname + ":" + HTTPS_PORT + req.path);
    res.end();
});
httpServer.listen(HTTP_PORT, '0.0.0.0');


// ----------------------------------------------------------------------------------------

io.on('connection', function(socket) {
  console.log(socket.request.connection.remoteAddress);
  socket.on('ready', function(room) {
    console.log('new participant: %s in room: %s', socket.id, room);
    socket.join(room);
    socket.room = room;
    socket.broadcast.to(room).emit('participantReady',{'pid':socket.id});
  });
  socket.on('sdp', function(msg) {
    console.log('received sdp from %s type: %s > forward to %s ...',
      socket.id, msg.sdp.type, msg.pid);
    socket.broadcast.to(msg.pid).emit('sdp',{'sdp':msg.sdp , 'pid':socket.id});
  });
  socket.on('iceCandidate', function(msg) {
    console.log('received iceCandidate: from %s for %s :',
      socket.id, msg.pid, msg.candidate.candidate.split("typ")[1].split(" ",2 )[1]); // only log the type
    socket.broadcast.to(msg.pid).emit('iceCandidate',{ 'candidate': msg.candidate, 'pid':socket.id });
  });
  socket.on('bye', function() {
    console.log('received bye from %s forwarding to room %s', socket.id, socket.room );
    socket.broadcast.to(socket.room).emit('bye',{ 'pid':socket.id } );
  });
  socket.on('disconnect', function() {
    console.log('client disconnected: %s in room: ', socket.id, socket.room );
    socket.broadcast.to(socket.room).emit('participantDied',{ 'pid':socket.id } );
  });

});


console.log('Server running. listening on port:',HTTP_PORT,HTTPS_PORT);
