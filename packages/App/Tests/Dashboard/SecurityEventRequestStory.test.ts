import { describe, expect, test } from "@jest/globals";
import SecurityEvent from "Common/Models/AnalyticsModels/SecurityEvent";
import { Amber500, Gray500, Green500, Orange, Red } from "Common/Types/BrandColors";
import { JSONObject } from "Common/Types/JSON";
import SecurityEventRequestOutcome, {
  SECURITY_REQUEST_ATTRIBUTES,
} from "Common/Types/SecurityEvent/SecurityEventRequestOutcome";
import { RequestTraceAssessment } from "Common/Utils/SecurityEvent/RequestOutcome";
import {
  Translator,
  createTranslator,
} from "Common/UI/Utils/TranslateTemplate";
import {
  SecurityEventRequestFacts,
  describeRequest,
  describeWhatHappenedNext,
  formatRequestDuration,
  formatStatus,
  getRequestOutcomeColor,
  mergeAssessment,
  readSecurityEventRequestFacts,
} from "../../FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventRequestStory";
import {
  ERRORED,
  NOT_FOLLOWED_WITH_TRACE,
  REACHED_APP_IN,
  REJECTED_IN,
} from "../../FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventRequestCopy";

/*
 * What happened next, as the event panel says it: the facts a followed
 * request left on its event, completed by a fresh read of the trace, and
 * one sentence per outcome. Every branch of the sentence is pinned here in
 * English, and shown going through the reader's translator whole.
 */

const ENGLISH: Translator = createTranslator(undefined, "en");

function event(
  fields: Partial<SecurityEvent> & { attributes?: JSONObject } = {},
): SecurityEvent {
  return Object.assign(new SecurityEvent(), fields);
}

function facts(
  overrides: Partial<SecurityEventRequestFacts> = {},
): SecurityEventRequestFacts {
  return {
    outcome: undefined,
    statusCode: 0,
    method: "",
    url: "",
    route: "",
    clientAddress: "",
    userAgent: "",
    userId: "",
    durationMs: 0,
    serverSpanId: "",
    exceptionFingerprint: "",
    exceptionType: "",
    exceptionMessage: "",
    databaseSystem: "",
    databaseStatement: "",
    requestedDelaySeconds: 0,
    ...overrides,
  };
}

function assessment(
  overrides: Partial<RequestTraceAssessment> = {},
): RequestTraceAssessment {
  return {
    outcome: SecurityEventRequestOutcome.ReachedApp,
    serverSpanId: "server",
    statusCode: 200,
    method: "get",
    url: "/search?q=1",
    route: "/search",
    clientAddress: "198.51.100.7",
    userAgent: "sqlmap",
    userId: "user-42",
    durationMs: 12,
    exception: undefined,
    database: undefined,
    requestedDelaySeconds: 0,
    ...overrides,
  };
}

describe("readSecurityEventRequestFacts", () => {
  test("reads what a followed request left on its event", () => {
    const read: SecurityEventRequestFacts = readSecurityEventRequestFacts(
      event({
        requestOutcome: SecurityEventRequestOutcome.Errored,
        attributes: {
          [SECURITY_REQUEST_ATTRIBUTES.statusCode]: "500",
          [SECURITY_REQUEST_ATTRIBUTES.method]: "POST",
          [SECURITY_REQUEST_ATTRIBUTES.url]: "/api/orders",
          [SECURITY_REQUEST_ATTRIBUTES.route]: "/api/orders",
          [SECURITY_REQUEST_ATTRIBUTES.clientAddress]: "198.51.100.7",
          [SECURITY_REQUEST_ATTRIBUTES.userAgent]: "curl/8",
          [SECURITY_REQUEST_ATTRIBUTES.userId]: "user-42",
          [SECURITY_REQUEST_ATTRIBUTES.durationMs]: "45",
          [SECURITY_REQUEST_ATTRIBUTES.serverSpanId]: "server",
          [SECURITY_REQUEST_ATTRIBUTES.exceptionFingerprint]: "fp",
          [SECURITY_REQUEST_ATTRIBUTES.exceptionType]: "TypeError",
          [SECURITY_REQUEST_ATTRIBUTES.exceptionMessage]: "boom",
          [SECURITY_REQUEST_ATTRIBUTES.databaseSystem]: "mysql",
          [SECURITY_REQUEST_ATTRIBUTES.databaseStatement]: "SELECT 1",
          [SECURITY_REQUEST_ATTRIBUTES.requestedDelaySeconds]: "16",
        },
      }),
    );

    expect(read).toEqual(
      facts({
        outcome: SecurityEventRequestOutcome.Errored,
        statusCode: 500,
        method: "POST",
        url: "/api/orders",
        route: "/api/orders",
        clientAddress: "198.51.100.7",
        userAgent: "curl/8",
        userId: "user-42",
        durationMs: 45,
        serverSpanId: "server",
        exceptionFingerprint: "fp",
        exceptionType: "TypeError",
        exceptionMessage: "boom",
        databaseSystem: "mysql",
        databaseStatement: "SELECT 1",
        requestedDelaySeconds: 16,
      }),
    );
  });

  test("an event nobody followed says nothing, and its own address stands in", () => {
    expect(
      readSecurityEventRequestFacts(event({ principalIp: "203.0.113.9" })),
    ).toEqual(facts({ clientAddress: "203.0.113.9" }));
  });

  test("an outcome the event does not know is no outcome", () => {
    expect(
      readSecurityEventRequestFacts(event({ requestOutcome: "Exploded" }))
        .outcome,
    ).toBeUndefined();
  });

  test("numbers that are not numbers read as none", () => {
    const read: SecurityEventRequestFacts = readSecurityEventRequestFacts(
      event({
        attributes: {
          [SECURITY_REQUEST_ATTRIBUTES.durationMs]: "soon",
          [SECURITY_REQUEST_ATTRIBUTES.statusCode]: "OK",
          [SECURITY_REQUEST_ATTRIBUTES.requestedDelaySeconds]: "-3",
        },
      }),
    );

    expect(read.durationMs).toBe(0);
    expect(read.statusCode).toBe(0);
    expect(read.requestedDelaySeconds).toBe(0);
  });
});

