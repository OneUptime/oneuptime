// UX rule: Docs/ux/README.md#lists
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  listScanRoots,
  listSourceFiles,
} from "../../../ForeignHiddenRuleGuard";
import {
  DashFormatterIndex,
  findHandWrittenDashes,
  HandWrittenDash,
  HandWrittenDashKind,
  indexDashFormatters,
} from "../../../Helpers/HandWrittenEmptyValueScan";

/*
 * NO PAGE DRAWS A DASH OF ITS OWN FOR A VALUE THAT IS NOT THERE (#7603,
 * #8209).
 *
 * An empty value is the quiet dash: `TableEmptyValue` in a table's cell,
 * `Detail/EmptyValue` on a card - light grey, on the value's 24px line,
 * read out as "Not set". #7264 made the shared paths draw it (a column's
 * `noValueMessage: "-"`, a field's `placeholder: "-"`, a bare `<p>-</p>`,
 * which TableEmptyValueDashGuard keeps out), but some six hundred cells,
 * fields and cards still wrote a dash by hand: in an element with classes
 * of its own (`<span className="text-gray-400">—</span>`), or as a value's
 * fallback (`{team.name || "-"}`). One row drew the quiet dash in one cell
 * and a darker, wider hyphen in the next for the same "nothing here", a
 * screen reader heard "dash" or nothing, and a phone's card showed
 * "Team: -" where it leaves every other empty field out.
 *
 * The scan (Tests/Helpers/HandWrittenEmptyValueScan) reads every module of
 * the front ends, Common's UI and the enterprise dashboards, and its header
 * says what it finds and what it leaves alone: a dash between two values,
 * a sign, code, a figure.
 *
 * To fix one: draw `<TableEmptyValue />` (a table's cell, a hand-built
 * table's `<td>`) or `<EmptyValue />` (a card's field) where the dash was -
 * `{team.name || <TableEmptyValue />}`. A column that has words for
 * nothing ("Never") draws them (getTableNoValue). A monitor summary's fact
 * and a stat tile are handed no value at all: they draw the quiet dash
 * themselves (EmptyFigure in a tile, #8264).
 *
 * A dash written as a string first (#8262) is the same mark out of the
 * JSX's sight: a formatter's `return "—"`, `const host = r.host || "—"`,
 * `{ value: m ? fmt(m) : "—" }`. Hand a component nothing; for plain text
 * (a chart's label, an export, a sentence) write the shared mark,
 * EMPTY_VALUE_MARK. Where a page draws a formatter's text in an element of
 * its own, it draws it through getValueOrQuietDash (or getFigure in a
 * figure), which turns the mark into the quiet dash: the scan follows a
 * formatter's mark into the element that draws it, across imports.
 *
 * A dash a page truly means as its mark goes in MEANT_MARKS below, with
 * why. The Common Test job deletes ee/ before it runs; the Enterprise
 * Edition Test workflow runs this guard again with ee/ present.
 */

const REPOSITORY_ROOT: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "..",
);

interface MeantMark {
  file: string;
  // The code the scan reports, on one line.
  text: string;
  reason: string;
}

// Dashes a page means as its own mark, not as an empty value.
const MEANT_MARKS: ReadonlyArray<MeantMark> = [
  {
    file: "packages/App/FeatureSet/Dashboard/src/Components/Monitor/Overview/MonitorOverviewStatBar.tsx",
    text: '<span className="text-gray-400">—</span>',
    reason:
      "A count the monitor's open-work sentence could not read, inside the sentence ('— incidents · 0 alerts'), with the reason said under it ('Couldn't load open alerts'). The quiet dash would read 'Not set incidents'; the bar's uptime tiles draw EmptyFigure.",
  },
  {
    file: "packages/App/FeatureSet/Dashboard/src/Utils/ReplayCorrelation.ts",
    text: 'return minusOne.endsWith(one) ? minusOne.slice(0, minusOne.length - one.length) || "-" : "-";',
    reason:
      "A minus sign, not an empty value: the sign the reader's language writes before a negative figure, a hyphen where its number formatter writes none of its own. Reported once for each of its two hyphens.",
  },
  {
    file: "packages/App/FeatureSet/Dashboard/src/Components/AIChat/Export/PdfMarkdown.ts",
    text: 'this.pdf.drawLine(this.pdf.sanitize(block.marker || "-"), x, this.pdf.y);',
    reason:
      "A Markdown list's bullet in the PDF export: an unordered item's marker, not a value.",
  },
  {
    file: "packages/Common/UI/Utils/AIChatExport/MarkdownBlocks.ts",
    text: 'marker: isOrdered ? `${counter}.` : "-"',
    reason:
      "A Markdown list's bullet: an ordered item's number, else the unordered item's hyphen.",
  },
  {
    file: "packages/Common/UI/Components/Table/ColumnResize/ColumnWidths.ts",
    text: 'SLUG_DASH: string = "-"',
    reason:
      "The hyphen a table's id joins its words with, in the key its column widths are remembered by: a slug's separator.",
  },
  {
    file: "packages/Common/UI/Utils/AIChatExport/ChatWidgetData.ts",
    text: 'CHAT_TABLE_WORD_HYPHEN: string = "-"',
    reason:
      "The hyphen a long word in an exported chat table is broken with at the end of a line: a word's hyphen.",
  },
];

