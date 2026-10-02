import {
  getEnglishEntries,
  getNestedEnglishEntries,
  HardcodedString,
  scanSourceRoots,
  SOURCE_ROOTS,
  SourceRoot,
  SourceScanResult,
  UndefinedNestedKey,
} from "./ExtractStrings";
import {
  AlignedLocale,
  alignLocale,
  ENGLISH,
  getValueAt,
  insertEnglishKeys,
  insertNestedEnglishKeys,
  isLocaleTree,
  LOCALES_DIRECTORY,
  LocaleNode,
  LocaleTree,
  readLocaleFile,
  ReadLocaleResult,
  REPOSITORY_ROOT,
  StageReader,
  TRACKING_DIRECTORY,
  TRANSLATED_LOCALES,
  updateEnglishPluralForms,
  writeLocaleFile,
} from "./LocaleFiles";
import {
  getBaselineRegression,
  getEnglishProblems,
  getExpectedEntries,
  getLocaleStatus,
  LocaleProblem,
  LocaleProgress,
  LocaleStatus,
  readGlobalSameAsEnglish,
  readLocaleProgress,
  writeLocaleProgress,
} from "./LocaleStatus";
import fs from "fs";
import path from "path";

/*
 * npm run i18n:<command> (from packages/App/FeatureSet/Dashboard) - the
 * Dashboard's translation tooling. See src/Locales/README.md.
 *
 *   extract    find user-facing strings in the source, add the new ones to
 *              en.json, and line every locale up with en.json (English
 *              placeholders for new keys). Also puts locale files git could
 *              not merge back together.
 *   check      what each locale still has to translate, and whether its file
 *              is sound; exits 1 on a broken file or a lost translation.
 *   export     one locale's untranslated strings, as JSON to translate.
 *   apply      write translations from such a JSON file into one locale.
 *   baseline   record each locale's progress so it can never go backwards.
 *   hardcoded  strings on screen that are not looked up at run time.
 */

export interface I18nContext {
  repositoryRoot: string;
  localesDirectory: string;
  // Holds SameAsEnglish.json and Progress/<code>.json.
  trackingDirectory: string;
  sourceRoots: ReadonlyArray<SourceRoot>;
  // The locales besides English.
  locales: ReadonlyArray<string>;
  readStage?: StageReader | undefined;
  write: (text: string) => void;
}

export const getDefaultContext: () => I18nContext = (): I18nContext => {
  return {
    repositoryRoot: REPOSITORY_ROOT,
    localesDirectory: LOCALES_DIRECTORY,
    trackingDirectory: TRACKING_DIRECTORY,
    sourceRoots: SOURCE_ROOTS,
    locales: TRANSLATED_LOCALES,
    write: (text: string): void => {
      process.stdout.write(text);
    },
  };
};

const formatCount: (value: number) => string = (value: number): string => {
  return value.toLocaleString("en-US");
};

const getProgressDirectory: (context: I18nContext) => string = (
  context: I18nContext,
): string => {
  return path.join(context.trackingDirectory, "Progress");
};

const readSameAsEnglish: (context: I18nContext) => Array<string> = (
  context: I18nContext,
): Array<string> => {
  return readGlobalSameAsEnglish(
    path.join(context.trackingDirectory, "SameAsEnglish.json"),
  );
};

const readEnglish: (context: I18nContext) => ReadLocaleResult = (
  context: I18nContext,
): ReadLocaleResult => {
  return readLocaleFile(ENGLISH, {
    directory: context.localesDirectory,
    readStage: context.readStage,
  });
};

const readLocaleText: (context: I18nContext, code: string) => string = (
  context: I18nContext,
  code: string,
): string => {
  return fs.readFileSync(
    path.join(context.localesDirectory, `${code}.json`),
    "utf8",
  );
};

export interface ExtractOptions {
  dryRun?: boolean | undefined;
}

