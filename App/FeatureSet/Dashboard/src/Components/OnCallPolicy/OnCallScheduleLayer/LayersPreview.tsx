import { getCoverageWindowEnd } from "./CoverageWindow";
import FinalScheduleSummary from "./FinalScheduleSummary";
import { getColorForUserId } from "./LayerUserColors";
import TimezoneSelectButton from "./TimezoneSelectButton";
import CalendarEvent from "Common/Types/Calendar/CalendarEvent";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import Dictionary from "Common/Types/Dictionary";
import LayerUtil, { LayerProps } from "Common/Types/OnCallDutyPolicy/Layer";
import ScheduleShiftUtil, {
  CoverageGap,
  OnCallShift,
  ScheduleCoverageState,
} from "Common/Types/OnCallDutyPolicy/ScheduleShiftUtil";
import UserOverrideUtil, {
  OverrideEventMeta,
  UserOverrideRecord,
} from "Common/Types/OnCallDutyPolicy/UserOverrideUtil";
import StartAndEndTime from "Common/Types/Time/StartAndEndTime";
import { VoidFunction } from "Common/Types/FunctionTypes";
import ObjectID from "Common/Types/ObjectID";
import Calendar from "Common/UI/Components/Calendar/Calendar";
import FieldLabelElement from "Common/UI/Components/Forms/Fields/FieldLabel";
import OnCallDutyPolicyScheduleLayer from "Common/Models/DatabaseModels/OnCallDutyPolicyScheduleLayer";
import OnCallDutyPolicyScheduleLayerUser from "Common/Models/DatabaseModels/OnCallDutyPolicyScheduleLayerUser";
import User from "Common/Models/DatabaseModels/User";
import {
  PolicyContextState,
  ScheduleOverrideResolution,
  useScheduleUserOverrides,
} from "./ScheduleOverrides";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";

/*
 * How often the preview re-reads the wall clock. Everything on this screen is
 * anchored to "now" — who is on call, which gap contains this instant, how much
 * of a shift is left — so a value captured once at mount slowly turns into a
 * lie. A dashboard left open through a hand-off (or through the start of a
 * coverage gap) would otherwise keep showing the person who WAS on call.
 */
const NOW_REFRESH_INTERVAL_MS: number = 30 * 1000;

export interface ComponentProps {
  layers: Array<OnCallDutyPolicyScheduleLayer>;
  allLayerUsers: Dictionary<Array<OnCallDutyPolicyScheduleLayerUser>>;
  showFieldLabel?: boolean;
  id?: string | undefined;
  /*
   * The schedule's IANA timezone; when set the preview resolves restriction
   * windows in that zone so it matches how the server pages people.
   */
  timezone?: string | undefined;
  /*
   * The schedule being previewed. Used to discover which on-call policy (if
   * exactly one) escalates to it, so the preview applies the same set of user
   * overrides the server does. Omit it and the preview falls back to global
   * overrides only. See POLICY_CONTEXT below.
   */
  onCallDutyPolicyScheduleId?: ObjectID | undefined;
}

interface UserInfo {
  name: string;
  email: string;
}

interface UserColorAssignment {
  userId: string;
  name: string;
  email: string;
  color: string;
  isSubstitute?: boolean;
}

const getDisplayName: (info: UserInfo | undefined) => string = (
  info: UserInfo | undefined,
): string => {
  if (!info) {
    return "Unknown user";
  }
  return info.name || info.email || "Unknown user";
};

const formatUserLabel: (info: UserInfo | undefined) => string = (
  info: UserInfo | undefined,
): string => {
  if (!info) {
    return "Unknown user";
  }
  if (info.name && info.email) {
    return `${info.name} (${info.email})`;
  }
  return info.name || info.email || "Unknown user";
};

