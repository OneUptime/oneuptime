import MonitorProbeService from "../../Services/MonitorProbeService";
import MonitorService from "../../Services/MonitorService";
import MonitorStatusTimelineService from "../../Services/MonitorStatusTimelineService";
import logger from "../Logger";
import MonitorCriteriaEvaluator from "./MonitorCriteriaEvaluator";
import MonitorLogUtil from "./MonitorLogUtil";
import MonitorMetricUtil from "./MonitorMetricUtil";
import DataToProcess from "./DataToProcess";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import Dictionary from "../../../Types/Dictionary";
import BadDataException from "../../../Types/Exception/BadDataException";
import Semaphore, { SemaphoreMutex } from "../../Infrastructure/Semaphore";
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
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorProbe from "../../../Models/DatabaseModels/MonitorProbe";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import MonitorStatusTimeline from "../../../Models/DatabaseModels/MonitorStatusTimeline";
import OneUptimeDate from "../../../Types/Date";
import LogMonitorResponse from "../../../Types/Monitor/LogMonitor/LogMonitorResponse";
import MetricMonitorResponse from "../../../Types/Monitor/MetricMonitor/MetricMonitorResponse";
import TelemetryType from "../../../Types/Telemetry/TelemetryType";
import TraceMonitorResponse from "../../../Types/Monitor/TraceMonitor/TraceMonitorResponse";
import ExceptionMonitorResponse from "../../../Types/Monitor/ExceptionMonitor/ExceptionMonitorResponse";
import { TelemetryQuery } from "../../../Types/Telemetry/TelemetryQuery";
import MonitorIncident from "./MonitorIncident";
import MonitorAlert from "./MonitorAlert";
import MonitorStatusTimelineUtil from "./MonitorStatusTimeline";
import CaptureSpan from "../Telemetry/CaptureSpan";
import ExceptionMessages from "../../../Types/Exception/ExceptionMessages";
import MonitorEvaluationSummary from "../../../Types/Monitor/MonitorEvaluationSummary";
import MonitorStatusService from "../../Services/MonitorStatusService";
import { ProbeConnectionStatus } from "../../../Models/DatabaseModels/Probe";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";

interface ProbeAgreementResult {
  hasAgreement: boolean;
  agreementCount: number;
  requiredCount: number;
  totalActiveProbes: number;
  agreedCriteriaId: string | null;
  agreedRootCause: string | null;
}