export interface ExtractSummary {
  scannedStrings: number;
  addedKeys: Array<string>;
  addedNestedKeys: Array<string>;
  updatedPluralForms: Array<string>;
  nestedKeyClashes: Array<string>;
  undefinedNestedKeys: Array<UndefinedNestedKey>;
  resolvedConflicts: Array<string>;
  changedFiles: Array<string>;
  placeholdersAdded: Record<string, number>;
  removedKeys: Record<string, Array<string>>;
}

/*
 * Scans the sources, adds what en.json lacks, and rewrites every locale to
 * mirror en.json. Nothing already in a file is lost: existing keys keep their
 * place and their translations, and keys only en.json dropped are removed.
 */
export const runExtract: (
  context: I18nContext,
  options?: ExtractOptions,
) => ExtractSummary = (
  context: I18nContext,
  options?: ExtractOptions,
): ExtractSummary => {
  const scan: SourceScanResult = scanSourceRoots(
    context.sourceRoots,
    context.repositoryRoot,
  );

  const resolvedConflicts: Array<string> = [];
  const englishFile: ReadLocaleResult = readEnglish(context);

  if (englishFile.hadConflicts) {
    resolvedConflicts.push(`${ENGLISH}.json`);
  }

  const flatEntries: Record<string, string> = getEnglishEntries(scan.strings);
  const pluralFormsUpdated: Array<string> = updateEnglishPluralForms(
    englishFile.tree,
    flatEntries,
  );
  const flat: { tree: LocaleTree; added: Array<string> } = insertEnglishKeys(
    englishFile.tree,
    flatEntries,
  );
  const nested: {
    tree: LocaleTree;
    added: Array<string>;
    clashes: Array<string>;
  } = insertNestedEnglishKeys(flat.tree, getNestedEnglishEntries(scan.strings));
  const english: LocaleTree = nested.tree;

  // A nested key no call gives English for, and en.json does not have.
  const undefinedNestedKeys: Array<UndefinedNestedKey> =
    scan.nestedKeyReferences.filter(
      (reference: UndefinedNestedKey): boolean => {
        return typeof getValueAt(english, reference.path) !== "string";
      },
    );

  const changedFiles: Array<string> = [];
  const placeholdersAdded: Record<string, number> = {};
  const removedKeys: Record<string, Array<string>> = {};

  if (!options?.dryRun) {
    if (writeLocaleFile(ENGLISH, english, context.localesDirectory)) {
      changedFiles.push(`${ENGLISH}.json`);
    }
  }

  for (const code of context.locales) {
    const localeFile: ReadLocaleResult = readLocaleFile(code, {
      directory: context.localesDirectory,
      english: english,
      readStage: context.readStage,
    });

    if (localeFile.hadConflicts) {
      resolvedConflicts.push(`${code}.json`);
    }

    const aligned: AlignedLocale = alignLocale(english, localeFile.tree);

    placeholdersAdded[code] = aligned.placeholdersAdded.length;
    removedKeys[code] = aligned.removed;

    if (!options?.dryRun) {
      if (writeLocaleFile(code, aligned.tree, context.localesDirectory)) {
        changedFiles.push(`${code}.json`);
      }
    }
  }

  const summary: ExtractSummary = {
    scannedStrings: scan.strings.length,
    addedKeys: flat.added,
    addedNestedKeys: nested.added,
    updatedPluralForms: pluralFormsUpdated,
    nestedKeyClashes: nested.clashes,
    undefinedNestedKeys: undefinedNestedKeys,
    resolvedConflicts: resolvedConflicts,
    changedFiles: changedFiles,
    placeholdersAdded: placeholdersAdded,
    removedKeys: removedKeys,
  };

  const lines: Array<string> = [
    `Found ${formatCount(scan.strings.length)} user-facing strings in ${context.sourceRoots.length} source roots.`,
    `en.json: ${formatCount(flat.added.length)} new keys, ${formatCount(nested.added.length)} new nested keys, ${formatCount(pluralFormsUpdated.length)} plural forms updated.`,
  ];

  if (resolvedConflicts.length > 0) {
    lines.push(`Merged both sides of: ${resolvedConflicts.join(", ")}.`);
  }

  for (const code of context.locales) {
    const removed: Array<string> = removedKeys[code] || [];

    if ((placeholdersAdded[code] || 0) > 0 || removed.length > 0) {
      lines.push(
        `${code}.json: ${formatCount(placeholdersAdded[code] || 0)} English placeholders added${
          removed.length > 0
            ? `, ${formatCount(removed.length)} keys en.json no longer has removed`
            : ""
        }.`,
      );
    }
  }

  for (const clash of nested.clashes) {
    lines.push(`Not added: ${clash} - part of that path is already a string.`);
  }

  for (const reference of undefinedNestedKeys) {
    lines.push(
      `Undefined nested key ${reference.path.join(".")} at ${reference.file}:${reference.line} - give t() an English default or add it to en.json.`,
    );
  }

  lines.push(
    options?.dryRun
      ? "Dry run: nothing written."
      : changedFiles.length > 0
        ? `Wrote ${changedFiles.join(", ")}.`
        : "Every locale file was already up to date.",
  );

  context.write(`${lines.join("\n")}\n`);

  return summary;
};

