import PositiveNumber from 'common/Types/PositiveNumber';
export default class Service {
    async create(data: $TSFixMe) {
        // check if component exist
        const componentCount = await ComponentService.countBy({
            _id: data.componentId,
        });
        // send an error if the component doesnt exist
        if (!componentCount || componentCount === 0) {
            const error = new Error('Component does not exist.');

            error.code = 400;
            throw error;
        }
        // try to find in the application log if the name already exist for that component
        const select =
            'componentId name slug key showQuickStart resourceCategory createdById createdAt';
        const existingErrorTracker = await this.findBy({
            query: { name: data.name, componentId: data.componentId },
            select,
            populate: [
                {
                    path: 'componentId',
                    select: 'name slug projectId',
                    populate: [{ path: 'projectId', select: 'name' }],
                },
                { path: 'resourceCategory', select: 'name' },
            ],
        });
        if (existingErrorTracker && existingErrorTracker.length > 0) {
            const error = new Error(
                'Error Tracker with that name already exists.'
            );

            error.code = 400;
            throw error;
        }
        const resourceCategoryCount = await ResourceCategoryService.countBy({
            _id: data.resourceCategory,
        });
        // prepare error tracker model
        let errorTracker = new ErrorTrackerModel();

        errorTracker.name = data.name;

        errorTracker.key = uuid.v4(); // generate random string here

        errorTracker.componentId = data.componentId;

        errorTracker.createdById = data.createdById;
        if (resourceCategoryCount && resourceCategoryCount > 0) {
            errorTracker.resourceCategory = data.resourceCategory;
        }
        if (data && data.name) {
            errorTracker.slug = getSlug(data.name);
        }
        const savedErrorTracker = await errorTracker.save();
        errorTracker = await this.findOneBy({
            query: { _id: savedErrorTracker._id },
            select,
            populate: [
                { path: 'componentId', select: 'name' },
                { path: 'resourceCategory', select: 'name' },
            ],
        });
        return errorTracker;
    }

    async countBy(query: Query) {
        if (!query) {
            query = {};
        }

        if (!query['deleted']) query['deleted'] = false;
        const count = await ErrorTrackerModel.countDocuments(query);
        return count;
    }

    // find a list of error trackers
    async findBy({ query, limit, skip, select, populate, sort }: FindBy) {
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

        if (!query['deleted']) query['deleted'] = false;
        const errorTrackersQuery = ErrorTrackerModel.find(query)
            .lean()
            .sort(sort)
            .limit(limit.toNumber())
            .skip(skip.toNumber());

        errorTrackersQuery.select(select);
        errorTrackersQuery.populate(populate);
        const result = await errorTrackersQuery;
        return result;
    }
    // find a particular error tracker
    async findOneBy({ query, select, populate, sort }: FindOneBy) {
        if (!query) {
            query = {};
        }

        if (!query['deleted']) query['deleted'] = false;
        const errorTrackersQuery = ErrorTrackerModel.findOne(query)
            .sort(sort)
            .lean();
        errorTrackersQuery.select(select);
        errorTrackersQuery.populate(populate);
        const result = await errorTrackersQuery;
        return result;
    }
    // get all error trackers by component ID
    async getErrorTrackersByComponentId(
        componentId: $TSFixMe,
        limit: PositiveNumber,
        skip: PositiveNumber
    ) {
        // Check if component exists
        const componentCount = await ComponentService.countBy({
            _id: componentId,
        });
        // send an error if the component doesnt exist
        if (!componentCount || componentCount === 0) {
            const error = new Error('Component does not exist.');

            error.code = 400;
            throw error;
        }

        if (typeof limit === 'string') limit = parseInt(limit);
        if (typeof skip === 'string') skip = parseInt(skip);

        const select =
            'componentId name slug key showQuickStart resourceCategory createdById createdAt';

        const [errorTrackers, count] = await Promise.all([
            this.findBy({
                query: { componentId: componentId },
                limit,
                skip,
                select,
                populate: [
                    { path: 'componentId', select: 'name' },
                    { path: 'resourceCategory', select: 'name' },
                ],
            }),
            this.countBy({ componentId }),
        ]);

        return { errorTrackers, count, skip, limit };
    }

    async deleteBy(query: Query, userId: string) {
        if (!query) {
            query = {};
        }

        query.deleted = false;
        const errorTracker = await ErrorTrackerModel.findOneAndUpdate(
            query,
            {
                $set: {
                    deleted: true,
                    deletedAt: Date.now(),
                    deletedById: userId,
                },
            },
            { new: true }
        ).populate('deletedById', 'name');
        if (errorTracker) {
            const component = ComponentService.findOneBy({
                query: { _id: errorTracker.componentId._id },
                select: 'projectId',
            });

            NotificationService.create(
                component.projectId,
                `An Error Tracker ${errorTracker.name} was deleted from the component ${errorTracker.componentId.name} by ${errorTracker.deletedById.name}`,
                errorTracker.deletedById._id,
                'errorTrackeraddremove'
            );
            RealTimeService.sendErrorTrackerDelete(errorTracker);
            return errorTracker;
        } else {
            return null;
        }
    }

    async updateOneBy(query: Query, data: $TSFixMe, unsetData = null) {
        if (!query) {
            query = {};
        }

        if (!query['deleted']) query['deleted'] = false;
        if (data && data.name) {
            data.slug = getSlug(data.name);
        }
        let errorTracker = await ErrorTrackerModel.findOneAndUpdate(
            query,
            { $set: data },
            {
                new: true,
            }
        );

        if (unsetData) {
            errorTracker = await ErrorTrackerModel.findOneAndUpdate(
                query,
                { $unset: unsetData },
                {
                    new: true,
                }
            );
        }
        const select =
            'componentId name slug key showQuickStart resourceCategory createdById createdAt';
        const populate = [
            { path: 'componentId', select: 'name' },
            { path: 'resourceCategory', select: 'name' },
        ];

        errorTracker = await this.findOneBy({ query, select, populate });

        // run in the background
        RealTimeService.errorTrackerKeyReset(errorTracker);

        return errorTracker;
    }
}

import ErrorTrackerModel from '../Models/errorTracker';
import ComponentService from './ComponentService';
import ResourceCategoryService from './ResourceCategoryService';
import RealTimeService from './realTimeService';
import NotificationService from './NotificationService';

import uuid from 'uuid';
import getSlug from '../Utils/getSlug';

import FindOneBy from '../Types/DB/FindOneBy';
import FindBy from '../Types/DB/FindBy';
import Query from '../Types/DB/Query';
