import CalendarEvent from "Common/Types/Calendar/CalendarEvent";
import OneUptimeDate from "Common/Types/Date";
import EventInterval from "Common/Types/Events/EventInterval";
import Recurring from "Common/Types/Events/Recurring";
import LayerUtil, { LayerProps } from "Common/Types/OnCallDutyPolicy/Layer";
import UserOverrideUtil, {
  UserOverrideRecord,
} from "Common/Types/OnCallDutyPolicy/UserOverrideUtil";
import OnCallDutyPolicyScheduleLayer from "Common/Models/DatabaseModels/OnCallDutyPolicyScheduleLayer";
import OnCallDutyPolicyScheduleLayerUser from "Common/Models/DatabaseModels/OnCallDutyPolicyScheduleLayerUser";
import User from "Common/Models/DatabaseModels/User";

/*
 * Client-side glue that turns the stored layer models into the concrete
 * CalendarEvents the summaries read, using the SAME LayerUtil the calendar
 * preview and the server use. Keeping this in one place means the textual
 * rotation summary can never drift from the calendar it sits next to.
 */

export interface LayerPreviewResult {
  events: Array<CalendarEvent>;
  now: Date;
  windowStart: Date;
  windowEnd: Date;
}

/*
 * Advance (or, with a negative count, rewind) a date by `count` rotation periods
 * of the given recurrence. A period is intervalCount units of intervalType, so
 * "every 2 days" advances 2 days per period. This lets the preview window scale
 * to the rotation cadence: an hourly rotation only needs a few hours of window,
 * a monthly rotation needs months.
 */
const addRotationPeriods: (
  date: Date,
  rotation: Recurring,
  count: number,
) => Date = (date: Date, rotation: Recurring, count: number): Date => {
  const rawInterval: number = rotation.intervalCount?.toNumber
    ? rotation.intervalCount.toNumber()
    : 1;
  const interval: number =
    Number.isFinite(rawInterval) && rawInterval >= 1
      ? Math.floor(rawInterval)
      : 1;
  const units: number = interval * count;

  switch (rotation.intervalType) {
    case EventInterval.Hour:
      return OneUptimeDate.addRemoveHours(date, units);
    case EventInterval.Day:
      return OneUptimeDate.addRemoveDays(date, units);
    case EventInterval.Week:
      return OneUptimeDate.addRemoveWeeks(date, units);
    case EventInterval.Month:
      return OneUptimeDate.addRemoveMonths(date, units);
    case EventInterval.Year:
      return OneUptimeDate.addRemoveYears(date, units);
    default:
      return OneUptimeDate.addRemoveDays(date, units);
  }
};

const toLayerUsers: (
  users: Array<OnCallDutyPolicyScheduleLayerUser>,
) => Array<User> = (
  users: Array<OnCallDutyPolicyScheduleLayerUser>,
): Array<User> => {
  return users
    .map((layerUser: OnCallDutyPolicyScheduleLayerUser) => {
      return layerUser.user;
    })
    .filter((user: User | undefined): user is User => {
      return Boolean(user);
    });
};

export interface LayerPreviewParams {
  layer: OnCallDutyPolicyScheduleLayer;
  users: Array<OnCallDutyPolicyScheduleLayerUser>;
  timezone?: string | undefined;
  numberOfShifts?: number | undefined;
  /*
   * User overrides in force for the schedule this layer belongs to, already
   * scoped by the caller (see ../ScheduleOverrides). Applied to the layer's
   * rotation so the card's "on call now" line and the shift table name whoever
   * is ACTUALLY covering, not merely whoever the rotation assigned.
   *
   * A layer preview that skipped this claimed the originally-scheduled user was
   * "on call now" for the whole override window, while the calendar on the same
   * page — and the page that actually rings a phone — said otherwise.
   * https://github.com/OneUptime/oneuptime/issues/3411
   */
  overrides?: Array<UserOverrideRecord> | undefined;
  /*
   * The policy whose scoped overrides apply. Without it, applyOverridesToEvents
   * honours global overrides only, so passing `overrides` alone is not enough.
   */
  currentOnCallDutyPolicyId?: string | undefined;
}

/*
 * Compute the rotation events for a single layer over a window sized to show the
 * current turn plus roughly `numberOfShifts` upcoming turns. The window starts a
 * couple of rotation periods in the past so the CURRENT turn is captured with
 * its true (un-clamped) start rather than starting at "now".
 */
export const getLayerPreviewEvents: (
  params: LayerPreviewParams,
) => LayerPreviewResult = (params: LayerPreviewParams): LayerPreviewResult => {
  const now: Date = OneUptimeDate.getCurrentDate();
  const numberOfShifts: number = params.numberOfShifts || 6;

  /*
   * Used only to size the preview window to the rotation cadence. Guard against
   * a missing or non-canonical rotation so a bad value degrades to a sensible
   * default window instead of throwing during render — the events themselves are
   * still expanded from the layer's real rotation by LayerUtil below.
   */
  let rotation: Recurring;
  try {
    rotation =
      params.layer.rotation instanceof Recurring
        ? params.layer.rotation
        : Recurring.fromJSON(params.layer.rotation as never);
  } catch {
    rotation = Recurring.getDefault();
  }

  /*
   * A little history so the in-progress turn shows its real start; a little
   * extra future (numberOfShifts + 2) so the requested count survives any
   * fully-restricted periods that produce no coverage.
   *
   * The window is ALSO floored to a minimum span (2 days back, 14 days forward)
   * so a fine rotation combined with a coarser restriction still shows upcoming
   * coverage during off-hours. Without the floor, an hourly rotation with a
   * daily 9-5 restriction would size the forward window to ~8 hours; asked at
   * 18:00, that whole window is off-hours and the preview would wrongly show
   * "no upcoming shifts" even though coverage resumes at 09:00 tomorrow.
   * OneUptime restrictions are at most weekly, so a 14-day floor always spans
   * the largest possible off-hours gap.
   */
  const cadenceStart: Date = addRotationPeriods(now, rotation, -2);
  const cadenceEnd: Date = addRotationPeriods(
    now,
    rotation,
    numberOfShifts + 2,
  );
  const minStart: Date = OneUptimeDate.addRemoveDays(now, -2);
  const minEnd: Date = OneUptimeDate.addRemoveDays(now, 14);

  const windowStart: Date = OneUptimeDate.isBefore(cadenceStart, minStart)
    ? cadenceStart
    : minStart;
  const windowEnd: Date = OneUptimeDate.isAfter(cadenceEnd, minEnd)
    ? cadenceEnd
    : minEnd;

  const layerUsers: Array<User> = toLayerUsers(params.users);

  if (layerUsers.length === 0 || !params.layer.startsAt) {
    return { events: [], now, windowStart, windowEnd };
  }

  const layerProps: LayerProps = {
    users: layerUsers,
    startDateTimeOfLayer: params.layer.startsAt,
    handOffTime: params.layer.handOffTime!,
    rotation: params.layer.rotation!,
    restrictionTimes: params.layer.restrictionTimes!,
    timezone: params.timezone,
  };

  let events: Array<CalendarEvent> = new LayerUtil().getEvents({
    ...layerProps,
    calendarStartDate: windowStart,
    calendarEndDate: windowEnd,
  });

  if (params.overrides && params.overrides.length > 0) {
    events = UserOverrideUtil.applyOverridesToEvents({
      events: events,
      overrides: params.overrides,
      currentOnCallDutyPolicyId: params.currentOnCallDutyPolicyId,
    });
  }

  return { events, now, windowStart, windowEnd };
};
