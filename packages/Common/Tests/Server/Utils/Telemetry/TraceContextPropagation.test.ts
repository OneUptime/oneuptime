import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";
import {
  Span,
  SpanKind,
  SpanStatusCode,
  context,
  propagation,
  trace,
} from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  ReadableSpan,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { EventEmitter } from "events";
import TraceContextPropagation, {
  resolvePropagationHosts,
  serverSpanName,
  shouldTraceIncomingRequest,
} from "../../../../Server/Utils/Telemetry/TraceContextPropagation";
import API, { OutgoingRequest } from "../../../../Utils/API";
import HTTPResponse from "../../../../Types/API/HTTPResponse";
import HTTPErrorResponse from "../../../../Types/API/HTTPErrorResponse";
import HTTPMethod from "../../../../Types/API/HTTPMethod";
import { JSONObject } from "../../../../Types/JSON";
import Dictionary from "../../../../Types/Dictionary";
import {
  ExpressRequest,
  ExpressResponse,
} from "../../../../Server/Utils/Express";
import getJestMockFunction, { MockFunction } from "../../../MockType";

/*
 * OneUptime's processes only show up connected on a service map when an
 * incoming request joins its caller's trace and an outgoing request hands
 * its trace on. These tests drive both halves through a real OpenTelemetry
 * tracer, W3C propagator and async context manager.
 *
 * The outgoing half shares a client with monitor checks, webhooks and
 * workflow calls to customer endpoints, so the allowlist tests matter as much
 * as the propagation ones: a customer endpoint must never receive a header it
 * did not configure.
 */

const exporter: InMemorySpanExporter = new InMemorySpanExporter();
const provider: BasicTracerProvider = new BasicTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(exporter)],
});
const contextManager: AsyncLocalStorageContextManager =
  new AsyncLocalStorageContextManager();

const CALLER_TRACE_ID: string = "4bf92f3577b34da6a3ce929d0e0e4736";
const CALLER_SPAN_ID: string = "00f067aa0ba902b7";

beforeAll(() => {
  contextManager.enable();
  context.setGlobalContextManager(contextManager);
  propagation.setGlobalPropagator(new W3CTraceContextPropagator());
  trace.setGlobalTracerProvider(provider);
});

afterAll(() => {
  trace.disable();
  propagation.disable();
  context.disable();
});

beforeEach(() => {
  exporter.reset();
  TraceContextPropagation.setActiveOverride(true);
  TraceContextPropagation.resetPropagationHosts({
    ONEUPTIME_URL: "http://oneuptime-app.oneuptime.svc.cluster.local:3002",
    HOST: "status.example.com",
  });
});

afterEach(() => {
  TraceContextPropagation.setActiveOverride(null);
  TraceContextPropagation.resetPropagationHosts();
  API.setOutgoingRequestTracer(null);
});

interface FakeResponse extends EventEmitter {
  statusCode: number;
}

function fakeRequest(
  overrides: Partial<ExpressRequest> & JSONObject,
): ExpressRequest {
  return {
    method: "POST",
    path: "/probe-ingest/response",
    hostname: "oneuptime-app.oneuptime.svc.cluster.local",
    protocol: "http",
    headers: {},
    ...overrides,
  } as unknown as ExpressRequest;
}

function fakeResponse(statusCode: number): FakeResponse {
  const response: FakeResponse = new EventEmitter() as FakeResponse;
  response.statusCode = statusCode;
  return response;
}

function finishedSpans(): Array<ReadableSpan> {
  return exporter.getFinishedSpans();
}

describe("resolvePropagationHosts", () => {
  test("collects OneUptime's own hosts from URLs and hostnames", () => {
    expect(
      Array.from(
        resolvePropagationHosts({
          ONEUPTIME_URL: "https://oneuptime.example.com/",
          PROBE_INGEST_URL: "http://ingest.internal:3400/probe-ingest",
          TELEMETRY_WRITER_URL:
            "http://oneuptime-telemetry-writer.oneuptime.svc.cluster.local:3300",
          HOST: "OneUptime.Example.com",
          SERVER_APP_HOSTNAME: "app",
          SERVER_HOME_HOSTNAME: "home",
          OPENTELEMETRY_TRACE_PROPAGATION_HOSTS: " gateway.internal , ,api:80 ",
        }),
      ).sort(),
    ).toEqual(
      [
        "api",
        "app",
        "gateway.internal",
        "home",
        "ingest.internal",
        "oneuptime-telemetry-writer.oneuptime.svc.cluster.local",
        "oneuptime.example.com",
      ].sort(),
    );
  });

  test("never allows loopback, where unset hostname variables default", () => {
    expect(
      Array.from(
        resolvePropagationHosts({
          SERVER_APP_HOSTNAME: "localhost",
          ONEUPTIME_URL: "http://127.0.0.1:3002",
        }),
      ),
    ).toEqual([]);
  });
});

