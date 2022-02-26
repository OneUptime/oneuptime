export default {
    create: async function(data: $TSFixMe) {
        const subscriberAlertModel = new SubscriberAlertModel();
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectId' does not exist on type 'Docum... Remove this comment to see the full error message
        subscriberAlertModel.projectId = data.projectId || null;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'subscriberId' does not exist on type 'Do... Remove this comment to see the full error message
        subscriberAlertModel.subscriberId = data.subscriberId || null;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidentId' does not exist on type 'Docu... Remove this comment to see the full error message
        subscriberAlertModel.incidentId = data.incidentId || null;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'alertVia' does not exist on type 'Docume... Remove this comment to see the full error message
        subscriberAlertModel.alertVia = data.alertVia || null;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'alertStatus' does not exist on type 'Doc... Remove this comment to see the full error message
        subscriberAlertModel.alertStatus = data.alertStatus || null;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'eventType' does not exist on type 'Docum... Remove this comment to see the full error message
        subscriberAlertModel.eventType = data.eventType || null;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'totalSubscribers' does not exist on type... Remove this comment to see the full error message
        subscriberAlertModel.totalSubscribers = data.totalSubscribers || 0;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'identification' does not exist on type '... Remove this comment to see the full error message
        subscriberAlertModel.identification = data.id || 0;
        if (data.error) {
            // @ts-expect-error ts-migrate(2551) FIXME: Property 'error' does not exist on type 'Document<... Remove this comment to see the full error message
            subscriberAlertModel.error = data.error;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'errorMessage' does not exist on type 'Do... Remove this comment to see the full error message
            subscriberAlertModel.errorMessage = data.errorMessage;
        }
        const subscriberAlert = await subscriberAlertModel.save();
        return subscriberAlert;
    },

    updateOneBy: async function(query: $TSFixMe, data: $TSFixMe) {
        if (!query) {
            query = {};
        }

        if (!query.deleted) query.deleted = false;
        //find and update
        const subscriberAlert = await SubscriberAlertModel.findOneAndUpdate(
            query,
            {
                $set: data,
            },
            {
                new: true,
            }
        );
        return subscriberAlert;
    },

    updateBy: async function(query: $TSFixMe, data: $TSFixMe) {
        if (!query) {
            query = {};
        }

        if (!query.deleted) query.deleted = false;
        let updatedData = await SubscriberAlertModel.updateMany(query, {
            $set: data,
        });
        const populate = [
            { path: 'incidentId', select: 'name' },
            { path: 'projectId', select: 'name' },
            {
                path: 'subscriberId',
                select:
                    'name contactEmail contactPhone contactWebhook countryCode',
            },
        ];
        const select =
            'incidentId projectId subscriberId alertVia alertStatus eventType error errorMessage totalSubscribers identification';
        updatedData = await this.findBy({ query, select, populate });
        return updatedData;
    },

    deleteBy: async function(query: $TSFixMe, userId: $TSFixMe) {
        const subscriberAlert = await SubscriberAlertModel.findOneAndUpdate(
            query,
            {
                $set: {
                    deleted: true,
                    deletedById: userId,
                    deletedAt: Date.now(),
                },
            },
            {
                new: true,
            }
        );
        return subscriberAlert;
    },

    findBy: async function({
        query,
        skip,
        limit,
        select,
        populate
    }: $TSFixMe) {
        if (!skip) skip = 0;

        if (!limit) limit = 10;

        if (typeof skip === 'string') {
            skip = parseInt(skip);
        }

        if (typeof limit === 'string') {
            limit = parseInt(limit);
        }

        if (!query) {
            query = {};
        }

        query.deleted = false;

        let subscriberAlertQuery = SubscriberAlertModel.find(query)
            .lean()
            .sort([['createdAt', -1]])
            .limit(limit)
            .skip(skip);

        subscriberAlertQuery = handleSelect(select, subscriberAlertQuery);
        subscriberAlertQuery = handlePopulate(populate, subscriberAlertQuery);

        const subscriberAlerts = await subscriberAlertQuery;
        return subscriberAlerts;
    },

    findByOne: async function({
        query,
        select,
        populate
    }: $TSFixMe) {
        if (!query) {
            query = {};
        }

        query.deleted = false;

        let subscriberAlertQuery = SubscriberAlertModel.find(query)
            .lean()
            .sort([['createdAt', -1]]);

        subscriberAlertQuery = handleSelect(select, subscriberAlertQuery);
        subscriberAlertQuery = handlePopulate(populate, subscriberAlertQuery);

        const subscriberAlert = await subscriberAlertQuery;
        return subscriberAlert;
    },

    countBy: async function(query: $TSFixMe) {
        if (!query) {
            query = {};
        }

        query.deleted = false;
        const count = await SubscriberAlertModel.countDocuments(query);
        return count;
    },

    hardDeleteBy: async function(query: $TSFixMe) {
        await SubscriberAlertModel.deleteMany(query);
        return 'Subscriber Alert(s) removed successfully';
    },
};

import SubscriberAlertModel from '../models/subscriberAlert'
import handleSelect from '../utils/select'
import handlePopulate from '../utils/populate'
