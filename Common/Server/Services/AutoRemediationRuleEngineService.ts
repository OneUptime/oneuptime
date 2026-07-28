import Alert from "../../Models/DatabaseModels/Alert";
import Incident from "../../Models/DatabaseModels/Incident";
import AlertAutoRemediationRule from "../../Models/DatabaseModels/AlertAutoRemediationRule";
import IncidentAutoRemediationRule from "../../Models/DatabaseModels/IncidentAutoRemediationRule";
import AlertSeverity from "../../Models/DatabaseModels/AlertSeverity";
import IncidentSeverity from "../../Models/DatabaseModels/IncidentSeverity";
import Label from "../../Models/DatabaseModels/Label";
import Monitor from "../../Models/DatabaseModels/Monitor";
import AlertAutoRemediationRuleService from "./AlertAutoRemediationRuleService";
import IncidentAutoRemediationRuleService from "./IncidentAutoRemediationRuleService";
import AlertService from "./AlertService";
import IncidentService from "./IncidentService";
import MonitorService from "./MonitorService";
import ObjectID from "../../Types/ObjectID";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger, { LogAttributes } from "../Utils/Logger";

/*
 * AI SRE — the auto-remediation rule engine.
 *
 * THE authority on whether AI-proposed remediation for a given incident or
 * alert may execute unattended. Rules are authored by project admins in the
 * same shape as On-Call and Owner rules (match on monitors, severities,
 * labels, and title/description regex patterns) and answer one question:
 *
 *   "For THIS incident/alert, did the project pre-authorize unattended
 *    execution — and does that authorization extend to AI-drafted commands?"
 *
 * Semantics:
 *   - matched          = ANY enabled rule matches the subject.
 *   - commandsAllowed  = ANY MATCHING rule has autoExecuteCommands enabled.
 *     (Union, not intersection: a rule is a grant, so the broadest matching
 *     grant wins — exactly how the on-call engine unions matched policies.
 *     A team that wants commands withheld for a class of incidents must not
 *     have a commands-enabled rule matching them.)
 *
 * FAIL-CLOSED: no rules, no match, a missing subject, or ANY error returns
 * {matched: false, commandsAllowed: false} — everything then waits for a
 * human on the incident/alert page. Autonomy is never the failure mode.
 */

// Upper bound on rules evaluated per subject (mirrors the on-call engine).
const MAX_RULES_PER_PROJECT: number = 100;

export interface AutoRemediationDecision {
  // Did any enabled rule match this subject?
  matched: boolean;
  // Does a matching rule authorize unattended AI-drafted commands?
  commandsAllowed: boolean;
  // Names of the matching rules — for the proposal feed item and audit.
  matchedRuleNames: Array<string>;
}

const DENIED: AutoRemediationDecision = {
  matched: false,
  commandsAllowed: false,
  matchedRuleNames: [],
};

class AutoRemediationRuleEngineServiceClass {
  /*
   * The decision for an incident. Never throws — a failure to evaluate is a
   * refusal to auto-execute, not an error the caller must handle.
   */
  @CaptureSpan()
  public async getDecisionForIncident(
    incidentId: ObjectID,
  ): Promise<AutoRemediationDecision> {
    try {
      const incident: Incident | null = await IncidentService.findOneById({
        id: incidentId,
        select: {
          _id: true,
          projectId: true,
          title: true,
          description: true,
          incidentSeverityId: true,
          monitors: { _id: true },
          labels: { _id: true },
        },
        props: { isRoot: true },
      });

      if (!incident || !incident.projectId) {
        return DENIED;
      }

      const rules: Array<IncidentAutoRemediationRule> =
        await IncidentAutoRemediationRuleService.findBy({
          query: {
            projectId: incident.projectId,
            isEnabled: true,
          },
          select: {
            _id: true,
            name: true,
            autoExecuteCommands: true,
            monitors: { _id: true },
            incidentSeverities: { _id: true },
            incidentLabels: { _id: true },
            monitorLabels: { _id: true },
            incidentTitlePattern: true,
            incidentDescriptionPattern: true,
            monitorNamePattern: true,
            monitorDescriptionPattern: true,
          },
          limit: MAX_RULES_PER_PROJECT,
          skip: 0,
          props: { isRoot: true },
        });

      const decision: AutoRemediationDecision = {
        ...DENIED,
        matchedRuleNames: [],
      };

      for (const rule of rules) {
        const matches: boolean = await this.doesSubjectMatchRule({
          ruleId: rule.id || undefined,
          ruleMonitors: rule.monitors,
          ruleSeverityIds: (rule.incidentSeverities || []).map(
            (s: IncidentSeverity) => {
              return s.id?.toString() || "";
            },
          ),
          ruleSubjectLabels: rule.incidentLabels,
          ruleMonitorLabels: rule.monitorLabels,
          ruleTitlePattern: rule.incidentTitlePattern,
          ruleDescriptionPattern: rule.incidentDescriptionPattern,
          ruleMonitorNamePattern: rule.monitorNamePattern,
          ruleMonitorDescriptionPattern: rule.monitorDescriptionPattern,
          subjectMonitorIds: (incident.monitors || []).map((m: Monitor) => {
            return m.id?.toString() || "";
          }),
          subjectSeverityId: incident.incidentSeverityId?.toString(),
          subjectLabels: incident.labels,
          subjectTitle: incident.title,
          subjectDescription: incident.description,
        });

        if (!matches) {
          continue;
        }

        decision.matched = true;
        decision.matchedRuleNames.push(rule.name?.toString() || "Unnamed Rule");

        if (rule.autoExecuteCommands === true) {
          decision.commandsAllowed = true;
        }
      }

      return decision;
    } catch (error) {
      logger.error(
        `AutoRemediationRuleEngine: incident decision failed — denying autonomy: ${error}`,
        { incidentId: incidentId.toString() } as LogAttributes,
      );
      return DENIED;
    }
  }

