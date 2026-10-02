import {
  alignLocale,
  ENGLISH,
  getExtraPluralCategories,
  getLeafId,
  getLeaves,
  getPlaceholders,
  getPluralBases,
  getPluralCategories,
  getValueAt,
  LocaleLeaf,
  LocaleNode,
  LocaleTree,
  PLURAL_ONE_SUFFIX,
  PluralCategory,
  serializeLocale,
  TRACKING_DIRECTORY,
} from "./LocaleFiles";
import fs from "fs";
import path from "path";

/*
 * How far each locale's translation has got, and whether its file is sound.
 *
 * What "untranslated" means, precisely: a key the locale must have (every
 * en.json key, plus the extra plural forms its language uses) whose value is
 * missing, or is exactly the English text, unless that is right for it:
 *
 *   - the English has no letters ("{{count}}", "—", "1-10");
 *   - the English is on the global list of strings that read the same in
 *     every language (i18n/SameAsEnglish.json: product and brand names,
 *     protocols, code), or on the locale's own list
 *     (i18n/Progress/<code>.json "sameAsEnglish": "Status" in German);
 *   - the key is a "_one" form in a language without that form (Japanese,
 *     Korean, Chinese), which no reader ever sees.
 *
 * A locale's progress file also records a baseline - how many keys it had and
 * how many of them were untranslated - and translations may never be lost:
 * the untranslated count may grow by at most the number of keys added since
 * (new strings arrive untranslated). Tests/Dashboard/DashboardLocalesGuard
 * enforces that, and `npm run i18n:baseline` ratchets the baseline down.
 */

export interface LocaleBaseline {
  // Keys the locale had to have when the baseline was taken.
  keys: number;
  // How many of them were untranslated.
  untranslated: number;
}

export interface LocaleProgress {
  baseline: LocaleBaseline;
  // English texts that read the same in this language (see above).
  sameAsEnglish: Array<string>;
}

export const GLOBAL_SAME_AS_ENGLISH_PATH: string = path.join(
  TRACKING_DIRECTORY,
  "SameAsEnglish.json",
);

export const PROGRESS_DIRECTORY: string = path.join(
  TRACKING_DIRECTORY,
  "Progress",
);

export const getProgressPath: (code: string) => string = (
  code: string,
): string => {
  return path.join(PROGRESS_DIRECTORY, `${code}.json`);
};

const sortedUnique: (values: ReadonlyArray<string>) => Array<string> = (
  values: ReadonlyArray<string>,
): Array<string> => {
  return Array.from(new Set<string>(values)).sort(
    (a: string, b: string): number => {
      if (a === b) {
        return 0;
      }

      return a < b ? -1 : 1;
    },
  );
};

export const readGlobalSameAsEnglish: (filePath?: string) => Array<string> = (
  filePath?: string,
): Array<string> => {
  const location: string = filePath || GLOBAL_SAME_AS_ENGLISH_PATH;

  if (!fs.existsSync(location)) {
    return [];
  }

  const parsed: unknown = JSON.parse(fs.readFileSync(location, "utf8"));

  if (!Array.isArray(parsed)) {
    throw new Error(`${location} must hold a JSON array of strings.`);
  }

  return parsed.map((value: unknown): string => {
    return String(value);
  });
};

export const serializeSameAsEnglish: (
  values: ReadonlyArray<string>,
) => string = (values: ReadonlyArray<string>): string => {
  return `${JSON.stringify(sortedUnique(values), null, 2)}\n`;
};

export const readLocaleProgress: (
  code: string,
  directory?: string,
) => LocaleProgress | undefined = (
  code: string,
  directory?: string,
): LocaleProgress | undefined => {
  const location: string = directory
    ? path.join(directory, `${code}.json`)
    : getProgressPath(code);

  if (!fs.existsSync(location)) {
    return undefined;
  }

  const parsed: Partial<LocaleProgress> = JSON.parse(
    fs.readFileSync(location, "utf8"),
  ) as Partial<LocaleProgress>;

  return {
    baseline: {
      keys: Number(parsed.baseline?.keys) || 0,
      untranslated: Number(parsed.baseline?.untranslated) || 0,
    },
    sameAsEnglish: Array.isArray(parsed.sameAsEnglish)
      ? parsed.sameAsEnglish.map((value: unknown): string => {
          return String(value);
        })
      : [],
  };
};

