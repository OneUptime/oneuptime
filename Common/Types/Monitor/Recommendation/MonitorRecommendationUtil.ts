import ObjectID from "../../ObjectID";
import MetricsViewConfig from "../../Metrics/MetricsViewConfig";
import MetricQueryConfigData from "../../Metrics/MetricQueryConfigData";
import MetricFormulaConfigData from "../../Metrics/MetricFormulaConfigData";
import MonitorStep from "../MonitorStep";
import MonitorSteps from "../MonitorSteps";
import MonitorCriteriaInstance from "../MonitorCriteriaInstance";
import { CriteriaIncident } from "../CriteriaIncident";
import { CriteriaAlert } from "../CriteriaAlert";
import MonitorRecommendationSeverityMapper from "./MonitorRecommendationSeverityMapper";
import {
  MonitorRecommendation,
  MonitorRecommendationArgs,
  MonitorRecommendationNotificationMode,
  MonitorRecommendationNotificationSettings,
  MonitorRecommendationSeverity,
} from "./MonitorRecommendationTypes";

/*
 * The structural slice of every recommendation-capable step config this
 * module reads.
 *
 * Infrastructure configs carry a metric view plus a named resource
 * identifier. RUM uses generic metric, trace and exception configs, where the
 * application id lives in `telemetryServiceIds`. The optional fields below are
 * the stable query inputs that distinguish those shapes.
 */
interface RecommendationMonitorStepConfig {
  clusterIdentifier?: string | undefined;
  hostIdentifier?: string | undefined;
  fleetIdentifier?: string | undefined;
  telemetryServiceIds?: Array<ObjectID | string> | undefined;
  metricViewConfig?: MetricsViewConfig | undefined;
  rollingTime?: unknown;
  attributes?: Record<string, unknown> | undefined;
  spanStatuses?: Array<unknown> | undefined;
  spanName?: string | undefined;
  entityKeys?: Array<string> | undefined;
  lastXSecondsOfSpans?: number | undefined;
  exceptionTypes?: Array<string> | undefined;
  message?: string | undefined;
  includeResolved?: boolean | undefined;
  includeArchived?: boolean | undefined;
  lastXSecondsOfExceptions?: number | undefined;
}

/*
 * What uniquely identifies "this alert is already being watched", derived
 * from a monitor step rather than from the monitor's name.
 *
 * Name matching was the obvious alternative and is wrong: renaming a monitor
 * would make an already-created recommendation reappear as un-created, and
 * two different templates on the same resource can be renamed into collision.
 * What a step actually WATCHES is the right identity, and every component
 * below is deterministic per template.
 *
 * The first version of this used only (resourceIdentifier, metricNames,
 * formulas), which turned out to be far too coarse: thirteen groups of
 * genuinely different templates fingerprinted identically. Eight of the Ceph
 * templates all query the single metric `ceph_health_detail` and differ only
 * by the health-check name they filter on, so creating "Ceph Daemon Crash"
 * marked four unrelated recommendations — clock skew, OSD nearfull,
 * backfillfull, full — as "already created" and silently hid four real
 * monitoring gaps. "Cluster Near Full" hid "Cluster Full" the same way. The
 * failure is invisible by construction: the cards render as handled.
 *
 * So the fingerprint now carries everything that distinguishes one shipped
 * template from another:
 *
 *   configKind        which recommendation config the step carries. Docker,
 *                     Docker Swarm and Podman ship byte-identical metric sets
 *                     ("container.cpu.utilization"), and while the page never
 *                     mixes resource types today, nothing in this function
 *                     enforced that.
 *   metricAliases     the per-query variable name. Author-chosen per template
 *                     ("recent_crash", "mon_clock_skew"), and the thing the
 *                     criteria filters actually reference.
 *   queryAttributes   the attribute filter on each query, e.g.
 *                     { name: "PG_DAMAGED" } — the only difference between
 *                     several Ceph health-detail templates.
 *   criteriaFilters   the thresholds. The last resort, and the only thing that
 *                     separates "near full" (85%) from "full" (95%).
 *   configValues      non-metric query inputs such as a trace status, exception
 *                     filter, lookback window, or metric rolling window.
 *
 * Including thresholds has a cost worth stating: retuning a created monitor
 * from 90% to 85% makes its recommendation resurface as not-yet-created. That
 * is the correct reading — the monitor no longer watches what the
 * recommendation describes — it is visible, and it is dismissable. Silently
 * hiding a Critical recommendation is neither.
 *
 * Existing monitors keep matching: none of these components is touched by the
 * notification settings the create flow writes, so a monitor created before
 * this change still fingerprints to its own template.
 */
