'use strict';

const net = require('net');
const utils = require('haraka-utils');

/* HostPool:
 *
 * Starts with a pool of backend hosts from a "forwarding_host_pool"
 * configuration that looks like this (port defaults to 25 if not set):
 *
 *      1.1.1.1:11, 2.2.2.2:22, 3.3.3.3:33
 *
 * It randomizes the list and then gives then out sequentially (for
 * predictability).
 *
 * If failed() is called with one of the hosts, we mark it down for retry_secs
 * and don't give it out again until that period has passed.
 *
 * If *all* the hosts have been marked down, ignore the marks and give
 * out the next host. That's to keep a random short-lived but widespread
 * network failure from taking the whole system down.
 */

const logger = require('./logger');

class HostPool {
    // takes a comma/space-separated list of ip:ports
    //  1.1.1.1:22,  3.3.3.3:44
    constructor(hostports_str, retry_secs) {
        const self = this;
        const hosts = (hostports_str || '')
            .trim()
            .split(/[\s,]+/)
            .map(hostport => {
                const splithost = hostport.split(/:/);
                if (!splithost[1]) {
                    splithost[1] = 25;
                }
                return {
                    host: splithost[0],
                    port: splithost[1],
                };
            });
        self.hostports_str = hostports_str;
        self.hosts = utils.shuffle(hosts);
        self.dead_hosts = {}; // hostport => true/false
        self.last_i = 0; // the last one we checked
        self.retry_secs = retry_secs || 10;
    }

    /* failed
     *
     * Part of the external API for this module. Call it when you see a failure to
     * this backend host and it'll come out of the pool and put into the recheck
     * timer.
     */
    failed(host, port) {
        const self = this;
        const key = `${host}:${port}`;
        const retry_msecs = self.retry_secs * 1000;
        self.dead_hosts[key] = true;

        function cb_if_still_dead() {
            logger.logwarn(
                `${host} ${key} is still dead, will retry in ${self.retry_secs} secs`
            );
            self.dead_hosts[key] = true;
            // console.log(1);
            setTimeout(() => {
                self.probe_dead_host(host, port, cb_if_still_dead, cb_if_alive);
            }, retry_msecs);
        }

        function cb_if_alive() {
            // console.log(2);
            logger.loginfo(`${host} ${key} is back! adding back into pool`);
            delete self.dead_hosts[key];
        }

        setTimeout(() => {
            self.probe_dead_host(host, port, cb_if_still_dead, cb_if_alive);
        }, retry_msecs);
    }

    /* probe_dead_host
     *
     * When the timer fires, we'll ping the host, and if it's still dead we'll
     * update the dead_hosts list.  If it's back online, we just don't touch the
     * dead_hosts lists, and the next time get_host() is called, it'll be in the
     * mix.
     */
    probe_dead_host(host, port, cb_if_still_dead, cb_if_alive) {
        const self = this;
        logger.loginfo(`probing dead host ${host}:${port}`);

        const connect_timeout_ms = 200; // keep it snappy
        let s;
        try {
            s = self.get_socket();
            s.setTimeout(connect_timeout_ms, () => {
                // nobody home, it's still dead
                s.destroy();
                cb_if_still_dead();
            });
            s.on('error', e => {
                // silently catch all errors - assume the port is closed
                s.destroy();
                cb_if_still_dead();
            });

            s.connect(port, host, () => {
                cb_if_alive();
                s.destroy(); // will this conflict with setTimeout's s.destroy?
            });
        } catch (e) {
            // only way to catch run-time javascript errors in here;
            console.log(`ERROR in probe_dead_host, got error ${e}`);
            throw e;
        }
    }

    /* get_socket
     *
     * so we can override in unit test
     */
    get_socket() {
        const s = new net.Socket();
        return s;
    }

    /* get_host
     *
     * This approach borrowed from the danga mogilefs client code
     *
     * If all the hosts look dead, it returns the next one it would have tried
     * anyway. That should make it more forgiving about transient but widespread
     * network problems that make all the hosts look dead.
     */
    get_host() {
        let host;
        let found;

        let first_i = this.last_i + 1;
        if (first_i >= this.hosts.length) {
            first_i = 0;
        }

        for (let i = 0; i < this.hosts.length; ++i) {
            let j = i + first_i;
            if (j >= this.hosts.length) {
                j = j - this.hosts.length;
            }
            host = this.hosts[j];
            const key = `${host.host}:${host.port}`;
            if (this.dead_hosts[key]) {
                continue;
            }
            this.last_i = j;
            found = true;
            break;
        }
        if (found) {
            return host;
        } else {
            logger.logwarn(
                `no working hosts found, retrying a dead one, config (probably from smtp_forward.forwarding_host_pool) is '${this.hostports_str}'`
            );
            this.last_i = first_i;
            return this.hosts[first_i];
        }
    }
}

module.exports = HostPool;
