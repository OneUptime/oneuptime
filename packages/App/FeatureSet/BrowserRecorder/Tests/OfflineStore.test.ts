import {
  SESSION_REPLAY_MAX_OFFLINE_DELAY_MS,
  SessionReplayChunkEnvelope,
} from "Common/Types/Rum/SessionReplay";
import OfflineStore, {
  OFFLINE_DATABASE_NAME,
  OFFLINE_PENDING_KEY,
  OFFLINE_STORE_NAME,
  OfflineChunk,
} from "../src/OfflineStore";
import {
  databaseNames,
  freshIndexedDb,
  removeIndexedDb,
  settle,
  testEnvelope,
} from "./OfflineTestUtils";

/*
 * The IndexedDB half of offline mode, against a real (in-memory)
 * implementation of the spec. What is under test is what a closed tab, a
 * second tab and the next page load each see.
 */

const SCOPE: string = "https://oneuptime.com/session-replay/v1/chunk#app-1";
const OTHER_SCOPE: string =
  "https://oneuptime.com/session-replay/v1/chunk#app-2";

function chunkAt(
  index: number,
  overrides?: Partial<SessionReplayChunkEnvelope>,
): OfflineChunk {
  return {
    envelope: testEnvelope({ chunkIndex: index, ...overrides }),
    payload: `[{"chunk":${index}}]`,
  };
}

function indexesOf(chunks: Array<OfflineChunk>): Array<number> {
  return chunks.map((chunk: OfflineChunk): number => {
    return chunk.envelope.chunkIndex;
  });
}

