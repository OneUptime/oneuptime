import TableColumnType from 'Common/Types/BaseDatabase/TableColumnType';
import ClickhouseDatabase, {
    ClickhouseAppInstance,
    ClickhouseClient,
} from '../Infrastructure/ClickhouseDatabase';
import BaseService from './BaseService';
import AnalyticsBaseModel from 'Common/Models/AnalyticsBaseModel';
import BadDataException from 'Common/Types/Exception/BadDataException';
import logger from '../Utils/Logger';
import AnalyticsTableColumn from 'Common/Types/AnalyticsDatabase/TableColumn';
// import CreateBy from "../Types/AnalyticsDatabase/CreateBy";

export default class AnalyticsDatabaseService<
    TBaseModel extends AnalyticsBaseModel
> extends BaseService {
    public modelType!: { new (): TBaseModel };
    public database!: ClickhouseDatabase;
    public model!: TBaseModel;
    public databaseClient!: ClickhouseClient;

    public constructor(data: {
        modelType: { new (): TBaseModel };
        database?: ClickhouseDatabase | undefined;
    }) {
        super();
        this.modelType = data.modelType;
        this.model = new this.modelType();
        if (data.database) {
            this.database = data.database;
            this.databaseClient =
                this.database.getDataSource() as ClickhouseClient;
        }
    }

    public toTableCreateStatement(): string {
        if (!this.database) {
            this.useDefaultDatabase();
        }

        const statement: string = `CREATE TABLE IF NOT EXISTS ${
            this.database.getDatasourceOptions().database
        }.${this.model.tableName} 
        ( 
            ${this.toColumnsCreateStatement()} 
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

    public useDefaultDatabase(): void {
        this.database = ClickhouseAppInstance;
        this.databaseClient = this.database.getDataSource() as ClickhouseClient;
    }

    public async execute(query: string): Promise<void> {
        if (!this.databaseClient) {
            this.useDefaultDatabase();
        }

        await this.databaseClient.exec({
            query: query,
        });
    }

    // public async create(createBy: CreateBy<TBaseModel>): Promise<TBaseModel> {

    //     const onCreate: OnCreate<TBaseModel> = createBy.props.ignoreHooks
    //         ? { createBy, carryForward: [] }
    //         : await this._onBeforeCreate(createBy);

    //     let _createdBy: CreateBy<TBaseModel> = onCreate.createBy;

    //     const carryForward: any = onCreate.carryForward;

    //     _createdBy = this.generateSlug(_createdBy);

    //     let data: TBaseModel = _createdBy.data;

    //     // add tenantId if present.
    //     const tenantColumnName: string | null = data.getTenantColumn();

    //     if (tenantColumnName && _createdBy.props.tenantId) {
    //         data.setColumnValue(tenantColumnName, _createdBy.props.tenantId);
    //     }

    //     data = this.generateDefaultValues(data);
    //     data = this.checkRequiredFields(data);

    //     if (!this.isValid(data)) {
    //         throw new BadDataException('Data is not valid');
    //     }

    //     // check total items by.

    //     await this.checkTotalItemsBy(_createdBy);

    //     // Encrypt data
    //     data = this.encrypt(data);

    //     // hash data
    //     data = await this.hash(data);

    //     ModelPermission.checkCreatePermissions(
    //         this.entityType,
    //         data,
    //         _createdBy.props
    //     );

    //     createBy.data = data;

    //     // check uniqueColumns by:
    //     createBy = await this.checkUniqueColumnBy(createBy);

    //     // serialize.
    //     createBy.data = (await this.sanitizeCreateOrUpdate(
    //         createBy.data,
    //         createBy.props
    //     )) as TBaseModel;

    //     try {
    //         createBy.data = await this.getRepository().save(createBy.data);

    //         if (!createBy.props.ignoreHooks) {
    //             createBy.data = await this.onCreateSuccess(
    //                 {
    //                     createBy,
    //                     carryForward,
    //                 },
    //                 createBy.data
    //             );
    //         }

    //         // hit workflow.;
    //         if (this.getModel().enableWorkflowOn?.create) {
    //             let tenantId: ObjectID | undefined = createBy.props.tenantId;

    //             if (!tenantId && this.getModel().getTenantColumn()) {
    //                 tenantId = createBy.data.getValue<ObjectID>(
    //                     this.getModel().getTenantColumn()!
    //                 );
    //             }

    //             if (tenantId) {
    //                 await this.onTrigger(
    //                     createBy.data.id!,
    //                     tenantId,
    //                     'on-create'
    //                 );
    //             }
    //         }

    //         return createBy.data;
    //     } catch (error) {
    //         await this.onCreateError(error as Exception);
    //         throw this.getException(error as Exception);
    //     }
    // }

    public toColumnsCreateStatement(): string {
        let columns: string = '';

        this.model.tableColumns.forEach((column: AnalyticsTableColumn) => {
            columns += `${column.key} ${this.toColumnType(column.type)} ${
                column.required ? 'NOT NULL' : ' NULL'
            },\n`;
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

        throw new BadDataException('Unknown column type: ' + type);
    }
}
