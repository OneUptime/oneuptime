import { describe, expect, test } from "@jest/globals";
import { PluralTemplate } from "Common/UI/Utils/TranslateTemplate";
import { createTranslator, Translator } from "Common/Types/Translator";
import {
  RESOLVED_RECORD_RETENTION_CHOICES_IN_DAYS,
  ResolvedRecordKind,
} from "Common/Types/Retention/ResolvedRecordRetention";
import fs from "fs";
import path from "path";
import ResolvedRecordRetentionCopy, {
  ALERT_RETENTION_COPY,
  INCIDENT_RETENTION_COPY,
  RETENTION_DAYS,
  RETENTION_YEARS,
  ResolvedRecordRetentionKindCopy,
  getKeepCompletedPostmortemsDescription,
  getResolvedRecordRetentionChoices,
  getResolvedRecordRetentionConfirmation,
  getResolvedRecordRetentionDescription,
  getResolvedRecordRetentionText,
  getRetentionLength,
} from "../../FeatureSet/Dashboard/src/Components/Retention/ResolvedRecordRetentionCopy";

/*
 * Data Retention's words (issue #6903): the Resolved Incidents and Resolved
 * Alerts cards on Incidents -> Settings -> Data Retention and Alerts ->
 * Settings -> Data Retention. Read here as every Dashboard language reads
 * them, from the shipped locale files: each sentence translated - the
 * plural ones in both their forms, {{count}} kept - and the lengths said in
 * days, or in years when they are whole years.
 */

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../FeatureSet/Dashboard/src/Locales",
);

type Locale = Record<string, string>;

const LANGUAGES: Array<string> = fs
  .readdirSync(LOCALES_DIR)
  .filter((file: string): boolean => {
    return file.endsWith(".json") && file !== "en.json";
  })
  .map((file: string): string => {
    return file.replace(/\.json$/, "");
  })
  .sort();

