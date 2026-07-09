import FinalScheduleSummary from "./FinalScheduleSummary";
import { getColorForUserId } from "./LayerUserColors";
import CalendarEvent from "Common/Types/Calendar/CalendarEvent";
import OneUptimeDate from "Common/Types/Date";
import Dictionary from "Common/Types/Dictionary";
import LayerUtil, { LayerProps } from "Common/Types/OnCallDutyPolicy/Layer";
import ScheduleShiftUtil, {
  OnCallShift,
} from "Common/Types/OnCallDutyPolicy/ScheduleShiftUtil";
import UserOverrideUtil, {
  OverrideEventMeta,
  UserOverrideRecord,
} from "Common/Types/OnCallDutyPolicy/UserOverrideUtil";
import StartAndEndTime from "Common/Types/Time/StartAndEndTime";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import GreaterThanOrEqual from "Common/Types/BaseDatabase/GreaterThanOrEqual";
import IsNull from "Common/Types/BaseDatabase/IsNull";
import LessThanOrEqual from "Common/Types/BaseDatabase/LessThanOrEqual";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import Calendar from "Common/UI/Components/Calendar/Calendar";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import FieldLabelElement from "Common/UI/Components/Forms/Fields/FieldLabel";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import TimezoneUtil from "Common/UI/Utils/Timezone";
import OnCallDutyPolicyScheduleLayer from "Common/Models/DatabaseModels/OnCallDutyPolicyScheduleLayer";
import OnCallDutyPolicyScheduleLayerUser from "Common/Models/DatabaseModels/OnCallDutyPolicyScheduleLayerUser";
import OnCallDutyPolicyUserOverride from "Common/Models/DatabaseModels/OnCallDutyPolicyUserOverride";
import User from "Common/Models/DatabaseModels/User";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";

/*
 * Forward window (from "now") the textual schedule summary looks ahead over.
 * The user-override fetch is widened to at least this window too, so the summary
 * reflects the same substitutions the server would page — not just overrides
 * that happen to fall in the calendar's currently-visible range.
 */
const SUMMARY_WINDOW_DAYS: number = 42;

/*
 * Timezone options are static and expensive to sort (every IANA zone by GMT
 * offset), so compute them once at module load rather than per render.
 */
