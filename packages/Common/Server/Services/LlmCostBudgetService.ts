import Model from "../../Models/DatabaseModels/LlmCostBudget";
import BadDataException from "../../Types/Exception/BadDataException";
import CreateBy from "../Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import UpdateBy from "../Types/Database/UpdateBy";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import DatabaseService from "./DatabaseService";

const BUDGET_ERROR_MESSAGE: string =
  "Daily budget must be a number greater than 0.";

/*
 * Budgets do not fire alerts themselves: the evaluation worker publishes each
 * budget's spend and percent-used as oneuptime.llm.budget.* metrics, and
 * Metrics monitors own the alerting (thresholds, anomaly baselines, on-call
 * routing). This service only guards the budget definition itself.
 */
export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    /*
     * Numeric columns can arrive as strings: the dashboard's number fields
     * hand Formik `e.target.value`, ModelForm copies it verbatim and
     * BaseModel.fromJSON does not coerce Number/Decimal columns. Coerce,
     * validate, then write the number back onto the payload so Postgres never
     * sees a string either. Same convention as
     * ServiceLevelObjectiveBurnRateRuleService.
     */
    createBy.data.dailyBudgetInUSD = this.validateDailyBudget(
      createBy.data.dailyBudgetInUSD,
    );

    return {
      createBy,
      carryForward: null,
    };
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    // Same string-arrival path as onBeforeCreate: coerce, validate, write back.
    const newBudget: unknown = updateBy.data.dailyBudgetInUSD as unknown;

    if (newBudget !== undefined && newBudget !== null) {
      updateBy.data.dailyBudgetInUSD = this.validateDailyBudget(newBudget);
    }

    return {
      updateBy,
      carryForward: null,
    };
  }

  /*
   * Coerce an API-supplied numeric column to a number. HTML number inputs hand
   * Formik strings and neither ModelForm nor BaseModel.fromJSON coerces
   * Number/Decimal columns, so "100" reaches these hooks as a string — and
   * string comparison is lexicographic. Anything that is not a finite numeric
   * string or number becomes NaN, which the caller below rejects.
   */
  private normalizeNumericInput(value: unknown): number {
    if (typeof value === "string") {
      const trimmed: string = value.trim();
      return trimmed === "" ? Number.NaN : Number(trimmed);
    }

    if (typeof value === "number") {
      return value;
    }

    return Number.NaN;
  }

  private validateDailyBudget(value: unknown): number {
    const dailyBudgetInUSD: number = this.normalizeNumericInput(value);

    if (!Number.isFinite(dailyBudgetInUSD) || dailyBudgetInUSD <= 0) {
      throw new BadDataException(BUDGET_ERROR_MESSAGE);
    }

    return dailyBudgetInUSD;
  }
}

export default new Service();
