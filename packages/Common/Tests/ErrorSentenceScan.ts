import fs from "fs";
import path from "path";
import ts from "typescript";
import {
  listScanRoots,
  listSourceFiles,
  toRelativePath,
} from "./ForeignHiddenRuleGuard";

/*
 * Where a sentence of the product puts an error in it (ErrorSentenceGuard).
 *
 * Issue #7307: cards say what failed in a sentence of their own and fill
 * {{error}} (or {{message}}) with API.getFriendlyMessage's answer - looked
 * up in the reader's language and otherwise drawn as written. A gateway's
 * 502 or 504 is SERVER_DOWN_MESSAGE, which is no key, and a server failure
 * comes with its reference filled in, so a German card read "Es konnte
 * nicht ermittelt werden, wer benachrichtigt wird. Error connecting to
 * server. Please try again in few minutes.", and the reference had no copy
 * button.
 *
 * There is one way to put an error in a sentence now (Common/UI/Utils/
 * ErrorInSentence): draw the sentence with ErrorSentence, or give the
 * placeholder errorInSentence(message) as its value. This finds every
 * sentence with {{error}} or {{message}} in it - a template written in a
 * translate call, in an ErrorSentence or TranslatedSentence, or kept in a
 * constant or a copy object and filled elsewhere - and says how each is
 * filled, read through the TypeScript AST so a comment that quotes a
 * sentence is not one.
 */

// The placeholders an error goes in.
export const ERROR_PLACEHOLDERS: ReadonlyArray<string> = ["error", "message"];

// The calls that fill a template, and which argument holds the values.
const FILLING_CALLS: Record<string, number> = {
  translateTemplate: 1,
  translatePlural: 2,
};

// The keys of a PluralTemplate ({ one, other }).
const PLURAL_KEYS: ReadonlySet<string> = new Set<string>([
  "zero",
  "one",
  "two",
  "few",
  "many",
  "other",
]);

// The value a placeholder holding an error must be given.
export const ERROR_VALUE_CALL: string = "errorInSentence";

// The component that draws a sentence with an error in it.
export const ERROR_SENTENCE_TAG: string = "ErrorSentence";

export enum ErrorSentenceUse {
  // <ErrorSentence template="... {{error}}" error={message} />
  ErrorSentence = "ErrorSentence",
  // translateTemplate("... {{error}}", { error: errorInSentence(message) })
  ErrorValue = "errorInSentence value",
  // A finding: the placeholder is filled with something else.
  PlainValue = "plain value",
  // A finding: a TranslatedSentence (or other element) draws the template.
  OtherElement = "other element",
  // A finding: an ErrorSentence whose error goes in another placeholder.
  WrongPlaceholder = "wrong placeholder",
  // A finding: the values are not written where the template is filled.
  UnreadValues = "values not written out",
  // A finding: the template is filled by hand (.replace("{{error}}", ...)).
  FilledByHand = "filled by hand",
  // A template kept in a constant or a copy object: see its uses.
  Stored = "stored",
  // A finding: a stored template no read of its name fills.
  Unfilled = "filled nowhere the guard sees",
  // A finding: none of the above.
  Unknown = "unknown use",
  /*
   * A finding: API.getFriendlyMessage(...) given straight to a placeholder
   * of any name ({{reason}}, {{detail}}): the same message, the same words.
   */
  FriendlyValue = "friendly message as the value",
}

// The calls whose answer is an error's message for the reader.
export const FRIENDLY_MESSAGE_CALLS: ReadonlyArray<string> = [
  "getFriendlyMessage",
  "getFriendlyErrorMessage",
];

export interface ErrorSentenceSite {
  use: ErrorSentenceUse;
  // The placeholders of the template the site is about.
  placeholders: Array<string>;
  // 1-based.
  line: number;
  // The template, or the expression the finding is about.
  text: string;
  /*
   * For a stored template: the name it is kept under (the constant's, or
   * the copy object's property).
   */
  storedAs?: string | undefined;
  // For a use of a stored template: the name the template is read by.
  readAs?: string | undefined;
}

