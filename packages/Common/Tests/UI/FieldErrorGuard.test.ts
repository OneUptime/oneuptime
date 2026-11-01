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
 */

const REPOSITORY_ROOT: string = path.resolve(__dirname, "..", "..", "..", "..");

const FIELD_ERROR_FILE: string =
  "packages/Common/UI/Components/Forms/Fields/FieldError.tsx";

// An error line written by hand: <p data-testid="error-message">.
const HAND_WRITTEN_ERROR_LINE_REGEX: RegExp =
  /data-testid=(?:"error-message"|\{\s*"error-message"\s*\})/;

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

  test("FieldError itself names the line by the shared test id", () => {
    const source: string = fs.readFileSync(
      path.join(REPOSITORY_ROOT, FIELD_ERROR_FILE),
      "utf8",
    );

    expect(source).toContain('FIELD_ERROR_TEST_ID: string = "error-message"');
    expect(source).toContain("data-testid={FIELD_ERROR_TEST_ID}");
    expect(source).toContain("<IsolatedText text={message} />");
  });
});
