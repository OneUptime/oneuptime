import { isCoveringShift } from "./CalendarFeedUtil";
import {
  MaterializedShiftJson,
  MaterializedShiftPolicyVariant,
} from "Common/Types/OnCallDutyPolicy/MaterializedShift";
import {
  UserOverrideCoverWindow,
  getUserOverrideCoverWindow,
} from "Common/Types/OnCallDutyPolicy/UserOverrideCoverRequest";

/*
 * THE UPCOMING SHIFTS LIST, AS A PERSON READS IT.
 *
 * /my-shifts answers with the shifts the calendar feed is made of: one per
 * rotation turn, because a calendar event's identity must not slide when
 * the window does (ScheduleShiftUtil.groupKeyByUserOverrideAndLayer). A
 * person alone on a daily rotation therefore gets thirty back-to-back
 * 24-hour shifts a month, and the card used to list every one of them under
 * a heading of its own: thirty rows that all said the same thing.
 *
 * A person reads those thirty shifts as one stretch on call. So the card
 * joins back-to-back shifts into one span - "Oct 14, 17:20 to Nov 13, 17:20,
 * 30 days" - when nothing a reader could tell apart changes at the hand-off:
 * the same project, schedule and layer, the same person, the same cover (both
 * your own, or both covering for the same person) and the same policy (both
 * on every policy, or both only on the same one). Anything else stays its own
 * row: a gap, a hand-over to another layer, cover for someone else, a shift
 * that exists only on one policy.
 *
 * Only the list is joined. The calendar feed, the reminders and the server
 * keep one event per turn.
 *
 * Pure and React-free: the card, its tests and the fixture's specs share it.
 */

/*
 * Two shifts touch when the second starts at most this long after the first
 * ends. The materializer's hand-offs touch exactly (ShiftSeamUtil makes the
 * engine's one-second seams minute-aligned), so this only absorbs a clock
 * that is not quite on the minute - never a gap a person would call time off.
 */
export const SHIFT_HAND_OFF_TOLERANCE_MS: number = 60 * 1000;

export interface UpcomingShiftSpan {
  // The first shift's key: stable across reloads, unique in the list.
  key: string;
  // The shifts the span joins, in start order.
  shifts: Array<MaterializedShiftJson>;
  start: Date;
  end: Date;
  projectId: string;
  projectName: string | null;
  scheduleId: string;
  scheduleName: string;
  layerId: string | null;
  layerName: string | null;
  // Who you cover for, when the span is somebody else's shift.
  coveringFor: string | null;
  // Set when the span exists only on one escalation policy.
  policyVariant: MaterializedShiftPolicyVariant | null;
  // Started, and not ended, at `now`.
  isOnCallNow: boolean;
  /*
   * Back-to-back shifts still going at the end of the window the card asked
   * for: whether the next turn is yours too is past what it can see.
   */
  mayContinue: boolean;
}

const toTime: (value: string) => number | null = (
  value: string,
): number | null => {
  if (typeof value !== "string" || !value) {
    return null;
  }

  const time: number = Date.parse(value);

  return Number.isNaN(time) ? null : time;
};

/*
 * What has to be the same for two touching shifts to read as one stretch on
 * call. A shift's user is part of it even though the list holds only the
 * reader's own: the server decides that, and a list that joined two people's
 * shifts would put one person's name on the other's time.
 */
export const getShiftSpanKey: (shift: MaterializedShiftJson) => string = (
  shift: MaterializedShiftJson,
): string => {
  const cover: string =
    isCoveringShift(shift) && shift.override
      ? `covering:${shift.override.originalUserId}`
      : "own";

  return [
    shift.projectId || "",
    shift.scheduleId,
    shift.layerId || "",
    shift.userId,
    cover,
    shift.policyVariantOf?.policyId || "",
  ].join("|");
};

interface DatedShift {
  shift: MaterializedShiftJson;
  start: number;
  end: number;
}

