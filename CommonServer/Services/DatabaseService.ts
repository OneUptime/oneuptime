import Slug from 'Common/utils/Slug';
import Populate from '../Types/DB/Populate';
import Select from '../Types/DB/Select';
import { EncryptedFields, Model } from '../Infrastructure/ORM';
import { RequiredFields, UniqueFields, Document } from '../Infrastructure/ORM';
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
import OneUptimeDate from 'Common/Types/Date';
import Exception from 'Common/Types/Exception/Exception';
import SearchResult from '../Types/DB/SearchResult';
import Encryption from '../Utils/Encryption';

export interface ListProps {
    populate: Populate;
    select: Select;
}

export interface ItemProps {
    populate: Populate;
    select: Select;
}

interface InternalDeleteBy extends DeleteBy {
    multiple: boolean;
}

interface InternalFindBy extends FindBy {
    multiple: boolean;
}

interface InternalUpdateBy extends UpdateBy {
    multiple: boolean;
}

class DatabaseService<ModelType> {
    public adminItemProps: ItemProps;
    public adminListProps: ListProps;
    public ownerItemProps: ItemProps;
    public ownerListProps: ListProps;
    public friendlyName: string;
    public memberItemProps: ItemProps;
    public memberListProps: ListProps;
    public model: Model<ModelType>;
    public publicItemProps: ItemProps;
    public publicListProps: ListProps;
    public requiredFields: RequiredFields;
    public uniqueFields: UniqueFields;
    public encryptedFields: EncryptedFields;
    public viewerItemProps: ItemProps;
    public viewerListProps: ListProps;
    public isResourceByProject: boolean;
    public slugifyField: string;

    constructor({
        model,
        requiredFields,
        uniqueFields,
        friendlyName = '',
        publicListProps,
        adminListProps,
        memberListProps,
        viewerListProps,
        publicItemProps,
        adminItemProps,
        ownerItemProps,
        ownerListProps,
        memberItemProps,
        viewerItemProps,
        isResourceByProject = true,
        slugifyField = '',
        encryptedFields,
    }: {
        uniqueFields: UniqueFields;
        adminItemProps: ItemProps;
        adminListProps: ListProps;
        friendlyName: string;
        memberItemProps: ItemProps;
        memberListProps: ListProps;
        model: Model<ModelType>;
        publicItemProps: ItemProps;
        publicListProps: ListProps;
        requiredFields: RequiredFields;
        viewerItemProps: ItemProps;
        viewerListProps: ListProps;
        ownerItemProps: ItemProps;
        ownerListProps: ListProps;
        isResourceByProject: boolean;
        slugifyField: string;
        encryptedFields: EncryptedFields;
    }) {
        this.model = model;
        this.friendlyName = friendlyName;
        this.requiredFields = requiredFields;
        this.publicListProps = publicListProps;
        this.adminListProps = adminListProps;
        this.memberItemProps = memberItemProps;
        this.memberListProps = memberListProps;
        this.adminItemProps = adminItemProps;
        this.viewerListProps = viewerListProps;
        this.publicItemProps = publicItemProps;
        this.viewerItemProps = viewerItemProps;
        this.isResourceByProject = isResourceByProject;
        this.uniqueFields = uniqueFields;
        this.slugifyField = slugifyField;
        this.ownerItemProps = ownerItemProps;
        this.ownerListProps = ownerListProps;
        this.encryptedFields = encryptedFields;
    }

    protected isValid(data: Document): boolean {
        if (!data) {
            throw new BadDataException('Data cannot be null');
        }

        return true;
    }

    protected checkRequiredFields(data: Document): Promise<void> {
        // check required fields.
        for (const requiredField of this.requiredFields) {
            if (!data.get(requiredField)) {
                throw new BadDataException(`${requiredField} is required`);
            }
        }
    }

    protected async onBeforeCreate({ data }: CreateBy): Promise<CreateBy> {
        // a place holder method used for overriding.
        return Promise.resolve({ data } as CreateBy);
    }

