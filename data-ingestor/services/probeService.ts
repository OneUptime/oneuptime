export default {
    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'data' implicitly has an 'any' type.
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
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'code' does not exist on type 'Error'.
                error.code = 400;
                ErrorService.log('probe.create', error);
                throw error;
            } else {
                const probe = {};
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'probeKey' does not exist on type '{}'.
                probe.probeKey = probeKey;
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'probeName' does not exist on type '{}'.
                probe.probeName = data.probeName;
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'version' does not exist on type '{}'.
                probe.version = data.probeVersion;

                const now = new Date(moment().format());
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'createdAt' does not exist on type '{}'.
                probe.createdAt = now;
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'lastAlive' does not exist on type '{}'.
                probe.lastAlive = now;
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'deleted' does not exist on type '{}'.
                probe.deleted = false;

                const result = await probeCollection.insertOne(probe);
                const savedProbe = await _this.findOneBy({
                    // @ts-expect-error ts-migrate(2348) FIXME: Value of type 'typeof ObjectId' is not callable. D... Remove this comment to see the full error message
                    _id: ObjectId(result.insertedId),
                });
                return savedProbe;
            }
        } catch (error) {
            ErrorService.log('ProbeService.create', error);
            throw error;
        }
    },

    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'query' implicitly has an 'any' type.
    findOneBy: async function(query) {
        try {
            if (!query) {
                query = {};
            }

            if (!query.deleted)
                query.$or = [
                    { deleted: false },
                    { deleted: { $exists: false } },
                ];

            const probe = await probeCollection.findOne(query);
            return probe;
        } catch (error) {
            ErrorService.log('ProbeService.findOneBy', error);
            throw error;
        }
    },

    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'query' implicitly has an 'any' type.
    updateOneBy: async function(query, data) {
        try {
            if (!query) {
                query = {};
            }

            if (!query.deleted)
                query.$or = [
                    { deleted: false },
                    { deleted: { $exists: false } },
                ];

            await probeCollection.updateOne(query, { $set: data });
            const probe = await this.findOneBy(query);
            return probe;
        } catch (error) {
            ErrorService.log('ProbeService.updateOneBy', error);
            throw error;
        }
    },

    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'data' implicitly has an 'any' type.
    saveLighthouseLog: async function(data) {
        try {
            const log = await LighthouseLogService.create(data);
            return log;
        } catch (error) {
            ErrorService.log('ProbeService.saveLighthouseScan', error);
            throw error;
        }
    },

    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'data' implicitly has an 'any' type.
    createMonitorDisabledStatus: async function(data) {
        try {
            let monitorStatus = await MonitorStatusService.findBy({
                query: {
                    monitorId: data.monitorId,
                },
                limit: 1, // only get one item, which is the latest item
            });
            monitorStatus = monitorStatus[0];

            const lastStatus =
                monitorStatus && monitorStatus.status
                    ? monitorStatus.status
                    : null;

            if (!lastStatus || (lastStatus && lastStatus !== data.status)) {
                data.lastStatus = lastStatus ? lastStatus : null;
                monitorStatus = await MonitorStatusService.create({
                    ...data,
                    deleted: false,
                });
            }
            return monitorStatus;
        } catch (error) {
            ErrorService.log('ProbeService.createMonitorDisabledStatus', error);
            throw error;
        }
    },

    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'data' implicitly has an 'any' type.
    saveMonitorLog: async function(data) {
        try {
            const _this = this;

            let monitorStatus = await MonitorStatusService.findBy({
                query: {
                    monitorId: data.monitorId,
                    probeId: data.probeId,
                },
                limit: 1, // only get one item, which is the latest item
            });
            monitorStatus = monitorStatus[0];

            const lastStatus =
                monitorStatus && monitorStatus.status
                    ? monitorStatus.status
                    : null;

            let log = await MonitorLogService.create(data);

            if (!data.stopPingTimeUpdate) {
                await MonitorService.updateMonitorPingTime(data.monitorId);
            }

            // grab all the criteria in a monitor
            // @ts-expect-error ts-migrate(7034) FIXME: Variable 'allCriteria' implicitly has type 'any[]'... Remove this comment to see the full error message
            const allCriteria = [];
            if (data.matchedUpCriterion) {
                // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'criteria' implicitly has an 'any' type.
                data.matchedUpCriterion.forEach(criteria =>
                    allCriteria.push(criteria)
                );
            }
            if (data.matchedDownCriterion) {
                // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'criteria' implicitly has an 'any' type.
                data.matchedDownCriterion.forEach(criteria =>
                    allCriteria.push(criteria)
                );
            }
            if (data.matchedDegradedCriterion) {
                // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'criteria' implicitly has an 'any' type.
                data.matchedDegradedCriterion.forEach(criteria =>
                    allCriteria.push(criteria)
                );
            }

            if (!lastStatus || (lastStatus && lastStatus !== data.status)) {
                // check if monitor has a previous status
                // check if previous status is different from the current status
                // if different, resolve last incident, create a new incident and monitor status
                if (lastStatus) {
                    // check 3 times just to make sure
                    if (
                        typeof data.retry === 'boolean' &&
                        data.retryCount >= 0 &&
                        data.retryCount < 3
                    )
                        return { retry: true, retryCount: data.retryCount };

                    // @ts-expect-error ts-migrate(7005) FIXME: Variable 'allCriteria' implicitly has an 'any[]' t... Remove this comment to see the full error message
                    await _this.incidentResolveOrAcknowledge(data, allCriteria);
                }

                const incidentIdsOrRetry = await _this.incidentCreateOrUpdate(
                    data
                );
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'retry' does not exist on type 'any[] | {... Remove this comment to see the full error message
                if (incidentIdsOrRetry.retry) return incidentIdsOrRetry;

                if (
                    Array.isArray(incidentIdsOrRetry) &&
                    incidentIdsOrRetry.length
                ) {
                    data.incidentId = incidentIdsOrRetry[0];
                }

                await MonitorStatusService.create({ ...data, deleted: false });

                // @ts-expect-error ts-migrate(2339) FIXME: Property 'length' does not exist on type 'any[] | ... Remove this comment to see the full error message
                if (incidentIdsOrRetry && incidentIdsOrRetry.length) {
                    log = await MonitorLogService.updateOneBy(
                        // @ts-expect-error ts-migrate(2348) FIXME: Value of type 'typeof ObjectId' is not callable. D... Remove this comment to see the full error message
                        { _id: ObjectId(log._id) },
                        { incidentIds: incidentIdsOrRetry }
                    );
                }
            } else {
                // should make sure all unresolved incidents for the monitor is resolved
                if (data.status === 'online') {
                    // @ts-expect-error ts-migrate(7005) FIXME: Variable 'allCriteria' implicitly has an 'any[]' t... Remove this comment to see the full error message
                    await _this.incidentResolveOrAcknowledge(data, allCriteria);
                }

                const incidents = await IncidentService.findBy({
                    query: {
                        // @ts-expect-error ts-migrate(2348) FIXME: Value of type 'typeof ObjectId' is not callable. D... Remove this comment to see the full error message
                        'monitors.monitorId': ObjectId(data.monitorId),
                        incidentType: data.status,
                        resolved: false,
                    },
                });

                // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'incident' implicitly has an 'any' type.
                const incidentIds = incidents.map(incident => incident._id);

                if (incidentIds && incidentIds.length) {
                    log = await MonitorLogService.updateOneBy(
                        // @ts-expect-error ts-migrate(2348) FIXME: Value of type 'typeof ObjectId' is not callable. D... Remove this comment to see the full error message
                        { _id: ObjectId(log._id) },
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

    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'data' implicitly has an 'any' type.
    getMonitorLog: async function(data) {
        try {
            const date = new Date(moment().format());
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

    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'data' implicitly has an 'any' type.
    incidentCreateOrUpdate: async function(data) {
        try {
            const [monitor, incidents] = await Promise.all([
                MonitorService.findOneBy({
                    // @ts-expect-error ts-migrate(2348) FIXME: Value of type 'typeof ObjectId' is not callable. D... Remove this comment to see the full error message
                    query: { _id: ObjectId(data.monitorId) },
                }),
                IncidentService.findBy({
                    query: {
                        // @ts-expect-error ts-migrate(2348) FIXME: Value of type 'typeof ObjectId' is not callable. D... Remove this comment to see the full error message
                        'monitors.monitorId': ObjectId(data.monitorId),
                        incidentType: data.status,
                        resolved: false,
                        manuallyCreated: false,
                    },
                }),
            ]);
            const { matchedCriterion } = data;
            let incidentIds = [];
            let scripts = [];

            if (
                matchedCriterion &&
                matchedCriterion.scripts &&
                matchedCriterion.scripts.length > 0
            ) {
                // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'script' implicitly has an 'any' type.
                scripts = matchedCriterion.scripts.map(script => {
                    return {
                        automatedScript: script.scriptId,
                    };
                });
            }

            if (
                data.status === 'online' &&
                monitor &&
                matchedCriterion &&
                matchedCriterion.createAlert
            ) {
                if (incidents && incidents.length) {
                    const internalIncidents = [];
                    for (let incident of incidents) {
                        if (monitor.type !== 'incomingHttpRequest') {
                            const initialProbes = incident.probes.map(
                                // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'probe' implicitly has an 'any' type.
                                probe => ({
                                    probeId: probe.probeId._id || probe.probeId,
                                    updatedAt: probe.updatedAt,
                                    status: probe.status,
                                    reportedStatus: probe.reportedStatus,
                                })
                            );
                            incident = await IncidentService.updateOneBy(
                                {
                                    // @ts-expect-error ts-migrate(2348) FIXME: Value of type 'typeof ObjectId' is not callable. D... Remove this comment to see the full error message
                                    _id: ObjectId(incident._id),
                                },
                                {
                                    probes: [
                                        ...initialProbes,
                                        {
                                            probeId: data.probeId,
                                            updatedAt: new Date(
                                                moment().format()
                                            ),
                                            status: true,
                                            reportedStatus: data.status,
                                        },
                                    ],
                                }
                            );
                        }

                        await IncidentTimelineService.create({
                            incidentId: incident._id,
                            probeId: data.probeId,
                            status: data.status,
                        });

                        incident && internalIncidents.push(incident);
                    }

                    incidentIds = internalIncidents;
                } else {
                    if (
                        typeof data.retry === 'boolean' &&
                        data.retryCount >= 0 &&
                        data.retryCount < 3
                    )
                        return { retry: true, retryCount: data.retryCount };

                    const response = await postApi(
                        'api/incident/data-ingestor/create-incident',
                        {
                            projectId: monitor.projectId,
                            monitors: [data.monitorId],
                            createdById: null,
                            incidentType: 'online',
                            probeId: data.probeId,
                            reason: data.reason,
                            response: data.response,
                            ...(matchedCriterion && {
                                matchedCriterion,
                            }),
                        }
                    );
                    const incident = response;

                    AutomatedScriptService.runResource({
                        triggeredId: incident._id,
                        triggeredBy: 'incident',
                        resources: scripts,
                    });

                    if (incident) {
                        incidentIds = [incident];
                    }
                }
            } else if (
                data.status === 'degraded' &&
                monitor &&
                matchedCriterion &&
                matchedCriterion.createAlert
            ) {
                if (incidents && incidents.length) {
                    const internalIncidents = [];
                    for (let incident of incidents) {
                        if (monitor.type !== 'incomingHttpRequest') {
                            const initialProbes = incident.probes.map(
                                // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'probe' implicitly has an 'any' type.
                                probe => ({
                                    probeId: probe.probeId._id || probe.probeId,
                                    updatedAt: probe.updatedAt,
                                    status: probe.status,
                                    reportedStatus: probe.reportedStatus,
                                })
                            );
                            incident = await IncidentService.updateOneBy(
                                {
                                    // @ts-expect-error ts-migrate(2348) FIXME: Value of type 'typeof ObjectId' is not callable. D... Remove this comment to see the full error message
                                    _id: ObjectId(incident._id),
                                },
                                {
                                    probes: [
                                        ...initialProbes,
                                        {
                                            probeId: data.probeId,
                                            updatedAt: new Date(
                                                moment().format()
                                            ),
                                            status: true,
                                            reportedStatus: data.status,
                                        },
                                    ],
                                }
                            );
                        }

                        await IncidentTimelineService.create({
                            incidentId: incident._id.toString(),
                            probeId: data.probeId,
                            status: data.status,
                        });

                        incident && internalIncidents.push(incident);
                    }
                    incidentIds = internalIncidents;
                } else {
                    if (
                        typeof data.retry === 'boolean' &&
                        data.retryCount >= 0 &&
                        data.retryCount < 3
                    )
                        return { retry: true, retryCount: data.retryCount };

                    const response = await postApi(
                        'api/incident/data-ingestor/create-incident',
                        {
                            projectId: monitor.projectId,
                            monitors: [data.monitorId],
                            createdById: null,
                            incidentType: 'degraded',
                            probeId: data.probeId,
                            reason: data.reason,
                            response: data.response,
                            ...(matchedCriterion && {
                                matchedCriterion,
                            }),
                        }
                    );
                    const incident = response;

                    AutomatedScriptService.runResource({
                        triggeredId: incident._id,
                        triggeredBy: 'incident',
                        resources: scripts,
                    });

                    if (incident) {
                        incidentIds = [incident];
                    }
                }
            } else if (
                data.status === 'offline' &&
                monitor &&
                matchedCriterion &&
                matchedCriterion.createAlert
            ) {
                if (incidents && incidents.length) {
                    const internalIncidents = [];
                    for (let incident of incidents) {
                        if (monitor.type !== 'incomingHttpRequest') {
                            const initialProbes = incident.probes.map(
                                // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'probe' implicitly has an 'any' type.
                                probe => ({
                                    probeId: probe.probeId._id || probe.probeId,
                                    updatedAt: probe.updatedAt,
                                    status: probe.status,
                                    reportedStatus: probe.reportedStatus,
                                })
                            );
                            incident = await IncidentService.updateOneBy(
                                {
                                    // @ts-expect-error ts-migrate(2348) FIXME: Value of type 'typeof ObjectId' is not callable. D... Remove this comment to see the full error message
                                    _id: ObjectId(incident._id),
                                },
                                {
                                    probes: [
                                        ...initialProbes,
                                        {
                                            probeId: data.probeId,
                                            updatedAt: new Date(
                                                moment().format()
                                            ),
                                            status: true,
                                            reportedStatus: data.status,
                                        },
                                    ],
                                }
                            );
                        }

                        await IncidentTimelineService.create({
                            incidentId: incident._id.toString(),
                            probeId: data.probeId,
                            status: data.status,
                        });

                        incident && internalIncidents.push(incident);
                    }
                    incidentIds = internalIncidents;
                } else {
                    if (
                        typeof data.retry === 'boolean' &&
                        data.retryCount >= 0 &&
                        data.retryCount < 3
                    )
                        return { retry: true, retryCount: data.retryCount };

                    const response = await postApi(
                        'api/incident/data-ingestor/create-incident',
                        {
                            projectId: monitor.projectId,
                            monitors: [data.monitorId],
                            createdById: null,
                            incidentType: 'offline',
                            probeId: data.probeId,
                            reason: data.reason,
                            response: data.response,
                            ...(matchedCriterion && {
                                matchedCriterion,
                            }),
                        }
                    );
                    const incident = response;

                    AutomatedScriptService.runResource({
                        triggeredId: incident._id,
                        triggeredBy: 'incident',
                        resources: scripts,
                    });

                    if (incident) {
                        incidentIds = [incident];
                    }
                }
            }

            incidentIds = incidentIds.map(i => i._id);
            return incidentIds;
        } catch (error) {
            ErrorService.log('ProbeService.incidentCreateOrUpdate', error);
            throw error;
        }
    },

    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'data' implicitly has an 'any' type.
    incidentResolveOrAcknowledge: async function(data, allCriteria) {
        try {
            const [incidents, monitor] = await Promise.all([
                IncidentService.findBy({
                    query: {
                        // @ts-expect-error ts-migrate(2348) FIXME: Value of type 'typeof ObjectId' is not callable. D... Remove this comment to see the full error message
                        'monitors.monitorId': ObjectId(data.monitorId),
                        resolved: false,
                        manuallyCreated: false,
                    },
                }),
                MonitorService.findOneBy({
                    // @ts-expect-error ts-migrate(2348) FIXME: Value of type 'typeof ObjectId' is not callable. D... Remove this comment to see the full error message
                    query: { _id: ObjectId(data.monitorId) },
                }),
            ]);

            // should grab all the criterion for the monitor and put them into one array
            // check the id of each criteria against the id of criteria attached to an incident
            // ack / resolve according to the criteria

            // @ts-expect-error ts-migrate(7034) FIXME: Variable 'autoAcknowledge' implicitly has type 'an... Remove this comment to see the full error message
            let autoAcknowledge, autoResolve;
            if (incidents && incidents.length > 0) {
                // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'incident' implicitly has an 'any' type.
                incidents.forEach(incident => {
                    // @ts-expect-error ts-migrate(7034) FIXME: Variable 'criteriaId' implicitly has type 'any' in... Remove this comment to see the full error message
                    let criteriaId = null;
                    if (
                        incident &&
                        incident.criterionCause &&
                        incident.criterionCause._id
                    )
                        criteriaId = String(incident.criterionCause._id);
                    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'criteria' implicitly has an 'any' type.
                    allCriteria.forEach(criteria => {
                        if (
                            // @ts-expect-error ts-migrate(7005) FIXME: Variable 'criteriaId' implicitly has an 'any' type... Remove this comment to see the full error message
                            String(criteria?._id) === criteriaId ||
                            criteria?.name === incident?.criterionCause?.name
                        ) {
                            autoAcknowledge = criteria?.autoAcknowledge;
                            autoResolve = criteria?.autoResolve;
                        }
                    });
                });
            }
            // @ts-expect-error ts-migrate(7034) FIXME: Variable 'incidentsV1' implicitly has type 'any[]'... Remove this comment to see the full error message
            const incidentsV1 = [];
            const incidentsV2 = [];

            if (incidents && incidents.length) {
                // is this check needed at all??
                // if (lastStatus && lastStatus !== data.status) {
                // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'incident' implicitly has an 'any' type.
                incidents.forEach(incident => {
                    if (
                        incident.probes &&
                        incident.probes.length > 0 &&
                        monitor.type !== 'incomingHttpRequest'
                    ) {
                        // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'probe' implicitly has an 'any' type.
                        incident.probes.some(probe => {
                            if (
                                probe.probeId &&
                                String(probe.probeId._id || probe.probeId) ===
                                    String(data.probeId)
                            ) {
                                incidentsV1.push(incident);
                                return true;
                            } else return false;
                        });
                    } else {
                        incidentsV1.push(incident);
                        return true;
                    }
                });
                // }
            }
            // @ts-expect-error ts-migrate(7005) FIXME: Variable 'incidentsV1' implicitly has an 'any[]' t... Remove this comment to see the full error message
            for (const incident of incidentsV1) {
                if (
                    incident.probes &&
                    incident.probes.length > 0 &&
                    monitor.type !== 'incomingHttpRequest'
                ) {
                    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'probe' implicitly has an 'any' type.
                    const initialProbes = incident.probes.map(probe => ({
                        probeId: probe.probeId._id || probe.probeId,
                        updatedAt: probe.updatedAt,
                        status: probe.status,
                        reportedStatus: probe.reportedStatus,
                    }));
                    const [newIncident] = await Promise.all([
                        IncidentService.updateOneBy(
                            {
                                // @ts-expect-error ts-migrate(2348) FIXME: Value of type 'typeof ObjectId' is not callable. D... Remove this comment to see the full error message
                                _id: ObjectId(incident._id),
                            },
                            {
                                probes: [
                                    ...initialProbes,
                                    {
                                        probeId: data.probeId,
                                        updatedAt: new Date(moment().format()),
                                        status: false,
                                        reportedStatus: data.status,
                                    },
                                ],
                            }
                        ),
                        IncidentTimelineService.create({
                            incidentId: incident._id.toString(),
                            probeId: data.probeId,
                            status: data.status,
                        }),
                    ]);

                    incidentsV2.push(newIncident);
                } else {
                    incidentsV2.push(incident);
                }
            }

            await forEach(incidentsV2, async incident => {
                const trueArray = [];
                const falseArray = [];
                // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'probe' implicitly has an 'any' type.
                incident.probes.forEach(probe => {
                    if (probe.status) {
                        trueArray.push(probe);
                    } else {
                        falseArray.push(probe);
                    }
                });

                if (
                    trueArray.length === falseArray.length ||
                    monitor.type === 'incomingHttpRequest'
                ) {
                    // @ts-expect-error ts-migrate(7005) FIXME: Variable 'autoAcknowledge' implicitly has an 'any'... Remove this comment to see the full error message
                    if (autoAcknowledge) {
                        if (!incident.acknowledged) {
                            await postApi(
                                'api/incident/data-ingestor/acknowledge-incident',
                                {
                                    incidentId: incident._id.toString(),
                                    name: 'oneuptime',
                                    probeId: data.probeId,
                                }
                            );
                        }
                    }
                    // @ts-expect-error ts-migrate(7005) FIXME: Variable 'autoResolve' implicitly has an 'any' typ... Remove this comment to see the full error message
                    if (autoResolve) {
                        await postApi(
                            'api/incident/data-ingestor/resolve-incident',
                            {
                                incidentId: incident._id.toString(),
                                name: 'oneuptime',
                                probeId: data.probeId,
                            }
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

    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'probeId' implicitly has an 'any' type.
    updateProbeStatus: async function(probeId) {
        try {
            const now = new Date(moment().format());
            await probeCollection.updateOne(
                {
                    // @ts-expect-error ts-migrate(2348) FIXME: Value of type 'typeof ObjectId' is not callable. D... Remove this comment to see the full error message
                    _id: ObjectId(probeId),
                    $or: [{ deleted: false }, { deleted: { $exists: false } }],
                },
                { $set: { lastAlive: now } }
            );
            const probe = await this.findOneBy({
                // @ts-expect-error ts-migrate(2348) FIXME: Value of type 'typeof ObjectId' is not callable. D... Remove this comment to see the full error message
                _id: ObjectId(probeId),
            });

            // realtime update for probe
            postApi(
                `${realtimeBaseUrl}/update-probe`,
                { data: probe },
                true
                // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'error' implicitly has an 'any' type.
            ).catch(error => {
                ErrorService.log('probeService.updateProbeStatus', error);
            });
            return probe;
        } catch (error) {
            ErrorService.log('probeService.updateProbeStatus', error);
            throw error;
        }
    },

    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'resp' implicitly has an 'any' type.
    scriptConditions: (resp, con) => {
        const body = resp ?? null;
        // @ts-expect-error ts-migrate(7034) FIXME: Variable 'successReasons' implicitly has type 'any... Remove this comment to see the full error message
        const successReasons = [];
        // @ts-expect-error ts-migrate(7034) FIXME: Variable 'failedReasons' implicitly has type 'any[... Remove this comment to see the full error message
        const failedReasons = [];

        let eventOccurred = false;
        let matchedCriterion;
        if (con && con.length) {
            // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'condition' implicitly has an 'any' type... Remove this comment to see the full error message
            eventOccurred = con.some(condition => {
                let stat = true;
                if (
                    condition &&
                    condition.criteria &&
                    condition.criteria.condition &&
                    condition.criteria.condition === 'and'
                ) {
                    stat = checkScriptAnd(
                        condition.criteria,
                        body,
                        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'successReasons' implicitly has an 'any[]... Remove this comment to see the full error message
                        successReasons,
                        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'failedReasons' implicitly has an 'any[]'... Remove this comment to see the full error message
                        failedReasons
                    );
                } else if (
                    condition &&
                    condition.criteria &&
                    condition.criteria.condition &&
                    condition.criteria.condition === 'or'
                ) {
                    stat = checkScriptOr(
                        condition.criteria,
                        body,
                        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'successReasons' implicitly has an 'any[]... Remove this comment to see the full error message
                        successReasons,
                        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'failedReasons' implicitly has an 'any[]'... Remove this comment to see the full error message
                        failedReasons
                    );
                }
                if (stat) {
                    matchedCriterion = condition;
                    return true;
                }

                return false;
            });
        }

        return {
            stat: eventOccurred,
            // @ts-expect-error ts-migrate(7005) FIXME: Variable 'successReasons' implicitly has an 'any[]... Remove this comment to see the full error message
            successReasons,
            // @ts-expect-error ts-migrate(7005) FIXME: Variable 'failedReasons' implicitly has an 'any[]'... Remove this comment to see the full error message
            failedReasons,
            matchedCriterion,
        };
    },

    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'monitorType' implicitly has an 'any' ty... Remove this comment to see the full error message
    conditions: (monitorType, con, payload, resp, response) => {
        const status = resp
            ? resp.status
                ? resp.status
                : resp.statusCode
                ? resp.statusCode
                : null
            : null;
        const body = resp && resp.body ? resp.body : null;
        const queryParams = resp && resp.queryParams ? resp.queryParams : null;
        const headers = resp && resp.headers ? resp.headers : null;
        const sslCertificate =
            resp && resp.sslCertificate ? resp.sslCertificate : null;
        // @ts-expect-error ts-migrate(7034) FIXME: Variable 'successReasons' implicitly has type 'any... Remove this comment to see the full error message
        const successReasons = [];
        // @ts-expect-error ts-migrate(7034) FIXME: Variable 'failedReasons' implicitly has type 'any[... Remove this comment to see the full error message
        const failedReasons = [];

        let eventOccurred = false;
        let matchedCriterion;

        if (con && con.length) {
            for (const condition of con) {
                let stat = true;
                if (
                    condition &&
                    condition.criteria &&
                    condition.criteria.condition &&
                    condition.criteria.condition === 'and'
                ) {
                    stat = checkAnd(
                        payload,
                        condition.criteria,
                        status,
                        body,
                        sslCertificate,
                        response,
                        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'successReasons' implicitly has an 'any[]... Remove this comment to see the full error message
                        successReasons,
                        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'failedReasons' implicitly has an 'any[]'... Remove this comment to see the full error message
                        failedReasons,
                        monitorType,
                        queryParams,
                        headers
                    );
                } else if (
                    condition &&
                    condition.criteria &&
                    condition.criteria.condition &&
                    condition.criteria.condition === 'or'
                ) {
                    stat = checkOr(
                        payload,
                        condition.criteria,
                        status,
                        body,
                        sslCertificate,
                        response,
                        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'successReasons' implicitly has an 'any[]... Remove this comment to see the full error message
                        successReasons,
                        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'failedReasons' implicitly has an 'any[]'... Remove this comment to see the full error message
                        failedReasons,
                        monitorType,
                        queryParams,
                        headers
                    );
                }

                eventOccurred = stat;

                if (stat) {
                    matchedCriterion = condition;
                    return {
                        stat: eventOccurred,
                        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'successReasons' implicitly has an 'any[]... Remove this comment to see the full error message
                        successReasons,
                        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'failedReasons' implicitly has an 'any[]'... Remove this comment to see the full error message
                        failedReasons,
                        matchedCriterion: condition,
                    };
                }
            }
        }
        return {
            stat: eventOccurred,
            // @ts-expect-error ts-migrate(7005) FIXME: Variable 'successReasons' implicitly has an 'any[]... Remove this comment to see the full error message
            successReasons,
            // @ts-expect-error ts-migrate(7005) FIXME: Variable 'failedReasons' implicitly has an 'any[]'... Remove this comment to see the full error message
            failedReasons,
            matchedCriterion,
        };
    },

    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'payload' implicitly has an 'any' type.
    incomingCondition: (payload, conditions) => {
        let eventOccurred = false;
        let matchedCriterion;
        if (conditions && conditions.length) {
            // @ts-expect-error ts-migrate(2322) FIXME: Type 'Promise<boolean>' is not assignable to type ... Remove this comment to see the full error message
            eventOccurred = some(conditions, condition => {
                let response = false;
                let respAnd = false,
                    respOr = false,
                    countAnd = 0,
                    countOr = 0;

                if (
                    condition &&
                    // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
                    condition.criteria &&
                    // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
                    condition.criteria.condition &&
                    // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
                    condition.criteria.condition === 'and'
                ) {
                    // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
                    respAnd = incomingCheckAnd(payload, condition.criteria);
                    countAnd++;
                }
                if (
                    condition &&
                    // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
                    condition.criteria &&
                    // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
                    condition.criteria.condition &&
                    // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
                    condition.criteria.condition === 'or'
                ) {
                    // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
                    respOr = incomingCheckOr(payload, condition.criteria);
                    countOr++;
                }
                if (countAnd > 0 && countOr > 0) {
                    if (respAnd && respOr) {
                        response = true;
                    }
                } else if (countAnd > 0 && countOr <= 0) {
                    if (respAnd) {
                        response = true;
                    }
                } else if (countOr > 0 && countAnd <= 0) {
                    if (respOr) {
                        response = true;
                    }
                }
                if (response) {
                    matchedCriterion = condition;
                    return true;
                }

                return false;
            });
        }
        return { eventOccurred, matchedCriterion };
    },

    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'monitor' implicitly has an 'any' type.
    probeHttpRequest: async function(monitor, probeId) {
        try {
            const _this = this;
            let status, reason;
            let matchedCriterion;
            const lastPingTime = monitor.lastPingTime;
            const payload = moment().diff(moment(lastPingTime), 'minutes');

            const {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'eventOccurred' does not exist on type 'f... Remove this comment to see the full error message
                eventOccurred: validUp,
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'matchedCriterion' does not exist on type... Remove this comment to see the full error message
                matchedCriterion: matchedUpCriterion,
            } =
                monitor && monitor.criteria && monitor.criteria.up
                    ? _this.incomingCondition(payload, monitor.criteria.up)
                    : false;

            const {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'eventOccurred' does not exist on type 'f... Remove this comment to see the full error message
                eventOccurred: validDegraded,
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'matchedCriterion' does not exist on type... Remove this comment to see the full error message
                matchedCriterion: matchedDegradedCriterion,
            } =
                monitor && monitor.criteria && monitor.criteria.degraded
                    ? _this.incomingCondition(
                          payload,
                          monitor.criteria.degraded
                      )
                    : false;

            const {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'eventOccurred' does not exist on type 'f... Remove this comment to see the full error message
                eventOccurred: validDown,
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'matchedCriterion' does not exist on type... Remove this comment to see the full error message
                matchedCriterion: matchedDownCriterion,
            } =
                monitor && monitor.criteria && monitor.criteria.down
                    ? _this.incomingCondition(payload, [
                          ...monitor.criteria.down.filter(
                              // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'criterion' implicitly has an 'any' type... Remove this comment to see the full error message
                              criterion => criterion.default !== true
                          ),
                      ])
                    : false;
            let timeHours = 0;
            let timeMinutes = payload;
            let tempReason = `${payload} min`;
            if (timeMinutes > 60) {
                timeHours = Math.floor(timeMinutes / 60);
                timeMinutes = Math.floor(timeMinutes % 60);
                tempReason = `${timeHours} hrs ${timeMinutes} min`;
            }

            if (validDown) {
                status = 'offline';
                reason = [`${criteriaStrings.incomingTime} ${tempReason}`];
                matchedCriterion = matchedDownCriterion;
            } else if (validDegraded) {
                status = 'degraded';
                reason = [`${criteriaStrings.incomingTime} ${tempReason}`];
                matchedCriterion = matchedDegradedCriterion;
            } else if (validUp) {
                status = 'online';
                reason = [`${criteriaStrings.incomingTime} ${tempReason}`];
                matchedCriterion = matchedUpCriterion;
            } else {
                status = 'offline';
                reason = [`${criteriaStrings.incomingTime} ${tempReason}`];
                if (monitor.criteria.down) {
                    matchedCriterion = monitor.criteria.down.find(
                        // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'criterion' implicitly has an 'any' type... Remove this comment to see the full error message
                        criterion => criterion.default === true
                    );
                }
            }
            const logData = {};
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'responseTime' does not exist on type '{}... Remove this comment to see the full error message
            logData.responseTime = 0;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'responseStatus' does not exist on type '... Remove this comment to see the full error message
            logData.responseStatus = null;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'status' does not exist on type '{}'.
            logData.status = status;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'probeId' does not exist on type '{}'.
            logData.probeId = probeId;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitorId' does not exist on type '{}'.
            logData.monitorId =
                monitor && monitor.id
                    ? monitor.id
                    : monitor._id
                    ? monitor._id
                    : null;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'sslCertificate' does not exist on type '... Remove this comment to see the full error message
            logData.sslCertificate = null;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'lighthouseScanStatus' does not exist on ... Remove this comment to see the full error message
            logData.lighthouseScanStatus = null;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'performance' does not exist on type '{}'... Remove this comment to see the full error message
            logData.performance = null;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'accessibility' does not exist on type '{... Remove this comment to see the full error message
            logData.accessibility = null;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'bestPractices' does not exist on type '{... Remove this comment to see the full error message
            logData.bestPractices = null;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'seo' does not exist on type '{}'.
            logData.seo = null;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'pwa' does not exist on type '{}'.
            logData.pwa = null;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'lighthouseData' does not exist on type '... Remove this comment to see the full error message
            logData.lighthouseData = null;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'retryCount' does not exist on type '{}'.
            logData.retryCount = 3;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'reason' does not exist on type '{}'.
            logData.reason = reason;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'response' does not exist on type '{}'.
            logData.response = null;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'stopPingTimeUpdate' does not exist on ty... Remove this comment to see the full error message
            logData.stopPingTimeUpdate = true;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'matchedCriterion' does not exist on type... Remove this comment to see the full error message
            logData.matchedCriterion = matchedCriterion;

            // update monitor to save the last matched criterion
            const [, log] = await Promise.all([
                MonitorService.updateCriterion(
                    // @ts-expect-error ts-migrate(2348) FIXME: Value of type 'typeof ObjectId' is not callable. D... Remove this comment to see the full error message
                    ObjectId(monitor._id),
                    matchedCriterion
                ),

                _this.saveMonitorLog(logData),
            ]);

            return log;
        } catch (error) {
            ErrorService.log('probeService.probeHttpRequest', error);
            throw error;
        }
    },
};

// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'loda... Remove this comment to see the full error message
import _ from 'lodash';

// @ts-expect-error ts-migrate(7006) FIXME: Parameter 'payload' implicitly has an 'any' type.
const incomingCheckAnd = (payload, condition) => {
    let validity = false;
    let val = 0;
    let incomingVal = 0;
    if (condition && condition.criteria && condition.criteria.length > 0) {
        for (let i = 0; i < condition.criteria.length; i++) {
            if (
                condition.criteria[i].criteria &&
                condition.criteria[i].criteria.length > 0
            ) {
                if (
                    condition.criteria[i].condition &&
                    condition.criteria[i].condition === 'and'
                ) {
                    // incoming check and
                    const tempAnd = incomingCheckAnd(
                        payload,
                        condition.criteria[i]
                    );
                    if (tempAnd) {
                        val++;
                        incomingVal++;
                    }
                } else if (
                    condition.criteria[i].condition &&
                    condition.criteria[i].condition === 'or'
                ) {
                    // incoming check or
                    const tempOr = incomingCheckOr(
                        payload,
                        condition.criteria[i]
                    );
                    if (tempOr) {
                        val++;
                        incomingVal++;
                    }
                }
            } else {
                if (
                    condition.criteria[i] &&
                    condition.criteria[i].responseType &&
                    condition.criteria[i].responseType === 'incomingTime'
                ) {
                    if (
                        condition.criteria[i] &&
                        condition.criteria[i].filter &&
                        condition.criteria[i].filter === 'greaterThan'
                    ) {
                        if (
                            condition.criteria[i] &&
                            condition.criteria[i].field1 &&
                            payload &&
                            payload > condition.criteria[i].field1
                        ) {
                            val++;
                        }
                    } else if (
                        condition.criteria[i] &&
                        condition.criteria[i].filter &&
                        condition.criteria[i].filter === 'lessThan'
                    ) {
                        if (
                            condition.criteria[i] &&
                            condition.criteria[i].field1 &&
                            payload &&
                            payload < condition.criteria[i].field1
                        ) {
                            val++;
                        }
                    } else if (
                        condition.criteria[i] &&
                        condition.criteria[i].filter &&
                        condition.criteria[i].filter === 'inBetween'
                    ) {
                        if (
                            condition.criteria[i] &&
                            condition.criteria[i].field1 &&
                            payload &&
                            condition.criteria[i].field2 &&
                            payload > condition.criteria[i].field1 &&
                            payload < condition.criteria[i].field2
                        ) {
                            val++;
                        }
                    } else if (
                        condition.criteria[i] &&
                        condition.criteria[i].filter &&
                        condition.criteria[i].filter === 'equalTo'
                    ) {
                        if (
                            condition.criteria[i] &&
                            condition.criteria[i].field1 &&
                            payload &&
                            payload == condition.criteria[i].field1
                        ) {
                            val++;
                        }
                    } else if (
                        condition.criteria[i] &&
                        condition.criteria[i].filter &&
                        condition.criteria[i].filter === 'notEqualTo'
                    ) {
                        if (
                            condition.criteria[i] &&
                            condition.criteria[i].field1 &&
                            payload &&
                            payload != condition.criteria[i].field1
                        ) {
                            val++;
                        }
                    } else if (
                        condition.criteria[i] &&
                        condition.criteria[i].filter &&
                        condition.criteria[i].filter === 'gtEqualTo'
                    ) {
                        if (
                            condition.criteria[i] &&
                            condition.criteria[i].field1 &&
                            payload &&
                            payload >= condition.criteria[i].field1
                        ) {
                            val++;
                        }
                    } else if (
                        condition.criteria[i] &&
                        condition.criteria[i].filter &&
                        condition.criteria[i].filter === 'ltEqualTo'
                    ) {
                        if (
                            condition.criteria[i] &&
                            condition.criteria[i].field1 &&
                            payload &&
                            payload <= condition.criteria[i].field1
                        ) {
                            val++;
                        }
                    }
                    incomingVal++;
                }
            }
        }
    }

    if (val > 0 && incomingVal > 0 && val === incomingVal) {
        validity = true;
    }

    return validity;
};

// @ts-expect-error ts-migrate(7006) FIXME: Parameter 'payload' implicitly has an 'any' type.
const incomingCheckOr = (payload, condition) => {
    let validity = false;
    let val = 0;
    let incomingVal = 0;
    if (condition && condition.criteria && condition.criteria.length > 0) {
        for (let i = 0; i < condition.criteria.length; i++) {
            if (
                condition.criteria[i].criteria &&
                condition.criteria[i].criteria.length > 0
            ) {
                if (
                    condition.criteria[i].condition &&
                    condition.criteria[i].condition === 'or'
                ) {
                    // incoming check or
                    const tempor = incomingCheckAnd(
                        payload,
                        condition.criteria[i]
                    );
                    if (tempor) {
                        val++;
                        incomingVal++;
                    }
                } else if (
                    condition.criteria[i].condition &&
                    condition.criteria[i].condition === 'and'
                ) {
                    const tempAnd = incomingCheckAnd(
                        payload,
                        condition.criteria[i]
                    );
                    if (tempAnd) {
                        val++;
                        incomingVal++;
                    }
                }
            } else {
                if (
                    condition.criteria[i] &&
                    condition.criteria[i].responseType &&
                    condition.criteria[i].responseType === 'incomingTime'
                ) {
                    if (
                        condition.criteria[i] &&
                        condition.criteria[i].filter &&
                        condition.criteria[i].filter === 'greaterThan'
                    ) {
                        if (
                            condition.criteria[i] &&
                            condition.criteria[i].field1 &&
                            payload &&
                            payload > condition.criteria[i].field1
                        ) {
                            val++;
                        }
                    } else if (
                        condition.criteria[i] &&
                        condition.criteria[i].filter &&
                        condition.criteria[i].filter === 'lessThan'
                    ) {
                        if (
                            condition.criteria[i] &&
                            condition.criteria[i].field1 &&
                            payload &&
                            payload < condition.criteria[i].field1
                        ) {
                            val++;
                        }
                    } else if (
                        condition.criteria[i] &&
                        condition.criteria[i].filter &&
                        condition.criteria[i].filter === 'inBetween'
                    ) {
                        if (
                            condition.criteria[i] &&
                            condition.criteria[i].field1 &&
                            payload &&
                            condition.criteria[i].field2 &&
                            payload > condition.criteria[i].field1 &&
                            payload < condition.criteria[i].field2
                        ) {
                            val++;
                        }
                    } else if (
                        condition.criteria[i] &&
                        condition.criteria[i].filter &&
                        condition.criteria[i].filter === 'equalTo'
                    ) {
                        if (
                            condition.criteria[i] &&
                            condition.criteria[i].field1 &&
                            payload &&
                            payload == condition.criteria[i].field1
                        ) {
                            val++;
                        }
                    } else if (
                        condition.criteria[i] &&
                        condition.criteria[i].filter &&
                        condition.criteria[i].filter === 'notEqualTo'
                    ) {
                        if (
                            condition.criteria[i] &&
                            condition.criteria[i].field1 &&
                            payload &&
                            payload != condition.criteria[i].field1
                        ) {
                            val++;
                        }
                    } else if (
                        condition.criteria[i] &&
                        condition.criteria[i].filter &&
                        condition.criteria[i].filter === 'gtEqualTo'
                    ) {
                        if (
                            condition.criteria[i] &&
                            condition.criteria[i].field1 &&
                            payload &&
                            payload >= condition.criteria[i].field1
                        ) {
                            val++;
                        }
                    } else if (
                        condition.criteria[i] &&
                        condition.criteria[i].filter &&
                        condition.criteria[i].filter === 'ltEqualTo'
                    ) {
                        if (
                            condition.criteria[i] &&
                            condition.criteria[i].field1 &&
                            payload &&
                            payload <= condition.criteria[i].field1
                        ) {
                            val++;
                        }
                    }
                    incomingVal++;
                }
            }
        }
    }

    if (val > 0 && incomingVal > 0) {
        validity = true;
    }

    return validity;
};

// @ts-expect-error ts-migrate(7024) FIXME: Function implicitly has return type 'any' because ... Remove this comment to see the full error message
const checkAnd = (
    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'payload' implicitly has an 'any' type.
    payload,
    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'con' implicitly has an 'any' type.
    con,
    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'statusCode' implicitly has an 'any' typ... Remove this comment to see the full error message
    statusCode,
    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'body' implicitly has an 'any' type.
    body,
    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'ssl' implicitly has an 'any' type.
    ssl,
    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'response' implicitly has an 'any' type.
    response,
    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'successReasons' implicitly has an 'any'... Remove this comment to see the full error message
    successReasons,
    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'failedReasons' implicitly has an 'any' ... Remove this comment to see the full error message
    failedReasons,
    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'type' implicitly has an 'any' type.
    type,
    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'queryParams' implicitly has an 'any' ty... Remove this comment to see the full error message
    queryParams,
    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'headers' implicitly has an 'any' type.
    headers
) => {
    let validity = true;
    if (con && con.criteria && con.criteria.length > 0) {
        for (let i = 0; i < con.criteria.length; i++) {
            if (
                con.criteria[i].criteria &&
                con.criteria[i].criteria.length > 0
            ) {
                if (
                    con.criteria[i].condition &&
                    con.criteria[i].condition === 'and'
                ) {
                    // check and again
                    // @ts-expect-error ts-migrate(7022) FIXME: 'temp' implicitly has type 'any' because it does n... Remove this comment to see the full error message
                    const temp = checkAnd(
                        payload,
                        con.criteria[i],
                        statusCode,
                        body,
                        ssl,
                        response,
                        successReasons,
                        failedReasons,
                        type,
                        queryParams,
                        headers
                    );

                    if (!temp) {
                        validity = temp;
                    }
                } else if (
                    con.criteria[i].condition &&
                    con.criteria[i].condition === 'or'
                ) {
                    // check or again
                    // @ts-expect-error ts-migrate(7022) FIXME: 'temp1' implicitly has type 'any' because it does ... Remove this comment to see the full error message
                    const temp1 = checkOr(
                        payload,
                        con.criteria[i],
                        statusCode,
                        body,
                        ssl,
                        response,
                        successReasons,
                        failedReasons,
                        type,
                        queryParams,
                        headers
                    );
                    if (!temp1) {
                        validity = temp1;
                    }
                }
            } else {
                let tempReason = `${payload} min`;
                if (
                    con.criteria[i] &&
                    con.criteria[i].responseType &&
                    con.criteria[i].responseType === 'incomingTime'
                ) {
                    let timeHours = 0;
                    let timeMinutes = payload;
                    if (timeMinutes > 60) {
                        timeHours = Math.floor(timeMinutes / 60);
                        timeMinutes = Math.floor(timeMinutes % 60);
                        tempReason = `${timeHours} hrs ${timeMinutes} min`;
                    }
                }
                if (
                    con.criteria[i] &&
                    con.criteria[i].responseType &&
                    con.criteria[i].responseType === 'responseTime'
                ) {
                    if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'greaterThan'
                    ) {
                        if (
                            !(
                                con.criteria[i] &&
                                con.criteria[i].field1 &&
                                payload &&
                                payload > Number(con.criteria[i].field1)
                            )
                        ) {
                            validity = false;
                            failedReasons.push(
                                `${criteriaStrings.responseTime} ${payload} ms`
                            );
                        } else {
                            successReasons.push(
                                `${criteriaStrings.responseTime} ${payload} ms`
                            );
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'lessThan'
                    ) {
                        if (
                            !(
                                con.criteria[i] &&
                                con.criteria[i].field1 &&
                                payload &&
                                payload < Number(con.criteria[i].field1)
                            )
                        ) {
                            validity = false;
                            failedReasons.push(
                                `${criteriaStrings.responseTime} ${payload} ms`
                            );
                        } else {
                            successReasons.push(
                                `${criteriaStrings.responseTime} ${payload} ms`
                            );
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'inBetween'
                    ) {
                        if (
                            !(
                                con.criteria[i] &&
                                con.criteria[i].field1 &&
                                payload &&
                                con.criteria[i].field2 &&
                                payload > Number(con.criteria[i].field1) &&
                                payload < Number(con.criteria[i].field2)
                            )
                        ) {
                            validity = false;
                            failedReasons.push(
                                `${criteriaStrings.responseTime} ${payload} ms`
                            );
                        } else {
                            successReasons.push(
                                `${criteriaStrings.responseTime} ${payload} ms`
                            );
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'equalTo'
                    ) {
                        if (
                            !(
                                con.criteria[i] &&
                                con.criteria[i].field1 &&
                                payload &&
                                payload === Number(con.criteria[i].field1)
                            )
                        ) {
                            validity = false;
                            failedReasons.push(
                                `${criteriaStrings.responseTime} ${payload} ms`
                            );
                        } else {
                            successReasons.push(
                                `${criteriaStrings.responseTime} ${payload} ms`
                            );
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'notEqualTo'
                    ) {
                        if (
                            !(
                                con.criteria[i] &&
                                con.criteria[i].field1 &&
                                payload &&
                                payload !== Number(con.criteria[i].field1)
                            )
                        ) {
                            validity = false;
                            failedReasons.push(
                                `${criteriaStrings.responseTime} ${payload} ms`
                            );
                        } else {
                            successReasons.push(
                                `${criteriaStrings.responseTime} ${payload} ms`
                            );
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'gtEqualTo'
                    ) {
                        if (
                            !(
                                con.criteria[i] &&
                                con.criteria[i].field1 &&
                                payload &&
                                payload >= Number(con.criteria[i].field1)
                            )
                        ) {
                            validity = false;
                            failedReasons.push(
                                `${criteriaStrings.responseTime} ${payload} ms`
                            );
                        } else {
                            successReasons.push(
                                `${criteriaStrings.responseTime} ${payload} ms`
                            );
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'ltEqualTo'
                    ) {
                        if (
                            !(
                                con.criteria[i] &&
                                con.criteria[i].field1 &&
                                payload &&
                                payload <= Number(con.criteria[i].field1)
                            )
                        ) {
                            validity = false;
                            failedReasons.push(
                                `${criteriaStrings.responseTime} ${payload} ms`
                            );
                        } else {
                            successReasons.push(
                                `${criteriaStrings.responseTime} ${payload} ms`
                            );
                        }
                    }
                } else if (
                    con.criteria[i] &&
                    con.criteria[i].responseType &&
                    con.criteria[i].responseType === 'incomingTime'
                ) {
                    if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'greaterThan'
                    ) {
                        if (
                            !(
                                con.criteria[i] &&
                                con.criteria[i].field1 &&
                                payload &&
                                payload > con.criteria[i].field1
                            )
                        ) {
                            validity = false;
                            failedReasons.push(
                                `${criteriaStrings.incomingTime} ${tempReason}`
                            );
                        } else {
                            successReasons.push(
                                `${criteriaStrings.incomingTime} ${tempReason}`
                            );
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'lessThan'
                    ) {
                        if (
                            !(
                                con.criteria[i] &&
                                con.criteria[i].field1 &&
                                payload &&
                                payload < con.criteria[i].field1
                            )
                        ) {
                            validity = false;
                            failedReasons.push(
                                `${criteriaStrings.incomingTime} ${tempReason}`
                            );
                        } else {
                            successReasons.push(
                                `${criteriaStrings.incomingTime} ${tempReason}`
                            );
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'inBetween'
                    ) {
                        if (
                            !(
                                con.criteria[i] &&
                                con.criteria[i].field1 &&
                                payload &&
                                con.criteria[i].field2 &&
                                payload > con.criteria[i].field1 &&
                                payload < con.criteria[i].field2
                            )
                        ) {
                            validity = false;
                            failedReasons.push(
                                `${criteriaStrings.incomingTime} ${tempReason}`
                            );
                        } else {
                            successReasons.push(
                                `${criteriaStrings.incomingTime} ${tempReason}`
                            );
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'equalTo'
                    ) {
                        if (
                            !(
                                con.criteria[i] &&
                                con.criteria[i].field1 &&
                                payload &&
                                payload == con.criteria[i].field1
                            )
                        ) {
                            validity = false;
                            failedReasons.push(
                                `${criteriaStrings.incomingTime} ${tempReason}`
                            );
                        } else {
                            successReasons.push(
                                `${criteriaStrings.incomingTime} ${tempReason}`
                            );
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'notEqualTo'
                    ) {
                        if (
                            !(
                                con.criteria[i] &&
                                con.criteria[i].field1 &&
                                payload &&
                                payload != con.criteria[i].field1
                            )
                        ) {
                            validity = false;
                            failedReasons.push(
                                `${criteriaStrings.incomingTime} ${tempReason}`
                            );
                        } else {
                            successReasons.push(
                                `${criteriaStrings.incomingTime} ${tempReason}`
                            );
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'gtEqualTo'
                    ) {
                        if (
                            !(
                                con.criteria[i] &&
                                con.criteria[i].field1 &&
                                payload &&
                                payload >= con.criteria[i].field1
                            )
                        ) {
                            validity = false;
                            failedReasons.push(
                                `${criteriaStrings.incomingTime} ${tempReason}`
                            );
                        } else {
                            successReasons.push(
                                `${criteriaStrings.incomingTime} ${tempReason}`
                            );
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'ltEqualTo'
                    ) {
                        if (
                            !(
                                con.criteria[i] &&
                                con.criteria[i].field1 &&
                                payload &&
                                payload <= con.criteria[i].field1
                            )
                        ) {
                            validity = false;
                            failedReasons.push(
                                `${criteriaStrings.incomingTime} ${tempReason}`
                            );
                        } else {
                            successReasons.push(
                                `${criteriaStrings.incomingTime} ${tempReason}`
                            );
                        }
                    }
                } else if (
                    con.criteria[i] &&
                    con.criteria[i].responseType === 'doesRespond'
                ) {
                    if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'isUp'
                    ) {
                        if (
                            !(
                                con.criteria[i] &&
                                con.criteria[i].filter &&
                                !(
                                    (statusCode === 408 ||
                                        statusCode === '408') &&
                                    body &&
                                    body.code &&
                                    body.code === 'ENOTFOUND'
                                )
                            )
                        ) {
                            validity = false;
                            failedReasons.push(
                                // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
                                `${criteriaStrings[type] ||
                                    'Monitor was'} Offline`
                            );
                        } else {
                            successReasons.push(
                                // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
                                `${criteriaStrings[type] ||
                                    'Monitor was'} Online`
                            );
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'isDown'
                    ) {
                        if (
                            !(
                                con.criteria[i] &&
                                con.criteria[i].filter &&
                                (statusCode === 408 || statusCode === '408') &&
                                body &&
                                body.code &&
                                body.code === 'ENOTFOUND'
                            )
                        ) {
                            validity = false;
                            failedReasons.push(
                                // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
                                `${criteriaStrings[type] ||
                                    'Monitor was'} Online`
                            );
                        } else {
                            successReasons.push(
                                // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
                                `${criteriaStrings[type] ||
                                    'Monitor was'} Offline`
                            );
                        }
                    }
                } else if (
                    con.criteria[i] &&
                    con.criteria[i].responseType === 'ssl'
                ) {
                    const expiresIn = moment(
                        new Date(
                            ssl && ssl.expires ? ssl.expires : Date.now()
                        ).getTime()
                    ).diff(Date.now(), 'days');
                    if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'isValid'
                    ) {
                        if (!(ssl && !ssl.selfSigned)) {
                            validity = false;
                            failedReasons.push(
                                `${criteriaStrings.sslCertificate} was not valid`
                            );
                        } else {
                            successReasons.push(
                                `${criteriaStrings.sslCertificate} was valid`
                            );
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'notFound'
                    ) {
                        if (ssl) {
                            validity = false;
                            failedReasons.push(
                                `${criteriaStrings.sslCertificate} was present`
                            );
                        } else {
                            successReasons.push(
                                `${criteriaStrings.sslCertificate} was not present`
                            );
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'selfSigned'
                    ) {
                        if (!(ssl && ssl.selfSigned)) {
                            validity = false;
                            failedReasons.push(
                                `${criteriaStrings.sslCertificate} was not Self-Signed`
                            );
                        } else {
                            successReasons.push(
                                `${criteriaStrings.sslCertificate} was Self-Signed`
                            );
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'expiresIn30'
                    ) {
                        if (!(ssl && !ssl.selfSigned && expiresIn < 30)) {
                            validity = false;
                            failedReasons.push(
                                `${criteriaStrings.sslCertificate} expires in ${expiresIn} days`
                            );
                        } else {
                            successReasons.push(
                                `${criteriaStrings.sslCertificate} expires in ${expiresIn} days`
                            );
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'expiresIn10'
                    ) {
                        if (!(ssl && !ssl.selfSigned && expiresIn < 10)) {
                            validity = false;
                            failedReasons.push(
                                `${criteriaStrings.sslCertificate} expires in ${expiresIn} days`
                            );
                        } else {
                            successReasons.push(
                                `${criteriaStrings.sslCertificate} expires in ${expiresIn} days`
                            );
                        }
                    }
                } else if (
                    con.criteria[i] &&
                    con.criteria[i].responseType === 'statusCode'
                ) {
                    statusCode = Number(statusCode);
                    const criteriaStatusCode1 =
                        con.criteria[i].field1 &&
                        Number(con.criteria[i].field1);
                    const criteriaStatusCode2 =
                        con.criteria[i].field2 &&
                        Number(con.criteria[i].field2);
                    if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'greaterThan'
                    ) {
                        if (
                            !(
                                con.criteria[i] &&
                                criteriaStatusCode1 &&
                                statusCode &&
                                statusCode > criteriaStatusCode1
                            )
                        ) {
                            validity = false;
                            if (statusCode === 408 || statusCode === '408') {
                                failedReasons.push('Request Timed out');
                            } else {
                                failedReasons.push(
                                    `${criteriaStrings.statusCode} ${statusCode}`
                                );
                            }
                        } else {
                            if (statusCode === 408 || statusCode === '408') {
                                successReasons.push('Request Timed out');
                            } else {
                                successReasons.push(
                                    `${criteriaStrings.statusCode} ${statusCode}`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'lessThan'
                    ) {
                        if (
                            !(
                                con.criteria[i] &&
                                criteriaStatusCode1 &&
                                statusCode &&
                                statusCode < criteriaStatusCode1
                            )
                        ) {
                            validity = false;
                            if (statusCode === 408 || statusCode === '408') {
                                failedReasons.push('Request Timed out');
                            } else {
                                failedReasons.push(
                                    `${criteriaStrings.statusCode} ${statusCode}`
                                );
                            }
                        } else {
                            if (statusCode === 408 || statusCode === '408') {
                                successReasons.push('Request Timed out');
                            } else {
                                successReasons.push(
                                    `${criteriaStrings.statusCode} ${statusCode}`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'inBetween'
                    ) {
                        if (
                            !(
                                con.criteria[i] &&
                                criteriaStatusCode1 &&
                                statusCode &&
                                criteriaStatusCode2 &&
                                statusCode > criteriaStatusCode1 &&
                                statusCode < criteriaStatusCode2
                            )
                        ) {
                            validity = false;
                            if (statusCode === 408 || statusCode === '408') {
                                failedReasons.push('Request Timed out');
                            } else {
                                failedReasons.push(
                                    `${criteriaStrings.statusCode} ${statusCode}`
                                );
                            }
                        } else {
                            if (statusCode === 408 || statusCode === '408') {
                                successReasons.push('Request Timed out');
                            } else {
                                successReasons.push(
                                    `${criteriaStrings.statusCode} ${statusCode}`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'equalTo'
                    ) {
                        if (
                            !(
                                con.criteria[i] &&
                                criteriaStatusCode1 &&
                                statusCode &&
                                statusCode == criteriaStatusCode1
                            )
                        ) {
                            validity = false;
                            if (statusCode === 408 || statusCode === '408') {
                                failedReasons.push('Request Timed out');
                            } else {
                                failedReasons.push(
                                    `${criteriaStrings.statusCode} ${statusCode}`
                                );
                            }
                        } else {
                            if (statusCode === 408 || statusCode === '408') {
                                successReasons.push('Request Timed out');
                            } else {
                                successReasons.push(
                                    `${criteriaStrings.statusCode} ${statusCode}`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'notEqualTo'
                    ) {
                        if (
                            !(
                                con.criteria[i] &&
                                criteriaStatusCode1 &&
                                statusCode &&
                                statusCode != criteriaStatusCode1
                            )
                        ) {
                            validity = false;
                            if (statusCode === 408 || statusCode === '408') {
                                failedReasons.push('Request Timed out');
                            } else {
                                failedReasons.push(
                                    `${criteriaStrings.statusCode} ${statusCode}`
                                );
                            }
                        } else {
                            if (statusCode === 408 || statusCode === '408') {
                                successReasons.push('Request Timed out');
                            } else {
                                successReasons.push(
                                    `${criteriaStrings.statusCode} ${statusCode}`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'gtEqualTo'
                    ) {
                        if (
                            !(
                                con.criteria[i] &&
                                criteriaStatusCode1 &&
                                statusCode &&
                                statusCode >= criteriaStatusCode1
                            )
                        ) {
                            validity = false;
                            if (statusCode === 408 || statusCode === '408') {
                                failedReasons.push('Request Timed out');
                            } else {
                                failedReasons.push(
                                    `${criteriaStrings.statusCode} ${statusCode}`
                                );
                            }
                        } else {
                            if (statusCode === 408 || statusCode === '408') {
                                successReasons.push('Request Timed out');
                            } else {
                                successReasons.push(
                                    `${criteriaStrings.statusCode} ${statusCode}`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'ltEqualTo'
                    ) {
                        if (
                            !(
                                con.criteria[i] &&
                                criteriaStatusCode1 &&
                                statusCode &&
                                statusCode <= criteriaStatusCode1
                            )
                        ) {
                            validity = false;
                            if (statusCode === 408 || statusCode === '408') {
                                failedReasons.push('Request Timed out');
                            } else {
                                failedReasons.push(
                                    `${criteriaStrings.statusCode} ${statusCode}`
                                );
                            }
                        } else {
                            if (statusCode === 408 || statusCode === '408') {
                                successReasons.push('Request Timed out');
                            } else {
                                successReasons.push(
                                    `${criteriaStrings.statusCode} ${statusCode}`
                                );
                            }
                        }
                    }
                } else if (
                    con.criteria[i] &&
                    con.criteria[i].responseType === 'cpuLoad'
                ) {
                    if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'greaterThan'
                    ) {
                        if (
                            !(
                                con.criteria[i] &&
                                con.criteria[i].field1 &&
                                payload &&
                                payload.cpuLoad &&
                                payload.cpuLoad > con.criteria[i].field1
                            )
                        ) {
                            validity = false;
                            if (payload && payload.cpuLoad !== null) {
                                failedReasons.push(
                                    // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
                                    `${criteriaStrings.cpuLoad} ${formatDecimal(
                                        payload.cpuLoad,
                                        2
                                    )} %`
                                );
                            }
                        } else {
                            if (payload && payload.cpuLoad !== null) {
                                successReasons.push(
                                    // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
                                    `${criteriaStrings.cpuLoad} ${formatDecimal(
                                        payload.cpuLoad,
                                        2
                                    )} %`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'lessThan'
                    ) {
                        if (
                            !(
                                con.criteria[i] &&
                                con.criteria[i].field1 &&
                                payload &&
                                payload.cpuLoad &&
                                payload.cpuLoad < con.criteria[i].field1
                            )
                        ) {
                            validity = false;
                            if (payload && payload.cpuLoad !== null) {
                                failedReasons.push(
                                    // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
                                    `${criteriaStrings.cpuLoad} ${formatDecimal(
                                        payload.cpuLoad,
                                        2
                                    )} %`
                                );
                            }
                        } else {
                            if (payload && payload.cpuLoad !== null) {
                                successReasons.push(
                                    // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
                                    `${criteriaStrings.cpuLoad} ${formatDecimal(
                                        payload.cpuLoad,
                                        2
                                    )} %`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'inBetween'
                    ) {
                        if (
                            !(
                                con.criteria[i] &&
                                con.criteria[i].field1 &&
                                payload &&
                                payload.cpuLoad &&
                                con.criteria[i].field2 &&
                                payload.cpuLoad > con.criteria[i].field1 &&
                                payload.cpuLoad < con.criteria[i].field2
                            )
                        ) {
                            validity = false;
                            if (payload && payload.cpuLoad !== null) {
                                failedReasons.push(
                                    // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
                                    `${criteriaStrings.cpuLoad} ${formatDecimal(
                                        payload.cpuLoad,
                                        2
                                    )} %`
                                );
                            }
                        } else {
                            if (payload && payload.cpuLoad !== null) {
                                successReasons.push(
                                    // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
                                    `${criteriaStrings.cpuLoad} ${formatDecimal(
                                        payload.cpuLoad,
                                        2
                                    )} %`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'equalTo'
                    ) {
                        if (
                            !(
                                con.criteria[i] &&
                                con.criteria[i].field1 &&
                                payload &&
                                payload.cpuLoad &&
                                payload.cpuLoad == con.criteria[i].field1
                            )
                        ) {
                            validity = false;
                            if (payload && payload.cpuLoad !== null) {
                                failedReasons.push(
                                    // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
                                    `${criteriaStrings.cpuLoad} ${formatDecimal(
                                        payload.cpuLoad,
                                        2
                                    )} %`
                                );
                            }
                        } else {
                            if (payload && payload.cpuLoad !== null) {
                                successReasons.push(
                                    // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
                                    `${criteriaStrings.cpuLoad} ${formatDecimal(
                                        payload.cpuLoad,
                                        2
                                    )} %`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'notEqualTo'
                    ) {
                        if (
                            !(
                                con.criteria[i] &&
                                con.criteria[i].field1 &&
                                payload &&
                                payload.cpuLoad &&
                                payload.cpuLoad != con.criteria[i].field1
                            )
                        ) {
                            validity = false;
                            if (payload && payload.cpuLoad !== null) {
                                failedReasons.push(
                                    // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
                                    `${criteriaStrings.cpuLoad} ${formatDecimal(
                                        payload.cpuLoad,
                                        2
                                    )} %`
                                );
                            }
                        } else {
                            if (payload && payload.cpuLoad !== null) {
                                successReasons.push(
                                    // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
                                    `${criteriaStrings.cpuLoad} ${formatDecimal(
                                        payload.cpuLoad,
                                        2
                                    )} %`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'gtEqualTo'
                    ) {
                        if (
                            !(
                                con.criteria[i] &&
                                con.criteria[i].field1 &&
                                payload &&
                                payload.cpuLoad &&
                                payload.cpuLoad >= con.criteria[i].field1
                            )
                        ) {
                            validity = false;
                            if (payload && payload.cpuLoad !== null) {
                                failedReasons.push(
                                    // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
                                    `${criteriaStrings.cpuLoad} ${formatDecimal(
                                        payload.cpuLoad,
                                        2
                                    )} %`
                                );
                            }
                        } else {
                            if (payload && payload.cpuLoad !== null) {
                                successReasons.push(
                                    // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
                                    `${criteriaStrings.cpuLoad} ${formatDecimal(
                                        payload.cpuLoad,
                                        2
                                    )} %`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'ltEqualTo'
                    ) {
                        if (
                            !(
                                con.criteria[i] &&
                                con.criteria[i].field1 &&
                                payload &&
                                payload.cpuLoad &&
                                payload.cpuLoad <= con.criteria[i].field1
                            )
                        ) {
                            validity = false;
                            if (payload && payload.cpuLoad !== null) {
                                failedReasons.push(
                                    // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
                                    `${criteriaStrings.cpuLoad} ${formatDecimal(
                                        payload.cpuLoad,
                                        2
                                    )} %`
                                );
                            }
                        } else {
                            if (payload && payload.cpuLoad !== null) {
                                successReasons.push(
                                    // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
                                    `${criteriaStrings.cpuLoad} ${formatDecimal(
                                        payload.cpuLoad,
                                        2
                                    )} %`
                                );
                            }
                        }
                    }
                } else if (
                    con.criteria[i] &&
                    con.criteria[i].responseType === 'memoryUsage'
                ) {
                    const memoryUsedBytes = payload
                        ? parseInt(payload.memoryUsed || 0)
                        : 0;
                    const memoryUsed = memoryUsedBytes / Math.pow(1e3, 3);
                    if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'greaterThan'
                    ) {
                        if (
                            !(
                                con.criteria[i] &&
                                con.criteria[i].field1 &&
                                memoryUsedBytes &&
                                memoryUsed &&
                                memoryUsed > con.criteria[i].field1
                            )
                        ) {
                            validity = false;
                            if (payload && payload.memoryUsed !== null) {
                                failedReasons.push(
                                    `${
                                        criteriaStrings.memoryUsed
                                        // @ts-expect-error ts-migrate(2554) FIXME: Expected 5 arguments, but got 1.
                                    } ${formatBytes(memoryUsedBytes)}`
                                );
                            }
                        } else {
                            if (payload && payload.memoryUsed !== null) {
                                successReasons.push(
                                    `${
                                        criteriaStrings.memoryUsed
                                        // @ts-expect-error ts-migrate(2554) FIXME: Expected 5 arguments, but got 1.
                                    } ${formatBytes(memoryUsedBytes)}`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'lessThan'
                    ) {
                        if (
                            !(
                                con.criteria[i] &&
                                con.criteria[i].field1 &&
                                memoryUsedBytes &&
                                memoryUsed &&
                                memoryUsed < con.criteria[i].field1
                            )
                        ) {
                            validity = false;
                            if (payload && payload.memoryUsed !== null) {
                                failedReasons.push(
                                    `${
                                        criteriaStrings.memoryUsed
                                        // @ts-expect-error ts-migrate(2554) FIXME: Expected 5 arguments, but got 1.
                                    } ${formatBytes(memoryUsedBytes)}`
                                );
                            }
                        } else {
                            if (payload && payload.memoryUsed !== null) {
                                successReasons.push(
                                    `${
                                        criteriaStrings.memoryUsed
                                        // @ts-expect-error ts-migrate(2554) FIXME: Expected 5 arguments, but got 1.
                                    } ${formatBytes(memoryUsedBytes)}`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'inBetween'
                    ) {
                        if (
                            !(
                                con.criteria[i] &&
                                con.criteria[i].field1 &&
                                memoryUsedBytes &&
                                memoryUsed &&
                                con.criteria[i].field2 &&
                                memoryUsed > con.criteria[i].field1 &&
                                memoryUsed < con.criteria[i].field2
                            )
                        ) {
                            validity = false;
                            if (payload && payload.memoryUsed !== null) {
                                failedReasons.push(
                                    `${
                                        criteriaStrings.memoryUsed
                                        // @ts-expect-error ts-migrate(2554) FIXME: Expected 5 arguments, but got 1.
                                    } ${formatBytes(memoryUsedBytes)}`
                                );
                            }
                        } else {
                            if (payload && payload.memoryUsed !== null) {
                                successReasons.push(
                                    `${
                                        criteriaStrings.memoryUsed
                                        // @ts-expect-error ts-migrate(2554) FIXME: Expected 5 arguments, but got 1.
                                    } ${formatBytes(memoryUsedBytes)}`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'equalTo'
                    ) {
                        if (
                            !(
                                con.criteria[i] &&
                                con.criteria[i].field1 &&
                                memoryUsedBytes &&
                                memoryUsed &&
                                memoryUsed == con.criteria[i].field1
                            )
                        ) {
                            validity = false;
                            if (payload && payload.memoryUsed !== null) {
                                failedReasons.push(
                                    `${
                                        criteriaStrings.memoryUsed
                                        // @ts-expect-error ts-migrate(2554) FIXME: Expected 5 arguments, but got 1.
                                    } ${formatBytes(memoryUsedBytes)}`
                                );
                            }
                        } else {
                            if (payload && payload.memoryUsed !== null) {
                                successReasons.push(
                                    `${
                                        criteriaStrings.memoryUsed
                                        // @ts-expect-error ts-migrate(2554) FIXME: Expected 5 arguments, but got 1.
                                    } ${formatBytes(memoryUsedBytes)}`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'notEqualTo'
                    ) {
                        if (
                            !(
                                con.criteria[i] &&
                                con.criteria[i].field1 &&
                                memoryUsedBytes &&
                                memoryUsed &&
                                memoryUsed != con.criteria[i].field1
                            )
                        ) {
                            validity = false;
                            if (payload && payload.memoryUsed !== null) {
                                failedReasons.push(
                                    `${
                                        criteriaStrings.memoryUsed
                                        // @ts-expect-error ts-migrate(2554) FIXME: Expected 5 arguments, but got 1.
                                    } ${formatBytes(memoryUsedBytes)}`
                                );
                            }
                        } else {
                            if (payload && payload.memoryUsed !== null) {
                                successReasons.push(
                                    `${
                                        criteriaStrings.memoryUsed
                                        // @ts-expect-error ts-migrate(2554) FIXME: Expected 5 arguments, but got 1.
                                    } ${formatBytes(memoryUsedBytes)}`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'gtEqualTo'
                    ) {
                        if (
                            !(
                                con.criteria[i] &&
                                con.criteria[i].field1 &&
                                memoryUsedBytes &&
                                memoryUsed &&
                                memoryUsed >= con.criteria[i].field1
                            )
                        ) {
                            validity = false;
                            if (payload && payload.memoryUsed !== null) {
                                failedReasons.push(
                                    `${
                                        criteriaStrings.memoryUsed
                                        // @ts-expect-error ts-migrate(2554) FIXME: Expected 5 arguments, but got 1.
                                    } ${formatBytes(memoryUsedBytes)}`
                                );
                            }
                        } else {
                            if (payload && payload.memoryUsed !== null) {
                                successReasons.push(
                                    `${
                                        criteriaStrings.memoryUsed
                                        // @ts-expect-error ts-migrate(2554) FIXME: Expected 5 arguments, but got 1.
                                    } ${formatBytes(memoryUsedBytes)}`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'ltEqualTo'
                    ) {
                        if (
                            !(
                                con.criteria[i] &&
                                con.criteria[i].field1 &&
                                memoryUsedBytes &&
                                memoryUsed &&
                                memoryUsed <= con.criteria[i].field1
                            )
                        ) {
                            validity = false;
                            if (payload && payload.memoryUsed !== null) {
                                failedReasons.push(
                                    `${
                                        criteriaStrings.memoryUsed
                                        // @ts-expect-error ts-migrate(2554) FIXME: Expected 5 arguments, but got 1.
                                    } ${formatBytes(memoryUsedBytes)}`
                                );
                            }
                        } else {
                            if (payload && payload.memoryUsed !== null) {
                                successReasons.push(
                                    `${
                                        criteriaStrings.memoryUsed
                                        // @ts-expect-error ts-migrate(2554) FIXME: Expected 5 arguments, but got 1.
                                    } ${formatBytes(memoryUsedBytes)}`
                                );
                            }
                        }
                    }
                } else if (
                    con.criteria[i] &&
                    con.criteria[i].responseType === 'storageUsage'
                ) {
                    const size = payload
                        ? parseInt(payload.totalStorage || 0)
                        : 0;
                    const used = payload
                        ? parseInt(payload.storageUsed || 0)
                        : 0;
                    const freeBytes = size - used;
                    const free = freeBytes / Math.pow(1e3, 3);
                    if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'greaterThan'
                    ) {
                        if (
                            !(
                                con.criteria[i] &&
                                con.criteria[i].field1 &&
                                freeBytes &&
                                free > con.criteria[i].field1
                            )
                        ) {
                            validity = false;
                            if (
                                payload &&
                                payload.totalStorage !== null &&
                                payload.storageUsed !== null
                            ) {
                                failedReasons.push(
                                    `${
                                        criteriaStrings.freeStorage
                                        // @ts-expect-error ts-migrate(2554) FIXME: Expected 5 arguments, but got 1.
                                    } ${formatBytes(freeBytes)}`
                                );
                            }
                        } else {
                            if (
                                payload &&
                                payload.totalStorage !== null &&
                                payload.storageUsed !== null
                            ) {
                                successReasons.push(
                                    `${
                                        criteriaStrings.freeStorage
                                        // @ts-expect-error ts-migrate(2554) FIXME: Expected 5 arguments, but got 1.
                                    } ${formatBytes(freeBytes)}`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'lessThan'
                    ) {
                        if (
                            !(
                                con.criteria[i] &&
                                con.criteria[i].field1 &&
                                freeBytes &&
                                free < con.criteria[i].field1
                            )
                        ) {
                            validity = false;
                            if (
                                payload &&
                                payload.totalStorage !== null &&
                                payload.storageUsed !== null
                            ) {
                                failedReasons.push(
                                    `${
                                        criteriaStrings.freeStorage
                                        // @ts-expect-error ts-migrate(2554) FIXME: Expected 5 arguments, but got 1.
                                    } ${formatBytes(freeBytes)}`
                                );
                            }
                        } else {
                            if (
                                payload &&
                                payload.totalStorage !== null &&
                                payload.storageUsed !== null
                            ) {
                                successReasons.push(
                                    `${
                                        criteriaStrings.freeStorage
                                        // @ts-expect-error ts-migrate(2554) FIXME: Expected 5 arguments, but got 1.
                                    } ${formatBytes(freeBytes)}`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'inBetween'
                    ) {
                        if (
                            !(
                                con.criteria[i] &&
                                con.criteria[i].field1 &&
                                con.criteria[i].field2 &&
                                freeBytes &&
                                free > con.criteria[i].field1 &&
                                free < con.criteria[i].field2
                            )
                        ) {
                            validity = false;
                            if (
                                payload &&
                                payload.totalStorage !== null &&
                                payload.storageUsed !== null
                            ) {
                                failedReasons.push(
                                    `${
                                        criteriaStrings.freeStorage
                                        // @ts-expect-error ts-migrate(2554) FIXME: Expected 5 arguments, but got 1.
                                    } ${formatBytes(freeBytes)}`
                                );
                            }
                        } else {
                            if (
                                payload &&
                                payload.totalStorage !== null &&
                                payload.storageUsed !== null
                            ) {
                                successReasons.push(
                                    `${
                                        criteriaStrings.freeStorage
                                        // @ts-expect-error ts-migrate(2554) FIXME: Expected 5 arguments, but got 1.
                                    } ${formatBytes(freeBytes)}`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'equalTo'
                    ) {
                        if (
                            !(
                                con.criteria[i] &&
                                con.criteria[i].field1 &&
                                freeBytes &&
                                free === con.criteria[i].field1
                            )
                        ) {
                            validity = false;
                            if (
                                payload &&
                                payload.totalStorage !== null &&
                                payload.storageUsed !== null
                            ) {
                                failedReasons.push(
                                    `${
                                        criteriaStrings.freeStorage
                                        // @ts-expect-error ts-migrate(2554) FIXME: Expected 5 arguments, but got 1.
                                    } ${formatBytes(freeBytes)}`
                                );
                            }
                        } else {
                            if (
                                payload &&
                                payload.totalStorage !== null &&
                                payload.storageUsed !== null
                            ) {
                                successReasons.push(
                                    `${
                                        criteriaStrings.freeStorage
                                        // @ts-expect-error ts-migrate(2554) FIXME: Expected 5 arguments, but got 1.
                                    } ${formatBytes(freeBytes)}`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'notEqualTo'
                    ) {
                        if (
                            !(
                                con.criteria[i] &&
                                con.criteria[i].field1 &&
                                freeBytes &&
                                free !== con.criteria[i].field1
                            )
                        ) {
                            validity = false;
                            if (
                                payload &&
                                payload.totalStorage !== null &&
                                payload.storageUsed !== null
                            ) {
                                failedReasons.push(
                                    `${
                                        criteriaStrings.freeStorage
                                        // @ts-expect-error ts-migrate(2554) FIXME: Expected 5 arguments, but got 1.
                                    } ${formatBytes(freeBytes)}`
                                );
                            }
                        } else {
                            if (
                                payload &&
                                payload.totalStorage !== null &&
                                payload.storageUsed !== null
                            ) {
                                successReasons.push(
                                    `${
                                        criteriaStrings.freeStorage
                                        // @ts-expect-error ts-migrate(2554) FIXME: Expected 5 arguments, but got 1.
                                    } ${formatBytes(freeBytes)}`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'gtEqualTo'
                    ) {
                        if (
                            !(
                                con.criteria[i] &&
                                con.criteria[i].field1 &&
                                freeBytes &&
                                free >= con.criteria[i].field1
                            )
                        ) {
                            validity = false;
                            if (
                                payload &&
                                payload.totalStorage !== null &&
                                payload.storageUsed !== null
                            ) {
                                failedReasons.push(
                                    `${
                                        criteriaStrings.freeStorage
                                        // @ts-expect-error ts-migrate(2554) FIXME: Expected 5 arguments, but got 1.
                                    } ${formatBytes(freeBytes)}`
                                );
                            }
                        } else {
                            if (
                                payload &&
                                payload.totalStorage !== null &&
                                payload.storageUsed !== null
                            ) {
                                successReasons.push(
                                    `${
                                        criteriaStrings.freeStorage
                                        // @ts-expect-error ts-migrate(2554) FIXME: Expected 5 arguments, but got 1.
                                    } ${formatBytes(freeBytes)}`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'ltEqualTo'
                    ) {
                        if (
                            !(
                                con.criteria[i] &&
                                con.criteria[i].field1 &&
                                freeBytes &&
                                free <= con.criteria[i].field1
                            )
                        ) {
                            validity = false;
                            if (
                                payload &&
                                payload.totalStorage !== null &&
                                payload.storageUsed !== null
                            ) {
                                failedReasons.push(
                                    `${
                                        criteriaStrings.freeStorage
                                        // @ts-expect-error ts-migrate(2554) FIXME: Expected 5 arguments, but got 1.
                                    } ${formatBytes(freeBytes)}`
                                );
                            }
                        } else {
                            if (
                                payload &&
                                payload.totalStorage !== null &&
                                payload.storageUsed !== null
                            ) {
                                successReasons.push(
                                    `${
                                        criteriaStrings.freeStorage
                                        // @ts-expect-error ts-migrate(2554) FIXME: Expected 5 arguments, but got 1.
                                    } ${formatBytes(freeBytes)}`
                                );
                            }
                        }
                    }
                } else if (
                    con.criteria[i] &&
                    con.criteria[i].responseType === 'temperature'
                ) {
                    if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'greaterThan'
                    ) {
                        if (
                            !(
                                con.criteria[i] &&
                                con.criteria[i].field1 &&
                                payload &&
                                payload.mainTemp &&
                                payload.mainTemp > con.criteria[i].field1
                            )
                        ) {
                            validity = false;
                            if (payload && payload.mainTemp !== null) {
                                failedReasons.push(
                                    `${criteriaStrings.temperature} ${payload.mainTemp} °C`
                                );
                            }
                        } else {
                            if (payload && payload.mainTemp !== null) {
                                successReasons.push(
                                    `${criteriaStrings.temperature} ${payload.mainTemp} °C`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'lessThan'
                    ) {
                        if (
                            !(
                                con.criteria[i] &&
                                con.criteria[i].field1 &&
                                payload &&
                                payload.mainTemp &&
                                payload.mainTemp < con.criteria[i].field1
                            )
                        ) {
                            validity = false;
                            if (payload && payload.mainTemp !== null) {
                                failedReasons.push(
                                    `${criteriaStrings.temperature} ${payload.mainTemp} °C`
                                );
                            }
                        } else {
                            if (payload && payload.mainTemp !== null) {
                                successReasons.push(
                                    `${criteriaStrings.temperature} ${payload.mainTemp} °C`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'inBetween'
                    ) {
                        if (
                            !(
                                con.criteria[i] &&
                                con.criteria[i].field1 &&
                                payload &&
                                payload.mainTemp &&
                                con.criteria[i].field2 &&
                                payload.mainTemp > con.criteria[i].field1 &&
                                payload.mainTemp < con.criteria[i].field2
                            )
                        ) {
                            validity = false;
                            if (payload && payload.mainTemp !== null) {
                                failedReasons.push(
                                    `${criteriaStrings.temperature} ${payload.mainTemp} °C`
                                );
                            }
                        } else {
                            if (payload && payload.mainTemp !== null) {
                                successReasons.push(
                                    `${criteriaStrings.temperature} ${payload.mainTemp} °C`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'equalTo'
                    ) {
                        if (
                            !(
                                con.criteria[i] &&
                                con.criteria[i].field1 &&
                                payload &&
                                payload.mainTemp &&
                                payload.mainTemp == con.criteria[i].field1
                            )
                        ) {
                            validity = false;
                            if (payload && payload.mainTemp !== null) {
                                failedReasons.push(
                                    `${criteriaStrings.temperature} ${payload.mainTemp} °C`
                                );
                            }
                        } else {
                            if (payload && payload.mainTemp !== null) {
                                successReasons.push(
                                    `${criteriaStrings.temperature} ${payload.mainTemp} °C`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'notEqualTo'
                    ) {
                        if (
                            !(
                                con.criteria[i] &&
                                con.criteria[i].field1 &&
                                payload &&
                                payload.mainTemp &&
                                payload.mainTemp != con.criteria[i].field1
                            )
                        ) {
                            validity = false;
                            if (payload && payload.mainTemp !== null) {
                                failedReasons.push(
                                    `${criteriaStrings.temperature} ${payload.mainTemp} °C`
                                );
                            }
                        } else {
                            if (payload && payload.mainTemp !== null) {
                                successReasons.push(
                                    `${criteriaStrings.temperature} ${payload.mainTemp} °C`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'gtEqualTo'
                    ) {
                        if (
                            !(
                                con.criteria[i] &&
                                con.criteria[i].field1 &&
                                payload &&
                                payload.mainTemp &&
                                payload.mainTemp >= con.criteria[i].field1
                            )
                        ) {
                            validity = false;
                            if (payload && payload.mainTemp !== null) {
                                failedReasons.push(
                                    `${criteriaStrings.temperature} ${payload.mainTemp} °C`
                                );
                            }
                        } else {
                            if (payload && payload.mainTemp !== null) {
                                successReasons.push(
                                    `${criteriaStrings.temperature} ${payload.mainTemp} °C`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'ltEqualTo'
                    ) {
                        if (
                            !(
                                con.criteria[i] &&
                                con.criteria[i].field1 &&
                                payload &&
                                payload.mainTemp &&
                                payload.mainTemp <= con.criteria[i].field1
                            )
                        ) {
                            validity = false;
                            if (payload && payload.mainTemp !== null) {
                                failedReasons.push(
                                    `${criteriaStrings.temperature} ${payload.mainTemp} °C`
                                );
                            }
                        } else {
                            if (payload && payload.mainTemp !== null) {
                                successReasons.push(
                                    `${criteriaStrings.temperature} ${payload.mainTemp} °C`
                                );
                            }
                        }
                    }
                } else if (
                    con.criteria[i] &&
                    con.criteria[i].responseType === 'responseBody'
                ) {
                    if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'contains'
                    ) {
                        if (body && typeof body === 'string') {
                            if (
                                !(
                                    con.criteria[i] &&
                                    con.criteria[i].field1 &&
                                    body &&
                                    // @ts-expect-error ts-migrate(2345) FIXME: Argument of type 'any[]' is not assignable to para... Remove this comment to see the full error message
                                    body.includes([con.criteria[i].field1])
                                )
                            ) {
                                validity = false;
                                failedReasons.push(
                                    `${criteriaStrings.responseBody} did not contain ${con.criteria[i].field1}`
                                );
                            } else {
                                successReasons.push(
                                    `${criteriaStrings.responseBody} contains ${con.criteria[i].field1}`
                                );
                            }
                        } else {
                            if (
                                !(
                                    con.criteria[i] &&
                                    con.criteria[i].field1 &&
                                    body &&
                                    body[con.criteria[i].field1]
                                )
                            ) {
                                validity = false;
                                failedReasons.push(
                                    `${criteriaStrings.responseBody} did not contain ${con.criteria[i].field1}`
                                );
                            } else {
                                successReasons.push(
                                    `${criteriaStrings.responseBody} contains ${con.criteria[i].field1}`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'doesNotContain'
                    ) {
                        if (body && typeof body === 'string') {
                            if (
                                !(
                                    con.criteria[i] &&
                                    con.criteria[i].field1 &&
                                    body &&
                                    // @ts-expect-error ts-migrate(2345) FIXME: Argument of type 'any[]' is not assignable to para... Remove this comment to see the full error message
                                    !body.includes([con.criteria[i].field1])
                                )
                            ) {
                                validity = false;
                                failedReasons.push(
                                    `${criteriaStrings.responseBody} contains ${con.criteria[i].field1}`
                                );
                            } else {
                                successReasons.push(
                                    `${criteriaStrings.responseBody} did not contain ${con.criteria[i].field1}`
                                );
                            }
                        } else {
                            if (
                                !(
                                    con.criteria[i] &&
                                    con.criteria[i].field1 &&
                                    body &&
                                    !body[con.criteria[i].field1]
                                )
                            ) {
                                validity = false;
                                failedReasons.push(
                                    `${criteriaStrings.responseBody} contains ${con.criteria[i].field1}`
                                );
                            } else {
                                successReasons.push(
                                    `${criteriaStrings.responseBody} did not contain ${con.criteria[i].field1}`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'jsExpression'
                    ) {
                        const ctx = Object.create(null); // fix against prototype vulnerability
                        ctx.request = { body };
                        const output = vm.runInNewContext(
                            con.criteria[i].field1,
                            ctx
                        );
                        if (
                            !(
                                con.criteria[i] &&
                                con.criteria[i].field1 &&
                                body &&
                                output
                            )
                        ) {
                            validity = false;
                            failedReasons.push(
                                `${criteriaStrings.responseBody} did not have Javascript expression \`${con.criteria[i].field1}\``
                            );
                        } else {
                            successReasons.push(
                                `${criteriaStrings.responseBody} did have Javascript expression \`${con.criteria[i].field1}\``
                            );
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'empty'
                    ) {
                        if (
                            !(
                                con.criteria[i] &&
                                con.criteria[i].filter &&
                                body &&
                                _.isEmpty(body)
                            )
                        ) {
                            validity = false;
                            failedReasons.push(
                                `${criteriaStrings.responseBody} was not empty`
                            );
                        } else {
                            successReasons.push(
                                `${criteriaStrings.responseBody} was empty`
                            );
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'notEmpty'
                    ) {
                        if (
                            !(
                                con.criteria[i] &&
                                con.criteria[i].filter &&
                                body &&
                                !_.isEmpty(body)
                            )
                        ) {
                            validity = false;
                            failedReasons.push(
                                `${criteriaStrings.responseBody} was empty`
                            );
                        } else {
                            successReasons.push(
                                `${criteriaStrings.responseBody} was not empty`
                            );
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'evaluateResponse'
                    ) {
                        const responseDisplay = con.criteria[i].field1
                            ? con.criteria[i].field1.includes(
                                  'response.body'
                              ) &&
                              con.criteria[i].field1.includes(
                                  'response.headers'
                              )
                                ? {
                                      headers: response.headers,
                                      body: response.body,
                                  }
                                : con.criteria[i].field1.includes(
                                      'response.headers'
                                  )
                                ? response.headers
                                : con.criteria[i].field1.includes(
                                      'response.body'
                                  )
                                ? response.body
                                : response
                            : response;
                        try {
                            if (
                                !(
                                    con.criteria[i] &&
                                    con.criteria[i].field1 &&
                                    response &&
                                    Function(
                                        '"use strict";const response = ' +
                                            JSON.stringify(response) +
                                            ';return (' +
                                            con.criteria[i].field1 +
                                            ');'
                                    )()
                                )
                            ) {
                                validity = false;
                                failedReasons.push(
                                    `${
                                        criteriaStrings.response
                                    } \`${JSON.stringify(
                                        responseDisplay
                                    )}\` did evaluate \`${
                                        con.criteria[i].field1
                                    }\``
                                );
                            } else {
                                successReasons.push(
                                    `${
                                        criteriaStrings.response
                                    } \`${JSON.stringify(
                                        responseDisplay
                                    )}\` did evaluate \`${
                                        con.criteria[i].field1
                                    }\``
                                );
                            }
                        } catch (e) {
                            validity = false;
                            failedReasons.push(
                                `${criteriaStrings.response} \`${JSON.stringify(
                                    responseDisplay
                                )}\` caused an error`
                            );
                        }
                    }
                } else if (
                    con.criteria[i] &&
                    con.criteria[i].responseType === 'queryString'
                ) {
                    if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'contains'
                    ) {
                        if (
                            !(
                                con.criteria[i] &&
                                con.criteria[i].field1 &&
                                queryParams &&
                                queryParams.includes(
                                    con.criteria[i].field1.toLowerCase()
                                )
                            )
                        ) {
                            validity = false;
                            failedReasons.push(
                                `${criteriaStrings.responseBody} did not contain ${con.criteria[i].field1}`
                            );
                        } else {
                            successReasons.push(
                                `${criteriaStrings.responseBody} contains ${con.criteria[i].field1}`
                            );
                        }
                    }
                } else if (
                    con.criteria[i] &&
                    con.criteria[i].responseType === 'headers'
                ) {
                    if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'contains'
                    ) {
                        if (
                            !(
                                con.criteria[i] &&
                                con.criteria[i].field1 &&
                                headers &&
                                headers.includes(
                                    con.criteria[i].field1.toLowerCase()
                                )
                            )
                        ) {
                            validity = false;
                            failedReasons.push(
                                `${criteriaStrings.responseBody} did not contain ${con.criteria[i].field1}`
                            );
                        } else {
                            successReasons.push(
                                `${criteriaStrings.responseBody} contains ${con.criteria[i].field1}`
                            );
                        }
                    }
                } else if (
                    con.criteria[i] &&
                    con.criteria[i].responseType === 'podStatus'
                ) {
                    const healthyPods = ['running', 'pending', 'succeeded'];
                    if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'equalTo'
                    ) {
                        if (
                            !payload.podData.allPods ||
                            payload.podData.allPods.length === 0
                        ) {
                            validity = false;
                            failedReasons.push('Pod is not available');
                        } else {
                            // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'pod' implicitly has an 'any' type.
                            // eslint-disable-next-line no-loop-func
                            payload.podData.allPods.forEach(pod => {
                                if (
                                    con.criteria[i] &&
                                    con.criteria[i].field1 &&
                                    pod.podStatus &&
                                    pod.podStatus.toLowerCase() ===
                                        con.criteria[i].field1.toLowerCase()
                                ) {
                                    successReasons.push(
                                        `${pod.podName} pod status is ${pod.podStatus}`
                                    );
                                } else {
                                    validity = false;
                                    if (
                                        !healthyPods.includes(
                                            pod.podStatus.toLowerCase()
                                        )
                                    ) {
                                        failedReasons.push(
                                            `${pod.podName} pod status is ${pod.podStatus}`
                                        );
                                    }
                                }
                            });
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'notEqualTo'
                    ) {
                        if (
                            !payload.podData.allPods ||
                            payload.podData.allPods.length === 0
                        ) {
                            validity = false;
                            failedReasons.push('Pod is not available');
                        } else {
                            // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'pod' implicitly has an 'any' type.
                            // eslint-disable-next-line no-loop-func
                            payload.podData.allPods.forEach(pod => {
                                if (
                                    con.criteria[i] &&
                                    con.criteria[i].field1 &&
                                    pod.podStatus &&
                                    pod.podStatus.toLowerCase() !==
                                        con.criteria[i].field1.toLowerCase()
                                ) {
                                    successReasons.push(
                                        `${pod.podName} pod status is ${pod.podStatus}`
                                    );
                                } else {
                                    validity = false;
                                    if (
                                        !healthyPods.includes(
                                            pod.podStatus.toLowerCase()
                                        )
                                    ) {
                                        failedReasons.push(
                                            `${pod.podName} pod status is ${pod.podStatus}`
                                        );
                                    }
                                }
                            });
                        }
                    }
                } else if (
                    con.criteria[i] &&
                    con.criteria[i].responseType === 'jobStatus'
                ) {
                    const healthyJobs = ['running', 'succeeded'];
                    if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'equalTo'
                    ) {
                        if (
                            !payload.jobData.allJobs ||
                            payload.jobData.allJobs.length === 0
                        ) {
                            validity = false;
                            failedReasons.push('Job is not available');
                        } else {
                            // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'job' implicitly has an 'any' type.
                            // eslint-disable-next-line no-loop-func
                            payload.jobData.allJobs.forEach(job => {
                                if (
                                    con.criteria[i] &&
                                    con.criteria[i].field1 &&
                                    job.jobStatus &&
                                    job.jobStatus.toLowerCase() ===
                                        con.criteria[i].field1.toLowerCase()
                                ) {
                                    successReasons.push(
                                        `${job.jobName} job status is ${job.jobStatus}`
                                    );
                                } else {
                                    validity = false;
                                    if (
                                        !healthyJobs.includes(
                                            job.jobStatus.toLowerCase()
                                        )
                                    ) {
                                        failedReasons.push(
                                            `${job.jobName} job status is ${job.jobStatus}`
                                        );
                                    }
                                }
                            });
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'notEqualTo'
                    ) {
                        if (
                            !payload.jobData.allJobs ||
                            payload.jobData.allJobs.length === 0
                        ) {
                            validity = false;
                            failedReasons.push('Job is not available');
                        } else {
                            // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'job' implicitly has an 'any' type.
                            // eslint-disable-next-line no-loop-func
                            payload.jobData.allJobs.forEach(job => {
                                if (
                                    con.criteria[i] &&
                                    con.criteria[i].field1 &&
                                    job.jobStatus &&
                                    job.jobStatus.toLowerCase() !==
                                        con.criteria[i].field1.toLowerCase()
                                ) {
                                    successReasons.push(
                                        `${job.jobName} job status is ${job.jobStatus}`
                                    );
                                } else {
                                    validity = false;
                                    if (
                                        !healthyJobs.includes(
                                            job.jobStatus.toLowerCase()
                                        )
                                    ) {
                                        failedReasons.push(
                                            `${job.jobName} job status is ${job.jobStatus}`
                                        );
                                    }
                                }
                            });
                        }
                    }
                } else if (
                    con.criteria[i] &&
                    con.criteria[i].responseType === 'desiredDeployment'
                ) {
                    if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'equalTo'
                    ) {
                        if (
                            !payload.deploymentData.allDeployments ||
                            payload.deploymentData.allDeployments.length === 0
                        ) {
                            validity = false;
                            failedReasons.push('Deployment is not available');
                        } else {
                            payload.deploymentData.allDeployments.forEach(
                                // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'deployment' implicitly has an 'any' typ... Remove this comment to see the full error message
                                // eslint-disable-next-line no-loop-func
                                deployment => {
                                    if (
                                        deployment.desiredDeployment ===
                                        deployment.readyDeployment
                                    ) {
                                        successReasons.push(
                                            `${deployment.deploymentName} deployment state is (${deployment.readyDeployment}/${deployment.desiredDeployment})`
                                        );
                                    } else {
                                        validity = false;
                                        failedReasons.push(
                                            `${deployment.deploymentName} deployment state is (${deployment.readyDeployment}/${deployment.desiredDeployment})`
                                        );
                                    }
                                }
                            );
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'notEqualTo'
                    ) {
                        if (
                            !payload.deploymentData.allDeployments ||
                            payload.deploymentData.allDeployments.length === 0
                        ) {
                            validity = false;
                            failedReasons.push('Deployment is not available');
                        } else {
                            payload.deploymentData.allDeployments.forEach(
                                // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'deployment' implicitly has an 'any' typ... Remove this comment to see the full error message
                                // eslint-disable-next-line no-loop-func
                                deployment => {
                                    if (
                                        deployment.desiredDeployment !==
                                        deployment.readyDeployment
                                    ) {
                                        successReasons.push(
                                            `${deployment.deploymentName} deployment state is (${deployment.readyDeployment}/${deployment.desiredDeployment})`
                                        );
                                    } else {
                                        validity = false;
                                        failedReasons.push(
                                            `${deployment.deploymentName} deployment state is (${deployment.readyDeployment}/${deployment.desiredDeployment})`
                                        );
                                    }
                                }
                            );
                        }
                    }
                } else if (
                    con.criteria[i] &&
                    con.criteria[i].responseType === 'desiredStatefulset'
                ) {
                    if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'equalTo'
                    ) {
                        if (
                            !payload.statefulsetData.allStatefulset ||
                            payload.statefulsetData.allStatefulset.length === 0
                        ) {
                            validity = false;
                            failedReasons.push('Statefulset is not available');
                        } else {
                            payload.statefulsetData.allStatefulset.forEach(
                                // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'statefulset' implicitly has an 'any' ty... Remove this comment to see the full error message
                                // eslint-disable-next-line no-loop-func
                                statefulset => {
                                    if (
                                        statefulset.desiredStatefulsets ===
                                        statefulset.readyStatefulsets
                                    ) {
                                        successReasons.push(
                                            `${statefulset.statefulsetName} statefulset state is ${statefulset.readyStatefulsets}/${statefulset.desiredStatefulsets}`
                                        );
                                    } else {
                                        validity = false;
                                        failedReasons.push(
                                            `${statefulset.statefulsetName} statefulset state is ${statefulset.readyStatefulsets}/${statefulset.desiredStatefulsets}`
                                        );
                                    }
                                }
                            );
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'notEqualTo'
                    ) {
                        if (
                            !payload.statefulsetData.allStatefulset ||
                            payload.statefulsetData.allStatefulset.length === 0
                        ) {
                            validity = false;
                            failedReasons.push('Statefulset is not available');
                        } else {
                            payload.statefulsetData.allStatefulset.forEach(
                                // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'statefulset' implicitly has an 'any' ty... Remove this comment to see the full error message
                                // eslint-disable-next-line no-loop-func
                                statefulset => {
                                    if (
                                        statefulset.desiredStatefulsets !==
                                        statefulset.readyStatefulsets
                                    ) {
                                        successReasons.push(
                                            `${statefulset.statefulsetName} statefulset state is ${statefulset.readyStatefulsets}/${statefulset.desiredStatefulsets}`
                                        );
                                    } else {
                                        validity = false;
                                        failedReasons.push(
                                            `${statefulset.statefulsetName} statefulset state is ${statefulset.readyStatefulsets}/${statefulset.desiredStatefulsets}`
                                        );
                                    }
                                }
                            );
                        }
                    }
                } else if (
                    con.criteria[i] &&
                    con.criteria[i].responseType === 'respondsToPing'
                ) {
                    if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'isUp'
                    ) {
                        if (
                            !(
                                con.criteria[i] &&
                                con.criteria[i].filter &&
                                !(statusCode === 408 || statusCode === '408')
                            )
                        ) {
                            validity = false;
                            failedReasons.push(
                                // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
                                `${criteriaStrings[type] ||
                                    'Monitor was'} Offline`
                            );
                        } else {
                            successReasons.push(
                                // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
                                `${criteriaStrings[type] ||
                                    'Monitor was'} Online`
                            );
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'isDown'
                    ) {
                        if (
                            !(
                                con.criteria[i] &&
                                con.criteria[i].filter &&
                                (statusCode === 408 || statusCode === '408')
                            )
                        ) {
                            validity = false;
                            failedReasons.push(
                                // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
                                `${criteriaStrings[type] ||
                                    'Monitor was'} Online`
                            );
                        } else {
                            successReasons.push(
                                // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
                                `${criteriaStrings[type] ||
                                    'Monitor was'} Offline`
                            );
                        }
                    }
                }
            }
        }
    }
    return validity;
};

// @ts-expect-error ts-migrate(7024) FIXME: Function implicitly has return type 'any' because ... Remove this comment to see the full error message
const checkOr = (
    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'payload' implicitly has an 'any' type.
    payload,
    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'con' implicitly has an 'any' type.
    con,
    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'statusCode' implicitly has an 'any' typ... Remove this comment to see the full error message
    statusCode,
    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'body' implicitly has an 'any' type.
    body,
    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'ssl' implicitly has an 'any' type.
    ssl,
    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'response' implicitly has an 'any' type.
    response,
    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'successReasons' implicitly has an 'any'... Remove this comment to see the full error message
    successReasons,
    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'failedReasons' implicitly has an 'any' ... Remove this comment to see the full error message
    failedReasons,
    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'type' implicitly has an 'any' type.
    type,
    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'queryParams' implicitly has an 'any' ty... Remove this comment to see the full error message
    queryParams,
    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'headers' implicitly has an 'any' type.
    headers
) => {
    let validity = false;
    if (con && con.criteria && con.criteria.length > 0) {
        for (let i = 0; i < con.criteria.length; i++) {
            if (
                con.criteria[i].criteria &&
                con.criteria[i].criteria.length > 0
            ) {
                if (
                    con.criteria[i].condition &&
                    con.criteria[i].condition === 'or'
                ) {
                    // check or again
                    // @ts-expect-error ts-migrate(7022) FIXME: 'temp1' implicitly has type 'any' because it does ... Remove this comment to see the full error message
                    const temp1 = checkOr(
                        payload,
                        con.criteria[i],
                        statusCode,
                        body,
                        ssl,
                        response,
                        successReasons,
                        failedReasons,
                        type,
                        queryParams,
                        headers
                    );
                    if (temp1) {
                        validity = temp1;
                    }
                } else if (
                    con.criteria[i].condition &&
                    con.criteria[i].condition === 'and'
                ) {
                    // @ts-expect-error ts-migrate(7022) FIXME: 'temp' implicitly has type 'any' because it does n... Remove this comment to see the full error message
                    const temp = checkAnd(
                        payload,
                        con.criteria[i],
                        statusCode,
                        body,
                        ssl,
                        response,
                        successReasons,
                        failedReasons,
                        type,
                        queryParams,
                        headers
                    );
                    if (temp) {
                        validity = temp;
                    }
                }
            } else {
                let tempReason = `${payload} min`;
                if (
                    con.criteria[i] &&
                    con.criteria[i].responseType &&
                    con.criteria[i].responseType === 'incomingTime'
                ) {
                    let timeHours = 0;
                    let timeMinutes = payload;
                    if (timeMinutes > 60) {
                        timeHours = Math.floor(timeMinutes / 60);
                        timeMinutes = Math.floor(timeMinutes % 60);
                        tempReason = `${timeHours} hrs ${timeMinutes} min`;
                    }
                }
                if (
                    con.criteria[i] &&
                    con.criteria[i].responseType === 'responseTime'
                ) {
                    if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'greaterThan'
                    ) {
                        if (
                            con.criteria[i] &&
                            con.criteria[i].field1 &&
                            payload &&
                            payload > Number(con.criteria[i].field1)
                        ) {
                            validity = true;
                            successReasons.push(
                                `${criteriaStrings.responseTime} ${payload} ms`
                            );
                        } else {
                            failedReasons.push(
                                `${criteriaStrings.responseTime} ${payload} ms`
                            );
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'lessThan'
                    ) {
                        if (
                            con.criteria[i] &&
                            con.criteria[i].field1 &&
                            payload &&
                            payload < Number(con.criteria[i].field1)
                        ) {
                            validity = true;
                            successReasons.push(
                                `${criteriaStrings.responseTime} ${payload} ms`
                            );
                        } else {
                            failedReasons.push(
                                `${criteriaStrings.responseTime} ${payload} ms`
                            );
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'inBetween'
                    ) {
                        if (
                            con.criteria[i] &&
                            con.criteria[i].field1 &&
                            payload &&
                            con.criteria[i].field2 &&
                            payload > Number(con.criteria[i].field1) &&
                            payload < Number(con.criteria[i].field2)
                        ) {
                            validity = true;
                            successReasons.push(
                                `${criteriaStrings.responseTime} ${payload} ms`
                            );
                        } else {
                            failedReasons.push(
                                `${criteriaStrings.responseTime} ${payload} ms`
                            );
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'equalTo'
                    ) {
                        if (
                            con.criteria[i] &&
                            con.criteria[i].field1 &&
                            payload &&
                            payload === Number(con.criteria[i].field1)
                        ) {
                            validity = true;
                            successReasons.push(
                                `${criteriaStrings.responseTime} ${payload} ms`
                            );
                        } else {
                            failedReasons.push(
                                `${criteriaStrings.responseTime} ${payload} ms`
                            );
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'notEqualTo'
                    ) {
                        if (
                            con.criteria[i] &&
                            con.criteria[i].field1 &&
                            payload &&
                            payload !== Number(con.criteria[i].field1)
                        ) {
                            validity = true;
                            successReasons.push(
                                `${criteriaStrings.responseTime} ${payload} ms`
                            );
                        } else {
                            failedReasons.push(
                                `${criteriaStrings.responseTime} ${payload} ms`
                            );
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'gtEqualTo'
                    ) {
                        if (
                            con.criteria[i] &&
                            con.criteria[i].field1 &&
                            payload &&
                            payload >= Number(con.criteria[i].field1)
                        ) {
                            validity = true;
                            successReasons.push(
                                `${criteriaStrings.responseTime} ${payload} ms`
                            );
                        } else {
                            failedReasons.push(
                                `${criteriaStrings.responseTime} ${payload} ms`
                            );
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'ltEqualTo'
                    ) {
                        if (
                            con.criteria[i] &&
                            con.criteria[i].field1 &&
                            payload &&
                            payload <= Number(con.criteria[i].field1)
                        ) {
                            validity = true;
                            successReasons.push(
                                `${criteriaStrings.responseTime} ${payload} ms`
                            );
                        } else {
                            failedReasons.push(
                                `${criteriaStrings.responseTime} ${payload} ms`
                            );
                        }
                    }
                } else if (
                    con.criteria[i] &&
                    con.criteria[i].responseType === 'incomingTime'
                ) {
                    if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'greaterThan'
                    ) {
                        if (
                            con.criteria[i] &&
                            con.criteria[i].field1 &&
                            payload &&
                            payload > con.criteria[i].field1
                        ) {
                            validity = true;
                            successReasons.push(
                                `${criteriaStrings.incomingTime} ${tempReason}`
                            );
                        } else {
                            failedReasons.push(
                                `${criteriaStrings.incomingTime} ${tempReason}`
                            );
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'lessThan'
                    ) {
                        if (
                            con.criteria[i] &&
                            con.criteria[i].field1 &&
                            payload &&
                            payload < con.criteria[i].field1
                        ) {
                            validity = true;
                            successReasons.push(
                                `${criteriaStrings.incomingTime} ${tempReason}`
                            );
                        } else {
                            failedReasons.push(
                                `${criteriaStrings.incomingTime} ${tempReason}`
                            );
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'inBetween'
                    ) {
                        if (
                            con.criteria[i] &&
                            con.criteria[i].field1 &&
                            payload &&
                            con.criteria[i].field2 &&
                            payload > con.criteria[i].field1 &&
                            payload < con.criteria[i].field2
                        ) {
                            validity = true;
                            successReasons.push(
                                `${criteriaStrings.incomingTime} ${tempReason}`
                            );
                        } else {
                            failedReasons.push(
                                `${criteriaStrings.incomingTime} ${tempReason}`
                            );
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'equalTo'
                    ) {
                        if (
                            con.criteria[i] &&
                            con.criteria[i].field1 &&
                            payload &&
                            payload == con.criteria[i].field1
                        ) {
                            validity = true;
                            successReasons.push(
                                `${criteriaStrings.incomingTime} ${tempReason}`
                            );
                        } else {
                            failedReasons.push(
                                `${criteriaStrings.incomingTime} ${tempReason}`
                            );
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'notEqualTo'
                    ) {
                        if (
                            con.criteria[i] &&
                            con.criteria[i].field1 &&
                            payload &&
                            payload != con.criteria[i].field1
                        ) {
                            validity = true;
                            successReasons.push(
                                `${criteriaStrings.incomingTime} ${tempReason}`
                            );
                        } else {
                            failedReasons.push(
                                `${criteriaStrings.incomingTime} ${tempReason}`
                            );
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'gtEqualTo'
                    ) {
                        if (
                            con.criteria[i] &&
                            con.criteria[i].field1 &&
                            payload &&
                            payload >= con.criteria[i].field1
                        ) {
                            validity = true;
                            successReasons.push(
                                `${criteriaStrings.incomingTime} ${tempReason}`
                            );
                        } else {
                            failedReasons.push(
                                `${criteriaStrings.incomingTime} ${tempReason}`
                            );
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'ltEqualTo'
                    ) {
                        if (
                            con.criteria[i] &&
                            con.criteria[i].field1 &&
                            payload &&
                            payload <= con.criteria[i].field1
                        ) {
                            validity = true;
                            successReasons.push(
                                `${criteriaStrings.incomingTime} ${tempReason}`
                            );
                        } else {
                            failedReasons.push(
                                `${criteriaStrings.incomingTime} ${tempReason}`
                            );
                        }
                    }
                } else if (
                    con.criteria[i] &&
                    con.criteria[i].responseType === 'doesRespond'
                ) {
                    if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'isUp'
                    ) {
                        if (
                            con.criteria[i] &&
                            con.criteria[i].filter &&
                            !(
                                (statusCode === 408 || statusCode === '408') &&
                                body &&
                                body.code &&
                                body.code === 'ENOTFOUND'
                            )
                        ) {
                            validity = true;
                            successReasons.push(
                                // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
                                `${criteriaStrings[type] ||
                                    'Monitor was'} Online`
                            );
                        } else {
                            failedReasons.push(
                                // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
                                `${criteriaStrings[type] ||
                                    'Monitor was'} Offline`
                            );
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'isDown'
                    ) {
                        if (
                            con.criteria[i] &&
                            con.criteria[i].filter &&
                            (statusCode === 408 || statusCode === '408') &&
                            body &&
                            body.code &&
                            body.code === 'ENOTFOUND'
                        ) {
                            validity = true;
                            successReasons.push(
                                // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
                                `${criteriaStrings[type] ||
                                    'Monitor was'} Offline`
                            );
                        } else {
                            failedReasons.push(
                                // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
                                `${criteriaStrings[type] ||
                                    'Monitor was'} Online`
                            );
                        }
                    }
                } else if (
                    con.criteria[i] &&
                    con.criteria[i].responseType === 'ssl'
                ) {
                    const expiresIn = moment(
                        new Date(
                            ssl && ssl.expires ? ssl.expires : Date.now()
                        ).getTime()
                    ).diff(Date.now(), 'days');
                    if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'isValid'
                    ) {
                        if (ssl && !ssl.selfSigned) {
                            validity = true;
                            successReasons.push(
                                `${criteriaStrings.sslCertificate} was valid`
                            );
                        } else {
                            failedReasons.push(
                                `${criteriaStrings.sslCertificate} was not valid`
                            );
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'notFound'
                    ) {
                        if (!ssl) {
                            validity = true;
                            successReasons.push(
                                `${criteriaStrings.sslCertificate} was not present`
                            );
                        } else {
                            failedReasons.push(
                                `${criteriaStrings.sslCertificate} was present`
                            );
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'selfSigned'
                    ) {
                        if (ssl && ssl.selfSigned) {
                            validity = true;
                            successReasons.push(
                                `${criteriaStrings.sslCertificate} was Self-Signed`
                            );
                        } else {
                            failedReasons.push(
                                `${criteriaStrings.sslCertificate} was not Self-Signed`
                            );
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'expiresIn30'
                    ) {
                        if (ssl && !ssl.selfSigned && expiresIn < 30) {
                            validity = true;
                            if (expiresIn) {
                                successReasons.push(
                                    `${criteriaStrings.sslCertificate} expires in ${expiresIn} days`
                                );
                            }
                        } else {
                            if (expiresIn) {
                                failedReasons.push(
                                    `${criteriaStrings.sslCertificate} expires in ${expiresIn} days`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'expiresIn10'
                    ) {
                        if (ssl && !ssl.selfSigned && expiresIn < 10) {
                            validity = true;
                            if (expiresIn) {
                                successReasons.push(
                                    `${criteriaStrings.sslCertificate} expires in ${expiresIn} days`
                                );
                            }
                        } else {
                            if (expiresIn) {
                                failedReasons.push(
                                    `${criteriaStrings.sslCertificate} expires in ${expiresIn} days`
                                );
                            }
                        }
                    }
                } else if (
                    con.criteria[i] &&
                    con.criteria[i].responseType === 'statusCode'
                ) {
                    if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'greaterThan'
                    ) {
                        if (
                            con.criteria[i] &&
                            con.criteria[i].field1 &&
                            statusCode &&
                            statusCode > con.criteria[i].field1
                        ) {
                            validity = true;
                            if (statusCode === 408 || statusCode === '408') {
                                successReasons.push('Request Timed out');
                            } else {
                                successReasons.push(
                                    `${criteriaStrings.statusCode} ${statusCode}`
                                );
                            }
                        } else {
                            if (statusCode === 408 || statusCode === '408') {
                                failedReasons.push('Request Timed out');
                            } else {
                                failedReasons.push(
                                    `${criteriaStrings.statusCode} ${statusCode}`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'lessThan'
                    ) {
                        if (
                            con.criteria[i] &&
                            con.criteria[i].field1 &&
                            statusCode &&
                            statusCode < con.criteria[i].field1
                        ) {
                            validity = true;
                            if (statusCode === 408 || statusCode === '408') {
                                successReasons.push('Request Timed out');
                            } else {
                                successReasons.push(
                                    `${criteriaStrings.statusCode} ${statusCode}`
                                );
                            }
                        } else {
                            if (statusCode === 408 || statusCode === '408') {
                                failedReasons.push('Request Timed out');
                            } else {
                                failedReasons.push(
                                    `${criteriaStrings.statusCode} ${statusCode}`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'inBetween'
                    ) {
                        if (
                            con.criteria[i] &&
                            con.criteria[i].field1 &&
                            statusCode &&
                            con.criteria[i].field2 &&
                            statusCode > con.criteria[i].field1 &&
                            statusCode < con.criteria[i].field2
                        ) {
                            validity = true;
                            if (statusCode === 408 || statusCode === '408') {
                                successReasons.push('Request Timed out');
                            } else {
                                successReasons.push(
                                    `${criteriaStrings.statusCode} ${statusCode}`
                                );
                            }
                        } else {
                            if (statusCode === 408 || statusCode === '408') {
                                failedReasons.push('Request Timed out');
                            } else {
                                failedReasons.push(
                                    `${criteriaStrings.statusCode} ${statusCode}`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'equalTo'
                    ) {
                        if (
                            con.criteria[i] &&
                            con.criteria[i].field1 &&
                            statusCode &&
                            statusCode == con.criteria[i].field1
                        ) {
                            validity = true;
                            if (statusCode === 408 || statusCode === '408') {
                                successReasons.push('Request Timed out');
                            } else {
                                successReasons.push(
                                    `${criteriaStrings.statusCode} ${statusCode}`
                                );
                            }
                        } else {
                            if (statusCode === 408 || statusCode === '408') {
                                failedReasons.push('Request Timed out');
                            } else {
                                failedReasons.push(
                                    `${criteriaStrings.statusCode} ${statusCode}`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'notEqualTo'
                    ) {
                        if (
                            con.criteria[i] &&
                            con.criteria[i].field1 &&
                            statusCode &&
                            statusCode != con.criteria[i].field1
                        ) {
                            validity = true;
                            if (statusCode === 408 || statusCode === '408') {
                                successReasons.push('Request Timed out');
                            } else {
                                successReasons.push(
                                    `${criteriaStrings.statusCode} ${statusCode}`
                                );
                            }
                        } else {
                            if (statusCode === 408 || statusCode === '408') {
                                failedReasons.push('Request Timed out');
                            } else {
                                failedReasons.push(
                                    `${criteriaStrings.statusCode} ${statusCode}`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'gtEqualTo'
                    ) {
                        if (
                            con.criteria[i] &&
                            con.criteria[i].field1 &&
                            statusCode &&
                            statusCode >= con.criteria[i].field1
                        ) {
                            validity = true;
                            if (statusCode === 408 || statusCode === '408') {
                                successReasons.push('Request Timed out');
                            } else {
                                successReasons.push(
                                    `${criteriaStrings.statusCode} ${statusCode}`
                                );
                            }
                        } else {
                            if (statusCode === 408 || statusCode === '408') {
                                failedReasons.push('Request Timed out');
                            } else {
                                failedReasons.push(
                                    `${criteriaStrings.statusCode} ${statusCode}`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'ltEqualTo'
                    ) {
                        if (
                            con.criteria[i] &&
                            con.criteria[i].field1 &&
                            statusCode &&
                            statusCode <= con.criteria[i].field1
                        ) {
                            validity = true;
                            if (statusCode === 408 || statusCode === '408') {
                                successReasons.push('Request Timed out');
                            } else {
                                successReasons.push(
                                    `${criteriaStrings.statusCode} ${statusCode}`
                                );
                            }
                        } else {
                            if (statusCode === 408 || statusCode === '408') {
                                failedReasons.push('Request Timed out');
                            } else {
                                failedReasons.push(
                                    `${criteriaStrings.statusCode} ${statusCode}`
                                );
                            }
                        }
                    }
                } else if (
                    con.criteria[i] &&
                    con.criteria[i].responseType === 'cpuLoad'
                ) {
                    if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'greaterThan'
                    ) {
                        if (
                            con.criteria[i] &&
                            con.criteria[i].field1 &&
                            payload &&
                            payload.cpuLoad &&
                            payload.cpuLoad > con.criteria[i].field1
                        ) {
                            validity = true;
                            if (payload && payload.cpuLoad !== null) {
                                successReasons.push(
                                    // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
                                    `${criteriaStrings.cpuLoad} ${formatDecimal(
                                        payload.cpuLoad,
                                        2
                                    )} %`
                                );
                            }
                        } else {
                            if (payload && payload.cpuLoad !== null) {
                                failedReasons.push(
                                    // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
                                    `${criteriaStrings.cpuLoad} ${formatDecimal(
                                        payload.cpuLoad,
                                        2
                                    )} %`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'lessThan'
                    ) {
                        if (
                            con.criteria[i] &&
                            con.criteria[i].field1 &&
                            payload &&
                            payload.cpuLoad &&
                            payload.cpuLoad < con.criteria[i].field1
                        ) {
                            validity = true;
                            if (payload && payload.cpuLoad !== null) {
                                successReasons.push(
                                    // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
                                    `${criteriaStrings.cpuLoad} ${formatDecimal(
                                        payload.cpuLoad,
                                        2
                                    )} %`
                                );
                            }
                        } else {
                            if (payload && payload.cpuLoad !== null) {
                                failedReasons.push(
                                    // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
                                    `${criteriaStrings.cpuLoad} ${formatDecimal(
                                        payload.cpuLoad,
                                        2
                                    )} %`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'inBetween'
                    ) {
                        if (
                            con.criteria[i] &&
                            con.criteria[i].field1 &&
                            payload &&
                            payload.cpuLoad &&
                            con.criteria[i].field2 &&
                            payload.cpuLoad > con.criteria[i].field1 &&
                            payload.cpuLoad < con.criteria[i].field2
                        ) {
                            validity = true;
                            if (payload && payload.cpuLoad !== null) {
                                successReasons.push(
                                    // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
                                    `${criteriaStrings.cpuLoad} ${formatDecimal(
                                        payload.cpuLoad,
                                        2
                                    )} %`
                                );
                            }
                        } else {
                            if (payload && payload.cpuLoad !== null) {
                                failedReasons.push(
                                    // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
                                    `${criteriaStrings.cpuLoad} ${formatDecimal(
                                        payload.cpuLoad,
                                        2
                                    )} %`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'equalTo'
                    ) {
                        if (
                            con.criteria[i] &&
                            con.criteria[i].field1 &&
                            payload &&
                            payload.cpuLoad &&
                            payload.cpuLoad == con.criteria[i].field1
                        ) {
                            validity = true;
                            if (payload && payload.cpuLoad !== null) {
                                successReasons.push(
                                    // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
                                    `${criteriaStrings.cpuLoad} ${formatDecimal(
                                        payload.cpuLoad,
                                        2
                                    )} %`
                                );
                            }
                        } else {
                            if (payload && payload.cpuLoad !== null) {
                                failedReasons.push(
                                    // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
                                    `${criteriaStrings.cpuLoad} ${formatDecimal(
                                        payload.cpuLoad,
                                        2
                                    )} %`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'notEqualTo'
                    ) {
                        if (
                            con.criteria[i] &&
                            con.criteria[i].field1 &&
                            payload &&
                            payload.cpuLoad &&
                            payload.cpuLoad != con.criteria[i].field1
                        ) {
                            validity = true;
                            if (payload && payload.cpuLoad !== null) {
                                successReasons.push(
                                    // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
                                    `${criteriaStrings.cpuLoad} ${formatDecimal(
                                        payload.cpuLoad,
                                        2
                                    )} %`
                                );
                            }
                        } else {
                            if (payload && payload.cpuLoad !== null) {
                                failedReasons.push(
                                    // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
                                    `${criteriaStrings.cpuLoad} ${formatDecimal(
                                        payload.cpuLoad,
                                        2
                                    )} %`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'gtEqualTo'
                    ) {
                        if (
                            con.criteria[i] &&
                            con.criteria[i].field1 &&
                            payload &&
                            payload.cpuLoad &&
                            payload.cpuLoad >= con.criteria[i].field1
                        ) {
                            validity = true;
                            if (payload && payload.cpuLoad !== null) {
                                successReasons.push(
                                    // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
                                    `${criteriaStrings.cpuLoad} ${formatDecimal(
                                        payload.cpuLoad,
                                        2
                                    )} %`
                                );
                            }
                        } else {
                            if (payload && payload.cpuLoad !== null) {
                                failedReasons.push(
                                    // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
                                    `${criteriaStrings.cpuLoad} ${formatDecimal(
                                        payload.cpuLoad,
                                        2
                                    )} %`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'ltEqualTo'
                    ) {
                        if (
                            con.criteria[i] &&
                            con.criteria[i].field1 &&
                            payload &&
                            payload.cpuLoad &&
                            payload.cpuLoad <= con.criteria[i].field1
                        ) {
                            validity = true;
                            if (payload && payload.cpuLoad !== null) {
                                successReasons.push(
                                    // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
                                    `${criteriaStrings.cpuLoad} ${formatDecimal(
                                        payload.cpuLoad,
                                        2
                                    )} %`
                                );
                            }
                        } else {
                            if (payload && payload.cpuLoad !== null) {
                                failedReasons.push(
                                    // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
                                    `${criteriaStrings.cpuLoad} ${formatDecimal(
                                        payload.cpuLoad,
                                        2
                                    )} %`
                                );
                            }
                        }
                    }
                } else if (
                    con.criteria[i] &&
                    con.criteria[i].responseType === 'memoryUsage'
                ) {
                    const memoryUsedBytes = payload
                        ? parseInt(payload.memoryUsed || 0)
                        : 0;
                    const memoryUsed = memoryUsedBytes / Math.pow(1e3, 3);
                    if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'greaterThan'
                    ) {
                        if (
                            con.criteria[i] &&
                            con.criteria[i].field1 &&
                            memoryUsed &&
                            memoryUsed > con.criteria[i].field1
                        ) {
                            validity = true;
                            if (payload && payload.memoryUsed !== null) {
                                successReasons.push(
                                    `${
                                        criteriaStrings.memoryUsed
                                        // @ts-expect-error ts-migrate(2554) FIXME: Expected 5 arguments, but got 1.
                                    } ${formatBytes(memoryUsedBytes)}`
                                );
                            }
                        } else {
                            if (payload && payload.memoryUsed !== null) {
                                failedReasons.push(
                                    `${
                                        criteriaStrings.memoryUsed
                                        // @ts-expect-error ts-migrate(2554) FIXME: Expected 5 arguments, but got 1.
                                    } ${formatBytes(memoryUsedBytes)}`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'lessThan'
                    ) {
                        if (
                            con.criteria[i] &&
                            con.criteria[i].field1 &&
                            memoryUsed &&
                            memoryUsed < con.criteria[i].field1
                        ) {
                            validity = true;
                            if (payload && payload.memoryUsed !== null) {
                                successReasons.push(
                                    `${
                                        criteriaStrings.memoryUsed
                                        // @ts-expect-error ts-migrate(2554) FIXME: Expected 5 arguments, but got 1.
                                    } ${formatBytes(memoryUsedBytes)}`
                                );
                            }
                        } else {
                            if (payload && payload.memoryUsed !== null) {
                                failedReasons.push(
                                    `${
                                        criteriaStrings.memoryUsed
                                        // @ts-expect-error ts-migrate(2554) FIXME: Expected 5 arguments, but got 1.
                                    } ${formatBytes(memoryUsedBytes)}`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'inBetween'
                    ) {
                        if (
                            con.criteria[i] &&
                            con.criteria[i].field1 &&
                            memoryUsed &&
                            con.criteria[i].field2 &&
                            memoryUsed > con.criteria[i].field1 &&
                            memoryUsed < con.criteria[i].field2
                        ) {
                            validity = true;
                            if (payload && payload.memoryUsed !== null) {
                                successReasons.push(
                                    `${
                                        criteriaStrings.memoryUsed
                                        // @ts-expect-error ts-migrate(2554) FIXME: Expected 5 arguments, but got 1.
                                    } ${formatBytes(memoryUsedBytes)}`
                                );
                            }
                        } else {
                            if (payload && payload.memoryUsed !== null) {
                                failedReasons.push(
                                    `${
                                        criteriaStrings.memoryUsed
                                        // @ts-expect-error ts-migrate(2554) FIXME: Expected 5 arguments, but got 1.
                                    } ${formatBytes(memoryUsedBytes)}`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'equalTo'
                    ) {
                        if (
                            con.criteria[i] &&
                            con.criteria[i].field1 &&
                            memoryUsed &&
                            memoryUsed == con.criteria[i].field1
                        ) {
                            validity = true;
                            if (payload && payload.memoryUsed !== null) {
                                successReasons.push(
                                    `${
                                        criteriaStrings.memoryUsed
                                        // @ts-expect-error ts-migrate(2554) FIXME: Expected 5 arguments, but got 1.
                                    } ${formatBytes(memoryUsedBytes)}`
                                );
                            }
                        } else {
                            if (payload && payload.memoryUsed !== null) {
                                failedReasons.push(
                                    `${
                                        criteriaStrings.memoryUsed
                                        // @ts-expect-error ts-migrate(2554) FIXME: Expected 5 arguments, but got 1.
                                    } ${formatBytes(memoryUsedBytes)}`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'notEqualTo'
                    ) {
                        if (
                            con.criteria[i] &&
                            con.criteria[i].field1 &&
                            memoryUsed &&
                            memoryUsed != con.criteria[i].field1
                        ) {
                            validity = true;
                            if (payload && payload.memoryUsed !== null) {
                                successReasons.push(
                                    `${
                                        criteriaStrings.memoryUsed
                                        // @ts-expect-error ts-migrate(2554) FIXME: Expected 5 arguments, but got 1.
                                    } ${formatBytes(memoryUsedBytes)}`
                                );
                            }
                        } else {
                            if (payload && payload.memoryUsed !== null) {
                                failedReasons.push(
                                    `${
                                        criteriaStrings.memoryUsed
                                        // @ts-expect-error ts-migrate(2554) FIXME: Expected 5 arguments, but got 1.
                                    } ${formatBytes(memoryUsedBytes)}`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'gtEqualTo'
                    ) {
                        if (
                            con.criteria[i] &&
                            con.criteria[i].field1 &&
                            memoryUsed &&
                            memoryUsed >= con.criteria[i].field1
                        ) {
                            validity = true;
                            if (payload && payload.memoryUsed !== null) {
                                successReasons.push(
                                    `${
                                        criteriaStrings.memoryUsed
                                        // @ts-expect-error ts-migrate(2554) FIXME: Expected 5 arguments, but got 1.
                                    } ${formatBytes(memoryUsedBytes)}`
                                );
                            }
                        } else {
                            if (payload && payload.memoryUsed !== null) {
                                failedReasons.push(
                                    `${
                                        criteriaStrings.memoryUsed
                                        // @ts-expect-error ts-migrate(2554) FIXME: Expected 5 arguments, but got 1.
                                    } ${formatBytes(memoryUsedBytes)}`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'ltEqualTo'
                    ) {
                        if (
                            con.criteria[i] &&
                            con.criteria[i].field1 &&
                            memoryUsed &&
                            memoryUsed <= con.criteria[i].field1
                        ) {
                            validity = true;
                            if (payload && payload.memoryUsed !== null) {
                                successReasons.push(
                                    `${
                                        criteriaStrings.memoryUsed
                                        // @ts-expect-error ts-migrate(2554) FIXME: Expected 5 arguments, but got 1.
                                    } ${formatBytes(memoryUsedBytes)}`
                                );
                            }
                        } else {
                            if (payload && payload.memoryUsed !== null) {
                                failedReasons.push(
                                    `${
                                        criteriaStrings.memoryUsed
                                        // @ts-expect-error ts-migrate(2554) FIXME: Expected 5 arguments, but got 1.
                                    } ${formatBytes(memoryUsedBytes)}`
                                );
                            }
                        }
                    }
                } else if (
                    con.criteria[i] &&
                    con.criteria[i].responseType === 'storageUsage'
                ) {
                    const size = payload
                        ? parseInt(payload.totalStorage || 0)
                        : 0;
                    const used = payload
                        ? parseInt(payload.storageUsed || 0)
                        : 0;
                    const freeBytes = size - used;
                    const free = freeBytes / Math.pow(1e3, 3);
                    if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'greaterThan'
                    ) {
                        if (
                            con.criteria[i] &&
                            con.criteria[i].field1 &&
                            free > con.criteria[i].field1
                        ) {
                            validity = true;
                            if (
                                payload &&
                                payload.totalStorage !== null &&
                                payload.storageUsed !== null
                            ) {
                                successReasons.push(
                                    `${
                                        criteriaStrings.freeStorage
                                        // @ts-expect-error ts-migrate(2554) FIXME: Expected 5 arguments, but got 1.
                                    } ${formatBytes(freeBytes)}`
                                );
                            }
                        } else {
                            if (
                                payload &&
                                payload.totalStorage !== null &&
                                payload.storageUsed !== null
                            ) {
                                failedReasons.push(
                                    `${
                                        criteriaStrings.freeStorage
                                        // @ts-expect-error ts-migrate(2554) FIXME: Expected 5 arguments, but got 1.
                                    } ${formatBytes(freeBytes)}`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'lessThan'
                    ) {
                        if (
                            con.criteria[i] &&
                            con.criteria[i].field1 &&
                            free < con.criteria[i].field1
                        ) {
                            validity = true;
                            if (
                                payload &&
                                payload.totalStorage !== null &&
                                payload.storageUsed !== null
                            ) {
                                successReasons.push(
                                    `${
                                        criteriaStrings.freeStorage
                                        // @ts-expect-error ts-migrate(2554) FIXME: Expected 5 arguments, but got 1.
                                    } ${formatBytes(freeBytes)}`
                                );
                            }
                        } else {
                            if (
                                payload &&
                                payload.totalStorage !== null &&
                                payload.storageUsed !== null
                            ) {
                                failedReasons.push(
                                    `${
                                        criteriaStrings.freeStorage
                                        // @ts-expect-error ts-migrate(2554) FIXME: Expected 5 arguments, but got 1.
                                    } ${formatBytes(freeBytes)}`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'inBetween'
                    ) {
                        if (
                            con.criteria[i] &&
                            con.criteria[i].field1 &&
                            con.criteria[i].field2 &&
                            free > con.criteria[i].field1 &&
                            free < con.criteria[i].field2
                        ) {
                            validity = true;
                            if (
                                payload &&
                                payload.totalStorage !== null &&
                                payload.storageUsed !== null
                            ) {
                                successReasons.push(
                                    `${
                                        criteriaStrings.freeStorage
                                        // @ts-expect-error ts-migrate(2554) FIXME: Expected 5 arguments, but got 1.
                                    } ${formatBytes(freeBytes)}`
                                );
                            }
                        } else {
                            if (
                                payload &&
                                payload.totalStorage !== null &&
                                payload.storageUsed !== null
                            ) {
                                failedReasons.push(
                                    `${
                                        criteriaStrings.freeStorage
                                        // @ts-expect-error ts-migrate(2554) FIXME: Expected 5 arguments, but got 1.
                                    } ${formatBytes(freeBytes)}`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'equalTo'
                    ) {
                        if (
                            con.criteria[i] &&
                            con.criteria[i].field1 &&
                            free === con.criteria[i].field1
                        ) {
                            validity = true;
                            if (
                                payload &&
                                payload.totalStorage !== null &&
                                payload.storageUsed !== null
                            ) {
                                successReasons.push(
                                    `${
                                        criteriaStrings.freeStorage
                                        // @ts-expect-error ts-migrate(2554) FIXME: Expected 5 arguments, but got 1.
                                    } ${formatBytes(freeBytes)}`
                                );
                            }
                        } else {
                            if (
                                payload &&
                                payload.totalStorage !== null &&
                                payload.storageUsed !== null
                            ) {
                                failedReasons.push(
                                    `${
                                        criteriaStrings.freeStorage
                                        // @ts-expect-error ts-migrate(2554) FIXME: Expected 5 arguments, but got 1.
                                    } ${formatBytes(freeBytes)}`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'notEqualTo'
                    ) {
                        if (
                            con.criteria[i] &&
                            con.criteria[i].field1 &&
                            free !== con.criteria[i].field1
                        ) {
                            validity = true;
                            if (
                                payload &&
                                payload.totalStorage !== null &&
                                payload.storageUsed !== null
                            ) {
                                successReasons.push(
                                    `${
                                        criteriaStrings.freeStorage
                                        // @ts-expect-error ts-migrate(2554) FIXME: Expected 5 arguments, but got 1.
                                    } ${formatBytes(freeBytes)}`
                                );
                            }
                        } else {
                            if (
                                payload &&
                                payload.totalStorage !== null &&
                                payload.storageUsed !== null
                            ) {
                                failedReasons.push(
                                    `${
                                        criteriaStrings.freeStorage
                                        // @ts-expect-error ts-migrate(2554) FIXME: Expected 5 arguments, but got 1.
                                    } ${formatBytes(freeBytes)}`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'gtEqualTo'
                    ) {
                        if (
                            con.criteria[i] &&
                            con.criteria[i].field1 &&
                            free >= con.criteria[i].field1
                        ) {
                            validity = true;
                            if (
                                payload &&
                                payload.totalStorage !== null &&
                                payload.storageUsed !== null
                            ) {
                                successReasons.push(
                                    `${
                                        criteriaStrings.freeStorage
                                        // @ts-expect-error ts-migrate(2554) FIXME: Expected 5 arguments, but got 1.
                                    } ${formatBytes(freeBytes)}`
                                );
                            }
                        } else {
                            if (
                                payload &&
                                payload.totalStorage !== null &&
                                payload.storageUsed !== null
                            ) {
                                failedReasons.push(
                                    `${
                                        criteriaStrings.freeStorage
                                        // @ts-expect-error ts-migrate(2554) FIXME: Expected 5 arguments, but got 1.
                                    } ${formatBytes(freeBytes)}`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'ltEqualTo'
                    ) {
                        if (
                            con.criteria[i] &&
                            con.criteria[i].field1 &&
                            free <= con.criteria[i].field1
                        ) {
                            validity = true;
                            if (
                                payload &&
                                payload.totalStorage !== null &&
                                payload.storageUsed !== null
                            ) {
                                successReasons.push(
                                    `${
                                        criteriaStrings.freeStorage
                                        // @ts-expect-error ts-migrate(2554) FIXME: Expected 5 arguments, but got 1.
                                    } ${formatBytes(freeBytes)}`
                                );
                            }
                        } else {
                            if (
                                payload &&
                                payload.totalStorage !== null &&
                                payload.storageUsed !== null
                            ) {
                                failedReasons.push(
                                    `${
                                        criteriaStrings.freeStorage
                                        // @ts-expect-error ts-migrate(2554) FIXME: Expected 5 arguments, but got 1.
                                    } ${formatBytes(freeBytes)}`
                                );
                            }
                        }
                    }
                } else if (
                    con.criteria[i] &&
                    con.criteria[i].responseType === 'temperature'
                ) {
                    if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'greaterThan'
                    ) {
                        if (
                            con.criteria[i] &&
                            con.criteria[i].field1 &&
                            payload &&
                            payload.mainTemp &&
                            payload.mainTemp > con.criteria[i].field1
                        ) {
                            validity = true;
                            if (payload && payload.mainTemp !== null) {
                                successReasons.push(
                                    `${criteriaStrings.temperature} ${payload.mainTemp} °C`
                                );
                            }
                        } else {
                            if (payload && payload.mainTemp !== null) {
                                failedReasons.push(
                                    `${criteriaStrings.temperature} ${payload.mainTemp} °C`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'lessThan'
                    ) {
                        if (
                            con.criteria[i] &&
                            con.criteria[i].field1 &&
                            payload &&
                            payload.mainTemp &&
                            payload.mainTemp < con.criteria[i].field1
                        ) {
                            validity = true;
                            if (payload && payload.mainTemp !== null) {
                                successReasons.push(
                                    `${criteriaStrings.temperature} ${payload.mainTemp} °C`
                                );
                            }
                        } else {
                            if (payload && payload.mainTemp !== null) {
                                failedReasons.push(
                                    `${criteriaStrings.temperature} ${payload.mainTemp} °C`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'inBetween'
                    ) {
                        if (
                            con.criteria[i] &&
                            con.criteria[i].field1 &&
                            payload &&
                            payload.mainTemp &&
                            con.criteria[i].field2 &&
                            payload.mainTemp > con.criteria[i].field1 &&
                            payload.mainTemp < con.criteria[i].field2
                        ) {
                            validity = true;
                            if (payload && payload.mainTemp !== null) {
                                successReasons.push(
                                    `${criteriaStrings.temperature} ${payload.mainTemp} °C`
                                );
                            }
                        } else {
                            if (payload && payload.mainTemp !== null) {
                                failedReasons.push(
                                    `${criteriaStrings.temperature} ${payload.mainTemp} °C`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'equalTo'
                    ) {
                        if (
                            con.criteria[i] &&
                            con.criteria[i].field1 &&
                            payload &&
                            payload.mainTemp &&
                            payload.mainTemp == con.criteria[i].field1
                        ) {
                            validity = true;
                            if (payload && payload.mainTemp !== null) {
                                successReasons.push(
                                    `${criteriaStrings.temperature} ${payload.mainTemp} °C`
                                );
                            }
                        } else {
                            if (payload && payload.mainTemp !== null) {
                                failedReasons.push(
                                    `${criteriaStrings.temperature} ${payload.mainTemp} °C`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'notEqualTo'
                    ) {
                        if (
                            con.criteria[i] &&
                            con.criteria[i].field1 &&
                            payload &&
                            payload.mainTemp &&
                            payload.mainTemp != con.criteria[i].field1
                        ) {
                            validity = true;
                            if (payload && payload.mainTemp !== null) {
                                successReasons.push(
                                    `${criteriaStrings.temperature} ${payload.mainTemp} °C`
                                );
                            }
                        } else {
                            if (payload && payload.mainTemp !== null) {
                                failedReasons.push(
                                    `${criteriaStrings.temperature} ${payload.mainTemp} °C`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'gtEqualTo'
                    ) {
                        if (
                            con.criteria[i] &&
                            con.criteria[i].field1 &&
                            payload &&
                            payload.mainTemp &&
                            payload.mainTemp >= con.criteria[i].field1
                        ) {
                            validity = true;
                            if (payload && payload.mainTemp !== null) {
                                successReasons.push(
                                    `${criteriaStrings.temperature} ${payload.mainTemp} °C`
                                );
                            }
                        } else {
                            if (payload && payload.mainTemp !== null) {
                                failedReasons.push(
                                    `${criteriaStrings.temperature} ${payload.mainTemp} °C`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'ltEqualTo'
                    ) {
                        if (
                            con.criteria[i] &&
                            con.criteria[i].field1 &&
                            payload &&
                            payload.mainTemp &&
                            payload.mainTemp <= con.criteria[i].field1
                        ) {
                            validity = true;
                            if (payload && payload.mainTemp !== null) {
                                successReasons.push(
                                    `${criteriaStrings.temperature} ${payload.mainTemp} °C`
                                );
                            }
                        } else {
                            if (payload && payload.mainTemp !== null) {
                                failedReasons.push(
                                    `${criteriaStrings.temperature} ${payload.mainTemp} °C`
                                );
                            }
                        }
                    }
                } else if (
                    con.criteria[i] &&
                    con.criteria[i].responseType === 'responseBody'
                ) {
                    if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'contains'
                    ) {
                        if (body && typeof body === 'string') {
                            if (
                                con.criteria[i] &&
                                con.criteria[i].field1 &&
                                body &&
                                // @ts-expect-error ts-migrate(2345) FIXME: Argument of type 'any[]' is not assignable to para... Remove this comment to see the full error message
                                body.includes([con.criteria[i].field1])
                            ) {
                                validity = true;
                                if (con.criteria[i].field1) {
                                    successReasons.push(
                                        `${criteriaStrings.responseBody} contains ${con.criteria[i].field1}`
                                    );
                                }
                            } else {
                                if (con.criteria[i].field1) {
                                    failedReasons.push(
                                        `${criteriaStrings.responseBody} did not contain ${con.criteria[i].field1}`
                                    );
                                }
                            }
                        } else {
                            if (
                                con.criteria[i] &&
                                con.criteria[i].field1 &&
                                body &&
                                body[con.criteria[i].field1]
                            ) {
                                validity = true;
                                if (con.criteria[i].field1) {
                                    successReasons.push(
                                        `${criteriaStrings.responseBody} contains ${con.criteria[i].field1}`
                                    );
                                }
                            } else {
                                if (con.criteria[i].field1) {
                                    failedReasons.push(
                                        `${criteriaStrings.responseBody} did not contain ${con.criteria[i].field1}`
                                    );
                                }
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'doesNotContain'
                    ) {
                        if (body && typeof body === 'string') {
                            if (
                                con.criteria[i] &&
                                con.criteria[i].field1 &&
                                body &&
                                // @ts-expect-error ts-migrate(2345) FIXME: Argument of type 'any[]' is not assignable to para... Remove this comment to see the full error message
                                !body.includes([con.criteria[i].field1])
                            ) {
                                validity = true;
                                if (con.criteria[i].field1) {
                                    successReasons.push(
                                        `${criteriaStrings.responseBody} did not contain ${con.criteria[i].field1}`
                                    );
                                }
                            } else {
                                if (con.criteria[i].field1) {
                                    failedReasons.push(
                                        `${criteriaStrings.responseBody} contains ${con.criteria[i].field1}`
                                    );
                                }
                            }
                        } else {
                            if (
                                con.criteria[i] &&
                                con.criteria[i].field1 &&
                                body &&
                                !body[con.criteria[i].field1]
                            ) {
                                validity = true;
                                if (con.criteria[i].field1) {
                                    successReasons.push(
                                        `${criteriaStrings.responseBody} did not contain ${con.criteria[i].field1}`
                                    );
                                }
                            } else {
                                if (con.criteria[i].field1) {
                                    failedReasons.push(
                                        `${criteriaStrings.responseBody} contains ${con.criteria[i].field1}`
                                    );
                                }
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'jsExpression'
                    ) {
                        const ctx = Object.create(null); // fix against prototype vulnerability
                        ctx.request = { body };
                        const output = vm.runInNewContext(
                            con.criteria[i].field1,
                            ctx
                        );
                        if (
                            con.criteria[i] &&
                            con.criteria[i].field1 &&
                            body &&
                            output
                        ) {
                            validity = true;
                            if (con.criteria[i].field1) {
                                successReasons.push(
                                    `${criteriaStrings.responseBody} contains Javascript expression ${con.criteria[i].field1}`
                                );
                            }
                        } else {
                            if (con.criteria[i].field1) {
                                failedReasons.push(
                                    `${criteriaStrings.responseBody} does not contain Javascript expression ${con.criteria[i].field1}`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'empty'
                    ) {
                        if (
                            con.criteria[i] &&
                            con.criteria[i].filter &&
                            body &&
                            _.isEmpty(body)
                        ) {
                            validity = true;
                            successReasons.push(
                                `${criteriaStrings.responseBody} was empty`
                            );
                        } else {
                            failedReasons.push(
                                `${criteriaStrings.responseBody} was not empty`
                            );
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'notEmpty'
                    ) {
                        if (
                            con.criteria[i] &&
                            con.criteria[i].filter &&
                            body &&
                            !_.isEmpty(body)
                        ) {
                            validity = true;
                            successReasons.push(
                                `${criteriaStrings.responseBody} was not empty`
                            );
                        } else {
                            failedReasons.push(
                                `${criteriaStrings.responseBody} was empty`
                            );
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'evaluateResponse'
                    ) {
                        const responseDisplay = con.criteria[i].field1
                            ? con.criteria[i].field1.includes(
                                  'response.body'
                              ) &&
                              con.criteria[i].field1.includes(
                                  'response.headers'
                              )
                                ? {
                                      headers: response.headers,
                                      body: response.body,
                                  }
                                : con.criteria[i].field1.includes(
                                      'response.headers'
                                  )
                                ? response.headers
                                : con.criteria[i].field1.includes(
                                      'response.body'
                                  )
                                ? response.body
                                : response
                            : response;
                        try {
                            if (
                                con.criteria[i] &&
                                con.criteria[i].field1 &&
                                response &&
                                Function(
                                    '"use strict";const response = ' +
                                        JSON.stringify(response) +
                                        ';return (' +
                                        con.criteria[i].field1 +
                                        ');'
                                )()
                            ) {
                                validity = true;
                                if (con.criteria[i].field1) {
                                    successReasons.push(
                                        `${
                                            criteriaStrings.response
                                        } \`${JSON.stringify(
                                            responseDisplay
                                        )}\` evaluate \`${
                                            con.criteria[i].field1
                                        }\``
                                    );
                                }
                            } else {
                                if (con.criteria[i].field1) {
                                    failedReasons.push(
                                        `${
                                            criteriaStrings.response
                                        } \`${JSON.stringify(
                                            responseDisplay
                                        )}\` did not evaluate \`${
                                            con.criteria[i].field1
                                        }\``
                                    );
                                }
                            }
                        } catch (e) {
                            failedReasons.push(
                                `${criteriaStrings.response} \`${JSON.stringify(
                                    responseDisplay
                                )}\` did not evaluate \`${
                                    con.criteria[i].field1
                                }\``
                            );
                        }
                    }
                } else if (
                    con.criteria[i] &&
                    con.criteria[i].responseType === 'queryString'
                ) {
                    if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'contains'
                    ) {
                        if (
                            !(
                                con.criteria[i] &&
                                con.criteria[i].field1 &&
                                queryParams &&
                                queryParams.includes(
                                    con.criteria[i].field1.toLowerCase()
                                )
                            )
                        ) {
                            validity = false;
                            failedReasons.push(
                                `${criteriaStrings.responseBody} did not contain ${con.criteria[i].field1}`
                            );
                        } else {
                            successReasons.push(
                                `${criteriaStrings.responseBody} contains ${con.criteria[i].field1}`
                            );
                        }
                    }
                } else if (
                    con.criteria[i] &&
                    con.criteria[i].responseType === 'headers'
                ) {
                    if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'contains'
                    ) {
                        if (
                            !(
                                con.criteria[i] &&
                                con.criteria[i].field1 &&
                                headers &&
                                headers.includes(
                                    con.criteria[i].field1.toLowerCase()
                                )
                            )
                        ) {
                            validity = false;
                            failedReasons.push(
                                `${criteriaStrings.responseBody} did not contain ${con.criteria[i].field1}`
                            );
                        } else {
                            successReasons.push(
                                `${criteriaStrings.responseBody} contains ${con.criteria[i].field1}`
                            );
                        }
                    }
                } else if (
                    con.criteria[i] &&
                    con.criteria[i].responseType === 'podStatus'
                ) {
                    const healthyPods = ['running', 'pending', 'succeeded'];
                    if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'equalTo'
                    ) {
                        if (
                            !payload.podData.allPods ||
                            payload.podData.allPods.length === 0
                        ) {
                            failedReasons.push('Pod is not available');
                        } else {
                            // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'pod' implicitly has an 'any' type.
                            // eslint-disable-next-line no-loop-func
                            payload.podData.allPods.forEach(pod => {
                                if (
                                    con.criteria[i] &&
                                    con.criteria[i].field1 &&
                                    pod.podStatus &&
                                    pod.podStatus.toLowerCase() ===
                                        con.criteria[i].field1.toLowerCase()
                                ) {
                                    validity = true;
                                    successReasons.push(
                                        `${pod.podName} pod status is ${pod.podStatus}`
                                    );
                                } else {
                                    if (
                                        !healthyPods.includes(
                                            pod.podStatus.toLowerCase()
                                        )
                                    ) {
                                        failedReasons.push(
                                            `${pod.podName} pod status is ${pod.podStatus}`
                                        );
                                    }
                                }
                            });
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'notEqualTo'
                    ) {
                        if (
                            !payload.podData.allPods ||
                            payload.podData.allPods.length === 0
                        ) {
                            failedReasons.push('Pod is not available');
                        } else {
                            // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'pod' implicitly has an 'any' type.
                            // eslint-disable-next-line no-loop-func
                            payload.podData.allPods.forEach(pod => {
                                if (
                                    con.criteria[i] &&
                                    con.criteria[i].field1 &&
                                    pod.podStatus &&
                                    pod.podStatus.toLowerCase() !==
                                        con.criteria[i].field1.toLowerCase()
                                ) {
                                    validity = true;
                                    successReasons.push(
                                        `${pod.podName} pod status is ${pod.podStatus}`
                                    );
                                } else {
                                    if (
                                        !healthyPods.includes(
                                            pod.podStatus.toLowerCase()
                                        )
                                    ) {
                                        failedReasons.push(
                                            `${pod.podName} pod status is ${pod.podStatus}`
                                        );
                                    }
                                }
                            });
                        }
                    }
                } else if (
                    con.criteria[i] &&
                    con.criteria[i].responseType === 'jobStatus'
                ) {
                    const healthyJobs = ['running', 'succeeded'];
                    if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'equalTo'
                    ) {
                        if (
                            !payload.jobData.allJobs ||
                            payload.jobData.allJobs.length === 0
                        ) {
                            failedReasons.push('Job is not available');
                        } else {
                            // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'job' implicitly has an 'any' type.
                            // eslint-disable-next-line no-loop-func
                            payload.jobData.allJobs.forEach(job => {
                                if (
                                    con.criteria[i] &&
                                    con.criteria[i].field1 &&
                                    job.jobStatus &&
                                    job.jobStatus.toLowerCase() ===
                                        con.criteria[i].field1.toLowerCase()
                                ) {
                                    validity = true;
                                    successReasons.push(
                                        `${job.jobName} job status is ${job.jobStatus}`
                                    );
                                } else {
                                    if (
                                        !healthyJobs.includes(
                                            job.jobStatus.toLowerCase()
                                        )
                                    ) {
                                        failedReasons.push(
                                            `${job.jobName} job status is ${job.jobStatus}`
                                        );
                                    }
                                }
                            });
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'notEqualTo'
                    ) {
                        if (
                            !payload.jobData.allJobs ||
                            payload.jobData.allJobs.length === 0
                        ) {
                            failedReasons.push('Job is not available');
                        } else {
                            // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'job' implicitly has an 'any' type.
                            // eslint-disable-next-line no-loop-func
                            payload.jobData.allJobs.forEach(job => {
                                if (
                                    con.criteria[i] &&
                                    con.criteria[i].field1 &&
                                    job.jobStatus &&
                                    job.jobStatus.toLowerCase() !==
                                        con.criteria[i].field1.toLowerCase()
                                ) {
                                    validity = true;
                                    successReasons.push(
                                        `${job.jobName} job status is ${job.jobStatus}`
                                    );
                                } else {
                                    if (
                                        !healthyJobs.includes(
                                            job.jobStatus.toLowerCase()
                                        )
                                    ) {
                                        failedReasons.push(
                                            `${job.jobName} job status is ${job.jobStatus}`
                                        );
                                    }
                                }
                            });
                        }
                    }
                } else if (
                    con.criteria[i] &&
                    con.criteria[i].responseType === 'desiredDeployment'
                ) {
                    if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'equalTo'
                    ) {
                        if (
                            !payload.deploymentData.allDeployments ||
                            payload.deploymentData.allDeployments.length === 0
                        ) {
                            failedReasons.push('Deployment is not available');
                        } else {
                            payload.deploymentData.allDeployments.forEach(
                                // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'deployment' implicitly has an 'any' typ... Remove this comment to see the full error message
                                // eslint-disable-next-line no-loop-func
                                deployment => {
                                    if (
                                        deployment.desiredDeployment ===
                                        deployment.readyDeployment
                                    ) {
                                        validity = true;
                                        successReasons.push(
                                            `${deployment.deploymentName} deployment state is ${deployment.readyDeployment}/${deployment.desiredDeployment}`
                                        );
                                    } else {
                                        failedReasons.push(
                                            `${deployment.deploymentName} deployment state is ${deployment.readyDeployment}/${deployment.desiredDeployment}`
                                        );
                                    }
                                }
                            );
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'notEqualTo'
                    ) {
                        if (
                            !payload.deploymentData.allDeployments ||
                            payload.deploymentData.allDeployments.length === 0
                        ) {
                            failedReasons.push('Deployment is not available');
                        } else {
                            payload.deploymentData.allDeployments.forEach(
                                // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'deployment' implicitly has an 'any' typ... Remove this comment to see the full error message
                                // eslint-disable-next-line no-loop-func
                                deployment => {
                                    if (
                                        deployment.desiredDeployment !==
                                        deployment.readyDeployment
                                    ) {
                                        validity = true;
                                        successReasons.push(
                                            `${deployment.deploymentName} deployment state is ${deployment.readyDeployment}/${deployment.desiredDeployment}`
                                        );
                                    } else {
                                        failedReasons.push(
                                            `${deployment.deploymentName} deployment state is ${deployment.readyDeployment}/${deployment.desiredDeployment}`
                                        );
                                    }
                                }
                            );
                        }
                    }
                } else if (
                    con.criteria[i] &&
                    con.criteria[i].responseType === 'desiredStatefulsets'
                ) {
                    if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'equalTo'
                    ) {
                        if (
                            !payload.statefulsetData.allStatefulset ||
                            payload.statefulsetData.allStatefulset.length === 0
                        ) {
                            failedReasons.push('Statefulset is not available');
                        } else {
                            payload.statefulsetData.allStatefulset.forEach(
                                // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'statefulset' implicitly has an 'any' ty... Remove this comment to see the full error message
                                // eslint-disable-next-line no-loop-func
                                statefulset => {
                                    if (
                                        statefulset.desiredStatefulsets ===
                                        statefulset.readyStatefulsets
                                    ) {
                                        validity = true;
                                        successReasons.push(
                                            `${statefulset.statefulsetName} statefulset state is ${statefulset.readyStatefulsets}/${statefulset.desiredStatefulsets}`
                                        );
                                    } else {
                                        failedReasons.push(
                                            `${statefulset.statefulsetName} statefulset state is ${statefulset.readyStatefulsets}/${statefulset.desiredStatefulsets}`
                                        );
                                    }
                                }
                            );
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'notEqualTo'
                    ) {
                        if (
                            !payload.statefulsetData.allStatefulset ||
                            payload.statefulsetData.allStatefulset.length === 0
                        ) {
                            failedReasons.push('Statefulset is not available');
                        } else {
                            payload.statefulsetData.allStatefulset.forEach(
                                // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'statefulset' implicitly has an 'any' ty... Remove this comment to see the full error message
                                // eslint-disable-next-line no-loop-func
                                statefulset => {
                                    if (
                                        statefulset.desiredStatefulsets !==
                                        statefulset.readyStatefulsets
                                    ) {
                                        validity = true;
                                        successReasons.push(
                                            `${statefulset.statefulsetName} statefulset state is ${statefulset.readyStatefulsets}/${statefulset.desiredStatefulsets}`
                                        );
                                    } else {
                                        failedReasons.push(
                                            `${statefulset.statefulsetName} statefulset state is ${statefulset.readyStatefulsets}/${statefulset.desiredStatefulsets}`
                                        );
                                    }
                                }
                            );
                        }
                    }
                } else if (
                    con.criteria[i] &&
                    con.criteria[i].responseType === 'respondsToPing'
                ) {
                    if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'isUp'
                    ) {
                        if (
                            con.criteria[i] &&
                            con.criteria[i].filter &&
                            !(statusCode === 408 || statusCode === '408')
                        ) {
                            validity = true;
                            successReasons.push(
                                // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
                                `${criteriaStrings[type] ||
                                    'Monitor was'} Online`
                            );
                        } else {
                            failedReasons.push(
                                // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
                                `${criteriaStrings[type] ||
                                    'Monitor was'} Offline`
                            );
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'isDown'
                    ) {
                        if (
                            con.criteria[i] &&
                            con.criteria[i].filter &&
                            (statusCode === 408 || statusCode === '408')
                        ) {
                            validity = true;
                            successReasons.push(
                                // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
                                `${criteriaStrings[type] ||
                                    'Monitor was'} Offline`
                            );
                        } else {
                            failedReasons.push(
                                // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
                                `${criteriaStrings[type] ||
                                    'Monitor was'} Online`
                            );
                        }
                    }
                }
            }
        }
    }
    return validity;
};

/**
 * verifies if a specific script condition satisfies
 * @param {'and' | 'or'} conditionLogic
 * @returns {{ valid : boolean, reason : string} | undefined} whether the condition is satisfied
 */
// @ts-expect-error ts-migrate(7006) FIXME: Parameter 'condition' implicitly has an 'any' type... Remove this comment to see the full error message
const checkScriptCondition = (condition, body) => {
    if (!condition || !condition.responseType) {
        return;
    }
    /**
     * @type { {valid : boolean, reason : string}}
     */
    const validity = {};

    if (!condition.filter || !body || !condition.responseType) {
        return;
    }

    if (condition.responseType === 'scriptExecution') {
        // we need a catch-all for server-defined
        // script timeout errors or terminated scripts
        if (body.statusText === 'timeout') {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'valid' does not exist on type '{}'.
            validity.valid = false;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'reason' does not exist on type '{}'.
            validity.reason = body.error;
            return validity;
        }

        if (condition.filter === 'throwsError') {
            if (body.statusText === 'failed' && body.error) {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'valid' does not exist on type '{}'.
                validity.valid = true;
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'reason' does not exist on type '{}'.
                validity.reason = `Script threw error ${body.error}`;
            } else {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'valid' does not exist on type '{}'.
                validity.valid = false;
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'reason' does not exist on type '{}'.
                validity.reason = `Script did not throw error`;
            }
        } else if (condition.filter === 'doesNotThrowError') {
            if (body.statusText === 'failed' && body.error) {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'valid' does not exist on type '{}'.
                validity.valid = false;
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'reason' does not exist on type '{}'.
                validity.reason = `Script threw error ${body.error}`;
            } else {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'valid' does not exist on type '{}'.
                validity.valid = true;
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'reason' does not exist on type '{}'.
                validity.reason = `Script did not throw error`;
            }
        } else if (condition.filter === 'emptyCallback') {
            if (body.statusText === 'nonEmptyCallback' && body.error) {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'valid' does not exist on type '{}'.
                validity.valid = false;
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'reason' does not exist on type '{}'.
                validity.reason = `Script callback invoked with arguments ${JSON.stringify(
                    body.error
                )}`;
            } else {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'valid' does not exist on type '{}'.
                validity.valid = true;
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'reason' does not exist on type '{}'.
                validity.reason = `Script callback has no arguments`;
            }
        } else if (condition.filter === 'nonEmptyCallback') {
            if (body.statusText === 'nonEmptyCallback' && body.error) {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'valid' does not exist on type '{}'.
                validity.valid = true;
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'reason' does not exist on type '{}'.
                validity.reason = `Script callback invoked with arguments ${JSON.stringify(
                    body.error
                )}`;
            } else {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'valid' does not exist on type '{}'.
                validity.valid = false;
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'reason' does not exist on type '{}'.
                validity.reason = `Script callback has no arguments`;
            }
        }
    } else if (condition.responseType === 'executionTime') {
        if (condition.filter === 'executesIn') {
            if (body.executionTime <= condition.filter1) {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'valid' does not exist on type '{}'.
                validity.valid = true;
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'reason' does not exist on type '{}'.
                validity.reason = `Script executed in ${body.executionTime}ms within ${condition.filter1}ms limit`;
            } else {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'valid' does not exist on type '{}'.
                validity.valid = false;
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'reason' does not exist on type '{}'.
                validity.reason = `Script executed above ${condition.filter1}ms limit`;
            }
        } else if (condition.filter === 'doesNotExecuteIn') {
            if (body.executionTime >= condition.filter1) {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'valid' does not exist on type '{}'.
                validity.valid = true;
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'reason' does not exist on type '{}'.
                validity.reason = `Script executed in ${body.executionTime}ms above ${condition.filter1}ms minimum`;
            } else {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'valid' does not exist on type '{}'.
                validity.valid = false;
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'reason' does not exist on type '{}'.
                validity.reason = `Script executed below ${condition.filter1}ms minimum`;
            }
        }
    } else {
        // if for some strange reason
        return;
    }

    return validity;
};

// @ts-expect-error ts-migrate(7006) FIXME: Parameter 'con' implicitly has an 'any' type.
const checkScriptAnd = (con, body, successReasons, failedReasons) => {
    let valid = true;
    if (con && con.criteria && con.criteria.length > 0) {
        for (let i = 0; i < con.criteria.length; i++) {
            if (
                con.criteria[i].criteria &&
                con.criteria[i].criteria.length > 0
            ) {
                if (
                    con.criteria[i].condition &&
                    con.criteria[i].condition === 'and'
                ) {
                    // check script and
                    const subConditionValid = checkScriptAnd(
                        con.criteria[i],
                        body,
                        successReasons,
                        failedReasons
                    );
                    if (!subConditionValid) {
                        valid = false;
                    }
                } else if (
                    con.criteria[i].condition &&
                    con.criteria[i].condition === 'or'
                ) {
                    // check script or
                    const subConditionValid = checkScriptOr(
                        con.criteria[i],
                        body,
                        successReasons,
                        failedReasons
                    );
                    if (!subConditionValid) {
                        valid = false;
                    }
                }
            } else {
                const validity = checkScriptCondition(con.criteria[i], body);
                if (validity) {
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'valid' does not exist on type '{}'.
                    if (validity.valid) {
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'reason' does not exist on type '{}'.
                        successReasons.push(validity.reason);
                    } else {
                        valid = false;
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'reason' does not exist on type '{}'.
                        failedReasons.push(validity.reason);
                    }
                }
            }
        }
    }

    return valid;
};

// @ts-expect-error ts-migrate(7006) FIXME: Parameter 'con' implicitly has an 'any' type.
const checkScriptOr = (con, body, successReasons, failedReasons) => {
    let valid = false;
    if (con && con.criteria && con.criteria.length > 0) {
        for (let i = 0; i < con.criteria.length; i++) {
            if (
                con.criteria[i].criteria &&
                con.criteria[i].criteria.length > 0
            ) {
                if (
                    con.criteria[i].condition &&
                    con.criteria[i].condition === 'or'
                ) {
                    // check script or
                    const subConditionValid = checkScriptOr(
                        con.criteria[i],
                        body,
                        successReasons,
                        failedReasons
                    );
                    if (subConditionValid) {
                        valid = true;
                    }
                } else if (
                    con.criteria[i].condition &&
                    con.criteria[i].condition === 'and'
                ) {
                    // check script and
                    const subConditionValid = checkScriptAnd(
                        con.criteria[i],
                        body,
                        successReasons,
                        failedReasons
                    );
                    if (subConditionValid) {
                        valid = true;
                    }
                }
            } else {
                const validity = checkScriptCondition(con.criteria[i], body);
                if (validity) {
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'valid' does not exist on type '{}'.
                    if (validity.valid) {
                        valid = true;
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'reason' does not exist on type '{}'.
                        successReasons.push(validity.reason);
                    } else {
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'reason' does not exist on type '{}'.
                        failedReasons.push(validity.reason);
                    }
                }
            }
        }
    }

    return valid;
};

const criteriaStrings = {
    responseTime: 'Response Time is',
    sslCertificate: 'SSL Certificate',
    statusCode: 'Status Code is',
    cpuLoad: 'CPU Load is',
    memoryUsed: 'Memory Used is',
    freeStorage: 'Free Storage is',
    temperature: 'Temperature is',
    responseBody: 'Response Body',
    response: 'Response',
    incomingTime: 'Incoming request time interval is',
    'server-monitor': 'Server is',
    url: 'Website is',
    api: 'API is',
    incomingHttpRequest: 'Incoming request is',
    ip: 'IP is',
};

// @ts-expect-error ts-migrate(7006) FIXME: Parameter 'value' implicitly has an 'any' type.
const formatDecimal = (value, decimalPlaces, roundType) => {
    let formattedNumber;
    switch (roundType) {
        case 'up':
            formattedNumber = Math.ceil(
                parseFloat(value + 'e' + decimalPlaces)
            );
            break;
        case 'down':
            formattedNumber = Math.floor(
                parseFloat(value + 'e' + decimalPlaces)
            );
            break;
        default:
            formattedNumber = Math.round(
                parseFloat(value + 'e' + decimalPlaces)
            );
    }
    return Number(formattedNumber + 'e-' + decimalPlaces).toFixed(
        decimalPlaces
    );
};

// @ts-expect-error ts-migrate(7006) FIXME: Parameter 'a' implicitly has an 'any' type.
const formatBytes = (a, b, c, d, e) => {
    let value = a;
    let decimalPlaces;
    let roundType;
    if (typeof a === 'object') {
        value = a.value;
        decimalPlaces = a.decimalPlaces;
        roundType = a.roundType;
    }
    return (
        formatDecimal(
            ((b = Math),
            (c = b.log),
            (d = 1e3),
            (e = (c(value) / c(d)) | 0),
            value / b.pow(d, e)),
            decimalPlaces >= 0 ? decimalPlaces : 2,
            roundType
        ) +
        ' ' +
        (e ? 'kMGTPEZY'[--e] + 'B' : 'Bytes')
    );
};

import ErrorService from './errorService';
import MonitorService from './monitorService';
import MonitorStatusService from './monitorStatusService';
import MonitorLogService from './monitorLogService';
import LighthouseLogService from './lighthouseLogService';
import IncidentService from './incidentService';
import IncidentTimelineService from './incidentTimelineService';
import moment from 'moment';
import { some, forEach } from 'p-iteration';
import vm from 'vm';
import AutomatedScriptService from './automatedScriptService';
import { ObjectId } from 'mongodb';
// @ts-expect-error ts-migrate(2339) FIXME: Property 'db' does not exist on type 'Global & typ... Remove this comment to see the full error message
const probeCollection = global.db.collection('probes');
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'uuid... Remove this comment to see the full error message
import { v1 as uuidv1 } from 'uuid';
// @ts-expect-error ts-migrate(2614) FIXME: Module '"../utils/api"' has no exported member 'po... Remove this comment to see the full error message
import { postApi } from '../utils/api';
// @ts-expect-error ts-migrate(2614) FIXME: Module '"../utils/config"' has no exported member ... Remove this comment to see the full error message
import { realtimeUrl } from '../utils/config';
const realtimeBaseUrl = `${realtimeUrl}/realtime`;
