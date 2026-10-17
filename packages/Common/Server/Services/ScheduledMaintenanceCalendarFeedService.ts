import CreateBy from "../Types/Database/CreateBy";
import { OnCreate } from "../Types/Database/Hooks";
import DatabaseService from "./DatabaseService";
import CalendarFeedToken, {
  CalendarFeedRotation,
} from "../Utils/OnCall/CalendarFeedToken";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import Model from "../../Models/DatabaseModels/ScheduledMaintenanceCalendarFeed";
import BadDataException from "../../Types/Exception/BadDataException";
import NotFoundException from "../../Types/Exception/NotFoundException";
import ObjectID from "../../Types/ObjectID";
import PositiveNumber from "../../Types/PositiveNumber";

export const SCHEDULED_MAINTENANCE_CALENDAR_FEED_EXISTS_MESSAGE: string =
  "This project already has a calendar link for scheduled maintenance. Regenerate or turn on the existing one instead.";

/*
 * The team's calendar link for scheduled maintenance: at most one row per
 * project.
 *
 * The same guarantees as the on-call project link
 * (ProjectOnCallCalendarFeedService): one link per project (a unique index,
 * and a readable message before it), a token minted here on every create
 * whatever the request carried (CalendarFeedToken), and a root-only rotation
 * that keeps the rotated-out token's hash for 30 days, answered with an empty
 * calendar so subscribed apps clear their copy.
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
        SCHEDULED_MAINTENANCE_CALENDAR_FEED_EXISTS_MESSAGE,
      );
    }

    // A request body never chooses the secret; only root may pre-mint one.
    CalendarFeedToken.applyTokenColumnsOnCreate(createBy.data, {
      trustSuppliedToken: createBy.props.isRoot === true,
    });

    return { createBy, carryForward: null };
  }

  /**
   * Rotate the token of an existing link. Returns the new plaintext token
   * ONCE. Root write.
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
      throw new NotFoundException("Calendar link not found.");
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
}

export default new Service();
