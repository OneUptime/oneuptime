import Alert from "../../../Models/DatabaseModels/Alert";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import LlmCostBudget from "../../../Models/DatabaseModels/LlmCostBudget";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import Span from "../../../Models/AnalyticsModels/Span";
import AggregatedModel from "../../../Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "../../../Types/BaseDatabase/AggregatedResult";
import AggregationInterval from "../../../Types/BaseDatabase/AggregationInterval";
import AggregationType from "../../../Types/BaseDatabase/AggregationType";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import Query from "../../../Types/BaseDatabase/Query";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import LIMIT_MAX, { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import ObjectID from "../../../Types/ObjectID";
import { DisableAutomaticAlertCreation } from "../../EnvironmentConfig";
import AggregateBy from "../../Types/AnalyticsDatabase/AggregateBy";
import AlertService from "../../Services/AlertService";
import AlertSeverityService from "../../Services/AlertSeverityService";
import LlmCostBudgetService, {
  LlmCostBudgetAlertKind,
} from "../../Services/LlmCostBudgetService";
import SpanService from "../../Services/SpanService";
import logger, { LogAttributes } from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";

/*
 * Evaluates LLM cost budgets against the day's LLM span spend.
 *
 * The worker job (App/FeatureSet/Workers/Jobs/Llm/EvaluateLlmCostBudgets.ts)
 * calls evaluateAllBudgets() on a 15-minute tick. For each enabled budget it
 * sums the UTC day's llmCost from ClickHouse (scoped by the budget's optional
 * service / provider / model filters), stamps the spend back onto the budget
 * row for the dashboard, and raises a warning alert at the configured
 * threshold and a breach alert at 100% — each at most once per UTC day, via
 * the lastWarningAlertCreatedAt / lastBreachAlertCreatedAt state columns plus
 * an open-alert fingerprint check.
 *
 * The threshold decision itself is a pure function (decide) so the alerting
 * semantics are unit-testable without a database.
 */

export interface LlmCostBudgetDecisionInput {
  // The day's spend so far, in USD.
  spendInUSD: number;
  dailyBudgetInUSD: number;
  // Warning threshold in percent (1-99). Invalid values fall back to 80.
  warningThresholdPercent: number | undefined;
  lastWarningAlertCreatedAt: Date | undefined;
  lastBreachAlertCreatedAt: Date | undefined;
  now: Date;
}

export interface LlmCostBudgetDecision {
  // Percent of the daily budget consumed (0 when the budget is invalid).
  percentUsed: number;
  shouldFireWarning: boolean;
  shouldFireBreach: boolean;
}

export const DEFAULT_WARNING_THRESHOLD_PERCENT: number = 80;

export default class LlmCostBudgetEvaluator {
  /**
   * Pure threshold decision. Breach (>= 100%) supersedes warning — a call
   * that jumps straight past the budget raises one breach alert, not two
   * alerts. Each kind fires at most once per UTC day, keyed off the
   * last-created timestamps the caller persists after firing.
   */
  public static decide(
    input: LlmCostBudgetDecisionInput,
  ): LlmCostBudgetDecision {
    const decision: LlmCostBudgetDecision = {
      percentUsed: 0,
      shouldFireWarning: false,
      shouldFireBreach: false,
    };

    if (
      !isFinite(input.dailyBudgetInUSD) ||
      input.dailyBudgetInUSD <= 0 ||
      !isFinite(input.spendInUSD) ||
      input.spendInUSD < 0
    ) {
      return decision;
    }

    decision.percentUsed = (input.spendInUSD / input.dailyBudgetInUSD) * 100;

    let warningThresholdPercent: number =
      input.warningThresholdPercent ?? DEFAULT_WARNING_THRESHOLD_PERCENT;

    if (
      !isFinite(warningThresholdPercent) ||
      warningThresholdPercent < 1 ||
      warningThresholdPercent > 99
    ) {
      warningThresholdPercent = DEFAULT_WARNING_THRESHOLD_PERCENT;
    }

    const alreadyWarnedToday: boolean = this.isSameUtcDay(
      input.lastWarningAlertCreatedAt,
      input.now,
    );
    const alreadyBreachedToday: boolean = this.isSameUtcDay(
      input.lastBreachAlertCreatedAt,
      input.now,
    );

    if (decision.percentUsed >= 100) {
      decision.shouldFireBreach = !alreadyBreachedToday;
      return decision;
    }

    if (decision.percentUsed >= warningThresholdPercent) {
      decision.shouldFireWarning = !alreadyWarnedToday;
    }

    return decision;
  }

  /**
   * Start of the UTC day `now` falls in. UTC-explicit (not process-zone) so
   * the budget day is the same day everywhere OneUptime runs.
   */
  public static getUtcDayStart(now: Date): Date {
    return new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
  }

  /**
   * Whether two instants fall in the same UTC calendar day. False when the
   * first is undefined.
   */
  public static isSameUtcDay(a: Date | undefined, b: Date): boolean {
    if (!a) {
      return false;
    }

    return (
      a.getUTCFullYear() === b.getUTCFullYear() &&
      a.getUTCMonth() === b.getUTCMonth() &&
      a.getUTCDate() === b.getUTCDate()
    );
  }

  /**
   * Build the ClickHouse span filter for a budget: the UTC day so far,
   * LLM spans only, narrowed by the budget's optional service / provider /
   * model scoping.
   */
  public static buildSpanQuery(data: {
    budget: LlmCostBudget;
    dayStart: Date;
    now: Date;
  }): Query<Span> {
    const query: Query<Span> = {
      projectId: data.budget.projectId!,
      isLlmSpan: true,
      /*
       * Bound rows to the window — aggregateBy's startTimestamp/endTimestamp
       * only pick the bucket grid, they do not filter rows.
       */
      startTime: new InBetween(data.dayStart, data.now),
    } as Query<Span>;

    if (data.budget.serviceId) {
      (query as Record<string, unknown>)["primaryEntityId"] =
        data.budget.serviceId;
    }

    if (data.budget.llmSystem) {
      (query as Record<string, unknown>)["llmSystem"] = data.budget.llmSystem;
    }

    if (data.budget.llmModel) {
      (query as Record<string, unknown>)["llmRequestModel"] =
        data.budget.llmModel;
    }

    return query;
  }

  /**
   * Evaluate every enabled budget. One bad budget never aborts the sweep.
   */
  @CaptureSpan()
  public static async evaluateAllBudgets(): Promise<void> {
    const budgets: Array<LlmCostBudget> = await LlmCostBudgetService.findBy({
      query: {
        isEnabled: true,
      },
      select: {
        _id: true,
        projectId: true,
        name: true,
        dailyBudgetInUSD: true,
        warningThresholdPercent: true,
        serviceId: true,
        llmSystem: true,
        llmModel: true,
        alertSeverityId: true,
        onCallDutyPolicies: {
          _id: true,
        },
        lastWarningAlertCreatedAt: true,
        lastBreachAlertCreatedAt: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    if (budgets.length === 0) {
      return;
    }

    logger.debug(
      `Llm:EvaluateLlmCostBudgets: evaluating ${budgets.length} enabled budget(s)`,
    );

    const now: Date = new Date();

    for (const budget of budgets) {
      try {
        await this.evaluateBudget({ budget, now });
      } catch (err) {
        logger.error(
          `LLM cost budget ${budget.id?.toString()} for project ${budget.projectId?.toString() ?? "?"} failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
          { projectId: budget.projectId?.toString() } as LogAttributes,
        );
      }
    }
  }

  /**
   * Evaluate one budget: sum the day's spend, stamp it on the row, and fire
   * whichever threshold alert the decision calls for.
   */
  @CaptureSpan()
  public static async evaluateBudget(data: {
    budget: LlmCostBudget;
    now: Date;
  }): Promise<void> {
    const budget: LlmCostBudget = data.budget;

    if (!budget.id || !budget.projectId || !budget.dailyBudgetInUSD) {
      return;
    }

    const dayStart: Date = this.getUtcDayStart(data.now);

    const spendInUSD: number = await this.getSpendInUSD({
      budget: budget,
      dayStart: dayStart,
      now: data.now,
    });

    const decision: LlmCostBudgetDecision = this.decide({
      spendInUSD: spendInUSD,
      dailyBudgetInUSD: budget.dailyBudgetInUSD,
      warningThresholdPercent: budget.warningThresholdPercent,
      lastWarningAlertCreatedAt: budget.lastWarningAlertCreatedAt,
      lastBreachAlertCreatedAt: budget.lastBreachAlertCreatedAt,
      now: data.now,
    });

    // Stamp the spend for the dashboard even when nothing fires.
    await LlmCostBudgetService.updateOneById({
      id: budget.id,
      data: {
        currentDaySpendInUSD: spendInUSD,
        spendLastEvaluatedAt: data.now,
      },
      props: {
        isRoot: true,
      },
    });

    if (decision.shouldFireBreach) {
      const created: boolean = await this.createBudgetAlert({
        budget: budget,
        kind: "breach",
        spendInUSD: spendInUSD,
        percentUsed: decision.percentUsed,
      });

      if (created) {
        await LlmCostBudgetService.updateOneById({
          id: budget.id,
          data: {
            lastBreachAlertCreatedAt: data.now,
          },
          props: {
            isRoot: true,
          },
        });
      }

      return;
    }

    if (decision.shouldFireWarning) {
      const created: boolean = await this.createBudgetAlert({
        budget: budget,
        kind: "warning",
        spendInUSD: spendInUSD,
        percentUsed: decision.percentUsed,
      });

      if (created) {
        await LlmCostBudgetService.updateOneById({
          id: budget.id,
          data: {
            lastWarningAlertCreatedAt: data.now,
          },
          props: {
            isRoot: true,
          },
        });
      }
    }
  }

  /**
   * Sum the day's llmCost for the budget's scope from ClickHouse.
   */
  @CaptureSpan()
  private static async getSpendInUSD(data: {
    budget: LlmCostBudget;
    dayStart: Date;
    now: Date;
  }): Promise<number> {
    const aggregateBy: AggregateBy<Span> = {
      query: this.buildSpanQuery(data),
      aggregationType: AggregationType.Sum,
      aggregateColumnName: "llmCost",
      aggregationTimestampColumnName: "startTime",
      startTimestamp: data.dayStart,
      endTimestamp: data.now,
      // One total over the whole window — no time bucketing.
      aggregationInterval: AggregationInterval.Total,
      /*
       * Alerting must fail loud on a query timeout: the default 'break'
       * overflow mode returns silently-partial sums, which would understate
       * spend and suppress a real budget breach.
       */
      timeoutOverflowMode: "throw",
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: {
        isRoot: true,
      },
    };

    const result: AggregatedResult = await SpanService.aggregateBy(aggregateBy);

    return (result.data || []).reduce(
      (acc: number, row: AggregatedModel): number => {
        return acc + Number(row.value || 0);
      },
      0,
    );
  }

  /**
   * Create the warning/breach alert for a budget. Returns true when an alert
   * was actually created (the caller stamps the per-day dedup timestamp only
   * then).
   */
  @CaptureSpan()
  private static async createBudgetAlert(data: {
    budget: LlmCostBudget;
    kind: LlmCostBudgetAlertKind;
    spendInUSD: number;
    percentUsed: number;
  }): Promise<boolean> {
    const budget: LlmCostBudget = data.budget;

    const fingerprint: string = LlmCostBudgetService.getBudgetAlertFingerprint({
      llmCostBudgetId: budget.id!,
      kind: data.kind,
    });

    // An open alert in the same series means on-call is already looking.
    const openAlert: Alert | null = await AlertService.findOneBy({
      query: {
        projectId: budget.projectId!,
        seriesFingerprint: fingerprint,
        currentAlertState: {
          isResolvedState: false,
        },
      },
      select: {
        _id: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (openAlert) {
      logger.debug(
        `Llm:EvaluateLlmCostBudgets: open ${data.kind} alert already exists for budget ${budget.id?.toString()}; skipping.`,
      );
      return false;
    }

    if (DisableAutomaticAlertCreation) {
      logger.debug(
        `Llm:EvaluateLlmCostBudgets: automatic alert creation is disabled; skipping ${data.kind} alert for budget ${budget.id?.toString()}.`,
      );
      return false;
    }

    let alertSeverityId: ObjectID | undefined = budget.alertSeverityId;

    if (!alertSeverityId) {
      const severity: AlertSeverity | null =
        await AlertSeverityService.findOneBy({
          query: {
            projectId: budget.projectId!,
          },
          sort: {
            order: SortOrder.Ascending,
          },
          select: {
            _id: true,
          },
          props: {
            isRoot: true,
          },
        });

      alertSeverityId = severity?.id || undefined;
    }

    if (!alertSeverityId) {
      logger.error(
        `Llm:EvaluateLlmCostBudgets - Cannot create ${data.kind} alert for budget ${budget.id?.toString()}: project has no alert severity.`,
        { projectId: budget.projectId?.toString() } as LogAttributes,
      );
      return false;
    }

    const spendFormatted: string = `$${data.spendInUSD.toFixed(2)}`;
    const budgetFormatted: string = `$${(budget.dailyBudgetInUSD || 0).toFixed(2)}`;
    const percentFormatted: string = `${Math.floor(data.percentUsed)}%`;

    const scopeParts: Array<string> = [];

    if (budget.llmSystem) {
      scopeParts.push(`provider ${budget.llmSystem}`);
    }

    if (budget.llmModel) {
      scopeParts.push(`model ${budget.llmModel}`);
    }

    const scopeSuffix: string =
      scopeParts.length > 0 ? ` (${scopeParts.join(", ")})` : "";

    const alert: Alert = new Alert();
    alert.projectId = budget.projectId!;

    if (data.kind === "breach") {
      alert.title = `LLM cost budget exceeded: ${budget.name}`;
      alert.description = `LLM spend${scopeSuffix} has reached ${spendFormatted} — ${percentFormatted} of the ${budgetFormatted} daily budget "${budget.name}". The daily budget is exhausted.`;
      alert.rootCause = `LLM spend crossed 100% of the daily cost budget "${budget.name}".`;
    } else {
      alert.title = `LLM cost budget warning: ${budget.name}`;
      alert.description = `LLM spend${scopeSuffix} has reached ${spendFormatted} — ${percentFormatted} of the ${budgetFormatted} daily budget "${budget.name}".`;
      alert.rootCause = `LLM spend crossed the ${budget.warningThresholdPercent ?? DEFAULT_WARNING_THRESHOLD_PERCENT}% warning threshold of the daily cost budget "${budget.name}".`;
    }

    alert.alertSeverityId = alertSeverityId;
    alert.seriesFingerprint = fingerprint;
    alert.isCreatedAutomatically = true;

    // On-call policy id-stubs, the MonitorAlert pattern.
    alert.onCallDutyPolicies = (budget.onCallDutyPolicies || [])
      .filter((policy: OnCallDutyPolicy) => {
        return Boolean(policy.id);
      })
      .map((policy: OnCallDutyPolicy) => {
        const policyStub: OnCallDutyPolicy = new OnCallDutyPolicy();
        policyStub._id = policy.id!.toString();
        return policyStub;
      });

    await AlertService.create({
      data: alert,
      props: {
        isRoot: true,
      },
    });

    return true;
  }
}