export interface MonitorRecommendationFingerprint {
  resourceIdentifier: string;
  configKind: string;
  metricNames: Array<string>;
  formulas: Array<string>;
  metricAliases: Array<string>;
  queryAttributes: Array<string>;
  criteriaFilters: Array<string>;
  configValues: Array<string>;
}

export default class MonitorRecommendationUtil {
  /*
   * Deterministic monitor name for a recommendation applied to a resource.
   *
   * Used both as the created monitor's name and as the `monitorName` arg the
   * template modules interpolate into their incident/alert titles.
   */
  public static getMonitorName(data: {
    recommendation: MonitorRecommendation;
    resourceDisplayName: string;
  }): string {
    const resourceName: string = data.resourceDisplayName.trim();

    if (!resourceName) {
      return data.recommendation.name;
    }

    return `${resourceName} - ${data.recommendation.name}`;
  }

  /*
   * Push the user's chosen on-call policies, owners, labels, severities and
   * incident-vs-alert choice into every criteria instance in a step.
   *
   * This is the whole reason the create form asks for on-call policies: every
   * shipped template hardcodes `onCallPolicyIds: []`, so a template-created
   * monitor would open incidents that page nobody. Templates are the source
   * of the thresholds; this is the source of "who hears about it, how loudly,
   * and through which record".
   *
   * `severity` is the RECOMMENDATION's severity (`Critical` / `Warning`), not
   * a project severity. It selects which project severity to write, via the
   * caller's mapping — see `MonitorRecommendationSeverityMapper`.
   *
   * Mutates and returns the step (the step was just built by the template and
   * is not shared with anything else).
   */
  public static applyNotificationSettingsToMonitorStep(data: {
    monitorStep: MonitorStep;
    notificationSettings: MonitorRecommendationNotificationSettings;
    severity: MonitorRecommendationSeverity;
  }): MonitorStep {
    const settings: MonitorRecommendationNotificationSettings =
      data.notificationSettings;

    const incidentSeverityId: ObjectID | undefined =
      MonitorRecommendationSeverityMapper.resolveSeverityId({
        severity: data.severity,
        severityMap: settings.incidentSeverityIdBySeverity,
      });

    const alertSeverityId: ObjectID | undefined =
      MonitorRecommendationSeverityMapper.resolveSeverityId({
        severity: data.severity,
        severityMap: settings.alertSeverityIdBySeverity,
      });

    const criteriaInstances: Array<MonitorCriteriaInstance> =
      data.monitorStep.data?.monitorCriteria?.data
        ?.monitorCriteriaInstanceArray || [];

    for (const criteriaInstance of criteriaInstances) {
      if (!criteriaInstance.data) {
        continue;
      }

      for (const incident of criteriaInstance.data.incidents || []) {
        this.applyToCriteriaIncident(incident, settings, incidentSeverityId);
      }

      for (const alert of criteriaInstance.data.alerts || []) {
        this.applyToCriteriaAlert(alert, settings, alertSeverityId);
      }

      this.applyNotificationModeToCriteriaInstance(
        criteriaInstance,
        settings.notificationMode,
      );
    }

    return data.monitorStep;
  }

