import Label from "../../Models/DatabaseModels/Label";
import RumApplication from "../../Models/DatabaseModels/RumApplication";
import RumApplicationOwnerRule from "../../Models/DatabaseModels/RumApplicationOwnerRule";
import RumApplicationOwnerUser from "../../Models/DatabaseModels/RumApplicationOwnerUser";
import RumApplicationOwnerTeam from "../../Models/DatabaseModels/RumApplicationOwnerTeam";
import RumApplicationOwnerRuleService from "./RumApplicationOwnerRuleService";
import RumApplicationOwnerUserService from "./RumApplicationOwnerUserService";
import RumApplicationOwnerTeamService from "./RumApplicationOwnerTeamService";
import RumApplicationService from "./RumApplicationService";
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

class RumApplicationOwnerRuleEngineServiceClass
  implements RuleRunEngine<RumApplication, RumApplicationOwnerRule>
{
  public readonly ruleSelect: Select<RumApplicationOwnerRule> = {
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

  // Evaluation re-reads the application, so a run only has to name it.
  public readonly resourceSelectForRuleRun: Select<RumApplication> = {
    _id: true,
    projectId: true,
  };

  /**
   * Evaluates RumApplicationOwnerRule rows for the given application and adds
   * matched owner users / teams. Rules with notifyOwners set notify the added
   * owners; rules with notifyOwners off add silently.
   */
  @CaptureSpan()
  public async applyRulesToRumApplication(
    rumApplication: RumApplication,
  ): Promise<void> {
    if (!rumApplication.id || !rumApplication.projectId) {
      return;
    }

    try {
      const rules: Array<RumApplicationOwnerRule> =
        await RumApplicationOwnerRuleService.findBy({
          query: {
            projectId: rumApplication.projectId,
            isEnabled: true,
          },
          props: { isRoot: true },
          select: this.ruleSelect,
          limit: MAX_RULES_EVALUATED_PER_PROJECT,
          skip: 0,
        });

      logIfRuleReadWasTruncated({
        ruleKind: "RumApplicationOwnerRule",
        projectId: rumApplication.projectId,
        rulesRead: rules.length,
      });

      if (rules.length === 0) {
        return;
      }

      await this.applyRules({
        rumApplication: rumApplication,
        rules: rules,
        allowOwnerNotification: true,
      });
    } catch (error) {
      logger.error(`Error applying RUM application owner rules: ${error}`, {
        projectId: rumApplication.projectId?.toString(),
        rumApplicationId: rumApplication.id?.toString(),
      } as LogAttributes);
    }
  }

  /*
   * "Run now": the same evaluation, for an application that already exists
   * and only the rules being run.
   */
  @CaptureSpan()
  public async applyRulesToExistingResource(
    data: ApplyRulesToExistingResourceData<
      RumApplication,
      RumApplicationOwnerRule
    >,
  ): Promise<RuleApplicationResult> {
    try {
      return await this.applyRules({
        rumApplication: data.resource,
        rules: data.rules,
        allowOwnerNotification: data.allowOwnerNotification,
      });
    } catch (error) {
      logger.error(`Error running RUM application owner rules: ${error}`, {
        projectId: data.resource.projectId?.toString(),
        rumApplicationId: data.resource.id?.toString(),
      } as LogAttributes);

      return RuleApplicationResultUtil.failed();
    }
  }

  private async applyRules(data: {
    rumApplication: RumApplication;
    rules: Array<RumApplicationOwnerRule>;
    allowOwnerNotification: boolean;
  }): Promise<RuleApplicationResult> {
    const { rumApplication, rules } = data;

    if (!rumApplication.id || !rumApplication.projectId || rules.length === 0) {
      return RuleApplicationResultUtil.noMatch();
    }

    const appWithDetails: RumApplication | null =
      await RumApplicationService.findOneById({
        id: rumApplication.id,
        select: {
          name: true,
          description: true,
          labels: { _id: true },
        },
        props: { isRoot: true },
      });

    if (!appWithDetails) {
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
      if (!this.doesMatchRule(appWithDetails, rule)) {
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

    // Owners already on the application are skipped rather than duplicated.
    const notYetAssigned: OwnersToAssign =
      await OwnerRuleAssignment.getOwnersNotYetAssigned({
        ownerUserService: RumApplicationOwnerUserService,
        ownerTeamService: RumApplicationOwnerTeamService,
        resourceIdColumn: "rumApplicationId",
        resourceId: rumApplication.id,
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
        const owner: RumApplicationOwnerUser = new RumApplicationOwnerUser();
        owner.rumApplicationId = rumApplication.id;
        owner.projectId = rumApplication.projectId;
        owner.userId = new ObjectID(userId);
        owner.isOwnerNotified = !notify;
        await RumApplicationOwnerUserService.create({
          data: owner,
          props: { isRoot: true },
        });
        ownersAdded++;
      }

      for (const teamId of teamIds) {
        const owner: RumApplicationOwnerTeam = new RumApplicationOwnerTeam();
        owner.rumApplicationId = rumApplication.id;
        owner.projectId = rumApplication.projectId;
        owner.teamId = new ObjectID(teamId);
        owner.isOwnerNotified = !notify;
        await RumApplicationOwnerTeamService.create({
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
    rumApplication: RumApplication,
    rule: RumApplicationOwnerRule,
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
        rumApplicationRule: RumApplicationOwnerRule,
      ): boolean => {
        return this.doesMatchRuleLegacy(rumApplication, rumApplicationRule);
      },
    });
  }

  private doesMatchRuleLegacy(
    rumApplication: RumApplication,
    rule: RumApplicationOwnerRule,
  ): boolean {
    if (rule.matchLabels && rule.matchLabels.length > 0) {
      if (!rumApplication.labels || rumApplication.labels.length === 0) {
        return false;
      }
      const ruleLabelIds: Array<string> = rule.matchLabels.map((l: Label) => {
        return l.id?.toString() || "";
      });
      const labelIds: Array<string> = rumApplication.labels.map((l: Label) => {
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
      rule.nameRegexPattern &&
      (!rumApplication.name ||
        !this.testRegex(rule.nameRegexPattern, rumApplication.name))
    ) {
      return false;
    }

    if (
      rule.descriptionRegexPattern &&
      (!rumApplication.description ||
        !this.testRegex(
          rule.descriptionRegexPattern,
          rumApplication.description,
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
      logger.warn(`Invalid regex in RUM application owner rule: ${pattern}`);
      return false;
    }
  }
}

export default new RumApplicationOwnerRuleEngineServiceClass();
