import fs from "fs";
import path from "path";
import ts from "typescript";
import {
  listScanRoots,
  listSourceFiles,
  toRelativePath,
} from "./ForeignHiddenRuleGuard";

/*
 * Where a browser module prints a phone number as it is
 * (PhoneNumberTextGuard).
 *
 * Issue #6605: the Twilio Config table printed each number in a plain
 * <span>, and on a Persian or Arabic page - laid out right to left - a run
 * of digits after a "+" takes the page's way: +447700900123 was drawn
 * 447700900123+. Every number the product prints now goes through one
 * component, PhoneNumberText (Common/UI/Components/PhoneNumber), an
 * isolate that reads left to right; a line that can only be text (a
 * sentence's value, a native tooltip) takes phoneNumberInLine or
 * phoneNumberListInLine (Common/Types/PhoneNumberDirection).
 *
 * This finds a number printed any other way, read through the TypeScript
 * AST so a comment or a string that says "phone" is not a finding:
 *
 *   - a JSX child that is a phone number: {line.phoneNumber},
 *     {item.phone?.toString()}, {phoneNumberText || "-"},
 *     {summary.visiblePhoneNumbers[0]}, {numbers.join(", ")};
 *   - a title (a native tooltip) that is one, or a list of them;
 *   - a translated sentence's value that is one - translateTemplate's
 *     second argument, a TranslatedSentence's values - not handed to
 *     phoneNumberInLine;
 *   - a PhoneNumberText spaced on one side (side spacing): a start or end
 *     margin or padding of its own (ml-2, sm:me-1, -ml-[22px], ps-1), or a
 *     space-x on the element it sits in. Tailwind's side utilities are
 *     written with logical properties here (TailwindReadingDirection:
 *     margin-inline-start for ml-2 and for space-x), and a logical side
 *     is the element's own: the number's isolate reads left to right, so
 *     its start is its left on a Persian page too. An incoming call
 *     policy's row, spaced with space-x-2, drew its number against the
 *     handset before it and 16px off "+1 more" after it. A row is spaced
 *     by its gap instead (flex gap-2), which is the row's own.
 *
 * A value is a phone number by its name: a variable, a property or a
 * function whose name says phone ("phone", "phoneNumber", "callerPhoneNumber",
 * "otherPhoneNumbers", "getIncomingCallPolicyPhoneNumberText"), never one
 * that says whether something is a phone ("isPhone", "isPhoneView") or how
 * many there are (".length"). A call that draws an element of its own
 * ("renderPhoneNumbers()") is not a value.
 */

export const REPOSITORY_ROOT: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
);

export enum PhoneNumberPrintKind {
  // A JSX child: drawn on the page.
  Child = "child",
  // A native tooltip.
  Title = "title",
  // A value of a translated sentence.
  SentenceValue = "sentence value",
  // A margin or padding on one side of the number's isolate.
  SideSpacing = "side spacing",
}

export interface PhoneNumberPrintSite {
  kind: PhoneNumberPrintKind;
  // 1-based.
  line: number;
  // The expression as written.
  text: string;
}

export interface PhoneNumberPrintFinding extends PhoneNumberPrintSite {
  // Relative to the repository root, with forward slashes.
  file: string;
}

// A name that holds a phone number, or a list of them.
const PHONE_NAME_REGEX: RegExp = /phone/i;

/*
 * A name that says something about a phone, not one: whether a window is a
 * phone's (isPhone, isPhoneView), how wide one is (PHONE_BELOW_WIDTH_IN_PX).
 */
const NOT_A_PHONE_NUMBER_NAME_REGEX: RegExp =
  /^(?:is|has|should|show|can|use)[A-Z_]|^[A-Z0-9_]+$|(?:Width|Height|Count|Length|Size|Index|Id|Ids|Sid|Error|Errors|Lock|Kind|Type|Label|Title|Description|Placeholder|Url|Route|Code|At|Date)$/;

// A function that gives a number's text: getIncomingCallPolicyPhoneNumberText.
const PHONE_NUMBER_TEXT_FUNCTION_REGEX: RegExp = /PhoneNumbers?Text$/;

// A function that gives a number, or the numbers: getPhoneNumber(s).
const GET_PHONE_NUMBER_FUNCTION_REGEX: RegExp = /^getPhoneNumbers?$/;

