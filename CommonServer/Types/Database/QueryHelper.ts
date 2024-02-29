import ObjectID from 'Common/Types/ObjectID';
import { FindOperator, Raw } from 'typeorm';
import Text from 'Common/Types/Text';
import Typeof from 'Common/Types/Typeof';
import Dictionary from 'Common/Types/Dictionary';
import BaseModel from 'Common/Models/BaseModel';
import { JSONObject } from 'Common/Types/JSON';

export default class QueryHelper {
    public static findWithSameText(text: string | number): FindOperator<any> {
        let isString: boolean = false;

        if (typeof text === Typeof.String) {
            text = (text as string).toLowerCase().trim();
            isString = true;
        }
        const rid: string = Text.generateRandomText(10);
        return Raw(
            (alias: string) => {
                return isString
                    ? `(LOWER(${alias}) = :${rid})`
                    : `(${alias} = :${rid})`;
            },
            {
                [rid]: `${text}`,
            }
        );
    }

    public static isNull(): any {
        return Raw((alias: string) => {
            return `(${alias} IS NULL)`;
        });
    }

    public static notNull(): any {
        return Raw((alias: string) => {
            return `(${alias} IS NOT NULL)`;
        });
    }

    public static equalToOrNull(
        value: string | ObjectID | Array<string | ObjectID>
    ): FindOperator<any> {
        const rid: Array<string> = [];
        const valuesObj: Dictionary<string> = {};

        if (Array.isArray(value)) {
            for (const item of value) {
                const temp: string = Text.generateRandomText(10);
                rid.push(temp);
                valuesObj[temp] = item.toString();
            }
        } else {
            const temp: string = Text.generateRandomText(10);
            rid.push(temp);
            valuesObj[temp] = value.toString();
        }

        // construct string

        type ConstructQueryFunction = (alias: string) => string;

        const constructQuery: ConstructQueryFunction = (
            alias: string
        ): string => {
            let query: string = '(';

            query += rid
                .map((item: string) => {
                    return `${alias} = :${item}`;
                })
                .join(' or ');

            query += ` or ${alias} IS NULL)`;

            return query;
        };

        return Raw(
            (alias: string) => {
                return constructQuery(alias);
            },
            {
                ...valuesObj,
            }
        );
    }

    public static notEquals(value: string | ObjectID): FindOperator<any> {
        const rid: string = Text.generateRandomText(10);
        return Raw(
            (alias: string) => {
                return `(${alias} != :${rid})`;
            },
            {
                [rid]: value.toString(),
            }
        );
    }

