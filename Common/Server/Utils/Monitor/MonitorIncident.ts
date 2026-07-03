import CephCluster from "../../../Models/DatabaseModels/CephCluster";
import DockerSwarmCluster from "../../../Models/DatabaseModels/DockerSwarmCluster";
import DockerHost from "../../../Models/DatabaseModels/DockerHost";
import Host from "../../../Models/DatabaseModels/Host";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import IncidentStateTimeline from "../../../Models/DatabaseModels/IncidentStateTimeline";
import IncidentMember from "../../../Models/DatabaseModels/IncidentMember";
import KubernetesCluster from "../../../Models/DatabaseModels/KubernetesCluster";
import Label from "../../../Models/DatabaseModels/Label";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import PodmanHost from "../../../Models/DatabaseModels/PodmanHost";
import ProxmoxCluster from "../../../Models/DatabaseModels/ProxmoxCluster";
import IoTFleet from "../../../Models/DatabaseModels/IoTFleet";
import Service from "../../../Models/DatabaseModels/Service";
import Includes from "../../../Types/BaseDatabase/Includes";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import Dictionary from "../../../Types/Dictionary";
import BadDataException from "../../../Types/Exception/BadDataException";
import IncomingMonitorRequest from "../../../Types/Monitor/IncomingMonitor/IncomingMonitorRequest";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import ObjectID from "../../../Types/ObjectID";
import ProbeMonitorResponse from "../../../Types/Probe/ProbeMonitorResponse";
import { TelemetryQuery } from "../../../Types/Telemetry/TelemetryQuery";
import { DisableAutomaticIncidentCreation } from "../../EnvironmentConfig";
import CephClusterService from "../../Services/CephClusterService";
import DockerHostService from "../../Services/DockerHostService";
import HostService from "../../Services/HostService";
import IncidentService from "../../Services/IncidentService";
import KubernetesClusterService from "../../Services/KubernetesClusterService";
import PodmanHostService from "../../Services/PodmanHostService";
import ProxmoxClusterService from "../../Services/ProxmoxClusterService";
import ServiceService from "../../Services/ServiceService";
import IncidentSeverityService from "../../Services/IncidentSeverityService";
import IncidentStateTimelineService from "../../Services/IncidentStateTimelineService";
import IncidentMemberService from "../../Services/IncidentMemberService";
import logger, { LogAttributes } from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";
import DataToProcess from "./DataToProcess";
import MonitorTemplateUtil from "./MonitorTemplateUtil";
import { JSONObject } from "../../../Types/JSON";
import OneUptimeDate from "../../../Types/Date";
import MonitorEvaluationSummary from "../../../Types/Monitor/MonitorEvaluationSummary";
import { IncidentMemberRoleAssignment } from "../../../Types/Monitor/CriteriaIncident";
import { PerSeriesCriteriaMatch } from "../../../Types/Probe/ProbeApiIngestResponse";
import MonitorClusterContextUtil, {
  MonitorClusterContext,
} from "./MonitorClusterContext";
import SeriesResourceLabels, {
  SeriesResourceRefs,
} from "./SeriesResourceLabels";

export default class MonitorIncident {
  @CaptureSpan()
  public static async checkOpenIncidentsAndCloseIfResolved(input: {
    monitorId: ObjectID;
    autoResolveCriteriaInstanceIdIncidentIdsDictionary: Dictionary<
      Array<string>
    >;
    rootCause: string;
    criteriaInstance: MonitorCriteriaInstance | null;
    dataToProcess: DataToProcess;
    evaluationSummary?: MonitorEvaluationSummary | undefined;
    /**
     * When set, the fingerprint set of series still breaching on this
     * tick. Any open per-series incident whose fingerprint is NOT in
     * this set is auto-resolved — that's how a series returning to
     * normal closes its incident independently of other series on the
     * same monitor. Undefined means "legacy mode" and per-series
     * incidents are treated like any other for dedupe/resolve.
     */
    breachingSeriesFingerprints?: Set<string> | undefined;
    /**
     * Event-driven (incoming-request / webhook) mode. When true, an open
     * incident carrying a seriesFingerprint is never auto-resolved here —
     * webhooks resolve per-key only via resolveSeriesIncidentsByFingerprint,
     * never by absence. Must be passed on BOTH the criteria-met and the
     * no-criteria-met code paths for grouped incoming-request monitors.
     */
    disableSeriesAbsenceResolution?: boolean | undefined;
  }): Promise<Array<Incident>> {
    // check active incidents and if there are open incidents, do not create another incident.
    const openIncidents: Array<Incident> = await IncidentService.findBy({
      query: {
        monitors: [input.monitorId],
        currentIncidentState: {
          isResolvedState: false,
        },
      },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
      select: {
        _id: true,
        title: true,
        createdCriteriaId: true,
        createdIncidentTemplateId: true,
        projectId: true,
        incidentNumber: true,
        incidentNumberWithPrefix: true,
        currentIncidentStateId: true,
        seriesFingerprint: true,
        seriesLabels: true,
      },
      props: {
        isRoot: true,
      },
    });

    // check if should close the incident.

    for (const openIncident of openIncidents) {
      const shouldClose: boolean = this.shouldCloseIncident({
        openIncident,
        autoResolveCriteriaInstanceIdIncidentIdsDictionary:
          input.autoResolveCriteriaInstanceIdIncidentIdsDictionary,
        criteriaInstance: input.criteriaInstance,
        breachingSeriesFingerprints: input.breachingSeriesFingerprints,
        disableSeriesAbsenceResolution: input.disableSeriesAbsenceResolution,
      });

      if (shouldClose) {
        // then resolve incident.
        await this.resolveOpenIncident({
          openIncident: openIncident,
          rootCause: input.rootCause,
          dataToProcess: input.dataToProcess,
        });

        input.evaluationSummary?.events.push({
          type: "incident-resolved",
          title: `Incident resolved: ${openIncident.id?.toString()}`,
          message:
            "Incident auto-resolved because autoresolve is enabled for this criteria.",
          relatedIncidentId: openIncident.id?.toString(),
          relatedIncidentNumber: openIncident.incidentNumber,
          relatedIncidentNumberWithPrefix:
            openIncident.incidentNumberWithPrefix,
          relatedCriteriaId: input.criteriaInstance?.data?.id,
          at: OneUptimeDate.getCurrentDate(),
        });
      }
    }

    return openIncidents;
  }

