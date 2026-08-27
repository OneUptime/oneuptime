import Alert from "../../../Models/DatabaseModels/Alert";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import AlertStateTimeline from "../../../Models/DatabaseModels/AlertStateTimeline";
import Label from "../../../Models/DatabaseModels/Label";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import Dictionary from "../../../Types/Dictionary";
import BadDataException from "../../../Types/Exception/BadDataException";
import IncomingMonitorRequest from "../../../Types/Monitor/IncomingMonitor/IncomingMonitorRequest";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import ObjectID from "../../../Types/ObjectID";
import ProbeMonitorResponse from "../../../Types/Probe/ProbeMonitorResponse";
import { TelemetryQuery } from "../../../Types/Telemetry/TelemetryQuery";
import { DisableAutomaticAlertCreation } from "../../EnvironmentConfig";
import AlertService from "../../Services/AlertService";
import AlertSeverityService from "../../Services/AlertSeverityService";
import ProjectScopedReferenceValidator from "../Database/ProjectScopedReferenceValidator";
import AlertStateTimelineService from "../../Services/AlertStateTimelineService";
import NetworkDeviceOwnerUserService, {
  NetworkDeviceOwners,
} from "../../Services/NetworkDeviceOwnerUserService";
import logger, { LogAttributes } from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";
import DataToProcess from "./DataToProcess";
import MonitorResourceContextUtil from "./MonitorResourceContext";
import MonitorTemplateUtil from "./MonitorTemplateUtil";
import SeriesResourceLinker, {
  SeriesResolvedResourceIds,
} from "./SeriesResourceLinker";
import MonitorDependencySuppression, {
  DependencySuppressionResult,
} from "./MonitorDependencySuppression";
import { JSONObject } from "../../../Types/JSON";
import OneUptimeDate from "../../../Types/Date";
import MonitorEvaluationSummary from "../../../Types/Monitor/MonitorEvaluationSummary";
import MonitorSummarySnapshot from "../../../Types/Monitor/MonitorSummarySnapshot";
import MonitorSummarySnapshotUtil from "../../../Utils/Monitor/MonitorSummarySnapshotUtil";
import { PerSeriesCriteriaMatch } from "../../../Types/Probe/ProbeApiIngestResponse";

export default class MonitorAlert {
  @CaptureSpan()
  public static async checkOpenAlertsAndCloseIfResolved(input: {
    monitorId: ObjectID;
    autoResolveCriteriaInstanceIdAlertIdsDictionary: Dictionary<Array<string>>;
    rootCause: string;
    criteriaInstance: MonitorCriteriaInstance | null;
    dataToProcess: DataToProcess;
    evaluationSummary?: MonitorEvaluationSummary | undefined;
    breachingSeriesFingerprints?: Set<string> | undefined;
    /**
     * The breaching fingerprints of EACH criteria evaluated on this
     * tick, keyed by criteria id — a criteria that ran and matched
     * nothing maps to an empty set.
     *
     * Without this, "is this series still breaching?" was answered from
     * the winning criteria's set alone, so a host held critical by
     * criteria A silently auto-resolved another host's still-valid alert
     * from criteria B. A criteria absent from this dictionary was not
     * evaluated at all, and its open alerts are left untouched.
     */
    breachingSeriesFingerprintsByCriteriaId?:
      | Dictionary<Set<string>>
      | undefined;
    /**
     * Event-driven (incoming-request / webhook) mode. When true, an open
     * alert carrying a seriesFingerprint is never auto-resolved here —
     * webhooks resolve per-key only via resolveSeriesAlertsByFingerprint,
     * never by absence. Passed on BOTH the criteria-met and no-criteria-met
     * code paths for grouped incoming-request monitors.
     */
    disableSeriesAbsenceResolution?: boolean | undefined;
  }): Promise<Array<Alert>> {
    // check active alerts and if there are open alerts, do not create another alert.
    const openAlerts: Array<Alert> = await AlertService.findBy({
      query: {
        monitor: input.monitorId!,
        currentAlertState: {
          isResolvedState: false,
        },
      },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
      select: {
        _id: true,
        title: true,
        createdCriteriaId: true,
        projectId: true,
        alertNumber: true,
        alertNumberWithPrefix: true,
        currentAlertStateId: true,
        seriesFingerprint: true,
        seriesLabels: true,
      },
      props: {
        isRoot: true,
      },
    });

    // check if should close the alert.

    const resolvedAlertIds: Set<string> = new Set<string>();

    for (const openAlert of openAlerts) {
      const shouldClose: boolean = this.shouldCloseAlert({
        openAlert,
        autoResolveCriteriaInstanceIdAlertIdsDictionary:
          input.autoResolveCriteriaInstanceIdAlertIdsDictionary,
        criteriaInstance: input.criteriaInstance,
        breachingSeriesFingerprints: input.breachingSeriesFingerprints,
        breachingSeriesFingerprintsByCriteriaId:
          input.breachingSeriesFingerprintsByCriteriaId,
        disableSeriesAbsenceResolution: input.disableSeriesAbsenceResolution,
      });

      if (shouldClose) {
        resolvedAlertIds.add(openAlert.id!.toString());

        // then resolve alert.
        await this.resolveOpenAlert({
          openAlert: openAlert,
          rootCause: input.rootCause,
          dataToProcess: input.dataToProcess,
        });

        input.evaluationSummary?.events.push({
          type: "alert-resolved",
          title: `Alert resolved: ${openAlert.id?.toString()}`,
          message:
            "Alert auto-resolved because autoresolve is enabled for this criteria.",
          relatedAlertId: openAlert.id?.toString(),
          relatedAlertNumber: openAlert.alertNumber,
          relatedAlertNumberWithPrefix: openAlert.alertNumberWithPrefix,
          relatedCriteriaId: input.criteriaInstance?.data?.id,
          at: OneUptimeDate.getCurrentDate(),
        });
      }
    }

    /*
     * Return the alerts that are still open AFTER this pass. The create
     * path dedupes against this list, and an alert this pass just
     * resolved must not count as "already active" — that combination
     * resolved a stale whole-monitor alert and then refused to create
     * the per-series alerts meant to replace it.
     */
    if (resolvedAlertIds.size === 0) {
      return openAlerts;
    }

    return openAlerts.filter((openAlert: Alert) => {
      return !resolvedAlertIds.has(openAlert.id!.toString());
    });
  }

