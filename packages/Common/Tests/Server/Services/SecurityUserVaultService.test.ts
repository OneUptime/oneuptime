import SecurityUserVault, {
  SECURITY_USER_VAULT_RETENTION_IN_DAYS,
} from "../../../Models/AnalyticsModels/SecurityUserVault";
import AnalyticsModels from "../../../Models/AnalyticsModels/Index";
import AnalyticsBaseModel from "../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import BaseAnalyticsAPI from "../../../Server/API/BaseAnalyticsAPI";
import AnalyticsDatabaseService, {
  Results,
} from "../../../Server/Services/AnalyticsDatabaseService";
import { AnalyticsServices } from "../../../Server/Services/Index";
import SecurityUserVaultService, {
  MAX_TOKENS_PER_USER_VAULT_LOOKUP,
  MAX_USER_VAULT_USER_LENGTH,
  SECURITY_USER_VAULT_REFUSAL,
  SecurityUserVaultService as SecurityUserVaultServiceClass,
  isUserVaultUser,
} from "../../../Server/Services/SecurityUserVaultService";
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
 * SECURITY EVENTS' USER VAULT, ITS TABLE AND ITS SERVICE (#10632), the
 * address vault's twin (SecurityAddressVaultService.test.ts).
 *
 * The table holds the user behind each token a Hash rule left where
 * Security Events reads a user in the logs and traces it reads. What is
 * pinned here:
 *
 *   - the table: one row per project, token and user, folded on merge
 *     (the earliest firstSeenAt, the latest lastSeenAt), a day a
 *     partition, dropped 30 days after the last sighting - and the CREATE
 *     TABLE boot runs from the model says exactly that;
 *   - nothing generic reaches it: no API path, MCP tools, documentation or
 *     read permission, out of the AnalyticsModels registry, and every
 *     generic read of its service refused, as the server too;
 *   - the one read: one query for a page's tokens, today's tokens only, a
 *     30-day window, and a token with two users names neither;
 *   - the rows ingest writes: tokens and users only - never what a scrub
 *     rule left, and never a value longer than a user is.
 *
 * App/Tests/Telemetry/SecurityUserVaultClickhouse.test.ts runs the same
 * statements on a real server.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10632000-0000-4000-8000-000000000001",
);
const NOW: Date = new Date("2026-11-20T12:00:00.000Z");
const DATABASE_NAME: string = "oneuptime";

const TOKEN_A: string = "[HASHED:01580765cb52614a]";
const TOKEN_B: string = "[HASHED:3f9a1c0e7b2d4a68]";
const LEGACY_TOKEN: string = "[HASHED:8c87b489]";

type Spy = ReturnType<typeof getJestSpyOn>;

