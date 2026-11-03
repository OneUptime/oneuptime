import Alert from "../../../Models/DatabaseModels/Alert";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import AlertStateTimeline from "../../../Models/DatabaseModels/AlertStateTimeline";
import CloudAccount from "../../../Models/DatabaseModels/CloudAccount";
import CloudBudget from "../../../Models/DatabaseModels/CloudBudget";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import Includes from "../../../Types/BaseDatabase/Includes";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import {
  CloudAccountCostSummary,
  CloudCostState,
  getPassedCloudBudgetThresholds,
  readCloudAccountCostSummary,
  readCloudBudgetThresholds,
  toCloudBudgetMonth,
  daysInUtcMonth,
} from "../../../Types/Cloud/CloudCost";
import { getCloudProviderLabel } from "../../../Types/Cloud/CloudPlatform";
import LIMIT_MAX, { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import OneUptimeDate from "../../../Types/Date";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import AlertService from "../../Services/AlertService";
import AlertSeverityService from "../../Services/AlertSeverityService";
import AlertStateService from "../../Services/AlertStateService";
import AlertStateTimelineService from "../../Services/AlertStateTimelineService";
import CloudAccountService from "../../Services/CloudAccountService";
import CloudBudgetService from "../../Services/CloudBudgetService";
import logger from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";

/*
 * WATCHES A PROJECT'S CLOUD BUDGETS.
 *
 * Each enabled budget (CloudBudget) is compared with what its accounts cost
 * this month so far and are on course to cost - the accounts' cost
 * summaries, written after every read of their costs (CloudCostWriter), so
 * no query over the costs is made here. A budget raises an alert:
 *
 *   - the first time in a month the spend passes one of its thresholds
 *     (80% and 100% of the budget by default) - one alert, for the highest
 *     it passed, when a read finds it past several at once;
 *   - once a month, when the month is on course to pass the budget at the
 *     pace of the last full week while it has not yet: a warning before the
 *     money is spent.
 *
 * A budget's alerts are the alerts of the month they were raised in: when
 * the next month starts, the spend starts from nothing again, the open ones
 * are resolved and its thresholds may alert anew. Each alert carries a
 * fingerprint of its budget, month and threshold, so one is never raised
 * twice - whatever two workers do at once.
 *
 * Runs after a connection reads its costs (the project's budgets), every
 * hour (every budget: a month's end comes without a read) and after a
 * budget is saved (that budget).
 */

export interface CloudBudgetAlertState {
  // The month the alerts are of, "2026-11".
  month: string;
  // The thresholds passed and alerted this month, in percent.
  thresholds: Array<number>;
  // Whether the projection alerted this month.
  projection: boolean;
  // The alerts raised this month: resolved when the month is over.
  alertIds: Array<string>;
}

export type CloudBudgetAlertKind =
  | { kind: "threshold"; threshold: number }
  | { kind: "projection" };

export interface CloudBudgetSpend {
  spent: number;
  projected: number;
  // Accounts counted: read this month, in the budget's currency.
  accountsCounted: number;
  // Accounts read in another currency, left out.
  accountsInOtherCurrencies: number;
}

export interface CloudBudgetDecision {
  raise: Array<CloudBudgetAlertKind>;
  state: CloudBudgetAlertState;
  // Last month's alerts, to resolve.
  resolveAlertIds: Array<string>;
}

export function readCloudBudgetAlertState(
  value: unknown,
): CloudBudgetAlertState | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record: Record<string, unknown> = value as Record<string, unknown>;

  if (typeof record["month"] !== "string" || !record["month"]) {
    return null;
  }

  return {
    month: record["month"],
    thresholds: Array.isArray(record["thresholds"])
      ? (record["thresholds"] as Array<unknown>)
          .map((entry: unknown): number => {
            return Number(entry);
          })
          .filter((entry: number): boolean => {
            return Number.isFinite(entry);
          })
      : [],
    projection: record["projection"] === true,
    alertIds: Array.isArray(record["alertIds"])
      ? ((record["alertIds"] as Array<unknown>).filter(
          (entry: unknown): boolean => {
            return typeof entry === "string" && ObjectID.isValidUUID(entry);
          },
        ) as Array<string>)
      : [],
  };
}

// An amount as an alert says it: "$4,120.00", "4.120,00 €" left to English.
export function formatCloudBudgetAmount(
  amount: number,
  currency: string,
): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || "USD",
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

