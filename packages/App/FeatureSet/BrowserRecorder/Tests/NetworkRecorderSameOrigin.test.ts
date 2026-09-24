import {
  ParsedSessionTraceState,
  parseSessionTraceState,
} from "Common/Utils/Rum/SessionTraceState";
import UrlScrubber from "Common/Utils/Rum/UrlScrubber";
import { DebugRecord, clearDebugRecords, getDebugRecords } from "../src/Debug";
import NetworkRecorder, { RecordedRequest } from "../src/NetworkRecorder";

/* Node's vm, for a plain object from another realm. */
declare function require(id: string): unknown;

/*
 * Same-origin trace propagation: the requests a page makes to its OWN
 * origin carry a traceparent and `tracestate: oneuptime=sid:<session>`, so
 * backend spans are stamped with the replay session at ingest.
 *
 * Every test here is about a header added to someone else's request on a
 * page we do not own, so most of them pin when NOTHING is added: a header
 * in the wrong place is a broken request, a doubled traceparent is a
 * broken trace, and a session id sent before consent is a privacy bug.
 *
 * jest.config.json pins the page to https://shop.example.com/checkout.
 */

const PAGE_ORIGIN: string = "https://shop.example.com";
const SESSION_ID: string = "0123456789abcdef0123456789abcdef";
const TRACEPARENT_SHAPE: RegExp = /^00-([0-9a-f]{32})-([0-9a-f]{16})-01$/;
const PAGE_TRACE_ID: string = "a".repeat(32);
const PAGE_TRACEPARENT: string = `00-${PAGE_TRACE_ID}-${"b".repeat(16)}-01`;
const PAGE_TRACESTATE: string = "vendor=abc";
const INNER_TRACE_ID: string = "c".repeat(32);
const INNER_TRACEPARENT: string = `00-${INNER_TRACE_ID}-${"d".repeat(16)}-01`;

type FetchMock = jest.Mock;

interface Completed {
  request: RecordedRequest;
  rollupTraceId: string | null;
}

interface RecorderOptions {
  origins?: Array<string>;
  policy?: boolean;
  sessionId?: () => string | null;
  isSelfRequest?: (url: string) => boolean;
}

interface FakeRequestInit {
  method?: string | undefined;
  mode?: string | undefined;
  headers?: HeadersInit | undefined;
  body?: string | undefined;
  signal?: AbortSignal | undefined;
  referrer?: string | undefined;
  referrerPolicy?: string | undefined;
}

/*
 * A Request stand-in. jsdom ships no Request constructor, so the page's
 * "same-realm Request" is this class installed as window.Request. It keeps
 * the semantics the recorder depends on: init.headers REPLACES the input's
 * headers, the input's body is proxied (the input becomes used), a used
 * input throws, the signal follows the input's, and - the Fetch spec's
 * constructor step - ANY non-empty init resets the referrer to the client
 * ("about:client") and the referrer policy to "" unless the init carries
 * them itself. Members set to undefined do not count, as in WebIDL.
 * Tests/NetworkRecorderRealRequest.test.ts runs the platform's own.
 */
class FakeRequest {
  public readonly url: string;
  public readonly method: string;
  public readonly mode: string;
  public readonly headers: Headers;
  public readonly body: string | null;
  public readonly signal: AbortSignal | null;
  public readonly referrer: string;
  public readonly referrerPolicy: string;
  public bodyUsed: boolean = false;

  public constructor(input: string | FakeRequest, init?: FakeRequestInit) {
    const source: FakeRequest | null =
      input instanceof FakeRequest ? input : null;

    if (source && source.bodyUsed) {
      throw new TypeError("Request body is already used");
    }

    const given: Record<string, unknown> = (init || {}) as Record<
      string,
      unknown
    >;
    const nonEmpty: boolean = Object.keys(given).some(
      (key: string): boolean => {
        return given[key] !== undefined;
      },
    );

    this.url = source
      ? source.url
      : new URL(input as string, document.baseURI).href;
    this.method = (init && init.method) || (source ? source.method : "GET");
    this.mode = (init && init.mode) || (source ? source.mode : "cors");
    this.headers = new Headers(
      init && init.headers !== undefined
        ? init.headers
        : source
          ? source.headers
          : undefined,
    );
    this.body =
      init && init.body !== undefined ? init.body : source ? source.body : null;
    this.signal =
      init && init.signal !== undefined
        ? init.signal
        : source
          ? source.signal
          : null;

    if (init && init.referrer !== undefined) {
      const parsed: URL | null = init.referrer
        ? new URL(init.referrer, document.baseURI)
        : null;

      this.referrer = !parsed
        ? ""
        : parsed.href === "about:client" || parsed.origin !== PAGE_ORIGIN
          ? "about:client"
          : parsed.href;
    } else {
      this.referrer = source && !nonEmpty ? source.referrer : "about:client";
    }

    this.referrerPolicy =
      init && init.referrerPolicy !== undefined
        ? init.referrerPolicy
        : source && !nonEmpty
          ? source.referrerPolicy
          : "";

    if (source && source.body !== null) {
      source.bodyUsed = true;
    }
  }
}

const windowRecord: Record<string, unknown> = window as unknown as Record<
  string,
  unknown
>;

let completed: Array<Completed> = [];
let events: Array<RecordedRequest> = [];
let recorder: NetworkRecorder | null = null;
let savedFetch: unknown;

function makeRecorder(options: RecorderOptions = {}): NetworkRecorder {
  completed = [];
  events = [];

  recorder = new NetworkRecorder({
    emitCustomEvent: (_tag: string, payload: unknown): void => {
      events.push(payload as RecordedRequest);
    },
    onRequestComplete: (
      _atUnixMs: number,
      request: RecordedRequest,
      traceId: string | null,
    ): void => {
      completed.push({ request: request, rollupTraceId: traceId });
    },
    onActivity: (): void => {},
    scrubUrl: (url: string): string => {
      return UrlScrubber.scrub(url);
    },
    isSelfRequest:
      options.isSelfRequest ||
      ((url: string): boolean => {
        return url.indexOf("https://oneuptime.com") === 0;
      }),
    tracePropagationOrigins: options.origins || [],
    sameOriginTracePropagation:
      options.policy === undefined ? true : options.policy,
    getSessionIdForPropagation:
      options.sessionId ||
      ((): string | null => {
        return SESSION_ID;
      }),
  });

  return recorder;
}

function startRecorder(options: RecorderOptions = {}): NetworkRecorder {
  const instance: NetworkRecorder = makeRecorder(options);

  instance.start(window);

  return instance;
}

function okResponse(): Response {
  return {
    status: 200,
    headers: {
      get: (): string | null => {
        return null;
      },
    },
  } as unknown as Response;
}

function installFetch(): FetchMock {
  const mock: FetchMock = jest.fn().mockResolvedValue(okResponse());

  windowRecord["fetch"] = mock;

  return mock;
}

/*
 * The headers one captured call really carried, whatever HeadersInit shape
 * went out. An array with a duplicated name comes back combined ("a, b"),
 * which is exactly how a doubled header would reach the wire.
 */
function sentHeaders(mock: jest.Mock, call: number = 0): Headers {
  const args: Array<unknown> = mock.mock.calls[call] || [];
  const input: unknown = args[0];
  const init: RequestInit | undefined = args[1] as RequestInit | undefined;

  if (init && init.headers !== undefined) {
    const headers: unknown = init.headers;

    if (
      headers instanceof Headers ||
      Array.isArray(headers) ||
      headers instanceof Map
    ) {
      return new Headers(headers as HeadersInit);
    }

    return new Headers(Object.entries(headers as Record<string, string>));
  }

  if (input instanceof FakeRequest) {
    return new Headers(input.headers);
  }

  return new Headers();
}

/* The session member of a tracestate value, or null. */
function sessionMember(value: string | null): ParsedSessionTraceState {
  return parseSessionTraceState(value);
}

function debugRecords(code: string): Array<DebugRecord> {
  return getDebugRecords().filter((record: DebugRecord): boolean => {
    return record.code === code;
  });
}

function defineWindowOrigin(value: string): () => void {
  const own: PropertyDescriptor | undefined = Object.getOwnPropertyDescriptor(
    window,
    "origin",
  );

  Object.defineProperty(window, "origin", {
    value: value,
    configurable: true,
    writable: true,
  });

  return (): void => {
    if (own) {
      Object.defineProperty(window, "origin", own);
    } else {
      delete windowRecord["origin"];
    }
  };
}

beforeEach((): void => {
  savedFetch = windowRecord["fetch"];
  clearDebugRecords();
});

afterEach((): void => {
  if (recorder) {
    recorder.stop(window);
    recorder = null;
  }

  windowRecord["fetch"] = savedFetch;
  jest.restoreAllMocks();
});

describe("same-origin fetch", (): void => {
  it("adds a minted traceparent and a tracestate naming the session and the minted parent", async (): Promise<void> => {
    const mock: FetchMock = installFetch();

    startRecorder();

    await window.fetch("/api/cart");

    const headers: Headers = sentHeaders(mock);
    const traceparent: string = headers.get("traceparent") || "";
    const match: RegExpExecArray | null = TRACEPARENT_SHAPE.exec(traceparent);

    expect(match).not.toBeNull();

    /* The exact member: sid, then p = the parent id in OUR traceparent. */
    expect(headers.get("tracestate")).toBe(
      `oneuptime=sid:${SESSION_ID};p:${match?.[2]}`,
    );

    expect(sessionMember(headers.get("tracestate")).sessionTraceState).toEqual({
      sessionId: SESSION_ID,
      syntheticParentSpanId: match?.[2],
    });
  });

  it("pins the sampled flag: a minted traceparent always ends in -01", async (): Promise<void> => {
    const mock: FetchMock = installFetch();

    startRecorder();

    for (let i: number = 0; i < 5; i++) {
      await window.fetch(`/api/${i}`);
      expect(sentHeaders(mock, i).get("traceparent")).toMatch(/-01$/);
    }
  });

  it("merges into every HeadersInit shape without losing the page's headers", async (): Promise<void> => {
    const shapes: Array<() => HeadersInit> = [
      (): HeadersInit => {
        return { authorization: "Bearer t", "x-a": "1" };
      },
      (): HeadersInit => {
        return new Headers({ authorization: "Bearer t", "x-a": "1" });
      },
      (): HeadersInit => {
        return [
          ["authorization", "Bearer t"],
          ["x-a", "1"],
        ];
      },
      (): HeadersInit => {
        return new Map([
          ["authorization", "Bearer t"],
          ["x-a", "1"],
        ]) as unknown as HeadersInit;
      },
    ];

    for (const shape of shapes) {
      const mock: FetchMock = installFetch();
      const callerHeaders: HeadersInit = shape();
      const callerInit: RequestInit = {
        method: "POST",
        body: "{}",
        headers: callerHeaders,
      };

      startRecorder();

      await window.fetch("/api/orders", callerInit);

      const sent: RequestInit = mock.mock.calls[0]?.[1] as RequestInit;
      const headers: Headers = sentHeaders(mock);

      expect(headers.get("authorization")).toBe("Bearer t");
      expect(headers.get("x-a")).toBe("1");
      expect(headers.get("traceparent")).toMatch(TRACEPARENT_SHAPE);
      expect(
        sessionMember(headers.get("tracestate")).sessionTraceState?.sessionId,
      ).toBe(SESSION_ID);

      /* The rest of the init survives, and the caller's is a different object. */
      expect(sent.method).toBe("POST");
      expect(sent.body).toBe("{}");
      expect(sent).not.toBe(callerInit);
      expect(callerInit.headers).toBe(callerHeaders);
      expect(new Headers(callerHeaders).get("tracestate")).toBeNull();
      expect(new Headers(callerHeaders).get("traceparent")).toBeNull();

      recorder?.stop(window);
      recorder = null;
    }
  });

  it("keeps a plain-object shape for a plain object and for no headers at all", async (): Promise<void> => {
    const mock: FetchMock = installFetch();

    startRecorder();

    await window.fetch("/api/a");
    await window.fetch("/api/b", { method: "PUT" });
    await window.fetch("/api/c", { headers: { "x-a": "1" } });

    for (let call: number = 0; call < 3; call++) {
      const sent: RequestInit = mock.mock.calls[call]?.[1] as RequestInit;

      expect(Object.getPrototypeOf(sent.headers)).toBe(Object.prototype);
      expect((sent.headers as Record<string, string>)["traceparent"]).toMatch(
        TRACEPARENT_SHAPE,
      );
      expect((sent.headers as Record<string, string>)["tracestate"]).toContain(
        `oneuptime=sid:${SESSION_ID}`,
      );
    }

    expect((mock.mock.calls[1]?.[1] as RequestInit).method).toBe("PUT");
  });

  it("treats fetch(url, null) like no init", async (): Promise<void> => {
    const mock: FetchMock = installFetch();

    startRecorder();

    await window.fetch("/api/a", null as unknown as RequestInit);

    expect(sentHeaders(mock).get("traceparent")).toMatch(TRACEPARENT_SHAPE);
  });

  it("covers absolute, relative and URL-object inputs on the page's origin", async (): Promise<void> => {
    const mock: FetchMock = installFetch();

    startRecorder();

    await window.fetch(`${PAGE_ORIGIN}/api/a`);
    await window.fetch("api/relative-to-the-page");
    await window.fetch(new URL(`${PAGE_ORIGIN}/api/url-object`));
    await window.fetch("HTTPS://SHOP.EXAMPLE.COM/api/case");

    for (let call: number = 0; call < 4; call++) {
      expect(sentHeaders(mock, call).get("tracestate")).toContain(SESSION_ID);
    }

    /* A URL object goes out as the same URL object. */
    expect(mock.mock.calls[2]?.[0]).toBeInstanceOf(URL);
  });

  it("does not treat another port, scheme or subdomain as the same origin", async (): Promise<void> => {
    const mock: FetchMock = installFetch();

    startRecorder();

    await window.fetch("https://shop.example.com:8443/api");
    await window.fetch("http://shop.example.com/api");
    await window.fetch("https://api.shop.example.com/api");
    await window.fetch("https://example.com/api");

    for (let call: number = 0; call < 4; call++) {
      expect(mock.mock.calls[call]?.[1]).toBeUndefined();
    }
  });

  /*
   * fetch resolves a relative URL against the DOCUMENT BASE URL. A
   * <base href> on another origin makes "/api/x" a cross-origin request,
   * and a header there is a preflight the API never agreed to.
   */
  it("resolves relative URLs against <base href>: a cross-origin base gets nothing", async (): Promise<void> => {
    const base: HTMLBaseElement = document.createElement("base");

    base.href = "https://cdn.other.example/";
    document.head.appendChild(base);

    try {
      const mock: FetchMock = installFetch();

      startRecorder();

      await window.fetch("/api/cart");

      expect(mock.mock.calls[0]?.[1]).toBeUndefined();
      expect(completed[0]?.request.traceId).toBeUndefined();
    } finally {
      base.remove();
    }
  });

  it("resolves relative URLs against <base href>: a same-origin base still counts", async (): Promise<void> => {
    const base: HTMLBaseElement = document.createElement("base");

    base.href = `${PAGE_ORIGIN}/app/v2/`;
    document.head.appendChild(base);

    try {
      const mock: FetchMock = installFetch();

      startRecorder();

      await window.fetch("api/cart");

      expect(sentHeaders(mock).get("tracestate")).toContain(SESSION_ID);
    } finally {
      base.remove();
    }
  });

  it("adds nothing to an unlisted cross-origin request", async (): Promise<void> => {
    const mock: FetchMock = installFetch();

    startRecorder();

    await window.fetch("https://api.other.example/x");
    await window.fetch("https://api.other.example/y", {
      headers: { "x-a": "1" },
    });

    expect(mock.mock.calls[0]?.[1]).toBeUndefined();
    expect(mock.mock.calls[1]?.[1]).toEqual({ headers: { "x-a": "1" } });

    /* Recorded, just not annotated. */
    expect(completed).toHaveLength(2);
    expect(completed[0]?.rollupTraceId).toBeNull();
  });

  it("never adds headers to the recorder's own requests, even when they are same-origin", async (): Promise<void> => {
    const mock: FetchMock = installFetch();

    /* Self-hosted OneUptime served from the page's own origin. */
    startRecorder({
      isSelfRequest: (url: string): boolean => {
        return url.indexOf(`${PAGE_ORIGIN}/telemetry`) === 0;
      },
    });

    await window.fetch(`${PAGE_ORIGIN}/telemetry/session-replay/v1/chunk`, {
      method: "POST",
      keepalive: true,
    });

    expect(mock.mock.calls[0]?.[1]).toEqual({
      method: "POST",
      keepalive: true,
    });
    expect(completed).toHaveLength(0);
  });

  it("skips a no-cors request, whose extra headers the browser would drop", async (): Promise<void> => {
    const mock: FetchMock = installFetch();
    const init: RequestInit = { mode: "no-cors" };

    startRecorder({ origins: ["https://api.allowed.example"] });

    await window.fetch("/api/pixel", init);
    await window.fetch("https://api.allowed.example/pixel", init);

    expect(mock.mock.calls[0]?.[1]).toBe(init);
    expect(mock.mock.calls[1]?.[1]).toBe(init);
    expect(completed[0]?.request.traceId).toBeUndefined();
    expect(completed[1]?.request.traceId).toBeUndefined();
  });
});

