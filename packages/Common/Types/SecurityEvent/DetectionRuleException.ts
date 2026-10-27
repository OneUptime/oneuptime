import {
  SecurityEntityType,
  isIpAddress,
} from "../SecurityCase/SecurityEntity";

/*
 * DETECTION RULE EXCEPTIONS: WHAT A DETECTION RULE SKIPS.
 *
 * A rule that fires on something expected - the vulnerability scanner, the
 * nightly backup job, a planned penetration test - is tuned with an
 * exception rather than turned off or rewritten. An exception names one
 * thing the rule skips:
 *
 *   - an entity: a user, a host or an IP address, wherever an event names
 *     it (as who acted, as who was acted on, or among its observables);
 *   - a value: one event field's value, such as processName backup.exe;
 *   - a time window: every event between two times.
 *
 * Each says why it is safe to skip (its reason), and who added it and when
 * are kept with it. An entity or a value can expire: after its expiry the
 * rule sees it again. A time window ends by itself, so it has no expiry.
 *
 * Values are matched whatever the case, and * stands for any run of
 * characters, as Protected Entities and Entity Criticality match theirs:
 * svc-* skips every service account, *.corp.example.com every host of a
 * domain. An IP address may also be a range: 10.20.0.0/16.
 *
 * Skipped events are left out before the rule counts anything: they never
 * reach its Match Count Threshold, open nothing and add no risk. Exceptions
 * apply to the rule's scheduled runs and to its runs on past events, and
 * never to a test attack (Send a test attack checks that the pipeline
 * works, and must not be hidden by them).
 *
 * Kept free of anything server-side: the Dashboard's form and list read the
 * same rules the server enforces.
 */

export enum DetectionRuleExceptionKind {
  Entity = "Entity",
  Value = "Value",
  TimeWindow = "Time Window",
}

// The kinds, in the order the form offers them.
export const DETECTION_RULE_EXCEPTION_KINDS: ReadonlyArray<DetectionRuleExceptionKind> =
  [
    DetectionRuleExceptionKind.Entity,
    DetectionRuleExceptionKind.Value,
    DetectionRuleExceptionKind.TimeWindow,
  ];

/*
 * Who an entity exception can name: the users, hosts and addresses a
 * detection is about. Domains, URLs and hashes are threat intel's to judge;
 * a value exception skips one of them in a field when it must.
 */
export const DETECTION_RULE_EXCEPTION_ENTITY_TYPES: ReadonlyArray<SecurityEntityType> =
  [
    SecurityEntityType.User,
    SecurityEntityType.Host,
    SecurityEntityType.IpAddress,
  ];

/*
 * The event fields an entity of each kind is read from, beside the event's
 * observables: as who acted, and as who was acted on.
 */
export const DETECTION_RULE_EXCEPTION_ENTITY_FIELDS: Readonly<
  Record<string, ReadonlyArray<string>>
> = {
  [SecurityEntityType.User]: ["principalUser", "targetUser"],
  [SecurityEntityType.Host]: ["principalHost", "targetHost"],
  [SecurityEntityType.IpAddress]: ["principalIp", "targetIp"],
};

export const DETECTION_RULE_EXCEPTION_VALUE_MAX_LENGTH: number = 500;
export const DETECTION_RULE_EXCEPTION_FIELD_MAX_LENGTH: number = 100;
export const DETECTION_RULE_EXCEPTION_REASON_MAX_LENGTH: number = 500;

/*
 * The longest time window: a window hides everything the rule would see in
 * it, so it is for a planned change or test, not a way to switch a rule off
 * (which the rule's Enabled switch says plainly).
 */
export const DETECTION_RULE_EXCEPTION_WINDOW_MAX_IN_DAYS: number = 30;

/*
 * The most exceptions one rule keeps. Every one is a condition on every
 * event the rule reads, so the list stays short enough to read - and to
 * review.
 */
export const DETECTION_RULE_EXCEPTIONS_PER_RULE_MAX: number = 100;

export const DETECTION_RULE_EXCEPTION_WILDCARD: string = "*";