/*
 * The reader's shifts as the spans the card lists, in start order: every
 * shift that has not ended at `now`, read once each (a key the server sent
 * twice is one shift), with back-to-back shifts joined as above. A span
 * that has started and not ended is the one the reader is on call for now.
 *
 * `windowEnd` is the end of the window the shifts were asked for. The server
 * sends a shift that starts inside it whole, so a turn across its end still
 * ends when it says. But back-to-back turns that are still going there - a
 * person alone in a layer, on call around the clock - are likely to go on
 * past it, and the card cannot see whether they do: such a span "may
 * continue", and its row says "until at least" rather than promising the
 * reader a day off the list knows nothing about.
 */
export const buildUpcomingShiftSpans: (
  shifts: Array<MaterializedShiftJson>,
  now: Date,
  windowEnd?: Date | undefined,
) => Array<UpcomingShiftSpan> = (
  shifts: Array<MaterializedShiftJson>,
  now: Date,
  windowEnd?: Date | undefined,
): Array<UpcomingShiftSpan> => {
  const nowTime: number = now.getTime();
  const seen: Set<string> = new Set<string>();
  const dated: Array<DatedShift> = [];

  for (const shift of shifts) {
    if (seen.has(shift.shiftKey)) {
      continue;
    }

    seen.add(shift.shiftKey);

    const start: number | null = toTime(shift.start);
    const end: number | null = toTime(shift.end);

    // A shift with no real window, or one that is over, is not upcoming.
    if (start === null || end === null || end <= start || end <= nowTime) {
      continue;
    }

    dated.push({ shift: shift, start: start, end: end });
  }

  dated.sort((a: DatedShift, b: DatedShift): number => {
    if (a.start !== b.start) {
      return a.start - b.start;
    }

    return a.shift.shiftKey.localeCompare(b.shift.shiftKey);
  });

  const spans: Array<UpcomingShiftSpan> = [];
  // The latest span of each key, which the next touching shift extends.
  const latestByKey: Map<string, UpcomingShiftSpan> = new Map<
    string,
    UpcomingShiftSpan
  >();

  for (const item of dated) {
    const key: string = getShiftSpanKey(item.shift);
    const latest: UpcomingShiftSpan | undefined = latestByKey.get(key);

    if (
      latest &&
      item.start - latest.end.getTime() <= SHIFT_HAND_OFF_TOLERANCE_MS
    ) {
      latest.shifts.push(item.shift);

      if (item.end > latest.end.getTime()) {
        latest.end = new Date(item.end);
      }

      continue;
    }

    const shift: MaterializedShiftJson = item.shift;

    const span: UpcomingShiftSpan = {
      key: shift.shiftKey,
      shifts: [shift],
      start: new Date(item.start),
      end: new Date(item.end),
      projectId: shift.projectId || "",
      projectName: shift.projectName || null,
      scheduleId: shift.scheduleId,
      scheduleName: shift.scheduleName,
      layerId: shift.layerId || null,
      layerName: shift.layerName || null,
      coveringFor:
        isCoveringShift(shift) && shift.override
          ? shift.override.originalUserName || ""
          : null,
      policyVariant: shift.policyVariantOf || null,
      isOnCallNow: false,
      mayContinue: false,
    };

    spans.push(span);
    latestByKey.set(key, span);
  }

  for (const span of spans) {
    span.isOnCallNow =
      span.start.getTime() <= nowTime && nowTime < span.end.getTime();
    span.mayContinue = Boolean(
      windowEnd &&
        span.shifts.length > 1 &&
        span.end.getTime() > windowEnd.getTime(),
    );
  }

  return spans;
};

/*
 * The name a new layer is given ("Layer 1", "Layer 2": Layers.tsx and the
 * schedule's first layer) says nothing about the layer, so it is only worth
 * showing where it tells two of your layers apart. Read without a regular
 * expression: a layer's name is whatever somebody typed.
 */
