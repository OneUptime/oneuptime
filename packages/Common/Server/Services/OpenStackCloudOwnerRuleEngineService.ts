import Label from "../../Models/DatabaseModels/Label";
import OpenStackCloud from "../../Models/DatabaseModels/OpenStackCloud";
import OpenStackCloudOwnerRule from "../../Models/DatabaseModels/OpenStackCloudOwnerRule";
import OpenStackCloudOwnerUser from "../../Models/DatabaseModels/OpenStackCloudOwnerUser";
import OpenStackCloudOwnerTeam from "../../Models/DatabaseModels/OpenStackCloudOwnerTeam";
import OpenStackCloudOwnerRuleService from "./OpenStackCloudOwnerRuleService";
import OpenStackCloudOwnerUserService from "./OpenStackCloudOwnerUserService";
import OpenStackCloudOwnerTeamService from "./OpenStackCloudOwnerTeamService";
import OpenStackCloudService from "./OpenStackCloudService";
import OpenStackCloudFeedService from "./OpenStackCloudFeedService";
import { OpenStackCloudFeedEventType } from "../../Models/DatabaseModels/OpenStackCloudFeed";
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
import { mdText } from "../../Utils/Markdown/FeedMarkdown";
import RuleFeedMarkdown from "../Utils/Rules/RuleFeedMarkdown";
import RulePatternMatchUtil from "../../Utils/Rules/RulePatternMatchUtil";
import { RuleEvaluation } from "../Utils/PatternWorkScope";

