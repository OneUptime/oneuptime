import { gunzipSync, gzipSync, strFromU8, strToU8 } from "fflate";
import { decodeBase64, encodeBase64 } from "./Base64";
import {
  SESSION_REPLAY_MAX_OFFLINE_DELAY_MS,
  SessionReplayChunkEnvelope,
} from "./Contract";
import { byteLength } from "./Sanitize";
import { ReplayStorage } from "./Storage";

/*
 * The durable upload queue, and so the whole of offline mode's memory: every
 * frame is written here BEFORE it is posted, and removed only once the
 * server has it (or refused it for good). An app that loses its connection
 * keeps recording into this outbox, and an app that is killed while offline
 * finds its backlog here on the next launch.
 *
 * One AsyncStorage key per frame, plus a small index. The first version kept
 * the whole outbox as ONE JSON array under one key, which on Android is a
 * single SQLite row - and AsyncStorage cannot read a row larger than the
 * 2 MB CursorWindow back. An offline backlog past that size failed to read,
 * and a failed read discarded the lot: the longer the outage, the more
 * certainly everything recorded during it was lost. Per-frame keys keep
 * every value to one frame, and writing a frame no longer rewrites every
 * other frame with it.
 *
 * Frames are stored gzip-compressed (base64, since AsyncStorage stores
 * strings). A view-tree frame compresses several times over, and Android's
 * AsyncStorage database is 6 MB by default and shared with the host app, so
 * compression is what turns the bound below into an hour of recording
 * rather than a few minutes - without taking the app's own storage.
 */

export const MAX_OUTBOX_ENTRIES: number = 240;
export const MAX_OUTBOX_BYTES: number = 3 * 1024 * 1024;

export interface PersistedReplayFrame {
  id: string;
  envelope: SessionReplayChunkEnvelope;
  payload: string;
  attempts: number;
  createdAtUnixMs: number;
}

/* What the index keeps per frame: enough to order, bound and retry it. */
export interface OutboxEntry {
  id: string;
  attempts: number;
  createdAtUnixMs: number;

  /* Stored size of the frame's value, which is what the bound counts. */
  bytes: number;
}

/* A frame as the transport posts it: its payload already gzip-compressed. */
export interface StoredReplayFrame {
  id: string;
  envelope: SessionReplayChunkEnvelope;
  compressedPayload: Uint8Array;
  attempts: number;
  createdAtUnixMs: number;
}

export interface OutboxMutationResult {
  dropped: number;
}

interface FrameValue {
  envelope: SessionReplayChunkEnvelope;
  gzip: string;
}

function isEnvelope(value: unknown): value is SessionReplayChunkEnvelope {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const envelope: Partial<SessionReplayChunkEnvelope> =
    value as Partial<SessionReplayChunkEnvelope>;
  return (
    typeof envelope.sessionId === "string" &&
    typeof envelope.tabId === "string" &&
    typeof envelope.chunkIndex === "number"
  );
}

function isEntry(value: unknown): value is OutboxEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const entry: Partial<OutboxEntry> = value as Partial<OutboxEntry>;
  return (
    typeof entry.id === "string" &&
    Number.isSafeInteger(entry.attempts) &&
    typeof entry.createdAtUnixMs === "number" &&
    Number.isFinite(entry.createdAtUnixMs) &&
    Number.isSafeInteger(entry.bytes)
  );
}

/* The single-key layout this file replaced, read once to migrate it. */
function isLegacyFrame(value: unknown): value is PersistedReplayFrame {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const frame: Partial<PersistedReplayFrame> =
    value as Partial<PersistedReplayFrame>;
  return (
    typeof frame.id === "string" &&
    typeof frame.payload === "string" &&
    typeof frame.attempts === "number" &&
    Number.isSafeInteger(frame.attempts) &&
    typeof frame.createdAtUnixMs === "number" &&
    isEnvelope(frame.envelope)
  );
}

function byOldest(left: OutboxEntry, right: OutboxEntry): number {
  return left.createdAtUnixMs - right.createdAtUnixMs;
}

