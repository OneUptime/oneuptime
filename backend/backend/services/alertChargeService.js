module.exports = {
    create: async function (projectId, chargeAmount, balanceAfterAlertSent, alertId) {
        try {
            var alertCharge = new AlertChargeModel();
            alertCharge.projectId = projectId;
            alertCharge.chargeAmount = chargeAmount;
            alertCharge.closingAccountBalance = balanceAfterAlertSent;
            alertCharge.alertId = alertId;
            alertCharge.save();
            return alertCharge;
        } catch (error) {
            ErrorService.log('AlertService.createAlertCharge', error);
            throw error;
        }
    },
    findBy: async function (query, skip, limit, sort) {
        if (!skip) skip = 0;

        if (!limit) limit = 10;

        if (!sort) sort = -1;

        if (typeof (skip) === 'string') {
            skip = parseInt(skip);
        }

        if (typeof (limit) === 'string') {
            limit = parseInt(limit);
        }

        if (typeof (sort) === 'string') {
            sort = parseInt(sort);
        }

        if (!query) {
            query = {};
        }

        try {
            var alertCharges = await AlertChargeModel.find(query)
                .sort([['createdAt', sort]])
                .limit(limit)
                .skip(skip);
            return alertCharges;
        } catch (error) {
            ErrorService.log('AlertChargeModel.find`  ', error);
            throw error;
        }
    }
}

let AlertChargeModel = require('../models/alertCharge');
let ErrorService = require('./errorService');
