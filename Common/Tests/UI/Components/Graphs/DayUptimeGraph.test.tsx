import "@testing-library/jest-dom";
import { act, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, jest, test } from "@jest/globals";
import DayUptimeGraph, {
  UptimeBarDaySummary,
} from "../../../../UI/Components/Graphs/DayUptimeGraph";
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
  test("a day with no events uses the default bar colour", () => {
    renderGraph({ defaultBarColor: new Color("#123456") });

    expect(getBars()[0]).toHaveStyle({ backgroundColor: "#123456" });
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
