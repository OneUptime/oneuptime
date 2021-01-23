'use strict';

const logger = require('../logger');

class TQTimer {
    constructor(id, fire_time, cb) {
        this.id = id;
        this.fire_time = fire_time;
        this.cb = cb;
    }

    cancel() {
        this.cb = null;
    }
}

class TimerQueue {
    constructor(interval) {
        const self = this;
        interval = interval || 1000;
        this.queue = [];
        this.interval_timer = setInterval(() => {
            self.fire();
        }, interval);
    }

    add(id, ms, cb) {
        const fire_time = Date.now() + ms;

        const timer = new TQTimer(id, fire_time, cb);

        if (
            this.queue.length === 0 ||
            fire_time >= this.queue[this.queue.length - 1].fire_time
        ) {
            this.queue.push(timer);
            return timer;
        }

        for (let i = 0; i < this.queue.length; i++) {
            if (this.queue[i].fire_time > fire_time) {
                this.queue.splice(i, 0, timer);
                return timer;
            }
        }

        throw 'Should never get here';
    }

    discard(id) {
        for (let i = 0; i < this.queue.length; i++) {
            if (this.queue[i].id === id) {
                this.queue[i].cancel();
                return this.queue.splice(i, 1);
            }
        }

        throw `${id} not found`;
    }

    fire() {
        if (this.queue.length === 0) return;

        const now = Date.now();

        while (this.queue.length && this.queue[0].fire_time <= now) {
            const to_run = this.queue.shift();
            if (to_run.cb) to_run.cb();
        }
    }

    length() {
        return this.queue.length;
    }

    drain() {
        logger.logdebug(`Draining ${this.queue.length} items from the queue`);
        while (this.queue.length) {
            const to_run = this.queue.shift();
            if (to_run.cb) to_run.cb();
        }
    }

    shutdown() {
        clearInterval(this.interval_timer);
    }
}

module.exports = TimerQueue;
