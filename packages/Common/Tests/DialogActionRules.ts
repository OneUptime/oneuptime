import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * The detector behind the "one primary 'do it' button per dialog" guard
 * (Tests/UI/DialogPrimaryActionGuard.test.ts).
 *
 * Why the rule exists. The workflow builder's "Run this step now?"
 * confirmation drew Cancel and "Run this step" as the same plain white
 * button, and the dialog put its initial focus ring on Cancel - so the one
 * thing the user had come to do looked like the lesser choice. The audit that
 * followed found the same fault, and its mirror images, all over the product:
 * confirmations whose action was a plain or a green button, notices whose only
 * job is to close drawn in indigo, and dialogs that offered "Cancel" and
 * "Close" side by side. The rule every dialog now follows:
 *
 *   - the affirmative action - the thing the dialog exists to do - is the one
 *     primary button: PRIMARY, or DANGER when it destroys something;
 *   - Cancel, Close and every other way out are plain (NORMAL / OUTLINE),
 *     and a dialog offers exactly one of them;
 *   - nothing else in the dialog is drawn as a primary button.
 *
 * What it reads. Every JSX use of the shared dialogs - Modal, ConfirmModal,
 * BasicFormModal, ModelFormModal and SideOver, recognised by the module they
 * are imported from, so a local component that happens to be called Modal is
 * not mistaken for one - and from each, the footer it will render:
 *
 *   - the submit button: whether there is one (ConfirmModal, BasicFormModal
 *     and ModelFormModal always have one; Modal and SideOver only with an
 *     onSubmit), its label and its style, each with the component's own
 *     default when the prop is left out;
 *   - the close button: Modal and ConfirmModal draw "Cancel" in the footer
 *     whenever onClose is passed, SideOver always draws "Close";
 *   - every other <Button> or `{ buttonStyle: ... }` button schema written
 *     inside the dialog - in its children, leftFooterElement, rightElement or
 *     any other prop - except inside a nested dialog, which is a dialog of its
 *     own.
 *
 * Values are read when they are written down: a string or template literal,
 * a translation call with a literal argument (`t("common.close")` is looked
 * up in the feature set's English locale), `ButtonStyleType.X`, `undefined`
 * (the component's default), or either branch of a ternary. A value held in
 * a variable is unknown, and only the rules that do not need it apply.
 * Ternaries are followed branch by branch, and props that branch on the same
 * condition are paired: `isRetryable ? "Resend" : "Close"` with
 * `isRetryable ? PRIMARY : NORMAL` and `onClose={isRetryable ? close :
 * undefined}` describe two consistent footers, not eight.
 *
 * What it cannot see: a button drawn by another component the dialog renders
 * (that component's own file is scanned on its own), and a hand-rolled
 * <button> with indigo classes. Both are left to review.
 */

export type DialogComponentName =
  | "Modal"
  | "ConfirmModal"
  | "BasicFormModal"
  | "ModelFormModal"
  | "SideOver";

export type DialogRule =
  // The affirmative action is not PRIMARY (or DANGER, when it destroys).
  | "action-not-primary"
  // A button that only closes the dialog is coloured.
  | "dismissal-coloured"
  // The footer offers two ways out ("Cancel" and "Close").
  | "two-dismissals"
  // The Cancel / Close button itself is coloured.
  | "cancel-coloured"
  // More than one primary button.
  | "two-primaries"
  // A Delete / Remove action that is not drawn as DANGER.
  | "destructive-not-danger";

export const DIALOG_RULES: ReadonlyArray<DialogRule> = [
  "action-not-primary",
  "dismissal-coloured",
  "two-dismissals",
  "cancel-coloured",
  "two-primaries",
  "destructive-not-danger",
];

export interface DialogFinding {
  // As passed to analyzeDialogSource (the scan passes a repository-relative path).
  file: string;
  line: number;
  component: DialogComponentName;
  rule: DialogRule;
  // The dialog's title as written, for the message and for allowlist matching.
  title: string;
  message: string;
}

// The style of a button: the ButtonStyleType member name, e.g. "PRIMARY".
export type StyleName = string;

/*
 * The styles that read as "this does something". A dismissal, Cancel or a
 * secondary action must not use them; the affirmative action must use one of
 * ACTION_STYLES.
 */
export const COLOURED_STYLES: ReadonlySet<StyleName> = new Set<StyleName>([
  "PRIMARY",
  "SECONDARY",
  "DANGER",
  "SUCCESS",
  "WARNING",
]);

export const ACTION_STYLES: ReadonlySet<StyleName> = new Set<StyleName>([
  "PRIMARY",
  "DANGER",
]);

/*
 * The filled buttons: what a primary button looks like, whatever its colour.
 * Two of them in one dialog compete for "the thing to do here", so a dialog
 * may draw at most one.
 */
export const FILLED_STYLES: ReadonlySet<StyleName> = new Set<StyleName>([
  "PRIMARY",
  "DANGER",
  "SUCCESS",
  "WARNING",
]);

/*
 * Labels whose only effect is to close the dialog. Compared case-insensitively
 * with surrounding whitespace and a trailing full stop or exclamation mark
 * removed. "Dismiss" is deliberately absent: dismissing a recommendation is an
 * action with a consequence, not a way out of the dialog.
 */
export const DISMISSAL_LABELS: ReadonlySet<string> = new Set<string>([
  "close",
  "done",
  "ok",
  "okay",
  "got it",
  "great",
  "cancel",
  "back",
]);

// Labels that destroy something and must be drawn as DANGER.
const DESTRUCTIVE_LABEL_PATTERN: RegExp = /^(delete|remove)\b/i;

export function isDismissalLabel(label: string): boolean {
  const normalized: string = label
    .trim()
    .replace(/[.!]+$/, "")
    .trim()
    .toLowerCase();

  return DISMISSAL_LABELS.has(normalized);
}

export function isDestructiveLabel(label: string): boolean {
  return DESTRUCTIVE_LABEL_PATTERN.test(label.trim());
}

// Stands for "the component's own default" until a footer variant resolves it.
const DEFAULT_STYLE: StyleName = "<default>";

/* Each dialog's footer, as its component draws it. */
interface DialogContract {
  // The module path suffix the component is imported from.
  moduleSuffix: string;
  // Whether a submit button is drawn without an onSubmit prop.
  submitAlways: boolean;
  defaultSubmitText: string;
  submitStyleProp: string | null;
  /*
   * The style the submit gets when the style prop is left out. ConfirmModal
   * decides by whether there is a way to cancel: with one it is a
   * confirmation and its submit is the action; without one it is a notice and
   * its only button just closes it.
   */
  defaultSubmitStyle: (hasCancel: boolean) => StyleName;
  // Whether the footer draws a close button without an onClose (SideOver).
  cancelAlways: boolean;
  cancelTextProp: string | null;
  defaultCancelText: string;
  cancelStyleProp: string | null;
}

const ALWAYS_PRIMARY: (hasCancel: boolean) => StyleName = (): StyleName => {
  return "PRIMARY";
};

const DIALOG_CONTRACTS: Record<DialogComponentName, DialogContract> = {
  Modal: {
    moduleSuffix: "Modal/Modal",
    submitAlways: false,
    defaultSubmitText: "Save",
    submitStyleProp: "submitButtonStyleType",
    defaultSubmitStyle: ALWAYS_PRIMARY,
    cancelAlways: false,
    cancelTextProp: "closeButtonText",
    defaultCancelText: "Cancel",
    cancelStyleProp: "closeButtonStyleType",
  },
  ConfirmModal: {
    moduleSuffix: "Modal/ConfirmModal",
    submitAlways: true,
    defaultSubmitText: "Confirm",
    submitStyleProp: "submitButtonType",
    defaultSubmitStyle: (hasCancel: boolean): StyleName => {
      return hasCancel ? "PRIMARY" : "NORMAL";
    },
    cancelAlways: false,
    cancelTextProp: "closeButtonText",
    defaultCancelText: "Cancel",
    cancelStyleProp: "closeButtonType",
  },
  BasicFormModal: {
    moduleSuffix: "FormModal/BasicFormModal",
    submitAlways: true,
    defaultSubmitText: "Save",
    submitStyleProp: "submitButtonStyleType",
    defaultSubmitStyle: ALWAYS_PRIMARY,
    cancelAlways: false,
    cancelTextProp: "closeButtonText",
    defaultCancelText: "Cancel",
    cancelStyleProp: "closeButtonStyleType",
  },
  ModelFormModal: {
    moduleSuffix: "ModelFormModal/ModelFormModal",
    submitAlways: true,
    defaultSubmitText: "Save",
    submitStyleProp: "submitButtonStyleType",
    defaultSubmitStyle: ALWAYS_PRIMARY,
    cancelAlways: false,
    cancelTextProp: "closeButtonText",
    defaultCancelText: "Cancel",
    cancelStyleProp: "closeButtonStyleType",
  },
  SideOver: {
    moduleSuffix: "SideOver/SideOver",
    submitAlways: false,
    defaultSubmitText: "Save",
    submitStyleProp: null,
    defaultSubmitStyle: ALWAYS_PRIMARY,
    cancelAlways: true,
    cancelTextProp: null,
    defaultCancelText: "Close",
    cancelStyleProp: null,
  },
};

export const DIALOG_COMPONENT_NAMES: ReadonlyArray<DialogComponentName> =
  Object.keys(DIALOG_CONTRACTS) as Array<DialogComponentName>;

const BUTTON_MODULE_SUFFIX: string = "Button/Button";

/*
 * One way an expression can come out: its value (null when it cannot be read
 * statically) and the ternary branches taken to get there, keyed by the
 * condition's source text.
 */
interface Branch<T> {
  value: T | null;
  path: Map<string, boolean>;
}

function single<T>(value: T | null): Array<Branch<T>> {
  return [{ value, path: new Map<string, boolean>() }];
}

function unwrap(expression: ts.Expression): ts.Expression {
  let current: ts.Expression = expression;

  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression;
  }

  return current;
}

function isUndefinedExpression(expression: ts.Expression): boolean {
  const unwrapped: ts.Expression = unwrap(expression);

  return (
    (ts.isIdentifier(unwrapped) && unwrapped.text === "undefined") ||
    unwrapped.kind === ts.SyntaxKind.NullKeyword
  );
}

function conditionKey(
  condition: ts.Expression,
  sourceFile: ts.SourceFile,
): string {
  return condition.getText(sourceFile).replace(/\s+/g, " ").trim();
}

function pathsAgree(
  first: Map<string, boolean>,
  second: Map<string, boolean>,
): boolean {
  for (const [key, value] of first) {
    if (second.has(key) && second.get(key) !== value) {
      return false;
    }
  }

  return true;
}

function mergePaths(
  first: Map<string, boolean>,
  second: Map<string, boolean>,
): Map<string, boolean> {
  const merged: Map<string, boolean> = new Map<string, boolean>(first);

  for (const [key, value] of second) {
    merged.set(key, value);
  }

  return merged;
}

/*
 * Follows a ternary into both branches, recording which way it went. Any other
 * expression is handed to `read`.
 */
function evaluateBranches<T>(
  expression: ts.Expression,
  sourceFile: ts.SourceFile,
  read: (expression: ts.Expression) => Array<Branch<T>>,
): Array<Branch<T>> {
  const unwrapped: ts.Expression = unwrap(expression);

  if (ts.isConditionalExpression(unwrapped)) {
    const key: string = conditionKey(unwrapped.condition, sourceFile);
    const result: Array<Branch<T>> = [];
    const sides: Array<[ts.Expression, boolean]> = [
      [unwrapped.whenTrue, true],
      [unwrapped.whenFalse, false],
    ];

    for (const [side, whenTrue] of sides) {
      for (const branch of evaluateBranches(side, sourceFile, read)) {
        if (branch.path.has(key) && branch.path.get(key) !== whenTrue) {
          continue;
        }

        const pathWithThisSide: Map<string, boolean> = new Map<
          string,
          boolean
        >(branch.path);
        pathWithThisSide.set(key, whenTrue);
        result.push({ value: branch.value, path: pathWithThisSide });
      }
    }

    return result;
  }

  return read(unwrapped);
}

/*
 * English for a translation key, looked up in the nearest feature set's
 * locale. Keys are dotted paths into nested objects; Dashboard also keys some
 * entries by their English text, which a plain lookup finds.
 */
export type LocaleLookup = (key: string) => string | null;

const NO_LOCALE: LocaleLookup = (): string | null => {
  return null;
};

const TRANSLATION_FUNCTIONS: ReadonlySet<string> = new Set<string>([
  "t",
  "tx",
  "translate",
  "translateString",
  "translateValue",
]);

/*
 * A label's possible values. `undefined` (or a missing prop, which the caller
 * handles) means the component's default label, given as `fallback`.
 */
function readLabel(
  expression: ts.Expression,
  sourceFile: ts.SourceFile,
  locale: LocaleLookup,
  fallback: string | null,
): Array<Branch<string>> {
  return evaluateBranches<string>(
    expression,
    sourceFile,
    (leaf: ts.Expression): Array<Branch<string>> => {
      if (isUndefinedExpression(leaf)) {
        return single(fallback);
      }

      if (ts.isStringLiteral(leaf) || ts.isNoSubstitutionTemplateLiteral(leaf)) {
        return single(leaf.text);
      }

      if (ts.isTemplateExpression(leaf)) {
        /*
         * Only the static text is known; `${...}` becomes an ellipsis. That is
         * enough to tell "Delete ${name}" from "Close".
         */
        const parts: Array<string> = [leaf.head.text];

        for (const span of leaf.templateSpans) {
          parts.push("…", span.literal.text);
        }

        return single(parts.join(""));
      }

      if (ts.isCallExpression(leaf)) {
        const callee: ts.Expression = leaf.expression;
        const calleeName: string | null = ts.isIdentifier(callee)
          ? callee.text
          : ts.isPropertyAccessExpression(callee)
            ? callee.name.text
            : null;
        const firstArgument: ts.Expression | undefined = leaf.arguments[0];

        if (
          calleeName &&
          TRANSLATION_FUNCTIONS.has(calleeName) &&
          firstArgument
        ) {
          return readLabel(firstArgument, sourceFile, locale, fallback).map(
            (branch: Branch<string>): Branch<string> => {
              if (branch.value === null) {
                return branch;
              }

              return {
                value: locale(branch.value) ?? branch.value,
                path: branch.path,
              };
            },
          );
        }
      }

      return single<string>(null);
    },
  );
}

const DEFAULT_STYLE_ENUM_NAMES: ReadonlySet<string> = new Set<string>([
  "ButtonStyleType",
]);

/*
 * A style's possible values: the ButtonStyleType member, `fallback` for
 * `undefined`, null when it cannot be read. `styleEnums` holds the names the
 * file gave ButtonStyleType (`import { ButtonStyleType as SharedButtonStyle }`).
 */
function readStyle(
  expression: ts.Expression,
  sourceFile: ts.SourceFile,
  fallback: StyleName | null,
  styleEnums: ReadonlySet<string> = DEFAULT_STYLE_ENUM_NAMES,
): Array<Branch<StyleName>> {
  return evaluateBranches<StyleName>(
    expression,
    sourceFile,
    (leaf: ts.Expression): Array<Branch<StyleName>> => {
      if (isUndefinedExpression(leaf)) {
        return single(fallback);
      }

      if (
        ts.isPropertyAccessExpression(leaf) &&
        ts.isIdentifier(leaf.expression) &&
        styleEnums.has(leaf.expression.text)
      ) {
        return single(leaf.name.text);
      }

      return single<StyleName>(null);
    },
  );
}

/*
 * Whether a callback prop is there: false for `undefined` / `null`, true for
 * anything else, per ternary branch.
 */
function readPresence(
  expression: ts.Expression,
  sourceFile: ts.SourceFile,
): Array<Branch<boolean>> {
  return evaluateBranches<boolean>(
    expression,
    sourceFile,
    (leaf: ts.Expression): Array<Branch<boolean>> => {
      return single(!isUndefinedExpression(leaf));
    },
  );
}

interface JsxProps {
  values: Map<string, ts.Expression | null>;
  hasSpread: boolean;
}

/*
 * The props written on an element. A prop given as a bare string
 * (`title="x"`) comes back as that string literal; a bare boolean prop
 * (`disabled`) as null.
 */
function readProps(attributes: ts.JsxAttributes): JsxProps {
  const values: Map<string, ts.Expression | null> = new Map<
    string,
    ts.Expression | null
  >();
  let hasSpread: boolean = false;

  for (const property of attributes.properties) {
    if (ts.isJsxSpreadAttribute(property)) {
      hasSpread = true;
      continue;
    }

    const name: string = property.name.getText();
    const initializer: ts.JsxAttributeValue | undefined = property.initializer;

    if (!initializer) {
      values.set(name, null);
    } else if (ts.isJsxExpression(initializer)) {
      values.set(name, initializer.expression || null);
    } else if (ts.isStringLiteral(initializer)) {
      values.set(name, initializer);
    } else {
      values.set(name, null);
    }
  }

  return { values, hasSpread };
}

/*
 * The local names this file gives the shared dialogs and Button, from its
 * import declarations. Matching on the module path rather than the name keeps
 * a local `Modal` that is not ours out of the scan, and keeps an import under
 * another name in it.
 */
export interface ImportedComponents {
  dialogs: Map<string, DialogComponentName>;
  buttons: Set<string>;
  // The names ButtonStyleType goes by in this file.
  styleEnums: Set<string>;
}

function normalizeModulePath(specifier: string): string {
  return specifier.replace(/\.(tsx?|jsx?)$/, "").replace(/\/index$/, "");
}

export function readImports(
  sourceFile: ts.SourceFile,
  fileName: string,
): ImportedComponents {
  const dialogs: Map<string, DialogComponentName> = new Map<
    string,
    DialogComponentName
  >();
  const buttons: Set<string> = new Set<string>();
  const styleEnums: Set<string> = new Set<string>(DEFAULT_STYLE_ENUM_NAMES);
  const directory: string = path.posix.dirname(
    fileName.split(path.sep).join("/"),
  );

  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      !statement.importClause
    ) {
      continue;
    }

    const localName: string | null = statement.importClause.name
      ? statement.importClause.name.text
      : null;
    const specifier: string = statement.moduleSpecifier.text;
    /*
     * The shared dialogs' own files, and Common's components, import each
     * other by relative path ("./Modal" from ConfirmModal.tsx); resolve those
     * against the file before matching.
     */
    const resolved: string = normalizeModulePath(
      specifier.startsWith(".")
        ? path.posix.join(directory, specifier)
        : specifier,
    );

    for (const component of DIALOG_COMPONENT_NAMES) {
      if (
        localName &&
        (resolved === DIALOG_CONTRACTS[component].moduleSuffix ||
          resolved.endsWith(`/${DIALOG_CONTRACTS[component].moduleSuffix}`))
      ) {
        dialogs.set(localName, component);
      }
    }

    if (
      resolved === BUTTON_MODULE_SUFFIX ||
      resolved.endsWith(`/${BUTTON_MODULE_SUFFIX}`)
    ) {
      if (localName) {
        buttons.add(localName);
      }

      const namedBindings: ts.NamedImportBindings | undefined =
        statement.importClause.namedBindings;

      if (namedBindings && ts.isNamedImports(namedBindings)) {
        for (const element of namedBindings.elements) {
          const importedName: string = (element.propertyName || element.name)
            .text;

          if (importedName === "ButtonStyleType") {
            styleEnums.add(element.name.text);
          }
        }
      }
    }
  }

  return { dialogs, buttons, styleEnums };
}

