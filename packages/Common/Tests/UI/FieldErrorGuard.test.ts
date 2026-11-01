import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { listScanRoots, listSourceFiles } from "../ForeignHiddenRuleGuard";

/*
 * EVERY FIELD'S ERROR IS DRAWN BY FieldError.
 *
 * A field that wrote its own <p data-testid="error-message">{error}</p>
 * drew an English answer from the server - "Promo code is invalid." - with
 * its full stop first on a Persian page, laid out right to left. FieldError
 * (Common/UI/Components/Forms/Fields/FieldError) reads the message the way it
 * is written, in an isolate of its own. So the error line's test id is only
 * ever written there, as a constant; a new field draws its error with
 * FieldError, or this names it.
 *
 * Read by the test id the browser suites and the field tests find an error
 * line by: a field that draws its error some other way (inside an Alert,
 * whose words read their own way too) passes it as a prop, not as this
 * attribute.
 *
 * And by its shape: a red line holding nothing but a field's error prop -
 * <p className="mt-1 text-sm text-red-400">{props.error}</p> - is the same
 * line under another test id, or none. The Markdown editor's, the card and
 * entity pickers' and a dozen of the Dashboard's own fields drew theirs that
 * way, and an English answer put its full stop first under each of them on
 * a Persian page. FieldError takes the field's own test id where its suites
 * find the line by one (dataTestId).
 */

const REPOSITORY_ROOT: string = path.resolve(__dirname, "..", "..", "..", "..");

const FIELD_ERROR_FILE: string =
  "packages/Common/UI/Components/Forms/Fields/FieldError.tsx";

// An error line written by hand: <p data-testid="error-message">.
const HAND_WRITTEN_ERROR_LINE_REGEX: RegExp =
  /data-testid=(?:"error-message"|\{\s*"error-message"\s*\})/;

/*
 * A line written by hand around a field's error prop: an element whose only
 * content is {props.error}, its opening tag read to its first ">" (a tag
 * with an arrow function in it is not an error line's).
 */
const ERROR_PROP_LINE_REGEX: RegExp =
  /<(p|div|span)\b([^<>]*)>\s*\{\s*props\.error\s*\}\s*<\/\1>/g;

// The colour that makes such a line an error's: text-red-400, text-red-600.
const RED_TEXT_CLASS_REGEX: RegExp = /\btext-red-\d+\b/;

// A run of white space, written as one space in a finding.
const WHITESPACE_RUN_REGEX: RegExp = /\s+/g;

// The red lines in a module's source that hold nothing but {props.error}.
const findErrorPropLines: (source: string) => Array<string> = (
  source: string,
): Array<string> => {
  return Array.from(source.matchAll(ERROR_PROP_LINE_REGEX))
    .filter((match: RegExpMatchArray): boolean => {
      return RED_TEXT_CLASS_REGEX.test(match[2] || "");
    })
    .map((match: RegExpMatchArray): string => {
      return match[0].replace(WHITESPACE_RUN_REGEX, " ");
    });
};

const relative: (file: string) => string = (file: string): string => {
  return path.relative(REPOSITORY_ROOT, file).split(path.sep).join("/");
};

describe("a field's error line", () => {
  test("the pattern finds an error line written by hand, in both spellings", () => {
    expect(
      HAND_WRITTEN_ERROR_LINE_REGEX.test(
        '<p data-testid="error-message" className="mt-1">{props.error}</p>',
      ),
    ).toBe(true);
    expect(
      HAND_WRITTEN_ERROR_LINE_REGEX.test(
        '<p data-testid={"error-message"}>{props.error}</p>',
      ),
    ).toBe(true);
    expect(
      HAND_WRITTEN_ERROR_LINE_REGEX.test(
        "<FieldError message={props.error} id={errorId} />",
      ),
    ).toBe(false);
    expect(
      HAND_WRITTEN_ERROR_LINE_REGEX.test(
        '<Alert title={error} dataTestId="error-message" />',
      ),
    ).toBe(false);
  });

  test("is drawn by FieldError in every frontend: none writes its own", () => {
    const handWritten: Array<string> = listScanRoots(REPOSITORY_ROOT)
      .flatMap(listSourceFiles)
      .filter((file: string): boolean => {
        return file.endsWith(".tsx") && relative(file) !== FIELD_ERROR_FILE;
      })
      .filter((file: string): boolean => {
        return HAND_WRITTEN_ERROR_LINE_REGEX.test(
          fs.readFileSync(file, "utf8"),
        );
      })
      .map(relative)
      .sort();

    expect(handWritten).toEqual([]);
  });

  test("FieldError itself names the line by the shared test id, or the field's own", () => {
    const source: string = fs.readFileSync(
      path.join(REPOSITORY_ROOT, FIELD_ERROR_FILE),
      "utf8",
    );

    expect(source).toContain('FIELD_ERROR_TEST_ID: string = "error-message"');
    expect(source).toContain(
      "data-testid={props.dataTestId || FIELD_ERROR_TEST_ID}",
    );
    expect(source).toContain("<IsolatedText text={message} />");
  });

  test("the shape finds a red line around a field's error prop, and nothing else", () => {
    expect(
      findErrorPropLines(
        '<p id={errorId} role="alert" className="mt-1 text-sm text-red-400">\n  {props.error}\n</p>',
      ),
    ).toHaveLength(1);
    expect(
      findErrorPropLines(
        '<div className="mt-2 text-sm text-red-600">{props.error}</div>',
      ),
    ).toHaveLength(1);
    // A value's own grey line, a local state's error and FieldError pass.
    expect(
      findErrorPropLines(
        '<p className="text-xs text-gray-500" title={props.error}>{props.error}</p>',
      ),
    ).toEqual([]);
    expect(
      findErrorPropLines('<p className="text-sm text-red-700">{error}</p>'),
    ).toEqual([]);
    expect(
      findErrorPropLines(
        '<FieldError message={props.error} className="mt-2 text-sm text-red-600" />',
      ),
    ).toEqual([]);
  });

  test("no field draws its error prop in a red line of its own", () => {
    const handWritten: Array<string> = listScanRoots(REPOSITORY_ROOT)
      .flatMap(listSourceFiles)
      .filter((file: string): boolean => {
        return file.endsWith(".tsx") && relative(file) !== FIELD_ERROR_FILE;
      })
      .flatMap((file: string): Array<string> => {
        return findErrorPropLines(fs.readFileSync(file, "utf8")).map(
          (line: string): string => {
            return `${relative(file)}: ${line}`;
          },
        );
      })
      .sort();

    expect(handWritten).toEqual([]);
  });
});
