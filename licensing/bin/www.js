#!/usr/bin/env node

var app = require('../server');
var path = require('path');
var fs = require('fs');
var http = require('http');
var https  = require('https')

// var dbConfiguration = require('./config/db');
var port = normalizePort(process.env.PORT || '5000');
var serverType = process.env.servertype;
app.set('port', port);
var server = {};

/**
 * Create Unified server based on the server type environment
 * choose between http and https server.
 */

if (serverType === 'https') {
    let certOptions = {
        key: fs.readFileSync(path.resolve('bin/certs/server.key')),
        cert: fs.readFileSync(path.resolve('bin/certs/server.crt'))
    }
    server = https.createServer(certOptions, app)
}else{
    server = http.createServer(app);
}

/**
 * Listen on provided port, on all network interfaces.
 */
server.listen(port);
server.on('error', onError);
server.on('listening', onListening);


/**
 * Database configuration
 */
//dbConfiguration();


/**
 * Normalize a port into a number, string, or false.
 */

function normalizePort(val) {
    var port = parseInt(val, 10);

    if (isNaN(port)) {
        // named pipe
        return val;
    }

    if (port >= 0) {
        // port number
        return port;
    }
    return false;
}

/**
 * Event listener for HTTP server "error" event.
 */

function onError(error) {
    if (error.syscall !== 'listen') {
        throw error;
    }

    var bind = typeof port === 'string' ?
        'Pipe ' + port :
        'Port ' + port;

    // handle specific listen errors with friendly messages
    switch (error.code) {
        case 'EACCES':
            console.error(bind + ' requires elevated privileges');
            process.exit(1);
            break;
        case 'EADDRINUSE':
            console.error(bind + ' is already in use');
            process.exit(1);
            break;
        default:
            throw error;
    }
}

/**
 * Event listener for HTTP server "listening" event.
 */
function onListening() {
    var addr = server.address();
    var bind = typeof addr === 'string' ?
        'pipe ' + addr :
        'port ' + addr.port;
}