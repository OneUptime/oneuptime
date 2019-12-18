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

    updateBy: async function (query, data) {
        try {
            if (!query) {
                query = {};
            }

            if (!query.deleted) query.deleted = false;
            var updatedData = await MonitorStatusModel.updateMany(query, {
                $set: data
            });
            updatedData = await this.findBy(query);
            return updatedData;
        } catch (error) {
            ErrorService.log('MonitorStatusService.updateMany', error);
            throw error;
        }
    },

    findBy: async function (query, limit, skip) {
        try {
            if (!skip) skip = 0;

            if (!limit) limit = 0;

            if (typeof (skip) === 'string') {
                skip = parseInt(skip);
            }

            if (typeof (limit) === 'string') {
                limit = parseInt(limit);
            }

            if (!query) {
                query = {};
            }

            query.deleted = false;
            var monitorStatus = await MonitorStatusModel.find(query)
                .limit(limit)
                .skip(skip)
                .sort({ createdAt: -1 });
            return monitorStatus;
        }
        catch (error) {
            ErrorService.log('monitorStatusService.findBy', error);
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