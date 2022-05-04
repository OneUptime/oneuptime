import { FindOperator } from 'typeorm';
import { ValueTransformer } from 'typeorm/decorator/options/ValueTransformer';
import NotImplementedException from '../Exception/NotImplementedException';

export default class DatabaseProperty {
    constructor() {}

    protected static fromDatabase(_value: string | number): DatabaseProperty {
        throw new NotImplementedException();
    }

    protected static toDatabase(
        _value: DatabaseProperty | FindOperator<DatabaseProperty>
    ): string | number {
        throw new NotImplementedException();
    }

    public static getDatabaseTransformer(): ValueTransformer {
        return {
            to: this.toDatabase,
            from: this.fromDatabase,
        };
    }
}
