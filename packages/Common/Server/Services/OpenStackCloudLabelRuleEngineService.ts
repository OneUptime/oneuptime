import RuleRecordScope from "../Utils/Rules/RuleRecordScope";
import Label from "../../Models/DatabaseModels/Label";
import OpenStackCloud from "../../Models/DatabaseModels/OpenStackCloud";
import OpenStackCloudLabelRule from "../../Models/DatabaseModels/OpenStackCloudLabelRule";
import OpenStackCloudLabelRuleService from "./OpenStackCloudLabelRuleService";
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

class OpenStackCloudLabelRuleEngineServiceClass
  implements RuleRunEngine<OpenStackCloud, OpenStackCloudLabelRule>
{
  public readonly ruleSelect: Select<OpenStackCloudLabelRule> = {
    _id: true,
    name: true,
    criteria: true,
    openStackCloudLabels: { _id: true },
    openStackCloudNamePattern: true,
    openStackCloudDescriptionPattern: true,
    labelsToAdd: { _id: true },
  };

  // Evaluation re-reads the OpenStack cloud, so a run only has to name it.
  public readonly resourceSelectForRuleRun: Select<OpenStackCloud> = {
    _id: true,
    projectId: true,
  };

  /**
   * Evaluates OpenStackCloudLabelRule rows for the given OpenStack cloud and attaches matched
   * labels to it. The union is deduped against labels already on the OpenStack cloud
   * before insert to avoid PK conflicts on the join table.
   */
  @CaptureSpan()
  public async applyRulesToOpenStackCloud(
    openStackCloud: OpenStackCloud,
  ): Promise<void> {
    if (!openStackCloud.id || !openStackCloud.projectId) {
      return;
    }

    try {
      const rules: Array<OpenStackCloudLabelRule> =
        await OpenStackCloudLabelRuleService.findBy({
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
        ruleKind: "OpenStackCloudLabelRule",
        projectId: openStackCloud.projectId,
        rulesRead: rules.length,
      });

      if (rules.length === 0) {
        return;
      }

      await this.applyRules({ openStackCloud: openStackCloud, rules: rules });
    } catch (error) {
      logger.error(`Error applying OpenStack cloud label rules: ${error}`, {
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
      OpenStackCloudLabelRule
    >,
  ): Promise<RuleApplicationResult> {
    try {
      return await this.applyRules({
        openStackCloud: data.resource,
        rules: data.rules,
      });
    } catch (error) {
      logger.error(`Error running OpenStack cloud label rules: ${error}`, {
        projectId: data.resource.projectId?.toString(),
        openStackCloudId: data.resource.id?.toString(),
      } as LogAttributes);

      return RuleApplicationResultUtil.failed();
    }
  }

  @RuleEvaluation()
  private async applyRules(data: {
    openStackCloud: OpenStackCloud;
    rules: Array<OpenStackCloudLabelRule>;
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

    const labelIdsToAdd: Set<string> = new Set();
    const matchedRuleNames: Array<string> = [];
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
      (openStackCloudWithDetails.labels || [])
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
      projectId: openStackCloud.projectId,
      ids: Array.from(labelIdsToAdd).filter((id: string) => {
        return !existingLabelIds.has(id);
      }),
      modelType: Label,
      description: "labels of OpenStack cloud label rules",
      logAttributes: {
        projectId: openStackCloud.projectId.toString(),
        openStackCloudId: openStackCloud.id.toString(),
      } as LogAttributes,
    });
    if (newLabelIds.length === 0) {
      return RuleApplicationResultUtil.alreadyApplied();
    }

    await OpenStackCloudService.getRepository()
      .createQueryBuilder()
      .relation(OpenStackCloud, "labels")
      .of(openStackCloud.id.toString())
      .add(newLabelIds);

    /*
     * Sync in-memory openStackCloud.labels so a downstream owner-rule engine in
     * the same onCreateSuccess chain can match on rule-added labels.
     */
    const mergedLabelIds: Set<string> = new Set([
      ...existingLabelIds,
      ...newLabelIds,
    ]);
    openStackCloud.labels = Array.from(mergedLabelIds).map((id: string) => {
      const label: Label = new Label();
      label.id = new ObjectID(id);
      return label;
    });

    logger.debug(
      `OpenStackCloudLabelRuleEngine attached ${newLabelIds.length} labels to OpenStack cloud ${openStackCloud.id}`,
      { projectId: openStackCloud.projectId.toString() } as LogAttributes,
    );
    /*
     * Labels arriving from a rule rather than from a person is exactly the
     * kind of thing the overview page cannot explain, so record which rules
     * did it.
     */
    await OpenStackCloudFeedService.createOpenStackCloudFeedItem({
      openStackCloudId: openStackCloud.id,
      projectId: openStackCloud.projectId,
      openStackCloudFeedEventType:
        OpenStackCloudFeedEventType.LabelRuleExecuted,
      displayColor: Purple500,
      feedInfoInMarkdown:
        mdText`🏷️ ${newLabelIds.length} label(s) were attached to ${await OpenStackCloudService.getOpenStackCloudMarkdownLink(
          openStackCloud.projectId,
          openStackCloud.id,
        )} by label ${matchedRuleNames.length === 1 ? "rule" : "rules"}.`.toString(),
      moreInformationInMarkdown: RuleFeedMarkdown.matchedRulesLine({
        ruleKind: "Label",
        ruleNames: matchedRuleNames,
      }).toString(),
    });

    return RuleApplicationResultUtil.updated(newLabelIds.length);
  }

  private doesOpenStackCloudMatchRule(
    openStackCloud: OpenStackCloud,
    rule: OpenStackCloudLabelRule,
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
        openStackCloudRule: OpenStackCloudLabelRule,
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
    rule: OpenStackCloudLabelRule,
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
    rule: OpenStackCloudLabelRule,
  ): boolean {
    try {
      return RulePatternMatchUtil.testRegex(pattern, value);
    } catch {
      logger.warn(
        `Invalid regex in OpenStack cloud label rule ${rule.id}: ${pattern}`,
      );
      return false;
    }
  }
}

export default new OpenStackCloudLabelRuleEngineServiceClass();
