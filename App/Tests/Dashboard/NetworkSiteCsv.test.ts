import { describe, expect, test } from "@jest/globals";
import DefaultNetworkSiteType from "Common/Types/NetworkSite/DefaultNetworkSiteType";
import {
  DefaultNetworkSiteTypeCreationOrder,
  DefaultNetworkSiteTypeParent,
} from "Common/Types/NetworkSite/DefaultNetworkSiteTypeHierarchy";
import {
  NetworkSiteTypeOption,
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
 *
 * Site types are per-project rows now, so every parse is handed the
 * project's type list. The suite feeds it the default seeded names (the
 * ones every project starts with) so the CSV fixtures below stay readable,
 * plus a project that renamed and replaced them — which is the whole point
 * of the configurable model.
 */

const HEADER: string = "name,siteType,parentName,address,latitude,longitude";

/*
 * The default seeded types. Ids are opaque to the parser — it only echoes
 * back the one it matched — so readable stand-ins are enough.
 */
const DEFAULT_SITE_TYPES: Array<NetworkSiteTypeOption> = Object.values(
  DefaultNetworkSiteType,
).map((name: DefaultNetworkSiteType, index: number): NetworkSiteTypeOption => {
  return { id: `type-${index}`, name: name };
});

const DEFAULT_SITE_TYPE_ID_BY_NAME: Map<DefaultNetworkSiteType, string> =
  new Map<DefaultNetworkSiteType, string>(
    DEFAULT_SITE_TYPES.map((siteType: NetworkSiteTypeOption) => {
      return [siteType.name as DefaultNetworkSiteType, siteType.id];
    }),
  );

/*
 * The actual seeded parent graph. Most long-standing parser tests only need
 * name-to-id resolution, so DEFAULT_SITE_TYPES intentionally omits optional
 * hierarchy metadata. Placement tests use this full representation, matching
 * what the import modal supplies.
 */
const HIERARCHICAL_DEFAULT_SITE_TYPES: Array<NetworkSiteTypeOption> =
  DefaultNetworkSiteTypeCreationOrder.map(
    (name: DefaultNetworkSiteType): NetworkSiteTypeOption => {
      const parentName: DefaultNetworkSiteType | null =
        DefaultNetworkSiteTypeParent[name];

      return {
        id: DEFAULT_SITE_TYPE_ID_BY_NAME.get(name)!,
        name,
        parentNetworkSiteTypeId: parentName
          ? DEFAULT_SITE_TYPE_ID_BY_NAME.get(parentName)!
          : null,
      };
    },
  );

type SiteTypeIdOfFunction = (name: DefaultNetworkSiteType) => string;

const siteTypeIdOf: SiteTypeIdOfFunction = (
  name: DefaultNetworkSiteType,
): string => {
  return DEFAULT_SITE_TYPES.find((siteType: NetworkSiteTypeOption) => {
    return siteType.name === name;
  })!.id;
};

type MakeRowFunction = (overrides: Partial<ParsedSiteRow>) => ParsedSiteRow;

const makeRow: MakeRowFunction = (
  overrides: Partial<ParsedSiteRow>,
): ParsedSiteRow => {
  return {
    line: 2,
    name: "Site",
    networkSiteTypeId: siteTypeIdOf(DefaultNetworkSiteType.Unit),
    siteType: DefaultNetworkSiteType.Unit,
    parentName: "",
    address: "",
    latitude: undefined,
    longitude: undefined,
    ...overrides,
  };
};

