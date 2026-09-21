import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import React from "react";
import { describe, expect, jest, test } from "@jest/globals";
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
 * entirely offline read as a perfect one. On a day with no events the reading
 * now decides the percentage and the colour. A day that still has events keeps
 * the event-derived reading, so a status page only changes on the days it was
 * painting wrongly.
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

  test("a day with events is unchanged even when a reading exists", () => {
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

    const withoutReading: BarLook = readBar();

    cleanup();

    /*
     * The reading disagrees with the events on purpose: it says the day was
     * spent entirely operational. The events still decide the day.
     */
    const { onBarClick } = renderGraph({
      defaultBarColor: DEFAULT_COLOR,
      events: events,
      downtimeEventStatusIds: [DOWN_STATUS_ID],
      dayReadings: [readingFor(5, [operational(86400, 1)])],
    });

    const withReading: BarLook = readBar();

    expect(withReading).toEqual(withoutReading);
    expect(barFor(5)).toHaveStyle({ backgroundColor: Red.toString() });
    expect(withReading.label).toContain("0% uptime");
    expect(openDay(onBarClick, 5).uptimePercent).toBe(0);
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

    // The day with its own events keeps the event colour.
    expect(barFor(5)).toHaveStyle({ backgroundColor: Green.toString() });

    // The day that lost its rows is painted from the server's reading.
    expect(barFor(3)).toHaveStyle({
      backgroundColor: OFFLINE_COLOR.toString(),
    });
    expect(barFor(3).getAttribute("aria-label")).toContain("50% uptime");
  });
});