type JsxOpening = ts.JsxOpeningElement | ts.JsxSelfClosingElement;

function tagNameOf(opening: JsxOpening): string {
  return opening.tagName.getText();
}

function lineOf(node: ts.Node, sourceFile: ts.SourceFile): number {
  return (
    sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line +
    1
  );
}

function describeLabels(
  expression: ts.Expression | null | undefined,
  sourceFile: ts.SourceFile,
  locale: LocaleLookup,
  whenMissing: string,
): string {
  if (!expression) {
    return whenMissing;
  }

  return readLabel(expression, sourceFile, locale, whenMissing)
    .map((branch: Branch<string>): string => {
      return branch.value ?? expression.getText(sourceFile);
    })
    .filter((label: string, index: number, all: Array<string>): boolean => {
      return all.indexOf(label) === index;
    })
    .join(" / ");
}

export interface FilledButtonSite {
  line: number;
  label: string;
  // The filled style it may be drawn in.
  style: StyleName;
  // Written inside a `.map(...)` callback: drawn once per row.
  repeated: boolean;
}

// The array methods whose callback renders one element per item.
const LIST_RENDERING_METHODS: ReadonlySet<string> = new Set<string>([
  "map",
  "flatMap",
]);

function isListRenderingCallback(node: ts.Node): boolean {
  if (!ts.isArrowFunction(node) && !ts.isFunctionExpression(node)) {
    return false;
  }

  const call: ts.Node = node.parent;

  return (
    ts.isCallExpression(call) &&
    call.arguments.includes(node as ts.Expression) &&
    ts.isPropertyAccessExpression(call.expression) &&
    LIST_RENDERING_METHODS.has(call.expression.name.text)
  );
}

