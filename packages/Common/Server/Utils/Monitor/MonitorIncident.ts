import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import IncidentStateTimeline from "../../../Models/DatabaseModels/IncidentStateTimeline";
import IncidentMember from "../../../Models/DatabaseModels/IncidentMember";
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
import { DisableAutomaticIncidentCreation } from "../../EnvironmentConfig";
import IncidentService from "../../Services/IncidentService";
import IncidentSeverityService from "../../Services/IncidentSeverityService";
import ProjectScopedReferenceValidator from "../Database/ProjectScopedReferenceValidator";
import IncidentStateTimelineService from "../../Services/IncidentStateTimelineService";
import IncidentMemberService from "../../Services/IncidentMemberService";
import NetworkDeviceOwnerUserService, {
  NetworkDeviceOwners,
} from "../../Services/NetworkDeviceOwnerUserService";
import logger, { LogAttributes } from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";
import DataToProcess from "./DataToProcess";
import MonitorTemplateUtil from "./MonitorTemplateUtil";
import SeriesContextEnricher from "./SeriesContextEnricher";
import MonitorDependencySuppression, {
  DependencySuppressionResult,
} from "./MonitorDependencySuppression";
import { JSONObject } from "../../../Types/JSON";
import OneUptimeDate from "../../../Types/Date";
import MonitorEvaluationSummary from "../../../Types/Monitor/MonitorEvaluationSummary";
import MonitorSummarySnapshot from "../../../Types/Monitor/MonitorSummarySnapshot";
import MonitorSummarySnapshotUtil from "../../../Utils/Monitor/MonitorSummarySnapshotUtil";
import { IncidentMemberRoleAssignment } from "../../../Types/Monitor/CriteriaIncident";
import { PerSeriesCriteriaMatch } from "../../../Types/Probe/ProbeApiIngestResponse";
import MonitorResourceContextUtil from "./MonitorResourceContext";
import SeriesResourceLinker, {
  SeriesResolvedResourceIds,
} from "./SeriesResourceLinker";

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
     * The breaching fingerprints of EACH criteria evaluated on this
     * tick, keyed by criteria id — a criteria that ran and matched
     * nothing maps to an empty set.
     *
     * Without this, "is this series still breaching?" was answered from
     * the winning criteria's set alone, so a host held critical by
     * criteria A silently auto-resolved another host's still-valid
     * incident from criteria B. A criteria absent from this dictionary
     * was not evaluated at all, and its open incidents are left alone.
     */
    breachingSeriesFingerprintsByCriteriaId?:
      | Dictionary<Set<string>>
      | undefined;
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

    const resolvedIncidentIds: Set<string> = new Set<string>();

    for (const openIncident of openIncidents) {
      const shouldClose: boolean = this.shouldCloseIncident({
        openIncident,
        autoResolveCriteriaInstanceIdIncidentIdsDictionary:
          input.autoResolveCriteriaInstanceIdIncidentIdsDictionary,
        criteriaInstance: input.criteriaInstance,
        breachingSeriesFingerprints: input.breachingSeriesFingerprints,
        breachingSeriesFingerprintsByCriteriaId:
          input.breachingSeriesFingerprintsByCriteriaId,
        disableSeriesAbsenceResolution: input.disableSeriesAbsenceResolution,
      });

      if (shouldClose) {
        resolvedIncidentIds.add(openIncident.id!.toString());

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

    /*
     * Return the incidents still open AFTER this pass. The create path
     * dedupes against this list, and an incident this pass just resolved
     * must not count as "already active" — that combination resolved a
     * stale whole-monitor incident and then refused to create the
     * per-series incidents meant to replace it.
     */
    if (resolvedIncidentIds.size === 0) {
      return openIncidents;
    }

    return openIncidents.filter((openIncident: Incident) => {
      return !resolvedIncidentIds.has(openIncident.id!.toString());
    });
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
    /**
     * The Monitor Summary as it stood at this evaluation, captured by
     * MonitorSummaryCapture before this call. Stored on every incident
     * created below so the incident page can render the same card the
     * monitor page shows, long after the monitor log has aged out.
     */
    monitorSummary?: MonitorSummarySnapshot | null | undefined;
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
     * The still-open incidents, when the caller has already run the
     * resolve pass itself.
     *
     * A single evaluation can fan out across several matching criteria
     * (host A critical while host B is only warning). The resolve pass
     * has to run exactly once, with every criteria's breaching set in
     * hand — running it once per criteria would let each criteria
     * absence-resolve the others' incidents. So MonitorResource runs it
     * up front and hands the survivors here.
     */
    openIncidents?: Array<Incident> | undefined;
    /**
     * Per-criteria breaching fingerprints, forwarded to the resolve pass
     * when this method runs it itself. See
     * checkOpenIncidentsAndCloseIfResolved.
     */
    breachingSeriesFingerprintsByCriteriaId?:
      | Dictionary<Set<string>>
      | undefined;
    /**
     * Series fingerprints whose underlying resource (host, docker host,
     * kubernetes cluster, or service) is inside an ongoing scheduled
     * maintenance window. The monitor itself keeps evaluating — it is
     * not attached to the maintenance — but incidents for these series
     * are suppressed at creation time. See MonitorMaintenanceSuppression.
     */
    suppressedSeriesFingerprints?: Set<string> | undefined;
    /**
     * Alert-dependency suppression: when set and isSuppressed, a parent
     * monitor this monitor depends on is currently in a suppressing
     * status, so ALL incident creation for this evaluation is skipped.
     * Only creation — already-open incidents still follow the normal
     * resolve path above. See MonitorDependencySuppression.
     */
    dependencySuppression?: DependencySuppressionResult | undefined;
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
     */
    const breachingSeriesFingerprints: Set<string> | undefined =
      input.matchesPerSeries && !input.disableSeriesAbsenceResolution
        ? new Set<string>(
            input.matchesPerSeries.map((m: PerSeriesCriteriaMatch) => {
              return m.fingerprint;
            }),
          )
        : undefined;

    // check active incidents and if there are open incidents, do not cretae anothr incident.
    const openIncidents: Array<Incident> =
      input.openIncidents !== undefined
        ? input.openIncidents
        : await this.checkOpenIncidentsAndCloseIfResolved({
            monitorId: input.monitor.id!,
            autoResolveCriteriaInstanceIdIncidentIdsDictionary:
              input.autoResolveCriteriaInstanceIdIncidentIdsDictionary,
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

    if (!input.criteriaInstance.data?.createIncidents) {
      return;
    }

    /*
     * Checked once, up front. It used to be tested deep inside the
     * template x series loops with a `return`, which on a grouped
     * monitor abandoned every series after the first.
     */
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

    /*
     * Alert-dependency suppression: a parent monitor is in a suppressing
     * status (offline by default), so skip creating any incident for this
     * evaluation. Placed after the open-incident resolve pass above on
     * purpose — an incident raised before the parent went down must still
     * resolve normally; only new creation is silenced.
     */
    if (input.dependencySuppression?.isSuppressed) {
      const suppressionReason: string =
        MonitorDependencySuppression.buildSuppressionReason(
          input.dependencySuppression.suppressingParents,
        );

      logger.debug(
        `${input.monitor.id?.toString()} - Skipping incident creation: ${suppressionReason}.`,
        incidentLogAttributes,
      );

      input.evaluationSummary?.events.push({
        type: "incident-skipped",
        title: "Incident suppressed by monitor dependency",
        message: `Skipped creating incidents because ${suppressionReason}. This monitor's status still updates normally; open incidents still auto-resolve.`,
        relatedCriteriaId: input.criteriaInstance.data?.id,
        at: OneUptimeDate.getCurrentDate(),
      });

      return;
    }

    /*
     * Resolve the resources this monitor's own config names — its host,
     * cluster, fleet, telemetry services, or the resource its metric
     * filters scope it to — once per evaluation, so every incident
     * created below is attached to them. Series labels cannot supply
     * this: they only exist for grouped criteria, and most monitors
     * (every shipped Host/Docker/Podman template, all Logs/Traces/
     * Exceptions monitors) are ungrouped. No-op, and no round-trip, for
     * monitor types whose config names no resource.
     */
    const resourceContext: SeriesResolvedResourceIds =
      await MonitorResourceContextUtil.resolveResourceContextForMonitor({
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

    /*
     * Owners of the network device this monitor watches (if any), resolved
     * lazily on first incident creation and reused for the rest of the
     * evaluation — the device is configured per monitor step, so it is
     * constant across the criteria/series loops below. Merged into every
     * created incident's owners alongside the criteria-configured ones.
     */
    let networkDeviceOwners: NetworkDeviceOwners | null = null;

    for (const criteriaIncident of input.criteriaInstance.data?.incidents ||
      []) {
      for (const seriesMatch of seriesToProcess) {
        try {
          const seriesFingerprint: string | undefined =
            seriesMatch?.fingerprint;
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

          /*
           * Render the criteria's template, then make it say WHICH
           * series it is about. Mirrors MonitorAlert exactly - the two
           * must agree, or the same breach reads differently depending
           * on whether the criteria was configured to raise an alert or
           * an incident. See SeriesContextEnricher for why this is not
           * done inside the template itself.
           */
          incident.title = SeriesContextEnricher.enrichTitle({
            title: MonitorTemplateUtil.processTemplateString({
              value: criteriaIncident.title,
              storageMap,
            }),
            seriesLabels,
          });
          incident.description = SeriesContextEnricher.enrichDescription({
            description: MonitorTemplateUtil.processTemplateString({
              value: criteriaIncident.description,
              storageMap,
            }),
            seriesLabels,
            monitorType: input.monitor.monitorType,
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
          /*
           * A criteria severity that belongs to *another* project is rejected by
           * IncidentService on create. Throwing here would fail the whole
           * probe/telemetry ingest job for this monitor — no incident, and no
           * payload or monitor log persisted either, because those run after the
           * create. Treat it as "missing" and fall back to this project's own
           * default, which is also what stops the bad id spreading onto new
           * incidents. monitorSteps can still hold one: the 1785240000000
           * repair skipped ids it could not resolve.
           */
          const isCriteriaSeverityUsable: boolean =
            await ProjectScopedReferenceValidator.isUsableInProject({
              projectId: input.monitor.projectId!,
              id: criteriaIncident.incidentSeverityId,
              service: IncidentSeverityService,
            });

          if (
            criteriaIncident.incidentSeverityId?.toString() &&
            !isCriteriaSeverityUsable
          ) {
            logger.error(
              `${input.monitor.id?.toString()} - Criteria "${
                input.criteriaInstance.data?.name
              }" references incident severity ${criteriaIncident.incidentSeverityId.toString()}, which does not belong to project ${input.monitor.projectId?.toString()}. Falling back to this project's default severity.`,
            );
          }

          if (!isCriteriaSeverityUsable) {
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
            incident.incidentSeverityId = criteriaIncident.incidentSeverityId!;
          }

          incident.monitors = [input.monitor];
          incident.projectId = input.monitor.projectId!;
          incident.rootCause = seriesRootCause;
          incident.createdStateLog = JSON.parse(
            JSON.stringify(input.dataToProcess, null, 2),
          );

          /*
           * Same capture on every incident this evaluation opens - they all
           * came from the one check.
           */
          const serializedMonitorSummary: JSONObject | null =
            MonitorSummarySnapshotUtil.serialize(input.monitorSummary);

          if (serializedMonitorSummary) {
            incident.monitorSummary = serializedMonitorSummary;
          }

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

            await SeriesResourceLinker.linkSeriesResourcesToModel({
              model: incident,
              seriesLabels,
              projectId: input.monitor.projectId!,
              monitorType: input.monitor.monitorType,
            });
          }

          /*
           * Deterministic resource link from the monitor's step config
           * (resolved once above). Runs for both grouped and ungrouped
           * incidents and merges with anything the series-label path
           * resolved, so the per-resource Activity tabs always see
           * monitor-created incidents.
           */
          SeriesResourceLinker.attachResolvedResources({
            model: incident,
            resolved: resourceContext,
          });

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
            incident.remediationNotes =
              MonitorTemplateUtil.processTemplateString({
                value: criteriaIncident.remediationNotes,
                storageMap,
              });
          }

          const createdIncident: Incident = await IncidentService.create({
            data: incident,
            props: {
              isRoot: true,
            },
          });

          /*
           * Add owner teams and users after incident creation. Owners
           * configured on the criteria template are merged (deduped) with the
           * owners of the network device this monitor watches, so device
           * ownership flows into the incidents its monitor raises.
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
            criteriaIncident.ownerUserIds || [],
            networkDeviceOwners.ownerUserIds,
          );

          const ownerTeamIds: Array<ObjectID> = this.mergeOwnerIds(
            criteriaIncident.ownerTeamIds || [],
            networkDeviceOwners.ownerTeamIds,
          );

          if (ownerTeamIds.length || ownerUserIds.length) {
            await IncidentService.addOwners(
              input.monitor.projectId!,
              createdIncident.id!,
              ownerUserIds,
              ownerTeamIds,
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
        } catch (err) {
          /*
           * One series must not take the rest of the fleet down with it.
           * Everything in this loop happens per host/container/key and
           * touches the database; an error thrown from here used to
           * propagate out of MonitorResource (which has no catch, only a
           * `finally` that releases the lock) and abandon every series
           * after the failing one, plus the monitor log for the tick.
           */
          logger.error(
            `${input.monitor.id?.toString()} - Failed to create incident${
              seriesMatch?.fingerprint
                ? ` for series ${seriesMatch.fingerprint}`
                : ""
            }.`,
          );
          logger.error(err);

          input.evaluationSummary?.events.push({
            type: "incident-skipped",
            title: "Incident creation failed",
            message: `Could not create an incident${
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

  /**
   * Is `openIncident`'s series still breaching the criteria that raised
   * it?
   *
   * Prefers the per-criteria dictionary, which answers the question for
   * the criteria that actually owns this incident. The single-set
   * fallback only knows the winning criteria's breaches, so it has to
   * approximate with `createIncidents` — a criteria that creates no
   * incidents is a recovery criteria whose "matches" are healthy series,
   * and counting those as breaches would pin an offline incident open
   * forever.
   */
  private static isSeriesStillBreaching(input: {
    openIncident: Incident;
    criteriaInstance: MonitorCriteriaInstance | null;
    openSeriesFingerprint: string;
    breachingSeriesFingerprints: Set<string>;
    breachingSeriesFingerprintsByCriteriaId?:
      | Dictionary<Set<string>>
      | undefined;
  }): boolean {
    const owningCriteriaId: string | undefined =
      input.openIncident.createdCriteriaId?.toString() || undefined;

    if (input.breachingSeriesFingerprintsByCriteriaId && owningCriteriaId) {
      return Boolean(
        input.breachingSeriesFingerprintsByCriteriaId[owningCriteriaId]?.has(
          input.openSeriesFingerprint,
        ),
      );
    }

    const matchedCriteriaCreatesIncidents: boolean =
      input.criteriaInstance?.data?.createIncidents === true;

    return (
      matchedCriteriaCreatesIncidents &&
      input.breachingSeriesFingerprints.has(input.openSeriesFingerprint)
    );
  }

  private static wasCriteriaEvaluated(input: {
    openIncident: Incident;
    breachingSeriesFingerprintsByCriteriaId: Dictionary<Set<string>>;
  }): boolean {
    const owningCriteriaId: string | undefined =
      input.openIncident.createdCriteriaId?.toString() || undefined;

    if (!owningCriteriaId) {
      return true;
    }

    return (
      input.breachingSeriesFingerprintsByCriteriaId[owningCriteriaId] !==
      undefined
    );
  }

  /**
   * Did the criteria that raised this incident opt into auto-resolve for
   * the template that raised it?
   *
   * An incident whose `createdIncidentTemplateId` is missing (legacy or
   * API-authored criteria whose template carries no id) is matched
   * against the criteria as a whole. Requiring an exact template id
   * there meant such an incident could never auto-resolve — and, because
   * it stayed open, its criteria could never raise a new one either.
   */
  private static isAutoResolveConfiguredForIncident(input: {
    openIncident: Incident;
    autoResolveCriteriaInstanceIdIncidentIdsDictionary: Dictionary<
      Array<string>
    >;
  }): boolean {
    const createdCriteriaId: string | undefined =
      input.openIncident.createdCriteriaId?.toString() || undefined;

    if (!createdCriteriaId) {
      return false;
    }

    const autoResolveTemplates: Array<string> | undefined =
      input.autoResolveCriteriaInstanceIdIncidentIdsDictionary[
        createdCriteriaId
      ];

    if (!autoResolveTemplates || autoResolveTemplates.length === 0) {
      return false;
    }

    const createdTemplateId: string | undefined =
      input.openIncident.createdIncidentTemplateId?.toString() || undefined;

    if (!createdTemplateId) {
      return true;
    }

    return autoResolveTemplates.includes(createdTemplateId);
  }

  private static shouldCloseIncident(input: {
    openIncident: Incident;
    autoResolveCriteriaInstanceIdIncidentIdsDictionary: Dictionary<
      Array<string>
    >;
    criteriaInstance: MonitorCriteriaInstance | null; // null if no criteia met.
    breachingSeriesFingerprints?: Set<string> | undefined;
    breachingSeriesFingerprintsByCriteriaId?:
      | Dictionary<Set<string>>
      | undefined;
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

    // Per-series mode: this evaluation knows which series are breaching.
    if (input.breachingSeriesFingerprints !== undefined) {
      /*
       * A whole-monitor incident (no fingerprint) on a monitor that now
       * raises incidents per series. It was raised before the monitor
       * was grouped, and nothing can ever dedupe against it again —
       * every incident from here on carries a fingerprint. Left alone it
       * stays open forever while its replacements come and go. Resolve
       * it, on the same auto-resolve terms as any other incident from
       * its criteria.
       */
      if (!openSeriesFingerprint) {
        if (input.disableSeriesAbsenceResolution) {
          return false;
        }

        return MonitorIncident.isAutoResolveConfiguredForIncident({
          openIncident: input.openIncident,
          autoResolveCriteriaInstanceIdIncidentIdsDictionary:
            input.autoResolveCriteriaInstanceIdIncidentIdsDictionary,
        });
      }

      /*
       * Per-series auto-resolve: resolve whenever this fingerprint is no
       * longer breaching the criteria that raised it — regardless of
       * whether some *other* series is still breaching. That is the
       * whole point of per-host incidents.
       */
      if (
        MonitorIncident.isSeriesStillBreaching({
          openIncident: input.openIncident,
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
       * The criteria that raised this incident was not evaluated on this
       * tick at all (disabled, deleted, or the monitor stops at its
       * first match). Absence of a breaching set for it is not evidence
       * of recovery, so leave the incident alone.
       */
      if (
        input.breachingSeriesFingerprintsByCriteriaId &&
        !MonitorIncident.wasCriteriaEvaluated({
          openIncident: input.openIncident,
          breachingSeriesFingerprintsByCriteriaId:
            input.breachingSeriesFingerprintsByCriteriaId,
        })
      ) {
        return false;
      }

      /*
       * Series no longer breaching. Only auto-close if the criteria was
       * configured to auto-resolve in the first place; otherwise stay
       * open so a human can acknowledge.
       */
      return MonitorIncident.isAutoResolveConfiguredForIncident({
        openIncident: input.openIncident,
        autoResolveCriteriaInstanceIdIncidentIdsDictionary:
          input.autoResolveCriteriaInstanceIdIncidentIdsDictionary,
      });
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
