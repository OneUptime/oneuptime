'use strict';
// smtp network server

const daemon = require('daemon');
const fs = require('fs');
const os = require('os');
const path = require('path');
const tls = require('tls');

// let log = require('why-is-node-running');
const tls_socket = require('./tls_socket');
const conn = require('./connection');
const outbound = require('./outbound');
const async = require('async');
const cluster = require('cluster');
const constants = require('haraka-constants');
const endpoint = require('./endpoint');

const Server = exports;
Server.logger = require('./logger');
Server.config = require('haraka-config');
Server.plugins = require('./plugins');
Server.notes = {};

const logger = Server.logger;

// Need these here so we can run hooks
logger.add_log_methods(Server, 'server');

Server.listeners = [];

Server.load_smtp_ini = () => {
    Server.cfg = Server.config.get(
        'smtp.ini',
        {
            booleans: [
                '-main.daemonize',
                '-main.strict_rfc1869',
                '+main.smtputf8',
                '-main.graceful_shutdown',
                '+headers.add_received',
                '+headers.show_version',
                '+headers.clean_auth_results',
            ],
        },
        () => {
            Server.load_smtp_ini();
        }
    );

    if (Server.cfg.main.nodes === undefined) {
        logger.logwarn(
            `smtp.ini.nodes unset, using 1, see https://github.com/haraka/Haraka/wiki/Performance-Tuning`
        );
    }

    const defaults = {
        inactivity_timeout: 300,
        daemon_log_file: '/var/log/haraka.log',
        daemon_pid_file: '/var/run/haraka.pid',
        force_shutdown_timeout: 30,
        smtps_port: 465,
        nodes: 1,
    };

    Server.cfg.headers.max_received =
        parseInt(Server.cfg.headers.max_received) ||
        parseInt(Server.config.get('max_received_count')) ||
        100;
    Server.cfg.headers.max_lines =
        parseInt(Server.cfg.headers.max_lines) ||
        parseInt(Server.config.get('max_header_lines')) ||
        1000;

    const strict_ext = Server.config.get('strict_rfc1869');
    if (Server.cfg.main.strict_rfc1869 === false && strict_ext) {
        logger.logwarn(
            `legacy config config/strict_rfc1869 is overriding smtp.ini`
        );
        Server.cfg.main.strict_rfc1869 = strict_ext;
    }

    const hhv = Server.config.get('header_hide_version'); // backwards compat
    if (hhv !== null && !hhv) Server.cfg.headers.show_version = false;

    for (const key in defaults) {
        if (Server.cfg.main[key] !== undefined) continue;
        Server.cfg.main[key] = defaults[key];
    }
};

Server.load_http_ini = () => {
    Server.http = {};
    Server.http.cfg = Server.config.get('http.ini', () => {
        Server.load_http_ini();
    }).main;
};

Server.load_smtp_ini();
Server.load_http_ini();

Server.daemonize = function() {
    const c = this.cfg.main;
    if (!c.daemonize) return;

    if (!process.env.__daemon) {
        // Remove process.on('exit') listeners otherwise
        // we get a spurious 'Exiting' log entry.
        process.removeAllListeners('exit');
        logger.lognotice('Daemonizing...');
    }

    const log_fd = fs.openSync(c.daemon_log_file, 'a');
    daemon({ cwd: process.cwd(), stdout: log_fd });

    // We are the daemon from here on...
    const npid = require('npid');
    try {
        npid.create(c.daemon_pid_file).removeOnExit();
    } catch (err) {
        logger.logerror(err.message);
        logger.dump_and_exit(1);
    }
};

Server.flushQueue = domain => {
    if (!Server.cluster) {
        outbound.flush_queue(domain);
        return;
    }

    for (const id in cluster.workers) {
        cluster.workers[id].send({ event: 'outbound.flush_queue', domain });
    }
};

let gracefull_in_progress = false;

Server.gracefulRestart = () => {
    Server._graceful();
};

Server.stopListeners = () => {
    logger.loginfo('Shutting down listeners');
    Server.listeners.forEach(server => {
        server.close();
    });
    Server.listeners = [];
};

