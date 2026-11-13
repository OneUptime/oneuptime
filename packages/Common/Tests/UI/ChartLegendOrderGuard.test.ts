// UX rule: Docs/ux/README.md#cards-and-the-look-of-a-page
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * EVERY RECHARTS LEGEND NAMES ITS SERIES IN THE ORDER THE PAGE GIVES THEM
 * (issue #6562).
 *
 * recharts 3 sorts a legend's items by their label unless its `itemSorter`
 * says otherwise. The line, area and bar charts set none, so every legend
 * read alphabetically ("Daily, Monthly, Weekly active users") and in a
 * different order in each language. They rank their items by the series'
 * place among their categories now (ChartLibrary/Utils/LegendOrder), and
 * this guard holds every recharts Legend in the browser code to it: each
 * one passes an `itemSorter`, and never `itemSorter={null}`, which recharts
 * warns can reorder the items between renders.
 *
 * The detector reads real syntax (the TypeScript AST): a Legend imported
 * from recharts under any name, drawn as an element. It is pinned on
 * snippets first, then run over Common/UI, every feature set's src and
 * ee/, with checks that the walk found the three charts.
 */

const REPOSITORY_ROOT: string = path.resolve(__dirname, "../../../..");

interface LegendFinding {
  file: string;
  line: number;
  problem: string;
}

// The names a file gives recharts' Legend.
function legendNamesIn(sourceFile: ts.SourceFile): Set<string> {
  const names: Set<string> = new Set<string>();

  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== "recharts"
    ) {
      continue;
    }

    const bindings: ts.NamedImportBindings | undefined =
      statement.importClause?.namedBindings;

    if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        const imported: string = (element.propertyName || element.name).text;

        if (imported === "Legend") {
          names.add(element.name.text);
        }
      }
    }

    // `import * as Recharts from "recharts"` draws <Recharts.Legend>.
    if (bindings && ts.isNamespaceImport(bindings)) {
      names.add(`${bindings.name.text}.Legend`);
    }
  }

  return names;
}

function findLegendProblem(attributes: ts.JsxAttributes): string | null {
  let sorter: ts.JsxAttribute | null = null;
  let hasSpread: boolean = false;

  for (const property of attributes.properties) {
    if (ts.isJsxSpreadAttribute(property)) {
      hasSpread = true;
      continue;
    }

    if (ts.isIdentifier(property.name) && property.name.text === "itemSorter") {
      sorter = property;
    }
  }

  if (!sorter) {
    return hasSpread
      ? "props spread into a Legend: name its itemSorter on the element"
      : "a Legend with no itemSorter sorts its items alphabetically";
  }

  const initializer: ts.JsxAttributeValue | undefined = sorter.initializer;

  if (
    !initializer ||
    (ts.isJsxExpression(initializer) &&
      (!initializer.expression ||
        initializer.expression.kind === ts.SyntaxKind.NullKeyword))
  ) {
    return "itemSorter={null} leaves the items in an order recharts may change";
  }

  if (ts.isStringLiteral(initializer)) {
    return `itemSorter="${initializer.text}" sorts by the label, not the page's order`;
  }

  if (
    ts.isJsxExpression(initializer) &&
    initializer.expression &&
    ts.isStringLiteral(initializer.expression)
  ) {
    return `itemSorter="${initializer.expression.text}" sorts by the label, not the page's order`;
  }

  return null;
}

function findUnorderedLegends(
  fileName: string,
  source: string,
): Array<LegendFinding> {
  const sourceFile: ts.SourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const names: Set<string> = legendNamesIn(sourceFile);
  const findings: Array<LegendFinding> = [];

  if (names.size === 0) {
    return findings;
  }

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
      if (names.has(node.tagName.getText(sourceFile))) {
        const problem: string | null = findLegendProblem(node.attributes);

        findings.push({
          file: fileName,
          line:
            sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
              .line + 1,
          problem: problem || "",
        });
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return findings;
}

function problemsIn(source: string): Array<string> {
  return findUnorderedLegends("Fixture.tsx", source)
    .filter((finding: LegendFinding): boolean => {
      return finding.problem !== "";
    })
    .map((finding: LegendFinding): string => {
      return `@${finding.line}: ${finding.problem}`;
    });
}

function sitesIn(source: string): number {
  return findUnorderedLegends("Fixture.tsx", source).length;
}

// Every .ts and .tsx file under `directory`, node_modules and build output left out.
function listSourceFiles(directory: string): Array<string> {
  const files: Array<string> = [];

  if (!fs.existsSync(directory)) {
    return files;
  }

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (
        entry.name !== "node_modules" &&
        entry.name !== "build" &&
        entry.name !== "dist" &&
        entry.name !== "Tests"
      ) {
        files.push(...listSourceFiles(fullPath));
      }
      continue;
    }

    if (
      (entry.name.endsWith(".tsx") || entry.name.endsWith(".ts")) &&
      !entry.name.endsWith(".d.ts")
    ) {
      files.push(fullPath);
    }
  }

  return files;
}