export default class CloudBudgetEvaluator {
  /*
   * What a budget's accounts spent this month and are on course to spend,
   * in its currency: an account whose costs were not read this month, or
   * are billed in another currency, is not counted.
   */
  public static computeSpend(data: {
    currency: string;
    summaries: Array<CloudAccountCostSummary | null>;
    now: Date;
  }): CloudBudgetSpend {
    const month: string = toCloudBudgetMonth(data.now);
    const spend: CloudBudgetSpend = {
      spent: 0,
      projected: 0,
      accountsCounted: 0,
      accountsInOtherCurrencies: 0,
    };

    for (const summary of data.summaries) {
      if (
        !summary ||
        summary.state !== CloudCostState.Reading ||
        !summary.readAt ||
        toCloudBudgetMonth(new Date(summary.readAt)) !== month
      ) {
        continue;
      }

      if (summary.currency.toUpperCase() !== data.currency.toUpperCase()) {
        spend.accountsInOtherCurrencies++;
        continue;
      }

      spend.accountsCounted++;
      spend.spent += summary.monthToDate;
      spend.projected += summary.projectedMonth;
    }

    spend.spent = Math.round(spend.spent * 100) / 100;
    spend.projected = Math.round(spend.projected * 100) / 100;

    return spend;
  }

  /*
   * What a budget does now: the alerts it raises - the highest threshold it
   * passed for the first time this month, and its projection when the month
   * is on course to pass it - and its state for the month.
   */
  public static decide(data: {
    amount: number;
    thresholds: Array<number>;
    alertOnProjection: boolean;
    spend: CloudBudgetSpend;
    state: CloudBudgetAlertState | null;
    now: Date;
  }): CloudBudgetDecision {
    const month: string = toCloudBudgetMonth(data.now);
    const isNewMonth: boolean = !data.state || data.state.month !== month;
    const resolveAlertIds: Array<string> =
      isNewMonth && data.state ? [...data.state.alertIds] : [];
    const state: CloudBudgetAlertState = isNewMonth
      ? { month, thresholds: [], projection: false, alertIds: [] }
      : {
          month,
          thresholds: [...data.state!.thresholds],
          projection: data.state!.projection,
          alertIds: [...data.state!.alertIds],
        };

    const raise: Array<CloudBudgetAlertKind> = [];

    // Nothing was read this month: nothing is known to have been spent.
    if (data.spend.accountsCounted === 0) {
      return { raise, state, resolveAlertIds };
    }

    const passed: Array<number> = getPassedCloudBudgetThresholds({
      spent: data.spend.spent,
      amount: data.amount,
      thresholds: data.thresholds,
    });
    const newlyPassed: Array<number> = passed.filter(
      (threshold: number): boolean => {
        return !state.thresholds.includes(threshold);
      },
    );

    if (newlyPassed.length > 0) {
      raise.push({
        kind: "threshold",
        threshold: newlyPassed[newlyPassed.length - 1]!,
      });
      state.thresholds = Array.from(
        new Set<number>([...state.thresholds, ...newlyPassed]),
      ).sort((a: number, b: number): number => {
        return a - b;
      });
    }

    if (
      data.alertOnProjection &&
      !state.projection &&
      data.amount > 0 &&
      data.spend.projected >= data.amount &&
      data.spend.spent < data.amount
    ) {
      raise.push({ kind: "projection" });
      state.projection = true;
    }

    return { raise, state, resolveAlertIds };
  }

  // The fingerprint an alert of a budget's month and threshold is kept apart by.
  public static getFingerprint(data: {
    budgetId: string;
    month: string;
    alert: CloudBudgetAlertKind;
  }): string {
    return `cloud-budget:${data.budgetId}:${data.month}:${
      data.alert.kind === "threshold"
        ? `threshold-${data.alert.threshold}`
        : "projection"
    }`;
  }

  // What an alert says: its title and its description, in English.
  public static describe(data: {
    budgetName: string;
    scope: string;
    amount: number;
    currency: string;
    spend: CloudBudgetSpend;
    alert: CloudBudgetAlertKind;
    now: Date;
  }): { title: string; description: string } {
    const amount: string = formatCloudBudgetAmount(data.amount, data.currency);
    const spent: string = formatCloudBudgetAmount(
      data.spend.spent,
      data.currency,
    );
    const projected: string = formatCloudBudgetAmount(
      data.spend.projected,
      data.currency,
    );
    const percent: number =
      data.amount > 0 ? Math.round((data.spend.spent / data.amount) * 100) : 0;
    const daysLeft: number = Math.max(
      0,
      daysInUtcMonth(data.now) - data.now.getUTCDate(),
    );

    if (data.alert.kind === "threshold") {
      return {
        title: `Cloud budget "${data.budgetName}" passed ${data.alert.threshold}%`,
        description: `This month's cloud spend for ${data.scope} is ${spent} of the ${amount} budget (${percent}%), with ${daysLeft} day${daysLeft === 1 ? "" : "s"} of the month to go. At the pace of the last full week, the month is on course for ${projected}.`,
      };
    }

    return {
      title: `Cloud budget "${data.budgetName}" is on course to be passed`,
      description: `At the pace of the last full week, this month's cloud spend for ${data.scope} is on course for ${projected}, over the ${amount} budget. ${spent} (${percent}%) is spent so far, with ${daysLeft} day${daysLeft === 1 ? "" : "s"} to go.`,
    };
  }

