import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ResolvedRecordRetentionLimitsCopy, {
  ALERT_RETENTION_LIMITS_COPY,
  INCIDENT_RETENTION_LIMITS_COPY,
  NO_LENGTH_CHOICE,
  RETENTION_DAYS,
  RETENTION_YEARS,
  ResolvedRecordRetentionLimitsKindCopy,
  getDefaultChoiceText,
  getDefaultDescription,
  getLimitChoices,
  getLimitsAfterMaximum,
  getMaximumChoiceText,
  getMaximumConfirmation,
  getMaximumDescription,
  getReachText,
  getRetentionLength,
  isLongerThanMaximum,
  toMaximumChoice,
  toMaximumInDays,
  toStoredLength,
} from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Settings/DataRetention/ResolvedRecordRetentionLimitsCopy";
import {
  RESOLVED_RECORD_RETENTION_LIMIT_COLUMNS,
  ResolvedRecordRetentionLimitColumns,
  Service as GlobalConfigServiceClass,
} from "../../../Server/Services/GlobalConfigService";
import { withPlainSpaces } from "../../../Types/NoBreakSpaces";
import {
  KEEP_EVERY_RESOLVED_RECORD,
  RESOLVED_RECORD_RETENTION_CHOICES_IN_DAYS,
  doesResolvedRecordRetentionMaximumDeleteMore,
  readResolvedRecordRetentionDefaultInDays,
  readResolvedRecordRetentionMaximumInDays,
} from "../../../Types/Retention/ResolvedRecordRetention";
import {
  createTranslator,
  PluralTemplate,
  Translator,
} from "../../../Types/Translator";

/*
 * THE WORDS AND THE RULES OF THE SERVER'S LIMITS ON RESOLVED INCIDENTS AND
 * ALERTS (issue #6941), Admin Dashboard > Settings > Data Retention, read
 * without React (ResolvedRecordRetentionLimitsCopy):
 *
 *   - the picks' values are the project choices, No limit and Never
 *     stored empty;
 *   - what each sentence says for each setting, a length said in days or
 *     in whole years, a count in the reader's digits;
 *   - the columns are the ones GlobalConfigService guards, and what the
 *     page shows when it cannot read the server back is what the server's
 *     own rule wrote;
 *   - each sentence keeps to the help text's lengths.
 */

const LOCALES_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "AdminDashboard",
  "src",
  "Locales",
);

function readLocale(language: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
  ) as Record<string, unknown>;
}

// The Admin Dashboard's words in `language`, as a page's translator reads them.
function translatorFor(language: string): Translator {
  const locale: Record<string, unknown> = readLocale(language);

  return createTranslator(
    (text: string): string => {
      const value: unknown = locale[text];

      return typeof value === "string" ? value : text;
    },
    language,
    { drawsOnPage: true },
  );
}

const ENGLISH: Translator = translatorFor("en");
const GERMAN: Translator = translatorFor("de");
const PERSIAN: Translator = translatorFor("fa");

// What a reader reads, without the spaces held to a number.
function read(text: string | null): string | null {
  return text === null ? null : withPlainSpaces(text);
}

const KINDS: Array<[string, ResolvedRecordRetentionLimitsKindCopy]> = [
  ["incidents", INCIDENT_RETENTION_LIMITS_COPY],
  ["alerts", ALERT_RETENTION_LIMITS_COPY],
];

