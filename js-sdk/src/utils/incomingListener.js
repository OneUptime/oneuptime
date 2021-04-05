'use strict';
/* eslint-disable no-console */
/*eslint-disable no-unused-vars*/
const Http = require('http');
//const { performance, PerformanceObserver } = require('perf_hooks');

const { v4: uuidv4 } = require('uuid');

//const obs = new PerformanceObserver((list, observer) => {
//    console.log(list.getEntries()[0]);
//    performance.clearMarks();
//observer.disconnect();
//});
//obs.observe({ entryTypes: ['measure'] });

const context = new Map();

const emit = Http.Server.prototype.emit;
Http.Server.prototype.emit = function(type) {
    if (type === 'request') {
        const [req, res] = [arguments[1], arguments[2]];

        req.apm = {};
        req.apm.uuid = uuidv4();
        const startHrTime = process.hrtime();
        //performance.mark(`start-${req.apm.uuid}`);
        res.on('finish', () => {
            const elapsedHrTime = process.hrtime(startHrTime);
            const elapsedTimeInMs =
                elapsedHrTime[0] * 1000 + elapsedHrTime[1] / 1e6;
            console.log('incoming', elapsedTimeInMs);
            //performance.mark(`end-${req.apm.uuid}`);
            // performance.measure(
            //     `request-${req.apm.uuid}`,
            //     `start-${req.apm.uuid}`,
            //     `end-${req.apm.uuid}`
            // );
        });
    }

    return emit.apply(this, arguments);
};

const init = function(asyncId, type, triggerAsyncId) {
    if (context.has(triggerAsyncId)) {
        context.set(asyncId, context.get(triggerAsyncId));
    }
};

const destroy = function(asyncId) {
    if (context.has(asyncId)) {
        context.delete(asyncId);
    }
};

module.exports = { init, destroy };