// The file text: fixed key order, the list sorted, a trailing newline.
export const serializeLocaleProgress: (progress: LocaleProgress) => string = (
  progress: LocaleProgress,
): string => {
  return `${JSON.stringify(
    {
      baseline: {
        keys: progress.baseline.keys,
        untranslated: progress.baseline.untranslated,
      },
      sameAsEnglish: sortedUnique(progress.sameAsEnglish),
    },
    null,
    2,
  )}\n`;
};

export const writeLocaleProgress: (
  code: string,
  progress: LocaleProgress,
  directory?: string,
) => void = (
  code: string,
  progress: LocaleProgress,
  directory?: string,
): void => {
  const location: string = directory
    ? path.join(directory, `${code}.json`)
    : getProgressPath(code);

  fs.mkdirSync(path.dirname(location), { recursive: true });
  fs.writeFileSync(location, serializeLocaleProgress(progress));
};

export type LocaleProblemKind =
  // A key the locale must have is absent.
  | "missing"
  // A key en.json does not have (and that is no plural form of one).
  | "extra"
  // An object where a string belongs, or the other way round.
  | "not-a-string"
  // An empty string: the reader would see nothing at all.
  | "empty"
  // {{placeholders}} differ from the English.
  | "placeholders"
  // Keys out of en.json's order, or formatting that is not canonical.
  | "not-canonical"
  // en.json only: a flat key whose English value is not the key itself.
  | "english-value";

export interface LocaleProblem {
  kind: LocaleProblemKind;
  key: string;
  detail?: string | undefined;
}

export interface UntranslatedEntry {
  key: string;
  english: string;
}

export interface LocaleStatus {
  locale: string;
  // Keys the locale must have.
  keys: number;
  untranslated: Array<UntranslatedEntry>;
  // Values identical to English that are right as they are.
  sameAsEnglish: number;
  problems: Array<LocaleProblem>;
}

interface ExpectedEntry {
  key: string;
  path: Array<string>;
  english: string;
  // A "_one" form the language never uses.
  isUnusedForm: boolean;
}

const LETTER: RegExp = /\p{L}/u;

const hasNoLetters: (text: string) => boolean = (text: string): boolean => {
  return !LETTER.test(text.replace(/\{\{[^{}]*\}\}/g, ""));
};

// Every key `code` must have, with the English it is compared against.
export const getExpectedEntries: (
  english: LocaleTree,
  code: string,
) => Array<ExpectedEntry> = (
  english: LocaleTree,
  code: string,
): Array<ExpectedEntry> => {
  const pluralBases: Set<string> = new Set<string>(getPluralBases(english));
  const categories: Array<PluralCategory> = getPluralCategories(code);
  const extraCategories: Array<PluralCategory> = getExtraPluralCategories(code);
  const entries: Array<ExpectedEntry> = [];

  for (const leaf of getLeaves(english)) {
    const key: string = getLeafId(leaf.path);
    const isPluralOne: boolean =
      leaf.path.length === 1 &&
      key.endsWith(PLURAL_ONE_SUFFIX) &&
      pluralBases.has(key.slice(0, -PLURAL_ONE_SUFFIX.length));

    entries.push({
      key: key,
      path: leaf.path,
      english: leaf.value,
      isUnusedForm: isPluralOne && !categories.includes("one"),
    });

    if (isPluralOne) {
      const base: string = key.slice(0, -PLURAL_ONE_SUFFIX.length);

      for (const category of extraCategories) {
        entries.push({
          key: `${base}_${category}`,
          path: [`${base}_${category}`],
          english: english[base] as string,
          isUnusedForm: false,
        });
      }
    }
  }

  return entries;
};

const samePlaceholders: (a: string, b: string) => boolean = (
  a: string,
  b: string,
): boolean => {
  return (
    getPlaceholders(a).join("\u0000") === getPlaceholders(b).join("\u0000")
  );
};

export interface LocaleStatusInput {
  code: string;
  english: LocaleTree;
  locale: LocaleTree;
  // The file's text, to check it is in canonical form; skipped if absent.
  localeText?: string | undefined;
  globalSameAsEnglish?: ReadonlyArray<string> | undefined;
  localeSameAsEnglish?: ReadonlyArray<string> | undefined;
}

