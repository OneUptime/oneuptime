import Label from "../../Models/DatabaseModels/Label";
import ServiceLevelObjective from "../../Models/DatabaseModels/ServiceLevelObjective";
import { ServiceLevelObjectiveFeedEventType } from "../../Models/DatabaseModels/ServiceLevelObjectiveFeed";
import ServiceLevelObjectiveLabelRule from "../../Models/DatabaseModels/ServiceLevelObjectiveLabelRule";
import { Purple500 } from "../../Types/BrandColors";
import ObjectID from "../../Types/ObjectID";
import { escapeMarkdownInline } from "../../Utils/Markdown/MarkdownEscape";
import { MAX_RULES_EVALUATED_PER_PROJECT } from "../../Utils/Rules/RuleEngineLimits";
import { RuleCriteriaMatcher } from "../../Utils/Rules/RuleCriteriaMatcher";
import RulePatternMatchUtil from "../../Utils/Rules/RulePatternMatchUtil";
import Select from "../Types/Database/Select";
import logger, { LogAttributes } from "../Utils/Logger";
import logIfRuleReadWasTruncated from "../Utils/Rules/RuleEngineRuleRead";
import {
  ApplyRulesToExistingResourceData,
  RuleApplicationResult,
  RuleApplicationResultUtil,
  RuleRunEngine,
} from "../Utils/Rules/RuleRun/RuleApplication";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import ServiceLevelObjectiveFeedService from "./ServiceLevelObjectiveFeedService";
import ServiceLevelObjectiveLabelRuleService from "./ServiceLevelObjectiveLabelRuleService";
import ServiceLevelObjectiveService from "./ServiceLevelObjectiveService";

