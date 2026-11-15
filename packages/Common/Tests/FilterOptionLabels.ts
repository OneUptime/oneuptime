import fs from "fs";
import path from "path";
import ts from "typescript";
import Text from "../Types/Text";
import { listScanRoots, listSourceFiles } from "./ForeignHiddenRuleGuard";

/*
 * THE LABELS OF A FILTER'S OPTIONS, READ FROM SOURCE (FilterOptionLabelsGuard,
 * #7690).
 *
 * An option's label reads by one rule (DropdownOption.isUserContent): the
 * product's words, in English, looked up in the reader's language in the
 * filter's menu and its chip alike - or a name, marked isUserContent and
 * drawn as written in both. This reads every filter's options in the front
 * ends - each `filterDropdownOptions:` - and follows them to where their
 * labels are written: a list of options, a helper that maps a list or an
 * enum to options, a map of labels by value, the descriptors of a catalog,
 * in the file or the files it imports. Each option is then either marked,
 * or has labels the guard could read (each to be a key of its front end's
 * English locale), or has a label the guard could not read - a value from
 * data, a name, words put together at run time - which is a finding: a
 * name is marked, and a word is written where the guard can read it. A
 * mark decided per option at run time (a project's own name marked, the
 * name a new project starts with looked up) counts as marked: whoever
 * wrote it chose, option by option, how its label reads.
 *
 * It is a reader of the code, not a run of it: it takes every branch of a
 * condition it cannot decide and every element of a list, so it may read a
 * label a branch never draws, never one it would miss.
 */

export const REPOSITORY_ROOT: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
);

// The property a filter's options are given by, in every front end.
export const FILTER_OPTIONS_PROPERTY: string = "filterDropdownOptions";

// How deep the reader follows calls and names before it gives up.
const MOST_STEPS: number = 60;

// How many values one expression may stand for before the reader gives up.
const MOST_VALUES: number = 5000;

// The DropdownUtil helpers that build options from an enum.
const DROPDOWN_UTIL_FILE: string = "packages/Common/UI/Utils/Dropdown.ts";
const ENUM_OPTION_HELPERS: ReadonlyArray<string> = [
  "getDropdownOptionsFromEnum",
  "getDropdownOptionsFromEnumWithReadableLabels",
];

// Text's helpers that only reshape a word, run as they are.
const TEXT_FILE: string = "packages/Common/Types/Text.ts";
const TEXT_HELPERS: Readonly<Record<string, (text: string) => string>> = {
  uppercaseFirstLetter: (text: string): string => {
    return Text.uppercaseFirstLetter(text);
  },
  fromPascalCaseToReadable: (text: string): string => {
    return Text.fromPascalCaseToReadable(text);
  },
};

// What a string's own methods do to a word the reader knows.
const STRING_METHODS: Readonly<Record<string, (text: string) => string>> = {
  trim: (text: string): string => {
    return text.trim();
  },
  toLowerCase: (text: string): string => {
    return text.toLowerCase();
  },
  toUpperCase: (text: string): string => {
    return text.toUpperCase();
  },
  toString: (text: string): string => {
    return text;
  },
};

// A helper a record holds as its own, never one its prototype lends it.
function ownHelper(
  helpers: Readonly<Record<string, (text: string) => string>>,
  name: string,
): ((text: string) => string) | undefined {
  return Object.prototype.hasOwnProperty.call(helpers, name)
    ? helpers[name]
    : undefined;
}

// A list's methods that give back (some of) the same elements.
const SAME_ELEMENT_METHODS: ReadonlyArray<string> = [
  "filter",
  "sort",
  "toSorted",
  "slice",
  "reverse",
  "toReversed",
  "concat",
];

// A list's methods that give back one of its elements.
const ONE_ELEMENT_METHODS: ReadonlyArray<string> = ["find", "at", "findLast"];

interface SourceModule {
  // Relative to the repository root, with forward slashes.
  file: string;
  source: ts.SourceFile;
}

// The values the parameters of the calls being read stand for.
type Bindings = ReadonlyMap<ts.Node, ReadonlyArray<Value>>;

interface Scope {
  module: SourceModule;
  bindings: Bindings;
}

type FunctionNode = ts.FunctionLikeDeclaration;

export type Value =
  | { kind: "text"; text: string }
  | { kind: "boolean"; value: boolean }
  | { kind: "undefined" }
  | { kind: "object"; node: ts.ObjectLiteralExpression; scope: Scope }
  // An option DropdownUtil built from an enum's member.
  | { kind: "option"; label: string; value: string }
  | { kind: "list"; items: ReadonlyArray<Value> }
  | { kind: "enum"; node: ts.EnumDeclaration; module: SourceModule }
  | { kind: "class"; node: ts.ClassDeclaration; module: SourceModule }
  | { kind: "namespace"; module: SourceModule }
  | { kind: "function"; node: FunctionNode; scope: Scope }
  | { kind: "unknown"; why: string; at: string };

type UnknownValue = Extract<Value, { kind: "unknown" }>;

const UNDEFINED: Value = { kind: "undefined" };

// What a name stands for where it is read.
type Declaration =
  | {
      node:
        | ts.VariableDeclaration
        | ts.FunctionDeclaration
        | ts.ClassDeclaration
        | ts.EnumDeclaration
        | ts.ParameterDeclaration
        | ts.BindingElement;
      module: SourceModule;
    }
  | { importFrom: string; name: string; module: SourceModule }
  | { expression: ts.Expression; module: SourceModule };

// A label the guard could not read, on an option that is not marked.
export interface UnreadLabel {
  // The expression, as written, the reader stopped at.
  why: string;
  // Where: "file:line".
  at: string;
}

// One filter's options, as the reader read them.
export interface FilterOptionsSite {
  // Relative to the repository root, with forward slashes.
  file: string;
  // 1-based.
  line: number;
  // The options' expression, as written, on one line.
  written: string;
  // Options marked isUserContent, or marked by a choice made at run time.
  asWritten: number;
  // The labels of the other options: the product's words, looked up.
  words: Array<string>;
  // The labels of the other options the guard could not read.
  unread: Array<UnreadLabel>;
}

const moduleCache: Map<string, SourceModule | null> = new Map<
  string,
  SourceModule | null
>();

function toRepositoryPath(absolute: string): string {
  return path.relative(REPOSITORY_ROOT, absolute).split(path.sep).join("/");
}

function loadModule(absolute: string): SourceModule | null {
  const cached: SourceModule | null | undefined = moduleCache.get(absolute);

  if (cached !== undefined) {
    return cached;
  }

  let loaded: SourceModule | null = null;

  if (fs.existsSync(absolute) && fs.statSync(absolute).isFile()) {
    loaded = parseModule(
      toRepositoryPath(absolute),
      fs.readFileSync(absolute, "utf8"),
    );
  }

  moduleCache.set(absolute, loaded);

  return loaded;
}

export function parseModule(file: string, text: string): SourceModule {
  return {
    file,
    source: ts.createSourceFile(
      file,
      text,
      ts.ScriptTarget.Latest,
      true,
      file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    ),
  };
}

// The file an import names: a relative path or Common's, never a package.
function resolveImport(from: SourceModule, specifier: string): string | null {
  let base: string;

  if (specifier.startsWith(".")) {
    base = path.resolve(REPOSITORY_ROOT, path.dirname(from.file), specifier);
  } else if (specifier.startsWith("Common/")) {
    base = path.join(
      REPOSITORY_ROOT,
      "packages",
      "Common",
      specifier.slice("Common/".length),
    );
  } else {
    return null;
  }

  for (const candidate of [
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
    base,
  ]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }

  return null;
}

function lineOf(node: ts.Node, module: SourceModule): number {
  return (
    module.source.getLineAndCharacterOfPosition(node.getStart(module.source))
      .line + 1
  );
}

