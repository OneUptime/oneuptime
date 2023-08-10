import BadDataException from 'Common/Types/Exception/BadDataException';
import {
    CheckOn,
    CriteriaFilter,
    FilterCondition,
    FilterType,
} from 'Common/Types/Monitor/CriteriaFilter';
import MonitorCriteria from 'Common/Types/Monitor/MonitorCriteria';
import MonitorCriteriaInstance from 'Common/Types/Monitor/MonitorCriteriaInstance';
import MonitorStep from 'Common/Types/Monitor/MonitorStep';
import MonitorSteps from 'Common/Types/Monitor/MonitorSteps';
import ProbeApiIngestResponse from 'Common/Types/Probe/ProbeApiIngestResponse';
import ProbeMonitorResponse from 'Common/Types/Probe/ProbeMonitorResponse';
import Typeof from 'Common/Types/Typeof';
import MonitorService from '../../Services/MonitorService';
import MonitorStatusTimelineService from '../../Services/MonitorStatusTimelineService';
import IncidentService from '../../Services/IncidentService';
import logger from '../../Utils/Logger';
import Incident from 'Model/Models/Incident';
import Monitor from 'Model/Models/Monitor';
import MonitorStatusTimeline from 'Model/Models/MonitorStatusTimeline';
import ObjectID from 'Common/Types/ObjectID';
import { JSONObject } from 'Common/Types/JSON';
import MonitorProbeService from '../../Services/MonitorProbeService';
import OneUptimeDate from 'Common/Types/Date';
import MonitorProbe from 'Model/Models/MonitorProbe';
import IncidentStateTimeline from 'Model/Models/IncidentStateTimeline';
import IncidentStateTimelineService from '../../Services/IncidentStateTimelineService';
import { LIMIT_PER_PROJECT } from 'Common/Types/Database/LimitMax';
import Dictionary from 'Common/Types/Dictionary';
import IncidentSeverity from 'Model/Models/IncidentSeverity';
import IncidentSeverityService from '../../Services/IncidentSeverityService';
import SortOrder from 'Common/Types/Database/SortOrder';
import OnCallDutyPolicy from 'Model/Models/OnCallDutyPolicy';
import IncomingMonitorRequest from 'Common/Types/Monitor/IncomingMonitor/IncomingMonitorRequest';
import MonitorType from 'Common/Types/Monitor/MonitorType';

