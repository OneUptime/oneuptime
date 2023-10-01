import TableColumnType from 'Common/Types/BaseDatabase/TableColumnType';
import ClickhouseDatabase, {
    ClickhouseAppInstance,
    ClickhouseClient,
} from '../Infrastructure/ClickhouseDatabase';
import BaseService from './BaseService';
import AnalyticsBaseModel from 'Common/AnalyticsModels/BaseModel';
import BadDataException from 'Common/Types/Exception/BadDataException';
import logger from '../Utils/Logger';
import AnalyticsTableColumn from 'Common/Types/AnalyticsDatabase/TableColumn';
import CreateBy from '../Types/AnalyticsDatabase/CreateBy';
import { OnCreate } from '../Types/AnalyticsDatabase/Hooks';
import Typeof from 'Common/Types/Typeof';
import ModelPermission from '../Utils/ModelPermission';

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

    protected generateDefaultValues(data: TBaseModel): TBaseModel {
        const tableColumns: Array<AnalyticsTableColumn> = data.getTableColumns();

        for (const column of tableColumns) {
           
            if (column.forceGetDefaultValueOnCreate) {
                data.setColumnValue(column.key, column.forceGetDefaultValueOnCreate());
            }
        }

        return data;
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

    protected async onBeforeCreate(
        createBy: CreateBy<TBaseModel>
    ): Promise<OnCreate<TBaseModel>> {
        // A place holder method used for overriding.
        return Promise.resolve({
            createBy: createBy as CreateBy<TBaseModel>,
            carryForward: undefined,
        });
    }

    private async _onBeforeCreate(
        createBy: CreateBy<TBaseModel>
    ): Promise<OnCreate<TBaseModel>> {
        // Private method that runs before create.
        const projectIdColumn: string | null = this.model.getTenantColumn()?.key || null;

        if (projectIdColumn && createBy.props.tenantId) {
            (createBy.data as any)[projectIdColumn] = createBy.props.tenantId;
        }

        return await this.onBeforeCreate(createBy);
    }

    public async create(createBy: CreateBy<TBaseModel>): Promise<TBaseModel> {

        const onCreate: OnCreate<TBaseModel> = createBy.props.ignoreHooks
            ? { createBy, carryForward: [] }
            : await this._onBeforeCreate(createBy);

        let _createdBy: CreateBy<TBaseModel> = onCreate.createBy;

        const carryForward: any = onCreate.carryForward;

        let data: TBaseModel = _createdBy.data;

        // add tenantId if present.
        const tenantColumnName: string | null = data.getTenantColumn()?.key || null;

        if (tenantColumnName && _createdBy.props.tenantId) {
            data.setColumnValue(tenantColumnName, _createdBy.props.tenantId);
        }

        data = this.generateDefaultValues(data);
        data = this.checkRequiredFields(data);

        if (!this.isValid(data)) {
            throw new BadDataException('Data is not valid');
        }

        // check total items by

        ModelPermission.checkCreatePermissions(
            this.entityType,
            data,
            _createdBy.props
        );

        createBy.data = data;

        // check uniqueColumns by:
        createBy = await this.checkUniqueColumnBy(createBy);

        // serialize.
        createBy.data = (await this.sanitizeCreateOrUpdate(
            createBy.data,
            createBy.props
        )) as TBaseModel;

        try {
            createBy.data = await this.getRepository().save(createBy.data);

            if (!createBy.props.ignoreHooks) {
                createBy.data = await this.onCreateSuccess(
                    {
                        createBy,
                        carryForward,
                    },
                    createBy.data
                );
            }

            // hit workflow.;
            if (this.getModel().enableWorkflowOn?.create) {
                let tenantId: ObjectID | undefined = createBy.props.tenantId;

                if (!tenantId && this.getModel().getTenantColumn()) {
                    tenantId = createBy.data.getValue<ObjectID>(
                        this.getModel().getTenantColumn()!
                    );
                }

                if (tenantId) {
                    await this.onTrigger(
                        createBy.data.id!,
                        tenantId,
                        'on-create'
                    );
                }
            }

            return createBy.data;
        } catch (error) {
            await this.onCreateError(error as Exception);
            throw this.getException(error as Exception);
        }
    }

    protected isValid(data: TBaseModel): boolean {
        if (!data) {
            throw new BadDataException('Data cannot be null');
        }

        return true;
    }

    public toColumnsCreateStatement(): string {
        let columns: string = '';

        this.model.tableColumns.forEach((column: AnalyticsTableColumn) => {
            columns += `${column.key} ${this.toColumnType(column.type)} ${
                column.required ? 'NOT NULL' : ' NULL'
            },\n`;
        });

        return columns;
    }

    protected checkRequiredFields(data: TBaseModel): TBaseModel {
        // Check required fields.

        for (const columns of data.getRequiredColumns()) {
            const requiredField: string = columns.key;
            if (typeof (data as any)[requiredField] === Typeof.Boolean) {
                if (
                    !(data as any)[requiredField] &&
                    (data as any)[requiredField] !== false &&
                    !data.isDefaultValueColumn(requiredField)
                ) {
                    throw new BadDataException(`${requiredField} is required`);
                }
            } else if (
                !(data as any)[requiredField] &&
                !data.isDefaultValueColumn(requiredField)
            ) {
                throw new BadDataException(`${requiredField} is required`);
            }
        }

        return data;
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
