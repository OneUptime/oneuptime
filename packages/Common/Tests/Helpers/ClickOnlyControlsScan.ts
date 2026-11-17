import ts from "typescript";
import { CONTROL_ROLES } from "./NestedControls";

/*
 * The detector behind the click-only controls guard
 * (Tests/UI/Components/ClickOnlyControlsGuard.test.ts).
 *
 * A `div`, `li` or `span` given an onClick and nothing else works with a
 * mouse and a finger only. Tab never reaches it, Enter and Space do nothing,
 * and a screen reader reads it as text: every item in the header's
 * notification bell, and going back to a finished step of a form, were like
 * that (#9136). The fix is a real control - `<button type="button">`, or a
 * link - which the keyboard reaches and presses with no code of its own.
 *
 * Read per module, through the TypeScript AST, so it sees each element as
 * written. An element is flagged when it is a plain element (lower-case tag)
 * that is not a control by its tag (a, button, input, select, textarea,
 * label, summary, option) and is handed an onClick, unless:
 *
 *   - it is given a control's role (role="button", role="tab" ...) and a
 *     tabIndex and a key handler: a control written by hand, the keyboard
 *     wired up by its author;
 *   - it is given an item role its container drives from the keyboard
 *     (option, menuitem, treeitem, gridcell, row): the listbox or menu moves
 *     the active item with the arrow keys and presses it with Enter;
 *   - its onClick only stops the click from reaching an element further out
 *     (`(e) => e.stopPropagation()`): it does nothing a person asked for.
 *
 * Anything else that is kept on purpose - a modal's backdrop, which Escape
 * also closes - is listed by the guard with its reason.
 */

export interface ClickOnlyElementInSource {
  file: string;
  line: number;
  // How the element is written: `div`, `li`, `span[role=button]`.
  element: string;
}

// Plain elements a keyboard reaches and presses by their tag.
const INTERACTIVE_TAGS: ReadonlyArray<string> = [
  "a",
  "button",
  "input",
  "select",
  "textarea",
  "label",
  "summary",
  "option",
];

/*
 * Items whose container takes the keys: the arrow keys move between them and
 * Enter presses the active one, so the item needs no tabIndex of its own.
 */
const CONTAINER_DRIVEN_ROLES: ReadonlyArray<string> = [
  "option",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "treeitem",
  "gridcell",
  "row",
];

const KEY_HANDLERS: ReadonlyArray<string> = [
  "onKeyDown",
  "onKeyUp",
  "onKeyPress",
];

// A plain element (button, div), not a component (Button, Link).
const INTRINSIC_TAG: RegExp = /^[a-z]/;

// Calls that only stop an event, not act on it.
const STOP_ONLY_CALL: RegExp =
  /^\w+\.(stopPropagation|preventDefault|nativeEvent\.stopImmediatePropagation)$/;

function lineOf(sourceFile: ts.SourceFile, node: ts.Node): number {
  return (
    sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
  );
}

function attributeOf(
  element: ts.JsxOpeningLikeElement,
  sourceFile: ts.SourceFile,
  name: string,
): ts.JsxAttribute | undefined {
  return element.attributes.properties.find(
    (property: ts.JsxAttributeLike): property is ts.JsxAttribute => {
      return (
        ts.isJsxAttribute(property) &&
        property.name.getText(sourceFile) === name
      );
    },
  );
}

/*
 * The texts an expression can be: a string, or either side of a condition
 * (`isClickable ? "button" : undefined` can be "button").
 */
function stringsOf(expression: ts.Expression): Array<string> {
  if (
    ts.isStringLiteral(expression) ||
    ts.isNoSubstitutionTemplateLiteral(expression)
  ) {
    return [expression.text];
  }

  if (ts.isParenthesizedExpression(expression)) {
    return stringsOf(expression.expression);
  }

  if (ts.isConditionalExpression(expression)) {
    return [
      ...stringsOf(expression.whenTrue),
      ...stringsOf(expression.whenFalse),
    ];
  }

  return [];
}

