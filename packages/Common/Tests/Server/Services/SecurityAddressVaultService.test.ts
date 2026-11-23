import SecurityAddressVault, {
  SECURITY_ADDRESS_VAULT_RETENTION_IN_DAYS,
} from "../../../Models/AnalyticsModels/SecurityAddressVault";
import AnalyticsModels from "../../../Models/AnalyticsModels/Index";
import AnalyticsBaseModel from "../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import BaseAnalyticsAPI from "../../../Server/API/BaseAnalyticsAPI";
import AnalyticsDatabaseService, {
  Results,
} from "../../../Server/Services/AnalyticsDatabaseService";
import { AnalyticsServices } from "../../../Server/Services/Index";
import SecurityAddressVaultService, {
  MAX_TOKENS_PER_VAULT_LOOKUP,
  SECURITY_ADDRESS_VAULT_REFUSAL,
  SecurityAddressVaultService as SecurityAddressVaultServiceClass,
} from "../../../Server/Services/SecurityAddressVaultService";
import { ClickhouseAppInstance } from "../../../Server/Infrastructure/ClickhouseDatabase";
import { Statement } from "../../../Server/Utils/AnalyticsDatabase/Statement";
import StatementGenerator from "../../../Server/Utils/AnalyticsDatabase/StatementGenerator";
import AnalyticsTableEngine from "../../../Types/AnalyticsDatabase/AnalyticsTableEngine";
import AnalyticsTableName from "../../../Types/AnalyticsDatabase/AnalyticsTableName";
import AnalyticsTableColumn from "../../../Types/AnalyticsDatabase/TableColumn";
import TableColumnType from "../../../Types/AnalyticsDatabase/TableColumnType";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { getJestSpyOn } from "../../Spy";
import {
  findAliasShadows,
  findAliasesSpellingColumns,
} from "../../Helpers/ClickhouseAliasScan";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * SECURITY EVENTS' ADDRESS VAULT, ITS TABLE AND ITS SERVICE (#10395).
 *
 * The table holds the IP address behind each token an IP Address Hash rule
 * left in the logs and traces Security Events reads. What is pinned here:
 *
 *   - the table: one row per project, token and address, folded on merge
 *     (the earliest firstSeenAt, the latest lastSeenAt), a day a
 *     partition, dropped 30 days after the last sighting - and the CREATE
 *     TABLE boot runs from the model says exactly that;
 *   - nothing generic reaches it: no API path, MCP tools, documentation or
 *     read permission, out of the AnalyticsModels registry, and every
 *     generic read of its service refused, as the server too;
 *   - the one read: one query for a page's tokens, today's tokens only, a
 *     30-day window, and a token with two addresses names neither;
 *   - the rows ingest writes: tokens and IP addresses only.
 *
 * App/Tests/Telemetry/SecurityAddressVaultClickhouse.test.ts runs the same
 * statements on a real server.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10395000-0000-4000-8000-000000000001",
);
const NOW: Date = new Date("2026-11-20T12:00:00.000Z");
const DATABASE_NAME: string = "oneuptime";

const TOKEN_A: string = "[HASHED:01580765cb52614a]";
const TOKEN_B: string = "[HASHED:3f9a1c0e7b2d4a68]";
const LEGACY_TOKEN: string = "[HASHED:8c87b489]";

type Spy = ReturnType<typeof getJestSpyOn>;

function stubExecuteQuery(answers: Array<Array<JSONObject>>): Spy {
  getJestSpyOn(
    SecurityAddressVaultService.database,
    "getDatasourceOptions",
  ).mockReturnValue({ database: DATABASE_NAME } as never);

  const spy: Spy = getJestSpyOn(SecurityAddressVaultService, "executeQuery");

  for (const rows of answers) {
    spy.mockResolvedValueOnce({
      json: (): Promise<unknown> => {
        return Promise.resolve({ data: rows });
      },
    } as unknown as Results as never);
  }

  return spy;
}