describe("the picks' values", () => {
  test("No limit (and Never) first, then exactly the project choices", () => {
    expect(getLimitChoices()).toEqual([0, 30, 60, 90, 180, 365, 730, 1095]);
    expect(getLimitChoices().slice(1)).toEqual([
      ...RESOLVED_RECORD_RETENTION_CHOICES_IN_DAYS,
    ]);
    expect(NO_LENGTH_CHOICE).toBe(KEEP_EVERY_RESOLVED_RECORD);
  });

  test("No limit and Never are stored empty; a length as its days", () => {
    expect(toStoredLength(NO_LENGTH_CHOICE)).toBeNull();

    for (const days of RESOLVED_RECORD_RETENTION_CHOICES_IN_DAYS) {
      expect(toStoredLength(days)).toBe(days);
    }
  });

  test("a limit read from the server is the pick that shows it, and back", () => {
    expect(toMaximumChoice(undefined)).toBe(NO_LENGTH_CHOICE);
    expect(toMaximumInDays(NO_LENGTH_CHOICE)).toBeUndefined();

    for (const days of RESOLVED_RECORD_RETENTION_CHOICES_IN_DAYS) {
      expect(toMaximumChoice(days)).toBe(days);
      expect(toMaximumInDays(days)).toBe(days);
      // What the server stores reads back as the same limit.
      expect(
        readResolvedRecordRetentionMaximumInDays(toStoredLength(days)),
      ).toBe(days);
      expect(
        readResolvedRecordRetentionDefaultInDays(toStoredLength(days)),
      ).toBe(days);
    }

    expect(
      readResolvedRecordRetentionMaximumInDays(
        toStoredLength(NO_LENGTH_CHOICE),
      ),
    ).toBeUndefined();
    expect(
      readResolvedRecordRetentionDefaultInDays(
        toStoredLength(NO_LENGTH_CHOICE),
      ),
    ).toBe(KEEP_EVERY_RESOLVED_RECORD);
  });

  test("a limit that deletes more is one set where there was none, or a shorter one", () => {
    const deletesMore: (from: number, to: number) => boolean = (
      from: number,
      to: number,
    ): boolean => {
      return doesResolvedRecordRetentionMaximumDeleteMore({
        from: toMaximumInDays(from),
        to: toMaximumInDays(to),
      });
    };

    expect(deletesMore(NO_LENGTH_CHOICE, 1095)).toBe(true);
    expect(deletesMore(NO_LENGTH_CHOICE, 30)).toBe(true);
    expect(deletesMore(365, 90)).toBe(true);
    expect(deletesMore(90, 365)).toBe(false);
    expect(deletesMore(90, 90)).toBe(false);
    expect(deletesMore(365, NO_LENGTH_CHOICE)).toBe(false);
    expect(deletesMore(NO_LENGTH_CHOICE, NO_LENGTH_CHOICE)).toBe(false);
  });
});

describe("a length as the reader counts it", () => {
  test("whole years in years, the rest in days", () => {
    expect(getRetentionLength(30)).toEqual({ unit: "days", count: 30 });
    expect(getRetentionLength(180)).toEqual({ unit: "days", count: 180 });
    expect(getRetentionLength(365)).toEqual({ unit: "years", count: 1 });
    expect(getRetentionLength(730)).toEqual({ unit: "years", count: 2 });
    expect(getRetentionLength(1095)).toEqual({ unit: "years", count: 3 });
    expect(getRetentionLength(400)).toEqual({ unit: "days", count: 400 });
  });

  test("each pick says its lengths, and No limit or Never for empty", () => {
    expect(
      getLimitChoices().map((choice: number): string => {
        return withPlainSpaces(getMaximumChoiceText(choice, ENGLISH));
      }),
    ).toEqual([
      "No limit",
      "30 days",
      "60 days",
      "90 days",
      "180 days",
      "1 year",
      "2 years",
      "3 years",
    ]);
    expect(withPlainSpaces(getDefaultChoiceText(0, ENGLISH))).toBe("Never");
    expect(withPlainSpaces(getDefaultChoiceText(730, ENGLISH))).toBe("2 years");
  });

  test("in the reader's language and digits", () => {
    expect(withPlainSpaces(getMaximumChoiceText(0, GERMAN))).toBe("Kein Limit");
    expect(withPlainSpaces(getMaximumChoiceText(90, GERMAN))).toBe("90 Tage");
    expect(withPlainSpaces(getMaximumChoiceText(365, GERMAN))).toBe("1 Jahr");
    expect(withPlainSpaces(getMaximumChoiceText(1095, GERMAN))).toBe("3 Jahre");
    expect(withPlainSpaces(getDefaultChoiceText(0, GERMAN))).toBe("Nie");
    expect(withPlainSpaces(getMaximumChoiceText(90, PERSIAN))).toBe("۹۰ روز");
    expect(withPlainSpaces(getMaximumChoiceText(730, PERSIAN))).toBe("۲ سال");
  });
});

