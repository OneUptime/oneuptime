import {
  DiscoveredDeviceScope,
  DiscoveredDeviceStatement,
  StatementParams,
  buildClassifiedRows,
  buildClassifyStatement,
  buildCountsStatement,
  buildHideStatement,
  buildIdsStatement,
  buildOrder,
  buildRowsStatement,
  buildSearchCondition,
  buildShowCondition,
  buildShowStatement,
  escapeLikePattern,
  getSearchWords,
} from "../../../../Server/Utils/NetworkDevice/DiscoveredDeviceQuery";
import {
  DiscoveredDeviceShow,
  DiscoveredDeviceSort,
} from "../../../../Types/NetworkDevice/DiscoveredDevice";
import { describe, expect, test } from "@jest/globals";

/*
 * The statements behind the Discovered Devices list (issue #5775), read as
 * text: what each one asks the database, and that whatever a person types
 * reaches it as a parameter, never as SQL. DiscoveredDeviceListPostgres
 * runs them.
 */

const SCOPE: DiscoveredDeviceScope = {
  projectId: "aa000000-0000-4000-8000-000000000001",
  walkSeenSince: new Date("2026-11-08T11:45:00.000Z"),
  controllerSeenSince: new Date("2026-11-08T06:00:00.000Z"),
};

// Every "$n" a statement uses, which must be exactly its parameters.
function placeholdersOf(sql: string): Set<number> {
  const found: Set<number> = new Set<number>();

  for (const match of sql.matchAll(/\$(\d+)/g)) {
    found.add(Number(match[1]));
  }

  return found;
}

function expectParametersLineUp(statement: DiscoveredDeviceStatement): void {
  const used: Set<number> = placeholdersOf(statement.sql);

  expect(used.size).toBe(statement.params.length);

  for (let index: number = 1; index <= statement.params.length; index++) {
    expect(used.has(index)).toBe(true);
  }
}

describe("a search", () => {
  test("is words, at most six, each of which must match", () => {
    expect(getSearchWords("  front   register  ")).toEqual([
      "front",
      "register",
    ]);
    expect(getSearchWords("a b c d e f g h")).toHaveLength(6);
    expect(getSearchWords("   ")).toEqual([]);
  });

  test("escapes LIKE's wildcards, so 10_0 and 50% mean what they say", () => {
    expect(escapeLikePattern("10_0")).toBe("10!_0");
    expect(escapeLikePattern("50%")).toBe("50!%");
    expect(escapeLikePattern("a!b")).toBe("a!!b");
  });

  test("of nothing matches everything", () => {
    const params: StatementParams = new StatementParams();

    expect(buildSearchCondition("", params)).toBe("TRUE");
    expect(params.values).toEqual([]);
  });

  test("looks in every name, the address, the maker and the MAC", () => {
    const params: StatementParams = new StatementParams();
    const condition: string = buildSearchCondition("zebra", params);

    for (const column of [
      `c."classification"`,
      `c."hostname"`,
      `c."ipAddress"`,
      `c."vendor"`,
      `c."macAddress"`,
    ]) {
      expect(condition).toContain(`${column} ILIKE $1 ESCAPE '!'`);
    }

    expect(params.values).toEqual(["%zebra%"]);
    expect(condition).not.toContain("zebra");
  });

  test("a word that reads as part of a MAC also matches its hex digits, however it was separated", () => {
    const params: StatementParams = new StatementParams();
    const condition: string = buildSearchCondition("001A.2B3C", params);

    expect(condition).toContain(`c."macKey" LIKE $2`);
    // ILIKE ignores case; the hex key is lower-case, as the stored key is.
    expect(params.values).toEqual(["%001A.2B3C%", "%001a2b3c%"]);
  });

  test("digits alone are an address, not a run of a MAC", () => {
    const params: StatementParams = new StatementParams();
    buildSearchCondition("0012", params);

    expect(params.values).toEqual(["%0012%"]);
  });

  test("every word must match: words are joined by AND", () => {
    const params: StatementParams = new StatementParams();
    const condition: string = buildSearchCondition("front 10.0", params);

    expect(condition.split(") AND (")).toHaveLength(2);
    expect(params.values).toEqual(["%front%", "%10.0%"]);
  });

  test("text that looks like SQL is a parameter like any other", () => {
    const params: StatementParams = new StatementParams();
    const attack: string = `x'); DROP TABLE "NetworkDevice"; --`;
    const condition: string = buildSearchCondition(attack, params);

    expect(condition).not.toContain("DROP");
    expect(params.values.join(" ")).toContain("DROP");
  });
});

