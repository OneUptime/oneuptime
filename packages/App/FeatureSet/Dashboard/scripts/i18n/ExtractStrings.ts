import { REPOSITORY_ROOT } from "./LocaleFiles";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * Finds the user-facing strings in the Dashboard's source, the shared UI
 * components it renders and the data models whose names those components
 * show, by reading the TypeScript syntax tree - never by searching text, so
 * a string's position decides whether it is copy, not its spelling.
 *
 * A string is user-facing when it is:
 *
 *   - "call":           the key passed to a translation function - t(),
 *                       tx(), translateString(), translateTemplate(),
 *                       translationKey(), any translate*() helper;
 *   - "plural":         a PluralTemplate, { one: "...", other: "..." };
 *   - "prop":           a JSX attribute or object property whose name says
 *                       it is shown (title, description, placeholder, label,
 *                       noItemsMessage... - USER_FACING_PROPS), or a tab's
 *                       name;
 *   - "jsx-text":       the whole text of an element (<p>No data yet.</p>),
 *                       or a string literal standing alone as a child;
 *   - "setter":         the message given to a state setter such as
 *                       setError("...") or setWarningMessage("...");
 *   - "model":          a model's singularName, pluralName or
 *                       tableDescription, or a column's title.
 *
 * It also lists the strings that are on screen but not looked up at run
 * time (`hardcoded`): element text, text attributes of plain HTML elements,
 * and sentences glued together from pieces. That list is the work left for
 * whoever routes a directory through translation (npm run i18n:hardcoded).
 */

export type ExtractedKind =
  | "call"
  | "plural"
  | "prop"
  | "jsx-text"
  | "setter"
  | "model";

export interface ExtractedString {
  text: string;
  kind: ExtractedKind;
  // Repository-relative, with forward slashes.
  file: string;
  line: number;
  // A PluralTemplate's "one" sentence; `text` is its "other" sentence.
  pluralOne?: string | undefined;
  /*
   * A nested key read with t("commandPalette.actions.logOut", "Log out"):
   * its path, with `text` the English default the call gives.
   */
  nestedPath?: Array<string> | undefined;
}

/*
 * A nested key a t() call reads without giving its English text, which
 * en.json does not have either - shown to the reader as the raw key.
 */
export interface UndefinedNestedKey {
  path: Array<string>;
  file: string;
  line: number;
}

export type HardcodedReason =
  // Text between tags, or a string literal standing in for it.
  | "jsx-text"
  // title / placeholder / aria-label / alt on a plain HTML element.
  | "html-attribute"
  // A sentence built from pieces: a template literal or "a" + b.
  | "composed";

export interface HardcodedString {
  text: string;
  reason: HardcodedReason;
  file: string;
  line: number;
}

export interface SourceScanResult {
  strings: Array<ExtractedString>;
  hardcoded: Array<HardcodedString>;
  // Nested keys read with no English default anywhere in the call.
  nestedKeyReferences: Array<UndefinedNestedKey>;
}

export type SourceKind = "ui" | "models";

export interface SourceRoot {
  // Repository-relative directory.
  directory: string;
  kind: SourceKind;
}

/*
 * Everything the Dashboard puts on screen comes from these. Stage-2 work
 * that routes strings from elsewhere (Common/Types, say) through translation
 * adds the directory here, so those strings are extracted too.
 */
export const SOURCE_ROOTS: Array<SourceRoot> = [
  { directory: "packages/App/FeatureSet/Dashboard/src", kind: "ui" },
  { directory: "packages/Common/UI", kind: "ui" },
  { directory: "packages/Common/Models/DatabaseModels", kind: "models" },
  { directory: "packages/Common/Models/AnalyticsModels", kind: "models" },
];

/*
 * Property and attribute names whose string value is shown to the reader.
 * Names that are sometimes copy and sometimes an identifier (name, value,
 * key, id, type, category, body) are left out on purpose: a wrong key in
 * en.json costs translators time, a missing one is caught by
 * npm run i18n:hardcoded.
 */
