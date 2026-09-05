import crypto from "crypto";
import zlib from "zlib";
import { BASE_URL } from "../../../Config";
import { APIResponse, Locator, Page, expect } from "@playwright/test";
import URL from "Common/Types/API/URL";
import { gotoProjectPage } from "./ProductOnboarding";

/*
 * Helpers for the session replay end-to-end spec.
 *
 * The recorder itself is a browser bundle served to third-party origins, and
 * driving it for real would mean standing up a second web server just to host
 * a page with a script tag on it. Everything AFTER the recorder is what these
 * helpers exercise: the exact wire frame the recorder produces, posted to the
 * real ingest endpoint with a real ingestion key, and then read back through
 * the real dashboard.
 *
 * The frame format is deliberately built here by hand rather than imported
 * from the recorder. The wire contract has two independent implementations —
 * Transport.ts writes it, SessionReplayEnvelopeParser.ts reads it — and a
 * helper that shared code with either side would stop being a test of the
 * contract between them. (The E2E image ships only ./Common and ./E2E, so the
 * recorder sources are not importable here anyway; the byte-for-byte
 * comparison with Transport.buildBody belongs in a jest contract test where
 * both packages are on disk. buildSessionReplayFrame is exported so that
 * test can reuse this framing.)
 *
 * ONE CLOCK. Every timestamp in a fixture derives from sessionStartUnixMs:
 * an rrweb event at offset O inside chunk N is stamped
 * sessionStartUnixMs + chunkStartOffsetMs(N) + O, chunkStartOffsetMs is
 * N * 15s unless overridden, and clientSendUnixMs is the chunk's end on that
 * same clock. The previous fixture stamped every event Date.now() while the
 * envelope claimed offsets 60 seconds earlier, which no player could ever
 * have been caught misreading because the two clocks never had to agree.
 */

/* Mirrors SESSION_REPLAY_WIRE_VERSION / SESSION_REPLAY_SCHEMA_VERSION. */
const WIRE_VERSION: number = 1;
const SCHEMA_VERSION: number = 1;

const CHUNK_CONTENT_TYPE: string =
  "application/vnd.oneuptime.session-replay.v1";

/* The recorder flushes a chunk every 15 seconds. */
export const SESSION_REPLAY_CHUNK_MS: number = 15000;

/*
 * The text the reconstructed page shows. The spec reads it back out of the
 * player's iframe, which is the only way to prove the footage rendered and
 * not merely that the chrome around it did.
 */
export const SESSION_REPLAY_FIXTURE_TEXT: string = "e2e session replay";

/*
 * An "active" chunk carries a mouse move this often. The player's idle map
 * treats silence of 5s or more as idle, so 2.5s keeps an active chunk active
 * while leaving an idle chunk (activityEveryMs: null) genuinely silent.
 */
export const SESSION_REPLAY_FIXTURE_ACTIVITY_EVERY_MS: number = 2500;

/* rrweb event types the fixture emits. */
const RRWEB_TYPE_FULL_SNAPSHOT: number = 2;
const RRWEB_TYPE_INCREMENTAL: number = 3;
const RRWEB_TYPE_META: number = 4;
const RRWEB_TYPE_CUSTOM: number = 5;

/* rrweb incremental sources. */
const RRWEB_SOURCE_MUTATION: number = 0;
const RRWEB_SOURCE_MOUSE_MOVE: number = 1;

/* Node ids inside the fixture snapshot. */
const FIXTURE_APP_NODE_ID: number = 5;
const FIXTURE_TEXT_NODE_ID: number = 6;

/*
 * Tags the recorder stamps on its rrweb custom events. Spelled out here
 * rather than imported so a renamed tag on either side fails this spec.
 */
export const SESSION_REPLAY_EVENT_TAG: {
  click: string;
  console: string;
  network: string;
  route: string;
  error: string;
  frustration: string;
  custom: string;
} = {
  click: "oneuptime.click",
  console: "oneuptime.console",
  network: "oneuptime.network",
  route: "oneuptime.route",
  error: "oneuptime.error",
  frustration: "oneuptime.frustration",
  custom: "oneuptime.custom",
};

/*
 * One recorder custom event inside a chunk, placed by its offset from the
 * chunk's start. The poster stamps the absolute timestamp.
 */
export interface SessionReplayFixtureEvent {
  atOffsetMs: number;
  tag: string;
  payload: Record<string, unknown>;
}

export interface SessionReplayChunkOptions {
  page: Page;
  ingestionKey: string;
  appIdentifier: string;
  sessionId: string;
  tabId: string;
  chunkIndex: number;
  sessionStartUnixMs: number;

  /* Where the page was when this chunk was flushed. */
  url: string;

  /* Every distinct page the chunk covered, in order. */
  routes?: Array<string>;

  /*
   * Where the SESSION began. The recorder captures this once at start() and
   * repeats it on every meta-bearing chunk, so a final chunk flushed on
   * /checkout still says the session entered on /. Defaults to the first
   * route (right for chunk 0, wrong for a later chunk - pass it).
   */
  entryUrl?: string;

