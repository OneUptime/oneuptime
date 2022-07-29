import ObjectID from 'Common/Types/ObjectID';
import { FindOperator, Raw } from 'typeorm';
import Text from 'Common/Types/Text';

export default class QueryHelper {
    public static findWithSameName(name: string): FindOperator<any> {
        name = name.toLowerCase().trim();
        const rid: string = Text.generateRandomText(10);
        return Raw(
            (alias: string) => {
                return `LOWER(${alias}) = :${rid}`;
            },
            {
                [rid]: `${name}`,
            }
        );
    }

    public static search(name: string): FindOperator<any> {
        name = name.toLowerCase().trim();
        const rid: string = Text.generateRandomText(10);
        return Raw(
            (alias: string) => {
                return `LOWER(${alias}) = :${rid}`;
            },
            {
                [rid]: `%${name}%`,
            }
        );
    }

    public static in(values: Array<string | ObjectID>): FindOperator<any> {
        values = values.map((value: string | ObjectID) => {
            return value.toString();
        });
        const rid: string = Text.generateRandomText(10);
        return Raw(
            (alias: string) => {
                return `${alias} IN (:...${rid})`;
            },
            {
                [rid]: values,
            }
        );
    }

    public static equalTo(value: string): FindOperator<any> {
        const rid: string = Text.generateRandomText(10);
        return Raw(
            (alias: string) => {
                return `${alias} = :${rid}`;
            },
            {
                [rid]: value.toString(),
            }
        );
    }
}
