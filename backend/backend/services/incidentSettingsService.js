module.exports = {
    create: async (data) => {
        try {
            const incidentSettings = new incidentSettingsModel();
            const { projectId, title, description, IncidentPriority } = data;
            incidentSettings.projectId = projectId;
            incidentSettings.title = title;
            incidentSettings.description = description;
            incidentSettings.IncidentPriority = IncidentPriority;
            return await incidentSettings.save();
        } catch (error) {
            ErrorService.log('IncidentSettingsService.create', error);
            throw error;
        }
    },
    findOne: async (query) => {
        try {
            if (!query) query = {};
            if (!query.deleted) query.deleted = false;
            const incidentSettings = await incidentSettingsModel.findOne(query);
            if (!incidentSettings) {
                const {projectId} = query;
                if(!projectId)
                    return incidentDefaultSettings;
                const incidentPriority = await IncidentPrioritiesService.findOne({
                    deleted:false,
                    projectId,
                    name:'High'
                });
                if(!incidentPriority)
                    return incidentDefaultSettings;
                return {
                    ...incidentDefaultSettings,
                    incidentPriority: incidentPriority._id,
                };
            }
            return incidentSettings;
        } catch (error) {
            ErrorService.log('IncidentSettingsService.findOne', error);
            throw error;
        }
    },
    UpdateOne: async function(query, data) {
        try {
            if (!query) query = {};
            if (!query.deleted) query.deleted = false;
            const incidentSettings = await incidentSettingsModel.findOneAndUpdate(
                query,
                {
                    $set: data,
                },
                {
                    upsert: true,
                }
            );
            return incidentSettings;
        } catch (error) {
            ErrorService.log('IncidentSettingsService.updateOne', error);
            throw error;
        }
    },
};

const ErrorService = require('./errorService');
const incidentSettingsModel = require('../models/incidentSettings');
const {
    incidentDefaultSettings,
} = require('../config/incidentDefaultSettings');