  isFinal?: boolean;
  hasFullSnapshot?: boolean;
  errorCount?: number;
  rageClickCount?: number;
  routeCount?: number;

  /*
   * Session-level metadata. The recorder sends meta on chunk 0, the final
   * chunk, and the next chunk after identify()/setTags(); the fixture sends
   * it whenever any of these is given.
   */
  identifiedUserRef?: string;
  identifiedUserTraits?: Record<string, string>;
  tags?: Record<string, string>;

  /* Trace ids of the requests this chunk observed (envelope.traceIds). */
  traceIds?: Array<string>;

  /* Recorder custom events inside this chunk. */
  events?: Array<SessionReplayFixtureEvent>;

  /*
   * Mouse-move cadence. Defaults to an active chunk; null makes an IDLE
   * chunk with no user activity at all (one text mutation keeps it a
   * non-empty chunk, as a page with a ticking clock would).
   */
  activityEveryMs?: number | null;

  /* Override the 15s slot (a chunk that was flushed early or late). */
  chunkStartOffsetMs?: number;
  chunkEndOffsetMs?: number;

  /*
   * Send the payload gzipped, declaring payloadEncoding "gzip" and the
   * COMPRESSED length in payloadBytes - exactly what Transport.ts puts on
   * the wire whenever the browser has CompressionStream, which every
   * browser the recorder supports does.
   *
   * tests-3: nothing else in the repository feeds a real gzip frame to the
   * real ingest. Transport.test.ts asserts the recorder compresses and
   * SessionReplayIngestService gunzips whatever it is handed, but the two
   * halves had never met: a payloadBytes that counted the RAW bytes, or a
   * server default that read "identity" for a compressed body, would pass
   * both unit suites and store nothing but garbage in production. Chunk 1
   * of the journey is posted this way, and the client error the rail
   * assertion later reads back is inside it - so a broken gunzip fails a
   * named assertion rather than going unnoticed.
   */
  compressPayload?: boolean;
}

/* What went on the wire, for assertions on the fixture itself. */
export interface PostedSessionReplayChunk {
  envelope: Record<string, unknown>;
  events: Array<Record<string, unknown>>;
  chunkStartOffsetMs: number;
  chunkEndOffsetMs: number;
  /* "gzip" when the payload was compressed, "identity" otherwise. */
  payloadEncoding: string;
}

/*
 * 32 lowercase hex, matching what SessionId.generateId() mints in the
 * browser - 16 bytes from a CSPRNG, not Math.random(). The recorder uses
 * crypto.getRandomValues for the same reason a session id is not guessable,
 * and a fixture that generated ids a different way would be testing a
 * different shape of value.
 */
type HexIdFunction = () => string;

export const hexId: HexIdFunction = (): string => {
  return crypto.randomBytes(16).toString("hex");
};

/* A W3C trace id: 16 bytes of hex, which is also what a span row carries. */
export const traceId: HexIdFunction = (): string => {
  return crypto.randomBytes(16).toString("hex");
};

type FormatClockFunction = (offsetMs: number) => string;

/* "1:05" for the text the fixture page shows at that offset. */
const formatClock: FormatClockFunction = (offsetMs: number): string => {
  const totalSeconds: number = Math.floor(offsetMs / 1000);
  const minutes: number = Math.floor(totalSeconds / 60);
  const seconds: number = totalSeconds % 60;

  return `${minutes}:${seconds < 10 ? "0" : ""}${seconds}`;
};

/* ---- Recorder custom event builders. ---- */

type ClickEventFunction = (data: {
  atOffsetMs: number;
  selector: string;
  text?: string;
  x?: number;
  y?: number;
}) => SessionReplayFixtureEvent;

/* oneuptime.click as ClickRecorder emits it; atUnixMs is stamped on post. */
export const clickEvent: ClickEventFunction = (data: {
  atOffsetMs: number;
  selector: string;
  text?: string;
  x?: number;
  y?: number;
}): SessionReplayFixtureEvent => {
  return {
    atOffsetMs: data.atOffsetMs,
    tag: SESSION_REPLAY_EVENT_TAG.click,
    payload: {
      selector: data.selector,
      ...(data.text ? { text: data.text } : {}),
      x: data.x ?? 320,
      y: data.y ?? 240,
    },
  };
};

type ConsoleEventFunction = (data: {
  atOffsetMs: number;
  level: "error" | "warn";
  message: string;
}) => SessionReplayFixtureEvent;

export const consoleEvent: ConsoleEventFunction = (data: {
  atOffsetMs: number;
  level: "error" | "warn";
  message: string;
}): SessionReplayFixtureEvent => {
  return {
    atOffsetMs: data.atOffsetMs,
    tag: SESSION_REPLAY_EVENT_TAG.console,
    payload: { level: data.level, message: data.message },
  };
};

