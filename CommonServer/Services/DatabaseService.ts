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
import { DataSource, Repository } from 'typeorm';
import SortOrder from '../Types/Database/SortOrder';
import HardDeleteBy from '../Types/Database/HardDeleteBy';
import { EncryptionSecret } from '../Config';
import HashedString from 'Common/Types/HashedString';
import UpdateByID from '../Types/Database/UpdateByID';
import Columns from 'Common/Types/Database/Columns';
import FindOneByID from '../Types/Database/FindOneByID';
import Permission, { PermissionUtil } from 'Common/Types/Permission';
import DatabaseCommonInteractionProps from 'Common/Types/Database/DatabaseCommonInteractionProps';
import BadRequestException from 'Common/Types/Exception/BadRequestException';
import AccessControl from 'Common/Types/Database/AccessControl/AccessControl';
import Dictionary from 'Common/Types/Dictionary';
import {
    getColumnAccessControlForAllColumns,
} from 'Common/Types/Database/AccessControl/ColumnAccessControl';
import NotAuthorizedException from 'Common/Types/Exception/NotAuthorizedException';
import Select from '../Types/Database/Select';
import ProjectColumn from 'Common/Types/Database/ProjectColumn';

enum QueryType {
    Read = "read",
    Update = "update",
    Delete = "delete"
}

class DatabaseService<TBaseModel extends BaseModel> {
    private postgresDatabase!: PostgresDatabase;
    private entityType!: { new(): TBaseModel };
    private model!: TBaseModel;

