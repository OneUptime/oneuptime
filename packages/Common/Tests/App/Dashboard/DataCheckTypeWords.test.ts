import { describe, expect, test } from "@jest/globals";
import {
  DATA_CHECK_TYPE_LABELS,
  getDataCheckTypeLabel,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DataObservability/DataCheckTypeWords";
import { DataCheckType } from "../../../Types/DataObservability/DataCheckType";
import {
  DataReconciliationMeasure,
  getMeasureCheckType,
} from "../../../Types/DataObservability/DataReconciliation";
import { Translator } from "../../../Types/Translator";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  isWordedInDashboardLocale,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";

/*
 * WHAT A CHECK MEASURES, BY NAME, IN THE READER'S WORDS (#7223).
 *
 * A check's type is saved as its English name, and the Checks tab drew that
 * value as it is: Null Percent, Orphan Count and the rest read English in
 * the Check dropdown, the list's Check filter, the line under each check's
 * name and each suggested check's facts, in every language - no locale
 * file held most of the names. Each type now has its name as a key every
 * language words (DataCheckTypeWords), and what is saved stays the value.
 */

const ENGLISH: Record<string, string> = readDashboardLocale("en");

const EVERY_TYPE: Array<DataCheckType> = Object.values(DataCheckType);

// The names most languages left English before #7223, or had no key for.
const NEWLY_WORDED: Array<DataCheckType> = [
  DataCheckType.NullPercent,
  DataCheckType.DuplicatePercent,
  DataCheckType.DistinctCount,
  DataCheckType.InvalidPercent,
  DataCheckType.FormatMismatchPercent,
  DataCheckType.OrphanCount,
  DataCheckType.RowCount,
  DataCheckType.DbtTest,
];

// The languages that leave a type's name unworded: what the reader sees in English.
function languagesLeavingUnworded(label: string): Array<string> {
  return DASHBOARD_LANGUAGES.filter((language: string): boolean => {
    return !isWordedInDashboardLocale(label, language);
  });
}

describe("a name for every type a check has", () => {
  test("none left out, and nothing else", () => {
    expect(Object.keys(DATA_CHECK_TYPE_LABELS).sort()).toEqual(
      [...EVERY_TYPE].sort(),
    );
  });

  test("each name is the type's own English value: English reads as before, and the key is what a check is saved with", () => {
    for (const type of EVERY_TYPE) {
      expect(DATA_CHECK_TYPE_LABELS[type]).toBe(type);
    }
  });

  test("each is a key of the Dashboard's English file", () => {
    for (const type of EVERY_TYPE) {
      expect({ type, english: ENGLISH[DATA_CHECK_TYPE_LABELS[type]] }).toEqual({
        type,
        english: type,
      });
    }
  });

  test("each is worded in every language the Dashboard is read in", () => {
    expect(DASHBOARD_LANGUAGES).toHaveLength(17);

    for (const type of EVERY_TYPE) {
      expect({
        type,
        unworded: languagesLeavingUnworded(DATA_CHECK_TYPE_LABELS[type]),
      }).toEqual({ type, unworded: [] });
    }
  });

  test("the names this change words are each the language's own, never the English kept", () => {
    for (const type of NEWLY_WORDED) {
      for (const language of DASHBOARD_LANGUAGES) {
        const drawn: string | undefined = readDashboardLocale(language)[type];

        expect({ type, language, english: drawn === type }).toEqual({
          type,
          language,
          english: false,
        });
      }
    }
  });

  test("the check above catches a name a language left English, and one no file holds", () => {
    const german: Record<string, string> = readDashboardLocale("de");
    const worded: string = german[DataCheckType.NullPercent]!;

    try {
      // The German file as it was before #7223: Null Percent had no key.
      delete german[DataCheckType.NullPercent];
      expect(languagesLeavingUnworded(DataCheckType.NullPercent)).toEqual([
        "de",
      ]);

      // And with the key, left English: as Row Count was in most files.
      german[DataCheckType.NullPercent] = DataCheckType.NullPercent;
      expect(languagesLeavingUnworded(DataCheckType.NullPercent)).toEqual([
        "de",
      ]);
    } finally {
      german[DataCheckType.NullPercent] = worded;
    }

    expect(languagesLeavingUnworded(DataCheckType.NullPercent)).toEqual([]);
    expect(languagesLeavingUnworded("Null Percentage")).toEqual(
      DASHBOARD_LANGUAGES,
    );
  });
});

describe("getDataCheckTypeLabel", () => {
  test("in English, each type reads exactly as it is saved", () => {
    const translator: Translator = dashboardTranslator("en");

    for (const type of EVERY_TYPE) {
      expect(getDataCheckTypeLabel({ translator, checkType: type })).toBe(type);
    }
  });

  test.each([
    ["de", DataCheckType.NullPercent, "Anteil NULL-Werte"],
    ["de", DataCheckType.RowCount, "Zeilenanzahl"],
    ["fr", DataCheckType.OrphanCount, "Nombre de lignes orphelines"],
    ["ja", DataCheckType.FormatMismatchPercent, "形式不一致の割合"],
    ["ar", DataCheckType.DuplicatePercent, "نسبة التكرار"],
    ["fa", DataCheckType.RowCount, "تعداد سطرها"],
  ])("in %s, %s reads %j", (language: string, type: string, drawn: string) => {
    expect(
      getDataCheckTypeLabel({
        translator: dashboardTranslator(language),
        checkType: type,
      }),
    ).toBe(drawn);
  });

  test("in every language, each type reads as the language's file words it", () => {
    for (const language of DASHBOARD_LANGUAGES) {
      const words: Record<string, string> = readDashboardLocale(language);
      const translator: Translator = dashboardTranslator(language);

      for (const type of EVERY_TYPE) {
        expect({
          language,
          type,
          drawn: getDataCheckTypeLabel({ translator, checkType: type }),
        }).toEqual({ language, type, drawn: words[type] });
      }
    }
  });

  test("a value that is no type a check has is drawn as it is, and none as nothing", () => {
    const translator: Translator = dashboardTranslator("de");

    expect(
      getDataCheckTypeLabel({ translator, checkType: "Made Up Percent" }),
    ).toBe("Made Up Percent");
    // A word of the file that is not a type stays a value, not a translation.
    expect(getDataCheckTypeLabel({ translator, checkType: "Average " })).toBe(
      "Average ",
    );
    expect(getDataCheckTypeLabel({ translator, checkType: "toString" })).toBe(
      "toString",
    );
    expect(getDataCheckTypeLabel({ translator, checkType: undefined })).toBe(
      "",
    );
    expect(getDataCheckTypeLabel({ translator, checkType: null })).toBe("");
  });
});

describe("a reconciliation's measures", () => {
  test("each is named as the check that reads it, so the Measure dropdown and the list draw the same words", () => {
    for (const measure of Object.values(DataReconciliationMeasure)) {
      expect(measure).toBe(
        DATA_CHECK_TYPE_LABELS[getMeasureCheckType(measure)],
      );
    }
  });
});