type NetworkEventFunction = (data: {
  atOffsetMs: number;
  method: string;
  url: string;
  status: number;
  durationMs: number;
  traceId?: string;
  responseBytes?: number;
}) => SessionReplayFixtureEvent;

/* oneuptime.network; isError follows the status the way the recorder does. */
export const networkEvent: NetworkEventFunction = (data: {
  atOffsetMs: number;
  method: string;
  url: string;
  status: number;
  durationMs: number;
  traceId?: string;
  responseBytes?: number;
}): SessionReplayFixtureEvent => {
  return {
    atOffsetMs: data.atOffsetMs,
    tag: SESSION_REPLAY_EVENT_TAG.network,
    payload: {
      method: data.method,
      url: data.url,
      status: data.status,
      durationMs: data.durationMs,
      responseBytes: data.responseBytes ?? 512,
      isError: data.status === 0 || data.status >= 500,
      initiator: "fetch",
      ...(data.traceId ? { traceId: data.traceId } : {}),
    },
  };
};

type RouteEventFunction = (data: {
  atOffsetMs: number;
  from: string;
  to: string;
}) => SessionReplayFixtureEvent;

export const routeEvent: RouteEventFunction = (data: {
  atOffsetMs: number;
  from: string;
  to: string;
}): SessionReplayFixtureEvent => {
  return {
    atOffsetMs: data.atOffsetMs,
    tag: SESSION_REPLAY_EVENT_TAG.route,
    payload: { from: data.from, to: data.to, kind: "pushState" },
  };
};

type ErrorEventFunction = (data: {
  atOffsetMs: number;
  message: string;
  source?: string;
}) => SessionReplayFixtureEvent;

export const errorEvent: ErrorEventFunction = (data: {
  atOffsetMs: number;
  message: string;
  source?: string;
}): SessionReplayFixtureEvent => {
  return {
    atOffsetMs: data.atOffsetMs,
    tag: SESSION_REPLAY_EVENT_TAG.error,
    payload: {
      kind: "error",
      message: data.message,
      source: data.source ?? "https://shop.e2e.example.com/app.js",
      lineNumber: 12,
      columnNumber: 7,
      stack: `${data.message}\n    at checkout (${data.source ?? "https://shop.e2e.example.com/app.js"}:12:7)`,
    },
  };
};

type RageClickEventFunction = (data: {
  atOffsetMs: number;
  clickCount: number;
}) => SessionReplayFixtureEvent;

/* oneuptime.frustration rage-click; atUnixMs is stamped on post. */
export const rageClickEvent: RageClickEventFunction = (data: {
  atOffsetMs: number;
  clickCount: number;
}): SessionReplayFixtureEvent => {
  return {
    atOffsetMs: data.atOffsetMs,
    tag: SESSION_REPLAY_EVENT_TAG.frustration,
    payload: {
      kind: "rage-click",
      x: 320,
      y: 240,
      clickCount: data.clickCount,
    },
  };
};

type BuildSessionReplayFrameFunction = (
  envelope: Record<string, unknown>,
  payload: string | Uint8Array,
) => Buffer;

/*
 * One frame: `<envelope JSON>\n<payload>`. Exactly Transport.buildBody's
 * layout; kept as a separate function so a contract test can compare the
 * two byte for byte.
 *
 * The payload is bytes, not text, because a gzipped payload is not valid
 * UTF-8 - encoding it as a string would silently replace every byte the
 * decoder does not recognise and the server would receive a body whose
 * length no longer matches the envelope's payloadBytes.
 */
export const buildSessionReplayFrame: BuildSessionReplayFrameFunction = (
  envelope: Record<string, unknown>,
  payload: string | Uint8Array,
): Buffer => {
  const payloadBytes: Uint8Array =
    typeof payload === "string"
      ? new Uint8Array(Buffer.from(payload, "utf8"))
      : payload;

  return Buffer.concat([
    new Uint8Array(Buffer.from(`${JSON.stringify(envelope)}\n`, "utf8")),
    payloadBytes,
  ]);
};

type BuildFixtureSnapshotFunction = () => Record<string, unknown>;

/* A real rrweb FullSnapshot: html > head + body > div#app > text. */
const buildFixtureSnapshot: BuildFixtureSnapshotFunction = (): Record<
  string,
  unknown
