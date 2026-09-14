import CreateBy from "../Types/Database/CreateBy";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import DatabaseService from "./DatabaseService";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import Model, {
  MAX_MINUTES_BEFORE_SHIFT,
  MIN_MINUTES_BEFORE_SHIFT,
} from "../../Models/DatabaseModels/UserOnCallShiftReminder";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import PositiveNumber from "../../Types/PositiveNumber";

/*
 * "Remind me N minutes before my shift" rows.
 *
 * The hooks keep the table honest for the reminder worker: every row has an
 * owner (defaulted to the session user when the client did not send one, so
 * the settings page can post `{ minutesBeforeShift }` and nothing else), a
 * project, and a lead time inside 15 minutes ... 2 weeks. A duplicate lead
 * is answered with a message rather than a unique-violation 500.
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

    if (!createBy.data.userId && createBy.props.userId) {
      createBy.data.userId = createBy.props.userId;
    }

    if (!createBy.data.userId) {
      throw new BadDataException("userId is required");
    }

    createBy.data.projectId = projectId;

    createBy.data.minutesBeforeShift = Service.validateMinutesBeforeShift(
      createBy.data.minutesBeforeShift,
    );

    const duplicates: PositiveNumber = await this.countBy({
      query: {
        projectId: projectId,
        userId: createBy.data.userId,
        minutesBeforeShift: createBy.data.minutesBeforeShift,
      },
      props: {
        isRoot: true,
      },
    });

    if (duplicates.toNumber() > 0) {
      throw new BadDataException(
        `You already have a reminder ${createBy.data.minutesBeforeShift} minutes before your shifts.`,
      );
    }

    return { createBy, carryForward: null };
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    if (updateBy.data.minutesBeforeShift !== undefined) {
      updateBy.data.minutesBeforeShift = Service.validateMinutesBeforeShift(
        updateBy.data.minutesBeforeShift,
      );
    }

    return { updateBy, carryForward: null };
  }

  /*
   * A whole number of minutes between MIN_MINUTES_BEFORE_SHIFT and
   * MAX_MINUTES_BEFORE_SHIFT. Numeric strings are accepted (a form may post
   * one); missing, fractional, negative or out-of-range values are a 400.
   */
  public static validateMinutesBeforeShift(value: unknown): number {
    const parsed: number =
      typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : (value as number);

    if (
      typeof parsed !== "number" ||
      !Number.isInteger(parsed) ||
      parsed < MIN_MINUTES_BEFORE_SHIFT ||
      parsed > MAX_MINUTES_BEFORE_SHIFT
    ) {
      throw new BadDataException(
        `Reminder lead time must be a whole number of minutes between ${MIN_MINUTES_BEFORE_SHIFT} and ${MAX_MINUTES_BEFORE_SHIFT} (two weeks).`,
      );
    }

    return parsed;
  }
}

export default new Service();
