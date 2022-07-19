import ObjectID from 'Common/Types/ObjectID';
import { FindOperator, Raw } from 'typeorm';

export default class QueryHelper {
    public static findWithSameName(name: string): FindOperator<any> {
        return Raw(
            (alias: string) => {
                return `LOWER(${alias}) LIKE LOWER(:value)`;
            },
            {
                value: `%${name}%`,
            }
        );
    }

    public static In(values: Array<string | ObjectID>): FindOperator<any> {

        values = values.map((value) => value.toString());

        return Raw(
            (alias: string) => {
                return `${alias} IN (:value)`;
            },
            {
                value: values.join(","),
            }
        );
    }
}