export interface CheckOptions {
  locales?: ReadonlyArray<string> | undefined;
  list?: boolean | undefined;
  json?: boolean | undefined;
}

export interface CheckLocaleResult {
  status: LocaleStatus;
  baselineRegression: number | undefined;
}

export interface CheckResult {
  englishProblems: Array<LocaleProblem>;
  locales: Array<CheckLocaleResult>;
  exitCode: number;
}

export const getCheckResult: (
  context: I18nContext,
  options?: CheckOptions,
) => CheckResult = (
  context: I18nContext,
  options?: CheckOptions,
): CheckResult => {
  const englishText: string = readLocaleText(context, ENGLISH);
  const english: LocaleTree = JSON.parse(englishText) as LocaleTree;
  const englishProblems: Array<LocaleProblem> = getEnglishProblems(
    english,
    englishText,
  );
  const sameAsEnglish: Array<string> = readSameAsEnglish(context);
  const codes: ReadonlyArray<string> =
    options?.locales && options.locales.length > 0
      ? options.locales
      : context.locales;

  const locales: Array<CheckLocaleResult> = codes.map(
    (code: string): CheckLocaleResult => {
      const text: string = readLocaleText(context, code);
      const progress: LocaleProgress | undefined = readLocaleProgress(
        code,
        getProgressDirectory(context),
      );
      let locale: LocaleTree;

      try {
        locale = JSON.parse(text) as LocaleTree;
      } catch {
        return {
          status: {
            locale: code,
            keys: 0,
            untranslated: [],
            sameAsEnglish: 0,
            problems: [
              {
                kind: "not-canonical",
                key: "",
                detail:
                  "not valid JSON - a merge conflict? Run npm run i18n:extract",
              },
            ],
          },
          baselineRegression: undefined,
        };
      }

      const status: LocaleStatus = getLocaleStatus({
        code: code,
        english: english,
        locale: locale,
        localeText: text,
        globalSameAsEnglish: sameAsEnglish,
        localeSameAsEnglish: progress?.sameAsEnglish,
      });

      return {
        status: status,
        baselineRegression: progress
          ? getBaselineRegression(status, progress.baseline)
          : undefined,
      };
    },
  );

  const failed: boolean =
    englishProblems.length > 0 ||
    locales.some((result: CheckLocaleResult): boolean => {
      return (
        result.status.problems.length > 0 ||
        (result.baselineRegression !== undefined &&
          result.baselineRegression > 0)
      );
    });

  return {
    englishProblems: englishProblems,
    locales: locales,
    exitCode: failed ? 1 : 0,
  };
};

