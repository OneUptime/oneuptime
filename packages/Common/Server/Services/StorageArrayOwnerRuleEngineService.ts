import Label from "../../Models/DatabaseModels/Label";
import StorageArray from "../../Models/DatabaseModels/StorageArray";
import StorageArrayOwnerRule from "../../Models/DatabaseModels/StorageArrayOwnerRule";
import StorageArrayOwnerUser from "../../Models/DatabaseModels/StorageArrayOwnerUser";
import StorageArrayOwnerTeam from "../../Models/DatabaseModels/StorageArrayOwnerTeam";
import StorageArrayOwnerRuleService from "./StorageArrayOwnerRuleService";
import StorageArrayOwnerUserService from "./StorageArrayOwnerUserService";
import StorageArrayOwnerTeamService from "./StorageArrayOwnerTeamService";
import StorageArrayService from "./StorageArrayService";
import StorageArrayFeedService from "./StorageArrayFeedService";
import { StorageArrayFeedEventType } from "../../Models/DatabaseModels/StorageArrayFeed";
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

class StorageArrayOwnerRuleEngineServiceClass
  implements RuleRunEngine<StorageArray, StorageArrayOwnerRule>
{
  public readonly ruleSelect: Select<StorageArrayOwnerRule> = {
    _id: true,
    name: true,
    criteria: true,
    notifyOwners: true,
    storageArrayLabels: { _id: true },
    storageArrayNamePattern: true,
    storageArrayDescriptionPattern: true,
    ownerUsers: { _id: true },
    ownerTeams: { _id: true },
  };

  // Evaluation re-reads the storage array, so a run only has to name it.
  public readonly resourceSelectForRuleRun: Select<StorageArray> = {
    _id: true,
    projectId: true,
  };

  /**
   * Evaluates StorageArrayOwnerRule rows for the given storage array and adds matched
   * owner users / teams via StorageArrayOwnerUserService / StorageArrayOwnerTeamService. Rules
   * with notifyOwners set notify the added owners; rules with notifyOwners off
   * add silently.
   */
  @CaptureSpan()
  public async applyRulesToStorageArray(
    storageArray: StorageArray,
  ): Promise<void> {
    if (!storageArray.id || !storageArray.projectId) {
      return;
    }

    try {
      const rules: Array<StorageArrayOwnerRule> =
        await StorageArrayOwnerRuleService.findBy({
          query: {
            projectId: storageArray.projectId,
            isEnabled: true,
          },
          props: { isRoot: true },
          select: this.ruleSelect,
          limit: MAX_RULES_EVALUATED_PER_PROJECT,
          skip: 0,
        });

      logIfRuleReadWasTruncated({
        ruleKind: "StorageArrayOwnerRule",
        projectId: storageArray.projectId,
        rulesRead: rules.length,
      });

      if (rules.length === 0) {
        return;
      }

      await this.applyRules({
        storageArray: storageArray,
        rules: rules,
        allowOwnerNotification: true,
      });
    } catch (error) {
      logger.error(`Error applying storage array owner rules: ${error}`, {
        projectId: storageArray.projectId?.toString(),
        storageArrayId: storageArray.id?.toString(),
      } as LogAttributes);
    }
  }

  /*
   * "Run now": the same evaluation, for a storage array that already exists
   * and only the rules being run.
   */
  @CaptureSpan()
  public async applyRulesToExistingResource(
    data: ApplyRulesToExistingResourceData<StorageArray, StorageArrayOwnerRule>,
  ): Promise<RuleApplicationResult> {
    try {
      return await this.applyRules({
        storageArray: data.resource,
        rules: data.rules,
        allowOwnerNotification: data.allowOwnerNotification,
      });
    } catch (error) {
      logger.error(`Error running storage array owner rules: ${error}`, {
        projectId: data.resource.projectId?.toString(),
        storageArrayId: data.resource.id?.toString(),
      } as LogAttributes);

      return RuleApplicationResultUtil.failed();
    }
  }

  private async applyRules(data: {
    storageArray: StorageArray;
    rules: Array<StorageArrayOwnerRule>;
    allowOwnerNotification: boolean;
  }): Promise<RuleApplicationResult> {
    const { storageArray, rules } = data;

    if (!storageArray.id || !storageArray.projectId || rules.length === 0) {
      return RuleApplicationResultUtil.noMatch();
    }

    const storageArrayWithDetails: StorageArray | null =
      await StorageArrayService.findOneById({
        id: storageArray.id,
        select: {
          name: true,
          description: true,
          labels: { _id: true },
        },
        props: { isRoot: true },
      });

    if (!storageArrayWithDetails) {
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

    const matchedRules: Array<StorageArrayOwnerRule> = [];
    const allUserIds: Set<string> = new Set();
    const allTeamIds: Set<string> = new Set();
    let anyRuleMatched: boolean = false;

    for (const rule of rules) {
      const matches: boolean = this.doesStorageArrayMatchRule(
        storageArrayWithDetails,
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

    // The rules that matched name no owners, so there is nothing to add.
    if (matchedRules.length === 0) {
      return RuleApplicationResultUtil.alreadyApplied();
    }

    // Owners already on the storage array are skipped rather than duplicated.
    const notYetAssigned: OwnersToAssign =
      await OwnerRuleAssignment.getOwnersNotYetAssigned({
        ownerUserService: StorageArrayOwnerUserService,
        ownerTeamService: StorageArrayOwnerTeamService,
        resourceIdColumn: "storageArrayId",
        resourceId: storageArray.id,
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
        const owner: StorageArrayOwnerUser = new StorageArrayOwnerUser();
        owner.storageArrayId = storageArray.id;
        owner.projectId = storageArray.projectId;
        owner.userId = new ObjectID(userId);
        owner.isOwnerNotified = !notify;
        if (
          await OwnerRuleAssignment.createOwner({
            ownerService: StorageArrayOwnerUserService,
            owner: owner,
            props: { isRoot: true },
          })
        ) {
          ownersAdded++;
        }
      }

      for (const teamId of teamIds) {
        const owner: StorageArrayOwnerTeam = new StorageArrayOwnerTeam();
        owner.storageArrayId = storageArray.id;
        owner.projectId = storageArray.projectId;
        owner.teamId = new ObjectID(teamId);
        owner.isOwnerNotified = !notify;
        if (
          await OwnerRuleAssignment.createOwner({
            ownerService: StorageArrayOwnerTeamService,
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
      `StorageArrayOwnerRuleEngine added owners to storage array ${storageArray.id}`,
      { projectId: storageArray.projectId.toString() } as LogAttributes,
    );
    /*
     * The individual OwnerUserAdded / OwnerTeamAdded items say who was added;
     * this one says which rule is responsible, which is what somebody asking
     * "why am I on the hook for this?" actually needs.
     */
    await StorageArrayFeedService.createStorageArrayFeedItem({
      storageArrayId: storageArray.id,
      projectId: storageArray.projectId,
      storageArrayFeedEventType: StorageArrayFeedEventType.OwnerRuleExecuted,
      displayColor: Purple500,
      feedInfoInMarkdown:
        mdText`👥 Owners were added to ${await StorageArrayService.getStorageArrayMarkdownLink(
          storageArray.projectId,
          storageArray.id,
        )} by ${matchedRules.length} owner ${matchedRules.length === 1 ? "rule" : "rules"}.`.toString(),
      moreInformationInMarkdown: RuleFeedMarkdown.matchedRulesLine({
        ruleKind: "Owner",
        ruleNames: matchedRules.map((rule: StorageArrayOwnerRule): string => {
          return rule.name || rule.id?.toString() || "Unnamed rule";
        }),
      }).toString(),
    });

    return RuleApplicationResultUtil.updated(ownersAdded);
  }

  private doesStorageArrayMatchRule(
    storageArray: StorageArray,
    rule: StorageArrayOwnerRule,
  ): boolean {
    return RuleCriteriaMatcher.matchesWithLegacySync({
      rule,
      legacyFields: [
        "storageArrayLabels",
        "storageArrayNamePattern",
        "storageArrayDescriptionPattern",
      ],
      emptyResult: true,
      matchesLegacyRule: (legacyRule: StorageArrayOwnerRule): boolean => {
        return this.doesStorageArrayMatchLegacyRule(storageArray, legacyRule);
      },
    });
  }

  private doesStorageArrayMatchLegacyRule(
    storageArray: StorageArray,
    rule: StorageArrayOwnerRule,
  ): boolean {
    if (rule.storageArrayLabels && rule.storageArrayLabels.length > 0) {
      if (!storageArray.labels || storageArray.labels.length === 0) {
        return false;
      }
      const ruleLabelIds: Array<string> = rule.storageArrayLabels.map(
        (l: Label) => {
          return l.id?.toString() || "";
        },
      );
      const labelIds: Array<string> = storageArray.labels.map((l: Label) => {
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
      rule.storageArrayNamePattern &&
      (!storageArray.name ||
        !this.testRegex(rule.storageArrayNamePattern, storageArray.name, rule))
    ) {
      return false;
    }

    if (
      rule.storageArrayDescriptionPattern &&
      (!storageArray.description ||
        !this.testRegex(
          rule.storageArrayDescriptionPattern,
          storageArray.description,
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
    rule: StorageArrayOwnerRule,
  ): boolean {
    try {
      const regex: RegExp = new RegExp(pattern, "i");
      return regex.test(value);
    } catch {
      logger.warn(
        `Invalid regex in storage array owner rule ${rule.id}: ${pattern}`,
      );
      return false;
    }
  }
}

export default new StorageArrayOwnerRuleEngineServiceClass();
