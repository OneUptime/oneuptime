import { v4 as uuidv4 } from 'uuid';

class MongooseListener {
    private start;
    private end;

    constructor(start, end) {
        this.start = start;
        this.end = end;
    }

    wrapAsync(orig, name) {
        return async function (): void {
            const uuid = uuidv4();

            const operation = this.op;
            name = name || `mongoose.${operation}`; // mongose Query.exec specific
            const result = this.start(uuid, {
                path: operation,
                type: 'mongoose',
            });
            try {
                const res = await orig.apply(this, arguments);
                this.end(uuid, result, name);
                return res;
            } catch (err) {
                this.end(uuid, result, name);
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
