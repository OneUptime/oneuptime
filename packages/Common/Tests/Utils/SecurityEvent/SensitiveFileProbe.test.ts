import {
  REFUSED_STATUS_LOG_WORDS,
  SENSITIVE_FILE_PROBE_PATHS,
  SENSITIVE_FILE_PROBE_WORDS,
  SensitiveFileProbePath,
  readRequestPathSegments,
  readSensitiveFileProbe,
  readSensitivePath,
} from "../../../Utils/SecurityEvent/SensitiveFileProbe";
import { describe, expect, test } from "@jest/globals";

/*
 * A REQUEST FOR A WELL-KNOWN SENSITIVE FILE THAT A SITE REFUSED OR DOES NOT
 * HAVE (#10745): read from the request's path and its answer, precisely -
 * the Scanners policy can block on what this reads, and a WordPress site's
 * own admins load /wp-admin and /wp-login.php all day.
 */

// Every spelling of each sensitive path a scanner sends, and the path it counts as.
const POSITIVE: Array<[string, string]> = [
  ["/.env", "/.env"],
  ["/.ENV", "/.env"],
  ["/.env.local", "/.env"],
  ["/.env.production", "/.env"],
  ["/.env.bak", "/.env"],
  ["/api/.env", "/.env"],
  ["/laravel/.env", "/.env"],
  ["/%2eenv", "/.env"],
  ["/.env?debug=1", "/.env"],
  ["https://shop.example.com/.env", "/.env"],
  ["/.git/config", "/.git"],
  ["/.git/HEAD", "/.git"],
  ["/.git/", "/.git"],
  ["/.git", "/.git"],
  ["/app/.git/index", "/.git"],
  ["/.git;x/config", "/.git"],
  ["//.git//config", "/.git"],
  ["/.svn/entries", "/.svn"],
  ["/.hg/hgrc", "/.hg"],
  ["/.aws/credentials", "/.aws"],
  ["/.aws/config", "/.aws"],
  ["/.ssh/id_rsa", "/.ssh"],
  ["/.vscode/sftp.json", "/.vscode"],
  ["/sftp-config.json", "/.vscode"],
  ["/.htpasswd", "/.htpasswd"],
  ["/admin/.htpasswd", "/.htpasswd"],
  ["/.npmrc", "/.npmrc"],
  ["/wp-config.php", "/wp-config.php"],
  ["/wp-config.php.bak", "/wp-config.php"],
  ["/wp-config.php~", "/wp-config.php"],
  ["/wp-config.bak", "/wp-config.php"],
  ["/blog/wp-config.old", "/wp-config.php"],
  ["/phpinfo.php", "/phpinfo.php"],
  ["/web.config", "/web.config"],
  ["/actuator/env", "/actuator/env"],
  ["/actuator/heapdump", "/actuator/env"],
  ["/management/actuator/env", "/actuator/env"],
  ["/wp-admin", "/wp-admin"],
  ["/wp-admin/", "/wp-admin"],
  ["/wp-admin/install.php", "/wp-admin"],
  ["/wp-admin/setup-config.php", "/wp-admin"],
  ["/wp-login.php", "/wp-admin"],
  ["/wp-login.php?action=register", "/wp-admin"],
  ["/blog/wp-login.php", "/wp-admin"],
  ["/wordpress/wp-admin/", "/wp-admin"],
  ["/phpmyadmin", "/phpmyadmin"],
  ["/phpMyAdmin/", "/phpmyadmin"],
  ["/phpmyadmin/index.php", "/phpmyadmin"],
  ["/server-status", "/server-status"],
  ["/server-status?auto", "/server-status"],
  ["/server-info", "/server-status"],
];

// What is no sensitive path, however close it reads.
const NEGATIVE: Array<string> = [
  "/",
  "",
  "/index.html",
  "/search?q=.env",
  "/docs/.env-setup",
  "/.environment/x",
  "/.envrc",
  "/blog/wp-admin-tips",
  "/my-wp-admin/",
  "/wp-admin/admin-ajax.php",
  "/wp-admin/admin-post.php",
  "/wp-admin/edit.php",
  "/wp-admin/post.php?post=1&action=edit",
  "/wp-admin/css/forms.min.css.map",
  "/wp-admin/js/common.min.js",
  "/wp-includes/js/jquery/jquery.min.js",
  "/wp-content/uploads/2026/11/photo.png",
  "/wp-config-sample.php",
  "/xmlrpc.php",
  "/phpmyadmin/js/messages.php",
  "/phpmyadmin/themes/pmahomme/img/logo_left.png",
  "/repo.git/info/refs",
  "/.gitignore",
  "/.github/workflows/ci.yml",
  "/status",
  "/server-status/extra",
  "/team/server-status",
  "/actuator/health",
  "/actuator/environment",
  "/configuration.php",
  "/config.json",
  "/api/env",
  "/env",
];

describe("the path of a request", () => {
  test("is read without its scheme, host, query or fragment, decoded once, lowercased, in segments", () => {
    expect(
      readRequestPathSegments("https://Shop.Example.com/A/B?x=1#y"),
    ).toEqual(["a", "b"]);
    expect(readRequestPathSegments("/%2Egit/CONFIG")).toEqual([
      ".git",
      "config",
    ]);
    expect(readRequestPathSegments("//a///b/")).toEqual(["a", "b"]);
    expect(readRequestPathSegments("/a;jsessionid=1/b")).toEqual(["a", "b"]);
    // A percent that encodes nothing is kept as it is.
    expect(readRequestPathSegments("/100%/x")).toEqual(["100%", "x"]);
    expect(readRequestPathSegments("")).toEqual([]);
    expect(readRequestPathSegments("/" + "a".repeat(5000))).toEqual([]);
  });
});

