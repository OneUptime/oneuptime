import {
  SESSION_REPLAY_MAX_OFFLINE_DELAY_MS,
  SessionReplayChunkEnvelope,
} from "Common/Types/Rum/SessionReplay";

/*
 * Offline mode's durable half: chunks that are waiting for the network,
 * kept in IndexedDB so that closing, reloading or navigating away from a tab
 * that has no connection does not throw away what it recorded. The next page
 * of the same application that loads with a connection uploads them.
 *
 * Why IndexedDB and not localStorage: localStorage is the customer's, it is
 * capped at about 5 MB for the whole origin, and a recorder that filled it
 * would break the page's own writes with QuotaExceededError. IndexedDB has
 * its own, far larger quota and never competes with the page for it.
 *
 * Five rules shape this file:
 *
 * 1. NOTHING IS OPENED UNTIL IT IS NEEDED. A visitor who never loses their
 *    connection never gets a database: it is opened the first time a chunk
 *    has to wait (or the browser says it went offline), and on a later page
 *    load only when the one-byte marker below says an earlier page left
 *    something behind.
 *
 * 2. WRITES ARE ISSUED SYNCHRONOUSLY once the database is open, and asked to
 *    commit at once (IDBTransaction.commit). That is what lets a pagehide
 *    handler - which is all a closing tab gets - persist its last chunks:
 *    nothing it starts behind a promise is guaranteed to run.
 *
 * 3. A PERSISTED CHUNK IS UPLOADED ONLY BY WHOEVER DELETES IT FIRST.
 *    Two tabs of one application share this database. The tab that wrote a
 *    chunk still holds it in memory, and a tab that loads later claims
 *    everything it finds. Both would upload it. So an upload of a persisted
 *    chunk is always preceded by a claim - a delete inside a readwrite
 *    transaction, which IndexedDB runs one at a time - and only the tab
 *    whose claim found the record sends it. A page never claims in bulk
 *    what it wrote itself: it already holds those.
 *
 * 4. NOTHING OUTLIVES SESSION_REPLAY_MAX_OFFLINE_DELAY_MS. Expired records
 *    are pruned whenever a page claims, whichever application wrote them.
 *
 * 5. FAILURE IS SILENT AND HARMLESS. No IndexedDB (an old private window, a
 *    browser setting, a sandboxed iframe), a full quota, a blocked open:
 *    every one of them leaves the transport exactly where it was before this
 *    file existed, holding the chunks in memory.
 */

export interface OfflineChunk {
  envelope: SessionReplayChunkEnvelope;
  payload: string;
}

interface OfflineRecord extends OfflineChunk {
  key: string;

  /* Which application's endpoint the chunk belongs to. */
  scope: string;

  /* Which page wrote it (OfflineStore.owner). */
  owner: string;
  savedAtUnixMs: number;
}

export const OFFLINE_DATABASE_NAME: string = "oneuptime-session-replay";
export const OFFLINE_STORE_NAME: string = "offline-chunks";

/*
 * "1" while an earlier page may have left chunks in the database. Read on
 * every page load instead of opening IndexedDB, which is rule 1.
 */
export const OFFLINE_PENDING_KEY: string = "oneuptime.replay.offline";

export default class OfflineStore {
  private readonly scope: string;

  /* This page, as the writer of the records it puts. */
  private readonly owner: string = Math.random().toString(36).slice(2);
  private database: IDBDatabase | null = null;
  private opening: Promise<IDBDatabase | null> | null = null;

  /*
   * Bumped by every put. A claim that emptied the database only clears the
   * pending marker when nothing was written while it ran.
   */
  private writes: number = 0;

  public constructor(scope: string) {
    this.scope = scope;
  }

  public static keyOf(envelope: SessionReplayChunkEnvelope): string {
    return `${envelope.sessionId}:${envelope.tabId}:${envelope.chunkIndex}`;
  }

  /* Whether an earlier page left chunks behind. Never opens IndexedDB. */
  public static hasPending(): boolean {
    try {
      return window.localStorage.getItem(OFFLINE_PENDING_KEY) === "1";
    } catch {
      return false;
    }
  }

  private static setPending(pending: boolean): void {
    try {
      if (pending) {
        window.localStorage.setItem(OFFLINE_PENDING_KEY, "1");
      } else {
        window.localStorage.removeItem(OFFLINE_PENDING_KEY);
      }
    } catch {
      /* Storage blocked: the next page simply does not look. */
    }
  }

