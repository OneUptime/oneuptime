import Alert from "../../Models/DatabaseModels/Alert";
import AlertOwnerRule from "../../Models/DatabaseModels/AlertOwnerRule";
import AlertSeverity from "../../Models/DatabaseModels/AlertSeverity";
import Label from "../../Models/DatabaseModels/Label";
import Monitor from "../../Models/DatabaseModels/Monitor";
import AlertOwnerRuleService from "./AlertOwnerRuleService";
import AlertService from "./AlertService";
import MonitorService from "./MonitorService";
import ObjectID from "../../Types/ObjectID";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger, { LogAttributes } from "../Utils/Logger";

class AlertOwnerRuleEngineServiceClass {
  /**
   * Evaluates AlertOwnerRule rows for the given alert and adds matched
   * owner users / teams via AlertService.addOwners.
   */
  @CaptureSpan()
  public async applyRulesToAlert(alert: Alert): Promise<void> {
    if (!alert.id || !alert.projectId) {
      return;
    }

    try {
      const rules: Array<AlertOwnerRule> = await AlertOwnerRuleService.findBy({
        query: {
          projectId: alert.projectId,
          isEnabled: true,
        },
        props: { isRoot: true },
        select: {
          _id: true,
          name: true,
          notifyOwners: true,
          monitors: { _id: true },
          alertSeverities: { _id: true },
          alertLabels: { _id: true },
          monitorLabels: { _id: true },
          alertTitlePattern: true,
          alertDescriptionPattern: true,
          monitorNamePattern: true,
          monitorDescriptionPattern: true,
          ownerUsers: { _id: true },
          ownerTeams: { _id: true },
        },
        limit: 100,
        skip: 0,
      });

      if (rules.length === 0) {
        return;
      }

      const usersByNotify: Map<boolean, Set<string>> = new Map([
        [true, new Set()],
        [false, new Set()],
      ]);
      const teamsByNotify: Map<boolean, Set<string>> = new Map([
        [true, new Set()],
        [false, new Set()],
      ]);

      let matchedAny: boolean = false;

      for (const rule of rules) {
        const matches: boolean = await this.doesAlertMatchRule(alert, rule);
        if (!matches) {
          continue;
        }
        matchedAny = true;
        const notify: boolean = rule.notifyOwners !== false;
        for (const user of rule.ownerUsers || []) {
          if (user.id) {
            usersByNotify.get(notify)!.add(user.id.toString());
          }
        }
        for (const team of rule.ownerTeams || []) {
          if (team.id) {
            teamsByNotify.get(notify)!.add(team.id.toString());
          }
        }
      }

      if (!matchedAny) {
        return;
      }

      for (const notify of [true, false]) {
        const userIds: Array<ObjectID> = Array.from(
          usersByNotify.get(notify)!,
        ).map((id: string) => {
          return new ObjectID(id);
        });
        const teamIds: Array<ObjectID> = Array.from(
          teamsByNotify.get(notify)!,
        ).map((id: string) => {
          return new ObjectID(id);
        });

        if (userIds.length === 0 && teamIds.length === 0) {
          continue;
        }

        await AlertService.addOwners(
          alert.projectId,
          alert.id,
          userIds,
          teamIds,
          notify,
          { isRoot: true },
        );
      }

      logger.debug(`AlertOwnerRuleEngine added owners to alert ${alert.id}`, {
        projectId: alert.projectId.toString(),
      } as LogAttributes);
    } catch (error) {
      logger.error(`Error applying alert owner rules: ${error}`, {
        projectId: alert.projectId?.toString(),
        alertId: alert.id?.toString(),
      } as LogAttributes);
    }
  }

  @CaptureSpan()
  private async doesAlertMatchRule(
    alert: Alert,
    rule: AlertOwnerRule,
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
    rule: AlertOwnerRule,
  ): boolean {
    try {
      const regex: RegExp = new RegExp(pattern, "i");
      return regex.test(value);
    } catch {
      logger.warn(`Invalid regex in alert owner rule ${rule.id}: ${pattern}`);
      return false;
    }
  }
}

export default new AlertOwnerRuleEngineServiceClass();
