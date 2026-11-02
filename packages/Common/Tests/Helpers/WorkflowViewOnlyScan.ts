import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * The reader behind WorkflowViewOnlyGuard: how each Workflow Builder
 * control honours a view (Common/UI/Components/Workflow/WorkflowViewOnly).
 *
 * A view is the Builder of someone who may open a workflow but not change
 * it, set from getWorkflowEditGate. Every control there that can change the
 * workflow honours it in one of these ways:
 *
 *   - it reads the view itself: useContext(WorkflowViewOnlyContext), or it
 *     draws WorkflowViewOnlyFieldset around what changes a setting, or it
 *     provides the view to what it draws (the canvas, a step's dialog);
 *   - it is drawn, everywhere it is drawn, inside a WorkflowViewOnlyFieldset
 *     - or inside a control that is itself drawn only there - so a view
 *     holds it still;
 *   - it opens nothing and inserts nothing while the value picker is not
 *     available, which it never is in a view (ValuePickerContext);
 *   - or it is never part of a view, or changes nothing there, and says why.
 *
 * And what a disabled fieldset cannot hold - an editable box that is no form
 * control, a list a grip reorders, keys handled on an element that is no
 * form control - reads the view itself.
 *
 * Read through the TypeScript AST, so a word in a comment or a string is
 * never taken for a control.
 */

export const REPOSITORY_ROOT: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
);

export const BUILDER_DIRECTORY: string = path.join(
  REPOSITORY_ROOT,
  "packages",
  "Common",
  "UI",
  "Components",
  "Workflow",
);

// What draws the Builder: the Dashboard's Builder page.
export const BUILDER_PAGE_FILE: string = path.join(
  REPOSITORY_ROOT,
  "packages",
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
  "Pages",
  "Workflow",
  "View",
  "Builder.tsx",
);

export const VIEW_CONTEXT: string = "WorkflowViewOnlyContext";
export const VIEW_FIELDSET: string = "WorkflowViewOnlyFieldset";

// Elements that take a press, a key or typing of their own.
const NATIVE_CONTROLS: ReadonlySet<string> = new Set<string>([
  "button",
  "input",
  "textarea",
  "select",
]);

// What a press, a key, typing, a paste or a drop is handled with.
const CONTROL_HANDLERS: ReadonlySet<string> = new Set<string>([
  "onClick",
  "onMouseDown",
  "onMouseUp",
  "onPointerDown",
  "onPointerUp",
  "onKeyDown",
  "onKeyUp",
  "onKeyPress",
  "onChange",
  "onInput",
  "onBeforeInput",
  "onPaste",
  "onCut",
  "onDrop",
  "onDragStart",
  "onSubmit",
  // The Builder's own: a value or a field picked from a list.
  "onPick",
  "onToggle",
]);

const KEY_HANDLERS: ReadonlySet<string> = new Set<string>([
  "onKeyDown",
  "onKeyUp",
  "onKeyPress",
]);

// A list whose rows a grip picks up and moves (react-beautiful-dnd).
const DRAG_AND_DROP: ReadonlySet<string> = new Set<string>([
  "DragDropContext",
  "Droppable",
  "Draggable",
]);

export enum ControlKind {
  // A button, an input, a text area or a list of options.
  Native = "native control",
  // A box typed into that is no form control.
  EditableText = "editable text",
  // A list whose rows a grip picks up from the keyboard too.
  DragAndDrop = "drag and drop",
  // Keys handled on an element that is no form control.
  KeysOnAnElement = "keys on an element",
  // A press, a change, a pick handled by a component it draws.
  Handler = "handler",
}

export interface ControlSite {
  kind: ControlKind;
  // The element's tag as written: "button", "Dropdown", "div".
  tag: string;
  // 1-based.
  line: number;
  // What makes it a control: the handler or attribute, or the tag.
  what: string;
}

// The fieldset's tag and a fieldset ancestor, for a drawn element.
export interface DrawnElement {
  tag: string;
  line: number;
  isInsideViewFieldset: boolean;
}

function parse(fileName: string, source: string): ts.SourceFile {
  return ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

function lineOf(sourceFile: ts.SourceFile, node: ts.Node): number {
  return (
    sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
  );
}

type JsxOpening = ts.JsxOpeningElement | ts.JsxSelfClosingElement;

function isJsxOpening(node: ts.Node): node is JsxOpening {
  return ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node);
}

function attributeNames(element: JsxOpening): Array<string> {
  return element.attributes.properties
    .filter((property: ts.JsxAttributeLike): boolean => {
      return ts.isJsxAttribute(property);
    })
    .map((property: ts.JsxAttributeLike): string => {
      return (property as ts.JsxAttribute).name.getText();
    });
}