describe("OfflineStore", (): void => {
  beforeEach((): void => {
    freshIndexedDb();
    window.localStorage.clear();
  });

  afterEach((): void => {
    jest.restoreAllMocks();
  });

  describe("footprint", (): void => {
    it("creates no database for a visitor who never had to wait", async (): Promise<void> => {
      const store: OfflineStore = new OfflineStore(SCOPE);

      /* Nothing queued, nothing to clear or remove: nothing opened. */
      store.remove([testEnvelope()]);
      store.clear();
      await settle();

      expect(store.isOpen()).toBe(false);
      expect(await databaseNames()).toEqual([]);
      expect(OfflineStore.hasPending()).toBe(false);
    });

    it("creates the database on the first chunk that has to wait, and marks it pending", async (): Promise<void> => {
      const store: OfflineStore = new OfflineStore(SCOPE);

      store.put([chunkAt(0)]);
      await settle();

      expect(await databaseNames()).toEqual([OFFLINE_DATABASE_NAME]);
      expect(window.localStorage.getItem(OFFLINE_PENDING_KEY)).toBe("1");
      expect(OfflineStore.hasPending()).toBe(true);
    });

    it("keeps its pending marker out of the way of anything else in localStorage", (): void => {
      window.localStorage.setItem(OFFLINE_PENDING_KEY, "yes");

      /* Only its own exact value counts; a stranger's key is not a marker. */
      expect(OfflineStore.hasPending()).toBe(false);
    });
  });

  describe("put and takeAll", (): void => {
    it("hands the next page every chunk it stored, oldest first", async (): Promise<void> => {
      const nowSpy: jest.SpyInstance = jest.spyOn(Date, "now");
      const writer: OfflineStore = new OfflineStore(SCOPE);

      nowSpy.mockReturnValue(1_700_000_100_000);
      writer.put([chunkAt(3), chunkAt(4)]);

      nowSpy.mockReturnValue(1_700_000_050_000);
      writer.put([chunkAt(1), chunkAt(2)]);
      await settle();

      /* The next page load: a new store object over the same database. */
      const reader: OfflineStore = new OfflineStore(SCOPE);
      const taken: Array<OfflineChunk> = await reader.takeAll();

      expect(indexesOf(taken)).toEqual([1, 2, 3, 4]);
      expect(taken[0]?.payload).toBe('[{"chunk":1}]');
      expect(taken[0]?.envelope).toEqual(chunkAt(1).envelope);
    });

    it("replaces an earlier copy of the same chunk rather than storing it twice", async (): Promise<void> => {
      const store: OfflineStore = new OfflineStore(SCOPE);

      store.put([
        { envelope: testEnvelope({ chunkIndex: 5 }), payload: "[1]" },
      ]);
      store.put([
        { envelope: testEnvelope({ chunkIndex: 5 }), payload: "[2]" },
      ]);
      await settle();

      const taken: Array<OfflineChunk> = await new OfflineStore(
        SCOPE,
      ).takeAll();

      expect(taken).toHaveLength(1);
      expect(taken[0]?.payload).toBe("[2]");
    });

    it("tells the writer only once the chunks are durably stored", async (): Promise<void> => {
      const store: OfflineStore = new OfflineStore(SCOPE);
      const stored: jest.Mock = jest.fn();

      store.put([chunkAt(0)], stored);

      expect(stored).not.toHaveBeenCalled();

      await settle();

      expect(stored).toHaveBeenCalledTimes(1);
    });

    it("keys chunks by session, tab and index, so two tabs' chunk 0 are both kept", async (): Promise<void> => {
      const store: OfflineStore = new OfflineStore(SCOPE);

      store.put([
        chunkAt(0, { tabId: "c".repeat(32) }),
        chunkAt(0, { tabId: "d".repeat(32) }),
        chunkAt(0, { sessionId: "e".repeat(32) }),
      ]);
      await settle();

      expect(await new OfflineStore(SCOPE).takeAll()).toHaveLength(3);
    });

    it("claims what it takes: a second page load finds nothing", async (): Promise<void> => {
      new OfflineStore(SCOPE).put([chunkAt(0), chunkAt(1)]);
      await settle();

      const [first, second]: [Array<OfflineChunk>, Array<OfflineChunk>] =
        await Promise.all([
          new OfflineStore(SCOPE).takeAll(),
          new OfflineStore(SCOPE).takeAll(),
        ]);

      /* Two tabs loading at once: one of them gets everything, never both. */
      expect(first.length + second.length).toBe(2);
      expect([first.length, second.length].sort()).toEqual([0, 2]);
    });

    it("clears the pending marker once nothing is left, so the next load opens nothing", async (): Promise<void> => {
      new OfflineStore(SCOPE).put([chunkAt(0)]);
      await settle();

      expect(OfflineStore.hasPending()).toBe(true);

      await new OfflineStore(SCOPE).takeAll();

      expect(OfflineStore.hasPending()).toBe(false);
    });

    it("keeps the pending marker while a chunk written during the take is still stored", async (): Promise<void> => {
      new OfflineStore(SCOPE).put([chunkAt(0)]);
      await settle();

      const store: OfflineStore = new OfflineStore(SCOPE);
      const taking: Promise<Array<OfflineChunk>> = store.takeAll();

      /* This page goes offline and stores a chunk while the take runs. */
      store.put([chunkAt(7, { tabId: "f".repeat(32) })]);

      await taking;
      await settle();

      expect(OfflineStore.hasPending()).toBe(true);
    });
  });

  describe("one store, several applications", (): void => {
    it("never hands one application's chunks to another", async (): Promise<void> => {
      new OfflineStore(SCOPE).put([chunkAt(0), chunkAt(1)]);
      new OfflineStore(OTHER_SCOPE).put([chunkAt(9)]);
      await settle();

      expect(indexesOf(await new OfflineStore(OTHER_SCOPE).takeAll())).toEqual([
        9,
      ]);
      expect(indexesOf(await new OfflineStore(SCOPE).takeAll())).toEqual([
        0, 1,
      ]);
    });

    it("keeps the pending marker while another application's chunks remain", async (): Promise<void> => {
      new OfflineStore(SCOPE).put([chunkAt(0)]);
      new OfflineStore(OTHER_SCOPE).put([chunkAt(1)]);
      await settle();

      await new OfflineStore(SCOPE).takeAll();

      expect(OfflineStore.hasPending()).toBe(true);
    });
  });

  describe("expiry", (): void => {
    it("never hands over a chunk older than the offline delay, and deletes it", async (): Promise<void> => {
      const nowSpy: jest.SpyInstance = jest.spyOn(Date, "now");
      const storedAt: number = 1_700_000_000_000;

      nowSpy.mockReturnValue(storedAt);
      new OfflineStore(SCOPE).put([chunkAt(0)]);
      new OfflineStore(SCOPE).put([chunkAt(1, { tabId: "c".repeat(32) })]);
      await settle();

      nowSpy.mockReturnValue(
        storedAt + SESSION_REPLAY_MAX_OFFLINE_DELAY_MS + 1,
      );

      expect(await new OfflineStore(SCOPE).takeAll()).toEqual([]);
      expect(OfflineStore.hasPending()).toBe(false);
    });

    it("prunes another application's expired chunks on the way past", async (): Promise<void> => {
      const nowSpy: jest.SpyInstance = jest.spyOn(Date, "now");
      const storedAt: number = 1_700_000_000_000;

      nowSpy.mockReturnValue(storedAt);
      new OfflineStore(OTHER_SCOPE).put([chunkAt(0)]);
      await settle();

      nowSpy.mockReturnValue(
        storedAt + SESSION_REPLAY_MAX_OFFLINE_DELAY_MS + 1,
      );
      await new OfflineStore(SCOPE).takeAll();

      /* Nothing of anyone's left, so the marker goes too. */
      expect(OfflineStore.hasPending()).toBe(false);
      nowSpy.mockReturnValue(storedAt);
      expect(await new OfflineStore(OTHER_SCOPE).takeAll()).toEqual([]);
    });

    it("keeps a chunk right up to the offline delay", async (): Promise<void> => {
      const nowSpy: jest.SpyInstance = jest.spyOn(Date, "now");
      const storedAt: number = 1_700_000_000_000;

      nowSpy.mockReturnValue(storedAt);
      new OfflineStore(SCOPE).put([chunkAt(0)]);
      await settle();

      nowSpy.mockReturnValue(storedAt + SESSION_REPLAY_MAX_OFFLINE_DELAY_MS);

      expect(await new OfflineStore(SCOPE).takeAll()).toHaveLength(1);
    });
  });

  describe("claim", (): void => {
    it("lets exactly one of two tabs upload a stored chunk", async (): Promise<void> => {
      const envelope: SessionReplayChunkEnvelope = testEnvelope({
        chunkIndex: 3,
      });

      new OfflineStore(SCOPE).put([{ envelope: envelope, payload: "[]" }]);
      await settle();

      const results: Array<boolean> = await Promise.all([
        new OfflineStore(SCOPE).claim(envelope),
        new OfflineStore(SCOPE).claim(envelope),
      ]);

      expect(results.sort()).toEqual([false, true]);
    });

    it("says no for a chunk another page already took", async (): Promise<void> => {
      const envelope: SessionReplayChunkEnvelope = testEnvelope();
      const holder: OfflineStore = new OfflineStore(SCOPE);

      holder.put([{ envelope: envelope, payload: "[]" }]);
      await settle();

      await new OfflineStore(SCOPE).takeAll();

      expect(await holder.claim(envelope)).toBe(false);
    });

    it("says yes when there is no IndexedDB to coordinate through", async (): Promise<void> => {
      removeIndexedDb();

      expect(await new OfflineStore(SCOPE).claim(testEnvelope())).toBe(true);
    });
  });

  describe("remove and clear", (): void => {
    it("forgets chunks that were uploaded", async (): Promise<void> => {
      const store: OfflineStore = new OfflineStore(SCOPE);

      store.put([chunkAt(0), chunkAt(1), chunkAt(2)]);
      store.remove([chunkAt(0).envelope, chunkAt(2).envelope]);
      await settle();

      expect(indexesOf(await new OfflineStore(SCOPE).takeAll())).toEqual([1]);
    });

    it("deletes every application's chunks and the marker on clear", async (): Promise<void> => {
      new OfflineStore(SCOPE).put([chunkAt(0)]);
      new OfflineStore(OTHER_SCOPE).put([chunkAt(1)]);
      await settle();

      /* A fresh page whose visitor withdrew consent. */
      new OfflineStore(SCOPE).clear();
      await settle();

      expect(OfflineStore.hasPending()).toBe(false);
      expect(await new OfflineStore(SCOPE).takeAll()).toEqual([]);
      expect(await new OfflineStore(OTHER_SCOPE).takeAll()).toEqual([]);
    });
  });

  /*
   * Rule 2. A closing tab gets a pagehide handler and nothing after it, so
   * once the database is open a write must be ISSUED inside the call, not
   * behind a promise the browser may never run.
   */
  describe("writes from a pagehide handler", (): void => {
    it("issues the transaction synchronously once the database is open", async (): Promise<void> => {
      const store: OfflineStore = new OfflineStore(SCOPE);
      const database: IDBDatabase | null = await store.open();

      expect(database).not.toBeNull();

      const transaction: jest.SpyInstance = jest.spyOn(
        database as IDBDatabase,
        "transaction",
      );

      store.put([chunkAt(0)]);

      expect(transaction).toHaveBeenCalledTimes(1);
      expect(transaction).toHaveBeenCalledWith(OFFLINE_STORE_NAME, "readwrite");
    });

    it("asks the browser to commit at once rather than when the page's task ends", async (): Promise<void> => {
      const store: OfflineStore = new OfflineStore(SCOPE);
      const database: IDBDatabase = (await store.open()) as IDBDatabase;
      const realTransaction: IDBDatabase["transaction"] =
        database.transaction.bind(database);
      const commits: Array<IDBTransaction> = [];

      jest
        .spyOn(database, "transaction")
        .mockImplementation(
          (...args: Parameters<IDBDatabase["transaction"]>): IDBTransaction => {
            const created: IDBTransaction = realTransaction(...args);
            const commit: () => void = created.commit.bind(created);

            created.commit = (): void => {
              commits.push(created);
              commit();
            };

            return created;
          },
        );

      store.put([chunkAt(0)]);

      expect(commits).toHaveLength(1);
    });
  });

  /*
   * Rule 5: every failure leaves the transport where it was, holding the
   * chunks in memory, and never throws into the page.
   */
  describe("without IndexedDB", (): void => {
    beforeEach((): void => {
      removeIndexedDb();
    });

    it("does nothing, throws nothing, and hands over nothing", async (): Promise<void> => {
      const store: OfflineStore = new OfflineStore(SCOPE);
      const stored: jest.Mock = jest.fn();

      expect((): void => {
        store.put([chunkAt(0)], stored);
        store.remove([chunkAt(0).envelope]);
        store.clear();
      }).not.toThrow();

      await settle();

      expect(stored).not.toHaveBeenCalled();
      expect(await store.open()).toBeNull();
      expect(await store.takeAll()).toEqual([]);
    });

    it("survives an open that fails outright", async (): Promise<void> => {
      freshIndexedDb();
      jest.spyOn(indexedDB, "open").mockImplementation((): never => {
        throw new Error("SecurityError");
      });

      const store: OfflineStore = new OfflineStore(SCOPE);

      store.put([chunkAt(0)]);
      await settle();

      expect(await store.open()).toBeNull();
      expect(await store.takeAll()).toEqual([]);
    });
  });

  describe("what it trusts", (): void => {
    it("skips, and deletes, a record of its own application that is not a chunk", async (): Promise<void> => {
      const store: OfflineStore = new OfflineStore(SCOPE);
      const database: IDBDatabase = (await store.open()) as IDBDatabase;

      await new Promise<void>((resolve: () => void): void => {
        const transaction: IDBTransaction = database.transaction(
          OFFLINE_STORE_NAME,
          "readwrite",
        );

        transaction.objectStore(OFFLINE_STORE_NAME).put({
          key: "garbage",
          scope: SCOPE,
          savedAtUnixMs: Date.now(),
          envelope: { chunkIndex: "zero" },
          payload: 42,
        });
        transaction.oncomplete = (): void => {
          resolve();
        };
      });

      store.put([chunkAt(1)]);
      await settle();

      expect(indexesOf(await new OfflineStore(SCOPE).takeAll())).toEqual([1]);
      expect(await new OfflineStore(SCOPE).takeAll()).toEqual([]);
    });
  });
});
