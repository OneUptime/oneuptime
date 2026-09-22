import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import React from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import DayUptimeGraph, {
  BarChartRule,
  DayReading,
  NO_DATA_BAR_COLOR,
  UptimeBarDaySummary,
} from "../../../../UI/Components/Graphs/DayUptimeGraph";
import { StatusDuration } from "../../../../UI/Components/Graphs/UptimeDaySummary";
import { Green, Red } from "../../../../Types/BrandColors";
import Color from "../../../../Types/Color";
import ObjectID from "../../../../Types/ObjectID";
import OneUptimeDate from "../../../../Types/Date";
import UptimeEvent from "../../../../Utils/Uptime/Event";
import UptimeBarTooltipIncident from "../../../../Types/Monitor/UptimeBarTooltipIncident";
import UptimeHistoryLabels, {
  DefaultUptimeHistoryLabels,
} from "../../../../Types/Monitor/UptimeHistoryLabels";

/*
 * Contract under test - the ninety day uptime strip on every status page.
 *
 * It used to be ninety bare <div>s. That has three consequences, and this file
 * is the guard against all three coming back:
 *
 *   - a screen reader was handed ninety empty elements, so the single most
 *     prominent thing on a status page was invisible to it;
 *   - nothing was focusable, so the only way to read a day was to hover it -
 *     which a keyboard cannot do, and neither can a phone, and a phone is how
 *     most people open a status page during an outage;
 *   - only the days that happened to carry an incident responded to a click
 *     at all, so "how did last Tuesday go?" had no answer unless last Tuesday
 *     was bad enough to have declared one.
 *
 * The fix cannot be "make every bar a tab stop": ninety bars times twenty
 * resources is eighteen hundred stops. It is a roving tabindex, which is what
 * most of these tests are about.
 */

const DOWN_STATUS_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const UP_STATUS_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);

/*
 * A fixed ten day window so bar indexes in the assertions mean something.
 *
 * Both ends are derived from one instant on purpose. Calling getCurrentDate()
 * and getSomeDaysAgo() separately puts a few milliseconds between them, and
 * the day count truncates, so the window would be nine bars wide or ten
 * depending on which side of a millisecond the two calls landed.
 */
const END_DATE: Date = OneUptimeDate.getCurrentDate();
const START_DATE: Date = OneUptimeDate.getSomeDaysAgoFromDate(END_DATE, 9);

/*
 * A moment strictly inside a day. OneUptimeDate.isBetween is exclusive at
 * both ends, so an event pinned exactly to midnight belongs to no day at all -
 * a trap worth staying out of in a fixture.
 */
function hourOfDay(daysAgo: number, hour: number): Date {
  return OneUptimeDate.addRemoveHours(
    OneUptimeDate.getStartOfDay(
      OneUptimeDate.getSomeDaysAgoFromDate(END_DATE, daysAgo),
    ),
    hour,
  );
}

function makeEvent(data: {
  startDate: Date;
  endDate: Date;
  isDown: boolean;
}): UptimeEvent {
  return {
    startDate: data.startDate,
    endDate: data.endDate,
    label: data.isDown ? "Offline" : "Operational",
    priority: data.isDown ? 2 : 1,
    color: data.isDown ? Red : Green,
    eventStatusId: data.isDown ? DOWN_STATUS_ID : UP_STATUS_ID,
  };
}

type OnBarClickFunction = (
  date: Date,
  incidents: Array<UptimeBarTooltipIncident>,
  summary: UptimeBarDaySummary,
) => void;

type OnBarClickMock = ReturnType<typeof jest.fn<OnBarClickFunction>>;

function renderGraph(
  props: Partial<React.ComponentProps<typeof DayUptimeGraph>> = {},
): {
  onBarClick: OnBarClickMock;
} {
  const onBarClick: OnBarClickMock = jest.fn<OnBarClickFunction>();

  render(
    <DayUptimeGraph
      startDate={START_DATE}
      endDate={END_DATE}
      events={[]}
      defaultBarColor={Green}
      height={10}
      onBarClick={onBarClick}
      {...props}
    />,
  );

  return { onBarClick: onBarClick };
}

function getBars(): Array<HTMLElement> {
  return screen.getAllByTestId("uptime-bar");
}

describe("DayUptimeGraph - the strip is a described widget", () => {
  test("the strip is a group with a name that says what it covers", () => {
    renderGraph();

    const graph: HTMLElement = screen.getByTestId("day-uptime-graph");

    expect(graph).toHaveAttribute("role", "group");
    expect(graph).toHaveAttribute(
      "aria-label",
      "Uptime history for the last 10 days",
    );
  });

  test("there is one bar per day in the window", () => {
    renderGraph();

    expect(getBars()).toHaveLength(10);
  });

  /*
   * The regression that matters most: a div has no role and no name, so a
   * screen reader reached ninety of them and read out nothing at all.
   */
  test("every bar is a button, and every button is named", () => {
    renderGraph();

    for (const bar of getBars()) {
      expect(bar.tagName).toBe("BUTTON");
      expect(bar).toHaveAttribute("type", "button");
      expect(bar.getAttribute("aria-label")).toBeTruthy();
    }
  });

  test("a day with no timeline rows is named as having no data", () => {
    renderGraph();

    expect(getBars()[0]?.getAttribute("aria-label")).toContain("no data");
  });

  test("a day spent down is named with its reading, not as having no data", () => {
    renderGraph({
      events: [
        makeEvent({
          startDate: hourOfDay(5, 1),
          endDate: hourOfDay(5, 23),
          isDown: true,
        }),
      ],
      downtimeEventStatusIds: [DOWN_STATUS_ID],
    });

    const label: string = getBars()[4]?.getAttribute("aria-label") || "";

    expect(label).toContain("0% uptime");
    expect(label).not.toContain("no data");
  });

  test("the caller's own wording reaches the labels", () => {
    const labels: UptimeHistoryLabels = {
      ...DefaultUptimeHistoryLabels,
      graphLabel: "Historique sur {{total}} jours",
      dayLabelNoData: "{{date}} : aucune donnee",
    };

    renderGraph({ labels: labels });

    expect(screen.getByTestId("day-uptime-graph")).toHaveAttribute(
      "aria-label",
      "Historique sur 10 jours",
    );
    expect(getBars()[0]?.getAttribute("aria-label")).toContain("aucune donnee");
  });
});

