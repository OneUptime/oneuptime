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
  within,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The events of a page, drawn as a timeline (NetworkEventsTimeline).
 *
 * What a device reported is read to work out what happened in what order.
 * The list used to say "12 minutes ago", "an hour ago", "a day ago" on
 * every row - in English whatever the reader's language, and with the real
 * time only in a tooltip. So it is laid out the way the product's activity
 * feeds are: a heading for each day with its full date and the zone the
 * times are in, each event's real time of day in the reader's zone and
 * language, and "12 min. ago" only under the time of an event from the last
 * hour.
 *
 * These render the timeline on its own: the days, the times, and a row's
 * parts at each width. What the page around it does - reading the events,
 * the filters, opening one - is in NetworkEventsView.test.tsx.
 *
 * The clock is fixed at 3:40 PM on Tuesday, October 13, 2026 in Singapore.
 */

const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const DEVICE_ID: string = "11111111-1111-4111-8111-111111111111";
const NOW: Date = new Date("2026-10-13T07:40:00.000Z");

// Intl writes "3:25 PM" with a narrow no-break space: read as a plain one.
const NARROW_SPACES: RegExp = /[\u202f\u00a0]/g;

// How far the list reaches past the card's padding on each side: "-mx-2".
const LIST_REACH: RegExp = /^-mx-(\d+(?:\.\d+)?)$/;

// The reader's language, as the translation hook reports it.
let mockLanguage: string = "en";

jest.mock("../../../UI/Utils/Translation", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        translateString: (value: string | undefined): string | undefined => {
          return value;
        },
        translateValue: (value: unknown): unknown => {
          return value;
        },
        language: mockLanguage,
      };
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): unknown => {
        const { default: ObjectIDType } = jest.requireActual(
          "../../../Types/ObjectID",
        ) as { default: new (id: string) => unknown };
        return new ObjectIDType("10000000-0000-4000-8000-000000000001");
      },
    },
  };
});

