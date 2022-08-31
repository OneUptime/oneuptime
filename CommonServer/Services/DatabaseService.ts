import Slug from 'Common/Utils/Slug';
import FindOneBy from '../Types/Database/FindOneBy';
import UpdateOneBy from '../Types/Database/UpdateOneBy';
import CountBy from '../Types/Database/CountBy';
import DeleteOneBy from '../Types/Database/DeleteOneBy';
import SearchBy from '../Types/Database/SearchBy';
import DeleteBy from '../Types/Database/DeleteBy';
import PositiveNumber from 'Common/Types/PositiveNumber';
import FindBy from '../Types/Database/FindBy';
import UpdateBy from '../Types/Database/UpdateBy';
import Query from '../Types/Database/Query';
import CreateBy from '../Types/Database/CreateBy';
import BadDataException from 'Common/Types/Exception/BadDataException';
import DatabaseNotConnectedException from 'Common/Types/Exception/DatabaseNotConnectedException';
import Exception from 'Common/Types/Exception/Exception';
import SearchResult from '../Types/Database/SearchResult';
import Encryption from '../Utils/Encryption';
import { JSONObject, JSONValue } from 'Common/Types/JSON';
import BaseModel from 'Common/Models/BaseModel';
import PostgresDatabase, {
    PostgresAppInstance,
} from '../Infrastructure/PostgresDatabase';
import {
    DataSource,
    FindOperator,
    Repository,
    SelectQueryBuilder,
} from 'typeorm';
import ObjectID from 'Common/Types/ObjectID';
import SortOrder from 'Common/Types/Database/SortOrder';
import { EncryptionSecret } from '../Config';
import HashedString from 'Common/Types/HashedString';
import UpdateByID from '../Types/Database/UpdateByID';
import Columns from 'Common/Types/Database/Columns';
import FindOneByID from '../Types/Database/FindOneByID';
import Permission, {
    PermissionHelper,
    UserPermission,
} from 'Common/Types/Permission';
import { ColumnAccessControl } from 'Common/Types/Database/AccessControl/AccessControl';
import Dictionary from 'Common/Types/Dictionary';
import NotAuthorizedException from 'Common/Types/Exception/NotAuthorizedException';
import DatabaseCommonInteractionProps from 'Common/Types/Database/DatabaseCommonInteractionProps';
import QueryHelper from '../Types/Database/QueryHelper';
import { getUniqueColumnsBy } from 'Common/Types/Database/UniqueColumnBy';
import Search from 'Common/Types/Database/Search';
import Typeof from 'Common/Types/Typeof';
import TableColumnType from 'Common/Types/Database/TableColumnType';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import LIMIT_MAX from 'Common/Types/Database/LimitMax';
import { TableColumnMetadata } from 'Common/Types/Database/TableColumn';
import LessThan from 'Common/Types/Database/LessThan';
import GreaterThan from 'Common/Types/Database/GreaterThan';
import GreaterThanOrEqual from 'Common/Types/Database/GreaterThanOrEqual';
import LessThanOrEqual from 'Common/Types/Database/LessThanOrEqual';
import InBetween from 'Common/Types/Database/InBetween';

enum DatabaseRequestType {
    Create = 'create',
    Read = 'read',
    Update = 'update',
    Delete = 'delete',
}

export interface OnCreate<TBaseModel extends BaseModel> {
    createBy: CreateBy<TBaseModel>;
    carryForward: any;
}

export interface OnFind<TBaseModel extends BaseModel> {
    findBy: FindBy<TBaseModel>;
    carryForward: any;
}

export interface OnDelete<TBaseModel extends BaseModel> {
    deleteBy: DeleteBy<TBaseModel>;
    carryForward: any;
}

export interface OnUpdate<TBaseModel extends BaseModel> {
    updateBy: UpdateBy<TBaseModel>;
    carryForward: any;
}

class DatabaseService<TBaseModel extends BaseModel> {
    private postgresDatabase!: PostgresDatabase;
    private entityType!: { new (): TBaseModel };
    private model!: TBaseModel;

    public constructor(
        modelType: { new (): TBaseModel },
        postgresDatabase?: PostgresDatabase
    ) {
        this.entityType = modelType;
        this.model = new modelType();

        if (postgresDatabase) {
            this.postgresDatabase = postgresDatabase;
        }
    }

    public getQueryBuilder(modelName: string): SelectQueryBuilder<TBaseModel> {
        return this.getRepository().createQueryBuilder(modelName);
    }

    public getRepository(): Repository<TBaseModel> {
        if (this.postgresDatabase && !this.postgresDatabase.isConnected()) {
            throw new DatabaseNotConnectedException();
        }

        if (!this.postgresDatabase && !PostgresAppInstance.isConnected()) {
            throw new DatabaseNotConnectedException();
        }

        const dataSource: DataSource | null = this.postgresDatabase
            ? this.postgresDatabase.getDataSource()
            : PostgresAppInstance.getDataSource();

        if (dataSource) {
            return dataSource.getRepository<TBaseModel>(this.entityType.name);
        }

        throw new DatabaseNotConnectedException();
    }