// A CIDR prefix length: one to three digits.
const CIDR_PREFIX_REGEX: RegExp = /^\d{1,3}$/;

// Any whitespace: a field name has none.
const WHITESPACE_REGEX: RegExp = /\s/;

// Where an exception stands now, as its list shows it.
export enum DetectionRuleExceptionStatus {
  // Skipping: an entity or a value with no expiry or one still ahead, or a window under way.
  Active = "Active",
  // An entity or a value past its expiry: the rule sees it again.
  Expired = "Expired",
  // A window that has not started yet.
  Upcoming = "Upcoming",
  // A window that is over.
  Ended = "Ended",
}

/*
 * An exception as the rules here read it: the stored row, or a form's
 * values. Every field may be missing.
 */
export interface DetectionRuleExceptionShape {
  kind?: string | null | undefined;
  entityType?: string | null | undefined;
  fieldName?: string | null | undefined;
  value?: string | null | undefined;
  startsAt?: Date | string | null | undefined;
  endsAt?: Date | string | null | undefined;
  expiresAt?: Date | string | null | undefined;
  reason?: string | null | undefined;
}

export function isDetectionRuleExceptionKind(
  value: unknown,
): value is DetectionRuleExceptionKind {
  return (
    typeof value === "string" &&
    (DETECTION_RULE_EXCEPTION_KINDS as ReadonlyArray<string>).includes(value)
  );
}

export function isDetectionRuleExceptionEntityType(
  value: unknown,
): value is SecurityEntityType {
  return (
    typeof value === "string" &&
    (DETECTION_RULE_EXCEPTION_ENTITY_TYPES as ReadonlyArray<string>).includes(
      value,
    )
  );
}

// A date from a row or a form: a Date, or text one parses from; null for anything else.
export function readDetectionRuleExceptionDate(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === "string" && value.trim()) {
    const date: Date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  return null;
}

// A value or pattern as stored: trimmed, with no run of wildcards.
export function normalizeDetectionRuleExceptionValue(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }

  let text: string = value.trim();

  while (text.includes("**")) {
    text = text.split("**").join("*");
  }

  return text;
}

