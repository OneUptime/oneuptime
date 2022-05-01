// This is for Object ID for all the things in our database.
import { ValueTransformer } from 'typeorm';
import UUID from '../Utils/UUID';

export default class ObjectID {
    private _id: string = '';
    public get id(): string {
        return this._id;
    }
    public set id(v: string) {
        this._id = v;
    }

    public constructor(id: string) {
        this.id = id;
    }

    public toString(): string {
        return this.id;
    }

    public static generate(): ObjectID {
        return new this(UUID.generate());
    }

    public static getDatabaseTransformer(): ValueTransformer {
        return {
            to(value: ObjectID): string {
                return value.toString();
            },
            from(value: string): ObjectID {
                return new ObjectID(value);
            }
        };
    }
}
