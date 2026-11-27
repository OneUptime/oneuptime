import { afterEach, describe, expect, jest, test } from "@jest/globals";
import DataStoreService, {
  Service as DataStoreServiceClass,
} from "../../../Server/Services/DataStoreService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import DataStore from "../../../Models/DatabaseModels/DataStore";
import { DataStoreKind } from "../../../Types/DataSecurity/DataStoreKind";
import {
  DataStoreExposure,
  DataStorePostureFacts,
} from "../../../Types/DataSecurity/DataStorePosture";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";

/*
 * A STORE'S CONNECTION STRING, CHECKED FOR ITS KIND, AND A NEW STORE'S
 * EXPOSURE BEFORE ANYTHING READS IT (#11140).
 *
 * The connection string was held to one rule for every kind: a PostgreSQL,
 * MySQL or SQL Server scheme. So an Elasticsearch cluster's address was
 * refused with a sentence about databases, a PostgreSQL string was saved on
 * an Elasticsearch store and never read, a MySQL string was saved on a
 * PostgreSQL store and failed every scan - and OneUptime's own writes were
 * held to it too: Data Observability connecting a MongoDB or Snowflake
 * store it already knew was refused, though its engines read exactly
 * those strings. Now each kind takes what its sampler reads, a kind
 * nothing reads takes none, and OneUptime's own writes are only trimmed.
 *
 * A new store starts Not checked yet, or Can't be checked for a kind
 * nothing reads, never the Unknown of a read that could not tell.
 */

type CreateHook = (
  createBy: CreateBy<DataStore>,
) => Promise<OnCreate<DataStore>>;
type UpdateHook = (
  updateBy: UpdateBy<DataStore>,
) => Promise<OnUpdate<DataStore>>;

function hooks(): { create: CreateHook; update: UpdateHook } {
  const service: { onBeforeCreate: CreateHook; onBeforeUpdate: UpdateHook } =
    DataStoreService as unknown as {
      onBeforeCreate: CreateHook;
      onBeforeUpdate: UpdateHook;
    };

  return {
    create: service.onBeforeCreate.bind(DataStoreService),
    update: service.onBeforeUpdate.bind(DataStoreService),
  };
}

const PERSON: { tenantId: ObjectID; userId: ObjectID } = {
  tenantId: ObjectID.generate(),
  userId: ObjectID.generate(),
};

function storeOf(
  kind: DataStoreKind,
  connectionString?: string | undefined,
): DataStore {
  const store: DataStore = new DataStore();
  store.projectId = ObjectID.generate();
  store.kind = kind;
  store.name = "orders";

  if (connectionString !== undefined) {
    store.connectionString = connectionString;
  }

  return store;
}

async function created(
  kind: DataStoreKind,
  connectionString?: string,
): Promise<DataStore> {
  return (
    await hooks().create({
      data: storeOf(kind, connectionString),
      props: PERSON,
    })
  ).createBy.data;
}

async function refusalOf(
  kind: DataStoreKind,
  connectionString: string,
): Promise<string> {
  try {
    await created(kind, connectionString);
  } catch (error) {
    expect(error).toBeInstanceOf(BadDataException);
    return (error as Error).message;
  }

  throw new Error(`${kind} took ${connectionString}`);
}

// The stores an update by a person is held to, as findRowsAndHoldUpdateToThem reads them.
function holdUpdateTo(kinds: Array<DataStoreKind>): void {
  jest
    .spyOn(
      DataStoreService as unknown as {
        findRowsAndHoldUpdateToThem: () => Promise<Array<DataStore>>;
      },
      "findRowsAndHoldUpdateToThem",
    )
    .mockImplementation(async (): Promise<Array<DataStore>> => {
      return kinds.map((kind: DataStoreKind): DataStore => {
        const row: DataStore = storeOf(kind);
        row._id = ObjectID.generate().toString();
        return row;
      });
    });
}

