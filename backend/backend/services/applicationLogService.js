module.exports = {
    create: async function (data) {
        try {
            const _this = this;
            // try to get the component by the ID
            let component = await ComponentService.findOneBy({
                _id: data.componentId,
            });
            // sendd an error if the component doesnt exist
            if (!component) {
                const error = new Error('Component does not exist.');
                error.code = 400;
                ErrorService.log('applicationLogService.create', error);
                throw error;
            }
            // try to find in the application log if the name already exist for that component
            const existingApplicationLog = await _this.findBy({
                name: data.name,
                componentId: data.componentId,
            });
            if (existingApplicationLog && existingApplicationLog.length > 0) {
                const error = new Error(
                    'Application Log with that name already exists.'
                );
                error.code = 400;
                ErrorService.log('applicationLogService.create', error);
                throw error;
            }
            // prepare application log model 
            let applicationLog = new ApplicationLogModel();
            applicationLog.name = data.name;
            applicationLog.componentId = data.componentId;
            applicationLog.createdById = data.createdById;
            const savedApplicationLog = await applicationLog.save();
            applicationLog = await _this.findOneBy({
                _id: savedApplicationLog._id,
            });
            return applicationLog;
        } catch (error) {
            ErrorService.log('applicationLogService.create', error);
            throw error;
        }
    },
    //Description: Gets all application logs by component.
    async findBy(query, limit, skip) {
        try {
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
            const applicationLogs = await ApplicationLogModel.find(query)
                .sort([['createdAt', -1]])
                .limit(limit)
                .skip(skip)
                .populate('componentId', 'name');
            return applicationLogs;
        } catch (error) {
            ErrorService.log('applicationLogService.findBy', error);
            throw error;
        }
    },

    async findOneBy(query) {
        try {
            if (!query) {
                query = {};
            }

            if (!query.deleted) query.deleted = false;
            const applicationLog = await ApplicationLogModel.findOne(
                query
            ).populate('componentId', 'name');
            return applicationLog;
        } catch (error) {
            ErrorService.log('applicationLogService.findOneBy', error);
            throw error;
        }
    },
};

const ApplicationLogModel = require('../models/applicationLog');
const ErrorService = require('./errorService');
const ComponentService = require('./componentService');
const _ = require('lodash');
