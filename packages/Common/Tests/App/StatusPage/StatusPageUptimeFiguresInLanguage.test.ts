// UX rule: Docs/ux/README.md#numbers-dates-and-plurals
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  formatUptimePercentFigure,
  UPTIME_FIGURE_MAX_DECIMALS,
} from "../../../../App/FeatureSet/StatusPage/src/Utils/UptimeFigure";

/*
 * A STATUS PAGE'S UPTIME FIGURES, IN THE PAGE'S LANGUAGE (#8292).
 *
 * A group's uptime, a grid cell's average and the overall banner handed the
 * "overview.uptimePercent" sentence the figure as the code wrote it, and
 * the sentence put its own "%" after it: "99.95٪ زمان کارکرد" on a Persian
 * page, "99.95% Verfügbarkeit" on a German one, where German writes "99,95
 * %". The figure is written in the page's digits, decimal sign and percent
 * sign now (formatUptimePercentFigure), and every language's sentence takes
 * it whole. English reads exactly as it did: "99.95% uptime".
 */

const STATUS_PAGE_LOCALES: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/StatusPage/src/Locales",
);

const LANGUAGES: Array<string> = fs
  .readdirSync(STATUS_PAGE_LOCALES)
  .filter((name: string): boolean => {
    return name.endsWith(".json");
  })
  .map((name: string): string => {
    return name.slice(0, -".json".length);
  })
  .sort();

const LATIN_DIGIT: RegExp = /[0-9]/;
// A percent sign: the Latin one, or Persian's (U+066A).
const PERCENT_SIGN: RegExp = /[%٪]/u;
const PERCENT_SIGNS: RegExp = /[%٪]/gu;

function uptimeSentenceOf(language: string): string {
  const locale: { overview: { uptimePercent: string } } = JSON.parse(
    fs.readFileSync(path.join(STATUS_PAGE_LOCALES, `${language}.json`), "utf8"),
  );

  return locale.overview.uptimePercent;
}

// The sentence as the page draws it, its figure filled in.
function sentenceWith(language: string, percent: string): string {
  return uptimeSentenceOf(language).replace("{{percent}}", percent);
}

// No-break spaces read as spaces, and no direction marks.
function spaced(text: string): string {
  return text.replace(/[\u00a0\u202f]/g, " ").replace(/[\u200e\u200f]/g, "");
}

describe("an uptime figure, in the page's language", () => {
  test("English reads exactly as the code wrote it", () => {
    // String(99.95), String(100), String(99.9): the group and the banner.
    expect(formatUptimePercentFigure(99.95, "en")).toBe("99.95%");
    expect(formatUptimePercentFigure(100, "en")).toBe("100%");
    expect(formatUptimePercentFigure(99.9, "en")).toBe("99.9%");
    expect(formatUptimePercentFigure(99.999, "en")).toBe("99.999%");
    expect(formatUptimePercentFigure(0, "en")).toBe("0%");
    // avg.toFixed(2): the grid's average.
    expect(formatUptimePercentFigure(99.9, "en", { decimals: 2 })).toBe(
      "99.90%",
    );
    expect(formatUptimePercentFigure(100, "en", { decimals: 2 })).toBe(
      "100.00%",
    );
    expect(formatUptimePercentFigure(99.95, undefined)).toBe("99.95%");
  });

  test("German and French: a decimal comma and a spaced percent sign", () => {
    expect(spaced(formatUptimePercentFigure(99.95, "de"))).toBe("99,95 %");
    expect(spaced(formatUptimePercentFigure(99.9, "de", { decimals: 2 }))).toBe(
      "99,90 %",
    );
    expect(spaced(formatUptimePercentFigure(99.95, "fr"))).toBe("99,95 %");
  });

  test("Persian: Persian digits, decimal sign and percent sign", () => {
    expect(formatUptimePercentFigure(99.95, "fa")).toBe("۹۹٫۹۵٪");
    expect(formatUptimePercentFigure(100, "fa")).toBe("۱۰۰٪");
    expect(formatUptimePercentFigure(99.9, "fa", { decimals: 2 })).toBe(
      "۹۹٫۹۰٪",
    );
  });

  test("Arabic: Latin digits, its own percent sign", () => {
    expect(spaced(formatUptimePercentFigure(99.95, "ar"))).toBe("99.95%");
  });

  test("a figure that is no number reads as a missing one", () => {
    expect(formatUptimePercentFigure(Number.NaN, "fa")).toBe("—");
  });

  test("the figure keeps at most the three decimals an uptime precision keeps", () => {
    expect(UPTIME_FIGURE_MAX_DECIMALS).toBe(3);
    expect(formatUptimePercentFigure(99.12345, "en")).toBe("99.123%");
  });
});

