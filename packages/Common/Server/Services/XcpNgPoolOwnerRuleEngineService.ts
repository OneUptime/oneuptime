import Label from "../../Models/DatabaseModels/Label";
import XcpNgPool from "../../Models/DatabaseModels/XcpNgPool";
import XcpNgPoolOwnerRule from "../../Models/DatabaseModels/XcpNgPoolOwnerRule";
import XcpNgPoolOwnerUser from "../../Models/DatabaseModels/XcpNgPoolOwnerUser";
import XcpNgPoolOwnerTeam from "../../Models/DatabaseModels/XcpNgPoolOwnerTeam";
import XcpNgPoolOwnerRuleService from "./XcpNgPoolOwnerRuleService";
import XcpNgPoolOwnerUserService from "./XcpNgPoolOwnerUserService";
import XcpNgPoolOwnerTeamService from "./XcpNgPoolOwnerTeamService";
import XcpNgPoolService from "./XcpNgPoolService";
import XcpNgPoolFeedService from "./XcpNgPoolFeedService";
import { XcpNgPoolFeedEventType } from "../../Models/DatabaseModels/XcpNgPoolFeed";
import { Purple500 } from "../../Types/BrandColors";
import ObjectID from "../../Types/ObjectID";
import Select from "../Types/Database/Select";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger, { LogAttributes } from "../Utils/Logger";
import { MAX_RULES_EVALUATED_PER_PROJECT } from "../../Utils/Rules/RuleEngineLimits";
import { RuleCriteriaMatcher } from "../../Utils/Rules/RuleCriteriaMatcher";
import logIfRuleReadWasTruncated from "../Utils/Rules/RuleEngineRuleRead";
import OwnerRuleAssignment, {
  OwnersAdded,
  OwnersToAssign,
} from "../Utils/Rules/OwnerRuleAssignment";
import OwnerRuleFeed from "../Utils/Rules/OwnerRuleFeed";
import {
  ApplyRulesToExistingResourceData,
  RuleApplicationResult,
  RuleApplicationResultUtil,
  RuleRunEngine,
  RuleRunWriteProps,
} from "../Utils/Rules/RuleRun/RuleApplication";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { mdText } from "../../Utils/Markdown/FeedMarkdown";
import RuleFeedMarkdown from "../Utils/Rules/RuleFeedMarkdown";
import RulePatternMatchUtil from "../../Utils/Rules/RulePatternMatchUtil";
import { RuleEvaluation } from "../Utils/PatternWorkScope";

