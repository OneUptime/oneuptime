import ServiceLevelObjective from "../../../../Models/DatabaseModels/ServiceLevelObjective";
import ServiceLevelObjectiveBurnRateRule from "../../../../Models/DatabaseModels/ServiceLevelObjectiveBurnRateRule";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import PositiveNumber from "../../../../Types/PositiveNumber";
import SloStatus from "../../../../Types/ServiceLevelObjective/SloStatus";
import SloWindowType from "../../../../Types/ServiceLevelObjective/SloWindowType";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import { AIChatCitationTargetType } from "../../../../Types/AI/AIChatTypes";
import ServiceLevelObjectiveService from "../../../Services/ServiceLevelObjectiveService";
import ServiceLevelObjectiveBurnRateRuleService from "../../../Services/ServiceLevelObjectiveBurnRateRuleService";
import Query from "../../../Types/Database/Query";
import QueryHelper from "../../../Types/Database/QueryHelper";
import ToolResultSerializer, { SerializedResult } from "./Serializer";
import WidgetBuilder from "./WidgetBuilder";
import {
  ObservabilityTool,
  ToolArgs,
  ToolContext,
  ToolExecutionResult,
} from "./ToolTypes";

/*
 * Derived from the model ACL so the tool gate can never drift from RBAC.
 * Resolved lazily rather than at module load: this module is pulled in through
 * the service import graph before the ServiceLevelObjective model class is
 * fully wired up, so calling a model method at import time throws a
 * circular-dependency TypeError. By the time a tool actually executes, every
 * module is loaded.
 */
let cachedReadPermissions: Array<Permission> | null = null;
const resolveReadPermissions: () => Array<Permission> =
  (): Array<Permission> => {
    if (!cachedReadPermissions) {
      cachedReadPermissions = new ServiceLevelObjective().getReadPermissions();
    }
    return cachedReadPermissions;
  };

/*
 * Compliance figures on the SLO row (current SLI %, error budget remaining,
 * burn rate, status) are persisted by the SLO evaluation worker — the same
 * values the SLO dashboard shows. This tool reports them as-of
 * lastEvaluatedAt and never recomputes them live, so the note below travels
 * with every non-empty result to keep the model honest about freshness.
 */
const COMPLIANCE_NOTE: string =
  "Note: compliance figures (currentSliPercentage, errorBudgetRemaining*, currentBurnRate, sloStatus) are the platform's persisted values from the last worker evaluation (see lastEvaluatedAt) — not recomputed live. Rows without these fields have not been evaluated yet.\n";

function joinNames(items: Array<{ name?: string }> | undefined): string {
  return (items || [])
    .map((item: { name?: string }) => {
      return item.name || "";
    })
    .filter((value: string) => {
      return value.length > 0;
    })
    .join(", ");
}

// "Rolling 30d" / "Calendar Month" — compact window description for one row.
function describeWindow(slo: ServiceLevelObjective): string {
  if (slo.windowType === SloWindowType.CalendarMonth) {
    return SloWindowType.CalendarMonth;
  }
  return `${SloWindowType.Rolling} ${slo.windowDays ?? 30}d`;
}

// Percentage formatting for widget fields only; LLM rows keep raw numbers.
function formatPercent(value: number | undefined | null): string {
  if (value === undefined || value === null) {
    return "not evaluated yet";
  }
  return `${Math.round(value * 100) / 100}%`;
}