function writtenOf(node: ts.Node, module: SourceModule): string {
  const text: string = node.getText(module.source).replace(/\s+/g, " ").trim();

  return text.length > 140 ? `${text.slice(0, 137)}...` : text;
}

function unknownValue(
  why: string,
  node: ts.Node,
  module: SourceModule,
): UnknownValue {
  return {
    kind: "unknown",
    why: `${why}: ${writtenOf(node, module)}`,
    at: `${module.file}:${lineOf(node, module)}`,
  };
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  if (!ts.canHaveModifiers(node)) {
    return false;
  }

  return (ts.getModifiers(node) || []).some(
    (modifier: ts.ModifierLike): boolean => {
      return modifier.kind === kind;
    },
  );
}

// `x`, `(x)`, `x!`, `x as T`, `<T>x` and `x satisfies T` are all `x`.
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

// The element of a binding name that declares `name`, if one does.
function declaringNode(
  bindingName: ts.BindingName,
  name: string,
): ts.Node | null {
  if (ts.isIdentifier(bindingName)) {
    return bindingName.text === name ? bindingName.parent : null;
  }

  for (const element of bindingName.elements) {
    if (ts.isOmittedExpression(element)) {
      continue;
    }

    const found: ts.Node | null = declaringNode(element.name, name);

    if (found) {
      return found;
    }
  }

  return null;
}

function declarationIn(
  statements: ts.NodeArray<ts.Statement>,
  name: string,
  module: SourceModule,
): Declaration | null {
  for (const statement of statements) {
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        const found: ts.Node | null = declaringNode(declaration.name, name);

        if (
          found &&
          (ts.isVariableDeclaration(found) || ts.isBindingElement(found))
        ) {
          return { node: found, module };
        }
      }
    } else if (
      (ts.isFunctionDeclaration(statement) ||
        ts.isClassDeclaration(statement) ||
        ts.isEnumDeclaration(statement)) &&
      statement.name?.text === name
    ) {
      return { node: statement, module };
    } else if (
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.importClause
    ) {
      const clause: ts.ImportClause = statement.importClause;
      const from: string = statement.moduleSpecifier.text;

      if (clause.name?.text === name) {
        return { importFrom: from, name: "default", module };
      }

      const bindings: ts.NamedImportBindings | undefined = clause.namedBindings;

      if (bindings && ts.isNamespaceImport(bindings)) {
        if (bindings.name.text === name) {
          return { importFrom: from, name: "*", module };
        }
      } else if (bindings) {
        for (const element of bindings.elements) {
          if (element.name.text === name) {
            return {
              importFrom: from,
              name: (element.propertyName || element.name).text,
              module,
            };
          }
        }
      }
    }
  }

  return null;
}

// What `name` stands for where `from` reads it: the nearest declaration out.
function findDeclaration(
  name: string,
  from: ts.Node,
  module: SourceModule,
): Declaration | null {
  for (
    let node: ts.Node | undefined = from;
    node;
    node = node.parent as ts.Node | undefined
  ) {
    if (ts.isFunctionLike(node)) {
      for (const parameter of node.parameters) {
        const found: ts.Node | null = declaringNode(parameter.name, name);

        if (found && (ts.isParameter(found) || ts.isBindingElement(found))) {
          return { node: found, module };
        }
      }
    }

    if (
      ts.isSourceFile(node) ||
      ts.isBlock(node) ||
      ts.isModuleBlock(node) ||
      ts.isCaseClause(node) ||
      ts.isDefaultClause(node)
    ) {
      const found: Declaration | null = declarationIn(
        node.statements,
        name,
        module,
      );

      if (found) {
        return found;
      }
    }

    if (
      (ts.isForOfStatement(node) ||
        ts.isForInStatement(node) ||
        ts.isForStatement(node)) &&
      node.initializer &&
      ts.isVariableDeclarationList(node.initializer)
    ) {
      for (const declaration of node.initializer.declarations) {
        const found: ts.Node | null = declaringNode(declaration.name, name);

        if (
          found &&
          (ts.isVariableDeclaration(found) || ts.isBindingElement(found))
        ) {
          return { node: found, module };
        }
      }
    }
  }

  return null;
}

// What a module exports as `name` ("default" for its default export).
function findExport(
  module: SourceModule,
  name: string,
  steps: number,
): Declaration | null {
  if (steps > MOST_STEPS) {
    return null;
  }

  for (const statement of module.source.statements) {
    if (
      ts.isExportAssignment(statement) &&
      !statement.isExportEquals &&
      name === "default"
    ) {
      return { expression: statement.expression, module };
    }

    if (hasModifier(statement, ts.SyntaxKind.ExportKeyword)) {
      const isDefault: boolean = hasModifier(
        statement,
        ts.SyntaxKind.DefaultKeyword,
      );

      if (
        (ts.isFunctionDeclaration(statement) ||
          ts.isClassDeclaration(statement) ||
          ts.isEnumDeclaration(statement)) &&
        (name === "default" ? isDefault : statement.name?.text === name)
      ) {
        return { node: statement, module };
      }

      if (ts.isVariableStatement(statement) && name !== "default") {
        const found: Declaration | null = declarationIn(
          ts.factory.createNodeArray([statement]),
          name,
          module,
        );

        if (found) {
          return found;
        }
      }
    }

    if (ts.isExportDeclaration(statement)) {
      const target: SourceModule | null =
        statement.moduleSpecifier &&
        ts.isStringLiteral(statement.moduleSpecifier)
          ? (() => {
              const file: string | null = resolveImport(
                module,
                (statement.moduleSpecifier as ts.StringLiteral).text,
              );

              return file ? loadModule(file) : null;
            })()
          : null;

      if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
        for (const element of statement.exportClause.elements) {
          if (element.name.text !== name) {
            continue;
          }

          const local: string = (element.propertyName || element.name).text;

          if (target) {
            return findExport(target, local, steps + 1);
          }

          return declarationIn(module.source.statements, local, module);
        }
      } else if (!statement.exportClause && target && name !== "default") {
        const found: Declaration | null = findExport(target, name, steps + 1);

        if (found) {
          return found;
        }
      }
    }
  }

  return null;
}

/*
 * The reader. Each read is one expression in one scope, standing for every
 * value it may take.
 */
class Reader {
  private steps: number = 0;

  private readonly topLevelValues: Map<ts.Node, ReadonlyArray<Value>> = new Map<
    ts.Node,
    ReadonlyArray<Value>
  >();

  private readonly reading: Set<ts.Node> = new Set<ts.Node>();

  public read(expression: ts.Expression, scope: Scope): ReadonlyArray<Value> {
    if (this.steps > MOST_STEPS || this.reading.has(expression)) {
      return [unknownValue("too deep to follow", expression, scope.module)];
    }

    this.steps += 1;
    this.reading.add(expression);

    try {
      return this.cap(
        this.readOnce(unwrap(expression), scope),
        expression,
        scope,
      );
    } finally {
      this.reading.delete(expression);
      this.steps -= 1;
    }
  }

  private cap(
    values: ReadonlyArray<Value>,
    node: ts.Node,
    scope: Scope,
  ): ReadonlyArray<Value> {
    const seen: Set<string> = new Set<string>();
    const kept: Array<Value> = [];

    for (const value of values) {
      let key: string | null = null;

      if (value.kind === "text") {
        key = `text:${value.text}`;
      } else if (value.kind === "boolean") {
        key = `boolean:${String(value.value)}`;
      } else if (value.kind === "undefined") {
        key = "undefined";
      } else if (value.kind === "unknown") {
        key = `unknown:${value.why}:${value.at}`;
      } else if (value.kind === "option") {
        key = `option:${value.label}:${value.value}`;
      }

      if (key !== null) {
        if (seen.has(key)) {
          continue;
        }

        seen.add(key);
      }

      kept.push(value);
    }

    if (kept.length > MOST_VALUES) {
      return [unknownValue("too many values to follow", node, scope.module)];
    }

    return kept;
  }

