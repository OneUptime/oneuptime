import {
  MAX_SESSION_REPLAY_CHUNKS_PER_SESSION,
  SESSION_REPLAY_IDLE_ROLLOVER_MS,
  SESSION_REPLAY_MAX_SESSION_MS,
} from "../src/Contract";
import ReplaySessionStore, {
  generateReplayId,
  ReplaySessionIdentity,
  ReplayStorage,
} from "../src/Storage";
import { MemoryStorage } from "./TestUtils";

describe("mobile replay session identity", () => {
  test("generates server-valid random identifiers", () => {
    expect(generateReplayId()).toMatch(/^[0-9a-f]{32}$/u);
    expect(generateReplayId()).not.toBe(generateReplayId());
  });

  test("persists a visit and visitor while minting a per-process tab id", async () => {
    const storage: MemoryStorage = new MemoryStorage();
    const firstStore: ReplaySessionStore = new ReplaySessionStore(
      storage,
      "app",
    );
    const first: ReplaySessionIdentity = await firstStore.resolve(1_000);
    expect(await firstStore.takeChunkIndex(1_100)).toBe(0);
    expect(await firstStore.takeChunkIndex(1_200)).toBe(1);

    const secondStore: ReplaySessionStore = new ReplaySessionStore(
      storage,
      "app",
    );
    const second: ReplaySessionIdentity = await secondStore.resolve(1_300);
    expect(second.sessionId).toBe(first.sessionId);
    expect(second.visitorId).toBe(first.visitorId);
    expect(second.tabId).not.toBe(first.tabId);
    expect(second.chunkIndex).toBe(2);
  });

  test("rotates after idle and maximum-duration caps without rotating visitor", async () => {
    const storage: MemoryStorage = new MemoryStorage();
    const store: ReplaySessionStore = new ReplaySessionStore(storage, "app");
    const first: ReplaySessionIdentity = await store.resolve(1_000);
    const afterIdle: ReplaySessionIdentity = await new ReplaySessionStore(
      storage,
      "app",
    ).resolve(1_000 + SESSION_REPLAY_IDLE_ROLLOVER_MS);
    expect(afterIdle.sessionId).not.toBe(first.sessionId);
    expect(afterIdle.visitorId).toBe(first.visitorId);

    const afterDuration: ReplaySessionIdentity = await new ReplaySessionStore(
      storage,
      "app",
    ).resolve(afterIdle.sessionStartUnixMs + SESSION_REPLAY_MAX_SESSION_MS);
    expect(afterDuration.sessionId).not.toBe(afterIdle.sessionId);
    expect(afterDuration.visitorId).toBe(first.visitorId);
  });

  test("recovers from corrupt state and revoke clears both linking ids", async () => {
    const storage: MemoryStorage = new MemoryStorage();
    storage.values.set("@oneuptime/replay/app/session", "not-json");
    storage.values.set("@oneuptime/replay/app/visitor", "attacker-value");
    const store: ReplaySessionStore = new ReplaySessionStore(storage, "app");
    const identity: ReplaySessionIdentity = await store.resolve(10);
    expect(identity.sessionId).toMatch(/^[0-9a-f]{32}$/u);
    expect(identity.visitorId).toMatch(/^[0-9a-f]{32}$/u);
    await store.clear();
    expect(storage.values.size).toBe(0);
  });

  test("rotates a persisted session whose hard chunk cap was reached", async () => {
    const storage: MemoryStorage = new MemoryStorage();
    storage.values.set(
      "@oneuptime/replay/app/session",
      JSON.stringify({
        sessionId: "a".repeat(32),
        sessionStartUnixMs: 1,
        lastActivityUnixMs: 900,
        nextChunkIndex: MAX_SESSION_REPLAY_CHUNKS_PER_SESSION,
      }),
    );
    const resolved: ReplaySessionIdentity = await new ReplaySessionStore(
      storage,
      "app",
    ).resolve(1_000);
    expect(resolved.sessionId).not.toBe("a".repeat(32));
    expect(resolved.chunkIndex).toBe(0);
  });

  test("storage failures never throw into the host application", async () => {
    const failing: ReplayStorage = {
      async getItem(): Promise<string | null> {
        throw new Error("blocked");
      },
      async setItem(): Promise<void> {
        throw new Error("full");
      },
      async removeItem(): Promise<void> {
        throw new Error("blocked");
      },
    };
    const store: ReplaySessionStore = new ReplaySessionStore(failing, "app");
    await expect(store.resolve(1)).resolves.toMatchObject({
      sessionId: expect.stringMatching(/^[0-9a-f]{32}$/u),
    });
    await expect(store.clear()).resolves.toBeUndefined();
  });
});
