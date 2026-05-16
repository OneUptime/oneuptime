import Label from "../../Models/DatabaseModels/Label";
import Monitor from "../../Models/DatabaseModels/Monitor";
import MonitorLabelRule from "../../Models/DatabaseModels/MonitorLabelRule";
import LabelService from "./LabelService";
import MonitorFeedService from "./MonitorFeedService";
import MonitorLabelRuleService from "./MonitorLabelRuleService";
import MonitorService from "./MonitorService";
import { MonitorFeedEventType } from "../../Models/DatabaseModels/MonitorFeed";
import { Indigo500 } from "../../Types/BrandColors";
import ObjectID from "../../Types/ObjectID";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import QueryHelper from "../Types/Database/QueryHelper";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger, { LogAttributes } from "../Utils/Logger";

class MonitorLabelRuleEngineServiceClass {
  /**
   * Evaluates MonitorLabelRule rows for the given monitor and attaches matched
   * labels to it. The union is deduped against labels already on the monitor
   * before insert to avoid PK conflicts on the MonitorLabel join table.
   */
  @CaptureSpan()
  public async applyRulesToMonitor(monitor: Monitor): Promise<void> {
    if (!monitor.id || !monitor.projectId) {
      return;
    }

    try {
      const rules: Array<MonitorLabelRule> =
        await MonitorLabelRuleService.findBy({
          query: {
            projectId: monitor.projectId,
            isEnabled: true,
          },
          props: { isRoot: true },
          select: {
            _id: true,
            name: true,
            monitorLabels: { _id: true },
            monitorNamePattern: true,
            monitorDescriptionPattern: true,
            labelsToAdd: { _id: true },
          },
          limit: 100,
          skip: 0,
        });

      if (rules.length === 0) {
        return;
      }

      const monitorWithDetails: Monitor | null =
        await MonitorService.findOneById({
          id: monitor.id,
          select: {
            name: true,
            description: true,
            labels: { _id: true },
          },
          props: { isRoot: true },
        });

      if (!monitorWithDetails) {
        return;
      }

      const labelIdsToAdd: Set<string> = new Set();
      const matchedRules: Array<MonitorLabelRule> = [];

      for (const rule of rules) {
        const matches: boolean = this.doesMonitorMatchRule(
          monitorWithDetails,
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
      }

      if (labelIdsToAdd.size === 0) {
        return;
      }

      const existingLabelIds: Set<string> = new Set(
        (monitorWithDetails.labels || [])
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

      await MonitorService.getRepository()
        .createQueryBuilder()
        .relation(Monitor, "labels")
        .of(monitor.id.toString())
        .add(newLabelIds);

      /*
       * Sync in-memory monitor.labels with the now-persisted set so a downstream
       * owner-rule engine in the same onCreateSuccess chain can match on
       * rule-added labels.
       */
      const mergedLabelIds: Set<string> = new Set([
        ...existingLabelIds,
        ...newLabelIds,
      ]);
      monitor.labels = Array.from(mergedLabelIds).map((id: string) => {
        const label: Label = new Label();
        label.id = new ObjectID(id);
        return label;
      });

      logger.debug(
        `MonitorLabelRuleEngine attached ${newLabelIds.length} labels to monitor ${monitor.id}`,
        { projectId: monitor.projectId.toString() } as LogAttributes,
      );

      await this.createRuleExecutedFeedItem({
        monitor,
        matchedRules,
        addedLabelIds: newLabelIds,
      });
    } catch (error) {
      logger.error(`Error applying monitor label rules: ${error}`, {
        projectId: monitor.projectId?.toString(),
        monitorId: monitor.id?.toString(),
      } as LogAttributes);
    }
  }

  @CaptureSpan()
  private async createRuleExecutedFeedItem(data: {
    monitor: Monitor;
    matchedRules: Array<MonitorLabelRule>;
    addedLabelIds: Array<string>;
  }): Promise<void> {
    const { monitor, matchedRules, addedLabelIds } = data;
    if (
      !monitor.id ||
      !monitor.projectId ||
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
        query: { _id: QueryHelper.any(labelObjectIds) },
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
        .map((r: MonitorLabelRule) => {
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

      const feedInfoInMarkdown: string = `🏷️ **Monitor Label Rule${
        matchedRules.length > 1 ? "s" : ""
      } executed:** ${rulesPart}\n\nAdded the following label${
        labelNames.length === 1 ? "" : "s"
      } to the monitor:${labelsPart}`;

      await MonitorFeedService.createMonitorFeedItem({
        monitorId: monitor.id,
        projectId: monitor.projectId,
        monitorFeedEventType: MonitorFeedEventType.LabelRuleExecuted,
        displayColor: Indigo500,
        feedInfoInMarkdown,
      });
    } catch (error) {
      logger.error(
        `MonitorLabelRuleEngine: failed to create rule-executed feed item: ${
          error instanceof Error ? error.message : String(error)
        }`,
        {
          projectId: monitor.projectId?.toString(),
          monitorId: monitor.id?.toString(),
        } as LogAttributes,
      );
    }
  }

  private doesMonitorMatchRule(
    monitor: Monitor,
    rule: MonitorLabelRule,
  ): boolean {
    if (rule.monitorLabels && rule.monitorLabels.length > 0) {
      if (!monitor.labels || monitor.labels.length === 0) {
        return false;
      }
      const ruleLabelIds: Array<string> = rule.monitorLabels.map((l: Label) => {
        return l.id?.toString() || "";
      });
      const monitorLabelIds: Array<string> = monitor.labels.map((l: Label) => {
        return l.id?.toString() || "";
      });
      if (
        !ruleLabelIds.some((id: string) => {
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

    return true;
  }

  private testRegex(
    pattern: string,
    value: string,
    rule: MonitorLabelRule,
  ): boolean {
    try {
      const regex: RegExp = new RegExp(pattern, "i");
      return regex.test(value);
    } catch {
      logger.warn(`Invalid regex in monitor label rule ${rule.id}: ${pattern}`);
      return false;
    }
  }
}

export default new MonitorLabelRuleEngineServiceClass();
