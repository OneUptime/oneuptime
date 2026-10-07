import Alert from "../../../Models/DatabaseModels/Alert";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import Label from "../../../Models/DatabaseModels/Label";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import ObjectID from "../../../Types/ObjectID";
import RuleCriteriaMatcher from "../../../Utils/Rules/RuleCriteriaMatcher";
import logger from "../Logger";
import MonitorRuleCriteriaCache from "./MonitorRuleCriteriaCache";

/*
 * Whether an incident or an alert matches a rule that decides what OneUptime
 * AI does with it: an Auto Remediation Rule (which ones are fixed, and how)
 * or an Investigation Rule (which ones are investigated). Both carry the same
 * match columns and versioned criteria, and both must read a condition the
 * same way, so the matching lives here once.
 *
 * Every legacy criterion is skip-if-empty with AND semantics across
 * criteria - the same shape as IncidentOnCallRuleEngineService - and the
 * versioned criteria are evaluated through it (RuleCriteriaMatcher). A rule
 * with no condition matches every incident or alert.
 */
export interface IncidentAlertMatchRule {
  id?: ObjectID | null | undefined;
  criteria?: unknown;
  monitors?: Array<Monitor> | undefined;
  incidentSeverities?: Array<IncidentSeverity> | undefined;
  alertSeverities?: Array<AlertSeverity> | undefined;
  labels?: Array<Label> | undefined;
  monitorLabels?: Array<Label> | undefined;
  titlePattern?: string | undefined;
  descriptionPattern?: string | undefined;
}

export default class IncidentAlertRuleMatcher {
  /*
   * `ruleKind` names the rule in the log when one of its patterns is not a
   * valid regular expression ("auto-remediation rule").
   */
  public static async doesIncidentMatch(
    incident: Incident,
    rule: IncidentAlertMatchRule,
    ruleKind: string,
  ): Promise<boolean> {
    const monitorCache: MonitorRuleCriteriaCache =
      new MonitorRuleCriteriaCache();

    return await RuleCriteriaMatcher.matchesWithLegacy({
      rule: rule,
      legacyFields: [
        "monitors",
        "incidentSeverities",
        "labels",
        "monitorLabels",
        "titlePattern",
        "descriptionPattern",
      ] as ReadonlyArray<Extract<keyof IncidentAlertMatchRule, string>>,
      emptyResult: true,
      matchesLegacyRule: async (
        legacyRule: IncidentAlertMatchRule,
      ): Promise<boolean> => {
        return await this.doesIncidentMatchLegacyRule(
          incident,
          legacyRule,
          monitorCache,
          ruleKind,
        );
      },
      correlation: {
        fields: ["monitorLabels"] as ReadonlyArray<
          Extract<keyof IncidentAlertMatchRule, string>
        >,
        getCandidates: (): Array<Monitor> => {
          return incident.monitors || [];
        },
        matchesLegacyRuleForCandidate: async (
          legacyRule: IncidentAlertMatchRule,
          incidentMonitor: Monitor,
        ): Promise<boolean> => {
          const correlatedIncident: Incident = Object.assign(
            new Incident(),
            incident,
          );
          correlatedIncident.monitors = [incidentMonitor];
          return await this.doesIncidentMatchLegacyRule(
            correlatedIncident,
            legacyRule,
            monitorCache,
            ruleKind,
          );
        },
      },
    });
  }

  public static async doesAlertMatch(
    alert: Alert,
    rule: IncidentAlertMatchRule,
    ruleKind: string,
  ): Promise<boolean> {
    const monitorCache: MonitorRuleCriteriaCache =
      new MonitorRuleCriteriaCache();

    return await RuleCriteriaMatcher.matchesWithLegacy({
      rule: rule,
      legacyFields: [
        "monitors",
        "alertSeverities",
        "labels",
        "monitorLabels",
        "titlePattern",
        "descriptionPattern",
      ] as ReadonlyArray<Extract<keyof IncidentAlertMatchRule, string>>,
      emptyResult: true,
      matchesLegacyRule: async (
        legacyRule: IncidentAlertMatchRule,
      ): Promise<boolean> => {
        return await this.doesAlertMatchLegacyRule(
          alert,
          legacyRule,
          monitorCache,
          ruleKind,
        );
      },
    });
  }