    public static search(name: string): FindOperator<any> {
        name = name.toLowerCase().trim();
        const rid: string = Text.generateRandomText(10);
        return Raw(
            (alias: string) => {
                return `(LOWER(${alias}) LIKE (:${rid}))`;
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

        if (!values || values.length === 0) {
            return Raw(() => {
                return `TRUE = FALSE`; // this will always return false
            }, {});
        }

        return Raw(
            (alias: string) => {
                return `(${alias} IN (:...${rid}))`;
            },
            {
                [rid]: values,
            }
        );
    }

    public static inRelationArray(
        values: Array<BaseModel | ObjectID>
    ): Array<any> {
        return values.map((item: BaseModel | ObjectID) => {
            if (item instanceof ObjectID) {
                return item;
            }

            return item.id!;
        });
    }

    public static equalTo(value: string): FindOperator<any> {
        const rid: string = Text.generateRandomText(10);
        return Raw(
            (alias: string) => {
                return `(${alias} = :${rid})`;
            },
            {
                [rid]: value.toString(),
            }
        );
    }

    public static greaterThanEqualTo(value: number | Date): FindOperator<any> {
        const rid: string = Text.generateRandomText(10);
        return Raw(
            (alias: string) => {
                return `(${alias} >= :${rid})`;
            },
            {
                [rid]: value,
            }
        );
    }

    public static greaterThanEqualToOrNull(
        value: number | Date
    ): FindOperator<any> {
        const rid: string = Text.generateRandomText(10);
        return Raw(
            (alias: string) => {
                return `(${alias} >= :${rid} or ${alias} IS NULL)`;
            },
            {
                [rid]: value,
            }
        );
    }

    public static lessThanEqualTo(value: number | Date): FindOperator<any> {
        const rid: string = Text.generateRandomText(10);
        return Raw(
            (alias: string) => {
                return `(${alias} <= :${rid})`;
            },
            {
                [rid]: value,
            }
        );
    }

    public static lessThanEqualToOrNull(
        value: number | Date
    ): FindOperator<any> {
        const rid: string = Text.generateRandomText(10);
        return Raw(
            (alias: string) => {
                return `(${alias} <= :${rid} or ${alias} IS NULL)`;
            },
            {
                [rid]: value,
            }
        );
    }

    public static greaterThan(value: number | Date): FindOperator<any> {
        const rid: string = Text.generateRandomText(10);
        return Raw(
            (alias: string) => {
                return `(${alias} > :${rid})`;
            },
            {
                [rid]: value,
            }
        );
    }

    public static greaterThanOrNull(value: number | Date): FindOperator<any> {
        const rid: string = Text.generateRandomText(10);
        return Raw(
            (alias: string) => {
                return `(${alias} <= :${rid} or ${alias} IS NULL)`;
            },
            {
                [rid]: value,
            }
        );
    }

    public static inBetween(
        startValue: number | Date,
        endValue: number | Date
    ): FindOperator<any> {
        const rid1: string = Text.generateRandomText(10);
        const rid2: string = Text.generateRandomText(10);
        return Raw(
            (alias: string) => {
                return `(${alias} >= :${rid1} and ${alias} <= :${rid2})`;
            },
            {
                [rid1]: startValue,
                [rid2]: endValue,
            }
        );
    }

    public static inBetweenOrNull(
        startValue: number | Date,
        endValue: number | Date
    ): FindOperator<any> {
        const rid1: string = Text.generateRandomText(10);
        const rid2: string = Text.generateRandomText(10);
        return Raw(
            (alias: string) => {
                return `(((${alias} >= :${rid1} and ${alias} <= :${rid2})) or (${alias} IS NULL))`;
            },
            {
                [rid1]: startValue,
                [rid2]: endValue,
            }
        );
    }

    public static queryJson(value: JSONObject): FindOperator<any> {
        // seed random text
        const values: JSONObject = {};

        let queryText: string = '';

        if (typeof value === Typeof.String) {
            value = JSON.parse(value.toString());
        }

        const hasValue: boolean = value && Object.keys(value).length > 0;

        for (const key in value) {
            const temp: string = Text.generateRandomText(10);

            values[temp] = value[key];

            if (!queryText) {
                queryText = `(COLUMN_NAME_ALIAS->>'${key}' = :${
                    temp as string
                }`;
            } else {
                queryText += ` AND COLUMN_NAME_ALIAS->>'${key}' = :${
                    temp as string
                }`;
            }
        }

        if (hasValue) {
            queryText += ')';
        } else {
            queryText =
                "(COLUMN_NAME_ALIAS IS NULL OR COLUMN_NAME_ALIAS = '{}')";
        }

        return Raw((alias: string) => {
            // alias is table name + column name like tableName.columnName
            // we need to convert this to "tableName"."columnName"

            alias = alias
                .split('.')
                .map((item: string) => {
                    return `"${item}"`;
                })
                .join('.');

            queryText = Text.replaceAll(
                queryText,
                'COLUMN_NAME_ALIAS',
                `${alias}`
            );
            return queryText;
        }, values);
    }

    public static lessThan(value: number | Date): FindOperator<any> {
        const rid: string = Text.generateRandomText(10);
        return Raw(
            (alias: string) => {
                return `(${alias} < :${rid})`;
            },
            {
                [rid]: value,
            }
        );
    }
}
