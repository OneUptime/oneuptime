'use strict';

const generic_pool = require('generic-pool');
const utils = require('haraka-utils');

const sock = require('../line_socket');
const server = require('../server');
const logger = require('../logger');

const obc = require('./config');

function _create_socket(
    pool_name,
    port,
    host,
    local_addr,
    is_unix_socket,
    callback
) {
    const socket = is_unix_socket
        ? sock.connect({ path: host })
        : sock.connect({ port, host, localAddress: local_addr });
    socket.__pool_name = pool_name;
    socket.__uuid = utils.uuid();
    socket.setTimeout(obc.cfg.connect_timeout * 1000);
    logger.logdebug('[outbound] created', {
        uuid: socket.__uuid,
        host,
        port,
        pool_timeout: obc.cfg.pool_timeout,
    });
    socket.once('connect', () => {
        socket.removeAllListeners('error'); // these get added after callback
        socket.removeAllListeners('timeout');
        callback(null, socket);
    });
    socket.once('error', err => {
        socket.end();
        socket.removeAllListeners();
        socket.destroy();
        callback(`Outbound connection error: ${err}`, null);
    });
    socket.once('timeout', () => {
        socket.end();
        socket.removeAllListeners();
        socket.destroy();
        callback(`Outbound connection timed out to ${host}:${port}`, null);
    });
}

// Separate pools are kept for each set of server attributes.
function get_pool(port, host, local_addr, is_unix_socket, max) {
    port = port || 25;
    host = host || 'localhost';
    const name = `outbound::${port}:${host}:${local_addr}:${obc.cfg.pool_timeout}`;
    if (!server.notes.pool) server.notes.pool = {};
    if (server.notes.pool[name]) return server.notes.pool[name];

    const pool = generic_pool.Pool({
        name,
        create(done) {
            _create_socket(
                this.name,
                port,
                host,
                local_addr,
                is_unix_socket,
                done
            );
        },
        validate: socket => socket.__fromPool && socket.writable,
        destroy: socket => {
            logger.logdebug(
                `[outbound] destroying pool entry ${socket.__uuid} for ${host}:${port}`
            );
            socket.removeAllListeners();
            socket.__fromPool = false;
            socket.on('line', line => {
                // Just assume this is a valid response
                logger.logprotocol(`[outbound] S: ${line}`);
            });
            socket.once('error', err => {
                logger.logwarn(
                    `[outbound] Socket got an error while shutting down: ${err}`
                );
            });
            socket.once('end', () => {
                logger.loginfo(
                    '[outbound] Remote end half closed during destroy()'
                );
                socket.destroy();
            });
            if (socket.writable) {
                logger.logprotocol(`[outbound] [${socket.__uuid}] C: QUIT`);
                socket.write('QUIT\r\n');
            }
            socket.end(); // half close
        },
        max: max || 10,
        idleTimeoutMillis: obc.cfg.pool_timeout * 1000,
        log: (str, level) => {
            if (/this._availableObjects.length=/.test(str)) return;
            level = level === 'verbose' ? 'debug' : level;
            logger[`log${level}`](`[outbound] [${name}] ${str}`);
        },
    });
    server.notes.pool[name] = pool;

    return pool;
}

// Get a socket for the given attributes.
exports.get_client = (port, host, local_addr, is_unix_socket, callback) => {
    if (obc.cfg.pool_concurrency_max == 0) {
        return _create_socket(
            null,
            port,
            host,
            local_addr,
            is_unix_socket,
            callback
        );
    }

    const pool = get_pool(
        port,
        host,
        local_addr,
        is_unix_socket,
        obc.cfg.pool_concurrency_max
    );
    if (pool.waitingClientsCount() >= obc.cfg.pool_concurrency_max) {
        return callback('Too many waiting clients for pool', null);
    }
    pool.acquire((err, socket) => {
        if (err) return callback(err);
        socket.__acquired = true;
        logger.loginfo(
            `[outbound] acquired socket ${socket.__uuid} for ${socket.__pool_name}`
        );
        callback(null, socket);
    });
};

exports.release_client = (socket, port, host, local_addr, error) => {
    logger.logdebug(
        `[outbound] release_client: ${socket.__uuid} ${host}:${port} to ${local_addr}`
    );

    const name = socket.__pool_name;

    if (!name && obc.cfg.pool_concurrency_max == 0) {
        return sockend();
    }

    if (!socket.__acquired) {
        logger.logwarn(
            `Release an un-acquired socket. Stack: ${new Error().stack}`
        );
        return;
    }
    socket.__acquired = false;

    if (!(server.notes && server.notes.pool)) {
        logger.logcrit(
            `[outbound] Releasing a pool (${name}) that doesn't exist!`
        );
        return;
    }
    const pool = server.notes.pool[name];
    if (!pool) {
        logger.logcrit(
            `[outbound] Releasing a pool (${name}) that doesn't exist!`
        );
        return;
    }

    if (error) {
        return sockend();
    }

    if (obc.cfg.pool_timeout == 0) {
        logger.loginfo('[outbound] Pool_timeout is zero - shutting it down');
        return sockend();
    }

    for (const event of ['close', 'error', 'end', 'timeout', 'line']) {
        socket.removeAllListeners(event);
    }

    socket.__fromPool = true;

    socket.once('error', err => {
        logger.logwarn(
            `[outbound] Socket [${name}] in pool got an error: ${err}`
        );
        sockend();
    });

    socket.once('end', () => {
        logger.loginfo(`[outbound] Socket [${name}] in pool got FIN`);
        socket.writable = false;
        sockend();
    });

    pool.release(socket);

    function sockend() {
        socket.__fromPool = false;
        if (server.notes.pool && server.notes.pool[name]) {
            server.notes.pool[name].destroy(socket);
        } else {
            socket.removeAllListeners();
            socket.destroy();
        }
    }
};

exports.drain_pools = () => {
    if (!server.notes.pool || Object.keys(server.notes.pool).length == 0) {
        return logger.logdebug('[outbound] Drain pools: No pools available');
    }
    Object.keys(server.notes.pool).forEach(p => {
        logger.logdebug(
            `[outbound] Drain pools: Draining SMTP connection pool ${p}`
        );
        server.notes.pool[p].drain(() => {
            if (!server.notes.pool[p]) return;
            server.notes.pool[p].destroyAllNow();
            delete server.notes.pool[p];
        });
    });
    logger.logdebug('[outbound] Drain pools: Pools shut down');
};
