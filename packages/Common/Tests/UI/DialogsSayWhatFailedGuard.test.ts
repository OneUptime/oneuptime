// UX rule: Docs/ux/README.md#dialogs-and-confirmations
import {
  listFriendlyScanFiles,
  REPOSITORY_ROOT,
} from "../FriendlyMessageDrawnScan";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * A DIALOG THAT FAILS SAYS WHAT FAILED (#7680).
 *
 * A failure nobody explained - a 500, a gateway that did not answer - opens
 * with what failed, then why and what to do next (ErrorExplanation). Every
 * dialog but the notes' opened with "This did not finish.": over "Rotate
 * Verification Code", over an Error dialog after a delete, over "Test
 * Failed". Now a dialog names what it was doing:
 *
 *   - by its title, which Modal says for it - "“Rotate Verification Code”
 *     did not finish." (Common/UI/Utils/DialogWhatFailed) - unless the page
 *     says it in words of its own (errorWhatFailed);
 *   - an Error dialog, whose description is the error, and whose title -
 *     "Error", "Delete Error", "Test Failed" - names no action, says it
 *     itself: errorWhatFailed ("The monitor was not deleted.", "“Send Test
 *     Now” did not finish."), or titleSaysWhatFailed where its title says it
 *     already ("Could not start runbook").
 *
 * This guard reads every browser module (each feature set's src and
 * Common/UI, through the TypeScript compiler) and fails on a dialog whose
 * description is an error, or whose title names no action and which shows
 * an error, that says neither. It also holds Modal to naming a dialog by its
 * title. The detector is pinned on snippets first, then run over the tree.
 */

const DIALOGS: ReadonlyArray<string> = [
  "ConfirmModal",
  "Modal",
  "BasicFormModal",
  "ModelFormModal",
];

// A title that names no action: "Error", "Delete Error", "Test Failed".
const TITLE_NAMING_NO_ACTION: RegExp = /^(?:.*\s)?(?:Error|Failed)$/;

// A name that holds an error: error, deleteError, errorModalText, addError.
const ERROR_NAME: RegExp = /error/i;

/*
 * Dialogs left as they are, each with why. The list only shrinks: a file
 * here that no longer has such a dialog fails the guard.
 */
const LEFT_AS_THEY_ARE: Record<string, string> = {
  "packages/App/FeatureSet/Dashboard/src/Pages/Settings/Billing.tsx":
    "Billing's payment method dialogs are being reworked by the Add to Balance work (#11070), which this leaves them to.",
  "packages/App/FeatureSet/Dashboard/src/Pages/Settings/Invoices.tsx":
    "Billing's invoice dialogs are being reworked by the Add to Balance work (#11070), which this leaves them to.",
  "packages/App/FeatureSet/Dashboard/src/Pages/Incidents/EpisodeView/Postmortem.tsx":
    "Its Error dialog says only the page's own sentence (a template with no postmortem note), never a failure nobody explained.",
};

interface DialogFinding {
  file: string;
  line: number;
  title: string;
  why: string;
}

// The text of a JSX attribute's value, when it is written out whole.
const literalOf: (
  initializer: ts.JsxAttributeValue | undefined,
) => string | null = (
  initializer: ts.JsxAttributeValue | undefined,
): string | null => {
  if (!initializer) {
    return null;
  }

  if (ts.isStringLiteral(initializer)) {
    return initializer.text;
  }

  if (ts.isJsxExpression(initializer) && initializer.expression) {
    const expression: ts.Expression = initializer.expression;

    if (
      ts.isStringLiteral(expression) ||
      ts.isNoSubstitutionTemplateLiteral(expression)
    ) {
      return expression.text;
    }
  }

  return null;
};

/*
 * Whether a description is an error held in a name: `error`, `${error}`,
 * `deleteError`, `props.error.message`. A sentence, or a choice between
 * sentences, is no error.
 */
const isErrorHeldInAName: (
  initializer: ts.JsxAttributeValue | undefined,
) => boolean = (initializer: ts.JsxAttributeValue | undefined): boolean => {
  if (
    !initializer ||
    !ts.isJsxExpression(initializer) ||
    !initializer.expression
  ) {
    return false;
  }

  let expression: ts.Expression = initializer.expression;

  // `${error}`: a template that is one value and nothing else.
  if (
    ts.isTemplateExpression(expression) &&
    expression.head.text === "" &&
    expression.templateSpans.length === 1 &&
    expression.templateSpans[0]!.literal.text === ""
  ) {
    expression = expression.templateSpans[0]!.expression;
  }

  if (ts.isIdentifier(expression)) {
    return ERROR_NAME.test(expression.text);
  }

  if (ts.isPropertyAccessExpression(expression)) {
    return ERROR_NAME.test(expression.getText());
  }

  return false;
};

const findDialogsInSource: (
  file: string,
  source: string,
) => Array<DialogFinding> = (
  file: string,
  source: string,
): Array<DialogFinding> => {
  const sourceFile: ts.SourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const findings: Array<DialogFinding> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      DIALOGS.includes(node.tagName.getText(sourceFile))
    ) {
      const attributes: Map<string, ts.JsxAttribute> = new Map();

      for (const property of node.attributes.properties) {
        if (ts.isJsxAttribute(property)) {
          attributes.set(property.name.getText(sourceFile), property);
        }
      }

      const saysWhatFailed: boolean =
        attributes.has("errorWhatFailed") ||
        attributes.has("titleSaysWhatFailed");
      const title: string | null = literalOf(
        attributes.get("title")?.initializer,
      );
      const descriptionIsError: boolean =
        node.tagName.getText(sourceFile) === "ConfirmModal" &&
        isErrorHeldInAName(attributes.get("description")?.initializer);
      const showsAnError: boolean =
        descriptionIsError || attributes.has("error");
      const titleNamesNoAction: boolean = Boolean(
        title && TITLE_NAMING_NO_ACTION.test(title.trim()),
      );

      let why: string | null = null;

      if (descriptionIsError && !saysWhatFailed) {
        why =
          "its description is an error, and it says neither what failed (errorWhatFailed) nor that its title does (titleSaysWhatFailed)";
      } else if (titleNamesNoAction && showsAnError && !saysWhatFailed) {
        why =
          "its title names no action, so it says what failed itself (errorWhatFailed)";
      }

      if (why) {
        findings.push({
          file: file,
          line:
            sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
              .line + 1,
          title: title ?? attributes.get("title")?.getText(sourceFile) ?? "",
          why: why,
        });
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return findings;
};

const relativePath: (absolutePath: string) => string = (
  absolutePath: string,
): string => {
  return path.relative(REPOSITORY_ROOT, absolutePath).split(path.sep).join("/");
};

const findDialogsInTree: () => Array<DialogFinding> =
  (): Array<DialogFinding> => {
    return listFriendlyScanFiles(REPOSITORY_ROOT)
      .filter((absolutePath: string): boolean => {
        return absolutePath.endsWith(".tsx");
      })
      .flatMap((absolutePath: string): Array<DialogFinding> => {
        return findDialogsInSource(
          relativePath(absolutePath),
          fs.readFileSync(absolutePath, "utf8"),
        );
      });
  };

const format: (findings: Array<DialogFinding>) => Array<string> = (
  findings: Array<DialogFinding>,
): Array<string> => {
  return findings.map((finding: DialogFinding): string => {
    return `${finding.file}:${finding.line} (${finding.title}): ${finding.why}`;
  });
};

const judge: (lines: Array<string>) => Array<string> = (
  lines: Array<string>,
): Array<string> => {
  return findDialogsInSource("Fixture.tsx", lines.join("\n")).map(
    (finding: DialogFinding): string => {
      return `${finding.line} ${finding.title}`;
    },
  );
};

describe("the detector finds each dialog that did not say what failed", () => {
  test("a table's Error dialog after a delete, as it was", () => {
    expect(
      judge([
        "const A = () => (",
        "  <ConfirmModal",
        "    title={`Error`}",
        "    description={`${errorModalText}`}",
        '    submitButtonText={"Close"}',
        "    onSubmit={() => {}}",
        "  />",
        ");",
      ]),
    ).toEqual(["2 Error"]);
  });

  test("a delete's, a test's and an action's error dialogs", () => {
    expect(
      judge([
        "const A = () => (",
        "  <>",
        "    <ConfirmModal description={error} title={`Delete Error`} onSubmit={close} />",
        "    <ConfirmModal title={`Test Failed`} error={testError} description={next} onSubmit={close} />",
        '    <ConfirmModal title="Could not start runbook" description={error} onSubmit={close} />',
        "    <ConfirmModal title={`Error`} description={props.error.message} onSubmit={close} />",
        "  </>",
        ");",
      ]),
    ).toEqual([
      "3 Delete Error",
      "4 Test Failed",
      "5 Could not start runbook",
      "6 Error",
    ]);
  });

  test("leaves alone a dialog that says what failed, or whose title names its action", () => {
    expect(
      judge([
        "const A = () => (",
        "  <>",
        "    <ConfirmModal title={`Error`} description={error} errorWhatFailed={whatFailed} onSubmit={close} />",
        '    <ConfirmModal title="Could not start runbook" description={error} titleSaysWhatFailed={true} onSubmit={close} />',
        '    <ConfirmModal title="Rotate Verification Code" error={error} description="Rotating ends the current code." onSubmit={rotate} />',
        '    <Modal title="Add Payment Method" error={error}><p /></Modal>',
        // A sentence chosen while it tests, with the error beside it, is no error description.
        "    <ConfirmModal title={CHECK.title} error={testError} description={isTesting ? CHECK.checking : testMessage || (testError ? '' : CHECK.answered)} onSubmit={close} />",
        // A recorded error shown on purpose, with no failure of its own.
        '    <ConfirmModal title="Last Error" description="What the SIEM answered last." onSubmit={close} />',
        "  </>",
        ");",
      ]),
    ).toEqual([]);
  });
});

describe("every dialog in the front ends", () => {
  test("says what failed, where its title cannot", () => {
    const findings: Array<DialogFinding> = findDialogsInTree();

    expect(
      format(
        findings.filter((finding: DialogFinding): boolean => {
          return !LEFT_AS_THEY_ARE[finding.file];
        }),
      ),
    ).toEqual([]);
  });

  test("the list of dialogs left as they are only shrinks", () => {
    const filesFound: Set<string> = new Set(
      findDialogsInTree().map((finding: DialogFinding): string => {
        return finding.file;
      }),
    );

    expect(
      Object.keys(LEFT_AS_THEY_ARE).filter((file: string): boolean => {
        return !filesFound.has(file);
      }),
    ).toEqual([]);
  });

  test("Modal names a dialog by its title when its page says nothing more", () => {
    const modal: string = fs.readFileSync(
      path.join(
        REPOSITORY_ROOT,
        "packages/Common/UI/Components/Modal/Modal.tsx",
      ),
      "utf8",
    );

    expect(modal).toMatch(
      /props\.errorWhatFailed \|\|\s*getDialogWhatFailed\(translator, translatedTitle\)/,
    );
  });

  test("a negative control: a table's Error dialog put back as it was is found", () => {
    const file: string =
      "packages/Common/UI/Components/ModelTable/BaseModelTable.tsx";
    const source: string = fs
      .readFileSync(path.join(REPOSITORY_ROOT, file), "utf8")
      .replace(
        "          errorWhatFailed={errorModalWhatFailed || undefined}\n",
        "",
      );

    expect(
      findDialogsInSource(file, source).map(
        (finding: DialogFinding): string => {
          return finding.title;
        },
      ),
    ).toEqual(["Error"]);
  });
});
