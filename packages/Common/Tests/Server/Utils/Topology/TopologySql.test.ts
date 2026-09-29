import {
  CONTAINER_SPECIFICITY_RANKS,
  NESTABLE_CHILD_TYPE_LIST,
  NESTING_RELATIONSHIP_RANKS,
  PLACEMENT_RELATIONSHIP_TYPE_LIST,
  SERVICE_MAP_ATTRIBUTE_KEY_LIST,
  TopologySqlStatement,
  TopologyWinnerScope,
  activeSql,
  collectionPageStatement,
  collectionSearchStatement,
  duplicateKeysStatement,
  entitySectionsStatement,
  entityStatement,
  epochMsSql,
  escapeLikeTerm,
  infrastructureNodesStatement,
  infrastructureTypeCountsStatement,
  itemsByKeysStatement,
  placementsStatement,
  projectTypesStatement,
  serviceMapDependenciesStatement,
  serviceMapEntitiesStatement,
  servicesStatement,
} from "../../../../Server/Utils/Topology/TopologySql";
import EntityRelationshipType from "../../../../Types/Telemetry/EntityRelationshipType";
import EntityType from "../../../../Types/Telemetry/EntityType";
import {
  CONTAINER_SPECIFICITY,
  NESTABLE_CHILD_TYPES,
  NESTING_RELATIONSHIP_PRIORITY,
  PLACEMENT_RELATIONSHIP_TYPES,
  SERVICE_MAP_DETAIL_ATTRIBUTE_KEYS,
} from "../../../../Types/Topology/TopologyTypeRules";
import { describe, expect, test } from "@jest/globals";

/*
 * The Topology API's statements, checked as text and parameters without a
 * database (TopologyQueriesPostgres runs them for real). What is pinned here
 * is what a reviewer would otherwise have to re-derive from every string:
 *
 *   - the project is always bound, as $1, and never spliced into the text;
 *   - every table reference is scoped to live rows (deletedAt, and for items
 *     isArchived) — including the aliases inside sub-selects — and every
 *     relationship reference to the range, except in the all-time reads;
 *   - nothing a request supplies reaches the text, however hostile;
 *   - every parameter is referenced (Postgres rejects an unreferenced one
 *     with "could not determine data type of parameter") and every
 *     placeholder has a value;
 *   - the activity predicate is exactly the Dashboard's isEntityActive;
 *   - the nesting ranks are bound from TopologyTypeRules, never copied.
 */

const PROJECT_ID: string = "5f8b9c0d-e1a2-4b3c-8d5e-6f7a8b9c0d1e";
const RANGE_START: string = "2026-09-20T10:00:00.000Z";

/* Request-supplied values that would break the statement if interpolated. */
const HOSTILE: string = `x'); DROP TABLE "InventoryItem"; -- $1 "quoted"`;

const NO_DUPLICATES: TopologyWinnerScope = {
  projectTypes: [EntityType.Service, EntityType.KubernetesPod],
  duplicateKeys: [],
};

const WITH_DUPLICATES: TopologyWinnerScope = {
  projectTypes: [EntityType.Service, EntityType.KubernetesPod],
  duplicateKeys: ["twin"],
};

function normalize(sql: string): string {
  return sql.replace(/\s+/g, " ").trim();
}

function placeholders(sql: string): Array<number> {
  const found: Set<number> = new Set<number>();
  for (const match of sql.matchAll(/\$(\d+)/g)) {
    found.add(Number(match[1]));
  }
  return Array.from(found).sort((left: number, right: number): number => {
    return left - right;
  });
}

/* The tables every statement here reads, and what scopes each reference. */
const TABLE_PATTERN: RegExp = /"(InventoryItem|InventoryItemRelationship)"/g;
const REFERENCE_PATTERN: RegExp =
  /"(InventoryItem|InventoryItemRelationship)" ([a-z_]+)/g;

interface TableReference {
  table: string;
  alias: string;
  at: number;
}

/* Every `"Table" alias` in the text, where it is. */
function referencesOf(sql: string): Array<TableReference> {
  const references: Array<TableReference> = [];
  for (const match of sql.matchAll(REFERENCE_PATTERN)) {
    references.push({
      table: match[1] as string,
      alias: match[2] as string,
      at: match.index as number,
    });
  }
  return references;
}

