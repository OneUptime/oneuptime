import UrlScrubber from "Common/Utils/Rum/UrlScrubber";
import NetworkRecorder, {
  NetworkRecorderOptions,
  RecordedRequest,
} from "../src/NetworkRecorder";

/*
 * The REAL @opentelemetry/instrumentation-fetch (0.220, a test-only
 * devDependency of this package, never bundled) inside the recorder's
 * wrapper - the order the docs recommend: the page imports OpenTelemetry
 * first, the recorder loads asynchronously and wraps outside it.
 *
 * Pinned here because the recorder's stand-down and read-back are built on
 * OpenTelemetry's actual behaviour, not on a description of it: shimmer's
 * non-enumerable `__wrapped` marker, and `options.headers = new
 * Headers(...)` + set() for the traceparent it injects. If a future version
 * changes either, this is the test that says so.
 *
 * In its own file because the instrumentation registers process-wide
 * OpenTelemetry globals (propagator, context manager, tracer provider).
 */

declare function require(id: string): unknown;

interface OtelModules {
  WebTracerProvider: new (config: Record<string, unknown>) => {
    register: () => void;
    shutdown: () => Promise<void>;
  };
  FetchInstrumentation: new (config: Record<string, unknown>) => {
    setTracerProvider: (provider: unknown) => void;
    enable: () => void;
    disable: () => void;
  };
}

const SESSION_ID: string = "0123456789abcdef0123456789abcdef";
const TRACEPARENT_SHAPE: RegExp = /^00-([0-9a-f]{32})-([0-9a-f]{16})-01$/;

const globalRecord: Record<string, unknown> = globalThis as unknown as Record<
  string,
  unknown
>;

/*
 * OpenTelemetry tests `args[0] instanceof Request` on every call, and jsdom
 * has no Request global, so a minimal one stands in for the platform's.
 */
class PlatformRequest {
  public readonly url: string;
  public readonly headers: Headers;

  public constructor(input: string) {
    this.url = input;
    this.headers = new Headers();
  }
}