    protected encrypt(data: Document): Document {
        const iv: Buffer = Encryption.getIV();
        data.set('iv', iv);

        for (const key of this.encryptedFields) {
            // if data is an object.
            if (typeof data.get(key) === 'object') {
                const dataObj: $TSFixMe = data.get(key);

                for (const key in dataObj) {
                    dataObj[key] = Encryption.encrypt(dataObj[key], iv);
                }

                data.set(key, dataObj);
            } else {
                //if its string or other type.
                data.set(key, Encryption.encrypt(data.get(key), iv));
            }
        }

        return data;
    }

    protected decrypt(data: Document): Document {
        const iv: Buffer = data.get('iv');

        for (const key of this.encryptedFields) {
            // if data is an object.
            if (typeof data.get(key) === 'object') {
                const dataObj: $TSFixMe = data.get(key);

                for (const key in dataObj) {
                    dataObj[key] = Encryption.decrypt(dataObj[key], iv);
                }

                data.set(key, dataObj);
            } else {
                //if its string or other type.
                data.set(key, Encryption.decrypt(data.get(key), iv));
            }
        }

        return data;
    }

    protected async onBeforeDelete(deleteBy: DeleteBy): Promise<DeleteBy> {
        // a place holder method used for overriding.
        return Promise.resolve(deleteBy);
    }

    protected async onBeforeUpdate(updateBy: UpdateBy): Promise<UpdateBy> {
        // a place holder method used for overriding.
        return Promise.resolve(updateBy);
    }

    protected async onBeforeFind(findBy: FindBy): Promise<FindBy> {
        // a place holder method used for overriding.
        return Promise.resolve(findBy);
    }

    protected async onCreateSuccess(createdItem: Document): Promise<Document> {
        // a place holder method used for overriding.
        return Promise.resolve(createdItem);
    }

    protected async onCreateError(error: Exception): Promise<Exception> {
        // a place holder method used for overriding.
        return Promise.resolve(error);
    }

    protected async onUpdateSuccess(): Promise<void> {
        // a place holder method used for overriding.
        return Promise.resolve();
    }

    protected async onUpdateError(error: Exception): Promise<Exception> {
        // a place holder method used for overriding.
        return Promise.resolve(error);
    }

    protected async onDeleteSuccess(): Promise<void> {
        // a place holder method used for overriding.
        return Promise.resolve();
    }

    protected async onDeleteError(error: Exception): Promise<Exception> {
        // a place holder method used for overriding.
        return Promise.resolve(error);
    }

    protected async onFindSuccess(
        items: Array<Document>
    ): Promise<Array<Document>> {
        // a place holder method used for overriding.
        return Promise.resolve(items);
    }

    protected async onFindError(error: Exception): Promise<Exception> {
        // a place holder method used for overriding.
        return Promise.resolve(error);
    }

    protected async onCountSuccess(
        count: PositiveNumber
    ): Promise<PositiveNumber> {
        // a place holder method used for overriding.
        return Promise.resolve(count);
    }

    protected async onCountError(error: Exception): Promise<Exception> {
        // a place holder method used for overriding.
        return Promise.resolve(error);
    }

    protected async getException(error: Exception): Promise<void> {
        throw error;
    }

    public async create(createBy: CreateBy): Promise<Document> {
        const _createdBy: $TSFixMe = await this.onBeforeCreate({ data: createBy.data });

        let data = _createdBy.data;

        this.checkRequiredFields(data);

        if (!this.isValid(data)) {
            throw new BadDataException('Data is not valid');
        }

        // Encrypt data
        data = this.encrypt(data);

        try {
            const item: $TSFixMe = new this.model();

            if (this.uniqueFields && this.uniqueFields.length > 0) {
                const countQuery: Query = {};

                if (this.isResourceByProject) {
                    countQuery['projectId'] = data.get('projectId');
                }

                for (const duplicateValueIn of this.uniqueFields) {
                    countQuery[duplicateValueIn] = data.get(duplicateValueIn);
                }

                const existingItemCount: $TSFixMe = await this.countBy({
                    query: countQuery,
                });

                if (existingItemCount.toNumber() > 0) {
                    throw new BadDataException(
                        `${
                            this.friendlyName || `Item`
                        } with the same ${this.uniqueFields.join(
                            ','
                        )} already exists.`
                    );
                }
            }

            for (const key in data) {
                item.set(key, data.get(key));
            }

            if (this.slugifyField) {
                item.set('slug', Slug.getSlug(data.get(this.slugifyField)));
            }

            await this.onCreateSuccess(item);

            return await item.save();
        } catch (error) {
            await this.onCreateError(error as Exception);
            throw this.getException(error as Exception);
        }
    }