  /*
   * The decision for an alert. Alerts carry a single monitorId (unlike an
   * incident's monitor array) — note an AI-escalated alert has none, so any
   * rule with monitor criteria simply will not match it.
   */
  @CaptureSpan()
  public async getDecisionForAlert(
    alertId: ObjectID,
  ): Promise<AutoRemediationDecision> {
    try {
      const alert: Alert | null = await AlertService.findOneById({
        id: alertId,
        select: {
          _id: true,
          projectId: true,
          title: true,
          description: true,
          alertSeverityId: true,
          monitorId: true,
          labels: { _id: true },
        },
        props: { isRoot: true },
      });

      if (!alert || !alert.projectId) {
        return DENIED;
      }

      const rules: Array<AlertAutoRemediationRule> =
        await AlertAutoRemediationRuleService.findBy({
          query: {
            projectId: alert.projectId,
            isEnabled: true,
          },
          select: {
            _id: true,
            name: true,
            autoExecuteCommands: true,
            monitors: { _id: true },
            alertSeverities: { _id: true },
            alertLabels: { _id: true },
            monitorLabels: { _id: true },
            alertTitlePattern: true,
            alertDescriptionPattern: true,
            monitorNamePattern: true,
            monitorDescriptionPattern: true,
          },
          limit: MAX_RULES_PER_PROJECT,
          skip: 0,
          props: { isRoot: true },
        });

      const decision: AutoRemediationDecision = {
        ...DENIED,
        matchedRuleNames: [],
      };

      for (const rule of rules) {
        const matches: boolean = await this.doesSubjectMatchRule({
          ruleId: rule.id || undefined,
          ruleMonitors: rule.monitors,
          ruleSeverityIds: (rule.alertSeverities || []).map(
            (s: AlertSeverity) => {
              return s.id?.toString() || "";
            },
          ),
          ruleSubjectLabels: rule.alertLabels,
          ruleMonitorLabels: rule.monitorLabels,
          ruleTitlePattern: rule.alertTitlePattern,
          ruleDescriptionPattern: rule.alertDescriptionPattern,
          ruleMonitorNamePattern: rule.monitorNamePattern,
          ruleMonitorDescriptionPattern: rule.monitorDescriptionPattern,
          subjectMonitorIds: alert.monitorId
            ? [alert.monitorId.toString()]
            : [],
          subjectSeverityId: alert.alertSeverityId?.toString(),
          subjectLabels: alert.labels,
          subjectTitle: alert.title,
          subjectDescription: alert.description,
        });

        if (!matches) {
          continue;
        }

        decision.matched = true;
        decision.matchedRuleNames.push(rule.name?.toString() || "Unnamed Rule");

        if (rule.autoExecuteCommands === true) {
          decision.commandsAllowed = true;
        }
      }

      return decision;
    } catch (error) {
      logger.error(
        `AutoRemediationRuleEngine: alert decision failed — denying autonomy: ${error}`,
        { alertId: alertId.toString() } as LogAttributes,
      );
      return DENIED;
    }
  }

