import { DataStoreKind } from "../DataSecurity/DataStoreKind";

/*
 * THE PARTS OF A BUCKET WATCHED LIKE TABLES.
 *
 * Not everything a company relies on is in a database: an export that lands in
 * a bucket every night is as late, or as short, as any table. A person names
 * the paths that matter, one per line: each is listed at every collection, and
 * its newest object, its objects and their size become a table's last change,
 * rows and size. Nothing in an object is read.
 */

export const OBJECT_STORE_KINDS: ReadonlyArray<DataStoreKind> = [
  DataStoreKind.AwsS3Bucket,
  DataStoreKind.GcpStorageBucket,
  DataStoreKind.AzureStorageAccount,
];

export const MAX_WATCHED_PATHS_PER_STORE: number = 50;
const MAX_WATCHED_PATH_LENGTH: number = 500;

const LEADING_SLASHES: RegExp = /^\/+/;

export function isObjectStoreKind(kind: string | null | undefined): boolean {
  return OBJECT_STORE_KINDS.includes(kind as DataStoreKind);
}

// A store's paths, as it keeps them: one per line, however they were pasted.
export function readWatchedPaths(value: unknown): Array<string> {
  if (typeof value !== "string") {
    return [];
  }

  const paths: Set<string> = new Set();

  for (const line of value.split("\n")) {
    const path: string = line
      .trim()
      .replace(LEADING_SLASHES, "")
      .slice(0, MAX_WATCHED_PATH_LENGTH);

    if (path) {
      paths.add(path);
    }
  }

  return [...paths].slice(0, MAX_WATCHED_PATHS_PER_STORE);
}

// What is saved: the paths cleaned up, or nothing when none are left.
export function normalizeWatchedPaths(value: unknown): string | null {
  const paths: Array<string> = readWatchedPaths(value);

  return paths.length > 0 ? paths.join("\n") : null;
}

/*
 * What to list for a path, and what the table is called. An Azure storage
 * account holds containers, so a path there starts with its container's name.
 */
export function readStoragePathTarget(data: {
  kind: string | null | undefined;
  storeName: string;
  path: string;
}): { container: string; prefix: string } | null {
  if (data.kind !== DataStoreKind.AzureStorageAccount) {
    return { container: data.storeName, prefix: data.path };
  }

  const slash: number = data.path.indexOf("/");
  const container: string = slash < 0 ? data.path : data.path.slice(0, slash);

  return container
    ? { container, prefix: slash < 0 ? "" : data.path.slice(slash + 1) }
    : null;
}
