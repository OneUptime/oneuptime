/** @timezone UTC */
import "@testing-library/jest-dom";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import fs from "fs";
import { createInstance, i18n } from "i18next";
import path from "path";
import React, { ReactElement } from "react";
import { I18nextProvider } from "react-i18next";
import InBetween from "../../../../Types/BaseDatabase/InBetween";
import GenericObject from "../../../../Types/GenericObject";
import {
  getWordOfMeaningKey,
  MEANING_KEYS,
} from "../../../../Types/MeaningKeys";
import CustomTimeRangeModal from "../../../../UI/Components/Date/CustomTimeRangeModal";
import DateFilter from "../../../../UI/Components/Filters/DateFilter";
import NumberFilter from "../../../../UI/Components/Filters/NumberFilter";
import {
  RANGE_END,
  RANGE_START,
} from "../../../../UI/Components/Filters/RangeEnds";
import Filter from "../../../../UI/Components/Filters/Types/Filter";
import FilterData from "../../../../UI/Components/Filters/Types/FilterData";
import FieldType from "../../../../UI/Components/Types/FieldType";
import {
  DASHBOARD_LANGUAGES,
  readDashboardLocale,
  readDashboardLocaleAsDrawn,
} from "../../../Helpers/DashboardLocales";

/*
 * A RANGE'S TWO ENDS ARE ITS START AND ITS END, NEVER A MESSAGE'S SENDER
 * AND RECIPIENT (#8201).
 *
 * A key is its English text, and the bare "From" and "To" head the
 * notification logs' sender and recipient columns, so most languages worded
 * them so. A date filter's "is between" read "Von" ... "An" (to someone) in
 * German, 差出人 (sender) ... 宛先 (addressee) in Japanese, 보낸 사람 ... 받는
 * 사람 in Korean; so did a number filter's, the custom time range, a
 * dashboard's time range and a facet's date range. A range's ends have keys
 * of their own (RangeEnds, listed in MeaningKeys), worded as the start and
 * end of a span, and English still reads "From" and "To".
 */

const REPOSITORY_ROOT: string = path.resolve(__dirname, "../../../../../..");

// A range's start and end, as each language words them.
const RANGE_WORDS: Record<string, { from: string; to: string }> = {
  de: { from: "Von", to: "Bis" },
  fr: { from: "De", to: "À" },
  es: { from: "Desde", to: "Hasta" },
  it: { from: "Da", to: "A" },
  pt: { from: "De", to: "Até" },
  nl: { from: "Van", to: "Tot" },
  da: { from: "Fra", to: "Til" },
  no: { from: "Fra", to: "Til" },
  sv: { from: "Från", to: "Till" },
  ru: { from: "От", to: "До" },
  ja: { from: "開始", to: "終了" },
  ko: { from: "시작", to: "종료" },
  "zh-CN": { from: "开始", to: "结束" },
  "zh-TW": { from: "開始", to: "結束" },
  hi: { from: "से", to: "तक" },
  fa: { from: "از", to: "تا" },
  ar: { from: "من", to: "إلى" },
};

/*
 * The languages whose bare "To" is a message's recipient: there a range's
 * end must not read as the bare word (the issue's list).
 */
const TO_IS_A_RECIPIENT: ReadonlyArray<string> = [
  "de",
  "nl",
  "es",
  "pt",
  "ru",
  "ja",
  "ko",
  "zh-CN",
  "zh-TW",
  "hi",
  "fa",
];

// And those whose bare "From" is a message's sender.
const FROM_IS_A_SENDER: ReadonlyArray<string> = ["ja", "ko", "zh-TW"];

const RENDERED_LANGUAGES: ReadonlyArray<string> = ["en", "de", "ar", "fa"];

const instances: Record<string, i18n> = {};

beforeAll(async () => {
  for (const code of RENDERED_LANGUAGES) {
    const instance: i18n = createInstance();

    await instance.init({
      lng: code,
      fallbackLng: "en",
      resources: {
        [code]: { translation: readDashboardLocaleAsDrawn(code) },
        en: { translation: readDashboardLocale("en") },
      },
      interpolation: { escapeValue: false },
      keySeparator: false,
      nsSeparator: false,
    });

    instances[code] = instance;
  }
});

