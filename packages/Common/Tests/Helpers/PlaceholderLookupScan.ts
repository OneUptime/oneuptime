import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * THE DETECTOR BEHIND THE LOOKED-UP-ONCE GUARDS: WHERE A TEXT IS LOOKED UP
 * BY THE PAGE AND AGAIN BY THE CONTROL THAT DRAWS IT (#7682, #7790, #7791).
 *
 * The controls look up the texts they are given in the reader's language:
 * a placeholder (Input, TextArea, the dropdowns, the pickers, the code and
 * Markdown editors), an aria label (Button, Dropdown, MoreMenu, the
 * checkboxes and switches), a nav bar's titles and its products menu's
 * words, a detail card's words for an empty value - and so does every
 * component that hands such a text on to one of them. A page that hands one
 * a text it has looked up already has it looked up twice, and where a
 * translation is itself an English key the reader sees the translation of
 * the translation: Spanish says "Red" for "Network", and "Rojo" for "Red".
 *
 * So a text is handed over in English, and the control looks it up, once.
 * A sentence the page builds around a value ("Filter by {{field}}") or a
 * front end's own keyed text (t("navbar.…"), t("pages.…")) cannot be: the
 * page puts it in the reader's words and says so - is<Prop>Translated:
 * isPlaceholderTranslated, isAriaLabelTranslated, isTitleTranslated - and
 * the control draws it as given (Forms/Types/Field's placeholder says why).
 *
 * The scan reads the pages and shared components (App/FeatureSet and
 * Common/UI) as TypeScript. Which components look a prop up it works out
 * from their code: a lookup call that is given the prop, or the prop handed
 * on, not looked up, to a component that does - followed through imports,
 * lazy imports, re-exports, forwardRef and memo. The texts it holds to the
 * rule: every placeholder and every aria label, wherever a control looks it
 * up; and any other prop of a component that offers is<Prop>Translated for
 * it - a component that can be told a text is in the reader's words has
 * every caller say whether it is (NavBarItem's title, the products menu's
 * words, PlaceholderText's text, Link's title). Then it reads every such
 * text written for one of them:
 *
 * - a JSX prop that is looked up - a lookup call in it, or a constant of
 *   the enclosing code built with one - and goes to a component that looks
 *   it up again, unless the element says is<Prop>Translated;
 * - the placeholder of a field (an object with a fieldType, or one of the
 *   fields written for a card or a form: FormField and a detail card each
 *   hand it to a control that looks it up), unless the field says
 *   isPlaceholderTranslated;
 * - a prop of an object written as a type that offers is<Prop>Translated
 *   for it (a nav bar's NavItem or MoreMenuItem and its title), unless the
 *   object says it;
 * - is<Prop>Translated beside English - a word written as it is, or a
 *   translationKey - which the control would draw untranslated;
 * - is<Prop>Translated worked out as the page runs beside a text looked up
 *   whichever way it comes out: false some of the time, and the control
 *   then looks the translation up again;
 * - is<Prop>Translated given to a component that never reads it, which
 *   would still look the text up again.
 */

export interface PlaceholderProblem {
  // The file and line, by its path from the packages folder.
  where: string;
  /*
   * Where the text goes: "<Input placeholder>", "<Button ariaLabel>", a
   * form field's or a detail field's placeholder, a MoreMenuItem's title.
   */
  handedTo: string;
  // The text's code, on one line.
  code: string;
  // What is wrong, and what to do instead.
  message: string;
}

// A text written for a control that looks it up.
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

/*
 * A file can look a text up twice, or say an English one is in the
 * reader's words, only where it looks one up, hands a helper the
 * translator, or names a flag. The files that do none of these are read
 * only when a page draws one of their components. Every placeholder is
 * still found, wherever it is written.
 */
const MAY_LOOK_UP: RegExp = new RegExp(
  [
    "laceholder",
    "Translated",
    `\\b(?:${LOOKUPS.join("|")})\\s*\\(`,
    `[(,]\\s*(?:${TRANSLATOR_ARGUMENTS.join("|")})\\s*[,)]`,
  ].join("|"),
);
const COMPONENT_NAME: RegExp = /^[A-Z]/;
const LETTER: RegExp = /\p{L}/u;
const ENDS_IN_PLACEHOLDER: RegExp = /^[a-z][A-Za-z]*Placeholder$/;
const ENDS_IN_ARIA_LABEL: RegExp = /^[a-z][A-Za-z]*AriaLabel$/;
const TRANSLATED_FLAG: RegExp = /^is([A-Z][A-Za-z]*)Translated$/;
const FLAG_WORDS: RegExp = /\bis[A-Z][A-Za-z]*Translated\b/g;
const DETAIL_FIELD_TYPE: RegExp = /\bFieldType\./;

// placeholder, and every prop that ends in Placeholder.
export function isPlaceholderProp(name: string): boolean {
  return name === "placeholder" || ENDS_IN_PLACEHOLDER.test(name);
}

// ariaLabel, and every prop that ends in AriaLabel (#7790).
export function isAriaLabelProp(name: string): boolean {
  return name === "ariaLabel" || ENDS_IN_ARIA_LABEL.test(name);
}

/*
 * The texts held to the rule wherever a control looks them up: the
 * placeholders and the aria labels. Any other prop is held to it where the
 * component offers is<Prop>Translated for it.
 */
function isHeldEverywhere(name: string): boolean {
  return isPlaceholderProp(name) || isAriaLabelProp(name);
}

// What says a prop's text is in the reader's words already.
export function translatedFlagOf(prop: string): string {
  return `is${prop.charAt(0).toUpperCase()}${prop.slice(1)}Translated`;
}

// The prop a flag speaks for: isTitleTranslated, title.
function propOfFlag(flag: string): string | null {
  const match: RegExpExecArray | null = TRANSLATED_FLAG.exec(flag);

  if (!match || !match[1]) {
    return null;
  }

  return `${match[1].charAt(0).toLowerCase()}${match[1].slice(1)}`;
}

type ComponentFunction =
  | ts.ArrowFunction
  | ts.FunctionExpression
  | ts.FunctionDeclaration;

interface Component {
  file: string;
  fn: ComponentFunction;
}

/*
 * A name in a file: a component or an interface of that file (by the file
 * and its name), another name of that file, or an import.
 */
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
 * The parts of a value its text can come from: all of it but what a ?:
 * asks or an && tests first. `isShortened ? button.title : undefined` is
 * the button's title, however isShortened was worked out.
 */
function forEachTextPart(node: ts.Node, visit: (part: ts.Node) => void): void {
  if (ts.isConditionalExpression(node)) {
    visit(node.whenTrue);
    visit(node.whenFalse);
    return;
  }

  if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
  ) {
    visit(node.right);
    return;
  }

  ts.forEachChild(node, visit);
}

/*
 * Whether a value is looked up: a lookup call in the parts its text comes
 * from, or a name there that the code around it built with one.
 */
function isLookedUpValue(value: ts.Node, at: ts.Node): boolean {
  let found: boolean = false;

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (found) {
      return;
    }

    if (isLookupCall(node)) {
      found = true;
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

    forEachTextPart(node, visit);
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

// An object literal's properties, by name.
function propertiesOf(
  node: ts.ObjectLiteralExpression,
  source: ts.SourceFile,
): Map<string, ts.ObjectLiteralElementLike> {
  const properties: Map<string, ts.ObjectLiteralElementLike> = new Map();

  for (const property of node.properties) {
    if (property.name) {
      properties.set(property.name.getText(source), property);
    }
  }

  return properties;
}

/*
 * Whether an expression's value is the node's own, as the code around it
 * passes it on: a branch of a ?:, the right of && || ??, an element or a
 * spread of an array, in brackets or cast.
 */
function passesOn(parent: ts.Node, node: ts.Node): boolean {
  return (
    ts.isParenthesizedExpression(parent) ||
    ts.isAsExpression(parent) ||
    ts.isSatisfiesExpression(parent) ||
    ts.isNonNullExpression(parent) ||
    ts.isSpreadElement(parent) ||
    ts.isArrayLiteralExpression(parent) ||
    (ts.isConditionalExpression(parent) && parent.condition !== node) ||
    (ts.isBinaryExpression(parent) && parent.right === node)
  );
}

/*
 * Whether an object is one of the fields written for a card or a form: an
 * element of an array written as the value of `fields` - a detail card's
 * (Detail, ModelDetail, a CardModelDetail's modelDetailProps), a list's, a
 * form's.
 */
function isWrittenAsField(
  node: ts.ObjectLiteralExpression,
  source: ts.SourceFile,
): boolean {
  let current: ts.Node = node;
  let isInArray: boolean = false;

  for (let depth: number = 0; depth < 10; depth++) {
    const parent: ts.Node | undefined = current.parent;

    if (!parent) {
      return false;
    }

    if (passesOn(parent, current)) {
      isInArray = isInArray || ts.isArrayLiteralExpression(parent);
      current = parent;
      continue;
    }

    if (ts.isPropertyAssignment(parent) && parent.initializer === current) {
      return isInArray && parent.name.getText(source) === "fields";
    }

    if (
      ts.isJsxExpression(parent) &&
      parent.parent &&
      ts.isJsxAttribute(parent.parent)
    ) {
      return isInArray && parent.parent.name.getText(source) === "fields";
    }

    return false;
  }

  return false;
}

// The name of the type a type node says its values, or its elements, are.
function elementTypeName(type: ts.TypeNode | undefined): string | null {
  if (!type) {
    return null;
  }

  if (ts.isParenthesizedTypeNode(type)) {
    return elementTypeName(type.type);
  }

  if (ts.isArrayTypeNode(type)) {
    return elementTypeName(type.elementType);
  }

  if (ts.isTypeOperatorNode(type)) {
    // readonly X[]
    return elementTypeName(type.type);
  }

  if (ts.isTypeReferenceNode(type)) {
    const name: string = ts.isIdentifier(type.typeName)
      ? type.typeName.text
      : type.typeName.right.text;

    if (
      (name === "Array" || name === "ReadonlyArray") &&
      type.typeArguments &&
      type.typeArguments[0]
    ) {
      return elementTypeName(type.typeArguments[0]);
    }

    return name;
  }

  return null;
}

/*
 * The type an object literal is written as: the type of the constant it is
 * (or is an element of), or the type it is cast to - `const items:
 * Array<MoreMenuItem> = [{ ... }]`, `{ ... } as MoreMenuItem`.
 */
function declaredTypeOf(node: ts.ObjectLiteralExpression): string | null {
  let current: ts.Node = node;

  for (let depth: number = 0; depth < 10; depth++) {
    const parent: ts.Node | undefined = current.parent;

    if (!parent) {
      return null;
    }

    if (
      (ts.isAsExpression(parent) || ts.isSatisfiesExpression(parent)) &&
      parent.expression === current
    ) {
      return elementTypeName(parent.type);
    }

    if (ts.isVariableDeclaration(parent) && parent.initializer === current) {
      return elementTypeName(parent.type);
    }

    if (passesOn(parent, current)) {
      current = parent;
      continue;
    }

    return null;
  }

  return null;
}

class PlaceholderScan {
  private readonly packagesDirectory: string;
  private readonly sources: Map<string, ts.SourceFile> = new Map();
  private readonly names: Map<string, FileNames> = new Map();
  private readonly components: Map<string, Component> = new Map();
  private readonly interfaces: Map<string, ts.InterfaceDeclaration> = new Map();
  private readonly uses: Map<string, PropUse> = new Map();
  private readonly endings: Map<string, boolean | null> = new Map();
  private readonly offerings: Map<string, boolean | null> = new Map();
  private readonly typeFlags: Map<string, Array<string>> = new Map();
  private readonly texts: Map<string, string> = new Map();
  private readonly modules: Map<string, string | null> = new Map();
  private readonly spreads: Map<string, Array<string>> = new Map();
  // The props some component can be told are in the reader's words.
  private readonly flaggedProps: Set<string> = new Set();

  public constructor(packagesDirectory: string) {
    this.packagesDirectory = packagesDirectory;
  }

  // A component's code, read once.
  private textOf(key: string, component: Component): string {
    let text: string | undefined = this.texts.get(key);

    if (text === undefined) {
      text = component.fn.getText();
      this.texts.set(key, text);
    }

    return text;
  }

  public scan(): PlaceholderScanResult {
    const problems: Array<PlaceholderProblem> = [];
    const sites: Array<PlaceholderSite> = [];

    const read: Array<{ file: string; text: string }> = [];

    for (const folder of SOURCE_FOLDERS) {
      for (const file of listSourceFiles(
        path.join(this.packagesDirectory, folder),
      )) {
        const text: string = fs.readFileSync(file, "utf8");

        if (!MAY_LOOK_UP.test(text)) {
          continue;
        }

        for (const match of text.matchAll(FLAG_WORDS)) {
          this.flaggedProps.add(propOfFlag(match[0])!);
        }

        read.push({ file, text });
      }
    }

    for (const { file, text } of read) {
      const source: ts.SourceFile = this.sourceOf(file, text)!;
      // A field's or a typed object's prop is read once.
      const seen: Set<ts.Node> = new Set();

      this.readJsxTexts(file, source, problems, sites);
      this.readFieldTexts(file, source, problems, sites, seen);
      this.readTypedObjectTexts(file, source, problems, sites, seen);
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

  private sourceOf(file: string, text?: string): ts.SourceFile | null {
    const cached: ts.SourceFile | undefined = this.sources.get(file);

    if (cached) {
      return cached;
    }

    if (text === undefined && !fs.existsSync(file)) {
      return null;
    }

    const source: ts.SourceFile = ts.createSourceFile(
      file,
      text ?? fs.readFileSync(file, "utf8"),
      {
        languageVersion: ts.ScriptTarget.Latest,
        // Nothing here reads a doc comment.
        jsDocParsingMode: ts.JSDocParsingMode.ParseNone,
      },
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

    // Every page imports the same few modules: each is found once.
    const known: string | null | undefined = this.modules.get(base);

    if (known !== undefined) {
      return known;
    }

    let found: string | null = null;

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
        found = candidate;
        break;
      }
    }

    this.modules.set(base, found);

    return found;
  }

  // Whether a file is one of the pages' or shared components' own.
  private isScanned(file: string): boolean {
    return SOURCE_FOLDERS.some((folder: string): boolean => {
      return file.startsWith(
        `${path.join(this.packagesDirectory, folder)}${path.sep}`,
      );
    });
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
      } else if (ts.isInterfaceDeclaration(statement)) {
        /*
         * An interface, by the same key a component would have: what an
         * object written as it may say (is<Prop>Translated).
         */
        const name: string = statement.name.text;
        const reference: NameReference = { component: `${file}#${name}` };

        this.interfaces.set(`${file}#${name}`, statement);

        if (!names.locals.has(name)) {
          names.locals.set(name, reference);
        }

        if (hasModifier(statement, ts.SyntaxKind.ExportKeyword)) {
          if (hasModifier(statement, ts.SyntaxKind.DefaultKeyword)) {
            names.defaultExport = names.defaultExport || reference;
          } else if (!names.named.has(name)) {
            names.named.set(name, reference);
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

  /*
   * Whether a component offers a flag: reads it as its own prop
   * (props.isTitleTranslated, or the name it is taken out as), or hands its
   * props on whole to a component that does. A component that can be told
   * a text is in the reader's words has every caller say whether it is.
   */
  private offers(key: string, flag: string, depth: number = 0): boolean {
    const id: string = `${key}|${flag}`;

    if (this.offerings.has(id)) {
      return Boolean(this.offerings.get(id));
    }

    // Not yet known: a component that hands the flag back round offers none.
    this.offerings.set(id, null);

    let isOffered: boolean = false;
    const component: Component | undefined = this.components.get(key);

    if (component?.fn.body) {
      // Its own: named in its code, and read as its prop.
      if (this.textOf(key, component).includes(flag)) {
        isOffered =
          this.propReferences(component, flag).containsReference(
            component.fn.body,
          ) ||
          this.useOf(key, flag).handedTo.some(
            (handed: { tag: string; as: string }): boolean => {
              const target: string | null = this.resolveTag(
                component.file,
                handed.tag,
              );

              return Boolean(
                target &&
                  depth < 8 &&
                  this.offers(target, handed.as, depth + 1),
              );
            },
          );
      }

      // Or its props handed on whole, to a component that offers it.
      if (!isOffered && depth < 8) {
        isOffered = this.spreadTargetsOf(key, component).some(
          (tag: string): boolean => {
            const target: string | null = this.resolveTag(component.file, tag);

            return Boolean(target && this.offers(target, flag, depth + 1));
          },
        );
      }
    }

    this.offerings.set(id, isOffered);

    return isOffered;
  }

  /*
   * The elements a component hands its props on to whole: <Input
   * {...props} />, or the rest of them (LazyFilePicker). Worked out once
   * for every prop.
   */
  private spreadTargetsOf(key: string, component: Component): Array<string> {
    const cached: Array<string> | undefined = this.spreads.get(key);

    if (cached) {
      return cached;
    }

    const targets: Array<string> = [];

    if (this.textOf(key, component).includes("{...")) {
      const source: ts.SourceFile = component.fn.getSourceFile();
      const references: PropReferences = this.propReferences(
        component,
        // No prop is named so: the props' own names, and their rest.
        "\u0000",
      );

      const visit: (node: ts.Node) => void = (node: ts.Node): void => {
        if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
          for (const attribute of node.attributes.properties) {
            if (
              ts.isJsxSpreadAttribute(attribute) &&
              ts.isIdentifier(attribute.expression) &&
              (references.propsNames.has(attribute.expression.text) ||
                references.restNames.has(attribute.expression.text))
            ) {
              targets.push(tagNameOf(node.tagName.getText(source), node));
            }
          }
        }

        ts.forEachChild(node, visit);
      };

      visit(component.fn.body!);
    }

    this.spreads.set(key, targets);

    return targets;
  }

  /*
   * The flags (is<Prop>Translated) an interface offers, its own and those
   * of the interfaces it extends: what an object written as it may say.
   * Only the pages' and shared components' own interfaces are read: the
   * data types and models are not drawn by a control.
   */
  private flagsOfType(
    file: string,
    name: string,
    depth: number = 0,
  ): Array<string> {
    const reference: NameReference | undefined =
      this.namesOf(file).locals.get(name);

    if (!reference || (reference.module && !this.isScanned(reference.module))) {
      return [];
    }

    const key: string | null = this.resolveReference(file, reference);

    if (!key) {
      return [];
    }

    const cached: Array<string> | undefined = this.typeFlags.get(key);

    if (cached) {
      return cached;
    }

    // Not yet known: an interface that extends itself round offers nothing.
    this.typeFlags.set(key, []);

    const declaration: ts.InterfaceDeclaration | undefined =
      this.interfaces.get(key);

    if (!declaration) {
      return [];
    }

    const flags: Set<string> = new Set();

    for (const member of declaration.members) {
      if (
        ts.isPropertySignature(member) &&
        ts.isIdentifier(member.name) &&
        propOfFlag(member.name.text)
      ) {
        flags.add(member.name.text);
      }
    }

    const declaredIn: string = key.split("#")[0]!;

    for (const clause of declaration.heritageClauses || []) {
      for (const base of clause.types) {
        if (ts.isIdentifier(base.expression) && depth < 8) {
          for (const flag of this.flagsOfType(
            declaredIn,
            base.expression.text,
            depth + 1,
          )) {
            flags.add(flag);
          }
        }
      }
    }

    const result: Array<string> = Array.from(flags).sort();

    this.typeFlags.set(key, result);

    return result;
  }

  private readJsxTexts(
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
          if (
            !attribute.initializer ||
            propOfFlag(prop) ||
            !(isHeldEverywhere(prop) || this.flaggedProps.has(prop))
          ) {
            continue;
          }

          const target: string | null = COMPONENT_NAME.test(tag)
            ? this.resolveTag(file, component)
            : null;

          if (!target) {
            continue;
          }

          const flag: string = translatedFlagOf(prop);

          /*
           * A placeholder or an aria label wherever it is looked up; any
           * other prop where the component offers its flag.
           */
          if (!isHeldEverywhere(prop) && !this.offers(target, flag)) {
            continue;
          }

          if (!this.endsInLookup(target, prop)) {
            continue;
          }
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
   * A field's placeholders: FormField hands a form field's to a control
   * that looks it up (Forms/Types/Field), and a detail card hands a detail
   * field's, for an empty value, to PlaceholderText, which looks it up
   * (Detail/Field, #7791). A field is an object with a fieldType - a
   * FormFieldSchemaType for a form, a FieldType for a card - or one of the
   * fields written for a card or a form, which may leave its type out.
   */
  private readFieldTexts(
    file: string,
    source: ts.SourceFile,
    problems: Array<PlaceholderProblem>,
    sites: Array<PlaceholderSite>,
    seen: Set<ts.Node>,
  ): void {
    const visit: (node: ts.Node) => void = (node: ts.Node): void => {
      if (ts.isObjectLiteralExpression(node)) {
        const properties: Map<string, ts.ObjectLiteralElementLike> =
          propertiesOf(node, source);
        const fieldType: ts.ObjectLiteralElementLike | undefined =
          properties.get("fieldType");
        const fieldTypeText: string = fieldType
          ? fieldType.getText(source)
          : "";

        if (fieldType || isWrittenAsField(node, source)) {
          // A field that leaves its type out is either.
          const kind: string = fieldTypeText.includes("FormFieldSchemaType")
            ? "a form field's"
            : DETAIL_FIELD_TYPE.test(fieldTypeText)
              ? "a detail field's"
              : "a field's";

          for (const [prop, property] of properties) {
            if (isPlaceholderProp(prop) && !seen.has(property)) {
              seen.add(property);
              this.readObjectText(
                file,
                source,
                prop,
                property,
                properties.get(translatedFlagOf(prop)),
                `${kind} ${prop}`,
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

  /*
   * An object written as a type that offers is<Prop>Translated for a prop
   * (a nav bar's NavItem and MoreMenuItem, isTitleTranslated): the nav bar
   * looks the prop up unless the object says it is in the reader's words.
   */
  private readTypedObjectTexts(
    file: string,
    source: ts.SourceFile,
    problems: Array<PlaceholderProblem>,
    sites: Array<PlaceholderSite>,
    seen: Set<ts.Node>,
  ): void {
    const visit: (node: ts.Node) => void = (node: ts.Node): void => {
      if (ts.isObjectLiteralExpression(node)) {
        const typeName: string | null = declaredTypeOf(node);
        const flags: Array<string> = typeName
          ? this.flagsOfType(file, typeName)
          : [];

        if (flags.length > 0) {
          const properties: Map<string, ts.ObjectLiteralElementLike> =
            propertiesOf(node, source);

          for (const flag of flags) {
            const prop: string = propOfFlag(flag)!;
            const property: ts.ObjectLiteralElementLike | undefined =
              properties.get(prop);

            if (property && !seen.has(property)) {
              seen.add(property);
              this.readObjectText(
                file,
                source,
                prop,
                property,
                properties.get(flag),
                `a ${typeName}'s ${prop}`,
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

  // A text an object says, and whether it says it is in the reader's words.
  private readObjectText(
    file: string,
    source: ts.SourceFile,
    prop: string,
    property: ts.ObjectLiteralElementLike,
    flagProperty: ts.ObjectLiteralElementLike | undefined,
    handedTo: string,
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
 * Every text the pages and shared components under a packages folder write
 * for a control that looks it up - a placeholder, an aria label, a text of
 * a component that offers is<Prop>Translated for it - and what is wrong
 * with each.
 */
export function scanPlaceholders(
  packagesDirectory: string,
): PlaceholderScanResult {
  return new PlaceholderScan(packagesDirectory).scan();
}