  /**
   * Event-driven (incoming-request / webhook) resolution: resolve the
   * open incidents for the given payload-derived fingerprints — and only
   * those — when the criteria that created them has auto-resolve enabled.
   *
   * Unlike the metric snapshot model, this never resolves an incident by
   * absence: a webhook describes only the keys in its payload, so a
   * missing key is not a recovery signal. The caller passes exactly the
   * fingerprints the payload explicitly classified as resolved (see
   * IncomingRequestIncidentGrouping.collectResolvedFingerprints).
   */
  @CaptureSpan()
  public static async resolveSeriesIncidentsByFingerprint(input: {
    monitor: Monitor;
    fingerprints: Array<string>;
    rootCause: string;
    dataToProcess: DataToProcess;
    autoResolveCriteriaInstanceIdIncidentIdsDictionary: Dictionary<
      Array<string>
    >;
    evaluationSummary?: MonitorEvaluationSummary | undefined;
  }): Promise<void> {
    if (!input.fingerprints || input.fingerprints.length === 0) {
      return;
    }

    const fingerprintSet: Set<string> = new Set<string>(input.fingerprints);

    const openIncidents: Array<Incident> = await IncidentService.findBy({
      query: {
        monitors: [input.monitor.id!],
        currentIncidentState: {
          isResolvedState: false,
        },
      },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
      select: {
        _id: true,
        title: true,
        createdCriteriaId: true,
        createdIncidentTemplateId: true,
        projectId: true,
        incidentNumber: true,
        incidentNumberWithPrefix: true,
        seriesFingerprint: true,
      },
      props: {
        isRoot: true,
      },
    });

    for (const openIncident of openIncidents) {
      const fingerprint: string | undefined =
        openIncident.seriesFingerprint || undefined;

      if (!fingerprint || !fingerprintSet.has(fingerprint)) {
        continue;
      }

      const createdCriteriaId: string | undefined =
        openIncident.createdCriteriaId?.toString();
      const createdIncidentTemplateId: string | undefined =
        openIncident.createdIncidentTemplateId?.toString();

      // Only auto-resolve when the creating criteria opted into it.
      if (!createdCriteriaId || !createdIncidentTemplateId) {
        continue;
      }

      const autoResolveTemplates: Array<string> | undefined =
        input.autoResolveCriteriaInstanceIdIncidentIdsDictionary[
          createdCriteriaId
        ];

      if (
        !autoResolveTemplates ||
        !autoResolveTemplates.includes(createdIncidentTemplateId)
      ) {
        continue;
      }

      await this.resolveOpenIncident({
        openIncident: openIncident,
        rootCause: input.rootCause,
        dataToProcess: input.dataToProcess,
      });

      input.evaluationSummary?.events.push({
        type: "incident-resolved",
        title: `Incident resolved: ${openIncident.id?.toString()}`,
        message:
          "Incident auto-resolved because the incoming payload reported this key as resolved.",
        relatedIncidentId: openIncident.id?.toString(),
        relatedIncidentNumber: openIncident.incidentNumber,
        relatedIncidentNumberWithPrefix: openIncident.incidentNumberWithPrefix,
        at: OneUptimeDate.getCurrentDate(),
      });
    }
  }

