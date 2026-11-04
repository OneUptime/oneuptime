import { describe, expect, test } from "@jest/globals";
import DataAssetKind from "../../../../Types/DataObservability/DataAssetKind";
import {
  isObjectStoreKind,
  MAX_WATCHED_PATHS_PER_STORE,
  normalizeWatchedPaths,
  readStoragePathTarget,
  readWatchedPaths,
} from "../../../../Types/DataObservability/StoragePaths";
import { DataStoreKind } from "../../../../Types/DataSecurity/DataStoreKind";
import { ObjectStoreReader } from "../../../../Server/Utils/DataSecurity/Cloud/DataSecurityCloudTypes";
import {
  collectStoragePaths,
  MAX_OBJECTS_LISTED_PER_PATH,
  readStoragePath,
  StoragePathReading,
  toStoragePathTable,
} from "../../../../Server/Utils/DataObservability/StoragePathCollector";
import { TableHealthSnapshot } from "../../../../Server/Utils/DataObservability/TableHealthCollector";

/*
 * A path of a bucket, watched like a table: its newest object is its last
 * change, its objects are its rows. Only names, sizes and times are read.
 */

const NOW: Date = new Date(Date.UTC(2026, 10, 4, 12, 0, 0));

function readerOf(
  pages: Array<{
    objects: Array<{ key: string; sizeInBytes: number; lastModified?: Date }>;
    nextToken?: string;
  }>,
): ObjectStoreReader & { asked: Array<string | undefined> } {
  const asked: Array<string | undefined> = [];
  let page: number = 0;

  return {
    description: "s3://bucket",
    asked,
    listObjects: async (options: {
      prefix?: string | undefined;
    }): Promise<(typeof pages)[number]> => {
      asked.push(options.prefix);
      return pages[page++] || { objects: [] };
    },
    readObjectStart: async (): Promise<Uint8Array> => {
      throw new Error("A watched path never reads an object.");
    },
  };
}

describe("the paths a person names", () => {
  test("are read however they were pasted", () => {
    expect(
      readWatchedPaths(" /exports/orders/ \n\nevents/\nevents/\n"),
    ).toEqual(["exports/orders/", "events/"]);
  });

  test("anything else is none", () => {
    expect(readWatchedPaths(null)).toEqual([]);
    expect(readWatchedPaths(["a"])).toEqual([]);
  });

  test("are capped", () => {
    expect(
      readWatchedPaths(
        Array.from({ length: MAX_WATCHED_PATHS_PER_STORE + 5 })
          .map((_: unknown, index: number): string => {
            return `path-${index}/`;
          })
          .join("\n"),
      ),
    ).toHaveLength(MAX_WATCHED_PATHS_PER_STORE);
  });

  test("saved with nothing left, is nothing", () => {
    expect(normalizeWatchedPaths("  \n ")).toBeNull();
    expect(normalizeWatchedPaths("/a/\nb/")).toBe("a/\nb/");
  });

  test("only a bucket has them", () => {
    expect(isObjectStoreKind(DataStoreKind.AwsS3Bucket)).toBe(true);
    expect(isObjectStoreKind(DataStoreKind.GcpStorageBucket)).toBe(true);
    expect(isObjectStoreKind(DataStoreKind.AzureStorageAccount)).toBe(true);
    expect(isObjectStoreKind(DataStoreKind.PostgreSql)).toBe(false);
  });

  test("an Azure path starts with its container", () => {
    expect(
      readStoragePathTarget({
        kind: DataStoreKind.AzureStorageAccount,
        storeName: "acme",
        path: "exports/orders/",
      }),
    ).toEqual({ container: "exports", prefix: "orders/" });
    expect(
      readStoragePathTarget({
        kind: DataStoreKind.AzureStorageAccount,
        storeName: "acme",
        path: "exports",
      }),
    ).toEqual({ container: "exports", prefix: "" });
  });

  test("a bucket's path is a prefix of the bucket", () => {
    expect(
      readStoragePathTarget({
        kind: DataStoreKind.AwsS3Bucket,
        storeName: "acme-exports",
        path: "orders/",
      }),
    ).toEqual({ container: "acme-exports", prefix: "orders/" });
  });
});