Server.performShutdown = () => {
    if (Server.cfg.main.graceful_shutdown) {
        return Server.gracefulShutdown();
    }
    logger.loginfo('Shutting down.');
    process.exit(0);
};

Server.gracefulShutdown = () => {
    Server.stopListeners();
    Server._graceful(() => {
        // log();
        logger.loginfo('Failed to shutdown naturally. Exiting.');
        process.exit(0);
    });
};

Server._graceful = shutdown => {
    if (!Server.cluster && shutdown) {
        ['outbound', 'cfreader', 'plugins'].forEach(module => {
            process.emit('message', { event: `${module}.shutdown` });
        });
        const t = setTimeout(
            shutdown,
            Server.cfg.main.force_shutdown_timeout * 1000
        );
        return t.unref();
    }

    if (gracefull_in_progress) {
        logger.lognotice('Restart currently in progress - ignoring request');
        return;
    }

    gracefull_in_progress = true;
    // TODO: Make these configurable
    const disconnect_timeout = 30;
    const exit_timeout = 30;
    cluster.removeAllListeners('exit');
    // we reload using eachLimit where limit = num_workers - 1
    // this kills all-but-one workers in parallel, leaving one running
    // for new connections, and then restarts that one last worker.
    const worker_ids = Object.keys(cluster.workers);
    let limit = worker_ids.length - 1;
    if (limit < 2) limit = 1;
    async.eachLimit(
        worker_ids,
        limit,
        (id, cb) => {
            logger.lognotice(`Killing node: ${id}`);
            const worker = cluster.workers[id];
            ['outbound', 'cfreader', 'plugins'].forEach(module => {
                worker.send({ event: `${module}.shutdown` });
            });
            worker.disconnect();
            let disconnect_received = false;
            const disconnect_timer = setTimeout(() => {
                if (!disconnect_received) {
                    logger.logcrit(
                        'Disconnect never received by worker. Killing.'
                    );
                    worker.kill();
                }
            }, disconnect_timeout * 1000);
            worker.once('disconnect', () => {
                clearTimeout(disconnect_timer);
                disconnect_received = true;
                logger.lognotice('Disconnect complete');
                let dead = false;
                const timer = setTimeout(() => {
                    if (!dead) {
                        logger.logcrit(
                            `Worker ${id} failed to shutdown. Killing.`
                        );
                        worker.kill();
                    }
                }, exit_timeout * 1000);
                worker.once('exit', () => {
                    dead = true;
                    clearTimeout(timer);
                    if (shutdown) cb();
                });
            });
            if (shutdown) return;
            const newWorker = cluster.fork();
            newWorker.once('listening', () => {
                logger.lognotice('Replacement worker online.');
                newWorker.on('exit', (code, signal) => {
                    cluster_exit_listener(newWorker, code, signal);
                });
                cb();
            });
        },
        err => {
            // err can basically never happen, but fuckit...
            if (err) logger.logerror(err);
            if (shutdown) {
                logger.loginfo(
                    'Workers closed. Shutting down master process subsystems'
                );
                ['outbound', 'cfreader', 'plugins'].forEach(module => {
                    process.emit('message', { event: `${module}.shutdown` });
                });
                const t2 = setTimeout(
                    shutdown,
                    Server.cfg.main.force_shutdown_timeout * 1000
                );
                return t2.unref();
            }
            gracefull_in_progress = false;
            logger.lognotice(
                `Reload complete, workers: ${JSON.stringify(
                    Object.keys(cluster.workers)
                )}`
            );
        }
    );
};

Server.drainPools = () => {
    if (!Server.cluster) {
        return outbound.drain_pools();
    }

    for (const id in cluster.workers) {
        cluster.workers[id].send({ event: 'outbound.drain_pools' });
    }
};

Server.sendToMaster = (command, params) => {
    // console.log("Send to master: ", command);
    if (Server.cluster) {
        if (Server.cluster.isMaster) {
            Server.receiveAsMaster(command, params);
        } else {
            process.send({ cmd: command, params });
        }
    } else {
        Server.receiveAsMaster(command, params);
    }
};

