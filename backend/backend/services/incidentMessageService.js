module.exports = {
    create: async function(data) {
        try {
            let incidentMessage = new IncidentMessageModel();

            incidentMessage.content = data.content;
            incidentMessage.incidentId = data.incidentId;
            incidentMessage.createdById = data.createdById;
            incidentMessage.type = data.type;
            incidentMessage.incident_state = data.incident_state;

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
            data.updated = true;
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
            const incidentMessage = await IncidentMessageModel.findOne(query)
                .populate('incidentId', 'name')
                .populate('createdById', 'name');
            return incidentMessage;
        } catch (error) {
            ErrorService.log('incidentMessageService.findOneBy', error);
            throw error;
        }
    },
    findBy: async function(query, skip, limit) {
        try {
            if (!skip) skip = 0;
            if (!limit) limit = 0;

            if (typeof skip === 'string') skip = parseInt(skip);
            if (typeof limit === 'string') limit = parseInt(limit);

            if (!query) {
                query = {};
            }

            const incidentMessages = await IncidentMessageModel.find(query)
                .sort([['createdAt', -1]]) // fetch from latest to oldest
                .limit(limit)
                .skip(skip)
                .populate('createdById', 'name')
                .populate('incidentId', 'name');

            return incidentMessages;
        } catch (error) {
            ErrorService.log('incidentMessageService.findBy', error);
            throw error;
        }
    },
    countBy: async function(query) {
        try {
            if (!query) {
                query = {};
            }

            const count = await IncidentMessageModel.countDocuments(query);

            return count;
        } catch (error) {
            ErrorService.log('incidentMessageService.countBy', error);
            throw error;
        }
    },
};

const IncidentMessageModel = require('../models/incidentMessage');
const ErrorService = require('./errorService');
