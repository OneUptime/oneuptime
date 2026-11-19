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

  test("end() forgets a session that ended so a relaunch starts the next one, keeping the visitor", async () => {
    const storage: MemoryStorage = new MemoryStorage();
    const store: ReplaySessionStore = new ReplaySessionStore(storage, "app");
    const ended: ReplaySessionIdentity = await store.resolve(1_000);
    /* Its final chunk just wrote the record, so it looks recent. */
    expect(await store.takeChunkIndex(1_100)).toBe(0);

    await store.end();

    expect(storage.values.has("@oneuptime/replay/app/session")).toBe(false);
    const relaunched: ReplaySessionIdentity = await new ReplaySessionStore(
      storage,
      "app",
    ).resolve(1_200);
    expect(relaunched.sessionId).not.toBe(ended.sessionId);
    expect(relaunched.visitorId).toBe(ended.visitorId);
    expect(relaunched.chunkIndex).toBe(0);
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

  /*
   * Issue #6629: a session the replay sample left out records nothing, so
   * its product analytics events are what keeps it going - or end it, past
   * the idle window or the longest a session lasts - as resolve() decides
   * at a launch, and what they decide is there for the next launch.
   */
  describe("continueSession, for an unrecorded session's events", () => {
    test("is null before the session is resolved", () => {
      const store: ReplaySessionStore = new ReplaySessionStore(
        new MemoryStorage(),
        "app",
      );

      expect(store.continueSession(1_000)).toBeNull();
    });

    test("carries the session on inside the idle window, each event moving it", async () => {
      const storage: MemoryStorage = new MemoryStorage();
      const store: ReplaySessionStore = new ReplaySessionStore(storage, "app");
      const first: ReplaySessionIdentity = await store.resolve(1_000);
      const almostIdle: number = SESSION_REPLAY_IDLE_ROLLOVER_MS - 1;

      const second: ReplaySessionIdentity | null = store.continueSession(
        1_000 + almostIdle,
      );
      const third: ReplaySessionIdentity | null = store.continueSession(
        1_000 + 2 * almostIdle,
      );

      expect(second?.sessionId).toBe(first.sessionId);
      expect(third?.sessionId).toBe(first.sessionId);
      expect(third?.sessionStartUnixMs).toBe(1_000);
      expect(third?.visitorId).toBe(first.visitorId);
    });

    test("starts the next session after the idle window, keeping the visitor", async () => {
      const storage: MemoryStorage = new MemoryStorage();
      const store: ReplaySessionStore = new ReplaySessionStore(storage, "app");
      const first: ReplaySessionIdentity = await store.resolve(1_000);

      const next: ReplaySessionIdentity | null = store.continueSession(
        1_000 + SESSION_REPLAY_IDLE_ROLLOVER_MS,
      );

      expect(next?.sessionId).toMatch(/^[0-9a-f]{32}$/u);
      expect(next?.sessionId).not.toBe(first.sessionId);
      expect(next?.visitorId).toBe(first.visitorId);
      expect(next?.sessionStartUnixMs).toBe(
        1_000 + SESSION_REPLAY_IDLE_ROLLOVER_MS,
      );
      expect(next?.chunkIndex).toBe(0);
    });

    test("starts the next session once one has lasted as long as a session may", async () => {
      const store: ReplaySessionStore = new ReplaySessionStore(
        new MemoryStorage(),
        "app",
      );
      const first: ReplaySessionIdentity = await store.resolve(1_000);
      let now: number = 1_000;

      /* Busy the whole time: an event every ten minutes. */
      while (now < 1_000 + SESSION_REPLAY_MAX_SESSION_MS - 600_000) {
        now += 600_000;
        expect(store.continueSession(now)?.sessionId).toBe(first.sessionId);
      }

      const next: ReplaySessionIdentity | null = store.continueSession(
        1_000 + SESSION_REPLAY_MAX_SESSION_MS,
      );
      expect(next?.sessionId).not.toBe(first.sessionId);
    });

    test("leaves what it decided for the next launch to resume", async () => {
      const storage: MemoryStorage = new MemoryStorage();
      const store: ReplaySessionStore = new ReplaySessionStore(storage, "app");
      await store.resolve(1_000);
      const rolled: ReplaySessionIdentity | null = store.continueSession(
        1_000 + SESSION_REPLAY_IDLE_ROLLOVER_MS + 5,
      );
      /* The write is in the background; let it land. */
      await Promise.resolve();

      const relaunched: ReplaySessionIdentity = await new ReplaySessionStore(
        storage,
        "app",
      ).resolve(1_000 + SESSION_REPLAY_IDLE_ROLLOVER_MS + 60_000);

      expect(relaunched.sessionId).toBe(rolled?.sessionId);
    });

    test("never throws when storage does", async () => {
      const failing: ReplayStorage = {
        async getItem(): Promise<string | null> {
          return null;
        },
        async setItem(): Promise<void> {
          throw new Error("full");
        },
        async removeItem(): Promise<void> {
          throw new Error("blocked");
        },
      };
      const store: ReplaySessionStore = new ReplaySessionStore(failing, "app");
      await store.resolve(1);

      expect(store.continueSession(2)?.sessionId).toMatch(/^[0-9a-f]{32}$/u);
      await Promise.resolve();
    });
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
    await expect(store.end()).resolves.toBeUndefined();
    await expect(store.clear()).resolves.toBeUndefined();
  });
});
