module.exports = {

    create: async function (data) {
        //find previous object of this and see if the status differs
        var previousMonitorStatus = await this.findOneBy({ monitorId: data.monitorId });
        if (!previousMonitorStatus || (previousMonitorStatus && previousMonitorStatus.status !== data.status)) {
            var monitorStatus = new MonitorStatusModel();
            monitorStatus.monitorId = data.monitorId;
            monitorStatus.probeId = data.probeId || null;
            monitorStatus.responseTime = data.responseTime || null;
            monitorStatus.manuallyCreated = true;
            monitorStatus.status = data.status;
            monitorStatus = monitorStatus.save();
            if (previousMonitorStatus) {
                this.updateOneBy({
                    _id: previousMonitorStatus._id},{
                    endTime: Date.now()
                });
            }
        }
    },
    updateOneBy: async function (query,data) {
        if (!query) {
            query = {};
        }

        if (!query.deleted) query.deleted = false;
        try {
            var updatedMonitorStatus = await MonitorStatusModel.findOneAndUpdate(query, {
                $set: data
            });
            return updatedMonitorStatus;
        } catch (error) {
            ErrorService.log('MonitorStatusService.updateOneBy', error);
            throw error;
        }
    },
    findOneBy: async function (query) {
        try {
            if (!query) {
                query = {};
            }
            var monitorStatus = await MonitorStatusModel.findOne(query, {}, {
                sort: { 'createdAt': -1 }
            })
                .lean();
            return monitorStatus;
        } catch (error) {
            ErrorService.log('MonitorStatusService.findOneBy', error);
            throw error;
        }
    }
};

var MonitorStatusModel = require('../models/monitorStatus');
var ErrorService = require('../services/errorService');