export const getLocaleStatus: (input: LocaleStatusInput) => LocaleStatus = (
  input: LocaleStatusInput,
): LocaleStatus => {
  const allowed: Set<string> = new Set<string>([
    ...(input.globalSameAsEnglish || []),
    ...(input.localeSameAsEnglish || []),
  ]);
  const expected: Array<ExpectedEntry> = getExpectedEntries(
    input.english,
    input.code,
  );
  const expectedKeys: Set<string> = new Set<string>(
    expected.map((entry: ExpectedEntry): string => {
      return entry.key;
    }),
  );

  const untranslated: Array<UntranslatedEntry> = [];
  const problems: Array<LocaleProblem> = [];
  let sameAsEnglish: number = 0;

  for (const entry of expected) {
    const value: LocaleNode | undefined = getValueAt(input.locale, entry.path);

    if (value === undefined) {
      problems.push({ kind: "missing", key: entry.key });
      untranslated.push({ key: entry.key, english: entry.english });
      continue;
    }

    if (typeof value !== "string") {
      problems.push({ kind: "not-a-string", key: entry.key });
      untranslated.push({ key: entry.key, english: entry.english });
      continue;
    }

    if (value.trim() === "" && entry.english.trim() !== "") {
      problems.push({ kind: "empty", key: entry.key });
    }

    if (!samePlaceholders(value, entry.english)) {
      problems.push({
        kind: "placeholders",
        key: entry.key,
        detail: `expected ${JSON.stringify(
          getPlaceholders(entry.english),
        )}, found ${JSON.stringify(getPlaceholders(value))}`,
      });
    }

    if (value === entry.english) {
      if (
        entry.isUnusedForm ||
        hasNoLetters(entry.english) ||
        allowed.has(entry.english)
      ) {
        sameAsEnglish++;
      } else {
        untranslated.push({ key: entry.key, english: entry.english });
      }
    }
  }

  for (const leaf of getLeaves(input.locale)) {
    const key: string = getLeafId(leaf.path);

    if (!expectedKeys.has(key)) {
      problems.push({ kind: "extra", key: key });
    }
  }

  if (
    input.localeText !== undefined &&
    problems.length === 0 &&
    serializeLocale(
      alignLocale(input.english, input.locale, input.code).tree,
    ) !== input.localeText
  ) {
    problems.push({
      kind: "not-canonical",
      key: "",
      detail: "keys are not in en.json's order, or the formatting differs",
    });
  }

  return {
    locale: input.code,
    keys: expected.length,
    untranslated: untranslated,
    sameAsEnglish: sameAsEnglish,
    problems: problems,
  };
};

/*
 * en.json's own problems: a flat key's value must be the key itself (change
 * the key, not the value, to change the English), a "_one" plural form
 * excepted; nothing may be empty; the file must be canonical JSON.
 */
export const getEnglishProblems: (
  english: LocaleTree,
  englishText?: string,
) => Array<LocaleProblem> = (
  english: LocaleTree,
  englishText?: string,
): Array<LocaleProblem> => {
  const problems: Array<LocaleProblem> = [];
  const pluralBases: Set<string> = new Set<string>(getPluralBases(english));

  for (const leaf of getLeaves(english) as Array<LocaleLeaf>) {
    const key: string = getLeafId(leaf.path);

    if (leaf.value.trim() === "") {
      problems.push({ kind: "empty", key: key });
    }

    if (leaf.path.length !== 1) {
      continue;
    }

    // A "_one" form holds its own sentence, which may name other values.
    const isPluralOne: boolean =
      key.endsWith(PLURAL_ONE_SUFFIX) &&
      pluralBases.has(key.slice(0, -PLURAL_ONE_SUFFIX.length));

    if (!isPluralOne && leaf.value !== key) {
      problems.push({
        kind: "english-value",
        key: key,
        detail: `value is ${JSON.stringify(leaf.value)}`,
      });
    }
  }

  if (englishText !== undefined && serializeLocale(english) !== englishText) {
    problems.push({
      kind: "not-canonical",
      key: "",
      detail: "en.json is not two-space JSON with a trailing newline",
    });
  }

  return problems;
};

/*
 * How many translations were lost against the baseline: the untranslated
 * count's growth beyond the keys added since. Zero or less is fine.
 */
export const getBaselineRegression: (
  status: LocaleStatus,
  baseline: LocaleBaseline,
) => number = (status: LocaleStatus, baseline: LocaleBaseline): number => {
  return (
    status.untranslated.length -
    baseline.untranslated -
    (status.keys - baseline.keys)
  );
};

export const isEnglish: (code: string) => boolean = (code: string): boolean => {
  return code === ENGLISH;
};
