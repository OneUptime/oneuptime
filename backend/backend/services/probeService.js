module.exports = {
    create: async function(data) {
        try {
            const _this = this;
            let probeKey;
            if (data.probeKey) {
                probeKey = data.probeKey;
            } else {
                probeKey = uuidv1();
            }
            const storedProbe = await _this.findOneBy({
                probeName: data.probeName,
            });
            if (storedProbe && storedProbe.probeName) {
                const error = new Error('Probe name already exists.');
                error.code = 400;
                ErrorService.log('probe.create', error);
                throw error;
            } else {
                const probe = new ProbeModel();
                probe.probeKey = probeKey;
                probe.probeName = data.probeName;
                const savedProbe = await probe.save();
                return savedProbe;
            }
        } catch (error) {
            ErrorService.log('ProbeService.create', error);
            throw error;
        }
    },

    updateOneBy: async function(query, data) {
        try {
            if (!query) {
                query = {};
            }

            query.deleted = false;
            const probe = await ProbeModel.findOneAndUpdate(
                query,
                { $set: data },
                {
                    new: true,
                }
            );
            return probe;
        } catch (error) {
            ErrorService.log('ProbeService.updateOneBy', error);
            throw error;
        }
    },

    updateBy: async function(query, data) {
        try {
            if (!query) {
                query = {};
            }

            if (!query.deleted) query.deleted = false;
            let updatedData = await ProbeModel.updateMany(query, {
                $set: data,
            });
            updatedData = await this.findBy(query);
            return updatedData;
        } catch (error) {
            ErrorService.log('ProbeService.updateMany', error);
            throw error;
        }
    },

    findBy: async function(query, limit, skip) {
        try {
            if (!skip) skip = 0;

            if (!limit) limit = 0;

            if (typeof skip === 'string') {
                skip = parseInt(skip);
            }

            if (typeof limit === 'string') {
                limit = parseInt(limit);
            }

            if (!query) {
                query = {};
            }

            query.deleted = false;
            const probe = await ProbeModel.find(query)
                .sort([['createdAt', -1]])
                .limit(limit)
                .skip(skip);
            return probe;
        } catch (error) {
            ErrorService.log('ProbeService.findBy', error);
            throw error;
        }
    },

    findOneBy: async function(query) {
        try {
            if (!query) {
                query = {};
            }

            query.deleted = false;
            const probe = await ProbeModel.findOne(query);
            return probe;
        } catch (error) {
            ErrorService.log('ProbeService.findOneBy', error);
            throw error;
        }
    },

    countBy: async function(query) {
        try {
            if (!query) {
                query = {};
            }

            query.deleted = false;
            const count = await ProbeModel.countDocuments(query);
            return count;
        } catch (error) {
            ErrorService.log('ProbeService.countBy', error);
            throw error;
        }
    },

    deleteBy: async function(query) {
        try {
            if (!query) {
                query = {};
            }
            query.deleted = false;
            const probe = await ProbeModel.findOneAndUpdate(
                query,
                { $set: { deleted: true, deletedAt: Date.now() } },
                { new: true }
            );
            return probe;
        } catch (error) {
            ErrorService.log('ProbeService.deleteBy', error);
            throw error;
        }
    },

    hardDeleteBy: async function(query) {
        try {
            await ProbeModel.deleteMany(query);
            return 'Probe(s) removed successfully!';
        } catch (error) {
            ErrorService.log('ProbeService.hardDeleteBy', error);
            throw error;
        }
    },

    sendProbe: async function(probeId, monitorId) {
        try {
            const probe = await this.findOneBy({ _id: probeId });
            if (probe) {
                delete probe._doc.deleted;
                await RealTimeService.updateProbe(probe, monitorId);
            }
        } catch (error) {
            ErrorService.log('ProbeService.sendProbe', error);
            throw error;
        }
    },

    saveMonitorLog: async function(data) {
        try {
            const _this = this;
            const monitorStatus = await MonitorStatusService.findOneBy({
                monitorId: data.monitorId,
                probeId: data.probeId,
            });
            const lastStatus =
                monitorStatus && monitorStatus.status
                    ? monitorStatus.status
                    : null;

            let log = await MonitorLogService.create(data);

            if (!lastStatus || (lastStatus && lastStatus !== data.status)) {
                // check if monitor has a previous status
                // check if previous status is different from the current status
                // if different, resolve last incident, create a new incident and monitor status
                if (lastStatus) {
                    const monitor = await MonitorService.findOneBy({
                        _id: data.monitorId,
                    });
                    const autoAcknowledge =
                        lastStatus && lastStatus === 'degraded'
                            ? monitor.criteria.degraded.autoAcknowledge
                            : lastStatus === 'offline'
                            ? monitor.criteria.down.autoAcknowledge
                            : false;
                    const autoResolve =
                        lastStatus === 'degraded'
                            ? monitor.criteria.degraded.autoResolve
                            : lastStatus === 'offline'
                            ? monitor.criteria.down.autoResolve
                            : false;
                    await _this.incidentResolveOrAcknowledge(
                        data,
                        lastStatus,
                        autoAcknowledge,
                        autoResolve
                    );
                }

                const incidentIds = await _this.incidentCreateOrUpdate(data);
                await MonitorStatusService.create(data);

                if (incidentIds && incidentIds.length) {
                    log = await MonitorLogService.updateOneBy(
                        { _id: log._id },
                        { incidentIds }
                    );
                }
            }
            return log;
        } catch (error) {
            ErrorService.log('ProbeService.saveMonitorLog', error);
            throw error;
        }
    },

    getMonitorLog: async function(data) {
        try {
            const date = new Date();
            const log = await MonitorLogService.findOneBy({
                monitorId: data.monitorId,
                probeId: data.probeId,
                createdAt: { $lt: data.date || date },
            });
            return log;
        } catch (error) {
            ErrorService.log('probeService.getMonitorLog', error);
            throw error;
        }
    },

    incidentCreateOrUpdate: async function(data) {
        try {
            const monitor = await MonitorService.findOneBy({
                _id: data.monitorId,
            });
            const incidents = await IncidentService.findBy({
                monitorId: data.monitorId,
                incidentType: data.status,
                resolved: false,
            });
            let incidentIds = [];

            if (
                data.status === 'online' &&
                monitor &&
                monitor.criteria &&
                monitor.criteria.up &&
                monitor.criteria.up.createAlert
            ) {
                if (incidents && incidents.length) {
                    incidentIds = incidents.map(async incident => {
                        const newIncident = await IncidentService.updateOneBy(
                            {
                                _id: incident._id,
                            },
                            {
                                probes: incident.probes.concat({
                                    probeId: data.probeId,
                                    updatedAt: Date.now(),
                                    status: true,
                                    reportedStatus: data.status,
                                }),
                            }
                        );

                        await IncidentTimelineService.create({
                            incidentId: incident._id,
                            probeId: data.probeId,
                            status: data.status,
                        });

                        return newIncident;
                    });
                } else {
                    incidentIds = await [
                        IncidentService.create({
                            projectId: monitor.projectId,
                            monitorId: data.monitorId,
                            createdById: null,
                            incidentType: 'online',
                            probeId: data.probeId,
                        }),
                    ];
                }
            } else if (
                data.status === 'degraded' &&
                monitor &&
                monitor.criteria &&
                monitor.criteria.degraded &&
                monitor.criteria.degraded.createAlert
            ) {
                if (incidents && incidents.length) {
                    incidentIds = incidents.map(async incident => {
                        const newIncident = await IncidentService.updateOneBy(
                            {
                                _id: incident._id,
                            },
                            {
                                probes: incident.probes.concat({
                                    probeId: data.probeId,
                                    updatedAt: Date.now(),
                                    status: true,
                                    reportedStatus: data.status,
                                }),
                            }
                        );

                        await IncidentTimelineService.create({
                            incidentId: incident._id,
                            probeId: data.probeId,
                            status: data.status,
                        });

                        return newIncident;
                    });
                } else {
                    incidentIds = await [
                        IncidentService.create({
                            projectId: monitor.projectId,
                            monitorId: data.monitorId,
                            createdById: null,
                            incidentType: 'degraded',
                            probeId: data.probeId,
                        }),
                    ];
                }
            } else if (
                data.status === 'offline' &&
                monitor &&
                monitor.criteria &&
                monitor.criteria.down &&
                monitor.criteria.down.createAlert
            ) {
                if (incidents && incidents.length) {
                    incidentIds = incidents.map(async incident => {
                        const newIncident = await IncidentService.updateOneBy(
                            {
                                _id: incident._id,
                            },
                            {
                                probes: incident.probes.concat({
                                    probeId: data.probeId,
                                    updatedAt: Date.now(),
                                    status: true,
                                    reportedStatus: data.status,
                                }),
                            }
                        );

                        await IncidentTimelineService.create({
                            incidentId: incident._id,
                            probeId: data.probeId,
                            status: data.status,
                        });

                        return newIncident;
                    });
                } else {
                    incidentIds = await [
                        IncidentService.create({
                            projectId: monitor.projectId,
                            monitorId: data.monitorId,
                            createdById: null,
                            incidentType: 'offline',
                            probeId: data.probeId,
                        }),
                    ];
                }
            }
            incidentIds = await Promise.all(incidentIds);
            incidentIds = incidentIds.map(i => i._id);
            return incidentIds;
        } catch (error) {
            ErrorService.log('ProbeService.incidentCreateOrUpdate', error);
            throw error;
        }
    },

    incidentResolveOrAcknowledge: async function(
        data,
        lastStatus,
        autoAcknowledge,
        autoResolve
    ) {
        try {
            const incidents = await IncidentService.findBy({
                monitorId: data.monitorId,
                incidentType: lastStatus,
                resolved: false,
            });
            const incidentsV1 = [];
            const incidentsV2 = [];
            if (incidents && incidents.length) {
                if (lastStatus && lastStatus !== data.status) {
                    incidents.forEach(incident => {
                        incident.probes.some(probe => {
                            if (
                                String(probe.probeId._id) ===
                                String(data.probeId)
                            ) {
                                incidentsV1.push(incident);
                                return true;
                            } else return false;
                        });
                    });
                }
            }
            await Promise.all(
                incidentsV1.map(async incident => {
                    const newIncident = await IncidentService.updateOneBy(
                        {
                            _id: incident._id,
                        },
                        {
                            probes: incident.probes.concat([
                                {
                                    probeId: data.probeId,
                                    updatedAt: Date.now(),
                                    status: false,
                                    reportedStatus: data.status,
                                },
                            ]),
                        }
                    );
                    incidentsV2.push(newIncident);

                    await IncidentTimelineService.create({
                        incidentId: incident._id,
                        probeId: data.probeId,
                        status: data.status,
                    });

                    return newIncident;
                })
            );

            incidentsV2.forEach(async incident => {
                const trueArray = [];
                const falseArray = [];
                incident.probes.forEach(probe => {
                    if (probe.status) {
                        trueArray.push(probe);
                    } else {
                        falseArray.push(probe);
                    }
                });
                if (trueArray.length === falseArray.length) {
                    if (autoAcknowledge) {
                        if (!incident.acknowledged) {
                            await IncidentService.acknowledge(
                                incident._id,
                                null,
                                'fyipe',
                                data.probeId
                            );
                        }
                    }
                    if (autoResolve) {
                        await IncidentService.resolve(
                            incident._id,
                            null,
                            'fyipe',
                            data.probeId
                        );
                    }
                }
            });
            return {};
        } catch (error) {
            ErrorService.log(
                'ProbeService.incidentResolveOrAcknowledge',
                error
            );
            throw error;
        }
    },

    updateProbeStatus: async function(probeId) {
        try {
            const probe = await ProbeModel.findOneAndUpdate(
                { _id: probeId },
                { $set: { lastAlive: Date.now() } },
                { new: true }
            );
            return probe;
        } catch (error) {
            ErrorService.log('probeService.updateProbeStatus', error);
            throw error;
        }
    },

    conditions: async (payload, resp, con) => {
        let stat = true;
        const status = resp
            ? resp.status
                ? resp.status
                : resp.statusCode
                ? resp.statusCode
                : null
            : null;
        const body = resp && resp.body ? resp.body : null;

        if (con && con.and && con.and.length) {
            stat = await checkAnd(payload, con.and, status, body);
        } else if (con && con.or && con.or.length) {
            stat = await checkOr(payload, con.or, status, body);
        }
        return stat;
    },
};

