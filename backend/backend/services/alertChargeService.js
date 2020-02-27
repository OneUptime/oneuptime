module.exports = {
    create: async function(
        projectId,
        chargeAmount,
        balanceAfterAlertSent,
        alertId,
        monitorId,
        incidentId,
        sentTo
    ) {
        try {
            const alertCharge = new AlertChargeModel();
            alertCharge.projectId = projectId;
            alertCharge.chargeAmount = chargeAmount;
            alertCharge.closingAccountBalance = balanceAfterAlertSent;
            alertCharge.alertId = alertId;
            alertCharge.monitorId = monitorId;
            alertCharge.incidentId = incidentId;
            alertCharge.sentTo = sentTo;
            alertCharge.save();
            return alertCharge;
        } catch (error) {
            ErrorService.log('alertChargeService.create', error);
            throw error;
        }
    },
    findBy: async function(query, skip, limit, sort) {
        try {
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
            let alertCharges;
            if (skip >= 0 && limit > 0) {
                alertCharges = await AlertChargeModel.find(query)
                    .sort([['createdAt', sort]])
                    .populate('alertId', 'alertVia')
                    .populate('monitorId', 'name')
                    .limit(limit)
                    .skip(skip);
            } else {
                alertCharges = await AlertChargeModel.find(query)
                    .sort([['createdAt', sort]])
                    .populate('alertId', 'alertVia')
                    .populate('monitorId', 'name');
            }
            return alertCharges;
        } catch (error) {
            ErrorService.log('alertChargeService.findBy', error);
            throw error;
        }
    },
    countBy: async query => {
        try {
            if (!query) {
                query = {};
            }
            const count = await AlertChargeModel.count(query);
            return count;
        } catch (error) {
            ErrorService.log('alertChargeService.countBy', error);
            throw error;
        }
    },
};

const AlertChargeModel = require('../models/alertCharge');
const ErrorService = require('./errorService');
