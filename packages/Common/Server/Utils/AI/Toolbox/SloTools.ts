import Label from "../../../../Models/DatabaseModels/Label";
import ServiceLevelObjective from "../../../../Models/DatabaseModels/ServiceLevelObjective";
import ServiceLevelObjectiveBurnRateRule from "../../../../Models/DatabaseModels/ServiceLevelObjectiveBurnRateRule";
import ServiceLevelObjectiveErrorBudgetPolicyTier from "../../../../Models/DatabaseModels/ServiceLevelObjectiveErrorBudgetPolicyTier";
import ServiceLevelObjectiveMonitorRule from "../../../../Models/DatabaseModels/ServiceLevelObjectiveMonitorRule";
import {
  describeSloMonitorRuleCriteria,
  getSloMonitorRuleLabelIds,
} from "../../../../Utils/Slo/SloMonitorRuleCriteria";
import LabelService from "../../../Services/LabelService";
import ServiceLevelObjectiveMonitorRuleService from "../../../Services/ServiceLevelObjectiveMonitorRuleService";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
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
import ServiceLevelObjectiveErrorBudgetPolicyTierService from "../../../Services/ServiceLevelObjectiveErrorBudgetPolicyTierService";
import {
  formatSloPolicyTierThreshold,
  isSameSloPolicyTier,
  sortSloPolicyTiers,
} from "../../../../Utils/Slo/SloErrorBudgetPolicy";
import Query from "../../../Types/Database/Query";
import QueryHelper from "../../../Types/Database/QueryHelper";
import ToolResultSerializer, { SerializedResult } from "./Serializer";
import WidgetBuilder from "./WidgetBuilder";
import { getSloCardWords } from "./ReadCardWords";
import {
  ObservabilityTool,
  ToolArgs,
  ToolContext,
  ToolExecutionResult,
} from "./ToolTypes";
import { translationKey } from "../../../../Types/Translator";
import {
  SloRecommendedAlertSeverity,
  SloRecommendedBurnRateRule,
  getMissingSloRecommendedBurnRateRules,
} from "../../../../Utils/Slo/SloRecommendedBurnRateRules";

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

/*
 * An archived SLO is retired: hidden from the SLO list and skipped by the
 * evaluation worker, so every compliance figure on its row is frozen at the
 * moment it was archived. Without this the model would report a months-old
 * "Healthy" as the SLO's current state.
 */
const ARCHIVED_NOTE: string =
  "Note: this SLO is archived — it is hidden from the SLO list and is no longer evaluated, so its compliance figures are frozen as of its last evaluation before it was archived (see archivedAt). Unarchive it in the dashboard to resume measuring.\n";

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

/*
 * Whether a burn-rate title or description template will actually be used.
 * The template renderer treats a blank or whitespace-only template as unset
 * and falls back to the default text, so this does too.
 */
function hasBurnRateTemplate(template: string | undefined): boolean {
  return typeof template === "string" && template.trim() !== "";
}

function countOf(items: Array<unknown> | undefined): number {
  return (items || []).length;
}

// "Rolling 30d" / "Calendar Month" — compact window description for one row.
function describeWindow(slo: ServiceLevelObjective): string {
  if (slo.windowType === SloWindowType.CalendarMonth) {
    return SloWindowType.CalendarMonth;
  }
  return `${SloWindowType.Rolling} ${slo.windowDays ?? 30}d`;
}

/*
 * The two rule tables have their own read permissions
 * (ReadServiceLevelObjectiveMonitorRule, ReadServiceLevelObjectiveBurnRateRule),
 * separate from ReadServiceLevelObjective, which gates this tool. A custom role
 * can read SLOs without being able to read one or both rule tables. Every
 * custom role created before monitor rules shipped is in that position, since
 * it cannot hold a permission that did not exist yet. For such a caller the
 * rule read throws NotAuthorizedException. Letting that escape fails the whole
 * tool call, and the model loses the SLO definition it was allowed to see. So
 * a denied rule read is reported as "not visible" and the rest is returned.
 *
 * Only a permission denial is absorbed. Any other failure (a lost database
 * connection, a bad query) still fails the call, so it is never presented as
 * "this SLO has no rules".
 */
