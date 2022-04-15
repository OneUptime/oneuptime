import CustomFieldModel from '../Models/customField';
import IncomingRequestService from './IncomingRequestService';
import BadDataException from 'Common/Types/Exception/BadDataException';
import FindOneBy from '../Types/DB/FindOneBy';
import FindBy from '../Types/DB/FindBy';
import Query from '../Types/DB/Query';

export default class Service {
    public async findOneBy({ query, select, populate, sort }: FindOneBy): void {
        if (!query) {
            query = {};
        }

        query['deleted'] = false;
        const customFieldQuery: $TSFixMe = CustomFieldModel.findOne(query)
            .sort(sort)
            .lean();

        customFieldQuery.select(select);
        customFieldQuery.populate(populate);

        const customField: $TSFixMe = await customFieldQuery;
        return customField;
    }

    public async create(data: $TSFixMe): void {
        let customField: $TSFixMe = await CustomFieldModel.create({
            ...data,
        });

        const populateCustomField: $TSFixMe = [
            { path: 'projectId', select: 'name' },
        ];
        const selectCustomField: string =
            'fieldName fieldType projectId uniqueField';
        customField = await this.findOneBy({
            query: { _id: customField._id },
            populate: populateCustomField,
            select: selectCustomField,
        });

        return customField;
    }

    public async updateOneBy(query: Query, data: $TSFixMe): void {
        if (!query) {
            query = {};
        }

        if (!query['deleted']) {
            query['deleted'] = false;
        }

        const oldCustomField: $TSFixMe =
            await CustomFieldModel.findOneAndUpdate(query, {
                $set: data,
            });

        // fetch all the corresponding incoming request
        // and update the custom fields

        const populateCustomField: $TSFixMe = [
            { path: 'projectId', select: 'name' },
        ];
        const selectCustomField: string =
            'fieldName fieldType projectId uniqueField';
        const selectIncomingRequest: $TSFixMe =
            'name projectId monitors isDefault selectAllMonitors createIncident acknowledgeIncident resolveIncident updateIncidentNote updateInternalNote noteContent incidentState url enabled incidentTitle incidentType incidentPriority incidentDescription customFields filterMatch filters createSeparateIncident post_statuspage deleted';

        const populateIncomingRequest: $TSFixMe = [
            {
                path: 'monitors.monitorId',
                select: 'name customFields componentId deleted',
                populate: [{ path: 'componentId', select: 'name' }],
            },
            { path: 'projectId', select: 'name' },
        ];
        const [customField, incomingRequests]: $TSFixMe = await Promise.all([
            this.findOneBy({
                query,
                select: selectCustomField,
                populate: populateCustomField,
            }),
            IncomingRequestService.findBy({
                query: { projectId: query.projectId },
                select: selectIncomingRequest,
                populate: populateIncomingRequest,
            }),
        ]);

        for (const request of incomingRequests) {
            const data: $TSFixMe = {
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
            throw new BadDataException(
                'Custom field not found or does not exist'
            );
        }

        return customField;
    }

    public async findBy({
        query,
        limit,
        skip,
        populate,
        select,
        sort,
    }: FindBy): void {
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
        const customFieldsQuery: $TSFixMe = CustomFieldModel.find(query)
            .limit(limit.toNumber())
            .skip(skip.toNumber())
            .sort(sort)
            .lean();

        customFieldsQuery.select(select);
        customFieldsQuery.populate(populate);

        const customFields: $TSFixMe = await customFieldsQuery;

        return customFields;
    }

    public async countBy(query: Query): void {
        if (!query) {
            query = {};
        }
        query['deleted'] = false;
        const count: $TSFixMe = await CustomFieldModel.countDocuments(query);
        return count;
    }

    public async deleteBy(query: Query): void {
        // when a custom field is deleted
        // it should be removed from the corresponding incoming request
        const select: $TSFixMe =
            'name projectId monitors isDefault selectAllMonitors createIncident acknowledgeIncident resolveIncident updateIncidentNote updateInternalNote noteContent incidentState url enabled incidentTitle incidentType incidentPriority incidentDescription customFields filterMatch filters createSeparateIncident post_statuspage deleted';

        const populate: $TSFixMe = [
            {
                path: 'monitors.monitorId',
                select: 'name customFields componentId deleted',
                populate: [{ path: 'componentId', select: 'name' }],
            },
            { path: 'projectId', select: 'name' },
        ];
        const [customField, incomingRequests]: $TSFixMe = await Promise.all([
            CustomFieldModel.findOneAndUpdate(
                query,
                {
                    $set: {
                        deleted: true,
                        deletedAt: Date.now(),
                    },
                },
                { new: true }
            ),
            IncomingRequestService.findBy({
                query: { projectId: query.projectId },
                select,
                populate,
            }),
        ]);

        for (const request of incomingRequests) {
            const data: $TSFixMe = {
                customFields: [],
            };
            data.customFields = request.customFields.filter(
                (field: $TSFixMe) => {
                    return field.fieldName !== customField.fieldName;
                }
            );

            // make the update synchronous
            // so we can propagate the update in the background
            IncomingRequestService.updateCustomFieldBy(
                { projectId: query.projectId, _id: request._id },
                data
            );
        }

        if (!customField) {
            throw new BadDataException(
                'Custom field not found or does not exist'
            );
        }

        return customField;
    }

    public async updateBy(query: Query, data: $TSFixMe): void {
        if (!query) {
            query = {};
        }

        if (!query['deleted']) {
            query['deleted'] = false;
        }
        let updatedCustomField: $TSFixMe = await CustomFieldModel.updateMany(
            query,
            {
                $set: data,
            }
        );

        const populateCustomField: $TSFixMe = [
            { path: 'projectId', select: 'name' },
        ];
        const selectCustomField: string =
            'fieldName fieldType projectId uniqueField';
        updatedCustomField = await this.findBy({
            query,
            select: selectCustomField,
            populate: populateCustomField,
        });
        return updatedCustomField;
    }
}
