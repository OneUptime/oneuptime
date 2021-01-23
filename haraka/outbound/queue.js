'use strict';

const async = require('async');
const fs = require('fs');
const path = require('path');

const Address = require('address-rfc2821').Address;
const config = require('haraka-config');

const logger = require('../logger');
const TimerQueue = require('./timer_queue');
const HMailItem = require('./hmail');
const obc = require('./config');
const _qfile = require('./qfile');
const obtls = require('./tls');

let queue_dir;
if (config.get('queue_dir')) {
    queue_dir = path.resolve(config.get('queue_dir'));
} else if (process.env.HARAKA) {
    queue_dir = path.resolve(process.env.HARAKA, 'queue');
} else {
    queue_dir = path.resolve('tests', 'test-queue');
}

exports.queue_dir = queue_dir;

const load_queue = async.queue((file, cb) => {
    const hmail = new HMailItem(file, path.join(queue_dir, file));
    exports._add_hmail(hmail);
    hmail.once('ready', cb);
}, obc.cfg.concurrency_max);

let in_progress = 0;
const delivery_queue = (exports.delivery_queue = async.queue((hmail, cb) => {
    in_progress++;
    hmail.next_cb = () => {
        in_progress--;
        cb();
    };
    if (obtls.cfg) return hmail.send();
    obtls.init(() => {
        hmail.send();
    });
}, obc.cfg.concurrency_max));

const temp_fail_queue = (exports.temp_fail_queue = new TimerQueue());

let queue_count = 0;

exports.get_stats = () =>
    `${in_progress}/${exports.delivery_queue.length()}/${exports.temp_fail_queue.length()}`;

exports.list_queue = cb => {
    exports._load_cur_queue(null, exports._list_file, cb);
};

exports._stat_file = (file, cb) => {
    queue_count++;
    setImmediate(cb);
};

exports.stat_queue = cb => {
    const self = exports;
    exports._load_cur_queue(null, exports._stat_file, err => {
        if (err) return cb(err);
        return cb(null, self.stats());
    });
};

exports.load_queue = pid => {
    // Initialise and load queue
    // This function is called first when not running under cluster,
    // so we create the queue directory if it doesn't already exist.
    exports.ensure_queue_dir();
    exports.delete_dot_files();

    exports._load_cur_queue(pid, exports._add_file, () => {
        logger.loginfo(
            `[outbound] [pid: ${pid}] ${delivery_queue.length()} files in my delivery queue`
        );
        logger.loginfo(
            `[outbound] [pid: ${pid}] ${load_queue.length()} files in my load queue`
        );
        logger.loginfo(
            `[outbound] [pid: ${pid}] ${temp_fail_queue.length()} files in my temp fail queue`
        );
    });
};

exports._load_cur_queue = (pid, iteratee, cb) => {
    const self = exports;
    logger.loginfo('[outbound] Loading outbound queue from ', queue_dir);
    fs.readdir(queue_dir, (err, files) => {
        if (err) {
            return logger.logerror(
                `[outbound] Failed to load queue directory (${queue_dir}): ${err}`
            );
        }

        self.cur_time = new Date(); // set once so we're not calling it a lot

        self.load_queue_files(pid, files, iteratee, cb);
    });
};

exports.read_parts = file => {
    if (file.indexOf(_qfile.platformDOT) === 0) {
        logger.logwarn(
            `[outbound] 'Skipping' dot-file in queue folder: ${file}`
        );
        return false;
    }

    const parts = _qfile.parts(file);
    if (!parts) {
        logger.logerror(
            `[outbound] Unrecognized file in queue folder: ${file}`
        );
        return false;
    }

    return parts;
};

exports.rename_to_actual_pid = (file, parts, cb) => {
    // maintain some original details for the rename
    const new_filename = _qfile.name({
        arrival: parts.arrival,
        uid: parts.uid,
        next_attempt: parts.next_attempt,
        attempts: parts.attempts,
    });

    fs.rename(
        path.join(queue_dir, file),
        path.join(queue_dir, new_filename),
        err => {
            if (err) {
                return cb(
                    `Unable to rename queue file: ${file} to ${new_filename} : ${err}`
                );
            }

            cb(null, new_filename);
        }
    );
};

exports._add_file = (file, cb) => {
    const self = exports;
    const parts = _qfile.parts(file);

    if (parts.next_attempt <= self.cur_time) {
        logger.logdebug('[outbound] File needs processing now');
        load_queue.push(file);
    } else {
        logger.logdebug(
            `[outbound] File needs processing later: ${parts.next_attempt -
                self.cur_time}ms`
        );
        temp_fail_queue.add(file, parts.next_attempt - self.cur_time, () => {
            load_queue.push(file);
        });
    }

    cb();
};

