// UX rule: Docs/ux/README.md#cards-and-the-look-of-a-page
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * A TITLE'S (i) FOLLOWS ITS LAST WORD (#7348, #8044).
 *
 * A tile's, a card's or a section's title with an explanation used to draw
 * the (i) as the title's flex sibling: <div className="flex items-center
 * gap-1"><span>{title}</span><InfoTooltip /></div>. A title too long for its
 * box wraps, and a wrapped flex item takes all the width it is offered, so
 * the (i) stood at the far edge of the tile, centred between the title's
 * two lines, as if it belonged to the next tile. English titles mostly fit;
 * German and Arabic ones did not. WordsWithInfoTooltip draws the (i) inside
 * the title's own text, after its last word, on whichever line it ends.
 *
 * This reads every Dashboard source with the TypeScript parser and fails
 * on an <InfoTooltip> drawn in a flex row right after a title's words:
 * text, an expression that is text (a translation, a name, a prop), or a
 * text element (a span, a heading, a paragraph, a term) holding only text.
 * Left alone, because they cannot wrap the same way or are not a title's:
 *
 *   - an (i) in a table's column header (a th, a ResizableHeaderCell): the
 *     header's own sort and resize layout holds it;
 *   - an (i) after a title kept to one line (truncate), which stays right
 *     after the words it cuts short;
 *   - an (i) after or inside a chip, a pill, a health pill or a version,
 *     which are values that never wrap, not a title;
 *   - the places listed in ALLOWED below, each with why. The list of those
 *     still to move only shrinks.
 */

const DASHBOARD_SOURCE: string = path.resolve(
  __dirname,
  "../../FeatureSet/Dashboard/src",
);

interface Allowed {
  // Relative to the Dashboard's src.
  file: string;
  // How many such (i) the file may hold.
  count: number;
  why: string;
}

const ALLOWED: ReadonlyArray<Allowed> = [
  {
    file: "Components/UserFlow/UserFlowTables.tsx",
    count: 1,
    why: "HeaderWithInfo draws a column header's words: the header's sort area holds the (i).",
  },
  {
    file: "Pages/Kubernetes/View/KubernetesCostPricingNote.tsx",
    count: 1,
    why: "A line of prices (an element, not a title's words) in a wrapping row of facts; its (i) is one of the facts.",
  },
  {
    file: "Pages/AppPlatforms/View/Overview.tsx",
    count: 1,
    why: "Still to move: an App Platform's section titles were being reworked by another change when #8044 landed (follow-up issue).",
  },
];

const TEXT_TAGS: ReadonlySet<string> = new Set<string>([
  "span",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "p",
  "dt",
  "label",
  "strong",
]);

// A column header holds its (i) in its own layout.
const HEADER_TAGS: ReadonlySet<string> = new Set<string>([
  "th",
  "thead",
  "ResizableHeaderCell",
]);

