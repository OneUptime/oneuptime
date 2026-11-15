import "@testing-library/jest-dom";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import * as React from "react";
import TimelineLegend from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/ScheduleTimeline/TimelineLegend";
import SpanUtil, {
  DivisibilityFactor,
  IntervalUnit,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/SpanUtil";
import { formatDurationNano } from "../../../../App/FeatureSet/Dashboard/src/Utils/TraceDetailPresentation";
import { TimelineViewMode } from "../../../Types/OnCallDutyPolicy/ScheduleTimelineLayout";
import { Translator } from "../../../Types/Translator";
import {
  dashboardTranslator,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";

/*
 * A SPAN'S DURATION AND AN ON-CALL SHIFT'S LENGTH ON DASHBOARD PAGES (#8617).
 *
 * The trace explorer's durations (the waterfall, the operations table, a
 * span's panel, the flame graph) come from formatDurationNano and
 * SpanUtil.getSpanDurationAsString, and the on-call schedule timeline's
 * legend and bars from ScheduleTimelineLayout.formatDuration. Each wrote
 * English units - "2h 5m", "3d 12h" - on every page. They take the page's
 * translator now (the global one unless one is handed in), so the units
 * and digits are the reader's; English reads exactly as it did.
 */

const NB: string = String.fromCharCode(0x00a0);

const SECOND: number = 1e9;

const LATIN_DIGIT: RegExp = /[0-9]/;

// How the explorer divides a span's time; the duration ignores it.
const MILLISECONDS: DivisibilityFactor = {
  divisibilityFactorNumber: 1_000_000,
  intervalUnit: IntervalUnit.Milliseconds,
};

const translators: Record<string, Translator> = {
  en: dashboardTranslator("en"),
  de: dashboardTranslator("de"),
  ar: dashboardTranslator("ar"),
  fa: dashboardTranslator("fa"),
};

describe("a span's duration in the trace explorer", () => {
  test("English without a translator, as the tests and an unset page read it", () => {
    expect(formatDurationNano(1284e6)).toBe("1.28 s");
    expect(formatDurationNano(125 * SECOND)).toBe("2m 5s");
    expect(formatDurationNano(-5)).toBe("0 ms");
    expect(
      SpanUtil.getSpanDurationAsString({
        divisibilityFactor: MILLISECONDS,
        spanDurationInUnixNano: 7500 * SECOND,
      }),
    ).toBe("2h 5m");
    // No duration recorded reads as none.
    expect(
      SpanUtil.getSpanDurationAsString({
        divisibilityFactor: MILLISECONDS,
        spanDurationInUnixNano: 0,
      }),
    ).toBe("0 ms");
  });

  test("in German, Arabic and Persian, with the page's translator", () => {
    const said: (nanoseconds: number) => Record<string, string> = (
      nanoseconds: number,
    ): Record<string, string> => {
      return Object.fromEntries(
        Object.keys(translators).map((language: string): [string, string] => {
          return [
            language,
            withoutIsolateMarks(
              formatDurationNano(nanoseconds, translators[language]),
            ),
          ];
        }),
      );
    };

    expect(said(125 * SECOND)).toEqual({
      en: "2m 5s",
      de: `2${NB}Min. 5${NB}s`,
      ar: `2${NB}د 5${NB}ث`,
      fa: `۲${NB}دقیقه ۵${NB}ثانیه`,
    });
    expect(said(1.72 * SECOND)).toEqual({
      en: "1.72 s",
      de: `1,72${NB}Sek.`,
      ar: `1.72${NB}ث`,
      fa: `۱٫۷۲${NB}ثانیه`,
    });
    expect(said(0)).toEqual({
      en: "0 ms",
      de: `0${NB}ms`,
      ar: `0${NB}ملي${NB}ث`,
      fa: `۰${NB}میلی‌ثانیه`,
    });

    for (const language of ["de", "ar", "fa"]) {
      expect(
        withoutIsolateMarks(
          SpanUtil.getSpanDurationAsString({
            divisibilityFactor: MILLISECONDS,
            spanDurationInUnixNano: 125 * SECOND,
            translator: translators[language],
          }),
        ),
      ).toBe(said(125 * SECOND)[language]);
    }
  });
});

describe("the on-call schedule timeline's legend", () => {
  const MINUTE: number = 60_000;
  const HOUR: number = 60 * MINUTE;

  beforeAll(async () => {
    await i18next.use(initReactI18next).init({
      lng: "en",
      fallbackLng: "en",
      resources: {
        de: { translation: readDashboardLocale("de") },
        fa: { translation: readDashboardLocale("fa") },
      },
      interpolation: { escapeValue: false },
      keySeparator: false,
      nsSeparator: false,
    });
  });

  afterEach(() => {
    cleanup();
  });

  afterAll(async () => {
    await act(async (): Promise<void> => {
      await i18next.changeLanguage("en");
    });
  });

  const renderLegend: (language: string) => Promise<void> = async (
    language: string,
  ): Promise<void> => {
    await act(async (): Promise<void> => {
      await i18next.changeLanguage(language);
    });

    render(
      <TimelineLegend
        people={[
          {
            userId: "user-1",
            userName: "Ada Lovelace",
            color: "#4f46e5",
            onCallMilliseconds: 8 * HOUR + 30 * MINUTE,
            scheduleCount: 2,
            isOnCallNow: false,
          },
        ]}
        mode={TimelineViewMode.Week}
        timezone="UTC"
        highlightedUserId={null}
        onToggleHighlight={(): void => {}}
        showOverrideKey={false}
        showGapKey={false}
      />,
    );
  };

  const personText: () => string = (): string => {
    return withoutIsolateMarks(
      screen.getByTestId("timeline-person").textContent || "",
    );
  };

  test("English reads as it did", async () => {
    await renderLegend("en");

    expect(personText()).toContain("8h 30m");
  });

  test("German draws the person's load in its own units", async () => {
    await renderLegend("de");

    expect(personText()).toContain(`8${NB}Std. 30${NB}Min.`);
    expect(personText()).not.toContain("8h 30m");
  });

  test("Persian draws it in Persian digits and units, in the button's title too", async () => {
    await renderLegend("fa");

    expect(personText()).toContain(`۸${NB}ساعت ۳۰${NB}دقیقه`);
    expect(LATIN_DIGIT.test(personText())).toBe(false);
    expect(
      withoutIsolateMarks(
        screen.getByTestId("timeline-person").getAttribute("title") || "",
      ),
    ).not.toContain("8h 30m");
  });
});
