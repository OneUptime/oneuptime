import DayUptimeGraphUtil from "../../../Utils/Uptime/DayUptimeGraphUtil";
import UptimeHistoryLabels, {
  DefaultUptimeHistoryLabels,
} from "../../../Types/Monitor/UptimeHistoryLabels";
import { describe, expect, test } from "@jest/globals";

/*
 * Contract under test - the day-by-day uptime strip has to be operable
 * without a mouse and describable to a screen reader.
 *
 * The strip is ninety bars per resource. Two consequences drive everything
 * here: it can only be one tab stop (so movement inside it is arrow keys over
 * a roving tabindex, which is the maths below), and every bar needs a name a
 * screen reader can read out (which is the wording below). Both are pure so
 * they can be pinned down exactly rather than inferred from a rendered DOM.
 */

const SPANISH_LABELS: UptimeHistoryLabels = {
  ...DefaultUptimeHistoryLabels,
  graphLabel: "Historial de {{total}} dias",
  dayLabel: "{{date}}: {{uptime}} por ciento",
  dayLabelWithIncidents: "{{date}}: {{uptime}} por ciento, {{total}} sucesos",
  dayLabelNoData: "{{date}}: sin datos",
  dayLabelNoDataWithIncidents: "{{date}}: sin datos, {{total}} sucesos",
};

describe("DayUptimeGraphUtil.getNextFocusIndex", () => {
  test("ArrowRight and ArrowDown both move forward one day", () => {
    for (const key of ["ArrowRight", "ArrowDown"]) {
      expect(
        DayUptimeGraphUtil.getNextFocusIndex({
          key: key,
          currentIndex: 10,
          barCount: 90,
        }),
      ).toBe(11);
    }
  });

  test("ArrowLeft and ArrowUp both move back one day", () => {
    for (const key of ["ArrowLeft", "ArrowUp"]) {
      expect(
        DayUptimeGraphUtil.getNextFocusIndex({
          key: key,
          currentIndex: 10,
          barCount: 90,
        }),
      ).toBe(9);
    }
  });

  test("Home goes to the oldest day and End to today", () => {
    expect(
      DayUptimeGraphUtil.getNextFocusIndex({
        key: "Home",
        currentIndex: 45,
        barCount: 90,
      }),
    ).toBe(0);

    expect(
      DayUptimeGraphUtil.getNextFocusIndex({
        key: "End",
        currentIndex: 45,
        barCount: 90,
      }),
    ).toBe(89);
  });

  test("PageDown and PageUp move a week at a time", () => {
    expect(DayUptimeGraphUtil.PageJumpInDays).toBe(7);

    expect(
      DayUptimeGraphUtil.getNextFocusIndex({
        key: "PageDown",
        currentIndex: 40,
        barCount: 90,
      }),
    ).toBe(47);

    expect(
      DayUptimeGraphUtil.getNextFocusIndex({
        key: "PageUp",
        currentIndex: 40,
        barCount: 90,
      }),
    ).toBe(33);
  });

  /*
   * Wrapping a ninety day history would jump from today to three months ago
   * on one key press, which reads as a glitch rather than as navigation.
   */
  test("movement clamps at both ends rather than wrapping", () => {
    expect(
      DayUptimeGraphUtil.getNextFocusIndex({
        key: "ArrowLeft",
        currentIndex: 0,
        barCount: 90,
      }),
    ).toBe(0);

    expect(
      DayUptimeGraphUtil.getNextFocusIndex({
        key: "ArrowRight",
        currentIndex: 89,
        barCount: 90,
      }),
    ).toBe(89);

    expect(
      DayUptimeGraphUtil.getNextFocusIndex({
        key: "PageUp",
        currentIndex: 3,
        barCount: 90,
      }),
    ).toBe(0);

    expect(
      DayUptimeGraphUtil.getNextFocusIndex({
        key: "PageDown",
        currentIndex: 87,
        barCount: 90,
      }),
    ).toBe(89);
  });

  /*
   * The widget must not swallow the keys the browser owns. Returning null is
   * what tells the component to leave the event alone, so Tab still leaves
   * the strip and Enter and Space still activate the focused bar.
   */
  test("keys the strip does not own are handed back", () => {
    for (const key of [
      "Tab",
      "Enter",
      " ",
      "Escape",
      "a",
      "ArrowRightArrow",
      "",
    ]) {
      expect(
        DayUptimeGraphUtil.getNextFocusIndex({
          key: key,
          currentIndex: 10,
          barCount: 90,
        }),
      ).toBeNull();
    }
  });

  test("an empty strip has nowhere to move", () => {
    expect(
      DayUptimeGraphUtil.getNextFocusIndex({
        key: "ArrowRight",
        currentIndex: 0,
        barCount: 0,
      }),
    ).toBeNull();

    expect(
      DayUptimeGraphUtil.getNextFocusIndex({
        key: "Home",
        currentIndex: 0,
        barCount: -3,
      }),
    ).toBeNull();
  });

  /*
   * The window can shrink under a stored index - a status page whose owner
   * lowers showUptimeHistoryInDays from 90 to 30 between renders. Movement
   * must still land somewhere real.
   */
  test("an index left over from a longer window still moves sanely", () => {
    expect(
      DayUptimeGraphUtil.getNextFocusIndex({
        key: "ArrowRight",
        currentIndex: 500,
        barCount: 30,
      }),
    ).toBe(29);

    expect(
      DayUptimeGraphUtil.getNextFocusIndex({
        key: "ArrowLeft",
        currentIndex: 500,
        barCount: 30,
      }),
    ).toBe(28);

    expect(
      DayUptimeGraphUtil.getNextFocusIndex({
        key: "ArrowLeft",
        currentIndex: -8,
        barCount: 30,
      }),
    ).toBe(0);
  });

  test("a one day strip cannot move off itself", () => {
    for (const key of ["ArrowLeft", "ArrowRight", "Home", "End", "PageUp"]) {
      expect(
        DayUptimeGraphUtil.getNextFocusIndex({
          key: key,
          currentIndex: 0,
          barCount: 1,
        }),
      ).toBe(0);
    }
  });
});

