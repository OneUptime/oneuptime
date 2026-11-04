import RuleRecordScope from "../Utils/Rules/RuleRecordScope";
import Label from "../../Models/DatabaseModels/Label";
import DataAsset from "../../Models/DatabaseModels/DataAsset";
import DataAssetLabelRule from "../../Models/DatabaseModels/DataAssetLabelRule";
import DataAssetLabelRuleService from "./DataAssetLabelRuleService";
import DataAssetService from "./DataAssetService";
import DataAssetFeedService from "./DataAssetFeedService";
import { DataAssetFeedEventType } from "../../Models/DatabaseModels/DataAssetFeed";
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

class DataAssetLabelRuleEngineServiceClass
  implements RuleRunEngine<DataAsset, DataAssetLabelRule>
{
  public readonly ruleSelect: Select<DataAssetLabelRule> = {
    _id: true,
    name: true,
    criteria: true,
    matchLabels: { _id: true },
    nameRegexPattern: true,
    databaseRegexPattern: true,
    schemaRegexPattern: true,
    labelsToAdd: { _id: true },
  };

  // Evaluation re-reads the table, so a run only has to name it.
  public readonly resourceSelectForRuleRun: Select<DataAsset> = {
    _id: true,
    projectId: true,
  };

  /**
   * Evaluates DataAssetLabelRule rows for the given resource and attaches
   * matched labels. The union is deduped against labels already on the
   * resource before insert to avoid PK conflicts on the join table.
   */
  @CaptureSpan()
  public async applyRulesToDataAsset(dataAsset: DataAsset): Promise<void> {
    if (!dataAsset.id || !dataAsset.projectId) {
      return;
    }

    try {
      const rules: Array<DataAssetLabelRule> =
        await DataAssetLabelRuleService.findBy({
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
        ruleKind: "DataAssetLabelRule",
        projectId: dataAsset.projectId,
        rulesRead: rules.length,
      });

      if (rules.length === 0) {
        return;
      }

      await this.applyRules({ dataAsset: dataAsset, rules: rules });
    } catch (error) {
      logger.error(`Error applying table label rules: ${error}`, {
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
    data: ApplyRulesToExistingResourceData<DataAsset, DataAssetLabelRule>,
  ): Promise<RuleApplicationResult> {
    try {
      return await this.applyRules({
        dataAsset: data.resource,
        rules: data.rules,
      });
    } catch (error) {
      logger.error(`Error running table label rules: ${error}`, {
        projectId: data.resource.projectId?.toString(),
        dataAssetId: data.resource.id?.toString(),
      } as LogAttributes);

      return RuleApplicationResultUtil.failed();
    }
  }

  @RuleEvaluation()
  private async applyRules(data: {
    dataAsset: DataAsset;
    rules: Array<DataAssetLabelRule>;
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
      projectId: dataAsset.projectId,
      ids: Array.from(labelIdsToAdd).filter((id: string) => {
        return !existingLabelIds.has(id);
      }),
      modelType: Label,
      description: "labels of table label rules",
      logAttributes: {
        projectId: dataAsset.projectId.toString(),
        dataAssetId: dataAsset.id.toString(),
      } as LogAttributes,
    });
    if (newLabelIds.length === 0) {
      return RuleApplicationResultUtil.alreadyApplied();
    }

    await DataAssetService.getRepository()
      .createQueryBuilder()
      .relation(DataAsset, "labels")
      .of(dataAsset.id.toString())
      .add(newLabelIds);

    const mergedLabelIds: Set<string> = new Set([
      ...existingLabelIds,
      ...newLabelIds,
    ]);
    dataAsset.labels = Array.from(mergedLabelIds).map((id: string) => {
      const label: Label = new Label();
      label.id = new ObjectID(id);
      return label;
    });
    /*
     * Labels arriving from a rule rather than from a person is exactly the
     * kind of thing the overview page cannot explain, so record which rules
     * did it.
     */
    await DataAssetFeedService.createDataAssetFeedItem({
      dataAssetId: dataAsset.id,
      projectId: dataAsset.projectId,
      dataAssetFeedEventType: DataAssetFeedEventType.LabelRuleExecuted,
      displayColor: Purple500,
      feedInfoInMarkdown:
        mdText`🏷️ ${newLabelIds.length} label(s) were attached to ${await DataAssetService.getDataAssetMarkdownLink(
          dataAsset.projectId,
          dataAsset.id,
        )} by label ${matchedRuleNames.length === 1 ? "rule" : "rules"}.`.toString(),
      moreInformationInMarkdown: RuleFeedMarkdown.matchedRulesLine({
        ruleKind: "Label",
        ruleNames: matchedRuleNames,
      }).toString(),
    });

    return RuleApplicationResultUtil.updated(newLabelIds.length);
  }

  private doesMatchRule(
    dataAsset: DataAsset,
    rule: DataAssetLabelRule,
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
      matchesLegacyRule: (legacyRule: DataAssetLabelRule): boolean => {
        return this.doesMatchLegacyRule(dataAsset, legacyRule);
      },
    });
  }

  private doesMatchLegacyRule(
    dataAsset: DataAsset,
    rule: DataAssetLabelRule,
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
      logger.warn(`Invalid regex in table label rule: ${pattern}`);
      return false;
    }
  }
}

export default new DataAssetLabelRuleEngineServiceClass();