    public constructor(
        type: { new(): TBaseModel },
        postgresDatabase?: PostgresDatabase
    ) {
        this.entityType = type;
        this.model = new type();

        if (postgresDatabase) {
            this.postgresDatabase = postgresDatabase;
        }
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

        data = this.asCreateableByPermissions(
            createBy
        );

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

    public asCreateableByPermissions(
        createBy: CreateBy<TBaseModel>
    ): TBaseModel {

        // If system is making this query then let the query run!
        if (createBy.isRoot) {
            return createBy.data;
        }

        if (
            !PermissionUtil.doesPermissionsIntersect(
                createBy.userPermissions || [],
                createBy.data.createRecordPermissions
            )
        ) {
            throw new NotAuthorizedException(
                'A user does not have permissions to create record.'
            );
        }

        const data: TBaseModel = this.keepColumns(
            this.getCreateableColumnsByPermissions(createBy.userPermissions || []), createBy.data
        );

        return data;
    }

    public asFindByByPermissions(
        findBy: FindBy<TBaseModel>
    ): FindBy<TBaseModel> {

        if (findBy.isRoot) {
            return findBy;
        }

        let tablePermissions: Array<Permission> = [];
        let columns: Columns = new Columns([]);


        tablePermissions = this.model.readRecordPermissions;


        if (
            !PermissionUtil.doesPermissionsIntersect(
                findBy.userPermissions || [],
                tablePermissions
            )
        ) {
            throw new NotAuthorizedException(
                `A user does not have permissions to read record.`
            );
        }

       
        columns = this.getReadColumnsByPermissions(findBy.userPermissions || []);

        // Now we need to check all columns. 

        
        for (const key in findBy.query) {
            
            if (!columns.columns.includes(key)) {
                delete findBy.query[key];
            }
        }

        for (const key in findBy.select) {
            
            if (!columns.columns.includes(key)) {
                delete findBy.select[key];
            }
        }

        if (Permission.AnyMember && this.model.projectColumn) {
            (findBy.query as any)[this.model.projectColumn] = findBy.projectId;
        }

        if (Permission.CurrentUser && this.model.userColumn) {
            (findBy.query as any)[this.model.userColumn] = findBy.userId;
        }

        return findBy;

    }

    public asUpdateByByPermissions(
        updateBy: UpdateBy<TBaseModel>
    ): UpdateBy<TBaseModel> {

        if (updateBy.isRoot) {
            return updateBy;
        }

        let tablePermissions: Array<Permission> = [];
        let updateColumns: Columns = new Columns([]);
        let readColumns: Columns = new Columns([]);


        tablePermissions = this.model.updateRecordPermissions;


        if (
            !PermissionUtil.doesPermissionsIntersect(
                updateBy.userPermissions || [],
                tablePermissions
            )
        ) {
            throw new NotAuthorizedException(
                `A user does not have permissions to update record.`
            );
        }

       
        updateColumns = this.getUpdateColumnsByPermissions(updateBy.userPermissions || []);
        readColumns = this.getReadColumnsByPermissions(updateBy.userPermissions || []);

        // Now we need to check all columns. 

        
        for (const key in updateBy.query) {
            
            if (!readColumns.columns.includes(key)) {
                delete updateBy.query[key];
            }
        }

        for (const key in updateBy.data) {
            
            if (!updateColumns.columns.includes(key)) {
                delete updateBy.data[key];
            }
        }

        if (Permission.AnyMember && this.model.projectColumn) {
            (updateBy.query as any)[this.model.projectColumn] = updateBy.projectId;
        }

        if (Permission.CurrentUser && this.model.userColumn) {
            (updateBy.query as any)[this.model.userColumn] = updateBy.userId;
        }

        return updateBy;

    }

    public asDeleteByPermissions(
        deleteBy: DeleteBy<TBaseModel>
    ): DeleteBy<TBaseModel> {

        if (deleteBy.isRoot) {
            return deleteBy;
        }

        let tablePermissions: Array<Permission> = [];

        tablePermissions = this.model.deleteRecordPermissions;

        if (
            !PermissionUtil.doesPermissionsIntersect(
                deleteBy.userPermissions || [],
                tablePermissions
            )
        ) {
            throw new NotAuthorizedException(
                `A user does not have permissions to delete record.`
            );
        }

        if (Permission.AnyMember && this.model.projectColumn) {
            (deleteBy.query as any)[this.model.projectColumn] = deleteBy.projectId;
        }

        if (Permission.CurrentUser && this.model.userColumn) {
            (deleteBy.query as any)[this.model.userColumn] = deleteBy.userId;
        }

        return deleteBy;

    }

    public getCreateableColumnsByPermissions(
        permissions: Array<Permission>
    ): Columns {
        const accessControl: Dictionary<AccessControl> =
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
        permissions: Array<Permission>
    ): Columns {
        const accessControl: Dictionary<AccessControl> =
            getColumnAccessControlForAllColumns(this.model);

        const columns: Array<string> = [];

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
        permissions: Array<Permission>
    ): Columns {
        const accessControl: Dictionary<AccessControl> =
            getColumnAccessControlForAllColumns(this.model);

        const columns: Array<string> = [];

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
            const beforeDeleteBy: DeleteBy<TBaseModel> =
                await this.onBeforeDelete(deleteBy);

            await this._updateBy({
                query: deleteBy.query,
                data: {
                    deletedByUser: deleteBy.deletedByUser,
                } as any,
                userPermissions: deleteBy.userPermissions || [],
                userId: deleteBy.userId,
                userType: deleteBy.userType,
                projectId: deleteBy.projectId,
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

            const onBeforeFind: FindBy<TBaseModel> = await this.onBeforeFind(
                findBy
            );

            const items: Array<TBaseModel> = await this.getRepository().find({
                skip: onBeforeFind.skip.toNumber(),
                take: onBeforeFind.limit.toNumber(),
                where: onBeforeFind.query as any,
                order: onBeforeFind.sort as any,
                relations: onBeforeFind.populate as any,
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
            userPermissions: findOneById.userPermissions || [],
            userId: findOneById.userId,
            userType: findOneById.userType,
            projectId: findOneById.projectId,
        });
    }

    private async _updateBy(updateBy: UpdateBy<TBaseModel>): Promise<number> {
        try {
            const beforeUpdateBy: UpdateBy<TBaseModel> =
                await this.onBeforeUpdate(updateBy);

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
            userPermissions: updateById.userPermissions || [],
            userId: updateById.userId,
            userType: updateById.userType,
            projectId: updateById.projectId,
        });
    }

    public async updateOneByIdAndFetch(
        updateById: UpdateByID<TBaseModel>
    ): Promise<TBaseModel | null> {
        await this.updateOneById(updateById);
        return this.findOneById({
            id: updateById.id,
            userPermissions: updateById.userPermissions || [],
            userId: updateById.userId,
            userType: updateById.userType,
            projectId: updateById.projectId,
        });
    }

    public async searchBy({
        skip,
        limit,
        select,
        populate,
        userPermissions,
        userId,
        userType,
        projectId,
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
                    userPermissions: userPermissions || [],
                    userId,
                    userType,
                    projectId,
                }),
                this.countBy({
                    query,
                    skip: new PositiveNumber(0),
                    limit: new PositiveNumber(Infinity),
                    userPermissions: userPermissions || [],
                    userId,
                    userType,
                    projectId,
                }),
            ]);

        return { items, count };
    }
}

export default DatabaseService;