describe("listing a path", () => {
  test("adds up its objects and finds the newest, page by page", async () => {
    const newest: Date = new Date(NOW.getTime() - 60_000);
    const reading: StoragePathReading = await readStoragePath(
      readerOf([
        {
          objects: [
            {
              key: "a",
              sizeInBytes: 10,
              lastModified: new Date(NOW.getTime() - 600_000),
            },
          ],
          nextToken: "next",
        },
        {
          objects: [
            { key: "b", sizeInBytes: 5, lastModified: newest },
            { key: "c", sizeInBytes: 1 },
          ],
        },
      ]),
      "orders/",
    );

    expect(reading).toEqual({
      objectCount: 3,
      sizeInBytes: 16,
      newestObjectAt: newest,
      isComplete: true,
    });
  });

  test("stops at its limit, and says so", async () => {
    const page: {
      objects: Array<{ key: string; sizeInBytes: number }>;
      nextToken: string;
    } = {
      objects: Array.from({ length: 1000 }).map(() => {
        return { key: "a", sizeInBytes: 1 };
      }),
      nextToken: "more",
    };
    const reading: StoragePathReading = await readStoragePath(
      readerOf(
        Array.from({ length: MAX_OBJECTS_LISTED_PER_PATH / 1000 + 5 }).map(
          () => {
            return page;
          },
        ),
      ),
      "orders/",
    );

    expect(reading.objectCount).toBe(MAX_OBJECTS_LISTED_PER_PATH);
    expect(reading.isComplete).toBe(false);
  });
});

describe("a path as a table", () => {
  test("its objects are its rows, its newest object its last change", () => {
    expect(
      toStoragePathTable({
        container: "acme-exports",
        prefix: "orders/",
        now: NOW,
        reading: {
          objectCount: 3,
          sizeInBytes: 16,
          newestObjectAt: new Date(NOW.getTime() - 60_000),
          isComplete: true,
        },
      }),
    ).toEqual({
      schema: "acme-exports",
      name: "orders/",
      kind: DataAssetKind.StoragePath,
      estimatedRows: 3,
      sizeInBytes: 16,
      writeCount: null,
      secondsSinceChange: 60,
      columns: null,
    });
  });

  test("a listing that was cut knows no count or size", () => {
    const table: ReturnType<typeof toStoragePathTable> = toStoragePathTable({
      container: "b",
      prefix: "",
      now: NOW,
      reading: {
        objectCount: 10_000,
        sizeInBytes: 1,
        newestObjectAt: null,
        isComplete: false,
      },
    });

    expect(table.name).toBe("/");
    expect(table.estimatedRows).toBeNull();
    expect(table.sizeInBytes).toBeNull();
    expect(table.secondsSinceChange).toBeNull();
  });
});

describe("collecting a bucket's paths", () => {
  test("an empty path warns, and a failed one keeps its table", async () => {
    const snapshot: TableHealthSnapshot = await collectStoragePaths({
      kind: DataStoreKind.AwsS3Bucket,
      storeName: "acme-exports",
      paths: ["empty/", "denied/"],
      now: NOW,
      openReader: (): ObjectStoreReader => {
        const empty: ObjectStoreReader = readerOf([{ objects: [] }]);

        return {
          ...empty,
          listObjects: async (options: {
            prefix?: string | undefined;
            maxKeys: number;
          }) => {
            if (options.prefix === "denied/") {
              throw new Error("AccessDenied");
            }

            return await empty.listObjects(options);
          },
        };
      },
    });

    expect(snapshot.engine).toBe("storage");
    expect(
      snapshot.tables.map((table: { name: string }) => {
        return table.name;
      }),
    ).toEqual(["empty/"]);
    // A list that failed proves nothing is gone.
    expect(snapshot.isComplete).toBe(false);
    expect(snapshot.warnings.join(" ")).toContain("empty/ holds no objects");
    expect(snapshot.warnings.join(" ")).toContain("AccessDenied");
  });
});
