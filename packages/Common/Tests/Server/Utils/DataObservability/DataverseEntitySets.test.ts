import { afterEach, describe, expect, jest, test } from "@jest/globals";
import DataStore from "../../../../Models/DatabaseModels/DataStore";
import DataStoreService from "../../../../Server/Services/DataStoreService";
import { BiTableRef } from "../../../../Server/Utils/DataObservability/Bi/BiTables";
import {
  DATAVERSE_ENTITY_SETS_ASKED_AGAIN_AFTER_IN_MS,
  DATAVERSE_ENTITY_SETS_KEPT_FOR_IN_MS,
  DataverseEntitySetState,
  DataverseEntitySetTable,
  DataverseEntitySetsRead,
  getDataverseEntitySetLookup,
  keepDataverseEntitySets,
  readDataverseEntitySetState,
  readDataverseEntitySets,
} from "../../../../Server/Utils/DataObservability/Bi/DataverseEntitySets";
import * as DatabaseConnectionGuard from "../../../../Server/Utils/DataObservability/DatabaseConnectionGuard";
import DataverseApi from "../../../../Server/Utils/DataObservability/DataverseApi";
import { UsageStore } from "../../../../Server/Utils/DataObservability/TableUsageMatching";
import { DataStoreKind } from "../../../../Types/DataSecurity/DataStoreKind";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";

/*
 * Each Dataverse environment's entity set names, for the Power BI tables
 * its OData connectors name by them (#9554). Never guessed: the watched
 * environment at the connector's host says, through its table definitions,
 * and what it said is kept for a day - asked again sooner, once an hour at
 * most, for an entity set it did not have.
 */

const NOW: Date = new Date("2026-11-19T12:00:00.000Z");

const CONTOSO: UsageStore = {
  dataStoreId: "contoso",
  kind: DataStoreKind.Dataverse,
  databaseName: "contoso",
  serverAddress: "contoso.crm.dynamics.com",
};
const FABRIKAM: UsageStore = {
  dataStoreId: "fabrikam",
  kind: DataStoreKind.Dataverse,
  databaseName: "fabrikam",
  serverAddress: "fabrikam.crm4.dynamics.com",
};
const SQL: UsageStore = {
  dataStoreId: "sql",
  kind: DataStoreKind.SqlServer,
  databaseName: "Sales",
  serverAddress: "contoso.crm.dynamics.com",
};

// As EntityDefinitions answers: LogicalName and EntitySetName, among hundreds of tables.
const CONTOSO_TABLES: Array<DataverseEntitySetTable> = [
  { logicalName: "account", entitySetName: "accounts" },
  { logicalName: "opportunity", entitySetName: "opportunities" },
  {
    logicalName: "transactioncurrency",
    entitySetName: "transactioncurrencies",
  },
  { logicalName: "cr123_deal", entitySetName: "deals" },
];

function entitySet(table: string, host: string): BiTableRef {
  return {
    database: null,
    schema: null,
    table,
    engine: "dataverse",
    host,
    isEntitySet: true,
  };
}

function lookup(answers: Record<string, Array<DataverseEntitySetTable>>): {
  asked: Array<string>;
  ask: (dataStoreId: string) => Promise<Array<DataverseEntitySetTable>>;
} {
  const asked: Array<string> = [];

  return {
    asked,
    ask: async (
      dataStoreId: string,
    ): Promise<Array<DataverseEntitySetTable>> => {
      asked.push(dataStoreId);

      const answer: Array<DataverseEntitySetTable> | undefined =
        answers[dataStoreId];

      if (!answer) {
        throw new Error(
          "Dataverse answered 401: The user is not a member of the organization.",
        );
      }

      return answer;
    },
  };
}

