import { describe, expect, test } from "@jest/globals";
import StatusPageGroupTreeUtil from "Common/Utils/StatusPage/GroupTree";
import StatusPageGroupViewMode from "Common/Types/StatusPage/StatusPageGroupViewMode";
import UptimePrecision from "Common/Types/StatusPage/UptimePrecision";
import {
  ExistingStatusPageGroup,
  MAX_GROUP_NESTING_DEPTH,
  ParsedStatusPageGroupRow,
  STATUS_PAGE_GROUP_CSV_COLUMNS,
  STATUS_PAGE_GROUP_CSV_EXAMPLE,
  StatusPageGroupCsvError,
  StatusPageGroupCsvParseResult,
  StatusPageGroupImportPlan,
  parseStatusPageGroupCsv,
  planStatusPageGroupImport,
} from "../../FeatureSet/Dashboard/src/Utils/StatusPageGroupCsv";

/*
 * Pins the pure CSV parser + import planner behind the Status Page > Groups
 * bulk import: header validation, quoted-field support, boolean and enum
 * cells, duplicate flagging, and the dependency-order batching that lets a
 * parent in the same file be created before its children.
 *
 * Only `name` is required, which is the part most easily broken by accident:
 * a blank cell has to stay blank all the way to the create, because writing
 * a guessed default is how an import silently flips a toggle the author
 * never mentioned.
 */

const FULL_HEADER: string = STATUS_PAGE_GROUP_CSV_COLUMNS.join(",");

type MessagesFunction = (
  result: StatusPageGroupCsvParseResult,
) => Array<string>;

const messages: MessagesFunction = (
  result: StatusPageGroupCsvParseResult,
): Array<string> => {
  return result.errors.map((error: StatusPageGroupCsvError) => {
    return error.message;
  });
};

type MakeRowFunction = (
  overrides: Partial<ParsedStatusPageGroupRow>,
) => ParsedStatusPageGroupRow;

const makeRow: MakeRowFunction = (
  overrides: Partial<ParsedStatusPageGroupRow>,
): ParsedStatusPageGroupRow => {
  return {
    line: 2,
    name: "Group",
    parentName: "",
    description: "",
    isExpandedByDefault: undefined,
    showCurrentStatus: undefined,
    showUptimePercent: undefined,
    uptimePercentPrecision: undefined,
    viewMode: undefined,
    rowAxisLabel: "",
    rowAxisValues: "",
    columnAxisLabel: "",
    columnAxisValues: "",
    ...overrides,
  };
};

type ExistingFunction = (
  name: string,
  depth: number,
) => ExistingStatusPageGroup;

const existing: ExistingFunction = (
  name: string,
  depth: number,
): ExistingStatusPageGroup => {
  return { id: `existing-${name}`, name: name, depth: depth };
};

describe("parseStatusPageGroupCsv — the file as a whole", () => {
  test("empty file returns a file-level error and no rows", () => {
    const result: StatusPageGroupCsvParseResult = parseStatusPageGroupCsv("");
    expect(result.rows).toEqual([]);
    expect(result.errors).toEqual([{ line: 0, message: "The CSV is empty." }]);
  });

  test("whitespace-only file is treated as empty", () => {
    const result: StatusPageGroupCsvParseResult =
      parseStatusPageGroupCsv("\n\n   \n");
    expect(result.rows).toEqual([]);
    expect(result.errors).toEqual([{ line: 0, message: "The CSV is empty." }]);
  });

  test("header-only file errors: no data rows", () => {
    const result: StatusPageGroupCsvParseResult = parseStatusPageGroupCsv(
      `${FULL_HEADER}\n`,
    );
    expect(result.rows).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.message).toContain("no data rows");
  });

  test("file without a trailing newline still parses the last row", () => {
    const result: StatusPageGroupCsvParseResult = parseStatusPageGroupCsv(
      "name\nCore Services",
    );
    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(1);
  });

  test("blank lines are skipped without shifting line numbers", () => {
    const result: StatusPageGroupCsvParseResult =
      parseStatusPageGroupCsv("name\n\nA\n\n\nB\n");
    expect(result.errors).toEqual([]);
    expect(
      result.rows.map((row: ParsedStatusPageGroupRow) => {
        return [row.name, row.line];
      }),
    ).toEqual([
      ["A", 3],
      ["B", 6],
    ]);
  });

  test("CRLF line endings parse identically to LF", () => {
    const result: StatusPageGroupCsvParseResult = parseStatusPageGroupCsv(
      "name,parentName\r\nA,\r\nB,A\r\n",
    );
    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[1]!.parentName).toBe("A");
    expect(result.rows[1]!.line).toBe(3);
  });
});