const timezoneDropdownOptions: Array<DropdownOption> =
  TimezoneUtil.getTimezoneDropdownOptions();

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

  const [overrides, setOverrides] = useState<
    Array<OnCallDutyPolicyUserOverride>
  >([]);

  const [overrideUserInfo, setOverrideUserInfo] = useState<
    Dictionary<UserInfo>
  >({});

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
   * Fetch user overrides that touch this calendar window and apply to any
   * user already present in this schedule. Refetches when the range changes.
   *
   * The schedule preview has no policy context (a schedule can be referenced
   * by many policies via escalation rules), so only global overrides are
   * shown here. Policy-scoped overrides are intentionally excluded — surfacing
   * them in a policy-less view would misrepresent how they actually apply
   * during alert dispatch.
   */
  useEffect(() => {
    const projectId: string =
      ProjectUtil.getCurrentProjectId()?.toString() || "";
    if (!projectId || scheduleUserIds.size === 0) {
      setOverrides([]);
      setOverrideUserInfo({});
      return;
    }

    let isCancelled: boolean = false;

    /*
     * Fetch overrides overlapping BOTH the visible calendar range AND the
     * summary's forward window [now, now + SUMMARY_WINDOW_DAYS]. Widening it to
     * the summary window means a substitution that lands weeks ahead is applied
     * to the "upcoming hand-offs" summary too, instead of only appearing once
     * the user navigates the calendar to that week (which previously made the
     * summary contradict the calendar and the actual paging).
     */
    const summaryNow: Date = OneUptimeDate.getCurrentDate();
    const summaryEnd: Date = OneUptimeDate.addRemoveDays(
      summaryNow,
      SUMMARY_WINDOW_DAYS,
    );
    const fetchStart: Date = OneUptimeDate.isBefore(startTime, summaryNow)
      ? startTime
      : summaryNow;
    const fetchEnd: Date = OneUptimeDate.isAfter(endTime, summaryEnd)
      ? endTime
      : summaryEnd;

    const fetchOverrides: () => Promise<void> = async (): Promise<void> => {
      try {
        const result: ListResult<OnCallDutyPolicyUserOverride> =
          await ModelAPI.getList<OnCallDutyPolicyUserOverride>({
            modelType: OnCallDutyPolicyUserOverride,
            query: {
              projectId: ProjectUtil.getCurrentProjectId()!,
              startsAt: new LessThanOrEqual<Date>(fetchEnd),
              endsAt: new GreaterThanOrEqual<Date>(fetchStart),
              onCallDutyPolicyId: new IsNull(),
            },
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            select: {
              startsAt: true,
              endsAt: true,
              overrideUserId: true,
              routeAlertsToUserId: true,
              onCallDutyPolicyId: true,
              overrideUser: {
                name: true,
                email: true,
              },
              routeAlertsToUser: {
                name: true,
                email: true,
              },
            },
            sort: {
              startsAt: SortOrder.Ascending,
            },
          });

        if (isCancelled) {
          return;
        }

        const filtered: Array<OnCallDutyPolicyUserOverride> =
          result.data.filter((o: OnCallDutyPolicyUserOverride) => {
            return scheduleUserIds.has(o.overrideUserId?.toString() || "");
          });

        const userMap: Dictionary<UserInfo> = {};
        for (const o of filtered) {
          const overrideId: string = o.overrideUserId?.toString() || "";
          const routeId: string = o.routeAlertsToUserId?.toString() || "";
          if (overrideId && o.overrideUser && !userMap[overrideId]) {
            userMap[overrideId] = {
              name: o.overrideUser.name?.toString() || "",
              email: o.overrideUser.email?.toString() || "",
            };
          }
          if (routeId && o.routeAlertsToUser && !userMap[routeId]) {
            userMap[routeId] = {
              name: o.routeAlertsToUser.name?.toString() || "",
              email: o.routeAlertsToUser.email?.toString() || "",
            };
          }
        }

        setOverrides(filtered);
        setOverrideUserInfo(userMap);
      } catch {
        if (!isCancelled) {
          setOverrides([]);
          setOverrideUserInfo({});
        }
      }
    };

    fetchOverrides();

    return () => {
      isCancelled = true;
    };
  }, [startTime, endTime, scheduleUserIds]);

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

    for (const o of overrides) {
      const routeId: string = o.routeAlertsToUserId?.toString() || "";
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
  }, [scheduleUsersById, overrides, overrideUserInfo]);

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

  const overrideRecords: Array<UserOverrideRecord> = useMemo(() => {
    return overrides.map(
      (o: OnCallDutyPolicyUserOverride): UserOverrideRecord => {
        return {
          overrideUserId: o.overrideUserId?.toString() || "",
          routeAlertsToUserId: o.routeAlertsToUserId?.toString() || "",
          startsAt: o.startsAt!,
          endsAt: o.endsAt!,
          onCallDutyPolicyId: o.onCallDutyPolicyId?.toString() || null,
        };
      },
    );
  }, [overrides]);

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
  } = useMemo(() => {
    const now: Date = OneUptimeDate.getCurrentDate();
    const windowEnd: Date = OneUptimeDate.addRemoveDays(
      now,
      SUMMARY_WINDOW_DAYS,
    );

    let events: Array<CalendarEvent> = new LayerUtil().getMultiLayerEvents({
      calendarStartDate: now,
      calendarEndDate: windowEnd,
      layers: buildLayerProps(),
    });

    if (overrideRecords.length > 0) {
      events = UserOverrideUtil.applyOverridesToEvents({
        events,
        overrides: overrideRecords,
      });
    }

    return {
      shifts: ScheduleShiftUtil.groupEventsIntoShifts(events),
      now,
      windowEnd,
    };
  }, [props.layers, props.allLayerUsers, props.timezone, overrideRecords]);

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
      });
    }

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

  // "now" shifted into the view zone so the grid opens on that zone's today.
  const displayDefaultDate: Date = useMemo(() => {
    return OneUptimeDate.getLocalDateFromWallClockInTimezone(
      OneUptimeDate.getCurrentDate(),
      viewAsTimezone,
    );
  }, [viewAsTimezone]);

  const selectedViewOption: DropdownOption | undefined =
    timezoneDropdownOptions.find((option: DropdownOption) => {
      return option.value === viewAsTimezone;
    });

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

  const hasActiveOverrides: boolean = overrides.length > 0;

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
      {uniqueUsers.length > 0 && (
        <FinalScheduleSummary
          shifts={summaryData.shifts}
          now={summaryData.now}
          windowEnd={summaryData.windowEnd}
          timezone={viewAsTimezone}
          userById={{ ...scheduleUsersById, ...overrideUserInfo }}
        />
      )}

      {uniqueUsers.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            On-Call Users
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
        </div>
      )}

      {hasActiveOverrides && (
        <div className="mt-2 text-xs text-gray-500">
          Events labelled{" "}
          <span className="font-medium text-indigo-600">covering</span> are
          handled by a substitute user via an active override.
        </div>
      )}

      <div className="mt-2 text-xs text-gray-500">
        Note: this preview reflects <span className="font-medium">global</span>{" "}
        user overrides only. Policy-specific overrides are applied when a
        particular on-call policy escalates and are not shown here, so the
        person actually paged by a given policy may differ.
      </div>

      {/* View-as timezone control + note above the calendar grid. */}
      <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div className="w-full sm:w-72">
          <FieldLabelElement title="View as timezone" />
          <Dropdown
            options={timezoneDropdownOptions}
            value={selectedViewOption}
            placeholder="Select timezone"
            onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
              const timezone: string | undefined =
                value && !Array.isArray(value) ? value.toString() : undefined;

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
