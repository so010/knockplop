Knockplopp 
==========

Basic multipart p2p meeting webservice (client + server) based on WebRTC technology

For now it is only audio and video but desktop sharing, file sharing and whitheboard will follow.

The service connects everybody visiting the same URL. This means users can 
choose their room independent by writing their room name directly into the 
URL:
http://example-abc321.net/roomname

and share these URL to other users ...

### Install

- clone repository 
- install nodejs
- install npm depencies: `npm install` 
- install bower depencies: `bower install`
- generate self-signed certificatesi (by running `./generate_cert.sh` in console) or add thrusted certificate (for example from [let's encrypt](https://letsencrypt.org)) to your server
- copy local configuration files:
```shell
cp server-config.js.dist server-config.js
cp client-config.js.dist client-config.js
```
And edit both .js files for your needs. Especially add your TURN server + credentials to client-config.js otherwise connection between clients will fail if they are located behind restrictive firewalls. Add your certificate, key and authority to server-config.js otherwise Chrome-users will fail.


### Usage

Start the server:

```shell
node server.js
```

With the server running, open a recent version of Firefox or Chrome and visit `http://yourHostName:8080


### Development

We use [gulp](gulpjs.com) to automate som building tasks. 
You have to install gulp: `npm install --global gulp`
and run gulp: 
```shell
gulp
```

