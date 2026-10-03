import EventInterval from "../Events/EventInterval";
import Recurring from "../Events/Recurring";
import BadDataException from "../Exception/BadDataException";
import { JSONObject } from "../JSON";
import ObjectID from "../ObjectID";
import { readMiscDataId } from "./MiscDataId";
import { getDefaultLayerRotation } from "./ScheduleLayerDefaults";

/*
 * WHO TAKES TURNS.
 *
 * A new on-call schedule used to cover nobody: Create On-Call Schedule asked
 * for a name, a time zone and a description, and the schedule only put
 * anyone on call once a layer had been added on its Layers page and people
 * added to it one at a time. A policy that escalated to it paged no one
 * meanwhile. Now the create form also asks "Who takes turns?", with the
 * people picker.
 *
 * The picks travel with the create as misc data: the people under
 * firstLayerUsers (user ids, in the order they take turns) and, when the form
 * says how long each turn lasts, that rotation under firstLayerRotation (a
 * Recurring, as a layer's own rotation is written). The server reads them
 * here and, once the schedule exists, adds its first layer - "Layer 1", on
 * call from now, handing off once per rotation - with those people in that
 * order (OnCallDutyPolicyScheduleService.create).
 *
 * Nobody picked, or nothing sent (an API caller, Terraform, an import): no
 * layer, exactly as before.
 *
 * React-free and server-safe: the server, the dashboard and their tests read
 * it.
 */

export const SCHEDULE_FIRST_LAYER_USERS_KEY: string = "firstLayerUsers";

export const SCHEDULE_FIRST_LAYER_ROTATION_KEY: string = "firstLayerRotation";

export interface ScheduleFirstLayer {
  /*
   * Who takes turns, in the order they do: user ids, lowercased, each once.
   * Never empty.
   */
  userIds: Array<string>;
  // How long each turn lasts.
  rotation: Recurring;
}

const EVENT_INTERVALS: Array<string> = Object.values(EventInterval);

/*
 * The rotation the create asks the first layer to hand off on. Not sent:
 * the default, a week. Anything sent that is not a rotation of whole,
 * positive intervals is refused rather than replaced: the caller asked for
 * a rotation, and a layer that silently hands off on another one would page
 * the wrong person.
 */
export const readScheduleFirstLayerRotation: (value: unknown) => Recurring = (
  value: unknown,
): Recurring => {
  if (value === undefined || value === null) {
    return getDefaultLayerRotation();
  }

  const invalid: BadDataException = new BadDataException(
    `${SCHEDULE_FIRST_LAYER_ROTATION_KEY} must be a rotation: how many hours, days, weeks, months or years each turn lasts.`,
  );

  if (typeof value !== "object" || Array.isArray(value)) {
    throw invalid;
  }

  let rotation: Recurring;

  try {
    rotation =
      value instanceof Recurring
        ? value
        : Recurring.fromJSON(value as JSONObject);
  } catch {
    throw invalid;
  }

  const count: number = rotation.intervalCount?.toNumber();

  if (
    !EVENT_INTERVALS.includes(rotation.intervalType) ||
    typeof count !== "number" ||
    !Number.isInteger(count) ||
    count < 1
  ) {
    throw invalid;
  }

  // A copy of its own: the caller's value is left alone.
  return Recurring.fromJSON(rotation.toJSON());
};

/**
 * Who takes turns in a new schedule, and how long each turn lasts, read from
 * the create's misc data.
 *
 * Returns null when there is nobody: no misc data, no firstLayerUsers, or an
 * empty list - the schedule is created without layers, as before. Each
 * person is listed once (compared without case), in the order sent. A list
 * that holds something other than user ids is refused rather than skipped,
 * and so is a rotation that is not one (readScheduleFirstLayerRotation): a
 * caller who asked for people to take turns must not get a schedule that
 * silently covers nobody.
 */
export const readScheduleFirstLayer: (
  miscDataProps: JSONObject | null | undefined,
) => ScheduleFirstLayer | null = (
  miscDataProps: JSONObject | null | undefined,
): ScheduleFirstLayer | null => {
  if (
    !miscDataProps ||
    typeof miscDataProps !== "object" ||
    Array.isArray(miscDataProps)
  ) {
    return null;
  }

  // Checked even with nobody to put in the layer: a bad value is a mistake.
  const rotation: Recurring = readScheduleFirstLayerRotation(
    miscDataProps[SCHEDULE_FIRST_LAYER_ROTATION_KEY],
  );

  const value: unknown = miscDataProps[SCHEDULE_FIRST_LAYER_USERS_KEY];

  if (value === undefined || value === null) {
    return null;
  }

  if (!Array.isArray(value)) {
    throw new BadDataException(
      `${SCHEDULE_FIRST_LAYER_USERS_KEY} must be a list of user ids.`,
    );
  }

  const userIds: Array<string> = [];

  for (const entry of value) {
    const id: string | null = readMiscDataId(entry);

    if (!id || !ObjectID.isValidUUID(id)) {
      throw new BadDataException(
        `${SCHEDULE_FIRST_LAYER_USERS_KEY} must be a list of user ids. ${JSON.stringify(
          entry instanceof ObjectID ? entry.toString() : entry,
        )} is not one.`,
      );
    }

    const normalized: string = id.toLowerCase();

    if (!userIds.includes(normalized)) {
      userIds.push(normalized);
    }
  }

  if (userIds.length === 0) {
    return null;
  }

  return { userIds, rotation };
};
