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
import {
    DatabaseTriggerType,
    OnCreate,
    OnDelete,
    OnFind,
    OnUpdate,
} from '../Types/AnalyticsDatabase/Hooks';
import Typeof from 'Common/Types/Typeof';
import ModelPermission from '../Types/AnalyticsDatabase/ModelPermission';
import ObjectID from 'Common/Types/ObjectID';
import Exception from 'Common/Types/Exception/Exception';
import API from 'Common/Utils/API';
import URL from 'Common/Types/API/URL';
import Protocol from 'Common/Types/API/Protocol';
import { WorkflowHostname } from '../EnvironmentConfig';
import Route from 'Common/Types/API/Route';
import { WorkflowRoute } from 'Common/ServiceRoute';
import Text from 'Common/Types/Text';
import ClusterKeyAuthorization from '../Middleware/ClusterKeyAuthorization';
import DeleteBy from '../Types/AnalyticsDatabase/DeleteBy';
import UpdateBy from '../Types/AnalyticsDatabase/UpdateBy';
import FindBy from '../Types/AnalyticsDatabase/FindBy';
import PositiveNumber from 'Common/Types/PositiveNumber';
import SortOrder from 'Common/Types/BaseDatabase/SortOrder';
import Query from '../Types/AnalyticsDatabase/Query';
import Select from '../Types/AnalyticsDatabase/Select';
import Sort from '../Types/AnalyticsDatabase/Sort';
import { ExecResult } from '@clickhouse/client';
import { Stream } from 'node:stream';
import StreamUtil from '../Utils/Stream';
import { JSONObject } from 'Common/Types/JSON';
import FindOneBy from '../Types/AnalyticsDatabase/FindOneBy';
import FindOneByID from '../Types/AnalyticsDatabase/FindOneByID';
import UpdateOneBy from '../Types/AnalyticsDatabase/UpdateOneBy';

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

    public async findBy(
        findBy: FindBy<TBaseModel>
    ): Promise<Array<TBaseModel>> {
        return await this._findBy(findBy);
    }

    private async _findBy(
        findBy: FindBy<TBaseModel>
    ): Promise<Array<TBaseModel>> {
        try {
            if (!findBy.sort || Object.keys(findBy.sort).length === 0) {
                findBy.sort = {
                    createdAt: SortOrder.Descending,
                };

                if (!findBy.select) {
                    findBy.select = {} as any;
                }
            }

            const onFind: OnFind<TBaseModel> = findBy.props.ignoreHooks
                ? { findBy, carryForward: [] }
                : await this.onBeforeFind(findBy);
            const onBeforeFind: FindBy<TBaseModel> = { ...onFind.findBy };
            const carryForward: any = onFind.carryForward;

            if (
                !onBeforeFind.select ||
                Object.keys(onBeforeFind.select).length === 0
            ) {
                onBeforeFind.select = {} as any;
            }

            if (!(onBeforeFind.select as any)['_id']) {
                (onBeforeFind.select as any)['_id'] = true;
            }

            const result: {
                query: Query<TBaseModel>;
                select: Select<TBaseModel> | null;
            } = await ModelPermission.checkReadPermission(
                this.modelType,
                onBeforeFind.query,
                onBeforeFind.select || null,
                onBeforeFind.props
            );

            onBeforeFind.query = result.query;
            onBeforeFind.select = result.select || undefined;

            if (!(onBeforeFind.skip instanceof PositiveNumber)) {
                onBeforeFind.skip = new PositiveNumber(onBeforeFind.skip);
            }

            if (!(onBeforeFind.limit instanceof PositiveNumber)) {
                onBeforeFind.limit = new PositiveNumber(onBeforeFind.limit);
            }

            const dbResult: ExecResult<Stream> = await this.execute(
                this.toFindStatement(onBeforeFind)
            );

            const jsonItems: Array<JSONObject> = await StreamUtil.toJSONArray(
                dbResult.stream
            );
            let items: Array<TBaseModel> =
                AnalyticsBaseModel.fromJSONArray<TBaseModel>(
                    this.modelType,
                    jsonItems
                );

            items = this.sanitizeFindByItems(items, onBeforeFind);

            if (!findBy.props.ignoreHooks) {
                items = await (
                    await this.onFindSuccess({ findBy, carryForward }, items)
                ).carryForward;
            }

            return items;
        } catch (error) {
            await this.onFindError(error as Exception);
            throw this.getException(error as Exception);
        }
    }

    private sanitizeFindByItems(
        items: Array<TBaseModel>,
        findBy: FindBy<TBaseModel>
    ): Array<TBaseModel> {
        // if there's no select then there's nothing to do.
        if (!findBy.select) {
            return items;
        }

        return items;
    }

    public toWhereStatement(query: Query<TBaseModel>): string {
        let whereStatement: string = '';

        for (const key in query) {
            const value: any = query[key];
            whereStatement += `${key} = ${value}`;
        }

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

    public toSelectStatement(select: Select<TBaseModel>): string {
        let selectStatement: string = '';

        for (const key in select) {
            const value: any = select[key];
            if (value) {
                selectStatement += `${key}, `;
            }
        }

        selectStatement = selectStatement.substring(
            0,
            selectStatement.length - 2
        ); // remove last comma.

        return selectStatement;
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

    protected async onBeforeDelete(
        deleteBy: DeleteBy<TBaseModel>
    ): Promise<OnDelete<TBaseModel>> {
        // A place holder method used for overriding.
        return Promise.resolve({ deleteBy, carryForward: null });
    }

    protected async onBeforeUpdate(
        updateBy: UpdateBy<TBaseModel>
    ): Promise<OnUpdate<TBaseModel>> {
        // A place holder method used for overriding.
        return Promise.resolve({ updateBy, carryForward: null });
    }

    protected async onBeforeFind(
        findBy: FindBy<TBaseModel>
    ): Promise<OnFind<TBaseModel>> {
        // A place holder method used for overriding.
        return Promise.resolve({ findBy, carryForward: null });
    }

    public toFindStatement(findBy: FindBy<TBaseModel>): string {
        if (!this.database) {
            this.useDefaultDatabase();
        }

        const statement: string = `SELECT ${this.toSelectStatement(
            findBy.select!
        )} FROM ${this.database.getDatasourceOptions().database}.${
            this.model.tableName
        } 
        WHERE ${this.toWhereStatement(findBy.query)}
        ORDER BY ${this.toSortStatemennt(findBy.sort!)}
        LIMIT ${findBy.limit}
        OFFSET ${findBy.skip}
        `;

        logger.info(`${this.model.tableName} Find Statement`);
        logger.info(statement);

        return statement;
    }

    public toUpdateStatement(updateBy: UpdateBy<TBaseModel>): string {
        if (!this.database) {
            this.useDefaultDatabase();
        }

        const statement: string = `UPDATE ${
            this.database.getDatasourceOptions().database
        }.${this.model.tableName} 
        SET ${this.toSetStatement(updateBy.data)}
        WHERE ${this.toWhereStatement(updateBy.query)}
        `;

        logger.info(`${this.model.tableName} Update Statement`);
        logger.info(statement);

        return statement;
    }

    public toSetStatement(data: TBaseModel): string {
        let setStatement: string = '';

        for (const column of data.getTableColumns()) {
            if (data.getColumnValue(column.key) !== undefined) {
                setStatement += `${column.key} = ${data.getColumnValue(
                    column.key
                )}, `;
            }
        }

        setStatement = setStatement.substring(0, setStatement.length - 2); // remove last comma.

        return setStatement;
    }

    public toCreateStatement(data: { item: TBaseModel }): string {
        if (!data.item) {
            throw new BadDataException('Item cannot be null');
        }

        const columnNames: Array<string> = [];
        const values: Array<string> = [];

        for (const column of data.item.getTableColumns()) {
            columnNames.push(column.key);
            values.push(data.item.getColumnValue(column.key) as string);
        }

        const statement: string = `INSERT INTO ${
            this.database.getDatasourceOptions().database
        }.${this.model.tableName} 
        ( 
            ${columnNames.join(', ')}
        )
        VALUES
        (
            ${values.join(', ')}
        )
        `;

        logger.info(`${this.model.tableName} Create Statement`);
        logger.info(statement);

        return statement;
    }

    public async findOneBy(
        findOneBy: FindOneBy<TBaseModel>
    ): Promise<TBaseModel | null> {
        const findBy: FindBy<TBaseModel> = findOneBy as FindBy<TBaseModel>;
        findBy.limit = new PositiveNumber(1);
        findBy.skip = new PositiveNumber(0);

        const documents: Array<TBaseModel> = await this._findBy(findBy);

        if (documents && documents[0]) {
            return documents[0];
        }
        return null;
    }

    public async findOneById(
        findOneById: FindOneByID<TBaseModel>
    ): Promise<TBaseModel | null> {
        if (!findOneById.id) {
            throw new BadDataException('findOneById.id is required');
        }

        return await this.findOneBy({
            query: {
                _id: findOneById.id,
            },
            select: findOneById.select || {},
            props: findOneById.props,
        });
    }

    public async updateOneBy(
        updateOneBy: UpdateOneBy<TBaseModel>
    ): Promise<void> {
        await this._updateBy({ ...updateOneBy, limit: 1, skip: 0 });
    }

    public async updateBy(updateBy: UpdateBy<TBaseModel>): Promise<void> {
        await this._updateBy(updateBy);
    }

    private async _updateBy(updateBy: UpdateBy<TBaseModel>): Promise<void> {
        try {
            const onUpdate: OnUpdate<TBaseModel> = updateBy.props.ignoreHooks
                ? { updateBy, carryForward: [] }
                : await this.onBeforeUpdate(updateBy);

            const beforeUpdateBy: UpdateBy<TBaseModel> = onUpdate.updateBy;

            beforeUpdateBy.query = await ModelPermission.checkUpdatePermissions(
                this.modelType,
                beforeUpdateBy.query,
                beforeUpdateBy.data,
                beforeUpdateBy.props
            );


            if (!(updateBy.skip instanceof PositiveNumber)) {
                beforeUpdateBy.skip = new PositiveNumber(updateBy.skip);
            }

            if (!(updateBy.limit instanceof PositiveNumber)) {
                beforeUpdateBy.limit = new PositiveNumber(updateBy.limit);
            }

            const select: Select<TBaseModel> = {};

            const tenantColumnName: string | null =
                this.getModel().getTenantColumn()?.key || null;

            if (tenantColumnName) {
                (select as any)[tenantColumnName] =
                    true;
            }

            await this.execute(
                this.toUpdateStatement(beforeUpdateBy)
            );

        } catch (error) {
            await this.onUpdateError(error as Exception);
            throw this.getException(error as Exception);
        }
    }

    protected generateDefaultValues(data: TBaseModel): TBaseModel {
        const tableColumns: Array<AnalyticsTableColumn> =
            data.getTableColumns();

        for (const column of tableColumns) {
            if (column.forceGetDefaultValueOnCreate) {
                data.setColumnValue(
                    column.key,
                    column.forceGetDefaultValueOnCreate()
                );
            }
        }

        return data;
    }

    public useDefaultDatabase(): void {
        this.database = ClickhouseAppInstance;
        this.databaseClient = this.database.getDataSource() as ClickhouseClient;
    }

    public async execute(query: string): Promise<ExecResult<Stream>> {
        if (!this.databaseClient) {
            this.useDefaultDatabase();
        }

        return await this.databaseClient.exec({
            query: query,
        });
    }

    protected async onUpdateSuccess(
        onUpdate: OnUpdate<TBaseModel>,
        _updatedItemIds: Array<ObjectID>
    ): Promise<OnUpdate<TBaseModel>> {
        // A place holder method used for overriding.
        return Promise.resolve(onUpdate);
    }

    protected async onUpdateError(error: Exception): Promise<Exception> {
        // A place holder method used for overriding.
        return Promise.resolve(error);
    }

    protected async onDeleteSuccess(
        onDelete: OnDelete<TBaseModel>,
        _itemIdsBeforeDelete: Array<ObjectID>
    ): Promise<OnDelete<TBaseModel>> {
        // A place holder method used for overriding.
        return Promise.resolve(onDelete);
    }

    protected async onDeleteError(error: Exception): Promise<Exception> {
        // A place holder method used for overriding.
        return Promise.resolve(error);
    }

    protected async onFindSuccess(
        onFind: OnFind<TBaseModel>,
        items: Array<TBaseModel>
    ): Promise<OnFind<TBaseModel>> {
        // A place holder method used for overriding.
        return Promise.resolve({ ...onFind, carryForward: items });
    }

    protected async onFindError(error: Exception): Promise<Exception> {
        // A place holder method used for overriding.
        return Promise.resolve(error);
    }

    protected async onCountSuccess(
        count: PositiveNumber
    ): Promise<PositiveNumber> {
        // A place holder method used for overriding.
        return Promise.resolve(count);
    }

    protected async onCountError(error: Exception): Promise<Exception> {
        // A place holder method used for overriding.
        return Promise.resolve(error);
    }

    protected async onCreateSuccess(
        _onCreate: OnCreate<TBaseModel>,
        createdItem: TBaseModel
    ): Promise<TBaseModel> {
        // A place holder method used for overriding.
        return Promise.resolve(createdItem);
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
        const projectIdColumn: string | null =
            this.model.getTenantColumn()?.key || null;

        if (projectIdColumn && createBy.props.tenantId) {
            (createBy.data as any)[projectIdColumn] = createBy.props.tenantId;
        }

        return await this.onBeforeCreate(createBy);
    }

    public async create(createBy: CreateBy<TBaseModel>): Promise<void> {
        const onCreate: OnCreate<TBaseModel> = createBy.props.ignoreHooks
            ? { createBy, carryForward: [] }
            : await this._onBeforeCreate(createBy);

        const _createdBy: CreateBy<TBaseModel> = onCreate.createBy;

        const carryForward: any = onCreate.carryForward;

        let data: TBaseModel = _createdBy.data;

        // add tenantId if present.
        const tenantColumnName: string | null =
            data.getTenantColumn()?.key || null;

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
            this.modelType,
            data,
            _createdBy.props
        );

        createBy.data = data;

        try {
            await this.execute(this.toCreateStatement({ item: createBy.data }));

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
                    tenantId = createBy.data.getColumnValue<ObjectID>(
                        this.getModel().getTenantColumn()!.key
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
        } catch (error) {
            await this.onCreateError(error as Exception);
            throw this.getException(error as Exception);
        }
    }

    protected async getException(error: Exception): Promise<void> {
        throw error;
    }

    protected async onCreateError(error: Exception): Promise<Exception> {
        // A place holder method used for overriding.
        return Promise.resolve(error);
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

    public async onTrigger(
        id: ObjectID,
        projectId: ObjectID,
        triggerType: DatabaseTriggerType
    ): Promise<void> {
        if (this.getModel().enableWorkflowOn) {
            API.post(
                new URL(
                    Protocol.HTTP,
                    WorkflowHostname,
                    new Route(
                        `${WorkflowRoute.toString()}/analytics-model/${projectId.toString()}/${Text.pascalCaseToDashes(
                            this.getModel().tableName!
                        )}/${triggerType}`
                    )
                ),
                {
                    data: {
                        _id: id.toString(),
                    },
                },
                {
                    ...ClusterKeyAuthorization.getClusterKeyHeaders(),
                }
            ).catch((error: Error) => {
                logger.error(error);
            });
        }
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

    public getModel(): TBaseModel {
        return this.model;
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