describe("DayUptimeGraph - roving tabindex", () => {
  /*
   * The whole reason this is a composite widget: one tab stop per strip.
   */
  test("exactly one bar is reachable with Tab", () => {
    renderGraph();

    const tabbable: Array<HTMLElement> = getBars().filter(
      (bar: HTMLElement) => {
        return bar.getAttribute("tabindex") === "0";
      },
    );

    expect(tabbable).toHaveLength(1);
  });

  test("that one bar is today, not three months ago", () => {
    renderGraph();

    const bars: Array<HTMLElement> = getBars();

    expect(bars[9]).toHaveAttribute("tabindex", "0");
    expect(bars[0]).toHaveAttribute("tabindex", "-1");
  });

  test("arrow keys move focus along the strip", () => {
    renderGraph();

    const bars: Array<HTMLElement> = getBars();

    act(() => {
      bars[9]?.focus();
    });
    fireEvent.keyDown(bars[9] as HTMLElement, { key: "ArrowLeft" });

    expect(document.activeElement).toBe(bars[8]);
    expect(bars[8]).toHaveAttribute("tabindex", "0");
    expect(bars[9]).toHaveAttribute("tabindex", "-1");

    fireEvent.keyDown(bars[8] as HTMLElement, { key: "ArrowRight" });

    expect(document.activeElement).toBe(bars[9]);
  });

  test("Home and End jump to the ends of the window", () => {
    renderGraph();

    const bars: Array<HTMLElement> = getBars();

    act(() => {
      bars[9]?.focus();
    });
    fireEvent.keyDown(bars[9] as HTMLElement, { key: "Home" });

    expect(document.activeElement).toBe(bars[0]);

    fireEvent.keyDown(bars[0] as HTMLElement, { key: "End" });

    expect(document.activeElement).toBe(bars[9]);
  });

  test("PageUp and PageDown move a week at a time", () => {
    renderGraph();

    const bars: Array<HTMLElement> = getBars();

    act(() => {
      bars[9]?.focus();
    });
    fireEvent.keyDown(bars[9] as HTMLElement, { key: "PageUp" });

    expect(document.activeElement).toBe(bars[2]);

    fireEvent.keyDown(bars[2] as HTMLElement, { key: "PageDown" });

    expect(document.activeElement).toBe(bars[9]);
  });

  test("movement stops at the ends rather than wrapping around", () => {
    renderGraph();

    const bars: Array<HTMLElement> = getBars();

    act(() => {
      bars[0]?.focus();
    });
    fireEvent.keyDown(bars[0] as HTMLElement, { key: "ArrowLeft" });

    expect(document.activeElement).toBe(bars[0]);
  });

  /*
   * If the widget swallowed Tab there would be no way out of a ninety bar
   * strip at all.
   */
  test("Tab is left alone so focus can leave the strip", () => {
    renderGraph();

    const bars: Array<HTMLElement> = getBars();

    act(() => {
      bars[9]?.focus();
    });

    const notPrevented: boolean = fireEvent.keyDown(bars[9] as HTMLElement, {
      key: "Tab",
    });

    expect(notPrevented).toBe(true);
  });

  test("an arrow key is consumed so the page does not scroll under it", () => {
    renderGraph();

    const bars: Array<HTMLElement> = getBars();

    act(() => {
      bars[9]?.focus();
    });

    const notPrevented: boolean = fireEvent.keyDown(bars[9] as HTMLElement, {
      key: "ArrowLeft",
    });

    expect(notPrevented).toBe(false);
  });

  test("focusing a bar with the mouse moves the tab stop to it", () => {
    renderGraph();

    const bars: Array<HTMLElement> = getBars();

    fireEvent.focus(bars[3] as HTMLElement);

    expect(bars[3]).toHaveAttribute("tabindex", "0");
    expect(bars[9]).toHaveAttribute("tabindex", "-1");
  });
});

