import { FindOperator } from 'typeorm';
import { ValueTransformer } from 'typeorm/decorator/options/ValueTransformer';
import NotImplementedException from '../Exception/NotImplementedException';

export default class DatabaseProperty {
    public constructor() {}

    protected static fromDatabase(
        _value: string | number
    ): DatabaseProperty | null {
        throw new NotImplementedException();
    }

    protected static toDatabase(
        _value: DatabaseProperty | FindOperator<DatabaseProperty>
    ): string | number | null {
        throw new NotImplementedException();
    }

    protected static _fromDatabase(
        value: string | number
    ): DatabaseProperty | null {
        return this.fromDatabase(value);
    }

    protected static _toDatabase(
        value: DatabaseProperty | FindOperator<DatabaseProperty>
    ): string | number | null {

        if (value && (value as any)._type === 'raw' && Object.keys((value as any)._objectLiteralParameters).length > 0) {
            let returnVal = (value as any)._objectLiteralParameters[(Object.keys((value as any)._objectLiteralParameters) as any)[0]] as any;
            if (Array.isArray(returnVal) && returnVal.length > 0) {
                
                return returnVal[0];
            }
            return returnVal;
        }
        return this.toDatabase(value);
    }

    public static getDatabaseTransformer(): ValueTransformer {
        return {
            to: (value: any) => { return this._toDatabase(value) },
            from: (value: any) => { return this._fromDatabase(value) } ,
        };
    }
}