Server.receiveAsMaster = (command, params) => {
    if (!Server[command]) {
        logger.logerror(`Invalid command: ${command}`);
        return;
    }
    Server[command].apply(Server, params);
};

function messageHandler(worker, msg, handle) {
    // sunset Haraka v3 (Node < 6)
    if (arguments.length === 2) {
        handle = msg;
        msg = worker;
        worker = undefined;
    }
    // console.log("received cmd: ", msg);
    if (msg && msg.cmd) {
        Server.receiveAsMaster(msg.cmd, msg.params);
    }
}

Server.get_listen_addrs = (cfg, port) => {
    if (!port) port = 25;
    let listeners = [];
    if (cfg && cfg.listen) {
        listeners = cfg.listen.split(/\s*,\s*/);
        if (listeners[0] === '') listeners = [];
        for (let i = 0; i < listeners.length; i++) {
            const ep = endpoint(listeners[i], port);
            if (ep instanceof Error) continue;
            listeners[i] = ep.toString();
        }
    }
    if (cfg.port) {
        let host = cfg.listen_host;
        if (!host) {
            host = '[::0]';
            Server.default_host = true;
        }
        listeners.unshift(`${host}:${cfg.port}`);
    }
    if (listeners.length) return listeners;

    Server.default_host = true;
    listeners.push(`[::0]:${port}`);

    return listeners;
};

Server.createServer = params => {
    const c = Server.cfg.main;
    for (const key in params) {
        if (typeof params[key] === 'function') continue;
        c[key] = params[key];
    }

    Server.notes = {};
    Server.plugins.server = Server;
    Server.plugins.load_plugins();

    const inactivity_timeout = (c.inactivity_timeout || 300) * 1000;

    if (!cluster || !c.nodes) {
        Server.daemonize(c);
        Server.setup_smtp_listeners(
            Server.plugins,
            'master',
            inactivity_timeout
        );
        return;
    }

    // Cluster
    Server.cluster = cluster;

    // Cluster Workers
    if (!cluster.isMaster) {
        Server.setup_smtp_listeners(
            Server.plugins,
            'child',
            inactivity_timeout
        );
        return;
    } else {
        // console.log("Setting up message handler");
        cluster.on('message', messageHandler);
    }

    // Cluster Master
    // We fork workers in init_master_respond so that plugins
    // can put handlers on cluster events before they are emitted.
    Server.plugins.run_hooks('init_master', Server);
};

Server.load_default_tls_config = done => {
    // this fn exists solely for testing
    if (Server.config.root_path != tls_socket.config.root_path) {
        logger.loginfo(
            `resetting tls_config.config path to ${Server.config.root_path}`
        );
        tls_socket.config = tls_socket.config.module_config(
            path.dirname(Server.config.root_path)
        );
    }
    tls_socket.getSocketOpts('*', opts => {
        done(opts);
    });
};

Server.get_smtp_server = (ep, inactivity_timeout, done) => {
    let server;

    function onConnect(client) {
        client.setTimeout(inactivity_timeout);
        const connection = conn.createConnection(client, server, Server.cfg);

        if (!server.has_tls) return;

        const cipher = client.getCipher();
        cipher.version = client.getProtocol(); // replace min with actual

        connection.setTLS({
            cipher,
            verified: client.authorized,
            verifyError: client.authorizationError,
            peerCertificate: client.getPeerCertificate(),
        });
    }

    if (ep.port === parseInt(Server.cfg.main.smtps_port, 10)) {
        logger.loginfo('getting SocketOpts for SMTPS server');
        tls_socket.getSocketOpts('*', opts => {
            logger.loginfo(`Creating TLS server on ${ep}`);

            opts.rejectUnauthorized = tls_socket.get_rejectUnauthorized(
                opts.rejectUnauthorized,
                ep.port,
                tls_socket.cfg.main.requireAuthorized
            );

            server = tls.createServer(opts, onConnect);
            tls_socket.addOCSP(server);
            server.has_tls = true;
            server.on('resumeSession', (id, rsDone) => {
                logger.loginfo('client requested TLS resumeSession');
                rsDone(null, null);
            });
            Server.listeners.push(server);
            done(server);
        });
    } else {
        server = tls_socket.createServer(onConnect);
        server.has_tls = false;
        Server.listeners.push(server);
        done(server);
    }
};