async function updated(
  connectionString: string,
  props: UpdateBy<DataStore>["props"],
): Promise<JSONObject> {
  const result: OnUpdate<DataStore> = await hooks().update({
    query: { _id: ObjectID.generate() },
    data: { connectionString } as never,
    limit: 1,
    skip: 0,
    props,
  });

  return result.updateBy.data as unknown as JSONObject;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a connection string a person saves, by the store's kind", () => {
  test.each([
    [DataStoreKind.PostgreSql, " postgresql://reader:x@db.internal:5432/app "],
    [DataStoreKind.PostgreSql, "postgres://reader:x@db.internal:5432/app"],
    [DataStoreKind.MySql, "mysql://reader:x@db.internal:3306/app"],
    [DataStoreKind.MySql, "mariadb://reader:x@db.internal:3306/app"],
    [DataStoreKind.SqlServer, "mssql://reader:x@db.internal:1433/app"],
    [DataStoreKind.SqlServer, "sqlserver://reader:x@db.internal:1433/app"],
    [DataStoreKind.Elasticsearch, "https://reader:x@search.internal:9200"],
    [
      DataStoreKind.Elasticsearch,
      "https://search.internal:9200?api_key=abc==&verify_certificate=false",
    ],
    [DataStoreKind.OpenSearch, "http://search.internal:9200"],
    [
      DataStoreKind.OpenSearch,
      '{"url":"https://search.internal:9200","username":"reader","password":"x"}',
    ],
  ])("%s takes %s, trimmed", async (kind: DataStoreKind, written: string) => {
    expect((await created(kind, written)).connectionString).toBe(
      written.trim(),
    );
  });

  test("a database's string must be its own engine's", async () => {
    expect(
      await refusalOf(
        DataStoreKind.PostgreSql,
        "mysql://reader:x@db.internal:3306/app",
      ),
    ).toBe(
      "Enter a PostgreSQL connection string, such as postgresql://reader:password@db.internal:5432/app.",
    );
    expect(
      await refusalOf(
        DataStoreKind.MySql,
        "postgresql://reader:x@db.internal:5432/app",
      ),
    ).toBe(
      "Enter a MySQL or MariaDB connection string, such as mysql://reader:password@db.internal:3306/app.",
    );
    expect(
      await refusalOf(DataStoreKind.SqlServer, "https://search.internal:9200"),
    ).toBe(
      "Enter a SQL Server connection string, such as mssql://reader:password@db.internal:1433/app.",
    );
  });

  test("a search cluster's must be its address: what to write instead, never the secret", async () => {
    expect(
      await refusalOf(
        DataStoreKind.Elasticsearch,
        "postgresql://reader:Hunter2-Secret@db.internal:5432/app",
      ),
    ).toBe(
      "Start the cluster's address with https:// or http://, such as https://reader:password@search.internal:9200.",
    );

    const refused: string = await refusalOf(
      DataStoreKind.OpenSearch,
      "https://reader:Hunter2-Secret@search.internal:9200?pretty=true",
    );

    expect(refused).toBe(
      "OneUptime reads only api_key and verify_certificate after the address. Remove pretty.",
    );
    expect(refused).not.toContain("Hunter2-Secret");
  });

  test("a kind nothing reads a connection string for takes none: it would be saved and never used", async () => {
    expect(
      await refusalOf(DataStoreKind.Redis, "redis://reader:x@cache.internal"),
    ).toBe(
      "OneUptime cannot sample a Redis store's content yet, so it takes no connection string. Leave it empty: the store is still tracked.",
    );
  });

  test("a kind only Data Observability reads takes its engine's own string", async () => {
    expect(
      (
        await created(
          DataStoreKind.MongoDb,
          "mongodb://reader:x@mongo.internal",
        )
      ).connectionString,
    ).toBe("mongodb://reader:x@mongo.internal");
  });

  test("an empty one is no connection string", async () => {
    expect((await created(DataStoreKind.PostgreSql, "")).connectionString).toBe(
      "",
    );
    expect(DataStoreServiceClass.readConnectionString("   ")).toBeNull();
    expect(DataStoreServiceClass.readConnectionString(null)).toBeNull();
  });
});

