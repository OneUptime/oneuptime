import path from "path";
import ts from "typescript";
import { CONTROL_ROLES, SINGLE_CONTROL_ROLES } from "./NestedControls";

/*
 * The detector behind the nested-controls guard
 * (Tests/UI/Components/NestedControlsGuard.test.ts).
 *
 * The maintainer's ask, from a dropdown whose Clear button sat inside its
 * value button: "find similar issues across the project and fix them as
 * well". A control drawn inside another control - a button inside a button, a
 * clear "x" span acting as a button inside a filter chip's button, a Delete
 * button inside a header that is itself role="button" - is lost to a screen
 * reader, which reads the outer control's content as its name and offers
 * nothing inside it (see NestedControls.ts), and a button inside a button is
 * invalid HTML that React warns about.
 *
 * Read per module, through the TypeScript AST (a "<button" in a comment or a
 * string is not one), so it sees what one file draws:
 *
 *   - One control, whose content is its name (the outer one): <button>, <a>,
 *     an element given one of SINGLE_CONTROL_ROLES (role="button",
 *     role="option", role="tab" ...), the shared Button and Link components,
 *     and every component that is one of these (below).
 *   - Any control (the inner one): <button>, <a>, <input> (unless
 *     type="hidden"), <select>, <textarea>, an element given one of
 *     CONTROL_ROLES or a tabIndex of 0 or more (or one that is worked out at
 *     run time), an element spread with a drag library's dragHandleProps
 *     (role="button", tabIndex 0), the shared components whose control sits
 *     deeper inside them (CONTROL_COMPONENT_PATHS), and every component that
 *     is a control (below).
 *
 * A COMPONENT THAT IS A CONTROL, LEARNED FROM ITS OWN SOURCE (#10015). The
 * OpenStack Regions card drew a region's (i) - InfoTooltip, which draws a
 * <button> - inside the row's whole-row link, and the guard never saw it:
 * it knew a hand-written list of shared components, and InfoTooltip, the
 * attention pills, AppLink and some hundred more were not on it. Now the
 * guard reads every module first (buildComponentControlIndex): a component
 * whose own JSX is a control - what it returns, through fragments, context
 * providers and the shared Tooltip, which draw nothing of their own - is a
 * control wherever it is drawn, and one control around what it is given
 * when what it returns is one (a link, a button). A component drawn by a
 * component is followed through its imports (ResourceHealthPill draws
 * ResourceAttentionPill, which draws a <button>), and so is one a module
 * keeps to itself. ResourcePartRow is a link only when it is handed `to`
 * and not `hasControls` (CONDITIONAL_SINGLE_CONTROL_COMPONENTS): with
 * `hasControls` its name is the link and its controls sit beside it.
 *
 * Only what is written between an element's tags counts as inside it: JSX
 * passed in an attribute, or handed to createPortal (drawn elsewhere in the
 * page), does not. A component whose control sits deeper inside it than
 * what it returns (a card that draws its buttons when it is handed them)
 * cannot be told from here; the components' own tests check their rendered
 * DOM with findNestedControls.
 */

export interface NestedControlInSource {
  file: string;
  // The inner control's line.
  line: number;
  // How the two elements are written: `button`, `div[role=button]`, `Button`.
  outer: string;
  inner: string;
}

/*
 * Shared components that draw a control, by the module path they are imported
 * from (its end). Their default export is the component. Most of these draw
 * their control inside a box of their own (a picker, a switch, a field), so
 * reading what they return does not find it; a component whose JSX is its
 * control needs no entry here (buildComponentControlIndex learns it).
 */
export const CONTROL_COMPONENT_PATHS: ReadonlyArray<string> = [
  "Button/Button",
  "Checkbox/Checkbox",
  "CopyTextButton/CopyTextButton",
  "Dropdown/Dropdown",
  "EntityDropdown/EntityDropdown",
  "Input/Input",
  "Link/Link",
  "MoreMenu/MoreMenu",
  "TextArea/TextArea",
  "Toggle/Toggle",
];

// Of those, the ones that are one control around what they are given.
export const SINGLE_CONTROL_COMPONENT_PATHS: ReadonlyArray<string> = [
  "Button/Button",
  "Link/Link",
];

/*
 * Components that are one control around what they are given only when
 * handed certain props: ResourcePartRow is the row's link when it is handed
 * `to`, unless it holds controls of its own (`hasControls`): then its name
 * is the link (ResourcePartRowName) and its controls sit beside the name
 * (#9728).
 */
export interface ConditionalSingleControl {
  // The end of the module path it is imported from.
  path: string;
  // The export it is: "default", or a named export's name.
  exportName: string;
  isSingleControl: (attributes: ReadonlyMap<string, string | null>) => boolean;
}

export const CONDITIONAL_SINGLE_CONTROL_COMPONENTS: ReadonlyArray<ConditionalSingleControl> =
  [
    {
      path: "ResourcePart/ResourcePartRow",
      exportName: "default",
      isSingleControl: (
        attributes: ReadonlyMap<string, string | null>,
      ): boolean => {
        if (!attributes.has("to")) {
          return false;
        }
        // hasControls, hasControls={true} or worked out at run time: its name is the link.
        return attributes.has("hasControls")
          ? attributes.get("hasControls") === "false"
          : true;
      },
    },
  ];

