import SecurityEventRequestOutcome from "../../Types/SecurityEvent/SecurityEventRequestOutcome";
import { requestOutcomeFromStatusCode } from "./RequestOutcome";

/*
 * REQUESTS FOR WELL-KNOWN SENSITIVE FILES THAT A SITE REFUSED OR DOES NOT
 * HAVE (#10745): what a scanner does first. It asks a site for the files
 * that leak secrets when a server serves them by mistake - /.env, /.git/,
 * /.aws/credentials - and for the admin pages of apps it might run -
 * /wp-admin, /phpmyadmin, /server-status - and moves on to the next site.
 *
 * Such a request becomes a security event (WebAttackKind.SensitiveFile)
 * only when the site turned it away or has no such file - it answered with
 * a 4xx status - so a path the site serves is never one. A WordPress site
 * answers its own admins' /wp-admin and /wp-login.php with a page or a
 * redirect: none of those requests is a probe, however many there are.
 * And only the paths below count, matched on the request's path - never
 * its query, never a word inside another word - so "/blog/wp-admin-tips"
 * is no probe, and nor is "/search?q=.env".
 *
 * Each path is counted as one, however it is spelled and wherever it is
 * (its `path`): every .env file is "/.env", everything in a .git folder is
 * "/.git", WordPress's admin and its sign-in page are "/wp-admin". The
 * Rule Library's rule counts the distinct ones an address probed within
 * minutes (DetectionRuleLibrary, "Scanning for sensitive files"): a scanner
 * asks for many, while a person who mistypes one URL, or a site's own
 * admin, asks for one at most.
 *
 * Pure. Every scan of a request is an indexOf or a comparison on a
 * lowercased copy, never a regular expression: the text is a request an
 * attacker wrote.
 */

// How a request's path names a sensitive path.
export enum SensitivePathMatch {
  // Anything in a folder of this name, the folder itself included: "/.git/config", "/app/.git/HEAD".
  Folder = "Folder",
  // A file of this name, in any folder: "/.htpasswd", "/site/.htpasswd".
  File = "File",
  // A file whose name is this or starts with it and a dot, in any folder: ".env", ".env.local".
  FileWithSuffix = "FileWithSuffix",
  // These last segments of the path, wherever they are: "/wp-admin/setup-config.php".
  Ending = "Ending",
  // The path itself, at the site's root: "/server-status".
  Root = "Root",
}

export interface SensitiveFileProbePath {
  // What a probe of it is counted as: one path, however it is spelled and wherever it is.
  path: string;
  // What it is, for the docs and the tests.
  what: string;
  // The names that make a request one of it, lowercased, each as `match` reads it.
  patterns: ReadonlyArray<{ match: SensitivePathMatch; names: Array<string> }>;
}

