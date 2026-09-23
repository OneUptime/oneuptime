/** @timezone Asia/Kolkata */

import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  RenderResult,
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * What the schedule preview hands its calendar grid, as seen by someone whose
 * browser is in India looking at a schedule that runs in Singapore - the setup
 * the on-call calendar display bugs were reported from.
 *
 * The grid is react-big-calendar, which has no timezone concept: it draws
 * every Date at its BROWSER-LOCAL wall clock. So the preview shifts each
 * instant into the schedule's zone before handing it over ("display-local"
 * Dates). Everything the grid is given has to be shifted the same way, and has
 * to describe the visible week honestly:
 *
 *   - the red current-time line and the highlighted "today" column come from
 *     the grid's own idea of now, which used to be the browser clock, so the
 *     line sat two and a half hours early on a grid showing Singapore time;
 *   - shifts were computed for the visible week only, so the week's first
 *     block "started" at 12:00 AM and its last "ended" at 11:59 PM - hand-offs
 *     that never happen;
 *   - before any navigation, that week was the BROWSER's week, not the one
 *     the grid opens on, and after "View as" changed it was still converted
 *     with the zone that was current at the last navigation;
 *   - the hatched "uncovered" bands must cover every uncovered stretch of the
 *     visible range, including the one after its last shift (a whole Saturday
 *     in Day view after a weekday-only rotation), stay inside it, and not
 *     include hairline slivers.
 *
 * The calendar is replaced by a stub that records the props of its latest
 * render, so these tests assert on exactly what react-big-calendar would be
 * given. The CSS/layout half of the fix (how the grid draws those blocks) is
 * covered by the Calendar component's own tests.
 */

const getListMock: MockFunction = getJestMockFunction();

interface CapturedCalendarProps {
  events: Array<CalendarEvent>;
  backgroundEvents?: Array<CalendarEvent> | undefined;
  defaultDate?: Date | undefined;
  getNow?: (() => Date) | undefined;
  onRangeChange: (startAndEndTime: StartAndEndTime) => void;
}

// The props of the calendar's most recent render. Reset before every test.
let latestCalendarProps: CapturedCalendarProps | null = null;

/*
 * The arrow wrappers matter: jest.mock is hoisted above the compiled requires,
 * so the bindings above are still in their temporal dead zone when the factory
 * body runs. Dereferencing lazily, at call time, is what works.
 */
jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        return {
          toString: (): string => {
            return PROJECT_ID;
          },
        };
      },
    },
  };
});

jest.mock("../../../UI/Components/Calendar/Calendar", () => {
  return {
    __esModule: true,
    default: (props: any) => {
      latestCalendarProps = props;
      return (
        <ul data-testid="calendar-events">
          {(props.events || []).map((event: any, index: number) => {
            return (
              <li key={index} data-testid="calendar-event">
                {event.title}
              </li>
            );
          })}
        </ul>
      );
    },
    DefaultCalendarView: {
      Month: "month",
      Week: "week",
      Day: "day",
      Agenda: "agenda",
    },
  };
});

/*
 * The real "View as" picker opens a modal with a searchable dropdown; these
 * tests only care about the zone it hands back, so they click straight to it.
 */
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/TimezoneSelectButton",
  () => {
    return {
      __esModule: true,
      default: (props: {
        value?: string;
        onChange: (value: string | undefined) => void;
      }) => {
        return (
          <button
            type="button"
            data-testid="view-as-new-york"
            data-value={props.value}
            onClick={() => {
              props.onChange("America/New_York");
            }}
          >
            {props.value}
          </button>
        );
      },
    };
  },
);

import LayersPreview from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/LayersPreview";
import { OVERRIDE_EVENT_CLASS_NAME } from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/OverridePresentation";
import OnCallDutyPolicyEscalationRuleSchedule from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleSchedule";
import OnCallDutyPolicyScheduleLayer from "../../../Models/DatabaseModels/OnCallDutyPolicyScheduleLayer";
import OnCallDutyPolicyScheduleLayerUser from "../../../Models/DatabaseModels/OnCallDutyPolicyScheduleLayerUser";
import OnCallDutyPolicyUserOverride from "../../../Models/DatabaseModels/OnCallDutyPolicyUserOverride";
import User from "../../../Models/DatabaseModels/User";
import CalendarEvent from "../../../Types/Calendar/CalendarEvent";
import OneUptimeDate, { Moment } from "../../../Types/Date";
import DayOfWeek from "../../../Types/Day/DayOfWeek";
import Dictionary from "../../../Types/Dictionary";
import EventInterval from "../../../Types/Events/EventInterval";
import Recurring from "../../../Types/Events/Recurring";
import ObjectID from "../../../Types/ObjectID";
import RestrictionTimes, {
  RestrictionType,
} from "../../../Types/OnCallDutyPolicy/RestrictionTimes";
import StartAndEndTime from "../../../Types/Time/StartAndEndTime";

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const SCHEDULE_ID: string = "22222222-2222-4222-8222-222222222222";
const LAYER_ID: string = "33333333-3333-4333-8333-333333333333";
const POLICY_ID: string = "44444444-4444-4444-8444-444444444444";

const USER_A_ID: string = "aaaaaaaa-1111-4111-8111-111111111111";
const USER_B_ID: string = "bbbbbbbb-2222-4222-8222-222222222222";
const USER_C_ID: string = "cccccccc-3333-4333-8333-333333333333";

const USER_NAMES: Dictionary<string> = {
  [USER_A_ID]: "Alice Scheduled",
  [USER_B_ID]: "Bob Rotating",
  [USER_C_ID]: "Carol Covering",
};

// The zone the schedule runs in. The browser (see the docblock) is in India.
const SCHEDULE_TIMEZONE: string = "Asia/Singapore";

/*
 * A Wednesday morning. 09:18 in Singapore, 06:48 in India: two and a half
 * hours apart, which is how far off the current-time line used to be.
 */
