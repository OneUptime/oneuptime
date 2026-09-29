import { randomBytes } from "crypto";
import { gunzipSync, strFromU8 } from "fflate";
import { decodeBase64, encodeBase64 } from "../src/Base64";
import {
  SESSION_REPLAY_MAX_OFFLINE_DELAY_MS,
  SessionReplayChunkEnvelope,
} from "../src/Contract";
import ReplayOutbox, {
  frameId,
  MAX_OUTBOX_BYTES,
  MAX_OUTBOX_ENTRIES,
  OutboxEntry,
  PersistedReplayFrame,
  StoredReplayFrame,
} from "../src/Outbox";
import { ReplayStorage } from "../src/Storage";
import { envelope, MemoryStorage } from "./TestUtils";

/* Frames are stamped relative to this, and the outbox's clock reads it. */
const NOW: number = 1_750_000_000_000;

function frame(
  index: number,
  createdAtUnixMs: number = NOW + index,
  payload: string = JSON.stringify([{ index }]),
): PersistedReplayFrame {
  const frameEnvelope: SessionReplayChunkEnvelope = envelope({
    chunkIndex: index,
  });
  return {
    id: frameId(frameEnvelope),
    envelope: frameEnvelope,
    payload,
    attempts: 0,
    createdAtUnixMs,
  };
}

function outboxOver(
  storage: ReplayStorage,
  now: () => number = (): number => {
    return NOW;
  },
): ReplayOutbox {
  return new ReplayOutbox(storage, "app", now);
}

async function indexes(outbox: ReplayOutbox): Promise<Array<number>> {
  return (await outbox.list()).map((item: PersistedReplayFrame): number => {
    return item.envelope.chunkIndex;
  });
}

/* Random text gzip cannot shrink: the worst case for every bound. */
function incompressible(length: number): string {
  return randomBytes(Math.ceil((length * 3) / 4))
    .toString("base64")
    .slice(0, length);
}

/* Every read and write takes a few milliseconds, like a real disk. */
class DelayedStorage extends MemoryStorage {
  private async delay(): Promise<void> {
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 5);
    });
  }

  public override async getItem(key: string): Promise<string | null> {
    await this.delay();
    return await super.getItem(key);
  }

  public override async setItem(key: string, value: string): Promise<void> {
    await this.delay();
    await super.setItem(key, value);
  }

  public override async removeItem(key: string): Promise<void> {
    await this.delay();
    await super.removeItem(key);
  }
}

/*
 * AsyncStorage on Android: SQLite, read through a CursorWindow that cannot
 * hold a row larger than 2 MB. Writing one succeeds; reading it back throws
 * "Row too big to fit into CursorWindow".
 */
const ANDROID_ROW_LIMIT_BYTES: number = 2 * 1024 * 1024;

class AndroidAsyncStorage extends MemoryStorage {
  public override async getItem(key: string): Promise<string | null> {
    const value: string | null = await super.getItem(key);
    if (value !== null && value.length > ANDROID_ROW_LIMIT_BYTES) {
      throw new Error("Row too big to fit into CursorWindow");
    }
    return value;
  }
}

/* A device whose storage is full: every write fails. */
class FullStorage extends MemoryStorage {
  public override async setItem(): Promise<void> {
    throw new Error("database or disk is full");
  }
}

class ListableStorage extends MemoryStorage {
  public async getAllKeys(): Promise<ReadonlyArray<string>> {
    return Array.from(this.values.keys());
  }
}