describe("which rows a choice shows", () => {
  test.each([
    [DiscoveredDeviceShow.NotMonitored, `c."monitoredDeviceId" IS NULL`],
    [DiscoveredDeviceShow.Monitored, `c."monitoredDeviceId" IS NOT NULL`],
    [
      DiscoveredDeviceShow.Hidden,
      `(c."monitoredDeviceId" IS NULL AND c."isHidden")`,
    ],
    [DiscoveredDeviceShow.All, "TRUE"],
  ])("%s", (show: DiscoveredDeviceShow, condition: string) => {
    expect(buildShowCondition(show)).toBe(condition);
  });
});

describe("the order", () => {
  test("ends on the row id, so a page never repeats or skips a row", () => {
    for (const sort of Object.values(DiscoveredDeviceSort)) {
      expect(buildOrder(sort, "asc").endsWith(`c."id" ASC`)).toBe(true);
      expect(buildOrder(sort, "desc").endsWith(`c."id" ASC`)).toBe(true);
    }
  });

  test("by address sorts dotted quads as numbers, guarded by a strict pattern", () => {
    const order: string = buildOrder(DiscoveredDeviceSort.IpAddress, "asc");

    expect(order).toContain(`c."address"::inet END) ASC NULLS LAST`);
    expect(order).toContain("25[0-5]|2[0-4][0-9]");
  });

  test("never sends an empty value to the top", () => {
    expect(buildOrder(DiscoveredDeviceSort.LastSeen, "desc")).toBe(
      `c."lastSeenAt" DESC NULLS LAST, c."id" ASC`,
    );
    expect(buildOrder(DiscoveredDeviceSort.Vendor, "asc")).toContain(
      `lower(NULLIF(btrim(c."vendor"), '')) ASC NULLS LAST`,
    );
  });
});

describe("the classified rows", () => {
  test("are one project's live rows, by site and ids when asked", () => {
    const params: StatementParams = new StatementParams();
    const sql: string = buildClassifiedRows(
      {
        ...SCOPE,
        siteId: "bb000000-0000-4000-8000-000000000001",
        endpointIds: ["cc000000-0000-4000-8000-000000000001"],
      },
      params,
    );

    expect(sql).toContain(`e."projectId" = $1::uuid`);
    expect(sql).toContain(`e."deletedAt" IS NULL`);
    expect(sql).toContain(`e."siteId" = $4::uuid`);
    expect(sql).toContain(`e."_id" = ANY($5::uuid[])`);
    expect(params.values).toEqual([
      SCOPE.projectId,
      SCOPE.walkSeenSince,
      SCOPE.controllerSeenSince,
      "bb000000-0000-4000-8000-000000000001",
      ["cc000000-0000-4000-8000-000000000001"],
    ]);
  });

  test("count only live, unarchived devices as monitoring them", () => {
    const sql: string = buildClassifiedRows(SCOPE, new StatementParams());

    expect(sql).toContain(`d."deletedAt" IS NULL`);
    expect(sql).toContain(`COALESCE(d."isArchived", false) = false`);
  });

  test("match a device by its MAC as twelve hex digits, and by address only in the same site", () => {
    const sql: string = buildClassifiedRows(SCOPE, new StatementParams());

    expect(sql).toContain(
      `regexp_replace(lower(COALESCE(d."macAddress", '')), '[^0-9a-f]', '', 'g') AS "macKey"`,
    );
    expect(sql).toContain(
      `length(r."macKey") = 12 AND md."macKey" = r."macKey"`,
    );
    expect(sql).toContain(
      `ad."address" = r."address" AND ad."siteKey" = r."siteKey"`,
    );
  });

  test("an address is evidence only while the sighting is current, a MAC always", () => {
    const sql: string = buildClassifiedRows(SCOPE, new StatementParams());

    expect(sql).toContain(
      `COALESCE(
      md."_id",
      CASE WHEN r."isSeenRecently" THEN ad."_id" END
    ) AS "monitoredDeviceId"`,
    );
    expect(sql).toContain(
      `WHEN COALESCE(e."attachmentSource", '') = '' THEN $2::timestamptz`,
    );
    expect(sql).toContain(`ELSE $3::timestamptz`);
  });

  test("a row is hidden when the map has a suppression for its endpoint node", () => {
    const sql: string = buildClassifiedRows(SCOPE, new StatementParams());

    expect(sql).toContain(`h."nodeKey" = 'endpoint:' || r."id"::text`);
    expect(sql).toContain(`s."nodeKey" LIKE 'endpoint:%'`);
  });
});

