import AlertChargeModel from '../models/alertCharge';
import FindBy from '../types/db/FindBy';
import Query from '../types/db/Query';

export default class Service {
    async create(
        projectId: string,
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
    }

    async findBy({ query, skip, limit, sort, populate, select }: FindBy) {
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
    }

    async countBy(query: Query) {
        if (!query) {
            query = {};
        }
        const count = await AlertChargeModel.countDocuments(query);
        return count;
    }
    /**
     * deletes documents in alert charges based on the query condition
     * @param {Object} query
     */
    async hardDeleteBy(query: Query) {
        await AlertChargeModel.deleteMany(query);
    }
}
