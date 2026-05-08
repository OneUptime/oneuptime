import Alert from "../../Models/DatabaseModels/Alert";
import AlertOnCallRule from "../../Models/DatabaseModels/AlertOnCallRule";
import AlertSeverity from "../../Models/DatabaseModels/AlertSeverity";
import Label from "../../Models/DatabaseModels/Label";
import Monitor from "../../Models/DatabaseModels/Monitor";
import OnCallDutyPolicy from "../../Models/DatabaseModels/OnCallDutyPolicy";
import AlertOnCallRuleService from "./AlertOnCallRuleService";
import MonitorService from "./MonitorService";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger, { LogAttributes } from "../Utils/Logger";

class AlertOnCallRuleEngineServiceClass {
  /**
   * Evaluates AlertOnCallRule rows for the given alert and merges any
   * matching rules' on-call policies into the alert's onCallDutyPolicies
   * array (deduped). The caller's existing on-call fan-out then runs the
   * merged list, so each policy executes at most once per alert.
   */
  @CaptureSpan()
  public async applyRulesToAlert(alert: Alert): Promise<void> {
    if (!alert.id || !alert.projectId) {
      return;
    }

    try {
      const rules: Array<AlertOnCallRule> = await AlertOnCallRuleService.findBy(
        {
          query: {
            projectId: alert.projectId,
            isEnabled: true,
          },
          props: { isRoot: true },
          select: {
            _id: true,
            name: true,
            monitors: { _id: true },
            alertSeverities: { _id: true },
            alertLabels: { _id: true },
            monitorLabels: { _id: true },
            alertTitlePattern: true,
            alertDescriptionPattern: true,
            monitorNamePattern: true,
            monitorDescriptionPattern: true,
            onCallDutyPolicies: { _id: true },
          },
          limit: 100,
          skip: 0,
        },
      );

      if (rules.length === 0) {
        return;
      }

      const matchedPolicies: Map<string, OnCallDutyPolicy> = new Map();

      for (const rule of rules) {
        const matches: boolean = await this.doesAlertMatchRule(alert, rule);
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
        (alert.onCallDutyPolicies || [])
          .map((p: OnCallDutyPolicy) => {
            return p.id?.toString() || (p as { _id?: string })._id || "";
          })
          .filter((id: string) => {
            return id !== "";
          }),
      );

      const merged: Array<OnCallDutyPolicy> = [
        ...(alert.onCallDutyPolicies || []),
      ];

      for (const [policyId, policy] of matchedPolicies) {
        if (!existingIds.has(policyId)) {
          merged.push(policy);
        }
      }

      alert.onCallDutyPolicies = merged;

      logger.debug(
        `AlertOnCallRuleEngine merged ${matchedPolicies.size} matched policies into alert ${alert.id}`,
        { projectId: alert.projectId.toString() } as LogAttributes,
      );
    } catch (error) {
      logger.error(`Error applying alert on-call rules: ${error}`, {
        projectId: alert.projectId?.toString(),
        alertId: alert.id?.toString(),
      } as LogAttributes);
    }
  }

  @CaptureSpan()
  private async doesAlertMatchRule(
    alert: Alert,
    rule: AlertOnCallRule,
  ): Promise<boolean> {
    // Monitors: alert must come from one of the rule's monitors
    if (rule.monitors && rule.monitors.length > 0) {
      if (!alert.monitorId) {
        return false;
      }
      const ruleMonitorIds: Array<string> = rule.monitors.map((m: Monitor) => {
        return m.id?.toString() || "";
      });
      if (!ruleMonitorIds.includes(alert.monitorId.toString())) {
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

    // Alert labels
    if (rule.alertLabels && rule.alertLabels.length > 0) {
      if (!alert.labels || alert.labels.length === 0) {
        return false;
      }
      const ruleLabelIds: Array<string> = rule.alertLabels.map((l: Label) => {
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

    // Monitor-derived criteria
    const hasMonitorCriteria: boolean = Boolean(
      (rule.monitorLabels && rule.monitorLabels.length > 0) ||
        rule.monitorNamePattern ||
        rule.monitorDescriptionPattern,
    );

    if (hasMonitorCriteria) {
      if (!alert.monitorId) {
        return false;
      }

      const monitor: Monitor | null = await MonitorService.findOneById({
        id: alert.monitorId,
        select: {
          name: true,
          description: true,
          labels: { _id: true },
        },
        props: { isRoot: true },
      });

      if (!monitor) {
        return false;
      }

      if (rule.monitorLabels && rule.monitorLabels.length > 0) {
        if (!monitor.labels || monitor.labels.length === 0) {
          return false;
        }
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
          return false;
        }
      }

      if (rule.monitorNamePattern) {
        if (
          !monitor.name ||
          !this.testRegex(rule.monitorNamePattern, monitor.name, rule)
        ) {
          return false;
        }
      }

      if (rule.monitorDescriptionPattern) {
        if (
          !monitor.description ||
          !this.testRegex(
            rule.monitorDescriptionPattern,
            monitor.description,
            rule,
          )
        ) {
          return false;
        }
      }
    }

    if (rule.alertTitlePattern) {
      if (
        !alert.title ||
        !this.testRegex(rule.alertTitlePattern, alert.title, rule)
      ) {
        return false;
      }
    }

    if (rule.alertDescriptionPattern) {
      if (
        !alert.description ||
        !this.testRegex(rule.alertDescriptionPattern, alert.description, rule)
      ) {
        return false;
      }
    }

    return true;
  }

  private testRegex(
    pattern: string,
    value: string,
    rule: AlertOnCallRule,
  ): boolean {
    try {
      const regex: RegExp = new RegExp(pattern, "i");
      return regex.test(value);
    } catch {
      logger.warn(
        `Invalid regex pattern in alert on-call rule ${rule.id}: ${pattern}`,
      );
      return false;
    }
  }
}

export default new AlertOnCallRuleEngineServiceClass();
