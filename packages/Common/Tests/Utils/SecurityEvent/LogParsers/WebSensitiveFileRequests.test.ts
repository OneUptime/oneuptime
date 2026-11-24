import { describe, expect, test } from "@jest/globals";
import NormalizedSecurityEvent from "../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import OcsfSeverity from "../../../../Types/SecurityEvent/OcsfSeverity";
import SecurityEventRequestOutcome from "../../../../Types/SecurityEvent/SecurityEventRequestOutcome";
import {
  DETECTION_RULE_LIBRARY,
  DetectionRuleLibraryEntry,
  SCANNING_FOR_SENSITIVE_FILES_RULE_ID,
} from "../../../../Types/SecurityEvent/DetectionRuleLibrary";
import SecurityLogParser, {
  matchesSecurityLogPrefilter,
} from "../../../../Utils/SecurityEvent/LogParsers/SecurityLogParser";
import WebAttackLogParser, {
  WEB_ATTACK_KIND_ATTRIBUTE,
  WEB_SENSITIVE_FILE_PATH_ATTRIBUTE,
  WebAttackKind,
} from "../../../../Utils/SecurityEvent/LogParsers/WebAttackLogParser";
import { SecurityLogLine } from "../../../../Utils/SecurityEvent/LogParsers/SecurityLogLine";
import { logLine } from "./LogParserFixtures";

/*
 * REQUESTS FOR SENSITIVE FILES, IN A WEB SERVER'S ACCESS LOG (#10745).
 *
 * A request for /.env, /.git/config, /wp-admin and the rest becomes an
 * event only when the site refused it or has no such file: what a scanner
 * leaves behind, and never what a site's own people load. The Rule
 * Library's "Scanning for sensitive files" counts the distinct paths one
 * address asked for (web.sensitive_file.path); these streams are read here
 * the way its count reads them, so both sides are held: a scanner reaches
 * it, a real WordPress admin never does.
 */

function clf(data: {
  ip: string;
  method?: string;
  target: string;
  status: number;
  agent?: string;
}): string {
  return `${data.ip} - - [24/Nov/2026:10:00:00 +0000] "${data.method || "GET"} ${data.target} HTTP/1.1" ${data.status} 153 "-" "${data.agent || "Mozilla/5.0"}"`;
}

function parse(body: string): Array<NormalizedSecurityEvent> {
  return WebAttackLogParser.parse(logLine(body));
}

function parseOne(body: string): NormalizedSecurityEvent {
  const events: Array<NormalizedSecurityEvent> = parse(body);

  expect(events).toHaveLength(1);

  return events[0]!;
}

// What the library rule selects: a sensitive-file request.
function isCounted(event: NormalizedSecurityEvent): boolean {
  return event.attributes[WEB_ATTACK_KIND_ATTRIBUTE] === WebAttackKind.SensitiveFile;
}

/*
 * The rule's count over a stream, as its query counts: the events it
 * selects, grouped by principalIp - none for an event with no address -
 * and the distinct sensitive paths of each.
 */
function distinctPathsByAddress(
  bodies: Array<string>,
): Record<string, number> {
  const paths: Map<string, Set<string>> = new Map();

  for (const body of bodies) {
    // Only what the database hands the scan is read.
    if (!matchesSecurityLogPrefilter(body)) {
      continue;
    }

    for (const event of SecurityLogParser.parse(logLine(body))) {
      if (!isCounted(event) || !event.principalIp) {
        continue;
      }

      const set: Set<string> = paths.get(event.principalIp) || new Set();
      set.add(String(event.attributes[WEB_SENSITIVE_FILE_PATH_ATTRIBUTE]));
      paths.set(event.principalIp, set);
    }
  }

  const counts: Record<string, number> = {};

  for (const [address, set] of paths) {
    counts[address] = set.size;
  }

  return counts;
}

const RULE: DetectionRuleLibraryEntry = DETECTION_RULE_LIBRARY.find(
  (entry: DetectionRuleLibraryEntry): boolean => {
    return entry.id === SCANNING_FOR_SENSITIVE_FILES_RULE_ID;
  },
)!;

