module.exports = {

    create: async function (data) {
        try {
            var previousMonitorStatus = await this.findOneBy({ monitorId: data.monitorId, probeId: data.probeId });
            if (!previousMonitorStatus || (previousMonitorStatus && previousMonitorStatus.status !== data.status)) {
                if (previousMonitorStatus) {
                    await this.updateOneBy({
                        _id: previousMonitorStatus._id
                    }, {
                        endTime: Date.now()
                    });
                }

                var monitorStatus = new MonitorStatusModel();

                monitorStatus.monitorId = data.monitorId;
                monitorStatus.probeId = data.probeId || null;
                monitorStatus.responseTime = data.responseTime || null;
                monitorStatus.manuallyCreated = data.manuallyCreated || false;
                monitorStatus.status = data.status;

                var savedMonitorStatus = monitorStatus.save();

                return savedMonitorStatus;
            }
        } catch (error) {
            ErrorService.log('MonitorStatusService.create', error);
            throw error;
        }
    },

    updateOneBy: async function (query, data) {
        try {
            if (!query) {
                query = {};
            }

            var updatedMonitorStatus = await MonitorStatusModel.findOneAndUpdate(query,
                { $set: data },
                {
                    new: true
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
                .sort({ createdAt: -1 })
                .limit(limit)
                .skip(skip);
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
    },

    getMonitorStatus: async function (monitorId, startDate, endDate) {
        try {
            var _this = this;
            var probes = await ProbeService.findBy({});
            var targetDate = moment(Date.now()).subtract(90, 'days').startOf('day');
            var newProbes = Promise.all(probes.map(async (probe) => {
                probe = probe.toObject();
                var probeStatus = await _this.findBy({
                    probeId: probe._id, monitorId: monitorId,
                    $or: [
                        { 'startTime': { $gt: targetDate } }, { $or: [{ 'endTime': { $gt: targetDate } }, { 'endTime': null }] }
                    ]
                });
                var latestLog = await MonitorLogService.findBy({ probeId: probe._id, monitorId: monitorId }, 1, 0);
                probe.probeStatus = probeStatus;
                probe.status = latestLog && latestLog[0] && latestLog[0].status ? latestLog[0].status : '';
                probe.responseTime = latestLog && latestLog[0] && latestLog[0].responseTime ? latestLog[0].responseTime : '';
                return probe;
            }));
            return newProbes;
        } catch (error) {
            ErrorService.log('monitorStatusService.getMonitorStatus', error);
            throw error;
        }
    },
};

var MonitorStatusModel = require('../models/monitorStatus');
var MonitorLogService = require('./monitorLogService');
var ProbeService = require('./probeService');
var ErrorService = require('../services/errorService');
var moment = require('moment');