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

    public static getDatabaseTransformer(): ValueTransformer {
        return {
            to: this.toDatabase,
            from: this.fromDatabase,
        };
    }
}
