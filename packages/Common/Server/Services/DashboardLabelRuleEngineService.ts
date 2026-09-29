import Dashboard from "../../Models/DatabaseModels/Dashboard";
import DashboardLabelRule from "../../Models/DatabaseModels/DashboardLabelRule";
import Label from "../../Models/DatabaseModels/Label";
import DashboardLabelRuleService from "./DashboardLabelRuleService";
import DashboardService from "./DashboardService";
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

class DashboardLabelRuleEngineServiceClass
  implements RuleRunEngine<Dashboard, DashboardLabelRule>
{
  public readonly ruleSelect: Select<DashboardLabelRule> = {
    _id: true,
    name: true,
    criteria: true,
    dashboardLabels: { _id: true },
    dashboardNamePattern: true,
    dashboardDescriptionPattern: true,
    labelsToAdd: { _id: true },
  };

  // Evaluation re-reads the dashboard, so a run only has to name it.
  public readonly resourceSelectForRuleRun: Select<Dashboard> = {
    _id: true,
    projectId: true,
  };

  /**
   * Evaluates DashboardLabelRule rows for the given dashboard and attaches
   * matched labels to it. The union is deduped against labels already on the
   * dashboard before insert to avoid PK conflicts on the join table.
   */
  @CaptureSpan()
  public async applyRulesToDashboard(dashboard: Dashboard): Promise<void> {
    if (!dashboard.id || !dashboard.projectId) {
      return;
    }

    try {
      const rules: Array<DashboardLabelRule> =
        await DashboardLabelRuleService.findBy({
          query: {
            projectId: dashboard.projectId,
            isEnabled: true,
          },
          props: { isRoot: true },
          select: this.ruleSelect,
          limit: MAX_RULES_EVALUATED_PER_PROJECT,
          skip: 0,
        });

      logIfRuleReadWasTruncated({
        ruleKind: "DashboardLabelRule",
        projectId: dashboard.projectId,
        rulesRead: rules.length,
      });

      if (rules.length === 0) {
        return;
      }

      await this.applyRules({ dashboard: dashboard, rules: rules });
    } catch (error) {
      logger.error(`Error applying dashboard label rules: ${error}`, {
        projectId: dashboard.projectId?.toString(),
        dashboardId: dashboard.id?.toString(),
      } as LogAttributes);
    }
  }

  /*
   * "Run now": the same evaluation, for a dashboard that already exists and
   * only the rules being run.
   */
  @CaptureSpan()
  public async applyRulesToExistingResource(
    data: ApplyRulesToExistingResourceData<Dashboard, DashboardLabelRule>,
  ): Promise<RuleApplicationResult> {
    try {
      return await this.applyRules({
        dashboard: data.resource,
        rules: data.rules,
      });
    } catch (error) {
      logger.error(`Error running dashboard label rules: ${error}`, {
        projectId: data.resource.projectId?.toString(),
        dashboardId: data.resource.id?.toString(),
      } as LogAttributes);

      return RuleApplicationResultUtil.failed();
    }
  }

  private async applyRules(data: {
    dashboard: Dashboard;
    rules: Array<DashboardLabelRule>;
  }): Promise<RuleApplicationResult> {
    const { dashboard, rules } = data;

    if (!dashboard.id || !dashboard.projectId || rules.length === 0) {
      return RuleApplicationResultUtil.noMatch();
    }

    const dashboardWithDetails: Dashboard | null =
      await DashboardService.findOneById({
        id: dashboard.id,
        select: {
          name: true,
          description: true,
          labels: { _id: true },
        },
        props: { isRoot: true },
      });

    if (!dashboardWithDetails) {
      return RuleApplicationResultUtil.noMatch();
    }

    const labelIdsToAdd: Set<string> = new Set();
    let matchedAnyRule: boolean = false;

    for (const rule of rules) {
      const matches: boolean = this.doesDashboardMatchRule(
        dashboardWithDetails,
        rule,
      );
      if (!matches) {
        continue;
      }
      matchedAnyRule = true;
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
      (dashboardWithDetails.labels || [])
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

    await DashboardService.getRepository()
      .createQueryBuilder()
      .relation(Dashboard, "labels")
      .of(dashboard.id.toString())
      .add(newLabelIds);

    /*
     * Sync in-memory dashboard.labels so a downstream owner-rule engine in
     * the same onCreateSuccess chain can match on rule-added labels.
     */
    const mergedLabelIds: Set<string> = new Set([
      ...existingLabelIds,
      ...newLabelIds,
    ]);
    dashboard.labels = Array.from(mergedLabelIds).map((id: string) => {
      const label: Label = new Label();
      label.id = new ObjectID(id);
      return label;
    });

    logger.debug(
      `DashboardLabelRuleEngine attached ${newLabelIds.length} labels to dashboard ${dashboard.id}`,
      { projectId: dashboard.projectId.toString() } as LogAttributes,
    );

    return RuleApplicationResultUtil.updated(newLabelIds.length);
  }

  private doesDashboardMatchRule(
    dashboard: Dashboard,
    rule: DashboardLabelRule,
  ): boolean {
    return RuleCriteriaMatcher.matchesWithLegacySync({
      rule,
      legacyFields: [
        "dashboardLabels",
        "dashboardNamePattern",
        "dashboardDescriptionPattern",
      ],
      emptyResult: true,
      matchesLegacyRule: (legacyRule: DashboardLabelRule): boolean => {
        return this.doesDashboardMatchLegacyRule(dashboard, legacyRule);
      },
    });
  }

  private doesDashboardMatchLegacyRule(
    dashboard: Dashboard,
    rule: DashboardLabelRule,
  ): boolean {
    if (rule.dashboardLabels && rule.dashboardLabels.length > 0) {
      if (!dashboard.labels || dashboard.labels.length === 0) {
        return false;
      }
      const ruleLabelIds: Array<string> = rule.dashboardLabels.map(
        (l: Label) => {
          return l.id?.toString() || "";
        },
      );
      const labelIds: Array<string> = dashboard.labels.map((l: Label) => {
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
      rule.dashboardNamePattern &&
      (!dashboard.name ||
        !this.testRegex(rule.dashboardNamePattern, dashboard.name, rule))
    ) {
      return false;
    }

    if (
      rule.dashboardDescriptionPattern &&
      (!dashboard.description ||
        !this.testRegex(
          rule.dashboardDescriptionPattern,
          dashboard.description,
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
    rule: DashboardLabelRule,
  ): boolean {
    try {
      const regex: RegExp = new RegExp(pattern, "i");
      return regex.test(value);
    } catch {
      logger.warn(
        `Invalid regex in dashboard label rule ${rule.id}: ${pattern}`,
      );
      return false;
    }
  }
}

export default new DashboardLabelRuleEngineServiceClass();