describe("asking each environment its entity sets", () => {
  test("only the watched environments a table names by entity set, by host", async () => {
    const asking: ReturnType<typeof lookup> = lookup({
      contoso: CONTOSO_TABLES,
    });
    const read: DataverseEntitySetsRead = await readDataverseEntitySets({
      stores: [CONTOSO, FABRIKAM, SQL],
      refs: [
        entitySet("accounts", "contoso.crm.dynamics.com"),
        // A logical name needs no lookup.
        {
          database: null,
          schema: "dbo",
          table: "contact",
          engine: "dataverse",
          host: "fabrikam.crm4.dynamics.com",
        },
      ],
      state: {},
      now: NOW,
      lookup: asking.ask,
    });

    expect(asking.asked).toEqual(["contoso"]);
    expect(read.entitySets.get("contoso")?.get("accounts")).toBe("account");
    expect(read.entitySets.get("contoso")?.get("deals")).toBe("cr123_deal");
    expect(read.entitySets.has("fabrikam")).toBe(false);
    expect(read.state).toEqual({
      contoso: {
        readAt: NOW.toISOString(),
        entitySets: {
          accounts: "account",
          opportunities: "opportunity",
          transactioncurrencies: "transactioncurrency",
          deals: "cr123_deal",
        },
      },
    });
    expect(read.warnings).toEqual([]);
  });

  test("no table named by entity set: nothing asked, nothing kept", async () => {
    const asking: ReturnType<typeof lookup> = lookup({});
    const read: DataverseEntitySetsRead = await readDataverseEntitySets({
      stores: [CONTOSO],
      refs: [],
      state: {
        contoso: { readAt: NOW.toISOString(), entitySets: { a: "b" } },
      },
      now: NOW,
      lookup: asking.ask,
    });

    expect(asking.asked).toEqual([]);
    expect(read.state).toEqual({});
    expect(read.entitySets.size).toBe(0);
  });

  test("kept for a day while it names every entity set wanted; asked again after", async () => {
    const kept: DataverseEntitySetState = {
      contoso: {
        readAt: new Date(NOW.getTime() - 3 * 60 * 60 * 1000).toISOString(),
        entitySets: { accounts: "account" },
      },
    };
    const fresh: ReturnType<typeof lookup> = lookup({
      contoso: CONTOSO_TABLES,
    });

    await readDataverseEntitySets({
      stores: [CONTOSO],
      refs: [entitySet("Accounts", "contoso.crm.dynamics.com")],
      state: kept,
      now: NOW,
      lookup: fresh.ask,
    });

    expect(fresh.asked).toEqual([]);

    const stale: ReturnType<typeof lookup> = lookup({
      contoso: CONTOSO_TABLES,
    });

    await readDataverseEntitySets({
      stores: [CONTOSO],
      refs: [entitySet("accounts", "contoso.crm.dynamics.com")],
      state: kept,
      now: new Date(NOW.getTime() + DATAVERSE_ENTITY_SETS_KEPT_FOR_IN_MS),
      lookup: stale.ask,
    });

    expect(stale.asked).toEqual(["contoso"]);
  });

  test("an entity set it did not have is asked again, but once an hour at most", async () => {
    const kept: DataverseEntitySetState = {
      contoso: {
        readAt: new Date(NOW.getTime() - 10 * 60 * 1000).toISOString(),
        entitySets: { accounts: "account" },
      },
    };
    const soon: ReturnType<typeof lookup> = lookup({
      contoso: CONTOSO_TABLES,
    });

    await readDataverseEntitySets({
      stores: [CONTOSO],
      refs: [entitySet("opportunities", "contoso.crm.dynamics.com")],
      state: kept,
      now: NOW,
      lookup: soon.ask,
    });

    expect(soon.asked).toEqual([]);

    const later: ReturnType<typeof lookup> = lookup({
      contoso: CONTOSO_TABLES,
    });
    const read: DataverseEntitySetsRead = await readDataverseEntitySets({
      stores: [CONTOSO],
      refs: [entitySet("opportunities", "contoso.crm.dynamics.com")],
      state: kept,
      now: new Date(
        NOW.getTime() + DATAVERSE_ENTITY_SETS_ASKED_AGAIN_AFTER_IN_MS,
      ),
      lookup: later.ask,
    });

    expect(later.asked).toEqual(["contoso"]);
    expect(read.entitySets.get("contoso")?.get("opportunities")).toBe(
      "opportunity",
    );
  });

  test("an environment that cannot be asked keeps what it said last, and the read says why", async () => {
    const failing: ReturnType<typeof lookup> = lookup({});
    const read: DataverseEntitySetsRead = await readDataverseEntitySets({
      stores: [CONTOSO, FABRIKAM],
      refs: [
        entitySet("accounts", "contoso.crm.dynamics.com"),
        entitySet("accounts", "fabrikam.crm4.dynamics.com"),
      ],
      state: {
        contoso: {
          readAt: new Date(NOW.getTime() - 2 * 86_400_000).toISOString(),
          entitySets: { accounts: "account" },
        },
      },
      now: NOW,
      lookup: failing.ask,
    });

    expect(failing.asked).toEqual(["contoso", "fabrikam"]);
    expect(read.entitySets.get("contoso")?.get("accounts")).toBe("account");
    expect(read.entitySets.has("fabrikam")).toBe(false);
    expect(read.state["contoso"]?.entitySets).toEqual({ accounts: "account" });
    expect(read.state["fabrikam"]).toBeUndefined();
    expect(read.warnings).toEqual([
      expect.stringContaining(
        "Dataverse contoso.crm.dynamics.com was not asked for its tables' entity set names",
      ),
      expect.stringContaining("The user is not a member of the organization."),
    ]);
  });
});

