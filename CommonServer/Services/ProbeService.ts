import ProbeModel from '../Models/probe';
import RealTimeService from './realTimeService';
import MonitorService from './MonitorService';
import MonitorStatusService from './MonitorStatusService';
import MonitorLogService from './MonitorLogService';
import IncidentService from './IncidentService';
import IncidentTimelineService from './IncidentTimelineService';
import moment from 'moment';
import { some, forEach } from 'p-iteration';
import vm from 'vm';
import AutomatedScriptService from './AutomatedScriptService';

import Model, {
    requiredFields,
    uniqueFields,
    slugifyField,
    encryptedFields,
} from '../Models/SSL';
import DatabaseService from './DatabaseService';

class Service extends DatabaseService<typeof Model> {
    public constructor() {
        super({
            model: Model,
            requiredFields: requiredFields,
            uniqueFields: uniqueFields,
            friendlyName: 'Probe',
            publicListProps: {
                populate: [],
                select: [],
            },
            adminListProps: {
                populate: [],
                select: [],
            },
            ownerListProps: {
                populate: [],
                select: [],
            },
            memberListProps: {
                populate: [],
                select: [],
            },
            viewerListProps: {
                populate: [],
                select: [],
            },
            publicItemProps: {
                populate: [],
                select: [],
            },
            adminItemProps: {
                populate: [],
                select: [],
            },
            memberItemProps: {
                populate: [],
                select: [],
            },
            viewerItemProps: {
                populate: [],
                select: [],
            },
            ownerItemProps: {
                populate: [],
                select: [],
            },
            isResourceByProject: false,
            slugifyField: slugifyField,
            encryptedFields: encryptedFields,
        });
    }

    protected override async onBeforeCreate({
        data,
    }: CreateBy): Promise<CreateBy> {
        if (!data.get('probeKey')) {
            data.set('probeKey', UUID.generate());
        }

        return Promise.resolve({ data } as CreateBy);
    }

public async sendProbe(probeId, monitorId): void {
        const selectProbe: $TSFixMe =
            'createdAt probeKey probeName version lastAlive deleted deletedAt probeImage';

        const probe: $TSFixMe = await this.findOneBy({
            query: { _id: probeId },
            select: selectProbe,
        });
        if (probe) {
            delete probe.deleted;
            // run in the background
            RealTimeService.updateProbe(probe, monitorId);
        }
    }

public async createMonitorDisabledStatus(data: $TSFixMe): void {
        const select: $TSFixMe =
            '_id monitorId probeId incidentId status manuallyCreated startTime endTime lastStatus createdAt deleted';
        let monitorStatus: $TSFixMe = await MonitorStatusService.findBy({
            query: { monitorId: data.monitorId },
            select,
            limit: 1,
        });
        monitorStatus = monitorStatus[0];

        const lastStatus: $TSFixMe =
            monitorStatus && monitorStatus.status ? monitorStatus.status : null;

        if (!lastStatus || (lastStatus && lastStatus !== data.status)) {
            data.lastStatus = lastStatus ? lastStatus : null;
            monitorStatus = await MonitorStatusService.create(data);
        }
        return monitorStatus;
    }

public async saveMonitorLog(data: $TSFixMe): void {
        let monitorStatus: $TSFixMe = await MonitorStatusService.findBy({
            query: { monitorId: data.monitorId, probeId: data.probeId },
            select: 'status',
            limit: 1,
        });
        monitorStatus = monitorStatus[0];

        const lastStatus: $TSFixMe =
            monitorStatus && monitorStatus.status ? monitorStatus.status : null;

        let log: $TSFixMe = await MonitorLogService.create(data);

        if (!data.stopPingTimeUpdate) {
            await MonitorService.updateMonitorPingTime(data.monitorId);
        }

        // grab all the criteria in a monitor

        const allCriteria: $TSFixMe = [];
        if (data.matchedUpCriterion) {
            data.matchedUpCriterion.forEach(criteria =>
                allCriteria.push(criteria)
            );
        }
        if (data.matchedDownCriterion) {
            data.matchedDownCriterion.forEach(criteria =>
                allCriteria.push(criteria)
            );
        }
        if (data.matchedDegradedCriterion) {
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
                ) {
                    return { retry: true, retryCount: data.retryCount };
                }

                await this.incidentResolveOrAcknowledge(data, allCriteria);
            }

            const incidentIdsOrRetry: $TSFixMe = await this.incidentCreateOrUpdate(data);

            if (incidentIdsOrRetry.retry) {
                return incidentIdsOrRetry;
            }

            if (
                Array.isArray(incidentIdsOrRetry) &&
                incidentIdsOrRetry.length
            ) {
                data.incidentId = incidentIdsOrRetry[0];
            }

            await MonitorStatusService.create(data);

            if (incidentIdsOrRetry && incidentIdsOrRetry.length) {
                log = await MonitorLogService.updateOneBy(
                    { _id: log._id },
                    { incidentIds: incidentIdsOrRetry }
                );
            }
        } else {
            // should make sure all unresolved incidents for the monitor is resolved
            if (data.status === 'online') {
                await this.incidentResolveOrAcknowledge(data, allCriteria);
            }

            const incidents: $TSFixMe = await IncidentService.findBy({
                query: {
                    'monitors.monitorId': data.monitorId,
                    incidentType: data.status,
                    resolved: false,
                },
                select: '_id',
            });

            const incidentIds: $TSFixMe = incidents.map(incident: $TSFixMe => incident._id);

            if (incidentIds && incidentIds.length) {
                log = await MonitorLogService.updateOneBy(
                    { _id: log._id },
                    { incidentIds }
                );
            }
        }
        return log;
    }

