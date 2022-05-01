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
import Exception from 'Common/Types/Exception/Exception';
import SearchResult from '../Types/DB/SearchResult';
import Encryption from '../Utils/Encryption';
import { JSONObject } from 'Common/Types/JSON';
import SortOrder from '../Types/DB/SortOrder';
import BaseModel from 'Common/Models/BaseModel';
import PostgresDatabase from '../Infrastructure/PostgresDatabase';
import { DataSource, Repository } from 'typeorm';

class DatabaseService<TBaseModel extends BaseModel> {

    public entityName!: string;

    public constructor(
        type: { new(): TBaseModel; },
    ) {
        this.entityName = type.name;
    }

    public getRepository(): Repository<TBaseModel> {
        const dataSource: DataSource = PostgresDatabase.getDataSource();
        return dataSource.getRepository<TBaseModel>(this.entityName);
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

    protected async onBeforeCreate({ data }: CreateBy<TBaseModel>): Promise<CreateBy<TBaseModel>> {
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
                (data as any)[key] = Encryption.encrypt((data as any)[key] as string, iv);
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

    protected async onBeforeDelete(deleteBy: DeleteBy<TBaseModel>): Promise<DeleteBy<TBaseModel>> {
        // A place holder method used for overriding.
        return Promise.resolve(deleteBy);
    }

    protected async onBeforeUpdate(updateBy: UpdateBy<TBaseModel>): Promise<UpdateBy<TBaseModel>> {
        // A place holder method used for overriding.
        return Promise.resolve(updateBy);
    }

    protected async onBeforeFind(findBy: FindBy<TBaseModel>): Promise<FindBy<TBaseModel>> {
        // A place holder method used for overriding.
        return Promise.resolve(findBy);
    }

    protected async onCreateSuccess(createdItem: TBaseModel): Promise<TBaseModel> {
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

            for (const key in data) {
                (data as any)(key, data[key]);
            }

            if (data.getSlugifyColumn()) {
                (data as any)['slug'] =
                    Slug.getSlug(
                        (data as any)[data.getSlugifyColumn() as string] as string
                    )
            }

            await this.onCreateSuccess(data);

            return await data.save();
        } catch (error) {
            await this.onCreateError(error as Exception);
            throw this.getException(error as Exception);
        }
    }

    public async countBy({ query, skip, limit }: CountBy<TBaseModel>): Promise<PositiveNumber> {
        try {
            const count: number = await this.getRepository().count({
                where: query,
                skip: skip.toNumber(),
                take: limit.toNumber()
            })
            let countPositive: PositiveNumber = new PositiveNumber(count);
            countPositive = await this.onCountSuccess(countPositive);
            return countPositive;
        } catch (error) {
            await this.onCountError(error as Exception);
            throw this.getException(error as Exception);
        }
    }

    public async deleteOneBy({
        query,
        deletedByUserId,
    }: DeleteOneBy<TBaseModel>): Promise<number> {
        return await this._deleteBy({
            query,
            deletedByUserId,
        });
    }

    public async deleteBy({ query, deletedByUserId }: DeleteBy<TBaseModel>): Promise<number> {
        return await this._deleteBy({
            query,
            deletedByUserId,
        });
    }

    public async hardDeleteBy(query: Query<TBaseModel>): Promise<number> {
        return await this._hardDeleteBy(query);
    }

    private async _hardDeleteBy(query: Query<TBaseModel>): Promise<number> {
        return (await this.getRepository().delete(query)).affected || 0;
    }

    private async _deleteBy({
        query,
        deletedByUserId,
    }: DeleteBy<TBaseModel>): Promise<number> {
        try {
            const beforeDeleteBy: DeleteBy<TBaseModel> = await this.onBeforeDelete({
                query,
                deletedByUserId,
            });

            let numberOfDocsAffected: number = (await this.getRepository().softDelete(beforeDeleteBy.query)).affected || 0;

            await this.onDeleteSuccess();
            return numberOfDocsAffected;
        } catch (error) {
            await this.onDeleteError(error as Exception);
            throw this.getException(error as Exception);
        }
    }

    public async getListForViewer({
        query,
        skip = new PositiveNumber(0),
        limit = new PositiveNumber(10),
        sort,
        populate,
        select
    }: FindBy<TBaseModel>): Promise<Array<TBaseModel>> {

        return await this.findBy({
            query,
            skip,
            limit,
            populate,
            select,
            sort,
        });
    }

    public async getListForAdmin({
        query,
        skip = new PositiveNumber(0),
        limit = new PositiveNumber(10),
        sort,
    }: FindBy<TBaseModel>): Promise<Array<TBaseModel>> {
        return await this.findBy({
            query,
            skip,
            limit,
            populate: this.adminListProps.populate,
            select: this.adminListProps.select,
            sort,
        });
    }

    public async getListForOwner({
        query,
        skip = new PositiveNumber(0),
        limit = new PositiveNumber(10),
        sort,
    }: FindBy<TBaseModel>): Promise<Array<TBaseModel>> {
        return await this.findBy({
            query,
            skip,
            limit,
            populate: this.ownerListProps.populate,
            select: this.ownerListProps.select,
            sort,
        });
    }

    public async getListForMember({
        query,
        skip = new PositiveNumber(0),
        limit = new PositiveNumber(10),
        sort,
    }: FindBy<TBaseModel>): Promise<Array<TBaseModel>> {
        return await this.findBy({
            query,
            skip,
            limit,
            populate: this.memberListProps.populate,
            select: this.memberListProps.select,
            sort,
        });
    }

    public async getListForPublic({
        query,
        skip = new PositiveNumber(0),
        limit = new PositiveNumber(10),
        sort,
    }: FindBy<TBaseModel>): Promise<Array<TBaseModel>> {
        return await this.findBy({
            query,
            skip,
            limit,
            populate: this.publicListProps.populate,
            select: this.publicListProps.select,
            sort,
        });
    }

    public async getItemForViewer({
        query,
        sort,
        populate,
        select
    }: FindOneBy<TBaseModel>): Promise<TBaseModel | null> {
        return await this.findOneBy({
            query,
            populate,
            select,
            sort,
        });
    }

    public async getItemForAdmin({
        query,
        sort,
        populate,
        select,
    }: FindOneBy<TBaseModel>): Promise<TBaseModel | null> {
        return await this.findOneBy({
            query,
            populate,
            select,
            sort,
        });
    }

    public async getItemForMember({
        query,
        sort,
        populate,
        select,
    }: FindOneBy<TBaseModel>): Promise<TBaseModel | null> {
        return await this.findOneBy({
            query,
            populate,
            select,
            sort,
        });
    }

    public async getItemForOwner({
        query,
        sort,
        populate,
        select,
    }: FindOneBy<TBaseModel>): Promise<TBaseModel | null> {
        return await this.findOneBy({
            query,
            populate,
            select,
            sort,
        });
    }

    public async getItemForPublic({
        query,
        sort,
        populate,
        select,
    }: FindOneBy<TBaseModel>): Promise<TBaseModel | null> {
        return await this.findOneBy({
            query,
            populate,
            select,
            sort,
        });
    }

    public async findBy({
        query,
        skip = new PositiveNumber(0),
        limit = new PositiveNumber(10),
        populate,
        select,
        sort,
    }: FindBy<TBaseModel>): Promise<Array<TBaseModel>> {
        return await this._findBy({
            query,
            skip,
            limit,
            populate,
            select,
            sort,
        });
    }

    private async _findBy({
        query,
        skip = new PositiveNumber(0),
        limit = new PositiveNumber(10),
        populate,
        select,
        sort,
    }: FindBy<TBaseModel>): Promise<Array<TBaseModel>> {
        try {
            const onBeforeFind: FindBy<TBaseModel> = await this.onBeforeFind({
                query,
                skip,
                limit,
                populate,
                select,
                sort,
            });

            if (!onBeforeFind.sort) {
                onBeforeFind.sort = [
                    {
                        createdAt: SortOrder.Descending,
                    },
                ];
            }

            //convert populate to dbpopulate

            const items: Array<TBaseModel> = await this.getRepository().find({
                skip: skip.toNumber(),
                take: limit.toNumber(),
                where: query,
                order: sort,
                relations: populate,
                select: select
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

    public async findOneBy({
        query,
        populate,
        select = {
            _id: true
        },
        sort = {
            createdAt: SortOrder.Ascending
        },
    }: FindOneBy<TBaseModel>): Promise<TBaseModel | null> {
        const documents: Array<TBaseModel> = await this._findBy({
            query,
            skip: new PositiveNumber(0),
            limit: new PositiveNumber(1),
            populate,
            select,
            sort
        });

        if (documents && documents[0]) {
            return documents[0];
        }
        return null;
    }

    private async _updateBy({
        query,
        data
    }: UpdateBy<TBaseModel>): Promise<number> {
        try {

            const beforeUpdateBy: UpdateBy<TBaseModel> = await this.onBeforeUpdate({
                query,
                data,
            });

            let numberOfDocsAffected: number = (await this.getRepository().update(beforeUpdateBy.query, beforeUpdateBy.data)).affected || 0;

            await this.onUpdateSuccess();

            return numberOfDocsAffected;
        } catch (error) {
            await this.onUpdateError(error as Exception);
            throw this.getException(error as Exception);
        }
    }

    public async updateOneBy({ query, data }: UpdateOneBy<TBaseModel>): Promise<number> {
        return await this._updateBy({ query, data });
    }

    public async updateBy({ query, data }: UpdateBy<TBaseModel>): Promise<number> {
        return await this._updateBy({ query, data });
    }

    public async searchBy({
        skip,
        limit,
        select,
        populate,
    }: SearchBy<TBaseModel>): Promise<SearchResult<TBaseModel>> {
        const query: Query<TBaseModel> = {

        }

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
                this.countBy({ query, skip: new PositiveNumber(0), limit: new PositiveNumber(Infinity) }),
            ]);

        return { items, count };
    }
}

export default DatabaseService;
