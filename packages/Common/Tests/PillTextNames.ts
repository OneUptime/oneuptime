import fs from "fs";
import path from "path";
import ts from "typescript";
import { listScanRoots, listSourceFiles } from "./ForeignHiddenRuleGuard";

/*
 * THE TEXT OF EVERY BADGE, READ FROM SOURCE (RecordNamesInPillsGuard, #7780).
 *
 * A badge - a Pill or a StatusBubble - and a menu's item (MoreMenuItem)
 * look their text up in the reader's language unless told the text is
 * drawn as written (isUserContent).
 * This reads every badge the front ends draw, by the name each file
 * imports the component under, and tells which of them draw a name: a
 * text that reads a record's name (`state.name`, `label["name"]`,
 * `getColumnValue("name")`), or anything called a name (`severityName`,
 * `readName(item)`, `translateStateName(...)`). Such a badge has to say
 * how its text reads. A text that is a variable is read through to what
 * the variable is set to in the same file, and a badge drawn from a spread
 * object (`<Pill {...pillProps} />`) through that object.
 *
 * It reads, too, whether a badge's text and its hover tip come from the
 * translator (#8067) - t(), translator.translateText(), a template, a
 * plural, a helper handed the translator - and whether the badge says,
 * plainly, it draws them as written (isUserContent, isTooltipUserContent):
 * a badge given words in the reader's language already must, or it looks
 * them up a second time; and whether a part of the text is an English word
 * left as it is, which a badge drawn as written would draw untranslated.
 *
 * It is a reader of the code, not a run of it: it may hold to the rule a
 * badge whose name never reaches the screen, never pass one that draws a
 * name it can see.
 */

export const REPOSITORY_ROOT: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
);

/*
 * The badges, by their module's path from the repository root - and a
 * menu's item, which looks its text up the same way and is told the same
 * way that it draws a name (#8064): a Change state menu's "Open", a
 * priority picker's "Critical".
 */
export const BADGE_MODULES: Readonly<Record<string, string>> = {
  "packages/Common/UI/Components/Pill/Pill": "Pill",
  "packages/Common/UI/Components/StatusBubble/StatusBubble": "StatusBubble",
  "packages/Common/UI/Components/MoreMenu/MoreMenuItem": "MoreMenuItem",
};

// The property a badge is told its text is drawn as written by.
export const AS_WRITTEN_PROPERTY: string = "isUserContent";

// A word that ends in Name, after a letter or a digit: `severityName`.
const NAME_SUFFIX_PATTERN: RegExp = /[a-z0-9]Name$/;

// A file that may draw a badge.
const BADGE_WORD_PATTERN: RegExp = /Pill|StatusBubble|MoreMenuItem/;

export interface BadgeTextSite {
  // From the repository root, with forward slashes.
  file: string;
  line: number;
  // "Pill", "StatusBubble" or "MoreMenuItem".
  badge: string;
  // The text, as written ("(none)" for a badge given no text the reader sees).
  text: string;
  // The badge says how its text reads.
  isMarked: boolean;
  // Its text reads a name.
  readsName: boolean;
  /*
   * Its text comes from the translator (#8067): a lookup - t(),
   * translator.translateText(), a template, a plural, a helper handed the
   * translator - in a part the text can come from.
   */
  isTranslated: boolean;
  // The badge says, plainly, its text is drawn as written (isUserContent).
  isMarkedAsWritten: boolean;
  // A part of its text is English drawn as it is: a word written there.
  readsEnglish: boolean;
  // Its hover tip, as written ("(none)" for none).
  tooltip: string;
  // The hover tip comes from the translator.
  isTooltipTranslated: boolean;
  // The badge says, plainly, its hover tip is drawn as written.
  isTooltipMarkedAsWritten: boolean;
}

// The property a badge is told its hover tip is drawn as written by.
export const TOOLTIP_AS_WRITTEN_PROPERTY: string = "isTooltipUserContent";

// The calls that look a text up in the reader's language.
const LOOKUPS: ReadonlyArray<string> = [
  "t",
  "tx",
  "translateString",
  "translateText",
  "translateTerm",
  "translateValue",
  "translateTemplate",
  "translatePlural",
  "translateLine",
];

/*
 * What a helper that looks a text up is handed: translateStateName(
 * translator, state) is a lookup too.
 */
const TRANSLATOR_ARGUMENTS: ReadonlyArray<string> = ["translator", ...LOOKUPS];

