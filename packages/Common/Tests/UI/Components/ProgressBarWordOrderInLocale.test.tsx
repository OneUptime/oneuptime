import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import { createInstance, i18n } from "i18next";
import fs from "fs";
import path from "path";
import React from "react";
import { I18nextProvider } from "react-i18next";
import ProgressBar from "../../../UI/Components/ProgressBar/ProgressBar";

/*
 * THE PROGRESS BAR'S WORD ORDER IN EVERY LANGUAGE (#6150's review).
 *
 * The bar says "3 of 7 recommended monitors created": a count, a total and
 * the caller's words for what is counted (its suffix). Hindi put the suffix
 * between the total and "में से" (out of) - "7 recommended monitors में से
 * 3" - so the suffix described the total, not what was counted: the
 * Recommendations bar's "created" had been dropped to make it read at all
 * ("7 सुझाए गए मॉनिटरों में से 3", out of 7 suggested monitors, 3), and the
 * Data Security bar read "out of 7 checked stores, 3". Korean did the same
 * before its total ("생성된 권장 모니터 7개 중 3개", 3 of the 7 created
 * monitors), and so did the Japanese bar's label for assistive technology.
 *
 * Hindi now says "7 में से 3 सुझाए गए मॉनिटर बनाए गए" (out of 7, 3 suggested
 * monitors created): the suffix follows the count. Korean, like Japanese and
 * Chinese, writes the suffix as a label before the numbers ("생성된 권장
 * 모니터: 7개 중 3개"), and the labels for assistive technology follow. Every
 * other language already put the suffix after the count. Both dashboards
 * hold the two sentences, worded alike. The callers' suffixes were reworded
 * where a language's order needs it.
 */

const FEATURE_SETS: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet",
);

const APPS: ReadonlyArray<string> = ["Dashboard", "AdminDashboard"];

const LANGUAGES: ReadonlyArray<string> = [
  "de",
  "fr",
  "es",
  "it",
  "pt",
  "nl",
  "da",
  "no",
  "sv",
  "ru",
  "ja",
  "ko",
  "zh-CN",
  "zh-TW",
  "hi",
  "fa",
];

const LINE: string = "{{count}} of {{total}} {{suffix}}";
const LABEL: string =
  "Progress: {{count}} of {{total}} {{suffix}} ({{percent}}%)";

const SUFFIX: string = "{{suffix}}";

/*
 * A label ends where its words do: at a colon, full-width or not, or at a
 * closing bracket and a colon ("進捗（{{suffix}}）: ...").
 */
const LABEL_END: RegExp = /^[)）]?\s*[:：]/;

function readLocale(app: string, language: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(
      path.join(FEATURE_SETS, app, "src", "Locales", `${language}.json`),
      "utf8",
    ),
  ) as Record<string, string>;
}

/*
 * Whether a template's suffix names what is counted: it follows the count,
 * or it is a label before the numbers - ended by a colon, or standing
 * right before the count. Never before the total alone, where it describes
 * the total ("7 created monitors").
 */
function suffixNamesWhatIsCounted(template: string): boolean {
  const suffixAt: number = template.indexOf(SUFFIX);
  const countAt: number = template.indexOf("{{count}}");

  if (suffixAt > countAt) {
    return true;
  }

  const after: string = template.slice(suffixAt + SUFFIX.length).trimStart();

  return LABEL_END.test(after) || after.startsWith("{{count}}");
}

describe("the rule reads the orders it is meant to", () => {
  test.each([
    LINE,
    LABEL,
    "{{total}} में से {{count}} {{suffix}}",
    "{{suffix}}: {{total}} 件中 {{count}} 件",
    "{{suffix}}：{{count}} / {{total}}",
    "进度：{{suffix}} {{count}} / {{total}}（{{percent}}%）",
    "進捗（{{suffix}}）: {{total}} 件中 {{count}} 件 ({{percent}}%)",
    "{{count}} از {{total}} ({{suffix}})",
  ])("passes %s", (template: string) => {
    expect(suffixNamesWhatIsCounted(template)).toBe(true);
  });

  test.each([
    // Hindi and Korean as they were, and the Japanese label.
    "{{total}} {{suffix}} में से {{count}}",
    "प्रगति: {{total}} {{suffix}} में से {{count}} ({{percent}}%)",
    "{{suffix}} {{total}}개 중 {{count}}개",
    "진행률: {{suffix}} {{total}}개 중 {{count}}개 ({{percent}}%)",
    "進捗: {{suffix}} {{total}} 件中 {{count}} 件 ({{percent}}%)",
  ])("catches %s", (template: string) => {
    expect(suffixNamesWhatIsCounted(template)).toBe(false);
  });
});