  @CaptureSpan()
  public static async criteriaMetCreateIncidentsAndUpdateMonitorStatus(input: {
    criteriaInstance: MonitorCriteriaInstance;
    monitor: Monitor;
    dataToProcess: DataToProcess;
    rootCause: string;
    autoResolveCriteriaInstanceIdIncidentIdsDictionary: Dictionary<
      Array<string>
    >;
    evaluationSummary?: MonitorEvaluationSummary | undefined;
    props: {
      telemetryQuery?: TelemetryQuery | undefined;
    };
    /**
     * When set, create one incident per series instead of one per
     * monitor. Each entry gets its own rootCause, seriesFingerprint,
     * and seriesLabels so the incident title + description can
     * reference `{{host.name}}` etc. via the template engine.
     */
    matchesPerSeries?: Array<PerSeriesCriteriaMatch> | undefined;
    /**
     * Series fingerprints whose underlying resource (host, docker host,
     * kubernetes cluster, or service) is inside an ongoing scheduled
     * maintenance window. The monitor itself keeps evaluating — it is
     * not attached to the maintenance — but incidents for these series
     * are suppressed at creation time. See MonitorMaintenanceSuppression.
     */
    suppressedSeriesFingerprints?: Set<string> | undefined;
    /**
     * Event-driven monitors (incoming-request / webhook fan-out) must not
     * use the metric snapshot model where a series absent from this tick's
     * breaching set is auto-resolved — a single webhook only describes the
     * keys in that payload, not the full firing set, so absence is not
     * recovery. When true, the per-series absence-resolve pass is skipped;
     * those incidents are resolved explicitly elsewhere (see
     * IncomingRequestIncidentGrouping + resolveSeriesIncidentsByFingerprint).
     * Per-key create + dedupe still happen via matchesPerSeries.
     */
    disableSeriesAbsenceResolution?: boolean | undefined;
  }): Promise<void> {
    const incidentLogAttributes: LogAttributes = {
      projectId: input.monitor.projectId?.toString(),
    };

    // check open incidents
    logger.debug(
      `${input.monitor.id?.toString()} - Check open incidents.`,
      incidentLogAttributes,
    );

    /*
     * Per-series mode: close any open incident for a series that's no
     * longer breaching *before* we look at the remaining open set, so
     * dedupe decisions below match the post-resolve state.
     *
     * Only a criteria that actually creates incidents contributes
     * breaching fingerprints. When the matched criteria does NOT create
     * incidents — e.g. the "Healthy" criteria of the per-series infra
     * monitors (IoT/Kubernetes/Docker/Host/Proxmox/Ceph), which uses
     * MetricValue filters and therefore matches every RECOVERED series —
     * its matches describe healthy series, not breaching ones. Treating
     * them as breaching kept every open per-series incident from ever
     * auto-resolving on full recovery (the resolve path saw its own
     * fingerprint in the "still breaching" set). Use an EMPTY set, not
     * undefined, so per-series resolve semantics still apply: every open
     * series incident whose creating criteria opted into auto-resolve is
     * closed, mirroring what the legacy cross-criteria path does for
     * non-series incidents.
     */
    const breachingSeriesFingerprints: Set<string> | undefined =
      input.matchesPerSeries && !input.disableSeriesAbsenceResolution
        ? new Set<string>(
            input.criteriaInstance.data?.createIncidents
              ? input.matchesPerSeries.map((m: PerSeriesCriteriaMatch) => {
                  return m.fingerprint;
                })
              : [],
          )
        : undefined;

    // check active incidents and if there are open incidents, do not cretae anothr incident.
    const openIncidents: Array<Incident> =
      await this.checkOpenIncidentsAndCloseIfResolved({
        monitorId: input.monitor.id!,
        autoResolveCriteriaInstanceIdIncidentIdsDictionary:
          input.autoResolveCriteriaInstanceIdIncidentIdsDictionary,
        rootCause: input.rootCause,
        criteriaInstance: input.criteriaInstance,
        dataToProcess: input.dataToProcess,
        evaluationSummary: input.evaluationSummary,
        breachingSeriesFingerprints,
        disableSeriesAbsenceResolution: input.disableSeriesAbsenceResolution,
      });

    if (!input.criteriaInstance.data?.createIncidents) {
      return;
    }

    /*
     * Proxmox/Ceph monitors: resolve the monitored cluster once per
     * evaluation (lookup-only, from the step config's clusterIdentifier)
     * so every incident created below is attached to it. Series labels
     * cannot supply this — they carry datapoint labels (`id`,
     * `ceph_daemon`, `pool_id`), not cluster identity, and ungrouped
     * templates have no series at all. No-op for other monitor types.
     */
    const clusterContext: MonitorClusterContext =
      await MonitorClusterContextUtil.resolveClusterContextForMonitor({
        monitor: input.monitor,
      });

    /*
     * Series-less path: one incident per criteriaIncident template as
     * before. Series-aware path: one incident per (series × template).
     */
    /*
     * `undefined` matchesPerSeries → legacy single-incident path. A
     * defined (even empty) array → per-series mode: iterate exactly the
     * matches. An empty array therefore creates nothing — used by grouped
     * incoming-request criteria on a payload with no firing key so they
     * don't fall back to a single whole-monitor incident.
     */
    const seriesToProcess: Array<PerSeriesCriteriaMatch | undefined> =
      input.matchesPerSeries !== undefined
        ? input.matchesPerSeries
        : [undefined];

    for (const criteriaIncident of input.criteriaInstance.data?.incidents ||
      []) {
      for (const seriesMatch of seriesToProcess) {
        const seriesFingerprint: string | undefined = seriesMatch?.fingerprint;
        const seriesLabels: JSONObject | undefined = seriesMatch?.labels;
        const seriesRootCause: string =
          seriesMatch?.rootCause || input.rootCause;

        /*
         * Per-series scheduled-maintenance suppression: this series'
         * resource is inside an ongoing maintenance window, so skip
         * creating an incident for it. Other series on the same monitor
         * whose resources are not under maintenance still get incidents.
         * Note: we only suppress *new* creation — any incident already
         * open for this series is left to the normal resolve path
         * (checkOpenIncidentsAndCloseIfResolved still sees the full
         * breaching set), so a real incident raised before maintenance
         * is not silently closed.
         */
        if (
          seriesFingerprint &&
          input.suppressedSeriesFingerprints?.has(seriesFingerprint)
        ) {
          logger.debug(
            `${input.monitor.id?.toString()} - Skipping incident for series ${seriesFingerprint}: its resource is under an active scheduled maintenance window.`,
            incidentLogAttributes,
          );

          input.evaluationSummary?.events.push({
            type: "incident-skipped",
            title: "Incident suppressed by scheduled maintenance",
            message:
              "Skipped creating an incident because the resource for this series is under an active scheduled maintenance window.",
            relatedCriteriaId: input.criteriaInstance.data?.id,
            at: OneUptimeDate.getCurrentDate(),
          });
          continue;
        }

        /*
         * Dedupe match must mirror the create path below (which sets
         * `createdCriteriaId` / `createdIncidentTemplateId` only when the
         * corresponding id is present). A criteria incident template can be
         * missing its `id` (legacy/API-authored criteria), so guard the
         * `.toString()` with `?.` — an unguarded call previously threw
         * "Cannot read properties of undefined (reading 'toString')" here and
         * failed the probe/telemetry queue job on every cycle for the affected
         * monitor. Normalise both sides to `undefined` on missing so a created
         * incident (whose template id was left NULL) still matches itself next
         * cycle instead of being recreated as a duplicate.
         */
        const alreadyOpenIncident: Incident | undefined = openIncidents.find(
          (incident: Incident) => {
            return (
              (incident.createdCriteriaId || undefined) ===
                (input.criteriaInstance.data?.id?.toString() || undefined) &&
              (incident.createdIncidentTemplateId || undefined) ===
                (criteriaIncident.id?.toString() || undefined) &&
              (incident.seriesFingerprint || undefined) === seriesFingerprint
            );
          },
        );

        const hasAlreadyOpenIncident: boolean = Boolean(alreadyOpenIncident);

        logger.debug(
          `${input.monitor.id?.toString()} - Open Incident ${alreadyOpenIncident?.id?.toString()}`,
          incidentLogAttributes,
        );

        logger.debug(
          `${input.monitor.id?.toString()} - Has open incident ${hasAlreadyOpenIncident}`,
          incidentLogAttributes,
        );

        if (hasAlreadyOpenIncident) {
          /*
           * Use the open incident's already-rendered title when
           * available — the template (`criteriaIncident.title`) still
           * contains unresolved `{{…}}` placeholders because it's the
           * criterion's template string, not the instance's rendered
           * output. Falling back to the template only when the open
           * incident somehow has no title.
           */
          const renderedTitle: string =
            alreadyOpenIncident?.title || criteriaIncident.title;

          input.evaluationSummary?.events.push({
            type: "incident-skipped",
            title: `Incident already active: ${renderedTitle}`,
            message:
              "Skipped creating a new incident because an active incident exists for this criteria.",
            relatedCriteriaId: input.criteriaInstance.data?.id,
            relatedIncidentId: alreadyOpenIncident?.id?.toString(),
            relatedIncidentNumber: alreadyOpenIncident?.incidentNumber,
            relatedIncidentNumberWithPrefix:
              alreadyOpenIncident?.incidentNumberWithPrefix,
            at: OneUptimeDate.getCurrentDate(),
          });
          continue;
        }

        logger.debug(
          `${input.monitor.id?.toString()} - Create incident.`,
          incidentLogAttributes,
        );

        const incident: Incident = new Incident();
        const storageMap: JSONObject =
          MonitorTemplateUtil.buildTemplateStorageMap({
            monitorType: input.monitor.monitorType!,
            dataToProcess: input.dataToProcess,
            monitor: input.monitor,
            seriesLabels,
          });

        incident.title = MonitorTemplateUtil.processTemplateString({
          value: criteriaIncident.title,
          storageMap,
        });
        incident.description = MonitorTemplateUtil.processTemplateString({
          value: criteriaIncident.description,
          storageMap,
        });

        /*
         * Resolve the incident severity. `criteriaIncident.incidentSeverityId`
         * can be a truthy-but-EMPTY ObjectID (id === "") — a stored
         * `{"_type":"ObjectID","value":""}` deserializes to `new ObjectID("")`,
         * which is an object so `!incidentSeverityId` is false. That empty id
         * serializes to "" for the `uuid` (not-null) column and lands as NULL,
         * throwing 23502 inside the probe-ingest worker and retrying forever.
         * Use `?.toString()` truthiness so an empty/blank ObjectID is treated
         * the same as "missing" and falls through to the project-default lookup.
         */
        if (!criteriaIncident.incidentSeverityId?.toString()) {
          // pick the critical (first/lowest-order root) severity.

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

          if (!severity?.id?.toString()) {
            /*
             * The project has no incident severity configured. Throwing here
             * would fail the entire probe/telemetry ingest job, which then
             * retries forever for a misconfiguration the worker cannot fix.
             * Skip incident creation gracefully and log instead.
             */
            logger.error(
              `${input.monitor.id?.toString()} - Cannot create incident: project ${input.monitor.projectId?.toString()} has no incident severity configured. Skipping incident creation for criteria "${
                input.criteriaInstance.data?.name
              }".`,
            );

            input.evaluationSummary?.events.push({
              type: "incident-skipped",
              title: "Incident creation skipped",
              message:
                "Skipped creating an incident because the project has no incident severity configured.",
              relatedCriteriaId: input.criteriaInstance.data?.id,
              at: OneUptimeDate.getCurrentDate(),
            });
            continue;
          }

          incident.incidentSeverityId = severity.id!;
        } else {
          incident.incidentSeverityId = criteriaIncident.incidentSeverityId;
        }

        incident.monitors = [input.monitor];
        incident.projectId = input.monitor.projectId!;
        incident.rootCause = seriesRootCause;
        incident.createdStateLog = JSON.parse(
          JSON.stringify(input.dataToProcess, null, 2),
        );

        /*
         * Guard against missing ids — these are optional reference fields and
         * must not crash incident creation (which runs inside the probe /
         * telemetry queue workers). A missing id previously threw
         * "Cannot read properties of undefined (reading 'toString')" and failed
         * the job on every cycle for the affected monitor.
         */
        if (input.criteriaInstance.data?.id) {
          incident.createdCriteriaId =
            input.criteriaInstance.data.id.toString();
        }

        if (criteriaIncident.id) {
          incident.createdIncidentTemplateId = criteriaIncident.id.toString();
        }

        if (seriesFingerprint) {
          incident.seriesFingerprint = seriesFingerprint;
        }
        if (seriesLabels && Object.keys(seriesLabels).length > 0) {
          incident.seriesLabels = seriesLabels;

          await this.linkResourceContextFromSeries({
            incident,
            seriesLabels,
            projectId: input.monitor.projectId!,
          });
        }

        /*
         * Deterministic Proxmox/Ceph cluster link from the monitor's
         * step config (resolved once above). Runs for both grouped and
         * ungrouped incidents and merges with anything the series-label
         * path resolved, so the per-cluster Activity tabs always see
         * monitor-created incidents.
         */
        this.attachClusterContext({ incident, clusterContext });

        incident.onCallDutyPolicies =
          criteriaIncident.onCallPolicyIds?.map((id: ObjectID) => {
            const onCallPolicy: OnCallDutyPolicy = new OnCallDutyPolicy();
            onCallPolicy._id = id.toString();
            return onCallPolicy;
          }) || [];

        // Set labels from criteria
        incident.labels =
          criteriaIncident.labelIds?.map((id: ObjectID) => {
            const label: Label = new Label();
            label._id = id.toString();
            return label;
          }) || [];

        incident.isCreatedAutomatically = true;

        // Set status page visibility (defaults to true if not specified)
        if (criteriaIncident.showIncidentOnStatusPage !== undefined) {
          incident.isVisibleOnStatusPage =
            criteriaIncident.showIncidentOnStatusPage;
        }

        if (criteriaIncident.isPrivate === true) {
          incident.isPrivate = true;
        }

        if (input.props.telemetryQuery) {
          incident.telemetryQuery = input.props.telemetryQuery;
        }

        if (
          input.dataToProcess &&
          (input.dataToProcess as ProbeMonitorResponse).probeId
        ) {
          incident.createdByProbeId = (
            input.dataToProcess as ProbeMonitorResponse
          ).probeId;
        }

        if (criteriaIncident.remediationNotes) {
          incident.remediationNotes = MonitorTemplateUtil.processTemplateString(
            {
              value: criteriaIncident.remediationNotes,
              storageMap,
            },
          );
        }

        if (DisableAutomaticIncidentCreation) {
          input.evaluationSummary?.events.push({
            type: "incident-skipped",
            title: "Incident creation skipped",
            message:
              "Automatic incident creation is disabled by environment configuration.",
            relatedCriteriaId: input.criteriaInstance.data?.id,
            at: OneUptimeDate.getCurrentDate(),
          });
          return;
        }

        const createdIncident: Incident = await IncidentService.create({
          data: incident,
          props: {
            isRoot: true,
          },
        });

        // Add owner teams and users after incident creation
        if (
          criteriaIncident.ownerTeamIds?.length ||
          criteriaIncident.ownerUserIds?.length
        ) {
          await IncidentService.addOwners(
            input.monitor.projectId!,
            createdIncident.id!,
            criteriaIncident.ownerUserIds || [],
            criteriaIncident.ownerTeamIds || [],
            true, // notify owners
            {
              isRoot: true,
            },
          );
        }

        // Add incident member role assignments after incident creation
        if (
          criteriaIncident.incidentMemberRoles &&
          criteriaIncident.incidentMemberRoles.length > 0
        ) {
          for (const roleAssignment of criteriaIncident.incidentMemberRoles) {
            try {
              const assignment: IncidentMemberRoleAssignment =
                roleAssignment as IncidentMemberRoleAssignment;

              if (assignment.roleId && assignment.userId) {
                const incidentMember: IncidentMember = new IncidentMember();
                incidentMember.incidentId = createdIncident.id!;
                incidentMember.projectId = input.monitor.projectId!;
                incidentMember.userId = new ObjectID(
                  assignment.userId.toString(),
                );
                incidentMember.incidentRoleId = new ObjectID(
                  assignment.roleId.toString(),
                );

                await IncidentMemberService.create({
                  data: incidentMember,
                  props: {
                    isRoot: true,
                  },
                });

                logger.debug(
                  `${input.monitor.id?.toString()} - Assigned incident member role ${assignment.roleId.toString()} to user ${assignment.userId.toString()}`,
                  incidentLogAttributes,
                );
              }
            } catch (memberError) {
              logger.error(
                `${input.monitor.id?.toString()} - Failed to assign incident member role: ${memberError}`,
                incidentLogAttributes,
              );
            }
          }
        }

        input.evaluationSummary?.events.push({
          type: "incident-created",
          title: `Incident created: ${createdIncident.title || criteriaIncident.title}`,
          message: `Incident triggered from criteria "${input.criteriaInstance.data?.name || "Unnamed criteria"}".`,
          relatedCriteriaId: input.criteriaInstance.data?.id,
          relatedIncidentId: createdIncident.id?.toString(),
          relatedIncidentNumber: createdIncident.incidentNumber,
          relatedIncidentNumberWithPrefix:
            createdIncident.incidentNumberWithPrefix,
          at: OneUptimeDate.getCurrentDate(),
        });
      }
    }
  }

