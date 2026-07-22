import { describe, expect, test } from "@jest/globals";
import NetworkSiteType from "Common/Types/NetworkSite/NetworkSiteType";
import {
  ParsedSiteRow,
  SiteCsvParseResult,
  SiteImportPlan,
  parseSiteCsv,
  planSiteImport,
} from "../../FeatureSet/Dashboard/src/Utils/NetworkSiteCsv";

/*
 * Pins the pure CSV parser + import planner behind the Network Sites
 * bulk-import page: header validation, quoted-field support, coordinate
 * and siteType validation, duplicate flagging, and the dependency-order
 * batching that lets parents in the same file be created before their
 * children.
 */

const HEADER: string = "name,siteType,parentName,address,latitude,longitude";

type MakeRowFunction = (overrides: Partial<ParsedSiteRow>) => ParsedSiteRow;

const makeRow: MakeRowFunction = (
  overrides: Partial<ParsedSiteRow>,
): ParsedSiteRow => {
  return {
    line: 2,
    name: "Site",
    siteType: NetworkSiteType.Unit,
    parentName: "",
    address: "",
    latitude: undefined,
    longitude: undefined,
    ...overrides,
  };
};

describe("parseSiteCsv", () => {
  test("empty file returns a file-level error and no rows", () => {
    const result: SiteCsvParseResult = parseSiteCsv("");
    expect(result.rows).toEqual([]);
    expect(result.errors).toEqual([{ line: 0, message: "The CSV is empty." }]);
  });

  test("whitespace-only file is treated as empty", () => {
    const result: SiteCsvParseResult = parseSiteCsv("\n\n   \n");
    expect(result.rows).toEqual([]);
    expect(result.errors).toEqual([{ line: 0, message: "The CSV is empty." }]);
  });

  test("header-only file errors: no data rows", () => {
    const result: SiteCsvParseResult = parseSiteCsv(`${HEADER}\n`);
    expect(result.rows).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.message).toContain("no data rows");
  });

  test("parses a plain row with every column populated", () => {
    const result: SiteCsvParseResult = parseSiteCsv(
      `${HEADER}\nUnit 1042,Unit,Springfield Market,742 Evergreen Terrace,39.7817,-89.6501\n`,
    );
    expect(result.errors).toEqual([]);
    expect(result.rows).toEqual([
      {
        line: 2,
        name: "Unit 1042",
        siteType: NetworkSiteType.Unit,
        parentName: "Springfield Market",
        address: "742 Evergreen Terrace",
        latitude: 39.7817,
        longitude: -89.6501,
      },
    ]);
  });

  test("optional columns may be omitted from the header entirely", () => {
    const result: SiteCsvParseResult = parseSiteCsv(
      "name,siteType\nHQ,Data Center\n",
    );
    expect(result.errors).toEqual([]);
    expect(result.rows).toEqual([
      {
        line: 2,
        name: "HQ",
        siteType: NetworkSiteType.DataCenter,
        parentName: "",
        address: "",
        latitude: undefined,
        longitude: undefined,
      },
    ]);
  });

  test("header columns match case-insensitively and in any order", () => {
    const result: SiteCsvParseResult = parseSiteCsv(
      "SITETYPE,NAME,parentname\nRegion,West,\n",
    );
    expect(result.errors).toEqual([]);
    expect(result.rows[0]!.name).toBe("West");
    expect(result.rows[0]!.siteType).toBe(NetworkSiteType.Region);
  });

  test("missing required header column is a fatal error", () => {
    const result: SiteCsvParseResult = parseSiteCsv("name,parentName\nA,\n");
    expect(result.rows).toEqual([]);
    expect(
      result.errors.some((error: { message: string }) => {
        return error.message.includes('Missing required column "siteType"');
      }),
    ).toBe(true);
  });

  test("unknown header column is a fatal error naming the column", () => {
    const result: SiteCsvParseResult = parseSiteCsv(
      "name,siteType,lattitude\nA,Unit,1\n",
    );
    expect(result.rows).toEqual([]);
    expect(
      result.errors.some((error: { message: string }) => {
        return error.message.includes('Unknown column "lattitude"');
      }),
    ).toBe(true);
  });

  test("duplicate header column is a fatal error", () => {
    const result: SiteCsvParseResult = parseSiteCsv(
      "name,siteType,name\nA,Unit,B\n",
    );
    expect(result.rows).toEqual([]);
    expect(
      result.errors.some((error: { message: string }) => {
        return error.message.includes('Duplicate column "name"');
      }),
    ).toBe(true);
  });

  test("quoted fields keep commas", () => {
    const result: SiteCsvParseResult = parseSiteCsv(
      `${HEADER}\n"Springfield, IL Market",Market,,"742 Evergreen Terrace, Springfield, IL",,\n`,
    );
    expect(result.errors).toEqual([]);
    expect(result.rows[0]!.name).toBe("Springfield, IL Market");
    expect(result.rows[0]!.address).toBe(
      "742 Evergreen Terrace, Springfield, IL",
    );
  });

  test("escaped quotes inside quoted fields become literal quotes", () => {
    const result: SiteCsvParseResult = parseSiteCsv(
      `${HEADER}\n"The ""Best"" Unit",Unit,,,,\n`,
    );
    expect(result.errors).toEqual([]);
    expect(result.rows[0]!.name).toBe('The "Best" Unit');
  });

  test("newlines inside quoted fields stay inside the cell", () => {
    const result: SiteCsvParseResult = parseSiteCsv(
      `${HEADER}\nHQ,Data Center,,"Line one\nLine two",,\nBranch,Unit,,,,\n`,
    );
    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]!.address).toBe("Line one\nLine two");
    // The row after a multi-line cell still reports its own start line.
    expect(result.rows[1]!.line).toBe(4);
  });

  test("unterminated quote is a fatal error", () => {
    const result: SiteCsvParseResult = parseSiteCsv(
      `${HEADER}\n"Broken,Unit,,,,\n`,
    );
    expect(result.rows).toEqual([]);
    expect(
      result.errors.some((error: { message: string }) => {
        return error.message.includes("Unterminated quoted field");
      }),
    ).toBe(true);
  });

  test("CRLF line endings parse identically to LF", () => {
    const result: SiteCsvParseResult = parseSiteCsv(
      `${HEADER}\r\nA,Unit,,,,\r\nB,Market,A,,,\r\n`,
    );
    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]!.name).toBe("A");
    expect(result.rows[1]!.parentName).toBe("A");
    expect(result.rows[1]!.line).toBe(3);
  });

  test("blank lines are skipped without shifting line numbers", () => {
    const result: SiteCsvParseResult = parseSiteCsv(
      `${HEADER}\n\nA,Unit,,,,\n\n\nB,Unit,,,,\n`,
    );
    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]!.line).toBe(3);
    expect(result.rows[1]!.line).toBe(6);
  });

  test("file without trailing newline still parses the last row", () => {
    const result: SiteCsvParseResult = parseSiteCsv(`${HEADER}\nA,Unit,,,,`);
    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(1);
  });

  test("missing trailing cells are padded as empty", () => {
    const result: SiteCsvParseResult = parseSiteCsv(`${HEADER}\nA,Unit\n`);
    expect(result.errors).toEqual([]);
    expect(result.rows[0]!.parentName).toBe("");
    expect(result.rows[0]!.address).toBe("");
  });

  test("row with more values than header columns is rejected", () => {
    const result: SiteCsvParseResult = parseSiteCsv(
      `${HEADER}\nA,Unit,,,,,extra\n`,
    );
    expect(result.rows).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.line).toBe(2);
    expect(result.errors[0]!.message).toContain("7 values");
  });

  test("empty name is a row error", () => {
    const result: SiteCsvParseResult = parseSiteCsv(`${HEADER}\n,Unit,,,,\n`);
    expect(result.rows).toEqual([]);
    expect(result.errors).toEqual([{ line: 2, message: "name is required." }]);
  });

  test("unknown siteType is a row error listing valid values", () => {
    const result: SiteCsvParseResult = parseSiteCsv(`${HEADER}\nA,Store,,,,\n`);
    expect(result.rows).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.message).toContain('Unknown siteType "Store"');
    expect(result.errors[0]!.message).toContain("Data Center");
  });

  test("empty siteType is a row error", () => {
    const result: SiteCsvParseResult = parseSiteCsv(`${HEADER}\nA,,,,,\n`);
    expect(result.rows).toEqual([]);
    expect(result.errors).toEqual([
      { line: 2, message: "siteType is required." },
    ]);
  });

  test("siteType matches case-insensitively, incl. multi-word values", () => {
    const result: SiteCsvParseResult = parseSiteCsv(
      `${HEADER}\nA,unit,,,,\nB,data center,,,,\nC,ACCOUNT TYPE,,,,\n`,
    );
    expect(result.errors).toEqual([]);
    expect(result.rows.map((row: ParsedSiteRow) => row.siteType)).toEqual([
      NetworkSiteType.Unit,
      NetworkSiteType.DataCenter,
      NetworkSiteType.AccountType,
    ]);
  });

  test("non-numeric latitude is a row error", () => {
    const result: SiteCsvParseResult = parseSiteCsv(
      `${HEADER}\nA,Unit,,,abc,-89.65\n`,
    );
    expect(result.rows).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.message).toContain('latitude "abc"');
  });

  test("out-of-range coordinates are row errors", () => {
    const result: SiteCsvParseResult = parseSiteCsv(
      `${HEADER}\nA,Unit,,,91,0\nB,Unit,,,0,-181\n`,
    );
    expect(result.rows).toEqual([]);
    expect(result.errors).toHaveLength(2);
    expect(result.errors[0]!.message).toContain("latitude 91 is out of range");
    expect(result.errors[1]!.message).toContain(
      "longitude -181 is out of range",
    );
  });

  test("latitude without longitude (and vice versa) is a row error", () => {
    const result: SiteCsvParseResult = parseSiteCsv(
      `${HEADER}\nA,Unit,,,39.78,\nB,Unit,,,,-89.65\n`,
    );
    expect(result.rows).toEqual([]);
    expect(result.errors).toHaveLength(2);
    for (const error of result.errors) {
      expect(error.message).toContain("must be provided together");
    }
  });

  test("boundary coordinates are accepted", () => {
    const result: SiteCsvParseResult = parseSiteCsv(
      `${HEADER}\nA,Unit,,,-90,180\nB,Unit,,,90,-180\nC,Unit,,,0,0\n`,
    );
    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(3);
    expect(result.rows[2]!.latitude).toBe(0);
    expect(result.rows[2]!.longitude).toBe(0);
  });

  test("duplicate names within the file flag the later row", () => {
    const result: SiteCsvParseResult = parseSiteCsv(
      `${HEADER}\nA,Unit,,,,\nB,Unit,,,,\nA,Market,,,,\n`,
    );
    expect(result.rows).toHaveLength(2);
    expect(result.errors).toEqual([
      {
        line: 4,
        message: 'Duplicate site name "A" (first used on line 2).',
      },
    ]);
  });

  test("a site cannot be its own parent", () => {
    const result: SiteCsvParseResult = parseSiteCsv(`${HEADER}\nA,Unit,A,,,\n`);
    expect(result.rows).toEqual([]);
    expect(result.errors).toEqual([
      { line: 2, message: "A site cannot be its own parent." },
    ]);
  });

  test("a bad row does not poison surrounding good rows", () => {
    const result: SiteCsvParseResult = parseSiteCsv(
      `${HEADER}\nA,Unit,,,,\n,Unit,,,,\nB,Unit,,,,\n`,
    );
    expect(result.rows.map((row: ParsedSiteRow) => row.name)).toEqual([
      "A",
      "B",
    ]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.line).toBe(3);
  });

  test("cells are trimmed; quoted cells keep interior spacing", () => {
    const result: SiteCsvParseResult = parseSiteCsv(
      `${HEADER}\n  A  , Unit ,,"  spaced address  ",,\n`,
    );
    expect(result.errors).toEqual([]);
    expect(result.rows[0]!.name).toBe("A");
    expect(result.rows[0]!.address).toBe("  spaced address  ");
  });
});