  private readOnce(
    expression: ts.Expression,
    scope: Scope,
  ): ReadonlyArray<Value> {
    if (ts.isStringLiteralLike(expression)) {
      return [{ kind: "text", text: expression.text }];
    }

    if (ts.isNumericLiteral(expression)) {
      return [{ kind: "text", text: expression.text }];
    }

    if (expression.kind === ts.SyntaxKind.TrueKeyword) {
      return [{ kind: "boolean", value: true }];
    }

    if (expression.kind === ts.SyntaxKind.FalseKeyword) {
      return [{ kind: "boolean", value: false }];
    }

    if (expression.kind === ts.SyntaxKind.NullKeyword) {
      return [UNDEFINED];
    }

    // `this` in a static method (the only methods the guard calls) is its class.
    if (expression.kind === ts.SyntaxKind.ThisKeyword) {
      for (
        let node: ts.Node | undefined = expression.parent;
        node;
        node = node.parent as ts.Node | undefined
      ) {
        if (ts.isClassDeclaration(node)) {
          return [{ kind: "class", node, module: scope.module }];
        }
      }

      return [unknownValue("`this` outside a class", expression, scope.module)];
    }

    if (ts.isTemplateExpression(expression)) {
      return this.readTemplate(expression, scope);
    }

    if (ts.isIdentifier(expression)) {
      return this.readName(expression, scope);
    }

    if (ts.isPropertyAccessExpression(expression)) {
      const owners: ReadonlyArray<Value> = this.read(
        expression.expression,
        scope,
      );

      return this.flatMap(owners, (owner: Value): ReadonlyArray<Value> => {
        return (
          this.propertyOf(owner, expression.name.text, expression, scope) || [
            UNDEFINED,
          ]
        );
      });
    }

    if (ts.isElementAccessExpression(expression)) {
      return this.readElementAccess(expression, scope);
    }

    if (ts.isCallExpression(expression)) {
      return this.readCall(expression, scope);
    }

    if (ts.isNewExpression(expression)) {
      if (
        ts.isIdentifier(expression.expression) &&
        expression.expression.text === "Set" &&
        expression.arguments?.[0]
      ) {
        return this.read(expression.arguments[0], scope);
      }

      return [
        unknownValue("an object made at run time", expression, scope.module),
      ];
    }

    if (ts.isArrayLiteralExpression(expression)) {
      const items: Array<Value> = [];

      for (const element of expression.elements) {
        if (ts.isSpreadElement(element)) {
          items.push(...this.elementsOf(this.read(element.expression, scope)));
        } else if (!ts.isOmittedExpression(element)) {
          items.push(...this.read(element, scope));
        }
      }

      return [{ kind: "list", items: this.cap(items, expression, scope) }];
    }

    if (ts.isObjectLiteralExpression(expression)) {
      return [{ kind: "object", node: expression, scope }];
    }

    if (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)) {
      return [{ kind: "function", node: expression, scope }];
    }

    if (ts.isConditionalExpression(expression)) {
      const truth: boolean | null = this.truthOf(expression.condition, scope);

      if (truth === true) {
        return this.read(expression.whenTrue, scope);
      }

      if (truth === false) {
        return this.read(expression.whenFalse, scope);
      }

      return [
        ...this.read(expression.whenTrue, scope),
        ...this.read(expression.whenFalse, scope),
      ];
    }

    if (ts.isBinaryExpression(expression)) {
      return this.readBinary(expression, scope);
    }

    if (
      ts.isPrefixUnaryExpression(expression) &&
      expression.operator === ts.SyntaxKind.ExclamationToken
    ) {
      const truth: boolean | null = this.truthOf(expression.operand, scope);

      return truth === null
        ? [unknownValue("a condition", expression, scope.module)]
        : [{ kind: "boolean", value: !truth }];
    }