describe("a connection string written to a store already there", () => {
  test("by a person: checked for the kind of each store it is saved on", async () => {
    holdUpdateTo([DataStoreKind.Elasticsearch]);

    await expect(
      updated("postgresql://reader:x@db.internal:5432/app", PERSON),
    ).rejects.toThrow(
      "Start the cluster's address with https:// or http://, such as https://reader:password@search.internal:9200.",
    );

    expect(
      (await updated(" https://reader:x@search.internal:9200 ", PERSON))[
        "connectionString"
      ],
    ).toBe("https://reader:x@search.internal:9200");
  });

  test("by a person, on stores of two kinds: each kind's rule holds", async () => {
    holdUpdateTo([DataStoreKind.PostgreSql, DataStoreKind.Elasticsearch]);

    await expect(
      updated("postgresql://reader:x@db.internal:5432/app", PERSON),
    ).rejects.toThrow("Start the cluster's address");
  });

  test("by a person, held to no store: nothing is written, so nothing is refused", async () => {
    holdUpdateTo([]);

    expect((await updated(" anything ", PERSON))["connectionString"]).toBe(
      "anything",
    );
  });

  /*
   * Data Observability connects a store the project already knows by
   * writing its connection string as OneUptime (connectKnownStore): a
   * MongoDB server the Database product found, a Snowflake warehouse added
   * before. That write was held to the databases' schemes and refused. It
   * is Data Observability's own, read by its workers, so the service leaves
   * it exactly as written - and never reads its rows to check it.
   */
  test.each([
    "mongodb://reader:x@mongo.internal:27017/app",
    '{"account":"acme","user":"reader","password":"x"}',
    "http://clickhouse.internal:8123",
  ])(
    "by OneUptime, as Data Observability connects a store: kept as written (%s)",
    async (written: string) => {
      expect(
        (await updated(written, { isRoot: true }))["connectionString"],
      ).toBe(written);
    },
  );
});

describe("a new store's exposure, before anything reads it", () => {
  test("a kind whose exposure a scan checks: Not checked yet", async () => {
    expect((await created(DataStoreKind.Elasticsearch)).exposure).toBe(
      DataStoreExposure.NotChecked,
    );
    expect((await created(DataStoreKind.OpenSearch)).exposure).toBe(
      DataStoreExposure.NotChecked,
    );
  });

  test("a kind nothing checks: Can't be checked", async () => {
    for (const kind of [
      DataStoreKind.PostgreSql,
      DataStoreKind.MongoDb,
      DataStoreKind.Redis,
    ]) {
      expect((await created(kind)).exposure).toBe(
        DataStoreExposure.CannotBeChecked,
      );
    }
  });

  test("found by OneUptime with its configuration: worked out from it", async () => {
    const store: DataStore = storeOf(DataStoreKind.AwsS3Bucket);
    const posture: DataStorePostureFacts = {
      readAt: "2026-11-27T10:00:00.000Z",
      publicRead: true,
    };

    store.posture = posture;

    expect(
      (await hooks().create({ data: store, props: { isRoot: true } })).createBy
        .data.exposure,
    ).toBe(DataStoreExposure.Public);
  });

  test("a cloud's store found before its configuration is read: Not checked yet", async () => {
    expect(
      (
        await hooks().create({
          data: storeOf(DataStoreKind.AwsS3Bucket),
          props: { isRoot: true },
        })
      ).createBy.data.exposure,
    ).toBe(DataStoreExposure.NotChecked);
  });

  test("a store OneUptime holds is Private, and an exposure given stands", async () => {
    expect(
      (
        await hooks().create({
          data: storeOf(DataStoreKind.TelemetryLogs),
          props: { isRoot: true },
        })
      ).createBy.data.exposure,
    ).toBe(DataStoreExposure.Private);

    const declared: DataStore = storeOf(DataStoreKind.SecurityEvents);

    declared.exposure = DataStoreExposure.Private;

    expect(
      (await hooks().create({ data: declared, props: { isRoot: true } }))
        .createBy.data.exposure,
    ).toBe(DataStoreExposure.Private);
  });
});
