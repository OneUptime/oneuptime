module.exports = {
    create: async function (data) {
        try {
            var _this = this;
            let probeKey;
            if (data.probeKey) {
                probeKey = data.probeKey;
            } else {
                probeKey = uuidv1();
            }
            let storedProbe = await _this.findOneBy({ probeName: data.probeName });
            if (storedProbe && storedProbe.probeName) {
                let error = new Error('Probe name already exists.');
                error.code = 400;
                ErrorService.log('probe.create', error);
                throw error;
            }
            else {
                let probe = new ProbeModel();
                probe.probeKey = probeKey;
                probe.probeName = data.probeName;
                var savedProbe = await probe.save();
                return savedProbe;
            }
        } catch (error) {
            ErrorService.log('ProbeService.create', error);
            throw error;
        }
    },

    updateOneBy: async function (query, data) {
        try {
            if (!query) {
                query = {};
            }

            query.deleted = false;
            var probe = await ProbeModel.findOneAndUpdate(query,
                { $set: data },
                {
                    new: true
                });
            return probe;
        } catch (error) {
            ErrorService.log('ProbeService.updateOneBy', error);
            throw error;
        }
    },

    updateBy: async function (query, data) {
        try {
            if (!query) {
                query = {};
            }

            if (!query.deleted) query.deleted = false;
            var updatedData = await ProbeModel.updateMany(query, {
                $set: data
            });
            updatedData = await this.findBy(query);
            return updatedData;
        } catch (error) {
            ErrorService.log('ProbeService.updateMany', error);
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
            var probe = await ProbeModel.find(query)
                .sort([['createdAt', -1]])
                .limit(limit)
                .skip(skip);
            return probe;
        } catch (error) {
            ErrorService.log('ProbeService.findBy', error);
            throw error;
        }
    },

    findOneBy: async function (query) {
        try {
            if (!query) {
                query = {};
            }

            query.deleted = false;
            var probe = await ProbeModel.findOne(query);
            return probe;
        } catch (error) {
            ErrorService.log('ProbeService.findOneBy', error);
            throw error;
        }
    },

    countBy: async function (query) {
        try {
            if (!query) {
                query = {};
            }

            query.deleted = false;
            var count = await ProbeModel.count(query);
            return count;
        } catch (error) {
            ErrorService.log('ProbeService.countBy', error);
            throw error;
        }
    },

    deleteBy: async function (query) {
        try {
            if (!query) {
                query = {};
            }
            query.deleted = false;
            var probe = await ProbeModel.findOneAndUpdate(query, { $set: { deleted: true, deletedAt: Date.now() } }, { new: true });
            return probe;
        } catch (error) {
            ErrorService.log('ProbeService.deleteBy', error);
            throw error;
        }
    },

    hardDeleteBy: async function (query) {
        try {
            await ProbeModel.deleteMany(query);
            return 'Probe(s) removed successfully!';
        } catch (error) {
            ErrorService.log('ProbeService.hardDeleteBy', error);
            throw error;
        }
    },

    sendProbe: async function (probeId, monitorId) {
        try {
            var probe = await this.findOneBy({ _id: probeId });
            if (probe) {
                delete probe._doc.deleted;
                await RealTimeService.updateProbe(probe, monitorId);
            }
        } catch (error) {
            ErrorService.log('ProbeService.sendProbe', error);
            throw error;
        }
    },

    setTime: async function (data) {
        try {
            var _this = this;
            var mon, autoAcknowledge, autoResolve, incidentIds;
            var statuses = await MonitorStatusService.findBy({ monitorId: data.monitorId, probeId: data.probeId }, 1, 0);
            var log = await MonitorLogService.create(data);
            var lastStatus = statuses && statuses[0] && statuses[0].status ? statuses[0].status : null;
            var lastStatusId = statuses && statuses[0] && statuses[0]._id ? statuses[0]._id : null;
            if (!lastStatus) {
                let tempMon = await _this.incidentCreateOrUpdate(data);
                mon = tempMon.mon;
                incidentIds = tempMon.incidentIds;
                autoAcknowledge = lastStatus && lastStatus === 'degraded' ? mon.criteria.degraded.autoAcknowledge : lastStatus === 'offline' ? mon.criteria.down.autoAcknowledge : false;
                autoResolve = lastStatus === 'degraded' ? mon.criteria.degraded.autoResolve : lastStatus === 'offline' ? mon.criteria.down.autoResolve : false;
                await _this.incidentResolveOrAcknowledge(data, lastStatus, autoAcknowledge, autoResolve);
            }
            else if (lastStatus && lastStatus !== data.status) {
                if (lastStatusId) {
                    await MonitorStatusService.updateOneBy({ _id: lastStatusId }, { endTime: Date.now() });
                }
                let tempMon = await _this.incidentCreateOrUpdate(data);
                mon = tempMon.mon;
                incidentIds = tempMon.incidentIds;
                autoAcknowledge = lastStatus && lastStatus === 'degraded' ? mon.criteria.degraded.autoAcknowledge : lastStatus === 'offline' ? mon.criteria.down.autoAcknowledge : false;
                autoResolve = lastStatus === 'degraded' ? mon.criteria.degraded.autoResolve : lastStatus === 'offline' ? mon.criteria.down.autoResolve : false;
                await _this.incidentResolveOrAcknowledge(data, lastStatus, autoAcknowledge, autoResolve);
            }
            if (incidentIds && incidentIds.length) {
                log = await MonitorLogService.updateOneBy({ _id: log._id }, { incidentIds });
            }
            return log;
        } catch (error) {
            ErrorService.log('ProbeService.setTime', error);
            throw error;
        }
    },

    getTime: async function (data) {
        try {
            var date = new Date();
            var log = await MonitorLogService.findOneBy({ monitorId: data.monitorId, probeId: data.probeId, createdAt: { $lt: data.date || date } });
            return log;
        } catch (error) {
            ErrorService.log('probeService.getTime', error);
            throw error;
        }
    },

    incidentCreateOrUpdate: async function (data) {
        try {
            var monitor = await MonitorService.findOneBy({ _id: data.monitorId });
            var incidents = await IncidentService.findBy({ monitorId: data.monitorId, incidentType: data.status, resolved: false });
            var incidentIds = [];

            if (data.status === 'online' && monitor && monitor.criteria && monitor.criteria.up && monitor.criteria.up.createAlert) {
                if (incidents && incidents.length) {
                    incidentIds = incidents.map(async (incident) => {
                        return await IncidentService.updateOneBy({
                            _id: incident._id
                        }, {
                            probes: incident.probes.concat({
                                probeId: data.probeId,
                                updatedAt: Date.now(),
                                status: true,
                                reportedStatus: data.status
                            })
                        });
                    });
                }
                else {
                    incidentIds = await [IncidentService.create({
                        projectId: monitor.projectId,
                        monitorId: data.monitorId,
                        createdById: null,
                        incidentType: 'online',
                        probeId: data.probeId,
                        responseTime: data.responseTime
                    })];
                }
            }
            else if (data.status === 'degraded' && monitor && monitor.criteria && monitor.criteria.degraded && monitor.criteria.degraded.createAlert) {
                if (incidents && incidents.length) {
                    incidentIds = incidents.map(async (incident) => {
                        return await IncidentService.updateOneBy({
                            _id: incident._id
                        }, {
                            probes: incident.probes.concat({
                                probeId: data.probeId,
                                updatedAt: Date.now(),
                                status: true,
                                reportedStatus: data.status
                            })
                        });
                    });
                }
                else {
                    incidentIds = await [IncidentService.create({
                        projectId: monitor.projectId,
                        monitorId: data.monitorId,
                        createdById: null,
                        incidentType: 'degraded',
                        probeId: data.probeId,
                        responseTime: data.responseTime
                    })];
                }
            }
            else if (data.status === 'offline' && monitor && monitor.criteria && monitor.criteria.down && monitor.criteria.down.createAlert) {
                if (incidents && incidents.length) {
                    incidentIds = incidents.map(async (incident) => {
                        return await IncidentService.updateOneBy({
                            _id: incident._id
                        }, {
                            probes: incident.probes.concat({
                                probeId: data.probeId,
                                updatedAt: Date.now(),
                                status: true,
                                reportedStatus: data.status
                            })
                        });
                    });
                }
                else {
                    incidentIds = await [IncidentService.create({
                        projectId: monitor.projectId,
                        monitorId: data.monitorId,
                        createdById: null,
                        incidentType: 'offline',
                        probeId: data.probeId,
                        responseTime: data.responseTime
                    })];
                }
            }
            incidentIds = await Promise.all(incidentIds);
            incidentIds = incidentIds.map(i => i._id);
            return { mon: monitor, incidentIds };
        } catch (error) {
            ErrorService.log('ProbeService.incidentCreateOrUpdate', error);
            throw error;
        }
    },

    incidentResolveOrAcknowledge: async function (data, lastStatus, autoAcknowledge, autoResolve) {
        try {
            var incidents = await IncidentService.findBy({ monitorId: data.monitorId, incidentType: lastStatus, resolved: false });
            var incidentsV1 = [];
            var incidentsV2 = [];
            if (incidents && incidents.length) {
                if (lastStatus && lastStatus !== data.status) {
                    incidents.map(async (incident) => {
                        incident = incident.toObject();
                        incident.probes.some(probe => {
                            const probeId = data.probeId ? data.probeId.toString() : null;
                            if (probe.probeId === probeId) {
                                incidentsV1.push(incident);
                                return true;
                            }
                            else return false;
                        });
                    });
                }
            }
            await Promise.all(incidentsV1.map(async (v1) => {
                let newIncident = await IncidentService.updateOneBy({
                    _id: v1._id
                }, {
                    probes: v1.probes.concat([{
                        probeId: data.probeId,
                        updatedAt: Date.now(),
                        status: false,
                        reportedStatus: data.status
                    }])
                });
                incidentsV2.push(newIncident);
                return newIncident;
            }));

            incidentsV2.map(async (v2) => {
                let trueArray = [];
                let falseArray = [];
                v2.probes.map(probe => {
                    if (probe.status) {
                        trueArray.push(probe);
                    }
                    else {
                        falseArray.push(probe);
                    }
                });
                if (trueArray.length === falseArray.length) {
                    if (autoAcknowledge) {
                        if (!v2.acknowledged) {
                            await IncidentService.acknowledge(v2._id, null, 'fyipe');
                        }
                    }
                    if (autoResolve) {
                        await IncidentService.resolve(v2._id, null, 'fyipe');
                    }
                }
            });
            return {};
        } catch (error) {
            ErrorService.log('ProbeService.incidentResolveOrAcknowledge', error);
            throw error;
        }
    },

    updateProbeStatus: async function (probeId) {
        try {
            var probe = await ProbeModel.findOneAndUpdate({ _id: probeId }, { $set: { lastAlive: Date.now() } }, { new: true });
            return probe;
        } catch (error) {
            ErrorService.log('probeService.updateProbeStatus', error);
            throw error;
        }
    },

    conditions: async (payload, resp, con) => {
        let stat = true;
        let status = resp ? (resp.status ? resp.status : (resp.statusCode ? resp.statusCode : null)) : null;
        let body = resp && resp.body ? resp.body : null;

        if (con && con.and && con.and.length) {
            stat = await checkAnd(payload, con.and, status, body);
        }
        else if (con && con.or && con.or.length) {
            stat = await checkOr(payload, con.or, status, body);
        }
        return stat;
    },
};

