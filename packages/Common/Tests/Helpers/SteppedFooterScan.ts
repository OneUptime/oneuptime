import path from "path";
import ts from "typescript";
import { LocaleLookup } from "../DialogActionRules";

/*
 * Reads front-end source for what PrimaryActionLastStepGuard checks: that a
 * stepped form offers its primary action on its last step only, and that
 * Next is never primary (Common/UI/Components/Forms/Utils/
 * SteppedFormFooter.ts).
 *
 * The rules, per file:
 *   - next-label: every label that reads "Next" - the string itself, the
 *     NEXT_BUTTON_TEXT constant, or a translation key whose English is
 *     "Next" - is on a button that is not primary: a <Button> whose
 *     buttonStyle is not ButtonStyleType.PRIMARY, a native <button> without
 *     the primary colour, a dialog's secondaryButton (always plain), the
 *     nextButtonText of getSteppedModalFooter, or a constant whose every
 *     use is one of those. Anything else - a dialog's submitButtonText, a
 *     function that returns it, a place this scan cannot follow - is a
 *     problem.
 *   - submit-all-steps: BasicFormHandle.submitAllSteps, the call that
 *     submits a stepped form from wherever it is, is made only as the
 *     onAction of getSteppedModalFooter, which offers it on the last step
 *     only. (BasicForm itself is the one exception: it defines it.)
 *   - hosted-stepped-form: a BasicForm, ModelForm or BasicModelForm drawn
 *     with hideSubmitButton - its host draws the buttons - and with steps
 *     (written out, or possibly in a spread) is hosted in a file that builds
 *     its footer with getSteppedModalFooter.
 *   - retired: nothing names the finish-early machinery that offered a
 *     stepped form's action before its last step.
 */

export const NEXT_LABEL_TEXT: string = "Next";

export const NEXT_LABEL_CONSTANT: string = "NEXT_BUTTON_TEXT";

export const STEPPED_MODAL_FOOTER_FUNCTION: string = "getSteppedModalFooter";

// The file that defines submitAllSteps, and may call it.
export const BASIC_FORM_FILE: string =
  "packages/Common/UI/Components/Forms/BasicForm.tsx";

// The file that defines NEXT_BUTTON_TEXT.
export const STEPPED_FORM_FOOTER_FILE: string =
  "packages/Common/UI/Components/Forms/Utils/SteppedFormFooter.ts";

/*
 * What offered a stepped form's action before its last step (PR #4282's
 * FinishFromAnyStep and PR #4192's save-from-any-step). Retired on
 * 2026-10-04; a file naming any of them is bringing that back.
 */
export const RETIRED_NAMES: ReadonlyArray<string> = [
  "customElementCanBeSkipped",
  "canFinishFormFromStep",
  "onCanFinishFromCurrentStep",
  "isCustomElementToShowBeforeFinishing",
  "primaryButtonSubmitsAllSteps",
  "savesFromAnyStep",
  "saveFromAnyStep",
];

export const RETIRED_MODULE: string = "FinishFromAnyStep";

const HOSTED_FORM_TAGS: ReadonlySet<string> = new Set<string>([
  "BasicForm",
  "ModelForm",
  "BasicModelForm",
]);

const TRANSLATION_FUNCTIONS: ReadonlySet<string> = new Set<string>([
  "t",
  "tx",
  "translate",
  "translateText",
  "translateString",
  "translateValue",
  "translateTerm",
  "translationKey",
]);

// A native button wearing the primary colour (Button's PRIMARY classes).
const PRIMARY_COLOUR_CLASS: RegExp =
  /(^|\s)(hover:)?bg-indigo-(500|600|700)(\s|$)/;

const PRIMARY_STYLE: RegExp = /\bPRIMARY\b/;

const MAX_VARIABLE_DEPTH: number = 4;

export type SteppedFooterRule =
  | "next-label"
  | "submit-all-steps"
  | "hosted-stepped-form"
  | "retired";

export interface SteppedFooterProblem {
  file: string;
  line: number;
  rule: SteppedFooterRule;
  message: string;
}

