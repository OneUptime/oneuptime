import { describe, expect, test } from "@jest/globals";
import { Statement } from "../../../Server/Utils/AnalyticsDatabase/Statement";
import { SECURITY_AUTOMATIC_RESPONSE_LIBRARY_RULES } from "../../../Server/Utils/SecurityAutomaticResponse/SecurityAutomaticResponseRules";
import SigmaClickhouseCompiler from "../../../Server/Utils/SecurityEvent/Sigma/SigmaClickhouseCompiler";
import { JSONObject } from "../../../Types/JSON";
import { DetectionRuleDataKind } from "../../../Types/SecurityEvent/DetectionRuleDataKind";
import {
  DETECTION_RULE_LIBRARY,
  DetectionRuleLibraryCategory,
  DetectionRuleLibraryEntry,
  RECOMMENDED_DETECTION_RULE_IDS,
  SCANNING_FOR_SENSITIVE_FILES_RULE_ID,
  SENSITIVE_FILE_SERVED_RULE_ID,
  getDetectionRuleLibraryEntry,
} from "../../../Types/SecurityEvent/DetectionRuleLibrary";
import { getDetectionRuleLibraryResponseSteps } from "../../../Types/SecurityEvent/DetectionRuleLibraryResponseSteps";
import NormalizedSecurityEvent from "../../../Types/SecurityEvent/NormalizedSecurityEvent";
import OcsfSeverity, {
  OcsfSeverityId,
} from "../../../Types/SecurityEvent/OcsfSeverity";
import { getRealTimeDetectionProblem } from "../../../Types/SecurityEvent/RealTimeDetection";
import SecurityEventRequestOutcome, {
  SECURITY_REQUEST_ATTRIBUTES,
} from "../../../Types/SecurityEvent/SecurityEventRequestOutcome";
import SigmaRule from "../../../Types/SecurityEvent/SigmaRule";
import { SECURITY_LOG_RESOURCE_ID_ATTRIBUTE } from "../../../Types/SecurityCase/SecurityConnection";
import CloudflareNormalizer from "../../../Utils/SecurityEvent/Connectors/CloudflareNormalizer";
import SecurityLogParser, {
  matchesSecurityLogPrefilter,
} from "../../../Utils/SecurityEvent/LogParsers/SecurityLogParser";
import {
  SENSITIVE_FILE_SERVED_LABEL,
  WEB_ATTACK_KIND_ATTRIBUTE,
  WEB_SENSITIVE_FILE_ANSWER_ATTRIBUTE,
  WEB_SENSITIVE_FILE_PATH_ATTRIBUTE,
  WebAttackKind,
  outcomeForSensitiveFile,
  severityForSensitiveFile,
} from "../../../Utils/SecurityEvent/LogParsers/WebAttackLogParser";
import {
  getSensitiveFileRequestPath,
  getSensitiveFileSiteKey,
  judgeSensitiveFileAnswers,
  keepSensitiveFileOutcomes,
} from "../../../Utils/SecurityEvent/SensitiveFileAnswers";
import {
  SENSITIVE_FILE_PROBE_PATHS,
  SENSITIVE_FILE_PROBE_WORDS,
  SENSITIVE_FILE_SECRET_WORDS,
  SERVED_STATUS_LOG_WORDS,
  SensitiveFileAnswer,
  SensitiveFileProbePath,
  isSensitiveFileAnswer,
  readBodySize,
  readContentType,
  readSensitiveFileProbe,
  readSensitiveFileRequest,
} from "../../../Utils/SecurityEvent/SensitiveFileProbe";
import SigmaRuleParser from "../../../Utils/SecurityEvent/Sigma/SigmaRuleParser";
import SigmaRuleSetParser from "../../../Utils/SecurityEvent/Sigma/SigmaRuleSetParser";
import {
  TraceScanSpan,
  buildTraceWebAttackEvent,
} from "../../../Utils/SecurityEvent/TelemetryScan/TraceSignals";
import { readStatementValues } from "../../Helpers/StatementEcho";
import {
  CLOUDFLARE_ZONE,
  MANAGED_RULE_LOG,
} from "./Connectors/CloudflareFixtures";
import { logLine } from "./LogParsers/LogParserFixtures";
import { sigmaRuleMatchesEvent } from "./LogParsers/SigmaTestMatcher";

/*
 * A SENSITIVE FILE THE SITE SERVED (#10912).
 *
 * A 200 for /.env is a leak - or a single-page app's page for every path
 * it does not have, which answers /.env with a 200 too. Pinned here, from
 * the request to the case:
 *
 *   - what each answer is: the file by its type, the site's own page,
 *     nothing, a script the site ran, or unconfirmed;
 *   - what decides an unconfirmed one: the same size answering two
 *     different paths is the site's own page; a size no other path got, on
 *     a site that answers 404 for what it does not have, is the file;
 *   - three sites, as their access logs read: one that leaks its .env, a
 *     single-page app, and a WordPress site - and the rules over them:
 *     "Sensitive file served" fires on the leak only, "Scanning for
 *     sensitive files" on every scanner, the single-page app's included;
 *   - the same from a trace, and from Cloudflare, whose firewall events
 *     never say what the origin sent;
 *   - the rule as the library holds it.
 */

const SCANNER: string = "198.51.100.23";
const SITE: string = "0192f1a0-0000-7000-8000-00000000a001";
const OTHER_SITE: string = "0192f1a0-0000-7000-8000-00000000a002";

// A line of nginx's combined log format: the body's size after the status.
function clf(data: {
  ip?: string;
  method?: string;
  target: string;
  status: number;
  size: number | "-";
}): string {
  return `${data.ip || SCANNER} - - [24/Nov/2026:10:45:00 +0000] "${data.method || "GET"} ${data.target} HTTP/1.1" ${data.status} ${data.size} "-" "Mozilla/5.0 zgrab/0.x"`;
}

let lineNumber: number = 0;

