module.exports = {
    create: async function(data) {
        const _this = this;
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
        const existingApplicationLogCount = await _this.countBy({
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
        applicationLog = await _this.findOneBy({
            query: { _id: savedApplicationLog._id },
            populate,
            select,
        });
        return applicationLog;
    },
    //Description: Gets all application logs by component.
    async findBy({ query, limit, skip, populate, select }) {
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

    async findOneBy({ query, populate, select }) {
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

    async getApplicationLogsByComponentId(componentId, limit, skip) {
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
    deleteBy: async function(query, userId) {
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
            NotificationService.create(
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
    updateOneBy: async function(query, data, unsetData = null) {
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
    hardDeleteBy: async function(query) {
        await ApplicationLogModel.deleteMany(query);
        return 'Application Log(s) removed successfully!';
    },
    async countBy(query) {
        if (!query) {
            query = {};
        }

        if (!query.deleted) query.deleted = false;
        const count = await ApplicationLogModel.countDocuments(query);
        return count;
    },
};

const ApplicationLogModel = require('../models/applicationLog');
const ComponentService = require('./componentService');
const RealTimeService = require('./realTimeService');
const NotificationService = require('./notificationService');
const ResourceCategoryService = require('./resourceCategoryService');
const uuid = require('uuid');
const getSlug = require('../utils/getSlug');
const handlePopulate = require('../utils/populate');
const handleSelect = require('../utils/select');
const errorService = require('../../../common-server/utils/error');
