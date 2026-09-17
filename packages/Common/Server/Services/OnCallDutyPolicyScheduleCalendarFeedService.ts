import CreateBy from "../Types/Database/CreateBy";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import DatabaseService from "./DatabaseService";
import OnCallDutyPolicyScheduleService from "./OnCallDutyPolicyScheduleService";
import CalendarFeedToken, {
  CalendarFeedRotation,
} from "../Utils/OnCall/CalendarFeedToken";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import Model from "../../Models/DatabaseModels/OnCallDutyPolicyScheduleCalendarFeed";
import OnCallDutyPolicySchedule from "../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import BadDataException from "../../Types/Exception/BadDataException";
import NotFoundException from "../../Types/Exception/NotFoundException";
import CalendarFeedWindow from "../../Types/OnCallDutyPolicy/CalendarFeedWindow";
import ObjectID from "../../Types/ObjectID";
import PositiveNumber from "../../Types/PositiveNumber";

/*
 * Bounds for the coverage-gap threshold: a gap shorter than a minute is a
 * seam artefact, and a threshold longer than a week would never emit.
 */
export const MIN_MINIMUM_GAP_MINUTES: number = 1;
export const MAX_MINIMUM_GAP_MINUTES: number = 7 * 24 * 60;

/*
 * The shared, project-owned calendar feed of one on-call schedule.
 *
 * WHAT THE HOOKS GUARANTEE
 *
 *   - The schedule exists in the caller's project. The foreign key alone
 *     would accept a schedule from another project (the FK does not know
 *     about tenants), and a feed that renders another project's roster to
 *     whoever holds this project's link is exactly the leak the tenant column
 *     exists to prevent.
 *   - One feed per schedule. The unique index enforces it at the database;
 *     the hook turns the constraint violation into a message a person can
 *     act on.
 *   - The token is minted HERE, on every create, whatever the request
 *     carried. Publishing a feed is a normal, permission-checked create
 *     (the schedule's Edit list), and the plaintext is then read back by the
 *     calendar API's `/current` route through the encrypted `token` column.
 *   - pastDays / futureDays are clamped and minimumGapMinutes is bounded on
 *     every write.
 *
 * rotateTokenById and rotateFeedsForMemberLeave are root writes for the
 * calendar API and the team-member cleanup respectively; cache purging stays
 * with the caller.
 */
