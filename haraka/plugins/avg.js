// avg - AVG virus scanner
'use strict';

// TODO: use pooled connections

const fs = require('fs');
const path = require('path');

const sock = require('./line_socket');
const smtp_regexp = /^([0-9]{3})([ -])(.*)/;

exports.register = function() {
    const plugin = this;

    plugin.load_avg_ini();
};

exports.load_avg_ini = function() {
    const plugin = this;

    plugin.cfg = plugin.config.get(
        'avg.ini',
        {
            booleans: ['+defer.timeout', '+defer.error'],
        },
        () => {
            plugin.load_avg_ini();
        }
    );
};

exports.get_tmp_file = function(transaction) {
    const plugin = this;
    const tmpdir = plugin.cfg.main.tmpdir || '/tmp';
    return path.join(tmpdir, `${transaction.uuid}.tmp`);
};

exports.hook_data_post = function(next, connection) {
    const plugin = this;
    if (!connection.transaction) return next();

    const tmpfile = plugin.get_tmp_file(connection.transaction);
    const ws = fs.createWriteStream(tmpfile);

    ws.once('error', err => {
        connection.results.add(plugin, {
            err: `Error writing temporary file: ${err.message}`,
        });
        if (!plugin.cfg.defer.error) return next();
        return next(DENYSOFT, 'Virus scanner error (AVG)');
    });

    ws.once('close', () => {
        const start_time = Date.now();
        const socket = new sock.Socket();
        socket.setTimeout((plugin.cfg.main.connect_timeout || 10) * 1000);
        let connected = false;
        let command = 'connect';
        let response = [];

        function do_next(code, msg) {
            fs.unlink(tmpfile, () => {});
            return next(code, msg);
        }

        socket.send_command = function(cmd, data) {
            const line = cmd + (data ? ` ${data}` : '');
            connection.logprotocol(plugin, `> ${line}`);
            this.write(`${line}\r\n`);
            command = cmd.toLowerCase();
            response = [];
        };

        socket.on('timeout', () => {
            const msg = `${connected ? 'connection' : 'session'} timed out`;
            connection.results.add(plugin, { err: msg });
            if (!plugin.cfg.defer.timeout) return do_next();
            return do_next(DENYSOFT, 'Virus scanner timeout (AVG)');
        });

        socket.on('error', err => {
            connection.results.add(plugin, { err: err.message });
            if (!plugin.cfg.defer.error) return do_next();
            return do_next(DENYSOFT, 'Virus scanner error (AVG)');
        });

        socket.on('connect', function() {
            connected = true;
            this.setTimeout((plugin.cfg.main.session_timeout || 30) * 1000);
        });

        socket.on('line', line => {
            const matches = smtp_regexp.exec(line);
            connection.logprotocol(plugin, `< ${line}`);
            if (!matches) {
                connection.results.add(plugin, {
                    err: `Unrecognized response: ${line}`,
                });
                socket.end();
                if (!plugin.cfg.defer.error) return do_next();
                return do_next(DENYSOFT, 'Virus scanner error (AVG)');
            }

            const code = matches[1];
            const cont = matches[2];
            const rest = matches[3];
            response.push(rest);
            if (cont !== ' ') {
                return;
            }

            switch (command) {
                case 'connect':
                    if (code !== '220') {
                        // Error
                        connection.results.add(plugin, {
                            err: `Unrecognized response: ${line}`,
                        });
                        if (!plugin.cfg.defer.timeout) return do_next();
                        return do_next(DENYSOFT, 'Virus scanner error (AVG)');
                    } else {
                        socket.send_command('SCAN', tmpfile);
                    }
                    break;
                case 'scan': {
                    const elapsed = Date.now() - start_time;
                    connection.loginfo(plugin, {
                        time: `${elapsed}ms`,
                        code,
                        response: `"${response.join(' ')}"`,
                    });
                    // Check code
                    switch (code) {
                        case '200': // 200 ok
                            // Message did not contain a virus
                            connection.results.add(plugin, { pass: 'clean' });
                            socket.send_command('QUIT');
                            return do_next();
                        case '403':
                            // File 'eicar.com', 'Virus identified EICAR_Test'
                            connection.results.add(plugin, {
                                fail: response.join(' '),
                            });
                            socket.send_command('QUIT');
                            return do_next(DENY, response.join(' '));
                        default:
                            // Any other result is an error
                            connection.results.add(plugin, {
                                err: `Bad response: ${response.join(' ')}`,
                            });
                    }
                    socket.send_command('QUIT');
                    if (!plugin.cfg.defer.error) return do_next();
                    return do_next(DENYSOFT, 'Virus scanner error (AVG)');
                }
                case 'quit':
                    socket.end();
                    break;
                default:
                    throw new Error(`Unknown command: ${command}`);
            }
        });
        socket.connect(plugin.cfg.main.port || 54322, plugin.cfg.main.host);
    });

    connection.transaction.message_stream.pipe(ws, { line_endings: '\r\n' });
};