Server.setup_smtp_listeners = (plugins2, type, inactivity_timeout) => {
    async.each(
        Server.get_listen_addrs(Server.cfg.main), // array of listeners

        function setupListener(listen_address, listenerDone) {
            const ep = endpoint(listen_address, 25);
            if (ep instanceof Error)
                return listenerDone(
                    new Error(
                        `Invalid "listen" format in smtp.ini: ${listen_address}`
                    )
                );

            Server.get_smtp_server(ep, inactivity_timeout, server => {
                if (!server) return listenerDone();

                server.notes = Server.notes;
                if (Server.cluster) server.cluster = Server.cluster;

                server
                    .on('listening', function() {
                        const addr = this.address();
                        logger.lognotice(`Listening on ${endpoint(addr)}`);
                        listenerDone();
                    })
                    .on('close', () => {
                        logger.loginfo(`Listener ${ep} stopped`);
                    })
                    .on('error', e => {
                        if (e.code !== 'EAFNOSUPPORT') return listenerDone(e);
                        // Fallback from IPv6 to IPv4 if not supported
                        // But only if we supplied the default of [::0]:25
                        if (/^::0/.test(ep.host) && Server.default_host) {
                            server.listen(ep.port, '0.0.0.0', 0);
                            return;
                        }
                        // Pass error to callback
                        listenerDone(e);
                    });
                ep.bind(server, { backlog: 0 });
            });
        },
        function runInitHooks(err) {
            if (err) {
                logger.logerror(`Failed to setup listeners: ${err.message}`);
                return logger.dump_and_exit(-1);
            }
            Server.listening();
            plugins2.run_hooks(`init_${type}`, Server);
        }
    );
};

Server.setup_http_listeners = () => {
    if (!Server.http.cfg) return;
    if (!Server.http.cfg.listen) return;

    const listeners = Server.get_listen_addrs(Server.http.cfg, 80);
    if (!listeners.length) return;

    try {
        Server.http.express = require('express');
        logger.loginfo('express loaded at Server.http.express');
    } catch (err) {
        logger.logerror(
            'express failed to load. No http server. ' +
                ' Try installing express with: npm install -g express'
        );
        return;
    }

    const app = Server.http.express();
    Server.http.app = app;
    logger.loginfo('express app is at Server.http.app');

    function setupListener(listen_address, cb) {
        const ep = endpoint(listen_address, 80);
        if (ep instanceof Error) {
            return cb(
                new Error(
                    `Invalid format for listen in http.ini: ${listen_address}`
                )
            );
        }

        if (443 == ep.port) {
            // clone the default TLS opts
            const tlsOpts = Object.assign({}, tls_socket.certsByHost['*']);
            tlsOpts.requestCert = false; // not appropriate for HTTPS
            // console.log(tlsOpts);
            Server.http.server = require('https').createServer(tlsOpts, app);
        } else {
            Server.http.server = require('http').createServer(app);
        }

        Server.listeners.push(Server.http.server);

        Server.http.server.on('listening', function() {
            const addr = this.address();
            logger.lognotice(`Listening on ${endpoint(addr)}`);
            cb();
        });

        Server.http.server.on('error', e => {
            logger.logerror(e);
            cb(e);
        });

        ep.bind(Server.http.server, { backlog: 0 });
    }

    function registerRoutes(err) {
        if (err) {
            logger.logerror(`Failed to setup http routes: ${err.message}`);
        }

        Server.plugins.run_hooks('init_http', Server);
        // app.use(Server.http.express.static(Server.get_http_docroot()));
        app.use(Server.handle404);
    }

    async.each(listeners, setupListener, registerRoutes);
};

