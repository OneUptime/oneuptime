import fs from "fs";
import path from "path";
import ts from "typescript";
import { listScanRoots, listSourceFiles } from "./ForeignHiddenRuleGuard";

/*
 * THE TEXT OF EVERY BADGE, READ FROM SOURCE (RecordNamesInPillsGuard, #7780).
 *
 * A badge - a Pill or a StatusBubble - looks its text up in the reader's
 * language unless it is told the text is drawn as written (isUserContent).
 * This reads every badge the front ends draw, by the name each file
 * imports the component under, and tells which of them draw a name: a
 * text that reads a record's name (`state.name`, `label["name"]`,
 * `getColumnValue("name")`), or anything called a name (`severityName`,
 * `readName(item)`, `translateStateName(...)`). Such a badge has to say
 * how its text reads. A text that is a variable is read through to what
 * the variable is set to in the same file, and a badge drawn from a spread
 * object (`<Pill {...pillProps} />`) through that object.
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

// The badges, by their module's path from the repository root.
export const BADGE_MODULES: Readonly<Record<string, string>> = {
  "packages/Common/UI/Components/Pill/Pill": "Pill",
  "packages/Common/UI/Components/StatusBubble/StatusBubble": "StatusBubble",
};

// The property a badge is told its text is drawn as written by.
export const AS_WRITTEN_PROPERTY: string = "isUserContent";

// A word that ends in Name, after a letter or a digit: `severityName`.
const NAME_SUFFIX_PATTERN: RegExp = /[a-z0-9]Name$/;

// A file that may draw a badge.
const BADGE_WORD_PATTERN: RegExp = /Pill|StatusBubble/;

export interface BadgeTextSite {
  // From the repository root, with forward slashes.
  file: string;
  line: number;
  // "Pill" or "StatusBubble".
  badge: string;
  // The text, as written ("(none)" for a badge given no text the reader sees).
  text: string;
  // The badge says how its text reads.
  isMarked: boolean;
  // Its text reads a name.
  readsName: boolean;
}

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

// A badge's attributes, with those of an object it is spread from.
function attributesOf(element: ts.JsxOpeningLikeElement): {
  text: ts.Expression | undefined;
  isMarked: boolean;
} {
  let text: ts.Expression | undefined;
  let isMarked: boolean = false;

  for (const attribute of element.attributes.properties) {
    if (ts.isJsxAttribute(attribute)) {
      const name: string = attribute.name.getText();

      if (name === AS_WRITTEN_PROPERTY) {
        isMarked = true;
      }

      if (name === "text" && attribute.initializer) {
        text = ts.isJsxExpression(attribute.initializer)
          ? attribute.initializer.expression
          : attribute.initializer;
      }

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

      if (name === AS_WRITTEN_PROPERTY) {
        isMarked = true;
      }

      if (name === "text" && ts.isPropertyAssignment(property)) {
        text = property.initializer;
      }

      if (name === "text" && ts.isShorthandPropertyAssignment(property)) {
        text = property.name;
      }
    }
  }

  return { text, isMarked };
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
      const { text, isMarked } = attributesOf(node);

      sites.push({
        file: file,
        line:
          source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
        badge: badges.get(node.tagName.text)!,
        text: text ? text.getText(source).replace(/\s+/g, " ") : "(none)",
        isMarked: isMarked,
        readsName: text ? readsAName(text) : false,
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
