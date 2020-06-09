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
};

const ContentLogModel = require('../models/contentLog');
const ErrorService = require('./errorService');
const ApplicationLogService = require('./applicationLogService');
