import Label from "../../Models/DatabaseModels/Label";
import Workflow from "../../Models/DatabaseModels/Workflow";
import WorkflowLabelRule from "../../Models/DatabaseModels/WorkflowLabelRule";
import WorkflowLabelRuleService from "./WorkflowLabelRuleService";
import WorkflowService from "./WorkflowService";
import ObjectID from "../../Types/ObjectID";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger, { LogAttributes } from "../Utils/Logger";

class WorkflowLabelRuleEngineServiceClass {
  /**
   * Evaluates WorkflowLabelRule rows for the given workflow and attaches
   * matched labels to it. The union is deduped against labels already on the
   * workflow before insert to avoid PK conflicts on the join table.
   */
  @CaptureSpan()
  public async applyRulesToWorkflow(workflow: Workflow): Promise<void> {
    if (!workflow.id || !workflow.projectId) {
      return;
    }

    try {
      const rules: Array<WorkflowLabelRule> =
        await WorkflowLabelRuleService.findBy({
          query: {
            projectId: workflow.projectId,
            isEnabled: true,
          },
          props: { isRoot: true },
          select: {
            _id: true,
            name: true,
            workflowLabels: { _id: true },
            workflowNamePattern: true,
            workflowDescriptionPattern: true,
            labelsToAdd: { _id: true },
          },
          limit: 100,
          skip: 0,
        });

      if (rules.length === 0) {
        return;
      }

      const workflowWithDetails: Workflow | null =
        await WorkflowService.findOneById({
          id: workflow.id,
          select: {
            name: true,
            description: true,
            labels: { _id: true },
          },
          props: { isRoot: true },
        });

      if (!workflowWithDetails) {
        return;
      }

      const labelIdsToAdd: Set<string> = new Set();

      for (const rule of rules) {
        const matches: boolean = this.doesWorkflowMatchRule(
          workflowWithDetails,
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
        (workflowWithDetails.labels || [])
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

      await WorkflowService.getRepository()
        .createQueryBuilder()
        .relation(Workflow, "labels")
        .of(workflow.id.toString())
        .add(newLabelIds);

      /*
       * Sync in-memory workflow.labels so a downstream owner-rule engine in
       * the same onCreateSuccess chain can match on rule-added labels.
       */
      const mergedLabelIds: Set<string> = new Set([
        ...existingLabelIds,
        ...newLabelIds,
      ]);
      workflow.labels = Array.from(mergedLabelIds).map((id: string) => {
        const label: Label = new Label();
        label.id = new ObjectID(id);
        return label;
      });

      logger.debug(
        `WorkflowLabelRuleEngine attached ${newLabelIds.length} labels to workflow ${workflow.id}`,
        { projectId: workflow.projectId.toString() } as LogAttributes,
      );
    } catch (error) {
      logger.error(`Error applying workflow label rules: ${error}`, {
        projectId: workflow.projectId?.toString(),
        workflowId: workflow.id?.toString(),
      } as LogAttributes);
    }
  }

  private doesWorkflowMatchRule(
    workflow: Workflow,
    rule: WorkflowLabelRule,
  ): boolean {
    if (rule.workflowLabels && rule.workflowLabels.length > 0) {
      if (!workflow.labels || workflow.labels.length === 0) {
        return false;
      }
      const ruleLabelIds: Array<string> = rule.workflowLabels.map(
        (l: Label) => {
          return l.id?.toString() || "";
        },
      );
      const labelIds: Array<string> = workflow.labels.map((l: Label) => {
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
      rule.workflowNamePattern &&
      (!workflow.name ||
        !this.testRegex(rule.workflowNamePattern, workflow.name, rule))
    ) {
      return false;
    }

    if (
      rule.workflowDescriptionPattern &&
      (!workflow.description ||
        !this.testRegex(
          rule.workflowDescriptionPattern,
          workflow.description,
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
    rule: WorkflowLabelRule,
  ): boolean {
    try {
      const regex: RegExp = new RegExp(pattern, "i");
      return regex.test(value);
    } catch {
      logger.warn(
        `Invalid regex in workflow label rule ${rule.id}: ${pattern}`,
      );
      return false;
    }
  }
}

export default new WorkflowLabelRuleEngineServiceClass();
