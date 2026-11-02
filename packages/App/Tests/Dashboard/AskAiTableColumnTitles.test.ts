import {
  SOURCE_ROOTS,
  SourceRoot,
} from "../../FeatureSet/Dashboard/scripts/i18n/ExtractStrings";
import {
  getLocalePath,
  parseLocaleText,
  LocaleTree,
  REPOSITORY_ROOT,
  TRANSLATED_LOCALES,
} from "../../FeatureSet/Dashboard/scripts/i18n/LocaleFiles";
import {
  readGlobalSameAsEnglish,
  readLocaleProgress,
} from "../../FeatureSet/Dashboard/scripts/i18n/LocaleStatus";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * EVERY COLUMN OF ONEUPTIME AI'S TABLES IS NAMED IN THE READER'S LANGUAGE.
 *
 * A tool puts a table beside its answer - the logs it found, who is on
 * call, the slowest pages - and names its columns in English. The chat
 * draws each name in the reader's language (DataTableWidget looks it up),
 * so every name a tool writes is marked as a key - translationKey("Last
 * seen") - in Common/Server/Utils/AI/Toolbox, which the extractor reads as
 * a keys root, and every one of them is translated in all sixteen
 * languages. A new tool, or a new column, that names it in plain English
 * fails here: the name would read in English in every language.
 *
 * A column named after what the tool read (an attribute it grouped by)
 * is drawn as written, and is listed below.
 */

const TOOLBOX_DIRECTORY: string = "packages/Common/Server/Utils/AI/Toolbox";

// A name with no letter ("#") reads the same in every language, as en.json leaves it out.
const LETTER_REGEX: RegExp = /\p{L}/u;

interface ComputedTitle {
  // Toolbox-relative, with "/".
  file: string;
  // The title's expression, as written.
  expression: string;
  why: string;
}

export const COMPUTED_TITLES: ReadonlyArray<ComputedTitle> = [
  {
    file: "TraceTools.ts",
    expression: "groupBy",
    why: "the span attribute the analytics grouped by (service.name, http.route), named as the trace has it",
  },
];

interface ColumnTitle {
  file: string;
  line: number;
  // The English name, when the tool marks it.
  marked?: string | undefined;
  // The expression, when it is not a marked string.
  expression: string;
}

function listToolboxFiles(): Array<string> {
  const directory: string = path.join(REPOSITORY_ROOT, TOOLBOX_DIRECTORY);

  return fs
    .readdirSync(directory)
    .filter((name: string): boolean => {
      return name.endsWith(".ts");
    })
    .sort();
}

/*
 * The column objects of the tools' tables: an object literal with a key
 * and a title, and a type at most (AIChatWidgetColumn).
 */
function findColumnTitles(): Array<ColumnTitle> {
  const titles: Array<ColumnTitle> = [];

  for (const file of listToolboxFiles()) {
    const fullPath: string = path.join(
      REPOSITORY_ROOT,
      TOOLBOX_DIRECTORY,
      file,
    );
    const source: ts.SourceFile = ts.createSourceFile(
      fullPath,
      fs.readFileSync(fullPath, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );

    const visit: (node: ts.Node) => void = (node: ts.Node): void => {
      if (ts.isObjectLiteralExpression(node)) {
        const assignments: Map<string, ts.PropertyAssignment> = new Map();

        for (const property of node.properties) {
          if (
            ts.isPropertyAssignment(property) &&
            (ts.isIdentifier(property.name) ||
              ts.isStringLiteral(property.name))
          ) {
            assignments.set(property.name.text, property);
          }
        }

        const names: Array<string> = Array.from(assignments.keys());
        const title: ts.PropertyAssignment | undefined =
          assignments.get("title");

        if (
          title &&
          assignments.has("key") &&
          names.length === node.properties.length &&
          names.every((name: string): boolean => {
            return ["key", "title", "type"].includes(name);
          })
        ) {
          const initializer: ts.Expression = title.initializer;
          const marked: string | undefined =
            ts.isCallExpression(initializer) &&
            initializer.expression.getText(source) === "translationKey" &&
            initializer.arguments.length === 1 &&
            ts.isStringLiteral(initializer.arguments[0]!)
              ? (initializer.arguments[0] as ts.StringLiteral).text
              : undefined;

          titles.push({
            file,
            line:
              source.getLineAndCharacterOfPosition(initializer.getStart(source))
                .line + 1,
            marked,
            expression: initializer.getText(source),
          });
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(source);
  }

  return titles;
}

function readLocale(code: string): LocaleTree {
  return parseLocaleText(fs.readFileSync(getLocalePath(code), "utf8"));
}

describe("OneUptime AI's table columns", () => {
  const titles: Array<ColumnTitle> = findColumnTitles();
  const marked: Array<string> = Array.from(
    new Set(
      titles
        .map((title: ColumnTitle): string | undefined => {
          return title.marked;
        })
        .filter((title: string | undefined): title is string => {
          return Boolean(title) && LETTER_REGEX.test(title || "");
        }),
    ),
  ).sort();

  test("the tools still build their tables here, with many columns", () => {
    expect(titles.length).toBeGreaterThan(100);
    expect(marked.length).toBeGreaterThan(60);
    expect(marked).toEqual(
      expect.arrayContaining(["Time", "Severity", "Last seen", "Since"]),
    );
  });

  test("every column's name is marked as a key, or is one of the names a tool builds from what it read", () => {
    const unmarked: Array<string> = titles
      .filter((title: ColumnTitle): boolean => {
        return (
          !title.marked &&
          !COMPUTED_TITLES.some((computed: ComputedTitle): boolean => {
            return (
              computed.file === title.file &&
              computed.expression === title.expression
            );
          })
        );
      })
      .map((title: ColumnTitle): string => {
        return `${title.file}:${title.line}: ${title.expression}`;
      });

    // Each line here: write its name as translationKey("...").
    expect(unmarked).toEqual([]);
  });

  test("every name listed as built from what a tool read is still built that way", () => {
    for (const computed of COMPUTED_TITLES) {
      expect({
        computed,
        isStillThere: titles.some((title: ColumnTitle): boolean => {
          return (
            title.file === computed.file &&
            title.expression === computed.expression
          );
        }),
      }).toEqual({ computed, isStillThere: true });
    }
  });

  test("the extractor reads the tools' marked names, and nothing else of theirs", () => {
    const root: SourceRoot | undefined = SOURCE_ROOTS.find(
      (candidate: SourceRoot): boolean => {
        return candidate.directory === TOOLBOX_DIRECTORY;
      },
    );

    expect(root).toEqual({ directory: TOOLBOX_DIRECTORY, kind: "keys" });
  });

  test("every name is in en.json, and translated in all sixteen languages", () => {
    const english: LocaleTree = readLocale("en");
    const globalSame: Set<string> = new Set(readGlobalSameAsEnglish());

    for (const name of marked) {
      expect({ name, english: english[name] }).toEqual({
        name,
        english: name,
      });
    }

    expect(TRANSLATED_LOCALES).toHaveLength(16);

    const untranslated: Array<string> = [];

    for (const code of TRANSLATED_LOCALES) {
      const locale: LocaleTree = readLocale(code);
      const same: Set<string> = new Set(
        readLocaleProgress(code)?.sameAsEnglish || [],
      );

      for (const name of marked) {
        const value: unknown = locale[name];

        if (
          typeof value !== "string" ||
          (value === name && !same.has(name) && !globalSame.has(name))
        ) {
          untranslated.push(`${code}: ${name}`);
        }
      }
    }

    expect(untranslated).toEqual([]);
  });
});