export const isDefaultLayerName: (name: string) => boolean = (
  name: string,
): boolean => {
  const words: Array<string> = name
    .trim()
    .toLowerCase()
    .split(" ")
    .filter((word: string): boolean => {
      return word.length > 0;
    });

  if (words.length !== 2 || words[0] !== "layer") {
    return false;
  }

  const number: string = words[1] || "";

  return (
    number.length > 0 &&
    number.split("").every((character: string): boolean => {
      return character >= "0" && character <= "9";
    })
  );
};

/*
 * Whether a span's row names its layer: when the layer has a name of its own
 * ("Weekdays", "Backup"), or when your spans on that schedule come from more
 * than one layer and the name is what tells them apart. "Layer 1" under every
 * row of a one-layer schedule said nothing.
 */
export const shouldShowLayerName: (
  span: UpcomingShiftSpan,
  spans: Array<UpcomingShiftSpan>,
) => boolean = (
  span: UpcomingShiftSpan,
  spans: Array<UpcomingShiftSpan>,
): boolean => {
  const name: string = (span.layerName || "").trim();

  if (!name) {
    return false;
  }

  if (!isDefaultLayerName(name)) {
    return true;
  }

  const layers: Set<string> = new Set<string>();

  for (const other of spans) {
    if (
      other.projectId === span.projectId &&
      other.scheduleId === span.scheduleId
    ) {
      layers.add(other.layerId || other.layerName || "");
    }
  }

  return layers.size > 1;
};

/*
 * Whether the rows name their project. The Dashboard asks for the shifts of
 * the project it is in, so every row would repeat the name in the page's
 * header; only a list that holds more than one project needs it.
 */
export const shouldShowProjectNames: (
  spans: Array<UpcomingShiftSpan>,
) => boolean = (spans: Array<UpcomingShiftSpan>): boolean => {
  const projects: Set<string> = new Set<string>();

  for (const span of spans) {
    projects.add(span.projectId);
  }

  return projects.size > 1;
};

/*
 * The window "Get cover" asks to cover for a span: the whole span - what
 * its row shows - from now once it has started. Add User Override opens
 * with that window filled in, and the reader can shorten it there before
 * saving. Null when cover is not offered: for a span you are covering for
 * someone else (overrides do not chain, so cover for cover would change
 * nothing), for one without a project, and for one that has ended.
 */
export const getCoverWindowForSpan: (
  span: UpcomingShiftSpan,
  now: Date,
) => UserOverrideCoverWindow | null = (
  span: UpcomingShiftSpan,
  now: Date,
): UserOverrideCoverWindow | null => {
  if (!span.projectId || span.coveringFor !== null) {
    return null;
  }

  return getUserOverrideCoverWindow({
    start: span.start,
    end: span.end,
    now: now,
  });
};

/*
 * How many spans the card lists before "Show N more". A month of weekday
 * shifts is some twenty rows; the first six cover the coming week, which is
 * what most visits are for, and the rest are one click away. A fold that
 * would hide only one or two rows is not worth a click, so it starts at
 * nine.
 */
export const UPCOMING_SHIFTS_SHOWN_AT_FIRST: number = 6;

export const UPCOMING_SHIFTS_FOLD_MINIMUM_HIDDEN: number = 3;

export const getUpcomingShiftsFold: (data: {
  total: number;
  isExpanded: boolean;
}) => { shown: number; hidden: number } = (data: {
  total: number;
  isExpanded: boolean;
}): { shown: number; hidden: number } => {
  const hidden: number = data.total - UPCOMING_SHIFTS_SHOWN_AT_FIRST;

  if (data.isExpanded || hidden < UPCOMING_SHIFTS_FOLD_MINIMUM_HIDDEN) {
    return { shown: data.total, hidden: 0 };
  }

  return { shown: UPCOMING_SHIFTS_SHOWN_AT_FIRST, hidden: hidden };
};

// Whether the list folds at all - and so has a Show fewer once opened.
export const isUpcomingShiftsFoldable: (total: number) => boolean = (
  total: number,
): boolean => {
  return (
    total - UPCOMING_SHIFTS_SHOWN_AT_FIRST >= UPCOMING_SHIFTS_FOLD_MINIMUM_HIDDEN
  );
};