export default class MonitorResourceUtil {
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
        return monitorStatusNameCache[cacheKey] ?? null;
      }

      const monitorStatus: MonitorStatus | null =
        await MonitorStatusService.findOneBy({
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
        minimumProbeAgreement: true,
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

    const serverMonitorResponse: ServerMonitorResponse | undefined =
      monitor.monitorType === MonitorType.Server &&
      (dataToProcess as ServerMonitorResponse).requestReceivedAt
        ? (dataToProcess as ServerMonitorResponse)
        : undefined;

    const incomingMonitorRequest: IncomingMonitorRequest | undefined =
      monitor.monitorType === MonitorType.IncomingRequest &&
      (dataToProcess as IncomingMonitorRequest).incomingRequestReceivedAt &&
      !(dataToProcess as IncomingMonitorRequest)
        .onlyCheckForIncomingRequestReceivedAt
        ? (dataToProcess as IncomingMonitorRequest)
        : undefined;

    let hasPersistedMonitorData: boolean = false;

    const persistLatestMonitorPayload: () => Promise<void> = async () => {
      if (hasPersistedMonitorData) {
        return;
      }

      if (serverMonitorResponse) {
        logger.debug(
          `${dataToProcess.monitorId.toString()} - Server request received at ${serverMonitorResponse.requestReceivedAt}`,
        );

        logger.debug(dataToProcess);

        await MonitorService.updateOneById({
          id: monitor.id!,
          data: {
            serverMonitorRequestReceivedAt:
              serverMonitorResponse.requestReceivedAt!,
            serverMonitorResponse,
          },
          props: {
            isRoot: true,
            ignoreHooks: true,
          },
        });

        logger.debug(
          `${dataToProcess.monitorId.toString()} - Monitor Server Response Updated`,
        );
      }

      if (incomingMonitorRequest) {
        logger.debug(
          `${dataToProcess.monitorId.toString()} - Incoming request received at ${incomingMonitorRequest.incomingRequestReceivedAt}`,
        );

        await MonitorService.updateOneById({
          id: monitor.id!,
          data: {
            incomingRequestMonitorHeartbeatCheckedAt:
              OneUptimeDate.getCurrentDate(),
            incomingMonitorRequest: JSON.parse(
              JSON.stringify(incomingMonitorRequest),
            ) as IncomingMonitorRequest,
          } as any,
          props: {
            isRoot: true,
            ignoreHooks: true,
          },
        });

        logger.debug(
          `${dataToProcess.monitorId.toString()} - Monitor Incoming Request Updated`,
        );
      }

      hasPersistedMonitorData = true;
    };

    logger.debug(
      `${dataToProcess.monitorId.toString()} - Saving monitor metrics`,
    );

    try {
      await MonitorMetricUtil.saveMonitorMetrics({
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
      await persistLatestMonitorPayload();

      MonitorLogUtil.saveMonitorLog({
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
      await persistLatestMonitorPayload();

      MonitorLogUtil.saveMonitorLog({
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

    response = await MonitorCriteriaEvaluator.processMonitorStep({
      dataToProcess: dataToProcess,
      monitorStep: monitorStep,
      monitor: monitor,
      probeApiIngestResponse: response,
      evaluationSummary: evaluationSummary,
    });

    // Check probe agreement for probe-based monitors
    if (
      monitor.monitorType &&
      MonitorTypeHelper.isProbableMonitor(monitor.monitorType)
    ) {
      const probeAgreementResult: ProbeAgreementResult =
        await MonitorResourceUtil.checkProbeAgreement({
          monitor: monitor,
          monitorStep: monitorStep,
          currentCriteriaMetId: response.criteriaMetId || null,
          currentRootCause: response.rootCause || null,
        });

      // Add probe agreement event to evaluation summary
      evaluationSummary.events.push({
        type: "probe-agreement",
        title: "Probe Agreement Check",
        message: probeAgreementResult.hasAgreement
          ? `Probe agreement reached: ${probeAgreementResult.agreementCount}/${probeAgreementResult.requiredCount} probes agree (${probeAgreementResult.totalActiveProbes} active probes total).`
          : `Probe agreement not reached: ${probeAgreementResult.agreementCount}/${probeAgreementResult.requiredCount} probes agree (${probeAgreementResult.totalActiveProbes} active probes total). Skipping status change.`,
        at: OneUptimeDate.getCurrentDate(),
      });

      if (!probeAgreementResult.hasAgreement) {
        logger.debug(
          `${dataToProcess.monitorId.toString()} - Probe agreement not met. ${probeAgreementResult.agreementCount}/${probeAgreementResult.requiredCount} probes agree. Skipping status change.`,
        );

        // Release lock and return early - no status change
        if (mutex) {
          try {
            await Semaphore.release(mutex);
          } catch (err) {
            logger.error(err);
          }
        }

        await persistLatestMonitorPayload();

        MonitorLogUtil.saveMonitorLog({
          monitorId: monitor.id!,
          projectId: monitor.projectId!,
          dataToProcess: dataToProcess,
        });

        response.evaluationSummary = evaluationSummary;
        return response;
      }

      // Use the agreed criteria result
      response.criteriaMetId = probeAgreementResult.agreedCriteriaId
        ? probeAgreementResult.agreedCriteriaId
        : undefined;
      response.rootCause = probeAgreementResult.agreedRootCause;
    }

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

      if (
        dataToProcess &&
        (dataToProcess as ExceptionMonitorResponse).exceptionQuery
      ) {
        const exceptionResponse: ExceptionMonitorResponse =
          dataToProcess as ExceptionMonitorResponse;
        telemetryQuery = {
          telemetryQuery: exceptionResponse.exceptionQuery,
          telemetryType: TelemetryType.Exception,
          metricViewData: null,
        };

        logger.debug(
          `${dataToProcess.monitorId.toString()} - Exception query found.`,
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

    await persistLatestMonitorPayload();

    MonitorLogUtil.saveMonitorLog({
      monitorId: monitor.id!,
      projectId: monitor.projectId!,
      dataToProcess: dataToProcess,
    });

    return response;
  }

  @CaptureSpan()
  private static async checkProbeAgreement(input: {
    monitor: Monitor;
    monitorStep: MonitorStep;
    currentCriteriaMetId: string | null;
    currentRootCause: string | null;
  }): Promise<ProbeAgreementResult> {
    const { monitor, monitorStep, currentCriteriaMetId, currentRootCause } =
      input;

    /*
     * If minimumProbeAgreement is not set, all probes must agree
     * Get all MonitorProbes for this monitor with their probe connection status
     */
    const monitorProbes: Array<MonitorProbe> = await MonitorProbeService.findBy(
      {
        query: {
          monitorId: monitor.id!,
        },
        select: {
          probeId: true,
          isEnabled: true,
          lastMonitoringLog: true,
          probe: {
            connectionStatus: true,
          },
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: {
          isRoot: true,
        },
      },
    );

    // Filter to only active probes (enabled AND connected)
    const activeProbes: Array<MonitorProbe> = monitorProbes.filter(
      (mp: MonitorProbe) => {
        return (
          mp.isEnabled &&
          mp.probe?.connectionStatus === ProbeConnectionStatus.Connected
        );
      },
    );

    // If no active probes, treat as agreement met (nothing to compare)
    if (activeProbes.length === 0) {
      logger.debug(
        `${monitor.id?.toString()} - No active probes found. Treating as agreement met.`,
      );
      return {
        hasAgreement: true,
        agreementCount: 0,
        requiredCount: 0,
        totalActiveProbes: 0,
        agreedCriteriaId: currentCriteriaMetId,
        agreedRootCause: currentRootCause,
      };
    }

    // Determine required count for agreement
    const requiredCount: number =
      monitor.minimumProbeAgreement ?? activeProbes.length;
    // Effective threshold cannot exceed number of active probes
    const effectiveThreshold: number = Math.min(
      requiredCount,
      activeProbes.length,
    );

    /*
     * Count how many probes agree on each criteria result
     * Key: criteriaId or "none" for no criteria met
     * Value: { count, rootCause }
     */
    const criteriaAgreements: Map<
      string,
      { count: number; rootCause: string | null }
    > = new Map();

    const stepId: string = monitorStep.id.toString();

    for (const monitorProbe of activeProbes) {
      const probeResponse: ProbeMonitorResponse | undefined =
        monitorProbe.lastMonitoringLog?.[stepId];

      if (!probeResponse) {
        // No response yet for this step from this probe - skip
        logger.debug(
          `${monitor.id?.toString()} - Probe ${monitorProbe.probeId?.toString()} has no response for step ${stepId}. Skipping.`,
        );
        continue;
      }

      // Evaluate this probe's response against criteria
      const tempResponse: ProbeApiIngestResponse = {
        monitorId: monitor.id!,
        criteriaMetId: undefined,
        rootCause: null,
      };

      const tempEvaluationSummary: MonitorEvaluationSummary = {
        evaluatedAt: OneUptimeDate.getCurrentDate(),
        criteriaResults: [],
        events: [],
      };

      const evaluatedResponse: ProbeApiIngestResponse =
        await MonitorCriteriaEvaluator.processMonitorStep({
          dataToProcess: probeResponse as DataToProcess,
          monitorStep: monitorStep,
          monitor: monitor,
          probeApiIngestResponse: tempResponse,
          evaluationSummary: tempEvaluationSummary,
        });

      // Record the result
      const criteriaKey: string = evaluatedResponse.criteriaMetId || "none";
      const existing: { count: number; rootCause: string | null } | undefined =
        criteriaAgreements.get(criteriaKey);

      if (existing) {
        existing.count += 1;
      } else {
        criteriaAgreements.set(criteriaKey, {
          count: 1,
          rootCause: evaluatedResponse.rootCause,
        });
      }
    }

    // Find the criteria with the most agreement
    let maxCount: number = 0;
    let winningCriteriaId: string | null = null;
    let winningRootCause: string | null = null;

    for (const [criteriaId, data] of criteriaAgreements) {
      if (data.count > maxCount) {
        maxCount = data.count;
        winningCriteriaId = criteriaId === "none" ? null : criteriaId;
        winningRootCause = data.rootCause;
      }
    }

    // Check if the winning criteria has reached the agreement threshold
    const hasAgreement: boolean = maxCount >= effectiveThreshold;

    logger.debug(
      `${monitor.id?.toString()} - Probe agreement check: ${maxCount}/${effectiveThreshold} probes agree on criteria "${winningCriteriaId || "none"}". Agreement ${hasAgreement ? "reached" : "not reached"}.`,
    );

    return {
      hasAgreement,
      agreementCount: maxCount,
      requiredCount: effectiveThreshold,
      totalActiveProbes: activeProbes.length,
      agreedCriteriaId: hasAgreement ? winningCriteriaId : null,
      agreedRootCause: hasAgreement ? winningRootCause : null,
    };
  }
}