describe("shouldTraceIncomingRequest", () => {
  test.each([
    ["GET", "/api/monitor/get-list", true],
    ["POST", "/otlp/v1/traces", true],
    ["OPTIONS", "/api/monitor/get-list", false],
    ["HEAD", "/", false],
    ["GET", "/status/live", false],
    ["GET", "/api/status/ready", false],
    ["GET", "/metrics", false],
    ["GET", "/dashboard/assets/app.3f9a.js", false],
    ["GET", "/fonts/inter.woff2", false],
    ["GET", "/status-page/overview", true],
  ])("%s %s → %s", (method: string, path: string, expected: boolean) => {
    expect(shouldTraceIncomingRequest({ method, path })).toBe(expected);
  });
});

describe("serverSpanName", () => {
  test("uses the matched route template, never the raw path", () => {
    expect(
      serverSpanName({
        method: "get",
        baseUrl: "/api/monitor",
        route: { path: "/:id" },
      }),
    ).toEqual({ name: "GET /api/monitor/:id", route: "/api/monitor/:id" });
  });

  test("falls back to the method when nothing matched", () => {
    expect(serverSpanName({ method: "post" })).toEqual({
      name: "POST",
      route: null,
    });
  });
});

describe("incoming requests", () => {
  test("continue the caller's trace in a SERVER span", async () => {
    const request: ExpressRequest = fakeRequest({
      headers: {
        traceparent: `00-${CALLER_TRACE_ID}-${CALLER_SPAN_ID}-01`,
      },
    });
    const response: FakeResponse = fakeResponse(200);
    let activeTraceId: string | undefined = undefined;

    TraceContextPropagation.incomingRequestMiddleware(
      request,
      response as unknown as ExpressResponse,
      () => {
        activeTraceId = trace.getActiveSpan()?.spanContext().traceId;
        (request as unknown as { route: { path: string } }).route = {
          path: "/response",
        };
        (request as unknown as { baseUrl: string }).baseUrl = "/probe-ingest";
      },
    );
    response.emit("finish");
    response.emit("close");

    expect(activeTraceId).toBe(CALLER_TRACE_ID);
    const spans: Array<ReadableSpan> = finishedSpans();
    expect(spans).toHaveLength(1);
    const span: ReadableSpan = spans[0]!;
    expect(span.kind).toBe(SpanKind.SERVER);
    expect(span.spanContext().traceId).toBe(CALLER_TRACE_ID);
    expect(span.parentSpanContext?.spanId).toBe(CALLER_SPAN_ID);
    expect(span.name).toBe("POST /probe-ingest/response");
    expect(span.attributes).toMatchObject({
      "http.request.method": "POST",
      "http.route": "/probe-ingest/response",
      "http.response.status_code": 200,
      "server.address": "oneuptime-app.oneuptime.svc.cluster.local",
    });
    expect(span.status.code).not.toBe(SpanStatusCode.ERROR);
  });

  test("start a new trace when the caller sent none", () => {
    const response: FakeResponse = fakeResponse(204);
    TraceContextPropagation.incomingRequestMiddleware(
      fakeRequest({}),
      response as unknown as ExpressResponse,
      () => {},
    );
    response.emit("finish");
    const span: ReadableSpan = finishedSpans()[0]!;
    expect(span.parentSpanContext).toBeUndefined();
    expect(span.name).toBe("POST");
  });

  test("mark only 5xx answers as errors", () => {
    for (const status of [404, 503]) {
      const response: FakeResponse = fakeResponse(status);
      TraceContextPropagation.incomingRequestMiddleware(
        fakeRequest({}),
        response as unknown as ExpressResponse,
        () => {},
      );
      response.emit("finish");
    }
    const [clientError, serverError]: Array<ReadableSpan> = finishedSpans();
    expect(clientError!.status.code).not.toBe(SpanStatusCode.ERROR);
    expect(serverError!.status.code).toBe(SpanStatusCode.ERROR);
  });

  test("spans nested work under the request", () => {
    const response: FakeResponse = fakeResponse(200);
    TraceContextPropagation.incomingRequestMiddleware(
      fakeRequest({}),
      response as unknown as ExpressResponse,
      () => {
        trace
          .getTracer("test")
          .startActiveSpan("DatabaseService.findBy", (child: Span) => {
            child.end();
          });
      },
    );
    response.emit("finish");
    const [child, server]: Array<ReadableSpan> = finishedSpans();
    expect(child!.name).toBe("DatabaseService.findBy");
    expect(child!.parentSpanContext?.spanId).toBe(server!.spanContext().spanId);
  });

  test("do nothing when span export is off or the request is ignored", () => {
    const next: MockFunction = getJestMockFunction();
    TraceContextPropagation.setActiveOverride(false);
    TraceContextPropagation.incomingRequestMiddleware(
      fakeRequest({}),
      fakeResponse(200) as unknown as ExpressResponse,
      next as unknown as () => void,
    );
    TraceContextPropagation.setActiveOverride(true);
    TraceContextPropagation.incomingRequestMiddleware(
      fakeRequest({ method: "GET", path: "/status/live" }),
      fakeResponse(200) as unknown as ExpressResponse,
      next as unknown as () => void,
    );
    expect(next).toHaveBeenCalledTimes(2);
    expect(finishedSpans()).toHaveLength(0);
  });
});