// A word that names a name: `name`, `severityName`, `readName`.
function isNameWord(word: string): boolean {
  return word === "name" || NAME_SUFFIX_PATTERN.test(word);
}

// A module specifier, from the repository root without its extension.
function resolveModule(file: string, specifier: string): string | null {
  if (specifier.startsWith("Common/")) {
    return `packages/${specifier}`;
  }

  if (!specifier.startsWith(".")) {
    return null;
  }

  return path
    .relative(
      REPOSITORY_ROOT,
      path.resolve(path.dirname(path.join(REPOSITORY_ROOT, file)), specifier),
    )
    .split(path.sep)
    .join("/")
    .replace(/\.(tsx?|jsx?)$/, "");
}

// The names a file imports each badge under.
function badgeImports(
  file: string,
  source: ts.SourceFile,
): Map<string, string> {
  const badges: Map<string, string> = new Map<string, string>();

  for (const statement of source.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !statement.importClause?.name ||
      !ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      continue;
    }

    const module: string | null = resolveModule(
      file,
      statement.moduleSpecifier.text,
    );
    const badge: string | undefined = module
      ? BADGE_MODULES[module]
      : undefined;

    if (badge) {
      badges.set(statement.importClause.name.text, badge);
    }
  }

  return badges;
}

/*
 * The value a variable read at `from` is set to, in the nearest block
 * around it that declares it: the reader follows a badge's text there.
 */
function initializerOf(name: string, from: ts.Node): ts.Expression | undefined {
  for (
    let scope: ts.Node | undefined = from.parent;
    scope;
    scope = scope.parent
  ) {
    if (!ts.isBlock(scope) && !ts.isSourceFile(scope)) {
      continue;
    }

    for (const statement of scope.statements) {
      if (!ts.isVariableStatement(statement)) {
        continue;
      }

      for (const declaration of statement.declarationList.declarations) {
        if (
          ts.isIdentifier(declaration.name) &&
          declaration.name.text === name &&
          declaration.initializer
        ) {
          return declaration.initializer;
        }
      }
    }
  }

  return undefined;
}

// Whether an identifier is read as a value where it stands.
function isReadAsValue(identifier: ts.Identifier): boolean {
  const parent: ts.Node = identifier.parent;

  if (ts.isPropertyAccessExpression(parent) && parent.name === identifier) {
    return false;
  }

  if (
    (ts.isPropertyAssignment(parent) ||
      ts.isParameter(parent) ||
      ts.isVariableDeclaration(parent) ||
      ts.isBindingElement(parent) ||
      ts.isFunctionDeclaration(parent) ||
      ts.isMethodDeclaration(parent)) &&
    parent.name === identifier
  ) {
    return false;
  }

  return true;
}

