import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { summarizeBiLineage } from "../../../../Server/Utils/DataObservability/Bi/BiLineageSummary";
import {
  BiCatalog,
  matchBiTables,
} from "../../../../Server/Utils/DataObservability/Bi/BiMatching";
import { BiTableRef } from "../../../../Server/Utils/DataObservability/Bi/BiTables";
import { readPowerQueryTables } from "../../../../Server/Utils/DataObservability/Bi/PowerQuery";
import { readTableHealthSnapshot } from "../../../../Server/Utils/DataObservability/DataObservabilityProbeCollect";
import DataverseApi from "../../../../Server/Utils/DataObservability/DataverseApi";
import {
  CollectedTable,
  collectTableHealth,
  TableHealthSnapshot,
} from "../../../../Server/Utils/DataObservability/TableHealthCollector";
import {
  AssetPlan,
  planAssetUpdate,
} from "../../../../Server/Utils/DataObservability/TableHealthIngest";
import { UsageAsset } from "../../../../Server/Utils/DataObservability/TableUsageMatching";
import DataSourceHttpFetch from "../../../../Server/Utils/DataSource/HttpFetch";
import {
  DataBiLineageProblem,
  DataBiLineageSummary,
} from "../../../../Types/DataObservability/DataBiLineage";
import { DataStoreKind } from "../../../../Types/DataSecurity/DataStoreKind";
import { JSONObject } from "../../../../Types/JSON";
import FakeDataverse, {
  FAKE_HOST,
  FAKE_TABLES,
  fakeConnectionString,
} from "./FakeDataverse";

/*
 * EACH DATAVERSE TABLE'S ENTITY SET NAME, KEPT BY ITS COLLECTION (#9696).
 *
 * Power BI's OData connectors to Dataverse (Cds.Entities, Cds.Contents,
 * Dataverse.Contents) name a table by its entity set (accounts), while
 * OneUptime keeps it under its logical name (account). The BI read once
 * asked the environment for its entity set names with the environment's
 * own connection, which it does not have for an environment a probe
 * collects: reports on a probe's environments never matched. Now the
 * collection keeps each table's name - the definition it reads already
 * says it - the probe's report carries it, the server keeps it with the
 * table, and matching reads it there: the same for both.
 *
 * Every step is the real one, end to end: the collection against a fake
 * environment that answers as Dataverse does, its snapshot as a probe
 * posts it (JSON), the server's strict read of that report, the ingest's
 * plan for each table, and the BI match. A probe older than the names
 * sends none: its tables keep none, nothing matches, and See Why says why.
 */

const STORE_ID: string = "dataverse-store";
const COLLECTED_AT: Date = new Date();

// A maker's own table, whose entity set is not its logical name's plural.
const TABLES: typeof FAKE_TABLES = [
  ...FAKE_TABLES,
  {
    logicalName: "cr123_deal",
    entitySetName: "cr123_bargains",
    isCustomEntity: true,
    rows: 12,
    changedSecondsAgo: 300,
  },
];

function useFake(fake: FakeDataverse): void {
  jest.spyOn(DataSourceHttpFetch, "fetch").mockImplementation(fake.transport);
  jest.spyOn(DataverseApi, "sleep").mockResolvedValue(undefined);
}

async function collect(): Promise<TableHealthSnapshot> {
  useFake(new FakeDataverse(TABLES));

  return await collectTableHealth(
    { engine: "dataverse", connectionString: fakeConnectionString() },
    { maxTables: 100, maxColumns: 10_000, exclusions: [] },
  );
}

function tableOf(snapshot: TableHealthSnapshot, name: string): CollectedTable {
  const found: CollectedTable | undefined = snapshot.tables.find(
    (table: CollectedTable): boolean => {
      return table.name === name;
    },
  );

  if (!found) {
    throw new Error(`No table ${name}`);
  }

  return found;
}

// The snapshot as a probe posts it, and as the server reads the report.
function throughProbe(
  snapshot: TableHealthSnapshot,
  asOlderProbe: boolean = false,
): TableHealthSnapshot {
  const posted: JSONObject = JSON.parse(JSON.stringify(snapshot)) as JSONObject;

  if (asOlderProbe) {
    for (const table of posted["tables"] as Array<JSONObject>) {
      delete table["entitySetName"];
    }
  }

  return readTableHealthSnapshot(posted, COLLECTED_AT)!;
}

// The watched tables as the ingest keeps them, and as the BI read's catalog reads them back.
function catalogOf(snapshot: TableHealthSnapshot): BiCatalog {
  return {
    stores: [
      {
        dataStoreId: STORE_ID,
        kind: DataStoreKind.Dataverse,
        databaseName: "contoso",
        serverAddress: FAKE_HOST,
      },
    ],
    assets: snapshot.tables.map((table: CollectedTable): UsageAsset => {
      const plan: AssetPlan = planAssetUpdate(null, table, COLLECTED_AT);

      return {
        dataAssetId: `asset-${table.name}`,
        dataStoreId: STORE_ID,
        schemaName: table.schema,
        name: table.name,
        ...(plan.entitySetName ? { entitySetName: plan.entitySetName } : {}),
      };
    }),
  };
}