// The calls that set a number apart for a line of text.
export const PHONE_NUMBER_IN_LINE_FUNCTIONS: ReadonlyArray<string> = [
  "phoneNumberInLine",
  "phoneNumberListInLine",
];

// The calls that fill a translated sentence: (template, values, ...).
const SENTENCE_FUNCTIONS: ReadonlySet<string> = new Set<string>([
  "translateTemplate",
  "translateTemplateAround",
]);

// The JSX attributes a native tooltip is.
const TOOLTIP_ATTRIBUTES: ReadonlySet<string> = new Set<string>(["title"]);

// The component that draws one number, an isolate that reads left to right.
const PHONE_NUMBER_COMPONENT: string = "PhoneNumberText";

/*
 * A margin or padding on one side - ml, mr, ms, me, pl, pr, ps, pe, with
 * any breakpoint or state before it and negative or not - but not one on
 * both sides (mx, px), above or below (mt, my) or all round (m, p), which
 * are the same in either direction.
 */
const SIDE_SPACING_CLASS_REGEX: RegExp = /^-?[mp][lrse]-/;

// space-x-2: a start margin on every item of a row but its first.
const SPACE_X_CLASS_REGEX: RegExp = /^-?space-x-(?!reverse$)/;

// How many constants deep a class name is followed: A = B, B = "...".
const CLASS_NAME_CONSTANT_DEPTH: number = 4;

// The methods that turn a phone number (or a list of them) into its text.
const TEXT_METHODS: ReadonlySet<string> = new Set<string>([
  "toString",
  "join",
  "trim",
]);

// `x`, `(x)`, `x!` and `x as T` are all `x`.
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

export function isPhoneNumberName(name: string): boolean {
  return (
    PHONE_NAME_REGEX.test(name) && !NOT_A_PHONE_NUMBER_NAME_REGEX.test(name)
  );
}

// The name a call is made by: f(), a.f(), a?.f().
function calleeName(call: ts.CallExpression): string {
  const callee: ts.Expression = unwrap(call.expression);

  if (ts.isIdentifier(callee)) {
    return callee.text;
  }

  if (ts.isPropertyAccessExpression(callee)) {
    return callee.name.text;
  }

  return "";
}

/*
 * The expressions a value can come out as: both branches of a ternary,
 * either side of || and ??, the right side of &&.
 */
function valueBranches(expression: ts.Expression): Array<ts.Expression> {
  const target: ts.Expression = unwrap(expression);

  if (ts.isConditionalExpression(target)) {
    return [
      ...valueBranches(target.whenTrue),
      ...valueBranches(target.whenFalse),
    ];
  }

  if (ts.isBinaryExpression(target)) {
    const operator: ts.SyntaxKind = target.operatorToken.kind;

    if (
      operator === ts.SyntaxKind.BarBarToken ||
      operator === ts.SyntaxKind.QuestionQuestionToken
    ) {
      return [...valueBranches(target.left), ...valueBranches(target.right)];
    }

    if (operator === ts.SyntaxKind.AmpersandAmpersandToken) {
      return valueBranches(target.right);
    }
  }

  return [target];
}

// Whether one branch of a value is a phone number (or a list of them) as it is.
function isPhoneNumberValue(expression: ts.Expression): boolean {
  const target: ts.Expression = unwrap(expression);

  if (ts.isIdentifier(target)) {
    return isPhoneNumberName(target.text);
  }

  if (ts.isPropertyAccessExpression(target)) {
    return isPhoneNumberName(target.name.text);
  }

  if (ts.isElementAccessExpression(target)) {
    // numbers[0], line["phoneNumber"].
    if (
      ts.isStringLiteralLike(target.argumentExpression) &&
      isPhoneNumberName(target.argumentExpression.text)
    ) {
      return true;
    }

    return isPhoneNumberValue(target.expression);
  }

  if (ts.isCallExpression(target)) {
    const name: string = calleeName(target);

    if (PHONE_NUMBER_IN_LINE_FUNCTIONS.includes(name)) {
      return false;
    }

    // phone.toString(), numbers.join(", "), String(phone).
    if (TEXT_METHODS.has(name)) {
      const callee: ts.Expression = unwrap(target.expression);

      return (
        ts.isPropertyAccessExpression(callee) &&
        isPhoneNumberValue(callee.expression)
      );
    }

    if (name === "String" && target.arguments.length > 0) {
      return isPhoneNumberValue(target.arguments[0]!);
    }

    // getIncomingCallPolicyPhoneNumberText(x): a function that gives one.
    return (
      PHONE_NUMBER_TEXT_FUNCTION_REGEX.test(name) ||
      GET_PHONE_NUMBER_FUNCTION_REGEX.test(name)
    );
  }

  if (ts.isTemplateExpression(target)) {
    return target.templateSpans.some((span: ts.TemplateSpan): boolean => {
      return isPhoneNumberValue(span.expression);
    });
  }

  return false;
}

