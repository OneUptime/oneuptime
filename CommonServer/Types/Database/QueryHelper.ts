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
}