const describeProblem: (problem: LocaleProblem) => string = (
  problem: LocaleProblem,
): string => {
  return `${problem.kind}${problem.key ? ` ${JSON.stringify(problem.key)}` : ""}${
    problem.detail ? ` (${problem.detail})` : ""
  }`;
};

export const runCheck: (
  context: I18nContext,
  options?: CheckOptions,
) => number = (context: I18nContext, options?: CheckOptions): number => {
  const result: CheckResult = getCheckResult(context, options);

  if (options?.json) {
    context.write(
      `${JSON.stringify(
        {
          englishProblems: result.englishProblems,
          locales: result.locales.map(
            (locale: CheckLocaleResult): Record<string, unknown> => {
              return {
                locale: locale.status.locale,
                keys: locale.status.keys,
                untranslated: locale.status.untranslated.length,
                sameAsEnglish: locale.status.sameAsEnglish,
                problems: locale.status.problems,
                baselineRegression: locale.baselineRegression ?? null,
                ...(options.list
                  ? { untranslatedKeys: locale.status.untranslated }
                  : {}),
              };
            },
          ),
          exitCode: result.exitCode,
        },
        null,
        2,
      )}\n`,
    );

    return result.exitCode;
  }

  const lines: Array<string> = [];

  for (const problem of result.englishProblems.slice(0, 20)) {
    lines.push(`en: ${describeProblem(problem)}`);
  }

  lines.push(
    [
      "locale".padEnd(7),
      "keys".padStart(8),
      "untranslated".padStart(19),
      "same as English".padStart(16),
      "problems".padStart(9),
      "  baseline",
    ].join(""),
  );

  for (const locale of result.locales) {
    const status: LocaleStatus = locale.status;
    const percent: string =
      status.keys > 0
        ? `${Math.round((status.untranslated.length / status.keys) * 100)}%`
        : "-";
    const baseline: string =
      locale.baselineRegression === undefined
        ? "none recorded"
        : locale.baselineRegression > 0
          ? `${formatCount(locale.baselineRegression)} translations lost`
          : "ok";

    lines.push(
      [
        status.locale.padEnd(7),
        formatCount(status.keys).padStart(8),
        `${formatCount(status.untranslated.length)} (${percent})`.padStart(19),
        formatCount(status.sameAsEnglish).padStart(16),
        formatCount(status.problems.length).padStart(9),
        `  ${baseline}`,
      ].join(""),
    );
  }

  for (const locale of result.locales) {
    for (const problem of locale.status.problems.slice(0, 20)) {
      lines.push(`${locale.status.locale}: ${describeProblem(problem)}`);
    }

    if (locale.status.problems.length > 20) {
      lines.push(
        `${locale.status.locale}: ... and ${formatCount(
          locale.status.problems.length - 20,
        )} more problems`,
      );
    }
  }

  if (options?.list) {
    for (const locale of result.locales) {
      for (const entry of locale.status.untranslated) {
        lines.push(`${locale.status.locale}\t${entry.key}`);
      }
    }
  }

  lines.push(
    result.exitCode === 0
      ? "Every locale file is sound and no translation was lost."
      : "Fix the problems above (npm run i18n:extract repairs order, missing keys and merge conflicts).",
  );

  context.write(`${lines.join("\n")}\n`);

  return result.exitCode;
};

export interface ExportOptions {
  locale: string;
  limit?: number | undefined;
  offset?: number | undefined;
  out?: string | undefined;
}

/*
 * The locale's untranslated strings as { key: English }, in en.json's order:
 * the file a translator fills in and hands to `apply`.
 */
