import { formatShiftInstant } from "./LayerSummary";
import Dictionary from "Common/Types/Dictionary";
import OneUptimeDate from "Common/Types/Date";
import {
  OverrideEventMeta,
  UserOverrideRecord,
} from "Common/Types/OnCallDutyPolicy/UserOverrideUtil";

/*
 * Every word the schedule screens use to describe a user override lives here.
 *
 * The screens answer one question — who gets paged — and an override is the
 * case where the honest answer has two names in it: the person the rotation put
 * on call, and the person their alerts are actually going to. The calendar used
 * to render only the second, in the substitute's own colour, which reads
 * exactly like an ordinary shift; a reader could not tell that a substitution
 * had happened at all, let alone whose. https://github.com/OneUptime/oneuptime
 *
 * Keeping the wording in one pure module means the block label, its tooltip,
 * the banner above the grid, the legend and the "on call right now" card cannot
 * describe the same substitution three different ways — and it means all of
 * them are testable without mounting a calendar.
 */

export interface OverrideUserDisplayInfo {
  name: string;
  email: string;
}

/*
 * The marker prefixed to an overridden block's label. A week-view column is
 * often too narrow for a name, let alone two, so the FIRST characters are the
 * only ones guaranteed to survive - which is why the cue that this block is a
 * substitution goes at the very front rather than in a trailing suffix.
 */
export const OVERRIDE_TITLE_MARKER: string = "⇄";

/*
 * The class the calendar puts on an overridden block. Defined here rather than
 * inline at the call site so the stylesheet rule
 * (.oneuptime-calendar-event--override in Common/UI/Components/Calendar/
 * Calendar.css) and the code that asks for it are greppable from each other.
 */
export const OVERRIDE_EVENT_CLASS_NAME: string =
  "oneuptime-calendar-event--override";

// Shown on the label/legend when a user has no name or email loaded.
export const UNKNOWN_USER_LABEL: string = "Unknown user";

export function getUserDisplayName(
  info: OverrideUserDisplayInfo | undefined,
): string {
  if (!info) {
    return UNKNOWN_USER_LABEL;
  }
  return info.name || info.email || UNKNOWN_USER_LABEL;
}

// "Alice Scheduled (alice@example.com)" when both are known.
export function formatUserLabel(
  info: OverrideUserDisplayInfo | undefined,
): string {
  if (!info) {
    return UNKNOWN_USER_LABEL;
  }
  if (info.name && info.email) {
    return `${info.name} (${info.email})`;
  }
  return info.name || info.email || UNKNOWN_USER_LABEL;
}

/*
 * Whether an override applies through every policy or through exactly one.
 *
 * This is the difference the user themselves chose when they created it: from
 * the project's On-Call Duty > User Overrides page (global) or from a single
 * policy's own User Overrides tab (scoped). A screen that shows the
 * substitution without the scope leaves the reader unable to answer "will this
 * cover the page I actually care about?", which for a policy-scoped override is
 * frequently no.
 */
export enum OverrideScopeKind {
  Global = "Global",
  Policy = "Policy",
}

export interface OverrideScopeDescription {
  kind: OverrideScopeKind;
  // Short enough for a pill: "Global override", "Only for Database On-Call".
  label: string;
  // A full sentence for tooltips and help text.
  detail: string;
}

export function describeOverrideScope(data: {
  onCallDutyPolicyId?: string | null | undefined;
  policyName?: string | undefined;
}): OverrideScopeDescription {
  if (!data.onCallDutyPolicyId) {
    return {
      kind: OverrideScopeKind.Global,
      label: "Global override",
      detail:
        "This is a global override, so it applies to every on-call policy that escalates to this schedule.",
    };
  }

  /*
   * The name is fetched alongside the override, but a policy the viewer cannot
   * read (or one deleted between the two reads) leaves it blank. Say
   * "policy-scoped" rather than inventing a name or, worse, falling back to
   * "global" - claiming wider coverage than exists is the one error here that
   * could send somebody to bed expecting a page that never comes.
   */
  if (!data.policyName) {
    return {
      kind: OverrideScopeKind.Policy,
      label: "Policy override",
      detail:
        "This override is scoped to one on-call policy, so it only re-routes alerts escalating through that policy.",
    };
  }

  return {
    kind: OverrideScopeKind.Policy,
    label: `Only for ${data.policyName}`,
    detail: `This override is scoped to the ${data.policyName} policy, so it only re-routes alerts escalating through ${data.policyName}.`,
  };
}

/*
 * The label painted on an overridden calendar block.
 *
 * The substitute comes first because the block's primary job is still "who is
 * on call in this slot", and that is them. What follows says whose slot it is.
 */
export function formatOverrideEventTitle(data: {
  substituteName: string;
  originalName: string;
}): string {
  return `${OVERRIDE_TITLE_MARKER} ${data.substituteName} (covering ${data.originalName})`;
}

/*
 * The hover text for an overridden block. Multi-line on purpose: this is where
 * a reader goes when the block itself is too narrow to have told them anything,
 * so it repeats the whole substitution rather than assuming the label was read.
 */
export function buildOverrideEventTooltip(data: {
  substituteName: string;
  originalName: string;
  overrideStartsAt: Date;
  overrideEndsAt: Date;
  scope: OverrideScopeDescription;
  timezone?: string | undefined;
}): string {
  return [
    `Override: ${data.originalName} → ${data.substituteName}`,
    `Alerts that would page ${data.originalName} go to ${data.substituteName}.`,
    `Override window: ${formatShiftInstant(
      data.overrideStartsAt,
      data.timezone,
    )} → ${formatShiftInstant(data.overrideEndsAt, data.timezone)}`,
    data.scope.detail,
  ].join("\n");
}

