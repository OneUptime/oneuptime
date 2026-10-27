import { describe, expect, test } from "@jest/globals";
import SecurityEventRequestOutcome, {
  SECURITY_EVENT_REQUEST_OUTCOMES_IN_ORDER,
  getRequestOutcomeRank,
  isSecurityEventRequestOutcome,
} from "../../../Types/SecurityEvent/SecurityEventRequestOutcome";
import { getSqlInjectionMarkers } from "../../../Utils/SecurityEvent/LogParsers/WebAttackLogParser";
import {
  MAX_EVIDENCE_STATEMENT_LENGTH,
  REQUEST_SPAN_ATTRIBUTES_READ,
  RequestTraceAssessment,
  RequestTraceSpan,
  assessRequestTrace,
  decodeRequestText,
  didRequestWaitAsAsked,
  findDatabaseEvidence,
  findServerSpan,
  getMoreSeriousOutcome,
  readRequestedDelaySeconds,
  readStatusCode,
  requestOutcomeFromStatusCode,
} from "../../../Utils/SecurityEvent/RequestOutcome";

/*
 * How far a request got, read from its trace: the verdict that turns "an
 * attack string was in a log line" into "the app turned it away" or "the
 * injected SQL ran". Every rule of the verdict is pinned here on spans
 * shaped the way OpenTelemetry instrumentation writes them.
 */

function span(
  overrides: Partial<RequestTraceSpan> & { spanId: string },
): RequestTraceSpan {
  return {
    parentSpanId: "",
    name: "span",
    kind: "SPAN_KIND_INTERNAL",
    statusCode: 0,
    durationMs: 1,
    attributes: {},
    ...overrides,
  };
}

function server(
  statusCode: string,
  overrides: Partial<RequestTraceSpan> = {},
): RequestTraceSpan {
  return span({
    spanId: "server",
    name: "GET /search",
    kind: "SPAN_KIND_SERVER",
    durationMs: 12,
    ...overrides,
    attributes: {
      "http.response.status_code": statusCode,
      "http.request.method": "GET",
      "url.full": "https://shop.example.com/search?q=1' or 1=1",
      "http.route": "/search",
      "client.address": "198.51.100.7",
      "user_agent.original": "sqlmap/1.7.2#stable",
      "enduser.id": "user-42",
      ...(overrides.attributes || {}),
    },
  });
}

function assess(data: {
  spans: Array<RequestTraceSpan>;
  exceptions?: Array<{
    spanId: string;
    fingerprint: string;
    exceptionType: string;
    message: string;
  }>;
  eventSpanId?: string;
  requestText?: string;
}): RequestTraceAssessment {
  return assessRequestTrace({
    spans: data.spans,
    exceptions: data.exceptions || [],
    eventSpanId: data.eventSpanId || "",
    sqlMarkers: getSqlInjectionMarkers(),
    requestText: data.requestText || "",
  });
}

describe("SecurityEventRequestOutcome", () => {
  test("lists the outcomes least serious first, and ranks them so", () => {
    expect(SECURITY_EVENT_REQUEST_OUTCOMES_IN_ORDER).toEqual([
      SecurityEventRequestOutcome.Rejected,
      SecurityEventRequestOutcome.ReachedApp,
      SecurityEventRequestOutcome.Errored,
      SecurityEventRequestOutcome.ReachedDatabase,
    ]);
    expect(getRequestOutcomeRank(undefined)).toBe(0);
    expect(getRequestOutcomeRank("")).toBe(0);
    expect(getRequestOutcomeRank("nonsense")).toBe(0);
    expect(getRequestOutcomeRank(SecurityEventRequestOutcome.Rejected)).toBe(1);
    expect(
      getRequestOutcomeRank(SecurityEventRequestOutcome.ReachedDatabase),
    ).toBe(4);
  });

  test("knows its own values and nothing else", () => {
    for (const outcome of SECURITY_EVENT_REQUEST_OUTCOMES_IN_ORDER) {
      expect(isSecurityEventRequestOutcome(outcome)).toBe(true);
    }

    expect(isSecurityEventRequestOutcome("rejected")).toBe(false);
    expect(isSecurityEventRequestOutcome(4)).toBe(false);
    expect(isSecurityEventRequestOutcome(undefined)).toBe(false);
  });

  test("the more serious of two outcomes wins, and an absent one never does", () => {
    expect(
      getMoreSeriousOutcome(
        SecurityEventRequestOutcome.Rejected,
        SecurityEventRequestOutcome.ReachedDatabase,
      ),
    ).toBe(SecurityEventRequestOutcome.ReachedDatabase);
    expect(
      getMoreSeriousOutcome(
        SecurityEventRequestOutcome.Errored,
        SecurityEventRequestOutcome.ReachedApp,
      ),
    ).toBe(SecurityEventRequestOutcome.Errored);
    expect(
      getMoreSeriousOutcome(SecurityEventRequestOutcome.Rejected, undefined),
    ).toBe(SecurityEventRequestOutcome.Rejected);
    expect(
      getMoreSeriousOutcome(undefined, SecurityEventRequestOutcome.ReachedApp),
    ).toBe(SecurityEventRequestOutcome.ReachedApp);
    expect(getMoreSeriousOutcome(undefined, undefined)).toBeUndefined();
  });
});

