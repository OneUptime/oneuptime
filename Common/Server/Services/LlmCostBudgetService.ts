import Alert from "../../Models/DatabaseModels/Alert";
import AlertStateTimeline from "../../Models/DatabaseModels/AlertStateTimeline";
import Model from "../../Models/DatabaseModels/LlmCostBudget";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import UpdateBy from "../Types/Database/UpdateBy";
import logger, { LogAttributes } from "../Utils/Logger";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import AlertService from "./AlertService";
import AlertStateTimelineService from "./AlertStateTimelineService";
import DatabaseService from "./DatabaseService";

const BUDGET_ERROR_MESSAGE: string =
  "Daily budget must be a number greater than 0.";
const WARNING_THRESHOLD_ERROR_MESSAGE: string =
  "Warning threshold must be a whole-number percentage between 1 and 99.";

// The two alert kinds a budget can raise, encoded into the alert fingerprint.
export type LlmCostBudgetAlertKind = "warning" | "breach";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * Deterministic fingerprint carried on Alerts created by a budget. The
   * evaluation worker sets this as `seriesFingerprint` when it fires an
   * alert, and lifecycle hooks use it to find (and resolve) those alerts when
   * the budget goes away. Warning and breach are separate series so a breach
   * still pages when the warning alert is already open.
   */
  public getBudgetAlertFingerprint(data: {
    llmCostBudgetId: ObjectID;
    kind: LlmCostBudgetAlertKind;
  }): string {
    return `llm-cost-budget:${data.llmCostBudgetId.toString()}:${data.kind}`;
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

    if (
      createBy.data.warningThresholdPercent !== undefined &&
      createBy.data.warningThresholdPercent !== null
    ) {
      createBy.data.warningThresholdPercent = this.validateWarningThreshold(
        createBy.data.warningThresholdPercent,
      );
    }

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

    const newThreshold: unknown = updateBy.data
      .warningThresholdPercent as unknown;

    if (newThreshold !== undefined && newThreshold !== null) {
      updateBy.data.warningThresholdPercent =
        this.validateWarningThreshold(newThreshold);
    }

    return {
      updateBy,
      carryForward: null,
    };
  }

  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    /*
     * Resolve any open alert fired by the budgets being deleted — otherwise
     * the alert (and its on-call escalations) stays open forever because the
     * evaluation worker only touches budgets that still exist.
     */
    const itemsToDelete: Array<Model> = await this.findBy({
      query: deleteBy.query,
      limit: deleteBy.limit,
      skip: deleteBy.skip,
      select: {
        _id: true,
        projectId: true,
      },
      props: {
        isRoot: true,
      },
    });

    for (const item of itemsToDelete) {
      if (!item.id || !item.projectId) {
        continue;
      }

      try {
        await this.resolveOpenAlertsForBudget({
          llmCostBudgetId: item.id,
          projectId: item.projectId,
          rootCause:
            "Alert auto-resolved because the LLM cost budget that created it was deleted.",
        });
      } catch (err) {
        logger.error(
          `Error resolving open alerts for LLM cost budget ${item.id?.toString()} before delete: ${err}`,
          { projectId: item.projectId?.toString() } as LogAttributes,
        );
      }
    }

    return {
      deleteBy,
      carryForward: {
        itemsToDelete: itemsToDelete,
      },
    };
  }

  /*
   * Resolve all open Alerts carrying this budget's fingerprints (warning and
   * breach) by appending a resolved AlertStateTimeline row. Mirrors
   * ServiceLevelObjectiveBurnRateRuleService.resolveOpenAlertsForRule,
   * including tolerating the benign same-state concurrency race.
   */
  @CaptureSpan()
  public async resolveOpenAlertsForBudget(data: {
    llmCostBudgetId: ObjectID;
    projectId: ObjectID;
    rootCause?: string | undefined;
  }): Promise<void> {
    const kinds: Array<LlmCostBudgetAlertKind> = ["warning", "breach"];

    for (const kind of kinds) {
      const fingerprint: string = this.getBudgetAlertFingerprint({
        llmCostBudgetId: data.llmCostBudgetId,
        kind: kind,
      });

      const openAlerts: Array<Alert> = await AlertService.findBy({
        query: {
          projectId: data.projectId,
          seriesFingerprint: fingerprint,
          currentAlertState: {
            isResolvedState: false,
          },
        },
        select: {
          _id: true,
          projectId: true,
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: {
          isRoot: true,
        },
      });

      if (openAlerts.length === 0) {
        continue;
      }

      const resolvedStateId: ObjectID =
        await AlertStateTimelineService.getResolvedStateIdForProject(
          data.projectId,
        );

      for (const openAlert of openAlerts) {
        try {
          const alertStateTimeline: AlertStateTimeline =
            new AlertStateTimeline();
          alertStateTimeline.alertId = openAlert.id!;
          alertStateTimeline.alertStateId = resolvedStateId;
          alertStateTimeline.projectId = openAlert.projectId!;
          alertStateTimeline.rootCause =
            data.rootCause ||
            "Alert auto-resolved because the LLM cost budget that created it is no longer active.";

          try {
            await AlertStateTimelineService.create({
              data: alertStateTimeline,
              props: {
                isRoot: true,
              },
            });
          } catch (err) {
            /*
             * Idempotent concurrency race: the evaluation worker and a
             * lifecycle hook can both decide to resolve the same open alert
             * near-simultaneously. The loser's onBeforeCreate dedupe throws
             * this exact BadDataException. Treat as a no-op at debug level.
             * Mirrors MonitorAlert.resolveOpenAlert.
             */
            if (
              err instanceof BadDataException &&
              err.message === "Alert state cannot be same as previous state."
            ) {
              logger.debug(
                `${openAlert.id?.toString()} - Alert already in resolved state; skipping duplicate state timeline (concurrent race).`,
              );
            } else {
              throw err;
            }
          }
        } catch (err) {
          logger.error(
            `Error resolving open alert ${openAlert.id?.toString()} for LLM cost budget ${data.llmCostBudgetId?.toString()}: ${err}`,
            { projectId: data.projectId?.toString() } as LogAttributes,
          );
        }
      }
    }
  }

  /*
   * Coerce an API-supplied numeric column to a number. HTML number inputs hand
   * Formik strings and neither ModelForm nor BaseModel.fromJSON coerces
   * Number/Decimal columns, so "100" reaches these hooks as a string — and
   * string comparison is lexicographic. Anything that is not a finite numeric
   * string or number becomes NaN, which every caller below rejects.
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

  private validateWarningThreshold(value: unknown): number {
    const warningThresholdPercent: number = this.normalizeNumericInput(value);

    /*
     * The column is a Postgres integer, so a decimal that cleared only the
     * range check would fail the INSERT with a raw driver error instead of
     * this message. Mirrors ServiceLevelObjectiveService's percentage guard.
     */
    if (
      !Number.isInteger(warningThresholdPercent) ||
      warningThresholdPercent < 1 ||
      warningThresholdPercent > 99
    ) {
      throw new BadDataException(WARNING_THRESHOLD_ERROR_MESSAGE);
    }

    return warningThresholdPercent;
  }
}

export default new Service();
