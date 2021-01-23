// Queue to qmail-queue

const childproc = require('child_process');
const fs = require('fs');

exports.register = function() {
    const plugin = this;

    plugin.queue_exec =
        plugin.config.get('qmail-queue.path') || '/var/qmail/bin/qmail-queue';
    if (!fs.existsSync(plugin.queue_exec)) {
        throw new Error(
            `Cannot find qmail-queue binary (${plugin.queue_exec})`
        );
    }

    plugin.load_qmail_queue_ini();

    if (plugin.cfg.main.enable_outbound) {
        plugin.register_hook('queue_outbound', 'hook_queue');
    }
};

exports.load_qmail_queue_ini = function() {
    const plugin = this;

    plugin.cfg = plugin.config.get(
        'qmail-queue.ini',
        {
            booleans: ['+main.enable_outbound'],
        },
        () => {
            plugin.load_qmail_queue_ini();
        }
    );
};

exports.hook_queue = function(next, connection) {
    const plugin = this;

    const txn = connection.transaction;

    const q_wants = txn.notes.get('queue.wants');
    if (q_wants && q_wants !== 'qmail-queue') return next();

    const qmail_queue = childproc.spawn(
        this.queue_exec, // process name
        [], // arguments
        { stdio: ['pipe', 'pipe', process.stderr] }
    );

    qmail_queue.on('exit', function finished(code) {
        if (code !== 0) {
            connection.logerror(
                plugin,
                `Unable to queue message to qmail-queue: ${code}`
            );
            next();
        } else {
            next(OK, 'Queued!');
        }
    });

    connection.transaction.message_stream.pipe(qmail_queue.stdin, {
        line_endings: '\n',
    });

    qmail_queue.stdin.on('close', () => {
        if (!connection.transaction) {
            plugin.logerror(
                'Transaction went away while delivering mail to qmail-queue'
            );

            try {
                qmail_queue.stdout.end();
            } catch (err) {
                if (err.code !== 'ENOTCONN') {
                    // Ignore ENOTCONN and re throw anything else
                    throw err;
                }
            }

            connection.results.add(plugin, { err: 'dead sender' });
            return;
        }
        plugin.loginfo('Message Stream sent to qmail. Now sending envelope');
        // now send envelope
        // Hope this will be big enough...
        const buf = Buffer.alloc(4096);
        let p = 0;
        buf[p++] = 70;
        const mail_from = connection.transaction.mail_from.address();
        for (let i = 0; i < mail_from.length; i++) {
            buf[p++] = mail_from.charCodeAt(i);
        }
        buf[p++] = 0;
        connection.transaction.rcpt_to.forEach(rcpt => {
            buf[p++] = 84;
            const rcpt_to = rcpt.address();
            for (let j = 0; j < rcpt_to.length; j++) {
                buf[p++] = rcpt_to.charCodeAt(j);
            }
            buf[p++] = 0;
        });
        buf[p++] = 0;
        qmail_queue.stdout.on('error', err => {}); // stdout throws an error on close
        qmail_queue.stdout.end(buf);
    });
};
