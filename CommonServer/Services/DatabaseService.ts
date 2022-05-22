import Slug from 'Common/Utils/Slug';
import FindOneBy from '../Types/DB/FindOneBy';
import UpdateOneBy from '../Types/DB/UpdateOneBy';
import CountBy from '../Types/DB/CountBy';
import DeleteOneBy from '../Types/DB/DeleteOneBy';
import SearchBy from '../Types/DB/SearchBy';
import DeleteBy from '../Types/DB/DeleteBy';
import PositiveNumber from 'Common/Types/PositiveNumber';
import FindBy from '../Types/DB/FindBy';
import UpdateBy from '../Types/DB/UpdateBy';
import Query from '../Types/DB/Query';
import CreateBy from '../Types/DB/CreateBy';
import BadDataException from 'Common/Types/Exception/BadDataException';
import DatabaseNotConnectedException from 'Common/Types/Exception/DatabaseNotConnectedException';
import Exception from 'Common/Types/Exception/Exception';
import SearchResult from '../Types/DB/SearchResult';
import Encryption from '../Utils/Encryption';
import { JSONObject } from 'Common/Types/JSON';
import BaseModel from 'Common/Models/BaseModel';
import PostgresDatabase, { PostgresAppInstance } from '../Infrastructure/PostgresDatabase';
import { DataSource, Repository } from 'typeorm';
import SortOrder from '../Types/DB/SortOrder';
import HardDeleteBy from '../Types/DB/HardDeleteBy';
import { EncryptionSecret } from '../Config';
import HashedString from 'Common/Types/HashedString';
import UpdateByID from '../Types/DB/UpdateByID';
import ObjectID from 'Common/Types/ObjectID';
import Role from 'Common/Types/Role';

class DatabaseService<TBaseModel extends BaseModel> {
    public entityName!: string;
    private postgresDatabase!: PostgresDatabase;

