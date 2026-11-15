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
 *
 * Two more places summed a filter up through formatDictionaryValueForDisplay,
 * which glues the operator's English label before the value ("contains
 * web"): the log monitor's criteria chips and a monitor's detail page
 * (#8309). They say the sentence too now, and the scan fails on a file that
 * calls that formatter unless it is listed with what its text is for: a key,
 * never a line a person reads.
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
  "packages/Common/UI/Components/TelemetryViewer/components/LockedFilterChip.tsx":
    "a locked chip: the log monitor's criteria preview, a page's pinned filters",
  "packages/Common/UI/Components/LogsViewer/components/ActiveFilterChips.tsx":
    "the logs viewer's removable chip of an operator's value",
  "packages/App/FeatureSet/Dashboard/src/Components/Monitor/MonitorSteps/AttributeFilterSentences.tsx":
    "a monitor's detail page, under its criteria",
};

/*
 * The files that call formatDictionaryValueForDisplay, each with what its
 * English text is for. Never a line a person reads (#8309).
 */
const FORMATS_A_KEY: Record<string, string> = {
  "packages/Common/UI/Components/Dictionary/DictionaryFilterOperator.ts":
    "where the formatter is written",
  "packages/App/FeatureSet/Dashboard/src/Components/Logs/LogsAttributeFilterChips.ts":
    "a chip's value: its React key and what removal reads. A filter that holds an operator hands the chip its stored value (filterValue), which the chip says as a sentence.",
  "packages/Common/UI/Components/LogsViewer/components/ActiveFilterChips.tsx":
    "chipText: a chip's React key and what removal is called with. An operator's value is said as a sentence (getFilterValue).",
};

const FORMATTER: string = "formatDictionaryValueForDisplay";

// Where a source calls formatDictionaryValueForDisplay, by line.
export function formatterCalls(fileName: string, text: string): Array<number> {
  if (!text.includes(FORMATTER)) {
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
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(source).split(".").pop() === FORMATTER
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

function scanFormatterCalls(): Array<string> {
  const findings: Array<string> = [];

  for (const root of listScanRoots(REPOSITORY_ROOT)) {
    for (const file of listSourceFiles(root)) {
      const name: string = relative(file);

      if (FORMATS_A_KEY[name]) {
        continue;
      }

      for (const line of formatterCalls(name, fs.readFileSync(file, "utf8"))) {
        findings.push(`${name}:${line}`);
      }
    }
  }

  return findings;
}

describe("no page says a filter through the English value formatter (#8309)", () => {
  test("no front end calls formatDictionaryValueForDisplay outside the files that make a key of it", () => {
    expect(scanFormatterCalls()).toEqual([]);
  });

  test("each file listed still calls it, for the reason given", () => {
    for (const [name, reason] of Object.entries(FORMATS_A_KEY)) {
      const text: string = fs.readFileSync(
        path.join(REPOSITORY_ROOT, name),
        "utf8",
      );

      expect({
        name,
        calls:
          formatterCalls(name, text).length > 0 ||
          text.includes(`export const ${FORMATTER}`),
      }).toEqual({ name, calls: true });
      expect(reason.length).toBeGreaterThan(20);
    }
  });

  test("the log chips hand an operator's filter on whole, for the chip to say", () => {
    const chips: string = fs.readFileSync(
      path.join(
        REPOSITORY_ROOT,
        "packages/App/FeatureSet/Dashboard/src/Components/Logs/LogsAttributeFilterChips.ts",
      ),
      "utf8",
    );

    expect(chips).toContain("{ filterValue: attributeValue }");

    // And the monitor's details hand the viewer the filters as stored.
    const viewModel: string = fs.readFileSync(
      path.join(
        REPOSITORY_ROOT,
        "packages/App/FeatureSet/Dashboard/src/Utils/MonitorStepViewModel.ts",
      ),
      "utf8",
    );

    expect(viewModel).not.toContain(FORMATTER);
    expect(viewModel).toContain(
      "valueType: MonitorStepViewValueType.AttributeFilters,",
    );
  });

  test("a summary drawn from the formatter is caught (control)", () => {
    // The monitor's detail page, as it was before #8309.
    expect(
      formatterCalls(
        "ViewModel.ts",
        [
          'import { formatDictionaryValueForDisplay } from "Common/UI/Components/Dictionary/DictionaryFilterOperator";',
          "for (const key of Object.keys(attributes)) {",
          "  filters[key] = formatDictionaryValueForDisplay(attributes[key]);",
          "}",
        ].join("\n"),
      ),
    ).toEqual([3]);

    // Called off a module as well.
    expect(
      formatterCalls(
        "Chip.tsx",
        "const text = Operators.formatDictionaryValueForDisplay(value);",
      ),
    ).toEqual([1]);

    // Named, never called: nothing drawn.
    expect(
      formatterCalls(
        "Docs.ts",
        "// formatDictionaryValueForDisplay is English",
      ),
    ).toEqual([]);
  });
});

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