export interface ErrorSentenceFinding extends ErrorSentenceSite {
  // Relative to the repository root, with forward slashes.
  file: string;
}

// The uses that are not findings.
export const ALLOWED_USES: ReadonlySet<ErrorSentenceUse> =
  new Set<ErrorSentenceUse>([
    ErrorSentenceUse.ErrorSentence,
    ErrorSentenceUse.ErrorValue,
    ErrorSentenceUse.Stored,
  ]);

// The error placeholders a template has.
export function errorPlaceholdersOf(template: string): Array<string> {
  return ERROR_PLACEHOLDERS.filter((placeholder: string): boolean => {
    return template.includes(`{{${placeholder}}}`);
  });
}

// `x`, `(x)`, `x!`, `x as T` and `<T>x` are all `x`.
function unwrap(expression: ts.Expression): ts.Expression {
  let current: ts.Expression = expression;

  while (
    ts.isParenthesizedExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }

  return current;
}

// The name a call is made by: translateTemplate for translator.translateTemplate(...).
function calleeName(call: ts.CallExpression): string | null {
  const callee: ts.Expression = unwrap(call.expression);

  if (ts.isIdentifier(callee)) {
    return callee.text;
  }

  if (ts.isPropertyAccessExpression(callee)) {
    return callee.name.text;
  }

  return null;
}

/*
 * A property's name as written: `couldNotLoad`, "couldNotLoad", or the
 * member a computed name reads - PartNotAdded for [NoteCode.PartNotAdded].
 */
function propertyNameText(name: ts.PropertyName): string | null {
  if (
    ts.isIdentifier(name) ||
    ts.isStringLiteralLike(name) ||
    ts.isNumericLiteral(name)
  ) {
    return name.text;
  }

  if (ts.isComputedPropertyName(name)) {
    return readName(name.expression);
  }

  return null;
}

// Whether an object literal is a PluralTemplate: { one: "...", other: "..." }.
function isPluralObject(node: ts.ObjectLiteralExpression): boolean {
  return (
    node.properties.length > 0 &&
    node.properties.every((property: ts.ObjectLiteralElementLike): boolean => {
      if (!ts.isPropertyAssignment(property)) {
        return false;
      }

      const name: string | null = propertyNameText(property.name);

      return name !== null && PLURAL_KEYS.has(name);
    })
  );
}

/*
 * The node that carries a template to where it is used: the literal itself,
 * or what wraps it on the way - translationKey("..."), a conditional's arm,
 * a PluralTemplate's form, parentheses, `as`.
 */
function carrierOf(node: ts.Node): ts.Node {
  let current: ts.Node = node;

  for (;;) {
    const parent: ts.Node | undefined = current.parent;

    if (!parent) {
      return current;
    }

    if (
      ts.isParenthesizedExpression(parent) ||
      ts.isAsExpression(parent) ||
      ts.isSatisfiesExpression(parent) ||
      ts.isNonNullExpression(parent) ||
      ts.isTypeAssertionExpression(parent)
    ) {
      current = parent;
      continue;
    }

    if (
      ts.isConditionalExpression(parent) &&
      (parent.whenTrue === current || parent.whenFalse === current)
    ) {
      current = parent;
      continue;
    }

    if (
      ts.isBinaryExpression(parent) &&
      (parent.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
        parent.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)
    ) {
      current = parent;
      continue;
    }

    if (
      ts.isCallExpression(parent) &&
      calleeName(parent) === "translationKey" &&
      parent.arguments[0] === current
    ) {
      current = parent;
      continue;
    }

    if (
      ts.isPropertyAssignment(parent) &&
      parent.initializer === current &&
      ts.isObjectLiteralExpression(parent.parent) &&
      isPluralObject(parent.parent)
    ) {
      current = parent.parent;
      continue;
    }

    return current;
  }
}

