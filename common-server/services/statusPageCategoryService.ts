import StatusPageCategoryModel from '../models/statusPageCategory';
import MonitorModel from '../models/monitor';

import FindBy from '../types/db/FindBy';
import Query from '../types/db/Query';

export default class Service {
    async create(data: $TSFixMe) {
        const existingStatusPageCategory = await this.countBy({
            name: data.name,
            statusPageId: data.statusPageId,
        });
        if (existingStatusPageCategory && existingStatusPageCategory > 0) {
            const error = new Error(
                'A status page category with that name already exist.'
            );

            error.code = 400;
            throw error;
        }

        const statusPageCategory = await StatusPageCategoryModel.create(data);
        return statusPageCategory;
    }

    async deleteBy(query: Query, userId: string) {
        const statusPageCategory =
            await StatusPageCategoryModel.findOneAndUpdate(
                query,
                {
                    $set: {
                        deleted: true,
                        deletedAt: Date.now(),
                        deletedById: userId,
                    },
                },
                { new: true }
            );

        await MonitorModel.updateMany(
            { statusPageResourceCategory: query._id },
            {
                $set: {
                    statusPageResourceCategory: null,
                },
            }
        );

        return statusPageCategory;
    }

    async findBy({ query, limit, skip, populate, select, sort }: FindBy) {
        if (!skip) skip = 0;

        if (!limit) limit = 0;

        if (typeof skip === 'string') {
            skip = parseInt(skip);
        }

        if (typeof limit === 'string') {
            limit = parseInt(limit);
        }

        if (!query) {
            query = {};
        }
        if (!query.deleted) {
            query.deleted = false;
        }

        const statusPageCategoriesQuery = StatusPageCategoryModel.find(query)
            .lean()
            .limit(limit.toNumber())
            .skip(skip.toNumber())
            .sort(sort);

        statusPageCategoriesQuery.select(select);
        statusPageCategoriesQuery.populate(populate);

        const statusCategories = await statusPageCategoriesQuery;
        return statusCategories;
    }

    async updateOneBy(query: Query, data: $TSFixMe) {
        const existingStatusPageCategory = await this.countBy({
            name: data.name,
            _id: { $not: { $eq: query._id } },
        });
        if (existingStatusPageCategory && existingStatusPageCategory > 0) {
            const error = new Error(
                'A status page category with that name already exists.'
            );

            error.code = 400;
            throw error;
        }
        if (!query) {
            query = {};
        }
        if (!query['deleted']) query['deleted'] = false;
        const statusPageCategory =
            await StatusPageCategoryModel.findOneAndUpdate(
                query,
                {
                    $set: data,
                },
                {
                    new: true,
                }
            );
        return statusPageCategory;
    }

    async updateBy(query: Query, data: $TSFixMe) {
        if (!query) {
            query = {};
        }

        if (!query['deleted']) query['deleted'] = false;
        let updatedData = await StatusPageCategoryModel.updateMany(query, {
            $set: data,
        });
        const select = 'projectId name createdById createdAt';
        updatedData = await this.findBy({ query, select });
        return updatedData;
    }

    async countBy(query: Query) {
        if (!query) {
            query = {};
        }
        if (!query.deleted) {
            query.deleted = false;
        }

        const count = await StatusPageCategoryModel.countDocuments(query);
        return count;
    }

    async hardDeleteBy(query: Query) {
        await StatusPageCategoryModel.deleteMany(query);
        return 'Status Page Categories(s) removed successfully!';
    }
}