const _ = require('lodash');

const checkAnd = async (payload, con, statusCode, body) => {
    let validity = true;
    for (let i = 0; i < con.length; i++) {
        if (
            con[i] &&
            con[i].responseType &&
            con[i].responseType === 'responseTime'
        ) {
            if (con[i] && con[i].filter && con[i].filter === 'greaterThan') {
                if (
                    !(
                        con[i] &&
                        con[i].field1 &&
                        payload &&
                        payload > con[i].field1
                    )
                ) {
                    validity = false;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'lessThan'
            ) {
                if (
                    !(
                        con[i] &&
                        con[i].field1 &&
                        payload &&
                        payload < con[i].field1
                    )
                ) {
                    validity = false;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'inBetween'
            ) {
                if (
                    !(
                        con[i] &&
                        con[i].field1 &&
                        payload &&
                        con[i].field2 &&
                        payload > con[i].field1 &&
                        payload < con[i].field2
                    )
                ) {
                    validity = false;
                }
            } else if (con[i] && con[i].filter && con[i].filter === 'equalTo') {
                if (
                    !(
                        con[i] &&
                        con[i].field1 &&
                        payload &&
                        payload == con[i].field1
                    )
                ) {
                    validity = false;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'notEqualTo'
            ) {
                if (
                    !(
                        con[i] &&
                        con[i].field1 &&
                        payload &&
                        payload != con[i].field1
                    )
                ) {
                    validity = false;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'gtEqualTo'
            ) {
                if (
                    !(
                        con[i] &&
                        con[i].field1 &&
                        payload &&
                        payload >= con[i].field1
                    )
                ) {
                    validity = false;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'ltEqualTo'
            ) {
                if (
                    !(
                        con[i] &&
                        con[i].field1 &&
                        payload &&
                        payload <= con[i].field1
                    )
                ) {
                    validity = false;
                }
            }
        } else if (con[i] && con[i].responseType === 'doesRespond') {
            if (con[i] && con[i].filter && con[i].filter === 'isUp') {
                if (!(con[i] && con[i].filter && payload)) {
                    validity = false;
                }
            } else if (con[i] && con[i].filter && con[i].filter === 'isDown') {
                if (!(con[i] && con[i].filter && !payload)) {
                    validity = false;
                }
            }
        } else if (con[i] && con[i].responseType === 'statusCode') {
            if (con[i] && con[i].filter && con[i].filter === 'greaterThan') {
                if (
                    !(
                        con[i] &&
                        con[i].field1 &&
                        statusCode &&
                        statusCode > con[i].field1
                    )
                ) {
                    validity = false;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'lessThan'
            ) {
                if (
                    !(
                        con[i] &&
                        con[i].field1 &&
                        statusCode &&
                        statusCode < con[i].field1
                    )
                ) {
                    validity = false;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'inBetween'
            ) {
                if (
                    !(
                        con[i] &&
                        con[i].field1 &&
                        statusCode &&
                        con[i].field2 &&
                        statusCode > con[i].field1 &&
                        statusCode < con[i].field2
                    )
                ) {
                    validity = false;
                }
            } else if (con[i] && con[i].filter && con[i].filter === 'equalTo') {
                if (
                    !(
                        con[i] &&
                        con[i].field1 &&
                        statusCode &&
                        statusCode == con[i].field1
                    )
                ) {
                    validity = false;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'notEqualTo'
            ) {
                if (
                    !(
                        con[i] &&
                        con[i].field1 &&
                        statusCode &&
                        statusCode != con[i].field1
                    )
                ) {
                    validity = false;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'gtEqualTo'
            ) {
                if (
                    !(
                        con[i] &&
                        con[i].field1 &&
                        statusCode &&
                        statusCode >= con[i].field1
                    )
                ) {
                    validity = false;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'ltEqualTo'
            ) {
                if (
                    !(
                        con[i] &&
                        con[i].field1 &&
                        statusCode &&
                        statusCode <= con[i].field1
                    )
                ) {
                    validity = false;
                }
            }
        } else if (con[i] && con[i].responseType === 'cpuLoad') {
            if (con[i] && con[i].filter && con[i].filter === 'greaterThan') {
                if (
                    !(
                        con[i] &&
                        con[i].field1 &&
                        payload.cpuLoad &&
                        payload.cpuLoad > con[i].field1
                    )
                ) {
                    validity = false;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'lessThan'
            ) {
                if (
                    !(
                        con[i] &&
                        con[i].field1 &&
                        payload.cpuLoad &&
                        payload.cpuLoad < con[i].field1
                    )
                ) {
                    validity = false;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'inBetween'
            ) {
                if (
                    !(
                        con[i] &&
                        con[i].field1 &&
                        payload.cpuLoad &&
                        con[i].field2 &&
                        payload.cpuLoad > con[i].field1 &&
                        payload.cpuLoad < con[i].field2
                    )
                ) {
                    validity = false;
                }
            } else if (con[i] && con[i].filter && con[i].filter === 'equalTo') {
                if (
                    !(
                        con[i] &&
                        con[i].field1 &&
                        payload.cpuLoad &&
                        payload.cpuLoad == con[i].field1
                    )
                ) {
                    validity = false;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'notEqualTo'
            ) {
                if (
                    !(
                        con[i] &&
                        con[i].field1 &&
                        payload.cpuLoad &&
                        payload.cpuLoad != con[i].field1
                    )
                ) {
                    validity = false;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'gtEqualTo'
            ) {
                if (
                    !(
                        con[i] &&
                        con[i].field1 &&
                        payload.cpuLoad &&
                        payload.cpuLoad >= con[i].field1
                    )
                ) {
                    validity = false;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'ltEqualTo'
            ) {
                if (
                    !(
                        con[i] &&
                        con[i].field1 &&
                        payload.cpuLoad &&
                        payload.cpuLoad <= con[i].field1
                    )
                ) {
                    validity = false;
                }
            }
        } else if (con[i] && con[i].responseType === 'memoryUsage') {
            if (con[i] && con[i].filter && con[i].filter === 'greaterThan') {
                if (
                    !(
                        con[i] &&
                        con[i].field1 &&
                        payload.memoryUsed &&
                        payload.memoryUsed > con[i].field1
                    )
                ) {
                    validity = false;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'lessThan'
            ) {
                if (
                    !(
                        con[i] &&
                        con[i].field1 &&
                        payload.memoryUsed &&
                        payload.memoryUsed < con[i].field1
                    )
                ) {
                    validity = false;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'inBetween'
            ) {
                if (
                    !(
                        con[i] &&
                        con[i].field1 &&
                        payload.memoryUsed &&
                        con[i].field2 &&
                        payload.memoryUsed > con[i].field1 &&
                        payload.memoryUsed < con[i].field2
                    )
                ) {
                    validity = false;
                }
            } else if (con[i] && con[i].filter && con[i].filter === 'equalTo') {
                if (
                    !(
                        con[i] &&
                        con[i].field1 &&
                        payload.memoryUsed &&
                        payload.memoryUsed == con[i].field1
                    )
                ) {
                    validity = false;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'notEqualTo'
            ) {
                if (
                    !(
                        con[i] &&
                        con[i].field1 &&
                        payload.memoryUsed &&
                        payload.memoryUsed != con[i].field1
                    )
                ) {
                    validity = false;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'gtEqualTo'
            ) {
                if (
                    !(
                        con[i] &&
                        con[i].field1 &&
                        payload.memoryUsed &&
                        payload.memoryUsed >= con[i].field1
                    )
                ) {
                    validity = false;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'ltEqualTo'
            ) {
                if (
                    !(
                        con[i] &&
                        con[i].field1 &&
                        payload.memoryUsed &&
                        payload.memoryUsed <= con[i].field1
                    )
                ) {
                    validity = false;
                }
            }
        } else if (con[i] && con[i].responseType === 'storageUsage') {
            const size = parseInt(payload.totalStorage || 0);
            const used = parseInt(payload.storageUsed || 0);
            const free = (size - used) / Math.pow(1e3, 3);
            if (con[i] && con[i].filter && con[i].filter === 'greaterThan') {
                if (!(con[i] && con[i].field1 && free > con[i].field1)) {
                    validity = false;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'lessThan'
            ) {
                if (!(con[i] && con[i].field1 && free < con[i].field1)) {
                    validity = false;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'inBetween'
            ) {
                if (
                    !(
                        con[i] &&
                        con[i].field1 &&
                        con[i].field2 &&
                        free > con[i].field1 &&
                        free < con[i].field2
                    )
                ) {
                    validity = false;
                }
            } else if (con[i] && con[i].filter && con[i].filter === 'equalTo') {
                if (!(con[i] && con[i].field1 && free === con[i].field1)) {
                    validity = false;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'notEqualTo'
            ) {
                if (!(con[i] && con[i].field1 && free !== con[i].field1)) {
                    validity = false;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'gtEqualTo'
            ) {
                if (!(con[i] && con[i].field1 && free >= con[i].field1)) {
                    validity = false;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'ltEqualTo'
            ) {
                if (!(con[i] && con[i].field1 && free <= con[i].field1)) {
                    validity = false;
                }
            }
        } else if (con[i] && con[i].responseType === 'temperature') {
            if (con[i] && con[i].filter && con[i].filter === 'greaterThan') {
                if (
                    !(
                        con[i] &&
                        con[i].field1 &&
                        payload.mainTemp &&
                        payload.mainTemp > con[i].field1
                    )
                ) {
                    validity = false;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'lessThan'
            ) {
                if (
                    !(
                        con[i] &&
                        con[i].field1 &&
                        payload.mainTemp &&
                        payload.mainTemp < con[i].field1
                    )
                ) {
                    validity = false;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'inBetween'
            ) {
                if (
                    !(
                        con[i] &&
                        con[i].field1 &&
                        payload.mainTemp &&
                        con[i].field2 &&
                        payload.mainTemp > con[i].field1 &&
                        payload.mainTemp < con[i].field2
                    )
                ) {
                    validity = false;
                }
            } else if (con[i] && con[i].filter && con[i].filter === 'equalTo') {
                if (
                    !(
                        con[i] &&
                        con[i].field1 &&
                        payload.mainTemp &&
                        payload.mainTemp == con[i].field1
                    )
                ) {
                    validity = false;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'notEqualTo'
            ) {
                if (
                    !(
                        con[i] &&
                        con[i].field1 &&
                        payload.mainTemp &&
                        payload.mainTemp != con[i].field1
                    )
                ) {
                    validity = false;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'gtEqualTo'
            ) {
                if (
                    !(
                        con[i] &&
                        con[i].field1 &&
                        payload.mainTemp &&
                        payload.mainTemp >= con[i].field1
                    )
                ) {
                    validity = false;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'ltEqualTo'
            ) {
                if (
                    !(
                        con[i] &&
                        con[i].field1 &&
                        payload.mainTemp &&
                        payload.mainTemp <= con[i].field1
                    )
                ) {
                    validity = false;
                }
            }
        } else if (con[i] && con[i].responseType === 'responseBody') {
            if (con[i] && con[i].filter && con[i].filter === 'contains') {
                if (!(con[i] && con[i].field1 && body && body[con[i].field1])) {
                    validity = false;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'doesNotContain'
            ) {
                if (
                    !(con[i] && con[i].field1 && body && !body[con[i].field1])
                ) {
                    validity = false;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'jsExpression'
            ) {
                if (
                    !(
                        con[i] &&
                        con[i].field1 &&
                        body &&
                        body[con[i].field1] === con[i].field1
                    )
                ) {
                    validity = false;
                }
            } else if (con[i] && con[i].filter && con[i].filter === 'empty') {
                if (!(con[i] && con[i].filter && body && _.isEmpty(body))) {
                    validity = false;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'notEmpty'
            ) {
                if (!(con[i] && con[i].filter && body && !_.isEmpty(body))) {
                    validity = false;
                }
            }
        }
        if (
            con[i] &&
            con[i].collection &&
            con[i].collection.and &&
            con[i].collection.and.length
        ) {
            const temp = await checkAnd(
                payload,
                con[i].collection.and,
                statusCode,
                body
            );
            if (!temp) {
                validity = temp;
            }
        } else if (
            con[i] &&
            con[i].collection &&
            con[i].collection.or &&
            con[i].collection.or.length
        ) {
            const temp1 = await checkOr(
                payload,
                con[i].collection.or,
                statusCode,
                body
            );
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
                if (
                    con[i] &&
                    con[i].field1 &&
                    payload &&
                    payload > con[i].field1
                ) {
                    validity = true;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'lessThan'
            ) {
                if (
                    con[i] &&
                    con[i].field1 &&
                    payload &&
                    payload < con[i].field1
                ) {
                    validity = true;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'inBetween'
            ) {
                if (
                    con[i] &&
                    con[i].field1 &&
                    payload &&
                    con[i].field2 &&
                    payload > con[i].field1 &&
                    payload < con[i].field2
                ) {
                    validity = true;
                }
            } else if (con[i] && con[i].filter && con[i].filter === 'equalTo') {
                if (
                    con[i] &&
                    con[i].field1 &&
                    payload &&
                    payload == con[i].field1
                ) {
                    validity = true;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'notEqualTo'
            ) {
                if (
                    con[i] &&
                    con[i].field1 &&
                    payload &&
                    payload != con[i].field1
                ) {
                    validity = true;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'gtEqualTo'
            ) {
                if (
                    con[i] &&
                    con[i].field1 &&
                    payload &&
                    payload >= con[i].field1
                ) {
                    validity = true;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'ltEqualTo'
            ) {
                if (
                    con[i] &&
                    con[i].field1 &&
                    payload &&
                    payload <= con[i].field1
                ) {
                    validity = true;
                }
            }
        } else if (con[i] && con[i].responseType === 'doesRespond') {
            if (con[i] && con[i].filter && con[i].filter === 'isUp') {
                if (con[i] && con[i].filter && payload) {
                    validity = true;
                }
            } else if (con[i] && con[i].filter && con[i].filter === 'isDown') {
                if (con[i] && con[i].filter && !payload) {
                    validity = true;
                }
            }
        } else if (con[i] && con[i].responseType === 'statusCode') {
            if (con[i] && con[i].filter && con[i].filter === 'greaterThan') {
                if (
                    con[i] &&
                    con[i].field1 &&
                    statusCode &&
                    statusCode > con[i].field1
                ) {
                    validity = true;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'lessThan'
            ) {
                if (
                    con[i] &&
                    con[i].field1 &&
                    statusCode &&
                    statusCode < con[i].field1
                ) {
                    validity = true;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'inBetween'
            ) {
                if (
                    con[i] &&
                    con[i].field1 &&
                    statusCode &&
                    con[i].field2 &&
                    statusCode > con[i].field1 &&
                    statusCode < con[i].field2
                ) {
                    validity = true;
                }
            } else if (con[i] && con[i].filter && con[i].filter === 'equalTo') {
                if (
                    con[i] &&
                    con[i].field1 &&
                    statusCode &&
                    statusCode == con[i].field1
                ) {
                    validity = true;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'notEqualTo'
            ) {
                if (
                    con[i] &&
                    con[i].field1 &&
                    statusCode &&
                    statusCode != con[i].field1
                ) {
                    validity = true;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'gtEqualTo'
            ) {
                if (
                    con[i] &&
                    con[i].field1 &&
                    statusCode &&
                    statusCode >= con[i].field1
                ) {
                    validity = true;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'ltEqualTo'
            ) {
                if (
                    con[i] &&
                    con[i].field1 &&
                    statusCode &&
                    statusCode <= con[i].field1
                ) {
                    validity = true;
                }
            }
        } else if (con[i] && con[i].responseType === 'cpuLoad') {
            if (con[i] && con[i].filter && con[i].filter === 'greaterThan') {
                if (
                    con[i] &&
                    con[i].field1 &&
                    payload.cpuLoad &&
                    payload.cpuLoad > con[i].field1
                ) {
                    validity = true;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'lessThan'
            ) {
                if (
                    con[i] &&
                    con[i].field1 &&
                    payload.cpuLoad &&
                    payload.cpuLoad < con[i].field1
                ) {
                    validity = true;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'inBetween'
            ) {
                if (
                    con[i] &&
                    con[i].field1 &&
                    payload.cpuLoad &&
                    con[i].field2 &&
                    payload.cpuLoad > con[i].field1 &&
                    payload.cpuLoad < con[i].field2
                ) {
                    validity = true;
                }
            } else if (con[i] && con[i].filter && con[i].filter === 'equalTo') {
                if (
                    con[i] &&
                    con[i].field1 &&
                    payload.cpuLoad &&
                    payload.cpuLoad == con[i].field1
                ) {
                    validity = true;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'notEqualTo'
            ) {
                if (
                    con[i] &&
                    con[i].field1 &&
                    payload.cpuLoad &&
                    payload.cpuLoad != con[i].field1
                ) {
                    validity = true;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'gtEqualTo'
            ) {
                if (
                    con[i] &&
                    con[i].field1 &&
                    payload.cpuLoad &&
                    payload.cpuLoad >= con[i].field1
                ) {
                    validity = true;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'ltEqualTo'
            ) {
                if (
                    con[i] &&
                    con[i].field1 &&
                    payload.cpuLoad &&
                    payload.cpuLoad <= con[i].field1
                ) {
                    validity = true;
                }
            }
        } else if (con[i] && con[i].responseType === 'memoryUsage') {
            if (con[i] && con[i].filter && con[i].filter === 'greaterThan') {
                if (
                    con[i] &&
                    con[i].field1 &&
                    payload.memoryUsed &&
                    payload.memoryUsed > con[i].field1
                ) {
                    validity = true;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'lessThan'
            ) {
                if (
                    con[i] &&
                    con[i].field1 &&
                    payload.memoryUsed &&
                    payload.memoryUsed < con[i].field1
                ) {
                    validity = true;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'inBetween'
            ) {
                if (
                    con[i] &&
                    con[i].field1 &&
                    payload.memoryUsed &&
                    con[i].field2 &&
                    payload.memoryUsed > con[i].field1 &&
                    payload.memoryUsed < con[i].field2
                ) {
                    validity = true;
                }
            } else if (con[i] && con[i].filter && con[i].filter === 'equalTo') {
                if (
                    con[i] &&
                    con[i].field1 &&
                    payload.memoryUsed &&
                    payload.memoryUsed == con[i].field1
                ) {
                    validity = true;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'notEqualTo'
            ) {
                if (
                    con[i] &&
                    con[i].field1 &&
                    payload.memoryUsed &&
                    payload.memoryUsed != con[i].field1
                ) {
                    validity = true;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'gtEqualTo'
            ) {
                if (
                    con[i] &&
                    con[i].field1 &&
                    payload.memoryUsed &&
                    payload.memoryUsed >= con[i].field1
                ) {
                    validity = true;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'ltEqualTo'
            ) {
                if (
                    con[i] &&
                    con[i].field1 &&
                    payload.memoryUsed &&
                    payload.memoryUsed <= con[i].field1
                ) {
                    validity = true;
                }
            }
        } else if (con[i] && con[i].responseType === 'storageUsage') {
            const size = parseInt(payload.totalStorage || 0);
            const used = parseInt(payload.storageUsed || 0);
            const free = (size - used) / Math.pow(1e3, 3);
            if (con[i] && con[i].filter && con[i].filter === 'greaterThan') {
                if (con[i] && con[i].field1 && free > con[i].field1) {
                    validity = true;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'lessThan'
            ) {
                if (con[i] && con[i].field1 && free < con[i].field1) {
                    validity = true;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'inBetween'
            ) {
                if (
                    con[i] &&
                    con[i].field1 &&
                    con[i].field2 &&
                    free > con[i].field1 &&
                    free < con[i].field2
                ) {
                    validity = true;
                }
            } else if (con[i] && con[i].filter && con[i].filter === 'equalTo') {
                if (con[i] && con[i].field1 && free === con[i].field1) {
                    validity = true;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'notEqualTo'
            ) {
                if (con[i] && con[i].field1 && free !== con[i].field1) {
                    validity = true;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'gtEqualTo'
            ) {
                if (con[i] && con[i].field1 && free >= con[i].field1) {
                    validity = true;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'ltEqualTo'
            ) {
                if (con[i] && con[i].field1 && free <= con[i].field1) {
                    validity = true;
                }
            }
        } else if (con[i] && con[i].responseType === 'temperature') {
            if (con[i] && con[i].filter && con[i].filter === 'greaterThan') {
                if (
                    con[i] &&
                    con[i].field1 &&
                    payload.mainTemp &&
                    payload.mainTemp > con[i].field1
                ) {
                    validity = true;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'lessThan'
            ) {
                if (
                    con[i] &&
                    con[i].field1 &&
                    payload.mainTemp &&
                    payload.mainTemp < con[i].field1
                ) {
                    validity = true;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'inBetween'
            ) {
                if (
                    con[i] &&
                    con[i].field1 &&
                    payload.mainTemp &&
                    con[i].field2 &&
                    payload.mainTemp > con[i].field1 &&
                    payload.mainTemp < con[i].field2
                ) {
                    validity = true;
                }
            } else if (con[i] && con[i].filter && con[i].filter === 'equalTo') {
                if (
                    con[i] &&
                    con[i].field1 &&
                    payload.mainTemp &&
                    payload.mainTemp == con[i].field1
                ) {
                    validity = true;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'notEqualTo'
            ) {
                if (
                    con[i] &&
                    con[i].field1 &&
                    payload.mainTemp &&
                    payload.mainTemp != con[i].field1
                ) {
                    validity = true;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'gtEqualTo'
            ) {
                if (
                    con[i] &&
                    con[i].field1 &&
                    payload.mainTemp &&
                    payload.mainTemp >= con[i].field1
                ) {
                    validity = true;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'ltEqualTo'
            ) {
                if (
                    con[i] &&
                    con[i].field1 &&
                    payload.mainTemp &&
                    payload.mainTemp <= con[i].field1
                ) {
                    validity = true;
                }
            }
        } else if (con[i] && con[i].responseType === 'responseBody') {
            if (con[i] && con[i].filter && con[i].filter === 'contains') {
                if (con[i] && con[i].field1 && body && body[con[i].field1]) {
                    validity = true;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'doesNotContain'
            ) {
                if (con[i] && con[i].field1 && body && !body[con[i].field1]) {
                    validity = true;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'jsExpression'
            ) {
                if (
                    con[i] &&
                    con[i].field1 &&
                    body &&
                    body[con[i].field1] === con[i].field1
                ) {
                    validity = true;
                }
            } else if (con[i] && con[i].filter && con[i].filter === 'empty') {
                if (con[i] && con[i].filter && body && _.isEmpty(body)) {
                    validity = true;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'notEmpty'
            ) {
                if (con[i] && con[i].filter && body && !_.isEmpty(body)) {
                    validity = true;
                }
            }
        }
        if (
            con[i] &&
            con[i].collection &&
            con[i].collection.and &&
            con[i].collection.and.length
        ) {
            const temp = await checkAnd(
                payload,
                con[i].collection.and,
                statusCode,
                body
            );
            if (temp) {
                validity = temp;
            }
        } else if (
            con[i] &&
            con[i].collection &&
            con[i].collection.or &&
            con[i].collection.or.length
        ) {
            const temp1 = await checkOr(
                payload,
                con[i].collection.or,
                statusCode,
                body
            );
            if (temp1) {
                validity = temp1;
            }
        }
    }
    return validity;
};

const ProbeModel = require('../models/probe');
const RealTimeService = require('./realTimeService');
const ErrorService = require('./errorService');
const uuidv1 = require('uuid/v1');
const MonitorService = require('./monitorService');
const MonitorStatusService = require('./monitorStatusService');
const MonitorLogService = require('./monitorLogService');
const IncidentService = require('./incidentService');
const IncidentTimelineService = require('./incidentTimelineService');