describe("DayUptimeGraphUtil.getActiveBarIndex", () => {
  /*
   * Today, not three months ago: the bar a visitor wants first is the one on
   * the right hand end.
   */
  test("focus lands on today before anything has been focused", () => {
    expect(
      DayUptimeGraphUtil.getActiveBarIndex({
        storedIndex: null,
        barCount: 90,
      }),
    ).toBe(89);
  });

  test("a stored index is used as it stands", () => {
    expect(
      DayUptimeGraphUtil.getActiveBarIndex({ storedIndex: 12, barCount: 90 }),
    ).toBe(12);
  });

  test("a stored index outside the window is pulled back into it", () => {
    expect(
      DayUptimeGraphUtil.getActiveBarIndex({ storedIndex: 400, barCount: 30 }),
    ).toBe(29);

    expect(
      DayUptimeGraphUtil.getActiveBarIndex({ storedIndex: -5, barCount: 30 }),
    ).toBe(0);
  });

  test("an empty strip reports index zero rather than minus one", () => {
    expect(
      DayUptimeGraphUtil.getActiveBarIndex({ storedIndex: null, barCount: 0 }),
    ).toBe(0);
  });
});

describe("DayUptimeGraphUtil.getBarTabIndex", () => {
  /*
   * The whole point of the roving tabindex: exactly one bar per strip is
   * reachable with Tab, so twenty resources cost twenty tab stops rather than
   * eighteen hundred.
   */
  test("exactly one bar in a strip is tabbable", () => {
    const barCount: number = 90;
    const activeIndex: number = 42;

    let tabbable: number = 0;

    for (let index: number = 0; index < barCount; index++) {
      const tabIndex: number = DayUptimeGraphUtil.getBarTabIndex({
        index: index,
        activeIndex: activeIndex,
      });

      expect(tabIndex === 0 || tabIndex === -1).toBe(true);

      if (tabIndex === 0) {
        tabbable++;
      }
    }

    expect(tabbable).toBe(1);
    expect(
      DayUptimeGraphUtil.getBarTabIndex({ index: 42, activeIndex: 42 }),
    ).toBe(0);
  });
});

describe("DayUptimeGraphUtil.formatUptimePercentForLabel", () => {
  test("a whole number reads as a whole number", () => {
    expect(DayUptimeGraphUtil.formatUptimePercentForLabel(100)).toBe("100");
    expect(DayUptimeGraphUtil.formatUptimePercentForLabel(99)).toBe("99");
    expect(DayUptimeGraphUtil.formatUptimePercentForLabel(0)).toBe("0");
  });

  test("trailing zeroes are dropped", () => {
    expect(DayUptimeGraphUtil.formatUptimePercentForLabel(99.5)).toBe("99.5");
    expect(DayUptimeGraphUtil.formatUptimePercentForLabel(99.5)).not.toBe(
      "99.50",
    );
    expect(DayUptimeGraphUtil.formatUptimePercentForLabel(99.123)).toBe(
      "99.12",
    );
  });

  /*
   * A day that had an outage must never be read out as "100% uptime". Saying
   * so on a status page is a wrong statement, not a rounding.
   */
  test("a hair under a hundred never rounds up to a hundred", () => {
    expect(DayUptimeGraphUtil.formatUptimePercentForLabel(99.999)).toBe(
      "99.99",
    );
    expect(DayUptimeGraphUtil.formatUptimePercentForLabel(99.99999)).toBe(
      "99.99",
    );
  });

  test("impossible readings are clamped rather than repeated", () => {
    expect(DayUptimeGraphUtil.formatUptimePercentForLabel(140)).toBe("100");
    expect(DayUptimeGraphUtil.formatUptimePercentForLabel(-20)).toBe("0");
    expect(DayUptimeGraphUtil.formatUptimePercentForLabel(NaN)).toBe("0");
    expect(DayUptimeGraphUtil.formatUptimePercentForLabel(Infinity)).toBe("0");
  });
});

