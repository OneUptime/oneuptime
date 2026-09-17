import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import DatabaseService from "./DatabaseService";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import Model, {
  UserOnCallShiftReminderLogKind,
} from "../../Models/DatabaseModels/UserOnCallShiftReminderLog";
import BadDataException from "../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../Types/ObjectID";
import OneUptimeDate from "../../Types/Date";

const MILLISECONDS_PER_MINUTE: number = 60 * 1000;

const ALLOWED_KINDS: Set<string> = new Set<string>(
  Object.values(UserOnCallShiftReminderLogKind),
);

/*
 * The shift-reminder ledger. Root only, in every direction: a claim row is
 * the thing that makes "send exactly once" true, so nothing outside the
 * worker may insert, edit or remove one.
 *
 * The create hook normalises the idempotency key so two workers that compute
 * the same shift a few milliseconds apart still collide on the unique index:
 * shiftStartsAt is truncated to the minute here as well as by the worker
 * (belt and braces - the seam normalisation upstream already makes starts
 * minute-granular, this makes it a guarantee of the table rather than of one
 * caller), and minutesBeforeShift defaults to 0 for change notices.
 */
export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    if (!createBy.props.isRoot) {
      throw new NotAuthorizedException(
        "Shift reminder logs are written by the reminder worker only.",
      );
    }

    const projectId: ObjectID | undefined =
      createBy.data.projectId || createBy.props.tenantId;

    if (!projectId) {
      throw new BadDataException("projectId is required");
    }

    if (!createBy.data.userId) {
      throw new BadDataException("userId is required");
    }

    if (!createBy.data.onCallDutyPolicyScheduleId) {
      throw new BadDataException("onCallDutyPolicyScheduleId is required");
    }

    if (!createBy.data.shiftStartsAt) {
      throw new BadDataException("shiftStartsAt is required");
    }

    if (
      !createBy.data.kind ||
      !ALLOWED_KINDS.has(createBy.data.kind as string)
    ) {
      throw new BadDataException(
        `kind must be one of: ${Object.values(UserOnCallShiftReminderLogKind).join(", ")}`,
      );
    }

    createBy.data.projectId = projectId;

    createBy.data.shiftStartsAt = Service.truncateToMinute(
      OneUptimeDate.fromString(createBy.data.shiftStartsAt),
    );

    createBy.data.minutesBeforeShift = Service.validateMinutesBeforeShift(
      createBy.data.minutesBeforeShift,
    );

    if (!createBy.data.claimedAt) {
      createBy.data.claimedAt = OneUptimeDate.getCurrentDate();
    }

    return { createBy, carryForward: null };
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    if (!updateBy.props.isRoot) {
      throw new NotAuthorizedException(
        "Shift reminder logs are written by the reminder worker only.",
      );
    }

    return { updateBy, carryForward: null };
  }

  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    if (!deleteBy.props.isRoot) {
      throw new NotAuthorizedException(
        "Shift reminder logs are written by the reminder worker only.",
      );
    }

    return { deleteBy, carryForward: null };
  }

  // Zero the seconds and milliseconds. Part of the idempotency key.
  public static truncateToMinute(date: Date): Date {
    return new Date(
      Math.floor(date.getTime() / MILLISECONDS_PER_MINUTE) *
        MILLISECONDS_PER_MINUTE,
    );
  }

  /*
   * 0 (a change notice) or a positive whole number of minutes. Missing means
   * 0. Anything else is a caller bug, not a value to store.
   */
  public static validateMinutesBeforeShift(value: unknown): number {
    if (value === undefined || value === null) {
      return 0;
    }

    const parsed: number =
      typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : (value as number);

    if (typeof parsed !== "number" || !Number.isInteger(parsed) || parsed < 0) {
      throw new BadDataException(
        "minutesBeforeShift must be a whole number of minutes, 0 or more.",
      );
    }

    return parsed;
  }
}

export default new Service();