/*
 * Components that draw what they are handed and nothing of their own: what
 * they wrap is what they draw. The shared Tooltip shows its words on hover
 * around the one element it is given.
 */
const TRANSPARENT_COMPONENT_PATHS: ReadonlyArray<string> = ["Tooltip/Tooltip"];

// A router's links: named imports from react-router.
const ROUTER_LINK_NAMES: ReadonlyArray<string> = ["Link", "NavLink"];

const CONTROL_TAGS: ReadonlyArray<string> = [
  "a",
  "button",
  "input",
  "select",
  "textarea",
];

const SINGLE_CONTROL_TAGS: ReadonlyArray<string> = ["a", "button"];

// A plain element (button, div), not a component (Button, Link).
const INTRINSIC_TAG: RegExp = /^[a-z]/;

// A component's name: what a JSX tag of one is written with.
const COMPONENT_NAME: RegExp = /^[A-Z]/;

// What a drag library hands a drag handle: role="button" and tabIndex 0.
const DRAG_HANDLE_SPREAD: RegExp = /dragHandleProps$/;

// createPortal(...) or ReactDOM.createPortal(...).
const CREATE_PORTAL_CALLEE: RegExp = /(^|\.)createPortal$/;

// Where "Common/..." imports point, from the repository's root.
const COMMON_ALIAS: string = "Common/";
const COMMON_PATH: string = "packages/Common/";

const MODULE_EXTENSIONS: ReadonlyArray<string> = [
  ".tsx",
  ".ts",
  "/index.tsx",
  "/index.ts",
];

function lineOf(sourceFile: ts.SourceFile, node: ts.Node): number {
  return (
    sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
  );
}

function parse(fileName: string, sourceText: string): ts.SourceFile {
  return ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

function matchesPath(
  specifier: string,
  suffixes: ReadonlyArray<string>,
): boolean {
  return suffixes.some((suffix: string): boolean => {
    return specifier === suffix || specifier.endsWith(`/${suffix}`);
  });
}

/*
 * Whether an import is of a module whose path ends in one of `suffixes`: as
 * it is written ("Common/UI/Components/Tooltip/Tooltip"), or as it resolves
 * ("./Tooltip", from beside it).
 */
function isBindingOf(
  binding: { specifier: string; module: string | null },
  suffixes: ReadonlyArray<string>,
): boolean {
  return (
    matchesPath(binding.specifier, suffixes) ||
    Boolean(binding.module && matchesPath(binding.module, suffixes))
  );
}

/*
 * The local names of the default exports of modules whose path ends in one
 * of `suffixes`.
 */
function importedDefaultNames(
  sourceFile: ts.SourceFile,
  suffixes: ReadonlyArray<string>,
): Set<string> {
  const names: Set<string> = new Set<string>();

  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      continue;
    }

    if (!matchesPath(statement.moduleSpecifier.text, suffixes)) {
      continue;
    }

    const defaultName: ts.Identifier | undefined = statement.importClause?.name;

    if (defaultName) {
      names.add(defaultName.text);
    }
  }

  return names;
}

// The local names given to react-router's Link and NavLink.
function importedRouterLinkNames(sourceFile: ts.SourceFile): Set<string> {
  const names: Set<string> = new Set<string>();

  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      !statement.moduleSpecifier.text.startsWith("react-router")
    ) {
      continue;
    }

    const bindings: ts.NamedImportBindings | undefined =
      statement.importClause?.namedBindings;

    if (!bindings || !ts.isNamedImports(bindings)) {
      continue;
    }

    for (const element of bindings.elements) {
      const importedName: string = (element.propertyName || element.name).text;

      if (ROUTER_LINK_NAMES.includes(importedName)) {
        names.add(element.name.text);
      }
    }
  }

  return names;
}

interface ElementFacts {
  tagName: string;
  /*
   * The attribute's literal text, `true` for a bare attribute, or null when
   * it is worked out at run time.
   */
  attributes: Map<string, string | null>;
  spreads: Array<string>;
}

function factsOf(
  element: ts.JsxOpeningLikeElement,
  sourceFile: ts.SourceFile,
): ElementFacts {
  const facts: ElementFacts = {
    tagName: element.tagName.getText(sourceFile),
    attributes: new Map<string, string | null>(),
    spreads: [],
  };

  for (const property of element.attributes.properties) {
    if (ts.isJsxSpreadAttribute(property)) {
      facts.spreads.push(property.expression.getText(sourceFile));
      continue;
    }

    const name: string = property.name.getText(sourceFile);

    if (!property.initializer) {
      facts.attributes.set(name, "true");
      continue;
    }

    if (ts.isStringLiteral(property.initializer)) {
      facts.attributes.set(name, property.initializer.text);
      continue;
    }

    if (
      ts.isJsxExpression(property.initializer) &&
      property.initializer.expression
    ) {
      const expression: ts.Expression = property.initializer.expression;

      if (
        ts.isStringLiteral(expression) ||
        ts.isNoSubstitutionTemplateLiteral(expression)
      ) {
        facts.attributes.set(name, expression.text);
        continue;
      }

      if (ts.isNumericLiteral(expression)) {
        facts.attributes.set(name, expression.text);
        continue;
      }

      if (expression.kind === ts.SyntaxKind.TrueKeyword) {
        facts.attributes.set(name, "true");
        continue;
      }

      if (expression.kind === ts.SyntaxKind.FalseKeyword) {
        facts.attributes.set(name, "false");
        continue;
      }

      if (
        ts.isPrefixUnaryExpression(expression) &&
        expression.operator === ts.SyntaxKind.MinusToken &&
        ts.isNumericLiteral(expression.operand)
      ) {
        facts.attributes.set(name, `-${expression.operand.text}`);
        continue;
      }
    }

    facts.attributes.set(name, null);
  }

  return facts;
}