describe("parseStatusPageGroupCsv — the header", () => {
  test("name alone is a valid header", () => {
    const result: StatusPageGroupCsvParseResult = parseStatusPageGroupCsv(
      "name\nCore Services\n",
    );
    expect(result.errors).toEqual([]);
    expect(result.rows).toEqual([makeRow({ line: 2, name: "Core Services" })]);
  });

  test("columns match case-insensitively and in any order", () => {
    const result: StatusPageGroupCsvParseResult = parseStatusPageGroupCsv(
      "PARENTNAME,NAME,viewmode\n,Core Services,Grid\n",
    );
    expect(result.errors).toEqual([]);
    expect(result.rows[0]!.name).toBe("Core Services");
    expect(result.rows[0]!.viewMode).toBe(StatusPageGroupViewMode.Grid);
  });

  test("missing the name column is a fatal error", () => {
    const result: StatusPageGroupCsvParseResult = parseStatusPageGroupCsv(
      "parentName,description\nCore,Hello\n",
    );
    expect(result.rows).toEqual([]);
    expect(messages(result)).toEqual([
      'Missing required column "name" in header.',
    ]);
  });

  test("unknown header column is a fatal error naming the column", () => {
    const result: StatusPageGroupCsvParseResult = parseStatusPageGroupCsv(
      "name,parentGroup\nA,\n",
    );
    expect(result.rows).toEqual([]);
    expect(result.errors[0]!.message).toContain('Unknown column "parentGroup"');
    // The message has to list what the author could have written instead.
    expect(result.errors[0]!.message).toContain("uptimePercentPrecision");
  });

  test("duplicate header column is a fatal error", () => {
    const result: StatusPageGroupCsvParseResult = parseStatusPageGroupCsv(
      "name,description,name\nA,x,B\n",
    );
    expect(result.rows).toEqual([]);
    expect(
      result.errors.some((error: StatusPageGroupCsvError) => {
        return error.message.includes('Duplicate column "name"');
      }),
    ).toBe(true);
  });

  test("missing trailing cells are padded as empty", () => {
    const result: StatusPageGroupCsvParseResult = parseStatusPageGroupCsv(
      `${FULL_HEADER}\nCore Services\n`,
    );
    expect(result.errors).toEqual([]);
    expect(result.rows[0]).toEqual(makeRow({ line: 2, name: "Core Services" }));
  });

  test("row with more values than header columns is rejected", () => {
    const result: StatusPageGroupCsvParseResult = parseStatusPageGroupCsv(
      "name,parentName\nA,,extra\n",
    );
    expect(result.rows).toEqual([]);
    expect(result.errors).toEqual([
      {
        line: 2,
        message: "Row has 3 values but the header has 2 columns.",
      },
    ]);
  });
});