    return [
      unknownValue(
        "an expression the guard does not read",
        expression,
        scope.module,
      ),
    ];
  }

  private readTemplate(
    expression: ts.TemplateExpression,
    scope: Scope,
  ): ReadonlyArray<Value> {
    let texts: Array<string> = [expression.head.text];

    for (const span of expression.templateSpans) {
      const values: ReadonlyArray<Value> = this.read(span.expression, scope);
      const next: Array<string> = [];

      for (const value of values) {
        if (value.kind !== "text") {
          return [
            unknownValue(
              "words put together at run time",
              expression,
              scope.module,
            ),
          ];
        }

        for (const text of texts) {
          next.push(`${text}${value.text}${span.literal.text}`);
        }
      }

      texts = next;

      if (texts.length > MOST_VALUES) {
        return [
          unknownValue("too many values to follow", expression, scope.module),
        ];
      }
    }

    return texts.map((text: string): Value => {
      return { kind: "text", text };
    });
  }

  private readBinary(
    expression: ts.BinaryExpression,
    scope: Scope,
  ): ReadonlyArray<Value> {
    const operator: ts.SyntaxKind = expression.operatorToken.kind;

    if (
      operator === ts.SyntaxKind.BarBarToken ||
      operator === ts.SyntaxKind.QuestionQuestionToken
    ) {
      const left: ReadonlyArray<Value> = this.read(expression.left, scope);
      const kept: Array<Value> = [];
      let needsRight: boolean = false;

      for (const value of left) {
        const truth: boolean | null =
          operator === ts.SyntaxKind.BarBarToken
            ? truthinessOf(value)
            : value.kind === "undefined"
              ? false
              : value.kind === "unknown"
                ? null
                : true;

        if (truth !== false) {
          kept.push(value);
        }

        if (truth !== true) {
          needsRight = true;
        }
      }

      return needsRight
        ? [...kept, ...this.read(expression.right, scope)]
        : kept;
    }

    if (operator === ts.SyntaxKind.AmpersandAmpersandToken) {
      const truth: boolean | null = this.truthOf(expression.left, scope);

      if (truth === false) {
        return this.read(expression.left, scope);
      }

      if (truth === true) {
        return this.read(expression.right, scope);
      }

      return [
        ...this.read(expression.left, scope),
        ...this.read(expression.right, scope),
      ];
    }

    if (operator === ts.SyntaxKind.PlusToken) {
      const left: ReadonlyArray<Value> = this.read(expression.left, scope);
      const right: ReadonlyArray<Value> = this.read(expression.right, scope);
      const texts: Array<Value> = [];

      for (const first of left) {
        for (const second of right) {
          if (first.kind !== "text" || second.kind !== "text") {
            return [
              unknownValue(
                "words put together at run time",
                expression,
                scope.module,
              ),
            ];
          }

          texts.push({ kind: "text", text: `${first.text}${second.text}` });
        }
      }

      return texts;
    }

    const truth: boolean | null = this.truthOf(expression, scope);

    return truth === null
      ? [unknownValue("a condition", expression, scope.module)]
      : [{ kind: "boolean", value: truth }];
  }

  // Whether a condition holds: true, false, or null when it cannot be told.
  public truthOf(expression: ts.Expression, scope: Scope): boolean | null {
    const condition: ts.Expression = unwrap(expression);

    if (
      ts.isPrefixUnaryExpression(condition) &&
      condition.operator === ts.SyntaxKind.ExclamationToken
    ) {
      const truth: boolean | null = this.truthOf(condition.operand, scope);

      return truth === null ? null : !truth;
    }

    if (ts.isBinaryExpression(condition)) {
      const operator: ts.SyntaxKind = condition.operatorToken.kind;

      if (
        operator === ts.SyntaxKind.EqualsEqualsEqualsToken ||
        operator === ts.SyntaxKind.EqualsEqualsToken ||
        operator === ts.SyntaxKind.ExclamationEqualsEqualsToken ||
        operator === ts.SyntaxKind.ExclamationEqualsToken
      ) {
        const left: ReadonlyArray<Value> = this.read(condition.left, scope);
        const right: ReadonlyArray<Value> = this.read(condition.right, scope);
        const equal: boolean | null =
          left.length === 1 && right.length === 1
            ? sameValue(left[0] as Value, right[0] as Value)
            : null;

        if (equal === null) {
          return null;
        }

        return operator === ts.SyntaxKind.EqualsEqualsEqualsToken ||
          operator === ts.SyntaxKind.EqualsEqualsToken
          ? equal
          : !equal;
      }

      if (operator === ts.SyntaxKind.AmpersandAmpersandToken) {
        const left: boolean | null = this.truthOf(condition.left, scope);

        if (left === false) {
          return false;
        }

        const right: boolean | null = this.truthOf(condition.right, scope);

        if (right === false) {
          return false;
        }

        return left === true && right === true ? true : null;
      }

      if (operator === ts.SyntaxKind.BarBarToken) {
        const left: boolean | null = this.truthOf(condition.left, scope);

        if (left === true) {
          return true;
        }

        const right: boolean | null = this.truthOf(condition.right, scope);

        if (right === true) {
          return true;
        }

        return left === false && right === false ? false : null;
      }
    }

    const values: ReadonlyArray<Value> = this.read(condition, scope);
    const truths: Array<boolean | null> = values.map(truthinessOf);

    if (
      truths.length > 0 &&
      truths.every((truth: boolean | null) => {
        return truth === true;
      })
    ) {
      return true;
    }

    if (
      truths.length > 0 &&
      truths.every((truth: boolean | null) => {
        return truth === false;
      })
    ) {
      return false;
    }

    return null;
  }

  private readName(
    identifier: ts.Identifier,
    scope: Scope,
  ): ReadonlyArray<Value> {
    const declaration: Declaration | null = findDeclaration(
      identifier.text,
      identifier,
      scope.module,
    );

    if (!declaration) {
      if (identifier.text === "undefined") {
        return [UNDEFINED];
      }

      return [
        unknownValue("a name the guard cannot find", identifier, scope.module),
      ];
    }

    return this.readDeclaration(declaration, scope, identifier);
  }

  private readDeclaration(
    declaration: Declaration,
    scope: Scope,
    readAt: ts.Node,
  ): ReadonlyArray<Value> {
    if ("expression" in declaration) {
      return this.read(declaration.expression, {
        module: declaration.module,
        bindings: new Map<ts.Node, ReadonlyArray<Value>>(),
      });
    }

    if ("importFrom" in declaration) {
      const file: string | null = resolveImport(
        declaration.module,
        declaration.importFrom,
      );
      const target: SourceModule | null = file ? loadModule(file) : null;

      if (!target) {
        return [
          unknownValue(
            `a package's export (${declaration.importFrom})`,
            readAt,
            scope.module,
          ),
        ];
      }

      if (declaration.name === "*") {
        return [{ kind: "namespace", module: target }];
      }

      const exported: Declaration | null = findExport(
        target,
        declaration.name,
        0,
      );

      if (!exported) {
        return [
          unknownValue(
            `an export the guard cannot find in ${target.file}`,
            readAt,
            scope.module,
          ),
        ];
      }

      return this.readDeclaration(
        exported,
        {
          module: target,
          bindings: new Map<ts.Node, ReadonlyArray<Value>>(),
        },
        readAt,
      );
    }

    const node: ts.Node = declaration.node;
    const module: SourceModule = declaration.module;

    if (ts.isEnumDeclaration(node)) {
      return [{ kind: "enum", node, module }];
    }

    if (ts.isClassDeclaration(node)) {
      return [{ kind: "class", node, module }];
    }

    if (ts.isFunctionDeclaration(node)) {
      return [
        {
          kind: "function",
          node,
          scope: { module, bindings: scope.bindings },
        },
      ];
    }

    if (ts.isParameter(node) || ts.isBindingElement(node)) {
      const bound: ReadonlyArray<Value> | undefined = scope.bindings.get(node);

      if (bound) {
        return bound;
      }

      return [
        unknownValue(
          ts.isParameter(node) ? "a value handed in" : "a value taken apart",
          node,
          module,
        ),
      ];
    }

    if (ts.isVariableDeclaration(node)) {
      const list: ts.Node = node.parent;
      const isConst: boolean =
        ts.isVariableDeclarationList(list) &&
        (list.flags & ts.NodeFlags.Const) !== 0;

      if (!isConst || !node.initializer) {
        return [unknownValue("a variable that may change", node, module)];
      }

      const isTopLevel: boolean =
        ts.isVariableStatement(list.parent) &&
        ts.isSourceFile(list.parent.parent);

      if (isTopLevel) {
        const cached: ReadonlyArray<Value> | undefined =
          this.topLevelValues.get(node);

        if (cached) {
          return cached;
        }

        const values: ReadonlyArray<Value> = this.read(node.initializer, {
          module,
          bindings: new Map<ts.Node, ReadonlyArray<Value>>(),
        });

        this.topLevelValues.set(node, values);

        return values;
      }

      return this.read(node.initializer, { module, bindings: scope.bindings });
    }

    return [
      unknownValue("a declaration the guard does not read", node, module),
    ];
  }

  // The values of `owner.name`; null when it has no such property.
  public propertyOf(
    owner: Value,
    name: string,
    at: ts.Node,
    scope: Scope,
  ): ReadonlyArray<Value> | null {
    switch (owner.kind) {
      case "object":
        return this.objectProperty(owner.node, owner.scope, name);
      case "option":
        if (name === "label") {
          return [{ kind: "text", text: owner.label }];
        }

        if (name === "value") {
          return [{ kind: "text", text: owner.value }];
        }

        return null;
      case "enum":
        return this.enumMember(owner.node, owner.module, name);
      case "class":
        return this.staticMember(owner.node, owner.module, name, at, scope);
      case "namespace": {
        const exported: Declaration | null = findExport(owner.module, name, 0);

        return exported
          ? this.readDeclaration(
              exported,
              {
                module: owner.module,
                bindings: new Map<ts.Node, ReadonlyArray<Value>>(),
              },
              at,
            )
          : null;
      }
      case "text":
        if (name === "length") {
          return [unknownValue("a word's length", at, scope.module)];
        }

        return null;
      case "list":
        if (name === "length") {
          return [unknownValue("a list's length", at, scope.module)];
        }

        return null;
      case "unknown":
        return [owner];
      default:
        return null;
    }
  }

  private propertyName(
    name: ts.PropertyName,
    scope: Scope,
  ): ReadonlyArray<string> | null {
    if (
      ts.isIdentifier(name) ||
      ts.isStringLiteralLike(name) ||
      ts.isNumericLiteral(name) ||
      ts.isPrivateIdentifier(name)
    ) {
      return [name.text];
    }

    if (ts.isComputedPropertyName(name)) {
      const values: ReadonlyArray<Value> = this.read(name.expression, scope);
      const texts: Array<string> = [];

      for (const value of values) {
        if (value.kind !== "text") {
          return null;
        }

        texts.push(value.text);
      }

      return texts;
    }

    return null;
  }

  private objectProperty(
    node: ts.ObjectLiteralExpression,
    scope: Scope,
    name: string,
  ): ReadonlyArray<Value> | null {
    const found: Array<Value> = [];

    // The last property of a name wins, spreads included.
    for (let index: number = node.properties.length - 1; index >= 0; index--) {
      const property: ts.ObjectLiteralElementLike = node.properties[
        index
      ] as ts.ObjectLiteralElementLike;

      if (ts.isSpreadAssignment(property)) {
        const spread: ReadonlyArray<Value> = this.read(
          property.expression,
          scope,
        );
        let isEverywhere: boolean = spread.length > 0;

        for (const value of spread) {
          if (value.kind === "undefined") {
            isEverywhere = false;
            continue;
          }

          const inSpread: ReadonlyArray<Value> | null = this.propertyOf(
            value,
            name,
            property,
            scope,
          );

          if (inSpread) {
            found.push(...inSpread);
          } else {
            isEverywhere = false;
          }
        }

        if (isEverywhere) {
          return found;
        }

        continue;
      }

      if (!property.name) {
        continue;
      }

      const names: ReadonlyArray<string> | null = this.propertyName(
        property.name,
        scope,
      );

      if (names !== null && !names.includes(name)) {
        continue;
      }

      let values: ReadonlyArray<Value>;

      if (ts.isPropertyAssignment(property)) {
        values = this.read(property.initializer, scope);
      } else if (ts.isShorthandPropertyAssignment(property)) {
        values = this.readName(property.name, scope);
      } else if (ts.isMethodDeclaration(property)) {
        values = [{ kind: "function", node: property, scope }];
      } else if (ts.isGetAccessorDeclaration(property)) {
        values = this.callFunction(
          { kind: "function", node: property, scope },
          [],
          property,
        );
      } else {
        continue;
      }

      found.push(...values);

      // A key known to be this one ends the search; one the guard cannot read may not be.
      if (names !== null && names.length === 1) {
        return found;
      }
    }

    return found.length > 0 ? found : null;
  }

  // Every value an object's properties hold, for a key the guard cannot read.
  private everyPropertyOf(
    owner: Value,
    at: ts.Node,
    scope: Scope,
  ): ReadonlyArray<Value> {
    if (owner.kind === "object") {
      const values: Array<Value> = [];

      for (const property of owner.node.properties) {
        if (ts.isPropertyAssignment(property)) {
          values.push(...this.read(property.initializer, owner.scope));
        } else if (ts.isShorthandPropertyAssignment(property)) {
          values.push(...this.readName(property.name, owner.scope));
        } else if (ts.isSpreadAssignment(property)) {
          for (const spread of this.read(property.expression, owner.scope)) {
            values.push(...this.everyPropertyOf(spread, at, scope));
          }
        }
      }

      return values;
    }

    if (owner.kind === "enum") {
      return this.enumValues(owner.node, owner.module);
    }

    if (owner.kind === "list") {
      return owner.items;
    }

    if (owner.kind === "unknown") {
      return [owner];
    }

    return [unknownValue("a value looked up by a key", at, scope.module)];
  }

  private readElementAccess(
    expression: ts.ElementAccessExpression,
    scope: Scope,
  ): ReadonlyArray<Value> {
    const owners: ReadonlyArray<Value> = this.read(
      expression.expression,
      scope,
    );
    const keys: ReadonlyArray<Value> = this.read(
      expression.argumentExpression,
      scope,
    );

    return this.flatMap(owners, (owner: Value): ReadonlyArray<Value> => {
      if (owner.kind === "list") {
        return owner.items;
      }

      if (
        keys.some((key: Value): boolean => {
          return key.kind !== "text";
        })
      ) {
        return this.everyPropertyOf(owner, expression, scope);
      }

      return this.flatMap(keys, (key: Value): ReadonlyArray<Value> => {
        return (
          this.propertyOf(
            owner,
            (key as Extract<Value, { kind: "text" }>).text,
            expression,
            scope,
          ) || [UNDEFINED]
        );
      });
    });
  }

  private enumMember(
    node: ts.EnumDeclaration,
    module: SourceModule,
    name: string,
  ): ReadonlyArray<Value> | null {
    for (const member of node.members) {
      if (
        (ts.isIdentifier(member.name) || ts.isStringLiteral(member.name)) &&
        member.name.text === name
      ) {
        return [this.enumMemberValue(member, module)];
      }
    }

    return null;
  }

  private enumMemberValue(member: ts.EnumMember, module: SourceModule): Value {
    if (member.initializer && ts.isStringLiteralLike(member.initializer)) {
      return { kind: "text", text: member.initializer.text };
    }

    if (member.initializer && ts.isNumericLiteral(member.initializer)) {
      return { kind: "text", text: member.initializer.text };
    }

    return unknownValue("an enum member with no written value", member, module);
  }

  private enumValues(
    node: ts.EnumDeclaration,
    module: SourceModule,
  ): ReadonlyArray<Value> {
    return node.members.map((member: ts.EnumMember): Value => {
      return this.enumMemberValue(member, module);
    });
  }

  private staticMember(
    node: ts.ClassDeclaration,
    module: SourceModule,
    name: string,
    at: ts.Node,
    scope: Scope,
  ): ReadonlyArray<Value> | null {
    for (const member of node.members) {
      if (
        !member.name ||
        !ts.isIdentifier(member.name) ||
        member.name.text !== name ||
        !hasModifier(member, ts.SyntaxKind.StaticKeyword)
      ) {
        continue;
      }

      const memberScope: Scope = {
        module,
        bindings: new Map<ts.Node, ReadonlyArray<Value>>(),
      };

      if (ts.isPropertyDeclaration(member)) {
        return member.initializer
          ? this.read(member.initializer, memberScope)
          : [unknownValue("a field set at run time", member, module)];
      }

      if (ts.isMethodDeclaration(member)) {
        return [{ kind: "function", node: member, scope: memberScope }];
      }

      if (ts.isGetAccessorDeclaration(member)) {
        return this.callFunction(
          { kind: "function", node: member, scope: memberScope },
          [],
          at,
        );
      }
    }

    return [unknownValue("a member the guard cannot find", at, scope.module)];
  }

  // The elements a value stands for when it is spread or iterated.
  private elementsOf(values: ReadonlyArray<Value>): ReadonlyArray<Value> {
    return this.flatMap(values, (value: Value): ReadonlyArray<Value> => {
      if (value.kind === "list") {
        return value.items;
      }

      if (value.kind === "undefined") {
        return [];
      }

      if (value.kind === "unknown") {
        return [value];
      }

      return [
        {
          kind: "unknown",
          why: "a value spread that is not a list",
          at: "",
        },
      ];
    });
  }

  private readCall(
    expression: ts.CallExpression,
    scope: Scope,
  ): ReadonlyArray<Value> {
    const callee: ts.Expression = unwrap(expression.expression);
    const args: ReadonlyArray<ts.Expression> = expression.arguments;

    if (ts.isIdentifier(callee)) {
      const name: string = callee.text;
      const isLocal: boolean =
        findDeclaration(name, callee, scope.module) !== null;

      // translationKey("Unhealthy") marks a word for the extractor: it is the word.
      if (name === "translationKey" && args[0]) {
        return this.read(args[0], scope);
      }

      // React's useMemo(() => value, deps) is the value.
      if (name === "useMemo" && args[0]) {
        return this.callValues(
          this.read(args[0], scope),
          [],
          expression,
          scope,
        );
      }

      if (!isLocal && name === "String" && args[0]) {
        return this.read(args[0], scope);
      }

      if (!isLocal && name === "Boolean" && args[0]) {
        const truth: boolean | null = this.truthOf(args[0], scope);

        return truth === null
          ? [unknownValue("a condition", expression, scope.module)]
          : [{ kind: "boolean", value: truth }];
      }
    }

    if (ts.isPropertyAccessExpression(callee)) {
      const method: string = callee.name.text;
      const owner: ts.Expression = unwrap(callee.expression);

      // Object.values / keys / entries, and Array.from.
      if (
        ts.isIdentifier(owner) &&
        (owner.text === "Object" || owner.text === "Array") &&
        findDeclaration(owner.text, owner, scope.module) === null &&
        args[0]
      ) {
        return this.readGlobalCall(
          owner.text,
          method,
          args[0],
          expression,
          scope,
        );
      }

      const owners: ReadonlyArray<Value> = this.read(callee.expression, scope);

      return this.flatMap(owners, (ownerValue: Value): ReadonlyArray<Value> => {
        return this.readMethodCall(ownerValue, method, expression, scope);
      });
    }

    return this.callValues(
      this.read(callee, scope),
      args.map((argument: ts.Expression): ReadonlyArray<Value> => {
        return this.read(argument, scope);
      }),
      expression,
      scope,
    );
  }

  private readGlobalCall(
    owner: string,
    method: string,
    argument: ts.Expression,
    expression: ts.CallExpression,
    scope: Scope,
  ): ReadonlyArray<Value> {
    const values: ReadonlyArray<Value> = this.read(argument, scope);

    if (owner === "Array" && method === "from") {
      return [{ kind: "list", items: this.elementsOf(values) }];
    }

    if (owner === "Object" && (method === "values" || method === "keys")) {
      const items: Array<Value> = [];

      for (const value of values) {
        if (value.kind === "enum") {
          for (const member of value.node.members) {
            items.push(
              method === "values"
                ? this.enumMemberValue(member, value.module)
                : {
                    kind: "text",
                    text: (member.name as ts.Identifier).text,
                  },
            );
          }
        } else if (value.kind === "object") {
          for (const property of value.node.properties) {
            if (ts.isSpreadAssignment(property)) {
              items.push(
                unknownValue("a spread object's keys", property, scope.module),
              );
              continue;
            }

            if (method === "values") {
              if (ts.isPropertyAssignment(property)) {
                items.push(...this.read(property.initializer, value.scope));
              } else if (ts.isShorthandPropertyAssignment(property)) {
                items.push(...this.readName(property.name, value.scope));
              }
            } else if (property.name) {
              const names: ReadonlyArray<string> | null = this.propertyName(
                property.name,
                value.scope,
              );

              if (names === null) {
                items.push(
                  unknownValue(
                    "a key the guard cannot read",
                    property,
                    scope.module,
                  ),
                );
              } else {
                for (const name of names) {
                  items.push({ kind: "text", text: name });
                }
              }
            }
          }
        } else {
          items.push(
            value.kind === "unknown"
              ? value
              : unknownValue("the keys of a value", expression, scope.module),
          );
        }
      }

      return [{ kind: "list", items: this.cap(items, expression, scope) }];
    }

    return [
      unknownValue("a call the guard does not read", expression, scope.module),
    ];
  }

  private readMethodCall(
    owner: Value,
    method: string,
    expression: ts.CallExpression,
    scope: Scope,
  ): ReadonlyArray<Value> {
    const args: ReadonlyArray<ts.Expression> = expression.arguments;

    if (owner.kind === "class" && owner.module.file === DROPDOWN_UTIL_FILE) {
      if (ENUM_OPTION_HELPERS.includes(method) && args[0]) {
        return this.enumOptions(owner, method, expression, scope);
      }
    }

    if (owner.kind === "class" && owner.module.file === TEXT_FILE) {
      const helper: ((text: string) => string) | undefined = ownHelper(
        TEXT_HELPERS,
        method,
      );

      if (helper && args[0]) {
        return this.mapTexts(
          this.read(args[0], scope),
          helper,
          expression,
          scope,
        );
      }
    }

    const reshape: ((text: string) => string) | undefined = ownHelper(
      STRING_METHODS,
      method,
    );

    if (owner.kind === "text") {
      return reshape
        ? this.mapTexts([owner], reshape, expression, scope)
        : [unknownValue("a word's method", expression, scope.module)];
    }

    if (owner.kind === "unknown" && reshape) {
      return [owner];
    }

    if (owner.kind === "list" || owner.kind === "unknown") {
      if (method === "map" || method === "flatMap") {
        const callbacks: ReadonlyArray<Value> = args[0]
          ? this.read(args[0], scope)
          : [];
        const items: ReadonlyArray<Value> =
          owner.kind === "list" ? owner.items : [owner];
        const results: Array<Value> = [];

        for (const item of items) {
          const returned: ReadonlyArray<Value> = this.callValues(
            callbacks,
            [[item], [unknownValue("an index", expression, scope.module)]],
            expression,
            scope,
          );

          results.push(
            ...(method === "flatMap" ? this.elementsOf(returned) : returned),
          );

          if (results.length > MOST_VALUES) {
            return [
              unknownValue(
                "too many values to follow",
                expression,
                scope.module,
              ),
            ];
          }
        }

        return [{ kind: "list", items: this.cap(results, expression, scope) }];
      }

      if (SAME_ELEMENT_METHODS.includes(method)) {
        let items: Array<Value> = [
          ...(owner.kind === "list" ? owner.items : [owner]),
        ];

        // filter(keep): an element keep is sure to turn away is gone.
        if (method === "filter" && args[0]) {
          const keeps: ReadonlyArray<Value> = this.read(args[0], scope);

          items = items.filter((item: Value): boolean => {
            const kept: ReadonlyArray<Value> = this.callValues(
              keeps,
              [[item]],
              expression,
              scope,
            );

            return !(
              kept.length > 0 &&
              kept.every((value: Value): boolean => {
                return truthinessOf(value) === false;
              })
            );
          });
        }

        if (method === "concat") {
          for (const argument of args) {
            const added: ReadonlyArray<Value> = this.read(argument, scope);

            items.push(
              ...this.flatMap(added, (value: Value): ReadonlyArray<Value> => {
                return value.kind === "list" ? value.items : [value];
              }),
            );
          }
        }

        return [{ kind: "list", items: this.cap(items, expression, scope) }];
      }

      if (ONE_ELEMENT_METHODS.includes(method)) {
        return [...(owner.kind === "list" ? owner.items : [owner]), UNDEFINED];
      }

      if (owner.kind === "unknown") {
        return [owner];
      }

      return [unknownValue("a list's method", expression, scope.module)];
    }

    // A function held by an object, a class or a module.
    const functions: ReadonlyArray<Value> =
      this.propertyOf(owner, method, expression, scope) || [];

    return this.callValues(
      functions,
      args.map((argument: ts.Expression): ReadonlyArray<Value> => {
        return this.read(argument, scope);
      }),
      expression,
      scope,
    );
  }

  private mapTexts(
    values: ReadonlyArray<Value>,
    reshape: (text: string) => string,
    expression: ts.Expression,
    scope: Scope,
  ): ReadonlyArray<Value> {
    return values.map((value: Value): Value => {
      if (value.kind === "text") {
        return { kind: "text", text: reshape(value.text) };
      }

      if (value.kind === "unknown") {
        return value;
      }

      return unknownValue(
        "a word reshaped at run time",
        expression,
        scope.module,
      );
    });
  }

  // DropdownUtil.getDropdownOptionsFromEnum(Enum, useKeyAsLabel?): an option a member.
  private enumOptions(
    owner: Extract<Value, { kind: "class" }>,
    method: string,
    expression: ts.CallExpression,
    scope: Scope,
  ): ReadonlyArray<Value> {
    const enums: ReadonlyArray<Value> = this.read(
      expression.arguments[0] as ts.Expression,
      scope,
    );
    const useKeyAsLabel: boolean =
      expression.arguments[1] !== undefined &&
      this.truthOf(expression.arguments[1], scope) === true;
    const readable: boolean =
      method === "getDropdownOptionsFromEnumWithReadableLabels";
    const items: Array<Value> = [];

    for (const value of enums) {
      if (value.kind !== "enum") {
        items.push(
          value.kind === "unknown"
            ? value
            : unknownValue(
                `options ${owner.node.name?.text || "DropdownUtil"} builds from a value that is not an enum`,
                expression,
                scope.module,
              ),
        );
        continue;
      }

      for (const member of value.node.members) {
        const memberValue: Value = this.enumMemberValue(member, value.module);

        if (memberValue.kind !== "text") {
          items.push(memberValue);
          continue;
        }

        const key: string = (member.name as ts.Identifier).text;
        const label: string = useKeyAsLabel ? key : memberValue.text;

        items.push({
          kind: "option",
          label: readable ? Text.fromPascalCaseToReadable(label) : label,
          value: memberValue.text,
        });
      }
    }

    return [{ kind: "list", items }];
  }

  private callValues(
    callees: ReadonlyArray<Value>,
    args: ReadonlyArray<ReadonlyArray<Value>>,
    at: ts.Node,
    scope: Scope,
  ): ReadonlyArray<Value> {
    if (callees.length === 0) {
      return [unknownValue("a call the guard cannot follow", at, scope.module)];
    }

    return this.flatMap(callees, (callee: Value): ReadonlyArray<Value> => {
      if (callee.kind === "function") {
        return this.callFunction(callee, args, at);
      }

      if (callee.kind === "unknown") {
        return [callee];
      }

      return [unknownValue("a call the guard cannot follow", at, scope.module)];
    });
  }

  private callFunction(
    callee: Extract<Value, { kind: "function" }>,
    args: ReadonlyArray<ReadonlyArray<Value>>,
    at: ts.Node,
  ): ReadonlyArray<Value> {
    const node: FunctionNode = callee.node;

    if (!node.body) {
      return [unknownValue("a function with no body", at, callee.scope.module)];
    }

    if (this.reading.has(node) || this.steps > MOST_STEPS) {
      return [
        unknownValue("a call that calls itself", at, callee.scope.module),
      ];
    }

    const bindings: Map<ts.Node, ReadonlyArray<Value>> = new Map<
      ts.Node,
      ReadonlyArray<Value>
    >(callee.scope.bindings);
    const scope: Scope = { module: callee.scope.module, bindings };

    node.parameters.forEach(
      (parameter: ts.ParameterDeclaration, index: number): void => {
        let values: ReadonlyArray<Value> | undefined = args[index];

        if (parameter.dotDotDotToken) {
          values = [
            {
              kind: "list",
              items: args.slice(index).flat(),
            },
          ];
        }

        if (!values || values.length === 0) {
          values = parameter.initializer
            ? this.read(parameter.initializer, scope)
            : [UNDEFINED];
        }

        this.bind(parameter.name, values, bindings, scope);
      },
    );

    this.steps += 1;
    this.reading.add(node);

    try {
      if (!ts.isBlock(node.body)) {
        return this.read(node.body, scope);
      }

      return this.returnsOf(node.body.statements, scope).values;
    } finally {
      this.reading.delete(node);
      this.steps -= 1;
    }
  }

  private bind(
    name: ts.BindingName,
    values: ReadonlyArray<Value>,
    bindings: Map<ts.Node, ReadonlyArray<Value>>,
    scope: Scope,
  ): void {
    if (ts.isIdentifier(name)) {
      bindings.set(name.parent, values);
      return;
    }

    if (ts.isObjectBindingPattern(name)) {
      for (const element of name.elements) {
        const key: ts.PropertyName | ts.BindingName =
          element.propertyName || element.name;

        if (!ts.isIdentifier(key) || element.dotDotDotToken) {
          continue;
        }

        const property: Array<Value> = [];

        for (const value of values) {
          property.push(
            ...(this.propertyOf(value, key.text, element, scope) || [
              UNDEFINED,
            ]),
          );
        }

        this.bind(element.name, property, bindings, scope);
      }
    }

    // A list taken apart ([id, name]) stands for values the guard does not read.
  }

  private returnsOf(
    statements: ReadonlyArray<ts.Statement>,
    scope: Scope,
  ): { values: Array<Value>; isCertain: boolean } {
    const values: Array<Value> = [];

    for (const statement of statements) {
      const returned: { values: Array<Value>; isCertain: boolean } =
        this.returnsOfStatement(statement, scope);

      values.push(...returned.values);

      if (returned.isCertain) {
        return { values, isCertain: true };
      }
    }

    return { values, isCertain: false };
  }

  private returnsOfStatement(
    statement: ts.Statement,
    scope: Scope,
  ): { values: Array<Value>; isCertain: boolean } {
    if (ts.isReturnStatement(statement)) {
      return {
        values: statement.expression
          ? [...this.read(statement.expression, scope)]
          : [UNDEFINED],
        isCertain: true,
      };
    }

    if (ts.isThrowStatement(statement)) {
      return { values: [], isCertain: true };
    }

    if (ts.isBlock(statement)) {
      return this.returnsOf(statement.statements, scope);
    }

    if (ts.isIfStatement(statement)) {
      const truth: boolean | null = this.truthOf(statement.expression, scope);
      const otherwise: { values: Array<Value>; isCertain: boolean } =
        statement.elseStatement && truth !== true
          ? this.returnsOfStatement(statement.elseStatement, scope)
          : { values: [], isCertain: false };

      if (truth === false) {
        return otherwise;
      }

      const then: { values: Array<Value>; isCertain: boolean } =
        this.returnsOfStatement(statement.thenStatement, scope);

      if (truth === true) {
        return then;
      }

      return {
        values: [...then.values, ...otherwise.values],
        isCertain: then.isCertain && otherwise.isCertain,
      };
    }

    if (ts.isSwitchStatement(statement)) {
      const values: Array<Value> = [];

      for (const clause of statement.caseBlock.clauses) {
        values.push(...this.returnsOf(clause.statements, scope).values);
      }

      return { values, isCertain: false };
    }

    if (ts.isTryStatement(statement)) {
      const values: Array<Value> = [
        ...this.returnsOf(statement.tryBlock.statements, scope).values,
      ];

      if (statement.catchClause) {
        values.push(
          ...this.returnsOf(statement.catchClause.block.statements, scope)
            .values,
        );
      }

      return { values, isCertain: false };
    }

    if (
      ts.isForOfStatement(statement) ||
      ts.isForInStatement(statement) ||
      ts.isForStatement(statement) ||
      ts.isWhileStatement(statement) ||
      ts.isDoStatement(statement) ||
      ts.isLabeledStatement(statement)
    ) {
      return {
        values: this.returnsOfStatement(statement.statement, scope).values,
        isCertain: false,
      };
    }

    return { values: [], isCertain: false };
  }

  private flatMap(
    values: ReadonlyArray<Value>,
    read: (value: Value) => ReadonlyArray<Value>,
  ): ReadonlyArray<Value> {
    const all: Array<Value> = [];

    for (const value of values) {
      all.push(...read(value));

      if (all.length > MOST_VALUES) {
        return [
          {
            kind: "unknown",
            why: "too many values to follow",
            at: "",
          },
        ];
      }
    }

    return all;
  }
}