describe("a request for a sensitive file, refused or not found", () => {
  test("is an HTTP Activity event that says what it asked for, counted by its path", () => {
    const event: NormalizedSecurityEvent = parseOne(
      clf({ ip: "198.51.100.7", target: "/.env", status: 404, agent: "curl/8.5.0" }),
    );

    expect(event.classUid).toBe(4002);
    expect(event.className).toBe("HTTP Activity");
    expect(event.activityName).toBe("GET");
    expect(event.statusName).toBe("Failure");
    expect(event.principalIp).toBe("198.51.100.7");
    expect(event.targetResource).toBe("/.env");
    expect(event.requestOutcome).toBe(SecurityEventRequestOutcome.Rejected);
    // A request the site turned away is noise on its own; the rule counts them.
    expect(event.severityName).toBe(OcsfSeverity.Low);
    expect(event.message).toBe("Request for a sensitive file: GET /.env → 404");
    expect(event.attributes[WEB_ATTACK_KIND_ATTRIBUTE]).toBe(
      WebAttackKind.SensitiveFile,
    );
    expect(event.attributes[WEB_SENSITIVE_FILE_PATH_ATTRIBUTE]).toBe("/.env");
    expect(event.attributes["http.response.status_code"]).toBe("404");
    expect(event.attributes["user_agent.original"]).toBe("curl/8.5.0");
  });

  test("each spelling of a path counts as that path", () => {
    for (const [target, path] of [
      ["/.env.production", "/.env"],
      ["/.git/HEAD", "/.git"],
      ["/wp-login.php", "/wp-admin"],
      ["/phpMyAdmin/", "/phpmyadmin"],
      ["/.aws/credentials", "/.aws"],
    ] as Array<[string, string]>) {
      expect(
        parseOne(clf({ ip: "198.51.100.7", target, status: 404 })).attributes[
          WEB_SENSITIVE_FILE_PATH_ATTRIBUTE
        ],
      ).toBe(path);
    }
  });

  test.each([400, 401, 403, 404, 405, 410, 429])(
    "a %p answer is a refusal",
    (status: number) => {
      expect(
        parse(clf({ ip: "198.51.100.7", target: "/.git/config", status })),
      ).toHaveLength(1);
    },
  );

  test.each([200, 206, 301, 302, 304, 500, 503])(
    "a %p answer is not: the site served it, sent it on, or broke - and no record says it refused it",
    (status: number) => {
      expect(
        parse(clf({ ip: "198.51.100.7", target: "/.git/config", status })),
      ).toEqual([]);
    },
  );

  test("a JSON access log line, nginx's whole request and Caddy's uri alike", () => {
    expect(
      parseOne(
        '{"remote_addr":"198.51.100.7","request":"GET /.env HTTP/1.1","status":403,"http_user_agent":"zgrab/0.x"}',
      ).attributes[WEB_SENSITIVE_FILE_PATH_ATTRIBUTE],
    ).toBe("/.env");
    expect(
      parseOne(
        '{"remote_ip":"198.51.100.7","method":"GET","uri":"/server-status","status": 404}',
      ).attributes[WEB_SENSITIVE_FILE_PATH_ATTRIBUTE],
    ).toBe("/server-status");
  });

  test("an app's own line, from the request its attributes describe", () => {
    const line: SecurityLogLine = logLine("Not Found: GET /.git/config", {
      "url.path": "/.git/config",
      "http.request.method": "GET",
      "http.response.status_code": "404",
      "network.peer.address": "198.51.100.7",
    });
    const events: Array<NormalizedSecurityEvent> = WebAttackLogParser.parse(line);

    expect(events).toHaveLength(1);
    expect(events[0]!.targetResource).toBe("/.git/config");
    expect(events[0]!.attributes[WEB_SENSITIVE_FILE_PATH_ATTRIBUTE]).toBe(
      "/.git",
    );
  });

  test("an attack string wins: an injection aimed at /.env is the injection", () => {
    const event: NormalizedSecurityEvent = parseOne(
      clf({ ip: "198.51.100.7", target: "/.env?id=1' or '1'='1", status: 404 }),
    );

    expect(event.attributes[WEB_ATTACK_KIND_ATTRIBUTE]).toBe(
      WebAttackKind.SqlInjection,
    );
    expect(event.attributes[WEB_SENSITIVE_FILE_PATH_ATTRIBUTE]).toBeUndefined();
  });

  test("a line that only mentions a sensitive path is none: a search, a referrer, a word in a message", () => {
    for (const body of [
      clf({ ip: "198.51.100.7", target: "/search?q=.env", status: 404 }),
      clf({ ip: "198.51.100.7", target: "/blog/wp-admin-tips", status: 404 }),
      '198.51.100.7 - - [24/Nov/2026:10:00:00 +0000] "GET /missing HTTP/1.1" 404 0 "https://example.com/.env" "Mozilla/5.0"',
      "ERROR could not read /.env: permission denied",
    ]) {
      expect({ body, events: parse(body) }).toEqual({ body, events: [] });
    }
  });

  test("an address a scrub rule hid is named nowhere: the event says a rule hid it, and counts toward no address", () => {
    const redacted: NormalizedSecurityEvent = parseOne(
      clf({ ip: "[REDACTED]", target: "/.env", status: 404 }),
    );

    expect(redacted.principalIp).toBe("");
    expect(redacted.attributes["oneuptime.request.client_address_hidden"]).toBe(
      "scrub-rule",
    );

    const hashed: NormalizedSecurityEvent = parseOne(
      clf({ ip: "[HASHED:3f9a1c0be27d4e5a]", target: "/.git/config", status: 404 }),
    );

    expect(hashed.principalIp).toBe("");
    expect(hashed.attributes[WEB_SENSITIVE_FILE_PATH_ATTRIBUTE]).toBe("/.git");
  });

  test("the dispatcher reads it the same way, last, after every other format", () => {
    const body: string = clf({ ip: "198.51.100.7", target: "/.env", status: 404 });

    expect(
      SecurityLogParser.parse(logLine(body)).map(
        (event: NormalizedSecurityEvent): unknown => {
          return event.attributes[WEB_SENSITIVE_FILE_PATH_ATTRIBUTE];
        },
      ),
    ).toEqual(["/.env"]);
  });
});

