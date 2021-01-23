'use strict';
/*--------------------------------------------------------------------------*/
/* Obtained and modified from http://js.5sh.net/starttls.js on 8/18/2011.   */
/*--------------------------------------------------------------------------*/

// node.js built-ins
const cluster = require('cluster');
const net = require('net');
const path = require('path');
const spawn = require('child_process').spawn;
const stream = require('stream');
const tls = require('tls');
const util = require('util');

// npm packages
const async = require('async');
const openssl = require('openssl-wrapper').exec;
exports.config = require('haraka-config'); // exported for tests

const log = require('./logger');

const certsByHost = {};
const ctxByHost = {};
let ocsp;
let ocspCache;

// provides a common socket for attaching
// and detaching from either main socket, or crypto socket
class pluggableStream extends stream.Stream {
    constructor(socket) {
        super();
        this.readable = this.writable = true;
        this._timeout = 0;
        this._keepalive = false;
        this._writeState = true;
        this._pending = [];
        this._pendingCallbacks = [];
        if (socket) this.attach(socket);
    }

    pause() {
        if (this.targetsocket.pause) {
            this.targetsocket.pause();
            this.readable = false;
        }
    }

    resume() {
        if (this.targetsocket.resume) {
            this.readable = true;
            this.targetsocket.resume();
        }
    }

    attach(socket) {
        const self = this;
        self.targetsocket = socket;
        self.targetsocket.on('data', data => {
            self.emit('data', data);
        });
        self.targetsocket.on('connect', (a, b) => {
            self.emit('connect', a, b);
        });
        self.targetsocket.on('secureConnect', (a, b) => {
            self.emit('secureConnect', a, b);
            self.emit('secure', a, b);
        });
        self.targetsocket.on('secureConnection', (a, b) => {
            // investigate this for removal, see #2743
            self.emit('secureConnection', a, b);
            self.emit('secure', a, b);
        });
        self.targetsocket.on('secure', (a, b) => {
            self.emit('secureConnection', a, b);
            self.emit('secure', a, b);
        });
        self.targetsocket.on('end', () => {
            self.writable = self.targetsocket.writable;
            self.emit('end');
        });
        self.targetsocket.on('close', had_error => {
            self.writable = self.targetsocket.writable;
            self.emit('close', had_error);
        });
        self.targetsocket.on('drain', () => {
            self.emit('drain');
        });
        self.targetsocket.once('error', exception => {
            self.writable = self.targetsocket.writable;
            exception.source = 'tls';
            self.emit('error', exception);
        });
        self.targetsocket.on('timeout', () => {
            self.emit('timeout');
        });
        if (self.targetsocket.remotePort) {
            self.remotePort = self.targetsocket.remotePort;
        }
        if (self.targetsocket.remoteAddress) {
            self.remoteAddress = self.targetsocket.remoteAddress;
        }
    }
    clean(data) {
        if (this.targetsocket && this.targetsocket.removeAllListeners) {
            [
                'data',
                'secure',
                'secureConnect',
                'secureConnection',
                'end',
                'close',
                'error',
                'drain',
            ].forEach(name => {
                this.targetsocket.removeAllListeners(name);
            });
        }
        this.targetsocket = {};
        this.targetsocket.write = () => {};
    }

    write(data, encoding, callback) {
        if (this.targetsocket.write) {
            return this.targetsocket.write(data, encoding, callback);
        }
        return false;
    }

    end(data, encoding) {
        if (this.targetsocket.end) {
            return this.targetsocket.end(data, encoding);
        }
    }

    destroySoon() {
        if (this.targetsocket.destroySoon) {
            return this.targetsocket.destroySoon();
        }
    }

    destroy() {
        if (this.targetsocket.destroy) {
            return this.targetsocket.destroy();
        }
    }

    setKeepAlive(bool) {
        this._keepalive = bool;
        return this.targetsocket.setKeepAlive(bool);
    }

