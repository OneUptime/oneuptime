import {
  ParsedSessionTraceState,
  parseSessionTraceState,
} from "Common/Utils/Rum/SessionTraceState";
import UrlScrubber from "Common/Utils/Rum/UrlScrubber";
import { DebugRecord, clearDebugRecords, getDebugRecords } from "../src/Debug";
import NetworkRecorder, { RecordedRequest } from "../src/NetworkRecorder";

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

/*
 * A Request stand-in. jsdom ships no Request constructor, so the page's
 * "same-realm Request" is this class installed as window.Request. It keeps
 * the semantics the recorder depends on: init.headers REPLACES the input's
 * headers, the input's body is proxied (the input becomes used), and a
 * used input throws.
 */
class FakeRequest {
  public readonly url: string;
  public readonly method: string;
  public readonly mode: string;
  public readonly headers: Headers;
  public readonly body: string | null;
  public bodyUsed: boolean = false;

  public constructor(
    input: string | FakeRequest,
    init?: {
      method?: string;
      mode?: string;
      headers?: HeadersInit;
      body?: string;
    },
  ) {
    const source: FakeRequest | null =
      input instanceof FakeRequest ? input : null;

    if (source && source.bodyUsed) {
      throw new TypeError("Request body is already used");
    }

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

  it("accepts a plain object from another realm (its prototype's prototype is null)", async (): Promise<void> => {
    const mock: FetchMock = installFetch();
    const foreignPrototype: Record<string, unknown> = Object.create(
      null,
    ) as Record<string, unknown>;
    const init: RequestInit = Object.assign(Object.create(foreignPrototype), {
      method: "PUT",
    }) as RequestInit;

    startRecorder();

    await window.fetch("/api/orders", init);

    const sent: RequestInit = mock.mock.calls[0]?.[1] as RequestInit;

    expect(sent).not.toBe(init);
    expect(sent.method).toBe("PUT");
    expect(sentHeaders(mock).get("tracestate")).toContain(SESSION_ID);
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

    windowRecord["NREUM"] = {};

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

  it("stands down while a propagating agent global is present, read at request time", async (): Promise<void> => {
    for (const agent of ["NREUM", "newrelic", "elasticApm", "DD_RUM"]) {
      const mock: FetchMock = installFetch();

      startRecorder();

      await window.fetch("/api/before-agent");

      windowRecord[agent] = {};

      try {
        await window.fetch("/api/x");
      } finally {
        delete windowRecord[agent];
      }

      expect(sentHeaders(mock, 0).get("traceparent")).toMatch(
        TRACEPARENT_SHAPE,
      );
      expect(sentHeaders(mock, 1).get("traceparent")).toBeNull();
      expect(sentHeaders(mock, 1).get("tracestate")).toBe(
        `oneuptime=sid:${SESSION_ID}`,
      );

      recorder?.stop(window);
      recorder = null;
    }
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
    windowRecord["elasticApm"] = {};

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
