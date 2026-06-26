import Dashboard from "../../Models/DatabaseModels/Dashboard";
import DashboardLabelRule from "../../Models/DatabaseModels/DashboardLabelRule";
import Label from "../../Models/DatabaseModels/Label";
import DashboardLabelRuleService from "./DashboardLabelRuleService";
import DashboardService from "./DashboardService";
import ObjectID from "../../Types/ObjectID";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger, { LogAttributes } from "../Utils/Logger";

class DashboardLabelRuleEngineServiceClass {
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
          select: {
            _id: true,
            name: true,
            dashboardLabels: { _id: true },
            dashboardNamePattern: true,
            dashboardDescriptionPattern: true,
            labelsToAdd: { _id: true },
          },
          limit: 100,
          skip: 0,
        });

      if (rules.length === 0) {
        return;
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
        return;
      }

      const labelIdsToAdd: Set<string> = new Set();

      for (const rule of rules) {
        const matches: boolean = this.doesDashboardMatchRule(
          dashboardWithDetails,
          rule,
        );
        if (!matches) {
          continue;
        }
        for (const label of rule.labelsToAdd || []) {
          if (label.id) {
            labelIdsToAdd.add(label.id.toString());
          }
        }
      }

      if (labelIdsToAdd.size === 0) {
        return;
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
        return;
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
    } catch (error) {
      logger.error(`Error applying dashboard label rules: ${error}`, {
        projectId: dashboard.projectId?.toString(),
        dashboardId: dashboard.id?.toString(),
      } as LogAttributes);
    }
  }

  private doesDashboardMatchRule(
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