  @CaptureSpan()
  public static async evaluateBudgetById(budgetId: ObjectID): Promise<void> {
    const budget: CloudBudget | null = await CloudBudgetService.findOneById({
      id: budgetId,
      select: CloudBudgetEvaluator.BUDGET_SELECT,
      props: { isRoot: true },
    });

    if (budget) {
      await CloudBudgetEvaluator.evaluate(budget);
    }
  }

  // Every enabled budget of a project: after its accounts' costs are read.
  @CaptureSpan()
  public static async evaluateProject(projectId: ObjectID): Promise<number> {
    const budgets: Array<CloudBudget> = await CloudBudgetService.findBy({
      query: { projectId, isEnabled: true },
      select: CloudBudgetEvaluator.BUDGET_SELECT,
      skip: 0,
      limit: LIMIT_PER_PROJECT,
      props: { isRoot: true },
    });

    for (const budget of budgets) {
      await CloudBudgetEvaluator.evaluate(budget);
    }

    return budgets.length;
  }

  // Every enabled budget of every project: the hourly worker.
  @CaptureSpan()
  public static async evaluateAll(): Promise<number> {
    const budgets: Array<CloudBudget> = await CloudBudgetService.findBy({
      query: { isEnabled: true },
      select: CloudBudgetEvaluator.BUDGET_SELECT,
      skip: 0,
      limit: LIMIT_MAX,
      props: { isRoot: true },
    });

    for (const budget of budgets) {
      await CloudBudgetEvaluator.evaluate(budget);
    }

    return budgets.length;
  }

  private static readonly BUDGET_SELECT: {
    _id: true;
    projectId: true;
    name: true;
    isEnabled: true;
    cloudAccountId: true;
    monthlyAmount: true;
    currency: true;
    alertThresholds: true;
    alertOnProjection: true;
    alertSeverityId: true;
    alertState: true;
    onCallDutyPolicies: { _id: true };
  } = {
    _id: true,
    projectId: true,
    name: true,
    isEnabled: true,
    cloudAccountId: true,
    monthlyAmount: true,
    currency: true,
    alertThresholds: true,
    alertOnProjection: true,
    alertSeverityId: true,
    alertState: true,
    onCallDutyPolicies: { _id: true },
  };