  /*
   * Pull every host / docker-host / k8s-cluster / proxmox-cluster /
   * ceph-cluster / service identifier out of the series labels and
   * attach the matching project-scoped records to the incident. The
   * label-key → resource-type mapping lives in SeriesResourceLabels
   * (shared with the scheduled-maintenance suppression path so the two
   * never disagree about which labels identify which resource). Lookups
   * are always project-scoped so a stale or hostile stamp can't pull in
   * a record from another tenant.
   */
  private static async linkResourceContextFromSeries(input: {
    incident: Incident;
    seriesLabels: JSONObject;
    projectId: ObjectID;
  }): Promise<void> {
    const refs: SeriesResourceRefs = SeriesResourceLabels.extractResourceRefs(
      input.seriesLabels,
    );

    const [
      resolvedHosts,
      resolvedDockerHosts,
      resolvedPodmanHosts,
      resolvedClusters,
      resolvedServices,
      resolvedProxmoxClusters,
      resolvedCephClusters,
    ] = await Promise.all([
      this.resolveResourceIds({
        ids: refs.hostIds,
        names: refs.hostNames,
        nameColumn: "hostIdentifier",
        projectId: input.projectId,
        findBy: HostService.findBy.bind(HostService),
      }),
      this.resolveResourceIds({
        ids: refs.dockerHostIds,
        names: refs.dockerHostNames,
        nameColumn: "hostIdentifier",
        projectId: input.projectId,
        findBy: DockerHostService.findBy.bind(DockerHostService),
      }),
      this.resolveResourceIds({
        ids: refs.podmanHostIds,
        names: refs.podmanHostNames,
        nameColumn: "hostIdentifier",
        projectId: input.projectId,
        findBy: PodmanHostService.findBy.bind(PodmanHostService),
      }),
      this.resolveResourceIds({
        ids: refs.kubernetesClusterIds,
        names: refs.kubernetesClusterNames,
        nameColumn: "clusterIdentifier",
        projectId: input.projectId,
        findBy: KubernetesClusterService.findBy.bind(KubernetesClusterService),
      }),
      this.resolveResourceIds({
        ids: refs.serviceIds,
        names: refs.serviceNames,
        nameColumn: "name",
        projectId: input.projectId,
        findBy: ServiceService.findBy.bind(ServiceService),
      }),
      this.resolveResourceIds({
        ids: [],
        names: refs.proxmoxClusterNames,
        nameColumn: "name",
        projectId: input.projectId,
        findBy: ProxmoxClusterService.findBy.bind(ProxmoxClusterService),
      }),
      this.resolveResourceIds({
        ids: [],
        names: refs.cephClusterNames,
        nameColumn: "name",
        projectId: input.projectId,
        findBy: CephClusterService.findBy.bind(CephClusterService),
      }),
    ]);

    if (resolvedHosts.length > 0) {
      input.incident.hosts = resolvedHosts.map((id: string): Host => {
        const host: Host = new Host();
        host._id = id;
        return host;
      });
    }
    if (resolvedDockerHosts.length > 0) {
      input.incident.dockerHosts = resolvedDockerHosts.map(
        (id: string): DockerHost => {
          const dockerHost: DockerHost = new DockerHost();
          dockerHost._id = id;
          return dockerHost;
        },
      );
    }
    if (resolvedPodmanHosts.length > 0) {
      input.incident.podmanHosts = resolvedPodmanHosts.map(
        (id: string): PodmanHost => {
          const podmanHost: PodmanHost = new PodmanHost();
          podmanHost._id = id;
          return podmanHost;
        },
      );
    }
    if (resolvedClusters.length > 0) {
      input.incident.kubernetesClusters = resolvedClusters.map(
        (id: string): KubernetesCluster => {
          const cluster: KubernetesCluster = new KubernetesCluster();
          cluster._id = id;
          return cluster;
        },
      );
    }
    if (resolvedServices.length > 0) {
      input.incident.services = resolvedServices.map((id: string): Service => {
        const service: Service = new Service();
        service._id = id;
        return service;
      });
    }
    if (resolvedProxmoxClusters.length > 0) {
      input.incident.proxmoxClusters = resolvedProxmoxClusters.map(
        (id: string): ProxmoxCluster => {
          const cluster: ProxmoxCluster = new ProxmoxCluster();
          cluster._id = id;
          return cluster;
        },
      );
    }
    if (resolvedCephClusters.length > 0) {
      input.incident.cephClusters = resolvedCephClusters.map(
        (id: string): CephCluster => {
          const cluster: CephCluster = new CephCluster();
          cluster._id = id;
          return cluster;
        },
      );
    }
  }