// A field name as stored: trimmed.
export function normalizeDetectionRuleExceptionField(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/*
 * Whether the text is an address range written as CIDR: an IPv4 or IPv6
 * address, a slash and a prefix length the address can have (0-32, 0-128).
 */
export function isDetectionRuleExceptionCidr(value: string): boolean {
  const text: string = (value || "").trim();
  const slash: number = text.indexOf("/");

  if (slash <= 0 || slash !== text.lastIndexOf("/")) {
    return false;
  }

  const address: string = text.slice(0, slash);
  const prefix: string = text.slice(slash + 1);

  if (!CIDR_PREFIX_REGEX.test(prefix) || !isIpAddress(address)) {
    return false;
  }

  const length: number = Number(prefix);
  const maximum: number = address.includes(":") ? 128 : 32;

  return length >= 0 && length <= maximum;
}

/*
 * Where the exception stands at `now`. A window is judged by its own times;
 * an entity or a value by its expiry, and with none it is active for good.
 */
export function getDetectionRuleExceptionStatus(
  exception: DetectionRuleExceptionShape,
  now: Date,
): DetectionRuleExceptionStatus {
  if (exception.kind === DetectionRuleExceptionKind.TimeWindow) {
    const startsAt: Date | null = readDetectionRuleExceptionDate(
      exception.startsAt,
    );
    const endsAt: Date | null = readDetectionRuleExceptionDate(
      exception.endsAt,
    );

    if (endsAt && endsAt.getTime() <= now.getTime()) {
      return DetectionRuleExceptionStatus.Ended;
    }

    if (startsAt && startsAt.getTime() > now.getTime()) {
      return DetectionRuleExceptionStatus.Upcoming;
    }

    return DetectionRuleExceptionStatus.Active;
  }

  const expiresAt: Date | null = readDetectionRuleExceptionDate(
    exception.expiresAt,
  );

  if (expiresAt && expiresAt.getTime() <= now.getTime()) {
    return DetectionRuleExceptionStatus.Expired;
  }

  return DetectionRuleExceptionStatus.Active;
}

/*
 * Whether the exception takes part in a read of the events from `from` to
 * `until`, made at `now`: an entity or a value that has not expired by now
 * (an expired one is kept on the list, and skips nothing); a window that
 * overlaps the read, whenever that is - a window is about the events in it,
 * so a run on past events skips last week's planned test too.
 */
export function doesDetectionRuleExceptionApply(
  exception: DetectionRuleExceptionShape,
  read: { from: Date; until: Date; now: Date },
): boolean {
  if (!isDetectionRuleExceptionKind(exception.kind)) {
    return false;
  }

  if (exception.kind === DetectionRuleExceptionKind.TimeWindow) {
    const startsAt: Date | null = readDetectionRuleExceptionDate(
      exception.startsAt,
    );
    const endsAt: Date | null = readDetectionRuleExceptionDate(
      exception.endsAt,
    );

    if (!startsAt || !endsAt || endsAt.getTime() <= startsAt.getTime()) {
      return false;
    }

    return (
      startsAt.getTime() < read.until.getTime() &&
      endsAt.getTime() > read.from.getTime()
    );
  }

  return (
    getDetectionRuleExceptionStatus(exception, read.now) ===
    DetectionRuleExceptionStatus.Active
  );
}

/*
 * What is wrong with an exception, in the words the form and the API answer
 * with; null when nothing is. `now` is when it is saved: an expiry is
 * checked against it only when `isExpiryNew` (a new exception, or a changed
 * expiry), so an exception that expired can still have its reason edited.
 */
export function getDetectionRuleExceptionProblem(
  exception: DetectionRuleExceptionShape,
  options: { now: Date; isExpiryNew: boolean },
): string | null {
  if (!isDetectionRuleExceptionKind(exception.kind)) {
    return "Choose what the rule skips: an entity, a value or a time window.";
  }

  if (exception.kind === DetectionRuleExceptionKind.Entity) {
    if (!isDetectionRuleExceptionEntityType(exception.entityType)) {
      return "Choose the kind of entity: a user, a host or an IP address.";
    }

    const problem: string | null = getValueProblem(
      exception.value,
      "Enter the user, host or address the rule skips.",
    );

    if (problem) {
      return problem;
    }

    const value: string = normalizeDetectionRuleExceptionValue(exception.value);

    // An address with a slash is a range, and must be one.
    if (
      exception.entityType === SecurityEntityType.IpAddress &&
      value.includes("/") &&
      !isDetectionRuleExceptionCidr(value)
    ) {
      return "Enter an address, a range such as 10.20.0.0/16, or a pattern with *.";
    }
  }

  if (exception.kind === DetectionRuleExceptionKind.Value) {
    const field: string = normalizeDetectionRuleExceptionField(
      exception.fieldName,
    );

    if (!field) {
      return "Enter the event field to match, such as processName.";
    }

    if (field.length > DETECTION_RULE_EXCEPTION_FIELD_MAX_LENGTH) {
      return `A field name is at most ${DETECTION_RULE_EXCEPTION_FIELD_MAX_LENGTH} characters.`;
    }

    if (WHITESPACE_REGEX.test(field)) {
      return "A field name has no spaces: principalUser, processName or an attribute key such as user.name.";
    }

    const problem: string | null = getValueProblem(
      exception.value,
      "Enter the value the rule skips.",
    );

    if (problem) {
      return problem;
    }
  }

  if (exception.kind === DetectionRuleExceptionKind.TimeWindow) {
    const startsAt: Date | null = readDetectionRuleExceptionDate(
      exception.startsAt,
    );
    const endsAt: Date | null = readDetectionRuleExceptionDate(
      exception.endsAt,
    );

    if (!startsAt || !endsAt) {
      return "Enter when the window starts and when it ends.";
    }

    if (endsAt.getTime() <= startsAt.getTime()) {
      return "The window must end after it starts.";
    }

    if (
      endsAt.getTime() - startsAt.getTime() >
      DETECTION_RULE_EXCEPTION_WINDOW_MAX_IN_DAYS * 24 * 60 * 60 * 1000
    ) {
      return `A window is at most ${DETECTION_RULE_EXCEPTION_WINDOW_MAX_IN_DAYS} days. To stop a rule for longer, turn it off.`;
    }
  } else if (options.isExpiryNew) {
    const expiresAt: Date | null = readDetectionRuleExceptionDate(
      exception.expiresAt,
    );

    if (exception.expiresAt && !expiresAt) {
      return "Enter when the exception expires, or leave it empty.";
    }

    if (expiresAt && expiresAt.getTime() <= options.now.getTime()) {
      return "An exception expires in the future. To stop one now, delete it.";
    }
  }

  const reason: string =
    typeof exception.reason === "string" ? exception.reason.trim() : "";

  if (!reason) {
    return "Say why it is safe for the rule to skip this.";
  }

  if (reason.length > DETECTION_RULE_EXCEPTION_REASON_MAX_LENGTH) {
    return `A reason is at most ${DETECTION_RULE_EXCEPTION_REASON_MAX_LENGTH} characters.`;
  }

  return null;
}

function getValueProblem(value: unknown, emptyMessage: string): string | null {
  const text: string = normalizeDetectionRuleExceptionValue(value);

  if (!text || text === DETECTION_RULE_EXCEPTION_WILDCARD) {
    // A lone * would skip everything: that is turning the rule off.
    return text === DETECTION_RULE_EXCEPTION_WILDCARD
      ? "A value of only * would skip everything. To stop the rule, turn it off."
      : emptyMessage;
  }

  if (text.length > DETECTION_RULE_EXCEPTION_VALUE_MAX_LENGTH) {
    return `A value is at most ${DETECTION_RULE_EXCEPTION_VALUE_MAX_LENGTH} characters.`;
  }

  return null;
}

/*
 * The exception as it is stored: the columns of its kind kept, normalized,
 * and the others cleared, so a row never carries a stale field of a kind it
 * no longer is. Null clears a column.
 */
export interface DetectionRuleExceptionColumns {
  entityType: SecurityEntityType | null;
  fieldName: string | null;
  value: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
  expiresAt: Date | null;
  reason: string;
}

export function getDetectionRuleExceptionColumns(
  exception: DetectionRuleExceptionShape,
): DetectionRuleExceptionColumns {
  const reason: string =
    typeof exception.reason === "string" ? exception.reason.trim() : "";

  if (exception.kind === DetectionRuleExceptionKind.TimeWindow) {
    return {
      entityType: null,
      fieldName: null,
      value: null,
      startsAt: readDetectionRuleExceptionDate(exception.startsAt),
      endsAt: readDetectionRuleExceptionDate(exception.endsAt),
      expiresAt: null,
      reason,
    };
  }

  const isEntity: boolean =
    exception.kind === DetectionRuleExceptionKind.Entity;

  return {
    entityType:
      isEntity && isDetectionRuleExceptionEntityType(exception.entityType)
        ? exception.entityType
        : null,
    fieldName: isEntity
      ? null
      : normalizeDetectionRuleExceptionField(exception.fieldName) || null,
    value: normalizeDetectionRuleExceptionValue(exception.value) || null,
    startsAt: null,
    endsAt: null,
    expiresAt: readDetectionRuleExceptionDate(exception.expiresAt),
    reason,
  };
}

// How long a window is, in whole minutes (at least one), for the list's "for 4 hours".
export function getDetectionRuleExceptionWindowMinutes(
  exception: DetectionRuleExceptionShape,
): number | null {
  const startsAt: Date | null = readDetectionRuleExceptionDate(
    exception.startsAt,
  );
  const endsAt: Date | null = readDetectionRuleExceptionDate(exception.endsAt);

  if (!startsAt || !endsAt || endsAt.getTime() <= startsAt.getTime()) {
    return null;
  }

  return Math.max(
    1,
    Math.round((endsAt.getTime() - startsAt.getTime()) / (60 * 1000)),
  );
}
