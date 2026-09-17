import Label from "../../Models/DatabaseModels/Label";
import CloudResource from "../../Models/DatabaseModels/CloudResource";
import CloudResourceOwnerRule from "../../Models/DatabaseModels/CloudResourceOwnerRule";
import CloudResourceOwnerUser from "../../Models/DatabaseModels/CloudResourceOwnerUser";
import CloudResourceOwnerTeam from "../../Models/DatabaseModels/CloudResourceOwnerTeam";
import CloudResourceOwnerRuleService from "./CloudResourceOwnerRuleService";
import CloudResourceOwnerUserService from "./CloudResourceOwnerUserService";
import CloudResourceOwnerTeamService from "./CloudResourceOwnerTeamService";
import CloudResourceService from "./CloudResourceService";
import CloudResourceFeedService from "./CloudResourceFeedService";
import { CloudResourceFeedEventType } from "../../Models/DatabaseModels/CloudResourceFeed";
import { Purple500 } from "../../Types/BrandColors";
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

class CloudResourceOwnerRuleEngineServiceClass
  implements RuleRunEngine<CloudResource, CloudResourceOwnerRule>
{
  public readonly ruleSelect: Select<CloudResourceOwnerRule> = {
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

  // Evaluation re-reads the cloud resource, so a run only has to name it.
  public readonly resourceSelectForRuleRun: Select<CloudResource> = {
    _id: true,
    projectId: true,
  };

  /**
   * Evaluates CloudResourceOwnerRule rows for the given resource and adds
   * matched owner users / teams. Rules with notifyOwners set notify the added
   * owners; rules with notifyOwners off add silently.
   */
  @CaptureSpan()
  public async applyRulesToCloudResource(
    cloudResource: CloudResource,
  ): Promise<void> {
    if (!cloudResource.id || !cloudResource.projectId) {
      return;
    }

    try {
      const rules: Array<CloudResourceOwnerRule> =
        await CloudResourceOwnerRuleService.findBy({
          query: {
            projectId: cloudResource.projectId,
            isEnabled: true,
          },
          props: { isRoot: true },
          select: this.ruleSelect,
          limit: MAX_RULES_EVALUATED_PER_PROJECT,
          skip: 0,
        });

      logIfRuleReadWasTruncated({
        ruleKind: "CloudResourceOwnerRule",
        projectId: cloudResource.projectId,
        rulesRead: rules.length,
      });

      if (rules.length === 0) {
        return;
      }

      await this.applyRules({
        cloudResource: cloudResource,
        rules: rules,
        allowOwnerNotification: true,
      });
    } catch (error) {
      logger.error(`Error applying cloud resource owner rules: ${error}`, {
        projectId: cloudResource.projectId?.toString(),
        cloudResourceId: cloudResource.id?.toString(),
      } as LogAttributes);
    }
  }

  /*
   * "Run now": the same evaluation, for a cloud resource that already exists
   * and only the rules being run.
   */
  @CaptureSpan()
  public async applyRulesToExistingResource(
    data: ApplyRulesToExistingResourceData<
      CloudResource,
      CloudResourceOwnerRule
    >,
  ): Promise<RuleApplicationResult> {
    try {
      return await this.applyRules({
        cloudResource: data.resource,
        rules: data.rules,
        allowOwnerNotification: data.allowOwnerNotification,
      });
    } catch (error) {
      logger.error(`Error running cloud resource owner rules: ${error}`, {
        projectId: data.resource.projectId?.toString(),
        cloudResourceId: data.resource.id?.toString(),
      } as LogAttributes);

      return RuleApplicationResultUtil.failed();
    }
  }

  private async applyRules(data: {
    cloudResource: CloudResource;
    rules: Array<CloudResourceOwnerRule>;
    allowOwnerNotification: boolean;
  }): Promise<RuleApplicationResult> {
    const { cloudResource, rules } = data;

    if (!cloudResource.id || !cloudResource.projectId || rules.length === 0) {
      return RuleApplicationResultUtil.noMatch();
    }

    const resourceWithDetails: CloudResource | null =
      await CloudResourceService.findOneById({
        id: cloudResource.id,
        select: {
          name: true,
          description: true,
          labels: { _id: true },
        },
        props: { isRoot: true },
      });

    if (!resourceWithDetails) {
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

    const matchedRuleNames: Array<string> = [];
    const allUserIds: Set<string> = new Set();
    const allTeamIds: Set<string> = new Set();
    let anyRuleMatched: boolean = false;
    let anyOwnerToAdd: boolean = false;

    for (const rule of rules) {
      if (!this.doesMatchRule(resourceWithDetails, rule)) {
        continue;
      }
      anyRuleMatched = true;
      if (
        (rule.ownerUsers || []).length > 0 ||
        (rule.ownerTeams || []).length > 0
      ) {
        matchedRuleNames.push(
          rule.name || rule.id?.toString() || "Unnamed rule",
        );
      }
      const notify: boolean =
        rule.notifyOwners !== false && data.allowOwnerNotification;
      for (const user of rule.ownerUsers || []) {
        if (user.id) {
          usersByNotify.get(notify)!.add(user.id.toString());
          allUserIds.add(user.id.toString());
          anyOwnerToAdd = true;
        }
      }
      for (const team of rule.ownerTeams || []) {
        if (team.id) {
          teamsByNotify.get(notify)!.add(team.id.toString());
          allTeamIds.add(team.id.toString());
          anyOwnerToAdd = true;
        }
      }
    }

    if (!anyRuleMatched) {
      return RuleApplicationResultUtil.noMatch();
    }

    // The rules that matched name no owners, so there is nothing to add.
    if (!anyOwnerToAdd) {
      return RuleApplicationResultUtil.alreadyApplied();
    }

    // Owners already on the cloud resource are skipped rather than duplicated.
    const notYetAssigned: OwnersToAssign =
      await OwnerRuleAssignment.getOwnersNotYetAssigned({
        ownerUserService: CloudResourceOwnerUserService,
        ownerTeamService: CloudResourceOwnerTeamService,
        resourceIdColumn: "cloudResourceId",
        resourceId: cloudResource.id,
        userIds: Array.from(allUserIds),
        teamIds: Array.from(allTeamIds),
      });

    const userIdsToAdd: Set<string> = new Set(
      notYetAssigned.userIds.map((id: ObjectID): string => {
        return id.toString();
      }),
    );
    const teamIdsToAdd: Set<string> = new Set(
      notYetAssigned.teamIds.map((id: ObjectID): string => {
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
      ).filter((id: string): boolean => {
        return userIdsToAdd.delete(id);
      });
      const teamIds: Array<string> = Array.from(
        teamsByNotify.get(notify)!,
      ).filter((id: string): boolean => {
        return teamIdsToAdd.delete(id);
      });

      for (const userId of userIds) {
        const owner: CloudResourceOwnerUser = new CloudResourceOwnerUser();
        owner.cloudResourceId = cloudResource.id;
        owner.projectId = cloudResource.projectId;
        owner.userId = new ObjectID(userId);
        owner.isOwnerNotified = !notify;
        if (
          await OwnerRuleAssignment.createOwner({
            ownerService: CloudResourceOwnerUserService,
            owner: owner,
            props: { isRoot: true },
          })
        ) {
          ownersAdded++;
        }
      }

      for (const teamId of teamIds) {
        const owner: CloudResourceOwnerTeam = new CloudResourceOwnerTeam();
        owner.cloudResourceId = cloudResource.id;
        owner.projectId = cloudResource.projectId;
        owner.teamId = new ObjectID(teamId);
        owner.isOwnerNotified = !notify;
        if (
          await OwnerRuleAssignment.createOwner({
            ownerService: CloudResourceOwnerTeamService,
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

    /*
     * The individual OwnerUserAdded / OwnerTeamAdded items say who was added;
     * this one says which rule is responsible, which is what somebody asking
     * "why am I on the hook for this?" actually needs.
     */
    await CloudResourceFeedService.createCloudResourceFeedItem({
      cloudResourceId: cloudResource.id,
      projectId: cloudResource.projectId,
      cloudResourceFeedEventType: CloudResourceFeedEventType.OwnerRuleExecuted,
      displayColor: Purple500,
      feedInfoInMarkdown: `👥 Owners were added to ${await CloudResourceService.getCloudResourceMarkdownLink(
        cloudResource.projectId,
        cloudResource.id,
      )} by ${matchedRuleNames.length} owner ${matchedRuleNames.length === 1 ? "rule" : "rules"}.`,
      moreInformationInMarkdown: `**Owner rules that matched**: ${matchedRuleNames
        .map((name: string) => {
          return `\`${name}\``;
        })
        .join(", ")}`,
    });

    return RuleApplicationResultUtil.updated(ownersAdded);
  }

  private doesMatchRule(
    cloudResource: CloudResource,
    rule: CloudResourceOwnerRule,
  ): boolean {
    return RuleCriteriaMatcher.matchesWithLegacySync({
      rule,
      legacyFields: [
        "matchLabels",
        "nameRegexPattern",
        "descriptionRegexPattern",
      ],
      emptyResult: true,
      matchesLegacyRule: (legacyRule: CloudResourceOwnerRule): boolean => {
        return this.doesMatchLegacyRule(cloudResource, legacyRule);
      },
    });
  }

  private doesMatchLegacyRule(
    cloudResource: CloudResource,
    rule: CloudResourceOwnerRule,
  ): boolean {
    if (rule.matchLabels && rule.matchLabels.length > 0) {
      if (!cloudResource.labels || cloudResource.labels.length === 0) {
        return false;
      }
      const ruleLabelIds: Array<string> = rule.matchLabels.map((l: Label) => {
        return l.id?.toString() || "";
      });
      const labelIds: Array<string> = cloudResource.labels.map((l: Label) => {
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
      (!cloudResource.name ||
        !this.testRegex(rule.nameRegexPattern, cloudResource.name))
    ) {
      return false;
    }

    if (
      rule.descriptionRegexPattern &&
      (!cloudResource.description ||
        !this.testRegex(
          rule.descriptionRegexPattern,
          cloudResource.description,
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
      logger.warn(`Invalid regex in cloud resource owner rule: ${pattern}`);
      return false;
    }
  }
}

export default new CloudResourceOwnerRuleEngineServiceClass();
