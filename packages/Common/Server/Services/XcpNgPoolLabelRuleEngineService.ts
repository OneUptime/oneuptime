import RuleAddedLabels from "../Utils/Rules/RuleAddedLabels";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import RuleRecordScope from "../Utils/Rules/RuleRecordScope";
import Label from "../../Models/DatabaseModels/Label";
import XcpNgPool from "../../Models/DatabaseModels/XcpNgPool";
import XcpNgPoolLabelRule from "../../Models/DatabaseModels/XcpNgPoolLabelRule";
import XcpNgPoolLabelRuleService from "./XcpNgPoolLabelRuleService";
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

class XcpNgPoolLabelRuleEngineServiceClass
  implements RuleRunEngine<XcpNgPool, XcpNgPoolLabelRule>
{
  public readonly ruleSelect: Select<XcpNgPoolLabelRule> = {
    _id: true,
    name: true,
    criteria: true,
    xcpNgPoolLabels: { _id: true },
    xcpNgPoolNamePattern: true,
    xcpNgPoolDescriptionPattern: true,
    labelsToAdd: { _id: true },
  };

  // Evaluation re-reads the XCP-ng pool, so a run only has to name it.
  public readonly resourceSelectForRuleRun: Select<XcpNgPool> = {
    _id: true,
    projectId: true,
  };

  /**
   * Evaluates XcpNgPoolLabelRule rows for the given XCP-ng pool and attaches matched
   * labels to it. The union is deduped against labels already on the XCP-ng pool
   * before insert to avoid PK conflicts on the join table.
   */
  @CaptureSpan()
  public async applyRulesToXcpNgPool(xcpNgPool: XcpNgPool): Promise<void> {
    if (!xcpNgPool.id || !xcpNgPool.projectId) {
      return;
    }

    try {
      const rules: Array<XcpNgPoolLabelRule> =
        await XcpNgPoolLabelRuleService.findBy({
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
        ruleKind: "XcpNgPoolLabelRule",
        projectId: xcpNgPool.projectId,
        rulesRead: rules.length,
      });

      if (rules.length === 0) {
        return;
      }

      await this.applyRules({ xcpNgPool: xcpNgPool, rules: rules });
    } catch (error) {
      logger.error(`Error applying XCP-ng pool label rules: ${error}`, {
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
    data: ApplyRulesToExistingResourceData<XcpNgPool, XcpNgPoolLabelRule>,
  ): Promise<RuleApplicationResult> {
    try {
      return await this.applyRules({
        xcpNgPool: data.resource,
        rules: data.rules,
        props: data.props,
      });
    } catch (error) {
      logger.error(`Error running XCP-ng pool label rules: ${error}`, {
        projectId: data.resource.projectId?.toString(),
        xcpNgPoolId: data.resource.id?.toString(),
      } as LogAttributes);

      return RuleApplicationResultUtil.failed();
    }
  }

  @RuleEvaluation()
  private async applyRules(data: {
    xcpNgPool: XcpNgPool;
    rules: Array<XcpNgPoolLabelRule>;
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

    const labelIdsToAdd: Set<string> = new Set();
    const matchedRuleNames: Array<string> = [];
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

    if (!anyRuleMatched) {
      return RuleApplicationResultUtil.noMatch();
    }

    if (labelIdsToAdd.size === 0) {
      return RuleApplicationResultUtil.alreadyApplied();
    }

    const existingLabelIds: Set<string> = new Set(
      (xcpNgPoolWithDetails.labels || [])
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
      projectId: xcpNgPool.projectId,
      ids: Array.from(labelIdsToAdd).filter((id: string) => {
        return !existingLabelIds.has(id);
      }),
      modelType: Label,
      description: "labels of XCP-ng pool label rules",
      logAttributes: {
        projectId: xcpNgPool.projectId.toString(),
        xcpNgPoolId: xcpNgPool.id.toString(),
      } as LogAttributes,
    });
    if (newLabelIds.length === 0) {
      return RuleApplicationResultUtil.alreadyApplied();
    }

    await RuleAddedLabels.add({
      service: XcpNgPoolService,
      resourceId: xcpNgPool.id,
      labelIds: newLabelIds,
      props: data.props,
    });

    /*
     * Sync in-memory xcpNgPool.labels so a downstream owner-rule engine in
     * the same onCreateSuccess chain can match on rule-added labels.
     */
    const mergedLabelIds: Set<string> = new Set([
      ...existingLabelIds,
      ...newLabelIds,
    ]);
    xcpNgPool.labels = Array.from(mergedLabelIds).map((id: string) => {
      const label: Label = new Label();
      label.id = new ObjectID(id);
      return label;
    });

    logger.debug(
      `XcpNgPoolLabelRuleEngine attached ${newLabelIds.length} labels to XCP-ng pool ${xcpNgPool.id}`,
      { projectId: xcpNgPool.projectId.toString() } as LogAttributes,
    );
    /*
     * Labels arriving from a rule rather than from a person is exactly the
     * kind of thing the overview page cannot explain, so record which rules
     * did it.
     */
    await XcpNgPoolFeedService.createXcpNgPoolFeedItem({
      xcpNgPoolId: xcpNgPool.id,
      projectId: xcpNgPool.projectId,
      xcpNgPoolFeedEventType: XcpNgPoolFeedEventType.LabelRuleExecuted,
      displayColor: Purple500,
      feedInfoInMarkdown:
        mdText`🏷️ ${newLabelIds.length} label(s) were attached to ${await XcpNgPoolService.getXcpNgPoolMarkdownLink(
          xcpNgPool.projectId,
          xcpNgPool.id,
        )} by label ${matchedRuleNames.length === 1 ? "rule" : "rules"}.`.toString(),
      moreInformationInMarkdown: RuleFeedMarkdown.matchedRulesLine({
        ruleKind: "Label",
        ruleNames: matchedRuleNames,
      }).toString(),
    });

    return RuleApplicationResultUtil.updated(newLabelIds.length);
  }

  private doesXcpNgPoolMatchRule(
    xcpNgPool: XcpNgPool,
    rule: XcpNgPoolLabelRule,
  ): boolean {
    return RuleCriteriaMatcher.matchesWithLegacySync({
      rule: rule,
      legacyFields: [
        "xcpNgPoolLabels",
        "xcpNgPoolNamePattern",
        "xcpNgPoolDescriptionPattern",
      ],
      emptyResult: true,
      matchesLegacyRule: (xcpNgPoolRule: XcpNgPoolLabelRule): boolean => {
        return this.doesXcpNgPoolMatchRuleLegacy(xcpNgPool, xcpNgPoolRule);
      },
    });
  }

  private doesXcpNgPoolMatchRuleLegacy(
    xcpNgPool: XcpNgPool,
    rule: XcpNgPoolLabelRule,
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
    rule: XcpNgPoolLabelRule,
  ): boolean {
    try {
      return RulePatternMatchUtil.testRegex(pattern, value);
    } catch {
      logger.warn(
        `Invalid regex in XCP-ng pool label rule ${rule.id}: ${pattern}`,
      );
      return false;
    }
  }
}

export default new XcpNgPoolLabelRuleEngineServiceClass();