const LayersPreview: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  /*
   * Seed the visible range to the current week so the initial render generates
   * events for the whole week the calendar actually shows. The calendar below
   * uses react-big-calendar's default "week" view, but react-big-calendar does
   * not fire onRangeChange on initial mount (only on navigation / view switch).
   * Initializing to a single day made the calendar show just one occurrence
   * until a view was toggled. https://github.com/OneUptime/oneuptime/issues/2466
   */
  const [startTime, setStartTime] = useState<Date>(
    OneUptimeDate.getStartOfTheWeek(OneUptimeDate.getCurrentDate()),
  );
  const [endTime, setEndTime] = useState<Date>(
    OneUptimeDate.getEndOfTheWeek(OneUptimeDate.getCurrentDate()),
  );

  const [calendarEvents, setCalendarEvents] = useState<Array<CalendarEvent>>(
    [],
  );

  // Uncovered stretches inside the calendar's currently-visible range.
  const [calendarGaps, setCalendarGaps] = useState<Array<CoverageGap>>([]);

  /*
   * "now" is held in state, not read during render, so the coverage state
   * actually advances while the page is open. setInterval alone is not enough:
   * browsers throttle (and on mobile, suspend) timers in background tabs, so a
   * tab restored after hours would show a stale "on call right now" until the
   * next tick. Re-reading on visibilitychange makes the refresh immediate.
   */
  const [now, setNow] = useState<Date>(OneUptimeDate.getCurrentDate());

  useEffect(() => {
    const tick: VoidFunction = (): void => {
      setNow(OneUptimeDate.getCurrentDate());
    };

    const intervalId: ReturnType<typeof setInterval> = setInterval(
      tick,
      NOW_REFRESH_INTERVAL_MS,
    );

    const onVisibilityChange: VoidFunction = (): void => {
      if (document.visibilityState === "visible") {
        tick();
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  /*
   * The timezone the preview is DISPLAYED in. Distinct from props.timezone,
   * which is the schedule's operating zone used to COMPUTE shift boundaries and
   * must never change here. "View as" defaults to the schedule zone (so the grid
   * and summary show the zone people are actually paged in) but lets a viewer —
   * e.g. a US operator who configured an India schedule — re-render everything
   * in their own zone to see how the rotation lands for them. Display only: it
   * never affects who is on call or when.
   */
  const [viewAsTimezone, setViewAsTimezone] = useState<string>(
    props.timezone || OneUptimeDate.getCurrentTimezone().toString(),
  );

  // Follow the schedule zone when it changes (e.g. edited on the layers page).
  useEffect(() => {
    setViewAsTimezone(
      props.timezone || OneUptimeDate.getCurrentTimezone().toString(),
    );
  }, [props.timezone]);

  const scheduleUsersById: Dictionary<UserInfo> = useMemo(() => {
    const map: Dictionary<UserInfo> = {};
    for (const key in props.allLayerUsers) {
      const layerUsers: Array<OnCallDutyPolicyScheduleLayerUser> =
        props.allLayerUsers[key] || [];
      for (const layerUser of layerUsers) {
        const user: User | undefined = layerUser.user;
        const userId: string = user?.id?.toString() || "";
        if (user && userId && !map[userId]) {
          map[userId] = {
            name: user.name?.toString() || "",
            email: user.email?.toString() || "",
          };
        }
      }
    }
    return map;
  }, [props.allLayerUsers]);

  const scheduleUserIds: Set<string> = useMemo(() => {
    return new Set<string>(Object.keys(scheduleUsersById));
  }, [scheduleUsersById]);

  /*
   * The overrides in force for this schedule, resolved exactly the way the
   * server resolves them for routing and for the persisted roster. See
   * ./ScheduleOverrides.
   *
   * The fetch window spans BOTH the visible calendar range and the summary's
   * forward coverage window, so a substitution that lands weeks ahead reaches
   * the "upcoming hand-offs" list too, instead of appearing only once the user
   * navigates the calendar to that week — which used to make the summary
   * contradict the grid directly beneath it.
   *
   * Deliberately memoized on the calendar range and NOT on `now`: `now` ticks
   * every 30 seconds, and keying the window to it would refetch the override
   * list twice a minute for a window that has barely moved.
   */
  const overrideWindow: { start: Date; end: Date } = useMemo(() => {
    const windowNow: Date = OneUptimeDate.getCurrentDate();
    const coverageEnd: Date = getCoverageWindowEnd(windowNow);

    return {
      start: OneUptimeDate.isBefore(startTime, windowNow)
        ? startTime
        : windowNow,
      end: OneUptimeDate.isAfter(endTime, coverageEnd) ? endTime : coverageEnd,
    };
  }, [startTime, endTime]);

  const overrideResolution: ScheduleOverrideResolution =
    useScheduleUserOverrides({
      onCallDutyPolicyScheduleId: props.onCallDutyPolicyScheduleId,
      scheduleUserIds,
      windowStart: overrideWindow.start,
      windowEnd: overrideWindow.end,
    });

  const overrideRecords: Array<UserOverrideRecord> = overrideResolution.records;
  const overrideUserInfo: Dictionary<UserInfo> =
    overrideResolution.userInfoById;
  const policyContextIdString: string = overrideResolution.policyContextId;

  const uniqueUsers: Array<UserColorAssignment> = useMemo(() => {
    const seen: Set<string> = new Set<string>();
    const result: Array<UserColorAssignment> = [];

    for (const userId in scheduleUsersById) {
      const info: UserInfo | undefined = scheduleUsersById[userId];
      if (!info || seen.has(userId)) {
        continue;
      }
      seen.add(userId);
      result.push({
        userId,
        name: getDisplayName(info),
        email: info.email,
        color: getColorForUserId(userId),
      });
    }

    for (const o of overrideRecords) {
      const routeId: string = o.routeAlertsToUserId;
      if (!routeId || seen.has(routeId)) {
        continue;
      }
      seen.add(routeId);
      const info: UserInfo | undefined = overrideUserInfo[routeId];
      result.push({
        userId: routeId,
        name: getDisplayName(info),
        email: info?.email || "",
        color: getColorForUserId(routeId),
        isSubstitute: true,
      });
    }

    return result;
  }, [scheduleUsersById, overrideRecords, overrideUserInfo]);

  /*
   * Build the LayerProps array once from the current layers/users. Shared by
   * both the calendar (visible range) and the textual summary (a fixed forward
   * window), so the two are always computed from identical inputs.
   */
  const buildLayerProps: () => Array<LayerProps> = (): Array<LayerProps> => {
    const layerProps: Array<LayerProps> = [];
    for (const layer of props.layers) {
      const layerUsers: Array<OnCallDutyPolicyScheduleLayerUser> =
        props.allLayerUsers[layer.id?.toString() || ""] || [];

      layerProps.push({
        users: layerUsers
          .map((layerUser: OnCallDutyPolicyScheduleLayerUser) => {
            return layerUser.user!;
          })
          .filter(Boolean),
        startDateTimeOfLayer: layer.startsAt!,
        handOffTime: layer.handOffTime!,
        rotation: layer.rotation!,
        restrictionTimes: layer.restrictionTimes!,
        timezone: props.timezone,
      });
    }
    return layerProps;
  };

  /*
   * The combined-schedule shifts for the summary. Computed over a fixed forward
   * window from "now" (independent of where the user has navigated the calendar)
   * so "on call now / up next / upcoming hand-offs" stays stable and meaningful.
   * Uses the same LayerUtil + override application as the calendar, so the
   * summary never contradicts the grid below it.
   */
  const summaryData: {
    shifts: Array<OnCallShift>;
    now: Date;
    windowEnd: Date;
    coverage: ScheduleCoverageState;
  } = useMemo(() => {
    /*
     * The shared coverage window, so this summary and the banner on the layers
     * tab always describe the same span of time. See ./CoverageWindow.
     */
    const windowEnd: Date = getCoverageWindowEnd(now);

    let events: Array<CalendarEvent> = new LayerUtil().getMultiLayerEvents({
      calendarStartDate: now,
      calendarEndDate: windowEnd,
      layers: buildLayerProps(),
    });

    if (overrideRecords.length > 0) {
      events = UserOverrideUtil.applyOverridesToEvents({
        events,
        overrides: overrideRecords,
        currentOnCallDutyPolicyId: policyContextIdString || undefined,
      });
    }

    const shifts: Array<OnCallShift> =
      ScheduleShiftUtil.groupEventsIntoShifts(events);

    /*
     * assignedUserCount counts ASSIGNMENT ROWS, not distinct people, and is
     * taken from the layers rather than from the computed events — a schedule
     * whose layers have no users produces no events at all, and we need to be
     * able to tell that apart from "users exist but none is on call right now".
     */
    const assignedUserCount: number = props.layers.reduce(
      (total: number, layer: OnCallDutyPolicyScheduleLayer) => {
        return (
          total + (props.allLayerUsers[layer.id?.toString() || ""] || []).length
        );
      },
      0,
    );

    return {
      shifts,
      now,
      windowEnd,
      coverage: ScheduleShiftUtil.getCoverageState({
        layerCount: props.layers.length,
        assignedUserCount,
        shifts,
        now,
        windowEnd,
      }),
    };
  }, [props.layers, props.allLayerUsers, props.timezone, overrideRecords, now]);

  useEffect(() => {
    const layerUtil: LayerUtil = new LayerUtil();
    const layerProps: Array<LayerProps> = buildLayerProps();

    let events: Array<CalendarEvent> = layerUtil.getMultiLayerEvents({
      calendarEndDate: endTime,
      calendarStartDate: startTime,
      layers: layerProps,
    });

    if (overrideRecords.length > 0) {
      events = UserOverrideUtil.applyOverridesToEvents({
        events,
        overrides: overrideRecords,
        currentOnCallDutyPolicyId: policyContextIdString || undefined,
      });
    }

    /*
     * Gaps for the VISIBLE range, computed before the events below are
     * relabelled from user ids to display names. They are drawn as hatched
     * background bands so an uncovered stretch reads as "we computed this and
     * nobody is on call" instead of as an empty grid.
     *
     * Computed over the calendar's own range rather than reusing the summary's
     * 42-day window, so navigating to a past or far-future week still shades
     * that week correctly.
     */
    setCalendarGaps(
      ScheduleShiftUtil.getCoverageGaps(
        ScheduleShiftUtil.groupEventsIntoShifts(events),
        startTime,
        endTime,
        // Sub-minute slivers would render as invisible hairlines on the grid.
        { minimumGapSeconds: 60 },
      ),
    );

    const userById: Dictionary<UserInfo> = {
      ...scheduleUsersById,
      ...overrideUserInfo,
    };

    events.forEach((event: CalendarEvent) => {
      const meta: OverrideEventMeta | null =
        UserOverrideUtil.getOverrideMeta(event);
      const displayedUserId: string = event.title;
      const displayedInfo: UserInfo | undefined = userById[displayedUserId];

      event.color = getColorForUserId(displayedUserId);

      if (meta) {
        const originalInfo: UserInfo | undefined =
          userById[meta.originalUserId];
        const originalLabel: string =
          originalInfo?.name || originalInfo?.email || "original user";
        const substituteLabel: string =
          displayedInfo?.name || displayedInfo?.email || "substitute user";
        event.title = `${substituteLabel} (covering ${originalLabel})`;
        event.desc = `Override: ${substituteLabel} is covering for ${originalLabel}.`;
      } else {
        event.title = formatUserLabel(displayedInfo);
      }
    });

    setCalendarEvents(events);
  }, [
    props.layers,
    props.allLayerUsers,
    props.timezone,
    startTime,
    endTime,
    overrideRecords,
    overrideUserInfo,
    scheduleUsersById,
  ]);

  /*
   * Shift each computed instant into the VIEW timezone for the grid. The
   * calendar (react-big-calendar, browser-local localizer) has no timezone
   * concept, so we hand it Dates whose browser-local wall-clock equals the
   * instant's wall-clock in viewAsTimezone — the same trick the datetime input
   * uses (getLocalDateFromWallClockInTimezone). Computation stays in real UTC
   * anchored to props.timezone; only the display Dates move.
   */
  const displayEvents: Array<CalendarEvent> = useMemo(() => {
    return calendarEvents.map((event: CalendarEvent) => {
      return {
        ...event,
        start: OneUptimeDate.getLocalDateFromWallClockInTimezone(
          event.start,
          viewAsTimezone,
        ),
        end: OneUptimeDate.getLocalDateFromWallClockInTimezone(
          event.end,
          viewAsTimezone,
        ),
      };
    });
  }, [calendarEvents, viewAsTimezone]);

  /*
   * The same display shift for the uncovered bands. They carry no title —
   * react-big-calendar draws background events without text — so the "Uncovered"
   * legend swatch below is what names them.
   */
  const displayGapEvents: Array<CalendarEvent> = useMemo(() => {
    return calendarGaps.map((gap: CoverageGap, index: number) => {
      return {
        id: -1 * (index + 1),
        title: "",
        allDay: false,
        start: OneUptimeDate.getLocalDateFromWallClockInTimezone(
          gap.start,
          viewAsTimezone,
        ),
        end: OneUptimeDate.getLocalDateFromWallClockInTimezone(
          gap.end,
          viewAsTimezone,
        ),
      };
    });
  }, [calendarGaps, viewAsTimezone]);

  // "now" shifted into the view zone so the grid opens on that zone's today.
  const displayDefaultDate: Date = useMemo(() => {
    return OneUptimeDate.getLocalDateFromWallClockInTimezone(
      OneUptimeDate.getCurrentDate(),
      viewAsTimezone,
    );
  }, [viewAsTimezone]);

  /*
   * Explain which zone the grid/summary below are rendered in, and — when the
   * viewer has switched away from the schedule's own zone — that these times are
   * for reference only and not the zone people are actually paged in.
   */
  const viewNote: string = props.timezone
    ? viewAsTimezone === props.timezone
      ? `Times below are shown in the schedule's timezone (${props.timezone}) — the zone people are actually paged in.`
      : `Viewing in ${viewAsTimezone}. This schedule is configured and paged in ${props.timezone}, so the times below are for your reference only.`
    : `Viewing in ${viewAsTimezone}. This schedule has no timezone set, so it is paged in the server's local time.`;

  const hasActiveOverrides: boolean = overrideRecords.length > 0;

  /*
   * Say which overrides this preview applied. Silence would be worse than the
   * old (wrong) blanket caveat: a reader cannot tell a preview that applied
   * every relevant override apart from one that applied none, and on a roster
   * screen that difference is the difference between paging the right person
   * and the wrong one.
   */
  const getOverrideScopeNote: () => ReactElement | null =
    (): ReactElement | null => {
      // Nothing to claim yet; a note now could contradict itself a beat later.
      if (
        overrideResolution.policyContextState === PolicyContextState.Resolving
      ) {
        return null;
      }

      const globalOnly: ReactElement = (
        <>
          Note: this preview reflects{" "}
          <span className="font-medium">global</span> user overrides only.
        </>
      );

      if (
        overrideResolution.policyContextState ===
        PolicyContextState.SinglePolicy
      ) {
        return (
          <div className="mt-2 text-xs text-gray-500">
            Note: this preview reflects{" "}
            <span className="font-medium">global</span> user overrides and the
            overrides scoped to the one on-call policy that escalates to this
            schedule — the same set used to route alerts.
          </div>
        );
      }

      /*
       * Attached to several policies. One preview cannot show divergent
       * per-policy substitutions, and neither can the schedule's stored roster,
       * which the server resolves policy-blind for exactly this reason.
       */
      if (overrideResolution.attachedPolicyCount > 1) {
        return (
          <div className="mt-2 text-xs text-gray-500">
            {globalOnly} {overrideResolution.attachedPolicyCount} on-call
            policies escalate to this schedule and each may scope its own
            overrides, so the person actually paged by a given policy may
            differ.
          </div>
        );
      }

      /*
       * No schedule to resolve against - an unsaved schedule being configured -
       * so no policy-scoped override can be attributed to it either way.
       */
      if (!props.onCallDutyPolicyScheduleId) {
        return <div className="mt-2 text-xs text-gray-500">{globalOnly}</div>;
      }

      return (
        <div className="mt-2 text-xs text-gray-500">
          {globalOnly} No on-call policy escalates to this schedule yet, so
          there are no policy-scoped overrides to apply.
        </div>
      );
    };

  return (
    <div id={props.id}>
      {props.showFieldLabel && (
        <FieldLabelElement
          required={true}
          title="Layer Preview"
          description={
            props.timezone
              ? "Here is a preview of who is on call and when. Restriction windows are resolved in this schedule's timezone - " +
                props.timezone
              : "Here is a preview of who is on call and when. This is based on your local timezone - " +
                OneUptimeDate.getCurrentTimezoneString()
          }
        />
      )}

      {/*
       * Textual "who is on call now / next / upcoming" summary of the combined
       * schedule, above the calendar grid it is derived from.
       */}
      {/*
       * Rendered whenever the schedule has layers — NOT only when it has users.
       * Gating this on "has users" was exactly inverted: a schedule with no
       * assigned users is permanently uncovered, and it was the one case where
       * the component that says so never mounted, leaving an empty calendar and
       * no explanation. FinalScheduleSummary handles zero shifts on its own.
       */}
      {props.layers.length > 0 && (
        <FinalScheduleSummary
          shifts={summaryData.shifts}
          now={summaryData.now}
          windowEnd={summaryData.windowEnd}
          coverage={summaryData.coverage}
          timezone={viewAsTimezone}
          userById={{ ...scheduleUsersById, ...overrideUserInfo }}
        />
      )}

      {/*
       * The legend for the grid below. Renders when there is either a colour to
       * explain or a hatched band to name — a schedule with no users still needs
       * the "Uncovered" key, since in that case the whole grid is hatched.
       */}
      {(uniqueUsers.length > 0 || calendarGaps.length > 0) && (
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            {uniqueUsers.length > 0 ? "On-Call Users" : "Legend"}
          </span>
          {uniqueUsers.map((u: UserColorAssignment) => {
            return (
              <div
                key={u.userId}
                className="inline-flex items-center gap-1.5 rounded-md bg-white px-2 py-1 text-xs text-gray-700 ring-1 ring-inset ring-gray-200"
                title={u.email}
              >
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: u.color }}
                />
                <span className="font-medium text-gray-900">{u.name}</span>
                {u.isSubstitute && (
                  <span className="text-[10px] font-medium uppercase tracking-wide text-indigo-600">
                    Covering
                  </span>
                )}
              </div>
            );
          })}
          {/*
           * Names the hatched bands drawn on the grid below. Only shown when
           * the visible range actually contains one, so a fully-covered week
           * does not carry a legend entry for something that is not there.
           */}
          {calendarGaps.length > 0 && (
            <div
              className="inline-flex items-center gap-1.5 rounded-md bg-white px-2 py-1 text-xs text-gray-700 ring-1 ring-inset ring-amber-200"
              title="Nobody is on call during these hours"
            >
              <span className="oneuptime-calendar-gap-swatch inline-block h-2.5 w-2.5 rounded-sm" />
              <span className="font-medium text-amber-800">Uncovered</span>
            </div>
          )}
        </div>
      )}

      {hasActiveOverrides && (
        <div className="mt-2 text-xs text-gray-500">
          Events labelled{" "}
          <span className="font-medium text-indigo-600">covering</span> are
          handled by a substitute user via an active override.
        </div>
      )}

      {getOverrideScopeNote()}

      {/* View-as timezone bubble + note above the calendar grid. */}
      <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            View as
          </span>
          <TimezoneSelectButton
            value={viewAsTimezone}
            icon={IconProp.Clock}
            modalTitle="View schedule in timezone"
            modalDescription="Change the timezone this preview is shown in — for example, to see how an India schedule lands in your US working hours. This only changes what you see; it does not affect who is on call or when."
            submitButtonText="Apply"
            dataTestId="view-as-timezone-button"
            onChange={(timezone: string | undefined) => {
              if (timezone) {
                setViewAsTimezone(timezone);
              }
            }}
          />
        </div>
        <p className="text-xs text-gray-500 sm:max-w-md sm:text-right">
          {viewNote}
        </p>
      </div>

      <Calendar
        events={displayEvents}
        backgroundEvents={displayGapEvents}
        defaultDate={displayDefaultDate}
        onRangeChange={(startEndTime: StartAndEndTime) => {
          /*
           * react-big-calendar reports the visible range in the grid's
           * (view-zone) wall-clock rendered as browser-local Dates. Convert it
           * back to real instants — the inverse of the display shift — so event
           * computation and the override fetch stay in true UTC.
           */
          setStartTime(
            OneUptimeDate.getInstantFromLocalWallClockInTimezone(
              startEndTime.startTime,
              viewAsTimezone,
            ),
          );
          setEndTime(
            OneUptimeDate.getInstantFromLocalWallClockInTimezone(
              startEndTime.endTime,
              viewAsTimezone,
            ),
          );
        }}
      />
    </div>
  );
};

export default LayersPreview;
