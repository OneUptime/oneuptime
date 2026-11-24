import { afterEach, describe, expect, jest, test } from "@jest/globals";
import * as GcpReader from "../../../../Server/Utils/DataSecurity/Cloud/Gcp/GcpDataSecurityReader";
import {
  ObjectStoreListPage,
  ObjectStoreReader,
} from "../../../../Server/Utils/DataSecurity/Cloud/DataSecurityCloudTypes";
import { MAX_STATE_ENTRIES } from "../../../../Server/Utils/DataSecurity/Content/ObjectStoreSampler";
import DataSecurityRunner, {
  CONTAINER_STATES_KEY,
  readContainerStates,
} from "../../../../Server/Utils/DataSecurity/DataSecurityRunner";
import {
  ContentScanOptions,
  ContentScanResult,
  emptyContentScanResult,
  LocationFindings,
} from "../../../../Server/Utils/DataSecurity/DataSecurityScanTypes";
import { ModelBudget } from "../../../../Server/Utils/DataSecurity/Model/ModelBudget";
import {
  CONTENT_STORE_KEY,
  ModelScanContext,
} from "../../../../Server/Utils/DataSecurity/Model/ModelScan";
import {
  MODEL_TURN_STATE_KEY,
  readModelResumeAt,
} from "../../../../Server/Utils/DataSecurity/Model/ModelTurns";
import DataStore from "../../../../Models/DatabaseModels/DataStore";
import { DataStoreKind } from "../../../../Types/DataSecurity/DataStoreKind";
import { JSONObject } from "../../../../Types/JSON";
import { FieldClassification } from "../../../../Utils/DataSecurity/FieldClassifier";
import FakeEntityRecognizer, {
  ISSUE_SENTENCE,
} from "./Model/FakeEntityRecognizer";

/*
 * A STORAGE ACCOUNT'S CONTAINERS AND A DATASET'S TABLES TAKE TURNS AT THE
 * MODEL'S TIME (#10928).
 *
 * A storage account is sampled container by container, as buckets are. Its
 * containers' states were lost when their results were merged, so every
 * scan read the same newest objects of every container again; each now
 * keeps its own, all of them together no larger than a bucket's. And with
 * the names-and-addresses model on, the containers - and a BigQuery
 * dataset's tables - are read from where the last scan's model stopped.
 */

function options(rest: Partial<ContentScanOptions> = {}): ContentScanOptions {
  return {
    limits: {
      maxObjects: 100,
      maxBytesPerObject: 65536,
      maxBytesTotal: 64 * 1024 * 1024,
      maxRowsPerTable: 1000,
      maxTables: 10,
      deadline: new Date(Date.now() + 60_000),
    },
    customDetectors: [],
    extraHints: [],
    disabledDataTypeIds: new Set(),
    allowedValues: new Set(),
    exclusions: [],
    fingerprintKey: "test-project-key",
    ...rest,
  };
}

// A model with time for `texts` texts a scan, ten milliseconds each.
function modelWithTimeFor(texts: number): ModelScanContext {
  return {
    recognizer: new FakeEntityRecognizer({ millisecondsPerText: 10 }),
    budget: new ModelBudget({
      scanLimitInMs: texts * 10,
      storeLimitInMs: texts * 10,
    }),
  };
}