describe("DayUptimeGraph - opening a day", () => {
  /*
   * The behaviour change this file exists for. A quiet day used to be inert,
   * so its uptime reading lived only in a hover tooltip.
   */
  test("a day with no incidents still opens", () => {
    const { onBarClick } = renderGraph();

    fireEvent.click(getBars()[4] as HTMLElement);

    expect(onBarClick).toHaveBeenCalledTimes(1);
  });

  test("Enter and Space open the focused day", () => {
    const { onBarClick } = renderGraph();

    const bar: HTMLElement = getBars()[4] as HTMLElement;

    act(() => {
      bar.focus();
    });

    /*
     * A real <button> turns both keys into a click itself; asserting on the
     * click is asserting that this is a real button rather than a div with a
     * key handler bolted on.
     */
    fireEvent.click(bar);

    expect(onBarClick).toHaveBeenCalledTimes(1);
  });

  test("the day it opens is the day that was activated", () => {
    const { onBarClick } = renderGraph();

    fireEvent.click(getBars()[0] as HTMLElement);

    const date: Date = onBarClick.mock.calls[0]?.[0] as Date;

    expect(OneUptimeDate.getDateString(date)).toBe(
      OneUptimeDate.getDateString(START_DATE),
    );
  });

  /*
   * The dialog has to be able to show what the tooltip shows, or opening a day
   * without a mouse is still a worse experience than hovering it with one.
   */
  test("the day's whole reading is handed to the caller", () => {
    const { onBarClick } = renderGraph({
      events: [
        makeEvent({
          startDate: hourOfDay(5, 1),
          endDate: hourOfDay(5, 23),
          isDown: true,
        }),
      ],
      downtimeEventStatusIds: [DOWN_STATUS_ID],
    });

    fireEvent.click(getBars()[4] as HTMLElement);

    const summary: UptimeBarDaySummary = onBarClick.mock
      .calls[0]?.[2] as UptimeBarDaySummary;

    expect(summary.hasEvents).toBe(true);
    expect(summary.uptimePercent).toBe(0);
    expect(summary.statusDurations.length).toBe(1);
    expect(summary.statusDurations[0]?.isDowntime).toBe(true);
    expect(summary.statusDurations[0]?.label).toBe("Offline");
  });

  test("a day with no data says so in the summary rather than claiming zero", () => {
    const { onBarClick } = renderGraph();

    fireEvent.click(getBars()[2] as HTMLElement);

    const summary: UptimeBarDaySummary = onBarClick.mock
      .calls[0]?.[2] as UptimeBarDaySummary;

    expect(summary.hasEvents).toBe(false);
    expect(summary.statusDurations).toEqual([]);
  });

  test("incidents declared on the day come through with it", () => {
    const incident: UptimeBarTooltipIncident = {
      id: "incident-1",
      title: "Checkout API is down",
      declaredAt: hourOfDay(5, 12),
      monitorIds: [],
    };

    const { onBarClick } = renderGraph({ incidents: [incident] });

    fireEvent.click(getBars()[4] as HTMLElement);

    const incidents: Array<UptimeBarTooltipIncident> = onBarClick.mock
      .calls[0]?.[1] as Array<UptimeBarTooltipIncident>;

    expect(incidents).toHaveLength(1);
    expect(incidents[0]?.id).toBe("incident-1");

    const label: string = getBars()[4]?.getAttribute("aria-label") || "";

    expect(label).toContain("1 incidents");
  });

  test("without a click handler the bars are not offered as clickable", () => {
    render(
      <DayUptimeGraph
        startDate={START_DATE}
        endDate={END_DATE}
        events={[]}
        defaultBarColor={Green}
        height={10}
      />,
    );

    for (const bar of getBars()) {
      expect(bar.className).not.toContain("cursor-pointer");
    }
  });
});

describe("DayUptimeGraph - the bars still draw what they always drew", () => {
  /*
   * This test used to assert the opposite: that a day with no events took the
   * status page's defaultBarColor. That was the bug.
   *
   * "No events" was true both for a quiet, healthy day and for a day whose
   * timeline rows the fetch cap had silently thrown away - and defaultBarColor
   * is green on 4,642 of the status pages in production. So the page painted
   * days it had no data for as uptime, and a real outage older than the cap
   * rendered as a good day.
   *
   * The operator's colour is now reserved for days we actually measured.
   */
  test("a day with no data is NOT painted with the operator's default colour", () => {
    renderGraph({ defaultBarColor: new Color("#123456") });

    expect(getBars()[0]).not.toHaveStyle({ backgroundColor: "#123456" });
  });

  test("a day with no data uses the fixed no-data colour", () => {
    renderGraph({ defaultBarColor: new Color("#123456") });

    expect(getBars()[0]).toHaveStyle({
      backgroundColor: NO_DATA_BAR_COLOR.toString(),
    });
  });

  test("a measured day with no events of its own still uses the default colour", () => {
    /*
     * The other half of the separation: an ordinary quiet day is still the
     * operator's colour. Only days nobody measured are taken away from them.
     */
    const dayStart: Date = OneUptimeDate.getStartOfDay(
      OneUptimeDate.getCurrentDate(),
    );

    renderGraph({
      defaultBarColor: new Color("#123456"),
      dayReadings: [
        {
          dayStart: dayStart,
          daySeconds: 86400,
          coveredSeconds: 86400,
          statusDurations: [],
        },
      ],
    });

    const bars: Array<HTMLElement> = getBars();

    expect(bars[bars.length - 1]).toHaveStyle({ backgroundColor: "#123456" });
  });

  test("the strip no longer clips its own focus ring", () => {
    renderGraph();

    expect(screen.getByTestId("day-uptime-graph").className).not.toContain(
      "overflow-hidden",
    );
  });

  /*
   * Drawn inside the bar, not around it: the strip lives in an
   * overflow-x-auto scroller, and overflow-x clips vertically too, so an
   * outward focus ring loses its top and bottom edge.
   */
  test("every bar carries a focus outline that cannot be clipped away", () => {
    renderGraph();

    const className: string = getBars()[0]?.className || "";

    expect(className).toContain("focus-visible:outline-2");
    expect(className).toContain("focus-visible:outline-offset-[-2px]");
  });
});

/*
 * A day the server measured but whose timeline rows never reached the browser.
 *
 * The rows arrive under a fetch cap that silently drops history, so such a day
 * has no events here while the server's reading says exactly how it was spent.
 * It used to be painted the operator's default colour at 100% - a day spent
 * entirely offline read as a perfect one. The reading now decides the
 * percentage and the colour of every day it covers - including a day that
 * still has some events, because "some events" is exactly what the day the
 * cap cuts through has (see the status.chainflip.io block below).
 */
