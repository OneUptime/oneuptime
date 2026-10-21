/** @timezone UTC */

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
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import StatusTimeline, {
  StatusTimelineDisplayEntry,
} from "../../../../UI/Components/StatusTimeline/StatusTimeline";
import StatusTimelineWindowControls from "../../../../UI/Components/StatusTimeline/StatusTimelineWindowControls";
import { StatusTimelineWindow } from "../../../../UI/Components/StatusTimeline/StatusTimelineLayout";
import OneUptimeDate from "../../../../Types/Date";
import Timezone from "../../../../Types/Timezone";
import { DarkModeScan, scanDarkMode } from "../../../Helpers/DarkModeScan";
import {
  AA_TEXT_CONTRAST,
  contrastOf,
  PAGE_TEXT_CLASS,
  WrittenWords,
  wordsIn,
} from "../../../Helpers/TailwindContrast";
import TimeRange from "../../../../Types/Time/TimeRange";

/*
 * The status timeline in both themes.
 *
 * The dark theme does not use dark: variants: Theme.css re-colours the
 * light utility classes under html.dark, one rule per class and variant,
 * and a class without a rule keeps its light colour - a white chip on a
 * slate card - without anything failing (Tests/Helpers/DarkModeScan). So
 * every colour class the timeline draws with is held to what Theme.css
 * remaps. The statuses' own colours are drawn as they are in both themes,
 * as a status bubble is: they are the project's, and they mean the same
 * thing on either ground.
 *
 * And in the light theme, every word it writes is read on what is behind it
 * (Tests/Helpers/TailwindContrast): WCAG AA, 4.5:1, for the legend, the
 * axis, the list, its day headings and its "since", the gap's "not loaded"
 * and the period controls. The browser suite (E2E/StatusTimeline) measures
 * the dark theme as it is drawn.
 */

const FILES: Array<string> = [
  "Components/StatusTimeline/StatusTimeline.tsx",
  "Components/StatusTimeline/StatusTimelineBand.tsx",
  "Components/StatusTimeline/StatusTimelineEntries.tsx",
  "Components/StatusTimeline/StatusTimelineLegend.tsx",
  "Components/StatusTimeline/StatusTimelineView.tsx",
  "Components/StatusTimeline/StatusTimelineWindowControls.tsx",
  "Components/StatusTimeline/ModelStatusTimeline.tsx",
];

describe("the status timeline in the dark theme", () => {
  const scan: DarkModeScan = scanDarkMode({ files: FILES });

  test("no part uses a dark: variant or builds a colour class from a template", () => {
    expect(scan.filesUsingDarkVariant).toEqual([]);
    expect(scan.filesWithTemplatedColour).toEqual([]);
  });

  test("every colour class it draws with is remapped for the dark theme", () => {
    // The scan found the timeline's colours at all, so this is not vacuous.
    expect(scan.colorTokens).toEqual(
      expect.arrayContaining([
        // The card's words: names, times, the legend's shares.
        "text-gray-900",
        "text-gray-700",
        "text-gray-600",
        "text-gray-500",
        // The band's ground, the list's rail, the skeleton.
        "bg-gray-100",
        "bg-gray-200",
        // The entry chosen on the band, and its dot's ring.
        "bg-indigo-50",
        "ring-indigo-50",
        "ring-white",
        // The period controls.
        "border-gray-200",
        "bg-white",
        "hover:bg-gray-50",
        "hover:text-gray-900",
        // View cause, Load, the focus ring.
        "text-indigo-600",
        "hover:text-indigo-800",
        "focus-visible:ring-indigo-500",
      ]),
    );

    expect(scan.unmapped).toEqual([]);
  });
});

const SECOND: number = 1000;
const MINUTE: number = 60 * SECOND;
const HOUR: number = 60 * MINUTE;
const DAY: number = 24 * HOUR;

const NOW: Date = new Date("2026-10-14T08:36:00.000Z");

const at: (offsetMs: number) => Date = (offsetMs: number): Date => {
  return new Date(NOW.getTime() + offsetMs);
};

const WINDOW: StatusTimelineWindow = { start: at(-30 * DAY), end: NOW };

const ENTRIES: Array<StatusTimelineDisplayEntry> = [
  {
    id: "up-now",
    statusKey: "operational",
    name: "Operational",
    color: "#10b981",
    startsAt: at(-5 * DAY + 38 * SECOND),
    endsAt: null,
    rank: 1,
    changedBy: "Ada Lovelace",
  },
  {
    id: "down",
    statusKey: "offline",
    name: "Offline",
    color: "#ef4444",
    startsAt: at(-5 * DAY),
    endsAt: at(-5 * DAY + 38 * SECOND),
    rank: 3,
  },
  {
    id: "up-before",
    statusKey: "operational",
    name: "Operational",
    color: "#10b981",
    startsAt: at(-12 * DAY),
    endsAt: at(-5 * DAY),
    rank: 1,
  },
];

/*
 * Everything the timeline writes at once: the legend, the band and its
 * axis, a stretch whose rows are not loaded (with Load), the list with an
 * entry chosen on the band, its "View cause" and the period controls.
 */
