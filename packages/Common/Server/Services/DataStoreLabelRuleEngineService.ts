import RuleRecordScope from "../Utils/Rules/RuleRecordScope";
import Label from "../../Models/DatabaseModels/Label";
import DataStore from "../../Models/DatabaseModels/DataStore";
import DataStoreLabelRule from "../../Models/DatabaseModels/DataStoreLabelRule";
import DataStoreLabelRuleService from "./DataStoreLabelRuleService";
import DataStoreService from "./DataStoreService";
import { getCloudTagRuleMatchValues } from "../../Types/Cloud/CloudInventory";
import DataStoreFeedService from "./DataStoreFeedService";
import { DataStoreFeedEventType } from "../../Models/DatabaseModels/DataStoreFeed";
import { Purple500 } from "../../Types/BrandColors";
import ObjectID from "../../Types/ObjectID";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger, { LogAttributes } from "../Utils/Logger";
import { MAX_RULES_EVALUATED_PER_PROJECT } from "../../Utils/Rules/RuleEngineLimits";
import { RuleCriteriaMatcher } from "../../Utils/Rules/RuleCriteriaMatcher";
import logIfRuleReadWasTruncated from "../Utils/Rules/RuleEngineRuleRead";
import Select from "../Types/Database/Select";
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

class DataStoreLabelRuleEngineServiceClass
  implements RuleRunEngine<DataStore, DataStoreLabelRule>
{
  public readonly ruleSelect: Select<DataStoreLabelRule> = {
    _id: true,
    name: true,
    criteria: true,
    matchLabels: { _id: true },
    nameRegexPattern: true,
    descriptionRegexPattern: true,
    cloudTagPattern: true,
    labelsToAdd: { _id: true },
  };

  // Evaluation re-reads the data store, so a run only has to name it.
  public readonly resourceSelectForRuleRun: Select<DataStore> = {
    _id: true,
    projectId: true,
  };

  /**
   * Evaluates DataStoreLabelRule rows for the given resource and attaches
   * matched labels. The union is deduped against labels already on the
   * resource before insert to avoid PK conflicts on the join table.
   */
  @CaptureSpan()
  public async applyRulesToDataStore(dataStore: DataStore): Promise<void> {
    if (!dataStore.id || !dataStore.projectId) {
      return;
    }

    try {
      const rules: Array<DataStoreLabelRule> =
        await DataStoreLabelRuleService.findBy({
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
        ruleKind: "DataStoreLabelRule",
        projectId: dataStore.projectId,
        rulesRead: rules.length,
      });

      if (rules.length === 0) {
        return;
      }

      await this.applyRules({ dataStore: dataStore, rules: rules });
    } catch (error) {
      logger.error(`Error applying data store label rules: ${error}`, {
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
    data: ApplyRulesToExistingResourceData<DataStore, DataStoreLabelRule>,
  ): Promise<RuleApplicationResult> {
    try {
      return await this.applyRules({
        dataStore: data.resource,
        rules: data.rules,
      });
    } catch (error) {
      logger.error(`Error running data store label rules: ${error}`, {
        projectId: data.resource.projectId?.toString(),
        dataStoreId: data.resource.id?.toString(),
      } as LogAttributes);

      return RuleApplicationResultUtil.failed();
    }
  }

  @RuleEvaluation()
  private async applyRules(data: {
    dataStore: DataStore;
    rules: Array<DataStoreLabelRule>;
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

    const labelIdsToAdd: Set<string> = new Set();
    let matchedAnyRule: boolean = false;
    const matchedRuleNames: Array<string> = [];

    for (const rule of rules) {
      if (!this.doesMatchRule(resourceWithDetails, rule)) {
        continue;
      }
      matchedAnyRule = true;
      if ((rule.labelsToAdd || []).length > 0) {
        matchedRuleNames.push(
          rule.name || rule.id?.toString() || "Unnamed rule",
        );
      }
      for (const label of rule.labelsToAdd || []) {
        if (label.id) {
          labelIdsToAdd.add(label.id.toString());
        }
      }
    }

    if (!matchedAnyRule) {
      return RuleApplicationResultUtil.noMatch();
    }

    if (labelIdsToAdd.size === 0) {
      return RuleApplicationResultUtil.alreadyApplied();
    }

    const existingLabelIds: Set<string> = new Set(
      (resourceWithDetails.labels || [])
        .map((l: Label) => {
          return l.id?.toString() || "";
        })
        .filter((id: string) => {
          return id !== "";
        }),
    );

    /*
     * Only the project's own labels. The rules' lists are checked when a
     * rule is saved, but a rule saved before that can still name another
     * project's label, and the labels are attached here as root.
     */
    const newLabelIds: Array<string> = await RuleRecordScope.keepIdsInProject({
      projectId: dataStore.projectId,
      ids: Array.from(labelIdsToAdd).filter((id: string) => {
        return !existingLabelIds.has(id);
      }),
      modelType: Label,
      description: "labels of data store label rules",
      logAttributes: {
        projectId: dataStore.projectId.toString(),
        dataStoreId: dataStore.id.toString(),
      } as LogAttributes,
    });
    if (newLabelIds.length === 0) {
      return RuleApplicationResultUtil.alreadyApplied();
    }

    await DataStoreService.getRepository()
      .createQueryBuilder()
      .relation(DataStore, "labels")
      .of(dataStore.id.toString())
      .add(newLabelIds);

    const mergedLabelIds: Set<string> = new Set([
      ...existingLabelIds,
      ...newLabelIds,
    ]);
    dataStore.labels = Array.from(mergedLabelIds).map((id: string) => {
      const label: Label = new Label();
      label.id = new ObjectID(id);
      return label;
    });
    /*
     * Labels arriving from a rule rather than from a person is exactly the
     * kind of thing the overview page cannot explain, so record which rules
     * did it.
     */
    await DataStoreFeedService.createDataStoreFeedItem({
      dataStoreId: dataStore.id,
      projectId: dataStore.projectId,
      dataStoreFeedEventType: DataStoreFeedEventType.LabelRuleExecuted,
      displayColor: Purple500,
      feedInfoInMarkdown:
        mdText`🏷️ ${newLabelIds.length} label(s) were attached to ${await DataStoreService.getDataStoreMarkdownLink(
          dataStore.projectId,
          dataStore.id,
        )} by label ${matchedRuleNames.length === 1 ? "rule" : "rules"}.`.toString(),
      moreInformationInMarkdown: RuleFeedMarkdown.matchedRulesLine({
        ruleKind: "Label",
        ruleNames: matchedRuleNames,
      }).toString(),
    });

    return RuleApplicationResultUtil.updated(newLabelIds.length);
  }

  private doesMatchRule(
    dataStore: DataStore,
    rule: DataStoreLabelRule,
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
      matchesLegacyRule: (legacyRule: DataStoreLabelRule): boolean => {
        return this.doesMatchLegacyRule(dataStore, legacyRule);
      },
    });
  }

  private doesMatchLegacyRule(
    dataStore: DataStore,
    rule: DataStoreLabelRule,
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
      logger.warn(`Invalid regex in data store label rule: ${pattern}`);
      return false;
    }
  }
}

export default new DataStoreLabelRuleEngineServiceClass();
