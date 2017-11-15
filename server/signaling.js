'use strict';

const util = require('util');
const ws = require('socket.io');
const EventEmitter = require('events');
const request = require('request');
const config = require('../server-config');

class Signaling extends EventEmitter {
  constructor(server) {
    super();
    this.io = null;

    if (server != null) {
      console.log('Start signaling server ...');
      this.listen(server);
    }
  }

  listen(server) {
    this.io = ws.listen(server);
    this.io.sockets.on('connection', this.newConnection.bind(this));
    this.emit('signalingReady', server);
  }

  joinRoom(client, options) {
    // sanity check
    if (typeof options.room !== 'string') {
      return;
    }

    client.join(options.room);
    client.room = options.room;
    var hasListener = this.emit('join', options, client);
    if (!hasListener) {
      client.broadcast.to(client.room).emit('participantReady', {
        'pid' : client.id,
        'restTURN' : options.restTURN
      });
    }
  }

  leaveRoom(client) {
    if (client.room) {
      client.broadcast.to(client.room).emit('bye', {'pid' : client.id});
      client.leave(client.room);
      delete client.room;
    }

    this.emit('bye', client);
  }

  disconnect(client) {
    if (client.room) {
      client.broadcast.to(client.room).emit('participantDied', {'pid' : client.id});
      client.leave(client.room);
      delete client.room;
    }

    this.emit('participantDied', {'pid' : client.id});
  }

  newConnection(client) {
    console.log('New connection:', client.id);

    // send private message to another id
    client.on('message', (msg) => {
      console.log('Receive msg:', msg && msg.type);
      if (!msg) return;

      var hasListener = this.emit('message', client, msg);
      if (!hasListener) {
        logger.info('No listener, default process:', msg && msg.type);
        this.processMsgMessage(client, msg);
      }
    });

    // send message to server
    client.on('server-message', (msg) => {
      console.log('Receive server msg:', msg && msg.type);
      if (!msg) return;

      var hasListener = this.emit('server-message', client, msg);
      if (!hasListener) {
        logger.info('No listener, default process:', msg && msg.type);
        this.processServerMessage(client, msg);
      }
    });

    // Send message to room
    client.on('room-message', (msg) => {
      console.log('Receive room msg:', msg && msg.type);
      if (!msg) return;

      var hasListener = this.emit('room-message', client, msg);
      if (!hasListener) {
        logger.info('No listener, default process:', msg && msg.type);
        this.processRoomMessage(client, msg);
      }
    });

    /**
    * Event: join, leave, bye, disconnect
    */
    client.on('join', this.joinRoom.bind(this, client));
    // client.on('leave', this.leaveRoom.bind(this, client));
    client.on('bye', this.leaveRoom.bind(this, client));
    client.on('disconnect', this.disconnect.bind(this, client));

    /*
    * Backwards compatible for now
    * TODO: remove the following and use 'message' instead
    */
    client.on('ready', this.joinRoom.bind(this, client));
    client.on('sdp', this.processSDPMessage.bind(this, client));
    client.on('iceCandidate', this.processICEMessage.bind(this, client));
    client.on('chat', this.processChatMessage.bind(this, client));
    client.on('name', this.processNameMessage.bind(this, client));
    // End of TODO

    var request_uri;

    if (client.request.connection.remoteAddress) {
      request_uri = config.REST_API_URI + '&ip=' + client.request.connection.remoteAddress;
    } else {
      request_uri = config.REST_API_URI;
    }

    request(request_uri, function (error, response, body) {
      if (!error && response.statusCode == 200) {
        var stunrestanswer = JSON.parse(body);
        client.restTURN = { urls: stunrestanswer.uris, username: stunrestanswer.username, credential: stunrestanswer.password };
        client.emit('restTURN', {'restTURN' : client.restTURN});
      } else {
        client.emit('restTURN', {'restTURN' : null});
      }
    });

    this.emit('connection', client);
  }

  processMsgMessage(client, msg) {
    var toClient = this.io.to(msg.pid);
    if (!toClient || !msg.pid) {
      return;
    }

    toClient.emit('message', {'pid' : client.id, 'msg' : msg});
  }

  processRoomMessage(client, msg) {
    client.broadcast.to(client.room).emit('room-message', {'pid' : client.id, 'msg' : msg});
  }

  processServerMessage(client, msg) {
    console.log('Server message, not handled!');
  }

  /*
  * Legacy stuff
  * TODO: remove the following
  */
  processSDPMessage(client, msg) {
    console.log('received sdp %s from %s type: %s > forward to %s ...', msg.sdp, client.id, msg.sdp.type, msg.pid);
    client.broadcast.to(msg.pid).emit('sdp', {'pid' : client.id, 'sdp' : msg.sdp , 'turn' : msg.turn});
  }

  processICEMessage(client, msg) {
    client.broadcast.to(msg.pid).emit('iceCandidate', {'pid' : client.id, 'candidate' : msg.candidate});
  }

  processChatMessage(client, msg) {
    client.broadcast.to(client.room).emit('chat', {'pid' : client.id, 'chat' : msg});
  }

  processNameMessage(client, msg) {
    client.broadcast.to(client.room).emit('name', {'pid' : client.id, 'name' : msg});
  }
}

// End of TODO

module.exports = function (server) {
  return new Signaling(server);
};

module.exports.Signaling = Signaling;
