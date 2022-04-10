export default class Service {
    async create(data: $TSFixMe) {
        const existingResourceCategory = await this.countBy({
            name: data.name,
            projectId: data.projectId,
        });
        if (existingResourceCategory && existingResourceCategory > 0) {
            const error = new Error(
                'A resource category with that name already exists.'
            );

            error.code = 400;
            throw error;
        }
        let resourceCategory = new ResourceCategoryModel();

        resourceCategory.projectId = data.projectId;

        resourceCategory.createdById = data.createdById;

        resourceCategory.name = data.name;
        resourceCategory = await resourceCategory.save();
        return resourceCategory;
    }

    async deleteBy(query: Query, userId: string) {
        const resourceCategory = await ResourceCategoryModel.findOneAndUpdate(
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

        await Promise.all([
            MonitorModel.updateMany(
                { resourceCategory: query._id },
                {
                    $set: {
                        resourceCategory: null,
                    },
                }
            ),
            ApplicationLogModel.updateMany(
                { resourceCategory: query._id },
                {
                    $set: {
                        resourceCategory: null,
                    },
                }
            ),
            ErrorTrackerModel.updateMany(
                { resourceCategory: query._id },
                {
                    $set: {
                        resourceCategory: null,
                    },
                }
            ),
            ApplicationSecurityModel.updateMany(
                { resourceCategory: query._id },
                {
                    $set: {
                        resourceCategory: null,
                    },
                }
            ),
            ContainerSecurityModel.updateMany(
                { resourceCategory: query._id },
                {
                    $set: {
                        resourceCategory: null,
                    },
                }
            ),
        ]);

        return resourceCategory;
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

        query.deleted = false;
        const resourceCategoriesQuery = ResourceCategoryModel.find(query)
            .lean()
            .limit(limit.toNumber())
            .skip(skip.toNumber())
            .sort(sort);

        resourceCategoriesQuery.select(select);
        resourceCategoriesQuery.populate(populate);

        let resourceCategories = await resourceCategoriesQuery;

        resourceCategories = resourceCategories.map(
            (resourceCategory: $TSFixMe) => ({
                name: resourceCategory.name,
                _id: resourceCategory._id,
                createdAt: resourceCategory.createdAt,
            })
        );
        return resourceCategories;
    }

    async updateOneBy(query: Query, data: $TSFixMe) {
        const existingResourceCategory = await this.countBy({
            name: data.name,
            projectId: data.projectId,
            _id: { $not: { $eq: data._id } },
        });
        if (existingResourceCategory && existingResourceCategory > 0) {
            const error = new Error(
                'A resource category with that name already exists.'
            );

            error.code = 400;
            throw error;
        }
        if (!query) {
            query = {};
        }
        if (!query['deleted']) query['deleted'] = false;
        const resourceCategory = await ResourceCategoryModel.findOneAndUpdate(
            query,
            {
                $set: data,
            },
            {
                new: true,
            }
        );
        return resourceCategory;
    }

    async updateBy(query: Query, data: $TSFixMe) {
        if (!query) {
            query = {};
        }

        if (!query['deleted']) query['deleted'] = false;
        let updatedData = await ResourceCategoryModel.updateMany(query, {
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

        query.deleted = false;
        const count = await ResourceCategoryModel.countDocuments(query);
        return count;
    }

    async hardDeleteBy(query: Query) {
        await ResourceCategoryModel.deleteMany(query);
        return 'Resource Categories(s) removed successfully!';
    }
}

import ResourceCategoryModel from '../models/resourceCategory';
import MonitorModel from '../models/monitor';
import ApplicationLogModel from '../models/applicationLog';
import ErrorTrackerModel from '../models/errorTracker';
import ApplicationSecurityModel from '../models/applicationSecurity';
import ContainerSecurityModel from '../models/containerSecurity';

import FindBy from '../types/db/FindBy';
import Query from '../types/db/Query';
