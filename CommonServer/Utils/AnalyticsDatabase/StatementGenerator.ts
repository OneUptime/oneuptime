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

    public toUpdateStatement(updateBy: UpdateBy<TBaseModel>): string {
        const statement: string = `ALTER TABLE ${
            this.database.getDatasourceOptions().database
        }.${this.model.tableName} 
        UPDATE ${this.toSetStatement(updateBy.data)}
        ${
            Object.keys(updateBy.query).length > 0 ? 'WHERE' : 'WHERE 1=1'
        } ${this.toWhereStatement(updateBy.query)}
        `;

        logger.info(`${this.model.tableName} Update Statement`);
        logger.info(statement);

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

        logger.info(`${this.model.tableName} Create Statement`);
        logger.info(statement);

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
            value = `'${value?.toString()}'`;
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
                    return v;
                })
                .join(', ')}]`;
        }

        if (column.type === TableColumnType.ArrayText) {
            value = `[${(value as Array<string>)
                .map((v: string) => {
                    return `'${v}'`;
                })
                .join(', ')}]`;
        }

        if (column.type === TableColumnType.JSON) {
            value = `'${JSON.stringify(value)}'`;
        }

        return value;
    }

    public toSetStatement(data: TBaseModel): string {
        let setStatement: string = '';

        for (const column of data.getTableColumns()) {
            if (data.getColumnValue(column.key) !== undefined) {
                setStatement += `${column.key} = ${this.sanitizeValue(
                    data.getColumnValue(column.key),
                    column
                )}, `;
            }
        }

        setStatement = setStatement.substring(0, setStatement.length - 2); // remove last comma.

        return setStatement;
    }

    public toWhereStatement(query: Query<TBaseModel>): string {
        let whereStatement: string = '';

        for (const key in query) {
            const value: any = query[key];
            const tableColumn: AnalyticsTableColumn | null =
                this.model.getTableColumn(key);

            if (!tableColumn) {
                throw new BadDataException(`Unknown column: ${key}`);
            }

            whereStatement += `${key} = ${this.sanitizeValue(
                value,
                tableColumn
            )} AND`;
        }

        // remove last AND.
        whereStatement = whereStatement.substring(0, whereStatement.length - 4);

        return whereStatement;
    }

    public toSortStatemennt(sort: Sort<TBaseModel>): string {
        let sortStatement: string = '';

        for (const key in sort) {
            const value: any = sort[key];
            sortStatement += `${key} ${value}`;
        }

        return sortStatement;
    }

    public toSelectStatement(select: Select<TBaseModel>): {
        statement: string;
        columns: Array<string>;
    } {
        let selectStatement: string = '';
        const columns: Array<string> = [];

        for (const key in select) {
            const value: any = select[key];
            if (value) {
                columns.push(key);
                selectStatement += `${key}, `;
            }
        }

        selectStatement = selectStatement.substring(
            0,
            selectStatement.length - 2
        ); // remove last comma.

        return {
            columns: columns,
            statement: selectStatement,
        };
    }

    public toColumnsCreateStatement(
        tableColumns: Array<AnalyticsTableColumn>,
        isNestedModel: boolean = false
    ): string {
        let columns: string = '';

        tableColumns.forEach((column: AnalyticsTableColumn) => {
            let requiredText: string = `${
                column.required ? 'NOT NULL' : ' NULL'
            }`;

            let nestedModelColumns: string = '';

            if (column.type === TableColumnType.NestedModel) {
                nestedModelColumns = `(
                    ${this.toColumnsCreateStatement(
                        column.nestedModel!.tableColumns,
                        true
                    )}
                )`;

                requiredText = '';
            }

            if (isNestedModel) {
                requiredText = '';
            }

            if (
                column.type === TableColumnType.ArrayNumber ||
                column.type === TableColumnType.ArrayText
            ) {
                requiredText = '';
            }

            columns += `${column.key} ${this.toColumnType(
                column.type
            )} ${nestedModelColumns} ${requiredText},\n`;
        });

        return columns.substring(0, columns.length - 2); // remove last comma.
    }

    public toColumnType(type: TableColumnType): string {
        if (type === TableColumnType.Text) {
            return 'String';
        }

        if (type === TableColumnType.ObjectID) {
            return 'String';
        }

        if (type === TableColumnType.Boolean) {
            return 'Bool';
        }

        if (type === TableColumnType.Number) {
            return 'Int32';
        }

        if (type === TableColumnType.Decimal) {
            return 'Double';
        }

        if (type === TableColumnType.Date) {
            return 'DateTime';
        }

        if (type === TableColumnType.JSON) {
            return 'JSON';
        }

        if (type === TableColumnType.NestedModel) {
            return 'Nested';
        }

        if (type === TableColumnType.ArrayNumber) {
            return 'Array(Int32)';
        }

        if (type === TableColumnType.ArrayText) {
            return 'Array(String)';
        }

        if (type === TableColumnType.LongNumber) {
            return 'Int128';
        }

        throw new BadDataException('Unknown column type: ' + type);
    }

    public toTableCreateStatement(): string {
        const statement: string = `CREATE TABLE IF NOT EXISTS ${
            this.database.getDatasourceOptions().database
        }.${this.model.tableName} 
        ( 
            ${this.toColumnsCreateStatement(this.model.tableColumns)} 
        )
        ENGINE = ${this.model.tableEngine}
        PRIMARY KEY (
            ${this.model.primaryKeys
                .map((key: string) => {
                    return key;
                })
                .join(', ')}
        )
        `;

        logger.info(`${this.model.tableName} Table Create Statement`);
        logger.info(statement);

        return statement;
    }
}