export default class ProbeMonitorResponseService {
    public static async processProbeResponse(
        dataToProcess: ProbeMonitorResponse | IncomingMonitorRequest
    ): Promise<ProbeApiIngestResponse> {
        let response: ProbeApiIngestResponse = {
            monitorId: dataToProcess.monitorId,
            criteriaMetId: undefined,
            rootCause: null,
        };

        // fetch monitor
        const monitor: Monitor | null = await MonitorService.findOneById({
            id: dataToProcess.monitorId,
            select: {
                monitorSteps: true,
                monitorType: true,
                projectId: true,
                disableActiveMonitoring: true,
                currentMonitorStatusId: true,
                _id: true,
            },
            props: {
                isRoot: true,
            },
        });

        if (!monitor) {
            throw new BadDataException('Monitor not found');
        }

        if (monitor.disableActiveMonitoring) {
            throw new BadDataException(
                'Monitor is disabled. Please enable it to start monitoring again.'
            );
        }

        // save the last log to MonitorProbe.

        // get last log. We do this because there are many monitoring steps and we need to store those.

        if (
            monitor.monitorType === MonitorType.API ||
            monitor.monitorType === MonitorType.IP ||
            monitor.monitorType === MonitorType.Ping ||
            monitor.monitorType === MonitorType.Website
        ) {
            dataToProcess = dataToProcess as ProbeMonitorResponse;
            if ((dataToProcess as ProbeMonitorResponse).probeId) {
                const monitorProbe: MonitorProbe | null =
                    await MonitorProbeService.findOneBy({
                        query: {
                            monitorId: monitor.id!,
                            probeId: (dataToProcess as ProbeMonitorResponse)
                                .probeId!,
                        },
                        select: {
                            lastMonitoringLog: true,
                        },
                        props: {
                            isRoot: true,
                        },
                    });

                if (!monitorProbe) {
                    throw new BadDataException(
                        'Probe is not assigned to this monitor'
                    );
                }

                await MonitorProbeService.updateOneBy({
                    query: {
                        monitorId: monitor.id!,
                        probeId: (dataToProcess as ProbeMonitorResponse)
                            .probeId!,
                    },
                    data: {
                        lastMonitoringLog: {
                            ...(monitorProbe.lastMonitoringLog || {}),
                            [(
                                dataToProcess as ProbeMonitorResponse
                            ).monitorStepId.toString()]: {
                                ...JSON.parse(JSON.stringify(dataToProcess)),
                                monitoredAt: OneUptimeDate.getCurrentDate(),
                            },
                        } as any,
                    },
                    props: {
                        isRoot: true,
                    },
                });
            }
        }

        if (
            monitor.monitorType === MonitorType.IncomingRequest &&
            (dataToProcess as IncomingMonitorRequest).incomingRequestReceivedAt
        ) {
            await MonitorService.updateOneById({
                id: monitor.id!,
                data: {
                    incomingRequestReceivedAt: (
                        dataToProcess as IncomingMonitorRequest
                    ).incomingRequestReceivedAt!,
                },
                props: {
                    isRoot: true,
                },
            });
        }

        // TODO: save data to Clickhouse.

        const monitorSteps: MonitorSteps = monitor.monitorSteps!;

        if (
            !monitorSteps.data?.monitorStepsInstanceArray ||
            monitorSteps.data?.monitorStepsInstanceArray.length === 0
        ) {
            // no steps, ignore everything. This happens when the monitor is updated shortly after the probing attempt.
            return response;
        }

        // auto resolve criteria Id's.

        const criteriaInstances: Array<MonitorCriteriaInstance> =
            monitorSteps.data.monitorStepsInstanceArray
                .map((step: MonitorStep) => {
                    return step.data?.monitorCriteria;
                })
                .filter((criteria: MonitorCriteria | undefined) => {
                    return Boolean(criteria);
                })
                .map((criteria: MonitorCriteria | undefined) => {
                    return [
                        ...(criteria?.data?.monitorCriteriaInstanceArray || []),
                    ];
                })
                .flat();

        const autoResolveCriteriaInstanceIdIncidentIdsDictionary: Dictionary<
            Array<string>
        > = {};
        const criteriaInstanceMap: Dictionary<MonitorCriteriaInstance> = {};
        for (const criteriaInstance of criteriaInstances) {
            criteriaInstanceMap[criteriaInstance.data?.id || ''] =
                criteriaInstance;

            if (
                criteriaInstance.data?.incidents &&
                criteriaInstance.data?.incidents.length > 0
            ) {
                for (const incidentTemplate of criteriaInstance.data!
                    .incidents) {
                    if (incidentTemplate.autoResolveIncident) {
                        if (
                            !autoResolveCriteriaInstanceIdIncidentIdsDictionary[
                                criteriaInstance.data.id.toString()
                            ]
                        ) {
                            autoResolveCriteriaInstanceIdIncidentIdsDictionary[
                                criteriaInstance.data.id.toString()
                            ] = [];
                        }

                        autoResolveCriteriaInstanceIdIncidentIdsDictionary[
                            criteriaInstance.data.id.toString()
                        ]?.push(incidentTemplate.id);
                    }
                }
            }
        }

        const monitorStep: MonitorStep | undefined =
            monitorSteps.data.monitorStepsInstanceArray[0];

        if ((dataToProcess as ProbeMonitorResponse).monitorStepId) {
            monitorSteps.data.monitorStepsInstanceArray.find(
                (monitorStep: MonitorStep) => {
                    return (
                        monitorStep.id.toString() ===
                        (
                            dataToProcess as ProbeMonitorResponse
                        ).monitorStepId.toString()
                    );
                }
            );
        }

        if (!monitorStep) {
            // no steps, ignore everything. This happens when the monitor is updated shortly after the probing attempt.
            return response;
        }

        // now process the monitor step

        response.ingestedMonitorStepId = monitorStep.id;

        //find next monitor step after this one.
        const nextMonitorStepIndex: number =
            monitorSteps.data.monitorStepsInstanceArray.findIndex(
                (step: MonitorStep) => {
                    return step.id.toString() === monitorStep.id.toString();
                }
            );

        response.nextMonitorStepId =
            monitorSteps.data.monitorStepsInstanceArray[
                nextMonitorStepIndex + 1
            ]?.id;

        // now process probe response monitors

        response = await ProbeMonitorResponseService.processMonitorStep({
            dataToProcess: dataToProcess,
            monitorStep: monitorStep,
            monitor: monitor,
            probeApiIngestResponse: response,
        });

        if (response.criteriaMetId && response.rootCause) {
            await this.criteriaMetCreateIncidentsAndUpdateMonitorStatus({
                monitor: monitor,
                rootCause: response.rootCause,
                dataToProcess: dataToProcess,
                autoResolveCriteriaInstanceIdIncidentIdsDictionary,
                criteriaInstance: criteriaInstanceMap[response.criteriaMetId!]!,
            });
        } else if (
            !response.criteriaMetId &&
            monitorSteps.data.defaultMonitorStatusId &&
            monitor.currentMonitorStatusId?.toString() !==
                monitorSteps.data.defaultMonitorStatusId.toString()
        ) {
            await this.checkOpenIncidentsAndCloseIfResolved({
                monitorId: monitor.id!,
                autoResolveCriteriaInstanceIdIncidentIdsDictionary,
                rootCause:
                    'No monitoring criteria met. Change to default status.',
                criteriaInstance: null, // no criteria met!
                dataToProcess: dataToProcess,
            });

            // if no criteria is met then update monitor to default state.
            const monitorStatusTimeline: MonitorStatusTimeline =
                new MonitorStatusTimeline();
            monitorStatusTimeline.monitorId = monitor.id!;
            monitorStatusTimeline.monitorStatusId =
                monitorSteps.data.defaultMonitorStatusId!;
            monitorStatusTimeline.projectId = monitor.projectId!;
            monitorStatusTimeline.statusChangeLog = JSON.parse(
                JSON.stringify(dataToProcess)
            );
            monitorStatusTimeline.rootCause =
                'No monitoring criteria met. Change to default status. ';
            await MonitorStatusTimelineService.create({
                data: monitorStatusTimeline,
                props: {
                    isRoot: true,
                },
            });
        }

        return response;
    }