    setNoDelay(/* true||false */) {}

    unref() {
        return this.targetsocket.unref();
    }

    setTimeout(timeout) {
        this._timeout = timeout;
        return this.targetsocket.setTimeout(timeout);
    }
}

exports.parse_x509_names = string => {
    // receives the text value of a x509 certificate and returns an array of
    // of names extracted from the Subject CN and the v3 Subject Alternate Names
    const names_found = [];

    // log.loginfo(string);

    let match = /Subject:.*?CN=([^/\s]+)/.exec(string);
    if (match) {
        // log.loginfo(match[0]);
        if (match[1]) {
            // log.loginfo(match[1]);
            names_found.push(match[1]);
        }
    }

    match = /X509v3 Subject Alternative Name:[^]*X509/.exec(string);
    if (match) {
        let dns_name;
        const re = /DNS:([^,]+)[,\n]/g;
        while ((dns_name = re.exec(match[0])) !== null) {
            // log.loginfo(dns_name);
            if (names_found.includes(dns_name[1])) continue; // ignore dupes
            names_found.push(dns_name[1]);
        }
    }

    return names_found;
};

exports.parse_x509_expire = (file, string) => {
    const dateMatch = /Not After : (.*)/.exec(string);
    if (!dateMatch) return;

    // log.loginfo(dateMatch[1]);
    return new Date(dateMatch[1]);
};

exports.parse_x509 = string => {
    const res = {};

    const match = /^([^-]*)?([-]+BEGIN (?:\w+\s)?PRIVATE KEY[-]+[^-]+[-]+END (?:\w+\s)?PRIVATE KEY[-]+\n)([^]*)$/.exec(
        string
    );
    if (!match) return res;

    if (match[1] && match[1].length) {
        log.logerror('leading garbage');
        log.logerror(match[1]);
    }
    if (!match[2] || !match[2].length) return res;
    res.key = Buffer.from(match[2]);

    if (!match[3] || !match[3].length) return res;
    res.cert = Buffer.from(match[3]);

    return res;
};

exports.load_tls_ini = opts => {
    const tlss = this;

    log.loginfo(`loading tls.ini`); // from ${this.config.root_path}`);

    const cfg = exports.config.get(
        'tls.ini',
        {
            booleans: [
                '-redis.disable_for_failed_hosts',

                // wildcards match in any section and are not initialized
                '*.requestCert',
                '*.rejectUnauthorized',
                '*.honorCipherOrder',
                '*.enableOCSPStapling',
                '*.requestOCSP',

                // explicitely declared booleans are initialized
                '+main.requestCert',
                '-main.rejectUnauthorized',
                '+main.honorCipherOrder',
                '-main.requestOCSP',
                '-main.mutual_tls',
            ],
        },
        () => {
            tlss.load_tls_ini();
        }
    );

    if (cfg.no_tls_hosts === undefined) cfg.no_tls_hosts = {};
    if (cfg.mutual_auth_hosts === undefined) cfg.mutual_auth_hosts = {};
    if (cfg.mutual_auth_hosts_exclude === undefined)
        cfg.mutual_auth_hosts_exclude = {};

    if (cfg.main.enableOCSPStapling !== undefined) {
        log.logerror('deprecated setting enableOCSPStapling in tls.ini');
        cfg.main.requestOCSP = cfg.main.enableOCSPStapling;
    }

    if (ocsp === undefined && cfg.main.requestOCSP) {
        try {
            ocsp = require('ocsp');
            log.logdebug('ocsp loaded');
            ocspCache = new ocsp.Cache();
        } catch (ignore) {
            log.lognotice('OCSP Stapling not available.');
        }
    }

    if (cfg.main.requireAuthorized === undefined) {
        cfg.main.requireAuthorized = [];
    } else if (!Array.isArray(cfg.main.requireAuthorized)) {
        cfg.main.requireAuthorized = [cfg.main.requireAuthorized];
    }

    tlss.cfg = cfg;

    if (!opts || opts.role === 'server') {
        tlss.applySocketOpts('*');
        tlss.load_default_opts();
    }

    return cfg;
};