describe("parseSiteCsv", () => {
  test("empty file returns a file-level error and no rows", () => {
    const result: SiteCsvParseResult = parseSiteCsv("", DEFAULT_SITE_TYPES);
    expect(result.rows).toEqual([]);
    expect(result.errors).toEqual([{ line: 0, message: "The CSV is empty." }]);
  });

  test("whitespace-only file is treated as empty", () => {
    const result: SiteCsvParseResult = parseSiteCsv(
      "\n\n   \n",
      DEFAULT_SITE_TYPES,
    );
    expect(result.rows).toEqual([]);
    expect(result.errors).toEqual([{ line: 0, message: "The CSV is empty." }]);
  });

  test("header-only file errors: no data rows", () => {
    const result: SiteCsvParseResult = parseSiteCsv(
      `${HEADER}\n`,
      DEFAULT_SITE_TYPES,
    );
    expect(result.rows).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.message).toContain("no data rows");
  });

  test("parses a plain row with every column populated", () => {
    const result: SiteCsvParseResult = parseSiteCsv(
      `${HEADER}\nUnit 1042,Unit,Springfield Market,742 Evergreen Terrace,39.7817,-89.6501\n`,
      DEFAULT_SITE_TYPES,
    );
    expect(result.errors).toEqual([]);
    expect(result.rows).toEqual([
      {
        line: 2,
        name: "Unit 1042",
        networkSiteTypeId: siteTypeIdOf(DefaultNetworkSiteType.Unit),
        siteType: DefaultNetworkSiteType.Unit,
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
      DEFAULT_SITE_TYPES,
    );
    expect(result.errors).toEqual([]);
    expect(result.rows).toEqual([
      {
        line: 2,
        name: "HQ",
        networkSiteTypeId: siteTypeIdOf(DefaultNetworkSiteType.DataCenter),
        siteType: DefaultNetworkSiteType.DataCenter,
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
      DEFAULT_SITE_TYPES,
    );
    expect(result.errors).toEqual([]);
    expect(result.rows[0]!.name).toBe("West");
    expect(result.rows[0]!.siteType).toBe(DefaultNetworkSiteType.Region);
  });

  test("missing required header column is a fatal error", () => {
    const result: SiteCsvParseResult = parseSiteCsv(
      "name,parentName\nA,\n",
      DEFAULT_SITE_TYPES,
    );
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
      DEFAULT_SITE_TYPES,
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
      DEFAULT_SITE_TYPES,
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
      DEFAULT_SITE_TYPES,
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
      DEFAULT_SITE_TYPES,
    );
    expect(result.errors).toEqual([]);
    expect(result.rows[0]!.name).toBe('The "Best" Unit');
  });

  test("newlines inside quoted fields stay inside the cell", () => {
    const result: SiteCsvParseResult = parseSiteCsv(
      `${HEADER}\nHQ,Data Center,,"Line one\nLine two",,\nBranch,Unit,,,,\n`,
      DEFAULT_SITE_TYPES,
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
      DEFAULT_SITE_TYPES,
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
      DEFAULT_SITE_TYPES,
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
      DEFAULT_SITE_TYPES,
    );
    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]!.line).toBe(3);
    expect(result.rows[1]!.line).toBe(6);
  });

  test("file without trailing newline still parses the last row", () => {
    const result: SiteCsvParseResult = parseSiteCsv(
      `${HEADER}\nA,Unit,,,,`,
      DEFAULT_SITE_TYPES,
    );
    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(1);
  });

  test("missing trailing cells are padded as empty", () => {
    const result: SiteCsvParseResult = parseSiteCsv(
      `${HEADER}\nA,Unit\n`,
      DEFAULT_SITE_TYPES,
    );
    expect(result.errors).toEqual([]);
    expect(result.rows[0]!.parentName).toBe("");
    expect(result.rows[0]!.address).toBe("");
  });

  test("row with more values than header columns is rejected", () => {
    const result: SiteCsvParseResult = parseSiteCsv(
      `${HEADER}\nA,Unit,,,,,extra\n`,
      DEFAULT_SITE_TYPES,
    );
    expect(result.rows).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.line).toBe(2);
    expect(result.errors[0]!.message).toContain("7 values");
  });

  test("empty name is a row error", () => {
    const result: SiteCsvParseResult = parseSiteCsv(
      `${HEADER}\n,Unit,,,,\n`,
      DEFAULT_SITE_TYPES,
    );
    expect(result.rows).toEqual([]);
    expect(result.errors).toEqual([{ line: 2, message: "name is required." }]);
  });

  test("unknown siteType is a row error listing valid values", () => {
    const result: SiteCsvParseResult = parseSiteCsv(
      `${HEADER}\nA,Store,,,,\n`,
      DEFAULT_SITE_TYPES,
    );
    expect(result.rows).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.message).toContain('Unknown siteType "Store"');
    expect(result.errors[0]!.message).toContain("Data Center");
  });

  test("empty siteType is a row error", () => {
    const result: SiteCsvParseResult = parseSiteCsv(
      `${HEADER}\nA,,,,,\n`,
      DEFAULT_SITE_TYPES,
    );
    expect(result.rows).toEqual([]);
    expect(result.errors).toEqual([
      { line: 2, message: "siteType is required." },
    ]);
  });

  test("siteType matches case-insensitively, incl. multi-word values", () => {
    const result: SiteCsvParseResult = parseSiteCsv(
      `${HEADER}\nA,unit,,,,\nB,data center,,,,\nC,ACCOUNT TYPE,,,,\n`,
      DEFAULT_SITE_TYPES,
    );
    expect(result.errors).toEqual([]);
    expect(
      result.rows.map((row: ParsedSiteRow) => {
        return row.siteType;
      }),
    ).toEqual([
      DefaultNetworkSiteType.Unit,
      DefaultNetworkSiteType.DataCenter,
      DefaultNetworkSiteType.AccountType,
    ]);
    // The configured type's own spelling wins over the cell's casing.
    expect(
      result.rows.map((row: ParsedSiteRow) => {
        return row.networkSiteTypeId;
      }),
    ).toEqual([
      siteTypeIdOf(DefaultNetworkSiteType.Unit),
      siteTypeIdOf(DefaultNetworkSiteType.DataCenter),
      siteTypeIdOf(DefaultNetworkSiteType.AccountType),
    ]);
  });

  test("cells resolve against THIS project's types, not the defaults", () => {
    /*
     * The point of the configurable model: a project that renamed "Unit" to
     * "Store" imports Stores, and the default names it deleted are now
     * invalid — the parser must never fall back to the seeded list.
     */
    const customTypes: Array<NetworkSiteTypeOption> = [
      { id: "brand-1", name: "Brand" },
      { id: "store-1", name: "Store" },
    ];
    const result: SiteCsvParseResult = parseSiteCsv(
      `${HEADER}\nAcme,Brand,,,,\nAcme Downtown,store,Acme,,,\nOld,Unit,,,,\n`,
      customTypes,
    );
    expect(
      result.rows.map((row: ParsedSiteRow) => {
        return [row.name, row.siteType, row.networkSiteTypeId];
      }),
    ).toEqual([
      ["Acme", "Brand", "brand-1"],
      ["Acme Downtown", "Store", "store-1"],
    ]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.message).toContain('Unknown siteType "Unit"');
    // The list names the project's own types, not the seeded defaults.
    expect(result.errors[0]!.message).toContain("Valid values: Brand, Store.");
  });

  test("a project with no configured types cannot import at all", () => {
    const result: SiteCsvParseResult = parseSiteCsv(
      `${HEADER}\nA,Unit,,,,\n`,
      [],
    );
    expect(result.rows).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.line).toBe(0);
    expect(result.errors[0]!.message).toContain("no site types configured");
  });

  test("accepts the complete default hierarchy even when children precede parents", () => {
    const result: SiteCsvParseResult = parseSiteCsv(
      [
        HEADER,
        "Unit 1042,Unit,Springfield Market,,39.7817,-89.6501",
        "Springfield Market,Market,Franchise East,,,",
        "Franchise East,Franchisee,East Region,,,",
        "East Region,Region,Acme Account,,,",
        "Acme Account,Account Type,,,,",
      ].join("\n"),
      HIERARCHICAL_DEFAULT_SITE_TYPES,
    );

    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(5);
    expect(result.rows[0]).toMatchObject({
      siteType: DefaultNetworkSiteType.Unit,
      requiredParentNetworkSiteTypeId: siteTypeIdOf(
        DefaultNetworkSiteType.Market,
      ),
    });
  });

  test("rejects a child type without parentName and names its required parent type", () => {
    const result: SiteCsvParseResult = parseSiteCsv(
      `${HEADER}\nEast Region,Region,,,,\n`,
      HIERARCHICAL_DEFAULT_SITE_TYPES,
    );

    expect(result.rows).toEqual([]);
    expect(result.errors).toEqual([
      {
        line: 2,
        message:
          'siteType "Region" requires a parentName whose siteType is "Account Type".',
      },
    ]);
  });

  test("rejects a top-level type that supplies parentName", () => {
    const result: SiteCsvParseResult = parseSiteCsv(
      `${HEADER}\nHQ,Data Center,Somewhere,,,\n`,
      HIERARCHICAL_DEFAULT_SITE_TYPES,
    );

    expect(result.rows).toEqual([]);
    expect(result.errors).toEqual([
      {
        line: 2,
        message:
          'siteType "Data Center" is top level and cannot have a parentName.',
      },
    ]);
  });

  test("rejects an imported parent whose type is not the configured direct parent", () => {
    const result: SiteCsvParseResult = parseSiteCsv(
      [
        HEADER,
        "Acme Account,Account Type,,,,",
        "East Region,Region,Acme Account,,,",
        // Market requires Franchisee, not Region.
        "Springfield Market,Market,East Region,,,",
      ].join("\n"),
      HIERARCHICAL_DEFAULT_SITE_TYPES,
    );

    expect(
      result.rows.map((row: ParsedSiteRow) => {
        return row.name;
      }),
    ).toEqual(["Acme Account", "East Region"]);
    expect(result.errors).toEqual([
      {
        line: 4,
        message:
          'Parent site "East Region" uses Region, but siteType "Market" requires a parent that uses Franchisee.',
      },
    ]);
  });

  test("uses configured ids rather than default names for custom hierarchies", () => {
    const customTypes: Array<NetworkSiteTypeOption> = [
      { id: "brand-id", name: "Brand", parentNetworkSiteTypeId: null },
      {
        id: "store-id",
        name: "Store",
        parentNetworkSiteTypeId: "brand-id",
      },
    ];
    const result: SiteCsvParseResult = parseSiteCsv(
      `${HEADER}\nAcme,Brand,,,,\nDowntown,Store,Acme,,,\n`,
      customTypes,
    );

    expect(result.errors).toEqual([]);
    expect(result.rows[1]).toMatchObject({
      networkSiteTypeId: "store-id",
      requiredParentNetworkSiteTypeId: "brand-id",
    });
  });

  test("non-numeric latitude is a row error", () => {
    const result: SiteCsvParseResult = parseSiteCsv(
      `${HEADER}\nA,Unit,,,abc,-89.65\n`,
      DEFAULT_SITE_TYPES,
    );
    expect(result.rows).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.message).toContain('latitude "abc"');
  });

  test("out-of-range coordinates are row errors", () => {
    const result: SiteCsvParseResult = parseSiteCsv(
      `${HEADER}\nA,Unit,,,91,0\nB,Unit,,,0,-181\n`,
      DEFAULT_SITE_TYPES,
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
      DEFAULT_SITE_TYPES,
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
      DEFAULT_SITE_TYPES,
    );
    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(3);
    expect(result.rows[2]!.latitude).toBe(0);
    expect(result.rows[2]!.longitude).toBe(0);
  });

  test("duplicate names within the file flag the later row", () => {
    const result: SiteCsvParseResult = parseSiteCsv(
      `${HEADER}\nA,Unit,,,,\nB,Unit,,,,\nA,Market,,,,\n`,
      DEFAULT_SITE_TYPES,
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
    const result: SiteCsvParseResult = parseSiteCsv(
      `${HEADER}\nA,Unit,A,,,\n`,
      DEFAULT_SITE_TYPES,
    );
    expect(result.rows).toEqual([]);
    expect(result.errors).toEqual([
      { line: 2, message: "A site cannot be its own parent." },
    ]);
  });

  test("a bad row does not poison surrounding good rows", () => {
    const result: SiteCsvParseResult = parseSiteCsv(
      `${HEADER}\nA,Unit,,,,\n,Unit,,,,\nB,Unit,,,,\n`,
      DEFAULT_SITE_TYPES,
    );
    expect(
      result.rows.map((row: ParsedSiteRow) => {
        return row.name;
      }),
    ).toEqual(["A", "B"]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.line).toBe(3);
  });

  test("cells are trimmed; quoted cells keep interior spacing", () => {
    const result: SiteCsvParseResult = parseSiteCsv(
      `${HEADER}\n  A  , Unit ,,"  spaced address  ",,\n`,
      DEFAULT_SITE_TYPES,
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

  test("accepts an existing parent with the configured parent type", () => {
    const child: ParsedSiteRow = makeRow({
      name: "Unit 1042",
      parentName: "Springfield Market",
      requiredParentNetworkSiteTypeId: "type-market",
    });
    const plan: SiteImportPlan = planSiteImport(
      [child],
      ["Springfield Market"],
      new Map<string, string | null>([["Springfield Market", "type-market"]]),
    );

    expect(plan.batches).toEqual([[child]]);
    expect(plan.skipped).toEqual([]);
  });

  test("rejects an existing parent with the wrong type before planning creates", () => {
    const child: ParsedSiteRow = makeRow({
      name: "Unit 1042",
      parentName: "East Region",
      requiredParentNetworkSiteTypeId: "type-market",
    });
    const plan: SiteImportPlan = planSiteImport(
      [child],
      ["East Region"],
      new Map<string, string | null>([["East Region", "type-region"]]),
    );

    expect(plan.batches).toEqual([]);
    expect(plan.skipped).toEqual([
      {
        row: child,
        reason:
          'Parent site "East Region" does not use the Network Site Type required by "Unit".',
      },
    ]);
  });

  test("rejects an untyped existing parent", () => {
    const child: ParsedSiteRow = makeRow({
      name: "Unit 1042",
      parentName: "Legacy Market",
      requiredParentNetworkSiteTypeId: "type-market",
    });
    const plan: SiteImportPlan = planSiteImport(
      [child],
      ["Legacy Market"],
      new Map<string, string | null>([["Legacy Market", null]]),
    );

    expect(plan.batches).toEqual([]);
    expect(plan.skipped[0]!.reason).toContain(
      "does not use the Network Site Type required",
    );
  });

  test("rejects an incompatible imported parent defensively without the parser", () => {
    const parent: ParsedSiteRow = makeRow({
      name: "East Region",
      networkSiteTypeId: "type-region",
    });
    const child: ParsedSiteRow = makeRow({
      name: "Springfield Market",
      parentName: "East Region",
      requiredParentNetworkSiteTypeId: "type-franchisee",
    });
    const plan: SiteImportPlan = planSiteImport([parent, child], []);

    expect(plan.batches).toEqual([[parent]]);
    expect(plan.skipped).toHaveLength(1);
    expect(plan.skipped[0]!.row).toBe(child);
  });
});