  /*
   * One budget: its spend, its page's figures, the alerts it raises and
   * last month's it resolves. Never throws: one budget's trouble is logged
   * and never stops the others.
   */
  private static async evaluate(budget: CloudBudget): Promise<void> {
    if (!budget.id || !budget.projectId) {
      return;
    }

    try {
      const now: Date = OneUptimeDate.getCurrentDate();
      const accounts: Array<CloudAccount> = await CloudAccountService.findBy({
        query: budget.cloudAccountId
          ? { projectId: budget.projectId, _id: budget.cloudAccountId }
          : { projectId: budget.projectId },
        select: {
          _id: true,
          name: true,
          provider: true,
          accountId: true,
          costSummary: true,
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: { isRoot: true },
      });

      const currency: string = (budget.currency || "USD").toUpperCase();
      const spend: CloudBudgetSpend = CloudBudgetEvaluator.computeSpend({
        currency,
        summaries: accounts.map(
          (account: CloudAccount): CloudAccountCostSummary | null => {
            return readCloudAccountCostSummary(account.costSummary);
          },
        ),
        now,
      });

      const amount: number = Number(budget.monthlyAmount) || 0;
      const decision: CloudBudgetDecision = CloudBudgetEvaluator.decide({
        amount,
        thresholds: readCloudBudgetThresholds(budget.alertThresholds),
        alertOnProjection: budget.alertOnProjection !== false,
        spend,
        state: readCloudBudgetAlertState(budget.alertState),
        now,
      });

      for (const alertId of decision.resolveAlertIds) {
        await CloudBudgetEvaluator.resolveAlert({
          projectId: budget.projectId,
          alertId: new ObjectID(alertId),
        });
      }

      if (decision.raise.length > 0 && budget.isEnabled !== false) {
        const scope: string =
          budget.cloudAccountId && accounts[0]
            ? `the ${accounts[0].name || accounts[0].accountId} account (${getCloudProviderLabel(
                (accounts[0].provider as string) || "",
              )} ${accounts[0].accountId || ""})`
            : "every cloud account of the project";

        for (const alertKind of decision.raise) {
          const alertId: ObjectID | null = await CloudBudgetEvaluator.raise({
            budget,
            scope,
            amount,
            currency,
            spend,
            alert: alertKind,
            month: decision.state.month,
            now,
          });

          if (alertId) {
            decision.state.alertIds.push(alertId.toString());
          }
        }
      }

      await CloudBudgetService.updateOneById({
        id: budget.id,
        data: {
          spentThisMonth: spend.spent,
          projectedThisMonth: spend.projected,
          lastCheckedAt: now,
          alertState: decision.state as unknown as JSONObject,
        } as never,
        props: { isRoot: true, ignoreHooks: true },
      });
    } catch (error) {
      logger.error(
        `Cloud budget ${budget.id.toString()} could not be checked: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  // The severity of a budget's alerts: its own, else the project's least severe.
  private static async getSeverityId(
    budget: CloudBudget,
  ): Promise<ObjectID | null> {
    if (budget.alertSeverityId) {
      return budget.alertSeverityId;
    }

    const severity: AlertSeverity | null = await AlertSeverityService.findOneBy(
      {
        query: { projectId: budget.projectId! },
        select: { _id: true },
        sort: { order: SortOrder.Descending },
        props: { isRoot: true },
      },
    );

    return severity?.id || null;
  }

  /*
   * One alert, unless one of its fingerprint is open already (two workers
   * at once). Returns the alert's id, or null when none was raised.
   */
  private static async raise(data: {
    budget: CloudBudget;
    scope: string;
    amount: number;
    currency: string;
    spend: CloudBudgetSpend;
    alert: CloudBudgetAlertKind;
    month: string;
    now: Date;
  }): Promise<ObjectID | null> {
    const projectId: ObjectID = data.budget.projectId!;
    const fingerprint: string = CloudBudgetEvaluator.getFingerprint({
      budgetId: data.budget.id!.toString(),
      month: data.month,
      alert: data.alert,
    });

    const open: Array<Alert> = await AlertService.findBy({
      query: {
        projectId,
        seriesFingerprint: fingerprint,
        currentAlertStateId: new Includes(
          await AlertStateService.getUnresolvedAlertStateIds(projectId),
        ),
      },
      select: { _id: true },
      skip: 0,
      limit: 1,
      props: { isRoot: true },
    });

    if (open.length > 0) {
      return null;
    }

    const severityId: ObjectID | null =
      await CloudBudgetEvaluator.getSeverityId(data.budget);

    if (!severityId) {
      logger.error(
        `Cloud budget ${data.budget.id!.toString()}: the project has no alert severity, so its alert could not be raised.`,
      );
      return null;
    }

    const words: { title: string; description: string } =
      CloudBudgetEvaluator.describe({
        budgetName: data.budget.name || "Cloud budget",
        scope: data.scope,
        amount: data.amount,
        currency: data.currency,
        spend: data.spend,
        alert: data.alert,
        now: data.now,
      });

    const alert: Alert = new Alert();
    alert.projectId = projectId;
    alert.title = words.title;
    alert.description = words.description;
    alert.rootCause = words.description;
    alert.alertSeverityId = severityId;
    alert.seriesFingerprint = fingerprint;
    alert.isCreatedAutomatically = true;

    const policies: Array<OnCallDutyPolicy> = (
      data.budget.onCallDutyPolicies || []
    ).filter((policy: OnCallDutyPolicy): boolean => {
      return Boolean(policy.id);
    });

    if (policies.length > 0) {
      alert.onCallDutyPolicies = policies.map(
        (policy: OnCallDutyPolicy): OnCallDutyPolicy => {
          const stub: OnCallDutyPolicy = new OnCallDutyPolicy();
          stub.id = policy.id!;
          return stub;
        },
      );
    }

    const created: Alert = await AlertService.create({
      data: alert,
      props: { isRoot: true },
    });

    return created?.id || null;
  }

  // Resolves a last month's alert; one resolved already is left as it is.
  private static async resolveAlert(data: {
    projectId: ObjectID;
    alertId: ObjectID;
  }): Promise<void> {
    try {
      const timeline: AlertStateTimeline = new AlertStateTimeline();
      timeline.alertId = data.alertId;
      timeline.projectId = data.projectId;
      timeline.alertStateId =
        await AlertStateTimelineService.getResolvedStateIdForProject(
          data.projectId,
        );
      timeline.rootCause =
        "Resolved by OneUptime: the month this cloud budget alert was raised in is over.";

      await AlertStateTimelineService.create({
        data: timeline,
        props: { isRoot: true },
      });
    } catch (error) {
      if (
        error instanceof BadDataException &&
        error.message === "Alert state cannot be same as previous state."
      ) {
        return;
      }

      logger.error(
        `A cloud budget alert ${data.alertId.toString()} could not be resolved: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