// What the log scan reads of a page of one site's logs, and what it stores of it.
function scan(
  bodies: Array<string>,
  resourceId: string = SITE,
): Array<NormalizedSecurityEvent> {
  const events: Array<NormalizedSecurityEvent> = [];

  for (const body of bodies) {
    // Only what the database hands the scan is read.
    if (!matchesSecurityLogPrefilter(body)) {
      continue;
    }

    lineNumber++;

    for (const event of SecurityLogParser.parse({
      ...logLine(
        body,
        {},
        `0192f1a0-0000-7000-8000-${String(lineNumber).padStart(12, "0")}`,
      ),
      resourceId,
      resourceType: "Service",
    })) {
      events.push(event);
    }
  }

  return events;
}

function store(bodies: Array<string>): Array<NormalizedSecurityEvent> {
  return judgeSensitiveFileAnswers(scan(bodies));
}

function answerOf(event: NormalizedSecurityEvent): string {
  return String(event.attributes[WEB_SENSITIVE_FILE_ANSWER_ATTRIBUTE] || "");
}

function byTarget(
  events: Array<NormalizedSecurityEvent>,
): Record<string, string> {
  const answers: Record<string, string> = {};

  for (const event of events) {
    answers[getSensitiveFileRequestPath(event)] = answerOf(event);
  }

  return answers;
}

function ruleOf(id: string): SigmaRule {
  return SigmaRuleParser.parse(getDetectionRuleLibraryEntry(id)!.sigmaRuleYaml);
}

const SERVED_RULE: SigmaRule = ruleOf(SENSITIVE_FILE_SERVED_RULE_ID);
const SCANNING_RULE: SigmaRule = ruleOf(SCANNING_FOR_SENSITIVE_FILES_RULE_ID);

function servedRuleFiresOn(
  events: Array<NormalizedSecurityEvent>,
): Array<string> {
  return events
    .filter((event: NormalizedSecurityEvent): boolean => {
      return sigmaRuleMatchesEvent(SERVED_RULE, event);
    })
    .map((event: NormalizedSecurityEvent): string => {
      return getSensitiveFileRequestPath(event);
    });
}

// The distinct paths "Scanning for sensitive files" counts of one address.
function scanningCount(
  events: Array<NormalizedSecurityEvent>,
  address: string = SCANNER,
): number {
  return new Set(
    events
      .filter((event: NormalizedSecurityEvent): boolean => {
        return (
          event.principalIp === address &&
          sigmaRuleMatchesEvent(SCANNING_RULE, event)
        );
      })
      .map((event: NormalizedSecurityEvent): string => {
        return String(event.attributes[WEB_SENSITIVE_FILE_PATH_ATTRIBUTE]);
      }),
  ).size;
}

describe("what a site answered a request for a sensitive path with", () => {
  function answer(
    target: string,
    statusCode: number,
    response: { contentType?: string; bodySize?: number | null } = {},
  ): string | null {
    return (
      readSensitiveFileRequest({ target, statusCode, ...response })?.answer ||
      null
    );
  }

  test.each([400, 401, 403, 404, 405, 410, 429])(
    "a %p for any sensitive path is refused, as a probe always was",
    (status: number) => {
      for (const target of ["/.env", "/wp-admin/", "/server-status"]) {
        expect(answer(target, status)).toBe(SensitiveFileAnswer.Refused);
      }
    },
  );

  test("the file itself, by a type a web page never has, and not empty", () => {
    for (const contentType of [
      "text/plain",
      "text/plain; charset=utf-8",
      "TEXT/PLAIN",
      "application/octet-stream",
      "application/x-sh",
      "text/x-ini",
      "application/xml",
    ]) {
      expect({
        contentType,
        answer: answer("/.env", 200, { contentType, bodySize: 412 }),
      }).toEqual({ contentType, answer: SensitiveFileAnswer.File });
    }

    expect(
      answer("/.git/config", 200, {
        contentType: "text/plain",
        bodySize: null,
      }),
    ).toBe(SensitiveFileAnswer.File);
    // A range of the file is the file too.
    expect(
      answer("/.aws/credentials", 206, {
        contentType: "application/octet-stream",
        bodySize: 100,
      }),
    ).toBe(SensitiveFileAnswer.File);
  });

  test("a web page is the site's own, never the file", () => {
    for (const contentType of [
      "text/html",
      "text/html; charset=UTF-8",
      "application/xhtml+xml",
      '["text/html; charset=utf-8"]',
    ]) {
      expect({
        contentType,
        answer: answer("/.env", 200, { contentType, bodySize: 1789 }),
      }).toEqual({ contentType, answer: SensitiveFileAnswer.OwnPage });
    }
  });

  test("JSON is the file only where the file is JSON: an API's own answer otherwise", () => {
    expect(
      answer("/.env", 200, { contentType: "application/json", bodySize: 40 }),
    ).toBe(SensitiveFileAnswer.OwnPage);
    expect(
      answer("/.git/config", 200, {
        contentType: "application/problem+json",
        bodySize: 40,
      }),
    ).toBe(SensitiveFileAnswer.OwnPage);
    expect(
      answer("/.vscode/sftp-config.json", 200, {
        contentType: "application/json",
        bodySize: 300,
      }),
    ).toBe(SensitiveFileAnswer.File);
    expect(
      answer("/actuator/env", 200, {
        contentType: "application/vnd.spring-boot.actuator.v3+json",
        bodySize: 9000,
      }),
    ).toBe(SensitiveFileAnswer.File);
    expect(
      answer("/actuator/heapdump", 200, {
        contentType: "application/octet-stream",
        bodySize: 90000000,
      }),
    ).toBe(SensitiveFileAnswer.File);
  });

  test("nothing sent is nothing taken: a body of none, No Content, a HEAD's", () => {
    expect(answer("/.env", 200, { bodySize: 0 })).toBe(
      SensitiveFileAnswer.Empty,
    );
    expect(
      answer("/.env", 200, { bodySize: 0, contentType: "text/plain" }),
    ).toBe(SensitiveFileAnswer.Empty);
    expect(answer("/.env", 204)).toBe(SensitiveFileAnswer.Empty);
  });

  test("a size and no type says neither: unconfirmed, for the batch to decide", () => {
    expect(answer("/.env", 200, { bodySize: 412 })).toBe(
      SensitiveFileAnswer.Unconfirmed,
    );
    expect(answer("/.env", 200)).toBe(SensitiveFileAnswer.Unconfirmed);
    expect(answer("/wp-config.php.bak", 200, { bodySize: 3100 })).toBe(
      SensitiveFileAnswer.Unconfirmed,
    );
  });

  test("a script the server runs answers with what it printed: no probe and no leak - unless its type says it sent the script's text", () => {
    // WordPress runs wp-config.php, and it prints nothing.
    expect(answer("/wp-config.php", 200, { bodySize: 0 })).toBeNull();
    expect(answer("/wp-config.php", 200, { bodySize: 1523 })).toBeNull();
    expect(
      answer("/wp-config.php", 200, {
        contentType: "text/html",
        bodySize: 1523,
      }),
    ).toBeNull();
    expect(answer("/wp-config.php", 200)).toBeNull();
    // A server that does not run PHP sends it as a file: its secrets with it.
    expect(
      answer("/wp-config.php", 200, {
        contentType: "application/octet-stream",
        bodySize: 3100,
      }),
    ).toBe(SensitiveFileAnswer.File);
    expect(
      answer("/wp-config.php", 200, {
        contentType: "application/x-httpd-php",
        bodySize: 3100,
      }),
    ).toBe(SensitiveFileAnswer.File);
    // ...and a copy left beside it is no script at all.
    expect(
      answer("/wp-config.php.bak", 200, {
        contentType: "application/x-trash",
        bodySize: 3100,
      }),
    ).toBe(SensitiveFileAnswer.File);
    // A refusal of it is a probe as ever.
    expect(answer("/wp-config.php", 403)).toBe(SensitiveFileAnswer.Refused);
  });

  test("an admin page a site serves is never read for what it sent", () => {
    for (const target of [
      "/wp-admin/",
      "/wp-login.php",
      "/phpmyadmin/",
      "/server-status",
      "/server-info",
      "/phpinfo.php",
    ]) {
      for (const response of [
        {},
        { contentType: "text/plain", bodySize: 412 },
        { contentType: "text/html", bodySize: 4512 },
        { bodySize: 0 },
      ]) {
        expect({ target, answer: answer(target, 200, response) }).toEqual({
          target,
          answer: null,
        });
      }
    }
  });

  test.each([100, 301, 302, 304, 307, 500, 502, 503, 0])(
    "a %p is no answer to read: sent on, broken, or not recorded",
    (status: number) => {
      expect(
        answer("/.env", status, { contentType: "text/plain", bodySize: 412 }),
      ).toBeNull();
    },
  );

  test("no sensitive path, no answer", () => {
    expect(
      answer("/index.html", 200, { contentType: "text/plain", bodySize: 1 }),
    ).toBeNull();
    expect(answer("/blog/.env-tips", 200, { bodySize: 1 })).toBeNull();
    expect(answer("/search?q=/.env", 200, { bodySize: 1 })).toBeNull();
  });

  test("a probe is read as before: a 4xx's path, and nothing else", () => {
    expect(readSensitiveFileProbe({ target: "/.env", statusCode: 404 })).toBe(
      "/.env",
    );
    expect(
      readSensitiveFileProbe({ target: "/.env", statusCode: 200 }),
    ).toBeNull();
  });

  test("each answer is one the events say", () => {
    for (const value of Object.values(SensitiveFileAnswer)) {
      expect(isSensitiveFileAnswer(value)).toBe(true);
    }

    expect(isSensitiveFileAnswer("served")).toBe(false);
    expect(isSensitiveFileAnswer(undefined)).toBe(false);
  });
});