// The texts the attribute can hold (none when it is worked out otherwise).
function literalsOf(attribute: ts.JsxAttribute | undefined): Array<string> {
  if (!attribute) {
    return [];
  }

  const initializer: ts.JsxAttributeValue | undefined = attribute.initializer;

  if (!initializer) {
    return ["true"];
  }

  if (ts.isStringLiteral(initializer)) {
    return [initializer.text];
  }

  if (ts.isJsxExpression(initializer) && initializer.expression) {
    return stringsOf(initializer.expression);
  }

  return [];
}

// Whether a handler only stops the click: `(e) => e.stopPropagation()`.
function onlyStopsTheEvent(
  attribute: ts.JsxAttribute,
  sourceFile: ts.SourceFile,
): boolean {
  const initializer: ts.JsxAttributeValue | undefined = attribute.initializer;

  if (
    !initializer ||
    !ts.isJsxExpression(initializer) ||
    !initializer.expression
  ) {
    return false;
  }

  const handler: ts.Expression = initializer.expression;

  if (!ts.isArrowFunction(handler) && !ts.isFunctionExpression(handler)) {
    return false;
  }

  const isStopCall: (expression: ts.Expression) => boolean = (
    expression: ts.Expression,
  ): boolean => {
    return (
      ts.isCallExpression(expression) &&
      STOP_ONLY_CALL.test(expression.expression.getText(sourceFile))
    );
  };

  if (!ts.isBlock(handler.body)) {
    return isStopCall(handler.body);
  }

  return (
    handler.body.statements.length > 0 &&
    handler.body.statements.every((statement: ts.Statement): boolean => {
      return (
        ts.isExpressionStatement(statement) && isStopCall(statement.expression)
      );
    })
  );
}

function isKeyboardReachable(
  element: ts.JsxOpeningLikeElement,
  sourceFile: ts.SourceFile,
): boolean {
  const roles: Array<string> = literalsOf(
    attributeOf(element, sourceFile, "role"),
  );

  if (
    roles.some((role: string): boolean => {
      return CONTAINER_DRIVEN_ROLES.includes(role);
    })
  ) {
    return true;
  }

  /*
   * A role given only when the element does something
   * (`role={onClick ? "button" : undefined}`) counts: without it there is
   * no click either.
   */
  const hasControlRole: boolean = roles.some((role: string): boolean => {
    return CONTROL_ROLES.includes(role);
  });
  const hasTabIndex: boolean = Boolean(
    attributeOf(element, sourceFile, "tabIndex"),
  );
  const hasKeyHandler: boolean = KEY_HANDLERS.some((name: string): boolean => {
    return Boolean(attributeOf(element, sourceFile, name));
  });

  return hasControlRole && hasTabIndex && hasKeyHandler;
}

function describe(
  element: ts.JsxOpeningLikeElement,
  sourceFile: ts.SourceFile,
): string {
  const tagName: string = element.tagName.getText(sourceFile);
  const role: string | undefined = literalsOf(
    attributeOf(element, sourceFile, "role"),
  )[0];

  return role ? `${tagName}[role=${role}]` : tagName;
}

export function scanClickOnlyElements(
  fileName: string,
  sourceText: string,
): Array<ClickOnlyElementInSource> {
  const sourceFile: ts.SourceFile = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const found: Array<ClickOnlyElementInSource> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tagName: string = node.tagName.getText(sourceFile);
      const onClick: ts.JsxAttribute | undefined = attributeOf(
        node,
        sourceFile,
        "onClick",
      );

      if (
        onClick &&
        INTRINSIC_TAG.test(tagName) &&
        !INTERACTIVE_TAGS.includes(tagName) &&
        !onlyStopsTheEvent(onClick, sourceFile) &&
        !isKeyboardReachable(node, sourceFile)
      ) {
        found.push({
          file: fileName,
          line: lineOf(sourceFile, node),
          element: describe(node, sourceFile),
        });
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return found;
}

// `div` at a file: one finding as the guard's list writes it.
export function clickOnlyKey(found: ClickOnlyElementInSource): string {
  return found.element;
}