// Whether an expression reads a name, following variables `depth` deep.
export function readsAName(expression: ts.Node, depth: number = 3): boolean {
  let found: boolean = false;

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (found) {
      return;
    }

    // `summary.connected ? "Connected" : "Unreachable"` draws only its words.
    if (ts.isConditionalExpression(node)) {
      visit(node.whenTrue);
      visit(node.whenFalse);
      return;
    }

    if (ts.isPropertyAccessExpression(node) && isNameWord(node.name.text)) {
      found = true;
      return;
    }

    if (
      ts.isElementAccessExpression(node) &&
      ts.isStringLiteralLike(node.argumentExpression) &&
      isNameWord(node.argumentExpression.text)
    ) {
      found = true;
      return;
    }

    if (ts.isCallExpression(node)) {
      const callee: ts.Expression = node.expression;
      const calleeName: string = ts.isIdentifier(callee)
        ? callee.text
        : ts.isPropertyAccessExpression(callee)
          ? callee.name.text
          : "";
      const firstArgument: ts.Expression | undefined = node.arguments[0];

      if (
        calleeName === "getColumnValue" &&
        firstArgument &&
        ts.isStringLiteralLike(firstArgument) &&
        isNameWord(firstArgument.text)
      ) {
        found = true;
        return;
      }
    }

    if (ts.isIdentifier(node) && isReadAsValue(node)) {
      if (isNameWord(node.text)) {
        found = true;
        return;
      }

      const initializer: ts.Expression | undefined =
        depth > 0 ? initializerOf(node.text, node) : undefined;

      if (initializer && readsAName(initializer, depth - 1)) {
        found = true;
        return;
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(expression);

  return found;
}

function calleeNameOf(call: ts.CallExpression): string {
  const callee: ts.Expression = call.expression;

  if (ts.isIdentifier(callee)) {
    return callee.text;
  }

  return ts.isPropertyAccessExpression(callee) ? callee.name.text : "";
}

// A call that looks a text up: a lookup, or a helper handed the translator.
function isLookupCall(node: ts.Node): boolean {
  if (!ts.isCallExpression(node)) {
    return false;
  }

  if (LOOKUPS.includes(calleeNameOf(node))) {
    return true;
  }

  return node.arguments.some((argument: ts.Expression): boolean => {
    return (
      ts.isIdentifier(argument) && TRANSLATOR_ARGUMENTS.includes(argument.text)
    );
  });
}

/*
 * Whether an expression's text comes from the translator (#8067), in a part
 * it can come from - either branch of a ?:, not what it asks - following
 * variables `depth` deep. A function written there is not its text.
 */
export function readsATranslation(
  expression: ts.Node,
  depth: number = 3,
): boolean {
  let found: boolean = false;

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (found) {
      return;
    }

    if (ts.isConditionalExpression(node)) {
      visit(node.whenTrue);
      visit(node.whenFalse);
      return;
    }

    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
      return;
    }

    if (isLookupCall(node)) {
      found = true;
      return;
    }

    if (ts.isIdentifier(node) && isReadAsValue(node)) {
      const initializer: ts.Expression | undefined =
        depth > 0 ? initializerOf(node.text, node) : undefined;

      if (initializer && readsATranslation(initializer, depth - 1)) {
        found = true;
        return;
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(expression);

  return found;
}

const LETTER: RegExp = /\p{L}/u;

function skipParentheses(node: ts.Expression): ts.Expression {
  let current: ts.Expression = node;

  while (ts.isParenthesizedExpression(current)) {
    current = current.expression;
  }

  return current;
}

/*
 * Whether an expression can be English drawn as it is: a word written in
 * a part the text can come from, outside any lookup - "failed" beside
 * translateTemplate("failed (exit {{exitCode}})", ...). A badge drawn as
 * written would draw that word untranslated.
 */
export function readsEnglish(expression: ts.Node, depth: number = 3): boolean {
  let found: boolean = false;

  const hasLetters: (text: string) => boolean = (text: string): boolean => {
    return LETTER.test(text);
  };

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (found) {
      return;
    }

    if (ts.isConditionalExpression(node)) {
      visit(node.whenTrue);
      visit(node.whenFalse);
      return;
    }

    if (
      isLookupCall(node) ||
      ts.isArrowFunction(node) ||
      ts.isFunctionExpression(node)
    ) {
      return;
    }

    /*
     * translateText(word) || word: the word after || is the lookup's own
     * fallback, drawn only when the lookup returns nothing.
     */
    if (
      ts.isBinaryExpression(node) &&
      (node.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
        node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) &&
      isLookupCall(skipParentheses(node.left))
    ) {
      return;
    }

    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      found = hasLetters(node.text);
      return;
    }

    if (ts.isTemplateExpression(node)) {
      if (
        hasLetters(node.head.text) ||
        node.templateSpans.some((span: ts.TemplateSpan): boolean => {
          return hasLetters(span.literal.text);
        })
      ) {
        found = true;
        return;
      }
    }

    // A key read, a call's own arguments: not the words drawn.
    if (ts.isElementAccessExpression(node) || ts.isCallExpression(node)) {
      return;
    }

    if (ts.isIdentifier(node) && isReadAsValue(node)) {
      const initializer: ts.Expression | undefined =
        depth > 0 ? initializerOf(node.text, node) : undefined;

      if (initializer && readsEnglish(initializer, depth - 1)) {
        found = true;
        return;
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(expression);

  return found;
}

// A mark said plainly true: a bare attribute, or true itself.
function isPlainlyTrue(value: ts.Node | undefined): boolean {
  if (!value) {
    return true;
  }

  if (ts.isJsxExpression(value)) {
    return Boolean(value.expression) && isPlainlyTrue(value.expression);
  }

  return value.kind === ts.SyntaxKind.TrueKeyword;
}

interface BadgeAttributes {
  text: ts.Expression | undefined;
  isMarked: boolean;
  isMarkedAsWritten: boolean;
  tooltip: ts.Expression | undefined;
  isTooltipMarkedAsWritten: boolean;
}

// A badge's attributes, with those of an object it is spread from.
function attributesOf(element: ts.JsxOpeningLikeElement): BadgeAttributes {
  const found: BadgeAttributes = {
    text: undefined,
    isMarked: false,
    isMarkedAsWritten: false,
    tooltip: undefined,
    isTooltipMarkedAsWritten: false,
  };

  // A property of the badge or of the object it is spread from.
  const take: (name: string, value: ts.Node | undefined) => void = (
    name: string,
    value: ts.Node | undefined,
  ): void => {
    if (name === AS_WRITTEN_PROPERTY) {
      found.isMarked = true;
      found.isMarkedAsWritten = isPlainlyTrue(value);
    }

    if (name === TOOLTIP_AS_WRITTEN_PROPERTY) {
      found.isTooltipMarkedAsWritten = isPlainlyTrue(value);
    }

    const expression: ts.Expression | undefined =
      value && ts.isJsxExpression(value)
        ? value.expression
        : (value as ts.Expression | undefined);

    if (name === "text" && expression) {
      found.text = expression;
    }

    if (name === "tooltip" && expression) {
      found.tooltip = expression;
    }
  };

  for (const attribute of element.attributes.properties) {
    if (ts.isJsxAttribute(attribute)) {
      take(attribute.name.getText(), attribute.initializer);
      continue;
    }

    // `{...pillProps}`: the object the badge is drawn from.
    const spread: ts.Expression = attribute.expression;
    const object: ts.Expression | undefined = ts.isIdentifier(spread)
      ? initializerOf(spread.text, element)
      : spread;

    if (!object || !ts.isObjectLiteralExpression(object)) {
      continue;
    }

    for (const property of object.properties) {
      const name: string | undefined = property.name?.getText();

      if (!name) {
        continue;
      }

      if (ts.isPropertyAssignment(property)) {
        take(name, property.initializer);
      } else if (ts.isShorthandPropertyAssignment(property)) {
        take(name, property.name);
      }
    }
  }

  return found;
}

// Every badge a source file draws, with what its text reads.
export function readBadgeTextSites(
  file: string,
  sourceText: string,
): Array<BadgeTextSite> {
  const source: ts.SourceFile = ts.createSourceFile(
    file,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const badges: Map<string, string> = badgeImports(file, source);
  const sites: Array<BadgeTextSite> = [];

  if (badges.size === 0) {
    return sites;
  }

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) &&
      ts.isIdentifier(node.tagName) &&
      badges.has(node.tagName.text)
    ) {
      const found: BadgeAttributes = attributesOf(node);
      const text: ts.Expression | undefined = found.text;
      const tooltip: ts.Expression | undefined = found.tooltip;

      sites.push({
        file: file,
        line:
          source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
        badge: badges.get(node.tagName.text)!,
        text: text ? text.getText(source).replace(/\s+/g, " ") : "(none)",
        isMarked: found.isMarked,
        readsName: text ? readsAName(text) : false,
        isTranslated: text ? readsATranslation(text) : false,
        isMarkedAsWritten: found.isMarkedAsWritten,
        readsEnglish: text ? readsEnglish(text) : false,
        tooltip: tooltip
          ? tooltip.getText(source).replace(/\s+/g, " ")
          : "(none)",
        isTooltipTranslated: tooltip ? readsATranslation(tooltip) : false,
        isTooltipMarkedAsWritten: found.isTooltipMarkedAsWritten,
      });
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  return sites;
}

// Every .tsx module of the front ends: each app's src, Common/UI and ee's screens.
export function listBadgeScanFiles(): Array<string> {
  return listScanRoots(REPOSITORY_ROOT)
    .flatMap((root: string): Array<string> => {
      return listSourceFiles(root);
    })
    .filter((file: string): boolean => {
      return file.endsWith(".tsx");
    })
    .map((file: string): string => {
      return path.relative(REPOSITORY_ROOT, file).split(path.sep).join("/");
    })
    .sort();
}

// Every badge the front ends draw.
export function readAllBadgeTextSites(): Array<BadgeTextSite> {
  return listBadgeScanFiles().flatMap((file: string): Array<BadgeTextSite> => {
    const sourceText: string = fs.readFileSync(
      path.join(REPOSITORY_ROOT, file),
      "utf8",
    );

    if (!BADGE_WORD_PATTERN.test(sourceText)) {
      return [];
    }

    return readBadgeTextSites(file, sourceText);
  });
}