function browserSourceRoots(): Array<string> {
  const roots: Array<string> = [
    path.join(REPOSITORY_ROOT, "packages/Common/UI"),
  ];
  const featureSets: string = path.join(
    REPOSITORY_ROOT,
    "packages/App/FeatureSet",
  );

  for (const entry of fs.readdirSync(featureSets, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      roots.push(path.join(featureSets, entry.name, "src"));
    }
  }

  // The Enterprise Edition, when the checkout has it (Common Test runs without).
  const enterprise: string = path.join(REPOSITORY_ROOT, "ee");

  if (fs.existsSync(enterprise)) {
    roots.push(enterprise);
  }

  return roots;
}

describe("the detector", () => {
  test("a Legend drawn with no itemSorter", () => {
    expect(
      problemsIn(
        [
          'import { Legend, LineChart } from "recharts";',
          'const a = <LineChart><Legend verticalAlign="top" /></LineChart>;',
        ].join("\n"),
      ),
    ).toEqual([
      "@2: a Legend with no itemSorter sorts its items alphabetically",
    ]);
  });

  test("a Legend imported under another name, as the charts import it", () => {
    expect(
      problemsIn(
        [
          'import { Legend as RechartsLegend } from "recharts";',
          "const a = (",
          "  <RechartsLegend",
          '    verticalAlign="top"',
          "    content={() => <div />}",
          "  />",
          ");",
        ].join("\n"),
      ),
    ).toEqual([
      "@3: a Legend with no itemSorter sorts its items alphabetically",
    ]);
  });

  test("a Legend with children, through a namespace import", () => {
    expect(
      problemsIn(
        [
          'import * as Recharts from "recharts";',
          "const a = <Recharts.Legend>{null}</Recharts.Legend>;",
        ].join("\n"),
      ),
    ).toEqual([
      "@2: a Legend with no itemSorter sorts its items alphabetically",
    ]);
  });

  test("itemSorter={null}, which recharts warns may reorder the items", () => {
    expect(
      problemsIn(
        [
          'import { Legend } from "recharts";',
          "const a = <Legend itemSorter={null} />;",
        ].join("\n"),
      ),
    ).toEqual([
      "@2: itemSorter={null} leaves the items in an order recharts may change",
    ]);
  });

  test("an itemSorter that sorts by the label again", () => {
    expect(
      problemsIn(
        [
          'import { Legend } from "recharts";',
          'const a = <Legend itemSorter="value" />;',
          'const b = <Legend itemSorter={"dataKey"} />;',
        ].join("\n"),
      ),
    ).toEqual([
      '@2: itemSorter="value" sorts by the label, not the page\'s order',
      '@3: itemSorter="dataKey" sorts by the label, not the page\'s order',
    ]);
  });

  test("props spread into a Legend hide whether it has one", () => {
    expect(
      problemsIn(
        [
          'import { Legend } from "recharts";',
          "const a = <Legend {...legendProps} />;",
        ].join("\n"),
      ),
    ).toEqual([
      "@2: props spread into a Legend: name its itemSorter on the element",
    ]);
  });

  test("a Legend ranked by its categories passes", () => {
    const source: string = [
      'import { Legend as RechartsLegend } from "recharts";',
      "const a = <RechartsLegend itemSorter={legendItemRank} />;",
      "const b = <RechartsLegend {...rest} itemSorter={rank} />;",
    ].join("\n");

    expect(sitesIn(source)).toBe(2);
    expect(problemsIn(source)).toEqual([]);
  });

  test("a Legend of the product's own, or a word in a comment, is not recharts'", () => {
    const source: string = [
      'import Legend from "./Legend";',
      'import { LineChart } from "recharts";',
      "// <Legend /> from recharts sorts its items.",
      "const a = <Legend categories={[]} />;",
    ].join("\n");

    expect(sitesIn(source)).toBe(0);
  });
});

describe("every recharts Legend in the browser code", () => {
  const roots: Array<string> = browserSourceRoots();
  const findings: Array<LegendFinding> = [];

  for (const root of roots) {
    for (const file of listSourceFiles(root)) {
      const source: string = fs.readFileSync(file, "utf8");

      // Only a file that names recharts can draw its Legend.
      if (source.includes("recharts")) {
        findings.push(
          ...findUnorderedLegends(path.relative(REPOSITORY_ROOT, file), source),
        );
      }
    }
  }

  test("the walk read the browser code and found the three charts' legends", () => {
    expect(roots.length).toBeGreaterThan(5);

    const files: Array<string> = findings.map((finding: LegendFinding) => {
      return finding.file.split(path.sep).join("/");
    });

    for (const chart of ["LineChart", "AreaChart", "BarChart"]) {
      expect(files).toContain(
        `packages/Common/UI/Components/Charts/ChartLibrary/${chart}/${chart}.tsx`,
      );
    }
  });

  test("each one passes an itemSorter that keeps the page's order", () => {
    expect(
      findings
        .filter((finding: LegendFinding): boolean => {
          return finding.problem !== "";
        })
        .map((finding: LegendFinding): string => {
          return `${finding.file}:${finding.line}: ${finding.problem}`;
        }),
    ).toEqual([]);
  });
});
