module.exports = {
    create: async function (data) {
        try {
            const _this = this;
            
            // prepare  log model
            let contentLog = new ContentLogModel();
            contentLog.content = data.content;
            contentLog.applicationLogId = data.applicationLogId;
            contentLog.createdById = data.createdById;
            const savedContentLog = await contentLog.save();
            contentLog = await _this.findOneBy({
                _id: savedContentLog._id,
            });
            return contentLog;
        } catch (error) {
            ErrorService.log('contentLogService.create', error);
            throw error;
        }
    },
    async findOneBy(query) {
        try {
            if (!query) {
                query = {};
            }

            if (!query.deleted) query.deleted = false;
            const contentLog = await ContentLogModel.findOne(
                query
            ).populate('applicationLogId', 'name');
            return contentLog;
        } catch (error) {
            ErrorService.log('contentLogService.findOneBy', error);
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
            const contentLogs = await ContentLogModel.find(query)
                .sort([['createdAt', -1]])
                .limit(limit)
                .skip(skip)
                .populate('applicationLogId', 'name');
            return contentLogs;
        } catch (error) {
            ErrorService.log('contentLogService.findBy', error);
            throw error;
        }
    },
    async getContentLogsApplicationLogId(applicationLogId, limit, skip) {
        // try to get the application log by the ID
        let applicationLog = await ApplicationLogService.findOneBy({
            _id: applicationLogId,
        });
        // send an error if the component doesnt exist
        if (!applicationLog) {
            const error = new Error('Application Log does not exist.');
            error.code = 400;
            ErrorService.log(
                'contentLogService.getContentLogsApplicationLogId',
                error
            );
            throw error;
        }

        try {
            if (typeof limit === 'string') limit = parseInt(limit);
            if (typeof skip === 'string') skip = parseInt(skip);
            const _this = this;

            const contentLogs = await _this.findBy(
                { applicationLogId: applicationLogId },
                limit,
                skip
            );
            return contentLogs;
        } catch (error) {
            ErrorService.log(
                'contentLogService.getContentLogsApplicationLogId',
                error
            );
            throw error;
        }
    },
};

const ContentLogModel = require('../models/contentLog');
const ErrorService = require('./errorService');
const ApplicationLogService = require('./applicationLogService');