function truthinessOf(value: Value): boolean | null {
  switch (value.kind) {
    case "text":
      return value.text !== "";
    case "boolean":
      return value.value;
    case "undefined":
      return false;
    case "unknown":
      return null;
    default:
      return true;
  }
}

function sameValue(left: Value, right: Value): boolean | null {
  if (left.kind === "text" && right.kind === "text") {
    return left.text === right.text;
  }

  if (left.kind === "boolean" && right.kind === "boolean") {
    return left.value === right.value;
  }

  if (left.kind === "undefined" || right.kind === "undefined") {
    if (left.kind === "unknown" || right.kind === "unknown") {
      return null;
    }

    return left.kind === right.kind;
  }

  return null;
}

/*
 * Whether an option is marked isUserContent: set, or - written on the option
 * itself - a choice made per option at run time that may set it. A mark
 * the guard cannot read because it comes from spreading what the guard
 * cannot read is no mark: the option's label is read.
 */
function isMarked(
  reader: Reader,
  option: Value,
  at: ts.Node,
  scope: Scope,
): boolean {
  const marks: ReadonlyArray<Value> | null = reader.propertyOf(
    option,
    "isUserContent",
    at,
    scope,
  );

  if (!marks || marks.length === 0) {
    return false;
  }

  if (
    marks.every((mark: Value): boolean => {
      return mark.kind === "boolean" && mark.value;
    })
  ) {
    return true;
  }

  if (option.kind !== "object") {
    return false;
  }

  const isWrittenOnOption: boolean = option.node.properties.some(
    (property: ts.ObjectLiteralElementLike): boolean => {
      return (
        (ts.isPropertyAssignment(property) ||
          ts.isShorthandPropertyAssignment(property)) &&
        (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) &&
        property.name.text === "isUserContent"
      );
    },
  );

  return (
    isWrittenOnOption &&
    marks.some((mark: Value): boolean => {
      return truthinessOf(mark) !== false;
    })
  );
}

