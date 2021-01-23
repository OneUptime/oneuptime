'use strict';

const fs = require('fs');
const path = require('path');
const async = require('async');

exports.register = function() {
    this.outbound = require('../outbound');
    this.queue_dir = require('../outbound/queue').queue_dir;
};

exports.hook_capabilities = (next, connection) => {
    if (connection.remote.is_local) {
        connection.capabilities.push('STATUS');
    }

    next();
};

exports.hook_unrecognized_command = function(next, connection, params) {
    if (params[0] !== 'STATUS') return next();
    if (!connection.remote.is_local)
        return next(DENY, 'STATUS not allowed remotely');

    this.run(params[1], (err, result) => {
        if (err) return next(DENY, err.message);

        connection.respond(211, result ? JSON.stringify(result) : 'null', () =>
            next(OK)
        );
    });
};

exports.run = function(cmd, cb) {
    if (server.cluster && !/^QUEUE LIST/.test(cmd)) {
        this.call_master(cmd, cb);
    } else {
        this.command_action(cmd, cb);
    }
};

exports.command_action = function(cmd, cb) {
    const params = cmd.split(' ');

    switch (params.shift()) {
        case 'POOL':
            return this.pool_action(params, cb);
        case 'QUEUE':
            return this.queue_action(params, cb);
        default:
            cb('unknown STATUS command');
    }
};

exports.pool_action = function(params, cb) {
    switch (params.shift()) {
        case 'LIST':
            return this.pool_list(cb);
        default:
            cb('unknown POOL command');
    }
};

exports.queue_action = function(params, cb) {
    switch (params.shift()) {
        case 'LIST':
            return this.queue_list(cb);
        case 'STATS':
            return this.queue_stats(cb);
        case 'INSPECT':
            return this.queue_inspect(cb);
        case 'DISCARD':
            return this.queue_discard(params.shift(), cb);
        case 'PUSH':
            return this.queue_push(params.shift(), cb);
        default:
            cb('unknown QUEUE command');
    }
};

exports.pool_list = cb => {
    const result = {};

    if (server.notes.pool) {
        Object.keys(server.notes.pool).forEach(name => {
            const instance = server.notes.pool[name];

            result[name] = {
                inUse: instance.inUseObjectsCount(),
                size: instance.getPoolSize(),
            };
        });
    }

    cb(null, result);
};

exports.queue_list = function(cb) {
    this.outbound.list_queue((err, qlist) => {
        if (err) cb(err);

        const result = [];

        if (qlist) {
            qlist.forEach(todo =>
                result.push({
                    file: todo.file,
                    uuid: todo.uuid,
                    queue_time: todo.queue_time,
                    domain: todo.domain,
                    from: todo.mail_from.toString(),
                    to: todo.rcpt_to.map(r => r.toString()),
                })
            );
        }

        cb(err, result);
    });
};

exports.queue_stats = function(cb) {
    cb(null, this.outbound.get_stats());
};

exports.queue_inspect = function(cb) {
    const delivery_queue_items = this.outbound.delivery_queue._tasks.toArray();
    const fail_queue_items = this.outbound.temp_fail_queue.queue;

    cb(null, {
        delivery_queue: delivery_queue_items.map(hmail => ({
            id: hmail.file,
        })),
        temp_fail_queue: fail_queue_items.map(tqtimer => ({
            id: tqtimer.id,
            fire_time: tqtimer.fire_time,
        })),
    });
};

exports.queue_discard = function(file, cb) {
    try {
        this.outbound.temp_fail_queue.discard(file);
    } catch (e) {
        // we ignore not found error
    }

    fs.unlink(path.join(this.queue_dir || '', file), () => {
        cb(null, 'OK');
    });
};

exports.queue_push = function(file, cb) {
    const queue = this.outbound.temp_fail_queue.queue;

    for (let i = 0; i < queue.length; i++) {
        if (queue[i].id !== file) continue;

        const item = queue.splice(i, 1)[0];
        item.cb();

        break;
    }

    cb(null, 'OK');
};

// cluster IPC

exports.hook_init_master = function(next) {
    const self = this;

    if (!server.cluster) return next();

    function message_handler(sender, msg) {
        if (msg.event !== 'status.request') return;

        self.call_workers(msg, (err, response) => {
            msg.result = response.filter(el => el != null);
            msg.event = 'status.result';
            sender.send(msg);
        });
    }

    server.cluster.on('message', message_handler);
    next();
};

exports.hook_init_child = function(next) {
    const self = this;

    function message_handler(msg) {
        if (msg.event !== 'status.request') return;

        self.command_action(msg.params, (err, result) => {
            msg.event = 'status.response';
            msg.result = result;
            process.send(msg);
        });
    }

    process.on('message', message_handler);
    next();
};

exports.call_master = (cmd, cb) => {
    function message_handler(msg) {
        if (msg.event !== 'status.result') return;

        process.removeListener('message', message_handler);
        cb(null, msg.result);
    }

    process.on('message', message_handler);
    process.send({ event: 'status.request', params: cmd });
};

exports.call_workers = function(cmd, cb) {
    const self = this;

    async.map(
        server.cluster.workers,
        (w, done) => {
            self.call_worker(w, cmd, done);
        },
        cb
    );
};

// sends command to worker and then wait for response or timeout
exports.call_worker = (worker, cmd, cb) => {
    let timeout;

    function message_handler(sender, msg) {
        if (sender.id !== worker.id) return;
        if (msg.event !== 'status.response') return;

        clearTimeout(timeout);
        server.cluster.removeListener('message', message_handler);

        cb(null, msg.result);
    }

    timeout = setTimeout(() => {
        server.cluster.removeListener('message', message_handler);
        cb();
    }, 1000);

    server.cluster.on('message', message_handler);
    worker.send(cmd);
};