/*
 * Every button written under `root` that may be drawn filled (FILLED_STYLES):
 * a <Button> whose buttonStyle may be one of them, or a `{ buttonStyle: ... }`
 * schema (the shape Card buttons and table actions take) that may be. A
 * button written in a `.map(...)` callback is drawn once per item, which is
 * as many filled buttons as there are rows. Nested dialogs are dialogs of
 * their own and are not entered.
 */
export function findFilledButtons(
  root: ts.Node,
  sourceFile: ts.SourceFile,
  imports: ImportedComponents,
  locale: LocaleLookup,
): Array<FilledButtonSite> {
  const found: Array<FilledButtonSite> = [];
  let listDepth: number = 0;

  const filledStyleOf: (
    expression: ts.Expression | null | undefined,
  ) => StyleName | null = (
    expression: ts.Expression | null | undefined,
  ): StyleName | null => {
    if (!expression) {
      return null;
    }

    const filled: Branch<StyleName> | undefined = readStyle(
      expression,
      sourceFile,
      null,
      imports.styleEnums,
    ).find((branch: Branch<StyleName>): boolean => {
      return branch.value !== null && FILLED_STYLES.has(branch.value);
    });

    return filled ? filled.value : null;
  };

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const opening: JsxOpening = ts.isJsxElement(node)
        ? node.openingElement
        : node;
      const tagName: string = tagNameOf(opening);

      if (imports.dialogs.has(tagName)) {
        // A nested dialog is checked on its own.
        return;
      }

      if (imports.buttons.has(tagName)) {
        const props: JsxProps = readProps(opening.attributes);

        const style: StyleName | null = filledStyleOf(
          props.values.get("buttonStyle"),
        );

        if (style) {
          found.push({
            line: lineOf(node, sourceFile),
            label: describeLabels(
              props.values.get("title"),
              sourceFile,
              locale,
              "(no label)",
            ),
            style,
            repeated: listDepth > 0,
          });
        }
      }
    }

    if (ts.isObjectLiteralExpression(node)) {
      let style: ts.Expression | null = null;
      let title: ts.Expression | null = null;

      for (const property of node.properties) {
        if (
          ts.isPropertyAssignment(property) &&
          (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))
        ) {
          if (property.name.text === "buttonStyle") {
            style = property.initializer;
          }

          if (property.name.text === "title") {
            title = property.initializer;
          }
        }
      }

      const filledStyle: StyleName | null = filledStyleOf(style);

      if (filledStyle) {
        found.push({
          line: lineOf(node, sourceFile),
          label: describeLabels(title, sourceFile, locale, "(no label)"),
          style: filledStyle,
          repeated: listDepth > 0,
        });
      }
    }

    const rendersOnePerItem: boolean = isListRenderingCallback(node);

    if (rendersOnePerItem) {
      listDepth++;
    }

    ts.forEachChild(node, visit);

    if (rendersOnePerItem) {
      listDepth--;
    }
  };

  visit(root);

  return found;
}

