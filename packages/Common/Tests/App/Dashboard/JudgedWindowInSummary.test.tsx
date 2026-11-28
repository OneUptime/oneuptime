/** @timezone America/New_York */

import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";
import { act, cleanup, render } from "@testing-library/react";
import fs from "fs";
import i18next from "i18next";
import path from "path";
import React from "react";
import { initReactI18next } from "react-i18next";
import OneUptimeDate from "../../../Types/Date";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import MonitorEvaluationSummary from "../../../Types/Monitor/MonitorEvaluationSummary";
import Timezone from "../../../Types/Timezone";
import EvaluationLogList from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/EvaluationLogList";
import { getJudgedWindowEnds } from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/JudgedWindowWords";
import { DASHBOARD_LANGUAGES } from "../../Helpers/TranslatedLanguages";

/*
 * THE WINDOW A TELEMETRY CHECK JUDGED, IN ITS SUMMARY (#11248).
 *
 * A telemetry check judges the window that ends when it was due, however
 * late it ran, so when it was evaluated no longer says which data it read.
 * Its summary - View Summary in Monitoring Logs, and the latest check on the
 * monitor's Overview - says the window among its facts: "Data from Nov 27,
 * 2026, 10:00:07 AM to 10:01:07 AM", in the reader's zone and clock, to the
 * second, the day once. A check that judges no window, and a summary logged
 * before checks said it, show nothing new. This file runs in New York while
 * the reader is in UTC, so a window written in the process's zone would
 * read five hours off.
 */

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

const LANGUAGES: Array<string> = [...DASHBOARD_LANGUAGES];

const STARTS_AT: Date = new Date("2026-11-27T10:00:07.250Z");
const ENDS_AT: Date = new Date("2026-11-27T10:01:07.250Z");
// The check ran late: 25 seconds after the window it judged.
const EVALUATED_AT: Date = new Date("2026-11-27T10:01:32.000Z");

function readLocale(locale: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, string>;
}

async function readIn(language: string): Promise<void> {
  await act(async () => {
    await i18next.changeLanguage(language);
  });
}

function summary(
  overrides: Partial<MonitorEvaluationSummary> = {},
): MonitorEvaluationSummary {
  return {
    evaluatedAt: EVALUATED_AT,
    criteriaResults: [
      {
        criteriaId: "criteria-errors",
        criteriaName: "Errors in the minute",
        filterCondition: FilterCondition.All,
        met: true,
        message: "Log Count was 3, above the 0 threshold.",
        filters: [],
      },
    ],
    events: [],
    ...overrides,
  };
}

// Each fact of the line, in order.
function factsOf(evaluation: MonitorEvaluationSummary): Array<string> {
  const view: ReturnType<typeof render> = render(
    <EvaluationLogList evaluationSummary={evaluation} />,
  );
  const line: HTMLElement | null = view.queryByTestId("evaluation-facts");

  return line
    ? Array.from(line.children)
        .filter((child: Element): boolean => {
          return child.getAttribute("aria-hidden") !== "true";
        })
        .map((child: Element): string => {
          return child.textContent || "";
        })
    : [];
}

beforeAll(async () => {
  const resources: Record<string, { translation: Record<string, string> }> = {
    en: { translation: readLocale("en") },
  };

  for (const language of LANGUAGES) {
    resources[language] = { translation: readLocale(language) };
  }

  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: resources,
    interpolation: { escapeValue: false },
  });
});

beforeEach(() => {
  OneUptimeDate.setUserTimezone(Timezone.UTC);
});

afterEach(async () => {
  cleanup();
  OneUptimeDate.setUserTimezone(null);
  await readIn("en");
});