describe("safety of the page's arguments", (): void => {
  /*
   * `{ ...init }` copies OWN enumerable properties. A Request or class
   * instance passed as init keeps method/body/headers behind prototype
   * getters, so its copy is `{}` - and the page's POST goes out as a bare
   * GET. Such an init is sent exactly as the page built it.
   */
  it("sends a non-plain init untouched: a class instance with getters", async (): Promise<void> => {
    class InitWithGetters {
      public get method(): string {
        return "POST";
      }

      public get body(): string {
        return "payload";
      }
    }

    const mock: FetchMock = installFetch();
    const init: RequestInit = new InitWithGetters() as unknown as RequestInit;

    startRecorder();

    await window.fetch("/api/orders", init);

    expect(mock.mock.calls[0]?.[1]).toBe(init);
    expect(completed[0]?.request.method).toBe("POST");
  });

  it("sends a non-plain init untouched: a Request passed as init", async (): Promise<void> => {
    const mock: FetchMock = installFetch();
    const init: RequestInit = new FakeRequest(`${PAGE_ORIGIN}/api/x`, {
      method: "POST",
      body: "payload",
    }) as unknown as RequestInit;

    startRecorder();

    await window.fetch("/api/orders", init);

    expect(mock.mock.calls[0]?.[1]).toBe(init);
  });

  it("accepts a plain object from another realm, and a null-prototype one", async (): Promise<void> => {
    const vm: {
      runInNewContext: (code: string) => unknown;
    } = require("vm") as { runInNewContext: (code: string) => unknown };

    /* A real other realm: its Object.prototype is not ours. */
    const foreign: RequestInit = vm.runInNewContext(
      '({ method: "PUT", body: "{}", headers: { "x-a": "1" } })',
    ) as RequestInit;

    expect(Object.getPrototypeOf(foreign)).not.toBe(Object.prototype);

    const bare: RequestInit = Object.assign(Object.create(null), {
      method: "PATCH",
      body: "{}",
    }) as RequestInit;

    for (const init of [foreign, bare]) {
      const mock: FetchMock = installFetch();

      startRecorder();

      await window.fetch("/api/orders", init);

      const sent: RequestInit = mock.mock.calls[0]?.[1] as RequestInit;

      expect(sent).not.toBe(init);
      expect(sent.method).toBe(init.method);
      expect(sent.body).toBe("{}");
      expect(sentHeaders(mock).get("tracestate")).toContain(SESSION_ID);

      recorder?.stop(window);
      recorder = null;
    }

    expect(new Headers(foreign.headers).get("traceparent")).toBeNull();
  });

  /*
   * Object.create(defaults), where defaults has a null prototype: the
   * prototype's prototype is null, as it is for another realm's plain
   * object, but method and body are INHERITED - the spread copy would lose
   * them and turn the page's POST into a bare GET.
   */
  it("sends an init that inherits its fields from a null-prototype object untouched", async (): Promise<void> => {
    const defaults: Record<string, unknown> = Object.assign(
      Object.create(null),
      { method: "POST", body: "payload" },
    ) as Record<string, unknown>;
    const init: RequestInit = Object.create(defaults) as RequestInit;

    /* Not quite Object.prototype either: a null prototype, no hasOwnProperty. */
    const lookalike: Record<string, unknown> = Object.create(null) as Record<
      string,
      unknown
    >;

    lookalike["method"] = "DELETE";

    const inheriting: RequestInit = Object.create(lookalike) as RequestInit;

    for (const pageInit of [init, inheriting]) {
      const mock: FetchMock = installFetch();

      startRecorder();

      await window.fetch("/api/orders", pageInit);

      expect(mock.mock.calls[0]?.[1]).toBe(pageInit);
      expect(completed[0]?.request.method).toBe(pageInit.method);

      recorder?.stop(window);
      recorder = null;
    }

    expect(init.method).toBe("POST");
    expect(init.body).toBe("payload");
  });

  /*
   * A generator or map.entries() can be iterated ONCE. Reading it to look
   * for a traceparent used to consume it, so fetch then sent none of the
   * page's headers at all. It is now never touched - on the same-origin
   * path, on a listed origin, and with propagation off - and the page's
   * own init object goes out as it was.
   */
  it("never iterates one-shot iterator headers, on any path, and they still reach fetch", async (): Promise<void> => {
    const oneShotShapes: Array<() => HeadersInit> = [
      (): HeadersInit => {
        function* pairs(): Generator<[string, string]> {
          yield ["authorization", "Bearer t"];
          yield ["x-a", "1"];
        }

        return pairs() as unknown as HeadersInit;
      },
      (): HeadersInit => {
        return new Map([
          ["authorization", "Bearer t"],
          ["x-a", "1"],
        ]).entries() as unknown as HeadersInit;
      },
    ];

    const paths: Array<{ url: string; options: RecorderOptions }> = [
      { url: "/api/same-origin", options: {} },
      {
        url: "https://api.allowed.example/x",
        options: { origins: ["https://api.allowed.example"] },
      },
      { url: "/api/policy-off", options: { policy: false } },
    ];

    for (const path of paths) {
      for (const shape of oneShotShapes) {
        let delivered: Headers | null = null;

        windowRecord["fetch"] = jest.fn(
          (_input: unknown, init?: RequestInit): Promise<Response> => {
            /* What a native fetch would read: the whole iterator, once. */
            delivered = new Headers(init?.headers);
            return Promise.resolve(okResponse());
          },
        );

        const init: RequestInit = { headers: shape() };

        startRecorder(path.options);

        await window.fetch(path.url, init);

        const seen: Headers = delivered as unknown as Headers;

        expect(seen.get("authorization")).toBe("Bearer t");
        expect(seen.get("x-a")).toBe("1");
        expect(seen.get("traceparent")).toBeNull();
        expect(seen.get("tracestate")).toBeNull();
        expect(completed[0]?.request.traceId).toBeUndefined();

        recorder?.stop(window);
        recorder = null;
      }
    }
  });

  it("never mutates the caller's init or headers", async (): Promise<void> => {
    installFetch();

    const headers: Headers = new Headers({ "x-a": "1" });
    const record: Record<string, string> = { "x-b": "2" };
    const array: Array<[string, string]> = [["x-c", "3"]];

    startRecorder();

    const inits: Array<RequestInit> = [
      { headers: headers },
      { headers: record },
      { headers: array },
    ];

    for (const init of inits) {
      await window.fetch("/api/x", init);
    }

    expect(inits[0]?.headers).toBe(headers);
    expect(Array.from(headers.keys())).toEqual(["x-a"]);
    expect(record).toEqual({ "x-b": "2" });
    expect(array).toEqual([["x-c", "3"]]);
  });

  it("falls back to the page's own arguments when annotating throws", async (): Promise<void> => {
    const mock: FetchMock = installFetch();
    const init: RequestInit = {};

    /* A headers getter that throws once it is being annotated. */
    let reads: number = 0;

    Object.defineProperty(init, "headers", {
      enumerable: true,
      get: (): HeadersInit => {
        reads++;

        if (reads > 1) {
          throw new Error("hostile getter");
        }

        return { "x-a": "1" };
      },
    });

    startRecorder();

    await expect(window.fetch("/api/x", init)).resolves.toBeDefined();

    expect(mock.mock.calls[0]?.[1]).toBe(init);
    expect(completed).toHaveLength(1);
  });
});

describe("headers the page already set", (): void => {
  it("never overwrites or duplicates a page-set traceparent, in any shape; tracestate is added without p", async (): Promise<void> => {
    const shapes: Array<() => HeadersInit> = [
      (): HeadersInit => {
        return { TraceParent: PAGE_TRACEPARENT };
      },
      (): HeadersInit => {
        return new Headers({ traceparent: PAGE_TRACEPARENT });
      },
      (): HeadersInit => {
        return [["traceparent", PAGE_TRACEPARENT]];
      },
      (): HeadersInit => {
        return new Map([
          ["traceparent", PAGE_TRACEPARENT],
        ]) as unknown as HeadersInit;
      },
    ];

    for (const shape of shapes) {
      const mock: FetchMock = installFetch();

      startRecorder();

      await window.fetch("/api/x", { headers: shape() });

      const headers: Headers = sentHeaders(mock);

      /* Exactly one value, the page's. */
      expect(headers.get("traceparent")).toBe(PAGE_TRACEPARENT);

      /* The session still rides along, but with no synthetic parent. */
      expect(headers.get("tracestate")).toBe(`oneuptime=sid:${SESSION_ID}`);

      /* The page's id is reported, and it is a rollup id like any other. */
      expect(completed[0]?.request.traceId).toBe(PAGE_TRACE_ID);
      expect(completed[0]?.rollupTraceId).toBe(PAGE_TRACE_ID);

      recorder?.stop(window);
      recorder = null;
    }
  });

  it("stands down for an unparseable page traceparent too", async (): Promise<void> => {
    const mock: FetchMock = installFetch();

    startRecorder();

    await window.fetch("/api/x", { headers: { traceparent: "not-w3c" } });

    expect(sentHeaders(mock).get("traceparent")).toBe("not-w3c");
    expect(completed[0]?.request.traceId).toBeUndefined();
  });

  it("never touches a page-set tracestate, in any shape; traceparent is still minted", async (): Promise<void> => {
    const shapes: Array<() => HeadersInit> = [
      (): HeadersInit => {
        return { TraceState: PAGE_TRACESTATE };
      },
      (): HeadersInit => {
        return new Headers({ tracestate: PAGE_TRACESTATE });
      },
      (): HeadersInit => {
        return [["tracestate", PAGE_TRACESTATE]];
      },
      (): HeadersInit => {
        return new Map([
          ["tracestate", PAGE_TRACESTATE],
        ]) as unknown as HeadersInit;
      },
    ];

    for (const shape of shapes) {
      const mock: FetchMock = installFetch();

      startRecorder();

      await window.fetch("/api/x", { headers: shape() });

      const headers: Headers = sentHeaders(mock);

      expect(headers.get("tracestate")).toBe(PAGE_TRACESTATE);
      expect(headers.get("traceparent")).toMatch(TRACEPARENT_SHAPE);

      recorder?.stop(window);
      recorder = null;
    }
  });

  it("adds nothing when the page set both", async (): Promise<void> => {
    const mock: FetchMock = installFetch();
    const init: RequestInit = {
      headers: { traceparent: PAGE_TRACEPARENT, tracestate: PAGE_TRACESTATE },
    };

    startRecorder();

    await window.fetch("/api/x", init);

    /* Not even rebuilt. */
    expect(mock.mock.calls[0]?.[1]).toBe(init);
    expect(completed[0]?.rollupTraceId).toBe(PAGE_TRACE_ID);
  });
});

