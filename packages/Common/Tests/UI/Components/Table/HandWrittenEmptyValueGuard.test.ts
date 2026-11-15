// UX rule: Docs/ux/README.md#lists
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  listScanRoots,
  listSourceFiles,
} from "../../../ForeignHiddenRuleGuard";
import {
  findHandWrittenDashes,
  HandWrittenDash,
  HandWrittenDashKind,
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
 * is handed no value at all: it draws the quiet dash itself.
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
};

function relative(file: string): string {
  return path.relative(REPOSITORY_ROOT, file).split(path.sep).join("/");
}

function scanTree(): { files: number; found: Array<HandWrittenDash> } {
  const found: Array<HandWrittenDash> = [];
  let files: number = 0;

  for (const root of listScanRoots(REPOSITORY_ROOT)) {
    for (const file of listSourceFiles(root)) {
      files++;
      found.push(
        ...findHandWrittenDashes(fs.readFileSync(file, "utf8"), relative(file)),
      );
    }
  }

  return { files: files, found: found };
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

  test("attributes no one reads as a value, comments and strings that are not drawn", () => {
    expect(
      scan(
        [
          'const a = <span title={name || "-"}>{name}</span>;',
          'const b = <span aria-label={name ?? "—"}>{name}</span>;',
          'const c = <BreakableName text={name} breakAfter="-" />;',
          'const d = <Input placeholder="-" />;',
          '// return <span className="text-gray-400">-</span>;',
          '/* {team.name || "-"} */',
          'const e: string = team.name || "-";',
          'const f = csvRow.push(value ?? "—");',
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
