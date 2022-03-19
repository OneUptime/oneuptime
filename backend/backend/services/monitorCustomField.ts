import MonitorCustomFieldModel from '../models/monitorCustomField';
import handleSelect from '../utils/select';
import handlePopulate from '../utils/populate';

export default {
    findOneBy: async function ({ query, select, populate }: $TSFixMe) {
        if (!query) {
            query = {};
        }

        query.deleted = false;
        let customFieldQuery = MonitorCustomFieldModel.findOne(query).lean();

        customFieldQuery = handleSelect(select, customFieldQuery);
        customFieldQuery = handlePopulate(populate, customFieldQuery);

        const customField = await customFieldQuery;
        return customField;
    },

    create: async function (data: $TSFixMe) {
        let customField = await MonitorCustomFieldModel.create({
            ...data,
        });

        const selectMonCustomField =
            'fieldName fieldType projectId uniqueField deleted';

        const populateMonCustomField = [{ path: 'projectId', select: 'name' }];
        customField = await this.findOneBy({
            query: { _id: customField._id },
            populate: populateMonCustomField,
            select: selectMonCustomField,
        });

        return customField;
    },

    updateOneBy: async function (query: $TSFixMe, data: $TSFixMe) {
        if (!query) {
            query = {};
        }

        if (!query.deleted) query.deleted = false;

        let customField = await MonitorCustomFieldModel.findOneAndUpdate(
            query,
            {
                $set: data,
            },
            { new: true }
        );

        const selectMonCustomField =
            'fieldName fieldType projectId uniqueField deleted';

        const populateMonCustomField = [{ path: 'projectId', select: 'name' }];
        customField = await this.findOneBy({
            query,
            select: selectMonCustomField,
            populate: populateMonCustomField,
        });

        if (!customField) {
            const error = new Error('Custom field not found or does not exist');

            error.code = 400;
            throw error;
        }

        return customField;
    },

    findBy: async function ({
        query,
        limit,
        skip,
        select,
        populate,
    }: $TSFixMe) {
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
    },

    countBy: async function (query: $TSFixMe) {
        if (!query) {
            query = {};
        }
        query.deleted = false;
        const count = await MonitorCustomFieldModel.countDocuments(query);
        return count;
    },

    deleteBy: async function (query: $TSFixMe) {
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
            const error = new Error('Custom field not found or does not exist');

            error.code = 400;
            throw error;
        }

        return customField;
    },

    updateBy: async function (query: $TSFixMe, data: $TSFixMe) {
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

        const populateMonCustomField = [{ path: 'projectId', select: 'name' }];
        updatedCustomField = await this.findBy({
            query,
            select: selectMonCustomField,
            populate: populateMonCustomField,
        });
        return updatedCustomField;
    },

    hardDeleteBy: async function (query: $TSFixMe) {
        await MonitorCustomFieldModel.deleteMany(query);
        return 'Monitor Custom field(s) removed successfully!';
    },
};
