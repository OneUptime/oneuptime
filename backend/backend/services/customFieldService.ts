import CustomFieldModel from '../models/customField'
import IncomingRequestService from '../services/incomingRequestService'
import handleSelect from '../utils/select'
import handlePopulate from '../utils/populate'

export default {
    findOneBy: async function({
        query,
        select,
        populate
    }: $TSFixMe) {
        if (!query) {
            query = {};
        }

        query.deleted = false;
        let customFieldQuery = CustomFieldModel.findOne(query).lean();

        customFieldQuery = handleSelect(select, customFieldQuery);
        customFieldQuery = handlePopulate(populate, customFieldQuery);

        const customField = await customFieldQuery;
        return customField;
    },

    create: async function(data: $TSFixMe) {
        let customField = await CustomFieldModel.create({
            ...data,
        });

        const populateCustomField = [{ path: 'projectId', select: 'name' }];
        const selectCustomField = 'fieldName fieldType projectId uniqueField';
        customField = await this.findOneBy({
            query: { _id: customField._id },
            populate: populateCustomField,
            select: selectCustomField,
        });

        return customField;
    },

    updateOneBy: async function(query: $TSFixMe, data: $TSFixMe) {
        const _this = this;

        if (!query) {
            query = {};
        }

        if (!query.deleted) query.deleted = false;

        const oldCustomField = await CustomFieldModel.findOneAndUpdate(query, {
            $set: data,
        });

        // fetch all the corresponding incoming request
        // and update the custom fields

        const populateCustomField = [{ path: 'projectId', select: 'name' }];
        const selectCustomField = 'fieldName fieldType projectId uniqueField';
        const selectIncomingRequest =
            'name projectId monitors isDefault selectAllMonitors createIncident acknowledgeIncident resolveIncident updateIncidentNote updateInternalNote noteContent incidentState url enabled incidentTitle incidentType incidentPriority incidentDescription customFields filterMatch filters createSeparateIncident post_statuspage deleted';

        const populateIncomingRequest = [
            {
                path: 'monitors.monitorId',
                select: 'name customFields componentId deleted',
                populate: [{ path: 'componentId', select: 'name' }],
            },
            { path: 'projectId', select: 'name' },
        ];
        const [customField, incomingRequests] = await Promise.all([
            _this.findOneBy({
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
            const data = {
                customFields: [],
            };
            for (const field of request.customFields) {
                if (field.fieldName === oldCustomField.fieldName) {
                    field.fieldName = customField.fieldName;
                    field.fieldType = customField.fieldType;
                    field.uniqueField = customField.uniqueField;
                }
                // @ts-expect-error ts-migrate(2345) FIXME: Argument of type 'any' is not assignable to parame... Remove this comment to see the full error message
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
            const error = new Error('Custom field not found or does not exist');
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'code' does not exist on type 'Error'.
            error.code = 400;
            throw error;
        }

        return customField;
    },

    findBy: async function({
        query,
        limit,
        skip,
        populate,
        select
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
        let customFieldsQuery = CustomFieldModel.find(query)
            .limit(limit)
            .skip(skip)
            .sort({ createdAt: -1 })
            .lean();

        customFieldsQuery = handleSelect(select, customFieldsQuery);
        customFieldsQuery = handlePopulate(populate, customFieldsQuery);

        const customFields = await customFieldsQuery;

        return customFields;
    },

    countBy: async function(query: $TSFixMe) {
        if (!query) {
            query = {};
        }
        query.deleted = false;
        const count = await CustomFieldModel.countDocuments(query);
        return count;
    },

    deleteBy: async function(query: $TSFixMe) {
        // when a custom field is deleted
        // it should be removed from the corresponding incoming request
        const select =
            'name projectId monitors isDefault selectAllMonitors createIncident acknowledgeIncident resolveIncident updateIncidentNote updateInternalNote noteContent incidentState url enabled incidentTitle incidentType incidentPriority incidentDescription customFields filterMatch filters createSeparateIncident post_statuspage deleted';

        const populate = [
            {
                path: 'monitors.monitorId',
                select: 'name customFields componentId deleted',
                populate: [{ path: 'componentId', select: 'name' }],
            },
            { path: 'projectId', select: 'name' },
        ];
        const [customField, incomingRequests] = await Promise.all([
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
            const data = {
                customFields: [],
            };
            data.customFields = request.customFields.filter(
                (field: $TSFixMe) => field.fieldName !== customField.fieldName
            );

            // make the update synchronous
            // so we can propagate the update in the background
            IncomingRequestService.updateCustomFieldBy(
                { projectId: query.projectId, _id: request._id },
                data
            );
        }

        if (!customField) {
            const error = new Error('Custom field not found or does not exist');
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'code' does not exist on type 'Error'.
            error.code = 400;
            throw error;
        }

        return customField;
    },

    updateBy: async function(query: $TSFixMe, data: $TSFixMe) {
        if (!query) {
            query = {};
        }

        if (!query.deleted) query.deleted = false;
        let updatedCustomField = await CustomFieldModel.updateMany(query, {
            $set: data,
        });

        const populateCustomField = [{ path: 'projectId', select: 'name' }];
        const selectCustomField = 'fieldName fieldType projectId uniqueField';
        updatedCustomField = await this.findBy({
            query,
            select: selectCustomField,
            populate: populateCustomField,
        });
        return updatedCustomField;
    },

    hardDeleteBy: async function(query: $TSFixMe) {
        await CustomFieldModel.deleteMany(query);
        return 'Custom field(s) removed successfully!';
    },
};