function statementOf(spy: Spy, call: number = 0): Statement {
  return spy.mock.calls[call]![0] as Statement;
}

function columnOf(key: string): AnalyticsTableColumn {
  const column: AnalyticsTableColumn | undefined =
    new SecurityAddressVault().tableColumns.find(
      (candidate: AnalyticsTableColumn): boolean => {
        return candidate.key === key;
      },
    );

  expect(column).toBeDefined();

  return column!;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the address vault's table", () => {
  const model: SecurityAddressVault = new SecurityAddressVault();

  test("is its own table", () => {
    expect(model.tableName).toBe("SecurityAddressVaultV1");
    expect(AnalyticsTableName.SecurityAddressVault).toBe(
      "SecurityAddressVaultV1",
    );
  });

  test("holds a project, a token and an address, first and last seen - nothing more", () => {
    expect(
      model.tableColumns.map((column: AnalyticsTableColumn): string => {
        return column.key;
      }),
    ).toEqual(["projectId", "token", "address", "firstSeenAt", "lastSeenAt"]);

    expect(columnOf("projectId").type).toBe(TableColumnType.ObjectID);
    expect(columnOf("projectId").isTenantId).toBe(true);
    expect(columnOf("token").type).toBe(TableColumnType.Text);
    expect(columnOf("address").type).toBe(TableColumnType.Text);
    expect(columnOf("firstSeenAt").type).toBe(TableColumnType.Date);
    expect(columnOf("lastSeenAt").type).toBe(TableColumnType.Date);
  });

  test("folds a token's rows as they merge: the earliest first sighting, the latest last", () => {
    expect(model.tableEngine).toBe(AnalyticsTableEngine.AggregatingMergeTree);
    expect(columnOf("firstSeenAt").simpleAggregateFunction).toBe("min");
    expect(columnOf("lastSeenAt").simpleAggregateFunction).toBe("max");
    // Keys are kept as written; everything else is folded.
    expect(columnOf("token").simpleAggregateFunction).toBeUndefined();
    expect(columnOf("address").simpleAggregateFunction).toBeUndefined();
  });

  test("is keyed by project and token, and keeps two addresses of one token apart", () => {
    expect(model.primaryKeys).toEqual(["projectId", "token"]);
    expect(model.sortKeys).toEqual(["projectId", "token", "address"]);
  });

  test("keeps an address 30 days after it was last seen, a day a partition", () => {
    expect(SECURITY_ADDRESS_VAULT_RETENTION_IN_DAYS).toBe(30);
    expect(model.partitionKey).toBe("toYYYYMMDD(lastSeenAt)");
    expect(model.ttlExpression).toBe("lastSeenAt + INTERVAL 30 DAY DELETE");
    // A day's rows expire together: the partition is dropped, never rewritten.
    expect(model.tableSettings).toBe("ttl_only_drop_parts = 1");
  });

  test("boot creates it with exactly that (the statement TableManegement runs)", () => {
    const statement: Statement = new StatementGenerator<SecurityAddressVault>({
      modelType: SecurityAddressVault,
      database: ClickhouseAppInstance,
    }).toTableCreateStatement();
    const query: string = statement.query.replace(/\s+/g, " ").trim();

    expect(query).toBe(
      "CREATE TABLE IF NOT EXISTS {p0:Identifier}.{p1:Identifier} ON CLUSTER 'oneuptime' ( projectId String, token String CODEC(ZSTD(1)), address String CODEC(ZSTD(1)), firstSeenAt SimpleAggregateFunction(min, DateTime), lastSeenAt SimpleAggregateFunction(max, DateTime) ) ENGINE = ReplicatedAggregatingMergeTree PARTITION BY (toYYYYMMDD(lastSeenAt)) PRIMARY KEY ({p2:Identifier}, {p3:Identifier}) ORDER BY ({p4:Identifier}, {p5:Identifier}, {p6:Identifier}) TTL lastSeenAt + INTERVAL 30 DAY DELETE SETTINGS ttl_only_drop_parts = 1",
    );
    expect(statement.query_params).toEqual({
      p0: "oneuptime",
      p1: "SecurityAddressVaultV1Local",
      p2: "projectId",
      p3: "token",
      p4: "projectId",
      p5: "token",
      p6: "address",
    });
    // Nothing of a row but the five: no _id, no createdAt.
    expect(query).not.toContain("_id");
    expect(query).not.toContain("createdAt");
  });
});

