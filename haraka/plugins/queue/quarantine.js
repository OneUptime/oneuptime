// quarantine

const fs = require('fs');
const path = require('path');

exports.register = function() {
    const plugin = this;

    plugin.load_quarantine_ini();

    plugin.register_hook('queue', 'quarantine');
    plugin.register_hook('queue_outbound', 'quarantine');
};

exports.hook_init_master = function(next, server) {
    this.init_quarantine_dir(() => {
        this.clean_tmp_directory(next);
    });
};

exports.load_quarantine_ini = function() {
    const plugin = this;
    plugin.cfg = plugin.config.get('quarantine.ini', () => {
        plugin.load_quarantine_ini();
    });
};

const zeroPad = (exports.zeroPad = (n, digits) => {
    n = n.toString();
    while (n.length < digits) {
        n = `0${n}`;
    }
    return n;
});

exports.clean_tmp_directory = function(next) {
    // At start-up; delete any files in the temporary directory
    // NOTE: This is deliberately syncronous to ensure that this
    //       is completed prior to any messages being received.
    const plugin = this;
    const tmp_dir = path.join(plugin.get_base_dir(), 'tmp');

    if (fs.existsSync(tmp_dir)) {
        const dirent = fs.readdirSync(tmp_dir);
        plugin.loginfo(`Removing temporary files from: ${tmp_dir}`);
        for (let i = 0; i < dirent.length; i++) {
            fs.unlinkSync(path.join(tmp_dir, dirent[i]));
        }
    }
    next();
};

function wants_quarantine(connection) {
    if (connection.notes.quarantine) return connection.notes.quarantine;

    if (connection.transaction.notes.quarantine)
        return connection.transaction.notes.quarantine;

    if (connection.transaction.notes.get('queue.wants') === 'quarantine')
        return true;

    return false;
}

exports.get_base_dir = function() {
    if (this.cfg.main.quarantine_path) return this.cfg.main.quarantine_path;
    return '/var/spool/haraka/quarantine';
};

exports.init_quarantine_dir = function(done) {
    const plugin = this;
    const tmp_dir = path.join(plugin.get_base_dir(), 'tmp');
    fs.promises
        .mkdir(tmp_dir, { recursive: true })
        .then(made => plugin.loginfo(`created ${tmp_dir}`))
        .catch(err => plugin.logerror(`Unable to create ${tmp_dir}`))
        .finally(done);
};

exports.quarantine = function(next, connection) {
    const plugin = this;

    const quarantine = wants_quarantine(connection);
    plugin.logdebug(`quarantine: ${quarantine}`);
    if (!quarantine) return next();

    // Calculate date in YYYYMMDD format
    const d = new Date();
    const yyyymmdd =
        d.getFullYear() +
        zeroPad(d.getMonth() + 1, 2) +
        this.zeroPad(d.getDate(), 2);

    let subdir = yyyymmdd;
    // Allow either boolean or a sub-directory to be specified

    if (typeof quarantine !== 'boolean' && quarantine !== 1) {
        subdir = path.join(quarantine, yyyymmdd);
    }

    const txn = connection.transaction;
    const base_dir = plugin.get_base_dir();
    const msg_dir = path.join(base_dir, subdir);
    const tmp_path = path.join(base_dir, 'tmp', txn.uuid);
    const msg_path = path.join(msg_dir, txn.uuid);

    // Create all the directories recursively if they do not exist.
    // Then write the file to a temporary directory first, once this is
    // successful we hardlink the file to the final destination and then
    // remove the temporary file to guarantee a complete file in the
    // final destination.
    fs.promises
        .mkdir(msg_dir, { recursive: true })
        .catch(err => {
            connection.logerror(plugin, `Error creating directory: ${msg_dir}`);
            next();
        })
        .then(ok => {
            const ws = fs.createWriteStream(tmp_path);

            ws.on('error', err => {
                connection.logerror(
                    plugin,
                    `Error writing quarantine file: ${err.message}`
                );
                return next();
            });
            ws.on('close', () => {
                fs.link(tmp_path, msg_path, err => {
                    if (err) {
                        connection.logerror(
                            plugin,
                            `Error writing quarantine file: ${err}`
                        );
                    } else {
                        // Add a note to where we stored the message
                        txn.notes.quarantined = msg_path;
                        txn.results.add(plugin, { pass: msg_path, emit: true });
                        // Now delete the temporary file
                        fs.unlink(tmp_path, () => {});
                    }
                    // Using notes.quarantine_action to decide what to do after the message is quarantined.
                    // Format can be either action = [ code, msg ] or action = code
                    const action =
                        connection.notes.quarantine_action ||
                        txn.notes.quarantine_action;
                    if (!action) return next();
                    if (Array.isArray(action))
                        return next(action[0], action[1]);
                    return next(action);
                });
            });
            txn.message_stream.pipe(ws, { line_endings: '\n' });
        });
};
