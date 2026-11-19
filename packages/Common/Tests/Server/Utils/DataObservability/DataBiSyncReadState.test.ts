import { afterEach, describe, expect, jest, test } from "@jest/globals";
import DataBiConnection from "../../../../Models/DatabaseModels/DataBiConnection";
import DataDashboard from "../../../../Models/DatabaseModels/DataDashboard";
import DataStore from "../../../../Models/DatabaseModels/DataStore";
import DataBiConnectionService from "../../../../Server/Services/DataBiConnectionService";
import DataDashboardService from "../../../../Server/Services/DataDashboardService";
import DataStoreService from "../../../../Server/Services/DataStoreService";
import {
  BiDashboardRead,
  BiToolRead,
  PowerBiConnector,
} from "../../../../Server/Utils/DataObservability/Bi/BiConnectors";
import { collectBiSources } from "../../../../Server/Utils/DataObservability/Bi/BiSources";
import { BiReadKeptStateError } from "../../../../Server/Utils/DataObservability/Bi/BiReadState";
import { BiTableRef } from "../../../../Server/Utils/DataObservability/Bi/BiTables";
import DataBiSync, {
  MAX_TOOLS_READ_AT_ONCE,
} from "../../../../Server/Utils/DataObservability/Bi/DataBiSync";
import { readPowerQueryTables } from "../../../../Server/Utils/DataObservability/Bi/PowerQuery";
import * as DatabaseConnectionGuard from "../../../../Server/Utils/DataObservability/DatabaseConnectionGuard";
import DataverseApi from "../../../../Server/Utils/DataObservability/DataverseApi";
import OpenLineageIngest, {
  ProjectCatalog,
} from "../../../../Server/Utils/DataObservability/OpenLineageIngest";
import DataAsset from "../../../../Models/DatabaseModels/DataAsset";
import { readDataBiLineageSummary } from "../../../../Types/DataObservability/DataBiLineage";
import DataBiTool from "../../../../Types/DataObservability/DataBiTool";
import { DataStoreKind } from "../../../../Types/DataSecurity/DataStoreKind";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";

/*
 * What a BI tool's read keeps so the next one reads less
 * (DataBiConnection.readState): handed to the tool's reader, kept after a
 * read that worked and never after one that failed - and, for Power BI's
 * OData connectors to Dataverse (#9554), each environment's entity set
 * names, asked of the environment once and matched through.
 */

const CONTOSO_STORE_ID: string = "33333333-3333-4333-8333-333333333333";

function catalog(): ProjectCatalog {
  return {
    stores: [
      {
        dataStoreId: CONTOSO_STORE_ID,
        kind: DataStoreKind.Dataverse,
        databaseName: "contoso",
        serverAddress: "contoso.crm.dynamics.com",
      },
    ],
    assets: [
      {
        dataAssetId: "44444444-4444-4444-8444-000000000001",
        dataStoreId: CONTOSO_STORE_ID,
        schemaName: "dbo",
        name: "account",
      },
    ],
    storeNames: new Map([[CONTOSO_STORE_ID, "Contoso CRM"]]),
  };
}

// A report on a dataset that reads Dataverse through Common Data Service (Legacy).
function cdsRead(): BiToolRead {
  const tables: Array<BiTableRef> = readPowerQueryTables(
    'let Source = Cds.Entities("https://contoso.crm.dynamics.com/", [ReorderColumns=null, UseFormattedValue=null]), entities = Source{[Group="entities"]}[Data], accounts = entities{[EntitySetName="accounts"]}[Data] in accounts',
  );
  const report: BiDashboardRead = {
    externalId: "r1",
    name: "Pipeline by Account",
    url: "https://app.powerbi.com/groups/w1/reports/r1",
    folder: "Sales",
    owner: null,
    changedAt: null,
    tables,
  };

  return {
    dashboards: [report],
    usage: null,
    warnings: [],
    datasets: [],
    datasetFacts: {
      count: 1,
      withTables: 1,
      withQueries: 1,
      withSchemaError: 0,
      schemaError: null,
      readingDataflows: 0,
    },
    sources: collectBiSources([{ sources: [], tables }]),
    readState: { workspaces: {} },
  };
}

function connectionWith(readState: JSONObject | undefined): DataBiConnection {
  const connection: DataBiConnection = new DataBiConnection();

  connection._id = ObjectID.generate().toString();
  connection.projectId = ObjectID.generate();
  connection.tool = DataBiTool.PowerBI;
  connection.credentials = JSON.stringify({
    tenantId: "t",
    clientId: "c",
    clientSecret: "s3cr3t",
  });

  if (readState) {
    connection.readState = readState;
  }

  return connection;
}