describe("nothing generic reaches the vault", () => {
  const model: SecurityAddressVault = new SecurityAddressVault();

  test("no API path, no MCP tools, no API reference", () => {
    expect(model.crudApiPath).toBeUndefined();
    expect(model.enableMCP).toBe(false);
    expect(model.enableDocumentation).toBe(false);
    expect(model.enableRealtimeEventsOn).toBeUndefined();
    expect(model.enableWorkflowOn).toBeUndefined();
  });

  test("BaseAnalyticsAPI refuses to build a route for it", () => {
    expect(() => {
      return new BaseAnalyticsAPI<
        SecurityAddressVault,
        SecurityAddressVaultServiceClass
      >(SecurityAddressVault, SecurityAddressVaultService);
    }).toThrow(/no crudApiPath/);
  });

  test("nobody may read, write, change or delete a row through the API", () => {
    expect(model.accessControl).toEqual({
      read: [],
      create: [],
      update: [],
      delete: [],
    });

    for (const column of model.tableColumns) {
      expect(column.accessControl).toEqual({
        read: [],
        create: [],
        update: [],
      });
    }
  });

  test("is not in the registry the API, MCP, CLI, OpenAPI and live-update generators read", () => {
    const tables: Array<string> = AnalyticsModels.map(
      (modelType: { new (): AnalyticsBaseModel }): string => {
        return new modelType().tableName;
      },
    );

    expect(tables).not.toContain(model.tableName);
  });

  test("is in AnalyticsServices, so boot creates its table", () => {
    expect(AnalyticsServices).toContain(SecurityAddressVaultService);
  });

  const refusedReads: Array<{ name: string; call: () => Promise<unknown> }> = [
    {
      name: "findBy",
      call: (): Promise<unknown> => {
        return SecurityAddressVaultService.findBy({
          query: {},
          select: { address: true },
          skip: 0,
          limit: 10,
          props: { isRoot: true },
        });
      },
    },
    {
      name: "findOneBy",
      call: (): Promise<unknown> => {
        return SecurityAddressVaultService.findOneBy({
          query: {},
          select: { address: true },
          props: { isRoot: true },
        });
      },
    },
    {
      name: "findOneById",
      call: (): Promise<unknown> => {
        return SecurityAddressVaultService.findOneById({
          id: ObjectID.generate(),
          select: { address: true },
          props: { isRoot: true },
        });
      },
    },
    {
      name: "countBy",
      call: (): Promise<unknown> => {
        return SecurityAddressVaultService.countBy({
          query: {},
          props: { isRoot: true },
        });
      },
    },
    {
      name: "existsBy",
      call: (): Promise<unknown> => {
        return SecurityAddressVaultService.existsBy({
          query: {},
          props: { isRoot: true },
        });
      },
    },
    {
      name: "aggregateBy",
      call: (): Promise<unknown> => {
        return SecurityAddressVaultService.aggregateBy({} as never);
      },
    },
    {
      name: "countDistinctNonEmpty",
      call: (): Promise<unknown> => {
        return SecurityAddressVaultService.countDistinctNonEmpty({
          query: {},
          expression: "address",
          props: { isRoot: true },
        });
      },
    },
    {
      name: "countPerWindow",
      call: (): Promise<unknown> => {
        return SecurityAddressVaultService.countPerWindow({
          query: {},
          timeColumnName: "lastSeenAt",
          windowInSeconds: 60,
          props: { isRoot: true },
        });
      },
    },
    {
      name: "countPerValueInWindows",
      call: (): Promise<unknown> => {
        return SecurityAddressVaultService.countPerValueInWindows({
          query: {},
          valueColumnName: "address",
          timeColumnName: "lastSeenAt",
          windows: [],
          props: { isRoot: true },
        });
      },
    },
    {
      name: "groupTelemetryUsageByService",
      call: (): Promise<unknown> => {
        return SecurityAddressVaultService.groupTelemetryUsageByService({
          projectId: PROJECT_ID,
          timestampColumnName: "lastSeenAt",
          startDate: NOW,
          endDate: NOW,
        } as never);
      },
    },
    {
      name: "getDaysWithRows",
      call: (): Promise<unknown> => {
        return SecurityAddressVaultService.getDaysWithRows({
          projectId: PROJECT_ID,
          timestampColumnName: "lastSeenAt",
          startDate: NOW,
          endDate: NOW,
        });
      },
    },
  ];

  test.each(refusedReads)(
    "its service refuses $name, as the server too, before any query",
    async ({ call }: { call: () => Promise<unknown> }) => {
      const query: Spy = getJestSpyOn(
        SecurityAddressVaultService,
        "executeQuery",
      );

      await expect(call()).rejects.toThrow(SECURITY_ADDRESS_VAULT_REFUSAL);
      expect(query).not.toHaveBeenCalled();
    },
  );

  test("every read the base service offers is one the vault's service refuses", () => {
    /*
     * A read added to AnalyticsDatabaseService - a find, a count, an
     * aggregate, an exists, a grouping - must be refused here too, or the
     * vault could be read through a list that holds its service
     * (AnalyticsServices). The statement builders (toFindStatement ...)
     * read nothing.
     */
    const readName: RegExp = /^(find|count|aggregate|exists|group|getDaysWith)/;
    const baseReads: Array<string> = Object.getOwnPropertyNames(
      AnalyticsDatabaseService.prototype,
    )
      .filter((name: string): boolean => {
        return readName.test(name);
      })
      .sort();
    const refused: Array<string> = refusedReads
      .map((read: { name: string }): string => {
        return read.name;
      })
      .sort();

    expect(baseReads).toEqual(refused);

    for (const name of refused) {
      expect(
        (SecurityAddressVaultServiceClass.prototype as unknown as JSONObject)[
          name
        ],
      ).not.toBe(
        (AnalyticsDatabaseService.prototype as unknown as JSONObject)[name],
      );
    }
  });
});

