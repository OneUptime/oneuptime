// UX rule: Docs/ux/README.md#in-every-language
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";
import {
  ExtractedString,
  scanSourceText,
} from "../../FeatureSet/Dashboard/scripts/i18n/ExtractStrings";
import {
  BROWSER_DETAIL_LABEL,
  DETAIL_LABELS,
} from "../../FeatureSet/Dashboard/src/Components/Topology/ServiceMapViewModel";

/*
 * THE SERVICE MAP AND THE INFRASTRUCTURE EXPLORER SAY NOTHING IN ENGLISH
 * THAT THE READER'S LANGUAGE COULD SAY (#7725).
 *
 * The service map built its card lines in English at run time - "3 active
 * incidents", "Service · Node.js", "10.0% errors" - and looked the whole
 * line up as a key, which a line with a number or a name in it never is;
 * its cards drew "in", "errors" and "avg" as written; the explorer drew
 * its categories with t(category.name), which the extractor cannot read,
 * so no locale held them. `npm run i18n:hardcoded` saw none of this: it
 * reads text between tags and the props a person reads, not a template
 * literal a function returns or a label a card is handed.
 *
 * This reads the syntax of the screens' components and finds every string
 * a person could read that does not go through translation where it is
 * written:
 *
 *   - text between tags, or a string standing in for it;
 *   - a prop a person reads (a title, an aria-label, a placeholder) and a
 *     property that holds copy (label, hint, detail, subtitle, ...);
 *   - a template literal with words in it, anywhere but a class name, a
 *     style, a test id or a key;
 *   - anything else that reads as words: a capital and a small letter
 *     ("Hosts", "Unnamed"), or two words with a space between them.
 *
 * Such a string is translated where it is written when it is the key of a
 * translation call (t, translateString, translator.translateText,
 * translateTemplate, translatePlural, translationKey, translatableTerm), a
 * form of a plural ({ one, other }), the template of a TranslatedSentence,
 * or a prop of a shared component that translates that prop itself
 * (EmptyState's title, Input's placeholder). A word kept on purpose - a
 * product's name, a class list built by a helper - is listed in ALLOWED
 * with the reason. A new English string fails here until it is routed
 * through translation or listed.
 */

