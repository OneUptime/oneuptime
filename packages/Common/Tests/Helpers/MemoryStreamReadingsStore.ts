import {
  CloudStreamReadingsStore,
  StreamedReadingMinute,
  mergeStreamedReadingMinute,
  readStreamedReadingPeriod,
  writeStreamedReadingPeriod,
} from "../../Server/Utils/CloudConnection/CloudStreamReadings";

/*
 * Where a streaming account's readings are kept (CloudStreamReadings), in
 * memory: it merges a minute as the Redis store's script does, and keeps
 * a source's newest minute only when newer - so the ingest's and the
 * read's tests read what Redis would hold.
 */
export interface MemoryStreamReadingsStore extends CloudStreamReadingsStore {
  hashes: Map<string, Record<string, string>>;
  ttls: Map<string, number>;
}

export function createMemoryStreamReadingsStore(): MemoryStreamReadingsStore {
  const hashes: Map<string, Record<string, string>> = new Map();
  const ttls: Map<string, number> = new Map();

  return {
    hashes,
    ttls,
    merge: async (
      key: string,
      entries: Array<{ field: string; minute: StreamedReadingMinute }>,
      ttlSeconds: number,
    ): Promise<void> => {
      const hash: Record<string, string> = hashes.get(key) || {};

      for (const entry of entries) {
        hash[entry.field] = writeStreamedReadingPeriod(
          mergeStreamedReadingMinute(
            readStreamedReadingPeriod(hash[entry.field]),
            entry.minute,
          ),
        );
      }

      hashes.set(key, hash);
      ttls.set(key, ttlSeconds);
    },
    noteNewest: async (
      key: string,
      newest: Record<string, number>,
      ttlSeconds: number,
    ): Promise<void> => {
      const hash: Record<string, string> = hashes.get(key) || {};

      for (const [source, minuteMs] of Object.entries(newest)) {
        if (!hash[source] || Number(hash[source]) < minuteMs) {
          hash[source] = String(minuteMs);
        }
      }

      hashes.set(key, hash);
      ttls.set(key, ttlSeconds);
    },
    readHashes: async (
      keys: Array<string>,
    ): Promise<Array<Record<string, string>>> => {
      return keys.map((key: string): Record<string, string> => {
        return hashes.get(key) || {};
      });
    },
  };
}