export const QuerySlosTool: ObservabilityTool = {
  name: "query_slos",
  description:
    "List Service Level Objectives (SLOs) in this project: what each one measures (monitor uptime or a metric SLI), its target percentage, compliance window, attached monitors, and the latest persisted compliance status — current SLI %, error budget remaining and burn rate as computed by the platform at its last evaluation (this tool never recomputes compliance live). Pass sloId (an SLO ID from this tool's own list results) to get one SLO's full definition plus its burn-rate alert rules and their thresholds. Use query_alerts to see alerts those burn-rate rules fired, and query_monitors for the current status of an SLO's monitors.",
  inputSchema: {
    type: "object",
    properties: {
      sloId: {
        type: "string",
        description:
          "Get one SLO by its ID — includes the full definition (SLI type, downtime statuses, monitor labels, at-risk threshold, error budget seconds) and its burn-rate rules with thresholds and alert windows.",
      },
      sloStatus: {
        type: "string",
        enum: Object.values(SloStatus),
        description:
          "Only list SLOs currently in this status (e.g. 'At Risk' or 'Budget Exhausted' to find SLOs in trouble).",
      },
      nameSearch: {
        type: "string",
        description: "Filter SLOs whose name contains this text.",
      },
      limit: {
        type: "number",
        description: "Maximum SLOs to return (default 10, max 25).",
      },
      skip: {
        type: "number",
        description:
          "Rows to skip for pagination (default 0). The result says when more rows exist.",
      },
    },
  },
  get requiredPermissions(): Array<Permission> {
    return resolveReadPermissions();
  },
  execute: async (
    args: JSONObject,
    ctx: ToolContext,
  ): Promise<ToolExecutionResult> => {
    const sloId: ObjectID | undefined = ToolArgs.getObjectID(args, "sloId");

    if (sloId) {
      const slo: ServiceLevelObjective | null =
        await ServiceLevelObjectiveService.findOneById({
          id: sloId,
          select: {
            _id: true,
            name: true,
            description: true,
            isEnabled: true,
            sliType: true,
            multiMonitorMode: true,
            metricQueryConfig: true,
            targetPercentage: true,
            windowType: true,
            windowDays: true,
            timezone: true,
            atRiskThresholdPercentage: true,
            sloStatus: true,
            currentSliPercentage: true,
            errorBudgetRemainingPercentage: true,
            errorBudgetRemainingSeconds: true,
            errorBudgetTotalSeconds: true,
            currentBurnRate: true,
            lastEvaluatedAt: true,
            monitors: {
              _id: true,
              name: true,
            },
            monitorLabels: {
              name: true,
            },
            downtimeMonitorStatuses: {
              name: true,
            },
            labels: {
              name: true,
            },
          },
          props: ctx.props,
        });

      const rows: Array<JSONObject> = [];

      if (slo) {
        rows.push({
          record: "slo",
          id: slo.id?.toString(),
          name: slo.name,
          description: slo.description,
          isEnabled: slo.isEnabled,
          sliType: slo.sliType,
          multiMonitorMode: slo.multiMonitorMode,
          metricQueryConfig: slo.metricQueryConfig,
          targetPercentage: slo.targetPercentage,
          window: describeWindow(slo),
          timezone: slo.timezone,
          atRiskThresholdPercentage: slo.atRiskThresholdPercentage,
          sloStatus: slo.sloStatus,
          currentSliPercentage: slo.currentSliPercentage,
          errorBudgetRemainingPercentage: slo.errorBudgetRemainingPercentage,
          errorBudgetRemainingSeconds: slo.errorBudgetRemainingSeconds,
          errorBudgetTotalSeconds: slo.errorBudgetTotalSeconds,
          currentBurnRate: slo.currentBurnRate,
          lastEvaluatedAt: slo.lastEvaluatedAt,
          monitors: joinNames(slo.monitors) || undefined,
          autoAttachMonitorLabels: joinNames(slo.monitorLabels) || undefined,
          downtimeMonitorStatuses:
            joinNames(slo.downtimeMonitorStatuses) || undefined,
          labels: joinNames(slo.labels) || undefined,
        });
      }

      /*
       * Burn-rate rules are only fetched when the SLO itself is visible to
       * the user — the rule table is OwnedThrough the SLO, so this also
       * avoids leaking rule names for an SLO the user cannot read.
       */
      let rules: Array<ServiceLevelObjectiveBurnRateRule> = [];

      if (slo) {
        rules = await ServiceLevelObjectiveBurnRateRuleService.findBy({
          query: {
            serviceLevelObjectiveId: sloId,
          },
          select: {
            _id: true,
            name: true,
            isEnabled: true,
            burnRateThreshold: true,
            longWindowInMinutes: true,
            shortWindowInMinutes: true,
            minimumSampleCount: true,
            refireSuppressionMinutes: true,
            alertSeverity: {
              name: true,
            },
            lastAlertCreatedAt: true,
            lastAlertResolvedAt: true,
          },
          sort: {
            burnRateThreshold: SortOrder.Descending,
          },
          limit: 25,
          skip: 0,
          props: ctx.props,
        });
      }

      for (const rule of rules) {
        rows.push({
          record: "burnRateRule",
          id: rule.id?.toString(),
          name: rule.name,
          isEnabled: rule.isEnabled,
          burnRateThreshold: rule.burnRateThreshold,
          longWindowInMinutes: rule.longWindowInMinutes,
          shortWindowInMinutes: rule.shortWindowInMinutes,
          minimumSampleCount: rule.minimumSampleCount,
          refireSuppressionMinutes: rule.refireSuppressionMinutes,
          alertSeverity: rule.alertSeverity?.name,
          lastAlertCreatedAt: rule.lastAlertCreatedAt,
          lastAlertResolvedAt: rule.lastAlertResolvedAt,
        });
      }

      const serialized: SerializedResult =
        ToolResultSerializer.serializeRows(rows);

      return {
        dataForLlm:
          rows.length > 0
            ? `${COMPLIANCE_NOTE}${serialized.text}`
            : serialized.text,
        rowCount: serialized.rowCount,
        citationLabel: `SLO ${slo?.name || sloId.toString()}`,
        citationTarget: {
          type: AIChatCitationTargetType.SloView,
          params: { sloId: sloId.toString() },
        },
        redactionCount: serialized.redactionCount,
        isTruncated: serialized.isTruncated,
        widget: slo
          ? WidgetBuilder.resourceCard({
              title: `SLO ${slo.name ?? ""}`.trim(),
              resourceType: "Service Level Objective",
              heading: slo.name || sloId.toString(),
              subheading: slo.description,
              fields: [
                {
                  label: "Target",
                  value: formatPercent(slo.targetPercentage),
                },
                { label: "Window", value: describeWindow(slo) },
                { label: "SLI type", value: slo.sliType || "" },
                { label: "Status", value: slo.sloStatus || "" },
                {
                  label: "Current SLI",
                  value: formatPercent(slo.currentSliPercentage),
                },
                {
                  label: "Error budget left",
                  value: formatPercent(slo.errorBudgetRemainingPercentage),
                },
                {
                  label: "Burn rate",
                  value:
                    slo.currentBurnRate !== undefined &&
                    slo.currentBurnRate !== null
                      ? String(Math.round(slo.currentBurnRate * 100) / 100)
                      : "not evaluated yet",
                },
                { label: "Monitors", value: joinNames(slo.monitors) || "none" },
                { label: "Burn-rate rules", value: String(rules.length) },
              ],
              link: {
                type: AIChatCitationTargetType.SloView,
                params: { sloId: sloId.toString() },
              },
            })
          : undefined,
      };
    }

    const statusFilterString: string | undefined = ToolArgs.getString(
      args,
      "sloStatus",
    );

    let statusFilter: SloStatus | undefined = undefined;
    if (statusFilterString) {
      statusFilter = Object.values(SloStatus).find(
        (status: SloStatus): boolean => {
          return status.toLowerCase() === statusFilterString.toLowerCase();
        },
      );

      // An unknown status silently matching nothing would read as "all clear".
      if (!statusFilter) {
        return {
          dataForLlm: `Error: sloStatus "${statusFilterString}" is not a valid SLO status. Valid values: ${Object.values(
            SloStatus,
          ).join(", ")}.`,
          rowCount: 0,
          citationLabel: "SLOs (invalid status filter)",
          redactionCount: 0,
          isTruncated: false,
        };
      }
    }

    const nameSearch: string | undefined = ToolArgs.getString(
      args,
      "nameSearch",
    );
    const limit: number = ToolArgs.getNumber(args, "limit", {
      defaultValue: 10,
      min: 1,
      max: 25,
    });
    const skip: number = ToolArgs.getNumber(args, "skip", {
      defaultValue: 0,
      min: 0,
      max: 500,
    });

    const query: Query<ServiceLevelObjective> = {};
    if (statusFilter) {
      query.sloStatus = statusFilter;
    }
    if (nameSearch) {
      query.name = QueryHelper.search(nameSearch);
    }

    const slos: Array<ServiceLevelObjective> =
      await ServiceLevelObjectiveService.findBy({
        query: query,
        select: {
          _id: true,
          name: true,
          isEnabled: true,
          sliType: true,
          targetPercentage: true,
          windowType: true,
          windowDays: true,
          sloStatus: true,
          currentSliPercentage: true,
          errorBudgetRemainingPercentage: true,
          currentBurnRate: true,
          lastEvaluatedAt: true,
          monitors: {
            name: true,
          },
        },
        sort: {
          name: SortOrder.Ascending,
        },
        limit: limit,
        skip: skip,
        props: ctx.props,
      });

    const totalCount: PositiveNumber =
      await ServiceLevelObjectiveService.countBy({
        query: query,
        props: ctx.props,
      });
    const total: number = totalCount.toNumber();

    const rows: Array<JSONObject> = slos.map((slo: ServiceLevelObjective) => {
      return {
        id: slo.id?.toString(),
        name: slo.name,
        isEnabled: slo.isEnabled,
        sliType: slo.sliType,
        targetPercentage: slo.targetPercentage,
        window: describeWindow(slo),
        monitors: joinNames(slo.monitors) || undefined,
        sloStatus: slo.sloStatus,
        currentSliPercentage: slo.currentSliPercentage,
        errorBudgetRemainingPercentage: slo.errorBudgetRemainingPercentage,
        currentBurnRate: slo.currentBurnRate,
        lastEvaluatedAt: slo.lastEvaluatedAt,
      };
    });

    const serialized: SerializedResult =
      ToolResultSerializer.serializeRows(rows);

    let prefix: string = "";
    if (rows.length > 0) {
      if (total > rows.length) {
        prefix += `Showing rows ${skip + 1}–${skip + rows.length} of ${total} total. Pass skip to page further.\n`;
      }
      prefix += COMPLIANCE_NOTE;
    }

    const filterLabel: string = statusFilter ? `${statusFilter} ` : "";

    return {
      dataForLlm: `${prefix}${serialized.text}`,
      rowCount: serialized.rowCount,
      citationLabel: `${filterLabel}SLOs (${total} found)`,
      citationTarget: {
        type: AIChatCitationTargetType.Slos,
      },
      redactionCount: serialized.redactionCount,
      isTruncated: serialized.isTruncated,
      widget:
        rows.length > 0
          ? WidgetBuilder.table({
              title: `${filterLabel}SLOs (${total})`,
              description:
                "Compliance columns are as of each SLO's last evaluation.",
              columns: [
                { key: "name", title: "Name", type: "text" },
                { key: "targetPercentage", title: "Target %", type: "number" },
                { key: "window", title: "Window", type: "text" },
                {
                  key: "currentSliPercentage",
                  title: "Current SLI %",
                  type: "number",
                },
                {
                  key: "errorBudgetRemainingPercentage",
                  title: "Budget left %",
                  type: "number",
                },
                { key: "currentBurnRate", title: "Burn rate", type: "number" },
                { key: "sloStatus", title: "Status", type: "text" },
              ],
              rows: rows,
              link: { type: AIChatCitationTargetType.Slos },
            })
          : undefined,
    };
  },
};