afterEach(() => {
  cleanup();
});

function expectedWords(code: string): { from: string; to: string } {
  return code === "en"
    ? { from: "From", to: "To" }
    : (RANGE_WORDS[code] as { from: string; to: string });
}

function inLanguage(code: string, element: ReactElement): void {
  render(
    <I18nextProvider i18n={instances[code] as i18n}>{element}</I18nextProvider>,
  );
}

function placeholders(selector: string): Array<string> {
  return Array.from(document.querySelectorAll(selector)).map(
    (input: Element): string => {
      return input.getAttribute("placeholder") || "";
    },
  );
}

type Row = GenericObject & { startsAt?: Date; count?: number };

const STARTS_AT: Filter<Row> = {
  key: "startsAt",
  title: "Starts At",
  type: FieldType.DateTime,
} as unknown as Filter<Row>;

const COUNT: Filter<Row> = {
  key: "count",
  title: "Count",
  type: FieldType.Number,
} as unknown as Filter<Row>;

describe("a range's ends have keys of their own", () => {
  test("English reads them as From and To", () => {
    expect(RANGE_START).toBe("From (range start)");
    expect(RANGE_END).toBe("To (range end)");
    expect(MEANING_KEYS).toEqual(
      expect.arrayContaining([RANGE_START, RANGE_END]),
    );
    expect(getWordOfMeaningKey(RANGE_START)).toBe("From");
    expect(getWordOfMeaningKey(RANGE_END)).toBe("To");
  });

  test("every language words them as the start and end of a span", () => {
    expect(Object.keys(RANGE_WORDS).sort()).toEqual(
      [...DASHBOARD_LANGUAGES].sort(),
    );

    for (const language of DASHBOARD_LANGUAGES) {
      const locale: Record<string, string> = readDashboardLocale(language);

      expect({
        language,
        from: locale[RANGE_START],
        to: locale[RANGE_END],
      }).toEqual({ language, ...RANGE_WORDS[language] });
    }
  });

  test("where the bare To is a recipient and From a sender, a range's ends are not", () => {
    for (const language of TO_IS_A_RECIPIENT) {
      const locale: Record<string, string> = readDashboardLocale(language);

      expect({
        language,
        sameAsRecipient: locale[RANGE_END] === locale["To"],
      }).toEqual({ language, sameAsRecipient: false });
    }

    for (const language of FROM_IS_A_SENDER) {
      const locale: Record<string, string> = readDashboardLocale(language);

      expect({
        language,
        sameAsSender: locale[RANGE_START] === locale["From"],
      }).toEqual({ language, sameAsSender: false });
    }

    // Japanese, as the issue saw it: 宛先 (addressee) over a date field.
    expect(readDashboardLocale("ja")["To"]).toBe("宛先");
    expect(readDashboardLocale("ja")[RANGE_END]).toBe("終了");
  });

  test("the Admin Dashboard, which draws the same filters, words them alike", () => {
    for (const language of DASHBOARD_LANGUAGES) {
      const admin: Record<string, string> = JSON.parse(
        fs.readFileSync(
          path.join(
            REPOSITORY_ROOT,
            "packages/App/FeatureSet/AdminDashboard/src/Locales",
            `${language}.json`,
          ),
          "utf8",
        ),
      ) as Record<string, string>;

      expect({
        language,
        from: admin[RANGE_START],
        to: admin[RANGE_END],
      }).toEqual({ language, ...RANGE_WORDS[language] });
    }
  });
});

