import MonitorProbeService from "../../Services/MonitorProbeService";
import MonitorService from "../../Services/MonitorService";
import MonitorStatusTimelineService, {
  MONITOR_STATUS_SAME_AS_PREVIOUS_ERROR_MESSAGE,
  MONITOR_STATUS_TIMELINE_LOCK_ERROR_MESSAGE,
} from "../../Services/MonitorStatusTimelineService";
import ServerException from "../../../Types/Exception/ServerException";
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
import { JSONObject } from "../../../Types/JSON";
import ProbeApiIngestResponse, {
  MatchedCriteriaResult,
  PerSeriesCriteriaMatch,
} from "../../../Types/Probe/ProbeApiIngestResponse";
import Incident from "../../../Models/DatabaseModels/Incident";
import Alert from "../../../Models/DatabaseModels/Alert";
import ProbeMonitorResponse from "../../../Types/Probe/ProbeMonitorResponse";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorProbe, {
  MonitorStepProbeResponse,
} from "../../../Models/DatabaseModels/MonitorProbe";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import MonitorStatusTimeline from "../../../Models/DatabaseModels/MonitorStatusTimeline";
import OneUptimeDate from "../../../Types/Date";
import LogMonitorResponse from "../../../Types/Monitor/LogMonitor/LogMonitorResponse";
import SecurityEventsMonitorResponse from "../../../Types/Monitor/SecurityEventsMonitor/SecurityEventsMonitorResponse";
import MetricMonitorResponse from "../../../Types/Monitor/MetricMonitor/MetricMonitorResponse";
import TelemetryType from "../../../Types/Telemetry/TelemetryType";
import TraceMonitorResponse from "../../../Types/Monitor/TraceMonitor/TraceMonitorResponse";
import ExceptionMonitorResponse from "../../../Types/Monitor/ExceptionMonitor/ExceptionMonitorResponse";
import { TelemetryQuery } from "../../../Types/Telemetry/TelemetryQuery";
import MonitorIncident from "./MonitorIncident";
import MonitorAlert from "./MonitorAlert";
import MonitorSummaryCapture from "./MonitorSummaryCapture";
import MonitorSummarySnapshot from "../../../Types/Monitor/MonitorSummarySnapshot";
import IncomingRequestIncidentGrouping from "./IncomingRequestIncidentGrouping";
import MonitorMaintenanceSuppression from "./MonitorMaintenanceSuppression";
import MonitorDependencySuppression, {
  DependencySuppressionResult,
} from "./MonitorDependencySuppression";
import MonitorStatusTimelineUtil from "./MonitorStatusTimeline";
import CaptureSpan from "../Telemetry/CaptureSpan";
import ExceptionMessages from "../../../Types/Exception/ExceptionMessages";
import MonitorEvaluationSummary from "../../../Types/Monitor/MonitorEvaluationSummary";
import MonitorStatusService from "../../Services/MonitorStatusService";
import ProjectScopedReferenceValidator from "../Database/ProjectScopedReferenceValidator";
import { ProbeConnectionStatus } from "../../../Models/DatabaseModels/Probe";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";

interface ProbeAgreementResult {
  hasAgreement: boolean;
  agreementCount: number;
  requiredCount: number;
  totalActiveProbes: number;
  agreedCriteriaId: string | null;
  agreedRootCause: string | null;
  agreedProbeNames: Array<string>;
}