describe("DayUptimeGraphUtil.getDayAriaLabel", () => {
  test("a clean day names the date and the reading", () => {
    expect(
      DayUptimeGraphUtil.getDayAriaLabel({
        dateLabel: "Mar 03 2026",
        hasEvents: true,
        uptimePercent: 100,
        incidentCount: 0,
      }),
    ).toBe("Mar 03 2026: 100% uptime");
  });

  test("a day with incidents says how many", () => {
    expect(
      DayUptimeGraphUtil.getDayAriaLabel({
        dateLabel: "Mar 03 2026",
        hasEvents: true,
        uptimePercent: 98.25,
        incidentCount: 2,
      }),
    ).toBe("Mar 03 2026: 98.25% uptime, 2 incidents");
  });

  /*
   * A day before the monitor existed is not a day of downtime, and the label
   * must not imply it was.
   */
  test("a day with no timeline rows says no data, not zero percent", () => {
    const label: string = DayUptimeGraphUtil.getDayAriaLabel({
      dateLabel: "Jan 01 2026",
      hasEvents: false,
      uptimePercent: 100,
      incidentCount: 0,
    });

    expect(label).toBe("Jan 01 2026: no data");
    expect(label).not.toContain("%");
  });

  test("a day with no data but with incidents still reports them", () => {
    expect(
      DayUptimeGraphUtil.getDayAriaLabel({
        dateLabel: "Jan 01 2026",
        hasEvents: false,
        uptimePercent: 0,
        incidentCount: 3,
      }),
    ).toBe("Jan 01 2026: no data, 3 incidents");
  });

  test("a negative incident count is treated as none", () => {
    expect(
      DayUptimeGraphUtil.getDayAriaLabel({
        dateLabel: "Mar 03 2026",
        hasEvents: true,
        uptimePercent: 100,
        incidentCount: -4,
      }),
    ).toBe("Mar 03 2026: 100% uptime");
  });

  test("the caller's own wording is used when it passes some", () => {
    expect(
      DayUptimeGraphUtil.getDayAriaLabel({
        dateLabel: "3 mar 2026",
        hasEvents: true,
        uptimePercent: 99.9,
        incidentCount: 1,
        labels: SPANISH_LABELS,
      }),
    ).toBe("3 mar 2026: 99.9 por ciento, 1 sucesos");

    expect(
      DayUptimeGraphUtil.getDayAriaLabel({
        dateLabel: "3 mar 2026",
        hasEvents: false,
        uptimePercent: 0,
        incidentCount: 0,
        labels: SPANISH_LABELS,
      }),
    ).toBe("3 mar 2026: sin datos");
  });

  /*
   * A half translated locale must degrade to an odd label, never to a page
   * that fails to render.
   */
  test("a translation missing its placeholders still produces a label", () => {
    const label: string = DayUptimeGraphUtil.getDayAriaLabel({
      dateLabel: "Mar 03 2026",
      hasEvents: true,
      uptimePercent: 100,
      incidentCount: 0,
      labels: {
        ...DefaultUptimeHistoryLabels,
        dayLabel: "Disponibilidad del dia",
      },
    });

    expect(label).toBe("Disponibilidad del dia");
  });

  test("a placeholder used twice is filled in both places", () => {
    expect(
      DayUptimeGraphUtil.getDayAriaLabel({
        dateLabel: "Mar 03 2026",
        hasEvents: true,
        uptimePercent: 50,
        incidentCount: 0,
        labels: {
          ...DefaultUptimeHistoryLabels,
          dayLabel: "{{date}} - {{date}}",
        },
      }),
    ).toBe("Mar 03 2026 - Mar 03 2026");
  });
});

describe("DayUptimeGraphUtil.getGraphAriaLabel", () => {
  test("the strip names the window it covers", () => {
    expect(DayUptimeGraphUtil.getGraphAriaLabel({ dayCount: 90 })).toBe(
      "Uptime history for the last 90 days",
    );
  });

  test("the caller's own wording is used when it passes some", () => {
    expect(
      DayUptimeGraphUtil.getGraphAriaLabel({
        dayCount: 30,
        labels: SPANISH_LABELS,
      }),
    ).toBe("Historial de 30 dias");
  });

  test("a strip with nothing in it does not claim a negative window", () => {
    expect(DayUptimeGraphUtil.getGraphAriaLabel({ dayCount: -5 })).toBe(
      "Uptime history for the last 0 days",
    );
  });
});