interface ChildRowsRead<T> {
  rows: Array<T>;
  isPermitted: boolean;
}

async function readChildRowsIfPermitted<T>(
  read: () => Promise<Array<T>>,
): Promise<ChildRowsRead<T>> {
  try {
    return {
      rows: await read(),
      isPermitted: true,
    };
  } catch (error) {
    if (error instanceof NotAuthorizedException) {
      return {
        rows: [],
        isPermitted: false,
      };
    }

    throw error;
  }
}

/*
 * Travels with the result when a rule table was not readable. Without it the
 * model would read the missing rows as "this SLO has no rules" and tell the
 * user so.
 */
const MONITOR_RULES_NOT_VISIBLE_NOTE: string =
  "Note: this SLO's monitor rules are left out because the current user does not have permission to read SLO Monitor Rules (ReadServiceLevelObjectiveMonitorRule). Do not conclude that the SLO has no monitor rules; say which permission is missing if the user asks about them.\n";

const BURN_RATE_RULES_NOT_VISIBLE_NOTE: string =
  "Note: this SLO's burn-rate rules are left out because the current user does not have permission to read SLO Burn Rate Rules (ReadServiceLevelObjectiveBurnRateRule). Do not conclude that the SLO has no burn-rate rules; say which permission is missing if the user asks about them.\n";

const POLICY_TIERS_NOT_VISIBLE_NOTE: string =
  "Note: this SLO's error budget policy tiers are left out because the current user does not have permission to read SLO Error Budget Policy Tiers (ReadServiceLevelObjectiveErrorBudgetPolicyTier). The SLO row still says which tier it is in. Do not conclude that the SLO has no error budget policy; say which permission is missing if the user asks about it.\n";

/*
 * How an SLO's error budget policy tiers are read: a tier applies while the
 * budget left is at or below its threshold, the SLO is in the applying tier
 * with the lowest threshold, and leaving one waits for a recovery margin.
 * Travels with every result that has tiers in it, so the model explains a
 * tier the way the product does.
 */
const POLICY_TIERS_NOTE: string =
  "Note: errorBudgetPolicyTier rows are the SLO's error budget policy - what the team agreed to do as the budget runs down. A tier applies while the error budget left is at or below its threshold; the SLO is in the applying tier with the lowest threshold (currentErrorBudgetPolicyTier on the SLO row). It leaves a tier only once the budget is 5 points above its threshold (2% for a tier at 0%). whatWeDo is the team's agreement for that tier. freezesDeployments says whether being in the tier freezes deployments.\n";

/*
 * How the deploy gate is read. Travels with every result that has an SLO
 * row, because every SLO row carries the answer: without it a model reads
 * "deploymentsAllowed: true" on an SLO with no policy as a decision someone
 * made.
 */
const DEPLOYMENT_GATE_NOTE: string =
  "Note: deploymentsAllowed on an SLO row is the deploy gate CI/CD pipelines read before they release: it is false while the SLO is in an error budget policy tier that freezes deployments (deploymentsFrozenAt says since when), and true otherwise - also for an SLO with no policy. A Paused or Misconfigured SLO keeps the answer it had.\n";

// The most tiers one SLO read returns; a policy has a handful.
const POLICY_TIERS_READ_LIMIT: number = 25;

// "What we do" is free text: enough of it for the model, not a whole essay.
const WHAT_WE_DO_MAX_CHARACTERS: number = 1000;

function truncateWhatWeDo(whatWeDo: string | undefined): string | undefined {
  if (!whatWeDo) {
    return undefined;
  }

  const characters: Array<string> = Array.from(whatWeDo);

  return characters.length <= WHAT_WE_DO_MAX_CHARACTERS
    ? whatWeDo
    : `${characters.slice(0, WHAT_WE_DO_MAX_CHARACTERS).join("")}…`;
}

// The most burn-rate rules one SLO read returns.
const BURN_RATE_RULES_READ_LIMIT: number = 25;

