import { describe, expect, test } from "@jest/globals";
import SecurityEvent from "Common/Models/AnalyticsModels/SecurityEvent";
import {
  Amber500,
  Gray500,
  Green500,
  Orange,
  Red,
} from "Common/Types/BrandColors";
import { JSONObject } from "Common/Types/JSON";
import SecurityEventRequestOutcome, {
  SECURITY_REQUEST_ATTRIBUTES,
} from "Common/Types/SecurityEvent/SecurityEventRequestOutcome";
import { resolveClientAddress } from "Common/Utils/SecurityEvent/ClientAddressTrust";
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
  SENSITIVE_FILE_SENT_AS,
} from "../../FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventRequestCopy";
import { WEB_SENSITIVE_FILE_ANSWER_ATTRIBUTE } from "Common/Utils/SecurityEvent/LogParsers/WebAttackLogParser";
import { SensitiveFileAnswer } from "Common/Utils/SecurityEvent/SensitiveFileProbe";

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
    hiddenClientAddress: null,
    claimedClientAddress: null,
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
    sensitiveFileAnswer: null,
    responseBodySize: null,
    responseContentType: "",
    ...overrides,
  };
}

/*
 * A fresh read of the trace, its server span naming its client by the
 * connection's own address (the peer): verified (ClientAddressTrust).
 */
