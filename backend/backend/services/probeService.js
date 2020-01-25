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

    createMonitorLog: async function (data) {
        try {
            let Log = new MonitorLogModel();
            let LogHour = new MonitorLogByHourModel();
            let LogDay = new MonitorLogByDayModel();
            let LogWeek = new MonitorLogByWeekModel();

            Log.monitorId = data.monitorId;
            Log.probeId = data.probeId;
            Log.status = data.status;
            Log.responseTime = data.responseTime;
            Log.responseStatus = data.responseStatus;

            if (data.data) {
                Log.cpuLoad = data.data.load.currentload;
                Log.avgCpuLoad = data.data.load.avgload;
                Log.cpuCores = data.data.load.cpus.length;
                Log.memoryUsed = data.data.memory.used;
                Log.totalMemory = data.data.memory.total;
                Log.swapUsed = data.data.memory.swapused;
                Log.storageUsed = data.data.disk.used;
                Log.totalStorage = data.data.disk.size;
                Log.storageUsage = data.data.disk.use;
                Log.mainTemp = data.data.temperature.main;
                Log.maxTemp = data.data.temperature.max;
            }

            var savedLog = await Log.save();

            var now = new Date();
            var intervalHourDate = moment(now).format('MMM Do YYYY, h A');
            var logByHour = await MonitorLogByHourModel.findOne({ probeId: data.probeId, monitorId: data.monitorId, intervalDate: intervalHourDate });

            if (logByHour) {
                let hourData = {
                    status: data.status,
                    responseTime: data.responseTime,
                    responseStatus: data.responseStatus,
                    createdAt: Date.now(),
                    maxResponseTime: data.responseTime > logByHour.maxResponseTime ? data.responseTime : logByHour.maxResponseTime,
                };

                if (data.data) {
                    hourData.cpuLoad = data.data.load.currentload;
                    hourData.avgCpuLoad = data.data.load.avgload;
                    hourData.cpuCores = data.data.load.cpus.length;
                    hourData.memoryUsed = data.data.memory.used;
                    hourData.totalMemory = data.data.memory.total;
                    hourData.swapUsed = data.data.memory.swapused;
                    hourData.storageUsed = data.data.disk.used;
                    hourData.totalStorage = data.data.disk.size;
                    hourData.storageUsage = data.data.disk.use;
                    hourData.mainTemp = data.data.temperature.main;
                    hourData.maxTemp = data.data.temperature.max;
                    hourData.maxCpuLoad = data.data.load.currentload > logByHour.maxCpuLoad ? data.data.load.currentload : logByHour.maxCpuLoad;
                    hourData.maxMemoryUsed = data.data.memory.used > logByHour.maxMemoryUsed ? data.data.memory.used : logByHour.maxMemoryUsed;
                    hourData.maxStorageUsed = data.data.disk.used > logByHour.maxStorageUsed ? data.data.disk.used : logByHour.maxStorageUsed;
                    hourData.maxMainTemp = data.data.temperature.main > logByHour.maxMainTemp ? data.data.temperature.main : logByHour.maxMainTemp;
                }

                await MonitorLogByHourModel.findOneAndUpdate({ _id: logByHour._id }, { $set: hourData }, { new: true });
            } else {
                LogHour.monitorId = data.monitorId;
                LogHour.probeId = data.probeId;
                LogHour.status = data.status;
                LogHour.responseTime = data.responseTime;
                LogHour.responseStatus = data.responseStatus;

                if (data.data) {
                    LogHour.cpuLoad = data.data.load.currentload;
                    LogHour.avgCpuLoad = data.data.load.avgload;
                    LogHour.cpuCores = data.data.load.cpus.length;
                    LogHour.memoryUsed = data.data.memory.used;
                    LogHour.totalMemory = data.data.memory.total;
                    LogHour.swapUsed = data.data.memory.swapused;
                    LogHour.storageUsed = data.data.disk.used;
                    LogHour.totalStorage = data.data.disk.size;
                    LogHour.storageUsage = data.data.disk.use;
                    LogHour.mainTemp = data.data.temperature.main;
                    LogHour.maxTemp = data.data.temperature.max;
                    LogHour.maxCpuLoad = data.data.load.currentload;
                    LogHour.maxMemoryUsed = data.data.memory.used;
                    LogHour.maxStorageUsed = data.data.disk.used;
                    LogHour.maxMainTemp = data.data.temperature.main;
                }

                LogHour.maxResponseTime = data.responseTime;
                LogHour.intervalDate = intervalHourDate;

                await LogHour.save();
            }

            var intervalDayDate = moment(now).format('MMM Do YYYY');
            var logByDay = await MonitorLogByDayModel.findOne({ probeId: data.probeId, monitorId: data.monitorId, intervalDate: intervalDayDate });

            if (logByDay) {
                let dayData = {
                    status: data.status,
                    responseTime: data.responseTime,
                    responseStatus: data.responseStatus,
                    createdAt: Date.now(),
                    maxResponseTime: data.responseTime > logByDay.maxResponseTime ? data.responseTime : logByDay.maxResponseTime,
                };

                if (data.data) {
                    dayData.cpuLoad = data.data.load.currentload;
                    dayData.avgCpuLoad = data.data.load.avgload;
                    dayData.cpuCores = data.data.load.cpus.length;
                    dayData.memoryUsed = data.data.memory.used;
                    dayData.totalMemory = data.data.memory.total;
                    dayData.swapUsed = data.data.memory.swapused;
                    dayData.storageUsed = data.data.disk.used;
                    dayData.totalStorage = data.data.disk.size;
                    dayData.storageUsage = data.data.disk.use;
                    dayData.mainTemp = data.data.temperature.main;
                    dayData.maxTemp = data.data.temperature.max;
                    dayData.maxCpuLoad = data.data.load.currentload > logByDay.maxCpuLoad ? data.data.load.currentload : logByDay.maxCpuLoad;
                    dayData.maxMemoryUsed = data.data.memory.used > logByDay.maxMemoryUsed ? data.data.memory.used : logByDay.maxMemoryUsed;
                    dayData.maxStorageUsed = data.data.disk.used > logByDay.maxStorageUsed ? data.data.disk.used : logByDay.maxStorageUsed;
                    dayData.maxMainTemp = data.data.temperature.main > logByDay.maxMainTemp ? data.data.temperature.main : logByDay.maxMainTemp;
                }

                await MonitorLogByDayModel.findOneAndUpdate({ _id: logByDay._id }, { $set: dayData }, { new: true });
            } else {
                LogDay.monitorId = data.monitorId;
                LogDay.probeId = data.probeId;
                LogDay.status = data.status;
                LogDay.responseTime = data.responseTime;
                LogDay.responseStatus = data.responseStatus;

                if (data.data) {
                    LogDay.cpuLoad = data.data.load.currentload;
                    LogDay.avgCpuLoad = data.data.load.avgload;
                    LogDay.cpuCores = data.data.load.cpus.length;
                    LogDay.memoryUsed = data.data.memory.used;
                    LogDay.totalMemory = data.data.memory.total;
                    LogDay.swapUsed = data.data.memory.swapused;
                    LogDay.storageUsed = data.data.disk.used;
                    LogDay.totalStorage = data.data.disk.size;
                    LogDay.storageUsage = data.data.disk.use;
                    LogDay.mainTemp = data.data.temperature.main;
                    LogDay.maxTemp = data.data.temperature.max;
                    LogDay.maxCpuLoad = data.data.load.currentload;
                    LogDay.maxMemoryUsed = data.data.memory.used;
                    LogDay.maxStorageUsed = data.data.disk.used;
                    LogDay.maxMainTemp = data.data.temperature.main;
                }

                LogDay.maxResponseTime = data.responseTime;
                LogDay.intervalDate = intervalDayDate;

                await LogDay.save();
            }

            var intervalWeekDate = moment(now).format('wo [week of] YYYY');
            var logByWeek = await MonitorLogByWeekModel.findOne({ probeId: data.probeId, monitorId: data.monitorId, intervalDate: intervalWeekDate });

            if (logByWeek) {
                let weekData = {
                    status: data.status,
                    responseTime: data.responseTime,
                    responseStatus: data.responseStatus,
                    createdAt: Date.now(),
                    maxResponseTime: data.responseTime > logByWeek.maxResponseTime ? data.responseTime : logByWeek.maxResponseTime,
                };

                if (data.data) {
                    weekData.cpuLoad = data.data.load.currentload;
                    weekData.avgCpuLoad = data.data.load.avgload;
                    weekData.cpuCores = data.data.load.cpus.length;
                    weekData.memoryUsed = data.data.memory.used;
                    weekData.totalMemory = data.data.memory.total;
                    weekData.swapUsed = data.data.memory.swapused;
                    weekData.storageUsed = data.data.disk.used;
                    weekData.totalStorage = data.data.disk.size;
                    weekData.storageUsage = data.data.disk.use;
                    weekData.mainTemp = data.data.temperature.main;
                    weekData.maxTemp = data.data.temperature.max;
                    weekData.maxCpuLoad = data.data.load.currentload > logByWeek.maxCpuLoad ? data.data.load.currentload : logByWeek.maxCpuLoad;
                    weekData.maxMemoryUsed = data.data.memory.used > logByWeek.maxMemoryUsed ? data.data.memory.used : logByWeek.maxMemoryUsed;
                    weekData.maxStorageUsed = data.data.disk.used > logByWeek.maxStorageUsed ? data.data.disk.used : logByWeek.maxStorageUsed;
                    weekData.maxMainTemp = data.data.temperature.main > logByWeek.maxMainTemp ? data.data.temperature.main : logByWeek.maxMainTemp;
                }

                await MonitorLogByWeekModel.findOneAndUpdate({ _id: logByWeek._id }, { $set: weekData }, { new: true });
            } else {
                LogWeek.monitorId = data.monitorId;
                LogWeek.probeId = data.probeId;
                LogWeek.status = data.status;
                LogWeek.responseTime = data.responseTime;
                LogWeek.responseStatus = data.responseStatus;

                if (data.data) {
                    LogWeek.cpuLoad = data.data.load.currentload;
                    LogWeek.avgCpuLoad = data.data.load.avgload;
                    LogWeek.cpuCores = data.data.load.cpus.length;
                    LogWeek.memoryUsed = data.data.memory.used;
                    LogWeek.totalMemory = data.data.memory.total;
                    LogWeek.swapUsed = data.data.memory.swapused;
                    LogWeek.storageUsed = data.data.disk.used;
                    LogWeek.totalStorage = data.data.disk.size;
                    LogWeek.storageUsage = data.data.disk.use;
                    LogWeek.mainTemp = data.data.temperature.main;
                    LogWeek.maxTemp = data.data.temperature.max;
                    LogWeek.maxCpuLoad = data.data.load.currentload;
                    LogWeek.maxMemoryUsed = data.data.memory.used;
                    LogWeek.maxStorageUsed = data.data.disk.used;
                    LogWeek.maxMainTemp = data.data.temperature.main;
                }

                LogWeek.maxResponseTime = data.responseTime;
                LogWeek.intervalDate = intervalWeekDate;

                await LogWeek.save();
            }

            await MonitorService.sendResponseTime(savedLog);
            await MonitorService.sendMonitorLog(savedLog);

            if (data.probeId && data.monitorId) await this.sendProbe(data.probeId, data.monitorId);

            return savedLog;
        } catch (error) {
            ErrorService.log('ProbeService.createMonitorLog', error);
            throw error;
        }
    },

    updateMonitorLogBy: async function (query, data) {
        try {
            if (!query) {
                query = {};
            }
            var Log = await MonitorLogModel.findOneAndUpdate(query,
                { $set: data },
                {
                    new: true
                });
            return Log;
        } catch (error) {
            ErrorService.log('ProbeService.updateMonitorLogBy', error);
            throw error;
        }
    },

    createMonitorStatus: async function (data) {
        try {
            let MonitorStatus = new MonitorStatusModel();
            MonitorStatus.monitorId = data.monitorId;
            MonitorStatus.probeId = data.probeId;
            MonitorStatus.responseTime = data.responseTime;
            MonitorStatus.status = data.status;
            if (data.startTime) {
                MonitorStatus.startTime = data.startTime;
            }
            if (data.endTime) {
                MonitorStatus.endTime = data.endTime;
            }
            if (data.createdAt) {
                MonitorStatus.createdAt = data.createdAt;
            }
            var savedMonitorStatus = await MonitorStatus.save();
            return savedMonitorStatus;
        } catch (error) {
            ErrorService.log('ProbeService.createMonitorStatus', error);
            throw error;
        }
    },

    updateMonitorStatus: async function (monitorStatusId) {
        try {
            var MonitorStatus = await MonitorStatusModel.findOneAndUpdate({ _id: monitorStatusId },
                { $set: { endTime: Date.now() } },
                {
                    new: true
                });
            return MonitorStatus;
        } catch (error) {
            ErrorService.log('ProbeService.updateMonitorStatus', error);
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
            var statuses = await MonitorStatusModel.find({ monitorId: data.monitorId, probeId: data.probeId })
                .sort([['createdAt', -1]])
                .limit(1);
            var log = await _this.createMonitorLog(data);
            var lastStatus = statuses && statuses[0] && statuses[0].status ? statuses[0].status : null;
            var lastStatusId = statuses && statuses[0] && statuses[0]._id ? statuses[0]._id : null;
            if (!lastStatus) {
                await _this.createMonitorStatus(data);
                let tempMon = await _this.incidentCreateOrUpdate(data, lastStatus);
                mon = tempMon.mon;
                incidentIds = tempMon.incidentIds;
                autoAcknowledge = lastStatus && lastStatus === 'degraded' ? mon.criteria.degraded.autoAcknowledge : lastStatus === 'offline' ? mon.criteria.down.autoAcknowledge : false;
                autoResolve = lastStatus === 'degraded' ? mon.criteria.degraded.autoResolve : lastStatus === 'offline' ? mon.criteria.down.autoResolve : false;
                await _this.incidentResolveOrAcknowledge(data, lastStatus, autoAcknowledge, autoResolve);
            }
            else if (lastStatus && lastStatus !== data.status) {
                if (lastStatusId) {
                    await _this.updateMonitorStatus(lastStatusId);
                }
                await _this.createMonitorStatus(data);
                let tempMon = await _this.incidentCreateOrUpdate(data, lastStatus);
                mon = tempMon.mon;
                incidentIds = tempMon.incidentIds;
                autoAcknowledge = lastStatus && lastStatus === 'degraded' ? mon.criteria.degraded.autoAcknowledge : lastStatus === 'offline' ? mon.criteria.down.autoAcknowledge : false;
                autoResolve = lastStatus === 'degraded' ? mon.criteria.degraded.autoResolve : lastStatus === 'offline' ? mon.criteria.down.autoResolve : false;
                await _this.incidentResolveOrAcknowledge(data, lastStatus, autoAcknowledge, autoResolve);
            }
            if (incidentIds && incidentIds.length) {
                log = await _this.updateMonitorLogBy({ _id: log._id }, { incidentIds });
            }
            return log;
        } catch (error) {
            ErrorService.log('ProbeService.setTime', error);
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
                        probeId: data.probeId
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
                        probeId: data.probeId
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
                        probeId: data.probeId
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

    getTime: async function (data) {
        try {
            var date = new Date();
            var log = await MonitorLogModel.findOne({ monitorId: data.monitorId, probeId: data.probeId, createdAt: { $lt: data.date || date } });
            return log;
        } catch (error) {
            ErrorService.log('probeService.getTime', error);
            throw error;
        }
    },

    getMonitorsWithMonitorStatusBy: async function (query) {
        try {
            var _this = this;
            var newmonitors = [];
            var monitors = await MonitorService.findBy(query.query, query.limit, query.skip);

            if (monitors.length) {
                await Promise.all(monitors.map(async (element) => {
                    if (element && element._doc) {
                        element = element._doc;
                    }

                    element.probes = await _this.getMonitorData(element._id || element.id);

                    newmonitors.push(element);
                }));
                return newmonitors;

            } else {
                return [];
            }
        } catch (error) {
            ErrorService.log('probeService.getMonitorsWithMonitorStatusBy', error);
            throw error;
        }
    },

    getMonitorData: async function (monitorId) {
        try {
            var _this = this;
            var probes = await _this.findBy({});
            var targetDate = moment(Date.now()).subtract(90, 'days').startOf('day');
            var newProbes = Promise.all(probes.map(async (probe) => {
                probe = probe.toObject();
                var probeStatus = await _this.getLogs({
                    probeId: probe._id, monitorId: monitorId,
                    $or: [
                        { 'startTime': { $gt: targetDate } }, { $or: [{ 'endTime': { $gt: targetDate } }, { 'endTime': null }] }
                    ]
                });
                var latestLog = await MonitorLogModel
                    .find({ probeId: probe._id, monitorId: monitorId })
                    .sort({ createdAt: -1 })
                    .limit(1);
                probe.probeStatus = probeStatus;
                probe.status = latestLog && latestLog[0] && latestLog[0].status ? latestLog[0].status : '';
                probe.responseTime = latestLog && latestLog[0] && latestLog[0].responseTime ? latestLog[0].responseTime : '';
                return probe;
            }));
            return newProbes;
        } catch (error) {
            ErrorService.log('probeService.getMonitorData', error);
            throw error;
        }
    },

    getLogs: async function (query) {
        try {
            if (!query) {
                query = {};
            }
            var log = await MonitorStatusModel.find(query).sort({ createdAt: -1 });
            return log;
        } catch (error) {
            ErrorService.log('probeService.getLogs', error);
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
                if (!(con[i] && con[i].field1 && payload.load && payload.load.currentload && payload.load.currentload > con[i].field1)) {
                    validity = false;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'lessThan') {
                if (!(con[i] && con[i].field1 && payload.load && payload.load.currentload && payload.load.currentload < con[i].field1)) {
                    validity = false;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'inBetween') {
                if (!(con[i] && con[i].field1 && payload.load && payload.load.currentload && con[i].field2 && payload.load.currentload > con[i].field1 && payload.load.currentload < con[i].field2)) {
                    validity = false;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'equalTo') {
                if (!(con[i] && con[i].field1 && payload.load && payload.load.currentload && payload.load.currentload == con[i].field1)) {
                    validity = false;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'notEqualTo') {
                if (!(con[i] && con[i].field1 && payload.load && payload.load.currentload && payload.load.currentload != con[i].field1)) {
                    validity = false;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'gtEqualTo') {
                if (!(con[i] && con[i].field1 && payload.load && payload.load.currentload && payload.load.currentload >= con[i].field1)) {
                    validity = false;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'ltEqualTo') {
                if (!(con[i] && con[i].field1 && payload.load && payload.load.currentload && payload.load.currentload <= con[i].field1)) {
                    validity = false;
                }
            }
        }
        else if (con[i] && con[i].responseType === 'memoryUsage') {
            if (con[i] && con[i].filter && con[i].filter === 'greaterThan') {
                if (!(con[i] && con[i].field1 && payload.memory && payload.memory.used && payload.memory.used > con[i].field1)) {
                    validity = false;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'lessThan') {
                if (!(con[i] && con[i].field1 && payload.memory && payload.memory.used && payload.memory.used < con[i].field1)) {
                    validity = false;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'inBetween') {
                if (!(con[i] && con[i].field1 && payload.memory && payload.memory.used && con[i].field2 && payload.memory.used > con[i].field1 && payload.memory.used < con[i].field2)) {
                    validity = false;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'equalTo') {
                if (!(con[i] && con[i].field1 && payload.memory && payload.memory.used && payload.memory.used == con[i].field1)) {
                    validity = false;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'notEqualTo') {
                if (!(con[i] && con[i].field1 && payload.memory && payload.memory.used && payload.memory.used != con[i].field1)) {
                    validity = false;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'gtEqualTo') {
                if (!(con[i] && con[i].field1 && payload.memory && payload.memory.used && payload.memory.used >= con[i].field1)) {
                    validity = false;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'ltEqualTo') {
                if (!(con[i] && con[i].field1 && payload.memory && payload.memory.used && payload.memory.used <= con[i].field1)) {
                    validity = false;
                }
            }
        }
        else if (con[i] && con[i].responseType === 'storageUsage') {
            let size = parseInt(payload.disk.size);
            let used = parseInt(payload.disk.used);
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
                if (!(con[i] && con[i].field1 && payload.temperature && payload.temperature.main && payload.temperature.main > con[i].field1)) {
                    validity = false;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'lessThan') {
                if (!(con[i] && con[i].field1 && payload.temperature && payload.temperature.main && payload.temperature.main < con[i].field1)) {
                    validity = false;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'inBetween') {
                if (!(con[i] && con[i].field1 && payload.temperature && payload.temperature.main && con[i].field2 && payload.temperature.main > con[i].field1 && payload.temperature.main < con[i].field2)) {
                    validity = false;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'equalTo') {
                if (!(con[i] && con[i].field1 && payload.temperature && payload.temperature.main && payload.temperature.main == con[i].field1)) {
                    validity = false;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'notEqualTo') {
                if (!(con[i] && con[i].field1 && payload.temperature && payload.temperature.main && payload.temperature.main != con[i].field1)) {
                    validity = false;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'gtEqualTo') {
                if (!(con[i] && con[i].field1 && payload.temperature && payload.temperature.main && payload.temperature.main >= con[i].field1)) {
                    validity = false;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'ltEqualTo') {
                if (!(con[i] && con[i].field1 && payload.temperature && payload.temperature.main && payload.temperature.main <= con[i].field1)) {
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
                if (con[i] && con[i].field1 && payload.load && payload.load.currentload && payload.load.currentload > con[i].field1) {
                    validity = true;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'lessThan') {
                if (con[i] && con[i].field1 && payload.load && payload.load.currentload && payload.load.currentload < con[i].field1) {
                    validity = true;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'inBetween') {
                if (con[i] && con[i].field1 && payload.load && payload.load.currentload && con[i].field2 && payload.load.currentload > con[i].field1 && payload.load.currentload < con[i].field2) {
                    validity = true;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'equalTo') {
                if (con[i] && con[i].field1 && payload.load && payload.load.currentload && payload.load.currentload == con[i].field1) {
                    validity = true;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'notEqualTo') {
                if (con[i] && con[i].field1 && payload.load && payload.load.currentload && payload.load.currentload != con[i].field1) {
                    validity = true;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'gtEqualTo') {
                if (con[i] && con[i].field1 && payload.load && payload.load.currentload && payload.load.currentload >= con[i].field1) {
                    validity = true;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'ltEqualTo') {
                if (con[i] && con[i].field1 && payload.load && payload.load.currentload && payload.load.currentload <= con[i].field1) {
                    validity = true;
                }
            }
        }
        else if (con[i] && con[i].responseType === 'memoryUsage') {
            if (con[i] && con[i].filter && con[i].filter === 'greaterThan') {
                if (con[i] && con[i].field1 && payload.memory && payload.memory.used && payload.memory.used > con[i].field1) {
                    validity = true;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'lessThan') {
                if (con[i] && con[i].field1 && payload.memory && payload.memory.used && payload.memory.used < con[i].field1) {
                    validity = true;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'inBetween') {
                if (con[i] && con[i].field1 && payload.memory && payload.memory.used && con[i].field2 && payload.memory.used > con[i].field1 && payload.memory.used < con[i].field2) {
                    validity = true;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'equalTo') {
                if (con[i] && con[i].field1 && payload.memory && payload.memory.used && payload.memory.used == con[i].field1) {
                    validity = true;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'notEqualTo') {
                if (con[i] && con[i].field1 && payload.memory && payload.memory.used && payload.memory.used != con[i].field1) {
                    validity = true;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'gtEqualTo') {
                if (con[i] && con[i].field1 && payload.memory && payload.memory.used && payload.memory.used >= con[i].field1) {
                    validity = true;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'ltEqualTo') {
                if (con[i] && con[i].field1 && payload.memory && payload.memory.used && payload.memory.used <= con[i].field1) {
                    validity = true;
                }
            }
        }
        else if (con[i] && con[i].responseType === 'storageUsage') {
            let size = parseInt(payload.disk.size);
            let used = parseInt(payload.disk.used);
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
                if (con[i] && con[i].field1 && payload.temperature && payload.temperature.main && payload.temperature.main > con[i].field1) {
                    validity = true;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'lessThan') {
                if (con[i] && con[i].field1 && payload.temperature && payload.temperature.main && payload.temperature.main < con[i].field1) {
                    validity = true;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'inBetween') {
                if (con[i] && con[i].field1 && payload.temperature && payload.temperature.main && con[i].field2 && payload.temperature.main > con[i].field1 && payload.temperature.main < con[i].field2) {
                    validity = true;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'equalTo') {
                if (con[i] && con[i].field1 && payload.temperature && payload.temperature.main && payload.temperature.main == con[i].field1) {
                    validity = true;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'notEqualTo') {
                if (con[i] && con[i].field1 && payload.temperature && payload.temperature.main && payload.temperature.main != con[i].field1) {
                    validity = true;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'gtEqualTo') {
                if (con[i] && con[i].field1 && payload.temperature && payload.temperature.main && payload.temperature.main >= con[i].field1) {
                    validity = true;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'ltEqualTo') {
                if (con[i] && con[i].field1 && payload.temperature && payload.temperature.main && payload.temperature.main <= con[i].field1) {
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
let MonitorLogModel = require('../models/monitorLog');
let MonitorLogByHourModel = require('../models/monitorLogByHour');
let MonitorLogByDayModel = require('../models/monitorLogByDay');
let MonitorLogByWeekModel = require('../models/monitorLogByWeek');
let MonitorStatusModel = require('../models/monitorStatus');
var RealTimeService = require('./realTimeService');
let ErrorService = require('./errorService');
let uuidv1 = require('uuid/v1');
var moment = require('moment');
let MonitorService = require('./monitorService');
let IncidentService = require('./incidentService');