    public async countBy({ query = {} }: CountBy): Promise<PositiveNumber> {
        try {
            query['deleted'] = false;
            const count: $TSFixMe = await this.model.countDocuments(query);
            let countPositive = new PositiveNumber(count);
            countPositive = await this.onCountSuccess(countPositive);
            return countPositive;
        } catch (error) {
            await this.onCountError(error as Exception);
            throw this.getException(error as Exception);
        }
    }

    public async deleteOneBy({
        query = {},
        deletedByUserId,
    }: DeleteOneBy): Promise<void> {
        return await this._deleteBy({
            query,
            multiple: false,
            deletedByUserId,
        });
    }

    public async deleteBy({
        query = {},
        deletedByUserId,
    }: DeleteBy): Promise<void> {
        return await this._deleteBy({
            query,
            multiple: false,
            deletedByUserId,
        });
    }

    private async _hardDeleteBy(query: Query): Promise<void> {
        await this.model.remove(query);
    }

    private async _deleteBy({
        query = {},
        multiple = false,
        deletedByUserId,
    }: InternalDeleteBy): Promise<void> {
        try {
            const beforeDeleteBy: $TSFixMe = await this.onBeforeDelete({
                query,
                deletedByUserId,
            });

            query['deleted'] = false;

            const item: $TSFixMe = new this.model();
            item.set('deleted', true);
            item.set('deletedById', beforeDeleteBy.deletedByUserId);
            item.set('deletedAt', OneUptimeDate.getCurrentDate());

            if (multiple) {
                await this.updateBy({
                    query: beforeDeleteBy.query,
                    data: item,
                });
            } else {
                await this.updateOneBy({
                    query: beforeDeleteBy.query,
                    data: item,
                });
            }

            await this.onDeleteSuccess();
        } catch (error) {
            await this.onDeleteError(error as Exception);
            throw this.getException(error as Exception);
        }
    }

    public async getListForViewer({
        query = {},
        skip = new PositiveNumber(0),
        limit = new PositiveNumber(10),
        sort,
    }: FindBy): Array<Document> {
        return await this.findBy({
            query,
            skip,
            limit,
            populate: this.viewerListProps.populate,
            select: this.viewerListProps.select,
            sort,
        });
    }