// What to draw instead, by what the scan found.
const FIXES: Record<HandWrittenDashKind, string> = {
  "dash-element":
    "draw <TableEmptyValue /> (a table's cell) or <EmptyValue /> (a card's field) instead",
  "dash-fallback":
    "draw <TableEmptyValue /> (a table's cell) or <EmptyValue /> (a card's field) instead",
  "dash-words":
    "leave the words out: the component draws the quiet dash itself, or write words",
  "dash-value":
    "hand the component no value (undefined): a fact and a tile draw the quiet dash themselves",
  "dash-figure":
    "draw <EmptyFigure /> (Common/UI/Components/EmptyFigure) in the figure, or hand the tile no value",
  "dash-string":
    "hand the component no value (undefined), or, for plain text (a chart's label, an export, a sentence), write the shared mark EMPTY_VALUE_MARK (Detail/EmptyValue)",
  "dash-flow":
    "draw it through getValueOrQuietDash (Table/TableEmptyValue), or getFigure (EmptyFigure) in a figure: the mark is text, with nothing for a screen reader",
};

function relative(file: string): string {
  return path.relative(REPOSITORY_ROOT, file).split(path.sep).join("/");
}

interface ScannedModule {
  file: string;
  sourceText: string;
}

let scanned: { files: number; found: Array<HandWrittenDash> } | null = null;

/*
 * Every module of the tree, read once: a page is held to what the
 * formatters it imports write (indexDashFormatters), so the index is built
 * over every module before any is scanned.
 */
function scanTree(): { files: number; found: Array<HandWrittenDash> } {
  if (scanned) {
    return scanned;
  }

  const modules: Array<ScannedModule> = [];

  for (const root of listScanRoots(REPOSITORY_ROOT)) {
    for (const file of listSourceFiles(root)) {
      modules.push({
        file: relative(file),
        sourceText: fs.readFileSync(file, "utf8"),
      });
    }
  }

  const formatters: DashFormatterIndex = indexDashFormatters(modules);
  const found: Array<HandWrittenDash> = [];

  for (const module of modules) {
    found.push(
      ...findHandWrittenDashes(module.sourceText, module.file, formatters),
    );
  }

  scanned = { files: modules.length, found: found };

  return scanned;
}

function isMeant(dash: HandWrittenDash): boolean {
  return MEANT_MARKS.some((mark: MeantMark): boolean => {
    return mark.file === dash.file && mark.text === dash.text;
  });
}

function scan(source: string): Array<{ line: number; kind: string }> {
  return findHandWrittenDashes(source, "Example.tsx").map(
    (dash: HandWrittenDash): { line: number; kind: string } => {
      return { line: dash.line, kind: dash.kind };
    },
  );
}

function kindsOf(source: string): Array<HandWrittenDashKind> {
  return findHandWrittenDashes(source, "Example.tsx").map(
    (dash: HandWrittenDash): HandWrittenDashKind => {
      return dash.kind;
    },
  );
}