describe("outgoing requests", () => {
  function captureTracer(): {
    run: (
      url: string,
      result?: HTTPResponse<JSONObject> | Error,
    ) => Promise<Dictionary<string>>;
  } {
    TraceContextPropagation.installOutgoingRequestTracer();
    const tracer: {
      trace: <T>(
        request: OutgoingRequest,
        send: () => Promise<T>,
      ) => Promise<T>;
    } = (
      API as unknown as {
        outgoingRequestTracer: {
          trace: <T>(
            request: OutgoingRequest,
            send: () => Promise<T>,
          ) => Promise<T>;
        };
      }
    ).outgoingRequestTracer;
    return {
      run: async (
        url: string,
        result?: HTTPResponse<JSONObject> | Error,
      ): Promise<Dictionary<string>> => {
        const headers: Dictionary<string> = {};
        const send: () => Promise<HTTPResponse<JSONObject>> = async () => {
          if (result instanceof Error) {
            throw result;
          }
          return result || new HTTPResponse<JSONObject>(200, {}, {});
        };
        await tracer
          .trace({ method: HTTPMethod.POST, url, headers }, send)
          .catch(() => {});
        return headers;
      },
    };
  }

  test("inject traceparent and record a CLIENT span for OneUptime hosts", async () => {
    const { run } = captureTracer();
    const headers: Dictionary<string> = await run(
      "http://oneuptime-app.oneuptime.svc.cluster.local:3002/probe-ingest/response?token=secret",
    );

    const span: ReadableSpan = finishedSpans()[0]!;
    expect(span.kind).toBe(SpanKind.CLIENT);
    expect(headers["traceparent"]).toBe(
      `00-${span.spanContext().traceId}-${span.spanContext().spanId}-01`,
    );
    expect(span.attributes).toEqual({
      "http.request.method": "POST",
      "server.address": "oneuptime-app.oneuptime.svc.cluster.local",
      "server.port": 3002,
      "url.scheme": "http",
      "http.response.status_code": 200,
    });
    // No path, query string or credentials ever reach the span.
    expect(JSON.stringify(span.attributes)).not.toContain("secret");
  });

  test("continue the active trace", async () => {
    const { run } = captureTracer();
    let parentSpanId: string = "";
    let headers: Dictionary<string> = {};
    await trace
      .getTracer("test")
      .startActiveSpan("ProbeIngest.send", async (parent: Span) => {
        parentSpanId = parent.spanContext().spanId;
        headers = await run("https://status.example.com/api/probe/alive");
        parent.end();
      });
    const client: ReadableSpan | undefined = finishedSpans().find(
      (span: ReadableSpan) => {
        return span.kind === SpanKind.CLIENT;
      },
    );
    expect(client?.parentSpanContext?.spanId).toBe(parentSpanId);
    expect(headers["traceparent"]).toContain(client!.spanContext().traceId);
  });

  test("leave customer endpoints untouched", async () => {
    const { run } = captureTracer();
    const headers: Dictionary<string> = await run(
      "https://hooks.customer.example/webhook/abc",
    );
    expect(headers).toEqual({});
    expect(finishedSpans()).toHaveLength(0);
  });

  test("leave every endpoint untouched when span export is off", async () => {
    const { run } = captureTracer();
    TraceContextPropagation.setActiveOverride(false);
    const headers: Dictionary<string> = await run(
      "https://status.example.com/api/probe/alive",
    );
    expect(headers).toEqual({});
    expect(finishedSpans()).toHaveLength(0);
  });

  test("mark HTTP error answers and thrown failures as errors", async () => {
    const { run } = captureTracer();
    await run(
      "https://status.example.com/api/x",
      new HTTPErrorResponse(502, {}, {}),
    );
    await run("https://status.example.com/api/y", new Error("ECONNRESET"));
    const [badGateway, reset]: Array<ReadableSpan> = finishedSpans();
    expect(badGateway!.attributes["http.response.status_code"]).toBe(502);
    expect(badGateway!.status.code).toBe(SpanStatusCode.ERROR);
    expect(reset!.status.code).toBe(SpanStatusCode.ERROR);
  });
});
