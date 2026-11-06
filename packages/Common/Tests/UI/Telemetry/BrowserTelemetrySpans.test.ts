import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock, SpyInstance } from "jest-mock";
import URL from "../../../Types/API/URL";

/*
 * The spans a page's requests make once Telemetry.init has fetched the SDK: the
 * real provider, the real span processors and the real fetch and XMLHttpRequest
 * instrumentations, with only the network faked. Spans go through
 * SimpleSpanProcessor rather than waiting out BatchSpanProcessor's timer.
 *
 * The instrumentations end a span about 300 ms after its request does, to give
 * the browser's resource timing time to appear, so these wait for spans.
 */

const TELEMETRY_PATH: string = "../../../UI/Utils/Telemetry/Telemetry";
const OPENTELEMETRY_GLOBAL: symbol = Symbol.for("opentelemetry.js.api.1");
const SPAN_TIMEOUT_IN_MS: number = 30000;

/*
 * Every test here evaluates the whole SDK afresh, a second's work that took over
 * a minute on a machine busy with other builds.
 */
jest.setTimeout(180000);

interface TelemetryClass {
  init: (data: { serviceName: string }) => Promise<void>;
  setGlobalAttributes: (attributes: {
    [key: string]: string | undefined;
  }) => void;
}

interface ExportedSpan {
  name: string;
  attributes: { [key: string]: unknown };
  spanContext: () => { traceId: string; spanId: string };
  parentSpanContext?: { spanId: string } | undefined;
  resource: { attributes: { [key: string]: unknown } };
}

// jsdom has no Headers: as much of one as the fetch instrumentation calls.
class FakeHeaders {
  public readonly values: { [key: string]: string };

  public constructor(init?: { [key: string]: string }) {
    this.values = { ...init };
  }

  public set(name: string, value: string): void {
    this.values[name] = value;
  }
}

interface FetchOptions {
  headers?: { [key: string]: string } | FakeHeaders | undefined;
}

interface FakeResponse {
  status: number;
  statusText: string;
  url: string;
  clone: () => { body: null };
}

type FetchStub = (url: string, options?: FetchOptions) => Promise<FakeResponse>;

interface PageGlobals {
  fetch?: FetchStub | undefined;
  Request?: unknown;
  Headers?: unknown;
  PerformanceObserver?: unknown;
  Zone?: unknown;
  [key: symbol]: unknown;
}

const page: PageGlobals = globalThis as unknown as PageGlobals;

let exported: Array<ExportedSpan> = [];
let fetchStub: Mock<FetchStub>;
let sendStub: Mock<() => void>;
let setRequestHeader: SpyInstance<(name: string, value: string) => void>;
let nativeOpen: typeof XMLHttpRequest.prototype.open;
let nativeSend: typeof XMLHttpRequest.prototype.send;

const loadTelemetry: () => TelemetryClass = (): TelemetryClass => {
  return (jest.requireActual(TELEMETRY_PATH) as { default: TelemetryClass })
    .default;
};

const waitForSpans: (count: number) => Promise<Array<ExportedSpan>> = async (
  count: number,
): Promise<Array<ExportedSpan>> => {
  const deadline: number = Date.now() + SPAN_TIMEOUT_IN_MS;

  while (exported.length < count && Date.now() < deadline) {
    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 20);
    });
  }

  return exported;
};

// A request the way axios makes one, answered as soon as it has gone out.
const makeXhrRequest: (url: string) => XMLHttpRequest = (
  url: string,
): XMLHttpRequest => {
  const request: XMLHttpRequest = new XMLHttpRequest();

  request.open("GET", url);
  request.send();
  request.dispatchEvent(new Event("load"));

  return request;
};

const spanFor: (url: string) => ExportedSpan | undefined = (
  url: string,
): ExportedSpan | undefined => {
  return exported.find((span: ExportedSpan): boolean => {
    return String(span.attributes["http.url"]).endsWith(url);
  });
};

const traceparentFor: (span: ExportedSpan) => string = (
  span: ExportedSpan,
): string => {
  const { traceId, spanId } = span.spanContext();

  return `00-${traceId}-${spanId}-01`;
};