describe("the scan finds a dash written for an empty value", () => {
  test.each([
    ['<span className="text-gray-400">-</span>'],
    ['<span className="text-sm text-gray-400">—</span>'],
    ['<span className="text-gray-500">–</span>'],
    ['<div className="text-gray-400">—</div>'],
    ["<p>-</p>"],
    ["<span>-</span>"],
    ["<>-</>"],
    ['<span>{"-"}</span>'],
    ['<span>{"—"}</span>'],
    ["<span>{'—'}</span>"],
    ['<span className="text-xs text-gray-300"> — </span>'],
    ['<span className="text-sm text-gray-400" title={reason}>—</span>'],
    ['<span data-testid="value">—</span>'],
    ["<span className={props.className}>—</span>"],
  ])(
    "an element that holds only a dash, returned as a value: %s",
    (tree: string) => {
      expect(
        kindsOf(`const Cell = (): ReactElement => {\n  return ${tree};\n};`),
      ).toEqual(["dash-element"]);
    },
  );

  test("a dash element as the empty branch of a condition, beside or in a value", () => {
    expect(
      scan(
        [
          'const a = item.lastSeen ? <Time at={item.lastSeen} /> : <span className="text-gray-400">—</span>;',
          'const b = props.emptyElement || <span className="text-sm text-gray-400">-</span>;',
          'const c = <td className="px-3"><span className="text-gray-400">—</span></td>;',
          'let d: ReactElement; d = <span className="text-sm text-gray-400">-</span>;',
        ].join("\n"),
      ),
    ).toEqual([
      { line: 1, kind: "dash-element" },
      { line: 2, kind: "dash-element" },
      { line: 3, kind: "dash-element" },
      { line: 4, kind: "dash-element" },
    ]);
  });

  test("a table's cell, a list's item and a card's definition that hold only a dash, among their row's other cells", () => {
    expect(
      scan(
        [
          "const row = (",
          "  <tr>",
          "    <td>{name}</td>",
          '    <td className="px-4 py-2 text-sm text-gray-600">—</td>',
          "    <td>{size}</td>",
          "  </tr>",
          ");",
          "const card = <dl><dt>Team</dt><dd>-</dd><dt>Owner</dt><dd>{owner}</dd></dl>;",
          "const list = <ul><li>{a}</li><li>—</li><li>{b}</li></ul>;",
        ].join("\n"),
      ),
    ).toEqual([
      { line: 4, kind: "dash-element" },
      { line: 8, kind: "dash-element" },
      { line: 9, kind: "dash-element" },
    ]);
  });

  test("a dash after a value's label, at the end of its line, is the value", () => {
    expect(
      kindsOf(
        '<div><span className="text-gray-500">Team</span> <span className="text-gray-400">—</span></div>',
      ),
    ).toEqual(["dash-element"]);
  });

  test.each([
    ['{team.name || "-"}'],
    ['{team.name ?? "—"}'],
    ['{item.team?.name?.toString() || "-"}'],
    ['{(r.role as string) || "—"}'],
    ['{name || email || "-"}'],
    ['{seenAt ? OneUptimeDate.fromNow(seenAt) : "-"}'],
    ['{count === null ? "—" : count}'],
    ['{isMuted ? "—" : formatNumber(count)}'],
    ['{String(table["host"] || "—")}'],
    ['{String(shard["shardNum"] ?? "—")}'],
    ['{a ? b : c ? "-" : d}'],
    ['{translator.translateText(kind) || "—"}'],
    ['{(usage.operations || []).join(", ") || "-"}'],
    ['{value || "\\u2014"}'],
  ])(
    "a value whose fallback is a dash, drawn as an element's child: %s",
    (child: string) => {
      expect(
        kindsOf(`<span className="text-gray-700">${child}</span>`),
      ).toEqual(["dash-fallback"]);
      expect(kindsOf(`<td className="px-4">${child}</td>`)).toEqual([
        "dash-fallback",
      ]);
      expect(kindsOf(`<>${child}</>`)).toEqual(["dash-fallback"]);
    },
  );

  test("a value's dash fallback in a sentence of other words", () => {
    expect(
      kindsOf(
        '<p>Shard {String(shard["shardNum"] ?? "—")} · Replica {String(shard["replicaNum"] ?? "—")}</p>',
      ),
    ).toEqual(["dash-fallback", "dash-fallback"]);
  });

  test.each([
    ['<MitreAttackChips tactics={t} techniques={[]} emptyText="-" />'],
    ['<LlmProviderTypeLabel llmType={type} emptyText="—" />'],
    ['<ResourceTable resources={r} groupFallbackLabel="—" />'],
    ['<List items={items} noItemsMessage={"-"} />'],
  ])(
    "a dash handed to a component as its words for nothing: %s",
    (tree: string) => {
      expect(kindsOf(tree)).toEqual(["dash-words"]);
    },
  );

  test.each([
    ['<SummaryFact title="Probe" value={props.probeName || "-"} />'],
    ['<SummaryFact title="Status Code" value={code ? String(code) : "-"} />'],
    ['<SummaryFact title="Probe" value="-" />'],
    ['<SummaryFact title="Probe" value={"—"} />'],
    ['<Pill text="—" color={Gray500} isMinimal={true} />'],
  ])("a dash handed to a component that draws a value: %s", (tree: string) => {
    expect(kindsOf(tree)).toEqual(["dash-value"]);
  });

  test.each([
    ['<GoldenMetricTile title="CPU" value={cpu === null ? "—" : fmt(cpu)} />'],
    ['<GoldenMetricTile title="Role" value={role || "—"} />'],
    [
      '<EventStatTile label="Alerts" value={count === undefined ? "-" : String(count)} />',
    ],
    [
      '<EventStatTile label="Started" value={at ? <Started at={at} /> : "-"} />',
    ],
    ['<LlmTile label="Cost" value={summary ? fmt(summary.cost) : "—"} />'],
    ['<Stat label="Fixes" value="—" />'],
    ['<StatTile title="Availability" value={"—"} />'],
    ["<InfoCard title=\"Pods\" value={count ?? '–'} />"],
    ['<SummaryFact title="Probe" value={probe || "-"} />'],
    ['<ui.Tile value={x ? y : "—"} />'],
  ])(
    "a dash handed to a tile as its figure, or to any component as its value: %s",
    (tree: string) => {
      expect(kindsOf(tree)).toEqual(["dash-value"]);
    },
  );

  test.each([
    ['<span className="text-2xl font-semibold text-gray-300">—</span>'],
    [
      '<span className="mt-0.5 block text-2xl font-semibold tabular-nums text-gray-400">—</span>',
    ],
    ['<span className="text-base sm:text-xl">-</span>'],
    ['<div className="text-lg font-semibold">{"—"}</div>'],
    [
      '<div className="text-3xl font-semibold">{stats.isLoaded ? stats.totalRuns : "—"}</div>',
    ],
    ['<p className="text-lg font-semibold">{count ?? "—"}</p>'],
    ['<span className="mt-1 text-3xl">{count === null ? "—" : count}</span>'],
    [
      '<span className={`text-2xl ${tone}`}>{typeof n === "number" ? fmt(n) : "—"}</span>',
    ],
    ['<span className="text-2xl"><TableEmptyValue /></span>'],
    [
      '<div className="text-2xl font-semibold">{failed ? <TableEmptyValue /> : fmt(count)}</div>',
    ],
    ['<dd className="text-lg">{count ?? <EmptyValue />}</dd>'],
  ])(
    "a dash drawn in a figure - a stat tile's number - or the table's quiet dash put there: %s",
    (tree: string) => {
      expect(kindsOf(tree)).toEqual(["dash-figure"]);
    },
  );

  test("a figure's dash inside a tile's figure handed to InfoCard", () => {
    expect(
      scan(
        [
          "const a = (",
          "  <InfoCard",
          '    title="Nodes"',
          "    value={",
          "      isLoading ? (",
          '        <span className="text-2xl font-semibold text-gray-300">…</span>',
          "      ) : failed ? (",
          '        <span className="text-2xl font-semibold text-gray-300">—</span>',
          "      ) : (",
          '        <span className="text-2xl font-semibold">{fmt(count)}</span>',
          "      )",
          "    }",
          "  />",
          ");",
        ].join("\n"),
      ),
    ).toEqual([{ line: 8, kind: "dash-figure" }]);
  });

  test("reports where the dash is, and the code it is in", () => {
    expect(
      findHandWrittenDashes(
        [
          "const A = (): ReactElement => {",
          "  if (!item.team) {",
          '    return <span className="text-gray-400">-</span>;',
          "  }",
          '  return <p>{item.team.name || "-"}</p>;',
          "};",
        ].join("\n"),
        "packages/App/FeatureSet/Dashboard/src/Example.tsx",
      ),
    ).toEqual([
      {
        file: "packages/App/FeatureSet/Dashboard/src/Example.tsx",
        line: 3,
        kind: "dash-element",
        text: '<span className="text-gray-400">-</span>',
      },
      {
        file: "packages/App/FeatureSet/Dashboard/src/Example.tsx",
        line: 5,
        kind: "dash-fallback",
        text: '{item.team.name || "-"}',
      },
    ]);
  });
});

