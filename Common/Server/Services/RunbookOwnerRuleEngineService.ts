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

class RunbookOwnerRuleEngineServiceClass
  implements RuleRunEngine<Runbook, RunbookOwnerRule>
{
  public readonly ruleSelect: Select<RunbookOwnerRule> = {
    _id: true,
    name: true,
    criteria: true,
    notifyOwners: true,
    runbookLabels: { _id: true },
    runbookNamePattern: true,
    runbookDescriptionPattern: true,
    ownerUsers: { _id: true },
    ownerTeams: { _id: true },
  };

  // Evaluation re-reads the runbook, so a run only has to name it.
  public readonly resourceSelectForRuleRun: Select<Runbook> = {
    _id: true,
    projectId: true,
  };

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
          select: this.ruleSelect,
          limit: MAX_RULES_EVALUATED_PER_PROJECT,
          skip: 0,
        });

      logIfRuleReadWasTruncated({
        ruleKind: "RunbookOwnerRule",
        projectId: runbook.projectId,
        rulesRead: rules.length,
      });

      if (rules.length === 0) {
        return;
      }

      await this.applyRules({
        runbook: runbook,
        rules: rules,
        allowOwnerNotification: true,
      });
    } catch (error) {
      logger.error(`Error applying runbook owner rules: ${error}`, {
        projectId: runbook.projectId?.toString(),
        runbookId: runbook.id?.toString(),
      } as LogAttributes);
    }
  }

  /*
   * "Run now": the same evaluation, for a runbook that already exists and
   * only the rules being run.
   */
  @CaptureSpan()
  public async applyRulesToExistingResource(
    data: ApplyRulesToExistingResourceData<Runbook, RunbookOwnerRule>,
  ): Promise<RuleApplicationResult> {
    try {
      return await this.applyRules({
        runbook: data.resource,
        rules: data.rules,
        allowOwnerNotification: data.allowOwnerNotification,
      });
    } catch (error) {
      logger.error(`Error running runbook owner rules: ${error}`, {
        projectId: data.resource.projectId?.toString(),
        runbookId: data.resource.id?.toString(),
      } as LogAttributes);

      return RuleApplicationResultUtil.failed();
    }
  }

  private async applyRules(data: {
    runbook: Runbook;
    rules: Array<RunbookOwnerRule>;
    allowOwnerNotification: boolean;
  }): Promise<RuleApplicationResult> {
    const { runbook, rules } = data;

    if (!runbook.id || !runbook.projectId || rules.length === 0) {
      return RuleApplicationResultUtil.noMatch();
    }

    const runbookWithDetails: Runbook | null = await RunbookService.findOneById(
      {
        id: runbook.id,
        select: {
          name: true,
          description: true,
          labels: { _id: true },
        },
        props: { isRoot: true },
      },
    );

    if (!runbookWithDetails) {
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

    const matchedRules: Array<RunbookOwnerRule> = [];
    const allUserIds: Set<string> = new Set();
    const allTeamIds: Set<string> = new Set();
    let anyRuleMatched: boolean = false;

    for (const rule of rules) {
      const matches: boolean = this.doesRunbookMatchRule(
        runbookWithDetails,
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

    // Owners already on the runbook are skipped rather than duplicated.
    const notYetAssigned: OwnersToAssign =
      await OwnerRuleAssignment.getOwnersNotYetAssigned({
        ownerUserService: RunbookOwnerUserService,
        ownerTeamService: RunbookOwnerTeamService,
        resourceIdColumn: "runbookId",
        resourceId: runbook.id,
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
        const owner: RunbookOwnerUser = new RunbookOwnerUser();
        owner.runbookId = runbook.id;
        owner.projectId = runbook.projectId;
        owner.userId = new ObjectID(userId);
        owner.isOwnerNotified = !notify;
        if (
          await OwnerRuleAssignment.createOwner({
            ownerService: RunbookOwnerUserService,
            owner: owner,
            props: { isRoot: true },
          })
        ) {
          ownersAdded++;
        }
      }

      for (const teamId of teamIds) {
        const owner: RunbookOwnerTeam = new RunbookOwnerTeam();
        owner.runbookId = runbook.id;
        owner.projectId = runbook.projectId;
        owner.teamId = new ObjectID(teamId);
        owner.isOwnerNotified = !notify;
        if (
          await OwnerRuleAssignment.createOwner({
            ownerService: RunbookOwnerTeamService,
            owner: owner,
            props: { isRoot: true },
          })
        ) {
          ownersAdded++;
        }
      }
    }

    if (ownersAdded === 0) {
      return RuleApplicationResultUtil.alreadyApplied();
    }

    logger.debug(
      `RunbookOwnerRuleEngine added owners to runbook ${runbook.id}`,
      { projectId: runbook.projectId.toString() } as LogAttributes,
    );

    return RuleApplicationResultUtil.updated(ownersAdded);
  }

  private doesRunbookMatchRule(
    runbook: Runbook,
    rule: RunbookOwnerRule,
  ): boolean {
    return RuleCriteriaMatcher.matchesWithLegacySync({
      rule: rule,
      legacyFields: [
        "runbookLabels",
        "runbookNamePattern",
        "runbookDescriptionPattern",
      ],
      emptyResult: true,
      matchesLegacyRule: (runbookRule: RunbookOwnerRule): boolean => {
        return this.doesRunbookMatchRuleLegacy(runbook, runbookRule);
      },
    });
  }

  private doesRunbookMatchRuleLegacy(
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
