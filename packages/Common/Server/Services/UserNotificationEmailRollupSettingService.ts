import DatabaseService from "./DatabaseService";
import CreateBy from "../Types/Database/CreateBy";
import { OnCreate } from "../Types/Database/Hooks";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import Model from "../../Models/DatabaseModels/UserNotificationEmailRollupSetting";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";

/*
 * The escape hatch from owner-email burst rollup, one row per (user, project).
 *
 * The read below is the ONLY place the preference is consulted, and it is
 * deliberately not cached. A cache would mean a person who has just clicked
 * "send me every email immediately" keeps getting batched mail for the length
 * of the TTL - which is precisely the complaint the toggle exists to answer,
 * reproduced by the mechanism meant to serve it. The query is a single indexed
 * row on a table with at most one row per project member, on a path that
 * already runs a dozen queries, and the write path only reaches it when it is
 * about to DEFER - never on the common below-the-threshold send.
 */
export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * True when this person's owner notification emails may be coalesced.
   *
   * Absent row means enabled. Rollup ships on by default with no backfill, so
   * almost nobody has a row here; treating "no row" as anything other than the
   * default would make the feature depend on data that does not exist.
   *
   * This does NOT swallow errors. The one caller reads it inside the write
   * path's fail-open catch, which turns any failure into an immediate send -
   * the same direction this method's `false` means, and the same direction
   * every other failure in that path takes.
   */
  @CaptureSpan()
  public async isRollupEnabledForUser(data: {
    userId: ObjectID;
    projectId: ObjectID;
  }): Promise<boolean> {
    const setting: Model | null = await this.findOneBy({
      query: {
        userId: data.userId,
        projectId: data.projectId,
      },
      select: {
        isEnabled: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!setting) {
      return true;
    }

    /*
     * Only an explicit false opts out. A row whose isEnabled somehow arrived
     * NULL - a hand-written insert, a column added ahead of its default - is
     * not an opt-out, because opting somebody out of individual emails is the
     * change that needs to have been asked for.
     */
    return setting.isEnabled !== false;
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    if (!createBy.data.projectId) {
      throw new BadDataException("projectId is required");
    }

    if (!createBy.data.userId) {
      throw new BadDataException("userId is required");
    }

    /*
     * One row per person per project. The page creates lazily on the first
     * toggle, so a double click or two open tabs would otherwise leave two
     * rows and make findOneBy's answer depend on which one it happened to
     * pick. There is no unique index behind this check - the same
     * check-then-create shape UserNotificationSettingService.onBeforeCreate
     * already uses - so it narrows the window rather than closing it; the read
     * above tolerates a duplicate because both rows say the same thing in
     * every flow the UI can produce.
     */
    const existingCount: number = (
      await this.countBy({
        query: {
          projectId: createBy.data.projectId,
          userId: createBy.data.userId,
        },
        props: {
          isRoot: true,
        },
      })
    ).toNumber();

    if (existingCount > 0) {
      throw new BadDataException(
        "An email rollup setting already exists for this user in this project.",
      );
    }

    return { createBy, carryForward: null };
  }
}

export default new Service();