> => {
  return {
    node: {
      type: 0,
      id: 1,
      childNodes: [
        {
          type: 2,
          tagName: "html",
          attributes: {},
          id: 2,
          childNodes: [
            {
              type: 2,
              tagName: "head",
              attributes: {},
              id: 3,
              childNodes: [],
            },
            {
              type: 2,
              tagName: "body",
              attributes: {},
              id: 4,
              childNodes: [
                {
                  type: 2,
                  tagName: "div",
                  attributes: { id: "app" },
                  id: FIXTURE_APP_NODE_ID,
                  childNodes: [
                    {
                      type: 3,
                      textContent: SESSION_REPLAY_FIXTURE_TEXT,
                      id: FIXTURE_TEXT_NODE_ID,
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
    initialOffset: { left: 0, top: 0 },
  };
};

type PostSessionReplayChunkFunction = (
  data: SessionReplayChunkOptions,
) => Promise<PostedSessionReplayChunk>;

/*
 * Posts one chunk frame and asserts it was ACCEPTED.
 *
 * The payload is a REAL rrweb event array on the session's clock: a Meta
 * plus FullSnapshot when the envelope claims an anchor (declaring
 * hasFullSnapshot without shipping one would give the player an anchor that
 * rebuilds nothing), mouse moves at the activity cadence, a text mutation at
 * every move so the footage visibly changes, and the recorder's custom
 * events where the caller placed them.
 */
export const postSessionReplayChunk: PostSessionReplayChunkFunction = async (
  data: SessionReplayChunkOptions,
): Promise<PostedSessionReplayChunk> => {
  const chunkUrl: string = URL.fromString(BASE_URL.toString())
    .addRoute("/telemetry/session-replay/v1/chunk")
    .toString();

  const chunkStartOffsetMs: number =
    data.chunkStartOffsetMs ?? data.chunkIndex * SESSION_REPLAY_CHUNK_MS;
  const chunkEndOffsetMs: number =
    data.chunkEndOffsetMs ?? chunkStartOffsetMs + SESSION_REPLAY_CHUNK_MS;
  const chunkStartUnixMs: number = data.sessionStartUnixMs + chunkStartOffsetMs;

  const hasFullSnapshot: boolean =
    data.hasFullSnapshot ?? data.chunkIndex === 0;

  const events: Array<Record<string, unknown>> = [];

  if (hasFullSnapshot) {
    /* Meta rides with the snapshot, as rrweb emits it on a checkout. */
    events.push({
      type: RRWEB_TYPE_META,
      data: { href: data.url, width: 1440, height: 900 },
      timestamp: chunkStartUnixMs,
    });

    events.push({
      type: RRWEB_TYPE_FULL_SNAPSHOT,
      data: buildFixtureSnapshot(),
      timestamp: chunkStartUnixMs + 5,
    });
  }

  const activityEveryMs: number | null =
    data.activityEveryMs === undefined
      ? SESSION_REPLAY_FIXTURE_ACTIVITY_EVERY_MS
      : data.activityEveryMs;

  const chunkLengthMs: number = chunkEndOffsetMs - chunkStartOffsetMs;

  if (activityEveryMs === null) {
    /* Idle: the page's clock still ticks once, the user does nothing. */
    events.push({
      type: RRWEB_TYPE_INCREMENTAL,
      data: {
        source: RRWEB_SOURCE_MUTATION,
        texts: [
          {
            id: FIXTURE_TEXT_NODE_ID,
            value: `${SESSION_REPLAY_FIXTURE_TEXT} · ${formatClock(
              chunkStartOffsetMs + 500,
            )} (idle)`,
          },
        ],
        attributes: [],
        removes: [],
        adds: [],
      },
      timestamp: chunkStartUnixMs + 500,
    });
  } else {
    let step: number = 0;

    for (
      let withinMs: number = 500;
      withinMs < chunkLengthMs;
      withinMs += activityEveryMs
    ) {
      step++;

      events.push({
        type: RRWEB_TYPE_INCREMENTAL,
        data: {
          source: RRWEB_SOURCE_MOUSE_MOVE,
          positions: [
            {
              x: 200 + step * 40,
              y: 160 + step * 20,
              id: FIXTURE_APP_NODE_ID,
              timeOffset: 0,
            },
          ],
        },
        timestamp: chunkStartUnixMs + withinMs,
      });

      events.push({
        type: RRWEB_TYPE_INCREMENTAL,
        data: {
          source: RRWEB_SOURCE_MUTATION,
          texts: [
            {
              id: FIXTURE_TEXT_NODE_ID,
              value: `${SESSION_REPLAY_FIXTURE_TEXT} · ${formatClock(
                chunkStartOffsetMs + withinMs,
              )}`,
            },
          ],
          attributes: [],
          removes: [],
          adds: [],
        },
        timestamp: chunkStartUnixMs + withinMs + 1,
      });
    }
  }

  let clickCount: number = 0;
  let customEventCount: number = 0;

  for (const fixtureEvent of data.events ?? []) {
    const timestamp: number = chunkStartUnixMs + fixtureEvent.atOffsetMs;
    const payload: Record<string, unknown> = { ...fixtureEvent.payload };

    /* Click and frustration payloads carry their own wall-clock stamp. */
    if (
      (fixtureEvent.tag === SESSION_REPLAY_EVENT_TAG.click ||
        fixtureEvent.tag === SESSION_REPLAY_EVENT_TAG.frustration) &&
      payload["atUnixMs"] === undefined
    ) {
      payload["atUnixMs"] = timestamp;
    }

    if (fixtureEvent.tag === SESSION_REPLAY_EVENT_TAG.click) {
      clickCount++;
    }

    if (fixtureEvent.tag === SESSION_REPLAY_EVENT_TAG.custom) {
      customEventCount++;
    }

    events.push({
      type: RRWEB_TYPE_CUSTOM,
      data: { tag: fixtureEvent.tag, payload: payload },
      timestamp: timestamp,
    });
  }

  /* rrweb emits in time order; the fixture must too, or the player stalls. */
  events.sort(
    (a: Record<string, unknown>, b: Record<string, unknown>): number => {
      return (a["timestamp"] as number) - (b["timestamp"] as number);
    },
  );

  const payload: string = JSON.stringify(events);

  /*
   * The bytes that actually go after the newline, and the length the
   * envelope declares. The parser slices exactly payloadBytes from the
   * body, so this number is load-bearing rather than advisory: it is the
   * COMPRESSED length when the frame is gzipped, which is what
   * Transport.ts declares (`payloadBytes: compressed.bytes.length`).
   */
  const payloadBody: Buffer = data.compressPayload
    ? zlib.gzipSync(Buffer.from(payload, "utf8"))
    : Buffer.from(payload, "utf8");
  const payloadEncoding: string = data.compressPayload ? "gzip" : "identity";
  const payloadBytes: number = payloadBody.length;

  const envelope: Record<string, unknown> = {
    v: WIRE_VERSION,
    appIdentifier: data.appIdentifier,
    sessionId: data.sessionId,
    tabId: data.tabId,
    chunkIndex: data.chunkIndex,
    sessionStartUnixMs: data.sessionStartUnixMs,
    /* Flushed at the chunk's end, on the same clock as its events. */
    clientSendUnixMs: data.sessionStartUnixMs + chunkEndOffsetMs + 200,
    chunkStartOffsetMs: chunkStartOffsetMs,
    chunkEndOffsetMs: chunkEndOffsetMs,
    eventCount: events.length,
    hasFullSnapshot: hasFullSnapshot,
    isFinal: data.isFinal ?? false,
    recorderKind: "dom",
    schemaVersion: SCHEMA_VERSION,
    rrwebVersion: "2.1.1",
    recorderVersion: "12.0.0",
    maskingMode: "MaskSensitiveInputsOnly",
    consentState: "NotRequired",
    triggerReason: "sampled",
    payloadEncoding: payloadEncoding,
    payloadBytes: payloadBytes,
    url: data.url,
    routes: data.routes ?? [data.url],
    signals: {
      errorCount: data.errorCount ?? 0,
      rageClickCount: data.rageClickCount ?? 0,
      deadClickCount: 0,
      errorClickCount: 0,
      refreshRageCount: 0,
      routeCount: data.routeCount ?? 0,
      clickCount: clickCount,
      customEventCount: customEventCount,
    },
    fidelityNotices: [],
    droppedEvents: 0,
    flushFailures: 0,
  };

  if (data.traceIds && data.traceIds.length > 0) {
    envelope["traceIds"] = data.traceIds;
  }

  if (data.chunkIndex === 0) {
    /* What this recorder build can do; the header stores it verbatim. */
    envelope["capabilities"] = [
      "click-events",
      "web-vitals",
      "custom-events",
      "traits",
      "tags",
      "visibility",
    ];
  }

  const isMetaChunk: boolean =
    data.chunkIndex === 0 ||
    envelope["isFinal"] === true ||
    data.identifiedUserRef !== undefined ||
    data.identifiedUserTraits !== undefined ||
    data.tags !== undefined;

  if (isMetaChunk) {
    const meta: Record<string, unknown> = {
      /*
       * The ENTRY url, not the current one. The recorder captures this once
       * at start(), so it is the same value on chunk 0 and on the final
       * chunk even after the page has navigated - and the ingest writes a
       * new header version from every meta-bearing chunk, so a fixture that
       * sent the current page here would move the session's entry with it.
       */
      entryUrl: data.entryUrl ?? data.routes?.[0] ?? data.url,
      browserName: "Chrome",
      browserVersion: "141",
      osName: "macOS",
      deviceType: "desktop",
      viewportWidth: 1440,
      viewportHeight: 900,
    };

    if (data.identifiedUserRef) {
      meta["identifiedUserRef"] = data.identifiedUserRef;
    }

    if (data.identifiedUserTraits) {
      meta["identifiedUserTraits"] = data.identifiedUserTraits;
    }

    if (data.tags) {
      meta["tags"] = data.tags;
    }

    envelope["meta"] = meta;
  }

  const body: Buffer = buildSessionReplayFrame(
    envelope,
    new Uint8Array(payloadBody),
  );

  const response: APIResponse = await data.page.request.post(chunkUrl, {
    headers: {
      "content-type": CHUNK_CONTENT_TYPE,
      "x-oneuptime-token": data.ingestionKey,
      "x-oneuptime-app-identifier": data.appIdentifier,
    },
    data: body,
  });

  /*
   * 202 is the only success. A 204 means the server DELIBERATELY refused
   * (disabled, unsampled, over budget) and would leave the rest of the spec
   * asserting against a session that was never stored, so it fails here with
   * the reason rather than 180 seconds later with "not visible".
   */
  expect(
    response.status(),
    `chunk ${data.chunkIndex} (${payloadEncoding}) refused: ${await response.text()}`,
  ).toBe(202);

  return {
    envelope: envelope,
    events: events,
    chunkStartOffsetMs: chunkStartOffsetMs,
    chunkEndOffsetMs: chunkEndOffsetMs,
    payloadEncoding: payloadEncoding,
  };
};

export interface ShortSessionOptions {
  page: Page;
  ingestionKey: string;
  appIdentifier: string;
  sessionStartUnixMs: number;
  chunkCount: number;
  url: string;
  identifiedUserRef?: string;
  tags?: Record<string, string>;
}

export interface ShortSession {
  sessionId: string;
  tabId: string;
  durationMs: number;
}

type PostShortSessionFunction = (
  data: ShortSessionOptions,
) => Promise<ShortSession>;

/*
 * A plain contiguous session of N chunks on one page, sealed by a final
 * chunk. What the list-level specs need: rows that differ in length,
 * identity, tags and URL, without the journey fixture's gap and idle
 * stretch.
 */
export const postShortSession: PostShortSessionFunction = async (
  data: ShortSessionOptions,
): Promise<ShortSession> => {
  const sessionId: string = hexId();
  const tabId: string = hexId();

  for (let chunkIndex: number = 0; chunkIndex < data.chunkCount; chunkIndex++) {
    const isFinal: boolean = chunkIndex === data.chunkCount - 1;

    await postSessionReplayChunk({
      page: data.page,
      ingestionKey: data.ingestionKey,
      appIdentifier: data.appIdentifier,
      sessionId: sessionId,
      tabId: tabId,
      chunkIndex: chunkIndex,
      sessionStartUnixMs: data.sessionStartUnixMs,
      url: data.url,
      isFinal: isFinal,
      events: [
        clickEvent({
          atOffsetMs: 1000,
          selector: "button#continue",
          text: "Continue",
        }),
      ],
      ...(chunkIndex === 0 || isFinal
        ? {
            ...(data.identifiedUserRef
              ? { identifiedUserRef: data.identifiedUserRef }
              : {}),
            ...(data.tags ? { tags: data.tags } : {}),
          }
        : {}),
    });
  }

  return {
    sessionId: sessionId,
    tabId: tabId,
    durationMs: data.chunkCount * SESSION_REPLAY_CHUNK_MS,
  };
};

type CreateRumApplicationFunction = (data: {
  page: Page;
  projectId: string;
  name: string;
  appIdentifier: string;
}) => Promise<void>;

/*
 * Creates a RUM application THROUGH THE DASHBOARD FORM, which is the point.
 *
 * appIdentifier is a required column with no default, and it shipped with an
 * empty create ACL — so ModelForm stripped the field out of the rendered form
 * and the POST that followed was rejected by the server with "appIdentifier
 * is required". The Create button was a dead end for every user, and the only
 * way a RUM application could exist was auto-discovery from telemetry. Nothing
 * failed at build time and no unit test covered the form, which is why this
 * assertion lives at this level.
 */
export const createRumApplication: CreateRumApplicationFunction = async (data: {
  page: Page;
  projectId: string;
  name: string;
  appIdentifier: string;
}): Promise<void> => {
  const page: Page = data.page;

  const rumUrl: string = URL.fromString(BASE_URL.toString())
    .addRoute(`/dashboard/${data.projectId}/rum`)
    .toString();

  await gotoProjectPage({
    page,
    projectId: data.projectId,
    url: rumUrl,
    ready: page.getByRole("button", { name: "Create RUM Application" }),
  });

  await page.getByRole("button", { name: "Create RUM Application" }).click();
  await page.getByTestId("modal").waitFor({ state: "visible" });

  await page
    .locator("input[placeholder='storefront-web']")
    .first()
    .fill(data.name);

  /*
   * The App Identifier input. It shares the placeholder with Name, so it is
   * addressed by position — and its very presence is the regression this
   * helper exists to catch: when the column was not creatable, this locator
   * resolved to nothing.
   */
  const identifierInput: Locator = page
    .locator("input[placeholder='storefront-web']")
    .nth(1);

  await expect(
    identifierInput,
    "The create form must render an App Identifier field - the server requires the column",
  ).toBeVisible();

  await identifierInput.fill(data.appIdentifier);

  await page
    .getByRole("button", { name: "Create RUM Application" })
    .last()
    .click();

  /* The modal closes only on a successful create. */
  await page.getByTestId("modal").waitFor({ state: "hidden", timeout: 60000 });

  await expect(page.getByText(data.name).first()).toBeVisible({
    timeout: 60000,
  });
};

type OpenRumApplicationsFunction = (data: {
  page: Page;
  projectId: string;
}) => Promise<void>;

/* The RUM applications roster, where the Connected / Disconnected pill lives. */
export const openRumApplications: OpenRumApplicationsFunction = async (data: {
  page: Page;
  projectId: string;
}): Promise<void> => {
  const rumUrl: string = URL.fromString(BASE_URL.toString())
    .addRoute(`/dashboard/${data.projectId}/rum`)
    .toString();

  await gotoProjectPage({
    page: data.page,
    projectId: data.projectId,
    url: rumUrl,
    ready: data.page.getByRole("button", { name: "Create RUM Application" }),
  });
};

type OpenSessionReplayListFunction = (data: {
  page: Page;
  projectId: string;
  rumApplicationId: string;
}) => Promise<void>;

export const openSessionReplayList: OpenSessionReplayListFunction =
  async (data: {
    page: Page;
    projectId: string;
    rumApplicationId: string;
  }): Promise<void> => {
    const listUrl: string = URL.fromString(BASE_URL.toString())
      .addRoute(
        `/dashboard/${data.projectId}/rum/${data.rumApplicationId}/session-replay`,
      )
      .toString();

    await gotoProjectPage({
      page: data.page,
      projectId: data.projectId,
      url: listUrl,
      ready: data.page.getByTestId("session-search-input"),
    });
  };

type OpenSessionReplayPlayerFunction = (data: {
  page: Page;
  projectId: string;
  rumApplicationId: string;
  sessionId: string;
  /* "t=27" / "at=...&rail=errors": the player's URL model. */
  query?: string;
}) => Promise<void>;

/*
 * Opens the player directly, the way a link from a log line, a span or an
 * exception does. Ready once the shell has decided what it is showing:
 * footage, a still-loading manifest, or an explained failure.
 */
export const openSessionReplayPlayer: OpenSessionReplayPlayerFunction =
  async (data: {
    page: Page;
    projectId: string;
    rumApplicationId: string;
    sessionId: string;
    query?: string;
  }): Promise<void> => {
    const playerUrl: string = `${URL.fromString(BASE_URL.toString())
      .addRoute(
        `/dashboard/${data.projectId}/rum/${data.rumApplicationId}/session-replay/${data.sessionId}`,
      )
      .toString()}${data.query ? `?${data.query}` : ""}`;

    await gotoProjectPage({
      page: data.page,
      projectId: data.projectId,
      url: playerUrl,
      ready: data.page
        .getByTestId("replay-player")
        .or(data.page.getByTestId("replay-loading"))
        .or(data.page.getByTestId("replay-manifest-failure"))
        .first(),
    });
  };

type SearchSessionReplayListFunction = (data: {
  page: Page;
  query: string;
}) => Promise<void>;

/*
 * Types into the search box and presses Enter, which flushes the 300ms
 * debounce so the list re-queries at once.
 */
export const searchSessionReplayList: SearchSessionReplayListFunction =
  async (data: { page: Page; query: string }): Promise<void> => {
    const input: Locator = data.page.getByTestId("session-search-input");

    await input.fill(data.query);
    await input.press("Enter");
  };

type SelectSessionReplaySortFunction = (data: {
  page: Page;
  label: "Newest" | "Longest" | "Most errors" | "Most frustration";
}) => Promise<void>;

/* The sort control is a react-select; its input carries the aria-label. */
export const selectSessionReplaySort: SelectSessionReplaySortFunction =
  async (data: {
    page: Page;
    label: "Newest" | "Longest" | "Most errors" | "Most frustration";
  }): Promise<void> => {
    await data.page.getByRole("combobox", { name: "Sort sessions" }).click();
    await data.page.getByRole("option", { name: data.label }).click();
  };

type ReadListedSessionIdsFunction = (page: Page) => Promise<Array<string>>;

/* The session ids on the current list page, in row order. */
export const readListedSessionIds: ReadListedSessionIdsFunction = async (
  page: Page,
): Promise<Array<string>> => {
  const ids: Array<string | null> = await page
    .getByTestId("session-row")
    .evaluateAll((rows: Array<Element>): Array<string | null> => {
      return rows.map((row: Element): string | null => {
        return row.getAttribute("data-session-id");
      });
    });

  return ids.filter((id: string | null): id is string => {
    return typeof id === "string" && id.length > 0;
  });
};

type ReadRumApplicationIdFunction = (data: {
  page: Page;
  projectId: string;
  appIdentifier: string;
}) => Promise<string>;

/*
 * The application's id, read back through the same CRUD API the dashboard
 * uses. Needed because every replay read route is scoped to it.
 */
export const readRumApplicationId: ReadRumApplicationIdFunction = async (data: {
  page: Page;
  projectId: string;
  appIdentifier: string;
}): Promise<string> => {
  const listUrl: string = URL.fromString(BASE_URL.toString())
    .addRoute("/api/rum-application/get-list")
    .toString();

  /*
   * tenantid is what ProjectAuthorization resolves the caller's project role
   * from. Without it the CRUD API cannot tell which project this user is a
   * member of and answers "You do not have permissions to read RUM
   * Application" - which reads like a permission bug rather than a missing
   * header. Every other E2E helper that calls the CRUD API sends it.
   */
  const response: APIResponse = await data.page.request.post(listUrl, {
    headers: {
      "content-type": "application/json",
      tenantid: data.projectId,
    },
    data: {
      query: {
        projectId: data.projectId,
        appIdentifier: data.appIdentifier,
      },
      select: { _id: true, appIdentifier: true },
      limit: 10,
      skip: 0,
      sort: {},
    },
  });

  expect(response.status(), await response.text()).toBe(200);

  const body: {
    data?: Array<{ _id?: string; appIdentifier?: string }>;
  } = (await response.json()) as {
    data?: Array<{ _id?: string; appIdentifier?: string }>;
  };

  const match: { _id?: string } | undefined = (body.data || []).find(
    (row: { appIdentifier?: string }): boolean => {
      return row.appIdentifier === data.appIdentifier;
    },
  );

  expect(
    match?._id,
    `No RUM application found for identifier ${data.appIdentifier}`,
  ).toBeTruthy();

  return match!._id!;
};

type UpdateRumApplicationFunction = (data: {
  page: Page;
  projectId: string;
  rumApplicationId: string;
  data: Record<string, unknown>;
}) => Promise<void>;

/*
 * Edits the application through the CRUD API the settings form uses
 * (PUT /api/rum-application/:id with { data }). Replay-relevant columns
 * invalidate the ingest's policy cache on write, so the next /config fetch
 * sees the change.
 */
export const updateRumApplication: UpdateRumApplicationFunction = async (data: {
  page: Page;
  projectId: string;
  rumApplicationId: string;
  data: Record<string, unknown>;
}): Promise<void> => {
  const updateUrl: string = URL.fromString(BASE_URL.toString())
    .addRoute(`/api/rum-application/${data.rumApplicationId}`)
    .toString();

  const response: APIResponse = await data.page.request.put(updateUrl, {
    headers: {
      "content-type": "application/json",
      tenantid: data.projectId,
    },
    data: { data: data.data },
  });

  expect(
    response.status(),
    `RUM application update refused: ${await response.text()}`,
  ).toBe(200);
};

export interface SessionReplayConfig {
  enabled?: boolean;
  directive?: string;
  recorderVersion?: string;
  recorderIntegrity?: string;
  maskingMode?: string;
  samplePercentage?: number;
  disabledReason?: string;
  disabledDetail?: string;
}

type FetchSessionReplayConfigFunction = (data: {
  page: Page;
  ingestionKey: string;
  appIdentifier: string;
}) => Promise<SessionReplayConfig>;

/*
 * What the loader stub fetches before it will load anything. Fetching it is
 * also the one request a page makes under a policy that records nothing by
 * design, and the ingest stamps the application's liveness from it - which
 * is what lets the dashboard say "the recorder loaded but nothing uploaded".
 */
export const fetchSessionReplayConfig: FetchSessionReplayConfigFunction =
  async (data: {
    page: Page;
    ingestionKey: string;
    appIdentifier: string;
  }): Promise<SessionReplayConfig> => {
    const response: APIResponse = await data.page.request.get(
      URL.fromString(BASE_URL.toString())
        .addRoute("/telemetry/session-replay/v1/config")
        .toString(),
      {
        headers: {
          "x-oneuptime-token": data.ingestionKey,
          "x-oneuptime-app-identifier": data.appIdentifier,
        },
      },
    );

    expect(response.status(), await response.text()).toBe(200);

    return (await response.json()) as SessionReplayConfig;
  };

type ReadSessionReplayViewCountFunction = (data: {
  page: Page;
  projectId: string;
  rumApplicationId: string;
  sessionId: string;
}) => Promise<number>;

/*
 * How many audit rows ("who watched") this session has. Read through the
 * dashboard's own route rather than the analytics table so the count is the
 * one the Replay Access Log page would show.
 */
export const readSessionReplayViewCount: ReadSessionReplayViewCountFunction =
  async (data: {
    page: Page;
    projectId: string;
    rumApplicationId: string;
    sessionId: string;
  }): Promise<number> => {
    const viewsUrl: string = URL.fromString(BASE_URL.toString())
      .addRoute("/api/telemetry/rum/session-replay/views")
      .toString();

    const response: APIResponse = await data.page.request.post(viewsUrl, {
      headers: {
        "content-type": "application/json",
        tenantid: data.projectId,
      },
      data: {
        sessionId: data.sessionId,
        rumApplicationId: data.rumApplicationId,
        limit: 50,
      },
    });

    expect(response.status(), await response.text()).toBe(200);

    const body: { views?: Array<unknown> } = (await response.json()) as {
      views?: Array<unknown>;
    };

    return (body.views || []).length;
  };