function contosoStore(): DataStore {
  const store: DataStore = new DataStore();

  store._id = CONTOSO_STORE_ID;
  store.kind = DataStoreKind.Dataverse;
  store.connectionString = JSON.stringify({
    environmentUrl: "https://contoso.crm.dynamics.com",
    tenantId: "contoso.onmicrosoft.com",
    clientId: "00000000-0000-0000-0000-000000000001",
    clientSecret: "dataverse-secret",
  });

  return store;
}

describe("a BI tool's read state", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  function stubSync(
    connection: DataBiConnection,
    read: BiToolRead | Error,
  ): {
    updateTool: jest.SpyInstance;
    create: jest.SpyInstance;
    powerBiRead: jest.SpyInstance;
    listTables: jest.SpyInstance;
  } {
    jest
      .spyOn(DataBiConnectionService, "findOneById")
      .mockResolvedValue(connection);
    const updateTool: jest.SpyInstance = jest
      .spyOn(DataBiConnectionService, "updateOneById")
      .mockResolvedValue(undefined as never) as unknown as jest.SpyInstance;
    const powerBiRead: jest.SpyInstance = (read instanceof Error
      ? jest.spyOn(PowerBiConnector, "read").mockRejectedValue(read)
      : jest
          .spyOn(PowerBiConnector, "read")
          .mockResolvedValue(read)) as unknown as jest.SpyInstance;
    jest.spyOn(OpenLineageIngest, "readCatalog").mockResolvedValue(catalog());
    jest.spyOn(DataDashboardService, "findBy").mockResolvedValue([]);
    const create: jest.SpyInstance = jest
      .spyOn(DataDashboardService, "create")
      .mockResolvedValue(undefined as never) as unknown as jest.SpyInstance;
    jest.spyOn(DataStoreService, "findOneBy").mockResolvedValue(contosoStore());
    jest
      .spyOn(DatabaseConnectionGuard, "assertDatabaseConnectionAllowed")
      .mockResolvedValue(undefined);
    const listTables: jest.SpyInstance = jest
      .spyOn(DataverseApi.prototype, "listTables")
      .mockResolvedValue([
        { LogicalName: "account", EntitySetName: "accounts" },
        { LogicalName: "contact", EntitySetName: "contacts" },
      ] as Array<JSONObject>) as unknown as jest.SpyInstance;

    return { updateTool, create, powerBiRead, listTables };
  }

  test("a report on Dataverse's OData connector is tied to the table the environment names its entity set for", async () => {
    const connection: DataBiConnection = connectionWith(undefined);
    const stubs: ReturnType<typeof stubSync> = stubSync(connection, cdsRead());

    const result: { matchedTableCount: number; error: string | null } =
      await DataBiSync.syncConnection(connection.id!);

    expect(result).toMatchObject({ matchedTableCount: 1, error: null });
    expect(stubs.listTables).toHaveBeenCalledTimes(1);

    const created: DataDashboard = stubs.create.mock.calls[0]![0]
      .data as DataDashboard;

    expect(
      (created.dataAssets || []).map((asset: DataAsset): string => {
        return asset._id!.toString();
      }),
    ).toEqual(["44444444-4444-4444-8444-000000000001"]);

    const written: JSONObject = stubs.updateTool.mock.calls[0]![0]
      .data as unknown as JSONObject;

    expect(written["lastSyncWarning"]).toBe("");
    expect(readDataBiLineageSummary(written["lineageSummary"])).toMatchObject({
      tableCount: 1,
      matchedTableCount: 1,
      problems: [],
    });
    // The reader's own state under its name, and the environment's entity sets beside it.
    expect(written["readState"]).toEqual({
      powerBi: { workspaces: {} },
      dataverseEntitySets: {
        [CONTOSO_STORE_ID]: {
          readAt: expect.any(String),
          entitySets: { accounts: "account", contacts: "contact" },
        },
      },
    });
    // Nothing that gets in: the environment's secret is never kept.
    expect(JSON.stringify(written["readState"])).not.toContain(
      "dataverse-secret",
    );
  });

  test("the next read matches through what the environment said, without asking again", async () => {
    const connection: DataBiConnection = connectionWith({
      powerBi: { workspaces: { w1: {} } },
      dataverseEntitySets: {
        [CONTOSO_STORE_ID]: {
          readAt: new Date().toISOString(),
          entitySets: { accounts: "account" },
        },
      },
    });
    const stubs: ReturnType<typeof stubSync> = stubSync(connection, cdsRead());

    const result: { matchedTableCount: number } =
      await DataBiSync.syncConnection(connection.id!, { isScheduled: true });

    expect(result.matchedTableCount).toBe(1);
    expect(stubs.listTables).not.toHaveBeenCalled();
    // The reader is handed its own state, and told it is the hourly read.
    expect(stubs.powerBiRead.mock.calls[0]![0]).toMatchObject({
      readState: { workspaces: { w1: {} } },
      isScheduled: true,
    });
  });

  test("an environment that refuses is said, and the read still keeps its dashboards", async () => {
    const connection: DataBiConnection = connectionWith(undefined);
    const stubs: ReturnType<typeof stubSync> = stubSync(connection, cdsRead());

    stubs.listTables.mockRejectedValue(
      new Error("Dataverse answered 403: the app has no security role."),
    );

    const result: { dashboardCount: number; error: string | null } =
      await DataBiSync.syncConnection(connection.id!);

    expect(result).toMatchObject({ dashboardCount: 1, error: null });

    const written: JSONObject = stubs.updateTool.mock.calls[0]![0]
      .data as unknown as JSONObject;

    expect(written["lastSyncWarning"]).toContain(
      "Dataverse contoso.crm.dynamics.com was not asked for its tables' entity set names",
    );
    expect(written["matchedTableCount"]).toBe(0);
  });

  test("the hourly read reads every tool, a few at a time, as the hourly read; one that fails stops none", async () => {
    const connections: Array<DataBiConnection> = Array.from(
      { length: 9 },
      (): DataBiConnection => {
        return connectionWith(undefined);
      },
    );
    let running: number = 0;
    let mostRunning: number = 0;
    const read: Array<string> = [];

    jest
      .spyOn(DataBiConnectionService, "findBy")
      .mockResolvedValue(connections);
    const sync: jest.SpyInstance = jest
      .spyOn(DataBiSync, "syncConnection")
      .mockImplementation(
        async (
          connectionId: ObjectID,
        ): Promise<{
          dashboardCount: number;
          matchedTableCount: number;
          error: string | null;
        }> => {
          running++;
          mostRunning = Math.max(mostRunning, running);
          await new Promise((resolve: (value: unknown) => void) => {
            setTimeout(resolve, 5);
          });
          running--;
          read.push(connectionId.toString());

          if (connectionId.toString() === connections[1]!.id!.toString()) {
            throw new Error("Power BI answered 401: Unauthorized");
          }

          return { dashboardCount: 1, matchedTableCount: 0, error: null };
        },
      ) as unknown as jest.SpyInstance;

    await DataBiSync.syncAll();

    expect(read.sort()).toEqual(
      connections
        .map((connection: DataBiConnection): string => {
          return connection.id!.toString();
        })
        .sort(),
    );
    expect(mostRunning).toBe(MAX_TOOLS_READ_AT_ONCE);
    for (const call of sync.mock.calls) {
      expect(call[1]).toEqual({ isScheduled: true });
    }
  });

  test("a read with nothing to show yet, but Power BI's scans still running, fails and keeps them for the next read (#9697)", async () => {
    const connection: DataBiConnection = connectionWith(undefined);
    const pending: JSONObject = {
      version: 1,
      workspaces: [],
      pendingScans: [
        {
          scanId: "e7d03602-4873-4760-b37e-1563ef5358e3",
          workspaceIds: ["w1"],
          startedAt: "2026-11-19T08:00:00.000Z",
        },
      ],
    };
    const stubs: ReturnType<typeof stubSync> = stubSync(
      connection,
      new BiReadKeptStateError(
        "Power BI was still scanning 1 workspace when the read stopped waiting after 20 minutes. The next read reads that scan once Power BI has finished it, rather than scanning again.",
        pending,
      ),
    );

    const result: { error: string | null } = await DataBiSync.syncConnection(
      connection.id!,
    );

    expect(result.error).toContain("Power BI was still scanning 1 workspace");

    const written: JSONObject = stubs.updateTool.mock.calls[0]![0]
      .data as unknown as JSONObject;

    expect(written["lastSyncError"]).toBe(result.error);
    expect(written["readState"]).toEqual({ powerBi: pending });
  });

  test("a read that fails keeps what the last one kept", async () => {
    const connection: DataBiConnection = connectionWith({
      powerBi: { workspaces: { w1: {} } },
    });
    const stubs: ReturnType<typeof stubSync> = stubSync(
      connection,
      new Error("Power BI answered 401: Unauthorized"),
    );

    const result: { error: string | null } = await DataBiSync.syncConnection(
      connection.id!,
    );

    expect(result.error).toContain("Power BI answered 401");

    const written: JSONObject = stubs.updateTool.mock.calls[0]![0]
      .data as unknown as JSONObject;

    expect("readState" in written).toBe(false);
  });
});
