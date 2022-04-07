import Slug from 'common/utils/Slug';
import Populate from '../types/db/Populate';
import Select from '../types/db/Select';
import { Model } from '../utils/ORM';
import { RequiredFields, UniqueFields, Document } from '../utils/ORM';
import FindOneBy from '../types/db/FindOneBy';
import UpdateOneBy from '../types/db/UpdateOneBy';
import CountBy from '../types/db/CountBy';
import DeleteOneBy from '../types/db/DeleteOneBy';
import SearchBy from '../types/db/SearchBy';
import DeleteBy from '../types/db/DeleteBy';
import PositiveNumber from 'common/types/PositiveNumber';
import FindBy from '../types/db/FindBy';
import UpdateBy from '../types/db/UpdateBy';
import Query from '../types/db/Query';
import CreateBy from '../types/db/CreateBy';
import BadDataException from 'common/types/exception/BadDataException';
import OneUptimeDate from 'common/types/Date';
import Exception from 'common/types/exception/Exception';
import SearchResult from '../types/db/SearchResult';

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
    }

    protected isValid(data: Document): boolean {
        if (!data) {
            throw new BadDataException('Data cannot be null');
        }

        return true;
    }

    protected checkRequiredFields(data: Document) {
        // check required fields.
        for (const requiredField of this.requiredFields) {
            if (!data.get(requiredField)) {
                throw new BadDataException(`${requiredField} is required`);
            }
        }
    }

    protected async onCreateSuccess() {
        // a place holder method used for overriding.
        return Promise.resolve();
    }

    protected async onCreateError() {
        // a place holder method used for overriding.
        return Promise.resolve();
    }

    protected async onUpdateSuccess() {
        // a place holder method used for overriding.
        return Promise.resolve();
    }

    protected async onUpdateError() {
        // a place holder method used for overriding.
        return Promise.resolve();
    }

    protected async onDeleteSuccess() {
        // a place holder method used for overriding.
        return Promise.resolve();
    }

    protected async onDeleteError() {
        // a place holder method used for overriding.
        return Promise.resolve();
    }

    protected async onFindSuccess() {
        // a place holder method used for overriding.
        return Promise.resolve();
    }

    protected async onFindError() {
        // a place holder method used for overriding.
        return Promise.resolve();
    }

    protected async onCountSuccess() {
        // a place holder method used for overriding.
        return Promise.resolve();
    }

    protected async onCountError() {
        // a place holder method used for overriding.
        return Promise.resolve();
    }

    protected async getException(error: Exception) {
        throw error;
    }

    public async create({ data }: CreateBy) {
        this.checkRequiredFields(data);

        if (!this.isValid(data)) {
            throw new BadDataException('Data is not valid');
        }

        try {
            const item = new this.model();

            if (this.uniqueFields && this.uniqueFields.length > 0) {
                const countQuery: Query = {};

                if (this.isResourceByProject) {
                    countQuery['projectId'] = data.get('projectId');
                }

                for (const duplicateValueIn of this.uniqueFields) {
                    countQuery[duplicateValueIn] = data.get(duplicateValueIn);
                }

                const existingItemCount = await this.countBy({
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

            await this.onCreateSuccess();

            return await item.save();
        } catch (error) {
            await this.onCreateError();
            throw this.getException(error as Exception);
        }
    }

    public async countBy({ query = {} }: CountBy): Promise<PositiveNumber> {
        try {
            query.deleted = false;
            const count = await this.model.countDocuments(query);
            await this.onCountSuccess();
            return new PositiveNumber(count);
        } catch (error) {
            await this.onCountError();
            throw this.getException(error as Exception);
        }
    }

    public async deleteOneBy({ query = {}, deletedByUserId }: DeleteOneBy) {
        return await this._deleteBy({
            query,
            multiple: false,
            deletedByUserId,
        });
    }

    public async deleteBy({ query = {}, deletedByUserId }: DeleteBy) {
        return await this._deleteBy({
            query,
            multiple: false,
            deletedByUserId,
        });
    }

    public async hardDeleteBy(query: Query) {
        return await this._hardDeleteBy(query);
    }

    private async _hardDeleteBy(query: Query) {
        return await this.model.remove(query);
    }

    private async _deleteBy({
        query = {},
        multiple = false,
        deletedByUserId,
    }: InternalDeleteBy) {
        try {
            query.deleted = false;

            const item = new this.model();
            item.set('deleted', true);
            item.set('deletedById', deletedByUserId);
            item.set('deletedAt', OneUptimeDate.getCurrentDate());

            if (multiple) {
                await this.updateBy({ query, data: item });
            } else {
                await this.updateOneBy({ query, data: item });
            }

            await this.onDeleteSuccess();
        } catch (error) {
            await this.onDeleteError();
            throw this.getException(error as Exception);
        }
    }

    public async getListForViewer({
        query = {},
        skip = new PositiveNumber(0),
        limit = new PositiveNumber(10),
        sort,
    }: FindBy) {
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
    }: FindBy) {
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
    }: FindBy) {
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
    }: FindBy) {
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
    }: FindBy) {
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
            query.deleted = false;

            let dbQuery = null;

            if (!multiple) {
                dbQuery = this.model.findOne(query);
            } else {
                dbQuery = this.model.find(query);
            }

            dbQuery
                .sort(sort)
                .limit(limit.toNumber())
                .skip(skip.toNumber())
                .lean();

            dbQuery.select(select);
            dbQuery.populate(populate);

            const items = await dbQuery;
            await this.onFindSuccess();
            return items as Array<Document>;
        } catch (error) {
            await this.onFindError();
            throw this.getException(error as Exception);
        }
    }

    public async findOneBy({
        query = {},
        populate,
        select,
        sort = [],
    }: FindOneBy): Promise<Document | null> {
        const documents = await this._findBy({
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
    }: InternalUpdateBy) {
        try {
            if (!query) {
                query = {};
            }

            if (!query['deleted']) query['deleted'] = false;

            // check required fields.
            for (const requiredField of this.requiredFields) {
                if (data.get(requiredField) === null) {
                    throw new BadDataException(`${requiredField} is required.`);
                }
            }

            if (multiple) {
                await this.model.updateMany(query, {
                    $set: data,
                });
            } else {
                await this.model.updateOne(query, {
                    $set: data,
                });
            }
            await this.onUpdateSuccess();
        } catch (error) {
            await this.onUpdateError();
            throw this.getException(error as Exception);
        }
    }

    public async updateOneBy({ query, data }: UpdateOneBy) {
        return await this._updateBy({ query, data, multiple: false });
    }

    public async updateBy({ query, data }: UpdateBy) {
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

        const [items, count] = await Promise.all([
            this.findBy({ query, skip, limit, select, populate, sort: null }),
            this.countBy({ query }),
        ]);

        return { items, count };
    }
}

export default DatabaseService;