class XcpNgPoolOwnerRuleEngineServiceClass
  implements RuleRunEngine<XcpNgPool, XcpNgPoolOwnerRule>
{
  public readonly ruleSelect: Select<XcpNgPoolOwnerRule> = {
    _id: true,
    name: true,
    criteria: true,
    notifyOwners: true,
    xcpNgPoolLabels: { _id: true },
    xcpNgPoolNamePattern: true,
    xcpNgPoolDescriptionPattern: true,
    ownerUsers: { _id: true },
    ownerTeams: { _id: true },
  };

  // Evaluation re-reads the XCP-ng pool, so a run only has to name it.
  public readonly resourceSelectForRuleRun: Select<XcpNgPool> = {
    _id: true,
    projectId: true,
  };

  /**
   * Evaluates XcpNgPoolOwnerRule rows for the given XCP-ng pool and adds matched
   * owner users / teams via XcpNgPoolOwnerUserService / XcpNgPoolOwnerTeamService. Rules
   * with notifyOwners set notify the added owners; rules with notifyOwners off
   * add silently.
   */
  @CaptureSpan()
  public async applyRulesToXcpNgPool(xcpNgPool: XcpNgPool): Promise<void> {
    if (!xcpNgPool.id || !xcpNgPool.projectId) {
      return;
    }

    try {
      const rules: Array<XcpNgPoolOwnerRule> =
        await XcpNgPoolOwnerRuleService.findBy({
          query: {
            projectId: xcpNgPool.projectId,
            isEnabled: true,
          },
          props: { isRoot: true },
          select: this.ruleSelect,
          limit: MAX_RULES_EVALUATED_PER_PROJECT,
          skip: 0,
        });

      logIfRuleReadWasTruncated({
        ruleKind: "XcpNgPoolOwnerRule",
        projectId: xcpNgPool.projectId,
        rulesRead: rules.length,
      });

      if (rules.length === 0) {
        return;
      }

      await this.applyRules({
        xcpNgPool: xcpNgPool,
        rules: rules,
        allowOwnerNotification: true,
      });
    } catch (error) {
      logger.error(`Error applying XCP-ng pool owner rules: ${error}`, {
        projectId: xcpNgPool.projectId?.toString(),
        xcpNgPoolId: xcpNgPool.id?.toString(),
      } as LogAttributes);
    }
  }

  /*
   * "Run now": the same evaluation, for an XCP-ng pool that already exists
   * and only the rules being run.
   */
  @CaptureSpan()
  public async applyRulesToExistingResource(
    data: ApplyRulesToExistingResourceData<XcpNgPool, XcpNgPoolOwnerRule>,
  ): Promise<RuleApplicationResult> {
    try {
      return await this.applyRules({
        xcpNgPool: data.resource,
        rules: data.rules,
        allowOwnerNotification: data.allowOwnerNotification,
        props: data.props,
      });
    } catch (error) {
      logger.error(`Error running XCP-ng pool owner rules: ${error}`, {
        projectId: data.resource.projectId?.toString(),
        xcpNgPoolId: data.resource.id?.toString(),
      } as LogAttributes);

      return RuleApplicationResultUtil.failed();
    }
  }

  @RuleEvaluation()
  private async applyRules(data: {
    xcpNgPool: XcpNgPool;
    rules: Array<XcpNgPoolOwnerRule>;
    allowOwnerNotification: boolean;
    // Who ran the rule (Run now); none for a rule applied on create.
    props?: DatabaseCommonInteractionProps | undefined;
  }): Promise<RuleApplicationResult> {
    const { xcpNgPool, rules } = data;

    if (!xcpNgPool.id || !xcpNgPool.projectId || rules.length === 0) {
      return RuleApplicationResultUtil.noMatch();
    }

    const xcpNgPoolWithDetails: XcpNgPool | null =
      await XcpNgPoolService.findOneById({
        id: xcpNgPool.id,
        select: {
          name: true,
          description: true,
          labels: { _id: true },
        },
        props: { isRoot: true },
      });

    if (!xcpNgPoolWithDetails) {
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

    const matchedRules: Array<XcpNgPoolOwnerRule> = [];
    const allUserIds: Set<string> = new Set();
    const allTeamIds: Set<string> = new Set();
    let anyRuleMatched: boolean = false;

    for (const rule of rules) {
      const matches: boolean = this.doesXcpNgPoolMatchRule(
        xcpNgPoolWithDetails,
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

    // Owners already on the XCP-ng pool are skipped rather than duplicated.
    const notYetAssigned: OwnersToAssign =
      await OwnerRuleAssignment.getOwnersNotYetAssigned({
        ownerUserService: XcpNgPoolOwnerUserService,
        ownerTeamService: XcpNgPoolOwnerTeamService,
        resourceIdColumn: "xcpNgPoolId",
        resourceId: xcpNgPool.id,
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

    /*
     * What the adds did: the owners written, and the ones skipped and why -
     * a user who has left the project, a team that is not one of its teams
     * (#9933). The count, the result and the rules credited are made from
     * these.
     */
    const outcome: OwnersAdded = OwnerRuleAssignment.noOwnersAdded();

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
        const owner: XcpNgPoolOwnerUser = new XcpNgPoolOwnerUser();
        owner.xcpNgPoolId = xcpNgPool.id;
        owner.projectId = xcpNgPool.projectId;
        owner.userId = new ObjectID(userId);
        owner.isOwnerNotified = !notify;
        OwnerRuleAssignment.recordOutcome({
          into: outcome,
          ownerColumn: "userId",
          id: new ObjectID(userId),
          outcome: await OwnerRuleAssignment.createOwnerWithOutcome({
            ownerService: XcpNgPoolOwnerUserService,
            owner: owner,
            props: RuleRunWriteProps.get(data.props),
          }),
        });
      }

      for (const teamId of teamIds) {
        const owner: XcpNgPoolOwnerTeam = new XcpNgPoolOwnerTeam();
        owner.xcpNgPoolId = xcpNgPool.id;
        owner.projectId = xcpNgPool.projectId;
        owner.teamId = new ObjectID(teamId);
        owner.isOwnerNotified = !notify;
        OwnerRuleAssignment.recordOutcome({
          into: outcome,
          ownerColumn: "teamId",
          id: new ObjectID(teamId),
          outcome: await OwnerRuleAssignment.createOwnerWithOutcome({
            ownerService: XcpNgPoolOwnerTeamService,
            owner: owner,
            props: RuleRunWriteProps.get(data.props),
          }),
        });
      }
    }

    const ownersAdded: number = outcome.userIds.length + outcome.teamIds.length;

    OwnerRuleFeed.logSkipped({
      engine: "XcpNgPoolOwnerRuleEngine",
      record: `XCP-ng pool ${xcpNgPool.id.toString()}`,
      outcome: outcome,
      logAttributes: {
        projectId: xcpNgPool.projectId.toString(),
      } as LogAttributes,
    });

    /*
     * Nothing added. When every owner its rules name was skipped, the run
     * could not update this resource: never "already applied", which would
     * say it has owners it does not (OwnerRuleFeed.getResult).
     */
    if (ownersAdded === 0) {
      return OwnerRuleFeed.getResult(outcome);
    }

    // Credited: the rules that brought an owner this run added (#9933).
    const rulesThatAdded: Array<XcpNgPoolOwnerRule> =
      OwnerRuleFeed.getRulesThatAdded(matchedRules, outcome);

    logger.debug(
      `XcpNgPoolOwnerRuleEngine added owners to XCP-ng pool ${xcpNgPool.id}`,
      { projectId: xcpNgPool.projectId.toString() } as LogAttributes,
    );
    /*
     * The individual OwnerUserAdded / OwnerTeamAdded items say who was added;
     * this one says which rule is responsible, which is what somebody asking
     * "why am I on the hook for this?" actually needs.
     */
    await XcpNgPoolFeedService.createXcpNgPoolFeedItem({
      xcpNgPoolId: xcpNgPool.id,
      projectId: xcpNgPool.projectId,
      xcpNgPoolFeedEventType: XcpNgPoolFeedEventType.OwnerRuleExecuted,
      displayColor: Purple500,
      feedInfoInMarkdown:
        mdText`👥 Owners were added to ${await XcpNgPoolService.getXcpNgPoolMarkdownLink(
          xcpNgPool.projectId,
          xcpNgPool.id,
        )} by ${rulesThatAdded.length} owner ${rulesThatAdded.length === 1 ? "rule" : "rules"}.`.toString(),
      moreInformationInMarkdown: RuleFeedMarkdown.matchedRulesLine({
        ruleKind: "Owner",
        ruleNames: rulesThatAdded.map((rule: XcpNgPoolOwnerRule): string => {
          return rule.name || rule.id?.toString() || "Unnamed rule";
        }),
      }).toString(),
    });

    return RuleApplicationResultUtil.updated(ownersAdded);
  }

  private doesXcpNgPoolMatchRule(
    xcpNgPool: XcpNgPool,
    rule: XcpNgPoolOwnerRule,
  ): boolean {
    return RuleCriteriaMatcher.matchesWithLegacySync({
      rule: rule,
      legacyFields: [
        "xcpNgPoolLabels",
        "xcpNgPoolNamePattern",
        "xcpNgPoolDescriptionPattern",
      ],
      emptyResult: true,
      matchesLegacyRule: (xcpNgPoolRule: XcpNgPoolOwnerRule): boolean => {
        return this.doesXcpNgPoolMatchRuleLegacy(xcpNgPool, xcpNgPoolRule);
      },
    });
  }

  private doesXcpNgPoolMatchRuleLegacy(
    xcpNgPool: XcpNgPool,
    rule: XcpNgPoolOwnerRule,
  ): boolean {
    if (rule.xcpNgPoolLabels && rule.xcpNgPoolLabels.length > 0) {
      if (!xcpNgPool.labels || xcpNgPool.labels.length === 0) {
        return false;
      }
      const ruleLabelIds: Array<string> = rule.xcpNgPoolLabels.map(
        (l: Label) => {
          return l.id?.toString() || "";
        },
      );
      const labelIds: Array<string> = xcpNgPool.labels.map((l: Label) => {
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
      rule.xcpNgPoolNamePattern &&
      (!xcpNgPool.name ||
        !this.testRegex(rule.xcpNgPoolNamePattern, xcpNgPool.name, rule))
    ) {
      return false;
    }

    if (
      rule.xcpNgPoolDescriptionPattern &&
      (!xcpNgPool.description ||
        !this.testRegex(
          rule.xcpNgPoolDescriptionPattern,
          xcpNgPool.description,
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
    rule: XcpNgPoolOwnerRule,
  ): boolean {
    try {
      return RulePatternMatchUtil.testRegex(pattern, value);
    } catch {
      logger.warn(
        `Invalid regex in XCP-ng pool owner rule ${rule.id}: ${pattern}`,
      );
      return false;
    }
  }
}

export default new XcpNgPoolOwnerRuleEngineServiceClass();
