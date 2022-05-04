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
import PostgresDatabase from '../Infrastructure/PostgresDatabase';
import { DataSource, Repository } from 'typeorm';
import SortOrder from '../Types/DB/SortOrder';
import HardDeleteBy from '../Types/DB/HardDeleteBy';

class DatabaseService<TBaseModel extends BaseModel> {
    public entityName!: string;

    public constructor(type: { new (): TBaseModel }) {
        this.entityName = type.name;
    }

    public getRepository(): Repository<TBaseModel> {
        const dataSource: DataSource | null = PostgresDatabase.getDataSource();
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
            if (!(data as any)[requiredField]) {
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

    public async create(createBy: CreateBy<TBaseModel>): Promise<TBaseModel> {
        const _createdBy: CreateBy<TBaseModel> = await this.onBeforeCreate({
            data: createBy.data,
        });

        let data: TBaseModel = _createdBy.data;

        this.checkRequiredFields(data);

        if (!this.isValid(data)) {
            throw new BadDataException('Data is not valid');
        }

        // Encrypt data
        data = this.encrypt(data);

        try {
            if (data.getSlugifyColumn()) {
                (data as any)[data.getSaveSlugToColumn() as string] =
                    Slug.getSlug(
                        (data as any)[
                            data.getSlugifyColumn() as string
                        ] as string
                    );
            }

            const savedData = await this.getRepository().save(data);
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

            this._updateBy({
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
