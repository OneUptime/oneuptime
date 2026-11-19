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
import { act, cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import ChatActivityFeed, {
  describeElapsedTime,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/ChatActivityFeed";
import { ActivityFeedRun } from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/ActivityFeedRun";
import AIRunEvent from "../../../Models/DatabaseModels/AIRunEvent";
import AIRunEventType from "../../../Types/AI/AIRunEventType";
import AIRunStatus from "../../../Types/AI/AIRunStatus";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import { Translator } from "../../../Types/Translator";
import { getGlobalTranslator } from "../../../UI/Utils/TranslateTemplate";
import {
  dashboardTranslator,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";

/*
 * THE AI ACTIVITY'S RUN SUMMARY: HOW LONG A RUN TOOK, PAST AN HOUR AND IN
 * DAYS, AND TICKING WHILE IT RUNS (issue #6493).
 *
 * The summary heads an investigation's or a triage's steps: "Started 6:16
 * PM · took 14 minutes · 59 steps". Past an hour it rounded to whole hours
 * - 89 minutes read "1 hour", 150 minutes "3 hours" - it had no days, so a
 * run left running for two days read "48 hours", and "running for" stood
 * still between two reads of the run.
 *
 * Now past an hour it says hours and minutes, from a day days and hours,
 * each unit a plural of the reader's language (Arabic's short units, a
 * Persian figure in Persian digits), and while the run runs the summary
 * moves on by itself, on the shared clock.
 */

const NBSP: string = " ";
const SECOND: number = 1000;
const MINUTE: number = 60 * SECOND;
const HOUR: number = 60 * MINUTE;

const ELAPSED: Array<[string, number]> = [
  ["59 s", 59 * SECOND],
  ["59 min", 59 * MINUTE],
  ["61 min", 61 * MINUTE],
  ["89 min", 89 * MINUTE],
  ["25 h", 25 * HOUR],
  ["49 h", 49 * HOUR],
];

describe("describeElapsedTime in English", () => {
  test.each([
    [59 * SECOND, `59${NBSP}seconds`],
    [59 * MINUTE, `59${NBSP}minutes`],
    // An hour and a minute: both, never "1 hour".
    [61 * MINUTE, `1${NBSP}hour and 1${NBSP}minute`],
    [89 * MINUTE, `1${NBSP}hour and 29${NBSP}minutes`],
    [2 * HOUR, `2${NBSP}hours`],
    [150 * MINUTE, `2${NBSP}hours and 30${NBSP}minutes`],
    // Days from a day on: never "25 hours" or "48 hours".
    [25 * HOUR, `1${NBSP}day and 1${NBSP}hour`],
    [48 * HOUR, `2${NBSP}days`],
    [49 * HOUR, `2${NBSP}days and 1${NBSP}hour`],
    // The two largest units: the minutes of a two-day run are left out, not rounded up.
    [49 * HOUR + 59 * MINUTE, `2${NBSP}days and 1${NBSP}hour`],
    // Rounded to the minute below an hour, as before...
    [89 * SECOND, `1${NBSP}minute`],
    [90 * SECOND, `2${NBSP}minutes`],
    // ...so 59 minutes and a half is an hour.
    [59 * MINUTE + 30 * SECOND, `1${NBSP}hour`],
  ])("%d ms is %s", (milliseconds: number, words: string) => {
    expect(describeElapsedTime(milliseconds, getGlobalTranslator())).toBe(
      words,
    );
  });
});

/*
 * In each language, its own units and its own way of joining two: the
 * locale's words for "{{count}} hours" and "{{first}} and {{second}}".
 */
describe.each([
  ["de", "German"],
  ["ru", "Russian, whose plurals take several forms"],
  ["fa", "Persian, in Persian digits"],
  ["ar", "Arabic, in its short units"],
])("describeElapsedTime in %s (%s)", (language: string) => {
  const translator: Translator = dashboardTranslator(language);
  const words: Record<string, string> = readDashboardLocale(language);

  function unit(
    key: "seconds" | "minutes" | "hours" | "days",
    count: number,
  ): string {
    return translator.translatePlural(
      {
        one: `{{count}} ${key.slice(0, -1)}`,
        other: `{{count}} ${key}`,
      },
      count,
    );
  }

  function both(first: string, second: string): string {
    return translator.translateTemplate("{{first}} and {{second}}", {
      first,
      second,
    });
  }

  test("each unit and the join are the language's own words", () => {
    for (const key of [
      "{{count}} seconds",
      "{{count}} minutes",
      "{{count}} hours",
      "{{count}} days",
      "{{first}} and {{second}}",
    ]) {
      expect({
        key,
        worded: words[key] !== undefined && words[key] !== key,
      }).toEqual({ key, worded: true });
    }
  });

  test.each(ELAPSED)("%s", (_name: string, milliseconds: number) => {
    const expected: Record<number, string> = {
      [59 * SECOND]: unit("seconds", 59),
      [59 * MINUTE]: unit("minutes", 59),
      [61 * MINUTE]: both(unit("hours", 1), unit("minutes", 1)),
      [89 * MINUTE]: both(unit("hours", 1), unit("minutes", 29)),
      [25 * HOUR]: both(unit("days", 1), unit("hours", 1)),
      [49 * HOUR]: both(unit("days", 2), unit("hours", 1)),
    };

    const drawn: string = describeElapsedTime(milliseconds, translator);

    expect(drawn).toBe(expected[milliseconds]);
    // Never the English.
    expect(drawn).not.toMatch(/\b(?:second|minute|hour|day)s?\b/);
  });

  if (language === "fa") {
    test("writes its figures in Persian digits", () => {
      expect(describeElapsedTime(89 * MINUTE, translator)).toContain("۲۹");
      expect(describeElapsedTime(89 * MINUTE, translator)).not.toMatch(/[0-9]/);
    });
  }

  if (language === "ar") {
    test("writes its hours and minutes in their short units, in Latin digits", () => {
      const drawn: string = describeElapsedTime(150 * MINUTE, translator);

      expect(words["{{count}} hours"]).toBe("{{count}} س");
      expect(words["{{count}} minutes"]).toBe("{{count}} د");
      expect(drawn).toContain("2");
      expect(drawn).toContain("30");
      expect(drawn).toContain("س");
      expect(drawn).toContain("د");
    });
  }

  if (language === "ru") {
    test("reads right for a count in each of its plural forms", () => {
      for (const minutes of [1, 2, 5, 21]) {
        expect(describeElapsedTime(minutes * MINUTE, translator)).toBe(
          unit("minutes", minutes),
        );
      }
    });
  }
});

/*
 * "running for" moves on by itself while the run runs: the panel draws the
 * list again only when the run's read changes, and a run waiting on one
 * long model call read "running for 3 minutes" all the while.
 */
describe("the run summary while the run runs", () => {
  const STARTED: Date = new Date("2026-11-09T14:00:00.000Z");

  function stepEvents(): Array<AIRunEvent> {
    return [AIRunEventType.RunStarted, AIRunEventType.LlmCallStarted].map(
      (eventType: AIRunEventType): AIRunEvent => {
        const event: AIRunEvent = new AIRunEvent(ObjectID.generate());
        event.eventType = eventType;
        event.createdAt = STARTED;
        return event;
      },
    );
  }

  function run(
    status: AIRunStatus,
    values: Partial<ActivityFeedRun> = {},
  ): ActivityFeedRun {
    return { status, startedAt: STARTED, ...values };
  }

  function summary(): string {
    return screen.getByTestId("activity-run-summary").textContent || "";
  }

  beforeEach(() => {
    jest.useFakeTimers();
    jest
      .spyOn(OneUptimeDate, "getUserPrefers12HourFormat")
      .mockReturnValue(false);
  });

  afterEach(() => {
    cleanup();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test("moves from 'running for 3 minutes' to 'running for 4 minutes' when the clock passes a minute", () => {
    jest.setSystemTime(new Date("2026-11-09T14:03:10.000Z"));

    render(
      <ChatActivityFeed
        events={stepEvents()}
        hideChrome={true}
        run={run(AIRunStatus.Running)}
        showStepTimes={true}
      />,
    );

    expect(summary()).toContain(`running for 3${NBSP}minutes`);

    // The next minute of the clock: drawn again with nothing else changing.
    act(() => {
      jest.advanceTimersByTime(60 * SECOND);
    });

    expect(summary()).toContain(`running for 4${NBSP}minutes`);
    expect(summary()).not.toContain(`running for 3${NBSP}minutes`);
  });

  test("counts its first minute second by second", () => {
    jest.setSystemTime(new Date("2026-11-09T14:00:20.000Z"));

    render(
      <ChatActivityFeed
        events={stepEvents()}
        hideChrome={true}
        run={run(AIRunStatus.Running)}
        showStepTimes={true}
      />,
    );

    expect(summary()).toContain(`running for 20${NBSP}seconds`);

    act(() => {
      jest.advanceTimersByTime(5 * SECOND);
    });

    expect(summary()).toContain(`running for 25${NBSP}seconds`);
  });

  test("past an hour, in hours and minutes, still moving on", () => {
    jest.setSystemTime(new Date("2026-11-09T15:29:30.000Z"));

    render(
      <ChatActivityFeed
        events={stepEvents()}
        hideChrome={true}
        run={run(AIRunStatus.Running)}
        showStepTimes={true}
      />,
    );

    expect(summary()).toContain(
      `running for 1${NBSP}hour and 30${NBSP}minutes`,
    );

    act(() => {
      jest.advanceTimersByTime(60 * SECOND);
    });

    expect(summary()).toContain(
      `running for 1${NBSP}hour and 31${NBSP}minutes`,
    );
  });

  test("a finished run's summary never changes", () => {
    jest.setSystemTime(new Date("2026-11-09T18:00:00.000Z"));

    render(
      <ChatActivityFeed
        events={stepEvents()}
        hideChrome={true}
        run={run(AIRunStatus.Completed, {
          completedAt: new Date("2026-11-09T15:29:00.000Z"),
        })}
        showStepTimes={true}
      />,
    );

    const before: string = summary();
    expect(before).toContain(`took 1${NBSP}hour and 29${NBSP}minutes`);

    act(() => {
      jest.advanceTimersByTime(10 * MINUTE);
    });

    expect(summary()).toBe(before);
    // Nothing waits to draw it again.
    expect(jest.getTimerCount()).toBe(0);
  });
});