describe("Request inputs", (): void => {
  beforeEach((): void => {
    windowRecord["Request"] = FakeRequest;
  });

  afterEach((): void => {
    delete windowRecord["Request"];
  });

  it("rebuilds a same-origin Request with the page's headers, method and body plus ours", async (): Promise<void> => {
    const mock: FetchMock = installFetch();
    const request: FakeRequest = new FakeRequest(`${PAGE_ORIGIN}/api/orders`, {
      method: "POST",
      body: "payload",
      headers: { authorization: "Bearer t" },
    });

    startRecorder();

    await window.fetch(request as unknown as RequestInfo);

    const sent: FakeRequest = mock.mock.calls[0]?.[0] as FakeRequest;

    expect(sent).toBeInstanceOf(FakeRequest);
    expect(sent).not.toBe(request);

    /* No second argument: init.headers would have REPLACED the Request's. */
    expect(mock.mock.calls[0]).toHaveLength(1);

    expect(sent.method).toBe("POST");
    expect(sent.body).toBe("payload");
    expect(sent.url).toBe(`${PAGE_ORIGIN}/api/orders`);
    expect(sent.headers.get("authorization")).toBe("Bearer t");
    expect(sent.headers.get("traceparent")).toMatch(TRACEPARENT_SHAPE);
    expect(sent.headers.get("tracestate")).toContain(`sid:${SESSION_ID};p:`);

    /* The page's own Request is not modified. */
    expect(request.headers.get("traceparent")).toBeNull();
    expect(request.headers.get("tracestate")).toBeNull();
  });

  /*
   * new Request(request, { headers }) is a non-empty init, which resets the
   * copy's referrer to the client and its policy to the document default:
   * a page's no-referrer became the full page URL as Referer, and its own
   * same-origin referrer became the document URL. Both are carried through.
   */
  it("keeps the page Request's referrer and referrerPolicy through the rebuild", async (): Promise<void> => {
    const choices: Array<FakeRequestInit> = [
      { referrerPolicy: "no-referrer" },
      { referrer: "" },
      { referrer: "", referrerPolicy: "unsafe-url" },
      { referrer: `${PAGE_ORIGIN}/landing`, referrerPolicy: "same-origin" },
      { referrerPolicy: "strict-origin" },
      {},
    ];

    for (const choice of choices) {
      const mock: FetchMock = installFetch();
      const request: FakeRequest = new FakeRequest("/api/redeem", choice);

      startRecorder();

      await window.fetch(request as unknown as RequestInfo);

      const sent: FakeRequest = mock.mock.calls[0]?.[0] as FakeRequest;

      /* Rebuilt - it carries ours - and nothing else about it changed. */
      expect(sent).not.toBe(request);
      expect(sent.headers.get("tracestate")).toContain(SESSION_ID);
      expect([sent.referrer, sent.referrerPolicy]).toEqual([
        request.referrer,
        request.referrerPolicy,
      ]);

      recorder?.stop(window);
      recorder = null;
    }
  });

  it("keeps a Request's own traceparent and adds only the tracestate", async (): Promise<void> => {
    const mock: FetchMock = installFetch();
    const request: FakeRequest = new FakeRequest("/api/x", {
      headers: { traceparent: PAGE_TRACEPARENT },
    });

    startRecorder();

    await window.fetch(request as unknown as RequestInfo);

    const sent: FakeRequest = mock.mock.calls[0]?.[0] as FakeRequest;

    expect(sent.headers.get("traceparent")).toBe(PAGE_TRACEPARENT);
    expect(sent.headers.get("tracestate")).toBe(`oneuptime=sid:${SESSION_ID}`);
    expect(completed[0]?.rollupTraceId).toBe(PAGE_TRACE_ID);
  });

  it("sends a Request untouched when it cannot be rebuilt (a used body)", async (): Promise<void> => {
    const mock: FetchMock = installFetch();
    const request: FakeRequest = new FakeRequest("/api/x", {
      method: "POST",
      body: "payload",
    });

    request.bodyUsed = true;

    startRecorder();

    await window.fetch(request as unknown as RequestInfo);

    expect(mock.mock.calls[0]?.[0]).toBe(request);
    expect(mock.mock.calls[0]).toHaveLength(1);
  });

  it("sends a Request untouched when it has an init beside it, is no-cors, or is cross-origin", async (): Promise<void> => {
    const mock: FetchMock = installFetch();
    const withInit: FakeRequest = new FakeRequest("/api/a");
    const init: RequestInit = { method: "GET" };
    const noCors: FakeRequest = new FakeRequest("/api/b", { mode: "no-cors" });
    const listed: FakeRequest = new FakeRequest(
      "https://api.allowed.example/c",
    );

    startRecorder({ origins: ["https://api.allowed.example"] });

    await window.fetch(withInit as unknown as RequestInfo, init);
    await window.fetch(noCors as unknown as RequestInfo);
    await window.fetch(listed as unknown as RequestInfo);

    expect(mock.mock.calls[0]?.[0]).toBe(withInit);
    expect(mock.mock.calls[0]?.[1]).toBe(init);
    expect(mock.mock.calls[1]?.[0]).toBe(noCors);

    /* Listed origins keep the older rule: a Request is never annotated. */
    expect(mock.mock.calls[2]?.[0]).toBe(listed);
    expect(listed.headers.get("traceparent")).toBeNull();
  });

  it("does not rebuild a Request-shaped object from another realm", async (): Promise<void> => {
    const mock: FetchMock = installFetch();
    const foreign: RequestInfo = {
      url: `${PAGE_ORIGIN}/api/x`,
      method: "GET",
      headers: new Headers(),
    } as unknown as RequestInfo;

    startRecorder();

    await window.fetch(foreign);

    expect(mock.mock.calls[0]?.[0]).toBe(foreign);
  });
});

describe("listed cross-origin APIs", (): void => {
  it("get a traceparent only - never the tracestate - whether or not a session id is available", async (): Promise<void> => {
    for (const sessionId of [SESSION_ID, null]) {
      const mock: FetchMock = installFetch();

      startRecorder({
        origins: ["https://api.allowed.example"],
        sessionId: (): string | null => {
          return sessionId;
        },
      });

      await window.fetch("https://api.allowed.example/orders");

      const headers: Headers = sentHeaders(mock);

      expect(headers.get("traceparent")).toMatch(TRACEPARENT_SHAPE);
      expect(headers.get("tracestate")).toBeNull();

      /* Minted for a listed origin: in the rollup, exactly as before. */
      const traceId: string | undefined = TRACEPARENT_SHAPE.exec(
        headers.get("traceparent") || "",
      )?.[1];

      expect(completed[0]?.rollupTraceId).toBe(traceId);

      recorder?.stop(window);
      recorder = null;
    }
  });

  it("are unchanged with the policy off", async (): Promise<void> => {
    const mock: FetchMock = installFetch();

    startRecorder({
      origins: ["https://api.allowed.example"],
      policy: false,
    });

    await window.fetch("https://api.allowed.example/orders");

    expect(sentHeaders(mock).get("traceparent")).toMatch(TRACEPARENT_SHAPE);
    expect(sentHeaders(mock).get("tracestate")).toBeNull();
  });

  it("still mint whatever other tracer is on the page", async (): Promise<void> => {
    const mock: FetchMock = installFetch();

    /* Configured to trace: the same-origin path would stand down for it. */
    windowRecord["NREUM"] = {
      init: { distributed_tracing: { enabled: true } },
    };

    try {
      startRecorder({ origins: ["https://api.allowed.example"] });

      await window.fetch("https://api.allowed.example/orders");

      expect(sentHeaders(mock).get("traceparent")).toMatch(TRACEPARENT_SHAPE);
    } finally {
      delete windowRecord["NREUM"];
    }
  });

  it("the page's own origin, when listed, gets the same-origin set while it is available and traceparent only otherwise", async (): Promise<void> => {
    let sessionId: string | null = SESSION_ID;
    const mock: FetchMock = installFetch();

    startRecorder({
      origins: [PAGE_ORIGIN],
      sessionId: (): string | null => {
        return sessionId;
      },
    });

    await window.fetch("/api/a");

    sessionId = null;

    await window.fetch("/api/b");

    expect(sentHeaders(mock, 0).get("tracestate")).toContain(SESSION_ID);
    expect(sentHeaders(mock, 1).get("traceparent")).toMatch(TRACEPARENT_SHAPE);
    expect(sentHeaders(mock, 1).get("tracestate")).toBeNull();
  });
});

/*
 * A page that proxies its browser OpenTelemetry exporter through its own
 * origin posts to .../v1/traces, /v1/logs and /v1/metrics every few
 * seconds. Annotated, each export became a forced-sampled backend trace
 * stamped with the session - the replay's Traces tab filled with the
 * telemetry pipeline's own traffic.
 */
describe("OpenTelemetry export paths on the page's own origin", (): void => {
  it("get nothing added to a POST, and the page's init goes out as it was", async (): Promise<void> => {
    const paths: Array<string> = [
      "/v1/traces",
      "/api/otel/v1/traces",
      "/otlp/v1/logs",
      `${PAGE_ORIGIN}/telemetry/v1/metrics`,
      "/api/otel/v1/traces/",
      "/api/otel/v1/traces?batch=1",
    ];

    for (const path of paths) {
      const mock: FetchMock = installFetch();
      const init: RequestInit = { method: "POST", body: "{}" };

      startRecorder();

      await window.fetch(path, init);

      expect([path, mock.mock.calls[0]?.[1]]).toEqual([path, init]);
      expect(mock.mock.calls[0]?.[1]).toBe(init);
      expect(sentHeaders(mock).get("traceparent")).toBeNull();
      expect(sentHeaders(mock).get("tracestate")).toBeNull();

      recorder?.stop(window);
      recorder = null;
    }
  });

  /*
   * An OTLP/HTTP export is always a POST. The same path read with any
   * other method is the app's own endpoint - an audit-log page's
   * GET /api/v1/logs, an analytics dashboard's GET /api/v1/metrics - and
   * its backend spans link like any other request's.
   */
  it("annotates any other method on those paths: the app's own endpoints", async (): Promise<void> => {
    const requests: Array<[string, RequestInit | undefined]> = [
      ["/api/v1/logs", undefined],
      ["/api/v1/metrics", { method: "GET" }],
      ["/v1/traces", { method: "HEAD" }],
      ["/api/v1/logs", { method: "DELETE" }],
      ["/api/v1/traces", { method: "PUT", body: "{}" }],
    ];

    for (const [path, init] of requests) {
      const mock: FetchMock = installFetch();

      startRecorder();

      await window.fetch(path, init);

      const traceparent: string | null = sentHeaders(mock).get("traceparent");

      expect([path, init?.method, traceparent]).toEqual([
        path,
        init?.method,
        expect.stringMatching(TRACEPARENT_SHAPE),
      ]);
      expect(sentHeaders(mock).get("tracestate")).toContain(SESSION_ID);

      recorder?.stop(window);
      recorder = null;
    }
  });

  it("skips a POST however the method is spelled or carried", async (): Promise<void> => {
    const stopRecorder: () => void = (): void => {
      recorder?.stop(window);
      recorder = null;
    };

    windowRecord["Request"] = FakeRequest;

    try {
      const lowercase: FetchMock = installFetch();

      startRecorder();

      await window.fetch("/otel/v1/traces", { method: "post", body: "{}" });

      expect(sentHeaders(lowercase).get("traceparent")).toBeNull();
      expect(sentHeaders(lowercase).get("tracestate")).toBeNull();

      stopRecorder();

      /* A POST Request: sent as the page built it, not rebuilt. */
      const request: FetchMock = installFetch();
      const exported: FakeRequest = new FakeRequest("/otel/v1/traces", {
        method: "POST",
        body: "{}",
      });

      startRecorder();

      await window.fetch(exported as unknown as Request);

      expect(request.mock.calls[0]?.[0]).toBe(exported);
      expect(sentHeaders(request).get("traceparent")).toBeNull();
      expect(sentHeaders(request).get("tracestate")).toBeNull();

      stopRecorder();

      /* A GET Request to the same path is the app's own read: annotated. */
      const read: FetchMock = installFetch();

      startRecorder();

      await window.fetch(new FakeRequest("/api/v1/logs") as unknown as Request);

      expect(sentHeaders(read).get("traceparent")).toMatch(TRACEPARENT_SHAPE);
      expect(sentHeaders(read).get("tracestate")).toContain(SESSION_ID);
    } finally {
      delete windowRecord["Request"];
    }
  });

  it("does not match paths that only look alike", async (): Promise<void> => {
    for (const path of [
      "/api/v1/tracesx",
      "/api/v1/traces/123",
      "/v2/traces",
      "/api/v1/log",
    ]) {
      const mock: FetchMock = installFetch();

      startRecorder();

      await window.fetch(path);

      expect([path, sentHeaders(mock).get("tracestate")]).toEqual([
        path,
        expect.stringContaining(SESSION_ID),
      ]);

      recorder?.stop(window);
      recorder = null;
    }
  });

  it("keeps the listed treatment when the page listed its own origin", async (): Promise<void> => {
    const mock: FetchMock = installFetch();

    startRecorder({ origins: [PAGE_ORIGIN] });

    await window.fetch("/api/otel/v1/traces", { method: "POST", body: "{}" });

    expect(sentHeaders(mock).get("traceparent")).toMatch(TRACEPARENT_SHAPE);
    expect(sentHeaders(mock).get("tracestate")).toBeNull();
  });
});