describe("what an answer carried, as a source records it", () => {
  test("a type, without its parameters and in lower case - from a header, or the list OpenTelemetry records it as", () => {
    expect(readContentType("text/html; charset=utf-8")).toBe("text/html");
    expect(readContentType(" Application/Octet-Stream ")).toBe(
      "application/octet-stream",
    );
    expect(readContentType('["text/plain; charset=utf-8"]')).toBe("text/plain");
    expect(readContentType(["text/plain"])).toBe("text/plain");
    expect(readContentType("[not json")).toBe("");
    expect(readContentType("")).toBe("");
    expect(readContentType(undefined)).toBe("");
    expect(readContentType(42)).toBe("");
    expect(readContentType(`text/${"x".repeat(300)}`)).toBe("");
  });

  test("a size in bytes: common log format's dash is none", () => {
    expect(readBodySize("412")).toBe(412);
    expect(readBodySize(412)).toBe(412);
    expect(readBodySize("0")).toBe(0);
    expect(readBodySize("-")).toBe(0);
    expect(readBodySize(" 17 ")).toBe(17);
    for (const value of [
      "",
      "abc",
      "1e3",
      "-5",
      "4.2",
      "1234567890123456",
      -1,
      1.5,
      null,
      undefined,
    ]) {
      expect({ value, size: readBodySize(value) }).toEqual({
        value,
        size: null,
      });
    }
  });

  test("every file that holds secrets is read beside a 2xx, and no admin page is", () => {
    const secretPaths: Array<SensitiveFileProbePath> =
      SENSITIVE_FILE_PROBE_PATHS.filter(
        (path: SensitiveFileProbePath): boolean => {
          return path.holdsSecrets;
        },
      );

    expect(
      secretPaths.map((path: SensitiveFileProbePath): string => {
        return path.path;
      }),
    ).toEqual([
      "/.env",
      "/.git",
      "/.svn",
      "/.hg",
      "/.aws",
      "/.ssh",
      "/.vscode",
      "/.htpasswd",
      "/.npmrc",
      "/wp-config.php",
      "/web.config",
      "/actuator/env",
    ]);

    for (const path of secretPaths) {
      for (const pattern of path.patterns) {
        const written: string = `/${pattern.names.join("/")}`;
        expect({
          path: path.path,
          read: SENSITIVE_FILE_SECRET_WORDS.some((word: string): boolean => {
            return written.toLowerCase().startsWith(word);
          }),
        }).toEqual({ path: path.path, read: true });
      }
    }

    for (const word of SENSITIVE_FILE_SECRET_WORDS) {
      expect(SENSITIVE_FILE_PROBE_WORDS).toContain(word);
    }

    for (const word of [
      "/wp-admin",
      "/wp-login.php",
      "/phpmyadmin",
      "/server-status",
      "/server-info",
      "/phpinfo.php",
    ]) {
      expect(SENSITIVE_FILE_SECRET_WORDS).not.toContain(word);
    }

    expect(SERVED_STATUS_LOG_WORDS).toContain('" 2');
  });
});

