import ts from "typescript";

/*
 * Every whole class string a module can hand to a class attribute, read
 * through the TypeScript AST: each string literal, and each string a
 * template literal can become - every substitution filled with nothing or
 * with one of its string branches - so `sr-only ${wide ? "sm:not-sr-only" :
 * ""}` is read as the class lists it renders, "sr-only " and
 * "sr-only sm:not-sr-only".
 *
 * The suites that sweep the tree for a class shape use it:
 * ThemeGroupHoverReveal.test.ts hands each string to Theme.css's substring
 * selectors, and SrOnlyForeignRule.test.tsx hands each one to the sr-only
 * resolver in ResponsiveVisibility.ts. Both need the finished strings.
 *
 * Why this is not in ForeignHiddenRuleGuard.ts, which reads the same AST: the
 * guard asks a different question. It reads class *expressions* - which
 * pieces of one value meet, behind which branch, which piece carries the bare
 * class - so it can print one finding per offending string with the exact
 * rewrite. Expanding templates into finished strings would lose exactly that.
 * Two readers with two answers stay simpler apart than one reader with both.
 */

// A class string found in a module, and where.
export interface ClassCandidate {
  file: string;
  // The line the string (or the template) starts on.
  line: number;
  // Whitespace collapsed, ends trimmed.
  classText: string;
}

/*
 * A template with several substitutions expands to every combination of its
 * branches; this bounds that, far above anything a class template here needs.
 */
export const MAX_TEMPLATE_EXPANSIONS: number = 64;

export function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/*
 * The class text a substitution can contribute: its string literals (and
 * the expansions of a nested template), never a ternary's condition (`mode
 * === "x" ? ...` is not class text), and for `a && "b"` only the right-hand
 * side.
 */
export function stringOptionsOf(expression: ts.Expression): Array<string> {
  if (ts.isParenthesizedExpression(expression)) {
    return stringOptionsOf(expression.expression);
  }

  if (
    ts.isStringLiteral(expression) ||
    ts.isNoSubstitutionTemplateLiteral(expression)
  ) {
    return [expression.text];
  }

  if (ts.isTemplateExpression(expression)) {
    // eslint-disable-next-line @typescript-eslint/no-use-before-define
    return expandTemplate(expression);
  }

  if (ts.isConditionalExpression(expression)) {
    return [
      ...stringOptionsOf(expression.whenTrue),
      ...stringOptionsOf(expression.whenFalse),
    ];
  }

  if (ts.isBinaryExpression(expression)) {
    const operator: ts.SyntaxKind = expression.operatorToken.kind;

    if (operator === ts.SyntaxKind.AmpersandAmpersandToken) {
      return stringOptionsOf(expression.right);
    }

    if (
      operator === ts.SyntaxKind.BarBarToken ||
      operator === ts.SyntaxKind.QuestionQuestionToken
    ) {
      return [
        ...stringOptionsOf(expression.left),
        ...stringOptionsOf(expression.right),
      ];
    }
  }

  return [];
}

/*
 * Every class string a template literal can produce: each substitution
 * filled with nothing or with one of its string branches, so
 * `a ${x ? "" : "b c"}` yields "a " and "a b c". At most
 * MAX_TEMPLATE_EXPANSIONS, the first ones in that order.
 */
export function expandTemplate(template: ts.TemplateExpression): Array<string> {
  let results: Array<string> = [template.head.text];

  for (const span of template.templateSpans) {
    const options: Array<string> = ["", ...stringOptionsOf(span.expression)];
    const next: Array<string> = [];

    for (const prefix of results) {
      for (const option of options) {
        if (next.length < MAX_TEMPLATE_EXPANSIONS) {
          next.push(`${prefix}${option}${span.literal.text}`);
        }
      }
    }

    results = next;
  }

  return results;
}

/*
 * Every string a module can hand to a class attribute: string literals, and
 * each expansion of a template literal (whose own substitutions are covered
 * by that expansion, so they are not read a second time). Every literal is a
 * candidate, a ternary's condition included - callers filter for the class
 * shape they are after.
 */
export function collectClassCandidates(
  relativePath: string,
  sourceText: string,
): Array<ClassCandidate> {
  const sourceFile: ts.SourceFile = ts.createSourceFile(
    relativePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    relativePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const candidates: Array<ClassCandidate> = [];

  const add: (node: ts.Node, text: string) => void = (
    node: ts.Node,
    text: string,
  ): void => {
    candidates.push({
      file: relativePath,
      line:
        sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
          .line + 1,
      classText: collapseWhitespace(text),
    });
  };

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      add(node, node.text);
      return;
    }

    if (ts.isTemplateExpression(node)) {
      for (const expansion of expandTemplate(node)) {
        add(node, expansion);
      }
      return;
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return candidates;
}

// `file:line "class text"`, for a failure message that reads as a list.
export function describeCandidate(candidate: ClassCandidate): string {
  return `${candidate.file}:${candidate.line} "${candidate.classText}"`;
}