export function frameId(envelope: SessionReplayChunkEnvelope): string {
  return `${envelope.sessionId}:${envelope.tabId}:${envelope.chunkIndex}`;
}

export default class ReplayOutbox {
  private readonly storage: ReplayStorage;
  private readonly legacyKey: string;
  private readonly indexKey: string;
  private readonly framePrefix: string;
  private readonly now: () => number;
  private mutationQueue: Promise<void> = Promise.resolve();
  private migrated: boolean = false;

  public constructor(
    storage: ReplayStorage,
    namespace: string,
    now: () => number = Date.now,
  ) {
    this.storage = storage;
    this.legacyKey = `@oneuptime/replay/${namespace}/outbox`;
    this.indexKey = `@oneuptime/replay/${namespace}/outbox-v2`;
    this.framePrefix = `@oneuptime/replay/${namespace}/outbox-v2/`;
    this.now = now;
  }

  /* Every queued frame's index entry, oldest first. Reads no payload. */
  public async entries(): Promise<Array<OutboxEntry>> {
    return await this.withLock(async (): Promise<Array<OutboxEntry>> => {
      return await this.readIndexUnlocked();
    });
  }

  /*
   * One frame, ready to post. Null when it is no longer queued, and
   * "unreadable" when its value could not be read back - it is removed, so
   * one damaged frame never blocks the ones behind it.
   */
  public async load(
    id: string,
  ): Promise<StoredReplayFrame | "unreadable" | null> {
    return await this.withLock(
      async (): Promise<StoredReplayFrame | "unreadable" | null> => {
        const entries: Array<OutboxEntry> = await this.readIndexUnlocked();
        const entry: OutboxEntry | undefined = entries.find(
          (candidate: OutboxEntry): boolean => {
            return candidate.id === id;
          },
        );
        if (!entry) {
          return null;
        }

        const value: {
          envelope: SessionReplayChunkEnvelope;
          bytes: Uint8Array;
        } | null = await this.readFrameUnlocked(id);
        if (!value) {
          await this.removeEntriesUnlocked(entries, [id]);
          return "unreadable";
        }

        return {
          id,
          envelope: value.envelope,
          compressedPayload: value.bytes,
          attempts: entry.attempts,
          createdAtUnixMs: entry.createdAtUnixMs,
        };
      },
    );
  }

  /* Every frame with its payload decompressed, oldest first. */
  public async list(): Promise<Array<PersistedReplayFrame>> {
    const frames: Array<PersistedReplayFrame> = [];

    for (const entry of await this.entries()) {
      const frame: StoredReplayFrame | "unreadable" | null = await this.load(
        entry.id,
      );
      if (!frame || frame === "unreadable") {
        continue;
      }

      frames.push({
        id: frame.id,
        envelope: frame.envelope,
        payload: strFromU8(gunzipSync(frame.compressedPayload)),
        attempts: frame.attempts,
        createdAtUnixMs: frame.createdAtUnixMs,
      });
    }

    return frames;
  }

  /*
   * Queue a frame. Past MAX_OUTBOX_ENTRIES or MAX_OUTBOX_BYTES the OLDEST
   * frames are evicted - the newest seconds are the ones closest to whatever
   * went wrong, and a later full snapshot re-anchors the player after a gap -
   * and counted in `dropped`, as is a frame the device had no room to store.
   */
  public async enqueue(
    frame: PersistedReplayFrame,
  ): Promise<OutboxMutationResult> {
    return await this.withLock(async (): Promise<OutboxMutationResult> => {
      const entries: Array<OutboxEntry> = await this.readIndexUnlocked();
      if (
        entries.some((candidate: OutboxEntry): boolean => {
          return candidate.id === frame.id;
        })
      ) {
        return { dropped: 0 };
      }

      const bytes: number | null = await this.writeFrameUnlocked(frame);
      if (bytes === null) {
        return { dropped: 1 };
      }

      entries.push({
        id: frame.id,
        attempts: frame.attempts,
        createdAtUnixMs: frame.createdAtUnixMs,
        bytes,
      });
      entries.sort(byOldest);

      let totalBytes: number = 0;
      for (const entry of entries) {
        totalBytes += entry.bytes;
      }

      const evicted: Array<string> = [];
      while (
        entries.length > 1 &&
        (entries.length > MAX_OUTBOX_ENTRIES || totalBytes > MAX_OUTBOX_BYTES)
      ) {
        const oldest: OutboxEntry = entries.shift() as OutboxEntry;
        totalBytes -= oldest.bytes;
        evicted.push(oldest.id);
      }

      if (!(await this.writeIndexUnlocked(entries))) {
        /* The index is full too: the frame we just wrote is untracked. */
        await this.safeRemove(this.frameKey(frame.id));
        return { dropped: 1 };
      }

      await Promise.all(
        evicted.map((id: string): Promise<void> => {
          return this.safeRemove(this.frameKey(id));
        }),
      );
      return { dropped: evicted.length };
    });
  }

