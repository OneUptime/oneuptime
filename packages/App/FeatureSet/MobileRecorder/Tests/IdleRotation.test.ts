import { gunzipSync, strFromU8 } from "fflate";
import {
  CUSTOM_EVENT_TAG,
  ERROR_CUSTOM_EVENT_TAG,
  MAX_SESSION_REPLAY_CHUNKS_PER_SESSION,
  RrwebEvent,
  RrwebEventType,
  SESSION_REPLAY_IDLE_ROLLOVER_MS,
  SESSION_REPLAY_MAX_SESSION_MS,
  SESSION_ROTATED_CUSTOM_EVENT_TAG,
  VISIBILITY_CUSTOM_EVENT_TAG,
} from "../src/Contract";
import {
  MobileReplayStartOptions,
  ReplayFetch,
  validateStartOptions,
  ValidatedStartOptions,
} from "../src/Config";
import MobileReplayRecorder, {
  getReplayStorageNamespace,
  MobileReplayDiagnosticEvent,
} from "../src/MobileReplayRecorder";
import {
  enabledConfig,
  FakeAppState,
  FakeNativeViewTree,
  MemoryStorage,
  response,
  startOptions,
} from "./TestUtils";

/*
 * Issue #4207 on the React Native recorder: a session that ends because
 * nobody used the app for the idle window must end where the user left it -
 * not when the recorder notices - and the app must not start a session nobody
 * is in. These tests drive the recorder's own timers on a fake clock, so the
 * capture tick (every CAPTURE_INTERVAL_MS) and the 15 s flush run as they do
 * on a device.
 */

interface DecodedPost {
  envelope: Record<string, unknown>;
  events: Array<RrwebEvent>;
}

interface IdleHarness {
  recorder: MobileReplayRecorder;
  fetch: jest.MockedFunction<ReplayFetch>;
  posted: Array<DecodedPost>;
  storage: MemoryStorage;
  native: FakeNativeViewTree;
  appState: FakeAppState;
  seenSessionIds: Array<string | null>;
  configFetches(): number;
}

type ReplayFetchInit = NonNullable<Parameters<ReplayFetch>[1]>;

const START_UNIX_MS: number = 1_790_000_000_000;
const CAPTURE_INTERVAL_MS: number = 5_000;
const MINUTE_MS: number = 60_000;
const HOUR_MS: number = 60 * MINUTE_MS;

/*
 * Hours of fake clock run through the recorder's real timers - four hours
 * is close to 3,000 capture ticks - which takes a second or two, more on a
 * busy CI machine, so past Jest's 5 s default.
 */
jest.setTimeout(60_000);

function decodePost(body: unknown): DecodedPost {
  const bytes: Uint8Array = body as Uint8Array;
  const newline: number = bytes.indexOf(10);
  return {
    envelope: JSON.parse(strFromU8(bytes.slice(0, newline))),
    events: JSON.parse(strFromU8(gunzipSync(bytes.slice(newline + 1)))),
  };
}

function harness(
  configOverrides: Record<string, unknown> = {},
  storage: MemoryStorage = new MemoryStorage(),
): IdleHarness {
  const posted: Array<DecodedPost> = [];
  let configFetches: number = 0;
  const fetch: jest.MockedFunction<ReplayFetch> = jest.fn(
    async (url: string, init: ReplayFetchInit = {}) => {
      if (url.endsWith("/config")) {
        configFetches += 1;
        return response(200, enabledConfig(configOverrides));
      }
      posted.push(decodePost(init.body));
      return response(202, { directive: "continue", configEpoch: 7 });
    },
  );
  const native: FakeNativeViewTree = new FakeNativeViewTree();
  const appState: FakeAppState = new FakeAppState();
  /* No injected clock: Date.now() is the fake one, in step with the timers. */
  const recorder: MobileReplayRecorder = new MobileReplayRecorder({
    storage,
    nativeViewTree: native,
    appState,
  });
  const seenSessionIds: Array<string | null> = [];
  recorder.onSessionChange((sessionId: string | null): void => {
    seenSessionIds.push(sessionId);
  });
  recorder.setRootTag(101);
  return {
    recorder,
    fetch,
    posted,
    storage,
    native,
    appState,
    seenSessionIds,
    configFetches(): number {
      return configFetches;
    },
  };
}

