'use strict';
// A subclass of Socket which reads data by line

const net = require('net');
const utils = require('haraka-utils');

const tls_socket = require('./tls_socket');

class Socket extends net.Socket {
    constructor(options) {
        super(options);
        setup_line_processor(this);
    }
}

function setup_line_processor(socket) {
    let current_data = '';

    socket.on('data', function on_socket_data(data) {
        current_data += data;
        let results;
        while ((results = utils.line_regexp.exec(current_data))) {
            const this_line = results[1];
            current_data = current_data.slice(this_line.length);
            socket.emit('line', this_line);
        }
    });

    socket.on('end', function on_socket_end() {
        if (current_data.length) {
            socket.emit('line', current_data);
        }
        current_data = '';
    });
}

exports.Socket = Socket;

// New interface - uses TLS
exports.connect = (port, host, cb) => {
    let options = {};
    if (typeof port === 'object') {
        options = port;
        cb = host;
    } else {
        options.port = port;
        options.host = host;
    }
    const sock = tls_socket.connect(options, cb);
    setup_line_processor(sock);
    return sock;
};