describe("the log scan's prefilter", () => {
  test("hands over a 2xx for a file that holds secrets, in a common log format line and a JSON one", () => {
    for (const body of [
      clf({ target: "/.env", status: 200, size: 412 }),
      clf({ target: "/.git/config", status: 206, size: 92 }),
      '{"remote_addr":"198.51.100.23","request":"GET /.env HTTP/1.1","status":200,"body_bytes_sent":412}',
      '{"request":{"uri":"/.aws/credentials"},"status": 200,"size":116}',
      '{"remote_ip":"198.51.100.23","uri":"/.npmrc","status_code":"200"}',
    ]) {
      expect({ body, read: matchesSecurityLogPrefilter(body) }).toEqual({
        body,
        read: true,
      });
    }
  });

  test("never an admin page a site serves, nor a redirect", () => {
    for (const body of [
      clf({ target: "/wp-admin/", status: 200, size: 4512 }),
      clf({ target: "/wp-login.php", status: 200, size: 4512 }),
      clf({ target: "/phpmyadmin/", status: 200, size: 9000 }),
      clf({ target: "/server-status", status: 200, size: 3000 }),
      clf({ target: "/.env", status: 301, size: 0 }),
      clf({ target: "/.env", status: 304, size: 0 }),
    ]) {
      expect({ body, read: matchesSecurityLogPrefilter(body) }).toEqual({
        body,
        read: false,
      });
    }
  });
});

/*
 * THREE SITES, AS A SCANNER'S LIST READS THEM IN THEIR ACCESS LOGS.
 */
describe("a site that leaks its .env", () => {
  const LEAK: Array<string> = [
    clf({ target: "/.env", status: 200, size: 412 }),
    clf({ target: "/.env.local", status: 404, size: 153 }),
    clf({ target: "/.git/config", status: 404, size: 153 }),
    clf({ target: "/.aws/credentials", status: 404, size: 153 }),
    clf({ target: "/wp-config.php.bak", status: 404, size: 153 }),
    clf({ target: "/wp-admin/", status: 404, size: 153 }),
  ];

  test("its .env is the file itself: it got a size no other path got, on a site that answers 404 for what it doesn't have", () => {
    const stored: Array<NormalizedSecurityEvent> = store(LEAK);

    expect(byTarget(stored)).toEqual({
      "/.env": SensitiveFileAnswer.File,
      "/.env.local": SensitiveFileAnswer.Refused,
      "/.git/config": SensitiveFileAnswer.Refused,
      "/.aws/credentials": SensitiveFileAnswer.Refused,
      "/wp-config.php.bak": SensitiveFileAnswer.Refused,
      "/wp-admin": SensitiveFileAnswer.Refused,
    });
  });

  test("the served file is Critical, says it was served, and reached the app", () => {
    const served: NormalizedSecurityEvent = store(LEAK).find(
      (event: NormalizedSecurityEvent): boolean => {
        return answerOf(event) === SensitiveFileAnswer.File;
      },
    )!;

    expect(served.severityName).toBe(OcsfSeverity.Critical);
    expect(served.severityId).toBe(OcsfSeverityId[OcsfSeverity.Critical]);
    expect(served.message).toBe(
      `${SENSITIVE_FILE_SERVED_LABEL}: GET /.env → 200`,
    );
    expect(served.requestOutcome).toBe(SecurityEventRequestOutcome.ReachedApp);
    expect(served.principalIp).toBe(SCANNER);
    expect(served.attributes[WEB_ATTACK_KIND_ATTRIBUTE]).toBe(
      WebAttackKind.SensitiveFile,
    );
    expect(served.attributes[WEB_SENSITIVE_FILE_PATH_ATTRIBUTE]).toBe("/.env");
    expect(
      served.attributes[SECURITY_REQUEST_ATTRIBUTES.responseBodySize],
    ).toBe("412");
  });

  test("Sensitive file served fires on the .env alone; Scanning for sensitive files counts every path", () => {
    const stored: Array<NormalizedSecurityEvent> = store(LEAK);

    expect(servedRuleFiresOn(stored)).toEqual(["/.env"]);
    // .env, .git, .aws, wp-config.php and WordPress: five different paths.
    expect(scanningCount(stored)).toBe(5);
  });

  test("a leak a JSON access log names by its type needs nothing else of the site", () => {
    const caddy: string =
      '{"level":"info","msg":"handled request","request":{"remote_ip":"198.51.100.23","method":"GET","uri":"/.env"},"status":200,"size":412,"resp_headers":{"Content-Type":["text/plain; charset=utf-8"]}}';
    const stored: Array<NormalizedSecurityEvent> = store([caddy]);

    expect(byTarget(stored)).toEqual({ "/.env": SensitiveFileAnswer.File });
    expect(
      stored[0]!.attributes[SECURITY_REQUEST_ATTRIBUTES.responseContentType],
    ).toBe("text/plain");
    expect(servedRuleFiresOn(stored)).toEqual(["/.env"]);

    const nginx: string =
      '{"remote_addr":"198.51.100.23","request":"GET /.git/config HTTP/1.1","status":200,"body_bytes_sent":92,"sent_http_content_type":"application/octet-stream"}';

    expect(byTarget(store([nginx]))).toEqual({
      "/.git/config": SensitiveFileAnswer.File,
    });
  });

  test("a site that serves its whole project folder leaks each file it serves", () => {
    const stored: Array<NormalizedSecurityEvent> = store([
      clf({ target: "/.env", status: 200, size: 412 }),
      clf({ target: "/.git/config", status: 200, size: 92 }),
      clf({ target: "/.npmrc", status: 200, size: 64 }),
      clf({ target: "/.aws/credentials", status: 404, size: 153 }),
    ]);

    expect(servedRuleFiresOn(stored).sort()).toEqual(
      ["/.env", "/.git/config", "/.npmrc"].sort(),
    );
  });

  test("a site that refuses dotfiles with 403 and serves a copy of wp-config.php still leaks it", () => {
    const stored: Array<NormalizedSecurityEvent> = store([
      clf({ target: "/.env", status: 403, size: 162 }),
      clf({ target: "/.git/config", status: 403, size: 162 }),
      clf({ target: "/wp-config.php.bak", status: 200, size: 3100 }),
      clf({ target: "/phpmyadmin/", status: 404, size: 153 }),
    ]);

    expect(byTarget(stored)["/wp-config.php.bak"]).toBe(
      SensitiveFileAnswer.File,
    );
    expect(servedRuleFiresOn(stored)).toEqual(["/wp-config.php.bak"]);
  });
});