describe("the log scan's read", () => {
  test("hands over every refused request for a sensitive file", () => {
    for (const body of [
      clf({ ip: "198.51.100.7", target: "/.env", status: 404 }),
      clf({ ip: "198.51.100.7", target: "/WP-LOGIN.PHP", status: 403 }),
      '{"remote_addr":"198.51.100.7","request":"GET /.git/config HTTP/1.1","status":"404"}',
      '{"remote_ip":"198.51.100.7","uri":"/phpmyadmin/","status_code": 404}',
    ]) {
      expect({ body, read: matchesSecurityLogPrefilter(body) }).toEqual({
        body,
        read: true,
      });
    }
  });

  test("leaves in the database the admin pages a WordPress site serves", () => {
    for (const body of [
      clf({ ip: "203.0.113.20", target: "/wp-admin/", status: 302 }),
      clf({ ip: "203.0.113.20", target: "/wp-admin/", status: 200 }),
      clf({ ip: "203.0.113.20", target: "/wp-login.php", status: 200 }),
      clf({ ip: "203.0.113.20", method: "POST", target: "/wp-login.php", status: 302 }),
      clf({ ip: "203.0.113.20", target: "/wp-admin/edit.php", status: 200 }),
      '{"remote_addr":"203.0.113.20","request":"GET /wp-admin/ HTTP/1.1","status":200}',
    ]) {
      expect({ body, read: matchesSecurityLogPrefilter(body) }).toEqual({
        body,
        read: false,
      });
    }
  });

  test("every request that becomes an event is one the read hands over", () => {
    for (const target of [
      "/.env",
      "/.git/config",
      "/.svn/entries",
      "/.hg/hgrc",
      "/.aws/credentials",
      "/.ssh/id_rsa",
      "/.vscode/sftp.json",
      "/sftp-config.json",
      "/.htpasswd",
      "/.npmrc",
      "/wp-config.php.bak",
      "/phpinfo.php",
      "/web.config",
      "/actuator/env",
      "/actuator/heapdump",
      "/wp-admin/",
      "/wp-login.php",
      "/phpmyadmin/",
      "/server-status",
      "/server-info",
    ]) {
      const body: string = clf({ ip: "198.51.100.7", target, status: 404 });

      expect({ target, events: parse(body).length }).toEqual({
        target,
        events: 1,
      });
      expect({ target, read: matchesSecurityLogPrefilter(body) }).toEqual({
        target,
        read: true,
      });
    }
  });
});

