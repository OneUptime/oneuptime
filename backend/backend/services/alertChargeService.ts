export default {
    create: async function(
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
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectId' does not exist on type 'Docum... Remove this comment to see the full error message
        alertCharge.projectId = projectId;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'chargeAmount' does not exist on type 'Do... Remove this comment to see the full error message
        alertCharge.chargeAmount = chargeAmount;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'closingAccountBalance' does not exist on... Remove this comment to see the full error message
        alertCharge.closingAccountBalance = balanceAfterAlertSent;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'alertId' does not exist on type 'Documen... Remove this comment to see the full error message
        alertCharge.alertId = alertId || null;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitorId' does not exist on type 'Docum... Remove this comment to see the full error message
        alertCharge.monitorId = monitorId;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidentId' does not exist on type 'Docu... Remove this comment to see the full error message
        alertCharge.incidentId = incidentId;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'sentTo' does not exist on type 'Document... Remove this comment to see the full error message
        alertCharge.sentTo = sentTo;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'subscriberAlertId' does not exist on typ... Remove this comment to see the full error message
        alertCharge.subscriberAlertId = subscriberId || null;
        alertCharge.save();
        return alertCharge;
    },
    findBy: async function({
        query,
        skip,
        limit,
        sort,
        populate,
        select,
    }: $TSFixMe) {
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

        alertQuery = handleSelect(select, alertQuery);
        alertQuery = handlePopulate(populate, alertQuery);
        const alertCharges = await alertQuery;

        return alertCharges;
    },
    countBy: async (query: $TSFixMe) => {
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
    hardDeleteBy: async (query: $TSFixMe) => {
        await AlertChargeModel.deleteMany(query);
    },
};

import AlertChargeModel from '../models/alertCharge';
import handlePopulate from '../utils/populate';
import handleSelect from '../utils/select';