// `button`, `div[role=option]`, `Button`: how an element reads in a report.
function describe(facts: ElementFacts): string {
  const role: string | null | undefined = facts.attributes.get("role");

  if (INTRINSIC_TAG.test(facts.tagName) && role) {
    return `${facts.tagName}[role=${role}]`;
  }

  return facts.tagName;
}

function isIntrinsicSingleControl(facts: ElementFacts): boolean {
  const role: string | null | undefined = facts.attributes.get("role");

  if (role === "presentation" || role === "none") {
    return false;
  }

  if (role && SINGLE_CONTROL_ROLES.includes(role)) {
    return true;
  }

  return SINGLE_CONTROL_TAGS.includes(facts.tagName) && !role;
}

function isIntrinsicControl(facts: ElementFacts): boolean {
  const role: string | null | undefined = facts.attributes.get("role");

  if (role === "presentation" || role === "none") {
    return false;
  }

  if (role && CONTROL_ROLES.includes(role)) {
    return true;
  }

  if (CONTROL_TAGS.includes(facts.tagName)) {
    return !(
      facts.tagName === "input" && facts.attributes.get("type") === "hidden"
    );
  }

  if (
    facts.spreads.some((spread: string): boolean => {
      return DRAG_HANDLE_SPREAD.test(spread);
    })
  ) {
    return true;
  }

  if (!facts.attributes.has("tabIndex")) {
    return false;
  }

  const tabIndex: string | null | undefined = facts.attributes.get("tabIndex");

  // Worked out at run time: it may well put the element in the Tab order.
  if (tabIndex === null || tabIndex === undefined) {
    return true;
  }

  return Number(tabIndex) >= 0;
}

function isCreatePortalCall(node: ts.Node, sourceFile: ts.SourceFile): boolean {
  return (
    ts.isCallExpression(node) &&
    CREATE_PORTAL_CALLEE.test(node.expression.getText(sourceFile))
  );
}

/*
 * ---------------------------------------------------------------------------
 * Which components are controls, from their own source
 * ---------------------------------------------------------------------------
 */

// What a component is to the guard: one control around what it is given, or a control.
export enum ComponentControlKind {
  Control = "control",
  SingleControl = "single control",
}

function strongest(
  a: ComponentControlKind | null,
  b: ComponentControlKind | null,
): ComponentControlKind | null {
  if (
    a === ComponentControlKind.SingleControl ||
    b === ComponentControlKind.SingleControl
  ) {
    return ComponentControlKind.SingleControl;
  }
  return a || b;
}

type FunctionNode =
  | ts.ArrowFunction
  | ts.FunctionExpression
  | ts.FunctionDeclaration;

export interface ImportedBinding {
  specifier: string;
  // The module it resolves to in the scan, by its file without extension.
  module: string | null;
  // "default", or the name the module exports it by.
  exportName: string;
}

export interface ModuleFacts {
  file: string;
  sourceFile: ts.SourceFile;
  imports: Map<string, ImportedBinding>;
  // Every function component the module defines, by its local name.
  components: Map<string, FunctionNode>;
  // The local name each export is, by its exported name ("default" too).
  exports: Map<string, string>;
}

// A file of the scan, as a key: forward slashes, no extension.
function moduleKey(file: string): string {
  return file
    .split(path.sep)
    .join("/")
    .replace(/(\/index)?\.(tsx|ts)$/, "");
}

function resolveSpecifier(
  fromFile: string,
  specifier: string,
  known: ReadonlySet<string>,
): string | null {
  let target: string | null = null;

  if (specifier.startsWith(COMMON_ALIAS)) {
    target = `${COMMON_PATH}${specifier.slice(COMMON_ALIAS.length)}`;
  } else if (specifier.startsWith(".")) {
    target = path.posix.join(
      path.posix.dirname(fromFile.split(path.sep).join("/")),
      specifier,
    );
  }

  if (!target) {
    return null;
  }

  const key: string = moduleKey(target);
  if (known.has(key)) {
    return key;
  }
  for (const extension of MODULE_EXTENSIONS) {
    const candidate: string = moduleKey(`${target}${extension}`);
    if (known.has(candidate)) {
      return candidate;
    }
  }
  return null;
}

// The function a declaration's initializer is: `(props) => ...`, `memo((props) => ...)`.
function functionOf(
  expression: ts.Expression | undefined,
): FunctionNode | null {
  if (!expression) {
    return null;
  }
  if (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)) {
    return expression;
  }
  if (ts.isParenthesizedExpression(expression)) {
    return functionOf(expression.expression);
  }
  if (
    ts.isCallExpression(expression) &&
    expression.arguments.length > 0 &&
    !ts.isIdentifier(expression.arguments[0]!)
  ) {
    // React.memo(...), forwardRef(...): the component is what they wrap.
    return functionOf(expression.arguments[0]);
  }
  return null;
}

