'use strict';
/* eslint-disable no-console */
/*eslint-disable no-unused-vars*/
//const { performance } = require('perf_hooks');

const { v4: uuidv4 } = require('uuid');

const wrapAsync = function(orig, name) {
    return async function() {
        //const uuid = uuidv4();

        name = name || `mongoose.${this.op}`; // mongose Query.exec specific
        const startHrTime = process.hrtime();
        try {
            //performance.mark(`start-${uuid}`);
            const res = await orig.apply(this, arguments);
            //performance.mark(`end-${uuid}`);
            //performance.measure(
            //    `${name}-${uuid}`,
            //    `start-${uuid}`,
            //    `end-${uuid}`
            //);
            const elapsedHrTime = process.hrtime(startHrTime);
            const elapsedTimeInMs =
                elapsedHrTime[0] * 1000 + elapsedHrTime[1] / 1e6;
            console.log(name, elapsedTimeInMs);
            return res;
        } catch (err) {
            const elapsedHrTime = process.hrtime(startHrTime);
            const elapsedTimeInMs =
                elapsedHrTime[0] * 1000 + elapsedHrTime[1] / 1e6;
            console.log(name, elapsedTimeInMs);
            //performance.mark(`end-${uuid}`);
            //performance.measure(
            //    `${name}-${uuid}`,
            //   `start-${uuid}`,
            //   `end-${uuid}`
            // );
            throw err;
        }
    };
};

export default function(mod) {
    const proto = Object.getPrototypeOf(mod);
    const exec = proto.Query.prototype.exec;

    proto.Query.prototype.exec = wrapAsync(exec);

    const Model = proto.Model;

    const remove = Model.prototype.remove;
    Model.prototype.remove = wrapAsync(remove, 'mongoose.remove');

    const save = Model.prototype.save;
    Model.prototype.save = wrapAsync(save, 'mongoose.save');

    return mod;
}
