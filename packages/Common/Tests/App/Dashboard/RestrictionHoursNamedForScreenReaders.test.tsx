import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import fs from "fs";
import i18next from "i18next";
import path from "path";
import React from "react";
import { initReactI18next } from "react-i18next";
import RestrictionTimesFieldElement, {
  getRestrictionTimeLabelIds,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/RestrictionTimesFieldElement";
import WorkingHoursPicker from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallRule/WorkingHoursPicker";
import DayOfWeek from "../../../Types/Day/DayOfWeek";
import OneUptimeDate from "../../../Types/Date";
import RestrictionTimes, {
  RestrictionType,
} from "../../../Types/OnCallDutyPolicy/RestrictionTimes";
import WorkingHours from "../../../Types/OnCallDutyPolicy/WorkingHours";
import TimePicker from "../../../UI/Components/TimePicker/TimePicker";

/*
 * EVERY CLOCK OF A LAYER'S ACTIVE HOURS IS NAMED BY THE LABEL OVER IT
 * (issue #7722).
 *
 * A layer's active hours draw From: and To: over each clock, and a weekly
 * window a day picker and a clock under each. The labels were plain text,
 * tied to nothing: each clock is the shared TimePicker, a group that falls
 * back to "Time input", so a screen reader heard "Time input, group" for
 * every clock - two for a daily window, six for three weekly windows - and
 * nothing said which began a window and which ended it. Each weekly
 * window's day picker had no name at all. An on-call rule's working hours,
 * when they are not the same every day, open in the same editor with the
 * same gap.
 *
 * Each From: and To: now names the controls under it, in the reader's
 * language, and no two windows share a label's id.
 */

const DASHBOARD_SRC: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src",
);

function readLocale(locale: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(
      path.join(DASHBOARD_SRC, "Locales", `${locale}.json`),
      "utf8",
    ),
  ) as Record<string, string>;
}

const LANGUAGES: Array<string> = ["en", "de", "ar", "fa"];

// The labels as each language words them, read from its locale.
function labelsIn(locale: string): { from: string; to: string } {
  const strings: Record<string, string> = readLocale(locale);
  return { from: strings["From:"]!, to: strings["To:"]! };
}

function dailyRestriction(): RestrictionTimes {
  const restrictionTimes: RestrictionTimes = new RestrictionTimes();
  restrictionTimes.restictionType = RestrictionType.Daily;
  restrictionTimes.dayRestrictionTimes = {
    startTime: new Date("2026-09-23T09:00:00.000Z"),
    endTime: new Date("2026-09-23T17:00:00.000Z"),
  };
  restrictionTimes.weeklyRestrictionTimes = [];
  return restrictionTimes;
}

// Three weekly windows: weekdays, Saturday morning, Sunday afternoon.
function weeklyRestriction(): RestrictionTimes {
  const restrictionTimes: RestrictionTimes = new RestrictionTimes();
  restrictionTimes.restictionType = RestrictionType.Weekly;
  restrictionTimes.dayRestrictionTimes = null;
  restrictionTimes.weeklyRestrictionTimes = [
    {
      startDay: DayOfWeek.Monday,
      endDay: DayOfWeek.Friday,
      startTime: new Date("2026-09-21T09:00:00.000Z"),
      endTime: new Date("2026-09-25T17:00:00.000Z"),
    },
    {
      startDay: DayOfWeek.Saturday,
      endDay: DayOfWeek.Saturday,
      startTime: new Date("2026-09-26T08:00:00.000Z"),
      endTime: new Date("2026-09-26T12:00:00.000Z"),
    },
    {
      startDay: DayOfWeek.Sunday,
      endDay: DayOfWeek.Sunday,
      startTime: new Date("2026-09-27T13:00:00.000Z"),
      endTime: new Date("2026-09-27T18:00:00.000Z"),
    },
  ];
  return restrictionTimes;
}

// The clocks on the page: the TimePicker's groups, by their names.
function clockNames(container: HTMLElement = document.body): Array<string> {
  return within(container)
    .queryAllByRole("group")
    .filter((group: HTMLElement): boolean => {
      return group.getAttribute("aria-haspopup") === "dialog";
    })
    .map((group: HTMLElement): string => {
      return accessibleName(group);
    });
}

function dayPickers(
  container: HTMLElement = document.body,
): Array<HTMLElement> {
  return within(container).queryAllByRole("combobox");
}

// The name a screen reader reads, from the ids the element is labelled by.
function accessibleName(element: HTMLElement): string {
  const ids: string = element.getAttribute("aria-labelledby") || "";

  if (!ids.trim()) {
    return element.getAttribute("aria-label") || "";
  }

  return ids
    .split(/\s+/)
    .map((id: string): string => {
      const label: HTMLElement | null = document.getElementById(id);

      if (!label) {
        throw new Error(
          `aria-labelledby names ${id}, which is not on the page`,
        );
      }

      return (label.textContent || "").trim();
    })
    .join(" ");
}

