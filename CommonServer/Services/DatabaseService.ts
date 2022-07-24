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
import { JSONObject } from 'Common/Types/JSON';
import BaseModel from 'Common/Models/BaseModel';
import PostgresDatabase, {
    PostgresAppInstance,
} from '../Infrastructure/PostgresDatabase';
import { DataSource, In, Repository, SelectQueryBuilder } from 'typeorm';
import ObjectID from 'Common/Types/ObjectID';
import SortOrder from '../Types/Database/SortOrder';
import HardDeleteBy from '../Types/Database/HardDeleteBy';
import { EncryptionSecret } from '../Config';
import HashedString from 'Common/Types/HashedString';
import UpdateByID from '../Types/Database/UpdateByID';
import Columns from 'Common/Types/Database/Columns';
import FindOneByID from '../Types/Database/FindOneByID';
import Permission, {
    PermissionUtil,
    UserPermission,
} from 'Common/Types/Permission';
import { ColumnAccessControl } from 'Common/Types/Database/AccessControl/AccessControl';
import Dictionary from 'Common/Types/Dictionary';
import { getColumnAccessControlForAllColumns } from 'Common/Types/Database/AccessControl/ColumnAccessControl';
import NotAuthorizedException from 'Common/Types/Exception/NotAuthorizedException';
import DatabaseCommonInteractionProps from 'Common/Types/Database/DatabaseCommonInteractionProps';

enum DatabaseRequestType {
    Create = 'create',
    Read = 'read',
    Update = 'update',
    Delete = 'delete',
}

class DatabaseService<TBaseModel extends BaseModel> {
    private postgresDatabase!: PostgresDatabase;
    private entityType!: { new (): TBaseModel };
    private model!: TBaseModel;

    public constructor(
        type: { new (): TBaseModel },
        postgresDatabase?: PostgresDatabase
    ) {
        this.entityType = type;
        this.model = new type();

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

        for (const requiredField of data.getRequiredColumns().columns) {
            if (
                !(data as any)[requiredField] &&
                !data.isDefaultValueColumn(requiredField)
            ) {
                throw new BadDataException(`${requiredField} is required`);
            }
        }
    }

    protected async onBeforeCreate({
        data,
    }: CreateBy<TBaseModel>): Promise<CreateBy<TBaseModel>> {
        // A place holder method used for overriding.
        return Promise.resolve({ data } as CreateBy<TBaseModel>);
    }

