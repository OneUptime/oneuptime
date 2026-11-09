import {
  LOCALES_DIRECTORY,
  REPOSITORY_ROOT,
  TRANSLATED_LOCALES,
} from "../../FeatureSet/Dashboard/scripts/i18n/LocaleFiles";
import {
  LocaleProgress,
  readGlobalSameAsEnglish,
  readLocaleProgress,
} from "../../FeatureSet/Dashboard/scripts/i18n/LocaleStatus";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * EVERY PROGRESS BAR'S WORDS IN EVERY LANGUAGE (#6150's review).
 *
 * A progress bar says "3 of 5 essential steps done": its caller hands it
 * the words after the numbers (its suffix), in English, and the bar looks
 * them up. A suffix handed over as a bare string is never extracted, so
 * the setup checklist's "essential steps done" was English in every
 * language - "3 von 5 essential steps done" - and the Recommendations bar's
 * "recommended monitors created" had been too. And each language puts the
 * suffix where its own sentence needs it (Hindi after the count, Korean as
 * a label before the numbers - ProgressBarWordOrderInLocale), so a suffix
 * is worded for that place: "Datenspeichern geprüft" after German's "3 von
 * 7", "स्टोर जांचे गए" after Hindi's "7 में से 3".
 *
 * This reads every progress bar in the Dashboard, the shared components
 * and the Enterprise screens through the TypeScript syntax tree. A suffix
 * written out - a literal, a translationKey() constant of the same file, a
 * looked-up literal - must be a Dashboard key that every language words.
 * A suffix the bar is handed at run time (a model's plural name) is listed
 * below with where its words come from.
 */

const SOURCE_ROOTS: ReadonlyArray<string> = [
  "packages/App/FeatureSet/Dashboard/src",
  "packages/Common/UI",
  "ee/Dashboard",
];

/*
 * Suffixes a bar is handed at run time, by the expression that hands them:
 * a model's name, worded by the models' catalog of names.
 */
const SUFFIXES_GIVEN_AT_RUN_TIME: ReadonlyMap<string, string> = new Map<
  string,
  string
>([
  // ImportModelsModal: the imported model's plural name.
  ["pluralName", "a model's plural name"],
  // ModelProgress: the title its caller gives.
  ["props.title", "the caller's title"],
  // BulkUpdateForm: the list's plural label.
  ["options.pluralLabel", "the list's plural label"],
]);

// A suffix with no words of its own reads the same in every language.
const PLACEHOLDER: RegExp = /\{\{\s*[\w.]+\s*\}\}/g;
const LETTER: RegExp = /\p{L}/u;

interface ProgressBarSuffix {
  file: string;
  line: number;
  // The key the bar looks up, when it is written out.
  key?: string | undefined;
  // The expression that hands it over, when it is not.
  expression?: string | undefined;
}

function listFiles(directory: string): Array<string> {
  const absolute: string = path.join(REPOSITORY_ROOT, directory);
  const files: Array<string> = [];

  if (!fs.existsSync(absolute)) {
    return files;
  }

  const walk: (dir: string) => void = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full: string = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (entry.name !== "node_modules") {
          walk(full);
        }
      } else if (entry.name.endsWith(".tsx")) {
        files.push(full);
      }
    }
  };

  walk(absolute);

  return files.sort();
}

function tagName(
  element: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
): string {
  const name: string = element.tagName.getText();
  const lastDot: number = name.lastIndexOf(".");

  return lastDot > -1 ? name.slice(lastDot + 1) : name;
}

// The text a translationKey("...") constant of the file holds.
function keyOfConstant(
  source: ts.SourceFile,
  name: string,
): string | undefined {
  let key: string | undefined = undefined;

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name &&
      node.initializer &&
      ts.isCallExpression(node.initializer) &&
      node.initializer.arguments[0] &&
      ts.isStringLiteralLike(node.initializer.arguments[0])
    ) {
      key = node.initializer.arguments[0].text;
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  return key;
}

// The key a suffix's expression looks up, when it is written out.
function keyOf(
  expression: ts.Expression,
  source: ts.SourceFile,
): string | undefined {
  if (ts.isStringLiteralLike(expression)) {
    return expression.text;
  }

  if (ts.isIdentifier(expression)) {
    return keyOfConstant(source, expression.text);
  }

  // A looked-up literal: tx("steps completed").
  if (
    ts.isCallExpression(expression) &&
    expression.arguments.length === 1 &&
    ts.isStringLiteralLike(expression.arguments[0]!)
  ) {
    return expression.arguments[0].text;
  }

  return undefined;
}

