import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import DataStore from "../../../../Models/DatabaseModels/DataStore";
import DataAssetService from "../../../../Server/Services/DataAssetService";
import DataStoreService from "../../../../Server/Services/DataStoreService";
import { buildProbeCollectWork } from "../../../../Server/Utils/DataObservability/DataObservabilityProbeClaim";
import {
  buildProbeCollectOptions,
  DataObservabilityProbeStoreWork,
  readProbeCollectWork,
  readTableHealthSnapshot,
} from "../../../../Server/Utils/DataObservability/DataObservabilityProbeCollect";
import { TableHealthSnapshot } from "../../../../Server/Utils/DataObservability/TableHealthCollector";
import TableHealthIngest from "../../../../Server/Utils/DataObservability/TableHealthIngest";
import logger from "../../../../Server/Utils/Logger";
import MonitorMetricUtil from "../../../../Server/Utils/Monitor/MonitorMetricUtil";
import { DataStoreKind } from "../../../../Types/DataSecurity/DataStoreKind";
import {
  SkippedTableRead,
  SkippedTables,
} from "../../../../Types/DataObservability/SkippedTables";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";

/*
 * THE TABLES A DATABASE KEEPS REFUSING, CARRIED FROM ONE COLLECTION TO THE
 * NEXT (#9541).
 *
 * A collection is handed what the store remembers and hands back what it
 * learned. Held here, for both kinds of collection:
 *
 *  - OneUptime's workers: the store's column goes into the collection, and
 *    the snapshot's skipped tables come back into the column - null when
 *    none is, untouched when the collection says nothing of them (an engine
 *    that keeps none) or failed;
 *  - a probe: the work item carries them, read strictly on the probe's
 *    side; the probe's report brings them back, read strictly on the
 *    server's, an older probe's silence keeping what the store had.
 */

const NOW: Date = new Date("2026-11-19T12:00:00.000Z");
const STORE_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

const SKIPPED: SkippedTables = {
  fingerprint: "c0ffee",
  tables: [
    {
      table: "cr123_secret",
      read: SkippedTableRead.RowCount,
      reason:
        "Dataverse refused the app (403, 0x80040220): Principal user is missing prvReadcr123_secret privilege.",
      since: "2026-11-19T11:00:00.000Z",
      refusals: 1,
      nextTryAt: "2026-11-19T12:30:00.000Z",
    },
  ],
};

beforeEach(() => {
  for (const level of ["debug", "info", "warn", "error"] as const) {
    jest.spyOn(logger, level).mockImplementation((() => {
      return undefined;
    }) as never);
  }
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a collection's snapshot, written down", () => {
  // The store's own summary a collection writes last, for a snapshot of no tables.
  async function storeWriteOf(
    snapshot: Partial<TableHealthSnapshot>,
  ): Promise<JSONObject> {
    const writes: Array<JSONObject> = [];

    jest.spyOn(DataAssetService, "findAllBy").mockResolvedValue([] as never);
    jest.spyOn(MonitorMetricUtil, "getRetentionDays").mockResolvedValue(30);
    jest
      .spyOn(TableHealthIngest as never, "writeMetricRows")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(TableHealthIngest as never, "writeNewPersonalDataColumns")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(DataStoreService, "updateColumnsByIdWithoutHooks")
      .mockImplementation((async (update: { data: JSONObject }) => {
        writes.push(update.data);
      }) as never);

    await TableHealthIngest.recordSnapshot({
      store: {
        id: STORE_ID,
        projectId: PROJECT_ID,
        name: "contoso",
        kind: DataStoreKind.Dataverse,
      },
      snapshot: {
        engine: "dataverse",
        collectedAt: NOW.toISOString(),
        isComplete: true,
        warnings: [],
        tables: [],
        ...snapshot,
      } as TableHealthSnapshot,
    });

    expect(writes).toHaveLength(1);

    return writes[0]!;
  }

  test("the tables skipped are kept on the store", async () => {
    expect(
      (await storeWriteOf({ skippedTables: SKIPPED }))[
        "tableHealthSkippedTables"
      ],
    ).toEqual(SKIPPED);
  });

  test("none skipped any more clears them", async () => {
    const write: JSONObject = await storeWriteOf({ skippedTables: null });

    expect("tableHealthSkippedTables" in write).toBe(true);
    expect(write["tableHealthSkippedTables"]).toBe(null);
  });

  test("a collection that says nothing of them leaves them as they were", async () => {
    expect("tableHealthSkippedTables" in (await storeWriteOf({}))).toBe(false);
  });

  test("a collection that failed leaves them as they were", async () => {
    const writes: Array<JSONObject> = [];

    jest
      .spyOn(DataStoreService, "updateColumnsByIdWithoutHooks")
      .mockImplementation((async (update: { data: JSONObject }) => {
        writes.push(update.data);
      }) as never);

    await TableHealthIngest.recordFailure({
      storeId: STORE_ID,
      error:
        "Dataverse answered 503 while listing the tables (EntityDefinitions).",
    });

    expect("tableHealthSkippedTables" in writes[0]!).toBe(false);
  });
});