describe("mergeAssessment", () => {
  test("a fresh read completes an event nobody followed", () => {
    const merged: SecurityEventRequestFacts = mergeAssessment(
      facts(),
      assessment(),
    );

    expect(merged.outcome).toBe(SecurityEventRequestOutcome.ReachedApp);
    expect(merged.method).toBe("GET");
    expect(merged.statusCode).toBe(200);
    expect(merged.clientAddress).toBe("198.51.100.7");
    expect(merged.serverSpanId).toBe("server");
  });

  test("what the event already said stands, and the outcome only gets worse", () => {
    const merged: SecurityEventRequestFacts = mergeAssessment(
      facts({
        outcome: SecurityEventRequestOutcome.Errored,
        statusCode: 500,
        clientAddress: "203.0.113.9",
      }),
      assessment({
        outcome: SecurityEventRequestOutcome.Rejected,
        statusCode: 404,
      }),
    );

    expect(merged.outcome).toBe(SecurityEventRequestOutcome.Errored);
    expect(merged.statusCode).toBe(500);
    expect(merged.clientAddress).toBe("203.0.113.9");
  });

  test("a worse outcome from the read wins, with its evidence", () => {
    const merged: SecurityEventRequestFacts = mergeAssessment(
      facts({ outcome: SecurityEventRequestOutcome.Rejected }),
      assessment({
        outcome: SecurityEventRequestOutcome.ReachedDatabase,
        database: { system: "postgresql", statement: "SELECT 1", durationMs: 2 },
        exception: {
          spanId: "s",
          fingerprint: "fp",
          exceptionType: "QueryFailedError",
          message: "syntax error",
        },
      }),
    );

    expect(merged.outcome).toBe(SecurityEventRequestOutcome.ReachedDatabase);
    expect(merged.databaseSystem).toBe("postgresql");
    expect(merged.exceptionFingerprint).toBe("fp");
  });

  test("no read leaves the facts as they were", () => {
    const original: SecurityEventRequestFacts = facts({ method: "GET" });

    expect(mergeAssessment(original, null)).toBe(original);
  });
});

