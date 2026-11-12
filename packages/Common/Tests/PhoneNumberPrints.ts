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
 *     phoneNumberInLine.
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
    return /PhoneNumbers?Text$/.test(name) || /^getPhoneNumbers?$/.test(name);
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
 * Every phone number one module's source prints as it is: as a JSX child,
 * as a title, as a translated sentence's value.
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

  const record: (kind: PhoneNumberPrintKind, node: ts.Node) => void = (
    kind: PhoneNumberPrintKind,
    node: ts.Node,
  ): void => {
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

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
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
      return findPhoneNumberPrintSites(
        file,
        fs.readFileSync(file, "utf8"),
      ).map((site: PhoneNumberPrintSite): PhoneNumberPrintFinding => {
        return { ...site, file: toRelativePath(REPOSITORY_ROOT, file) };
      });
    },
  );
}

export function formatPhoneNumberPrintFindings(
  findings: Array<PhoneNumberPrintFinding>,
): string {
  return findings
    .map((finding: PhoneNumberPrintFinding): string => {
      return `${finding.file}:${finding.line} prints a phone number as it is (${finding.kind}): ${finding.text}`;
    })
    .join("\n");
}