class ServiceLevelObjectiveLabelRuleEngineServiceClass
  implements
    RuleRunEngine<ServiceLevelObjective, ServiceLevelObjectiveLabelRule>
{
  public readonly ruleSelect: Select<ServiceLevelObjectiveLabelRule> = {
    _id: true,
    name: true,
    criteria: true,
    serviceLevelObjectiveLabels: { _id: true },
    serviceLevelObjectiveNamePattern: true,
    serviceLevelObjectiveDescriptionPattern: true,
    labelsToAdd: { _id: true },
  };

  // Evaluation re-reads the SLO, so a run only has to name it.
  public readonly resourceSelectForRuleRun: Select<ServiceLevelObjective> = {
    _id: true,
    projectId: true,
  };

  /**
   * Evaluates ServiceLevelObjectiveLabelRule rows for the given SLO and
   * attaches matched labels to it. The union is deduped against labels already
   * on the SLO before insert to avoid PK conflicts on the join table.
   */
  @CaptureSpan()
  public async applyRulesToServiceLevelObjective(
    serviceLevelObjective: ServiceLevelObjective,
  ): Promise<void> {
    if (!serviceLevelObjective.id || !serviceLevelObjective.projectId) {
      return;
    }

    try {
      const rules: Array<ServiceLevelObjectiveLabelRule> =
        await ServiceLevelObjectiveLabelRuleService.findBy({
          query: {
            projectId: serviceLevelObjective.projectId,
            isEnabled: true,
          },
          props: { isRoot: true },
          select: this.ruleSelect,
          limit: MAX_RULES_EVALUATED_PER_PROJECT,
          skip: 0,
        });

      logIfRuleReadWasTruncated({
        ruleKind: "ServiceLevelObjectiveLabelRule",
        projectId: serviceLevelObjective.projectId,
        rulesRead: rules.length,
      });

      if (rules.length === 0) {
        return;
      }

      await this.applyRules({
        serviceLevelObjective: serviceLevelObjective,
        rules: rules,
      });
    } catch (error) {
      logger.error(`Error applying SLO label rules: ${error}`, {
        projectId: serviceLevelObjective.projectId?.toString(),
        serviceLevelObjectiveId: serviceLevelObjective.id?.toString(),
      } as LogAttributes);
    }
  }

  /*
   * "Run now": the same evaluation, for an SLO that already exists and only
   * the rules being run.
   */
  @CaptureSpan()
  public async applyRulesToExistingResource(
    data: ApplyRulesToExistingResourceData<
      ServiceLevelObjective,
      ServiceLevelObjectiveLabelRule
    >,
  ): Promise<RuleApplicationResult> {
    try {
      return await this.applyRules({
        serviceLevelObjective: data.resource,
        rules: data.rules,
      });
    } catch (error) {
      logger.error(`Error running SLO label rules: ${error}`, {
        projectId: data.resource.projectId?.toString(),
        serviceLevelObjectiveId: data.resource.id?.toString(),
      } as LogAttributes);

      return RuleApplicationResultUtil.failed();
    }
  }

  private async applyRules(data: {
    serviceLevelObjective: ServiceLevelObjective;
    rules: Array<ServiceLevelObjectiveLabelRule>;
  }): Promise<RuleApplicationResult> {
    const { serviceLevelObjective, rules } = data;

    if (
      !serviceLevelObjective.id ||
      !serviceLevelObjective.projectId ||
      rules.length === 0
    ) {
      return RuleApplicationResultUtil.noMatch();
    }

    const sloWithDetails: ServiceLevelObjective | null =
      await ServiceLevelObjectiveService.findOneById({
        id: serviceLevelObjective.id,
        select: {
          name: true,
          description: true,
          labels: { _id: true },
        },
        props: { isRoot: true },
      });

    if (!sloWithDetails) {
      return RuleApplicationResultUtil.noMatch();
    }

    const labelIdsToAdd: Set<string> = new Set();
    const matchedRuleNames: Array<string> = [];
    let matchedAnyRule: boolean = false;

    for (const rule of rules) {
      if (!this.doesServiceLevelObjectiveMatchRule(sloWithDetails, rule)) {
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
      (sloWithDetails.labels || [])
        .map((l: Label) => {
          return l.id?.toString() || "";
        })
        .filter((id: string) => {
          return id !== "";
        }),
    );

    const newLabelIds: Array<string> = Array.from(labelIdsToAdd).filter(
      (id: string) => {
        return !existingLabelIds.has(id);
      },
    );
    if (newLabelIds.length === 0) {
      return RuleApplicationResultUtil.alreadyApplied();
    }

    await ServiceLevelObjectiveService.getRepository()
      .createQueryBuilder()
      .relation(ServiceLevelObjective, "labels")
      .of(serviceLevelObjective.id.toString())
      .add(newLabelIds);

    /*
     * Sync in-memory labels so the owner-rule engine that runs next in the
     * same onCreateSuccess chain can match on rule-added labels.
     */
    const mergedLabelIds: Set<string> = new Set([
      ...existingLabelIds,
      ...newLabelIds,
    ]);
    serviceLevelObjective.labels = Array.from(mergedLabelIds).map(
      (id: string) => {
        const label: Label = new Label();
        label.id = new ObjectID(id);
        return label;
      },
    );

    logger.debug(
      `ServiceLevelObjectiveLabelRuleEngine attached ${newLabelIds.length} labels to SLO ${serviceLevelObjective.id}`,
      {
        projectId: serviceLevelObjective.projectId.toString(),
      } as LogAttributes,
    );

    await this.postLabelRuleFeedItem({
      serviceLevelObjectiveId: serviceLevelObjective.id,
      projectId: serviceLevelObjective.projectId,
      sloName: sloWithDetails.name,
      labelsAdded: newLabelIds.length,
      matchedRuleNames: matchedRuleNames,
    });

    return RuleApplicationResultUtil.updated(newLabelIds.length);
  }

  /*
   * Labels arriving from a rule rather than from a person is exactly what the
   * SLO's feed cannot otherwise explain, so it records which rules did it.
   * The labels are already attached by now: a feed failure is logged, never
   * thrown, or a run would report an SLO it changed as one it failed on.
   */
  private async postLabelRuleFeedItem(data: {
    serviceLevelObjectiveId: ObjectID;
    projectId: ObjectID;
    sloName: string | undefined;
    labelsAdded: number;
    matchedRuleNames: Array<string>;
  }): Promise<void> {
    try {
      const sloLink: string =
        await ServiceLevelObjectiveService.getSloMarkdownLink({
          projectId: data.projectId,
          sloId: data.serviceLevelObjectiveId,
          sloName: data.sloName,
        });

      await ServiceLevelObjectiveFeedService.createServiceLevelObjectiveFeedItem(
        {
          serviceLevelObjectiveId: data.serviceLevelObjectiveId,
          projectId: data.projectId,
          serviceLevelObjectiveFeedEventType:
            ServiceLevelObjectiveFeedEventType.LabelRuleExecuted,
          displayColor: Purple500,
          feedInfoInMarkdown: `🏷️ ${data.labelsAdded} label(s) were attached to ${sloLink} by label ${data.matchedRuleNames.length === 1 ? "rule" : "rules"}.`,
          moreInformationInMarkdown: `**Label rules that matched**: ${data.matchedRuleNames
            .map((name: string): string => {
              // Rule names are user-controlled and the feed renders markdown.
              return `**${escapeMarkdownInline(name)}**`;
            })
            .join(", ")}`,
        },
      );
    } catch (error) {
      logger.error(
        `Error writing the label rule feed item for SLO ${data.serviceLevelObjectiveId.toString()}: ${error}`,
        { projectId: data.projectId.toString() } as LogAttributes,
      );
    }
  }

  private doesServiceLevelObjectiveMatchRule(
    serviceLevelObjective: ServiceLevelObjective,
    rule: ServiceLevelObjectiveLabelRule,
  ): boolean {
    return RuleCriteriaMatcher.matchesWithLegacySync({
      rule,
      legacyFields: [
        "serviceLevelObjectiveLabels",
        "serviceLevelObjectiveNamePattern",
        "serviceLevelObjectiveDescriptionPattern",
      ],
      emptyResult: true,
      matchesLegacyRule: (
        legacyRule: ServiceLevelObjectiveLabelRule,
      ): boolean => {
        return this.doesServiceLevelObjectiveMatchLegacyRule(
          serviceLevelObjective,
          legacyRule,
        );
      },
    });
  }

  private doesServiceLevelObjectiveMatchLegacyRule(
    serviceLevelObjective: ServiceLevelObjective,
    rule: ServiceLevelObjectiveLabelRule,
  ): boolean {
    if (
      rule.serviceLevelObjectiveLabels &&
      rule.serviceLevelObjectiveLabels.length > 0
    ) {
      if (
        !serviceLevelObjective.labels ||
        serviceLevelObjective.labels.length === 0
      ) {
        return false;
      }
      const ruleLabelIds: Array<string> = rule.serviceLevelObjectiveLabels.map(
        (l: Label) => {
          return l.id?.toString() || "";
        },
      );
      const labelIds: Array<string> = serviceLevelObjective.labels.map(
        (l: Label) => {
          return l.id?.toString() || "";
        },
      );
      if (
        !ruleLabelIds.some((id: string) => {
          return labelIds.includes(id);
        })
      ) {
        return false;
      }
    }

    if (
      rule.serviceLevelObjectiveNamePattern &&
      (!serviceLevelObjective.name ||
        !this.testPattern(
          rule.serviceLevelObjectiveNamePattern,
          serviceLevelObjective.name,
          rule,
        ))
    ) {
      return false;
    }

    if (
      rule.serviceLevelObjectiveDescriptionPattern &&
      (!serviceLevelObjective.description ||
        !this.testPattern(
          rule.serviceLevelObjectiveDescriptionPattern,
          serviceLevelObjective.description,
          rule,
        ))
    ) {
      return false;
    }

    return true;
  }

  /*
   * Patterns are regexes, with a '*' wildcard fallback - the same two syntaxes
   * the SLO monitor rules take. SloRulePatternValidator rejects anything else
   * on save, so this only warns about a rule written before that check.
   */
  private testPattern(
    pattern: string,
    value: string,
    rule: ServiceLevelObjectiveLabelRule,
  ): boolean {
    if (!RulePatternMatchUtil.isSupportedPattern(pattern)) {
      logger.warn(
        `Invalid pattern in SLO label rule ${rule.id}: ${pattern}. It is neither a valid regular expression nor a wildcard pattern, so it will never match.`,
      );
      return false;
    }

    return RulePatternMatchUtil.matches(value, pattern);
  }
}

export default new ServiceLevelObjectiveLabelRuleEngineServiceClass();