  /*
   * Turn the user's Alert / Incident / Both choice into the two flags the
   * monitor evaluator actually reads (`MonitorIncident.ts` and
   * `MonitorAlert.ts` both early-return unless the flag is true).
   *
   * Two things this deliberately does NOT do:
   *
   *   1. It never flips a flag on a criteria instance whose corresponding
   *      array is empty. Every template ships a "Healthy" recovery criteria
   *      with `incidents: []` and `createIncidents: false`; setting the flag
   *      there would mark it as incident-creating, which the auto-resolve path
   *      reads as "this criteria contributes breaches" and would stop
   *      recovered monitors from resolving their own incidents.
   *
   *   2. It never empties the arrays of the mode that was NOT chosen. The
   *      config stays on the monitor, inert, exactly like the monitor criteria
   *      form's own toggles behave — so a user who later decides they do want
   *      incidents flips one switch on the monitor instead of re-authoring the
   *      incident title, description and severity.
   */
  private static applyNotificationModeToCriteriaInstance(
    criteriaInstance: MonitorCriteriaInstance,
    notificationMode: MonitorRecommendationNotificationMode | undefined,
  ): void {
    if (!notificationMode || !criteriaInstance.data) {
      return;
    }

    const shouldCreateIncidents: boolean =
      notificationMode === MonitorRecommendationNotificationMode.Incident ||
      notificationMode === MonitorRecommendationNotificationMode.Both;

    const shouldCreateAlerts: boolean =
      notificationMode === MonitorRecommendationNotificationMode.Alert ||
      notificationMode === MonitorRecommendationNotificationMode.Both;

    if ((criteriaInstance.data.incidents || []).length > 0) {
      criteriaInstance.data.createIncidents = shouldCreateIncidents;
    }

    if ((criteriaInstance.data.alerts || []).length > 0) {
      criteriaInstance.data.createAlerts = shouldCreateAlerts;
    }
  }

  private static applyToCriteriaIncident(
    incident: CriteriaIncident,
    settings: MonitorRecommendationNotificationSettings,
    incidentSeverityId: ObjectID | undefined,
  ): void {
    if (settings.onCallPolicyIds && settings.onCallPolicyIds.length > 0) {
      incident.onCallPolicyIds = [...settings.onCallPolicyIds];
    }

    if (settings.labelIds && settings.labelIds.length > 0) {
      incident.labelIds = [...settings.labelIds];
    }

    if (settings.ownerTeamIds && settings.ownerTeamIds.length > 0) {
      incident.ownerTeamIds = [...settings.ownerTeamIds];
    }

    if (settings.ownerUserIds && settings.ownerUserIds.length > 0) {
      incident.ownerUserIds = [...settings.ownerUserIds];
    }

    if (incidentSeverityId) {
      incident.incidentSeverityId = incidentSeverityId;
    }
  }

  private static applyToCriteriaAlert(
    alert: CriteriaAlert,
    settings: MonitorRecommendationNotificationSettings,
    alertSeverityId: ObjectID | undefined,
  ): void {
    if (settings.onCallPolicyIds && settings.onCallPolicyIds.length > 0) {
      alert.onCallPolicyIds = [...settings.onCallPolicyIds];
    }

    if (settings.labelIds && settings.labelIds.length > 0) {
      alert.labelIds = [...settings.labelIds];
    }

    if (settings.ownerTeamIds && settings.ownerTeamIds.length > 0) {
      alert.ownerTeamIds = [...settings.ownerTeamIds];
    }

    if (settings.ownerUserIds && settings.ownerUserIds.length > 0) {
      alert.ownerUserIds = [...settings.ownerUserIds];
    }

    if (alertSeverityId) {
      alert.alertSeverityId = alertSeverityId;
    }
  }