describe("a telemetry check's summary, in English", () => {
  test("the process runs in New York, the reader reads in UTC", () => {
    expect(new Date("2026-11-27T10:00:00.000Z").getHours()).toBe(5);
  });

  test("says the window it judged after its other facts, to the second, the day once", () => {
    const facts: Array<string> = factsOf(
      summary({
        durationInMs: 640,
        judgedWindow: { startsAt: STARTS_AT, endsAt: ENDS_AT },
      }),
    );

    expect(facts).toHaveLength(3);
    expect(facts[0]).toMatch(/^Evaluated at /);
    expect(facts[1]).toMatch(/^Took /);

    const ends: { start: string; end: string } = getJudgedWindowEnds({
      judgedWindow: { startsAt: STARTS_AT, endsAt: ENDS_AT },
    })!;

    expect(facts[2]).toBe(`Data from ${ends.start} to ${ends.end}`);
    // The window's own seconds, in the reader's zone: not the five hours off of New York.
    expect(facts[2]).toMatch(/10:00:07/);
    expect(facts[2]).toMatch(/10:01:07/);
    expect(facts[2]).toMatch(/Nov 27, 2026/);
    // Its date said once.
    expect(facts[2]!.split("Nov 27").length).toBe(2);
  });

  test("a late check's window is the one it was due to: it ends before the check was evaluated", () => {
    const facts: Array<string> = factsOf(
      summary({ judgedWindow: { startsAt: STARTS_AT, endsAt: ENDS_AT } }),
    );

    // Evaluated at 10:01:32, to the minute as it always read; judged to 10:01:07.
    expect(facts[0]).toMatch(/10:01/);
    expect(facts[0]).not.toMatch(/10:01:07/);
    expect(facts[1]).toMatch(/to 10:01:07/);
  });

  test("a window across the reader's midnight says both days", () => {
    const facts: Array<string> = factsOf(
      summary({
        judgedWindow: {
          startsAt: new Date("2026-11-26T23:59:30.000Z"),
          endsAt: new Date("2026-11-27T00:00:30.000Z"),
        },
      }),
    );

    expect(facts[1]).toMatch(
      /^Data from Nov 26, 2026, .*23:59:30|^Data from Nov 26, 2026, 11:59:30/,
    );
    expect(facts[1]).toMatch(/to Nov 27, 2026, /);
  });

  test("a summary read back from its log, its dates as text, says the same", () => {
    const stored: MonitorEvaluationSummary = JSON.parse(
      JSON.stringify(
        summary({ judgedWindow: { startsAt: STARTS_AT, endsAt: ENDS_AT } }),
      ),
    );

    expect(typeof stored.judgedWindow!.startsAt).toBe("string");
    expect(factsOf(stored)[1]).toMatch(/^Data from .*10:00:07.* to .*10:01:07/);
  });

  test("a check that judges no window - a probe's, a request's - and an older summary say nothing new", () => {
    expect(factsOf(summary({ durationInMs: 640 }))).toEqual([
      expect.stringMatching(/^Evaluated at /),
      expect.stringMatching(/^Took /),
    ]);
  });

  test("a window whose ends cannot be read, or end before they start, is not said", () => {
    expect(
      factsOf(
        summary({
          judgedWindow: {
            startsAt: new Date(Number.NaN),
            endsAt: ENDS_AT,
          },
        }),
      ),
    ).toHaveLength(1);
    cleanup();
    expect(
      factsOf(
        summary({
          judgedWindow: { startsAt: ENDS_AT, endsAt: STARTS_AT },
        }),
      ),
    ).toHaveLength(1);
  });
});

describe("getJudgedWindowEnds", () => {
  test("none for a summary with no window", () => {
    expect(getJudgedWindowEnds({})).toBeNull();
    expect(getJudgedWindowEnds({ judgedWindow: undefined })).toBeNull();
  });

  test("the two ends, the start whole and the end its time, in the reader's zone", () => {
    OneUptimeDate.setUserTimezone(Timezone.AsiaKolkata);

    const ends: { start: string; end: string } | null = getJudgedWindowEnds({
      judgedWindow: { startsAt: STARTS_AT, endsAt: ENDS_AT },
    });

    // 10:00:07 UTC is 15:30:07 in Kolkata.
    expect(ends!.start).toMatch(/Nov 27, 2026, (15:30:07|3:30:07 PM)/);
    expect(ends!.end).toMatch(/^(15:31:07|3:31:07 PM)$/);
  });
});

/*
 * A check's window holds its start and not its end since #11334: a record
 * stamped on its end was the next check's, and the summary says so.
 */