export const USER_FACING_PROPS: ReadonlySet<string> = new Set<string>([
  "actionText",
  "actionTitle",
  "alt",
  "aria-description",
  "aria-label",
  "aria-placeholder",
  "aria-roledescription",
  "aria-valuetext",
  "ariaLabel",
  "buttonText",
  "cancelButtonText",
  "caption",
  "chipLabel",
  "closeButtonText",
  "confirmButtonText",
  "createButtonText",
  "createVerb",
  "deleteButtonText",
  "deleteVerb",
  "description",
  "editButtonText",
  "emptyDescription",
  "emptyMessage",
  "emptyStateDescription",
  "emptyStateMessage",
  "emptyStateTitle",
  "emptyTitle",
  "errorMessage",
  "explanation",
  "heading",
  "helpText",
  "hint",
  "label",
  "legend",
  "linkText",
  "loadingMessage",
  "meaning",
  "message",
  "moreText",
  "noItemsMessage",
  "noLogsMessage",
  "noValueMessage",
  "optionsLabel",
  "placeholder",
  "pluralLabel",
  "pluralName",
  "question",
  "searchPlaceholder",
  "sectionDescription",
  "sectionTitle",
  "seriesName",
  "singularLabel",
  "singularName",
  "strongTitle",
  "sublabel",
  "submitButtonText",
  "subtitle",
  "successMessage",
  "summary",
  "text",
  "title",
  "tooltip",
  "warningMessage",
]);

// Attributes of a plain HTML element that the browser shows as text.
const HTML_TEXT_ATTRIBUTES: ReadonlySet<string> = new Set<string>([
  "alt",
  "aria-description",
  "aria-label",
  "aria-placeholder",
  "aria-roledescription",
  "aria-valuetext",
  "label",
  "placeholder",
  "title",
]);

/*
 * Object properties that are copy only inside a particular list: a tab's
 * "name" is its label (Tab translates it), while "name" elsewhere is usually
 * an identifier.
 */
const PROPS_IN_LISTS: ReadonlyArray<{ list: string; prop: string }> = [
  { list: "tabs", prop: "name" },
];

// Element text inside these is code or a key name, not copy.
const CODE_ELEMENTS: ReadonlySet<string> = new Set<string>([
  "code",
  "kbd",
  "pre",
  "samp",
  "script",
  "style",
  "var",
  "CodeBlock",
  "CodeEditor",
  "InlineCode",
  "KeyboardKey",
  "ShortcutKey",
]);

/*
 * Components whose `template` attribute is a sentence they translate:
 * <TranslatedSentence template="{{field}} is {{value}}" ... />.
 */
const TEMPLATE_COMPONENTS: ReadonlySet<string> = new Set<string>([
  "NamedSentence",
  "TranslatedSentence",
]);

/*
 * Translation functions whose key is not their first argument:
 * translateInterpolated(translateString, "~{{count}} fetches", values).
 */
const KEY_ARGUMENT_INDEX: Readonly<Record<string, number>> = {
  translateInterpolated: 1,
};

// t(), tx(), translate(), translateString(), translateTemplate(), ...
const TRANSLATION_FUNCTION: RegExp =
  /^(t|tx|translate|translationKey|translate[A-Z][A-Za-z0-9]*)$/;

// setError("..."), setEmptyMessage("..."), setModalTitle("...").
const MESSAGE_SETTER: RegExp =
  /^set([A-Z][A-Za-z0-9]*)?(Error|Message|Title|Description|Label|Text|Notice|Warning|Hint|Placeholder)$/;

// Model metadata: the names and description of a model.
const MODEL_NAME_PROPS: ReadonlySet<string> = new Set<string>([
  "singularName",
  "pluralName",
  "tableDescription",
]);

// Calls whose object argument describes a column; its title is shown.
const MODEL_COLUMN_CALLS: ReadonlySet<string> = new Set<string>([
  "TableColumn",
  "AnalyticsTableColumn",
]);

const HTML_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  apos: "'",
  bull: "•",
  copy: "©",
  gt: ">",
  hellip: "…",
  larr: "←",
  laquo: "«",
  ldquo: "“",
  lsquo: "‘",
  lt: "<",
  mdash: "—",
  middot: "·",
  nbsp: " ",
  ndash: "–",
  quot: '"',
  raquo: "»",
  rarr: "→",
  rdquo: "”",
  reg: "®",
  rsquo: "’",
  times: "×",
  trade: "™",
};

// The text React renders for JSX entity references: "&hellip;" -> "…".
export const decodeHtmlEntities: (text: string) => string = (
  text: string,
): string => {
  return text.replace(
    /&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi,
    (match: string, entity: string): string => {
      if (entity.startsWith("#x") || entity.startsWith("#X")) {
        return String.fromCodePoint(parseInt(entity.slice(2), 16));
      }

      if (entity.startsWith("#")) {
        return String.fromCodePoint(parseInt(entity.slice(1), 10));
      }

      return HTML_ENTITIES[entity] ?? match;
    },
  );
};

/*
 * JSX text the way React renders it (Babel's cleanJSXElementLiteralChild):
 * lines are trimmed where they meet a line break, blank lines dropped, and
 * what is left joined with single spaces.
 */
// A line with something on it besides spaces and tabs.
const HAS_TEXT: RegExp = /[^ \t]/;

