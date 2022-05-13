import { FindOperator } from 'typeorm';
import UUID from '../Utils/UUID';
import DatabaseProperty from './Database/DatabaseProperty';
import BadOperationException from './Exception/BadOperationException';
import EncryptionAlgorithm from './EncryptionAlgorithm';
import ObjectID from './ObjectID';

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
        _value: HashedString | FindOperator<HashedString>
    ): string | null {
        if (_value) {
            return _value.toString();
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

        // encode as UTF-8
        const msgBuffer: Uint8Array = new TextEncoder().encode(valueToHash);

        // hash the message
        const hashBuffer: ArrayBuffer = await crypto.subtle.digest(
            EncryptionAlgorithm.SHA256,
            msgBuffer
        );

        // convert ArrayBuffer to Array
        const hashArray: Array<number> = Array.from(new Uint8Array(hashBuffer));

        // convert bytes to hex string
        const hashHex: string = hashArray
            .map((b: number) => {
                return b.toString(16).padStart(2, '0');
            })
            .join('');
        this.value = hashHex;
        return hashHex;
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
}