  /*
   * Build the complete `MonitorSteps` for one recommendation, ready to hang
   * off a `Monitor` and POST.
   *
   * `defaultMonitorStatusId` is separate from the online/offline ids in
   * `args` because `MonitorSteps.getValidationError` requires it and the
   * template modules never set it — they only produce the inner step.
   */
  public static buildMonitorSteps(data: {
    recommendation: MonitorRecommendation;
    args: MonitorRecommendationArgs;
    defaultMonitorStatusId: ObjectID;
    notificationSettings?:
      | MonitorRecommendationNotificationSettings
      | undefined;
  }): MonitorSteps {
    const monitorStep: MonitorStep = data.recommendation.getMonitorStep(
      data.args,
    );

    if (data.notificationSettings) {
      this.applyNotificationSettingsToMonitorStep({
        monitorStep: monitorStep,
        notificationSettings: data.notificationSettings,
        severity: data.recommendation.severity,
      });
    }

    const monitorSteps: MonitorSteps = new MonitorSteps();

    monitorSteps.data = {
      monitorStepsInstanceArray: [monitorStep],
      defaultMonitorStatusId: data.defaultMonitorStatusId,
    };

    return monitorSteps;
  }

  /*
   * Reduce a monitor step to what it watches. Returns undefined for steps that
   * carry no recommendation config (an HTTP monitor step, say) — those can
   * never match a recommendation.
   *
   * See `MonitorRecommendationFingerprint` for why each component is here.
   */
  public static getFingerprintFromMonitorStep(
    monitorStep: MonitorStep,
  ): MonitorRecommendationFingerprint | undefined {
    const configKind: string | undefined =
      this.getRecommendationConfigKind(monitorStep);

    if (!configKind) {
      return undefined;
    }

    const config: RecommendationMonitorStepConfig = (
      monitorStep.data as unknown as Record<
        string,
        RecommendationMonitorStepConfig
      >
    )[configKind]!;

    const resourceIdentifier: string =
      config.clusterIdentifier ||
      config.hostIdentifier ||
      config.fleetIdentifier ||
      this.getTelemetryResourceIdentifier(config) ||
      "";

    const metricNames: Array<string> = [];
    const metricAliases: Array<string> = [];
    const queryAttributes: Array<string> = [];
    const formulas: Array<string> = [];

    for (const queryConfig of config.metricViewConfig?.queryConfigs || []) {
      const metricName: string | undefined =
        this.getMetricNameFromQueryConfig(queryConfig);

      if (metricName) {
        metricNames.push(metricName);
      }

      const metricAlias: string | undefined =
        queryConfig.metricAliasData?.metricVariable;

      if (metricAlias) {
        metricAliases.push(metricAlias);
      }

      queryAttributes.push(this.getQueryAttributeKey(queryConfig));
    }

    for (const formulaConfig of config.metricViewConfig?.formulaConfigs || []) {
      const formula: string | undefined =
        this.getFormulaFromFormulaConfig(formulaConfig);

      if (formula) {
        formulas.push(formula);
      }
    }

    return {
      resourceIdentifier: resourceIdentifier,
      configKind: configKind,
      /*
       * Every list is sorted so that declaration order inside a template is
       * not part of the identity — a template author reordering two queries
       * must not orphan every monitor already created from it.
       */
      metricNames: metricNames.sort(),
      formulas: formulas.sort(),
      metricAliases: metricAliases.sort(),
      queryAttributes: queryAttributes.sort(),
      criteriaFilters: this.getCriteriaFilterKeys(monitorStep).sort(),
      configValues: this.getConfigValues(configKind, config).sort(),
    };
  }

  /*
   * Which recommendation-capable config the step carries, as the property
   * name.
   *
   * Returned instead of the config object itself because the NAME is part of
   * the fingerprint: Docker, Docker Swarm and Podman ship structurally
   * identical metric configs, so a Docker monitor and a Podman monitor
   * watching container CPU are indistinguishable by contents alone.
   */
  private static getRecommendationConfigKind(
    monitorStep: MonitorStep,
  ): string | undefined {
    if (!monitorStep.data) {
      return undefined;
    }

    const kinds: Array<string> = [
      "kubernetesMonitor",
      "hostMonitor",
      "dockerMonitor",
      "dockerSwarmMonitor",
      "podmanMonitor",
      "proxmoxMonitor",
      "cephMonitor",
      "iotMonitor",
      "metricMonitor",
      "traceMonitor",
      "exceptionMonitor",
    ];

    const data: Record<string, unknown> = monitorStep.data as unknown as Record<
      string,
      unknown
    >;

    return kinds.find((kind: string) => {
      return Boolean(data[kind]);
    });
  }

