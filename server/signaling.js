'use strict';

const server_config = require('../server-config');

const util = require('util');
const ws = require('socket.io');
const EventEmitter = require('events');
const request = require('request');

/**
* Callback Utility
*/
function isFunction(cb) {
  if (typeof cb === 'function') {
    return cb;
  } else {
    return () => 1;
  }
}

class Signaling extends EventEmitter {
  constructor(server, options) {
    super();
    this.io = null;

    // override default config
    for (let opt in options) {
      if (options.hasOwnProperty(opt)) {
        this.config[opt] = options[opt];
      }
    }

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

  joinRoom(client, options, cb) {
    // sanity check
    if (typeof options.room !== 'string') {
      return isFunction(cb)('room must be a string');
    }

    client.join(options.room);
    client.room = options.room;
    var hasListener = this.emit('join', options, client);
    if (!hasListener) {
      client.broadcast.to(client.room).emit('participantReady', {
        pid : client.id,
        restTURN : options.restTURN
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
    client.on('message', (msg, cb) => {
      console.log('Receive msg:', msg && msg.type);
      if (!msg) return;

      var hasListener = this.emit('message', client, msg, cb);
      if (!hasListener) {
        logger.info('No listener, default process:', msg && msg.type);
        this.processMsgMessage(client, msg, cb);
      }
    });

    // send message to server
    client.on('server-message', (msg, cb) => {
      console.log('Receive server msg:', msg && msg.type);
      if (!msg) return;

      var hasListener = this.emit('server-message', client, msg, cb);
      if (!hasListener) {
        logger.info('No listener, default process:', msg && msg.type);
        this.processServerMessage(client, msg, cb);
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
    client.on('magnetURI', this.processMagnetMessage.bind(this, client));
    // End of TODO

    var request_uri;
    var config = this.config;

    if (client.request.connection.remoteAddress) {
      request_uri = server_config.REST_API_URI  + '&ip=' + client.request.connection.remoteAddress;
    } else {
      request_uri = server_config.REST_API_URI;
    }

    request(request_uri, function (error, response, body) {
      if (!error && response.statusCode == 200) {
        var stunrestanswer = JSON.parse(body);
        // console.log( stunrestanswer);
        client.restTURN = { urls: stunrestanswer.uris, username: stunrestanswer.username, credential: stunrestanswer.password };
        // console.log('sending restTURN:', client.restTURN, client.id);
        client.emit('restTURN', {'restTURN' : client.restTURN});
      } else {
        // console.log("STUN/TURN REST API call: Error: " + error);
        client.emit('restTURN', {'restTURN' : null});
      }
    });

    this.emit('connection', client);
  }

  processMsgMessage(client, msg, cb) {
    var toClient = this.io.to(msg.pid);
    if (!toClient || !msg.pid) {
      return isFunction(cb)(null, {
        type: 'info',
        message: 'not specified a client, should send to the room !'
      });
    }

    msg.from = client.id;
    toClient.emit('message', msg);
    isFunction(cb)(null, {
      type: 'info',
      message: 'the message is sent'
    });
  }

  processServerMessage(client, msg, cb) {
    return isFunction(cb)(null, {
      type: 'info',
      message: 'No server message supported on server...'
    });
  }

  /*
  * Legacy stuff
  * TODO: remove the following
  */
  processSDPMessage(client, msg, cb) {
    console.log('received sdp %s from %s type: %s > forward to %s ...', msg.sdp, client.id, msg.sdp.type, msg.pid);

    client.broadcast.to(msg.pid).emit('sdp', {'sdp' : msg.sdp , 'pid' : client.id, 'turn' : msg.turn});
    isFunction(cb)(null, {
      type: 'info',
      message: 'the message is sent'
    });
  }

  processICEMessage(client, msg, cb) {
    client.broadcast.to(msg.pid).emit('iceCandidate', {'candidate' : msg.candidate, 'pid' : client.id});
    isFunction(cb)(null, {
      type: 'info',
      message: 'the message is sent'
    });
  }

  processChatMessage(client, msg, cb) {
    msg.from = client.id;
    client.broadcast.to(client.room).emit('chat', {'pid' : client.id, 'chat' : msg});
    isFunction(cb)(null, {
      type: 'info',
      message: 'the message is sent'
    });
  }

  processNameMessage(client, msg, cb) {
    client.broadcast.to(client.room).emit('name', {'pid' : client.id, 'name' : msg});
    isFunction(cb)(null, {
      type: 'info',
      message: 'the message is sent'
    });
  }
  processMagnetMessage(client, msg, cb) {
    client.broadcast.to(client.room).emit('magnetURI', {'pid' : client.id, 'magnetURI' : msg});
    isFunction(cb)(null, {
      type: 'info',
      message: 'the message is sent'
    });
  }
}

// End of TODO

module.exports = function (server, options) {
  return new Signaling(server, options);
};

module.exports.Signaling = Signaling;
