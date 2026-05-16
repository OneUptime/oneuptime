import Label from "../../Models/DatabaseModels/Label";
import Runbook from "../../Models/DatabaseModels/Runbook";
import RunbookOwnerRule from "../../Models/DatabaseModels/RunbookOwnerRule";
import RunbookOwnerUser from "../../Models/DatabaseModels/RunbookOwnerUser";
import RunbookOwnerTeam from "../../Models/DatabaseModels/RunbookOwnerTeam";
import RunbookOwnerRuleService from "./RunbookOwnerRuleService";
import RunbookOwnerUserService from "./RunbookOwnerUserService";
import RunbookOwnerTeamService from "./RunbookOwnerTeamService";
import RunbookService from "./RunbookService";
import ObjectID from "../../Types/ObjectID";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger, { LogAttributes } from "../Utils/Logger";

class RunbookOwnerRuleEngineServiceClass {
  /**
   * Evaluates RunbookOwnerRule rows for the given runbook and adds matched
   * owner users / teams via RunbookOwnerUserService / RunbookOwnerTeamService. Rules
   * with notifyOwners set notify the added owners; rules with notifyOwners off
   * add silently.
   */
  @CaptureSpan()
  public async applyRulesToRunbook(runbook: Runbook): Promise<void> {
    if (!runbook.id || !runbook.projectId) {
      return;
    }

    try {
      const rules: Array<RunbookOwnerRule> =
        await RunbookOwnerRuleService.findBy({
          query: {
            projectId: runbook.projectId,
            isEnabled: true,
          },
          props: { isRoot: true },
          select: {
            _id: true,
            name: true,
            notifyOwners: true,
            runbookLabels: { _id: true },
            runbookNamePattern: true,
            runbookDescriptionPattern: true,
            ownerUsers: { _id: true },
            ownerTeams: { _id: true },
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

      const usersByNotify: Map<boolean, Set<string>> = new Map([
        [true, new Set()],
        [false, new Set()],
      ]);
      const teamsByNotify: Map<boolean, Set<string>> = new Map([
        [true, new Set()],
        [false, new Set()],
      ]);

      const matchedRules: Array<RunbookOwnerRule> = [];

      for (const rule of rules) {
        const matches: boolean = this.doesRunbookMatchRule(
          runbookWithDetails,
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
          const owner: RunbookOwnerUser = new RunbookOwnerUser();
          owner.runbookId = runbook.id;
          owner.projectId = runbook.projectId;
          owner.userId = new ObjectID(userId);
          owner.isOwnerNotified = !notify;
          await RunbookOwnerUserService.create({
            data: owner,
            props: { isRoot: true },
          });
        }

        for (const teamId of teamIds) {
          const owner: RunbookOwnerTeam = new RunbookOwnerTeam();
          owner.runbookId = runbook.id;
          owner.projectId = runbook.projectId;
          owner.teamId = new ObjectID(teamId);
          owner.isOwnerNotified = !notify;
          await RunbookOwnerTeamService.create({
            data: owner,
            props: { isRoot: true },
          });
        }
      }

      logger.debug(
        `RunbookOwnerRuleEngine added owners to runbook ${runbook.id}`,
        { projectId: runbook.projectId.toString() } as LogAttributes,
      );
    } catch (error) {
      logger.error(`Error applying runbook owner rules: ${error}`, {
        projectId: runbook.projectId?.toString(),
        runbookId: runbook.id?.toString(),
      } as LogAttributes);
    }
  }

  private doesRunbookMatchRule(
    runbook: Runbook,
    rule: RunbookOwnerRule,
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
    rule: RunbookOwnerRule,
  ): boolean {
    try {
      const regex: RegExp = new RegExp(pattern, "i");
      return regex.test(value);
    } catch {
      logger.warn(`Invalid regex in runbook owner rule ${rule.id}: ${pattern}`);
      return false;
    }
  }
}

export default new RunbookOwnerRuleEngineServiceClass();