beforeEach(() => {
  jest.resetModules();
  exported = [];

  /*
   * jsdom has no fetch, and the fetch instrumentation does not patch one in a
   * page without PerformanceObserver. Defined first: it reads them on load.
   */
  fetchStub = jest.fn<FetchStub>((url: string): Promise<FakeResponse> => {
    return Promise.resolve({
      status: 200,
      statusText: "OK",
      url,
      clone: (): { body: null } => {
        return { body: null };
      },
    });
  });
  page.fetch = fetchStub;
  page.Request = class {};
  page.Headers = FakeHeaders;
  page.PerformanceObserver = class {
    public observe(): void {}
    public disconnect(): void {}
  };

  // Before the SDK wraps them, so a request never leaves for the network.
  nativeOpen = XMLHttpRequest.prototype.open;
  nativeSend = XMLHttpRequest.prototype.send;
  sendStub = jest.fn<() => void>();
  XMLHttpRequest.prototype.send = sendStub;
  setRequestHeader = jest.spyOn(XMLHttpRequest.prototype, "setRequestHeader");

  jest.doMock("../../../UI/Config", () => {
    return {
      __esModule: true,
      DisableTelemetry: false,
      BrowserOpenTelemetryExporterOtlpEndpoint: URL.fromString(
        "https://otlp.oneuptime.com/otlp",
      ),
      BrowserOpenTelemetryExporterOtlpIngestionKey: "browser-ingestion-key",
    };
  });

  jest.doMock("@opentelemetry/exporter-trace-otlp-http", () => {
    return {
      OTLPTraceExporter: class {
        public export(
          spans: Array<ExportedSpan>,
          done: (result: { code: number }) => void,
        ): void {
          exported.push(...spans);
          done({ code: 0 });
        }

        public shutdown(): Promise<void> {
          return Promise.resolve();
        }
      },
    };
  });

  jest.doMock("@opentelemetry/sdk-trace-web", () => {
    const actual: { SimpleSpanProcessor: unknown } = jest.requireActual(
      "@opentelemetry/sdk-trace-web",
    ) as { SimpleSpanProcessor: unknown };

    return { ...actual, BatchSpanProcessor: actual.SimpleSpanProcessor };
  });
});

afterEach(() => {
  /*
   * What the SDK left on the page: the OpenTelemetry API's global, which
   * refuses a second registration, and its wrappers around XMLHttpRequest.
   */
  delete page[OPENTELEMETRY_GLOBAL];
  XMLHttpRequest.prototype.open = nativeOpen;
  XMLHttpRequest.prototype.send = nativeSend;
  setRequestHeader.mockRestore();

  delete page.fetch;
  delete page.Request;
  delete page.Headers;
  delete page.PerformanceObserver;
});

describe("the attributes on a request's span", () => {
  test("an XMLHttpRequest made after init carries what was set before it, while the SDK loaded, and after", async () => {
    const Telemetry: TelemetryClass = loadTelemetry();

    Telemetry.setGlobalAttributes({ userId: "user-1" });

    const started: Promise<void> = Telemetry.init({ serviceName: "dashboard" });

    Telemetry.setGlobalAttributes({ projectId: "project-1" });

    await started;

    Telemetry.setGlobalAttributes({ statusPageId: "status-page-1" });

    makeXhrRequest("/api/project");

    await waitForSpans(1);

    expect(spanFor("/api/project")?.attributes).toMatchObject({
      userId: "user-1",
      projectId: "project-1",
      statusPageId: "status-page-1",
    });
  });

  test("a fetch made after init carries them too", async () => {
    const Telemetry: TelemetryClass = loadTelemetry();

    Telemetry.setGlobalAttributes({ userId: "user-1" });

    const started: Promise<void> = Telemetry.init({ serviceName: "dashboard" });

    Telemetry.setGlobalAttributes({ projectId: "project-1" });

    await started;

    await page.fetch!("/api/monitor");

    await waitForSpans(1);

    expect(spanFor("/api/monitor")?.attributes).toMatchObject({
      userId: "user-1",
      projectId: "project-1",
    });
  });

  test("a change reaches the spans of later requests and leaves earlier ones", async () => {
    const Telemetry: TelemetryClass = loadTelemetry();

    Telemetry.setGlobalAttributes({ projectId: "project-1" });

    await Telemetry.init({ serviceName: "dashboard" });

    makeXhrRequest("/api/first");

    Telemetry.setGlobalAttributes({ projectId: "project-2" });

    makeXhrRequest("/api/second");

    await waitForSpans(2);

    expect(spanFor("/api/first")?.attributes["projectId"]).toBe("project-1");
    expect(spanFor("/api/second")?.attributes["projectId"]).toBe("project-2");
  });

  test("the span names the service init was given", async () => {
    const Telemetry: TelemetryClass = loadTelemetry();

    await Telemetry.init({ serviceName: "status-page" });

    makeXhrRequest("/api/status");

    await waitForSpans(1);

    expect(spanFor("/api/status")?.resource.attributes["service.name"]).toBe(
      "status-page",
    );
  });
});