  /*
   * Attach the monitor-step-resolved Proxmox/Ceph cluster ids to the
   * incident, merging with (never overwriting) anything the
   * series-label path already linked. Both paths can resolve the same
   * cluster, so dedupe by id.
   */
  private static attachClusterContext(input: {
    incident: Incident;
    clusterContext: MonitorClusterContext;
  }): void {
    if (input.clusterContext.proxmoxClusterIds.length > 0) {
      const existingIds: Set<string> = new Set<string>(
        (input.incident.proxmoxClusters || []).map(
          (cluster: ProxmoxCluster) => {
            return String(cluster._id);
          },
        ),
      );

      const merged: Array<ProxmoxCluster> = [
        ...(input.incident.proxmoxClusters || []),
      ];

      for (const id of input.clusterContext.proxmoxClusterIds) {
        if (existingIds.has(id)) {
          continue;
        }
        const cluster: ProxmoxCluster = new ProxmoxCluster();
        cluster._id = id;
        merged.push(cluster);
      }

      input.incident.proxmoxClusters = merged;
    }

    if (input.clusterContext.cephClusterIds.length > 0) {
      const existingIds: Set<string> = new Set<string>(
        (input.incident.cephClusters || []).map((cluster: CephCluster) => {
          return String(cluster._id);
        }),
      );

      const merged: Array<CephCluster> = [
        ...(input.incident.cephClusters || []),
      ];

      for (const id of input.clusterContext.cephClusterIds) {
        if (existingIds.has(id)) {
          continue;
        }
        const cluster: CephCluster = new CephCluster();
        cluster._id = id;
        merged.push(cluster);
      }

      input.incident.cephClusters = merged;
    }

    if (input.clusterContext.dockerSwarmClusterIds.length > 0) {
      const existingIds: Set<string> = new Set<string>(
        (input.incident.dockerSwarmClusters || []).map(
          (cluster: DockerSwarmCluster) => {
            return String(cluster._id);
          },
        ),
      );

      const merged: Array<DockerSwarmCluster> = [
        ...(input.incident.dockerSwarmClusters || []),
      ];

      for (const id of input.clusterContext.dockerSwarmClusterIds) {
        if (existingIds.has(id)) {
          continue;
        }
        const cluster: DockerSwarmCluster = new DockerSwarmCluster();
        cluster._id = id;
        merged.push(cluster);
      }

      input.incident.dockerSwarmClusters = merged;
    }

    if (input.clusterContext.iotFleetIds.length > 0) {
      const existingIds: Set<string> = new Set<string>(
        (input.incident.iotFleets || []).map((fleet: IoTFleet) => {
          return String(fleet._id);
        }),
      );

      const merged: Array<IoTFleet> = [...(input.incident.iotFleets || [])];

      for (const id of input.clusterContext.iotFleetIds) {
        if (existingIds.has(id)) {
          continue;
        }
        const fleet: IoTFleet = new IoTFleet();
        fleet._id = id;
        merged.push(fleet);
      }

      input.incident.iotFleets = merged;
    }
  }