/* One footer the dialog can render, with every prop's branch fixed. */
interface FooterVariant {
  hasCancel: boolean;
  cancelLabel: string | null;
  cancelStyle: StyleName | null;
  hasSubmit: boolean;
  submitLabel: string | null;
  submitStyle: StyleName | null;
}

interface PartialVariant {
  values: Array<unknown>;
  path: Map<string, boolean>;
}

/*
 * Every consistent combination of the props' branches: a branch taken on one
 * condition rules out the other side of that same condition everywhere else.
 */
function combine(
  branchSets: Array<Array<Branch<unknown>>>,
): Array<Array<unknown>> {
  let partials: Array<PartialVariant> = [
    { values: [], path: new Map<string, boolean>() },
  ];

  for (const branches of branchSets) {
    const next: Array<PartialVariant> = [];

    for (const partial of partials) {
      for (const branch of branches) {
        if (!pathsAgree(partial.path, branch.path)) {
          continue;
        }

        next.push({
          values: [...partial.values, branch.value],
          path: mergePaths(partial.path, branch.path),
        });
      }
    }

    partials = next;
  }

  return partials.map((partial: PartialVariant): Array<unknown> => {
    return partial.values;
  });
}

function describeStyle(style: StyleName | null): string {
  return style === null ? "an unreadable style" : style;
}