export const cleanJsxText: (raw: string) => string = (raw: string): string => {
  const lines: Array<string> = raw.split(/\r\n|\n|\r/);
  let lastNonEmptyLine: number = 0;

  lines.forEach((line: string, index: number): void => {
    if (HAS_TEXT.test(line)) {
      lastNonEmptyLine = index;
    }
  });

  let result: string = "";

  lines.forEach((line: string, index: number): void => {
    let trimmed: string = line.replace(/\t/g, " ");

    if (index !== 0) {
      trimmed = trimmed.replace(/^[ ]+/, "");
    }

    if (index !== lines.length - 1) {
      trimmed = trimmed.replace(/[ ]+$/, "");
    }

    if (trimmed) {
      if (index !== lastNonEmptyLine) {
        trimmed = `${trimmed} `;
      }

      result += trimmed;
    }
  });

  return result;
};

const PLACEHOLDER: RegExp = /\{\{[^{}]*\}\}/g;

const LETTER: RegExp = /\p{L}/u;

// Two letters in a row: a word, not "1-10" or "%".
const WORD: RegExp = /\p{L}{2,}/u;

const ONLY_DIGITS: RegExp = /^\d+$/;

const BLANK_LINE: RegExp = /\n\s*\n/;

const URL_SCHEME: RegExp = /:\/\//;

// A path ("/dashboard", "./x") or a hex color ("#6366f1").
const PATH_OR_COLOR: RegExp = /^(\/|\.\/|\.\.\/|#[0-9a-f]{3,8}$)/i;

// Identifier shapes: camelCase, snake_case, kebab-case-id, a.dotted.path.
const IDENTIFIER_SHAPES: ReadonlyArray<RegExp> = [
  /^[a-z]+[A-Z][A-Za-z0-9]*$/,
  /^[A-Za-z0-9]+(_[A-Za-z0-9]+)+$/,
  /^[a-z0-9]+(-[a-z0-9]+){2,}$/,
  /^[\w-]+(\.[\w-]+)+$/,
  /[=<>{}()[\]\\|;$`]/,
];

const LOWERCASE_START: RegExp = /^[a-z]/;

const SOURCE_FILE_NAME: RegExp = /\.tsx?$/;

const TEST_FILE_NAME: RegExp = /\.test\.tsx?$/;

/*
 * Tailwind-style utility: "flex", "text-sm", "hover:bg-gray-50", "w-1/2".
 * A hyphen, a variant colon or a digit: "items-center", "sm:block", "p2".
 */
const UTILITY_MARK: RegExp = /[-:\d]/;

/*
 * A Tailwind utility class: "flex", "text-sm", "hover:bg-gray-50", "w-1/2".
 * Matched by its prefix, so a lowercase phrase with a hyphen in it ("on-call
 * duty") is not mistaken for a class list.
 */
const UTILITY_CLASS: RegExp =
  /^(?:[a-z0-9-]+:)*!?-?(?:flex|grid|block|inline|hidden|relative|absolute|fixed|sticky|static|items|justify|content|self|place|gap|space|divide|p|px|py|pt|pr|pb|pl|m|mx|my|mt|mr|mb|ml|w|h|size|min|max|text|font|bg|border|rounded|shadow|ring|outline|opacity|z|top|left|right|bottom|inset|overflow|truncate|whitespace|break|cursor|select|pointer|transition|duration|ease|delay|animate|transform|translate|scale|rotate|sr|leading|tracking|underline|uppercase|lowercase|capitalize|italic|align|order|col|row|fill|stroke|object|aspect|container|list|decoration|grow|shrink|basis|line|from|via|to|backdrop|blur|dark|group|peer)(?:-[a-z0-9./[\]%#()]+)*$/;

/*
 * Whether a string is something a person reads rather than an identifier,
 * a class list, a path or a document. Explicit translation keys ("call",
 * "plural") are trusted further: they only need a letter.
 */
export const isTranslatableText: (
  text: string,
  kind: ExtractedKind,
) => boolean = (text: string, kind: ExtractedKind): boolean => {
  const trimmed: string = text.trim();

  if (!trimmed || !LETTER.test(trimmed.replace(PLACEHOLDER, ""))) {
    return false;
  }

  // An array-index key would be moved to the front of the JSON object.
  if (ONLY_DIGITS.test(text)) {
    return false;
  }

  if (kind === "call" || kind === "plural") {
    return true;
  }

  // A markdown document or a code sample is not a phrase.
  if (trimmed.includes("```") || BLANK_LINE.test(trimmed)) {
    return false;
  }

  if (URL_SCHEME.test(trimmed) || PATH_OR_COLOR.test(trimmed)) {
    return false;
  }

  const tokens: Array<string> = trimmed.split(/\s+/);

  if (tokens.length === 1) {
    const token: string = tokens[0] as string;

    // camelCase, snake_case, CONSTANT_CASE, kebab-case-identifier, a.dotted.path
    if (
      IDENTIFIER_SHAPES.some((shape: RegExp): boolean => {
        return shape.test(token);
      })
    ) {
      return false;
    }
  }

  // A class list: every word a utility, and at least one plainly one.
  if (
    tokens.length > 1 &&
    tokens.every((token: string): boolean => {
      return UTILITY_CLASS.test(token);
    }) &&
    tokens.some((token: string): boolean => {
      return UTILITY_MARK.test(token);
    })
  ) {
    return false;
  }

  return true;
};

// The last identifier of a callee: t, translateString, i18n.t -> t.
const getCalleeName: (expression: ts.Expression) => string | undefined = (
  expression: ts.Expression,
): string | undefined => {
  if (ts.isIdentifier(expression)) {
    return expression.text;
  }

  if (ts.isPropertyAccessExpression(expression)) {
    return expression.name.text;
  }

  return undefined;
};

const getPropertyName: (name: ts.PropertyName) => string | undefined = (
  name: ts.PropertyName,
): string | undefined => {
  if (
    ts.isIdentifier(name) ||
    ts.isStringLiteral(name) ||
    ts.isNoSubstitutionTemplateLiteral(name)
  ) {
    return name.text;
  }

  return undefined;
};

const getJsxAttributeName: (attribute: ts.JsxAttribute) => string = (
  attribute: ts.JsxAttribute,
): string => {
  return attribute.name.getText();
};

const unwrap: (expression: ts.Expression) => ts.Expression = (
  expression: ts.Expression,
): ts.Expression => {
  let current: ts.Expression = expression;

  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression;
  }

  return current;
};