/*
 * One filter's options, read: each option either marked isUserContent
 * (isMarked), or with the labels the guard read, or with a label it could
 * not read.
 */
function readOptions(
  reader: Reader,
  values: ReadonlyArray<Value>,
  site: FilterOptionsSite,
  at: ts.Node,
  scope: Scope,
): void {
  for (const value of values) {
    if (value.kind === "undefined") {
      continue;
    }

    if (value.kind !== "list") {
      site.unread.push(
        value.kind === "unknown"
          ? { why: value.why, at: value.at }
          : {
              why: `options that are not a list: ${site.written}`,
              at: `${site.file}:${site.line}`,
            },
      );
      continue;
    }

    for (const option of value.items) {
      if (option.kind === "unknown") {
        site.unread.push({ why: option.why, at: option.at });
        continue;
      }

      if (isMarked(reader, option, at, scope)) {
        site.asWritten += 1;
        continue;
      }

      const labels: ReadonlyArray<Value> | null = reader.propertyOf(
        option,
        "label",
        at,
        scope,
      );

      if (!labels) {
        site.unread.push({
          why: `an option with no label: ${site.written}`,
          at: `${site.file}:${site.line}`,
        });
        continue;
      }

      for (const label of labels) {
        if (label.kind === "text") {
          if (!site.words.includes(label.text)) {
            site.words.push(label.text);
          }
        } else if (label.kind === "unknown") {
          site.unread.push({ why: label.why, at: label.at });
        } else if (label.kind !== "undefined") {
          site.unread.push({
            why: `a label that is not a word: ${site.written}`,
            at: `${site.file}:${site.line}`,
          });
        }
      }
    }
  }
}

