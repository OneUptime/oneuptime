import DataAssetKind from "../../../Types/DataObservability/DataAssetKind";
import { readStoragePathTarget } from "../../../Types/DataObservability/StoragePaths";
import { ObjectStoreReader } from "../DataSecurity/Cloud/DataSecurityCloudTypes";
import { CollectedTable, TableHealthSnapshot } from "./TableHealthCollector";

/*
 * ONE BUCKET'S WATCHED PATHS, READ AS TABLES.
 *
 * A path is listed page by page: names, sizes and times, never an object. A
 * bucket keeps no index of its newest object, so finding it means listing them
 * all. A listing is cut at MAX_OBJECTS_LISTED_PER_PATH, and says so: past that,
 * the count and the size are unknown and the newest object is only the newest
 * of those listed, which is why a narrower path is the answer.
 */

export const MAX_OBJECTS_LISTED_PER_PATH: number = 10_000;
const OBJECTS_PER_PAGE: number = 1000;

export interface StoragePathReading {
  objectCount: number;
  sizeInBytes: number;
  newestObjectAt: Date | null;
  isComplete: boolean;
}

export async function readStoragePath(
  reader: ObjectStoreReader,
  prefix: string,
): Promise<StoragePathReading> {
  const reading: StoragePathReading = {
    objectCount: 0,
    sizeInBytes: 0,
    newestObjectAt: null,
    isComplete: true,
  };
  let nextToken: string | undefined = undefined;

  do {
    const page: Awaited<ReturnType<ObjectStoreReader["listObjects"]>> =
      await reader.listObjects({
        prefix: prefix || undefined,
        nextToken,
        maxKeys: OBJECTS_PER_PAGE,
      });

    for (const object of page.objects) {
      reading.objectCount++;
      reading.sizeInBytes += object.sizeInBytes || 0;

      if (
        object.lastModified &&
        (!reading.newestObjectAt ||
          object.lastModified > reading.newestObjectAt)
      ) {
        reading.newestObjectAt = object.lastModified;
      }
    }

    nextToken = page.nextToken;

    if (nextToken && reading.objectCount >= MAX_OBJECTS_LISTED_PER_PATH) {
      reading.isComplete = false;
      break;
    }
  } while (nextToken);

  return reading;
}

export function toStoragePathTable(data: {
  container: string;
  prefix: string;
  reading: StoragePathReading;
  now: Date;
}): CollectedTable {
  const { reading } = data;

  return {
    schema: data.container,
    // The whole bucket or container, when its path names nothing further.
    name: data.prefix || "/",
    kind: DataAssetKind.StoragePath,
    estimatedRows: reading.isComplete ? reading.objectCount : null,
    sizeInBytes: reading.isComplete ? reading.sizeInBytes : null,
    writeCount: null,
    secondsSinceChange: reading.newestObjectAt
      ? Math.max(
          0,
          Math.floor(
            (data.now.getTime() - reading.newestObjectAt.getTime()) / 1000,
          ),
        )
      : null,
    columns: null,
  };
}

/*
 * A path that cannot be read is a warning, and the collection is then
 * incomplete: its table is kept, not called dropped because of a failed list.
 */
export async function collectStoragePaths(data: {
  kind: string | null | undefined;
  storeName: string;
  paths: ReadonlyArray<string>;
  openReader: (container: string) => ObjectStoreReader;
  now: Date;
}): Promise<TableHealthSnapshot> {
  const tables: Array<CollectedTable> = [];
  const warnings: Array<string> = [];
  let isComplete: boolean = true;

  for (const path of data.paths) {
    const target: { container: string; prefix: string } | null =
      readStoragePathTarget({
        kind: data.kind,
        storeName: data.storeName,
        path,
      });

    if (!target) {
      warnings.push(`${path} names no container.`);
      continue;
    }

    try {
      const reading: StoragePathReading = await readStoragePath(
        data.openReader(target.container),
        target.prefix,
      );

      if (!reading.isComplete) {
        warnings.push(
          `${path} holds more than ${MAX_OBJECTS_LISTED_PER_PATH} objects, so its count, size and newest object are not exact. Name a narrower path.`,
        );
      } else if (reading.objectCount === 0) {
        warnings.push(`${path} holds no objects.`);
      }

      tables.push({
        ...toStoragePathTable({ ...target, reading, now: data.now }),
      });
    } catch (error) {
      isComplete = false;
      warnings.push(
        `${path} could not be listed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return {
    engine: "storage",
    collectedAt: data.now.toISOString(),
    tables,
    isComplete,
    warnings,
  };
}
