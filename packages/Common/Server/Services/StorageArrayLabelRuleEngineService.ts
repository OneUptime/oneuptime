import RuleRecordScope from "../Utils/Rules/RuleRecordScope";
import Label from "../../Models/DatabaseModels/Label";
import StorageArray from "../../Models/DatabaseModels/StorageArray";
import StorageArrayLabelRule from "../../Models/DatabaseModels/StorageArrayLabelRule";
import StorageArrayLabelRuleService from "./StorageArrayLabelRuleService";
import StorageArrayService from "./StorageArrayService";
import StorageArrayFeedService from "./StorageArrayFeedService";
import { StorageArrayFeedEventType } from "../../Models/DatabaseModels/StorageArrayFeed";
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

class StorageArrayLabelRuleEngineServiceClass
  implements RuleRunEngine<StorageArray, StorageArrayLabelRule>
{
  public readonly ruleSelect: Select<StorageArrayLabelRule> = {
    _id: true,
    name: true,
    criteria: true,
    storageArrayLabels: { _id: true },
    storageArrayNamePattern: true,
    storageArrayDescriptionPattern: true,
    labelsToAdd: { _id: true },
  };

  // Evaluation re-reads the storage array, so a run only has to name it.
  public readonly resourceSelectForRuleRun: Select<StorageArray> = {
    _id: true,
    projectId: true,
  };

  /**
   * Evaluates StorageArrayLabelRule rows for the given storage array and attaches matched
   * labels to it. The union is deduped against labels already on the storage array
   * before insert to avoid PK conflicts on the join table.
   */
  @CaptureSpan()
  public async applyRulesToStorageArray(
    storageArray: StorageArray,
  ): Promise<void> {
    if (!storageArray.id || !storageArray.projectId) {
      return;
    }

    try {
      const rules: Array<StorageArrayLabelRule> =
        await StorageArrayLabelRuleService.findBy({
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
        ruleKind: "StorageArrayLabelRule",
        projectId: storageArray.projectId,
        rulesRead: rules.length,
      });

      if (rules.length === 0) {
        return;
      }

      await this.applyRules({ storageArray: storageArray, rules: rules });
    } catch (error) {
      logger.error(`Error applying storage array label rules: ${error}`, {
        projectId: storageArray.projectId?.toString(),
        storageArrayId: storageArray.id?.toString(),
      } as LogAttributes);
    }
  }

  /*
   * "Run now": the same evaluation, for a storage array that already exists and
   * only the rules being run.
   */
  @CaptureSpan()
  public async applyRulesToExistingResource(
    data: ApplyRulesToExistingResourceData<StorageArray, StorageArrayLabelRule>,
  ): Promise<RuleApplicationResult> {
    try {
      return await this.applyRules({
        storageArray: data.resource,
        rules: data.rules,
      });
    } catch (error) {
      logger.error(`Error running storage array label rules: ${error}`, {
        projectId: data.resource.projectId?.toString(),
        storageArrayId: data.resource.id?.toString(),
      } as LogAttributes);

      return RuleApplicationResultUtil.failed();
    }
  }

  private async applyRules(data: {
    storageArray: StorageArray;
    rules: Array<StorageArrayLabelRule>;
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

    const labelIdsToAdd: Set<string> = new Set();
    let matchedAnyRule: boolean = false;
    const matchedRuleNames: Array<string> = [];

    for (const rule of rules) {
      const matches: boolean = this.doesStorageArrayMatchRule(
        storageArrayWithDetails,
        rule,
      );
      if (!matches) {
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
      (storageArrayWithDetails.labels || [])
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
      projectId: storageArray.projectId,
      ids: Array.from(labelIdsToAdd).filter((id: string) => {
        return !existingLabelIds.has(id);
      }),
      modelType: Label,
      description: "labels of storage array label rules",
      logAttributes: {
        projectId: storageArray.projectId.toString(),
        storageArrayId: storageArray.id.toString(),
      } as LogAttributes,
    });
    if (newLabelIds.length === 0) {
      return RuleApplicationResultUtil.alreadyApplied();
    }

    await StorageArrayService.getRepository()
      .createQueryBuilder()
      .relation(StorageArray, "labels")
      .of(storageArray.id.toString())
      .add(newLabelIds);

    /*
     * Sync in-memory storageArray.labels so a downstream owner-rule engine in
     * the same onCreateSuccess chain can match on rule-added labels.
     */
    const mergedLabelIds: Set<string> = new Set([
      ...existingLabelIds,
      ...newLabelIds,
    ]);
    storageArray.labels = Array.from(mergedLabelIds).map((id: string) => {
      const label: Label = new Label();
      label.id = new ObjectID(id);
      return label;
    });

    logger.debug(
      `StorageArrayLabelRuleEngine attached ${newLabelIds.length} labels to storage array ${storageArray.id}`,
      { projectId: storageArray.projectId.toString() } as LogAttributes,
    );
    /*
     * Labels arriving from a rule rather than from a person is exactly the
     * kind of thing the overview page cannot explain, so record which rules
     * did it.
     */
    await StorageArrayFeedService.createStorageArrayFeedItem({
      storageArrayId: storageArray.id,
      projectId: storageArray.projectId,
      storageArrayFeedEventType: StorageArrayFeedEventType.LabelRuleExecuted,
      displayColor: Purple500,
      feedInfoInMarkdown:
        mdText`🏷️ ${newLabelIds.length} label(s) were attached to ${await StorageArrayService.getStorageArrayMarkdownLink(
          storageArray.projectId,
          storageArray.id,
        )} by label ${matchedRuleNames.length === 1 ? "rule" : "rules"}.`.toString(),
      moreInformationInMarkdown: RuleFeedMarkdown.matchedRulesLine({
        ruleKind: "Label",
        ruleNames: matchedRuleNames,
      }).toString(),
    });

    return RuleApplicationResultUtil.updated(newLabelIds.length);
  }

  private doesStorageArrayMatchRule(
    storageArray: StorageArray,
    rule: StorageArrayLabelRule,
  ): boolean {
    return RuleCriteriaMatcher.matchesWithLegacySync({
      rule,
      legacyFields: [
        "storageArrayLabels",
        "storageArrayNamePattern",
        "storageArrayDescriptionPattern",
      ],
      emptyResult: true,
      matchesLegacyRule: (legacyRule: StorageArrayLabelRule): boolean => {
        return this.doesStorageArrayMatchLegacyRule(storageArray, legacyRule);
      },
    });
  }

  private doesStorageArrayMatchLegacyRule(
    storageArray: StorageArray,
    rule: StorageArrayLabelRule,
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
    rule: StorageArrayLabelRule,
  ): boolean {
    try {
      const regex: RegExp = new RegExp(pattern, "i");
      return regex.test(value);
    } catch {
      logger.warn(
        `Invalid regex in storage array label rule ${rule.id}: ${pattern}`,
      );
      return false;
    }
  }
}

export default new StorageArrayLabelRuleEngineServiceClass();