/*
 * The string literals an expression can evaluate to directly: "a",
 * cond ? "a" : "b", x || "a", x ?? "a". Calls and concatenations are not
 * looked into.
 */
const getLiteralStrings: (
  expression: ts.Expression,
) => Array<{ text: string; node: ts.Node }> = (
  expression: ts.Expression,
): Array<{ text: string; node: ts.Node }> => {
  const node: ts.Expression = unwrap(expression);

  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return [{ text: node.text, node: node }];
  }

  if (ts.isConditionalExpression(node)) {
    return [
      ...getLiteralStrings(node.whenTrue),
      ...getLiteralStrings(node.whenFalse),
    ];
  }

  if (
    ts.isBinaryExpression(node) &&
    (node.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
      node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)
  ) {
    return [...getLiteralStrings(node.left), ...getLiteralStrings(node.right)];
  }

  // cond && "a"
  if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
  ) {
    return getLiteralStrings(node.right);
  }

  return [];
};

/*
 * A sentence glued from pieces in a place where copy goes: `Delete
 * ${name}` or "Delete " + name. These need a template (see
 * Common/UI/Utils/TranslateTemplate).
 */
const getComposedStrings: (expression: ts.Expression) => Array<ts.Node> = (
  expression: ts.Expression,
): Array<ts.Node> => {
  const node: ts.Expression = unwrap(expression);

  if (ts.isTemplateExpression(node)) {
    const literalText: string = [
      node.head.text,
      ...node.templateSpans.map((span: ts.TemplateSpan): string => {
        return span.literal.text;
      }),
    ].join(" ");

    return LETTER.test(literalText) && WORD.test(literalText) ? [node] : [];
  }

  if (ts.isConditionalExpression(node)) {
    return [
      ...getComposedStrings(node.whenTrue),
      ...getComposedStrings(node.whenFalse),
    ];
  }

  if (ts.isBinaryExpression(node)) {
    if (node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      // Every piece of "a" + b + "c", however the chain nests.
      const operands: Array<ts.Expression> = [];
      const collect: (operand: ts.Expression) => void = (
        operand: ts.Expression,
      ): void => {
        const inner: ts.Expression = unwrap(operand);

        if (
          ts.isBinaryExpression(inner) &&
          inner.operatorToken.kind === ts.SyntaxKind.PlusToken
        ) {
          collect(inner.left);
          collect(inner.right);
        } else {
          operands.push(inner);
        }
      };

      collect(node);

      const hasWords: boolean = operands.some(
        (operand: ts.Expression): boolean => {
          return (
            (ts.isStringLiteral(operand) ||
              ts.isNoSubstitutionTemplateLiteral(operand)) &&
            WORD.test(operand.text)
          );
        },
      );

      return hasWords ? [node] : [];
    }

    if (
      node.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
      node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
    ) {
      return [
        ...getComposedStrings(node.left),
        ...getComposedStrings(node.right),
      ];
    }
  }

  return [];
};

