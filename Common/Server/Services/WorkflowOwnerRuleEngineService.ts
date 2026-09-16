import Label from "../../Models/DatabaseModels/Label";
import Workflow from "../../Models/DatabaseModels/Workflow";
import WorkflowOwnerRule from "../../Models/DatabaseModels/WorkflowOwnerRule";
import WorkflowOwnerTeam from "../../Models/DatabaseModels/WorkflowOwnerTeam";
import WorkflowOwnerUser from "../../Models/DatabaseModels/WorkflowOwnerUser";
import WorkflowOwnerRuleService from "./WorkflowOwnerRuleService";
import WorkflowOwnerTeamService from "./WorkflowOwnerTeamService";
import WorkflowOwnerUserService from "./WorkflowOwnerUserService";
import WorkflowService from "./WorkflowService";
import ObjectID from "../../Types/ObjectID";
import Select from "../Types/Database/Select";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger, { LogAttributes } from "../Utils/Logger";
import { MAX_RULES_EVALUATED_PER_PROJECT } from "../../Utils/Rules/RuleEngineLimits";
import { RuleCriteriaMatcher } from "../../Utils/Rules/RuleCriteriaMatcher";
import logIfRuleReadWasTruncated from "../Utils/Rules/RuleEngineRuleRead";
import OwnerRuleAssignment, {
  OwnersToAssign,
} from "../Utils/Rules/OwnerRuleAssignment";
import {
  ApplyRulesToExistingResourceData,
  RuleApplicationResult,
  RuleApplicationResultUtil,
  RuleRunEngine,
} from "../Utils/Rules/RuleRun/RuleApplication";