// An element of the page itself (div, li), not a component (Dropdown).
const INTRINSIC_TAG: RegExp = /^[a-z]/;

function isIntrinsic(tag: string): boolean {
  return INTRINSIC_TAG.test(tag);
}

function walk(node: ts.Node, visit: (node: ts.Node) => void): void {
  visit(node);
  ts.forEachChild(node, (child: ts.Node) => {
    walk(child, visit);
  });
}

/*
 * Every control a file draws: a native control, an editable box, a list a
 * grip reorders, keys handled on an element that is no form control, and a
 * press, change or pick handled by anything it draws.
 */
export function findControlSites(
  fileName: string,
  source: string,
): Array<ControlSite> {
  const sourceFile: ts.SourceFile = parse(fileName, source);
  const sites: Array<ControlSite> = [];

  walk(sourceFile, (node: ts.Node): void => {
    if (!isJsxOpening(node)) {
      return;
    }

    const tag: string = node.tagName.getText(sourceFile);
    const line: number = lineOf(sourceFile, node);
    const attributes: Array<string> = attributeNames(node);

    if (NATIVE_CONTROLS.has(tag)) {
      sites.push({ kind: ControlKind.Native, tag, line, what: tag });
    }

    if (attributes.includes("contentEditable")) {
      sites.push({
        kind: ControlKind.EditableText,
        tag,
        line,
        what: "contentEditable",
      });
    }

    if (DRAG_AND_DROP.has(tag) || attributes.includes("draggable")) {
      sites.push({
        kind: ControlKind.DragAndDrop,
        tag,
        line,
        what: DRAG_AND_DROP.has(tag) ? tag : "draggable",
      });
    }

    for (const attribute of attributes) {
      if (!CONTROL_HANDLERS.has(attribute)) {
        continue;
      }

      const isKeysOnAnElement: boolean =
        KEY_HANDLERS.has(attribute) &&
        isIntrinsic(tag) &&
        !NATIVE_CONTROLS.has(tag);

      sites.push({
        kind: isKeysOnAnElement
          ? ControlKind.KeysOnAnElement
          : ControlKind.Handler,
        tag,
        line,
        what: attribute,
      });
    }
  });

  return sites;
}

export enum ViewReading {
  // useContext(WorkflowViewOnlyContext), or React.useContext.
  ReadsTheContext = "reads WorkflowViewOnlyContext",
  // Draws <WorkflowViewOnlyFieldset> around what changes a setting.
  DrawsTheFieldset = "draws WorkflowViewOnlyFieldset",
  // <WorkflowViewOnlyContext.Provider>: the canvas, a step's dialog.
  ProvidesTheView = "provides WorkflowViewOnlyContext",
}

// How a file reads the view itself, if it does.
export function findViewReadings(
  fileName: string,
  source: string,
): Array<ViewReading> {
  const sourceFile: ts.SourceFile = parse(fileName, source);
  const readings: Set<ViewReading> = new Set<ViewReading>();

  walk(sourceFile, (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee: string = node.expression.getText(sourceFile);

      if (
        (callee === "useContext" || callee === "React.useContext") &&
        node.arguments.length === 1 &&
        node.arguments[0]!.getText(sourceFile) === VIEW_CONTEXT
      ) {
        readings.add(ViewReading.ReadsTheContext);
      }
    }

    if (isJsxOpening(node)) {
      const tag: string = node.tagName.getText(sourceFile);

      if (tag === VIEW_FIELDSET) {
        readings.add(ViewReading.DrawsTheFieldset);
      }

      if (tag === `${VIEW_CONTEXT}.Provider`) {
        readings.add(ViewReading.ProvidesTheView);
      }
    }
  });

  return Array.from(readings);
}

function hasViewFieldsetAncestor(
  node: ts.Node,
  sourceFile: ts.SourceFile,
): boolean {
  let current: ts.Node | undefined = node.parent;

  while (current) {
    if (
      ts.isJsxElement(current) &&
      current.openingElement.tagName.getText(sourceFile) === VIEW_FIELDSET
    ) {
      return true;
    }

    current = current.parent;
  }

  return false;
}

/*
 * Where a file draws a component, by the name it imports it under: each
 * element, and whether a WorkflowViewOnlyFieldset holds it.
 */
export function findDrawnElements(
  fileName: string,
  source: string,
  tag: string,
): Array<DrawnElement> {
  const sourceFile: ts.SourceFile = parse(fileName, source);
  const drawn: Array<DrawnElement> = [];

  walk(sourceFile, (node: ts.Node): void => {
    if (!isJsxOpening(node) || node.tagName.getText(sourceFile) !== tag) {
      return;
    }

    drawn.push({
      tag,
      line: lineOf(sourceFile, node),
      isInsideViewFieldset: hasViewFieldsetAncestor(node, sourceFile),
    });
  });

  return drawn;
}