// Every id on the page, with how often it is used.
function duplicateIds(): Array<string> {
  const seen: Map<string, number> = new Map<string, number>();

  for (const element of Array.from(document.querySelectorAll("[id]"))) {
    seen.set(element.id, (seen.get(element.id) || 0) + 1);
  }

  return Array.from(seen.entries())
    .filter(([, count]: [string, number]): boolean => {
      return count > 1;
    })
    .map(([id]: [string, number]): string => {
      return id;
    });
}

beforeAll(async () => {
  const resources: Record<string, { translation: Record<string, string> }> = {};

  for (const locale of LANGUAGES) {
    resources[locale] = { translation: readLocale(locale) };
  }

  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources,
    interpolation: { escapeValue: false },
  });
});

beforeEach(async () => {
  jest
    .spyOn(OneUptimeDate, "getUserPrefers12HourFormat")
    .mockReturnValue(false);
  await act(async () => {
    await i18next.changeLanguage("en");
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function inLanguage(locale: string): Promise<void> {
  await act(async () => {
    await i18next.changeLanguage(locale);
  });
}

describe("a daily window's two clocks", () => {
  test.each(LANGUAGES)(
    "are named by From: and To: in %s, never Time input",
    async (locale: string) => {
      await inLanguage(locale);

      render(
        <RestrictionTimesFieldElement
          value={dailyRestriction()}
          timezone="UTC"
        />,
      );

      const labels: { from: string; to: string } = labelsIn(locale);
      const timeInput: string = readLocale(locale)["Time input"]!;

      expect(clockNames()).toEqual([labels.from, labels.to]);
      expect(clockNames()).not.toContain(timeInput);

      // The way a screen reader is asked for them.
      expect(
        screen.getByRole("group", { name: labels.from }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("group", { name: labels.to }),
      ).toBeInTheDocument();
    },
  );

  test("each clock's name is its own label, the one drawn over it", () => {
    render(
      <RestrictionTimesFieldElement
        value={dailyRestriction()}
        timezone="UTC"
      />,
    );

    for (const label of ["From:", "To:"]) {
      const text: HTMLElement = screen.getByText(label);
      const clock: HTMLElement = screen.getByRole("group", { name: label });

      expect(text.id).not.toBe("");
      expect(clock.getAttribute("aria-labelledby")).toBe(text.id);
      // Drawn under it, in the same end of the window.
      expect(text.parentElement!.contains(clock)).toBe(true);
    }
  });
});

describe("weekly windows", () => {
  test.each(LANGUAGES)(
    "in %s, each window's day pickers and clocks are named by their own From: and To:",
    async (locale: string) => {
      await inLanguage(locale);

      render(
        <RestrictionTimesFieldElement
          value={weeklyRestriction()}
          timezone="UTC"
        />,
      );

      const labels: { from: string; to: string } = labelsIn(locale);

      // Three windows: a From and a To each, in order.
      expect(clockNames()).toEqual([
        labels.from,
        labels.to,
        labels.from,
        labels.to,
        labels.from,
        labels.to,
      ]);
      expect(dayPickers().map(accessibleName)).toEqual([
        labels.from,
        labels.to,
        labels.from,
        labels.to,
        labels.from,
        labels.to,
      ]);

      // The way a screen reader is asked for them.
      for (const label of [labels.from, labels.to]) {
        expect(screen.getAllByRole("combobox", { name: label })).toHaveLength(
          3,
        );
        expect(screen.getAllByRole("group", { name: label })).toHaveLength(3);
      }
    },
  );

  test("each end's label names the day picker and the clock under it, and nothing in another window", () => {
    render(
      <RestrictionTimesFieldElement
        value={weeklyRestriction()}
        timezone="UTC"
      />,
    );

    const labels: Array<HTMLElement> = [
      ...screen.getAllByText("From:"),
      ...screen.getAllByText("To:"),
    ];

    expect(labels).toHaveLength(6);

    for (const label of labels) {
      const end: HTMLElement = label.parentElement as HTMLElement;
      const named: Array<Element> = Array.from(
        document.querySelectorAll(`[aria-labelledby="${label.id}"]`),
      );

      // A day picker and a clock, both under this label, and nothing else.
      expect(named).toHaveLength(2);
      for (const element of named) {
        expect(end.contains(element)).toBe(true);
      }
      expect(
        named.map((element: Element) => {
          return element.getAttribute("role");
        }),
      ).toEqual(expect.arrayContaining(["combobox", "group"]));
    }
  });

  test("two windows never share an id", () => {
    render(
      <RestrictionTimesFieldElement
        value={weeklyRestriction()}
        timezone="UTC"
      />,
    );

    const ids: Array<string> = [
      ...screen.getAllByText("From:"),
      ...screen.getAllByText("To:"),
    ].map((label: HTMLElement): string => {
      return label.id;
    });

    expect(new Set(ids).size).toBe(6);
    expect(duplicateIds()).toEqual([]);
  });

  test("a window added with Add Restriction Time is named like the others", async () => {
    const restrictionTimes: RestrictionTimes = weeklyRestriction();
    restrictionTimes.weeklyRestrictionTimes =
      restrictionTimes.weeklyRestrictionTimes.slice(0, 1);

    render(
      <RestrictionTimesFieldElement value={restrictionTimes} timezone="UTC" />,
    );

    await act(async () => {
      screen.getByRole("button", { name: "Add Restriction Time" }).click();
    });

    expect(clockNames()).toEqual(["From:", "To:", "From:", "To:"]);
    expect(dayPickers().map(accessibleName)).toEqual([
      "From:",
      "To:",
      "From:",
      "To:",
    ]);
    expect(duplicateIds()).toEqual([]);
  });
});

describe("two editors on one page", () => {
  test("two layers' hours open at once share no id, and each clock is named by its own label", () => {
    render(
      <div>
        <div data-testid="first">
          <RestrictionTimesFieldElement
            value={weeklyRestriction()}
            timezone="UTC"
          />
        </div>
        <div data-testid="second">
          <RestrictionTimesFieldElement
            value={dailyRestriction()}
            timezone="UTC"
          />
        </div>
      </div>,
    );

    expect(duplicateIds()).toEqual([]);

    for (const testId of ["first", "second"]) {
      const container: HTMLElement = screen.getByTestId(testId);

      for (const clock of within(container).getAllByRole("group")) {
        if (clock.getAttribute("aria-haspopup") !== "dialog") {
          continue;
        }

        // Its label is in the same editor.
        const label: HTMLElement | null = document.getElementById(
          clock.getAttribute("aria-labelledby") || "",
        );
        expect(label).not.toBeNull();
        expect(container.contains(label)).toBe(true);
      }
    }
  });
});

describe("an on-call rule's working hours", () => {
  test("hours not the same every day open in the layer's editor, with each clock named", () => {
    const hours: RestrictionTimes = WorkingHours.fromSimpleHours({
      days: [0, 1, 2, 3],
      from: "09:00",
      to: "17:00",
      timezone: "UTC",
    });
    hours.weeklyRestrictionTimes = [
      ...hours.weeklyRestrictionTimes,
      ...WorkingHours.fromSimpleHours({
        days: [4],
        from: "09:00",
        to: "15:00",
        timezone: "UTC",
      }).weeklyRestrictionTimes,
    ];

    render(<WorkingHoursPicker value={hours} timezone="UTC" />);

    const names: Array<string> = clockNames();

    expect(names.length).toBe(hours.weeklyRestrictionTimes.length * 2);
    expect(names).not.toContain("Time input");
    expect(new Set(names)).toEqual(new Set(["From:", "To:"]));
    expect(dayPickers().map(accessibleName)).toEqual(names);
    expect(duplicateIds()).toEqual([]);
  });

  test("the same hours every day keep their own named fields: Start Time and End Time", () => {
    render(
      <WorkingHoursPicker
        value={WorkingHours.fromSimpleHours({
          days: [0, 1, 2, 3, 4],
          from: "09:00",
          to: "17:00",
          timezone: "UTC",
        })}
        timezone="UTC"
      />,
    );

    expect(screen.getByLabelText("Start Time")).toHaveValue("09:00");
    expect(screen.getByLabelText("End Time")).toHaveValue("17:00");
  });
});

describe("the label ids", () => {
  test("a daily window's and each weekly window's are their own", () => {
    const ids: Array<string> = [
      getRestrictionTimeLabelIds({ baseId: "r" }),
      getRestrictionTimeLabelIds({ baseId: "r", windowIndex: 0 }),
      getRestrictionTimeLabelIds({ baseId: "r", windowIndex: 1 }),
      getRestrictionTimeLabelIds({ baseId: "s", windowIndex: 1 }),
    ].flatMap((pair: { from: string; to: string }): Array<string> => {
      return [pair.from, pair.to];
    });

    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("a clock no label names", () => {
  test("still falls back to Time input", () => {
    render(<TimePicker value={new Date("2026-09-23T09:00:00.000Z")} />);

    expect(
      screen.getByRole("group", { name: "Time input" }),
    ).toBeInTheDocument();
  });

  test("in the reader's language too", async () => {
    await inLanguage("de");

    render(<TimePicker value={new Date("2026-09-23T09:00:00.000Z")} />);

    expect(
      screen.getByRole("group", { name: readLocale("de")["Time input"]! }),
    ).toBeInTheDocument();
  });
});
