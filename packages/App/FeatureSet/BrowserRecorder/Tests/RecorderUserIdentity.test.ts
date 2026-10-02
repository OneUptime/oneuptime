import {
  SESSION_REPLAY_FLUSH_INTERVAL_MS,
  SESSION_REPLAY_MAX_SESSION_MS,
  SessionReplayChunkEnvelope,
  SessionReplayConfigResponse,
} from "Common/Types/Rum/SessionReplay";
import SessionReplayCaptureTrigger from "Common/Types/Rum/SessionReplayCaptureTrigger";
import SessionReplayConsentMode from "Common/Types/Rum/SessionReplayConsentMode";
import SessionReplayMaskingMode from "Common/Types/Rum/SessionReplayMaskingMode";
import { SessionRotationReason } from "Common/Utils/Rum/SessionIdentity";
import { RecorderInitOptions } from "../src/Config";
import { clearDebugRecords, getDebugRecords } from "../src/Debug";
import Recorder from "../src/Recorder";
import SessionId, { SessionIdentityState } from "../src/SessionId";

/*
 * Whose session is it? (#4206)
 *
 * identify() lives in the page's memory, and a session is many pages: a
 * multi-page app loads the recorder afresh on every navigation, and every
 * tab of the origin shares the session id. A page that never called
 * identify() - the login page a sign-in redirect lands on, a link opened
 * in a new tab - used to upload the session as anonymous, and a customer
 * whose users signed in saw their sessions listed as "Visitor <id>".
 *
 * These run real Recorders (rrweb included) one after another against
 * jsdom's shared localStorage, which is exactly how two page loads, or two
 * tabs, of one origin share a session.
 */

const INIT_OPTIONS: RecorderInitOptions = {
  host: "https://oneuptime.com",
  token: "test-token",
  appIdentifier: "app-1",
};

const SESSION_KEY: string = "oneuptime.replay.session";
const USER_KEY: string = "oneuptime.replay.user";

const USER_A: string = "jshoemaker@wbhq.example";
const USER_B: string = "350310@wbhq.example";

function baseConfig(): SessionReplayConfigResponse {
  return {
    enabled: true,
    recorderVersion: "11.7.3",
    maskingMode: SessionReplayMaskingMode.MaskSensitiveInputsOnly,
    captureTrigger: SessionReplayCaptureTrigger.OnErrorOrFrustration,
    consentMode: SessionReplayConsentMode.NotRequired,
    samplePercentage: 100,
    maskSelectors: [],
    blockSelectors: [],
    urlAllowlist: [],
    ignoreErrorPatterns: [],
    recordCanvas: false,
    captureUserIdentity: true,
    respectDoNotTrack: true,
    configEpoch: 1,
    directive: "continue",
  };
}

interface Frame {
  envelope: SessionReplayChunkEnvelope;
  payload: string;
}