// Whether any branch of a value prints a phone number as it is.
export function printsPhoneNumber(expression: ts.Expression): boolean {
  return valueBranches(expression).some(isPhoneNumberValue);
}

function isSetApartForALine(expression: ts.Expression): boolean {
  return valueBranches(expression).every((branch: ts.Expression): boolean => {
    return (
      ts.isCallExpression(branch) &&
      PHONE_NUMBER_IN_LINE_FUNCTIONS.includes(calleeName(branch))
    );
  });
}

// The utilities a class list holds, each without its breakpoint or state.
function classUtilities(classTexts: Array<string>): Array<string> {
  return classTexts
    .join(" ")
    .split(/\s+/)
    .map((token: string): string => {
      return (token.split(":").pop() || "").replace(/^!/, "");
    })
    .filter((utility: string): boolean => {
      return utility.length > 0;
    });
}

/*
 * The literal text an element's className can be: a string, the pieces of
 * a template, either branch of a ternary, a call's arguments (clsx(...)),
 * a constant of the same module - read, as far as it can be read.
 */
function literalClassTexts(
  expression: ts.Expression,
  constants: ReadonlyMap<string, ts.Expression>,
  depth: number = 0,
): Array<string> {
  const target: ts.Expression = unwrap(expression);
  const read: (inner: ts.Expression) => Array<string> = (
    inner: ts.Expression,
  ): Array<string> => {
    return literalClassTexts(inner, constants, depth);
  };

  if (ts.isStringLiteralLike(target)) {
    return [target.text];
  }

  if (ts.isTemplateExpression(target)) {
    return [
      target.head.text,
      ...target.templateSpans.flatMap(
        (span: ts.TemplateSpan): Array<string> => {
          return [...read(span.expression), span.literal.text];
        },
      ),
    ];
  }

  if (ts.isConditionalExpression(target)) {
    return [...read(target.whenTrue), ...read(target.whenFalse)];
  }

  if (ts.isBinaryExpression(target)) {
    return [...read(target.left), ...read(target.right)];
  }

  if (ts.isCallExpression(target)) {
    return target.arguments.flatMap(read);
  }

  if (ts.isArrayLiteralExpression(target)) {
    return target.elements.flatMap(read);
  }

  if (ts.isIdentifier(target) && depth < CLASS_NAME_CONSTANT_DEPTH) {
    const value: ts.Expression | undefined = constants.get(target.text);

    return value ? literalClassTexts(value, constants, depth + 1) : [];
  }

  return [];
}

function classNameAttribute(
  attributes: ts.JsxAttributes,
): ts.JsxAttribute | undefined {
  return attributes.properties.find(
    (property: ts.JsxAttributeLike): property is ts.JsxAttribute => {
      return (
        ts.isJsxAttribute(property) &&
        ts.isIdentifier(property.name) &&
        property.name.text === "className"
      );
    },
  );
}

function classNameUtilities(
  attribute: ts.JsxAttribute,
  constants: ReadonlyMap<string, ts.Expression>,
): Array<string> {
  const initializer: ts.JsxAttributeValue | undefined = attribute.initializer;

  if (!initializer) {
    return [];
  }

  if (ts.isStringLiteral(initializer)) {
    return classUtilities([initializer.text]);
  }

  if (ts.isJsxExpression(initializer) && initializer.expression) {
    return classUtilities(literalClassTexts(initializer.expression, constants));
  }

  return [];
}

function isFragmentTag(tagName: ts.JsxTagNameExpression): boolean {
  const name: string = tagName.getText();

  return name === "Fragment" || name === "React.Fragment";
}

/*
 * The function a return statement or an arrow's body gives its value
 * from, if that function draws each item of a list: list.map(...).
 */