exports.load_queue_files = (pid, input_files, iteratee, callback) => {
    const self = exports;
    const searchPid = parseInt(pid);

    let stat_renamed = 0;
    let stat_loaded = 0;

    callback = callback || function() {};

    if (searchPid) {
        logger.loginfo(`[outbound] Grabbing queue files for pid: ${pid}`);
    } else {
        logger.loginfo('[outbound] Loading the queue...');
    }

    async.map(
        input_files,
        (file, cb) => {
            const parts = self.read_parts(file);
            if (!parts) return cb();

            if (searchPid) {
                if (parts.pid !== searchPid) return cb();

                self.rename_to_actual_pid(
                    file,
                    parts,
                    (error, renamed_file) => {
                        if (error) {
                            logger.logerror(`[outbound] ${error}`);
                            return cb();
                        }

                        stat_renamed++;
                        stat_loaded++;
                        cb(null, renamed_file);
                    }
                );
            } else {
                stat_loaded++;
                cb(null, file);
            }
        },
        (err, results) => {
            if (err) logger.logerr(`[outbound] [pid: ${pid}] ${err}`);
            if (searchPid)
                logger.loginfo(
                    `[outbound] [pid: ${pid}] ${stat_renamed} files old PID queue fixed up`
                );
            logger.logdebug(
                `[outbound] [pid: ${pid}] ${stat_loaded} files loaded`
            );

            async.map(
                results.filter(i => i),
                iteratee,
                callback
            );
        }
    );
};

exports.stats = () => {
    // TODO: output more data here
    const results = {
        queue_dir,
        queue_count,
    };

    return results;
};

exports._list_file = (file, cb) => {
    const tl_reader = fs.createReadStream(path.join(queue_dir, file), {
        start: 0,
        end: 3,
    });
    tl_reader.on('error', err => {
        console.error(`Error reading queue file: ${file}:`, err);
    });
    tl_reader.once('data', buf => {
        // I'm making the assumption here we won't ever read less than 4 bytes
        // as no filesystem on the planet should be that dumb...
        tl_reader.destroy();
        const todo_len =
            (buf[0] << 24) + (buf[1] << 16) + (buf[2] << 8) + buf[3];
        const td_reader = fs.createReadStream(path.join(queue_dir, file), {
            encoding: 'utf8',
            start: 4,
            end: todo_len + 3,
        });
        let todo = '';
        td_reader.on('data', str => {
            todo += str;
            if (Buffer.byteLength(todo) === todo_len) {
                // we read everything
                const todo_struct = JSON.parse(todo);
                todo_struct.rcpt_to = todo_struct.rcpt_to.map(
                    a => new Address(a)
                );
                todo_struct.mail_from = new Address(todo_struct.mail_from);
                todo_struct.file = file;
                todo_struct.full_path = path.join(queue_dir, file);
                const parts = _qfile.parts(file);
                todo_struct.pid = (parts && parts.pid) || null;
                cb(null, todo_struct);
            }
        });
        td_reader.on('end', () => {
            if (Buffer.byteLength(todo) !== todo_len) {
                console.error(
                    "Didn't find right amount of data in todo for file:",
                    file
                );
                return cb();
            }
        });
    });
};

exports.flush_queue = (domain, pid) => {
    if (domain) {
        exports.list_queue((err, qlist) => {
            if (err)
                return logger.logerror(
                    `[outbound] Failed to load queue: ${err}`
                );
            qlist.forEach(todo => {
                if (todo.domain.toLowerCase() != domain.toLowerCase()) return;
                if (pid && todo.pid != pid) return;
                // console.log("requeue: ", todo);
                delivery_queue.push(new HMailItem(todo.file, todo.full_path));
            });
        });
    } else {
        temp_fail_queue.drain();
    }
};

exports.load_pid_queue = pid => {
    logger.loginfo(`[outbound] Loading queue for pid: ${pid}`);
    exports.load_queue(pid);
};

exports.ensure_queue_dir = () => {
    // No reason not to do this stuff syncronously -
    // this code is only run at start-up.
    if (fs.existsSync(queue_dir)) return;

    logger.logdebug(`[outbound] Creating queue directory ${queue_dir}`);
    try {
        fs.mkdirSync(queue_dir, 493); // 493 == 0755
    } catch (err) {
        if (err.code !== 'EEXIST') {
            logger.logerror(
                `[outbound] Error creating queue directory: ${err}`
            );
            throw err;
        }
    }
};

exports.delete_dot_files = () => {
    const files = fs.readdirSync(queue_dir);

    files.forEach(file => {
        if (file.indexOf(_qfile.platformDOT) === 0) {
            logger.logwarn(`[outbound] Removing left over dot-file: ${file}`);
            return fs.unlinkSync(path.join(queue_dir, file));
        }
    });
};

exports._add_hmail = hmail => {
    if (hmail.next_process < exports.cur_time) {
        delivery_queue.push(hmail);
    } else {
        temp_fail_queue.add(
            hmail.filename,
            hmail.next_process - exports.cur_time,
            () => {
                delivery_queue.push(hmail);
            }
        );
    }
};

exports.scan_queue_pids = cb => {
    const self = exports;

    // Under cluster, this is called first by the master so
    // we create the queue directory if it doesn't exist.
    self.ensure_queue_dir();
    self.delete_dot_files();

    fs.readdir(queue_dir, (err, files) => {
        if (err) {
            logger.logerror(
                `[outbound] Failed to load queue directory (${queue_dir}): ${err}`
            );
            return cb(err);
        }

        const pids = {};

        files.forEach(file => {
            const parts = self.read_parts(file);
            if (parts) pids[parts.pid] = true;
        });

        return cb(null, Object.keys(pids));
    });
};