describe("requestOutcomeFromStatusCode", () => {
  test.each([
    [200, SecurityEventRequestOutcome.ReachedApp],
    [204, SecurityEventRequestOutcome.ReachedApp],
    [302, SecurityEventRequestOutcome.ReachedApp],
    [400, SecurityEventRequestOutcome.Rejected],
    [401, SecurityEventRequestOutcome.Rejected],
    [403, SecurityEventRequestOutcome.Rejected],
    [404, SecurityEventRequestOutcome.Rejected],
    [429, SecurityEventRequestOutcome.Rejected],
    [500, SecurityEventRequestOutcome.Errored],
    [503, SecurityEventRequestOutcome.Errored],
  ])("%i is %s", (statusCode: number, outcome: string) => {
    expect(requestOutcomeFromStatusCode(statusCode)).toBe(outcome);
  });

  test("anything that is not an answer says nothing", () => {
    expect(requestOutcomeFromStatusCode(0)).toBeUndefined();
    expect(requestOutcomeFromStatusCode(101)).toBeUndefined();
    expect(requestOutcomeFromStatusCode(600)).toBeUndefined();
    expect(requestOutcomeFromStatusCode(404.5)).toBeUndefined();
    expect(requestOutcomeFromStatusCode(NaN)).toBeUndefined();
  });
});

describe("readStatusCode", () => {
  test("reads a status from a string or a number", () => {
    expect(readStatusCode("404")).toBe(404);
    expect(readStatusCode(" 200 ")).toBe(200);
    expect(readStatusCode(503)).toBe(503);
  });

  test("anything else is 0", () => {
    expect(readStatusCode("")).toBe(0);
    expect(readStatusCode("40")).toBe(0);
    expect(readStatusCode("4040")).toBe(0);
    expect(readStatusCode("abc")).toBe(0);
    expect(readStatusCode("099")).toBe(0);
    expect(readStatusCode(undefined)).toBe(0);
    expect(readStatusCode(null)).toBe(0);
  });
});

describe("readRequestedDelaySeconds", () => {
  test("reads the delay a time-based injection asks for, however it is written", () => {
    expect(
      readRequestedDelaySeconds(
        "/sitemap.xml?offset=1;SELECT%20IF((SLEEP(16)),1,2356)",
      ),
    ).toBe(16);
    expect(readRequestedDelaySeconds("/x?id=1 AND SLEEP%285%29")).toBe(5);
    expect(readRequestedDelaySeconds("/x?id=1;select pg_sleep(10)--")).toBe(10);
    expect(
      readRequestedDelaySeconds("/x?id=1;WAITFOR DELAY '0:0:7'--"),
    ).toBe(7);
    expect(
      readRequestedDelaySeconds("/x?id=1;waitfor delay '00:01:30'--"),
    ).toBe(90);
  });

  test("takes the longest of several", () => {
    expect(readRequestedDelaySeconds("/x?a=sleep(3)&b=sleep(12)")).toBe(12);
  });

  test("a delay too short to tell from a slow request, or absurdly long, is none", () => {
    expect(readRequestedDelaySeconds("/x?id=sleep(1)")).toBe(0);
    expect(readRequestedDelaySeconds("/x?id=sleep(0)")).toBe(0);
    expect(readRequestedDelaySeconds("/x?id=sleep(99999)")).toBe(0);
  });

  test("a request that asks for no delay asks for none", () => {
    expect(readRequestedDelaySeconds("/x?id=1 union select 1")).toBe(0);
    expect(readRequestedDelaySeconds("/sleep(")).toBe(0);
    expect(readRequestedDelaySeconds("/x?q=benchmark(1000000,md5(1))")).toBe(0);
    expect(readRequestedDelaySeconds("")).toBe(0);
  });

  test("an encoding that is not valid leaves the text as it was", () => {
    expect(decodeRequestText("/%c0%ae%c0%ae/etc/passwd")).toBe(
      "/%c0%ae%c0%ae/etc/passwd",
    );
    expect(decodeRequestText("/a+b%20c")).toBe("/a b c");
    expect(decodeRequestText("/plain")).toBe("/plain");
  });

  test("reads a megabyte of request in time that grows with it", () => {
    const text: string = "sleep(".repeat(200_000);
    const startedAt: number = Date.now();

    expect(readRequestedDelaySeconds(text)).toBe(0);
    expect(Date.now() - startedAt).toBeLessThan(2000);
  });
});