function assessment(
  overrides: Partial<RequestTraceAssessment> = {},
): RequestTraceAssessment {
  const clientAddress: string = overrides.clientAddress ?? "198.51.100.7";

  return {
    outcome: SecurityEventRequestOutcome.ReachedApp,
    serverSpanId: "server",
    statusCode: 200,
    method: "get",
    url: "/search?q=1",
    route: "/search",
    clientAddress,
    client: resolveClientAddress({ peer: clientAddress }),
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
        database: {
          system: "postgresql",
          statement: "SELECT 1",
          durationMs: 2,
        },
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
    expect(getRequestOutcomeColor(SecurityEventRequestOutcome.ReachedApp)).toBe(
      Amber500,
    );
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

/*
 * A REQUEST FOR A FILE THAT HOLDS SECRETS (#10912): the panel says what the
 * site sent - the file itself and why OneUptime says so, its own page,
 * nothing, or what the record cannot say - where it says what happened
 * next.
 */
describe("what a site sent for a request for a file that holds secrets", () => {
  function say(overrides: Partial<SecurityEventRequestFacts>): string {
    return describeWhatHappenedNext({
      facts: facts(overrides),
      hasTrace: false,
      translator: ENGLISH,
    });
  }

  test("reads what the event says of it", () => {
    const read: SecurityEventRequestFacts = readSecurityEventRequestFacts(
      event({
        requestOutcome: SecurityEventRequestOutcome.ReachedApp,
        attributes: {
          [WEB_SENSITIVE_FILE_ANSWER_ATTRIBUTE]: SensitiveFileAnswer.File,
          [SECURITY_REQUEST_ATTRIBUTES.responseBodySize]: "412",
          [SECURITY_REQUEST_ATTRIBUTES.responseContentType]: "text/plain",
          [SECURITY_REQUEST_ATTRIBUTES.statusCode]: "200",
        },
      }),
    );

    expect(read.sensitiveFileAnswer).toBe(SensitiveFileAnswer.File);
    expect(read.responseBodySize).toBe(412);
    expect(read.responseContentType).toBe("text/plain");
  });

  test("an answer that is none, and an event of no such request, read as none", () => {
    const read: SecurityEventRequestFacts = readSecurityEventRequestFacts(
      event({
        attributes: { [WEB_SENSITIVE_FILE_ANSWER_ATTRIBUTE]: "maybe" },
      }),
    );

    expect(read.sensitiveFileAnswer).toBeNull();
    expect(read.responseBodySize).toBeNull();
    expect(read.responseContentType).toBe("");
    expect(
      readSecurityEventRequestFacts(event({})).sensitiveFileAnswer,
    ).toBeNull();
  });

  test("the file itself, by its type", () => {
    expect(
      say({
        outcome: SecurityEventRequestOutcome.ReachedApp,
        statusCode: 200,
        sensitiveFileAnswer: SensitiveFileAnswer.File,
        responseBodySize: 412,
        responseContentType: "text/plain",
      }),
    ).toBe(
      "Your site sent the file itself: it answered 200 OK with text/plain, not a web page.",
    );
  });

  test("the file itself, by its size beside the 404s of the paths the site doesn't have", () => {
    expect(
      say({
        outcome: SecurityEventRequestOutcome.ReachedApp,
        statusCode: 200,
        sensitiveFileAnswer: SensitiveFileAnswer.File,
        responseBodySize: 412,
      }),
    ).toBe(
      "Your site sent the file itself: it answered 200 OK with 412 bytes, while it answers 404 for the paths it doesn't have.",
    );
    expect(
      say({
        outcome: SecurityEventRequestOutcome.ReachedApp,
        statusCode: 206,
        sensitiveFileAnswer: SensitiveFileAnswer.File,
        responseBodySize: 1,
      }),
    ).toBe(
      "Your site sent the file itself: it answered 206 with 1 byte, while it answers 404 for the paths it doesn't have.",
    );
  });

  test("the site's own page: it doesn't have the file - never 'turned away' after a 200", () => {
    const sentence: string = say({
      outcome: SecurityEventRequestOutcome.Rejected,
      statusCode: 200,
      sensitiveFileAnswer: SensitiveFileAnswer.OwnPage,
      responseBodySize: 1789,
      responseContentType: "text/html",
    });

    expect(sentence).toBe(
      "Your site doesn't have the file: it answered 200 OK with a page of its own, as it does for any path it doesn't have.",
    );
    expect(sentence).not.toContain("turned it away");
  });

  test("nothing sent", () => {
    expect(
      say({
        outcome: SecurityEventRequestOutcome.Rejected,
        statusCode: 200,
        sensitiveFileAnswer: SensitiveFileAnswer.Empty,
        responseBodySize: 0,
      }),
    ).toBe("Your site sent nothing: it answered 200 OK with an empty body.");
  });

  test("a firewall event that cannot say what the origin sent", () => {
    expect(
      say({
        outcome: SecurityEventRequestOutcome.ReachedApp,
        statusCode: 200,
        sensitiveFileAnswer: SensitiveFileAnswer.Unconfirmed,
      }),
    ).toBe(
      "OneUptime can't tell whether your site sent the file: it answered 200 OK, and the record says nothing of what it sent.",
    );
  });

  test("a refusal reads as any request turned away", () => {
    expect(
      say({
        outcome: SecurityEventRequestOutcome.Rejected,
        statusCode: 404,
        sensitiveFileAnswer: SensitiveFileAnswer.Refused,
      }),
    ).toBe("The app turned it away: it answered 404 Not Found.");
  });

  test("a request that broke something says that, which says more", () => {
    expect(
      say({
        outcome: SecurityEventRequestOutcome.Errored,
        statusCode: 200,
        exceptionType: "TypeError",
        sensitiveFileAnswer: SensitiveFileAnswer.OwnPage,
      }),
    ).toBe("It broke something: the app answered 200 OK and threw TypeError.");
  });

  test("a fresh read of the trace never turns the site's own page into reaching the app, nor drops what was sent", () => {
    for (const answer of [
      SensitiveFileAnswer.OwnPage,
      SensitiveFileAnswer.Empty,
    ]) {
      const merged: SecurityEventRequestFacts = mergeAssessment(
        facts({
          outcome: SecurityEventRequestOutcome.Rejected,
          statusCode: 200,
          sensitiveFileAnswer: answer,
          responseBodySize: 1789,
        }),
        assessment({ outcome: SecurityEventRequestOutcome.ReachedApp }),
      );

      expect(merged.outcome).toBe(SecurityEventRequestOutcome.Rejected);
      expect(merged.sensitiveFileAnswer).toBe(answer);
      expect(merged.responseBodySize).toBe(1789);
    }

    // ...but one that broke something does say so.
    expect(
      mergeAssessment(
        facts({
          outcome: SecurityEventRequestOutcome.Rejected,
          sensitiveFileAnswer: SensitiveFileAnswer.OwnPage,
        }),
        assessment({ outcome: SecurityEventRequestOutcome.Errored }),
      ).outcome,
    ).toBe(SecurityEventRequestOutcome.Errored);

    // The file itself, read again, reached the app.
    expect(
      mergeAssessment(
        facts({
          outcome: SecurityEventRequestOutcome.Rejected,
          sensitiveFileAnswer: SensitiveFileAnswer.File,
        }),
        assessment({ outcome: SecurityEventRequestOutcome.ReachedApp }),
      ).outcome,
    ).toBe(SecurityEventRequestOutcome.ReachedApp);
  });

  test("each sentence is looked up whole, the type as written", () => {
    const asked: Array<string> = [];
    const recording: Translator = createTranslator(
      (key: string): string | undefined => {
        asked.push(key);
        return key === SENSITIVE_FILE_SENT_AS
          ? "Ihre Website hat die Datei selbst gesendet: {{status}} als {{type}}."
          : undefined;
      },
      "de",
    );

    expect(
      describeWhatHappenedNext({
        facts: facts({
          outcome: SecurityEventRequestOutcome.ReachedApp,
          statusCode: 200,
          sensitiveFileAnswer: SensitiveFileAnswer.File,
          responseContentType: "text/plain",
        }),
        hasTrace: false,
        translator: recording,
      }),
    ).toBe(
      "Ihre Website hat die Datei selbst gesendet: 200 OK als text/plain.",
    );
    expect(asked).toContain(SENSITIVE_FILE_SENT_AS);
  });
});
