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

    // send private message to another user
    client.on('message', (data) => {
      console.log('Receive msg:', data && data.type);
      if (!data) return;

      var hasListener = this.emit('message', client, data);
      if (!hasListener) {
        this.processMsgMessage(client, data);
      }
    });

    // send message to server
    client.on('server-message', (data) => {
      console.log('Receive server msg:', data && data.type);
      if (!data) return;

      var hasListener = this.emit('server-message', client, data);
      if (!hasListener) {
        this.processServerMessage(client, data);
      }
    });

    // Send message to room
    client.on('room-message', (data) => {
      console.log('Receive room msg:', data && data.type);
      if (!data) return;

      var hasListener = this.emit('room-message', client, data);
      if (!hasListener) {
        this.processRoomMessage(client, data);
      }
    });

    client.on('join', this.joinRoom.bind(this, client));
    client.on('bye', this.leaveRoom.bind(this, client));
    client.on('disconnect', this.disconnect.bind(this, client));

    var request_uri;

    if (client.request.connection.remoteAddress) {
      request_uri = config.REST_API_URI + '&ip=' + client.request.connection.remoteAddress;
    } else {
      request_uri = config.REST_API_URI;
    }

    request(request_uri, function (error, response, body) {
      if (!error && response.statusCode == 200) {
        var stunrestanswer = JSON.parse(body);
        client.restTURN = {urls : stunrestanswer.uris, username : stunrestanswer.username, credential : stunrestanswer.password};
        client.emit('restTURN', {'restTURN' : client.restTURN});
      } else {
        client.emit('restTURN', {'restTURN' : null});
      }
    });

    this.emit('connection', client);
  }

  processMsgMessage(client, data) {
    var toClient = this.io.to(data.pid);
    if (!toClient || !data.pid) {
      return;
    }

    toClient.emit('message', {'pid' : client.id, 'type' : data.type, 'content' : data.content});
  }

  processRoomMessage(client, data) {
    client.broadcast.to(client.room).emit('room-message', {'pid' : client.id, 'type' : data.type, 'content' : data.content});
  }

  processServerMessage(client, data) {
    console.log('Server message, not handled!');
  }
}

module.exports = function (server) {
  return new Signaling(server);
};

module.exports.Signaling = Signaling;