function hasExportModifier(node: ts.Node): boolean {
  return Boolean(
    ts.canHaveModifiers(node) &&
      ts.getModifiers(node)?.some((modifier: ts.Modifier): boolean => {
        return modifier.kind === ts.SyntaxKind.ExportKeyword;
      }),
  );
}

function hasDefaultModifier(node: ts.Node): boolean {
  return Boolean(
    ts.canHaveModifiers(node) &&
      ts.getModifiers(node)?.some((modifier: ts.Modifier): boolean => {
        return modifier.kind === ts.SyntaxKind.DefaultKeyword;
      }),
  );
}

function readModuleFacts(
  file: string,
  sourceFile: ts.SourceFile,
  known: ReadonlySet<string>,
): ModuleFacts {
  const facts: ModuleFacts = {
    file: file,
    sourceFile: sourceFile,
    imports: new Map<string, ImportedBinding>(),
    components: new Map<string, FunctionNode>(),
    exports: new Map<string, string>(),
  };

  for (const statement of sourceFile.statements) {
    if (
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      const specifier: string = statement.moduleSpecifier.text;
      const module: string | null = resolveSpecifier(file, specifier, known);
      const clause: ts.ImportClause | undefined = statement.importClause;
      if (clause?.name) {
        facts.imports.set(clause.name.text, {
          specifier: specifier,
          module: module,
          exportName: "default",
        });
      }
      const bindings: ts.NamedImportBindings | undefined =
        clause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          facts.imports.set(element.name.text, {
            specifier: specifier,
            module: module,
            exportName: (element.propertyName || element.name).text,
          });
        }
      }
      continue;
    }

    if (ts.isFunctionDeclaration(statement) && statement.name) {
      const name: string = statement.name.text;
      if (COMPONENT_NAME.test(name)) {
        facts.components.set(name, statement);
      }
      if (hasExportModifier(statement)) {
        facts.exports.set(
          hasDefaultModifier(statement) ? "default" : name,
          name,
        );
      }
      continue;
    }

    if (ts.isVariableStatement(statement)) {
      const isExported: boolean = hasExportModifier(statement);
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) {
          continue;
        }
        const name: string = declaration.name.text;
        const component: FunctionNode | null = functionOf(
          declaration.initializer,
        );
        if (component && COMPONENT_NAME.test(name)) {
          facts.components.set(name, component);
        }
        if (isExported) {
          facts.exports.set(name, name);
        }
      }
      continue;
    }

    if (
      ts.isExportAssignment(statement) &&
      !statement.isExportEquals &&
      ts.isIdentifier(statement.expression)
    ) {
      facts.exports.set("default", statement.expression.text);
      continue;
    }

    if (
      ts.isExportDeclaration(statement) &&
      !statement.moduleSpecifier &&
      statement.exportClause &&
      ts.isNamedExports(statement.exportClause)
    ) {
      for (const element of statement.exportClause.elements) {
        facts.exports.set(
          element.name.text,
          (element.propertyName || element.name).text,
        );
      }
    }
  }

  return facts;
}

/*
 * Every module the guard reads, and what each of their components is: a
 * control, one control around what it is given, or neither. Worked out on
 * demand and kept.
 */
export class ComponentControlIndex {
  private readonly modules: Map<string, ModuleFacts> = new Map();
  private readonly sourceFiles: Map<string, ts.SourceFile> = new Map();
  private readonly kinds: Map<string, ComponentControlKind | null> = new Map();
  private readonly drawnProps: Map<string, Set<string>> = new Map();
  private readonly visiting: Set<string> = new Set();

  private readonly known: Set<string>;

  public constructor(
    modules: ReadonlyArray<{ file: string; sourceText: string }>,
  ) {
    this.known = new Set<string>(
      modules.map((module: { file: string }): string => {
        return moduleKey(module.file);
      }),
    );
    for (const module of modules) {
      const sourceFile: ts.SourceFile = parse(module.file, module.sourceText);
      this.sourceFiles.set(module.file, sourceFile);
      this.modules.set(
        moduleKey(module.file),
        readModuleFacts(module.file, sourceFile, this.known),
      );
    }
  }

  /*
   * What a module the index did not read imports and defines, its imports
   * resolved against the modules it did: a file planted beside the real
   * components, by a test.
   */
  public readModule(file: string, sourceFile: ts.SourceFile): ModuleFacts {
    return readModuleFacts(file, sourceFile, this.known);
  }

  // The module's parsed source, when the index read it.
  public getSourceFile(file: string): ts.SourceFile | undefined {
    return this.sourceFiles.get(file);
  }

  // What the index read of a module: its imports, components and exports.
  public getModuleFacts(file: string): ModuleFacts | undefined {
    return this.modules.get(moduleKey(file));
  }

  // What `localName`, as `file` names it, is: by its import, or its own definition.
  public getKindOfName(
    file: string,
    localName: string,
  ): ComponentControlKind | null {
    const module: ModuleFacts | undefined = this.modules.get(moduleKey(file));
    if (!module) {
      return null;
    }
    return this.kindOfLocal(module, localName);
  }

