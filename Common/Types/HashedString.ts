import { FindOperator } from 'typeorm';
import UUID from '../Utils/UUID';
import DatabaseProperty from './Database/DatabaseProperty';
import BadOperationException from './Exception/BadOperationException';
import ObjectID from './ObjectID';
import CryptoJS from 'crypto-js';
import { JSONFunctions, JSONValue } from './JSON';
import BadDataException from './Exception/BadDataException';

export default class HashedString extends DatabaseProperty {
    private isHashed: boolean = false;

    private _value: string = '';
    public get value(): string {
        return this._value;
    }
    public set value(v: string) {
        this._value = v;
    }

    public constructor(value: string, isValueHashed: boolean = false) {
        super();
        this.value = value;
        this.isHashed = isValueHashed;
    }

    public override toString(): string {
        return this.value;
    }

    public static generate(): HashedString {
        return new this(UUID.generate());
    }

    protected static override toDatabase(
        value: HashedString | FindOperator<HashedString>
    ): string | null {
        if (value) {
            return value.toString();
        }

        return null;
    }

    public isValueHashed(): boolean {
        return this.isHashed;
    }

    public async hashValue(encryptionSecret: ObjectID | null): Promise<string> {
        if (!this.value) {
            return '';
        }

        if (this.isHashed) {
            throw new BadOperationException('Value is alredy hashed');
        }

        const valueToHash: string = (encryptionSecret || '') + this.value;
        this.isHashed = true;

        this.value = CryptoJS.SHA256(valueToHash).toString();
        return this.value;
    }

    public static async hashValue(
        value: string,
        encryptionSecret: ObjectID | null
    ): Promise<string> {
        const hashstring: HashedString = new HashedString(value, false);
        return await hashstring.hashValue(encryptionSecret);
    }

    protected static override fromDatabase(
        _value: string
    ): HashedString | null {
        if (_value) {
            return new HashedString(_value, true);
        }

        return null;
    }

    public static fromString(value: string): HashedString {
        return new HashedString(value, false);
    }

    public static isHashedString(value: JSONValue): boolean { 
        return JSONFunctions.deserializeValue(value) instanceof HashedString;
    }

    public static asHashedString(value: JSONValue): HashedString { 
        value = JSONFunctions.deserializeValue(value);

        if (value instanceof HashedString) {
            return value;
        }
        
        throw new BadDataException(`${value} is not of type HashedString`);
    }
}
