import CreateBy from "../Types/Database/CreateBy";
import UpdateBy from "../Types/Database/UpdateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnCreate, OnUpdate, OnDelete } from "../Types/Database/Hooks";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/IncidentMeasurement";
import IncidentState from "../../Models/DatabaseModels/IncidentState";
import IncidentStateService from "./IncidentStateService";
import IncidentMeasurementAnchorType from "../../Types/Incident/IncidentMeasurementAnchorType";
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
  [IncidentMeasurementAnchorType.ImpactStartedAt]: "impactStartedAt",
  [IncidentMeasurementAnchorType.DeclaredAt]: "declaredAt",
  [IncidentMeasurementAnchorType.TimelineStart]: "declaredAt",
  [IncidentMeasurementAnchorType.CreatedAt]: "createdAt",
  [IncidentMeasurementAnchorType.PostmortemPostedAt]: "postmortemPostedAt",
};

export class Service extends DatabaseService<Model> {
  public static readonly METRIC_NAME_PREFIX: string =
    "oneuptime.incident.measurement.";

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
      startStateId: createBy.data.startIncidentStateId,
      endStateId: createBy.data.endIncidentStateId,
      startStateRole: createBy.data.startIncidentStateRole,
      endStateRole: createBy.data.endIncidentStateRole,
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
     * A definition created today must apply to incidents that already
     * happened, or the page it appears on is empty for every closed incident
     * forever. The backfill worker picks this stamp up.
     */
    createBy.data.backfillRequestedAt = OneUptimeDate.getCurrentDate();

    return { createBy, carryForward: null };
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    /*
     * Read as a plain record rather than Partial<Model>: the model graph is
     * deep enough that instantiating the partial here trips the compiler's
     * recursion limit, and every use below is a key lookup anyway.
     */
    const data: Record<string, unknown> = updateBy.data as unknown as Record<
      string,
      unknown
    >;

    const definitionKeys: Array<string> = [
      "startAnchorType",
      "endAnchorType",
      "startIncidentStateId",
      "endIncidentStateId",
      "startIncidentStateRole",
      "endIncidentStateRole",
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
        startIncidentStateId: true,
        endIncidentStateId: true,
        startIncidentStateRole: true,
        endIncidentStateRole: true,
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
        ] as IncidentMeasurementAnchorType,
        endAnchorType: merged["endAnchorType"] as IncidentMeasurementAnchorType,
        startStateId: merged["startIncidentStateId"] as ObjectID,
        endStateId: merged["endIncidentStateId"] as ObjectID,
        startStateRole: merged["startIncidentStateRole"] as string,
        endStateRole: merged["endIncidentStateRole"] as string,
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
    startAnchorType?: IncidentMeasurementAnchorType | undefined;
    endAnchorType?: IncidentMeasurementAnchorType | undefined;
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
      stateEnteredAnchor: IncidentMeasurementAnchorType.StateEntered,
      stateRoleEnteredAnchor: IncidentMeasurementAnchorType.StateRoleEntered,
      startStateId: data.startStateId?.toString(),
      endStateId: data.endStateId?.toString(),
      startStateRole: data.startStateRole,
      endStateRole: data.endStateRole,
      startOccurrence: data.startOccurrence,
      endOccurrence: data.endOccurrence,
    });

    if (
      data.startAnchorType !== IncidentMeasurementAnchorType.StateEntered ||
      data.endAnchorType !== IncidentMeasurementAnchorType.StateEntered ||
      !data.startStateId ||
      !data.endStateId
    ) {
      return;
    }

    const states: Array<IncidentState> = await IncidentStateService.findBy({
      query: { projectId: data.projectId },
      select: { _id: true, name: true, order: true },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: { isRoot: true },
    });

    const startState: IncidentState | undefined = states.find(
      (state: IncidentState) => {
        return state._id?.toString() === data.startStateId!.toString();
      },
    );

    const endState: IncidentState | undefined = states.find(
      (state: IncidentState) => {
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
