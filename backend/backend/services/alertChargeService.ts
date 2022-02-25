export default {
    create: async function(
        projectId,
        chargeAmount,
        balanceAfterAlertSent,
        alertId,
        monitorId,
        incidentId,
        sentTo,
        subscriberId
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
    findBy: async function({ query, skip, limit, sort, populate, select }) {
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
    countBy: async query => {
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
    hardDeleteBy: async query => {
        await AlertChargeModel.deleteMany(query);
    },
};

import AlertChargeModel from '../models/alertCharge'
import handlePopulate from '../utils/populate'
import handleSelect from '../utils/select'
