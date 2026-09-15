import Label from "../../Models/DatabaseModels/Label";
import Workflow from "../../Models/DatabaseModels/Workflow";
import WorkflowLabelRule from "../../Models/DatabaseModels/WorkflowLabelRule";
import WorkflowLabelRuleService from "./WorkflowLabelRuleService";
import WorkflowService from "./WorkflowService";
import ObjectID from "../../Types/ObjectID";
import Select from "../Types/Database/Select";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger, { LogAttributes } from "../Utils/Logger";
import { MAX_RULES_EVALUATED_PER_PROJECT } from "../../Utils/Rules/RuleEngineLimits";
import { RuleCriteriaMatcher } from "../../Utils/Rules/RuleCriteriaMatcher";
import logIfRuleReadWasTruncated from "../Utils/Rules/RuleEngineRuleRead";
import {
  ApplyRulesToExistingResourceData,
  RuleApplicationResult,
  RuleApplicationResultUtil,
  RuleRunEngine,
} from "../Utils/Rules/RuleRun/RuleApplication";

class WorkflowLabelRuleEngineServiceClass
  implements RuleRunEngine<Workflow, WorkflowLabelRule>
{
  public readonly ruleSelect: Select<WorkflowLabelRule> = {
    _id: true,
    name: true,
    criteria: true,
    workflowLabels: { _id: true },
    workflowNamePattern: true,
    workflowDescriptionPattern: true,
    labelsToAdd: { _id: true },
  };

  // Evaluation re-reads the workflow, so a run only has to name it.
  public readonly resourceSelectForRuleRun: Select<Workflow> = {
    _id: true,
    projectId: true,
  };

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
          select: this.ruleSelect,
          limit: MAX_RULES_EVALUATED_PER_PROJECT,
          skip: 0,
        });

      logIfRuleReadWasTruncated({
        ruleKind: "WorkflowLabelRule",
        projectId: workflow.projectId,
        rulesRead: rules.length,
      });

      if (rules.length === 0) {
        return;
      }

      await this.applyRules({ workflow: workflow, rules: rules });
    } catch (error) {
      logger.error(`Error applying workflow label rules: ${error}`, {
        projectId: workflow.projectId?.toString(),
        workflowId: workflow.id?.toString(),
      } as LogAttributes);
    }
  }

  /*
   * "Run now": the same evaluation, for a workflow that already exists and
   * only the rules being run.
   */
  @CaptureSpan()
  public async applyRulesToExistingResource(
    data: ApplyRulesToExistingResourceData<Workflow, WorkflowLabelRule>,
  ): Promise<RuleApplicationResult> {
    try {
      return await this.applyRules({
        workflow: data.resource,
        rules: data.rules,
      });
    } catch (error) {
      logger.error(`Error running workflow label rules: ${error}`, {
        projectId: data.resource.projectId?.toString(),
        workflowId: data.resource.id?.toString(),
      } as LogAttributes);

      return RuleApplicationResultUtil.failed();
    }
  }

  private async applyRules(data: {
    workflow: Workflow;
    rules: Array<WorkflowLabelRule>;
  }): Promise<RuleApplicationResult> {
    const { workflow, rules } = data;

    if (!workflow.id || !workflow.projectId || rules.length === 0) {
      return RuleApplicationResultUtil.noMatch();
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
      return RuleApplicationResultUtil.noMatch();
    }

    const labelIdsToAdd: Set<string> = new Set();
    let anyRuleMatched: boolean = false;

    for (const rule of rules) {
      const matches: boolean = this.doesWorkflowMatchRule(
        workflowWithDetails,
        rule,
      );
      if (!matches) {
        continue;
      }
      anyRuleMatched = true;
      for (const label of rule.labelsToAdd || []) {
        if (label.id) {
          labelIdsToAdd.add(label.id.toString());
        }
      }
    }

    if (!anyRuleMatched) {
      return RuleApplicationResultUtil.noMatch();
    }

    if (labelIdsToAdd.size === 0) {
      return RuleApplicationResultUtil.alreadyApplied();
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
      return RuleApplicationResultUtil.alreadyApplied();
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

    return RuleApplicationResultUtil.updated(newLabelIds.length);
  }

  private doesWorkflowMatchRule(
    workflow: Workflow,
    rule: WorkflowLabelRule,
  ): boolean {
    return RuleCriteriaMatcher.matchesWithLegacySync({
      rule: rule,
      legacyFields: [
        "workflowLabels",
        "workflowNamePattern",
        "workflowDescriptionPattern",
      ],
      emptyResult: true,
      matchesLegacyRule: (workflowRule: WorkflowLabelRule): boolean => {
        return this.doesWorkflowMatchRuleLegacy(workflow, workflowRule);
      },
    });
  }

  private doesWorkflowMatchRuleLegacy(
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