/*
 * The recommended burn-rate rules (Fast burn, Slow burn, Slow leak) this SLO
 * does not have, scaled to its window, as a note rather than rows: they are
 * not records of the SLO, and the model must never report one as a rule that
 * is set up. An SLO created before Slow leak existed is missing it.
 *
 * And where they are added: the SLO's Burn Rate Rules page, or the SLO
 * list's Bulk Actions for many SLOs at once. Neither offers them on an
 * archived SLO, whose rules never fire, so that one is told to unarchive
 * the SLO first.
 */
function getMissingRecommendedRulesNote(
  missing: Array<SloRecommendedBurnRateRule>,
  isArchived: boolean,
): string {
  if (missing.length === 0) {
    return "";
  }

  const rules: string = missing
    .map((rule: SloRecommendedBurnRateRule): string => {
      const severity: string =
        rule.alertSeverity === SloRecommendedAlertSeverity.LeastSevere
          ? "least"
          : "most";

      return `${rule.name} (burn rate ${rule.burnRateThreshold}x over ${rule.longWindowInMinutes} minutes, confirmed over ${rule.shortWindowInMinutes} minutes; raises an alert at the project's ${severity} severe alert severity and declares no incident; waits ${rule.refireSuppressionMinutes ?? rule.longWindowInMinutes} minutes after an alert resolves before raising another)`;
    })
    .join("; ");

  const it: string = missing.length === 1 ? "it" : "them";

  const where: string = isArchived
    ? `This SLO is archived, so its rules never fire and neither its Burn Rate Rules page nor the SLO list offers ${it}: unarchive the SLO first, then add ${it} on its Burn Rate Rules page with Add recommended rules.`
    : `Anyone who can create SLO burn rate rules can add ${it} on the SLO's Burn Rate Rules page with Add recommended rules, or add the missing recommended rules to many SLOs at once by selecting them on the SLO list and choosing Add recommended rules under Bulk Actions.`;

  return `Note: this SLO does not have ${missing.length === 1 ? "this burn-rate rule" : "these burn-rate rules"} OneUptime recommends for every SLO (Fast burn and Slow burn page someone; Slow leak is a low-severity ticket for a slow, steady burn), scaled to its window: ${rules}. ${missing.length === 1 ? "It is" : "They are"} not set up and never fire. ${where}\n`;
}

/*
 * Label names for the monitor rule descriptions. Legacy rules carry their
 * label names in the select already; rules on configurable criteria store
 * only label ids, so those are looked up - under the user's own props, so a
 * label the user cannot read stays unnamed. A lookup that fails degrades to
 * "an unknown label" in the description rather than failing the whole tool.
 */
async function resolveMonitorRuleLabelNames(data: {
  monitorRules: Array<ServiceLevelObjectiveMonitorRule>;
  ctx: ToolContext;
}): Promise<Map<string, string>> {
  const labelNameById: Map<string, string> = new Map<string, string>();
  const unnamedLabelIds: Set<string> = new Set<string>();

  for (const monitorRule of data.monitorRules) {
    for (const label of monitorRule.monitorLabels || []) {
      if (label.id && label.name) {
        labelNameById.set(label.id.toString(), label.name);
      }
    }

    for (const labelId of getSloMonitorRuleLabelIds(monitorRule)) {
      if (!labelNameById.has(labelId) && ObjectID.isValidUUID(labelId)) {
        unnamedLabelIds.add(labelId);
      }
    }
  }

  if (unnamedLabelIds.size === 0) {
    return labelNameById;
  }

  try {
    const labels: Array<Label> = await LabelService.findBy({
      query: {
        _id: QueryHelper.any(Array.from(unnamedLabelIds)),
      },
      select: {
        _id: true,
        name: true,
      },
      limit: unnamedLabelIds.size,
      skip: 0,
      props: data.ctx.props,
    });

    for (const label of labels) {
      if (label.id && label.name) {
        labelNameById.set(label.id.toString(), label.name);
      }
    }
  } catch {
    // Described as unknown labels instead; see above.
  }

  return labelNameById;
}