export const runExport: (
  context: I18nContext,
  options: ExportOptions,
) => number = (context: I18nContext, options: ExportOptions): number => {
  const result: CheckResult = getCheckResult(context, {
    locales: [options.locale],
  });
  const status: LocaleStatus = result.locales[0]!.status;
  const offset: number = Math.max(0, options.offset || 0);
  const entries: Array<{ key: string; english: string }> =
    status.untranslated.slice(
      offset,
      options.limit ? offset + options.limit : undefined,
    );
  const output: Record<string, string> = {};

  for (const entry of entries) {
    output[entry.key] = entry.english;
  }

  const text: string = `${JSON.stringify(output, null, 2)}\n`;

  if (options.out) {
    fs.writeFileSync(options.out, text);
    context.write(
      `Wrote ${formatCount(entries.length)} of ${formatCount(
        status.untranslated.length,
      )} untranslated ${options.locale} strings to ${options.out}.\n`,
    );
  } else {
    context.write(text);
  }

  return 0;
};

export interface ApplyOptions {
  locale: string;
  file: string;
  // Record values identical to English as correct, instead of skipping them.
  sameAsEnglish?: boolean | undefined;
}

export interface ApplyResult {
  applied: number;
  recordedSameAsEnglish: number;
  rejected: Array<{ key: string; reason: string }>;
  exitCode: number;
}

const setValueAt: (
  tree: LocaleTree,
  leafPath: Array<string>,
  value: string,
) => void = (
  tree: LocaleTree,
  leafPath: Array<string>,
  value: string,
): void => {
  let node: LocaleTree = tree;

  for (const key of leafPath.slice(0, -1)) {
    const child: LocaleNode | undefined = node[key];

    if (!isLocaleTree(child)) {
      node[key] = {};
    }

    node = node[key] as LocaleTree;
  }

  node[leafPath[leafPath.length - 1] as string] = value;
};

/*
 * Writes a { key: translation } file into one locale. Every value is checked
 * against the key's English: it must be a non-empty string with the same
 * {{placeholders}}. A value identical to English is skipped unless
 * --same-as-english says it reads the same in this language, which records it
 * in the locale's sameAsEnglish list.
 */
export const runApply: (
  context: I18nContext,
  options: ApplyOptions,
) => ApplyResult = (
  context: I18nContext,
  options: ApplyOptions,
): ApplyResult => {
  if (!context.locales.includes(options.locale)) {
    throw new Error(
      `Unknown locale "${options.locale}". Use one of: ${context.locales.join(", ")}.`,
    );
  }

  const english: LocaleTree = readEnglish(context).tree;
  const locale: LocaleTree = readLocaleFile(options.locale, {
    directory: context.localesDirectory,
    english: english,
    readStage: context.readStage,
  }).tree;
  const translations: unknown = JSON.parse(
    fs.readFileSync(options.file, "utf8"),
  );

  if (!isLocaleTree(translations)) {
    throw new Error(`${options.file} must hold a JSON object of strings.`);
  }

  const expected: Map<string, { path: Array<string>; english: string }> =
    new Map<string, { path: Array<string>; english: string }>();

  for (const entry of getExpectedEntries(english, options.locale)) {
    expected.set(entry.key, { path: entry.path, english: entry.english });
  }

  const progressDirectory: string = getProgressDirectory(context);
  const progress: LocaleProgress = readLocaleProgress(
    options.locale,
    progressDirectory,
  ) || { baseline: { keys: 0, untranslated: 0 }, sameAsEnglish: [] };

  const rejected: Array<{ key: string; reason: string }> = [];
  let applied: number = 0;
  let recordedSameAsEnglish: number = 0;

  const placeholdersOf: (text: string) => string = (text: string): string => {
    return Array.from(text.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g))
      .map((match: RegExpMatchArray): string => {
        return (match[1] as string).trim();
      })
      .sort()
      .filter((name: string, index: number, all: Array<string>): boolean => {
        return all.indexOf(name) === index;
      })
      .join(",");
  };

  for (const key of Object.keys(translations)) {
    const value: LocaleNode | undefined = translations[key];
    const target: { path: Array<string>; english: string } | undefined =
      expected.get(key);

    if (!target) {
      rejected.push({ key: key, reason: "no such key in en.json" });
      continue;
    }

    if (typeof value !== "string" || value.trim() === "") {
      rejected.push({ key: key, reason: "the translation must be text" });
      continue;
    }

    if (placeholdersOf(value) !== placeholdersOf(target.english)) {
      rejected.push({
        key: key,
        reason: `keep the placeholders of ${JSON.stringify(target.english)}`,
      });
      continue;
    }

    if (value === target.english) {
      if (!options.sameAsEnglish) {
        rejected.push({
          key: key,
          reason:
            "identical to English - pass --same-as-english if it reads the same in this language",
        });
        continue;
      }

      progress.sameAsEnglish.push(target.english);
      recordedSameAsEnglish++;
    }

    setValueAt(locale, target.path, value);
    applied++;
  }

  writeLocaleFile(
    options.locale,
    alignLocale(english, locale).tree,
    context.localesDirectory,
  );

  if (recordedSameAsEnglish > 0) {
    writeLocaleProgress(options.locale, progress, progressDirectory);
  }

  const lines: Array<string> = [
    `${options.locale}.json: ${formatCount(applied)} translations written${
      recordedSameAsEnglish > 0
        ? `, ${formatCount(recordedSameAsEnglish)} recorded as the same as English`
        : ""
    }, ${formatCount(rejected.length)} rejected.`,
  ];

  for (const rejection of rejected.slice(0, 50)) {
    lines.push(
      `  rejected ${JSON.stringify(rejection.key)}: ${rejection.reason}`,
    );
  }

  if (rejected.length > 50) {
    lines.push(`  ... and ${formatCount(rejected.length - 50)} more`);
  }

  lines.push(
    "Run npm run i18n:baseline -- --locale " +
      `${options.locale} to record the progress.`,
  );

  context.write(`${lines.join("\n")}\n`);

  return {
    applied: applied,
    recordedSameAsEnglish: recordedSameAsEnglish,
    rejected: rejected,
    exitCode: rejected.length > 0 ? 1 : 0,
  };
};