export const SENSITIVE_FILE_PROBE_PATHS: ReadonlyArray<SensitiveFileProbePath> =
  [
    // Secrets and configuration a browser never asks for.
    {
      path: "/.env",
      what: "an app's environment file, with its database password and API keys",
      patterns: [{ match: SensitivePathMatch.FileWithSuffix, names: [".env"] }],
    },
    {
      path: "/.git",
      what: "a Git repository's folder, with the site's source and its history",
      patterns: [{ match: SensitivePathMatch.Folder, names: [".git"] }],
    },
    {
      path: "/.svn",
      what: "a Subversion working copy's folder",
      patterns: [{ match: SensitivePathMatch.Folder, names: [".svn"] }],
    },
    {
      path: "/.hg",
      what: "a Mercurial repository's folder",
      patterns: [{ match: SensitivePathMatch.Folder, names: [".hg"] }],
    },
    {
      path: "/.aws",
      what: "AWS credentials (/.aws/credentials)",
      patterns: [{ match: SensitivePathMatch.Folder, names: [".aws"] }],
    },
    {
      path: "/.ssh",
      what: "SSH keys",
      patterns: [{ match: SensitivePathMatch.Folder, names: [".ssh"] }],
    },
    {
      path: "/.vscode",
      what: "an editor's settings, with the credentials of its SFTP extension",
      patterns: [
        { match: SensitivePathMatch.Folder, names: [".vscode"] },
        { match: SensitivePathMatch.File, names: ["sftp-config.json"] },
      ],
    },
    {
      path: "/.htpasswd",
      what: "a web server's password file",
      patterns: [{ match: SensitivePathMatch.File, names: [".htpasswd"] }],
    },
    {
      path: "/.npmrc",
      what: "npm's settings, with a registry token",
      patterns: [{ match: SensitivePathMatch.File, names: [".npmrc"] }],
    },
    {
      path: "/wp-config.php",
      what: "WordPress's configuration, or a copy of it left beside it",
      patterns: [
        { match: SensitivePathMatch.FileWithSuffix, names: ["wp-config"] },
      ],
    },
    {
      path: "/phpinfo.php",
      what: "a page that prints PHP's whole configuration",
      patterns: [{ match: SensitivePathMatch.File, names: ["phpinfo.php"] }],
    },
    {
      path: "/web.config",
      what: "an ASP.NET site's configuration",
      patterns: [{ match: SensitivePathMatch.File, names: ["web.config"] }],
    },
    {
      path: "/actuator/env",
      what: "a Spring Boot app's environment and heap dump",
      patterns: [
        { match: SensitivePathMatch.Ending, names: ["actuator", "env"] },
        { match: SensitivePathMatch.Ending, names: ["actuator", "heapdump"] },
      ],
    },
    /*
     * The admin of an app a site may really run: its entry points only, so
     * a site that runs it, and serves its people the pages behind them,
     * never has its own admins counted - and the app counts once.
     */
    {
      path: "/wp-admin",
      what: "WordPress's admin and its sign-in page",
      patterns: [
        { match: SensitivePathMatch.Ending, names: ["wp-admin"] },
        {
          match: SensitivePathMatch.Ending,
          names: ["wp-admin", "install.php"],
        },
        {
          match: SensitivePathMatch.Ending,
          names: ["wp-admin", "setup-config.php"],
        },
        { match: SensitivePathMatch.File, names: ["wp-login.php"] },
      ],
    },
    {
      path: "/phpmyadmin",
      what: "phpMyAdmin",
      patterns: [
        { match: SensitivePathMatch.Ending, names: ["phpmyadmin"] },
        {
          match: SensitivePathMatch.Ending,
          names: ["phpmyadmin", "index.php"],
        },
      ],
    },
    {
      path: "/server-status",
      what: "Apache's status and server information pages",
      patterns: [
        { match: SensitivePathMatch.Root, names: ["server-status"] },
        { match: SensitivePathMatch.Root, names: ["server-info"] },
      ],
    },
  ];

// The longest request target read for a probe: a sensitive path is short.
export const MAX_PROBE_TARGET_LENGTH: number = 2000;

