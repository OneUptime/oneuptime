module.exports = {
    create: async function (projectId, chargeAmount, balanceAfterAlertSent, alertId, monitorId, incidentId, sentTo) {
        try {
            var alertCharge = new AlertChargeModel();
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
            ErrorService.log('AlertService.createAlertCharge', error);
            throw error;
        }
    },
    findBy: async function (query, skip, limit, sort) {

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
            var alertCharges;
            if ( skip >= 0 && limit > 0 ) { 
                alertCharges = await AlertChargeModel.find(query)
                    .sort([['createdAt', sort]])
                    .populate('alertId', 'alertVia')
                    .populate('monitorId', 'name' )
                    .limit(limit)
                    .skip(skip);
            } else {
                alertCharges = await AlertChargeModel.find(query)
                    .sort([['createdAt', sort]])
                    .populate('alertId', 'alertVia')
                    .populate('monitorId', 'name' );
            }
            return alertCharges;

        } catch (error) {
            ErrorService.log('AlertChargeModel.find', error);
            throw error;
        }
    },
    countBy: async (query) => {
        if (!query) {
            query = {};
        }
        try {
            var count = await AlertChargeModel.count(query);
            return count;
        } catch (error) {
            ErrorService.log('MonitorModel.count', error);
            throw error;
        }
    },
};

let AlertChargeModel = require('../models/alertCharge');
let ErrorService = require('./errorService');