describe("the scan leaves alone a dash that is not an empty value", () => {
  test("the quiet dash itself, and words", () => {
    expect(
      scan(
        [
          "const a = <TableEmptyValue />;",
          "const b = <span>{team.name || <TableEmptyValue />}</span>;",
          "const c = <EmptyValue />;",
          'const d = <span className="text-gray-500">Never</span>;',
          'const e = <span>{name || "Unnamed"}</span>;',
          'const f = <span>{name || "--"}</span>;',
          'const g = <span>{name || ""}</span>;',
          "const h = <p>e-mail</p>;",
          'const i = <MitreAttackChips emptyText="Not mapped" />;',
          'const j = <SummaryFact title="Probe" value={props.probeName} />;',
          'const k = <Pill text="Running" color={Blue500} />;',
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  test("a range or a separator between two values", () => {
    expect(
      scan(
        [
          'const a = <span>{start}<span className="mx-1 text-gray-400">–</span>{end}</span>;',
          "const b = <p>{from} - {to}</p>;",
          'const c = <p>{from}{" - "}{to}</p>;',
          'const d = <div><b>{a}</b><span className="mx-2">—</span><b>{b}</b></div>;',
          "const e = <p>{`${start} – ${end}`}</p>;",
          "const f = <span>10<span>-</span>20</span>;",
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  test("a separator drawn on a condition, with nothing otherwise", () => {
    expect(
      scan(
        [
          'const a = <>{index > 0 && <span className="mx-2 text-gray-400">—</span>}</>;',
          'const b = <>{isLast ? <></> : <span className="mx-2 text-gray-400">—</span>}</>;',
          "const c = <>{isLast ? null : <span>—</span>}</>;",
          "const d = <>{hasNext ? <span>-</span> : undefined}</>;",
          'const e = <>{hasNext ? <span>-</span> : ""}</>;',
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  test("a minus sign or a plus between two literals, and a negative number", () => {
    expect(
      scan(
        [
          'const a = <span>{delta < 0 ? "-" : "+"}{Math.abs(delta)}</span>;',
          'const b = <span>{delta < 0 ? "-" : ""}{Math.abs(delta)}</span>;',
          'const c = <span>{isDown ? "–" : 1}</span>;',
          "const d = <span>{-1}</span>;",
          'const e = <span>{"-" + amount}</span>;',
          "const f = <span>-{amount}</span>;",
          'const g = <span>{isNegative ? "-" : -1}</span>;',
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  test("code, a select's choice and SVG text", () => {
    expect(
      scan(
        [
          "const a = <code>-</code>;",
          'const b = <code className="font-mono">{flag || "-"}</code>;',
          "const c = <kbd>-</kbd>;",
          "const d = <pre>-</pre>;",
          'const e = <option value="">-</option>;',
          'const f = <text x={4} y={8}>{label || "—"}</text>;',
          "const g = <tspan>-</tspan>;",
          'const h = <title>{name || "-"}</title>;',
          "const i = <samp>—</samp>;",
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  test("a mark hidden from a screen reader", () => {
    expect(
      scan(
        [
          'const a = <span aria-hidden="true">—</span>;',
          'const b = <span className="text-2xl" aria-hidden="true">—</span>;',
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  test("the figure's quiet dash, and a tile handed no value", () => {
    expect(
      scan(
        [
          'const a = <span className="text-2xl font-semibold"><EmptyFigure /></span>;',
          'const b = <p className="text-lg">{count ?? <EmptyFigure />}</p>;',
          'const c = <GoldenMetricTile title="CPU" value={cpu === null ? undefined : fmt(cpu)} />;',
          'const d = <EventStatTile label="Alerts" value={count?.toString()} />;',
          'const e = <span className="text-sm"><TableEmptyValue /></span>;',
          'const f = <td className="text-xs">{count ?? <TableEmptyValue isSmall={true} />}</td>;',
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  test("an element's own value: a select's choice, what an input holds", () => {
    expect(
      scan(
        [
          'const a = <option value="-">None</option>;',
          'const b = <input value={draft || "-"} readOnly={true} />;',
          'const c = <select value={choice ?? "—"} />;',
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  test("attributes no one reads as a value, and comments", () => {
    expect(
      scan(
        [
          'const a = <span title={name || "-"}>{name}</span>;',
          'const b = <span aria-label={name ?? "—"}>{name}</span>;',
          'const c = <BreakableName text={name} breakAfter="-" />;',
          'const d = <Input placeholder="-" />;',
          '// return <span className="text-gray-400">-</span>;',
          '/* {team.name || "-"} */',
          '// const host = r.host || "—";',
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  test("a string's own work with a dash: joining, splitting, comparing, a sign, a minus", () => {
    expect(
      scan(
        [
          'const a = parts.join("-");',
          'const b = slug.split("-");',
          'const c = name.replace(/\\s+/g, "-");',
          'const d = status === "-";',
          'const e = status !== "—" ? status : "";',
          'const f = delta < 0 ? "-" : "+";',
          'const g = `${delta < 0 ? "-" : ""}${Math.abs(delta)}`;',
          'const h = "-" + amount;',
          'slug += "-";',
          'const i = text.startsWith("-");',
          'const j = ["-", "\\u2013", "\\u2014"];',
          'switch (mark) { case "-": break; }',
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  test("a dash with room around it: a separator, a range, a list's bullet", () => {
    expect(
      scan(
        [
          'const RANGE_SEPARATOR: string = " – ";',
          'const SPACED_DASH: string = "\\u00a0–\\u00a0";',
          'const BULLET: string = "\\n- ";',
          'let prefix: string = "";',
          'prefix = "- ";',
          "const label = from ? `${from} – ${to}` : to;",
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  test("the shared mark handed to plain text, and a dash's prop that is no value", () => {
    expect(
      scan(
        [
          "const a = (n: number | null): string => n === null ? EMPTY_VALUE_MARK : String(n);",
          "const b = { text: label || EMPTY_VALUE_MARK };",
          "const c = csv.push(value ?? EMPTY_VALUE_MARK);",
          'const d = { bullet: "-", separator: "-" };',
          'const e = { marker: "—" };',
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  test("the shared mark drawn through the quiet dash, and a formatter's text in a tile", () => {
    expect(
      scan(
        [
          "const formatBytes = (n: number | null): string => n === null ? EMPTY_VALUE_MARK : `${n} B`;",
          "const a = <td>{getValueOrQuietDash(formatBytes(n), { isSmall: true })}</td>;",
          'const b = <span className="text-2xl">{getFigure(formatBytes(n))}</span>;',
          'const c = <GoldenMetricTile title="Size" value={formatBytes(n)} />;',
          "const d = <span title={formatBytes(n)}>{label}</span>;",
          "const e = <code>{formatBytes(n)}</code>;",
          'const f = <span aria-hidden="true">{formatBytes(n)}</span>;',
        ].join("\n"),
      ),
    ).toEqual([]);
  });
});

describe("the scan finds a dash written as a string for an empty value (#8262)", () => {
  test.each([
    ['return "—";'],
    ['return "-";'],
    ['return "–";'],
    ['return n === null ? "—" : fmt(n);'],
    ['return name || "-";'],
    ['return value ?? "—";'],
    ['return a ? fmt(a) : b ? fmt(b) : "—";'],
  ])("a function that returns a dash for nothing: %s", (body: string) => {
    expect(
      kindsOf(`function fmt(n: number | null): string {\n  ${body}\n}`),
    ).toEqual(["dash-string"]);
  });

  test.each([
    ['const fmt = (n: number | null): string => n === null ? "—" : String(n);'],
    ['const fmt = (n: number | null): string => "—";'],
    ['const host: string = r.hostname || "—";'],
    ['const host: string = (r.hostname as string) ?? "-";'],
    ['const label: string = isKnown ? describe(x) : "—";'],
    ['const tile = { title: "CPU", value: m ? fmt(m) : "—" };'],
    ['const detail = { label: "Host", value: r.host || "—" };'],
    ['const tile = { title: "CPU", value: "—" };'],
    ['const cell = { text: "-" };'],
    ['const NO_VALUE: string = "-";'],
    ['let at: string = "-";'],
    ['at = "—";'],
    ['setModalText(text || "-");'],
    ['const line: string = `${phase ?? "—"} · ${table}`;'],
    ['const sum = String(row["type"] ?? "—");'],
    ['const cell = <IsolatedText text={name || "—"} />;'],
    [
      'const cell = <ResourceListNameCell name={(r.host as string) || "—"} className="px-3" />;',
    ],
    ['const modal = <ConfirmModal title="Body" description={text || "-"} />;'],
  ])("a dash defaulted or named as a string: %s", (code: string) => {
    expect(
      findHandWrittenDashes(code, "Example.tsx").map(
        (dash: HandWrittenDash): string => {
          return dash.kind;
        },
      ),
    ).toEqual([
      code.includes("<IsolatedText") ||
      code.includes("<ResourceListNameCell") ||
      code.includes("<ConfirmModal")
        ? "dash-value"
        : "dash-string",
    ]);
  });

  test("reports the statement, the prop or the attribute the dash is in", () => {
    expect(
      findHandWrittenDashes(
        [
          "const formatBytes = (n: number | null): string => {",
          "  if (n === null) {",
          '    return "—";',
          "  }",
          "  return `${n} B`;",
          "};",
          'const tile = { title: "Size", value: n ? formatBytes(n) : "—" };',
        ].join("\n"),
        "packages/App/FeatureSet/Dashboard/src/Example.ts",
      ),
    ).toEqual([
      {
        file: "packages/App/FeatureSet/Dashboard/src/Example.ts",
        line: 3,
        kind: "dash-string",
        text: 'return "—";',
      },
      {
        file: "packages/App/FeatureSet/Dashboard/src/Example.ts",
        line: 7,
        kind: "dash-string",
        text: 'value: n ? formatBytes(n) : "—"',
      },
    ]);
  });
});

describe("the scan follows a formatter's mark into the element that draws it (#8262)", () => {
  test.each([
    ["{formatBytes(n)}"],
    ["{formatBytes(row.size, translator)}"],
    ["{isKnown ? formatBytes(n) : <TableEmptyValue />}"],
    ["{formatBytes(a) || formatBytes(b)}"],
    ["{hostName}"],
  ])(
    "a formatter or a value of the module that writes the mark, drawn bare: %s",
    (child: string) => {
      expect(
        kindsOf(
          [
            "const formatBytes = (n: number | null): string => n === null ? EMPTY_VALUE_MARK : `${n} B`;",
            "const hostName: string = r.host || EMPTY_VALUE_MARK;",
            `const cell = <td className="px-3 text-xs">${child}</td>;`,
          ].join("\n"),
        ),
      ).toEqual(["dash-flow"]);
    },
  );

  test("a function declaration, a class's method and a const's arrow alike", () => {
    expect(
      scan(
        [
          "function formatA(n: number | null): string {",
          "  if (n === null) {",
          "    return EMPTY_VALUE_MARK;",
          "  }",
          "  return String(n);",
          "}",
          "const formatB = (n: number | null): string => n ?? EMPTY_VALUE_MARK;",
          "const a = <span>{formatA(n)}</span>;",
          "const b = <p>{formatB(n)}</p>;",
        ].join("\n"),
      ),
    ).toEqual([
      { line: 8, kind: "dash-flow" },
      { line: 9, kind: "dash-flow" },
    ]);
  });

  const UTILS: string = [
    "export function formatBytes(n: number | null): string {",
    "  return n === null ? EMPTY_VALUE_MARK : `${n} B`;",
    "}",
    "export const formatCount = (n: number | null): string => n === null ? EMPTY_VALUE_MARK : String(n);",
    "export function formatName(name: string): string {",
    "  return name.trim();",
    "}",
    "export default { formatBytes, formatCount, formatName };",
  ].join("\n");

  const STATIC_UTILS: string = [
    "export default class SizeUtil {",
    "  public static formatBytes(n: number | null): string {",
    "    return n === null ? EMPTY_VALUE_MARK : `${n} B`;",
    "  }",
    "  public static formatName(name: string): string {",
    "    return name;",
    "  }",
    "}",
  ].join("\n");

  const index: DashFormatterIndex = indexDashFormatters([
    {
      file: "packages/App/FeatureSet/Dashboard/src/Utils/SizeFormat.ts",
      sourceText: UTILS,
    },
    {
      file: "packages/App/FeatureSet/Dashboard/src/Utils/SizeUtil.ts",
      sourceText: STATIC_UTILS,
    },
    {
      file: "packages/Common/UI/Utils/CommonFormat.ts",
      sourceText:
        "export const formatShared = (n: number | null): string => n === null ? EMPTY_VALUE_MARK : String(n);",
    },
  ]);

  test("indexes what each module exports that writes the mark", () => {
    expect(
      Array.from(index.entries()).map(
        ([file, names]: [string, Set<string>]): [string, Array<string>] => {
          return [file, Array.from(names).sort()];
        },
      ),
    ).toEqual([
      [
        "packages/App/FeatureSet/Dashboard/src/Utils/SizeFormat.ts",
        [
          "default.formatBytes",
          "default.formatCount",
          "formatBytes",
          "formatCount",
        ],
      ],
      [
        "packages/App/FeatureSet/Dashboard/src/Utils/SizeUtil.ts",
        ["default.formatBytes"],
      ],
      ["packages/Common/UI/Utils/CommonFormat.ts", ["formatShared"]],
    ]);
  });

  test.each([
    ['import { formatBytes } from "../Utils/SizeFormat";', "{formatBytes(n)}"],
    [
      'import { formatCount as count } from "../Utils/SizeFormat";',
      "{count(n)}",
    ],
    [
      'import SizeFormat from "../Utils/SizeFormat";',
      "{SizeFormat.formatBytes(n)}",
    ],
    ['import * as Sizes from "../Utils/SizeFormat";', "{Sizes.formatCount(n)}"],
    ['import SizeUtil from "../Utils/SizeUtil";', "{SizeUtil.formatBytes(n)}"],
    [
      'import { formatShared } from "Common/UI/Utils/CommonFormat";',
      "{formatShared(n)}",
    ],
  ])(
    "an imported formatter that writes the mark, drawn bare: %s",
    (imported: string, child: string) => {
      expect(
        findHandWrittenDashes(
          `${imported}\nconst cell = <td>${child}</td>;`,
          "packages/App/FeatureSet/Dashboard/src/Pages/Example.tsx",
          index,
        ).map((dash: HandWrittenDash): string => {
          return dash.kind;
        }),
      ).toEqual(["dash-flow"]);
    },
  );

  test.each([
    ['import { formatName } from "../Utils/SizeFormat";', "{formatName(n)}"],
    ['import SizeUtil from "../Utils/SizeUtil";', "{SizeUtil.formatName(n)}"],
    [
      'import { formatBytes } from "../Utils/SizeFormat";',
      "{getValueOrQuietDash(formatBytes(n))}",
    ],
    ['import { formatBytes } from "../Utils/Elsewhere";', "{formatBytes(n)}"],
    [
      'import { formatBytes } from "../Utils/SizeFormat";',
      "{translator.formatBytes(n)}",
    ],
  ])(
    "a formatter that never writes the mark, one drawn through the quiet dash, or another module's of the same name: %s",
    (imported: string, child: string) => {
      expect(
        findHandWrittenDashes(
          `${imported}\nconst cell = <td>${child}</td>;`,
          "packages/App/FeatureSet/Dashboard/src/Pages/Example.tsx",
          index,
        ),
      ).toEqual([]);
    },
  );

  test("the mark handed to an element by hand is the dash it always was", () => {
    expect(
      scan(
        [
          "const a = <span>{EMPTY_VALUE_MARK}</span>;",
          "const b = <td>{name || EMPTY_VALUE_MARK}</td>;",
          'const c = <GoldenMetricTile title="CPU" value={cpu ?? EMPTY_VALUE_MARK} />;',
          'const d = <span className="text-2xl">{count ?? EMPTY_VALUE_MARK}</span>;',
        ].join("\n"),
      ),
    ).toEqual([
      { line: 1, kind: "dash-element" },
      { line: 2, kind: "dash-fallback" },
      { line: 3, kind: "dash-value" },
      { line: 4, kind: "dash-figure" },
    ]);
  });
});

describe("the scan follows the mark through an object's prop into the element that draws it (#8679)", () => {
  test.each([
    [
      '{ label: "Cluster", value: clusterName || EMPTY_VALUE_MARK }',
      "{row.value}",
    ],
    ['{ label: "Size", value: formatBytes(n) }', "{row.value}"],
    ['{ label: "Size", value: n === null ? "—" : `${n} B` }', "{row.value}"],
    ["{ value: EMPTY_VALUE_MARK, description: words }", "{runway.value}"],
    ['{ "text": formatBytes(n) }', "{cell.text}"],
    ["{ value }", "{tile.value}"],
    ['{ label: "Size", value: formatBytes(n) }', "{props.rows[0].value}"],
    ['{ label: "Size", value: formatBytes(n) }', "{isOpen ? row.value : null}"],
  ])(
    "an object the module builds as %s, drawn as %s",
    (built: string, drawn: string) => {
      expect(
        kindsOf(
          [
            "const formatBytes = (n: number | null): string => n === null ? EMPTY_VALUE_MARK : `${n} B`;",
            "const value: string = r.value || EMPTY_VALUE_MARK;",
            `const rows = [${built}];`,
            `const cell = <td className="px-3">${drawn}</td>;`,
          ].join("\n"),
        ).filter((kind: HandWrittenDashKind): boolean => {
          return kind === "dash-flow";
        }),
      ).toEqual(["dash-flow"]);
    },
  );

  const BUILDERS: string = [
    'import { EMPTY_VALUE_MARK } from "Common/Types/EmptyValueMark";',
    "export function getRunwayText(seconds: number | null): { value: string; description: string } {",
    '  return seconds === null ? { value: EMPTY_VALUE_MARK, description: "Not worked out" } : { value: `${seconds}s`, description: "" };',
    "}",
    "export const getNameRow = (name: string): { label: string; name: string } => {",
    '  return { label: "Name", name: name };',
    "};",
    "export default class RowUtil {",
    "  public static getRows(n: number | null): Array<{ figure: string }> {",
    "    return [{ figure: n === null ? EMPTY_VALUE_MARK : String(n) }];",
    "  }",
    "}",
  ].join("\n");

  const index: DashFormatterIndex = indexDashFormatters([
    {
      file: "packages/App/FeatureSet/Dashboard/src/Utils/RunwayText.ts",
      sourceText: BUILDERS,
    },
  ]);

  test("indexes what an exported function builds, by its props that can hold the mark", () => {
    expect(
      Array.from(
        index.get(
          "packages/App/FeatureSet/Dashboard/src/Utils/RunwayText.ts",
        ) || [],
      ).sort(),
    ).toEqual([
      "returns:default.getRows:figure",
      "returns:getRunwayText:value",
    ]);
  });

  test.each([
    [
      'import { getRunwayText } from "../Utils/RunwayText";',
      "const runway = getRunwayText(seconds);",
      "{runway.value}",
    ],
    [
      'import { getRunwayText as runwayOf } from "../Utils/RunwayText";',
      "const runway = runwayOf(seconds);",
      "{runway.value}",
    ],
    [
      'import RowUtil from "../Utils/RunwayText";',
      "const rows = RowUtil.getRows(n);",
      "{rows[0].figure}",
    ],
    [
      'import * as Runway from "../Utils/RunwayText";',
      "const runway = Runway.getRunwayText(seconds);",
      "{runway.value}",
    ],
  ])(
    "an object an imported function builds, drawn bare: %s",
    (imported: string, built: string, drawn: string) => {
      expect(
        findHandWrittenDashes(
          [imported, built, `const cell = <td>${drawn}</td>;`].join("\n"),
          "packages/App/FeatureSet/Dashboard/src/Pages/Example.tsx",
          index,
        ).map((dash: HandWrittenDash): string => {
          return dash.kind;
        }),
      ).toEqual(["dash-flow"]);
    },
  );

  test.each([
    // The function's other prop never holds the mark.
    [
      'import { getNameRow } from "../Utils/RunwayText";',
      "const row = getNameRow(name);",
      "{row.name}",
    ],
    // A module that never calls the builder is not held to its props.
    [
      'import { getRunwayText } from "../Utils/RunwayText";',
      "const tile = { value: count };",
      "{tile.value}",
    ],
    // Drawn through the quiet dash.
    [
      'import { getRunwayText } from "../Utils/RunwayText";',
      "const runway = getRunwayText(seconds);",
      "{getValueOrQuietDash(runway.value)}",
    ],
    // Its words, drawn only once the check says it has some.
    [
      'import { getRunwayText } from "../Utils/RunwayText";',
      "const runway = getRunwayText(seconds);",
      "{isNoValue(runway.value) ? <TableEmptyValue /> : runway.value}",
    ],
    [
      'import { getRunwayText } from "../Utils/RunwayText";',
      "const runway = getRunwayText(seconds);",
      "{!isNoValue(runway.value) ? <b>{runway.value}</b> : <TableEmptyValue />}",
    ],
  ])(
    "an object's prop that never holds the mark, or one drawn through the quiet dash: %s %s",
    (imported: string, built: string, drawn: string) => {
      expect(
        findHandWrittenDashes(
          [imported, built, `const cell = <td>${drawn}</td>;`].join("\n"),
          "packages/App/FeatureSet/Dashboard/src/Pages/Example.tsx",
          index,
        ),
      ).toEqual([]);
    },
  );

  test("an object's props that never hold the mark are not read", () => {
    expect(
      scan(
        [
          'const rows = [{ label: "Size", value: `${n} B` }, { label: "Name", value: name }];',
          "const cell = <td>{rows[0].value}</td>;",
          "const other = <td>{row.label}</td>;",
        ].join("\n"),
      ),
    ).toEqual([]);
  });
});

describe("no page draws a dash of its own for an empty value", () => {
  test("the scan reads the front ends, Common's UI among them", () => {
    const roots: Array<string> = listScanRoots(REPOSITORY_ROOT).map(relative);

    expect(roots).toContain("packages/App/FeatureSet/Dashboard/src");
    expect(roots).toContain("packages/App/FeatureSet/AdminDashboard/src");
    expect(roots).toContain("packages/Common/UI");
    // Thousands of modules: a scan that reads none is broken.
    expect(scanTree().files).toBeGreaterThan(1000);
  });

  test("every meant mark is still written, and says why", () => {
    const found: Array<HandWrittenDash> = scanTree().found;

    for (const mark of MEANT_MARKS) {
      expect([mark.file, mark.reason.length > 20]).toEqual([mark.file, true]);
      expect([
        mark.file,
        mark.text,
        found.some((dash: HandWrittenDash): boolean => {
          return dash.file === mark.file && dash.text === mark.text;
        }),
      ]).toEqual([mark.file, mark.text, true]);
    }
  });

  test("is written nowhere: an empty value is the quiet dash", () => {
    expect(
      scanTree()
        .found.filter((dash: HandWrittenDash): boolean => {
          return !isMeant(dash);
        })
        .map((dash: HandWrittenDash): string => {
          return `${dash.file}:${dash.line}: ${dash.text} - ${FIXES[dash.kind]} (${dash.kind}).`;
        }),
    ).toEqual([]);
  });
});
