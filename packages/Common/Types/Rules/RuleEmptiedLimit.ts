/*
 * A LIST A RULE WAS LIMITED TO, EMPTIED BY DELETES (#9066).
 *
 * A rule can be limited to records through a list: an on-call rule to the
 * incidents of some monitors, a label rule to the hosts that carry some
 * labels, an AI rule to some runbooks. An empty list puts no limit: "Leave
 * empty to match incidents from any monitor". The database takes a deleted
 * record out of every list (ON DELETE CASCADE), so deleting the last record
 * a rule was limited to used to turn "page Payments for Checkout's
 * incidents" into "page Payments for every incident", with nothing said.
 *
 * Now the rule is switched off instead, in the delete, and keeps a note of
 * why: one entry per list that lost the last records it held. The rule's
 * pages show the note, and switching the rule on again is refused while a
 * list it names is still empty, unless that same write says what the list
 * holds now (Server/Utils/Rules/RuleEmptiedLimits). The note goes when the
 * rule is switched on.
 *
 * No database, no models and no React here: the server that writes the
 * note, the dashboard that shows it and the tests read the same shape.
 */

// The most names an entry keeps; `count` says how many records there were.
export const RULE_EMPTIED_LIMIT_MAX_NAMES: number = 5;

// The longest name an entry keeps, in characters.
export const RULE_EMPTIED_LIMIT_MAX_NAME_LENGTH: number = 100;

export interface RuleEmptiedLimit {
  // The rule's list that lost the last records it held: "monitors".
  list: string;
  /*
   * The deleted records, by the names they had then - at most
   * RULE_EMPTIED_LIMIT_MAX_NAMES of them. A record with no name has none.
   */
  names: Array<string>;
  // How many of the list's records were deleted: names may hold fewer.
  count: number;
  // When they were deleted, as an ISO 8601 date.
  deletedAt: string;
  // Whether the delete switched the rule off, or found it off already.
  switchedOff: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Whether a value read from the database is one entry, as written.
export function isRuleEmptiedLimit(value: unknown): value is RuleEmptiedLimit {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value["list"] === "string" &&
    value["list"].length > 0 &&
    Array.isArray(value["names"]) &&
    value["names"].every((name: unknown): boolean => {
      return typeof name === "string";
    }) &&
    typeof value["count"] === "number" &&
    Number.isFinite(value["count"]) &&
    typeof value["deletedAt"] === "string" &&
    typeof value["switchedOff"] === "boolean"
  );
}

/*
 * A rule's note as the database holds it: its entries, the ones that are
 * not entries left out. Null, a missing column and anything else read as
 * no note.
 */
export function readRuleEmptiedLimits(value: unknown): Array<RuleEmptiedLimit> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(isRuleEmptiedLimit);
}

// A record's name as an entry keeps it: trimmed, and cut to its length.
export function toRuleEmptiedLimitName(name: unknown): string {
  if (typeof name !== "string") {
    return "";
  }

  const trimmed: string = name.trim();

  return trimmed.length > RULE_EMPTIED_LIMIT_MAX_NAME_LENGTH
    ? `${trimmed.slice(0, RULE_EMPTIED_LIMIT_MAX_NAME_LENGTH - 1)}…`
    : trimmed;
}

/*
 * The entry a delete writes for one list: the names of the records it
 * deleted from it (the first ones, in name order), how many, and when.
 */
export function buildRuleEmptiedLimit(data: {
  list: string;
  names: Array<string>;
  deletedAt: Date;
  switchedOff: boolean;
}): RuleEmptiedLimit {
  const names: Array<string> = data.names
    .map(toRuleEmptiedLimitName)
    .filter((name: string): boolean => {
      return name.length > 0;
    })
    .sort((a: string, b: string): number => {
      return a.localeCompare(b);
    });

  return {
    list: data.list,
    names: names.slice(0, RULE_EMPTIED_LIMIT_MAX_NAMES),
    count: Math.max(data.names.length, 1),
    deletedAt: data.deletedAt.toISOString(),
    switchedOff: data.switchedOff,
  };
}

/*
 * A rule's note with new entries added. A list already in it is said once:
 * by its newest entry, which keeps that the rule was switched off if either
 * entry says so.
 */
export function addRuleEmptiedLimits(
  existing: unknown,
  added: Array<RuleEmptiedLimit>,
): Array<RuleEmptiedLimit> {
  const byList: Map<string, RuleEmptiedLimit> = new Map<
    string,
    RuleEmptiedLimit
  >();

  for (const entry of [...readRuleEmptiedLimits(existing), ...added]) {
    const before: RuleEmptiedLimit | undefined = byList.get(entry.list);

    byList.set(entry.list, {
      ...entry,
      switchedOff: entry.switchedOff || Boolean(before?.switchedOff),
    });
  }

  return Array.from(byList.values());
}

/*
 * The names of an entry as a sentence lists them: "Checkout", "Checkout and
 * Billing", "Checkout, Billing and 3 more". An entry without names (the
 * records had none) reads "1 record" or "3 records". English: the dashboard
 * builds its own words from the entry.
 */
export function describeRuleEmptiedLimitNames(limit: RuleEmptiedLimit): string {
  const names: Array<string> = limit.names.slice(
    0,
    RULE_EMPTIED_LIMIT_MAX_NAMES,
  );
  const more: number = Math.max(limit.count - names.length, 0);

  if (names.length === 0) {
    return `${limit.count} ${limit.count === 1 ? "record" : "records"}`;
  }

  if (more > 0) {
    return `${names.join(", ")} and ${more} more`;
  }

  if (names.length === 1) {
    return names[0]!;
  }

  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