describe("parseStatusPageGroupCsv — quoting", () => {
  test("quoted fields keep commas", () => {
    const result: StatusPageGroupCsvParseResult = parseStatusPageGroupCsv(
      'name,description\n"Core, Shared","API, database, and auth"\n',
    );
    expect(result.errors).toEqual([]);
    expect(result.rows[0]!.name).toBe("Core, Shared");
    expect(result.rows[0]!.description).toBe("API, database, and auth");
  });

  /*
   * The axis columns are themselves comma-separated lists, so quoting is not
   * a nicety here — it is the only way to express more than one axis value.
   */
  test("a quoted axis list survives as one cell", () => {
    const result: StatusPageGroupCsvParseResult = parseStatusPageGroupCsv(
      'name,viewMode,rowAxisValues,columnAxisValues\nRegions,Grid,"Auth, API, Database","US-East, EU-West"\n',
    );
    expect(result.errors).toEqual([]);
    expect(result.rows[0]!.rowAxisValues).toBe("Auth, API, Database");
    expect(result.rows[0]!.columnAxisValues).toBe("US-East, EU-West");
  });

  test("escaped quotes inside quoted fields become literal quotes", () => {
    const result: StatusPageGroupCsvParseResult = parseStatusPageGroupCsv(
      'name\n"The ""Core"" Group"\n',
    );
    expect(result.errors).toEqual([]);
    expect(result.rows[0]!.name).toBe('The "Core" Group');
  });

  test("newlines inside quoted fields stay inside the cell", () => {
    const result: StatusPageGroupCsvParseResult = parseStatusPageGroupCsv(
      'name,description\nA,"Line one\nLine two"\nB,\n',
    );
    expect(result.errors).toEqual([]);
    expect(result.rows[0]!.description).toBe("Line one\nLine two");
    // The row after a multi-line cell still reports its own start line.
    expect(result.rows[1]!.line).toBe(4);
  });

  test("unterminated quote is a fatal error", () => {
    const result: StatusPageGroupCsvParseResult =
      parseStatusPageGroupCsv('name\n"Broken\n');
    expect(result.rows).toEqual([]);
    expect(result.errors[0]!.message).toContain("Unterminated quoted field");
  });

  test("cells are trimmed; quoted cells keep interior spacing", () => {
    const result: StatusPageGroupCsvParseResult = parseStatusPageGroupCsv(
      'name,description\n  A  ,"  spaced  "\n',
    );
    expect(result.errors).toEqual([]);
    expect(result.rows[0]!.name).toBe("A");
    expect(result.rows[0]!.description).toBe("  spaced  ");
  });
});

describe("parseStatusPageGroupCsv — names and parents", () => {
  test("empty name is a row error", () => {
    const result: StatusPageGroupCsvParseResult = parseStatusPageGroupCsv(
      "name,description\n,Nameless\n",
    );
    expect(result.rows).toEqual([]);
    expect(result.errors).toEqual([{ line: 2, message: "name is required." }]);
  });

  test("a group cannot be its own parent", () => {
    const result: StatusPageGroupCsvParseResult = parseStatusPageGroupCsv(
      "name,parentName\nA,A\n",
    );
    expect(result.rows).toEqual([]);
    expect(result.errors).toEqual([
      { line: 2, message: "A group cannot be its own parent." },
    ]);
  });

  test("duplicate names within the file flag the later row", () => {
    const result: StatusPageGroupCsvParseResult =
      parseStatusPageGroupCsv("name\nA\nB\nA\n");
    expect(
      result.rows.map((row: ParsedStatusPageGroupRow) => {
        return row.name;
      }),
    ).toEqual(["A", "B"]);
    expect(result.errors).toEqual([
      {
        line: 4,
        message: 'Duplicate group name "A" (first used on line 2).',
      },
    ]);
  });

  test("a bad row does not poison surrounding good rows", () => {
    const result: StatusPageGroupCsvParseResult =
      parseStatusPageGroupCsv("name\nA\n\nB\n");
    expect(result.rows).toHaveLength(2);

    const withBadRow: StatusPageGroupCsvParseResult = parseStatusPageGroupCsv(
      "name,parentName\nA,\n,orphan\nB,\n",
    );
    expect(
      withBadRow.rows.map((row: ParsedStatusPageGroupRow) => {
        return row.name;
      }),
    ).toEqual(["A", "B"]);
    expect(withBadRow.errors).toHaveLength(1);
    expect(withBadRow.errors[0]!.line).toBe(3);
  });

  test("every problem on one row is reported, not just the first", () => {
    const result: StatusPageGroupCsvParseResult = parseStatusPageGroupCsv(
      "name,isExpandedByDefault,viewMode\nA,maybe,Tiles\n",
    );
    expect(result.rows).toEqual([]);
    expect(result.errors).toHaveLength(2);
    expect(messages(result)[0]).toContain("isExpandedByDefault");
    expect(messages(result)[1]).toContain('Unknown viewMode "Tiles"');
  });
});