exports.saveOpt = (name, opt, val) => {
    if (certsByHost[name] === undefined) certsByHost[name] = {};
    certsByHost[name][opt] = val;
};

exports.applySocketOpts = name => {
    const tlss = this;

    if (!certsByHost[name]) certsByHost[name] = {};

    // https://nodejs.org/api/tls.html#tls_new_tls_tlssocket_socket_options
    const TLSSocketOptions = [
        // 'server'        // manually added
        'isServer',
        'requestCert',
        'rejectUnauthorized',
        'NPNProtocols',
        'ALPNProtocols',
        'session',
        'requestOCSP',
        'secureContext',
        'SNICallback',
    ];

    // https://nodejs.org/api/tls.html#tls_tls_createsecurecontext_options
    const createSecureContextOptions = [
        'key',
        'cert',
        'dhparam',
        'pfx',
        'passphrase',
        'ca',
        'crl',
        'ciphers',
        'minVersion',
        'honorCipherOrder',
        'ecdhCurve',
        'secureProtocol',
        'secureOptions',
        'sessionIdContext',
    ];

    const allOpts = TLSSocketOptions.concat(createSecureContextOptions);

    allOpts.forEach(opt => {
        if (tlss.cfg[name] && tlss.cfg[name][opt] !== undefined) {
            // if the setting exists in tls.ini [name]
            tlss.saveOpt(name, opt, tlss.cfg[name][opt]);
            return;
        }

        if (tlss.cfg.main[opt] !== undefined) {
            // if the setting exists in tls.ini [main]
            // then save it to the certsByHost options
            tlss.saveOpt(name, opt, tlss.cfg.main[opt]);
            return;
        }

        // defaults
        switch (opt) {
            case 'sessionIdContext':
                tlss.saveOpt(name, opt, 'haraka');
                break;
            case 'isServer':
                tlss.saveOpt(name, opt, true);
                break;
            case 'key':
                tlss.saveOpt(name, opt, 'tls_key.pem');
                break;
            case 'cert':
                tlss.saveOpt(name, opt, 'tls_cert.pem');
                break;
            case 'dhparam':
                tlss.saveOpt(name, opt, 'dhparams.pem');
                break;
            case 'SNICallback':
                tlss.saveOpt(name, opt, SNICallback);
                break;
        }
    });
};

exports.load_default_opts = () => {
    const tlss = this;

    const cfg = certsByHost['*'];

    if (cfg.dhparam && typeof cfg.dhparam === 'string') {
        log.logdebug(`loading dhparams from ${cfg.dhparam}`);
        tlss.saveOpt('*', 'dhparam', tlss.config.get(cfg.dhparam, 'binary'));
    }

    if (cfg.ca && typeof cfg.ca === 'string') {
        log.loginfo(`loading CA certs from ${cfg.ca}`);
        tlss.saveOpt('*', 'ca', tlss.config.get(cfg.ca, 'binary'));
    }

    // make non-array key/cert option into Arrays with one entry
    if (!Array.isArray(cfg.key)) cfg.key = [cfg.key];
    if (!Array.isArray(cfg.cert)) cfg.cert = [cfg.cert];

    if (cfg.key.length != cfg.cert.length) {
        log.logerror(
            `number of keys (${cfg.key.length}) not equal to certs (${cfg.cert.length}).`
        );
    }

    // if key file has already been loaded, it'll be a Buffer.
    if (typeof cfg.key[0] === 'string') {
        // turn key/cert file names into actual key/cert binary data
        const asArray = cfg.key.map(keyFileName => {
            if (!keyFileName) return;
            const key = tlss.config.get(keyFileName, 'binary');
            if (!key) {
                log.logerror(
                    `tls key ${path.join(
                        tlss.config.root_path,
                        keyFileName
                    )} could not be loaded.`
                );
            }
            return key;
        });
        tlss.saveOpt('*', 'key', asArray);
    }

    if (typeof cfg.cert[0] === 'string') {
        const asArray = cfg.cert.map(certFileName => {
            if (!certFileName) return;
            const cert = tlss.config.get(certFileName, 'binary');
            if (!cert) {
                log.logerror(
                    `tls cert ${path.join(
                        tlss.config.root_path,
                        certFileName
                    )} could not be loaded.`
                );
            }
            return cert;
        });
        tlss.saveOpt('*', 'cert', asArray);
    }

    if (cfg.cert[0] && cfg.key[0]) {
        tlss.tls_valid = true;

        // now that all opts are applied, generate TLS context
        tlss.ensureDhparams(() => {
            ctxByHost['*'] = tls.createSecureContext(cfg);
        });
    }
};

