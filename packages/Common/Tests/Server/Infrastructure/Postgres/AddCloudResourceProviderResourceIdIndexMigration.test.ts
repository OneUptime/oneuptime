import CloudResource from "../../../../Models/DatabaseModels/CloudResource";
import OnlineDdl, {
  OnlineIndex,
} from "../../../../Server/Infrastructure/Postgres/OnlineDdl";
import { AddCloudResourceProviderResourceIdIndex1809186900000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809186900000-AddCloudResourceProviderResourceIdIndex";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import QueryHelper from "../../../../Server/Types/Database/QueryHelper";
import { QueryRunner, getMetadataArgsStorage } from "typeorm";
import type { IndexMetadataArgs } from "typeorm/metadata-args/IndexMetadataArgs";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * THE INDEX CONNECTED SIGNALS FINDS A CLOUD RESOURCE BY ITS OWN ID WITH
 * (#10034, #10033).
 *
 * A security event names a cloud resource by its ID - an ARN, an Azure
 * resource ID, a Google Cloud full resource name - and an event read from a
 * resource's own logs carries the ID its stream stamped. Connected Signals
 * looks each up as LOWER("providerResourceId") IN (...): an Azure ID
 * whatever its case, the rows then held to each cloud's own rule. This is
 * the index that lookup uses - a HASH index on that very expression, built
 * online - which the planner's use of is shown on a real Postgres
 * (SecurityConnectionsPostgres). Here: the migration's statements against a
 * fake QueryRunner (OnlineDdl's own steps recorded as "online: ..."), its
 * place in Index.ts, and the model declaring it by name so no generated
 * migration ever drops it.
 */

const NAME: string = "IDX_CLOUD_RESOURCE_LOWER_PROVIDER_RESOURCE_ID";
const CREATE: string = `CREATE INDEX "${NAME}" ON "CloudResource" USING hash (LOWER("providerResourceId"))`;

async function statementsOf(
  run: (runner: QueryRunner) => Promise<void>,
): Promise<Array<string>> {
  const statements: Array<string> = [];

  for (const step of ["createIndex", "dropIndex"] as const) {
    jest.spyOn(OnlineDdl, step).mockImplementation((async (
      _runner: QueryRunner,
      statement: string,
    ) => {
      statements.push(`online: ${statement}`);
    }) as never);
  }

  await run({
    isTransactionActive: false,
    query: (sql: string): Promise<undefined> => {
      statements.push(sql);
      return Promise.resolve(undefined);
    },
  } as unknown as QueryRunner);

  return statements;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("AddCloudResourceProviderResourceIdIndex1809186900000", () => {
  test("builds the hash index on the lower-cased ID online, outside a transaction - and nothing else", async () => {
    const migration: AddCloudResourceProviderResourceIdIndex1809186900000 =
      new AddCloudResourceProviderResourceIdIndex1809186900000();

    expect(migration.transaction).toBe(false);
    expect(
      await statementsOf((runner: QueryRunner) => {
        return migration.up(runner);
      }),
    ).toEqual([`online: ${CREATE}`]);
  });

  test("OnlineDdl reads the build as one it can run concurrently, its method and expression kept", () => {
    const parsed: OnlineIndex = OnlineDdl.parseCreateIndex(CREATE);

    expect(parsed.name).toBe(NAME);
    expect(parsed.quotedTable).toBe(`"CloudResource"`);
    expect(parsed.build).toContain("CREATE INDEX CONCURRENTLY IF NOT EXISTS");
    expect(parsed.build).toContain(`USING hash (LOWER("providerResourceId"))`);
  });

  test("down() takes it away, online", async () => {
    expect(
      await statementsOf((runner: QueryRunner) => {
        return new AddCloudResourceProviderResourceIdIndex1809186900000().down(
          runner,
        );
      }),
    ).toEqual([`online: DROP INDEX "public"."${NAME}"`]);
  });

  test("is registered once, after the migrations before it, and named for its class", () => {
    const registered: Array<unknown> = SchemaMigrations as Array<unknown>;
    const names: Array<string> = registered.map((migration: unknown) => {
      return (migration as { name: string }).name;
    });

    expect(
      registered.filter((candidate: unknown): boolean => {
        return (
          candidate === AddCloudResourceProviderResourceIdIndex1809186900000
        );
      }),
    ).toHaveLength(1);
    expect(
      names.indexOf("AddCloudResourceProviderResourceIdIndex1809186900000"),
    ).toBeGreaterThan(
      names.indexOf("AddMonitorNetworkDeviceTieSource1809186700000"),
    );
    expect(
      new AddCloudResourceProviderResourceIdIndex1809186900000().name,
    ).toBe("AddCloudResourceProviderResourceIdIndex1809186900000");
  });
});

describe("the model and the lookup say the same", () => {
  test("CloudResource declares the index by name with synchronize: false, so no generated migration drops it", () => {
    const declared: Array<IndexMetadataArgs> =
      getMetadataArgsStorage().indices.filter((index: IndexMetadataArgs) => {
        return index.target === CloudResource && index.name === NAME;
      });

    expect(declared).toHaveLength(1);
    expect(declared[0]!.synchronize).toBe(false);
    expect(declared[0]!.columns).toEqual(["providerResourceId"]);
  });

  test("the lookup compares the very expression the index is built on", () => {
    const operator: { getSql: (alias: string) => string } =
      QueryHelper.findWithSameTextAnyOf([
        "/SUBSCRIPTIONS/1/RESOURCEGROUPS/RG/PROVIDERS/MICROSOFT.WEB/SITES/ORDERS",
      ]) as unknown as { getSql: (alias: string) => string };

    // LOWER(<the column>) IN (...): an equality the hash index answers (= ANY).
    expect(operator.getSql(`"CloudResource"."providerResourceId"`)).toMatch(
      /^\(LOWER\("CloudResource"\."providerResourceId"\) IN \(:\.\.\.[A-Za-z0-9]+\)\)$/,
    );
  });
});
