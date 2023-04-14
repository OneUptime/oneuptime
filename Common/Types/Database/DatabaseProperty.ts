import { FindOperator } from 'typeorm';
import { ValueTransformer } from 'typeorm/decorator/options/ValueTransformer';
import NotImplementedException from '../Exception/NotImplementedException';
import { JSONArray, JSONObject } from '../JSON';

export default class DatabaseProperty {
    public constructor() {}

    protected static fromDatabase(
        _value: string | number | JSONObject | JSONArray
    ): DatabaseProperty | null {
        throw new NotImplementedException();
    }

    protected static toDatabase(
        _value: DatabaseProperty | FindOperator<DatabaseProperty>
    ): string | number | JSONObject | JSONArray | null {
        throw new NotImplementedException();
    }

    protected static _fromDatabase(
        value: string | number | JSONObject | JSONArray
    ): DatabaseProperty | null {
        return this.fromDatabase(value);
    }

    protected static _toDatabase(
        value: DatabaseProperty | FindOperator<DatabaseProperty>
    ): string | number | JSONObject | JSONArray | null {
        // if its a RAW query. Return a raw query.
        if (value && (value as any)._type === 'raw') {
            return value as any;
        }

        return this.toDatabase(value);
    }

    public static getDatabaseTransformer(): ValueTransformer {
        return {
            to: (value: any) => {
                return this._toDatabase(value);
            },
            from: (value: any) => {
                return this._fromDatabase(value);
            },
        };
    }
}
