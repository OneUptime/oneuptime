import BadDataException from "../Exception/BadDataException";
import { JSONObject, ObjectType } from "../JSON";
import ObjectID from "../ObjectID";

/*
 * WHO GETS PAGED FIRST.
 *
 * A new on-call policy used to page nobody: Create On-Call Policy asked for a
 * name, a description and labels, and the policy only did something once its
 * first escalation rule had been added on its Escalation Rules page. Now the
 * create form also asks "Who gets paged first?", with the picker an escalation
 * rule's Notify field uses (on-call schedules, teams and people).
 *
 * The picks travel with the create as misc data, under the keys an escalation
 * rule's own create carries its responders in (onCallSchedules, teams,
 * users: lists of ids). The server reads them here and, once the policy
 * exists, adds its first escalation rule - Level 1, waiting 30 minutes before
 * the next level - paging them (OnCallDutyPolicyService.create).
 *
 * Nothing picked, or nothing sent (an API caller, Terraform, an import): no
 * rule, exactly as before.
 *
 * React-free and server-safe: the server, the dashboard and their tests read
 * it.
 */

// The ids of who a new policy pages first, per kind of responder.
export interface FirstResponderIds {
  // On-call schedules: whoever is on call in them is paged.
  onCallSchedules: Array<string>;
  // Teams: every member is paged.
  teams: Array<string>;
  // People, paged directly.
  users: Array<string>;
}

export type FirstResponderKey = keyof FirstResponderIds;

/*
 * The misc data keys, in the order a rule's card lists its responders. They
 * are an escalation rule's own (OnCallDutyPolicyEscalationRuleService
 * turns them into the rule's join rows), so the picks are handed to the new
 * rule as they came.
 */
export const FIRST_RESPONDER_KEYS: Array<FirstResponderKey> = [
  "onCallSchedules",
  "teams",
  "users",
];

// What one id in each list names, for the messages below.
const RESPONDER_NAMES: Record<FirstResponderKey, string> = {
  onCallSchedules: "on-call schedule",
  teams: "team",
  users: "user",
};

export const getEmptyFirstResponderIds: () => FirstResponderIds =
  (): FirstResponderIds => {
    return { onCallSchedules: [], teams: [], users: [] };
  };

export const countFirstResponders: (ids: FirstResponderIds) => number = (
  ids: FirstResponderIds,
): number => {
  return FIRST_RESPONDER_KEYS.reduce(
    (count: number, key: FirstResponderKey): number => {
      return count + ids[key].length;
    },
    0,
  );
};

/*
 * The id one entry of a list names: a string (what the dashboard sends), an
 * ObjectID (what the API's deserializer makes of { _type: "ObjectID" }), or
 * that JSON itself when a caller inside the server passes it on.
 */
const readId: (entry: unknown) => string | null = (
  entry: unknown,
): string | null => {
  if (typeof entry === "string") {
    return entry.trim() || null;
  }

  if (entry instanceof ObjectID) {
    return entry.toString().trim() || null;
  }

  if (entry && typeof entry === "object" && !Array.isArray(entry)) {
    const record: JSONObject = entry as JSONObject;

    if (
      record["_type"] === ObjectType.ObjectID &&
      typeof record["value"] === "string"
    ) {
      return record["value"].trim() || null;
    }
  }

  return null;
};

/**
 * Who a policy create asks to page first, read from its misc data.
 *
 * Returns null when there is nobody: no misc data, none of the three keys, or
 * only empty lists - the policy is created without a rule, as before. Each id
 * is listed once (compared without case). A key that holds something other
 * than a list of ids is refused rather than skipped: a caller who asked for
 * someone to be paged must not get a policy that silently pages nobody.
 */
export const readFirstResponderIds: (
  miscDataProps: JSONObject | null | undefined,
) => FirstResponderIds | null = (
  miscDataProps: JSONObject | null | undefined,
): FirstResponderIds | null => {
  if (
    !miscDataProps ||
    typeof miscDataProps !== "object" ||
    Array.isArray(miscDataProps)
  ) {
    return null;
  }

  const ids: FirstResponderIds = getEmptyFirstResponderIds();

  for (const key of FIRST_RESPONDER_KEYS) {
    const value: unknown = miscDataProps[key];

    if (value === undefined || value === null) {
      continue;
    }

    if (!Array.isArray(value)) {
      throw new BadDataException(
        `${key} must be a list of ${RESPONDER_NAMES[key]} ids.`,
      );
    }

    for (const entry of value) {
      const id: string | null = readId(entry);

      if (!id || !ObjectID.isValidUUID(id)) {
        throw new BadDataException(
          `${key} must be a list of ${RESPONDER_NAMES[key]} ids. ${JSON.stringify(
            entry instanceof ObjectID ? entry.toString() : entry,
          )} is not one.`,
        );
      }

      const normalized: string = id.toLowerCase();

      if (!ids[key].includes(normalized)) {
        ids[key].push(normalized);
      }
    }
  }

  return countFirstResponders(ids) > 0 ? ids : null;
};