  /**
   * Event-driven (incoming-request / webhook) resolution: resolve the open
   * alerts for the given payload-derived fingerprints — and only those —
   * when the criteria that created them has auto-resolve enabled. Mirrors
   * MonitorIncident.resolveSeriesIncidentsByFingerprint; never resolves by
   * absence (a webhook describes only the keys in its payload).
   */
  @CaptureSpan()
  public static async resolveSeriesAlertsByFingerprint(input: {
    monitor: Monitor;
    fingerprints: Array<string>;
    rootCause: string;
    dataToProcess: DataToProcess;
    autoResolveCriteriaInstanceIdAlertIdsDictionary: Dictionary<Array<string>>;
    evaluationSummary?: MonitorEvaluationSummary | undefined;
  }): Promise<void> {
    if (!input.fingerprints || input.fingerprints.length === 0) {
      return;
    }

    const fingerprintSet: Set<string> = new Set<string>(input.fingerprints);

    const openAlerts: Array<Alert> = await AlertService.findBy({
      query: {
        monitor: input.monitor.id!,
        currentAlertState: {
          isResolvedState: false,
        },
      },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
      select: {
        _id: true,
        title: true,
        createdCriteriaId: true,
        projectId: true,
        alertNumber: true,
        alertNumberWithPrefix: true,
        seriesFingerprint: true,
      },
      props: {
        isRoot: true,
      },
    });

    for (const openAlert of openAlerts) {
      const fingerprint: string | undefined =
        openAlert.seriesFingerprint || undefined;

      if (!fingerprint || !fingerprintSet.has(fingerprint)) {
        continue;
      }

      const createdCriteriaId: string | undefined =
        openAlert.createdCriteriaId?.toString();

      if (!createdCriteriaId) {
        continue;
      }

      // Only auto-resolve when the creating criteria opted into it.
      const autoResolveTemplates: Array<string> | undefined =
        input.autoResolveCriteriaInstanceIdAlertIdsDictionary[
          createdCriteriaId
        ];

      if (!autoResolveTemplates || autoResolveTemplates.length === 0) {
        continue;
      }

      await this.resolveOpenAlert({
        openAlert: openAlert,
        rootCause: input.rootCause,
        dataToProcess: input.dataToProcess,
      });

      input.evaluationSummary?.events.push({
        type: "alert-resolved",
        title: `Alert resolved: ${openAlert.id?.toString()}`,
        message:
          "Alert auto-resolved because the incoming payload reported this key as resolved.",
        relatedAlertId: openAlert.id?.toString(),
        relatedAlertNumber: openAlert.alertNumber,
        relatedAlertNumberWithPrefix: openAlert.alertNumberWithPrefix,
        at: OneUptimeDate.getCurrentDate(),
      });
    }
  }