// The JSX element an attribute belongs to, and its tag's name.
function tagNameOf(attribute: ts.JsxAttribute): string {
  const element: ts.Node = attribute.parent.parent;

  if (ts.isJsxSelfClosingElement(element) || ts.isJsxOpeningElement(element)) {
    return element.tagName.getText();
  }

  return "";
}

// An element's attribute, by name.
function attributeOf(
  element: ts.JsxSelfClosingElement | ts.JsxOpeningElement,
  name: string,
): ts.JsxAttribute | null {
  for (const property of element.attributes.properties) {
    if (ts.isJsxAttribute(property) && property.name.getText() === name) {
      return property;
    }
  }

  return null;
}

// A written string attribute's value: errorPlaceholder="message".
function stringAttributeValue(
  attribute: ts.JsxAttribute | null,
): string | null {
  if (!attribute || !attribute.initializer) {
    return null;
  }

  if (ts.isStringLiteral(attribute.initializer)) {
    return attribute.initializer.text;
  }

  if (
    ts.isJsxExpression(attribute.initializer) &&
    attribute.initializer.expression &&
    ts.isStringLiteralLike(unwrap(attribute.initializer.expression))
  ) {
    return (unwrap(attribute.initializer.expression) as ts.StringLiteralLike)
      .text;
  }

  return null;
}

/*
 * How a template used as an element's `template` is drawn: an ErrorSentence
 * whose error goes in one of the template's error placeholders, or anything
 * else.
 */
function judgeElement(
  attribute: ts.JsxAttribute,
  placeholders: Array<string>,
): ErrorSentenceUse {
  if (tagNameOf(attribute) !== ERROR_SENTENCE_TAG) {
    return ErrorSentenceUse.OtherElement;
  }

  const element: ts.JsxSelfClosingElement | ts.JsxOpeningElement = attribute
    .parent.parent as ts.JsxSelfClosingElement | ts.JsxOpeningElement;

  const errorPlaceholder: string =
    stringAttributeValue(attributeOf(element, "errorPlaceholder")) || "error";

  return placeholders.includes(errorPlaceholder)
    ? ErrorSentenceUse.ErrorSentence
    : ErrorSentenceUse.WrongPlaceholder;
}

// Whether `expression` is errorInSentence(...).
function isErrorValue(expression: ts.Expression): boolean {
  const value: ts.Expression = unwrap(expression);

  return ts.isCallExpression(value) && calleeName(value) === ERROR_VALUE_CALL;
}

/*
 * How a translate call fills a template's error placeholders: each one
 * present in its values must be errorInSentence(...). A placeholder the
 * values leave out is not filled with an error (a template whose {{message}}
 * the call fills elsewhere is no such call).
 */
function judgeCall(
  call: ts.CallExpression,
  placeholders: Array<string>,
): ErrorSentenceUse {
  const name: string | null = calleeName(call);
  const valuesIndex: number | undefined =
    name !== null ? FILLING_CALLS[name] : undefined;

  if (valuesIndex === undefined) {
    return ErrorSentenceUse.Unknown;
  }

  const valuesArgument: ts.Expression | undefined = call.arguments[valuesIndex];

  if (!valuesArgument) {
    return ErrorSentenceUse.UnreadValues;
  }

  const values: ts.Expression = unwrap(valuesArgument);

  if (!ts.isObjectLiteralExpression(values)) {
    return ErrorSentenceUse.UnreadValues;
  }

  /*
   * A spread ({ ...getAgentAndNoun(), error: errorInSentence(x) }) may come
   * before the placeholder's own value, never after it: what it holds is
   * not read here, and it could put another value in its place.
   */
  let isFound: boolean = false;
  let isSpreadAfter: boolean = false;

  for (const property of values.properties) {
    if (ts.isSpreadAssignment(property)) {
      isSpreadAfter = isFound;
      continue;
    }

    const key: string | null =
      property.name !== undefined ? propertyNameText(property.name) : null;

    if (key === null || !placeholders.includes(key)) {
      continue;
    }

    isFound = true;

    if (
      !ts.isPropertyAssignment(property) ||
      !isErrorValue(property.initializer)
    ) {
      return ErrorSentenceUse.PlainValue;
    }
  }

  return isFound && !isSpreadAfter
    ? ErrorSentenceUse.ErrorValue
    : ErrorSentenceUse.UnreadValues;
}