describe("parseStatusPageGroupCsv — boolean columns", () => {
  test.each([
    ["true", true],
    ["TRUE", true],
    ["True", true],
    ["yes", true],
    ["Y", true],
    ["1", true],
    ["false", false],
    ["FALSE", false],
    ["no", false],
    ["n", false],
    ["0", false],
  ])("%s reads as %s", (cell: string, expected: boolean) => {
    const result: StatusPageGroupCsvParseResult = parseStatusPageGroupCsv(
      `name,isExpandedByDefault\nA,${cell}\n`,
    );
    expect(result.errors).toEqual([]);
    expect(result.rows[0]!.isExpandedByDefault).toBe(expected);
  });

  /*
   * The whole point of leaving a cell blank is to get the model's default.
   * A blank that read as `false` would collapse every imported group on a
   * page whose author only filled in the name column.
   */
  test("a blank boolean stays undefined rather than becoming false", () => {
    const result: StatusPageGroupCsvParseResult = parseStatusPageGroupCsv(
      "name,isExpandedByDefault,showCurrentStatus,showUptimePercent\nA,,,\n",
    );
    expect(result.errors).toEqual([]);
    expect(result.rows[0]!.isExpandedByDefault).toBeUndefined();
    expect(result.rows[0]!.showCurrentStatus).toBeUndefined();
    expect(result.rows[0]!.showUptimePercent).toBeUndefined();
  });

  test("an unrecognised boolean is an error, not a silent false", () => {
    const result: StatusPageGroupCsvParseResult = parseStatusPageGroupCsv(
      "name,showCurrentStatus\nA,off\n",
    );
    expect(result.rows).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.message).toContain('showCurrentStatus "off"');
    expect(result.errors[0]!.message).toContain("Use true or false");
  });

  test("each boolean column is validated on its own", () => {
    const result: StatusPageGroupCsvParseResult = parseStatusPageGroupCsv(
      "name,isExpandedByDefault,showCurrentStatus,showUptimePercent\nA,true,nope,false\n",
    );
    expect(result.rows).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.message).toContain("showCurrentStatus");
  });
});

describe("parseStatusPageGroupCsv — enum columns", () => {
  test.each([
    ["List", StatusPageGroupViewMode.List],
    ["list", StatusPageGroupViewMode.List],
    ["Grid", StatusPageGroupViewMode.Grid],
    ["GRID", StatusPageGroupViewMode.Grid],
  ])("viewMode %s reads as %s", (cell: string, expected: string) => {
    const result: StatusPageGroupCsvParseResult = parseStatusPageGroupCsv(
      `name,viewMode\nA,${cell}\n`,
    );
    expect(result.errors).toEqual([]);
    expect(result.rows[0]!.viewMode).toBe(expected);
  });

  test("a blank viewMode stays undefined", () => {
    const result: StatusPageGroupCsvParseResult = parseStatusPageGroupCsv(
      "name,viewMode\nA,\n",
    );
    expect(result.errors).toEqual([]);
    expect(result.rows[0]!.viewMode).toBeUndefined();
  });

  test("unknown viewMode is an error listing the valid values", () => {
    const result: StatusPageGroupCsvParseResult = parseStatusPageGroupCsv(
      "name,viewMode\nA,Tiles\n",
    );
    expect(result.rows).toEqual([]);
    expect(result.errors[0]!.message).toContain('Unknown viewMode "Tiles"');
    expect(result.errors[0]!.message).toContain("Valid values: List, Grid.");
  });

  /*
   * The precision enum's VALUES are display strings ("99.9% (One Decimal)")
   * and its KEYS are the readable identifiers. A CSV author will reach for
   * either, so both resolve — matched on letters and digits alone.
   */
  test.each([
    ["ONE_DECIMAL", UptimePrecision.ONE_DECIMAL],
    ["one_decimal", UptimePrecision.ONE_DECIMAL],
    ["One Decimal", UptimePrecision.ONE_DECIMAL],
    ["one-decimal", UptimePrecision.ONE_DECIMAL],
    ["NO_DECIMAL", UptimePrecision.NO_DECIMAL],
    ["TWO_DECIMAL", UptimePrecision.TWO_DECIMAL],
    ["THREE_DECIMAL", UptimePrecision.THREE_DECIMAL],
    ["99.99% (Two Decimal)", UptimePrecision.TWO_DECIMAL],
  ])(
    "uptimePercentPrecision %s reads as %s",
    (cell: string, expected: string) => {
      const result: StatusPageGroupCsvParseResult = parseStatusPageGroupCsv(
        `name,showUptimePercent,uptimePercentPrecision\nA,true,"${cell}"\n`,
      );
      expect(result.errors).toEqual([]);
      expect(result.rows[0]!.uptimePercentPrecision).toBe(expected);
    },
  );

  test("unknown precision is an error listing the valid values", () => {
    const result: StatusPageGroupCsvParseResult = parseStatusPageGroupCsv(
      "name,uptimePercentPrecision\nA,FOUR_DECIMAL\n",
    );
    expect(result.rows).toEqual([]);
    expect(result.errors[0]!.message).toContain(
      'Unknown uptimePercentPrecision "FOUR_DECIMAL"',
    );
    expect(result.errors[0]!.message).toContain("ONE_DECIMAL");
  });

  /*
   * The create form makes the precision required the moment uptime is shown,
   * defaulting it to one decimal. A CSV that asks for the percent and says
   * nothing about precision has to mean the same thing, or the group renders
   * a percentage with no precision behind it.
   */
  test("showUptimePercent without a precision defaults to one decimal", () => {
    const result: StatusPageGroupCsvParseResult = parseStatusPageGroupCsv(
      "name,showUptimePercent\nA,true\n",
    );
    expect(result.errors).toEqual([]);
    expect(result.rows[0]!.uptimePercentPrecision).toBe(
      UptimePrecision.ONE_DECIMAL,
    );
  });

  test("an explicit precision beats the default", () => {
    const result: StatusPageGroupCsvParseResult = parseStatusPageGroupCsv(
      "name,showUptimePercent,uptimePercentPrecision\nA,true,THREE_DECIMAL\n",
    );
    expect(result.rows[0]!.uptimePercentPrecision).toBe(
      UptimePrecision.THREE_DECIMAL,
    );
  });

  test("no default is invented when uptime is not being shown", () => {
    for (const cell of ["", "false"]) {
      const result: StatusPageGroupCsvParseResult = parseStatusPageGroupCsv(
        `name,showUptimePercent\nA,${cell}\n`,
      );
      expect(result.errors).toEqual([]);
      expect(result.rows[0]!.uptimePercentPrecision).toBeUndefined();
    }
  });
});

