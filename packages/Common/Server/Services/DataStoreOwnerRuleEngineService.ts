import Label from "../../Models/DatabaseModels/Label";
import DataStore from "../../Models/DatabaseModels/DataStore";
import DataStoreOwnerRule from "../../Models/DatabaseModels/DataStoreOwnerRule";
import DataStoreOwnerUser from "../../Models/DatabaseModels/DataStoreOwnerUser";
import DataStoreOwnerTeam from "../../Models/DatabaseModels/DataStoreOwnerTeam";
import DataStoreOwnerRuleService from "./DataStoreOwnerRuleService";
import DataStoreOwnerUserService from "./DataStoreOwnerUserService";
import DataStoreOwnerTeamService from "./DataStoreOwnerTeamService";
import DataStoreService from "./DataStoreService";
import { getCloudTagRuleMatchValues } from "../../Types/Cloud/CloudInventory";
import DataStoreFeedService from "./DataStoreFeedService";
import { DataStoreFeedEventType } from "../../Models/DatabaseModels/DataStoreFeed";
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

class DataStoreOwnerRuleEngineServiceClass
  implements RuleRunEngine<DataStore, DataStoreOwnerRule>
{
  public readonly ruleSelect: Select<DataStoreOwnerRule> = {
    _id: true,
    name: true,
    criteria: true,
    notifyOwners: true,
    matchLabels: { _id: true },
    nameRegexPattern: true,
    descriptionRegexPattern: true,
    cloudTagPattern: true,
    ownerUsers: { _id: true },
    ownerTeams: { _id: true },
  };

  // Evaluation re-reads the data store, so a run only has to name it.
  public readonly resourceSelectForRuleRun: Select<DataStore> = {
    _id: true,
    projectId: true,
  };

  /**
   * Evaluates DataStoreOwnerRule rows for the given resource and adds
   * matched owner users / teams. Rules with notifyOwners set notify the added
   * owners; rules with notifyOwners off add silently.
   */
  @CaptureSpan()
  public async applyRulesToDataStore(dataStore: DataStore): Promise<void> {
    if (!dataStore.id || !dataStore.projectId) {
      return;
    }

    try {
      const rules: Array<DataStoreOwnerRule> =
        await DataStoreOwnerRuleService.findBy({
          query: {
            projectId: dataStore.projectId,
            isEnabled: true,
          },
          props: { isRoot: true },
          select: this.ruleSelect,
          limit: MAX_RULES_EVALUATED_PER_PROJECT,
          skip: 0,
        });

      logIfRuleReadWasTruncated({
        ruleKind: "DataStoreOwnerRule",
        projectId: dataStore.projectId,
        rulesRead: rules.length,
      });

      if (rules.length === 0) {
        return;
      }

      await this.applyRules({
        dataStore: dataStore,
        rules: rules,
        allowOwnerNotification: true,
      });
    } catch (error) {
      logger.error(`Error applying data store owner rules: ${error}`, {
        projectId: dataStore.projectId?.toString(),
        dataStoreId: dataStore.id?.toString(),
      } as LogAttributes);
    }
  }

  /*
   * "Run now": the same evaluation, for a data store that already exists
   * and only the rules being run.
   */
  @CaptureSpan()
  public async applyRulesToExistingResource(
    data: ApplyRulesToExistingResourceData<DataStore, DataStoreOwnerRule>,
  ): Promise<RuleApplicationResult> {
    try {
      return await this.applyRules({
        dataStore: data.resource,
        rules: data.rules,
        allowOwnerNotification: data.allowOwnerNotification,
      });
    } catch (error) {
      logger.error(`Error running data store owner rules: ${error}`, {
        projectId: data.resource.projectId?.toString(),
        dataStoreId: data.resource.id?.toString(),
      } as LogAttributes);

      return RuleApplicationResultUtil.failed();
    }
  }

  @RuleEvaluation()
  private async applyRules(data: {
    dataStore: DataStore;
    rules: Array<DataStoreOwnerRule>;
    allowOwnerNotification: boolean;
  }): Promise<RuleApplicationResult> {
    const { dataStore, rules } = data;

    if (!dataStore.id || !dataStore.projectId || rules.length === 0) {
      return RuleApplicationResultUtil.noMatch();
    }

    const resourceWithDetails: DataStore | null =
      await DataStoreService.findOneById({
        id: dataStore.id,
        select: {
          name: true,
          description: true,
          labels: { _id: true },
          cloudTags: true,
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

    // Owners already on the data store are skipped rather than duplicated.
    const notYetAssigned: OwnersToAssign =
      await OwnerRuleAssignment.getOwnersNotYetAssigned({
        ownerUserService: DataStoreOwnerUserService,
        ownerTeamService: DataStoreOwnerTeamService,
        resourceIdColumn: "dataStoreId",
        resourceId: dataStore.id,
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
        const owner: DataStoreOwnerUser = new DataStoreOwnerUser();
        owner.dataStoreId = dataStore.id;
        owner.projectId = dataStore.projectId;
        owner.userId = new ObjectID(userId);
        owner.isOwnerNotified = !notify;
        if (
          await OwnerRuleAssignment.createOwner({
            ownerService: DataStoreOwnerUserService,
            owner: owner,
            props: { isRoot: true },
          })
        ) {
          ownersAdded++;
        }
      }

      for (const teamId of teamIds) {
        const owner: DataStoreOwnerTeam = new DataStoreOwnerTeam();
        owner.dataStoreId = dataStore.id;
        owner.projectId = dataStore.projectId;
        owner.teamId = new ObjectID(teamId);
        owner.isOwnerNotified = !notify;
        if (
          await OwnerRuleAssignment.createOwner({
            ownerService: DataStoreOwnerTeamService,
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
    await DataStoreFeedService.createDataStoreFeedItem({
      dataStoreId: dataStore.id,
      projectId: dataStore.projectId,
      dataStoreFeedEventType: DataStoreFeedEventType.OwnerRuleExecuted,
      displayColor: Purple500,
      feedInfoInMarkdown:
        mdText`👥 Owners were added to ${await DataStoreService.getDataStoreMarkdownLink(
          dataStore.projectId,
          dataStore.id,
        )} by ${matchedRuleNames.length} owner ${matchedRuleNames.length === 1 ? "rule" : "rules"}.`.toString(),
      moreInformationInMarkdown: RuleFeedMarkdown.matchedRulesLine({
        ruleKind: "Owner",
        ruleNames: matchedRuleNames,
      }).toString(),
    });

    return RuleApplicationResultUtil.updated(ownersAdded);
  }

  private doesMatchRule(
    dataStore: DataStore,
    rule: DataStoreOwnerRule,
  ): boolean {
    return RuleCriteriaMatcher.matchesWithLegacySync({
      rule,
      legacyFields: [
        "matchLabels",
        "nameRegexPattern",
        "descriptionRegexPattern",
        "cloudTagPattern",
      ],
      emptyResult: true,
      matchesLegacyRule: (legacyRule: DataStoreOwnerRule): boolean => {
        return this.doesMatchLegacyRule(dataStore, legacyRule);
      },
    });
  }

  private doesMatchLegacyRule(
    dataStore: DataStore,
    rule: DataStoreOwnerRule,
  ): boolean {
    if (rule.matchLabels && rule.matchLabels.length > 0) {
      if (!dataStore.labels || dataStore.labels.length === 0) {
        return false;
      }
      const ruleLabelIds: Array<string> = rule.matchLabels.map((l: Label) => {
        return l.id?.toString() || "";
      });
      const labelIds: Array<string> = dataStore.labels.map((l: Label) => {
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
      (!dataStore.name ||
        !this.testRegex(rule.nameRegexPattern, dataStore.name))
    ) {
      return false;
    }

    if (
      rule.descriptionRegexPattern &&
      (!dataStore.description ||
        !this.testRegex(rule.descriptionRegexPattern, dataStore.description))
    ) {
      return false;
    }

    // Any one of the resource's tags, written key=value, matching is enough.
    if (rule.cloudTagPattern) {
      const tagPattern: string = rule.cloudTagPattern;

      if (
        !getCloudTagRuleMatchValues(dataStore.cloudTags).some(
          (value: string): boolean => {
            return this.testRegex(tagPattern, value);
          },
        )
      ) {
        return false;
      }
    }

    return true;
  }

  private testRegex(pattern: string, value: string): boolean {
    try {
      return RulePatternMatchUtil.testRegex(pattern, value);
    } catch {
      logger.warn(`Invalid regex in data store owner rule: ${pattern}`);
      return false;
    }
  }
}

export default new DataStoreOwnerRuleEngineServiceClass();