  @CaptureSpan()
  public static async criteriaMetCreateAlertsAndUpdateMonitorStatus(input: {
    criteriaInstance: MonitorCriteriaInstance;
    monitor: Monitor;
    dataToProcess: DataToProcess;
    rootCause: string;
    autoResolveCriteriaInstanceIdAlertIdsDictionary: Dictionary<Array<string>>;
    evaluationSummary?: MonitorEvaluationSummary | undefined;
    /**
     * The Monitor Summary as it stood at this evaluation, captured by
     * MonitorSummaryCapture before this call. Stored on every alert
     * created below so the alert page can render the same card the
     * monitor page shows, long after the monitor log has aged out.
     */
    monitorSummary?: MonitorSummarySnapshot | null | undefined;
    props: {
      telemetryQuery?: TelemetryQuery | undefined;
    };
    matchesPerSeries?: Array<PerSeriesCriteriaMatch> | undefined;
    /**
     * The still-open alerts, when the caller has already run the
     * resolve pass itself.
     *
     * A single evaluation can fan out across several matching criteria
     * (host A critical while host B is only warning). The resolve pass
     * has to run exactly once, with every criteria's breaching set in
     * hand — running it once per criteria would let each criteria
     * absence-resolve the others' alerts. So MonitorResource runs it up
     * front and hands the survivors here.
     */
    openAlerts?: Array<Alert> | undefined;
    /**
     * Per-criteria breaching fingerprints, forwarded to the resolve pass
     * when this method runs it itself. See
     * checkOpenAlertsAndCloseIfResolved.
     */
    breachingSeriesFingerprintsByCriteriaId?:
      | Dictionary<Set<string>>
      | undefined;
    /**
     * Series fingerprints whose underlying resource is inside an
     * ongoing scheduled maintenance window. Alerts for these series are
     * suppressed at creation time even though the monitor keeps
     * evaluating. See MonitorMaintenanceSuppression.
     */
    suppressedSeriesFingerprints?: Set<string> | undefined;
    /**
     * Alert-dependency suppression: when set and isSuppressed, a parent
     * monitor this monitor depends on is currently in a suppressing
     * status, so ALL alert creation for this evaluation is skipped. Only
     * creation — already-open alerts still follow the normal resolve
     * path above. See MonitorDependencySuppression.
     */
    dependencySuppression?: DependencySuppressionResult | undefined;
    /**
     * Event-driven monitors (incoming-request / webhook fan-out) must not
     * use the metric snapshot model where a series absent from this tick's
     * breaching set is auto-resolved — a single webhook only describes the
     * keys in that payload, so absence is not recovery. When true, the
     * per-series absence-resolve pass is skipped; those alerts are resolved
     * explicitly elsewhere (see IncomingRequestIncidentGrouping +
     * resolveSeriesAlertsByFingerprint). Per-key create + dedupe still run.
     */
    disableSeriesAbsenceResolution?: boolean | undefined;
  }): Promise<void> {
    const alertLogAttributes: LogAttributes = {
      projectId: input.monitor.projectId?.toString(),
    };

    // check open alerts
    logger.debug(
      `${input.monitor.id?.toString()} - Check open alerts.`,
      alertLogAttributes,
    );

    const breachingSeriesFingerprints: Set<string> | undefined =
      input.matchesPerSeries && !input.disableSeriesAbsenceResolution
        ? new Set<string>(
            input.matchesPerSeries.map((m: PerSeriesCriteriaMatch) => {
              return m.fingerprint;
            }),
          )
        : undefined;

    // check active alerts and if there are open alerts, do not cretae anothr alert.
    const openAlerts: Array<Alert> =
      input.openAlerts !== undefined
        ? input.openAlerts
        : await this.checkOpenAlertsAndCloseIfResolved({
            monitorId: input.monitor.id!,
            autoResolveCriteriaInstanceIdAlertIdsDictionary:
              input.autoResolveCriteriaInstanceIdAlertIdsDictionary,
            rootCause: input.rootCause,
            criteriaInstance: input.criteriaInstance,
            dataToProcess: input.dataToProcess,
            evaluationSummary: input.evaluationSummary,
            breachingSeriesFingerprints,
            breachingSeriesFingerprintsByCriteriaId:
              input.breachingSeriesFingerprintsByCriteriaId,
            disableSeriesAbsenceResolution:
              input.disableSeriesAbsenceResolution,
          });

    if (!input.criteriaInstance.data?.createAlerts) {
      return;
    }

    /*
     * Checked once, up front. It used to be tested deep inside the
     * template x series loops with a `return`, which on a grouped
     * monitor abandoned every series after the first.
     */
    if (DisableAutomaticAlertCreation) {
      input.evaluationSummary?.events.push({
        type: "alert-skipped",
        title: "Alert creation skipped",
        message:
          "Automatic alert creation is disabled by environment configuration.",
        relatedCriteriaId: input.criteriaInstance.data?.id,
        at: OneUptimeDate.getCurrentDate(),
      });

      return;
    }

    /*
     * Alert-dependency suppression: a parent monitor is in a suppressing
     * status (offline by default), so skip creating any alert for this
     * evaluation. Placed after the open-alert resolve pass above on
     * purpose — an alert raised before the parent went down must still
     * resolve normally; only new creation is silenced.
     */
    if (input.dependencySuppression?.isSuppressed) {
      const suppressionReason: string =
        MonitorDependencySuppression.buildSuppressionReason(
          input.dependencySuppression.suppressingParents,
        );

      logger.debug(
        `${input.monitor.id?.toString()} - Skipping alert creation: ${suppressionReason}.`,
        alertLogAttributes,
      );

      input.evaluationSummary?.events.push({
        type: "alert-skipped",
        title: "Alert suppressed by monitor dependency",
        message: `Skipped creating alerts because ${suppressionReason}. This monitor's status still updates normally; open alerts still auto-resolve.`,
        relatedCriteriaId: input.criteriaInstance.data?.id,
        at: OneUptimeDate.getCurrentDate(),
      });

      return;
    }

    /*
     * Resolve the resources this monitor's own config names — its host,
     * cluster, fleet, telemetry services, or the resource its metric
     * filters scope it to — once per evaluation, so every alert created
     * below is attached to them. Series labels cannot supply this: they
     * only exist for grouped criteria, and most monitors (every shipped
     * Host/Docker/Podman template, all Logs/Traces/Exceptions monitors)
     * are ungrouped. No-op, and no round-trip, for monitor types whose
     * config names no resource.
     */
    const resourceContext: SeriesResolvedResourceIds =
      await MonitorResourceContextUtil.resolveResourceContextForMonitor({
        monitor: input.monitor,
      });

    /*
     * `undefined` matchesPerSeries → legacy single-alert path. A defined
     * (even empty) array → per-series mode: iterate exactly the matches.
     * An empty array therefore creates nothing — used by grouped
     * incoming-request criteria on a payload with no firing key so they
     * don't fall back to a single whole-monitor alert.
     */
    const seriesToProcess: Array<PerSeriesCriteriaMatch | undefined> =
      input.matchesPerSeries !== undefined
        ? input.matchesPerSeries
        : [undefined];

    /*
     * Owners of the network device this monitor watches (if any), resolved
     * lazily on first alert creation and reused for the rest of the
     * evaluation — the device is configured per monitor step, so it is
     * constant across the criteria/series loops below. Merged into every
     * created alert's owners alongside the criteria-configured ones.
     */
    let networkDeviceOwners: NetworkDeviceOwners | null = null;

    for (const criteriaAlert of input.criteriaInstance.data?.alerts || []) {
      for (const seriesMatch of seriesToProcess) {
        try {
          const seriesFingerprint: string | undefined =
            seriesMatch?.fingerprint;
          const seriesLabels: JSONObject | undefined = seriesMatch?.labels;
          const seriesRootCause: string =
            seriesMatch?.rootCause || input.rootCause;

          /*
           * Per-series scheduled-maintenance suppression: skip creating an
           * alert for a series whose resource is inside an ongoing
           * maintenance window. Other series on the same monitor are
           * unaffected. Only *new* creation is suppressed — existing open
           * alerts follow the normal resolve path.
           */
          if (
            seriesFingerprint &&
            input.suppressedSeriesFingerprints?.has(seriesFingerprint)
          ) {
            logger.debug(
              `${input.monitor.id?.toString()} - Skipping alert for series ${seriesFingerprint}: its resource is under an active scheduled maintenance window.`,
              alertLogAttributes,
            );

            input.evaluationSummary?.events.push({
              type: "alert-skipped",
              title: "Alert suppressed by scheduled maintenance",
              message:
                "Skipped creating an alert because the resource for this series is under an active scheduled maintenance window.",
              relatedCriteriaId: input.criteriaInstance.data?.id,
              at: OneUptimeDate.getCurrentDate(),
            });
            continue;
          }

          /*
           * Mirror the create path: `createdCriteriaId` is only set when the
           * criteria has an `id`. Guard the `.toString()` with `?.` (a criteria
           * with a missing id otherwise threw "Cannot read properties of
           * undefined (reading 'toString')" and failed the queue job every
           * cycle) and normalise both sides to `undefined` on missing so dedupe
           * stays correct instead of creating a duplicate alert each cycle.
           */
          const alreadyOpenAlert: Alert | undefined = openAlerts.find(
            (alert: Alert) => {
              return (
                (alert.createdCriteriaId || undefined) ===
                  (input.criteriaInstance.data?.id?.toString() || undefined) &&
                (alert.seriesFingerprint || undefined) === seriesFingerprint
              );
            },
          );

          const hasAlreadyOpenAlert: boolean = Boolean(alreadyOpenAlert);

          logger.debug(
            `${input.monitor.id?.toString()} - Open Alert ${alreadyOpenAlert?.id?.toString()}`,
            alertLogAttributes,
          );

          logger.debug(
            `${input.monitor.id?.toString()} - Has open alert ${hasAlreadyOpenAlert}`,
            alertLogAttributes,
          );

          if (hasAlreadyOpenAlert) {
            const renderedAlertTitle: string =
              alreadyOpenAlert?.title || criteriaAlert.title;

            input.evaluationSummary?.events.push({
              type: "alert-skipped",
              title: `Alert already active: ${renderedAlertTitle}`,
              message:
                "Skipped creating a new alert because an active alert exists for this criteria.",
              relatedCriteriaId: input.criteriaInstance.data?.id,
              relatedAlertId: alreadyOpenAlert?.id?.toString(),
              relatedAlertNumber: alreadyOpenAlert?.alertNumber,
              relatedAlertNumberWithPrefix:
                alreadyOpenAlert?.alertNumberWithPrefix,
              at: OneUptimeDate.getCurrentDate(),
            });
            continue;
          }

          // create alert here.

          logger.debug(
            `${input.monitor.id?.toString()} - Create alert.`,
            alertLogAttributes,
          );

          const alert: Alert = new Alert();
          const storageMap: JSONObject =
            MonitorTemplateUtil.buildTemplateStorageMap({
              monitorType: input.monitor.monitorType!,
              dataToProcess: input.dataToProcess,
              monitor: input.monitor,
              seriesLabels,
            });

          alert.title = MonitorTemplateUtil.processTemplateString({
            value: criteriaAlert.title,
            storageMap,
          });
          alert.description = MonitorTemplateUtil.processTemplateString({
            value: criteriaAlert.description,
            storageMap,
          });

          /*
           * A criteria severity belonging to *another* project is rejected by
           * AlertService on create. Throwing here would fail the whole
           * probe/telemetry ingest job for this monitor, so treat it as
           * "missing" and fall back to this project's own default — which is
           * also what stops the bad id spreading onto new alerts. See the same
           * fallback in MonitorIncident.
           */
          const isCriteriaSeverityUsable: boolean =
            await ProjectScopedReferenceValidator.isUsableInProject({
              projectId: input.monitor.projectId!,
              id: criteriaAlert.alertSeverityId,
              service: AlertSeverityService,
            });

          if (
            criteriaAlert.alertSeverityId?.toString() &&
            !isCriteriaSeverityUsable
          ) {
            logger.error(
              `${input.monitor.id?.toString()} - Criteria "${
                input.criteriaInstance.data?.name
              }" references alert severity ${criteriaAlert.alertSeverityId.toString()}, which does not belong to project ${input.monitor.projectId?.toString()}. Falling back to this project's default severity.`,
            );
          }

          if (!isCriteriaSeverityUsable) {
            // pick the critical criteria.

            const severity: AlertSeverity | null =
              await AlertSeverityService.findOneBy({
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

            if (!severity?.id?.toString()) {
              /*
               * The project has no alert severity configured. Throwing here
               * would fail the entire probe/telemetry ingest job — which
               * then retries forever over a misconfiguration the worker
               * cannot fix, and takes every other series on this monitor
               * down with it. Skip this alert and log instead, exactly as
               * the incident path does.
               */
              logger.error(
                `${input.monitor.id?.toString()} - Cannot create alert: project ${input.monitor.projectId?.toString()} has no alert severity configured. Skipping alert creation for criteria "${
                  input.criteriaInstance.data?.name
                }".`,
              );

              input.evaluationSummary?.events.push({
                type: "alert-skipped",
                title: "Alert creation skipped",
                message:
                  "Skipped creating an alert because the project has no alert severity configured.",
                relatedCriteriaId: input.criteriaInstance.data?.id,
                at: OneUptimeDate.getCurrentDate(),
              });
              continue;
            }

            alert.alertSeverityId = severity.id!;
          } else {
            alert.alertSeverityId = criteriaAlert.alertSeverityId!;
          }

          alert.monitor = input.monitor;
          alert.projectId = input.monitor.projectId!;
          alert.rootCause = seriesRootCause;
          alert.createdStateLog = JSON.parse(
            JSON.stringify(input.dataToProcess, null, 2),
          );

          /*
           * Same capture on every alert this evaluation opens - they all
           * came from the one check.
           */
          const serializedMonitorSummary: JSONObject | null =
            MonitorSummarySnapshotUtil.serialize(input.monitorSummary);

          if (serializedMonitorSummary) {
            alert.monitorSummary = serializedMonitorSummary;
          }

          if (input.criteriaInstance.data?.id) {
            alert.createdCriteriaId = input.criteriaInstance.data.id.toString();
          }

          if (seriesFingerprint) {
            alert.seriesFingerprint = seriesFingerprint;
          }
          if (seriesLabels && Object.keys(seriesLabels).length > 0) {
            alert.seriesLabels = seriesLabels;

            /*
             * Attach every resource this series identifies — host, docker
             * host, podman host, k8s cluster, service, and the Proxmox /
             * Ceph / Swarm / IoT clusters — resolved from the shared label
             * key map. Same call the incident path makes, so the two can't
             * drift apart again.
             */
            await SeriesResourceLinker.linkSeriesResourcesToModel({
              model: alert,
              seriesLabels,
              projectId: input.monitor.projectId!,
              monitorType: input.monitor.monitorType,
            });
          }

          /*
           * Deterministic resource link from the monitor's step config
           * (resolved once above). For most monitor types this — not the
           * label path above — is what makes the per-resource Activity
           * tabs and badge counts see monitor-created alerts, because
           * their criteria are ungrouped and emit no series labels at
           * all. Runs for both grouped and ungrouped alerts, and merges
           * with whatever the labels resolved.
           */
          SeriesResourceLinker.attachResolvedResources({
            model: alert,
            resolved: resourceContext,
          });

          alert.onCallDutyPolicies =
            criteriaAlert.onCallPolicyIds?.map((id: ObjectID) => {
              const onCallPolicy: OnCallDutyPolicy = new OnCallDutyPolicy();
              onCallPolicy._id = id.toString();
              return onCallPolicy;
            }) || [];

          // Set labels from criteria
          alert.labels =
            criteriaAlert.labelIds?.map((id: ObjectID) => {
              const label: Label = new Label();
              label._id = id.toString();
              return label;
            }) || [];

          alert.isCreatedAutomatically = true;

          if (criteriaAlert.isPrivate === true) {
            alert.isPrivate = true;
          }

          if (input.props.telemetryQuery) {
            alert.telemetryQuery = input.props.telemetryQuery;
          }

          if (
            input.dataToProcess &&
            (input.dataToProcess as ProbeMonitorResponse).probeId
          ) {
            alert.createdByProbeId = (
              input.dataToProcess as ProbeMonitorResponse
            ).probeId;
          }

          if (criteriaAlert.remediationNotes) {
            alert.remediationNotes = MonitorTemplateUtil.processTemplateString({
              value: criteriaAlert.remediationNotes,
              storageMap,
            });
          }

          const createdAlert: Alert = await AlertService.create({
            data: alert,
            props: {
              isRoot: true,
            },
          });

          /*
           * Add owner teams and users after alert creation. Owners configured
           * on the criteria template are merged (deduped) with the owners of
           * the network device this monitor watches, so device ownership flows
           * into the alerts its monitor raises.
           */
          if (networkDeviceOwners === null) {
            networkDeviceOwners =
              await NetworkDeviceOwnerUserService.getDeviceOwnersForMonitor({
                monitor: input.monitor,
                monitorStepId: (
                  input.dataToProcess as ProbeMonitorResponse
                ).monitorStepId?.toString(),
              });
          }

          const ownerUserIds: Array<ObjectID> = this.mergeOwnerIds(
            criteriaAlert.ownerUserIds || [],
            networkDeviceOwners.ownerUserIds,
          );

          const ownerTeamIds: Array<ObjectID> = this.mergeOwnerIds(
            criteriaAlert.ownerTeamIds || [],
            networkDeviceOwners.ownerTeamIds,
          );

          if (ownerTeamIds.length || ownerUserIds.length) {
            await AlertService.addOwners(
              input.monitor.projectId!,
              createdAlert.id!,
              ownerUserIds,
              ownerTeamIds,
              true, // notify owners
              {
                isRoot: true,
              },
            );
          }

          input.evaluationSummary?.events.push({
            type: "alert-created",
            title: `Alert created: ${createdAlert.title || criteriaAlert.title}`,
            message: `Alert triggered from criteria "${input.criteriaInstance.data?.name || "Unnamed criteria"}".`,
            relatedCriteriaId: input.criteriaInstance.data?.id,
            relatedAlertId: createdAlert.id?.toString(),
            relatedAlertNumber: createdAlert.alertNumber,
            relatedAlertNumberWithPrefix: createdAlert.alertNumberWithPrefix,
            at: OneUptimeDate.getCurrentDate(),
          });
        } catch (err) {
          /*
           * One series must not take the rest of the fleet down with it.
           * Everything below this loop happens per host/container/key and
           * touches the database; an error thrown from here used to
           * propagate out of MonitorResource (which has no catch, only a
           * `finally` that releases the lock) and abandon every series
           * after the failing one, plus the monitor log for the tick.
           */
          logger.error(
            `${input.monitor.id?.toString()} - Failed to create alert${
              seriesMatch?.fingerprint
                ? ` for series ${seriesMatch.fingerprint}`
                : ""
            }.`,
          );
          logger.error(err);

          input.evaluationSummary?.events.push({
            type: "alert-skipped",
            title: "Alert creation failed",
            message: `Could not create an alert${
              seriesMatch?.fingerprint
                ? ` for series ${seriesMatch.fingerprint}`
                : ""
            }: ${err instanceof Error ? err.message : String(err)}`,
            relatedCriteriaId: input.criteriaInstance.data?.id,
            at: OneUptimeDate.getCurrentDate(),
          });

          continue;
        }
      }
    }
  }

  /*
   * Merges two owner id lists, deduping by string value. Criteria-authored
   * ids can arrive as plain strings from stored JSON, so normalise through
   * toString() for both the comparison and the returned ObjectIDs.
   */
  private static mergeOwnerIds(
    primary: Array<ObjectID>,
    additional: Array<ObjectID>,
  ): Array<ObjectID> {
    const seenIds: Set<string> = new Set<string>();
    const mergedIds: Array<ObjectID> = [];

    for (const ownerId of [...primary, ...additional]) {
      if (!ownerId) {
        continue;
      }

      const ownerIdAsString: string = ownerId.toString();

      if (!ownerIdAsString || seenIds.has(ownerIdAsString)) {
        continue;
      }

      seenIds.add(ownerIdAsString);
      mergedIds.push(new ObjectID(ownerIdAsString));
    }

    return mergedIds;
  }

  private static async resolveOpenAlert(input: {
    openAlert: Alert;
    rootCause: string;
    dataToProcess:
      | ProbeMonitorResponse
      | IncomingMonitorRequest
      | DataToProcess;
  }): Promise<void> {
    const resolvedStateId: ObjectID =
      await AlertStateTimelineService.getResolvedStateIdForProject(
        input.openAlert.projectId!,
      );

    const alertStateTimeline: AlertStateTimeline = new AlertStateTimeline();
    alertStateTimeline.alertId = input.openAlert.id!;
    alertStateTimeline.alertStateId = resolvedStateId;
    alertStateTimeline.projectId = input.openAlert.projectId!;

    if (input.rootCause) {
      alertStateTimeline.rootCause =
        "Alert autoresolved because autoresolve is set to true in monitor criteria. " +
        input.rootCause;
    }

    if (input.dataToProcess) {
      alertStateTimeline.stateChangeLog = JSON.parse(
        JSON.stringify(input.dataToProcess),
      );
    }

    try {
      await AlertStateTimelineService.create({
        data: alertStateTimeline,
        props: {
          isRoot: true,
        },
      });
    } catch (err) {
      /*
       * Idempotent concurrency race: two evaluations for the same monitor
       * (e.g. the explicit per-key resolveSeriesAlertsByFingerprint path and
       * the checkOpenAlertsAndCloseIfResolved path) can both decide to resolve
       * the same open alert near-simultaneously. The loser's onBeforeCreate
       * dedupe throws this exact BadDataException. Treat as a no-op at debug
       * level instead of failing the queue job. Mirrors resolveOpenIncident.
       */
      if (
        err instanceof BadDataException &&
        err.message === "Alert state cannot be same as previous state."
      ) {
        logger.debug(
          `${input.openAlert.id?.toString()} - Alert already in resolved state; skipping duplicate state timeline (concurrent race).`,
        );
      } else {
        throw err;
      }
    }
  }

  /**
   * Is `openAlert`'s series still breaching the criteria that raised it?
   *
   * Prefers the per-criteria dictionary, which answers the question for
   * the criteria that actually owns this alert. The single-set fallback
   * only knows the winning criteria's breaches, so it has to approximate
   * with `createAlerts` — a criteria that creates no alerts is a
   * recovery criteria whose "matches" are healthy series, and counting
   * those as breaches would pin an offline alert open forever.
   */
  private static isSeriesStillBreaching(input: {
    openAlert: Alert;
    criteriaInstance: MonitorCriteriaInstance | null;
    openSeriesFingerprint: string;
    breachingSeriesFingerprints: Set<string>;
    breachingSeriesFingerprintsByCriteriaId?:
      | Dictionary<Set<string>>
      | undefined;
  }): boolean {
    const owningCriteriaId: string | undefined =
      input.openAlert.createdCriteriaId?.toString() || undefined;

    if (input.breachingSeriesFingerprintsByCriteriaId && owningCriteriaId) {
      return Boolean(
        input.breachingSeriesFingerprintsByCriteriaId[owningCriteriaId]?.has(
          input.openSeriesFingerprint,
        ),
      );
    }

    const matchedCriteriaCreatesAlerts: boolean =
      input.criteriaInstance?.data?.createAlerts === true;

    return (
      matchedCriteriaCreatesAlerts &&
      input.breachingSeriesFingerprints.has(input.openSeriesFingerprint)
    );
  }

  private static wasCriteriaEvaluated(input: {
    openAlert: Alert;
    breachingSeriesFingerprintsByCriteriaId: Dictionary<Set<string>>;
  }): boolean {
    const owningCriteriaId: string | undefined =
      input.openAlert.createdCriteriaId?.toString() || undefined;

    if (!owningCriteriaId) {
      return true;
    }

    return (
      input.breachingSeriesFingerprintsByCriteriaId[owningCriteriaId] !==
      undefined
    );
  }

  /**
   * Alert auto-resolve lists templates by criteria; the presence of any
   * template for a criteria means "this criteria's alerts are configured
   * to auto-resolve".
   */
  private static isAutoResolveConfiguredForAlert(input: {
    openAlert: Alert;
    autoResolveCriteriaInstanceIdAlertIdsDictionary: Dictionary<Array<string>>;
  }): boolean {
    const createdCriteriaId: string | undefined =
      input.openAlert.createdCriteriaId?.toString() || undefined;

    if (!createdCriteriaId) {
      return false;
    }

    const autoResolveTemplates: Array<string> | undefined =
      input.autoResolveCriteriaInstanceIdAlertIdsDictionary[createdCriteriaId];

    return Boolean(autoResolveTemplates && autoResolveTemplates.length > 0);
  }

  private static shouldCloseAlert(input: {
    openAlert: Alert;
    autoResolveCriteriaInstanceIdAlertIdsDictionary: Dictionary<Array<string>>;
    criteriaInstance: MonitorCriteriaInstance | null; // null if no criteia met.
    breachingSeriesFingerprints?: Set<string> | undefined;
    breachingSeriesFingerprintsByCriteriaId?:
      | Dictionary<Set<string>>
      | undefined;
    disableSeriesAbsenceResolution?: boolean | undefined;
  }): boolean {
    const openSeriesFingerprint: string | undefined =
      input.openAlert.seriesFingerprint || undefined;

    /*
     * Event-driven (incoming-request / webhook) per-key alerts must NEVER
     * be resolved by absence — only explicitly, via
     * resolveSeriesAlertsByFingerprint, when the payload reports the key as
     * recovered. Mirrors MonitorIncident.shouldCloseIncident. Without this
     * guard, a heartbeat-timeout cron tick or a rejected webhook would
     * bulk-resolve all open per-key alerts by absence.
     */
    if (input.disableSeriesAbsenceResolution && openSeriesFingerprint) {
      return false;
    }

    // Per-series mode: this evaluation knows which series are breaching.
    if (input.breachingSeriesFingerprints !== undefined) {
      /*
       * A whole-monitor alert (no fingerprint) on a monitor that now
       * alerts per series. It was raised before the monitor was grouped,
       * and nothing can ever dedupe against it again — every alert from
       * here on carries a fingerprint. Left alone it stays open forever
       * while its replacements come and go. Resolve it, on the same
       * auto-resolve terms as any other alert from its criteria.
       */
      if (!openSeriesFingerprint) {
        if (input.disableSeriesAbsenceResolution) {
          return false;
        }

        return MonitorAlert.isAutoResolveConfiguredForAlert({
          openAlert: input.openAlert,
          autoResolveCriteriaInstanceIdAlertIdsDictionary:
            input.autoResolveCriteriaInstanceIdAlertIdsDictionary,
        });
      }

      if (
        MonitorAlert.isSeriesStillBreaching({
          openAlert: input.openAlert,
          criteriaInstance: input.criteriaInstance,
          openSeriesFingerprint,
          breachingSeriesFingerprints: input.breachingSeriesFingerprints,
          breachingSeriesFingerprintsByCriteriaId:
            input.breachingSeriesFingerprintsByCriteriaId,
        })
      ) {
        return false;
      }

      /*
       * The criteria that raised this alert was not evaluated on this
       * tick at all (disabled, deleted, or the monitor stops at its
       * first match). Absence of a breaching set for it is not evidence
       * of recovery, so leave the alert alone.
       */
      if (
        input.breachingSeriesFingerprintsByCriteriaId &&
        !MonitorAlert.wasCriteriaEvaluated({
          openAlert: input.openAlert,
          breachingSeriesFingerprintsByCriteriaId:
            input.breachingSeriesFingerprintsByCriteriaId,
        })
      ) {
        return false;
      }

      return MonitorAlert.isAutoResolveConfiguredForAlert({
        openAlert: input.openAlert,
        autoResolveCriteriaInstanceIdAlertIdsDictionary:
          input.autoResolveCriteriaInstanceIdAlertIdsDictionary,
      });
    }

    if (
      input.openAlert.createdCriteriaId?.toString() ===
      input.criteriaInstance?.data?.id?.toString()
    ) {
      // same alert active. So, do not close.
      return false;
    }

    // If antoher criteria is active then, check if the alert id is present in the map.

    if (!input.openAlert.createdCriteriaId?.toString()) {
      return false;
    }

    if (
      input.autoResolveCriteriaInstanceIdAlertIdsDictionary[
        input.openAlert.createdCriteriaId?.toString()
      ]
    ) {
      return true;
    }

    return false;
  }
}