  private static getTelemetryResourceIdentifier(
    config: RecommendationMonitorStepConfig,
  ): string {
    return (config.telemetryServiceIds || [])
      .map((id: ObjectID | string) => {
        return id.toString();
      })
      .sort()
      .join(",");
  }

  /*
   * Query inputs that do not live in a metric view. They must participate in
   * coverage identity: an all-span trace monitor does not cover an error-span
   * recommendation, and a project-wide metric monitor does not cover the same
   * metric scoped to one RUM application.
   */
  private static getConfigValues(
    configKind: string,
    config: RecommendationMonitorStepConfig,
  ): Array<string> {
    const values: Array<string> = [];

    if (config.metricViewConfig) {
      values.push(`rollingTime=${String(config.rollingTime ?? "")}`);
    }

    if (configKind === "traceMonitor") {
      values.push(
        `attributes=${this.getStableRecordKey(config.attributes || {})}`,
        `spanStatuses=${(config.spanStatuses || []).map(String).sort().join(",")}`,
        `spanName=${config.spanName || ""}`,
        `entityKeys=${(config.entityKeys || []).slice().sort().join(",")}`,
        `lastXSecondsOfSpans=${String(config.lastXSecondsOfSpans ?? "")}`,
      );
    }

    if (configKind === "exceptionMonitor") {
      values.push(
        `exceptionTypes=${(config.exceptionTypes || []).slice().sort().join(",")}`,
        `message=${config.message || ""}`,
        `entityKeys=${(config.entityKeys || []).slice().sort().join(",")}`,
        `includeResolved=${String(Boolean(config.includeResolved))}`,
        `includeArchived=${String(Boolean(config.includeArchived))}`,
        `lastXSecondsOfExceptions=${String(
          config.lastXSecondsOfExceptions ?? "",
        )}`,
      );
    }

    return values;
  }

  private static getStableRecordKey(record: Record<string, unknown>): string {
    return Object.keys(record)
      .sort()
      .map((key: string) => {
        return `${key}=${String(record[key])}`;
      })
      .join(",");
  }

  /*
   * The attribute filter on one query, as a stable string.
   *
   * Keys are sorted before serializing: `{ name: "X", severity: "Y" }` and
   * `{ severity: "Y", name: "X" }` describe the same query, and JSON.stringify
   * alone would call them different.
   */
  private static getQueryAttributeKey(
    queryConfig: MetricQueryConfigData,
  ): string {
    const attributes: unknown =
      queryConfig.metricQueryData?.filterData?.["attributes"];

    if (!attributes || typeof attributes !== "object") {
      return "";
    }

    const record: Record<string, unknown> = attributes as Record<
      string,
      unknown
    >;

    return Object.keys(record).length > 0
      ? this.getStableRecordKey(record)
      : "";
  }

  /*
   * Every threshold the step evaluates, as stable strings.
   *
   * Covers all criteria instances, healthy and unhealthy alike: the recovery
   * criteria's own threshold is equally part of what the step watches, and two
   * templates that differ only in their recovery bound are still two different
   * monitors.
   *
   * `metricAlias` is included because a multi-query step's filters are only
   * meaningful against the series they name.
   */
  private static getCriteriaFilterKeys(
    monitorStep: MonitorStep,
  ): Array<string> {
    const keys: Array<string> = [];

    const criteriaInstances: Array<MonitorCriteriaInstance> =
      monitorStep.data?.monitorCriteria?.data?.monitorCriteriaInstanceArray ||
      [];

    for (const criteriaInstance of criteriaInstances) {
      for (const filter of criteriaInstance.data?.filters || []) {
        keys.push(
          [
            String(filter.checkOn ?? ""),
            String(filter.filterType ?? ""),
            String(filter.value ?? ""),
            String(filter.metricMonitorOptions?.metricAlias ?? ""),
          ].join("|"),
        );
      }
    }

    return keys;
  }

