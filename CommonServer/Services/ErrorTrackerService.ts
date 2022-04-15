import PositiveNumber from 'Common/Types/PositiveNumber';
import BadDataException from 'Common/Types/Exception/BadDataException';
export default class Service {
    public async create(data: $TSFixMe): void {
        // Check if component exist
        const componentCount: $TSFixMe = await ComponentService.countBy({
            _id: data.componentId,
        });
        // Send an error if the component doesnt exist
        if (!componentCount || componentCount === 0) {
            throw new BadDataException('Component does not exist.');
        }
        // Try to find in the application log if the name already exist for that component
        const select: $TSFixMe =
            'componentId name slug key showQuickStart resourceCategory createdById createdAt';
        const existingErrorTracker: $TSFixMe = await this.findBy({
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
            const error: $TSFixMe = new Error(
                'Error Tracker with that name already exists.'
            );

            error.code = 400;
            throw error;
        }
        const resourceCategoryCount: $TSFixMe =
            await ResourceCategoryService.countBy({
                _id: data.resourceCategory,
            });
        // Prepare error tracker model
        let errorTracker: $TSFixMe = new ErrorTrackerModel();

        errorTracker.name = data.name;

        errorTracker.key = uuid.v4(); // Generate random string here

        errorTracker.componentId = data.componentId;

        errorTracker.createdById = data.createdById;
        if (resourceCategoryCount && resourceCategoryCount > 0) {
            errorTracker.resourceCategory = data.resourceCategory;
        }
        if (data && data.name) {
            errorTracker.slug = getSlug(data.name);
        }
        const savedErrorTracker: $TSFixMe = await errorTracker.save();
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

    public async countBy(query: Query): void {
        if (!query) {
            query = {};
        }

        if (!query.deleted) {
            query.deleted = false;
        }
        const count: $TSFixMe = await ErrorTrackerModel.countDocuments(query);
        return count;
    }

    // Find a list of error trackers
    public async findBy({
        query,
        limit,
        skip,
        select,
        populate,
        sort,
    }: FindBy): void {
        if (!skip) {
            skip = 0;
        }

        if (!limit) {
            limit = 0;
        }

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
        const errorTrackersQuery: $TSFixMe = ErrorTrackerModel.find(query)
            .lean()
            .sort(sort)
            .limit(limit.toNumber())
            .skip(skip.toNumber());

        errorTrackersQuery.select(select);
        errorTrackersQuery.populate(populate);
        const result: $TSFixMe = await errorTrackersQuery;
        return result;
    }
    // Find a particular error tracker
    public async findOneBy({ query, select, populate, sort }: FindOneBy): void {
        if (!query) {
            query = {};
        }

        if (!query.deleted) {
            query.deleted = false;
        }
        const errorTrackersQuery: $TSFixMe = ErrorTrackerModel.findOne(query)
            .sort(sort)
            .lean();
        errorTrackersQuery.select(select);
        errorTrackersQuery.populate(populate);
        const result: $TSFixMe = await errorTrackersQuery;
        return result;
    }
    // Get all error trackers by component ID
    public async getErrorTrackersByComponentId(
        componentId: $TSFixMe,
        limit: PositiveNumber,
        skip: PositiveNumber
    ): void {
        // Check if component exists
        const componentCount: $TSFixMe = await ComponentService.countBy({
            _id: componentId,
        });
        // Send an error if the component doesnt exist
        if (!componentCount || componentCount === 0) {
            throw new BadDataException('Component does not exist.');
        }

        if (typeof limit === 'string') {
            limit = parseInt(limit);
        }
        if (typeof skip === 'string') {
            skip = parseInt(skip);
        }

        const select: $TSFixMe =
            'componentId name slug key showQuickStart resourceCategory createdById createdAt';

        const [errorTrackers, count]: $TSFixMe = await Promise.all([
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

    public async deleteBy(query: Query, userId: ObjectID): void {
        if (!query) {
            query = {};
        }

        query.deleted = false;
        const errorTracker: $TSFixMe = await ErrorTrackerModel.findOneAndUpdate(
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
            const component: $TSFixMe = ComponentService.findOneBy({
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

    public async updateOneBy(
        query: Query,
        data: $TSFixMe,
        unsetData = null
    ): void {
        if (!query) {
            query = {};
        }

        if (!query.deleted) {
            query.deleted = false;
        }
        if (data && data.name) {
            data.slug = getSlug(data.name);
        }
        let errorTracker: $TSFixMe = await ErrorTrackerModel.findOneAndUpdate(
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
        const select: $TSFixMe =
            'componentId name slug key showQuickStart resourceCategory createdById createdAt';
        const populate: $TSFixMe = [
            { path: 'componentId', select: 'name' },
            { path: 'resourceCategory', select: 'name' },
        ];

        errorTracker = await this.findOneBy({ query, select, populate });

        // Run in the background
        RealTimeService.errorTrackerKeyReset(errorTracker);

        return errorTracker;
    }
}

import ErrorTrackerModel from '../Models/errorTracker';
import ObjectID from 'Common/Types/ObjectID';
import ComponentService from './ComponentService';
import ResourceCategoryService from './ResourceCategoryService';
import RealTimeService from './realTimeService';
import NotificationService from './NotificationService';

import uuid from 'uuid';
import getSlug from '../Utils/getSlug';

import FindOneBy from '../Types/DB/FindOneBy';
import FindBy from '../Types/DB/FindBy';
import Query from '../Types/DB/Query';