export interface SteppedFooterFacts {
  file: string;
  // Labels that read Next, each where it was found.
  nextLabels: Array<{ line: number; isPlain: boolean; where: string }>;
  callsSteppedModalFooter: boolean;
  callsSubmitAllSteps: number;
  problems: Array<SteppedFooterProblem>;
}

interface Verdict {
  ok: boolean;
  where: string;
}

function lineOf(node: ts.Node, sourceFile: ts.SourceFile): number {
  return (
    sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
  );
}

function calleeName(call: ts.CallExpression): string | null {
  const callee: ts.Expression = call.expression;

  if (ts.isIdentifier(callee)) {
    return callee.text;
  }

  if (ts.isPropertyAccessExpression(callee)) {
    return callee.name.text;
  }

  return null;
}

function isTranslationCall(call: ts.CallExpression): boolean {
  const name: string | null = calleeName(call);
  return name !== null && TRANSLATION_FUNCTIONS.has(name);
}

function jsxTagName(
  element: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
): string {
  return element.tagName.getText();
}

function findAttribute(
  element: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
  name: string,
): ts.JsxAttribute | undefined {
  return element.attributes.properties.find(
    (property: ts.JsxAttributeLike): property is ts.JsxAttribute => {
      return ts.isJsxAttribute(property) && property.name.getText() === name;
    },
  );
}

function attributeText(
  attribute: ts.JsxAttribute | undefined,
  sourceFile: ts.SourceFile,
): string | null {
  if (!attribute) {
    return null;
  }

  if (!attribute.initializer) {
    return "true";
  }

  if (ts.isStringLiteral(attribute.initializer)) {
    return attribute.initializer.text;
  }

  return attribute.initializer.getText(sourceFile);
}

function isTrueAttribute(attribute: ts.JsxAttribute | undefined): boolean {
  if (!attribute) {
    return false;
  }

  if (!attribute.initializer) {
    return true;
  }

  return (
    ts.isJsxExpression(attribute.initializer) &&
    Boolean(attribute.initializer.expression) &&
    attribute.initializer.expression!.kind === ts.SyntaxKind.TrueKeyword
  );
}

/*
 * The object literal's place: the value of a JSX attribute or of a property
 * named `name`, perhaps through a condition or parentheses.
 */
function isValueOf(node: ts.Node, name: string): boolean {
  let current: ts.Node = node;

  while (current.parent) {
    const parent: ts.Node = current.parent;

    if (
      ts.isParenthesizedExpression(parent) ||
      ts.isAsExpression(parent) ||
      (ts.isConditionalExpression(parent) &&
        (parent.whenTrue === current || parent.whenFalse === current)) ||
      (ts.isBinaryExpression(parent) &&
        (parent.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ||
          parent.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
          parent.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken))
    ) {
      current = parent;
      continue;
    }

    if (ts.isJsxExpression(parent) && parent.parent) {
      return (
        ts.isJsxAttribute(parent.parent) &&
        parent.parent.name.getText() === name
      );
    }

    if (ts.isPropertyAssignment(parent) && parent.initializer === current) {
      return parent.name.getText() === name;
    }

    return false;
  }

  return false;
}

class FileScan {
  private readonly sourceFile: ts.SourceFile;
  private readonly file: string;
  private readonly locale: LocaleLookup;