// A percent-encoded text decoded once, or as it was when it is no valid encoding.
function decodeOnce(text: string): string {
  if (text.indexOf("%") === -1) {
    return text;
  }

  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/*
 * The segments of a request's path, lowercased: its scheme and host, its
 * query and its fragment left out, decoded once, and each segment without
 * the parameters a server reads after a ";" ("/.git;x/config").
 */
export function readRequestPathSegments(target: string): Array<string> {
  let text: string = (target || "").trim();

  if (!text || text.length > MAX_PROBE_TARGET_LENGTH) {
    return [];
  }

  // A full URL: from the path on.
  const scheme: number = text.indexOf("://");

  if (scheme !== -1 && scheme < 10) {
    const pathStart: number = text.indexOf("/", scheme + 3);
    text = pathStart === -1 ? "/" : text.slice(pathStart);
  }

  for (const end of ["?", "#"]) {
    const at: number = text.indexOf(end);

    if (at !== -1) {
      text = text.slice(0, at);
    }
  }

  return decodeOnce(text)
    .toLowerCase()
    .split("/")
    .map((segment: string): string => {
      const parameters: number = segment.indexOf(";");

      return (parameters === -1 ? segment : segment.slice(0, parameters)).trim();
    })
    .filter((segment: string): boolean => {
      return segment.length > 0;
    });
}

function matchesPattern(
  segments: ReadonlyArray<string>,
  pattern: { match: SensitivePathMatch; names: ReadonlyArray<string> },
): boolean {
  const last: string = segments[segments.length - 1] || "";

  switch (pattern.match) {
    case SensitivePathMatch.Folder:
      return pattern.names.some((name: string): boolean => {
        return segments.includes(name);
      });
    case SensitivePathMatch.File:
      return pattern.names.includes(last);
    case SensitivePathMatch.FileWithSuffix:
      return pattern.names.some((name: string): boolean => {
        return last === name || last.startsWith(`${name}.`);
      });
    case SensitivePathMatch.Ending: {
      if (segments.length < pattern.names.length) {
        return false;
      }

      const ending: ReadonlyArray<string> = segments.slice(
        segments.length - pattern.names.length,
      );

      return pattern.names.every((name: string, index: number): boolean => {
        return ending[index] === name;
      });
    }
    case SensitivePathMatch.Root:
      return segments.length === 1 && pattern.names.includes(last);
    default:
      return false;
  }
}

/*
 * The sensitive path a request asks for, as it is counted ("/.env",
 * "/wp-admin"), or null when it asks for none. Read from the request's
 * path alone.
 */
export function readSensitivePath(target: string): string | null {
  const segments: Array<string> = readRequestPathSegments(target);

  if (segments.length === 0) {
    return null;
  }

  for (const sensitive of SENSITIVE_FILE_PROBE_PATHS) {
    for (const pattern of sensitive.patterns) {
      if (matchesPattern(segments, pattern)) {
        return sensitive.path;
      }
    }
  }

  return null;
}

/*
 * The sensitive path a request probed, or null: one of the paths, asked
 * for and refused or not found - its answer a 4xx status. A request the
 * site answered with a page, a redirect or an error of its own, or whose
 * answer no record says, is no probe.
 */
export function readSensitiveFileProbe(data: {
  target: string;
  statusCode: number;
}): string | null {
  if (
    requestOutcomeFromStatusCode(data.statusCode) !==
    SecurityEventRequestOutcome.Rejected
  ) {
    return null;
  }

  return readSensitivePath(data.target);
}

/*
 * The words whose presence in a request makes it worth reading for a
 * probe, lowercased, each with the slash before it: what the log scan and
 * the trace scan ask the database for, beside a refused status, so only
 * those rows leave it. Every path above holds one of them as written.
 */
export const SENSITIVE_FILE_PROBE_WORDS: ReadonlyArray<string> = [
  "/.env",
  "/.git",
  "/.svn",
  "/.hg",
  "/.aws",
  "/.ssh",
  "/.vscode",
  "/sftp-config.json",
  "/.htpasswd",
  "/.npmrc",
  "/wp-config",
  "/phpinfo.php",
  "/web.config",
  "/actuator/env",
  "/actuator/heapdump",
  "/wp-admin",
  "/wp-login.php",
  "/phpmyadmin",
  "/server-status",
  "/server-info",
];

/*
 * How a log line writes a refused or not-found answer, lowercased: after a
 * common log format line's request ("GET /.env HTTP/1.1" 404), and in a
 * JSON access log's status fields as the web attack parser reads them
 * (JSON_STATUS_FIELDS). Loose on purpose: the database is asked for what
 * may hold one, and the parser reads the status exactly.
 */
export const REFUSED_STATUS_LOG_WORDS: ReadonlyArray<string> = [
  '" 4',
  'status":4',
  'status": 4',
  'status":"4',
  'status": "4',
  'status_code":4',
  'status_code": 4',
  'status_code":"4',
  'status_code": "4',
];
