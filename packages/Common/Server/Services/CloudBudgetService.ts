import Model from "../../Models/DatabaseModels/CloudBudget";
import {
  CLOUD_BUDGET_UNUSUAL_DAY_MAX_PERCENT,
  CloudBudgetPeriod,
  CloudBudgetPlanSplit,
  CloudBudgetScope,
  CloudBudgetUnusualDayUnit,
  isCloudBudgetPeriod,
  isCloudBudgetPlanSplit,
  isCloudBudgetScope,
  isCloudBudgetUnusualDayUnit,
  readCloudBudgetMonthlyPlan,
  readCloudBudgetPeriod,
  readCloudBudgetPlanSplit,
  sumCloudBudgetPlan,
} from "../../Types/Cloud/CloudBudget";
import { readCloudBudgetThresholds } from "../../Types/Cloud/CloudCost";
import {
  CloudCostRule,
  readCloudCostRules,
} from "../../Types/Cloud/CloudCostRules";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import CreateBy from "../Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import UpdateBy from "../Types/Database/UpdateBy";
import { JsonReferenceColumn } from "../Utils/Database/ProjectReferenceCheck";
import RelationIdUtil from "../Utils/Database/RelationIdUtil";
import logger from "../Utils/Logger";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import { Service as CloudCostGroupServiceClass } from "./CloudCostGroupService";
import ProjectReferencesService from "./ProjectReferencesService";

/*
 * Budgets for what the connected clouds cost (CloudBudget, #11008). This
 * guards a budget as it is written:
 *
 *   - an amount above zero, a currency code, the thresholds as whole
 *     percents;
 *   - a scope with what it needs - an account, a cost group, a filter that
 *     reads as a cost group's rules - and nothing another scope needs, so a
 *     budget never names an account it does not count. A write that names
 *     no scope takes the one its other columns say: a script that sends an
 *     account makes that account's budget, as it did before scopes;
 *   - a period, a fiscal year's first month from 1 to 12, and a plan only
 *     for a yearly budget - a month or a quarter is never split - with
 *     twelve monthly amounts for one typed by month, whose total becomes
 *     the budget's amount;
 *   - its own unusual day: a threshold above zero, an amount or a percent;
 *   - every record its filter names is the project's (getJsonReferenceColumns,
 *     as a cost group's rules are), as are its account, its cost group and
 *     the people and teams it tells (ProjectReferencesService).
 *
 * Once saved, it is compared with what its scope costs, so its page says how
 * far it is at once (CloudBudgetEvaluator). The evaluator raises its alerts
 * and tells its people.
 */

export const CLOUD_BUDGET_AMOUNT_ERROR: string =
  "The amount must be a number greater than 0.";
export const CLOUD_BUDGET_CURRENCY_ERROR: string =
  "The currency must be a three-letter code such as USD or EUR.";
export const CLOUD_BUDGET_SCOPE_ERROR: string =
  "Choose what the budget counts: allAccounts, account, costGroup or filter.";
export const CLOUD_BUDGET_ACCOUNT_ERROR: string =
  "Choose the account this budget is for, or make it a budget for every account.";
export const CLOUD_BUDGET_COST_GROUP_ERROR: string =
  "Choose the cost group this budget is for. Cost groups are made under Cloud > Spend > Cost Groups.";
export const CLOUD_BUDGET_FILTER_ERROR: string =
  "Add at least one condition to the filter: the services, Regions or tags this budget counts.";
export const CLOUD_BUDGET_PERIOD_ERROR: string =
  "Choose the budget's period: month, quarter or year.";
export const CLOUD_BUDGET_FISCAL_YEAR_ERROR: string =
  "The fiscal year's first month must be a whole number from 1 (January) to 12 (December).";
export const CLOUD_BUDGET_PLAN_SPLIT_ERROR: string =
  "Choose how the year is planned: none, equal or byMonth.";
export const CLOUD_BUDGET_MONTHLY_PLAN_ERROR: string =
  "A plan by month needs twelve amounts of zero or more, one for each month from the fiscal year's first, and at least one above zero.";
export const CLOUD_BUDGET_UNUSUAL_DAY_ERROR: string = `An unusual day's threshold must be a number greater than 0: an amount, or a percent of the usual day up to ${CLOUD_BUDGET_UNUSUAL_DAY_MAX_PERCENT}.`;
export const CLOUD_BUDGET_UNUSUAL_DAY_UNIT_ERROR: string =
  "Say what the unusual day's threshold is: amount or percent.";