describe("parseStatusPageGroupCsv — the grid axis columns", () => {
  test("a Grid row keeps all four axis cells", () => {
    const result: StatusPageGroupCsvParseResult = parseStatusPageGroupCsv(
      'name,viewMode,rowAxisLabel,rowAxisValues,columnAxisLabel,columnAxisValues\nRegions,Grid,Service,"Auth, API",Region,"US-East, EU-West"\n',
    );
    expect(result.errors).toEqual([]);
    expect(result.rows[0]).toEqual(
      makeRow({
        line: 2,
        name: "Regions",
        viewMode: StatusPageGroupViewMode.Grid,
        rowAxisLabel: "Service",
        rowAxisValues: "Auth, API",
        columnAxisLabel: "Region",
        columnAxisValues: "US-East, EU-West",
      }),
    );
  });

  /*
   * Nothing reads the axis columns on a List group, so importing them would
   * drop them on the floor without a word. Better to say so while the author
   * is still looking at the preview.
   */
  test.each([
    ["rowAxisLabel", "Service"],
    ["rowAxisValues", "Auth"],
    ["columnAxisLabel", "Region"],
    ["columnAxisValues", "US-East"],
  ])("%s on a List row is an error", (column: string, value: string) => {
    const result: StatusPageGroupCsvParseResult = parseStatusPageGroupCsv(
      `name,viewMode,${column}\nA,List,${value}\n`,
    );
    expect(result.rows).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.message).toBe(
      `${column} only applies when viewMode is Grid.`,
    );
  });

  test("axis columns on a row with no viewMode at all are an error too", () => {
    const result: StatusPageGroupCsvParseResult = parseStatusPageGroupCsv(
      "name,rowAxisLabel\nA,Service\n",
    );
    expect(result.rows).toEqual([]);
    expect(result.errors[0]!.message).toBe(
      "rowAxisLabel only applies when viewMode is Grid.",
    );
  });

  test("all offending axis columns are named in one message", () => {
    const result: StatusPageGroupCsvParseResult = parseStatusPageGroupCsv(
      "name,viewMode,rowAxisLabel,columnAxisLabel\nA,List,Service,Region\n",
    );
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.message).toBe(
      "rowAxisLabel, columnAxisLabel only applies when viewMode is Grid.",
    );
  });

  test("blank axis columns on a List row are fine", () => {
    const result: StatusPageGroupCsvParseResult = parseStatusPageGroupCsv(
      `${FULL_HEADER}\nA,,,,,,,List,,,,\n`,
    );
    expect(result.errors).toEqual([]);
    expect(result.rows[0]!.viewMode).toBe(StatusPageGroupViewMode.List);
  });

  /*
   * An unparseable viewMode is already reported. Adding "and your axes are
   * wrong too" on the same row would send the author chasing a second
   * problem that does not exist.
   */
  test("a bad viewMode does not also produce an axis complaint", () => {
    const result: StatusPageGroupCsvParseResult = parseStatusPageGroupCsv(
      "name,viewMode,rowAxisLabel\nA,Tiles,Service\n",
    );
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.message).toContain('Unknown viewMode "Tiles"');
  });
});

