import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  Translator,
  createTranslator,
} from "Common/UI/Utils/TranslateTemplate";
import SliType from "Common/Types/ServiceLevelObjective/SliType";
import SloStatus from "Common/Types/ServiceLevelObjective/SloStatus";
import {
  getSloNotice,
  SloNotice,
  SloNoticeData,
} from "Common/Utils/Slo/SloHealth";
import {
  formatErrorBudgetRemainingRequests,
  formatSloNumber,
  formatSloPercent,
} from "Common/Utils/Slo/SloWidgetFormat";
import { DASHBOARD_LANGUAGES } from "Common/Tests/Helpers/TranslatedLanguages";
import {
  getSloNoticeActionLabelInLanguage,
  getSloNoticeBodyInLanguage,
} from "../../FeatureSet/Dashboard/src/Components/Slo/SloNoticeText";

/*
 * AN SLO'S BANNERS AND ITS BUDGET LINES IN EVERY DASHBOARD LANGUAGE (#8446,
 * #8441), from the shipped locale files. Every banner's title, sentence and
 * link is worded by every language - they used to be English on every page
 * but a few - and the one sentence with figures ("greater than 0 and less
 * than 100 ... such as 99.9") writes them the reader's way. A request SLO's
 * budget line on the dashboard widgets ("120 failed requests remaining")
 * is worded and counted in each language too.
 */

const DASHBOARD: string = path.resolve(__dirname, "../../FeatureSet/Dashboard");

const ENGLISH: Translator = createTranslator(undefined);

// The languages whose Dashboard writes its own digits, not Latin ones.
const OWN_DIGIT_LANGUAGES: ReadonlyArray<string> = ["fa"];

const LATIN_DIGIT: RegExp = /[0-9]/;

function readLocale(code: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(
      path.join(DASHBOARD, "src/Locales", `${code}.json`),
      "utf8",
    ),
  ) as Record<string, unknown>;
}

// A language as the Dashboard ships it.
function shippedTranslatorFor(code: string): Translator {
  const locale: Record<string, unknown> = readLocale(code);

  return createTranslator((text: string): string | undefined => {
    const value: unknown = locale[text];

    return typeof value === "string" && value !== text ? value : undefined;
  }, code);
}

const BASE: SloNoticeData = {
  isEnabled: true,
  isArchived: false,
  sliType: SliType.MonitorUptime,
  monitorCount: 2,
  serviceCount: 1,
  latencyThresholdInMilliseconds: 300,
  targetPercentage: 99.9,
  lastEvaluatedAt: new Date("2026-09-21T12:00:00.000Z"),
};

// Every notice getSloNotice gives, one input each.
const EVERY_NOTICE: Array<SloNotice> = [
  getSloNotice({ ...BASE, isArchived: true }),
  getSloNotice({ ...BASE, isEnabled: false }),
  getSloNotice({
    ...BASE,
    sliType: SliType.Metric,
    sloStatus: SloStatus.Misconfigured,
  }),
  getSloNotice({
    ...BASE,
    monitorCount: 0,
    sloStatus: SloStatus.Misconfigured,
  }),
  getSloNotice({
    ...BASE,
    sliType: SliType.RequestSuccess,
    serviceCount: 0,
    sloStatus: SloStatus.Misconfigured,
  }),
  getSloNotice({
    ...BASE,
    sliType: SliType.RequestLatency,
    latencyThresholdInMilliseconds: null,
    sloStatus: SloStatus.Misconfigured,
  }),
  getSloNotice({
    ...BASE,
    targetPercentage: 100,
    sloStatus: SloStatus.Misconfigured,
  }),
  getSloNotice({
    ...BASE,
    sliType: SliType.RequestSuccess,
    sloStatus: SloStatus.Misconfigured,
  }),
  getSloNotice({ ...BASE, sloStatus: SloStatus.Misconfigured }),
  getSloNotice({
    ...BASE,
    sloStatus: SloStatus.Misconfigured,
    isWaitingForFirstCheck: true,
  }),
  getSloNotice({ ...BASE, sloStatus: SloStatus.Paused }),
  getSloNotice({ ...BASE, lastEvaluatedAt: null }),
].map((notice: SloNotice | null): SloNotice => {
  return notice!;
});

const TARGET_NOTICE: SloNotice = EVERY_NOTICE.find((notice: SloNotice) => {
  return Boolean(notice.bodyTemplate);
})!;

