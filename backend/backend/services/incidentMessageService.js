module.exports = {
    create: async function(data) {
        try {
            let incidentMessage = new IncidentMessageModel();

            incidentMessage.content = data.content;
            incidentMessage.incidentId = data.incidentId;
            incidentMessage.createdById = data.createdById;
            incidentMessage.type = data.type;

            incidentMessage = await incidentMessage.save();
            incidentMessage = await this.findOneBy({
                _id: incidentMessage._id,
            });

            return incidentMessage;
        } catch (error) {
            ErrorService.log('incidentMessageService.create', error);
            throw error;
        }
    },
    updateOneBy: async function(query, data) {
        try {
            if (!query) {
                query = {};
            }

            if (!query.deleted) query.deleted = false;
            let incidentMessage = await IncidentMessageModel.findOneAndUpdate(
                query,
                { $set: data },
                {
                    new: true,
                }
            );

            incidentMessage = await this.findOneBy(query);

            //await RealTimeService.applicationLogKeyReset(applicationLog);

            return incidentMessage;
        } catch (error) {
            ErrorService.log('incidentMessageService.updateOneBy', error);
            throw error;
        }
    },
    async findOneBy(query) {
        try {
            if (!query) {
                query = {};
            }

            if (!query.deleted) query.deleted = false;
            const incidentMessage = await IncidentMessageModel.findOne(
                query
            ).populate('incidentId', 'name');
            return incidentMessage;
        } catch (error) {
            ErrorService.log('incidentMessageService.findOneBy', error);
            throw error;
        }
    },
};

const IncidentMessageModel = require('../models/incidentMessage');
const ErrorService = require('./errorService');
