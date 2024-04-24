import AnalyticsBaseModel from 'Common/AnalyticsModels/BaseModel';
import BadDataException from 'Common/Types/Exception/BadDataException';
import Query from '../../Types/AnalyticsDatabase/Query';
import AnalyticsTableColumn from 'Common/Types/AnalyticsDatabase/TableColumn';
import ClickhouseDatabase from '../../Infrastructure/ClickhouseDatabase';
import Sort from '../../Types/AnalyticsDatabase/Sort';
import Select from '../../Types/AnalyticsDatabase/Select';
import TableColumnType from 'Common/Types/AnalyticsDatabase/TableColumnType';
import logger from '../Logger';
import UpdateBy from '../../Types/AnalyticsDatabase/UpdateBy';
import OneUptimeDate from 'Common/Types/Date';
import CommonModel, {
    RecordValue,
    Record,
} from 'Common/AnalyticsModels/CommonModel';
import { SQL, Statement } from './Statement';
import SortOrder from 'Common/Types/BaseDatabase/SortOrder';
import Search from 'Common/Types/BaseDatabase/Search';
import NotEqual from 'Common/Types/BaseDatabase/NotEqual';
import GreaterThan from 'Common/Types/BaseDatabase/GreaterThan';
import LessThan from 'Common/Types/BaseDatabase/LessThan';
import LessThanOrEqual from 'Common/Types/BaseDatabase/LessThanOrEqual';
import GreaterThanOrEqual from 'Common/Types/BaseDatabase/GreaterThanOrEqual';
import InBetween from 'Common/Types/BaseDatabase/InBetween';
import IsNull from 'Common/Types/BaseDatabase/IsNull';
import Includes from 'Common/Types/BaseDatabase/Includes';
// import JSONFunctions from 'Common/Types/JSONFunctions';
// import { JSONObject } from 'Common/Types/JSON';

export default class StatementGenerator<TBaseModel extends AnalyticsBaseModel> {
    public model!: TBaseModel;
    public modelType!: { new (): TBaseModel };
    public database!: ClickhouseDatabase;

    public constructor(data: {
        modelType: { new (): TBaseModel };
        database: ClickhouseDatabase;
    }) {
        this.modelType = data.modelType;
        this.model = new this.modelType();
        this.database = data.database;
    }

    public toUpdateStatement(updateBy: UpdateBy<TBaseModel>): Statement {
        const setStatement: Statement = this.toSetStatement(updateBy.data);
        const whereStatement: Statement = this.toWhereStatement(updateBy.query);

        /* eslint-disable prettier/prettier */
        const statement: Statement = SQL`
            ALTER TABLE ${this.database.getDatasourceOptions().database!}.${this.model.tableName
            }
            UPDATE `.append(setStatement).append(SQL`
            WHERE TRUE `).append(whereStatement);
        /* eslint-enable prettier/prettier */

        logger.debug(`${this.model.tableName} Update Statement`);
        logger.debug(statement);

        return statement;
    }

    public getColumnNames(
        tableColumns: Array<AnalyticsTableColumn>
    ): Array<string> {
        const columnNames: Array<string> = [];
        for (const column of tableColumns) {
            if (column.type === TableColumnType.NestedModel) {
                // Example of nested model query:

                /**
                 * 
                 * INSERT INTO opentelemetry_spans (trace_id, span_id, attributes.key, attributes.value) VALUES 
                    ('trace1', 'span1', ['key1', 'key2'], ['value1', 'value2']),
                    ('trace2', 'span2', ['keyA', 'keyB'], ['valueA', 'valueB']);
                 */

                // Nested Model Support.
                const nestedModelColumnNames: Array<string> =
                    this.getColumnNames(column.nestedModel!.tableColumns);

                for (const nestedModelColumnName of nestedModelColumnNames) {
                    columnNames.push(`${column.key}.${nestedModelColumnName}`);
                }
            } else {
                columnNames.push(column.key);
            }
        }

        return columnNames;
    }

