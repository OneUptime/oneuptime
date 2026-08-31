import moment from "moment-timezone";
import User from "../../Models/DatabaseModels/User";
import ICalendar, {
  ICalendarCalendar,
  ICalendarDocument,
  ICalendarEvent,
  ICalendarEventStatus,
  ICalendarTransparency,
} from "../Calendar/ICalendar";
import OneUptimeDate from "../Date";
import ObjectID from "../ObjectID";
import Timezone from "../Timezone";
import CalendarFeedWindow, {
  MAX_EVENTS,
  MAX_GAP_EVENTS,
} from "./CalendarFeedWindow";
import LayerUtil, { LayerEventsResult, LayerProps } from "./Layer";
import MaterializedShiftUtil, {
  MaterializedShift,
  MaterializedShiftPolicy,
} from "./MaterializedShift";
import ScheduleShiftUtil, {
  CoverageGap,
  OnCallShift,
} from "./ScheduleShiftUtil";
import ShiftSeamUtil, { TimeSegment } from "./ShiftSeamUtil";

/*
 * Pure mapper from materialized on-call shifts to an iCalendar document.
 *
 * Everything here is deterministic on its inputs (no clock reads, no I/O), so
 * the same shifts always serialize to the same bytes — the property the body
 * cache and ETag depend on. The server-side renderer decides WHAT to feed in
 * (which shifts, which window, which timezone) and this module decides how
 * that looks in a calendar.
 *
 * Rules implemented (see the on-call calendar feeds design):
 * - UID is (schedule, seam-normalised start), never the user, so an override
 *   swap updates the event in place; policy variants add the policy id, gaps
 *   have their own namespace.
 * - DTSTAMP/LAST-MODIFIED are the schedule inputs' last-modified instant and
 *   SEQUENCE is the schedule's shiftConfigVersion, so an unchanged schedule
 *   renders byte-identically.
 * - Every DTSTART/DTEND is UTC; the DESCRIPTION carries the schedule-zone,
 *   UTC and viewer-zone wall clock.
 * - TRANSP:TRANSPARENT, STATUS:CONFIRMED, CATEGORIES:On-Call; no CLASS.
 */

export enum OnCallCalendarFeedKind {
  Personal = "personal",
  Schedule = "schedule",
  Project = "project",
}

export interface CalendarNameOptions {
  kind: OnCallCalendarFeedKind;
  scheduleName?: string | undefined;
  projectName?: string | undefined;
  // Personal feed with a ?schedule= filter.
  filterScheduleName?: string | undefined;
}

export interface CalendarName {
  // Full name (NAME).
  name: string;
  // What clients display (X-WR-CALNAME); truncated for the schedule feed.
  displayName: string;
}

export interface CalendarHeaderOptions extends CalendarNameOptions {
  // X-WR-TIMEZONE; invalid or missing falls back to UTC.
  timezone?: string | undefined;
  lastModifiedAt?: Date | undefined;
  // Extra sentences appended to X-WR-CALDESC (truncation, empty reason, ...).
  notes?: Array<string> | undefined;
}

export interface ShiftEventContext {
  kind: OnCallCalendarFeedKind;
  // Dashboard base URL including the /dashboard segment, no trailing slash needed.
  dashboardUrl: string;
  // The subscriber's own zone (personal feed); used for the "your zone" line.
  viewerTimezone?: string | undefined;
}

export interface CoverageEnvelopeInput {
  layers: Array<LayerProps>;
  windowStart: Date;
  windowEnd: Date;
  maxSimulationIterations?: number | undefined;
}

export interface CoverageEnvelopeResult {
  // Union of every layer's restriction windows over the feed window, merged.
  segments: Array<TimeSegment>;
  truncated: boolean;
}

export interface CoverageGapEventsInput {
  scheduleId: string;
  scheduleName: string;
  projectId: string;
  // Resolved shifts of this schedule (any object with start/end).
  shifts: Array<TimeSegment>;
  feedStart: Date;
  feedEnd: Date;
  // Where a layer INTENDED coverage (see computeCoverageEnvelope).
  envelope: Array<TimeSegment>;
  // A hole shorter than this (after envelope clipping) is not reported.
  minimumGapSeconds?: number | undefined;
  lastModifiedAt: Date;
  shiftConfigVersion: number;
  dashboardUrl: string;
  maxGapEvents?: number | undefined;
}

export interface CoverageGapEventsResult {
  events: Array<ICalendarEvent>;
  // The gaps behind the events, same order.
  gaps: Array<TimeSegment>;
  // True when more gaps existed than maxGapEvents allowed.
  truncated: boolean;
}

export interface WindowShrinkInput {
  shifts: Array<MaterializedShift>;
  feedStart: Date;
  feedEnd: Date;
  maxEvents?: number | undefined;
}

export interface WindowShrinkResult {
  // Shifts overlapping [feedStart, feedEnd), sorted, at most maxEvents.
  shifts: Array<MaterializedShift>;
  // The (possibly earlier) exclusive end actually used.
  feedEnd: Date;
  truncated: boolean;
  // Whole days cut off the end of the window.
  daysDropped: number;
}

