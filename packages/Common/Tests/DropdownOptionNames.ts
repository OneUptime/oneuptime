import fs from "fs";
import path from "path";
import ts from "typescript";
import { listScanRoots, listSourceFiles } from "./ForeignHiddenRuleGuard";
import { readsAName, REPOSITORY_ROOT } from "./PillTextNames";

/*
 * THE LABEL OF EVERY DROPDOWN OPTION BUILT BY HAND, READ FROM SOURCE
 * (RecordNamesInOptionsGuard, #8065).
 *
 * A Dropdown looks an option's label up in the reader's language unless the
 * option says it is drawn as written (DropdownOption.isUserContent). An
 * option built by hand from a record - `{ label: team.name, value: ... }` -
 * said nothing, so a label named "Network" read "Red" on a Spanish page, a
 * state a project named "Open" the verb "Abrir".
 *
 * This reads every object literal of the front ends that is a
 * DropdownOption: one whose place in the code says so by its type - a
 * variable, a function's return, an `as`, the array or the `.push()` or the
 * `.map()` it is built in - or by where it goes: a form field's
 * `dropdownOptions`, a filter's `filterDropdownOptions`, a Dropdown's or an
 * EntityDropdown's `options`. Each one whose label reads a name (as a
 * badge's text does: `team.name`, `label["name"]`, `getColumnValue("name")`,
 * `severityName`, `readName(item)`) has to say how it reads: an
 * `isUserContent` of its own, whatever it is set to - true for a name
 * whoever made the record gave it, `isRecordNameAsWritten(table, name)`
 * for a state's, a severity's or a status's, false for the product's words
 * - or a spread object that may carry one.
 *
 * It is a reader of the code, not a run of it: an option whose type it
 * cannot see is left alone, and the lint rule that types every variable
 * and every function's return (typedef) is what lets it see nearly all.
 */

export { REPOSITORY_ROOT };

// The property an option is told its label is drawn as written by.
export const AS_WRITTEN_PROPERTY: string = "isUserContent";

/*
 * A type that holds dropdown options: DropdownOption, Array<DropdownOption>,
 * and a group of them (DropdownOptionGroup), whose options are options too.
 * Not a filter chip's (FilterChipDropdownOption), which draws its labels
 * itself.
 */
const OPTION_TYPE_PATTERN: RegExp = /\bDropdownOption(Group)?\b/;

// The properties options are handed to a form or a filter by.
const OPTIONS_PROPERTIES: ReadonlyArray<string> = [
  "dropdownOptions",
  "filterDropdownOptions",
];

// The components that take their options as an `options` attribute.
const OPTION_COMPONENT_MODULES: ReadonlyArray<string> = [
  "packages/Common/UI/Components/Dropdown/Dropdown",
  "packages/Common/UI/Components/EntityDropdown/EntityDropdown",
];

// The methods that put their arguments into the list they are called on.
const ADDING_METHODS: ReadonlyArray<string> = ["push", "unshift", "concat"];

// A file that may build an option.
const OPTION_WORD_PATTERN: RegExp = /DropdownOption|dropdownOptions|Dropdown/;

export interface DropdownOptionSite {
  // From the repository root, with forward slashes.
  file: string;
  line: number;
  // The label, as written, on one line.
  label: string;
  // The option says how its label reads.
  isMarked: boolean;
  // Its label reads a name.
  readsName: boolean;
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

// The names a file imports the option components under.
function optionComponentImports(
  file: string,
  source: ts.SourceFile,
): Set<string> {
  const names: Set<string> = new Set<string>();

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

    if (module && OPTION_COMPONENT_MODULES.includes(module)) {
      names.add(statement.importClause.name.text);
    }
  }

  return names;
}

// The type a variable named at `from` is declared with, in a block around it.
function declaredTypeOf(name: string, from: ts.Node): ts.TypeNode | undefined {
  for (
    let scope: ts.Node | undefined = from.parent;
    scope;
    scope = scope.parent
  ) {
    if (ts.isFunctionLike(scope)) {
      for (const parameter of scope.parameters) {
        if (ts.isIdentifier(parameter.name) && parameter.name.text === name) {
          return parameter.type;
        }
      }
    }

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
          declaration.name.text === name
        ) {
          return declaration.type;
        }
      }
    }
  }

  return undefined;
}

// The name a property is written under: `label`, `"label"`.
function propertyNameOf(
  property: ts.ObjectLiteralElementLike,
): string | undefined {
  const name: ts.PropertyName | undefined = property.name;

  if (!name) {
    return undefined;
  }

  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) {
    return name.text;
  }

  return undefined;
}

interface Reader {
  source: ts.SourceFile;
  components: Set<string>;
}

