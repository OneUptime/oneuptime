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
import { CheckOn, CriteriaFilter } from "../../../Types/Monitor/CriteriaFilter";
import IncomingMonitorRequest from "../../../Types/Monitor/IncomingMonitor/IncomingMonitorRequest";
import MonitorCriteria from "../../../Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType, {
  MonitorTypeHelper,
} from "../../../Types/Monitor/MonitorType";
import ServerMonitorResponse from "../../../Types/Monitor/ServerMonitor/ServerMonitorResponse";
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

      const filterSummary: MonitorEvaluationFilterResult = {
        checkOn: criteriaFilter.checkOn,
        filterType: criteriaFilter.filterType,
        value: criteriaFilter.value,
        met: didMeetCriteria,
        message: didMeetCriteria
          ? rootCause ||
            MonitorResourceUtil.getCriteriaFilterSuccessMessage(criteriaFilter)
          : MonitorResourceUtil.getCriteriaFilterFailureMessage(criteriaFilter),
      };

      input.criteriaResult.filters.push(filterSummary);

      if (didMeetCriteria) {
        hasMatch = true;

        if (rootCause) {
          matchedFilterMessages.push(rootCause);
        } else {
          matchedFilterMessages.push(filterSummary.message);
        }
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

  private static getCriteriaFilterSuccessMessage(
    criteriaFilter: CriteriaFilter,
  ): string {
    const description: string =
      MonitorResourceUtil.getCriteriaFilterDescription(criteriaFilter);

    return `${description} condition met.`;
  }

  private static getCriteriaFilterFailureMessage(
    criteriaFilter: CriteriaFilter,
  ): string {
    const description: string =
      MonitorResourceUtil.getCriteriaFilterDescription(criteriaFilter);

    return `${description} condition was not met.`;
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
