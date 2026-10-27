import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  PluralTemplate,
  Translator,
  createTranslator,
  translatableTerm,
  translateNamedAction,
} from "Common/UI/Utils/TranslateTemplate";
import {
  SECURITY_CASE_DETECTIONS,
  SECURITY_CASE_DETECTIONS_CLOSED,
  SECURITY_CASE_DETECTIONS_THE_LAST,
  SECURITY_CASE_QUEUE_VIEWS,
  SecurityCaseQueueView,
  SecurityCaseRowMoment,
  getSecurityCaseRowMoment,
} from "../../FeatureSet/Dashboard/src/Components/SecurityCase/SecurityCaseQueueViews";

/*
 * The case lists, worded so they fit their card in every language.
 *
 * Each case's line under its title says how many detections it holds and
 * the time its list is sorted by - "3 detections, the last 9 minutes ago",
 * or on Closed Cases "2 detections, closed 2 days ago". That time was a
 * column of its own, Last Detection or Closed, which ran the German, French,
 * Dutch, Norwegian, Swedish and Russian queues past their card at 1280
 * beside the side menu, the rows' last values under the sticky View and ⋯.
 * The column waits in Customize Columns (SecurityCaseQueuePages pins it).
 *
 * And the list's create button, "Open Security Case": "Open" is not a verb
 * the shared table words itself, so each word was looked up on its own and
 * German read "Öffnen Sicherheitsfall" - the door's open, before the noun.
 * The button and its dialog are whole phrases in every locale.
 *
 * React-free, read from the queue's rules and the locale files.
 */

const LOCALES_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
  "Locales",
);

const LANGUAGES: Array<string> = fs
  .readdirSync(LOCALES_DIR)
  .filter((name: string): boolean => {
    return name.endsWith(".json") && name !== "en.json";
  })
  .map((name: string): string => {
    return name.replace(/\.json$/, "");
  })
  .sort();

// Japanese, Korean and Chinese have no "one" plural form: it is never read.
const NO_ONE_FORM: ReadonlyArray<string> = ["ja", "ko", "zh-CN", "zh-TW"];

function locale(language: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
  ) as Record<string, string>;
}

function translatorFor(language: string): Translator {
  const values: Record<string, string> = locale(language);

  return createTranslator((text: string): string | undefined => {
    return values[text];
  }, language);
}

const NOW: Date = new Date("2026-10-19T12:00:00Z");
const NINE_MINUTES_AGO: Date = new Date(NOW.getTime() - 9 * 60 * 1000);

describe("a case's line under its title", () => {
  test("an open list says when the last detection fired", () => {
    expect(
      getSecurityCaseRowMoment("lastDetectedAt", {
        lastDetectedAt: NINE_MINUTES_AGO,
        closedAt: NOW,
      }),
    ).toEqual({
      template: SECURITY_CASE_DETECTIONS_THE_LAST,
      time: NINE_MINUTES_AGO,
    });
  });

  test("Closed Cases says when the case closed", () => {
    expect(
      getSecurityCaseRowMoment("closedAt", {
        lastDetectedAt: NINE_MINUTES_AGO,
        closedAt: NOW,
      }),
    ).toEqual({ template: SECURITY_CASE_DETECTIONS_CLOSED, time: NOW });
  });

  test("a case with no such time says only how many detections it holds", () => {
    const opened: SecurityCaseRowMoment = getSecurityCaseRowMoment(
      "lastDetectedAt",
      { closedAt: NOW },
    );
    const notClosed: SecurityCaseRowMoment = getSecurityCaseRowMoment(
      "closedAt",
      { lastDetectedAt: NINE_MINUTES_AGO },
    );

    expect(opened).toEqual({
      template: SECURITY_CASE_DETECTIONS,
      time: undefined,
    });
    expect(notClosed).toEqual(opened);
  });

  test("the sentences, in English", () => {
    expect(SECURITY_CASE_DETECTIONS).toEqual({
      one: "{{count}} detection",
      other: "{{count}} detections",
    });
    expect(SECURITY_CASE_DETECTIONS_THE_LAST).toEqual({
      one: "{{count}} detection, {{time}}",
      other: "{{count}} detections, the last {{time}}",
    });
    expect(SECURITY_CASE_DETECTIONS_CLOSED).toEqual({
      one: "{{count}} detection, closed {{time}}",
      other: "{{count}} detections, closed {{time}}",
    });

    const english: Translator = createTranslator(undefined, "en");

    expect(
      english.translatePlural(SECURITY_CASE_DETECTIONS_THE_LAST, 3, {
        time: "9 minutes ago",
      }),
    ).toBe("3 detections, the last 9 minutes ago");
    expect(
      english.translatePlural(SECURITY_CASE_DETECTIONS_THE_LAST, 1, {
        time: "9 minutes ago",
      }),
    ).toBe("1 detection, 9 minutes ago");
    expect(
      english.translatePlural(SECURITY_CASE_DETECTIONS_CLOSED, 2, {
        time: "2 days ago",
      }),
    ).toBe("2 detections, closed 2 days ago");
  });

  test("every list's line ends with the time it is sorted by", () => {
    for (const view of SECURITY_CASE_QUEUE_VIEWS) {
      const moment: SecurityCaseRowMoment = getSecurityCaseRowMoment(
        view.sortBy,
        { lastDetectedAt: NINE_MINUTES_AGO, closedAt: NOW },
      );

      expect([view.key, moment.template]).toEqual([
        view.key,
        view.key === "closed"
          ? SECURITY_CASE_DETECTIONS_CLOSED
          : SECURITY_CASE_DETECTIONS_THE_LAST,
      ]);
    }
  });

  test("the column of that time waits in Customize Columns on every list", () => {
    for (const view of SECURITY_CASE_QUEUE_VIEWS) {
      const column: string =
        view.sortBy === "closedAt" ? "closed" : "lastDetection";

      expect([view.key, view.columns.includes(column as never)]).toEqual([
        view.key,
        true,
      ]);
      expect([view.key, view.hiddenColumns.includes(column as never)]).toEqual([
        view.key,
        true,
      ]);
    }
  });

  const templates: Array<[string, PluralTemplate]> = [
    ["the last", SECURITY_CASE_DETECTIONS_THE_LAST],
    ["closed", SECURITY_CASE_DETECTIONS_CLOSED],
  ];

  test.each(LANGUAGES)(
    "%s words both sentences, keeping the count and the time",
    (language: string) => {
      const values: Record<string, string> = locale(language);

      for (const [, template] of templates) {
        const other: string | undefined = values[template.other];
        const one: string | undefined = values[`${template.other}_one`];

        expect(other).toBeDefined();
        expect(other).not.toBe(template.other);
        expect(other).toContain("{{count}}");
        expect(other).toContain("{{time}}");

        expect(one).toBeDefined();
        expect(one).toContain("{{count}}");
        expect(one).toContain("{{time}}");

        if (!NO_ONE_FORM.includes(language)) {
          expect(one).not.toBe(template.one);
        }
      }
    },
  );

  test.each(LANGUAGES)(
    "%s draws a case's line whole, the count and the time in it",
    (language: string) => {
      const translator: Translator = translatorFor(language);

      for (const [, template] of templates) {
        for (const count of [1, 3, 21]) {
          const drawn: string = translator.translatePlural(template, count, {
            time: "<time>",
          });

          expect(drawn).toContain("<time>");
          expect(drawn).not.toContain("{{");
          expect(drawn).not.toContain("detection");
          expect(drawn).toContain(translator.formatNumber(count));
        }
      }
    },
  );
});

