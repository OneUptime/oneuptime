import Model from "../../Models/DatabaseModels/CloudOffHoursSchedule";
import {
  CLOUD_OFF_HOURS_DEFAULT_DAYS,
  CLOUD_OFF_HOURS_DEFAULT_START,
  CLOUD_OFF_HOURS_DEFAULT_STOP,
  getCloudOffHoursScheduleProblem,
} from "../../Types/Cloud/CloudOffHours";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import CreateBy from "../Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import UpdateBy from "../Types/Database/UpdateBy";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import ProjectReferencesService from "./ProjectReferencesService";

/*
 * An off-hours schedule (CloudOffHoursSchedule, #11010): its hours, days,
 * time zone and tag are checked as they are written, so a schedule never
 * reads its hours one way and stops resources another
 * (Types/Cloud/CloudOffHours). A new schedule runs its resources Monday to
 * Friday, 08:00 to 19:00, in UTC, unless it says otherwise. The worker
 * (CloudOffHoursScheduler) stops and starts what it picks.
 */
export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  // What a write says, trimmed as it is kept; refused with what to change.
  public static assertFits(values: JSONObject): void {
    const problem: string | null = getCloudOffHoursScheduleProblem(values);

    if (problem) {
      throw new BadDataException(problem);
    }
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    await super.onBeforeCreate(createBy);

    const data: Model = createBy.data;

    data.timezone = (data.timezone || "UTC").trim();
    data.startTime = (data.startTime || CLOUD_OFF_HOURS_DEFAULT_START).trim();
    data.stopTime = (data.stopTime || CLOUD_OFF_HOURS_DEFAULT_STOP).trim();
    data.workingDays =
      Array.isArray(data.workingDays) && data.workingDays.length > 0
        ? data.workingDays
        : [...CLOUD_OFF_HOURS_DEFAULT_DAYS];
    data.tagKey = (data.tagKey || "").trim();
    data.tagValue = (data.tagValue || "").trim();

    Service.assertFits({
      timezone: data.timezone,
      startTime: data.startTime,
      stopTime: data.stopTime,
      workingDays: data.workingDays,
      tagKey: data.tagKey,
      tagValue: data.tagValue,
    });

    return { createBy, carryForward: null };
  }

  /*
   * An edit is checked for what it writes; a stop time written alone is
   * checked against itself (the start it is compared with is read by the
   * form, which writes both).
   */
  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    await super.onBeforeUpdate(updateBy);

    const data: JSONObject = (updateBy.data || {}) as unknown as JSONObject;
    const written: JSONObject = {};

    for (const key of [
      "timezone",
      "startTime",
      "stopTime",
      "workingDays",
      "tagKey",
      "tagValue",
    ]) {
      if (data[key] !== undefined) {
        written[key] =
          typeof data[key] === "string"
            ? (data[key] as string).trim()
            : data[key];
        (data as Record<string, unknown>)[key] = written[key];
      }
    }

    Service.assertFits(written);

    return { updateBy, carryForward: null };
  }
}

export default new Service();