function options(
  test: IdleHarness,
  overrides: Partial<MobileReplayStartOptions> = {},
): MobileReplayStartOptions {
  return startOptions({
    fetch: test.fetch,
    captureIntervalMs: CAPTURE_INTERVAL_MS,
    ...overrides,
  });
}

async function start(
  test: IdleHarness,
  overrides: Partial<MobileReplayStartOptions> = {},
): Promise<string> {
  expect(await test.recorder.start(options(test, overrides))).toBe(true);
  return test.recorder.getSessionId() as string;
}

/* Let the recorder's promise chains run without moving the clock. */
async function flush(): Promise<void> {
  for (let round: number = 0; round < 10; round += 1) {
    await jest.advanceTimersByTimeAsync(0);
  }
}

/* Move the clock, running every capture and flush tick that falls due. */
async function elapse(milliseconds: number): Promise<void> {
  await jest.advanceTimersByTimeAsync(milliseconds);
  await flush();
}

/* A finger down on the screen: the user, as far as the recorder is concerned. */
async function touch(test: IdleHarness, x: number, y: number): Promise<void> {
  test.recorder.recordTouch({
    phase: "start",
    x,
    y,
    timestamp: Date.now(),
    targetTag: 2,
  });
  await flush();
}

/* Idle in the foreground until the capture tick seals the session. */
async function idleUntilSealed(test: IdleHarness): Promise<number> {
  await elapse(SESSION_REPLAY_IDLE_ROLLOVER_MS + 2 * CAPTURE_INTERVAL_MS);
  const sealed: Array<MobileReplayDiagnosticEvent> = diagnostics(
    test,
    "session-ended-idle",
  );
  expect(sealed).toHaveLength(1);
  return sealed[0]!.atUnixMs;
}

function diagnostics(
  test: IdleHarness,
  code: string,
): Array<MobileReplayDiagnosticEvent> {
  return test.recorder
    .getDiagnostics()
    .events.filter((event: MobileReplayDiagnosticEvent): boolean => {
      return event.code === code;
    });
}

function postsFor(test: IdleHarness, sessionId: string): Array<DecodedPost> {
  return test.posted.filter((post: DecodedPost): boolean => {
    return post.envelope["sessionId"] === sessionId;
  });
}

function sessionIds(test: IdleHarness): Set<unknown> {
  return new Set(
    test.posted.map((post: DecodedPost): unknown => {
      return post.envelope["sessionId"];
    }),
  );
}

function chunkEndUnixMs(post: DecodedPost): number {
  return (
    (post.envelope["sessionStartUnixMs"] as number) +
    (post.envelope["chunkEndOffsetMs"] as number)
  );
}

function lastChunkEndUnixMs(posts: Array<DecodedPost>): number {
  return Math.max(...posts.map(chunkEndUnixMs));
}

function allEvents(posts: Array<DecodedPost>): Array<RrwebEvent> {
  return posts.flatMap((post: DecodedPost): Array<RrwebEvent> => {
    return post.events;
  });
}

function customTag(event: RrwebEvent | undefined): string | null {
  if (!event || event.type !== RrwebEventType.Custom) {
    return null;
  }
  return (event.data as { tag: string }).tag;
}

function customPayload(event: RrwebEvent | undefined): unknown {
  return (event?.data as { payload?: unknown } | undefined)?.payload;
}

function rotationMarkers(events: Array<RrwebEvent>): Array<RrwebEvent> {
  return events.filter((event: RrwebEvent): boolean => {
    return customTag(event) === SESSION_ROTATED_CUSTOM_EVENT_TAG;
  });
}

function chunkZero(test: IdleHarness, sessionId: string): DecodedPost {
  const post: DecodedPost | undefined = postsFor(test, sessionId).find(
    (candidate: DecodedPost): boolean => {
      return candidate.envelope["chunkIndex"] === 0;
    },
  );
  expect(post).toBeDefined();
  return post as DecodedPost;
}

/*
 * Chunk 0 of a session that followed an idle one: a seek anchor (Meta, then
 * the full snapshot, before anything else), then the rotation marker.
 */
function expectOpensOnSnapshotThenIdleMarker(post: DecodedPost): void {
  expect(post.envelope["hasFullSnapshot"]).toBe(true);
  expect(post.events[0]?.type).toBe(RrwebEventType.Meta);
  expect(post.events[1]?.type).toBe(RrwebEventType.FullSnapshot);
  expect(customTag(post.events[2])).toBe(SESSION_ROTATED_CUSTOM_EVENT_TAG);
  expect(customPayload(post.events[2])).toEqual({ reason: "idle" });
  expect(post.events[2]!.timestamp).toBeGreaterThanOrEqual(
    post.events[1]!.timestamp,
  );
  expect(rotationMarkers(post.events)).toHaveLength(1);
}