/*
 * What a context manager is for in this app, and all it is for: the span has to
 * be the active one for the moment its traceparent is written, so the server's
 * trace joins it. A provider with no context manager would send none at all.
 */
describe("the default context manager, with no zone.js", () => {
  test("an XMLHttpRequest sends its own span's traceparent", async () => {
    await loadTelemetry().init({ serviceName: "dashboard" });

    makeXhrRequest("/api/project");

    await waitForSpans(1);

    expect(setRequestHeader).toHaveBeenCalledWith(
      "traceparent",
      traceparentFor(spanFor("/api/project")!),
    );
  });

  test("a fetch sends its own span's traceparent", async () => {
    await loadTelemetry().init({ serviceName: "dashboard" });

    await page.fetch!("/api/monitor", { headers: { accept: "*/*" } });

    await waitForSpans(1);

    const sent: FetchOptions | undefined = fetchStub.mock.calls[0]![1];

    expect((sent?.headers as FakeHeaders).values).toEqual({
      accept: "*/*",
      traceparent: traceparentFor(spanFor("/api/monitor")!),
    });
  });

  test("a request made from another's callback starts a trace of its own", async () => {
    await loadTelemetry().init({ serviceName: "dashboard" });

    await page.fetch!("/api/first").then((): Promise<FakeResponse> => {
      return page.fetch!("/api/second");
    });

    await waitForSpans(2);

    const first: ExportedSpan = spanFor("/api/first")!;
    const second: ExportedSpan = spanFor("/api/second")!;

    expect(first.spanContext().traceId).not.toBe(second.spanContext().traceId);
    expect(first.parentSpanContext).toBeUndefined();
    expect(second.parentSpanContext).toBeUndefined();
  });

  test("the page's promises, timers and listeners are left as they were", async () => {
    const before: ReadonlyArray<unknown> = [
      globalThis.Promise,
      globalThis.setTimeout,
      globalThis.clearTimeout,
      globalThis.MutationObserver,
      EventTarget.prototype.addEventListener,
      XMLHttpRequest.prototype.abort,
    ];
    const madeBefore: Promise<void> = Promise.resolve();

    await loadTelemetry().init({ serviceName: "dashboard" });

    expect(page.Zone).toBeUndefined();
    expect([
      globalThis.Promise,
      globalThis.setTimeout,
      globalThis.clearTimeout,
      globalThis.MutationObserver,
      EventTarget.prototype.addEventListener,
      XMLHttpRequest.prototype.abort,
    ]).toEqual(before);
    expect(madeBefore).toBeInstanceOf(Promise);
  });
});

describe("a request made before the SDK has arrived", () => {
  test("goes out as usual and has no span", async () => {
    const started: Promise<void> = loadTelemetry().init({
      serviceName: "dashboard",
    });

    makeXhrRequest("/api/early-xhr");
    await page.fetch!("/api/early-fetch");

    await started;

    makeXhrRequest("/api/after");

    await waitForSpans(1);

    expect(sendStub).toHaveBeenCalledTimes(2);
    expect(fetchStub).toHaveBeenCalledTimes(1);
    expect(fetchStub.mock.calls[0]![1]?.headers).toBeUndefined();
    expect(spanFor("/api/early-xhr")).toBeUndefined();
    expect(spanFor("/api/early-fetch")).toBeUndefined();
    expect(spanFor("/api/after")).toBeDefined();
  });

  test("one opened before it arrives and sent after goes out with no span", async () => {
    const started: Promise<void> = loadTelemetry().init({
      serviceName: "dashboard",
    });

    const request: XMLHttpRequest = new XMLHttpRequest();
    request.open("GET", "/api/opened-early");

    await started;

    request.send();
    request.dispatchEvent(new Event("load"));

    makeXhrRequest("/api/after");

    await waitForSpans(1);

    expect(sendStub).toHaveBeenCalledTimes(2);
    expect(spanFor("/api/opened-early")).toBeUndefined();
    expect(spanFor("/api/after")).toBeDefined();
    // Only the request made after it arrived sent a traceparent.
    expect(setRequestHeader).toHaveBeenCalledTimes(1);
    expect(setRequestHeader).toHaveBeenCalledWith(
      "traceparent",
      traceparentFor(spanFor("/api/after")!),
    );
  });
});
