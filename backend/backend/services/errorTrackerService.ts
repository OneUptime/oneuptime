export default {
    create: async function(data: $TSFixMe) {
        const _this = this;
        // check if component exist
        const componentCount = await ComponentService.countBy({
            _id: data.componentId,
        });
        // send an error if the component doesnt exist
        if (!componentCount || componentCount === 0) {
            const error = new Error('Component does not exist.');
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'code' does not exist on type 'Error'.
            error.code = 400;
            throw error;
        }
        // try to find in the application log if the name already exist for that component
        const select =
            'componentId name slug key showQuickStart resourceCategory createdById createdAt';
        const existingErrorTracker = await _this.findBy({
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
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'code' does not exist on type 'Error'.
            error.code = 400;
            throw error;
        }
        const resourceCategoryCount = await ResourceCategoryService.countBy({
            _id: data.resourceCategory,
        });
        // prepare error tracker model
        let errorTracker = new ErrorTrackerModel();
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'name' does not exist on type 'Document<a... Remove this comment to see the full error message
        errorTracker.name = data.name;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'key' does not exist on type 'Document<an... Remove this comment to see the full error message
        errorTracker.key = uuid.v4(); // generate random string here
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentId' does not exist on type 'Doc... Remove this comment to see the full error message
        errorTracker.componentId = data.componentId;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'createdById' does not exist on type 'Doc... Remove this comment to see the full error message
        errorTracker.createdById = data.createdById;
        if (resourceCategoryCount && resourceCategoryCount > 0) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'resourceCategory' does not exist on type... Remove this comment to see the full error message
            errorTracker.resourceCategory = data.resourceCategory;
        }
        if (data && data.name) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'slug' does not exist on type 'Document<a... Remove this comment to see the full error message
            errorTracker.slug = getSlug(data.name);
        }
        const savedErrorTracker = await errorTracker.save();
        errorTracker = await _this.findOneBy({
            query: { _id: savedErrorTracker._id },
            select,
            populate: [
                { path: 'componentId', select: 'name' },
                { path: 'resourceCategory', select: 'name' },
            ],
        });
        return errorTracker;
    },

    async countBy(query: $TSFixMe) {
        if (!query) {
            query = {};
        }

        if (!query.deleted) query.deleted = false;
        const count = await ErrorTrackerModel.countDocuments(query);
        return count;
    },

    // find a list of error trackers
    async findBy({
        query,
        limit,
        skip,
        select,
        populate
    }: $TSFixMe) {
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

        if (!query.deleted) query.deleted = false;
        let errorTrackersQuery = ErrorTrackerModel.find(query)
            .lean()
            .sort([['createdAt', -1]])
            .limit(limit)
            .skip(skip);

        errorTrackersQuery = handleSelect(select, errorTrackersQuery);
        errorTrackersQuery = handlePopulate(populate, errorTrackersQuery);
        const result = await errorTrackersQuery;
        return result;
    },
    // find a particular error tracker
    async findOneBy({
        query,
        select,
        populate
    }: $TSFixMe) {
        if (!query) {
            query = {};
        }

        if (!query.deleted) query.deleted = false;
        let errorTrackersQuery = ErrorTrackerModel.findOne(query).lean();
        errorTrackersQuery = handleSelect(select, errorTrackersQuery);
        errorTrackersQuery = handlePopulate(populate, errorTrackersQuery);
        const result = await errorTrackersQuery;
        return result;
    },
    // get all error trackers by component ID
    async getErrorTrackersByComponentId(componentId: $TSFixMe, limit: $TSFixMe, skip: $TSFixMe) {
        // Check if component exists
        const componentCount = await ComponentService.countBy({
            _id: componentId,
        });
        // send an error if the component doesnt exist
        if (!componentCount || componentCount === 0) {
            const error = new Error('Component does not exist.');
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'code' does not exist on type 'Error'.
            error.code = 400;
            throw error;
        }

        if (typeof limit === 'string') limit = parseInt(limit);
        if (typeof skip === 'string') skip = parseInt(skip);
        const _this = this;
        const select =
            'componentId name slug key showQuickStart resourceCategory createdById createdAt';

        const [errorTrackers, count] = await Promise.all([
            _this.findBy({
                query: { componentId: componentId },
                limit,
                skip,
                select,
                populate: [
                    { path: 'componentId', select: 'name' },
                    { path: 'resourceCategory', select: 'name' },
                ],
            }),
            _this.countBy({ componentId }),
        ]);

        return { errorTrackers, count, skip, limit };
    },
    deleteBy: async function(query: $TSFixMe, userId: $TSFixMe) {
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
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 5 arguments, but got 4.
            NotificationService.create(
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectId' does not exist on type 'Promi... Remove this comment to see the full error message
                component.projectId,
                `An Error Tracker ${errorTracker.name} was deleted from the component ${errorTracker.componentId.name} by ${errorTracker.deletedById.name}`,
                errorTracker.deletedById._id,
                'errorTrackeraddremove'
            ).catch(error => {
                errorService.log('NotificationService.create', error);
            });
            RealTimeService.sendErrorTrackerDelete(errorTracker);
            return errorTracker;
        } else {
            return null;
        }
    },
    updateOneBy: async function(query: $TSFixMe, data: $TSFixMe, unsetData = null) {
        if (!query) {
            query = {};
        }

        if (!query.deleted) query.deleted = false;
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
            // @ts-expect-error ts-migrate(2769) FIXME: No overload matches this call.
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
    },
};

import ErrorTrackerModel from '../models/errorTracker'
import ComponentService from './componentService'
import ResourceCategoryService from './resourceCategoryService'
import RealTimeService from './realTimeService'
import NotificationService from './notificationService'
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'uuid... Remove this comment to see the full error message
import uuid from 'uuid'
import getSlug from '../utils/getSlug'
import handleSelect from '../utils/select'
import handlePopulate from '../utils/populate'
import errorService from 'common-server/utils/error'
