// UX rule: Docs/ux/README.md#one-control-for-one-job
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";
import {
  listScanRoots,
  listSourceFiles,
  toRelativePath,
} from "../ForeignHiddenRuleGuard";

/*
 * A page's action is the shared Button, never a <button> drawn by hand in
 * the primary button's colours.
 *
 * 34 raw <button>s copied the primary look (`bg-indigo-600 ... text-white`),
 * each with its own size and corners - `rounded-lg px-4` on the topology
 * pages, `h-8 rounded-lg text-xs font-semibold` in the dashboard toolbar,
 * `px-3.5 hover:bg-indigo-500` on the Microsoft Teams card - and their focus
 * ring, locked look and phone layout had drifted from the shared Button's
 * (#9128). `Button` with `ButtonStyleType.PRIMARY` (and `ButtonSize.Small`
 * for a compact one) draws the one primary button everywhere.
 *
 * This reads every frontend's browser source (and Common/UI, and ee/ when
 * present) through the TypeScript AST and fails on a raw <button> whose
 * class, as always written, holds `bg-indigo-600`: a string, or the fixed
 * parts of a template. A colour one branch of a choice gives
 * (`isPicked ? "bg-indigo-600 text-white" : "bg-white"`) is a picked
 * option, a toggle or a tab, not an action, and is not read.
 *
 * A control the shared Button cannot be lists its file here, with how many
 * such buttons it holds and why.
 */

const REPOSITORY_ROOT: string = path.resolve(__dirname, "..", "..", "..", "..");

const PRIMARY_FILL_CLASS: string = "bg-indigo-600";

/*
 * None today. The seven this used to list - the chat and note composers'
 * Send and Post, the LLM replay bar's Play, the label pickers' Apply and the
 * paging ladder's menu trigger - are the shared Button now: it takes an
 * onMouseDown, a key hint, words a phone hides and a data-state, and
 * MoreMenu takes it as a trigger (#9195).
 */
export const HAND_MADE_PRIMARY_BUTTON_EXCEPTIONS: Record<
  string,
  { count: number; reason: string }
> = {};

interface HandMadePrimaryButton {
  file: string;
  line: number;
}

function classTokens(text: string): Array<string> {
  return text.split(/\s+/u).filter((token: string): boolean => {
    return token.length > 0;
  });
}

/*
 * The class text an expression always writes: a string, or a template's
 * fixed parts. A choice's branches, a function's result and a name are not
 * read.
 */
function alwaysWrittenClassText(expression: ts.Expression): string {
  if (ts.isParenthesizedExpression(expression)) {
    return alwaysWrittenClassText(expression.expression);
  }

  if (
    ts.isStringLiteral(expression) ||
    ts.isNoSubstitutionTemplateLiteral(expression)
  ) {
    return expression.text;
  }

  if (ts.isTemplateExpression(expression)) {
    return [
      expression.head.text,
      ...expression.templateSpans.map((span: ts.TemplateSpan): string => {
        return span.literal.text;
      }),
    ].join(" ");
  }

  return "";
}