    private static async checkOpenIncidentsAndCloseIfResolved(input: {
        monitorId: ObjectID;
        autoResolveCriteriaInstanceIdIncidentIdsDictionary: Dictionary<
            Array<string>
        >;
        rootCause: string;
        criteriaInstance: MonitorCriteriaInstance | null;
        dataToProcess: ProbeMonitorResponse | IncomingMonitorRequest;
    }): Promise<Array<Incident>> {
        // check active incidents and if there are open incidents, do not cretae anothr incident.
        const openIncidents: Array<Incident> = await IncidentService.findBy({
            query: {
                monitors: [input.monitorId] as any,
                currentIncidentState: {
                    isResolvedState: false,
                },
            },
            skip: 0,
            limit: LIMIT_PER_PROJECT,
            select: {
                _id: true,
                createdCriteriaId: true,
                createdIncidentTemplateId: true,
                projectId: true,
            },
            props: {
                isRoot: true,
            },
        });

        // check if should close the incident.

        for (const openIncident of openIncidents) {
            const shouldClose: boolean =
                ProbeMonitorResponseService.shouldCloseIncident({
                    openIncident,
                    autoResolveCriteriaInstanceIdIncidentIdsDictionary:
                        input.autoResolveCriteriaInstanceIdIncidentIdsDictionary,
                    criteriaInstance: input.criteriaInstance,
                });

            if (shouldClose) {
                // then resolve incident.
                await ProbeMonitorResponseService.resolveOpenIncident({
                    openIncident: openIncident,
                    rootCause: input.rootCause,
                    dataToProcess: input.dataToProcess,
                });
            }
        }

        return openIncidents;
    }