  /*
   * Resolve a mix of ids and names to a deduped set of database ids
   * for one resource type, project-scoped. Either or both lists may
   * be empty; if both are empty the method short-circuits with no DB
   * round-trip.
   */
  private static async resolveResourceIds(input: {
    ids: Array<string>;
    names: Array<string>;
    nameColumn: string;
    projectId: ObjectID;
    /*
     * Loosely typed because the three resource services (Host,
     * DockerHost, KubernetesCluster) each have their own
     * `Query<TBaseModel>` shape and we deliberately abstract over
     * them. We only need the row's `_id` back, which every model
     * exposes via `DatabaseBaseModel`.
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    findBy: (args: any) => Promise<Array<{ _id?: string | undefined }>>;
  }): Promise<Array<string>> {
    if (input.ids.length === 0 && input.names.length === 0) {
      return [];
    }

    const resolved: Set<string> = new Set<string>();

    const lookups: Array<Promise<Array<{ _id?: string | undefined }>>> = [];
    if (input.ids.length > 0) {
      lookups.push(
        input.findBy({
          query: {
            projectId: input.projectId,
            _id: new Includes(input.ids),
          },
          select: { _id: true },
          skip: 0,
          limit: LIMIT_PER_PROJECT,
          props: { isRoot: true },
        }),
      );
    }
    if (input.names.length > 0) {
      lookups.push(
        input.findBy({
          query: {
            projectId: input.projectId,
            [input.nameColumn]: new Includes(input.names),
          },
          select: { _id: true },
          skip: 0,
          limit: LIMIT_PER_PROJECT,
          props: { isRoot: true },
        }),
      );
    }

    const buckets: Array<Array<{ _id?: string | undefined }>> =
      await Promise.all(lookups);
    for (const bucket of buckets) {
      for (const row of bucket) {
        if (row._id) {
          resolved.add(String(row._id));
        }
      }
    }
    return Array.from(resolved);
  }

  private static async resolveOpenIncident(input: {
    openIncident: Incident;
    rootCause: string;
    dataToProcess:
      | ProbeMonitorResponse
      | IncomingMonitorRequest
      | DataToProcess;
  }): Promise<void> {
    const resolvedStateId: ObjectID =
      await IncidentStateTimelineService.getResolvedStateIdForProject(
        input.openIncident.projectId!,
      );

    const incidentStateTimeline: IncidentStateTimeline =
      new IncidentStateTimeline();
    incidentStateTimeline.incidentId = input.openIncident.id!;
    incidentStateTimeline.incidentStateId = resolvedStateId;
    incidentStateTimeline.projectId = input.openIncident.projectId!;

    if (input.rootCause) {
      incidentStateTimeline.rootCause =
        "Incident autoresolved because autoresolve is set to true in monitor criteria. " +
        input.rootCause;
    }

    if (input.dataToProcess) {
      incidentStateTimeline.stateChangeLog = JSON.parse(
        JSON.stringify(input.dataToProcess),
      );
    }

    try {
      await IncidentStateTimelineService.create({
        data: incidentStateTimeline,
        props: {
          isRoot: true,
        },
      });
    } catch (err) {
      /*
       * Idempotent concurrency race: two probe/ingest results for the same monitor
       * can both decide to auto-resolve the same open incident near-simultaneously.
       * The loser's IncidentStateTimelineService.onBeforeCreate dedupe check throws
       * this exact BadDataException (incident is already in the resolved state).
       * Treat as a no-op at debug level instead of failing the job and logging a
       * full ERROR stack. Match the exact message so unrelated BadDataExceptions
       * (e.g. state-order validation) still propagate.
       */
      if (
        err instanceof BadDataException &&
        err.message === "Incident state cannot be same as previous state."
      ) {
        logger.debug(
          `${input.openIncident.id?.toString()} - Incident already in resolved state; skipping duplicate state timeline (concurrent race).`,
        );
      } else {
        throw err;
      }
    }
  }