const NO_READER: ObjectStoreReader = {
  description: "unused",
  listObjects: async (): Promise<ObjectStoreListPage> => {
    return { objects: [], nextToken: undefined };
  },
  readObjectStart: async (): Promise<Uint8Array> => {
    return new Uint8Array();
  },
};

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a storage account's containers", () => {
  /*
   * A container's sample, stood in for: it says which state it was handed,
   * returns one of its own, and hands the model its free text - `texts`
   * values - as the object sampler would.
   */
  function containerSample(data: {
    handed: Array<{ container: string; state: JSONObject | undefined }>;
    texts?: Record<string, number>;
    entries?: number;
  }): (
    reader: ObjectStoreReader,
    options: ContentScanOptions,
  ) => Promise<ContentScanResult> {
    return async (
      reader: ObjectStoreReader,
      scanOptions: ContentScanOptions,
    ): Promise<ContentScanResult> => {
      const container: string = reader.description;
      const result: ContentScanResult = emptyContentScanResult();
      const etags: JSONObject = {};

      data.handed.push({ container, state: scanOptions.previousState });

      for (let index: number = 0; index < (data.entries || 2); index++) {
        etags[`${container}-object-${index}.csv`] = {
          etag: `"${index}"`,
          readAt: "2026-11-24T10:00:00.000Z",
        };
      }

      result.nextState = { etags };
      result.readLog = [`${container}-object-0.csv`];

      const texts: number = data.texts?.[container] || 0;

      if (scanOptions.model && texts > 0) {
        await scanOptions.model.recognizer.recognize(
          Array.from({ length: texts }, (_: unknown, index: number): string => {
            return `${container} note ${index}: ${ISSUE_SENTENCE}`;
          }),
          scanOptions.model.budget.forStore(CONTENT_STORE_KEY),
        );
      }

      return result;
    };
  }

  function readerOf(container: string): ObjectStoreReader {
    return { ...NO_READER, description: container };
  }

  test("each container keeps its own state, and is handed it next scan", async () => {
    const handed: Array<{ container: string; state: JSONObject | undefined }> =
      [];
    const first: ContentScanResult =
      await DataSecurityRunner.sampleStorageAccount({
        containers: ["exports", "backups"],
        options: options(),
        readerOf,
        sample: containerSample({ handed }),
      });
    const states: JSONObject = readContainerStates(first.nextState);

    expect(Object.keys(states)).toEqual(["exports", "backups"]);
    expect(
      Object.keys((states["exports"] as JSONObject)["etags"] as JSONObject),
    ).toEqual(["exports-object-0.csv", "exports-object-1.csv"]);
    // A first scan hands each nothing.
    expect(handed).toEqual([
      { container: "exports", state: undefined },
      { container: "backups", state: undefined },
    ]);

    handed.length = 0;

    await DataSecurityRunner.sampleStorageAccount({
      containers: ["exports", "backups"],
      options: options({ previousState: first.nextState }),
      readerOf,
      sample: containerSample({ handed }),
    });

    expect(handed).toEqual([
      { container: "exports", state: states["exports"] },
      { container: "backups", state: states["backups"] },
    ]);
  });

  test("before, an account's state was lost: its containers read the same newest objects every scan", async () => {
    // The state an account kept before this: no container's.
    const handed: Array<{ container: string; state: JSONObject | undefined }> =
      [];

    await DataSecurityRunner.sampleStorageAccount({
      containers: ["exports"],
      options: options({
        previousState: { plaintextPasswordFields: [] },
      }),
      readerOf,
      sample: containerSample({ handed }),
    });

    expect(handed).toEqual([{ container: "exports", state: undefined }]);
  });

  test("every container's state together is no larger than a bucket's", async () => {
    const containers: Array<string> = Array.from(
      { length: 10 },
      (_: unknown, index: number): string => {
        return `container-${index}`;
      },
    );
    const result: ContentScanResult =
      await DataSecurityRunner.sampleStorageAccount({
        containers,
        options: options(),
        readerOf,
        sample: containerSample({ handed: [], entries: MAX_STATE_ENTRIES }),
      });
    const states: JSONObject = readContainerStates(result.nextState);
    let entries: number = 0;

    for (const container of containers) {
      entries += Object.keys(
        (states[container] as JSONObject)["etags"] as JSONObject,
      ).length;
    }

    expect(entries).toBeLessThanOrEqual(MAX_STATE_ENTRIES);
    expect(entries).toBe(MAX_STATE_ENTRIES);
  });

  test("with the model on, the containers take turns at its time", async () => {
    const containers: Array<string> = ["alpha", "beta", "gamma"];
    const texts: Record<string, number> = { alpha: 2, beta: 2, gamma: 2 };
    const order: Array<Array<string>> = [];
    let state: JSONObject | undefined = undefined;

    // Time for one container's two notes a scan.
    for (let scan: number = 0; scan < 4; scan++) {
      const handed: Array<{
        container: string;
        state: JSONObject | undefined;
      }> = [];
      const result: ContentScanResult =
        await DataSecurityRunner.sampleStorageAccount({
          containers,
          options: options({
            model: modelWithTimeFor(2),
            previousState: state,
          }),
          readerOf,
          sample: containerSample({ handed, texts }),
        });

      order.push(
        handed.map((entry: { container: string }): string => {
          return entry.container;
        }),
      );
      state = result.nextState;
    }

    expect(order).toEqual([
      ["alpha", "beta", "gamma"],
      ["beta", "gamma", "alpha"],
      ["gamma", "alpha", "beta"],
      ["alpha", "beta", "gamma"],
    ]);
    // Each container's own state still beside the turn.
    expect(Object.keys(readContainerStates(state))).toEqual([
      "alpha",
      "beta",
      "gamma",
    ]);
  });

  test("without the model, they are read in their order and no turn is kept", async () => {
    const handed: Array<{ container: string; state: JSONObject | undefined }> =
      [];
    const result: ContentScanResult =
      await DataSecurityRunner.sampleStorageAccount({
        containers: ["alpha", "beta"],
        options: options({
          previousState: { [MODEL_TURN_STATE_KEY]: { resumeAt: "beta" } },
        }),
        readerOf,
        sample: containerSample({ handed }),
      });

    expect(
      handed.map((entry: { container: string }): string => {
        return entry.container;
      }),
    ).toEqual(["alpha", "beta"]);
    expect(Object.keys(result.nextState || {})).toEqual([CONTAINER_STATES_KEY]);
  });
});

