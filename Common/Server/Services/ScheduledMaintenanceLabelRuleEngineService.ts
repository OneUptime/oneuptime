import DockerHost from "../../Models/DatabaseModels/DockerHost";
import Host from "../../Models/DatabaseModels/Host";
import KubernetesCluster from "../../Models/DatabaseModels/KubernetesCluster";
import Label from "../../Models/DatabaseModels/Label";
import Monitor from "../../Models/DatabaseModels/Monitor";
import ScheduledMaintenance from "../../Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceLabelRule from "../../Models/DatabaseModels/ScheduledMaintenanceLabelRule";
import DockerHostService from "./DockerHostService";
import HostService from "./HostService";
import KubernetesClusterService from "./KubernetesClusterService";
import LabelService from "./LabelService";
import MonitorService from "./MonitorService";
import ScheduledMaintenanceFeedService from "./ScheduledMaintenanceFeedService";
import ScheduledMaintenanceLabelRuleService from "./ScheduledMaintenanceLabelRuleService";
import ScheduledMaintenanceService from "./ScheduledMaintenanceService";
import { ScheduledMaintenanceFeedEventType } from "../../Models/DatabaseModels/ScheduledMaintenanceFeed";
import { Indigo500 } from "../../Types/BrandColors";
import ObjectID from "../../Types/ObjectID";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import QueryHelper from "../Types/Database/QueryHelper";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger, { LogAttributes } from "../Utils/Logger";

