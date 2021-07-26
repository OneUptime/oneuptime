module.exports = {
    create: async function(data) {
        try {
            const {
                projectId,
                title,
                description,
                incidentPriority,
                isDefault,
                name,
            } = data;

            const incidentSetting = await this.findOne({
                projectId,
                name,
            });
            if (incidentSetting) {
                const error = new Error(
                    'Incident template with this name already exist in project'
                );
                error.code = 400;
                throw error;
            }

            const incidentSettings = new incidentSettingsModel();
            if (isDefault) {
                // there can only be one default incident settings per project
                await incidentSettingsModel.findOneAndUpdate(
                    {
                        projectId,
                        isDefault: true,
                    },
                    {
                        $set: { isDefault: false },
                    }
                );
            }
            incidentSettings.projectId = projectId;
            incidentSettings.title = title;
            incidentSettings.description = description;
            incidentSettings.incidentPriority = incidentPriority;
            incidentSettings.isDefault = isDefault || false;
            incidentSettings.name = name;
            return await incidentSettings.save();
        } catch (error) {
            ErrorService.log('IncidentSettingsService.create', error);
            throw error;
        }
    },
    findBy: async function({ query, limit, skip, select, populate }) {
        try {
            if (!skip) skip = 0;

            if (!limit) limit = 0;

            if (typeof skip === 'string') skip = Number(skip);

            if (typeof limit === 'string') limit = Number(limit);

            if (!query) query = {};

            if (!query.deleted) query.deleted = false;

            let responseQuery = incidentSettingsModel
                .find(query)
                .lean()
                .sort([['createdAt', -1]])
                .limit(limit)
                .skip(skip);

            responseQuery = handleSelect(select, responseQuery);
            responseQuery = handlePopulate(populate, responseQuery);
            const result = await responseQuery;

            return await result;
        } catch (error) {
            ErrorService.log('IncidentSettingsService.findBy', error);
            throw error;
        }
    },
    async countBy(query) {
        try {
            if (!query) {
                query = {};
            }

            if (!query.deleted) query.deleted = false;
            return await incidentSettingsModel.countDocuments(query);
        } catch (error) {
            ErrorService.log('IncidentSettingsService.countBy', error);
            throw error;
        }
    },
    findOne: async ({ query, select, populate }) => {
        try {
            if (!query) query = {};
            if (!query.deleted) query.deleted = false;

            let responseQuery = incidentSettingsModel.findOne(query).lean();
            responseQuery = handleSelect(select, responseQuery);
            responseQuery = handlePopulate(populate, responseQuery);

            const incidentSettings = await responseQuery;
            return incidentSettings;
        } catch (error) {
            ErrorService.log('IncidentSettingsService.findOne', error);
            throw error;
        }
    },
    updateOne: async function(query, data) {
        try {
            if (!query) query = {};
            if (!query.deleted) query.deleted = false;

            if (data.name && query.projectId && query._id) {
                const incidentSetting = await this.findOne({
                    projectId: query.projectId,
                    name: data.name,
                    _id: { $ne: query._id },
                });

                if (incidentSetting) {
                    const error = new Error(
                        'Incident template with this name already exist in project'
                    );
                    error.code = 400;
                    throw error;
                }
            }

            if (data.isDefault && query.projectId && query._id) {
                // there can only be one default incident settings per project
                // set any previous isDefault to false
                await incidentSettingsModel.findOneAndUpdate(
                    {
                        projectId: query.projectId,
                        _id: { $ne: query._id },
                        isDefault: true,
                    },
                    { $set: { isDefault: false } }
                );
            }

            await incidentSettingsModel.findOneAndUpdate(
                query,
                {
                    $set: data,
                },
                {
                    upsert: true,
                }
            );
            const incidentSettings = await this.findOne(query);
            return incidentSettings;
        } catch (error) {
            ErrorService.log('IncidentSettingsService.updateOne', error);
            throw error;
        }
    },
    updateBy: async (query, data) => {
        try {
            if (!query) {
                query = {};
            }

            if (!query.deleted) query.deleted = false;
            let updatedData = await incidentSettingsModel.updateMany(query, {
                $set: data,
            });
            updatedData = await this.findBy(query);
            return updatedData;
        } catch (error) {
            ErrorService.log('IncidentSettingsService.updateBy', error);
            throw error;
        }
    },
    deleteBy: async function(query) {
        try {
            const incidentSetting = await this.findOne(query);
            if (incidentSetting.isDefault) {
                const error = new Error('Default template cannot be deleted');
                error.code = 400;
                throw error;
            }

            const deletedIncidentSetting = await incidentSettingsModel.findOneAndUpdate(
                query,
                {
                    $set: {
                        deleted: true,
                        deletedAt: Date.now(),
                    },
                },
                { new: true }
            );

            return deletedIncidentSetting;
        } catch (error) {
            ErrorService.log('incidentCommunicationSlaService.deleteBy', error);
            throw error;
        }
    },
    hardDeleteBy: async function(query) {
        try {
            await incidentSettingsModel.deleteMany(query);
            return 'Incident setting(s) removed successfully!';
        } catch (error) {
            ErrorService.log('IncidentSettingsService.hardDeleteBy', error);
            throw error;
        }
    },
};

const ErrorService = require('./errorService');
const incidentSettingsModel = require('../models/incidentSettings');
const handleSelect = require('../utils/select');
const handlePopulate = require('../utils/populate');