    private static async criteriaMetCreateIncidentsAndUpdateMonitorStatus(input: {
        criteriaInstance: MonitorCriteriaInstance;
        monitor: Monitor;
        dataToProcess: ProbeMonitorResponse | IncomingMonitorRequest;
        rootCause: string;
        autoResolveCriteriaInstanceIdIncidentIdsDictionary: Dictionary<
            Array<string>
        >;
    }): Promise<void> {
        // criteria filters are met, now process the actions.

        if (
            input.criteriaInstance.data?.changeMonitorStatus &&
            input.criteriaInstance.data?.monitorStatusId &&
            input.criteriaInstance.data?.monitorStatusId.toString() !==
                input.monitor.currentMonitorStatusId?.toString()
        ) {
            // change monitor status

            const monitorStatusId: ObjectID | undefined =
                input.criteriaInstance.data?.monitorStatusId;

            //change monitor status.

            const monitorStatusTimeline: MonitorStatusTimeline =
                new MonitorStatusTimeline();
            monitorStatusTimeline.monitorId = input.monitor.id!;
            monitorStatusTimeline.monitorStatusId = monitorStatusId;
            monitorStatusTimeline.projectId = input.monitor.projectId!;
            monitorStatusTimeline.statusChangeLog = JSON.parse(
                JSON.stringify(input.dataToProcess)
            );
            monitorStatusTimeline.rootCause = input.rootCause;

            await MonitorStatusTimelineService.create({
                data: monitorStatusTimeline,
                props: {
                    isRoot: true,
                },
            });
        }

        // check open incidents

        // check active incidents and if there are open incidents, do not cretae anothr incident.
        const openIncidents: Array<Incident> =
            await this.checkOpenIncidentsAndCloseIfResolved({
                monitorId: input.monitor.id!,
                autoResolveCriteriaInstanceIdIncidentIdsDictionary:
                    input.autoResolveCriteriaInstanceIdIncidentIdsDictionary,
                rootCause: input.rootCause,
                criteriaInstance: input.criteriaInstance,
                dataToProcess: input.dataToProcess,
            });

        if (input.criteriaInstance.data?.createIncidents) {
            // create incidents

            for (const criteriaIncident of input.criteriaInstance.data
                ?.incidents || []) {
                // should create incident.
                const hasAlreadyOpenIncident: boolean = Boolean(
                    openIncidents.find((incident: Incident) => {
                        return (
                            incident.createdCriteriaId ===
                                input.criteriaInstance.data?.id.toString() &&
                            incident.createdIncidentTemplateId ===
                                criteriaIncident.id.toString()
                        );
                    })
                );

                if (hasAlreadyOpenIncident) {
                    continue;
                }

                // create incident here.

                const incident: Incident = new Incident();

                incident.title = criteriaIncident.title;
                incident.description = criteriaIncident.description;

                if (!criteriaIncident.incidentSeverityId) {
                    // pick the critical criteria.

                    const severity: IncidentSeverity | null =
                        await IncidentSeverityService.findOneBy({
                            query: {
                                projectId: input.monitor.projectId!,
                            },
                            sort: {
                                order: SortOrder.Ascending,
                            },
                            props: {
                                isRoot: true,
                            },
                            select: {
                                _id: true,
                            },
                        });

                    if (!severity) {
                        throw new BadDataException(
                            'Project does not have incident severity'
                        );
                    } else {
                        incident.incidentSeverityId = severity.id!;
                    }
                } else {
                    incident.incidentSeverityId =
                        criteriaIncident.incidentSeverityId!;
                }

                incident.monitors = [input.monitor];
                incident.projectId = input.monitor.projectId!;
                incident.rootCause = input.rootCause;
                incident.createdStateLog = JSON.parse(
                    JSON.stringify(input.dataToProcess, null, 2)
                );

                incident.createdCriteriaId =
                    input.criteriaInstance.data.id.toString();

                incident.createdIncidentTemplateId =
                    criteriaIncident.id.toString();

                incident.onCallDutyPolicies =
                    criteriaIncident.onCallPolicyIds?.map((id: ObjectID) => {
                        const onCallPolicy: OnCallDutyPolicy =
                            new OnCallDutyPolicy();
                        onCallPolicy._id = id.toString();
                        return onCallPolicy;
                    }) || [];

                await IncidentService.create({
                    data: incident,
                    props: {
                        isRoot: true,
                    },
                });
            }
        }
    }

    private static async resolveOpenIncident(input: {
        openIncident: Incident;
        rootCause: string;
        dataToProcess: ProbeMonitorResponse | IncomingMonitorRequest;
    }): Promise<void> {
        const resolvedStateId: ObjectID =
            await IncidentStateTimelineService.getResolvedStateIdForProject(
                input.openIncident.projectId!
            );

        const incidentStateTimeline: IncidentStateTimeline =
            new IncidentStateTimeline();
        incidentStateTimeline.incidentId = input.openIncident.id!;
        incidentStateTimeline.incidentStateId = resolvedStateId;
        incidentStateTimeline.projectId = input.openIncident.projectId!;

        if (input.rootCause) {
            incidentStateTimeline.rootCause =
                'Incident autoresolved because autoresolve is set to true in monitor criteria. ' +
                input.rootCause;
        }

        if (input.dataToProcess) {
            incidentStateTimeline.stateChangeLog = JSON.parse(
                JSON.stringify(input.dataToProcess)
            );
        }

        await IncidentStateTimelineService.create({
            data: incidentStateTimeline,
            props: {
                isRoot: true,
            },
        });
    }

    private static shouldCloseIncident(input: {
        openIncident: Incident;
        autoResolveCriteriaInstanceIdIncidentIdsDictionary: Dictionary<
            Array<string>
        >;
        criteriaInstance: MonitorCriteriaInstance | null; // null if no criteia met.
    }): boolean {
        if (
            input.openIncident.createdCriteriaId?.toString() ===
            input.criteriaInstance?.data?.id.toString()
        ) {
            // same incident active. So, do not close.
            return false;
        }

        // If antoher criteria is active then, check if the incident id is present in the map.

        if (!input.openIncident.createdCriteriaId?.toString()) {
            return false;
        }

        if (!input.openIncident.createdIncidentTemplateId?.toString()) {
            return false;
        }

        if (
            input.autoResolveCriteriaInstanceIdIncidentIdsDictionary[
                input.openIncident.createdCriteriaId?.toString()
            ]
        ) {
            if (
                input.autoResolveCriteriaInstanceIdIncidentIdsDictionary[
                    input.openIncident.createdCriteriaId?.toString()
                ]?.includes(
                    input.openIncident.createdIncidentTemplateId?.toString()
                )
            ) {
                return true;
            }
        }

        return false;
    }