const NOW: Date = new Date("2026-09-23T01:18:00.000Z");

/*
 * The week the grid shows (Sun 20 - Sat 26 Sep), reported the way the
 * Calendar component reports it for the week view: browser-local Dates
 * standing for the schedule zone's wall clock, from the first day's midnight
 * to the END of the last day.
 */
const VISIBLE_WEEK_START: Date = new Date(2026, 8, 20, 0, 0, 0, 0);
const VISIBLE_WEEK_END: Date = OneUptimeDate.getEndOfDay(
  new Date(2026, 8, 26, 0, 0, 0, 0),
);

const TIMEOUT_MS: number = 10000;

function objectId(id: string): ObjectID {
  return new ObjectID(id);
}

// An instant given as a wall clock in the schedule's zone, e.g. "2026-09-22 17:02".
function inSchedule(wallClock: string): Date {
  return Moment.tz(wallClock, "YYYY-MM-DD HH:mm", SCHEDULE_TIMEZONE).toDate();
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/*
 * Where the grid draws a display-local Date: its browser-local wall clock,
 * read straight off the Date the way react-big-calendar reads it.
 */
function onGrid(date: Date): string {
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

// The same, to the minute - the grid lays blocks out in whole minutes.
function onGridMinute(date: Date): string {
  return onGrid(date).slice(0, 16);
}

function makeUser(id: string): User {
  const user: User = new User();
  user.id = objectId(id);
  user.name = USER_NAMES[id] as any;
  user.email = `${id}@example.com` as any;
  return user;
}

function noRestrictions(): RestrictionTimes {
  const restrictionTimes: RestrictionTimes = new RestrictionTimes();
  restrictionTimes.restictionType = RestrictionType.None;
  restrictionTimes.dayRestrictionTimes = null;
  return restrictionTimes;
}

// On call only between `from` and `to` (schedule-zone wall clock) every day.
function dailyRestriction(from: string, to: string): RestrictionTimes {
  const restrictionTimes: RestrictionTimes = new RestrictionTimes();
  restrictionTimes.restictionType = RestrictionType.Daily;
  restrictionTimes.dayRestrictionTimes = {
    startTime: inSchedule(`2026-09-01 ${from}`),
    endTime: inSchedule(`2026-09-01 ${to}`),
  };
  restrictionTimes.weeklyRestrictionTimes = [];
  return restrictionTimes;
}

/*
 * On call from Monday 09:00 straight through to Friday 17:00 (schedule-zone
 * wall clock), nobody at the weekend. The engine reads the weekday off the
 * timestamps, so they are a real Monday and Friday.
 */
function weekdaysOnlyRestriction(): RestrictionTimes {
  const restrictionTimes: RestrictionTimes = new RestrictionTimes();
  restrictionTimes.restictionType = RestrictionType.Weekly;
  restrictionTimes.dayRestrictionTimes = null;
  restrictionTimes.weeklyRestrictionTimes = [
    {
      startDay: DayOfWeek.Monday,
      endDay: DayOfWeek.Friday,
      startTime: inSchedule("2026-09-21 09:00"),
      endTime: inSchedule("2026-09-25 17:00"),
    },
  ];
  return restrictionTimes;
}

/*
 * A daily rotation that hands off at `handOff` in the schedule's zone. The
 * default, 5:02 PM, is the hand-off from the report: a time that is neither
 * midnight nor on the hour, so a block that starts or ends at a day boundary
 * can only be an artefact of the computation window. By default the rotation
 * started a month ago; `startsAt` (schedule-zone wall clock) moves that.
 */
function makeLayer(
  restrictionTimes: RestrictionTimes,
  handOff: string = "17:02",
  startsAt: string = "2026-08-20 00:00",
): OnCallDutyPolicyScheduleLayer {
  const layer: OnCallDutyPolicyScheduleLayer =
    new OnCallDutyPolicyScheduleLayer();
  layer.id = objectId(LAYER_ID);
  layer.projectId = objectId(PROJECT_ID);
  layer.onCallDutyPolicyScheduleId = objectId(SCHEDULE_ID);
  layer.order = 1;
  layer.name = "Primary" as any;
  layer.startsAt = inSchedule(startsAt);
  layer.handOffTime = inSchedule(`${startsAt.slice(0, 10)} ${handOff}`);
  layer.rotation = Recurring.fromJSON({
    _type: "Recurring",
    value: {
      intervalType: EventInterval.Day,
      intervalCount: { _type: "PositiveNumber", value: 1 },
    },
  } as any) as any;
  layer.restrictionTimes = restrictionTimes as any;
  return layer;
}

function makeLayerUsers(
  userIds: Array<string>,
): Dictionary<Array<OnCallDutyPolicyScheduleLayerUser>> {
  return {
    [LAYER_ID]: userIds.map(
      (userId: string, index: number): OnCallDutyPolicyScheduleLayerUser => {
        const layerUser: OnCallDutyPolicyScheduleLayerUser =
          new OnCallDutyPolicyScheduleLayerUser();
        layerUser.id = objectId(
          `6666666${index}-6666-4666-8666-666666666666`.slice(0, 36),
        );
        layerUser.onCallDutyPolicyScheduleLayerId = objectId(LAYER_ID);
        layerUser.onCallDutyPolicyScheduleId = objectId(SCHEDULE_ID);
        layerUser.projectId = objectId(PROJECT_ID);
        layerUser.order = index + 1;
        layerUser.userId = objectId(userId);
        layerUser.user = makeUser(userId);
        return layerUser;
      },
    ),
  };
}

interface OverrideFixture {
  overrideUserId: string;
  routeAlertsToUserId: string;
  startsAt: Date;
  endsAt: Date;
}

function toModel(fixture: OverrideFixture): OnCallDutyPolicyUserOverride {
  const model: OnCallDutyPolicyUserOverride =
    new OnCallDutyPolicyUserOverride();
  model.id = objectId("77777777-7777-4777-8777-777777777777");
  model.projectId = objectId(PROJECT_ID);
  model.overrideUserId = objectId(fixture.overrideUserId);
  model.routeAlertsToUserId = objectId(fixture.routeAlertsToUserId);
  model.startsAt = fixture.startsAt;
  model.endsAt = fixture.endsAt;
  // Global overrides only: they apply whatever the policy context resolves to.
  model.onCallDutyPolicyId = null as any;
  model.overrideUser = makeUser(fixture.overrideUserId);
  model.routeAlertsToUser = makeUser(fixture.routeAlertsToUserId);
  return model;
}

interface OverrideQueryWindow {
  start: Date;
  end: Date;
}

/*
 * The window of every override fetch, in call order. The preview asks for
 * overrides with `endsAt >= start AND startsAt <= end`.
 */
function getOverrideQueryWindows(): Array<OverrideQueryWindow> {
  return getListMock.mock.calls
    .map((call: Array<any>): any => {
      return call[0];
    })
    .filter((args: any): boolean => {
      return args?.modelType?.name === "OnCallDutyPolicyUserOverride";
    })
    .map((args: any): OverrideQueryWindow => {
      return {
        start: args.query.endsAt.value as Date,
        end: args.query.startsAt.value as Date,
      };
    });
}

function setupApi(overrides: Array<OverrideFixture>): void {
  getListMock.mockImplementation((args: any) => {
    const modelName: string = args?.modelType?.name || "";

    if (modelName === "OnCallDutyPolicyUserOverride") {
      // Mirrors the server's WHERE clause on the time window.
      const windowStart: Date = args.query.endsAt.value;
      const windowEnd: Date = args.query.startsAt.value;
      const matched: Array<OverrideFixture> = overrides.filter(
        (fixture: OverrideFixture): boolean => {
          return (
            fixture.startsAt.getTime() <= windowEnd.getTime() &&
            fixture.endsAt.getTime() >= windowStart.getTime()
          );
        },
      );
      return Promise.resolve({
        data: matched.map(toModel),
        count: matched.length,
        skip: 0,
        limit: matched.length,
      });
    }

    if (modelName === "OnCallDutyPolicyEscalationRuleSchedule") {
      const join: OnCallDutyPolicyEscalationRuleSchedule =
        new OnCallDutyPolicyEscalationRuleSchedule();
      join.id = objectId("88888888-8888-4888-8888-888888888888");
      join.projectId = objectId(PROJECT_ID);
      join.onCallDutyPolicyScheduleId = objectId(SCHEDULE_ID);
      join.onCallDutyPolicyId = objectId(POLICY_ID);
      return Promise.resolve({ data: [join], count: 1, skip: 0, limit: 1 });
    }

    return Promise.resolve({ data: [], count: 0, skip: 0, limit: 0 });
  });
}

function renderPreview(
  layer: OnCallDutyPolicyScheduleLayer,
  userIds: Array<string>,
): RenderResult {
  return render(
    <LayersPreview
      layers={[layer]}
      allLayerUsers={makeLayerUsers(userIds)}
      timezone={SCHEDULE_TIMEZONE}
      onCallDutyPolicyScheduleId={objectId(SCHEDULE_ID)}
    />,
  );
}

function getCalendarProps(): CapturedCalendarProps {
  if (!latestCalendarProps) {
    throw new Error("The calendar has not rendered yet");
  }
  return latestCalendarProps;
}

/*
 * The override resolution has landed: the note under the legend is only
 * rendered once the policy context and the overrides are known, and is
 * withdrawn again while a new window is being fetched.
 */
async function waitForOverridesResolved(): Promise<void> {
  await waitFor(
    () => {
      expect(
        screen.getByText(/the same set used to route alerts/),
      ).toBeInTheDocument();
    },
    { timeout: TIMEOUT_MS },
  );
}

/*
 * Navigate the grid to a range (a week, or a single day in Day view), the way
 * the Calendar component reports a navigation: display-local Dates from the
 * first day's midnight to the END of the last day. Then let the preview
 * recompute and refetch for it. When the override window moves, the note under
 * the legend is withdrawn until the refetch lands, so the second wait waits
 * for it.
 */
async function showRange(rangeStart: Date, rangeEnd: Date): Promise<void> {
  await waitForOverridesResolved();

  act(() => {
    getCalendarProps().onRangeChange({
      startTime: rangeStart,
      endTime: rangeEnd,
    });
  });

  await waitForOverridesResolved();
}

async function showVisibleWeek(): Promise<void> {
  await showRange(VISIBLE_WEEK_START, VISIBLE_WEEK_END);
}

// An instant written as its wall clock in the schedule's zone, to the second.
function wallClockInSchedule(date: Date): string {
  return Moment.tz(date, SCHEDULE_TIMEZONE).format("YYYY-MM-DD HH:mm:ss");
}

function sortByStart(events: Array<CalendarEvent>): Array<CalendarEvent> {
  return [...events].sort((a: CalendarEvent, b: CalendarEvent): number => {
    return a.start.getTime() - b.start.getTime();
  });
}

function getGapBands(): Array<Array<string>> {
  return sortByStart(getCalendarProps().backgroundEvents || []).map(
    (gap: CalendarEvent): Array<string> => {
      return [onGrid(gap.start), onGrid(gap.end)];
    },
  );
}

/*
 * Every hatched band lies inside the range the grid shows (display-local
 * Dates, as reported through onRangeChange) and is longer than a minute.
 */
function expectBandsInsideRange(rangeStart: Date, rangeEnd: Date): void {
  const gaps: Array<CalendarEvent> = getCalendarProps().backgroundEvents || [];
  expect(gaps.length).toBeGreaterThan(0);

  for (const gap of gaps) {
    expect(gap.start.getTime()).toBeGreaterThanOrEqual(rangeStart.getTime());
    expect(gap.end.getTime()).toBeLessThanOrEqual(rangeEnd.getTime());
    /*
     * Clipping to the range can shorten a band to a sliver, which the grid
     * would draw as a hairline. The preview drops anything of 60 seconds or
     * less, after clipping as well as before.
     */
    expect(gap.end.getTime() - gap.start.getTime()).toBeGreaterThan(60 * 1000);
    /*
     * No title and no colour: the Calendar paints a background event only
     * with a colour its caller asks for, and otherwise leaves it to the
     * stylesheet's hatching. A colour here would draw the band as a block
     * that looks like somebody's shift.
     */
    expect(gap.title).toBe("");
    expect(gap.color).toBeUndefined();
  }
}

beforeEach(() => {
  /*
   * Only Date is faked: the clock is pinned, while timers, microtasks and
   * waitFor's polling stay real.
   */
  jest.useFakeTimers({
    now: NOW,
    doNotFake: [
      "hrtime",
      "nextTick",
      "performance",
      "queueMicrotask",
      "requestAnimationFrame",
      "cancelAnimationFrame",
      "requestIdleCallback",
      "cancelIdleCallback",
      "setImmediate",
      "clearImmediate",
      "setInterval",
      "clearInterval",
      "setTimeout",
      "clearTimeout",
    ],
  });
  getListMock.mockReset();
  latestCalendarProps = null;
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("The grid's clock is the schedule zone's clock", () => {
  test("the test really does run in a browser zone that differs from the schedule's", () => {
    /*
     * Everything below depends on the two zones disagreeing. If the docblock
     * pin stopped working, the assertions would pass for the wrong reason.
     */
    expect(new Date().getHours()).toBe(6);
    expect(new Date().getMinutes()).toBe(48);
  });

  test("getNow places the current-time line at the schedule zone's wall clock, not the browser's", async () => {
    setupApi([]);
    renderPreview(makeLayer(noRestrictions()), [USER_A_ID, USER_B_ID]);
    await waitForOverridesResolved();

    const getNow: (() => Date) | undefined = getCalendarProps().getNow;
    expect(typeof getNow).toBe("function");

    /*
     * The grid shows 09:18 in Singapore at the browser-local 09:18 row, so
     * that is where the red line has to be - not at the browser's own 06:48,
     * two and a half hours up the column.
     */
    const displayNow: Date = getNow!();
    expect(onGrid(displayNow)).toBe("2026-09-23 09:18:00");
    expect(displayNow.getHours()).toBe(9);
    expect(displayNow.getMinutes()).toBe(18);
  });

  test("getNow re-reads the clock on every call, so the line keeps moving", async () => {
    setupApi([]);
    renderPreview(makeLayer(noRestrictions()), [USER_A_ID, USER_B_ID]);
    await waitForOverridesResolved();

    /*
     * react-big-calendar keeps the function it was given and calls it again
     * every minute to move the line. One that returned a Date captured at
     * render would freeze the line where the page was opened.
     */
    const getNow: () => Date = getCalendarProps().getNow!;
    expect(onGrid(getNow())).toBe("2026-09-23 09:18:00");

    jest.setSystemTime(new Date("2026-09-23T03:48:00.000Z"));

    expect(onGrid(getNow())).toBe("2026-09-23 11:48:00");
  });

  test("getNow follows the zone the grid is shown in when that zone changes", async () => {
    setupApi([]);
    const layer: OnCallDutyPolicyScheduleLayer = makeLayer(noRestrictions());
    const layerUsers: Dictionary<Array<OnCallDutyPolicyScheduleLayerUser>> =
      makeLayerUsers([USER_A_ID, USER_B_ID]);

    const { rerender }: RenderResult = render(
      <LayersPreview
        layers={[layer]}
        allLayerUsers={layerUsers}
        timezone={SCHEDULE_TIMEZONE}
        onCallDutyPolicyScheduleId={objectId(SCHEDULE_ID)}
      />,
    );
    await waitForOverridesResolved();
    expect(onGrid(getCalendarProps().getNow!())).toBe("2026-09-23 09:18:00");

    /*
     * The events are re-shifted into the new zone, so the line has to move
     * with them. A getNow that kept the zone it was first created with would
     * leave the line at Singapore's 09:18 on a grid now showing New York,
     * where it is still 21:18 the evening before.
     */
    rerender(
      <LayersPreview
        layers={[layer]}
        allLayerUsers={layerUsers}
        timezone="America/New_York"
        onCallDutyPolicyScheduleId={objectId(SCHEDULE_ID)}
      />,
    );

    await waitFor(
      () => {
        expect(onGrid(getCalendarProps().getNow!())).toBe(
          "2026-09-22 21:18:00",
        );
      },
      { timeout: TIMEOUT_MS },
    );
  });

  test("after midnight in Singapore, 'today' is already the next day even though the browser is still on the previous one", async () => {
    // Thu 24 Sep 01:00 in Singapore; still Wed 23 Sep 22:30 in India.
    jest.setSystemTime(new Date("2026-09-23T17:00:00.000Z"));

    setupApi([]);
    renderPreview(makeLayer(noRestrictions()), [USER_A_ID, USER_B_ID]);
    await waitForOverridesResolved();

    const displayNow: Date = getCalendarProps().getNow!();

    /*
     * getNow also picks the highlighted "today" column. Left to the browser
     * clock it would highlight Wednesday on a grid whose Thursday has already
     * begun - and the line would be drawn in the wrong column entirely.
     */
    expect(onGrid(displayNow)).toBe("2026-09-24 01:00:00");
    expect(displayNow.getDay()).toBe(4);

    // The grid opens on the same day it highlights as today.
    const defaultDate: Date = getCalendarProps().defaultDate!;
    expect(onGrid(defaultDate).slice(0, 10)).toBe("2026-09-24");
  });
});

describe("The grid is given shifts and bands for the range it draws", () => {
  test("before any navigation, a schedule with nobody on it is hatched over exactly the week the grid draws, not the browser's week", async () => {
    setupApi([]);
    renderPreview(makeLayer(noRestrictions()), []);

    /*
     * The week the grid opens on is the schedule zone's current week, drawn
     * as browser-local Dates: Sun 20 Sep 00:00 to Sat 26 Sep 23:59:59.
     */
    const displayNow: Date = OneUptimeDate.getLocalDateFromWallClockInTimezone(
      OneUptimeDate.getCurrentDate(),
      SCHEDULE_TIMEZONE,
    );
    const displayWeekStart: Date = OneUptimeDate.getStartOfTheWeek(displayNow);
    const displayWeekEnd: Date = OneUptimeDate.getEndOfTheWeek(displayNow);
    expect(onGrid(displayWeekStart)).toBe("2026-09-20 00:00:00");
    expect(onGrid(displayWeekEnd)).toBe("2026-09-26 23:59:59");

    /*
     * The range used to be seeded from the BROWSER's week: Sun 20 00:00 in
     * India, which is 02:30 on the Singapore grid, through Sun 27 02:29:59.
     * With nobody on call the whole range is one band, so the grid's first
     * two and a half hours were left unhatched and the band ran on into the
     * next week.
     */
    expect(
      onGrid(
        OneUptimeDate.getLocalDateFromWallClockInTimezone(
          OneUptimeDate.getStartOfTheWeek(OneUptimeDate.getCurrentDate()),
          SCHEDULE_TIMEZONE,
        ),
      ),
    ).toBe("2026-09-20 02:30:00");

    await waitFor(
      () => {
        expect(getGapBands()).toEqual([
          ["2026-09-20 00:00:00", "2026-09-26 23:59:59"],
        ]);
      },
      { timeout: TIMEOUT_MS },
    );
    expect(getCalendarProps().backgroundEvents![0]!.start.getTime()).toBe(
      displayWeekStart.getTime(),
    );
    expectBandsInsideRange(displayWeekStart, displayWeekEnd);
  });

  test("a rotation starting mid-week leaves the week hatched from the grid's first instant, before and after 'View as' changes", async () => {
    setupApi([]);
    // Starts Wed 23 Sep 09:00 in Singapore, i.e. Tue 22 Sep 21:00 in New York.
    renderPreview(makeLayer(noRestrictions(), "17:02", "2026-09-23 09:00"), [
      USER_A_ID,
      USER_B_ID,
    ]);
    await waitForOverridesResolved();

    /*
     * Nobody is on call until the rotation starts. Computed over the browser's
     * week, this band started at 02:30 on the grid instead of at midnight.
     */
    expect(getGapBands()).toEqual([
      ["2026-09-20 00:00:00", "2026-09-23 09:00:00"],
    ]);
    expectBandsInsideRange(VISIBLE_WEEK_START, VISIBLE_WEEK_END);

    // Navigating to the same week reports it, and changes nothing.
    await showVisibleWeek();
    expect(getGapBands()).toEqual([
      ["2026-09-20 00:00:00", "2026-09-23 09:00:00"],
    ]);

    fireEvent.click(screen.getByTestId("view-as-new-york"));

    /*
     * The grid keeps showing Sun 20 - Sat 26, now as New York's wall clock,
     * so the band must still open at its first instant and end where the
     * rotation starts on New York's clock. The reported range used to be
     * converted to instants once, with the zone current at that navigation,
     * so a "View as" change left it at Singapore's week: on New York's grid
     * that starts on Saturday 19 at 12:00, and the week the shifts and bands
     * were computed for no longer matched the week drawn.
     */
    await waitFor(
      () => {
        expect(getGapBands()).toEqual([
          ["2026-09-20 00:00:00", "2026-09-22 21:00:00"],
        ]);
      },
      { timeout: TIMEOUT_MS },
    );
    expectBandsInsideRange(VISIBLE_WEEK_START, VISIBLE_WEEK_END);
  });

  test("before any navigation, the grid is given the shifts and bands of the week it opens on, not the browser's week", async () => {
    // Sun 27 Sep 01:00 in Singapore; still Sat 26 Sep 22:30 in India.
    jest.setSystemTime(new Date("2026-09-26T17:00:00.000Z"));

    setupApi([]);
    renderPreview(makeLayer(dailyRestriction("09:00", "17:00")), [
      USER_A_ID,
      USER_B_ID,
    ]);
    await waitForOverridesResolved();

    /*
     * react-big-calendar does not report its range on mount, so the preview
     * seeds one. Seeded from the browser's week (Sun 20 - Sat 26 in India),
     * the grid opened on Singapore's new week (Sun 27 Sep - Sat 3 Oct) with
     * shifts only up to Mon 28 02:29 and no hatching at all, until the user
     * happened to navigate.
     */
    expect(onGrid(getCalendarProps().defaultDate!).slice(0, 10)).toBe(
      "2026-09-27",
    );
    expect(getGapBands()).toEqual([
      ["2026-09-27 00:00:00", "2026-09-27 09:00:00"],
      ["2026-09-27 17:00:00", "2026-09-28 09:00:00"],
      ["2026-09-28 17:00:00", "2026-09-29 09:00:00"],
      ["2026-09-29 17:00:00", "2026-09-30 09:00:00"],
      ["2026-09-30 17:00:00", "2026-10-01 09:00:00"],
      ["2026-10-01 17:00:00", "2026-10-02 09:00:00"],
      ["2026-10-02 17:00:00", "2026-10-03 09:00:00"],
      ["2026-10-03 17:00:00", "2026-10-03 23:59:59"],
    ]);
    expectBandsInsideRange(
      new Date(2026, 8, 27, 0, 0, 0, 0),
      OneUptimeDate.getEndOfDay(new Date(2026, 9, 3, 0, 0, 0, 0)),
    );

    // Saturday's shift, the last of the week the grid shows, is there too.
    expect(
      getCalendarProps().events.some((event: CalendarEvent): boolean => {
        return onGridMinute(event.start) === "2026-10-03 09:00";
      }),
    ).toBe(true);
  });
});

describe("The grid is given the real start and end of the shifts at the week's edges", () => {
  test("the first and last blocks of the week run on past its edges to the real 5:02 PM hand-offs", async () => {
    setupApi([]);
    renderPreview(makeLayer(noRestrictions()), [USER_A_ID, USER_B_ID]);
    await showVisibleWeek();

    const events: Array<CalendarEvent> = getCalendarProps().events;

    /*
     * The shift on call at the first moment of the week began the previous
     * afternoon. Computed for the visible week only, it was cut to start at
     * Sunday 12:00 AM, which the grid then drew as a hand-off at midnight.
     */
    const coveringWeekStart: CalendarEvent | undefined = events.find(
      (event: CalendarEvent): boolean => {
        return (
          event.start.getTime() < VISIBLE_WEEK_START.getTime() &&
          event.end.getTime() > VISIBLE_WEEK_START.getTime()
        );
      },
    );
    expect(coveringWeekStart).toBeDefined();
    expect(onGridMinute(coveringWeekStart!.start)).toBe("2026-09-19 17:02");
    expect(onGridMinute(coveringWeekStart!.end)).toBe("2026-09-20 17:02");

    // Likewise the last one, which used to "end" at Saturday 11:59:59 PM.
    const coveringWeekEnd: CalendarEvent | undefined = events.find(
      (event: CalendarEvent): boolean => {
        return (
          event.start.getTime() < VISIBLE_WEEK_END.getTime() &&
          event.end.getTime() > VISIBLE_WEEK_END.getTime()
        );
      },
    );
    expect(coveringWeekEnd).toBeDefined();
    expect(onGridMinute(coveringWeekEnd!.start)).toBe("2026-09-26 17:02");
    expect(onGridMinute(coveringWeekEnd!.end)).toBe("2026-09-27 17:02");

    // And nothing else is cut at the week's first or last second either.
    for (const event of events) {
      expect(onGrid(event.start)).not.toBe("2026-09-20 00:00:00");
      expect(onGrid(event.end)).not.toBe("2026-09-26 23:59:59");
    }
  });

  test("consecutive shifts meet at the 5:02 PM hand-off, in the same minute", async () => {
    setupApi([]);
    renderPreview(makeLayer(noRestrictions()), [USER_A_ID, USER_B_ID]);
    await showVisibleWeek();

    /*
     * The reported gap between a shift ending at 5:02 and the next starting
     * at 5:02 was drawn by the grid, not present in the data: the engine's
     * one-second seam (17:02:00 -> 17:02:01) falls inside one minute, and the
     * grid lays blocks out in whole minutes. This pins the data half of that.
     */
    const events: Array<CalendarEvent> = sortByStart(getCalendarProps().events);
    expect(events.length).toBeGreaterThan(7);

    for (let i: number = 1; i < events.length; i++) {
      expect(onGridMinute(events[i]!.start)).toBe(
        onGridMinute(events[i - 1]!.end),
      );
    }

    const handOffs: Array<string> = events
      .slice(1)
      .map((event: CalendarEvent): string => {
        return onGridMinute(event.start).slice(11);
      });
    expect(new Set<string>(handOffs)).toEqual(new Set<string>(["17:02"]));
  });

  test("a midnight hand-off gives back-to-back midnight-to-midnight blocks, none flagged all-day", async () => {
    setupApi([]);
    renderPreview(makeLayer(noRestrictions(), "00:00"), [USER_A_ID, USER_B_ID]);
    await showVisibleWeek();

    const events: Array<CalendarEvent> = sortByStart(getCalendarProps().events);

    /*
     * The 26 Sep report: a shift ending at 12:00 AM and the next starting at
     * 12:00 AM looked like they overlapped. In the data they meet at midnight
     * - one ends at 00:00:00, the next starts in the same minute - and none is
     * all-day, so it is up to the grid to draw them back to back rather than
     * lifting them into the all-day strip (see Calendar.tsx).
     */
    const endingAtSaturdayMidnight: CalendarEvent | undefined = events.find(
      (event: CalendarEvent): boolean => {
        return onGrid(event.end) === "2026-09-26 00:00:00";
      },
    );
    expect(endingAtSaturdayMidnight).toBeDefined();

    for (let i: number = 1; i < events.length; i++) {
      expect(onGridMinute(events[i]!.start)).toBe(
        onGridMinute(events[i - 1]!.end),
      );
    }

    for (const event of events) {
      expect(event.allDay).not.toBe(true);
      expect(onGridMinute(event.start).slice(11)).toBe("00:00");
    }
  });

  test("an override in the day before the week still shapes the block that runs into it", async () => {
    /*
     * The blocks now run a day past each edge of the week, so the overrides
     * in that margin have to be fetched and applied too. Here Carol covers
     * Alice on the Saturday evening before the week, ending an hour before it
     * starts. The block crossing into Sunday is Alice's from 11:00 PM, which
     * its tooltip reports. Fetched from the week's first instant only, as
     * before, this override was never loaded, and the block claimed Alice had
     * been on call since 5:02 PM.
     */
    setupApi([
      {
        overrideUserId: USER_A_ID,
        routeAlertsToUserId: USER_C_ID,
        startsAt: inSchedule("2026-09-19 18:00"),
        endsAt: inSchedule("2026-09-19 23:00"),
      },
    ]);
    renderPreview(makeLayer(noRestrictions()), [USER_A_ID]);
    await showVisibleWeek();

    const windows: Array<OverrideQueryWindow> = getOverrideQueryWindows();
    expect(wallClockInSchedule(windows[windows.length - 1]!.start)).toBe(
      "2026-09-19 00:00:00",
    );

    await waitFor(
      () => {
        const coveringWeekStart: CalendarEvent | undefined =
          getCalendarProps().events.find((event: CalendarEvent): boolean => {
            return (
              event.start.getTime() < VISIBLE_WEEK_START.getTime() &&
              event.end.getTime() > VISIBLE_WEEK_START.getTime()
            );
          });
        expect(coveringWeekStart).toBeDefined();
        expect(onGridMinute(coveringWeekStart!.start)).toBe("2026-09-19 23:00");
        expect(onGridMinute(coveringWeekStart!.end)).toBe("2026-09-20 17:02");
        expect(coveringWeekStart!.title).toContain(USER_NAMES[USER_A_ID]);
        expect(coveringWeekStart!.className).toBeUndefined();
      },
      { timeout: TIMEOUT_MS },
    );
  });

  test("for a week past the summary's window, the override fetch reaches into the day after it", async () => {
    setupApi([]);
    renderPreview(makeLayer(noRestrictions()), [USER_A_ID, USER_B_ID]);

    /*
     * The fetch window also spans the summary's three months ahead, which
     * hides its end for any week close to today. A January week lies past
     * that, so the fetch has to end a full day after the week (Sun 10 Jan)
     * rather than at its last second (Sat 9 Jan 23:59:59), or an override in
     * the margin after the week would be missing from the last block.
     */
    await showRange(
      new Date(2027, 0, 3, 0, 0, 0, 0),
      OneUptimeDate.getEndOfDay(new Date(2027, 0, 9, 0, 0, 0, 0)),
    );

    const windows: Array<OverrideQueryWindow> = getOverrideQueryWindows();
    expect(wallClockInSchedule(windows[windows.length - 1]!.end)).toBe(
      "2027-01-10 23:59:59",
    );
  });

  test("an override is still relabelled, and meets the shift after it at its 5:02 PM end", async () => {
    setupApi([
      {
        overrideUserId: USER_A_ID,
        routeAlertsToUserId: USER_C_ID,
        startsAt: inSchedule("2026-09-22 12:00"),
        endsAt: inSchedule("2026-09-22 17:02"),
      },
    ]);
    renderPreview(makeLayer(noRestrictions()), [USER_A_ID]);
    await showVisibleWeek();

    await waitFor(
      () => {
        expect(
          getCalendarProps().events.some((event: CalendarEvent): boolean => {
            return event.className === OVERRIDE_EVENT_CLASS_NAME;
          }),
        ).toBe(true);
      },
      { timeout: TIMEOUT_MS },
    );

    const events: Array<CalendarEvent> = sortByStart(getCalendarProps().events);
    const overrideIndex: number = events.findIndex(
      (event: CalendarEvent): boolean => {
        return event.className === OVERRIDE_EVENT_CLASS_NAME;
      },
    );
    const overrideEvent: CalendarEvent = events[overrideIndex]!;

    expect(overrideEvent.title).toContain(USER_NAMES[USER_C_ID]);
    expect(overrideEvent.title).toContain(`covering ${USER_NAMES[USER_A_ID]}`);
    expect(onGridMinute(overrideEvent.start)).toBe("2026-09-22 12:00");
    expect(onGridMinute(overrideEvent.end)).toBe("2026-09-22 17:02");

    /*
     * The 12 Sep report: an override ending at 5:02 and the shift after it
     * starting at 5:02 were drawn with a gap between them. The data meets in
     * the same minute on both sides; the gap came from the override block's
     * CSS (see Calendar.css).
     */
    expect(onGridMinute(events[overrideIndex - 1]!.end)).toBe(
      "2026-09-22 12:00",
    );
    expect(onGridMinute(events[overrideIndex + 1]!.start)).toBe(
      "2026-09-22 17:02",
    );
    expect(events[overrideIndex + 1]!.className).toBeUndefined();

    const titles: Array<string> = screen
      .getAllByTestId("calendar-event")
      .map((node: HTMLElement): string => {
        return node.textContent || "";
      });
    expect(
      titles.some((title: string): boolean => {
        return title.includes(`covering ${USER_NAMES[USER_A_ID]}`);
      }),
    ).toBe(true);
  });
});

describe("Uncovered bands cover the visible range and stay inside it", () => {
  function expectBandsInsideVisibleWeek(): void {
    expectBandsInsideRange(VISIBLE_WEEK_START, VISIBLE_WEEK_END);
  }

  test("an office-hours rotation shades every evening and night of the week, including the last evening", async () => {
    setupApi([]);
    renderPreview(makeLayer(dailyRestriction("09:00", "17:00")), [
      USER_A_ID,
      USER_B_ID,
    ]);
    await showVisibleWeek();

    /*
     * The first band opens in the margin day (Saturday 17:00) and is clipped
     * to the week's first instant. The last one runs into the margin day after
     * the week and is clipped to its last second. That last band used to be
     * missing altogether: with shifts computed for the visible week only,
     * nothing followed Saturday's 17:00 end, so Saturday evening - nobody on
     * call - was drawn as an ordinary empty grid.
     */
    expect(getGapBands()).toEqual([
      ["2026-09-20 00:00:00", "2026-09-20 09:00:00"],
      ["2026-09-20 17:00:00", "2026-09-21 09:00:00"],
      ["2026-09-21 17:00:00", "2026-09-22 09:00:00"],
      ["2026-09-22 17:00:00", "2026-09-23 09:00:00"],
      ["2026-09-23 17:00:00", "2026-09-24 09:00:00"],
      ["2026-09-24 17:00:00", "2026-09-25 09:00:00"],
      ["2026-09-25 17:00:00", "2026-09-26 09:00:00"],
      ["2026-09-26 17:00:00", "2026-09-26 23:59:59"],
    ]);
    expectBandsInsideVisibleWeek();
  });

  test("a weekday-only rotation shades the weekend at the end of the week, not just the one at its start", async () => {
    setupApi([]);
    renderPreview(makeLayer(weekdaysOnlyRestriction()), [USER_A_ID, USER_B_ID]);
    await showVisibleWeek();

    /*
     * Nobody is on call from Friday 17:00 until Monday 09:00. The coverage
     * gap finder never reports a hole after the last shift (for the summary,
     * that is just where its data stops), and the next shift after Friday is
     * Monday, beyond even the margin day. So Friday evening and Saturday used
     * to be drawn as an ordinary empty grid, while the same stretch at the
     * start of the week was hatched.
     */
    expect(getGapBands()).toEqual([
      ["2026-09-20 00:00:00", "2026-09-21 09:00:00"],
      ["2026-09-25 17:00:00", "2026-09-26 23:59:59"],
    ]);
    expectBandsInsideVisibleWeek();
  });

  test("in Day view, the evening after a weekday-only rotation's Friday 17:00 end, and the whole Saturday after it, are hatched", async () => {
    setupApi([]);
    renderPreview(makeLayer(weekdaysOnlyRestriction()), [USER_A_ID, USER_B_ID]);

    // Day view reports a single day: its midnight to the end of that day.
    const friday: Date = new Date(2026, 8, 25, 0, 0, 0, 0);
    const fridayEnd: Date = OneUptimeDate.getEndOfDay(friday);
    await showRange(friday, fridayEnd);

    expect(getGapBands()).toEqual([
      ["2026-09-25 17:00:00", "2026-09-25 23:59:59"],
    ]);
    expectBandsInsideRange(friday, fridayEnd);

    const saturday: Date = new Date(2026, 8, 26, 0, 0, 0, 0);
    const saturdayEnd: Date = OneUptimeDate.getEndOfDay(saturday);
    await showRange(saturday, saturdayEnd);

    /*
     * Saturday is computed with a day of margin either side, so Friday's
     * shift is known, but it ends before Saturday begins and the next one
     * (Monday 09:00) lies beyond even the margin. The coverage gap finder
     * only reports holes before or between shifts, so with Friday's shift in
     * the margin it found nothing, and a day with nobody on call at all was
     * drawn as an ordinary empty grid. It is one band, midnight to midnight.
     */
    const bands: Array<CalendarEvent> =
      getCalendarProps().backgroundEvents || [];
    expect(bands).toHaveLength(1);
    expect(onGridMinute(bands[0]!.start)).toBe("2026-09-26 00:00");
    expect(onGridMinute(bands[0]!.end)).toBe("2026-09-26 23:59");
    expect(getGapBands()).toEqual([
      ["2026-09-26 00:00:00", "2026-09-26 23:59:59"],
    ]);
    expectBandsInsideRange(saturday, saturdayEnd);

    // Friday's shift is there, in the margin, and nobody's block is in Saturday.
    const events: Array<CalendarEvent> = getCalendarProps().events;
    expect(
      events.some((event: CalendarEvent): boolean => {
        return onGridMinute(event.end) === "2026-09-25 17:00";
      }),
    ).toBe(true);
    for (const event of events) {
      expect(
        event.start.getTime() < saturdayEnd.getTime() &&
          event.end.getTime() > saturday.getTime(),
      ).toBe(false);
    }
  });

  test("an uncovered stretch lying wholly in the margin days is not drawn", async () => {
    setupApi([]);
    renderPreview(makeLayer(dailyRestriction("20:00", "04:00")), [
      USER_A_ID,
      USER_B_ID,
    ]);
    await showVisibleWeek();

    /*
     * An overnight rotation (20:00 - 04:00) is uncovered 04:00 - 20:00 every
     * day, including Saturday 19 and Sunday 27 - the margin days either side
     * of the week, which are computed but not shown. Those two must not come
     * back as bands (or as an "Uncovered" legend entry for a band nobody can
     * see).
     */
    expect(getGapBands()).toEqual([
      ["2026-09-20 04:00:00", "2026-09-20 20:00:00"],
      ["2026-09-21 04:00:00", "2026-09-21 20:00:00"],
      ["2026-09-22 04:00:00", "2026-09-22 20:00:00"],
      ["2026-09-23 04:00:00", "2026-09-23 20:00:00"],
      ["2026-09-24 04:00:00", "2026-09-24 20:00:00"],
      ["2026-09-25 04:00:00", "2026-09-25 20:00:00"],
      ["2026-09-26 04:00:00", "2026-09-26 20:00:00"],
    ]);
    expectBandsInsideVisibleWeek();
  });

  test("clipping at the week's end does not leave a sub-minute hairline band", async () => {
    setupApi([]);
    renderPreview(makeLayer(dailyRestriction("09:00", "23:59")), [
      USER_A_ID,
      USER_B_ID,
    ]);
    await showVisibleWeek();

    /*
     * On call 09:00 - 23:59, so each night's hole is 23:59 -> 09:00. The one
     * after Saturday is clipped to the week's last second, leaving 59 seconds:
     * a hairline, not a band. It must be dropped after clipping, not only
     * before it.
     */
    expect(getGapBands()).toEqual([
      ["2026-09-20 00:00:00", "2026-09-20 09:00:00"],
      ["2026-09-20 23:59:00", "2026-09-21 09:00:00"],
      ["2026-09-21 23:59:00", "2026-09-22 09:00:00"],
      ["2026-09-22 23:59:00", "2026-09-23 09:00:00"],
      ["2026-09-23 23:59:00", "2026-09-24 09:00:00"],
      ["2026-09-24 23:59:00", "2026-09-25 09:00:00"],
      ["2026-09-25 23:59:00", "2026-09-26 09:00:00"],
    ]);
    expectBandsInsideVisibleWeek();
  });
});
