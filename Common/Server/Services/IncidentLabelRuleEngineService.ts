import Host from "../../Models/DatabaseModels/Host";
import Incident from "../../Models/DatabaseModels/Incident";
import IncidentLabelRule from "../../Models/DatabaseModels/IncidentLabelRule";
import IncidentSeverity from "../../Models/DatabaseModels/IncidentSeverity";
import Label from "../../Models/DatabaseModels/Label";
import Monitor from "../../Models/DatabaseModels/Monitor";
import HostService from "./HostService";
import IncidentFeedService from "./IncidentFeedService";
import IncidentLabelRuleService from "./IncidentLabelRuleService";
import IncidentService from "./IncidentService";
import LabelService from "./LabelService";
import MonitorService from "./MonitorService";
import { IncidentFeedEventType } from "../../Models/DatabaseModels/IncidentFeed";
import { Indigo500 } from "../../Types/BrandColors";
import ObjectID from "../../Types/ObjectID";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import QueryHelper from "../Types/Database/QueryHelper";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger, { LogAttributes } from "../Utils/Logger";

class IncidentLabelRuleEngineServiceClass {
  /**
   * Evaluates IncidentLabelRule rows for the given incident and attaches
   * matched labels to the incident. Each matched rule contributes:
   *   - labels listed on `labelsToAdd`
   *   - all labels of the incident's monitors when `inheritLabelsFromMonitors`
   *   - all labels of the incident's hosts when `inheritLabelsFromHosts`
   * The union is deduped against labels already on the incident before insert
   * to avoid PK conflicts on the IncidentLabel join table.
   */
  @CaptureSpan()
  public async applyRulesToIncident(incident: Incident): Promise<void> {
    if (!incident.id || !incident.projectId) {
      return;
    }

    try {
      const rules: Array<IncidentLabelRule> =
        await IncidentLabelRuleService.findBy({
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
            labelsToAdd: { _id: true },
            inheritLabelsFromMonitors: true,
            inheritLabelsFromHosts: true,
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
      const matchedRules: Array<IncidentLabelRule> = [];

      for (const rule of rules) {
        const matches: boolean = await this.doesIncidentMatchRule(
          incident,
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
      }

      if (inheritFromMonitors && incident.monitors?.length) {
        for (const incidentMonitor of incident.monitors) {
          if (!incidentMonitor.id) {
            continue;
          }
          const monitor: Monitor | null = await MonitorService.findOneById({
            id: incidentMonitor.id,
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

      if (inheritFromHosts && incident.hosts?.length) {
        for (const incidentHost of incident.hosts) {
          if (!incidentHost.id) {
            continue;
          }
          const host: Host | null = await HostService.findOneById({
            id: incidentHost.id,
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

      if (labelIdsToAdd.size === 0) {
        return;
      }

      const incidentWithLabels: Incident | null =
        await IncidentService.findOneById({
          id: incident.id,
          select: { labels: { _id: true } },
          props: { isRoot: true },
        });
      const existingLabelIds: Set<string> = new Set(
        (incidentWithLabels?.labels || [])
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

      await IncidentService.getRepository()
        .createQueryBuilder()
        .relation(Incident, "labels")
        .of(incident.id.toString())
        .add(newLabelIds);

      /*
       * Sync in-memory incident.labels with the now-persisted set so downstream
       * rule engines (IncidentOnCallRuleEngineService) can match on these labels
       * in the same onCreateSuccess chain. Without this, the on-call engine sees
       * only the criteria-time labels and skips rules keyed on rule-added labels.
       */
      const mergedLabelIds: Set<string> = new Set([
        ...existingLabelIds,
        ...newLabelIds,
      ]);
      incident.labels = Array.from(mergedLabelIds).map((id: string) => {
        const label: Label = new Label();
        label.id = new ObjectID(id);
        return label;
      });

      logger.debug(
        `IncidentLabelRuleEngine attached ${newLabelIds.length} labels to incident ${incident.id}`,
        { projectId: incident.projectId.toString() } as LogAttributes,
      );

      await this.createRuleExecutedFeedItem({
        incident,
        matchedRules,
        addedLabelIds: newLabelIds,
      });
    } catch (error) {
      logger.error(`Error applying incident label rules: ${error}`, {
        projectId: incident.projectId?.toString(),
        incidentId: incident.id?.toString(),
      } as LogAttributes);
    }
  }

  @CaptureSpan()
  private async createRuleExecutedFeedItem(data: {
    incident: Incident;
    matchedRules: Array<IncidentLabelRule>;
    addedLabelIds: Array<string>;
  }): Promise<void> {
    const { incident, matchedRules, addedLabelIds } = data;
    if (
      !incident.id ||
      !incident.projectId ||
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
        .map((r: IncidentLabelRule) => {
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

      const feedInfoInMarkdown: string = `🏷️ **Incident Label Rule${
        matchedRules.length > 1 ? "s" : ""
      } executed:** ${rulesPart}\n\nAdded the following label${
        labelNames.length === 1 ? "" : "s"
      } to the incident:${labelsPart}`;

      await IncidentFeedService.createIncidentFeedItem({
        incidentId: incident.id,
        projectId: incident.projectId,
        incidentFeedEventType: IncidentFeedEventType.LabelRuleExecuted,
        displayColor: Indigo500,
        feedInfoInMarkdown,
      });
    } catch (error) {
      logger.error(
        `IncidentLabelRuleEngine: failed to create rule-executed feed item: ${
          error instanceof Error ? error.message : String(error)
        }`,
        {
          projectId: incident.projectId?.toString(),
          incidentId: incident.id?.toString(),
        } as LogAttributes,
      );
    }
  }

  @CaptureSpan()
  private async doesIncidentMatchRule(
    incident: Incident,
    rule: IncidentLabelRule,
  ): Promise<boolean> {
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
      if (
        !ruleMonitorIds.some((id: string) => {
          return incidentMonitorIds.includes(id);
        })
      ) {
        return false;
      }
    }

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
      if (
        !ruleLabelIds.some((id: string) => {
          return incidentLabelIds.includes(id);
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
      rule.incidentTitlePattern &&
      (!incident.title ||
        !this.testRegex(rule.incidentTitlePattern, incident.title, rule))
    ) {
      return false;
    }

    if (
      rule.incidentDescriptionPattern &&
      (!incident.description ||
        !this.testRegex(
          rule.incidentDescriptionPattern,
          incident.description,
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
    rule: IncidentLabelRule,
  ): boolean {
    try {
      const regex: RegExp = new RegExp(pattern, "i");
      return regex.test(value);
    } catch {
      logger.warn(
        `Invalid regex in incident label rule ${rule.id}: ${pattern}`,
      );
      return false;
    }
  }
}

export default new IncidentLabelRuleEngineServiceClass();
