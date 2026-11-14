import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * THE DETECTOR BEHIND THE PLACEHOLDER GUARD: WHERE A PLACEHOLDER IS LOOKED
 * UP BY THE PAGE AND AGAIN BY THE CONTROL THAT DRAWS IT (#7682).
 *
 * The controls look up the placeholder they are given in the reader's
 * language: Input, TextArea, the dropdowns, the pickers, the code and
 * Markdown editors, and every component that hands its placeholder on to
 * one of them. A page that hands one a placeholder it has looked up
 * already has it looked up twice, and where a translation is itself an
 * English key the reader sees the translation of the translation: Spanish
 * says "Red" for "Network", and "Rojo" for "Red".
 *
 * So a placeholder is handed over in English, and the control looks it up,
 * once. A sentence the page builds around a value ("Filter by {{field}}")
 * or a front end's own keyed text (t("pages.…")) cannot be: the page puts
 * it in the reader's words and says so - isPlaceholderTranslated, or
 * is<Prop>Translated for another placeholder prop - and the control draws
 * it as given (Forms/Types/Field's placeholder says why).
 *
 * The scan reads the pages and shared components (App/FeatureSet and
 * Common/UI) as TypeScript. Which components look a placeholder prop up it
 * works out from their code: a lookup call that is given the prop, or the
 * prop handed on, not looked up, to a component that does - followed
 * through imports, lazy imports, re-exports, forwardRef and memo. Then it
 * reads every placeholder written for one of them:
 *
 * - a JSX placeholder (placeholder=, or any prop ending in Placeholder) that
 *   is looked up - a lookup call in it, or a constant of the enclosing code
 *   built with one - and goes to a component that looks it up again, unless
 *   the element says is<Prop>Translated;
 * - the placeholder of a form Field (an object with a FormFieldSchemaType
 *   fieldType: FormField hands it to such a control), unless the field says
 *   isPlaceholderTranslated;
 * - is<Prop>Translated beside English - a word written as it is, or a
 *   translationKey - which the control would draw untranslated;
 * - is<Prop>Translated worked out as the page runs beside a placeholder
 *   looked up whichever way it comes out: false some of the time, and the
 *   control then looks the translation up again;
 * - is<Prop>Translated given to a component that never reads it, which
 *   would still look the placeholder up again.
 */

export interface PlaceholderProblem {
  // The file and line, by its path from the packages folder.
  where: string;
  // Where the placeholder goes: "<Input placeholder>", or a form field's.
  handedTo: string;
  // The placeholder's code, on one line.
  code: string;
  // What is wrong, and what to do instead.
  message: string;
}

// A placeholder written for a control that looks it up.
export interface PlaceholderSite {
  where: string;
  handedTo: string;
  isLookedUp: boolean;
  isSaidTranslated: boolean;
}

export interface PlaceholderScanResult {
  problems: Array<PlaceholderProblem>;
  sites: Array<PlaceholderSite>;
  /*
   * Whether a component's prop ends in a lookup: the component by the
   * file it is written in, from the packages folder, and its name.
   */
  isLookedUpBy: (file: string, component: string, prop: string) => boolean;
}

export const LOOKED_UP_TWICE_MESSAGE: string =
  "is looked up here, and again by the control that draws it: hand it over in English (a constant through translationKey), or - a sentence built around a value, a front end's own keyed text - say it is in the reader's words already with ";

export const ENGLISH_SAID_TRANSLATED_MESSAGE: string =
  "is English, but is said to be in the reader's words already, so the control would draw it untranslated: hand it over without ";

export const FLAG_NOT_READ_MESSAGE: string =
  "is said to be in the reader's words already, but the component never reads ";

export const SOMETIMES_SAID_TRANSLATED_MESSAGE: string =
  "is looked up here whichever way it comes out, but is said to be in the reader's words already only some of the time, and whenever it is not the control looks it up again: say so plainly with ";

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
];

/*
 * What a helper that looks a text up is handed - getFilterPlaceholder(
 * translator, title) is a lookup too.
 */
const TRANSLATOR_ARGUMENTS: ReadonlyArray<string> = ["translator", ...LOOKUPS];

// Where pages and shared components are written, from the packages folder.
const SOURCE_FOLDERS: ReadonlyArray<string> = [
  path.join("App", "FeatureSet"),
  path.join("Common", "UI"),
];

const SKIPPED_FOLDERS: ReadonlyArray<string> = [
  "node_modules",
  "build",
  "dist",
  "Tests",
  "__tests__",
];

const SOURCE_FILE: RegExp = /\.tsx?$/;
const NOT_SOURCE_FILE: RegExp = /\.(test|spec)\.tsx?$|\.d\.ts$/;
const COMPONENT_NAME: RegExp = /^[A-Z]/;
const LETTER: RegExp = /\p{L}/u;
const ENDS_IN_PLACEHOLDER: RegExp = /^[a-z][A-Za-z]*Placeholder$/;

// placeholder, and every prop that ends in Placeholder.
export function isPlaceholderProp(name: string): boolean {
  return name === "placeholder" || ENDS_IN_PLACEHOLDER.test(name);
}

// What says a placeholder prop is in the reader's words already.
export function translatedFlagOf(prop: string): string {
  return `is${prop.charAt(0).toUpperCase()}${prop.slice(1)}Translated`;
}

type ComponentFunction =
  | ts.ArrowFunction
  | ts.FunctionExpression
  | ts.FunctionDeclaration;

interface Component {
  file: string;
  fn: ComponentFunction;
}

// A name in a file: a component, another name of that file, or an import.
interface NameReference {
  component?: string | undefined;
  alias?: string | undefined;
  module?: string | undefined;
  imported?: string | undefined;
}

interface FileNames {
  locals: Map<string, NameReference>;
  named: Map<string, NameReference>;
  defaultExport: NameReference | null;
}

interface PropUse {
  // A lookup call is given the prop.
  isLookedUp: boolean;
  // The prop, not looked up, handed to an element's attribute.
  handedTo: Array<{ tag: string; as: string }>;
}

interface PropReferences {
  propsNames: Set<string>;
  restNames: Set<string>;
  containsReference: (node: ts.Node) => boolean;
}

function listSourceFiles(folder: string): Array<string> {
  const files: Array<string> = [];

  if (!fs.existsSync(folder)) {
    return files;
  }

  const entries: Array<fs.Dirent> = fs
    .readdirSync(folder, { withFileTypes: true })
    .sort((a: fs.Dirent, b: fs.Dirent): number => {
      return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
    });

  for (const entry of entries) {
    const full: string = path.join(folder, entry.name);

    if (entry.isDirectory()) {
      if (!SKIPPED_FOLDERS.includes(entry.name)) {
        files.push(...listSourceFiles(full));
      }
    } else if (
      SOURCE_FILE.test(entry.name) &&
      !NOT_SOURCE_FILE.test(entry.name)
    ) {
      files.push(full);
    }
  }

  return files;
}

function calleeName(call: ts.CallExpression): string {
  const callee: ts.Expression = call.expression;

  if (ts.isIdentifier(callee)) {
    return callee.text;
  }

  if (ts.isPropertyAccessExpression(callee)) {
    return callee.name.text;
  }

  return "";
}

function isLookupCall(node: ts.Node): node is ts.CallExpression {
  if (!ts.isCallExpression(node)) {
    return false;
  }

  if (LOOKUPS.includes(calleeName(node))) {
    return true;
  }

  return node.arguments.some((argument: ts.Expression): boolean => {
    return (
      ts.isIdentifier(argument) && TRANSLATOR_ARGUMENTS.includes(argument.text)
    );
  });
}

function containsLookup(node: ts.Node): boolean {
  if (isLookupCall(node)) {
    return true;
  }

  return Boolean(ts.forEachChild(node, containsLookup));
}

// A flag written as plainly true: a bare attribute, or true itself.
function isPlainlyTrue(node: ts.Node | undefined): boolean {
  if (!node) {
    return true;
  }

  if (ts.isJsxExpression(node)) {
    return Boolean(node.expression) && isPlainlyTrue(node.expression);
  }

  return node.kind === ts.SyntaxKind.TrueKeyword;
}

function isFalse(node: ts.Node | undefined): boolean {
  if (!node) {
    return false;
  }

  if (ts.isJsxExpression(node)) {
    return isFalse(node.expression);
  }

  return node.kind === ts.SyntaxKind.FalseKeyword;
}

// The constant a name is declared as, in the code around a node.
function findDeclaration(
  name: string,
  from: ts.Node,
): ts.VariableDeclaration | null {
  let scope: ts.Node | undefined = from.parent;

  while (scope) {
    const statements: ts.NodeArray<ts.Statement> | null =
      ts.isBlock(scope) || ts.isSourceFile(scope) ? scope.statements : null;

    if (statements) {
      for (const statement of statements) {
        if (ts.isVariableStatement(statement)) {
          for (const declaration of statement.declarationList.declarations) {
            if (
              ts.isIdentifier(declaration.name) &&
              declaration.name.text === name
            ) {
              return declaration;
            }
          }
        }
      }
    }

    scope = scope.parent;
  }

  return null;
}

/*
 * Whether a value is looked up: a lookup call in it, or a name in it that
 * the code around it built with one.
 */
function isLookedUpValue(value: ts.Node, at: ts.Node): boolean {
  if (containsLookup(value)) {
    return true;
  }

  let found: boolean = false;

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (found) {
      return;
    }

    if (
      ts.isIdentifier(node) &&
      !(
        node.parent &&
        ts.isPropertyAccessExpression(node.parent) &&
        node.parent.name === node
      )
    ) {
      const declaration: ts.VariableDeclaration | null = findDeclaration(
        node.text,
        at,
      );

      if (declaration?.initializer && containsLookup(declaration.initializer)) {
        found = true;
        return;
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(value);

  return found;
}

/*
 * Whether a value can be English a control is to draw as given: a word
 * written as it is, or through translationKey, in any of the places the
 * value can come from (either side of a ?: or ||), or a constant that is one.
 */
function isEnglish(value: ts.Node, at: ts.Node, depth: number = 0): boolean {
  if (depth > 8) {
    return false;
  }

  if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) {
    return LETTER.test(value.text);
  }

  if (ts.isJsxExpression(value)) {
    return Boolean(value.expression) && isEnglish(value.expression!, at, depth);
  }

  if (
    ts.isParenthesizedExpression(value) ||
    ts.isAsExpression(value) ||
    ts.isNonNullExpression(value) ||
    ts.isSatisfiesExpression(value)
  ) {
    return isEnglish(value.expression, at, depth + 1);
  }

  if (ts.isConditionalExpression(value)) {
    return (
      isEnglish(value.whenTrue, at, depth + 1) ||
      isEnglish(value.whenFalse, at, depth + 1)
    );
  }

  if (ts.isBinaryExpression(value)) {
    const operator: ts.SyntaxKind = value.operatorToken.kind;

    if (
      operator === ts.SyntaxKind.BarBarToken ||
      operator === ts.SyntaxKind.QuestionQuestionToken
    ) {
      return (
        isEnglish(value.left, at, depth + 1) ||
        isEnglish(value.right, at, depth + 1)
      );
    }

    if (operator === ts.SyntaxKind.AmpersandAmpersandToken) {
      return isEnglish(value.right, at, depth + 1);
    }

    return false;
  }

  if (ts.isCallExpression(value)) {
    return calleeName(value) === "translationKey";
  }

  if (ts.isIdentifier(value)) {
    const declaration: ts.VariableDeclaration | null = findDeclaration(
      value.text,
      at,
    );

    return Boolean(
      declaration?.initializer &&
        isEnglish(declaration.initializer, declaration, depth + 1),
    );
  }

  return false;
}

/*
 * Whether a value is looked up whichever way it comes out: a lookup call,
 * on both sides of a ?: or ||, or a constant built as one. A flag worked
 * out as the page runs, beside it, is false some of the time.
 */
function isAlwaysLookedUp(
  value: ts.Node,
  at: ts.Node,
  depth: number = 0,
): boolean {
  if (depth > 8) {
    return false;
  }

  if (ts.isJsxExpression(value)) {
    return value.expression
      ? isAlwaysLookedUp(value.expression, at, depth)
      : false;
  }

  if (
    ts.isParenthesizedExpression(value) ||
    ts.isAsExpression(value) ||
    ts.isNonNullExpression(value) ||
    ts.isSatisfiesExpression(value)
  ) {
    return isAlwaysLookedUp(value.expression, at, depth + 1);
  }

  if (ts.isConditionalExpression(value)) {
    return (
      isAlwaysLookedUp(value.whenTrue, at, depth + 1) &&
      isAlwaysLookedUp(value.whenFalse, at, depth + 1)
    );
  }

  if (ts.isBinaryExpression(value)) {
    const operator: ts.SyntaxKind = value.operatorToken.kind;

    return (
      (operator === ts.SyntaxKind.BarBarToken ||
        operator === ts.SyntaxKind.QuestionQuestionToken) &&
      isAlwaysLookedUp(value.left, at, depth + 1) &&
      isAlwaysLookedUp(value.right, at, depth + 1)
    );
  }

  if (ts.isIdentifier(value)) {
    const declaration: ts.VariableDeclaration | null = findDeclaration(
      value.text,
      at,
    );

    return Boolean(
      declaration?.initializer &&
        isAlwaysLookedUp(declaration.initializer, declaration, depth + 1),
    );
  }

  return isLookupCall(value);
}

// In the order of the files, and of the lines in each.
function byPlace(a: { where: string }, b: { where: string }): number {
  const [fileA, lineA] = splitPlace(a.where);
  const [fileB, lineB] = splitPlace(b.where);

  if (fileA !== fileB) {
    return fileA < fileB ? -1 : 1;
  }

  return lineA - lineB;
}

function splitPlace(where: string): [string, number] {
  const colon: number = where.lastIndexOf(":");

  return [where.slice(0, colon), Number(where.slice(colon + 1))];
}

/*
 * The name a JSX tag stands for: itself, or - a constant of the code around
 * it, as the lazy controls draw what they load (const Editor: typeof
 * CodeEditor = load.library) - the component its type or value names.
 */
function tagNameOf(tag: string, at: ts.Node): string {
  const declaration: ts.VariableDeclaration | null = findDeclaration(tag, at);

  if (!declaration) {
    return tag;
  }

  if (
    declaration.type &&
    ts.isTypeQueryNode(declaration.type) &&
    ts.isIdentifier(declaration.type.exprName)
  ) {
    return declaration.type.exprName.text;
  }

  if (declaration.initializer && ts.isIdentifier(declaration.initializer)) {
    return declaration.initializer.text;
  }

  return tag;
}

function oneLine(node: ts.Node, source: ts.SourceFile): string {
  return node.getText(source).replace(/\s+/g, " ").trim();
}

class PlaceholderScan {
  private readonly packagesDirectory: string;
  private readonly sources: Map<string, ts.SourceFile> = new Map();
  private readonly names: Map<string, FileNames> = new Map();
  private readonly components: Map<string, Component> = new Map();
  private readonly uses: Map<string, PropUse> = new Map();
  private readonly endings: Map<string, boolean | null> = new Map();

  public constructor(packagesDirectory: string) {
    this.packagesDirectory = packagesDirectory;
  }

  public scan(): PlaceholderScanResult {
    const problems: Array<PlaceholderProblem> = [];
    const sites: Array<PlaceholderSite> = [];

    for (const folder of SOURCE_FOLDERS) {
      for (const file of listSourceFiles(
        path.join(this.packagesDirectory, folder),
      )) {
        const text: string = fs.readFileSync(file, "utf8");

        if (!text.includes("laceholder")) {
          continue;
        }

        const source: ts.SourceFile = this.sourceOf(file)!;

        this.readJsxPlaceholders(file, source, problems, sites);
        this.readFormFieldPlaceholders(file, source, problems, sites);
      }
    }

    problems.sort(byPlace);
    sites.sort(byPlace);

    return {
      problems,
      sites,
      isLookedUpBy: (file: string, component: string, prop: string) => {
        return this.endsInLookup(
          `${path.join(this.packagesDirectory, file)}#${component}`,
          prop,
        );
      },
    };
  }

  private relative(file: string): string {
    return path.relative(this.packagesDirectory, file);
  }

  private sourceOf(file: string): ts.SourceFile | null {
    const cached: ts.SourceFile | undefined = this.sources.get(file);

    if (cached) {
      return cached;
    }

    if (!fs.existsSync(file)) {
      return null;
    }

    const source: ts.SourceFile = ts.createSourceFile(
      file,
      fs.readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );

    this.sources.set(file, source);

    return source;
  }

  // The file an import names, when it is one of ours.
  private resolveModule(from: string, specifier: string): string | null {
    let base: string;

    if (specifier.startsWith(".")) {
      base = path.resolve(path.dirname(from), specifier);
    } else if (specifier.startsWith("Common/")) {
      base = path.join(
        this.packagesDirectory,
        "Common",
        specifier.slice("Common/".length),
      );
    } else {
      return null;
    }

    for (const candidate of [
      base,
      `${base}.tsx`,
      `${base}.ts`,
      path.join(base, "Index.tsx"),
      path.join(base, "index.tsx"),
      path.join(base, "Index.ts"),
      path.join(base, "index.ts"),
    ]) {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return candidate;
      }
    }

    return null;
  }

  // The function under forwardRef(...), memo(...), (... as X).
  private unwrap(expression: ts.Expression): ts.Expression {
    let current: ts.Expression = expression;

    for (let index: number = 0; index < 6; index++) {
      if (
        ts.isParenthesizedExpression(current) ||
        ts.isAsExpression(current) ||
        ts.isSatisfiesExpression(current)
      ) {
        current = current.expression;
        continue;
      }

      if (
        ts.isCallExpression(current) &&
        ["forwardRef", "memo", "observer"].includes(calleeName(current)) &&
        current.arguments.length > 0
      ) {
        current = current.arguments[0]!;
        continue;
      }

      break;
    }

    return current;
  }

  // lazy(() => import("./X")): the module it loads.
  private lazyModule(expression: ts.Expression): string | null {
    if (
      !ts.isCallExpression(expression) ||
      calleeName(expression) !== "lazy" ||
      expression.arguments.length === 0
    ) {
      return null;
    }

    let found: string | null = null;

    const visit: (node: ts.Node) => void = (node: ts.Node): void => {
      if (found) {
        return;
      }

      if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        node.arguments[0] &&
        ts.isStringLiteral(node.arguments[0])
      ) {
        found = node.arguments[0].text;
        return;
      }

      ts.forEachChild(node, visit);
    };

    visit(expression.arguments[0]!);

    return found;
  }

  private namesOf(file: string): FileNames {
    const cached: FileNames | undefined = this.names.get(file);

    if (cached) {
      return cached;
    }

    const names: FileNames = {
      locals: new Map(),
      named: new Map(),
      defaultExport: null,
    };

    this.names.set(file, names);

    const source: ts.SourceFile | null = this.sourceOf(file);

    if (!source) {
      return names;
    }

    const addComponent: (name: string, fn: ComponentFunction) => void = (
      name: string,
      fn: ComponentFunction,
    ): void => {
      const key: string = `${file}#${name}`;

      this.components.set(key, { file, fn });
      names.locals.set(name, { component: key });
    };

    const hasModifier: (
      statement: ts.Statement,
      kind: ts.SyntaxKind,
    ) => boolean = (statement: ts.Statement, kind: ts.SyntaxKind): boolean => {
      return Boolean(
        ts.canHaveModifiers(statement) &&
          ts.getModifiers(statement)?.some((modifier: ts.Modifier) => {
            return modifier.kind === kind;
          }),
      );
    };

    for (const statement of source.statements) {
      if (
        ts.isImportDeclaration(statement) &&
        statement.importClause &&
        ts.isStringLiteral(statement.moduleSpecifier)
      ) {
        const target: string | null = this.resolveModule(
          file,
          statement.moduleSpecifier.text,
        );

        if (!target) {
          continue;
        }

        if (statement.importClause.name) {
          names.locals.set(statement.importClause.name.text, {
            module: target,
            imported: "default",
          });
        }

        const bindings: ts.NamedImportBindings | undefined =
          statement.importClause.namedBindings;

        if (bindings && ts.isNamedImports(bindings)) {
          for (const element of bindings.elements) {
            names.locals.set(element.name.text, {
              module: target,
              imported: (element.propertyName || element.name).text,
            });
          }
        }
      } else if (
        ts.isFunctionDeclaration(statement) &&
        statement.name &&
        COMPONENT_NAME.test(statement.name.text)
      ) {
        addComponent(statement.name.text, statement);

        if (hasModifier(statement, ts.SyntaxKind.ExportKeyword)) {
          const reference: NameReference = {
            component: `${file}#${statement.name.text}`,
          };

          if (hasModifier(statement, ts.SyntaxKind.DefaultKeyword)) {
            names.defaultExport = reference;
          } else {
            names.named.set(statement.name.text, reference);
          }
        }
      } else if (ts.isVariableStatement(statement)) {
        const isExported: boolean = hasModifier(
          statement,
          ts.SyntaxKind.ExportKeyword,
        );

        for (const declaration of statement.declarationList.declarations) {
          if (
            !ts.isIdentifier(declaration.name) ||
            !declaration.initializer ||
            !COMPONENT_NAME.test(declaration.name.text)
          ) {
            continue;
          }

          const name: string = declaration.name.text;
          const lazy: string | null = this.lazyModule(declaration.initializer);

          if (lazy) {
            const target: string | null = this.resolveModule(file, lazy);

            if (target) {
              names.locals.set(name, { module: target, imported: "default" });
            }
          } else {
            const fn: ts.Expression = this.unwrap(declaration.initializer);

            if (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) {
              addComponent(name, fn);
            } else if (ts.isIdentifier(fn)) {
              names.locals.set(name, { alias: fn.text });
            }
          }

          const local: NameReference | undefined = names.locals.get(name);

          if (isExported && local) {
            names.named.set(name, local);
          }
        }
      } else if (
        ts.isExportAssignment(statement) &&
        !statement.isExportEquals
      ) {
        const inner: ts.Expression = this.unwrap(statement.expression);

        if (ts.isIdentifier(inner)) {
          names.defaultExport = { alias: inner.text };
        } else if (
          ts.isArrowFunction(inner) ||
          ts.isFunctionExpression(inner)
        ) {
          addComponent("default", inner);
          names.defaultExport = { component: `${file}#default` };
        }
      } else if (
        ts.isExportDeclaration(statement) &&
        statement.exportClause &&
        ts.isNamedExports(statement.exportClause)
      ) {
        const target: string | null =
          statement.moduleSpecifier &&
          ts.isStringLiteral(statement.moduleSpecifier)
            ? this.resolveModule(file, statement.moduleSpecifier.text)
            : null;

        for (const element of statement.exportClause.elements) {
          const local: string = (element.propertyName || element.name).text;
          const reference: NameReference = target
            ? { module: target, imported: local }
            : { alias: local };

          if (element.name.text === "default") {
            names.defaultExport = reference;
          } else {
            names.named.set(element.name.text, reference);
          }
        }
      }
    }

    return names;
  }

  // The component a name in a file is, through aliases and imports.
  private resolveReference(
    file: string,
    reference: NameReference | null | undefined,
    depth: number = 0,
  ): string | null {
    if (!reference || depth > 8) {
      return null;
    }

    if (reference.component) {
      return reference.component;
    }

    if (reference.alias) {
      return this.resolveReference(
        file,
        this.namesOf(file).locals.get(reference.alias),
        depth + 1,
      );
    }

    if (reference.module) {
      const names: FileNames = this.namesOf(reference.module);
      const target: NameReference | null | undefined =
        reference.imported === "default"
          ? names.defaultExport
          : names.named.get(reference.imported || "") ||
            names.locals.get(reference.imported || "");

      return this.resolveReference(reference.module, target, depth + 1);
    }

    return null;
  }

  private resolveTag(file: string, tag: string): string | null {
    return this.resolveReference(file, this.namesOf(file).locals.get(tag));
  }

  // What, in a component's code, is its prop.
  private propReferences(component: Component, prop: string): PropReferences {
    const fn: ComponentFunction = component.fn;
    const parameter: ts.ParameterDeclaration | undefined = fn.parameters[0];
    const propsNames: Set<string> = new Set();
    const boundNames: Set<string> = new Set();
    const restNames: Set<string> = new Set();

    const take: (pattern: ts.ObjectBindingPattern) => void = (
      pattern: ts.ObjectBindingPattern,
    ): void => {
      let isPicked: boolean = false;

      for (const element of pattern.elements) {
        const name: string = element.propertyName
          ? element.propertyName.getText()
          : element.name.getText();

        if (element.dotDotDotToken && ts.isIdentifier(element.name)) {
          restNames.add(element.name.text);
        } else if (name === prop && ts.isIdentifier(element.name)) {
          boundNames.add(element.name.text);
          isPicked = true;
        }
      }

      // Taken out by name, the prop is not in the rest.
      if (isPicked) {
        for (const element of pattern.elements) {
          if (element.dotDotDotToken && ts.isIdentifier(element.name)) {
            restNames.delete(element.name.text);
          }
        }
      }
    };

    if (parameter) {
      if (ts.isIdentifier(parameter.name)) {
        propsNames.add(parameter.name.text);
      } else if (ts.isObjectBindingPattern(parameter.name)) {
        take(parameter.name);
      }
    }

    const visitDestructuring: (node: ts.Node) => void = (
      node: ts.Node,
    ): void => {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isObjectBindingPattern(node.name) &&
        node.initializer &&
        ts.isIdentifier(node.initializer) &&
        propsNames.has(node.initializer.text)
      ) {
        take(node.name);
      }

      ts.forEachChild(node, visitDestructuring);
    };

    if (fn.body) {
      visitDestructuring(fn.body);
    }

    // A name read, not declared or written as a key.
    const isRead: (node: ts.Identifier) => boolean = (
      node: ts.Identifier,
    ): boolean => {
      const parent: ts.Node | undefined = node.parent;

      if (!parent) {
        return true;
      }

      if (ts.isPropertyAccessExpression(parent) && parent.name === node) {
        return false;
      }

      if (ts.isPropertyAssignment(parent) && parent.name === node) {
        return false;
      }

      if (ts.isVariableDeclaration(parent) && parent.name === node) {
        return false;
      }

      return !ts.isBindingElement(parent) && !ts.isJsxAttribute(parent);
    };

    const isReference: (node: ts.Node) => boolean = (
      node: ts.Node,
    ): boolean => {
      if (
        ts.isPropertyAccessExpression(node) &&
        node.name.text === prop &&
        ts.isIdentifier(node.expression) &&
        (propsNames.has(node.expression.text) ||
          restNames.has(node.expression.text))
      ) {
        return true;
      }

      return ts.isIdentifier(node) && boundNames.has(node.text) && isRead(node);
    };

    // The names the code gives the prop, or a value made from it.
    const aliases: Set<string> = new Set();

    const containsReference: (node: ts.Node) => boolean = (
      node: ts.Node,
    ): boolean => {
      if (isReference(node)) {
        return true;
      }

      if (ts.isIdentifier(node) && aliases.has(node.text) && isRead(node)) {
        return true;
      }

      return Boolean(ts.forEachChild(node, containsReference));
    };

    // One pass over the code: whether it found a name it had not.
    const addAliases: (node: ts.Node) => boolean = (node: ts.Node): boolean => {
      let isAdded: boolean = false;

      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer &&
        !aliases.has(node.name.text) &&
        containsReference(node.initializer)
      ) {
        aliases.add(node.name.text);
        isAdded = true;
      }

      ts.forEachChild(node, (child: ts.Node): void => {
        if (addAliases(child)) {
          isAdded = true;
        }
      });

      return isAdded;
    };

    if (fn.body) {
      const body: ts.ConciseBody = fn.body;
      let isGrowing: boolean = true;

      // Again, until a pass finds none: a name can be made from a later one.
      while (isGrowing) {
        isGrowing = addAliases(body);
      }
    }

    return { propsNames, restNames, containsReference };
  }

  // What a component does with a prop: looks it up, or hands it on.
  private useOf(key: string, prop: string): PropUse {
    const id: string = `${key}|${prop}`;
    const cached: PropUse | undefined = this.uses.get(id);

    if (cached) {
      return cached;
    }

    const use: PropUse = { isLookedUp: false, handedTo: [] };

    this.uses.set(id, use);

    const component: Component | undefined = this.components.get(key);

    if (!component?.fn.body) {
      return use;
    }

    const source: ts.SourceFile = component.fn.getSourceFile();
    const references: PropReferences = this.propReferences(component, prop);

    const visit: (node: ts.Node) => void = (node: ts.Node): void => {
      if (
        isLookupCall(node) &&
        node.arguments.some((argument: ts.Expression): boolean => {
          return references.containsReference(argument);
        })
      ) {
        use.isLookedUp = true;
      }

      if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
        const tag: string = tagNameOf(node.tagName.getText(source), node);

        for (const attribute of node.attributes.properties) {
          if (
            ts.isJsxAttribute(attribute) &&
            attribute.initializer &&
            references.containsReference(attribute.initializer) &&
            !containsLookup(attribute.initializer)
          ) {
            use.handedTo.push({ tag, as: attribute.name.getText(source) });
          }

          if (
            ts.isJsxSpreadAttribute(attribute) &&
            ts.isIdentifier(attribute.expression) &&
            (references.propsNames.has(attribute.expression.text) ||
              references.restNames.has(attribute.expression.text))
          ) {
            use.handedTo.push({ tag, as: prop });
          }
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(component.fn.body);

    return use;
  }

  // Whether a component's prop is looked up, by it or by one it hands it to.
  private endsInLookup(key: string, prop: string, depth: number = 0): boolean {
    const id: string = `${key}|${prop}`;

    if (this.endings.has(id)) {
      return Boolean(this.endings.get(id));
    }

    // Not yet known: a component that hands the prop back round is no lookup.
    this.endings.set(id, null);

    // The file's names, so a component it declares is known.
    this.namesOf(key.split("#")[0]!);

    const use: PropUse = this.useOf(key, prop);
    let isLookedUp: boolean = use.isLookedUp;

    if (!isLookedUp && depth < 12) {
      const component: Component | undefined = this.components.get(key);

      for (const handed of use.handedTo) {
        const target: string | null = component
          ? this.resolveTag(component.file, handed.tag)
          : null;

        if (target && this.endsInLookup(target, handed.as, depth + 1)) {
          isLookedUp = true;
          break;
        }
      }
    }

    this.endings.set(id, isLookedUp);

    return isLookedUp;
  }

  /*
   * Whether a component's code reads a prop: names it, or hands its props on
   * whole to a component that does (LazyFilePicker's {...props}).
   */
  private reads(key: string, prop: string, depth: number = 0): boolean {
    const component: Component | undefined = this.components.get(key);

    if (!component) {
      return false;
    }

    if (component.fn.getText().includes(prop)) {
      return true;
    }

    if (depth > 8) {
      return false;
    }

    return this.useOf(key, prop).handedTo.some(
      (handed: { tag: string; as: string }): boolean => {
        const target: string | null = this.resolveTag(
          component.file,
          handed.tag,
        );

        return Boolean(target && this.reads(target, handed.as, depth + 1));
      },
    );
  }

  private readJsxPlaceholders(
    file: string,
    source: ts.SourceFile,
    problems: Array<PlaceholderProblem>,
    sites: Array<PlaceholderSite>,
  ): void {
    if (!file.endsWith(".tsx")) {
      return;
    }

    const visit: (node: ts.Node) => void = (node: ts.Node): void => {
      if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
        const tag: string = node.tagName.getText(source);
        const component: string = tagNameOf(tag, node);
        const attributes: Map<string, ts.JsxAttribute> = new Map();

        for (const attribute of node.attributes.properties) {
          if (ts.isJsxAttribute(attribute)) {
            attributes.set(attribute.name.getText(source), attribute);
          }
        }

        for (const [prop, attribute] of attributes) {
          if (!isPlaceholderProp(prop) || !attribute.initializer) {
            continue;
          }

          const target: string | null = COMPONENT_NAME.test(tag)
            ? this.resolveTag(file, component)
            : null;

          if (!target || !this.endsInLookup(target, prop)) {
            continue;
          }

          const flag: string = translatedFlagOf(prop);
          const flagAttribute: ts.JsxAttribute | undefined =
            attributes.get(flag);
          const isSaidTranslated: boolean = Boolean(
            flagAttribute && !isFalse(flagAttribute.initializer),
          );
          const value: ts.Node = attribute.initializer;
          const isLookedUp: boolean = isLookedUpValue(value, attribute);
          const where: string = `${this.relative(file)}:${
            source.getLineAndCharacterOfPosition(attribute.getStart(source))
              .line + 1
          }`;
          const handedTo: string = `<${tag} ${prop}>`;
          const code: string = oneLine(value, source);

          sites.push({ where, handedTo, isLookedUp, isSaidTranslated });

          if (isLookedUp && !isSaidTranslated) {
            problems.push({
              where,
              handedTo,
              code,
              message: `${LOOKED_UP_TWICE_MESSAGE}${flag}`,
            });
          }

          if (
            flagAttribute &&
            isSaidTranslated &&
            !isPlainlyTrue(flagAttribute.initializer) &&
            isAlwaysLookedUp(value, attribute)
          ) {
            problems.push({
              where,
              handedTo,
              code,
              message: `${SOMETIMES_SAID_TRANSLATED_MESSAGE}${flag}`,
            });
          }

          /*
           * Beside a flag worked out from the value (Boolean(props.placeholder
           * && ...)), English is the code's own fallback, not said translated.
           */
          if (
            flagAttribute &&
            isPlainlyTrue(flagAttribute.initializer) &&
            isEnglish(value, attribute)
          ) {
            problems.push({
              where,
              handedTo,
              code,
              message: `${ENGLISH_SAID_TRANSLATED_MESSAGE}${flag}`,
            });
          }

          if (isSaidTranslated && !this.reads(target, flag)) {
            problems.push({
              where,
              handedTo,
              code,
              message: `${FLAG_NOT_READ_MESSAGE}${flag}`,
            });
          }
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(source);
  }

  /*
   * A form Field's placeholders: FormField hands each to a control that
   * looks it up (Forms/Types/Field).
   */
  private readFormFieldPlaceholders(
    file: string,
    source: ts.SourceFile,
    problems: Array<PlaceholderProblem>,
    sites: Array<PlaceholderSite>,
  ): void {
    const visit: (node: ts.Node) => void = (node: ts.Node): void => {
      if (ts.isObjectLiteralExpression(node)) {
        const properties: Map<string, ts.ObjectLiteralElementLike> = new Map();

        for (const property of node.properties) {
          if (property.name) {
            properties.set(property.name.getText(source), property);
          }
        }

        const fieldType: ts.ObjectLiteralElementLike | undefined =
          properties.get("fieldType");

        if (
          fieldType &&
          fieldType.getText(source).includes("FormFieldSchemaType")
        ) {
          for (const [prop, property] of properties) {
            if (isPlaceholderProp(prop)) {
              this.readFormFieldPlaceholder(
                file,
                source,
                prop,
                property,
                properties.get(translatedFlagOf(prop)),
                problems,
                sites,
              );
            }
          }
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(source);
  }

  private readFormFieldPlaceholder(
    file: string,
    source: ts.SourceFile,
    prop: string,
    property: ts.ObjectLiteralElementLike,
    flagProperty: ts.ObjectLiteralElementLike | undefined,
    problems: Array<PlaceholderProblem>,
    sites: Array<PlaceholderSite>,
  ): void {
    const value: ts.Node | null = ts.isPropertyAssignment(property)
      ? property.initializer
      : ts.isShorthandPropertyAssignment(property)
        ? property.name
        : null;

    if (!value) {
      return;
    }

    const flag: string = translatedFlagOf(prop);
    const isSaidTranslated: boolean = Boolean(
      flagProperty &&
        !(
          ts.isPropertyAssignment(flagProperty) &&
          isFalse(flagProperty.initializer)
        ),
    );
    const isLookedUp: boolean = isLookedUpValue(value, property);
    const where: string = `${this.relative(file)}:${
      source.getLineAndCharacterOfPosition(property.getStart(source)).line + 1
    }`;
    const handedTo: string = `a form field's ${prop}`;
    const code: string = oneLine(value, source);

    sites.push({ where, handedTo, isLookedUp, isSaidTranslated });

    if (isLookedUp && !isSaidTranslated) {
      problems.push({
        where,
        handedTo,
        code,
        message: `${LOOKED_UP_TWICE_MESSAGE}${flag}`,
      });
    }

    const isPlainlySaid: boolean = Boolean(
      flagProperty &&
        ts.isPropertyAssignment(flagProperty) &&
        isPlainlyTrue(flagProperty.initializer),
    );

    if (
      isSaidTranslated &&
      !isPlainlySaid &&
      isAlwaysLookedUp(value, property)
    ) {
      problems.push({
        where,
        handedTo,
        code,
        message: `${SOMETIMES_SAID_TRANSLATED_MESSAGE}${flag}`,
      });
    }

    if (isPlainlySaid && isEnglish(value, property)) {
      problems.push({
        where,
        handedTo,
        code,
        message: `${ENGLISH_SAID_TRANSLATED_MESSAGE}${flag}`,
      });
    }
  }
}

/*
 * Every placeholder the pages and shared components under a packages
 * folder write for a control that looks it up, and what is wrong with each.
 */
export function scanPlaceholders(
  packagesDirectory: string,
): PlaceholderScanResult {
  return new PlaceholderScan(packagesDirectory).scan();
}