  private static async doesIncidentMatchLegacyRule(
    incident: Incident,
    rule: IncidentAlertMatchRule,
    monitorCache: MonitorRuleCriteriaCache,
    ruleKind: string,
  ): Promise<boolean> {
    // Monitors: incident must come from at least one of the rule's monitors.
    if (rule.monitors && rule.monitors.length > 0) {
      if (!incident.monitors || incident.monitors.length === 0) {
        return false;
      }
      const ruleMonitorIds: Array<string> = rule.monitors.map((m: Monitor) => {
        return m.id?.toString() || "";
      });
      const incidentMonitorIds: Array<string> = incident.monitors.map(
        (m: Monitor) => {
          return m.id?.toString() || "";
        },
      );
      const hasMatch: boolean = ruleMonitorIds.some((id: string) => {
        return incidentMonitorIds.includes(id);
      });
      if (!hasMatch) {
        return false;
      }
    }

    // Severity
    if (rule.incidentSeverities && rule.incidentSeverities.length > 0) {
      if (!incident.incidentSeverityId) {
        return false;
      }
      const severityIds: Array<string> = rule.incidentSeverities.map(
        (s: IncidentSeverity) => {
          return s.id?.toString() || "";
        },
      );
      if (!severityIds.includes(incident.incidentSeverityId.toString())) {
        return false;
      }
    }

    // Entity labels
    if (rule.labels && rule.labels.length > 0) {
      if (!incident.labels || incident.labels.length === 0) {
        return false;
      }
      const ruleLabelIds: Array<string> = rule.labels.map((l: Label) => {
        return l.id?.toString() || "";
      });
      const incidentLabelIds: Array<string> = incident.labels.map(
        (l: Label) => {
          return l.id?.toString() || "";
        },
      );
      const hasMatch: boolean = ruleLabelIds.some((id: string) => {
        return incidentLabelIds.includes(id);
      });
      if (!hasMatch) {
        return false;
      }
    }

    // Monitor labels: any of the incident's monitors carrying one is enough.
    if (rule.monitorLabels && rule.monitorLabels.length > 0) {
      if (!incident.monitors || incident.monitors.length === 0) {
        return false;
      }

      let anyMonitorMatches: boolean = false;

      for (const incidentMonitor of incident.monitors) {
        if (!incidentMonitor.id) {
          continue;
        }

        if (
          await this.doesMonitorCarryAnyLabel(
            incidentMonitor.id,
            rule.monitorLabels,
            monitorCache,
          )
        ) {
          anyMonitorMatches = true;
          break;
        }
      }

      if (!anyMonitorMatches) {
        return false;
      }
    }

    if (rule.titlePattern) {
      if (
        !incident.title ||
        !this.testRegex(rule.titlePattern, incident.title, rule, ruleKind)
      ) {
        return false;
      }
    }

    if (rule.descriptionPattern) {
      if (
        !incident.description ||
        !this.testRegex(
          rule.descriptionPattern,
          incident.description,
          rule,
          ruleKind,
        )
      ) {
        return false;
      }
    }

    return true;
  }

  private static async doesAlertMatchLegacyRule(
    alert: Alert,
    rule: IncidentAlertMatchRule,
    monitorCache: MonitorRuleCriteriaCache,
    ruleKind: string,
  ): Promise<boolean> {
    // Monitors: alerts carry a single scalar monitorId.
    if (rule.monitors && rule.monitors.length > 0) {
      if (!alert.monitorId) {
        return false;
      }
      const monitorIds: Array<string> = rule.monitors.map((m: Monitor) => {
        return m.id?.toString() || "";
      });
      if (!monitorIds.includes(alert.monitorId.toString())) {
        return false;
      }
    }

    // Severity
    if (rule.alertSeverities && rule.alertSeverities.length > 0) {
      if (!alert.alertSeverityId) {
        return false;
      }
      const severityIds: Array<string> = rule.alertSeverities.map(
        (s: AlertSeverity) => {
          return s.id?.toString() || "";
        },
      );
      if (!severityIds.includes(alert.alertSeverityId.toString())) {
        return false;
      }
    }

    // Entity labels
    if (rule.labels && rule.labels.length > 0) {
      if (!alert.labels || alert.labels.length === 0) {
        return false;
      }
      const ruleLabelIds: Array<string> = rule.labels.map((l: Label) => {
        return l.id?.toString() || "";
      });
      const alertLabelIds: Array<string> = alert.labels.map((l: Label) => {
        return l.id?.toString() || "";
      });
      const hasMatch: boolean = ruleLabelIds.some((id: string) => {
        return alertLabelIds.includes(id);
      });
      if (!hasMatch) {
        return false;
      }
    }

    // Monitor labels
    if (rule.monitorLabels && rule.monitorLabels.length > 0) {
      if (!alert.monitorId) {
        return false;
      }
      if (
        !(await this.doesMonitorCarryAnyLabel(
          alert.monitorId,
          rule.monitorLabels,
          monitorCache,
        ))
      ) {
        return false;
      }
    }

    if (rule.titlePattern) {
      if (
        !alert.title ||
        !this.testRegex(rule.titlePattern, alert.title, rule, ruleKind)
      ) {
        return false;
      }
    }

    if (rule.descriptionPattern) {
      if (
        !alert.description ||
        !this.testRegex(
          rule.descriptionPattern,
          alert.description,
          rule,
          ruleKind,
        )
      ) {
        return false;
      }
    }

    return true;
  }

  private static async doesMonitorCarryAnyLabel(
    monitorId: ObjectID,
    ruleMonitorLabels: Array<Label>,
    monitorCache: MonitorRuleCriteriaCache,
  ): Promise<boolean> {
    const monitor: Monitor | null = await monitorCache.getMonitor(monitorId);

    if (!monitor || !monitor.labels || monitor.labels.length === 0) {
      return false;
    }

    const ruleLabelIds: Array<string> = ruleMonitorLabels.map((l: Label) => {
      return l.id?.toString() || "";
    });
    const monitorLabelIds: Array<string> = monitor.labels.map((l: Label) => {
      return l.id?.toString() || "";
    });

    return ruleLabelIds.some((id: string) => {
      return monitorLabelIds.includes(id);
    });
  }

  private static testRegex(
    pattern: string,
    value: string,
    rule: IncidentAlertMatchRule,
    ruleKind: string,
  ): boolean {
    try {
      const regex: RegExp = new RegExp(pattern, "i");
      return regex.test(value);
    } catch {
      logger.warn(
        `Invalid regex pattern in ${ruleKind} ${rule.id}: ${pattern}`,
      );
      return false;
    }
  }
}
