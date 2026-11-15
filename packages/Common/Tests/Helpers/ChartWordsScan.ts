import ts from "typescript";

/*
 * THE WORDS A PAGE HANDS ITS METRIC CHARTS (#8047).
 *
 * A page of metric charts hands each chart a title, a description and a
 * legend (metricAliasData), and the chart draws them exactly as handed. A
 * page writes them in one of three shapes:
 *
 *   - in the metricAliasData literal itself: `title: "CPU Utilization"`;
 *   - in a chart's spec, which a builder turns into metricAliasData: the
 *     objects a page lists (`{ variable, title, legend, metricName }`) or
 *     hands a query builder (getOpenStackMetricQuery({ title, legend })), told
 *     apart from a card's props by their `legend` beside a metric's name or
 *     variable;
 *   - or worded where it is written: `title: tx("CPU Utilization")`, a
 *     description built with translateTemplate around a node's name.
 *
 * This reads those shapes from a page's syntax tree, so a guard can hold a
 * page to handing its English through chartWordsInReadersLanguage once, or
 * to wording each literal where it writes it, and never both.
 */

export const CHART_WORD_PROPERTIES: ReadonlyArray<string> = [
  "title",
  "description",
  "legend",
];

export const CHART_WORDS_HELPER: string = "chartWordsInReadersLanguage";

// A call that looks its words up: tx(), t(), translator.translateText(), ...
const LOOKUP_CALL: RegExp = /(^|\.)(tx|t|translate[A-Za-z]*)$/;

export type ChartWordKind = "english" | "worded" | "other";

export interface ChartWord {
  property: string;
  kind: ChartWordKind;
  // The English, for a literal and for a lookup of a literal.
  text: string | undefined;
  line: number;
  // In a metricAliasData literal, or in a chart's spec.
  holder: "alias" | "spec";
}

export interface ChartWordsOfSource {
  words: Array<ChartWord>;
  callsHelper: boolean;
}

function propertyName(
  property: ts.ObjectLiteralElementLike,
  sourceFile: ts.SourceFile,
): string | undefined {
  if (!ts.isPropertyAssignment(property)) {
    return undefined;
  }

  const name: ts.PropertyName = property.name;

  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) {
    return name.text;
  }

  return name.getText(sourceFile);
}

function stringOf(node: ts.Expression): string | undefined {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }

  return undefined;
}

function kindOf(
  node: ts.Expression,
  sourceFile: ts.SourceFile,
): { kind: ChartWordKind; text: string | undefined } {
  const literal: string | undefined = stringOf(node);

  if (literal !== undefined) {
    return { kind: literal ? "english" : "other", text: literal };
  }

  // translationKey("...") marks a key for the locales: it is still English.
  if (
    ts.isCallExpression(node) &&
    node.expression.getText(sourceFile) === "translationKey" &&
    node.arguments[0] &&
    stringOf(node.arguments[0]) !== undefined
  ) {
    return { kind: "english", text: stringOf(node.arguments[0]) };
  }

  // `translator.translateText(x) || x` words its x.
  const expression: ts.Expression =
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.BarBarToken
      ? node.left
      : node;

  if (
    ts.isCallExpression(expression) &&
    LOOKUP_CALL.test(expression.expression.getText(sourceFile))
  ) {
    const first: ts.Expression | undefined = expression.arguments[0];

    return {
      kind: "worded",
      text: first ? stringOf(first) : undefined,
    };
  }

  return { kind: "other", text: undefined };
}

function isSpec(
  node: ts.ObjectLiteralExpression,
  sourceFile: ts.SourceFile,
): boolean {
  const names: Set<string> = new Set<string>();

  for (const property of node.properties) {
    const name: string | undefined = propertyName(property, sourceFile);

    if (name) {
      names.add(name);
    }
  }

  return (
    names.has("legend") &&
    names.has("title") &&
    (names.has("metricName") || names.has("variable"))
  );
}

export function readChartWords(
  fileName: string,
  source: string,
): ChartWordsOfSource {
  const sourceFile: ts.SourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const words: Array<ChartWord> = [];
  let callsHelper: boolean = false;

  const readHolder: (
    holder: ts.ObjectLiteralExpression,
    kind: "alias" | "spec",
  ) => void = (
    holder: ts.ObjectLiteralExpression,
    kind: "alias" | "spec",
  ): void => {
    for (const property of holder.properties) {
      const name: string | undefined = propertyName(property, sourceFile);

      if (
        !name ||
        !CHART_WORD_PROPERTIES.includes(name) ||
        !ts.isPropertyAssignment(property)
      ) {
        continue;
      }

      const read: { kind: ChartWordKind; text: string | undefined } = kindOf(
        property.initializer,
        sourceFile,
      );

      words.push({
        property: name,
        kind: read.kind,
        text: read.text,
        line:
          sourceFile.getLineAndCharacterOfPosition(
            property.getStart(sourceFile),
          ).line + 1,
        holder: kind,
      });
    }
  };

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(sourceFile) === CHART_WORDS_HELPER
    ) {
      callsHelper = true;
    }

    if (
      ts.isPropertyAssignment(node) &&
      propertyName(node, sourceFile) === "metricAliasData" &&
      ts.isObjectLiteralExpression(node.initializer)
    ) {
      readHolder(node.initializer, "alias");
    } else if (ts.isObjectLiteralExpression(node) && isSpec(node, sourceFile)) {
      readHolder(node, "spec");
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return { words, callsHelper };
}

export interface ChartWordsProblem {
  line: number;
  problem: string;
}

/*
 * What is wrong with how a page hands its charts their words:
 *
 *   - an English literal the chart would draw as written: in a
 *     metricAliasData literal, or in a spec on a page that neither hands
 *     its queries through the helper nor looks the spec's words up where it
 *     builds the chart (`title: translator.translateText(spec.title)`);
 *   - a word looked up twice: worded by hand on a page that also hands its
 *     queries through the helper.
 */
export function getChartWordsProblems(
  words: ChartWordsOfSource,
): Array<ChartWordsProblem> {
  const problems: Array<ChartWordsProblem> = [];
  const buildsWordedCharts: boolean = words.words.some(
    (word: ChartWord): boolean => {
      return (
        word.holder === "alias" &&
        word.kind === "worded" &&
        word.property !== "description"
      );
    },
  );

  for (const word of words.words) {
    if (word.kind === "english" && !words.callsHelper) {
      if (word.holder === "alias") {
        problems.push({
          line: word.line,
          problem: `${word.property} "${word.text}" is handed to the chart in English: hand the queries through ${CHART_WORDS_HELPER}, or look it up where it is written`,
        });
      } else if (!buildsWordedCharts) {
        problems.push({
          line: word.line,
          problem: `the chart spec's ${word.property} "${word.text}" reaches the chart in English: hand the queries through ${CHART_WORDS_HELPER}`,
        });
      }
    }

    if (word.kind === "worded" && words.callsHelper) {
      problems.push({
        line: word.line,
        problem: `${word.property} is looked up here and again by ${CHART_WORDS_HELPER}: a translation looked up again can be an English key itself`,
      });
    }
  }

  return problems;
}

// Every English text a page hands its charts: literals and looked-up literals.
export function getChartWordTexts(words: ChartWordsOfSource): Array<string> {
  return Array.from(
    new Set(
      words.words
        .filter((word: ChartWord): boolean => {
          return word.kind !== "other" && Boolean(word.text);
        })
        .map((word: ChartWord): string => {
          return word.text as string;
        }),
    ),
  );
}
