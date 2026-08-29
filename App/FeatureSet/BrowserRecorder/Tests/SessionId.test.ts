import SessionIdentity, {
  SessionRotationReason,
} from "Common/Utils/Rum/SessionIdentity";
import SessionId, { SessionIdentityState } from "../src/SessionId";

describe("SessionId", (): void => {
  beforeEach((): void => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    /*
     * The chunk-index high-water marks are module state that a real page
     * load would not carry over. Jest keeps the module between tests, so it
     * is cleared explicitly here.
     */
    SessionId.clearAll();
  });

  describe("generateId", (): void => {
    it("produces 32 lowercase hex characters", (): void => {
      const id: string = SessionId.generateId();

      expect(id).toMatch(/^[0-9a-f]{32}$/);
    });

    it("does not repeat", (): void => {
      const ids: Set<string> = new Set<string>();

      for (let i: number = 0; i < 200; i++) {
        ids.add(SessionId.generateId());
      }

      expect(ids.size).toBe(200);
    });
  });

  describe("resolveSession", (): void => {
    it("mints a new session when storage is empty", (): void => {
      const now: number = Date.now();
      const state: SessionIdentityState = SessionId.resolveSession(now, "tab1");

      expect(state.sessionId).toMatch(/^[0-9a-f]{32}$/);
      expect(state.sessionStartUnixMs).toBe(now);
      expect(state.rotationReason).toBe(SessionRotationReason.New);
      expect(state.previousSessionId).toBeUndefined();
    });

    it("reuses an active session across a navigation", (): void => {
      const now: number = Date.now();
      const first: SessionIdentityState = SessionId.resolveSession(now, "tab1");

      const second: SessionIdentityState = SessionId.resolveSession(
        now + 60_000,
        "tab2",
      );

      expect(second.sessionId).toBe(first.sessionId);
      expect(second.sessionStartUnixMs).toBe(first.sessionStartUnixMs);
      expect(second.rotationReason).toBeUndefined();
    });

    it("rotates after the 30 minute idle window", (): void => {
      const now: number = Date.now();
      const first: SessionIdentityState = SessionId.resolveSession(now, "tab1");

      const second: SessionIdentityState = SessionId.resolveSession(
        now + 31 * 60 * 1000,
        "tab1",
      );

      expect(second.sessionId).not.toBe(first.sessionId);
      expect(second.rotationReason).toBe(SessionRotationReason.Idle);
      expect(second.previousSessionId).toBe(first.sessionId);
    });

    it("rotates at the 4 hour hard cap even while active", (): void => {
      let now: number = Date.now();
      const first: SessionIdentityState = SessionId.resolveSession(now, "tab1");

      /* Stay active in 10 minute steps so the idle window never trips. */
      for (let i: number = 0; i < 25; i++) {
        now += 10 * 60 * 1000;
        SessionId.touch(now);
      }

      const later: SessionIdentityState = SessionId.resolveSession(now, "tab1");

      expect(later.sessionId).not.toBe(first.sessionId);
      expect(later.rotationReason).toBe(SessionRotationReason.DurationCap);
    });

    it("rotates rather than trusting corrupt stored state", (): void => {
      window.localStorage.setItem(
        "oneuptime.replay.session",
        '{"sessionId":"abc","sessionStartUnixMs":"not-a-number"}',
      );

      const state: SessionIdentityState = SessionId.resolveSession(
        Date.now(),
        "tab1",
      );

      expect(state.sessionId).not.toBe("abc");
    });

    it("resets the chunk counter for the tab when the session rotates", (): void => {
      const now: number = Date.now();

      SessionId.resolveSession(now, "tab1");
      SessionId.getNextChunkIndex("tab1");
      SessionId.getNextChunkIndex("tab1");

      expect(SessionId.peekChunkIndex("tab1")).toBe(2);

      SessionId.resolveSession(now + 31 * 60 * 1000, "tab1");

      expect(SessionId.peekChunkIndex("tab1")).toBe(0);
    });
  });

  describe("tab identity", (): void => {
    /*
     * sessionStorage is COPIED on tab duplication. Reusing the stored value
     * would give two live tabs the same id, both minting chunk indexes under
     * one sort-key prefix, and read-time dedup would silently discard one
     * tab's entire stream.
     */
    it("mints a fresh tab id on every init, ignoring a copied value", (): void => {
      const first: string = SessionId.rotateTabId();
      const second: string = SessionId.rotateTabId();

      expect(second).not.toBe(first);
      expect(SessionId.readTabId()).toBe(second);
    });

    it("scopes chunk counters per tab so a duplicated tab starts at 0", (): void => {
      SessionId.getNextChunkIndex("tabA");
      SessionId.getNextChunkIndex("tabA");

      expect(SessionId.getNextChunkIndex("tabA")).toBe(2);
      expect(SessionId.getNextChunkIndex("tabB")).toBe(0);
    });

    it("keeps the counter across a recorder restart within one tab", (): void => {
      expect(SessionId.getNextChunkIndex("tabA")).toBe(0);
      expect(SessionId.getNextChunkIndex("tabA")).toBe(1);

      /* Simulated restart: the module has no in-memory state to lose. */
      expect(SessionId.getNextChunkIndex("tabA")).toBe(2);
    });

    /*
     * The counter lives in sessionStorage, which is the HOST PAGE's
     * storage, not ours - and plenty of applications call
     * sessionStorage.clear() on sign-out, under a recorder that is still
     * running.
     *
     * Rewinding to 0 there is not a duplicate, it is a DELETION: the chunk
     * table is a ReplacingMergeTree keyed on
     * (projectId, sessionId, tabId, chunkIndex) with the ingest time as the
     * version, so the second index 0 REPLACES the first - and index 0 is the
     * chunk carrying the session's opening full snapshot. The recording
     * becomes unplayable from its own start with nothing reporting a fault.
     */
    it("never rewinds when the host page clears sessionStorage mid-session", (): void => {
      expect(SessionId.getNextChunkIndex("tabA")).toBe(0);
      expect(SessionId.getNextChunkIndex("tabA")).toBe(1);
      expect(SessionId.getNextChunkIndex("tabA")).toBe(2);

      /* The host page signs a user out. */
      sessionStorage.clear();

      expect(SessionId.getNextChunkIndex("tabA")).toBe(3);
      expect(SessionId.getNextChunkIndex("tabA")).toBe(4);
    });

    it("survives a single storage key being deleted, not just a full clear", (): void => {
      SessionId.getNextChunkIndex("tabA");
      SessionId.getNextChunkIndex("tabA");

      for (const key of Object.keys(sessionStorage)) {
        if (key.indexOf("chunkIndex") >= 0) {
          sessionStorage.removeItem(key);
        }
      }

      expect(SessionId.getNextChunkIndex("tabA")).toBe(2);
    });

    /*
     * A rollover mints a new tab id and explicitly resets the counter, so
     * the guard must not pin the OLD tab's high-water mark onto it.
     */
    it("still resets to 0 when the recorder itself asks", (): void => {
      SessionId.getNextChunkIndex("tabA");
      SessionId.getNextChunkIndex("tabA");

      SessionId.resetChunkIndex("tabA");

      expect(SessionId.getNextChunkIndex("tabA")).toBe(0);
    });
  });

  describe("refresh rage", (): void => {
    it("counts reloads of the same scrubbed path inside the window", (): void => {
      const now: number = Date.now();

      expect(
        SessionId.recordPageLoad("https://shop.example.com/checkout", now),
      ).toBe(1);
      expect(
        SessionId.recordPageLoad(
          "https://shop.example.com/checkout",
          now + 500,
        ),
      ).toBe(2);
      expect(
        SessionId.recordPageLoad(
          "https://shop.example.com/checkout",
          now + 1000,
        ),
      ).toBe(3);
      expect(SessionId.isRefreshRage(3)).toBe(true);
    });

    it("does not count a different path", (): void => {
      const now: number = Date.now();

      SessionId.recordPageLoad("https://shop.example.com/checkout", now);
      SessionId.recordPageLoad("https://shop.example.com/checkout", now + 100);

      expect(
        SessionId.recordPageLoad("https://shop.example.com/cart", now + 200),
      ).toBe(1);
    });

    it("forgets reloads older than the window", (): void => {
      const now: number = Date.now();

      SessionId.recordPageLoad("https://shop.example.com/checkout", now);

      expect(
        SessionId.recordPageLoad(
          "https://shop.example.com/checkout",
          now + 61_000,
        ),
      ).toBe(1);
    });

    /*
     * The scrubbed path is compared, so a reset link whose token changes on
     * every send still counts as the same page.
     */
    it("compares scrubbed paths, so identifier segments do not defeat it", (): void => {
      const now: number = Date.now();

      SessionId.recordPageLoad(
        "https://a.example.com/orders/8f14e45f-ce0a-4b0e-9a7c-1d2f3e4a5b6c",
        now,
      );

      expect(
        SessionId.recordPageLoad(
          "https://a.example.com/orders/11111111-2222-3333-4444-555555555555",
          now + 10,
        ),
      ).toBe(2);
    });
  });

  describe("clearAll", (): void => {
    it("removes session, tab, reload log and every chunk counter", (): void => {
      SessionId.resolveSession(Date.now(), "tab1");
      SessionId.rotateTabId();
      SessionId.getNextChunkIndex("tab1");
      SessionId.getNextChunkIndex("tab2");
      SessionId.recordPageLoad("https://a.example.com/x", Date.now());

      SessionId.clearAll();

      expect(window.localStorage.length).toBe(0);
      expect(window.sessionStorage.length).toBe(0);
    });
  });

  describe("storage failure", (): void => {
    /*
     * localStorage throws outright in Safari private browsing and whenever a
     * user has blocked site data. An exception escaping from here would take
     * down the customer's page, which is the one outcome a RUM recorder may
     * never cause, so it degrades to a per-page-load session instead.
     */
    it("degrades to a per-page session when localStorage throws", (): void => {
      const original: Storage = window.localStorage;

      const throwing: Storage = {
        get length(): number {
          throw new Error("storage disabled");
        },
        clear: (): void => {
          throw new Error("storage disabled");
        },
        getItem: (): string | null => {
          throw new Error("storage disabled");
        },
        key: (): string | null => {
          throw new Error("storage disabled");
        },
        removeItem: (): void => {
          throw new Error("storage disabled");
        },
        setItem: (): void => {
          throw new Error("storage disabled");
        },
      };

      Object.defineProperty(window, "localStorage", {
        configurable: true,
        value: throwing,
      });

      let state: SessionIdentityState | null = null;

      expect((): void => {
        state = SessionId.resolveSession(Date.now(), "tab1");
      }).not.toThrow();

      Object.defineProperty(window, "localStorage", {
        configurable: true,
        value: original,
      });

      expect(state).not.toBeNull();
    });
  });

  describe("parity with the shared decision logic", (): void => {
    it("uses the same rollover rule the server-side helper exposes", (): void => {
      const now: number = Date.now();

      expect(
        SessionIdentity.shouldRotateSession(
          {
            sessionId: "a",
            sessionStartUnixMs: now - 40 * 60 * 1000,
            lastActivityUnixMs: now - 31 * 60 * 1000,
          },
          now,
        ).reason,
      ).toBe(SessionRotationReason.Idle);
    });
  });
});