  public constructor(data: {
    file: string;
    text: string;
    locale: LocaleLookup;
  }) {
    this.file = data.file;
    this.locale = data.locale;
    this.sourceFile = ts.createSourceFile(
      data.file,
      data.text,
      ts.ScriptTarget.Latest,
      true,
      data.file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
  }

  public scan(): SteppedFooterFacts {
    const facts: SteppedFooterFacts = {
      file: this.file,
      nextLabels: [],
      callsSteppedModalFooter: false,
      callsSubmitAllSteps: 0,
      problems: [],
    };

    const hostedForms: Array<ts.JsxOpeningElement | ts.JsxSelfClosingElement> =
      [];

    const visit: (node: ts.Node) => void = (node: ts.Node): void => {
      if (this.isNextLabel(node)) {
        const verdict: Verdict = this.judgePosition(node, 0);
        facts.nextLabels.push({
          line: lineOf(node, this.sourceFile),
          isPlain: verdict.ok,
          where: verdict.where,
        });

        if (!verdict.ok) {
          this.report(facts, node, "next-label", verdict.where);
        }
      }

      if (ts.isCallExpression(node)) {
        const name: string | null = calleeName(node);

        if (name === STEPPED_MODAL_FOOTER_FUNCTION) {
          facts.callsSteppedModalFooter = true;
        }

        if (name === "submitAllSteps") {
          facts.callsSubmitAllSteps += 1;

          if (
            this.file !== BASIC_FORM_FILE &&
            !this.isSteppedModalFooterAction(node)
          ) {
            this.report(
              facts,
              node,
              "submit-all-steps",
              `submitAllSteps() submits a stepped form from whichever step is on screen; call it only as the onAction of ${STEPPED_MODAL_FOOTER_FUNCTION}, which offers it on the last step`,
            );
          }
        }
      }

      if (
        (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
        HOSTED_FORM_TAGS.has(jsxTagName(node)) &&
        isTrueAttribute(findAttribute(node, "hideSubmitButton")) &&
        (findAttribute(node, "steps") ||
          node.attributes.properties.some(
            (property: ts.JsxAttributeLike): boolean => {
              return ts.isJsxSpreadAttribute(property);
            },
          ))
      ) {
        hostedForms.push(node);
      }

      if (ts.isIdentifier(node) && RETIRED_NAMES.includes(node.text)) {
        this.report(
          facts,
          node,
          "retired",
          `${node.text} belongs to the finish-early rule retired on 2026-10-04: a stepped form offers its action on its last step only`,
        );
      }

      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier) &&
        node.moduleSpecifier.text.includes(RETIRED_MODULE)
      ) {
        this.report(
          facts,
          node,
          "retired",
          `${node.moduleSpecifier.text} was retired on 2026-10-04: use Forms/Utils/SteppedFormFooter`,
        );
      }

      ts.forEachChild(node, visit);
    };

    visit(this.sourceFile);

    if (!facts.callsSteppedModalFooter) {
      for (const element of hostedForms) {
        this.report(
          facts,
          element,
          "hosted-stepped-form",
          `<${jsxTagName(element)} hideSubmitButton> with steps: its host draws the buttons, so build them with ${STEPPED_MODAL_FOOTER_FUNCTION} (Next until the last step, the action only there)`,
        );
      }
    }

    return facts;
  }

  private report(
    facts: SteppedFooterFacts,
    node: ts.Node,
    rule: SteppedFooterRule,
    message: string,
  ): void {
    facts.problems.push({
      file: this.file,
      line: lineOf(node, this.sourceFile),
      rule,
      message,
    });
  }

  // A label that reads Next.
  private isNextLabel(node: ts.Node): boolean {
    if (
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
      node.text === NEXT_LABEL_TEXT
    ) {
      // The constant's own definition: its uses are labels themselves.
      return !(
        node.parent &&
        ts.isVariableDeclaration(node.parent) &&
        node.parent.name.getText() === NEXT_LABEL_CONSTANT
      );
    }

    if (ts.isJsxText(node) && node.text.trim() === NEXT_LABEL_TEXT) {
      return true;
    }

    if (ts.isIdentifier(node) && node.text === NEXT_LABEL_CONSTANT) {
      const parent: ts.Node | undefined = node.parent;

      return !(
        parent &&
        ((ts.isVariableDeclaration(parent) && parent.name === node) ||
          ts.isImportSpecifier(parent) ||
          ts.isExportSpecifier(parent) ||
          ts.isImportClause(parent))
      );
    }

    // A translation key whose English is "Next" ("pages.something.next").
    if (
      ts.isCallExpression(node) &&
      isTranslationCall(node) &&
      node.arguments.length > 0 &&
      ts.isStringLiteralLike(node.arguments[0]!) &&
      (node.arguments[0] as ts.StringLiteralLike).text !== NEXT_LABEL_TEXT &&
      this.locale((node.arguments[0] as ts.StringLiteralLike).text) ===
        NEXT_LABEL_TEXT
    ) {
      return true;
    }

    return false;
  }