const getTagName: (
  element: ts.JsxElement | ts.JsxSelfClosingElement,
) => string = (element: ts.JsxElement | ts.JsxSelfClosingElement): string => {
  const tagName: ts.JsxTagNameExpression = ts.isJsxElement(element)
    ? element.openingElement.tagName
    : element.tagName;

  return tagName.getText();
};

const isIntrinsicTag: (tagName: string) => boolean = (
  tagName: string,
): boolean => {
  return LOWERCASE_START.test(tagName) && !tagName.includes(".");
};

// The element a JSX child or attribute belongs to.
const getOwningElement: (
  node: ts.Node,
) => ts.JsxElement | ts.JsxSelfClosingElement | undefined = (
  node: ts.Node,
): ts.JsxElement | ts.JsxSelfClosingElement | undefined => {
  let current: ts.Node | undefined = node.parent;

  while (current) {
    if (ts.isJsxElement(current) || ts.isJsxSelfClosingElement(current)) {
      return current;
    }

    if (ts.isJsxOpeningElement(current)) {
      return current.parent;
    }

    if (ts.isJsxFragment(current)) {
      return undefined;
    }

    current = current.parent;
  }

  return undefined;
};

const isInsideCodeElement: (node: ts.Node) => boolean = (
  node: ts.Node,
): boolean => {
  let element: ts.JsxElement | ts.JsxSelfClosingElement | undefined =
    getOwningElement(node);

  while (element) {
    if (CODE_ELEMENTS.has(getTagName(element))) {
      return true;
    }

    element = getOwningElement(element);
  }

  return false;
};

// Children that matter: not whitespace-only text, not {/* comments */}.
const getMeaningfulChildren: (
  children: ts.NodeArray<ts.JsxChild>,
) => Array<ts.JsxChild> = (
  children: ts.NodeArray<ts.JsxChild>,
): Array<ts.JsxChild> => {
  return children.filter((child: ts.JsxChild): boolean => {
    if (ts.isJsxText(child)) {
      return child.text.trim().length > 0;
    }

    if (ts.isJsxExpression(child)) {
      return child.expression !== undefined;
    }

    return true;
  });
};

// A property assignment inside an object that is an item of `tabs: [...]`.
const isPropInList: (node: ts.PropertyAssignment, prop: string) => boolean = (
  node: ts.PropertyAssignment,
  prop: string,
): boolean => {
  const object: ts.Node = node.parent;
  const list: ts.Node | undefined = object?.parent;

  if (!list || !ts.isArrayLiteralExpression(list)) {
    return false;
  }

  let holder: ts.Node | undefined = list.parent;

  if (holder && ts.isJsxExpression(holder)) {
    holder = holder.parent;
  }

  if (!holder) {
    return false;
  }

  let holderName: string | undefined = undefined;

  if (ts.isPropertyAssignment(holder)) {
    holderName = getPropertyName(holder.name);
  } else if (ts.isJsxAttribute(holder)) {
    holderName = getJsxAttributeName(holder);
  }

  return PROPS_IN_LISTS.some(
    (rule: { list: string; prop: string }): boolean => {
      return rule.prop === prop && rule.list === holderName;
    },
  );
};

const shortSnippet: (node: ts.Node) => string = (node: ts.Node): string => {
  const text: string = node.getText().replace(/\s+/g, " ").trim();

  return text.length > 120 ? `${text.slice(0, 117)}...` : text;
};

export interface ScanOptions {
  kind: SourceKind;
}

/*
 * react-i18next's t() splits its key on dots, so t("navbar.items.formsTitle")
 * reads a nested key. The other translation helpers turn that off and look a
 * whole English sentence up, dots and all ("Loading...", "Node.js").
 */
const NESTED_KEY_PATH: RegExp = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/;

const NESTED_KEY_FUNCTIONS: ReadonlySet<string> = new Set<string>(["t"]);

// The English default a t() call gives a nested key, if it gives one.
const getNestedKeyDefault: (
  call: ts.CallExpression,
) => { text: string; node: ts.Node } | undefined = (
  call: ts.CallExpression,
): { text: string; node: ts.Node } | undefined => {
  const second: ts.Expression | undefined = call.arguments[1];

  if (!second) {
    return undefined;
  }

  const literal: { text: string; node: ts.Node } | undefined =
    getLiteralStrings(second)[0];

  if (literal) {
    return literal;
  }

  const options: ts.Expression = unwrap(second);

  if (ts.isObjectLiteralExpression(options)) {
    for (const property of options.properties) {
      if (
        ts.isPropertyAssignment(property) &&
        getPropertyName(property.name) === "defaultValue"
      ) {
        return getLiteralStrings(property.initializer)[0];
      }
    }
  }

  return undefined;
};