describe("didRequestWaitAsAsked", () => {
  test("a request that took about as long as its SQL asked waited", () => {
    expect(
      didRequestWaitAsAsked({ requestedDelaySeconds: 16, durationMs: 16_040 }),
    ).toBe(true);
    expect(
      didRequestWaitAsAsked({ requestedDelaySeconds: 16, durationMs: 14_500 }),
    ).toBe(true);
  });

  test("a quick answer, or one far slower than asked, did not", () => {
    expect(
      didRequestWaitAsAsked({ requestedDelaySeconds: 16, durationMs: 3 }),
    ).toBe(false);
    expect(
      didRequestWaitAsAsked({ requestedDelaySeconds: 5, durationMs: 60_000 }),
    ).toBe(false);
    expect(
      didRequestWaitAsAsked({ requestedDelaySeconds: 0, durationMs: 60_000 }),
    ).toBe(false);
    expect(
      didRequestWaitAsAsked({ requestedDelaySeconds: 5, durationMs: NaN }),
    ).toBe(false);
  });
});

describe("findServerSpan", () => {
  test("the server span the event's span runs under answers the request", () => {
    const spans: Array<RequestTraceSpan> = [
      server("200", { spanId: "edge" }),
      span({
        spanId: "api",
        parentSpanId: "client-call",
        kind: "SPAN_KIND_SERVER",
        attributes: { "http.response.status_code": "500" },
      }),
      span({
        spanId: "client-call",
        parentSpanId: "edge",
        kind: "SPAN_KIND_CLIENT",
      }),
      span({ spanId: "handler", parentSpanId: "api" }),
    ];

    expect(findServerSpan({ spans, eventSpanId: "handler" })?.spanId).toBe(
      "api",
    );
  });

  test("without the event's span, the outermost server span answers", () => {
    const spans: Array<RequestTraceSpan> = [
      span({
        spanId: "api",
        parentSpanId: "edge",
        kind: "SPAN_KIND_SERVER",
      }),
      server("200", { spanId: "edge" }),
    ];

    expect(findServerSpan({ spans, eventSpanId: "" })?.spanId).toBe("edge");
    expect(findServerSpan({ spans, eventSpanId: "missing" })?.spanId).toBe(
      "edge",
    );
  });

  test("a server span whose parent was not kept is the outermost one there is", () => {
    const spans: Array<RequestTraceSpan> = [
      span({
        spanId: "api",
        parentSpanId: "not-in-the-trace-read",
        kind: "Server",
      }),
    ];

    expect(findServerSpan({ spans, eventSpanId: "" })?.spanId).toBe("api");
  });

  test("with no server span, any span that recorded a status answers", () => {
    const spans: Array<RequestTraceSpan> = [
      span({ spanId: "a" }),
      span({
        spanId: "b",
        attributes: { "http.status_code": "403" },
      }),
    ];

    expect(findServerSpan({ spans, eventSpanId: "" })?.spanId).toBe("b");
    expect(
      findServerSpan({ spans: [span({ spanId: "a" })], eventSpanId: "" }),
    ).toBeUndefined();
  });

  test("a cycle in the parents cannot hold it", () => {
    const spans: Array<RequestTraceSpan> = [
      span({ spanId: "a", parentSpanId: "b" }),
      span({ spanId: "b", parentSpanId: "a" }),
    ];

    expect(findServerSpan({ spans, eventSpanId: "a" })).toBeUndefined();
  });
});