export const QuerySlosTool: ObservabilityTool = {
  name: "query_slos",
  description:
    "List Service Level Objectives (SLOs) in this project: what each one measures (monitor uptime or a metric SLI), its target percentage, compliance window, attached monitors, and the latest persisted compliance status — current SLI %, error budget remaining and burn rate as computed by the platform at its last evaluation (this tool never recomputes compliance live). Pass sloId (an SLO ID from this tool's own list results) to get one SLO's full definition plus its burn-rate rules, their thresholds, whether each raises an alert, declares an incident, or both, and what each output is created with (custom title/description templates, label and owner counts, private and auto-resolve settings, and whether the SLO's owners are added), and which of OneUptime's recommended burn-rate rules (Fast burn, Slow burn, Slow leak) the SLO is missing, plus its error budget policy: the tiers (name, budget-left threshold, what the team agreed to do, whether each freezes deployments, whether each raises an alert or declares an incident) and the tier the SLO is in now. Every SLO row says which error budget policy tier it is in, and whether deployments are allowed (deploymentsAllowed: false while the SLO is in a tier that freezes deployments - the deploy gate CI/CD pipelines check). Use query_alerts to see alerts those burn-rate rules raised, query_incidents for the incidents they declared, and query_monitors for the current status of an SLO's monitors. Archived SLOs (retired: hidden from the SLO list and no longer evaluated) are left out of lists unless includeArchived is true; looking one up by sloId still works and says it is archived.",
  inputSchema: {
    type: "object",
    properties: {
      sloId: {
        type: "string",
        description:
          "Get one SLO by its ID — includes the full definition (SLI type, downtime statuses, at-risk threshold, error budget seconds), its monitor rules (which monitors each rule attaches, and whether it is enabled), and its burn-rate rules with thresholds, windows, and what each rule declares when it fires.",
      },
      sloStatus: {
        type: "string",
        enum: Object.values(SloStatus),
        description:
          "Only list SLOs currently in this status (e.g. 'At Risk' or 'Budget Exhausted' to find SLOs in trouble).",
      },
      includeArchived: {
        type: "boolean",
        description:
          "Also list archived SLOs (default false). Archived SLOs are retired — hidden from the SLO list and no longer evaluated — so their compliance figures are frozen. Only set this when the user asks about archived or retired SLOs.",
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
            isArchived: true,
            archivedAt: true,
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
            currentErrorBudgetPolicyTierId: true,
            currentErrorBudgetPolicyTierName: true,
            currentErrorBudgetPolicyTierEnteredAt: true,
            deploymentsAllowed: true,
            deploymentsFrozenAt: true,
            lastEvaluatedAt: true,
            monitors: {
              _id: true,
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
          isArchived: slo.isArchived,
          archivedAt: slo.archivedAt,
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
          currentErrorBudgetPolicyTier:
            slo.currentErrorBudgetPolicyTierName || undefined,
          currentErrorBudgetPolicyTierEnteredAt:
            slo.currentErrorBudgetPolicyTierEnteredAt || undefined,
          // A NOT NULL column that defaults to true: only false is a freeze.
          deploymentsAllowed: slo.deploymentsAllowed !== false,
          deploymentsFrozenAt:
            slo.deploymentsAllowed === false
              ? slo.deploymentsFrozenAt || undefined
              : undefined,
          lastEvaluatedAt: slo.lastEvaluatedAt,
          monitors: joinNames(slo.monitors) || undefined,
          downtimeMonitorStatuses:
            joinNames(slo.downtimeMonitorStatuses) || undefined,
          labels: joinNames(slo.labels) || undefined,
        });
      }

      /*
       * Monitor rules decide which of those monitors the SLO measures, so the
       * model can explain why a monitor is (or is not) on it. Fetched only
       * when the SLO itself is visible - the rule table is OwnedThrough the
       * SLO, exactly like the burn-rate rules below. A caller who may read
       * the SLO but not its monitor rules still gets the SLO; see
       * readChildRowsIfPermitted.
       */
      let monitorRules: Array<ServiceLevelObjectiveMonitorRule> = [];
      let areMonitorRulesVisible: boolean = true;

      if (slo) {
        const monitorRulesRead: ChildRowsRead<ServiceLevelObjectiveMonitorRule> =
          await readChildRowsIfPermitted<ServiceLevelObjectiveMonitorRule>(
            (): Promise<Array<ServiceLevelObjectiveMonitorRule>> => {
              return ServiceLevelObjectiveMonitorRuleService.findBy({
                query: {
                  serviceLevelObjectiveId: sloId,
                },
                select: {
                  _id: true,
                  name: true,
                  isEnabled: true,
                  monitorLabels: {
                    _id: true,
                    name: true,
                  },
                  monitorType: true,
                  monitorNamePattern: true,
                  monitorDescriptionPattern: true,
                  criteria: true,
                },
                sort: {
                  name: SortOrder.Ascending,
                },
                limit: 25,
                skip: 0,
                props: ctx.props,
              });
            },
          );

        monitorRules = monitorRulesRead.rows;
        areMonitorRulesVisible = monitorRulesRead.isPermitted;
      }

      const monitorRuleLabelNameById: Map<string, string> =
        await resolveMonitorRuleLabelNames({
          monitorRules: monitorRules,
          ctx: ctx,
        });

      for (const monitorRule of monitorRules) {
        rows.push({
          record: "monitorRule",
          id: monitorRule.id?.toString(),
          name: monitorRule.name,
          // A NOT NULL column that defaults to true; absent reads as enabled.
          isEnabled: monitorRule.isEnabled !== false,
          matches: describeSloMonitorRuleCriteria({
            rule: monitorRule,
            labelNameById: monitorRuleLabelNameById,
          }),
        });
      }

      /*
       * Burn-rate rules are only fetched when the SLO itself is visible to
       * the user — the rule table is OwnedThrough the SLO, so this also
       * avoids leaking rule names for an SLO the user cannot read. Same
       * degradation as the monitor rules above when the rule table is not
       * readable.
       */
      let rules: Array<ServiceLevelObjectiveBurnRateRule> = [];
      let areBurnRateRulesVisible: boolean = true;

      if (slo) {
        const burnRateRulesRead: ChildRowsRead<ServiceLevelObjectiveBurnRateRule> =
          await readChildRowsIfPermitted<ServiceLevelObjectiveBurnRateRule>(
            (): Promise<Array<ServiceLevelObjectiveBurnRateRule>> => {
              return ServiceLevelObjectiveBurnRateRuleService.findBy({
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
                  shouldCreateAlert: true,
                  alertSeverity: {
                    name: true,
                  },
                  shouldCreateIncident: true,
                  incidentSeverity: {
                    name: true,
                  },
                  /*
                   * The options each output is created with. Remediation notes and
                   * on-call policies are left out: they do not change what the
                   * alert or incident is, and remediation notes are the longest
                   * text on the row. The many-to-many lists select ids only - they
                   * are reported as counts - so no label, team or user row is
                   * loaded for them.
                   */
                  alertTitleTemplate: true,
                  alertDescriptionTemplate: true,
                  isAlertPrivate: true,
                  autoResolveAlert: true,
                  alertLabels: {
                    _id: true,
                  },
                  alertOwnerTeams: {
                    _id: true,
                  },
                  alertOwnerUsers: {
                    _id: true,
                  },
                  incidentTitleTemplate: true,
                  incidentDescriptionTemplate: true,
                  isIncidentPrivate: true,
                  autoResolveIncident: true,
                  incidentLabels: {
                    _id: true,
                  },
                  incidentOwnerTeams: {
                    _id: true,
                  },
                  incidentOwnerUsers: {
                    _id: true,
                  },
                  addSloOwnersAsOwners: true,
                  lastAlertCreatedAt: true,
                  lastAlertResolvedAt: true,
                  lastIncidentCreatedAt: true,
                  lastIncidentResolvedAt: true,
                },
                sort: {
                  burnRateThreshold: SortOrder.Descending,
                },
                limit: BURN_RATE_RULES_READ_LIMIT,
                skip: 0,
                props: ctx.props,
              });
            },
          );

        rules = burnRateRulesRead.rows;
        areBurnRateRulesVisible = burnRateRulesRead.isPermitted;
      }

      for (const rule of rules) {
        /*
         * Read with the model's own defaults so a rule written before
         * incidents existed reports "creates an alert" rather than a blank
         * the model would have to guess at.
         */
        const createsAlert: boolean = rule.shouldCreateAlert !== false;
        const createsIncident: boolean = rule.shouldCreateIncident === true;

        const row: JSONObject = {
          record: "burnRateRule",
          id: rule.id?.toString(),
          name: rule.name,
          isEnabled: rule.isEnabled,
          burnRateThreshold: rule.burnRateThreshold,
          longWindowInMinutes: rule.longWindowInMinutes,
          shortWindowInMinutes: rule.shortWindowInMinutes,
          minimumSampleCount: rule.minimumSampleCount,
          refireSuppressionMinutes: rule.refireSuppressionMinutes,
          createsAlert: createsAlert,
          alertSeverity: rule.alertSeverity?.name,
          createsIncident: createsIncident,
          incidentSeverity: rule.incidentSeverity?.name,
          lastAlertCreatedAt: rule.lastAlertCreatedAt,
          lastAlertResolvedAt: rule.lastAlertResolvedAt,
          lastIncidentCreatedAt: rule.lastIncidentCreatedAt,
          lastIncidentResolvedAt: rule.lastIncidentResolvedAt,
        };

        /*
         * What each output is created with, reported only for an output the
         * rule produces: every rule carries autoResolveIncident=true as a
         * column default, and handing that to the model for an alert-only
         * rule would read as if it declared incidents. The flags use the
         * defaults the worker applies (`!== false` for auto-resolve,
         * `=== true` for private and addSloOwnersAsOwners). Templates are
         * reported as set or not rather than inlined - free text that would
         * crowd out the rows around it - and labels and owners as counts,
         * since only their ids are selected.
         */
        if (createsAlert) {
          row["hasAlertTitleTemplate"] = hasBurnRateTemplate(
            rule.alertTitleTemplate,
          );
          row["hasAlertDescriptionTemplate"] = hasBurnRateTemplate(
            rule.alertDescriptionTemplate,
          );
          row["alertLabelCount"] = countOf(rule.alertLabels);
          row["alertOwnerTeamCount"] = countOf(rule.alertOwnerTeams);
          row["alertOwnerUserCount"] = countOf(rule.alertOwnerUsers);
          row["isAlertPrivate"] = rule.isAlertPrivate === true;
          row["autoResolveAlert"] = rule.autoResolveAlert !== false;
        }

        if (createsIncident) {
          row["hasIncidentTitleTemplate"] = hasBurnRateTemplate(
            rule.incidentTitleTemplate,
          );
          row["hasIncidentDescriptionTemplate"] = hasBurnRateTemplate(
            rule.incidentDescriptionTemplate,
          );
          row["incidentLabelCount"] = countOf(rule.incidentLabels);
          row["incidentOwnerTeamCount"] = countOf(rule.incidentOwnerTeams);
          row["incidentOwnerUserCount"] = countOf(rule.incidentOwnerUsers);
          row["isIncidentPrivate"] = rule.isIncidentPrivate === true;
          row["autoResolveIncident"] = rule.autoResolveIncident !== false;
        }

        if (createsAlert || createsIncident) {
          row["addSloOwnersAsOwners"] = rule.addSloOwnersAsOwners === true;
        }

        rows.push(row);
      }

      /*
       * The error budget policy: its tiers, most budget left first (the order
       * the budget reaches them), and which one the SLO is in. Read like the
       * rule tables - only for an SLO the user can see, and a caller who may
       * read the SLO but not its tiers still gets the SLO (and, on its row,
       * the tier it is in, which is SLO data).
       */
      let policyTiers: Array<ServiceLevelObjectiveErrorBudgetPolicyTier> = [];
      let arePolicyTiersVisible: boolean = true;

      if (slo) {
        const policyTiersRead: ChildRowsRead<ServiceLevelObjectiveErrorBudgetPolicyTier> =
          await readChildRowsIfPermitted<ServiceLevelObjectiveErrorBudgetPolicyTier>(
            (): Promise<Array<ServiceLevelObjectiveErrorBudgetPolicyTier>> => {
              return ServiceLevelObjectiveErrorBudgetPolicyTierService.findBy({
                query: {
                  serviceLevelObjectiveId: sloId,
                },
                select: {
                  _id: true,
                  name: true,
                  isEnabled: true,
                  thresholdPercentage: true,
                  whatWeDo: true,
                  freezesDeployments: true,
                  shouldCreateAlert: true,
                  shouldCreateIncident: true,
                  lastAlertCreatedAt: true,
                  lastAlertResolvedAt: true,
                  lastIncidentCreatedAt: true,
                  lastIncidentResolvedAt: true,
                },
                limit: POLICY_TIERS_READ_LIMIT,
                skip: 0,
                props: ctx.props,
              });
            },
          );

        policyTiers = sortSloPolicyTiers(policyTiersRead.rows).reverse();
        arePolicyTiersVisible = policyTiersRead.isPermitted;
      }

      for (const tier of policyTiers) {
        rows.push({
          record: "errorBudgetPolicyTier",
          id: tier.id?.toString(),
          name: tier.name,
          // A NOT NULL column that defaults to true; absent reads as enabled.
          isEnabled: tier.isEnabled !== false,
          thresholdPercentage: tier.thresholdPercentage,
          appliesWhen: `error budget left at or below ${formatSloPolicyTierThreshold(tier.thresholdPercentage)}`,
          isCurrentTier: isSameSloPolicyTier(
            tier.id,
            slo?.currentErrorBudgetPolicyTierId,
          ),
          whatWeDo: truncateWhatWeDo(tier.whatWeDo),
          // Defaults to false, like the two outputs.
          freezesDeployments: tier.freezesDeployments === true,
          // Both default to false on a tier.
          createsAlert: tier.shouldCreateAlert === true,
          createsIncident: tier.shouldCreateIncident === true,
          lastAlertCreatedAt: tier.lastAlertCreatedAt,
          lastAlertResolvedAt: tier.lastAlertResolvedAt,
          lastIncidentCreatedAt: tier.lastIncidentCreatedAt,
          lastIncidentResolvedAt: tier.lastIncidentResolvedAt,
        });
      }

      /*
       * The rules OneUptime recommends (Fast burn, Slow burn, Slow leak) that
       * this SLO does not have, scaled to its window - an SLO created before
       * Slow leak existed is missing it - so the model can say so, and where
       * they are added. Worked out only from every rule of the SLO: from a
       * read the limit cut short, a rule that is there could read as missing.
       */
      const missingRecommendedRules: Array<SloRecommendedBurnRateRule> =
        slo &&
        areBurnRateRulesVisible &&
        rules.length < BURN_RATE_RULES_READ_LIMIT
          ? getMissingSloRecommendedBurnRateRules({
              window: {
                windowType: slo.windowType,
                windowDays: slo.windowDays,
              },
              existingRules: rules,
            })
          : [];

      const serialized: SerializedResult =
        ToolResultSerializer.serializeRows(rows);

      return {
        dataForLlm:
          rows.length > 0
            ? `${slo?.isArchived === true ? ARCHIVED_NOTE : ""}${areMonitorRulesVisible ? "" : MONITOR_RULES_NOT_VISIBLE_NOTE}${areBurnRateRulesVisible ? "" : BURN_RATE_RULES_NOT_VISIBLE_NOTE}${arePolicyTiersVisible ? "" : POLICY_TIERS_NOT_VISIBLE_NOTE}${policyTiers.length > 0 ? POLICY_TIERS_NOTE : ""}${slo ? DEPLOYMENT_GATE_NOTE : ""}${getMissingRecommendedRulesNote(missingRecommendedRules, slo?.isArchived === true)}${COMPLIANCE_NOTE}${serialized.text}`
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
              heading: slo.name || sloId.toString(),
              // In the reader's language (issue #7175): figures the reader's way.
              words: getSloCardWords({
                description: slo.description || undefined,
                targetPercentage: slo.targetPercentage,
                windowType: slo.windowType,
                windowDays: slo.windowDays,
                sliType: slo.sliType,
                isArchived: slo.isArchived === true,
                isEnabled: slo.isEnabled !== false,
                sloStatus: slo.sloStatus,
                currentSliPercentage: slo.currentSliPercentage,
                errorBudgetRemainingPercentage:
                  slo.errorBudgetRemainingPercentage,
                currentBurnRate: slo.currentBurnRate,
                monitorNames: joinNames(slo.monitors),
                monitorRules: {
                  isVisible: areMonitorRulesVisible,
                  count: monitorRules.length,
                  enabledCount: monitorRules.filter(
                    (monitorRule: ServiceLevelObjectiveMonitorRule) => {
                      return monitorRule.isEnabled !== false;
                    },
                  ).length,
                },
                burnRateRules: {
                  isVisible: areBurnRateRulesVisible,
                  count: rules.length,
                },
                policyTiers: {
                  currentName:
                    slo.currentErrorBudgetPolicyTierName || undefined,
                  isVisible: arePolicyTiersVisible,
                  count: policyTiers.length,
                },
                deploymentsAllowed: slo.deploymentsAllowed,
              }),
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

    /*
     * Archived SLOs are left out by default, matching the SLO list a person
     * sees: "which SLOs are at risk?" must not surface a retired SLO whose
     * status froze months ago. Asked explicitly, they are included — and each
     * one is flagged on its row. The filter goes on the shared query, so the
     * total below counts exactly the set being paged.
     */
    const includeArchived: boolean =
      ToolArgs.getBoolean(args, "includeArchived") === true;

    const query: Query<ServiceLevelObjective> = {};
    if (!includeArchived) {
      query.isArchived = false;
    }
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
          isArchived: true,
          sliType: true,
          targetPercentage: true,
          windowType: true,
          windowDays: true,
          sloStatus: true,
          currentSliPercentage: true,
          errorBudgetRemainingPercentage: true,
          currentBurnRate: true,
          currentErrorBudgetPolicyTierName: true,
          deploymentsAllowed: true,
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
        // only archived rows carry the flag; the serializer drops undefined.
        isArchived: slo.isArchived === true ? true : undefined,
        sliType: slo.sliType,
        targetPercentage: slo.targetPercentage,
        window: describeWindow(slo),
        monitors: joinNames(slo.monitors) || undefined,
        sloStatus: slo.sloStatus,
        currentSliPercentage: slo.currentSliPercentage,
        errorBudgetRemainingPercentage: slo.errorBudgetRemainingPercentage,
        currentBurnRate: slo.currentBurnRate,
        // Only an SLO in a tier carries it; the serializer drops undefined.
        currentErrorBudgetPolicyTier:
          slo.currentErrorBudgetPolicyTierName || undefined,
        // Every row answers: only false is a freeze.
        deploymentsAllowed: slo.deploymentsAllowed !== false,
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
      prefix += DEPLOYMENT_GATE_NOTE;
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
                { key: "name", title: translationKey("Name"), type: "text" },
                {
                  key: "targetPercentage",
                  title: translationKey("Target %"),
                  type: "number",
                },
                {
                  key: "window",
                  title: translationKey("Window"),
                  type: "text",
                },
                {
                  key: "currentSliPercentage",
                  title: translationKey("Current SLI %"),
                  type: "number",
                },
                {
                  key: "errorBudgetRemainingPercentage",
                  title: translationKey("Budget left %"),
                  type: "number",
                },
                {
                  key: "currentBurnRate",
                  title: translationKey("Burn rate"),
                  type: "number",
                },
                {
                  key: "sloStatus",
                  title: translationKey("Status"),
                  type: "text",
                },
              ],
              rows: rows,
              link: { type: AIChatCitationTargetType.Slos },
            })
          : undefined,
    };
  },
};