    protected encrypt(data: TBaseModel): TBaseModel {
        const iv: Buffer = Encryption.getIV();
        (data as any)['iv'] = iv;

        for (const key of data.getEncryptedColumns().columns) {
            // If data is an object.
            if (typeof (data as any)[key] === 'object') {
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
            if (typeof data.getValue(key) === 'object') {
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
    ): Promise<DeleteBy<TBaseModel>> {
        // A place holder method used for overriding.
        return Promise.resolve(deleteBy);
    }

    protected async onBeforeUpdate(
        updateBy: UpdateBy<TBaseModel>
    ): Promise<UpdateBy<TBaseModel>> {
        // A place holder method used for overriding.
        return Promise.resolve(updateBy);
    }

    protected async onBeforeFind(
        findBy: FindBy<TBaseModel>
    ): Promise<FindBy<TBaseModel>> {
        // A place holder method used for overriding.
        return Promise.resolve(findBy);
    }

    protected async onCreateSuccess(
        createBy: CreateBy<TBaseModel>
    ): Promise<CreateBy<TBaseModel>> {
        // A place holder method used for overriding.
        return Promise.resolve(createBy);
    }

    protected async onCreateError(error: Exception): Promise<Exception> {
        // A place holder method used for overriding.
        return Promise.resolve(error);
    }

    protected async onUpdateSuccess(): Promise<void> {
        // A place holder method used for overriding.
        return Promise.resolve();
    }

    protected async onUpdateError(error: Exception): Promise<Exception> {
        // A place holder method used for overriding.
        return Promise.resolve(error);
    }

    protected async onDeleteSuccess(): Promise<void> {
        // A place holder method used for overriding.
        return Promise.resolve();
    }

    protected async onDeleteError(error: Exception): Promise<Exception> {
        // A place holder method used for overriding.
        return Promise.resolve(error);
    }

    protected async onFindSuccess(
        items: Array<TBaseModel>
    ): Promise<Array<TBaseModel>> {
        // A place holder method used for overriding.
        return Promise.resolve(items);
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

    public async create(createBy: CreateBy<TBaseModel>): Promise<TBaseModel> {
        let _createdBy: CreateBy<TBaseModel> = await this.onBeforeCreate(
            createBy
        );

        _createdBy = this.generateSlug(_createdBy);

        let data: TBaseModel = _createdBy.data;

        this.checkRequiredFields(data);

        if (!this.isValid(data)) {
            throw new BadDataException('Data is not valid');
        }

        // Encrypt data
        data = this.encrypt(data);

        // hash data
        data = await this.hash(data);

        data = this.asCreateableByPermissions(createBy);

        try {
            const savedData: TBaseModel = await this.getRepository().save(data);
            createBy.data = savedData;
            await this.onCreateSuccess(createBy);
            return savedData;
        } catch (error) {
            await this.onCreateError(error as Exception);
            throw this.getException(error as Exception);
        }
    }

    public getPermissions(
        props: DatabaseCommonInteractionProps,
        type: DatabaseRequestType
    ): Array<UserPermission> {
        if (!props.userGlobalAccessPermission) {
            throw new NotAuthorizedException(`Permissions not found.`);
        }

        let isPublicAllowed = false;
        let modelPermissions: Array<Permission> = [];

        if (type === DatabaseRequestType.Create) {
            isPublicAllowed = this.model.createRecordPermissions.includes(
                Permission.Public
            );
            modelPermissions = this.model.createRecordPermissions;
        }

        if (type === DatabaseRequestType.Update) {
            isPublicAllowed = this.model.updateRecordPermissions.includes(
                Permission.Public
            );
            modelPermissions = this.model.updateRecordPermissions;
        }

        if (type === DatabaseRequestType.Delete) {
            isPublicAllowed = this.model.deleteRecordPermissions.includes(
                Permission.Public
            );
            modelPermissions = this.model.deleteRecordPermissions;
        }

        if (type === DatabaseRequestType.Read) {
            isPublicAllowed = this.model.readRecordPermissions.includes(
                Permission.Public
            );
            modelPermissions = this.model.readRecordPermissions;
        }

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

        if (!props.projectId && props.userGlobalAccessPermission) {
            /// take gloabl permissions.
            userPermissions =
                props.userGlobalAccessPermission.globalPermissions.map(
                    (permission: Permission) => {
                        return {
                            permission: permission,
                            labelIds: [],
                        };
                    }
                );
        } else if (props.projectId && props.userProjectAccessPermission) {
            /// take project based permissions because this is a project request.
            userPermissions = props.userProjectAccessPermission.permissions;
        } else {
            throw new NotAuthorizedException(`Permissions not found.`);
        }

        if (
            props.userProjectAccessPermission &&
            !PermissionUtil.doesPermissionsIntersect(
                props.userProjectAccessPermission.permissions.map(
                    (userPermission: UserPermission) => {
                        return userPermission.permission;
                    }
                ) || [],
                modelPermissions
            )
        ) {
            throw new NotAuthorizedException(
                `A user does not have permissions to ${type} record of type ${this.entityType.name}.`
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

        columns = this.getReadColumnsByPermissions(userPermissions || []);

        // Now we need to check all columns.

        for (const key in findBy.query) {
            if (!columns.columns.includes(key)) {
                throw new NotAuthorizedException(
                    `A user does not have permissions to query on - ${key}.`
                );
            }
        }

        for (const key in findBy.select) {
            if (!columns.columns.includes(key)) {
                throw new NotAuthorizedException(
                    `A user does not have permissions to select on - ${key}.`
                );
            }
        }

        if (this.model.projectColumn && findBy.props.projectId) {
            (findBy.query as any)[this.model.projectColumn] =
                findBy.props.projectId;
        } else if (
            this.model.projectColumn &&
            !findBy.props.projectId &&
            findBy.props.userGlobalAccessPermission
        ) {
            if (this.model.projectColumn === '_id') {
                (findBy.query as any)[this.model.projectColumn] = In(
                    findBy.props.userGlobalAccessPermission?.projectIds.map(
                        (item: ObjectID) => {
                            return item.toString();
                        }
                    )
                );
            } else {
                (findBy.query as any)[this.model.projectColumn] = In(
                    findBy.props.userGlobalAccessPermission?.projectIds
                );
            }
        } else if (this.model.projectColumn) {
            throw new NotAuthorizedException(
                'Not enough permissions to read the record'
            );
        }

        if (this.model.userColumn && findBy.props.userId) {
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

        const userPermissions: Array<UserPermission> = this.getPermissions(
            updateBy.props,
            DatabaseRequestType.Update
        );

        let updateColumns: Columns = new Columns([]);
        let readColumns: Columns = new Columns([]);

        updateColumns = this.getUpdateColumnsByPermissions(
            userPermissions || []
        );
        readColumns = this.getReadColumnsByPermissions(userPermissions || []);

        // Now we need to check all columns.

        for (const key in updateBy.query) {
            if (!readColumns.columns.includes(key)) {
                throw new NotAuthorizedException(
                    `A user does not have permissions to query on - ${key}.`
                );
            }
        }

        for (const key in updateBy.data) {
            if (!updateColumns.columns.includes(key)) {
                throw new NotAuthorizedException(
                    `A user does not have permissions to update this record at - ${key}.`
                );
            }
        }

        if (this.model.projectColumn && updateBy.props.projectId) {
            (updateBy.query as any)[this.model.projectColumn] =
                updateBy.props.projectId;
        } else if (
            this.model.projectColumn &&
            !updateBy.props.projectId &&
            updateBy.props.userGlobalAccessPermission
        ) {
            if (this.model.projectColumn === '_id') {
                (updateBy.query as any)[this.model.projectColumn] = In(
                    updateBy.props.userGlobalAccessPermission?.projectIds.map(
                        (item: ObjectID) => {
                            return item.toString();
                        }
                    )
                );
            } else {
                (updateBy.query as any)[this.model.projectColumn] = In(
                    updateBy.props.userGlobalAccessPermission?.projectIds
                );
            }
        } else if (this.model.projectColumn) {
            throw new NotAuthorizedException(
                'Not enough permissions to read the record'
            );
        }

        if (this.model.userColumn && updateBy.props.userId) {
            (updateBy.query as any)[this.model.userColumn] =
                updateBy.props.userId;
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
                    (updateBy.query as any)[columnName] = (
                        this.model.isPermissionIf[permission] as any
                    )[columnName];
                }
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

        this.getPermissions(deleteBy.props, DatabaseRequestType.Delete);

        if (this.model.projectColumn && deleteBy.props.projectId) {
            (deleteBy.query as any)[this.model.projectColumn] =
                deleteBy.props.projectId;
        }

        if (this.model.userColumn) {
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
            getColumnAccessControlForAllColumns(this.model);

        const columns: Array<string> = [];

        for (const key in accessControl) {
            if (
                accessControl[key]?.create &&
                PermissionUtil.doesPermissionsIntersect(
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
            getColumnAccessControlForAllColumns(this.model);

        const columns: Array<string> = [];

        const permissions: Array<Permission> = userPermissions.map(
            (item: UserPermission) => {
                return item.permission;
            }
        );

        for (const key in accessControl) {
            if (
                accessControl[key]?.read &&
                PermissionUtil.doesPermissionsIntersect(
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
            getColumnAccessControlForAllColumns(this.model);

        const columns: Array<string> = [];

        const permissions: Array<Permission> = userPermissions.map(
            (item: UserPermission) => {
                return item.permission;
            }
        );

        for (const key in accessControl) {
            if (
                accessControl[key]?.update &&
                PermissionUtil.doesPermissionsIntersect(
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
                columns.hasColumn(key)
            ) {
                (this as any)[key] = undefined;
            }
        }

        return data;
    }

    public async countBy({
        query,
        skip,
        limit,
    }: CountBy<TBaseModel>): Promise<PositiveNumber> {
        try {
            if (!skip) {
                skip = new PositiveNumber(0);
            }

            if (!limit) {
                limit = new PositiveNumber(Infinity);
            }

            const count: number = await this.getRepository().count({
                where: query as any,
                skip: skip.toNumber(),
                take: limit.toNumber(),
            });
            let countPositive: PositiveNumber = new PositiveNumber(count);
            countPositive = await this.onCountSuccess(countPositive);
            return countPositive;
        } catch (error) {
            await this.onCountError(error as Exception);
            throw this.getException(error as Exception);
        }
    }

    public async deleteOneBy(
        deleteOneBy: DeleteOneBy<TBaseModel>
    ): Promise<number> {
        return await this._deleteBy(deleteOneBy);
    }

    public async deleteBy(deleteBy: DeleteBy<TBaseModel>): Promise<number> {
        return await this._deleteBy(deleteBy);
    }

    public async hardDeleteBy(
        hardDeleteBy: HardDeleteBy<TBaseModel>
    ): Promise<number> {
        return await this._hardDeleteBy(hardDeleteBy);
    }

    private async _hardDeleteBy(
        hardDeleteBy: HardDeleteBy<TBaseModel>
    ): Promise<number> {
        return (
            (await this.getRepository().delete(hardDeleteBy.query as any))
                .affected || 0
        );
    }

    private async _deleteBy(deleteBy: DeleteBy<TBaseModel>): Promise<number> {
        try {
            let beforeDeleteBy: DeleteBy<TBaseModel> =
                await this.onBeforeDelete(deleteBy);

            beforeDeleteBy = this.asDeleteByPermissions(beforeDeleteBy);

            await this._updateBy({
                query: deleteBy.query,
                data: {
                    deletedByUser: deleteBy.deletedByUser,
                } as any,
                props: deleteBy.props,
            });
            const numberOfDocsAffected: number =
                (
                    await this.getRepository().softDelete(
                        beforeDeleteBy.query as any
                    )
                ).affected || 0;

            await this.onDeleteSuccess();
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
            if (!findBy.sort) {
                findBy.sort = {
                    createdAt: SortOrder.Descending,
                };
            }

            let onBeforeFind: FindBy<TBaseModel> = await this.onBeforeFind(
                findBy
            );

            onBeforeFind = this.asFindByByPermissions(findBy);

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
                relations: onBeforeFind.populate,
            });

            const decryptedItems: Array<TBaseModel> = [];

            for (const item of items) {
                decryptedItems.push(this.decrypt(item));
            }

            await this.onFindSuccess(decryptedItems);

            return decryptedItems;
        } catch (error) {
            await this.onFindError(error as Exception);
            throw this.getException(error as Exception);
        }
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
        findOneById: FindOneByID
    ): Promise<TBaseModel | null> {
        return await this.findOneBy({
            query: {
                _id: findOneById.id.toString() as any,
            },
            props: findOneById.props,
        });
    }

    private async _updateBy(updateBy: UpdateBy<TBaseModel>): Promise<number> {
        try {
            let beforeUpdateBy: UpdateBy<TBaseModel> =
                await this.onBeforeUpdate(updateBy);

            beforeUpdateBy = this.asUpdateByByPermissions(beforeUpdateBy);

            const numberOfDocsAffected: number =
                (
                    await this.getRepository().update(
                        beforeUpdateBy.query as any,
                        beforeUpdateBy.data
                    )
                ).affected || 0;

            await this.onUpdateSuccess();

            return numberOfDocsAffected;
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
