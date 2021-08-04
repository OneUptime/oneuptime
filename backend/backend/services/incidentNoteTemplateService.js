const IncidentNoteTemplateModel = require('../models/incidentNoteTemplate');
const ErrorService = require('./errorService');

module.exports = {
    findBy: async function({ query = {}, limit, skip }) {
        try {
            if (!skip) skip = 0;

            if (!limit) limit = 0;

            if (typeof skip === 'string') skip = Number(skip);

            if (typeof limit === 'string') limit = Number(limit);

            if (!query.deleted) query.deleted = false;

            return await IncidentNoteTemplateModel.find(query)
                .lean()
                .sort([['createdAt', -1]])
                .limit(limit)
                .skip(skip);
        } catch (error) {
            ErrorService.log('IncidentNoteTemplateService.findBy', error);
            throw error;
        }
    },
    countBy: async function(query = {}) {
        try {
            if (!query.deleted) query.deleted = false;

            return await IncidentNoteTemplateModel.countDocuments(query);
        } catch (error) {
            ErrorService.log('IncidentNoteTemplateService.countBy', error);
            throw error;
        }
    },
    findOneBy: async function(query = {}) {
        try {
            if (!query.deleted) query.deleted = false;

            const incidentNoteTemplate = await IncidentNoteTemplateModel.findOne(
                query
            ).lean();
            return incidentNoteTemplate;
        } catch (error) {
            ErrorService.log('IncidentNoteTemplateService.findOne', error);
            throw error;
        }
    },
    create: async function(data) {
        try {
            const { projectId, name } = data;
            let incidentNoteTemplate = await this.findOneBy({
                projectId,
                name,
            });
            if (incidentNoteTemplate) {
                const error = new Error(
                    'Incident note template with this name already exist in this project'
                );
                error.code = 400;
                throw error;
            }

            incidentNoteTemplate = await IncidentNoteTemplateModel.create(data);
            return incidentNoteTemplate;
        } catch (error) {
            ErrorService.log('IncidentNoteTemplateService.create', error);
            throw error;
        }
    },
    updateOneBy: async function({ query = {}, data }) {
        try {
            if (!query.deleted) query.deleted = false;

            const { projectId, _id } = query;
            let incidentNoteTemplate = null;
            if (data.name) {
                incidentNoteTemplate = await this.findOneBy({
                    projectId,
                    _id: { $ne: _id },
                    name: data.name,
                });
            }
            if (incidentNoteTemplate) {
                const error = new Error(
                    'Incident note template with this name already exist in this project'
                );
                error.code = 400;
                throw error;
            }

            incidentNoteTemplate = await IncidentNoteTemplateModel.findOneAndUpdate(
                query,
                { $set: data },
                { new: true }
            );
            return incidentNoteTemplate;
        } catch (error) {
            ErrorService.log('IncidentNoteTemplateService.updateOneBy', error);
            throw error;
        }
    },
    deleteBy: async function(query) {
        try {
            if (!query) return null;

            const data = {
                deleted: true,
                deletedAt: Date.now(),
            };

            return await this.updateOneBy({ query, data });
        } catch (error) {
            ErrorService.log('IncidentNoteTemplateService.deleteBy', error);
            throw error;
        }
    },
    hardDeleteBy: async function(query) {
        try {
            if (!query) return null;

            await IncidentNoteTemplateModel.deleteMany(query);
            return 'Incident note templates removed successfully';
        } catch (error) {
            ErrorService.log('IncidentNoteTemplateService.hardDeleteBy', error);
            throw error;
        }
    },
};