import NetworkEventsTimeline, {
  KIND_DOT_CLASS_NAMES,
  getDeviceEventsRoute,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkEvents/NetworkEventsTimeline";
import {
  NetworkEventRow,
  toNetworkEventRows,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkEvents/NetworkEventsModel";
import OneUptimeDate from "../../../Types/Date";
import { NetworkEventKind } from "../../../Types/NetworkEvent/NetworkEventType";
import Timezone from "../../../Types/Timezone";

// --- what the devices reported

const LINK_DOWN: Record<string, string> = {
  "event.domain": "network",
  "event.name": "interface.down",
  "event.kind": "problem",
  "event.category": "interface",
  "event.device": "Core Switch",
  "event.message": "Interface GigabitEthernet0/1, changed state to down",
  "network.interface.name": "GigabitEthernet0/1",
  "networkDevice.id": DEVICE_ID,
  "networkDevice.name": "Core Switch",
  "syslog.vendor": "Cisco",
  "syslog.sourceIp": "10.0.0.2",
};

const LINK_UP: Record<string, string> = {
  ...LINK_DOWN,
  "event.name": "interface.up",
  "event.kind": "recovery",
  "event.message": "Interface GigabitEthernet0/1, changed state to up",
};

// From an address that is not a device yet.
const STRANGER_REBOOT: Record<string, string> = {
  "event.domain": "network",
  "event.name": "device.reboot",
  "event.kind": "problem",
  "event.category": "device",
  "event.device": "unknown-sw",
  "event.message": "System restarted",
  "syslog.unmatched": "true",
  "syslog.sourceIp": "203.0.113.77",
  "syslog.hostname": "unknown-sw",
};

const SIGNED_IN: Record<string, string> = {
  "event.domain": "network",
  "event.name": "auth.login_success",
  "event.kind": "info",
  "event.category": "security",
  "event.device": "Core Switch",
  "event.message": "Login passed for user admin through ssh",
  "user.name": "admin",
  "networkDevice.id": DEVICE_ID,
};

// Named by the project in a log pipeline; it says nothing more of itself.
const UPS_ON_BATTERY: Record<string, string> = {
  "event.domain": "network",
  "event.name": "ups.on_battery",
  "event.kind": "info",
  "event.device": "Rack UPS",
};

interface Reported {
  // The instant, or null for a log that came without a time.
  at: string | null;
  attributes: Record<string, string>;
  body?: string | undefined;
}

function rowsOf(reported: Array<Reported>): Array<NetworkEventRow> {
  return toNetworkEventRows(
    reported.map((log: Reported, index: number) => {
      return {
        _id: `log-${index}`,
        time: log.at ? new Date(log.at) : undefined,
        body: log.body || "",
        attributes: log.attributes,
      };
    }),
  );
}

function draw(
  reported: Array<Reported>,
  props: Partial<React.ComponentProps<typeof NetworkEventsTimeline>> = {},
): { onOpen: MockFunction; rows: Array<NetworkEventRow> } {
  const onOpen: MockFunction = getJestMockFunction();
  const rows: Array<NetworkEventRow> = rowsOf(reported);

  render(
    <MemoryRouter>
      <NetworkEventsTimeline
        rows={rows}
        showDevice={true}
        onOpen={onOpen}
        {...props}
      />
    </MemoryRouter>,
  );

  return { onOpen: onOpen, rows: rows };
}

function textOf(element: Element): string {
  return (element.textContent || "").replace(NARROW_SPACES, " ").trim();
}

function rowElements(): Array<HTMLElement> {
  return screen.queryAllByTestId("network-event-row");
}

function rowNamed(name: string): HTMLElement {
  const row: HTMLElement | undefined = rowElements().find(
    (candidate: HTMLElement): boolean => {
      return candidate.getAttribute("data-event-name") === name;
    },
  );

  if (!row) {
    throw new Error(`No row for ${name}`);
  }

  return row;
}

// The time a row shows to the eye: what is not kept for a screen reader only.
function shownTimeOf(row: HTMLElement): string {
  const cell: HTMLElement = within(row).getByTestId("network-event-time");
  const time: HTMLElement | null = cell.querySelector("time:not(.sr-only)");

  return time ? textOf(time) : "";
}

function hintOf(row: HTMLElement): string {
  const hint: HTMLElement | null = within(row).queryByTestId(
    "network-event-relative-time",
  );

  return hint ? textOf(hint) : "";
}

beforeEach(() => {
  mockLanguage = "en";
  jest.useFakeTimers({ now: NOW });
  OneUptimeDate.setUserTimezone(Timezone.AsiaSingapore);
  jest.spyOn(OneUptimeDate, "getUserPrefers12HourFormat").mockReturnValue(true);
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
  jest.restoreAllMocks();
  OneUptimeDate.setUserTimezone(null);
});

describe("the days of a timeline", () => {
  const THREE_DAYS: Array<Reported> = [
    { at: "2026-10-13T07:30:00.000Z", attributes: LINK_DOWN },
    { at: "2026-10-13T02:10:00.000Z", attributes: LINK_UP },
    { at: "2026-10-12T07:30:00.000Z", attributes: STRANGER_REBOOT },
    { at: "2026-10-06T07:30:00.000Z", attributes: SIGNED_IN },
  ];

  test("one heading per day, with its full date", () => {
    draw(THREE_DAYS);

    expect(
      screen.getAllByTestId("network-events-day-heading").map(textOf),
    ).toEqual([
      "Tuesday, October 13, 2026",
      "Monday, October 12, 2026",
      "Tuesday, October 6, 2026",
    ]);
  });

  test("today and yesterday say so; an earlier day is named by its date alone", () => {
    draw(THREE_DAYS);

    const days: Array<HTMLElement> =
      screen.getAllByTestId("network-events-day");

    expect(
      textOf(within(days[0]!).getByTestId("network-events-day-relative")),
    ).toBe("Today");
    expect(
      textOf(within(days[1]!).getByTestId("network-events-day-relative")),
    ).toBe("Yesterday");
    expect(
      within(days[2]!).queryByTestId("network-events-day-relative"),
    ).not.toBeInTheDocument();
  });

  test("every day names the zone its times are in", () => {
    draw(THREE_DAYS);

    // Singapore has no abbreviation of its own: its offset says it.
    for (const day of screen.getAllByTestId("network-events-day")) {
      expect(textOf(within(day).getByTestId("network-events-day-zone"))).toBe(
        "GMT+08",
      );
    }
  });

  test("a day's events are a list under its heading, in the order they were given", () => {
    draw(THREE_DAYS);

    const days: Array<HTMLElement> =
      screen.getAllByTestId("network-events-day");

    expect(
      days.map((day: HTMLElement): Array<string> => {
        return within(day)
          .getAllByTestId("network-event-row")
          .map((row: HTMLElement): string => {
            return row.getAttribute("data-event-name") || "";
          });
      }),
    ).toEqual([
      ["interface.down", "interface.up"],
      ["device.reboot"],
      ["auth.login_success"],
    ]);

    for (const day of days) {
      expect(within(day).getAllByRole("list")).toHaveLength(1);
      expect(within(day).getByRole("list").tagName).toBe("OL");
    }
  });

  test("the timeline never reorders: oldest first stays oldest first", () => {
    draw([...THREE_DAYS].reverse());

    expect(
      screen.getAllByTestId("network-events-day-heading").map(textOf),
    ).toEqual([
      "Tuesday, October 6, 2026",
      "Monday, October 12, 2026",
      "Tuesday, October 13, 2026",
    ]);
    expect(
      rowElements().map((row: HTMLElement): string => {
        return row.getAttribute("data-event-name") || "";
      }),
    ).toEqual([
      "auth.login_success",
      "device.reboot",
      "interface.up",
      "interface.down",
    ]);
  });

  test("a day is a section a screen reader can name: it is labelled by its heading", () => {
    draw(THREE_DAYS);

    for (const day of screen.getAllByTestId("network-events-day")) {
      const heading: HTMLElement = within(day).getByTestId(
        "network-events-day-heading",
      );

      expect(day.tagName).toBe("SECTION");
      expect(heading.tagName).toBe("H3");
      expect(heading.id).not.toBe("");
      expect(day).toHaveAttribute("aria-labelledby", heading.id);
    }
  });

  test("two timelines on one page keep their headings apart", () => {
    draw(THREE_DAYS);
    draw(THREE_DAYS);

    const ids: Array<string> = screen
      .getAllByTestId("network-events-day-heading")
      .map((heading: HTMLElement): string => {
        return heading.id;
      });

    expect(ids).toHaveLength(6);
    expect(new Set(ids).size).toBe(6);
  });

  test("the day an event falls on is the reader's day, not UTC's", () => {
    // 11:30 PM on the 12th in UTC is 7:30 AM on the 13th in Singapore.
    draw([{ at: "2026-10-12T23:30:00.000Z", attributes: LINK_DOWN }]);

    expect(
      screen.getAllByTestId("network-events-day-heading").map(textOf),
    ).toEqual(["Tuesday, October 13, 2026"]);
    expect(shownTimeOf(rowElements()[0]!)).toBe("7:30 AM");
  });

  test("an event from 11:58 PM read at 12:03 AM is Yesterday", () => {
    jest.setSystemTime(new Date("2026-10-13T16:03:00.000Z"));
    draw([{ at: "2026-10-13T15:58:00.000Z", attributes: LINK_DOWN }]);

    expect(textOf(screen.getByTestId("network-events-day-relative"))).toBe(
      "Yesterday",
    );
    expect(shownTimeOf(rowElements()[0]!)).toBe("11:58 PM");
  });

  test("with nothing to list it draws no day at all", () => {
    draw([]);

    expect(screen.getByTestId("network-events-list")).toBeEmptyDOMElement();
  });
});

describe("when an event happened", () => {
  test("is its real time of day, in the reader's time zone", () => {
    draw([{ at: "2026-10-13T07:25:00.000Z", attributes: LINK_DOWN }]);

    // 07:25 UTC is 3:25 PM in Singapore.
    expect(shownTimeOf(rowElements()[0]!)).toBe("3:25 PM");
  });

  test("follows the reader's clock: 24-hour for someone who reads it so", () => {
    jest
      .spyOn(OneUptimeDate, "getUserPrefers12HourFormat")
      .mockReturnValue(false);
    draw([{ at: "2026-10-13T07:25:00.000Z", attributes: LINK_DOWN }]);

    expect(shownTimeOf(rowElements()[0]!)).toBe("15:25");
  });

  test("follows the reader's time zone when they change it", () => {
    OneUptimeDate.setUserTimezone(Timezone.AmericaNew_York);
    draw([{ at: "2026-10-13T07:25:00.000Z", attributes: LINK_DOWN }]);

    expect(shownTimeOf(rowElements()[0]!)).toBe("3:25 AM");
    expect(textOf(screen.getByTestId("network-events-day-zone"))).toBe("EDT");
  });

  test("carries the instant itself, for a machine to read", () => {
    draw([{ at: "2026-10-13T07:25:42.000Z", attributes: LINK_DOWN }]);

    const time: HTMLElement = within(rowElements()[0]!)
      .getByTestId("network-event-time")
      .querySelector("time") as HTMLElement;

    expect(time).toHaveAttribute("dateTime", "2026-10-13T07:25:42.000Z");
  });

  test("an event from the last hour also says how long ago; an older one only its time", () => {
    draw([
      { at: "2026-10-13T07:39:50.000Z", attributes: LINK_DOWN },
      { at: "2026-10-13T07:28:00.000Z", attributes: LINK_UP },
      { at: "2026-10-13T06:41:00.000Z", attributes: STRANGER_REBOOT },
      { at: "2026-10-13T06:40:00.000Z", attributes: SIGNED_IN },
      { at: "2026-10-13T03:00:00.000Z", attributes: UPS_ON_BATTERY },
    ]);

    expect(rowElements().map(hintOf)).toEqual([
      "now",
      "12 min. ago",
      "59 min. ago",
      // An hour ago and more: the time says it.
      "",
      "",
    ]);
    expect(rowElements().map(shownTimeOf)).toEqual([
      "3:39 PM",
      "3:28 PM",
      "2:41 PM",
      "2:40 PM",
      "11:00 AM",
    ]);
  });

  test("never says an event is in the future: a clock a little ahead reads as now", () => {
    draw([{ at: "2026-10-13T07:41:00.000Z", attributes: LINK_DOWN }]);

    expect(hintOf(rowElements()[0]!)).toBe("now");
  });

  test("events of the same minute share the first one's time", () => {
    draw([
      { at: "2026-10-13T07:30:50.000Z", attributes: LINK_DOWN },
      { at: "2026-10-13T07:30:20.000Z", attributes: LINK_UP },
      { at: "2026-10-13T07:30:05.000Z", attributes: STRANGER_REBOOT },
      { at: "2026-10-13T07:29:59.000Z", attributes: SIGNED_IN },
    ]);

    // A burst reads as one moment: the time is said once.
    expect(rowElements().map(shownTimeOf)).toEqual([
      "3:30 PM",
      "",
      "",
      "3:29 PM",
    ]);
    expect(rowElements().map(hintOf)).toEqual([
      "9 min. ago",
      "",
      "",
      "10 min. ago",
    ]);
  });

  test("a row whose time is not drawn still has it for a screen reader", () => {
    draw([
      { at: "2026-10-13T07:30:50.000Z", attributes: LINK_DOWN },
      { at: "2026-10-13T07:30:20.000Z", attributes: LINK_UP },
    ]);

    const hidden: HTMLElement = within(rowNamed("interface.up"))
      .getByTestId("network-event-time")
      .querySelector("time") as HTMLElement;

    expect(hidden).toHaveClass("sr-only");
    expect(textOf(hidden)).toBe("3:30 PM");
    expect(hidden).toHaveAttribute("dateTime", "2026-10-13T07:30:20.000Z");
    // And the one that is drawn is not hidden from anyone.
    expect(
      within(rowNamed("interface.down"))
        .getByTestId("network-event-time")
        .querySelector("time"),
    ).not.toHaveClass("sr-only");
  });

  test("the same minute on another day is a new time: each day starts over", () => {
    draw([
      { at: "2026-10-13T07:30:00.000Z", attributes: LINK_DOWN },
      { at: "2026-10-12T07:30:00.000Z", attributes: LINK_UP },
    ]);

    expect(rowElements().map(shownTimeOf)).toEqual(["3:30 PM", "3:30 PM"]);
  });

  test("an event with no time is listed after the days, without one", () => {
    draw([
      { at: "2026-10-13T07:30:00.000Z", attributes: LINK_DOWN },
      { at: null, attributes: LINK_UP },
    ]);

    const untimed: HTMLElement = rowNamed("interface.up");

    expect(rowElements()).toHaveLength(2);
    // Under no day's heading: nobody knows which day it was.
    expect(untimed.closest('[data-testid="network-events-day"]')).toBeNull();
    expect(
      within(untimed).getByTestId("network-event-time"),
    ).toBeEmptyDOMElement();
    // Still an event that can be opened.
    expect(
      within(untimed).getByRole("button", { name: "Interface up" }),
    ).toBeInTheDocument();
  });

  test("only events with no time: a list, and no heading that would be a guess", () => {
    draw([{ at: null, attributes: LINK_DOWN }]);

    expect(screen.queryByTestId("network-events-day")).not.toBeInTheDocument();
    expect(rowElements()).toHaveLength(1);
  });
});

describe("the timeline while the page stays open", () => {
  test("the hint moves on with the clock, a minute at a time", () => {
    draw([{ at: "2026-10-13T07:38:00.000Z", attributes: LINK_DOWN }]);

    expect(hintOf(rowElements()[0]!)).toBe("2 min. ago");

    act(() => {
      jest.advanceTimersByTime(60 * 1000);
    });

    expect(hintOf(rowElements()[0]!)).toBe("3 min. ago");

    act(() => {
      jest.advanceTimersByTime(10 * 60 * 1000);
    });

    expect(hintOf(rowElements()[0]!)).toBe("13 min. ago");
    // The time itself is the time: it does not move.
    expect(shownTimeOf(rowElements()[0]!)).toBe("3:38 PM");
  });

  test("an hour on, the hint is gone: the time says it", () => {
    draw([{ at: "2026-10-13T07:38:00.000Z", attributes: LINK_DOWN }]);

    act(() => {
      jest.advanceTimersByTime(61 * 60 * 1000);
    });

    expect(hintOf(rowElements()[0]!)).toBe("");
  });

  test("at midnight Today becomes Yesterday", () => {
    // 11:50 PM in Singapore.
    jest.setSystemTime(new Date("2026-10-13T15:50:00.000Z"));
    draw([{ at: "2026-10-13T15:45:00.000Z", attributes: LINK_DOWN }]);

    expect(textOf(screen.getByTestId("network-events-day-relative"))).toBe(
      "Today",
    );

    act(() => {
      jest.advanceTimersByTime(11 * 60 * 1000);
    });

    expect(textOf(screen.getByTestId("network-events-day-relative"))).toBe(
      "Yesterday",
    );
  });

  test("a list with nothing from today runs no timer at all", () => {
    draw([
      { at: "2026-10-12T07:30:00.000Z", attributes: LINK_DOWN },
      { at: "2026-10-06T07:30:00.000Z", attributes: LINK_UP },
    ]);

    expect(jest.getTimerCount()).toBe(0);
  });

  test("a list with something from today keeps one clock, however many rows it has", () => {
    const many: Array<Reported> = [];

    for (let minute: number = 1; minute <= 30; minute++) {
      many.push({
        at: new Date(NOW.getTime() - minute * 60 * 1000).toISOString(),
        attributes: LINK_DOWN,
      });
    }

    draw(many);

    expect(rowElements()).toHaveLength(30);
    expect(jest.getTimerCount()).toBe(1);
  });

  test("a timeline that is left stops its clock", () => {
    draw([{ at: "2026-10-13T07:38:00.000Z", attributes: LINK_DOWN }]);

    expect(jest.getTimerCount()).toBe(1);

    cleanup();

    expect(jest.getTimerCount()).toBe(0);
  });
});

describe("the timeline in the reader's language", () => {
  test("German: the day, Today, the zone's time and the hint are German", () => {
    mockLanguage = "de";
    jest
      .spyOn(OneUptimeDate, "getUserPrefers12HourFormat")
      .mockReturnValue(false);
    draw([
      { at: "2026-10-13T07:28:00.000Z", attributes: LINK_DOWN },
      { at: "2026-10-12T07:28:00.000Z", attributes: LINK_UP },
    ]);

    expect(
      screen.getAllByTestId("network-events-day-heading").map(textOf),
    ).toEqual(["Dienstag, 13. Oktober 2026", "Montag, 12. Oktober 2026"]);
    expect(
      screen.getAllByTestId("network-events-day-relative").map(textOf),
    ).toEqual(["Heute", "Gestern"]);
    expect(shownTimeOf(rowElements()[0]!)).toBe("15:28");
    // Not moment's English "12 minutes ago".
    expect(hintOf(rowElements()[0]!)).toBe("vor 12 Min.");
  });

  test("Japanese: the same, in Japanese", () => {
    mockLanguage = "ja";
    draw([{ at: "2026-10-13T07:28:00.000Z", attributes: LINK_DOWN }]);

    expect(textOf(screen.getByTestId("network-events-day-heading"))).toBe(
      "2026年10月13日火曜日",
    );
    expect(textOf(screen.getByTestId("network-events-day-relative"))).toBe(
      "今日",
    );
    expect(hintOf(rowElements()[0]!)).toBe("12 分前");
  });

  test("Persian: Persian words and digits, on the calendar every other date on the page uses", () => {
    mockLanguage = "fa";
    jest
      .spyOn(OneUptimeDate, "getUserPrefers12HourFormat")
      .mockReturnValue(false);
    draw([{ at: "2026-10-13T07:28:00.000Z", attributes: LINK_DOWN }]);

    const heading: string = textOf(
      screen.getByTestId("network-events-day-heading"),
    );

    // Gregorian, in Persian's own digits: ۲۰۲۶, not ۱۴۰۵ (or 2026).
    expect(heading).toContain("۲۰۲۶");
    expect(heading).toContain("۱۳");
    expect(heading).not.toMatch(/[0-9]/);
    expect(shownTimeOf(rowElements()[0]!)).toBe("۱۵:۲۸");
  });
});

describe("a row of the timeline", () => {
  const ONE: Array<Reported> = [
    { at: "2026-10-13T07:25:00.000Z", attributes: LINK_DOWN },
  ];

  test("says what happened, to what, on which device, and in the device's own words", () => {
    draw(ONE);

    const row: HTMLElement = rowElements()[0]!;

    expect(
      within(row).getByRole("button", { name: "Interface down" }),
    ).toBeInTheDocument();
    expect(textOf(within(row).getByTestId("network-event-subject"))).toBe(
      "Interface GigabitEthernet0/1",
    );
    expect(textOf(within(row).getByTestId("network-event-device"))).toBe(
      "Core Switch",
    );
    expect(textOf(within(row).getByTestId("network-event-message"))).toBe(
      "Interface GigabitEthernet0/1, changed state to down",
    );
  });

  test("is a list item whose one button is the event's name", () => {
    draw(ONE);

    const row: HTMLElement = rowElements()[0]!;

    expect(row.tagName).toBe("LI");
    expect(within(row).getAllByRole("button")).toHaveLength(1);
    expect(within(row).getByRole("button")).toHaveAttribute(
      "aria-haspopup",
      "dialog",
    );
    expect(within(row).getByRole("button")).toHaveAttribute("type", "button");
  });

  test("the button covers the row, so a click anywhere on it opens the event", () => {
    const { onOpen, rows } = draw(ONE);
    const row: HTMLElement = rowElements()[0]!;
    const button: HTMLElement = within(row).getByRole("button");

    expect(row).toHaveClass("relative");
    expect(button).toHaveClass("after:absolute", "after:inset-0");

    fireEvent.click(button);

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith(rows[0]);
  });

  test("the keyboard's focus is drawn around the whole row", () => {
    draw(ONE);

    expect(within(rowElements()[0]!).getByRole("button")).toHaveClass(
      "focus:outline-none",
      "focus-visible:after:ring-2",
      "focus-visible:after:ring-indigo-500",
    );
  });

  test("the kind is a coloured dot for the eye, and a word for a screen reader", () => {
    draw([
      { at: "2026-10-13T07:25:00.000Z", attributes: LINK_DOWN },
      { at: "2026-10-13T07:20:00.000Z", attributes: LINK_UP },
      { at: "2026-10-13T07:10:00.000Z", attributes: SIGNED_IN },
    ]);

    const expected: Array<[string, NetworkEventKind, string]> = [
      ["interface.down", NetworkEventKind.Problem, "Problem"],
      ["interface.up", NetworkEventKind.Recovery, "Recovery"],
      ["auth.login_success", NetworkEventKind.Info, "Informational"],
    ];

    for (const [name, kind, word] of expected) {
      const row: HTMLElement = rowNamed(name);
      const dot: HTMLElement = row.querySelector(
        `.${KIND_DOT_CLASS_NAMES[kind]}`,
      ) as HTMLElement;

      expect(row).toHaveAttribute("data-event-kind", kind);
      expect(dot).not.toBeNull();
      expect(dot).toHaveAttribute("aria-hidden", "true");
      expect(within(row).getByText(word)).toHaveClass("sr-only");
    }
  });

  test("the three kinds are three colours", () => {
    expect(new Set(Object.values(KIND_DOT_CLASS_NAMES)).size).toBe(3);
    expect(KIND_DOT_CLASS_NAMES[NetworkEventKind.Problem]).toBe("bg-red-500");
    expect(KIND_DOT_CLASS_NAMES[NetworkEventKind.Recovery]).toBe(
      "bg-emerald-500",
    );
    expect(KIND_DOT_CLASS_NAMES[NetworkEventKind.Info]).toBe("bg-gray-300");
  });

  test("an event the project named is called by its name", () => {
    draw([
      {
        at: "2026-10-13T07:25:00.000Z",
        attributes: UPS_ON_BATTERY,
        body: "UPS rack-1 is on battery",
      },
    ]);

    const row: HTMLElement = rowElements()[0]!;

    expect(
      within(row).getByRole("button", { name: "ups.on_battery" }),
    ).toBeInTheDocument();
    // It names nothing it happened to: no subject is made up for it.
    expect(
      within(row).queryByTestId("network-event-subject"),
    ).not.toBeInTheDocument();
    // With no words of its own, the log's body is its message.
    expect(textOf(within(row).getByTestId("network-event-message"))).toBe(
      "UPS rack-1 is on battery",
    );
  });

  test("an event with no words at all draws no empty line for them", () => {
    draw([{ at: "2026-10-13T07:25:00.000Z", attributes: UPS_ON_BATTERY }]);

    expect(
      within(rowElements()[0]!).queryByTestId("network-event-message"),
    ).not.toBeInTheDocument();
  });

  test("the row whose event is open is marked, and only that one", () => {
    const reported: Array<Reported> = [
      { at: "2026-10-13T07:25:00.000Z", attributes: LINK_DOWN },
      { at: "2026-10-13T07:20:00.000Z", attributes: LINK_UP },
    ];
    const rows: Array<NetworkEventRow> = rowsOf(reported);

    render(
      <MemoryRouter>
        <NetworkEventsTimeline
          rows={rows}
          showDevice={true}
          onOpen={getJestMockFunction()}
          openRowId={rows[1]!.id}
        />
      </MemoryRouter>,
    );

    expect(rowNamed("interface.up")).toHaveAttribute("data-open", "true");
    expect(rowNamed("interface.up")).toHaveClass("bg-gray-50");
    expect(rowNamed("interface.down")).not.toHaveAttribute("data-open");
    expect(rowNamed("interface.down")).not.toHaveClass("bg-gray-50");
    // Every row lights up under the pointer.
    expect(rowNamed("interface.down")).toHaveClass("hover:bg-gray-50");
  });
});

describe("the device of a row", () => {
  test("a device OneUptime has is a link to its own Events page", () => {
    const { onOpen } = draw([
      { at: "2026-10-13T07:25:00.000Z", attributes: LINK_DOWN },
    ]);
    const link: HTMLElement = within(rowElements()[0]!).getByRole("link", {
      name: "Core Switch",
    });

    expect(link).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/network-devices/${DEVICE_ID}/events`,
    );
    expect(getDeviceEventsRoute(DEVICE_ID).toString()).toBe(
      `/dashboard/${PROJECT_ID}/network-devices/${DEVICE_ID}/events`,
    );
    // Above the row's button, so the click goes to the device.
    expect(link.parentElement).toHaveClass("relative", "z-10");

    fireEvent.click(link);

    expect(onOpen).not.toHaveBeenCalled();
  });

  test("an address that is not a device yet is no link: its name opens the event, and says what it is", () => {
    const { onOpen, rows } = draw([
      { at: "2026-10-13T07:25:00.000Z", attributes: STRANGER_REBOOT },
    ]);
    const row: HTMLElement = rowElements()[0]!;

    expect(within(row).queryByRole("link")).not.toBeInTheDocument();
    expect(
      textOf(within(row).getByTestId("network-event-unknown-source")),
    ).toBe("Not a device yet");

    fireEvent.click(within(row).getByText("unknown-sw"));

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith(rows[0]);
  });

  test("a device OneUptime has is not marked as anything", () => {
    draw([{ at: "2026-10-13T07:25:00.000Z", attributes: LINK_DOWN }]);

    expect(
      within(rowElements()[0]!).queryByTestId("network-event-unknown-source"),
    ).not.toBeInTheDocument();
  });

  test("a long name is cut to its column, and said whole on hover", () => {
    const long: string =
      "distribution-switch-building-c-floor-12-rack-04.emea.corp.example.net";

    draw([
      {
        at: "2026-10-13T07:25:00.000Z",
        attributes: {
          ...LINK_DOWN,
          "event.device": long,
          "networkDevice.name": long,
        },
      },
      {
        at: "2026-10-13T07:20:00.000Z",
        attributes: { ...STRANGER_REBOOT, "event.device": long },
      },
    ]);

    for (const row of rowElements()) {
      const name: HTMLElement = within(row)
        .getByTestId("network-event-device")
        .querySelector("[title]") as HTMLElement;

      expect(name).toHaveAttribute("title", long);
      expect(name).toHaveClass("truncate", "min-w-0");
    }
  });

  test("from lg up it has a column of its own at the right; below, a line under the event's name", () => {
    draw([{ at: "2026-10-13T07:25:00.000Z", attributes: LINK_DOWN }]);

    const device: HTMLElement = within(rowElements()[0]!).getByTestId(
      "network-event-device",
    );

    // Below lg: the second line, under the name, as wide as the row's text.
    expect(device).toHaveClass("row-start-2", "col-start-2", "col-span-2");
    expect(device).toHaveClass("sm:col-start-3");
    // From lg: the first line, the last column, aligned to that line.
    expect(device).toHaveClass(
      "lg:row-start-1",
      "lg:col-start-4",
      "lg:col-span-1",
      "lg:justify-end",
      "lg:self-start",
    );
    // Never wider than a name needs to be told apart.
    expect(device).toHaveClass("lg:max-w-[13rem]", "xl:max-w-[20rem]");
  });

  test("Not a device yet stands before the name where the name is at the right edge", () => {
    draw([{ at: "2026-10-13T07:25:00.000Z", attributes: STRANGER_REBOOT }]);

    const badge: HTMLElement = within(rowElements()[0]!).getByTestId(
      "network-event-unknown-source",
    );

    // So the names of a column end on one edge, marked or not.
    expect(badge.parentElement).toHaveClass("lg:order-first");
    // The mark is never broken over two lines or squeezed.
    expect(badge).toHaveClass("whitespace-nowrap", "flex-shrink-0");
  });

  test("on one device's page a row names no device: every row is that device's", () => {
    draw(
      [
        { at: "2026-10-13T07:25:00.000Z", attributes: LINK_DOWN },
        { at: "2026-10-13T07:20:00.000Z", attributes: STRANGER_REBOOT },
      ],
      { showDevice: false },
    );

    for (const row of rowElements()) {
      expect(
        within(row).queryByTestId("network-event-device"),
      ).not.toBeInTheDocument();
      expect(within(row).queryByRole("link")).not.toBeInTheDocument();
      expect(
        within(row).queryByTestId("network-event-unknown-source"),
      ).not.toBeInTheDocument();
    }
  });
});

describe("a row's lines, and the time beside them", () => {
  /*
   * From sm the time stands beside the event, down every line the event
   * has. It must span exactly those lines: a browser gives a spanned line
   * that holds nothing a height of its own, and every row of the list was
   * 8px taller for it.
   */
  function timeClassesOf(row: HTMLElement): Array<string> {
    return Array.from(
      within(row).getByTestId("network-event-time").classList,
    ).filter((name: string): boolean => {
      return name.includes("row-span");
    });
  }

  test("an event with a device and its words: three lines below lg, two from lg", () => {
    draw([{ at: "2026-10-13T07:25:00.000Z", attributes: LINK_DOWN }]);

    expect(timeClassesOf(rowElements()[0]!)).toEqual([
      "sm:row-span-3",
      "lg:row-span-2",
    ]);
  });

  test("on one device's page: the name and the words, two lines at every width", () => {
    draw([{ at: "2026-10-13T07:25:00.000Z", attributes: LINK_DOWN }], {
      showDevice: false,
    });

    expect(timeClassesOf(rowElements()[0]!)).toEqual([
      "sm:row-span-2",
      "lg:row-span-2",
    ]);
  });

  test("an event with no words: one line fewer", () => {
    draw([{ at: "2026-10-13T07:25:00.000Z", attributes: UPS_ON_BATTERY }]);

    expect(timeClassesOf(rowElements()[0]!)).toEqual([
      "sm:row-span-2",
      "lg:row-span-1",
    ]);
  });

  test("an event with neither a device nor words: its one line", () => {
    draw([{ at: "2026-10-13T07:25:00.000Z", attributes: UPS_ON_BATTERY }], {
      showDevice: false,
    });

    expect(timeClassesOf(rowElements()[0]!)).toEqual([
      "sm:row-span-1",
      "lg:row-span-1",
    ]);
  });

  test("the device's words go under the device below lg, and under the name from lg", () => {
    draw([{ at: "2026-10-13T07:25:00.000Z", attributes: LINK_DOWN }]);

    expect(
      within(rowElements()[0]!).getByTestId("network-event-message"),
    ).toHaveClass("row-start-3", "lg:row-start-2");
  });

  test("with no device line the words are the second line everywhere", () => {
    draw([{ at: "2026-10-13T07:25:00.000Z", attributes: LINK_DOWN }], {
      showDevice: false,
    });

    const message: HTMLElement = within(rowElements()[0]!).getByTestId(
      "network-event-message",
    );

    expect(message).toHaveClass("row-start-2");
    expect(message).not.toHaveClass("row-start-3");
  });

  test("the words are cut to two lines on a phone and one from sm, and never push the page sideways", () => {
    draw([
      {
        at: "2026-10-13T07:25:00.000Z",
        attributes: {
          ...LINK_DOWN,
          "event.message": `Group = ${"A".repeat(300)}, Session is being torn down.`,
        },
      },
    ]);

    const message: HTMLElement = within(rowElements()[0]!).getByTestId(
      "network-event-message",
    );

    expect(message).toHaveClass(
      "line-clamp-2",
      "sm:line-clamp-1",
      "min-w-0",
      "[overflow-wrap:anywhere]",
    );
    // The whole of it stays in the row: nothing is cut out of what is read aloud.
    expect(textOf(message)).toContain("Session is being torn down.");
  });

  test("a name with no place to break, such as a project's own event, breaks anywhere rather than widening the page", () => {
    draw([
      {
        at: "2026-10-13T07:25:00.000Z",
        attributes: {
          ...UPS_ON_BATTERY,
          "event.name": "environment.rack_door_opened_outside_change_window",
        },
      },
    ]);

    expect(within(rowElements()[0]!).getByRole("button")).toHaveClass(
      "min-w-0",
      "[overflow-wrap:anywhere]",
    );
  });

  test("on a phone the time shares the event's first line, and the hint is left to wider screens", () => {
    draw([{ at: "2026-10-13T07:38:00.000Z", attributes: LINK_DOWN }]);

    const row: HTMLElement = rowElements()[0]!;
    const time: HTMLElement = within(row).getByTestId("network-event-time");

    // The last column of the first line on a phone; the first column from sm.
    expect(time).toHaveClass("col-start-3", "row-start-1", "sm:col-start-1");
    expect(time).toHaveClass("whitespace-nowrap", "text-right");
    expect(within(row).getByTestId("network-event-relative-time")).toHaveClass(
      "max-sm:hidden",
    );
  });

  test("a click on the time opens the event, like the rest of the row", () => {
    const { onOpen, rows } = draw([
      { at: "2026-10-13T07:38:00.000Z", attributes: LINK_DOWN },
    ]);

    fireEvent.click(screen.getByText("3:38 PM"));

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith(rows[0]);
  });

  test("the columns: the kind's dot, the event and the time on a phone; the time first from sm", () => {
    draw([{ at: "2026-10-13T07:38:00.000Z", attributes: LINK_DOWN }]);

    expect(rowElements()[0]!).toHaveClass(
      "grid",
      "grid-cols-[0.625rem_minmax(0,1fr)_auto]",
      // As wide as the feeds' time column: it fits the longest "N min. ago".
      "sm:grid-cols-[6.25rem_0.625rem_minmax(0,1fr)_auto]",
    );
  });

  test("what a row says lines up with the card's title and buttons: the list reaches past the card's padding by a row's own", () => {
    draw([
      { at: "2026-10-13T07:38:00.000Z", attributes: LINK_DOWN },
      { at: "2026-10-12T07:38:00.000Z", attributes: LINK_UP },
      { at: null, attributes: STRANGER_REBOOT },
    ]);

    const reaches: Array<string> = Array.from(
      screen.getByTestId("network-events-list").classList,
    ).flatMap((name: string): Array<string> => {
      const reach: string | undefined = LIST_REACH.exec(name)?.[1];

      return reach ? [reach] : [];
    });

    // One reach, at every width.
    expect(reaches).toHaveLength(1);

    /*
     * A row is padded so its hover and its focus ring have room; a day's
     * heading is padded as much, so it starts where its rows' words do.
     */
    expect(rowElements()).toHaveLength(3);

    for (const row of rowElements()) {
      expect(row).toHaveClass(`px-${reaches[0]}`);
    }

    const headings: Array<HTMLElement> = screen.getAllByTestId(
      "network-events-day-heading",
    );

    expect(headings).toHaveLength(2);

    for (const heading of headings) {
      expect(heading.parentElement).toHaveClass(`px-${reaches[0]}`);
    }
  });
});
