// This is for Object ID for all the things in our database.
import { FindOperator } from 'typeorm';
import UUID from '../Utils/UUID';
import DatabaseProperty from './Database/DatabaseProperty';

export default class ObjectID extends DatabaseProperty {
    private _id: string = '';
    public get id(): string {
        return this._id;
    }
    public set id(v: string) {
        this._id = v;
    }

    public constructor(id: string) {
        super();
        this.id = id;
    }

    public override toString(): string {
        return this.id;
    }

    public static generate(): ObjectID {
        return new this(UUID.generate());
    }

    protected static override toDatabase(
        _value: ObjectID | FindOperator<ObjectID>
    ): string | null {
        if (_value) {
            return _value.toString();
        }

        return null;
    }

    protected static override fromDatabase(_value: string): ObjectID | null {
        if (_value) {
            return new ObjectID(_value);
        }

        return null;
    }

    public static fromString(id: string): ObjectID {
        return new ObjectID(id);
    }
}