/* Parenthesized groups as [open, close] offsets; string literals skipped. */
function groupsOf(sql: string): Array<[number, number]> {
  const groups: Array<[number, number]> = [];
  const open: Array<number> = [];
  let inLiteral: boolean = false;
  for (let index: number = 0; index < sql.length; index++) {
    const character: string = sql[index] as string;
    if (character === "'") {
      inLiteral = !inLiteral;
    } else if (!inLiteral && character === "(") {
      open.push(index);
    } else if (!inLiteral && character === ")") {
      const start: number | undefined = open.pop();
      if (start === undefined) {
        throw new Error(`unbalanced ")" at ${index}`);
      }
      groups.push([start, index]);
    }
  }
  if (open.length > 0 || inLiteral) {
    throw new Error("unbalanced statement text");
  }
  return groups;
}

/*
 * The text a table reference's own predicates must be in: the innermost
 * parenthesized group around it (its sub-select or CTE body; the whole
 * statement at the top level), minus every group nested in it that reads a
 * table itself — so a predicate on another reading of the same table, or on
 * a sub-select's own alias, can never stand in for this one's.
 */
function ownScopeOf(
  sql: string,
  groups: Array<[number, number]>,
  references: Array<TableReference>,
  reference: TableReference,
): { key: string; text: string } {
  let scope: [number, number] = [-1, sql.length];
  for (const group of groups) {
    if (
      group[0] < reference.at &&
      reference.at < group[1] &&
      group[0] > scope[0]
    ) {
      scope = group;
    }
  }
  const nestedReaders: Array<[number, number]> = groups
    .filter((group: [number, number]): boolean => {
      return (
        group[0] > scope[0] &&
        group[1] < scope[1] &&
        references.some((other: TableReference): boolean => {
          return group[0] < other.at && other.at < group[1];
        })
      );
    })
    .sort((left: [number, number], right: [number, number]): number => {
      return left[0] - right[0];
    });
  let text: string = "";
  let cursor: number = scope[0] + 1;
  for (const group of nestedReaders) {
    if (group[0] < cursor) {
      /* Inside a group already cut out. */
      continue;
    }
    text += `${sql.slice(cursor, group[0])} (...) `;
    cursor = group[1] + 1;
  }
  text += sql.slice(cursor, scope[1]);
  return { key: `${scope[0]}:${scope[1]}`, text };
}

