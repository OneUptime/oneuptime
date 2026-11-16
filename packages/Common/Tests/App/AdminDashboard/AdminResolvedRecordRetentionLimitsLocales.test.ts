import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ResolvedRecordRetentionLimitsCopy, {
  ALERT_RETENTION_LIMITS_COPY,
  INCIDENT_RETENTION_LIMITS_COPY,
  RETENTION_DAYS,
  RETENTION_YEARS,
  ResolvedRecordRetentionLimitsKindCopy,
  getMaximumDescription,
} from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Settings/DataRetention/ResolvedRecordRetentionLimitsCopy";
import { RESOLVED_RECORD_RETENTION_CHOICES_IN_DAYS } from "../../../Types/Retention/ResolvedRecordRetention";
import {
  createTranslator,
  PluralTemplate,
  Translator,
} from "../../../Types/Translator";

/*
 * THE SERVER'S LIMITS ON RESOLVED INCIDENTS AND ALERTS IN EVERY LANGUAGE
 * (issue #6941): every sentence and name of Admin Dashboard > Settings >
 * Data Retention's Resolved Incidents and Resolved Alerts cards is a key of
 * each of the Admin Dashboard's 18 locale files - English as itself, each
 * plural's one form under its key plus "_one" - worded in the language
 * (not left in English), with its {{placeholders}}, in the same order in
 * every file. The names are the ones the language's Dashboard gives the
 * project's own cards, and a sentence that names Never names it with the
 * word the pick shows.
 */

const ADMIN_LOCALES: string = path.join(
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

const DASHBOARD_LOCALES: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
  "Locales",
);

const LANGUAGES: Array<string> = fs
  .readdirSync(ADMIN_LOCALES)
  .filter((file: string): boolean => {
    return file.endsWith(".json");
  })
  .map((file: string): string => {
    return file.replace(/\.json$/, "");
  })
  .sort();

const TRANSLATED: Array<string> = LANGUAGES.filter(
  (language: string): boolean => {
    return language !== "en";
  },
);

type Locale = Record<string, unknown>;

function read(directory: string, language: string): Locale {
  return JSON.parse(
    fs.readFileSync(path.join(directory, `${language}.json`), "utf8"),
  ) as Locale;
}

const admin: (language: string) => Locale = (language: string): Locale => {
  return read(ADMIN_LOCALES, language);
};

const isPlural: (value: unknown) => value is PluralTemplate = (
  value: unknown,
): value is PluralTemplate => {
  return (
    typeof value === "object" &&
    value !== null &&
    "one" in (value as Record<string, unknown>) &&
    "other" in (value as Record<string, unknown>)
  );
};

// Each key a card looks up, with the English it stands for.
interface Sentence {
  key: string;
  english: string;
}

const sentencesOf: (values: Array<unknown>) => Array<Sentence> = (
  values: Array<unknown>,
): Array<Sentence> => {
  const sentences: Array<Sentence> = [];

  for (const value of values) {
    if (isPlural(value)) {
      sentences.push({ key: value.other, english: value.other });
      sentences.push({ key: `${value.other}_one`, english: value.one });
    } else if (typeof value === "string") {
      sentences.push({ key: value, english: value });
    }
  }

  return sentences;
};

const KIND_SENTENCES: (
  copy: ResolvedRecordRetentionLimitsKindCopy,
) => Array<Sentence> = (
  copy: ResolvedRecordRetentionLimitsKindCopy,
): Array<Sentence> => {
  return sentencesOf([
    copy.cardTitle,
    copy.cardDescription,
    copy.noMaximumDescription,
    copy.maximumInDays,
    copy.maximumInYears,
    copy.confirmTitle,
    copy.confirmInDays,
    copy.confirmInYears,
    copy.defaultNeverDescription,
    copy.defaultInDays,
    copy.defaultInYears,
  ]);
};

const SENTENCES: Array<Sentence> = [
  ...sentencesOf(Object.values(ResolvedRecordRetentionLimitsCopy)),
  ...sentencesOf([RETENTION_DAYS, RETENTION_YEARS]),
  ...KIND_SENTENCES(INCIDENT_RETENTION_LIMITS_COPY),
  ...KIND_SENTENCES(ALERT_RETENTION_LIMITS_COPY),
];

// The words the Admin Dashboard said before these cards, worded long since.
const ALREADY_WORDED: ReadonlyArray<string> = [
  "No limit",
  "Never",
  "{{count}} days",
  "{{count}} days_one",
];

// The keys these cards brought, each once.
const NEW_KEYS: Array<string> = Array.from(
  new Set(
    SENTENCES.map((sentence: Sentence): string => {
      return sentence.key;
    }).filter((key: string): boolean => {
      return !ALREADY_WORDED.includes(key);
    }),
  ),
);

const placeholders: (text: string) => Array<string> = (
  text: string,
): Array<string> => {
  return Array.from(text.matchAll(/\{\{\s*(\w+)\s*\}\}/g))
    .map((match: RegExpMatchArray): string => {
      return match[1] as string;
    })
    .sort();
};

// The sentences that name the Never pick.
const NAMING_NEVER: Array<string> = [
  ResolvedRecordRetentionLimitsCopy.defaultNeverUnderMaximum,
  ...[INCIDENT_RETENTION_LIMITS_COPY, ALERT_RETENTION_LIMITS_COPY].flatMap(
    (copy: ResolvedRecordRetentionLimitsKindCopy): Array<string> => {
      return [copy.maximumInDays, copy.maximumInYears].flatMap(
        (template: PluralTemplate): Array<string> => {
          return [template.other, `${template.other}_one`];
        },
      );
    },
  ),
];

