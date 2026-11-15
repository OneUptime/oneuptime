import { describe, expect, test } from "@jest/globals";
import {
  DATA_CHECK_FORMAT_LABELS,
  DATA_CHECK_FORMAT_OPTIONS,
  getDataCheckFormatLabel,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DataObservability/DataCheckFormatWords";
import {
  DATA_CHECK_FORMATS,
  DataCheckFormat,
} from "../../../Types/DataObservability/DataCheckFormats";
import { Translator } from "../../../Types/Translator";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  isWordedInDashboardLocale,
  readDashboardLocale,
  readDashboardSameAsEnglish,
} from "../../Helpers/DashboardLocales";

/*
 * THE FORMATS OF A FORMAT MISMATCH CHECK, IN THE READER'S WORDS (#7532).
 *
 * The Format dropdown of a Format Mismatch Percent check was built from the
 * formats' stored values (DataCheckFormat), and the dropdown looks up only
 * what is a key: "ISO Date" was no key at all, so it read English in every
 * language, and "Country Code" was English in eleven Dashboard files. Each
 * format has its name now (DataCheckFormatWords), every one a key every
 * language words; UUID and URL are written as they are, on purpose. And the
 * Settings card Keep Failing Rows kept "Failing Rows" in English in French,
 * Italian, Portuguese and Traditional Chinese, each of which words Failing
 * Rows on its own.
 */

const ENGLISH: Record<string, string> = readDashboardLocale("en");

// The names every language writes as English does: they are the same everywhere.
const WRITTEN_AS_IN_ENGLISH: ReadonlyArray<DataCheckFormat> = [
  DataCheckFormat.Uuid,
  DataCheckFormat.Url,
];

// The languages that left a format's name English, or had no key for it.
function languagesLeavingUnworded(label: string): Array<string> {
  return DASHBOARD_LANGUAGES.filter((language: string): boolean => {
    return !isWordedInDashboardLocale(label, language);
  });
}

describe("a name for every format a check offers", () => {
  test("none left out, and nothing else", () => {
    expect(Object.keys(DATA_CHECK_FORMAT_LABELS).sort()).toEqual(
      [...DATA_CHECK_FORMATS].sort(),
    );
  });

  test("each name is the format's own English value: English reads as before, and what is saved does not change", () => {
    for (const format of DATA_CHECK_FORMATS) {
      expect(DATA_CHECK_FORMAT_LABELS[format]).toBe(format);
    }
  });

  test("each is a key of the Dashboard's English file", () => {
    for (const format of DATA_CHECK_FORMATS) {
      expect({
        format,
        english: ENGLISH[DATA_CHECK_FORMAT_LABELS[format]],
      }).toEqual({ format, english: format });
    }
  });

  test("each is worded in every language the Dashboard is read in", () => {
    expect(DASHBOARD_LANGUAGES).toHaveLength(17);

    for (const format of DATA_CHECK_FORMATS) {
      expect({
        format,
        unworded: languagesLeavingUnworded(DATA_CHECK_FORMAT_LABELS[format]),
      }).toEqual({ format, unworded: [] });
    }
  });

  test("UUID and URL are written as in English on purpose, in every language", () => {
    for (const format of WRITTEN_AS_IN_ENGLISH) {
      for (const language of DASHBOARD_LANGUAGES) {
        expect({
          format,
          language,
          kept: readDashboardSameAsEnglish(language).includes(format),
        }).toEqual({ format, language, kept: true });
      }
    }

    // UUID is the same in every file; Arabic alone says "URL address".
    for (const language of DASHBOARD_LANGUAGES) {
      expect(readDashboardLocale(language)[DataCheckFormat.Uuid]).toBe("UUID");
    }
  });

  test("Country Code and ISO Date are each language's own words, never the English kept", () => {
    for (const format of [
      DataCheckFormat.CountryCode,
      DataCheckFormat.IsoDate,
    ]) {
      for (const language of DASHBOARD_LANGUAGES) {
        const drawn: string | undefined = readDashboardLocale(language)[format];

        expect({ format, language, english: drawn === format }).toEqual({
          format,
          language,
          english: false,
        });
        expect(drawn).toBeTruthy();
      }
    }
  });

  test("every other format is the language's own word, never the English kept", () => {
    for (const format of DATA_CHECK_FORMATS) {
      if (WRITTEN_AS_IN_ENGLISH.includes(format)) {
        continue;
      }

      for (const language of DASHBOARD_LANGUAGES) {
        expect({
          format,
          language,
          english: readDashboardLocale(language)[format] === format,
        }).toEqual({ format, language, english: false });
      }
    }
  });

  test("ISO Date keeps ISO, as the standard is named, in every language", () => {
    for (const language of DASHBOARD_LANGUAGES) {
      expect({
        language,
        drawn: readDashboardLocale(language)[DataCheckFormat.IsoDate],
      }).toEqual({
        language,
        drawn: expect.stringContaining("ISO"),
      });
    }
  });

  test("the check above catches a format a language left English, and one no file holds (negative control)", () => {
    const dutch: Record<string, string> = readDashboardLocale("nl");
    const worded: string = dutch[DataCheckFormat.CountryCode]!;

    try {
      // The Dutch file as it was before #7532: Country Code left English.
      dutch[DataCheckFormat.CountryCode] = DataCheckFormat.CountryCode;
      expect(languagesLeavingUnworded(DataCheckFormat.CountryCode)).toEqual([
        "nl",
      ]);

      // And with no key at all, as ISO Date was in every file.
      delete dutch[DataCheckFormat.CountryCode];
      expect(languagesLeavingUnworded(DataCheckFormat.CountryCode)).toEqual([
        "nl",
      ]);
    } finally {
      dutch[DataCheckFormat.CountryCode] = worded;
    }

    expect(languagesLeavingUnworded(DataCheckFormat.CountryCode)).toEqual([]);
    expect(languagesLeavingUnworded("ISO Date Time")).toEqual([
      ...DASHBOARD_LANGUAGES,
    ]);
  });
});

