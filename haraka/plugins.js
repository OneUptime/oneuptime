'use strict';
// load all defined plugins

// node built-ins
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// npm modules
exports.config = require('haraka-config');
const constants = require('haraka-constants');

// local modules
const logger = require('./logger');

exports.registered_hooks = {};
exports.registered_plugins = {};
exports.plugin_list = [];

let order = 0;

class Plugin {
    constructor(name) {
        this.name = name;
        this.base = {};
        this.timeout = get_timeout(name);
        this._get_plugin_path();
        this.config = this._get_config();
        this.hooks = {};
    }

    haraka_require(name) {
        return require(`./${name}`);
    }

    core_require(name) {
        return this.haraka_require(name);
    }

    _get_plugin_path() {
        const plugin = this;
        /* From https://github.com/haraka/Haraka/pull/1278#issuecomment-168856528
        In Development mode, or install via a plain "git clone":

            Plain plugin in plugins/ folder
            Plugin in a folder in plugins/<name>/ folder. Contains a package.json.
            Plugin in node_modules. Contains a package.json file.

        In "installed" mode (via haraka -i <path>):

            Plain plugin in <path>/plugins/ folder
            Plugin in a folder in <path>/plugins/<name>/folder. (same concept as above)
            Plugin in <path>/node_modules. Contains a package.json file.
            Core plugin in <core_haraka_dir>/plugins/ folder
            Plugin in a folder in <core_haraka_dir>/plugins/<name>/ folder. (same concept as above)
            Plugin in <core_haraka_dir>/node_modules.
        */

        plugin.hasPackageJson = false;
        const name = plugin.name.startsWith('haraka-plugin-')
            ? plugin.name.substr(14)
            : plugin.name;
        if (plugin.name !== name) plugin.name = name;

        let paths = [];
        if (process.env.HARAKA) {
            // Installed mode - started via bin/haraka
            paths = paths.concat(plugin_search_paths(process.env.HARAKA, name));

            // permit local "folder" plugins (/$name/package.json) (see #1649)
            paths.push(
                path.resolve(
                    process.env.HARAKA,
                    'plugins',
                    name,
                    'package.json'
                ),
                path.resolve(
                    process.env.HARAKA,
                    'node_modules',
                    name,
                    'package.json'
                )
            );
        }

        // development mode
        paths = paths.concat(plugin_search_paths(__dirname, name));
        paths.forEach(pp => {
            if (plugin.plugin_path) return;
            try {
                fs.statSync(pp);
                plugin.plugin_path = pp;
                if (path.basename(pp) === 'package.json') {
                    plugin.hasPackageJson = true;
                }
            } catch (ignore) {}
        });
    }

    _get_config() {
        if (this.hasPackageJson) {
            // It's a package/folder plugin - look in plugin folder for defaults,
            // haraka/config folder for overrides
            return exports.config.module_config(
                path.dirname(this.plugin_path),
                process.env.HARAKA || __dirname
            );
        }
        if (process.env.HARAKA) {
            // Plain .js file, installed mode - look in core folder for defaults,
            // install dir for overrides
            return exports.config.module_config(__dirname, process.env.HARAKA);
        }
        if (process.env.HARAKA_TEST_DIR) {
            return exports.config.module_config(process.env.HARAKA_TEST_DIR);
        }

        // Plain .js file, git mode - just look in this folder
        return exports.config.module_config(__dirname);
    }

    register_hook(hook_name, method_name, priority) {
        priority = parseInt(priority);
        if (!priority) priority = 0;
        if (priority > 100) priority = 100;
        if (priority < -100) priority = -100;

        if (!Array.isArray(exports.registered_hooks[hook_name])) {
            exports.registered_hooks[hook_name] = [];
        }
        exports.registered_hooks[hook_name].push({
            plugin: this.name,
            method: method_name,
            priority,
            timeout: this.timeout,
            order: order++,
        });
        this.hooks[hook_name] = this.hooks[hook_name] || [];
        this.hooks[hook_name].push(method_name);

        logger.logdebug(
            `registered hook ${hook_name} to ${this.name}.` +
                `${method_name} priority ${priority}`
        );
    }

    register() {} // noop

    inherits(parent_name) {
        const parent_plugin = plugins._load_and_compile_plugin(parent_name);
        for (const method in parent_plugin) {
            if (!this[method]) {
                this[method] = parent_plugin[method];
            }
            // else if (method == 'shutdown') {
            //     Method is in this module, so it exists in the plugin
            //     if (!this.hasOwnProperty('shutdown')) {
            //         this[method] = parent_plugin[method];
            //     }
            // }
        }
        if (parent_plugin.register) {
            parent_plugin.register.call(this);
        }
        this.base[parent_name] = parent_plugin;
    }