export interface FeedRenderInput extends ShiftEventContext {
  shifts: Array<MaterializedShift>;
  scheduleName?: string | undefined;
  projectName?: string | undefined;
  filterScheduleName?: string | undefined;
  // X-WR-TIMEZONE; defaults to viewerTimezone, then UTC.
  calendarTimezone?: string | undefined;
  notes?: Array<string> | undefined;
  gapEvents?: Array<ICalendarEvent> | undefined;
  // Overrides the max of the shifts' lastModifiedAt.
  lastModifiedAt?: Date | undefined;
}

export interface FeedRenderResult {
  body: string;
  eventCount: number;
  lastModifiedAt: Date | null;
}

export interface EmptyFeedInput extends CalendarNameOptions {
  // Why the calendar is empty; goes into X-WR-CALDESC so a subscriber can tell.
  reason: string;
  timezone?: string | undefined;
}

const MILLISECONDS_PER_DAY: number = 24 * 60 * 60 * 1000;

// Engine artefact tolerance when merging envelope segments (1 s seams).
const ENVELOPE_MERGE_TOLERANCE_MILLISECONDS: number = 1000;

/*
 * ScheduleShiftUtil.getCoverageGaps ignores holes of five seconds or less
 * (its contiguity tolerance for the engine's one-second seams). The trailing
 * hole this file adds itself is held to the same threshold.
 */
const TRAILING_GAP_TOLERANCE_MILLISECONDS: number = 5 * 1000;

const ENVELOPE_USER_ID: string = "00000000-0000-4000-8000-000000000000";

