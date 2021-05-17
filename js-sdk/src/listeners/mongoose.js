'use strict';
/* eslint-disable no-console */
/*eslint-disable no-unused-vars*/
const { v4: uuidv4 } = require('uuid');

class MongooseListener {
    #start;
    #end;
    constructor(start, end) {
        this.#start = start;
        this.#end = end;
    }
    wrapAsync(orig, name) {
        const _this = this;
        return async function() {
            const uuid = uuidv4();
            const operation = this.op;
            name = name || `mongoose.${operation}`; // mongose Query.exec specific
            const result = _this.#start(uuid, {
                path: operation,
                type: 'mongoose',
            });
            try {
                const res = await orig.apply(this, arguments);
                _this.#end(uuid, result, name);
                return res;
            } catch (err) {
                _this.#end(uuid, result, name);
                throw err;
            }
        };
    }

    _setUpMongooseListener(mod) {
        const proto = Object.getPrototypeOf(mod);
        const exec = proto.Query.prototype.exec;

        proto.Query.prototype.exec = this.wrapAsync(exec);

        const Model = proto.Model;

        const remove = Model.prototype.remove;
        Model.prototype.remove = this.wrapAsync(remove, 'mongoose.remove');

        const save = Model.prototype.save;
        Model.prototype.save = this.wrapAsync(save, 'mongoose.save');

        return mod;
    }
}
export default MongooseListener;