    private static async processMonitorStep(input: {
        dataToProcess: ProbeMonitorResponse | IncomingMonitorRequest;
        monitorStep: MonitorStep;
        monitor: Monitor;
        probeApiIngestResponse: ProbeApiIngestResponse;
    }): Promise<ProbeApiIngestResponse> {
        // process monitor step here.

        const criteria: MonitorCriteria | undefined =
            input.monitorStep.data?.monitorCriteria;

        if (!criteria || !criteria.data) {
            // do nothing as there's no criteria to process.
            return input.probeApiIngestResponse;
        }

        for (const criteriaInstance of criteria.data
            .monitorCriteriaInstanceArray) {
            const rootCause: string | null =
                await ProbeMonitorResponseService.processMonitorCriteiaInstance(
                    {
                        dataToProcess: input.dataToProcess,
                        monitorStep: input.monitorStep,
                        monitor: input.monitor,
                        probeApiIngestResponse: input.probeApiIngestResponse,
                        criteriaInstance: criteriaInstance,
                    }
                );

            if (rootCause) {
                input.probeApiIngestResponse.criteriaMetId =
                    criteriaInstance.data?.id;
                input.probeApiIngestResponse.rootCause =
                    rootCause +
                    ' ' +
                    (
                        (input.dataToProcess as ProbeMonitorResponse)
                            .failureCause || ''
                    ).replace('Error:', '');
                break;
            }
        }

        return input.probeApiIngestResponse;
    }

    private static async processMonitorCriteiaInstance(input: {
        dataToProcess: ProbeMonitorResponse | IncomingMonitorRequest;
        monitorStep: MonitorStep;
        monitor: Monitor;
        probeApiIngestResponse: ProbeApiIngestResponse;
        criteriaInstance: MonitorCriteriaInstance;
    }): Promise<string | null> {
        // returns root cause if any. Otherwise criteria is not met.
        // process monitor criteria instance here.

        const rootCause: string | null =
            await ProbeMonitorResponseService.isMonitorInstanceCriteriaFiltersMet(
                {
                    dataToProcess: input.dataToProcess,
                    monitorStep: input.monitorStep,
                    monitor: input.monitor,
                    probeApiIngestResponse: input.probeApiIngestResponse,
                    criteriaInstance: input.criteriaInstance,
                }
            );

        // do nothing as there's no criteria to process.
        return rootCause;
    }

    private static async isMonitorInstanceCriteriaFiltersMet(input: {
        dataToProcess: ProbeMonitorResponse | IncomingMonitorRequest;
        monitorStep: MonitorStep;
        monitor: Monitor;
        probeApiIngestResponse: ProbeApiIngestResponse;
        criteriaInstance: MonitorCriteriaInstance;
    }): Promise<string | null> {
        // returns root cause if any. Otherwise criteria is not met.
        let finalResult: string | null = 'All Criteria Met.';

        if (
            FilterCondition.Any === input.criteriaInstance.data?.filterCondition
        ) {
            finalResult = null; // set to false as we need to check if any of the filters are met.
        }

        for (const criteriaFilter of input.criteriaInstance.data?.filters ||
            []) {
            const rootCause: string | null =
                await ProbeMonitorResponseService.isMonitorInstanceCriteriaFilterMet(
                    {
                        dataToProcess: input.dataToProcess,
                        monitorStep: input.monitorStep,
                        monitor: input.monitor,
                        probeApiIngestResponse: input.probeApiIngestResponse,
                        criteriaInstance: input.criteriaInstance,
                        criteriaFilter: criteriaFilter,
                    }
                );

            const didMeetCriteria: boolean = Boolean(rootCause);

            if (
                FilterCondition.Any ===
                    input.criteriaInstance.data?.filterCondition &&
                didMeetCriteria === true
            ) {
                finalResult = rootCause;
            }

            if (
                FilterCondition.All ===
                    input.criteriaInstance.data?.filterCondition &&
                didMeetCriteria === false
            ) {
                finalResult = null;
                break;
            }

            if (
                FilterCondition.All ===
                    input.criteriaInstance.data?.filterCondition &&
                didMeetCriteria &&
                rootCause
            ) {
                finalResult += rootCause + ' ';
            }
        }

        return finalResult;
    }

