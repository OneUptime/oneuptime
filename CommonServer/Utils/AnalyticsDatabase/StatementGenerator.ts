import AnalyticsBaseModel from "Common/AnalyticsModels/BaseModel";
import BadDataException from "Common/Types/Exception/BadDataException";
import Query from "../../Types/AnalyticsDatabase/Query";
import AnalyticsTableColumn from "Common/Types/AnalyticsDatabase/TableColumn";
import ClickhouseDatabase from "../../Infrastructure/ClickhouseDatabase";
import Sort from "../../Types/AnalyticsDatabase/Sort";
import Select from "../../Types/AnalyticsDatabase/Select";
import TableColumnType from "Common/Types/AnalyticsDatabase/TableColumnType";
import logger from "../Logger";
import UpdateBy from "../../Types/AnalyticsDatabase/UpdateBy";
import { JSONValue } from "Common/Types/JSON";
import OneUptimeDate from "Common/Types/Date";

export default class StatementGenerator<TBaseModel extends AnalyticsBaseModel> {

    public model!: TBaseModel;
    public modelType!: { new(): TBaseModel };
    public database!: ClickhouseDatabase;

    public constructor(data: {
        modelType: { new(): TBaseModel };
        database: ClickhouseDatabase;
    }) {

        this.modelType = data.modelType;
        this.model = new this.modelType();
        this.database = data.database;
    }

    public toUpdateStatement(updateBy: UpdateBy<TBaseModel>): string {


        const statement: string = `ALTER TABLE ${this.database.getDatasourceOptions().database
            }.${this.model.tableName} 
        UPDATE ${this.toSetStatement(updateBy.data)}
        ${Object.keys(updateBy.query).length > 0 ? 'WHERE' : 'WHERE 1=1'
            } ${this.toWhereStatement(updateBy.query)}
        `;

        logger.info(`${this.model.tableName} Update Statement`);
        logger.info(statement);

        return statement;
    }

    public toCreateStatement(data: { item: Array<TBaseModel> }): string {

        type Record = Array<string | number | boolean | Date>
        type RecordValue = string | number | boolean | Date;

        if (!data.item) {
            throw new BadDataException('Item cannot be null');
        }

        const columnNames: Array<string> = [];

        const records: Array<Record> = [];

        for (const column of this.model.getTableColumns()) {
            columnNames.push(column.key);
        }


        for (const item of data.item) {

            const record: Record = [];

            for (const column of this.model.getTableColumns()) {
                const value: JSONValue = this.sanitizeValue(
                    item.getColumnValue(column.key),
                    column
                );

                record.push(value as RecordValue);
            }

            records.push(record);
        }

        const getValuesStatement = (records: Array<Record>): string => {
            let statement = '';
            for (const record of records) {
                statement += `(${record.join(', ')}), `;
            }

            statement = statement.substring(0, statement.length - 2); // remove last comma.

            return statement;
        }


        const statement: string = `INSERT INTO ${this.database.getDatasourceOptions().database
            }.${this.model.tableName} 
        ( 
            ${columnNames.join(', ')}
        )
        VALUES
        ${getValuesStatement(records)}
        `;

        logger.info(`${this.model.tableName} Create Statement`);
        logger.info(statement);

        return statement;
    }

    private sanitizeValue(
        value: JSONValue,
        column: AnalyticsTableColumn
    ): JSONValue {
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
            let requiredText: string = `${column.required ? 'NOT NULL' : ' NULL'
                }`;

            let nestedModelColumns: string = '';

            if (column.type === TableColumnType.NestedModel) {
                nestedModelColumns = `(
                    ${this.toColumnsCreateStatement(
                    column.nestedModel!.tableColumns, true
                )}
                )`;

                requiredText = '';
            }

            if (isNestedModel) {
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

        if (type === TableColumnType.NestedModel) {
            return 'Nested';
        }

        throw new BadDataException('Unknown column type: ' + type);
    }

    public toTableCreateStatement(): string {


        const statement: string = `CREATE TABLE IF NOT EXISTS ${this.database.getDatasourceOptions().database
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

        debugger;

        return statement;
    }
}