  // What a module's export is: by its file (any extension) and exported name.
  public getKindOfExport(
    file: string,
    exportName: string,
  ): ComponentControlKind | null {
    const module: ModuleFacts | undefined = this.modules.get(moduleKey(file));
    if (!module) {
      return null;
    }
    const localName: string | undefined = module.exports.get(exportName);
    return localName ? this.kindOfLocal(module, localName) : null;
  }

  // Every exported component that is a control: `file#export` and what it is.
  public listControls(): Array<{
    component: string;
    kind: ComponentControlKind;
  }> {
    const found: Array<{ component: string; kind: ComponentControlKind }> = [];
    for (const [key, module] of this.modules.entries()) {
      for (const exportName of module.exports.keys()) {
        const kind: ComponentControlKind | null = this.getKindOfExport(
          key,
          exportName,
        );
        if (kind) {
          found.push({ component: `${key}#${exportName}`, kind: kind });
        }
      }
    }
    return found;
  }

  private kindOfLocal(
    module: ModuleFacts,
    localName: string,
  ): ComponentControlKind | null {
    const found: {
      module: ModuleFacts;
      name: string;
      component: FunctionNode;
    } | null = this.definitionOf(module, localName, new Set<string>());
    return found
      ? this.kindOfComponent(found.module, found.name, found.component)
      : null;
  }

  // Where the component a module names `localName` is defined: here, or where an import leads.
  private definitionOf(
    module: ModuleFacts,
    localName: string,
    seen: Set<string>,
  ): { module: ModuleFacts; name: string; component: FunctionNode } | null {
    const key: string = `${moduleKey(module.file)}#${localName}`;
    if (seen.has(key)) {
      return null;
    }
    seen.add(key);
    const component: FunctionNode | undefined =
      module.components.get(localName);
    if (component) {
      return { module: module, name: localName, component: component };
    }
    const binding: ImportedBinding | undefined = module.imports.get(localName);
    if (!binding || !binding.module) {
      return null;
    }
    const target: ModuleFacts | undefined = this.modules.get(binding.module);
    if (!target) {
      return null;
    }
    const targetLocal: string | undefined = target.exports.get(
      binding.exportName,
    );
    return targetLocal ? this.definitionOf(target, targetLocal, seen) : null;
  }

  /*
   * The props a component that is one control draws inside it, besides what
   * is written between its tags: a Button's `title`, a pill's `label`. JSX
   * handed in one of them is drawn inside the control as surely as JSX
   * written between its tags.
   */
  public getDrawnProps(module: ModuleFacts, localName: string): Set<string> {
    const found: {
      module: ModuleFacts;
      name: string;
      component: FunctionNode;
    } | null = this.definitionOf(module, localName, new Set<string>());
    if (!found) {
      return new Set<string>();
    }
    const key: string = `${moduleKey(found.module.file)}#${found.name}`;
    const known: Set<string> | undefined = this.drawnProps.get(key);
    if (known) {
      return known;
    }
    const drawn: Set<string> = new Set<string>();
    this.drawnProps.set(key, drawn);
    const aliases: Map<string, Set<string>> = propAliases(found.component);
    for (const returned of returnedExpressions(found.component)) {
      for (const control of this.rootSingleControls(found.module, returned)) {
        for (const child of control.children) {
          for (const name of referencedProps(child, aliases)) {
            drawn.add(name);
          }
        }
      }
    }
    // What is written between its tags is drawn already (the walk's own rule).
    drawn.delete("children");
    return drawn;
  }

  // The elements a returned expression is, at its root, that are one control each.
  private rootSingleControls(
    module: ModuleFacts,
    node: ts.Node,
  ): Array<ts.JsxElement> {
    if (ts.isParenthesizedExpression(node)) {
      return this.rootSingleControls(module, node.expression);
    }
    if (ts.isConditionalExpression(node)) {
      return [
        ...this.rootSingleControls(module, node.whenTrue),
        ...this.rootSingleControls(module, node.whenFalse),
      ];
    }
    if (ts.isBinaryExpression(node)) {
      return [
        ...this.rootSingleControls(module, node.left),
        ...this.rootSingleControls(module, node.right),
      ];
    }
    if (ts.isJsxExpression(node)) {
      return node.expression
        ? this.rootSingleControls(module, node.expression)
        : [];
    }
    if (ts.isJsxFragment(node)) {
      return node.children.flatMap(
        (child: ts.JsxChild): Array<ts.JsxElement> => {
          return this.rootSingleControls(module, child);
        },
      );
    }
    if (!ts.isJsxElement(node)) {
      return [];
    }
    const facts: ElementFacts = factsOf(node.openingElement, module.sourceFile);
    if (
      facts.tagName === "Fragment" ||
      facts.tagName === "React.Fragment" ||
      facts.tagName.endsWith(".Provider") ||
      this.isImportedFrom(module, facts.tagName, TRANSPARENT_COMPONENT_PATHS)
    ) {
      return node.children.flatMap(
        (child: ts.JsxChild): Array<ts.JsxElement> => {
          return this.rootSingleControls(module, child);
        },
      );
    }
    const kind: ComponentControlKind | null = INTRINSIC_TAG.test(facts.tagName)
      ? isIntrinsicSingleControl(facts)
        ? ComponentControlKind.SingleControl
        : null
      : kindOfComponentElement(module, facts, this);
    return kind === ComponentControlKind.SingleControl ? [node] : [];
  }