  private static getMetricNameFromQueryConfig(
    queryConfig: MetricQueryConfigData,
  ): string | undefined {
    const metricName: unknown = queryConfig.metricQueryData?.filterData?.[
      "metricName"
    ] as unknown;

    if (typeof metricName === "string" && metricName) {
      return metricName;
    }

    return undefined;
  }

  private static getFormulaFromFormulaConfig(
    formulaConfig: MetricFormulaConfigData,
  ): string | undefined {
    const formula: string | undefined =
      formulaConfig.metricFormulaData?.metricFormula;

    if (typeof formula === "string" && formula) {
      return formula;
    }

    return undefined;
  }

  /*
   * A positional array rather than the object, so the serialization is stable
   * regardless of the order the fields were written in. Every component of
   * `MonitorRecommendationFingerprint` must appear here — a field added to the
   * interface but forgotten below is invisible: the type checker is satisfied
   * and the fingerprint silently keeps ignoring it, which is exactly the class
   * of bug the interface's own comment describes.
   */
  public static serializeFingerprint(
    fingerprint: MonitorRecommendationFingerprint,
  ): string {
    return JSON.stringify([
      fingerprint.resourceIdentifier,
      fingerprint.configKind,
      fingerprint.metricNames,
      fingerprint.formulas,
      fingerprint.metricAliases,
      fingerprint.queryAttributes,
      fingerprint.criteriaFilters,
      fingerprint.configValues,
    ]);
  }

  public static areFingerprintsEqual(
    a: MonitorRecommendationFingerprint | undefined,
    b: MonitorRecommendationFingerprint | undefined,
  ): boolean {
    if (!a || !b) {
      return false;
    }

    return this.serializeFingerprint(a) === this.serializeFingerprint(b);
  }

  /*
   * Which recommendations are already covered by monitors that exist.
   *
   * `existingMonitorSteps` is every step of every monitor already attached to
   * this resource. A recommendation counts as covered when its freshly-built
   * step fingerprints identically to one of them — i.e. same resource, same
   * metrics, same formulas.
   *
   * `args` must use the same resource identifier the existing monitors were
   * created with, otherwise nothing will ever match.
   */
  public static getCoveredRecommendationIds(data: {
    recommendations: Array<MonitorRecommendation>;
    existingMonitorSteps: Array<MonitorStep>;
    args: MonitorRecommendationArgs;
  }): Set<string> {
    const existingFingerprints: Set<string> = new Set<string>();

    for (const monitorStep of data.existingMonitorSteps) {
      const fingerprint: MonitorRecommendationFingerprint | undefined =
        this.getFingerprintFromMonitorStep(monitorStep);

      if (fingerprint) {
        existingFingerprints.add(this.serializeFingerprint(fingerprint));
      }
    }

    const covered: Set<string> = new Set<string>();

    if (existingFingerprints.size === 0) {
      return covered;
    }

    for (const recommendation of data.recommendations) {
      const fingerprint: string | undefined =
        this.getSerializedFingerprintForRecommendation({
          recommendation: recommendation,
          args: data.args,
        });

      if (fingerprint && existingFingerprints.has(fingerprint)) {
        covered.add(recommendation.recommendationId);
      }
    }

    return covered;
  }