/*
 * Scans one file. `file` is how results name it (repository-relative);
 * `sourceText` is its content.
 */
export const scanSourceText: (
  file: string,
  sourceText: string,
  options: ScanOptions,
) => SourceScanResult = (
  file: string,
  sourceText: string,
  options: ScanOptions,
): SourceScanResult => {
  const strings: Array<ExtractedString> = [];
  const hardcoded: Array<HardcodedString> = [];
  const nestedKeyReferences: Array<UndefinedNestedKey> = [];

  const sourceFile: ts.SourceFile = ts.createSourceFile(
    file,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const lineOf: (node: ts.Node) => number = (node: ts.Node): number => {
    return (
      sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line +
      1
    );
  };

  const add: (
    text: string,
    kind: ExtractedKind,
    node: ts.Node,
    extra?: { pluralOne?: string; nestedPath?: Array<string> },
  ) => void = (
    text: string,
    kind: ExtractedKind,
    node: ts.Node,
    extra?: { pluralOne?: string; nestedPath?: Array<string> },
  ): void => {
    if (!isTranslatableText(text, extra?.nestedPath ? "call" : kind)) {
      return;
    }

    const entry: ExtractedString = {
      text: text,
      kind: kind,
      file: file,
      line: lineOf(node),
    };

    if (extra?.pluralOne !== undefined) {
      entry.pluralOne = extra.pluralOne;
    }

    if (extra?.nestedPath !== undefined) {
      entry.nestedPath = extra.nestedPath;
    }

    strings.push(entry);
  };

  // A t("a.b.c") call: a nested key, with or without its English default.
  const addNestedKey: (
    call: ts.CallExpression,
    keyNode: ts.Node,
    key: string,
  ) => void = (
    call: ts.CallExpression,
    keyNode: ts.Node,
    key: string,
  ): void => {
    const fallback: { text: string; node: ts.Node } | undefined =
      getNestedKeyDefault(call);

    if (fallback) {
      add(fallback.text, "call", keyNode, { nestedPath: key.split(".") });
      return;
    }

    nestedKeyReferences.push({
      path: key.split("."),
      file: file,
      line: lineOf(keyNode),
    });
  };

  const report: (
    text: string,
    reason: HardcodedReason,
    node: ts.Node,
  ) => void = (text: string, reason: HardcodedReason, node: ts.Node): void => {
    hardcoded.push({
      text: text,
      reason: reason,
      file: file,
      line: lineOf(node),
    });
  };

  const visitModel: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isPropertyAssignment(node) &&
      MODEL_NAME_PROPS.has(getPropertyName(node.name) || "")
    ) {
      for (const literal of getLiteralStrings(node.initializer)) {
        add(literal.text, "model", literal.node);
      }
    }

    if (
      (ts.isCallExpression(node) || ts.isNewExpression(node)) &&
      MODEL_COLUMN_CALLS.has(getCalleeName(node.expression) || "")
    ) {
      for (const argument of node.arguments || []) {
        if (!ts.isObjectLiteralExpression(argument)) {
          continue;
        }

        for (const property of argument.properties) {
          if (
            ts.isPropertyAssignment(property) &&
            getPropertyName(property.name) === "title"
          ) {
            for (const literal of getLiteralStrings(property.initializer)) {
              add(literal.text, "model", literal.node);
            }
          }
        }
      }
    }

    ts.forEachChild(node, visitModel);
  };

  const visitUi: (node: ts.Node) => void = (node: ts.Node): void => {
    // Translation calls and message setters.
    if (ts.isCallExpression(node)) {
      const callee: string | undefined = getCalleeName(node.expression);

      if (callee && TRANSLATION_FUNCTION.test(callee)) {
        const argument: ts.Expression | undefined =
          node.arguments[KEY_ARGUMENT_INDEX[callee] ?? 0];

        if (argument) {
          for (const literal of getLiteralStrings(argument)) {
            if (
              NESTED_KEY_FUNCTIONS.has(callee) &&
              NESTED_KEY_PATH.test(literal.text)
            ) {
              addNestedKey(node, literal.node, literal.text);
            } else {
              add(literal.text, "call", literal.node);
            }
          }
        }

        // translateNamedAction(translator, { template: "Edit {{itemName}}" })
        for (const callArgument of node.arguments) {
          const unwrapped: ts.Expression = unwrap(callArgument);

          if (!ts.isObjectLiteralExpression(unwrapped)) {
            continue;
          }

          for (const property of unwrapped.properties) {
            if (
              ts.isPropertyAssignment(property) &&
              getPropertyName(property.name) === "template"
            ) {
              for (const literal of getLiteralStrings(property.initializer)) {
                add(literal.text, "call", literal.node);
              }
            }
          }
        }
      } else if (callee && MESSAGE_SETTER.test(callee)) {
        const argument: ts.Expression | undefined = node.arguments[0];

        if (argument) {
          for (const literal of getLiteralStrings(argument)) {
            add(literal.text, "setter", literal.node);
          }
        }
      }
    }

    // { one: "...", other: "..." }
    if (ts.isObjectLiteralExpression(node) && node.properties.length === 2) {
      const forms: Record<string, string> = {};

      for (const property of node.properties) {
        if (ts.isPropertyAssignment(property)) {
          const name: string | undefined = getPropertyName(property.name);
          const value: ts.Expression = unwrap(property.initializer);

          if (
            name &&
            (ts.isStringLiteral(value) ||
              ts.isNoSubstitutionTemplateLiteral(value))
          ) {
            forms[name] = value.text;
          }
        }
      }

      if (forms["one"] !== undefined && forms["other"] !== undefined) {
        add(forms["other"], "plural", node, { pluralOne: forms["one"] });
      }
    }

    // Object properties that hold copy.
    if (ts.isPropertyAssignment(node)) {
      const name: string | undefined = getPropertyName(node.name);

      if (name && (USER_FACING_PROPS.has(name) || isPropInList(node, name))) {
        for (const literal of getLiteralStrings(node.initializer)) {
          add(literal.text, "prop", literal.node);
        }

        for (const composed of getComposedStrings(node.initializer)) {
          report(shortSnippet(composed), "composed", composed);
        }
      }
    }

    // <TranslatedSentence template="..." />
    if (
      ts.isJsxAttribute(node) &&
      node.initializer &&
      getJsxAttributeName(node) === "template"
    ) {
      const element: ts.JsxElement | ts.JsxSelfClosingElement | undefined =
        getOwningElement(node);

      if (element && TEMPLATE_COMPONENTS.has(getTagName(element))) {
        const templates: Array<{ text: string; node: ts.Node }> =
          ts.isStringLiteral(node.initializer)
            ? [{ text: node.initializer.text, node: node.initializer }]
            : ts.isJsxExpression(node.initializer) &&
                node.initializer.expression
              ? getLiteralStrings(node.initializer.expression)
              : [];

        for (const template of templates) {
          add(template.text, "call", template.node);
        }
      }
    }

    // JSX attributes that hold copy.
    if (ts.isJsxAttribute(node) && node.initializer) {
      const name: string = getJsxAttributeName(node);

      if (USER_FACING_PROPS.has(name)) {
        const element: ts.JsxElement | ts.JsxSelfClosingElement | undefined =
          getOwningElement(node);
        const isHtmlTextAttribute: boolean =
          Boolean(element) &&
          isIntrinsicTag(getTagName(element!)) &&
          HTML_TEXT_ATTRIBUTES.has(name);

        const literals: Array<{ text: string; node: ts.Node }> =
          ts.isStringLiteral(node.initializer)
            ? [
                {
                  text: decodeHtmlEntities(node.initializer.text),
                  node: node.initializer,
                },
              ]
            : ts.isJsxExpression(node.initializer) &&
                node.initializer.expression
              ? getLiteralStrings(node.initializer.expression)
              : [];

        for (const literal of literals) {
          add(literal.text, "prop", literal.node);

          if (isHtmlTextAttribute && isTranslatableText(literal.text, "prop")) {
            report(literal.text, "html-attribute", literal.node);
          }
        }

        if (
          ts.isJsxExpression(node.initializer) &&
          node.initializer.expression
        ) {
          for (const composed of getComposedStrings(
            node.initializer.expression,
          )) {
            report(shortSnippet(composed), "composed", composed);
          }
        }
      }
    }

    // Text between tags.
    if (ts.isJsxText(node) && LETTER.test(node.text)) {
      const parent: ts.Node = node.parent;
      const text: string = decodeHtmlEntities(cleanJsxText(node.text))
        .replace(/\s+/g, " ")
        .trim();

      if (text && !isInsideCodeElement(node)) {
        const siblings: Array<ts.JsxChild> =
          ts.isJsxElement(parent) || ts.isJsxFragment(parent)
            ? getMeaningfulChildren(parent.children)
            : [node];

        if (siblings.length === 1) {
          add(text, "jsx-text", node);

          if (isTranslatableText(text, "jsx-text")) {
            report(text, "jsx-text", node);
          }
        } else if (isTranslatableText(text, "jsx-text")) {
          // A piece of a sentence with values or markup in it.
          report(text, "composed", node);
        }
      }
    }

    // {"Text"} or {cond ? "A" : "B"} standing in for element text.
    if (
      ts.isJsxExpression(node) &&
      node.expression &&
      node.parent &&
      (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent)) &&
      !isInsideCodeElement(node)
    ) {
      for (const literal of getLiteralStrings(node.expression)) {
        add(literal.text, "jsx-text", literal.node);

        if (isTranslatableText(literal.text, "jsx-text")) {
          report(literal.text, "jsx-text", literal.node);
        }
      }

      for (const composed of getComposedStrings(node.expression)) {
        report(shortSnippet(composed), "composed", composed);
      }
    }

    ts.forEachChild(node, visitUi);
  };

  if (options.kind === "models") {
    visitModel(sourceFile);
  } else {
    visitUi(sourceFile);
  }

  return {
    strings: strings,
    hardcoded: hardcoded,
    nestedKeyReferences: nestedKeyReferences,
  };
};