describe("findDatabaseEvidence", () => {
  test("a query that holds the payload is evidence, cut to a readable length", () => {
    const long: string = `SELECT * FROM products WHERE name = '1' or 1=1 ${"x".repeat(
      2000,
    )}`;
    const evidence: ReturnType<typeof findDatabaseEvidence> =
      findDatabaseEvidence({
        spans: [
          span({
            spanId: "db",
            kind: "SPAN_KIND_CLIENT",
            durationMs: 4,
            attributes: { "db.statement": long, "db.system": "mysql" },
          }),
        ],
        markers: getSqlInjectionMarkers(),
      });

    expect(evidence?.system).toBe("mysql");
    expect(evidence?.durationMs).toBe(4);
    expect(evidence?.statement.length).toBe(MAX_EVIDENCE_STATEMENT_LENGTH);
    expect(evidence?.statement.endsWith("…")).toBe(true);
  });

  test("reads the newer attribute names too", () => {
    expect(
      findDatabaseEvidence({
        spans: [
          span({
            spanId: "db",
            attributes: {
              "db.query.text": "SELECT 1 UNION SELECT password FROM users",
              "db.system.name": "postgresql",
            },
          }),
        ],
        markers: getSqlInjectionMarkers(),
      })?.system,
    ).toBe("postgresql");
  });

  test("a parameterized query holds nothing of the payload, and is no evidence", () => {
    expect(
      findDatabaseEvidence({
        spans: [
          span({
            spanId: "db",
            attributes: {
              "db.statement": "SELECT * FROM products WHERE name = $1",
            },
          }),
        ],
        markers: getSqlInjectionMarkers(),
      }),
    ).toBeUndefined();
  });

  test("the SQL markers are the decoded ones a query could hold", () => {
    const markers: Array<string> = getSqlInjectionMarkers();

    expect(markers).toContain("union select");
    expect(markers).toContain("sleep(");
    expect(
      markers.some((marker: string): boolean => {
        return marker.includes("%");
      }),
    ).toBe(false);
  });
});