/*
 * Where a carrier ends up: a call's template argument, an element's
 * `template`, a stored constant or copy-object property, or elsewhere.
 */
function judgeCarrier(
  carrier: ts.Node,
  placeholders: Array<string>,
): { use: ErrorSentenceUse; storedAs?: string | undefined } {
  const parent: ts.Node | undefined = carrier.parent;

  if (!parent) {
    return { use: ErrorSentenceUse.Unknown };
  }

  if (ts.isJsxAttribute(parent) && parent.name.getText() === "template") {
    return { use: judgeElement(parent, placeholders) };
  }

  if (
    ts.isJsxExpression(parent) &&
    parent.parent &&
    ts.isJsxAttribute(parent.parent) &&
    parent.parent.name.getText() === "template"
  ) {
    return { use: judgeElement(parent.parent, placeholders) };
  }

  if (ts.isCallExpression(parent) && parent.arguments[0] === carrier) {
    return { use: judgeCall(parent, placeholders) };
  }

  if (
    ts.isVariableDeclaration(parent) &&
    parent.initializer === carrier &&
    ts.isIdentifier(parent.name)
  ) {
    return { use: ErrorSentenceUse.Stored, storedAs: parent.name.text };
  }

  if (ts.isPropertyAssignment(parent) && parent.initializer === carrier) {
    const name: string | null = propertyNameText(parent.name);

    if (name !== null) {
      return { use: ErrorSentenceUse.Stored, storedAs: name };
    }
  }

  return { use: ErrorSentenceUse.Unknown };
}

// The name a template is read by: COPY for COPY, couldNotLoad for words.couldNotLoad.
function readName(expression: ts.Expression): string | null {
  const target: ts.Expression = unwrap(expression);

  if (ts.isIdentifier(target)) {
    return target.text;
  }

  if (ts.isPropertyAccessExpression(target)) {
    return target.name.text;
  }

  if (
    ts.isElementAccessExpression(target) &&
    ts.isStringLiteralLike(target.argumentExpression)
  ) {
    return target.argumentExpression.text;
  }

  return null;
}

/*
 * The names a template argument may be read by: one, each arm of a
 * conditional, or each side of `a || b` (a lane's own words, else the
 * page's).
 */
function readNames(expression: ts.Expression): Array<string> {
  const target: ts.Expression = unwrap(expression);

  if (ts.isConditionalExpression(target)) {
    return [...readNames(target.whenTrue), ...readNames(target.whenFalse)];
  }

  if (
    ts.isBinaryExpression(target) &&
    (target.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
      target.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)
  ) {
    return [...readNames(target.left), ...readNames(target.right)];
  }

  const name: string | null = readName(target);

  return name === null ? [] : [name];
}

/*
 * A use of a template read by name: a translate call, or an element's
 * `template` attribute, whose template is a name rather than written out.
 * Judged later against the templates stored under that name.
 */
export interface StoredTemplateRead {
  readAs: string;
  line: number;
  text: string;
  // How it fills each error placeholder, by placeholder.
  judge: (placeholders: Array<string>) => ErrorSentenceUse;
}

