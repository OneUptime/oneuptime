'use strict';

const config = require('haraka-config');

function load_config() {
    const cfg = (exports.cfg = config.get(
        'outbound.ini',
        {
            booleans: [
                '-disabled',
                '-always_split',
                '+enable_tls',
                '-ipv6_enabled',
            ],
        },
        () => {
            load_config();
        }
    ).main);

    // legacy config file support. Remove in Haraka 4.0
    if (!cfg.disabled && config.get('outbound.disabled')) {
        cfg.disabled = true;
    }
    if (!cfg.enable_tls && config.get('outbound.enable_tls')) {
        cfg.enable_tls = true;
    }
    if (!cfg.maxTempFailures) {
        cfg.maxTempFailures = config.get('outbound.maxTempFailures') || 13;
    }
    if (!cfg.concurrency_max) {
        cfg.concurrency_max = config.get('outbound.concurrency_max') || 10000;
    }
    if (!cfg.connect_timeout) {
        cfg.connect_timeout = 30;
    }
    if (cfg.pool_timeout === undefined) {
        cfg.pool_timeout = 50;
    }
    if (cfg.pool_concurrency_max === undefined) {
        cfg.pool_concurrency_max = 10;
    }
    if (!cfg.ipv6_enabled && config.get('outbound.ipv6_enabled')) {
        cfg.ipv6_enabled = true;
    }
    if (!cfg.received_header) {
        cfg.received_header =
            config.get('outbound.received_header') || 'Haraka outbound';
    }
}

load_config();