function findSuffixes(file: string, text: string): Array<ProgressBarSuffix> {
  if (!text.includes("<ProgressBar")) {
    return [];
  }

  const source: ts.SourceFile = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const found: Array<ProgressBarSuffix> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) &&
      tagName(node) === "ProgressBar"
    ) {
      for (const property of node.attributes.properties) {
        if (
          !ts.isJsxAttribute(property) ||
          property.name.getText() !== "suffix" ||
          !property.initializer
        ) {
          continue;
        }

        const expression: ts.Expression | undefined = ts.isJsxExpression(
          property.initializer,
        )
          ? property.initializer.expression
          : (property.initializer as ts.Expression);

        if (!expression) {
          continue;
        }

        const key: string | undefined = keyOf(expression, source);

        found.push({
          file: file,
          line:
            source.getLineAndCharacterOfPosition(property.getStart(source))
              .line + 1,
          ...(key !== undefined
            ? { key }
            : { expression: expression.getText(source) }),
        });
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  return found;
}

const SUFFIXES: Array<ProgressBarSuffix> = SOURCE_ROOTS.flatMap(
  (root: string): Array<string> => {
    return listFiles(root);
  },
).flatMap((file: string): Array<ProgressBarSuffix> => {
  return findSuffixes(
    path.relative(REPOSITORY_ROOT, file).split(path.sep).join("/"),
    fs.readFileSync(file, "utf8"),
  );
});

const KEYS: Array<string> = Array.from(
  new Set<string>(
    SUFFIXES.filter((suffix: ProgressBarSuffix): boolean => {
      return suffix.key !== undefined;
    }).map((suffix: ProgressBarSuffix): string => {
      return suffix.key!;
    }),
  ),
).sort();

function readLocale(language: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIRECTORY, `${language}.json`), "utf8"),
  ) as Record<string, unknown>;
}

const ENGLISH: Record<string, unknown> = readLocale("en");
const GLOBAL_SAME_AS_ENGLISH: Set<string> = new Set<string>(
  readGlobalSameAsEnglish(),
);

// Whether `language` words `key` its own way, as npm run i18n:check counts it.
function isWorded(
  key: string,
  locale: Record<string, unknown>,
  sameAsEnglish: Set<string>,
): boolean {
  const value: unknown = locale[key];

  if (typeof value !== "string" || !value.trim()) {
    return false;
  }

  if (value !== key) {
    return true;
  }

  if (!LETTER.test(key.replace(PLACEHOLDER, ""))) {
    return true;
  }

  return GLOBAL_SAME_AS_ENGLISH.has(key) || sameAsEnglish.has(key);
}

function describeSuffix(suffix: ProgressBarSuffix): string {
  return `${suffix.file}:${suffix.line} ${suffix.key ?? suffix.expression}`;
}

describe("the progress bars' suffixes", () => {
  test("the scan finds the bars and what they count", () => {
    expect(SUFFIXES.length).toBeGreaterThanOrEqual(12);
    expect(KEYS).toEqual(
      expect.arrayContaining([
        "essential steps done",
        "recommended monitors created",
        "steps completed",
        "stores checked",
        "stores with their content scanned",
        "monitors",
        "rules",
      ]),
    );
  });

  test("a suffix not written out is one this suite knows the words of", () => {
    const unlisted: Array<string> = SUFFIXES.filter(
      (suffix: ProgressBarSuffix): boolean => {
        return (
          suffix.key === undefined &&
          !SUFFIXES_GIVEN_AT_RUN_TIME.has(suffix.expression || "")
        );
      },
    ).map(describeSuffix);

    /*
     * Write the suffix as a translationKey() constant, or list the
     * expression above with where its words come from.
     */
    expect(unlisted).toEqual([]);
  });

  test("every suffix written out is a Dashboard key", () => {
    expect(
      KEYS.filter((key: string): boolean => {
        return ENGLISH[key] !== key;
      }),
    ).toEqual([]);
  });

  test.each(TRANSLATED_LOCALES)("%s words every suffix", (language: string) => {
    const progress: LocaleProgress | undefined = readLocaleProgress(language);
    const sameAsEnglish: Set<string> = new Set<string>(
      progress ? progress.sameAsEnglish : [],
    );
    const locale: Record<string, unknown> = readLocale(language);

    expect(
      KEYS.filter((key: string): boolean => {
        return !isWorded(key, locale, sameAsEnglish);
      }),
    ).toEqual([]);
  });
});
