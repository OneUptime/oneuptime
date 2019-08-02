module.exports = {
    create: async function (data) {
        var _this = this;
        try {
            let accessToken = uuidv1();
            let storedProbe = await _this.findOneBy({ probeName: data.probeName });
            if (storedProbe && storedProbe.probeName) {
                let error = new Error('Probe name already exists.');
                error.code = 400;
                ErrorService.log('probe.create', error);
                throw error;
            }
            else {
                let probe = new ProbeModel();
                probe.probeKey = accessToken;
                probe.probeName = data.probeName;
                var savedProbe = await probe.save();
                return savedProbe;
            }
        } catch (error) {
            ErrorService.log('probe.save', error);
            throw error;
        }
    },

    update: async function (query, data) {
        if (!query) {
            query = {};
        }

        query.deleted = false;

        try {
            var probe = await ProbeModel.findOneAndUpdate(query,
                { $set: data },
                {
                    new: true
                });
        } catch (error) {
            ErrorService.log('ProbeModel.findOneAndUpdate', error);
            throw error;
        }
        return probe;
    },

    findBy: async function (query, limit, skip) {

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
        try {
            var probe = await ProbeModel.find(query)
                .sort([['createdAt', -1]])
                .limit(limit)
                .skip(skip);
        } catch (error) {
            ErrorService.log('ProbeModel.find', error);
            throw error;
        }
        return probe;
    },

    findOneBy: async function (query) {
        if (!query) {
            query = {};
        }

        query.deleted = false;
        try {
            var probe = await ProbeModel.findOne(query);
        } catch (error) {
            ErrorService.log('ProbeModel.findOne', error);
            throw error;
        }
        return probe;
    },


    countBy: async function (query) {
        if (!query) {
            query = {};
        }

        query.deleted = false;
        try {
            var count = await ProbeModel.count(query);
        } catch (error) {
            ErrorService.log('ProbeModel.count', error);
            throw error;
        }

        return count;
    },

    deleteBy: async function (query) {
        if (!query) {
            query = {};
        }
        query.deleted = false;
        try {
            var probe = await ProbeModel.findOneAndUpdate(query, { $set: { deleted: true, deletedAt: Date.now() } }, { new: true });
        } catch (error) {
            ErrorService.log('ProbeModel.findOneAndUpdate', error);
            throw error;
        }
        return probe;
    },

    hardDeleteBy: async function (query) {
        try {
            await ProbeModel.deleteMany(query);
        } catch (error) {
            ErrorService.log('ProbeModel.deleteMany', error);
            throw error;
        }
        return 'Probe(s) removed successfully!';
    },

    createMonitorLog: async function (data) {
        try {
            let Log = new MonitorLogModel();
            Log.monitorId = data.monitorId;
            Log.probeId = data.probeId;
            Log.responseTime = data.responseTime;
            Log.responseStatus = data.responseStatus;
            Log.status = data.status;
            var savedLog = await Log.save();
        } catch (error) {
            ErrorService.log('Log.save', error);
            throw error;
        }
        return savedLog;
    },

    createMonitorStatus: async function (data) {
        try {
            let MonitorStatus = new MonitorStatusModel();
            MonitorStatus.monitorId = data.monitorId;
            MonitorStatus.probeId = data.probeId;
            MonitorStatus.responseTime = data.responseTime;
            MonitorStatus.status = data.status;
            var savedMonitorStatus = await MonitorStatus.save();
        } catch (error) {
            ErrorService.log('MonitorStatus.save', error);
            throw error;
        }
        return savedMonitorStatus;
    },

    updateMonitorStatus: async function (monitorStatusId) {
        try {
            var MonitorStatus = await MonitorStatusModel.findOneAndUpdate({ _id: monitorStatusId },
                { $set: { endTime: Date.now() } },
                {
                    new: true
                });
        } catch (error) {
            ErrorService.log('ProbeModel.findOneAndUpdate', error);
            throw error;
        }
        return MonitorStatus;
    },

    setTime: async function (data) {
        var _this = this;
        try {
            var lastStatus = await MonitorStatusModel.find({ monitorId: data.monitorId,probeId:data.probeId })
                .sort([['createdAt', -1]])
                .limit(1);
            var log = await _this.createMonitorLog(data);
            if(!lastStatus || !lastStatus.length){
                await _this.createMonitorStatus(data);
            }
            else if (lastStatus && lastStatus[0].status !== data.status) {
                if(lastStatus && lastStatus[0] && lastStatus[0]._id){
                    await _this.updateMonitorStatus(lastStatus[0]._id);
                }
                await _this.createMonitorStatus(data);
            }

        } catch (error) {
            ErrorService.log('setTime.findOne', error);
            throw error;
        }
        return log;
    },

    getTime: async function (data) {
        try {
            var date = new Date();
            var log = await MonitorLogModel.findOne({monitorId:data.monitorId,probeId:data.probeId,createdAt : { $lt: date }});
        } catch (error) {
            ErrorService.log('MonitorLogModel.findOne', error);
            throw error;
        }
        return log;
    },
};

let ProbeModel = require('../models/probe');
let MonitorLogModel = require('../models/monitorLog');
let MonitorStatusModel = require('../models/monitorStatus');
let ErrorService = require('./errorService');
let uuidv1 = require('uuid/v1');
