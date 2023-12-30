import { BaseQueryParams } from '@clickhouse/client';
import { integer } from '@elastic/elasticsearch/lib/api/types';
import { RecordValue } from 'Common/AnalyticsModels/CommonModel';
import TableColumnType from 'Common/Types/AnalyticsDatabase/TableColumnType';
import GreaterThan from 'Common/Types/BaseDatabase/GreaterThan';
import GreaterThanOrEqual from 'Common/Types/BaseDatabase/GreaterThanOrEqual';
import LessThan from 'Common/Types/BaseDatabase/LessThan';
import LessThanOrEqual from 'Common/Types/BaseDatabase/LessThanOrEqual';
import Search from 'Common/Types/BaseDatabase/Search';
import OneUptimeDate from 'Common/Types/Date';
import ObjectID from 'Common/Types/ObjectID';
import { inspect } from 'util';

/**
 * This file based on the sql-template-strings package, adapted for ClickHouse
 */

export type StatementParameter = {
    type: TableColumnType;
    value: RecordValue;
};

export class Statement implements BaseQueryParams {
    public constructor(
        private strings: string[] = [''],
        private values: Array<StatementParameter | string> = []
    ) {}

    public get query(): string {
        let query: string = this.strings.reduce(
            (prev: string, curr: string, i: integer) => {
                const param: StatementParameter | string = this.values[i - 1]!;
                const dataType: string =
                    typeof param === 'string'
                        ? 'Identifier'
                        : Statement.toColumnType(param.type);
                return prev + `{p${i - 1}:${dataType}}` + curr;
            }
        );

        // dedent lines
        query = query.trimEnd();
        const minIndent: number =
            query
                .match(/\n( *)/g)
                ?.reduce((minIndent: number, indent: string) => {
                    return Math.min(minIndent, indent.length - 1);
                }, Infinity) ?? 0;
        query = query.replace(new RegExp(`\n {${minIndent}}`, 'g'), '\n');
        query = query.trimStart();

        return query;
    }

    public get query_params(): Record<string, unknown> {
        let index: number = 0;

        const returnObject: Record<string, unknown> = {};

        for (const v of this.values) {
            let finalValue: any = v;

            // if of type date, convert to database date

            if (typeof v === 'string') {
                finalValue = v;
            } else if (v.value instanceof ObjectID) {
                finalValue = v.value.toString();
            } else if (v.value instanceof Search) {
                finalValue = `%${v.value.toString()}%`;
            } else if (
                v.value instanceof LessThan ||
                v.value instanceof LessThanOrEqual ||
                v.value instanceof GreaterThan ||
                v.value instanceof GreaterThanOrEqual
            ) {
                finalValue = v.value.value;
            } else if (v.value instanceof Date) {
                finalValue = OneUptimeDate.toDatabaseDate(v.value);
            } else {
                finalValue = v.value;
            }

            // serialize to date.

            if (typeof v !== 'string' && v.type === TableColumnType.Date) {
                finalValue = OneUptimeDate.fromString(finalValue as string);
                finalValue = OneUptimeDate.toDatabaseDate(finalValue);
            }

            returnObject[`p${index}`] = finalValue;

            index++;
        }

        return returnObject;
    }

    /**
     * Append an escaped SQL fragment. If you pass a raw String
     * it is appended as trusted SQL!
     */
    public append(statement: Statement | String): Statement {
        if (statement instanceof Statement) {
            this.strings[this.strings.length - 1] += statement.strings[0];
            this.strings.push(...statement.strings.slice(1));
            this.values.push(...statement.values);
        } else {
            this.strings[this.strings.length - 1] += statement;
        }
        return this;
    }

    // custom inspect for logging
    public [Symbol.for('nodejs.util.inspect.custom')](): string {
        return `Statement ${inspect({
            query: this.query,
            query_params: this.query_params,
        })}`;
    }

    private static toColumnType(type: TableColumnType): string {
        // ensure we have a mapping for all types (a missing mapping will
        // be a compile error)
        return {
            [TableColumnType.Text]: 'String',
            [TableColumnType.ObjectID]: 'String',
            [TableColumnType.Boolean]: 'Bool',
            [TableColumnType.Number]: 'Int32',
            [TableColumnType.Decimal]: 'Double',
            [TableColumnType.Date]: 'DateTime',
            [TableColumnType.JSON]: 'JSON',
            [TableColumnType.NestedModel]: 'Nested',
            [TableColumnType.ArrayNumber]: 'Array(Int32)',
            [TableColumnType.ArrayText]: 'Array(String)',
            [TableColumnType.LongNumber]: 'Int128',
        }[type];
    }
}

/**
 * ClickHouse SQL template literal tag.
 *
 * String substitution values are interpereted as Identifiers (e.g. table or column names),
 * other substitution values must be StatementParameters.
 */
export function SQL(
    strings: TemplateStringsArray,
    ...values: Array<StatementParameter | string>
): Statement {
    return new Statement(strings.slice(0), values.slice(0));
}
