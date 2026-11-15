// UX rule: Docs/ux/README.md#in-every-language
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";
import { listScanRoots, listSourceFiles } from "../../ForeignHiddenRuleGuard";

/*
 * NO PAGE DRAWS AN ATTRIBUTE FILTER'S OPERATOR AS ITS ENGLISH SYMBOL (#7931).
 *
 * An attribute filter's operator (DictionaryFilterOperatorOption) has a
 * `symbol`: "=" or ">" for some, and English words for the rest - "matches",
 * "is any of", "is empty". The picker hands it to a Dropdown, which looks
 * it up in the reader's language. Three places that sum a picked filter up
 * drew it as it is instead - the filter bar's chip (FilterViewer), a metric
 * query's collapsed chips (MetricQueryConfig) and a metric chart's details
 * (MetricCharts) - so a German chip said "matches" under a form that said
 * "stimmt überein", glued in English order between the key and the value.
 *
 * Each of them says the filter as one sentence now, through
 * DictionaryFilterSentence. This reads every front end's source through the
 * TypeScript AST and fails on a file that reads an option's `.symbol` (in a
 * file that works with the filter operators) unless it is listed below with
 * the reason it reaches the reader translated.
 */

const REPOSITORY_ROOT: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
);

// The files that read a symbol and hand it on to be translated, each with why.
const READS_THE_SYMBOL_TRANSLATED: Record<string, string> = {
  "packages/Common/UI/Components/Dictionary/Dictionary.tsx":
    "The operator picker: the symbol is a Dropdown option's label, which the Dropdown looks up in the reader's language.",
};

// The places that sum a filter up, each drawing it as one sentence.
const SUMMARIES: Record<string, string> = {
  "packages/Common/UI/Components/Filters/FilterViewer.tsx":
    "the filter bar's chip",
  "packages/App/FeatureSet/Dashboard/src/Components/Metrics/MetricQueryConfig.tsx":
    "a metric query's collapsed chips",
  "packages/Common/UI/Components/Charts/ChartGroup/ChartGroup.tsx":
    "a metric chart's details, which MetricCharts fills",
};

const OPERATORS_MODULE: RegExp = /\/DictionaryFilterOperator["']/;

// Where a source reads `<something>.symbol`, by line.
export function symbolReads(fileName: string, text: string): Array<number> {
  if (!OPERATORS_MODULE.test(text)) {
    return [];
  }

  const source: ts.SourceFile = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const lines: Array<number> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (ts.isPropertyAccessExpression(node) && node.name.text === "symbol") {
      lines.push(
        source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
      );
    }

    if (
      ts.isElementAccessExpression(node) &&
      ts.isStringLiteral(node.argumentExpression) &&
      node.argumentExpression.text === "symbol"
    ) {
      lines.push(
        source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
      );
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  return lines;
}

function relative(file: string): string {
  return path.relative(REPOSITORY_ROOT, file).split(path.sep).join("/");
}

function scan(): Array<string> {
  const findings: Array<string> = [];

  for (const root of listScanRoots(REPOSITORY_ROOT)) {
    for (const file of listSourceFiles(root)) {
      const name: string = relative(file);

      if (READS_THE_SYMBOL_TRANSLATED[name]) {
        continue;
      }

      for (const line of symbolReads(name, fs.readFileSync(file, "utf8"))) {
        findings.push(`${name}:${line}`);
      }
    }
  }

  return findings;
}

describe("an attribute filter's operator is never drawn as its English symbol", () => {
  test("no front end reads a filter operator's symbol outside the picker", () => {
    expect(scan()).toEqual([]);
  });

  test("the scan reads the front ends and the shared components", () => {
    const roots: Array<string> = listScanRoots(REPOSITORY_ROOT).map(relative);

    expect(roots).toEqual(
      expect.arrayContaining([
        "packages/Common/UI",
        "packages/App/FeatureSet/Dashboard/src",
      ]),
    );
  });

  test("each file listed still reads the symbol, for the reason given", () => {
    for (const name of Object.keys(READS_THE_SYMBOL_TRANSLATED)) {
      const text: string = fs.readFileSync(
        path.join(REPOSITORY_ROOT, name),
        "utf8",
      );

      expect({ name, reads: symbolReads(name, text).length > 0 }).toEqual({
        name,
        reads: true,
      });
    }

    // The picker's symbol is an option label: the Dropdown translates it.
    expect(
      fs.readFileSync(
        path.join(
          REPOSITORY_ROOT,
          "packages/Common/UI/Components/Dictionary/Dictionary.tsx",
        ),
        "utf8",
      ),
    ).toMatch(/label: option\.symbol,/);
  });

  test("each summary says the filter through DictionaryFilterSentence", () => {
    for (const name of Object.keys(SUMMARIES)) {
      const text: string = fs.readFileSync(
        path.join(REPOSITORY_ROOT, name),
        "utf8",
      );

      expect({
        name,
        sentence: text.includes("<DictionaryFilterSentence"),
      }).toEqual({
        name,
        sentence: true,
      });
    }
  });

  test("a metric chart hands its details the filters as stored, for the sentence to say", () => {
    const charts: string = fs.readFileSync(
      path.join(
        REPOSITORY_ROOT,
        "packages/App/FeatureSet/Dashboard/src/Components/Metrics/MetricCharts.tsx",
      ),
      "utf8",
    );

    expect(charts).toContain("metricAttributes[key] = value;");
    expect(charts).toContain(
      "const metricAttributes: Dictionary<unknown> = {};",
    );
  });

  test("a chip drawn from the symbol is caught (control)", () => {
    // The filter bar's chip, as it was before #7931.
    const chip: string = [
      'import { getOperatorOption } from "../Dictionary/DictionaryFilterOperator";',
      "const Chip = (props) => {",
      "  const option = getOperatorOption(props.operator);",
      "  return (",
      "    <div>",
      '      <span className="font-medium">{props.attributeKey}</span>{" "}',
      "      <span>{option.symbol}</span>",
      "    </div>",
      "  );",
      "};",
    ].join("\n");

    expect(symbolReads("Chip.tsx", chip)).toEqual([7]);

    // The metric query's chip text, and the chart details' line.
    expect(
      symbolReads(
        "Query.tsx",
        [
          'import { getOperatorOption } from "Common/UI/Components/Dictionary/DictionaryFilterOperator";',
          "const text = `${key} ${option.symbol} ${value}`;",
          'const line = option["symbol"];',
        ].join("\n"),
      ),
    ).toEqual([2, 3]);

    // A symbol of anything else, in a file that has no filter operators, is not.
    expect(
      symbolReads("Currency.tsx", "const sign = currency.symbol;"),
    ).toEqual([]);
  });
});