// A class list that lays its children out in a row.
const FLEX_ROW: RegExp = /(^|[\s"'`{])(inline-)?flex(?=$|[\s"'`}])/;
// A chip's round box: its word is a value that never wraps, not a title.
const CHIP: RegExp = /(^|[\s"'`{])rounded-full(?=$|[\s"'`}])/;
const ONE_LINE: RegExp = /(^|[\s"'`{])truncate(?=$|[\s"'`}])/;
// A call that turns words into the reader's: translateText, tx, t.
const TRANSLATION_CALL: RegExp = /(^|\.)(translate\w*|tx|t)$/;

export interface FlexSiblingInfo {
  file: string;
  line: number;
  title: string;
}

function sourceFiles(directory: string): Array<string> {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...sourceFiles(entryPath));
    } else if (entry.name.endsWith(".tsx")) {
      files.push(entryPath);
    }
  }

  return files;
}

function tagNameOf(node: ts.Node): string | null {
  if (ts.isJsxElement(node)) {
    return node.openingElement.tagName.getText();
  }

  if (ts.isJsxSelfClosingElement(node)) {
    return node.tagName.getText();
  }

  return null;
}

function classNameOf(node: ts.JsxElement): string {
  for (const property of node.openingElement.attributes.properties) {
    if (
      ts.isJsxAttribute(property) &&
      property.name.getText() === "className" &&
      property.initializer
    ) {
      return property.initializer.getText();
    }
  }

  return "";
}

function isMeaningful(child: ts.JsxChild): boolean {
  if (ts.isJsxText(child)) {
    return child.getText().trim().length > 0;
  }

  if (ts.isJsxExpression(child)) {
    return Boolean(child.expression);
  }

  return true;
}

// An expression whose value is words: a name, a prop, a translation.
function isTextExpression(expression: ts.Expression): boolean {
  if (
    ts.isIdentifier(expression) ||
    ts.isPropertyAccessExpression(expression) ||
    ts.isStringLiteral(expression) ||
    ts.isTemplateExpression(expression) ||
    ts.isNoSubstitutionTemplateLiteral(expression)
  ) {
    return true;
  }

  if (ts.isCallExpression(expression)) {
    return TRANSLATION_CALL.test(expression.expression.getText());
  }

  if (ts.isParenthesizedExpression(expression)) {
    return isTextExpression(expression.expression);
  }

  if (
    ts.isBinaryExpression(expression) &&
    (expression.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
      expression.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)
  ) {
    return (
      isTextExpression(expression.left) && isTextExpression(expression.right)
    );
  }

  return false;
}

// Words a title is drawn with, and not cut to one line.
function isTitleWords(child: ts.JsxChild): boolean {
  if (ts.isJsxText(child)) {
    return child.getText().trim().length > 0;
  }

  if (ts.isJsxExpression(child)) {
    return Boolean(child.expression) && isTextExpression(child.expression!);
  }

  if (ts.isJsxElement(child)) {
    const tag: string | null = tagNameOf(child);

    if (!tag || !TEXT_TAGS.has(tag) || ONE_LINE.test(classNameOf(child))) {
      return false;
    }

    const parts: Array<ts.JsxChild> = child.children.filter(isMeaningful);

    return (
      parts.length > 0 &&
      parts.every((part: ts.JsxChild): boolean => {
        return (
          ts.isJsxText(part) ||
          (ts.isJsxExpression(part) &&
            Boolean(part.expression) &&
            isTextExpression(part.expression!))
        );
      })
    );
  }

  return false;
}

function isInColumnHeader(node: ts.Node): boolean {
  let parent: ts.Node | undefined = node.parent;

  while (parent) {
    const tag: string | null = tagNameOf(parent);

    if (tag && HEADER_TAGS.has(tag)) {
      return true;
    }

    parent = parent.parent;
  }

  return false;
}

// Every <InfoTooltip> drawn as the flex sibling after a title's words.
export function findFlexSiblingInfos(
  file: string,
  source: string,
): Array<FlexSiblingInfo> {
  const found: Array<FlexSiblingInfo> = [];

  if (!source.includes("<InfoTooltip")) {
    return found;
  }

  const sourceFile: ts.SourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      (ts.isJsxSelfClosingElement(node) || ts.isJsxElement(node)) &&
      tagNameOf(node) === "InfoTooltip" &&
      !isInColumnHeader(node)
    ) {
      // The element it is drawn in, through a {cond && <InfoTooltip />}.
      let holder: ts.Node | undefined = node.parent;

      while (
        holder &&
        !ts.isJsxElement(holder) &&
        (ts.isJsxExpression(holder) ||
          ts.isBinaryExpression(holder) ||
          ts.isParenthesizedExpression(holder) ||
          ts.isConditionalExpression(holder))
      ) {
        holder = holder.parent;
      }

      if (
        holder &&
        ts.isJsxElement(holder) &&
        FLEX_ROW.test(classNameOf(holder)) &&
        !CHIP.test(classNameOf(holder))
      ) {
        const children: Array<ts.JsxChild> =
          holder.children.filter(isMeaningful);
        const index: number = children.findIndex(
          (child: ts.JsxChild): boolean => {
            return child.pos <= node.pos && child.end >= node.end;
          },
        );
        const previous: ts.JsxChild | undefined =
          index > 0 ? children[index - 1] : undefined;

        if (previous && isTitleWords(previous)) {
          found.push({
            file: file,
            line:
              sourceFile.getLineAndCharacterOfPosition(node.getStart()).line +
              1,
            title: previous.getText().replace(/\s+/g, " ").slice(0, 80),
          });
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return found;
}

function relativeOf(file: string): string {
  return path.relative(DASHBOARD_SOURCE, file).split(path.sep).join("/");
}

const FOUND: Array<FlexSiblingInfo> = sourceFiles(DASHBOARD_SOURCE).flatMap(
  (file: string): Array<FlexSiblingInfo> => {
    return findFlexSiblingInfos(
      relativeOf(file),
      fs.readFileSync(file, "utf8"),
    );
  },
);

function countIn(file: string): number {
  return FOUND.filter((found: FlexSiblingInfo): boolean => {
    return found.file === file;
  }).length;
}

describe("a title's (i) follows its last word", () => {
  test("no title draws its (i) as a flex sibling, but the places listed with why", () => {
    const allowedFiles: Set<string> = new Set<string>(
      ALLOWED.map((allowed: Allowed): string => {
        return allowed.file;
      }),
    );
    const unlisted: Array<FlexSiblingInfo> = FOUND.filter(
      (found: FlexSiblingInfo): boolean => {
        return !allowedFiles.has(found.file);
      },
    );

    expect(unlisted).toEqual([]);
  });

  test.each(
    ALLOWED.map((allowed: Allowed): [string, Allowed] => {
      return [allowed.file, allowed];
    }),
  )(
    "%s holds no more than its listed (i), and still holds them",
    (_file: string, allowed: Allowed) => {
      // The list only shrinks: one moved is one to take off it.
      expect({ file: allowed.file, count: countIn(allowed.file) }).toEqual({
        file: allowed.file,
        count: allowed.count,
      });
      expect(allowed.why.length).toBeGreaterThan(20);
    },
  );
});

/*
 * The finder against the shapes it is for, and the ones it leaves alone:
 * without these, a finder that found nothing would pass.
 */
describe("the finder", () => {
  function find(jsx: string): Array<FlexSiblingInfo> {
    return findFlexSiblingInfos(
      "Example.tsx",
      `const element: ReactElement = (${jsx});`,
    );
  }

  test.each([
    [
      "a tile's title span",
      '<div className="flex min-w-0 items-center gap-1"><span className="text-xs uppercase">{translator.translateText(props.title)}</span><InfoTooltip label={props.title} text={props.description} /></div>',
    ],
    [
      "a card title's words",
      '<span className="inline-flex items-center gap-1.5">{title}<InfoTooltip label={title} text={help} /></span>',
    ],
    [
      "a heading beside its (i)",
      '<div className="flex items-center gap-1"><h4 className="text-sm">{tx(params.title)}</h4><InfoTooltip label={params.title} text={params.description} /></div>',
    ],
    [
      "an (i) behind a condition",
      '<span className="inline-flex items-center gap-1">{tx(row.label)}{row.description ? (<InfoTooltip label={row.label} text={row.description} />) : (<></>)}</span>',
    ],
    [
      "a chart's title before its zoom hint",
      '<div className="mb-2 flex items-center gap-1.5 text-sm">{translator.translateText("Client IOPS")}<InfoTooltip label="Client IOPS" text={DESCRIPTIONS.clientIops} /><TimeRangeZoomHint revealOnHover={true} /></div>',
    ],
  ])("finds %s", (_name: string, jsx: string) => {
    expect(find(jsx)).toHaveLength(1);
  });

  test.each([
    [
      "words with their (i) after the last one",
      '<div className="flex min-w-0"><WordsWithInfoTooltip text={title} label={title} description={help} /></div>',
    ],
    [
      "an (i) after a health pill",
      '<span className="inline-flex items-center gap-1"><ResourceHealthPill health={health} /><InfoTooltip label="Health" text={help} /></span>',
    ],
    [
      "an (i) in a column header",
      '<ResizableHeaderCell resize={resize}><span className="inline-flex items-center gap-1">{column.heading}<InfoTooltip label={column.heading} text={column.description} /></span></ResizableHeaderCell>',
    ],
    [
      "an (i) after a title kept to one line",
      '<div className="flex min-w-0 items-center gap-1"><span className="truncate text-xs">{title}</span><InfoTooltip label={title} text={help} /></div>',
    ],
    [
      "an (i) after a row of chips",
      '<div className="mt-4 flex flex-wrap items-center gap-1.5">{chips.map((chip) => { return <Pill text={chip} />; })}<InfoTooltip label="Counts" text={help} /></div>',
    ],
    [
      "an (i) in a block, not a row",
      '<p className="text-sm">{title}<InfoTooltip label={title} text={help} /></p>',
    ],
    [
      "an (i) inside a chip",
      "<span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 ${tone}`}>{words}<InfoTooltip label={chip.name} text={chip.description} /></span>",
    ],
  ])("leaves alone %s", (_name: string, jsx: string) => {
    expect(find(jsx)).toEqual([]);
  });
});