  /*
   * Subject-agnostic matcher, semantically identical to the on-call rule
   * engines': every configured criterion must pass (AND across criteria,
   * OR within a criterion's list). An unconfigured criterion is ignored,
   * so a rule with NO criteria matches everything in the project — that is
   * the documented "auto-remediate everything" rule, and the UI warns.
   */
  private async doesSubjectMatchRule(data: {
    ruleId?: ObjectID | undefined;
    ruleMonitors?: Array<Monitor> | undefined;
    ruleSeverityIds: Array<string>;
    ruleSubjectLabels?: Array<Label> | undefined;
    ruleMonitorLabels?: Array<Label> | undefined;
    ruleTitlePattern?: string | undefined;
    ruleDescriptionPattern?: string | undefined;
    ruleMonitorNamePattern?: string | undefined;
    ruleMonitorDescriptionPattern?: string | undefined;
    subjectMonitorIds: Array<string>;
    subjectSeverityId?: string | undefined;
    subjectLabels?: Array<Label> | undefined;
    subjectTitle?: string | undefined;
    subjectDescription?: string | undefined;
  }): Promise<boolean> {
    // Monitors: the subject must come from at least one of the rule's monitors.
    if (data.ruleMonitors && data.ruleMonitors.length > 0) {
      if (data.subjectMonitorIds.length === 0) {
        return false;
      }
      const ruleMonitorIds: Array<string> = data.ruleMonitors.map(
        (m: Monitor) => {
          return m.id?.toString() || "";
        },
      );
      const hasMatch: boolean = ruleMonitorIds.some((id: string) => {
        return data.subjectMonitorIds.includes(id);
      });
      if (!hasMatch) {
        return false;
      }
    }

    // Severity.
    if (data.ruleSeverityIds.length > 0) {
      if (!data.subjectSeverityId) {
        return false;
      }
      if (!data.ruleSeverityIds.includes(data.subjectSeverityId)) {
        return false;
      }
    }

    // Subject labels.
    if (data.ruleSubjectLabels && data.ruleSubjectLabels.length > 0) {
      if (!data.subjectLabels || data.subjectLabels.length === 0) {
        return false;
      }
      const ruleLabelIds: Array<string> = data.ruleSubjectLabels.map(
        (l: Label) => {
          return l.id?.toString() || "";
        },
      );
      const subjectLabelIds: Array<string> = data.subjectLabels.map(
        (l: Label) => {
          return l.id?.toString() || "";
        },
      );
      const hasMatch: boolean = ruleLabelIds.some((id: string) => {
        return subjectLabelIds.includes(id);
      });
      if (!hasMatch) {
        return false;
      }
    }

    // Monitor-derived criteria (labels, name, description).
    const hasMonitorCriteria: boolean = Boolean(
      (data.ruleMonitorLabels && data.ruleMonitorLabels.length > 0) ||
        data.ruleMonitorNamePattern ||
        data.ruleMonitorDescriptionPattern,
    );

    if (hasMonitorCriteria) {
      if (data.subjectMonitorIds.length === 0) {
        return false;
      }

      let anyMonitorMatches: boolean = false;

      for (const monitorIdString of data.subjectMonitorIds) {
        if (!monitorIdString) {
          continue;
        }

        const monitor: Monitor | null = await MonitorService.findOneById({
          id: new ObjectID(monitorIdString),
          select: {
            name: true,
            description: true,
            labels: { _id: true },
          },
          props: { isRoot: true },
        });

        if (!monitor) {
          continue;
        }

        let monitorMatches: boolean = true;

        if (data.ruleMonitorLabels && data.ruleMonitorLabels.length > 0) {
          if (!monitor.labels || monitor.labels.length === 0) {
            monitorMatches = false;
          } else {
            const ruleMonitorLabelIds: Array<string> =
              data.ruleMonitorLabels.map((l: Label) => {
                return l.id?.toString() || "";
              });
            const monitorLabelIds: Array<string> = monitor.labels.map(
              (l: Label) => {
                return l.id?.toString() || "";
              },
            );
            const hasMatch: boolean = ruleMonitorLabelIds.some((id: string) => {
              return monitorLabelIds.includes(id);
            });
            if (!hasMatch) {
              monitorMatches = false;
            }
          }
        }

        if (monitorMatches && data.ruleMonitorNamePattern) {
          if (
            !monitor.name ||
            !this.testRegex(
              data.ruleMonitorNamePattern,
              monitor.name,
              data.ruleId,
            )
          ) {
            monitorMatches = false;
          }
        }

        if (monitorMatches && data.ruleMonitorDescriptionPattern) {
          if (
            !monitor.description ||
            !this.testRegex(
              data.ruleMonitorDescriptionPattern,
              monitor.description,
              data.ruleId,
            )
          ) {
            monitorMatches = false;
          }
        }

        if (monitorMatches) {
          anyMonitorMatches = true;
          break;
        }
      }

      if (!anyMonitorMatches) {
        return false;
      }
    }

    if (data.ruleTitlePattern) {
      if (
        !data.subjectTitle ||
        !this.testRegex(data.ruleTitlePattern, data.subjectTitle, data.ruleId)
      ) {
        return false;
      }
    }

    if (data.ruleDescriptionPattern) {
      if (
        !data.subjectDescription ||
        !this.testRegex(
          data.ruleDescriptionPattern,
          data.subjectDescription,
          data.ruleId,
        )
      ) {
        return false;
      }
    }

    return true;
  }

  // An invalid stored pattern is a non-match, never a thrown error.
  private testRegex(
    pattern: string,
    value: string,
    ruleId?: ObjectID | undefined,
  ): boolean {
    try {
      const regex: RegExp = new RegExp(pattern, "i");
      return regex.test(value);
    } catch {
      logger.warn(
        `Invalid regex pattern in auto-remediation rule ${ruleId?.toString() || "unknown"}: ${pattern}`,
      );
      return false;
    }
  }
}

export default new AutoRemediationRuleEngineServiceClass();