    public async getListForAdmin({
        query = {},
        skip = new PositiveNumber(0),
        limit = new PositiveNumber(10),
        sort,
    }: FindBy): Array<Document> {
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
        query = {},
        skip = new PositiveNumber(0),
        limit = new PositiveNumber(10),
        sort,
    }: FindBy): Array<Document> {
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
        query = {},
        skip = new PositiveNumber(0),
        limit = new PositiveNumber(10),
        sort,
    }: FindBy): Array<Document> {
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
        query = {},
        skip = new PositiveNumber(0),
        limit = new PositiveNumber(10),
        sort,
    }: FindBy): Array<Document> {
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
        query = {},
        sort,
    }: FindOneBy): Promise<Document | null> {
        return await this.findOneBy({
            query,
            populate: this.viewerItemProps.populate,
            select: this.viewerItemProps.select,
            sort,
        });
    }

    public async getItemForAdmin({
        query = {},
        sort,
    }: FindOneBy): Promise<Document | null> {
        return await this.findOneBy({
            query,
            populate: this.adminItemProps.populate,
            select: this.adminItemProps.select,
            sort,
        });
    }

    public async getItemForMember({
        query = {},
        sort,
    }: FindOneBy): Promise<Document | null> {
        return await this.findOneBy({
            query,
            populate: this.memberItemProps.populate,
            select: this.memberItemProps.select,
            sort,
        });
    }

    public async getItemForOwner({
        query = {},
        sort,
    }: FindOneBy): Promise<Document | null> {
        return await this.findOneBy({
            query,
            populate: this.ownerItemProps.populate,
            select: this.ownerItemProps.select,
            sort,
        });
    }

    public async getItemForPublic({
        query = {},
        sort,
    }: FindOneBy): Promise<Document | null> {
        return await this.findOneBy({
            query,
            populate: this.publicItemProps.populate,
            select: this.publicItemProps.select,
            sort,
        });
    }

    public async findBy({
        query = {},
        skip = new PositiveNumber(0),
        limit = new PositiveNumber(10),
        populate,
        select,
        sort,
    }: FindBy): Promise<Array<Document>> {
        return await this._findBy({
            query,
            skip,
            limit,
            populate,
            select,
            sort,
            multiple: true,
        });
    }

    private async _findBy({
        query = {},
        skip = new PositiveNumber(0),
        limit = new PositiveNumber(10),
        populate,
        select,
        sort,
        multiple = false,
    }: InternalFindBy): Promise<Array<Document>> {
        try {
            const onBeforeFind: $TSFixMe = await this.onBeforeFind({
                query,
                skip,
                limit,
                populate,
                select,
                sort,
            });

            query['deleted'] = false;

            let dbQuery = null;

            if (!multiple) {
                dbQuery = this.model.findOne(onBeforeFind.query);
            } else {
                dbQuery = this.model.find(onBeforeFind.query);
            }

            dbQuery
                .sort(onBeforeFind.sort)
                .limit(onBeforeFind.limit.toNumber())
                .skip(onBeforeFind.skip.toNumber())
                .lean();

            dbQuery.select(onBeforeFind.select);
            dbQuery.populate(onBeforeFind.populate);

            const items: Function = (await dbQuery) as Array<Document>;

            const decryptedItems: $TSFixMe = [];

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
        query = {},
        populate = [],
        select = ['_id'],
        sort = [],
    }: FindOneBy): Promise<Document | null> {
        const documents: $TSFixMe = await this._findBy({
            query,
            skip: new PositiveNumber(0),
            limit: new PositiveNumber(1),
            populate,
            select,
            sort,
            multiple: false,
        });

        if (documents && documents[0]) {
            return documents[0];
        } else {
            return null;
        }
    }

    private async _updateBy({
        query,
        data,
        multiple = true,
    }: InternalUpdateBy): Promise<void> {
        try {
            if (!query['deleted']) {
                query['deleted'] = false;
            }

            const beforeUpdateBy: $TSFixMe = await this.onBeforeUpdate({
                query,
                data,
            });

            // check required fields.
            for (const requiredField of this.requiredFields) {
                if (beforeUpdateBy.data.get(requiredField) === null) {
                    throw new BadDataException(`${requiredField} is required.`);
                }
            }

            if (multiple) {
                await this.model.updateMany(beforeUpdateBy.query, {
                    $set: beforeUpdateBy.data,
                });
            } else {
                await this.model.updateOne(beforeUpdateBy.query, {
                    $set: beforeUpdateBy.data,
                });
            }

            await this.onUpdateSuccess();
        } catch (error) {
            await this.onUpdateError(error as Exception);
            throw this.getException(error as Exception);
        }
    }

    public async updateOneBy({ query, data }: UpdateOneBy): Promise<void> {
        return await this._updateBy({ query, data, multiple: false });
    }

    public async updateBy({ query, data }: UpdateBy): Promise<void> {
        return await this._updateBy({ query, data, multiple: true });
    }

    public async searchBy({
        column,
        text,
        skip,
        limit,
        select,
        populate,
    }: SearchBy): Promise<SearchResult> {
        const query: Query = {
            [column]: { $regex: new RegExp(text), $options: 'i' },
        };

        const [items, count]: $TSFixMe = await Promise.all([
            this.findBy({ query, skip, limit, select, populate }),
            this.countBy({ query }),
        ]);

        return { items, count };
    }
}

export default DatabaseService;