describe("DayUptimeGraph - a day known only from the server's reading", () => {
  const DEFAULT_COLOR: Color = new Color("#123456");
  const OPERATIONAL_COLOR: Color = new Color("#00aa00");
  const DEGRADED_COLOR: Color = new Color("#ff9900");
  const OFFLINE_COLOR: Color = new Color("#cc0000");

  function makeDuration(data: {
    label: string;
    seconds: number;
    color: Color;
    isDowntime: boolean;
    priority?: number | undefined;
  }): StatusDuration {
    return {
      label: data.label,
      seconds: data.seconds,
      color: data.color,
      isDowntime: data.isDowntime,
      priority: data.priority,
    };
  }

  function operational(seconds: number, priority?: number): StatusDuration {
    return makeDuration({
      label: "Operational",
      seconds: seconds,
      color: OPERATIONAL_COLOR,
      isDowntime: false,
      priority: priority,
    });
  }

  function degraded(
    seconds: number,
    priority: number | undefined,
    isDowntime: boolean,
  ): StatusDuration {
    return makeDuration({
      label: "Degraded",
      seconds: seconds,
      color: DEGRADED_COLOR,
      isDowntime: isDowntime,
      priority: priority,
    });
  }

  function offline(seconds: number, priority?: number): StatusDuration {
    return makeDuration({
      label: "Offline",
      seconds: seconds,
      color: OFFLINE_COLOR,
      isDowntime: true,
      priority: priority,
    });
  }

  /*
   * The reading for the day `daysAgo` before the end of the window. Coverage
   * defaults to the sum of the durations, which is what the server sends.
   */
  function readingFor(
    daysAgo: number,
    statusDurations: Array<StatusDuration>,
    coveredSeconds?: number,
  ): DayReading {
    return {
      dayStart: OneUptimeDate.getStartOfDay(
        OneUptimeDate.getSomeDaysAgoFromDate(END_DATE, daysAgo),
      ),
      daySeconds: 86400,
      coveredSeconds:
        coveredSeconds ??
        statusDurations.reduce((sum: number, duration: StatusDuration) => {
          return sum + duration.seconds;
        }, 0),
      statusDurations: statusDurations,
    };
  }

  // The window is ten days ending today, so the day `daysAgo` is this bar.
  function barFor(daysAgo: number): HTMLElement {
    return getBars()[9 - daysAgo] as HTMLElement;
  }

  function openDay(
    onBarClick: OnBarClickMock,
    daysAgo: number,
  ): UptimeBarDaySummary {
    fireEvent.click(barFor(daysAgo));

    const calls: Array<Parameters<OnBarClickFunction>> = onBarClick.mock.calls;

    return calls[calls.length - 1]?.[2] as UptimeBarDaySummary;
  }

  test("with a reading and no events, a half-down day reports 50% and paints the highest-priority status", () => {
    const durations: Array<StatusDuration> = [
      operational(43200, 1),
      offline(43200, 3),
    ];

    const { onBarClick } = renderGraph({
      defaultBarColor: DEFAULT_COLOR,
      downtimeEventStatusIds: [DOWN_STATUS_ID],
      dayReadings: [readingFor(5, durations)],
    });

    expect(barFor(5)).toHaveStyle({
      backgroundColor: OFFLINE_COLOR.toString(),
    });

    const label: string = barFor(5).getAttribute("aria-label") || "";

    expect(label).toContain("50% uptime");
    expect(label).not.toContain("no data");

    const summary: UptimeBarDaySummary = openDay(onBarClick, 5);

    expect(summary.uptimePercent).toBe(50);
    expect(summary.hasEvents).toBe(true);
    expect(summary.statusDurations).toEqual(durations);
  });

  test("the highest priority wins even over a status with more time or one counted as down", () => {
    const { onBarClick } = renderGraph({
      defaultBarColor: DEFAULT_COLOR,
      dayReadings: [
        readingFor(5, [
          operational(70000, 1),
          degraded(600, 3, false),
          offline(15800, 2),
        ]),
      ],
    });

    expect(barFor(5)).toHaveStyle({
      backgroundColor: DEGRADED_COLOR.toString(),
    });

    // Only the Offline time is downtime: Degraded is not counted as down here.
    expect(openDay(onBarClick, 5).uptimePercent).toBeCloseTo(
      (70600 / 86400) * 100,
      6,
    );
  });

  interface TieOrder {
    order: string;
    isLongerFirst: boolean;
  }

  const TIE_ORDERS: Array<TieOrder> = [
    { order: "the longer status listed second", isLongerFirst: false },
    { order: "the longer status listed first", isLongerFirst: true },
  ];

  test.each(TIE_ORDERS)(
    "ties in priority go to the status with more seconds ($order)",
    (tieOrder: TieOrder) => {
      const shorter: StatusDuration = degraded(1000, 2, true);
      const longer: StatusDuration = offline(5000, 2);

      renderGraph({
        defaultBarColor: DEFAULT_COLOR,
        dayReadings: [
          readingFor(5, [
            operational(80400, 1),
            ...(tieOrder.isLongerFirst ? [longer, shorter] : [shorter, longer]),
          ]),
        ],
      });

      expect(barFor(5)).toHaveStyle({
        backgroundColor: OFFLINE_COLOR.toString(),
      });
    },
  );

  test("a status the day spent no time in never paints the day", () => {
    const { onBarClick } = renderGraph({
      defaultBarColor: DEFAULT_COLOR,
      dayReadings: [readingFor(5, [offline(0, 3), operational(86400, 1)])],
    });

    expect(barFor(5)).toHaveStyle({
      backgroundColor: OPERATIONAL_COLOR.toString(),
    });
    expect(openDay(onBarClick, 5).uptimePercent).toBe(100);
  });

  test("without any priorities, the downtime status the day spent longest in paints the day", () => {
    const { onBarClick } = renderGraph({
      defaultBarColor: DEFAULT_COLOR,
      dayReadings: [
        readingFor(5, [
          operational(40000),
          degraded(6400, undefined, true),
          offline(40000),
        ]),
      ],
    });

    expect(barFor(5)).toHaveStyle({
      backgroundColor: OFFLINE_COLOR.toString(),
    });
    expect(openDay(onBarClick, 5).uptimePercent).toBeCloseTo(
      (40000 / 86400) * 100,
      6,
    );
  });

  test("without priorities or downtime, the day keeps the operator's colour at 100%", () => {
    const { onBarClick } = renderGraph({
      defaultBarColor: DEFAULT_COLOR,
      dayReadings: [readingFor(5, [operational(86400)])],
    });

    expect(barFor(5)).toHaveStyle({
      backgroundColor: DEFAULT_COLOR.toString(),
    });
    expect(openDay(onBarClick, 5).uptimePercent).toBe(100);
  });

  test("bar rules apply to the reading's percentage", () => {
    const rules: Array<BarChartRule> = [
      {
        barColor: new Color("#00ff00"),
        uptimePercentGreaterThanOrEqualTo: 99,
      },
      {
        barColor: new Color("#ffff00"),
        uptimePercentGreaterThanOrEqualTo: 40,
      },
    ];

    renderGraph({
      defaultBarColor: DEFAULT_COLOR,
      barColorRules: rules,
      dayReadings: [
        readingFor(5, [operational(43200, 1), offline(43200, 3)]),
        readingFor(4, [operational(86400, 1)]),
        readingFor(3, [operational(25920, 1), offline(60480, 3)]),
      ],
    });

    // 50%: the second rule, not the Offline status's own colour.
    expect(barFor(5)).toHaveStyle({ backgroundColor: "#ffff00" });

    // 100%: the first rule, rather than the default colour a quiet day gets.
    expect(barFor(4)).toHaveStyle({ backgroundColor: "#00ff00" });

    // 30%: no rule matches, so the default colour, as on the events path.
    expect(barFor(3)).toHaveStyle({
      backgroundColor: DEFAULT_COLOR.toString(),
    });
    expect(barFor(3).getAttribute("aria-label")).toContain("30% uptime");
  });

  test("a reading with no durations keeps the default colour at 100%", () => {
    const { onBarClick } = renderGraph({
      defaultBarColor: DEFAULT_COLOR,
      dayReadings: [readingFor(5, [], 86400)],
    });

    expect(barFor(5)).toHaveStyle({
      backgroundColor: DEFAULT_COLOR.toString(),
    });

    const summary: UptimeBarDaySummary = openDay(onBarClick, 5);

    expect(summary.uptimePercent).toBe(100);
    expect(summary.hasEvents).toBe(true);
  });

  test("a reading with durations but no coverage is still a day with no data", () => {
    renderGraph({
      defaultBarColor: DEFAULT_COLOR,
      dayReadings: [readingFor(5, [offline(3600, 3)], 0)],
    });

    expect(barFor(5)).toHaveStyle({
      backgroundColor: NO_DATA_BAR_COLOR.toString(),
    });
    expect(barFor(5).getAttribute("aria-label")).toContain("no data");
  });

  test("the reading's downtime is taken over the seconds covered, not the whole day", () => {
    const { onBarClick } = renderGraph({
      defaultBarColor: DEFAULT_COLOR,
      dayReadings: [
        readingFor(5, [operational(32400, 1), offline(10800, 3)], 43200),
      ],
    });

    expect(openDay(onBarClick, 5).uptimePercent).toBe(75);
    expect(barFor(5).getAttribute("aria-label")).toContain("75% uptime");
  });

  test("durations that overrun the coverage read as a fully down day, never below 0%", () => {
    const { onBarClick } = renderGraph({
      defaultBarColor: DEFAULT_COLOR,
      dayReadings: [readingFor(5, [offline(7200, 3)], 3600)],
    });

    expect(openDay(onBarClick, 5).uptimePercent).toBe(0);
  });

  /*
   * This test used to be "a day with events is unchanged even when a reading
   * exists" and asserted the opposite precedence: any day with events of its
   * own was decided by them, and a reading only decided a day with none.
   *
   * That precedence is what kept status.chainflip.io's bars wrong. The events
   * arrive under a 10,000 row cap across the whole page, and "this day has
   * some events" does not mean it has all of them - the day the cap cuts
   * through keeps only its newest rows, and the pre-fix client sort could
   * leave a day holding events that ended before they began. The reading is
   * measured server-side from every row, so a reading with coverage (and
   * durations) now decides the day whatever events it has.
   *
   * Fails on the pre-fix strip: readingDecidesTheDay also required
   * `todaysEvents.length === 0`, so this bar stayed Red at 0% - exactly the
   * "without a reading" look recorded first below.
   */
  test("a reading with coverage decides the day even when the day has events", () => {
    const events: Array<UptimeEvent> = [
      makeEvent({
        startDate: hourOfDay(5, 1),
        endDate: hourOfDay(5, 23),
        isDown: true,
      }),
    ];

    interface BarLook {
      label: string | null;
      color: string;
    }

    const readBar: () => BarLook = (): BarLook => {
      return {
        label: barFor(5).getAttribute("aria-label"),
        color: barFor(5).style.backgroundColor,
      };
    };

    renderGraph({
      defaultBarColor: DEFAULT_COLOR,
      events: events,
      downtimeEventStatusIds: [DOWN_STATUS_ID],
    });

    // Without a reading the events are all there is, and they still decide.
    const withoutReading: BarLook = readBar();

    expect(barFor(5)).toHaveStyle({ backgroundColor: Red.toString() });
    expect(withoutReading.label).toContain("0% uptime");

    cleanup();

    /*
     * The reading disagrees with the events on purpose: it says the day was
     * spent entirely operational. The reading decides the day.
     */
    const readingDurations: Array<StatusDuration> = [operational(86400, 1)];

    const { onBarClick } = renderGraph({
      defaultBarColor: DEFAULT_COLOR,
      events: events,
      downtimeEventStatusIds: [DOWN_STATUS_ID],
      dayReadings: [readingFor(5, readingDurations)],
    });

    const withReading: BarLook = readBar();

    expect(withReading).not.toEqual(withoutReading);
    expect(barFor(5)).toHaveStyle({
      backgroundColor: OPERATIONAL_COLOR.toString(),
    });
    expect(withReading.label).toContain("100% uptime");

    const summary: UptimeBarDaySummary = openDay(onBarClick, 5);

    expect(summary.uptimePercent).toBe(100);
    expect(summary.hasEvents).toBe(true);
    expect(summary.statusDurations).toEqual(readingDurations);
  });

  test("events on one day do not stop another day being painted from its reading", () => {
    renderGraph({
      defaultBarColor: DEFAULT_COLOR,
      events: [
        makeEvent({
          startDate: hourOfDay(5, 1),
          endDate: hourOfDay(5, 23),
          isDown: false,
        }),
      ],
      downtimeEventStatusIds: [DOWN_STATUS_ID],
      dayReadings: [
        readingFor(5, [operational(86400, 1)]),
        readingFor(3, [operational(43200, 1), offline(43200, 3)]),
      ],
    });

    /*
     * The day with its own events is decided by its own reading too. This
     * line used to expect the event's colour (Green); now that a reading with
     * coverage decides its day whatever events it has (see the test above),
     * the bar takes the reading's highest-priority status colour instead.
     */
    expect(barFor(5)).toHaveStyle({
      backgroundColor: OPERATIONAL_COLOR.toString(),
    });
    expect(barFor(5)).not.toHaveStyle({ backgroundColor: Green.toString() });

    // The day that lost its rows is painted from the server's reading.
    expect(barFor(3)).toHaveStyle({
      backgroundColor: OFFLINE_COLOR.toString(),
    });
    expect(barFor(3).getAttribute("aria-label")).toContain("50% uptime");
  });
});