    _make_custom_require() {
        const plugin = this;
        return module => {
            if (plugin.hasPackageJson) {
                const mod = require(module);
                constants.import(global);
                global.server = plugins.server;
                return mod;
            }

            if (module === './config') {
                return plugin.config;
            }

            if (!/^\./.test(module)) {
                return require(module);
            }

            if (
                fs.existsSync(path.join(__dirname, `${module}.js`)) ||
                fs.existsSync(path.join(__dirname, module))
            ) {
                return require(module);
            }

            return require(path.join(path.dirname(plugin.plugin_path), module));
        };
    }

    _get_code(pp) {
        const plugin = this;

        if (plugin.hasPackageJson) {
            let packageDir = path.dirname(pp);
            if (/^win(32|64)/.test(process.platform)) {
                // escape the c:\path\back\slashes else they disappear
                packageDir = packageDir.replace(/\\/g, '\\\\');
            }
            return `var _p = require("${packageDir}"); for (var k in _p) { exports[k] = _p[k] }`;
        }

        try {
            return `"use strict";${fs.readFileSync(pp)}`;
        } catch (err) {
            if (exports.config.get('smtp.ini').main.ignore_bad_plugins) {
                logger.logcrit(`Loading plugin ${plugin.name} failed: ${err}`);
                return;
            }
            throw `Loading plugin ${plugin.name} failed: ${err}`;
        }
    }

    _compile() {
        const plugin = this;

        const pp = plugin.plugin_path;
        const code = plugin._get_code(pp);
        if (!code) return;

        const sandbox = {
            require: plugin._make_custom_require(),
            __filename: pp,
            __dirname: path.dirname(pp),
            exports: plugin,
            setTimeout,
            clearTimeout,
            setInterval,
            clearInterval,
            process,
            Buffer,
            Math,
            server: plugins.server,
            setImmediate,
        };
        if (plugin.hasPackageJson) {
            delete sandbox.__filename;
        }
        constants.import(sandbox);
        try {
            vm.runInNewContext(code, sandbox, pp);
        } catch (err) {
            logger.logcrit(`Compiling plugin: ${plugin.name} failed`);
            if (exports.config.get('smtp.ini').main.ignore_bad_plugins) {
                logger.logcrit(
                    `Loading plugin ${plugin.name} failed: `,
                    `${err.message} - will skip this plugin and continue`
                );
                return;
            }
            throw err; // default is to re-throw and stop Haraka
        }

        return plugin;
    }
}

exports.shutdown_plugins = () => {
    for (const i in exports.registered_plugins) {
        if (exports.registered_plugins[i].shutdown) {
            exports.registered_plugins[i].shutdown();
        }
    }
};

process.on('message', msg => {
    if (msg.event && msg.event == 'plugins.shutdown') {
        logger.loginfo('[plugins] Shutting down plugins');
        exports.shutdown_plugins();
    }
});

function plugin_search_paths(prefix, name) {
    return [
        path.resolve(prefix, 'plugins', `${name}.js`),
        path.resolve(
            prefix,
            'node_modules',
            `haraka-plugin-${name}`,
            'package.json'
        ),
        path.resolve(prefix, '..', `haraka-plugin-${name}`, 'package.json'),
    ];
}

function get_timeout(name) {
    let timeout = parseFloat(exports.config.get(`${name}.timeout`));
    if (isNaN(timeout)) {
        logger.logdebug(`no timeout in ${name}.timeout`);
        timeout = parseFloat(exports.config.get('plugin_timeout'));
    }
    if (isNaN(timeout)) {
        logger.logdebug('no timeout in plugin_timeout');
        timeout = 30;
    }

    logger.logdebug(`plugin ${name} timeout is: ${timeout}s`);
    return timeout;
}

// copy logger methods into Plugin:
for (const key in logger) {
    if (!/^log\w/.test(key)) continue;
    // console.log(`adding Plugin.${key} method`);
    Plugin.prototype[key] = (function(lev) {
        return function() {
            const args = [this];
            for (let i = 0, l = arguments.length; i < l; i++) {
                args.push(arguments[i]);
            }
            logger[lev].apply(logger, args);
        };
    })(key);
}

const plugins = exports;

plugins.Plugin = Plugin;

