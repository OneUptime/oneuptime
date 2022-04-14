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
            const uuid: $TSFixMe = uuidv4();

            const operation: $TSFixMe = this.op;
            name = name || `mongoose.${operation}`; // mongose Query.exec specific
            const result: $TSFixMe = this.start(uuid, {
                path: operation,
                type: 'mongoose',
            });
            try {
                const res: $TSFixMe = await orig.apply(this, arguments);
                this.end(uuid, result, name);
                return res;
            } catch (err) {
                this.end(uuid, result, name);
                throw err;
            }
        };
    }

    _setUpMongooseListener(mod): void {
        const proto: $TSFixMe = Object.getPrototypeOf(mod);
        const exec: $TSFixMe = proto.Query.prototype.exec;

        proto.Query.prototype.exec = this.wrapAsync(exec);

        const Model: $TSFixMe = proto.Model;

        const remove: $TSFixMe = Model.prototype.remove;
        Model.prototype.remove = this.wrapAsync(remove, 'mongoose.remove');

        const save: $TSFixMe = Model.prototype.save;
        Model.prototype.save = this.wrapAsync(save, 'mongoose.save');

        return mod;
    }
}
export default MongooseListener;