Server.init_master_respond = (retval, msg) => {
    if (!(retval === constants.ok || retval === constants.cont)) {
        Server.logerror(`init_master returned error${msg ? `: ${msg}` : ''}`);
        return logger.dump_and_exit(1);
    }

    const c = Server.cfg.main;
    Server.ready = 1;

    // Load the queue if we're just one process
    if (!(cluster && c.nodes)) {
        outbound.load_queue();
        Server.setup_http_listeners();
        return;
    }

    // Running under cluster, fork children here, so that
    // cluster events can be registered in init_master hooks.
    outbound.scan_queue_pids((err, pids) => {
        if (err) {
            Server.logcrit('Scanning queue failed. Shutting down.');
            return logger.dump_and_exit(1);
        }
        Server.daemonize();
        // Fork workers
        const workers = c.nodes === 'cpus' ? os.cpus().length : c.nodes;
        const new_workers = [];
        for (let i = 0; i < workers; i++) {
            new_workers.push(cluster.fork({ CLUSTER_MASTER_PID: process.pid }));
        }
        for (let j = 0; j < pids.length; j++) {
            new_workers[j % new_workers.length].send({
                event: 'outbound.load_pid_queue',
                data: pids[j],
            });
        }
        cluster.on('online', worker => {
            logger.lognotice('worker started', {
                worker: worker.id,
                pid: worker.process.pid,
            });
        });
        cluster.on('listening', (worker, address) => {
            logger.lognotice(
                `worker ${worker.id} listening on ${endpoint(address)}`
            );
        });
        cluster.on('exit', cluster_exit_listener);
    });
};

function cluster_exit_listener(worker, code, signal) {
    if (signal) {
        logger.lognotice(`worker ${worker.id} killed by signal ${signal}`);
    } else if (code !== 0) {
        logger.lognotice(`worker ${worker.id} exited with error code: ${code}`);
    }
    if (signal || code !== 0) {
        // Restart worker
        const new_worker = cluster.fork({
            CLUSTER_MASTER_PID: process.pid,
        });
        new_worker.send({
            event: 'outbound.load_pid_queue',
            data: worker.process.pid,
        });
    }
}

Server.init_child_respond = (retval, msg) => {
    switch (retval) {
        case constants.ok:
        case constants.cont:
            Server.setup_http_listeners();
            return;
    }

    const pid = process.env.CLUSTER_MASTER_PID;
    Server.logerror(`init_child returned error ${msg ? `: ${msg}` : ''}`);
    try {
        if (pid) {
            process.kill(pid);
            Server.logerror(`Killing master (pid=${pid})`);
        }
    } catch (err) {
        Server.logerror('Terminating child');
    }
    logger.dump_and_exit(1);
};

Server.listening = () => {
    const c = Server.cfg.main;

    // Drop privileges
    if (c.group) {
        Server.lognotice(`Switching from current gid: ${process.getgid()}`);
        process.setgid(c.group);
        Server.lognotice(`New gid: ${process.getgid()}`);
    }
    if (c.user) {
        Server.lognotice(`Switching from current uid: ${process.getuid()}`);
        process.setuid(c.user);
        Server.lognotice(`New uid: ${process.getuid()}`);
    }

    Server.ready = 1;
};

Server.init_http_respond = () => {
    logger.loginfo('init_http_respond');

    let WebSocketServer;
    try {
        WebSocketServer = require('ws').Server;
    } catch (e) {
        logger.logerror(`unable to load ws.\n  did you: npm install -g ws?`);
        return;
    }

    if (!WebSocketServer) {
        logger.logerror('ws failed to load');
        return;
    }

    Server.http.wss = new WebSocketServer({ server: Server.http.server });
    logger.loginfo('Server.http.wss loaded');

    Server.plugins.run_hooks('init_wss', Server);
};

Server.init_wss_respond = () => {
    logger.loginfo('init_wss_respond');
    // logger.logdebug(arguments);
};

// Server.get_http_docroot = () => {
//     if (Server.http.cfg.docroot) return Server.http.cfg.docroot;

//     Server.http.cfg.docroot = path.join( (process.env.HARAKA || __dirname), '/html');
//     logger.loginfo(`using html docroot: ${Server.http.cfg.docroot}`);
//     return Server.http.cfg.docroot;
// }

Server.handle404 = (req, res) => {
    // abandon all hope, serve up a 404
    // respond with json
    if (req.accepts('json')) {
        res.status(404).send({ err: 'Not found' });
        return;
    }

    res.status(404).send('Not found!');
};