    public getRecordValuesStatement(record: Record): string {
        let valueStatement: string = '';

        for (const value of record) {
            if (Array.isArray(value)) {
                if (value.length === 0) {
                    valueStatement += `[], `;
                    continue;
                }

                valueStatement += `[${value.join(',')}], `;
            } else {
                valueStatement += `${value}, `;
            }
        }

        valueStatement = valueStatement.substring(0, valueStatement.length - 2); // remove last comma.

        return valueStatement;
    }

    public getValuesStatement(records: Array<Record>): string {
        let statement: string = '';
        for (const record of records) {
            statement += `(${this.getRecordValuesStatement(record)}), `;
        }

        statement = statement.substring(0, statement.length - 2); // remove last comma.

        return statement;
    }

    public toCreateStatement(data: { item: Array<TBaseModel> }): string {
        if (!data.item) {
            throw new BadDataException('Item cannot be null');
        }

        const columnNames: Array<string> = this.getColumnNames(
            this.model.getTableColumns()
        );

        const records: Array<Record> = [];

        for (const item of data.item) {
            const record: Record = this.getRecord(item);
            records.push(record);
        }

        const statement: string = `INSERT INTO ${
            this.database.getDatasourceOptions().database
        }.${this.model.tableName} 
        ( 
            ${columnNames.join(', ')}
        )
        VALUES
        ${this.getValuesStatement(records)}
        `;

        logger.debug(`${this.model.tableName} Create Statement`);
        logger.debug(statement);

        return statement;
    }

    private getRecord(item: CommonModel): Record {
        const record: Record = [];

        for (const column of item.getTableColumns()) {
            if (column.type === TableColumnType.NestedModel) {
                // Nested Model Support.

                // THis is very werid, but the output should work in a query like this:

                /**
                 * 
                 * INSERT INTO opentelemetry_spans (trace_id, span_id, attributes.key, attributes.value) VALUES 
                    ('trace1', 'span1', ['key1', 'key2'], ['value1', 'value2']),
                    ('trace2', 'span2', ['keyA', 'keyB'], ['valueA', 'valueB']);
                 */

                for (const subColumn of column.nestedModel!.tableColumns) {
                    const subRecord: Record = [];

                    for (const nestedModelItem of item.getColumnValue(
                        column.key
                    ) as Array<CommonModel>) {
                        const value: RecordValue = this.sanitizeValue(
                            nestedModelItem.getColumnValue(subColumn.key),
                            subColumn,
                            {
                                isNestedModel: true,
                            }
                        );

                        subRecord.push(value);
                    }

                    record.push(subRecord);
                }
            } else {
                const value: RecordValue | undefined = this.sanitizeValue(
                    item.getColumnValue(column.key),
                    column
                );

                record.push(value);
            }
        }

        return record;
    }

    private escapeStringLiteral(raw: string): string {
        // escape String literal based on https://clickhouse.com/docs/en/sql-reference/syntax#string
        return `'${raw.replace(/'|\\/g, '\\$&')}'`;
    }

    private sanitizeValue(
        value: RecordValue | undefined,
        column: AnalyticsTableColumn,
        options?: {
            isNestedModel?: boolean;
        }
    ): RecordValue {
        if (!value && value !== 0 && value !== false) {
            if (options?.isNestedModel) {
                if (column.type === TableColumnType.Text) {
                    return `''`;
                }

                if (column.type === TableColumnType.Number) {
                    return 0;
                }
            }

            return 'NULL';
        }

        if (
            column.type === TableColumnType.ObjectID ||
            column.type === TableColumnType.Text
        ) {
            value = this.escapeStringLiteral(value?.toString());
        }

        if (column.type === TableColumnType.Date && value instanceof Date) {
            value = `parseDateTimeBestEffortOrNull('${OneUptimeDate.toString(
                value as Date
            )}')`;
        }

        if (column.type === TableColumnType.Number) {
            if (typeof value === 'string') {
                value = parseInt(value);
            }
        }

        if (column.type === TableColumnType.Decimal) {
            if (typeof value === 'string') {
                value = parseFloat(value);
            }
        }

        if (column.type === TableColumnType.ArrayNumber) {
            value = `[${(value as Array<number>)
                .map((v: number) => {
                    if (v && typeof v !== 'number') {
                        v = parseFloat(v);
                        return isNaN(v) ? 'NULL' : v;
                    }
                    return v;
                })
                .join(', ')}]`;
        }

        if (column.type === TableColumnType.ArrayText) {
            value = `[${(value as Array<string>)
                .map((v: string) => {
                    return this.escapeStringLiteral(v);
                })
                .join(', ')}]`;
        }

        if (
            column.type === TableColumnType.JSON ||
            column.type === TableColumnType.JSONArray
        ) {
            value = this.escapeStringLiteral(JSON.stringify(value));
        }

        if (column.type === TableColumnType.LongNumber) {
            value = `CAST(${this.escapeStringLiteral(
                value.toString()
            )} AS Int128)`;
        }

        return value;
    }