// The label for a block with nobody substituted in - an ordinary shift.
export function buildPlainEventTooltip(data: {
  userLabel: string;
  start: Date;
  end: Date;
  timezone?: string | undefined;
}): string {
  return [
    `On call: ${data.userLabel}`,
    `${formatShiftInstant(data.start, data.timezone)} → ${formatShiftInstant(
      data.end,
      data.timezone,
    )}`,
  ].join("\n");
}

/*
 * One row of the "Active overrides" panel: the whole substitution stated once,
 * in the order the reader asks it - who was overridden, who is being paged
 * instead, for how long, and under what scope.
 */
export interface OverrideSummaryRow {
  key: string;
  originalUserId: string;
  originalName: string;
  substituteUserId: string;
  substituteName: string;
  startsAt: Date;
  endsAt: Date;
  scope: OverrideScopeDescription;
  // True when the override is in force at the instant the panel was built.
  isActiveNow: boolean;
}

/*
 * Turn the fetched override records into panel rows, newest-starting first
 * among the ones already running.
 *
 * Records whose window has entirely passed are dropped: the panel sits above a
 * calendar the reader can navigate into the past, but its claim is about what
 * is in force, and listing a finished substitution there would read as one that
 * still applies.
 */
export function buildOverrideSummaryRows(data: {
  records: Array<UserOverrideRecord>;
  userInfoById: Dictionary<OverrideUserDisplayInfo>;
  policyNameById: Dictionary<string>;
  now: Date;
}): Array<OverrideSummaryRow> {
  const rows: Array<OverrideSummaryRow> = [];

  for (const record of data.records) {
    if (OneUptimeDate.isOnOrBefore(record.endsAt, data.now)) {
      continue;
    }

    const policyId: string = record.onCallDutyPolicyId || "";

    rows.push({
      key: `${record.overrideUserId}-${record.routeAlertsToUserId}-${record.startsAt.getTime()}-${record.endsAt.getTime()}-${policyId}`,
      originalUserId: record.overrideUserId,
      originalName: getUserDisplayName(
        data.userInfoById[record.overrideUserId],
      ),
      substituteUserId: record.routeAlertsToUserId,
      substituteName: getUserDisplayName(
        data.userInfoById[record.routeAlertsToUserId],
      ),
      startsAt: record.startsAt,
      endsAt: record.endsAt,
      scope: describeOverrideScope({
        onCallDutyPolicyId: record.onCallDutyPolicyId,
        ...(policyId && data.policyNameById[policyId]
          ? { policyName: data.policyNameById[policyId]! }
          : {}),
      }),
      isActiveNow:
        OneUptimeDate.isOnOrBefore(record.startsAt, data.now) &&
        OneUptimeDate.isAfter(record.endsAt, data.now),
    });
  }

  /*
   * In force first, then by start. A reader scanning this panel during an
   * incident wants the substitution that is live right now, not the one booked
   * for next month, and sorting by start alone would bury it under any override
   * that happens to have started earlier.
   */
  return rows.sort((a: OverrideSummaryRow, b: OverrideSummaryRow) => {
    if (a.isActiveNow !== b.isActiveNow) {
      return a.isActiveNow ? -1 : 1;
    }
    return a.startsAt.getTime() - b.startsAt.getTime();
  });
}

/*
 * "Covering Alice Scheduled" / "Covering Alice Scheduled and 2 others" for the
 * calendar legend, where one substitute can stand in for several people and the
 * chip has room for roughly one name.
 */
export function describeSubstituteCoverage(data: {
  substituteUserId: string;
  records: Array<UserOverrideRecord>;
  userInfoById: Dictionary<OverrideUserDisplayInfo>;
}): string {
  const names: Array<string> = [];
  const seen: Set<string> = new Set<string>();

  for (const record of data.records) {
    if (record.routeAlertsToUserId !== data.substituteUserId) {
      continue;
    }
    if (seen.has(record.overrideUserId)) {
      continue;
    }
    seen.add(record.overrideUserId);
    names.push(getUserDisplayName(data.userInfoById[record.overrideUserId]));
  }

  if (names.length === 0) {
    // A substitute with no record behind them should not exist; say the least.
    return "Covering";
  }

  if (names.length === 1) {
    return `Covering ${names[0]}`;
  }

  if (names.length === 2) {
    return `Covering ${names[0]} and ${names[1]}`;
  }

  return `Covering ${names[0]} and ${names.length - 1} others`;
}

/*
 * The one-line explanation shown beside the "on call right now" name and on
 * each upcoming hand-off: who this person is standing in for.
 */
export function describeShiftOverride(data: {
  override: OverrideEventMeta;
  userInfoById: Dictionary<OverrideUserDisplayInfo>;
  policyNameById: Dictionary<string>;
}): {
  originalName: string;
  scope: OverrideScopeDescription;
  // "Covering for Alice Scheduled"
  coveringLabel: string;
} {
  const originalName: string = getUserDisplayName(
    data.userInfoById[data.override.originalUserId],
  );

  const policyId: string = data.override.onCallDutyPolicyId || "";

  const scope: OverrideScopeDescription = describeOverrideScope({
    onCallDutyPolicyId: data.override.onCallDutyPolicyId,
    ...(policyId && data.policyNameById[policyId]
      ? { policyName: data.policyNameById[policyId]! }
      : {}),
  });

  return {
    originalName,
    scope,
    coveringLabel: `Covering for ${originalName}`,
  };
}
