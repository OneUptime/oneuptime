import MonitorCustomFieldModel from '../Models/monitorCustomField';
import BadDataException from 'Common/Types/Exception/BadDataException';
import FindOneBy from '../Types/DB/FindOneBy';
import FindBy from '../Types/DB/FindBy';
import Query from '../Types/DB/Query';

export default class Service {
    async findOneBy({ query, select, populate, sort }: FindOneBy): void {
        if (!query) {
            query = {};
        }

        query['deleted'] = false;
        const customFieldQuery: $TSFixMe = MonitorCustomFieldModel.findOne(query)
            .sort(sort)
            .lean();

        customFieldQuery.select(select);
        customFieldQuery.populate(populate);

        const customField: $TSFixMe = await customFieldQuery;
        return customField;
    }

    async create(data: $TSFixMe): void {
        let customField = await MonitorCustomFieldModel.create({
            ...data,
        });

        const selectMonCustomField: $TSFixMe =
            'fieldName fieldType projectId uniqueField deleted';

        const populateMonCustomField: $TSFixMe = [{ path: 'projectId', select: 'name' }];
        customField = await this.findOneBy({
            query: { _id: customField._id },
            populate: populateMonCustomField,
            select: selectMonCustomField,
        });

        return customField;
    }

    async updateOneBy(query: Query, data: $TSFixMe): void {
        if (!query) {
            query = {};
        }

        if (!query['deleted']) {
            query['deleted'] = false;
        }

        let customField = await MonitorCustomFieldModel.findOneAndUpdate(
            query,
            {
                $set: data,
            },
            { new: true }
        );

        const selectMonCustomField: $TSFixMe =
            'fieldName fieldType projectId uniqueField deleted';

        const populateMonCustomField: $TSFixMe = [{ path: 'projectId', select: 'name' }];
        customField = await this.findOneBy({
            query,
            select: selectMonCustomField,
            populate: populateMonCustomField,
        });

        if (!customField) {
            throw new BadDataException(
                'Custom field not found or does not exist'
            );
        }

        return customField;
    }

    async findBy({ query, limit, skip, populate, select, sort }: FindBy): void {
        if (!skip || isNaN(skip)) {
            skip = 0;
        }

        if (!limit || isNaN(limit)) {
            limit = 0;
        }

        if (typeof skip === 'string') {
            skip = Number(skip);
        }

        if (typeof limit === 'string') {
            limit = Number(limit);
        }

        if (!query) {
            query = {};
        }

        query['deleted'] = false;
        const customFieldsQuery: $TSFixMe = MonitorCustomFieldModel.find(query)
            .limit(limit.toNumber())
            .skip(skip.toNumber())
            .sort(sort)
            .lean();

        customFieldsQuery.select(select);
        customFieldsQuery.populate(populate);

        const customFields: $TSFixMe = await customFieldsQuery;

        return customFields;
    }

    async countBy(query: Query): void {
        if (!query) {
            query = {};
        }
        query['deleted'] = false;
        const count: $TSFixMe = await MonitorCustomFieldModel.countDocuments(query);
        return count;
    }

    async deleteBy(query: Query): void {
        const customField: $TSFixMe = await MonitorCustomFieldModel.findOneAndUpdate(
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
            throw new BadDataException(
                'Custom field not found or does not exist'
            );
        }

        return customField;
    }

    async updateBy(query: Query, data: $TSFixMe): void {
        if (!query) {
            query = {};
        }

        if (!query['deleted']) {
            query['deleted'] = false;
        }
        let updatedCustomField = await MonitorCustomFieldModel.updateMany(
            query,
            {
                $set: data,
            }
        );

        const selectMonCustomField: $TSFixMe =
            'fieldName fieldType projectId uniqueField deleted';

        const populateMonCustomField: $TSFixMe = [{ path: 'projectId', select: 'name' }];
        updatedCustomField = await this.findBy({
            query,
            select: selectMonCustomField,
            populate: populateMonCustomField,
        });
        return updatedCustomField;
    }
}