    public toSetStatement(data: TBaseModel): Statement {
        const setStatement: Statement = new Statement();

        let first: boolean = true;
        for (const column of data.getTableColumns()) {
            const value: RecordValue | undefined = data.getColumnValue(
                column.key
            );
            if (value !== undefined) {
                if (first) {
                    first = false;
                } else {
                    setStatement.append(SQL`, `);
                }

                // special case - ClickHouse does not support using query
                // parameters for column names in the SET statement so we
                // have to trust the column names here.
                const keyStatement: string = column.key;

                setStatement.append(keyStatement).append(
                    SQL` = ${{
                        value,
                        type: column.type,
                    }}`
                );
            }
        }

        return setStatement;
    }

    /**
     * Conditions to append to "WHERE TRUE"
     */
    public toWhereStatement(query: Query<TBaseModel>): Statement {
        const whereStatement: Statement = new Statement();

        let first: boolean = true;
        for (const key in query) {
            const value: any = query[key];
            const tableColumn: AnalyticsTableColumn | null =
                this.model.getTableColumn(key);

            if (!tableColumn) {
                throw new BadDataException(`Unknown column: ${key}`);
            }

            if (first) {
                first = false;
            } else {
                whereStatement.append(SQL` `);
            }

            if (value instanceof Search) {
                whereStatement.append(
                    SQL`AND ${key} ILIKE ${{
                        value: value,
                        type: tableColumn.type,
                    }}`
                );
            } else if (value instanceof NotEqual) {
                whereStatement.append(
                    SQL`AND ${key} != ${{
                        value: value,
                        type: tableColumn.type,
                    }}`
                );
            } else if (value instanceof GreaterThan) {
                whereStatement.append(
                    SQL`AND ${key} > ${{
                        value: value,
                        type: tableColumn.type,
                    }}`
                );
            } else if (value instanceof LessThan) {
                whereStatement.append(
                    SQL`AND ${key} < ${{
                        value: value,
                        type: tableColumn.type,
                    }}`
                );
            } else if (value instanceof LessThanOrEqual) {
                whereStatement.append(
                    SQL`AND ${key} <= ${{
                        value: value,
                        type: tableColumn.type,
                    }}`
                );
            } else if (value instanceof GreaterThanOrEqual) {
                whereStatement.append(
                    SQL`AND ${key} >= ${{
                        value: value,
                        type: tableColumn.type,
                    }}`
                );
            } else if (value instanceof InBetween) {
                whereStatement.append(
                    SQL`AND ${key} >= ${{
                        value: value.startValue,
                        type: tableColumn.type,
                    }} AND ${key} <= ${{
                        value: value.endValue,
                        type: tableColumn.type,
                    }}`
                );
            } else if (value instanceof Includes) {
                whereStatement.append(
                    SQL`AND ${key} IN ${{
                        value: value,
                        type: tableColumn.type,
                    }}`
                );
            } else if (value instanceof IsNull) {
                if (tableColumn.type === TableColumnType.Text) {
                    whereStatement.append(
                        SQL`AND (${key} IS NULL OR ${key} = '')`
                    );
                } else {
                    whereStatement.append(SQL`AND ${key} IS NULL`);
                }
            } else if (
                (tableColumn.type === TableColumnType.JSON ||
                    tableColumn.type === TableColumnType.JSONArray) &&
                typeof value === 'object'
            ) {
                // const flatValue: JSONObject =
                //     JSONFunctions.flattenObject(value);

                // for (const objKey in flatValue) {
                //     if (flatValue[objKey] === undefined) {
                //         continue;
                //     }

                //     if (
                //         flatValue[objKey] &&
                //         typeof flatValue[objKey] === 'string'
                //     ) {
                //         whereStatement.append(
                //             SQL`AND JSONExtractString(${key}, ${{
                //                 value: key,
                //                 type: TableColumnType.Text,
                //             }}) = ${{
                //                 value: flatValue[objKey] as string,
                //                 type: TableColumnType.Text,
                //             }}`
                //         );
                //         continue;
                //     }

                //     if (
                //         flatValue[objKey] &&
                //         typeof flatValue[objKey] === 'number'
                //     ) {
                //         whereStatement.append(
                //             SQL`AND JSONExtractInt(${key}, ${{
                //                 value: key,
                //                 type: TableColumnType.Text,
                //             }}) = ${{
                //                 value: flatValue[objKey] as number,
                //                 type: TableColumnType.Number,
                //             }}`
                //         );
                //         continue;
                //     }
                // }

                whereStatement.append(
                    SQL`AND ${key} = ${{
                        value: JSON.stringify(value),
                        type: tableColumn.type,
                    }}`
                );
            } else {
                whereStatement.append(
                    SQL`AND ${key} = ${{ value, type: tableColumn.type }}`
                );
            }
        }

        return whereStatement;
    }

