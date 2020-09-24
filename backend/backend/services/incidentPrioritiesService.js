module.exports = {
    findBy: async function(query, limit, skip) {
        try {
            if (typeof limit === 'string') limit = parseInt(limit);
            if (typeof skip === 'string') skip = parseInt(skip);
            if (!query) query = {};
            if (!query.deleted) query.deleted = false;

            const incidentPriorities = await incidentPriorityModel
                .find(query)
                .limit(limit)
                .skip(skip);

            return incidentPriorities;
        } catch (error) {
            ErrorService.log('IncidentPrioritiesService.findBy', error);
            throw error;
        }
    },
    findOne: async function(query) {
        try {
            if (!query) {
                query = {};
            }
            query.deleted = false;
            const incidentPriorities = await incidentPriorityModel.findOne(
                query
            );
            return incidentPriorities;
        } catch (error) {
            ErrorService.log('IncidentPrioritiesService.findOne', error);
            throw error;
        }
    },
    countBy: async function(query) {
        try {
            if (!query) {
                query = {};
            }
            if (!query.deleted) query.deleted = false;

            const count = await incidentPriorityModel.countDocuments(query);

            return count;
        } catch (error) {
            ErrorService.log('IncidentPrioritiesService.countBy', error);
            throw error;
        }
    },
    create: async function(data) {
        try {
            const incidentPriority = new incidentPriorityModel();
            const { projectId, name, color } = data;
            incidentPriority.projectId = projectId;
            incidentPriority.name = name;
            incidentPriority.color = color;
            await incidentPriority.save();
            return incidentPriority;
        } catch (error) {
            ErrorService.log('IncidentPrioritiesService.create', error);
            throw error;
        }
    },
    updateOne: async function(query, data) {
        try {
            if (!query) {
                query = {};
            }
            if (!query.deleted) query.deleted = false;
            const updatedIncidentPriority = await incidentPriorityModel.findOneAndUpdate(
                query,
                {
                    $set: data,
                },
                { new: true }
            );
            return updatedIncidentPriority;
        } catch (error) {
            ErrorService.log('IncidentPrioritiesService.updateOneBy', error);
            throw error;
        }
    },
    deleteBy: async function(query) {
        try {
            if (!query) {
                query = {};
            }
            query.deleted = false;
            const incidentPriority = await incidentPriorityModel.findOneAndUpdate(
                query,
                {
                    $set: {
                        deleted: true,
                        deletedAt: Date.now(),
                    },
                }
            );
            if (incidentPriority === null) return incidentPriority;
            //update existing incidents along with default incident settings
            await IncidentService.updateBy(
                {
                    incidentPriority: incidentPriority._id,
                },
                {
                    incidentPriority: null,
                }
            );
            await IncidentSettingsService.updateOne(
                {
                    incidentPriority: incidentPriority._id,
                },
                {
                    incidentPriority: null,
                }
            );
            return incidentPriority;
        } catch (error) {
            ErrorService.log(
                'IncidentPrioritiesService.findOneAndUpdate',
                error
            );
            throw error;
        }
    },
};

const ErrorService = require('./errorService');
const IncidentSettingsService = require('./incidentSettingsService');
const IncidentService = require('./incidentService');
const incidentPriorityModel = require('../models/incidentPriority');
