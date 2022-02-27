'use strict';

/*eslint-disable no-unused-vars*/
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'uuid... Remove this comment to see the full error message
import { v4 as uuidv4} from 'uuid'

class MongooseListener {
    #start;
    #end;
    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'start' implicitly has an 'any' type.
    constructor(start, end) {
        this.#start = start;
        this.#end = end;
    }
    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'orig' implicitly has an 'any' type.
    wrapAsync(orig, name) {
        const _this = this;
        return async function() {
            const uuid = uuidv4();
            // @ts-expect-error ts-migrate(2683) FIXME: 'this' implicitly has type 'any' because it does n... Remove this comment to see the full error message
            const operation = this.op;
            name = name || `mongoose.${operation}`; // mongose Query.exec specific
            const result = _this.#start(uuid, {
                path: operation,
                type: 'mongoose',
            });
            try {
                // @ts-expect-error ts-migrate(2683) FIXME: 'this' implicitly has type 'any' because it does n... Remove this comment to see the full error message
                const res = await orig.apply(this, arguments);
                _this.#end(uuid, result, name);
                return res;
            } catch (err) {
                _this.#end(uuid, result, name);
                throw err;
            }
        };
    }

    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'mod' implicitly has an 'any' type.
    _setUpMongooseListener(mod) {
        const proto = Object.getPrototypeOf(mod);
        const exec = proto.Query.prototype.exec;

        // @ts-expect-error ts-migrate(2554) FIXME: Expected 2 arguments, but got 1.
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
