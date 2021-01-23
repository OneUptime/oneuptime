'use strict';
// Socket address parser/formatter and server binding helper

const fs = require('fs');
const sockaddr = require('sockaddr');

module.exports = function endpoint(addr, defaultPort) {
    try {
        if ('string' === typeof addr || 'number' === typeof addr) {
            addr = sockaddr(addr, { defaultPort });
            const match = /^(.*):([0-7]{3})$/.exec(addr.path || '');
            if (match) {
                addr.path = match[1];
                addr.mode = match[2];
            }
        }
    } catch (err) {
        // Return the parse exception instead of throwing it
        return err;
    }
    return new Endpoint(addr);
};

class Endpoint {
    constructor(addr) {
        if (addr.path) {
            this.path = addr.path;
            if (addr.mode) this.mode = addr.mode;
        } else {
            // Handle server.address() return as well as parsed host/port
            const host = addr.address || addr.host || '::0';
            // Normalize '::' to '::0'
            this.host = '::' === host ? '::0' : host;
            this.port = parseInt(addr.port, 10);
        }
    }

    toString() {
        if (this.mode) return `${this.path}:${this.mode}`;
        if (this.path) return this.path;
        if (this.host.indexOf(':') >= 0) return `[${this.host}]:${this.port}`;
        return `${this.host}:${this.port}`;
    }

    // Make server listen on this endpoint, w/optional options
    bind(server, opts) {
        let done;
        opts = Object.assign({}, opts || {});
        if (this.path) {
            const path = (opts.path = this.path);
            const mode = this.mode ? parseInt(this.mode, 8) : false;
            if (mode) {
                done = () => fs.chmodSync(path, mode);
            }
            if (fs.existsSync(path)) fs.unlinkSync(path);
        } else {
            opts.host = this.host;
            opts.port = this.port;
        }
        server.listen(opts, done);
    }
}
