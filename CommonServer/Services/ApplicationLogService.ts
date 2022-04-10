import ApplicationLogModel from '../Models/applicationLog';
import ComponentService from './ComponentService';
import RealTimeService from './realTimeService';
import NotificationService from './NotificationService';
import ResourceCategoryService from './ResourceCategoryService';

import uuid from 'uuid';
import getSlug from '../Utils/getSlug';

import FindOneBy from '../Types/DB/FindOneBy';
import FindBy from '../Types/DB/FindBy';
import Query from '../Types/DB/Query';

import PositiveNumber from 'Common/Types/PositiveNumber';

export default class Service {
    async create(data: $TSFixMe) {
        // check component exists
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
        const existingApplicationLogCount = await this.countBy({
            name: data.name,
            componentId: data.componentId,
        });
        if (existingApplicationLogCount > 0) {
            const error = new Error(
                'Application Log with that name already exists.'
            );

            error.code = 400;
            throw error;
        }
        const resourceCategoryCount = await ResourceCategoryService.countBy({
            _id: data.resourceCategory,
        });
        // prepare application log model
        let applicationLog = new ApplicationLogModel();

        applicationLog.name = data.name;

        applicationLog.key = uuid.v4(); // generate random string here

        applicationLog.componentId = data.componentId;

        applicationLog.createdById = data.createdById;
        if (resourceCategoryCount && resourceCategoryCount > 0) {
            applicationLog.resourceCategory = data.resourceCategory;
        }

        applicationLog.slug = getSlug(data.name);
        const savedApplicationLog = await applicationLog.save();

        const populate = [
            { path: 'componentId', select: 'name' },
            { path: 'resourceCategory', select: 'name' },
        ];
        const select =
            'componentId name slug resourceCategory showQuickStart createdById key';
        applicationLog = await this.findOneBy({
            query: { _id: savedApplicationLog._id },
            populate,
            select,
        });
        return applicationLog;
    }
    //Description: Gets all application logs by component.
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

        if (!query['deleted']) query['deleted'] = false;

        const applicationLogQuery = ApplicationLogModel.find(query)
            .lean()
            .sort(sort)
            .limit(limit.toNumber())
            .skip(skip.toNumber());

        applicationLogQuery.select(select);
        applicationLogQuery.populate(populate);
        const applicationLogs = await applicationLogQuery;
        return applicationLogs;
    }

    async findOneBy({ query, populate, select, sort }: FindOneBy) {
        if (!query) {
            query = {};
        }

        if (!query['deleted']) query['deleted'] = false;
        const applicationLogQuery = ApplicationLogModel.findOne(query)
            .sort(sort)
            .lean();

        applicationLogQuery.select(select);
        applicationLogQuery.populate(populate);

        const applicationLog = await applicationLogQuery;
        return applicationLog;
    }

    async getApplicationLogsByComponentId(
        componentId: $TSFixMe,
        limit: PositiveNumber,
        skip: PositiveNumber
    ) {
        // check if component exists
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
            this.findBy({
                query: { componentId: componentId },
                limit,
                skip,
                populate: populateAppLogs,
                select: selectAppLogs,
            }),
            this.countBy({ componentId }),
        ]);

        return { applicationLogs, count, skip, limit };
    }

    async deleteBy(query: Query, userId: string) {
        if (!query) {
            query = {};
        }

        query['deleted'] = false;
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

            NotificationService.create(
                component.projectId,
                `An Application Log ${applicationLog.name} was deleted from the component ${applicationLog.componentId.name} by ${applicationLog.deletedById.name}`,
                applicationLog.deletedById._id,
                'applicationLogaddremove'
            );
            // run in the background
            RealTimeService.sendApplicationLogDelete(applicationLog);
            return applicationLog;
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
        let applicationLog = await ApplicationLogModel.findOneAndUpdate(
            query,
            { $set: data },
            {
                new: true,
            }
        );

        if (unsetData) {
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
    }

    async hardDeleteBy(query: Query) {
        await ApplicationLogModel.deleteMany(query);
        return 'Application Log(s) removed successfully!';
    }
    async countBy(query: Query) {
        if (!query) {
            query = {};
        }

        if (!query['deleted']) query['deleted'] = false;
        const count = await ApplicationLogModel.countDocuments(query);
        return count;
    }
}
