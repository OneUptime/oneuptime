import Label from "../../Models/DatabaseModels/Label";
import DataAsset from "../../Models/DatabaseModels/DataAsset";
import DataAssetOwnerRule from "../../Models/DatabaseModels/DataAssetOwnerRule";
import DataAssetOwnerUser from "../../Models/DatabaseModels/DataAssetOwnerUser";
import DataAssetOwnerTeam from "../../Models/DatabaseModels/DataAssetOwnerTeam";
import DataAssetOwnerRuleService from "./DataAssetOwnerRuleService";
import DataAssetOwnerUserService from "./DataAssetOwnerUserService";
import DataAssetOwnerTeamService from "./DataAssetOwnerTeamService";
import DataAssetService from "./DataAssetService";
import DataAssetFeedService from "./DataAssetFeedService";
import { DataAssetFeedEventType } from "../../Models/DatabaseModels/DataAssetFeed";
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

class DataAssetOwnerRuleEngineServiceClass
  implements RuleRunEngine<DataAsset, DataAssetOwnerRule>
{
  public readonly ruleSelect: Select<DataAssetOwnerRule> = {
    _id: true,
    name: true,
    criteria: true,
    notifyOwners: true,
    matchLabels: { _id: true },
    nameRegexPattern: true,
    databaseRegexPattern: true,
    schemaRegexPattern: true,
    ownerUsers: { _id: true },
    ownerTeams: { _id: true },
  };

  // Evaluation re-reads the table, so a run only has to name it.
  public readonly resourceSelectForRuleRun: Select<DataAsset> = {
    _id: true,
    projectId: true,
  };

  /**
   * Evaluates DataAssetOwnerRule rows for the given resource and adds
   * matched owner users / teams. Rules with notifyOwners set notify the added
   * owners; rules with notifyOwners off add silently.
   */
  @CaptureSpan()
  public async applyRulesToDataAsset(dataAsset: DataAsset): Promise<void> {
    if (!dataAsset.id || !dataAsset.projectId) {
      return;
    }

    try {
      const rules: Array<DataAssetOwnerRule> =
        await DataAssetOwnerRuleService.findBy({
          query: {
            projectId: dataAsset.projectId,
            isEnabled: true,
          },
          props: { isRoot: true },
          select: this.ruleSelect,
          limit: MAX_RULES_EVALUATED_PER_PROJECT,
          skip: 0,
        });

      logIfRuleReadWasTruncated({
        ruleKind: "DataAssetOwnerRule",
        projectId: dataAsset.projectId,
        rulesRead: rules.length,
      });

      if (rules.length === 0) {
        return;
      }

      await this.applyRules({
        dataAsset: dataAsset,
        rules: rules,
        allowOwnerNotification: true,
      });
    } catch (error) {
      logger.error(`Error applying table owner rules: ${error}`, {
        projectId: dataAsset.projectId?.toString(),
        dataAssetId: dataAsset.id?.toString(),
      } as LogAttributes);
    }
  }

  /*
   * "Run now": the same evaluation, for a table that already exists
   * and only the rules being run.
   */
  @CaptureSpan()
  public async applyRulesToExistingResource(
    data: ApplyRulesToExistingResourceData<DataAsset, DataAssetOwnerRule>,
  ): Promise<RuleApplicationResult> {
    try {
      return await this.applyRules({
        dataAsset: data.resource,
        rules: data.rules,
        allowOwnerNotification: data.allowOwnerNotification,
      });
    } catch (error) {
      logger.error(`Error running table owner rules: ${error}`, {
        projectId: data.resource.projectId?.toString(),
        dataAssetId: data.resource.id?.toString(),
      } as LogAttributes);

      return RuleApplicationResultUtil.failed();
    }
  }

  @RuleEvaluation()
  private async applyRules(data: {
    dataAsset: DataAsset;
    rules: Array<DataAssetOwnerRule>;
    allowOwnerNotification: boolean;
  }): Promise<RuleApplicationResult> {
    const { dataAsset, rules } = data;

    if (!dataAsset.id || !dataAsset.projectId || rules.length === 0) {
      return RuleApplicationResultUtil.noMatch();
    }

    const resourceWithDetails: DataAsset | null =
      await DataAssetService.findOneById({
        id: dataAsset.id,
        select: {
          name: true,
          schemaName: true,
          dataStoreName: true,
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

    // Owners already on the table are skipped rather than duplicated.
    const notYetAssigned: OwnersToAssign =
      await OwnerRuleAssignment.getOwnersNotYetAssigned({
        ownerUserService: DataAssetOwnerUserService,
        ownerTeamService: DataAssetOwnerTeamService,
        resourceIdColumn: "dataAssetId",
        resourceId: dataAsset.id,
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
        const owner: DataAssetOwnerUser = new DataAssetOwnerUser();
        owner.dataAssetId = dataAsset.id;
        owner.projectId = dataAsset.projectId;
        owner.userId = new ObjectID(userId);
        owner.isOwnerNotified = !notify;
        if (
          await OwnerRuleAssignment.createOwner({
            ownerService: DataAssetOwnerUserService,
            owner: owner,
            props: { isRoot: true },
          })
        ) {
          ownersAdded++;
        }
      }

      for (const teamId of teamIds) {
        const owner: DataAssetOwnerTeam = new DataAssetOwnerTeam();
        owner.dataAssetId = dataAsset.id;
        owner.projectId = dataAsset.projectId;
        owner.teamId = new ObjectID(teamId);
        owner.isOwnerNotified = !notify;
        if (
          await OwnerRuleAssignment.createOwner({
            ownerService: DataAssetOwnerTeamService,
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
    await DataAssetFeedService.createDataAssetFeedItem({
      dataAssetId: dataAsset.id,
      projectId: dataAsset.projectId,
      dataAssetFeedEventType: DataAssetFeedEventType.OwnerRuleExecuted,
      displayColor: Purple500,
      feedInfoInMarkdown:
        mdText`👥 Owners were added to ${await DataAssetService.getDataAssetMarkdownLink(
          dataAsset.projectId,
          dataAsset.id,
        )} by ${matchedRuleNames.length} owner ${matchedRuleNames.length === 1 ? "rule" : "rules"}.`.toString(),
      moreInformationInMarkdown: RuleFeedMarkdown.matchedRulesLine({
        ruleKind: "Owner",
        ruleNames: matchedRuleNames,
      }).toString(),
    });

    return RuleApplicationResultUtil.updated(ownersAdded);
  }

  private doesMatchRule(
    dataAsset: DataAsset,
    rule: DataAssetOwnerRule,
  ): boolean {
    return RuleCriteriaMatcher.matchesWithLegacySync({
      rule,
      legacyFields: [
        "matchLabels",
        "nameRegexPattern",
        "databaseRegexPattern",
        "schemaRegexPattern",
      ],
      emptyResult: true,
      matchesLegacyRule: (legacyRule: DataAssetOwnerRule): boolean => {
        return this.doesMatchLegacyRule(dataAsset, legacyRule);
      },
    });
  }

  private doesMatchLegacyRule(
    dataAsset: DataAsset,
    rule: DataAssetOwnerRule,
  ): boolean {
    if (rule.matchLabels && rule.matchLabels.length > 0) {
      if (!dataAsset.labels || dataAsset.labels.length === 0) {
        return false;
      }
      const ruleLabelIds: Array<string> = rule.matchLabels.map((l: Label) => {
        return l.id?.toString() || "";
      });
      const labelIds: Array<string> = dataAsset.labels.map((l: Label) => {
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
      (!dataAsset.name ||
        !this.testRegex(rule.nameRegexPattern, dataAsset.name))
    ) {
      return false;
    }

    if (
      rule.databaseRegexPattern &&
      (!dataAsset.dataStoreName ||
        !this.testRegex(rule.databaseRegexPattern, dataAsset.dataStoreName))
    ) {
      return false;
    }

    if (
      rule.schemaRegexPattern &&
      (!dataAsset.schemaName ||
        !this.testRegex(rule.schemaRegexPattern, dataAsset.schemaName))
    ) {
      return false;
    }

    return true;
  }

  private testRegex(pattern: string, value: string): boolean {
    try {
      return RulePatternMatchUtil.testRegex(pattern, value);
    } catch {
      logger.warn(`Invalid regex in table owner rule: ${pattern}`);
      return false;
    }
  }
}

export default new DataAssetOwnerRuleEngineServiceClass();