describe("NetworkRecorder around the real OpenTelemetry FetchInstrumentation", (): void => {
  let wire: Array<{ input: unknown; headers: Headers }> = [];
  let completed: Array<{
    request: RecordedRequest;
    rollupTraceId: string | null;
  }> = [];
  let recorder: NetworkRecorder | null = null;
  let instrumentation: { disable: () => void } | null = null;
  let otelFetch: unknown = null;
  let savedFetch: unknown;

  beforeAll((): void => {
    savedFetch = globalRecord["fetch"];

    /* OpenTelemetry's web instrumentations only enable with this present. */
    globalRecord["PerformanceObserver"] = class {
      public static supportedEntryTypes: Array<string> = [];
      public observe(): void {}
      public disconnect(): void {}
    };

    globalRecord["Request"] = PlatformRequest;
  });

  afterAll((): void => {
    delete globalRecord["PerformanceObserver"];
    delete globalRecord["Request"];
    globalRecord["fetch"] = savedFetch;
  });

  /*
   * The page's OpenTelemetry (with this FetchInstrumentation config) inside,
   * then the recorder (with these options) outside it.
   */
  function install(
    instrumentationConfig: Record<string, unknown> = {},
    recorderOptions: Partial<NetworkRecorderOptions> = {},
  ): void {
    wire = [];
    completed = [];

    /* The "native" fetch, which is what OpenTelemetry wraps. */
    globalRecord["fetch"] = (
      input: unknown,
      init?: RequestInit,
    ): Promise<Response> => {
      wire.push({
        input: input,
        headers: new Headers(init ? init.headers : undefined),
      });

      return Promise.resolve({
        status: 200,
        headers: new Headers(),
        clone: function (this: Response): Response {
          return this;
        },
      } as unknown as Response);
    };

    const otel: OtelModules = {
      ...(require("@opentelemetry/sdk-trace-web") as Pick<
        OtelModules,
        "WebTracerProvider"
      >),
      ...(require("@opentelemetry/instrumentation-fetch") as Pick<
        OtelModules,
        "FetchInstrumentation"
      >),
    };

    const provider: { register: () => void } = new otel.WebTracerProvider({
      spanProcessors: [],
    });

    provider.register();

    const fetchInstrumentation: {
      setTracerProvider: (provider: unknown) => void;
      enable: () => void;
      disable: () => void;
    } = new otel.FetchInstrumentation({
      ...instrumentationConfig,
      enabled: false,
    });

    fetchInstrumentation.setTracerProvider(provider);
    fetchInstrumentation.enable();
    instrumentation = fetchInstrumentation;
    otelFetch = globalRecord["fetch"];

    recorder = new NetworkRecorder({
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
        return UrlScrubber.scrub(url);
      },
      isSelfRequest: (): boolean => {
        return false;
      },
      sameOriginTracePropagation: true,
      getSessionIdForPropagation: (): string | null => {
        return SESSION_ID;
      },
      ...recorderOptions,
    });

    recorder.start(window);
  }

  beforeEach((): void => {
    install();
  });

  /* Tear down the default setup and install another. */
  function reinstall(
    instrumentationConfig: Record<string, unknown>,
    recorderOptions: Partial<NetworkRecorderOptions>,
  ): void {
    recorder?.stop(window);
    instrumentation?.disable();
    install(instrumentationConfig, recorderOptions);
  }

  afterEach((): void => {
    recorder?.stop(window);
    recorder = null;
    instrumentation?.disable();
    instrumentation = null;
  });

  it("sees OpenTelemetry's wrapper as shimmer marks it: a non-enumerable __wrapped", (): void => {
    const marked: Record<string, unknown> = otelFetch as Record<
      string,
      unknown
    >;

    expect(marked["__wrapped"]).toBe(true);
    expect(Object.keys(marked)).not.toContain("__wrapped");

    /* Ours is outside it, and bind() would not have copied the marker. */
    expect(globalRecord["fetch"]).not.toBe(otelFetch);
  });

  it("leaves the traceparent to OpenTelemetry, adds the session, and records the id on the wire", async (): Promise<void> => {
    const shapes: Array<RequestInit | undefined> = [
      undefined,
      { headers: { "x-a": "1" } },
      { headers: new Headers({ "x-a": "1" }) },
      { headers: [["x-a", "1"]] },
      { method: "POST", body: "{}", headers: { "x-a": "1" } },
    ];

    for (const init of shapes) {
      await window.fetch("/api/orders", init);
    }

    expect(wire).toHaveLength(shapes.length);

    wire.forEach(
      (sent: { input: unknown; headers: Headers }, index: number): void => {
        const traceparent: string = sent.headers.get("traceparent") || "";

        /* ONE traceparent, OpenTelemetry's - never two values joined. */
        expect(traceparent).toMatch(TRACEPARENT_SHAPE);

        /* The session rides along, without p: the parent is OTel's span. */
        expect(sent.headers.get("tracestate")).toBe(
          `oneuptime=sid:${SESSION_ID}`,
        );

        if (shapes[index]?.headers) {
          expect(sent.headers.get("x-a")).toBe("1");
        }

        /*
         * The recorder's id IS the id on the wire (it used to record its
         * own, or none at all), and it is reported like a page-set id.
         */
        const wireTraceId: string | undefined =
          TRACEPARENT_SHAPE.exec(traceparent)?.[1];

        expect(completed[index]?.request.traceId).toBe(wireTraceId);
        expect(completed[index]?.rollupTraceId).toBe(wireTraceId);
      },
    );
  });

  it("still records OpenTelemetry's id with same-origin propagation off, from the page's own init", async (): Promise<void> => {
    recorder?.stop(window);

    recorder = new NetworkRecorder({
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
      sameOriginTracePropagation: false,
    });

    recorder.start(window);

    await window.fetch("/api/orders", { headers: { "x-a": "1" } });

    const wireTraceId: string | undefined = TRACEPARENT_SHAPE.exec(
      wire[0]?.headers.get("traceparent") || "",
    )?.[1];

    expect(wireTraceId).toBeDefined();
    expect(wire[0]?.headers.get("tracestate")).toBeNull();
    expect(completed[0]?.rollupTraceId).toBe(wireTraceId);
  });

  /*
   * fetch(url) with NO init on a request the recorder adds nothing to.
   * OpenTelemetry builds its own `args[1] || {}` and sets its traceparent
   * there, so the recorder's read-back used to find nothing: the request
   * went out with OpenTelemetry's traceparent, and the network row had no
   * trace id to join the backend on. The recorder now hands it an empty
   * init it keeps.
   */
  const expectWireIdRecorded: (label: string) => void = (
    label: string,
  ): void => {
    const wireTraceId: string | undefined = TRACEPARENT_SHAPE.exec(
      wire[0]?.headers.get("traceparent") || "",
    )?.[1];

    expect([label, wireTraceId]).toEqual([label, expect.any(String)]);
    expect([label, completed[0]?.request.traceId]).toEqual([
      label,
      wireTraceId,
    ]);
    expect([label, completed[0]?.rollupTraceId]).toEqual([label, wireTraceId]);
  };

  it("records OpenTelemetry's id for fetch(url) with no init, same-origin propagation off", async (): Promise<void> => {
    reinstall({}, { sameOriginTracePropagation: false });

    await window.fetch("/api/orders");

    expect(wire[0]?.headers.get("tracestate")).toBeNull();
    expectWireIdRecorded("policy off");
  });

  it("records OpenTelemetry's id for fetch(url) with no init while the session is not uploading", async (): Promise<void> => {
    reinstall(
      {},
      {
        getSessionIdForPropagation: (): string | null => {
          return null;
        },
      },
    );

    await window.fetch("/api/orders");
    await window.fetch(new URL("https://shop.example.com/api/items"));

    expect(wire[0]?.headers.get("tracestate")).toBeNull();
    expectWireIdRecorded("not uploading, string");

    wire.shift();
    completed.shift();

    expectWireIdRecorded("not uploading, URL");
  });

  it("records OpenTelemetry's id for fetch(url) with no init to an API only OpenTelemetry propagates to", async (): Promise<void> => {
    reinstall(
      { propagateTraceHeaderCorsUrls: [/api\.other\.example/] },
      { tracePropagationOrigins: [] },
    );

    await window.fetch("https://api.other.example/v2/items");

    expect(wire[0]?.headers.get("tracestate")).toBeNull();
    expectWireIdRecorded("cross-origin, OpenTelemetry's list only");
  });
});