describe("what each sentence says", () => {
  test("under Keep for at most: each project chooses, or no project keeps one longer", () => {
    expect(
      read(getMaximumDescription(INCIDENT_RETENTION_LIMITS_COPY, 0, ENGLISH)),
    ).toBe("Each project keeps resolved incidents for as long as it chooses.");
    expect(
      read(getMaximumDescription(INCIDENT_RETENTION_LIMITS_COPY, 180, ENGLISH)),
    ).toBe(
      "No project keeps a resolved incident longer than 180 days, even one set to Never, except incidents it keeps for a completed postmortem.",
    );
    expect(
      read(getMaximumDescription(INCIDENT_RETENTION_LIMITS_COPY, 365, ENGLISH)),
    ).toBe(
      "No project keeps a resolved incident longer than 1 year, even one set to Never, except incidents it keeps for a completed postmortem.",
    );
    expect(
      read(getMaximumDescription(ALERT_RETENTION_LIMITS_COPY, 730, ENGLISH)),
    ).toBe(
      "No project keeps a resolved alert longer than 2 years, including projects set to Never.",
    );
    expect(
      read(getMaximumDescription(ALERT_RETENTION_LIMITS_COPY, 0, ENGLISH)),
    ).toBe("Each project keeps resolved alerts for as long as it chooses.");
  });

  test("the question says what goes, in days or in years", () => {
    expect(
      read(getMaximumConfirmation(INCIDENT_RETENTION_LIMITS_COPY, 30, ENGLISH)),
    ).toBe(
      "Every project deletes resolved incidents older than 30 days within the hour, with their timeline, notes and logs. They can't be brought back.",
    );
    expect(
      read(getMaximumConfirmation(ALERT_RETENTION_LIMITS_COPY, 1095, ENGLISH)),
    ).toBe(
      "Every project deletes resolved alerts older than 3 years within the hour, with their timeline, notes and logs. They can't be brought back.",
    );
    expect(
      read(
        getMaximumConfirmation(INCIDENT_RETENTION_LIMITS_COPY, 365, ENGLISH),
      ),
    ).toBe(
      "Every project deletes resolved incidents older than 1 year within the hour, with their timeline, notes and logs. They can't be brought back.",
    );
  });

  test("how far the question reaches: counting, one, several, none, or nothing when it was not counted", () => {
    expect(read(getReachText({ isCounting: true }, ENGLISH))).toBe(
      "Counting the projects this reaches…",
    );
    expect(read(getReachText({ isCounting: false, count: 1 }, ENGLISH))).toBe(
      "This reaches 1 project.",
    );
    expect(read(getReachText({ isCounting: false, count: 12 }, ENGLISH))).toBe(
      "This reaches 12 projects.",
    );
    expect(read(getReachText({ isCounting: false, count: 0 }, ENGLISH))).toBe(
      "No project keeps them longer, so nothing more is deleted now.",
    );
    expect(
      getReachText({ isCounting: false, count: null }, ENGLISH),
    ).toBeNull();
  });

  test("a count in the reader's digits and plural", () => {
    expect(read(getReachText({ isCounting: false, count: 1 }, GERMAN))).toBe(
      "Das betrifft 1 Projekt.",
    );
    expect(read(getReachText({ isCounting: false, count: 2 }, GERMAN))).toBe(
      "Das betrifft 2 Projekte.",
    );
    expect(
      read(getReachText({ isCounting: false, count: 12 }, PERSIAN)),
    ).toContain("۱۲");
  });

  test("under New projects delete after: Never with and without a limit, and a length", () => {
    const describeDefault: (
      copy: ResolvedRecordRetentionLimitsKindCopy,
      defaultInDays: number,
      maximumInDays: number | undefined,
    ) => string | null = (
      copy: ResolvedRecordRetentionLimitsKindCopy,
      defaultInDays: number,
      maximumInDays: number | undefined,
    ): string | null => {
      return read(
        getDefaultDescription({
          copy,
          defaultInDays,
          maximumInDays,
          translator: ENGLISH,
        }),
      );
    };

    expect(describeDefault(INCIDENT_RETENTION_LIMITS_COPY, 0, undefined)).toBe(
      "A new project keeps every resolved incident until its owners pick a length.",
    );
    expect(describeDefault(ALERT_RETENTION_LIMITS_COPY, 0, undefined)).toBe(
      "A new project keeps every resolved alert until its owners pick a length.",
    );
    expect(describeDefault(INCIDENT_RETENTION_LIMITS_COPY, 0, 90)).toBe(
      "A new project starts at Never and is held to the limit above until its owners pick a length.",
    );
    expect(describeDefault(ALERT_RETENTION_LIMITS_COPY, 0, 365)).toBe(
      "A new project starts at Never and is held to the limit above until its owners pick a length.",
    );
    expect(describeDefault(INCIDENT_RETENTION_LIMITS_COPY, 60, 90)).toBe(
      "A new project deletes resolved incidents after 60 days until its owners change it. Projects that exist keep their own.",
    );
    expect(describeDefault(ALERT_RETENTION_LIMITS_COPY, 1095, undefined)).toBe(
      "A new project deletes resolved alerts after 3 years until its owners change it. Projects that exist keep their own.",
    );
  });

  test("in German, every sentence is German", () => {
    expect(
      read(getMaximumDescription(INCIDENT_RETENTION_LIMITS_COPY, 365, GERMAN)),
    ).toBe(
      "Kein Projekt behält behobene Vorfälle länger als 1 Jahr, auch keines auf „Nie“, außer Vorfällen mit abgeschlossenem Postmortem, die es behält.",
    );
    expect(
      read(getMaximumConfirmation(ALERT_RETENTION_LIMITS_COPY, 90, GERMAN)),
    ).toBe(
      "Jedes Projekt löscht behobene Warnungen, die älter als 90 Tage sind, innerhalb einer Stunde, samt Zeitachse, Notizen und Protokollen. Sie können nicht wiederhergestellt werden.",
    );
    expect(
      read(
        getDefaultDescription({
          copy: INCIDENT_RETENTION_LIMITS_COPY,
          defaultInDays: 730,
          maximumInDays: undefined,
          translator: GERMAN,
        }),
      ),
    ).toBe(
      "Ein neues Projekt löscht behobene Vorfälle nach 2 Jahren, bis seine Eigentümer das ändern. Bestehende Projekte behalten ihre eigene Einstellung.",
    );
  });
});

