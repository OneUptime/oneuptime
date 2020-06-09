module.exports = {
    create: async function (data) {
        try {
            const _this = this;
            // try to get the application log by the ID and key
            let applicationLog = await ApplicationLogService.findOneBy({
                _id: data.applicationLogId,
                key: data.applicationLogKey
            });
            // send an error if the application log doesnt exist
            if (!applicationLog) {
                const error = new Error('Application Log does not exist.');
                error.code = 400;
                ErrorService.log('contentLogService.create', error);
                throw error;
            }
            
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
};

const ContentLogModel = require('../models/contentLog');
const ErrorService = require('./errorService');
const ApplicationLogService = require('./applicationLogService');