  /*
   * Same diff as `getCoveredRecommendationIds`, but keeps WHICH monitor
   * covers each recommendation instead of only that one does.
   *
   * The set-only version is enough to grey a card out, and that is all the
   * page could do with it: a user looking at "Already created" had no way to
   * get from the card to the monitor to check its thresholds, its on-call
   * policy, or whether it is even enabled. Returning the id lets the card link
   * there.
   *
   * When several monitors fingerprint identically — which happens when someone
   * creates the same recommendation twice by hand — the FIRST is kept, matching
   * the order the caller passed them in (the API sorts monitors, so this is
   * stable across loads rather than whichever row Postgres returned first).
   */
  public static getCoveredRecommendationMonitorIds(data: {
    recommendations: Array<MonitorRecommendation>;
    existingMonitors: Array<{
      monitorId: ObjectID;
      monitorSteps: Array<MonitorStep>;
    }>;
    args: MonitorRecommendationArgs;
  }): Map<string, ObjectID> {
    const monitorIdByFingerprint: Map<string, ObjectID> = new Map<
      string,
      ObjectID
    >();

    for (const existingMonitor of data.existingMonitors) {
      for (const monitorStep of existingMonitor.monitorSteps) {
        const fingerprint: MonitorRecommendationFingerprint | undefined =
          this.getFingerprintFromMonitorStep(monitorStep);

        if (!fingerprint) {
          continue;
        }

        const serialized: string = this.serializeFingerprint(fingerprint);

        if (!monitorIdByFingerprint.has(serialized)) {
          monitorIdByFingerprint.set(serialized, existingMonitor.monitorId);
        }
      }
    }

    const covered: Map<string, ObjectID> = new Map<string, ObjectID>();

    if (monitorIdByFingerprint.size === 0) {
      return covered;
    }

    for (const recommendation of data.recommendations) {
      const fingerprint: string | undefined =
        this.getSerializedFingerprintForRecommendation({
          recommendation: recommendation,
          args: data.args,
        });

      if (!fingerprint) {
        continue;
      }

      const monitorId: ObjectID | undefined =
        monitorIdByFingerprint.get(fingerprint);

      if (monitorId) {
        covered.set(recommendation.recommendationId, monitorId);
      }
    }

    return covered;
  }

  /*
   * Build a recommendation's step exactly as the create flow would, and reduce
   * it to its serialized fingerprint.
   *
   * The `monitorName` recomputation matters: templates interpolate the monitor
   * name into incident titles, and while the name is not part of the
   * fingerprint, building the step with a different name than the create flow
   * uses would be an easy way for the two paths to drift apart later.
   */
  private static getSerializedFingerprintForRecommendation(data: {
    recommendation: MonitorRecommendation;
    args: MonitorRecommendationArgs;
  }): string | undefined {
    const fingerprint: MonitorRecommendationFingerprint | undefined =
      this.getFingerprintFromMonitorStep(
        data.recommendation.getMonitorStep({
          ...data.args,
          monitorName: this.getMonitorName({
            recommendation: data.recommendation,
            resourceDisplayName: data.args.monitorName,
          }),
        }),
      );

    if (!fingerprint) {
      return undefined;
    }

    return this.serializeFingerprint(fingerprint);
  }

  /*
   * The recommendations worth showing first: not yet covered, Critical before
   * Warning, otherwise the module's own declaration order (which puts the
   * most important templates first).
   */
  public static sortRecommendations(data: {
    recommendations: Array<MonitorRecommendation>;
    coveredRecommendationIds: Set<string>;
  }): Array<MonitorRecommendation> {
    const indexOf: Map<string, number> = new Map<string, number>();

    data.recommendations.forEach(
      (recommendation: MonitorRecommendation, index: number) => {
        indexOf.set(recommendation.recommendationId, index);
      },
    );

    return [...data.recommendations].sort(
      (a: MonitorRecommendation, b: MonitorRecommendation) => {
        const aCovered: boolean = data.coveredRecommendationIds.has(
          a.recommendationId,
        );
        const bCovered: boolean = data.coveredRecommendationIds.has(
          b.recommendationId,
        );

        if (aCovered !== bCovered) {
          return aCovered ? 1 : -1;
        }

        if (a.severity !== b.severity) {
          return a.severity === "Critical" ? -1 : 1;
        }

        return (
          (indexOf.get(a.recommendationId) ?? 0) -
          (indexOf.get(b.recommendationId) ?? 0)
        );
      },
    );
  }
}