// A Power BI report on Common Data Service (Legacy), as its dataset's Power Query reads it.
function report(entitySet: string): Array<BiTableRef> {
  return readPowerQueryTables(
    `let Source = Cds.Entities("https://${FAKE_HOST}/", [ReorderColumns=null, UseFormattedValue=null]), entities = Source{[Group="entities"]}[Data], t = entities{[EntitySetName="${entitySet}"]}[Data] in t`,
  );
}

function matched(refs: Array<BiTableRef>, catalog: BiCatalog): Array<string> {
  return matchBiTables(refs, catalog).map((asset: UsageAsset): string => {
    return asset.dataAssetId;
  });
}

describe("a Dataverse collection keeps each table's entity set name", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("every table it collects carries the name its Web API calls it by, as the environment's definition says", async () => {
    const snapshot: TableHealthSnapshot = await collect();

    expect(tableOf(snapshot, "account").entitySetName).toBe("accounts");
    expect(tableOf(snapshot, "cr123_project").entitySetName).toBe(
      "cr123_projects",
    );
    // Never guessed from the logical name: the environment's own.
    expect(tableOf(snapshot, "cr123_deal").entitySetName).toBe(
      "cr123_bargains",
    );
  });
});

describe("a probe's report of it, as the server reads it", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("keeps each table's entity set name, and the columns it left unread by design", async () => {
    const read: TableHealthSnapshot = throughProbe(await collect());
    const account: CollectedTable = tableOf(read, "account");

    expect(account.entitySetName).toBe("accounts");
    // Columns are read once an hour: between, the columns last read stand (they were dropped in transit).
    expect(account.columns).toBeNull();
    expect(account.columnsNotRead).toBe(true);
  });

  test("an older probe's report says no name: the table carries none, so what the store kept stands", async () => {
    const read: TableHealthSnapshot = throughProbe(await collect(), true);

    expect(tableOf(read, "account")).not.toHaveProperty("entitySetName");
  });

  test("a name that is no text, or too long, is read strictly", () => {
    const read: TableHealthSnapshot | null = readTableHealthSnapshot(
      {
        engine: "dataverse",
        collectedAt: COLLECTED_AT.toISOString(),
        isComplete: true,
        tables: [
          {
            schema: "dbo",
            name: "account",
            kind: "Table",
            columns: null,
            entitySetName: 7,
          },
          {
            schema: "dbo",
            name: "contact",
            kind: "Table",
            columns: null,
            entitySetName: "c".repeat(1_000),
          },
          {
            schema: "dbo",
            name: "lead",
            kind: "Table",
            columns: [],
            // Columns the report sent are read, whatever it says of them.
            columnsNotRead: true,
          },
        ],
      },
      COLLECTED_AT,
    );

    expect(tableOf(read!, "account")).not.toHaveProperty("entitySetName");
    expect(tableOf(read!, "contact").entitySetName).toHaveLength(240);
    expect(tableOf(read!, "lead")).not.toHaveProperty("columnsNotRead");
  });
});

describe("a Power BI report on a probe-collected environment's table, by its entity set (#9696)", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("Cds.Entities on accounts matches its dbo.account table, as on an environment OneUptime collects", async () => {
    const snapshot: TableHealthSnapshot = await collect();
    const byProbe: BiCatalog = catalogOf(throughProbe(snapshot));
    const byOneUptime: BiCatalog = catalogOf(snapshot);

    expect(matched(report("accounts"), byProbe)).toEqual(["asset-account"]);
    expect(matched(report("accounts"), byOneUptime)).toEqual(["asset-account"]);
    // A maker's entity set, by its own name.
    expect(matched(report("cr123_bargains"), byProbe)).toEqual([
      "asset-cr123_deal",
    ]);
    expect(matched(report("cr123_deals"), byProbe)).toEqual([]);
  });

  test("an older probe's environment matches nothing, and See Why says the probe is to be updated", async () => {
    const catalog: BiCatalog = catalogOf(throughProbe(await collect(), true));
    const refs: Array<BiTableRef> = report("accounts");

    expect(matched(refs, catalog)).toEqual([]);

    const summary: DataBiLineageSummary = summarizeBiLineage({
      dashboards: [{ tables: refs }],
      catalog,
    });

    expect(summary).toMatchObject({
      tableCount: 1,
      matchedTableCount: 0,
      unwatchedTables: [],
      unknownEntitySets: ["accounts"],
      problems: [DataBiLineageProblem.EntitySetsUnknown],
    });
  });
});