describe("a single-page app, which answers every path with its own page", () => {
  // nginx's try_files $uri /index.html: index.html, 1,789 bytes, for every path it does not have.
  const SPA: Array<string> = [
    clf({ target: "/", status: 200, size: 1789 }),
    clf({ target: "/.env", status: 200, size: 1789 }),
    clf({ target: "/.env.production", status: 200, size: 1789 }),
    clf({ target: "/.git/config", status: 200, size: 1789 }),
    clf({ target: "/.aws/credentials", status: 200, size: 1789 }),
    clf({ target: "/wp-config.php.bak", status: 200, size: 1789 }),
    clf({ target: "/wp-admin/", status: 200, size: 1789 }),
    clf({ target: "/phpmyadmin/", status: 200, size: 1789 }),
  ];

  test("every 200 is its own page: the same size answered every path", () => {
    expect(byTarget(store(SPA))).toEqual({
      "/.env": SensitiveFileAnswer.OwnPage,
      "/.env.production": SensitiveFileAnswer.OwnPage,
      "/.git/config": SensitiveFileAnswer.OwnPage,
      "/.aws/credentials": SensitiveFileAnswer.OwnPage,
      "/wp-config.php.bak": SensitiveFileAnswer.OwnPage,
    });
  });

  test("nothing is served: no case opens, and each probe found nothing, Low and turned away", () => {
    const stored: Array<NormalizedSecurityEvent> = store(SPA);

    expect(servedRuleFiresOn(stored)).toEqual([]);

    for (const event of stored) {
      expect({
        path: getSensitiveFileRequestPath(event),
        severity: event.severityName,
        outcome: event.requestOutcome,
        message: event.message.startsWith("Request for a sensitive file:"),
      }).toEqual({
        path: getSensitiveFileRequestPath(event),
        severity: OcsfSeverity.Low,
        outcome: SecurityEventRequestOutcome.Rejected,
        message: true,
      });
    }
  });

  test("its scanner is caught all the same: four different paths, where a 200 counted none before", () => {
    // .env, .git, .aws and wp-config.php; its admin pages are no probe on a 200.
    expect(scanningCount(store(SPA))).toBe(4);
  });

  test("a single probe of it, which nothing decides, is no event", () => {
    expect(store([clf({ target: "/.env", status: 200, size: 1789 })])).toEqual(
      [],
    );
  });

  test("a single-page app behind a server that refuses dotfiles is no leak either", () => {
    const stored: Array<NormalizedSecurityEvent> = store([
      clf({ target: "/.env", status: 403, size: 162 }),
      clf({ target: "/.git/config", status: 403, size: 162 }),
      // Its page, alone: a 403 is a deny rule's, no sign the site answers 404 for what it lacks.
      clf({ target: "/wp-config.php.bak", status: 200, size: 1789 }),
    ]);

    expect(servedRuleFiresOn(stored)).toEqual([]);
    expect(byTarget(stored)["/wp-config.php.bak"]).toBeUndefined();

    const twoPages: Array<NormalizedSecurityEvent> = store([
      clf({ target: "/.env", status: 403, size: 162 }),
      clf({ target: "/wp-config.php.bak", status: 200, size: 1789 }),
      clf({ target: "/web.config", status: 200, size: 1789 }),
    ]);

    expect(byTarget(twoPages)).toEqual({
      "/.env": SensitiveFileAnswer.Refused,
      "/wp-config.php.bak": SensitiveFileAnswer.OwnPage,
      "/web.config": SensitiveFileAnswer.OwnPage,
    });
  });

  test("its own page as a JSON log names it - text/html - needs nothing else of the site", () => {
    const stored: Array<NormalizedSecurityEvent> = store([
      '{"request":{"remote_ip":"198.51.100.23","method":"GET","uri":"/.env"},"status":200,"size":1789,"resp_headers":{"Content-Type":["text/html; charset=utf-8"]}}',
    ]);

    expect(byTarget(stored)).toEqual({ "/.env": SensitiveFileAnswer.OwnPage });
    expect(stored[0]!.requestOutcome).toBe(
      SecurityEventRequestOutcome.Rejected,
    );
  });

  test("a HEAD for its .env sent nothing: a probe, never a leak", () => {
    const stored: Array<NormalizedSecurityEvent> = store([
      clf({ method: "HEAD", target: "/.env", status: 200, size: "-" }),
    ]);

    expect(byTarget(stored)).toEqual({ "/.env": SensitiveFileAnswer.Empty });
    expect(servedRuleFiresOn(stored)).toEqual([]);
    expect(stored[0]!.severityName).toBe(OcsfSeverity.Low);
  });
});