describe("a BigQuery dataset's tables", () => {
  function notesTable(table: string): {
    table: string;
    columns: Array<string>;
    rows: Array<Record<string, unknown>>;
  } {
    return {
      table,
      columns: ["id", "notes"],
      rows: [0, 1, 2].map((index: number): Record<string, unknown> => {
        return {
          id: index,
          notes:
            index === 0
              ? ISSUE_SENTENCE
              : `Ticket ${table} ${index}: the customer asked about the delivery window and was told it would arrive tomorrow.`,
        };
      }),
    };
  }

  function dataset(): DataStore {
    const store: DataStore = new DataStore();

    store.kind = DataStoreKind.GcpBigQueryDataset;
    store.name = "crm";
    store.providerResourceId =
      "//bigquery.googleapis.com/projects/acme-prod/datasets/crm";

    return store;
  }

  async function sample(
    scanOptions: ContentScanOptions,
  ): Promise<ContentScanResult> {
    return await (
      DataSecurityRunner as unknown as {
        sampleBigQuery: (
          settings: unknown,
          connectionId: string,
          store: DataStore,
          options: ContentScanOptions,
        ) => Promise<ContentScanResult>;
      }
    ).sampleBigQuery({}, "connection", dataset(), scanOptions);
  }

  function tablesWithName(result: ContentScanResult): Array<string> {
    return result.locations
      .filter((location: LocationFindings): boolean => {
        return location.classifications.some(
          (classification: FieldClassification): boolean => {
            return classification.dataTypeId === "person-name";
          },
        );
      })
      .map((location: LocationFindings): string => {
        return location.location.split(".")[0]!;
      });
  }

  test("each scan's model starts at the table the last one stopped at", async () => {
    jest
      .spyOn(GcpReader, "readBigQuerySample")
      .mockImplementation((async () => {
        return {
          tables: [
            notesTable("customers"),
            notesTable("orders"),
            notesTable("tickets"),
          ],
          warnings: [],
        };
      }) as never);

    const turns: Array<Array<string>> = [];
    let state: JSONObject | undefined = undefined;

    // Time for one table's three notes a scan.
    for (let scan: number = 0; scan < 4; scan++) {
      const result: ContentScanResult = await sample(
        options({ model: modelWithTimeFor(3), previousState: state }),
      );

      turns.push(tablesWithName(result));
      state = result.nextState;
    }

    expect(turns).toEqual([
      ["customers"],
      ["orders"],
      ["tickets"],
      ["customers"],
    ]);
    expect(readModelResumeAt(state)).toBe("orders");
  });

  test("without the model, the tables are read in their order and no turn is kept", async () => {
    jest
      .spyOn(GcpReader, "readBigQuerySample")
      .mockImplementation((async () => {
        return {
          tables: [notesTable("customers"), notesTable("orders")],
          warnings: [],
        };
      }) as never);

    const result: ContentScanResult = await sample(
      options({
        previousState: { [MODEL_TURN_STATE_KEY]: { resumeAt: "orders" } },
      }),
    );

    expect(result.readLog).toEqual(["customers", "orders"]);
    expect(result.nextState).toBeUndefined();
  });
});