export interface ErrorSentenceFileScan {
  sites: Array<ErrorSentenceSite>;
  reads: Array<StoredTemplateRead>;
  /*
   * Local names a stored template is read into first: couldNotLoad for
   * `const couldNotLoad = copy.logsCouldNotLoad || COULD_NOT_LOAD`, as
   * couldNotLoad -> [logsCouldNotLoad, COULD_NOT_LOAD].
   */
  aliases: Map<string, Array<string>>;
}

// Every error sentence in one module's source, and every template read by name.
export function scanErrorSentences(
  fileName: string,
  source: string,
): ErrorSentenceFileScan {
  const sourceFile: ts.SourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") || fileName.endsWith(".jsx")
      ? ts.ScriptKind.TSX
      : ts.ScriptKind.TS,
  );

  const sites: Array<ErrorSentenceSite> = [];
  const reads: Array<StoredTemplateRead> = [];
  const aliases: Map<string, Array<string>> = new Map<string, Array<string>>();

  const lineOf: (node: ts.Node) => number = (node: ts.Node): number => {
    return (
      sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line +
      1
    );
  };

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (ts.isStringLiteralLike(node)) {
      const placeholders: Array<string> = errorPlaceholdersOf(node.text);

      if (placeholders.length > 0) {
        const parent: ts.Node | undefined = node.parent;

        if (
          parent &&
          ts.isCallExpression(parent) &&
          parent.arguments[0] === node &&
          ts.isPropertyAccessExpression(unwrap(parent.expression)) &&
          ["replace", "replaceAll", "split"].includes(calleeName(parent) || "")
        ) {
          sites.push({
            use: ErrorSentenceUse.FilledByHand,
            placeholders: placeholders,
            line: lineOf(parent),
            text: parent.getText(sourceFile),
          });
        } else {
          const judged: {
            use: ErrorSentenceUse;
            storedAs?: string | undefined;
          } = judgeCarrier(carrierOf(node), placeholders);

          sites.push({
            use: judged.use,
            placeholders: placeholders,
            line: lineOf(node),
            text: node.text,
            storedAs: judged.storedAs,
          });
        }
      }
    }

    // A local name a template may be read into.
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      !ts.isStringLiteralLike(unwrap(node.initializer))
    ) {
      const own: string = node.name.text;
      const names: Array<string> = readNames(node.initializer).filter(
        (name: string): boolean => {
          return name !== own;
        },
      );

      if (names.length > 0) {
        aliases.set(own, [...(aliases.get(own) || []), ...names]);
      }
    }

    /*
     * A friendly message given straight to any placeholder: in a translate
     * call's values, or in an element's values={{ ... }}.
     */
    const valuesObject: ts.Expression | undefined = (():
      | ts.Expression
      | undefined => {
      if (ts.isCallExpression(node)) {
        const name: string | null = calleeName(node);
        const index: number | undefined =
          name !== null ? FILLING_CALLS[name] : undefined;

        return index !== undefined ? node.arguments[index] : undefined;
      }

      if (
        ts.isJsxAttribute(node) &&
        node.name.getText() === "values" &&
        node.initializer &&
        ts.isJsxExpression(node.initializer)
      ) {
        return node.initializer.expression;
      }

      return undefined;
    })();

    if (valuesObject && ts.isObjectLiteralExpression(unwrap(valuesObject))) {
      for (const property of (
        unwrap(valuesObject) as ts.ObjectLiteralExpression
      ).properties) {
        if (!ts.isPropertyAssignment(property)) {
          continue;
        }

        const value: ts.Expression = unwrap(property.initializer);

        if (
          ts.isCallExpression(value) &&
          FRIENDLY_MESSAGE_CALLS.includes(calleeName(value) || "")
        ) {
          sites.push({
            use: ErrorSentenceUse.FriendlyValue,
            placeholders: [propertyNameText(property.name) || ""],
            line: lineOf(property),
            text: property.getText(sourceFile),
          });
        }
      }
    }

    // A translate call whose template is read by name.
    if (ts.isCallExpression(node)) {
      const name: string | null = calleeName(node);

      if (
        name !== null &&
        FILLING_CALLS[name] !== undefined &&
        node.arguments[0] &&
        !ts.isStringLiteralLike(unwrap(node.arguments[0])) &&
        !(
          ts.isCallExpression(unwrap(node.arguments[0])) &&
          calleeName(unwrap(node.arguments[0]) as ts.CallExpression) ===
            "translationKey"
        )
      ) {
        for (const readAs of readNames(node.arguments[0])) {
          const call: ts.CallExpression = node;

          reads.push({
            readAs: readAs,
            line: lineOf(node),
            text: node.getText(sourceFile),
            judge: (placeholders: Array<string>): ErrorSentenceUse => {
              return judgeCall(call, placeholders);
            },
          });
        }
      }
    }

    // An element whose template is read by name.
    if (
      ts.isJsxAttribute(node) &&
      node.name.getText() === "template" &&
      node.initializer &&
      ts.isJsxExpression(node.initializer) &&
      node.initializer.expression &&
      !ts.isStringLiteralLike(unwrap(node.initializer.expression))
    ) {
      for (const readAs of readNames(node.initializer.expression)) {
        const attribute: ts.JsxAttribute = node;

        reads.push({
          readAs: readAs,
          line: lineOf(node),
          text: node.getText(sourceFile),
          judge: (placeholders: Array<string>): ErrorSentenceUse => {
            return judgeElement(attribute, placeholders);
          },
        });
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return { sites: sites, reads: reads, aliases: aliases };
}

/*
 * The names a read reaches through a file's aliases: the name itself, what
 * it was read from, and what that was read from.
 */
function namesReachedBy(
  readAs: string,
  aliases: Map<string, Array<string>>,
): Set<string> {
  const reached: Set<string> = new Set<string>([readAs]);
  const queue: Array<string> = [readAs];

  while (queue.length > 0) {
    const name: string = queue.shift()!;

    for (const next of aliases.get(name) || []) {
      if (!reached.has(next)) {
        reached.add(next);
        queue.push(next);
      }
    }
  }

  return reached;
}

// Every module the guard reads (ForeignHiddenRuleGuard's roots).
export function listErrorSentenceScanFiles(
  repositoryRoot: string,
): Array<string> {
  return listScanRoots(repositoryRoot).flatMap(
    (root: string): Array<string> => {
      return listSourceFiles(root);
    },
  );
}

// A module's source, by its path relative to the repository root.
export interface ErrorSentenceSource {
  file: string;
  source: string;
}

/*
 * The error sentences of a set of modules: each template written out where
 * it is filled, and each stored one judged by the reads of its name in the
 * same module or in a module that imports the one it is stored in.
 */
export function findErrorSentencesInSources(
  sources: Array<ErrorSentenceSource>,
): Array<ErrorSentenceFinding> {
  const scans: Array<{
    file: string;
    source: string;
    scan: ErrorSentenceFileScan;
  }> = sources.map(
    (
      entry: ErrorSentenceSource,
    ): { file: string; source: string; scan: ErrorSentenceFileScan } => {
      return {
        file: entry.file,
        source: entry.source,
        scan: scanErrorSentences(entry.file, entry.source),
      };
    },
  );

  const findings: Array<ErrorSentenceFinding> = [];

  for (const entry of scans) {
    for (const site of entry.scan.sites) {
      findings.push({ ...site, file: entry.file });

      if (site.use !== ErrorSentenceUse.Stored || !site.storedAs) {
        continue;
      }

      // The module's name as another file imports it: ".../HuntsCopy".
      const moduleName: string = path
        .basename(entry.file)
        .replace(/\.tsx?$/, "");
      let readCount: number = 0;

      for (const reader of scans) {
        const isSameFile: boolean = reader.file === entry.file;

        if (
          !isSameFile &&
          !new RegExp(`from\\s+["'][^"']*/${moduleName}["']`).test(
            reader.source,
          )
        ) {
          continue;
        }

        for (const read of reader.scan.reads) {
          if (
            !namesReachedBy(read.readAs, reader.scan.aliases).has(site.storedAs)
          ) {
            continue;
          }

          readCount++;

          findings.push({
            use: read.judge(site.placeholders),
            placeholders: site.placeholders,
            line: read.line,
            text: read.text,
            file: reader.file,
            readAs: read.readAs,
          });
        }
      }

      if (readCount === 0) {
        findings.push({
          ...site,
          use: ErrorSentenceUse.Unfilled,
          file: entry.file,
        });
      }
    }
  }

  return findings;
}

// The whole tree's error sentences (findErrorSentencesInSources).
export function findErrorSentences(
  repositoryRoot: string,
  files: Array<string>,
): Array<ErrorSentenceFinding> {
  return findErrorSentencesInSources(
    files.map((file: string): ErrorSentenceSource => {
      return {
        file: toRelativePath(repositoryRoot, file),
        source: fs.readFileSync(file, "utf8"),
      };
    }),
  );
}

/*
 * Sentences that may put an error in otherwise, and why: by the file and
 * the template ("<file>: <template>"). Each must still be found, so one
 * that is gone or fixed leaves this list (ErrorSentenceGuard).
 */
export const ERROR_SENTENCE_EXCEPTIONS: Record<string, string> = {
  "packages/Common/UI/Components/Markdown.tsx/MarkdownViewer.tsx: Error rendering diagram: {{error}}":
    "the diagram library's own words for a diagram it could not draw (String(error) of mermaid's render): no request was made, so it is never an error nobody explained, and the sentence is written into a <pre> outside React",
  "packages/App/FeatureSet/Dashboard/src/Components/ToolImport/ToolImportText.ts: {{name}} could not be added: {{error}}":
    "a tool import note (PartNotAdded) kept by its note code and filled by describeToolImportNote with the note's own values, whose error toTemplateValue gives as errorInSentence(value) (App/Tests/Dashboard/ToolImportText.test.ts holds it)",
};

// A finding's key in ERROR_SENTENCE_EXCEPTIONS.
export function errorSentenceExceptionKey(
  finding: ErrorSentenceFinding,
): string {
  return `${finding.file}: ${finding.text}`;
}

// What is not allowed: every use but the two ways in, less the exceptions.
export function disallowedErrorSentences(
  findings: Array<ErrorSentenceFinding>,
): Array<ErrorSentenceFinding> {
  return findings.filter((finding: ErrorSentenceFinding): boolean => {
    return (
      !ALLOWED_USES.has(finding.use) &&
      !Object.prototype.hasOwnProperty.call(
        ERROR_SENTENCE_EXCEPTIONS,
        errorSentenceExceptionKey(finding),
      )
    );
  });
}

export function formatErrorSentenceFindings(
  findings: Array<ErrorSentenceFinding>,
): string {
  if (findings.length === 0) {
    return "";
  }

  return [
    `${findings.length} sentence(s) put an error in another way:`,
    ...findings.map((finding: ErrorSentenceFinding): string => {
      return `  ${finding.file}:${finding.line}  [${finding.use}]  ${finding.text.replace(/\s+/g, " ")}`;
    }),
    "",
    "A sentence with {{error}} or {{message}} in it says the error through",
    "Common/UI/Utils/ErrorInSentence: draw it with <ErrorSentence template=...",
    "error={message} /> (errorPlaceholder for {{message}}), or, where it has to",
    "be text, give the placeholder errorInSentence(message) as its value - and",
    "so for API.getFriendlyMessage(...) in any placeholder ({{reason}}). A",
    "gateway's 502 or 504 and a server failure with its reference are then said",
    "in the reader's language, the reference with its copy button. See #7307.",
  ].join("\n");
}

// packages/Common/Tests -> the repository root.
export const REPOSITORY_ROOT: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
);