describe("assessRequestTrace", () => {
  test("a probe the app answered 404 was rejected", () => {
    const assessment: RequestTraceAssessment = assess({
      spans: [server("404")],
    });

    expect(assessment.outcome).toBe(SecurityEventRequestOutcome.Rejected);
    expect(assessment.statusCode).toBe(404);
    expect(assessment.serverSpanId).toBe("server");
  });

  test("an exception a 4xx answer recorded is how the app turned the request away", () => {
    expect(
      assess({
        spans: [server("404", { statusCode: 2 })],
        exceptions: [
          {
            spanId: "server",
            fingerprint: "fp",
            exceptionType: "NotFoundException",
            message: "Page not found",
          },
        ],
      }).outcome,
    ).toBe(SecurityEventRequestOutcome.Rejected);
  });

  test("a request a handler answered reached the app", () => {
    expect(assess({ spans: [server("200")] }).outcome).toBe(
      SecurityEventRequestOutcome.ReachedApp,
    );
    expect(assess({ spans: [server("302")] }).outcome).toBe(
      SecurityEventRequestOutcome.ReachedApp,
    );
  });

  test("a 5xx, or a 2xx that recorded an exception or a failed span, errored", () => {
    expect(assess({ spans: [server("500")] }).outcome).toBe(
      SecurityEventRequestOutcome.Errored,
    );
    expect(
      assess({
        spans: [server("200")],
        exceptions: [
          {
            spanId: "server",
            fingerprint: "fp-1",
            exceptionType: "TypeError",
            message: "Cannot read properties of undefined",
          },
        ],
      }).outcome,
    ).toBe(SecurityEventRequestOutcome.Errored);
    expect(
      assess({
        spans: [server("200"), span({ spanId: "db", statusCode: 2 })],
      }).outcome,
    ).toBe(SecurityEventRequestOutcome.Errored);
  });

  test("a trace with no answer errored only when something failed", () => {
    expect(
      assess({ spans: [span({ spanId: "a", statusCode: 2 })] }).outcome,
    ).toBe(SecurityEventRequestOutcome.Errored);
    expect(assess({ spans: [span({ spanId: "a" })] }).outcome).toBeUndefined();
  });

  test("a query that holds the payload reached the database, whatever the app answered", () => {
    const assessment: RequestTraceAssessment = assess({
      spans: [
        server("404"),
        span({
          spanId: "db",
          parentSpanId: "server",
          kind: "SPAN_KIND_CLIENT",
          durationMs: 3,
          attributes: {
            "db.statement":
              "SELECT * FROM products WHERE id = 1' or 1=1 LIMIT 10",
            "db.system": "mysql",
          },
        }),
      ],
    });

    expect(assessment.outcome).toBe(
      SecurityEventRequestOutcome.ReachedDatabase,
    );
    expect(assessment.database?.statement).toContain("' or 1=1");
  });

  test("a request that waited as long as its SQL asked reached the database", () => {
    const assessment: RequestTraceAssessment = assess({
      spans: [server("200", { durationMs: 16_020 })],
      requestText: "/sitemap.xml?offset=1;SELECT%20IF((SLEEP(16)),1,2356)",
    });

    expect(assessment.outcome).toBe(
      SecurityEventRequestOutcome.ReachedDatabase,
    );
    expect(assessment.requestedDelaySeconds).toBe(16);
  });

  test("a quick answer to a time-based probe did not wait, and records no delay", () => {
    const assessment: RequestTraceAssessment = assess({
      spans: [server("404", { durationMs: 3 })],
      requestText: "/sitemap.xml?offset=1;SELECT%20IF((SLEEP(16)),1,2356)",
    });

    expect(assessment.outcome).toBe(SecurityEventRequestOutcome.Rejected);
    expect(assessment.requestedDelaySeconds).toBe(0);
  });

  test("reads who sent the request and what it was from the server span", () => {
    const assessment: RequestTraceAssessment = assess({
      spans: [server("200")],
    });

    expect(assessment.method).toBe("GET");
    expect(assessment.url).toBe("https://shop.example.com/search?q=1' or 1=1");
    expect(assessment.route).toBe("/search");
    expect(assessment.clientAddress).toBe("198.51.100.7");
    expect(assessment.userAgent).toBe("sqlmap/1.7.2#stable");
    expect(assessment.userId).toBe("user-42");
    expect(assessment.durationMs).toBe(12);
  });

  test("builds the URL from its path and query when the span names no full one", () => {
    expect(
      assess({
        spans: [
          span({
            spanId: "s",
            kind: "SPAN_KIND_SERVER",
            attributes: {
              "url.path": "/search",
              "url.query": "q=1",
              "http.response.status_code": "200",
            },
          }),
        ],
      }).url,
    ).toBe("/search?q=1");
  });

  test("reads the older attribute names instrumentation still writes", () => {
    const assessment: RequestTraceAssessment = assess({
      spans: [
        span({
          spanId: "s",
          kind: "SPAN_KIND_SERVER",
          attributes: {
            "http.status_code": "403",
            "http.method": "POST",
            "http.target": "/login",
            "net.peer.ip": "203.0.113.9",
            "http.user_agent": "hydra",
          },
        }),
      ],
    });

    expect(assessment.outcome).toBe(SecurityEventRequestOutcome.Rejected);
    expect(assessment.method).toBe("POST");
    expect(assessment.url).toBe("/login");
    expect(assessment.clientAddress).toBe("203.0.113.9");
    expect(assessment.userAgent).toBe("hydra");
  });

  test("names the first exception the trace recorded", () => {
    expect(
      assess({
        spans: [server("500")],
        exceptions: [
          {
            spanId: "server",
            fingerprint: "fp-1",
            exceptionType: "QueryFailedError",
            message: "syntax error at or near \"or\"",
          },
          {
            spanId: "server",
            fingerprint: "fp-2",
            exceptionType: "Error",
            message: "second",
          },
        ],
      }).exception?.fingerprint,
    ).toBe("fp-1");
  });

  test("every attribute the verdict reads is one the reader asks the database for", () => {
    for (const key of [
      "http.response.status_code",
      "http.status_code",
      "client.address",
      "db.statement",
      "db.query.text",
      "enduser.id",
      "url.query",
    ]) {
      expect(REQUEST_SPAN_ATTRIBUTES_READ).toContain(key);
    }

    expect(new Set(REQUEST_SPAN_ATTRIBUTES_READ).size).toBe(
      REQUEST_SPAN_ATTRIBUTES_READ.length,
    );
  });
});