const DASHBOARD_SOURCE: string = path.resolve(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

// The screens' components, relative to the Dashboard's src.
const GUARDED_FILES: ReadonlyArray<string> = [
  "Components/Topology/ServiceMapGraph.tsx",
  "Components/Topology/TopologyNodeCard.tsx",
  "Components/Topology/InfrastructureExplorer.tsx",
  /*
   * The model the explorer draws a resource's name from, the service map's
   * view model (a node's detail label), and the entity drawer: each held a
   * word the screens drew in English (#8260).
   */
  "Components/Topology/InfrastructureTopologyModel.ts",
  "Components/Topology/ServiceMapViewModel.ts",
  "Components/Topology/EntityDetailPanel.tsx",
];

/*
 * Strings a person may read that are kept as written, file by file, each
 * with its reason. Keyed by the string's text (a template literal's text
 * with ${} for each of its values).
 */
const ALLOWED: Record<string, Record<string, string>> = {
  "Components/Topology/ServiceMapGraph.tsx": {},
  "Components/Topology/TopologyNodeCard.tsx": {},
  "Components/Topology/InfrastructureExplorer.tsx": {},
  "Components/Topology/InfrastructureTopologyModel.ts": {
    "group:${}:${}": "A group node's id, never drawn.",
    Empty:
      "describeInfrastructureNode's words, which the infrastructure map card draws: #6690's, not this guard's yet.",
  },
  "Components/Topology/ServiceMapViewModel.ts": {},
  "Components/Topology/EntityDetailPanel.tsx": {},
};

/*
 * The service map's detail labels are products' names - Node.js,
 * PostgreSQL, Azure Service Bus - drawn as written in every language: a
 * lookup of them all would turn "Go" into German "Los". The browser's
 * runtime is the one that is a word, a key the map draws in the reader's
 * language (#8260), so it is not among them.
 */
const PRODUCT_NAMES: ReadonlySet<string> = new Set<string>(
  Object.values(DETAIL_LABELS).filter((label: string): boolean => {
    return label !== BROWSER_DETAIL_LABEL;
  }),
);

const KEPT_AS_WRITTEN: Record<string, ReadonlySet<string>> = {
  "Components/Topology/ServiceMapViewModel.ts": PRODUCT_NAMES,
};

// A call whose first argument is a key: t("..."), translator.translateText("...").
const TRANSLATION_CALL: RegExp =
  /^(t|translateString|translateValue|translateText|translateTemplate|translatePlural|translateTerm|translatableTerm|translationKey)$/;

/*
 * Props of the shared components these screens draw that the component
 * looks up itself (Locales/README.md lists them).
 */
const TRANSLATING_COMPONENT_PROPS: Record<string, ReadonlyArray<string>> = {
  EmptyState: ["title", "description"],
  Input: ["placeholder"],
  Button: ["title"],
};

// JSX attributes that never hold words a person reads.
const CODE_ATTRIBUTES: ReadonlySet<string> = new Set<string>([
  "className",
  "style",
  "key",
  "id",
  "type",
  "role",
  "scope",
  "testId",
  "dataTestId",
  "tabIndex",
  "href",
  "to",
  "value",
  "color",
  "variant",
  "icon",
  "aria-busy",
  "aria-hidden",
  "aria-live",
  "aria-current",
  "aria-pressed",
  "aria-expanded",
  "aria-controls",
  "aria-haspopup",
  "aria-orientation",
  "dir",
]);

// Object properties that never hold words a person reads.
const CODE_PROPERTIES: ReadonlySet<string> = new Set<string>([
  "id",
  "kind",
  "type",
  "key",
  "tableKey",
  "color",
  "background",
  "border",
  "borderInlineStart",
  "boxShadow",
  "cursor",
  "transition",
  "padding",
  "fill",
  "stroke",
  "fontWeight",
  "lineHeight",
  "whiteSpace",
  "textOverflow",
  "overflow",
  "display",
  "alignItems",
  "justifyContent",
  "flexWrap",
  "position",
  "borderRadius",
  "borderTop",
  "minWidth",
  "maxWidth",
  "width",
  "height",
  "pointerEvents",
  "insetInlineStart",
  "top",
]);

// Object properties and JSX attributes that hold copy.
const COPY_NAMES: ReadonlySet<string> = new Set<string>([
  "label",
  "title",
  "subtitle",
  "statusLabel",
  "footer",
  "hint",
  "detail",
  "description",
  "message",
  "placeholder",
  "heading",
  "text",
  "name",
  "aria-label",
  "ariaLabel",
  "alt",
]);

// Two letters in a row: a word.
const WORD: RegExp = /\p{L}{2,}/u;

// The words of a style a template literal writes: "${}px", "calc(100% - ${}px)".
const STYLE_WORDS: RegExp = /\b(px|rem|em|vh|vw|calc|var|solid|dashed)\b/g;

/*
 * Facts joined by hand in a template literal: "${type} · ${detail}". A
 * language whose zero is a dot (Persian) takes a bullet there, and a page
 * read from the right sets each fact apart: join them with formatInline.
 */
const JOINED_BY_HAND: RegExp = /\$\{\}\s*[·•]\s*\$\{\}/;

// Reads as words: "Hosts", "Unnamed resource", "in this view".
const READS_AS_WORDS: RegExp = /^\s*\p{Lu}\p{Ll}|\p{L}{2,}\s+\p{L}/u;

/*
 * One class of a class list: "flex", "mt-3", "hover:bg-gray-50", "w-[10rem]".
 * After its first letters, a separator and then any run of letters, digits
 * and separators. One run, not a repeated group: the separator and the
 * characters after it overlap, and a repeated group of them backtracked
 * exponentially on a long run that does not match (CodeQL js/redos, #2684).
 */
const CLASS_TOKEN: RegExp =
  /^!?-?[a-z][a-z0-9]*(?:[-:/.[\]#()%_][-a-z0-9:/.[\]#()%_]*)?$/;

// What only a class has: "mt-3", "hover:bg-gray-50".
const CLASS_PUNCTUATION: RegExp = /[-:]/;

// A list of classes: "rounded font-medium text-indigo-600".
function isClassList(text: string): boolean {
  const tokens: Array<string> = text.trim().split(/\s+/).filter(Boolean);
  return (
    tokens.length > 0 &&
    tokens.every((token: string): boolean => {
      return CLASS_TOKEN.test(token);
    }) &&
    tokens.some((token: string): boolean => {
      return CLASS_PUNCTUATION.test(token);
    })
  );
}

interface FoundString {
  file: string;
  line: number;
  text: string;
  why: string;
}

function nameOf(node: ts.Node | undefined): string | undefined {
  if (!node) {
    return undefined;
  }
  if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) {
    return node.text;
  }
  if (ts.isStringLiteral(node) || ts.isNumericLiteral(node)) {
    return node.text;
  }
  if (ts.isPropertyAccessExpression(node)) {
    return node.name.text;
  }
  return undefined;
}

function jsxAttributeName(attribute: ts.JsxAttribute): string {
  return attribute.name.getText();
}

function tagNameOf(attribute: ts.JsxAttribute): string {
  const element: ts.Node = attribute.parent.parent;
  if (ts.isJsxOpeningElement(element) || ts.isJsxSelfClosingElement(element)) {
    return element.tagName.getText();
  }
  return "";
}

// A template literal's text, with ${} for each value.
function textOf(node: ts.Node): string {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  if (ts.isTemplateExpression(node)) {
    return (
      node.head.text +
      node.templateSpans
        .map((span: ts.TemplateSpan): string => {
          return `\${}${span.literal.text}`;
        })
        .join("")
    );
  }
  if (ts.isJsxText(node)) {
    // An entity ("&nbsp;", "&rarr;") is a sign, not a word.
    return node.text
      .replace(/&[a-zA-Z]+;|&#\d+;/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }
  return "";
}

function isComparison(node: ts.Node): boolean {
  const parent: ts.Node = node.parent;
  if (ts.isCaseClause(parent) && parent.expression === node) {
    return true;
  }
  return (
    ts.isBinaryExpression(parent) &&
    [
      ts.SyntaxKind.EqualsEqualsEqualsToken,
      ts.SyntaxKind.ExclamationEqualsEqualsToken,
      ts.SyntaxKind.EqualsEqualsToken,
      ts.SyntaxKind.ExclamationEqualsToken,
    ].includes(parent.operatorToken.kind)
  );
}

/*
 * How a string is placed: translated where it is written, kept out of
 * sight as code, or drawn - in a copy position or not.
 */
type Placement = "translated" | "code" | "copy" | "other";

/*
 * Whether `parent` hands `child` on as it is: through brackets, a choice
 * ("a ? 'A' : 'B'", "x || 'B'") or a cast. A string inside a call, an
 * array or an object is a value of its own, not what the prop draws.
 */
function passesThrough(parent: ts.Node, child: ts.Node): boolean {
  if (
    ts.isParenthesizedExpression(parent) ||
    ts.isAsExpression(parent) ||
    ts.isNonNullExpression(parent) ||
    ts.isJsxExpression(parent)
  ) {
    return true;
  }
  if (ts.isConditionalExpression(parent)) {
    return parent.whenTrue === child || parent.whenFalse === child;
  }
  if (ts.isBinaryExpression(parent)) {
    return (
      [
        ts.SyntaxKind.BarBarToken,
        ts.SyntaxKind.QuestionQuestionToken,
        ts.SyntaxKind.AmpersandAmpersandToken,
      ].includes(parent.operatorToken.kind) && parent.right === child
    );
  }
  return false;
}

function isConsoleCall(node: ts.Node): boolean {
  return (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    ts.isIdentifier(node.expression.expression) &&
    node.expression.expression.text === "console"
  );
}

function placementOf(node: ts.Node): Placement {
  if (isComparison(node)) {
    return "code";
  }

  let child: ts.Node = node;
  let current: ts.Node | undefined = node.parent;
  let inCopy: boolean = false;
  // Still the very value a prop, a property or an element draws.
  let direct: boolean = true;

  while (current) {
    if (isConsoleCall(current)) {
      return "code";
    }

    if (ts.isTypeNode(current)) {
      return "code";
    }

    if (
      ts.isImportDeclaration(current) ||
      ts.isExportDeclaration(current) ||
      (ts.isCallExpression(current) &&
        current.expression.kind === ts.SyntaxKind.ImportKeyword)
    ) {
      return "code";
    }

    // A property's or an element's name: { "in": 1 }, row["direction"].
    if (
      (ts.isPropertyAssignment(current) && current.name === child) ||
      (ts.isElementAccessExpression(current) &&
        current.argumentExpression === child)
    ) {
      return "code";
    }

    if (ts.isCallExpression(current)) {
      const callee: string | undefined = nameOf(current.expression);
      if (
        callee &&
        TRANSLATION_CALL.test(callee) &&
        current.arguments[0] === child
      ) {
        return "translated";
      }
    }

    // A plural's forms: { one: "{{count}} caller", other: "{{count}} callers" }.
    if (
      ts.isPropertyAssignment(current) &&
      current.initializer === child &&
      ["one", "other"].includes(nameOf(current.name) || "") &&
      ts.isObjectLiteralExpression(current.parent) &&
      current.parent.properties.some((property: ts.ObjectLiteralElement) => {
        return nameOf(property.name) === "other";
      })
    ) {
      return "translated";
    }

    if (ts.isPropertyAssignment(current) && current.initializer === child) {
      const property: string = nameOf(current.name) || "";
      if (CODE_PROPERTIES.has(property)) {
        return "code";
      }
      if (direct && COPY_NAMES.has(property)) {
        inCopy = true;
      }
    }

    if (ts.isJsxAttribute(current)) {
      const attribute: string = jsxAttributeName(current);
      const tag: string = tagNameOf(current);
      if (CODE_ATTRIBUTES.has(attribute) || attribute.startsWith("data-")) {
        return "code";
      }
      if (!direct) {
        return inCopy ? "copy" : "other";
      }
      if (attribute === "template" && tag === "TranslatedSentence") {
        return "translated";
      }
      if ((TRANSLATING_COMPONENT_PROPS[tag] || []).includes(attribute)) {
        return "translated";
      }
      return "copy";
    }

    // Between tags: <p>{"Text"}</p>, <p>{busy ? "A" : "B"}</p>.
    if (
      ts.isJsxExpression(current) &&
      current.parent &&
      (ts.isJsxElement(current.parent) || ts.isJsxFragment(current.parent))
    ) {
      return direct || inCopy ? "copy" : "other";
    }

    if (!passesThrough(current, child) && !ts.isPropertyAssignment(current)) {
      direct = false;
    }

    // A statement ends the search: the string is not inside a call's key.
    if (
      ts.isExpressionStatement(current) ||
      ts.isVariableStatement(current) ||
      ts.isReturnStatement(current) ||
      ts.isFunctionLike(current)
    ) {
      break;
    }

    child = current;
    current = current.parent;
  }

  return inCopy ? "copy" : "other";
}

function findUntranslatedStrings(
  file: string,
  source: string,
): Array<FoundString> {
  const sourceFile: ts.SourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const found: Array<FoundString> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    const isString: boolean =
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateExpression(node) ||
      ts.isJsxText(node);

    if (isString) {
      const text: string = textOf(node);
      const isTemplate: boolean =
        ts.isTemplateExpression(node) ||
        ts.isNoSubstitutionTemplateLiteral(node);
      // What could be words: a template's text without its style's units.
      const words: string = isTemplate ? text.replace(STYLE_WORDS, "") : text;
      const joinedByHand: boolean = isTemplate && JOINED_BY_HAND.test(text);
      const placement: Placement = ts.isJsxText(node)
        ? "copy"
        : placementOf(node);
      // A prop or a line glued from values: `${t("Show on map")} ${name}`.
      const gluedInCopy: boolean =
        ts.isTemplateExpression(node) && placement === "copy";

      if (
        (WORD.test(words) || joinedByHand || gluedInCopy) &&
        !isClassList(text.replace(/\$\{\}/g, " "))
      ) {
        const drawn: boolean =
          placement === "copy" ||
          (placement === "other" && (isTemplate || READS_AS_WORDS.test(text)));

        if (drawn) {
          found.push({
            file,
            line:
              sourceFile.getLineAndCharacterOfPosition(node.getStart()).line +
              1,
            text,
            why: ts.isJsxText(node)
              ? "text between tags"
              : joinedByHand
                ? "facts joined by hand"
                : placement === "copy"
                  ? "a prop or a property a person reads"
                  : isTemplate
                    ? "a template literal with words in it"
                    : "words written as they are",
          });
        }
      }

      if (ts.isTemplateExpression(node)) {
        // The values of a template literal are strings of their own.
        ts.forEachChild(node, visit);
      }
      return;
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return found;
}

// A quote of any kind: a file with strings in it.
const QUOTE: RegExp = /["'`]/;

function readSource(file: string): string {
  return fs.readFileSync(path.join(DASHBOARD_SOURCE, file), "utf8");
}

describe("the service map and the infrastructure explorer route every word through translation", () => {
  test.each(GUARDED_FILES)(
    "%s has no English string a person reads, but the listed ones",
    (file: string) => {
      const allowed: Record<string, string> = ALLOWED[file] || {};
      const keptAsWritten: ReadonlySet<string> =
        KEPT_AS_WRITTEN[file] || new Set<string>();
      const found: Array<FoundString> = findUntranslatedStrings(
        file,
        readSource(file),
      ).filter((entry: FoundString): boolean => {
        return !keptAsWritten.has(entry.text);
      });

      expect(
        found
          .filter((entry: FoundString): boolean => {
            return !Object.prototype.hasOwnProperty.call(allowed, entry.text);
          })
          .map((entry: FoundString): string => {
            return `${entry.file}:${entry.line} (${entry.why}) ${JSON.stringify(entry.text)}`;
          }),
      ).toEqual([]);

      // Every listed string is still there, with its reason.
      for (const text of Object.keys(allowed)) {
        expect({
          text,
          found: found.some((entry: FoundString): boolean => {
            return entry.text === text;
          }),
          why: allowed[text]!.length > 0,
        }).toEqual({ text, found: true, why: true });
      }
    },
  );

  test("every file it reads is still there, and holds strings to read", () => {
    for (const file of GUARDED_FILES) {
      const source: string = readSource(file);
      expect({ file, hasStrings: QUOTE.test(source) }).toEqual({
        file,
        hasStrings: true,
      });
    }
  });
});

// The strings the guard finds in `source`, read as a component file.
function findIn(source: string): Array<string> {
  return findUntranslatedStrings("Snippet.tsx", source).map(
    (entry: FoundString): string => {
      return entry.text;
    },
  );
}

/*
 * What the guard finds, checked against the very lines #7725 found in
 * English: each must fail it, and its fix must pass. Without these the
 * guard could pass by finding nothing at all.
 */
describe("the guard finds the English the screens used to build", () => {
  test.each([
    [
      "the status line built by hand",
      'export function a(entry: E): string { return `${entry.incidentCount} active incident${entry.incidentCount === 1 ? "" : "s"}`; }',
      "${} active incident${}",
    ],
    [
      "the subtitle joined by hand",
      "export function a(entry: E): string { return `${entry.typeLabel} · ${entry.detailLabel}`; }",
      "${} · ${}",
    ],
    [
      "a card's stat drawn as English",
      'const stats = [{ label: served ? "in" : "out", value: rate }];',
      "in",
    ],
    [
      "a card's stat drawn as English, alone",
      'const stats = [{ label: "errors", value: rate }];',
      "errors",
    ],
    [
      "a connection's label built by hand",
      "const label = metric === 1 ? `${formatErrorRate(a, b)} errors` : undefined;",
      "${} errors",
    ],
    [
      "a category named in English",
      'const c = { id: "category:compute", name: "Hosts & containers" };',
      "Hosts & containers",
    ],
    [
      "a category named with one word",
      'const c = { id: "category:cloud", name: "Cloud" };',
      "Cloud",
    ],
    [
      "a summary tile's label",
      'const tiles = [{ label: "Services", value: 1 }];',
      "Services",
    ],
    ["text between tags", "const p = <p>Nothing here</p>;", "Nothing here"],
    [
      "an aria-label glued from pieces",
      'const b = <button aria-label={`${t("Show on map")} ${name}`} />;',
      "${} ${}",
    ],
    [
      "an English constant",
      'const fallback: string = "Unnamed service";',
      "Unnamed service",
    ],
  ])("%s", (_name: string, source: string, expected: string) => {
    expect(findIn(source)).toContain(expected);
  });

  test.each([
    [
      "a plural sentence",
      'const s = translator.translatePlural({ one: "{{count}} active incident", other: "{{count}} active incidents" }, n);',
    ],
    [
      "a plural kept for later",
      'const CALLERS: PluralTemplate = { one: "{{count}} caller", other: "{{count}} callers" };',
    ],
    [
      "a key kept for later",
      'export const STAT_INBOUND: string = translationKey("in");',
    ],
    [
      "a category's key",
      'const c = { id: "category:compute", name: translationKey("Hosts & containers") };',
    ],
    [
      "a looked-up sentence",
      'const s = translator.translateTemplate("Showing {{first}}–{{last}} of {{total}}", { first: a });',
    ],
    ["a looked-up word", 'const p = <p>{t("Needs attention")}</p>;'],
    [
      "a choice of looked-up words",
      'const p = <p>{t(a ? "Map" : "Table")}</p>;',
    ],
    [
      "facts joined the reader's way",
      "const s = formatInline([typeText, detail], translator);",
    ],
    [
      "a class list",
      'const d = <div className={`flex items-center ${selected ? "bg-indigo-50 text-indigo-700" : "text-gray-700"}`} />;',
    ],
    [
      "a class list handed to a helper",
      'renderRecovery(error, retry, "rounded font-medium text-indigo-600 hover:underline");',
    ],
    ["a test id", "const d = <div data-testid={`service-map-node-${key}`} />;"],
    [
      "a style",
      "const d = <div style={{ border: `1px solid ${color}`, maxWidth: `calc(100% - ${2 * inset}px)` }} />;",
    ],
    ["a comparison", 'if (stat.label === "Need attention") { warn(); }'],
    [
      "a log line",
      'console.error("Service Map operational overlay failed to load:", err);',
    ],
    [
      "a shared component that looks its own prop up",
      'const e = <EmptyState title="No services discovered yet" description="Send traces." />;',
    ],
    [
      "an input's placeholder",
      'const i = <Input placeholder="Search services and dependencies" />;',
    ],
    [
      "a sentence with a slot",
      'const s = <TranslatedSentence template="Direct connections of {{name}}" slots={{ name: <strong>{n}</strong> }} />;',
    ],
    [
      "identifiers",
      'const view = Navigation.getQueryStringByName("serviceView");',
    ],
    ["a type", 'type View = "list" | "map";'],
    ["an entity in text", "const p = <span>&nbsp;</span>;"],
  ])("%s passes", (_name: string, source: string) => {
    expect(findIn(source)).toEqual([]);
  });
});

/*
 * The explorer looks its categories up with t(category.name), which the
 * extractor cannot read: the names reach en.json only because the model
 * marks each one as a key where it is written.
 */
describe("the infrastructure explorer's categories are keys of the locale", () => {
  const MODEL: string = "Components/Topology/InfrastructureTopologyModel.ts";

  const CATEGORY_NAMES: ReadonlyArray<string> = [
    "Kubernetes",
    "Hosts & containers",
    "Virtualization & clusters",
    "Cloud",
    "Network & devices",
    "External",
    "Applications",
    "Other",
  ];

  test("npm run i18n:extract finds every category's name in the model", () => {
    const extracted: Array<string> = scanSourceText(
      `packages/App/FeatureSet/Dashboard/src/${MODEL}`,
      readSource(MODEL),
      { kind: "ui" },
    ).strings.map((entry: ExtractedString): string => {
      return entry.text;
    });

    for (const name of CATEGORY_NAMES) {
      expect({ name, extracted: extracted.includes(name) }).toEqual({
        name,
        extracted: true,
      });
    }
  });

  test("en.json holds every category's name", () => {
    const english: Record<string, unknown> = JSON.parse(
      fs.readFileSync(
        path.join(DASHBOARD_SOURCE, "Locales", "en.json"),
        "utf8",
      ),
    ) as Record<string, unknown>;

    for (const name of CATEGORY_NAMES) {
      expect({ name, value: english[name] }).toEqual({ name, value: name });
    }
  });

  test("a name that is not marked is not found (negative control)", () => {
    const unmarked: string = readSource(MODEL).replace(
      'translationKey("Hosts & containers")',
      '"Hosts & containers"',
    );
    const extracted: Array<string> = scanSourceText(
      `packages/App/FeatureSet/Dashboard/src/${MODEL}`,
      unmarked,
      { kind: "ui" },
    ).strings.map((entry: ExtractedString): string => {
      return entry.text;
    });

    expect(unmarked).not.toEqual(readSource(MODEL));
    expect(extracted).not.toContain("Hosts & containers");
  });
});