class ScheduledMaintenanceLabelRuleEngineServiceClass {
  /**
   * Evaluates ScheduledMaintenanceLabelRule rows for the given event and
   * attaches matched labels to the event. Each matched rule contributes:
   *   - labels listed on `labelsToAdd`
   *   - all labels of the event's monitors when `inheritLabelsFromMonitors`
   *   - all labels of the event's hosts when `inheritLabelsFromHosts`
   *   - all labels of the event's Kubernetes clusters when `inheritLabelsFromKubernetesClusters`
   *   - all labels of the event's Docker hosts when `inheritLabelsFromDockerHosts`
   * The union is deduped against labels already on the event before insert
   * to avoid PK conflicts on the ScheduledMaintenanceLabel join table.
   */
  @CaptureSpan()
  public async applyRulesToScheduledMaintenance(
    scheduledMaintenance: ScheduledMaintenance,
  ): Promise<void> {
    if (!scheduledMaintenance.id || !scheduledMaintenance.projectId) {
      return;
    }

    try {
      const rules: Array<ScheduledMaintenanceLabelRule> =
        await ScheduledMaintenanceLabelRuleService.findBy({
          query: {
            projectId: scheduledMaintenance.projectId,
            isEnabled: true,
          },
          props: { isRoot: true },
          select: {
            _id: true,
            name: true,
            monitors: { _id: true },
            scheduledMaintenanceLabels: { _id: true },
            monitorLabels: { _id: true },
            titlePattern: true,
            descriptionPattern: true,
            monitorNamePattern: true,
            monitorDescriptionPattern: true,
            labelsToAdd: { _id: true },
            inheritLabelsFromMonitors: true,
            inheritLabelsFromHosts: true,
            inheritLabelsFromKubernetesClusters: true,
            inheritLabelsFromDockerHosts: true,
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
      const matchedRules: Array<ScheduledMaintenanceLabelRule> = [];

      for (const rule of rules) {
        const matches: boolean = await this.doesScheduledMaintenanceMatchRule(
          scheduledMaintenance,
          rule,
        );
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
      }

      const needsRelatedResources: boolean =
        inheritFromHosts ||
        inheritFromKubernetesClusters ||
        inheritFromDockerHosts;

      let eventWithResources: ScheduledMaintenance | null = null;
      if (needsRelatedResources) {
        eventWithResources = await ScheduledMaintenanceService.findOneById({
          id: scheduledMaintenance.id,
          select: {
            hosts: { _id: true },
            kubernetesClusters: { _id: true },
            dockerHosts: { _id: true },
          },
          props: { isRoot: true },
        });
      }

      if (inheritFromMonitors && scheduledMaintenance.monitors?.length) {
        for (const eventMonitor of scheduledMaintenance.monitors) {
          if (!eventMonitor.id) {
            continue;
          }
          const monitor: Monitor | null = await MonitorService.findOneById({
            id: eventMonitor.id,
            select: { labels: { _id: true } },
            props: { isRoot: true },
          });
          for (const label of monitor?.labels || []) {
            if (label.id) {
              labelIdsToAdd.add(label.id.toString());
            }
          }
        }
      }

      if (inheritFromHosts && eventWithResources?.hosts?.length) {
        for (const eventHost of eventWithResources.hosts) {
          if (!eventHost.id) {
            continue;
          }
          const host: Host | null = await HostService.findOneById({
            id: eventHost.id,
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
        eventWithResources?.kubernetesClusters?.length
      ) {
        for (const eventCluster of eventWithResources.kubernetesClusters) {
          if (!eventCluster.id) {
            continue;
          }
          const cluster: KubernetesCluster | null =
            await KubernetesClusterService.findOneById({
              id: eventCluster.id,
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

      if (inheritFromDockerHosts && eventWithResources?.dockerHosts?.length) {
        for (const eventDockerHost of eventWithResources.dockerHosts) {
          if (!eventDockerHost.id) {
            continue;
          }
          const dockerHost: DockerHost | null =
            await DockerHostService.findOneById({
              id: eventDockerHost.id,
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

      if (labelIdsToAdd.size === 0) {
        return;
      }

      const eventWithLabels: ScheduledMaintenance | null =
        await ScheduledMaintenanceService.findOneById({
          id: scheduledMaintenance.id,
          select: { labels: { _id: true } },
          props: { isRoot: true },
        });
      const existingLabelIds: Set<string> = new Set(
        (eventWithLabels?.labels || [])
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

      await ScheduledMaintenanceService.getRepository()
        .createQueryBuilder()
        .relation(ScheduledMaintenance, "labels")
        .of(scheduledMaintenance.id.toString())
        .add(newLabelIds);

      /*
       * Sync in-memory event.labels with the now-persisted set so any
       * downstream consumers in the same onCreateSuccess chain see the new
       * labels.
       */
      const mergedLabelIds: Set<string> = new Set([
        ...existingLabelIds,
        ...newLabelIds,
      ]);
      scheduledMaintenance.labels = Array.from(mergedLabelIds).map(
        (id: string) => {
          const label: Label = new Label();
          label.id = new ObjectID(id);
          return label;
        },
      );

      logger.debug(
        `ScheduledMaintenanceLabelRuleEngine attached ${newLabelIds.length} labels to event ${scheduledMaintenance.id}`,
        {
          projectId: scheduledMaintenance.projectId.toString(),
        } as LogAttributes,
      );

      await this.createRuleExecutedFeedItem({
        scheduledMaintenance,
        matchedRules,
        addedLabelIds: newLabelIds,
      });
    } catch (error) {
      logger.error(
        `Error applying scheduled maintenance label rules: ${error}`,
        {
          projectId: scheduledMaintenance.projectId?.toString(),
          scheduledMaintenanceId: scheduledMaintenance.id?.toString(),
        } as LogAttributes,
      );
    }
  }

  @CaptureSpan()
  private async createRuleExecutedFeedItem(data: {
    scheduledMaintenance: ScheduledMaintenance;
    matchedRules: Array<ScheduledMaintenanceLabelRule>;
    addedLabelIds: Array<string>;
  }): Promise<void> {
    const { scheduledMaintenance, matchedRules, addedLabelIds } = data;
    if (
      !scheduledMaintenance.id ||
      !scheduledMaintenance.projectId ||
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
        .map((r: ScheduledMaintenanceLabelRule) => {
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

      const feedInfoInMarkdown: string = `🏷️ **Scheduled Maintenance Label Rule${
        matchedRules.length > 1 ? "s" : ""
      } executed:** ${rulesPart}\n\nAdded the following label${
        labelNames.length === 1 ? "" : "s"
      } to the event:${labelsPart}`;

      await ScheduledMaintenanceFeedService.createScheduledMaintenanceFeedItem({
        scheduledMaintenanceId: scheduledMaintenance.id,
        projectId: scheduledMaintenance.projectId,
        scheduledMaintenanceFeedEventType:
          ScheduledMaintenanceFeedEventType.LabelRuleExecuted,
        displayColor: Indigo500,
        feedInfoInMarkdown,
      });
    } catch (error) {
      logger.error(
        `ScheduledMaintenanceLabelRuleEngine: failed to create rule-executed feed item: ${
          error instanceof Error ? error.message : String(error)
        }`,
        {
          projectId: scheduledMaintenance.projectId?.toString(),
          scheduledMaintenanceId: scheduledMaintenance.id?.toString(),
        } as LogAttributes,
      );
    }
  }

  @CaptureSpan()
  private async doesScheduledMaintenanceMatchRule(
    scheduledMaintenance: ScheduledMaintenance,
    rule: ScheduledMaintenanceLabelRule,
  ): Promise<boolean> {
    if (rule.monitors && rule.monitors.length > 0) {
      if (
        !scheduledMaintenance.monitors ||
        scheduledMaintenance.monitors.length === 0
      ) {
        return false;
      }
      const ruleMonitorIds: Array<string> = rule.monitors.map((m: Monitor) => {
        return m.id?.toString() || "";
      });
      const eventMonitorIds: Array<string> = scheduledMaintenance.monitors.map(
        (m: Monitor) => {
          return m.id?.toString() || "";
        },
      );
      if (
        !ruleMonitorIds.some((id: string) => {
          return eventMonitorIds.includes(id);
        })
      ) {
        return false;
      }
    }

    if (
      rule.scheduledMaintenanceLabels &&
      rule.scheduledMaintenanceLabels.length > 0
    ) {
      if (
        !scheduledMaintenance.labels ||
        scheduledMaintenance.labels.length === 0
      ) {
        return false;
      }
      const ruleLabelIds: Array<string> = rule.scheduledMaintenanceLabels.map(
        (l: Label) => {
          return l.id?.toString() || "";
        },
      );
      const eventLabelIds: Array<string> = scheduledMaintenance.labels.map(
        (l: Label) => {
          return l.id?.toString() || "";
        },
      );
      if (
        !ruleLabelIds.some((id: string) => {
          return eventLabelIds.includes(id);
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
      if (
        !scheduledMaintenance.monitors ||
        scheduledMaintenance.monitors.length === 0
      ) {
        return false;
      }

      let anyMonitorMatches: boolean = false;
      for (const eventMonitor of scheduledMaintenance.monitors) {
        if (!eventMonitor.id) {
          continue;
        }
        const monitor: Monitor | null = await MonitorService.findOneById({
          id: eventMonitor.id,
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
            if (
              !ruleMonitorLabelIds.some((id: string) => {
                return monitorLabelIds.includes(id);
              })
            ) {
              monitorMatches = false;
            }
          }
        }

        if (
          monitorMatches &&
          rule.monitorNamePattern &&
          (!monitor.name ||
            !this.testRegex(rule.monitorNamePattern, monitor.name, rule))
        ) {
          monitorMatches = false;
        }

        if (
          monitorMatches &&
          rule.monitorDescriptionPattern &&
          (!monitor.description ||
            !this.testRegex(
              rule.monitorDescriptionPattern,
              monitor.description,
              rule,
            ))
        ) {
          monitorMatches = false;
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

    if (
      rule.titlePattern &&
      (!scheduledMaintenance.title ||
        !this.testRegex(rule.titlePattern, scheduledMaintenance.title, rule))
    ) {
      return false;
    }

    if (
      rule.descriptionPattern &&
      (!scheduledMaintenance.description ||
        !this.testRegex(
          rule.descriptionPattern,
          scheduledMaintenance.description,
          rule,
        ))
    ) {
      return false;
    }

    return true;
  }

  private testRegex(
    pattern: string,
    value: string,
    rule: ScheduledMaintenanceLabelRule,
  ): boolean {
    try {
      const regex: RegExp = new RegExp(pattern, "i");
      return regex.test(value);
    } catch {
      logger.warn(
        `Invalid regex in scheduled maintenance label rule ${rule.id}: ${pattern}`,
      );
      return false;
    }
  }
}

export default new ScheduledMaintenanceLabelRuleEngineServiceClass();
