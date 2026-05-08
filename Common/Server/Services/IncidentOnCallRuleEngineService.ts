import Incident from "../../Models/DatabaseModels/Incident";
import IncidentOnCallRule from "../../Models/DatabaseModels/IncidentOnCallRule";
import IncidentSeverity from "../../Models/DatabaseModels/IncidentSeverity";
import Label from "../../Models/DatabaseModels/Label";
import Monitor from "../../Models/DatabaseModels/Monitor";
import OnCallDutyPolicy from "../../Models/DatabaseModels/OnCallDutyPolicy";
import IncidentOnCallRuleService from "./IncidentOnCallRuleService";
import MonitorService from "./MonitorService";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger, { LogAttributes } from "../Utils/Logger";

class IncidentOnCallRuleEngineServiceClass {
  /**
   * Evaluates IncidentOnCallRule rows for the given incident and merges any
   * matching rules' on-call policies into the incident's onCallDutyPolicies
   * array (deduped). The caller's existing on-call fan-out then runs the
   * merged list, so each policy executes at most once per incident.
   */
  @CaptureSpan()
  public async applyRulesToIncident(incident: Incident): Promise<void> {
    if (!incident.id || !incident.projectId) {
      return;
    }

    try {
      const rules: Array<IncidentOnCallRule> =
        await IncidentOnCallRuleService.findBy({
          query: {
            projectId: incident.projectId,
            isEnabled: true,
          },
          props: { isRoot: true },
          select: {
            _id: true,
            name: true,
            monitors: { _id: true },
            incidentSeverities: { _id: true },
            incidentLabels: { _id: true },
            monitorLabels: { _id: true },
            incidentTitlePattern: true,
            incidentDescriptionPattern: true,
            monitorNamePattern: true,
            monitorDescriptionPattern: true,
            onCallDutyPolicies: { _id: true },
          },
          limit: 100,
          skip: 0,
        });

      if (rules.length === 0) {
        return;
      }

      const matchedPolicies: Map<string, OnCallDutyPolicy> = new Map();

      for (const rule of rules) {
        const matches: boolean = await this.doesIncidentMatchRule(
          incident,
          rule,
        );
        if (!matches) {
          continue;
        }

        if (rule.onCallDutyPolicies && rule.onCallDutyPolicies.length > 0) {
          for (const policy of rule.onCallDutyPolicies) {
            const policyId: string | undefined = policy.id?.toString();
            if (policyId && !matchedPolicies.has(policyId)) {
              matchedPolicies.set(policyId, policy);
            }
          }
        }
      }

      if (matchedPolicies.size === 0) {
        return;
      }

      const existingIds: Set<string> = new Set(
        (incident.onCallDutyPolicies || [])
          .map((p: OnCallDutyPolicy) => {
            return p.id?.toString() || (p as { _id?: string })._id || "";
          })
          .filter((id: string) => {
            return id !== "";
          }),
      );

      const merged: Array<OnCallDutyPolicy> = [
        ...(incident.onCallDutyPolicies || []),
      ];

      for (const [policyId, policy] of matchedPolicies) {
        if (!existingIds.has(policyId)) {
          merged.push(policy);
        }
      }

      incident.onCallDutyPolicies = merged;

      logger.debug(
        `IncidentOnCallRuleEngine merged ${matchedPolicies.size} matched policies into incident ${incident.id}`,
        { projectId: incident.projectId.toString() } as LogAttributes,
      );
    } catch (error) {
      logger.error(`Error applying incident on-call rules: ${error}`, {
        projectId: incident.projectId?.toString(),
        incidentId: incident.id?.toString(),
      } as LogAttributes);
    }
  }

  @CaptureSpan()
  private async doesIncidentMatchRule(
    incident: Incident,
    rule: IncidentOnCallRule,
  ): Promise<boolean> {
    // Monitors: incident must come from at least one of the rule's monitors
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

    // Incident labels
    if (rule.incidentLabels && rule.incidentLabels.length > 0) {
      if (!incident.labels || incident.labels.length === 0) {
        return false;
      }
      const ruleLabelIds: Array<string> = rule.incidentLabels.map(
        (l: Label) => {
          return l.id?.toString() || "";
        },
      );
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

    // Monitor-derived criteria (labels, name, description)
    const hasMonitorCriteria: boolean = Boolean(
      (rule.monitorLabels && rule.monitorLabels.length > 0) ||
        rule.monitorNamePattern ||
        rule.monitorDescriptionPattern,
    );

    if (hasMonitorCriteria) {
      if (!incident.monitors || incident.monitors.length === 0) {
        return false;
      }

      let anyMonitorMatches: boolean = false;

      for (const incidentMonitor of incident.monitors) {
        if (!incidentMonitor.id) {
          continue;
        }

        const monitor: Monitor | null = await MonitorService.findOneById({
          id: incidentMonitor.id,
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

        if (rule.monitorLabels && rule.monitorLabels.length > 0) {
          if (!monitor.labels || monitor.labels.length === 0) {
            monitorMatches = false;
          } else {
            const ruleMonitorLabelIds: Array<string> = rule.monitorLabels.map(
              (l: Label) => {
                return l.id?.toString() || "";
              },
            );
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

        if (monitorMatches && rule.monitorNamePattern) {
          if (
            !monitor.name ||
            !this.testRegex(rule.monitorNamePattern, monitor.name, rule)
          ) {
            monitorMatches = false;
          }
        }

        if (monitorMatches && rule.monitorDescriptionPattern) {
          if (
            !monitor.description ||
            !this.testRegex(
              rule.monitorDescriptionPattern,
              monitor.description,
              rule,
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

    if (rule.incidentTitlePattern) {
      if (
        !incident.title ||
        !this.testRegex(rule.incidentTitlePattern, incident.title, rule)
      ) {
        return false;
      }
    }

    if (rule.incidentDescriptionPattern) {
      if (
        !incident.description ||
        !this.testRegex(
          rule.incidentDescriptionPattern,
          incident.description,
          rule,
        )
      ) {
        return false;
      }
    }

    return true;
  }

  private testRegex(
    pattern: string,
    value: string,
    rule: IncidentOnCallRule,
  ): boolean {
    try {
      const regex: RegExp = new RegExp(pattern, "i");
      return regex.test(value);
    } catch {
      logger.warn(
        `Invalid regex pattern in incident on-call rule ${rule.id}: ${pattern}`,
      );
      return false;
    }
  }
}

export default new IncidentOnCallRuleEngineServiceClass();