describe("parseStatusPageGroupCsv — a fully populated file", () => {
  test("every column round-trips onto the parsed row", () => {
    const result: StatusPageGroupCsvParseResult = parseStatusPageGroupCsv(
      [
        FULL_HEADER,
        "Core Services,,The core,true,true,true,TWO_DECIMAL,List,,,,",
        'Regions,Core Services,"By region",false,false,false,,Grid,Service,"Auth, API",Region,"US-East, EU-West"',
      ].join("\n"),
    );

    expect(result.errors).toEqual([]);
    expect(result.rows).toEqual([
      makeRow({
        line: 2,
        name: "Core Services",
        description: "The core",
        isExpandedByDefault: true,
        showCurrentStatus: true,
        showUptimePercent: true,
        uptimePercentPrecision: UptimePrecision.TWO_DECIMAL,
        viewMode: StatusPageGroupViewMode.List,
      }),
      makeRow({
        line: 3,
        name: "Regions",
        parentName: "Core Services",
        description: "By region",
        isExpandedByDefault: false,
        showCurrentStatus: false,
        showUptimePercent: false,
        viewMode: StatusPageGroupViewMode.Grid,
        rowAxisLabel: "Service",
        rowAxisValues: "Auth, API",
        columnAxisLabel: "Region",
        columnAxisValues: "US-East, EU-West",
      }),
    ]);
  });
});

/*
 * The example is what the modal offers as a downloadable template and shows
 * as its placeholder — the file most authors will start from. A template
 * that does not survive its own parser is worse than no template at all, so
 * it is run through the real thing here rather than eyeballed.
 */
describe("the example file the product hands out", () => {
  const result: StatusPageGroupCsvParseResult = parseStatusPageGroupCsv(
    STATUS_PAGE_GROUP_CSV_EXAMPLE,
  );

  test("parses without a single error", () => {
    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(3);
  });

  test("its header is the canonical column list", () => {
    expect(STATUS_PAGE_GROUP_CSV_EXAMPLE.split("\n")[0]).toBe(FULL_HEADER);
  });

  /*
   * The three shapes an author has to get right. If the example stops
   * demonstrating one of them it has stopped being a useful template.
   */
  test("it demonstrates a top level group, a nested child and a grid", () => {
    expect(result.rows[0]!.parentName).toBe("");
    expect(result.rows[1]!.parentName).toBe(result.rows[0]!.name);
    expect(result.rows[2]!.viewMode).toBe(StatusPageGroupViewMode.Grid);
    // Quoted, because an axis list is itself comma-separated.
    expect(result.rows[2]!.rowAxisValues).toBe("Auth, API, Database");
  });

  test("and it imports as one clean batch order", () => {
    const plan: StatusPageGroupImportPlan = planStatusPageGroupImport(
      result.rows,
      [],
    );
    expect(plan.skipped).toEqual([]);
    expect(
      plan.batches.map((batch: Array<ParsedStatusPageGroupRow>) => {
        return batch.map((row: ParsedStatusPageGroupRow) => {
          return row.name;
        });
      }),
    ).toEqual([["Core Services", "Regional Availability"], ["API"]]);
  });
});

