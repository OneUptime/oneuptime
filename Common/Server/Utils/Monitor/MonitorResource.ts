import MonitorProbeService from "../../Services/MonitorProbeService";
import MonitorService from "../../Services/MonitorService";
import MonitorStatusTimelineService from "../../Services/MonitorStatusTimelineService";
import logger from "../Logger";
import VMUtil from "../VM/VMAPI";
import APIRequestCriteria from "./Criteria/APIRequestCriteria";
import CustomCodeMonitoringCriteria from "./Criteria/CustomCodeMonitorCriteria";
import IncomingRequestCriteria from "./Criteria/IncomingRequestCriteria";
import SSLMonitorCriteria from "./Criteria/SSLMonitorCriteria";
import ServerMonitorCriteria from "./Criteria/ServerMonitorCriteria";
import SyntheticMonitoringCriteria from "./Criteria/SyntheticMonitor";
import DataToProcess from "./DataToProcess";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import Dictionary from "../../../Types/Dictionary";
import BadDataException from "../../../Types/Exception/BadDataException";
import BasicInfrastructureMetrics from "../../../Types/Infrastructure/BasicMetrics";
import ReturnResult from "../../../Types/IsolatedVM/ReturnResult";
import Semaphore, { SemaphoreMutex } from "../../Infrastructure/Semaphore";
import { JSONObject } from "../../../Types/JSON";
import {
  CheckOn,
  CriteriaFilter,
  FilterType,
} from "../../../Types/Monitor/CriteriaFilter";
import IncomingMonitorRequest from "../../../Types/Monitor/IncomingMonitor/IncomingMonitorRequest";
import MonitorCriteria from "../../../Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType, {
  MonitorTypeHelper,
} from "../../../Types/Monitor/MonitorType";
import ServerMonitorResponse, {
  ServerProcess,
} from "../../../Types/Monitor/ServerMonitor/ServerMonitorResponse";
import ObjectID from "../../../Types/ObjectID";
import ProbeApiIngestResponse from "../../../Types/Probe/ProbeApiIngestResponse";
import ProbeMonitorResponse from "../../../Types/Probe/ProbeMonitorResponse";
import Typeof from "../../../Types/Typeof";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorProbe from "../../../Models/DatabaseModels/MonitorProbe";
import MonitorStatusTimeline from "../../../Models/DatabaseModels/MonitorStatusTimeline";
import OneUptimeDate from "../../../Types/Date";
import LogMonitorCriteria from "./Criteria/LogMonitorCriteria";
import LogMonitorResponse from "../../../Types/Monitor/LogMonitor/LogMonitorResponse";
import TelemetryType from "../../../Types/Telemetry/TelemetryType";
import TraceMonitorResponse from "../../../Types/Monitor/TraceMonitor/TraceMonitorResponse";
import TraceMonitorCriteria from "./Criteria/TraceMonitorCriteria";
import { TelemetryQuery } from "../../../Types/Telemetry/TelemetryQuery";
import MonitorIncident from "./MonitorIncident";
import MonitorAlert from "./MonitorAlert";
import MonitorStatusTimelineUtil from "./MonitorStatusTimeline";
import {
  MetricPointType,
  ServiceType,
} from "../../../Models/AnalyticsModels/Metric";
import MetricService from "../../Services/MetricService";
import MonitorMetricType from "../../../Types/Monitor/MonitorMetricType";
import TelemetryUtil from "../Telemetry/Telemetry";
import MetricMonitorCriteria from "./Criteria/MetricMonitorCriteria";
import MetricMonitorResponse from "../../../Types/Monitor/MetricMonitor/MetricMonitorResponse";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import MetricFormulaConfigData from "../../../Types/Metrics/MetricFormulaConfigData";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import CaptureSpan from "../Telemetry/CaptureSpan";
import MetricType from "../../../Models/DatabaseModels/MetricType";
import MonitorLogService from "../../Services/MonitorLogService";
import ExceptionMessages from "../../../Types/Exception/ExceptionMessages";
import MonitorEvaluationSummary, {
  MonitorEvaluationCriteriaResult,
  MonitorEvaluationFilterResult,
  MonitorEvaluationEvent,
} from "../../../Types/Monitor/MonitorEvaluationSummary";
import MonitorStatusService from "../../Services/MonitorStatusService";
import SslMonitorResponse from "../../../Types/Monitor/SSLMonitor/SslMonitorResponse";
import SyntheticMonitorResponse from "../../../Types/Monitor/SyntheticMonitors/SyntheticMonitorResponse";
import CustomCodeMonitorResponse from "../../../Types/Monitor/CustomCodeMonitor/CustomCodeMonitorResponse";
import AggregatedResult from "../../../Types/BaseDatabase/AggregatedResult";
import AggregateModel from "../../../Types/BaseDatabase/AggregatedModel";

export default class MonitorResourceUtil {
  private static buildMonitorMetricAttributes(data: {
    monitorId: ObjectID;
    projectId: ObjectID;
    monitorName?: string | undefined;
    probeName?: string | undefined;
    extraAttributes?: JSONObject;
  }): JSONObject {
    const attributes: JSONObject = {
      monitorId: data.monitorId.toString(),
      projectId: data.projectId.toString(),
    };

    if (data.extraAttributes) {
      Object.assign(attributes, data.extraAttributes);
    }

    if (data.monitorName) {
      attributes["monitorName"] = data.monitorName;
    }

    if (data.probeName) {
      attributes["probeName"] = data.probeName;
    }

    return attributes;
  }

  private static buildMonitorMetricRow(data: {
    projectId: ObjectID;
    monitorId: ObjectID;
    metricName: string;
    value: number | null | undefined;
    attributes: JSONObject;
    metricPointType?: MetricPointType;
  }): JSONObject {
    const ingestionDate: Date = OneUptimeDate.getCurrentDate();
    const ingestionTimestamp: string =
      OneUptimeDate.toClickhouseDateTime(ingestionDate);
    const timeUnixNano: string =
      OneUptimeDate.toUnixNano(ingestionDate).toString();

    const attributes: JSONObject = { ...data.attributes };
    const attributeKeys: Array<string> =
      TelemetryUtil.getAttributeKeys(attributes);

    return {
      _id: ObjectID.generate().toString(),
      createdAt: ingestionTimestamp,
      updatedAt: ingestionTimestamp,
      projectId: data.projectId.toString(),
      serviceId: data.monitorId.toString(),
      serviceType: ServiceType.Monitor,
      name: data.metricName,
      aggregationTemporality: null,
      metricPointType: data.metricPointType || MetricPointType.Sum,
      time: ingestionTimestamp,
      startTime: null,
      timeUnixNano: timeUnixNano,
      startTimeUnixNano: null,
      attributes: attributes,
      attributeKeys: attributeKeys,
      isMonotonic: null,
      count: null,
      sum: null,
      min: null,
      max: null,
      bucketCounts: [],
      explicitBounds: [],
      value: data.value ?? null,
    } as JSONObject;
  }