// Every filter's options in one module, read.
export function readFilterOptionsSites(
  file: string,
  text: string,
): Array<FilterOptionsSite> {
  const module: SourceModule = parseModule(file, text);
  const reader: Reader = new Reader();
  const sites: Array<FilterOptionsSite> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    const isSite: boolean =
      (ts.isPropertyAssignment(node) ||
        ts.isShorthandPropertyAssignment(node)) &&
      ts.isIdentifier(node.name) &&
      node.name.text === FILTER_OPTIONS_PROPERTY &&
      ts.isObjectLiteralExpression(node.parent);

    if (
      isSite &&
      (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node))
    ) {
      const options: ts.Expression = ts.isPropertyAssignment(node)
        ? node.initializer
        : node.name;
      const site: FilterOptionsSite = {
        file,
        line: lineOf(node, module),
        written: writtenOf(options, module),
        asWritten: 0,
        words: [],
        unread: [],
      };
      const scope: Scope = {
        module,
        bindings: new Map<ts.Node, ReadonlyArray<Value>>(),
      };

      readOptions(reader, reader.read(options, scope), site, node, scope);

      site.unread = site.unread.filter(
        (unread: UnreadLabel, index: number): boolean => {
          return (
            site.unread.findIndex((other: UnreadLabel): boolean => {
              return other.why === unread.why && other.at === unread.at;
            }) === index
          );
        },
      );
      sites.push(site);
    }

    ts.forEachChild(node, visit);
  };

  visit(module.source);

  return sites;
}

