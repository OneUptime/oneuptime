import Label from "../../Models/DatabaseModels/Label";
import Runbook from "../../Models/DatabaseModels/Runbook";
import RunbookLabelRule from "../../Models/DatabaseModels/RunbookLabelRule";
import RunbookLabelRuleService from "./RunbookLabelRuleService";
import RunbookService from "./RunbookService";
import ObjectID from "../../Types/ObjectID";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger, { LogAttributes } from "../Utils/Logger";

class RunbookLabelRuleEngineServiceClass {
  /**
   * Evaluates RunbookLabelRule rows for the given runbook and attaches matched
   * labels to it. The union is deduped against labels already on the runbook
   * before insert to avoid PK conflicts on the join table.
   */
  @CaptureSpan()
  public async applyRulesToRunbook(runbook: Runbook): Promise<void> {
    if (!runbook.id || !runbook.projectId) {
      return;
    }

    try {
      const rules: Array<RunbookLabelRule> =
        await RunbookLabelRuleService.findBy({
          query: {
            projectId: runbook.projectId,
            isEnabled: true,
          },
          props: { isRoot: true },
          select: {
            _id: true,
            name: true,
            runbookLabels: { _id: true },
            runbookNamePattern: true,
            runbookDescriptionPattern: true,
            labelsToAdd: { _id: true },
          },
          limit: 100,
          skip: 0,
        });

      if (rules.length === 0) {
        return;
      }

      const runbookWithDetails: Runbook | null =
        await RunbookService.findOneById({
          id: runbook.id,
          select: {
            name: true,
            description: true,
            labels: { _id: true },
          },
          props: { isRoot: true },
        });

      if (!runbookWithDetails) {
        return;
      }

      const labelIdsToAdd: Set<string> = new Set();

      for (const rule of rules) {
        const matches: boolean = this.doesRunbookMatchRule(
          runbookWithDetails,
          rule,
        );
        if (!matches) {
          continue;
        }
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
        (runbookWithDetails.labels || [])
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

      await RunbookService.getRepository()
        .createQueryBuilder()
        .relation(Runbook, "labels")
        .of(runbook.id.toString())
        .add(newLabelIds);

      /*
       * Sync in-memory runbook.labels so a downstream owner-rule engine in
       * the same onCreateSuccess chain can match on rule-added labels.
       */
      const mergedLabelIds: Set<string> = new Set([
        ...existingLabelIds,
        ...newLabelIds,
      ]);
      runbook.labels = Array.from(mergedLabelIds).map((id: string) => {
        const label: Label = new Label();
        label.id = new ObjectID(id);
        return label;
      });

      logger.debug(
        `RunbookLabelRuleEngine attached ${newLabelIds.length} labels to runbook ${runbook.id}`,
        { projectId: runbook.projectId.toString() } as LogAttributes,
      );
    } catch (error) {
      logger.error(`Error applying runbook label rules: ${error}`, {
        projectId: runbook.projectId?.toString(),
        runbookId: runbook.id?.toString(),
      } as LogAttributes);
    }
  }

  private doesRunbookMatchRule(
    runbook: Runbook,
    rule: RunbookLabelRule,
  ): boolean {
    if (rule.runbookLabels && rule.runbookLabels.length > 0) {
      if (!runbook.labels || runbook.labels.length === 0) {
        return false;
      }
      const ruleLabelIds: Array<string> = rule.runbookLabels.map((l: Label) => {
        return l.id?.toString() || "";
      });
      const labelIds: Array<string> = runbook.labels.map((l: Label) => {
        return l.id?.toString() || "";
      });
      if (
        !ruleLabelIds.some((id: string) => {
          return labelIds.includes(id);
        })
      ) {
        return false;
      }
    }

    if (
      rule.runbookNamePattern &&
      (!runbook.name ||
        !this.testRegex(rule.runbookNamePattern, runbook.name, rule))
    ) {
      return false;
    }

    if (
      rule.runbookDescriptionPattern &&
      (!runbook.description ||
        !this.testRegex(
          rule.runbookDescriptionPattern,
          runbook.description,
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
    rule: RunbookLabelRule,
  ): boolean {
    try {
      const regex: RegExp = new RegExp(pattern, "i");
      return regex.test(value);
    } catch {
      logger.warn(`Invalid regex in runbook label rule ${rule.id}: ${pattern}`);
      return false;
    }
  }
}

export default new RunbookLabelRuleEngineServiceClass();