describe("a WordPress site", () => {
  const WORDPRESS: Array<string> = [
    // Its own pages, which it serves.
    clf({ target: "/wp-login.php", status: 200, size: 4512 }),
    clf({ target: "/wp-admin/", status: 302, size: 0 }),
    // wp-config.php runs and prints nothing; a PHP warning on a busy host.
    clf({ target: "/wp-config.php", status: 200, size: 0 }),
    clf({ target: "/wp-config.php", status: 200, size: 1523 }),
    // What it does not have: WordPress's own 404 page.
    clf({ target: "/.env", status: 404, size: 30120 }),
    clf({ target: "/.git/config", status: 404, size: 30120 }),
    clf({ target: "/wp-config.php.bak", status: 404, size: 30120 }),
  ];

  test("nothing it serves is a leak, nor a probe: wp-config.php ran, and the admin is its own", () => {
    const stored: Array<NormalizedSecurityEvent> = store(WORDPRESS);

    expect(byTarget(stored)).toEqual({
      "/.env": SensitiveFileAnswer.Refused,
      "/.git/config": SensitiveFileAnswer.Refused,
      "/wp-config.php.bak": SensitiveFileAnswer.Refused,
    });
    expect(servedRuleFiresOn(stored)).toEqual([]);
    expect(scanningCount(stored)).toBe(3);
  });

  test("its admin's busy hour stores nothing at all", () => {
    const admin: string = "203.0.113.20";

    expect(
      store([
        clf({ ip: admin, target: "/wp-admin/", status: 200, size: 52311 }),
        clf({
          ip: admin,
          target: "/wp-admin/edit.php",
          status: 200,
          size: 61002,
        }),
        clf({ ip: admin, target: "/wp-login.php", status: 200, size: 4512 }),
        clf({ ip: admin, target: "/wp-config.php", status: 200, size: 0 }),
      ]),
    ).toEqual([]);
  });
});

describe("what decides an unconfirmed answer", () => {
  test("each site by its own answers: another site's page decides nothing of it", () => {
    const events: Array<NormalizedSecurityEvent> = [
      // A single-page app, whose page is 1,789 bytes.
      ...scan(
        [
          clf({ target: "/.env", status: 200, size: 1789 }),
          clf({ target: "/.git/config", status: 200, size: 1789 }),
        ],
        OTHER_SITE,
      ),
      // A site that leaks a .env of the same size, and answers 404 for the rest.
      ...scan([
        clf({ target: "/.env", status: 200, size: 1789 }),
        clf({ target: "/.aws/credentials", status: 404, size: 153 }),
      ]),
    ];

    const stored: Array<NormalizedSecurityEvent> =
      judgeSensitiveFileAnswers(events);
    const served: Array<NormalizedSecurityEvent> = stored.filter(
      (event: NormalizedSecurityEvent): boolean => {
        return answerOf(event) === SensitiveFileAnswer.File;
      },
    );

    expect(served).toHaveLength(1);
    expect(served[0]!.attributes[SECURITY_LOG_RESOURCE_ID_ATTRIBUTE]).toBe(
      SITE,
    );
    expect(
      stored.filter((event: NormalizedSecurityEvent): boolean => {
        return answerOf(event) === SensitiveFileAnswer.OwnPage;
      }),
    ).toHaveLength(2);
  });

  test("a site is the record it came under and the host its URL names", () => {
    const [event] = scan([
      '{"remote_addr":"198.51.100.23","request":"GET https://Shop.Example/.env HTTP/1.1","status":404}',
    ]);

    expect(getSensitiveFileSiteKey(event!)).toBe(`${SITE}|shop.example`);
    expect(getSensitiveFileRequestPath(event!)).toBe("/.env");
  });

  test("a request asked again is one path: two answers of one path are no page of the site's", () => {
    const stored: Array<NormalizedSecurityEvent> = store([
      clf({ target: "/.env", status: 200, size: 412 }),
      clf({ target: "/.env?x=1", status: 200, size: 412 }),
      clf({ target: "/.git/config", status: 404, size: 153 }),
    ]);

    expect(
      stored.filter((event: NormalizedSecurityEvent): boolean => {
        return answerOf(event) === SensitiveFileAnswer.File;
      }),
    ).toHaveLength(2);
  });

  test("a site that answers 404 and has a page of its own for other paths leaves a size of neither unconfirmed", () => {
    const stored: Array<NormalizedSecurityEvent> = store([
      clf({ target: "/api/.env", status: 404, size: 22 }),
      clf({ target: "/.git/config", status: 200, size: 1789 }),
      clf({ target: "/.aws/credentials", status: 200, size: 1789 }),
      // A deploy since changed the page: 1,802 bytes, none of the sizes seen twice.
      clf({ target: "/.env", status: 200, size: 1802 }),
    ]);

    expect(byTarget(stored)).toEqual({
      "/api/.env": SensitiveFileAnswer.Refused,
      "/.git/config": SensitiveFileAnswer.OwnPage,
      "/.aws/credentials": SensitiveFileAnswer.OwnPage,
    });
  });

  test("an answer with no size is never decided", () => {
    const stored: Array<NormalizedSecurityEvent> = judgeSensitiveFileAnswers(
      scan([
        clf({ target: "/.git/config", status: 404, size: 153 }),
        '{"remote_addr":"198.51.100.23","request":"GET /.env HTTP/1.1","status":200}',
      ]),
    );

    expect(byTarget(stored)).toEqual({
      "/.git/config": SensitiveFileAnswer.Refused,
    });
  });

  test("a batch with no request for a sensitive file is handed back as it came", () => {
    const events: Array<NormalizedSecurityEvent> = scan([
      `${SCANNER} - - [24/Nov/2026:10:45:00 +0000] "GET /item?id=1%27%20or%201%3D1 HTTP/1.1" 200 512 "-" "sqlmap/1.7"`,
    ]);

    expect(judgeSensitiveFileAnswers(events)).toBe(events);
  });

  test("the attacks of a batch are kept as they are beside its probes", () => {
    const stored: Array<NormalizedSecurityEvent> = store([
      `${SCANNER} - - [24/Nov/2026:10:45:00 +0000] "GET /item?id=1%27%20or%201%3D1 HTTP/1.1" 200 512 "-" "sqlmap/1.7"`,
      clf({ target: "/.env", status: 200, size: 1789 }),
    ]);

    expect(stored).toHaveLength(1);
    expect(stored[0]!.attributes[WEB_ATTACK_KIND_ATTRIBUTE]).toBe(
      WebAttackKind.SqlInjection,
    );
  });
});