describe("the Format dropdown's options", () => {
  test("offer every format, in order, each by its name, its value what is saved", () => {
    expect(
      DATA_CHECK_FORMAT_OPTIONS.map((option: { value?: unknown }): unknown => {
        return option.value;
      }),
    ).toEqual([...DATA_CHECK_FORMATS]);
    expect(
      DATA_CHECK_FORMAT_OPTIONS.map((option: { label: string }): string => {
        return option.label;
      }),
    ).toEqual(
      DATA_CHECK_FORMATS.map((format: DataCheckFormat): string => {
        return DATA_CHECK_FORMAT_LABELS[format];
      }),
    );
  });

  test("no option is marked as written: every one is looked up in the reader's language", () => {
    for (const option of DATA_CHECK_FORMAT_OPTIONS) {
      expect((option as { isUserContent?: boolean }).isUserContent).toBeFalsy();
    }
  });
});

describe("getDataCheckFormatLabel", () => {
  test("in English, each format reads exactly as it is saved", () => {
    const translator: Translator = dashboardTranslator("en");

    for (const format of DATA_CHECK_FORMATS) {
      expect(getDataCheckFormatLabel({ translator, format })).toBe(format);
    }
  });

  test.each([
    ["nl", DataCheckFormat.CountryCode, "Landcode"],
    ["nl", DataCheckFormat.IsoDate, "ISO-datum"],
    ["de", DataCheckFormat.IsoDate, "ISO-Datum"],
    ["de", DataCheckFormat.CountryCode, "Ländercode"],
    ["it", DataCheckFormat.CountryCode, "Codice paese"],
    ["ru", DataCheckFormat.CountryCode, "Код страны"],
    ["zh-CN", DataCheckFormat.CountryCode, "国家代码"],
    ["zh-TW", DataCheckFormat.CountryCode, "國家代碼"],
    ["ja", DataCheckFormat.IsoDate, "ISO 日付"],
    ["fr", DataCheckFormat.IsoDate, "Date ISO"],
    ["ar", DataCheckFormat.IsoDate, "تاريخ ISO"],
    ["fa", DataCheckFormat.Uuid, "UUID"],
  ])(
    "in %s, %s reads %j",
    (language: string, format: string, drawn: string) => {
      expect(
        getDataCheckFormatLabel({
          translator: dashboardTranslator(language),
          format,
        }),
      ).toBe(drawn);
    },
  );

  test("in every language, each format reads as the language's file words it", () => {
    for (const language of DASHBOARD_LANGUAGES) {
      const words: Record<string, string> = readDashboardLocale(language);
      const translator: Translator = dashboardTranslator(language);

      for (const format of DATA_CHECK_FORMATS) {
        expect({
          language,
          format,
          drawn: getDataCheckFormatLabel({ translator, format }),
        }).toEqual({ language, format, drawn: words[format] });
      }
    }
  });

  test("a value that is no format is drawn as it is, and none as nothing", () => {
    const translator: Translator = dashboardTranslator("de");

    expect(getDataCheckFormatLabel({ translator, format: "IBAN" })).toBe(
      "IBAN",
    );
    // A word of the file that is no format stays a value, not a translation.
    expect(getDataCheckFormatLabel({ translator, format: "Save" })).toBe(
      "Save",
    );
    expect(getDataCheckFormatLabel({ translator, format: "toString" })).toBe(
      "toString",
    );
    expect(getDataCheckFormatLabel({ translator, format: undefined })).toBe("");
    expect(getDataCheckFormatLabel({ translator, format: null })).toBe("");
  });
});

describe("Keep Failing Rows (#7532)", () => {
  // The four languages that kept "Failing Rows" in English inside it.
  const FIXED: ReadonlyArray<string> = ["fr", "it", "pt", "zh-TW"];

  test("no language keeps Failing Rows in English inside it", () => {
    for (const language of DASHBOARD_LANGUAGES) {
      const drawn: string | undefined =
        readDashboardLocale(language)["Keep Failing Rows"];

      expect(drawn).toBeTruthy();
      expect({ language, drawn }).not.toEqual({
        language,
        drawn: expect.stringMatching(/Failing|Rows/),
      });
    }
  });

  test.each(FIXED)(
    "%s names the rows with its own word for Failing Rows",
    (language: string) => {
      const words: Record<string, string> = readDashboardLocale(language);
      const failingRows: string = words["Failing Rows"]!;

      expect(failingRows).not.toBe("Failing Rows");
      expect(words["Keep Failing Rows"]!.toLocaleLowerCase(language)).toContain(
        failingRows.toLocaleLowerCase(language),
      );
    },
  );

  test("no other value of a language keeps Failing Rows, Country Code or ISO Date in English", () => {
    const LEFT_IN_ENGLISH: RegExp = /Failing Rows|Country Code|ISO Date/;

    for (const language of DASHBOARD_LANGUAGES) {
      const words: Record<string, string> = readDashboardLocale(language);

      for (const key of Object.keys(words)) {
        const value: string = words[key]!;

        if (
          typeof value !== "string" ||
          !LEFT_IN_ENGLISH.test(value) ||
          // A key no Data Observability page draws: a phone number's own field.
          key === "Phone Number Country Code"
        ) {
          continue;
        }

        expect({ language, key, value }).toEqual({
          language,
          key,
          value: "a value in the language's own words",
        });
      }
    }
  });
});