describe("MobileReplayRecorder idle sessions", () => {
  beforeEach((): void => {
    jest.useFakeTimers({
      now: START_UNIX_MS,
      doNotFake: ["nextTick", "queueMicrotask"],
    });
  });

  afterEach((): void => {
    jest.useRealTimers();
  });

  describe("returning from the background", () => {
    test("after the idle window, the old session ends where the app was left, not on return", async () => {
      const test: IdleHarness = harness();
      const oldSessionId: string = await start(test);
      await touch(test, 120, 240);
      await elapse(20_000);

      test.appState.emit("background");
      await flush();
      const backgroundedAtUnixMs: number = Date.now();

      await elapse(2 * HOUR_MS);
      test.appState.emit("active");
      await flush();
      const returnedAtUnixMs: number = Date.now();
      const newSessionId: string | null = test.recorder.getSessionId();
      expect(newSessionId).toEqual(expect.any(String));
      expect(newSessionId).not.toBe(oldSessionId);
      await test.recorder.stop();

      /*
       * The old session's last chunk is the one the app sent as it went to
       * the background, and nothing dated two hours later follows it.
       */
      const oldPosts: Array<DecodedPost> = postsFor(test, oldSessionId);
      expect(oldPosts.length).toBeGreaterThan(0);
      expect(lastChunkEndUnixMs(oldPosts)).toBe(backgroundedAtUnixMs);
      for (const post of oldPosts) {
        expect(chunkEndUnixMs(post)).toBeLessThanOrEqual(backgroundedAtUnixMs);
        expect(post.envelope["clientSendUnixMs"]).toBeLessThan(
          returnedAtUnixMs,
        );
      }
      expect(rotationMarkers(allEvents(oldPosts))).toEqual([]);
      expect(JSON.stringify(allEvents(oldPosts))).not.toContain(
        '"state":"visible"',
      );

      /* The new one starts on return, on a snapshot, then the marker. */
      const opening: DecodedPost = chunkZero(test, newSessionId as string);
      expect(opening.envelope["sessionStartUnixMs"]).toBe(returnedAtUnixMs);
      expectOpensOnSnapshotThenIdleMarker(opening);
      /* The return does not take a second snapshot of the same screen. */
      expect(
        opening.events.filter((event: RrwebEvent): boolean => {
          return event.type === RrwebEventType.FullSnapshot;
        }),
      ).toHaveLength(1);
      expect(
        opening.events.some((event: RrwebEvent): boolean => {
          return (
            customTag(event) === VISIBILITY_CUSTOM_EVENT_TAG &&
            (customPayload(event) as { state: string }).state === "visible"
          );
        }),
      ).toBe(true);

      expect(
        diagnostics(test, "session-rotated").map(
          (event: MobileReplayDiagnosticEvent): unknown => {
            return event.details?.["reason"];
          },
        ),
      ).toEqual(["idle"]);
      expect(test.seenSessionIds).toEqual([oldSessionId, newSessionId, null]);
    });

    test("shorter than the idle window, the same session continues", async () => {
      const test: IdleHarness = harness();
      const sessionId: string = await start(test);
      await touch(test, 10, 20);

      test.appState.emit("background");
      await flush();
      await elapse(SESSION_REPLAY_IDLE_ROLLOVER_MS - MINUTE_MS);
      test.appState.emit("active");
      await flush();

      expect(test.recorder.getSessionId()).toBe(sessionId);
      await test.recorder.stop();

      expect(sessionIds(test)).toEqual(new Set([sessionId]));
      const events: Array<RrwebEvent> = allEvents(test.posted);
      expect(rotationMarkers(events)).toEqual([]);
      expect(diagnostics(test, "session-rotated")).toEqual([]);
      expect(diagnostics(test, "session-ended-idle")).toEqual([]);
      const wire: string = JSON.stringify(events);
      expect(wire).toContain('"state":"hidden"');
      expect(wire).toContain('"state":"visible"');
      /* The resume still takes a fresh checkout of the screen. */
      expect(
        events.filter((event: RrwebEvent): boolean => {
          return event.type === RrwebEventType.FullSnapshot;
        }).length,
      ).toBeGreaterThanOrEqual(2);
      expect(test.seenSessionIds).toEqual([sessionId, null]);
    });

    test("a developer event while away dates the old session's end, not the return", async () => {
      const test: IdleHarness = harness();
      const oldSessionId: string = await start(test);
      test.appState.emit("background");
      await flush();

      await elapse(10 * MINUTE_MS);
      const syncedAtUnixMs: number = Date.now();
      test.recorder.track("background-sync-finished");
      await flush();

      await elapse(2 * HOUR_MS);
      test.appState.emit("active");
      await flush();
      const newSessionId: string = test.recorder.getSessionId() as string;
      expect(newSessionId).not.toBe(oldSessionId);
      await test.recorder.stop();

      const oldPosts: Array<DecodedPost> = postsFor(test, oldSessionId);
      const sealing: DecodedPost = oldPosts[oldPosts.length - 1]!;
      expect(sealing.envelope["isFinal"]).toBe(true);
      expect(JSON.stringify(sealing.events)).toContain(
        "background-sync-finished",
      );
      expect(lastChunkEndUnixMs(oldPosts)).toBe(syncedAtUnixMs);
      expect(rotationMarkers(allEvents(oldPosts))).toEqual([]);
      expectOpensOnSnapshotThenIdleMarker(chunkZero(test, newSessionId));
    });

    test("a session that outlived the duration cap while away still ends as idle, where it was left", async () => {
      const test: IdleHarness = harness();
      const oldSessionId: string = await start(test);
      test.appState.emit("background");
      await flush();

      /* Three hours of use, kept alive by the app's own events. */
      let lastActivityUnixMs: number = Date.now();
      for (let step: number = 0; step < 9; step += 1) {
        await elapse(20 * MINUTE_MS);
        lastActivityUnixMs = Date.now();
        test.recorder.track("heartbeat");
        await flush();
      }
      expect(test.recorder.getSessionId()).toBe(oldSessionId);

      /* Two more hours away: past the four-hour cap, and idle. */
      await elapse(2 * HOUR_MS);
      expect(Date.now() - START_UNIX_MS).toBeGreaterThanOrEqual(
        SESSION_REPLAY_MAX_SESSION_MS,
      );
      test.appState.emit("active");
      await flush();
      const newSessionId: string = test.recorder.getSessionId() as string;
      await test.recorder.stop();

      expect(
        diagnostics(test, "session-rotated").map(
          (event: MobileReplayDiagnosticEvent): unknown => {
            return event.details?.["reason"];
          },
        ),
      ).toEqual(["idle"]);
      const oldPosts: Array<DecodedPost> = postsFor(test, oldSessionId);
      expect(lastChunkEndUnixMs(oldPosts)).toBe(lastActivityUnixMs);
      expect(rotationMarkers(allEvents(oldPosts))).toEqual([]);
      expectOpensOnSnapshotThenIdleMarker(chunkZero(test, newSessionId));
    });

    test("a change of user while the app is away ends the old session where it was left", async () => {
      const test: IdleHarness = harness({ captureUserIdentity: true });
      const aliceSessionId: string = await start(test, { userRef: "alice" });
      test.appState.emit("background");
      await flush();
      const backgroundedAtUnixMs: number = Date.now();

      /* A background sign-in refresh, two hours later, as another account. */
      await elapse(2 * HOUR_MS);
      test.recorder.identify("bob");
      await flush();

      /* The session ended where it was left; nobody is back to start one. */
      expect(test.recorder.getSessionId()).toBeNull();
      expect(diagnostics(test, "session-ended-idle")).toHaveLength(1);
      expect(diagnostics(test, "session-rotated")).toEqual([]);

      test.appState.emit("active");
      await flush();
      const bobSessionId: string = test.recorder.getSessionId() as string;
      expect(bobSessionId).toEqual(expect.any(String));
      expect(bobSessionId).not.toBe(aliceSessionId);
      await test.recorder.stop();

      const alicePosts: Array<DecodedPost> = postsFor(test, aliceSessionId);
      expect(lastChunkEndUnixMs(alicePosts)).toBe(backgroundedAtUnixMs);
      expect(rotationMarkers(allEvents(alicePosts))).toEqual([]);
      expect(JSON.stringify(alicePosts)).not.toContain('"bob"');

      const opening: DecodedPost = chunkZero(test, bobSessionId);
      expectOpensOnSnapshotThenIdleMarker(opening);
      expect(opening.envelope["meta"]).toMatchObject({
        identifiedUserRef: "bob",
      });
      expect(
        diagnostics(test, "session-rotated").map(
          (event: MobileReplayDiagnosticEvent): unknown => {
            return event.details?.["reason"];
          },
        ),
      ).toEqual(["idle"]);
    });

    test("stopping after the idle window adds nothing dated at the stop", async () => {
      const test: IdleHarness = harness();
      const sessionId: string = await start(test);
      test.appState.emit("background");
      await flush();
      const backgroundedAtUnixMs: number = Date.now();

      await elapse(2 * HOUR_MS);
      await test.recorder.stop();

      expect(sessionIds(test)).toEqual(new Set([sessionId]));
      expect(lastChunkEndUnixMs(test.posted)).toBe(backgroundedAtUnixMs);
      expect(JSON.stringify(allEvents(test.posted))).not.toContain(
        '"state":"stopped"',
      );
    });

    test("stopping inside the idle window still marks where the recording stopped", async () => {
      const test: IdleHarness = harness();
      await start(test);
      test.appState.emit("background");
      await flush();

      await elapse(10 * MINUTE_MS);
      const stoppedAtUnixMs: number = Date.now();
      await test.recorder.stop();

      const sealing: DecodedPost = test.posted[test.posted.length - 1]!;
      expect(sealing.envelope["isFinal"]).toBe(true);
      expect(chunkEndUnixMs(sealing)).toBe(stoppedAtUnixMs);
      const lastEvent: RrwebEvent = sealing.events[sealing.events.length - 1]!;
      expect(customTag(lastEvent)).toBe(VISIBILITY_CUSTOM_EVENT_TAG);
      expect(customPayload(lastEvent)).toEqual({ state: "stopped" });
    });
  });

  describe("rotations the user is active through are unchanged", () => {
    test("the duration cap still marks and seals the old session at the rotation", async () => {
      const test: IdleHarness = harness();
      const oldSessionId: string = await start(test);

      /* Four hours of use in the foreground, a touch every twenty minutes. */
      for (let step: number = 0; step < 11; step += 1) {
        await elapse(20 * MINUTE_MS);
        await touch(test, 50 + step, 60);
      }
      expect(test.recorder.getSessionId()).toBe(oldSessionId);
      const sessionStartUnixMs: number = START_UNIX_MS;
      await elapse(
        sessionStartUnixMs + SESSION_REPLAY_MAX_SESSION_MS - Date.now(),
      );
      const newSessionId: string | null = test.recorder.getSessionId();
      expect(newSessionId).toEqual(expect.any(String));
      expect(newSessionId).not.toBe(oldSessionId);
      const rotations: Array<MobileReplayDiagnosticEvent> = diagnostics(
        test,
        "session-rotated",
      );
      expect(rotations).toHaveLength(1);
      expect(rotations[0]!.details).toEqual({ reason: "duration" });
      const rotatedAtUnixMs: number = rotations[0]!.atUnixMs;
      await test.recorder.stop();

      /* Marked at the end of the old session, dated at the rotation. */
      const oldPosts: Array<DecodedPost> = postsFor(test, oldSessionId);
      const sealing: DecodedPost = oldPosts[oldPosts.length - 1]!;
      expect(sealing.envelope["isFinal"]).toBe(true);
      const lastEvent: RrwebEvent = sealing.events[sealing.events.length - 1]!;
      expect(customTag(lastEvent)).toBe(SESSION_ROTATED_CUSTOM_EVENT_TAG);
      expect(customPayload(lastEvent)).toEqual({ reason: "duration" });
      expect(lastEvent.timestamp).toBe(rotatedAtUnixMs);
      expect(chunkEndUnixMs(sealing)).toBe(rotatedAtUnixMs);
      expect(
        rotationMarkers(allEvents(postsFor(test, newSessionId as string))),
      ).toEqual([]);
      expect(diagnostics(test, "session-ended-idle")).toEqual([]);
    });

    test("the chunk cap still marks the old session's final chunk", async () => {
      const storage: MemoryStorage = new MemoryStorage();
      const test: IdleHarness = harness({}, storage);
      const validated: ValidatedStartOptions = validateStartOptions(
        options(test),
      )!;
      const namespace: string = getReplayStorageNamespace(validated);
      const oldSessionId: string = "a".repeat(32);
      storage.values.set(
        `@oneuptime/replay/${namespace}/session`,
        JSON.stringify({
          sessionId: oldSessionId,
          sessionStartUnixMs: START_UNIX_MS - 10_000,
          lastActivityUnixMs: START_UNIX_MS - 1_000,
          nextChunkIndex: MAX_SESSION_REPLAY_CHUNKS_PER_SESSION - 1,
        }),
      );
      expect(await test.recorder.start(validated)).toBe(true);
      expect(test.recorder.getSessionId()).toBe(oldSessionId);

      await test.recorder.setRoute("/after-cap");
      await flush();
      expect(test.recorder.getSessionId()).not.toBe(oldSessionId);
      await test.recorder.stop();

      const oldPosts: Array<DecodedPost> = postsFor(test, oldSessionId);
      expect(oldPosts).toHaveLength(1);
      expect(oldPosts[0]!.envelope).toMatchObject({
        chunkIndex: MAX_SESSION_REPLAY_CHUNKS_PER_SESSION - 1,
        isFinal: true,
      });
      expect(rotationMarkers(oldPosts[0]!.events).map(customPayload)).toEqual([
        { reason: "chunk-cap" },
      ]);
    });
  });

  describe("an app left idle in the foreground", () => {
    test("ends its session with its last footage and starts no other", async () => {
      const test: IdleHarness = harness();
      const oldSessionId: string = await start(test);
      await touch(test, 30, 40);
      const lastTouchAtUnixMs: number = Date.now();

      const sealedAtUnixMs: number = await idleUntilSealed(test);
      expect(sealedAtUnixMs - lastTouchAtUnixMs).toBeGreaterThanOrEqual(
        SESSION_REPLAY_IDLE_ROLLOVER_MS,
      );
      expect(sealedAtUnixMs - lastTouchAtUnixMs).toBeLessThanOrEqual(
        SESSION_REPLAY_IDLE_ROLLOVER_MS + CAPTURE_INTERVAL_MS,
      );
      expect(test.recorder.getSessionId()).toBeNull();
      expect(test.seenSessionIds).toEqual([oldSessionId, null]);

      /*
       * The screen stayed on, so the footage runs up to the seal - and the
       * session ends with it: no chunk, and no marker, dated after it.
       */
      const oldPosts: Array<DecodedPost> = postsFor(test, oldSessionId);
      expect(oldPosts.length).toBeGreaterThan(1);
      for (const post of oldPosts) {
        expect(chunkEndUnixMs(post)).toBeLessThanOrEqual(sealedAtUnixMs);
        expect(post.envelope["eventCount"]).toBeGreaterThan(0);
      }
      expect(rotationMarkers(allEvents(oldPosts))).toEqual([]);

      /* Two more hours: nothing captured, uploaded, refreshed or started. */
      const capturesAtSeal: number = test.native.captures;
      const postsAtSeal: number = test.posted.length;
      const configFetchesAtSeal: number = test.configFetches();
      await elapse(2 * HOUR_MS);
      expect(test.native.captures).toBe(capturesAtSeal);
      expect(test.posted).toHaveLength(postsAtSeal);
      expect(test.configFetches()).toBe(configFetchesAtSeal);
      expect(test.recorder.getSessionId()).toBeNull();
      expect(test.recorder.getDiagnostics().status).toBe("recording");

      /* Stopping sends nothing more for a session that already ended. */
      await test.recorder.stop();
      expect(test.posted).toHaveLength(postsAtSeal);
      expect(sessionIds(test)).toEqual(new Set([oldSessionId]));
      expect(diagnostics(test, "session-rotated")).toEqual([]);
    });

    test("the first touch after that starts the next session on a full snapshot, the marker after it", async () => {
      const test: IdleHarness = harness();
      const oldSessionId: string = await start(test);
      await touch(test, 30, 40);
      const sealedAtUnixMs: number = await idleUntilSealed(test);
      await elapse(2 * HOUR_MS);
      const configFetchesBeforeReturn: number = test.configFetches();

      /* The touch that wakes the app is dropped; the screen shows its result. */
      await touch(test, 321, 654);
      const newSessionId: string | null = test.recorder.getSessionId();
      expect(newSessionId).toEqual(expect.any(String));
      expect(newSessionId).not.toBe(oldSessionId);
      expect(
        diagnostics(test, "touch-dropped-session-rotation").length,
      ).toBeGreaterThanOrEqual(1);
      /* The policy the idle app missed is fetched before the session opens. */
      expect(test.configFetches()).toBe(configFetchesBeforeReturn + 1);

      /* The user goes on touching: after the snapshot, never ahead of it. */
      await touch(test, 111, 222);
      await test.recorder.stop();

      const opening: DecodedPost = chunkZero(test, newSessionId as string);
      expectOpensOnSnapshotThenIdleMarker(opening);
      const wire: string = JSON.stringify(opening.events.slice(3));
      expect(wire).toContain('"x":111');
      expect(JSON.stringify(test.posted)).not.toContain('"x":321');

      /* Waking the app sent nothing more for the session that ended. */
      for (const post of postsFor(test, oldSessionId)) {
        expect(chunkEndUnixMs(post)).toBeLessThanOrEqual(sealedAtUnixMs);
      }
      expect(rotationMarkers(allEvents(postsFor(test, oldSessionId)))).toEqual(
        [],
      );
      expect(diagnostics(test, "session-rotated")).toHaveLength(1);
      expect(test.seenSessionIds).toEqual([
        oldSessionId,
        null,
        newSessionId,
        null,
      ]);
    });

    test("developer events, navigation and errors go nowhere and start nothing", async () => {
      const test: IdleHarness = harness();
      const oldSessionId: string = await start(test);
      await idleUntilSealed(test);
      const postsAtSeal: number = test.posted.length;
      const capturesAtSeal: number = test.native.captures;

      test.recorder.track("background-poll", { attempt: 3 });
      test.recorder.setTags({ release: "2026.10" });
      test.recorder.addTag("plan", "team");
      await test.recorder.setRoute("/settings");
      await test.recorder.captureError(new Error("poll failed"));
      await flush();

      expect(test.recorder.getSessionId()).toBeNull();
      expect(test.posted).toHaveLength(postsAtSeal);
      expect(test.native.captures).toBe(capturesAtSeal);
      expect(diagnostics(test, "capture-triggered")).toEqual([]);
      expect(diagnostics(test, "session-rotated")).toEqual([]);

      /* The user comes back: the next session opens where the app now is. */
      await touch(test, 5, 5);
      const newSessionId: string = test.recorder.getSessionId() as string;
      expect(newSessionId).not.toBe(oldSessionId);
      await test.recorder.stop();

      const opening: DecodedPost = chunkZero(test, newSessionId);
      expectOpensOnSnapshotThenIdleMarker(opening);
      expect(opening.envelope["url"]).toBe(
        "app://com.example.checkout/settings",
      );
      expect(opening.envelope["meta"]).toMatchObject({
        entryUrl: "app://com.example.checkout/settings",
        tags: { release: "2026.10", plan: "team" },
      });
      const wire: string = JSON.stringify(allEvents(test.posted));
      expect(wire).not.toContain("background-poll");
      expect(wire).not.toContain(ERROR_CUSTOM_EVENT_TAG);
      expect(wire).not.toContain("oneuptime.route");
    });

    test("captureSession() starts the next session: snapshot, rotation marker, then the capture", async () => {
      const test: IdleHarness = harness();
      const oldSessionId: string = await start(test);
      await idleUntilSealed(test);

      await test.recorder.captureSession("support-ticket");
      await flush();
      const newSessionId: string = test.recorder.getSessionId() as string;
      expect(newSessionId).toEqual(expect.any(String));
      expect(newSessionId).not.toBe(oldSessionId);
      await test.recorder.stop();

      const opening: DecodedPost = chunkZero(test, newSessionId);
      expectOpensOnSnapshotThenIdleMarker(opening);
      expect(customTag(opening.events[3])).toBe(CUSTOM_EVENT_TAG);
      expect(customPayload(opening.events[3])).toMatchObject({
        name: "oneuptime.capture",
      });
    });

    test("coming back to the app starts the next session, however soon after it was put away", async () => {
      const test: IdleHarness = harness();
      const oldSessionId: string = await start(test);
      const sealedAtUnixMs: number = await idleUntilSealed(test);
      const postsAtSeal: number = test.posted.length;

      test.appState.emit("background");
      await flush();
      await elapse(5 * MINUTE_MS);
      expect(test.posted).toHaveLength(postsAtSeal);
      test.appState.emit("active");
      await flush();

      const newSessionId: string = test.recorder.getSessionId() as string;
      expect(newSessionId).toEqual(expect.any(String));
      expect(newSessionId).not.toBe(oldSessionId);
      await test.recorder.stop();

      const oldPosts: Array<DecodedPost> = postsFor(test, oldSessionId);
      expect(lastChunkEndUnixMs(oldPosts)).toBeLessThanOrEqual(sealedAtUnixMs);
      const oldWire: string = JSON.stringify(allEvents(oldPosts));
      expect(oldWire).not.toContain('"state":"hidden"');
      expect(oldWire).not.toContain('"state":"visible"');
      expectOpensOnSnapshotThenIdleMarker(chunkZero(test, newSessionId));
    });

    test("a change of user waits for the user rather than starting a session", async () => {
      const test: IdleHarness = harness({ captureUserIdentity: true });
      const aliceSessionId: string = await start(test, { userRef: "alice" });
      await idleUntilSealed(test);
      const postsAtSeal: number = test.posted.length;

      /* An inactivity logout, then the next account signing in. */
      test.recorder.identify("bob");
      await flush();
      expect(test.recorder.getSessionId()).toBeNull();
      expect(test.recorder.getDiagnostics().sessionId).toBe(aliceSessionId);
      expect(test.posted).toHaveLength(postsAtSeal);
      expect(diagnostics(test, "session-rotated")).toEqual([]);

      await touch(test, 7, 8);
      const bobSessionId: string = test.recorder.getSessionId() as string;
      expect(bobSessionId).not.toBe(aliceSessionId);
      await test.recorder.stop();

      const opening: DecodedPost = chunkZero(test, bobSessionId);
      expectOpensOnSnapshotThenIdleMarker(opening);
      expect(opening.envelope["meta"]).toMatchObject({
        identifiedUserRef: "bob",
      });
      expect(JSON.stringify(postsFor(test, aliceSessionId))).not.toContain(
        '"bob"',
      );
    });

    test("an unsampled recorder drops the ended session's pre-roll and triggers nothing until the user is back", async () => {
      const test: IdleHarness = harness({
        captureTrigger: "OnErrorOrFrustration",
        samplePercentage: 0,
      });
      const oldSessionId: string = await start(test);
      await touch(test, 9, 9);
      await idleUntilSealed(test);

      await test.recorder.captureError(new Error("while nobody is here"));
      await flush();
      expect(test.posted).toEqual([]);
      expect(test.recorder.getDiagnostics().triggered).toBe(false);

      await touch(test, 12, 34);
      const newSessionId: string = test.recorder.getSessionId() as string;
      expect(newSessionId).not.toBe(oldSessionId);
      await test.recorder.captureError(new Error("after the user is back"));
      await flush();
      await test.recorder.stop();

      expect(sessionIds(test)).toEqual(new Set([newSessionId]));
      const opening: DecodedPost = chunkZero(test, newSessionId);
      expect(opening.envelope["triggerReason"]).toBe("error");
      expectOpensOnSnapshotThenIdleMarker(opening);
    });
  });

  test("a user back the moment the window closes, before a tick notices, starts the next session directly", async () => {
    const test: IdleHarness = harness();
    const oldSessionId: string = await start(test);
    await touch(test, 15, 25);
    const lastTouchAtUnixMs: number = Date.now();

    /* The clock moves without a capture tick seeing the session go idle. */
    jest.setSystemTime(lastTouchAtUnixMs + SESSION_REPLAY_IDLE_ROLLOVER_MS);
    await touch(test, 400, 500);
    const newSessionId: string = test.recorder.getSessionId() as string;
    expect(newSessionId).toEqual(expect.any(String));
    expect(newSessionId).not.toBe(oldSessionId);
    await test.recorder.stop();

    expect(diagnostics(test, "session-ended-idle")).toEqual([]);
    const oldPosts: Array<DecodedPost> = postsFor(test, oldSessionId);
    const sealing: DecodedPost = oldPosts[oldPosts.length - 1]!;
    expect(sealing.envelope["isFinal"]).toBe(true);
    expect(lastChunkEndUnixMs(oldPosts)).toBe(lastTouchAtUnixMs);
    expect(rotationMarkers(allEvents(oldPosts))).toEqual([]);
    expectOpensOnSnapshotThenIdleMarker(chunkZero(test, newSessionId));
    expect(JSON.stringify(test.posted)).not.toContain('"x":400');
  });
});