describe("a new project's length under the limit", () => {
  test("a length longer than the limit is locked; Never, the limit and shorter ones are open", () => {
    expect(isLongerThanMaximum(180, 90)).toBe(true);
    expect(isLongerThanMaximum(1095, 730)).toBe(true);
    expect(isLongerThanMaximum(90, 90)).toBe(false);
    expect(isLongerThanMaximum(30, 90)).toBe(false);
    expect(isLongerThanMaximum(NO_LENGTH_CHOICE, 30)).toBe(false);
    // With no limit, every length is open.
    expect(isLongerThanMaximum(1095, undefined)).toBe(false);
  });

  test("the copy's columns are the ones the server guards", () => {
    expect(
      KINDS.map(
        ([, copy]: [string, ResolvedRecordRetentionLimitsKindCopy]): {
          kind: string;
          maximumColumn: string;
          defaultColumn: string;
        } => {
          return {
            kind: copy.kind,
            maximumColumn: copy.maximumColumn,
            defaultColumn: copy.defaultColumn,
          };
        },
      ),
    ).toEqual(
      RESOLVED_RECORD_RETENTION_LIMIT_COLUMNS.map(
        (
          columns: ResolvedRecordRetentionLimitColumns,
        ): { kind: string; maximumColumn: string; defaultColumn: string } => {
          return {
            kind: columns.kind,
            maximumColumn: columns.maximumColumn,
            defaultColumn: columns.defaultColumn,
          };
        },
      ),
    );
  });

  test.each(KINDS)(
    "%s: where the server cannot be read back, the page lowers the length as the server's rule does",
    (_kind: string, copy: ResolvedRecordRetentionLimitsKindCopy) => {
      for (const storedDefault of getLimitChoices()) {
        for (const newMaximum of getLimitChoices()) {
          const data: Record<string, unknown> = {
            [copy.maximumColumn]: toStoredLength(newMaximum),
          };

          GlobalConfigServiceClass.applyResolvedRecordRetentionLimitRules(
            data,
            {
              [copy.maximumColumn]: null,
              [copy.defaultColumn]: toStoredLength(storedDefault),
            },
          );

          const serverDefault: number =
            data[copy.defaultColumn] === undefined
              ? storedDefault
              : readResolvedRecordRetentionDefaultInDays(
                  data[copy.defaultColumn],
                );

          expect({
            storedDefault,
            newMaximum,
            page: getLimitsAfterMaximum(
              { maximumInDays: undefined, defaultInDays: storedDefault },
              toMaximumInDays(newMaximum),
            ),
          }).toEqual({
            storedDefault,
            newMaximum,
            page: {
              maximumInDays: toMaximumInDays(newMaximum),
              defaultInDays: serverDefault,
            },
          });
        }
      }
    },
  );
});

