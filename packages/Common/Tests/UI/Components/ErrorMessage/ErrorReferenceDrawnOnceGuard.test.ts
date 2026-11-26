// UX rule: Docs/ux/README.md#errors
import {
  listFriendlyScanFiles,
  REPOSITORY_ROOT,
} from "../../../FriendlyMessageDrawnScan";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * A FAILURE'S REFERENCE IS DRAWN BY ERRORREFERENCE ALONE (#7622).
 *
 * A failure the server could not explain names a reference for its log
 * lines, drawn with a copy button. ErrorExplanation drew it in a flex row of
 * its own, laid out from the row's start, and centred it only where a layout
 * said so (isCentered); ErrorSentence drew another copy of it inside a
 * card's sentence. A table's failed load never said so, and its reference
 * sat about 150px off the centre of the lines above it.
 *
 * Now the reference is drawn by ErrorReference (Common/UI/Components/
 * ErrorMessage/ErrorReference), as one inline box on a line of its own that
 * the line's alignment places, so every layout centres it where it centres
 * its lines and none has to say so. This guard reads every browser module
 * (each feature set's src, Common/UI, and ee/'s screens when the checkout has
 * them) and fails on what brought the row back:
 *
 *   - a reference drawn by hand: a file that reads a failure's reference
 *     (readUnexplainedError, getErrorInSentenceWords) and draws a copy
 *     button, or that draws the reference's test id, which only
 *     ErrorReference does;
 *   - an alignment handed to an error's words (isCentered on ErrorMessage,
 *     ErrorMessageText, ErrorExplanation or ErrorLine): a layout's alignment
 *     is its lines', which the reference takes itself.
 *
 * The detector is pinned on the old code first, then run over the tree.
 */

// The one file that draws a reference.
const ERROR_REFERENCE_FILE: string =
  "packages/Common/UI/Components/ErrorMessage/ErrorReference.tsx";