/*
 * Whether `node`, an expression, is handed somewhere that takes dropdown
 * options - read from where it stands, outwards, through the expressions
 * that pass a value along: brackets, `as`, a condition's branches, `||`,
 * the array it is an element of, a spread, an arrow's body, a `return`,
 * the `.map()` or the `.push()` it is built in.
 */
function isOptionPlace(node: ts.Node, reader: Reader, depth: number): boolean {
  if (depth > 40) {
    return false;
  }

  const parent: ts.Node | undefined = node.parent;

  if (!parent) {
    return false;
  }

  if (
    ts.isParenthesizedExpression(parent) ||
    ts.isNonNullExpression(parent) ||
    ts.isArrayLiteralExpression(parent) ||
    ts.isSpreadElement(parent) ||
    (ts.isConditionalExpression(parent) && parent.condition !== node) ||
    (ts.isBinaryExpression(parent) &&
      parent.right === node &&
      [
        ts.SyntaxKind.BarBarToken,
        ts.SyntaxKind.QuestionQuestionToken,
        ts.SyntaxKind.AmpersandAmpersandToken,
      ].includes(parent.operatorToken.kind))
  ) {
    return isOptionPlace(parent, reader, depth + 1);
  }

  if (
    ts.isBinaryExpression(parent) &&
    parent.left === node &&
    [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(
      parent.operatorToken.kind,
    )
  ) {
    return isOptionPlace(parent, reader, depth + 1);
  }

  if (ts.isAsExpression(parent) || ts.isSatisfiesExpression(parent)) {
    return OPTION_TYPE_PATTERN.test(parent.type.getText(reader.source))
      ? true
      : isOptionPlace(parent, reader, depth + 1);
  }

  if (ts.isVariableDeclaration(parent) && parent.initializer === node) {
    return Boolean(
      parent.type &&
        OPTION_TYPE_PATTERN.test(parent.type.getText(reader.source)),
    );
  }

  if (
    (ts.isPropertyDeclaration(parent) || ts.isParameter(parent)) &&
    parent.initializer === node
  ) {
    return Boolean(
      parent.type &&
        OPTION_TYPE_PATTERN.test(parent.type.getText(reader.source)),
    );
  }

  // `field.dropdownOptions = [...]`
  if (
    ts.isBinaryExpression(parent) &&
    parent.right === node &&
    parent.operatorToken.kind === ts.SyntaxKind.EqualsToken
  ) {
    const left: ts.Expression = parent.left;
    const name: string = ts.isPropertyAccessExpression(left)
      ? left.name.text
      : ts.isIdentifier(left)
        ? left.text
        : "";

    if (OPTIONS_PROPERTIES.includes(name)) {
      return true;
    }

    if (ts.isIdentifier(left)) {
      const type: ts.TypeNode | undefined = declaredTypeOf(left.text, parent);

      return Boolean(
        type && OPTION_TYPE_PATTERN.test(type.getText(reader.source)),
      );
    }

    return false;
  }

  /*
   * `{ dropdownOptions: [...] }`, and a group's `{ label, options: [...] }`
   * where the group is in an option's place itself.
   */
  if (ts.isPropertyAssignment(parent) && parent.initializer === node) {
    const name: string | undefined = propertyNameOf(parent);

    if (name && OPTIONS_PROPERTIES.includes(name)) {
      return true;
    }

    return (
      name === "options" &&
      ts.isObjectLiteralExpression(parent.parent) &&
      isOptionPlace(parent.parent, reader, depth + 1)
    );
  }

  // `<Dropdown options={[...]} />`
  if (ts.isJsxExpression(parent)) {
    const attribute: ts.Node = parent.parent;

    if (
      ts.isJsxAttribute(attribute) &&
      attribute.name.getText(reader.source) === "options"
    ) {
      const element: ts.Node = attribute.parent.parent;

      return (
        (ts.isJsxSelfClosingElement(element) ||
          ts.isJsxOpeningElement(element)) &&
        ts.isIdentifier(element.tagName) &&
        reader.components.has(element.tagName.text)
      );
    }

    return false;
  }

  // An arrow's body, or a function's `return`: its return type, or its call's place.
  if (
    (ts.isArrowFunction(parent) && parent.body === node) ||
    ts.isReturnStatement(parent)
  ) {
    let fn: ts.Node | undefined = parent;

    while (fn && !ts.isFunctionLike(fn)) {
      fn = fn.parent;
    }

    if (!fn || !ts.isFunctionLike(fn)) {
      return false;
    }

    if (fn.type) {
      return OPTION_TYPE_PATTERN.test(fn.type.getText(reader.source));
    }

    // A callback with no return type: what its call's result is handed to.
    if (
      (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) &&
      fn.parent &&
      ts.isCallExpression(fn.parent)
    ) {
      return isOptionPlace(fn.parent, reader, depth + 1);
    }

    // A function declared with no return type, but assigned to a typed name.
    if (
      (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) &&
      fn.parent &&
      ts.isVariableDeclaration(fn.parent) &&
      fn.parent.type
    ) {
      return OPTION_TYPE_PATTERN.test(fn.parent.type.getText(reader.source));
    }

    return false;
  }

  // `.map(...)` and the like pass their list along; `.push(x)` adds to theirs.
  if (ts.isCallExpression(parent)) {
    const callee: ts.Expression = parent.expression;

    if (parent.arguments.includes(node as ts.Expression)) {
      if (
        ts.isPropertyAccessExpression(callee) &&
        ADDING_METHODS.includes(callee.name.text)
      ) {
        const receiver: ts.Expression = callee.expression;

        if (ts.isIdentifier(receiver)) {
          const type: ts.TypeNode | undefined = declaredTypeOf(
            receiver.text,
            parent,
          );

          if (type && OPTION_TYPE_PATTERN.test(type.getText(reader.source))) {
            return true;
          }
        }

        if (
          ts.isPropertyAccessExpression(receiver) &&
          OPTIONS_PROPERTIES.includes(receiver.name.text)
        ) {
          return true;
        }

        return isOptionPlace(parent, reader, depth + 1);
      }

      return false;
    }

    // The list a method was called on is passed along by `.filter()` and the like.
    return isOptionPlace(parent, reader, depth + 1);
  }

  if (ts.isPropertyAccessExpression(parent) && parent.expression === node) {
    const call: ts.Node | undefined = parent.parent;

    if (call && ts.isCallExpression(call) && call.expression === parent) {
      return isOptionPlace(call, reader, depth + 1);
    }
  }

  return false;
}

// What an option's label is set to, and whether it says how it reads.
function readOption(object: ts.ObjectLiteralExpression): {
  label: ts.Expression | undefined;
  hasValue: boolean;
  isMarked: boolean;
} {
  let label: ts.Expression | undefined;
  let hasValue: boolean = false;
  let isMarked: boolean = false;

  for (const property of object.properties) {
    if (ts.isSpreadAssignment(property)) {
      // A spread object may carry the mark: left to whoever built it.
      isMarked = true;
      continue;
    }

    const name: string | undefined = propertyNameOf(property);

    if (name === AS_WRITTEN_PROPERTY) {
      isMarked = true;
    }

    if (name === "value") {
      hasValue = true;
    }

    if (name === "label") {
      if (ts.isPropertyAssignment(property)) {
        label = property.initializer;
      } else if (ts.isShorthandPropertyAssignment(property)) {
        label = property.name;
      }
    }
  }

  return { label, hasValue, isMarked };
}

// Every dropdown option a source file builds by hand, with what its label reads.
export function readDropdownOptionSites(
  file: string,
  sourceText: string,
): Array<DropdownOptionSite> {
  const source: ts.SourceFile = ts.createSourceFile(
    file,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const reader: Reader = {
    source: source,
    components: optionComponentImports(file, source),
  };
  const sites: Array<DropdownOptionSite> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (ts.isObjectLiteralExpression(node)) {
      const option: {
        label: ts.Expression | undefined;
        hasValue: boolean;
        isMarked: boolean;
      } = readOption(node);

      if (option.label && option.hasValue && isOptionPlace(node, reader, 0)) {
        sites.push({
          file: file,
          line:
            source.getLineAndCharacterOfPosition(node.getStart(source)).line +
            1,
          label: option.label.getText(source).replace(/\s+/g, " "),
          isMarked: option.isMarked,
          readsName: readsAName(option.label),
        });
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  return sites;
}

// Every module of the front ends: each app's src, Common/UI and ee's screens.
export function listOptionScanFiles(): Array<string> {
  return listScanRoots(REPOSITORY_ROOT)
    .flatMap((root: string): Array<string> => {
      return listSourceFiles(root);
    })
    .map((file: string): string => {
      return path.relative(REPOSITORY_ROOT, file).split(path.sep).join("/");
    })
    .sort();
}

// Every dropdown option the front ends build by hand.
export function readAllDropdownOptionSites(): Array<DropdownOptionSite> {
  return listOptionScanFiles().flatMap(
    (file: string): Array<DropdownOptionSite> => {
      const sourceText: string = fs.readFileSync(
        path.join(REPOSITORY_ROOT, file),
        "utf8",
      );

      if (!OPTION_WORD_PATTERN.test(sourceText)) {
        return [];
      }

      return readDropdownOptionSites(file, sourceText);
    },
  );
}
