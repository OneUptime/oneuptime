module.exports = {
    create: async function(data) {
        try {
            const incidentSettings = new incidentSettingsModel();
            const { projectId, title, description } = data;
            incidentSettings.projectId = projectId;
            incidentSettings.title = title;
            incidentSettings.description = description;
            return await incidentSettings.save();
        } catch (error) {
            ErrorService.log('IncidentSettingsService.create', error);
            throw error;
        }
    },
    findOne: async function(query) {
        try {
            if (!query) query = {};
            if (!query.deleted) query.deleted = false;
            const incidentSettings = await incidentSettingsModel.findOne(query);
            if( !incidentSettings)
                return incidentDefaultSettings;
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
                { new: true }
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
const incidentDefaultSettings = require('../config/incidentDefaultSettings');