const EMAIL_LIKE_REGEX: RegExp = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default class OnCallCalendarFeedUtil {
  public static readonly PRODUCT_ID: string =
    "-//OneUptime//On-Call Calendar Feed//EN";

  public static readonly REFRESH_INTERVAL: string = "PT1H";

  public static readonly UID_DOMAIN: string = "oneuptime";

  public static readonly CATEGORY: string = "On-Call";

  public static readonly PERSONAL_CALENDAR_NAME: string = "OneUptime On-Call";

  // Confluence Team Calendars rejects longer calendar names.
  public static readonly MAX_SCHEDULE_CALENDAR_NAME_LENGTH: number = 28;

  public static readonly FALLBACK_USER_NAME: string = "Unnamed user";

  public static readonly REFRESH_CAVEAT: string =
    "Calendar apps refresh subscribed feeds on their own schedule (Google Calendar every 12-24 h, Outlook on the web about every 3 h, Apple Calendar per its fetch setting), so recent changes can lag.";

  public static readonly REFRESH_LINE: string =
    "Changes appear after your calendar app next refreshes (Google Calendar: up to 24 h).";

  public static readonly PAST_SHIFT_LINE: string =
    "Past shifts reflect the current rotation, not who was actually paged — see the On-Call Time Log report.";

  public static readonly NO_POLICY_LINE: string =
    "Not attached to any escalation policy, so it will not page anyone.";

  public static readonly LEGACY_TIMEZONE_NOTE: string =
    "schedule has no timezone set (expanded in the server's zone, as paging does)";

  /*
   * ---------------------------------------------------------------------
   * Identity and links
   * ---------------------------------------------------------------------
   */

  // oncall-<scheduleId>-<startEpochSeconds>@oneuptime (+ -<policyId> for variants).
  public static getShiftUid(shift: MaterializedShift): string {
    const base: string = `oncall-${shift.scheduleId}-${OnCallCalendarFeedUtil.epochSeconds(shift.start)}`;
    const suffix: string = shift.policyVariantOf
      ? `-${shift.policyVariantOf.policyId}`
      : "";
    return `${base}${suffix}@${OnCallCalendarFeedUtil.UID_DOMAIN}`;
  }

  public static getGapUid(scheduleId: string, start: Date): string {
    return `oncall-gap-${scheduleId}-${OnCallCalendarFeedUtil.epochSeconds(start)}@${OnCallCalendarFeedUtil.UID_DOMAIN}`;
  }

  public static getScheduleUrl(
    dashboardUrl: string,
    projectId: string,
    scheduleId: string,
  ): string {
    return `${OnCallCalendarFeedUtil.trimTrailingSlash(dashboardUrl)}/${projectId}/on-call-duty/schedules/${scheduleId}`;
  }

  public static getUserOverridesUrl(
    dashboardUrl: string,
    projectId: string,
  ): string {
    return `${OnCallCalendarFeedUtil.trimTrailingSlash(dashboardUrl)}/${projectId}/on-call-duty/user-overrides`;
  }

  public static getTimeLogUrl(dashboardUrl: string, projectId: string): string {
    return `${OnCallCalendarFeedUtil.trimTrailingSlash(dashboardUrl)}/${projectId}/on-call-duty/user-time-logs`;
  }

  /*
   * ---------------------------------------------------------------------
   * Calendar header
   * ---------------------------------------------------------------------
   */

  public static buildCalendarName(options: CalendarNameOptions): CalendarName {
    const personal: string = OnCallCalendarFeedUtil.PERSONAL_CALENDAR_NAME;

    if (options.kind === OnCallCalendarFeedKind.Schedule) {
      const name: string =
        OnCallCalendarFeedUtil.cleanName(options.scheduleName) ||
        "On-Call Schedule";
      return {
        name,
        displayName: OnCallCalendarFeedUtil.truncateName(
          name,
          OnCallCalendarFeedUtil.MAX_SCHEDULE_CALENDAR_NAME_LENGTH,
        ),
      };
    }

    if (options.kind === OnCallCalendarFeedKind.Project) {
      const project: string =
        OnCallCalendarFeedUtil.cleanName(options.projectName) || "Project";
      const name: string = `${personal} · ${project}`;
      return { name, displayName: name };
    }

    const filter: string = OnCallCalendarFeedUtil.cleanName(
      options.filterScheduleName,
    );
    const name: string = filter ? `${personal} · ${filter}` : personal;
    return { name, displayName: name };
  }

  public static buildCalendarDescription(
    options: CalendarNameOptions & { notes?: Array<string> | undefined },
  ): string {
    let intro: string;

    if (options.kind === OnCallCalendarFeedKind.Schedule) {
      intro = `Everyone's on-call shifts on ${
        OnCallCalendarFeedUtil.cleanName(options.scheduleName) ||
        "this schedule"
      } from OneUptime.`;
    } else if (options.kind === OnCallCalendarFeedKind.Project) {
      intro = `Everyone's on-call shifts across ${
        OnCallCalendarFeedUtil.cleanName(options.projectName) || "this project"
      } from OneUptime.`;
    } else {
      const filter: string = OnCallCalendarFeedUtil.cleanName(
        options.filterScheduleName,
      );
      intro = filter
        ? `Your on-call shifts on ${filter} from OneUptime.`
        : "Your on-call shifts from OneUptime.";
    }

    const notes: Array<string> = (options.notes ?? [])
      .map((note: string) => {
        return note.trim();
      })
      .filter((note: string) => {
        return note !== "";
      });

    return [intro, OnCallCalendarFeedUtil.REFRESH_CAVEAT, ...notes].join(" ");
  }

  public static buildCalendarHeader(
    options: CalendarHeaderOptions,
  ): ICalendarCalendar {
    const names: CalendarName =
      OnCallCalendarFeedUtil.buildCalendarName(options);

    const header: ICalendarCalendar = {
      productId: OnCallCalendarFeedUtil.PRODUCT_ID,
      name: names.name,
      displayName: names.displayName,
      description: OnCallCalendarFeedUtil.buildCalendarDescription(options),
      timezone: OnCallCalendarFeedUtil.isValidTimezone(options.timezone)
        ? options.timezone
        : Timezone.UTC,
      refreshInterval: OnCallCalendarFeedUtil.REFRESH_INTERVAL,
    };

    if (options.lastModifiedAt !== undefined) {
      header.lastModified = options.lastModifiedAt;
    }

    return header;
  }

  /*
   * ---------------------------------------------------------------------
   * Shift -> VEVENT
   * ---------------------------------------------------------------------
   */

  /*
   * How a person is named in this feed. The personal feed shows whatever the
   * materializer resolved (an email fallback is fine — it is the subscriber's
   * own data); the shared schedule/project feeds never show an email.
   */
  public static getDisplayName(
    name: string | null | undefined,
    kind: OnCallCalendarFeedKind,
  ): string {
    const trimmed: string = (name ?? "").trim();

    if (trimmed === "") {
      return OnCallCalendarFeedUtil.FALLBACK_USER_NAME;
    }

    if (
      kind !== OnCallCalendarFeedKind.Personal &&
      EMAIL_LIKE_REGEX.test(trimmed)
    ) {
      return OnCallCalendarFeedUtil.FALLBACK_USER_NAME;
    }

    return trimmed;
  }

  public static buildSummary(
    shift: MaterializedShift,
    kind: OnCallCalendarFeedKind,
  ): string {
    const scheduleName: string =
      OnCallCalendarFeedUtil.cleanName(shift.scheduleName) || "Schedule";

    let summary: string = `On-call · ${scheduleName}`;

    const distinctPolicies: Array<MaterializedShiftPolicy> =
      OnCallCalendarFeedUtil.getDistinctPolicies(shift.policies);

    if (shift.policyVariantOf) {
      summary += ` · ${shift.policyVariantOf.policyName}`;
    } else if (
      kind === OnCallCalendarFeedKind.Personal &&
      distinctPolicies.length === 1
    ) {
      summary += ` · ${distinctPolicies[0]!.policyName}`;
    }

    if (shift.override) {
      summary += ` (covering for ${OnCallCalendarFeedUtil.getDisplayName(
        shift.override.originalUserName,
        kind,
      )})`;
    }

    if (kind === OnCallCalendarFeedKind.Personal) {
      return summary;
    }

    return `${OnCallCalendarFeedUtil.getDisplayName(shift.userName, kind)} · ${summary}`;
  }

  public static buildDescription(
    shift: MaterializedShift,
    context: ShiftEventContext,
    allShifts?: Array<MaterializedShift> | undefined,
  ): string {
    const kind: OnCallCalendarFeedKind = context.kind;
    const lines: Array<string> = [];

    const userName: string = OnCallCalendarFeedUtil.getDisplayName(
      shift.userName,
      kind,
    );

    const originalUserName: string | null = shift.override
      ? OnCallCalendarFeedUtil.getDisplayName(
          shift.override.originalUserName,
          kind,
        )
      : null;

    lines.push(
      `Who: ${userName}${originalUserName ? `, covering for ${originalUserName}` : ""}`,
    );

    const scheduleZone: string = OnCallCalendarFeedUtil.getScheduleZone(shift);
    const isLegacyZone: boolean = !OnCallCalendarFeedUtil.isValidTimezone(
      shift.scheduleTimezone,
    );

    lines.push(
      `Schedule: ${OnCallCalendarFeedUtil.cleanName(shift.scheduleName) || "Schedule"} (${
        isLegacyZone
          ? OnCallCalendarFeedUtil.LEGACY_TIMEZONE_NOTE
          : scheduleZone
      })`,
    );

    if (shift.layerName) {
      lines.push(`Layer: ${shift.layerName}`);
    }

    lines.push(
      ...OnCallCalendarFeedUtil.buildShiftTimeLines(
        shift,
        scheduleZone,
        isLegacyZone,
        context.viewerTimezone,
      ),
    );

    const distinctPolicies: Array<MaterializedShiftPolicy> =
      OnCallCalendarFeedUtil.getDistinctPolicies(shift.policies);

    if (shift.policies.length === 0) {
      lines.push(OnCallCalendarFeedUtil.NO_POLICY_LINE);
    } else {
      const label: string =
        kind === OnCallCalendarFeedKind.Personal
          ? "Pages you via"
          : "Pages via";
      lines.push(
        `${label}: ${OnCallCalendarFeedUtil.describePolicies(shift.policies)}`,
      );
    }

    if (shift.override) {
      const scope: string = shift.override.onCallDutyPolicyId
        ? `scoped to ${OnCallCalendarFeedUtil.findPolicyName(
            distinctPolicies,
            shift.override.onCallDutyPolicyId,
          )}`
        : "global override";

      lines.push(
        `Override: ${originalUserName} → ${userName} from ${OnCallCalendarFeedUtil.formatInZone(
          shift.override.overrideStartsAt,
          scheduleZone,
        )} to ${OnCallCalendarFeedUtil.formatInZone(
          shift.override.overrideEndsAt,
          scheduleZone,
        )} (${scope})`,
      );
    }

    if (shift.policyVariantOf) {
      const insteadOf: string = originalUserName ?? "the rostered user";
      lines.push(
        kind === OnCallCalendarFeedKind.Personal
          ? `For ${shift.policyVariantOf.policyName} you are paged instead of ${insteadOf} because of a policy-specific override.`
          : `For ${shift.policyVariantOf.policyName}, ${userName} is paged instead of ${insteadOf} because of a policy-specific override.`,
      );
    } else if (allShifts) {
      lines.push(
        ...OnCallCalendarFeedUtil.buildVariantMirrorLines(
          shift,
          allShifts,
          kind,
          scheduleZone,
        ),
      );
    }

    if (shift.isPast) {
      lines.push(
        `${OnCallCalendarFeedUtil.PAST_SHIFT_LINE} ${OnCallCalendarFeedUtil.getTimeLogUrl(
          context.dashboardUrl,
          shift.projectId,
        )}`,
      );
    }

    lines.push(
      `Need cover? ${OnCallCalendarFeedUtil.getUserOverridesUrl(
        context.dashboardUrl,
        shift.projectId,
      )}`,
    );

    lines.push(OnCallCalendarFeedUtil.REFRESH_LINE);

    return lines.join("\n");
  }

  public static shiftToEvent(
    shift: MaterializedShift,
    context: ShiftEventContext,
    allShifts?: Array<MaterializedShift> | undefined,
  ): ICalendarEvent {
    return {
      uid: OnCallCalendarFeedUtil.getShiftUid(shift),
      dtStamp: shift.lastModifiedAt,
      lastModified: shift.lastModifiedAt,
      sequence: OnCallCalendarFeedUtil.toSequence(shift.shiftConfigVersion),
      start: shift.start,
      end: shift.end,
      summary: OnCallCalendarFeedUtil.buildSummary(shift, context.kind),
      description: OnCallCalendarFeedUtil.buildDescription(
        shift,
        context,
        allShifts,
      ),
      url: OnCallCalendarFeedUtil.getScheduleUrl(
        context.dashboardUrl,
        shift.projectId,
        shift.scheduleId,
      ),
      status: ICalendarEventStatus.Confirmed,
      transparency: ICalendarTransparency.Transparent,
      categories: [OnCallCalendarFeedUtil.CATEGORY],
    };
  }

  // One VEVENT per shift, in deterministic (start, schedule, key) order.
  public static shiftsToEvents(
    shifts: Array<MaterializedShift>,
    context: ShiftEventContext,
  ): Array<ICalendarEvent> {
    const sorted: Array<MaterializedShift> =
      MaterializedShiftUtil.sortByStart(shifts);

    return sorted.map((shift: MaterializedShift) => {
      return OnCallCalendarFeedUtil.shiftToEvent(shift, context, sorted);
    });
  }

  /*
   * ---------------------------------------------------------------------
   * Window
   * ---------------------------------------------------------------------
   */

  // Shifts that overlap [feedStart, feedEnd), unclipped, sorted.
  public static filterShiftsToWindow(
    shifts: Array<MaterializedShift>,
    feedStart: Date,
    feedEnd: Date,
  ): Array<MaterializedShift> {
    return MaterializedShiftUtil.sortByStart(shifts).filter(
      (shift: MaterializedShift) => {
        return (
          shift.start.getTime() < feedEnd.getTime() &&
          shift.end.getTime() > feedStart.getTime()
        );
      },
    );
  }

  /*
   * Keep the feed under maxEvents by cutting whole UTC days off the END of
   * the window (the nearest future matters most). When even the first day
   * holds more than maxEvents shifts, the cut lands on the first excluded
   * shift's start instead.
   */
  public static shrinkWindowToFit(
    input: WindowShrinkInput,
  ): WindowShrinkResult {
    const maxEvents: number =
      input.maxEvents !== undefined && input.maxEvents > 0
        ? Math.floor(input.maxEvents)
        : MAX_EVENTS;

    const inWindow: Array<MaterializedShift> =
      OnCallCalendarFeedUtil.filterShiftsToWindow(
        input.shifts,
        input.feedStart,
        input.feedEnd,
      );

    if (inWindow.length <= maxEvents) {
      return {
        shifts: inWindow,
        feedEnd: input.feedEnd,
        truncated: false,
        daysDropped: 0,
      };
    }

    const firstExcluded: MaterializedShift = inWindow[maxEvents]!;

    let newFeedEnd: Date = new Date(
      CalendarFeedWindow.startOfUtcDay(firstExcluded.start),
    );

    if (newFeedEnd.getTime() <= input.feedStart.getTime()) {
      newFeedEnd = new Date(firstExcluded.start.getTime());
    }

    let kept: Array<MaterializedShift> = inWindow.filter(
      (shift: MaterializedShift) => {
        return shift.start.getTime() < newFeedEnd.getTime();
      },
    );

    /*
     * Shifts that started before the window (in progress at feedStart) all
     * share "start < newFeedEnd"; if there are more than maxEvents of those
     * no cut point exists and a hard slice is the only option left.
     */
    if (kept.length > maxEvents) {
      kept = kept.slice(0, maxEvents);
    }

    const daysDropped: number = Math.max(
      0,
      Math.ceil(
        (input.feedEnd.getTime() - newFeedEnd.getTime()) / MILLISECONDS_PER_DAY,
      ),
    );

    return { shifts: kept, feedEnd: newFeedEnd, truncated: true, daysDropped };
  }

  /*
   * ---------------------------------------------------------------------
   * Coverage gaps
   * ---------------------------------------------------------------------
   */

  /*
   * Where the schedule's layers INTEND to cover, regardless of who (or
   * whether anyone) is assigned and of when the layer starts: each layer is
   * expanded with one synthetic user from the window start, so the result is
   * exactly its restriction windows — the whole window for an unrestricted
   * layer, Mon-Fri 09:00-17:00 for a business-hours layer. A coverage hole
   * is only worth an event when it falls inside this envelope.
   */
  public static computeCoverageEnvelope(
    input: CoverageEnvelopeInput,
  ): CoverageEnvelopeResult {
    const layerUtil: LayerUtil = new LayerUtil();
    const segments: Array<TimeSegment> = [];
    let truncated: boolean = false;

    const syntheticUser: User = new User();
    syntheticUser.id = new ObjectID(ENVELOPE_USER_ID);

    for (const layer of input.layers) {
      const result: LayerEventsResult = layerUtil.getEventsWithMeta(
        {
          users: [syntheticUser],
          startDateTimeOfLayer: input.windowStart,
          restrictionTimes: layer.restrictionTimes,
          handOffTime: layer.handOffTime,
          rotation: layer.rotation,
          timezone: layer.timezone,
          calendarStartDate: input.windowStart,
          calendarEndDate: input.windowEnd,
        },
        input.maxSimulationIterations !== undefined
          ? { maxSimulationIterations: input.maxSimulationIterations }
          : undefined,
      );

      truncated = truncated || result.truncated;

      for (const event of result.events) {
        segments.push({ start: event.start, end: event.end });
      }
    }

    /*
     * The engine's 1-second seams (09:00:01 starts) would otherwise leak into
     * gap events; normalise them exactly as the shifts themselves are.
     */
    return {
      segments: OnCallCalendarFeedUtil.mergeSegments(
        ShiftSeamUtil.normalizeSeams(segments),
        ENVELOPE_MERGE_TOLERANCE_MILLISECONDS,
      ),
      truncated,
    };
  }

  /*
   * "No coverage" events: every hole before, between and after the shifts
   * inside [feedStart, feedEnd) that intersects the envelope, clipped to the
   * envelope, merged, at least minimumGapSeconds long, oldest first, capped at
   * maxGapEvents. Off-hours of a business-hours schedule are outside the
   * envelope and are therefore never emitted.
   */
  public static buildCoverageGapEvents(
    input: CoverageGapEventsInput,
  ): CoverageGapEventsResult {
    const maxGapEvents: number =
      input.maxGapEvents !== undefined && input.maxGapEvents >= 0
        ? Math.floor(input.maxGapEvents)
        : MAX_GAP_EVENTS;

    const minimumGapMilliseconds: number =
      Math.max(0, input.minimumGapSeconds ?? 0) * 1000;

    const shifts: Array<OnCallShift> = [...input.shifts]
      .sort((a: TimeSegment, b: TimeSegment) => {
        return a.start.getTime() - b.start.getTime();
      })
      .map((segment: TimeSegment) => {
        return {
          userId: "",
          start: segment.start,
          end: segment.end,
          coverageSeconds: OneUptimeDate.getDifferenceInSeconds(
            segment.end,
            segment.start,
          ),
        };
      });

    const rawGaps: Array<CoverageGap> = ScheduleShiftUtil.getCoverageGaps(
      shifts,
      input.feedStart,
      input.feedEnd,
    );

    /*
     * getCoverageGaps (shared with the dashboard's coverage view) treats the
     * window end as an arbitrary cut and never reports the stretch after the
     * last shift. For a feed the window end IS the horizon the envelope was
     * computed for, so a rotation that stops mid-window (every user removed
     * after a date, a layer whose users run out) must show its tail as "No
     * coverage" too. The envelope intersection below still clips it to the
     * hours a layer intended to cover, so a business-hours schedule whose last
     * shift ends on Friday still emits nothing for the weekend.
     */
    if (shifts.length > 0) {
      const coveredUntil: number = shifts.reduce(
        (max: number, shift: OnCallShift): number => {
          return Math.max(max, shift.end.getTime());
        },
        shifts[0]!.end.getTime(),
      );

      if (
        input.feedEnd.getTime() - coveredUntil >
        TRAILING_GAP_TOLERANCE_MILLISECONDS
      ) {
        rawGaps.push({ start: new Date(coveredUntil), end: input.feedEnd });
      }
    }

    const envelope: Array<TimeSegment> = OnCallCalendarFeedUtil.mergeSegments(
      input.envelope
        .map((segment: TimeSegment) => {
          return {
            start: new Date(
              Math.max(segment.start.getTime(), input.feedStart.getTime()),
            ),
            end: new Date(
              Math.min(segment.end.getTime(), input.feedEnd.getTime()),
            ),
          };
        })
        .filter((segment: TimeSegment) => {
          return segment.end.getTime() > segment.start.getTime();
        }),
      ENVELOPE_MERGE_TOLERANCE_MILLISECONDS,
    );

    const pieces: Array<TimeSegment> = [];

    for (const gap of rawGaps) {
      for (const intended of envelope) {
        const start: number = Math.max(
          gap.start.getTime(),
          intended.start.getTime(),
        );
        const end: number = Math.min(gap.end.getTime(), intended.end.getTime());

        if (end > start) {
          pieces.push({ start: new Date(start), end: new Date(end) });
        }
      }
    }

    const gaps: Array<TimeSegment> = OnCallCalendarFeedUtil.mergeSegments(
      pieces,
      0,
    ).filter((gap: TimeSegment) => {
      return gap.end.getTime() - gap.start.getTime() >= minimumGapMilliseconds;
    });

    const truncated: boolean = gaps.length > maxGapEvents;
    const kept: Array<TimeSegment> = gaps.slice(0, maxGapEvents);

    return {
      events: kept.map((gap: TimeSegment) => {
        return OnCallCalendarFeedUtil.gapToEvent(gap, input);
      }),
      gaps: kept,
      truncated,
    };
  }

  public static gapToEvent(
    gap: TimeSegment,
    input: {
      scheduleId: string;
      scheduleName: string;
      projectId: string;
      lastModifiedAt: Date;
      shiftConfigVersion: number;
      dashboardUrl: string;
    },
  ): ICalendarEvent {
    const scheduleName: string =
      OnCallCalendarFeedUtil.cleanName(input.scheduleName) || "Schedule";

    const url: string = OnCallCalendarFeedUtil.getScheduleUrl(
      input.dashboardUrl,
      input.projectId,
      input.scheduleId,
    );

    return {
      uid: OnCallCalendarFeedUtil.getGapUid(input.scheduleId, gap.start),
      dtStamp: input.lastModifiedAt,
      lastModified: input.lastModifiedAt,
      sequence: OnCallCalendarFeedUtil.toSequence(input.shiftConfigVersion),
      start: gap.start,
      end: gap.end,
      summary: `No coverage · ${scheduleName}`,
      description: [
        `Nobody is on call for ${scheduleName} during this time, although a layer is meant to cover it.`,
        `Fix the rotation: ${url}`,
        OnCallCalendarFeedUtil.REFRESH_LINE,
      ].join("\n"),
      url,
      status: ICalendarEventStatus.Confirmed,
      transparency: ICalendarTransparency.Transparent,
      categories: [OnCallCalendarFeedUtil.CATEGORY],
    };
  }

  /*
   * ---------------------------------------------------------------------
   * Whole documents
   * ---------------------------------------------------------------------
   */

  public static buildDocument(input: FeedRenderInput): ICalendarDocument {
    const context: ShiftEventContext = {
      kind: input.kind,
      dashboardUrl: input.dashboardUrl,
      viewerTimezone: input.viewerTimezone,
    };

    const events: Array<ICalendarEvent> = [
      ...OnCallCalendarFeedUtil.shiftsToEvents(input.shifts, context),
      ...(input.gapEvents ?? []),
    ].sort((a: ICalendarEvent, b: ICalendarEvent) => {
      const byStart: number = a.start.getTime() - b.start.getTime();
      if (byStart !== 0) {
        return byStart;
      }
      if (a.uid === b.uid) {
        return 0;
      }
      return a.uid < b.uid ? -1 : 1;
    });

    const lastModifiedAt: Date | null =
      input.lastModifiedAt ??
      OnCallCalendarFeedUtil.getLatestModification(
        input.shifts,
        input.gapEvents,
      );

    const calendar: ICalendarCalendar =
      OnCallCalendarFeedUtil.buildCalendarHeader({
        kind: input.kind,
        scheduleName: input.scheduleName,
        projectName: input.projectName,
        filterScheduleName: input.filterScheduleName,
        timezone: input.calendarTimezone ?? input.viewerTimezone,
        lastModifiedAt: lastModifiedAt ?? undefined,
        notes: input.notes,
      });

    return { calendar, events };
  }

  public static render(input: FeedRenderInput): FeedRenderResult {
    const document: ICalendarDocument =
      OnCallCalendarFeedUtil.buildDocument(input);

    return {
      body: ICalendar.serialize(document),
      eventCount: document.events.length,
      lastModifiedAt: document.calendar.lastModified ?? null,
    };
  }

  /*
   * The empty VCALENDAR every "200 but nothing to show" case serves (feed
   * disabled, rotated token inside its grace, project below plan, no eligible
   * schedule). X-WR-CALDESC carries the reason so a subscriber who looks can
   * tell why their calendar went blank.
   */
  public static renderEmpty(input: EmptyFeedInput): string {
    const calendar: ICalendarCalendar =
      OnCallCalendarFeedUtil.buildCalendarHeader({
        kind: input.kind,
        scheduleName: input.scheduleName,
        projectName: input.projectName,
        filterScheduleName: input.filterScheduleName,
        timezone: input.timezone,
        notes: [input.reason],
      });

    return ICalendar.serialize({ calendar, events: [] });
  }

  /*
   * ---------------------------------------------------------------------
   * Helpers
   * ---------------------------------------------------------------------
   */

  public static isValidTimezone(timezone: string | null | undefined): boolean {
    return (
      typeof timezone === "string" &&
      timezone.trim() !== "" &&
      moment.tz.zone(timezone) !== null
    );
  }

  // The zone a shift's wall clock is rendered in; legacy schedules use UTC.
  public static getScheduleZone(shift: MaterializedShift): string {
    return OnCallCalendarFeedUtil.isValidTimezone(shift.scheduleTimezone)
      ? shift.scheduleTimezone!
      : Timezone.UTC;
  }

  public static truncateName(name: string, maxLength: number): string {
    const characters: Array<string> = Array.from(name);

    if (characters.length <= maxLength) {
      return name;
    }

    return `${characters
      .slice(0, Math.max(0, maxLength - 1))
      .join("")
      .trimEnd()}…`;
  }

  // Sort by start and merge segments that overlap or sit within `toleranceMs`.
  public static mergeSegments(
    segments: Array<TimeSegment>,
    toleranceMilliseconds: number,
  ): Array<TimeSegment> {
    const sorted: Array<TimeSegment> = segments
      .filter((segment: TimeSegment) => {
        return segment.end.getTime() > segment.start.getTime();
      })
      .map((segment: TimeSegment) => {
        return {
          start: new Date(segment.start.getTime()),
          end: new Date(segment.end.getTime()),
        };
      })
      .sort((a: TimeSegment, b: TimeSegment) => {
        return a.start.getTime() - b.start.getTime();
      });

    const merged: Array<TimeSegment> = [];

    for (const segment of sorted) {
      const last: TimeSegment | undefined = merged[merged.length - 1];

      if (
        last &&
        segment.start.getTime() <= last.end.getTime() + toleranceMilliseconds
      ) {
        if (segment.end.getTime() > last.end.getTime()) {
          last.end = segment.end;
        }
        continue;
      }

      merged.push(segment);
    }

    return merged;
  }

  public static getDistinctPolicies(
    policies: Array<MaterializedShiftPolicy>,
  ): Array<MaterializedShiftPolicy> {
    const seen: Set<string> = new Set<string>();
    const distinct: Array<MaterializedShiftPolicy> = [];

    for (const policy of policies) {
      if (seen.has(policy.policyId)) {
        continue;
      }
      seen.add(policy.policyId);
      distinct.push(policy);
    }

    return distinct.sort(
      (a: MaterializedShiftPolicy, b: MaterializedShiftPolicy) => {
        return OnCallCalendarFeedUtil.compareStrings(
          a.policyName,
          b.policyName,
        );
      },
    );
  }

  // "Payments › Primary (step 1); Billing › Backup (step 2)"
  public static describePolicies(
    policies: Array<MaterializedShiftPolicy>,
  ): string {
    return [...policies]
      .sort((a: MaterializedShiftPolicy, b: MaterializedShiftPolicy) => {
        return (
          OnCallCalendarFeedUtil.compareStrings(a.policyName, b.policyName) ||
          a.ruleOrder - b.ruleOrder ||
          OnCallCalendarFeedUtil.compareStrings(a.ruleName, b.ruleName)
        );
      })
      .map((policy: MaterializedShiftPolicy) => {
        return `${policy.policyName} › ${policy.ruleName} (step ${policy.ruleOrder})`;
      })
      .join("; ");
  }

  private static buildShiftTimeLines(
    shift: MaterializedShift,
    scheduleZone: string,
    isLegacyZone: boolean,
    viewerTimezone: string | undefined,
  ): Array<string> {
    const zones: Array<string> = [scheduleZone];

    if (scheduleZone !== Timezone.UTC) {
      zones.push(Timezone.UTC);
    }

    if (
      OnCallCalendarFeedUtil.isValidTimezone(viewerTimezone) &&
      !zones.includes(viewerTimezone!)
    ) {
      zones.push(viewerTimezone!);
    }

    const starts: Array<string> = OnCallCalendarFeedUtil.formatInZones(
      shift.start,
      zones,
    );
    const ends: Array<string> = OnCallCalendarFeedUtil.formatInZones(
      shift.end,
      zones,
    );

    const lines: Array<string> = [];

    for (let i: number = 0; i < zones.length; i++) {
      const zone: string = zones[i]!;
      const range: string = `${starts[i]} → ${ends[i]}`;

      if (i === 0) {
        lines.push(
          `Shift: ${range} (${
            isLegacyZone
              ? `UTC — ${OnCallCalendarFeedUtil.LEGACY_TIMEZONE_NOTE}`
              : `${zone} — schedule zone`
          })`,
        );
        continue;
      }

      const label: string =
        zone === Timezone.UTC && zone !== viewerTimezone
          ? "UTC"
          : `${zone} (your zone)`;

      lines.push(`Shift in ${label}: ${range}`);
    }

    return lines;
  }

  // Mirror lines on a global shift for every policy variant that replaces it.
  private static buildVariantMirrorLines(
    shift: MaterializedShift,
    allShifts: Array<MaterializedShift>,
    kind: OnCallCalendarFeedKind,
    scheduleZone: string,
  ): Array<string> {
    const lines: Array<string> = [];

    for (const other of allShifts) {
      if (
        !other.policyVariantOf ||
        other.scheduleId !== shift.scheduleId ||
        other.policyVariantOf.globalUserId !== shift.userId ||
        other.start.getTime() >= shift.end.getTime() ||
        other.end.getTime() <= shift.start.getTime()
      ) {
        continue;
      }

      lines.push(
        `For ${other.policyVariantOf.policyName}, ${OnCallCalendarFeedUtil.getDisplayName(
          other.userName,
          kind,
        )} is paged instead from ${OnCallCalendarFeedUtil.formatInZone(
          other.start,
          scheduleZone,
        )} to ${OnCallCalendarFeedUtil.formatInZone(other.end, scheduleZone)}.`,
      );
    }

    return lines;
  }

  private static formatInZones(
    date: Date,
    zones: Array<string>,
  ): Array<string> {
    return OneUptimeDate.getDateAsFormattedStringInMultipleTimezones({
      date,
      timezones: zones as Array<Timezone>,
      use12HourFormat: false,
    }).split("\n");
  }

  // Same formatter as the shift lines, so every date in a DESCRIPTION matches.
  private static formatInZone(date: Date, zone: string): string {
    return OnCallCalendarFeedUtil.formatInZones(date, [zone])[0] ?? "";
  }

  private static findPolicyName(
    policies: Array<MaterializedShiftPolicy>,
    policyId: string,
  ): string {
    const match: MaterializedShiftPolicy | undefined = policies.find(
      (policy: MaterializedShiftPolicy) => {
        return policy.policyId === policyId;
      },
    );

    return match ? match.policyName : "an escalation policy";
  }

  private static getLatestModification(
    shifts: Array<MaterializedShift>,
    gapEvents: Array<ICalendarEvent> | undefined,
  ): Date | null {
    let latest: number | null = null;

    for (const shift of shifts) {
      const time: number = shift.lastModifiedAt.getTime();
      if (latest === null || time > latest) {
        latest = time;
      }
    }

    for (const event of gapEvents ?? []) {
      const time: number = event.dtStamp.getTime();
      if (latest === null || time > latest) {
        latest = time;
      }
    }

    return latest === null ? null : new Date(latest);
  }

  private static toSequence(version: number): number {
    return Number.isFinite(version) ? Math.max(0, Math.floor(version)) : 0;
  }

  private static epochSeconds(date: Date): number {
    return Math.floor(date.getTime() / 1000);
  }

  private static cleanName(name: string | null | undefined): string {
    return (name ?? "").replace(/\s+/g, " ").trim();
  }

  private static trimTrailingSlash(url: string): string {
    return url.replace(/\/+$/, "");
  }

  private static compareStrings(a: string, b: string): number {
    if (a === b) {
      return 0;
    }
    return a < b ? -1 : 1;
  }
}