export interface BuilderImport {
  // The Builder file imported, relative to BUILDER_DIRECTORY.
  file: string;
  // The names it is imported under: the default import, and named ones.
  names: Array<string>;
}

/*
 * The Builder files a file imports, by relative path, with the names it
 * imports from each.
 */
export function findBuilderImports(
  filePath: string,
  source: string,
): Array<BuilderImport> {
  const sourceFile: ts.SourceFile = parse(filePath, source);
  const imports: Array<BuilderImport> = [];

  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      continue;
    }

    const specifier: string = statement.moduleSpecifier.text;

    if (!specifier.startsWith(".")) {
      continue;
    }

    const resolved: string | null = resolveBuilderFile(
      path.resolve(path.dirname(filePath), specifier),
    );

    if (!resolved) {
      continue;
    }

    const names: Array<string> = [];
    const clause: ts.ImportClause | undefined = statement.importClause;

    if (clause?.name) {
      names.push(clause.name.text);
    }

    if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const element of clause.namedBindings.elements) {
        names.push(element.name.text);
      }
    }

    imports.push({ file: resolved, names });
  }

  return imports;
}

// A path without its extension, as an import names it, to a Builder file.
function resolveBuilderFile(withoutExtension: string): string | null {
  for (const extension of [".tsx", ".ts"]) {
    const candidate: string = `${withoutExtension}${extension}`;

    if (
      candidate.startsWith(BUILDER_DIRECTORY + path.sep) &&
      fs.existsSync(candidate)
    ) {
      return toBuilderPath(candidate);
    }
  }

  return null;
}

export function toBuilderPath(absolutePath: string): string {
  return path
    .relative(BUILDER_DIRECTORY, absolutePath)
    .split(path.sep)
    .join("/");
}

// Every .tsx file of the Builder, relative to BUILDER_DIRECTORY.
export function listBuilderFiles(): Array<string> {
  const files: Array<string> = [];

  const visit: (directory: string) => void = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath: string = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        visit(entryPath);
      } else if (entry.name.endsWith(".tsx")) {
        files.push(toBuilderPath(entryPath));
      }
    }
  };

  visit(BUILDER_DIRECTORY);

  return files.sort();
}

export function readBuilderFile(file: string): string {
  return fs.readFileSync(path.join(BUILDER_DIRECTORY, file), "utf8");
}

/*
 * The text of every value written for a property of that name in an object
 * literal: `isAvailable: !isViewOnly` is "!isViewOnly".
 */
export function findPropertyValues(
  fileName: string,
  source: string,
  name: string,
): Array<string> {
  const sourceFile: ts.SourceFile = parse(fileName, source);
  const values: Array<string> = [];

  walk(sourceFile, (node: ts.Node): void => {
    if (
      ts.isPropertyAssignment(node) &&
      node.name.getText(sourceFile) === name
    ) {
      values.push(node.initializer.getText(sourceFile));
    }
  });

  return values;
}

// The text of each JSX attribute of that name on a tag: `{isViewOnly}`.
export function findAttributeValues(
  fileName: string,
  source: string,
  tag: string,
  attribute: string,
): Array<string> {
  const sourceFile: ts.SourceFile = parse(fileName, source);
  const values: Array<string> = [];

  walk(sourceFile, (node: ts.Node): void => {
    if (!isJsxOpening(node) || node.tagName.getText(sourceFile) !== tag) {
      return;
    }

    for (const property of node.attributes.properties) {
      if (
        ts.isJsxAttribute(property) &&
        property.name.getText(sourceFile) === attribute &&
        property.initializer
      ) {
        values.push(property.initializer.getText(sourceFile));
      }
    }
  });

  return values;
}

/*
 * Whether a file keeps its value lists shut while the value picker is not
 * available: it reads the picker (useValuePicker()) and asks isAvailable.
 */
export function asksIfThePickerIsAvailable(
  fileName: string,
  source: string,
): boolean {
  const sourceFile: ts.SourceFile = parse(fileName, source);
  let readsThePicker: boolean = false;
  let asksIsAvailable: boolean = false;

  walk(sourceFile, (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(sourceFile) === "useValuePicker"
    ) {
      readsThePicker = true;
    }

    if (
      ts.isPropertyAccessExpression(node) &&
      node.name.text === "isAvailable"
    ) {
      asksIsAvailable = true;
    }
  });

  return readsThePicker && asksIsAvailable;
}