  private kindOfComponent(
    module: ModuleFacts,
    localName: string,
    component: FunctionNode,
  ): ComponentControlKind | null {
    const key: string = `${moduleKey(module.file)}#${localName}`;
    if (this.kinds.has(key)) {
      return this.kinds.get(key) || null;
    }
    // A component that draws itself, through others or on its own, is no control by that.
    if (this.visiting.has(key)) {
      return null;
    }
    this.visiting.add(key);

    let kind: ComponentControlKind | null = null;
    for (const returned of returnedExpressions(component)) {
      kind = strongest(kind, this.kindOfJsx(module, returned));
    }

    this.visiting.delete(key);
    this.kinds.set(key, kind);
    return kind;
  }

  // What a returned JSX expression is, at its root.
  private kindOfJsx(
    module: ModuleFacts,
    node: ts.Node,
  ): ComponentControlKind | null {
    if (ts.isParenthesizedExpression(node)) {
      return this.kindOfJsx(module, node.expression);
    }
    if (ts.isConditionalExpression(node)) {
      return strongest(
        this.kindOfJsx(module, node.whenTrue),
        this.kindOfJsx(module, node.whenFalse),
      );
    }
    if (ts.isBinaryExpression(node)) {
      const operator: ts.SyntaxKind = node.operatorToken.kind;
      if (operator === ts.SyntaxKind.AmpersandAmpersandToken) {
        return this.kindOfJsx(module, node.right);
      }
      if (
        operator === ts.SyntaxKind.BarBarToken ||
        operator === ts.SyntaxKind.QuestionQuestionToken
      ) {
        return strongest(
          this.kindOfJsx(module, node.left),
          this.kindOfJsx(module, node.right),
        );
      }
      return null;
    }
    if (ts.isJsxExpression(node)) {
      return node.expression ? this.kindOfJsx(module, node.expression) : null;
    }
    if (ts.isJsxFragment(node)) {
      return this.kindOfChildren(module, node.children);
    }
    if (!ts.isJsxElement(node) && !ts.isJsxSelfClosingElement(node)) {
      return null;
    }

    const opening: ts.JsxOpeningLikeElement = ts.isJsxElement(node)
      ? node.openingElement
      : node;
    const facts: ElementFacts = factsOf(opening, module.sourceFile);
    const children: ts.NodeArray<ts.JsxChild> | null = ts.isJsxElement(node)
      ? node.children
      : null;

    if (INTRINSIC_TAG.test(facts.tagName)) {
      if (isIntrinsicSingleControl(facts)) {
        return ComponentControlKind.SingleControl;
      }
      return isIntrinsicControl(facts) ? ComponentControlKind.Control : null;
    }

    // Draws what it wraps: a fragment, a context's provider, the shared Tooltip.
    if (
      facts.tagName === "Fragment" ||
      facts.tagName === "React.Fragment" ||
      facts.tagName.endsWith(".Provider") ||
      this.isImportedFrom(module, facts.tagName, TRANSPARENT_COMPONENT_PATHS)
    ) {
      return children ? this.kindOfChildren(module, children) : null;
    }

    return kindOfComponentElement(module, facts, this);
  }

  private kindOfChildren(
    module: ModuleFacts,
    children: ts.NodeArray<ts.JsxChild>,
  ): ComponentControlKind | null {
    let kind: ComponentControlKind | null = null;
    for (const child of children) {
      if (ts.isJsxText(child)) {
        continue;
      }
      kind = strongest(kind, this.kindOfJsx(module, child));
    }
    return kind;
  }

  private isImportedFrom(
    module: ModuleFacts,
    localName: string,
    suffixes: ReadonlyArray<string>,
  ): boolean {
    const binding: ImportedBinding | undefined = module.imports.get(localName);
    return Boolean(binding && isBindingOf(binding, suffixes));
  }

  // Exposed for kindOfComponentElement: a name as a module names it.
  public kindOfLocalName(
    module: ModuleFacts,
    localName: string,
  ): ComponentControlKind | null {
    return this.kindOfLocal(module, localName);
  }
}

/*
 * How a component's body names its props: the object (`props`), and the
 * names it takes them by - destructured (`{ title, label: words }`), or a
 * local worked out from them (`const label = props.label || "..."`).
 */
interface PropAliases {
  propsObject: string | null;
  names: Map<string, Set<string>>;
}