    public toSortStatement(sort: Sort<TBaseModel>): Statement {
        const sortStatement: Statement = new Statement();

        for (const key in sort) {
            const value: SortOrder = sort[key]!;
            sortStatement.append(SQL`${key} `).append(
                {
                    [SortOrder.Ascending]: SQL`ASC`,
                    [SortOrder.Descending]: SQL`DESC`,
                }[value]
            );
        }

        return sortStatement;
    }

    public toSelectStatement(select: Select<TBaseModel>): {
        statement: Statement;
        columns: Array<string>;
    } {
        const selectStatement: Statement = new Statement();
        const columns: Array<string> = [];

        let first: boolean = true;
        for (const key in select) {
            const value: any = select[key];
            if (value) {
                columns.push(key);
                if (first) {
                    first = false;
                } else {
                    selectStatement.append(SQL`, `);
                }
                selectStatement.append(SQL`${key}`);
            }
        }

        return {
            columns: columns,
            statement: selectStatement,
        };
    }

    public getColumnTypesStatement(columnName: string): string {
        return `SELECT type FROM system.columns WHERE table = '${
            this.model.tableName
        }' AND database = '${
            this.database.getDatasourceOptions().database
        }' AND name = '${columnName}'`;
    }

    public async toRenameColumnStatement(
        oldColumnName: string,
        newColumnName: string
    ): Promise<Statement> {
        const statement: string = `ALTER TABLE ${
            this.database.getDatasourceOptions().database
        }.${
            this.model.tableName
        } RENAME COLUMN IF EXISTS ${oldColumnName} TO ${newColumnName}`;

        return SQL`${statement}`;
    }

    public toColumnsCreateStatement(
        tableColumns: Array<AnalyticsTableColumn>,
        isNestedModel: boolean = false
    ): Statement {
        const columns: Statement = new Statement();

        // indent so combines nicely with toTableCreateStatement()
        const indent: Statement = SQL`                `;

        for (let i: number = 0; i < tableColumns.length; i++) {
            const column: AnalyticsTableColumn = tableColumns[i]!;

            if (i !== 0) {
                columns.append(SQL`,\n`);
            }
            if (isNestedModel) {
                columns.append(SQL`    `);
            }

            let nestedModelColumns: Statement | null = null;

            if (column.type === TableColumnType.NestedModel) {
                nestedModelColumns = SQL`(\n`
                    .append(
                        this.toColumnsCreateStatement(
                            column.nestedModel!.tableColumns,
                            true
                        )
                    )
                    .append(SQL`\n`)
                    .append(indent)
                    .append(SQL`)`);
            }

            // special case - ClickHouse does not support using an a query parameter
            // to specify the column name when creating the table
            const keyStatement: string = column.key;

            columns
                .append(indent)
                .append(keyStatement)
                .append(SQL` `)
                .append(this.toColumnType(column.type));
            if (nestedModelColumns) {
                columns.append(SQL` `).append(nestedModelColumns);
            }
        }

        return columns;
    }

