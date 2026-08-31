import CreateBy from "../Types/Database/CreateBy";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import DatabaseService from "./DatabaseService";
import {
  MAX_MINIMUM_GAP_MINUTES,
  MIN_MINIMUM_GAP_MINUTES,
} from "./OnCallDutyPolicyScheduleCalendarFeedService";
import CalendarFeedToken, {
  CalendarFeedRotation,
} from "../Utils/OnCall/CalendarFeedToken";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import Model from "../../Models/DatabaseModels/ProjectOnCallCalendarFeed";
import BadDataException from "../../Types/Exception/BadDataException";
import NotFoundException from "../../Types/Exception/NotFoundException";
import CalendarFeedWindow from "../../Types/OnCallDutyPolicy/CalendarFeedWindow";
import ObjectID from "../../Types/ObjectID";
import PositiveNumber from "../../Types/PositiveNumber";

/*
 * The project-wide shared calendar feed: at most one row per project.
 *
 * The same guarantees as OnCallDutyPolicyScheduleCalendarFeedService minus
 * the schedule check: one feed per project (unique index + a readable
 * message), the token minted here on every create whatever the request
 * carried, window and gap settings bounded on every write, root-only
 * rotation with the 30-day grace hash.
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

    createBy.data.projectId = projectId;

    const existing: PositiveNumber = await this.countBy({
      query: {
        projectId: projectId,
      },
      props: {
        isRoot: true,
      },
    });

    if (existing.toNumber() > 0) {
      throw new BadDataException(
        "This project already has a shared calendar feed. Regenerate or edit the existing one instead.",
      );
    }

    // A request body never chooses the secret; only root may pre-mint one.
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
   * Rotate the token of an existing feed. Returns the new plaintext token
   * ONCE. Root write; the caller purges caches.
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
   * Rotate the project's feed when a member leaves, if it is enabled and
   * opted in. Returns the rotated id (at most one) for cache purging.
   */
  @CaptureSpan()
  public async rotateFeedsForMemberLeave(data: {
    projectId: ObjectID;
  }): Promise<Array<ObjectID>> {
    const feed: Model | null = await this.findOneBy({
      query: {
        projectId: data.projectId,
        isEnabled: true,
        rotateWhenMemberLeaves: true,
      },
      select: {
        _id: true,
      },
      props: {
        isRoot: true,
        ignoreHooks: true,
      },
    });

    if (!feed || !feed.id) {
      return [];
    }

    await this.rotateTokenById({ id: feed.id });

    return [feed.id];
  }
}

export default new Service();