export function findHandMadePrimaryButtons(
  file: string,
  text: string,
): Array<HandMadePrimaryButton> {
  if (!text.includes(PRIMARY_FILL_CLASS) || !text.includes("<button")) {
    return [];
  }

  const source: ts.SourceFile = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const found: Array<HandMadePrimaryButton> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      node.tagName.getText(source) === "button"
    ) {
      for (const property of node.attributes.properties) {
        if (
          !ts.isJsxAttribute(property) ||
          property.name.getText(source) !== "className" ||
          !property.initializer
        ) {
          continue;
        }

        const initializer: ts.JsxAttributeValue = property.initializer;
        const className: string = ts.isStringLiteral(initializer)
          ? initializer.text
          : ts.isJsxExpression(initializer) && initializer.expression
            ? alwaysWrittenClassText(initializer.expression)
            : "";

        if (classTokens(className).includes(PRIMARY_FILL_CLASS)) {
          found.push({
            file: file,
            line:
              source.getLineAndCharacterOfPosition(node.getStart(source)).line +
              1,
          });
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  return found;
}

describe("the guard reads the shapes it is meant to", () => {
  test("a raw button in the primary colours is caught", () => {
    const code: string = `
      const A = () => (
        <button type="button" className="mt-4 rounded-lg bg-indigo-600 px-4 py-2 text-white">Retry</button>
      );
      const B = (props) => (
        <button
          type="button"
          className={\`inline-flex h-8 rounded-lg bg-indigo-600 text-white \${getHandDrawnButtonStateClassName({ isBusy: props.isBusy })}\`}
        >
          Save
        </button>
      );
      const C = () => (
        <button className={("rounded-md bg-indigo-600 text-white")}>Apply</button>
      );
    `;

    expect(
      findHandMadePrimaryButtons("Fixture.tsx", code).map(
        (button: HandMadePrimaryButton): number => {
          return button.line;
        },
      ),
    ).toEqual([3, 6, 14]);
  });

  test("a picked option, a hover and the shared Button are left alone", () => {
    const code: string = `
      const A = (props) => (
        <button className={props.isPicked ? "bg-indigo-600 text-white" : "bg-white text-gray-700"}>Mon</button>
      );
      const B = () => (
        <button className="bg-white text-gray-700 hover:bg-indigo-600 hover:text-white">List</button>
      );
      const C = () => <Button title="Retry" buttonStyle={ButtonStyleType.PRIMARY} />;
      const D = () => <a className="rounded-md bg-indigo-600 text-white">Open</a>;
      const E = (props) => (
        <button className={\`rounded-md \${props.isOn ? "bg-indigo-600 text-white" : ""}\`}>On</button>
      );
    `;

    expect(findHandMadePrimaryButtons("Fixture.tsx", code)).toEqual([]);
  });
});

describe("a page's action is the shared Button", () => {
  const roots: Array<string> = listScanRoots(REPOSITORY_ROOT);
  const files: Array<string> = roots.flatMap((root: string): Array<string> => {
    return listSourceFiles(root);
  });

  const foundByFile: Map<string, Array<HandMadePrimaryButton>> = new Map();

  for (const file of files) {
    const relative: string = toRelativePath(REPOSITORY_ROOT, file);
    const found: Array<HandMadePrimaryButton> = findHandMadePrimaryButtons(
      relative,
      fs.readFileSync(file, "utf8"),
    );

    if (found.length > 0) {
      foundByFile.set(relative, found);
    }
  }

  test("the scan reads the frontends", () => {
    expect(files.length).toBeGreaterThan(1000);
  });

  test("no raw <button> copies the primary button", () => {
    const unexplained: Array<string> = [];

    foundByFile.forEach(
      (found: Array<HandMadePrimaryButton>, file: string): void => {
        const allowed: number =
          HAND_MADE_PRIMARY_BUTTON_EXCEPTIONS[file]?.count || 0;

        if (found.length > allowed) {
          for (const button of found) {
            unexplained.push(
              `${button.file}:${button.line} draws a primary button by hand: use <Button buttonStyle={ButtonStyleType.PRIMARY} /> (ButtonSize.Small for a compact one)`,
            );
          }
        }
      },
    );

    expect(unexplained).toEqual([]);
  });

  test("every exception still holds the buttons it lists", () => {
    const stale: Array<string> = [];

    for (const file of Object.keys(HAND_MADE_PRIMARY_BUTTON_EXCEPTIONS)) {
      const count: number = foundByFile.get(file)?.length || 0;

      if (count !== HAND_MADE_PRIMARY_BUTTON_EXCEPTIONS[file]!.count) {
        stale.push(
          `${file} holds ${count}, the exception lists ${HAND_MADE_PRIMARY_BUTTON_EXCEPTIONS[file]!.count}`,
        );
      }
    }

    expect(stale).toEqual([]);
  });
});