function countOf(text: string, pattern: string): number {
  return Array.from(text.matchAll(new RegExp(pattern, "g"))).length;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/*
 * The live-row predicates every reading of a table needs, as patterns on its
 * alias (not preceded by another identifier character, so `i` never matches
 * inside `dup`).
 */
interface WellFormedOptions {
  itemsMayIncludeArchived?: boolean;
  /* The all-time reads: relationships however long ago they were seen. */
  relationshipsAllTime?: boolean;
}

function requiredPredicates(
  reference: TableReference,
  options: WellFormedOptions,
): Array<string> {
  const alias: string = `(?<![A-Za-z0-9_"])${escapeRegExp(reference.alias)}`;
  const predicates: Array<string> = [
    `${alias}\\."projectId" = \\$1(?!\\d)`,
    `${alias}\\."deletedAt" IS NULL`,
  ];
  if (reference.table === "InventoryItemRelationship") {
    if (!options.relationshipsAllTime) {
      predicates.push(`${alias}\\."lastSeenAt" >= \\$\\d+`);
    }
  } else if (!options.itemsMayIncludeArchived) {
    predicates.push(`${alias}\\."isArchived" = false`);
  }
  return predicates;
}

function expectWellFormed(
  statement: TopologySqlStatement,
  options: WellFormedOptions = {},
): void {
  const sql: string = normalize(statement.sql);

  // Placeholders are exactly $1..$n, each with a value.
  const used: Array<number> = placeholders(sql);
  expect(used).toEqual(
    statement.params.map((_value: unknown, index: number): number => {
      return index + 1;
    }),
  );

  // The project is the first parameter and appears nowhere in the text.
  expect(statement.params[0]).toBe(PROJECT_ID);
  expect(sql).not.toContain(PROJECT_ID);

  /*
   * Every reading of a table is scoped by predicates of its OWN: counted per
   * reference, inside the sub-select or CTE that reads it. Two readings of
   * one table under one alias (the drawer's outbound and inbound scans) each
   * need their own set; one set elsewhere in the statement proves nothing.
   */
  const references: Array<TableReference> = referencesOf(sql);
  expect(references.length).toBeGreaterThan(0);
  // Every table is read through an alias the checks below can follow.
  expect(Array.from(sql.matchAll(TABLE_PATTERN)).length).toBe(
    references.length,
  );
  const groups: Array<[number, number]> = groupsOf(sql);
  const needed: Map<string, { text: string; count: number }> = new Map<
    string,
    { text: string; count: number }
  >();
  for (const reference of references) {
    const scope: { key: string; text: string } = ownScopeOf(
      sql,
      groups,
      references,
      reference,
    );
    for (const predicate of requiredPredicates(reference, options)) {
      const key: string = `${scope.key}|${predicate}`;
      const entry: { text: string; count: number } = needed.get(key) || {
        text: scope.text,
        count: 0,
      };
      entry.count++;
      needed.set(key, entry);
    }
  }
  for (const [key, entry] of needed) {
    const predicate: string = key.slice(key.indexOf("|") + 1);
    expect({
      predicate,
      scope: entry.text,
      found: countOf(entry.text, predicate) >= entry.count,
    }).toEqual({ predicate, scope: entry.text, found: true });
  }

  // Nothing request-supplied is spliced into the text.
  expect(sql).not.toContain("DROP TABLE");
  expect(sql).not.toContain(RANGE_START);
}

describe("TopologySql fragments", () => {
  test("the activity predicate is the Dashboard's isEntityActive, exactly", () => {
    expect(activeSql("i", "$2")).toBe(
      `CASE WHEN i."source" IS NOT NULL AND i."source" <> '' AND i."source" <> 'discovered' THEN TRUE ` +
        `WHEN i."lastSeenAt" IS NULL THEN TRUE ELSE i."lastSeenAt" >= $2 END`,
    );
  });

  test("timestamps leave the database as floored epoch milliseconds", () => {
    expect(epochMsSql(`i."lastSeenAt"`)).toBe(
      `floor(extract(epoch from i."lastSeenAt") * 1000)::float8`,
    );
  });

  test.each([
    ["plain", "plain"],
    ["100%", "100\\%"],
    ["a_b", "a\\_b"],
    ["back\\slash", "back\\\\slash"],
    ["%_\\", "\\%\\_\\\\"],
    ["", ""],
  ])("escapeLikeTerm(%j) = %j", (term: string, escaped: string) => {
    expect(escapeLikeTerm(term)).toBe(escaped);
  });

  test("the nesting ranks are bound from TopologyTypeRules", () => {
    const priorities: Record<string, number> = {};
    NESTING_RELATIONSHIP_RANKS.keys.forEach(
      (key: string, index: number): void => {
        priorities[key] = NESTING_RELATIONSHIP_RANKS.ranks[index] as number;
      },
    );
    expect(priorities).toEqual(NESTING_RELATIONSHIP_PRIORITY);

    const specificities: Record<string, number> = {};
    CONTAINER_SPECIFICITY_RANKS.keys.forEach(
      (key: string, index: number): void => {
        specificities[key] = CONTAINER_SPECIFICITY_RANKS.ranks[index] as number;
      },
    );
    expect(specificities).toEqual(CONTAINER_SPECIFICITY);

    expect(new Set<string>(NESTABLE_CHILD_TYPE_LIST)).toEqual(
      new Set<string>(NESTABLE_CHILD_TYPES),
    );
    expect(new Set<string>(PLACEMENT_RELATIONSHIP_TYPE_LIST)).toEqual(
      new Set<string>(PLACEMENT_RELATIONSHIP_TYPES),
    );
    expect(SERVICE_MAP_ATTRIBUTE_KEY_LIST).toEqual([
      ...SERVICE_MAP_DETAIL_ATTRIBUTE_KEYS,
    ]);
  });
});

describe("TopologySql statements", () => {
  test("project types: a loose index scan over live rows", () => {
    const statement: TopologySqlStatement = projectTypesStatement({
      projectId: PROJECT_ID,
    });
    /*
     * Archived rows are deliberately not excluded: this list only widens
     * `"entityType" = ANY(...)` so the unique index is usable, and checking
     * isArchived would cost a heap visit per type.
     */
    expectWellFormed(statement, { itemsMayIncludeArchived: true });
    expect(statement.sql).toContain("WITH RECURSIVE");
    expect(statement.params).toEqual([PROJECT_ID]);
  });

  test("duplicate keys: live rows grouped by key", () => {
    const statement: TopologySqlStatement = duplicateKeysStatement({
      projectId: PROJECT_ID,
    });
    expectWellFormed(statement);
    expect(normalize(statement.sql)).toContain(
      `GROUP BY i."entityKey" HAVING COUNT(*) > 1`,
    );
  });

  describe("the winner rule", () => {
    test("adds nothing when no key is duplicated", () => {
      const statement: TopologySqlStatement = servicesStatement({
        projectId: PROJECT_ID,
        winner: NO_DUPLICATES,
      });
      expectWellFormed(statement);
      expect(statement.sql).not.toContain("NOT EXISTS");
      // The project types are only bound when something uses them.
      expect(statement.params).toEqual([PROJECT_ID, EntityType.Service]);
    });

    test("resolves only the duplicated keys, by createdAt ASC then _id DESC", () => {
      const statement: TopologySqlStatement = servicesStatement({
        projectId: PROJECT_ID,
        winner: WITH_DUPLICATES,
      });
      expectWellFormed(statement);
      const sql: string = normalize(statement.sql);
      expect(sql).toContain(`(NOT (i."entityKey" = ANY($`);
      expect(sql).toContain(`OR NOT EXISTS (SELECT 1 FROM "InventoryItem" dup`);
      expect(sql).toContain(
        `AND (dup."createdAt" < i."createdAt" OR (dup."createdAt" = i."createdAt" AND dup."_id" > i."_id"))`,
      );
      expect(statement.params).toContainEqual(["twin"]);
      expect(statement.params).toContainEqual(WITH_DUPLICATES.projectTypes);
    });
  });

  test.each([
    ["services", undefined],
    ["callees", [HOSTILE, "db-1"]],
  ])(
    "service map entities (%s)",
    (_label: string, keys: Array<string> | undefined) => {
      for (const winner of [NO_DUPLICATES, WITH_DUPLICATES]) {
        for (const mode of ["rows", "count"] as const) {
          const statement: TopologySqlStatement = serviceMapEntitiesStatement({
            projectId: PROJECT_ID,
            winner,
            keys,
            mode,
            limit: 51,
          });
          expectWellFormed(statement);
          const sql: string = normalize(statement.sql);
          if (keys) {
            expect(statement.params).toContainEqual(keys);
            expect(sql).toContain(`i."entityType" <> $`);
            expect(sql).toContain(`i."entityType" = ANY($`);
          }
          if (mode === "rows") {
            expect(sql).toContain(`ORDER BY i."entityKey" COLLATE "C" ASC`);
            expect(statement.params[statement.params.length - 1]).toBe(51);
            expect(statement.params).toContainEqual(
              SERVICE_MAP_ATTRIBUTE_KEY_LIST,
            );
            expect(sql).toContain(
              `WHERE jsonb_typeof(i."descriptiveAttributes" -> k.key) = 'string'`,
            );
            expect(sql).toContain(
              `WHERE jsonb_typeof(i."identifyingAttributes" -> k.key) = 'string'`,
            );
          } else {
            expect(sql).toContain(`SELECT COUNT(*)::int AS "total"`);
          }
        }
      }
    },
  );

  test("service map dependencies: depends-on from the services, old list order", () => {
    for (const mode of ["rows", "count"] as const) {
      const statement: TopologySqlStatement = serviceMapDependenciesStatement({
        projectId: PROJECT_ID,
        rangeStart: RANGE_START,
        serviceKeys: [HOSTILE],
        mode,
        limit: 10,
      });
      expectWellFormed(statement);
      const sql: string = normalize(statement.sql);
      expect(statement.params[1]).toBe(RANGE_START);
      expect(statement.params).toContain(EntityRelationshipType.DependsOn);
      expect(statement.params).toContainEqual([HOSTILE]);
      expect(sql).toContain(`r."fromEntityKey" <> r."toEntityKey"`);
      if (mode === "rows") {
        expect(sql).toContain(`ORDER BY r."createdAt" DESC, r."_id" ASC`);
      }
      /* The Service Map reads every callee: no callee filter. */
      expect(sql).not.toContain(`r."toEntityKey" = ANY(`);
    }
  });

  test("infrastructure dependencies: only calls into the given callees, bound as an array", () => {
    for (const mode of ["rows", "count"] as const) {
      const statement: TopologySqlStatement = serviceMapDependenciesStatement({
        projectId: PROJECT_ID,
        rangeStart: RANGE_START,
        serviceKeys: ["svc-a", HOSTILE],
        calleeKeys: ["svc-b", HOSTILE],
        mode,
        limit: 10,
      });
      expectWellFormed(statement);
      const sql: string = normalize(statement.sql);
      expect(statement.params).toContainEqual(["svc-a", HOSTILE]);
      expect(statement.params).toContainEqual(["svc-b", HOSTILE]);
      const callees: string = `$${
        statement.params.findIndex((param: unknown): boolean => {
          return (
            Array.isArray(param) && (param as Array<string>)[0] === "svc-b"
          );
        }) + 1
      }`;
      expect(sql).toContain(`r."toEntityKey" = ANY(${callees}::text[])`);
      expect(sql).toContain(`r."fromEntityKey" <> r."toEntityKey"`);
      expect(sql).toContain(
        `r."relationshipType" = $3 AND r."fromEntityKey" <> r."toEntityKey"`,
      );
      if (mode === "count") {
        expect(sql).toContain(`SELECT COUNT(*)::int AS "total"`);
      } else {
        expect(sql).toContain(`ORDER BY r."createdAt" DESC, r."_id" ASC`);
      }
    }
  });

  test("placements: distinct service to target over runs-on / hosted-on", () => {
    const statement: TopologySqlStatement = placementsStatement({
      projectId: PROJECT_ID,
      rangeStart: RANGE_START,
      serviceKeys: ["svc-a"],
    });
    expectWellFormed(statement);
    expect(normalize(statement.sql)).toContain(
      `SELECT DISTINCT r."fromEntityKey" AS "service", r."toEntityKey" AS "target"`,
    );
    expect(statement.params).toContainEqual(PLACEMENT_RELATIONSHIP_TYPE_LIST);
  });

  test("items by keys: the keys as an array, with activity", () => {
    for (const winner of [NO_DUPLICATES, WITH_DUPLICATES]) {
      const statement: TopologySqlStatement = itemsByKeysStatement({
        projectId: PROJECT_ID,
        rangeStart: RANGE_START,
        winner,
        keys: [HOSTILE],
      });
      expectWellFormed(statement);
      const sql: string = normalize(statement.sql);
      expect(sql).toContain(activeSql("i", "$2"));
      expect(sql).toContain(`i."entityKey" = ANY($`);
      expect(sql).toContain(`i."entityType" = ANY($3::text[])`);
    }
  });

  test("infrastructure type counts: one pass, exact counts per type", () => {
    const statement: TopologySqlStatement = infrastructureTypeCountsStatement({
      projectId: PROJECT_ID,
      rangeStart: RANGE_START,
      infrastructureTypes: [EntityType.Host, EntityType.NetworkDevice],
    });
    expectWellFormed(statement);
    const sql: string = normalize(statement.sql);
    expect(sql).toContain(
      `COUNT(*) FILTER (WHERE ${activeSql("i", "$2")})::int`,
    );
    expect(sql).toContain(`GROUP BY i."entityType"`);
  });

  describe("infrastructure nodes", () => {
    const rows: TopologySqlStatement = infrastructureNodesStatement({
      projectId: PROJECT_ID,
      rangeStart: RANGE_START,
      winner: WITH_DUPLICATES,
      nodeTypes: [EntityType.KubernetesPod, EntityType.KubernetesNode],
      mode: "rows",
      limit: 200_001,
    });
    const sql: string = normalize(rows.sql);

    test("is well formed in both modes", () => {
      expectWellFormed(rows);
      expectWellFormed(
        infrastructureNodesStatement({
          projectId: PROJECT_ID,
          rangeStart: RANGE_START,
          winner: NO_DUPLICATES,
          nodeTypes: [EntityType.Host],
          mode: "count",
          limit: 0,
        }),
      );
    });

    test("binds the ranking tables and the nestable types", () => {
      expect(rows.params).toContainEqual(NESTING_RELATIONSHIP_RANKS.keys);
      expect(rows.params).toContainEqual(NESTING_RELATIONSHIP_RANKS.ranks);
      expect(rows.params).toContainEqual(CONTAINER_SPECIFICITY_RANKS.keys);
      expect(rows.params).toContainEqual(CONTAINER_SPECIFICITY_RANKS.ranks);
      expect(rows.params).toContainEqual(NESTABLE_CHILD_TYPE_LIST);
      // No rank is written into the text.
      expect(sql).not.toMatch(/THEN [0-9]/);
    });

    test("ranks priority, then specificity, then the parent key in code-point order", () => {
      expect(sql).toContain(
        `ORDER BY c."child" COLLATE "C", c."priority" DESC, c."specificity" DESC, c."parent" COLLATE "C" ASC`,
      );
      expect(sql).toContain(`DISTINCT ON (c."child" COLLATE "C")`);
      expect(sql).toContain(`FROM candidates c WHERE c."parentActive"`);
      expect(sql).toContain(`r."fromEntityKey" <> r."toEntityKey"`);
    });

    test("orders nodes by type then key in code-point order", () => {
      expect(sql).toContain(
        `ORDER BY n."type" COLLATE "C" ASC, n."key" COLLATE "C" ASC`,
      );
      expect(rows.params[rows.params.length - 1]).toBe(200_001);
    });
  });

  describe("collections", () => {
    test("a page: keyset on (name, key), filters and search terms bound", () => {
      const statement: TopologySqlStatement = collectionPageStatement({
        projectId: PROJECT_ID,
        rangeStart: RANGE_START,
        entityType: EntityType.NetworkDevice,
        includeInactive: false,
        nameTerms: ["core", HOSTILE, "100%"],
        cursor: { name: HOSTILE, key: "k-1" },
        mode: "rows",
        limit: 51,
      });
      expectWellFormed(statement);
      const sql: string = normalize(statement.sql);
      // The range start is bound after the type, only because it is needed.
      expect(sql).toContain(`(${activeSql("i", "$3")})`);
      expect(statement.params.slice(0, 3)).toEqual([
        PROJECT_ID,
        EntityType.NetworkDevice,
        RANGE_START,
      ]);
      expect(sql).toContain(
        `ORDER BY COALESCE(i."displayName", '') ASC, i."entityKey" COLLATE "C" ASC`,
      );
      expect(sql).toMatch(
        /\(COALESCE\(i\."displayName", ''\) > \$\d+ OR \(COALESCE\(i\."displayName", ''\) = \$\d+ AND i\."entityKey" COLLATE "C" > \$\d+\)\)/,
      );
      expect(
        sql.match(
          /i\."displayName" ILIKE '%' \|\| \$\d+ \|\| '%' ESCAPE '\\'/g,
        ),
      ).toHaveLength(3);
      expect(statement.params).toContain("100\\%");
      expect(statement.params).toContain(escapeLikeTerm(HOSTILE));
      expect(statement.params).toContain(HOSTILE);
    });

    test("with inactive items included the range start is not bound", () => {
      const statement: TopologySqlStatement = collectionPageStatement({
        projectId: PROJECT_ID,
        rangeStart: RANGE_START,
        entityType: EntityType.NetworkDevice,
        includeInactive: true,
        nameTerms: [],
        cursor: null,
        mode: "count",
        limit: 0,
      });
      expectWellFormed(statement);
      expect(statement.params).toEqual([PROJECT_ID, EntityType.NetworkDevice]);
    });

    test("search: one count per type, each with its own terms", () => {
      const statement: TopologySqlStatement = collectionSearchStatement({
        projectId: PROJECT_ID,
        rangeStart: RANGE_START,
        includeInactive: false,
        types: [
          { entityType: EntityType.NetworkDevice, nameTerms: ["core"] },
          { entityType: EntityType.IoTDevice, nameTerms: [] },
        ],
      });
      expectWellFormed(statement);
      const sql: string = normalize(statement.sql);
      expect(sql.split(" UNION ALL ")).toHaveLength(2);
      // One range start, shared by every branch.
      expect(
        statement.params.filter((value: unknown): boolean => {
          return value === RANGE_START;
        }),
      ).toHaveLength(1);
    });
  });

  describe("the drawer", () => {
    test("the entity: by key, a known type preferred, then the winner order", () => {
      const statement: TopologySqlStatement = entityStatement({
        projectId: PROJECT_ID,
        projectTypes: [EntityType.Service],
        entityKey: HOSTILE,
        entityType: null,
      });
      expectWellFormed(statement);
      const sql: string = normalize(statement.sql);
      expect(sql).toContain(
        `ORDER BY (i."entityType" = $4::text) DESC NULLS LAST, i."createdAt" ASC, i."_id" DESC LIMIT 1`,
      );
      expect(statement.params).toEqual([
        PROJECT_ID,
        [EntityType.Service],
        HOSTILE,
        null,
      ]);
    });

    const sectionsFor: (
      window: Parameters<typeof entitySectionsStatement>[0]["window"],
    ) => TopologySqlStatement = (
      window: Parameters<typeof entitySectionsStatement>[0]["window"],
    ): TopologySqlStatement => {
      return entitySectionsStatement({
        projectId: PROJECT_ID,
        scope: { kind: "range", rangeStart: RANGE_START },
        projectTypes: [EntityType.Service],
        entityKey: HOSTILE,
        isService: true,
        scanLimit: 100_001,
        window,
      });
    };

    test("sections: scan outbound then inbound, self-loops once, unknown ends kept", () => {
      const statement: TopologySqlStatement = sectionsFor({
        kind: "top",
        dependencyRows: 100,
        otherRows: 25,
      });
      expectWellFormed(statement);
      const sql: string = normalize(statement.sql);
      expect(sql).toContain(`r."fromEntityKey" = $4`);
      expect(sql).toContain(`r."toEntityKey" = $4 AND r."fromEntityKey" <> $4`);
      expect(sql).toContain(
        `LIMIT GREATEST(0, $5::int - (SELECT COUNT(*)::int FROM scan_out))`,
      );
      expect(sql).toContain(`FROM scan s LEFT JOIN others o`);
      expect(sql).toContain(`'Unnamed resource'`);
      expect(sql).toContain(`'Undiscovered resource'`);
      expect(statement.params).toContain(100_001);
      expect(statement.params).toContain(true);
      expect(statement.params).toContain(100);
      expect(statement.params).toContain(25);
    });

    test("sections: calls by traffic, the rest known-first, then label and key", () => {
      const sql: string = normalize(
        sectionsFor({ kind: "top", dependencyRows: 100, otherRows: 25 }).sql,
      );
      expect(sql).toContain(
        `CASE WHEN c."section" IN ('calls', 'calledBy') THEN c."callCount" END DESC NULLS LAST, ` +
          `CASE WHEN c."section" IN ('runsOn', 'related') THEN c."otherKnown" END DESC NULLS LAST, ` +
          `c."label" ASC, c."otherKey" COLLATE "C" ASC`,
      );
    });

    test("the entity all time: archived rows too, a live row before an archived one", () => {
      const statement: TopologySqlStatement = entityStatement({
        projectId: PROJECT_ID,
        projectTypes: [EntityType.Service],
        entityKey: HOSTILE,
        entityType: EntityType.Service,
        includeArchived: true,
      });
      expectWellFormed(statement, { itemsMayIncludeArchived: true });
      const sql: string = normalize(statement.sql);
      expect(sql).not.toContain(`"isArchived" = false`);
      expect(sql).toContain(
        `ORDER BY (i."entityType" = $4::text) DESC NULLS LAST, i."isArchived" ASC, i."createdAt" ASC, i."_id" DESC LIMIT 1`,
      );
      expect(statement.params).toEqual([
        PROJECT_ID,
        [EntityType.Service],
        HOSTILE,
        EntityType.Service,
      ]);
    });

    test("sections all time: every stored relationship, archived other ends with their ids", () => {
      const statement: TopologySqlStatement = entitySectionsStatement({
        projectId: PROJECT_ID,
        scope: { kind: "allTime" },
        projectTypes: [EntityType.Service],
        entityKey: HOSTILE,
        isService: true,
        scanLimit: 100_001,
        window: { kind: "top", dependencyRows: 100, otherRows: 25 },
      });
      expectWellFormed(statement, {
        itemsMayIncludeArchived: true,
        relationshipsAllTime: true,
      });
      const sql: string = normalize(statement.sql);
      // No range: nothing about lastSeenAt but the newest-first scan order.
      expect(sql).not.toMatch(/"lastSeenAt" >=/);
      expect(sql).not.toContain(`"isArchived" = false`);
      expect(sql).toContain(
        `WHERE r."projectId" = $1 AND r."deletedAt" IS NULL AND r."fromEntityKey" = $3 ORDER BY r."lastSeenAt" DESC, r."_id" ASC`,
      );
      expect(sql).toContain(
        `WHERE r."projectId" = $1 AND r."deletedAt" IS NULL AND r."toEntityKey" = $3 AND r."fromEntityKey" <> $3`,
      );
      // The other end: its id, a live row winning a key an archived one shares.
      expect(sql).toContain(`i."_id"::text AS "id"`);
      expect(sql).toContain(
        `ORDER BY i."entityKey", i."isArchived" ASC, i."createdAt" ASC, i."_id" DESC`,
      );
      expect(sql).toContain(`o."id" AS "otherId"`);
      expect(sql).toContain(`'otherId', r."otherId"`);
      expect(statement.params).not.toContain(RANGE_START);
      expect(statement.params.slice(0, 4)).toEqual([
        PROJECT_ID,
        [EntityType.Service],
        HOSTILE,
        100_001,
      ]);
    });

    test("sections in a range stay as they were: live other ends, no ids", () => {
      const sql: string = normalize(
        sectionsFor({ kind: "top", dependencyRows: 100, otherRows: 25 }).sql,
      );
      expect(sql).not.toContain("otherId");
      expect(sql).not.toContain(`i."_id"::text`);
      expect(sql).not.toContain(`"isArchived" ASC`);
      expect(sql).toContain(
        `ORDER BY i."entityKey", i."createdAt" ASC, i."_id" DESC`,
      );
    });

    test("a page of one section is bound, not spliced", () => {
      const statement: TopologySqlStatement = sectionsFor({
        kind: "page",
        section: "related",
        offset: 25,
        limit: 50,
      });
      expectWellFormed(statement);
      expect(statement.params.slice(-3)).toEqual([25, "related", 50]);
      expect(normalize(statement.sql)).toMatch(
        /r\."section" = \$\d+::text AND r\."rank" > \$\d+::int AND r\."rank" <= \$\d+::int \+ \$\d+::int/,
      );
    });
  });
});

/*
 * The check above is only worth something if it fails on a statement that
 * drops a predicate from ONE reading of a table while another reading keeps
 * it — which a search over the whole text cannot see.
 */
describe("expectWellFormed catches a reading of a table without its own scope", () => {
  const sections: TopologySqlStatement = entitySectionsStatement({
    projectId: PROJECT_ID,
    scope: { kind: "range", rangeStart: RANGE_START },
    projectTypes: [EntityType.Service],
    entityKey: "svc-a",
    isService: true,
    scanLimit: 100_001,
    window: { kind: "top", dependencyRows: 100, otherRows: 25 },
  });

  const allTimeSections: TopologySqlStatement = entitySectionsStatement({
    projectId: PROJECT_ID,
    scope: { kind: "allTime" },
    projectTypes: [EntityType.Service],
    entityKey: "svc-a",
    isService: true,
    scanLimit: 100_001,
    window: { kind: "top", dependencyRows: 100, otherRows: 25 },
  });

  const ALL_TIME: WellFormedOptions = {
    itemsMayIncludeArchived: true,
    relationshipsAllTime: true,
  };

  /* `statement` with `remove` taken out once, after the first `after`. */
  function without(
    statement: TopologySqlStatement,
    after: string,
    remove: string,
  ): TopologySqlStatement {
    const sql: string = normalize(statement.sql);
    const from: number = sql.indexOf(after);
    expect(from).toBeGreaterThanOrEqual(0);
    const at: number = sql.indexOf(remove, from);
    expect(at).toBeGreaterThan(from);
    return {
      sql: sql.slice(0, at) + sql.slice(at + remove.length),
      params: statement.params,
    };
  }

  test("the intact statements pass", () => {
    expect(() => {
      expectWellFormed(sections);
    }).not.toThrow();
    expect(() => {
      expectWellFormed(allTimeSections, ALL_TIME);
    }).not.toThrow();
  });

  test.each([
    ["scan_out", "the tenant", `r."projectId" = $1 AND `],
    ["scan_out", "the deleted filter", `r."deletedAt" IS NULL AND `],
    ["scan_in", "the tenant", `r."projectId" = $1 AND `],
    ["scan_in", "the deleted filter", `r."deletedAt" IS NULL AND `],
    ["others", "the tenant", `i."projectId" = $1 AND `],
    ["others", "the deleted filter", `i."deletedAt" IS NULL AND `],
  ])(
    "the all-time %s without %s fails, though it reads no range",
    (cte: string, _label: string, predicate: string) => {
      expect(() => {
        expectWellFormed(
          without(allTimeSections, `${cte} AS MATERIALIZED (`, predicate),
          ALL_TIME,
        );
      }).toThrow();
    },
  );

  test.each([
    ["the tenant", `r."projectId" = $1 AND `],
    ["the deleted filter", `r."deletedAt" IS NULL AND `],
    ["the range", ` AND r."lastSeenAt" >= $2`],
  ])(
    "the drawer's inbound scan without %s fails, though the outbound scan keeps it",
    (_label: string, predicate: string) => {
      const broken: TopologySqlStatement = without(
        sections,
        "scan_in AS MATERIALIZED (",
        predicate,
      );
      // Still somewhere in the text: a whole-statement search would pass.
      expect(broken.sql).toContain(predicate.replace(/^ AND | AND $/g, ""));
      expect(() => {
        expectWellFormed(broken);
      }).toThrow();
    },
  );

  test("the drawer's outbound scan without the tenant fails too", () => {
    expect(() => {
      expectWellFormed(
        without(
          sections,
          "scan_out AS MATERIALIZED (",
          `r."projectId" = $1 AND `,
        ),
      );
    }).toThrow();
  });

  test("the other-end lookup without the archive filter fails", () => {
    expect(() => {
      expectWellFormed(
        without(
          sections,
          "others AS MATERIALIZED (",
          `i."isArchived" = false AND `,
        ),
      );
    }).toThrow();
  });

  test("a winner sub-select cannot lend its predicates to the outer reading, nor the other way round", () => {
    const services: TopologySqlStatement = servicesStatement({
      projectId: PROJECT_ID,
      winner: WITH_DUPLICATES,
    });
    expect(() => {
      expectWellFormed(services);
    }).not.toThrow();
    expect(() => {
      expectWellFormed(without(services, "SELECT", `i."deletedAt" IS NULL`));
    }).toThrow();
    expect(() => {
      expectWellFormed(
        without(
          services,
          `"InventoryItem" dup`,
          `AND dup."deletedAt" IS NULL `,
        ),
      );
    }).toThrow();
  });

  test("a table read without an alias fails", () => {
    expect(() => {
      expectWellFormed({
        sql: `SELECT COUNT(*) FROM "InventoryItem" i WHERE i."projectId" = $1 AND i."isArchived" = false AND i."deletedAt" IS NULL AND EXISTS (SELECT 1 FROM "InventoryItem" WHERE "projectId" = $1)`,
        params: [PROJECT_ID],
      });
    }).toThrow();
  });
});