describe("what a read keeps", () => {
  test("read back strictly: a malformed entry is nothing kept", () => {
    expect(
      readDataverseEntitySetState({
        contoso: {
          readAt: "2026-11-19T10:00:00.000Z",
          entitySets: { Accounts: "account", empty: "", number: 7 },
        },
        noDate: { entitySets: { a: "b" } },
        badDate: { readAt: "yesterday", entitySets: {} },
        list: [],
      }),
    ).toEqual({
      contoso: {
        readAt: "2026-11-19T10:00:00.000Z",
        entitySets: { accounts: "account" },
      },
    });
    expect(readDataverseEntitySetState(null)).toEqual({});
    expect(readDataverseEntitySetState("x")).toEqual({});
  });

  test("an answer is kept by entity set in lower case, empty names left out", () => {
    expect(
      keepDataverseEntitySets([
        { logicalName: "account", entitySetName: "Accounts" },
        { logicalName: "", entitySetName: "orphans" },
        { logicalName: "contact", entitySetName: "" },
      ]),
    ).toEqual({ accounts: "account" });
  });
});

describe("asking a watched environment with its own connection", () => {
  const PROJECT_ID: ObjectID = new ObjectID(
    "11111111-1111-4111-8111-111111111111",
  );
  const STORE_ID: string = "22222222-2222-4222-8222-222222222222";

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function store(fields: Partial<DataStore>): DataStore {
    const model: DataStore = new DataStore();

    model._id = STORE_ID;
    model.kind = DataStoreKind.Dataverse;
    model.connectionString = JSON.stringify({
      environmentUrl: "https://contoso.crm.dynamics.com",
      tenantId: "contoso.onmicrosoft.com",
      clientId: "00000000-0000-0000-0000-000000000001",
      clientSecret: "s3cr3t",
    });
    Object.assign(model, fields);

    return model;
  }

  test("its table definitions, the project's own store only, through the egress guard", async () => {
    const find: jest.SpiedFunction<typeof DataStoreService.findOneBy> = jest
      .spyOn(DataStoreService, "findOneBy")
      .mockResolvedValue(store({}));
    const guard: jest.SpiedFunction<
      typeof DatabaseConnectionGuard.assertDatabaseConnectionAllowed
    > = jest
      .spyOn(DatabaseConnectionGuard, "assertDatabaseConnectionAllowed")
      .mockResolvedValue(undefined);
    jest.spyOn(DataverseApi.prototype, "listTables").mockResolvedValue([
      {
        LogicalName: "account",
        EntitySetName: "accounts",
        TableType: "Standard",
      },
      { LogicalName: "contact", EntitySetName: "contacts" },
    ] as Array<JSONObject>);

    expect(await getDataverseEntitySetLookup(PROJECT_ID)(STORE_ID)).toEqual([
      { logicalName: "account", entitySetName: "accounts" },
      { logicalName: "contact", entitySetName: "contacts" },
    ]);

    const query: { _id: ObjectID; projectId: ObjectID } = find.mock.calls[0]![0]
      .query as unknown as { _id: ObjectID; projectId: ObjectID };

    expect(query.projectId.toString()).toBe(PROJECT_ID.toString());
    expect(query._id.toString()).toBe(STORE_ID);
    expect(guard).toHaveBeenCalledWith(
      expect.objectContaining({ engine: "dataverse" }),
    );
  });

  test("never one a probe collects, one with no connection string, or one gone", async () => {
    const listTables: jest.SpiedFunction<
      typeof DataverseApi.prototype.listTables
    > = jest.spyOn(DataverseApi.prototype, "listTables").mockResolvedValue([]);
    const find: jest.SpiedFunction<typeof DataStoreService.findOneBy> =
      jest.spyOn(DataStoreService, "findOneBy");

    find.mockResolvedValueOnce(store({ scanProbeId: ObjectID.generate() }));
    await expect(
      getDataverseEntitySetLookup(PROJECT_ID)(STORE_ID),
    ).rejects.toThrow("A probe collects this environment");

    find.mockResolvedValueOnce(store({ connectionString: "" }));
    await expect(
      getDataverseEntitySetLookup(PROJECT_ID)(STORE_ID),
    ).rejects.toThrow("No connection string is saved");

    find.mockResolvedValueOnce(store({ isArchived: true }));
    await expect(
      getDataverseEntitySetLookup(PROJECT_ID)(STORE_ID),
    ).rejects.toThrow("no longer connected");

    find.mockResolvedValueOnce(null);
    await expect(
      getDataverseEntitySetLookup(PROJECT_ID)(STORE_ID),
    ).rejects.toThrow("no longer connected");

    expect(listTables).not.toHaveBeenCalled();
  });
});