describe("Settings > Data Retention's limits in every language", () => {
  test("every Admin Dashboard language is checked, and every sentence of the cards", () => {
    expect(LANGUAGES).toContain("en");
    expect(LANGUAGES.length).toBe(18);
    // 9 shared, 2 lengths and 17 of each kind, each plural's one form a key of its own.
    expect(NEW_KEYS.length).toBe(45);
    expect(SENTENCES.length).toBe(NEW_KEYS.length + ALREADY_WORDED.length);
  });

  test.each(LANGUAGES)(
    "%s has every sentence of the cards, with its placeholders",
    (language: string) => {
      const locale: Locale = admin(language);

      for (const sentence of SENTENCES) {
        const value: unknown = locale[sentence.key];

        expect({
          key: sentence.key,
          isText: typeof value === "string",
        }).toEqual({ key: sentence.key, isText: true });
        expect({
          key: sentence.key,
          placeholders: placeholders(value as string),
        }).toEqual({
          key: sentence.key,
          placeholders: placeholders(sentence.english),
        });

        if (language === "en") {
          expect(value).toBe(sentence.english);
        }
      }
    },
  );

  test.each(TRANSLATED)(
    "%s words every sentence of the cards, leaving none in English",
    (language: string) => {
      const locale: Locale = admin(language);
      const leftInEnglish: Array<string> = SENTENCES.filter(
        (sentence: Sentence): boolean => {
          return locale[sentence.key] === sentence.english;
        },
      ).map((sentence: Sentence): string => {
        return sentence.key;
      });

      expect({ language, leftInEnglish }).toEqual({
        language,
        leftInEnglish: [],
      });
    },
  );

  test.each(LANGUAGES)(
    "%s holds the new keys in English's order",
    (language: string) => {
      const keys: Array<string> = Object.keys(admin(language)).filter(
        (key: string): boolean => {
          return NEW_KEYS.includes(key);
        },
      );
      const englishOrder: Array<string> = Object.keys(admin("en")).filter(
        (key: string): boolean => {
          return NEW_KEYS.includes(key);
        },
      );

      expect(keys).toEqual(englishOrder);
      expect(keys.length).toBe(NEW_KEYS.length);
    },
  );

  test.each(TRANSLATED)(
    "%s names the cards and the lengths as its Dashboard names the project's own",
    (language: string) => {
      const locale: Locale = admin(language);
      const dashboard: Locale = read(DASHBOARD_LOCALES, language);

      for (const key of [
        INCIDENT_RETENTION_LIMITS_COPY.cardTitle,
        ALERT_RETENTION_LIMITS_COPY.cardTitle,
        RETENTION_YEARS.other,
        `${RETENTION_YEARS.other}_one`,
      ]) {
        expect({ key, admin: locale[key] }).toEqual({
          key,
          admin: dashboard[key],
        });
      }
    },
  );

  test.each(TRANSLATED)(
    "%s names Never in a sentence with the word the pick shows",
    (language: string) => {
      const locale: Locale = admin(language);
      const never: string = locale["Never"] as string;

      expect(never).not.toBe("Never");

      for (const key of NAMING_NEVER) {
        expect({
          key,
          namesNever: (locale[key] as string).includes(never),
        }).toEqual({ key, namesNever: true });
      }
    },
  );

  /*
   * The incidents' limit is one sentence, which says the limit leaves only
   * the incidents a project keeps for a completed postmortem: at most 150
   * characters, as every line under a pick, in every language and at every
   * length the card offers - a month to half a year in days, one to three
   * years.
   */
  test.each(LANGUAGES)(
    "%s says the incidents' limit in at most 150 characters at every length the card offers",
    (language: string) => {
      const locale: Locale = admin(language);
      const translator: Translator = createTranslator(
        (text: string): string => {
          const value: unknown = locale[text];

          return typeof value === "string" ? value : text;
        },
        language,
        { drawsOnPage: true },
      );
      const lines: Array<string> =
        RESOLVED_RECORD_RETENTION_CHOICES_IN_DAYS.map(
          (days: number): string => {
            return getMaximumDescription(
              INCIDENT_RETENTION_LIMITS_COPY,
              days,
              translator,
            );
          },
        );

      expect(lines.length).toBe(7);
      expect(
        lines.filter((line: string): boolean => {
          return line.length > 150;
        }),
      ).toEqual([]);

      if (language !== "en") {
        // Read in the language, not English's fallback.
        expect(lines[0]).not.toMatch(/No project keeps/);
      }
    },
  );

  test("Korean says 경고 for an alert, never 알림, and Hindi घटना for an incident", () => {
    const korean: Locale = admin("ko");
    const hindi: Locale = admin("hi");

    for (const sentence of KIND_SENTENCES(ALERT_RETENTION_LIMITS_COPY)) {
      expect(korean[sentence.key]).toMatch(/경고/);
      expect(korean[sentence.key]).not.toMatch(/알림/);
    }

    for (const sentence of KIND_SENTENCES(INCIDENT_RETENTION_LIMITS_COPY)) {
      expect(hindi[sentence.key]).toMatch(/घटना|घटनाएं|घटनाओं/);
    }
  });
});