function readLocale(code: string): Locale {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${code}.json`), "utf8"),
  ) as Locale;
}

const ENGLISH: Locale = readLocale("en");

function translatorFor(code: string): Translator {
  const locale: Locale = readLocale(code);

  return createTranslator((text: string): string | undefined => {
    return locale[text];
  }, code);
}

const english: Translator = createTranslator(undefined, "en");

const KIND_COPIES: Array<ResolvedRecordRetentionKindCopy> = [
  INCIDENT_RETENTION_COPY,
  ALERT_RETENTION_COPY,
];

// Every sentence and name the cards say, each a key of every locale.
const SENTENCES: Array<string> = [
  ResolvedRecordRetentionCopy.label,
  ResolvedRecordRetentionCopy.never,
  ResolvedRecordRetentionCopy.keepPostmortemsTitle,
  ResolvedRecordRetentionCopy.keepPostmortemsOnDescription,
  ResolvedRecordRetentionCopy.keepPostmortemsOffDescription,
  ResolvedRecordRetentionCopy.keepPostmortemsOffConfirmTitle,
  ResolvedRecordRetentionCopy.keepPostmortemsOffConfirmDescription,
  ResolvedRecordRetentionCopy.keepPostmortemsOffConfirmButton,
  ...KIND_COPIES.flatMap((copy: ResolvedRecordRetentionKindCopy) => {
    return [
      copy.cardTitle,
      copy.cardDescription,
      copy.onDescription,
      copy.offDescription,
      copy.confirmTitle,
      copy.confirmButton,
    ];
  }),
];

// Every plural sentence, stored as its other form and its one form (_one).
const PLURALS: Array<PluralTemplate> = [
  RETENTION_DAYS,
  RETENTION_YEARS,
  ...KIND_COPIES.flatMap((copy: ResolvedRecordRetentionKindCopy) => {
    return [copy.confirmInDays, copy.confirmInYears];
  }),
];

describe("the words, in English", () => {
  test("the pick offers Never first, then a month to three years", () => {
    expect(getResolvedRecordRetentionChoices()).toEqual([
      0,
      ...RESOLVED_RECORD_RETENTION_CHOICES_IN_DAYS,
    ]);
    expect(
      getResolvedRecordRetentionChoices().map((days: number): string => {
        return getResolvedRecordRetentionText(days, english);
      }),
    ).toEqual([
      "Never",
      "30 days",
      "60 days",
      "90 days",
      "180 days",
      "1 year",
      "2 years",
      "3 years",
    ]);
  });

  test("a length is said in years only when it is whole years", () => {
    expect(getRetentionLength(30)).toEqual({ unit: "days", count: 30 });
    expect(getRetentionLength(180)).toEqual({ unit: "days", count: 180 });
    expect(getRetentionLength(364)).toEqual({ unit: "days", count: 364 });
    expect(getRetentionLength(365)).toEqual({ unit: "years", count: 1 });
    expect(getRetentionLength(400)).toEqual({ unit: "days", count: 400 });
    expect(getRetentionLength(730)).toEqual({ unit: "years", count: 2 });
    expect(getRetentionLength(1095)).toEqual({ unit: "years", count: 3 });
  });

  test("the cards are named for what they delete, and the pick for what it does", () => {
    expect(INCIDENT_RETENTION_COPY.cardTitle).toBe("Resolved Incidents");
    expect(ALERT_RETENTION_COPY.cardTitle).toBe("Resolved Alerts");
    expect(ResolvedRecordRetentionCopy.label).toBe("Delete after");
    expect(INCIDENT_RETENTION_COPY.kind).toBe(ResolvedRecordKind.Incident);
    expect(ALERT_RETENTION_COPY.kind).toBe(ResolvedRecordKind.Alert);
    expect(INCIDENT_RETENTION_COPY.column).toBe("incidentRetentionInDays");
    expect(ALERT_RETENTION_COPY.column).toBe("alertRetentionInDays");
  });

  test("each card says that what is not resolved is never deleted", () => {
    expect(INCIDENT_RETENTION_COPY.cardDescription).toContain(
      "Incidents that are not resolved are never deleted.",
    );
    expect(ALERT_RETENTION_COPY.cardDescription).toContain(
      "Alerts that are not resolved are never deleted, and an alert linked to an incident stays as long as the incident.",
    );
  });

  test("the sentence under the pick says what a length means, and what Never means", () => {
    for (const copy of KIND_COPIES) {
      for (const days of RESOLVED_RECORD_RETENTION_CHOICES_IN_DAYS) {
        expect(getResolvedRecordRetentionDescription(copy, days)).toBe(
          copy.onDescription,
        );
      }

      expect(getResolvedRecordRetentionDescription(copy, 0)).toBe(
        copy.offDescription,
      );
    }

    expect(INCIDENT_RETENTION_COPY.onDescription).toContain(
      "Status pages stop showing deleted incidents",
    );
    expect(INCIDENT_RETENTION_COPY.onDescription).toContain(
      "can't be brought back",
    );
  });

  test("the question before a pick that deletes more says what goes, for how long, and that it can't be brought back", () => {
    expect(
      getResolvedRecordRetentionConfirmation(
        INCIDENT_RETENTION_COPY,
        90,
        english,
      ),
    ).toBe(
      "Incidents resolved more than 90 days ago are deleted within the hour, with their timeline, notes and logs. Status pages stop showing them, and they can't be brought back.",
    );
    expect(
      getResolvedRecordRetentionConfirmation(
        INCIDENT_RETENTION_COPY,
        365,
        english,
      ),
    ).toBe(
      "Incidents resolved more than 1 year ago are deleted within the hour, with their timeline, notes and logs. Status pages stop showing them, and they can't be brought back.",
    );
    expect(
      getResolvedRecordRetentionConfirmation(
        ALERT_RETENTION_COPY,
        1095,
        english,
      ),
    ).toBe(
      "Alerts resolved more than 3 years ago are deleted within the hour, with their timeline, notes and logs. They can't be brought back.",
    );
    expect(
      getResolvedRecordRetentionConfirmation(ALERT_RETENTION_COPY, 30, english),
    ).toBe(
      "Alerts resolved more than 30 days ago are deleted within the hour, with their timeline, notes and logs. They can't be brought back.",
    );
  });

  test("only the incidents card offers to keep completed postmortems, and says what each side means", () => {
    expect(INCIDENT_RETENTION_COPY.offersPostmortemKeep).toBe(true);
    expect(ALERT_RETENTION_COPY.offersPostmortemKeep).toBe(false);
    expect(getKeepCompletedPostmortemsDescription(true)).toBe(
      "An incident whose postmortem is completed stays, however long ago it was resolved.",
    );
    expect(getKeepCompletedPostmortemsDescription(false)).toBe(
      "Incidents are deleted whether or not their postmortem is completed.",
    );
  });

  test("every sentence is the English locale's own key", () => {
    for (const key of SENTENCES) {
      expect({ key, inEnglish: ENGLISH[key] }).toEqual({ key, inEnglish: key });
    }

    for (const plural of PLURALS) {
      expect(ENGLISH[plural.other]).toBe(plural.other);
      expect(ENGLISH[`${plural.other}_one`]).toBe(plural.one);
    }
  });
});

describe.each(LANGUAGES)("in %s", (code: string) => {
  const locale: Locale = readLocale(code);
  const translator: Translator = translatorFor(code);

  test("every sentence is translated", () => {
    for (const key of SENTENCES) {
      expect({ key, translated: Boolean(locale[key]?.trim()) }).toEqual({
        key,
        translated: true,
      });
    }
  });

  test("every plural sentence is translated in both forms, keeping {{count}}", () => {
    for (const plural of PLURALS) {
      for (const key of [plural.other, `${plural.other}_one`]) {
        expect({ key, translated: Boolean(locale[key]?.trim()) }).toEqual({
          key,
          translated: true,
        });
      }

      expect({ key: plural.other, value: locale[plural.other] }).toEqual({
        key: plural.other,
        value: expect.stringContaining("{{count}}"),
      });
    }
  });

  test("every length is said in the reader's words and digits", () => {
    const labels: Array<string> = getResolvedRecordRetentionChoices().map(
      (days: number): string => {
        return getResolvedRecordRetentionText(days, translator);
      },
    );

    expect(labels[0]).toBe(locale["Never"]);
    expect(new Set(labels).size).toBe(labels.length);

    for (const label of labels.slice(1)) {
      expect(label).not.toMatch(/\b(days?|years?)\b/);
    }

    expect(
      getResolvedRecordRetentionConfirmation(
        INCIDENT_RETENTION_COPY,
        90,
        translator,
      ),
    ).not.toBe(
      getResolvedRecordRetentionConfirmation(
        INCIDENT_RETENTION_COPY,
        90,
        english,
      ),
    );
  });
});
