import ObjectID from "../../ObjectID";
import MetricsViewConfig from "../../Metrics/MetricsViewConfig";
import MetricQueryConfigData from "../../Metrics/MetricQueryConfigData";
import MetricFormulaConfigData from "../../Metrics/MetricFormulaConfigData";
import MonitorStep from "../MonitorStep";
import MonitorSteps from "../MonitorSteps";
import MonitorCriteriaInstance from "../MonitorCriteriaInstance";
import { CriteriaIncident } from "../CriteriaIncident";
import { CriteriaAlert } from "../CriteriaAlert";
import {
  MonitorRecommendation,
  MonitorRecommendationArgs,
  MonitorRecommendationNotificationSettings,
} from "./MonitorRecommendationTypes";

/*
 * The structural slice of every `MonitorStep<X>Monitor` this module reads.
 *
 * All eight infrastructure step configs carry a `metricViewConfig` plus
 * exactly one identifier field, whose name varies by resource type
 * (see `MonitorRecommendationTypes.MonitorRecommendationArgs`). Reading all
 * three optional names keeps the fingerprint logic resource-type-agnostic
 * without needing a per-type switch.
 */
interface InfrastructureMonitorStepConfig {
  clusterIdentifier?: string | undefined;
  hostIdentifier?: string | undefined;
  fleetIdentifier?: string | undefined;
  metricViewConfig?: MetricsViewConfig | undefined;
}

/*
 * What uniquely identifies "this alert is already being watched", derived
 * from a monitor step rather than from the monitor's name.
 *
 * Name matching was the obvious alternative and is wrong: renaming a monitor
 * would make an already-created recommendation reappear as un-created, and
 * two different templates on the same resource can be renamed into collision.
 * The metric set plus the resource identifier is what actually determines
 * what a step watches, and both are deterministic per template.
 */
export interface MonitorRecommendationFingerprint {
  resourceIdentifier: string;
  metricNames: Array<string>;
  formulas: Array<string>;
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
   * Push the user's chosen on-call policies, owners, labels and severity
   * overrides into every incident and alert of every criteria instance in a
   * step.
   *
   * This is the whole reason the create form asks for on-call policies: every
   * shipped template hardcodes `onCallPolicyIds: []`, so a template-created
   * monitor would open incidents that page nobody. Templates are the source
   * of the thresholds; this is the source of "who hears about it".
   *
   * Mutates and returns the step (the step was just built by the template and
   * is not shared with anything else).
   */
  public static applyNotificationSettingsToMonitorStep(data: {
    monitorStep: MonitorStep;
    notificationSettings: MonitorRecommendationNotificationSettings;
  }): MonitorStep {
    const settings: MonitorRecommendationNotificationSettings =
      data.notificationSettings;

    const criteriaInstances: Array<MonitorCriteriaInstance> =
      data.monitorStep.data?.monitorCriteria?.data
        ?.monitorCriteriaInstanceArray || [];

    for (const criteriaInstance of criteriaInstances) {
      if (!criteriaInstance.data) {
        continue;
      }

      for (const incident of criteriaInstance.data.incidents || []) {
        this.applyToCriteriaIncident(incident, settings);
      }

      for (const alert of criteriaInstance.data.alerts || []) {
        this.applyToCriteriaAlert(alert, settings);
      }
    }

    return data.monitorStep;
  }

  private static applyToCriteriaIncident(
    incident: CriteriaIncident,
    settings: MonitorRecommendationNotificationSettings,
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

    if (settings.incidentSeverityId) {
      incident.incidentSeverityId = settings.incidentSeverityId;
    }
  }

  private static applyToCriteriaAlert(
    alert: CriteriaAlert,
    settings: MonitorRecommendationNotificationSettings,
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

    if (settings.alertSeverityId) {
      alert.alertSeverityId = settings.alertSeverityId;
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
   * Reduce a monitor step to the (resource, metrics) pair that determines
   * what it watches. Returns undefined for steps that carry no
   * infrastructure config (an HTTP monitor step, say) — those can never
   * match a recommendation.
   */
  public static getFingerprintFromMonitorStep(
    monitorStep: MonitorStep,
  ): MonitorRecommendationFingerprint | undefined {
    const config: InfrastructureMonitorStepConfig | undefined =
      this.getInfrastructureConfig(monitorStep);

    if (!config) {
      return undefined;
    }

    const resourceIdentifier: string =
      config.clusterIdentifier ||
      config.hostIdentifier ||
      config.fleetIdentifier ||
      "";

    const metricNames: Array<string> = [];
    const formulas: Array<string> = [];

    for (const queryConfig of config.metricViewConfig?.queryConfigs || []) {
      const metricName: string | undefined =
        this.getMetricNameFromQueryConfig(queryConfig);

      if (metricName) {
        metricNames.push(metricName);
      }
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
      // Sorted so that query order is not part of the identity.
      metricNames: metricNames.sort(),
      formulas: formulas.sort(),
    };
  }

  private static getInfrastructureConfig(
    monitorStep: MonitorStep,
  ): InfrastructureMonitorStepConfig | undefined {
    if (!monitorStep.data) {
      return undefined;
    }

    return (
      monitorStep.data.kubernetesMonitor ||
      monitorStep.data.hostMonitor ||
      monitorStep.data.dockerMonitor ||
      monitorStep.data.dockerSwarmMonitor ||
      monitorStep.data.podmanMonitor ||
      monitorStep.data.proxmoxMonitor ||
      monitorStep.data.cephMonitor ||
      monitorStep.data.iotMonitor ||
      undefined
    );
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

  public static serializeFingerprint(
    fingerprint: MonitorRecommendationFingerprint,
  ): string {
    return JSON.stringify([
      fingerprint.resourceIdentifier,
      fingerprint.metricNames,
      fingerprint.formulas,
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
      const fingerprint: MonitorRecommendationFingerprint | undefined =
        this.getFingerprintFromMonitorStep(
          recommendation.getMonitorStep({
            ...data.args,
            monitorName: this.getMonitorName({
              recommendation: recommendation,
              resourceDisplayName: data.args.monitorName,
            }),
          }),
        );

      if (
        fingerprint &&
        existingFingerprints.has(this.serializeFingerprint(fingerprint))
      ) {
        covered.add(recommendation.recommendationId);
      }
    }

    return covered;
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
