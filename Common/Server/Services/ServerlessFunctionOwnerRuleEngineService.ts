import Label from "../../Models/DatabaseModels/Label";
import ServerlessFunction from "../../Models/DatabaseModels/ServerlessFunction";
import ServerlessFunctionOwnerRule from "../../Models/DatabaseModels/ServerlessFunctionOwnerRule";
import ServerlessFunctionOwnerUser from "../../Models/DatabaseModels/ServerlessFunctionOwnerUser";
import ServerlessFunctionOwnerTeam from "../../Models/DatabaseModels/ServerlessFunctionOwnerTeam";
import ServerlessFunctionOwnerRuleService from "./ServerlessFunctionOwnerRuleService";
import ServerlessFunctionOwnerUserService from "./ServerlessFunctionOwnerUserService";
import ServerlessFunctionOwnerTeamService from "./ServerlessFunctionOwnerTeamService";
import ServerlessFunctionService from "./ServerlessFunctionService";
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

class ServerlessFunctionOwnerRuleEngineServiceClass
  implements RuleRunEngine<ServerlessFunction, ServerlessFunctionOwnerRule>
{
  public readonly ruleSelect: Select<ServerlessFunctionOwnerRule> = {
    _id: true,
    name: true,
    criteria: true,
    notifyOwners: true,
    matchLabels: { _id: true },
    nameRegexPattern: true,
    descriptionRegexPattern: true,
    ownerUsers: { _id: true },
    ownerTeams: { _id: true },
  };

  // Evaluation re-reads the function, so a run only has to name it.
  public readonly resourceSelectForRuleRun: Select<ServerlessFunction> = {
    _id: true,
    projectId: true,
  };

  /**
   * Evaluates ServerlessFunctionOwnerRule rows for the given function and adds
   * matched owner users / teams. Rules with notifyOwners set notify the added
   * owners; rules with notifyOwners off add silently.
   */
  @CaptureSpan()
  public async applyRulesToServerlessFunction(
    serverlessFunction: ServerlessFunction,
  ): Promise<void> {
    if (!serverlessFunction.id || !serverlessFunction.projectId) {
      return;
    }

    try {
      const rules: Array<ServerlessFunctionOwnerRule> =
        await ServerlessFunctionOwnerRuleService.findBy({
          query: {
            projectId: serverlessFunction.projectId,
            isEnabled: true,
          },
          props: { isRoot: true },
          select: this.ruleSelect,
          limit: MAX_RULES_EVALUATED_PER_PROJECT,
          skip: 0,
        });

      logIfRuleReadWasTruncated({
        ruleKind: "ServerlessFunctionOwnerRule",
        projectId: serverlessFunction.projectId,
        rulesRead: rules.length,
      });

      if (rules.length === 0) {
        return;
      }

      await this.applyRules({
        serverlessFunction: serverlessFunction,
        rules: rules,
        allowOwnerNotification: true,
      });
    } catch (error) {
      logger.error(`Error applying serverless function owner rules: ${error}`, {
        projectId: serverlessFunction.projectId?.toString(),
        serverlessFunctionId: serverlessFunction.id?.toString(),
      } as LogAttributes);
    }
  }

  /*
   * "Run now": the same evaluation, for a function that already exists and
   * only the rules being run.
   */
  @CaptureSpan()
  public async applyRulesToExistingResource(
    data: ApplyRulesToExistingResourceData<
      ServerlessFunction,
      ServerlessFunctionOwnerRule
    >,
  ): Promise<RuleApplicationResult> {
    try {
      return await this.applyRules({
        serverlessFunction: data.resource,
        rules: data.rules,
        allowOwnerNotification: data.allowOwnerNotification,
      });
    } catch (error) {
      logger.error(`Error running serverless function owner rules: ${error}`, {
        projectId: data.resource.projectId?.toString(),
        serverlessFunctionId: data.resource.id?.toString(),
      } as LogAttributes);

      return RuleApplicationResultUtil.failed();
    }
  }

  private async applyRules(data: {
    serverlessFunction: ServerlessFunction;
    rules: Array<ServerlessFunctionOwnerRule>;
    allowOwnerNotification: boolean;
  }): Promise<RuleApplicationResult> {
    const { serverlessFunction, rules } = data;

    if (
      !serverlessFunction.id ||
      !serverlessFunction.projectId ||
      rules.length === 0
    ) {
      return RuleApplicationResultUtil.noMatch();
    }

    const fnWithDetails: ServerlessFunction | null =
      await ServerlessFunctionService.findOneById({
        id: serverlessFunction.id,
        select: {
          name: true,
          description: true,
          labels: { _id: true },
        },
        props: { isRoot: true },
      });

    if (!fnWithDetails) {
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

    const allUserIds: Set<string> = new Set();
    const allTeamIds: Set<string> = new Set();
    let anyRuleMatched: boolean = false;

    for (const rule of rules) {
      if (!this.doesMatchRule(fnWithDetails, rule)) {
        continue;
      }
      anyRuleMatched = true;
      const notify: boolean =
        rule.notifyOwners !== false && data.allowOwnerNotification;
      for (const user of rule.ownerUsers || []) {
        if (user.id) {
          usersByNotify.get(notify)!.add(user.id.toString());
          allUserIds.add(user.id.toString());
        }
      }
      for (const team of rule.ownerTeams || []) {
        if (team.id) {
          teamsByNotify.get(notify)!.add(team.id.toString());
          allTeamIds.add(team.id.toString());
        }
      }
    }

    if (!anyRuleMatched) {
      return RuleApplicationResultUtil.noMatch();
    }

    if (allUserIds.size === 0 && allTeamIds.size === 0) {
      return RuleApplicationResultUtil.alreadyApplied();
    }

    // Owners already on the function are skipped rather than duplicated.
    const notYetAssigned: OwnersToAssign =
      await OwnerRuleAssignment.getOwnersNotYetAssigned({
        ownerUserService: ServerlessFunctionOwnerUserService,
        ownerTeamService: ServerlessFunctionOwnerTeamService,
        resourceIdColumn: "serverlessFunctionId",
        resourceId: serverlessFunction.id,
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
        const owner: ServerlessFunctionOwnerUser =
          new ServerlessFunctionOwnerUser();
        owner.serverlessFunctionId = serverlessFunction.id;
        owner.projectId = serverlessFunction.projectId;
        owner.userId = new ObjectID(userId);
        owner.isOwnerNotified = !notify;
        await ServerlessFunctionOwnerUserService.create({
          data: owner,
          props: { isRoot: true },
        });
        ownersAdded++;
      }

      for (const teamId of teamIds) {
        const owner: ServerlessFunctionOwnerTeam =
          new ServerlessFunctionOwnerTeam();
        owner.serverlessFunctionId = serverlessFunction.id;
        owner.projectId = serverlessFunction.projectId;
        owner.teamId = new ObjectID(teamId);
        owner.isOwnerNotified = !notify;
        await ServerlessFunctionOwnerTeamService.create({
          data: owner,
          props: { isRoot: true },
        });
        ownersAdded++;
      }
    }

    if (ownersAdded === 0) {
      return RuleApplicationResultUtil.alreadyApplied();
    }

    return RuleApplicationResultUtil.updated(ownersAdded);
  }

  private doesMatchRule(
    serverlessFunction: ServerlessFunction,
    rule: ServerlessFunctionOwnerRule,
  ): boolean {
    return RuleCriteriaMatcher.matchesWithLegacySync({
      rule: rule,
      legacyFields: [
        "matchLabels",
        "nameRegexPattern",
        "descriptionRegexPattern",
      ],
      emptyResult: true,
      matchesLegacyRule: (
        serverlessFunctionRule: ServerlessFunctionOwnerRule,
      ): boolean => {
        return this.doesMatchRuleLegacy(
          serverlessFunction,
          serverlessFunctionRule,
        );
      },
    });
  }

  private doesMatchRuleLegacy(
    serverlessFunction: ServerlessFunction,
    rule: ServerlessFunctionOwnerRule,
  ): boolean {
    if (rule.matchLabels && rule.matchLabels.length > 0) {
      if (
        !serverlessFunction.labels ||
        serverlessFunction.labels.length === 0
      ) {
        return false;
      }
      const ruleLabelIds: Array<string> = rule.matchLabels.map((l: Label) => {
        return l.id?.toString() || "";
      });
      const labelIds: Array<string> = serverlessFunction.labels.map(
        (l: Label) => {
          return l.id?.toString() || "";
        },
      );
      if (
        !ruleLabelIds.some((id: string) => {
          return labelIds.includes(id);
        })
      ) {
        return false;
      }
    }

    if (
      rule.nameRegexPattern &&
      (!serverlessFunction.name ||
        !this.testRegex(rule.nameRegexPattern, serverlessFunction.name))
    ) {
      return false;
    }

    if (
      rule.descriptionRegexPattern &&
      (!serverlessFunction.description ||
        !this.testRegex(
          rule.descriptionRegexPattern,
          serverlessFunction.description,
        ))
    ) {
      return false;
    }

    return true;
  }

  private testRegex(pattern: string, value: string): boolean {
    try {
      const regex: RegExp = new RegExp(pattern, "i");
      return regex.test(value);
    } catch {
      logger.warn(
        `Invalid regex in serverless function owner rule: ${pattern}`,
      );
      return false;
    }
  }
}

export default new ServerlessFunctionOwnerRuleEngineServiceClass();