function SNICallback(servername, sniDone) {
    log.logdebug(`SNI servername: ${servername}`);

    if (ctxByHost[servername] === undefined) servername = '*';

    sniDone(null, ctxByHost[servername]);
}

exports.get_certs_dir = (tlsDir, done) => {
    const tlss = this;

    tlss.config.getDir(tlsDir, {}, (iterErr, files) => {
        if (iterErr) return done(iterErr);

        async.map(
            files,
            (file, iter_done) => {
                const parsed = exports.parse_x509(file.data.toString());
                if (!parsed.key) {
                    return iter_done(null, {
                        err: new Error(`no PRIVATE key in ${file.path}`),
                        file,
                    });
                }
                if (!parsed.cert) {
                    return iter_done(null, {
                        err: new Error(`no CERT in ${file.path}`),
                        file,
                    });
                }

                const x509args = { noout: true, text: true };

                openssl('x509', parsed.cert, x509args, (e, as_str) => {
                    if (e) {
                        log.logerror(`BAD TLS in ${file.path}`);
                        log.logerror(e);
                    }

                    const expire = tlss.parse_x509_expire(file, as_str);
                    if (expire && expire < new Date()) {
                        log.logerror(`${file.path} expired on ${expire}`);
                    }

                    iter_done(null, {
                        err: e,
                        file: path.basename(file.path),
                        key: parsed.key,
                        cert: parsed.cert,
                        names: tlss.parse_x509_names(as_str),
                        expires: expire,
                    });
                });
            },
            (finalErr, certs) => {
                if (finalErr) log.logerror(finalErr);

                if (!certs || !certs.length) {
                    log.loginfo('found 0 TLS certs in config/tls');
                    return done(null, certs);
                }

                log.loginfo(`found ${certs.length} TLS certs in config/tls`);
                certs.forEach(cert => {
                    if (undefined === cert) return;
                    if (cert.err) {
                        log.logerror(
                            `${cert.file} had error: ${cert.err.message}`
                        );
                        return;
                    }

                    // log.logdebug(cert);  // DANGER: Also logs private key!
                    cert.names.forEach(name => {
                        tlss.applySocketOpts(name);

                        tlss.saveOpt(name, 'cert', cert.cert);
                        tlss.saveOpt(name, 'key', cert.key);
                        if (
                            certsByHost['*'] !== undefined &&
                            certsByHost['*'].dhparam
                        ) {
                            // copy in dhparam from default '*' TLS config
                            tlss.saveOpt(
                                name,
                                'dhparam',
                                certsByHost['*'].dhparam
                            );
                        }

                        // now that all opts are applied, generate TLS context
                        ctxByHost[name] = tls.createSecureContext(
                            certsByHost[name]
                        );
                    });
                });

                // log.loginfo(exports.certsByHost);
                done(null, exports.certsByHost);
            }
        );
    });
};

