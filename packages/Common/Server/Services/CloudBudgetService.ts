import Model from "../../Models/DatabaseModels/CloudBudget";
import { readCloudBudgetThresholds } from "../../Types/Cloud/CloudCost";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import CreateBy from "../Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import UpdateBy from "../Types/Database/UpdateBy";
import logger from "../Utils/Logger";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import ProjectReferencesService from "./ProjectReferencesService";

/*
 * A monthly budget for what the connected clouds cost (CloudBudget). This
 * guards the budget as it is written - an amount above zero, a currency
 * code, the thresholds as whole percents - and has the budget compared
 * with what its accounts cost once it is saved, so its page says how far
 * it is at once (CloudBudgetEvaluator). The evaluator raises its alerts.
 */

export const CLOUD_BUDGET_AMOUNT_ERROR: string =
  "The monthly amount must be a number greater than 0.";
export const CLOUD_BUDGET_CURRENCY_ERROR: string =
  "The currency must be a three-letter code such as USD or EUR.";

// A currency as ISO 4217 writes one: three letters.
const CURRENCY_CODE: RegExp = /^[A-Z]{3}$/;

export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
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

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    await super.onBeforeCreate(createBy);

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

    return { createBy, carryForward: null };
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    await super.onBeforeUpdate(updateBy);

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

    return { updateBy, carryForward: null };
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
   * Compared with its accounts' costs right after the write, without making
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
