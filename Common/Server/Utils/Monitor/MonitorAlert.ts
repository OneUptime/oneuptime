import Alert from "../../../Models/DatabaseModels/Alert";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import AlertStateTimeline from "../../../Models/DatabaseModels/AlertStateTimeline";
import CephCluster from "../../../Models/DatabaseModels/CephCluster";
import DockerSwarmCluster from "../../../Models/DatabaseModels/DockerSwarmCluster";
import Host from "../../../Models/DatabaseModels/Host";
import Label from "../../../Models/DatabaseModels/Label";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import ProxmoxCluster from "../../../Models/DatabaseModels/ProxmoxCluster";
import IoTFleet from "../../../Models/DatabaseModels/IoTFleet";
import Service from "../../../Models/DatabaseModels/Service";
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
import AlertStateTimelineService from "../../Services/AlertStateTimelineService";
import HostService from "../../Services/HostService";
import ServiceService from "../../Services/ServiceService";
import logger, { LogAttributes } from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";
import DataToProcess from "./DataToProcess";
import MonitorClusterContextUtil, {
  MonitorClusterContext,
} from "./MonitorClusterContext";
import MonitorTemplateUtil from "./MonitorTemplateUtil";
import { JSONObject } from "../../../Types/JSON";
import OneUptimeDate from "../../../Types/Date";
import MonitorEvaluationSummary from "../../../Types/Monitor/MonitorEvaluationSummary";
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

    for (const openAlert of openAlerts) {
      const shouldClose: boolean = this.shouldCloseAlert({
        openAlert,
        autoResolveCriteriaInstanceIdAlertIdsDictionary:
          input.autoResolveCriteriaInstanceIdAlertIdsDictionary,
        criteriaInstance: input.criteriaInstance,
        breachingSeriesFingerprints: input.breachingSeriesFingerprints,
        disableSeriesAbsenceResolution: input.disableSeriesAbsenceResolution,
      });

      if (shouldClose) {
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

    return openAlerts;
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
    props: {
      telemetryQuery?: TelemetryQuery | undefined;
    };
    matchesPerSeries?: Array<PerSeriesCriteriaMatch> | undefined;
    /**
     * Series fingerprints whose underlying resource is inside an
     * ongoing scheduled maintenance window. Alerts for these series are
     * suppressed at creation time even though the monitor keeps
     * evaluating. See MonitorMaintenanceSuppression.
     */
    suppressedSeriesFingerprints?: Set<string> | undefined;
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
      await this.checkOpenAlertsAndCloseIfResolved({
        monitorId: input.monitor.id!,
        autoResolveCriteriaInstanceIdAlertIdsDictionary:
          input.autoResolveCriteriaInstanceIdAlertIdsDictionary,
        rootCause: input.rootCause,
        criteriaInstance: input.criteriaInstance,
        dataToProcess: input.dataToProcess,
        evaluationSummary: input.evaluationSummary,
        breachingSeriesFingerprints,
        disableSeriesAbsenceResolution: input.disableSeriesAbsenceResolution,
      });

    if (!input.criteriaInstance.data?.createAlerts) {
      return;
    }

    /*
     * Proxmox/Ceph monitors: resolve the monitored cluster once per
     * evaluation (lookup-only, from the step config's clusterIdentifier)
     * so every alert created below is attached to it. Series labels
     * cannot supply this — they carry datapoint labels (`id`,
     * `ceph_daemon`, `pool_id`), not cluster identity, and ungrouped
     * templates have no series at all. No-op for other monitor types.
     */
    const clusterContext: MonitorClusterContext =
      await MonitorClusterContextUtil.resolveClusterContextForMonitor({
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

    for (const criteriaAlert of input.criteriaInstance.data?.alerts || []) {
      for (const seriesMatch of seriesToProcess) {
        const seriesFingerprint: string | undefined = seriesMatch?.fingerprint;
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

        if (!criteriaAlert.alertSeverityId) {
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

          if (!severity) {
            throw new BadDataException("Project does not have alert severity");
          } else {
            alert.alertSeverityId = severity.id!;
          }
        } else {
          alert.alertSeverityId = criteriaAlert.alertSeverityId!;
        }

        alert.monitor = input.monitor;
        alert.projectId = input.monitor.projectId!;
        alert.rootCause = seriesRootCause;
        alert.createdStateLog = JSON.parse(
          JSON.stringify(input.dataToProcess, null, 2),
        );

        if (input.criteriaInstance.data?.id) {
          alert.createdCriteriaId = input.criteriaInstance.data.id.toString();
        }

        if (seriesFingerprint) {
          alert.seriesFingerprint = seriesFingerprint;
        }
        if (seriesLabels && Object.keys(seriesLabels).length > 0) {
          alert.seriesLabels = seriesLabels;

          /*
           * Link the alert to the Host that emitted this series, if
           * the metric carried a `host.name` resource attribute. The
           * Host record was auto-discovered during OTel ingestion.
           * Metric attributes are stored with the `resource.` prefix in
           * ClickHouse, so the group-by dropdown surfaces
           * `resource.host.name` — but accept the bare `host.name` too
           * for any non-OTel ingest paths.
           */
          const hostName: string | undefined =
            typeof seriesLabels["resource.host.name"] === "string"
              ? (seriesLabels["resource.host.name"] as string)
              : typeof seriesLabels["host.name"] === "string"
                ? (seriesLabels["host.name"] as string)
                : undefined;

          if (hostName) {
            const host: Host | null = await HostService.findOneBy({
              query: {
                projectId: input.monitor.projectId!,
                hostIdentifier: hostName,
              },
              select: {
                _id: true,
              },
              props: {
                isRoot: true,
              },
            });

            if (host) {
              alert.hosts = [host];
            }
          }

          /*
           * Same idea for Service — OTel ingest stamps `service.name` and
           * auto-creates a Service row keyed by that name (see
           * OpenTelemetryIngestService.telemetryServiceFromName). When the
           * breaching series carries that attribute, link the alert to the
           * emitting service so the on-call/labels pipeline can fan out.
           */
          const serviceName: string | undefined =
            typeof seriesLabels["resource.service.name"] === "string"
              ? (seriesLabels["resource.service.name"] as string)
              : typeof seriesLabels["service.name"] === "string"
                ? (seriesLabels["service.name"] as string)
                : undefined;

          if (serviceName) {
            const service: Service | null = await ServiceService.findOneBy({
              query: {
                projectId: input.monitor.projectId!,
                name: serviceName,
              },
              select: {
                _id: true,
              },
              props: {
                isRoot: true,
              },
            });

            if (service) {
              alert.services = [service];
            }
          }
        }

        /*
         * Deterministic Proxmox/Ceph cluster link from the monitor's
         * step config (resolved once above). Series labels never carry
         * cluster identity for these monitor types, so this — not the
         * label path above — is what makes the per-cluster Activity
         * tabs and badge counts see monitor-created alerts. Runs for
         * both grouped and ungrouped alerts.
         */
        if (clusterContext.proxmoxClusterIds.length > 0) {
          alert.proxmoxClusters = clusterContext.proxmoxClusterIds.map(
            (id: string): ProxmoxCluster => {
              const cluster: ProxmoxCluster = new ProxmoxCluster();
              cluster._id = id;
              return cluster;
            },
          );
        }
        if (clusterContext.cephClusterIds.length > 0) {
          alert.cephClusters = clusterContext.cephClusterIds.map(
            (id: string): CephCluster => {
              const cluster: CephCluster = new CephCluster();
              cluster._id = id;
              return cluster;
            },
          );
        }
        if (clusterContext.dockerSwarmClusterIds.length > 0) {
          alert.dockerSwarmClusters = clusterContext.dockerSwarmClusterIds.map(
            (id: string): DockerSwarmCluster => {
              const cluster: DockerSwarmCluster = new DockerSwarmCluster();
              cluster._id = id;
              return cluster;
            },
          );
        }
        if (clusterContext.iotFleetIds.length > 0) {
          alert.iotFleets = clusterContext.iotFleetIds.map(
            (id: string): IoTFleet => {
              const fleet: IoTFleet = new IoTFleet();
              fleet._id = id;
              return fleet;
            },
          );
        }

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

        const createdAlert: Alert = await AlertService.create({
          data: alert,
          props: {
            isRoot: true,
          },
        });

        // Add owner teams and users after alert creation
        if (
          criteriaAlert.ownerTeamIds?.length ||
          criteriaAlert.ownerUserIds?.length
        ) {
          await AlertService.addOwners(
            input.monitor.projectId!,
            createdAlert.id!,
            criteriaAlert.ownerUserIds || [],
            criteriaAlert.ownerTeamIds || [],
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
      }
    }
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

  private static shouldCloseAlert(input: {
    openAlert: Alert;
    autoResolveCriteriaInstanceIdAlertIdsDictionary: Dictionary<Array<string>>;
    criteriaInstance: MonitorCriteriaInstance | null; // null if no criteia met.
    breachingSeriesFingerprints?: Set<string> | undefined;
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

    /*
     * Per-series auto-resolve: when a breaching-series set is given and
     * this alert has a fingerprint, resolve whenever the fingerprint is
     * no longer in the set, independent of whether other series on the
     * same monitor are still breaching.
     */
    if (
      input.breachingSeriesFingerprints !== undefined &&
      openSeriesFingerprint
    ) {
      const stillBreaching: boolean = input.breachingSeriesFingerprints.has(
        openSeriesFingerprint,
      );

      if (stillBreaching) {
        return false;
      }

      if (!input.openAlert.createdCriteriaId?.toString()) {
        return false;
      }

      const autoResolveTemplates: Array<string> | undefined =
        input.autoResolveCriteriaInstanceIdAlertIdsDictionary[
          input.openAlert.createdCriteriaId.toString()
        ];

      /*
       * Alert auto-resolve lists templates by criteria; presence of any
       * template for this criteria means "this criteria's alerts are
       * configured to auto-resolve", so resolve this series.
       */
      if (autoResolveTemplates && autoResolveTemplates.length > 0) {
        return true;
      }

      return false;
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