describe("the statements", () => {
  test("counts are worked out for one search, across every choice of show", () => {
    const statement: DiscoveredDeviceStatement = buildCountsStatement({
      scope: SCOPE,
      search: "printer",
    });

    expectParametersLineUp(statement);
    expect(statement.sql).toContain(`COUNT(*)::int AS "all"`);
    expect(statement.sql).toContain(
      `COUNT(*) FILTER (WHERE c."monitoredDeviceId" IS NULL AND c."isHidden")::int AS "hidden"`,
    );
    expect(statement.params[3]).toBe("%printer%");
  });

  test("a page is limited and offset by parameters", () => {
    const statement: DiscoveredDeviceStatement = buildRowsStatement({
      scope: SCOPE,
      search: "",
      show: DiscoveredDeviceShow.Hidden,
      sort: DiscoveredDeviceSort.Name,
      sortOrder: "asc",
      limit: 25,
      skip: 50,
    });

    expectParametersLineUp(statement);
    expect(statement.sql).toMatch(/LIMIT \$4 OFFSET \$5$/);
    expect(statement.params.slice(3)).toEqual([25, 50]);
    expect(statement.sql).toContain(
      `AND (c."monitoredDeviceId" IS NULL AND c."isHidden")`,
    );
  });

  test("the ids of every match are capped by a parameter", () => {
    const statement: DiscoveredDeviceStatement = buildIdsStatement({
      scope: SCOPE,
      search: "cam",
      show: DiscoveredDeviceShow.NotMonitored,
      sort: DiscoveredDeviceSort.LastSeen,
      sortOrder: "desc",
      limit: 5000,
    });

    expectParametersLineUp(statement);
    expect(statement.sql).toContain(`SELECT c."id"`);
    expect(statement.params[statement.params.length - 1]).toBe(5000);
  });

  test("classifying rows reads only the ids asked for", () => {
    const statement: DiscoveredDeviceStatement = buildClassifyStatement({
      ...SCOPE,
      endpointIds: ["cc000000-0000-4000-8000-000000000001"],
    });

    expectParametersLineUp(statement);
    expect(statement.sql).toContain(`e."_id" = ANY($4::uuid[])`);
  });

  test("hiding writes what the model's create writes, version included, never twice for one node", () => {
    const statement: DiscoveredDeviceStatement = buildHideStatement({
      projectId: SCOPE.projectId,
      userId: "dd000000-0000-4000-8000-000000000001",
      reason: "Hidden from the map on the Discovered Devices list.",
      rows: [
        {
          id: "ee000000-0000-4000-8000-000000000001",
          nodeKey: "endpoint:cc000000-0000-4000-8000-000000000001",
          nodeName: "Front register",
        },
      ],
    });

    expectParametersLineUp(statement);
    expect(statement.sql).toContain(
      `("_id", "createdAt", "updatedAt", "version", "projectId", "nodeKey", "nodeName", "reason", "createdByUserId")`,
    );
    expect(statement.sql).toContain("now(), now(), 1,");
    expect(statement.sql).toContain("WHERE NOT EXISTS");
    expect(statement.sql).toContain(`RETURNING "nodeKey"`);
    // Answered by a SELECT, so the driver hands back the rows themselves.
    expect(statement.sql.startsWith("WITH added AS (\nINSERT INTO")).toBe(true);
    expect(statement.sql.endsWith(`SELECT "nodeKey" FROM added`)).toBe(true);
    expect(statement.params).toEqual([
      SCOPE.projectId,
      "dd000000-0000-4000-8000-000000000001",
      "Hidden from the map on the Discovered Devices list.",
      ["ee000000-0000-4000-8000-000000000001"],
      ["endpoint:cc000000-0000-4000-8000-000000000001"],
      ["Front register"],
    ]);
  });

  test("hiding by someone with no user id writes no author", () => {
    const statement: DiscoveredDeviceStatement = buildHideStatement({
      projectId: SCOPE.projectId,
      reason: "r",
      rows: [],
    });

    expect(statement.params[1]).toBeNull();
  });

  test("showing removes these nodes' suppressions, or every one of the project's", () => {
    const some: DiscoveredDeviceStatement = buildShowStatement({
      projectId: SCOPE.projectId,
      nodeKeys: ["endpoint:cc000000-0000-4000-8000-000000000001"],
    });
    const every: DiscoveredDeviceStatement = buildShowStatement({
      projectId: SCOPE.projectId,
    });

    expectParametersLineUp(some);
    expectParametersLineUp(every);
    /*
     * A bare DELETE comes back from TypeORM's Postgres driver as
     * [rows, rowCount]; through a SELECT it comes back as the rows.
     */
    expect(some.sql).toBe(`WITH removed AS (
DELETE FROM "NetworkTopologySuppression"
WHERE "projectId" = $1::uuid AND "nodeKey" = ANY($2::text[])
RETURNING "nodeKey"
)
SELECT "nodeKey" FROM removed`);
    expect(every.sql).toBe(`WITH removed AS (
DELETE FROM "NetworkTopologySuppression"
WHERE "projectId" = $1::uuid
RETURNING "nodeKey"
)
SELECT "nodeKey" FROM removed`);
  });
});
