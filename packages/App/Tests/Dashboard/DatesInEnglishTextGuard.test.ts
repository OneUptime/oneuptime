import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * No English text written in the code holds a date in another language.
 *
 * OneUptimeDate writes a date in the reader's language (Common/Types/
 * DateLanguage). A sentence put together in the code with a template
 * literal - `Added ${OneUptimeDate.fromNow(date)}` - is English whatever
 * the reader's language, so a German reader would read "Added vor 5
 * Stunden". Such a sentence is either looked up whole
 * (translateTemplate("Added {{time}}", { time })), so the date follows the
 * sentence, or - text that stays English, an export or a prompt for
 * OneUptime AI - writes its dates inside inEnglishDates(() => ...).
 *
 * This reads the syntax of every frontend and finds a date, a time or a
 * duration OneUptimeDate writes in words, placed straight into English
 * text: a template literal, a sum of strings, or an element's text.
 */

const PACKAGES: string = path.resolve(__dirname, "../../..");
const REPO: string = path.resolve(PACKAGES, "..");

const ROOTS: ReadonlyArray<string> = [
  "packages/App/FeatureSet/Dashboard/src",
  "packages/App/FeatureSet/AdminDashboard/src",
  "packages/App/FeatureSet/StatusPage/src",
  "packages/App/FeatureSet/Accounts/src",
  "packages/App/FeatureSet/PublicDashboard/src",
  "packages/Common/UI",
  "ee/Dashboard",
  "ee/AdminDashboard",
];

// OneUptimeDate's helpers whose text has words in the reader's language.
const DISPLAY_HELPERS: ReadonlySet<string> = new Set<string>([
  "fromNow",
  "getDateAsLocalFormattedString",
  "getDateAsUserFriendlyLocalFormattedString",
  "getDateAsFormattedString",
  "getDateAsUserFriendlyFormattedString",
  "getDateAsLocalShortDateTimeString",
  "getDateAsLocalDayMonthString",
  "getDateAsLocalDayMonthHourString",
  "getDateAsLocalDayMonthTimeString",
  "getDateAsLocalMonthYearString",
  "getDateAsFormattedStringInTimezone",
  "getDateAsCustomFormattedStringInTimezone",
  "getDateAsFormattedArrayInMultipleTimezones",
  "getDateAsFormattedStringInMultipleTimezones",
  "getDateAsFormattedHTMLInMultipleTimezones",
  "getLocalShortMonthNameFromDate",
  "getInBetweenDatesAsFormattedString",
  "getHoursAndMinutesFromMinutes",
  "convertSecondsToDaysHoursMinutesAndSeconds",
  "convertMinutesToDaysHoursAndMinutes",
  "secondsToFormattedFriendlyTimeString",
  "differenceBetweenTwoDatesAsFromattedString",
]);

// Helpers of their own the Dashboard writes the same words with.
const OTHER_DISPLAY_CALLS: ReadonlySet<string> = new Set<string>([
  "getEventDurationText",
  "formatFeedTimeAgo",
  "formatFeedDay",
  "formatFeedFullTime",
]);

// What keeps a date English: the text around it stays English.
const ENGLISH_DATES_CALL: string = "inEnglishDates";

// English words: two letters in a row.
const WORDS: RegExp = /[A-Za-z]{2,}/;

const SOURCE_FILE: RegExp = /\.tsx?$/;
const SKIPPED_FILE: RegExp = /(\.test\.tsx?|\.spec\.tsx?|\.d\.ts)$/;
const SKIPPED_DIRECTORIES: ReadonlySet<string> = new Set<string>([
  "node_modules",
  "build",
  "dist",
  "Tests",
  "__tests__",
]);

function sourceFiles(directory: string): Array<string> {
  if (!fs.existsSync(directory)) {
    return [];
  }

  const files: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) {
        files.push(...sourceFiles(full));
      }
    } else if (SOURCE_FILE.test(entry.name) && !SKIPPED_FILE.test(entry.name)) {
      files.push(full);
    }
  }

  return files;
}

function calleeName(expression: ts.Expression): string {
  if (ts.isIdentifier(expression)) {
    return expression.text;
  }

  if (ts.isPropertyAccessExpression(expression)) {
    return expression.name.text;
  }

  return "";
}

// A call that writes a date's words in the reader's language.
function isDisplayDateCall(node: ts.Node): boolean {
  if (!ts.isCallExpression(node)) {
    return false;
  }

  const callee: ts.Expression = node.expression;

  if (
    ts.isPropertyAccessExpression(callee) &&
    ts.isIdentifier(callee.expression) &&
    callee.expression.text === "OneUptimeDate"
  ) {
    return DISPLAY_HELPERS.has(callee.name.text);
  }

  return ts.isIdentifier(callee) && OTHER_DISPLAY_CALLS.has(callee.text);
}

/*
 * Whether `node` holds a display date call that no inEnglishDates(...)
 * around it keeps English.
 */
function holdsLocalizedDate(node: ts.Node): boolean {
  let found: boolean = false;

  const visit: (child: ts.Node) => void = (child: ts.Node): void => {
    if (found) {
      return;
    }

    if (
      ts.isCallExpression(child) &&
      calleeName(child.expression) === ENGLISH_DATES_CALL
    ) {
      return;
    }

    if (isDisplayDateCall(child)) {
      found = true;
      return;
    }

    ts.forEachChild(child, visit);
  };

  visit(node);

  return found;
}