describe("Recorder - whose session it is (#4206)", (): void => {
  let fetchMock: jest.Mock;
  const pages: Array<Recorder> = [];

  beforeEach((): void => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    document.body.innerHTML = "<div id='app'><p>content</p></div>";
    clearDebugRecords();

    delete (globalThis as unknown as Record<string, unknown>)[
      "CompressionStream"
    ];

    fetchMock = jest.fn().mockResolvedValue({
      status: 202,
      headers: {
        get: (): string | null => {
          return null;
        },
      },
      text: async (): Promise<string> => {
        return "";
      },
    });

    (globalThis as unknown as Record<string, unknown>)["fetch"] = fetchMock;
    (window as unknown as Record<string, unknown>)["fetch"] = fetchMock;

    jest.useFakeTimers();
  });

  afterEach((): void => {
    for (const page of pages) {
      page.stop();
    }

    pages.length = 0;

    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  /* A page load: a recorder built against the shared storage, and started. */
  function openPage(data?: {
    config?: Partial<SessionReplayConfigResponse>;
    initOptions?: Partial<RecorderInitOptions>;
    beforeStart?: (page: Recorder) => void;
  }): Recorder {
    const page: Recorder = new Recorder({
      initOptions: { ...INIT_OPTIONS, ...data?.initOptions },
      config: { ...baseConfig(), ...data?.config },
    });

    pages.push(page);

    if (data?.beforeStart) {
      data.beforeStart(page);
    }

    page.start();

    return page;
  }

  /* Fake timers swallow a setTimeout, so microtasks are drained by hand. */
  async function drainMicrotasks(): Promise<void> {
    for (let i: number = 0; i < 60; i++) {
      await Promise.resolve();
    }
  }

  /* Something for the next chunk to hold, then the flush tick. */
  async function flushChunk(): Promise<void> {
    const div: HTMLDivElement = document.createElement("div");
    div.textContent = `change ${Math.random()}`;
    document.body.appendChild(div);

    await drainMicrotasks();
    jest.advanceTimersByTime(SESSION_REPLAY_FLUSH_INTERVAL_MS);
    await drainMicrotasks();
  }

  /* Leave the page: stop() seals the tab with a final chunk. */
  async function closePage(page: Recorder): Promise<void> {
    page.stop();
    await drainMicrotasks();
  }

  function framesOf(call: Array<unknown>): Array<Frame> {
    const init: Record<string, unknown> = call[1] as Record<string, unknown>;
    const body: Uint8Array = init["body"] as Uint8Array;
    const frames: Array<Frame> = [];
    let offset: number = 0;

    while (offset < body.length) {
      const rest: Uint8Array = body.subarray(offset);
      const newline: number = rest.indexOf(10);

      if (newline < 0) {
        break;
      }

      const envelope: SessionReplayChunkEnvelope = JSON.parse(
        new TextDecoder().decode(rest.subarray(0, newline)),
      ) as SessionReplayChunkEnvelope;

      const start: number = newline + 1;
      const end: number = start + envelope.payloadBytes;

      frames.push({
        envelope: envelope,
        payload: new TextDecoder().decode(rest.subarray(start, end)),
      });

      offset += end;
    }

    return frames;
  }

  function allFrames(): Array<Frame> {
    return fetchMock.mock.calls
      .filter((call: Array<unknown>): boolean => {
        return String(call[0]).indexOf("session-replay/v1/chunk") >= 0;
      })
      .flatMap(framesOf);
  }

  function framesFor(sessionId: string): Array<Frame> {
    return allFrames()
      .filter((frame: Frame): boolean => {
        return frame.envelope.sessionId === sessionId;
      })
      .sort((left: Frame, right: Frame): number => {
        return left.envelope.chunkIndex - right.envelope.chunkIndex;
      });
  }

  /* Every frame of a session that carries meta, i.e. writes a header. */
  function metaFramesFor(sessionId: string): Array<Frame> {
    return framesFor(sessionId).filter((frame: Frame): boolean => {
      return frame.envelope.meta !== undefined;
    });
  }

  function storedUserRecord(): Record<string, unknown> | null {
    const raw: string | null = window.localStorage.getItem(USER_KEY);

    return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
  }

  describe("every page and tab of a session names the user", (): void => {
    it("a later page of the same session names the user without calling identify()", async (): Promise<void> => {
      const login: Recorder = openPage();
      const sessionId: string = login.getSessionId();

      login.identify(USER_A, { role: "manager" });
      await flushChunk();
      await closePage(login);

      /* The page the sign-in redirect lands on never calls identify(). */
      const landing: Recorder = openPage();

      expect(landing.getSessionId()).toBe(sessionId);

      await flushChunk();
      await closePage(landing);

      const landingFrames: Array<Frame> = metaFramesFor(sessionId).filter(
        (frame: Frame): boolean => {
          return frame.envelope.tabId === landing.getTabId();
        },
      );

      /* Its chunk 0 and its final chunk: both header-writing frames. */
      expect(landingFrames.length).toBeGreaterThanOrEqual(2);
      expect(landingFrames[0]?.envelope.chunkIndex).toBe(0);
      expect(landingFrames[landingFrames.length - 1]?.envelope.isFinal).toBe(
        true,
      );

      for (const frame of landingFrames) {
        expect(frame.envelope.meta?.identifiedUserRef).toBe(USER_A);

        /*
         * The traits describe USER_A as the identifying page saw them; a
         * page that only inherited the user sends none, and the server
         * keeps the ones it already has.
         */
        expect(frame.envelope.meta?.identifiedUserTraits).toBeUndefined();
      }
    });

    it("every header-writing frame after a sign-in names the user, on every page", async (): Promise<void> => {
      const login: Recorder = openPage();
      const sessionId: string = login.getSessionId();

      await flushChunk();
      login.identify(USER_A);
      await flushChunk();
      await closePage(login);

      const second: Recorder = openPage();

      await flushChunk();
      await closePage(second);

      const third: Recorder = openPage();

      await flushChunk();
      await closePage(third);

      const metaFrames: Array<Frame> = metaFramesFor(sessionId);
      const firstIdentified: number = metaFrames.findIndex(
        (frame: Frame): boolean => {
          return frame.envelope.meta?.identifiedUserRef === USER_A;
        },
      );

      /* The login page's chunk 0 was anonymous, and that is the truth. */
      expect(metaFrames[0]?.envelope.meta?.identifiedUserRef).toBeUndefined();
      expect(firstIdentified).toBeGreaterThan(0);

      for (const frame of metaFrames.slice(firstIdentified)) {
        expect(frame.envelope.meta?.identifiedUserRef).toBe(USER_A);
      }
    });

    it("a tab open beside the identifying one names the user on its next header", async (): Promise<void> => {
      const first: Recorder = openPage();
      const second: Recorder = openPage();
      const sessionId: string = first.getSessionId();

      expect(second.getSessionId()).toBe(sessionId);

      /* The sign-in happens in the first tab only. */
      first.identify(USER_A);
      await flushChunk();

      await closePage(second);

      const secondFinal: Frame | undefined = framesFor(sessionId).find(
        (frame: Frame): boolean => {
          return (
            frame.envelope.tabId === second.getTabId() && frame.envelope.isFinal
          );
        },
      );

      expect(secondFinal?.envelope.meta?.identifiedUserRef).toBe(USER_A);
    });

    it("signing in part-way through makes the whole session the user's, without starting another", async (): Promise<void> => {
      const page: Recorder = openPage();
      const sessionId: string = page.getSessionId();

      await flushChunk();

      expect(
        framesFor(sessionId)[0]?.envelope.meta?.identifiedUserRef,
      ).toBeUndefined();

      page.identify(USER_A, { plan: "pro" });
      await flushChunk();

      expect(page.getSessionId()).toBe(sessionId);

      const identified: Frame | undefined = metaFramesFor(sessionId).find(
        (frame: Frame): boolean => {
          return frame.envelope.meta?.identifiedUserRef === USER_A;
        },
      );

      expect(identified).toBeDefined();
      expect(identified?.envelope.meta?.identifiedUserTraits).toEqual({
        plan: "pro",
      });

      expect(storedUserRecord()).toEqual({
        sessionId: sessionId,
        userRef: USER_A,
      });

      /* Nothing rotated. */
      expect(
        allFrames().some((frame: Frame): boolean => {
          return (
            frame.payload.indexOf(SessionRotationReason.IdentityChange) >= 0
          );
        }),
      ).toBe(false);
    });

    it("identifying the same user again, on any page, keeps the session", async (): Promise<void> => {
      const first: Recorder = openPage();
      const sessionId: string = first.getSessionId();

      first.identify(USER_A);
      first.identify(`  ${USER_A}  `);
      await flushChunk();
      await closePage(first);

      expect(first.isStopped()).toBe(true);

      const second: Recorder = openPage({
        beforeStart: (page: Recorder): void => {
          page.identify(USER_A);
        },
      });

      expect(second.getSessionId()).toBe(sessionId);

      second.identify(USER_A, { plan: "pro" });

      expect(second.getSessionId()).toBe(sessionId);
    });
  });

  describe("a different user starts a session of their own", (): void => {
    it("ends the previous user's session under their name and starts the new user's", async (): Promise<void> => {
      const page: Recorder = openPage();
      const firstSessionId: string = page.getSessionId();

      page.identify(USER_A, { role: "manager" });
      await flushChunk();

      page.identify(USER_B);
      await flushChunk();

      const secondSessionId: string = page.getSessionId();

      expect(secondSessionId).not.toBe(firstSessionId);

      /* The previous session is sealed, and the seal still names USER_A. */
      const firstFrames: Array<Frame> = framesFor(firstSessionId);
      const seal: Frame | undefined = firstFrames.find(
        (frame: Frame): boolean => {
          return frame.envelope.isFinal;
        },
      );

      expect(seal).toBeDefined();
      expect(seal?.envelope.meta?.identifiedUserRef).toBe(USER_A);

      for (const frame of firstFrames) {
        expect(frame.envelope.meta?.identifiedUserRef).not.toBe(USER_B);
      }

      /* The new session opens on a snapshot, under USER_B. */
      const secondFrames: Array<Frame> = framesFor(secondSessionId);

      expect(secondFrames[0]?.envelope.chunkIndex).toBe(0);
      expect(secondFrames[0]?.envelope.hasFullSnapshot).toBe(true);
      expect(secondFrames[0]?.envelope.meta?.identifiedUserRef).toBe(USER_B);

      /* USER_A's traits never describe USER_B. */
      for (const frame of secondFrames) {
        expect(frame.envelope.meta?.identifiedUserTraits).toBeUndefined();
        expect(frame.payload).not.toContain("manager");
      }

      expect(page.hasTraits()).toBe(false);

      /* The rotation is disclosed in the new session, with its reason. */
      expect(secondFrames[0]?.payload).toContain(
        SessionRotationReason.IdentityChange,
      );
      expect(secondFrames[0]?.payload).toContain(firstSessionId);

      expect(storedUserRecord()).toEqual({
        sessionId: secondSessionId,
        userRef: USER_B,
      });

      expect(window.localStorage.getItem(SESSION_KEY)).toContain(
        secondSessionId,
      );
    });

    it("tells onSessionChange listeners about the new session", async (): Promise<void> => {
      const seen: Array<string> = [];
      const page: Recorder = new Recorder({
        initOptions: INIT_OPTIONS,
        config: baseConfig(),
        onSessionChange: (sessionId: string): void => {
          seen.push(sessionId);
        },
      });

      pages.push(page);
      page.start();

      page.identify(USER_A);
      await flushChunk();
      page.identify(USER_B);

      expect(seen).toEqual([page.getSessionId()]);
      expect(
        getDebugRecords().some((record: { code: string }): boolean => {
          return record.code === "session-rotated";
        }),
      ).toBe(true);
    });

    it("a different user on the next page starts a new session before anything is recorded", async (): Promise<void> => {
      const first: Recorder = openPage();
      const firstSessionId: string = first.getSessionId();

      first.identify(USER_A);
      await flushChunk();
      await closePage(first);

      fetchMock.mockClear();

      /* identify() queued before the recorder started, as the docs show. */
      const second: Recorder = openPage({
        beforeStart: (page: Recorder): void => {
          page.identify(USER_B);
        },
      });

      const secondSessionId: string = second.getSessionId();

      expect(secondSessionId).not.toBe(firstSessionId);

      await flushChunk();

      /* Nothing of the new page was filed under the previous session. */
      expect(framesFor(firstSessionId)).toEqual([]);

      const opening: Frame | undefined = framesFor(secondSessionId)[0];

      expect(opening?.envelope.chunkIndex).toBe(0);
      expect(opening?.envelope.hasFullSnapshot).toBe(true);
      expect(opening?.envelope.meta?.identifiedUserRef).toBe(USER_B);
      expect(storedUserRecord()).toEqual({
        sessionId: secondSessionId,
        userRef: USER_B,
      });
    });

    it("a load-time userRef for a different user starts a new session; the same user joins", async (): Promise<void> => {
      const first: Recorder = openPage({
        initOptions: { userRef: USER_A },
      });
      const firstSessionId: string = first.getSessionId();

      expect(storedUserRecord()).toEqual({
        sessionId: firstSessionId,
        userRef: USER_A,
      });

      await closePage(first);

      const sameUser: Recorder = openPage({
        initOptions: { userRef: USER_A },
      });

      expect(sameUser.getSessionId()).toBe(firstSessionId);

      await closePage(sameUser);

      const otherUser: Recorder = openPage({
        initOptions: { userRef: USER_B },
      });

      expect(otherUser.getSessionId()).not.toBe(firstSessionId);
      expect(storedUserRecord()).toEqual({
        sessionId: otherUser.getSessionId(),
        userRef: USER_B,
      });

      await flushChunk();

      expect(
        framesFor(otherUser.getSessionId())[0]?.envelope.meta
          ?.identifiedUserRef,
      ).toBe(USER_B);
    });

    it("a page that inherited the user still splits when someone else signs in on it", async (): Promise<void> => {
      const first: Recorder = openPage();
      const firstSessionId: string = first.getSessionId();

      first.identify(USER_A);
      await closePage(first);

      /* Never identifies USER_A itself: it only knows from storage. */
      const second: Recorder = openPage();

      expect(second.getSessionId()).toBe(firstSessionId);

      second.identify(USER_B);

      expect(second.getSessionId()).not.toBe(firstSessionId);
    });

    /*
     * Tab 2 signs a different user in and starts their session. Tab 1,
     * still holding the previous user in memory, adopts the new session -
     * and must file what it records from then on under the user that
     * session belongs to, not the one its stale page state remembers.
     */
    it("a tab that adopts a session another tab started for a different user takes that user", async (): Promise<void> => {
      const tab: Recorder = openPage();
      const firstSessionId: string = tab.getSessionId();

      tab.identify(USER_A, { role: "manager" });
      await flushChunk();

      /* What the other tab's identify(USER_B) leaves in storage. */
      const sibling: SessionIdentityState = SessionId.startNewSession({
        nowUnixMs: Date.now(),
        tabId: "f".repeat(32),
        previousSessionId: firstSessionId,
        rotationReason: SessionRotationReason.IdentityChange,
      });

      SessionId.writeStoredUserRef(sibling.sessionId, USER_B);

      window.dispatchEvent(
        new StorageEvent("storage", { key: SESSION_KEY, newValue: "x" }),
      );

      expect(tab.getSessionId()).toBe(sibling.sessionId);
      expect(tab.hasTraits()).toBe(false);

      await flushChunk();

      const adopted: Array<Frame> = metaFramesFor(sibling.sessionId);

      expect(adopted.length).toBeGreaterThan(0);

      for (const frame of adopted) {
        expect(frame.envelope.meta?.identifiedUserRef).toBe(USER_B);
        expect(frame.envelope.meta?.identifiedUserTraits).toBeUndefined();
      }

      /* Adopting did not overwrite who the session belongs to. */
      expect(storedUserRecord()).toEqual({
        sessionId: sibling.sessionId,
        userRef: USER_B,
      });

      /* And did not start a third session. */
      expect(tab.getSessionId()).toBe(sibling.sessionId);
    });
  });

  describe("a session the tab starts itself", (): void => {
    function expireSessionByDurationCap(sessionId: string): void {
      window.localStorage.setItem(
        SESSION_KEY,
        JSON.stringify({
          sessionId: sessionId,
          sessionStartUnixMs: Date.now() - SESSION_REPLAY_MAX_SESSION_MS - 1000,
          lastActivityUnixMs: Date.now(),
        }),
      );
    }

    it("carries the user this page identified into the next session", async (): Promise<void> => {
      const page: Recorder = openPage();
      const firstSessionId: string = page.getSessionId();

      page.identify(USER_A, { plan: "pro" });
      await flushChunk();

      expireSessionByDurationCap(firstSessionId);
      await flushChunk();

      const secondSessionId: string = page.getSessionId();

      expect(secondSessionId).not.toBe(firstSessionId);
      expect(storedUserRecord()).toEqual({
        sessionId: secondSessionId,
        userRef: USER_A,
      });

      await flushChunk();

      const opening: Frame | undefined = framesFor(secondSessionId)[0];

      expect(opening?.envelope.meta?.identifiedUserRef).toBe(USER_A);
      expect(opening?.envelope.meta?.identifiedUserTraits).toEqual({
        plan: "pro",
      });
    });

    /*
     * A reference this page only inherited belonged to the session that
     * just ended. The page never said who is signed in on it - it may be
     * the login page that user signed out to - so the next session is
     * nobody's until a page identifies it.
     */
    it("does not carry a user this page only inherited into the next session", async (): Promise<void> => {
      const first: Recorder = openPage();
      const firstSessionId: string = first.getSessionId();

      first.identify(USER_A);
      await closePage(first);

      const second: Recorder = openPage();

      expect(second.getSessionId()).toBe(firstSessionId);

      expireSessionByDurationCap(firstSessionId);
      await flushChunk();

      const nextSessionId: string = second.getSessionId();

      expect(nextSessionId).not.toBe(firstSessionId);
      expect(SessionId.readStoredUserRef(nextSessionId)).toBeNull();

      await flushChunk();

      for (const frame of metaFramesFor(nextSessionId)) {
        expect(frame.envelope.meta?.identifiedUserRef).toBeUndefined();
      }
    });
  });

  describe("privacy", (): void => {
    it("with identity capture off nothing is stored, nothing is sent, and a different user does not split the session", async (): Promise<void> => {
      const page: Recorder = openPage({
        config: { captureUserIdentity: false },
      });
      const sessionId: string = page.getSessionId();

      page.identify(USER_A, { plan: "pro" });
      await flushChunk();

      expect(window.localStorage.getItem(USER_KEY)).toBeNull();

      page.identify(USER_B);
      await flushChunk();

      expect(page.getSessionId()).toBe(sessionId);
      expect(window.localStorage.getItem(USER_KEY)).toBeNull();

      for (const frame of allFrames()) {
        expect(frame.envelope.meta?.identifiedUserRef).toBeUndefined();
        expect(frame.payload).not.toContain(USER_A);
        expect(frame.payload).not.toContain(USER_B);
      }

      /* Naming someone else without traits drops the first person's. */
      expect(page.hasTraits()).toBe(false);
    });

    it("a later page does not read a user stored while capture was on once it is off", async (): Promise<void> => {
      const first: Recorder = openPage();

      first.identify(USER_A);
      await closePage(first);

      const second: Recorder = openPage({
        config: { captureUserIdentity: false },
      });

      await flushChunk();
      await closePage(second);

      for (const frame of metaFramesFor(second.getSessionId())) {
        if (frame.envelope.tabId === second.getTabId()) {
          expect(frame.envelope.meta?.identifiedUserRef).toBeUndefined();
        }
      }
    });

    it("revokeConsent forgets whose the session was; a grant starts a new session for the page's own user", async (): Promise<void> => {
      const page: Recorder = openPage({
        config: { consentMode: SessionReplayConsentMode.RequireExplicit },
      });

      page.grantConsent();
      page.identify(USER_A);

      expect(storedUserRecord()?.["userRef"]).toBe(USER_A);

      page.revokeConsent();

      expect(window.localStorage.getItem(USER_KEY)).toBeNull();

      /* Nothing is written while consent is withdrawn. */
      page.identify(USER_A, { plan: "pro" });

      expect(window.localStorage.getItem(USER_KEY)).toBeNull();

      page.grantConsent();

      expect(storedUserRecord()).toEqual({
        sessionId: page.getSessionId(),
        userRef: USER_A,
      });
    });

    /*
     * The session and visitor ids are random tokens; the reference is a
     * person's. Under RequireExplicit it stays in the page's memory until
     * the banner is answered, and the grant is what writes it.
     */
    it("under explicit consent the user is not stored before the grant", (): void => {
      const page: Recorder = openPage({
        config: { consentMode: SessionReplayConsentMode.RequireExplicit },
        initOptions: { userRef: USER_A },
      });

      page.identify(USER_A, { plan: "pro" });

      expect(window.localStorage.getItem(USER_KEY)).toBeNull();

      page.grantConsent();

      expect(storedUserRecord()).toEqual({
        sessionId: page.getSessionId(),
        userRef: USER_A,
      });
    });

    it("a whitespace-only reference is ignored", (): void => {
      const page: Recorder = openPage();

      page.identify("   ", { plan: "pro" });

      expect(page.hasTraits()).toBe(false);
      expect(window.localStorage.getItem(USER_KEY)).toBeNull();
    });

    it("identify() after stop() writes nothing to storage", async (): Promise<void> => {
      const page: Recorder = openPage();

      await closePage(page);
      page.identify(USER_A);

      expect(window.localStorage.getItem(USER_KEY)).toBeNull();
    });
  });
});