class WorkflowOwnerRuleEngineServiceClass
  implements RuleRunEngine<Workflow, WorkflowOwnerRule>
{
  public readonly ruleSelect: Select<WorkflowOwnerRule> = {
    _id: true,
    name: true,
    criteria: true,
    notifyOwners: true,
    workflowLabels: { _id: true },
    workflowNamePattern: true,
    workflowDescriptionPattern: true,
    ownerUsers: { _id: true },
    ownerTeams: { _id: true },
  };

  // Evaluation re-reads the workflow, so a run only has to name it.
  public readonly resourceSelectForRuleRun: Select<Workflow> = {
    _id: true,
    projectId: true,
  };

  /**
   * Evaluates WorkflowOwnerRule rows for the given workflow and adds matched
   * owner users / teams via WorkflowOwnerUserService / WorkflowOwnerTeamService.
   * Rules with notifyOwners set notify the added owners; rules with notifyOwners
   * off add silently.
   */
  @CaptureSpan()
  public async applyRulesToWorkflow(workflow: Workflow): Promise<void> {
    if (!workflow.id || !workflow.projectId) {
      return;
    }

    try {
      const rules: Array<WorkflowOwnerRule> =
        await WorkflowOwnerRuleService.findBy({
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
        ruleKind: "WorkflowOwnerRule",
        projectId: workflow.projectId,
        rulesRead: rules.length,
      });

      if (rules.length === 0) {
        return;
      }

      await this.applyRules({
        workflow: workflow,
        rules: rules,
        allowOwnerNotification: true,
      });
    } catch (error) {
      logger.error(`Error applying workflow owner rules: ${error}`, {
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
    data: ApplyRulesToExistingResourceData<Workflow, WorkflowOwnerRule>,
  ): Promise<RuleApplicationResult> {
    try {
      return await this.applyRules({
        workflow: data.resource,
        rules: data.rules,
        allowOwnerNotification: data.allowOwnerNotification,
      });
    } catch (error) {
      logger.error(`Error running workflow owner rules: ${error}`, {
        projectId: data.resource.projectId?.toString(),
        workflowId: data.resource.id?.toString(),
      } as LogAttributes);

      return RuleApplicationResultUtil.failed();
    }
  }

  private async applyRules(data: {
    workflow: Workflow;
    rules: Array<WorkflowOwnerRule>;
    allowOwnerNotification: boolean;
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

    const usersByNotify: Map<boolean, Set<string>> = new Map([
      [true, new Set()],
      [false, new Set()],
    ]);
    const teamsByNotify: Map<boolean, Set<string>> = new Map([
      [true, new Set()],
      [false, new Set()],
    ]);

    const matchedRules: Array<WorkflowOwnerRule> = [];
    const allUserIds: Set<string> = new Set();
    const allTeamIds: Set<string> = new Set();
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
      let ruleAddedAny: boolean = false;
      const notify: boolean =
        rule.notifyOwners !== false && data.allowOwnerNotification;
      for (const user of rule.ownerUsers || []) {
        if (user.id) {
          usersByNotify.get(notify)!.add(user.id.toString());
          allUserIds.add(user.id.toString());
          ruleAddedAny = true;
        }
      }
      for (const team of rule.ownerTeams || []) {
        if (team.id) {
          teamsByNotify.get(notify)!.add(team.id.toString());
          allTeamIds.add(team.id.toString());
          ruleAddedAny = true;
        }
      }
      if (ruleAddedAny) {
        matchedRules.push(rule);
      }
    }

    if (!anyRuleMatched) {
      return RuleApplicationResultUtil.noMatch();
    }

    if (
      matchedRules.length === 0 ||
      (allUserIds.size === 0 && allTeamIds.size === 0)
    ) {
      return RuleApplicationResultUtil.alreadyApplied();
    }

    // Owners already on the workflow are skipped rather than duplicated.
    const notYetAssigned: OwnersToAssign =
      await OwnerRuleAssignment.getOwnersNotYetAssigned({
        ownerUserService: WorkflowOwnerUserService,
        ownerTeamService: WorkflowOwnerTeamService,
        resourceIdColumn: "workflowId",
        resourceId: workflow.id,
        userIds: Array.from(allUserIds),
        teamIds: Array.from(allTeamIds),
      });

    const userIdsToAdd: Set<string> = new Set(
      notYetAssigned.userIds.map((id: ObjectID) => {
        return id.toString();
      }),
    );
    const teamIdsToAdd: Set<string> = new Set(
      notYetAssigned.teamIds.map((id: ObjectID) => {
        return id.toString();
      }),
    );

    let ownersAdded: number = 0;

    /*
     * The notifying set goes first, so an owner two matching rules disagree
     * about is added once, and notified.
     */
    for (const notify of [true, false]) {
      const userIds: Array<string> = Array.from(
        usersByNotify.get(notify)!,
      ).filter((id: string) => {
        return userIdsToAdd.delete(id);
      });
      const teamIds: Array<string> = Array.from(
        teamsByNotify.get(notify)!,
      ).filter((id: string) => {
        return teamIdsToAdd.delete(id);
      });

      for (const userId of userIds) {
        const owner: WorkflowOwnerUser = new WorkflowOwnerUser();
        owner.workflowId = workflow.id;
        owner.projectId = workflow.projectId;
        owner.userId = new ObjectID(userId);
        owner.isOwnerNotified = !notify;
        await WorkflowOwnerUserService.create({
          data: owner,
          props: { isRoot: true },
        });
        ownersAdded++;
      }

      for (const teamId of teamIds) {
        const owner: WorkflowOwnerTeam = new WorkflowOwnerTeam();
        owner.workflowId = workflow.id;
        owner.projectId = workflow.projectId;
        owner.teamId = new ObjectID(teamId);
        owner.isOwnerNotified = !notify;
        await WorkflowOwnerTeamService.create({
          data: owner,
          props: { isRoot: true },
        });
        ownersAdded++;
      }
    }

    if (ownersAdded === 0) {
      return RuleApplicationResultUtil.alreadyApplied();
    }

    logger.debug(
      `WorkflowOwnerRuleEngine added owners to workflow ${workflow.id}`,
      { projectId: workflow.projectId.toString() } as LogAttributes,
    );

    return RuleApplicationResultUtil.updated(ownersAdded);
  }

  private doesWorkflowMatchRule(
    workflow: Workflow,
    rule: WorkflowOwnerRule,
  ): boolean {
    return RuleCriteriaMatcher.matchesWithLegacySync({
      rule: rule,
      legacyFields: [
        "workflowLabels",
        "workflowNamePattern",
        "workflowDescriptionPattern",
      ],
      emptyResult: true,
      matchesLegacyRule: (workflowRule: WorkflowOwnerRule): boolean => {
        return this.doesWorkflowMatchRuleLegacy(workflow, workflowRule);
      },
    });
  }

  private doesWorkflowMatchRuleLegacy(
    workflow: Workflow,
    rule: WorkflowOwnerRule,
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
    rule: WorkflowOwnerRule,
  ): boolean {
    try {
      const regex: RegExp = new RegExp(pattern, "i");
      return regex.test(value);
    } catch {
      logger.warn(
        `Invalid regex in workflow owner rule ${rule.id}: ${pattern}`,
      );
      return false;
    }
  }
}

export default new WorkflowOwnerRuleEngineServiceClass();
