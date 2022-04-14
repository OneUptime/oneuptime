import PositiveNumber from 'Common/Types/PositiveNumber';
import PerformanceTrackerModel from '../Models/performanceTracker';
import ObjectID from 'Common/Types/ObjectID';
import ComponentService from './ComponentService';
import BadDataException from 'Common/Types/Exception/BadDataException';
import generate from 'nanoid/generate';
import slugify from 'slugify';
// import RealTimeService from './realTimeService'
import NotificationService from './NotificationService';

import uuid from 'uuid';

import FindOneBy from '../Types/DB/FindOneBy';
import FindBy from '../Types/DB/FindBy';
import Query from '../Types/DB/Query';

export default class Service {
    async create(data: $TSFixMe): void {
        // check if component exists
        const componentCount = await ComponentService.countBy({
            _id: data.componentId,
        });
        // send an error if the component doesnt exist
        if (!componentCount || componentCount === 0) {
            const error = new Error('Component does not exist.');

            error.code = 400;

            throw error;
        }
        // check if a performance tracker already exist with the same name for a particular component
        const existingPerformanceTracker = await this.findBy({
            query: { name: data.name, componentId: data.componentId },
            select: '_id',
        });
        if (
            existingPerformanceTracker &&
            existingPerformanceTracker.length > 0
        ) {
            const error = new Error(
                'Performance tracker with that name already exists.'
            );

            error.code = 400;

            throw error;
        }

        data.key = uuid.v4();
        // handle the slug
        let name = data.name;
        name = slugify(name);
        name = `${name}-${generate('1234567890', 8)}`;
        data.slug = name.toLowerCase();

        let performanceTracker = await PerformanceTrackerModel.create(data);

        const select = 'componentId name slug key showQuickStart createdById';
        const populate = [
            { path: 'createdById', select: 'name email' },
            {
                path: 'componentId',
                select: 'name slug',
                populate: { path: 'projectId', select: 'name slug' },
            },
        ];
        performanceTracker = await this.findOneBy({
            query: { _id: performanceTracker._id },
            select,
            populate,
        });
        return performanceTracker;
    }
    //Description: Gets all application logs by component.
    async findBy({ query, limit, skip, populate, select, sort }: FindBy): void {
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
        if (!query['deleted']) {
            query['deleted'] = false;
        }

        const performanceTrackerQuery = PerformanceTrackerModel.find(query)
            .lean()
            .sort(sort)
            .skip(skip.toNumber())
            .limit(limit.toNumber());
        performanceTrackerQuery.select(select);
        performanceTrackerQuery.populate(populate);

        const performanceTracker = await performanceTrackerQuery;
        return performanceTracker;
    }

    async findOneBy({ query, select, populate, sort }: FindOneBy): void {
        if (!query) {
            query = {};
        }
        if (!query['deleted']) {
            query['deleted'] = false;
        }

        // .populate({
        //     path: 'componentId',
        //     select: 'name slug',
        //     populate: {
        //         path: 'projectId',
        //         select: 'name slug',
        //     },
        // })
        // .populate('createdById', 'name email');

        const performanceTrackerQuery = PerformanceTrackerModel.findOne(query)
            .sort(sort)
            .lean();

        performanceTrackerQuery.select(select);
        performanceTrackerQuery.populate(populate);

        const performanceTracker = await performanceTrackerQuery;
        return performanceTracker;
    }

    async getPerformanceTrackerByComponentId(
        componentId: $TSFixMe,
        limit: PositiveNumber,
        skip: PositiveNumber
    ): void {
        // Check if component exists
        const componentCount = await ComponentService.countBy({
            _id: componentId,
        });
        // send an error if the component doesnt exist
        if (!componentCount || componentCount === 0) {
            throw new BadDataException('Component does not exist.');
        }

        if (typeof limit === 'string') {
            limit = parseInt(limit);
        }
        if (typeof skip === 'string') {
            skip = parseInt(skip);
        }

        const select = 'componentId name slug key showQuickStart createdById';
        const populate = [
            { path: 'createdById', select: 'name email' },
            {
                path: 'componentId',
                select: 'name slug',
                populate: { path: 'projectId', select: 'name slug' },
            },
        ];
        const performanceTracker = await this.findBy({
            query: { componentId },
            limit,
            skip,
            select,
            populate,
        });
        return performanceTracker;
    }

    async deleteBy(query: Query, userId: ObjectID): void {
        if (!query) {
            query = {};
        }
        query['deleted'] = false;

        const performanceTracker =
            await PerformanceTrackerModel.findOneAndUpdate(
                query,
                {
                    $set: {
                        deleted: true,
                        deletedAt: Date.now(),
                        deletedById: userId,
                    },
                },
                { new: true }
            )
                .populate('deletedById', 'name')
                .populate({
                    path: 'componentId',
                    select: 'name slug',
                    populate: {
                        path: 'projectId',
                        select: 'name slug',
                    },
                });
        if (performanceTracker) {
            NotificationService.create(
                performanceTracker.componentId.projectId._id ||
                    performanceTracker.componentId.projectId,
                `The performance tracker ${performanceTracker.name} was deleted from the component ${performanceTracker.componentId.name} by ${performanceTracker.deletedById.name}`,
                performanceTracker.deletedById._id,
                'performanceTrackeraddremove'
            );

            // await RealTimeService.sendPerformanceTrackerDelete(
            //     performanceTracker
            // );
            return performanceTracker;
        } else {
            return null;
        }
    }

    async updateOneBy(query: Query, data: $TSFixMe, unsetData = null): void {
        if (!query) {
            query = {};
        }
        if (!query['deleted']) {
            query['deleted'] = false;
        }

        if (data && data.name) {
            let name = data.name;
            name = slugify(name);
            name = `${name}-${generate('1234567890', 8)}`;
            data.slug = name.toLowerCase();
        }
        let performanceTracker = await PerformanceTrackerModel.findOneAndUpdate(
            query,
            { $set: data },
            {
                new: true,
            }
        );

        if (unsetData) {
            performanceTracker = await PerformanceTrackerModel.findOneAndUpdate(
                query,
                { $unset: unsetData },
                {
                    new: true,
                }
            );
        }

        const select = 'componentId name slug key showQuickStart createdById';
        const populate = [
            { path: 'createdById', select: 'name email' },
            {
                path: 'componentId',
                select: 'name slug',
                populate: { path: 'projectId', select: 'name slug' },
            },
        ];
        performanceTracker = await this.findOneBy({
            query,
            select,
            populate,
        });

        // await RealTimeService.performanceTrackerKeyReset(
        //     performanceTracker
        // );

        return performanceTracker;
    }

    async countBy(query: Query): void {
        if (!query) {
            query = {};
        }
        if (!query['deleted']) {
            query['deleted'] = false;
        }

        const count = await PerformanceTrackerModel.countDocuments(query);
        return count;
    }
}