describe("Scanning for sensitive files, over a scanner and a WordPress admin", () => {
  test("counts what its rule says: three different paths from one address", () => {
    expect(RULE.groupByField).toBe("principalIp");
    expect(RULE.distinctCountField).toBe(WEB_SENSITIVE_FILE_PATH_ATTRIBUTE);
    expect(RULE.matchCountThreshold).toBe(3);
    expect(RULE.evaluationIntervalInMinutes).toBe(5);
  });

  test("a scanner, working down its list within a minute, reaches it many times over", () => {
    const scanner: string = "198.51.100.7";
    const stream: Array<string> = [
      clf({ ip: scanner, target: "/", status: 200, agent: "Mozilla/5.0 zgrab/0.x" }),
      clf({ ip: scanner, target: "/robots.txt", status: 200 }),
      clf({ ip: scanner, target: "/.env", status: 404 }),
      clf({ ip: scanner, target: "/.env.local", status: 404 }),
      clf({ ip: scanner, target: "/api/.env", status: 404 }),
      clf({ ip: scanner, target: "/.git/config", status: 404 }),
      clf({ ip: scanner, target: "/.git/HEAD", status: 404 }),
      clf({ ip: scanner, target: "/wp-login.php", status: 404 }),
      clf({ ip: scanner, target: "/wp-admin/setup-config.php", status: 404 }),
      clf({ ip: scanner, target: "/phpmyadmin/", status: 404 }),
      clf({ ip: scanner, target: "/.aws/credentials", status: 403 }),
      clf({ ip: scanner, target: "/server-status", status: 403 }),
      clf({ ip: scanner, target: "/phpinfo.php", status: 404 }),
    ];

    const counts: Record<string, number> = distinctPathsByAddress(stream);

    // .env, .git, WordPress, phpMyAdmin, .aws, Apache's status, phpinfo: each once.
    expect(counts[scanner]).toBe(7);
    expect(counts[scanner]!).toBeGreaterThanOrEqual(RULE.matchCountThreshold);
  });

  test("a scanner on a WordPress site, where WordPress's own pages are served, still reaches it with what the site does not have", () => {
    const scanner: string = "198.51.100.8";
    const counts: Record<string, number> = distinctPathsByAddress([
      // The site runs WordPress: these are served, so none counts.
      clf({ ip: scanner, target: "/wp-login.php", status: 200 }),
      clf({ ip: scanner, target: "/wp-admin/", status: 302 }),
      // What it does not have.
      clf({ ip: scanner, target: "/.env", status: 404 }),
      clf({ ip: scanner, target: "/.git/config", status: 404 }),
      clf({ ip: scanner, target: "/phpmyadmin/", status: 404 }),
    ]);

    expect(counts[scanner]).toBe(3);
  });

  test("a WordPress admin's busy hour never counts a single path", () => {
    const admin: string = "203.0.113.20";
    const stream: Array<string> = [];

    for (let round: number = 0; round < 10; round++) {
      stream.push(
        clf({ ip: admin, target: "/wp-admin/", status: 302 }),
        clf({ ip: admin, target: "/wp-login.php?redirect_to=%2Fwp-admin%2F&reauth=1", status: 200 }),
        clf({ ip: admin, method: "POST", target: "/wp-login.php", status: 302 }),
        clf({ ip: admin, target: "/wp-admin/", status: 200 }),
        clf({ ip: admin, target: "/wp-admin/edit.php", status: 200 }),
        clf({ ip: admin, target: "/wp-admin/post.php?post=42&action=edit", status: 200 }),
        clf({ ip: admin, method: "POST", target: "/wp-admin/admin-ajax.php", status: 200 }),
        // The heartbeat after its nonce ran out, and an action no plugin registered.
        clf({ ip: admin, method: "POST", target: "/wp-admin/admin-ajax.php", status: 403 }),
        clf({ ip: admin, method: "POST", target: "/wp-admin/admin-ajax.php", status: 400 }),
        // The browser's tools asking for source maps.
        clf({ ip: admin, target: "/wp-admin/css/forms.min.css.map", status: 404 }),
        clf({ ip: admin, target: "/wp-includes/js/jquery/jquery.min.js", status: 200 }),
        clf({ ip: admin, target: "/wp-content/uploads/2026/11/missing.png", status: 404 }),
        clf({ ip: admin, target: "/wp-config.php", status: 200 }),
      );
    }

    expect(distinctPathsByAddress(stream)[admin]).toBeUndefined();
  });

  test("an admin locked out by a security plugin, with an old bookmark, stays under it", () => {
    const admin: string = "203.0.113.21";
    const counts: Record<string, number> = distinctPathsByAddress([
      // A plugin locked the sign-in page after wrong passwords, and hides the admin's address.
      clf({ ip: admin, target: "/wp-login.php", status: 403 }),
      clf({ ip: admin, method: "POST", target: "/wp-login.php", status: 403 }),
      clf({ ip: admin, target: "/wp-admin/", status: 404 }),
      clf({ ip: admin, target: "/wp-admin/install.php", status: 404 }),
    ]);

    // WordPress's admin and its sign-in page are one path.
    expect(counts[admin]).toBe(1);
    expect(counts[admin]!).toBeLessThan(RULE.matchCountThreshold);
  });

  test("a mistyped URL, asked for again and again, stays at one path at most", () => {
    const person: string = "192.0.2.44";
    const stream: Array<string> = [];

    for (let attempt: number = 0; attempt < 20; attempt++) {
      stream.push(
        clf({ ip: person, target: "/wp-admn", status: 404 }),
        clf({ ip: person, target: "/.env", status: 404 }),
      );
    }

    expect(distinctPathsByAddress(stream)[person]).toBe(1);
  });

  test("scanners whose addresses a Redact rule hid are no one address, however many paths they ask for", () => {
    const counts: Record<string, number> = distinctPathsByAddress([
      clf({ ip: "[REDACTED]", target: "/.env", status: 404 }),
      clf({ ip: "[REDACTED]", target: "/.git/config", status: 404 }),
      clf({ ip: "[REDACTED]", target: "/phpmyadmin/", status: 404 }),
      clf({ ip: "[REDACTED]", target: "/server-status", status: 404 }),
    ]);

    expect(counts).toEqual({});
  });
});
