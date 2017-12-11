
var fs = require('fs');
var express = require('express');
var app = express();
var httpApp = express();
var http = require('http');
var https = require('https');
var config = require('../server-config');
var path = require('path');
var Signaling = require('./signaling.js');

// Yes, SSL is required
var httpsServer = https.createServer(config.httpsConfig, app);
var httpServer = http.createServer(httpApp);
// ----------------------------------------------------------------------------------------


// app.use(express.static(__dirname + '/dist'));
console.log(__dirname);

app.use(express.static(path.resolve(__dirname + '/../bower_components')));

app.use('/img',express.static(__dirname + '/../dist/img'));
app.use('/manifest.json',express.static(__dirname + '/../dist/manifest.json'));
app.use('/browserconfig.xml',express.static(__dirname + '/../dist/browserconfig.xml'));
app.use('/sw.js',express.static(__dirname + '/dist/sw.js'));

app.use('/scripts',express.static(path.resolve(__dirname + '/../dist/scripts')));
app.use('/css',express.static(path.resolve(__dirname + '/../dist/css')));
app.use('/client-config.js',express.static(path.resolve(__dirname + '/../client-config.js')));
app.use('/',express.static(path.resolve(__dirname + '/../google_verify')))
app.get('/', function (req, res) {
   console.log(req.url);
   res.sendFile(path.resolve(__dirname + '/../' + 'dist/chooseRoom.html'));
})
app.all('/*', function (req, res) {
   console.log(req.url);
   res.sendFile(path.resolve(__dirname + '/../' +'dist/index.html'));
})
httpsServer.listen(config.HTTPS_PORT, '::');

// redirect to https
httpApp.all('*',function (req, res) {
    res.redirect(301, "https://" + req.hostname + ":" + config.HTTPS_PORT + req.path);
    console.log('HTTP request -> redirecting: ' + "https://" + req.hostname + ":" + config.HTTPS_PORT + req.path);
    res.end();
}).listen(config.HTTP_PORT,'::');

httpsServer.listen(config.HTTPS_PORT, '::');

// ----------------------------------------------------------------------------------------

var signaling = new Signaling(httpsServer);


console.log('Server running. listening on port:',config.HTTPS_PORT, config.HTTP_PORT);