const SKIPPED_DIRECTORIES: ReadonlySet<string> = new Set<string>([
  "Locales",
  "build",
  "dist",
  "node_modules",
]);

// Every .ts / .tsx file under a directory, sorted, without declarations.
export const listSourceFiles: (directory: string) => Array<string> = (
  directory: string,
): Array<string> => {
  const files: Array<string> = [];

  const walk: (current: string) => void = (current: string): void => {
    if (!fs.existsSync(current)) {
      return;
    }

    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath: string = path.join(current, entry.name);

      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name)) {
          walk(fullPath);
        }
      } else if (
        SOURCE_FILE_NAME.test(entry.name) &&
        !entry.name.endsWith(".d.ts") &&
        !TEST_FILE_NAME.test(entry.name)
      ) {
        files.push(fullPath);
      }
    }
  };

  walk(directory);

  return files.sort();
};

export const toRepositoryPath: (
  filePath: string,
  repositoryRoot?: string,
) => string = (filePath: string, repositoryRoot?: string): string => {
  return path
    .relative(repositoryRoot || REPOSITORY_ROOT, filePath)
    .split(path.sep)
    .join("/");
};

/*
 * Scans every source root. Results are in a fixed order - by file, then
 * line - so two runs over the same tree print the same thing.
 */