describe("the words", () => {
  test("each outcome has its colour, and none is grey", () => {
    expect(getRequestOutcomeColor(SecurityEventRequestOutcome.Rejected)).toBe(
      Green500,
    );
    expect(
      getRequestOutcomeColor(SecurityEventRequestOutcome.ReachedApp),
    ).toBe(Amber500);
    expect(getRequestOutcomeColor(SecurityEventRequestOutcome.Errored)).toBe(
      Orange,
    );
    expect(
      getRequestOutcomeColor(SecurityEventRequestOutcome.ReachedDatabase),
    ).toBe(Red);
    expect(getRequestOutcomeColor(undefined)).toBe(Gray500);
  });

  test("a status reads as HTTP writes it", () => {
    expect(formatStatus(404)).toBe("404 Not Found");
    expect(formatStatus(500)).toBe("500 Internal Server Error");
    expect(formatStatus(418)).toBe("418");
  });

  test("a duration reads in the units a request is read in", () => {
    expect(formatRequestDuration(0, ENGLISH)).toBe("");
    expect(formatRequestDuration(0.3, ENGLISH)).toBe("1 ms");
    expect(formatRequestDuration(3.4, ENGLISH)).toBe("3 ms");
    expect(formatRequestDuration(245, ENGLISH)).toBe("245 ms");
    expect(formatRequestDuration(1240, ENGLISH)).toBe("1.2 s");
    expect(formatRequestDuration(16031, ENGLISH)).toBe("16 s");
  });

  test("the request reads as one line, its route when its address is long", () => {
    expect(describeRequest(facts({ method: "GET", url: "/search?q=1" }))).toBe(
      "GET /search?q=1",
    );
    expect(
      describeRequest(
        facts({
          method: "GET",
          url: `/search?q=${"a".repeat(200)}`,
          route: "/search",
        }),
      ),
    ).toBe("GET /search");
    expect(describeRequest(facts())).toBe("");
  });
});

describe("describeWhatHappenedNext", () => {
  function say(
    overrides: Partial<SecurityEventRequestFacts>,
    hasTrace: boolean = true,
  ): string {
    return describeWhatHappenedNext({
      facts: facts(overrides),
      hasTrace,
      translator: ENGLISH,
    });
  }

  test("turned away", () => {
    expect(
      say({
        outcome: SecurityEventRequestOutcome.Rejected,
        statusCode: 404,
        durationMs: 3,
      }),
    ).toBe("The app turned it away: it answered 404 Not Found in 3 ms.");
    expect(
      say({ outcome: SecurityEventRequestOutcome.Rejected, statusCode: 403 }),
    ).toBe("The app turned it away: it answered 403 Forbidden.");
  });

  test("reached the app", () => {
    expect(
      say({
        outcome: SecurityEventRequestOutcome.ReachedApp,
        statusCode: 200,
        durationMs: 45,
      }),
    ).toBe(
      "A handler ran and answered 200 OK in 45 ms. Open the trace to see what it did.",
    );
  });

  test("broke something, with what it threw", () => {
    expect(
      say({
        outcome: SecurityEventRequestOutcome.Errored,
        statusCode: 500,
        exceptionType: "QueryFailedError",
      }),
    ).toBe(
      "It broke something: the app answered 500 Internal Server Error and threw QueryFailedError.",
    );
    expect(
      say({
        outcome: SecurityEventRequestOutcome.Errored,
        exceptionType: "TypeError",
      }),
    ).toBe("It broke something: the request threw TypeError.");
    expect(
      say({ outcome: SecurityEventRequestOutcome.Errored, statusCode: 502 }),
    ).toBe("It broke something: the app answered 502 Bad Gateway.");
    expect(say({ outcome: SecurityEventRequestOutcome.Errored })).toBe(ERRORED);
  });

  test("reached the database, by a query or by the time it took", () => {
    expect(
      say({
        outcome: SecurityEventRequestOutcome.ReachedDatabase,
        databaseStatement: "SELECT 1",
        databaseSystem: "mysql",
      }),
    ).toBe("The injected SQL ran: a mysql query the request made holds it.");
    expect(
      say({
        outcome: SecurityEventRequestOutcome.ReachedDatabase,
        databaseStatement: "SELECT 1",
      }),
    ).toBe("The injected SQL ran: a query the request made holds it.");
    expect(
      say({
        outcome: SecurityEventRequestOutcome.ReachedDatabase,
        durationMs: 16031,
        requestedDelaySeconds: 16,
      }),
    ).toBe(
      "The injected SQL ran: the request took 16 s, as long as its SQL asked the database to wait.",
    );
  });

  test("a trace with no answer says so; no trace says nothing", () => {
    expect(say({})).toBe(NOT_FOLLOWED_WITH_TRACE);
    expect(say({}, false)).toBe("");
  });

  test("each sentence is looked up whole, with its values filled after", () => {
    const asked: Array<string> = [];
    const recording: Translator = createTranslator(
      (key: string): string | undefined => {
        asked.push(key);
        return key === REJECTED_IN
          ? "Abgewiesen: {{status}} nach {{duration}}."
          : undefined;
      },
      "de",
    );

    expect(
      describeWhatHappenedNext({
        facts: facts({
          outcome: SecurityEventRequestOutcome.Rejected,
          statusCode: 404,
          durationMs: 3,
        }),
        hasTrace: true,
        translator: recording,
      }),
    ).toBe("Abgewiesen: 404 Not Found nach 3 ms.");
    expect(asked).toContain(REJECTED_IN);
    expect(asked).not.toContain(REACHED_APP_IN);
  });
});