export interface EnglishTextWithDate {
  where: string;
  text: string;
}

export function findEnglishTextWithDates(
  file: string,
  sourceText: string,
): Array<EnglishTextWithDate> {
  const source: ts.SourceFile = ts.createSourceFile(
    file,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const found: Array<EnglishTextWithDate> = [];

  const report: (node: ts.Node) => void = (node: ts.Node): void => {
    const line: number =
      source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;

    found.push({
      where: `${path.relative(REPO, file).split(path.sep).join("/")}:${line}`,
      text: node.getText(source).replace(/\s+/g, " ").slice(0, 160),
    });
  };

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    // A date kept English is fine, and so is everything inside it.
    if (
      ts.isCallExpression(node) &&
      calleeName(node.expression) === ENGLISH_DATES_CALL
    ) {
      return;
    }

    if (ts.isTemplateExpression(node)) {
      const words: string = [
        node.head.text,
        ...node.templateSpans.map((span: ts.TemplateSpan): string => {
          return span.literal.text;
        }),
      ].join(" ");
      const spansHoldDate: boolean = node.templateSpans.some(
        (span: ts.TemplateSpan): boolean => {
          return holdsLocalizedDate(span.expression);
        },
      );

      if (WORDS.test(words) && spansHoldDate) {
        report(node);
      }
    }

    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.PlusToken
    ) {
      const sides: Array<ts.Expression> = [node.left, node.right];
      const hasWords: boolean = sides.some((side: ts.Expression): boolean => {
        return (
          (ts.isStringLiteral(side) ||
            ts.isNoSubstitutionTemplateLiteral(side)) &&
          WORDS.test(side.text)
        );
      });
      const hasDate: boolean = sides.some((side: ts.Expression): boolean => {
        return isDisplayDateCall(side);
      });

      if (hasWords && hasDate) {
        report(node);
      }
    }

    if (ts.isJsxElement(node) || ts.isJsxFragment(node)) {
      const children: ReadonlyArray<ts.JsxChild> = node.children;
      const hasWords: boolean = children.some((child: ts.JsxChild): boolean => {
        return ts.isJsxText(child) && WORDS.test(child.text);
      });
      const hasDate: boolean = children.some((child: ts.JsxChild): boolean => {
        return (
          ts.isJsxExpression(child) &&
          child.expression !== undefined &&
          isDisplayDateCall(child.expression)
        );
      });

      if (hasWords && hasDate) {
        report(node);
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  return found;
}

describe("English text never holds a date in another language", () => {
  const files: Array<string> = ROOTS.flatMap((root: string): Array<string> => {
    return sourceFiles(path.join(REPO, root));
  });

  test("the scan reads the frontends", () => {
    // A guard that reads nothing passes everything.
    expect(files.length).toBeGreaterThan(2000);
  });

  test("every date in a sentence follows the sentence", () => {
    const found: Array<string> = files.flatMap(
      (file: string): Array<string> => {
        return findEnglishTextWithDates(
          file,
          fs.readFileSync(file, "utf8"),
        ).map((item: EnglishTextWithDate): string => {
          return `${item.where}: ${item.text}`;
        });
      },
    );

    expect(found).toEqual([]);
  });
});

describe("the guard's own proof", () => {
  const FILE: string = path.join(
    REPO,
    "packages/App/FeatureSet/Dashboard/src/Fixture.tsx",
  );

  const read: (source: string) => Array<string> = (
    source: string,
  ): Array<string> => {
    return findEnglishTextWithDates(FILE, source).map(
      (item: EnglishTextWithDate): string => {
        return item.text;
      },
    );
  };

  test("flags a template literal, a sum and an element's text", () => {
    expect(
      read("const a: string = `Added ${OneUptimeDate.fromNow(date)}`;"),
    ).toEqual(["`Added ${OneUptimeDate.fromNow(date)}`"]);
    expect(
      read(
        'const b: string = "Generated " + OneUptimeDate.getDateAsLocalFormattedString(date);',
      ),
    ).toEqual([
      '"Generated " + OneUptimeDate.getDateAsLocalFormattedString(date)',
    ]);
    expect(
      read("const c = <span>Last seen {OneUptimeDate.fromNow(date)}</span>;"),
    ).toEqual(["<span>Last seen {OneUptimeDate.fromNow(date)}</span>"]);
    expect(
      read("const d: string = `Lasted ${getEventDurationText(start, end)}`;"),
    ).toEqual(["`Lasted ${getEventDurationText(start, end)}`"]);
  });

  test("lets a sentence looked up whole, an English date and a date alone through", () => {
    expect(
      read(
        'const a: string = translateTemplate("Added {{time}}", { time: OneUptimeDate.fromNow(date) });',
      ),
    ).toEqual([]);
    expect(
      read(
        "const b: string = `Exported on ${inEnglishDates((): string => { return OneUptimeDate.getDateAsLocalFormattedString(date); })}`;",
      ),
    ).toEqual([]);
    // No words around it: a date and a zone, a range.
    expect(
      read(
        "const c: string = `${OneUptimeDate.getDateAsFormattedString(a)} — ${OneUptimeDate.getDateAsFormattedString(b)}`;",
      ),
    ).toEqual([]);
    // A helper with no words, or a number: nothing to translate.
    expect(
      read("const d: string = `At ${OneUptimeDate.toDatabaseDate(date)}`;"),
    ).toEqual([]);
  });
});