    public toTableColumnType(
        clickhouseType: string
    ): TableColumnType | undefined {
        return {
            String: TableColumnType.Text,
            Int32: TableColumnType.Number,
            Int64: TableColumnType.LongNumber,
            Int128: TableColumnType.LongNumber,
            Float32: TableColumnType.Decimal,
            Float64: TableColumnType.Decimal,
            DateTime: TableColumnType.Date,
            'Array(String)': TableColumnType.ArrayText,
            'Array(Int32)': TableColumnType.ArrayNumber,
            JSON: TableColumnType.JSON, //JSONArray is also JSON
            Nested: TableColumnType.NestedModel,
            Bool: TableColumnType.Boolean,
        }[clickhouseType];
    }

    public toColumnType(type: TableColumnType): Statement {
        return {
            [TableColumnType.Text]: SQL`String`,
            [TableColumnType.ObjectID]: SQL`String`,
            [TableColumnType.Boolean]: SQL`Bool`,
            [TableColumnType.Number]: SQL`Int32`,
            [TableColumnType.Decimal]: SQL`Double`,
            [TableColumnType.Date]: SQL`DateTime`,
            [TableColumnType.JSON]: SQL`String`, // we use JSON as a string because ClickHouse has really good JSON support for string types
            [TableColumnType.JSONArray]: SQL`String`, // we use JSON as a string because ClickHouse has really good JSON support for string types
            [TableColumnType.NestedModel]: SQL`Nested`,
            [TableColumnType.ArrayNumber]: SQL`Array(Int32)`,
            [TableColumnType.ArrayText]: SQL`Array(String)`,
            [TableColumnType.LongNumber]: SQL`Int128`,
        }[type];
    }

    public toDoesColumnExistStatement(columnName: string): string {
        const statement: string = `SELECT name FROM system.columns WHERE table = '${
            this.model.tableName
        }' AND database = '${this.database.getDatasourceOptions()
            .database!}' AND name = '${columnName}'`;

        logger.debug(`${this.model.tableName} Does Column Exist Statement`);
        logger.debug(statement);

        return statement;
    }

    public toAddColumnStatement(column: AnalyticsTableColumn): Statement {
        const statement: Statement = SQL`
            ALTER TABLE ${this.database.getDatasourceOptions().database!}.${
            this.model.tableName
        }
            ADD COLUMN IF NOT EXISTS
        `.append(this.toColumnsCreateStatement([column], false));

        logger.debug(`${this.model.tableName} Add Column Statement`);
        logger.debug(statement);

        return statement;
    }

    public toDropColumnStatement(columnName: string): string {
        const statement: string = `
            ALTER TABLE ${this.database.getDatasourceOptions().database!}.${
            this.model.tableName
        } DROP COLUMN IF EXISTS ${columnName}`;

        logger.debug(`${this.model.tableName} Drop Column Statement`);
        logger.debug(statement);

        return statement;
    }

    public toTableCreateStatement(): Statement {
        const databaseName: string =
            this.database.getDatasourceOptions().database!;
        const columnsStatement: Statement = this.toColumnsCreateStatement(
            this.model.tableColumns
        );

        // special case - ClickHouse does not support using a query parameter
        // to specify the table engine
        const tableEngineStatement: string = this.model.tableEngine;

        /* eslint-disable prettier/prettier */
        const statement: Statement = SQL`
            CREATE TABLE IF NOT EXISTS ${databaseName}.${this.model.tableName}
            (\n`
            .append(columnsStatement).append(SQL`
            )
            ENGINE = `).append(tableEngineStatement).append(SQL`
            PRIMARY KEY (`);

        for (let i: number = 0; i < this.model.primaryKeys.length; i++) {
            const key: string = this.model.primaryKeys[i]!;
            if (i !== 0) {
                statement.append(SQL`, `);
            }
            statement.append(SQL`${key}`);
        }

        statement.append(SQL`)`);
        /* eslint-enable prettier/prettier */

        logger.debug(`${this.model.tableName} Table Create Statement`);
        logger.debug(statement);

        return statement;
    }
}
