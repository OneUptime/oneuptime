import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import {
  clearCachesAfterRestore,
  RESTORE_CLEARED_CACHE_PREFIXES,
} from "../../../Server/Backup/BackupCaches";
import { ClientType } from "Common/Server/Infrastructure/Redis";
import logger from "Common/Server/Utils/Logger";

/*
 * After a restore, the permissions OneUptime keeps in Valkey for every
 * signed-in user were built from the data before it: they go, and are
 * rebuilt from the restored data on the next request. Nothing else in
 * Valkey goes - the job queues, sessions and locks stay.
 */

class FakeValkey {
  public keys: Set<string>;
  public scans: number = 0;
  /*
   * What a scan walks: the keys as they were when it started. SCAN hands
   * out every key there for the whole scan, whatever is deleted between its
   * pages - its cursor is a position in the hash table, not in what is left.
   */
  private walks: Map<string, Array<string>> = new Map<string, Array<string>>();

  public constructor(keys: Array<string>) {
    this.keys = new Set<string>(keys);
  }

  // SCAN cursor MATCH pattern COUNT n: two keys a page.
  public async scan(
    cursor: string,
    _match: string,
    pattern: string,
    _count: string,
    _size: number,
  ): Promise<[string, Array<string>]> {
    this.scans++;

    const prefix: string = pattern.endsWith("*")
      ? pattern.slice(0, -1)
      : pattern;

    if (cursor === "0") {
      this.walks.set(
        pattern,
        Array.from(this.keys)
          .filter((key: string): boolean => {
            return key.startsWith(prefix);
          })
          .sort(),
      );
    }

    const walk: Array<string> = this.walks.get(pattern) || [];
    const start: number = Number(cursor);
    const page: Array<string> = walk.slice(start, start + 2);
    const next: number = start + 2;

    return [next >= walk.length ? "0" : String(next), page];
  }

  public async unlink(...keys: Array<string>): Promise<number> {
    let removed: number = 0;

    for (const key of keys) {
      if (this.keys.delete(key)) {
        removed++;
      }
    }

    return removed;
  }
}

describe("clearCachesAfterRestore", () => {
  beforeEach(() => {
    jest.spyOn(logger, "warn").mockImplementation((): void => {
      return undefined;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("clears the cached global and project permissions, every page of them, and nothing else", async () => {
    const valkey: FakeValkey = new FakeValkey([
      "global-permissions-u1",
      "global-permissions-u2",
      "global-permissions-u3",
      "project-permissions-u1-p1",
      "project-permissions-u2-p1",
      "bull:Workers:id",
      "session-abc",
      "semaphore-backups-runner",
    ]);

    expect(await clearCachesAfterRestore(valkey as unknown as ClientType)).toBe(
      5,
    );
    expect(Array.from(valkey.keys).sort()).toEqual([
      "bull:Workers:id",
      "semaphore-backups-runner",
      "session-abc",
    ]);
  });

  test("names exactly the permission caches", () => {
    expect([...RESTORE_CLEARED_CACHE_PREFIXES].sort()).toEqual([
      "global-permissions-",
      "project-permissions-",
    ]);
  });

  test("with Valkey not connected, clears nothing and says how the caches go", async () => {
    const warned: jest.SpiedFunction<typeof logger.warn> = jest.spyOn(
      logger,
      "warn",
    );

    expect(await clearCachesAfterRestore(null)).toBe(0);
    expect(String(warned.mock.calls[0]![0])).toContain(
      "restart OneUptime to clear them now",
    );
  });
});