describe("AsyncStorage replay outbox", () => {
  test("persists FIFO frames before upload and deduplicates frame identity", async () => {
    const outbox: ReplayOutbox = outboxOver(new MemoryStorage());
    await outbox.enqueue(frame(2, NOW + 20));
    await outbox.enqueue(frame(1, NOW + 10));
    await outbox.enqueue(frame(1, NOW + 10));
    expect(await indexes(outbox)).toEqual([1, 2]);
  });

  test("tracks attempts, removes acknowledgements, and clears on revoke", async () => {
    const storage: MemoryStorage = new MemoryStorage();
    const outbox: ReplayOutbox = outboxOver(storage);
    const item: PersistedReplayFrame = frame(0);
    await outbox.enqueue(item);
    expect(await outbox.incrementAttempts(item.id)).toBe(1);
    expect((await outbox.list())[0]?.attempts).toBe(1);
    await outbox.remove(item.id);
    expect(await outbox.list()).toEqual([]);
    await outbox.enqueue(item);
    await outbox.clear();
    expect(storage.values.size).toBe(0);
  });

  test("corrupt untrusted persisted data is discarded", async () => {
    const storage: MemoryStorage = new MemoryStorage();
    storage.values.set("@oneuptime/replay/app/outbox", '{"payload":"secret"}');
    storage.values.set("@oneuptime/replay/app/outbox-v2", '{"not":"a list"}');
    const outbox: ReplayOutbox = outboxOver(storage);
    expect(await outbox.list()).toEqual([]);
    expect(storage.values.size).toBe(0);
  });

  test("serializes concurrent read-modify-write operations without lost frames", async () => {
    const storage: DelayedStorage = new DelayedStorage();
    const outbox: ReplayOutbox = outboxOver(storage);
    await Promise.all([
      outbox.enqueue(frame(0)),
      outbox.enqueue(frame(1)),
      outbox.enqueue(frame(2)),
      outbox.enqueue(frame(3)),
    ]);
    expect(await indexes(outbox)).toEqual([0, 1, 2, 3]);
  });

  test("bounds offline persistence by frame count and reports evictions", async () => {
    const outbox: ReplayOutbox = outboxOver(new MemoryStorage());
    let dropped: number = 0;
    for (let index: number = 0; index < MAX_OUTBOX_ENTRIES + 6; index += 1) {
      dropped += (await outbox.enqueue(frame(index))).dropped;
    }
    expect(dropped).toBe(6);
    const remaining: Array<OutboxEntry> = await outbox.entries();
    expect(remaining).toHaveLength(MAX_OUTBOX_ENTRIES);
    expect((await outbox.list())[0]?.envelope.chunkIndex).toBe(6);
  });

  /*
   * Offline mode's first real bug. The whole outbox used to be ONE value,
   * and on Android a value past 2 MB cannot be read back: an outage long
   * enough to queue that much lost everything queued during it.
   */
  describe("on Android's AsyncStorage", () => {
    test("keeps a backlog far larger than one row can hold", async () => {
      const storage: AndroidAsyncStorage = new AndroidAsyncStorage();
      const outbox: ReplayOutbox = outboxOver(storage);

      /* Twenty frames of 128 KB: 2.5 MB of payload in all. */
      for (let index: number = 0; index < 20; index += 1) {
        await outbox.enqueue(
          frame(
            index,
            NOW + index,
            JSON.stringify([incompressible(128 * 1024)]),
          ),
        );
      }

      const frames: Array<PersistedReplayFrame> = await outbox.list();

      expect(frames.length).toBeGreaterThan(0);
      expect(
        frames.map((item: PersistedReplayFrame): number => {
          return item.envelope.chunkIndex;
        }),
      ).toEqual(
        Array.from({ length: frames.length }, (_: unknown, offset: number) => {
          return 20 - frames.length + offset;
        }),
      );

      /* No single stored value is anywhere near the row limit. */
      for (const value of storage.values.values()) {
        expect(value.length).toBeLessThan(ANDROID_ROW_LIMIT_BYTES / 4);
      }
    });

    test("never lets one value grow past the row limit, however long the outage", async () => {
      const storage: AndroidAsyncStorage = new AndroidAsyncStorage();
      const outbox: ReplayOutbox = outboxOver(storage);

      for (let index: number = 0; index < MAX_OUTBOX_ENTRIES; index += 1) {
        await outbox.enqueue(
          frame(index, NOW + index, "[" + '{"n":1},'.repeat(400) + "{}]"),
        );
      }

      expect(await outbox.entries()).toHaveLength(MAX_OUTBOX_ENTRIES);
      for (const value of storage.values.values()) {
        expect(value.length).toBeLessThan(ANDROID_ROW_LIMIT_BYTES);
      }
    });

    test("drops a single frame it cannot read back, and keeps the rest", async () => {
      const storage: MemoryStorage = new MemoryStorage();
      const outbox: ReplayOutbox = outboxOver(storage);
      await outbox.enqueue(frame(0));
      await outbox.enqueue(frame(1));
      await outbox.enqueue(frame(2));

      storage.values.set(
        `@oneuptime/replay/app/outbox-v2/${frame(1).id}`,
        '{"envelope":{},"gzip":"%%%"}',
      );

      expect(await outbox.load(frame(1).id)).toBe("unreadable");
      expect(await indexes(outbox)).toEqual([0, 2]);
    });

    test("migrates a queue written by the single-key layout", async () => {
      const storage: MemoryStorage = new MemoryStorage();
      storage.values.set(
        "@oneuptime/replay/app/outbox",
        JSON.stringify([frame(4), frame(3)]),
      );
      const outbox: ReplayOutbox = outboxOver(storage);

      expect(await indexes(outbox)).toEqual([3, 4]);
      expect(storage.values.has("@oneuptime/replay/app/outbox")).toBe(false);
      expect((await outbox.list())[0]?.payload).toBe(frame(3).payload);
    });

    test("removes a single-key queue too large to read, so it stops failing", async () => {
      const storage: AndroidAsyncStorage = new AndroidAsyncStorage();
      storage.values.set(
        "@oneuptime/replay/app/outbox",
        "x".repeat(ANDROID_ROW_LIMIT_BYTES + 1),
      );
      const outbox: ReplayOutbox = outboxOver(storage);

      expect(await outbox.list()).toEqual([]);
      expect(storage.values.has("@oneuptime/replay/app/outbox")).toBe(false);

      /* And the outbox works normally from then on. */
      await outbox.enqueue(frame(0));
      expect(await indexes(outbox)).toEqual([0]);
    });
  });

  describe("storage cost", () => {
    test("stores each frame gzip-compressed, and hands the transport the gzip bytes", async () => {
      const storage: MemoryStorage = new MemoryStorage();
      const outbox: ReplayOutbox = outboxOver(storage);
      const repetitive: string = JSON.stringify(
        Array.from({ length: 2_000 }, (_: unknown, index: number) => {
          return {
            type: 3,
            data: { source: 0, id: index % 7, text: "masked" },
          };
        }),
      );
      const item: PersistedReplayFrame = frame(0, NOW, repetitive);

      await outbox.enqueue(item);

      const stored: string = storage.values.get(
        `@oneuptime/replay/app/outbox-v2/${item.id}`,
      ) as string;

      /* Several times smaller than the JSON it holds. */
      expect(stored.length * 4).toBeLessThan(repetitive.length);

      const loaded: StoredReplayFrame = (await outbox.load(
        item.id,
      )) as StoredReplayFrame;

      expect(strFromU8(gunzipSync(loaded.compressedPayload))).toBe(repetitive);
      expect(loaded.envelope).toEqual(item.envelope);
    });

    test("bounds the stored bytes, evicting the oldest frames first", async () => {
      const outbox: ReplayOutbox = outboxOver(new MemoryStorage());

      let dropped: number = 0;
      /* 14 incompressible frames: about 3.5 MB stored against a 3 MB bound. */
      for (let index: number = 0; index < 14; index += 1) {
        dropped += (
          await outbox.enqueue(
            frame(index, NOW + index, incompressible(256 * 1024)),
          )
        ).dropped;
      }

      const entries: Array<OutboxEntry> = await outbox.entries();
      const stored: number = entries.reduce(
        (total: number, entry: OutboxEntry): number => {
          return total + entry.bytes;
        },
        0,
      );

      expect(dropped).toBeGreaterThan(0);
      expect(stored).toBeLessThanOrEqual(MAX_OUTBOX_BYTES);
      expect((await indexes(outbox)).pop()).toBe(13);
    });

    test("reports a frame the device had no room to store as dropped", async () => {
      const outbox: ReplayOutbox = outboxOver(new FullStorage());

      expect((await outbox.enqueue(frame(0))).dropped).toBe(1);
      expect(await outbox.list()).toEqual([]);
    });
  });

  describe("expiry", () => {
    test("discards frames older than the offline delay", async () => {
      let now: number = NOW;
      const storage: MemoryStorage = new MemoryStorage();
      const outbox: ReplayOutbox = outboxOver(storage, (): number => {
        return now;
      });

      await outbox.enqueue(frame(0, NOW));
      await outbox.enqueue(frame(1, NOW + 60_000));

      now = NOW + SESSION_REPLAY_MAX_OFFLINE_DELAY_MS + 1;

      expect(await indexes(outbox)).toEqual([1]);
      expect(
        storage.values.has(`@oneuptime/replay/app/outbox-v2/${frame(0).id}`),
      ).toBe(false);
    });

    test("keeps a frame right up to the offline delay", async () => {
      const outbox: ReplayOutbox = outboxOver(
        new MemoryStorage(),
        (): number => {
          return NOW + SESSION_REPLAY_MAX_OFFLINE_DELAY_MS;
        },
      );

      await outbox.enqueue(frame(0, NOW));

      expect(await indexes(outbox)).toEqual([0]);
    });
  });

  test("clear also removes frames a crash left untracked by the index", async () => {
    const storage: ListableStorage = new ListableStorage();
    const outbox: ReplayOutbox = outboxOver(storage);

    await outbox.enqueue(frame(0));
    storage.values.set("@oneuptime/replay/app/outbox-v2/orphan", "{}");
    storage.values.set("@oneuptime/replay/other-app/outbox-v2/kept", "{}");

    await outbox.clear();

    expect(Array.from(storage.values.keys())).toEqual([
      "@oneuptime/replay/other-app/outbox-v2/kept",
    ]);
  });

  test("entries() reads no payload", async () => {
    const storage: MemoryStorage = new MemoryStorage();
    const outbox: ReplayOutbox = outboxOver(storage);
    await outbox.enqueue(frame(0));
    await outbox.enqueue(frame(1));

    const reads: jest.SpyInstance = jest.spyOn(storage, "getItem");
    const entries: Array<OutboxEntry> = await outbox.entries();

    expect(entries).toHaveLength(2);
    expect(
      reads.mock.calls.map((call: Array<unknown>): unknown => {
        return call[0];
      }),
    ).not.toContain(`@oneuptime/replay/app/outbox-v2/${frame(0).id}`);
  });
});

describe("offline outbox base64", () => {
  test("round-trips every byte value and every padding length", () => {
    for (let length: number = 0; length < 260; length += 1) {
      const bytes: Uint8Array = new Uint8Array(length);
      for (let index: number = 0; index < length; index += 1) {
        bytes[index] = (index * 37 + length) & 0xff;
      }

      expect(decodeBase64(encodeBase64(bytes))).toEqual(bytes);
    }
  });

  test("matches the standard encoding", () => {
    const bytes: Uint8Array = new Uint8Array([0, 1, 2, 250, 251, 252, 253]);

    expect(encodeBase64(bytes)).toBe(Buffer.from(bytes).toString("base64"));
  });

  test("rejects anything that is not base64", () => {
    for (const text of ["%%%%", "abc", "ab=c", "aébc", "===="]) {
      expect(decodeBase64(text)).toBeNull();
    }
  });
});
