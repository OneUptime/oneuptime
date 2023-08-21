import TableColumnType from "Common/Types/BaseDatabase/TableColumnType";
import ClickhouseDatabase, { ClickhouseAppInstance, ClickhouseClient } from "../Infrastructure/ClickhouseDatabase";
import BaseService from "./BaseService";
import AnalyticsBaseModel from "Common/Models/AnalyticsBaseModel";
import BadDataException from "Common/Types/Exception/BadDataException";

export default class AnalyticsDatabaseService<TBaseModel extends AnalyticsBaseModel> extends BaseService {

    public modelType!: { new(): TBaseModel };
    public database!: ClickhouseDatabase;
    public model!: TBaseModel;
    public databaseClient!: ClickhouseClient;

    public constructor(data: {
        modelType: { new(): TBaseModel },
        database?: ClickhouseDatabase | undefined;
    }) {
        super();
        this.modelType = data.modelType;
        this.model = new this.modelType();
        if (data.database) {
            this.database = data.database;
            this.databaseClient = this.database.getDataSource() as ClickhouseClient;
        }
    }

    public toTableCreateStatement(): string {
        return `CREATE TABLE ${this.model.tableName} IF NOT EXISTS
        ( 
            ${this.toColumnsCreateStatement()} 
        )
        ENGINE = ${this.model.tableEngine}
        PRIMARY KEY (${this.model.primaryKeys.map((key) => key).join(', ')}
        `
    }

    public useDefaultDatabase(): void {
        this.database = ClickhouseAppInstance;
        this.databaseClient = this.database.getDataSource() as ClickhouseClient;
    }

    public async execute(query: string): Promise<void> {

        if(!this.databaseClient){
            this.useDefaultDatabase();
        }

        await this.databaseClient.exec({
            query: query,
        })
    }


    public toColumnsCreateStatement(): string {
        let columns: string = '';

        this.model.tableColumns.forEach((column) => {
            columns += `${column.key} ${this.toColumnType(column.type)} ${column.required ? 'NOT NULL' : ' NULL'},\n`;
        });

        return columns;
    }

    public toColumnType(type: TableColumnType): string {
        if (type === TableColumnType.ShortText) {
            return 'String';
        }

        if (type === TableColumnType.LongText) {
            return 'String';
        }

        if (type === TableColumnType.VeryLongText) {
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


        if (type === TableColumnType.BigNumber) {
            return 'Int64';
        }

        if (type === TableColumnType.Date) {
            return 'DateTime';
        }

        if (type === TableColumnType.Array) {
            return 'Array';
        }

        throw new BadDataException("Unknown column type: " + type);
    }
}
