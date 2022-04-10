import MonitorCustomFieldModel from '../Models/monitorCustomField';

import FindOneBy from '../Types/DB/FindOneBy';
import FindBy from '../Types/DB/FindBy';
import Query from '../Types/DB/Query';

export default class Service {
    async findOneBy({ query, select, populate, sort }: FindOneBy) {
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
    }

    async create(data: $TSFixMe) {
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
    }

    async updateOneBy(query: Query, data: $TSFixMe) {
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
    }

    async findBy({ query, limit, skip, populate, select, sort }: FindBy) {
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
    }

    async countBy(query: Query) {
        if (!query) {
            query = {};
        }
        query.deleted = false;
        const count = await MonitorCustomFieldModel.countDocuments(query);
        return count;
    }

    async deleteBy(query: Query) {
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
    }

    async updateBy(query: Query, data: $TSFixMe) {
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
    }

    async hardDeleteBy(query: Query) {
        await MonitorCustomFieldModel.deleteMany(query);
        return 'Monitor Custom field(s) removed successfully!';
    }
}