function mappingCall(
  fn: ts.ArrowFunction | ts.FunctionExpression,
): ts.CallExpression | undefined {
  const call: ts.Node = fn.parent;

  if (
    ts.isCallExpression(call) &&
    call.arguments.includes(fn) &&
    calleeName(call) === "map"
  ) {
    return call;
  }

  return undefined;
}

/*
 * The element a drawn element sits in on the page: through {...}, a
 * fragment, a ternary, an && or a list's map(), as far as the module says.
 */
function enclosingElement(element: ts.Node): ts.JsxElement | undefined {
  let current: ts.Node = element;

  while (current.parent) {
    const parent: ts.Node = current.parent;

    if (ts.isJsxElement(parent)) {
      if (!isFragmentTag(parent.openingElement.tagName)) {
        return parent;
      }

      current = parent;
      continue;
    }

    if (
      ts.isJsxFragment(parent) ||
      ts.isJsxExpression(parent) ||
      ts.isParenthesizedExpression(parent) ||
      ts.isConditionalExpression(parent) ||
      ts.isBinaryExpression(parent)
    ) {
      current = parent;
      continue;
    }

    let fn: ts.Node | undefined = undefined;

    if (ts.isArrowFunction(parent) && parent.body === current) {
      fn = parent;
    } else if (ts.isReturnStatement(parent)) {
      fn = parent.parent;

      while (
        fn &&
        !ts.isArrowFunction(fn) &&
        !ts.isFunctionExpression(fn) &&
        !ts.isFunctionDeclaration(fn) &&
        !ts.isMethodDeclaration(fn)
      ) {
        fn = fn.parent;
      }
    }

    const call: ts.CallExpression | undefined =
      fn && (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn))
        ? mappingCall(fn)
        : undefined;

    if (!call) {
      return undefined;
    }

    current = call;
  }

  return undefined;
}

// The constants of a module, by name: const A: string = "...".
function moduleConstants(
  sourceFile: ts.SourceFile,
): Map<string, ts.Expression> {
  const constants: Map<string, ts.Expression> = new Map<
    string,
    ts.Expression
  >();

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isVariableDeclarationList(node.parent) &&
      (node.parent.flags & ts.NodeFlags.Const) !== 0 &&
      !constants.has(node.name.text)
    ) {
      constants.set(node.name.text, node.initializer);
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return constants;
}

function propertyName(name: ts.PropertyName): string {
  if (
    ts.isIdentifier(name) ||
    ts.isStringLiteralLike(name) ||
    ts.isNumericLiteral(name)
  ) {
    return name.text;
  }

  return "";
}

/*
 * Every phone number one module's source prints as it is - as a JSX child,
 * as a title, as a translated sentence's value - and every PhoneNumberText
 * it spaces on one side.
 */