describe("the session predicate and the policy", (): void => {
  it("adds nothing at all - not even a traceparent - while the recorder hands out no session id", async (): Promise<void> => {
    const mock: FetchMock = installFetch();

    startRecorder({
      sessionId: (): string | null => {
        return null;
      },
    });

    await window.fetch("/api/x");

    expect(mock.mock.calls[0]?.[1]).toBeUndefined();
  });

  it("reads the predicate at request time", async (): Promise<void> => {
    let sessionId: string | null = null;
    const mock: FetchMock = installFetch();

    startRecorder({
      sessionId: (): string | null => {
        return sessionId;
      },
    });

    await window.fetch("/api/before");

    sessionId = SESSION_ID;

    await window.fetch("/api/during");

    sessionId = "f".repeat(32);

    await window.fetch("/api/rotated");

    sessionId = null;

    await window.fetch("/api/after");

    expect(mock.mock.calls[0]?.[1]).toBeUndefined();
    expect(sentHeaders(mock, 1).get("tracestate")).toContain(SESSION_ID);
    expect(sentHeaders(mock, 2).get("tracestate")).toContain("f".repeat(32));
    expect(mock.mock.calls[3]?.[1]).toBeUndefined();
  });

  it("refuses a session id that is not 32 lowercase hex characters", async (): Promise<void> => {
    for (const hostile of [
      "abc",
      `${"a".repeat(31)},evil=1`,
      "A".repeat(32),
      "a".repeat(33),
      "",
    ]) {
      const mock: FetchMock = installFetch();

      startRecorder({
        sessionId: (): string | null => {
          return hostile;
        },
      });

      await window.fetch("/api/x");

      expect(mock.mock.calls[0]?.[1]).toBeUndefined();

      recorder?.stop(window);
      recorder = null;
    }
  });

  /* Built without the policy field at all when policy is undefined. */
  const recorderWithPolicy: (policy: boolean | undefined) => NetworkRecorder = (
    policy: boolean | undefined,
  ): NetworkRecorder => {
    completed = [];

    return new NetworkRecorder({
      emitCustomEvent: (): void => {},
      onRequestComplete: (
        _atUnixMs: number,
        request: RecordedRequest,
        traceId: string | null,
      ): void => {
        completed.push({ request: request, rollupTraceId: traceId });
      },
      onActivity: (): void => {},
      scrubUrl: (url: string): string => {
        return url;
      },
      isSelfRequest: (): boolean => {
        return false;
      },
      getSessionIdForPropagation: (): string | null => {
        return SESSION_ID;
      },
      ...(policy === undefined ? {} : { sameOriginTracePropagation: policy }),
    });
  };

  it("adds nothing new with the policy off or absent", async (): Promise<void> => {
    for (const policy of [false, undefined]) {
      const mock: FetchMock = installFetch();

      recorder = recorderWithPolicy(policy);
      recorder.start(window);

      await window.fetch("/api/x");

      expect(mock.mock.calls[0]?.[1]).toBeUndefined();
      expect(completed).toHaveLength(1);

      recorder.stop(window);
      recorder = null;
    }
  });

  it("adds nothing once stopped, even through a wrapper that outlived stop()", async (): Promise<void> => {
    const mock: FetchMock = installFetch();

    startRecorder();

    /* The page patched fetch after us, so stop() leaves our wrapper in place. */
    const ours: typeof window.fetch = window.fetch;

    windowRecord["fetch"] = (
      input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> => {
      return ours(input, init);
    };

    recorder?.stop(window);
    recorder = null;

    await window.fetch("/api/x");

    expect(mock.mock.calls[0]?.[1]).toBeUndefined();
  });
});

describe("the page's origin", (): void => {
  it('is off for a sandboxed document: window.origin is "null" while location.origin names the site', async (): Promise<void> => {
    const restore: () => void = defineWindowOrigin("null");

    try {
      const mock: FetchMock = installFetch();

      startRecorder();

      await window.fetch("/api/x");

      expect(mock.mock.calls[0]?.[1]).toBeUndefined();

      const records: Array<DebugRecord> = debugRecords(
        "same-origin-propagation",
      );

      expect(records).toHaveLength(1);
      expect(records[0]?.detail).toEqual({
        enabled: false,
        reason: "opaque-origin",
      });
    } finally {
      restore();
    }
  });

  it("is off when window.origin disagrees with location.origin", async (): Promise<void> => {
    const restore: () => void = defineWindowOrigin("https://elsewhere.example");

    try {
      const mock: FetchMock = installFetch();

      startRecorder();

      await window.fetch("/api/x");

      expect(mock.mock.calls[0]?.[1]).toBeUndefined();
    } finally {
      restore();
    }
  });

  it("is on when the platform has no window.origin to compare with", async (): Promise<void> => {
    const mock: FetchMock = jest.fn().mockResolvedValue(okResponse());
    const legacyWindow: Window = {
      location: {
        origin: PAGE_ORIGIN,
        href: `${PAGE_ORIGIN}/checkout`,
      },
      document: { baseURI: `${PAGE_ORIGIN}/checkout` },
      fetch: mock,
    } as unknown as Window;

    recorder = makeRecorder();
    recorder.start(legacyWindow);

    await legacyWindow.fetch("/api/x");

    expect(sentHeaders(mock).get("tracestate")).toContain(SESSION_ID);

    recorder.stop(legacyWindow);
    recorder = null;
  });

  it("is off for about:blank, srcdoc and file: documents", async (): Promise<void> => {
    const documents: Array<{ origin: string; href: string }> = [
      { origin: "null", href: "about:blank" },
      { origin: "null", href: "about:srcdoc" },
      { origin: "file://", href: "file:///home/user/index.html" },
      { origin: "null", href: "file:///home/user/index.html" },
    ];

    for (const page of documents) {
      const mock: FetchMock = jest.fn().mockResolvedValue(okResponse());
      const fakeWindow: Window = {
        location: page,
        document: { baseURI: page.href },
        origin: page.origin,
        fetch: mock,
      } as unknown as Window;

      clearDebugRecords();
      recorder = makeRecorder();
      recorder.start(fakeWindow);

      await fakeWindow.fetch("./data.json");
      await fakeWindow.fetch(`${PAGE_ORIGIN}/api/x`);

      expect(mock.mock.calls[0]?.[1]).toBeUndefined();
      expect(mock.mock.calls[1]?.[1]).toBeUndefined();
      expect(debugRecords("same-origin-propagation")[0]?.detail).toEqual({
        enabled: false,
        reason: "opaque-origin",
      });

      recorder.stop(fakeWindow);
      recorder = null;
    }
  });
});

describe("tracers inside our wrapper", (): void => {
  /* A shimmer-style wrapper: non-enumerable markers, calls through. */
  function markedWrapper(
    inner: (...args: Array<unknown>) => unknown,
    markers: Record<string, unknown>,
  ): (...args: Array<unknown>) => unknown {
    const wrapper: (...args: Array<unknown>) => unknown = function (
      this: unknown,
      ...args: Array<unknown>
    ): unknown {
      return inner.apply(this, args);
    };

    for (const name of Object.keys(markers)) {
      Object.defineProperty(wrapper, name, {
        value: markers[name],
        enumerable: false,
        configurable: true,
      });
    }

    return wrapper;
  }

  const expectStoodDown: (mock: FetchMock) => void = (
    mock: FetchMock,
  ): void => {
    const headers: Headers = sentHeaders(mock);

    expect(headers.get("traceparent")).toBeNull();

    /* The session still rides along - without p, the traceparent is not ours. */
    expect(headers.get("tracestate")).toBe(`oneuptime=sid:${SESSION_ID}`);
    expect(sessionMember(headers.get("tracestate")).sessionTraceState).toEqual({
      sessionId: SESSION_ID,
      syntheticParentSpanId: null,
    });
  };

  it("stands down on traceparent for a `__wrapped` fetch", async (): Promise<void> => {
    const mock: FetchMock = jest.fn().mockResolvedValue(okResponse());

    windowRecord["fetch"] = markedWrapper(mock, { __wrapped: true });

    startRecorder();

    await window.fetch("/api/x");

    expectStoodDown(mock);
  });

  it("finds the marker through __sentry_original__ and __original, a few hops deep", async (): Promise<void> => {
    const mock: FetchMock = jest.fn().mockResolvedValue(okResponse());
    const otel: (...args: Array<unknown>) => unknown = markedWrapper(mock, {
      __wrapped: true,
      __original: mock,
    });
    const middle: (...args: Array<unknown>) => unknown = markedWrapper(otel, {
      __original: otel,
    });
    const sentry: (...args: Array<unknown>) => unknown = markedWrapper(middle, {
      __sentry_original__: middle,
    });

    windowRecord["fetch"] = sentry;

    startRecorder();

    await window.fetch("/api/x");

    expectStoodDown(mock);
  });

  it("bounds the walk: a marker six hops down is not looked for", async (): Promise<void> => {
    const mock: FetchMock = jest.fn().mockResolvedValue(okResponse());
    let chain: (...args: Array<unknown>) => unknown = markedWrapper(mock, {
      __wrapped: true,
    });

    for (let hop: number = 0; hop < 6; hop++) {
      chain = markedWrapper(chain, { __original: chain });
    }

    windowRecord["fetch"] = chain;

    startRecorder();

    await window.fetch("/api/x");

    expect(sentHeaders(mock).get("traceparent")).toMatch(TRACEPARENT_SHAPE);
  });

  /*
   * Vendor agents define their global whether or not they trace, so the
   * recorder stands down for one only while it is configured to put a
   * traceparent on THIS request. Standing down for an agent that adds none
   * sent a tracestate with no traceparent, which no W3C propagator reads:
   * Datadog RUM with its default config or for a session it does not
   * track, New Relic without distributed tracing, an inactive Elastic agent
   * or one with distributedTracing off - none of them ever linked. The
   * fixtures model each agent's real public shape.
   */
  interface AgentCase {
    name: string;
    global: string;
    value: unknown;
    standsDown: boolean;
  }

  /*
   * Datadog RUM 7.x's public API: getInitConfiguration() returns a copy of
   * the init options - readable whether or not Datadog started - and
   * getInternalContext() the context of the session it tracks, undefined
   * before start, before consent, after a failed init, and for a session
   * sessionSampleRate left untracked. Its tracer injects nothing then.
   */
  const DATADOG_CONTEXT: Record<string, unknown> = {
    application_id: "7f2d8a1e-3b4c-4d5e-8f60-718293a4b5c6",
    session_id: "3c5e2c6b-0b1f-4d3a-9f64-1f4e0a7b2c9d",
    view: {
      id: "5a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
      url: `${PAGE_ORIGIN}/checkout`,
      referrer: "",
    },
    user_action: undefined,
  };

  const datadog: (
    config: unknown,
    tracked?: boolean,
  ) => Record<string, unknown> = (
    config: unknown,
    tracked: boolean = true,
  ): Record<string, unknown> => {
    return {
      getInitConfiguration: (): unknown => {
        return config;
      },
      getInternalContext: (): unknown => {
        return tracked ? DATADOG_CONTEXT : undefined;
      },
    };
  };

  /*
   * @elastic/apm-rum 5.x: window.elasticApm is an ApmBase, which has no
   * getConfig. Its configuration is read through its ConfigService, with
   * Elastic's defaults merged in.
   */
  const elastic: (
    active: boolean,
    config?: Record<string, unknown>,
  ) => Record<string, unknown> = (
    active: boolean,
    config: Record<string, unknown> = {},
  ): Record<string, unknown> => {
    const merged: Record<string, unknown> = {
      distributedTracing: true,
      distributedTracingHeaderName: "traceparent",
      ...config,
    };

    return {
      isActive: (): boolean => {
        return active;
      },
      serviceFactory: {
        getService: (name: string): unknown => {
          return name === "ConfigService"
            ? {
                get: (key: string): unknown => {
                  return merged[key];
                },
              }
            : undefined;
        },
      },
    };
  };

  /*
   * @newrelic/browser-agent from npm: NREUM.init stays empty, and each
   * agent instance registers itself, with its merged init, in
   * NREUM.initializedAgents under a 16-character id.
   */
  const newRelicNpm: (...enabled: Array<unknown>) => Record<string, unknown> = (
    ...enabled: Array<unknown>
  ): Record<string, unknown> => {
    const agents: Record<string, unknown> = {};

    enabled.forEach((value: unknown, index: number): void => {
      agents[`a1b2c3d4e5f6071${index}`] = {
        init: { distributed_tracing: { enabled: value } },
      };
    });

    return { init: {}, initializedAgents: agents };
  };

  const agentCases: Array<AgentCase> = [
    /* Datadog RUM: allowedTracingUrls decides, matched Datadog's way. */
    { name: "DD_RUM bare", global: "DD_RUM", value: {}, standsDown: false },
    {
      name: "DD_RUM async stub",
      global: "DD_RUM",
      value: { q: [], onReady: (): void => {} },
      standsDown: false,
    },
    {
      name: "DD_RUM not initialised",
      global: "DD_RUM",
      value: datadog(undefined, false),
      standsDown: false,
    },
    {
      name: "DD_RUM default config",
      global: "DD_RUM",
      value: datadog({ applicationId: "a", clientToken: "t" }),
      standsDown: false,
    },
    {
      name: "DD_RUM empty allowedTracingUrls",
      global: "DD_RUM",
      value: datadog({ allowedTracingUrls: [] }),
      standsDown: false,
    },
    {
      name: "DD_RUM another origin listed",
      global: "DD_RUM",
      value: datadog({ allowedTracingUrls: ["https://api.other.example"] }),
      standsDown: false,
    },
    {
      name: "DD_RUM string prefix",
      global: "DD_RUM",
      value: datadog({ allowedTracingUrls: [`${PAGE_ORIGIN}/api`] }),
      standsDown: true,
    },
    {
      name: "DD_RUM string that is not a prefix",
      global: "DD_RUM",
      value: datadog({ allowedTracingUrls: ["/api"] }),
      standsDown: false,
    },
    {
      name: "DD_RUM RegExp",
      global: "DD_RUM",
      value: datadog({ allowedTracingUrls: [/shop\.example\.com\/api/] }),
      standsDown: true,
    },
    {
      name: "DD_RUM function",
      global: "DD_RUM",
      value: datadog({
        allowedTracingUrls: [
          (url: string): boolean => {
            return url === `${PAGE_ORIGIN}/api/x`;
          },
        ],
      }),
      standsDown: true,
    },
    {
      name: "DD_RUM option without propagatorTypes (the default has tracecontext)",
      global: "DD_RUM",
      value: datadog({ allowedTracingUrls: [{ match: PAGE_ORIGIN }] }),
      standsDown: true,
    },
    {
      name: "DD_RUM option with tracecontext",
      global: "DD_RUM",
      value: datadog({
        allowedTracingUrls: [
          { match: /shop/, propagatorTypes: ["datadog", "tracecontext"] },
        ],
      }),
      standsDown: true,
    },
    {
      name: "DD_RUM option with datadog headers only",
      global: "DD_RUM",
      value: datadog({
        allowedTracingUrls: [
          { match: PAGE_ORIGIN, propagatorTypes: ["datadog", "b3"] },
        ],
      }),
      standsDown: false,
    },
    {
      name: "DD_RUM first matching entry decides",
      global: "DD_RUM",
      value: datadog({
        allowedTracingUrls: [
          { match: PAGE_ORIGIN, propagatorTypes: ["datadog"] },
          PAGE_ORIGIN,
        ],
      }),
      standsDown: false,
    },
    {
      name: "DD_RUM entry that throws is skipped",
      global: "DD_RUM",
      value: datadog({
        allowedTracingUrls: [
          (): boolean => {
            throw new Error("page bug");
          },
          PAGE_ORIGIN,
        ],
      }),
      standsDown: true,
    },
    {
      name: "DD_RUM getInitConfiguration throws",
      global: "DD_RUM",
      value: {
        getInitConfiguration: (): unknown => {
          throw new Error("not ready");
        },
        getInternalContext: (): unknown => {
          return DATADOG_CONTEXT;
        },
      },
      standsDown: false,
    },

    /*
     * Datadog RUM: the URL matches, but its tracer injects only for a
     * session it tracks. Before start, before consent (trackingConsent
     * "not-granted"), after a failed init (no clientToken or service) and
     * for a session sessionSampleRate left out, getInternalContext() is
     * undefined - and the configuration still names the URL.
     */
    {
      name: "DD_RUM matched, no getInternalContext",
      global: "DD_RUM",
      value: {
        getInitConfiguration: (): unknown => {
          return { allowedTracingUrls: [PAGE_ORIGIN] };
        },
      },
      standsDown: false,
    },
    {
      name: "DD_RUM matched, no tracked session (untracked, no consent, not started, failed init)",
      global: "DD_RUM",
      value: datadog(
        { allowedTracingUrls: [PAGE_ORIGIN], sessionSampleRate: 20 },
        false,
      ),
      standsDown: false,
    },
    {
      name: "DD_RUM matched, getInternalContext throws",
      global: "DD_RUM",
      value: {
        getInitConfiguration: (): unknown => {
          return { allowedTracingUrls: [PAGE_ORIGIN] };
        },
        getInternalContext: (): unknown => {
          throw new Error("page bug");
        },
      },
      standsDown: false,
    },
    {
      name: "DD_RUM matched, tracked session",
      global: "DD_RUM",
      value: datadog({ allowedTracingUrls: [PAGE_ORIGIN] }),
      standsDown: true,
    },
    {
      name: "DD_RUM matched, tracked session of a sampled application",
      global: "DD_RUM",
      value: datadog({
        allowedTracingUrls: [PAGE_ORIGIN],
        sessionSampleRate: 20,
      }),
      standsDown: true,
    },
    {
      name: 'DD_RUM matched, traceSampleRate 0 with traceContextInjection "all" (Datadog injects anyway)',
      global: "DD_RUM",
      value: datadog({
        allowedTracingUrls: [PAGE_ORIGIN],
        traceSampleRate: 0,
        traceContextInjection: "all",
      }),
      standsDown: true,
    },
    /*
     * Under the default traceContextInjection "sampled", Datadog decides
     * per session from a hash of its id whether to inject. That is not
     * replicated: the recorder stands down (such a request does not link)
     * rather than risk two traceparent values on an XHR.
     */
    {
      name: 'DD_RUM matched, traceSampleRate below 100 under "sampled" (not replicated: stands down)',
      global: "DD_RUM",
      value: datadog({
        allowedTracingUrls: [PAGE_ORIGIN],
        sessionSampleRate: 50,
        traceSampleRate: 0,
      }),
      standsDown: true,
    },

    /* New Relic: only with distributed tracing on. */
    { name: "NREUM bare", global: "NREUM", value: {}, standsDown: false },
    {
      name: "NREUM distributed tracing off",
      global: "NREUM",
      value: { init: { distributed_tracing: { enabled: false } } },
      standsDown: false,
    },
    {
      name: "NREUM distributed tracing on",
      global: "NREUM",
      value: { init: { distributed_tracing: { enabled: true } } },
      standsDown: true,
    },
    {
      name: "NREUM npm agent, distributed tracing on",
      global: "NREUM",
      value: newRelicNpm(true),
      standsDown: true,
    },
    {
      name: "NREUM npm agent, distributed tracing at its default (off)",
      global: "NREUM",
      value: newRelicNpm(undefined),
      standsDown: false,
    },
    {
      name: "NREUM npm agents, the second with distributed tracing on",
      global: "NREUM",
      value: newRelicNpm(false, true),
      standsDown: true,
    },
    {
      name: "NREUM npm agent registered with no configuration",
      global: "NREUM",
      value: { init: {}, initializedAgents: { a1b2c3d4e5f60718: {} } },
      standsDown: false,
    },
    {
      name: "NREUM initializedAgents that is not an object",
      global: "NREUM",
      value: { initializedAgents: null },
      standsDown: false,
    },
    {
      name: "newrelic API global alone",
      global: "newrelic",
      value: { setCustomAttribute: (): void => {} },
      standsDown: false,
    },

    /*
     * Elastic APM: only an active agent with distributed tracing on, under
     * the W3C header name.
     */
    {
      name: "elasticApm bare",
      global: "elasticApm",
      value: {},
      standsDown: false,
    },
    {
      name: "elasticApm inactive",
      global: "elasticApm",
      value: elastic(false),
      standsDown: false,
    },
    {
      name: "elasticApm active, Elastic's defaults",
      global: "elasticApm",
      value: elastic(true),
      standsDown: true,
    },
    {
      name: "elasticApm active, distributedTracing: false",
      global: "elasticApm",
      value: elastic(true, { distributedTracing: false }),
      standsDown: false,
    },
    {
      name: "elasticApm active, the legacy elastic-apm-traceparent header name",
      global: "elasticApm",
      value: elastic(true, {
        distributedTracingHeaderName: "elastic-apm-traceparent",
      }),
      standsDown: false,
    },
    {
      name: "elasticApm active, an empty header name (Elastic sends nothing)",
      global: "elasticApm",
      value: elastic(true, { distributedTracingHeaderName: "" }),
      standsDown: false,
    },
    {
      name: "elasticApm active, the W3C header name in another case",
      global: "elasticApm",
      value: elastic(true, { distributedTracingHeaderName: "Traceparent" }),
      standsDown: true,
    },
    {
      name: "elasticApm active, no header name set",
      global: "elasticApm",
      value: elastic(true, { distributedTracingHeaderName: undefined }),
      standsDown: true,
    },
    {
      name: "elasticApm active, configuration unreadable (Elastic's defaults trace)",
      global: "elasticApm",
      value: {
        isActive: (): boolean => {
          return true;
        },
      },
      standsDown: true,
    },
    {
      name: "elasticApm active, a getConfig the real agent does not have is not read",
      global: "elasticApm",
      value: {
        ...elastic(true),
        getConfig: (): unknown => {
          return { distributedTracing: false };
        },
      },
      standsDown: true,
    },
  ];

  it("stands down only for a vendor agent configured to trace the request, read at request time", async (): Promise<void> => {
    for (const agentCase of agentCases) {
      const mock: FetchMock = installFetch();

      startRecorder();

      await window.fetch("/api/before-agent");

      windowRecord[agentCase.global] = agentCase.value;

      try {
        await window.fetch("/api/x");
      } finally {
        delete windowRecord[agentCase.global];
      }

      const before: Headers = sentHeaders(mock, 0);
      const after: Headers = sentHeaders(mock, 1);

      expect([agentCase.name, before.get("traceparent")]).toEqual([
        agentCase.name,
        expect.stringMatching(TRACEPARENT_SHAPE),
      ]);

      if (agentCase.standsDown) {
        /* The agent adds the traceparent; the session still rides along. */
        expect([agentCase.name, after.get("traceparent")]).toEqual([
          agentCase.name,
          null,
        ]);
        expect(after.get("tracestate")).toBe(`oneuptime=sid:${SESSION_ID}`);
      } else {
        const minted: RegExpExecArray | null = TRACEPARENT_SHAPE.exec(
          after.get("traceparent") || "",
        );

        expect([agentCase.name, minted !== null]).toEqual([
          agentCase.name,
          true,
        ]);
        expect(after.get("tracestate")).toBe(
          `oneuptime=sid:${SESSION_ID};p:${minted?.[2]}`,
        );
      }

      recorder?.stop(window);
      recorder = null;
    }
  });

  it("hands Datadog's matcher the request's absolute URL", async (): Promise<void> => {
    const seen: Array<string> = [];

    installFetch();

    windowRecord["DD_RUM"] = datadog({
      allowedTracingUrls: [
        (url: string): boolean => {
          seen.push(url);
          return false;
        },
      ],
    });

    try {
      startRecorder();

      await window.fetch("/api/orders?page=2");
      await window.fetch(new URL(`${PAGE_ORIGIN}/api/items`));
    } finally {
      delete windowRecord["DD_RUM"];
    }

    expect(seen).toEqual([
      `${PAGE_ORIGIN}/api/orders?page=2`,
      `${PAGE_ORIGIN}/api/items`,
    ]);
  });

  it("logs the first vendor stand-down once per page load, naming the agent", async (): Promise<void> => {
    installFetch();

    windowRecord["NREUM"] = {
      init: { distributed_tracing: { enabled: true } },
    };

    try {
      startRecorder();

      await window.fetch("/api/a");
      await window.fetch("/api/b");
    } finally {
      delete windowRecord["NREUM"];
    }

    const standDowns: Array<DebugRecord> = debugRecords(
      "same-origin-propagation",
    ).filter((record: DebugRecord): boolean => {
      return record.detail?.["reason"] === "agent-stand-down";
    });

    expect(standDowns).toHaveLength(1);
    expect(standDowns[0]?.level).toBe("info");
    expect(standDowns[0]?.detail).toEqual({
      enabled: true,
      reason: "agent-stand-down",
      agent: "NREUM",
    });
  });

  it("logs no vendor stand-down for an agent that is not tracing, or behind a `__wrapped` fetch", async (): Promise<void> => {
    const standDowns: () => Array<DebugRecord> = (): Array<DebugRecord> => {
      return debugRecords("same-origin-propagation").filter(
        (record: DebugRecord): boolean => {
          return record.detail?.["reason"] === "agent-stand-down";
        },
      );
    };

    /* Present, not tracing: ours is minted, and there is nothing to say. */
    const plain: FetchMock = installFetch();

    windowRecord["DD_RUM"] = datadog({ allowedTracingUrls: [] });

    try {
      startRecorder();

      await window.fetch("/api/a");
    } finally {
      delete windowRecord["DD_RUM"];
    }

    expect(sentHeaders(plain).get("traceparent")).toMatch(TRACEPARENT_SHAPE);
    expect(standDowns()).toHaveLength(0);

    recorder?.stop(window);
    recorder = null;

    /* A shimmer-marked tracer inside ours is the reason, not the agent. */
    const inner: FetchMock = jest.fn().mockResolvedValue(okResponse());

    windowRecord["fetch"] = markedWrapper(inner, { __wrapped: true });
    windowRecord["DD_RUM"] = datadog({ allowedTracingUrls: [PAGE_ORIGIN] });

    try {
      startRecorder();

      await window.fetch("/api/a");
    } finally {
      delete windowRecord["DD_RUM"];
    }

    expectStoodDown(inner);
    expect(standDowns()).toHaveLength(0);
  });

  /*
   * OpenTelemetry's instrumentation-fetch 0.220 replaces options.headers
   * with a Headers of its own and sets its traceparent there, or sets it on
   * a Request in place. The recorder reads it back after the call, so the
   * network row carries the id really on the wire. (Tests/
   * NetworkRecorderOpenTelemetry.test.ts runs the real instrumentation.)
   */
  function otelLikeFetch(
    inner: FetchMock,
  ): (input: unknown, init?: unknown) => unknown {
    return markedWrapper(
      (input: unknown, init?: unknown): unknown => {
        if (input instanceof FakeRequest) {
          input.headers.set("traceparent", INNER_TRACEPARENT);
          return inner(input);
        }

        const options: Record<string, unknown> = (init || {}) as Record<
          string,
          unknown
        >;
        const headers: Headers = new Headers(
          options["headers"] as HeadersInit | undefined,
        );

        headers.set("traceparent", INNER_TRACEPARENT);
        options["headers"] = headers;

        return inner(input, options);
      },
      { __wrapped: true },
    ) as (input: unknown, init?: unknown) => unknown;
  }

  it("reads back an inner tracer's traceparent and reports it as the page's own", async (): Promise<void> => {
    const shapes: Array<RequestInit | undefined> = [
      undefined,
      { headers: { "x-a": "1" } },
      { headers: new Headers({ "x-a": "1" }) },
      { headers: [["x-a", "1"]] },
    ];

    for (const init of shapes) {
      const mock: FetchMock = jest.fn().mockResolvedValue(okResponse());

      windowRecord["fetch"] = otelLikeFetch(mock);

      startRecorder();

      await window.fetch("/api/x", init);

      const headers: Headers = sentHeaders(mock);

      /* One traceparent on the wire - the inner tracer's - and our session. */
      expect(headers.get("traceparent")).toBe(INNER_TRACEPARENT);
      expect(headers.get("tracestate")).toBe(`oneuptime=sid:${SESSION_ID}`);

      expect(completed[0]?.request.traceId).toBe(INNER_TRACE_ID);
      expect(completed[0]?.rollupTraceId).toBe(INNER_TRACE_ID);

      recorder?.stop(window);
      recorder = null;
    }
  });

  it("reads back from a Request the inner tracer mutated in place", async (): Promise<void> => {
    windowRecord["Request"] = FakeRequest;

    try {
      const mock: FetchMock = jest.fn().mockResolvedValue(okResponse());

      windowRecord["fetch"] = otelLikeFetch(mock);

      startRecorder();

      await window.fetch(new FakeRequest("/api/x") as unknown as RequestInfo);

      const sent: FakeRequest = mock.mock.calls[0]?.[0] as FakeRequest;

      expect(sent.headers.get("traceparent")).toBe(INNER_TRACEPARENT);
      expect(sent.headers.get("tracestate")).toBe(
        `oneuptime=sid:${SESSION_ID}`,
      );
      expect(completed[0]?.rollupTraceId).toBe(INNER_TRACE_ID);
    } finally {
      delete windowRecord["Request"];
    }
  });

  it("reads back from the page's own init with propagation off", async (): Promise<void> => {
    const mock: FetchMock = jest.fn().mockResolvedValue(okResponse());

    windowRecord["fetch"] = otelLikeFetch(mock);

    startRecorder({ policy: false });

    await window.fetch("/api/x", { headers: { "x-a": "1" } });

    expect(sentHeaders(mock).get("tracestate")).toBeNull();
    expect(completed[0]?.rollupTraceId).toBe(INNER_TRACE_ID);
  });

  /*
   * fetch(url) with no init, on a request the recorder adds nothing to:
   * the inner tracer used to build a PRIVATE options object (`init || {}`)
   * and set its traceparent there, out of the read-back's reach. It is now
   * handed an empty init the recorder keeps - fetch(url, {}) is the same
   * request.
   */
  it("reads back from fetch(url) with no init when it adds nothing itself", async (): Promise<void> => {
    const setups: Array<{ label: string; options: RecorderOptions }> = [
      { label: "policy off", options: { policy: false } },
      {
        label: "not uploading",
        options: {
          sessionId: (): string | null => {
            return null;
          },
        },
      },
    ];

    for (const setup of setups) {
      for (const input of ["/api/x", new URL(`${PAGE_ORIGIN}/api/y`)]) {
        const mock: FetchMock = jest.fn().mockResolvedValue(okResponse());

        windowRecord["fetch"] = otelLikeFetch(mock);

        startRecorder(setup.options);

        await window.fetch(input);

        expect([setup.label, sentHeaders(mock).get("traceparent")]).toEqual([
          setup.label,
          INNER_TRACEPARENT,
        ]);
        expect(sentHeaders(mock).get("tracestate")).toBeNull();
        expect([setup.label, completed[0]?.rollupTraceId]).toEqual([
          setup.label,
          INNER_TRACE_ID,
        ]);

        recorder?.stop(window);
        recorder = null;
      }
    }
  });

  it("hands an inner tracer fetch(url, null) as fetch(url, {}), and leaves a Request with no second argument", async (): Promise<void> => {
    const calls: Array<Array<unknown>> = [];
    const inner: FetchMock = jest.fn().mockResolvedValue(okResponse());

    windowRecord["fetch"] = markedWrapper(
      (...args: Array<unknown>): unknown => {
        calls.push(args);
        return inner(...args);
      },
      { __wrapped: true },
    );

    windowRecord["Request"] = FakeRequest;

    try {
      startRecorder({ policy: false });

      await window.fetch("/api/a", null as unknown as RequestInit);
      await window.fetch(new FakeRequest("/api/b") as unknown as RequestInfo);
    } finally {
      delete windowRecord["Request"];
    }

    expect(calls[0]).toEqual(["/api/a", {}]);

    /* Beside a Request an init would make OpenTelemetry build a new one. */
    expect(calls[1]).toHaveLength(1);
  });

  it("hands nothing extra to a fetch no tracer wraps", async (): Promise<void> => {
    const mock: FetchMock = installFetch();

    startRecorder({ policy: false });

    await window.fetch("/api/x");

    expect(mock.mock.calls[0]).toEqual(["/api/x"]);
  });

  /*
   * The breaker's retry is a new request: the inner tracer gives it a new
   * span and traceparent. The recorded row used to keep the FIRST
   * attempt's read-back id, so "Backend for this request" opened the
   * failed attempt's trace instead of the one that answered.
   */
  it("records the retry's own traceparent from an inner tracer, not the failed attempt's", async (): Promise<void> => {
    const attemptIds: Array<string> = ["1".repeat(32), "2".repeat(32)];

    for (const init of [undefined, { headers: { "x-a": "1" } }]) {
      let attempt: number = 0;
      const inner: FetchMock = jest
        .fn()
        .mockRejectedValueOnce(new TypeError("Failed to fetch"))
        .mockResolvedValue(okResponse());

      windowRecord["fetch"] = markedWrapper(
        (input: unknown, pageInit?: unknown): unknown => {
          const options: Record<string, unknown> = (pageInit || {}) as Record<
            string,
            unknown
          >;
          const headers: Headers = new Headers(
            options["headers"] as HeadersInit | undefined,
          );

          headers.set(
            "traceparent",
            `00-${attemptIds[attempt++]}-${"d".repeat(16)}-01`,
          );
          options["headers"] = headers;

          return inner(input, options);
        },
        { __wrapped: true },
      );

      startRecorder();

      const response: Response = await window.fetch("/download/1", init);

      expect(response.status).toBe(200);
      expect(inner).toHaveBeenCalledTimes(2);

      /* The retry is the page's own call: no session on it. */
      expect(sentHeaders(inner, 1).get("tracestate")).toBeNull();
      expect(sentHeaders(inner, 1).get("traceparent")).toContain(attemptIds[1]);

      expect(completed).toHaveLength(1);
      expect(completed[0]?.request.traceId).toBe(attemptIds[1]);
      expect(completed[0]?.rollupTraceId).toBe(attemptIds[1]);

      recorder?.stop(window);
      recorder = null;
    }
  });

  it("records no trace id on a retry when nothing on the retry carries one", async (): Promise<void> => {
    const mock: FetchMock = jest
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValue(okResponse());

    windowRecord["fetch"] = mock;

    startRecorder();

    await window.fetch("/download/1");

    expect(completed[0]?.request.traceId).toBeUndefined();
    expect(completed[0]?.rollupTraceId).toBeNull();
  });

  it("keeps the page's own traceparent on a retry", async (): Promise<void> => {
    const mock: FetchMock = jest
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValue(okResponse());

    windowRecord["fetch"] = mock;

    startRecorder();

    await window.fetch("/download/1", {
      headers: { traceparent: PAGE_TRACEPARENT },
    });

    expect(mock).toHaveBeenCalledTimes(2);
    expect(completed[0]?.request.traceId).toBe(PAGE_TRACE_ID);
    expect(completed[0]?.rollupTraceId).toBe(PAGE_TRACE_ID);
  });
});

describe("what reaches the envelope rollup", (): void => {
  it("keeps a same-origin MINTED id on the network event but out of the rollup", async (): Promise<void> => {
    const mock: FetchMock = installFetch();

    startRecorder();

    await window.fetch("/api/x");

    const traceId: string | undefined = TRACEPARENT_SHAPE.exec(
      sentHeaders(mock).get("traceparent") || "",
    )?.[1];

    expect(traceId).toBeDefined();
    expect(events[0]?.traceId).toBe(traceId);
    expect(completed[0]?.request.traceId).toBe(traceId);
    expect(completed[0]?.rollupTraceId).toBeNull();
  });

  it("puts page-set and listed-origin ids in the rollup exactly as before", async (): Promise<void> => {
    const mock: FetchMock = installFetch();

    startRecorder({ origins: ["https://api.allowed.example"] });

    await window.fetch("/api/x", {
      headers: { traceparent: PAGE_TRACEPARENT },
    });
    await window.fetch("https://api.allowed.example/y");

    const listedId: string | undefined = TRACEPARENT_SHAPE.exec(
      sentHeaders(mock, 1).get("traceparent") || "",
    )?.[1];

    expect(completed[0]?.rollupTraceId).toBe(PAGE_TRACE_ID);
    expect(completed[1]?.rollupTraceId).toBe(listedId);
  });
});

describe("the redirect breaker", (): void => {
  const networkError: () => TypeError = (): TypeError => {
    return new TypeError("Failed to fetch");
  };

  it("retries a failed same-origin GET once with the page's own arguments, records it once, and turns propagation off", async (): Promise<void> => {
    const mock: FetchMock = jest
      .fn()
      .mockRejectedValueOnce(networkError())
      .mockResolvedValue(okResponse());

    windowRecord["fetch"] = mock;

    startRecorder();

    const response: Response = await window.fetch("/download/1");

    expect(response.status).toBe(200);
    expect(mock).toHaveBeenCalledTimes(2);

    /* The first attempt carried ours; the retry is exactly the page's call. */
    expect(sentHeaders(mock, 0).get("tracestate")).toContain(SESSION_ID);
    expect(mock.mock.calls[1]).toEqual(["/download/1"]);

    /* ONE request, as the page made one, with no id that never reached the wire. */
    expect(completed).toHaveLength(1);
    expect(completed[0]?.request.status).toBe(200);
    expect(completed[0]?.request.traceId).toBeUndefined();

    expect(debugRecords("same-origin-propagation-tripped")).toHaveLength(1);
    expect(debugRecords("same-origin-propagation-tripped")[0]?.detail).toEqual({
      retried: true,
    });

    /* Off for the rest of the page load. */
    await window.fetch("/api/next");

    expect(mock.mock.calls[2]?.[1]).toBeUndefined();
  });

  it("retries a HEAD, and a GET with an init, with that same init object", async (): Promise<void> => {
    const init: RequestInit = { method: "HEAD", headers: { "x-a": "1" } };
    const mock: FetchMock = jest
      .fn()
      .mockRejectedValueOnce(networkError())
      .mockResolvedValue(okResponse());

    windowRecord["fetch"] = mock;

    startRecorder();

    await window.fetch("/api/x", init);

    expect(mock.mock.calls[1]?.[1]).toBe(init);
    expect(init.headers).toEqual({ "x-a": "1" });
  });

  it("rejects with the retry's own error when the retry fails too, recorded once", async (): Promise<void> => {
    const second: TypeError = new TypeError("still failing");
    const mock: FetchMock = jest
      .fn()
      .mockRejectedValueOnce(networkError())
      .mockRejectedValueOnce(second);

    windowRecord["fetch"] = mock;

    startRecorder();

    await expect(window.fetch("/api/x")).rejects.toBe(second);

    expect(mock).toHaveBeenCalledTimes(2);
    expect(completed).toHaveLength(1);
    expect(completed[0]?.request.status).toBe(0);
    expect(completed[0]?.request.isError).toBe(true);
  });

  it("does not retry a POST, rejects with its error, and still trips", async (): Promise<void> => {
    const failure: TypeError = networkError();
    const mock: FetchMock = jest
      .fn()
      .mockRejectedValueOnce(failure)
      .mockResolvedValue(okResponse());

    windowRecord["fetch"] = mock;

    startRecorder();

    await expect(
      window.fetch("/api/orders", { method: "POST", body: "{}" }),
    ).rejects.toBe(failure);

    expect(mock).toHaveBeenCalledTimes(1);
    expect(completed).toHaveLength(1);
    expect(debugRecords("same-origin-propagation-tripped")[0]?.detail).toEqual({
      retried: false,
    });

    await window.fetch("/api/next");

    expect(mock.mock.calls[1]?.[1]).toBeUndefined();
  });

  it("warns once however many annotated requests fail", async (): Promise<void> => {
    const mock: FetchMock = jest.fn().mockRejectedValue(networkError());

    windowRecord["fetch"] = mock;

    startRecorder();

    const first: Promise<Response> = window.fetch("/api/a");
    const second: Promise<Response> = window.fetch("/api/b");

    await expect(first).rejects.toBeInstanceOf(TypeError);
    await expect(second).rejects.toBeInstanceOf(TypeError);

    expect(debugRecords("same-origin-propagation-tripped")).toHaveLength(1);
  });

  it("is not tripped by the page's own abort or timeout, or while offline", async (): Promise<void> => {
    const abortError: Error = new Error("aborted");
    abortError.name = "AbortError";

    const timeoutError: Error = new Error("timed out");
    timeoutError.name = "TimeoutError";

    for (const failure of [abortError, timeoutError]) {
      const mock: FetchMock = jest
        .fn()
        .mockRejectedValueOnce(failure)
        .mockResolvedValue(okResponse());

      windowRecord["fetch"] = mock;

      startRecorder();

      await expect(window.fetch("/api/x")).rejects.toBe(failure);
      await window.fetch("/api/y");

      expect(mock).toHaveBeenCalledTimes(2);
      expect(sentHeaders(mock, 1).get("tracestate")).toContain(SESSION_ID);

      recorder?.stop(window);
      recorder = null;
    }

    const offline: jest.SpyInstance = jest
      .spyOn(window.navigator, "onLine", "get")
      .mockReturnValue(false);

    const mock: FetchMock = jest
      .fn()
      .mockRejectedValueOnce(networkError())
      .mockResolvedValue(okResponse());

    windowRecord["fetch"] = mock;

    startRecorder();

    await expect(window.fetch("/api/x")).rejects.toBeInstanceOf(TypeError);

    offline.mockRestore();

    await window.fetch("/api/y");

    expect(mock).toHaveBeenCalledTimes(2);
    expect(sentHeaders(mock, 1).get("tracestate")).toContain(SESSION_ID);
    expect(debugRecords("same-origin-propagation-tripped")).toHaveLength(0);
  });

  /*
   * controller.abort(reason) rejects fetch with the REASON itself - an
   * Error named "Error", or a string - not an AbortError. A route change
   * cancelling its in-flight request used to trip the breaker (propagation
   * off for the rest of the page), fire a pointless retry, and record the
   * cancellation as a failure. The page's aborted signal says what it was.
   */
  it("is not tripped, retried or counted as an error when the page aborts with a reason of its own", async (): Promise<void> => {
    /* What native fetch does with an aborted signal: reject with its reason. */
    const abortable: () => FetchMock = (): FetchMock => {
      return jest.fn(
        (input: unknown, init?: RequestInit): Promise<Response> => {
          const signal: AbortSignal | null | undefined =
            init && init.signal !== undefined
              ? init.signal
              : (input as FakeRequest).signal;

          if (!signal) {
            return Promise.resolve(okResponse());
          }

          return new Promise<Response>(
            (_resolve: unknown, reject: (reason: unknown) => void): void => {
              signal.addEventListener("abort", (): void => {
                reject(signal.reason);
              });
            },
          );
        },
      );
    };

    const reasons: Array<unknown> = [new Error("route changed"), "unmount"];

    for (const reason of reasons) {
      for (const shape of ["init", "request"]) {
        const mock: FetchMock = abortable();
        const controller: AbortController = new AbortController();

        windowRecord["fetch"] = mock;
        windowRecord["Request"] = FakeRequest;

        try {
          startRecorder();

          const pending: Promise<Response> =
            shape === "init"
              ? window.fetch("/api/slow", { signal: controller.signal })
              : window.fetch(
                  new FakeRequest("/api/slow", {
                    signal: controller.signal,
                  }) as unknown as RequestInfo,
                );

          controller.abort(reason);

          /* The page gets its own reason back, unchanged. */
          await expect(pending).rejects.toBe(reason);

          /* No retry: an aborted signal would only reject it again. */
          expect(mock).toHaveBeenCalledTimes(1);

          expect(completed).toHaveLength(1);
          expect(completed[0]?.request.aborted).toBe(true);
          expect(completed[0]?.request.isError).toBe(false);
          expect(debugRecords("same-origin-propagation-tripped")).toHaveLength(
            0,
          );

          /* Propagation is still on. */
          await window.fetch("/api/after");

          expect([
            String(reason),
            shape,
            sentHeaders(mock, 1).get("tracestate"),
          ]).toEqual([
            String(reason),
            shape,
            expect.stringContaining(SESSION_ID),
          ]);
        } finally {
          delete windowRecord["Request"];
          recorder?.stop(window);
          recorder = null;
        }
      }
    }
  });

  it("records a timeout on the page's signal as the failure it is, without tripping", async (): Promise<void> => {
    const timeout: Error = new Error("signal timed out");

    timeout.name = "TimeoutError";

    const controller: AbortController = new AbortController();
    const mock: FetchMock = jest
      .fn()
      .mockImplementationOnce((): Promise<Response> => {
        controller.abort(timeout);
        return Promise.reject(timeout);
      })
      .mockResolvedValue(okResponse());

    windowRecord["fetch"] = mock;

    startRecorder();

    await expect(
      window.fetch("/api/slow", { signal: controller.signal }),
    ).rejects.toBe(timeout);

    expect(mock).toHaveBeenCalledTimes(1);
    expect(completed[0]?.request.aborted).toBeUndefined();
    expect(completed[0]?.request.isError).toBe(true);
    expect(debugRecords("same-origin-propagation-tripped")).toHaveLength(0);
  });

  it("still trips on a network failure while the page's signal is not aborted", async (): Promise<void> => {
    const controller: AbortController = new AbortController();
    const mock: FetchMock = jest
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValue(okResponse());

    windowRecord["fetch"] = mock;

    startRecorder();

    await window.fetch("/download/1", { signal: controller.signal });

    expect(mock).toHaveBeenCalledTimes(2);
    expect(debugRecords("same-origin-propagation-tripped")).toHaveLength(1);
    expect(completed[0]?.request.aborted).toBeUndefined();
  });

  it("is not tripped by a request we added nothing to", async (): Promise<void> => {
    const mock: FetchMock = jest
      .fn()
      .mockRejectedValueOnce(networkError())
      .mockResolvedValue(okResponse());

    windowRecord["fetch"] = mock;

    startRecorder({ origins: ["https://api.allowed.example"] });

    /* Page set both headers: nothing of ours on it. */
    await expect(
      window.fetch("/api/x", {
        headers: { traceparent: PAGE_TRACEPARENT, tracestate: PAGE_TRACESTATE },
      }),
    ).rejects.toBeInstanceOf(TypeError);

    await window.fetch("/api/y");

    expect(mock).toHaveBeenCalledTimes(2);
    expect(sentHeaders(mock, 1).get("tracestate")).toContain(SESSION_ID);
  });

  it("is not tripped by a listed cross-origin failure", async (): Promise<void> => {
    const mock: FetchMock = jest
      .fn()
      .mockRejectedValueOnce(networkError())
      .mockResolvedValue(okResponse());

    windowRecord["fetch"] = mock;

    startRecorder({ origins: ["https://api.allowed.example"] });

    await expect(
      window.fetch("https://api.allowed.example/x"),
    ).rejects.toBeInstanceOf(TypeError);

    await window.fetch("/api/y");

    expect(mock).toHaveBeenCalledTimes(2);
    expect(sentHeaders(mock, 1).get("tracestate")).toContain(SESSION_ID);
  });
});

describe("same-origin XHR", (): void => {
  let openSpy: jest.Mock;
  let sendSpy: jest.Mock;
  let setHeaderSpy: jest.Mock;

  let savedOpen: unknown;
  let savedSend: unknown;
  let savedSetHeader: unknown;

  const prototype: Record<string, unknown> =
    XMLHttpRequest.prototype as unknown as Record<string, unknown>;

  beforeEach((): void => {
    openSpy = jest.fn();
    sendSpy = jest.fn();
    setHeaderSpy = jest.fn();

    savedOpen = prototype["open"];
    savedSend = prototype["send"];
    savedSetHeader = prototype["setRequestHeader"];

    prototype["open"] = openSpy;
    prototype["send"] = sendSpy;
    prototype["setRequestHeader"] = setHeaderSpy;
  });

  afterEach((): void => {
    if (recorder) {
      recorder.stop(window);
      recorder = null;
    }

    prototype["open"] = savedOpen;
    prototype["send"] = savedSend;
    prototype["setRequestHeader"] = savedSetHeader;
  });

  const headersSet: () => Record<string, Array<string>> = (): Record<
    string,
    Array<string>
  > => {
    const set: Record<string, Array<string>> = {};

    for (const call of setHeaderSpy.mock.calls) {
      const name: string = String(call[0]).toLowerCase();

      set[name] = (set[name] || []).concat(String(call[1]));
    }

    return set;
  };

  const finish: (xhr: XMLHttpRequest, status: number) => void = (
    xhr: XMLHttpRequest,
    status: number,
  ): void => {
    Object.defineProperty(xhr, "status", { value: status });
    xhr.dispatchEvent(new Event("loadend"));
  };

  it("adds traceparent and tracestate (with p) through the original setRequestHeader", (): void => {
    startRecorder();

    const xhr: XMLHttpRequest = new XMLHttpRequest();

    xhr.open("GET", "/api/cart");
    xhr.send();

    const set: Record<string, Array<string>> = headersSet();
    const match: RegExpExecArray | null = TRACEPARENT_SHAPE.exec(
      set["traceparent"]?.[0] || "",
    );

    expect(set["traceparent"]).toHaveLength(1);
    expect(match).not.toBeNull();
    expect(set["tracestate"]).toEqual([
      `oneuptime=sid:${SESSION_ID};p:${match?.[2]}`,
    ]);
    expect(sendSpy).toHaveBeenCalledTimes(1);

    finish(xhr, 200);

    /* Minted on the same-origin path: on the event, not in the rollup. */
    expect(completed[0]?.request.traceId).toBe(match?.[1]);
    expect(completed[0]?.rollupTraceId).toBeNull();
  });

  it("never duplicates a page-set traceparent or tracestate", (): void => {
    startRecorder();

    const first: XMLHttpRequest = new XMLHttpRequest();

    first.open("GET", "/api/a");
    first.setRequestHeader("TraceParent", PAGE_TRACEPARENT);
    first.send();
    finish(first, 200);

    expect(headersSet()).toEqual({
      traceparent: [PAGE_TRACEPARENT],
      tracestate: [`oneuptime=sid:${SESSION_ID}`],
    });
    expect(completed[0]?.rollupTraceId).toBe(PAGE_TRACE_ID);

    setHeaderSpy.mockClear();

    const second: XMLHttpRequest = new XMLHttpRequest();

    second.open("GET", "/api/b");
    second.setRequestHeader("tracestate", PAGE_TRACESTATE);
    second.send();

    const set: Record<string, Array<string>> = headersSet();

    expect(set["tracestate"]).toEqual([PAGE_TRACESTATE]);
    expect(set["traceparent"]?.[0]).toMatch(TRACEPARENT_SHAPE);

    setHeaderSpy.mockClear();

    const third: XMLHttpRequest = new XMLHttpRequest();

    third.open("GET", "/api/c");
    third.setRequestHeader("traceparent", PAGE_TRACEPARENT);
    third.setRequestHeader("TRACESTATE", PAGE_TRACESTATE);
    third.send();

    expect(headersSet()).toEqual({
      traceparent: [PAGE_TRACEPARENT],
      tracestate: [PAGE_TRACESTATE],
    });
  });

  it("adds nothing to a cross-origin XHR, and a traceparent only to a listed one", (): void => {
    startRecorder({ origins: ["https://api.allowed.example"] });

    const unlisted: XMLHttpRequest = new XMLHttpRequest();

    unlisted.open("GET", "https://api.other.example/x");
    unlisted.send();

    expect(setHeaderSpy).not.toHaveBeenCalled();

    const listed: XMLHttpRequest = new XMLHttpRequest();

    listed.open("GET", "https://api.allowed.example/x");
    listed.send();

    expect(Object.keys(headersSet())).toEqual(["traceparent"]);
  });

  it("adds nothing while the recorder hands out no session id", (): void => {
    startRecorder({
      sessionId: (): string | null => {
        return null;
      },
    });

    const xhr: XMLHttpRequest = new XMLHttpRequest();

    xhr.open("GET", "/api/x");
    xhr.send();

    expect(setHeaderSpy).not.toHaveBeenCalled();
  });

  /* @elastic/apm-rum's shape: no getConfig, a ConfigService. */
  function elasticXhrAgent(
    active: boolean,
    distributedTracing: boolean,
  ): Record<string, unknown> {
    return {
      isActive: (): boolean => {
        return active;
      },
      serviceFactory: {
        getService: (): unknown => {
          return {
            get: (key: string): unknown => {
              return key === "distributedTracing"
                ? distributedTracing
                : "traceparent";
            },
          };
        },
      },
    };
  }

  it("stands down on traceparent for a `__wrapped` send, and for an agent global", (): void => {
    Object.defineProperty(sendSpy, "__wrapped", {
      value: true,
      enumerable: false,
      configurable: true,
    });

    startRecorder();

    const xhr: XMLHttpRequest = new XMLHttpRequest();

    xhr.open("GET", "/api/x");
    xhr.send();

    expect(headersSet()).toEqual({
      tracestate: [`oneuptime=sid:${SESSION_ID}`],
    });

    recorder?.stop(window);
    recorder = null;
    setHeaderSpy.mockClear();

    delete (sendSpy as unknown as Record<string, unknown>)["__wrapped"];
    windowRecord["elasticApm"] = elasticXhrAgent(true, true);

    try {
      startRecorder();

      const other: XMLHttpRequest = new XMLHttpRequest();

      other.open("GET", "/api/x");
      other.send();

      expect(headersSet()).toEqual({
        tracestate: [`oneuptime=sid:${SESSION_ID}`],
      });
    } finally {
      delete windowRecord["elasticApm"];
    }
  });

  it("mints for an agent that is present but not tracing, and matches Datadog against the XHR's absolute URL", (): void => {
    startRecorder();

    /* Inactive, then active with distributedTracing: false. */
    for (const agent of [
      elasticXhrAgent(false, true),
      elasticXhrAgent(true, false),
    ]) {
      windowRecord["elasticApm"] = agent;

      try {
        const untraced: XMLHttpRequest = new XMLHttpRequest();

        untraced.open("GET", "/api/x");
        untraced.send();

        expect(headersSet()["traceparent"]?.[0]).toMatch(TRACEPARENT_SHAPE);
      } finally {
        delete windowRecord["elasticApm"];
      }

      setHeaderSpy.mockClear();
    }

    let context: unknown = {
      session_id: "3c5e2c6b-0b1f-4d3a-9f64-1f4e0a7b2c9d",
    };

    windowRecord["DD_RUM"] = {
      getInitConfiguration: (): unknown => {
        return { allowedTracingUrls: [`${PAGE_ORIGIN}/api/`] };
      },
      getInternalContext: (): unknown => {
        return context;
      },
    };

    try {
      const traced: XMLHttpRequest = new XMLHttpRequest();

      traced.open("POST", "/api/orders");
      traced.send("{}");

      expect(headersSet()).toEqual({
        tracestate: [`oneuptime=sid:${SESSION_ID}`],
      });

      setHeaderSpy.mockClear();

      const untraced: XMLHttpRequest = new XMLHttpRequest();

      untraced.open("GET", "/static/x.json");
      untraced.send();

      expect(headersSet()["traceparent"]?.[0]).toMatch(TRACEPARENT_SHAPE);

      setHeaderSpy.mockClear();

      /*
       * The same URL once Datadog tracks no session (sampled out, consent
       * withdrawn): its tracer adds nothing, so ours goes out.
       */
      context = undefined;

      const untracked: XMLHttpRequest = new XMLHttpRequest();

      untracked.open("POST", "/api/orders");
      untracked.send("{}");

      expect(headersSet()["traceparent"]?.[0]).toMatch(TRACEPARENT_SHAPE);
    } finally {
      delete windowRecord["DD_RUM"];
    }
  });

  it("adds nothing to a POST to an OpenTelemetry export path on the page's own origin", (): void => {
    startRecorder();

    const exporter: XMLHttpRequest = new XMLHttpRequest();

    exporter.open("POST", "/api/otel/v1/traces");
    exporter.send("{}");

    expect(setHeaderSpy).not.toHaveBeenCalled();

    /* Lowercase is still a POST; open() normalises it. */
    const lowercase: XMLHttpRequest = new XMLHttpRequest();

    lowercase.open("post", "/otel/v1/logs");
    lowercase.send("{}");

    expect(setHeaderSpy).not.toHaveBeenCalled();
  });

  it("annotates a GET to such a path: the app's own endpoint", (): void => {
    startRecorder();

    const auditLog: XMLHttpRequest = new XMLHttpRequest();

    auditLog.open("GET", "/api/v1/logs");
    auditLog.send();

    expect(headersSet()["traceparent"]?.[0]).toMatch(TRACEPARENT_SHAPE);
    expect(headersSet()["tracestate"]?.[0]).toContain(SESSION_ID);
  });

  /*
   * open(method, url, false): a synchronous request's network error is
   * THROWN from send() before any readystatechange, error or loadend, so
   * the loadend listener never heard it - the breaker never tripped, and
   * every later sync request to a redirecting endpoint kept failing.
   */
  it("trips the breaker and records a synchronous XHR whose send() throws, rethrowing the page's exception", (): void => {
    const failure: DOMException = new DOMException(
      "A network error occurred.",
      "NetworkError",
    );

    sendSpy.mockImplementationOnce((): void => {
      throw failure;
    });

    startRecorder();

    const failed: XMLHttpRequest = new XMLHttpRequest();

    failed.open("GET", "/download/1", false);

    let thrown: unknown = null;

    try {
      failed.send();
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBe(failure);
    expect(sendSpy).toHaveBeenCalledTimes(1);

    expect(debugRecords("same-origin-propagation-tripped")).toHaveLength(1);
    expect(debugRecords("same-origin-propagation-tripped")[0]?.detail).toEqual({
      retried: false,
    });

    expect(completed).toHaveLength(1);
    expect(completed[0]?.request.status).toBe(0);
    expect(completed[0]?.request.isError).toBe(true);
    expect(completed[0]?.request.initiator).toBe("xhr");

    /* A platform that ALSO fired loadend does not make it two requests. */
    finish(failed, 0);

    expect(completed).toHaveLength(1);

    setHeaderSpy.mockClear();

    const next: XMLHttpRequest = new XMLHttpRequest();

    next.open("GET", "/api/next", false);
    next.send();

    expect(setHeaderSpy).not.toHaveBeenCalled();
  });

  it("treats open(method, url, undefined) as synchronous, as the platform does", (): void => {
    sendSpy.mockImplementationOnce((): void => {
      throw new DOMException("A network error occurred.", "NetworkError");
    });

    startRecorder();

    const xhr: XMLHttpRequest = new XMLHttpRequest();

    (xhr.open as (...args: Array<unknown>) => void)("GET", "/api/x", undefined);

    expect((): void => {
      xhr.send();
    }).toThrow("A network error occurred.");
    expect(debugRecords("same-origin-propagation-tripped")).toHaveLength(1);
  });

  it("records a synchronous XHR that succeeds once, and is not tripped by one that times out", (): void => {
    startRecorder();

    /* A sync send fires loadend before it returns. */
    sendSpy.mockImplementationOnce(function (this: XMLHttpRequest): void {
      finish(this, 200);
    });

    const ok: XMLHttpRequest = new XMLHttpRequest();

    ok.open("GET", "/api/ok", false);
    ok.send();

    expect(completed).toHaveLength(1);
    expect(completed[0]?.request.status).toBe(200);

    const timeout: DOMException = new DOMException("timed out", "TimeoutError");

    sendSpy.mockImplementationOnce((): void => {
      throw timeout;
    });

    const slow: XMLHttpRequest = new XMLHttpRequest();

    slow.open("GET", "/api/slow", false);

    expect((): void => {
      slow.send();
    }).toThrow(timeout);

    expect(completed).toHaveLength(2);
    expect(debugRecords("same-origin-propagation-tripped")).toHaveLength(0);
  });

  it("leaves an asynchronous send() that throws to the page, unrecorded and untripped", (): void => {
    const failure: DOMException = new DOMException(
      "The object is in an invalid state.",
      "InvalidStateError",
    );

    sendSpy.mockImplementationOnce((): void => {
      throw failure;
    });

    startRecorder();

    const xhr: XMLHttpRequest = new XMLHttpRequest();

    xhr.open("GET", "/api/x", true);

    expect((): void => {
      xhr.send();
    }).toThrow(failure);
    expect(completed).toHaveLength(0);
    expect(debugRecords("same-origin-propagation-tripped")).toHaveLength(0);
  });

  it("annotates once per open(), however often send() is called", (): void => {
    startRecorder();

    const xhr: XMLHttpRequest = new XMLHttpRequest();

    xhr.open("GET", "/api/x");
    xhr.send();
    xhr.send();

    expect(headersSet()["tracestate"]).toHaveLength(1);
    expect(headersSet()["traceparent"]).toHaveLength(1);
  });

  it("trips the breaker on a network failure (status 0, not aborted) - it cannot retry", (): void => {
    startRecorder();

    const failed: XMLHttpRequest = new XMLHttpRequest();

    failed.open("GET", "/download/1");
    failed.send();
    finish(failed, 0);

    expect(debugRecords("same-origin-propagation-tripped")[0]?.detail).toEqual({
      retried: false,
    });

    /* Recorded as the failure it was, once. */
    expect(completed).toHaveLength(1);
    expect(completed[0]?.request.isError).toBe(true);
    expect(sendSpy).toHaveBeenCalledTimes(1);

    setHeaderSpy.mockClear();

    const next: XMLHttpRequest = new XMLHttpRequest();

    next.open("GET", "/api/next");
    next.send();

    expect(setHeaderSpy).not.toHaveBeenCalled();
  });

  it("is not tripped by an aborted or timed-out XHR, a response, or an XHR we added nothing to", (): void => {
    startRecorder();

    const aborted: XMLHttpRequest = new XMLHttpRequest();

    aborted.open("GET", "/api/a");
    aborted.send();
    aborted.dispatchEvent(new Event("abort"));
    finish(aborted, 0);

    /* The page's own xhr.timeout (axios's timeout): status 0, not a header problem. */
    const timedOut: XMLHttpRequest = new XMLHttpRequest();

    timedOut.open("GET", "/api/slow");
    timedOut.send();
    timedOut.dispatchEvent(new Event("timeout"));
    finish(timedOut, 0);

    const errored: XMLHttpRequest = new XMLHttpRequest();

    errored.open("GET", "/api/b");
    errored.send();
    finish(errored, 502);

    const untouched: XMLHttpRequest = new XMLHttpRequest();

    untouched.open("GET", "/api/c");
    untouched.setRequestHeader("traceparent", PAGE_TRACEPARENT);
    untouched.setRequestHeader("tracestate", PAGE_TRACESTATE);
    untouched.send();
    finish(untouched, 0);

    expect(debugRecords("same-origin-propagation-tripped")).toHaveLength(0);
  });
});

describe("diagnostics", (): void => {
  it("says once, at start, whether same-origin propagation is on and why", (): void => {
    installFetch();

    startRecorder();

    expect(debugRecords("same-origin-propagation")).toHaveLength(1);
    expect(debugRecords("same-origin-propagation")[0]?.level).toBe("info");
    expect(debugRecords("same-origin-propagation")[0]?.detail).toEqual({
      enabled: true,
      reason: "on",
    });

    recorder?.stop(window);
    recorder = null;
    clearDebugRecords();

    startRecorder({ policy: false });

    expect(debugRecords("same-origin-propagation")[0]?.detail).toEqual({
      enabled: false,
      reason: "policy-off",
    });
  });

  it("warns with same-origin-propagation-tripped when the breaker trips", async (): Promise<void> => {
    windowRecord["fetch"] = jest
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValue(okResponse());

    startRecorder();

    await window.fetch("/api/x");

    const tripped: Array<DebugRecord> = debugRecords(
      "same-origin-propagation-tripped",
    );

    expect(tripped).toHaveLength(1);
    expect(tripped[0]?.level).toBe("warn");
  });
});