export interface AnalyzeOptions {
  locale?: LocaleLookup | undefined;
}

/* Every dialog in one source file, and what is wrong with its footer. */
export function analyzeDialogSource(
  fileName: string,
  source: string,
  options: AnalyzeOptions = {},
): Array<DialogFinding> {
  return scanSource(fileName, source, options).findings;
}

// A use of one of the shared dialogs, found by the scan.
export interface DialogSite {
  file: string;
  line: number;
  component: DialogComponentName;
  title: string;
}

/* Every shared dialog a source file renders - what the scan looked at. */
export function listDialogSites(
  fileName: string,
  source: string,
  options: AnalyzeOptions = {},
): Array<DialogSite> {
  return scanSource(fileName, source, options).sites;
}

// A filled button written in a `.map(...)` callback, outside any dialog.
export interface RepeatedFilledButton {
  file: string;
  line: number;
  label: string;
  style: StyleName;
}

/*
 * Filled buttons drawn once per item of a list, anywhere on a page. A list
 * whose every row carries a filled button has as many "main actions" as it
 * has rows, which is no main action at all; a per-row action is a plain
 * button. Buttons inside a dialog are left to the dialog rules, which count
 * them with the rest of the dialog.
 */
export function findRepeatedFilledButtons(
  fileName: string,
  source: string,
  options: AnalyzeOptions = {},
): Array<RepeatedFilledButton> {
  const locale: LocaleLookup = options.locale || NO_LOCALE;
  const sourceFile: ts.SourceFile = parseSource(fileName, source);
  const imports: ImportedComponents = readImports(sourceFile, fileName);

  if (imports.buttons.size === 0) {
    return [];
  }

  return findFilledButtons(sourceFile, sourceFile, imports, locale)
    .filter((site: FilledButtonSite): boolean => {
      return site.repeated;
    })
    .map((site: FilledButtonSite): RepeatedFilledButton => {
      return {
        file: fileName,
        line: site.line,
        label: site.label,
        style: site.style,
      };
    });
}

// A group of buttons drawn side by side, with more than one filled.
export interface ButtonGroupWithTwoFilled {
  file: string;
  line: number;
  // "a card's buttons" or "sibling <Button>s".
  kind: "button-schemas" | "sibling-buttons";
  labels: Array<string>;
}

/*
 * Buttons that are drawn together, more than one of them filled: a Card's
 * `buttons` (any array literal of `{ title, buttonStyle }` schemas) whose
 * schemas may be filled, or sibling <Button>s in one JSX element. Two filled
 * buttons side by side ask for two things at once - the fault the dialogs
 * had, on a card or a page. The branches of one ternary child are
 * alternatives and count once; a `.map(...)` is the per-row rule's business.
 */