describe("the uptime sentence, in every status page language", () => {
  test("every language's sentence takes the figure whole: no percent sign of its own", () => {
    for (const language of LANGUAGES) {
      const sentence: string = uptimeSentenceOf(language);

      expect({ language, hasFigure: sentence.includes("{{percent}}") }).toEqual(
        { language, hasFigure: true },
      );
      expect({ language, sign: PERCENT_SIGN.test(sentence) }).toEqual({
        language,
        sign: false,
      });
    }
  });

  test("English reads as it always did", () => {
    expect(sentenceWith("en", formatUptimePercentFigure(99.95, "en"))).toBe(
      "99.95% uptime",
    );
    expect(
      sentenceWith(
        "en",
        formatUptimePercentFigure(99.9, "en", { decimals: 2 }),
      ),
    ).toBe("99.90% uptime");
  });

  test("German, Persian, Arabic and Japanese read their own way", () => {
    expect(
      spaced(sentenceWith("de", formatUptimePercentFigure(99.95, "de"))),
    ).toBe("99,95 % Verfügbarkeit");
    expect(sentenceWith("fa", formatUptimePercentFigure(99.95, "fa"))).toBe(
      "۹۹٫۹۵٪ زمان کارکرد",
    );
    expect(
      spaced(sentenceWith("ar", formatUptimePercentFigure(99.95, "ar"))),
    ).toBe("99.95% وقت التشغيل");
    expect(sentenceWith("ja", formatUptimePercentFigure(99.95, "ja"))).toBe(
      "稼働率 99.95%",
    );
  });

  test("a Persian page reads no Latin digit and no doubled sign", () => {
    for (const figure of [
      formatUptimePercentFigure(99.95, "fa"),
      formatUptimePercentFigure(100, "fa"),
      formatUptimePercentFigure(97.5, "fa", { decimals: 2 }),
    ]) {
      const sentence: string = sentenceWith("fa", figure);

      expect(sentence).not.toMatch(LATIN_DIGIT);
      expect(sentence.match(PERCENT_SIGNS)).toHaveLength(1);
    }
  });

  test("every language's figure carries its percent sign once", () => {
    for (const language of LANGUAGES) {
      const sentence: string = sentenceWith(
        language,
        formatUptimePercentFigure(99.95, language),
      );

      expect({
        language,
        signs: sentence.match(PERCENT_SIGNS)?.length,
      }).toEqual({ language, signs: 1 });
    }
  });
});

describe("the status page hands the sentence the figure written in its language", () => {
  const read: (file: string) => string = (file: string): string => {
    return fs.readFileSync(
      path.resolve(
        __dirname,
        "../../../../App/FeatureSet/StatusPage/src",
        file,
      ),
      "utf8",
    );
  };

  test("the Overview and the monitor card write no uptime figure by hand", () => {
    for (const file of [
      "Pages/Overview/Overview.tsx",
      "Components/Monitor/MonitorOverview.tsx",
    ]) {
      const source: string = read(file);
      const sentences: Array<string> =
        source.match(/t\("overview\.uptimePercent",\s*\{[^}]*\}/g) || [];

      expect(sentences.length).toBeGreaterThan(0);

      for (const sentence of sentences) {
        expect({
          file,
          sentence,
          written: sentence.includes("formatUptimePercentFigure"),
        }).toEqual({ file, sentence, written: true });
        expect(sentence).not.toMatch(/String\(|toFixed\(|toString\(/);
      }
    }
  });
});