function propsReadBy(expression: ts.Node, aliases: PropAliases): Set<string> {
  const found: Set<string> = new Set<string>();
  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === aliases.propsObject
    ) {
      found.add(node.name.text);
      return;
    }
    if (ts.isIdentifier(node)) {
      for (const name of aliases.names.get(node.text) || []) {
        found.add(name);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(expression);
  return found;
}

function addBindingNames(
  pattern: ts.ObjectBindingPattern,
  names: Map<string, Set<string>>,
): void {
  for (const element of pattern.elements) {
    if (!ts.isIdentifier(element.name)) {
      continue;
    }
    const prop: string =
      element.propertyName && ts.isIdentifier(element.propertyName)
        ? element.propertyName.text
        : element.name.text;
    names.set(element.name.text, new Set<string>([prop]));
  }
}

function propAliases(component: FunctionNode): PropAliases {
  const aliases: PropAliases = {
    propsObject: null,
    names: new Map<string, Set<string>>(),
  };
  const parameter: ts.ParameterDeclaration | undefined =
    component.parameters[0];
  if (parameter && ts.isIdentifier(parameter.name)) {
    aliases.propsObject = parameter.name.text;
  } else if (parameter && ts.isObjectBindingPattern(parameter.name)) {
    addBindingNames(parameter.name, aliases.names);
  }

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && node.initializer) {
      if (
        ts.isObjectBindingPattern(node.name) &&
        ts.isIdentifier(node.initializer) &&
        node.initializer.text === aliases.propsObject
      ) {
        addBindingNames(node.name, aliases.names);
      } else if (ts.isIdentifier(node.name)) {
        const read: Set<string> = propsReadBy(node.initializer, aliases);
        if (read.size > 0) {
          aliases.names.set(node.name.text, read);
        }
      }
    }
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isIdentifier(node.left)
    ) {
      const read: Set<string> = propsReadBy(node.right, aliases);
      if (read.size > 0) {
        const names: Set<string> =
          aliases.names.get(node.left.text) || new Set<string>();
        for (const name of read) {
          names.add(name);
        }
        aliases.names.set(node.left.text, names);
      }
    }
    ts.forEachChild(node, visit);
  };
  if (component.body) {
    visit(component.body);
  }
  return aliases;
}

// The props what a control holds draws: `{props.title}`, `{label}`.
function referencedProps(node: ts.Node, aliases: PropAliases): Set<string> {
  if (ts.isJsxText(node)) {
    return new Set<string>();
  }
  return propsReadBy(node, aliases);
}

// The expressions a function component returns, at its own level.
function returnedExpressions(component: FunctionNode): Array<ts.Node> {
  if (ts.isArrowFunction(component) && !ts.isBlock(component.body)) {
    return [component.body];
  }
  const found: Array<ts.Node> = [];
  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      node !== component &&
      (ts.isArrowFunction(node) ||
        ts.isFunctionExpression(node) ||
        ts.isFunctionDeclaration(node) ||
        ts.isMethodDeclaration(node))
    ) {
      return;
    }
    if (ts.isReturnStatement(node) && node.expression) {
      found.push(node.expression);
      return;
    }
    ts.forEachChild(node, visit);
  };
  if (component.body) {
    visit(component.body);
  }
  return found;
}

/*
 * What a component element is, by the name its module draws it with: a
 * shared control of the hand-written lists, a router's link, a component
 * that is one only when handed certain props, or what its own source says.
 */
function kindOfComponentElement(
  module: ModuleFacts,
  facts: ElementFacts,
  index: ComponentControlIndex,
): ComponentControlKind | null {
  const binding: ImportedBinding | undefined = module.imports.get(
    facts.tagName,
  );

  if (binding) {
    const conditional: ConditionalSingleControl | undefined =
      CONDITIONAL_SINGLE_CONTROL_COMPONENTS.find(
        (rule: ConditionalSingleControl): boolean => {
          return (
            rule.exportName === binding.exportName &&
            isBindingOf(binding, [rule.path])
          );
        },
      );
    if (conditional) {
      return conditional.isSingleControl(facts.attributes)
        ? ComponentControlKind.SingleControl
        : null;
    }
    if (binding.exportName === "default") {
      if (isBindingOf(binding, SINGLE_CONTROL_COMPONENT_PATHS)) {
        return ComponentControlKind.SingleControl;
      }
      if (isBindingOf(binding, CONTROL_COMPONENT_PATHS)) {
        return ComponentControlKind.Control;
      }
    }
    if (
      binding.specifier.startsWith("react-router") &&
      ROUTER_LINK_NAMES.includes(binding.exportName)
    ) {
      return ComponentControlKind.SingleControl;
    }
  }

  return index.kindOfLocalName(module, facts.tagName);
}

/*
 * ---------------------------------------------------------------------------
 * The scan
 * ---------------------------------------------------------------------------
 */

/*
 * The controls one module draws inside another control. `index` holds what
 * every module of the scan is (buildComponentControlIndex); without one,
 * only the hand-written lists of shared controls are known.
 */