describe.each(RENDERED_LANGUAGES)("in %s", (code: string) => {
  test("a date filter's is between names its fields From and To, as a range's ends", () => {
    inLanguage(
      code,
      <DateFilter<Row>
        filter={STARTS_AT}
        filterData={
          {
            startsAt: new InBetween<Date>(
              new Date("2026-11-13T09:00:00.000Z"),
              new Date("2026-11-13T17:30:00.000Z"),
            ),
          } as FilterData<Row>
        }
        onFilterChanged={() => {}}
      />,
    );

    const words: { from: string; to: string } = expectedWords(code);

    expect(placeholders('input[type="datetime-local"]')).toEqual([
      words.from,
      words.to,
    ]);
  });

  test("a number filter's is between does too", () => {
    inLanguage(
      code,
      <NumberFilter<Row>
        filter={COUNT}
        filterData={{ count: new InBetween<number>(1, 5) } as FilterData<Row>}
        onFilterChanged={() => {}}
      />,
    );

    const words: { from: string; to: string } = expectedWords(code);

    expect(placeholders('input[type="number"]')).toEqual([
      words.from,
      words.to,
    ]);
  });

  test("a custom time range labels its two fields and its summary so", () => {
    inLanguage(
      code,
      <CustomTimeRangeModal
        initialValue={
          new InBetween<Date>(
            new Date("2026-11-13T09:00:00.000Z"),
            new Date("2026-11-13T17:30:00.000Z"),
          )
        }
        onClose={() => {}}
        onSave={() => {}}
      />,
    );

    const words: { from: string; to: string } = expectedWords(code);

    expect(screen.getByLabelText(words.from)).toBe(
      screen.getByTestId("custom-time-range-start"),
    );
    expect(screen.getByLabelText(words.to)).toBe(
      screen.getByTestId("custom-time-range-end"),
    );

    const summary: HTMLElement = screen.getByTestId(
      "custom-time-range-summary",
    );

    expect(summary).toHaveTextContent(words.from);
    expect(summary).toHaveTextContent(words.to);
  });
});

/*
 * The components that draw a range's ends, read for the bare words: a new
 * "From" or "To" there, looked up or handed to a field that looks it up,
 * reads as a sender or a recipient in most languages.
 */
const RANGE_FILES: ReadonlyArray<string> = [
  "packages/Common/UI/Components/Filters/DateFilter.tsx",
  "packages/Common/UI/Components/Filters/NumberFilter.tsx",
  "packages/Common/UI/Components/Date/RangeStartAndEndDateEdit.tsx",
  "packages/Common/UI/Components/Date/CustomTimeRangeModal.tsx",
  "packages/App/FeatureSet/Dashboard/src/Components/ResourceOwners/FilterChipDateRange.tsx",
  "packages/App/FeatureSet/Dashboard/src/Pages/NetworkSite/View/StatusTimeline.tsx",
  "packages/App/FeatureSet/Dashboard/src/Utils/InvestigationEvidenceFormat.ts",
];

// A bare "From" or "To" in code, a comment's words aside.
const BARE_RANGE_WORD: RegExp = /(?:^|[^\w])["'](?:From|To)["']/;

function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

describe("no range is drawn with the bare From or To", () => {
  test.each(RANGE_FILES)("%s", (file: string) => {
    const source: string = withoutComments(
      fs.readFileSync(path.join(REPOSITORY_ROOT, file), "utf8"),
    );

    expect({ file, bare: BARE_RANGE_WORD.test(source) }).toEqual({
      file,
      bare: false,
    });
  });

  test("the check finds them (negative control)", () => {
    for (const bare of [
      'translator.translateText("From")',
      'placeholder="To"',
      "{translateString('To')}",
      'title: "From",',
    ]) {
      expect({ bare, found: BARE_RANGE_WORD.test(bare) }).toEqual({
        bare,
        found: true,
      });
    }

    for (const fine of [
      "translator.translateText(RANGE_START)",
      'title: "From (range start)",',
      'label: "Until",',
      '// "From" or "Filter by {{field}}"',
    ]) {
      expect({
        fine,
        found: BARE_RANGE_WORD.test(withoutComments(fine)),
      }).toEqual({ fine, found: false });
    }
  });

  test("a message's sender and recipient keep the bare words", () => {
    // The notification logs' columns: who sent it and who it went to.
    for (const file of [
      "packages/App/FeatureSet/Dashboard/src/Components/NotificationLogs/EmailLogsTable.tsx",
      "packages/App/FeatureSet/Dashboard/src/Components/NotificationLogs/SmsLogsTable.tsx",
    ]) {
      const source: string = fs.readFileSync(
        path.join(REPOSITORY_ROOT, file),
        "utf8",
      );

      expect({ file, to: source.includes('title: "To"') }).toEqual({
        file,
        to: true,
      });
    }
  });
});