describe("a probe's collection", () => {
  function store(fields: Partial<DataStore> = {}): DataStore {
    const row: DataStore = new DataStore();

    row.id = STORE_ID;
    row.projectId = PROJECT_ID;
    row.kind = DataStoreKind.Dataverse;
    row.probeConnectionVariable = "CONTOSO_DATAVERSE";
    Object.assign(row, fields);

    return row;
  }

  test("is handed what the store remembers, and the probe's collection is handed it in turn", () => {
    const work: DataObservabilityProbeStoreWork | null = buildProbeCollectWork(
      store({
        tableHealthSkippedTables: SKIPPED as unknown as JSONObject,
      }),
      [],
      NOW,
    );

    expect(work!.skippedTables).toEqual(SKIPPED);

    // The probe reads the item as it reads any other: strictly.
    const read: DataObservabilityProbeStoreWork | null = readProbeCollectWork(
      JSON.parse(JSON.stringify(work)),
    );

    expect(read!.skippedTables).toEqual(SKIPPED);
    expect(buildProbeCollectOptions(read!).skippedTables).toEqual(SKIPPED);
  });

  test("a store that remembers none hands nothing, and an item that is no memory is read as none", () => {
    expect(buildProbeCollectWork(store(), [], NOW)!).not.toHaveProperty(
      "skippedTables",
    );

    const read: DataObservabilityProbeStoreWork | null = readProbeCollectWork({
      dataStoreId: STORE_ID.toString(),
      engine: "dataverse",
      probeConnectionVariable: "CONTOSO_DATAVERSE",
      skippedTables: { tables: [{ table: "x", read: "Everything" }] },
    });

    expect(read).not.toHaveProperty("skippedTables");
    expect(buildProbeCollectOptions(read!)).not.toHaveProperty("skippedTables");
  });

  test("the probe's report brings them back, read strictly: none is null, an older probe's silence is nothing", () => {
    const report: JSONObject = {
      engine: "dataverse",
      collectedAt: NOW.toISOString(),
      tables: [],
      isComplete: true,
      warnings: [],
    };

    expect(
      readTableHealthSnapshot({ ...report, skippedTables: SKIPPED }, NOW)!
        .skippedTables,
    ).toEqual(SKIPPED);
    expect(
      readTableHealthSnapshot({ ...report, skippedTables: null }, NOW)!
        .skippedTables,
    ).toBe(null);
    // Nothing the server can read is no table skipped.
    expect(
      readTableHealthSnapshot(
        { ...report, skippedTables: { tables: "everything" } },
        NOW,
      )!.skippedTables,
    ).toBe(null);
    expect(readTableHealthSnapshot(report, NOW)!).not.toHaveProperty(
      "skippedTables",
    );
  });
});