describe("the help text's lengths", () => {
  const formsOf: (template: PluralTemplate) => Array<string> = (
    template: PluralTemplate,
  ): Array<string> => {
    return [template.one, template.other];
  };

  test.each(KINDS)(
    "%s: the card's description is one sentence of at most 210 characters",
    (_kind: string, copy: ResolvedRecordRetentionLimitsKindCopy) => {
      expect(copy.cardDescription.length).toBeLessThanOrEqual(210);
      expect(copy.cardDescription.split(". ").length).toBe(1);
    },
  );

  test.each(KINDS)(
    "%s: each line under a pick, and the question, is at most 150 characters",
    (_kind: string, copy: ResolvedRecordRetentionLimitsKindCopy) => {
      const lines: Array<string> = [
        copy.noMaximumDescription,
        copy.defaultNeverDescription,
        ResolvedRecordRetentionLimitsCopy.defaultNeverUnderMaximum,
        ResolvedRecordRetentionLimitsCopy.longerThanMaximum,
        ResolvedRecordRetentionLimitsCopy.reachesNone,
        ...formsOf(ResolvedRecordRetentionLimitsCopy.reach),
        ...formsOf(copy.maximumInDays),
        ...formsOf(copy.maximumInYears),
        ...formsOf(copy.confirmInDays),
        ...formsOf(copy.confirmInYears),
        ...formsOf(copy.defaultInDays),
        ...formsOf(copy.defaultInYears),
      ];

      for (const line of lines) {
        expect({ line, length: line.length <= 150 }).toEqual({
          line,
          length: true,
        });
      }
    },
  );

  test("the lengths are the Admin Dashboard's own words for a length", () => {
    expect(RETENTION_DAYS).toEqual({
      one: "{{count}} day",
      other: "{{count}} days",
    });
    expect(RETENTION_YEARS).toEqual({
      one: "{{count}} year",
      other: "{{count}} years",
    });
  });
});