describe("planStatusPageGroupImport — ordering", () => {
  test("empty input plans nothing", () => {
    const plan: StatusPageGroupImportPlan = planStatusPageGroupImport([], []);
    expect(plan.batches).toEqual([]);
    expect(plan.skipped).toEqual([]);
  });

  test("top level rows and rows with an existing parent land in batch 0", () => {
    const root: ParsedStatusPageGroupRow = makeRow({ name: "Root" });
    const child: ParsedStatusPageGroupRow = makeRow({
      name: "Child",
      parentName: "Existing",
    });

    const plan: StatusPageGroupImportPlan = planStatusPageGroupImport(
      [root, child],
      [existing("Existing", 0)],
    );

    expect(plan.batches).toEqual([[root, child]]);
    expect(plan.skipped).toEqual([]);
  });

  test("children created in the file follow their parents, batch by batch", () => {
    const grandchild: ParsedStatusPageGroupRow = makeRow({
      name: "C",
      parentName: "B",
    });
    const child: ParsedStatusPageGroupRow = makeRow({
      name: "B",
      parentName: "A",
    });
    const root: ParsedStatusPageGroupRow = makeRow({ name: "A" });

    // Deliberately out of order in the file.
    const plan: StatusPageGroupImportPlan = planStatusPageGroupImport(
      [grandchild, child, root],
      [],
    );

    expect(plan.batches).toEqual([[root], [child], [grandchild]]);
    expect(plan.skipped).toEqual([]);
  });
});

describe("planStatusPageGroupImport — rows that can never be created", () => {
  test("an unresolvable parent is skipped, and its descendants cascade", () => {
    const orphan: ParsedStatusPageGroupRow = makeRow({
      name: "Orphan",
      parentName: "Ghost",
    });
    const childOfOrphan: ParsedStatusPageGroupRow = makeRow({
      name: "Deeper",
      parentName: "Orphan",
    });
    const ok: ParsedStatusPageGroupRow = makeRow({ name: "OK" });

    const plan: StatusPageGroupImportPlan = planStatusPageGroupImport(
      [orphan, childOfOrphan, ok],
      [],
    );

    expect(plan.batches).toEqual([[ok]]);
    expect(plan.skipped).toHaveLength(2);
    expect(plan.skipped[0]!.reason).toBe(
      'Parent group "Ghost" was not found in the file or on this status page.',
    );
    /*
     * The child's parent IS in the file — telling the reader it "was not
     * found" would send them looking for a typo that is not there.
     */
    expect(plan.skipped[1]!.reason).toBe(
      'Parent group "Orphan" could not be created.',
    );
  });

  test("a dependency cycle is skipped instead of looping forever", () => {
    const a: ParsedStatusPageGroupRow = makeRow({ name: "A", parentName: "B" });
    const b: ParsedStatusPageGroupRow = makeRow({ name: "B", parentName: "A" });

    const plan: StatusPageGroupImportPlan = planStatusPageGroupImport(
      [a, b],
      [],
    );

    expect(plan.batches).toEqual([]);
    expect(plan.skipped).toHaveLength(2);
  });

  test("a name already on the status page is skipped up front", () => {
    const dupe: ParsedStatusPageGroupRow = makeRow({ name: "Core" });
    const child: ParsedStatusPageGroupRow = makeRow({
      name: "API",
      parentName: "Core",
    });

    const plan: StatusPageGroupImportPlan = planStatusPageGroupImport(
      [dupe, child],
      [existing("Core", 0)],
    );

    // The child still resolves — its parent is the group already on the page.
    expect(plan.batches).toEqual([[child]]);
    expect(plan.skipped).toHaveLength(1);
    expect(plan.skipped[0]!.row).toBe(dupe);
    expect(plan.skipped[0]!.reason).toBe(
      'A group named "Core" already exists on this status page.',
    );
  });
});

