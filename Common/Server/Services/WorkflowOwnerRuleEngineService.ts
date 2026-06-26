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
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger, { LogAttributes } from "../Utils/Logger";

class WorkflowOwnerRuleEngineServiceClass {
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
          select: {
            _id: true,
            name: true,
            notifyOwners: true,
            workflowLabels: { _id: true },
            workflowNamePattern: true,
            workflowDescriptionPattern: true,
            ownerUsers: { _id: true },
            ownerTeams: { _id: true },
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

      const usersByNotify: Map<boolean, Set<string>> = new Map([
        [true, new Set()],
        [false, new Set()],
      ]);
      const teamsByNotify: Map<boolean, Set<string>> = new Map([
        [true, new Set()],
        [false, new Set()],
      ]);

      const matchedRules: Array<WorkflowOwnerRule> = [];

      for (const rule of rules) {
        const matches: boolean = this.doesWorkflowMatchRule(
          workflowWithDetails,
          rule,
        );
        if (!matches) {
          continue;
        }
        let ruleAddedAny: boolean = false;
        const notify: boolean = rule.notifyOwners !== false;
        for (const user of rule.ownerUsers || []) {
          if (user.id) {
            usersByNotify.get(notify)!.add(user.id.toString());
            ruleAddedAny = true;
          }
        }
        for (const team of rule.ownerTeams || []) {
          if (team.id) {
            teamsByNotify.get(notify)!.add(team.id.toString());
            ruleAddedAny = true;
          }
        }
        if (ruleAddedAny) {
          matchedRules.push(rule);
        }
      }

      if (matchedRules.length === 0) {
        return;
      }

      for (const notify of [true, false]) {
        const userIds: Set<string> = usersByNotify.get(notify)!;
        const teamIds: Set<string> = teamsByNotify.get(notify)!;

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
        }
      }

      logger.debug(
        `WorkflowOwnerRuleEngine added owners to workflow ${workflow.id}`,
        { projectId: workflow.projectId.toString() } as LogAttributes,
      );
    } catch (error) {
      logger.error(`Error applying workflow owner rules: ${error}`, {
        projectId: workflow.projectId?.toString(),
        workflowId: workflow.id?.toString(),
      } as LogAttributes);
    }
  }

  private doesWorkflowMatchRule(
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
