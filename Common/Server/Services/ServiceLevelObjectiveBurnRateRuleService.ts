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
    this.validateRuleConfig({
      burnRateThreshold: createBy.data.burnRateThreshold,
      longWindowInMinutes: createBy.data.longWindowInMinutes,
      shortWindowInMinutes: createBy.data.shortWindowInMinutes,
    });

    return {
      createBy,
      carryForward: null,
    };
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    const newThreshold: number | undefined = updateBy.data.burnRateThreshold as
      | number
      | undefined;

    if (newThreshold !== undefined && newThreshold !== null) {
      if (newThreshold <= 0) {
        throw new BadDataException(
          "Burn rate threshold must be greater than 0.",
        );
      }
    }

    const newLongWindow: number | undefined = updateBy.data
      .longWindowInMinutes as number | undefined;
    const newShortWindow: number | undefined = updateBy.data
      .shortWindowInMinutes as number | undefined;

    const isLongWindowUpdated: boolean =
      newLongWindow !== undefined && newLongWindow !== null;
    const isShortWindowUpdated: boolean =
      newShortWindow !== undefined && newShortWindow !== null;

    if (isLongWindowUpdated || isShortWindowUpdated) {
      if (isLongWindowUpdated && isShortWindowUpdated) {
        this.validateWindows({
          longWindowInMinutes: newLongWindow!,
          shortWindowInMinutes: newShortWindow!,
        });
      } else {
        /*
         * Only one of the two windows is being updated. Load the affected
         * rules so the updated value can be validated against the value that
         * will remain on each row.
         */
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
          this.validateWindows({
            longWindowInMinutes: isLongWindowUpdated
              ? newLongWindow!
              : rule.longWindowInMinutes!,
            shortWindowInMinutes: isShortWindowUpdated
              ? newShortWindow!
              : rule.shortWindowInMinutes!,
          });
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

  private validateRuleConfig(data: {
    burnRateThreshold: number | undefined;
    longWindowInMinutes: number | undefined;
    shortWindowInMinutes: number | undefined;
  }): void {
    if (
      data.burnRateThreshold === undefined ||
      data.burnRateThreshold === null ||
      data.burnRateThreshold <= 0
    ) {
      throw new BadDataException("Burn rate threshold must be greater than 0.");
    }

    if (
      data.longWindowInMinutes === undefined ||
      data.longWindowInMinutes === null ||
      data.shortWindowInMinutes === undefined ||
      data.shortWindowInMinutes === null
    ) {
      throw new BadDataException(
        "Long window and short window are required for a burn rate rule.",
      );
    }

    this.validateWindows({
      longWindowInMinutes: data.longWindowInMinutes,
      shortWindowInMinutes: data.shortWindowInMinutes,
    });
  }

  private validateWindows(data: {
    longWindowInMinutes: number;
    shortWindowInMinutes: number;
  }): void {
    if (data.shortWindowInMinutes <= 0) {
      throw new BadDataException(
        "Short window must be greater than 0 minutes.",
      );
    }

    if (data.longWindowInMinutes <= data.shortWindowInMinutes) {
      throw new BadDataException(
        "Long window must be greater than the short window.",
      );
    }
  }
}

export default new Service();
