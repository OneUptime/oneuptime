import Alert from "../../Models/DatabaseModels/Alert";
import AlertPrivacyRule from "../../Models/DatabaseModels/AlertPrivacyRule";
import AlertSeverity from "../../Models/DatabaseModels/AlertSeverity";
import Label from "../../Models/DatabaseModels/Label";
import Monitor from "../../Models/DatabaseModels/Monitor";
import AlertFeedService from "./AlertFeedService";
import AlertPrivacyRuleService from "./AlertPrivacyRuleService";
import AlertService from "./AlertService";
import MonitorService from "./MonitorService";
import { AlertFeedEventType } from "../../Models/DatabaseModels/AlertFeed";
import { Red500 } from "../../Types/BrandColors";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger, { LogAttributes } from "../Utils/Logger";

class AlertPrivacyRuleEngineServiceClass {
  /**
   * Evaluates AlertPrivacyRule rows for the given alert. If any enabled rule
   * matches, the alert is marked private (isPrivate=true) and the passed-in
   * alert object is mutated in place so downstream callers see the update.
   *
   * Returns true if the alert was marked private by a rule.
   */
  @CaptureSpan()
  public async applyRulesToAlert(alert: Alert): Promise<boolean> {
    if (!alert.id || !alert.projectId) {
      return false;
    }

    if (alert.isPrivate === true) {
      // Already private — nothing to do.
      return false;
    }

    try {
      const rules: Array<AlertPrivacyRule> =
        await AlertPrivacyRuleService.findBy({
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
          },
          limit: 100,
          skip: 0,
        });

      if (rules.length === 0) {
        return false;
      }

      const matchedRules: Array<AlertPrivacyRule> = [];
      for (const rule of rules) {
        const matches: boolean = await this.doesAlertMatchRule(alert, rule);
        if (matches) {
          matchedRules.push(rule);
        }
      }

      if (matchedRules.length === 0) {
        return false;
      }

      await AlertService.updateOneById({
        id: alert.id,
        data: { isPrivate: true },
        props: { isRoot: true },
      });

      // Mirror in memory so downstream onCreateSuccess steps see the change.
      alert.isPrivate = true;

      logger.debug(`AlertPrivacyRuleEngine marked alert ${alert.id} private`, {
        projectId: alert.projectId.toString(),
      } as LogAttributes);

      await this.createRuleExecutedFeedItem({ alert, matchedRules });

      return true;
    } catch (error) {
      logger.error(`Error applying alert privacy rules: ${error}`, {
        projectId: alert.projectId?.toString(),
        alertId: alert.id?.toString(),
      } as LogAttributes);
      return false;
    }
  }

  @CaptureSpan()
  private async createRuleExecutedFeedItem(data: {
    alert: Alert;
    matchedRules: Array<AlertPrivacyRule>;
  }): Promise<void> {
    const { alert, matchedRules } = data;
    if (!alert.id || !alert.projectId || matchedRules.length === 0) {
      return;
    }

    try {
      const ruleNames: Array<string> = matchedRules
        .map((r: AlertPrivacyRule) => {
          return r.name?.toString() || "Unnamed Rule";
        })
        .filter((n: string) => {
          return n !== "";
        });

      const rulesPart: string =
        ruleNames.length === 1
          ? `**${ruleNames[0]}**`
          : ruleNames
              .map((n: string) => {
                return `**${n}**`;
              })
              .join(", ");

      const feedInfoInMarkdown: string = `🔒 **Alert Privacy Rule${
        matchedRules.length > 1 ? "s" : ""
      } executed:** ${rulesPart}\n\nAlert has been marked **private** — visible only to its owners, project admins, and project owners.`;

      await AlertFeedService.createAlertFeedItem({
        alertId: alert.id,
        projectId: alert.projectId,
        alertFeedEventType: AlertFeedEventType.PrivacyRuleExecuted,
        displayColor: Red500,
        feedInfoInMarkdown,
      });
    } catch (error) {
      logger.error(
        `AlertPrivacyRuleEngine: failed to create rule-executed feed item: ${
          error instanceof Error ? error.message : String(error)
        }`,
        {
          projectId: alert.projectId?.toString(),
          alertId: alert.id?.toString(),
        } as LogAttributes,
      );
    }
  }

  @CaptureSpan()
  private async doesAlertMatchRule(
    alert: Alert,
    rule: AlertPrivacyRule,
  ): Promise<boolean> {
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
      if (
        !ruleLabelIds.some((id: string) => {
          return alertLabelIds.includes(id);
        })
      ) {
        return false;
      }
    }

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
        if (
          !ruleMonitorLabelIds.some((id: string) => {
            return monitorLabelIds.includes(id);
          })
        ) {
          return false;
        }
      }

      if (
        rule.monitorNamePattern &&
        (!monitor.name ||
          !this.testRegex(rule.monitorNamePattern, monitor.name, rule))
      ) {
        return false;
      }

      if (
        rule.monitorDescriptionPattern &&
        (!monitor.description ||
          !this.testRegex(
            rule.monitorDescriptionPattern,
            monitor.description,
            rule,
          ))
      ) {
        return false;
      }
    }

    if (
      rule.alertTitlePattern &&
      (!alert.title ||
        !this.testRegex(rule.alertTitlePattern, alert.title, rule))
    ) {
      return false;
    }

    if (
      rule.alertDescriptionPattern &&
      (!alert.description ||
        !this.testRegex(rule.alertDescriptionPattern, alert.description, rule))
    ) {
      return false;
    }

    return true;
  }

  private testRegex(
    pattern: string,
    value: string,
    rule: AlertPrivacyRule,
  ): boolean {
    try {
      const regex: RegExp = new RegExp(pattern, "i");
      return regex.test(value);
    } catch {
      logger.warn(`Invalid regex in alert privacy rule ${rule.id}: ${pattern}`);
      return false;
    }
  }
}

export default new AlertPrivacyRuleEngineServiceClass();