describe.each(APPS)("the %s's progress sentences", (app: string) => {
  test.each(LANGUAGES)(
    "%s names what is counted after the count, or as a label before the numbers",
    (language: string) => {
      const locale: Record<string, string> = readLocale(app, language);

      for (const key of [LINE, LABEL]) {
        const template: string = locale[key]!;

        expect(typeof template).toBe("string");
        expect(template).not.toBe(key);

        for (const placeholder of ["{{count}}", "{{total}}", SUFFIX]) {
          expect({
            language,
            key,
            uses: template.split(placeholder).length,
          }).toEqual({ language, key, uses: 2 });
        }

        expect({
          language,
          template,
          names: suffixNamesWhatIsCounted(template),
        }).toEqual({ language, template, names: true });
      }
    },
  );
});

describe("both dashboards word the bar alike", () => {
  test.each(LANGUAGES)("%s", (language: string) => {
    const dashboard: Record<string, string> = readLocale("Dashboard", language);
    const admin: Record<string, string> = readLocale(
      "AdminDashboard",
      language,
    );

    expect([admin[LINE], admin[LABEL]]).toEqual([
      dashboard[LINE],
      dashboard[LABEL],
    ]);
  });
});

describe("the bar as a Hindi, Korean and Japanese reader reads it", () => {
  const instances: Record<string, i18n> = {};

  beforeAll(async () => {
    for (const language of ["hi", "ko", "ja"]) {
      const instance: i18n = createInstance();

      await instance.init({
        lng: language,
        fallbackLng: "en",
        resources: {
          [language]: { translation: readLocale("Dashboard", language) },
        },
        interpolation: { escapeValue: false },
        keySeparator: false,
        nsSeparator: false,
      });

      instances[language] = instance;
    }
  });

  afterEach(() => {
    cleanup();
  });

  function drawBar(
    language: string,
    data: { count: number; total: number; suffix: string },
  ): void {
    render(
      <I18nextProvider i18n={instances[language]!}>
        <ProgressBar
          count={data.count}
          totalCount={data.total}
          suffix={data.suffix}
        />
      </I18nextProvider>,
    );
  }

  test.each([
    ["recommended monitors created", "7 में से 3 सुझाए गए मॉनिटर बनाए गए"],
    ["stores checked", "7 में से 3 स्टोर जांचे गए"],
    [
      "stores with their content scanned",
      "7 में से 3 स्टोर की सामग्री स्कैन की गई",
    ],
    ["steps completed", "7 में से 3 चरण पूरे हुए"],
    ["essential steps done", "7 में से 3 ज़रूरी चरण पूरे हुए"],
    ["monitors", "7 में से 3 मॉनिटर"],
  ])(
    "Hindi: out of the total, the count, then what it counts (%s)",
    (suffix: string, sentence: string) => {
      drawBar("hi", { count: 3, total: 7, suffix });

      expect(screen.getByTestId("progress-bar-count").textContent).toBe(
        sentence,
      );
    },
  );

  test("Hindi: the bar's label for assistive technology says the same, then the percent", () => {
    drawBar("hi", {
      count: 3,
      total: 7,
      suffix: "recommended monitors created",
    });

    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-label",
      "प्रगति: 7 में से 3 सुझाए गए मॉनिटर बनाए गए (43%)",
    );
  });

  test("Korean: what is counted is a label before the numbers", () => {
    drawBar("ko", {
      count: 3,
      total: 7,
      suffix: "recommended monitors created",
    });

    expect(screen.getByTestId("progress-bar-count").textContent).toBe(
      "생성된 권장 모니터: 7개 중 3개",
    );
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-label",
      "진행률(생성된 권장 모니터): 7개 중 3개 (43%)",
    );
  });

  test("Japanese: the label for assistive technology names what is counted before the numbers", () => {
    drawBar("ja", { count: 3, total: 7, suffix: "stores checked" });

    expect(screen.getByTestId("progress-bar-count").textContent).toBe(
      "チェック済みのデータストア: 7 件中 3 件",
    );
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-label",
      "進捗（チェック済みのデータストア）: 7 件中 3 件 (43%)",
    );
  });
});