/*
 * The front ends' modules a filter may be written in: every feature set's
 * src, and ee's Dashboard and AdminDashboard when the checkout has ee/ -
 * not Common/UI, whose tables hand on the options they are given.
 */
export function listFilterOptionsScanFiles(): Array<string> {
  return listScanRoots(REPOSITORY_ROOT)
    .filter((root: string): boolean => {
      return !toRepositoryPath(root).startsWith("packages/Common/");
    })
    .flatMap((root: string): Array<string> => {
      return listSourceFiles(root);
    })
    .map(toRepositoryPath)
    .sort();
}

/*
 * The English locale a module's words are looked up in: its feature set's,
 * ee's Dashboard and AdminDashboard their open-source twins'. Null for a
 * front end with no locale files.
 */
export function englishLocaleFor(file: string): string | null {
  let frontEnd: string | null = null;
  const featureSet: RegExpMatchArray | null = file.match(
    /^packages\/App\/FeatureSet\/([^/]+)\//,
  );
  const enterprise: RegExpMatchArray | null = file.match(/^ee\/([^/]+)\//);

  if (featureSet) {
    frontEnd = featureSet[1] || null;
  } else if (enterprise) {
    frontEnd = enterprise[1] || null;
  }

  if (!frontEnd) {
    return null;
  }

  const locale: string = `packages/App/FeatureSet/${frontEnd}/src/Locales/en.json`;

  return fs.existsSync(path.join(REPOSITORY_ROOT, locale)) ? locale : null;
}

// A finding: a filter's label that is neither marked nor a key.
export interface FilterOptionLabelFinding {
  file: string;
  line: number;
  written: string;
  // A word that is no key of the front end's English locale.
  word?: string;
  // A label the guard could not read.
  unread?: UnreadLabel;
}

const localeKeyCache: Map<string, ReadonlySet<string>> = new Map<
  string,
  ReadonlySet<string>
>();

function localeKeys(locale: string): ReadonlySet<string> {
  const cached: ReadonlySet<string> | undefined = localeKeyCache.get(locale);

  if (cached) {
    return cached;
  }

  const keys: ReadonlySet<string> = new Set<string>(
    Object.keys(
      JSON.parse(
        fs.readFileSync(path.join(REPOSITORY_ROOT, locale), "utf8"),
      ) as Record<string, unknown>,
    ),
  );

  localeKeyCache.set(locale, keys);

  return keys;
}

// What a site breaks of the rule, with the locale its words are looked up in.
export function findingsOf(
  site: FilterOptionsSite,
  locale: string | null,
): Array<FilterOptionLabelFinding> {
  const findings: Array<FilterOptionLabelFinding> = [];
  const keys: ReadonlySet<string> = locale
    ? localeKeys(locale)
    : new Set<string>();

  for (const word of site.words) {
    // An empty label reads as nothing in every language.
    if (word !== "" && !keys.has(word)) {
      findings.push({
        file: site.file,
        line: site.line,
        written: site.written,
        word,
      });
    }
  }

  for (const unread of site.unread) {
    findings.push({
      file: site.file,
      line: site.line,
      written: site.written,
      unread,
    });
  }

  return findings;
}

export function formatFilterOptionLabelFindings(
  findings: ReadonlyArray<FilterOptionLabelFinding>,
): string {
  return findings
    .map((finding: FilterOptionLabelFinding): string => {
      const what: string =
        finding.word !== undefined
          ? `"${finding.word}" is no key of the English locale: a word to add to every locale, or a name to mark isUserContent`
          : `a label the guard cannot read - ${finding.unread?.why || ""} (${finding.unread?.at || ""}): a name to mark isUserContent, or a word to write where the guard can read it`;

      return `${finding.file}:${finding.line} ${finding.written}\n    ${what}`;
    })
    .join("\n");
}
