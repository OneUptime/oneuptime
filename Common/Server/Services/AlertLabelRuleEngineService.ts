import Alert from "../../Models/DatabaseModels/Alert";
import AlertLabelRule from "../../Models/DatabaseModels/AlertLabelRule";
import AlertSeverity from "../../Models/DatabaseModels/AlertSeverity";
import DockerHost from "../../Models/DatabaseModels/DockerHost";
import Host from "../../Models/DatabaseModels/Host";
import KubernetesCluster from "../../Models/DatabaseModels/KubernetesCluster";
import Label from "../../Models/DatabaseModels/Label";
import Monitor from "../../Models/DatabaseModels/Monitor";
import Service from "../../Models/DatabaseModels/Service";
import AlertFeedService from "./AlertFeedService";
import AlertLabelRuleService from "./AlertLabelRuleService";
import AlertService from "./AlertService";
import DockerHostService from "./DockerHostService";
import HostService from "./HostService";
import KubernetesClusterService from "./KubernetesClusterService";
import LabelService from "./LabelService";
import MonitorService from "./MonitorService";
import ServiceService from "./ServiceService";
import { AlertFeedEventType } from "../../Models/DatabaseModels/AlertFeed";
import { Indigo500 } from "../../Types/BrandColors";
import ObjectID from "../../Types/ObjectID";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import QueryHelper from "../Types/Database/QueryHelper";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger, { LogAttributes } from "../Utils/Logger";

class AlertLabelRuleEngineServiceClass {
  /**
   * Evaluates AlertLabelRule rows for the given alert and attaches matched
   * labels to the alert. Each matched rule contributes:
   *   - labels listed on `labelsToAdd`
   *   - all labels of the alert's monitor when `inheritLabelsFromMonitors`
   *   - all labels of the alert's hosts when `inheritLabelsFromHosts`
   *   - all labels of the alert's Kubernetes clusters when `inheritLabelsFromKubernetesClusters`
   *   - all labels of the alert's Docker hosts when `inheritLabelsFromDockerHosts`
   *   - all labels of the alert's services when `inheritLabelsFromServices`
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
          inheritLabelsFromHosts: true,
          inheritLabelsFromKubernetesClusters: true,
          inheritLabelsFromDockerHosts: true,
          inheritLabelsFromServices: true,
        },
        limit: 100,
        skip: 0,
      });

      if (rules.length === 0) {
        return;
      }

      const labelIdsToAdd: Set<string> = new Set();
      let inheritFromMonitors: boolean = false;
      let inheritFromHosts: boolean = false;
      let inheritFromKubernetesClusters: boolean = false;
      let inheritFromDockerHosts: boolean = false;
      let inheritFromServices: boolean = false;
      const matchedRules: Array<AlertLabelRule> = [];

      for (const rule of rules) {
        const matches: boolean = await this.doesAlertMatchRule(alert, rule);
        if (!matches) {
          continue;
        }
        matchedRules.push(rule);
        for (const label of rule.labelsToAdd || []) {
          if (label.id) {
            labelIdsToAdd.add(label.id.toString());
          }
        }
        if (rule.inheritLabelsFromMonitors) {
          inheritFromMonitors = true;
        }
        if (rule.inheritLabelsFromHosts) {
          inheritFromHosts = true;
        }
        if (rule.inheritLabelsFromKubernetesClusters) {
          inheritFromKubernetesClusters = true;
        }
        if (rule.inheritLabelsFromDockerHosts) {
          inheritFromDockerHosts = true;
        }
        if (rule.inheritLabelsFromServices) {
          inheritFromServices = true;
        }
      }

      const needsRelatedResources: boolean =
        inheritFromHosts ||
        inheritFromKubernetesClusters ||
        inheritFromDockerHosts ||
        inheritFromServices;

      let alertWithResources: Alert | null = null;
      if (needsRelatedResources) {
        alertWithResources = await AlertService.findOneById({
          id: alert.id,
          select: {
            hosts: { _id: true },
            kubernetesClusters: { _id: true },
            dockerHosts: { _id: true },
            services: { _id: true },
          },
          props: { isRoot: true },
        });
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

      if (inheritFromHosts && alertWithResources?.hosts?.length) {
        for (const alertHost of alertWithResources.hosts) {
          if (!alertHost.id) {
            continue;
          }
          const host: Host | null = await HostService.findOneById({
            id: alertHost.id,
            select: { labels: { _id: true } },
            props: { isRoot: true },
          });
          for (const label of host?.labels || []) {
            if (label.id) {
              labelIdsToAdd.add(label.id.toString());
            }
          }
        }
      }

      if (
        inheritFromKubernetesClusters &&
        alertWithResources?.kubernetesClusters?.length
      ) {
        for (const alertCluster of alertWithResources.kubernetesClusters) {
          if (!alertCluster.id) {
            continue;
          }
          const cluster: KubernetesCluster | null =
            await KubernetesClusterService.findOneById({
              id: alertCluster.id,
              select: { labels: { _id: true } },
              props: { isRoot: true },
            });
          for (const label of cluster?.labels || []) {
            if (label.id) {
              labelIdsToAdd.add(label.id.toString());
            }
          }
        }
      }

      if (inheritFromDockerHosts && alertWithResources?.dockerHosts?.length) {
        for (const alertDockerHost of alertWithResources.dockerHosts) {
          if (!alertDockerHost.id) {
            continue;
          }
          const dockerHost: DockerHost | null =
            await DockerHostService.findOneById({
              id: alertDockerHost.id,
              select: { labels: { _id: true } },
              props: { isRoot: true },
            });
          for (const label of dockerHost?.labels || []) {
            if (label.id) {
              labelIdsToAdd.add(label.id.toString());
            }
          }
        }
      }

      if (inheritFromServices && alertWithResources?.services?.length) {
        for (const alertService of alertWithResources.services) {
          if (!alertService.id) {
            continue;
          }
          const service: Service | null = await ServiceService.findOneById({
            id: alertService.id,
            select: { labels: { _id: true } },
            props: { isRoot: true },
          });
          for (const label of service?.labels || []) {
            if (label.id) {
              labelIdsToAdd.add(label.id.toString());
            }
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

      /*
       * Sync in-memory alert.labels with the now-persisted set so downstream
       * rule engines (AlertOnCallRuleEngineService) can match on these labels
       * in the same onCreateSuccess chain. Without this, the on-call engine sees
       * only the criteria-time labels and skips rules keyed on rule-added labels.
       */
      const mergedLabelIds: Set<string> = new Set([
        ...existingLabelIds,
        ...newLabelIds,
      ]);
      alert.labels = Array.from(mergedLabelIds).map((id: string) => {
        const label: Label = new Label();
        label.id = new ObjectID(id);
        return label;
      });