  // Whether a Next label sits on a button that is not primary.
  private judgePosition(node: ts.Node, depth: number): Verdict {
    let current: ts.Node = node;

    for (;;) {
      const parent: ts.Node | undefined = current.parent;

      if (!parent) {
        return { ok: false, where: "a place this scan cannot follow" };
      }

      if (
        ts.isParenthesizedExpression(parent) ||
        ts.isAsExpression(parent) ||
        ts.isNonNullExpression(parent) ||
        (ts.isConditionalExpression(parent) &&
          (parent.whenTrue === current || parent.whenFalse === current)) ||
        (ts.isBinaryExpression(parent) &&
          (parent.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ||
            parent.operatorToken.kind === ts.SyntaxKind.BarBarToken)) ||
        (ts.isCallExpression(parent) &&
          isTranslationCall(parent) &&
          parent.arguments.includes(current as ts.Expression))
      ) {
        current = parent;
        continue;
      }

      if (ts.isJsxExpression(parent)) {
        const owner: ts.Node | undefined = parent.parent;

        if (owner && ts.isJsxAttribute(owner)) {
          return this.judgeAttribute(owner);
        }

        if (owner && ts.isJsxElement(owner)) {
          return this.judgeElementText(owner);
        }

        return { ok: false, where: "a JSX expression this scan cannot follow" };
      }

      if (ts.isJsxAttribute(parent)) {
        return this.judgeAttribute(parent);
      }

      if (ts.isJsxElement(parent) && ts.isJsxText(current)) {
        return this.judgeElementText(parent);
      }

      if (ts.isPropertyAssignment(parent) && parent.initializer === current) {
        return this.judgeProperty(parent);
      }

      if (ts.isVariableDeclaration(parent) && parent.initializer === current) {
        return this.judgeVariable(parent, depth);
      }

      if (ts.isReturnStatement(parent) || ts.isArrowFunction(parent)) {
        return {
          ok: false,
          where:
            "a function's return value - a label this scan cannot follow to its button (a dialog's submit text, say)",
        };
      }

      return {
        ok: false,
        where: `a ${ts.SyntaxKind[parent.kind]} this scan cannot follow`,
      };
    }
  }

  private judgeAttribute(attribute: ts.JsxAttribute): Verdict {
    const name: string = attribute.name.getText();
    const element: ts.Node = attribute.parent.parent;

    if (
      !ts.isJsxOpeningElement(element) &&
      !ts.isJsxSelfClosingElement(element)
    ) {
      return {
        ok: false,
        where: `the ${name} of an element this scan cannot read`,
      };
    }

    const tag: string = jsxTagName(element);

    if (name === "submitButtonText") {
      return {
        ok: false,
        where: `<${tag} submitButtonText>: a dialog's submit button is its primary action, so it never reads Next - offer Next as its secondaryButton (getSteppedModalFooter)`,
      };
    }

    if (tag === "Button" && (name === "title" || name === "ariaLabel")) {
      const style: string | null = attributeText(
        findAttribute(element, "buttonStyle"),
        this.sourceFile,
      );

      if (style !== null && PRIMARY_STYLE.test(style)) {
        return {
          ok: false,
          where: `<Button title> with buttonStyle ${style}: Next is never primary - use NEXT_BUTTON_STYLE`,
        };
      }

      return { ok: true, where: `<Button ${name}>` };
    }

    return {
      ok: false,
      where: `<${tag} ${name}>, which this scan cannot judge`,
    };
  }

  private judgeElementText(element: ts.JsxElement): Verdict {
    const tag: string = jsxTagName(element.openingElement);

    if (tag !== "button") {
      return {
        ok: false,
        where: `the text of <${tag}>, which this scan cannot judge`,
      };
    }

    const className: string | null = attributeText(
      findAttribute(element.openingElement, "className"),
      this.sourceFile,
    );

    if (className !== null && PRIMARY_COLOUR_CLASS.test(className)) {
      return {
        ok: false,
        where: "a <button> in the primary colour: Next is never primary",
      };
    }

    return { ok: true, where: "a plain <button>" };
  }