describe("planSiteImport", () => {
  test("empty input plans nothing", () => {
    const plan: SiteImportPlan = planSiteImport([], []);
    expect(plan.batches).toEqual([]);
    expect(plan.skipped).toEqual([]);
  });

  test("roots and rows with already-existing parents land in batch 0", () => {
    const root: ParsedSiteRow = makeRow({ name: "Root" });
    const child: ParsedSiteRow = makeRow({
      name: "Child",
      parentName: "Existing",
    });
    const plan: SiteImportPlan = planSiteImport([root, child], ["Existing"]);
    expect(plan.batches).toEqual([[root, child]]);
    expect(plan.skipped).toEqual([]);
  });

  test("children created in the file follow their parents, batch by batch", () => {
    const grandchild: ParsedSiteRow = makeRow({
      name: "C",
      parentName: "B",
    });
    const child: ParsedSiteRow = makeRow({ name: "B", parentName: "A" });
    const root: ParsedSiteRow = makeRow({ name: "A" });
    // Deliberately out of order in the file.
    const plan: SiteImportPlan = planSiteImport([grandchild, child, root], []);
    expect(plan.batches).toEqual([[root], [child], [grandchild]]);
    expect(plan.skipped).toEqual([]);
  });

  test("unresolvable parent is skipped with a reason; descendants cascade", () => {
    const orphan: ParsedSiteRow = makeRow({
      name: "Orphan",
      parentName: "Ghost",
    });
    const childOfOrphan: ParsedSiteRow = makeRow({
      name: "Deeper",
      parentName: "Orphan",
    });
    const ok: ParsedSiteRow = makeRow({ name: "OK" });
    const plan: SiteImportPlan = planSiteImport(
      [orphan, childOfOrphan, ok],
      [],
    );
    expect(plan.batches).toEqual([[ok]]);
    expect(plan.skipped).toHaveLength(2);
    expect(plan.skipped[0]!.row).toBe(orphan);
    expect(plan.skipped[0]!.reason).toContain('"Ghost" was not found');
    expect(plan.skipped[1]!.row).toBe(childOfOrphan);
  });

  test("a dependency cycle is skipped instead of looping forever", () => {
    const a: ParsedSiteRow = makeRow({ name: "A", parentName: "B" });
    const b: ParsedSiteRow = makeRow({ name: "B", parentName: "A" });
    const plan: SiteImportPlan = planSiteImport([a, b], []);
    expect(plan.batches).toEqual([]);
    expect(plan.skipped).toHaveLength(2);
  });

  test("name collision with an existing site is skipped up front", () => {
    const dupe: ParsedSiteRow = makeRow({ name: "Existing" });
    const child: ParsedSiteRow = makeRow({
      name: "Child",
      parentName: "Existing",
    });
    const plan: SiteImportPlan = planSiteImport([dupe, child], ["Existing"]);
    // The child still resolves — its parent exists in the project.
    expect(plan.batches).toEqual([[child]]);
    expect(plan.skipped).toHaveLength(1);
    expect(plan.skipped[0]!.row).toBe(dupe);
    expect(plan.skipped[0]!.reason).toContain("already exists");
  });
});
