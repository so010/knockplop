var peerConnectionConfig = {
    'iceServers': [
        {'urls': 'stun:stun.services.mozilla.com'},
        {'urls': 'stun:stun.l.google.com:19302'},
//        {'username':'turnuser','credential':'turnpassword','urls': 'turn:turnserver_IP:port?transport=tcp'},
//        {'username':'turnuser','credential':'turnpassword','urls': 'turn:turnserver_IP:port?transport=udp'},
    ]
}