describe("the rows ingest writes", () => {
  test("a token and the address behind it, first and last seen when written", () => {
    expect(
      SecurityAddressVaultServiceClass.toRows({
        projectId: PROJECT_ID,
        entries: [
          { token: TOKEN_A, address: "203.0.113.7" },
          { token: TOKEN_B, address: "2001:db8::7" },
        ],
        seenAt: NOW,
      }),
    ).toEqual([
      {
        projectId: PROJECT_ID.toString(),
        token: TOKEN_A,
        address: "203.0.113.7",
        firstSeenAt: "2026-11-20 12:00:00",
        lastSeenAt: "2026-11-20 12:00:00",
      },
      {
        projectId: PROJECT_ID.toString(),
        token: TOKEN_B,
        address: "2001:db8::7",
        firstSeenAt: "2026-11-20 12:00:00",
        lastSeenAt: "2026-11-20 12:00:00",
      },
    ]);
  });

  test.each([
    [
      "an older 8-hex token, which no rule makes now",
      LEGACY_TOKEN,
      "203.0.113.7",
    ],
    ["what Redact leaves", "[REDACTED]", "203.0.113.7"],
    ["a token in capitals", "[HASHED:01580765CB52614A]", "203.0.113.7"],
    ["a token inside text", `from ${TOKEN_A}`, "203.0.113.7"],
    ["a host name for the address", TOKEN_A, "attacker.example"],
    ["an empty address", TOKEN_A, ""],
    ["an address with a port", TOKEN_A, "203.0.113.7:443"],
  ])("%s is no row", (_label: string, token: string, address: string) => {
    expect(
      SecurityAddressVaultServiceClass.toRows({
        projectId: PROJECT_ID,
        entries: [{ token, address }],
        seenAt: NOW,
      }),
    ).toEqual([]);
  });
});