var _ = require('lodash');

const checkAnd = async (payload, con, statusCode, body) => {
    let validity = true;
    for (let i = 0; i < con.length; i++) {
        if (con[i] && con[i].responseType && con[i].responseType === 'responseTime') {
            if (con[i] && con[i].filter && con[i].filter === 'greaterThan') {
                if (!(con[i] && con[i].field1 && payload && payload > con[i].field1)) {
                    validity = false;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'lessThan') {
                if (!(con[i] && con[i].field1 && payload && payload < con[i].field1)) {
                    validity = false;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'inBetween') {
                if (!(con[i] && con[i].field1 && payload && con[i].field2 && payload > con[i].field1 && payload < con[i].field2)) {
                    validity = false;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'equalTo') {
                if (!(con[i] && con[i].field1 && payload && payload == con[i].field1)) {
                    validity = false;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'notEqualTo') {
                if (!(con[i] && con[i].field1 && payload && payload != con[i].field1)) {
                    validity = false;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'gtEqualTo') {
                if (!(con[i] && con[i].field1 && payload && payload >= con[i].field1)) {
                    validity = false;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'ltEqualTo') {
                if (!(con[i] && con[i].field1 && payload && payload <= con[i].field1)) {
                    validity = false;
                }
            }
        }
        else if (con[i] && con[i].responseType === 'doesRespond') {
            if (con[i] && con[i].filter && con[i].filter === 'isUp') {
                if (!(con[i] && con[i].filter && payload)) {
                    validity = false;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'isDown') {
                if (!(con[i] && con[i].filter && !payload)) {
                    validity = false;
                }
            }
        }
        else if (con[i] && con[i].responseType === 'statusCode') {
            if (con[i] && con[i].filter && con[i].filter === 'greaterThan') {
                if (!(con[i] && con[i].field1 && statusCode && statusCode > con[i].field1)) {
                    validity = false;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'lessThan') {
                if (!(con[i] && con[i].field1 && statusCode && statusCode < con[i].field1)) {
                    validity = false;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'inBetween') {
                if (!(con[i] && con[i].field1 && statusCode && con[i].field2 && statusCode > con[i].field1 && statusCode < con[i].field2)) {
                    validity = false;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'equalTo') {
                if (!(con[i] && con[i].field1 && statusCode && statusCode == con[i].field1)) {
                    validity = false;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'notEqualTo') {
                if (!(con[i] && con[i].field1 && statusCode && statusCode != con[i].field1)) {
                    validity = false;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'gtEqualTo') {
                if (!(con[i] && con[i].field1 && statusCode && statusCode >= con[i].field1)) {
                    validity = false;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'ltEqualTo') {
                if (!(con[i] && con[i].field1 && statusCode && statusCode <= con[i].field1)) {
                    validity = false;
                }
            }
        }
        else if (con[i] && con[i].responseType === 'cpuLoad') {
            if (con[i] && con[i].filter && con[i].filter === 'greaterThan') {
                if (!(con[i] && con[i].field1 && payload.cpuLoad && payload.cpuLoad > con[i].field1)) {
                    validity = false;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'lessThan') {
                if (!(con[i] && con[i].field1 && payload.cpuLoad && payload.cpuLoad < con[i].field1)) {
                    validity = false;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'inBetween') {
                if (!(con[i] && con[i].field1 && payload.cpuLoad && con[i].field2 && payload.cpuLoad > con[i].field1 && payload.cpuLoad < con[i].field2)) {
                    validity = false;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'equalTo') {
                if (!(con[i] && con[i].field1 && payload.cpuLoad && payload.cpuLoad == con[i].field1)) {
                    validity = false;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'notEqualTo') {
                if (!(con[i] && con[i].field1 && payload.cpuLoad && payload.cpuLoad != con[i].field1)) {
                    validity = false;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'gtEqualTo') {
                if (!(con[i] && con[i].field1 && payload.cpuLoad && payload.cpuLoad >= con[i].field1)) {
                    validity = false;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'ltEqualTo') {
                if (!(con[i] && con[i].field1 && payload.cpuLoad && payload.cpuLoad <= con[i].field1)) {
                    validity = false;
                }
            }
        }
        else if (con[i] && con[i].responseType === 'memoryUsage') {
            if (con[i] && con[i].filter && con[i].filter === 'greaterThan') {
                if (!(con[i] && con[i].field1 && payload.memoryUsed && payload.memoryUsed > con[i].field1)) {
                    validity = false;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'lessThan') {
                if (!(con[i] && con[i].field1 && payload.memoryUsed && payload.memoryUsed < con[i].field1)) {
                    validity = false;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'inBetween') {
                if (!(con[i] && con[i].field1 && payload.memoryUsed && con[i].field2 && payload.memoryUsed > con[i].field1 && payload.memoryUsed < con[i].field2)) {
                    validity = false;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'equalTo') {
                if (!(con[i] && con[i].field1 && payload.memoryUsed && payload.memoryUsed == con[i].field1)) {
                    validity = false;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'notEqualTo') {
                if (!(con[i] && con[i].field1 && payload.memoryUsed && payload.memoryUsed != con[i].field1)) {
                    validity = false;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'gtEqualTo') {
                if (!(con[i] && con[i].field1 && payload.memoryUsed && payload.memoryUsed >= con[i].field1)) {
                    validity = false;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'ltEqualTo') {
                if (!(con[i] && con[i].field1 && payload.memoryUsed && payload.memoryUsed <= con[i].field1)) {
                    validity = false;
                }
            }
        }
        else if (con[i] && con[i].responseType === 'storageUsage') {
            let size = parseInt(payload.totalStorage || 0);
            let used = parseInt(payload.storageUsed || 0);
            let free = (size - used) / Math.pow(1e3, 3);
            if (con[i] && con[i].filter && con[i].filter === 'greaterThan') {
                if (!(con[i] && con[i].field1 && free > con[i].field1)) {
                    validity = false;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'lessThan') {
                if (!(con[i] && con[i].field1 && free < con[i].field1)) {
                    validity = false;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'inBetween') {
                if (!(con[i] && con[i].field1 && con[i].field2 && free > con[i].field1 && free < con[i].field2)) {
                    validity = false;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'equalTo') {
                if (!(con[i] && con[i].field1 && free === con[i].field1)) {
                    validity = false;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'notEqualTo') {
                if (!(con[i] && con[i].field1 && free !== con[i].field1)) {
                    validity = false;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'gtEqualTo') {
                if (!(con[i] && con[i].field1 && free >= con[i].field1)) {
                    validity = false;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'ltEqualTo') {
                if (!(con[i] && con[i].field1 && free <= con[i].field1)) {
                    validity = false;
                }
            }
        }
        else if (con[i] && con[i].responseType === 'temperature') {
            if (con[i] && con[i].filter && con[i].filter === 'greaterThan') {
                if (!(con[i] && con[i].field1 && payload.mainTemp && payload.mainTemp > con[i].field1)) {
                    validity = false;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'lessThan') {
                if (!(con[i] && con[i].field1 && payload.mainTemp && payload.mainTemp < con[i].field1)) {
                    validity = false;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'inBetween') {
                if (!(con[i] && con[i].field1 && payload.mainTemp && con[i].field2 && payload.mainTemp > con[i].field1 && payload.mainTemp < con[i].field2)) {
                    validity = false;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'equalTo') {
                if (!(con[i] && con[i].field1 && payload.mainTemp && payload.mainTemp == con[i].field1)) {
                    validity = false;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'notEqualTo') {
                if (!(con[i] && con[i].field1 && payload.mainTemp && payload.mainTemp != con[i].field1)) {
                    validity = false;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'gtEqualTo') {
                if (!(con[i] && con[i].field1 && payload.mainTemp && payload.mainTemp >= con[i].field1)) {
                    validity = false;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'ltEqualTo') {
                if (!(con[i] && con[i].field1 && payload.mainTemp && payload.mainTemp <= con[i].field1)) {
                    validity = false;
                }
            }
        }
        else if (con[i] && con[i].responseType === 'responseBody') {
            if (con[i] && con[i].filter && con[i].filter === 'contains') {
                if (!(con[i] && con[i].field1 && body && body[con[i].field1])) {
                    validity = false;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'doesNotContain') {
                if (!(con[i] && con[i].field1 && body && !body[con[i].field1])) {
                    validity = false;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'jsExpression') {
                if (!(con[i] && con[i].field1 && body && body[con[i].field1] === con[i].field1)) {
                    validity = false;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'empty') {
                if (!(con[i] && con[i].filter && body && _.isEmpty(body))) {
                    validity = false;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'notEmpty') {
                if (!(con[i] && con[i].filter && body && !_.isEmpty(body))) {
                    validity = false;
                }
            }
        }
        if (con[i] && con[i].collection && con[i].collection.and && con[i].collection.and.length) {
            let temp = await checkAnd(payload, con[i].collection.and, statusCode, body);
            if (!temp) {
                validity = temp;
            }
        }
        else if (con[i] && con[i].collection && con[i].collection.or && con[i].collection.or.length) {
            let temp1 = await checkOr(payload, con[i].collection.or, statusCode, body);
            if (!temp1) {
                validity = temp1;
            }
        }
    }
    return validity;
};
const checkOr = async (payload, con, statusCode, body) => {
    let validity = false;
    for (let i = 0; i < con.length; i++) {
        if (con[i] && con[i].responseType === 'responseTime') {
            if (con[i] && con[i].filter && con[i].filter === 'greaterThan') {
                if (con[i] && con[i].field1 && payload && payload > con[i].field1) {
                    validity = true;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'lessThan') {
                if (con[i] && con[i].field1 && payload && payload < con[i].field1) {
                    validity = true;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'inBetween') {
                if (con[i] && con[i].field1 && payload && con[i].field2 && payload > con[i].field1 && payload < con[i].field2) {
                    validity = true;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'equalTo') {
                if (con[i] && con[i].field1 && payload && payload == con[i].field1) {
                    validity = true;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'notEqualTo') {
                if (con[i] && con[i].field1 && payload && payload != con[i].field1) {
                    validity = true;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'gtEqualTo') {
                if (con[i] && con[i].field1 && payload && payload >= con[i].field1) {
                    validity = true;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'ltEqualTo') {
                if (con[i] && con[i].field1 && payload && payload <= con[i].field1) {
                    validity = true;
                }
            }
        }
        else if (con[i] && con[i].responseType === 'doesRespond') {
            if (con[i] && con[i].filter && con[i].filter === 'isUp') {
                if (con[i] && con[i].filter && payload) {
                    validity = true;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'isDown') {
                if (con[i] && con[i].filter && !payload) {
                    validity = true;
                }
            }
        }
        else if (con[i] && con[i].responseType === 'statusCode') {
            if (con[i] && con[i].filter && con[i].filter === 'greaterThan') {
                if (con[i] && con[i].field1 && statusCode && statusCode > con[i].field1) {
                    validity = true;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'lessThan') {
                if (con[i] && con[i].field1 && statusCode && statusCode < con[i].field1) {
                    validity = true;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'inBetween') {
                if (con[i] && con[i].field1 && statusCode && con[i].field2 && statusCode > con[i].field1 && statusCode < con[i].field2) {
                    validity = true;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'equalTo') {
                if (con[i] && con[i].field1 && statusCode && statusCode == con[i].field1) {
                    validity = true;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'notEqualTo') {
                if (con[i] && con[i].field1 && statusCode && statusCode != con[i].field1) {
                    validity = true;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'gtEqualTo') {
                if (con[i] && con[i].field1 && statusCode && statusCode >= con[i].field1) {
                    validity = true;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'ltEqualTo') {
                if (con[i] && con[i].field1 && statusCode && statusCode <= con[i].field1) {
                    validity = true;
                }
            }
        }
        else if (con[i] && con[i].responseType === 'cpuLoad') {
            if (con[i] && con[i].filter && con[i].filter === 'greaterThan') {
                if (con[i] && con[i].field1 && payload.cpuLoad && payload.cpuLoad > con[i].field1) {
                    validity = true;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'lessThan') {
                if (con[i] && con[i].field1 && payload.cpuLoad && payload.cpuLoad < con[i].field1) {
                    validity = true;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'inBetween') {
                if (con[i] && con[i].field1 && payload.cpuLoad && con[i].field2 && payload.cpuLoad > con[i].field1 && payload.cpuLoad < con[i].field2) {
                    validity = true;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'equalTo') {
                if (con[i] && con[i].field1 && payload.cpuLoad && payload.cpuLoad == con[i].field1) {
                    validity = true;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'notEqualTo') {
                if (con[i] && con[i].field1 && payload.cpuLoad && payload.cpuLoad != con[i].field1) {
                    validity = true;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'gtEqualTo') {
                if (con[i] && con[i].field1 && payload.cpuLoad && payload.cpuLoad >= con[i].field1) {
                    validity = true;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'ltEqualTo') {
                if (con[i] && con[i].field1 && payload.cpuLoad && payload.cpuLoad <= con[i].field1) {
                    validity = true;
                }
            }
        }
        else if (con[i] && con[i].responseType === 'memoryUsage') {
            if (con[i] && con[i].filter && con[i].filter === 'greaterThan') {
                if (con[i] && con[i].field1 && payload.memoryUsed && payload.memoryUsed > con[i].field1) {
                    validity = true;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'lessThan') {
                if (con[i] && con[i].field1 && payload.memoryUsed && payload.memoryUsed < con[i].field1) {
                    validity = true;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'inBetween') {
                if (con[i] && con[i].field1 && payload.memoryUsed && con[i].field2 && payload.memoryUsed > con[i].field1 && payload.memoryUsed < con[i].field2) {
                    validity = true;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'equalTo') {
                if (con[i] && con[i].field1 && payload.memoryUsed && payload.memoryUsed == con[i].field1) {
                    validity = true;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'notEqualTo') {
                if (con[i] && con[i].field1 && payload.memoryUsed && payload.memoryUsed != con[i].field1) {
                    validity = true;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'gtEqualTo') {
                if (con[i] && con[i].field1 && payload.memoryUsed && payload.memoryUsed >= con[i].field1) {
                    validity = true;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'ltEqualTo') {
                if (con[i] && con[i].field1 && payload.memoryUsed && payload.memoryUsed <= con[i].field1) {
                    validity = true;
                }
            }
        }
        else if (con[i] && con[i].responseType === 'storageUsage') {
            let size = parseInt(payload.totalStorage || 0);
            let used = parseInt(payload.storageUsed || 0);
            let free = (size - used) / Math.pow(1e3, 3);
            if (con[i] && con[i].filter && con[i].filter === 'greaterThan') {
                if (con[i] && con[i].field1 && free > con[i].field1) {
                    validity = true;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'lessThan') {
                if (con[i] && con[i].field1 && free < con[i].field1) {
                    validity = true;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'inBetween') {
                if (con[i] && con[i].field1 && con[i].field2 && free > con[i].field1 && free < con[i].field2) {
                    validity = true;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'equalTo') {
                if (con[i] && con[i].field1 && free === con[i].field1) {
                    validity = true;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'notEqualTo') {
                if (con[i] && con[i].field1 && free !== con[i].field1) {
                    validity = true;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'gtEqualTo') {
                if (con[i] && con[i].field1 && free >= con[i].field1) {
                    validity = true;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'ltEqualTo') {
                if (con[i] && con[i].field1 && free <= con[i].field1) {
                    validity = true;
                }
            }
        }
        else if (con[i] && con[i].responseType === 'temperature') {
            if (con[i] && con[i].filter && con[i].filter === 'greaterThan') {
                if (con[i] && con[i].field1 && payload.mainTemp && payload.mainTemp > con[i].field1) {
                    validity = true;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'lessThan') {
                if (con[i] && con[i].field1 && payload.mainTemp && payload.mainTemp < con[i].field1) {
                    validity = true;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'inBetween') {
                if (con[i] && con[i].field1 && payload.mainTemp && con[i].field2 && payload.mainTemp > con[i].field1 && payload.mainTemp < con[i].field2) {
                    validity = true;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'equalTo') {
                if (con[i] && con[i].field1 && payload.mainTemp && payload.mainTemp == con[i].field1) {
                    validity = true;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'notEqualTo') {
                if (con[i] && con[i].field1 && payload.mainTemp && payload.mainTemp != con[i].field1) {
                    validity = true;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'gtEqualTo') {
                if (con[i] && con[i].field1 && payload.mainTemp && payload.mainTemp >= con[i].field1) {
                    validity = true;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'ltEqualTo') {
                if (con[i] && con[i].field1 && payload.mainTemp && payload.mainTemp <= con[i].field1) {
                    validity = true;
                }
            }
        }
        else if (con[i] && con[i].responseType === 'responseBody') {
            if (con[i] && con[i].filter && con[i].filter === 'contains') {
                if (con[i] && con[i].field1 && body && body[con[i].field1]) {
                    validity = true;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'doesNotContain') {
                if (con[i] && con[i].field1 && body && !body[con[i].field1]) {
                    validity = true;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'jsExpression') {
                if (con[i] && con[i].field1 && body && body[con[i].field1] === con[i].field1) {
                    validity = true;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'empty') {
                if (con[i] && con[i].filter && body && _.isEmpty(body)) {
                    validity = true;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'notEmpty') {
                if (con[i] && con[i].filter && body && !_.isEmpty(body)) {
                    validity = true;
                }
            }
        }
        if (con[i] && con[i].collection && con[i].collection.and && con[i].collection.and.length) {
            let temp = await checkAnd(payload, con[i].collection.and, statusCode, body);
            if (temp) {
                validity = temp;
            }
        }
        else if (con[i] && con[i].collection && con[i].collection.or && con[i].collection.or.length) {
            let temp1 = await checkOr(payload, con[i].collection.or, statusCode, body);
            if (temp1) {
                validity = temp1;
            }
        }
    }
    return validity;
};

let ProbeModel = require('../models/probe');
let RealTimeService = require('./realTimeService');
let ErrorService = require('./errorService');
let uuidv1 = require('uuid/v1');
let MonitorService = require('./monitorService');
let MonitorStatusService = require('./monitorStatusService');
let MonitorLogService = require('./monitorLogService');
let IncidentService = require('./incidentService');