class OpenStackCloudOwnerRuleEngineServiceClass
  implements RuleRunEngine<OpenStackCloud, OpenStackCloudOwnerRule>
{
  public readonly ruleSelect: Select<OpenStackCloudOwnerRule> = {
    _id: true,
    name: true,
    criteria: true,
    notifyOwners: true,
    openStackCloudLabels: { _id: true },
    openStackCloudNamePattern: true,
    openStackCloudDescriptionPattern: true,
    ownerUsers: { _id: true },
    ownerTeams: { _id: true },
  };

  // Evaluation re-reads the OpenStack cloud, so a run only has to name it.
  public readonly resourceSelectForRuleRun: Select<OpenStackCloud> = {
    _id: true,
    projectId: true,
  };

  /**
   * Evaluates OpenStackCloudOwnerRule rows for the given OpenStack cloud and adds matched
   * owner users / teams via OpenStackCloudOwnerUserService / OpenStackCloudOwnerTeamService. Rules
   * with notifyOwners set notify the added owners; rules with notifyOwners off
   * add silently.
   */
  @CaptureSpan()
  public async applyRulesToOpenStackCloud(
    openStackCloud: OpenStackCloud,
  ): Promise<void> {
    if (!openStackCloud.id || !openStackCloud.projectId) {
      return;
    }

    try {
      const rules: Array<OpenStackCloudOwnerRule> =
        await OpenStackCloudOwnerRuleService.findBy({
          query: {
            projectId: openStackCloud.projectId,
            isEnabled: true,
          },
          props: { isRoot: true },
          select: this.ruleSelect,
          limit: MAX_RULES_EVALUATED_PER_PROJECT,
          skip: 0,
        });

      logIfRuleReadWasTruncated({
        ruleKind: "OpenStackCloudOwnerRule",
        projectId: openStackCloud.projectId,
        rulesRead: rules.length,
      });

      if (rules.length === 0) {
        return;
      }

      await this.applyRules({
        openStackCloud: openStackCloud,
        rules: rules,
        allowOwnerNotification: true,
      });
    } catch (error) {
      logger.error(`Error applying OpenStack cloud owner rules: ${error}`, {
        projectId: openStackCloud.projectId?.toString(),
        openStackCloudId: openStackCloud.id?.toString(),
      } as LogAttributes);
    }
  }

  /*
   * "Run now": the same evaluation, for a OpenStack cloud that already exists
   * and only the rules being run.
   */
  @CaptureSpan()
  public async applyRulesToExistingResource(
    data: ApplyRulesToExistingResourceData<
      OpenStackCloud,
      OpenStackCloudOwnerRule
    >,
  ): Promise<RuleApplicationResult> {
    try {
      return await this.applyRules({
        openStackCloud: data.resource,
        rules: data.rules,
        allowOwnerNotification: data.allowOwnerNotification,
      });
    } catch (error) {
      logger.error(`Error running OpenStack cloud owner rules: ${error}`, {
        projectId: data.resource.projectId?.toString(),
        openStackCloudId: data.resource.id?.toString(),
      } as LogAttributes);

      return RuleApplicationResultUtil.failed();
    }
  }

  @RuleEvaluation()
  private async applyRules(data: {
    openStackCloud: OpenStackCloud;
    rules: Array<OpenStackCloudOwnerRule>;
    allowOwnerNotification: boolean;
  }): Promise<RuleApplicationResult> {
    const { openStackCloud, rules } = data;

    if (!openStackCloud.id || !openStackCloud.projectId || rules.length === 0) {
      return RuleApplicationResultUtil.noMatch();
    }

    const openStackCloudWithDetails: OpenStackCloud | null =
      await OpenStackCloudService.findOneById({
        id: openStackCloud.id,
        select: {
          name: true,
          description: true,
          labels: { _id: true },
        },
        props: { isRoot: true },
      });

    if (!openStackCloudWithDetails) {
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

    const matchedRules: Array<OpenStackCloudOwnerRule> = [];
    const allUserIds: Set<string> = new Set();
    const allTeamIds: Set<string> = new Set();
    let anyRuleMatched: boolean = false;

    for (const rule of rules) {
      const matches: boolean = this.doesOpenStackCloudMatchRule(
        openStackCloudWithDetails,
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

    // Owners already on the OpenStack cloud are skipped rather than duplicated.
    const notYetAssigned: OwnersToAssign =
      await OwnerRuleAssignment.getOwnersNotYetAssigned({
        ownerUserService: OpenStackCloudOwnerUserService,
        ownerTeamService: OpenStackCloudOwnerTeamService,
        resourceIdColumn: "openStackCloudId",
        resourceId: openStackCloud.id,
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
        const owner: OpenStackCloudOwnerUser = new OpenStackCloudOwnerUser();
        owner.openStackCloudId = openStackCloud.id;
        owner.projectId = openStackCloud.projectId;
        owner.userId = new ObjectID(userId);
        owner.isOwnerNotified = !notify;
        if (
          await OwnerRuleAssignment.createOwner({
            ownerService: OpenStackCloudOwnerUserService,
            owner: owner,
            props: { isRoot: true },
          })
        ) {
          ownersAdded++;
        }
      }

      for (const teamId of teamIds) {
        const owner: OpenStackCloudOwnerTeam = new OpenStackCloudOwnerTeam();
        owner.openStackCloudId = openStackCloud.id;
        owner.projectId = openStackCloud.projectId;
        owner.teamId = new ObjectID(teamId);
        owner.isOwnerNotified = !notify;
        if (
          await OwnerRuleAssignment.createOwner({
            ownerService: OpenStackCloudOwnerTeamService,
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
      `OpenStackCloudOwnerRuleEngine added owners to OpenStack cloud ${openStackCloud.id}`,
      { projectId: openStackCloud.projectId.toString() } as LogAttributes,
    );
    /*
     * The individual OwnerUserAdded / OwnerTeamAdded items say who was added;
     * this one says which rule is responsible, which is what somebody asking
     * "why am I on the hook for this?" actually needs.
     */
    await OpenStackCloudFeedService.createOpenStackCloudFeedItem({
      openStackCloudId: openStackCloud.id,
      projectId: openStackCloud.projectId,
      openStackCloudFeedEventType:
        OpenStackCloudFeedEventType.OwnerRuleExecuted,
      displayColor: Purple500,
      feedInfoInMarkdown:
        mdText`👥 Owners were added to ${await OpenStackCloudService.getOpenStackCloudMarkdownLink(
          openStackCloud.projectId,
          openStackCloud.id,
        )} by ${matchedRules.length} owner ${matchedRules.length === 1 ? "rule" : "rules"}.`.toString(),
      moreInformationInMarkdown: RuleFeedMarkdown.matchedRulesLine({
        ruleKind: "Owner",
        ruleNames: matchedRules.map((rule: OpenStackCloudOwnerRule): string => {
          return rule.name || rule.id?.toString() || "Unnamed rule";
        }),
      }).toString(),
    });

    return RuleApplicationResultUtil.updated(ownersAdded);
  }

  private doesOpenStackCloudMatchRule(
    openStackCloud: OpenStackCloud,
    rule: OpenStackCloudOwnerRule,
  ): boolean {
    return RuleCriteriaMatcher.matchesWithLegacySync({
      rule: rule,
      legacyFields: [
        "openStackCloudLabels",
        "openStackCloudNamePattern",
        "openStackCloudDescriptionPattern",
      ],
      emptyResult: true,
      matchesLegacyRule: (
        openStackCloudRule: OpenStackCloudOwnerRule,
      ): boolean => {
        return this.doesOpenStackCloudMatchRuleLegacy(
          openStackCloud,
          openStackCloudRule,
        );
      },
    });
  }

  private doesOpenStackCloudMatchRuleLegacy(
    openStackCloud: OpenStackCloud,
    rule: OpenStackCloudOwnerRule,
  ): boolean {
    if (rule.openStackCloudLabels && rule.openStackCloudLabels.length > 0) {
      if (!openStackCloud.labels || openStackCloud.labels.length === 0) {
        return false;
      }
      const ruleLabelIds: Array<string> = rule.openStackCloudLabels.map(
        (l: Label) => {
          return l.id?.toString() || "";
        },
      );
      const labelIds: Array<string> = openStackCloud.labels.map((l: Label) => {
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
      rule.openStackCloudNamePattern &&
      (!openStackCloud.name ||
        !this.testRegex(
          rule.openStackCloudNamePattern,
          openStackCloud.name,
          rule,
        ))
    ) {
      return false;
    }

    if (
      rule.openStackCloudDescriptionPattern &&
      (!openStackCloud.description ||
        !this.testRegex(
          rule.openStackCloudDescriptionPattern,
          openStackCloud.description,
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
    rule: OpenStackCloudOwnerRule,
  ): boolean {
    try {
      return RulePatternMatchUtil.testRegex(pattern, value);
    } catch {
      logger.warn(
        `Invalid regex in OpenStack cloud owner rule ${rule.id}: ${pattern}`,
      );
      return false;
    }
  }
}

export default new OpenStackCloudOwnerRuleEngineServiceClass();
