const handleSelect = require('../utils/select');
const handlePopulate = require('../utils/populate');
const getSlug = require('../utils/getSlug');

class ServiceBase {

    constructor({
        model,
        requiredFields,
        friendlyName = '',
        publicListProps,
        adminListProps,
        memberListProps,
        viewerListProps,
        publicItemProps,
        adminItemProps,
        memberItemProps,
        viewerItemProps,
    }) {
        if (!model) {
            throw new Error('model is required');
        }

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



    }

    async create({
        data = {},
        checkDuplicates: { valuesIn = [], byProject = true },
        slugifyField = '', // which field to slugify
    }) {
        const item = new this.model();

        if (valuesIn && valuesIn.length > 0) {
            const countQuery = {};

            if (byProject) {
                countQuery.projectId = data.projectId;
            }

            if (typeof valuesIn === 'string') {
                valuesIn = [valuesIn];
            }

            for (const duplicateValueIn of valuesIn) {
                countQuery[duplicateValueIn] = data[duplicateValueIn];
            }

            const existingItemCount = await this.countBy({
                query: countQuery,
            });

            if (existingItemCount > 0) {
                const error = new Error(
                    `${this.friendlyName ||
                    `Item`} with the same ${valuesIn.join(
                        ','
                    )} already exists.`
                );
                error.code = 400;
                throw error;
            }
        }

        for (const key in data) {
            item[key] = data[key];
        }

        if (slugifyField && data[slugifyField]) {
            item.slug = getSlug(data[slugifyField]);
        }

        return await item.save();
    }

    async countBy({ query = {} }) {
        query.deleted = false;
        const count = await this.model.countDocuments(query);
        return count;
    }

    async deleteBy({ query = {}, multiple = false, deletedByUserId }) {
        query.deleted = false;

        const set = {
            deleted: true,
            deletedById: deletedByUserId,
            deletedAt: Date.now(),
        };

        let functionToCall = 'findOneAndUpdate';

        if (multiple) {
            functionToCall = 'findAndUpdate';
        }

        return await this.model[functionToCall](
            query,
            {
                $set: set,
            },
            {
                new: true,
            }
        );
    }


    async getListForViewer({
        query = {},
        skip = 0,
        limit = 10,
        sort = [['createdAt', -1]],
    }) {
        return await this.findBy({
            query,
            skip,
            limit,
            populate: viewerListProps.populate,
            select: viewerListProps.select,
            sort
        })
    }


    async getListForAdmin({
        query = {},
        skip = 0,
        limit = 10,
        sort = [['createdAt', -1]],
    }) {
        return await this.findBy({
            query,
            skip,
            limit,
            populate: adminListProps.populate,
            select: adminListProps.select,
            sort
        })
    }

    async getListForMember({
        query = {},
        skip = 0,
        limit = 10,
        sort = [['createdAt', -1]],
    }) {
        return await this.findBy({
            query,
            skip,
            limit,
            populate: memberListProps.populate,
            select: memberListProps.select,
            sort
        })
    }

    async getListForPublic({
        query = {},
        skip = 0,
        limit = 10,
        sort = [['createdAt', -1]],
    }) {
        return await this.findBy({
            query,
            skip,
            limit,
            populate: publicListProps.populate,
            select: publicListProps.select,
            sort
        })
    }


    async getItemForViewer({
        query = {},
        skip = 0,
        sort,
    }) {
        return await this.findOneBy({
            query,
            skip,
            populate: viewerItemProps.populate,
            select: viewerItemProps.select,
            sort
        })
    }

    async getItemForAdmin({
        query = {},
        skip = 0,
        sort,
    }) {
        return await this.findOneBy({
            query,
            skip,
            populate: adminItemProps.populate,
            select: adminItemProps.select,
            sort
        })
    }

    async getItemForMember({
        query = {},
        skip = 0,
        sort,
    }) {
        return await this.findOneBy({
            query,
            skip,
            populate: memberItemProps.populate,
            select: memberItemProps.select,
            sort
        })
    }

    async getItemForPublic({
        query = {},
        skip = 0,
        sort,
    }) {
        return await this.findOneBy({
            query,
            skip,
            populate: publicItemProps.populate,
            select: publicItemProps.select,
            sort
        })
    }



    async findBy({
        query = {},
        skip = 0,
        limit = 10,
        populate = [],
        select = '',
        sort = [['createdAt', -1]],
        findOne = false,
    }) {
        if (typeof skip === 'string') skip = parseInt(skip);

        if (typeof limit === 'string') limit = parseInt(limit);

        query.deleted = false;

        let functionToCall = 'find';

        if (findOne) {
            functionToCall = 'findOne';
        }

        query = this.model[functionToCall](query)
            .sort(sort)
            .limit(limit)
            .skip(skip)
            .lean();

        query = handleSelect(select, query);
        query = handlePopulate(populate, query);

        const items = await query;
        return items;
    }

    async findOneBy({
        query = {},
        skip = 0,
        populate = [],
        select = '',
        sort = [],
    }) {
        return await this.findBy({
            query,
            skip,
            limit: 1,
            populate,
            select,
            sort,
            findOne: true,
        });
    }

    async updateBy({ query = {}, updatedValues = {}, multiple = true }) {
        if (!query) {
            query = {};
        }

        if (!query.deleted) query.deleted = false;

        let functionToCall = 'updateMany';

        if (multiple) {
            functionToCall = 'updateOne';
        }

        const updatedItems = await this.model[functionToCall](query, {
            $set: updatedValues,
        });

        return updatedItems;
    }

    async updateOneBy({ query = {}, updatedValues = {} }) {
        return await this.updateBy({ query, updatedValues, updateOne: true });
    }
}

module.exports = ServiceBase;