function stubExecuteQuery(answers: Array<Array<JSONObject>>): Spy {
  getJestSpyOn(
    SecurityUserVaultService.database,
    "getDatasourceOptions",
  ).mockReturnValue({ database: DATABASE_NAME } as never);

  const spy: Spy = getJestSpyOn(SecurityUserVaultService, "executeQuery");

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
    new SecurityUserVault().tableColumns.find(
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

describe("the user vault's table", () => {
  const model: SecurityUserVault = new SecurityUserVault();

  test("is its own table", () => {
    expect(model.tableName).toBe("SecurityUserVaultV1");
    expect(AnalyticsTableName.SecurityUserVault).toBe("SecurityUserVaultV1");
  });

  test("holds a project, a token and a user, first and last seen - nothing more", () => {
    expect(
      model.tableColumns.map((column: AnalyticsTableColumn): string => {
        return column.key;
      }),
    ).toEqual(["projectId", "token", "userValue", "firstSeenAt", "lastSeenAt"]);

    expect(columnOf("projectId").type).toBe(TableColumnType.ObjectID);
    expect(columnOf("projectId").isTenantId).toBe(true);
    expect(columnOf("token").type).toBe(TableColumnType.Text);
    expect(columnOf("userValue").type).toBe(TableColumnType.Text);
    expect(columnOf("firstSeenAt").type).toBe(TableColumnType.Date);
    expect(columnOf("lastSeenAt").type).toBe(TableColumnType.Date);
  });

  test("folds a token's rows as they merge: the earliest first sighting, the latest last", () => {
    expect(model.tableEngine).toBe(AnalyticsTableEngine.AggregatingMergeTree);
    expect(columnOf("firstSeenAt").simpleAggregateFunction).toBe("min");
    expect(columnOf("lastSeenAt").simpleAggregateFunction).toBe("max");
    // Keys are kept as written; everything else is folded.
    expect(columnOf("token").simpleAggregateFunction).toBeUndefined();
    expect(columnOf("userValue").simpleAggregateFunction).toBeUndefined();
  });

  test("is keyed by project and token, and keeps two users of one token apart", () => {
    expect(model.primaryKeys).toEqual(["projectId", "token"]);
    expect(model.sortKeys).toEqual(["projectId", "token", "userValue"]);
  });

  test("keeps a user 30 days after they were last seen, a day a partition", () => {
    expect(SECURITY_USER_VAULT_RETENTION_IN_DAYS).toBe(30);
    expect(model.partitionKey).toBe("toYYYYMMDD(lastSeenAt)");
    expect(model.ttlExpression).toBe("lastSeenAt + INTERVAL 30 DAY DELETE");
    // A day's rows expire together: the partition is dropped, never rewritten.
    expect(model.tableSettings).toBe("ttl_only_drop_parts = 1");
  });

  test("boot creates it with exactly that (the statement TableManegement runs)", () => {
    const statement: Statement = new StatementGenerator<SecurityUserVault>({
      modelType: SecurityUserVault,
      database: ClickhouseAppInstance,
    }).toTableCreateStatement();
    const query: string = statement.query.replace(/\s+/g, " ").trim();

    expect(query).toBe(
      "CREATE TABLE IF NOT EXISTS {p0:Identifier}.{p1:Identifier} ON CLUSTER 'oneuptime' ( projectId String, token String CODEC(ZSTD(1)), userValue String CODEC(ZSTD(1)), firstSeenAt SimpleAggregateFunction(min, DateTime), lastSeenAt SimpleAggregateFunction(max, DateTime) ) ENGINE = ReplicatedAggregatingMergeTree PARTITION BY (toYYYYMMDD(lastSeenAt)) PRIMARY KEY ({p2:Identifier}, {p3:Identifier}) ORDER BY ({p4:Identifier}, {p5:Identifier}, {p6:Identifier}) TTL lastSeenAt + INTERVAL 30 DAY DELETE SETTINGS ttl_only_drop_parts = 1",
    );
    expect(statement.query_params).toEqual({
      p0: "oneuptime",
      p1: "SecurityUserVaultV1Local",
      p2: "projectId",
      p3: "token",
      p4: "projectId",
      p5: "token",
      p6: "userValue",
    });
    // Nothing of a row but the five: no _id, no createdAt.
    expect(query).not.toContain("_id");
    expect(query).not.toContain("createdAt");
  });
});

describe("nothing generic reaches the vault", () => {
  const model: SecurityUserVault = new SecurityUserVault();

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
        SecurityUserVault,
        SecurityUserVaultServiceClass
      >(SecurityUserVault, SecurityUserVaultService);
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
    expect(AnalyticsServices).toContain(SecurityUserVaultService);
  });

  const refusedReads: Array<{ name: string; call: () => Promise<unknown> }> = [
    {
      name: "findBy",
      call: (): Promise<unknown> => {
        return SecurityUserVaultService.findBy({
          query: {},
          select: { userValue: true },
          skip: 0,
          limit: 10,
          props: { isRoot: true },
        });
      },
    },
    {
      name: "findOneBy",
      call: (): Promise<unknown> => {
        return SecurityUserVaultService.findOneBy({
          query: {},
          select: { userValue: true },
          props: { isRoot: true },
        });
      },
    },
    {
      name: "findOneById",
      call: (): Promise<unknown> => {
        return SecurityUserVaultService.findOneById({
          id: ObjectID.generate(),
          select: { userValue: true },
          props: { isRoot: true },
        });
      },
    },
    {
      name: "countBy",
      call: (): Promise<unknown> => {
        return SecurityUserVaultService.countBy({
          query: {},
          props: { isRoot: true },
        });
      },
    },
    {
      name: "existsBy",
      call: (): Promise<unknown> => {
        return SecurityUserVaultService.existsBy({
          query: {},
          props: { isRoot: true },
        });
      },
    },
    {
      name: "aggregateBy",
      call: (): Promise<unknown> => {
        return SecurityUserVaultService.aggregateBy({} as never);
      },
    },
    {
      name: "countDistinctNonEmpty",
      call: (): Promise<unknown> => {
        return SecurityUserVaultService.countDistinctNonEmpty({
          query: {},
          expression: "userValue",
          props: { isRoot: true },
        });
      },
    },
    {
      name: "countPerWindow",
      call: (): Promise<unknown> => {
        return SecurityUserVaultService.countPerWindow({
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
        return SecurityUserVaultService.countPerValueInWindows({
          query: {},
          valueColumnName: "userValue",
          timeColumnName: "lastSeenAt",
          windows: [],
          props: { isRoot: true },
        });
      },
    },
    {
      name: "groupTelemetryUsageByService",
      call: (): Promise<unknown> => {
        return SecurityUserVaultService.groupTelemetryUsageByService({
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
        return SecurityUserVaultService.getDaysWithRows({
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
      const query: Spy = getJestSpyOn(SecurityUserVaultService, "executeQuery");

      await expect(call()).rejects.toThrow(SECURITY_USER_VAULT_REFUSAL);
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
        (SecurityUserVaultServiceClass.prototype as unknown as JSONObject)[
          name
        ],
      ).not.toBe(
        (AnalyticsDatabaseService.prototype as unknown as JSONObject)[name],
      );
    }
  });
});

describe("the rows ingest writes", () => {
  test("a token and the user behind it, first and last seen when written", () => {
    expect(
      SecurityUserVaultServiceClass.toRows({
        projectId: PROJECT_ID,
        entries: [
          { token: TOKEN_A, user: "mallory@acme.com" },
          { token: TOKEN_B, user: "arn:aws:iam::123456789012:user/deploy" },
        ],
        seenAt: NOW,
      }),
    ).toEqual([
      {
        projectId: PROJECT_ID.toString(),
        token: TOKEN_A,
        userValue: "mallory@acme.com",
        firstSeenAt: "2026-11-20 12:00:00",
        lastSeenAt: "2026-11-20 12:00:00",
      },
      {
        projectId: PROJECT_ID.toString(),
        token: TOKEN_B,
        userValue: "arn:aws:iam::123456789012:user/deploy",
        firstSeenAt: "2026-11-20 12:00:00",
        lastSeenAt: "2026-11-20 12:00:00",
      },
    ]);
  });

  test.each([
    [
      "an older 8-hex token, which no rule makes now",
      LEGACY_TOKEN,
      "mallory@acme.com",
    ],
    ["what Redact leaves", "[REDACTED]", "mallory@acme.com"],
    ["a token in capitals", "[HASHED:01580765CB52614A]", "mallory@acme.com"],
    ["a token inside text", `auth0|${TOKEN_A}`, "mallory@acme.com"],
    ["an empty user", TOKEN_A, ""],
    ["a user of only spaces", TOKEN_A, "   "],
    ["a user Redact hid", TOKEN_A, "[REDACTED]"],
    ["a user a mask hid", TOKEN_A, "m***@***.com"],
    ["a user that is a token itself", TOKEN_A, TOKEN_B],
    ["a user holding a token", TOKEN_A, `auth0|${TOKEN_B}`],
    ["a user longer than any user is", TOKEN_A, "x".repeat(513)],
  ])("%s is no row", (_label: string, token: string, user: string) => {
    expect(
      SecurityUserVaultServiceClass.toRows({
        projectId: PROJECT_ID,
        entries: [{ token, user }],
        seenAt: NOW,
      }),
    ).toEqual([]);
  });

  test("a user as long as one may be is kept, and a user is whatever names one", () => {
    expect(
      SecurityUserVaultServiceClass.toRows({
        projectId: PROJECT_ID,
        entries: [
          { token: TOKEN_A, user: "x".repeat(MAX_USER_VAULT_USER_LENGTH) },
        ],
        seenAt: NOW,
      }),
    ).toHaveLength(1);
    expect(isUserVaultUser("auth0|5f7c8ec7c33c6c004bbafe82")).toBe(true);
    expect(isUserVaultUser("CORP\\jane")).toBe(true);
    expect(isUserVaultUser("root")).toBe(true);
  });
});

describe("the one read: the users behind a page's tokens", () => {
  test("one query, for the project and its tokens, seen in the last 30 days", async () => {
    const spy: Spy = stubExecuteQuery([
      [
        { token: TOKEN_A, vaultUsers: ["mallory@acme.com"] },
        { token: TOKEN_B, vaultUsers: ["auth0|5f7c8ec7"] },
      ],
    ]);

    const found: Map<string, string> =
      await SecurityUserVaultService.findUsersOfTokens({
        projectId: PROJECT_ID,
        tokens: [TOKEN_A, TOKEN_B, TOKEN_A],
        now: NOW,
      });

    expect(Array.from(found.entries())).toEqual([
      [TOKEN_A, "mallory@acme.com"],
      [TOKEN_B, "auth0|5f7c8ec7"],
    ]);
    expect(spy).toHaveBeenCalledTimes(1);

    const statement: Statement = statementOf(spy);

    expect(statement.query).toBe(
      "SELECT token, groupUniqArray(2)(userValue) AS vaultUsers FROM oneuptime.SecurityUserVaultV1 WHERE projectId = {p0:String} AND token IN ({p1:Array(String)}) AND lastSeenAt >= {p2:DateTime} GROUP BY token SETTINGS max_execution_time = 10, timeout_overflow_mode = 'throw', max_memory_usage = 3221225472, max_bytes_before_external_group_by = 1610612736, max_bytes_before_external_sort = 1610612736",
    );
    expect(statement.query_params).toEqual({
      p0: PROJECT_ID.toString(),
      p1: [TOKEN_A, TOKEN_B],
      p2: "2026-10-21 12:00:00",
    });
  });

  test("its alias spells no column the statement reads (ClickhouseAliasShadowGuard)", () => {
    const query: string = SecurityUserVaultService.toFindUsersStatement({
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
      await SecurityUserVaultService.findUsersOfTokens({
        projectId: PROJECT_ID,
        tokens: [
          LEGACY_TOKEN,
          "[REDACTED]",
          "m***@***.com",
          "mallory@acme.com",
        ],
        now: NOW,
      });

    expect(found.size).toBe(0);
    expect(spy).not.toHaveBeenCalled();
  });

  test("a token with two users - a 64-bit collision - names neither", async () => {
    stubExecuteQuery([
      [
        { token: TOKEN_A, vaultUsers: ["mallory@acme.com", "eve@acme.com"] },
        { token: TOKEN_B, vaultUsers: ["auth0|5f7c8ec7"] },
      ],
    ]);

    const found: Map<string, string> =
      await SecurityUserVaultService.findUsersOfTokens({
        projectId: PROJECT_ID,
        tokens: [TOKEN_A, TOKEN_B],
        now: NOW,
      });

    expect(found.has(TOKEN_A)).toBe(false);
    expect(found.get(TOKEN_B)).toBe("auth0|5f7c8ec7");
  });

  test("names only a user, and only for a token it asked about", async () => {
    stubExecuteQuery([
      [
        { token: TOKEN_A, vaultUsers: ["[REDACTED]"] },
        { token: TOKEN_B, vaultUsers: [] },
        { token: "[HASHED:aaaaaaaaaaaaaaaa]", vaultUsers: ["eve@acme.com"] },
      ],
    ]);

    const found: Map<string, string> =
      await SecurityUserVaultService.findUsersOfTokens({
        projectId: PROJECT_ID,
        tokens: [TOKEN_A, TOKEN_B],
        now: NOW,
      });

    expect(found.size).toBe(0);
  });

  test("a page of more tokens than one query names is read MAX_TOKENS_PER_USER_VAULT_LOOKUP at a time", async () => {
    const tokens: Array<string> = [];

    for (
      let index: number = 0;
      index < MAX_TOKENS_PER_USER_VAULT_LOOKUP + 5;
      index++
    ) {
      tokens.push(`[HASHED:${index.toString(16).padStart(15, "0")}a]`);
    }

    const spy: Spy = stubExecuteQuery([
      [{ token: tokens[0]!, vaultUsers: ["first@acme.com"] }],
      [{ token: tokens[tokens.length - 1]!, vaultUsers: ["last@acme.com"] }],
    ]);

    const found: Map<string, string> =
      await SecurityUserVaultService.findUsersOfTokens({
        projectId: PROJECT_ID,
        tokens,
        now: NOW,
      });

    expect(spy).toHaveBeenCalledTimes(2);
    expect(
      (statementOf(spy, 0).query_params["p1"] as Array<string>).length,
    ).toBe(MAX_TOKENS_PER_USER_VAULT_LOOKUP);
    expect(
      (statementOf(spy, 1).query_params["p1"] as Array<string>).length,
    ).toBe(5);
    expect(found.get(tokens[0]!)).toBe("first@acme.com");
    expect(found.get(tokens[tokens.length - 1]!)).toBe("last@acme.com");
  });

  test("a read that fails is the caller's to catch", async () => {
    getJestSpyOn(
      SecurityUserVaultService.database,
      "getDatasourceOptions",
    ).mockReturnValue({ database: DATABASE_NAME } as never);
    getJestSpyOn(SecurityUserVaultService, "executeQuery").mockRejectedValue(
      new Error("ClickHouse is down") as never,
    );

    await expect(
      SecurityUserVaultService.findUsersOfTokens({
        projectId: PROJECT_ID,
        tokens: [TOKEN_A],
        now: NOW,
      }),
    ).rejects.toThrow("ClickHouse is down");
  });

  test("the window is exactly the vault's 30 days before now", () => {
    expect(
      SecurityUserVaultServiceClass.getOldestNameableTime(NOW).toISOString(),
    ).toBe("2026-10-21T12:00:00.000Z");
  });

  test("a project's tokens are looked up in that project only", async () => {
    const other: ObjectID = new ObjectID(
      "10632000-0000-4000-8000-000000000002",
    );
    const spy: Spy = stubExecuteQuery([[]]);

    await SecurityUserVaultService.findUsersOfTokens({
      projectId: other,
      tokens: [TOKEN_A],
      now: NOW,
    });

    expect(statementOf(spy).query_params["p0"]).toBe(other.toString());
    expect(statementOf(spy).query).toContain("WHERE projectId = {p0:String}");
  });

  test("the tokens are named as a list, never spliced into the query", () => {
    const statement: Statement = SecurityUserVaultService.toFindUsersStatement({
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