  public isOpen(): boolean {
    return this.database !== null;
  }

  /*
   * Open (and on first use create) the database. Resolves null, and keeps
   * resolving null, when IndexedDB is unavailable - see rule 5.
   */
  public open(): Promise<IDBDatabase | null> {
    if (this.opening) {
      return this.opening;
    }

    this.opening = new Promise<IDBDatabase | null>(
      (resolve: (database: IDBDatabase | null) => void): void => {
        try {
          const request: IDBOpenDBRequest = indexedDB.open(
            OFFLINE_DATABASE_NAME,
            1,
          );

          request.onupgradeneeded = (): void => {
            request.result.createObjectStore(OFFLINE_STORE_NAME, {
              keyPath: "key",
            });
          };

          request.onsuccess = (): void => {
            const database: IDBDatabase = request.result;

            /*
             * Another tab wants to upgrade or delete the database (a newer
             * recorder, or the customer's own "clear site data"). Holding the
             * connection open would block it forever; the next write simply
             * reopens.
             */
            database.onversionchange = (): void => {
              database.close();
              this.database = null;
              this.opening = null;
            };

            this.database = database;
            resolve(database);
          };

          request.onerror = (): void => {
            resolve(null);
          };
        } catch {
          resolve(null);
        }
      },
    );

    return this.opening;
  }

  /*
   * Run `work` in one readwrite transaction: synchronously when the
   * database is already open (rule 2), otherwise as soon as it is.
   */
  private write(
    work: (store: IDBObjectStore) => void,
    onStored?: () => void,
  ): void {
    const run: (database: IDBDatabase | null) => void = (
      database: IDBDatabase | null,
    ): void => {
      if (!database) {
        return;
      }

      try {
        const transaction: IDBTransaction = database.transaction(
          OFFLINE_STORE_NAME,
          "readwrite",
        );

        if (onStored) {
          transaction.oncomplete = onStored;
        }

        work(transaction.objectStore(OFFLINE_STORE_NAME));

        /*
         * Not in every browser, and not needed for correctness where it is
         * missing: the transaction still commits when the task ends, which
         * on a page that lives on is always.
         */
        const committable: { commit?: () => void } = transaction as unknown as {
          commit?: () => void;
        };

        if (typeof committable.commit === "function") {
          committable.commit();
        }
      } catch {
        /* A closed connection or a full quota: the chunks stay in memory. */
      }
    };

    if (this.database) {
      run(this.database);
      return;
    }

    void this.open().then(run);
  }

  /*
   * Persist chunks, replacing any earlier copy of the same chunk. onStored
   * runs once they are durably on disk, and never when the write failed.
   */
  public put(chunks: Array<OfflineChunk>, onStored?: () => void): void {
    if (chunks.length === 0) {
      return;
    }

    const savedAtUnixMs: number = Date.now();

    this.writes++;
    OfflineStore.setPending(true);

    this.write((store: IDBObjectStore): void => {
      for (const chunk of chunks) {
        const record: OfflineRecord = {
          key: OfflineStore.keyOf(chunk.envelope),
          scope: this.scope,
          owner: this.owner,
          savedAtUnixMs: savedAtUnixMs,
          envelope: chunk.envelope,
          payload: chunk.payload,
        };

        store.put(record);
      }
    }, onStored);
  }

  /*
   * Forget chunks that were uploaded or given up on - and the pending marker
   * with them once the database is empty, so the next page load does not
   * open it for nothing.
   */
  public remove(envelopes: Array<SessionReplayChunkEnvelope>): void {
    /* Nothing was ever written by this page, or can be deleted by it. */
    if (envelopes.length === 0 || !this.opening) {
      return;
    }

    const writesBefore: number = this.writes;

    this.write((store: IDBObjectStore): void => {
      for (const envelope of envelopes) {
        store.delete(OfflineStore.keyOf(envelope));
      }

      const remaining: IDBRequest<number> = store.count();

      remaining.onsuccess = (): void => {
        if (remaining.result === 0 && this.writes === writesBefore) {
          OfflineStore.setPending(false);
        }
      };
    });
  }