export interface BaselineOptions {
  locales?: ReadonlyArray<string> | undefined;
  // Accept a baseline that records lost translations.
  force?: boolean | undefined;
}

/*
 * Records each locale's current keys and untranslated count as its new
 * baseline - unless that would allow translations to be lost (an
 * untranslated count that grew beyond the keys added), which needs --force.
 */
export const runBaseline: (
  context: I18nContext,
  options?: BaselineOptions,
) => number = (context: I18nContext, options?: BaselineOptions): number => {
  const result: CheckResult = getCheckResult(context, {
    locales: options?.locales,
  });
  const lines: Array<string> = [];
  let exitCode: number = 0;

  for (const locale of result.locales) {
    const code: string = locale.status.locale;

    if (locale.status.problems.length > 0) {
      lines.push(
        `${code}: not recorded - fix its ${formatCount(locale.status.problems.length)} problems first (npm run i18n:check).`,
      );
      exitCode = 1;
      continue;
    }

    if (
      locale.baselineRegression !== undefined &&
      locale.baselineRegression > 0 &&
      !options?.force
    ) {
      lines.push(
        `${code}: not recorded - ${formatCount(locale.baselineRegression)} translations were lost since the baseline. Restore them, or pass --force.`,
      );
      exitCode = 1;
      continue;
    }

    const progressDirectory: string = getProgressDirectory(context);
    const current: LocaleProgress | undefined = readLocaleProgress(
      code,
      progressDirectory,
    );

    writeLocaleProgress(
      code,
      {
        baseline: {
          keys: locale.status.keys,
          untranslated: locale.status.untranslated.length,
        },
        sameAsEnglish: current?.sameAsEnglish || [],
      },
      progressDirectory,
    );

    lines.push(
      `${code}: baseline ${formatCount(locale.status.untranslated.length)} untranslated of ${formatCount(locale.status.keys)} keys.`,
    );
  }

  context.write(`${lines.join("\n")}\n`);

  return exitCode;
};

export interface HardcodedOptions {
  // Only files under this path (repository-relative or Dashboard src-relative).
  directory?: string | undefined;
  summary?: boolean | undefined;
}

