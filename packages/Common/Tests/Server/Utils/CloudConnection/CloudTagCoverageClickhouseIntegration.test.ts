import {
  setTimeout as nodeSetTimeout,
  clearTimeout as nodeClearTimeout,
} from "timers";
import { createClient, ClickHouseClient } from "@clickhouse/client";
import ChangeEvent from "../../../../Models/AnalyticsModels/ChangeEvent";
import CloudCost from "../../../../Models/AnalyticsModels/CloudCost";
import AnalyticsBaseModel from "../../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import ClickhouseDatabase from "../../../../Server/Infrastructure/ClickhouseDatabase";
import {
  ClickhousePassword,
  ClickhouseUsername,
} from "../../../../Server/EnvironmentConfig";
import StatementGenerator from "../../../../Server/Utils/AnalyticsDatabase/StatementGenerator";
import {
  SQL,
  Statement,
} from "../../../../Server/Utils/AnalyticsDatabase/Statement";
import {
  getCostAllTagsCondition,
  getCostTagCondition,
} from "../../../../Server/Utils/CloudConnection/CloudTagConditions";
import CloudTagCoverageReader from "../../../../Server/Utils/CloudConnection/CloudTagCoverageReader";
import CloudTagCreators from "../../../../Server/Utils/CloudConnection/CloudTagCreators";
import TableColumnType from "../../../../Types/AnalyticsDatabase/TableColumnType";
import {
  CloudRequiredTagRule,
  evaluateCloudTags,
  findAllowedCloudTagValue,
  getCloudRequiredTagsForAccount,
} from "../../../../Types/Cloud/CloudRequiredTags";
import {
  CloudCreateCall,
  findCloudCreateCall,
} from "../../../../Types/Cloud/CloudResourceCreator";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import {
  ChangeEventAttribute,
  ChangeEventSource,
  ChangeEventStatus,
} from "../../../../Utils/Telemetry/ChangeEventFields";
import { seededRandom, SeededRandom } from "../../../Helpers/SeededRandom";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * REQUIRED TAGS ON A REAL CLICKHOUSE (#11012). What the coverage pages,
 * the daily count and the watcher call "carries the tag" is said twice:
 * in code (findAllowedCloudTagValue) and as ClickHouse SQL over a cost's
 * tags map (getCostTagCondition). Here they are held to one meaning, on
 * the CloudCost table the model creates: the key in any case, a blank
 * value no value, an allowed value in any case - accented and Cyrillic
 * too - a pattern's `*` and `?`, and LIKE's own `%`, `_` and `\` only
 * themselves. Then the statements Cloud > Tags reads by: each account's
 * spend by its own required tags (an account's own tag over the
 * project's), the weekly trend, and the change events that say who
 * created a resource, by any resource a call names.
 *
 * Opt in against a local ClickHouse server, for example
 *   docker run --rm -p 127.0.0.1:8193:8123 -e CLICKHOUSE_PASSWORD=test clickhouse/clickhouse-server:26.7
 * then TEST_CLICKHOUSE_URL=http://localhost:8193 CLICKHOUSE_PASSWORD=test npx jest <this file>.
 * The suite creates and removes only its own uniquely named database.
 */
const endpoint: string | undefined = process.env["TEST_CLICKHOUSE_URL"];
jest.setTimeout(240000);

const integration: typeof describe.skip = endpoint ? describe : describe.skip;
const database: string = `cloud_tags_${process.pid}_${Date.now()}`;
let client: ClickHouseClient;

const PROJECT: ObjectID = new ObjectID("11012000-0000-4000-8000-0000000000a1");
const OTHER_PROJECT: ObjectID = new ObjectID(
  "11012000-0000-4000-8000-0000000000a2",
);
const ACCOUNT_A: string = "11012000-0000-4000-8000-0000000000b1";
const ACCOUNT_B: string = "11012000-0000-4000-8000-0000000000b2";
const CONNECTION: string = "11012000-0000-4000-8000-0000000000c1";

const testDatabase: ClickhouseDatabase = {
  getDatasourceOptions: (): { database: string } => {
    return { database };
  },
} as unknown as ClickhouseDatabase;

async function run(statement: Statement): Promise<Array<JSONObject>> {
  const result: { data?: Array<JSONObject> } = (await (
    await client.query({
      query: statement.query,
      query_params: statement.query_params,
      format: "JSON",
    })
  ).json()) as { data?: Array<JSONObject> };

  return result.data || [];
}

async function createTable(model: AnalyticsBaseModel): Promise<void> {
  const columns: Statement = new StatementGenerator<AnalyticsBaseModel>({
    modelType: model.constructor as { new (): AnalyticsBaseModel },
    database: testDatabase,
  }).toColumnsCreateStatement(model.tableColumns);

  await client.command({
    query: `CREATE TABLE ${database}.${model.tableName} (${columns.query}) ENGINE = MergeTree PARTITION BY (${model.partitionKey}) ORDER BY (${model.sortKeys.join(", ")})`,
    query_params: columns.query_params,
  });
}

interface CostRow {
  account: string;
  day: string;
  cost: number;
  currency?: string;
  resourceId: string;
  tags: Record<string, string>;
}

async function insertCosts(
  rows: Array<CostRow>,
  projectId: ObjectID = PROJECT,
): Promise<void> {
  await client.insert({
    table: new CloudCost().tableName,
    values: rows.map((row: CostRow): JSONObject => {
      return {
        projectId: projectId.toString(),
        cloudAccountId: row.account,
        cloudConnectionId: CONNECTION,
        provider: "aws",
        accountId: "123456789012",
        day: row.day,
        service: "Amazon EC2",
        region: "eu-west-1",
        resourceId: row.resourceId,
        cost: row.cost,
        currency: row.currency || "USD",
        readAt: "2026-11-21 00:00:00",
        tags: row.tags,
      };
    }),
    format: "JSONEachRow",
    clickhouse_settings: { async_insert: 0 },
  });
}

function rule(
  key: string,
  allowedValues: Array<string> = [],
  cloudAccountId: string | null = null,
): CloudRequiredTagRule {
  return { id: `${key}|${allowedValues.join(",")}`, key, allowedValues, cloudAccountId };
}

// The resources (by their resourceId) whose costs carry what the condition asks.
async function resourcesWhere(
  condition: Statement,
  prefix: string,
): Promise<Array<string>> {
  const statement: Statement = SQL`SELECT DISTINCT resourceId FROM ${new CloudCost().tableName} WHERE projectId = ${{
    type: TableColumnType.ObjectID,
    value: PROJECT,
  }} AND startsWith(resourceId, ${{
    type: TableColumnType.Text,
    value: prefix,
  }}) AND `;
  statement.append(condition);
  statement.append(SQL` ORDER BY resourceId`);

  return (await run(statement)).map((row: JSONObject): string => {
    return String(row["resourceId"]);
  });
}

// The tags maps the meaning is held to, by hand: every edge the code names.
const HANDPICKED_TAGS: Array<Record<string, string>> = [
  {},
  { team: "payments" },
  { Team: "Payments" },
  { TEAM: " payments " },
  { team: "" },
  { team: "   " },
  { team: "unknown", Team: "payments" },
  { team: "platform-core" },
  { team: "platform-" },
  { team: "Platform-X" },
  { team: "xplatform-core" },
  { env: "prod-eu" },
  { env: "PROD-12" },
  { env: "prod-1" },
  { env: "prod_eu" },
  { env: "100%" },
  { env: "100x" },
  { team: "équipe" },
  { team: "ÉQUIPE" },
  { team: "команда" },
  { team: "КОМАНДА" },
  { "cost-center": "4711" },
  { "Cost-Center": "  " },
  { team: "a\\b" },
  { team: "a_b" },
  { team: "axb" },
  { owner: "payments" },
  { team: "payments", env: "prod-eu", "cost-center": "4711" },
];

const HANDPICKED_RULES: Array<CloudRequiredTagRule> = [
  rule("team"),
  rule("TEAM", ["payments", "platform-*", "équipe", "команда"]),
  rule("env", ["prod-*", "100%"]),
  rule("env", ["prod-??"]),
  rule("team", ["a_b", "a\\b"]),
  rule("team", ["*_*"]),
  rule("cost-center"),
  rule("owner", ["*"]),
];

integration("required tags on ClickHouse", () => {
  beforeAll(async (): Promise<void> => {
    // The real ClickHouse HTTP client needs Node timers with unref().
    jest.spyOn(globalThis, "setTimeout").mockImplementation(nodeSetTimeout);
    jest.spyOn(globalThis, "clearTimeout").mockImplementation(nodeClearTimeout);

    const url: URL = new URL(endpoint!);

    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
      throw new Error(
        "This integration suite requires a local ClickHouse server.",
      );
    }

    const admin: ClickHouseClient = createClient({
      url: endpoint!,
      username: ClickhouseUsername,
      password: ClickhousePassword,
      request_timeout: 120000,
    });
    await admin.command({ query: `CREATE DATABASE ${database}` });
    await admin.close();

    client = createClient({
      url: endpoint!,
      username: ClickhouseUsername,
      password: ClickhousePassword,
      database,
      request_timeout: 120000,
    });

    await createTable(new CloudCost());
    await createTable(new ChangeEvent());
  });

  afterAll(async (): Promise<void> => {
    if (client) {
      try {
        await client.command({
          query: `DROP DATABASE IF EXISTS ${database} SYNC`,
        });
      } finally {
        await client.close();
        jest.restoreAllMocks();
      }
    }
  });

  test("a cost carries a required tag exactly when code says it does, edge by edge", async () => {
    await insertCosts(
      HANDPICKED_TAGS.map(
        (tags: Record<string, string>, index: number): CostRow => {
          return {
            account: ACCOUNT_A,
            day: "2026-11-19",
            cost: 1,
            resourceId: `hand-${String(index).padStart(3, "0")}`,
            tags,
          };
        },
      ),
    );

    for (const required of HANDPICKED_RULES) {
      const expected: Array<string> = HANDPICKED_TAGS.map(
        (tags: Record<string, string>, index: number): string | null => {
          return findAllowedCloudTagValue(tags, required)
            ? `hand-${String(index).padStart(3, "0")}`
            : null;
        },
      ).filter((id: string | null): id is string => {
        return id !== null;
      });

      expect({
        rule: required.id,
        carrying: await resourcesWhere(getCostTagCondition(required), "hand-"),
      }).toEqual({ rule: required.id, carrying: expected });
    }

    // Every rule of a set at once: what a resource lacking none carries.
    const all: Array<CloudRequiredTagRule> = [
      rule("team", ["payments"]),
      rule("env", ["prod-*"]),
      rule("cost-center"),
    ];
    expect(await resourcesWhere(getCostAllTagsCondition(all), "hand-")).toEqual(
      HANDPICKED_TAGS.map(
        (tags: Record<string, string>, index: number): string | null => {
          return evaluateCloudTags(tags, all).length === 0
            ? `hand-${String(index).padStart(3, "0")}`
            : null;
        },
      ).filter((id: string | null): id is string => {
        return id !== null;
      }),
    );
    // No rule at all: every cost carries what none asks for.
    expect(
      (await resourcesWhere(getCostAllTagsCondition([]), "hand-")).length,
    ).toBe(HANDPICKED_TAGS.length);
  });

  /*
   * Drawn tags and drawn rules - keys in every case, values and patterns
   * from an alphabet with LIKE's own characters in it - held to the code's
   * answer, 300 resources against 60 rules.
   */
  test("a cost carries a required tag exactly when code says it does, over drawn tags and rules", async () => {
    const random: SeededRandom = seededRandom(11012);
    const keys: Array<string> = ["team", "Team", "TEAM", "env", "Env", "owner"];
    const letters: Array<string> = ["a", "B", "-", "_", "%", "\\", " ", "é"];
    const drawText: (longest: number, alphabet: Array<string>) => string = (
      longest: number,
      alphabet: Array<string>,
    ): string => {
      let text: string = "";
      const length: number = random(longest + 1);

      for (let index = 0; index < length; index++) {
        text += alphabet[random(alphabet.length)];
      }

      return text;
    };
    const drawn: Array<Record<string, string>> = [];

    for (let index = 0; index < 300; index++) {
      const tags: Record<string, string> = {};
      const count: number = random(4);

      for (let tag = 0; tag < count; tag++) {
        tags[keys[random(keys.length)]!] = drawText(4, letters);
      }

      drawn.push(tags);
    }

    await insertCosts(
      drawn.map((tags: Record<string, string>, index: number): CostRow => {
        return {
          account: ACCOUNT_A,
          day: "2026-11-19",
          cost: 1,
          resourceId: `drawn-${String(index).padStart(4, "0")}`,
          tags,
        };
      }),
    );

    for (let index = 0; index < 60; index++) {
      const allowed: Array<string> = [];
      const valueCount: number = random(3);

      for (let value = 0; value < valueCount; value++) {
        allowed.push(drawText(3, [...letters, "*", "?"]));
      }

      const required: CloudRequiredTagRule = rule(
        keys[random(keys.length)]!,
        allowed,
      );
      const expected: Array<string> = drawn
        .map((tags: Record<string, string>, row: number): string | null => {
          return findAllowedCloudTagValue(tags, required)
            ? `drawn-${String(row).padStart(4, "0")}`
            : null;
        })
        .filter((id: string | null): id is string => {
          return id !== null;
        });

      expect({
        rule: required,
        carrying: await resourcesWhere(getCostTagCondition(required), "drawn-"),
      }).toEqual({ rule: required, carrying: expected });
    }
  });

  test("each account's spend by its own required tags: an account's own tag replaces the project's", async () => {
    const rules: Array<CloudRequiredTagRule> = [
      rule("team", ["payments", "search"]),
      rule("env"),
      // Account B requires its own team values, and an owner as well.
      rule("Team", ["platform"], ACCOUNT_B),
      rule("owner", [], ACCOUNT_B),
    ];
    const rows: Array<CostRow> = [
      // A: covered, not covered (env missing), untaggable (no id, no tags).
      {
        account: ACCOUNT_A,
        day: "2026-11-10",
        cost: 40,
        resourceId: "spend-a1",
        tags: { team: "payments", env: "prod" },
      },
      {
        account: ACCOUNT_A,
        day: "2026-11-11",
        cost: 25.5,
        resourceId: "spend-a2",
        tags: { Team: "Search" },
      },
      {
        account: ACCOUNT_A,
        day: "2026-11-12",
        cost: 10,
        resourceId: "",
        tags: {},
      },
      // B: its own team value, with owner and env: covered by its rules.
      {
        account: ACCOUNT_B,
        day: "2026-11-12",
        cost: 30,
        resourceId: "spend-b1",
        tags: { team: "platform", owner: "alice", env: "prod" },
      },
      // B: the project's value, which B's own tag does not allow.
      {
        account: ACCOUNT_B,
        day: "2026-11-13",
        cost: 20,
        resourceId: "spend-b2",
        tags: { team: "payments", owner: "bob", env: "prod" },
      },
      // Outside the period, another currency, another project: not counted with these.
      {
        account: ACCOUNT_A,
        day: "2026-10-01",
        cost: 999,
        resourceId: "spend-old",
        tags: { team: "payments", env: "prod" },
      },
      {
        account: ACCOUNT_A,
        day: "2026-11-14",
        cost: 7,
        currency: "EUR",
        resourceId: "spend-eur",
        tags: { team: "payments", env: "prod" },
      },
    ];

    await insertCosts(rows);
    await insertCosts(
      [
        {
          account: ACCOUNT_A,
          day: "2026-11-12",
          cost: 500,
          resourceId: "spend-other",
          tags: { team: "payments", env: "prod" },
        },
      ],
      OTHER_PROJECT,
    );

    const result: Array<JSONObject> = await run(
      CloudTagCoverageReader.buildSpendStatement({
        projectId: PROJECT,
        accountIds: [ACCOUNT_A, ACCOUNT_B],
        rules,
        start: new Date("2026-11-01T00:00:00.000Z"),
        end: new Date("2026-11-16T00:00:00.000Z"),
      }),
    );
    const byAccount: Map<string, JSONObject> = new Map();

    for (const row of result) {
      // The hand and drawn rows of the earlier tests are on 2026-11-19, after the period.
      byAccount.set(`${String(row["account"])}|${String(row["currencyCode"])}`, row);
    }

    // What code says, over the same rows.
    const expectFor: (account: string, currency: string) => JSONObject = (
      account: string,
      currency: string,
    ): JSONObject => {
      const own: Array<CloudRequiredTagRule> = getCloudRequiredTagsForAccount(
        rules,
        account,
      );
      const inPeriod: Array<CostRow> = rows.filter((row: CostRow): boolean => {
        return (
          row.account === account &&
          (row.currency || "USD") === currency &&
          row.day >= "2026-11-01" &&
          row.day < "2026-11-16"
        );
      });
      const sum: (filter: (row: CostRow) => boolean) => number = (
        filter: (row: CostRow) => boolean,
      ): number => {
        return inPeriod.filter(filter).reduce((total: number, row: CostRow) => {
          return total + row.cost;
        }, 0);
      };
      const expected: JSONObject = {
        total: sum(() => {
          return true;
        }),
        taggable: sum((row: CostRow): boolean => {
          return row.resourceId !== "" || Object.keys(row.tags).length > 0;
        }),
        covered: sum((row: CostRow): boolean => {
          return evaluateCloudTags(row.tags, own).length === 0;
        }),
      };

      rules.forEach((each: CloudRequiredTagRule, index: number) => {
        expected[`r${index}`] = sum((row: CostRow): boolean => {
          return Boolean(findAllowedCloudTagValue(row.tags, each));
        });
      });

      return expected;
    };

    for (const [account, currency] of [
      [ACCOUNT_A, "USD"],
      [ACCOUNT_A, "EUR"],
      [ACCOUNT_B, "USD"],
    ] as Array<[string, string]>) {
      const row: JSONObject | undefined = byAccount.get(`${account}|${currency}`);
      const expected: JSONObject = expectFor(account, currency);
      const got: JSONObject = {};

      for (const key of Object.keys(expected)) {
        got[key] = Math.round(Number(row?.[key]) * 100) / 100;
      }

      expect({ account, currency, ...got }).toEqual({
        account,
        currency,
        ...expected,
      });
    }

    // B's own tag: its covered spend is the platform team's, never the project's payments.
    expect(Number(byAccount.get(`${ACCOUNT_B}|USD`)?.["covered"])).toBe(30);
    // A by the project's rules: the payments row with env.
    expect(Number(byAccount.get(`${ACCOUNT_A}|USD`)?.["covered"])).toBe(40);
  });

  test("the trend: each Monday's week, its spend and the part that carries the tags", async () => {
    const rules: Array<CloudRequiredTagRule> = [rule("team", ["payments"])];
    const rows: Array<CostRow> = [
      // The week of Monday 2026-08-03: one covered, one not.
      { account: ACCOUNT_A, day: "2026-08-03", cost: 10, resourceId: "trend-1", tags: { team: "payments" } },
      { account: ACCOUNT_A, day: "2026-08-09", cost: 5, resourceId: "trend-2", tags: {} },
      // The week of Monday 2026-08-10, on its Sunday.
      { account: ACCOUNT_A, day: "2026-08-16", cost: 8, resourceId: "trend-3", tags: { TEAM: "Payments" } },
      // The week of Monday 2026-08-17.
      { account: ACCOUNT_B, day: "2026-08-17", cost: 4, resourceId: "trend-4", tags: { team: "search" } },
    ];

    await insertCosts(rows);

    const weeks: Array<JSONObject> = await run(
      CloudTagCoverageReader.buildTrendStatement({
        projectId: PROJECT,
        accountIds: [ACCOUNT_A, ACCOUNT_B],
        rules,
        currency: "USD",
        start: new Date("2026-08-03T00:00:00.000Z"),
        end: new Date("2026-08-24T00:00:00.000Z"),
      }),
    );

    expect(
      weeks.map((week: JSONObject) => {
        return {
          week: week["week"],
          total: Number(week["total"]),
          covered: Number(week["covered"]),
        };
      }),
    ).toEqual([
      { week: "2026-08-03", total: 15, covered: 10 },
      { week: "2026-08-10", total: 8, covered: 8 },
      { week: "2026-08-17", total: 4, covered: 0 },
    ]);
  });

  test("who created a resource: the change events that name it by its row, its first resource or any resource the call names", async () => {
    const resourceRow: string = "11012000-0000-4000-8000-0000000000d1";
    const instance: string = "i-0abc123def4567890";
    const event: (data: {
      time: string;
      operation: string;
      actor: string;
      attributes?: Record<string, string>;
      projectId?: ObjectID;
      source?: string;
    }) => JSONObject = (data: {
      time: string;
      operation: string;
      actor: string;
      attributes?: Record<string, string>;
      projectId?: ObjectID;
      source?: string;
    }): JSONObject => {
      return {
        projectId: (data.projectId || PROJECT).toString(),
        time: data.time,
        eventType: "config-change",
        title: data.operation,
        description: "",
        attributes: {
          [ChangeEventAttribute.Source]: data.source || ChangeEventSource.Cloud,
          [ChangeEventAttribute.Status]: ChangeEventStatus.Succeeded,
          [ChangeEventAttribute.CloudProvider]: "aws",
          [ChangeEventAttribute.CloudOperation]: data.operation,
          [ChangeEventAttribute.CloudActor]: data.actor,
          ...(data.attributes || {}),
        },
        attributeKeys: [],
        retentionDate: "2027-01-01",
      };
    };

    await client.insert({
      table: new ChangeEvent().tableName,
      values: [
        // By the row it was tied to.
        event({
          time: "2026-11-20 10:05:00.000",
          operation: "ec2:CreateTags",
          actor: "tagger@example.com",
          attributes: { [ChangeEventAttribute.ResourceId]: resourceRow },
        }),
        // By its first resource, in any case.
        event({
          time: "2026-11-20 10:00:00.000",
          operation: "ec2:RunInstances",
          actor: "AWSReservedSSO_Admin_0abc/alice@example.com",
          attributes: {
            [ChangeEventAttribute.CloudResourceId]: instance.toUpperCase(),
          },
        }),
        // By the second of the resources a call names.
        event({
          time: "2026-11-20 09:55:00.000",
          operation: "ec2:RunInstances",
          actor: "bob@example.com",
          attributes: {
            [ChangeEventAttribute.CloudResourceId]: "i-0first",
            [ChangeEventAttribute.CloudResourceIds]: `i-0first\n${instance}`,
          },
        }),
        // Not this resource; another project's; not a cloud change; outside the window.
        event({
          time: "2026-11-20 10:01:00.000",
          operation: "ec2:RunInstances",
          actor: "carol@example.com",
          attributes: { [ChangeEventAttribute.CloudResourceId]: "i-0other" },
        }),
        event({
          time: "2026-11-20 10:02:00.000",
          operation: "ec2:RunInstances",
          actor: "dave@example.com",
          projectId: OTHER_PROJECT,
          attributes: { [ChangeEventAttribute.CloudResourceId]: instance },
        }),
        event({
          time: "2026-11-20 10:03:00.000",
          operation: "deploy",
          actor: "erin@example.com",
          source: "github",
          attributes: { [ChangeEventAttribute.CloudResourceId]: instance },
        }),
        event({
          time: "2026-11-19 01:00:00.000",
          operation: "ec2:RunInstances",
          actor: "frank@example.com",
          attributes: { [ChangeEventAttribute.CloudResourceId]: instance },
        }),
      ],
      format: "JSONEachRow",
      clickhouse_settings: { async_insert: 0 },
    });

    const calls: Array<CloudCreateCall> = CloudTagCreators.readCalls(
      await run(
        CloudTagCreators.buildCallsStatement({
          projectId: PROJECT,
          start: new Date("2026-11-20T06:00:00.000Z"),
          end: new Date("2026-11-20T12:00:00.000Z"),
          resourceRowIds: [resourceRow],
          logIds: [
            `arn:aws:ec2:eu-west-1:123456789012:instance/${instance}`,
            instance,
          ],
        }),
      ),
    );

    // Oldest first, each with what it names.
    expect(
      calls.map((found: CloudCreateCall) => {
        return { actor: found.actor, time: found.time.toISOString() };
      }),
    ).toEqual([
      { actor: "bob@example.com", time: "2026-11-20T09:55:00.000Z" },
      {
        actor: "AWSReservedSSO_Admin_0abc/alice@example.com",
        time: "2026-11-20T10:00:00.000Z",
      },
      { actor: "tagger@example.com", time: "2026-11-20T10:05:00.000Z" },
    ]);
    expect(calls[0]!.resourceIds).toEqual(["i-0first", instance]);
    expect(calls[2]!.resourceRowId).toBe(resourceRow);

    // The creation is the earliest create call: Bob's, who launched it with another.
    expect(
      findCloudCreateCall({
        calls,
        resourceRowId: resourceRow,
        resourceIds: [instance],
      })?.actor,
    ).toBe("bob@example.com");
  });
});
