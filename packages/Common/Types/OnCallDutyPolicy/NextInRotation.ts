import BadDataException from "../Exception/BadDataException";
import { JSONObject } from "../JSON";
import ObjectID from "../ObjectID";
import { readMiscDataId } from "./MiscDataId";

/*
 * "NEXT IN ROTATION": A BACKUP FROM THE SAME ROTATION.
 *
 * An escalation rule can page an on-call schedule two ways: whoever is on
 * call in it (as every schedule of a rule always did), or the next person
 * in its rotation - the person after whoever is on call, in the same layer's
 * turn order, passing over anyone who is away (a user override) and whoever
 * is on call already. The recommended ladder pages the schedule at one
 * level and its next person at the level after, then a team:
 *
 *   Level 1  Primary                    whoever is on call
 *   Level 2  Primary, next in rotation  the backup, from the same rotation
 *   Level 3  Platform team              everybody
 *
 * One schedule is the source of truth: there is no second "backup" schedule
 * to keep in step with the first, and its skips, covers and swaps count for
 * both levels.
 *
 * Where it is written down:
 *
 *   - the rule's schedule row (OnCallDutyPolicyEscalationRuleSchedule.
 *     pageNextInRotation), set when the schedule is added to the rule;
 *   - the API's and the dashboard's create of a rule: its schedules picked
 *     as "Next in rotation" travel as misc data under
 *     NEXT_IN_ROTATION_SCHEDULES_KEY, next to onCallSchedules, teams and
 *     users;
 *   - the run's timeline (OnCallDutyPolicyExecutionLogTimeline.
 *     isNextInRotation): a person paged as the next in the rotation, or the
 *     line saying nobody was (NOBODY_NEXT_IN_ROTATION_TIMELINE_MESSAGE).
 *
 * Who it is: ScheduleResolution.resolveNextInRotation, through
 * OnCallDutyPolicyScheduleService.getNextInRotationInSchedule.
 *
 * React-free and server-safe: the server, the dashboard and their tests read
 * it.
 */

/*
 * The misc data key of a rule create that names the schedules whose next
 * person in the rotation the rule pages (lists of schedule ids), as
 * "onCallSchedules" names those whose on-call person it pages.
 */
export const NEXT_IN_ROTATION_SCHEDULES_KEY: string = "nextInRotationSchedules";

/**
 * The schedules a rule create asks to page the next person in the rotation
 * of, read from its misc data (NEXT_IN_ROTATION_SCHEDULES_KEY): each id
 * once, compared without case. Empty when the key is absent or null.
 *
 * Anything but a list of ids is refused rather than skipped - a caller who
 * asked for a backup to be paged must not get a rule that silently pages
 * nobody - and it is read before the rule is created, so a refused create
 * leaves nothing behind.
 */
export const readNextInRotationScheduleIds: (
  miscDataProps: JSONObject | null | undefined,
) => Array<string> = (
  miscDataProps: JSONObject | null | undefined,
): Array<string> => {
  if (
    !miscDataProps ||
    typeof miscDataProps !== "object" ||
    Array.isArray(miscDataProps)
  ) {
    return [];
  }

  const value: unknown = miscDataProps[NEXT_IN_ROTATION_SCHEDULES_KEY];

  if (value === undefined || value === null) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new BadDataException(
      `${NEXT_IN_ROTATION_SCHEDULES_KEY} must be a list of on-call schedule ids.`,
    );
  }

  const ids: Array<string> = [];

  for (const entry of value) {
    const id: string | null = readMiscDataId(entry);

    if (!id || !ObjectID.isValidUUID(id)) {
      throw new BadDataException(
        `${NEXT_IN_ROTATION_SCHEDULES_KEY} must be a list of on-call schedule ids. ${JSON.stringify(
          entry instanceof ObjectID ? entry.toString() : entry,
        )} is not one.`,
      );
    }

    const normalized: string = id.toLowerCase();

    if (!ids.includes(normalized)) {
      ids.push(normalized);
    }
  }

  return ids;
};

/*
 * The run's timeline line for a schedule whose next person a rule would
 * have paged when somebody is on call in it but nobody is next: the
 * rotation has nobody else in it, or everybody else in it is away. A
 * schedule with nobody on call at all says so in its own words, as for a
 * page to the schedule ("no active users are found in this schedule").
 */
export const NOBODY_NEXT_IN_ROTATION_TIMELINE_MESSAGE: string =
  "Skipped because nobody is next in this schedule's rotation: it has nobody else in it, or everybody else in it is away.";