const DASHBOARD_SOURCE_PREFIX: string =
  "packages/App/FeatureSet/Dashboard/src/";

/*
 * The group a file's strings are counted under in --summary: two levels below
 * the Dashboard's src (Pages/Ceph, Components/SessionReplay) or below
 * Common/UI (Components/Forms).
 */
export const getHardcodedGroup: (file: string) => string = (
  file: string,
): string => {
  if (file.startsWith(DASHBOARD_SOURCE_PREFIX)) {
    const parts: Array<string> = file
      .slice(DASHBOARD_SOURCE_PREFIX.length)
      .split("/");

    return parts.length > 2
      ? parts.slice(0, 2).join("/")
      : (parts[0] as string);
  }

  const parts: Array<string> = file.split("/");

  return parts.slice(0, Math.min(parts.length - 1, 5)).join("/");
};

export const getHardcodedStrings: (
  context: I18nContext,
  options?: HardcodedOptions,
) => Array<HardcodedString> = (
  context: I18nContext,
  options?: HardcodedOptions,
): Array<HardcodedString> => {
  const roots: Array<SourceRoot> = context.sourceRoots.filter(
    (root: SourceRoot): boolean => {
      return root.kind === "ui";
    },
  );
  const filter: string | undefined = options?.directory
    ?.replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/$/, "");

  return scanSourceRoots(roots, context.repositoryRoot).hardcoded.filter(
    (entry: HardcodedString): boolean => {
      if (!filter) {
        return true;
      }

      return (
        entry.file.startsWith(`${filter}/`) ||
        entry.file === filter ||
        entry.file.startsWith(`${DASHBOARD_SOURCE_PREFIX}${filter}/`) ||
        entry.file === `${DASHBOARD_SOURCE_PREFIX}${filter}`
      );
    },
  );
};

export const runHardcoded: (
  context: I18nContext,
  options?: HardcodedOptions,
) => number = (context: I18nContext, options?: HardcodedOptions): number => {
  const strings: Array<HardcodedString> = getHardcodedStrings(context, options);
  const lines: Array<string> = [];

  if (options?.summary) {
    const groups: Map<string, Record<string, number>> = new Map<
      string,
      Record<string, number>
    >();

    for (const entry of strings) {
      const group: string = getHardcodedGroup(entry.file);
      const counts: Record<string, number> = groups.get(group) || {};

      counts[entry.reason] = (counts[entry.reason] || 0) + 1;
      groups.set(group, counts);
    }

    const total: (counts: Record<string, number>) => number = (
      counts: Record<string, number>,
    ): number => {
      return Object.values(counts).reduce((sum: number, value: number) => {
        return sum + value;
      }, 0);
    };

    const sorted: Array<[string, Record<string, number>]> = Array.from(
      groups.entries(),
    ).sort(
      (
        a: [string, Record<string, number>],
        b: [string, Record<string, number>],
      ): number => {
        return total(b[1]) - total(a[1]) || (a[0] < b[0] ? -1 : 1);
      },
    );

    lines.push(
      `${"total".padStart(6)}${"text".padStart(7)}${"html".padStart(7)}${"composed".padStart(10)}  directory`,
    );

    for (const [group, counts] of sorted) {
      lines.push(
        `${String(total(counts)).padStart(6)}${String(counts["jsx-text"] || 0).padStart(7)}${String(counts["html-attribute"] || 0).padStart(7)}${String(counts["composed"] || 0).padStart(10)}  ${group}`,
      );
    }
  } else {
    for (const entry of strings) {
      lines.push(`${entry.file}:${entry.line}\t${entry.reason}\t${entry.text}`);
    }
  }

  lines.push(`${formatCount(strings.length)} hard-coded strings.`);
  context.write(`${lines.join("\n")}\n`);

  return 0;
};

interface ParsedArguments {
  command: string | undefined;
  flags: Map<string, Array<string>>;
}