export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    const projectId: ObjectID | undefined =
      createBy.data.projectId || createBy.props.tenantId;

    if (!projectId) {
      throw new BadDataException("projectId is required");
    }

    const scheduleId: ObjectID | undefined =
      createBy.data.onCallDutyPolicyScheduleId;

    if (!scheduleId) {
      throw new BadDataException("onCallDutyPolicyScheduleId is required");
    }

    createBy.data.projectId = projectId;

    const schedule: OnCallDutyPolicySchedule | null =
      await OnCallDutyPolicyScheduleService.findOneBy({
        query: {
          _id: scheduleId,
          projectId: projectId,
        },
        select: {
          _id: true,
        },
        props: {
          isRoot: true,
          ignoreHooks: true,
        },
      });

    if (!schedule) {
      throw new BadDataException("On-call schedule not found in this project.");
    }

    const existing: PositiveNumber = await this.countBy({
      query: {
        onCallDutyPolicyScheduleId: scheduleId,
      },
      props: {
        isRoot: true,
      },
    });

    if (existing.toNumber() > 0) {
      throw new BadDataException(
        "This schedule already has a shared calendar feed. Regenerate or edit the existing one instead.",
      );
    }

    /*
     * A request body never chooses the secret. Root callers (the calendar
     * API) may pass a token they minted so they can answer with the URL in
     * the same response; everyone else gets a fresh mint.
     */
    CalendarFeedToken.applyTokenColumnsOnCreate(createBy.data, {
      trustSuppliedToken: createBy.props.isRoot === true,
    });

    createBy.data.pastDays = CalendarFeedWindow.clampPastDays(
      createBy.data.pastDays,
    );
    createBy.data.futureDays = CalendarFeedWindow.clampFutureDays(
      createBy.data.futureDays,
    );

    if (createBy.data.minimumGapMinutes !== undefined) {
      createBy.data.minimumGapMinutes = Service.validateMinimumGapMinutes(
        createBy.data.minimumGapMinutes,
      );
    }

    return { createBy, carryForward: null };
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    if (updateBy.data.pastDays !== undefined) {
      updateBy.data.pastDays = CalendarFeedWindow.clampPastDays(
        updateBy.data.pastDays,
      );
    }

    if (updateBy.data.futureDays !== undefined) {
      updateBy.data.futureDays = CalendarFeedWindow.clampFutureDays(
        updateBy.data.futureDays,
      );
    }

    if (updateBy.data.minimumGapMinutes !== undefined) {
      updateBy.data.minimumGapMinutes = Service.validateMinimumGapMinutes(
        updateBy.data.minimumGapMinutes,
      );
    }

    return { updateBy, carryForward: null };
  }

  /*
   * A whole number of minutes between MIN_MINIMUM_GAP_MINUTES and
   * MAX_MINIMUM_GAP_MINUTES. Numeric strings are accepted because a root
   * caller may hand over what a form posted; anything else is a 400.
   */
  public static validateMinimumGapMinutes(value: unknown): number {
    const parsed: number =
      typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : (value as number);

    if (
      typeof parsed !== "number" ||
      !Number.isInteger(parsed) ||
      parsed < MIN_MINIMUM_GAP_MINUTES ||
      parsed > MAX_MINIMUM_GAP_MINUTES
    ) {
      throw new BadDataException(
        `Minimum gap must be a whole number of minutes between ${MIN_MINIMUM_GAP_MINUTES} and ${MAX_MINIMUM_GAP_MINUTES}.`,
      );
    }

    return parsed;
  }

  /**
   * Rotate the token of an existing feed: mint a new one, move the current
   * hash into the 30-day grace slot, stamp rotatedAt. Returns the new
   * plaintext token ONCE. Root write; the caller purges caches.
   */
  @CaptureSpan()
  public async rotateTokenById(data: {
    id: ObjectID;
  }): Promise<CalendarFeedRotation> {
    const existing: Model | null = await this.findOneBy({
      query: { _id: data.id },
      select: { _id: true, tokenHash: true },
      props: { isRoot: true, ignoreHooks: true },
    });

    if (!existing) {
      throw new NotFoundException("Calendar feed not found.");
    }

    const rotation: CalendarFeedRotation = CalendarFeedToken.buildRotation({
      currentTokenHash: existing.tokenHash,
    });

    await this.updateOneById({
      id: data.id,
      data: CalendarFeedToken.toRotationUpdateData(rotation),
      props: { isRoot: true },
    });

    return rotation;
  }

  /**
   * Rotate every ENABLED feed in the project that opted into
   * rotateWhenMemberLeaves. Called by the team-member cleanup when a user's
   * last team membership in the project goes away. Returns the ids rotated
   * so the caller can purge their caches. A disabled feed is left alone: it
   * already serves an empty calendar, and rotating it would only reset the
   * grace clock on a link nobody should be refreshing anyway.
   */
  @CaptureSpan()
  public async rotateFeedsForMemberLeave(data: {
    projectId: ObjectID;
  }): Promise<Array<ObjectID>> {
    const feeds: Array<Model> = await this.findBy({
      query: {
        projectId: data.projectId,
        isEnabled: true,
        rotateWhenMemberLeaves: true,
      },
      select: {
        _id: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
        ignoreHooks: true,
      },
    });

    const rotated: Array<ObjectID> = [];

    for (const feed of feeds) {
      if (!feed.id) {
        continue;
      }

      await this.rotateTokenById({ id: feed.id });
      rotated.push(feed.id);
    }

    return rotated;
  }
}

export default new Service();