describe("which requests ask for a sensitive path", () => {
  test.each(POSITIVE)("%s counts as %s", (target: string, path: string) => {
    expect(readSensitivePath(target)).toBe(path);
  });

  test.each(NEGATIVE)("%p is none", (target: string) => {
    expect(readSensitivePath(target)).toBeNull();
  });

  test("WordPress's admin and its sign-in page count as one path: a site's own admins ask for one at most", () => {
    const counted: Set<string> = new Set(
      [
        "/wp-admin/",
        "/wp-login.php",
        "/wp-login.php?redirect_to=%2Fwp-admin%2F",
        "/wp-admin/install.php",
      ].map((target: string): string => {
        return readSensitivePath(target)!;
      }),
    );

    expect(Array.from(counted)).toEqual(["/wp-admin"]);
  });

  test("every path counts as one, its own", () => {
    const paths: Array<string> = SENSITIVE_FILE_PROBE_PATHS.map(
      (path: SensitiveFileProbePath): string => {
        return path.path;
      },
    );

    expect(new Set(paths).size).toBe(paths.length);

    for (const path of SENSITIVE_FILE_PROBE_PATHS) {
      expect(path.what.length).toBeGreaterThan(5);
      expect(path.patterns.length).toBeGreaterThan(0);

      for (const pattern of path.patterns) {
        for (const name of pattern.names) {
          expect(name).toBe(name.toLowerCase());
        }
      }
    }
  });
});

describe("which of them were refused or not found", () => {
  test.each([400, 401, 403, 404, 405, 410, 429, 499])(
    "a %p answer makes a request for /.env one",
    (status: number) => {
      expect(
        readSensitiveFileProbe({ target: "/.env", statusCode: status }),
      ).toBe("/.env");
    },
  );

  test.each([0, 200, 204, 301, 302, 304, 500, 502, 503])(
    "a %p answer does not: the site served it, answered it elsewhere, broke, or no record says",
    (status: number) => {
      expect(
        readSensitiveFileProbe({ target: "/.env", statusCode: status }),
      ).toBeNull();
    },
  );

  test("a page a WordPress site serves its admins is never one, however often they load it", () => {
    for (const [target, status] of [
      ["/wp-admin/", 302],
      ["/wp-admin/", 200],
      ["/wp-login.php", 200],
      ["/wp-login.php", 302],
      ["/wp-admin/edit.php", 200],
      ["/wp-admin/admin-ajax.php", 200],
      // Refused, but no sensitive path: a nonce that ran out.
      ["/wp-admin/admin-ajax.php", 403],
      ["/wp-admin/admin-ajax.php", 400],
      // Not found, but no sensitive path: a source map the browser's tools asked for.
      ["/wp-admin/css/forms.min.css.map", 404],
    ] as Array<[string, number]>) {
      expect({
        target,
        status,
        probe: readSensitiveFileProbe({ target, statusCode: status }),
      }).toEqual({ target, status, probe: null });
    }
  });
});

describe("the words the scans ask the database for", () => {
  test("every request that counts holds one of them, as written, so the database hands it over", () => {
    for (const [target] of POSITIVE) {
      if (target.includes("%")) {
        // An encoded path is read when it arrives, not asked for by its encoding.
        continue;
      }

      const lower: string = target.toLowerCase();

      expect({
        target,
        held: SENSITIVE_FILE_PROBE_WORDS.some((word: string): boolean => {
          return lower.indexOf(word) !== -1;
        }),
      }).toEqual({ target, held: true });
    }
  });

  test("are lowercased, each with the slash before it, so a word inside another is no match", () => {
    for (const word of SENSITIVE_FILE_PROBE_WORDS) {
      expect(word.startsWith("/")).toBe(true);
      expect(word).toBe(word.toLowerCase());
    }

    expect(new Set(SENSITIVE_FILE_PROBE_WORDS).size).toBe(
      SENSITIVE_FILE_PROBE_WORDS.length,
    );
  });

  test("a refused answer's words match an access log's 4xx and no other answer", () => {
    const refused: Array<string> = [
      '203.0.113.7 - - [24/Nov/2026:10:00:00 +0000] "GET /.env HTTP/1.1" 404 153 "-" "curl/8.5.0"',
      '{"remote_addr":"203.0.113.7","request":"GET /.env HTTP/1.1","status":403}',
      '{"remote_addr":"203.0.113.7","uri":"/.env","status": 404}',
      '{"remote_addr":"203.0.113.7","uri":"/.env","status":"401"}',
      '{"client.address":"203.0.113.7","url.path":"/.env","http.response.status_code":404}',
      '{"remote_addr":"203.0.113.7","uri":"/.env","status_code": 410}',
    ];
    const served: Array<string> = [
      '203.0.113.7 - - [24/Nov/2026:10:00:00 +0000] "GET /wp-admin/ HTTP/1.1" 302 0 "-" "Mozilla/5.0"',
      '{"remote_addr":"203.0.113.7","request":"GET /wp-login.php HTTP/1.1","status":200}',
      '{"remote_addr":"203.0.113.7","uri":"/.env","status": 500}',
    ];

    const holdsRefused: (line: string) => boolean = (line: string): boolean => {
      const lower: string = line.toLowerCase();

      return REFUSED_STATUS_LOG_WORDS.some((word: string): boolean => {
        return lower.indexOf(word) !== -1;
      });
    };

    for (const line of refused) {
      expect({ line, refused: holdsRefused(line) }).toEqual({
        line,
        refused: true,
      });
    }

    for (const line of served) {
      expect({ line, refused: holdsRefused(line) }).toEqual({
        line,
        refused: false,
      });
    }
  });
});