plugins.load_plugins = override => {
    logger.loginfo('Loading plugins');
    let plugin_list;
    if (override) {
        if (!Array.isArray(override)) override = [override];
        plugin_list = override;
    } else {
        plugin_list = exports.config.get('plugins', 'list');
    }

    plugin_list.forEach(plugin => {
        if (plugin.startsWith('haraka-plugin-')) plugin = plugin.substr(14);
        if (plugins.deprecated[plugin]) {
            logger.lognotice(
                `the plugin ${plugin} has been replaced by '${plugins.deprecated[plugin]}'. Please update config/plugins`
            );
            plugins.load_plugin(plugins.deprecated[plugin]);
        } else {
            plugins.load_plugin(plugin);
        }
    });

    plugins.plugin_list = Object.keys(plugins.registered_plugins);

    // Sort registered_hooks by priority
    const hooks = Object.keys(plugins.registered_hooks);
    for (let h = 0; h < hooks.length; h++) {
        const hook = hooks[h];
        plugins.registered_hooks[hook].sort((a, b) => {
            if (a.priority < b.priority) return -1;
            if (a.priority > b.priority) return 1;
            if (a.priority == b.priority) {
                if (a.order > b.order) return 1;
                return -1;
            }
            return 0;
        });
    }

    logger.dump_logs(); // now logging plugins are loaded.
};

plugins.deprecated = {
    'connect.asn': 'asn',
    'connect.fcrdns': 'fcrdns',
    'connect.geoip': 'geoip',
    'connect.rdns_access': 'access',
    'data.nomsgid': 'headers',
    'data.noreceived': 'headers',
    'data.rfc5322_header_checks': 'headers',
    'data.headers': 'headers',
    'log.syslog': 'syslog',
    'mail_from.access': 'access',
    'mail_from.blocklist': 'access',
    'mail_from.nobounces': 'bounce',
    max_unrecognized_commands: 'limit',
    rate_limit: 'limit',
    'rcpt_to.access': 'access',
    'rcpt_to.blocklist': 'access',
    'rcpt_to.qmail_deliverable': 'qmail-deliverable',
    'rdns.regexp': 'access',
    relay_acl: 'relay',
    relay_force_routing: 'relay',
};

plugins.load_plugin = name => {
    logger.loginfo(`Loading plugin: ${name}`);

    const plugin = plugins._load_and_compile_plugin(name);
    if (plugin) {
        plugins._register_plugin(plugin);
    }

    plugins.registered_plugins[name] = plugin;
    return plugin;
};

// Set in server.js; initialized to empty object
// to prevent it from blowing up any unit tests.
plugins.server = { notes: {} };

plugins._load_and_compile_plugin = name => {
    const plugin = new Plugin(name);
    if (!plugin.plugin_path) {
        const err = `Loading plugin ${plugin.name} failed: No plugin with this name found`;
        if (exports.config.get('smtp.ini').main.ignore_bad_plugins) {
            logger.logcrit(err);
            return;
        }
        throw err;
    }
    plugin._compile();
    return plugin;
};

plugins._register_plugin = plugin => {
    plugin.register();

    // register any hook_blah methods.
    for (const method in plugin) {
        const result = method.match(/^hook_(\w+)\b/);
        if (result) {
            plugin.register_hook(result[1], method);
        }
    }

    return plugin;
};

plugins.run_hooks = (hook, object, params) => {
    if (client_disconnected(object) && !is_required_hook(hook)) {
        object.logdebug(`aborting ${hook} hook`);
        return;
    }

    if (hook !== 'log') object.logdebug(`running ${hook} hooks`);

    if (is_required_hook(hook) && object.current_hook) {
        object.current_hook[2](); // call cancel function
    }

    if (
        !is_required_hook(hook) &&
        hook !== 'deny' &&
        object.hooks_to_run &&
        object.hooks_to_run.length
    ) {
        throw new Error('We are already running hooks! Fatal error!');
    }

    if (hook === 'deny') {
        // Save the hooks_to_run list so that we can run any remaining
        // plugins on the previous hook once this hook is complete.
        object.saved_hooks_to_run = object.hooks_to_run;
    }
    object.hooks_to_run = [];

    if (plugins.registered_hooks[hook]) {
        for (let i = 0; i < plugins.registered_hooks[hook].length; i++) {
            const item = plugins.registered_hooks[hook][i];
            const plugin = plugins.registered_plugins[item.plugin];
            object.hooks_to_run.push([plugin, item.method]);
        }
    }

    plugins.run_next_hook(hook, object, params);
};