  private static shouldCloseIncident(input: {
    openIncident: Incident;
    autoResolveCriteriaInstanceIdIncidentIdsDictionary: Dictionary<
      Array<string>
    >;
    criteriaInstance: MonitorCriteriaInstance | null; // null if no criteia met.
    breachingSeriesFingerprints?: Set<string> | undefined;
    disableSeriesAbsenceResolution?: boolean | undefined;
  }): boolean {
    const openSeriesFingerprint: string | undefined =
      input.openIncident.seriesFingerprint || undefined;

    /*
     * Event-driven (incoming-request / webhook) per-key incidents must
     * NEVER be resolved by absence — only explicitly, via
     * resolveSeriesIncidentsByFingerprint, when the payload reports the
     * key as recovered. A single webhook describes only the keys in its
     * own payload, so neither the per-series breaching-set path nor the
     * legacy cross-criteria path below may close a series incident here.
     * Without this guard, a heartbeat-timeout cron tick or a webhook that
     * the grouping criteria rejects would bulk-resolve all open per-key
     * incidents by absence.
     */
    if (input.disableSeriesAbsenceResolution && openSeriesFingerprint) {
      return false;
    }

    /*
     * Per-series auto-resolve: when the monitor emits a breaching-
     * series set and this open incident has a fingerprint, resolve
     * whenever the fingerprint is no longer in the set — regardless
     * of whether some *other* series is still breaching the same
     * criteria. This is the whole point of per-host incidents.
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

      /*
       * Series no longer breaching. Only auto-close if the criteria
       * was configured to auto-resolve in the first place; otherwise
       * stay open so a human can acknowledge.
       */
      if (!input.openIncident.createdCriteriaId?.toString()) {
        return false;
      }

      if (!input.openIncident.createdIncidentTemplateId?.toString()) {
        return false;
      }

      const autoResolveTemplates: Array<string> | undefined =
        input.autoResolveCriteriaInstanceIdIncidentIdsDictionary[
          input.openIncident.createdCriteriaId.toString()
        ];

      if (
        autoResolveTemplates &&
        autoResolveTemplates.includes(
          input.openIncident.createdIncidentTemplateId.toString(),
        )
      ) {
        return true;
      }

      return false;
    }

    if (
      input.openIncident.createdCriteriaId?.toString() ===
      input.criteriaInstance?.data?.id?.toString()
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
        ]?.includes(input.openIncident.createdIncidentTemplateId?.toString())
      ) {
        return true;
      }
    }

    return false;
  }
}
