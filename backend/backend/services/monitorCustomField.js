const MonitorCustomFieldModel = require('../models/monitorCustomField');
const ErrorService = require('../services/errorService');
const handleSelect = require('../utils/select');
const handlePopulate = require('../utils/populate');

module.exports = {
    findOneBy: async function({ query, select, populate }) {
        try {
            if (!query) {
                query = {};
            }

            query.deleted = false;
            let customFieldQuery = MonitorCustomFieldModel.findOne(
                query
            ).lean();

            customFieldQuery = handleSelect(select, customFieldQuery);
            customFieldQuery = handlePopulate(populate, customFieldQuery);

            const customField = await customFieldQuery;
            return customField;
        } catch (error) {
            ErrorService.log('monitorCustomFieldService.findOneBy', error);
            throw error;
        }
    },

    create: async function(data) {
        try {
            let customField = await MonitorCustomFieldModel.create({
                ...data,
            });

            const selectMonCustomField =
                'fieldName fieldType projectId uniqueField deleted';

            const populateMonCustomField = [
                { path: 'projectId', select: 'name' },
            ];
            customField = await this.findOneBy({
                query: { _id: customField._id },
                populate: populateMonCustomField,
                select: selectMonCustomField,
            });

            return customField;
        } catch (error) {
            ErrorService.log('monitorCustomFieldService.create', error);
            throw error;
        }
    },

    updateOneBy: async function(query, data) {
        if (!query) {
            query = {};
        }

        if (!query.deleted) query.deleted = false;

        try {
            let customField = await MonitorCustomFieldModel.findOneAndUpdate(
                query,
                {
                    $set: data,
                },
                { new: true }
            );

            const selectMonCustomField =
                'fieldName fieldType projectId uniqueField deleted';

            const populateMonCustomField = [
                { path: 'projectId', select: 'name' },
            ];
            customField = await this.findOneBy({
                query,
                select: selectMonCustomField,
                populate: populateMonCustomField,
            });

            if (!customField) {
                const error = new Error(
                    'Custom field not found or does not exist'
                );
                error.code = 400;
                throw error;
            }

            return customField;
        } catch (error) {
            ErrorService.log('monitorCustomFieldService.updateOneBy', error);
            throw error;
        }
    },

    findBy: async function({ query, limit, skip, select, populate }) {
        try {
            if (!skip || isNaN(skip)) skip = 0;

            if (!limit || isNaN(limit)) limit = 0;

            if (typeof skip === 'string') {
                skip = Number(skip);
            }

            if (typeof limit === 'string') {
                limit = Number(limit);
            }

            if (!query) {
                query = {};
            }

            query.deleted = false;
            let customFieldsQuery = MonitorCustomFieldModel.find(query)
                .limit(limit)
                .skip(skip)
                .sort({ createdAt: -1 })
                .lean();

            customFieldsQuery = handleSelect(select, customFieldsQuery);
            customFieldsQuery = handlePopulate(populate, customFieldsQuery);

            const customFields = await customFieldsQuery;

            return customFields;
        } catch (error) {
            ErrorService.log('monitorCustomFieldService.findBy', error);
            throw error;
        }
    },

    countBy: async function(query) {
        try {
            if (!query) {
                query = {};
            }
            query.deleted = false;
            const count = await MonitorCustomFieldModel.countDocuments(query);
            return count;
        } catch (error) {
            ErrorService.log('monitorCustomFieldService.countBy', error);
            throw error;
        }
    },

    deleteBy: async function(query) {
        try {
            const customField = await MonitorCustomFieldModel.findOneAndUpdate(
                query,
                {
                    $set: {
                        deleted: true,
                        deletedAt: Date.now(),
                    },
                },
                { new: true }
            );

            if (!customField) {
                const error = new Error(
                    'Custom field not found or does not exist'
                );
                error.code = 400;
                throw error;
            }

            return customField;
        } catch (error) {
            ErrorService.log('monitorCustomFieldService.deleteBy', error);
            throw error;
        }
    },

    updateBy: async function(query, data) {
        try {
            if (!query) {
                query = {};
            }

            if (!query.deleted) query.deleted = false;
            let updatedCustomField = await MonitorCustomFieldModel.updateMany(
                query,
                {
                    $set: data,
                }
            );

            const selectMonCustomField =
                'fieldName fieldType projectId uniqueField deleted';

            const populateMonCustomField = [
                { path: 'projectId', select: 'name' },
            ];
            updatedCustomField = await this.findBy({
                query,
                select: selectMonCustomField,
                populate: populateMonCustomField,
            });
            return updatedCustomField;
        } catch (error) {
            ErrorService.log('monitorCustomFieldService.updateMany', error);
            throw error;
        }
    },

    hardDeleteBy: async function(query) {
        try {
            await MonitorCustomFieldModel.deleteMany(query);
            return 'Monitor Custom field(s) removed successfully!';
        } catch (error) {
            ErrorService.log('monitorCustomFieldService.hardDeleteBy', error);
            throw error;
        }
    },
};