    protected isValid(data: TBaseModel): boolean {
        if (!data) {
            throw new BadDataException('Data cannot be null');
        }

        return true;
    }

    protected checkRequiredFields(data: TBaseModel): void {
        // Check required fields.

        const relatationalColumns: Dictionary<string> = {};

        const tableColumns: Array<string> = data.getTableColumns().columns;

        for (const column of tableColumns) {
            const metadata: TableColumnMetadata =
                data.getTableColumnMetadata(column);
            if (metadata.manyToOneRelationColumn) {
                relatationalColumns[metadata.manyToOneRelationColumn] = column;
            }
        }

        for (const requiredField of data.getRequiredColumns().columns) {
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
                if (
                    relatationalColumns[requiredField] &&
                    data.getColumnValue(
                        relatationalColumns[requiredField] as string
                    )
                ) {
                    continue;
                }

                throw new BadDataException(`${requiredField} is required`);
            }
        }
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
        const projectIdColumn: string | null = this.model.getTenantColumn();

        if (projectIdColumn && createBy.props.tenantId) {
            (createBy.data as any)[projectIdColumn] = createBy.props.tenantId;
        }

        return await this.onBeforeCreate(createBy);
    }

    protected encrypt(data: TBaseModel): TBaseModel {
        const iv: Buffer = Encryption.getIV();
        (data as any)['iv'] = iv;

        for (const key of data.getEncryptedColumns().columns) {
            // If data is an object.
            if (typeof (data as any)[key] === Typeof.Object) {
                const dataObj: JSONObject = (data as any)[key] as JSONObject;

                for (const key in dataObj) {
                    dataObj[key] = Encryption.encrypt(
                        dataObj[key] as string,
                        iv
                    );
                }

                (data as any)[key] = dataObj;
            } else {
                //If its string or other type.
                (data as any)[key] = Encryption.encrypt(
                    (data as any)[key] as string,
                    iv
                );
            }
        }

        return data;
    }

    protected async hash(data: TBaseModel): Promise<TBaseModel> {
        const columns: Columns = data.getHashedColumns();

        for (const key of columns.columns) {
            if (
                data.hasValue(key) &&
                !(data.getValue(key) as HashedString).isValueHashed()
            ) {
                await ((data as any)[key] as HashedString).hashValue(
                    EncryptionSecret
                );
            }
        }

        return data;
    }

    protected decrypt(data: TBaseModel): TBaseModel {
        const iv: Buffer = (data as any)['iv'];

        for (const key of data.getEncryptedColumns().columns) {
            // If data is an object.
            if (typeof data.getValue(key) === Typeof.Object) {
                const dataObj: JSONObject = data.getValue(key) as JSONObject;

                for (const key in dataObj) {
                    dataObj[key] = Encryption.decrypt(
                        dataObj[key] as string,
                        iv
                    );
                }

                data.setValue(key, dataObj);
            } else {
                //If its string or other type.
                data.setValue(key, Encryption.decrypt((data as any)[key], iv));
            }
        }

        return data;
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

    protected async onCreateSuccess(
        _onCreate: OnCreate<TBaseModel>,
        createdItem: TBaseModel
    ): Promise<TBaseModel> {
        // A place holder method used for overriding.
        return Promise.resolve(createdItem);
    }

    protected async onCreateError(error: Exception): Promise<Exception> {
        // A place holder method used for overriding.
        return Promise.resolve(error);
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

    protected async getException(error: Exception): Promise<void> {
        throw error;
    }

    private generateSlug(createBy: CreateBy<TBaseModel>): CreateBy<TBaseModel> {
        if (createBy.data.getSlugifyColumn()) {
            (createBy.data as any)[
                createBy.data.getSaveSlugToColumn() as string
            ] = Slug.getSlug(
                (createBy.data as any)[
                    createBy.data.getSlugifyColumn() as string
                ] as string
            );
        }

        return createBy;
    }

    private SanitizeCreateOrUpdate(
        data: TBaseModel | QueryDeepPartialEntity<TBaseModel>,
        props: DatabaseCommonInteractionProps,
        isUpdate: boolean = false
    ): TBaseModel | QueryDeepPartialEntity<TBaseModel> {
        const columns: Columns = this.model.getTableColumns();

        for (const columnName of columns.columns) {
            if (this.model.isEntityColumn(columnName)) {
                const tableColumnMetadata: TableColumnMetadata =
                    this.model.getTableColumnMetadata(columnName);

                const columnValue: JSONValue = (data as any)[columnName];

                if (
                    data &&
                    columnName &&
                    tableColumnMetadata.modelType &&
                    columnValue &&
                    tableColumnMetadata.type === TableColumnType.Entity &&
                    (typeof columnValue === 'string' ||
                        columnValue instanceof ObjectID)
                ) {
                    const relatedType: BaseModel =
                        new tableColumnMetadata.modelType();
                    relatedType._id = columnValue.toString();
                    (data as any)[columnName] = relatedType;
                }

                if (
                    data &&
                    Array.isArray(columnValue) &&
                    columnValue.length > 0 &&
                    tableColumnMetadata.modelType &&
                    columnValue &&
                    tableColumnMetadata.type === TableColumnType.EntityArray
                ) {
                    const itemsArray: Array<BaseModel> = [];
                    for (const item of columnValue) {
                        if (
                            typeof item === 'string' ||
                            item instanceof ObjectID
                        ) {
                            const basemodelItem: BaseModel =
                                new tableColumnMetadata.modelType();
                            basemodelItem._id = item.toString();
                            itemsArray.push(basemodelItem);
                        } else if (item instanceof BaseModel) {
                            itemsArray.push(item);
                        }
                    }
                    (data as any)[columnName] = itemsArray;
                }
            }
        }

        // check createByUserId.

        if (!isUpdate && props.userId) {
            (data as any)['createdByUserId'] = props.userId;
        }

        return data;
    }

    public async create(createBy: CreateBy<TBaseModel>): Promise<TBaseModel> {
        const onCreate: OnCreate<TBaseModel> = await this._onBeforeCreate(
            createBy
        );

        let _createdBy: CreateBy<TBaseModel> = onCreate.createBy;

        const carryForward: any = onCreate.carryForward;

        _createdBy = this.generateSlug(_createdBy);

        let data: TBaseModel = _createdBy.data;

        // add tenantId if present.
        const tenantColumnName: string | null = data.getTenantColumn();

        if (tenantColumnName && _createdBy.props.tenantId) {
            data.setColumnValue(tenantColumnName, _createdBy.props.tenantId);
        }

        this.checkRequiredFields(data);

        if (!this.isValid(data)) {
            throw new BadDataException('Data is not valid');
        }

        // Encrypt data
        data = this.encrypt(data);

        // hash data
        data = await this.hash(data);

        data = this.asCreateableByPermissions(createBy);
        createBy.data = data;

        // check uniqueColumns by:
        createBy = await this.checkUniqueColumnBy(createBy);

        // serialize.
        createBy.data = this.SanitizeCreateOrUpdate(
            createBy.data,
            createBy.props
        ) as TBaseModel;

        try {
            createBy.data = await this.getRepository().save(createBy.data);
            createBy.data = await this.onCreateSuccess(
                {
                    createBy,
                    carryForward,
                },
                createBy.data
            );
            return createBy.data;
        } catch (error) {
            await this.onCreateError(error as Exception);
            throw this.getException(error as Exception);
        }
    }

    private async checkUniqueColumnBy(
        createBy: CreateBy<TBaseModel>
    ): Promise<CreateBy<TBaseModel>> {
        let existingItemsWithSameNameCount: number = 0;

        const uniqueColumnsBy: Dictionary<string> = getUniqueColumnsBy(
            createBy.data
        );

        for (const key in uniqueColumnsBy) {
            if (!uniqueColumnsBy[key]) {
                continue;
            }

            existingItemsWithSameNameCount = (
                await this.countBy({
                    query: {
                        [key]: QueryHelper.findWithSameText(
                            (createBy.data as any)[key]
                                ? ((createBy.data as any)[key]! as string)
                                : ''
                        ),
                        [uniqueColumnsBy[key] as any]: (createBy.data as any)[
                            uniqueColumnsBy[key] as any
                        ],
                    },
                    props: {
                        isRoot: true,
                    },
                })
            ).toNumber();

            if (existingItemsWithSameNameCount > 0) {
                throw new BadDataException(
                    `${this.model.singularName} with the same ${key} already exists.`
                );
            }

            existingItemsWithSameNameCount = 0;
        }

        return Promise.resolve(createBy);
    }

    public getPermissions(
        props: DatabaseCommonInteractionProps,
        type: DatabaseRequestType
    ): Array<UserPermission> {
        if (!props.userGlobalAccessPermission) {
            throw new NotAuthorizedException(`Permissions not found.`);
        }

        let isPublicAllowed: boolean = false;
        let modelPermissions: Array<Permission> = [];

        if (type === DatabaseRequestType.Create) {
            modelPermissions = this.model.createRecordPermissions;
        }

        if (type === DatabaseRequestType.Update) {
            modelPermissions = this.model.updateRecordPermissions;
        }

        if (type === DatabaseRequestType.Delete) {
            modelPermissions = this.model.deleteRecordPermissions;
        }

        if (type === DatabaseRequestType.Read) {
            modelPermissions = this.model.readRecordPermissions;
        }

        isPublicAllowed = modelPermissions.includes(Permission.Public);

        if (!isPublicAllowed && !props.userId) {
            // this means the record is not publicly createable and the user is not logged in.
            throw new NotAuthorizedException(
                `A user should be logged in to ${type} record of type ${this.entityType.name}.`
            );
        }

        if (
            props.userGlobalAccessPermission &&
            !props.userGlobalAccessPermission.globalPermissions.includes(
                Permission.Public
            )
        ) {
            props.userGlobalAccessPermission.globalPermissions.push(
                Permission.Public
            ); // add public permission if not already.
        }

        let userPermissions: Array<UserPermission> = [];

        if (!props.tenantId && props.userGlobalAccessPermission) {
            /// take gloabl permissions.
            userPermissions =
                props.userGlobalAccessPermission.globalPermissions.map(
                    (permission: Permission) => {
                        return {
                            permission: permission,
                            labelIds: [],
                            _type: 'UserPermission',
                        };
                    }
                );
        } else if (props.tenantId && props.userProjectAccessPermission) {
            /// take project based permissions because this is a project request.
            userPermissions = props.userProjectAccessPermission.permissions;
        } else {
            throw new NotAuthorizedException(`Permissions not found.`);
        }

        if (
            props.tenantId &&
            props.userProjectAccessPermission &&
            !PermissionHelper.doesPermissionsIntersect(
                props.userProjectAccessPermission.permissions.map(
                    (userPermission: UserPermission) => {
                        return userPermission.permission;
                    }
                ) || [],
                modelPermissions
            )
        ) {
            debugger;
            throw new NotAuthorizedException(
                `You do not have permissions to ${type} ${
                    this.model.singularName
                }. You need one of these permissions: ${PermissionHelper.getPermissionTitles(
                    modelPermissions
                ).join(',')}`
            );
        }

        return userPermissions;
    }

    public asCreateableByPermissions(
        createBy: CreateBy<TBaseModel>
    ): TBaseModel {
        // If system is making this query then let the query run!
        if (createBy.props.isRoot) {
            return createBy.data;
        }

        const userPermissions: Array<UserPermission> = this.getPermissions(
            createBy.props,
            DatabaseRequestType.Create
        );

        const data: TBaseModel = this.keepColumns(
            this.getCreateableColumnsByPermissions(userPermissions || []),
            createBy.data
        );

        return data;
    }

    public asFindByByPermissions(
        findBy: FindBy<TBaseModel>
    ): FindBy<TBaseModel> {
        if (findBy.props.isRoot) {
            return findBy;
        }

        let columns: Columns = new Columns([]);

        const userPermissions: Array<UserPermission> = this.getPermissions(
            findBy.props,
            DatabaseRequestType.Read
        );

        const intersectingPermissions: Array<Permission> =
            PermissionHelper.getIntersectingPermissions(
                userPermissions.map((i: UserPermission) => {
                    return i.permission;
                }),
                this.model.readRecordPermissions
            );

        columns = this.getReadColumnsByPermissions(userPermissions || []);
        const tableColumns: Array<string> =
            this.model.getTableColumns().columns;

        const excludedColumns: Array<string> = [
            '_id',
            'createdAt',
            'deletedAt',
            'updatedAt',
        ];

        // Now we need to check all columns.

        for (const key in findBy.query) {
            if (excludedColumns.includes(key)) {
                continue;
            }

            if (!columns.columns.includes(key)) {
                throw new NotAuthorizedException(
                    `You do not have permissions to query on - ${key}.
                    You need any one of these permissions: ${PermissionHelper.getPermissionTitles(
                        this.model.getColumnAccessControlFor(key).read
                    ).join(',')}`
                );
            }
        }

        for (const key in findBy.select) {
            if (excludedColumns.includes(key)) {
                continue;
            }

            if (!columns.columns.includes(key)) {
                if (!tableColumns.includes(key)) {
                    throw new BadDataException(
                        `${key} column does not exist on ${this.model.singularName}`
                    );
                }

                throw new NotAuthorizedException(
                    `You do not have permissions to select on - ${key}.
                    You need any one of these permissions: ${PermissionHelper.getPermissionTitles(
                        this.model.getColumnAccessControlFor(key).read
                    ).join(',')}`
                );
            }
        }

        const tenantColumn: string | null = this.model.getTenantColumn();

        if (
            findBy.props.isMultiTenantRequest &&
            !this.model.canQueryMultiTenant()
        ) {
            throw new BadDataException(
                'isMultiTenantRequest not allowed on this model'
            );
        }

        // If this model has a tenantColumn, and request has tenantId, and is multiTenantQuery null then add tenantId to query.
        if (
            tenantColumn &&
            findBy.props.tenantId &&
            !findBy.props.isMultiTenantRequest
        ) {
            (findBy.query as any)[tenantColumn] = findBy.props.tenantId;
        } else if (
            this.model.isUserQueryWithoutTenantAllowed() &&
            this.model.getUserColumn() &&
            findBy.props.userId
        ) {
            (findBy.query as any)[this.model.getUserColumn() as string] =
                findBy.props.userId;
        } else if (
            tenantColumn &&
            !findBy.props.tenantId &&
            findBy.props.userGlobalAccessPermission
        ) {
            (findBy.query as any)[tenantColumn] = QueryHelper.in(
                findBy.props.userGlobalAccessPermission?.projectIds
            );
        }

        if (
            this.model.userColumn &&
            findBy.props.userId &&
            intersectingPermissions.length === 0 &&
            this.model.readRecordPermissions.includes(Permission.LoggedInUser)
        ) {
            (findBy.query as any)[this.model.userColumn] = findBy.props.userId;
        }

        if (this.model.isPermissionIf) {
            for (const key in this.model.isPermissionIf) {
                const permission: Permission = key as Permission;

                if (
                    userPermissions
                        .map((i: UserPermission) => {
                            return i.permission;
                        })
                        ?.includes(permission) &&
                    this.model.isPermissionIf[permission]
                ) {
                    const columnName: string = Object.keys(
                        this.model.isPermissionIf[permission] as any
                    )[0] as string;
                    (findBy.query as any)[columnName] = (
                        this.model.isPermissionIf[permission] as any
                    )[columnName];
                }
            }
        }

        return findBy;
    }

    public asUpdateByByPermissions(
        updateBy: UpdateBy<TBaseModel>
    ): UpdateBy<TBaseModel> {
        if (updateBy.props.isRoot) {
            return updateBy;
        }

        const findBy: FindBy<TBaseModel> = this.asFindByByPermissions({
            query: updateBy.query,
            props: updateBy.props,
            select: {},
            populate: {},
            limit: 0,
            skip: 0,
        });

        updateBy.query = findBy.query;

        const userPermissions: Array<UserPermission> = this.getPermissions(
            updateBy.props,
            DatabaseRequestType.Update
        );

        let updateColumns: Columns = new Columns([]);

        updateColumns = this.getUpdateColumnsByPermissions(
            userPermissions || []
        );

        for (const key in updateBy.data) {
            if (!updateColumns.columns.includes(key)) {
                throw new NotAuthorizedException(
                    `You do not have permissions to update this record at - ${key}. 
                    You need any one of these permissions: ${PermissionHelper.getPermissionTitles(
                        this.model.getColumnAccessControlFor(key).update
                    ).join(',')}`
                );
            }
        }

        return updateBy;
    }

    public asDeleteByPermissions(
        deleteBy: DeleteBy<TBaseModel>
    ): DeleteBy<TBaseModel> {
        if (deleteBy.props.isRoot) {
            return deleteBy;
        }

        const userPermissions: Array<UserPermission> = this.getPermissions(
            deleteBy.props,
            DatabaseRequestType.Delete
        );
        const intersectingPermissions: Array<Permission> =
            PermissionHelper.getIntersectingPermissions(
                userPermissions.map((i: UserPermission) => {
                    return i.permission;
                }),
                this.model.deleteRecordPermissions
            );
        const tenantColumn: string | null = this.model.getTenantColumn();
        if (tenantColumn && deleteBy.props.tenantId) {
            (deleteBy.query as any)[tenantColumn] = deleteBy.props.tenantId;
        }

        if (
            this.model.userColumn &&
            intersectingPermissions.length === 0 &&
            this.model.deleteRecordPermissions.includes(Permission.LoggedInUser)
        ) {
            (deleteBy.query as any)[this.model.userColumn] =
                deleteBy.props.userId;
        }

        return deleteBy;
    }

    public getCreateableColumnsByPermissions(
        userPermissions: Array<UserPermission>
    ): Columns {
        const permissions: Array<Permission> = userPermissions.map(
            (item: UserPermission) => {
                return item.permission;
            }
        );

        const accessControl: Dictionary<ColumnAccessControl> =
            this.model.getColumnAccessControlForAllColumns();

        const columns: Array<string> = [];

        for (const key in accessControl) {
            if (
                accessControl[key]?.create &&
                PermissionHelper.doesPermissionsIntersect(
                    permissions,
                    accessControl[key]?.create || []
                )
            ) {
                columns.push(key);
            }
        }

        return new Columns(columns);
    }

    public getReadColumnsByPermissions(
        userPermissions: Array<UserPermission>
    ): Columns {
        const accessControl: Dictionary<ColumnAccessControl> =
            this.model.getColumnAccessControlForAllColumns();

        const columns: Array<string> = [];

        const permissions: Array<Permission> = userPermissions.map(
            (item: UserPermission) => {
                return item.permission;
            }
        );

        for (const key in accessControl) {
            if (
                accessControl[key]?.read &&
                PermissionHelper.doesPermissionsIntersect(
                    permissions,
                    accessControl[key]?.read || []
                )
            ) {
                columns.push(key);
            }
        }

        return new Columns(columns);
    }

    public getUpdateColumnsByPermissions(
        userPermissions: Array<UserPermission>
    ): Columns {
        const accessControl: Dictionary<ColumnAccessControl> =
            this.model.getColumnAccessControlForAllColumns();

        const columns: Array<string> = [];

        const permissions: Array<Permission> = userPermissions.map(
            (item: UserPermission) => {
                return item.permission;
            }
        );

        for (const key in accessControl) {
            if (
                accessControl[key]?.update &&
                PermissionHelper.doesPermissionsIntersect(
                    permissions,
                    accessControl[key]?.update || []
                )
            ) {
                columns.push(key);
            }
        }

        return new Columns(columns);
    }

    private keepColumns(columnsToKeep: Columns, data: TBaseModel): TBaseModel {
        if (!columnsToKeep) {
            return data;
        }

        for (const key of Object.keys(this)) {
            const columns: Columns = data.getTableColumns();

            if (
                !(
                    columnsToKeep &&
                    columnsToKeep.columns.length > 0 &&
                    columnsToKeep.columns.includes(key)
                ) &&
                columns.hasColumn(key) &&
                (this as any)[key]
            ) {
                throw new BadDataException(
                    `User is not allowed to create on ${key} column of ${this.model.singularName}`
                );
            }
        }

        return data;
    }

    public async countBy({
        query,
        skip,
        limit,
        props,
    }: CountBy<TBaseModel>): Promise<PositiveNumber> {
        try {
            if (!skip) {
                skip = new PositiveNumber(0);
            }

            if (!limit) {
                limit = new PositiveNumber(Infinity);
            }

            if (!(skip instanceof PositiveNumber)) {
                skip = new PositiveNumber(skip);
            }

            if (!(limit instanceof PositiveNumber)) {
                limit = new PositiveNumber(limit);
            }

            let findBy: FindBy<TBaseModel> = {
                query,
                skip,
                limit,
                props,
            };

            findBy = this.asFindByByPermissions(findBy);

            findBy.query = this.serializeQuery(query);

            const count: number = await this.getRepository().count({
                where: findBy.query as any,
                skip: (findBy.skip as PositiveNumber).toNumber(),
                take: (findBy.limit as PositiveNumber).toNumber(),
            });

            let countPositive: PositiveNumber = new PositiveNumber(count);
            countPositive = await this.onCountSuccess(countPositive);
            return countPositive;
        } catch (error) {
            await this.onCountError(error as Exception);
            throw this.getException(error as Exception);
        }
    }

    private serializeQuery(query: Query<TBaseModel>): Query<TBaseModel> {
        for (const key in query) {
            if (
                query[key] &&
                (query[key] as any)._value &&
                Array.isArray((query[key] as any)._value) &&
                (query[key] as any)._value.length > 0
            ) {
                let counter: number = 0;
                for (const item of (query[key] as any)._value) {
                    if (item instanceof ObjectID) {
                        ((query[key] as any)._value as any)[counter] = (
                            (query[key] as any)._value as any
                        )[counter].toString();
                    }
                    counter++;
                }
            } else if (query[key] && query[key] instanceof ObjectID) {
                query[key] = QueryHelper.equalTo(
                    (query[key] as ObjectID).toString() as any
                ) as any;
            } else if (query[key] && query[key] instanceof Search) {
                query[key] = QueryHelper.search(
                    (query[key] as Search).toString() as any
                ) as any;
            } else if (query[key] && query[key] instanceof LessThan) {
                query[key] = QueryHelper.lessThan(
                    (query[key] as LessThan).toString() as any
                ) as any;
            } else if (query[key] && query[key] instanceof InBetween) {
                query[key] = QueryHelper.inBetween(
                    (query[key] as InBetween).startValue as any,
                    (query[key] as InBetween).endValue as any
                ) as any;
            } else if (query[key] && query[key] instanceof GreaterThan) {
                query[key] = QueryHelper.greaterThan(
                    (query[key] as GreaterThan).toString() as any
                ) as any;
            } else if (query[key] && query[key] instanceof GreaterThanOrEqual) {
                query[key] = QueryHelper.greaterThanEqualTo(
                    (query[key] as GreaterThanOrEqual).toString() as any
                ) as any;
            } else if (query[key] && query[key] instanceof LessThanOrEqual) {
                query[key] = QueryHelper.lessThanEqualTo(
                    (query[key] as LessThanOrEqual).toString() as any
                ) as any;
            } else if (query[key] && Array.isArray(query[key])) {
                query[key] = QueryHelper.in(
                    query[key] as any
                ) as FindOperator<any> as any;
            }
        }

        return query;
    }

    public async deleteOneBy(
        deleteOneBy: DeleteOneBy<TBaseModel>
    ): Promise<number> {
        return await this._deleteBy(deleteOneBy);
    }

    public async deleteBy(deleteBy: DeleteBy<TBaseModel>): Promise<number> {
        return await this._deleteBy(deleteBy);
    }

    private async _deleteBy(deleteBy: DeleteBy<TBaseModel>): Promise<number> {
        try {
            const onDelete: OnDelete<TBaseModel> = await this.onBeforeDelete(
                deleteBy
            );
            let beforeDeleteBy: DeleteBy<TBaseModel> = onDelete.deleteBy;

            const carryForward: any = onDelete.carryForward;

            beforeDeleteBy = this.asDeleteByPermissions(beforeDeleteBy);

            const items: Array<TBaseModel> = await this._findBy({
                query: beforeDeleteBy.query,
                skip: 0,
                limit: LIMIT_MAX,
                populate: {},
                select: {},
                props: beforeDeleteBy.props,
            });

            await this._updateBy({
                query: deleteBy.query,
                data: {
                    deletedByUserId: deleteBy.props.userId,
                } as any,
                props: {
                    isRoot: true,
                },
            });

            const numberOfDocsAffected: number =
                (await this.getRepository().delete(beforeDeleteBy.query as any))
                    .affected || 0;

            await this.onDeleteSuccess(
                { deleteBy, carryForward },
                items.map((i: TBaseModel) => {
                    return new ObjectID(i._id!);
                })
            );

            return numberOfDocsAffected;
        } catch (error) {
            await this.onDeleteError(error as Exception);
            throw this.getException(error as Exception);
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
            }
            const onFind: OnFind<TBaseModel> = await this.onBeforeFind(findBy);
            let onBeforeFind: FindBy<TBaseModel> = onFind.findBy;
            const carryForward: any = onFind.carryForward;

            onBeforeFind = this.asFindByByPermissions(findBy);

            if (
                !onBeforeFind.select ||
                Object.keys(onBeforeFind.select).length === 0
            ) {
                onBeforeFind.select = {} as any;
            }

            if (!(onBeforeFind.select as any)['_id']) {
                (onBeforeFind.select as any)['_id'] = true;
            }

            if (!(onBeforeFind.select as any)['createdAt']) {
                (onBeforeFind.select as any)['createdAt'] = true;
            }

            onBeforeFind.query = this.serializeQuery(onBeforeFind.query);
            onBeforeFind = this.serializePopulate(onBeforeFind);

            if (!(onBeforeFind.skip instanceof PositiveNumber)) {
                onBeforeFind.skip = new PositiveNumber(onBeforeFind.skip);
            }

            if (!(onBeforeFind.limit instanceof PositiveNumber)) {
                onBeforeFind.limit = new PositiveNumber(onBeforeFind.limit);
            }

            const items: Array<TBaseModel> = await this.getRepository().find({
                skip: onBeforeFind.skip.toNumber(),
                take: onBeforeFind.limit.toNumber(),
                where: onBeforeFind.query as any,
                order: onBeforeFind.sort as any,
                relations: onBeforeFind.populate as any,
                select: onBeforeFind.select as any,
            });

            let decryptedItems: Array<TBaseModel> = [];

            for (const item of items) {
                decryptedItems.push(this.decrypt(item));
            }

            decryptedItems = this.sanitizeFindByItems(
                decryptedItems,
                onBeforeFind
            );

            decryptedItems = await (
                await this.onFindSuccess(
                    { findBy, carryForward },
                    decryptedItems
                )
            ).carryForward;

            return decryptedItems;
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

        for (const key in findBy.select) {
            // for each key in sleect check if there's nested properties, this indicates there's a relation.
            if (typeof findBy.select[key] === Typeof.Object) {
                // get meta data to check if this column is an entity array.
                const tableColumnMetadata: TableColumnMetadata =
                    this.model.getTableColumnMetadata(key);

                if (!tableColumnMetadata.modelType) {
                    throw new BadDataException(
                        'Populate not supported on ' +
                            key +
                            ' of ' +
                            this.model.singularName +
                            ' because this column modelType is not found.'
                    );
                }

                const relatedModel: BaseModel =
                    new tableColumnMetadata.modelType();
                if (tableColumnMetadata.type === TableColumnType.EntityArray) {
                    const tableColumns: Array<string> =
                        relatedModel.getTableColumns().columns;
                    const columnsToKeep: Array<string> = Object.keys(
                        (findBy.select as any)[key]
                    );

                    for (const item of items) {
                        if (item[key] && Array.isArray(item[key])) {
                            const relatedArray: Array<BaseModel> = item[
                                key
                            ] as any;
                            const newArray: Array<BaseModel> = [];
                            // now we need to sanitize data.

                            for (const relatedArrayItem of relatedArray) {
                                for (const column of tableColumns) {
                                    if (!columnsToKeep.includes(column)) {
                                        (relatedArrayItem as any)[column] =
                                            undefined;
                                    }
                                }
                                newArray.push(relatedArrayItem);
                            }

                            (item[key] as any) = newArray;
                        }
                    }
                }
            }
        }

        return items;
    }

    private serializePopulate(
        onBeforeFind: FindBy<TBaseModel>
    ): FindBy<TBaseModel> {
        for (const key in onBeforeFind.populate) {
            if (typeof onBeforeFind.populate[key] === Typeof.Object) {
                const tableColumnMetadata: TableColumnMetadata =
                    this.model.getTableColumnMetadata(key);

                if (!tableColumnMetadata.modelType) {
                    throw new BadDataException(
                        'Populate not supported on ' +
                            key +
                            ' of ' +
                            this.model.singularName +
                            ' because this column modelType is not found.'
                    );
                }

                const relatedModel: BaseModel =
                    new tableColumnMetadata.modelType();

                if (
                    tableColumnMetadata.type === TableColumnType.Entity ||
                    tableColumnMetadata.type === TableColumnType.EntityArray
                ) {
                    for (const innerKey in (onBeforeFind.populate as any)[
                        key
                    ]) {
                        // check for permissions.
                        if (
                            typeof (onBeforeFind.populate as any)[key][
                                innerKey
                            ] === Typeof.Object
                        ) {
                            throw new BadDataException(
                                'Nested populate not supported'
                            );
                        }

                        // check if the user has permission to read this column
                        if (onBeforeFind.props.userProjectAccessPermission) {
                            const hasPermission: boolean =
                                relatedModel.hasReadPermissions(
                                    onBeforeFind.props
                                        .userProjectAccessPermission,
                                    innerKey
                                );

                            if (!hasPermission) {
                                debugger;
                                throw new NotAuthorizedException(
                                    `You do not have permissions to ${key}.${innerKey} on read ${
                                        onBeforeFind.limit === 1
                                            ? this.model.singularName
                                            : this.model.pluralName
                                    }. You need one of these permissions: ${PermissionHelper.getPermissionTitles(
                                        relatedModel.getColumnAccessControlFor(
                                            innerKey
                                        ).read
                                    ).join(',')}`
                                );
                            }
                        }
                    }

                    (onBeforeFind.select as any)[key] = (
                        onBeforeFind.populate as any
                    )[key];
                    (onBeforeFind.populate as any)[key] = true;
                } else {
                    throw new BadDataException(
                        'Populate not supported on ' +
                            key +
                            ' of ' +
                            this.model.singularName +
                            ' because this column is not of type Entity or EntityArray'
                    );
                }
            } else {
                // if you want to populate the whole object, you only do the id because of security.
                (onBeforeFind.select as any)[key] = {
                    _id: true,
                } as any;
                (onBeforeFind.populate as any)[key] = true;
            }
        }

        return onBeforeFind;
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
        return await this.findOneBy({
            query: {
                _id: findOneById.id.toString() as any,
            },
            select: findOneById.select || {},
            populate: findOneById.populate || {},
            props: findOneById.props,
        });
    }

    private async _updateBy(updateBy: UpdateBy<TBaseModel>): Promise<number> {
        try {
            const onUpdate: OnUpdate<TBaseModel> = await this.onBeforeUpdate(
                updateBy
            );
            let beforeUpdateBy: UpdateBy<TBaseModel> = onUpdate.updateBy;
            const carryForward: any = onUpdate.carryForward;

            beforeUpdateBy = this.asUpdateByByPermissions(beforeUpdateBy);

            const query: Query<TBaseModel> = this.serializeQuery(
                beforeUpdateBy.query
            );
            const data: QueryDeepPartialEntity<TBaseModel> =
                this.SanitizeCreateOrUpdate(
                    beforeUpdateBy.data,
                    updateBy.props,
                    true
                ) as QueryDeepPartialEntity<TBaseModel>;

            const items: Array<TBaseModel> = await this._findBy({
                query,
                skip: 0,
                limit: LIMIT_MAX,
                populate: {},
                select: {},
                props: beforeUpdateBy.props,
            });

            for (let item of items) {
                item = {
                    ...item,
                    ...data,
                };

                await this.getRepository().save(item);
            }

            // Cant Update relations.
            // https://github.com/typeorm/typeorm/issues/2821

            // const numberOfDocsAffected: number =
            //     (
            //         await this.getRepository().update(
            //             query as any,
            //             data
            //         )
            //     ).affected || 0;

            await this.onUpdateSuccess(
                { updateBy, carryForward },
                items.map((i: TBaseModel) => {
                    return new ObjectID(i._id!);
                })
            );

            return items.length;
        } catch (error) {
            await this.onUpdateError(error as Exception);
            throw this.getException(error as Exception);
        }
    }

    public async updateOneBy(
        updateOneBy: UpdateOneBy<TBaseModel>
    ): Promise<number> {
        return await this._updateBy(updateOneBy);
    }

    public async updateBy(updateBy: UpdateBy<TBaseModel>): Promise<number> {
        return await this._updateBy(updateBy);
    }

    public async updateOneById(
        updateById: UpdateByID<TBaseModel>
    ): Promise<void> {
        await this.updateOneBy({
            query: {
                _id: updateById.id.toString() as any,
            },
            data: updateById.data,
            props: updateById.props,
        });
    }

    public async updateOneByIdAndFetch(
        updateById: UpdateByID<TBaseModel>
    ): Promise<TBaseModel | null> {
        await this.updateOneById(updateById);
        return this.findOneById({
            id: updateById.id,
            props: updateById.props,
        });
    }

    public async searchBy({
        skip,
        limit,
        select,
        populate,
        props,
    }: SearchBy<TBaseModel>): Promise<SearchResult<TBaseModel>> {
        const query: Query<TBaseModel> = {};

        // query[column] = RegExp(`^${text}`, 'i');

        const [items, count]: [Array<TBaseModel>, PositiveNumber] =
            await Promise.all([
                this.findBy({
                    query,
                    skip,
                    limit,
                    select,
                    populate,
                    props: props,
                }),
                this.countBy({
                    query,
                    skip: new PositiveNumber(0),
                    limit: new PositiveNumber(Infinity),
                    props: props,
                }),
            ]);

        return { items, count };
    }
}

export default DatabaseService;