// A currency as ISO 4217 writes one: three letters.
const CURRENCY_CODE: RegExp = /^[A-Z]{3}$/;

// A budget's account and cost group, by their ID columns and their relations.
const ACCOUNT_KEYS: Array<string> = ["cloudAccountId", "cloudAccount"];
const COST_GROUP_KEYS: Array<string> = ["cloudCostGroupId", "cloudCostGroup"];

// The columns a budget's scope, period and plan are read from.
const SHAPE_KEYS: Array<string> = [
  "scope",
  ...ACCOUNT_KEYS,
  ...COST_GROUP_KEYS,
  "filterRules",
  "period",
  "planSplit",
  "monthlyPlan",
  "monthlyAmount",
];

// What decides a budget's shape: as written, or as stored where not written.
export interface CloudBudgetShape {
  scope: CloudBudgetScope;
  cloudAccountId: ObjectID | null;
  cloudCostGroupId: ObjectID | null;
  filterRules: Array<CloudCostRule> | null;
  period: CloudBudgetPeriod;
  planSplit: CloudBudgetPlanSplit;
  monthlyPlan: Array<number> | null;
}

export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  protected override getJsonReferenceColumns(): Array<JsonReferenceColumn> {
    // A filter names records as a cost group's rules do: each the project's.
    return [
      {
        column: "filterRules",
        getReferences: CloudCostGroupServiceClass.getRuleReferences,
      },
    ];
  }

  // An amount as a number above zero; a form's number field sends text.
  public normalizeAmount(value: unknown): number {
    const amount: number =
      typeof value === "string"
        ? value.trim() === ""
          ? Number.NaN
          : Number(value.trim())
        : typeof value === "number"
          ? value
          : Number.NaN;

    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadDataException(CLOUD_BUDGET_AMOUNT_ERROR);
    }

    return amount;
  }

  public normalizeCurrency(value: unknown): string {
    const currency: string =
      typeof value === "string" ? value.trim().toUpperCase() : "";

    if (!CURRENCY_CODE.test(currency)) {
      throw new BadDataException(CLOUD_BUDGET_CURRENCY_ERROR);
    }

    return currency;
  }

  // The thresholds as stored: whole percents, lowest first, "80,100".
  public normalizeThresholds(value: unknown): string {
    return readCloudBudgetThresholds(value).join(",");
  }

  public normalizeFiscalYearStartMonth(value: unknown): number {
    const month: number =
      typeof value === "string" && value.trim() !== ""
        ? Number(value.trim())
        : typeof value === "number"
          ? value
          : Number.NaN;

    if (!Number.isInteger(month) || month < 1 || month > 12) {
      throw new BadDataException(CLOUD_BUDGET_FISCAL_YEAR_ERROR);
    }

    return month;
  }

  /*
   * A budget's own unusual day, as stored: a threshold above zero in its
   * unit (an amount unless it says percent, and a percent at most ten
   * times the usual day), or none at all.
   */
  public normalizeUnusualDay(data: { threshold: unknown; unit: unknown }): {
    threshold: number | null;
    unit: CloudBudgetUnusualDayUnit | null;
  } {
    if (
      data.threshold === null ||
      data.threshold === undefined ||
      (typeof data.threshold === "string" && data.threshold.trim() === "")
    ) {
      return { threshold: null, unit: null };
    }

    const threshold: number =
      typeof data.threshold === "string"
        ? Number(data.threshold.trim())
        : typeof data.threshold === "number"
          ? data.threshold
          : Number.NaN;

    if (!Number.isFinite(threshold) || threshold <= 0) {
      throw new BadDataException(CLOUD_BUDGET_UNUSUAL_DAY_ERROR);
    }

    if (
      data.unit !== null &&
      data.unit !== undefined &&
      data.unit !== "" &&
      !isCloudBudgetUnusualDayUnit(data.unit)
    ) {
      throw new BadDataException(CLOUD_BUDGET_UNUSUAL_DAY_UNIT_ERROR);
    }

    const unit: CloudBudgetUnusualDayUnit = isCloudBudgetUnusualDayUnit(
      data.unit,
    )
      ? data.unit
      : CloudBudgetUnusualDayUnit.Amount;

    if (
      unit === CloudBudgetUnusualDayUnit.Percent &&
      threshold > CLOUD_BUDGET_UNUSUAL_DAY_MAX_PERCENT
    ) {
      throw new BadDataException(CLOUD_BUDGET_UNUSUAL_DAY_ERROR);
    }

    return { threshold, unit };
  }

  /*
   * The scope a write means: the one it names, else the one its other
   * columns say - a cost group, a filter, an account - else every account.
   */
  public static inferScope(data: {
    scope: unknown;
    cloudAccountId: ObjectID | null;
    cloudCostGroupId: ObjectID | null;
    filterRules: unknown;
  }): CloudBudgetScope {
    if (data.scope !== undefined && data.scope !== null && data.scope !== "") {
      if (!isCloudBudgetScope(data.scope)) {
        throw new BadDataException(CLOUD_BUDGET_SCOPE_ERROR);
      }

      return data.scope;
    }

    if (data.cloudCostGroupId) {
      return CloudBudgetScope.CostGroup;
    }

    if (Array.isArray(data.filterRules) && data.filterRules.length > 0) {
      return CloudBudgetScope.Filter;
    }

    return data.cloudAccountId
      ? CloudBudgetScope.Account
      : CloudBudgetScope.AllAccounts;
  }

  /*
   * A budget's shape checked as a whole: what its scope needs is there,
   * its filter reads, its plan suits its period. Returns the shape to
   * store: another scope's columns cleared, a month or a quarter unsplit.
   */
  public static checkShape(shape: {
    scope: CloudBudgetScope;
    cloudAccountId: ObjectID | null;
    cloudCostGroupId: ObjectID | null;
    filterRules: unknown;
    period: unknown;
    planSplit: unknown;
    monthlyPlan: unknown;
  }): CloudBudgetShape {
    if (shape.scope === CloudBudgetScope.Account && !shape.cloudAccountId) {
      throw new BadDataException(CLOUD_BUDGET_ACCOUNT_ERROR);
    }

    if (shape.scope === CloudBudgetScope.CostGroup && !shape.cloudCostGroupId) {
      throw new BadDataException(CLOUD_BUDGET_COST_GROUP_ERROR);
    }

    let filterRules: Array<CloudCostRule> | null = null;

    if (shape.scope === CloudBudgetScope.Filter) {
      // Refused with what to fix when the rules do not read.
      filterRules = readCloudCostRules(shape.filterRules);

      if (
        !filterRules.some((rule: CloudCostRule): boolean => {
          return rule.conditions.length > 0;
        })
      ) {
        throw new BadDataException(CLOUD_BUDGET_FILTER_ERROR);
      }
    }

    if (
      shape.period !== undefined &&
      shape.period !== null &&
      !isCloudBudgetPeriod(shape.period)
    ) {
      throw new BadDataException(CLOUD_BUDGET_PERIOD_ERROR);
    }

    if (
      shape.planSplit !== undefined &&
      shape.planSplit !== null &&
      !isCloudBudgetPlanSplit(shape.planSplit)
    ) {
      throw new BadDataException(CLOUD_BUDGET_PLAN_SPLIT_ERROR);
    }

    const period: CloudBudgetPeriod = readCloudBudgetPeriod(shape.period);
    // A month or a quarter is never split: its amount is the period's.
    const planSplit: CloudBudgetPlanSplit =
      period === CloudBudgetPeriod.Year
        ? readCloudBudgetPlanSplit(shape.planSplit)
        : CloudBudgetPlanSplit.None;
    let monthlyPlan: Array<number> | null = null;

    if (planSplit === CloudBudgetPlanSplit.ByMonth) {
      monthlyPlan = readCloudBudgetMonthlyPlan(shape.monthlyPlan);

      if (!monthlyPlan || sumCloudBudgetPlan(monthlyPlan) <= 0) {
        throw new BadDataException(CLOUD_BUDGET_MONTHLY_PLAN_ERROR);
      }
    } else if (shape.monthlyPlan !== undefined && shape.monthlyPlan !== null) {
      // Kept while not used, so a switch back to it finds the months typed.
      monthlyPlan = readCloudBudgetMonthlyPlan(shape.monthlyPlan);
    }

    return {
      scope: shape.scope,
      cloudAccountId:
        shape.scope === CloudBudgetScope.Account ? shape.cloudAccountId : null,
      cloudCostGroupId:
        shape.scope === CloudBudgetScope.CostGroup
          ? shape.cloudCostGroupId
          : null,
      filterRules,
      period,
      planSplit,
      monthlyPlan,
    };
  }

  // A checked shape written into a create's or an update's data.
  private static writeShape(
    data: Record<string, unknown>,
    shape: CloudBudgetShape,
  ): void {
    data["scope"] = shape.scope;
    RelationIdUtil.stamp(data, ACCOUNT_KEYS, shape.cloudAccountId);
    RelationIdUtil.stamp(data, COST_GROUP_KEYS, shape.cloudCostGroupId);
    data["filterRules"] = shape.filterRules;
    data["period"] = shape.period;
    data["planSplit"] = shape.planSplit;
    data["monthlyPlan"] = shape.monthlyPlan;

    // A plan by month's total is the budget's amount for the year.
    if (shape.monthlyPlan && shape.planSplit === CloudBudgetPlanSplit.ByMonth) {
      data["monthlyAmount"] = sumCloudBudgetPlan(shape.monthlyPlan);
    }
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    await super.onBeforeCreate(createBy);

    const data: Record<string, unknown> = createBy.data as unknown as Record<
      string,
      unknown
    >;
    const cloudAccountId: ObjectID | null = RelationIdUtil.readIntoIdColumn(
      data,
      ACCOUNT_KEYS,
      "Cloud Account",
    );
    const cloudCostGroupId: ObjectID | null = RelationIdUtil.readIntoIdColumn(
      data,
      COST_GROUP_KEYS,
      "Cloud Cost Group",
    );
    const shape: CloudBudgetShape = Service.checkShape({
      scope: Service.inferScope({
        scope: data["scope"],
        cloudAccountId,
        cloudCostGroupId,
        filterRules: data["filterRules"],
      }),
      cloudAccountId,
      cloudCostGroupId,
      filterRules: data["filterRules"],
      period: data["period"],
      planSplit: data["planSplit"],
      monthlyPlan: data["monthlyPlan"],
    });

    Service.writeShape(data, shape);

    createBy.data.monthlyAmount = this.normalizeAmount(
      createBy.data.monthlyAmount as unknown,
    );

    if (createBy.data.currency !== undefined) {
      createBy.data.currency = this.normalizeCurrency(createBy.data.currency);
    }

    if (createBy.data.alertThresholds !== undefined) {
      createBy.data.alertThresholds = this.normalizeThresholds(
        createBy.data.alertThresholds,
      );
    }

    if (
      createBy.data.fiscalYearStartMonth !== undefined &&
      createBy.data.fiscalYearStartMonth !== null
    ) {
      createBy.data.fiscalYearStartMonth = this.normalizeFiscalYearStartMonth(
        createBy.data.fiscalYearStartMonth,
      );
    }

    const unusualDay: {
      threshold: number | null;
      unit: CloudBudgetUnusualDayUnit | null;
    } = this.normalizeUnusualDay({
      threshold: createBy.data.unusualDayThreshold,
      unit: createBy.data.unusualDayThresholdUnit,
    });

    data["unusualDayThreshold"] = unusualDay.threshold;
    data["unusualDayThresholdUnit"] = unusualDay.unit;

    return { createBy, carryForward: null };
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    await super.onBeforeUpdate(updateBy);

    const data: Record<string, unknown> = updateBy.data as unknown as Record<
      string,
      unknown
    >;

    // Each only when the request sent it: an edit of the name leaves the rest.
    if (
      updateBy.data.monthlyAmount !== undefined &&
      updateBy.data.monthlyAmount !== null
    ) {
      updateBy.data.monthlyAmount = this.normalizeAmount(
        updateBy.data.monthlyAmount as unknown,
      );
    }

    if (
      updateBy.data.currency !== undefined &&
      updateBy.data.currency !== null
    ) {
      updateBy.data.currency = this.normalizeCurrency(updateBy.data.currency);
    }

    if (
      updateBy.data.alertThresholds !== undefined &&
      updateBy.data.alertThresholds !== null
    ) {
      updateBy.data.alertThresholds = this.normalizeThresholds(
        updateBy.data.alertThresholds,
      );
    }

    if (
      updateBy.data.fiscalYearStartMonth !== undefined &&
      updateBy.data.fiscalYearStartMonth !== null
    ) {
      updateBy.data.fiscalYearStartMonth = this.normalizeFiscalYearStartMonth(
        updateBy.data.fiscalYearStartMonth,
      );
    }

    if (
      data["unusualDayThreshold"] !== undefined ||
      data["unusualDayThresholdUnit"] !== undefined
    ) {
      const unusualDay: {
        threshold: number | null;
        unit: CloudBudgetUnusualDayUnit | null;
      } = this.normalizeUnusualDay({
        threshold: data["unusualDayThreshold"],
        unit: data["unusualDayThresholdUnit"],
      });

      data["unusualDayThreshold"] = unusualDay.threshold;
      data["unusualDayThresholdUnit"] = unusualDay.unit;
    }

    if (
      SHAPE_KEYS.some((key: string): boolean => {
        return data[key] !== undefined;
      })
    ) {
      await this.checkUpdatedShape(updateBy, data);
    }

    return { updateBy, carryForward: null };
  }

  /*
   * An update that changes what a budget counts, its period or its plan:
   * each budget it writes, as it would be once written - what the update
   * sends over what is stored - checked as a whole.
   */
  private async checkUpdatedShape(
    updateBy: UpdateBy<Model>,
    data: Record<string, unknown>,
  ): Promise<void> {
    const sentAccountId: ObjectID | null = RelationIdUtil.readIntoIdColumn(
      data,
      ACCOUNT_KEYS,
      "Cloud Account",
    );
    const sentCostGroupId: ObjectID | null = RelationIdUtil.readIntoIdColumn(
      data,
      COST_GROUP_KEYS,
      "Cloud Cost Group",
    );
    const sends: (keys: Array<string>) => boolean = (
      keys: Array<string>,
    ): boolean => {
      return RelationIdUtil.isPresent(data, keys);
    };

    const budgets: Array<Model> = await this.findRowsAndHoldUpdateToThem(
      updateBy,
      {
        _id: true,
        scope: true,
        cloudAccountId: true,
        cloudCostGroupId: true,
        filterRules: true,
        period: true,
        planSplit: true,
        monthlyPlan: true,
      },
    );

    let written: CloudBudgetShape | null = null;

    for (const budget of budgets) {
      const cloudAccountId: ObjectID | null = sends(ACCOUNT_KEYS)
        ? sentAccountId
        : budget.cloudAccountId || null;
      const cloudCostGroupId: ObjectID | null = sends(COST_GROUP_KEYS)
        ? sentCostGroupId
        : budget.cloudCostGroupId || null;
      const filterRules: unknown =
        data["filterRules"] !== undefined
          ? data["filterRules"]
          : budget.filterRules;
      const scope: CloudBudgetScope =
        data["scope"] !== undefined
          ? Service.inferScope({
              scope: data["scope"],
              cloudAccountId,
              cloudCostGroupId,
              filterRules,
            })
          : Service.inferScope({
              /*
               * Not written: the stored scope, unless the write names
               * another scope's record - an account sent to an every-account
               * budget makes it that account's, as before scopes.
               */
              scope:
                (sends(ACCOUNT_KEYS) && sentAccountId) ||
                (sends(COST_GROUP_KEYS) && sentCostGroupId) ||
                (data["filterRules"] !== undefined &&
                  Array.isArray(data["filterRules"]) &&
                  (data["filterRules"] as Array<unknown>).length > 0)
                  ? undefined
                  : budget.scope,
              cloudAccountId,
              cloudCostGroupId,
              filterRules,
            });

      written = Service.checkShape({
        scope,
        cloudAccountId,
        cloudCostGroupId,
        filterRules,
        period: data["period"] !== undefined ? data["period"] : budget.period,
        planSplit:
          data["planSplit"] !== undefined
            ? data["planSplit"]
            : budget.planSplit,
        monthlyPlan:
          data["monthlyPlan"] !== undefined
            ? data["monthlyPlan"]
            : budget.monthlyPlan,
      });
    }

    /*
     * One update writes one set of values into every budget it names: the
     * shape of the last one checked, every one of them checked the same.
     */
    if (written) {
      Service.writeShape(data, written);
    }
  }

  @CaptureSpan()
  protected override async onCreateSuccess(
    _onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    if (createdItem.id) {
      this.evaluateSoon(createdItem.id);
    }

    return createdItem;
  }

  @CaptureSpan()
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<Model>> {
    for (const id of updatedItemIds) {
      this.evaluateSoon(id);
    }

    return onUpdate;
  }

  /*
   * Compared with what its scope costs right after the write, without making
   * the write wait: a failure is logged, and the hourly evaluation catches
   * up. The evaluator is loaded when it is needed: it reads this service,
   * so a static import would be a cycle.
   */
  private evaluateSoon(budgetId: ObjectID): void {
    const evaluate: () => Promise<void> = async (): Promise<void> => {
      const evaluator: typeof import("../Utils/CloudConnection/CloudBudgetEvaluator") =
        await import("../Utils/CloudConnection/CloudBudgetEvaluator");
      await evaluator.default.evaluateBudgetById(budgetId);
    };

    evaluate().catch((error: unknown) => {
      logger.error(
        `Cloud budget ${budgetId.toString()} could not be checked after it was saved: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    });
  }
}

export default new Service();
