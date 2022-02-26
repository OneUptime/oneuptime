export default {
    create: async function(data: $TSFixMe) {
        const _this = this;
        // check component exists
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
        const existingApplicationLogCount = await _this.countBy({
            name: data.name,
            componentId: data.componentId,
        });
        if (existingApplicationLogCount > 0) {
            const error = new Error(
                'Application Log with that name already exists.'
            );
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'code' does not exist on type 'Error'.
            error.code = 400;
            throw error;
        }
        const resourceCategoryCount = await ResourceCategoryService.countBy({
            _id: data.resourceCategory,
        });
        // prepare application log model
        let applicationLog = new ApplicationLogModel();
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'name' does not exist on type 'Document<a... Remove this comment to see the full error message
        applicationLog.name = data.name;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'key' does not exist on type 'Document<an... Remove this comment to see the full error message
        applicationLog.key = uuid.v4(); // generate random string here
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentId' does not exist on type 'Doc... Remove this comment to see the full error message
        applicationLog.componentId = data.componentId;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'createdById' does not exist on type 'Doc... Remove this comment to see the full error message
        applicationLog.createdById = data.createdById;
        if (resourceCategoryCount && resourceCategoryCount > 0) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'resourceCategory' does not exist on type... Remove this comment to see the full error message
            applicationLog.resourceCategory = data.resourceCategory;
        }
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'slug' does not exist on type 'Document<a... Remove this comment to see the full error message
        applicationLog.slug = getSlug(data.name);
        const savedApplicationLog = await applicationLog.save();

        const populate = [
            { path: 'componentId', select: 'name' },
            { path: 'resourceCategory', select: 'name' },
        ];
        const select =
            'componentId name slug resourceCategory showQuickStart createdById key';
        applicationLog = await _this.findOneBy({
            query: { _id: savedApplicationLog._id },
            populate,
            select,
        });
        return applicationLog;
    },
    //Description: Gets all application logs by component.
    async findBy({
        query,
        limit,
        skip,
        populate,
        select
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

        let applicationLogQuery = ApplicationLogModel.find(query)
            .lean()
            .sort([['createdAt', -1]])
            .limit(limit)
            .skip(skip);

        applicationLogQuery = handleSelect(select, applicationLogQuery);
        applicationLogQuery = handlePopulate(populate, applicationLogQuery);
        const applicationLogs = await applicationLogQuery;
        return applicationLogs;
    },

    async findOneBy({
        query,
        populate,
        select
    }: $TSFixMe) {
        if (!query) {
            query = {};
        }

        if (!query.deleted) query.deleted = false;
        let applicationLogQuery = ApplicationLogModel.findOne(query).lean();

        applicationLogQuery = handleSelect(select, applicationLogQuery);
        applicationLogQuery = handlePopulate(populate, applicationLogQuery);

        const applicationLog = await applicationLogQuery;
        return applicationLog;
    },

    async getApplicationLogsByComponentId(componentId: $TSFixMe, limit: $TSFixMe, skip: $TSFixMe) {
        // check if component exists
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

        const populateAppLogs = [
            {
                path: 'componentId',
                select: 'name slug projectId',
                populate: {
                    path: 'projectId',
                    select: 'name slug',
                },
            },
            { path: 'resourceCategory', select: 'name' },
        ];

        const selectAppLogs =
            'componentId name slug resourceCategory showQuickStart createdById key';
        const [applicationLogs, count] = await Promise.all([
            _this.findBy({
                query: { componentId: componentId },
                limit,
                skip,
                populate: populateAppLogs,
                select: selectAppLogs,
            }),
            _this.countBy({ componentId }),
        ]);

        return { applicationLogs, count, skip, limit };
    },
    deleteBy: async function(query: $TSFixMe, userId: $TSFixMe) {
        if (!query) {
            query = {};
        }

        query.deleted = false;
        const applicationLog = await ApplicationLogModel.findOneAndUpdate(
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
        if (applicationLog) {
            const component = ComponentService.findOneBy({
                query: { _id: applicationLog.componentId._id },
                select: 'projectId',
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 5 arguments, but got 4.
            NotificationService.create(
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectId' does not exist on type 'Promi... Remove this comment to see the full error message
                component.projectId,
                `An Application Log ${applicationLog.name} was deleted from the component ${applicationLog.componentId.name} by ${applicationLog.deletedById.name}`,
                applicationLog.deletedById._id,
                'applicationLogaddremove'
            ).catch(error => {
                errorService.log('NotificationService.create', error);
            });
            // run in the background
            RealTimeService.sendApplicationLogDelete(applicationLog);
            return applicationLog;
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
        let applicationLog = await ApplicationLogModel.findOneAndUpdate(
            query,
            { $set: data },
            {
                new: true,
            }
        );

        if (unsetData) {
            // @ts-expect-error ts-migrate(2769) FIXME: No overload matches this call.
            applicationLog = await ApplicationLogModel.findOneAndUpdate(
                query,
                { $unset: unsetData },
                {
                    new: true,
                }
            );
        }

        const populate = [
            { path: 'componentId', select: 'name' },
            { path: 'resourceCategory', select: 'name' },
        ];
        const select =
            'componentId name slug resourceCategory showQuickStart createdById key';
        applicationLog = await this.findOneBy({ query, populate, select });

        // run in the background
        RealTimeService.applicationLogKeyReset(applicationLog);

        return applicationLog;
    },
    hardDeleteBy: async function(query: $TSFixMe) {
        await ApplicationLogModel.deleteMany(query);
        return 'Application Log(s) removed successfully!';
    },
    async countBy(query: $TSFixMe) {
        if (!query) {
            query = {};
        }

        if (!query.deleted) query.deleted = false;
        const count = await ApplicationLogModel.countDocuments(query);
        return count;
    },
};

import ApplicationLogModel from '../models/applicationLog'
import ComponentService from './componentService'
import RealTimeService from './realTimeService'
import NotificationService from './notificationService'
import ResourceCategoryService from './resourceCategoryService'
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'uuid... Remove this comment to see the full error message
import uuid from 'uuid'
import getSlug from '../utils/getSlug'
import handlePopulate from '../utils/populate'
import handleSelect from '../utils/select'
import errorService from 'common-server/utils/error'