export const scanSourceRoots: (
  roots: ReadonlyArray<SourceRoot>,
  repositoryRoot?: string,
) => SourceScanResult = (
  roots: ReadonlyArray<SourceRoot>,
  repositoryRoot?: string,
): SourceScanResult => {
  const rootDirectory: string = repositoryRoot || REPOSITORY_ROOT;
  const strings: Array<ExtractedString> = [];
  const hardcoded: Array<HardcodedString> = [];
  const nestedKeyReferences: Array<UndefinedNestedKey> = [];

  for (const root of roots) {
    for (const filePath of listSourceFiles(
      path.join(rootDirectory, root.directory),
    )) {
      const result: SourceScanResult = scanSourceText(
        toRepositoryPath(filePath, rootDirectory),
        fs.readFileSync(filePath, "utf8"),
        { kind: root.kind },
      );

      strings.push(...result.strings);
      hardcoded.push(...result.hardcoded);
      nestedKeyReferences.push(...result.nestedKeyReferences);
    }
  }

  return {
    strings: strings,
    hardcoded: hardcoded,
    nestedKeyReferences: nestedKeyReferences,
  };
};

/*
 * The en.json entries the strings call for: each text maps to itself, and a
 * PluralTemplate adds its "_one" sentence under the "other" sentence's key.
 */
export const getEnglishEntries: (
  strings: ReadonlyArray<ExtractedString>,
) => Record<string, string> = (
  strings: ReadonlyArray<ExtractedString>,
): Record<string, string> => {
  const entries: Record<string, string> = {};

  for (const entry of strings) {
    if (entry.nestedPath) {
      continue;
    }

    entries[entry.text] = entry.text;

    if (entry.pluralOne !== undefined) {
      entries[`${entry.text}_one`] = entry.pluralOne;
    }
  }

  return entries;
};

export interface NestedEnglishEntry {
  path: Array<string>;
  value: string;
}

/*
 * The nested keys the t() calls read, with the English each call gives. The
 * first call in file order wins where two give the same key different text.
 */
export const getNestedEnglishEntries: (
  strings: ReadonlyArray<ExtractedString>,
) => Array<NestedEnglishEntry> = (
  strings: ReadonlyArray<ExtractedString>,
): Array<NestedEnglishEntry> => {
  const entries: Map<string, NestedEnglishEntry> = new Map<
    string,
    NestedEnglishEntry
  >();

  for (const entry of strings) {
    if (!entry.nestedPath) {
      continue;
    }

    const id: string = entry.nestedPath.join(".");

    if (!entries.has(id)) {
      entries.set(id, { path: entry.nestedPath, value: entry.text });
    }
  }

  return Array.from(entries.values());
};