describe("Open Security Case, in every language", () => {
  const PHRASES: Array<string> = [
    "Open Security Case",
    "Open New Security Case",
  ];

  test.each(LANGUAGES)(
    "%s words the button and the dialog whole",
    (language: string) => {
      const values: Record<string, string> = locale(language);

      for (const phrase of PHRASES) {
        const worded: string | undefined = values[phrase];

        expect({ phrase, worded: Boolean(worded) }).toEqual({
          phrase,
          worded: true,
        });
        expect(worded).not.toBe(phrase);
      }
    },
  );

  /*
   * Where the verb comes after its object, the words looked up one by one
   * put it first: "Öffnen Sicherheitsfall". (Where it comes first anyway -
   * Persian's "باز کردن پرونده امنیتی" - the two read the same.)
   */
  test.each(["de", "nl", "ja", "ko", "hi"])(
    "%s never reads the verb before the noun",
    (language: string) => {
      const values: Record<string, string> = locale(language);
      const wordByWord: string = `${values["Open"]} ${values["Security Case"]}`;

      for (const phrase of PHRASES) {
        expect({ phrase, worded: values[phrase] }).not.toEqual({
          phrase,
          worded: wordByWord,
        });
      }
      expect(
        values["Open Security Case"]?.startsWith(`${values["Open"]} `),
      ).toBe(false);
    },
  );

  test("German opens a case as a case is opened, not as a door is", () => {
    const german: Record<string, string> = locale("de");

    expect(german["Open Security Case"]).toBe("Sicherheitsfall eröffnen");
    expect(german["Open New Security Case"]).toBe(
      "Neuen Sicherheitsfall eröffnen",
    );
  });

  /*
   * The header's button is "<verb> <noun>" through the shared table's
   * translateCreateAction: for a verb it has no template of its own, the
   * whole phrase is looked up first, then "{{action}} {{itemName}}".
   */
  test.each(LANGUAGES)(
    "%s: the table's create button finds the whole phrase",
    (language: string) => {
      const translator: Translator = translatorFor(language);

      expect(
        translateNamedAction(translator, {
          template: "{{action}} {{itemName}}",
          itemName: "Security Case",
          values: { action: translatableTerm("Open") },
        }),
      ).toBe(locale(language)["Open Security Case"]);
    },
  );
});

/*
 * The case list draws the line from the queue's rules, the button and the
 * dialog from the phrases - the wiring these words depend on.
 */
describe("the case list's wiring", () => {
  const table: string = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "..",
      "FeatureSet",
      "Dashboard",
      "src",
      "Components",
      "SecurityCase",
      "SecurityCasesTable.tsx",
    ),
    "utf8",
  );

  test("each case's line reads its sentence and its time from the queue's rules", () => {
    expect(table).toContain("getSecurityCaseRowMoment(");
    expect(table).toContain("view.sortBy,");
    expect(table).toContain("moment.template,");
    expect(table).toContain("OneUptimeDate.fromNow(moment.time)");
  });

  test("the list asks for both times, whichever column is shown", () => {
    expect(table).toContain("lastDetectedAt: true,");
    expect(table).toContain("closedAt: true,");
  });

  test("the create button and its dialog are the whole phrases", () => {
    expect(table).toContain('createVerb="Open"');
    expect(table).toContain("createFormTitle={OPEN_NEW_SECURITY_CASE}");
    expect(table).toContain("createFormSubmitButtonText={OPEN_SECURITY_CASE}");
    expect(table).toContain('translationKey("Open Security Case")');
  });
});
