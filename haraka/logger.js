'use strict';
// Log class

const util = require('util');
const tty = require('tty');

const config = require('haraka-config');
const constants = require('haraka-constants');

let plugins;
let connection;
let outbound;

const regex = /(^$|[ ="\\])/;
const escape_replace_regex = /["\\]/g;

function stringify(obj) {
    let str = '';
    let key;
    for (key in obj) {
        let v = obj[key];
        if (v == null) {
            str += `${key}="" `;
            continue;
        }
        v = v.toString();
        if (regex.test(v)) {
            str += `${key}="${v.replace(escape_replace_regex, '\\$&')}" `;
        } else {
            str += `${key}=${v} `;
        }
    }
    return str.trim();
}

const logger = exports;

logger.levels = {
    DATA: 9,
    PROTOCOL: 8,
    DEBUG: 7,
    INFO: 6,
    NOTICE: 5,
    WARN: 4,
    ERROR: 3,
    CRIT: 2,
    ALERT: 1,
    EMERG: 0,
};

for (const le in logger.levels) {
    logger.levels[`LOG${le}`] = logger.levels[le];
    logger[`LOG${le}`] = logger.levels[le];
}

logger.formats = {
    DEFAULT: 'DEFAULT',
    LOGFMT: 'LOGFMT',
    JSON: 'JSON',
};

logger.loglevel = logger.levels.WARN;
logger.format = logger.formats.DEFAULT;
logger.timestamps = false;
logger.deferred_logs = [];

logger.colors = {
    DATA: 'green',
    PROTOCOL: 'green',
    DEBUG: 'grey',
    INFO: 'cyan',
    NOTICE: 'blue',
    WARN: 'red',
    ERROR: 'red',
    CRIT: 'red',
    ALERT: 'red',
    EMERG: 'red',
};

const stdout_is_tty = tty.isatty(process.stdout.fd);

logger._init = function() {
    this.load_log_ini();
    this._init_loglevel();
    this._init_timestamps();
};

logger.load_log_ini = function() {
    const self = this;
    self.cfg = config.get(
        'log.ini',
        {
            booleans: ['+main.timestamps'],
        },
        () => {
            self.load_log_ini();
        }
    );

    this.set_loglevel(this.cfg.main.level);
    this.set_timestamps(this.cfg.main.timestamps);
    this.set_format(this.cfg.main.format);
};

logger.colorize = (color, str) => {
    if (!util.inspect.colors[color]) {
        return str;
    } // unknown color
    return `\u001b[${util.inspect.colors[color][0]}m${str}\u001b[${util.inspect.colors[color][1]}m`;
};

logger.dump_logs = cb => {
    while (logger.deferred_logs.length > 0) {
        const log_item = logger.deferred_logs.shift();
        plugins.run_hooks('log', logger, log_item);
    }
    // Run callback after flush
    if (cb) process.stdout.write('', cb);
    return true;
};

if (!util.isFunction) {
    util.isFunction = functionToCheck => {
        const getType = {};
        return (
            functionToCheck &&
            getType.toString.call(functionToCheck) === '[object Function]'
        );
    };
}

logger.dump_and_exit = function(code) {
    this.dump_logs(() => {
        if (util.isFunction(code)) return code();
        process.exit(code);
    });
};

logger.log = (level, data, logobj) => {
    if (level === 'PROTOCOL') {
        data = data.replace(/\n/g, '\\n');
    }
    data = data.replace(/\r/g, '\\r').replace(/\n$/, '');

    const item = { level, data, obj: logobj };

    // buffer until plugins are loaded
    const emptyPluginList =
        !plugins ||
        (Array.isArray(plugins.plugin_list) && !plugins.plugin_list.length);
    if (emptyPluginList) {
        logger.deferred_logs.push(item);
        return true;
    }

    // process buffered logs
    while (logger.deferred_logs.length > 0) {
        const log_item = logger.deferred_logs.shift();
        plugins.run_hooks('log', logger, log_item);
    }

    plugins.run_hooks('log', logger, item);
    return true;
};

logger.log_respond = (retval, msg, data) => {
    // any other return code is irrelevant
    if (retval !== constants.cont) {
        return false;
    }
    let timestamp_string = '';
    if (logger.timestamps) {
        timestamp_string = `${new Date().toISOString()} `;
    }
    const color = logger.colors[data.level];
    if (color && stdout_is_tty) {
        process.stdout.write(
            `${timestamp_string}${logger.colorize(color, data.data)}\n`
        );
        return true;
    }

    process.stdout.write(`${timestamp_string}${data.data}\n`);
    return true;
};

logger.set_loglevel = function(level) {
    if (level === undefined || level === null) return;

    const loglevel_num = parseInt(level);
    if (typeof level === 'string') {
        this.log('INFO', `loglevel: ${level.toUpperCase()}`);
        logger.loglevel = logger.levels[level.toUpperCase()];
    } else {
        logger.loglevel = loglevel_num;
    }

    if (!Number.isInteger(logger.loglevel)) {
        this.log('WARN', `invalid loglevel: ${level} defaulting to LOGWARN`);
        logger.loglevel = logger.levels.WARN;
    }
};

logger.set_format = function(format) {
    if (format) {
        logger.format = logger.formats[format.toUpperCase()];
        this.log('INFO', `log format: ${format.toUpperCase()}`);
    } else {
        logger.format = null;
    }
    if (!logger.format) {
        this.log('WARN', `invalid log format: ${format} defaulting to DEFAULT`);
        logger.format = logger.formats.DEFAULT;
    }
};

logger._init_loglevel = function() {
    const self = this;

    const _loglevel = config.get('loglevel', 'value', () => {
        self._init_loglevel();
    });

    self.set_loglevel(_loglevel);
};

logger.would_log = level => {
    if (logger.loglevel < level) {
        return false;
    }
    return true;
};

logger.set_timestamps = value => {
    logger.timestamps = !!value;
};

logger._init_timestamps = function() {
    const self = this;

    const _timestamps = config.get('log_timestamps', 'value', () => {
        self._init_timestamps();
    });

    // If we've already been toggled to true by the cfg, we should respect
    // this.
    self.set_timestamps(logger.timestamps || _timestamps);
};

logger._init();

logger.log_if_level = (level, key, plugin) =>
    function() {
        if (logger.loglevel < logger[key]) {
            return;
        }
        let logobj = {
            level,
            uuid: '-',
            origin: plugin || 'core',
            message: '',
        };
        for (let i = 0; i < arguments.length; i++) {
            const data = arguments[i];
            if (typeof data !== 'object') {
                logobj.message += data;
                continue;
            }
            if (!data) continue;

            // if the object is a connection, add the connection id
            if (data instanceof connection.Connection) {
                logobj.uuid = data.uuid;
                if (data.tran_count > 0) {
                    logobj.uuid += `.${data.tran_count}`;
                }
            } else if (data instanceof plugins.Plugin) {
                logobj.origin = data.name;
            } else if (data.name) {
                logobj.origin = data.name;
            } else if (data instanceof outbound.HMailItem) {
                logobj.origin = 'outbound';
                if (data.todo) {
                    if (data.todo.uuid) logobj.uuid = data.todo.uuid;
                    if (data.todo.client_uuid) {
                        // dirty hack
                        logobj.origin = `outbound] [${data.todo.client_uuid}`;
                    }
                }
            } else if (
                logger.format === logger.formats.LOGFMT &&
                data.constructor === Object
            ) {
                logobj = Object.assign(logobj, data);
            } else if (
                logger.format === logger.formats.JSON &&
                data.constructor === Object
            ) {
                logobj = Object.assign(logobj, data);
            } else if (
                typeof data === 'object' &&
                Object.prototype.hasOwnProperty.call(data, 'uuid')
            ) {
                logobj.uuid = data.uuid;
            } else if (data.constructor === Object) {
                if (!logobj.message.endsWith(' ')) logobj.message += ' ';
                logobj.message += stringify(data);
            } else {
                logobj.message += util.inspect(data);
            }
        }
        switch (logger.format) {
            case logger.formats.LOGFMT:
                logger.log(level, stringify(logobj));
                return true;
            case logger.formats.JSON:
                logger.log(level, JSON.stringify(logobj));
                return true;
            case logger.formats.DEFAULT:
            default:
                logger.log(
                    level,
                    `[${logobj.level}] [${logobj.uuid}] [${logobj.origin}] ${logobj.message}`
                );
                return true;
        }
    };

logger.add_log_methods = (object, plugin) => {
    if (!object) return;
    if (typeof object !== 'object') return;
    for (const level in logger.levels) {
        const fname = `log${level.toLowerCase()}`;
        if (object[fname]) continue; // already added
        object[fname] = logger.log_if_level(level, `LOG${level}`, plugin);
    }
};

logger.add_log_methods(logger);

// load these down here so it sees all the logger methods compiled above
plugins = require('./plugins');
connection = require('./connection');
outbound = require('./outbound');