export function findButtonGroupsWithTwoFilled(
  fileName: string,
  source: string,
  options: AnalyzeOptions = {},
): Array<ButtonGroupWithTwoFilled> {
  const locale: LocaleLookup = options.locale || NO_LOCALE;
  const sourceFile: ts.SourceFile = parseSource(fileName, source);
  const imports: ImportedComponents = readImports(sourceFile, fileName);
  const groups: Array<ButtonGroupWithTwoFilled> = [];

  const filledStyleOf: (expression: ts.Expression | null | undefined) => boolean =
    (expression: ts.Expression | null | undefined): boolean => {
      if (!expression) {
        return false;
      }

      return readStyle(expression, sourceFile, null, imports.styleEnums).some(
        (branch: Branch<StyleName>): boolean => {
          return branch.value !== null && FILLED_STYLES.has(branch.value);
        },
      );
    };

  const schemaStyle: (
    node: ts.ObjectLiteralExpression,
  ) => ts.Expression | null = (
    node: ts.ObjectLiteralExpression,
  ): ts.Expression | null => {
    for (const property of node.properties) {
      if (
        ts.isPropertyAssignment(property) &&
        (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) &&
        property.name.text === "buttonStyle"
      ) {
        return property.initializer;
      }
    }

    return null;
  };

  /*
   * The button schemas a local helper returns: `getConnectWithSlackButton(
   * "Connect my account")` in a card's buttons is the object literal its
   * declaration in this file returns.
   */
  const localFunctionResults: Map<
    string,
    Array<ts.ObjectLiteralExpression>
  > = new Map<string, Array<ts.ObjectLiteralExpression>>();

  const collectReturnedObjects: (
    body: ts.ConciseBody,
  ) => Array<ts.ObjectLiteralExpression> = (
    body: ts.ConciseBody,
  ): Array<ts.ObjectLiteralExpression> => {
    if (!ts.isBlock(body)) {
      const expression: ts.Expression = unwrap(body);

      return ts.isObjectLiteralExpression(expression) ? [expression] : [];
    }

    const found: Array<ts.ObjectLiteralExpression> = [];

    const visitBody: (node: ts.Node) => void = (node: ts.Node): void => {
      // A nested function's returns are its own.
      if (ts.isFunctionLike(node)) {
        return;
      }

      if (ts.isReturnStatement(node) && node.expression) {
        const expression: ts.Expression = unwrap(node.expression);

        if (ts.isObjectLiteralExpression(expression)) {
          found.push(expression);
        }
      }

      ts.forEachChild(node, visitBody);
    };

    ts.forEachChild(body, visitBody);

    return found;
  };

  const indexLocalFunctions: (node: ts.Node) => void = (
    node: ts.Node,
  ): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      (ts.isArrowFunction(node.initializer) ||
        ts.isFunctionExpression(node.initializer))
    ) {
      localFunctionResults.set(
        node.name.text,
        collectReturnedObjects(node.initializer.body),
      );
    }

    if (ts.isFunctionDeclaration(node) && node.name && node.body) {
      localFunctionResults.set(
        node.name.text,
        collectReturnedObjects(node.body),
      );
    }

    ts.forEachChild(node, indexLocalFunctions);
  };

  indexLocalFunctions(sourceFile);

  // The schema an array element stands for: written inline, or returned.
  const schemasOf: (
    element: ts.Expression,
  ) => Array<ts.ObjectLiteralExpression> = (
    element: ts.Expression,
  ): Array<ts.ObjectLiteralExpression> => {
    const expression: ts.Expression = unwrap(element);

    if (ts.isObjectLiteralExpression(expression)) {
      return [expression];
    }

    if (
      ts.isCallExpression(expression) &&
      ts.isIdentifier(expression.expression)
    ) {
      return localFunctionResults.get(expression.expression.text) || [];
    }

    return [];
  };

  const schemaTitle: (node: ts.ObjectLiteralExpression) => string = (
    node: ts.ObjectLiteralExpression,
  ): string => {
    for (const property of node.properties) {
      if (
        ts.isPropertyAssignment(property) &&
        (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) &&
        property.name.text === "title"
      ) {
        return describeLabels(
          property.initializer,
          sourceFile,
          locale,
          "(no label)",
        );
      }
    }

    return "(no label)";
  };

  type FilledButtonLabelFunction = (node: ts.Node) => string | null;

  // The label of a filled <Button> written as this node, or null.
  const filledButtonLabel: FilledButtonLabelFunction = (
    node: ts.Node,
  ): string | null => {
    if (!ts.isJsxElement(node) && !ts.isJsxSelfClosingElement(node)) {
      return null;
    }

    const opening: JsxOpening = ts.isJsxElement(node)
      ? node.openingElement
      : node;

    if (!imports.buttons.has(tagNameOf(opening))) {
      return null;
    }

    const props: JsxProps = readProps(opening.attributes);

    if (!filledStyleOf(props.values.get("buttonStyle"))) {
      return null;
    }

    return describeLabels(
      props.values.get("title"),
      sourceFile,
      locale,
      "(no label)",
    );
  };

  type ChildLabelFunction = (child: ts.JsxChild) => string | null;

  /*
   * A child that renders a filled button: the button itself, `cond &&
   * <Button/>`, or a ternary with a filled button on either side (its sides
   * never render together, so it counts once).
   */
  const childLabel: ChildLabelFunction = (
    child: ts.JsxChild,
  ): string | null => {
    const direct: string | null = filledButtonLabel(child);

    if (direct) {
      return direct;
    }

    if (!ts.isJsxExpression(child) || !child.expression) {
      return null;
    }

    const expression: ts.Expression = unwrap(child.expression);

    if (
      ts.isBinaryExpression(expression) &&
      expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
    ) {
      return filledButtonLabel(unwrap(expression.right));
    }

    if (ts.isConditionalExpression(expression)) {
      return (
        filledButtonLabel(unwrap(expression.whenTrue)) ||
        filledButtonLabel(unwrap(expression.whenFalse))
      );
    }

    return null;
  };

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (ts.isArrayLiteralExpression(node)) {
      const labels: Array<string> = [];

      for (const element of node.elements) {
        const filledSchema: ts.ObjectLiteralExpression | undefined = schemasOf(
          element,
        ).find((schema: ts.ObjectLiteralExpression): boolean => {
          return filledStyleOf(schemaStyle(schema));
        });

        if (filledSchema) {
          labels.push(schemaTitle(filledSchema));
        }
      }

      if (labels.length > 1) {
        groups.push({
          file: fileName,
          line: lineOf(node, sourceFile),
          kind: "button-schemas",
          labels,
        });
      }
    }

    if (ts.isJsxElement(node) || ts.isJsxFragment(node)) {
      const labels: Array<string> = [];

      for (const child of node.children) {
        const label: string | null = childLabel(child);

        if (label) {
          labels.push(label);
        }
      }

      if (labels.length > 1) {
        groups.push({
          file: fileName,
          line: lineOf(node, sourceFile),
          kind: "sibling-buttons",
          labels,
        });
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return groups;
}

function parseSource(fileName: string, source: string): ts.SourceFile {
  return ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

interface SourceScan {
  sites: Array<DialogSite>;
  findings: Array<DialogFinding>;
}

function scanSource(
  fileName: string,
  source: string,
  options: AnalyzeOptions,
): SourceScan {
  const locale: LocaleLookup = options.locale || NO_LOCALE;
  const sourceFile: ts.SourceFile = parseSource(fileName, source);
  const imports: ImportedComponents = readImports(sourceFile, fileName);
  const scan: SourceScan = { sites: [], findings: [] };

  if (imports.dialogs.size === 0) {
    return scan;
  }

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const opening: JsxOpening = ts.isJsxElement(node)
        ? node.openingElement
        : node;
      const component: DialogComponentName | undefined = imports.dialogs.get(
        tagNameOf(opening),
      );

      if (component) {
        scan.sites.push({
          file: fileName,
          line: lineOf(node, sourceFile),
          component,
          title: describeLabels(
            readProps(opening.attributes).values.get("title"),
            sourceFile,
            locale,
            "(untitled)",
          ),
        });
        scan.findings.push(
          ...analyzeDialog(
            fileName,
            node,
            opening,
            component,
            sourceFile,
            imports,
            locale,
          ),
        );
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return scan;
}

function footerVariantsOf(
  contract: DialogContract,
  props: JsxProps,
  sourceFile: ts.SourceFile,
  locale: LocaleLookup,
  styleEnums: ReadonlySet<string>,
): Array<FooterVariant> {
  const prop: (name: string | null) => ts.Expression | null | undefined = (
    name: string | null,
  ): ts.Expression | null | undefined => {
    return name ? props.values.get(name) : undefined;
  };

  const presence: (
    always: boolean,
    name: string,
  ) => Array<Branch<boolean>> = (
    always: boolean,
    name: string,
  ): Array<Branch<boolean>> => {
    if (always) {
      return single(true);
    }

    if (!props.values.has(name)) {
      return single(false);
    }

    const expression: ts.Expression | null | undefined = props.values.get(name);

    return expression ? readPresence(expression, sourceFile) : single(true);
  };

  const label: (
    name: string | null,
    fallback: string,
  ) => Array<Branch<string>> = (
    name: string | null,
    fallback: string,
  ): Array<Branch<string>> => {
    const expression: ts.Expression | null | undefined = prop(name);

    return expression
      ? readLabel(expression, sourceFile, locale, fallback)
      : single(fallback);
  };

  const style: (
    name: string | null,
    fallback: StyleName,
  ) => Array<Branch<StyleName>> = (
    name: string | null,
    fallback: StyleName,
  ): Array<Branch<StyleName>> => {
    const expression: ts.Expression | null | undefined = prop(name);

    return expression
      ? readStyle(expression, sourceFile, fallback, styleEnums)
      : single(fallback);
  };

  const combinations: Array<Array<unknown>> = combine([
    presence(contract.cancelAlways, "onClose") as Array<Branch<unknown>>,
    label(contract.cancelTextProp, contract.defaultCancelText) as Array<
      Branch<unknown>
    >,
    style(contract.cancelStyleProp, "NORMAL") as Array<Branch<unknown>>,
    presence(contract.submitAlways, "onSubmit") as Array<Branch<unknown>>,
    label("submitButtonText", contract.defaultSubmitText) as Array<
      Branch<unknown>
    >,
    style(contract.submitStyleProp, DEFAULT_STYLE) as Array<Branch<unknown>>,
  ]);

  return combinations.map((values: Array<unknown>): FooterVariant => {
    const hasCancel: boolean = values[0] as boolean;
    const submitStyle: StyleName | null = values[5] as StyleName | null;

    return {
      hasCancel,
      cancelLabel: values[1] as string | null,
      cancelStyle: values[2] as StyleName | null,
      hasSubmit: values[3] as boolean,
      submitLabel: values[4] as string | null,
      submitStyle:
        submitStyle === DEFAULT_STYLE
          ? contract.defaultSubmitStyle(hasCancel)
          : submitStyle,
    };
  });
}

function analyzeDialog(
  fileName: string,
  node: ts.JsxElement | ts.JsxSelfClosingElement,
  opening: JsxOpening,
  component: DialogComponentName,
  sourceFile: ts.SourceFile,
  imports: ImportedComponents,
  locale: LocaleLookup,
): Array<DialogFinding> {
  const contract: DialogContract = DIALOG_CONTRACTS[component];
  const props: JsxProps = readProps(opening.attributes);
  const findings: Array<DialogFinding> = [];

  /*
   * A wrapper that forwards its own props with a spread (BasicFormModal hands
   * `{...props}` to Modal) has no footer of its own to judge: whatever the
   * spread carries decides it, and the wrapper's callers are scanned instead.
   */
  if (props.hasSpread) {
    return findings;
  }

  const line: number = lineOf(node, sourceFile);
  const title: string = describeLabels(
    props.values.get("title"),
    sourceFile,
    locale,
    "(untitled)",
  );

  const report: (rule: DialogRule, message: string) => void = (
    rule: DialogRule,
    message: string,
  ): void => {
    const alreadyReported: boolean = findings.some(
      (finding: DialogFinding): boolean => {
        return finding.rule === rule && finding.message === message;
      },
    );

    if (!alreadyReported) {
      findings.push({
        file: fileName,
        line,
        component,
        rule,
        title,
        message,
      });
    }
  };

  const variants: Array<FooterVariant> = footerVariantsOf(
    contract,
    props,
    sourceFile,
    locale,
    imports.styleEnums,
  );
  let mostFilledInTheFooter: number = 0;

  for (const variant of variants) {
    const cancelLabel: string = variant.cancelLabel ?? "the close button";
    let filledInTheFooter: number = 0;

    if (variant.hasCancel) {
      if (
        variant.cancelStyle !== null &&
        FILLED_STYLES.has(variant.cancelStyle)
      ) {
        filledInTheFooter++;
      }

      if (
        variant.cancelStyle !== null &&
        COLOURED_STYLES.has(variant.cancelStyle)
      ) {
        report(
          "cancel-coloured",
          `"${cancelLabel}" only closes the dialog but is drawn ${variant.cancelStyle}; a way out is NORMAL or OUTLINE, and colour is kept for the action`,
        );
      }
    }

    if (variant.hasSubmit) {
      if (
        variant.submitStyle !== null &&
        FILLED_STYLES.has(variant.submitStyle)
      ) {
        filledInTheFooter++;
      }

      const submitLabel: string | null = variant.submitLabel;

      if (submitLabel !== null && isDismissalLabel(submitLabel)) {
        if (
          variant.submitStyle !== null &&
          COLOURED_STYLES.has(variant.submitStyle)
        ) {
          report(
            "dismissal-coloured",
            `"${submitLabel}" only closes the dialog but is drawn ${variant.submitStyle}; draw it NORMAL - colour says "this does something"`,
          );
        }

        if (variant.hasCancel) {
          report(
            "two-dismissals",
            `the footer offers both "${cancelLabel}" and "${submitLabel}", and both only close the dialog; keep one way out (a notice drops onSubmit and sets closeButtonText, or drops onClose)`,
          );
        }
      } else if (submitLabel !== null && isDestructiveLabel(submitLabel)) {
        if (variant.submitStyle !== "DANGER") {
          report(
            "destructive-not-danger",
            `"${submitLabel}" destroys something but is drawn ${describeStyle(variant.submitStyle)}; draw it DANGER`,
          );
        }
      } else if (
        submitLabel !== null &&
        variant.submitStyle !== null &&
        !ACTION_STYLES.has(variant.submitStyle)
      ) {
        report(
          "action-not-primary",
          `"${submitLabel}" is what the dialog is for but is drawn ${variant.submitStyle}; the affirmative action is the one PRIMARY button (DANGER when it destroys something)`,
        );
      }
    }

    mostFilledInTheFooter = Math.max(mostFilledInTheFooter, filledInTheFooter);
  }

  /*
   * Every other filled button written inside the dialog, in its children or
   * any prop: leftFooterElement, rightElement, or a body built inline.
   */
  const extras: Array<FilledButtonSite> = [];

  for (const property of opening.attributes.properties) {
    if (
      ts.isJsxAttribute(property) &&
      property.initializer &&
      ts.isJsxExpression(property.initializer) &&
      property.initializer.expression
    ) {
      const name: string = property.name.getText();

      // The footer's own style props were read above.
      if (name === contract.submitStyleProp || name === contract.cancelStyleProp) {
        continue;
      }

      extras.push(
        ...findFilledButtons(
          property.initializer.expression,
          sourceFile,
          imports,
          locale,
        ),
      );
    }
  }

  if (ts.isJsxElement(node)) {
    for (const child of node.children) {
      extras.push(...findFilledButtons(child, sourceFile, imports, locale));
    }
  }

  // A button drawn once per row counts as many.
  const filledCount: number =
    mostFilledInTheFooter +
    extras.reduce((count: number, extra: FilledButtonSite): number => {
      return count + (extra.repeated ? 2 : 1);
    }, 0);

  if (filledCount > 1) {
    const where: Array<string> = extras.map(
      (extra: FilledButtonSite): string => {
        return `"${extra.label}" ${extra.style} (line ${extra.line}${
          extra.repeated ? ", once per row" : ""
        })`;
      },
    );

    if (mostFilledInTheFooter > 0) {
      where.unshift("the footer's own action");
    }

    report(
      "two-primaries",
      `more than one filled button (PRIMARY, DANGER, SUCCESS or WARNING) may be drawn at once - ${where.join(", ")}; a dialog has exactly one primary button, the action it exists for, and the rest are NORMAL or OUTLINE`,
    );
  }

  return findings;
}

/*
 * The English locale of the feature set a file belongs to, as a lookup from
 * translation key to text. Common's own components translate English text,
 * which needs no lookup; they get Dashboard's, where most of them live.
 */
export function loadLocaleFor(
  repositoryRoot: string,
  relativeFile: string,
  cache: Map<string, LocaleLookup>,
): LocaleLookup {
  const match: RegExpMatchArray | null = relativeFile.match(
    /^packages\/App\/FeatureSet\/([^/]+)\//,
  );
  const featureSet: string = match
    ? match[1]!
    : relativeFile.startsWith("ee/AdminDashboard/")
      ? "AdminDashboard"
      : "Dashboard";
  const cached: LocaleLookup | undefined = cache.get(featureSet);

  if (cached) {
    return cached;
  }

  const localeFile: string = path.join(
    repositoryRoot,
    "packages",
    "App",
    "FeatureSet",
    featureSet,
    "src",
    "Locales",
    "en.json",
  );
  let dictionary: Record<string, unknown> = {};

  if (fs.existsSync(localeFile)) {
    dictionary = JSON.parse(fs.readFileSync(localeFile, "utf8")) as Record<
      string,
      unknown
    >;
  }

  const lookup: LocaleLookup = (key: string): string | null => {
    const flat: unknown = dictionary[key];

    if (typeof flat === "string") {
      return flat;
    }

    let current: unknown = dictionary;

    for (const segment of key.split(".")) {
      if (
        current === null ||
        typeof current !== "object" ||
        !(segment in (current as Record<string, unknown>))
      ) {
        return null;
      }

      current = (current as Record<string, unknown>)[segment];
    }

    return typeof current === "string" ? current : null;
  };

  cache.set(featureSet, lookup);

  return lookup;
}

export function formatDialogFindings(findings: Array<DialogFinding>): string {
  return findings
    .map((finding: DialogFinding): string => {
      return `${finding.file}:${finding.line} <${finding.component}> "${finding.title}" [${finding.rule}]: ${finding.message}`;
    })
    .join("\n");
}