public async getMonitorLog(data: $TSFixMe): void {
        const date: $TSFixMe = new Date();

        const selectMonitorLog: $TSFixMe =
            'monitorId probeId status responseTime responseStatus responseBody responseHeader cpuLoad avgCpuLoad cpuCores memoryUsed totalMemory swapUsed storageUsed totalStorage storageUsage mainTemp maxTemp incidentIds createdAt sslCertificate  kubernetesLog scriptMetadata';

        const populateMonitorLog: $TSFixMe = [
            {
                path: 'probeId',
                select: 'createdAt lastAlive probeKey probeName version probeImage deleted',
            },
        ];
        const log: $TSFixMe = await MonitorLogService.findOneBy({
            query: {
                monitorId: data.monitorId,
                probeId: data.probeId,
                createdAt: { $lt: data.date || date },
            },
            select: selectMonitorLog,
            populate: populateMonitorLog,
        });
        return log;
    }

public async incidentCreateOrUpdate(data: $TSFixMe): void {
        const populate: $TSFixMe = [
            {
                path: 'monitors.monitorId',
                select: 'name slug componentId projectId type',
                populate: [
                    { path: 'componentId', select: 'name slug' },
                    { path: 'projectId', select: 'name slug' },
                ],
            },
            { path: 'createdById', select: 'name' },
            { path: 'projectId', select: 'name slug' },
            { path: 'resolvedBy', select: 'name' },
            { path: 'acknowledgedBy', select: 'name' },
            { path: 'incidentPriority', select: 'name color' },
            {
                path: 'acknowledgedByIncomingHttpRequest',
                select: 'name',
            },
            { path: 'resolvedByIncomingHttpRequest', select: 'name' },
            { path: 'createdByIncomingHttpRequest', select: 'name' },
            { path: 'probes.probeId', select: 'name _id' },
        ];

        const select: $TSFixMe =
            'slug notifications acknowledgedByIncomingHttpRequest resolvedByIncomingHttpRequest _id monitors createdById projectId createdByIncomingHttpRequest incidentType resolved resolvedBy acknowledged acknowledgedBy title description incidentPriority criterionCause probes acknowledgedAt resolvedAt manuallyCreated deleted customFields idNumber';

        const [monitor, incidents]: $TSFixMe = await Promise.all([
            MonitorService.findOneBy({
                query: { _id: data.monitorId },
                select: 'type',
            }),
            IncidentService.findBy({
                query: {
                    'monitors.monitorId': data.monitorId,
                    incidentType: data.status,
                    resolved: false,
                    manuallyCreated: false,
                },
                select,
                populate,
            }),
        ]);
        const { matchedCriterion }: $TSFixMe = data;
        let incidentIds: $TSFixMe = [];
        let scripts: $TSFixMe = [];

        if (
            matchedCriterion &&
            matchedCriterion.scripts &&
            matchedCriterion.scripts.length > 0
        ) {
            scripts = matchedCriterion.scripts.map((script: $TSFixMe) =>  {
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
                const internalIncidents: $TSFixMe = [];
                for (let incident of incidents) {
                    if (monitor.type !== 'incomingHttpRequest') {
                        const initialProbes: $TSFixMe = incident.probes.map(probe: $TSFixMe => ({
                            probeId: probe.probeId._id || probe.probeId,
                            updatedAt: probe.updatedAt,
                            status: probe.status,
                            reportedStatus: probe.reportedStatus,
                        }));
                        incident = await IncidentService.updateOneBy(
                            {
                                _id: incident._id,
                            },
                            {
                                probes: [
                                    ...initialProbes,
                                    {
                                        probeId: data.probeId,
                                        updatedAt: Date.now(),
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
                ) {
                    return { retry: true, retryCount: data.retryCount };
                }
                const incident: $TSFixMe = await IncidentService.create({
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
                });

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
                const internalIncidents: $TSFixMe = [];
                for (let incident of incidents) {
                    if (monitor.type !== 'incomingHttpRequest') {
                        const initialProbes: $TSFixMe = incident.probes.map(probe: $TSFixMe => ({
                            probeId: probe.probeId._id || probe.probeId,
                            updatedAt: probe.updatedAt,
                            status: probe.status,
                            reportedStatus: probe.reportedStatus,
                        }));
                        incident = await IncidentService.updateOneBy(
                            {
                                _id: incident._id,
                            },
                            {
                                probes: [
                                    ...initialProbes,
                                    {
                                        probeId: data.probeId,
                                        updatedAt: Date.now(),
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
                ) {
                    return { retry: true, retryCount: data.retryCount };
                }
                const incident: $TSFixMe = await IncidentService.create({
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
                });

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
                const internalIncidents: $TSFixMe = [];
                for (let incident of incidents) {
                    if (monitor.type !== 'incomingHttpRequest') {
                        const initialProbes: $TSFixMe = incident.probes.map(probe: $TSFixMe => ({
                            probeId: probe.probeId._id || probe.probeId,
                            updatedAt: probe.updatedAt,
                            status: probe.status,
                            reportedStatus: probe.reportedStatus,
                        }));
                        incident = await IncidentService.updateOneBy(
                            {
                                _id: incident._id,
                            },
                            {
                                probes: [
                                    ...initialProbes,
                                    {
                                        probeId: data.probeId,
                                        updatedAt: Date.now(),
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
                ) {
                    return { retry: true, retryCount: data.retryCount };
                }

                const incident: $TSFixMe = await IncidentService.create({
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
                });

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
        // incidentIds = await Promise.all(incidentIds);
        incidentIds = incidentIds.map((i: $TSFixMe) =>  i._id);

        return incidentIds;
    }

public async incidentResolveOrAcknowledge(data, allCriteria): void {
        const populate: $TSFixMe = [
            {
                path: 'probes.probeId',
                select: '_id probeId updatedAt status reportedStatus',
            },
        ];

        const select: string = '_id acknowledged criterionCause probes';

        const incidents: $TSFixMe = await IncidentService.findBy({
            query: {
                'monitors.monitorId': data.monitorId,
                resolved: false,
                manuallyCreated: false,
            },
            select,
            populate,
        });

        const monitor: $TSFixMe = await MonitorService.findOneBy({
            query: { _id: data.monitorId },
            select: 'type',
        });

        // should grab all the criterion for the monitor and put them into one array
        // check the id of each criteria against the id of criteria attached to an incident
        // ack / resolve according to the criteria

        let autoAcknowledge: $TSFixMe, autoResolve: $TSFixMe;
        if (incidents && incidents.length > 0) {
            incidents.forEach((incident: $TSFixMe) => {
                let criteriaId: $TSFixMe = null;
                if (
                    incident &&
                    incident.criterionCause &&
                    incident.criterionCause._id
                ) {
                    criteriaId = String(incident.criterionCause._id);
                }

                allCriteria.forEach((criteria: $TSFixMe) => {
                    if (
                        String(criteria._id) === criteriaId ||
                        criteria.name === incident.criterionCause.name
                    ) {
                        autoAcknowledge = criteria.autoAcknowledge;
                        autoResolve = criteria.autoResolve;
                    }
                });
            });
        }

        const incidentsV1: $TSFixMe = [];

        const incidentsV2: $TSFixMe = [];

        if (incidents && incidents.length) {
            // is this check needed at all??
            // if (lastStatus && lastStatus !== data.status) {

            incidents.forEach((incident: $TSFixMe) => {
                if (
                    incident.probes &&
                    incident.probes.length > 0 &&
                    monitor.type !== 'incomingHttpRequest'
                ) {
                    incident.probes.some((probe: $TSFixMe) => {
                        if (
                            probe.probeId &&
                            String(probe.probeId._id || probe.probeId) ===
                                String(data.probeId)
                        ) {
                            incidentsV1.push(incident);
                            return true;
                        } else {
                            return false;
                        }
                    });
                } else {
                    incidentsV1.push(incident);
                    return true;
                }
            });
            // }
        }
        await Promise.all(
            incidentsV1.map(async (incident: $TSFixMe) => {
                if (
                    incident.probes &&
                    incident.probes.length > 0 &&
                    monitor.type !== 'incomingHttpRequest'
                ) {
                    const initialProbes: $TSFixMe = incident.probes.map(probe: $TSFixMe => ({
                        probeId: probe.probeId._id || probe.probeId,
                        updatedAt: probe.updatedAt,
                        status: probe.status,
                        reportedStatus: probe.reportedStatus,
                    }));
                    const newIncident: $TSFixMe = await IncidentService.updateOneBy(
                        {
                            _id: incident._id,
                        },
                        {
                            probes: [
                                ...initialProbes,
                                {
                                    probeId: data.probeId,
                                    updatedAt: Date.now(),
                                    status: false,
                                    reportedStatus: data.status,
                                },
                            ],
                        }
                    );
                    incidentsV2.push(newIncident);

                    await IncidentTimelineService.create({
                        incidentId: incident._id,
                        probeId: data.probeId,
                        status: data.status,
                    });

                    return newIncident;
                } else {
                    incidentsV2.push(incident);

                    return incident;
                }
            })
        );

        await forEach(incidentsV2, async (incident: $TSFixMe) => {
            const trueArray: $TSFixMe = [];
            const falseArray: $TSFixMe = [];

            incident.probes.forEach((probe: $TSFixMe) => {
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
                if (autoAcknowledge) {
                    if (!incident.acknowledged) {
                        await IncidentService.acknowledge(
                            incident._id,
                            null,
                            'oneuptime',
                            data.probeId
                        );
                    }
                }

                if (autoResolve) {
                    await IncidentService.resolve(
                        incident._id,
                        null,
                        'oneuptime',
                        data.probeId
                    );
                }
            }
        });
        return {};
    }

public async updateProbeStatus(probeId: $TSFixMe): void {
        const probe: $TSFixMe = await ProbeModel.findOneAndUpdate(
            { _id: probeId },
            { $set: { lastAlive: Date.now() } },
            { new: true }
        );
        return probe;
    }

    scriptConditions(resp, con): void {
        const body: $TSFixMe = resp ?? null;

        const successReasons: $TSFixMe = [];

        const failedReasons: $TSFixMe = [];

        let eventOccurred: $TSFixMe = false;
        let matchedCriterion: $TSFixMe;
        if (con && con.length) {
            eventOccurred = con.some((condition: $TSFixMe) => {
                let stat: $TSFixMe = true;
                if (
                    condition &&
                    condition.criteria &&
                    condition.criteria.condition &&
                    condition.criteria.condition === 'and'
                ) {
                    stat = checkScriptAnd(
                        condition.criteria,
                        body,

                        successReasons,

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

                        successReasons,

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

            successReasons,

            failedReasons,
            matchedCriterion,
        };
    }

    conditions(monitorType, con, payload, resp, response): void {
        const status: $TSFixMe = resp
            ? resp.status
                ? resp.status
                : resp.statusCode
                ? resp.statusCode
                : null
            : null;
        const body: $TSFixMe = resp && resp.body ? resp.body : null;
        const queryParams: $TSFixMe = resp && resp.queryParams ? resp.queryParams : null;
        const headers: $TSFixMe = resp && resp.headers ? resp.headers : null;
        const sslCertificate: $TSFixMe =
            resp && resp.sslCertificate ? resp.sslCertificate : null;

        const successReasons: $TSFixMe = [];

        const failedReasons: $TSFixMe = [];

        let eventOccurred: $TSFixMe = false;
        let matchedCriterion: $TSFixMe;

        if (con && con.length) {
            eventOccurred = some(con, (condition: $TSFixMe) => {
                let stat: $TSFixMe = true;
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

                        successReasons,

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

                        successReasons,

                        failedReasons,
                        monitorType,
                        queryParams,
                        headers
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

            successReasons,

            failedReasons,
            matchedCriterion,
        };
    }

    incomingCondition(payload, conditions): void {
        let eventOccurred: $TSFixMe = false;
        let matchedCriterion: $TSFixMe;
        if (conditions && conditions.length) {
            eventOccurred = some(conditions, (condition: $TSFixMe) => {
                let response: $TSFixMe = false;
                let respAnd: $TSFixMe = false,
                    respOr = false,
                    countAnd = 0,
                    countOr = 0;

                if (
                    condition &&
                    condition.criteria &&
                    condition.criteria.condition &&
                    condition.criteria.condition === 'and'
                ) {
                    respAnd = incomingCheckAnd(payload, condition.criteria);
                    countAnd++;
                }
                if (
                    condition &&
                    condition.criteria &&
                    condition.criteria.condition &&
                    condition.criteria.condition === 'or'
                ) {
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
    }

    toArray(params: $TSFixMe): void {
        const array: $TSFixMe = [];
        if (Object.keys(params).length > 0) {
            for (const [key, value] of Object.entries(params)) {
                array.push(key.toLowerCase() + '=' + value.toLowerCase());
            }
            return array;
        }
        return null;
    }

public async processHttpRequest(data: $TSFixMe): void {
        const { monitor, body }: $TSFixMe = data;
        let {queryParams, headers}: $TSFixMe = data;
        queryParams = this.toArray(queryParams);
        headers = this.toArray(headers);
        let status: $TSFixMe, reason: $TSFixMe;
        let matchedCriterion: $TSFixMe;
        const lastPingTime: $TSFixMe = monitor.lastPingTime;
        const payload: $TSFixMe = moment().diff(moment(lastPingTime), 'minutes');
        const {
            stat: validUp,
            successReasons: upSuccessReasons,
            failedReasons: upFailedReasons,
            matchedCriterion: matchedUpCriterion,
        } = await (monitor && monitor.criteria && monitor.criteria.up
            ? this.conditions(monitor.type, monitor.criteria.up, payload, {
                  body,
                  queryParams,
                  headers,
              })
            : { stat: false, successReasons: [], failedReasons: [] });
        const {
            stat: validDegraded,
            successReasons: degradedSuccessReasons,
            failedReasons: degradedFailedReasons,
            matchedCriterion: matchedDegradedCriterion,
        } = await (monitor && monitor.criteria && monitor.criteria.degraded
            ? this.conditions(
                  monitor.type,
                  monitor.criteria.degraded,
                  payload,
                  {
                      body,
                      queryParams,
                      headers,
                  }
              )
            : { stat: false, successReasons: [], failedReasons: [] });
        const {
            stat: validDown,
            successReasons: downSuccessReasons,
            failedReasons: downFailedReasons,
            matchedCriterion: matchedDownCriterion,
        } = await (monitor && monitor.criteria && monitor.criteria.down
            ? this.conditions(monitor.type, monitor.criteria.down, payload, {
                  body,
                  queryParams,
                  headers,
              })
            : { stat: false, successReasons: [], failedReasons: [] });

        if (validUp) {
            status = 'online';
            reason = upSuccessReasons;
            matchedCriterion = matchedUpCriterion;
        } else if (validDegraded) {
            status = 'degraded';
            reason = [...degradedSuccessReasons, ...upFailedReasons];
            matchedCriterion = matchedDegradedCriterion;
        } else if (validDown) {
            status = 'offline';
            reason = [
                ...downSuccessReasons,
                ...degradedFailedReasons,
                ...upFailedReasons,
            ];
            matchedCriterion = matchedDownCriterion;
        } else {
            status = 'offline';
            reason = [
                ...downFailedReasons,
                ...degradedFailedReasons,
                ...upFailedReasons,
            ];
            if (monitor.criteria.down) {
                matchedCriterion = monitor.criteria.down.find(
                    criterion => criterion.default === true
                );
            }
        }
        const index: $TSFixMe = reason.indexOf('Request Timed out');
        if (index > -1) {
            reason = reason.filter((item: $TSFixMe) => !item.includes('Response Time is'));
        }
        reason = reason.filter((item: $TSFixMe, pos: $TSFixMe,  self: $TSFixMe)self.indexOf(item) === pos);
        const logData: $TSFixMe = body;
        logData.responseTime = 0;
        logData.responseStatus = null;
        logData.status = status;
        logData.probeId = null;
        logData.monitorId =
            monitor && monitor.id
                ? monitor.id
                : monitor._id
                ? monitor._id
                : null;
        logData.sslCertificate = null;
        logData.lighthouseScanStatus = null;
        logData.performance = null;
        logData.accessibility = null;
        logData.bestPractices = null;
        logData.seo = null;
        logData.pwa = null;
        logData.lighthouseData = null;
        logData.retryCount = 3;
        logData.reason = reason;
        logData.response = null;
        logData.matchedCriterion = matchedCriterion;
        logData.matchedUpCriterion =
            monitor && monitor.criteria && monitor.criteria.up;
        logData.matchedDownCriterion =
            monitor && monitor.criteria && monitor.criteria.down;
        logData.matchedDegradedCriterion =
            monitor && monitor.criteria && monitor.criteria.degraded;
        // update monitor to save the last matched criterion

        const [, log]: $TSFixMe = await Promise.all([
            MonitorService.updateCriterion(monitor._id, matchedCriterion),
            this.saveMonitorLog(logData),
            MonitorService.updateMonitorPingTime(monitor._id),
        ]);
        return log;
    }

public async probeHttpRequest(monitor, probeId): void {
        let status: $TSFixMe, reason: $TSFixMe;
        let matchedCriterion: $TSFixMe;
        const lastPingTime: $TSFixMe = monitor.lastPingTime;
        const payload: $TSFixMe = moment().diff(moment(lastPingTime), 'minutes');

        const { eventOccurred: validUp, matchedCriterion: matchedUpCriterion } =
            monitor && monitor.criteria && monitor.criteria.up
                ? this.incomingCondition(payload, monitor.criteria.up)
                : false;

        const {
            eventOccurred: validDegraded,

            matchedCriterion: matchedDegradedCriterion,
        } =
            monitor && monitor.criteria && monitor.criteria.degraded
                ? this.incomingCondition(payload, monitor.criteria.degraded)
                : false;

        const {
            eventOccurred: validDown,

            matchedCriterion: matchedDownCriterion,
        } =
            monitor && monitor.criteria && monitor.criteria.down
                ? this.incomingCondition(payload, [
                      ...monitor.criteria.down.filter(
                          criterion => criterion.default !== true
                      ),
                  ])
                : false;
        let timeHours: $TSFixMe = 0;
        let timeMinutes: $TSFixMe = payload;
        let tempReason: string = `${payload} min`;
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
                    criterion => criterion.default === true
                );
            }
        }
        const logData: $TSFixMe = {};

        logData.responseTime = 0;

        logData.responseStatus = null;

        logData.status = status;

        logData.probeId = probeId;

        logData.monitorId =
            monitor && monitor.id
                ? monitor.id
                : monitor._id
                ? monitor._id
                : null;

        logData.sslCertificate = null;

        logData.lighthouseScanStatus = null;

        logData.performance = null;

        logData.accessibility = null;

        logData.bestPractices = null;

        logData.seo = null;

        logData.pwa = null;

        logData.lighthouseData = null;

        logData.retryCount = 3;

        logData.reason = reason;

        logData.response = null;

        logData.stopPingTimeUpdate = true;

        logData.matchedCriterion = matchedCriterion;

        // update monitor to save the last matched criterion
        const [, log]: $TSFixMe = await Promise.all([
            MonitorService.updateCriterion(monitor._id, matchedCriterion),

            this.saveMonitorLog(logData),
        ]);

        return log;
    }
}

import _ from 'lodash';
import CreateBy from '../Types/DB/CreateBy';
import UUID from 'Common/Utils/UUID';

const incomingCheckAnd: Function = (payload, condition): void => {
    let validity: $TSFixMe = false;
    let val: $TSFixMe = 0;
    let incomingVal: $TSFixMe = 0;
    if (condition && condition.criteria && condition.criteria.length > 0) {
        for (let i: $TSFixMe = 0; i < condition.criteria.length; i++) {
            if (
                condition.criteria[i].criteria &&
                condition.criteria[i].criteria.length > 0
            ) {
                if (
                    condition.criteria[i].condition &&
                    condition.criteria[i].condition === 'and'
                ) {
                    // incoming check and
                    const tempAnd: $TSFixMe = incomingCheckAnd(
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
                    const tempOr: $TSFixMe = incomingCheckOr(
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

const incomingCheckOr: Function = (payload, condition): void => {
    let validity: $TSFixMe = false;
    let val: $TSFixMe = 0;
    let incomingVal: $TSFixMe = 0;
    if (condition && condition.criteria && condition.criteria.length > 0) {
        for (let i: $TSFixMe = 0; i < condition.criteria.length; i++) {
            if (
                condition.criteria[i].criteria &&
                condition.criteria[i].criteria.length > 0
            ) {
                if (
                    condition.criteria[i].condition &&
                    condition.criteria[i].condition === 'or'
                ) {
                    // incoming check or
                    const tempor: $TSFixMe = incomingCheckAnd(
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
                    const tempAnd: $TSFixMe = incomingCheckAnd(
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

const checkAnd: Function = (
    payload,

    con,

    statusCode,

    body,

    ssl,

    response,

    successReasons,

    failedReasons,

    type,

    queryParams,

    headers
): void => {
    let validity: $TSFixMe = true;
    if (con && con.criteria && con.criteria.length > 0) {
        for (let i: $TSFixMe = 0; i < con.criteria.length; i++) {
            if (
                con.criteria[i].criteria &&
                con.criteria[i].criteria.length > 0
            ) {
                if (
                    con.criteria[i].condition &&
                    con.criteria[i].condition === 'and'
                ) {
                    // check and again

                    const temp: $TSFixMe = checkAnd(
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

                    const temp1: $TSFixMe = checkOr(
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
                let tempReason: string = `${payload} min`;
                if (
                    con.criteria[i] &&
                    con.criteria[i].responseType &&
                    con.criteria[i].responseType === 'incomingTime'
                ) {
                    let timeHours: $TSFixMe = 0;
                    let timeMinutes: $TSFixMe = payload;
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
                                payload > con.criteria[i].field1
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
                                payload < con.criteria[i].field1
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
                                payload > con.criteria[i].field1 &&
                                payload < con.criteria[i].field2
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
                                payload == con.criteria[i].field1
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
                                payload != con.criteria[i].field1
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
                                payload >= con.criteria[i].field1
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
                                payload <= con.criteria[i].field1
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
                                `${
                                    criteriaStrings[type] || 'Monitor was'
                                } Offline`
                            );
                        } else {
                            successReasons.push(
                                `${
                                    criteriaStrings[type] || 'Monitor was'
                                } Online`
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
                                `${
                                    criteriaStrings[type] || 'Monitor was'
                                } Online`
                            );
                        } else {
                            successReasons.push(
                                `${
                                    criteriaStrings[type] || 'Monitor was'
                                } Offline`
                            );
                        }
                    }
                } else if (
                    con.criteria[i] &&
                    con.criteria[i].responseType === 'ssl'
                ) {
                    const expiresIn: $TSFixMe = moment(
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
                    if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'greaterThan'
                    ) {
                        if (
                            !(
                                con.criteria[i] &&
                                con.criteria[i].field1 &&
                                statusCode &&
                                statusCode > con.criteria[i].field1
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
                                con.criteria[i].field1 &&
                                statusCode &&
                                statusCode < con.criteria[i].field1
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
                                con.criteria[i].field1 &&
                                statusCode &&
                                con.criteria[i].field2 &&
                                statusCode > con.criteria[i].field1 &&
                                statusCode < con.criteria[i].field2
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
                                con.criteria[i].field1 &&
                                statusCode &&
                                statusCode == con.criteria[i].field1
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
                                con.criteria[i].field1 &&
                                statusCode &&
                                statusCode != con.criteria[i].field1
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
                                con.criteria[i].field1 &&
                                statusCode &&
                                statusCode >= con.criteria[i].field1
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
                                con.criteria[i].field1 &&
                                statusCode &&
                                statusCode <= con.criteria[i].field1
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
                                    `${criteriaStrings.cpuLoad} ${formatDecimal(
                                        payload.cpuLoad,
                                        2
                                    )} %`
                                );
                            }
                        } else {
                            if (payload && payload.cpuLoad !== null) {
                                successReasons.push(
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
                                    `${criteriaStrings.cpuLoad} ${formatDecimal(
                                        payload.cpuLoad,
                                        2
                                    )} %`
                                );
                            }
                        } else {
                            if (payload && payload.cpuLoad !== null) {
                                successReasons.push(
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
                                    `${criteriaStrings.cpuLoad} ${formatDecimal(
                                        payload.cpuLoad,
                                        2
                                    )} %`
                                );
                            }
                        } else {
                            if (payload && payload.cpuLoad !== null) {
                                successReasons.push(
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
                                    `${criteriaStrings.cpuLoad} ${formatDecimal(
                                        payload.cpuLoad,
                                        2
                                    )} %`
                                );
                            }
                        } else {
                            if (payload && payload.cpuLoad !== null) {
                                successReasons.push(
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
                                    `${criteriaStrings.cpuLoad} ${formatDecimal(
                                        payload.cpuLoad,
                                        2
                                    )} %`
                                );
                            }
                        } else {
                            if (payload && payload.cpuLoad !== null) {
                                successReasons.push(
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
                                    `${criteriaStrings.cpuLoad} ${formatDecimal(
                                        payload.cpuLoad,
                                        2
                                    )} %`
                                );
                            }
                        } else {
                            if (payload && payload.cpuLoad !== null) {
                                successReasons.push(
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
                                    `${criteriaStrings.cpuLoad} ${formatDecimal(
                                        payload.cpuLoad,
                                        2
                                    )} %`
                                );
                            }
                        } else {
                            if (payload && payload.cpuLoad !== null) {
                                successReasons.push(
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
                    const memoryUsedBytes: $TSFixMe = payload
                        ? parseInt(payload.memoryUsed || 0)
                        : 0;
                    const memoryUsed: $TSFixMe = memoryUsedBytes / Math.pow(1e3, 3);
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
                                    } ${formatBytes(memoryUsedBytes)}`
                                );
                            }
                        } else {
                            if (payload && payload.memoryUsed !== null) {
                                successReasons.push(
                                    `${
                                        criteriaStrings.memoryUsed
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
                                    } ${formatBytes(memoryUsedBytes)}`
                                );
                            }
                        } else {
                            if (payload && payload.memoryUsed !== null) {
                                successReasons.push(
                                    `${
                                        criteriaStrings.memoryUsed
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
                                    } ${formatBytes(memoryUsedBytes)}`
                                );
                            }
                        } else {
                            if (payload && payload.memoryUsed !== null) {
                                successReasons.push(
                                    `${
                                        criteriaStrings.memoryUsed
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
                                    } ${formatBytes(memoryUsedBytes)}`
                                );
                            }
                        } else {
                            if (payload && payload.memoryUsed !== null) {
                                successReasons.push(
                                    `${
                                        criteriaStrings.memoryUsed
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
                                    } ${formatBytes(memoryUsedBytes)}`
                                );
                            }
                        } else {
                            if (payload && payload.memoryUsed !== null) {
                                successReasons.push(
                                    `${
                                        criteriaStrings.memoryUsed
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
                                    } ${formatBytes(memoryUsedBytes)}`
                                );
                            }
                        } else {
                            if (payload && payload.memoryUsed !== null) {
                                successReasons.push(
                                    `${
                                        criteriaStrings.memoryUsed
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
                                    } ${formatBytes(memoryUsedBytes)}`
                                );
                            }
                        } else {
                            if (payload && payload.memoryUsed !== null) {
                                successReasons.push(
                                    `${
                                        criteriaStrings.memoryUsed
                                    } ${formatBytes(memoryUsedBytes)}`
                                );
                            }
                        }
                    }
                } else if (
                    con.criteria[i] &&
                    con.criteria[i].responseType === 'storageUsage'
                ) {
                    const size: $TSFixMe = payload
                        ? parseInt(payload.totalStorage || 0)
                        : 0;
                    const used: $TSFixMe = payload
                        ? parseInt(payload.storageUsed || 0)
                        : 0;
                    const freeBytes: $TSFixMe = size - used;
                    const free: $TSFixMe = freeBytes / Math.pow(1e3, 3);
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
                        const ctx: $TSFixMe = Object.create(null); // fix against prototype vulnerability
                        ctx.request = { body };
                        const output: $TSFixMe = vm.runInNewContext(
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
                        const responseDisplay: $TSFixMe = con.criteria[i].field1
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
                                        '"use strict";const  response: string = ' +
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
                    const healthyPods: $TSFixMe = ['running', 'pending', 'succeeded'];
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
                            // eslint-disable-next-line no-loop-func
                            payload.podData.allPods.forEach((pod: $TSFixMe) => {
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
                            // eslint-disable-next-line no-loop-func
                            payload.podData.allPods.forEach((pod: $TSFixMe) => {
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
                    const healthyJobs: $TSFixMe = ['running', 'succeeded'];
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
                            // eslint-disable-next-line no-loop-func
                            payload.jobData.allJobs.forEach((job: $TSFixMe) => {
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
                            // eslint-disable-next-line no-loop-func
                            payload.jobData.allJobs.forEach((job: $TSFixMe) => {
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
                                `${
                                    criteriaStrings[type] || 'Monitor was'
                                } Offline`
                            );
                        } else {
                            successReasons.push(
                                `${
                                    criteriaStrings[type] || 'Monitor was'
                                } Online`
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
                                `${
                                    criteriaStrings[type] || 'Monitor was'
                                } Online`
                            );
                        } else {
                            successReasons.push(
                                `${
                                    criteriaStrings[type] || 'Monitor was'
                                } Offline`
                            );
                        }
                    }
                }
            }
        }
    }

    return validity;
};

const checkOr: Function = (
    payload,

    con,

    statusCode,

    body,

    ssl,

    response,

    successReasons,

    failedReasons,

    type,

    queryParams,

    headers
): void => {
    let validity: $TSFixMe = false;
    if (con && con.criteria && con.criteria.length > 0) {
        for (let i: $TSFixMe = 0; i < con.criteria.length; i++) {
            if (
                con.criteria[i].criteria &&
                con.criteria[i].criteria.length > 0
            ) {
                if (
                    con.criteria[i].condition &&
                    con.criteria[i].condition === 'or'
                ) {
                    // check or again

                    const temp1: $TSFixMe = checkOr(
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
                    const temp: $TSFixMe = checkAnd(
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
                let tempReason: string = `${payload} min`;
                if (
                    con.criteria[i] &&
                    con.criteria[i].responseType &&
                    con.criteria[i].responseType === 'incomingTime'
                ) {
                    let timeHours: $TSFixMe = 0;
                    let timeMinutes: $TSFixMe = payload;
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
                            payload > con.criteria[i].field1
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
                            payload < con.criteria[i].field1
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
                            payload > con.criteria[i].field1 &&
                            payload < con.criteria[i].field2
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
                            payload == con.criteria[i].field1
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
                            payload != con.criteria[i].field1
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
                            payload >= con.criteria[i].field1
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
                            payload <= con.criteria[i].field1
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
                                `${
                                    criteriaStrings[type] || 'Monitor was'
                                } Online`
                            );
                        } else {
                            failedReasons.push(
                                `${
                                    criteriaStrings[type] || 'Monitor was'
                                } Offline`
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
                                `${
                                    criteriaStrings[type] || 'Monitor was'
                                } Offline`
                            );
                        } else {
                            failedReasons.push(
                                `${
                                    criteriaStrings[type] || 'Monitor was'
                                } Online`
                            );
                        }
                    }
                } else if (
                    con.criteria[i] &&
                    con.criteria[i].responseType === 'ssl'
                ) {
                    const expiresIn: $TSFixMe = moment(
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
                                    `${criteriaStrings.cpuLoad} ${formatDecimal(
                                        payload.cpuLoad,
                                        2
                                    )} %`
                                );
                            }
                        } else {
                            if (payload && payload.cpuLoad !== null) {
                                failedReasons.push(
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
                                    `${criteriaStrings.cpuLoad} ${formatDecimal(
                                        payload.cpuLoad,
                                        2
                                    )} %`
                                );
                            }
                        } else {
                            if (payload && payload.cpuLoad !== null) {
                                failedReasons.push(
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
                                    `${criteriaStrings.cpuLoad} ${formatDecimal(
                                        payload.cpuLoad,
                                        2
                                    )} %`
                                );
                            }
                        } else {
                            if (payload && payload.cpuLoad !== null) {
                                failedReasons.push(
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
                                    `${criteriaStrings.cpuLoad} ${formatDecimal(
                                        payload.cpuLoad,
                                        2
                                    )} %`
                                );
                            }
                        } else {
                            if (payload && payload.cpuLoad !== null) {
                                failedReasons.push(
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
                                    `${criteriaStrings.cpuLoad} ${formatDecimal(
                                        payload.cpuLoad,
                                        2
                                    )} %`
                                );
                            }
                        } else {
                            if (payload && payload.cpuLoad !== null) {
                                failedReasons.push(
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
                                    `${criteriaStrings.cpuLoad} ${formatDecimal(
                                        payload.cpuLoad,
                                        2
                                    )} %`
                                );
                            }
                        } else {
                            if (payload && payload.cpuLoad !== null) {
                                failedReasons.push(
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
                                    `${criteriaStrings.cpuLoad} ${formatDecimal(
                                        payload.cpuLoad,
                                        2
                                    )} %`
                                );
                            }
                        } else {
                            if (payload && payload.cpuLoad !== null) {
                                failedReasons.push(
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
                    const memoryUsedBytes: $TSFixMe = payload
                        ? parseInt(payload.memoryUsed || 0)
                        : 0;
                    const memoryUsed: $TSFixMe = memoryUsedBytes / Math.pow(1e3, 3);
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
                                    } ${formatBytes(memoryUsedBytes)}`
                                );
                            }
                        } else {
                            if (payload && payload.memoryUsed !== null) {
                                failedReasons.push(
                                    `${
                                        criteriaStrings.memoryUsed
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
                                    } ${formatBytes(memoryUsedBytes)}`
                                );
                            }
                        } else {
                            if (payload && payload.memoryUsed !== null) {
                                failedReasons.push(
                                    `${
                                        criteriaStrings.memoryUsed
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
                                    } ${formatBytes(memoryUsedBytes)}`
                                );
                            }
                        } else {
                            if (payload && payload.memoryUsed !== null) {
                                failedReasons.push(
                                    `${
                                        criteriaStrings.memoryUsed
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
                                    } ${formatBytes(memoryUsedBytes)}`
                                );
                            }
                        } else {
                            if (payload && payload.memoryUsed !== null) {
                                failedReasons.push(
                                    `${
                                        criteriaStrings.memoryUsed
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
                                    } ${formatBytes(memoryUsedBytes)}`
                                );
                            }
                        } else {
                            if (payload && payload.memoryUsed !== null) {
                                failedReasons.push(
                                    `${
                                        criteriaStrings.memoryUsed
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
                                    } ${formatBytes(memoryUsedBytes)}`
                                );
                            }
                        } else {
                            if (payload && payload.memoryUsed !== null) {
                                failedReasons.push(
                                    `${
                                        criteriaStrings.memoryUsed
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
                                    } ${formatBytes(memoryUsedBytes)}`
                                );
                            }
                        } else {
                            if (payload && payload.memoryUsed !== null) {
                                failedReasons.push(
                                    `${
                                        criteriaStrings.memoryUsed
                                    } ${formatBytes(memoryUsedBytes)}`
                                );
                            }
                        }
                    }
                } else if (
                    con.criteria[i] &&
                    con.criteria[i].responseType === 'storageUsage'
                ) {
                    const size: $TSFixMe = payload
                        ? parseInt(payload.totalStorage || 0)
                        : 0;
                    const used: $TSFixMe = payload
                        ? parseInt(payload.storageUsed || 0)
                        : 0;
                    const freeBytes: $TSFixMe = size - used;
                    const free: $TSFixMe = freeBytes / Math.pow(1e3, 3);
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
                        const ctx: $TSFixMe = Object.create(null); // fix against prototype vulnerability
                        ctx.request = { body };
                        const output: $TSFixMe = vm.runInNewContext(
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
                        const responseDisplay: $TSFixMe = con.criteria[i].field1
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
                                    '"use strict";const  response: string = ' +
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
                    const healthyPods: $TSFixMe = ['running', 'pending', 'succeeded'];
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
                            // eslint-disable-next-line no-loop-func
                            payload.podData.allPods.forEach((pod: $TSFixMe) => {
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
                            // eslint-disable-next-line no-loop-func
                            payload.podData.allPods.forEach((pod: $TSFixMe) => {
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
                    const healthyJobs: $TSFixMe = ['running', 'succeeded'];
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
                            // eslint-disable-next-line no-loop-func
                            payload.jobData.allJobs.forEach((job: $TSFixMe) => {
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
                            // eslint-disable-next-line no-loop-func
                            payload.jobData.allJobs.forEach((job: $TSFixMe) => {
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
                                `${
                                    criteriaStrings[type] || 'Monitor was'
                                } Online`
                            );
                        } else {
                            failedReasons.push(
                                `${
                                    criteriaStrings[type] || 'Monitor was'
                                } Offline`
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
                                `${
                                    criteriaStrings[type] || 'Monitor was'
                                } Offline`
                            );
                        } else {
                            failedReasons.push(
                                `${
                                    criteriaStrings[type] || 'Monitor was'
                                } Online`
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

const checkScriptCondition: Function = (condition, body): void => {
    if (!condition || !condition.responseType) {
        return;
    }
    /**
     * @type { {valid : boolean, reason : string}}
     */
    const validity: $TSFixMe = {};

    if (!condition.filter || !body || !condition.responseType) {
        return;
    }

    if (condition.responseType === 'scriptExecution') {
        // we need a catch-all for server-defined
        // script timeout errors or terminated scripts
        if (body.statusText === 'timeout') {
            validity.valid = false;

            validity.reason = body.error;
            return validity;
        }

        if (condition.filter === 'throwsError') {
            if (body.statusText === 'failed' && body.error) {
                validity.valid = true;

                validity.reason = `Script threw error ${body.error}`;
            } else {
                validity.valid = false;

                validity.reason = `Script did not throw error`;
            }
        } else if (condition.filter === 'doesNotThrowError') {
            if (body.statusText === 'failed' && body.error) {
                validity.valid = false;

                validity.reason = `Script threw error ${body.error}`;
            } else {
                validity.valid = true;

                validity.reason = `Script did not throw error`;
            }
        } else if (condition.filter === 'emptyCallback') {
            if (body.statusText === 'nonEmptyCallback' && body.error) {
                validity.valid = false;

                validity.reason = `Script callback invoked with arguments ${JSON.stringify(
                    body.error
                )}`;
            } else {
                validity.valid = true;

                validity.reason = `Script callback has no arguments`;
            }
        } else if (condition.filter === 'nonEmptyCallback') {
            if (body.statusText === 'nonEmptyCallback' && body.error) {
                validity.valid = true;

                validity.reason = `Script callback invoked with arguments ${JSON.stringify(
                    body.error
                )}`;
            } else {
                validity.valid = false;

                validity.reason = `Script callback has no arguments`;
            }
        }
    } else if (condition.responseType === 'executionTime') {
        if (condition.filter === 'executesIn') {
            if (body.executionTime <= condition.filter1) {
                validity.valid = true;

                validity.reason = `Script executed in ${body.executionTime}ms within ${condition.filter1}ms limit`;
            } else {
                validity.valid = false;

                validity.reason = `Script executed above ${condition.filter1}ms limit`;
            }
        } else if (condition.filter === 'doesNotExecuteIn') {
            if (body.executionTime >= condition.filter1) {
                validity.valid = true;

                validity.reason = `Script executed in ${body.executionTime}ms above ${condition.filter1}ms minimum`;
            } else {
                validity.valid = false;

                validity.reason = `Script executed below ${condition.filter1}ms minimum`;
            }
        }
    } else {
        // if for some strange reason
        return;
    }

    return validity;
};

const checkScriptAnd: Function = (
    con,
    body,
    successReasons,
    failedReasons
): void => {
    let valid: $TSFixMe = true;
    if (con && con.criteria && con.criteria.length > 0) {
        for (let i: $TSFixMe = 0; i < con.criteria.length; i++) {
            if (
                con.criteria[i].criteria &&
                con.criteria[i].criteria.length > 0
            ) {
                if (
                    con.criteria[i].condition &&
                    con.criteria[i].condition === 'and'
                ) {
                    // check script and
                    const subConditionValid: $TSFixMe = checkScriptAnd(
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
                    const subConditionValid: $TSFixMe = checkScriptOr(
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
                const validity: $TSFixMe = checkScriptCondition(con.criteria[i], body);
                if (validity) {
                    if (validity.valid) {
                        successReasons.push(validity.reason);
                    } else {
                        valid = false;

                        failedReasons.push(validity.reason);
                    }
                }
            }
        }
    }

    return valid;
};

const checkScriptOr: Function = (
    con,
    body,
    successReasons,
    failedReasons
): void => {
    let valid: $TSFixMe = false;
    if (con && con.criteria && con.criteria.length > 0) {
        for (let i: $TSFixMe = 0; i < con.criteria.length; i++) {
            if (
                con.criteria[i].criteria &&
                con.criteria[i].criteria.length > 0
            ) {
                if (
                    con.criteria[i].condition &&
                    con.criteria[i].condition === 'or'
                ) {
                    // check script or
                    const subConditionValid: $TSFixMe = checkScriptOr(
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
                    const subConditionValid: $TSFixMe = checkScriptAnd(
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
                const validity: $TSFixMe = checkScriptCondition(con.criteria[i], body);
                if (validity) {
                    if (validity.valid) {
                        valid = true;

                        successReasons.push(validity.reason);
                    } else {
                        failedReasons.push(validity.reason);
                    }
                }
            }
        }
    }

    return valid;
};

const criteriaStrings: $TSFixMe = {
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

const formatDecimal: Function = (value, decimalPlaces, roundType): void => {
    let formattedNumber: $TSFixMe;
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

const formatBytes: Function = (a, b, c, d, e): void => {
    let value: $TSFixMe = a;
    let decimalPlaces: $TSFixMe;
    let roundType: $TSFixMe;
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