  public async remove(id: string): Promise<void> {
    await this.withLock(async (): Promise<void> => {
      await this.removeEntriesUnlocked(await this.readIndexUnlocked(), [id]);
    });
  }

  public async incrementAttempts(id: string): Promise<number> {
    return await this.withLock(async (): Promise<number> => {
      const entries: Array<OutboxEntry> = await this.readIndexUnlocked();
      let attempts: number = 0;
      for (const entry of entries) {
        if (entry.id === id) {
          entry.attempts += 1;
          attempts = entry.attempts;
          break;
        }
      }

      await this.writeIndexUnlocked(entries);
      return attempts;
    });
  }

  /*
   * Consent withdrawn, or the server refused this recorder for good: every
   * frame goes, including any a crash left untracked by the index when the
   * storage can list its keys.
   */
  public async clear(): Promise<void> {
    await this.withLock(async (): Promise<void> => {
      const keys: Set<string> = new Set<string>([
        this.legacyKey,
        this.indexKey,
      ]);

      for (const entry of await this.readRawIndexUnlocked()) {
        keys.add(this.frameKey(entry.id));
      }

      if (typeof this.storage.getAllKeys === "function") {
        try {
          for (const key of await this.storage.getAllKeys()) {
            if (key.startsWith(this.framePrefix)) {
              keys.add(key);
            }
          }
        } catch {
          /* Best effort: the index already named every tracked frame. */
        }
      }

      this.migrated = true;
      await Promise.all(
        Array.from(keys).map((key: string): Promise<void> => {
          return this.safeRemove(key);
        }),
      );
    });
  }

  private frameKey(id: string): string {
    return `${this.framePrefix}${id}`;
  }

  /*
   * The index, with the legacy layout migrated into it on first use and
   * anything older than SESSION_REPLAY_MAX_OFFLINE_DELAY_MS pruned: the
   * server would no longer place it on the recording's real timeline.
   */
  private async readIndexUnlocked(): Promise<Array<OutboxEntry>> {
    await this.migrateUnlocked();

    const entries: Array<OutboxEntry> = await this.readRawIndexUnlocked();
    const oldestKept: number = this.now() - SESSION_REPLAY_MAX_OFFLINE_DELAY_MS;
    const expired: Array<string> = entries
      .filter((entry: OutboxEntry): boolean => {
        return entry.createdAtUnixMs < oldestKept;
      })
      .map((entry: OutboxEntry): string => {
        return entry.id;
      });

    if (expired.length > 0) {
      await this.removeEntriesUnlocked(entries, expired);
    }

    return entries.sort(byOldest);
  }