describe("a check's window that leaves out its end, in its summary", () => {
  const LEFT_OUT: MonitorEvaluationSummary["judgedWindow"] = {
    startsAt: STARTS_AT,
    endsAt: ENDS_AT,
    includesEnd: false,
  };

  test("says the end is not included, to the second, the day once", () => {
    const facts: Array<string> = factsOf(
      summary({ durationInMs: 640, judgedWindow: LEFT_OUT }),
    );
    const ends: { start: string; end: string } = getJudgedWindowEnds({
      judgedWindow: LEFT_OUT,
    })!;

    expect(facts).toHaveLength(3);
    expect(facts[2]).toBe(
      `Data from ${ends.start} up to, but not including, ${ends.end}`,
    );
    expect(facts[2]).toMatch(/10:00:07/);
    expect(facts[2]).toMatch(/not including, .*10:01:07/);
    expect(facts[2]!.split("Nov 27").length).toBe(2);
  });

  test("read back from its log, its dates as text, says the same", () => {
    const stored: MonitorEvaluationSummary = JSON.parse(
      JSON.stringify(summary({ judgedWindow: LEFT_OUT })),
    );

    expect(stored.judgedWindow!.includesEnd).toBe(false);
    expect(factsOf(stored)[1]).toMatch(
      /^Data from .*10:00:07.* up to, but not including, .*10:01:07/,
    );
  });

  test("a window logged before #11334, which held both ends, keeps saying so", () => {
    for (const includesEnd of [undefined, true]) {
      expect(
        factsOf(
          summary({
            judgedWindow: {
              startsAt: STARTS_AT,
              endsAt: ENDS_AT,
              includesEnd: includesEnd,
            },
          }),
        )[1],
      ).toMatch(/^Data from .*10:00:07.* to .*10:01:07/);
      cleanup();
    }
  });

  test("getJudgedWindowEnds says which end the window held", () => {
    expect(getJudgedWindowEnds({ judgedWindow: LEFT_OUT })!.includesEnd).toBe(
      false,
    );
    expect(
      getJudgedWindowEnds({
        judgedWindow: { startsAt: STARTS_AT, endsAt: ENDS_AT },
      })!.includesEnd,
    ).toBe(true);
  });

  test("every Dashboard language has the sentence, with both its ends", () => {
    const english: string =
      readLocale("en")[
        "Data from {{start}} up to, but not including, {{end}}"
      ]!;

    expect(english).toBe(
      "Data from {{start}} up to, but not including, {{end}}",
    );

    for (const language of LANGUAGES) {
      const words: string | undefined =
        readLocale(language)[
          "Data from {{start}} up to, but not including, {{end}}"
        ];

      expect(words).toBeDefined();
      expect(words).toContain("{{start}}");
      expect(words).toContain("{{end}}");
      // Its own sentence, not the one that holds both ends.
      expect(words).not.toBe(
        readLocale(language)["Data from {{start}} to {{end}}"],
      );
    }
  });
});

describe.each(LANGUAGES)(
  "a telemetry check's summary in %s",
  (language: string) => {
    test("words the window in the language, with its seconds", async () => {
      await readIn(language);

      const facts: Array<string> = factsOf(
        summary({ judgedWindow: { startsAt: STARTS_AT, endsAt: ENDS_AT } }),
      );

      expect(facts).toHaveLength(2);
      expect(facts[1]).not.toMatch(/^Data from /);
      // Its seconds, 07, in the language's digits.
      expect(facts[1]).toMatch(/[0۰٠][7۷٧]/u);
    });

    test("words a window that leaves out its end in the language, as its own sentence", async () => {
      await readIn(language);

      const leftOut: string = factsOf(
        summary({
          judgedWindow: {
            startsAt: STARTS_AT,
            endsAt: ENDS_AT,
            includesEnd: false,
          },
        }),
      )[1]!;
      cleanup();
      const bothEnds: string = factsOf(
        summary({ judgedWindow: { startsAt: STARTS_AT, endsAt: ENDS_AT } }),
      )[1]!;

      expect(leftOut).not.toMatch(/^Data from /);
      expect(leftOut).not.toMatch(/not including/);
      expect(leftOut).not.toBe(bothEnds);
      // Both ends, to the second, in the language's digits.
      expect(leftOut).toMatch(/[0۰٠][7۷٧]/u);
      expect(leftOut).toMatch(/[1١۱]/u);
    });
  },
);