describe("after the request's trace is followed", () => {
  test("a probe that found nothing is turned away again, however the trace read its 200 - and one that broke something keeps that", () => {
    const stored: Array<NormalizedSecurityEvent> = store([
      clf({ target: "/.env", status: 200, size: 1789 }),
      clf({ target: "/.git/config", status: 200, size: 1789 }),
      clf({ target: "/.npmrc", status: 200, size: "-" }),
    ]);

    // What a trace's follow-up does to a 2xx.
    for (const event of stored) {
      event.requestOutcome = SecurityEventRequestOutcome.ReachedApp;
    }

    stored[1]!.requestOutcome = SecurityEventRequestOutcome.Errored;

    keepSensitiveFileOutcomes(stored);

    expect(
      stored.map((event: NormalizedSecurityEvent): string | undefined => {
        return event.requestOutcome;
      }),
    ).toEqual([
      SecurityEventRequestOutcome.Rejected,
      SecurityEventRequestOutcome.Errored,
      SecurityEventRequestOutcome.Rejected,
    ]);
  });

  test("the file itself keeps reaching the app", () => {
    const stored: Array<NormalizedSecurityEvent> = store([
      '{"remote_addr":"198.51.100.23","request":"GET /.env HTTP/1.1","status":200,"body_bytes_sent":412,"sent_http_content_type":"text/plain"}',
    ]);

    keepSensitiveFileOutcomes(stored);

    expect(stored[0]!.requestOutcome).toBe(
      SecurityEventRequestOutcome.ReachedApp,
    );
  });

  test("severity and outcome of each answer", () => {
    expect(severityForSensitiveFile(SensitiveFileAnswer.File)).toBe(
      OcsfSeverity.Critical,
    );
    expect(severityForSensitiveFile(SensitiveFileAnswer.Unconfirmed)).toBe(
      OcsfSeverity.Medium,
    );

    for (const answer of [
      SensitiveFileAnswer.Refused,
      SensitiveFileAnswer.OwnPage,
      SensitiveFileAnswer.Empty,
    ]) {
      expect(severityForSensitiveFile(answer)).toBe(OcsfSeverity.Low);
    }

    expect(
      outcomeForSensitiveFile(
        SensitiveFileAnswer.OwnPage,
        SecurityEventRequestOutcome.ReachedApp,
      ),
    ).toBe(SecurityEventRequestOutcome.Rejected);
    expect(
      outcomeForSensitiveFile(
        SensitiveFileAnswer.Empty,
        SecurityEventRequestOutcome.ReachedApp,
      ),
    ).toBe(SecurityEventRequestOutcome.Rejected);
    expect(
      outcomeForSensitiveFile(
        SensitiveFileAnswer.File,
        SecurityEventRequestOutcome.ReachedApp,
      ),
    ).toBe(SecurityEventRequestOutcome.ReachedApp);
    expect(
      outcomeForSensitiveFile(SensitiveFileAnswer.Refused, undefined),
    ).toBeUndefined();
  });
});

describe("from a trace's server span", () => {
  let spanNumber: number = 0;

  function span(
    url: string,
    status: string,
    response: JSONObject = {},
  ): TraceScanSpan {
    spanNumber++;

    return {
      traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
      spanId: `00f067aa0ba9${String(spanNumber).padStart(4, "0")}`,
      parentSpanId: "",
      sessionId: "",
      name: "GET",
      kind: "SPAN_KIND_SERVER",
      durationMs: 2,
      startTime: new Date("2026-11-24T10:45:00.000Z"),
      serviceId: SITE,
      serviceType: "Service",
      isLlmSpan: false,
      llmUserMessagePreview: "",
      llmUserId: "",
      llmSystem: "",
      llmRequestModel: "",
      llmOperation: "",
      attributes: {
        "url.full": url,
        "http.request.method": "GET",
        "http.response.status_code": status,
        "network.peer.address": SCANNER,
        ...(response as Record<string, string>),
      },
    };
  }

  test("an app that serves its own .env, by the type its instrumentation recorded", () => {
    const event: NormalizedSecurityEvent | null = buildTraceWebAttackEvent(
      span("https://shop.example/.env", "200", {
        "http.response.header.content-type": '["application/octet-stream"]',
        "http.response.body.size": "412",
      }),
    );

    expect(answerOf(event!)).toBe(SensitiveFileAnswer.File);
    expect(event!.severityName).toBe(OcsfSeverity.Critical);
    expect(event!.message).toBe(
      `${SENSITIVE_FILE_SERVED_LABEL}: GET https://shop.example/.env → 200`,
    );
    expect(sigmaRuleMatchesEvent(SERVED_RULE, event!)).toBe(true);
  });

  test("an app that answers it with its own page, by the older attribute names too", () => {
    const event: NormalizedSecurityEvent | null = buildTraceWebAttackEvent(
      span("https://shop.example/.env", "200", {
        "http.response.header.content_type": "text/html; charset=utf-8",
        "http.response_content_length": "1789",
      }),
    );

    expect(answerOf(event!)).toBe(SensitiveFileAnswer.OwnPage);
    expect(event!.requestOutcome).toBe(SecurityEventRequestOutcome.Rejected);
    expect(event!.severityName).toBe(OcsfSeverity.Low);
    expect(sigmaRuleMatchesEvent(SERVED_RULE, event!)).toBe(false);
    expect(sigmaRuleMatchesEvent(SCANNING_RULE, event!)).toBe(true);
  });

  test("a span that records nothing of what was sent is decided by the page's other spans, or is no event", () => {
    const alone: NormalizedSecurityEvent | null = buildTraceWebAttackEvent(
      span("https://shop.example/.env", "200"),
    );

    expect(answerOf(alone!)).toBe(SensitiveFileAnswer.Unconfirmed);
    expect(judgeSensitiveFileAnswers([alone!])).toEqual([]);
  });

  test("an admin page the app serves is none, as before", () => {
    expect(
      buildTraceWebAttackEvent(
        span("https://shop.example/wp-admin/", "200", {
          "http.response.header.content-type": "text/plain",
        }),
      ),
    ).toBeNull();
  });
});

