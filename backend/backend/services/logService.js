module.exports = {
    create: async function (data) {
        try {
            const _this = this;
            
            // prepare  log model
            let log = new LogModel();
            log.content = data.content;
            log.applicationLogId = data.applicationLogId;
            log.createdById = data.createdById;
            const savedlog = await log.save();
            log = await _this.findOneBy({
                _id: savedlog._id,
            });
            return log;
        } catch (error) {
            ErrorService.log('logService.create', error);
            throw error;
        }
    },
    async findOneBy(query) {
        try {
            if (!query) {
                query = {};
            }

            if (!query.deleted) query.deleted = false;
            const log = await LogModel.findOne(
                query
            ).populate('applicationLogId', 'name');
            return log;
        } catch (error) {
            ErrorService.log('logService.findOneBy', error);
            throw error;
        }
    },
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
            const logs = await LogModel.find(query)
                .sort([['createdAt', -1]])
                .limit(limit)
                .skip(skip)
                .populate('applicationLogId', 'name');
            return logs;
        } catch (error) {
            ErrorService.log('logService.findBy', error);
            throw error;
        }
    },
    async getLogsByApplicationLogId(applicationLogId, limit, skip) {
        // try to get the application log by the ID
        let applicationLog = await ApplicationLogService.findOneBy({
            _id: applicationLogId,
        });
        // send an error if the component doesnt exist
        if (!applicationLog) {
            const error = new Error('Application Log does not exist.');
            error.code = 400;
            ErrorService.log(
                'logService.getLogsByApplicationLogId',
                error
            );
            throw error;
        }

        try {
            if (typeof limit === 'string') limit = parseInt(limit);
            if (typeof skip === 'string') skip = parseInt(skip);
            const _this = this;

            const logs = await _this.findBy(
                { applicationLogId: applicationLogId },
                limit,
                skip
            );
            return logs;
        } catch (error) {
            ErrorService.log(
                'logService.getLogsByApplicationLogId',
                error
            );
            throw error;
        }
    },
};

const LogModel = require('../models/log');
const ErrorService = require('./errorService');
const ApplicationLogService = require('./applicationLogService');
