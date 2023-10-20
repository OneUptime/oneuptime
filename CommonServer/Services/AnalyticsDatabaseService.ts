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
import { ExecResult } from '@clickhouse/client';
import { Stream } from 'node:stream';
import StreamUtil from '../Utils/Stream';
import { JSONObject } from 'Common/Types/JSON';
import FindOneBy from '../Types/AnalyticsDatabase/FindOneBy';
import FindOneByID from '../Types/AnalyticsDatabase/FindOneByID';
import OneUptimeDate from 'Common/Types/Date';
import CreateManyBy from '../Types/AnalyticsDatabase/CreateManyBy';
import StatementGenerator from '../Utils/AnalyticsDatabase/StatementGenerator';

export default class AnalyticsDatabaseService<
    TBaseModel extends AnalyticsBaseModel
> extends BaseService {
    public modelType!: { new (): TBaseModel };
    public database!: ClickhouseDatabase;
    public model!: TBaseModel;
    public databaseClient!: ClickhouseClient;
    public statementGenerator!: StatementGenerator<TBaseModel>;

    public constructor(data: {
        modelType: { new (): TBaseModel };
        database?: ClickhouseDatabase | undefined;
    }) {
        super();
        this.modelType = data.modelType;
        this.model = new this.modelType();
        if (data.database) {
            this.database = data.database; // used for testing.
        } else {
            this.database = ClickhouseAppInstance; // default database
        }

        this.databaseClient = this.database.getDataSource() as ClickhouseClient;

        this.statementGenerator = new StatementGenerator<TBaseModel>({
            modelType: this.modelType,
            database: this.database,
        });
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

            const findStatement: { statement: string; columns: Array<string> } =
                this.toFindStatement(onBeforeFind);

            const dbResult: ExecResult<Stream> = await this.execute(
                findStatement.statement
            );

            const strResult: string = await StreamUtil.convertStreamToText(
                dbResult.stream
            );

            const jsonItems: Array<JSONObject> =
                this.convertSelectReturnedDataToJson(
                    strResult,
                    findStatement.columns
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

    private convertSelectReturnedDataToJson(
        strResult: string,
        columns: string[]
    ): JSONObject[] {
        const jsonItems: Array<JSONObject> = [];

        const rows: Array<string> = strResult.split('\n');

        for (const row of rows) {
            if (!row) {
                continue;
            }

            const jsonItem: JSONObject = {};
            const values: Array<string> = row.split('\t');

            for (let i: number = 0; i < columns.length; i++) {
                jsonItem[columns[i]!] = values[i];
            }

            jsonItems.push(jsonItem);
        }

        return jsonItems;
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

    public toFindStatement(findBy: FindBy<TBaseModel>): {
        statement: string;
        columns: Array<string>;
    } {
        if (!this.database) {
            this.useDefaultDatabase();
        }

        const select: { statement: string; columns: Array<string> } =
            this.statementGenerator.toSelectStatement(findBy.select!);

        const statement: string = `SELECT ${select.statement} FROM ${
            this.database.getDatasourceOptions().database
        }.${this.model.tableName} 
        ${
            Object.keys(findBy.query).length > 0 ? 'WHERE' : ''
        } ${this.statementGenerator.toWhereStatement(findBy.query)}
        ORDER BY ${this.statementGenerator.toSortStatemennt(findBy.sort!)}
        LIMIT ${findBy.limit}
        OFFSET ${findBy.skip}
        `;

        logger.info(`${this.model.tableName} Find Statement`);
        logger.info(statement);

        return { statement, columns: select.columns };
    }

    public toDeleteStatement(deleteBy: DeleteBy<TBaseModel>): string {
        if (!this.database) {
            this.useDefaultDatabase();
        }

        const statement: string = `ALTER TABLE ${
            this.database.getDatasourceOptions().database
        }.${this.model.tableName} 
            DELETE ${
                Object.keys(deleteBy.query).length > 0 ? 'WHERE' : 'WHERE 1=1'
            } ${this.statementGenerator.toWhereStatement(deleteBy.query)}
        `;

        logger.info(`${this.model.tableName} Delete Statement`);
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

    public async deleteBy(deleteBy: DeleteBy<TBaseModel>): Promise<void> {
        return await this._deleteBy(deleteBy);
    }

    private async _deleteBy(deleteBy: DeleteBy<TBaseModel>): Promise<void> {
        try {
            const onDelete: OnDelete<TBaseModel> = deleteBy.props.ignoreHooks
                ? { deleteBy, carryForward: [] }
                : await this.onBeforeDelete(deleteBy);

            const beforeDeleteBy: DeleteBy<TBaseModel> = onDelete.deleteBy;

            beforeDeleteBy.query = await ModelPermission.checkDeletePermission(
                this.modelType,
                beforeDeleteBy.query,
                deleteBy.props
            );

            const select: Select<TBaseModel> = {};

            const tenantColumnName: string | null =
                this.getModel().getTenantColumn()?.key || null;

            if (tenantColumnName) {
                (select as any)[tenantColumnName] = true;
            }

            await this.execute(this.toDeleteStatement(beforeDeleteBy));
        } catch (error) {
            await this.onDeleteError(error as Exception);
            throw this.getException(error as Exception);
        }
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

            const select: Select<TBaseModel> = {};

            const tenantColumnName: string | null =
                this.getModel().getTenantColumn()?.key || null;

            if (tenantColumnName) {
                (select as any)[tenantColumnName] = true;
            }

            await this.execute(
                this.statementGenerator.toUpdateStatement(beforeUpdateBy)
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

    public async createMany(
        createBy: CreateManyBy<TBaseModel>
    ): Promise<Array<TBaseModel>> {
        // add tenantId if present.
        const tenantColumnName: string | null =
            this.model.getTenantColumn()?.key || null;

        const items: Array<TBaseModel> = [];
        const carryForwards: Array<any> = [];

        for (const item of createBy.items) {
            let data: TBaseModel = item;

            const onCreate: OnCreate<TBaseModel> = createBy.props.ignoreHooks
                ? {
                      createBy: {
                          data: data,
                          props: createBy.props,
                      },
                      carryForward: [],
                  }
                : await this._onBeforeCreate({
                      data: data,
                      props: createBy.props,
                  });

            data = onCreate.createBy.data;

            const carryForward: any = onCreate.carryForward;

            carryForwards.push(carryForward);

            if (tenantColumnName && createBy.props.tenantId) {
                data.setColumnValue(tenantColumnName, createBy.props.tenantId);
            }

            data = this.sanitizeCreate(data);
            data = this.generateDefaultValues(data);
            data = this.checkRequiredFields(data);

            if (!this.isValid(data)) {
                throw new BadDataException('Data is not valid');
            }

            // check total items by

            ModelPermission.checkCreatePermissions(
                this.modelType,
                data,
                createBy.props
            );

            items.push(data);
        }

        try {
            const insertStatement: string =
                this.statementGenerator.toCreateStatement({ item: items });

            await this.execute(insertStatement);

            if (!createBy.props.ignoreHooks) {
                for (let i: number = 0; i < items.length; i++) {
                    if (!items[i]) {
                        continue;
                    }

                    items[i] = await this.onCreateSuccess(
                        {
                            createBy: {
                                data: items[i]!,
                                props: createBy.props,
                            },
                            carryForward: carryForwards[i],
                        },
                        items[i]!
                    );
                }
            }

            // hit workflow.;
            if (this.getModel().enableWorkflowOn?.create) {
                let tenantId: ObjectID | undefined = createBy.props.tenantId;

                for (const item of items) {
                    if (!tenantId && this.getModel().getTenantColumn()) {
                        tenantId = item.getColumnValue<ObjectID>(
                            this.getModel().getTenantColumn()!.key
                        );
                    }

                    if (tenantId) {
                        await this.onTrigger(item.id!, tenantId, 'on-create');
                    }
                }
            }

            return createBy.items;
        } catch (error) {
            await this.onCreateError(error as Exception);
            throw this.getException(error as Exception);
        }
    }

    public async create(createBy: CreateBy<TBaseModel>): Promise<TBaseModel> {
        const items: Array<TBaseModel> = await this.createMany({
            props: createBy.props,
            items: [createBy.data],
        });

        const item: TBaseModel | undefined = items[0];

        if (!item) {
            throw new BadDataException('Item not created');
        }

        return item;
    }

    private sanitizeCreate<TBaseModel extends AnalyticsBaseModel>(
        data: TBaseModel
    ): TBaseModel {
        if (!data.id) {
            data.id = ObjectID.generate();
        }

        data.createdAt = OneUptimeDate.getCurrentDate();
        data.updatedAt = OneUptimeDate.getCurrentDate();

        return data;
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
}