      logger.debug(
        `AlertLabelRuleEngine attached ${newLabelIds.length} labels to alert ${alert.id}`,
        { projectId: alert.projectId.toString() } as LogAttributes,
      );

      await this.createRuleExecutedFeedItem({
        alert,
        matchedRules,
        addedLabelIds: newLabelIds,
      });
    } catch (error) {
      logger.error(`Error applying alert label rules: ${error}`, {
        projectId: alert.projectId?.toString(),
        alertId: alert.id?.toString(),
      } as LogAttributes);
    }
  }

  @CaptureSpan()
  private async createRuleExecutedFeedItem(data: {
    alert: Alert;
    matchedRules: Array<AlertLabelRule>;
    addedLabelIds: Array<string>;
  }): Promise<void> {
    const { alert, matchedRules, addedLabelIds } = data;
    if (
      !alert.id ||
      !alert.projectId ||
      matchedRules.length === 0 ||
      addedLabelIds.length === 0
    ) {
      return;
    }

    try {
      const labelObjectIds: Array<ObjectID> = addedLabelIds.map(
        (id: string) => {
          return new ObjectID(id);
        },
      );

      const labels: Array<Label> = await LabelService.findBy({
        query: {
          _id: QueryHelper.any(labelObjectIds),
        },
        select: { name: true },
        props: { isRoot: true },
        limit: LIMIT_MAX,
        skip: 0,
      });

      const labelNames: Array<string> = labels
        .map((l: Label) => {
          return l.name?.toString() || "";
        })
        .filter((n: string) => {
          return n !== "";
        });

      const ruleNames: Array<string> = matchedRules
        .map((r: AlertLabelRule) => {
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

      const labelsPart: string =
        labelNames.length > 0
          ? labelNames
              .map((n: string) => {
                return `\n- ${n}`;
              })
              .join("")
          : "\n- (no named labels)";

      const feedInfoInMarkdown: string = `🏷️ **Alert Label Rule${
        matchedRules.length > 1 ? "s" : ""
      } executed:** ${rulesPart}\n\nAdded the following label${
        labelNames.length === 1 ? "" : "s"
      } to the alert:${labelsPart}`;

      await AlertFeedService.createAlertFeedItem({
        alertId: alert.id,
        projectId: alert.projectId,
        alertFeedEventType: AlertFeedEventType.LabelRuleExecuted,
        displayColor: Indigo500,
        feedInfoInMarkdown,
      });
    } catch (error) {
      logger.error(
        `AlertLabelRuleEngine: failed to create rule-executed feed item: ${
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