exports.getSocketOpts = (name, done) => {
    const tlss = this;

    // startup time, load the config/tls dir
    if (!certsByHost['*']) tlss.load_tls_ini();

    tlss.get_certs_dir('tls', () => {
        if (certsByHost[name]) {
            // log.logdebug(certsByHost[name]);
            return done(certsByHost[name]);
        }
        // log.logdebug(certsByHost['*']);
        done(certsByHost['*']);
    });
};

function pipe(cleartext, socket) {
    cleartext.socket = socket;

    function onError(e) {}

    function onClose() {
        socket.removeListener('error', onError);
        socket.removeListener('close', onClose);
    }

    socket.on('error', onError);
    socket.on('close', onClose);
}

exports.ensureDhparams = done => {
    const tlss = this;

    // empty/missing dhparams file
    if (certsByHost['*'].dhparam) {
        return done(null, certsByHost['*'].dhparam);
    }

    if (cluster.isWorker) return; // only once, on the master process

    const filePath = tlss.cfg.main.dhparam || 'dhparams.pem';
    const fpResolved = path.resolve(exports.config.root_path, filePath);

    log.loginfo(`Generating a 2048 bit dhparams file at ${fpResolved}`);

    const o = spawn('openssl', ['dhparam', '-out', `${fpResolved}`, '2048']);
    o.stdout.on('data', data => {
        // normally empty output
        log.logdebug(data);
    });

    o.stderr.on('data', data => {
        // this is the status gibberish `openssl dhparam` spews as it works
    });

    o.on('close', code => {
        if (code !== 0) {
            return done(`Error code: ${code}`);
        }

        log.loginfo(`Saved to ${fpResolved}`);
        const content = tlss.config.get(filePath, 'binary');

        tlss.saveOpt('*', 'dhparam', content);
        done(null, certsByHost['*'].dhparam);
    });
};

exports.addOCSP = server => {
    if (!ocsp) {
        log.logdebug('addOCSP: not available');
        return;
    }

    if (server.listenerCount('OCSPRequest') > 0) {
        log.logdebug('OCSPRequest already listening');
        return;
    }

    log.logdebug('adding OCSPRequest listener');
    server.on('OCSPRequest', (cert, issuer, ocr_cb) => {
        log.logdebug(`OCSPRequest: ${cert}`);
        ocsp.getOCSPURI(cert, (err, uri) => {
            log.logdebug(`OCSP Request, URI: ${uri}, err=${err}`);
            if (err) return ocr_cb(err);
            if (uri === null) return ocr_cb(); // not working OCSP server

            const req = ocsp.request.generate(cert, issuer);

            // look for a cached value first
            ocspCache.probe(req.id, (err2, cached) => {
                if (err2) return ocr_cb(err2);

                if (cached) {
                    log.logdebug(`OCSP cache: ${util.inspect(cached)}`);
                    return ocr_cb(err2, cached.response);
                }

                const options = {
                    url: uri,
                    ocsp: req.data,
                };

                log.logdebug(`OCSP req:${util.inspect(req)}`);
                ocspCache.request(req.id, options, ocr_cb);
            });
        });
    });
};

exports.shutdown = () => {
    if (ocsp) cleanOcspCache();
};

function cleanOcspCache() {
    log.logdebug(
        `Cleaning ocspCache. How many keys? ${
            Object.keys(ocspCache.cache).length
        }`
    );
    Object.keys(ocspCache.cache).forEach(key => {
        clearTimeout(ocspCache.cache[key].timer);
    });
}

exports.certsByHost = certsByHost;
exports.ocsp = ocsp;

exports.get_rejectUnauthorized = (rejectUnauthorized, port, port_list) => {
    // console.log(`rejectUnauthorized: ${rejectUnauthorized}, port ${port}, list: ${port_list}`)
    if (rejectUnauthorized) {
        // console.log('true for all ports');
        return true;
    }
    if (port_list.includes(port)) {
        // console.log('port matched true');
        return true;
    }
    // console.log('returning default false');
    return false;
};

