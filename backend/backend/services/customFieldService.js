const CustomFieldModel = require('../models/customField');
const ErrorService = require('../services/errorService');
const IncomingRequestService = require('../services/incomingRequestService');

module.exports = {
    findOneBy: async function(query) {
        try {
            if (!query) {
                query = {};
            }

            query.deleted = false;
            const customField = await CustomFieldModel.findOne(query)
                .populate('projectId', 'name')
                .lean();

            return customField;
        } catch (error) {
            ErrorService.log('customFieldService.findOneBy', error);
            throw error;
        }
    },

    create: async function(data) {
        try {
            let customField = await CustomFieldModel.create({
                ...data,
            });

            customField = await customField
                .populate('projectId', 'name')
                .execPopulate();

            return customField;
        } catch (error) {
            ErrorService.log('customFieldService.create', error);
            throw error;
        }
    },

    updateOneBy: async function(query, data) {
        const _this = this;

        if (!query) {
            query = {};
        }

        if (!query.deleted) query.deleted = false;

        try {
            const oldCustomField = await CustomFieldModel.findOneAndUpdate(
                query,
                {
                    $set: data,
                }
            );
            const customField = await _this.findOneBy(query);

            // fetch all the corresponding incoming request
            // and update the custom fields
            const incomingRequests = await IncomingRequestService.findBy({
                projectId: query.projectId,
            });

            for (const request of incomingRequests) {
                const data = {
                    customFields: [],
                };
                for (const field of request.customFields) {
                    if (field.fieldName === oldCustomField.fieldName) {
                        field.fieldName = customField.fieldName;
                        field.fieldType = customField.fieldType;
                        field.uniqueField = customField.uniqueField;
                    }
                    data.customFields.push(field);
                }

                // make the update synchronous
                // so we can propagate the update in the background
                IncomingRequestService.updateCustomFieldBy(
                    { projectId: query.projectId, _id: request._id },
                    data
                );
            }

            if (!customField) {
                const error = new Error(
                    'Custom field not found or does not exist'
                );
                error.code = 400;
                throw error;
            }

            return customField;
        } catch (error) {
            ErrorService.log('customFieldService.updateOneBy', error);
            throw error;
        }
    },

    findBy: async function(query, limit, skip) {
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
            const customFields = await CustomFieldModel.find(query)
                .limit(limit)
                .skip(skip)
                .sort({ createdAt: -1 })
                .populate('projectId', 'name')
                .lean();

            return customFields;
        } catch (error) {
            ErrorService.log('customFieldService.findBy', error);
            throw error;
        }
    },

    countBy: async function(query) {
        try {
            if (!query) {
                query = {};
            }
            query.deleted = false;
            const count = await CustomFieldModel.countDocuments(query);
            return count;
        } catch (error) {
            ErrorService.log('customFieldService.countBy', error);
            throw error;
        }
    },

    deleteBy: async function(query) {
        try {
            const customField = await CustomFieldModel.findOneAndUpdate(
                query,
                {
                    $set: {
                        deleted: true,
                        deletedAt: Date.now(),
                    },
                },
                { new: true }
            );

            // when a custom field is deleted
            // it should be removed from the corresponding incoming request
            const incomingRequests = await IncomingRequestService.findBy({
                projectId: query.projectId,
            });

            for (const request of incomingRequests) {
                const data = {
                    customFields: [],
                };
                data.customFields = request.customFields.filter(
                    field => field.fieldName !== customField.fieldName
                );

                // make the update synchronous
                // so we can propagate the update in the background
                IncomingRequestService.updateCustomFieldBy(
                    { projectId: query.projectId, _id: request._id },
                    data
                );
            }

            if (!customField) {
                const error = new Error(
                    'Custom field not found or does not exist'
                );
                error.code = 400;
                throw error;
            }

            return customField;
        } catch (error) {
            ErrorService.log('customFieldService.deleteBy', error);
            throw error;
        }
    },

    updateBy: async function(query, data) {
        try {
            if (!query) {
                query = {};
            }

            if (!query.deleted) query.deleted = false;
            let updatedCustomField = await CustomFieldModel.updateMany(query, {
                $set: data,
            });
            updatedCustomField = await this.findBy(query);
            return updatedCustomField;
        } catch (error) {
            ErrorService.log('customFieldService.updateMany', error);
            throw error;
        }
    },

    hardDeleteBy: async function(query) {
        try {
            await CustomFieldModel.deleteMany(query);
            return 'Custom field(s) removed successfully!';
        } catch (error) {
            ErrorService.log('customFieldService.hardDeleteBy', error);
            throw error;
        }
    },
};