  private judgeProperty(property: ts.PropertyAssignment): Verdict {
    const name: string = property.name.getText();
    const object: ts.Node = property.parent;

    if (!ts.isObjectLiteralExpression(object)) {
      return { ok: false, where: `a ${name} this scan cannot follow` };
    }

    if (name === "title" && isValueOf(object, "secondaryButton")) {
      return { ok: true, where: "a dialog's secondaryButton (always plain)" };
    }

    if (
      name === "nextButtonText" &&
      object.parent &&
      ts.isCallExpression(object.parent) &&
      calleeName(object.parent) === STEPPED_MODAL_FOOTER_FUNCTION
    ) {
      return {
        ok: true,
        where: `${STEPPED_MODAL_FOOTER_FUNCTION}'s nextButtonText`,
      };
    }

    if (name === "title") {
      const style: ts.ObjectLiteralElementLike | undefined =
        object.properties.find(
          (element: ts.ObjectLiteralElementLike): boolean => {
            return (
              ts.isPropertyAssignment(element) &&
              element.name.getText() === "buttonStyle"
            );
          },
        );

      if (style && ts.isPropertyAssignment(style)) {
        const styleText: string = style.initializer.getText(this.sourceFile);

        return PRIMARY_STYLE.test(styleText)
          ? {
              ok: false,
              where: `a button with buttonStyle ${styleText}: Next is never primary`,
            }
          : { ok: true, where: "a button object that is not primary" };
      }
    }

    return {
      ok: false,
      where: `the ${name} of an object this scan cannot judge`,
    };
  }

  private judgeVariable(
    declaration: ts.VariableDeclaration,
    depth: number,
  ): Verdict {
    if (!ts.isIdentifier(declaration.name)) {
      return {
        ok: false,
        where: "a destructured value this scan cannot follow",
      };
    }

    if (depth >= MAX_VARIABLE_DEPTH) {
      return { ok: false, where: "a chain of values too long to follow" };
    }

    const name: string = declaration.name.text;
    const uses: Array<ts.Identifier> = [];

    const collect: (node: ts.Node) => void = (node: ts.Node): void => {
      if (
        ts.isIdentifier(node) &&
        node.text === name &&
        node !== declaration.name &&
        !(
          node.parent &&
          ((ts.isPropertyAccessExpression(node.parent) &&
            node.parent.name === node) ||
            (ts.isPropertyAssignment(node.parent) &&
              node.parent.name === node) ||
            ts.isJsxAttribute(node.parent))
        )
      ) {
        uses.push(node);
      }

      ts.forEachChild(node, collect);
    };

    collect(this.sourceFile);

    for (const use of uses) {
      const verdict: Verdict = this.judgePosition(use, depth + 1);

      if (!verdict.ok) {
        return {
          ok: false,
          where: `${name}, used as ${verdict.where} (line ${lineOf(use, this.sourceFile)})`,
        };
      }
    }

    return { ok: true, where: `${name}, used only on plain buttons` };
  }

  // Whether a submitAllSteps() call is the onAction of getSteppedModalFooter.
  private isSteppedModalFooterAction(call: ts.CallExpression): boolean {
    let current: ts.Node = call;

    while (current.parent) {
      const parent: ts.Node = current.parent;

      if (
        ts.isPropertyAssignment(parent) &&
        parent.name.getText() === "onAction" &&
        parent.parent &&
        ts.isObjectLiteralExpression(parent.parent) &&
        parent.parent.parent &&
        ts.isCallExpression(parent.parent.parent) &&
        calleeName(parent.parent.parent) === STEPPED_MODAL_FOOTER_FUNCTION
      ) {
        return true;
      }

      current = parent;
    }

    return false;
  }
}

export function scanSteppedFooterSource(data: {
  // Repository-relative, with forward slashes.
  file: string;
  text: string;
  locale?: LocaleLookup | undefined;
}): SteppedFooterFacts {
  return new FileScan({
    file: data.file.split(path.sep).join("/"),
    text: data.text,
    locale:
      data.locale ||
      ((): string | null => {
        return null;
      }),
  }).scan();
}

export function formatSteppedFooterProblems(
  problems: Array<SteppedFooterProblem>,
): string {
  return problems
    .map((problem: SteppedFooterProblem): string => {
      return `${problem.file}:${problem.line} [${problem.rule}] ${problem.message}`;
    })
    .join("\n");
}
