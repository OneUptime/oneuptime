export default {
    create: async function (
        projectId: $TSFixMe,
        chargeAmount: $TSFixMe,
        balanceAfterAlertSent: $TSFixMe,
        alertId: $TSFixMe,
        monitorId: $TSFixMe,
        incidentId: $TSFixMe,
        sentTo: $TSFixMe,
        subscriberId: $TSFixMe
    ) {
        const alertCharge = new AlertChargeModel();

        alertCharge.projectId = projectId;

        alertCharge.chargeAmount = chargeAmount;

        alertCharge.closingAccountBalance = balanceAfterAlertSent;

        alertCharge.alertId = alertId || null;

        alertCharge.monitorId = monitorId;

        alertCharge.incidentId = incidentId;

        alertCharge.sentTo = sentTo;

        alertCharge.subscriberAlertId = subscriberId || null;
        alertCharge.save();
        return alertCharge;
    },
    findBy: async function ({
        query,
        skip,
        limit,
        sort,
        populate,
        select,
    }: FindBy) {
        if (!sort) sort = -1;

        if (typeof skip === 'string') {
            skip = parseInt(skip);
        }

        if (typeof limit === 'string') {
            limit = parseInt(limit);
        }

        if (typeof sort === 'string') {
            sort = parseInt(sort);
        }

        if (!query) {
            query = {};
        }

        let alertQuery;
        if (skip >= 0 && limit > 0) {
            alertQuery = AlertChargeModel.find(query)
                .lean()
                .sort([['createdAt', sort]])
                .limit(limit)
                .skip(skip);
        } else {
            alertQuery = AlertChargeModel.find(query)
                .lean()
                .sort([['createdAt', sort]]);
        }

        alertQuery.select(select);
        alertQuery.populate(populate);
        const alertCharges = await alertQuery;

        return alertCharges;
    },
    countBy: async (query: Query) => {
        if (!query) {
            query = {};
        }
        const count = await AlertChargeModel.countDocuments(query);
        return count;
    },
    /**
     * deletes documents in alert charges based on the query condition
     * @param {Object} query
     */
    hardDeleteBy: async (query: Query) => {
        await AlertChargeModel.deleteMany(query);
    },
};

import AlertChargeModel from '../models/alertCharge';

import FindBy from '../types/db/FindBy';
import Query from '../types/db/Query';