describe("planStatusPageGroupImport — the nesting limit", () => {
  /*
   * The number is the server's, enforced in StatusPageGroupService via
   * StatusPageGroupTreeUtil. Checking it here only helps if the two agree —
   * a copy that drifts would report rows as too deep that the API accepts,
   * or send rows it rejects.
   */
  test("the limit matches the one the server enforces", () => {
    expect(MAX_GROUP_NESTING_DEPTH).toBe(
      StatusPageGroupTreeUtil.MaxNestingDepth,
    );
  });

  test("a child of the deepest legal parent is still planned", () => {
    const child: ParsedStatusPageGroupRow = makeRow({
      name: "Deep",
      parentName: "Parent",
    });

    const plan: StatusPageGroupImportPlan = planStatusPageGroupImport(
      [child],
      [existing("Parent", MAX_GROUP_NESTING_DEPTH - 2)],
    );

    expect(plan.batches).toEqual([[child]]);
    expect(plan.skipped).toEqual([]);
  });

  test("one level deeper is skipped with a reason instead of being sent", () => {
    const child: ParsedStatusPageGroupRow = makeRow({
      name: "Too Deep",
      parentName: "Parent",
    });

    const plan: StatusPageGroupImportPlan = planStatusPageGroupImport(
      [child],
      [existing("Parent", MAX_GROUP_NESTING_DEPTH - 1)],
    );

    expect(plan.batches).toEqual([]);
    expect(plan.skipped).toEqual([
      {
        row: child,
        reason: `Nesting "Too Deep" under "Parent" would be more than ${MAX_GROUP_NESTING_DEPTH} levels deep.`,
      },
    ]);
  });

  test("depth accumulates through the chain the file itself builds", () => {
    // Two more levels than the page has room for.
    const rows: Array<ParsedStatusPageGroupRow> = [];
    for (let level: number = 0; level < MAX_GROUP_NESTING_DEPTH + 2; level++) {
      rows.push(
        makeRow({
          line: level + 2,
          name: `Level ${level}`,
          parentName: level === 0 ? "" : `Level ${level - 1}`,
        }),
      );
    }

    const plan: StatusPageGroupImportPlan = planStatusPageGroupImport(rows, []);

    // Depths 0 .. MAX-1 are legal, one batch each.
    expect(plan.batches).toHaveLength(MAX_GROUP_NESTING_DEPTH);
    expect(plan.skipped).toHaveLength(2);
    expect(plan.skipped[0]!.reason).toContain("levels deep");
    // ...and the level below it falls out behind its uncreated parent.
    expect(plan.skipped[1]!.reason).toBe(
      `Parent group "Level ${MAX_GROUP_NESTING_DEPTH}" could not be created.`,
    );
  });

  test("a too-deep row does not stop its siblings importing", () => {
    const tooDeep: ParsedStatusPageGroupRow = makeRow({
      name: "Too Deep",
      parentName: "Deep Parent",
    });
    const sibling: ParsedStatusPageGroupRow = makeRow({
      name: "Fine",
      parentName: "Shallow Parent",
    });

    const plan: StatusPageGroupImportPlan = planStatusPageGroupImport(
      [tooDeep, sibling],
      [
        existing("Deep Parent", MAX_GROUP_NESTING_DEPTH - 1),
        existing("Shallow Parent", 0),
      ],
    );

    expect(plan.batches).toEqual([[sibling]]);
    expect(plan.skipped).toHaveLength(1);
    expect(plan.skipped[0]!.row).toBe(tooDeep);
  });
});

describe("planStatusPageGroupImport — the caller's inputs are inputs", () => {
  test("the existing-groups list is not mutated", () => {
    const existingGroups: Array<ExistingStatusPageGroup> = [
      existing("Core", 0),
    ];
    const before: string = JSON.stringify(existingGroups);

    planStatusPageGroupImport(
      [makeRow({ name: "API", parentName: "Core" })],
      existingGroups,
    );

    expect(JSON.stringify(existingGroups)).toBe(before);
  });

  test("every row lands in exactly one batch or the skip list", () => {
    const rows: Array<ParsedStatusPageGroupRow> = [
      makeRow({ line: 2, name: "Root" }),
      makeRow({ line: 3, name: "Child", parentName: "Root" }),
      makeRow({ line: 4, name: "Core" }),
      makeRow({ line: 5, name: "Orphan", parentName: "Ghost" }),
    ];

    const plan: StatusPageGroupImportPlan = planStatusPageGroupImport(rows, [
      existing("Core", 0),
    ]);

    const planned: number =
      plan.batches.reduce(
        (sum: number, batch: Array<ParsedStatusPageGroupRow>) => {
          return sum + batch.length;
        },
        0,
      ) + plan.skipped.length;

    expect(planned).toBe(rows.length);
  });
});