  private async readRawIndexUnlocked(): Promise<Array<OutboxEntry>> {
    let raw: string | null = null;
    try {
      raw = await this.storage.getItem(this.indexKey);
    } catch {
      raw = null;
    }
    if (!raw) {
      return [];
    }

    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.every(isEntry)) {
        return parsed;
      }
    } catch {
      /* Falls through to the reset below. */
    }

    await this.safeRemove(this.indexKey);
    return [];
  }

  private async writeIndexUnlocked(
    entries: Array<OutboxEntry>,
  ): Promise<boolean> {
    if (entries.length === 0) {
      await this.safeRemove(this.indexKey);
      return true;
    }

    return await this.safeSet(this.indexKey, JSON.stringify(entries));
  }

  /* Drop entries from the index and their frames from storage. */
  private async removeEntriesUnlocked(
    entries: Array<OutboxEntry>,
    ids: Array<string>,
  ): Promise<void> {
    const removing: Set<string> = new Set<string>(ids);
    const kept: Array<OutboxEntry> = entries.filter(
      (entry: OutboxEntry): boolean => {
        return !removing.has(entry.id);
      },
    );

    entries.splice(0, entries.length, ...kept);
    await this.writeIndexUnlocked(entries);
    await Promise.all(
      ids.map((id: string): Promise<void> => {
        return this.safeRemove(this.frameKey(id));
      }),
    );
  }

  /* Store one frame's value. Its size, or null when it could not be stored. */
  private async writeFrameUnlocked(
    frame: PersistedReplayFrame,
  ): Promise<number | null> {
    let value: string;
    try {
      const stored: FrameValue = {
        envelope: frame.envelope,
        gzip: encodeBase64(gzipSync(strToU8(frame.payload))),
      };
      value = JSON.stringify(stored);
    } catch {
      return null;
    }

    return (await this.safeSet(this.frameKey(frame.id), value))
      ? byteLength(value)
      : null;
  }

  private async readFrameUnlocked(id: string): Promise<{
    envelope: SessionReplayChunkEnvelope;
    bytes: Uint8Array;
  } | null> {
    try {
      const raw: string | null = await this.storage.getItem(this.frameKey(id));
      if (!raw) {
        return null;
      }

      const parsed: Partial<FrameValue> = JSON.parse(
        raw,
      ) as Partial<FrameValue>;
      const bytes: Uint8Array | null =
        typeof parsed.gzip === "string" ? decodeBase64(parsed.gzip) : null;
      if (!bytes || !isEnvelope(parsed.envelope)) {
        return null;
      }

      return { envelope: parsed.envelope, bytes };
    } catch {
      /* Unreadable - on Android, a value past the CursorWindow limit. */
      return null;
    }
  }

  /*
   * Move a queue written by an earlier SDK version (one JSON array under the
   * legacy key) into this layout, once. A legacy queue too large to read -
   * the very failure this layout exists to fix - cannot be recovered, only
   * removed so it stops failing.
   */
  private async migrateUnlocked(): Promise<void> {
    if (this.migrated) {
      return;
    }
    this.migrated = true;

    let raw: string | null = null;
    try {
      raw = await this.storage.getItem(this.legacyKey);
    } catch {
      await this.safeRemove(this.legacyKey);
      return;
    }
    if (!raw) {
      return;
    }

    let legacy: Array<PersistedReplayFrame> = [];
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        legacy = parsed.filter(isLegacyFrame);
      }
    } catch {
      legacy = [];
    }

    const entries: Array<OutboxEntry> = await this.readRawIndexUnlocked();
    for (const frame of legacy) {
      if (
        entries.some((entry: OutboxEntry): boolean => {
          return entry.id === frame.id;
        })
      ) {
        continue;
      }

      const bytes: number | null = await this.writeFrameUnlocked(frame);
      if (bytes !== null) {
        entries.push({
          id: frame.id,
          attempts: frame.attempts,
          createdAtUnixMs: frame.createdAtUnixMs,
          bytes,
        });
      }
    }

    await this.writeIndexUnlocked(entries.sort(byOldest));
    await this.safeRemove(this.legacyKey);
  }

  private async safeSet(key: string, value: string): Promise<boolean> {
    try {
      await this.storage.setItem(key, value);
      return true;
    } catch {
      /* Recording must never destabilise the host app when storage is full. */
      return false;
    }
  }

  private async safeRemove(key: string): Promise<void> {
    try {
      await this.storage.removeItem(key);
    } catch {
      /* Best-effort privacy cleanup. */
    }
  }

  private async withLock<T>(operation: () => Promise<T>): Promise<T> {
    const result: Promise<T> = this.mutationQueue.then(operation, operation);
    this.mutationQueue = result.then(
      (): void => {
        return undefined;
      },
      (): void => {
        return undefined;
      },
    );
    return await result;
  }
}
