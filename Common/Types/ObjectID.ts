// This is for Object ID for all the things in our database.
import { FindOperator, ValueTransformer } from 'typeorm';
import UUID from '../Utils/UUID';
import DatabaseProperty from './DatabaseProperty';

export default class ObjectID extends DatabaseProperty {
    private _id: string = '';
    public get id(): string {
        return this._id;
    }
    public set id(v: string) {
        this._id = v;
    }

    public constructor(id: string) {
        super()
        this.id = id;
    }

    public override toString(): string {
        return this.id;
    }

    public static generate(): ObjectID {
        return new this(UUID.generate());
    }

    public static override getDatabaseTransformer(): ValueTransformer {
        return {
            to(value: ObjectID | FindOperator<ObjectID>): string {
                if (value instanceof FindOperator) {
                    return value.value.toString();
                }
                return value.toString();
            },
            from(value: string): ObjectID {
                return new ObjectID(value);
            }
        };
    }
}