describe("from Cloudflare's firewall events", () => {
  function normalize(overrides: JSONObject): NormalizedSecurityEvent {
    return CloudflareNormalizer.normalize(
      {
        ...MANAGED_RULE_LOG,
        description: "Sensitive files",
        clientRequestQuery: "",
        userAgent: "Mozilla/5.0 zgrab/0.x",
        ...overrides,
      },
      CLOUDFLARE_ZONE,
    );
  }

  test("a file that holds secrets the origin answered with a 200 is a probe whose answer is unconfirmed: a firewall event records no size and no type", () => {
    const event: NormalizedSecurityEvent = normalize({
      clientRequestPath: "/.env",
      originResponseStatus: 200,
    });

    expect(event.attributes[WEB_ATTACK_KIND_ATTRIBUTE]).toBe(
      WebAttackKind.SensitiveFile,
    );
    expect(event.attributes[WEB_SENSITIVE_FILE_PATH_ATTRIBUTE]).toBe("/.env");
    expect(answerOf(event)).toBe(SensitiveFileAnswer.Unconfirmed);
    expect(sigmaRuleMatchesEvent(SCANNING_RULE, event)).toBe(true);
    expect(sigmaRuleMatchesEvent(SERVED_RULE, event)).toBe(false);
  });

  test("stopped at the edge, or refused by the origin, is refused", () => {
    expect(
      answerOf(
        normalize({
          action: "block",
          clientRequestPath: "/.git/config",
          edgeResponseStatus: 403,
          originResponseStatus: 0,
        }),
      ),
    ).toBe(SensitiveFileAnswer.Refused);
    expect(
      answerOf(
        normalize({ clientRequestPath: "/.env", originResponseStatus: 404 }),
      ),
    ).toBe(SensitiveFileAnswer.Refused);
  });

  test("an admin page the origin served, a redirect, or a cached answer is no probe", () => {
    for (const overrides of [
      { clientRequestPath: "/wp-admin/", originResponseStatus: 200 },
      { clientRequestPath: "/.env", originResponseStatus: 301 },
      { clientRequestPath: "/.env", originResponseStatus: 0 },
    ]) {
      expect({
        overrides,
        kind: normalize(overrides).attributes[WEB_ATTACK_KIND_ATTRIBUTE],
      }).toEqual({ overrides, kind: undefined });
    }
  });
});

describe("Sensitive file served, as the library holds it", () => {
  function entry(): DetectionRuleLibraryEntry {
    return getDetectionRuleLibraryEntry(SENSITIVE_FILE_SERVED_RULE_ID)!;
  }

  test("a recommended web rule: one served file from one address is enough", () => {
    const found: DetectionRuleLibraryEntry = entry();

    expect(found.title).toBe("Sensitive file served");
    expect(found.category).toBe(DetectionRuleLibraryCategory.Web);
    expect(found.dataKind).toBe(DetectionRuleDataKind.WebRequests);
    expect(found.groupByField).toBe("principalIp");
    expect(found.distinctCountField).toBeUndefined();
    expect(found.matchCountThreshold).toBe(1);
    expect(found.evaluationIntervalInMinutes).toBe(5);
    expect(RECOMMENDED_DETECTION_RULE_IDS).toContain(found.id);
    expect(
      DETECTION_RULE_LIBRARY.filter(
        (candidate: DetectionRuleLibraryEntry): boolean => {
          return candidate.id === found.id;
        },
      ),
    ).toHaveLength(1);
    expect(found.sigmaRuleYaml).toContain(`id: ${found.id}\n`);
  });

  test("is Critical, and reads as unsecured credentials in files (T1552.001)", () => {
    expect(SERVED_RULE.level).toBe("critical");
    expect(SERVED_RULE.mitreTechniques).toContain("T1552.001");
    expect(entry().sigmaRuleYaml).toContain(
      `web.sensitive_file.answer: ${SensitiveFileAnswer.File}`,
    );
  });

  test("compiles to a read that binds what it looks for, and runs in real time", () => {
    const statement: Statement = SigmaClickhouseCompiler.compile(SERVED_RULE);

    expect(readStatementValues(statement)).toEqual(
      expect.arrayContaining([
        WebAttackKind.SensitiveFile,
        SensitiveFileAnswer.File,
      ]),
    );
    expect(statement.query).not.toContain(WebAttackKind.SensitiveFile);
    expect(
      getRealTimeDetectionProblem({
        definition: SigmaRuleSetParser.parse(entry().sigmaRuleYaml),
      }),
    ).toBeNull();
  });

  test("hands a case its steps: check what was sent, take the file down, rotate its secrets, keep secrets out of the web root", () => {
    expect(
      getDetectionRuleLibraryResponseSteps(entry().id).map(
        (step: { text: string }): string => {
          return step.text;
        },
      ),
    ).toEqual([
      "Open the request and check what your site sent: its size and type, beside what it sends for a path it does not have. Ask for the file from outside your network to see whether it is still served.",
      "Take the file off your web server now, or have the server refuse its path.",
      "Rotate every secret the file holds - its passwords, keys and tokens - and check where each was used since it was served.",
      "Keep secrets and repositories out of the folders your web server serves, and have it refuse paths that start with a dot.",
    ]);
  });

  test("no automatic response policy acts on it: a leak is a person's to answer", () => {
    for (const [kind, ids] of Object.entries(
      SECURITY_AUTOMATIC_RESPONSE_LIBRARY_RULES,
    )) {
      expect({
        kind,
        actsOnIt: ids.includes(SENSITIVE_FILE_SERVED_RULE_ID),
      }).toEqual({ kind, actsOnIt: false });
    }
  });

  test("never fires on a probe of any other answer", () => {
    for (const answer of [
      SensitiveFileAnswer.Refused,
      SensitiveFileAnswer.OwnPage,
      SensitiveFileAnswer.Empty,
      SensitiveFileAnswer.Unconfirmed,
    ]) {
      const [event] = scan([clf({ target: "/.env", status: 404, size: 153 })]);
      event!.attributes[WEB_SENSITIVE_FILE_ANSWER_ATTRIBUTE] = answer;

      expect({
        answer,
        fires: sigmaRuleMatchesEvent(SERVED_RULE, event!),
      }).toEqual({ answer, fires: false });
    }
  });
});
