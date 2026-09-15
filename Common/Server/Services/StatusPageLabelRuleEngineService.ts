import Label from "../../Models/DatabaseModels/Label";
import StatusPage from "../../Models/DatabaseModels/StatusPage";
import StatusPageLabelRule from "../../Models/DatabaseModels/StatusPageLabelRule";
import StatusPageLabelRuleService from "./StatusPageLabelRuleService";
import StatusPageService from "./StatusPageService";
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

class StatusPageLabelRuleEngineServiceClass
  implements RuleRunEngine<StatusPage, StatusPageLabelRule>
{
  public readonly ruleSelect: Select<StatusPageLabelRule> = {
    _id: true,
    name: true,
    criteria: true,
    statusPageLabels: { _id: true },
    statusPageNamePattern: true,
    statusPageDescriptionPattern: true,
    labelsToAdd: { _id: true },
  };

  // Evaluation re-reads the status page, so a run only has to name it.
  public readonly resourceSelectForRuleRun: Select<StatusPage> = {
    _id: true,
    projectId: true,
  };

  /**
   * Evaluates StatusPageLabelRule rows for the given status page and attaches
   * matched labels to it. The union is deduped against labels already on the
   * status page before insert to avoid PK conflicts on the StatusPageLabel
   * join table.
   */
  @CaptureSpan()
  public async applyRulesToStatusPage(statusPage: StatusPage): Promise<void> {
    if (!statusPage.id || !statusPage.projectId) {
      return;
    }

    try {
      const rules: Array<StatusPageLabelRule> =
        await StatusPageLabelRuleService.findBy({
          query: {
            projectId: statusPage.projectId,
            isEnabled: true,
          },
          props: { isRoot: true },
          select: this.ruleSelect,
          limit: MAX_RULES_EVALUATED_PER_PROJECT,
          skip: 0,
        });

      logIfRuleReadWasTruncated({
        ruleKind: "StatusPageLabelRule",
        projectId: statusPage.projectId,
        rulesRead: rules.length,
      });

      if (rules.length === 0) {
        return;
      }

      await this.applyRules({ statusPage: statusPage, rules: rules });
    } catch (error) {
      logger.error(`Error applying status page label rules: ${error}`, {
        projectId: statusPage.projectId?.toString(),
        statusPageId: statusPage.id?.toString(),
      } as LogAttributes);
    }
  }

  /*
   * "Run now": the same evaluation, for a status page that already exists and
   * only the rules being run.
   */
  @CaptureSpan()
  public async applyRulesToExistingResource(
    data: ApplyRulesToExistingResourceData<StatusPage, StatusPageLabelRule>,
  ): Promise<RuleApplicationResult> {
    try {
      return await this.applyRules({
        statusPage: data.resource,
        rules: data.rules,
      });
    } catch (error) {
      logger.error(`Error running status page label rules: ${error}`, {
        projectId: data.resource.projectId?.toString(),
        statusPageId: data.resource.id?.toString(),
      } as LogAttributes);

      return RuleApplicationResultUtil.failed();
    }
  }

  private async applyRules(data: {
    statusPage: StatusPage;
    rules: Array<StatusPageLabelRule>;
  }): Promise<RuleApplicationResult> {
    const { statusPage, rules } = data;

    if (!statusPage.id || !statusPage.projectId || rules.length === 0) {
      return RuleApplicationResultUtil.noMatch();
    }

    const statusPageWithDetails: StatusPage | null =
      await StatusPageService.findOneById({
        id: statusPage.id,
        select: {
          name: true,
          description: true,
          labels: { _id: true },
        },
        props: { isRoot: true },
      });

    if (!statusPageWithDetails) {
      return RuleApplicationResultUtil.noMatch();
    }

    const labelIdsToAdd: Set<string> = new Set();
    let anyRuleMatched: boolean = false;

    for (const rule of rules) {
      const matches: boolean = this.doesStatusPageMatchRule(
        statusPageWithDetails,
        rule,
      );
      if (!matches) {
        continue;
      }
      anyRuleMatched = true;
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
      (statusPageWithDetails.labels || [])
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

    await StatusPageService.getRepository()
      .createQueryBuilder()
      .relation(StatusPage, "labels")
      .of(statusPage.id.toString())
      .add(newLabelIds);

    /*
     * Sync in-memory statusPage.labels with the now-persisted set so a
     * downstream owner-rule engine in the same onCreateSuccess chain can
     * match on rule-added labels.
     */
    const mergedLabelIds: Set<string> = new Set([
      ...existingLabelIds,
      ...newLabelIds,
    ]);
    statusPage.labels = Array.from(mergedLabelIds).map((id: string) => {
      const label: Label = new Label();
      label.id = new ObjectID(id);
      return label;
    });

    logger.debug(
      `StatusPageLabelRuleEngine attached ${newLabelIds.length} labels to status page ${statusPage.id}`,
      { projectId: statusPage.projectId.toString() } as LogAttributes,
    );

    return RuleApplicationResultUtil.updated(newLabelIds.length);
  }

  private doesStatusPageMatchRule(
    statusPage: StatusPage,
    rule: StatusPageLabelRule,
  ): boolean {
    return RuleCriteriaMatcher.matchesWithLegacySync({
      rule: rule,
      legacyFields: [
        "statusPageLabels",
        "statusPageNamePattern",
        "statusPageDescriptionPattern",
      ],
      emptyResult: true,
      matchesLegacyRule: (statusPageRule: StatusPageLabelRule): boolean => {
        return this.doesStatusPageMatchRuleLegacy(statusPage, statusPageRule);
      },
    });
  }

  private doesStatusPageMatchRuleLegacy(
    statusPage: StatusPage,
    rule: StatusPageLabelRule,
  ): boolean {
    if (rule.statusPageLabels && rule.statusPageLabels.length > 0) {
      if (!statusPage.labels || statusPage.labels.length === 0) {
        return false;
      }
      const ruleLabelIds: Array<string> = rule.statusPageLabels.map(
        (l: Label) => {
          return l.id?.toString() || "";
        },
      );
      const statusPageLabelIds: Array<string> = statusPage.labels.map(
        (l: Label) => {
          return l.id?.toString() || "";
        },
      );
      if (
        !ruleLabelIds.some((id: string) => {
          return statusPageLabelIds.includes(id);
        })
      ) {
        return false;
      }
    }

    if (
      rule.statusPageNamePattern &&
      (!statusPage.name ||
        !this.testRegex(rule.statusPageNamePattern, statusPage.name, rule))
    ) {
      return false;
    }

    if (
      rule.statusPageDescriptionPattern &&
      (!statusPage.description ||
        !this.testRegex(
          rule.statusPageDescriptionPattern,
          statusPage.description,
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
    rule: StatusPageLabelRule,
  ): boolean {
    try {
      const regex: RegExp = new RegExp(pattern, "i");
      return regex.test(value);
    } catch {
      logger.warn(
        `Invalid regex in status page label rule ${rule.id}: ${pattern}`,
      );
      return false;
    }
  }
}

export default new StatusPageLabelRuleEngineServiceClass();