    public constructor(type: { new(): TBaseModel }, postgresDatabase?: PostgresDatabase) {
        this.entityName = type.name;
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

        const dataSource: DataSource | null = this.postgresDatabase ? this.postgresDatabase.getDataSource() :
            PostgresAppInstance.getDataSource();

        if (dataSource) {
            return dataSource.getRepository<TBaseModel>(this.entityName);
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
        for (const key of data.getHashedColumns().columns) {
            if (
                (data as any)[key] &&
                !((data as any)[key] as HashedString).isValueHashed
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
            if (typeof (data as any)[key] === 'object') {
                const dataObj: JSONObject = (data as any)[key];

                for (const key in dataObj) {
                    dataObj[key] = Encryption.decrypt(
                        dataObj[key] as string,
                        iv
                    );
                }

                (data as any)[key] = dataObj;
            } else {
                //If its string or other type.
                (data as any)[key] = Encryption.decrypt((data as any)[key], iv);
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
        createdItem: TBaseModel
    ): Promise<TBaseModel> {
        // A place holder method used for overriding.
        return Promise.resolve(createdItem);
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
        let _createdBy: CreateBy<TBaseModel> = await this.onBeforeCreate({
            data: createBy.data,
        });

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

        try {
            const savedData: TBaseModel = await this.getRepository().save(data);
            await this.onCreateSuccess(savedData);
            return savedData;
        } catch (error) {
            await this.onCreateError(error as Exception);
            throw this.getException(error as Exception);
        }
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

    public async deleteByRole(
        role: Role,
        deleteBy: DeleteBy<TBaseModel>
    ): Promise<number> {
        if (role === Role.Administrator) {
            return await this.deleteByForAdmin(deleteBy);
        }

        if (role === Role.Member) {
            return await this.deleteByForMember(deleteBy);
        }

        if (role === Role.Public) {
            return await this.deleteByForPublic(deleteBy);
        }

        if (role === Role.Viewer) {
            return await this.deleteByForViewer(deleteBy);
        }

        if (role === Role.Owner) {
            return await this.deleteByForOwner(deleteBy);
        }

        throw new BadDataException(`Invalid role - ${role}`);
    }

    public async updateByRole(
        role: Role,
        updateBy: UpdateBy<TBaseModel>
    ): Promise<void> {
        if (role === Role.Administrator) {
            await this.updateBy(updateBy);
        }

        if (role === Role.Member) {
            await this.updateBy(updateBy);
        }

        if (role === Role.Public) {
            await this.updateBy(updateBy);
        }

        if (role === Role.Viewer) {
            await this.updateBy(updateBy);
        }

        if (role === Role.Owner) {
            await this.updateBy(updateBy);
        }

        throw new BadDataException(`Invalid role - ${role}`);
    }

    public async createByRole(
        role: Role,
        createBy: CreateBy<TBaseModel>
    ): Promise<TBaseModel> {
        if (role === Role.Administrator) {
            return await this.create({
                data: BaseModel.asAdminCreateable<TBaseModel>(createBy.data),
            });
        }

        if (role === Role.Member) {
            return await this.create({
                data: BaseModel.asMemberCreateable<TBaseModel>(createBy.data),
            });
        }

        if (role === Role.Public) {
            return await this.create({
                data: BaseModel.asPublicCreateable<TBaseModel>(createBy.data),
            });
        }

        if (role === Role.Viewer) {
            return await this.create({
                data: BaseModel.asViewerCreateable<TBaseModel>(createBy.data),
            });
        }

        if (role === Role.Owner) {
            return await this.create({
                data: BaseModel.asOwnerCreateable<TBaseModel>(createBy.data),
            });
        }

        throw new BadDataException(`Invalid role - ${role}`);
    }

    public deleteByForOwner(
        deleteBy: DeleteBy<TBaseModel>
    ): PromiseLike<number> {
        return this.deleteBy(deleteBy);
    }
    public deleteByForViewer(
        deleteBy: DeleteBy<TBaseModel>
    ): PromiseLike<number> {
        return this.deleteBy(deleteBy);
    }
    public deleteByForPublic(
        deleteBy: DeleteBy<TBaseModel>
    ): PromiseLike<number> {
        return this.deleteBy(deleteBy);
    }
    public deleteByForMember(
        deleteBy: DeleteBy<TBaseModel>
    ): PromiseLike<number> {
        return this.deleteBy(deleteBy);
    }

    public deleteByForAdmin(
        deleteBy: DeleteBy<TBaseModel>
    ): PromiseLike<number> {
        return this.deleteBy(deleteBy);
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

    public async getListForViewer(
        findBy: FindBy<TBaseModel>
    ): Promise<Array<TBaseModel>> {
        return await this.findBy(findBy);
    }

    public async getListForAdmin(
        findBy: FindBy<TBaseModel>
    ): Promise<Array<TBaseModel>> {
        return await this.findBy(findBy);
    }

    public async getListForOwner(
        findBy: FindBy<TBaseModel>
    ): Promise<Array<TBaseModel>> {
        return await this.findBy(findBy);
    }

    public async getListForMember(
        findBy: FindBy<TBaseModel>
    ): Promise<Array<TBaseModel>> {
        return await this.findBy(findBy);
    }

    public async getListByRole(
        role: Role,
        findBy: FindBy<TBaseModel>
    ): Promise<Array<TBaseModel>> {
        if (role === Role.Administrator) {
            return await this.getListForAdmin(findBy);
        }

        if (role === Role.Member) {
            return await this.getListForMember(findBy);
        }

        if (role === Role.Public) {
            return await this.getListForPublic(findBy);
        }

        if (role === Role.Viewer) {
            return await this.getListForViewer(findBy);
        }

        if (role === Role.Owner) {
            return await this.getListForOwner(findBy);
        }

        throw new BadDataException(`Invalid role - ${role}`);
    }

    public async getListForPublic(
        findBy: FindBy<TBaseModel>
    ): Promise<Array<TBaseModel>> {
        return await this.findBy(findBy);
    }

    public async getItemForViewer(
        findOneBy: FindOneBy<TBaseModel>
    ): Promise<TBaseModel | null> {
        return await this.findOneBy(findOneBy);
    }

    public async getItemForAdmin(
        findOneBy: FindOneBy<TBaseModel>
    ): Promise<TBaseModel | null> {
        return await this.findOneBy(findOneBy);
    }

    public async getItemForMember(
        findOneBy: FindOneBy<TBaseModel>
    ): Promise<TBaseModel | null> {
        return await this.findOneBy(findOneBy);
    }

    public async getItemForOwner(
        findOneBy: FindOneBy<TBaseModel>
    ): Promise<TBaseModel | null> {
        return await this.findOneBy(findOneBy);
    }

    public async getItemForPublic(
        findOneBy: FindOneBy<TBaseModel>
    ): Promise<TBaseModel | null> {
        return await this.findOneBy(findOneBy);
    }

    public async getItemByRole(
        role: Role,
        findOneBy: FindOneBy<TBaseModel>
    ): Promise<TBaseModel | null> {
        if (role === Role.Administrator) {
            return await this.getItemForAdmin(findOneBy);
        }

        if (role === Role.Member) {
            return await this.getItemForMember(findOneBy);
        }

        if (role === Role.Public) {
            return await this.getItemForPublic(findOneBy);
        }

        if (role === Role.Viewer) {
            return await this.getItemForViewer(findOneBy);
        }

        if (role === Role.Owner) {
            return await this.getItemForOwner(findOneBy);
        }

        throw new BadDataException(`Invalid role - ${role}`);
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

    public async findOneById(id: ObjectID): Promise<TBaseModel | null> {
        return await this.findOneBy({
            query: {
                _id: id.toString() as any,
            },
        });
    }

    private async _updateBy({
        query,
        data,
    }: UpdateBy<TBaseModel>): Promise<number> {
        try {
            const beforeUpdateBy: UpdateBy<TBaseModel> =
                await this.onBeforeUpdate({
                    query,
                    data,
                });

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

    public async updateOneBy({
        query,
        data,
    }: UpdateOneBy<TBaseModel>): Promise<number> {
        return await this._updateBy({ query, data });
    }

    public async updateBy({
        query,
        data,
    }: UpdateBy<TBaseModel>): Promise<number> {
        return await this._updateBy({ query, data });
    }

    public async updateOneById(
        updateById: UpdateByID<TBaseModel>
    ): Promise<void> {
        await this.updateOneBy({
            query: {
                _id: updateById.id.toString() as any,
            },
            data: updateById.data,
        });
    }

    public async updateOneByIdAndFetch(
        updateById: UpdateByID<TBaseModel>
    ): Promise<TBaseModel | null> {
        await this.updateOneById(updateById);
        return this.findOneById(updateById.id);
    }

    public async searchBy({
        skip,
        limit,
        select,
        populate,
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
                }),
                this.countBy({
                    query,
                    skip: new PositiveNumber(0),
                    limit: new PositiveNumber(Infinity),
                }),
            ]);

        return { items, count };
    }
}

export default DatabaseService;