/*
 * status.chainflip.io, as it was reported: grey bars at the end of the strip.
 *
 * Three flapping monitors (lp, auctions, scan) drew today's bar in the page's
 * default colour, #5F5F5F, labelled "100% uptime" while the monitor had been
 * up all day, and every day older than about five days grey as well. The
 * page's configuration is reproduced exactly: a grey default colour, bar rules
 * of >= 97 green, >= 50 orange and >= 0 red (in that order, as the operator
 * ordered them), and Degraded and Offline counted as down.
 *
 * The rows the browser holds stop about five days back - a 10,000 row cap
 * across every monitor on the page, newest first - so in these fixtures:
 *
 *   - today has NO events: the pre-fix client sort (second granularity) put
 *     the open Operational row before the Offline row that started in the same
 *     second, so it ended before it began and nothing reached "now";
 *   - days 1-4 still have their rows;
 *   - day 5 is the day the cap cuts through: only its last four hours of rows
 *     survived, all Operational;
 *   - every older day is known only from the server's reading.
 *
 * "Now" is pinned so "today" is the same day whenever this runs. The bars are
 * the process's own local days (the strip's default) and the readings are cut
 * on those same days, so this block is about WHICH account of a day wins. The
 * other half of the live bug - readings cut on UTC days landing on the wrong
 * local bar - is in DayUptimeGraphTimezone.NewYork/Tokyo.test.tsx.
 */
