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
import MonitorService from 'CommonServer/Services/MonitorService';
import MonitorStatusTimelineService from 'CommonServer/Services/MonitorStatusTimelineService';
import IncidentService from 'CommonServer/Services/IncidentService';
import logger from 'CommonServer/Utils/Logger';
import Incident from 'Model/Models/Incident';
import Monitor from 'Model/Models/Monitor';
import MonitorStatusTimeline from 'Model/Models/MonitorStatusTimeline';
import ObjectID from 'Common/Types/ObjectID';
import { JSONObject } from 'Common/Types/JSON';
import QueryHelper from 'CommonServer/Types/Database/QueryHelper';
import PositiveNumber from 'Common/Types/PositiveNumber';

export default class ProbeMonitorResponseService {
    public static async processProbeResponse(
        probeMonitorResponse: ProbeMonitorResponse
    ): Promise<ProbeApiIngestResponse> {
        let response: ProbeApiIngestResponse = {
            monitorId: probeMonitorResponse.monitorId,
            criteriaMetId: undefined,
        };

        // fetch monitor
        const monitor: Monitor | null = await MonitorService.findOneById({
            id: probeMonitorResponse.monitorId,
            select: {
                monitorSteps: true,
                monitorType: true,
                projectId: true,
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

        // save data to Clickhouse.

        const monitorSteps: MonitorSteps = monitor.monitorSteps!;

        if (!monitorSteps.data?.monitorStepsInstanceArray) {
            // no steps, ignore everything. This happens when the monitor is updated shortly after the probing attempt.
            return response;
        }

        const monitorStep: MonitorStep | undefined =
            monitorSteps.data.monitorStepsInstanceArray.find(
                (monitorStep: MonitorStep) => {
                    return (
                        monitorStep.id.toString() === probeMonitorResponse.monitorStepId.toString()
                    );
                }
            );

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

        response = await this.processMonitorStep({
            probeMonitorResponse: probeMonitorResponse,
            monitorStep: monitorStep,
            monitor: monitor,
            probeApiIngestResponse: response,
        });

        // if no criteria is met then update monitor to default state.
        if (
            !response.criteriaMetId &&
            monitorSteps.data.defaultMonitorStatusId &&
            monitor.currentMonitorStatusId?.toString() !==
                monitorSteps.data.defaultMonitorStatusId.toString()
        ) {
            const monitorStatusTimeline: MonitorStatusTimeline =
                new MonitorStatusTimeline();
            monitorStatusTimeline.monitorId = monitor.id!;
            monitorStatusTimeline.monitorStatusId =
                monitorSteps.data.defaultMonitorStatusId!;
            monitorStatusTimeline.projectId = monitor.projectId!;
            await MonitorStatusTimelineService.create({
                data: monitorStatusTimeline,
                props: {
                    isRoot: true,
                },
            });
        }

        return response;
    }

    private static async processMonitorStep(input: {
        probeMonitorResponse: ProbeMonitorResponse;
        monitorStep: MonitorStep;
        monitor: Monitor;
        probeApiIngestResponse: ProbeApiIngestResponse;
    }): Promise<ProbeApiIngestResponse> {
        // process monitor step here.

        console.log("HERE!");

        const criteria: MonitorCriteria | undefined =
            input.monitorStep.data?.monitorCriteria;

        if (!criteria || !criteria.data) {
            // do nothing as there's no criteria to process.
            return input.probeApiIngestResponse;
        }

        for (const criteriaInstance of criteria.data
            .monitorCriteriaInstanceArray) {
            const isCriteriaFilterMet: boolean =
                await this.processMonitorCriteiaInstance({
                    probeMonitorResponse: input.probeMonitorResponse,
                    monitorStep: input.monitorStep,
                    monitor: input.monitor,
                    probeApiIngestResponse: input.probeApiIngestResponse,
                    criteriaInstance: criteriaInstance,
                });

            if (isCriteriaFilterMet) {
                input.probeApiIngestResponse.criteriaMetId =
                    criteriaInstance.data?.id;
                break;
            }
        }

        return input.probeApiIngestResponse;
    }

    private static async processMonitorCriteiaInstance(input: {
        probeMonitorResponse: ProbeMonitorResponse;
        monitorStep: MonitorStep;
        monitor: Monitor;
        probeApiIngestResponse: ProbeApiIngestResponse;
        criteriaInstance: MonitorCriteriaInstance;
    }): Promise<boolean> {
        // process monitor criteria instance here.

        const isCriteriaFiltersMet: boolean =
            await this.isMonitorInstanceCriteriaFiltersMet({
                probeMonitorResponse: input.probeMonitorResponse,
                monitorStep: input.monitorStep,
                monitor: input.monitor,
                probeApiIngestResponse: input.probeApiIngestResponse,
                criteriaInstance: input.criteriaInstance,
            });

        console.log("isCriteriaFiltersMet: "+isCriteriaFiltersMet);
        console.log("input");
        console.log(input);

        if (isCriteriaFiltersMet) {
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

                await MonitorStatusTimelineService.create({
                    data: monitorStatusTimeline,
                    props: {
                        isRoot: true,
                    },
                });
            }

            if (input.criteriaInstance.data?.createIncidents) {
                // check active incidents and if there are open incidents, do not cretae anothr incident.
                const openIncidentsCount: PositiveNumber =
                    await IncidentService.countBy({
                        query: {
                            monitors: QueryHelper.in([input.monitor.id!]),
                            currentIncidentState: {
                                isResolvedState: false,
                            },
                        },
                        props: {
                            isRoot: true,
                        },
                    });

                // if there are no open incidents, create incidents.
                if (openIncidentsCount.toNumber() === 0) {
                    // create incidents

                    for (const criteriaIncident of input.criteriaInstance.data
                        ?.incidents || []) {
                        // create incident here.

                        const incident: Incident = new Incident();

                        incident.title = criteriaIncident.title;
                        incident.description = criteriaIncident.description;
                        incident.incidentSeverityId =
                            criteriaIncident.incidentSeverityId!;
                        incident.monitors = [input.monitor];
                        incident.projectId = input.monitor.projectId!;

                        await IncidentService.create({
                            data: incident,
                            props: {
                                isRoot: true,
                            },
                        });
                    }
                }
            }
        }

        // do nothing as there's no criteria to process.
        return isCriteriaFiltersMet;
    }

    private static async isMonitorInstanceCriteriaFiltersMet(input: {
        probeMonitorResponse: ProbeMonitorResponse;
        monitorStep: MonitorStep;
        monitor: Monitor;
        probeApiIngestResponse: ProbeApiIngestResponse;
        criteriaInstance: MonitorCriteriaInstance;
    }): Promise<boolean> {
        for (const criteriaFilter of input.criteriaInstance.data?.filters ||
            []) {
            const criteriaResult: boolean =
                await this.isMonitorInstanceCriteriaFilterMet({
                    probeMonitorResponse: input.probeMonitorResponse,
                    monitorStep: input.monitorStep,
                    monitor: input.monitor,
                    probeApiIngestResponse: input.probeApiIngestResponse,
                    criteriaInstance: input.criteriaInstance,
                    criteriaFilter: criteriaFilter,
                });

            if (
                FilterCondition.Any ===
                    input.criteriaInstance.data?.filterCondition &&
                criteriaResult === true
            ) {
                return true;
            }

            if (
                FilterCondition.All ===
                    input.criteriaInstance.data?.filterCondition &&
                criteriaResult === false
            ) {
                return false;
            }
        }

        return false;
    }

    private static async isMonitorInstanceCriteriaFilterMet(input: {
        probeMonitorResponse: ProbeMonitorResponse;
        monitorStep: MonitorStep;
        monitor: Monitor;
        probeApiIngestResponse: ProbeApiIngestResponse;
        criteriaInstance: MonitorCriteriaInstance;
        criteriaFilter: CriteriaFilter;
    }): Promise<boolean> {
        // process monitor criteria filter here.
        let value: number | string | undefined = input.criteriaFilter.value;
        //check is online filter
        if (
            input.criteriaFilter.checkOn === CheckOn.IsOnline &&
            input.criteriaFilter.filterType === FilterType.True
        ) {
            if (input.probeMonitorResponse.isOnline) {
                return true;
            }
            return false;
        }


        if (
            input.criteriaFilter.checkOn === CheckOn.IsOnline &&
            input.criteriaFilter.filterType === FilterType.False
        ) {
            if (!input.probeMonitorResponse.isOnline) {
                return true;
            }
            return false;
        }

        // check response time filter
        if (input.criteriaFilter.checkOn === CheckOn.ResponseTime) {
            if (!value) {
                return false;
            }

            if (typeof value === Typeof.String) {
                try {
                    value = parseInt(value as string);
                } catch (err) {
                    logger.error(err);
                    return false;
                }
            }

            if (typeof value !== Typeof.Number) {
                return false;
            }

            if (input.criteriaFilter.filterType === FilterType.GreaterThan) {
                if (
                    input.probeMonitorResponse.responseTimeInMs &&
                    input.probeMonitorResponse.responseTimeInMs >
                        (input.criteriaFilter.value as number)
                ) {
                    return true;
                }
                return false;
            }

            if (input.criteriaFilter.filterType === FilterType.LessThan) {
                if (
                    input.probeMonitorResponse.responseTimeInMs &&
                    input.probeMonitorResponse.responseTimeInMs <
                        (input.criteriaFilter.value as number)
                ) {
                    return true;
                }
                return false;
            }

            if (input.criteriaFilter.filterType === FilterType.EqualTo) {
                if (
                    input.probeMonitorResponse.responseTimeInMs &&
                    input.probeMonitorResponse.responseTimeInMs ===
                        (input.criteriaFilter.value as number)
                ) {
                    return true;
                }
                return false;
            }

            if (input.criteriaFilter.filterType === FilterType.NotEqualTo) {
                if (
                    input.probeMonitorResponse.responseTimeInMs &&
                    input.probeMonitorResponse.responseTimeInMs !==
                        (input.criteriaFilter.value as number)
                ) {
                    return true;
                }
                return false;
            }

            if (
                input.criteriaFilter.filterType ===
                FilterType.GreaterThanOrEqualTo
            ) {
                if (
                    input.probeMonitorResponse.responseTimeInMs &&
                    input.probeMonitorResponse.responseTimeInMs >=
                        (input.criteriaFilter.value as number)
                ) {
                    return true;
                }
                return false;
            }

            if (
                input.criteriaFilter.filterType === FilterType.LessThanOrEqualTo
            ) {
                if (
                    input.probeMonitorResponse.responseTimeInMs &&
                    input.probeMonitorResponse.responseTimeInMs <=
                        (input.criteriaFilter.value as number)
                ) {
                    return true;
                }
                return false;
            }
        }

        //check reponse code
        if (input.criteriaFilter.checkOn === CheckOn.ResponseStatusCode) {
            if (!value) {
                return false;
            }

            if (typeof value === Typeof.String) {
                try {
                    value = parseInt(value as string);
                } catch (err) {
                    logger.error(err);
                    return false;
                }
            }

            if (typeof value !== Typeof.Number) {
                return false;
            }

            if (input.criteriaFilter.filterType === FilterType.GreaterThan) {
                if (
                    input.probeMonitorResponse.responseCode &&
                    input.probeMonitorResponse.responseCode >
                        (input.criteriaFilter.value as number)
                ) {
                    return true;
                }
                return false;
            }

            if (input.criteriaFilter.filterType === FilterType.LessThan) {
                if (
                    input.probeMonitorResponse.responseCode &&
                    input.probeMonitorResponse.responseCode <
                        (input.criteriaFilter.value as number)
                ) {
                    return true;
                }
                return false;
            }

            if (input.criteriaFilter.filterType === FilterType.EqualTo) {
                if (
                    input.probeMonitorResponse.responseCode &&
                    input.probeMonitorResponse.responseCode ===
                        (input.criteriaFilter.value as number)
                ) {
                    return true;
                }
                return false;
            }

            if (input.criteriaFilter.filterType === FilterType.NotEqualTo) {
                if (
                    input.probeMonitorResponse.responseCode &&
                    input.probeMonitorResponse.responseCode !==
                        (input.criteriaFilter.value as number)
                ) {
                    return true;
                }
                return false;
            }

            if (
                input.criteriaFilter.filterType ===
                FilterType.GreaterThanOrEqualTo
            ) {
                if (
                    input.probeMonitorResponse.responseCode &&
                    input.probeMonitorResponse.responseCode >=
                        (input.criteriaFilter.value as number)
                ) {
                    return true;
                }
                return false;
            }

            if (
                input.criteriaFilter.filterType === FilterType.LessThanOrEqualTo
            ) {
                if (
                    input.probeMonitorResponse.responseCode &&
                    input.probeMonitorResponse.responseCode <=
                        (input.criteriaFilter.value as number)
                ) {
                    return true;
                }
                return false;
            }
        }

        if (input.criteriaFilter.checkOn === CheckOn.ResponseBody) {
            let responseBody: string | JSONObject | undefined =
                input.probeMonitorResponse.responseBody;

            if (responseBody && typeof responseBody === Typeof.Object) {
                responseBody = JSON.stringify(responseBody);
            }

            if (!responseBody) {
                return false;
            }

            // contains
            if (input.criteriaFilter.filterType === FilterType.Contains) {
                if (
                    value &&
                    responseBody &&
                    (responseBody as string).includes(value as string)
                ) {
                    return true;
                }
                return false;
            }

            if (input.criteriaFilter.filterType === FilterType.NotContains) {
                if (
                    value &&
                    responseBody &&
                    !(responseBody as string).includes(value as string)
                ) {
                    return true;
                }
                return false;
            }
        }

        if (input.criteriaFilter.checkOn === CheckOn.ResponseHeader) {
            const headerKeys: Array<string> = Object.keys(
                input.probeMonitorResponse.responseHeaders || {}
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
                    return true;
                }
                return false;
            }

            if (input.criteriaFilter.filterType === FilterType.NotContains) {
                if (
                    value &&
                    headerKeys &&
                    !headerKeys.includes(value as string)
                ) {
                    return true;
                }
                return false;
            }
        }

        if (input.criteriaFilter.checkOn === CheckOn.ResponseHeaderValue) {
            const headerValues: Array<string> = Object.values(
                input.probeMonitorResponse.responseHeaders || {}
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
                    return true;
                }
                return false;
            }

            if (input.criteriaFilter.filterType === FilterType.NotContains) {
                if (
                    value &&
                    headerValues &&
                    !headerValues.includes(value as string)
                ) {
                    return true;
                }
                return false;
            }
        }

        return false;
    }
}