describe("an SLO's banners, in English", () => {
  test("read exactly as they did before they were keys", () => {
    for (const notice of EVERY_NOTICE) {
      expect(getSloNoticeBodyInLanguage(notice, ENGLISH)).toBe(notice.body);
      expect(getSloNoticeActionLabelInLanguage(notice, ENGLISH)).toBe(
        notice.action ? notice.action.label : null,
      );
    }
  });

  test("the target sentence is the template filled with English figures", () => {
    expect(getSloNoticeBodyInLanguage(TARGET_NOTICE, ENGLISH)).toBe(
      "A target must be greater than 0 and less than 100 — a 100% target leaves no error budget to track. Set a target such as 99.9 in Settings.",
    );
  });
});

describe("an SLO's banners in every Dashboard language", () => {
  test.each(DASHBOARD_LANGUAGES)(
    "%s words every title, sentence and link",
    (code: string) => {
      const locale: Record<string, unknown> = readLocale(code);
      const untranslated: Array<string> = [];

      for (const notice of EVERY_NOTICE) {
        for (const key of [
          notice.title,
          notice.bodyTemplate || notice.body,
          ...(notice.action ? [notice.action.label] : []),
        ]) {
          const value: unknown = locale[key];

          if (typeof value !== "string" || value === key) {
            untranslated.push(key);
          }
        }
      }

      expect({ code, untranslated }).toEqual({ code, untranslated: [] });
    },
  );

  test.each(DASHBOARD_LANGUAGES)(
    "%s writes the target sentence's figures its own way, every placeholder filled",
    (code: string) => {
      const translator: Translator = shippedTranslatorFor(code);
      const sentence: string = getSloNoticeBodyInLanguage(
        TARGET_NOTICE,
        translator,
      );

      expect(sentence).not.toContain("{{");
      expect(sentence).not.toBe(TARGET_NOTICE.body);
      // 99.9 as the language writes it: "99,9" in German, "۹۹٫۹" in Persian.
      expect(sentence).toContain(
        formatSloNumber(99.9, 3, translator) as string,
      );
      expect(sentence).toContain(
        formatSloPercent(100, 3, translator) as string,
      );

      if (OWN_DIGIT_LANGUAGES.includes(code)) {
        expect({ code, sentence, latin: LATIN_DIGIT.test(sentence) }).toEqual({
          code,
          sentence,
          latin: false,
        });
      }
    },
  );

  test.each(DASHBOARD_LANGUAGES)(
    "%s's other sentences are its own words for each notice",
    (code: string) => {
      const translator: Translator = shippedTranslatorFor(code);

      for (const notice of EVERY_NOTICE) {
        if (notice.bodyTemplate) {
          continue;
        }

        expect(getSloNoticeBodyInLanguage(notice, translator)).not.toBe(
          notice.body,
        );
      }
    },
  );
});

describe("a request SLO's budget line in every Dashboard language", () => {
  const LINES: Array<{
    sliType: SliType;
    remainingEvents: number;
  }> = [
    { sliType: SliType.RequestSuccess, remainingEvents: 1200 },
    { sliType: SliType.RequestSuccess, remainingEvents: 1 },
    { sliType: SliType.RequestLatency, remainingEvents: 1200 },
    { sliType: SliType.RequestSuccess, remainingEvents: -1200 },
    { sliType: SliType.RequestLatency, remainingEvents: -1 },
  ];

  test("reads as the English widgets say it", () => {
    expect(
      LINES.map((line: { sliType: SliType; remainingEvents: number }) => {
        return formatErrorBudgetRemainingRequests(line, ENGLISH);
      }),
    ).toEqual([
      "1,200 failed requests remaining",
      "1 failed request remaining",
      "1,200 slow requests remaining",
      "1,200 failed requests over budget",
      "1 slow request over budget",
    ]);
  });

  test.each(DASHBOARD_LANGUAGES)(
    "%s words each line and counts its requests in its own digits",
    (code: string) => {
      const translator: Translator = shippedTranslatorFor(code);
      const thousands: string = translator.formatNumber(1200);

      for (const line of LINES) {
        const english: string = formatErrorBudgetRemainingRequests(
          line,
          ENGLISH,
        ) as string;
        const worded: string = formatErrorBudgetRemainingRequests(
          line,
          translator,
        ) as string;

        expect({ code, english, worded }).not.toEqual({
          code,
          english,
          worded: english,
        });
        expect(worded).not.toContain("{{");

        if (Math.abs(line.remainingEvents) === 1200) {
          expect(worded).toContain(thousands);
        }

        if (OWN_DIGIT_LANGUAGES.includes(code)) {
          expect(LATIN_DIGIT.test(worded)).toBe(false);
        }
      }
    },
  );
});