describe("the one read: the addresses behind a page's tokens", () => {
  test("one query, for the project and its tokens, seen in the last 30 days", async () => {
    const spy: Spy = stubExecuteQuery([
      [
        { token: TOKEN_A, vaultAddresses: ["203.0.113.7"] },
        { token: TOKEN_B, vaultAddresses: ["2001:db8::7"] },
      ],
    ]);

    const found: Map<string, string> =
      await SecurityAddressVaultService.findAddressesOfTokens({
        projectId: PROJECT_ID,
        tokens: [TOKEN_A, TOKEN_B, TOKEN_A],
        now: NOW,
      });

    expect(Array.from(found.entries())).toEqual([
      [TOKEN_A, "203.0.113.7"],
      [TOKEN_B, "2001:db8::7"],
    ]);
    expect(spy).toHaveBeenCalledTimes(1);

    const statement: Statement = statementOf(spy);

    expect(statement.query).toBe(
      "SELECT token, groupUniqArray(2)(address) AS vaultAddresses FROM oneuptime.SecurityAddressVaultV1 WHERE projectId = {p0:String} AND token IN ({p1:Array(String)}) AND lastSeenAt >= {p2:DateTime} GROUP BY token SETTINGS max_execution_time = 10, timeout_overflow_mode = 'throw', max_memory_usage = 3221225472, max_bytes_before_external_group_by = 1610612736, max_bytes_before_external_sort = 1610612736",
    );
    expect(statement.query_params).toEqual({
      p0: PROJECT_ID.toString(),
      p1: [TOKEN_A, TOKEN_B],
      p2: "2026-10-21 12:00:00",
    });
  });

  test("its alias spells no column the statement reads (ClickhouseAliasShadowGuard)", () => {
    const query: string = SecurityAddressVaultService.toFindAddressesStatement({
      projectId: PROJECT_ID,
      tokens: [TOKEN_A],
      seenAfter: NOW,
    }).query;

    expect(findAliasesSpellingColumns(query)).toEqual([]);
    expect(findAliasShadows(query)).toEqual([]);
  });

  test("asks about no token a Hash rule does not make today, and asks nothing without one", async () => {
    const spy: Spy = stubExecuteQuery([]);

    const found: Map<string, string> =
      await SecurityAddressVaultService.findAddressesOfTokens({
        projectId: PROJECT_ID,
        tokens: [LEGACY_TOKEN, "[REDACTED]", "***.***.***.***", "203.0.113.7"],
        now: NOW,
      });

    expect(found.size).toBe(0);
    expect(spy).not.toHaveBeenCalled();
  });

  test("a token with two addresses - a 64-bit collision - names neither", async () => {
    stubExecuteQuery([
      [
        { token: TOKEN_A, vaultAddresses: ["203.0.113.7", "198.51.100.9"] },
        { token: TOKEN_B, vaultAddresses: ["2001:db8::7"] },
      ],
    ]);

    const found: Map<string, string> =
      await SecurityAddressVaultService.findAddressesOfTokens({
        projectId: PROJECT_ID,
        tokens: [TOKEN_A, TOKEN_B],
        now: NOW,
      });

    expect(found.has(TOKEN_A)).toBe(false);
    expect(found.get(TOKEN_B)).toBe("2001:db8::7");
  });

  test("names only an IP address, and only for a token it asked about", async () => {
    stubExecuteQuery([
      [
        { token: TOKEN_A, vaultAddresses: ["not an address"] },
        { token: TOKEN_B, vaultAddresses: [] },
        { token: "[HASHED:aaaaaaaaaaaaaaaa]", vaultAddresses: ["203.0.113.9"] },
      ],
    ]);

    const found: Map<string, string> =
      await SecurityAddressVaultService.findAddressesOfTokens({
        projectId: PROJECT_ID,
        tokens: [TOKEN_A, TOKEN_B],
        now: NOW,
      });

    expect(found.size).toBe(0);
  });

  test("a page of more tokens than one query names is read MAX_TOKENS_PER_VAULT_LOOKUP at a time", async () => {
    const tokens: Array<string> = [];

    for (
      let index: number = 0;
      index < MAX_TOKENS_PER_VAULT_LOOKUP + 5;
      index++
    ) {
      tokens.push(`[HASHED:${index.toString(16).padStart(15, "0")}a]`);
    }

    const spy: Spy = stubExecuteQuery([
      [{ token: tokens[0]!, vaultAddresses: ["203.0.113.1"] }],
      [{ token: tokens[tokens.length - 1]!, vaultAddresses: ["203.0.113.2"] }],
    ]);

    const found: Map<string, string> =
      await SecurityAddressVaultService.findAddressesOfTokens({
        projectId: PROJECT_ID,
        tokens,
        now: NOW,
      });

    expect(spy).toHaveBeenCalledTimes(2);
    expect(
      (statementOf(spy, 0).query_params["p1"] as Array<string>).length,
    ).toBe(MAX_TOKENS_PER_VAULT_LOOKUP);
    expect(
      (statementOf(spy, 1).query_params["p1"] as Array<string>).length,
    ).toBe(5);
    expect(found.get(tokens[0]!)).toBe("203.0.113.1");
    expect(found.get(tokens[tokens.length - 1]!)).toBe("203.0.113.2");
  });

  test("a read that fails is the caller's to catch", async () => {
    getJestSpyOn(
      SecurityAddressVaultService.database,
      "getDatasourceOptions",
    ).mockReturnValue({ database: DATABASE_NAME } as never);
    getJestSpyOn(SecurityAddressVaultService, "executeQuery").mockRejectedValue(
      new Error("ClickHouse is down") as never,
    );

    await expect(
      SecurityAddressVaultService.findAddressesOfTokens({
        projectId: PROJECT_ID,
        tokens: [TOKEN_A],
        now: NOW,
      }),
    ).rejects.toThrow("ClickHouse is down");
  });

  test("the window is exactly the vault's 30 days before now", () => {
    expect(
      SecurityAddressVaultServiceClass.getOldestNameableTime(NOW).toISOString(),
    ).toBe("2026-10-21T12:00:00.000Z");
  });

  test("a project's tokens are looked up in that project only", async () => {
    const other: ObjectID = new ObjectID(
      "10395000-0000-4000-8000-000000000002",
    );
    const spy: Spy = stubExecuteQuery([[]]);

    await SecurityAddressVaultService.findAddressesOfTokens({
      projectId: other,
      tokens: [TOKEN_A],
      now: NOW,
    });

    expect(statementOf(spy).query_params["p0"]).toBe(other.toString());
    expect(statementOf(spy).query).toContain("WHERE projectId = {p0:String}");
  });

  test("the tokens are named as a list, never spliced into the query", () => {
    const statement: Statement =
      SecurityAddressVaultService.toFindAddressesStatement({
        projectId: PROJECT_ID,
        tokens: ["[HASHED:0000000000000000]') OR 1=1 --"],
        seenAfter: NOW,
      });

    expect(statement.query).not.toContain("OR 1=1");
    expect(statement.query_params["p1"]).toEqual([
      "[HASHED:0000000000000000]') OR 1=1 --",
    ]);
  });
});