  @CaptureSpan()
  public static async monitorResource(
    dataToProcess: DataToProcess,
  ): Promise<ProbeApiIngestResponse> {
    let mutex: SemaphoreMutex | null = null;

    try {
      mutex = await Semaphore.lock({
        key: dataToProcess.monitorId.toString(),
        namespace: "MonitorResourceUtil.monitorResource",
      });
    } catch (err) {
      logger.error(err);
    }

    let response: ProbeApiIngestResponse = {
      monitorId: dataToProcess.monitorId,
      criteriaMetId: undefined,
      rootCause: null,
    };

    const evaluationSummary: MonitorEvaluationSummary = {
      evaluatedAt: OneUptimeDate.getCurrentDate(),
      criteriaResults: [],
      events: [],
    };

    response.evaluationSummary = evaluationSummary;
    dataToProcess.evaluationSummary = evaluationSummary;

    const monitorStatusNameCache: Dictionary<string | null> = {};

    const getMonitorStatusName: (
      statusId: ObjectID | undefined | null,
    ) => Promise<string | null> = async (
      statusId: ObjectID | undefined | null,
    ): Promise<string | null> => {
      if (!statusId) {
        return null;
      }

      const cacheKey: string = statusId.toString();

      if (monitorStatusNameCache[cacheKey] !== undefined) {
        return monitorStatusNameCache[cacheKey];
      }

      const monitorStatus = await MonitorStatusService.findOneBy({
        query: {
          _id: statusId,
        },
        select: {
          name: true,
        },
        props: {
          isRoot: true,
        },
      });

      const statusName: string | null = monitorStatus?.name || null;
      monitorStatusNameCache[cacheKey] = statusName;

      return statusName;
    };

    logger.debug("Processing probe response");
    logger.debug("Monitor ID: " + dataToProcess.monitorId);
    logger.debug("Fetching Monitor...");

    // fetch monitor
    const monitor: Monitor | null = await MonitorService.findOneById({
      id: dataToProcess.monitorId,
      select: {
        monitorSteps: true,
        monitorType: true,
        projectId: true,
        disableActiveMonitoring: true,
        disableActiveMonitoringBecauseOfManualIncident: true,
        disableActiveMonitoringBecauseOfScheduledMaintenanceEvent: true,
        currentMonitorStatusId: true,
        _id: true,
        name: true,
      },
      props: {
        isRoot: true,
      },
    });

    logger.debug("Monitor found");
    logger.debug("Monitor ID: " + dataToProcess.monitorId);

    if (!monitor) {
      logger.debug(`${dataToProcess.monitorId.toString()} Monitor not found`);
      throw new BadDataException(ExceptionMessages.MonitorNotFound);
    }

    if (!monitor.projectId) {
      logger.debug(
        `${dataToProcess.monitorId.toString()} Monitor does not have a projectId`,
      );
      throw new BadDataException("Monitor does not have a projectId");
    }

    dataToProcess.projectId = monitor.projectId;

    if (monitor.disableActiveMonitoring) {
      logger.debug(
        `${dataToProcess.monitorId.toString()} Monitor is disabled. Please enable it to start monitoring again.`,
      );

      throw new BadDataException(ExceptionMessages.MonitorDisabled);
    }

    if (monitor.disableActiveMonitoringBecauseOfManualIncident) {
      logger.debug(
        `${dataToProcess.monitorId.toString()} Monitor is disabled because an incident which is created manually is not resolved. Please resolve the incident to start monitoring again.`,
      );

      throw new BadDataException(
        "Monitor is disabled because an incident which is created manually is not resolved. Please resolve the incident to start monitoring again.",
      );
    }

    if (monitor.disableActiveMonitoringBecauseOfScheduledMaintenanceEvent) {
      logger.debug(
        `${dataToProcess.monitorId.toString()} Monitor is disabled because one of the scheduled maintenance event this monitor is attached to has not ended. Please end the scheduled maintenance event to start monitoring again.`,
      );

      throw new BadDataException(
        "Monitor is disabled because one of the scheduled maintenance event this monitor is attached to has not ended. Please end the scheduled maintenance event to start monitoring again.",
      );
    }

    let probeName: string | undefined = undefined;
    const monitorName: string | undefined = monitor.name || undefined;

    // save the last log to MonitorProbe.

    // get last log. We do this because there are many monitoring steps and we need to store those.
    logger.debug(
      `${dataToProcess.monitorId.toString()} - monitor type ${
        monitor.monitorType
      }`,
    );

    if (
      monitor.monitorType &&
      MonitorTypeHelper.isProbableMonitor(monitor.monitorType)
    ) {
      dataToProcess = dataToProcess as ProbeMonitorResponse;
      if ((dataToProcess as ProbeMonitorResponse).probeId) {
        const monitorProbe: MonitorProbe | null =
          await MonitorProbeService.findOneBy({
            query: {
              monitorId: monitor.id!,
              probeId: (dataToProcess as ProbeMonitorResponse).probeId!,
            },
            select: {
              lastMonitoringLog: true,
              probe: {
                name: true,
              },
            },
            props: {
              isRoot: true,
            },
          });

        if (!monitorProbe) {
          throw new BadDataException("Probe is not assigned to this monitor");
        }

        probeName = monitorProbe.probe?.name || undefined;

        await MonitorProbeService.updateOneBy({
          query: {
            monitorId: monitor.id!,
            probeId: (dataToProcess as ProbeMonitorResponse).probeId!,
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
      (dataToProcess as IncomingMonitorRequest).incomingRequestReceivedAt &&
      !(dataToProcess as IncomingMonitorRequest)
        .onlyCheckForIncomingRequestReceivedAt
    ) {
      logger.debug(
        `${dataToProcess.monitorId.toString()} - Incoming request received at ${(dataToProcess as IncomingMonitorRequest).incomingRequestReceivedAt}`,
      );

      await MonitorService.updateOneById({
        id: monitor.id!,
        data: {
          incomingRequestMonitorHeartbeatCheckedAt:
            OneUptimeDate.getCurrentDate(),
          incomingMonitorRequest: {
            ...dataToProcess,
          } as any,
        },
        props: {
          isRoot: true,
        },
      });

      logger.debug(`${dataToProcess.monitorId.toString()} - Monitor Updated`);
    }

    if (
      monitor.monitorType === MonitorType.Server &&
      (dataToProcess as ServerMonitorResponse).requestReceivedAt
    ) {
      logger.debug(
        `${dataToProcess.monitorId.toString()} - Server request received at ${(dataToProcess as ServerMonitorResponse).requestReceivedAt}`,
      );

      logger.debug(dataToProcess);

      await MonitorService.updateOneById({
        id: monitor.id!,
        data: {
          serverMonitorRequestReceivedAt: (
            dataToProcess as ServerMonitorResponse
          ).requestReceivedAt!,
          serverMonitorResponse: dataToProcess as ServerMonitorResponse, // this could be redundant as we are already saving this in the incomingMonitorRequest. we should remove this in the future.
        },
        props: {
          isRoot: true,
          ignoreHooks: true,
        },
      });

      logger.debug(`${dataToProcess.monitorId.toString()} - Monitor Updated`);
    }

    logger.debug(
      `${dataToProcess.monitorId.toString()} - Saving monitor metrics`,
    );

    try {
      await this.saveMonitorMetrics({
        monitorId: monitor.id!,
        projectId: monitor.projectId!,
        dataToProcess: dataToProcess,
        probeName: probeName || undefined,
        monitorName: monitorName || undefined,
      });
    } catch (err) {
      logger.error("Unable to save metrics");
      logger.error(err);
    }

    logger.debug(
      `${dataToProcess.monitorId.toString()} - Monitor metrics saved`,
    );

    const monitorSteps: MonitorSteps = monitor.monitorSteps!;

    if (
      !monitorSteps.data?.monitorStepsInstanceArray ||
      monitorSteps.data?.monitorStepsInstanceArray.length === 0
    ) {
      logger.debug(
        `${dataToProcess.monitorId.toString()} - No monitoring steps.`,
      );
      MonitorResourceUtil.saveMonitorLog({
        monitorId: monitor.id!,
        projectId: monitor.projectId!,
        dataToProcess: dataToProcess,
      });
      return response;
    }

    logger.debug(
      `${dataToProcess.monitorId.toString()} - Auto resolving criteria instances.`,
    );

    const criteriaInstances: Array<MonitorCriteriaInstance> =
      monitorSteps.data.monitorStepsInstanceArray
        .map((step: MonitorStep) => {
          return step.data?.monitorCriteria;
        })
        .filter((criteria: MonitorCriteria | undefined) => {
          return Boolean(criteria);
        })
        .map((criteria: MonitorCriteria | undefined) => {
          return [...(criteria?.data?.monitorCriteriaInstanceArray || [])];
        })
        .flat();

    const autoResolveCriteriaInstanceIdIncidentIdsDictionary: Dictionary<
      Array<string>
    > = {};

    const criteriaInstanceMap: Dictionary<MonitorCriteriaInstance> = {};

    for (const criteriaInstance of criteriaInstances) {
      criteriaInstanceMap[criteriaInstance.data?.id || ""] = criteriaInstance;

      if (
        criteriaInstance.data?.incidents &&
        criteriaInstance.data?.incidents.length > 0
      ) {
        for (const incidentTemplate of criteriaInstance.data!.incidents) {
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

    // alerts.

    const autoResolveCriteriaInstanceIdAlertIdsDictionary: Dictionary<
      Array<string>
    > = {};

    const criteriaInstanceAlertMap: Dictionary<MonitorCriteriaInstance> = {};

    for (const criteriaInstance of criteriaInstances) {
      criteriaInstanceAlertMap[criteriaInstance.data?.id || ""] =
        criteriaInstance;

      if (
        criteriaInstance.data?.alerts &&
        criteriaInstance.data?.alerts.length > 0
      ) {
        for (const alertTemplate of criteriaInstance.data!.alerts) {
          if (alertTemplate.autoResolveAlert) {
            if (
              !autoResolveCriteriaInstanceIdAlertIdsDictionary[
                criteriaInstance.data.id.toString()
              ]
            ) {
              autoResolveCriteriaInstanceIdAlertIdsDictionary[
                criteriaInstance.data.id.toString()
              ] = [];
            }

            autoResolveCriteriaInstanceIdAlertIdsDictionary[
              criteriaInstance.data.id.toString()
            ]?.push(alertTemplate.id);
          }
        }
      }
    }

    const monitorStep: MonitorStep | undefined =
      monitorSteps.data.monitorStepsInstanceArray[0];

    logger.debug(`Monitor Step: ${monitorStep ? monitorStep.id : "undefined"}`);

    if ((dataToProcess as ProbeMonitorResponse).monitorStepId) {
      monitorSteps.data.monitorStepsInstanceArray.find(
        (monitorStep: MonitorStep) => {
          return (
            monitorStep.id.toString() ===
            (dataToProcess as ProbeMonitorResponse).monitorStepId.toString()
          );
        },
      );
      logger.debug(
        `Found Monitor Step ID: ${(dataToProcess as ProbeMonitorResponse).monitorStepId}`,
      );
    }

    if (!monitorStep) {
      logger.debug("No steps found, ignoring everything.");
      MonitorResourceUtil.saveMonitorLog({
        monitorId: monitor.id!,
        projectId: monitor.projectId!,
        dataToProcess: dataToProcess,
      });
      return response;
    }

    // now process the monitor step
    response.ingestedMonitorStepId = monitorStep.id;
    logger.debug(`Ingested Monitor Step ID: ${monitorStep.id}`);

    //find next monitor step after this one.
    const nextMonitorStepIndex: number =
      monitorSteps.data.monitorStepsInstanceArray.findIndex(
        (step: MonitorStep) => {
          return step.id.toString() === monitorStep.id.toString();
        },
      );

    response.nextMonitorStepId =
      monitorSteps.data.monitorStepsInstanceArray[nextMonitorStepIndex + 1]?.id;

    logger.debug(`Next Monitor Step ID: ${response.nextMonitorStepId}`);

    // now process probe response monitors
    logger.debug(
      `${dataToProcess.monitorId.toString()} - Processing monitor step...`,
    );

    response = await MonitorResourceUtil.processMonitorStep({
      dataToProcess: dataToProcess,
      monitorStep: monitorStep,
      monitor: monitor,
      probeApiIngestResponse: response,
      evaluationSummary: evaluationSummary,
    });

    if (response.criteriaMetId && response.rootCause) {
      logger.debug(
        `${dataToProcess.monitorId.toString()} - Criteria met: ${
          response.criteriaMetId
        }`,
      );
      logger.debug(
        `${dataToProcess.monitorId.toString()} - Root cause: ${
          response.rootCause
        }`,
      );

      let telemetryQuery: TelemetryQuery | undefined = undefined;

      if (dataToProcess && (dataToProcess as LogMonitorResponse).logQuery) {
        telemetryQuery = {
          telemetryQuery: (dataToProcess as LogMonitorResponse).logQuery,
          telemetryType: TelemetryType.Log,
          metricViewData: null,
        };
        logger.debug(
          `${dataToProcess.monitorId.toString()} - Log query found.`,
        );
      }

      if (dataToProcess && (dataToProcess as TraceMonitorResponse).spanQuery) {
        telemetryQuery = {
          telemetryQuery: (dataToProcess as TraceMonitorResponse).spanQuery,
          telemetryType: TelemetryType.Trace,
          metricViewData: null,
        };
        logger.debug(
          `${dataToProcess.monitorId.toString()} - Span query found.`,
        );
      }

      if (
        dataToProcess &&
        (dataToProcess as MetricMonitorResponse).metricViewConfig &&
        (dataToProcess as MetricMonitorResponse).startAndEndDate
      ) {
        telemetryQuery = {
          telemetryQuery: null,
          telemetryType: TelemetryType.Metric,
          metricViewData: {
            startAndEndDate:
              (dataToProcess as MetricMonitorResponse).startAndEndDate || null,
            queryConfigs: (dataToProcess as MetricMonitorResponse)
              .metricViewConfig.queryConfigs,
            formulaConfigs: (dataToProcess as MetricMonitorResponse)
              .metricViewConfig.formulaConfigs,
          },
        };
        logger.debug(
          `${dataToProcess.monitorId.toString()} - Span query found.`,
        );
      }

      const matchedCriteriaInstance: MonitorCriteriaInstance =
        criteriaInstanceMap[response.criteriaMetId!]!;

      const monitorStatusTimelineChange: MonitorStatusTimeline | null =
        await MonitorStatusTimelineUtil.updateMonitorStatusTimeline({
          monitor: monitor,
          rootCause: response.rootCause,
          dataToProcess: dataToProcess,
          criteriaInstance: matchedCriteriaInstance,
          props: {
            telemetryQuery: telemetryQuery,
          },
        });

      if (monitorStatusTimelineChange) {
        const changedStatusName: string | null = await getMonitorStatusName(
          matchedCriteriaInstance.data?.monitorStatusId ||
            monitorStatusTimelineChange.monitorStatusId,
        );

        evaluationSummary.events.push({
          type: "monitor-status-changed",
          title: "Monitor status updated",
          message: changedStatusName
            ? `Monitor status changed to "${changedStatusName}" because criteria "${matchedCriteriaInstance.data?.name || "Unnamed criteria"}" was met.`
            : `Monitor status changed because criteria "${matchedCriteriaInstance.data?.name || "Unnamed criteria"}" was met.`,
          relatedCriteriaId: matchedCriteriaInstance.data?.id,
          at: OneUptimeDate.getCurrentDate(),
        });
      }

      await MonitorIncident.criteriaMetCreateIncidentsAndUpdateMonitorStatus({
        monitor: monitor,
        rootCause: response.rootCause,
        dataToProcess: dataToProcess,
        autoResolveCriteriaInstanceIdIncidentIdsDictionary,
        criteriaInstance: matchedCriteriaInstance,
        evaluationSummary: evaluationSummary,
        props: {
          telemetryQuery: telemetryQuery,
        },
      });

      await MonitorAlert.criteriaMetCreateAlertsAndUpdateMonitorStatus({
        monitor: monitor,
        rootCause: response.rootCause,
        dataToProcess: dataToProcess,
        autoResolveCriteriaInstanceIdAlertIdsDictionary,
        criteriaInstance: criteriaInstanceAlertMap[response.criteriaMetId!]!,
        evaluationSummary: evaluationSummary,
        props: {
          telemetryQuery: telemetryQuery,
        },
      });
    } else if (
      !response.criteriaMetId &&
      monitorSteps.data.defaultMonitorStatusId &&
      monitor.currentMonitorStatusId?.toString() !==
        monitorSteps.data.defaultMonitorStatusId.toString()
    ) {
      logger.debug(
        `${dataToProcess.monitorId.toString()} - No criteria met. Change to default status.`,
      );

      await MonitorIncident.checkOpenIncidentsAndCloseIfResolved({
        monitorId: monitor.id!,
        autoResolveCriteriaInstanceIdIncidentIdsDictionary,
        rootCause: "No monitoring criteria met. Change to default status.",
        criteriaInstance: null, // no criteria met!
        dataToProcess: dataToProcess,
        evaluationSummary: evaluationSummary,
      });

      // get last monitor status timeline.
      const lastMonitorStatusTimeline: MonitorStatusTimeline | null =
        await MonitorStatusTimelineService.findOneBy({
          query: {
            monitorId: monitor.id!,
            projectId: monitor.projectId!,
          },
          select: {
            _id: true,
            monitorStatusId: true,
          },
          sort: {
            startsAt: SortOrder.Descending,
          },
          props: {
            isRoot: true,
          },
        });

      if (
        lastMonitorStatusTimeline &&
        lastMonitorStatusTimeline.monitorStatusId &&
        lastMonitorStatusTimeline.monitorStatusId.toString() ===
          monitorSteps.data.defaultMonitorStatusId.toString()
      ) {
        /*
         * status is same as last status. do not create new status timeline.
         * do nothing! status is same as last status.
         */
      } else {
        // if no criteria is met then update monitor to default state.
        const monitorStatusTimeline: MonitorStatusTimeline =
          new MonitorStatusTimeline();
        monitorStatusTimeline.monitorId = monitor.id!;
        monitorStatusTimeline.monitorStatusId =
          monitorSteps.data.defaultMonitorStatusId!;
        monitorStatusTimeline.projectId = monitor.projectId!;
        monitorStatusTimeline.isOwnerNotified = true; // no need to notify owner as this is default status.
        monitorStatusTimeline.statusChangeLog = JSON.parse(
          JSON.stringify(dataToProcess),
        );
        monitorStatusTimeline.rootCause =
          "No monitoring criteria met. Change to default status. ";

        await MonitorStatusTimelineService.create({
          data: monitorStatusTimeline,
          props: {
            isRoot: true,
          },
        });
        logger.debug(
          `${dataToProcess.monitorId.toString()} - Monitor status updated to default.`,
        );

        const defaultStatusName: string | null = await getMonitorStatusName(
          monitorSteps.data.defaultMonitorStatusId,
        );

        evaluationSummary.events.push({
          type: "monitor-status-changed",
          title: "Monitor status reverted",
          message: defaultStatusName
            ? `Monitor status reverted to "${defaultStatusName}" because no monitoring criteria were met.`
            : "Monitor status reverted to its default state because no monitoring criteria were met.",
          at: OneUptimeDate.getCurrentDate(),
        });
      }
    }

    if (mutex) {
      try {
        await Semaphore.release(mutex);
      } catch (err) {
        logger.error(err);
      }
    }

    MonitorResourceUtil.saveMonitorLog({
      monitorId: monitor.id!,
      projectId: monitor.projectId!,
      dataToProcess: dataToProcess,
    });

    return response;
  }

  @CaptureSpan()
  public static async saveMonitorMetrics(data: {
    monitorId: ObjectID;
    projectId: ObjectID;
    dataToProcess: DataToProcess;
    probeName: string | undefined;
    monitorName: string | undefined;
  }): Promise<void> {
    if (!data.monitorId) {
      return;
    }

    if (!data.projectId) {
      return;
    }

    if (!data.dataToProcess) {
      return;
    }

    const metricRows: Array<JSONObject> = [];

    /*
     * Metric name to serviceId map
     * example: "cpu.usage" -> [serviceId1, serviceId2]
     * since these are monitor metrics. They dont belong to any service so we can keep the array empty.
     */
    const metricNameServiceNameMap: Dictionary<MetricType> = {};

    if (
      (data.dataToProcess as ServerMonitorResponse).basicInfrastructureMetrics
    ) {
      // store cpu, memory, disk metrics.

      if ((data.dataToProcess as ServerMonitorResponse).requestReceivedAt) {
        let isOnline: boolean = true;

        const differenceInMinutes: number =
          OneUptimeDate.getDifferenceInMinutes(
            (data.dataToProcess as ServerMonitorResponse).requestReceivedAt,
            OneUptimeDate.getCurrentDate(),
          );

        if (differenceInMinutes > 2) {
          isOnline = false;
        }

        const attributes: JSONObject = this.buildMonitorMetricAttributes({
          monitorId: data.monitorId,
          projectId: data.projectId,
          monitorName: data.monitorName,
          probeName: data.probeName,
        });

        const metricRow: JSONObject = this.buildMonitorMetricRow({
          projectId: data.projectId,
          monitorId: data.monitorId,
          metricName: MonitorMetricType.IsOnline,
          value: isOnline ? 1 : 0,
          attributes: attributes,
          metricPointType: MetricPointType.Sum,
        });

        metricRows.push(metricRow);

        // add MetricType
        const metricType: MetricType = new MetricType();
        metricType.name = MonitorMetricType.IsOnline;
        metricType.description = CheckOn.IsOnline + " status for monitor";
        metricType.unit = "";

        // add to map
        metricNameServiceNameMap[MonitorMetricType.IsOnline] = metricType;
      }

      const basicMetrics: BasicInfrastructureMetrics | undefined = (
        data.dataToProcess as ServerMonitorResponse
      ).basicInfrastructureMetrics;

      if (!basicMetrics) {
        return;
      }

      if (basicMetrics.cpuMetrics) {
        const attributes: JSONObject = this.buildMonitorMetricAttributes({
          monitorId: data.monitorId,
          projectId: data.projectId,
          monitorName: data.monitorName,
          probeName: data.probeName,
        });

        const metricRow: JSONObject = this.buildMonitorMetricRow({
          projectId: data.projectId,
          monitorId: data.monitorId,
          metricName: MonitorMetricType.CPUUsagePercent,
          value: basicMetrics.cpuMetrics.percentUsed ?? null,
          attributes: attributes,
          metricPointType: MetricPointType.Sum,
        });

        metricRows.push(metricRow);

        const metricType: MetricType = new MetricType();
        metricType.name = MonitorMetricType.CPUUsagePercent;
        metricType.description = CheckOn.CPUUsagePercent + " of Server/VM";
        metricType.unit = "%";

        metricNameServiceNameMap[MonitorMetricType.CPUUsagePercent] =
          metricType;
      }

      if (basicMetrics.memoryMetrics) {
        const attributes: JSONObject = this.buildMonitorMetricAttributes({
          monitorId: data.monitorId,
          projectId: data.projectId,
          monitorName: data.monitorName,
          probeName: data.probeName,
        });

        const metricRow: JSONObject = this.buildMonitorMetricRow({
          projectId: data.projectId,
          monitorId: data.monitorId,
          metricName: MonitorMetricType.MemoryUsagePercent,
          value: basicMetrics.memoryMetrics.percentUsed ?? null,
          attributes: attributes,
          metricPointType: MetricPointType.Sum,
        });

        metricRows.push(metricRow);

        const metricType: MetricType = new MetricType();
        metricType.name = MonitorMetricType.MemoryUsagePercent;
        metricType.description = CheckOn.MemoryUsagePercent + " of Server/VM";
        metricType.unit = "%";

        metricNameServiceNameMap[MonitorMetricType.MemoryUsagePercent] =
          metricType;
      }

      if (basicMetrics.diskMetrics && basicMetrics.diskMetrics.length > 0) {
        for (const diskMetric of basicMetrics.diskMetrics) {
          const extraAttributes: JSONObject = {};

          if (diskMetric.diskPath) {
            extraAttributes["diskPath"] = diskMetric.diskPath;
          }

          const attributes: JSONObject = this.buildMonitorMetricAttributes({
            monitorId: data.monitorId,
            projectId: data.projectId,
            monitorName: data.monitorName,
            probeName: data.probeName,
            extraAttributes: extraAttributes,
          });

          const metricRow: JSONObject = this.buildMonitorMetricRow({
            projectId: data.projectId,
            monitorId: data.monitorId,
            metricName: MonitorMetricType.DiskUsagePercent,
            value: diskMetric.percentUsed ?? null,
            attributes: attributes,
            metricPointType: MetricPointType.Sum,
          });

          metricRows.push(metricRow);

          const metricType: MetricType = new MetricType();
          metricType.name = MonitorMetricType.DiskUsagePercent;
          metricType.description = CheckOn.DiskUsagePercent + " of Server/VM";
          metricType.unit = "%";

          metricNameServiceNameMap[MonitorMetricType.DiskUsagePercent] =
            metricType;
        }
      }
    }

    if (
      (data.dataToProcess as ProbeMonitorResponse).customCodeMonitorResponse
        ?.executionTimeInMS
    ) {
      const extraAttributes: JSONObject = {
        probeId: (
          data.dataToProcess as ProbeMonitorResponse
        ).probeId.toString(),
      };

      const attributes: JSONObject = this.buildMonitorMetricAttributes({
        monitorId: data.monitorId,
        projectId: data.projectId,
        extraAttributes: extraAttributes,
      });

      const metricRow: JSONObject = this.buildMonitorMetricRow({
        projectId: data.projectId,
        monitorId: data.monitorId,
        metricName: MonitorMetricType.ExecutionTime,
        value:
          (data.dataToProcess as ProbeMonitorResponse).customCodeMonitorResponse
            ?.executionTimeInMS ?? null,
        attributes: attributes,
        metricPointType: MetricPointType.Sum,
      });

      metricRows.push(metricRow);

      const metricType: MetricType = new MetricType();
      metricType.name = MonitorMetricType.ExecutionTime;
      metricType.description = CheckOn.ExecutionTime + " of this monitor";
      metricType.unit = "ms";

      metricNameServiceNameMap[MonitorMetricType.ExecutionTime] = metricType;
    }

    if (
      (data.dataToProcess as ProbeMonitorResponse) &&
      (data.dataToProcess as ProbeMonitorResponse).syntheticMonitorResponse &&
      (
        (data.dataToProcess as ProbeMonitorResponse).syntheticMonitorResponse ||
        []
      ).length > 0
    ) {
      for (const syntheticMonitorResponse of (
        data.dataToProcess as ProbeMonitorResponse
      ).syntheticMonitorResponse || []) {
        const extraAttributes: JSONObject = {
          probeId: (
            data.dataToProcess as ProbeMonitorResponse
          ).probeId.toString(),
        };

        if (syntheticMonitorResponse.browserType) {
          extraAttributes["browserType"] = syntheticMonitorResponse.browserType;
        }

        if (syntheticMonitorResponse.screenSizeType) {
          extraAttributes["screenSizeType"] =
            syntheticMonitorResponse.screenSizeType;
        }

        const attributes: JSONObject = this.buildMonitorMetricAttributes({
          monitorId: data.monitorId,
          projectId: data.projectId,
          monitorName: data.monitorName,
          probeName: data.probeName,
          extraAttributes: extraAttributes,
        });

        const metricRow: JSONObject = this.buildMonitorMetricRow({
          projectId: data.projectId,
          monitorId: data.monitorId,
          metricName: MonitorMetricType.ExecutionTime,
          value: syntheticMonitorResponse.executionTimeInMS ?? null,
          attributes: attributes,
          metricPointType: MetricPointType.Sum,
        });

        metricRows.push(metricRow);

        const metricType: MetricType = new MetricType();
        metricType.name = MonitorMetricType.ExecutionTime;
        metricType.description = CheckOn.ExecutionTime + " of this monitor";
        metricType.unit = "ms";

        metricNameServiceNameMap[MonitorMetricType.ExecutionTime] = metricType;
      }
    }

    if ((data.dataToProcess as ProbeMonitorResponse).responseTimeInMs) {
      const extraAttributes: JSONObject = {
        probeId: (
          data.dataToProcess as ProbeMonitorResponse
        ).probeId.toString(),
      };

      const attributes: JSONObject = this.buildMonitorMetricAttributes({
        monitorId: data.monitorId,
        projectId: data.projectId,
        monitorName: data.monitorName,
        probeName: data.probeName,
        extraAttributes: extraAttributes,
      });

      const metricRow: JSONObject = this.buildMonitorMetricRow({
        projectId: data.projectId,
        monitorId: data.monitorId,
        metricName: MonitorMetricType.ResponseTime,
        value:
          (data.dataToProcess as ProbeMonitorResponse).responseTimeInMs ?? null,
        attributes: attributes,
        metricPointType: MetricPointType.Sum,
      });

      metricRows.push(metricRow);

      const metricType: MetricType = new MetricType();
      metricType.name = MonitorMetricType.ResponseTime;
      metricType.description = CheckOn.ResponseTime + " of this monitor";
      metricType.unit = "ms";

      metricNameServiceNameMap[MonitorMetricType.ResponseTime] = metricType;
    }

    if ((data.dataToProcess as ProbeMonitorResponse).isOnline !== undefined) {
      const extraAttributes: JSONObject = {
        probeId: (
          data.dataToProcess as ProbeMonitorResponse
        ).probeId.toString(),
      };

      const attributes: JSONObject = this.buildMonitorMetricAttributes({
        monitorId: data.monitorId,
        projectId: data.projectId,
        monitorName: data.monitorName,
        probeName: data.probeName,
        extraAttributes: extraAttributes,
      });

      const metricRow: JSONObject = this.buildMonitorMetricRow({
        projectId: data.projectId,
        monitorId: data.monitorId,
        metricName: MonitorMetricType.IsOnline,
        value: (data.dataToProcess as ProbeMonitorResponse).isOnline ? 1 : 0,
        attributes: attributes,
        metricPointType: MetricPointType.Sum,
      });

      metricRows.push(metricRow);

      const metricType: MetricType = new MetricType();
      metricType.name = MonitorMetricType.IsOnline;
      metricType.description = CheckOn.IsOnline + " status for monitor";
      metricType.unit = "";

      metricNameServiceNameMap[MonitorMetricType.IsOnline] = metricType;
    }

    if ((data.dataToProcess as ProbeMonitorResponse).responseCode) {
      const extraAttributes: JSONObject = {
        probeId: (
          data.dataToProcess as ProbeMonitorResponse
        ).probeId.toString(),
      };

      const attributes: JSONObject = this.buildMonitorMetricAttributes({
        monitorId: data.monitorId,
        projectId: data.projectId,
        monitorName: data.monitorName,
        probeName: data.probeName,
        extraAttributes: extraAttributes,
      });

      const metricRow: JSONObject = this.buildMonitorMetricRow({
        projectId: data.projectId,
        monitorId: data.monitorId,
        metricName: MonitorMetricType.ResponseStatusCode,
        value:
          (data.dataToProcess as ProbeMonitorResponse).responseCode ?? null,
        attributes: attributes,
        metricPointType: MetricPointType.Sum,
      });

      metricRows.push(metricRow);

      const metricType: MetricType = new MetricType();
      metricType.name = MonitorMetricType.ResponseStatusCode;
      metricType.description = CheckOn.ResponseStatusCode + " for this monitor";
      metricType.unit = "Status Code";

      metricNameServiceNameMap[MonitorMetricType.ResponseStatusCode] =
        metricType;
    }

    if (metricRows.length > 0) {
      await MetricService.insertJsonRows(metricRows);
    }

    // index metrics
    TelemetryUtil.indexMetricNameServiceNameMap({
      projectId: data.projectId,
      metricNameServiceNameMap: metricNameServiceNameMap,
    }).catch((err: Error) => {
      logger.error(err);
    });
  }

  private static saveMonitorLog(data: {
    monitorId: ObjectID;
    projectId: ObjectID;
    dataToProcess: DataToProcess;
  }): void {
    if (!data.monitorId) {
      return;
    }

    if (!data.projectId) {
      return;
    }

    if (!data.dataToProcess) {
      return;
    }

    const logIngestionDate: Date = OneUptimeDate.getCurrentDate();
    const logTimestamp: string =
      OneUptimeDate.toClickhouseDateTime(logIngestionDate);

    const monitorLogRow: JSONObject = {
      _id: ObjectID.generate().toString(),
      createdAt: logTimestamp,
      updatedAt: logTimestamp,
      projectId: data.projectId.toString(),
      monitorId: data.monitorId.toString(),
      time: logTimestamp,
      logBody: JSON.parse(JSON.stringify(data.dataToProcess)),
    };

    MonitorLogService.insertJsonRows([monitorLogRow]).catch((err: Error) => {
      logger.error(err);
    });
  }

  private static async processMonitorStep(input: {
    dataToProcess: DataToProcess;
    monitorStep: MonitorStep;
    monitor: Monitor;
    probeApiIngestResponse: ProbeApiIngestResponse;
    evaluationSummary: MonitorEvaluationSummary;
  }): Promise<ProbeApiIngestResponse> {
    // process monitor step here.

    const criteria: MonitorCriteria | undefined =
      input.monitorStep.data?.monitorCriteria;

    if (!criteria || !criteria.data) {
      // do nothing as there's no criteria to process.
      return input.probeApiIngestResponse;
    }

    for (const criteriaInstance of criteria.data.monitorCriteriaInstanceArray) {
      const criteriaResult: MonitorEvaluationCriteriaResult = {
        criteriaId: criteriaInstance.data?.id,
        criteriaName: criteriaInstance.data?.name,
        filterCondition:
          criteriaInstance.data?.filterCondition || FilterCondition.All,
        met: false,
        message: "",
        filters: [],
      };

      input.evaluationSummary.criteriaResults.push(criteriaResult);

      const rootCause: string | null =
        await MonitorResourceUtil.processMonitorCriteiaInstance({
          dataToProcess: input.dataToProcess,
          monitorStep: input.monitorStep,
          monitor: input.monitor,
          probeApiIngestResponse: input.probeApiIngestResponse,
          criteriaInstance: criteriaInstance,
          criteriaResult: criteriaResult,
        });

      if (!criteriaResult.message) {
        criteriaResult.message = criteriaResult.met
          ? "Criteria met."
          : "Criteria was not met.";
      }

      const criteriaEvent: MonitorEvaluationEvent = {
        type: criteriaResult.met ? "criteria-met" : "criteria-not-met",
        title: `${criteriaResult.met ? "Criteria met" : "Criteria not met"}: ${criteriaResult.criteriaName || "Unnamed criteria"}`,
        message: criteriaResult.message,
        relatedCriteriaId: criteriaResult.criteriaId,
        at: OneUptimeDate.getCurrentDate(),
      };

      input.evaluationSummary.events.push(criteriaEvent);

      if (rootCause) {
        input.probeApiIngestResponse.criteriaMetId = criteriaInstance.data?.id;
        input.probeApiIngestResponse.rootCause = `
**Created because the following criteria was met**: 

**Criteria Name**: ${criteriaInstance.data?.name}
`;

        input.probeApiIngestResponse.rootCause += `
**Filter Conditions Met**: ${rootCause}
`;

        if ((input.dataToProcess as ProbeMonitorResponse).failureCause) {
          input.probeApiIngestResponse.rootCause += `
**Cause**: ${(input.dataToProcess as ProbeMonitorResponse).failureCause || ""}
`;
        }
        break;
      }
    }

    return input.probeApiIngestResponse;
  }

  private static async processMonitorCriteiaInstance(input: {
    dataToProcess: DataToProcess;
    monitorStep: MonitorStep;
    monitor: Monitor;
    probeApiIngestResponse: ProbeApiIngestResponse;
    criteriaInstance: MonitorCriteriaInstance;
    criteriaResult: MonitorEvaluationCriteriaResult;
  }): Promise<string | null> {
    /*
     * returns root cause if any. Otherwise criteria is not met.
     * process monitor criteria instance here.
     */

    const rootCause: string | null =
      await MonitorResourceUtil.isMonitorInstanceCriteriaFiltersMet({
        dataToProcess: input.dataToProcess,
        monitorStep: input.monitorStep,
        monitor: input.monitor,
        probeApiIngestResponse: input.probeApiIngestResponse,
        criteriaInstance: input.criteriaInstance,
        criteriaResult: input.criteriaResult,
      });

    // do nothing as there's no criteria to process.
    return rootCause;
  }

  private static async isMonitorInstanceCriteriaFiltersMet(input: {
    dataToProcess: DataToProcess;
    monitorStep: MonitorStep;
    monitor: Monitor;
    probeApiIngestResponse: ProbeApiIngestResponse;
    criteriaInstance: MonitorCriteriaInstance;
    criteriaResult: MonitorEvaluationCriteriaResult;
  }): Promise<string | null> {
    // returns root cause if any. Otherwise criteria is not met.
    const filterCondition: FilterCondition =
      input.criteriaInstance.data?.filterCondition || FilterCondition.All;

    const matchedFilterMessages: Array<string> = [];
    let hasMatch: boolean = false;
    let allFiltersMet: boolean = true;

    for (const criteriaFilter of input.criteriaInstance.data?.filters || []) {
      const rootCause: string | null =
        await MonitorResourceUtil.isMonitorInstanceCriteriaFilterMet({
          dataToProcess: input.dataToProcess,
          monitorStep: input.monitorStep,
          monitor: input.monitor,
          probeApiIngestResponse: input.probeApiIngestResponse,
          criteriaInstance: input.criteriaInstance,
          criteriaFilter: criteriaFilter,
        });

      const didMeetCriteria: boolean = Boolean(rootCause);

      const filterMessage: string =
        MonitorResourceUtil.buildCriteriaFilterMessage({
          monitor: input.monitor,
          criteriaFilter: criteriaFilter,
          dataToProcess: input.dataToProcess,
          monitorStep: input.monitorStep,
          didMeetCriteria: didMeetCriteria,
          matchMessage: rootCause,
        });

      const filterSummary: MonitorEvaluationFilterResult = {
        checkOn: criteriaFilter.checkOn,
        filterType: criteriaFilter.filterType,
        value: criteriaFilter.value,
        met: didMeetCriteria,
        message: filterMessage,
      };

      input.criteriaResult.filters.push(filterSummary);

      if (didMeetCriteria) {
        hasMatch = true;
        matchedFilterMessages.push(filterMessage);
      } else if (filterCondition === FilterCondition.All) {
        allFiltersMet = false;
      }
    }

    if (filterCondition === FilterCondition.All) {
      if (allFiltersMet && input.criteriaResult.filters.length > 0) {
        let message: string = "All filters met.";

        if (matchedFilterMessages.length > 0) {
          message += matchedFilterMessages
            .map((item: string) => {
              return `\n- ${item}`;
            })
            .join("");
        }

        input.criteriaResult.met = true;
        input.criteriaResult.message = message;

        return message;
      }

      input.criteriaResult.met = false;
      input.criteriaResult.message =
        "One or more filters did not meet the configured conditions.";

      return null;
    }

    if (filterCondition === FilterCondition.Any) {
      if (hasMatch) {
        const firstMatch: string =
          matchedFilterMessages[0] ||
          "At least one filter met the configured condition.";

        input.criteriaResult.met = true;
        input.criteriaResult.message = firstMatch;

        return firstMatch;
      }

      input.criteriaResult.met = false;
      input.criteriaResult.message =
        "No filters met the configured conditions.";

      return null;
    }

    return null;
  }

  private static getCriteriaFilterDescription(
    criteriaFilter: CriteriaFilter,
  ): string {
    const parts: Array<string> = [criteriaFilter.checkOn];

    if (criteriaFilter.filterType) {
      parts.push(criteriaFilter.filterType);
    }

    if (criteriaFilter.value !== undefined && criteriaFilter.value !== null) {
      parts.push(String(criteriaFilter.value));
    }

    return parts.join(" ").trim();
  }

  private static buildCriteriaFilterMessage(input: {
    monitor: Monitor;
    criteriaFilter: CriteriaFilter;
    dataToProcess: DataToProcess;
    monitorStep: MonitorStep;
    didMeetCriteria: boolean;
    matchMessage: string | null;
  }): string {
    if (input.matchMessage) {
      return input.matchMessage;
    }

    if (input.didMeetCriteria) {
      const description: string =
        MonitorResourceUtil.getCriteriaFilterDescription(input.criteriaFilter);

      return `${description} condition met.`;
    }

    const failureMessage: string | null =
      MonitorResourceUtil.buildCriteriaFilterFailureMessage({
        monitor: input.monitor,
        criteriaFilter: input.criteriaFilter,
        dataToProcess: input.dataToProcess,
        monitorStep: input.monitorStep,
      });

    if (failureMessage) {
      return failureMessage;
    }

    const description: string =
      MonitorResourceUtil.getCriteriaFilterDescription(input.criteriaFilter);

    return `${description} condition was not met.`;
  }

  private static buildCriteriaFilterFailureMessage(input: {
    monitor: Monitor;
    criteriaFilter: CriteriaFilter;
    dataToProcess: DataToProcess;
    monitorStep: MonitorStep;
  }): string | null {
    const expectation: string | null =
      MonitorResourceUtil.describeCriteriaExpectation(input.criteriaFilter);

    const observation: string | null =
      MonitorResourceUtil.describeFilterObservation({
        monitor: input.monitor,
        criteriaFilter: input.criteriaFilter,
        dataToProcess: input.dataToProcess,
        monitorStep: input.monitorStep,
      });

    if (observation) {
      if (expectation) {
        return `${observation} (expected ${expectation}).`;
      }

      return `${observation}; configured filter was not met.`;
    }

    if (expectation) {
      const description: string =
        MonitorResourceUtil.getCriteriaFilterDescription(input.criteriaFilter);

      return `${description} did not satisfy the configured condition (${expectation}).`;
    }

    return null;
  }

  private static describeCriteriaExpectation(
    criteriaFilter: CriteriaFilter,
  ): string | null {
    if (!criteriaFilter.filterType) {
      return null;
    }

    let expectation: string;

    const value: string | number | undefined = criteriaFilter.value;

    switch (criteriaFilter.filterType) {
      case FilterType.GreaterThan:
        expectation = `to be greater than ${value}`;
        break;
      case FilterType.GreaterThanOrEqualTo:
        expectation = `to be greater than or equal to ${value}`;
        break;
      case FilterType.LessThan:
        expectation = `to be less than ${value}`;
        break;
      case FilterType.LessThanOrEqualTo:
        expectation = `to be less than or equal to ${value}`;
        break;
      case FilterType.EqualTo:
        expectation = `to equal ${value}`;
        break;
      case FilterType.NotEqualTo:
        expectation = `to not equal ${value}`;
        break;
      case FilterType.Contains:
        expectation = `to contain ${value}`;
        break;
      case FilterType.NotContains:
        expectation = `to not contain ${value}`;
        break;
      case FilterType.StartsWith:
        expectation = `to start with ${value}`;
        break;
      case FilterType.EndsWith:
        expectation = `to end with ${value}`;
        break;
      case FilterType.IsEmpty:
        expectation = "to be empty";
        break;
      case FilterType.IsNotEmpty:
        expectation = "to not be empty";
        break;
      case FilterType.True:
        expectation = "to be true";
        break;
      case FilterType.False:
        expectation = "to be false";
        break;
      case FilterType.IsExecuting:
        expectation = "to be executing";
        break;
      case FilterType.IsNotExecuting:
        expectation = "to not be executing";
        break;
      case FilterType.RecievedInMinutes:
        expectation = value
          ? `to receive a heartbeat within ${value} minutes`
          : "to receive a heartbeat within the configured window";
        break;
      case FilterType.NotRecievedInMinutes:
        expectation = value
          ? `to miss a heartbeat for at least ${value} minutes`
          : "to miss a heartbeat within the configured window";
        break;
      case FilterType.EvaluatesToTrue:
        expectation = "to evaluate to true";
        break;
      default:
        expectation = `${criteriaFilter.filterType}${value ? ` ${value}` : ""}`;
        break;
    }

    const evaluationWindow: string | null =
      MonitorResourceUtil.getEvaluationWindowDescription(criteriaFilter);

    if (evaluationWindow) {
      expectation += ` ${evaluationWindow}`;
    }

    return expectation.trim();
  }

  private static getEvaluationWindowDescription(
    criteriaFilter: CriteriaFilter,
  ): string | null {
    const parts: Array<string> = [];

    if (
      criteriaFilter.eveluateOverTime &&
      criteriaFilter.evaluateOverTimeOptions?.timeValueInMinutes
    ) {
      parts.push(
        `over the last ${criteriaFilter.evaluateOverTimeOptions.timeValueInMinutes} minutes`,
      );
    }

    const aggregation: string | undefined =
      criteriaFilter.evaluateOverTimeOptions?.evaluateOverTimeType ||
      criteriaFilter.metricMonitorOptions?.metricAggregationType;

    if (aggregation) {
      parts.push(`using ${aggregation.toLowerCase()}`);
    }

    if (!parts.length) {
      return null;
    }

    return parts.join(" ");
  }

  private static describeFilterObservation(input: {
    monitor: Monitor;
    criteriaFilter: CriteriaFilter;
    dataToProcess: DataToProcess;
    monitorStep: MonitorStep;
  }): string | null {
    const { criteriaFilter } = input;

    switch (criteriaFilter.checkOn) {
      case CheckOn.ResponseTime:
        return MonitorResourceUtil.describeResponseTimeObservation(input);
      case CheckOn.ResponseStatusCode:
        return MonitorResourceUtil.describeResponseStatusCodeObservation(input);
      case CheckOn.ResponseHeader:
        return MonitorResourceUtil.describeResponseHeaderObservation(input);
      case CheckOn.ResponseHeaderValue:
        return MonitorResourceUtil.describeResponseHeaderValueObservation(input);
      case CheckOn.ResponseBody:
        return MonitorResourceUtil.describeResponseBodyObservation(input);
      case CheckOn.IsOnline:
        return MonitorResourceUtil.describeIsOnlineObservation(input);
      case CheckOn.IsRequestTimeout:
        return MonitorResourceUtil.describeIsTimeoutObservation(input);
      case CheckOn.IncomingRequest:
        return MonitorResourceUtil.describeIncomingRequestObservation(input);
      case CheckOn.RequestBody:
        return MonitorResourceUtil.describeRequestBodyObservation(input);
      case CheckOn.RequestHeader:
        return MonitorResourceUtil.describeRequestHeaderObservation(input);
      case CheckOn.RequestHeaderValue:
        return MonitorResourceUtil.describeRequestHeaderValueObservation(input);
      case CheckOn.JavaScriptExpression:
        return MonitorResourceUtil.describeJavaScriptExpressionObservation(input);
      case CheckOn.CPUUsagePercent:
        return MonitorResourceUtil.describeCpuUsageObservation(input);
      case CheckOn.MemoryUsagePercent:
        return MonitorResourceUtil.describeMemoryUsageObservation(input);
      case CheckOn.DiskUsagePercent:
        return MonitorResourceUtil.describeDiskUsageObservation(input);
      case CheckOn.ServerProcessName:
        return MonitorResourceUtil.describeServerProcessNameObservation(input);
      case CheckOn.ServerProcessPID:
        return MonitorResourceUtil.describeServerProcessPidObservation(input);
      case CheckOn.ServerProcessCommand:
        return MonitorResourceUtil.describeServerProcessCommandObservation(input);
      case CheckOn.ExpiresInHours:
        return MonitorResourceUtil.describeCertificateExpiresInHoursObservation(
          input,
        );
      case CheckOn.ExpiresInDays:
        return MonitorResourceUtil.describeCertificateExpiresInDaysObservation(
          input,
        );
      case CheckOn.IsSelfSignedCertificate:
        return MonitorResourceUtil.describeIsSelfSignedObservation(input);
      case CheckOn.IsExpiredCertificate:
        return MonitorResourceUtil.describeIsExpiredObservation(input);
      case CheckOn.IsValidCertificate:
        return MonitorResourceUtil.describeIsValidObservation(input);
      case CheckOn.IsNotAValidCertificate:
        return MonitorResourceUtil.describeIsInvalidObservation(input);
      case CheckOn.ResultValue:
        return MonitorResourceUtil.describeResultValueObservation(input);
      case CheckOn.Error:
        return MonitorResourceUtil.describeErrorObservation(input);
      case CheckOn.ExecutionTime:
        return MonitorResourceUtil.describeExecutionTimeObservation(input);
      case CheckOn.ScreenSizeType:
        return MonitorResourceUtil.describeScreenSizeObservation(input);
      case CheckOn.BrowserType:
        return MonitorResourceUtil.describeBrowserObservation(input);
      case CheckOn.LogCount:
        return MonitorResourceUtil.describeLogCountObservation(input);
      case CheckOn.SpanCount:
        return MonitorResourceUtil.describeSpanCountObservation(input);
      case CheckOn.MetricValue:
        return MonitorResourceUtil.describeMetricValueObservation(input);
      default:
        return null;
    }
  }

  private static describeResponseTimeObservation(input: {
    criteriaFilter: CriteriaFilter;
    dataToProcess: DataToProcess;
  }): string | null {
    const probeResponse: ProbeMonitorResponse | null =
      MonitorResourceUtil.getProbeMonitorResponse(input.dataToProcess);

    if (!probeResponse) {
      return null;
    }

    const responseTime: number | undefined =
      probeResponse.responseTimeInMs ?? undefined;

    if (responseTime === undefined || responseTime === null) {
      return "Response time metric was not recorded";
    }

    const formatted: string | null = MonitorResourceUtil.formatNumber(
      responseTime,
      { maximumFractionDigits: 2 },
    );

    const evaluationWindow: string | null =
      MonitorResourceUtil.getEvaluationWindowDescription(
        input.criteriaFilter,
      );

    let message: string = `Response Time (in ms) was ${formatted ?? responseTime} ms`;

    if (evaluationWindow) {
      message += ` ${evaluationWindow}`;
    }

    return message;
  }

  private static describeResponseStatusCodeObservation(input: {
    dataToProcess: DataToProcess;
  }): string | null {
    const probeResponse: ProbeMonitorResponse | null =
      MonitorResourceUtil.getProbeMonitorResponse(input.dataToProcess);

    if (!probeResponse) {
      return null;
    }

    if (probeResponse.responseCode === undefined) {
      return "Response status code was not recorded";
    }

    return `Response Status Code was ${probeResponse.responseCode}.`;
  }

  private static describeResponseHeaderObservation(input: {
    dataToProcess: DataToProcess;
  }): string | null {
    const probeResponse: ProbeMonitorResponse | null =
      MonitorResourceUtil.getProbeMonitorResponse(input.dataToProcess);

    if (!probeResponse) {
      return null;
    }

    const headers: Array<string> = Object.keys(
      probeResponse.responseHeaders || {},
    ).map((header: string) => {
      return header.toLowerCase();
    });

    if (!headers.length) {
      return "Response headers were empty.";
    }

    return `Response headers present: ${MonitorResourceUtil.formatList(headers)}.`;
  }

  private static describeResponseHeaderValueObservation(input: {
    dataToProcess: DataToProcess;
  }): string | null {
    const probeResponse: ProbeMonitorResponse | null =
      MonitorResourceUtil.getProbeMonitorResponse(input.dataToProcess);

    if (!probeResponse) {
      return null;
    }

    const headerValues: Array<string> = Object.values(
      probeResponse.responseHeaders || {},
    ).map((value: string) => {
      return value.toLowerCase();
    });

    if (!headerValues.length) {
      return "Response header values were empty.";
    }

    return `Response header values: ${MonitorResourceUtil.formatList(headerValues)}.`;
  }

  private static describeResponseBodyObservation(input: {
    dataToProcess: DataToProcess;
  }): string | null {
    const probeResponse: ProbeMonitorResponse | null =
      MonitorResourceUtil.getProbeMonitorResponse(input.dataToProcess);

    if (!probeResponse) {
      return null;
    }

    if (!probeResponse.responseBody) {
      return "Response body was empty.";
    }

    let bodyAsString: string;

    if (typeof probeResponse.responseBody === Typeof.Object) {
      try {
        bodyAsString = JSON.stringify(probeResponse.responseBody);
      } catch (err) {
        logger.error(err);
        bodyAsString = "[object]";
      }
    } else {
      bodyAsString = probeResponse.responseBody as string;
    }

    return `Response body sample: ${MonitorResourceUtil.formatSnippet(bodyAsString)}.`;
  }

  private static describeIsOnlineObservation(input: {
    criteriaFilter: CriteriaFilter;
    dataToProcess: DataToProcess;
  }): string | null {
    const probeResponse: ProbeMonitorResponse | null =
      MonitorResourceUtil.getProbeMonitorResponse(input.dataToProcess);

    if (probeResponse && probeResponse.isOnline !== undefined) {
      return `Monitor reported ${probeResponse.isOnline ? "online" : "offline"} status at ${OneUptimeDate.getDateAsLocalFormattedString(probeResponse.monitoredAt)}.`;
    }

    const serverResponse: ServerMonitorResponse | null =
      MonitorResourceUtil.getServerMonitorResponse(input.dataToProcess);

    if (serverResponse) {
      const lastHeartbeat: Date = serverResponse.requestReceivedAt;
      const timeNow: Date =
        serverResponse.timeNow || OneUptimeDate.getCurrentDate();
      const minutesSinceHeartbeat: number =
        OneUptimeDate.getDifferenceInMinutes(lastHeartbeat, timeNow);

      const formattedMinutes: string | null = MonitorResourceUtil.formatNumber(
        minutesSinceHeartbeat,
        { maximumFractionDigits: 2 },
      );

      return `Server heartbeat last received ${formattedMinutes ?? minutesSinceHeartbeat} minutes ago.`;
    }

    return null;
  }

  private static describeIsTimeoutObservation(input: {
    dataToProcess: DataToProcess;
  }): string | null {
    const probeResponse: ProbeMonitorResponse | null =
      MonitorResourceUtil.getProbeMonitorResponse(input.dataToProcess);

    if (probeResponse && probeResponse.isTimeout !== undefined) {
      return probeResponse.isTimeout
        ? "Request timed out."
        : "Request completed before timeout.";
    }

    return "Timeout information was unavailable.";
  }

  private static describeIncomingRequestObservation(input: {
    criteriaFilter: CriteriaFilter;
    dataToProcess: DataToProcess;
  }): string | null {
    const incomingRequest: IncomingMonitorRequest | null =
      MonitorResourceUtil.getIncomingMonitorRequest(input.dataToProcess);

    if (!incomingRequest) {
      return null;
    }

    const lastHeartbeat: Date = incomingRequest.incomingRequestReceivedAt;
    const checkedAt: Date =
      incomingRequest.checkedAt || OneUptimeDate.getCurrentDate();

    const minutesSinceHeartbeat: number =
      OneUptimeDate.getDifferenceInMinutes(lastHeartbeat, checkedAt);

    const formattedMinutes: string | null = MonitorResourceUtil.formatNumber(
      minutesSinceHeartbeat,
      { maximumFractionDigits: 2 },
    );

    return `Last incoming request was ${formattedMinutes ?? minutesSinceHeartbeat} minutes ago (checked at ${OneUptimeDate.getDateAsLocalFormattedString(checkedAt)}).`;
  }

  private static describeRequestBodyObservation(input: {
    dataToProcess: DataToProcess;
  }): string | null {
    const incomingRequest: IncomingMonitorRequest | null =
      MonitorResourceUtil.getIncomingMonitorRequest(input.dataToProcess);

    if (!incomingRequest) {
      return null;
    }

    const requestBody: string | JSONObject | undefined =
      incomingRequest.requestBody;

    if (!requestBody) {
      return "Request body was empty.";
    }

    let requestBodyAsString: string;

    if (typeof requestBody === Typeof.Object) {
      try {
        requestBodyAsString = JSON.stringify(requestBody);
      } catch (err) {
        logger.error(err);
        requestBodyAsString = "[object]";
      }
    } else {
      requestBodyAsString = requestBody as string;
    }

    return `Request body sample: ${MonitorResourceUtil.formatSnippet(requestBodyAsString)}.`;
  }

  private static describeRequestHeaderObservation(input: {
    dataToProcess: DataToProcess;
  }): string | null {
    const incomingRequest: IncomingMonitorRequest | null =
      MonitorResourceUtil.getIncomingMonitorRequest(input.dataToProcess);

    if (!incomingRequest) {
      return null;
    }

    const headers: Array<string> = Object.keys(
      incomingRequest.requestHeaders || {},
    ).map((header: string) => {
      return header.toLowerCase();
    });

    if (!headers.length) {
      return "Request headers were empty.";
    }

    return `Request headers present: ${MonitorResourceUtil.formatList(headers)}.`;
  }

  private static describeRequestHeaderValueObservation(input: {
    dataToProcess: DataToProcess;
  }): string | null {
    const incomingRequest: IncomingMonitorRequest | null =
      MonitorResourceUtil.getIncomingMonitorRequest(input.dataToProcess);

    if (!incomingRequest) {
      return null;
    }

    const headerValues: Array<string> = Object.values(
      incomingRequest.requestHeaders || {},
    ).map((value: string) => {
      return value.toLowerCase();
    });

    if (!headerValues.length) {
      return "Request header values were empty.";
    }

    return `Request header values: ${MonitorResourceUtil.formatList(headerValues)}.`;
  }

  private static describeJavaScriptExpressionObservation(input: {
    criteriaFilter: CriteriaFilter;
  }): string | null {
    if (!input.criteriaFilter.value) {
      return "JavaScript expression evaluated to false.";
    }

    return `JavaScript expression "${input.criteriaFilter.value}" evaluated to false.`;
  }

  private static describeCpuUsageObservation(input: {
    dataToProcess: DataToProcess;
  }): string | null {
    const serverResponse: ServerMonitorResponse | null =
      MonitorResourceUtil.getServerMonitorResponse(input.dataToProcess);

    if (!serverResponse) {
      return null;
    }

    const cpuMetrics: BasicInfrastructureMetrics | undefined =
      serverResponse.basicInfrastructureMetrics;

    if (!cpuMetrics || !cpuMetrics.cpuMetrics) {
      return "CPU usage metrics were unavailable.";
    }

    const cpuPercent: string | null = MonitorResourceUtil.formatPercentage(
      cpuMetrics.cpuMetrics.percentUsed,
    );

    const coreInfo: string = cpuMetrics.cpuMetrics.cores
      ? ` across ${cpuMetrics.cpuMetrics.cores} core${cpuMetrics.cpuMetrics.cores > 1 ? "s" : ""}`
      : "";

    return `CPU Usage (in %) was ${cpuPercent ?? "unavailable"}${coreInfo}.`;
  }

  private static describeMemoryUsageObservation(input: {
    dataToProcess: DataToProcess;
  }): string | null {
    const serverResponse: ServerMonitorResponse | null =
      MonitorResourceUtil.getServerMonitorResponse(input.dataToProcess);

    if (!serverResponse) {
      return null;
    }

    const memoryMetrics: BasicInfrastructureMetrics | undefined =
      serverResponse.basicInfrastructureMetrics;

    if (!memoryMetrics || !memoryMetrics.memoryMetrics) {
      return "Memory usage metrics were unavailable.";
    }

    const percentUsed: string | null = MonitorResourceUtil.formatPercentage(
      memoryMetrics.memoryMetrics.percentUsed,
    );

    const used: string | null = MonitorResourceUtil.formatBytes(
      memoryMetrics.memoryMetrics.used,
    );
    const total: string | null = MonitorResourceUtil.formatBytes(
      memoryMetrics.memoryMetrics.total,
    );

    return `Memory Usage (in %) was ${percentUsed ?? "unavailable"} (${used ?? "?"} used of ${total ?? "?"}).`;
  }

  private static describeDiskUsageObservation(input: {
    criteriaFilter: CriteriaFilter;
    dataToProcess: DataToProcess;
  }): string | null {
    const serverResponse: ServerMonitorResponse | null =
      MonitorResourceUtil.getServerMonitorResponse(input.dataToProcess);

    if (!serverResponse) {
      return null;
    }

    const diskPath: string =
      input.criteriaFilter.serverMonitorOptions?.diskPath || "/";

    const diskMetric: BasicInfrastructureMetrics | undefined =
      serverResponse.basicInfrastructureMetrics;

    if (!diskMetric || !diskMetric.diskMetrics?.length) {
      return `Disk metrics for path ${diskPath} were unavailable.`;
    }

    const matchedDisk = diskMetric.diskMetrics.find((disk) => {
      return disk.diskPath.trim().toLowerCase() === diskPath.trim().toLowerCase();
    });

    if (!matchedDisk) {
      return `Disk metrics did not include path ${diskPath}.`;
    }

    const percentUsedValue: number | null =
      MonitorResourceUtil.computeDiskUsagePercent(matchedDisk);
    const percentUsed: string | null = MonitorResourceUtil.formatPercentage(
      percentUsedValue ?? undefined,
    );

    const used: string | null = MonitorResourceUtil.formatBytes(
      matchedDisk.used,
    );
    const total: string | null = MonitorResourceUtil.formatBytes(
      matchedDisk.total,
    );
    const free: string | null = MonitorResourceUtil.formatBytes(
      matchedDisk.free,
    );

    return `Disk Usage (in %) on disk ${diskPath} was ${percentUsed ?? "unavailable"} (${used ?? "?"} used of ${total ?? "?"}, free ${free ?? "?"}).`;
  }

  private static describeServerProcessNameObservation(input: {
    criteriaFilter: CriteriaFilter;
    dataToProcess: DataToProcess;
  }): string | null {
    const serverResponse: ServerMonitorResponse | null =
      MonitorResourceUtil.getServerMonitorResponse(input.dataToProcess);

    if (!serverResponse) {
      return null;
    }

    const thresholdName: string =
      (input.criteriaFilter.value ?? "").toString().trim().toLowerCase();

    const processes: Array<ServerProcess> = serverResponse.processes || [];

    const matchingProcesses: Array<ServerProcess> = processes.filter(
      (process: ServerProcess) => {
        return process.name.trim().toLowerCase() === thresholdName;
      },
    );

    if (matchingProcesses.length > 0) {
      const summary: string = matchingProcesses
        .map((process: ServerProcess) => {
          return `${process.name} (pid ${process.pid})`;
        })
        .join(", ");

      return `Process ${input.criteriaFilter.value} is running (${summary}).`;
    }

    const processSummary: string | null =
      MonitorResourceUtil.describeProcesses(processes);

    if (processSummary) {
      return `Process ${input.criteriaFilter.value} was not running. Active processes: ${processSummary}.`;
    }

    return `Process ${input.criteriaFilter.value} was not running.`;
  }

  private static describeServerProcessPidObservation(input: {
    criteriaFilter: CriteriaFilter;
    dataToProcess: DataToProcess;
  }): string | null {
    const serverResponse: ServerMonitorResponse | null =
      MonitorResourceUtil.getServerMonitorResponse(input.dataToProcess);

    if (!serverResponse) {
      return null;
    }

    const thresholdPid: string =
      (input.criteriaFilter.value ?? "").toString().trim().toLowerCase();

    const processes: Array<ServerProcess> = serverResponse.processes || [];

    const matchingProcesses: Array<ServerProcess> = processes.filter(
      (process: ServerProcess) => {
        return process.pid.toString().trim().toLowerCase() === thresholdPid;
      },
    );

    if (matchingProcesses.length > 0) {
      const summary: string = matchingProcesses
        .map((process: ServerProcess) => {
          return `${process.name} (pid ${process.pid})`;
        })
        .join(", ");

      return `Process with PID ${input.criteriaFilter.value} is running (${summary}).`;
    }

    const processSummary: string | null =
      MonitorResourceUtil.describeProcesses(processes);

    if (processSummary) {
      return `Process with PID ${input.criteriaFilter.value} was not running. Active processes: ${processSummary}.`;
    }

    return `Process with PID ${input.criteriaFilter.value} was not running.`;
  }

  private static describeServerProcessCommandObservation(input: {
    criteriaFilter: CriteriaFilter;
    dataToProcess: DataToProcess;
  }): string | null {
    const serverResponse: ServerMonitorResponse | null =
      MonitorResourceUtil.getServerMonitorResponse(input.dataToProcess);

    if (!serverResponse) {
      return null;
    }

    const thresholdCommand: string =
      (input.criteriaFilter.value ?? "").toString().trim().toLowerCase();

    const processes: Array<ServerProcess> = serverResponse.processes || [];

    const matchingProcesses: Array<ServerProcess> = processes.filter(
      (process: ServerProcess) => {
        return process.command.trim().toLowerCase() === thresholdCommand;
      },
    );

    if (matchingProcesses.length > 0) {
      const summary: string = matchingProcesses
        .map((process: ServerProcess) => {
          return `${process.command} (pid ${process.pid})`;
        })
        .join(", ");

      return `Process with command ${input.criteriaFilter.value} is running (${summary}).`;
    }

    const processSummary: string | null =
      MonitorResourceUtil.describeProcesses(processes);

    if (processSummary) {
      return `Process with command ${input.criteriaFilter.value} was not running. Active processes: ${processSummary}.`;
    }

    return `Process with command ${input.criteriaFilter.value} was not running.`;
  }

  private static describeCertificateExpiresInHoursObservation(input: {
    dataToProcess: DataToProcess;
  }): string | null {
    const sslResponse: SslMonitorResponse | null =
      MonitorResourceUtil.getSslResponse(input.dataToProcess);

    if (!sslResponse || !sslResponse.expiresAt) {
      return "SSL certificate expiration time was unavailable.";
    }

    const hoursRemaining: number = OneUptimeDate.getHoursBetweenTwoDates(
      OneUptimeDate.getCurrentDate(),
      sslResponse.expiresAt,
    );

    const formattedHours: string | null = MonitorResourceUtil.formatNumber(
      hoursRemaining,
      { maximumFractionDigits: 2 },
    );

    return `SSL certificate expires at ${OneUptimeDate.getDateAsLocalFormattedString(sslResponse.expiresAt)} (${formattedHours ?? hoursRemaining} hours remaining).`;
  }

  private static describeCertificateExpiresInDaysObservation(input: {
    dataToProcess: DataToProcess;
  }): string | null {
    const sslResponse: SslMonitorResponse | null =
      MonitorResourceUtil.getSslResponse(input.dataToProcess);

    if (!sslResponse || !sslResponse.expiresAt) {
      return "SSL certificate expiration time was unavailable.";
    }

    const daysRemaining: number = OneUptimeDate.getDaysBetweenTwoDates(
      OneUptimeDate.getCurrentDate(),
      sslResponse.expiresAt,
    );

    const formattedDays: string | null = MonitorResourceUtil.formatNumber(
      daysRemaining,
      { maximumFractionDigits: 2 },
    );

    return `SSL certificate expires at ${OneUptimeDate.getDateAsLocalFormattedString(sslResponse.expiresAt)} (${formattedDays ?? daysRemaining} days remaining).`;
  }

  private static describeIsSelfSignedObservation(input: {
    dataToProcess: DataToProcess;
  }): string | null {
    const sslResponse: SslMonitorResponse | null =
      MonitorResourceUtil.getSslResponse(input.dataToProcess);

    if (!sslResponse || sslResponse.isSelfSigned === undefined) {
      return "SSL certificate self-signed status was unavailable.";
    }

    return sslResponse.isSelfSigned
      ? "SSL certificate is self signed."
      : "SSL certificate is not self signed.";
  }

  private static describeIsExpiredObservation(input: {
    dataToProcess: DataToProcess;
  }): string | null {
    const sslResponse: SslMonitorResponse | null =
      MonitorResourceUtil.getSslResponse(input.dataToProcess);

    if (!sslResponse || !sslResponse.expiresAt) {
      return "SSL certificate expiration time was unavailable.";
    }

    const isExpired: boolean = OneUptimeDate.isBefore(
      sslResponse.expiresAt,
      OneUptimeDate.getCurrentDate(),
    );

    return isExpired
      ? "SSL certificate is expired."
      : "SSL certificate is not expired.";
  }

  private static describeIsValidObservation(input: {
    dataToProcess: DataToProcess;
  }): string | null {
    const probeResponse: ProbeMonitorResponse | null =
      MonitorResourceUtil.getProbeMonitorResponse(input.dataToProcess);

    const sslResponse: SslMonitorResponse | undefined =
      probeResponse?.sslResponse;

    const isValid: boolean = Boolean(
      sslResponse &&
        probeResponse?.isOnline &&
        sslResponse.expiresAt &&
        !sslResponse.isSelfSigned &&
        OneUptimeDate.isAfter(
          sslResponse.expiresAt,
          OneUptimeDate.getCurrentDate(),
        ),
    );

    if (!sslResponse) {
      return "SSL certificate details were unavailable.";
    }

    return isValid
      ? "SSL certificate is valid."
      : "SSL certificate is not valid.";
  }

  private static describeIsInvalidObservation(input: {
    dataToProcess: DataToProcess;
  }): string | null {
    const probeResponse: ProbeMonitorResponse | null =
      MonitorResourceUtil.getProbeMonitorResponse(input.dataToProcess);

    const sslResponse: SslMonitorResponse | undefined =
      probeResponse?.sslResponse;

    const isInvalid: boolean =
      !sslResponse ||
      !probeResponse?.isOnline ||
      Boolean(
        sslResponse &&
          sslResponse.expiresAt &&
          (sslResponse.isSelfSigned ||
            OneUptimeDate.isBefore(
              sslResponse.expiresAt,
              OneUptimeDate.getCurrentDate(),
            )),
      );

    if (!sslResponse) {
      return "SSL certificate details were unavailable.";
    }

    return isInvalid
      ? "SSL certificate is not valid."
      : "SSL certificate is valid.";
  }

  private static describeExecutionTimeObservation(input: {
    dataToProcess: DataToProcess;
  }): string | null {
    const syntheticResponses: Array<SyntheticMonitorResponse> =
      MonitorResourceUtil.getSyntheticMonitorResponses(input.dataToProcess);

    const executionTimes: Array<number> = syntheticResponses
      .map((response: SyntheticMonitorResponse) => {
        return response.executionTimeInMS;
      })
      .filter((value: number) => {
        return typeof value === "number" && !isNaN(value);
      });

    if (executionTimes.length > 0) {
      const summary: string | null = MonitorResourceUtil.summarizeNumericSeries(
        executionTimes,
      );

      if (summary) {
        return `Execution Time (in ms) recorded ${summary}.`;
      }
    }

    const customCodeResponse: CustomCodeMonitorResponse | null =
      MonitorResourceUtil.getCustomCodeMonitorResponse(input.dataToProcess);

    if (customCodeResponse) {
      const formatted: string | null = MonitorResourceUtil.formatNumber(
        customCodeResponse.executionTimeInMS,
        { maximumFractionDigits: 2 },
      );

      return `Execution Time (in ms) was ${formatted ?? customCodeResponse.executionTimeInMS} ms.`;
    }

    return "Execution time was unavailable.";
  }

  private static describeResultValueObservation(input: {
    dataToProcess: DataToProcess;
  }): string | null {
    const syntheticResponses: Array<SyntheticMonitorResponse> =
      MonitorResourceUtil.getSyntheticMonitorResponses(input.dataToProcess);

    const resultValues: Array<string> = syntheticResponses
      .map((response: SyntheticMonitorResponse) => {
        return MonitorResourceUtil.formatResultValue(response.result);
      })
      .filter((value: string) => {
        return value !== "undefined";
      });

    if (resultValues.length > 0) {
      const uniqueResults: Array<string> = Array.from(
        new Set(resultValues),
      );

      return `Result Value samples: ${MonitorResourceUtil.formatList(uniqueResults)}.`;
    }

    const customCodeResponse: CustomCodeMonitorResponse | null =
      MonitorResourceUtil.getCustomCodeMonitorResponse(input.dataToProcess);

    if (customCodeResponse && customCodeResponse.result !== undefined) {
      const formatted: string = MonitorResourceUtil.formatResultValue(
        customCodeResponse.result,
      );

      return `Result Value was ${MonitorResourceUtil.formatSnippet(formatted)}.`;
    }

    return "Result value was unavailable.";
  }

  private static describeErrorObservation(input: {
    dataToProcess: DataToProcess;
  }): string | null {
    const syntheticResponses: Array<SyntheticMonitorResponse> =
      MonitorResourceUtil.getSyntheticMonitorResponses(input.dataToProcess);

    const errors: Array<string> = syntheticResponses
      .map((response: SyntheticMonitorResponse) => {
        return response.scriptError;
      })
      .filter((value: string | undefined): value is string => {
        return Boolean(value);
      })
      .map((error: string) => {
        return MonitorResourceUtil.formatSnippet(error, 80);
      });

    if (errors.length > 0) {
      return `Script errors: ${MonitorResourceUtil.formatList(errors)}.`;
    }

    const customCodeResponse: CustomCodeMonitorResponse | null =
      MonitorResourceUtil.getCustomCodeMonitorResponse(input.dataToProcess);

    if (customCodeResponse?.scriptError) {
      return `Script error: ${MonitorResourceUtil.formatSnippet(customCodeResponse.scriptError, 80)}.`;
    }

    if (customCodeResponse?.logMessages?.length) {
      return `Script log messages: ${MonitorResourceUtil.formatList(customCodeResponse.logMessages)}.`;
    }

    return "No script errors were reported.";
  }

  private static describeScreenSizeObservation(input: {
    dataToProcess: DataToProcess;
  }): string | null {
    const syntheticResponses: Array<SyntheticMonitorResponse> =
      MonitorResourceUtil.getSyntheticMonitorResponses(input.dataToProcess);

    if (!syntheticResponses.length) {
      return "Synthetic monitor results were unavailable.";
    }

    const screenSizes: Array<string> = Array.from(
      new Set(
        syntheticResponses.map((response: SyntheticMonitorResponse) => {
          return response.screenSizeType;
        }),
      ),
    );

    return `Synthetic monitor screen sizes: ${MonitorResourceUtil.formatList(screenSizes)}.`;
  }

  private static describeBrowserObservation(input: {
    dataToProcess: DataToProcess;
  }): string | null {
    const syntheticResponses: Array<SyntheticMonitorResponse> =
      MonitorResourceUtil.getSyntheticMonitorResponses(input.dataToProcess);

    if (!syntheticResponses.length) {
      return "Synthetic monitor results were unavailable.";
    }

    const browsers: Array<string> = Array.from(
      new Set(
        syntheticResponses.map((response: SyntheticMonitorResponse) => {
          return response.browserType;
        }),
      ),
    );

    return `Synthetic monitor browsers: ${MonitorResourceUtil.formatList(browsers)}.`;
  }

  private static describeLogCountObservation(input: {
    dataToProcess: DataToProcess;
  }): string | null {
    const logResponse: LogMonitorResponse | null =
      MonitorResourceUtil.getLogMonitorResponse(input.dataToProcess);

    if (!logResponse) {
      return null;
    }

    return `Log count was ${logResponse.logCount}.`;
  }

  private static describeSpanCountObservation(input: {
    dataToProcess: DataToProcess;
  }): string | null {
    const traceResponse: TraceMonitorResponse | null =
      MonitorResourceUtil.getTraceMonitorResponse(input.dataToProcess);

    if (!traceResponse) {
      return null;
    }

    return `Span count was ${traceResponse.spanCount}.`;
  }

  private static describeMetricValueObservation(input: {
    criteriaFilter: CriteriaFilter;
    dataToProcess: DataToProcess;
    monitorStep: MonitorStep;
  }): string | null {
    const metricValues = MonitorResourceUtil.extractMetricValues({
      criteriaFilter: input.criteriaFilter,
      dataToProcess: input.dataToProcess,
      monitorStep: input.monitorStep,
    });

    if (!metricValues) {
      return null;
    }

    if (!metricValues.values.length) {
      return `Metric Value${metricValues.alias ? ` (${metricValues.alias})` : ""} returned no data points.`;
    }

    const summary: string | null = MonitorResourceUtil.summarizeNumericSeries(
      metricValues.values,
    );

    if (!summary) {
      return null;
    }

    return `Metric Value${metricValues.alias ? ` (${metricValues.alias})` : ""} recorded ${summary}.`;
  }

  private static getProbeMonitorResponse(
    dataToProcess: DataToProcess,
  ): ProbeMonitorResponse | null {
    if ((dataToProcess as ProbeMonitorResponse).monitorStepId) {
      return dataToProcess as ProbeMonitorResponse;
    }

    return null;
  }

  private static getServerMonitorResponse(
    dataToProcess: DataToProcess,
  ): ServerMonitorResponse | null {
    if ((dataToProcess as ServerMonitorResponse).hostname) {
      return dataToProcess as ServerMonitorResponse;
    }

    return null;
  }

  private static getIncomingMonitorRequest(
    dataToProcess: DataToProcess,
  ): IncomingMonitorRequest | null {
    if (
      (dataToProcess as IncomingMonitorRequest).incomingRequestReceivedAt !==
      undefined
    ) {
      return dataToProcess as IncomingMonitorRequest;
    }

    return null;
  }

  private static getLogMonitorResponse(
    dataToProcess: DataToProcess,
  ): LogMonitorResponse | null {
    if ((dataToProcess as LogMonitorResponse).logCount !== undefined) {
      return dataToProcess as LogMonitorResponse;
    }

    return null;
  }

  private static getTraceMonitorResponse(
    dataToProcess: DataToProcess,
  ): TraceMonitorResponse | null {
    if ((dataToProcess as TraceMonitorResponse).spanCount !== undefined) {
      return dataToProcess as TraceMonitorResponse;
    }

    return null;
  }

  private static getMetricMonitorResponse(
    dataToProcess: DataToProcess,
  ): MetricMonitorResponse | null {
    if ((dataToProcess as MetricMonitorResponse).metricResult !== undefined) {
      return dataToProcess as MetricMonitorResponse;
    }

    return null;
  }

  private static getCustomCodeMonitorResponse(
    dataToProcess: DataToProcess,
  ): CustomCodeMonitorResponse | null {
    const probeResponse: ProbeMonitorResponse | null =
      MonitorResourceUtil.getProbeMonitorResponse(dataToProcess);

    if (probeResponse?.customCodeMonitorResponse) {
      return probeResponse.customCodeMonitorResponse;
    }

    return null;
  }

  private static getSyntheticMonitorResponses(
    dataToProcess: DataToProcess,
  ): Array<SyntheticMonitorResponse> {
    const probeResponse: ProbeMonitorResponse | null =
      MonitorResourceUtil.getProbeMonitorResponse(dataToProcess);

    return probeResponse?.syntheticMonitorResponse || [];
  }

  private static getSslResponse(
    dataToProcess: DataToProcess,
  ): SslMonitorResponse | null {
    const probeResponse: ProbeMonitorResponse | null =
      MonitorResourceUtil.getProbeMonitorResponse(dataToProcess);

    if (probeResponse?.sslResponse) {
      return probeResponse.sslResponse;
    }

    return null;
  }

  private static formatNumber(
    value: number | null | undefined,
    options?: { maximumFractionDigits?: number },
  ): string | null {
    if (value === null || value === undefined || isNaN(value)) {
      return null;
    }

    const fractionDigits: number =
      options?.maximumFractionDigits !== undefined
        ? options.maximumFractionDigits
        : Math.abs(value) < 10
          ? 2
          : Math.abs(value) < 100
            ? 1
            : 0;

    return value.toFixed(fractionDigits);
  }

  private static formatPercentage(
    value: number | null | undefined,
  ): string | null {
    const formatted: string | null = MonitorResourceUtil.formatNumber(value, {
      maximumFractionDigits:
        value !== null && value !== undefined && Math.abs(value) < 100 ? 1 : 0,
    });

    if (!formatted) {
      return null;
    }

    return `${formatted}%`;
  }

  private static formatBytes(
    bytes: number | null | undefined,
  ): string | null {
    if (bytes === null || bytes === undefined || isNaN(bytes)) {
      return null;
    }

    const units: Array<string> = ["B", "KB", "MB", "GB", "TB", "PB"];
    let value: number = bytes;
    let index: number = 0;

    while (value >= 1024 && index < units.length - 1) {
      value = value / 1024;
      index++;
    }

    const formatted: string | null = MonitorResourceUtil.formatNumber(value, {
      maximumFractionDigits: value >= 100 ? 0 : value >= 10 ? 1 : 2,
    });

    if (!formatted) {
      return null;
    }

    return `${formatted} ${units[index]}`;
  }

  private static formatList(
    items: Array<string>,
    maxItems: number = 5,
  ): string {
    if (!items.length) {
      return "";
    }

    const trimmedItems: Array<string> = items.slice(0, maxItems);
    const suffix: string =
      items.length > maxItems ? `, +${items.length - maxItems} more` : "";

    return `${trimmedItems.join(", ")} ${suffix}`.trim();
  }

  private static formatSnippet(text: string, maxLength: number = 120): string {
    const sanitized: string = text.replace(/\s+/g, " ").trim();

    if (sanitized.length <= maxLength) {
      return sanitized;
    }

    return `${sanitized.slice(0, maxLength)}…`;
  }

  private static describeProcesses(
    processes: Array<ServerProcess>,
  ): string | null {
    if (!processes.length) {
      return null;
    }

    const processSummaries: Array<string> = processes.map(
      (process: ServerProcess) => {
        return `${process.name} (pid ${process.pid})`;
      },
    );

    return MonitorResourceUtil.formatList(processSummaries);
  }

  private static computeDiskUsagePercent(
    diskMetric: BasicInfrastructureMetrics["diskMetrics"][number],
  ): number | null {
    if (!diskMetric) {
      return null;
    }

    if (
      diskMetric.percentUsed !== undefined &&
      diskMetric.percentUsed !== null &&
      !isNaN(diskMetric.percentUsed)
    ) {
      return diskMetric.percentUsed;
    }

    if (
      diskMetric.percentFree !== undefined &&
      diskMetric.percentFree !== null &&
      !isNaN(diskMetric.percentFree)
    ) {
      return 100 - diskMetric.percentFree;
    }

    if (diskMetric.total && diskMetric.used && diskMetric.total > 0) {
      return (diskMetric.used / diskMetric.total) * 100;
    }

    return null;
  }

  private static extractMetricValues(input: {
    criteriaFilter: CriteriaFilter;
    dataToProcess: DataToProcess;
    monitorStep: MonitorStep;
  }): { alias: string | null; values: Array<number> } | null {
    const metricResponse: MetricMonitorResponse | null =
      MonitorResourceUtil.getMetricMonitorResponse(input.dataToProcess);

    if (!metricResponse) {
      return null;
    }

    const aggregatedResults: Array<AggregatedResult> =
      metricResponse.metricResult || [];

    if (!aggregatedResults.length) {
      return {
        alias: input.criteriaFilter.metricMonitorOptions?.metricAlias || null,
        values: [],
      };
    }

    let alias: string | null =
      input.criteriaFilter.metricMonitorOptions?.metricAlias || null;

    let result: AggregatedResult | undefined;

    if (alias) {
      const queryConfigs: Array<MetricQueryConfigData> =
        input.monitorStep.data?.metricMonitor?.metricViewConfig?.queryConfigs ||
        [];

      let aliasIndex: number = queryConfigs.findIndex(
        (queryConfig: MetricQueryConfigData) => {
          return queryConfig.metricAliasData?.metricVariable === alias;
        },
      );

      if (aliasIndex < 0) {
        const formulaConfigs: Array<MetricFormulaConfigData> =
          input.monitorStep.data?.metricMonitor?.metricViewConfig
            ?.formulaConfigs || [];

        const formulaIndex: number = formulaConfigs.findIndex(
          (formulaConfig: MetricFormulaConfigData) => {
            return formulaConfig.metricAliasData?.metricVariable === alias;
          },
        );

        if (formulaIndex >= 0) {
          aliasIndex = queryConfigs.length + formulaIndex;
        }
      }

      if (aliasIndex >= 0 && aliasIndex < aggregatedResults.length) {
        result = aggregatedResults[aliasIndex];
      }
    }

    if (!result) {
      result = aggregatedResults[0];
      if (!alias) {
        const defaultAlias: string | undefined =
          input.monitorStep.data?.metricMonitor?.metricViewConfig?.queryConfigs?.[0]?.metricAliasData?.metricVariable;
        alias = defaultAlias || null;
      }
    }

    if (!result) {
      return {
        alias: alias,
        values: [],
      };
    }

    const values: Array<number> = result.data
      .map((entry: AggregateModel) => {
        return entry.value;
      })
      .filter((value: number) => {
        return typeof value === "number" && !isNaN(value);
      });

    return {
      alias: alias,
      values: values,
    };
  }

  private static summarizeNumericSeries(values: Array<number>): string | null {
    if (!values.length) {
      return null;
    }

    const latest: number | undefined = values[values.length - 1];

    if (latest === undefined) {
      return null;
    }
    const latestFormatted: string | null = MonitorResourceUtil.formatNumber(
      latest,
      { maximumFractionDigits: 2 },
    );

    let summary: string = `latest ${latestFormatted ?? latest}`;

    if (values.length > 1) {
      const min: number = Math.min(...values);
      const max: number = Math.max(...values);

      const minFormatted: string | null = MonitorResourceUtil.formatNumber(
        min,
        { maximumFractionDigits: 2 },
      );
      const maxFormatted: string | null = MonitorResourceUtil.formatNumber(
        max,
        { maximumFractionDigits: 2 },
      );

      summary += ` (min ${minFormatted ?? min}, max ${maxFormatted ?? max})`;
    }

    summary += ` across ${values.length} data point${values.length === 1 ? "" : "s"}`;

    return summary;
  }

  private static formatResultValue(value: unknown): string {
    if (value === null || value === undefined) {
      return "undefined";
    }

    if (typeof value === Typeof.Object) {
      try {
        return JSON.stringify(value);
      } catch (err) {
        logger.error(err);
        return "[object]";
      }
    }

    return value.toString();
  }

  private static async isMonitorInstanceCriteriaFilterMet(input: {
    dataToProcess: DataToProcess;
    monitorStep: MonitorStep;
    monitor: Monitor;
    probeApiIngestResponse: ProbeApiIngestResponse;
    criteriaInstance: MonitorCriteriaInstance;
    criteriaFilter: CriteriaFilter;
  }): Promise<string | null> {
    /*
     * returns root cause if any. Otherwise criteria is not met.
     * process monitor criteria filter here.
     */

    if (input.criteriaFilter.checkOn === CheckOn.JavaScriptExpression) {
      let storageMap: JSONObject = {};

      if (
        input.monitor.monitorType === MonitorType.API ||
        input.monitor.monitorType === MonitorType.Website
      ) {
        // try to parse json
        let responseBody: JSONObject | null = null;
        try {
          responseBody = JSON.parse(
            ((input.dataToProcess as ProbeMonitorResponse)
              .responseBody as string) || "{}",
          );
        } catch (err) {
          logger.error(err);
          responseBody = (input.dataToProcess as ProbeMonitorResponse)
            .responseBody as JSONObject;
        }

        if (
          typeof responseBody === Typeof.String &&
          responseBody?.toString() === ""
        ) {
          // if empty string then set to empty object.
          responseBody = {};
        }

        storageMap = {
          responseBody: responseBody,
          responseHeaders: (input.dataToProcess as ProbeMonitorResponse)
            .responseHeaders,
          responseStatusCode: (input.dataToProcess as ProbeMonitorResponse)
            .responseCode,
          responseTimeInMs: (input.dataToProcess as ProbeMonitorResponse)
            .responseTimeInMs,
          isOnline: (input.dataToProcess as ProbeMonitorResponse).isOnline,
        };
      }

      if (input.monitor.monitorType === MonitorType.IncomingRequest) {
        storageMap = {
          requestBody: (input.dataToProcess as IncomingMonitorRequest)
            .requestBody,
          requestHeaders: (input.dataToProcess as IncomingMonitorRequest)
            .requestHeaders,
        };
      }

      // now evaluate the expression.
      let expression: string = input.criteriaFilter.value as string;
      expression = VMUtil.replaceValueInPlace(storageMap, expression, false); // now pass this to the VM.

      const code: string = `return Boolean(${expression});`;
      let result: ReturnResult | null = null;

      try {
        result = await VMUtil.runCodeInSandbox({
          code: code,
          options: {
            args: {},
          },
        });
      } catch (err) {
        logger.error(err);
        return null;
      }

      if (result && result.returnValue) {
        return `JavaScript Expression - ${expression} - evaluated to true.`;
      }

      return null; // if true then return null.
    }

    if (
      input.monitor.monitorType === MonitorType.API ||
      input.monitor.monitorType === MonitorType.Website ||
      input.monitor.monitorType === MonitorType.IP ||
      input.monitor.monitorType === MonitorType.Ping ||
      input.monitor.monitorType === MonitorType.Port
    ) {
      const apiRequestCriteriaResult: string | null =
        await APIRequestCriteria.isMonitorInstanceCriteriaFilterMet({
          dataToProcess: input.dataToProcess,
          criteriaFilter: input.criteriaFilter,
        });

      if (apiRequestCriteriaResult) {
        return apiRequestCriteriaResult;
      }
    }

    if (
      input.monitor.monitorType === MonitorType.CustomJavaScriptCode &&
      (input.dataToProcess as ProbeMonitorResponse).customCodeMonitorResponse
    ) {
      const criteriaResult: string | null =
        await CustomCodeMonitoringCriteria.isMonitorInstanceCriteriaFilterMet({
          monitorResponse: (input.dataToProcess as ProbeMonitorResponse)
            .customCodeMonitorResponse!,
          criteriaFilter: input.criteriaFilter,
        });

      if (criteriaResult) {
        return criteriaResult;
      }
    }

    if (
      input.monitor.monitorType === MonitorType.SyntheticMonitor &&
      (input.dataToProcess as ProbeMonitorResponse).syntheticMonitorResponse
    ) {
      const criteriaResult: string | null =
        await SyntheticMonitoringCriteria.isMonitorInstanceCriteriaFilterMet({
          monitorResponse:
            (input.dataToProcess as ProbeMonitorResponse)
              .syntheticMonitorResponse || [],
          criteriaFilter: input.criteriaFilter,
        });

      if (criteriaResult) {
        return criteriaResult;
      }
    }

    if (input.monitor.monitorType === MonitorType.IncomingRequest) {
      logger.debug(
        `${input.monitor.id?.toString()} - Incoming Request Monitor. Checking criteria filter.`,
      );
      //check  incoming request
      const incomingRequestResult: string | null =
        await IncomingRequestCriteria.isMonitorInstanceCriteriaFilterMet({
          dataToProcess: input.dataToProcess,
          criteriaFilter: input.criteriaFilter,
        });

      if (incomingRequestResult) {
        return incomingRequestResult;
      }
    }

    if (input.monitor.monitorType === MonitorType.SSLCertificate) {
      // check SSL monitor
      const sslMonitorResult: string | null =
        await SSLMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
          dataToProcess: input.dataToProcess,
          criteriaFilter: input.criteriaFilter,
        });

      if (sslMonitorResult) {
        return sslMonitorResult;
      }
    }

    if (input.monitor.monitorType === MonitorType.Server) {
      // check server monitor
      const serverMonitorResult: string | null =
        await ServerMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
          dataToProcess: input.dataToProcess,
          criteriaFilter: input.criteriaFilter,
        });

      if (serverMonitorResult) {
        return serverMonitorResult;
      }
    }

    if (input.monitor.monitorType === MonitorType.Logs) {
      // check server monitor
      const logMonitorResult: string | null =
        await LogMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
          dataToProcess: input.dataToProcess,
          criteriaFilter: input.criteriaFilter,
        });

      if (logMonitorResult) {
        return logMonitorResult;
      }
    }

    if (input.monitor.monitorType === MonitorType.Metrics) {
      // check server monitor
      const logMonitorResult: string | null =
        await MetricMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
          dataToProcess: input.dataToProcess,
          criteriaFilter: input.criteriaFilter,
          monitorStep: input.monitorStep,
        });

      if (logMonitorResult) {
        return logMonitorResult;
      }
    }

    if (input.monitor.monitorType === MonitorType.Traces) {
      // check server monitor
      const traceMonitorResult: string | null =
        await TraceMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
          dataToProcess: input.dataToProcess,
          criteriaFilter: input.criteriaFilter,
        });

      if (traceMonitorResult) {
        return traceMonitorResult;
      }
    }

    return null;
  }
}