export default class MonitorResourceUtil {
  @CaptureSpan()
  public static async monitorResource(
    dataToProcess: DataToProcess,
  ): Promise<ProbeApiIngestResponse> {
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
        /*
         * How often this monitor is checked. Over-time criteria filters need
         * it to work out how many samples a fully covered evaluation window
         * should hold - without it a monitor that has only just started
         * looks the same as one whose whole window is breaching.
         */
        monitoringInterval: true,
        /*
         * Recorded as oneuptime.label.* / oneuptime.customField.* attributes on
         * every monitor metric this result produces, so response time and
         * uptime are groupable by a project's own taxonomy. Selected here
         * rather than re-read inside MonitorMetricUtil: this is the hottest
         * Postgres path in the product and it already loads the monitor.
         */
        labels: {
          _id: true,
          name: true,
        },
        customFields: true,
        /*
         * Alert-dependency suppression inputs. Selected here for the same
         * reason as labels: this query already loads the monitor on the
         * hottest path, and both lists are empty for the overwhelming
         * majority of monitors, in which case suppression costs nothing.
         * Ids only — names are fetched by the suppression util's own
         * parents query, so selecting them here would just duplicate the
         * joined row payload on every evaluation.
         */
        dependsOnMonitors: {
          _id: true,
        },
        suppressAlertsWhenParentMonitorStatuses: {
          _id: true,
        },
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

    /*
     * Acquire a per-monitor lock so concurrent results for the same monitor are
     * processed serially. This MUST come after the validation above: acquiring
     * before the not-found/disabled checks meant those throw paths held — and
     * leaked — the lock. redis-semaphore keeps a refresh timer alive until
     * release() is called, so a leaked lock pinned the Redis key until pod
     * restart and forced every other worker to spin on acquire. The try/finally
     * below guarantees the lock is released on every exit path (return or
     * throw); acquireTimeout/retryInterval cap the acquire spin so a contended
     * lock fails fast instead of polling Redis for 10s.
     *
     * On acquire timeout we DO NOT continue unlocked. Falling through without
     * the lock silently abandons the per-monitor serialization this lock exists
     * to provide — concurrent results for the same monitor would then race
     * incident/alert dedup and status-timeline writes (duplicate
     * incidents/alerts, status flaps) exactly under the high contention the
     * lock is meant to handle. Instead we surface the contention so the work is
     * retried once the lock frees: the Telemetry queue re-runs each ingest job
     * up to 3x with exponential backoff, and the per-monitor crons catch-and-
     * skip to re-evaluate on their next tick. The dominant source of
     * same-monitor contention (an external sender hammering one Incoming
     * Request URL) is collapsed upstream by BullMQ job coalescing at enqueue
     * time (see TelemetryQueueService.addIncomingRequestIngestJob), so this
     * throw is a correctness backstop for the rare residual collision (e.g.
     * cron vs ingest), not the steady-state path.
     */
    let mutex: SemaphoreMutex | null = null;

    try {
      mutex = await Semaphore.lock({
        key: dataToProcess.monitorId.toString(),
        namespace: "MonitorResourceUtil.monitorResource",
        acquireTimeout: 2000,
        retryInterval: 100,
        acquireAttemptsLimit: 20,
      });
    } catch (err) {
      logger.debug(
        `${dataToProcess.monitorId.toString()} - Could not acquire per-monitor processing lock within the acquire window; another worker is processing this monitor. Deferring to retry to preserve serialization.`,
      );
      throw err;
    }

    const releaseMutex: () => Promise<void> = async (): Promise<void> => {
      if (mutex) {
        try {
          await Semaphore.release(mutex);
        } catch (err) {
          logger.error(err);
        }
        mutex = null;
      }
    };

    try {
      let probeName: string | undefined = undefined;
      const monitorName: string | undefined = monitor.name || undefined;

      /*
       * All MonitorProbe rows for this monitor, fetched once per result and
       * reused by checkProbeAgreement below. The rows carry the heavy
       * lastMonitoringLog jsonb, so re-fetching them per result was the
       * second-largest read on the hottest Postgres path. Safe to reuse: the
       * per-monitor semaphore above serializes every writer of these rows
       * for the duration of this function.
       */
      let monitorProbesForMonitor: Array<MonitorProbe> | null = null;

      /*
       * SNMP trap responses are event-driven, not check results. They are
       * evaluated ONLY against trap criteria; they must not overwrite the
       * last check's counters, participate in probe agreement, or reset the
       * monitor to its default status when no criteria matches.
       */
      const isSnmpTrapEvent: boolean = Boolean(
        (dataToProcess as ProbeMonitorResponse).snmpTrapResponse,
      );

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
          /*
           * One query for every probe assigned to this monitor (instead of
           * one for the current probe here plus another for all of them in
           * checkProbeAgreement). The select is the union both consumers
           * need.
           */
          monitorProbesForMonitor = await MonitorProbeService.findBy({
            query: {
              monitorId: monitor.id!,
            },
            select: {
              _id: true,
              probeId: true,
              isEnabled: true,
              lastMonitoringLog: true,
              probe: {
                name: true,
                connectionStatus: true,
              },
            },
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            props: {
              isRoot: true,
            },
          });

          const monitorProbe: MonitorProbe | undefined =
            monitorProbesForMonitor.find((mp: MonitorProbe) => {
              return (
                mp.probeId?.toString() ===
                (dataToProcess as ProbeMonitorResponse).probeId!.toString()
              );
            });

          if (!monitorProbe) {
            throw new BadDataException("Probe is not assigned to this monitor");
          }

          probeName = monitorProbe.probe?.name || undefined;

          /*
           * Network Device monitors no longer flow through here: they are
           * not probeable — the NetworkDevice resource owns its own polling
           * and NetworkDeviceWalkUtil computes interface rates, syncs
           * inventory, and evaluates watching monitors on each device walk.
           */

          if (!isSnmpTrapEvent) {
            /*
             * Runs once per probe check result — the hottest recurring write
             * in the product. The full updateOneBy pipeline would re-SELECT
             * this row (including the large lastMonitoringLog jsonb we just
             * fetched above) and then save() it (another SELECT + UPDATE in a
             * transaction). MonitorProbe has no workflow/audit/realtime
             * decorators, so those hooks were inert anyway — a single
             * UPDATE by the id we already hold is equivalent and 3x cheaper.
             * See the Monitor heartbeat writes below for the same pattern.
             */
            const updatedLastMonitoringLog: MonitorStepProbeResponse = {
              ...(monitorProbe.lastMonitoringLog || {}),
              [(
                dataToProcess as ProbeMonitorResponse
              ).monitorStepId.toString()]: {
                ...JSON.parse(JSON.stringify(dataToProcess)),
                monitoredAt: OneUptimeDate.getCurrentDate(),
              },
            };

            await MonitorProbeService.updateColumnsByIdWithoutHooks({
              id: monitorProbe.id!,
              data: {
                lastMonitoringLog: updatedLastMonitoringLog as any,
              },
            });

            /*
             * Mirror the write onto the in-memory row so checkProbeAgreement
             * (which reuses monitorProbesForMonitor instead of re-querying)
             * sees exactly what a fresh read would return.
             */
            monitorProbe.lastMonitoringLog = updatedLastMonitoringLog;
          }
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

          /*
           * Skip persistence when this evaluation originated from the
           * CheckOnlineStatus cron (onlyCheckRequestReceivedAt=true). The cron
           * re-evaluates using the already-stale value read from the DB and has
           * no new heartbeat data to persist — writing it back would race with
           * (and overwrite) the ingest path's fresh heartbeat update, causing
           * the monitor to flap between Online and Offline every minute.
           */
          if (!serverMonitorResponse.onlyCheckRequestReceivedAt) {
            /*
             * Heartbeat write: single-statement UPDATE, no hooks and no
             * `version` bump. This DELIBERATELY drops the per-update workflow
             * trigger and audit-log entry that Monitor's @EnableWorkflow /
             * @EnableAuditLog fire on every changed update — the old
             * `ignoreHooks: true` did NOT suppress those (they are gated on
             * the model flag, not on ignoreHooks), so a heartbeat used to
             * spam an on-update workflow + an audit row every ingest. A
             * liveness ping should do neither. onUpdateSuccess is inert here
             * regardless (gated on status/interval/steps/name/etc., none of
             * which are written). Also skips the pre-SELECT that would reload
             * the large serverMonitorResponse jsonb row. See
             * ServiceService.updateLastSeen.
             */
            await MonitorService.updateColumnsByIdWithoutHooks({
              id: monitor.id!,
              data: {
                serverMonitorRequestReceivedAt:
                  serverMonitorResponse.requestReceivedAt!,
                serverMonitorResponse,
              },
            });

            logger.debug(
              `${dataToProcess.monitorId.toString()} - Monitor Server Response Updated`,
            );
          } else {
            logger.debug(
              `${dataToProcess.monitorId.toString()} - Skipping Monitor Server Response persist (cron re-evaluation).`,
            );
          }
        }

        if (incomingMonitorRequest) {
          logger.debug(
            `${dataToProcess.monitorId.toString()} - Incoming request received at ${incomingMonitorRequest.incomingRequestReceivedAt}`,
          );

          /*
           * Heartbeat write: single-statement UPDATE, no hooks and no
           * `version` bump. As with the server-monitor branch above, this
           * deliberately drops the per-update workflow trigger + audit-log
           * entry Monitor would otherwise fire on every heartbeat, and skips
           * the pre-SELECT of the large incomingMonitorRequest jsonb row. See
           * ServiceService.updateLastSeen.
           */
          await MonitorService.updateColumnsByIdWithoutHooks({
            id: monitor.id!,
            data: {
              incomingRequestMonitorHeartbeatCheckedAt:
                OneUptimeDate.getCurrentDate(),
              incomingMonitorRequest: JSON.parse(
                JSON.stringify(incomingMonitorRequest),
              ) as IncomingMonitorRequest,
            } as any,
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
          monitorLabels: monitor.labels || undefined,
          monitorCustomFields: monitor.customFields || undefined,
        });
      } catch (err) {
        logger.error("Unable to save metrics");
        logger.error(err);
      }

      logger.debug(
        `${dataToProcess.monitorId.toString()} - Monitor metrics saved`,
      );

      /*
       * `monitorSteps` is optional on the model. When a monitor has none
       * configured, `monitor.monitorSteps` is undefined and the previous
       * non-null assertion (`!`) was a lie — `monitorSteps.data` then threw
       * "Cannot read properties of null (reading 'data')" inside the probe
       * ingest worker. Guard the value itself and take the existing
       * "no monitoring steps" early return.
       */
      const monitorSteps: MonitorSteps | undefined = monitor.monitorSteps;

      if (
        !monitorSteps ||
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

      /*
       * The step this result was actually produced for. A probe result carries
       * the monitorStepId it ran, and a monitor can have several steps whose
       * criteria differ - so the step must be looked up, not assumed to be the
       * first one. The lookup used to be performed and its result thrown away,
       * which silently evaluated every result against step 0's criteria and fed
       * step 0's id into checkProbeAgreement (so agreement compared this
       * result against other probes' logs for the wrong step).
       */
      let monitorStep: MonitorStep | undefined =
        monitorSteps.data.monitorStepsInstanceArray[0];

      logger.debug(
        `Monitor Step: ${monitorStep ? monitorStep.id : "undefined"}`,
      );

      if ((dataToProcess as ProbeMonitorResponse).monitorStepId) {
        const ingestedMonitorStep: MonitorStep | undefined =
          monitorSteps.data.monitorStepsInstanceArray.find(
            (step: MonitorStep) => {
              return (
                step.id.toString() ===
                (dataToProcess as ProbeMonitorResponse).monitorStepId.toString()
              );
            },
          );

        /*
         * An id that matches no step is stale - the step was deleted after the
         * probe was scheduled. Keep the existing behaviour there and fall back
         * to the first step rather than dropping the result.
         */
        if (ingestedMonitorStep) {
          monitorStep = ingestedMonitorStep;
        }

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
        monitorSteps.data.monitorStepsInstanceArray[
          nextMonitorStepIndex + 1
        ]?.id;

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
        MonitorTypeHelper.isProbableMonitor(monitor.monitorType) &&
        /*
         * Traps arrive on exactly one probe — other probes' polled state
         * cannot corroborate them, so agreement would always veto the trap.
         */
        !isSnmpTrapEvent
      ) {
        const probeAgreementResult: ProbeAgreementResult =
          await MonitorResourceUtil.checkProbeAgreement({
            monitor: monitor,
            monitorStep: monitorStep,
            currentCriteriaMetId: response.criteriaMetId || null,
            currentRootCause: response.rootCause || null,
            currentProbeId: (dataToProcess as ProbeMonitorResponse).probeId,
            monitorProbes: monitorProbesForMonitor || undefined,
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
          await releaseMutex();

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

        // Add probe names in agreement to the root cause
        if (
          response.rootCause &&
          probeAgreementResult.agreedProbeNames.length > 0
        ) {
          response.rootCause += `
**Probes in Agreement**: ${probeAgreementResult.agreedProbeNames.join(", ")}
`;
        }
      }

      /*
       * Incoming Request / webhook grouped resolution (event-driven). A
       * payload can explicitly mark keys as resolved (e.g. Grafana
       * status=resolved). Resolve exactly those keys' incidents — never by
       * absence. Runs regardless of whether a firing criteria matched, so a
       * pure "resolved" webhook still closes the right incident. No-op
       * unless a criteria has incidentGrouping configured.
       */
      if (
        monitor.monitorType === MonitorType.IncomingRequest &&
        criteriaInstances.some((criteriaInstance: MonitorCriteriaInstance) => {
          return IncomingRequestIncidentGrouping.isGroupingConfigured(
            criteriaInstance,
          );
        })
      ) {
        const resolvedFingerprints: Array<string> =
          IncomingRequestIncidentGrouping.collectResolvedFingerprints({
            dataToProcess: dataToProcess,
            criteriaInstances: criteriaInstances,
          });

        if (resolvedFingerprints.length > 0) {
          await MonitorIncident.resolveSeriesIncidentsByFingerprint({
            monitor: monitor,
            fingerprints: resolvedFingerprints,
            rootCause: "Incoming request reported this key as resolved.",
            dataToProcess: dataToProcess,
            autoResolveCriteriaInstanceIdIncidentIdsDictionary,
            evaluationSummary: evaluationSummary,
          });

          await MonitorAlert.resolveSeriesAlertsByFingerprint({
            monitor: monitor,
            fingerprints: resolvedFingerprints,
            rootCause: "Incoming request reported this key as resolved.",
            dataToProcess: dataToProcess,
            autoResolveCriteriaInstanceIdAlertIdsDictionary,
            evaluationSummary: evaluationSummary,
          });
        }
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

        if (
          dataToProcess &&
          (dataToProcess as SecurityEventsMonitorResponse).securityEventQuery
        ) {
          telemetryQuery = {
            telemetryQuery: (dataToProcess as SecurityEventsMonitorResponse)
              .securityEventQuery,
            telemetryType: TelemetryType.SecurityEvent,
            metricViewData: null,
          };
          logger.debug(
            `${dataToProcess.monitorId.toString()} - Security event query found.`,
          );
        }

        if (
          dataToProcess &&
          (dataToProcess as TraceMonitorResponse).spanQuery
        ) {
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
                (dataToProcess as MetricMonitorResponse).startAndEndDate ||
                null,
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

        /*
         * The criteria this evaluation is going to act on.
         *
         * Grouped monitors evaluate every criteria and can match several
         * at once — host A critical while host B is only warning — so
         * they hand back a list. Everything else keeps the historical
         * single-winner shape, reconstructed here so both cases go down
         * exactly the same code path below.
         */
        const criteriaFanOut: Array<MatchedCriteriaResult> =
          response.matchedCriteria ?? [
            {
              criteriaId: response.criteriaMetId!,
              rootCause: response.rootCause,
              perSeriesMatches: response.perSeriesMatches ?? [],
            },
          ];

        const isPerSeriesEvaluation: boolean =
          response.perSeriesMatches !== undefined;

        /*
         * Every series breaching anything on this tick, and the same
         * broken out per criteria.
         *
         * The resolve pass needs the per-criteria view: "is host B still
         * breaching?" has to be answered against the criteria that
         * raised host B's alert, not against whichever criteria happened
         * to win the tick. Answering it against the winner resolved a
         * still-valid warning alert the moment another host went
         * critical. A criteria that ran and matched nothing maps to an
         * empty set — that is what lets a recovered series resolve —
         * while a criteria that never ran is absent, and its records are
         * left alone.
         */
        const breachingSeriesFingerprintsByCriteriaId: Dictionary<Set<string>> =
          {};

        if (response.evaluatedCriteriaIds) {
          for (const evaluatedCriteriaId of response.evaluatedCriteriaIds) {
            breachingSeriesFingerprintsByCriteriaId[evaluatedCriteriaId] =
              new Set<string>();
          }
        }

        const allBreachingSeriesFingerprints: Set<string> = new Set<string>();

        for (const matched of criteriaFanOut) {
          const forCriteria: Set<string> =
            breachingSeriesFingerprintsByCriteriaId[matched.criteriaId] ||
            new Set<string>();

          breachingSeriesFingerprintsByCriteriaId[matched.criteriaId] =
            forCriteria;

          for (const seriesMatch of matched.perSeriesMatches) {
            forCriteria.add(seriesMatch.fingerprint);
            allBreachingSeriesFingerprints.add(seriesMatch.fingerprint);
          }
        }

        /*
         * For grouped metric monitors, work out which breaching series
         * belong to a resource that is currently inside an ongoing
         * scheduled maintenance window. Those series are suppressed
         * below so the monitor keeps alerting on the rest. Computed once
         * and shared by both the incident and alert paths. Cheap on the
         * common path: no per-series matches, or no ongoing maintenance,
         * returns an empty set after at most one query.
         */
        const suppressedSeriesFingerprints: Set<string> =
          await MonitorMaintenanceSuppression.getSuppressedSeriesFingerprints({
            projectId: monitor.projectId!,
            matchesPerSeries: isPerSeriesEvaluation
              ? criteriaFanOut.flatMap((matched: MatchedCriteriaResult) => {
                  return matched.perSeriesMatches;
                })
              : undefined,
          });

        /*
         * Alert-dependency suppression: if any parent monitor this monitor
         * depends on is currently in a suppressing status (offline by
         * default), skip creating incidents/alerts for this evaluation.
         * Deliberately computed AFTER the status timeline update above —
         * the child's own status must keep tracking reality (status pages,
         * transitive dependency checks); only the redundant paging is
         * silenced. The resolve path for already-open incidents/alerts is
         * likewise untouched. Zero queries when the monitor has no
         * dependencies configured.
         */
        const dependencySuppression: DependencySuppressionResult =
          await MonitorDependencySuppression.getDependencySuppression({
            monitor: monitor,
          });

        /*
         * Freeze the Monitor Summary as it stands right now, before any
         * incident or alert is created from it. Both creators store the
         * same capture, so the incident page can show what the monitor
         * saw long after MonitorLog's TTL (one day by default) has
         * dropped the underlying log.
         */
        const monitorSummary: MonitorSummarySnapshot | null =
          await MonitorSummaryCapture.capture({
            monitor: monitor,
            dataToProcess: dataToProcess,
            evaluationSummary: evaluationSummary,
            probeName: probeName,
          });

        /*
         * Incoming-request grouping is event-driven: a webhook describes
         * only the keys in its payload, so absence from this tick is not
         * recovery. Skip the snapshot absence-resolve pass; grouped
         * incidents/alerts are resolved explicitly via the resolution
         * block above. Per-key create + dedupe still run from
         * matchesPerSeries.
         */
        const disableSeriesAbsenceResolution: boolean =
          monitor.monitorType === MonitorType.IncomingRequest;

        const breachingSeriesFingerprints: Set<string> | undefined =
          isPerSeriesEvaluation && !disableSeriesAbsenceResolution
            ? allBreachingSeriesFingerprints
            : undefined;

        /*
         * Resolve first, once, for the whole evaluation — then create.
         *
         * The resolve pass has to see every criteria's breaching set at
         * the same time. Running it once per matching criteria would let
         * each criteria absence-resolve the records the others just
         * justified. The creators are handed the survivors so they never
         * dedupe a new alert against one this pass has already closed.
         */
        const openIncidents: Array<Incident> =
          await MonitorIncident.checkOpenIncidentsAndCloseIfResolved({
            monitorId: monitor.id!,
            autoResolveCriteriaInstanceIdIncidentIdsDictionary,
            rootCause: response.rootCause,
            criteriaInstance: matchedCriteriaInstance,
            dataToProcess: dataToProcess,
            evaluationSummary: evaluationSummary,
            breachingSeriesFingerprints,
            breachingSeriesFingerprintsByCriteriaId: response.matchedCriteria
              ? breachingSeriesFingerprintsByCriteriaId
              : undefined,
            disableSeriesAbsenceResolution,
          });

        const openAlerts: Array<Alert> =
          await MonitorAlert.checkOpenAlertsAndCloseIfResolved({
            monitorId: monitor.id!,
            autoResolveCriteriaInstanceIdAlertIdsDictionary,
            rootCause: response.rootCause,
            criteriaInstance: matchedCriteriaInstance,
            dataToProcess: dataToProcess,
            evaluationSummary: evaluationSummary,
            breachingSeriesFingerprints,
            breachingSeriesFingerprintsByCriteriaId: response.matchedCriteria
              ? breachingSeriesFingerprintsByCriteriaId
              : undefined,
            disableSeriesAbsenceResolution,
          });

        /*
         * De-escalation: a host that breaches both "critical" and
         * "warning" gets one record, from the first (highest priority)
         * criteria that claims it — criteria are in user-defined order
         * and the first match is the one that also sets the monitor's
         * status. Tracked separately for incidents and alerts because a
         * criteria can create one without the other.
         */
        const seriesClaimedByIncidentCriteria: Set<string> = new Set<string>();
        const seriesClaimedByAlertCriteria: Set<string> = new Set<string>();

        for (const matched of criteriaFanOut) {
          const criteriaInstance: MonitorCriteriaInstance | undefined =
            criteriaInstanceMap[matched.criteriaId];

          if (!criteriaInstance) {
            continue;
          }

          await MonitorIncident.criteriaMetCreateIncidentsAndUpdateMonitorStatus(
            {
              monitor: monitor,
              rootCause: matched.rootCause,
              dataToProcess: dataToProcess,
              autoResolveCriteriaInstanceIdIncidentIdsDictionary,
              criteriaInstance: criteriaInstance,
              evaluationSummary: evaluationSummary,
              monitorSummary: monitorSummary,
              props: {
                telemetryQuery: telemetryQuery,
              },
              matchesPerSeries: isPerSeriesEvaluation
                ? MonitorResourceUtil.claimUnclaimedSeries({
                    matches: matched.perSeriesMatches,
                    claimed: seriesClaimedByIncidentCriteria,
                    isClaiming: criteriaInstance.data?.createIncidents === true,
                  })
                : undefined,
              openIncidents,
              suppressedSeriesFingerprints,
              dependencySuppression,
              disableSeriesAbsenceResolution,
            },
          );

          await MonitorAlert.criteriaMetCreateAlertsAndUpdateMonitorStatus({
            monitor: monitor,
            rootCause: matched.rootCause,
            dataToProcess: dataToProcess,
            autoResolveCriteriaInstanceIdAlertIdsDictionary,
            criteriaInstance: criteriaInstanceAlertMap[matched.criteriaId]!,
            evaluationSummary: evaluationSummary,
            monitorSummary: monitorSummary,
            props: {
              telemetryQuery: telemetryQuery,
            },
            matchesPerSeries: isPerSeriesEvaluation
              ? MonitorResourceUtil.claimUnclaimedSeries({
                  matches: matched.perSeriesMatches,
                  claimed: seriesClaimedByAlertCriteria,
                  isClaiming: criteriaInstance.data?.createAlerts === true,
                })
              : undefined,
            openAlerts,
            suppressedSeriesFingerprints,
            dependencySuppression,
            disableSeriesAbsenceResolution,
          });
        }
      } else if (
        !response.criteriaMetId &&
        /*
         * A trap that matches no criteria is simply ignored — it must not
         * reset the monitor to its default status (the polled checks own
         * the monitor's state).
         */
        !isSnmpTrapEvent &&
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
          /*
           * Event-driven grouping: for incoming-request monitors, never
           * absence-resolve per-key (seriesFingerprint) incidents on the
           * no-criteria-met path — a heartbeat tick or a rejected webhook
           * must not bulk-close grouped incidents. They resolve only via
           * the explicit resolution block above. Non-grouped incoming
           * incidents have no seriesFingerprint, so they still resolve
           * normally; non-incoming-request types are unaffected (flag false).
           */
          disableSeriesAbsenceResolution:
            monitor.monitorType === MonitorType.IncomingRequest,
        });

        await MonitorAlert.checkOpenAlertsAndCloseIfResolved({
          monitorId: monitor.id!,
          autoResolveCriteriaInstanceIdAlertIdsDictionary,
          rootCause: "No monitoring criteria met. Change to default status.",
          criteriaInstance: null, // no criteria met!
          dataToProcess: dataToProcess,
          evaluationSummary: evaluationSummary,
          disableSeriesAbsenceResolution:
            monitor.monitorType === MonitorType.IncomingRequest,
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

          /*
           * Tracks whether the monitor really is at its default status after the
           * create call, so the summary event below records only what actually
           * happened. On the lock-skip path the write was REFUSED - recording a
           * "reverted" event there would put a false entry in the monitor log and
           * mask the very lock failure the error log surfaces.
           */
          let revertedToDefaultStatus: boolean = true;

          /*
           * The stored default status can be a status that no longer exists, or
           * one from another project: monitorSteps is a JSON blob with no
           * foreign key behind it, and before issue #3039 was fixed the API
           * accepted any uuid for it. Writing it raised the
           * "violates foreign key constraint" error from the probe/telemetry
           * worker and failed the whole ingest run for this monitor, losing the
           * monitor log and payload persisted below. Skip the revert and log,
           * the same way the criteria path in Utils/Monitor/MonitorStatusTimeline
           * does. New writes are rejected up front by
           * MonitorStepsProjectValidator.
           */
          const isDefaultStatusUsable: boolean =
            await ProjectScopedReferenceValidator.isUsableInProject({
              projectId: monitor.projectId!,
              id: monitorSteps.data.defaultMonitorStatusId,
              service: MonitorStatusService,
            });

          if (!isDefaultStatusUsable) {
            logger.error(
              `${dataToProcess.monitorId.toString()} - The default monitor status ${monitorSteps.data.defaultMonitorStatusId.toString()} does not exist in project ${monitor.projectId?.toString()}. Skipping revert to default status. Please pick a default monitor status that exists in this project.`,
            );
            revertedToDefaultStatus = false;
          } else {
            try {
              await MonitorStatusTimelineService.create({
                data: monitorStatusTimeline,
                props: {
                  isRoot: true,
                },
              });
              logger.debug(
                `${dataToProcess.monitorId.toString()} - Monitor status updated to default.`,
              );
            } catch (err) {
              /*
               * Idempotent concurrency race (see MonitorStatusTimeline.ts): a
               * concurrent result already moved the monitor to this default status,
               * so onBeforeCreate's dedupe check throws this exact BadDataException.
               * Treat as a no-op at debug level rather than failing the job. Match the
               * exact message so unrelated BadDataExceptions still propagate.
               */
              if (
                err instanceof BadDataException &&
                err.message === MONITOR_STATUS_SAME_AS_PREVIOUS_ERROR_MESSAGE
              ) {
                logger.debug(
                  `${dataToProcess.monitorId.toString()} - Monitor status already at default; skipping duplicate status timeline (concurrent race).`,
                );
              } else if (
                err instanceof ServerException &&
                err.message === MONITOR_STATUS_TIMELINE_LOCK_ERROR_MESSAGE
              ) {
                /*
                 * The per-monitor timeline mutex could not be acquired (fail-closed
                 * create, see MonitorStatusTimelineService). Skipping is recoverable:
                 * the next probe result re-evaluates the same criteria and recreates
                 * the revert-to-default, while failing here would abort the whole
                 * ingest run and lose the monitor log for this probe result.
                 */
                logger.error(
                  `${dataToProcess.monitorId.toString()} - Could not acquire the monitor status timeline lock; skipping revert to default status. It will be retried on the next probe result.`,
                );
                revertedToDefaultStatus = false;
              } else {
                throw err;
              }
            }
          }

          if (revertedToDefaultStatus) {
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
      }

      await releaseMutex();

      await persistLatestMonitorPayload();

      MonitorLogUtil.saveMonitorLog({
        monitorId: monitor.id!,
        projectId: monitor.projectId!,
        dataToProcess: dataToProcess,
      });

      return response;
    } finally {
      await releaseMutex();
    }
  }

  /**
   * Turn a probe response read back out of MonitorProbe.lastMonitoringLog
   * into one the criteria evaluators can actually use.
   *
   * The column stores `JSON.parse(JSON.stringify(response))`, which turns
   * every ObjectID into a plain `{ _type: "ObjectID", value: "..." }` object
   * and every Date into a string. Those plain objects are not `instanceof
   * ObjectID`, so the analytics query builder binds them as-is and the
   * "evaluate over time" lookup silently matches zero rows - which used to
   * be indistinguishable from "this monitor has no history" and sent the
   * evaluator down its instantaneous-value fallback. The result was a
   * decision that disagreed with the evaluation summary shown beside it.
   */
  public static hydrateStoredProbeResponse(
    probeResponse: ProbeMonitorResponse,
  ): ProbeMonitorResponse {
    const hydrated: ProbeMonitorResponse = {
      ...probeResponse,
    };

    const toObjectID: (value: unknown) => ObjectID | undefined = (
      value: unknown,
    ): ObjectID | undefined => {
      if (!value) {
        return undefined;
      }

      if (value instanceof ObjectID) {
        return value;
      }

      if (typeof value === "string") {
        return new ObjectID(value);
      }

      if (typeof value === "object") {
        const asJson: JSONObject = value as JSONObject;

        if (asJson["value"]) {
          return new ObjectID(asJson["value"].toString());
        }
      }

      return undefined;
    };

    const toDate: (value: unknown) => Date | undefined = (
      value: unknown,
    ): Date | undefined => {
      if (!value) {
        return undefined;
      }

      if (value instanceof Date) {
        return value;
      }

      const parsed: Date = new Date(value as string);

      return isNaN(parsed.getTime()) ? undefined : parsed;
    };

    const projectId: ObjectID | undefined = toObjectID(probeResponse.projectId);
    if (projectId) {
      hydrated.projectId = projectId;
    }

    const monitorId: ObjectID | undefined = toObjectID(probeResponse.monitorId);
    if (monitorId) {
      hydrated.monitorId = monitorId;
    }

    const monitorStepId: ObjectID | undefined = toObjectID(
      probeResponse.monitorStepId,
    );
    if (monitorStepId) {
      hydrated.monitorStepId = monitorStepId;
    }

    const probeId: ObjectID | undefined = toObjectID(probeResponse.probeId);
    if (probeId) {
      hydrated.probeId = probeId;
    }

    const monitoredAt: Date | undefined = toDate(probeResponse.monitoredAt);
    if (monitoredAt) {
      hydrated.monitoredAt = monitoredAt;
    }

    const ingestedAt: Date | undefined = toDate(probeResponse.ingestedAt);
    if (ingestedAt) {
      hydrated.ingestedAt = ingestedAt;
    }

    return hydrated;
  }

  @CaptureSpan()
  /**
   * Take the series this criteria may act on, given what earlier
   * (higher-priority) criteria have already claimed.
   *
   * A host breaching both "critical" and "warning" should page once,
   * from the more severe band. Criteria that create nothing claim
   * nothing, so a passive recovery criteria never steals a series from
   * the criteria that would have alerted on it.
   */
  private static claimUnclaimedSeries(input: {
    matches: Array<PerSeriesCriteriaMatch>;
    claimed: Set<string>;
    isClaiming: boolean;
  }): Array<PerSeriesCriteriaMatch> {
    if (!input.isClaiming) {
      return input.matches;
    }

    const unclaimed: Array<PerSeriesCriteriaMatch> = input.matches.filter(
      (match: PerSeriesCriteriaMatch) => {
        return !input.claimed.has(match.fingerprint);
      },
    );

    for (const match of unclaimed) {
      input.claimed.add(match.fingerprint);
    }

    return unclaimed;
  }

  private static async checkProbeAgreement(input: {
    monitor: Monitor;
    monitorStep: MonitorStep;
    currentCriteriaMetId: string | null;
    currentRootCause: string | null;
    /*
     * Probe that produced the result being handled right now. Its verdict is
     * already in currentCriteriaMetId / currentRootCause, so it is reused
     * rather than recomputed - see the loop below.
     */
    currentProbeId?: ObjectID | undefined;
    /*
     * Pre-fetched MonitorProbe rows for this monitor (probeId, isEnabled,
     * lastMonitoringLog, probe.name/connectionStatus). The probe-result hot
     * path passes these to avoid re-reading every row's lastMonitoringLog
     * jsonb per result; safe because the caller holds the per-monitor lock,
     * so the rows cannot change underneath us. When absent, fall back to
     * querying.
     */
    monitorProbes?: Array<MonitorProbe> | undefined;
  }): Promise<ProbeAgreementResult> {
    const { monitor, monitorStep, currentCriteriaMetId, currentRootCause } =
      input;

    /*
     * If minimumProbeAgreement is not set, all probes must agree
     * Get all MonitorProbes for this monitor with their probe connection status
     */
    const monitorProbes: Array<MonitorProbe> =
      input.monitorProbes ||
      (await MonitorProbeService.findBy({
        query: {
          monitorId: monitor.id!,
        },
        select: {
          probeId: true,
          isEnabled: true,
          lastMonitoringLog: true,
          probe: {
            connectionStatus: true,
            name: true,
          },
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: {
          isRoot: true,
        },
      }));

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
        agreedProbeNames: [],
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
     * Value: { count, rootCause, probeNames }
     */
    const criteriaAgreements: Map<
      string,
      { count: number; rootCause: string | null; probeNames: Array<string> }
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

      let evaluatedCriteriaMetId: string | undefined = undefined;
      let evaluatedRootCause: string | null = null;

      const isCurrentProbe: boolean = Boolean(
        input.currentProbeId &&
          monitorProbe.probeId?.toString() === input.currentProbeId.toString(),
      );

      if (isCurrentProbe) {
        /*
         * The probe whose result we are handling right now was already
         * evaluated by the caller, and that evaluation is the one the user
         * sees in the evaluation summary. Re-running it here would evaluate
         * a *different* window for any "evaluate over time" filter - seconds
         * have passed, and this pass reads the payload back out of
         * lastMonitoringLog rather than using the live object. That is how
         * an incident could be created citing a criteria the summary right
         * next to it reported as not met.
         */
        evaluatedCriteriaMetId = currentCriteriaMetId || undefined;
        evaluatedRootCause = currentRootCause;
      } else {
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
            dataToProcess: MonitorResourceUtil.hydrateStoredProbeResponse(
              probeResponse,
            ) as DataToProcess,
            monitorStep: monitorStep,
            monitor: monitor,
            probeApiIngestResponse: tempResponse,
            evaluationSummary: tempEvaluationSummary,
          });

        evaluatedCriteriaMetId = evaluatedResponse.criteriaMetId;
        evaluatedRootCause = evaluatedResponse.rootCause;
      }

      // Record the result
      const criteriaKey: string = evaluatedCriteriaMetId || "none";
      const existing:
        | { count: number; rootCause: string | null; probeNames: Array<string> }
        | undefined = criteriaAgreements.get(criteriaKey);

      // Get probe name for this monitor probe
      const probeName: string = monitorProbe.probe?.name || "Unknown Probe";

      if (existing) {
        existing.count += 1;
        existing.probeNames.push(probeName);
      } else {
        criteriaAgreements.set(criteriaKey, {
          count: 1,
          rootCause: evaluatedRootCause,
          probeNames: [probeName],
        });
      }
    }

    // Find the criteria with the most agreement
    let maxCount: number = 0;
    let winningCriteriaId: string | null = null;
    let winningRootCause: string | null = null;
    let winningProbeNames: Array<string> = [];

    for (const [criteriaId, data] of criteriaAgreements) {
      if (data.count > maxCount) {
        maxCount = data.count;
        winningCriteriaId = criteriaId === "none" ? null : criteriaId;
        winningRootCause = data.rootCause;
        winningProbeNames = data.probeNames;
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
      agreedProbeNames: hasAgreement ? winningProbeNames : [],
    };
  }
}