const renderTimeline: () => HTMLElement = (): HTMLElement => {
  const { container } = render(
    <div className="bg-white">
      <StatusTimeline
        entries={ENTRIES}
        window={WINDOW}
        emptyMessage="No status recorded yet."
        ariaLabel="Status timeline of this monitor"
        now={NOW}
        isWindowed={true}
        showShare={true}
        loadedFrom={at(-12 * DAY)}
        hiddenOlderCount={40}
        onLoadOlder={() => {}}
        onZoom={() => {}}
        onShowEarlier={() => {}}
        toolbar={
          <StatusTimelineWindowControls
            range={{ range: TimeRange.PAST_ONE_MONTH }}
            onRangeChange={() => {}}
            onEarlier={() => {}}
            onLater={() => {}}
            canGoLater={false}
            isZoomed={true}
            onResetZoom={() => {}}
            dataTestIdPrefix="monitor-status-timeline"
          />
        }
        renderEntryInlineAction={(): ReactElement => {
          return (
            <button
              type="button"
              className="text-sm font-medium text-indigo-600 hover:text-indigo-800"
            >
              View cause
            </button>
          );
        }}
      />
    </div>,
  );

  return container;
};

beforeEach(() => {
  jest.useFakeTimers({ now: NOW });
  OneUptimeDate.setUserTimezone("UTC" as Timezone);
  jest
    .spyOn(OneUptimeDate, "getUserPrefers12HourFormat")
    .mockReturnValue(false);
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
  jest.restoreAllMocks();
  OneUptimeDate.setUserTimezone(null);
});

const unreadable: (words: Array<WrittenWords>) => Array<WrittenWords> = (
  words: Array<WrittenWords>,
): Array<WrittenWords> => {
  return words.filter((word: WrittenWords): boolean => {
    return word.contrast < AA_TEXT_CONTRAST;
  });
};

describe("every word the timeline writes can be read", () => {
  test("at WCAG AA, on what is behind it", () => {
    const container: HTMLElement = renderTimeline();

    const words: Array<WrittenWords> = wordsIn(container, PAGE_TEXT_CLASS);

    // It found the parts it is about, so this is not vacuous.
    const written: string = words
      .map((word: WrittenWords): string => {
        return word.words;
      })
      .join(" | ");

    expect(written).toContain("Operational");
    expect(written).toContain("Offline");
    expect(written).toContain("Past 1 Month");
    expect(written).toContain("40 older changes not loaded");
    expect(written).toContain("Load");
    expect(written).toContain("View cause");
    expect(written).toContain("by Ada Lovelace");
    expect(written).toContain("Reset zoom");

    expect(unreadable(words)).toEqual([]);
  });

  /*
   * The axis is drawn for the eye - a screen reader hears the band's own
   * summary instead - so wordsIn passes it over; its dates are still read
   * by everyone who looks at the band.
   */
  test("the axis's dates, and Now", () => {
    renderTimeline();

    const labels: Array<Element> = Array.from(
      screen.getByTestId("status-timeline-axis").querySelectorAll("*"),
    ).filter((element: Element): boolean => {
      return (
        element.children.length === 0 &&
        (element.textContent || "").trim().length > 0
      );
    });

    expect(
      labels.map((element: Element): string => {
        return (element.textContent || "").trim();
      }),
    ).toEqual(expect.arrayContaining(["Now"]));
    expect(labels.length).toBeGreaterThan(2);

    for (const label of labels) {
      expect({
        words: label.textContent,
        isReadable: contrastOf(label) >= AA_TEXT_CONTRAST,
      }).toEqual({ words: label.textContent, isReadable: true });
    }
  });

  test("with an entry chosen on the band, on its tinted row too", () => {
    const container: HTMLElement = renderTimeline();
    const segment: HTMLElement = screen
      .getAllByTestId("status-timeline-segment")
      .find((element: HTMLElement): boolean => {
        return element.getAttribute("data-entry-ids") === "up-before";
      })!;

    act(() => {
      fireEvent.click(segment, { detail: 1 });
    });

    const chosen: HTMLElement = screen
      .getAllByTestId("status-timeline-entry")
      .find((element: HTMLElement): boolean => {
        return element.getAttribute("data-entry-id") === "up-before";
      })!;

    expect(chosen).toHaveAttribute("data-selected", "true");
    expect(unreadable(wordsIn(chosen, PAGE_TEXT_CLASS))).toEqual([]);
    expect(unreadable(wordsIn(container, PAGE_TEXT_CLASS))).toEqual([]);
  });

  test("an empty history, and a period with nothing in it", () => {
    const { container } = render(
      <div className="bg-white">
        <StatusTimeline
          entries={[]}
          window={WINDOW}
          emptyMessage="No status recorded for this monitor yet."
          ariaLabel="Status timeline of this monitor"
          now={NOW}
        />
      </div>,
    );

    expect(screen.getByTestId("status-timeline-empty")).toBeInTheDocument();
    expect(unreadable(wordsIn(container, PAGE_TEXT_CLASS))).toEqual([]);
  });
});
