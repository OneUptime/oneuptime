import MonitorCustomFieldModel from '../models/monitorCustomField';

import FindOneBy from '../types/db/FindOneBy';
import FindBy from '../types/db/FindBy';
import Query from '../types/db/Query';

export default {
    findOneBy: async function ({ query, select, populate, sort }: FindOneBy) {
        if (!query) {
            query = {};
        }

        query.deleted = false;
        const customFieldQuery = MonitorCustomFieldModel.findOne(query)
            .sort(sort)
            .lean();

        customFieldQuery.select(select);
        customFieldQuery.populate(populate);

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

    updateOneBy: async function (query: Query, data: $TSFixMe) {
        if (!query) {
            query = {};
        }

        if (!query['deleted']) query['deleted'] = false;

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
        populate,
        select,
        sort,
    }: FindBy) {
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
        const customFieldsQuery = MonitorCustomFieldModel.find(query)
            .limit(limit.toNumber())
            .skip(skip.toNumber())
            .sort(sort)
            .lean();

        customFieldsQuery.select(select);
        customFieldsQuery.populate(populate);

        const customFields = await customFieldsQuery;

        return customFields;
    },

    countBy: async function (query: Query) {
        if (!query) {
            query = {};
        }
        query.deleted = false;
        const count = await MonitorCustomFieldModel.countDocuments(query);
        return count;
    },

    deleteBy: async function (query: Query) {
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

    updateBy: async function (query: Query, data: $TSFixMe) {
        if (!query) {
            query = {};
        }

        if (!query['deleted']) query['deleted'] = false;
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

    hardDeleteBy: async function (query: Query) {
        await MonitorCustomFieldModel.deleteMany(query);
        return 'Monitor Custom field(s) removed successfully!';
    },
};
