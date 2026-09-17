import CreateBy from "../Types/Database/CreateBy";
import UpdateBy from "../Types/Database/UpdateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnCreate, OnUpdate, OnDelete } from "../Types/Database/Hooks";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/ScheduledMaintenanceMeasurement";
import ScheduledMaintenanceState from "../../Models/DatabaseModels/ScheduledMaintenanceState";
import ScheduledMaintenanceStateService from "./ScheduledMaintenanceStateService";
import ScheduledMaintenanceMeasurementAnchorType from "../../Types/ScheduledMaintenance/ScheduledMaintenanceMeasurementAnchorType";
import MeasurementDefinitionValidator from "../Utils/Measurement/MeasurementDefinitionValidator";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import OneUptimeDate from "../../Types/Date";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

/*
 * The three backfill columns onBeforeUpdate rewrites, named so they are still
 * checked against the model. Spelt out rather than reached through
 * Partial<Model>: this model carries enough relations that instantiating a
 * mapped type over all of it blows tsc's instantiation depth limit.
 */
interface BackfillFields {
  backfillRequestedAt?: Date | undefined;
  backfillCursorCreatedAt?: Date | undefined;
  backfillCompletedAt?: Date | undefined;
}

/*
 * Which column each timestamp anchor actually reads. Several anchors are
 * aliases for the same instant, so the validator compares these rather than
 * the enum values -- otherwise a definition like "Created At -> Timeline
 * Start" would be accepted and report a constant zero on every entity.
 */
const TIMESTAMP_ANCHOR_SOURCES: Record<string, string> = {
  [ScheduledMaintenanceMeasurementAnchorType.TimelineStart]: "createdAt",
  [ScheduledMaintenanceMeasurementAnchorType.CreatedAt]: "createdAt",
  [ScheduledMaintenanceMeasurementAnchorType.ScheduledStartsAt]: "startsAt",
  [ScheduledMaintenanceMeasurementAnchorType.ScheduledEndsAt]: "endsAt",
};

export class Service extends DatabaseService<Model> {
  public static readonly METRIC_NAME_PREFIX: string =
    "oneuptime.scheduled-maintenance.measurement.";

  public constructor() {
    super(Model);
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    MeasurementDefinitionValidator.validateKey(createBy.data.key);

    /*
     * Derived here rather than from the slug: DatabaseService generates the
     * slug AFTER onBeforeCreate runs, and Slug.getSlug appends ten random
     * digits, so a slug-derived metric name would be both unavailable at
     * this point and unreadable if it were.
     */
    createBy.data.metricName = Service.METRIC_NAME_PREFIX + createBy.data.key;

    await this.validateAnchors({
      projectId: createBy.data.projectId!,
      startAnchorType: createBy.data.startAnchorType,
      endAnchorType: createBy.data.endAnchorType,
      startStateId: createBy.data.startScheduledMaintenanceStateId,
      endStateId: createBy.data.endScheduledMaintenanceStateId,
      startStateRole: createBy.data.startScheduledMaintenanceStateRole,
      endStateRole: createBy.data.endScheduledMaintenanceStateRole,
      startOccurrence: createBy.data.startStateOccurrence,
      endOccurrence: createBy.data.endStateOccurrence,
    });

    if (!createBy.data.order) {
      const highest: Model | null = await this.findOneBy({
        query: { projectId: createBy.data.projectId! },
        select: { order: true },
        sort: { order: SortOrder.Descending },
        props: { isRoot: true },
      });

      createBy.data.order = (highest?.order || 0) + 1;
    }

    /*
     * A definition created today must apply to maintenance events that have
     * already run, or the page it appears on is empty for every completed
     * event forever. The backfill worker picks this stamp up.
     */
    createBy.data.backfillRequestedAt = OneUptimeDate.getCurrentDate();

    return { createBy, carryForward: null };
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    /*
     * Read as a bag of keys rather than as Partial<Model>: this model carries
     * enough relations that checking assignability against it blows the
     * instantiation depth limit, and the two uses below -- key presence and a
     * spread into `merged` -- need nothing more than this.
     */
    const data: Record<string, unknown> = updateBy.data as Record<
      string,
      unknown
    >;

    const definitionKeys: Array<string> = [
      "startAnchorType",
      "endAnchorType",
      "startScheduledMaintenanceStateId",
      "endScheduledMaintenanceStateId",
      "startScheduledMaintenanceStateRole",
      "endScheduledMaintenanceStateRole",
      "startStateOccurrence",
      "endStateOccurrence",
      "isEnabled",
    ];

    const touchesDefinition: boolean = definitionKeys.some((key: string) => {
      return Object.prototype.hasOwnProperty.call(data, key);
    });

    if (!touchesDefinition) {
      return { updateBy, carryForward: null };
    }

    const existingItems: Array<Model> = await this.findBy({
      query: updateBy.query,
      select: {
        projectId: true,
        startAnchorType: true,
        endAnchorType: true,
        startScheduledMaintenanceStateId: true,
        endScheduledMaintenanceStateId: true,
        startScheduledMaintenanceStateRole: true,
        endScheduledMaintenanceStateRole: true,
        startStateOccurrence: true,
        endStateOccurrence: true,
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: { isRoot: true },
    });

    for (const existing of existingItems) {
      const merged: Record<string, unknown> = {
        ...existing,
        ...data,
      } as Record<string, unknown>;

      await this.validateAnchors({
        projectId: existing.projectId!,
        startAnchorType: merged[
          "startAnchorType"
        ] as ScheduledMaintenanceMeasurementAnchorType,
        endAnchorType: merged[
          "endAnchorType"
        ] as ScheduledMaintenanceMeasurementAnchorType,
        startStateId: merged["startScheduledMaintenanceStateId"] as ObjectID,
        endStateId: merged["endScheduledMaintenanceStateId"] as ObjectID,
        startStateRole: merged["startScheduledMaintenanceStateRole"] as string,
        endStateRole: merged["endScheduledMaintenanceStateRole"] as string,
        startOccurrence: merged["startStateOccurrence"] as string,
        endOccurrence: merged["endStateOccurrence"] as string,
      });
    }

    /*
     * Changing what a measurement means rewrites its history in place, under
     * the same metric point identity -- one series, one current definition.
     * Keeping the old numbers means creating a new definition instead, which
     * the settings page says.
     */
    const backfillFields: BackfillFields =
      updateBy.data as unknown as BackfillFields;

    backfillFields.backfillRequestedAt = OneUptimeDate.getCurrentDate();
    // Cleared, not left stale: the backfill must restart from the beginning.
    backfillFields.backfillCursorCreatedAt = null as unknown as Date;
    backfillFields.backfillCompletedAt = null as unknown as Date;

    return { updateBy, carryForward: null };
  }

  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    const items: Array<Model> = await this.findBy({
      query: deleteBy.query,
      select: { isSystemDefined: true, name: true },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: { isRoot: true },
    });

    for (const item of items) {
      if (item.isSystemDefined) {
        throw new BadDataException(
          `"${item.name}" is a built-in measurement and cannot be deleted. Disable it instead.`,
        );
      }
    }

    return { deleteBy, carryForward: null };
  }