export function scanNestedControls(
  fileName: string,
  sourceText: string,
  index?: ComponentControlIndex | undefined,
): Array<NestedControlInSource> {
  const indexed: ComponentControlIndex =
    index || new ComponentControlIndex([{ file: fileName, sourceText }]);
  const isIndexed: boolean = indexed.getSourceFile(fileName) !== undefined;
  const sourceFile: ts.SourceFile = isIndexed
    ? (indexed.getSourceFile(fileName) as ts.SourceFile)
    : parse(fileName, sourceText);
  const module: ModuleFacts =
    (isIndexed && indexed.getModuleFacts(fileName)) ||
    indexed.readModule(fileName, sourceFile);

  const routerLinks: Set<string> = importedRouterLinkNames(sourceFile);
  const handListedControls: Set<string> = new Set<string>([
    ...importedDefaultNames(sourceFile, CONTROL_COMPONENT_PATHS),
    ...routerLinks,
  ]);
  const handListedSingleControls: Set<string> = new Set<string>([
    ...importedDefaultNames(sourceFile, SINGLE_CONTROL_COMPONENT_PATHS),
    ...routerLinks,
  ]);

  const kindOf: (facts: ElementFacts) => ComponentControlKind | null = (
    facts: ElementFacts,
  ): ComponentControlKind | null => {
    if (INTRINSIC_TAG.test(facts.tagName)) {
      if (isIntrinsicSingleControl(facts)) {
        return ComponentControlKind.SingleControl;
      }
      return isIntrinsicControl(facts) ? ComponentControlKind.Control : null;
    }
    if (handListedSingleControls.has(facts.tagName)) {
      return ComponentControlKind.SingleControl;
    }
    if (handListedControls.has(facts.tagName)) {
      return ComponentControlKind.Control;
    }
    return kindOfComponentElement(module, facts, indexed);
  };

  const found: Array<NestedControlInSource> = [];

  // The single controls whose tags the walk is between, innermost last.
  const visit: (node: ts.Node, around: Array<ElementFacts>) => void = (
    node: ts.Node,
    around: Array<ElementFacts>,
  ): void => {
    // Drawn into another part of the page: inside nothing written here.
    if (isCreatePortalCall(node, sourceFile)) {
      ts.forEachChild(node, (child: ts.Node): void => {
        visit(child, []);
      });
      return;
    }

    const opening: ts.JsxOpeningLikeElement | null = ts.isJsxElement(node)
      ? node.openingElement
      : ts.isJsxSelfClosingElement(node)
        ? node
        : null;

    if (!opening) {
      ts.forEachChild(node, (child: ts.Node): void => {
        visit(child, around);
      });
      return;
    }

    const facts: ElementFacts = factsOf(opening, sourceFile);
    const outer: ElementFacts | undefined = around[around.length - 1];
    const kind: ComponentControlKind | null = kindOf(facts);

    if (outer && kind) {
      found.push({
        file: fileName,
        line: lineOf(sourceFile, opening),
        outer: describe(outer),
        inner: describe(facts),
      });
    }

    const inside: Array<ElementFacts> =
      kind === ComponentControlKind.SingleControl ? [...around, facts] : around;

    /*
     * What its attributes hold is not drawn between its tags - unless it is
     * one control that draws that prop inside itself: a Button's `title`,
     * a pill's `label`.
     */
    const drawnProps: Set<string> =
      kind === ComponentControlKind.SingleControl &&
      !INTRINSIC_TAG.test(facts.tagName)
        ? indexed.getDrawnProps(module, facts.tagName)
        : new Set<string>();
    for (const property of opening.attributes.properties) {
      const isDrawnInside: boolean =
        ts.isJsxAttribute(property) &&
        drawnProps.has(property.name.getText(sourceFile));
      visit(property, isDrawnInside ? inside : around);
    }

    if (!ts.isJsxElement(node)) {
      return;
    }

    for (const child of node.children) {
      visit(child, inside);
    }
  };

  visit(sourceFile, []);

  return found;
}

// `button > span[role=button]`: one nesting as the guard's lists write it.
export function nestingKey(nesting: NestedControlInSource): string {
  return `${nesting.outer} > ${nesting.inner}`;
}

/*
 * ---------------------------------------------------------------------------
 * A row with controls of its own links its name
 * ---------------------------------------------------------------------------
 *
 * A ResourcePartRow that is handed `to` and `hasControls` draws no link of
 * its own: its name is the link (ResourcePartRowName), stretched over the
 * row (#9728). One that draws no name opens nothing.
 */
export interface RowWithoutNameLink {
  file: string;
  line: number;
}

export function scanRowsWithControlsWithoutName(
  fileName: string,
  sourceText: string,
): Array<RowWithoutNameLink> {
  const sourceFile: ts.SourceFile = parse(fileName, sourceText);
  const rowNames: Set<string> = new Set<string>();
  const nameNames: Set<string> = new Set<string>();

  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      !matchesPath(statement.moduleSpecifier.text, [
        "ResourcePart/ResourcePartRow",
      ])
    ) {
      continue;
    }
    const clause: ts.ImportClause | undefined = statement.importClause;
    if (clause?.name) {
      rowNames.add(clause.name.text);
    }
    const bindings: ts.NamedImportBindings | undefined = clause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        if (
          (element.propertyName || element.name).text === "ResourcePartRowName"
        ) {
          nameNames.add(element.name.text);
        }
      }
    }
  }

  const found: Array<RowWithoutNameLink> = [];

  const drawsName: (node: ts.Node) => boolean = (node: ts.Node): boolean => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      if (nameNames.has(node.tagName.getText(sourceFile))) {
        return true;
      }
    }
    let drawn: boolean = false;
    ts.forEachChild(node, (child: ts.Node): void => {
      drawn = drawn || drawsName(child);
    });
    return drawn;
  };

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const opening: ts.JsxOpeningLikeElement = ts.isJsxElement(node)
        ? node.openingElement
        : node;
      const facts: ElementFacts = factsOf(opening, sourceFile);
      if (
        rowNames.has(facts.tagName) &&
        facts.attributes.has("to") &&
        facts.attributes.has("hasControls") &&
        facts.attributes.get("hasControls") !== "false" &&
        !(ts.isJsxElement(node) && node.children.some(drawsName))
      ) {
        found.push({ file: fileName, line: lineOf(sourceFile, opening) });
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return found;
}