  /*
   * Rule 3 for ONE chunk this tab holds: resolves true when the record was
   * still there and is now deleted - this tab uploads it - and false when
   * another tab already took it. True as well when there is no database to
   * coordinate through, so a broken IndexedDB never costs an upload.
   */
  public claim(envelope: SessionReplayChunkEnvelope): Promise<boolean> {
    return this.open().then(
      (database: IDBDatabase | null): Promise<boolean> => {
        return new Promise<boolean>(
          (resolve: (claimed: boolean) => void): void => {
            if (!database) {
              resolve(true);
              return;
            }

            try {
              const transaction: IDBTransaction = database.transaction(
                OFFLINE_STORE_NAME,
                "readwrite",
              );
              const store: IDBObjectStore =
                transaction.objectStore(OFFLINE_STORE_NAME);
              const key: string = OfflineStore.keyOf(envelope);
              const request: IDBRequest<IDBValidKey | undefined> =
                store.getKey(key);

              let found: boolean = false;

              request.onsuccess = (): void => {
                found = request.result !== undefined;

                if (found) {
                  store.delete(key);
                }
              };

              transaction.oncomplete = (): void => {
                resolve(found);
              };

              transaction.onabort = (): void => {
                resolve(true);
              };
            } catch {
              resolve(true);
            }
          },
        );
      },
    );
  }

  /*
   * Rule 3 in bulk, for a page that has just loaded: claim every chunk this
   * application left behind, in one transaction, oldest first. Expired
   * records are deleted on the way past, whoever wrote them (rule 4).
   */
  public takeAll(): Promise<Array<OfflineChunk>> {
    const writesBefore: number = this.writes;

    return this.open().then(
      (database: IDBDatabase | null): Promise<Array<OfflineChunk>> => {
        return new Promise<Array<OfflineChunk>>(
          (resolve: (chunks: Array<OfflineChunk>) => void): void => {
            if (!database) {
              resolve([]);
              return;
            }

            const taken: Array<OfflineRecord> = [];
            const oldestKept: number =
              Date.now() - SESSION_REPLAY_MAX_OFFLINE_DELAY_MS;
            let othersRemaining: number = 0;

            try {
              const transaction: IDBTransaction = database.transaction(
                OFFLINE_STORE_NAME,
                "readwrite",
              );
              const request: IDBRequest<IDBCursorWithValue | null> = transaction
                .objectStore(OFFLINE_STORE_NAME)
                .openCursor();

              request.onsuccess = (): void => {
                const cursor: IDBCursorWithValue | null = request.result;

                if (!cursor) {
                  return;
                }

                const record: OfflineRecord = cursor.value as OfflineRecord;
                const isCurrent: boolean =
                  Boolean(record) && record.savedAtUnixMs >= oldestKept;

                if (!isCurrent) {
                  cursor.delete();
                } else if (
                  record.scope !== this.scope ||
                  record.owner === this.owner
                ) {
                  othersRemaining++;
                } else {
                  cursor.delete();

                  if (OfflineStore.isChunk(record)) {
                    taken.push(record);
                  }
                }

                cursor.continue();
              };

              transaction.oncomplete = (): void => {
                if (othersRemaining === 0 && this.writes === writesBefore) {
                  OfflineStore.setPending(false);
                }

                taken.sort(
                  (left: OfflineRecord, right: OfflineRecord): number => {
                    return (
                      left.savedAtUnixMs - right.savedAtUnixMs ||
                      left.envelope.chunkIndex - right.envelope.chunkIndex
                    );
                  },
                );

                resolve(
                  taken.map((record: OfflineRecord): OfflineChunk => {
                    return {
                      envelope: record.envelope,
                      payload: record.payload,
                    };
                  }),
                );
              };

              transaction.onabort = (): void => {
                resolve([]);
              };
            } catch {
              resolve([]);
            }
          },
        );
      },
    );
  }

  /*
   * Delete everything, every application's: consent was withdrawn, the
   * server said stop, or the transport gave up for good. Opens the database
   * only when something may be in it.
   */
  public clear(): void {
    if (!this.opening && !OfflineStore.hasPending()) {
      return;
    }

    OfflineStore.setPending(false);

    this.write((store: IDBObjectStore): void => {
      store.clear();
    });
  }

  /*
   * The stored shape, checked before it is trusted: the database is shared
   * with every script on the origin and outlives recorder versions.
   */
  private static isChunk(record: OfflineRecord): boolean {
    const envelope: SessionReplayChunkEnvelope | undefined = record.envelope;

    return (
      typeof record.payload === "string" &&
      Boolean(envelope) &&
      typeof envelope.sessionId === "string" &&
      typeof envelope.tabId === "string" &&
      typeof envelope.chunkIndex === "number"
    );
  }
}