export const parseArguments: (
  argv: ReadonlyArray<string>,
) => ParsedArguments = (argv: ReadonlyArray<string>): ParsedArguments => {
  const flags: Map<string, Array<string>> = new Map<string, Array<string>>();
  let command: string | undefined = undefined;

  for (let index: number = 0; index < argv.length; index++) {
    const argument: string = argv[index] as string;

    if (argument.startsWith("--")) {
      const [name, inlineValue] = argument.slice(2).split("=", 2) as [
        string,
        string | undefined,
      ];
      const next: string | undefined = argv[index + 1];
      let value: string = "true";

      if (inlineValue !== undefined) {
        value = inlineValue;
      } else if (next !== undefined && !next.startsWith("--")) {
        value = next;
        index++;
      }

      flags.set(name, [...(flags.get(name) || []), value]);
    } else if (command === undefined) {
      command = argument;
    }
  }

  return { command: command, flags: flags };
};

const USAGE: string = `Usage: npm run i18n:<command> -- [options]   (in packages/App/FeatureSet/Dashboard)

  i18n:extract    [--dry-run]
  i18n:check      [--locale <code>[,<code>]] [--list] [--json]
  i18n:export     --locale <code> [--limit <n>] [--offset <n>] [--out <file>]
  i18n:apply      --locale <code> --file <file> [--same-as-english]
  i18n:baseline   [--locale <code>[,<code>]] [--force]
  i18n:hardcoded  [--dir <path>] [--summary]

See src/Locales/README.md.
`;

export const main: (
  argv: ReadonlyArray<string>,
  context?: I18nContext,
) => number = (argv: ReadonlyArray<string>, context?: I18nContext): number => {
  const activeContext: I18nContext = context || getDefaultContext();
  const parsed: ParsedArguments = parseArguments(argv);
  const flag: (name: string) => string | undefined = (
    name: string,
  ): string | undefined => {
    const values: Array<string> | undefined = parsed.flags.get(name);

    return values ? values[values.length - 1] : undefined;
  };
  const isOn: (name: string) => boolean = (name: string): boolean => {
    return flag(name) !== undefined && flag(name) !== "false";
  };
  const locales: Array<string> = (parsed.flags.get("locale") || [])
    .flatMap((value: string): Array<string> => {
      return value.split(",");
    })
    .map((value: string): string => {
      return value.trim();
    })
    .filter(Boolean);

  for (const code of locales) {
    if (!activeContext.locales.includes(code)) {
      activeContext.write(
        `Unknown locale "${code}". Use one of: ${activeContext.locales.join(", ")}.\n`,
      );
      return 2;
    }
  }

  switch (parsed.command) {
    case "extract":
      runExtract(activeContext, { dryRun: isOn("dry-run") });
      return 0;
    case "check":
      return runCheck(activeContext, {
        locales: locales,
        list: isOn("list"),
        json: isOn("json"),
      });
    case "export":
      if (locales.length !== 1) {
        activeContext.write("export needs exactly one --locale.\n");
        return 2;
      }

      return runExport(activeContext, {
        locale: locales[0] as string,
        limit: flag("limit") ? Number(flag("limit")) : undefined,
        offset: flag("offset") ? Number(flag("offset")) : undefined,
        out: flag("out"),
      });
    case "apply":
      if (locales.length !== 1 || !flag("file")) {
        activeContext.write("apply needs one --locale and a --file.\n");
        return 2;
      }

      return runApply(activeContext, {
        locale: locales[0] as string,
        file: flag("file") as string,
        sameAsEnglish: isOn("same-as-english"),
      }).exitCode;
    case "baseline":
      return runBaseline(activeContext, {
        locales: locales,
        force: isOn("force"),
      });
    case "hardcoded":
      return runHardcoded(activeContext, {
        directory: flag("dir"),
        summary: isOn("summary"),
      });
    default:
      activeContext.write(USAGE);
      return parsed.command === undefined || parsed.command === "help" ? 0 : 2;
  }
};

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}