describe("DayUptimeGraph - status.chainflip.io: grey bars at the end of the strip", () => {
  const CF_NOW: Date = new Date("2026-09-22T14:00:00.000Z");
  const CF_WINDOW_DAYS: number = 60;
  const CF_START: Date = OneUptimeDate.getSomeDaysAgoFromDate(
    CF_NOW,
    CF_WINDOW_DAYS,
  );

  // The window is inclusive of both ends: sixty days ago through today.
  const CF_BAR_COUNT: number = CF_WINDOW_DAYS + 1;

  const CF_DEFAULT_GREY: Color = new Color("#5F5F5F");
  const CF_RULE_GREEN: Color = new Color("#46DA93");
  const CF_RULE_ORANGE: Color = new Color("#EC9F0A");
  const CF_RULE_RED: Color = new Color("#F64848");

  const CF_RULES: Array<BarChartRule> = [
    { barColor: CF_RULE_GREEN, uptimePercentGreaterThanOrEqualTo: 97 },
    { barColor: CF_RULE_ORANGE, uptimePercentGreaterThanOrEqualTo: 50 },
    { barColor: CF_RULE_RED, uptimePercentGreaterThanOrEqualTo: 0 },
  ];

  const DEGRADED_STATUS_ID: ObjectID = new ObjectID(
    "33333333-3333-4333-8333-333333333333",
  );

  // The statuses' own colours, distinct from every rule colour above.
  const CF_OPERATIONAL_COLOR: Color = new Color("#1F9D55");
  const CF_DEGRADED_COLOR: Color = new Color("#E0A800");
  const CF_OFFLINE_COLOR: Color = new Color("#C0392B");

  // Coverage so far today, as the server reports it for the open day.
  const TODAY_COVERED_SECONDS: number = 36000;

  function cfOperational(seconds: number): StatusDuration {
    return {
      label: "Operational",
      seconds: seconds,
      color: CF_OPERATIONAL_COLOR,
      isDowntime: false,
      priority: 1,
    };
  }

  function cfDegraded(seconds: number): StatusDuration {
    return {
      label: "Degraded",
      seconds: seconds,
      color: CF_DEGRADED_COLOR,
      isDowntime: true,
      priority: 2,
    };
  }

  function cfOffline(seconds: number): StatusDuration {
    return {
      label: "Offline",
      seconds: seconds,
      color: CF_OFFLINE_COLOR,
      isDowntime: true,
      priority: 3,
    };
  }

  // Local midnight at the start of the day `daysAgo` before CF_NOW.
  function cfDayStart(daysAgo: number): Date {
    return OneUptimeDate.getStartOfDay(
      OneUptimeDate.getSomeDaysAgoFromDate(CF_NOW, daysAgo),
    );
  }

  function cfHour(daysAgo: number, hour: number): Date {
    return OneUptimeDate.addRemoveHours(cfDayStart(daysAgo), hour);
  }

  function cfReading(
    daysAgo: number,
    statusDurations: Array<StatusDuration>,
  ): DayReading {
    return {
      dayStart: cfDayStart(daysAgo),
      daySeconds: 86400,
      coveredSeconds: statusDurations.reduce(
        (sum: number, duration: StatusDuration) => {
          return sum + duration.seconds;
        },
        0,
      ),
      statusDurations: statusDurations,
    };
  }

  // A full day's reading with `uptimePercent` of it Operational, the rest Offline.
  function cfDayAt(daysAgo: number, uptimePercent: number): DayReading {
    const offlineSeconds: number = (86400 * (100 - uptimePercent)) / 100;

    return cfReading(daysAgo, [
      cfOperational(86400 - offlineSeconds),
      cfOffline(offlineSeconds),
    ]);
  }

  /*
   * The rows that survived the cap for day 5: its last four hours, all
   * Operational. Before the fix these decided the day at 100%.
   */
  function capCutDayEvents(): Array<UptimeEvent> {
    return [
      makeEvent({
        startDate: cfHour(5, 20),
        endDate: OneUptimeDate.getEndOfDay(cfDayStart(5)),
        isDown: false,
      }),
    ];
  }

  function cfBar(daysAgo: number): HTMLElement {
    return getBars()[CF_BAR_COUNT - 1 - daysAgo] as HTMLElement;
  }

  function cfLabel(daysAgo: number): string {
    return cfBar(daysAgo).getAttribute("aria-label") || "";
  }

  function renderChainflip(
    props: Partial<React.ComponentProps<typeof DayUptimeGraph>>,
  ): { onBarClick: OnBarClickMock } {
    return renderGraph({
      startDate: CF_START,
      endDate: CF_NOW,
      defaultBarColor: CF_DEFAULT_GREY,
      barColorRules: CF_RULES,
      downtimeEventStatusIds: [DEGRADED_STATUS_ID, DOWN_STATUS_ID],
      ...props,
    });
  }

  function openCfDay(
    onBarClick: OnBarClickMock,
    daysAgo: number,
  ): UptimeBarDaySummary {
    fireEvent.click(cfBar(daysAgo));

    const calls: Array<Parameters<OnBarClickFunction>> = onBarClick.mock.calls;

    return calls[calls.length - 1]?.[2] as UptimeBarDaySummary;
  }

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(CF_NOW);
  });

  afterEach(() => {
    cleanup();
    jest.useRealTimers();
  });

  test("the strip is sixty days plus today, ending on the pinned today", () => {
    renderChainflip({ events: [] });

    expect(getBars()).toHaveLength(CF_BAR_COUNT);
    expect(cfLabel(0)).toContain(
      OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(CF_NOW, true),
    );
  });

  /*
   * The headline symptom. On the live page the reading never reached today's
   * bar (it was cut on a UTC day and matched against a local one - the
   * timezone files fail on the pre-fix strip for exactly that) and today had
   * no events, so the bar was drawn from nothing. This pins the other half:
   * once today's reading reaches today's bar, it is what paints it - green by
   * the >= 97 rule, never the grey default and never "no data".
   */
  test("today: a fully Operational reading with no events is green at 100%, not the grey default", () => {
    const todaysDurations: Array<StatusDuration> = [
      cfOperational(TODAY_COVERED_SECONDS),
    ];

    const { onBarClick } = renderChainflip({
      events: [],
      dayReadings: [cfReading(0, todaysDurations)],
    });

    expect(cfBar(0)).toHaveStyle({
      backgroundColor: CF_RULE_GREEN.toString(),
    });
    expect(cfBar(0)).not.toHaveStyle({
      backgroundColor: CF_DEFAULT_GREY.toString(),
    });
    expect(cfLabel(0)).toContain("100% uptime");
    expect(cfLabel(0)).not.toContain("no data");

    const summary: UptimeBarDaySummary = openCfDay(onBarClick, 0);

    expect(summary.hasEvents).toBe(true);
    expect(summary.uptimePercent).toBe(100);
    expect(summary.statusDurations).toEqual(todaysDurations);
  });

  /*
   * What the pre-fix sort actually handed the strip for today: the open
   * Operational row, ended at the start of the Offline row that began in the
   * same second - 12:47:40.540 -> 12:47:40.326, negative length. The fixed
   * UptimeUtil drops such an event, but the strip must not let one decide the
   * day either.
   *
   * Fails on the pre-fix strip: today "had events", so they decided it; their
   * negative seconds summed to nothing, which reads as 100%, while the
   * server measured 97%.
   */
  test("today: an event that ends before it begins does not override today's reading", () => {
    const flipStart: Date = OneUptimeDate.addRemoveSeconds(
      cfHour(0, 12),
      47 * 60 + 40,
    );

    const strayEvent: UptimeEvent = makeEvent({
      startDate: new Date(flipStart.getTime() + 540),
      endDate: new Date(flipStart.getTime() + 326),
      isDown: false,
    });

    const { onBarClick } = renderChainflip({
      events: [strayEvent],
      dayReadings: [cfReading(0, [cfOperational(34920), cfOffline(1080)])],
    });

    expect(cfLabel(0)).toContain("97% uptime");
    expect(cfLabel(0)).not.toContain("100% uptime");
    expect(cfBar(0)).toHaveStyle({
      backgroundColor: CF_RULE_GREEN.toString(),
    });
    expect(openCfDay(onBarClick, 0).uptimePercent).toBeCloseTo(97, 6);
  });

  /*
   * A day older than the capped rows has nothing but its reading. The
   * pre-fix strip already let a reading decide a day with no events at all,
   * so on its own this passes before the fix too; what turned these bars grey
   * on the live page was the reading landing on the wrong bar (see the
   * timezone files). It is here to pin the rule mapping on the page's own
   * configuration, from every band of it.
   */
  test("a day older than the capped rows is painted by rule from its reading and labelled with the reading's percentage", () => {
    const { onBarClick } = renderChainflip({
      events: [],
      dayReadings: [cfDayAt(40, 25), cfDayAt(30, 99), cfDayAt(20, 60)],
    });

    // 1% downtime: 99%, the >= 97 rule.
    expect(cfBar(30)).toHaveStyle({
      backgroundColor: CF_RULE_GREEN.toString(),
    });
    expect(cfLabel(30)).toContain("99% uptime");
    expect(openCfDay(onBarClick, 30).uptimePercent).toBeCloseTo(99, 6);

    // 60%: the >= 50 rule.
    expect(cfBar(20)).toHaveStyle({
      backgroundColor: CF_RULE_ORANGE.toString(),
    });
    expect(cfLabel(20)).toContain("60% uptime");

    // 25%: the >= 0 rule.
    expect(cfBar(40)).toHaveStyle({
      backgroundColor: CF_RULE_RED.toString(),
    });
    expect(cfLabel(40)).toContain("25% uptime");

    // None of them is the grey default.
    for (const daysAgo of [20, 30, 40]) {
      expect(cfBar(daysAgo)).not.toHaveStyle({
        backgroundColor: CF_DEFAULT_GREY.toString(),
      });
    }
  });

  /*
   * The day the cap cuts through: its last four hours of rows survived, all
   * Operational, while the server measured 3% of the day Offline.
   *
   * Fails on the pre-fix strip: the day had events, so the four surviving
   * hours decided it at "100% uptime". The colour does not tell the two
   * apart here (97 and 100 both clear the >= 97 rule); the label and the
   * summary do. The next test makes the colour differ too.
   */
  test("the day the cap cuts through: the reading's 97% decides, not the 100% of the rows that survived", () => {
    const readingDurations: Array<StatusDuration> = [
      cfOperational(83808),
      cfOffline(2592),
    ];

    const { onBarClick } = renderChainflip({
      events: capCutDayEvents(),
      dayReadings: [cfReading(5, readingDurations)],
    });

    expect(cfLabel(5)).toContain("97% uptime");
    expect(cfLabel(5)).not.toContain("100% uptime");
    expect(cfBar(5)).toHaveStyle({
      backgroundColor: CF_RULE_GREEN.toString(),
    });

    const summary: UptimeBarDaySummary = openCfDay(onBarClick, 5);

    expect(summary.uptimePercent).toBeCloseTo(97, 6);
    expect(summary.hasEvents).toBe(true);
    expect(summary.statusDurations).toEqual(readingDurations);
  });

  /*
   * Fails on the pre-fix strip: the four Operational hours painted the day
   * green at 100%, hiding a day the server measured at 90%.
   */
  test("the day the cap cuts through takes the rule colour of its reading, even when the rows say otherwise", () => {
    renderChainflip({
      events: capCutDayEvents(),
      dayReadings: [cfDayAt(5, 90)],
    });

    expect(cfBar(5)).toHaveStyle({
      backgroundColor: CF_RULE_ORANGE.toString(),
    });
    expect(cfLabel(5)).toContain("90% uptime");
  });

  /*
   * With no bar rules, a day painted from its reading takes the colour of
   * the reading's highest-priority status - here Offline, over Degraded and
   * Operational.
   *
   * Fails on the pre-fix strip for day 5: its surviving Operational rows
   * decided the day, so it took the Operational EVENT's colour (Green).
   */
  test("without bar rules, the colour is the reading's highest-priority status", () => {
    renderChainflip({
      barColorRules: [],
      events: capCutDayEvents(),
      dayReadings: [
        cfReading(5, [cfOperational(83808), cfDegraded(1296), cfOffline(1296)]),
        cfReading(0, [cfOperational(TODAY_COVERED_SECONDS)]),
      ],
    });

    expect(cfBar(5)).toHaveStyle({
      backgroundColor: CF_OFFLINE_COLOR.toString(),
    });
    expect(cfBar(5)).not.toHaveStyle({ backgroundColor: Green.toString() });
    expect(cfLabel(5)).toContain("97% uptime");

    // Today spent all its time Operational, so it takes that status's colour.
    expect(cfBar(0)).toHaveStyle({
      backgroundColor: CF_OPERATIONAL_COLOR.toString(),
    });
    expect(cfBar(0)).not.toHaveStyle({
      backgroundColor: CF_DEFAULT_GREY.toString(),
    });
  });

  /*
   * The page as a visitor saw it, all sixty-one bars at once: rows for
   * yesterday back to the cap, the cap cutting through day 5, readings only
   * beyond it, and nothing for today but its reading.
   *
   * Fails on the pre-fix strip at day 5, which read "100% uptime" from its
   * four surviving hours instead of the 97% the server measured.
   */
  test("the whole strip: no bar is grey or 'no data', and every bar reads its own day's reading", () => {
    const expectedPercent: Map<number, number> = new Map<number, number>();
    const readings: Array<DayReading> = [];

    for (let daysAgo: number = CF_WINDOW_DAYS; daysAgo >= 1; daysAgo--) {
      let percent: number = 99;

      if (daysAgo <= 4) {
        percent = 100;
      } else if (daysAgo === 5) {
        percent = 97;
      } else if (daysAgo === 12) {
        percent = 60;
      } else if (daysAgo === 33) {
        percent = 20;
      }

      expectedPercent.set(daysAgo, percent);
      readings.push(cfDayAt(daysAgo, percent));
    }

    expectedPercent.set(0, 100);
    readings.push(cfReading(0, [cfOperational(TODAY_COVERED_SECONDS)]));

    /*
     * One Operational row from 20:00 on day 5 until midnight this morning: the
     * newest rows that survived the cap, minus today's, which the pre-fix
     * sort lost.
     */
    const survivingRows: Array<UptimeEvent> = [
      makeEvent({
        startDate: cfHour(5, 20),
        endDate: cfDayStart(0),
        isDown: false,
      }),
    ];

    renderChainflip({ events: survivingRows, dayReadings: readings });

    expect(getBars()).toHaveLength(CF_BAR_COUNT);

    for (let daysAgo: number = 0; daysAgo <= CF_WINDOW_DAYS; daysAgo++) {
      const percent: number = expectedPercent.get(daysAgo) as number;
      const ruleColor: Color =
        percent >= 97
          ? CF_RULE_GREEN
          : percent >= 50
            ? CF_RULE_ORANGE
            : CF_RULE_RED;

      expect(cfLabel(daysAgo)).toContain(`: ${percent}% uptime`);
      expect(cfBar(daysAgo)).toHaveStyle({
        backgroundColor: ruleColor.toString(),
      });
      expect(cfBar(daysAgo)).not.toHaveStyle({
        backgroundColor: CF_DEFAULT_GREY.toString(),
      });
      expect(cfBar(daysAgo)).not.toHaveStyle({
        backgroundColor: NO_DATA_BAR_COLOR.toString(),
      });
    }
  });
});
