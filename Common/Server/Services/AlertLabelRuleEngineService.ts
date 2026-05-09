import Alert from "../../Models/DatabaseModels/Alert";
import AlertLabelRule from "../../Models/DatabaseModels/AlertLabelRule";
import AlertSeverity from "../../Models/DatabaseModels/AlertSeverity";
import Label from "../../Models/DatabaseModels/Label";
import Monitor from "../../Models/DatabaseModels/Monitor";
import AlertLabelRuleService from "./AlertLabelRuleService";
import AlertService from "./AlertService";
import MonitorService from "./MonitorService";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger, { LogAttributes } from "../Utils/Logger";

class AlertLabelRuleEngineServiceClass {
  /**
   * Evaluates AlertLabelRule rows for the given alert and attaches matched
   * labels to the alert. Each matched rule contributes:
   *   - labels listed on `labelsToAdd`
   *   - all labels of the alert's monitor when `inheritLabelsFromMonitors`
   * The union is deduped against labels already on the alert before insert
   * to avoid PK conflicts on the AlertLabel join table.
   */
  @CaptureSpan()
  public async applyRulesToAlert(alert: Alert): Promise<void> {
    if (!alert.id || !alert.projectId) {
      return;
    }

    try {
      const rules: Array<AlertLabelRule> = await AlertLabelRuleService.findBy({
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
          labelsToAdd: { _id: true },
          inheritLabelsFromMonitors: true,
        },
        limit: 100,
        skip: 0,
      });

      if (rules.length === 0) {
        return;
      }

      const labelIdsToAdd: Set<string> = new Set();
      let inheritFromMonitors: boolean = false;

      for (const rule of rules) {
        const matches: boolean = await this.doesAlertMatchRule(alert, rule);
        if (!matches) {
          continue;
        }
        for (const label of rule.labelsToAdd || []) {
          if (label.id) {
            labelIdsToAdd.add(label.id.toString());
          }
        }
        if (rule.inheritLabelsFromMonitors) {
          inheritFromMonitors = true;
        }
      }

      if (inheritFromMonitors && alert.monitorId) {
        const monitor: Monitor | null = await MonitorService.findOneById({
          id: alert.monitorId,
          select: { labels: { _id: true } },
          props: { isRoot: true },
        });
        for (const label of monitor?.labels || []) {
          if (label.id) {
            labelIdsToAdd.add(label.id.toString());
          }
        }
      }

      if (labelIdsToAdd.size === 0) {
        return;
      }

      const alertWithLabels: Alert | null = await AlertService.findOneById({
        id: alert.id,
        select: { labels: { _id: true } },
        props: { isRoot: true },
      });
      const existingLabelIds: Set<string> = new Set(
        (alertWithLabels?.labels || [])
          .map((l: Label) => {
            return l.id?.toString() || "";
          })
          .filter((id: string) => {
            return id !== "";
          }),
      );

      const newLabelIds: Array<string> = Array.from(labelIdsToAdd).filter(
        (id: string) => {
          return !existingLabelIds.has(id);
        },
      );
      if (newLabelIds.length === 0) {
        return;
      }

      await AlertService.getRepository()
        .createQueryBuilder()
        .relation(Alert, "labels")
        .of(alert.id.toString())
        .add(newLabelIds);

      logger.debug(
        `AlertLabelRuleEngine attached ${newLabelIds.length} labels to alert ${alert.id}`,
        { projectId: alert.projectId.toString() } as LogAttributes,
      );
    } catch (error) {
      logger.error(`Error applying alert label rules: ${error}`, {
        projectId: alert.projectId?.toString(),
        alertId: alert.id?.toString(),
      } as LogAttributes);
    }
  }

  @CaptureSpan()
  private async doesAlertMatchRule(
    alert: Alert,
    rule: AlertLabelRule,
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
    rule: AlertLabelRule,
  ): boolean {
    try {
      const regex: RegExp = new RegExp(pattern, "i");
      return regex.test(value);
    } catch {
      logger.warn(`Invalid regex in alert label rule ${rule.id}: ${pattern}`);
      return false;
    }
  }
}

export default new AlertLabelRuleEngineServiceClass();