function createServer(cb) {
    const server = net.createServer(cryptoSocket => {
        const socket = new pluggableStream(cryptoSocket);

        exports.addOCSP(server);

        socket.upgrade = cb2 => {
            log.logdebug('Upgrading to TLS');

            socket.clean();

            cryptoSocket.removeAllListeners('data');

            const options = Object.assign({}, certsByHost['*']);
            options.server = server; // TLSSocket needs server for SNI to work

            options.rejectUnauthorized = exports.get_rejectUnauthorized(
                options.rejectUnauthorized,
                cryptoSocket.localPort,
                exports.cfg.main.requireAuthorized
            );

            const cleartext = new tls.TLSSocket(cryptoSocket, options);

            pipe(cleartext, cryptoSocket);

            cleartext
                .on('error', exception => {
                    exception.source = 'tls';
                    socket.emit('error', exception);
                })
                .on('secure', () => {
                    log.logdebug('TLS secured.');
                    socket.emit('secure');
                    const cipher = cleartext.getCipher();
                    cipher.version = cleartext.getProtocol();
                    if (cb2)
                        cb2(
                            cleartext.authorized,
                            cleartext.authorizationError,
                            cleartext.getPeerCertificate(),
                            cipher
                        );
                });

            socket.cleartext = cleartext;

            if (socket._timeout) {
                cleartext.setTimeout(socket._timeout);
            }

            cleartext.setKeepAlive(socket._keepalive);

            socket.attach(socket.cleartext);
        };

        cb(socket);
    });

    return server;
}

function getCertFor(host) {
    if (host && certsByHost[host]) return certsByHost[host];
    return certsByHost['*']; // the default TLS cert
}

function connect(port, host, cb) {
    let conn_options = {};
    if (typeof port === 'object') {
        conn_options = port;
        cb = host;
    } else {
        conn_options.port = port;
        conn_options.host = host;
    }

    const cryptoSocket = net.connect(conn_options);

    const socket = new pluggableStream(cryptoSocket);

    socket.upgrade = (options, cb2) => {
        socket.clean();
        cryptoSocket.removeAllListeners('data');

        if (exports.tls_valid) {
            /* SUNSET notice: code added 2021-01. We've changed the default to not
               send TLS client certificates. The mutual_tls flag switches them back
               on. If no need for these settings surfaces in 2 years, nuke this block
               of code. If you care about these options, create a PR removing this
               comment. See #2693.
            */
            if (exports.cfg === undefined) exports.load_tls_ini();
            if (exports.cfg.mutual_auth_hosts[host]) {
                options = Object.assign(
                    options,
                    getCertFor(exports.cfg.mutual_auth_hosts[host])
                );
            } else if (exports.cfg.mutual_auth_hosts_exclude[host]) {
                // send no client cert
            } else if (exports.cfg.main.mutual_tls) {
                options = Object.assign(options, getCertFor(host));
            }
        }
        options.socket = cryptoSocket;

        const cleartext = new tls.connect(options);

        pipe(cleartext, cryptoSocket);

        cleartext.on('error', err => {
            if (err.reason) {
                log.logerror(`client TLS error: ${err}`);
            }
        });

        cleartext.once('secureConnect', () => {
            log.logdebug('client TLS secured.');
            const cipher = cleartext.getCipher();
            cipher.version = cleartext.getProtocol();
            if (cb2)
                cb2(
                    cleartext.authorized,
                    cleartext.authorizationError,
                    cleartext.getPeerCertificate(),
                    cipher
                );
        });

        socket.cleartext = cleartext;

        if (socket._timeout) {
            cleartext.setTimeout(socket._timeout);
        }

        cleartext.setKeepAlive(socket._keepalive);

        socket.attach(socket.cleartext);

        log.logdebug('client TLS upgrade in progress, awaiting secured.');
    };

    return socket;
}

exports.connect = connect;
exports.createConnection = connect;
exports.Server = createServer;
exports.createServer = createServer;
