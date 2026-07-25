import Alert from "../../Models/DatabaseModels/Alert";
import AlertStateTimeline from "../../Models/DatabaseModels/AlertStateTimeline";
import Model from "../../Models/DatabaseModels/ServiceLevelObjectiveBurnRateRule";
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

const THRESHOLD_ERROR_MESSAGE: string =
  "Burn rate threshold must be greater than 0.";
const WINDOWS_REQUIRED_ERROR_MESSAGE: string =
  "Long window and short window are required for a burn rate rule.";
const WINDOWS_NOT_NUMERIC_ERROR_MESSAGE: string =
  "Long window and short window must be a number of minutes.";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * Deterministic fingerprint carried on Alerts created by a burn rate rule.
   * The evaluation worker sets this as `seriesFingerprint` when it fires an
   * alert, and lifecycle hooks use it to find (and resolve) those alerts when
   * the rule or its SLO goes away.
   */
  public getBurnRateAlertFingerprint(data: {
    serviceLevelObjectiveId: ObjectID;
    burnRateRuleId: ObjectID;
  }): string {
    return `slo:${data.serviceLevelObjectiveId.toString()}:burn-rule:${data.burnRateRuleId.toString()}`;
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    /*
     * Every numeric column can arrive as a string: the dashboard's number
     * fields hand Formik `e.target.value`, ModelForm copies it verbatim and
     * BaseModel.fromJSON does not coerce Number/Decimal columns. Comparing
     * those strings is lexicographic ("1440" <= "60" is true), so coerce
     * first, then validate, then write the number back onto the payload so
     * Postgres never sees a string either.
     */
    createBy.data.burnRateThreshold = this.validateBurnRateThreshold(
      createBy.data.burnRateThreshold,
    );

    if (
      createBy.data.longWindowInMinutes === undefined ||
      createBy.data.longWindowInMinutes === null ||
      createBy.data.shortWindowInMinutes === undefined ||
      createBy.data.shortWindowInMinutes === null
    ) {
      throw new BadDataException(WINDOWS_REQUIRED_ERROR_MESSAGE);
    }

    const windows: {
      longWindowInMinutes: number;
      shortWindowInMinutes: number;
    } = this.validateWindows({
      longWindowInMinutes: createBy.data.longWindowInMinutes,
      shortWindowInMinutes: createBy.data.shortWindowInMinutes,
    });

    createBy.data.longWindowInMinutes = windows.longWindowInMinutes;
    createBy.data.shortWindowInMinutes = windows.shortWindowInMinutes;

    if (
      createBy.data.minimumSampleCount !== undefined &&
      createBy.data.minimumSampleCount !== null
    ) {
      createBy.data.minimumSampleCount = this.validateMinimumSampleCount(
        createBy.data.minimumSampleCount,
      );
    }

    if (
      createBy.data.refireSuppressionMinutes !== undefined &&
      createBy.data.refireSuppressionMinutes !== null
    ) {
      createBy.data.refireSuppressionMinutes =
        this.validateRefireSuppressionMinutes(
          createBy.data.refireSuppressionMinutes,
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
    const newThreshold: unknown = updateBy.data.burnRateThreshold as unknown;

    if (newThreshold !== undefined && newThreshold !== null) {
      updateBy.data.burnRateThreshold =
        this.validateBurnRateThreshold(newThreshold);
    }

    if (
      updateBy.data.minimumSampleCount !== undefined &&
      updateBy.data.minimumSampleCount !== null
    ) {
      updateBy.data.minimumSampleCount = this.validateMinimumSampleCount(
        updateBy.data.minimumSampleCount as unknown,
      );
    }

    if (
      updateBy.data.refireSuppressionMinutes !== undefined &&
      updateBy.data.refireSuppressionMinutes !== null
    ) {
      updateBy.data.refireSuppressionMinutes =
        this.validateRefireSuppressionMinutes(
          updateBy.data.refireSuppressionMinutes as unknown,
        );
    }

    const newLongWindow: unknown = updateBy.data.longWindowInMinutes as unknown;
    const newShortWindow: unknown = updateBy.data
      .shortWindowInMinutes as unknown;

    const isLongWindowUpdated: boolean =
      newLongWindow !== undefined && newLongWindow !== null;
    const isShortWindowUpdated: boolean =
      newShortWindow !== undefined && newShortWindow !== null;

    if (isLongWindowUpdated || isShortWindowUpdated) {
      if (isLongWindowUpdated && isShortWindowUpdated) {
        const windows: {
          longWindowInMinutes: number;
          shortWindowInMinutes: number;
        } = this.validateWindows({
          longWindowInMinutes: newLongWindow,
          shortWindowInMinutes: newShortWindow,
        });

        updateBy.data.longWindowInMinutes = windows.longWindowInMinutes;
        updateBy.data.shortWindowInMinutes = windows.shortWindowInMinutes;
      } else {
        /*
         * Only one of the two windows is being updated. Coerce it up front so
         * a non-numeric value is rejected even when the query matches no rows,
         * then load the affected rules so the updated value can be validated
         * against the value that will remain on each row.
         */
        const normalizedNewWindow: number = this.normalizeNumericInput(
          isLongWindowUpdated ? newLongWindow : newShortWindow,
        );

        if (!Number.isFinite(normalizedNewWindow)) {
          throw new BadDataException(WINDOWS_NOT_NUMERIC_ERROR_MESSAGE);
        }

        const rulesToUpdate: Array<Model> = await this.findBy({
          query: updateBy.query,
          select: {
            _id: true,
            longWindowInMinutes: true,
            shortWindowInMinutes: true,
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          props: {
            isRoot: true,
          },
        });

        for (const rule of rulesToUpdate) {
          /*
           * The persisted sibling is coerced too — rows written before numeric
           * coercion existed can still hold a string in a Decimal/Number
           * column, and validateWindows must not compare against it as text.
           */
          this.validateWindows({
            longWindowInMinutes: isLongWindowUpdated
              ? normalizedNewWindow
              : rule.longWindowInMinutes,
            shortWindowInMinutes: isShortWindowUpdated
              ? normalizedNewWindow
              : rule.shortWindowInMinutes,
          });
        }

        if (isLongWindowUpdated) {
          updateBy.data.longWindowInMinutes = normalizedNewWindow;
        } else {
          updateBy.data.shortWindowInMinutes = normalizedNewWindow;
        }
      }
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
     * Resolve any open alert fired by the rules being deleted — otherwise the
     * alert (and its on-call escalations) stays open forever because the
     * evaluation worker only resolves alerts for rules that still exist.
     */
    const itemsToDelete: Array<Model> = await this.findBy({
      query: deleteBy.query,
      limit: deleteBy.limit,
      skip: deleteBy.skip,
      select: {
        _id: true,
        projectId: true,
        serviceLevelObjectiveId: true,
      },
      props: {
        isRoot: true,
      },
    });

    for (const item of itemsToDelete) {
      if (!item.id || !item.projectId || !item.serviceLevelObjectiveId) {
        continue;
      }

      try {
        await this.resolveOpenAlertsForRule({
          serviceLevelObjectiveId: item.serviceLevelObjectiveId,
          burnRateRuleId: item.id,
          projectId: item.projectId,
          rootCause:
            "Alert auto-resolved because the SLO burn rate rule that created it was deleted.",
        });
      } catch (err) {
        logger.error(
          `Error resolving open alerts for SLO burn rate rule ${item.id?.toString()} before delete: ${err}`,
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
   * Resolve all open Alerts carrying this rule's fingerprint by appending a
   * resolved AlertStateTimeline row. Mirrors
   * MonitorAlert.resolveOpenAlert mechanics, including tolerating the benign
   * same-state concurrency race.
   */
  @CaptureSpan()
  public async resolveOpenAlertsForRule(data: {
    serviceLevelObjectiveId: ObjectID;
    burnRateRuleId: ObjectID;
    projectId: ObjectID;
    rootCause?: string | undefined;
  }): Promise<void> {
    const fingerprint: string = this.getBurnRateAlertFingerprint({
      serviceLevelObjectiveId: data.serviceLevelObjectiveId,
      burnRateRuleId: data.burnRateRuleId,
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
      return;
    }

    const resolvedStateId: ObjectID =
      await AlertStateTimelineService.getResolvedStateIdForProject(
        data.projectId,
      );

    for (const openAlert of openAlerts) {
      try {
        const alertStateTimeline: AlertStateTimeline = new AlertStateTimeline();
        alertStateTimeline.alertId = openAlert.id!;
        alertStateTimeline.alertStateId = resolvedStateId;
        alertStateTimeline.projectId = openAlert.projectId!;
        alertStateTimeline.rootCause =
          data.rootCause ||
          "Alert auto-resolved because the SLO burn rate rule that created it is no longer active.";

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
          `Error resolving open alert ${openAlert.id?.toString()} for SLO burn rate rule ${data.burnRateRuleId?.toString()}: ${err}`,
          { projectId: data.projectId?.toString() } as LogAttributes,
        );
      }
    }
  }

  /*
   * Coerce an API-supplied numeric column to a number. HTML number inputs hand
   * Formik strings and neither ModelForm nor BaseModel.fromJSON coerces
   * Number/Decimal columns, so "1440" reaches these hooks as a string — and
   * `"1440" <= "60"` is a lexicographic comparison that is true. Anything that
   * is not a finite numeric string or number becomes NaN, which every caller
   * below rejects. Mirrors GlobalConfigService.normalizePercent.
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

  private validateBurnRateThreshold(value: unknown): number {
    const burnRateThreshold: number = this.normalizeNumericInput(value);

    if (!Number.isFinite(burnRateThreshold) || burnRateThreshold <= 0) {
      throw new BadDataException(THRESHOLD_ERROR_MESSAGE);
    }

    return burnRateThreshold;
  }

  private validateMinimumSampleCount(value: unknown): number {
    const minimumSampleCount: number = this.normalizeNumericInput(value);

    if (!Number.isFinite(minimumSampleCount) || minimumSampleCount < 0) {
      throw new BadDataException(
        "Minimum sample count must be a number greater than or equal to 0.",
      );
    }

    return minimumSampleCount;
  }

  private validateRefireSuppressionMinutes(value: unknown): number {
    const refireSuppressionMinutes: number = this.normalizeNumericInput(value);

    if (
      !Number.isFinite(refireSuppressionMinutes) ||
      refireSuppressionMinutes < 0
    ) {
      throw new BadDataException(
        "Re-fire suppression must be a number of minutes greater than or equal to 0.",
      );
    }

    return refireSuppressionMinutes;
  }

  /*
   * Coerces both windows, then enforces the multi-window invariant numerically.
   * Returns the coerced pair so callers can write numbers back onto the
   * create/update payload.
   */
  private validateWindows(data: {
    longWindowInMinutes: unknown;
    shortWindowInMinutes: unknown;
  }): { longWindowInMinutes: number; shortWindowInMinutes: number } {
    const longWindowInMinutes: number = this.normalizeNumericInput(
      data.longWindowInMinutes,
    );
    const shortWindowInMinutes: number = this.normalizeNumericInput(
      data.shortWindowInMinutes,
    );

    if (
      !Number.isFinite(longWindowInMinutes) ||
      !Number.isFinite(shortWindowInMinutes)
    ) {
      throw new BadDataException(WINDOWS_NOT_NUMERIC_ERROR_MESSAGE);
    }

    if (shortWindowInMinutes <= 0) {
      throw new BadDataException(
        "Short window must be greater than 0 minutes.",
      );
    }

    if (longWindowInMinutes <= shortWindowInMinutes) {
      throw new BadDataException(
        "Long window must be greater than the short window.",
      );
    }

    return {
      longWindowInMinutes: longWindowInMinutes,
      shortWindowInMinutes: shortWindowInMinutes,
    };
  }
}

export default new Service();