// What reads a failure's reference out of its message.
const READS_A_REFERENCE: RegExp =
  /\b(?:readUnexplainedError|getErrorInSentenceWords)\s*\(/;

// A copy button, drawn.
const DRAWS_A_COPY_BUTTON: RegExp = /<CopyTextButton\b/;

// The reference's own test id, which only ErrorReference draws.
const REFERENCE_TEST_ID: RegExp = /["'`]error-reference(?:-line)?["'`]/;

// An alignment handed to an error's words.
const ALIGNMENT_HANDED_ON: RegExp =
  /<(?:ErrorMessage|ErrorMessageText|ErrorExplanation|ErrorLine)\b[^>]*?\bisCentered\b/;

interface Finding {
  file: string;
  how: string;
}

// Comments hold prose ("the reference's row"), not code.
const withoutComments: (source: string) => string = (
  source: string,
): string => {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
};

const findInSource: (file: string, source: string) => Array<Finding> = (
  file: string,
  source: string,
): Array<Finding> => {
  if (file === ERROR_REFERENCE_FILE) {
    return [];
  }

  const code: string = withoutComments(source);
  const findings: Array<Finding> = [];

  if (READS_A_REFERENCE.test(code) && DRAWS_A_COPY_BUTTON.test(code)) {
    findings.push({
      file: file,
      how: "draws a failure's reference with a copy button of its own",
    });
  }

  if (REFERENCE_TEST_ID.test(code)) {
    findings.push({
      file: file,
      how: "draws the reference's test id, which only ErrorReference draws",
    });
  }

  if (ALIGNMENT_HANDED_ON.test(code.replace(/\s+/g, " "))) {
    findings.push({
      file: file,
      how: "hands an error's words an alignment (isCentered) its lines already have",
    });
  }

  return findings;
};

const findInTree: () => Array<Finding> = (): Array<Finding> => {
  return listFriendlyScanFiles(REPOSITORY_ROOT).flatMap(
    (absolutePath: string): Array<Finding> => {
      return findInSource(
        path.relative(REPOSITORY_ROOT, absolutePath).split(path.sep).join("/"),
        fs.readFileSync(absolutePath, "utf8"),
      );
    },
  );
};

const format: (findings: Array<Finding>) => Array<string> = (
  findings: Array<Finding>,
): Array<string> => {
  return findings.map((finding: Finding): string => {
    return `${finding.file}: ${finding.how}`;
  });
};

describe("the detector finds each way the reference was drawn before", () => {
  test("ErrorExplanation's own row, with its copy button and its isCentered", () => {
    expect(
      format(
        findInSource(
          "packages/Common/UI/Components/ErrorMessage/ErrorExplanation.tsx",
          [
            'import CopyTextButton from "../CopyTextButton/CopyTextButton";',
            "const error = readUnexplainedError(props.message);",
            "return (",
            '  <span className={`mt-2 flex flex-wrap items-center gap-2${props.isCentered ? " justify-center" : ""}`} data-testid="error-reference">',
            '    <code dir="ltr">{error.reference}</code>',
            '    <CopyTextButton textToBeCopied={error.reference} size="sm" />',
            "  </span>",
            ");",
          ].join("\n"),
        ),
      ),
    ).toEqual([
      "packages/Common/UI/Components/ErrorMessage/ErrorExplanation.tsx: draws a failure's reference with a copy button of its own",
      "packages/Common/UI/Components/ErrorMessage/ErrorExplanation.tsx: draws the reference's test id, which only ErrorReference draws",
    ]);
  });

  test("ErrorSentence's own copy, inside a card's sentence", () => {
    expect(
      findInSource(
        "packages/Common/UI/Components/ErrorMessage/ErrorSentence.tsx",
        [
          "const words = getErrorInSentenceWords({ message, translator });",
          "<span data-testid='error-reference'>",
          "  <code dir='ltr'>{words.reference}</code>{words.fullStop}",
          "  <CopyTextButton textToBeCopied={words.reference} size='xs' iconOnly={true} />",
          "</span>",
        ].join("\n"),
      ).length,
    ).toBe(2);
  });

  test("a layout that tells the words to centre the reference", () => {
    expect(
      format(
        findInSource(
          "packages/App/FeatureSet/Dashboard/src/Components/EventNotes/EventNotes.tsx",
          [
            "<p className='mt-1 max-w-md text-sm text-gray-500'>",
            "  <ErrorMessageText",
            "    message={loadError}",
            "    hideWhatFailed={true}",
            "    isCentered={true}",
            "  />",
            "</p>",
          ].join("\n"),
        ),
      ),
    ).toEqual([
      "packages/App/FeatureSet/Dashboard/src/Components/EventNotes/EventNotes.tsx: hands an error's words an alignment (isCentered) its lines already have",
    ]);
  });

  test("leaves alone what draws through ErrorReference, and copy buttons of other things", () => {
    expect(
      findInSource(
        "packages/Common/UI/Components/ErrorMessage/ErrorExplanation.tsx",
        [
          'import ErrorReference from "./ErrorReference";',
          "const error = readUnexplainedError(props.message);",
          "{error.reference && <ErrorReference reference={error.reference} />}",
        ].join("\n"),
      ),
    ).toEqual([]);

    expect(
      findInSource(
        "packages/Common/UI/Components/Workflow/ComponentReturnValueViewer.tsx",
        "<CopyTextButton textToBeCopied={reference} size='xs' />",
      ),
    ).toEqual([]);

    // A comment that names the old way is prose.
    expect(
      findInSource(
        "packages/Common/UI/Components/Table/TableEmptyState.tsx",
        "// It took isCentered: <ErrorMessageText isCentered={true} />",
      ),
    ).toEqual([]);
  });
});

describe("every browser module", () => {
  test("is read, ErrorReference among them", () => {
    const files: Array<string> = listFriendlyScanFiles(REPOSITORY_ROOT).map(
      (absolutePath: string): string => {
        return path
          .relative(REPOSITORY_ROOT, absolutePath)
          .split(path.sep)
          .join("/");
      },
    );

    expect(files.length).toBeGreaterThan(1000);
    expect(files).toContain(ERROR_REFERENCE_FILE);
    expect(files).toContain(
      "packages/Common/UI/Components/ErrorMessage/ErrorExplanation.tsx",
    );
    expect(files).toContain(
      "packages/App/FeatureSet/Dashboard/src/Components/EventNotes/EventNotes.tsx",
    );
  });

  test("draws a failure's reference through ErrorReference alone", () => {
    expect(format(findInTree())).toEqual([]);
  });

  test("ErrorReference itself draws the reference and its copy button", () => {
    const source: string = withoutComments(
      fs.readFileSync(path.join(REPOSITORY_ROOT, ERROR_REFERENCE_FILE), "utf8"),
    );

    expect(source).toMatch(DRAWS_A_COPY_BUTTON);
    expect(source).toContain('"error-reference"');
    // Its line is a plain block whose one box the line's alignment places.
    expect(source).toContain('className="mt-2 block"');
    expect(source).not.toContain("justify-center");
    expect(source).not.toContain("isCentered");
  });

  test("a negative control: ErrorExplanation drawing its own row again is found", () => {
    const file: string =
      "packages/Common/UI/Components/ErrorMessage/ErrorExplanation.tsx";
    const source: string = fs
      .readFileSync(path.join(REPOSITORY_ROOT, file), "utf8")
      .replace(
        "{error.reference && <ErrorReference reference={error.reference} />}",
        '{error.reference && (<span data-testid="error-reference"><code>{error.reference}</code><CopyTextButton textToBeCopied={error.reference} /></span>)}',
      );

    expect(format(findInSource(file, source))).toEqual([
      `${file}: draws a failure's reference with a copy button of its own`,
      `${file}: draws the reference's test id, which only ErrorReference draws`,
    ]);
  });
});