  /*
   * Every measurement metric name in the project, enabled or not.
   *
   * Disabled definitions must stay in this list: the tombstone pass diffs
   * live metric points against the desired set scoped to these names, so a
   * name that is omitted keeps its points live in every chart until the
   * retention date rather than disappearing when the user disables it.
   */
  @CaptureSpan()
  public async getMetricNamesForProject(
    projectId: ObjectID,
  ): Promise<Array<string>> {
    const measurements: Array<Model> = await this.findBy({
      query: { projectId: projectId },
      select: { metricName: true },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: { isRoot: true },
    });

    return measurements
      .map((measurement: Model) => {
        return measurement.metricName;
      })
      .filter((name: string | undefined) => {
        return Boolean(name);
      }) as Array<string>;
  }

  private async validateAnchors(data: {
    projectId: ObjectID;
    startAnchorType?: ScheduledMaintenanceMeasurementAnchorType | undefined;
    endAnchorType?: ScheduledMaintenanceMeasurementAnchorType | undefined;
    startStateId?: ObjectID | undefined;
    endStateId?: ObjectID | undefined;
    startStateRole?: string | undefined;
    endStateRole?: string | undefined;
    startOccurrence?: string | undefined;
    endOccurrence?: string | undefined;
  }): Promise<void> {
    MeasurementDefinitionValidator.validateAnchorPair({
      timestampAnchorSources: TIMESTAMP_ANCHOR_SOURCES,
      startAnchorType: data.startAnchorType,
      endAnchorType: data.endAnchorType,
      stateEnteredAnchor:
        ScheduledMaintenanceMeasurementAnchorType.StateEntered,
      stateRoleEnteredAnchor:
        ScheduledMaintenanceMeasurementAnchorType.StateRoleEntered,
      startStateId: data.startStateId?.toString(),
      endStateId: data.endStateId?.toString(),
      startStateRole: data.startStateRole,
      endStateRole: data.endStateRole,
      startOccurrence: data.startOccurrence,
      endOccurrence: data.endOccurrence,
    });

    if (
      data.startAnchorType !==
        ScheduledMaintenanceMeasurementAnchorType.StateEntered ||
      data.endAnchorType !==
        ScheduledMaintenanceMeasurementAnchorType.StateEntered ||
      !data.startStateId ||
      !data.endStateId
    ) {
      return;
    }

    const states: Array<ScheduledMaintenanceState> =
      await ScheduledMaintenanceStateService.findBy({
        query: { projectId: data.projectId },
        select: { _id: true, name: true, order: true },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: { isRoot: true },
      });

    const startState: ScheduledMaintenanceState | undefined = states.find(
      (state: ScheduledMaintenanceState) => {
        return state._id?.toString() === data.startStateId!.toString();
      },
    );

    const endState: ScheduledMaintenanceState | undefined = states.find(
      (state: ScheduledMaintenanceState) => {
        return state._id?.toString() === data.endStateId!.toString();
      },
    );

    MeasurementDefinitionValidator.validateStateOrder({
      startStateName: startState?.name,
      startStateOrder: startState?.order,
      endStateName: endState?.name,
      endStateOrder: endState?.order,
    });
  }
}

export default new Service();
