import { SessionReplayChunkEnvelope } from "../src/Contract";
import ReplayOutbox, { frameId, PersistedReplayFrame } from "../src/Outbox";
import { ReplayStorage } from "../src/Storage";
import { envelope, MemoryStorage } from "./TestUtils";

function frame(
  index: number,
  createdAtUnixMs: number = index,
): PersistedReplayFrame {
  const frameEnvelope: SessionReplayChunkEnvelope = envelope({
    chunkIndex: index,
  });
  return {
    id: frameId(frameEnvelope),
    envelope: frameEnvelope,
    payload: JSON.stringify([{ index }]),
    attempts: 0,
    createdAtUnixMs,
  };
}

class DelayedStorage implements ReplayStorage {
  public value: string | null = null;

  private async delay(): Promise<void> {
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 5);
    });
  }

  public async getItem(): Promise<string | null> {
    await this.delay();
    return this.value;
  }

  public async setItem(_key: string, value: string): Promise<void> {
    await this.delay();
    this.value = value;
  }

  public async removeItem(): Promise<void> {
    await this.delay();
    this.value = null;
  }
}

describe("AsyncStorage replay outbox", () => {
  test("persists FIFO frames before upload and deduplicates frame identity", async () => {
    const outbox: ReplayOutbox = new ReplayOutbox(new MemoryStorage(), "app");
    await outbox.enqueue(frame(2, 20));
    await outbox.enqueue(frame(1, 10));
    await outbox.enqueue(frame(1, 10));
    expect(
      (await outbox.list()).map((item: PersistedReplayFrame) => {
        return item.envelope.chunkIndex;
      }),
    ).toEqual([1, 2]);
  });

  test("tracks attempts, removes acknowledgements, and clears on revoke", async () => {
    const storage: MemoryStorage = new MemoryStorage();
    const outbox: ReplayOutbox = new ReplayOutbox(storage, "app");
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
    const outbox: ReplayOutbox = new ReplayOutbox(storage, "app");
    expect(await outbox.list()).toEqual([]);
    expect(storage.values.size).toBe(0);
  });

  test("serializes concurrent read-modify-write operations without lost frames", async () => {
    const storage: DelayedStorage = new DelayedStorage();
    const outbox: ReplayOutbox = new ReplayOutbox(storage, "app");
    await Promise.all([
      outbox.enqueue(frame(0)),
      outbox.enqueue(frame(1)),
      outbox.enqueue(frame(2)),
      outbox.enqueue(frame(3)),
    ]);
    expect(
      (await outbox.list()).map((item: PersistedReplayFrame) => {
        return item.envelope.chunkIndex;
      }),
    ).toEqual([0, 1, 2, 3]);
  });

  test("bounds offline persistence and reports evictions", async () => {
    const outbox: ReplayOutbox = new ReplayOutbox(new MemoryStorage(), "app");
    let dropped: number = 0;
    for (let index: number = 0; index < 70; index += 1) {
      dropped += (await outbox.enqueue(frame(index))).dropped;
    }
    expect(dropped).toBe(6);
    const remaining: Array<PersistedReplayFrame> = await outbox.list();
    expect(remaining).toHaveLength(64);
    expect(remaining[0]?.envelope.chunkIndex).toBe(6);
  });
});