plugins.run_next_hook = (hook, object, params) => {
    if (client_disconnected(object) && !is_required_hook(hook)) {
        object.logdebug(`aborting ${hook} hook`);
        return;
    }
    let called_once = false;
    let timeout_id;
    let timed_out = false;
    let cancelled = false;
    let item;

    function cancel() {
        if (timeout_id) clearTimeout(timeout_id);
        cancelled = true;
    }
    function callback(retval, msg) {
        if (timeout_id) clearTimeout(timeout_id);
        object.current_hook = null;
        if (cancelled) return; // This hook has been cancelled

        // Bail if client has disconnected
        if (client_disconnected(object) && !is_required_hook(hook)) {
            object.logdebug(`ignoring ${item[0].name} plugin callback`);
            return;
        }
        if (called_once && hook !== 'log') {
            if (!timed_out) {
                object.logerror(
                    `${item[0].name} plugin ran callback ` +
                        `multiple times - ignoring subsequent calls`
                );
                // Write a stack trace to the log to aid debugging
                object.logerror(new Error().stack);
            }
            return;
        }
        called_once = true;
        if (!retval) retval = constants.cont;

        log_run_item(item, hook, retval, object, params, msg);

        if (object.hooks_to_run.length !== 0) {
            if (retval === constants.cont) {
                return plugins.run_next_hook(hook, object, params);
            }
            if (hook === 'connect_init' || hook === 'disconnect') {
                // these hooks ignore retval and always run for every plugin
                return plugins.run_next_hook(hook, object, params);
            }
        }

        const respond_method = `${hook}_respond`;
        if (item && is_deny_retval(retval) && hook.substr(0, 5) !== 'init_') {
            object.deny_respond = get_denyfn(
                object,
                hook,
                params,
                retval,
                msg,
                respond_method
            );
            plugins.run_hooks('deny', object, [
                retval,
                msg,
                item[0].name,
                item[1],
                params,
                hook,
            ]);
        } else {
            object.hooks_to_run = [];
            object[respond_method](retval, msg, params);
        }
    }

    if (!object.hooks_to_run.length) return callback();

    // shift the next one off the stack and run it.
    item = object.hooks_to_run.shift();
    item.push(cancel);

    if (hook !== 'log' && item[0].timeout) {
        timeout_id = setTimeout(() => {
            timed_out = true;
            object.logcrit(
                `Plugin ${item[0].name} timed out on hook ${hook} - make sure it calls the callback`
            );
            callback(constants.denysoft, 'plugin timeout');
        }, item[0].timeout * 1000);
    }

    if (hook !== 'log') {
        object.logdebug(`running ${hook} hook in ${item[0].name} plugin`);
    }

    try {
        object.current_hook = item;
        object.hook = hook;
        item[0][item[1]].call(item[0], callback, object, params);
    } catch (err) {
        if (hook !== 'log') {
            object.logcrit(
                `Plugin ${item[0].name} failed: ${err.stack || err}`
            );
        }
        callback();
    }
};

function client_disconnected(object) {
    if (
        object.constructor.name === 'Connection' &&
        object.state >= constants.connection.state.DISCONNECTING
    ) {
        object.logdebug('client has disconnected');
        return true;
    }
    return false;
}

function is_required_hook(hook) {
    // Hooks that must always run
    switch (hook) {
        case 'reset_transaction':
        case 'disconnect':
        case 'log':
            return true;
        default:
            return false;
    }
}

function log_run_item(item, hook, retval, object, params, msg) {
    if (!item) return;
    if (hook === 'log') return;

    let log = 'logdebug';
    const is_not_cont =
        retval !== constants.cont && logger.would_log(logger.LOGINFO);
    if (is_not_cont) log = 'loginfo';
    if (is_not_cont || logger.would_log(logger.LOGDEBUG)) {
        object[log]({
            hook,
            plugin: item[0].name,
            function: item[1],
            params: params
                ? typeof params === 'string'
                    ? params
                    : params[0]
                : '',
            retval: constants.translate(retval),
            msg: msg ? msg : '',
        });
    }
}

function is_deny_retval(val) {
    switch (val) {
        case constants.deny:
        case constants.denysoft:
        case constants.denydisconnect:
        case constants.denysoftdisconnect:
            return true;
    }
    return false;
}

function get_denyfn(object, hook, params, retval, msg, respond_method) {
    return (deny_retval, deny_msg) => {
        switch (deny_retval) {
            case constants.ok:
                // Override rejection
                object.loginfo(
                    `deny(soft?) overriden by deny hook${
                        deny_msg ? ': deny_msg' : ''
                    }`
                );
                // Restore hooks_to_run with saved copy so that
                // any other plugins on this hook can also run.
                if (object.saved_hooks_to_run.length > 0) {
                    object.hooks_to_run = object.saved_hooks_to_run;
                    plugins.run_next_hook(hook, object, params);
                } else {
                    object[respond_method](constants.cont, deny_msg, params);
                }
                break;
            default:
                object.saved_hooks_to_run = [];
                object.hooks_to_run = [];
                object[respond_method](retval, msg, params);
        }
    };
}