export function findPhoneNumberPrintSites(
  fileName: string,
  source: string,
): Array<PhoneNumberPrintSite> {
  const sourceFile: ts.SourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") || fileName.endsWith(".jsx")
      ? ts.ScriptKind.TSX
      : ts.ScriptKind.TS,
  );

  const sites: Array<PhoneNumberPrintSite> = [];
  const recorded: Set<string> = new Set<string>();
  const constants: Map<string, ts.Expression> = moduleConstants(sourceFile);

  const record: (kind: PhoneNumberPrintKind, node: ts.Node) => void = (
    kind: PhoneNumberPrintKind,
    node: ts.Node,
  ): void => {
    // A row's class names once, however many numbers sit in it.
    const key: string = `${kind} ${node.getStart(sourceFile)}`;

    if (recorded.has(key)) {
      return;
    }

    recorded.add(key);
    sites.push({
      kind: kind,
      line:
        sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
          .line + 1,
      text: node.getText(sourceFile),
    });
  };

  // A sentence's values: a phone number in one is set apart for a line.
  const checkSentenceValues: (values: ts.Expression) => void = (
    values: ts.Expression,
  ): void => {
    const target: ts.Expression = unwrap(values);

    if (!ts.isObjectLiteralExpression(target)) {
      return;
    }

    for (const property of target.properties) {
      if (ts.isShorthandPropertyAssignment(property)) {
        if (isPhoneNumberName(property.name.text)) {
          record(PhoneNumberPrintKind.SentenceValue, property);
        }

        continue;
      }

      if (!ts.isPropertyAssignment(property)) {
        continue;
      }

      const value: ts.Expression = property.initializer;

      if (
        (isPhoneNumberName(propertyName(property.name)) ||
          printsPhoneNumber(value)) &&
        !isSetApartForALine(value)
      ) {
        record(PhoneNumberPrintKind.SentenceValue, property);
      }
    }
  };

  // A number's isolate spaced on one side, by its own class or its row's.
  const checkSpacing: (
    element: ts.JsxSelfClosingElement | ts.JsxOpeningElement,
  ) => void = (
    element: ts.JsxSelfClosingElement | ts.JsxOpeningElement,
  ): void => {
    const own: ts.JsxAttribute | undefined = classNameAttribute(
      element.attributes,
    );

    if (
      own &&
      classNameUtilities(own, constants).some((utility: string): boolean => {
        return SIDE_SPACING_CLASS_REGEX.test(utility);
      })
    ) {
      record(PhoneNumberPrintKind.SideSpacing, own);
    }

    const row: ts.JsxElement | undefined = enclosingElement(
      ts.isJsxOpeningElement(element) ? element.parent : element,
    );
    const rowClassName: ts.JsxAttribute | undefined = row
      ? classNameAttribute(row.openingElement.attributes)
      : undefined;

    if (
      rowClassName &&
      classNameUtilities(rowClassName, constants).some(
        (utility: string): boolean => {
          return SPACE_X_CLASS_REGEX.test(utility);
        },
      )
    ) {
      record(PhoneNumberPrintKind.SideSpacing, rowClassName);
    }
  };

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) &&
      node.tagName.getText(sourceFile) === PHONE_NUMBER_COMPONENT
    ) {
      checkSpacing(node);
    }

    if (
      ts.isJsxExpression(node) &&
      node.expression &&
      node.parent &&
      (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent)) &&
      printsPhoneNumber(node.expression)
    ) {
      record(PhoneNumberPrintKind.Child, node);
    } else if (
      ts.isJsxAttribute(node) &&
      ts.isIdentifier(node.name) &&
      TOOLTIP_ATTRIBUTES.has(node.name.text) &&
      node.initializer &&
      ts.isJsxExpression(node.initializer) &&
      node.initializer.expression &&
      printsPhoneNumber(node.initializer.expression)
    ) {
      record(PhoneNumberPrintKind.Title, node);
    } else if (
      ts.isCallExpression(node) &&
      SENTENCE_FUNCTIONS.has(calleeName(node)) &&
      node.arguments.length > 1
    ) {
      checkSentenceValues(node.arguments[1]!);
    } else if (
      ts.isJsxAttribute(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === "values" &&
      node.initializer &&
      ts.isJsxExpression(node.initializer) &&
      node.initializer.expression
    ) {
      checkSentenceValues(node.initializer.expression);
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return sites;
}

// Every browser module the guard reads (.tsx and .ts), as absolute paths.
export function listPhoneNumberScanFiles(): Array<string> {
  return listScanRoots(REPOSITORY_ROOT)
    .flatMap(listSourceFiles)
    .filter((file: string): boolean => {
      return file.endsWith(".tsx") || file.endsWith(".ts");
    })
    .sort();
}

// What the guard finds in the whole tree.
export function scanPhoneNumberPrints(): Array<PhoneNumberPrintFinding> {
  return listPhoneNumberScanFiles().flatMap(
    (file: string): Array<PhoneNumberPrintFinding> => {
      return findPhoneNumberPrintSites(file, fs.readFileSync(file, "utf8")).map(
        (site: PhoneNumberPrintSite): PhoneNumberPrintFinding => {
          return { ...site, file: toRelativePath(REPOSITORY_ROOT, file) };
        },
      );
    },
  );
}

export function formatPhoneNumberPrintFindings(
  findings: Array<PhoneNumberPrintFinding>,
): string {
  return findings
    .map((finding: PhoneNumberPrintFinding): string => {
      const what: string =
        finding.kind === PhoneNumberPrintKind.SideSpacing
          ? "spaces a phone number by its start or end, its left and right on every page"
          : "prints a phone number as it is";

      return `${finding.file}:${finding.line} ${what} (${finding.kind}): ${finding.text}`;
    })
    .join("\n");
}