    private static async isMonitorInstanceCriteriaFilterMet(input: {
        dataToProcess: ProbeMonitorResponse | IncomingMonitorRequest;
        monitorStep: MonitorStep;
        monitor: Monitor;
        probeApiIngestResponse: ProbeApiIngestResponse;
        criteriaInstance: MonitorCriteriaInstance;
        criteriaFilter: CriteriaFilter;
    }): Promise<string | null> {
        // returns root cause if any. Otherwise criteria is not met.
        // process monitor criteria filter here.
        let value: number | string | undefined = input.criteriaFilter.value;
        //check is online filter
        if (
            input.criteriaFilter.checkOn === CheckOn.IsOnline &&
            input.criteriaFilter.filterType === FilterType.True
        ) {
            if ((input.dataToProcess as ProbeMonitorResponse).isOnline) {
                return 'Monitor is online.';
            }
            return null;
        }

        if (
            input.criteriaFilter.checkOn === CheckOn.IsOnline &&
            input.criteriaFilter.filterType === FilterType.False
        ) {
            if (!(input.dataToProcess as ProbeMonitorResponse).isOnline) {
                return 'Monitor is offline.';
            }
            return null;
        }

        // check response time filter
        if (input.criteriaFilter.checkOn === CheckOn.ResponseTime) {
            if (!value) {
                return null;
            }

            if (typeof value === Typeof.String) {
                try {
                    value = parseInt(value as string);
                } catch (err) {
                    logger.error(err);
                    return null;
                }
            }

            if (typeof value !== Typeof.Number) {
                return null;
            }

            if (input.criteriaFilter.filterType === FilterType.GreaterThan) {
                if (
                    (input.dataToProcess as ProbeMonitorResponse)
                        .responseTimeInMs &&
                    (input.dataToProcess as ProbeMonitorResponse)
                        .responseTimeInMs! > (value as number)
                ) {
                    return `Response time is ${
                        (input.dataToProcess as ProbeMonitorResponse)
                            .responseTimeInMs
                    } ms which is greater than the criteria value of ${value} ms.`;
                }
                return null;
            }

            if (input.criteriaFilter.filterType === FilterType.LessThan) {
                if (
                    (input.dataToProcess as ProbeMonitorResponse)
                        .responseTimeInMs &&
                    (input.dataToProcess as ProbeMonitorResponse)
                        .responseTimeInMs! < (value as number)
                ) {
                    return `Response time is ${
                        (input.dataToProcess as ProbeMonitorResponse)
                            .responseTimeInMs
                    } ms which is less than the criteria value of ${value} ms.`;
                }
                return null;
            }

            if (input.criteriaFilter.filterType === FilterType.EqualTo) {
                if (
                    (input.dataToProcess as ProbeMonitorResponse)
                        .responseTimeInMs &&
                    (input.dataToProcess as ProbeMonitorResponse)
                        .responseTimeInMs === (value as number)
                ) {
                    return `Response time is ${
                        (input.dataToProcess as ProbeMonitorResponse)
                            .responseTimeInMs
                    } ms.`;
                }
                return null;
            }

            if (input.criteriaFilter.filterType === FilterType.NotEqualTo) {
                if (
                    (input.dataToProcess as ProbeMonitorResponse)
                        .responseTimeInMs &&
                    (input.dataToProcess as ProbeMonitorResponse)
                        .responseTimeInMs !== (value as number)
                ) {
                    return `Response time is ${
                        (input.dataToProcess as ProbeMonitorResponse)
                            .responseTimeInMs
                    } ms which is not equal to the criteria value of ${value} ms.`;
                }
                return null;
            }

            if (
                input.criteriaFilter.filterType ===
                FilterType.GreaterThanOrEqualTo
            ) {
                if (
                    (input.dataToProcess as ProbeMonitorResponse)
                        .responseTimeInMs &&
                    (input.dataToProcess as ProbeMonitorResponse)
                        .responseTimeInMs! >= (value as number)
                ) {
                    return `Response time is ${
                        (input.dataToProcess as ProbeMonitorResponse)
                            .responseTimeInMs
                    } ms which is greater than or equal to the criteria value of ${value} ms.`;
                }
                return null;
            }

            if (
                input.criteriaFilter.filterType === FilterType.LessThanOrEqualTo
            ) {
                if (
                    (input.dataToProcess as ProbeMonitorResponse)
                        .responseTimeInMs &&
                    (input.dataToProcess as ProbeMonitorResponse)
                        .responseTimeInMs! <= (value as number)
                ) {
                    return `Response time is ${
                        (input.dataToProcess as ProbeMonitorResponse)
                            .responseTimeInMs
                    } ms which is less than or equal to the criteria value of ${value} ms.`;
                }
                return null;
            }
        }

        //check response code
        if (input.criteriaFilter.checkOn === CheckOn.ResponseStatusCode) {
            if (!value) {
                return null;
            }

            if (typeof value === Typeof.String) {
                try {
                    value = parseInt(value as string);
                } catch (err) {
                    logger.error(err);
                    return null;
                }
            }

            if (typeof value !== Typeof.Number) {
                return null;
            }

            if (input.criteriaFilter.filterType === FilterType.GreaterThan) {
                if (
                    (input.dataToProcess as ProbeMonitorResponse)
                        .responseCode &&
                    (input.dataToProcess as ProbeMonitorResponse)
                        .responseCode! > (value as number)
                ) {
                    return `Response status code is ${
                        (input.dataToProcess as ProbeMonitorResponse)
                            .responseCode
                    } which is greater than the criteria value of ${value}.`;
                }
                return null;
            }

            if (input.criteriaFilter.filterType === FilterType.LessThan) {
                if (
                    (input.dataToProcess as ProbeMonitorResponse)
                        .responseCode &&
                    (input.dataToProcess as ProbeMonitorResponse)
                        .responseCode! < (value as number)
                ) {
                    return `Response status code is ${
                        (input.dataToProcess as ProbeMonitorResponse)
                            .responseCode
                    } which is less than the criteria value of ${value}.`;
                }
                return null;
            }

            if (input.criteriaFilter.filterType === FilterType.EqualTo) {
                if (
                    (input.dataToProcess as ProbeMonitorResponse)
                        .responseCode &&
                    (input.dataToProcess as ProbeMonitorResponse)
                        .responseCode === (value as number)
                ) {
                    return `Response status code is ${
                        (input.dataToProcess as ProbeMonitorResponse)
                            .responseCode
                    }.`;
                }
                return null;
            }

            if (input.criteriaFilter.filterType === FilterType.NotEqualTo) {
                if (
                    (input.dataToProcess as ProbeMonitorResponse)
                        .responseCode &&
                    (input.dataToProcess as ProbeMonitorResponse)
                        .responseCode !== (value as number)
                ) {
                    return `Response status code is ${
                        (input.dataToProcess as ProbeMonitorResponse)
                            .responseCode
                    } which is not equal to the criteria value of ${value}.`;
                }
                return null;
            }

            if (
                input.criteriaFilter.filterType ===
                FilterType.GreaterThanOrEqualTo
            ) {
                if (
                    (input.dataToProcess as ProbeMonitorResponse)
                        .responseCode &&
                    (input.dataToProcess as ProbeMonitorResponse)
                        .responseCode! >= (value as number)
                ) {
                    return `Response status code is ${
                        (input.dataToProcess as ProbeMonitorResponse)
                            .responseCode
                    } which is greater than or equal to the criteria value of ${value}.`;
                }
                return null;
            }

            if (
                input.criteriaFilter.filterType === FilterType.LessThanOrEqualTo
            ) {
                if (
                    (input.dataToProcess as ProbeMonitorResponse)
                        .responseCode &&
                    (input.dataToProcess as ProbeMonitorResponse)
                        .responseCode! <= (value as number)
                ) {
                    return `Response status code is ${
                        (input.dataToProcess as ProbeMonitorResponse)
                            .responseCode
                    } which is less than or equal to the criteria value of ${value}.`;
                }
                return null;
            }
        }

        if (input.criteriaFilter.checkOn === CheckOn.ResponseBody) {
            let responseBody: string | JSONObject | undefined = (
                input.dataToProcess as ProbeMonitorResponse
            ).responseBody;

            if (responseBody && typeof responseBody === Typeof.Object) {
                responseBody = JSON.stringify(responseBody);
            }

            if (!responseBody) {
                return null;
            }

            // contains
            if (input.criteriaFilter.filterType === FilterType.Contains) {
                if (
                    value &&
                    responseBody &&
                    (responseBody as string).includes(value as string)
                ) {
                    return `Response body contains ${value}.`;
                }
                return null;
            }

            if (input.criteriaFilter.filterType === FilterType.NotContains) {
                if (
                    value &&
                    responseBody &&
                    !(responseBody as string).includes(value as string)
                ) {
                    return `Response body does not contain ${value}.`;
                }
                return null;
            }
        }

        if (input.criteriaFilter.checkOn === CheckOn.ResponseHeader) {
            const headerKeys: Array<string> = Object.keys(
                (input.dataToProcess as ProbeMonitorResponse).responseHeaders ||
                    {}
            ).map((key: string) => {
                return key.toLowerCase();
            });

            // contains
            if (input.criteriaFilter.filterType === FilterType.Contains) {
                if (
                    value &&
                    headerKeys &&
                    headerKeys.includes(value as string)
                ) {
                    return `Response header contains ${value}.`;
                }
                return null;
            }

            if (input.criteriaFilter.filterType === FilterType.NotContains) {
                if (
                    value &&
                    headerKeys &&
                    !headerKeys.includes(value as string)
                ) {
                    return `Response header does not contain ${value}.`;
                }
                return null;
            }
        }

        if (input.criteriaFilter.checkOn === CheckOn.ResponseHeaderValue) {
            const headerValues: Array<string> = Object.values(
                (input.dataToProcess as ProbeMonitorResponse).responseHeaders ||
                    {}
            ).map((key: string) => {
                return key.toLowerCase();
            });

            // contains
            if (input.criteriaFilter.filterType === FilterType.Contains) {
                if (
                    value &&
                    headerValues &&
                    headerValues.includes(value as string)
                ) {
                    return `Response header value contains ${value}.`;
                }
                return null;
            }

            if (input.criteriaFilter.filterType === FilterType.NotContains) {
                if (
                    value &&
                    headerValues &&
                    !headerValues.includes(value as string)
                ) {
                    return `Response header value does not contain ${value}.`;
                }
                return null;
            }
        }

        // All incoming request related checks

        if (input.criteriaFilter.checkOn === CheckOn.IncomingRequest) {
            const lastCheckTime: Date = (
                input.dataToProcess as IncomingMonitorRequest
            ).incomingRequestReceivedAt;
            const differenceInMinutes: number =
                OneUptimeDate.getDifferenceInMinutes(
                    lastCheckTime,
                    OneUptimeDate.getCurrentDate()
                );

            if (!value) {
                return null;
            }

            if (typeof value === Typeof.String) {
                try {
                    value = parseInt(value as string);
                } catch (err) {
                    logger.error(err);
                    return null;
                }
            }

            if (typeof value !== Typeof.Number) {
                return null;
            }

            if (
                input.criteriaFilter.filterType === FilterType.RecievedInMinutes
            ) {
                if (value && differenceInMinutes <= (value as number)) {
                    return `Incoming request / heartbeat received in ${value} minutes.`;
                }
                return null;
            }

            if (
                input.criteriaFilter.filterType ===
                FilterType.NotRecievedInMinutes
            ) {
                if (value && differenceInMinutes > (value as number)) {
                    return `Incoming request / heartbeat not received in ${value} minutes.`;
                }
                return null;
            }
        }

        if (
            input.criteriaFilter.checkOn === CheckOn.RequestBody &&
            !(input.dataToProcess as IncomingMonitorRequest)
                .onlyCheckForIncomingRequestReceivedAt
        ) {
            let responseBody: string | JSONObject | undefined = (
                input.dataToProcess as IncomingMonitorRequest
            ).requestBody;

            if (responseBody && typeof responseBody === Typeof.Object) {
                responseBody = JSON.stringify(responseBody);
            }

            if (!responseBody) {
                return null;
            }

            // contains
            if (input.criteriaFilter.filterType === FilterType.Contains) {
                if (
                    value &&
                    responseBody &&
                    (responseBody as string).includes(value as string)
                ) {
                    return `Request body contains ${value}.`;
                }
                return null;
            }

            if (input.criteriaFilter.filterType === FilterType.NotContains) {
                if (
                    value &&
                    responseBody &&
                    !(responseBody as string).includes(value as string)
                ) {
                    return `Request body does not contain ${value}.`;
                }
                return null;
            }
        }

        if (
            input.criteriaFilter.checkOn === CheckOn.RequestHeader &&
            !(input.dataToProcess as IncomingMonitorRequest)
                .onlyCheckForIncomingRequestReceivedAt
        ) {
            const headerKeys: Array<string> = Object.keys(
                (input.dataToProcess as IncomingMonitorRequest)
                    .requestHeaders || {}
            ).map((key: string) => {
                return key.toLowerCase();
            });

            // contains
            if (input.criteriaFilter.filterType === FilterType.Contains) {
                if (
                    value &&
                    headerKeys &&
                    headerKeys.includes(value as string)
                ) {
                    return `Request header contains ${value}.`;
                }
                return null;
            }

            if (input.criteriaFilter.filterType === FilterType.NotContains) {
                if (
                    value &&
                    headerKeys &&
                    !headerKeys.includes(value as string)
                ) {
                    return `Request header does not contain ${value}.`;
                }
                return null;
            }
        }

        if (
            input.criteriaFilter.checkOn === CheckOn.RequestHeaderValue &&
            !(input.dataToProcess as IncomingMonitorRequest)
                .onlyCheckForIncomingRequestReceivedAt
        ) {
            const headerValues: Array<string> = Object.values(
                (input.dataToProcess as IncomingMonitorRequest)
                    .requestHeaders || {}
            ).map((key: string) => {
                return key.toLowerCase();
            });

            // contains
            if (input.criteriaFilter.filterType === FilterType.Contains) {
                if (
                    value &&
                    headerValues &&
                    headerValues.includes(value as string)
                ) {
                    return `Request header value contains ${value}.`;
                }
                return null;
            }

            if (input.criteriaFilter.filterType === FilterType.NotContains) {
                if (
                    value &&
                    headerValues &&
                    !headerValues.includes(value as string)
                ) {
                    return `Request header value does not contain ${value}.`;
                }
                return null;
            }
        }

        return null;
    }
}
