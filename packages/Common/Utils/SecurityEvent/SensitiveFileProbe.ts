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
 * A SENSITIVE FILE THE SITE SERVED (#10912) is a leak, not a scan: a 200
 * for /.env hands the asker the database password and the API keys. But a
 * single-page app answers every path it does not have with its own page
 * and a 200, so "/.env" is "served" while nothing leaks. So for a file that
 * holds secrets (holdsSecrets - never an admin page an app really serves)
 * a 2xx is read for what was sent (readSensitiveFileRequest):
 *
 *   - its type says it is no web page (text/plain, application/octet-
 *     stream, JSON) and it is not empty: the file itself, a leak
 *     (SensitiveFileAnswer.File);
 *   - a web page (text/html): the site's own page, not the file (OwnPage)
 *     - and nothing empty is a leak (Empty);
 *   - a script the server ran (wp-config.php, whose PHP prints nothing):
 *     the site's own, which it has - no probe and no leak, unless its type
 *     says the server sent the script's text;
 *   - nothing recorded says which (an access log records a size, no type):
 *     Unconfirmed, until what the same site answered other paths says it
 *     (judgeSensitiveFileAnswers) - a size that answered two different
 *     paths is the site's page for paths it does not have; a size no other
 *     path got, on a site that refuses the paths it does not have, is the
 *     file. What is still unconfirmed is no event.
 *
 * Every one of those requests is a probe, whatever was sent: nobody asks a
 * site for /.env but a scanner, so a single-page app's scanner counts too.
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
  /*
   * Whether it is a file that holds secrets, which a site never serves on
   * purpose and never as a web page (#10912): a 2xx for it is either the
   * file itself - a leak - or the site's own page for a path it does not
   * have. False for a page an app really serves (WordPress's admin,
   * phpMyAdmin, Apache's status, phpinfo): a 2xx for one says nothing.
   */
  holdsSecrets: boolean;
  // Whether the file is JSON, so a JSON answer can be the file itself (#10912).
  isJsonFile?: boolean | undefined;
  // The names that make a request one of it, lowercased, each as `match` reads it.
  patterns: ReadonlyArray<{ match: SensitivePathMatch; names: Array<string> }>;
}

export const SENSITIVE_FILE_PROBE_PATHS: ReadonlyArray<SensitiveFileProbePath> =
  [
    // Secrets and configuration a browser never asks for.
    {
      path: "/.env",
      what: "an app's environment file, with its database password and API keys",
      holdsSecrets: true,
      patterns: [{ match: SensitivePathMatch.FileWithSuffix, names: [".env"] }],
    },
    {
      path: "/.git",
      what: "a Git repository's folder, with the site's source and its history",
      holdsSecrets: true,
      patterns: [{ match: SensitivePathMatch.Folder, names: [".git"] }],
    },
    {
      path: "/.svn",
      what: "a Subversion working copy's folder",
      holdsSecrets: true,
      patterns: [{ match: SensitivePathMatch.Folder, names: [".svn"] }],
    },
    {
      path: "/.hg",
      what: "a Mercurial repository's folder",
      holdsSecrets: true,
      patterns: [{ match: SensitivePathMatch.Folder, names: [".hg"] }],
    },
    {
      path: "/.aws",
      what: "AWS credentials (/.aws/credentials)",
      holdsSecrets: true,
      patterns: [{ match: SensitivePathMatch.Folder, names: [".aws"] }],
    },
    {
      path: "/.ssh",
      what: "SSH keys",
      holdsSecrets: true,
      patterns: [{ match: SensitivePathMatch.Folder, names: [".ssh"] }],
    },
    {
      path: "/.vscode",
      what: "an editor's settings, with the credentials of its SFTP extension",
      holdsSecrets: true,
      isJsonFile: true,
      patterns: [
        { match: SensitivePathMatch.Folder, names: [".vscode"] },
        { match: SensitivePathMatch.File, names: ["sftp-config.json"] },
      ],
    },
    {
      path: "/.htpasswd",
      what: "a web server's password file",
      holdsSecrets: true,
      patterns: [{ match: SensitivePathMatch.File, names: [".htpasswd"] }],
    },
    {
      path: "/.npmrc",
      what: "npm's settings, with a registry token",
      holdsSecrets: true,
      patterns: [{ match: SensitivePathMatch.File, names: [".npmrc"] }],
    },
    {
      path: "/wp-config.php",
      what: "WordPress's configuration, or a copy of it left beside it",
      holdsSecrets: true,
      patterns: [
        { match: SensitivePathMatch.FileWithSuffix, names: ["wp-config"] },
      ],
    },
    {
      path: "/phpinfo.php",
      what: "a page that prints PHP's whole configuration",
      holdsSecrets: false,
      patterns: [{ match: SensitivePathMatch.File, names: ["phpinfo.php"] }],
    },
    {
      path: "/web.config",
      what: "an ASP.NET site's configuration",
      holdsSecrets: true,
      patterns: [{ match: SensitivePathMatch.File, names: ["web.config"] }],
    },
    {
      path: "/actuator/env",
      what: "a Spring Boot app's environment and heap dump",
      holdsSecrets: true,
      // Its environment is JSON; its heap dump is not, and is sent as a file.
      isJsonFile: true,
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
      holdsSecrets: false,
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
      holdsSecrets: false,
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
      holdsSecrets: false,
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

      return (
        parameters === -1 ? segment : segment.slice(0, parameters)
      ).trim();
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

// ---------- What the site sent (#10912) ----------

/*
 * What a site answered a request for a sensitive path with, as the event
 * says it (web.sensitive_file.answer).
 */
export enum SensitiveFileAnswer {
  // A 4xx: refused, or not there.
  Refused = "refused",
  // A 2xx that was the file itself: a leak.
  File = "file",
  /*
   * A 2xx that was the site's own page - a single-page app's page for any
   * path, a script that ran - or of a type the file is never sent as.
   */
  OwnPage = "own-page",
  // A 2xx with nothing in it: a HEAD, an empty file.
  Empty = "empty",
  // A 2xx, and nothing the source recorded says which: never stored.
  Unconfirmed = "unconfirmed",
}

export const SENSITIVE_FILE_ANSWERS: ReadonlyArray<SensitiveFileAnswer> = [
  SensitiveFileAnswer.Refused,
  SensitiveFileAnswer.File,
  SensitiveFileAnswer.OwnPage,
  SensitiveFileAnswer.Empty,
  SensitiveFileAnswer.Unconfirmed,
];

export function isSensitiveFileAnswer(
  value: unknown,
): value is SensitiveFileAnswer {
  return (
    typeof value === "string" &&
    (SENSITIVE_FILE_ANSWERS as ReadonlyArray<string>).includes(value)
  );
}

// A request for a sensitive path, as it is counted, and what the site answered.
export interface SensitiveFileRequest {
  path: string;
  answer: SensitiveFileAnswer;
}

// What an answer's source recorded besides its status, when it records it.
export interface SensitiveFileResponse {
  // Its Content-Type as recorded ("text/html; charset=utf-8"); '' when not recorded.
  contentType?: string | undefined;
  // Its body's size in bytes; null when not recorded.
  bodySize?: number | null | undefined;
}

// The sensitive path of that name, as it is counted.
export function getSensitiveFileProbePath(
  path: string,
): SensitiveFileProbePath | undefined {
  return SENSITIVE_FILE_PROBE_PATHS.find(
    (candidate: SensitiveFileProbePath): boolean => {
      return candidate.path === path;
    },
  );
}

// The longest Content-Type read: a type is short.
const MAX_CONTENT_TYPE_LENGTH: number = 200;

/*
 * An answer's media type, lowercased and without its parameters
 * ("text/html"), from a Content-Type as a source records it: a header's
 * value, or the list OpenTelemetry records a header as ('["text/html"]').
 * '' when there is none.
 */
export function readContentType(value: unknown): string {
  let text: string = "";

  if (Array.isArray(value)) {
    text = typeof value[0] === "string" ? value[0] : "";
  } else if (typeof value === "string") {
    text = value.trim();

    if (text.startsWith("[") && text.length <= MAX_CONTENT_TYPE_LENGTH) {
      try {
        const parsed: unknown = JSON.parse(text);
        text =
          Array.isArray(parsed) && typeof parsed[0] === "string"
            ? parsed[0]
            : "";
      } catch {
        text = "";
      }
    }
  }

  if (!text || text.length > MAX_CONTENT_TYPE_LENGTH) {
    return "";
  }

  const parameters: number = text.indexOf(";");

  return (parameters === -1 ? text : text.slice(0, parameters))
    .trim()
    .toLowerCase();
}

// Whether a media type is a web page's.
export function isWebPageContentType(contentType: string): boolean {
  return contentType === "text/html" || contentType === "application/xhtml+xml";
}

// Whether a media type is JSON's: "application/json" or a "+json" one.
export function isJsonContentType(contentType: string): boolean {
  return contentType === "application/json" || contentType.endsWith("+json");
}

/*
 * A body's size from a value a source recorded: a whole number of bytes,
 * or "-" (common log format's none, which is 0); null for anything else.
 */
export function readBodySize(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  }

  if (typeof value !== "string") {
    return null;
  }

  const text: string = value.trim();

  if (text === "-") {
    return 0;
  }

  if (!text || text.length > 15) {
    return null;
  }

  for (let index: number = 0; index < text.length; index++) {
    const code: number = text.charCodeAt(index);

    if (code < 48 || code > 57) {
      return null;
    }
  }

  return Number(text);
}

// The extensions of a script a web server runs, rather than sends.
const SCRIPT_EXTENSIONS: ReadonlyArray<string> = [
  ".php",
  ".phtml",
  ".asp",
  ".aspx",
  ".jsp",
  ".cgi",
];

/*
 * Whether a request's file is a script the server runs: what it answers is
 * the script's output - WordPress's wp-config.php prints nothing - never
 * the file, unless its type says so.
 */
function isScript(segments: ReadonlyArray<string>): boolean {
  const last: string = segments[segments.length - 1] || "";

  return SCRIPT_EXTENSIONS.some((extension: string): boolean => {
    return last.endsWith(extension);
  });
}

/*
 * What a 2xx for a file that holds secrets was (#10912): the file, when its
 * type says so and it is not empty; the site's own page, when it is a web
 * page or of a type the file is never sent as; nothing, when it is empty;
 * and unconfirmed when nothing recorded says. A script the server runs -
 * WordPress's wp-config.php - answers with what it printed: the site has
 * it and ran it, so it is no probe and no leak (null), unless its type says
 * the server sent its text.
 */
function readServedAnswer(data: {
  definition: SensitiveFileProbePath;
  segments: ReadonlyArray<string>;
  statusCode: number;
  contentType: string;
  bodySize: number | null;
}): SensitiveFileAnswer | null {
  // No Content, or a body of none: nothing was taken.
  const isEmpty: boolean = data.statusCode === 204 || data.bodySize === 0;
  /*
   * A type the file is sent as: no web page, and JSON only for a file that
   * is JSON - an API answers a path it does not have with JSON of its own.
   */
  const isTheFilesType: boolean =
    Boolean(data.contentType) &&
    !isWebPageContentType(data.contentType) &&
    !(isJsonContentType(data.contentType) && !data.definition.isJsonFile);

  if (isScript(data.segments)) {
    return isTheFilesType && !isEmpty ? SensitiveFileAnswer.File : null;
  }

  if (isEmpty) {
    return SensitiveFileAnswer.Empty;
  }

  if (data.contentType) {
    return isTheFilesType
      ? SensitiveFileAnswer.File
      : SensitiveFileAnswer.OwnPage;
  }

  return SensitiveFileAnswer.Unconfirmed;
}

/*
 * A request for a sensitive path and what the site answered it with
 * (#10912), or null when it is none to read:
 *
 *   - any of the paths, refused or not found (a 4xx): Refused, a probe, as
 *     readSensitiveFileProbe reads it;
 *   - a file that holds secrets, answered with a 2xx: what was sent -
 *     the file, the site's own page, nothing, or unconfirmed;
 *   - anything else - an admin page the site serves, a redirect, an error
 *     of its own, or no status recorded: null, no probe.
 */
export function readSensitiveFileRequest(
  data: { target: string; statusCode: number } & SensitiveFileResponse,
): SensitiveFileRequest | null {
  const path: string | null = readSensitivePath(data.target);

  if (!path) {
    return null;
  }

  if (
    requestOutcomeFromStatusCode(data.statusCode) ===
    SecurityEventRequestOutcome.Rejected
  ) {
    return { path, answer: SensitiveFileAnswer.Refused };
  }

  if (
    !Number.isInteger(data.statusCode) ||
    data.statusCode < 200 ||
    data.statusCode > 299
  ) {
    return null;
  }

  const definition: SensitiveFileProbePath | undefined =
    getSensitiveFileProbePath(path);

  if (!definition || !definition.holdsSecrets) {
    return null;
  }

  const answer: SensitiveFileAnswer | null = readServedAnswer({
    definition,
    segments: readRequestPathSegments(data.target),
    statusCode: data.statusCode,
    contentType: readContentType(data.contentType || ""),
    bodySize:
      data.bodySize === undefined || data.bodySize === null
        ? null
        : readBodySize(data.bodySize),
  });

  return answer ? { path, answer } : null;
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

/*
 * The words of the paths that hold secrets (holdsSecrets), lowercased, each
 * with the slash before it (#10912): what the log scan and the trace scan
 * ask the database for beside a 2xx status, so a request for /.env the site
 * answered leaves it, and a WordPress site's own admin pages, which it
 * serves, never do. Every path that holds secrets holds one of them.
 */
export const SENSITIVE_FILE_SECRET_WORDS: ReadonlyArray<string> = [
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
  "/web.config",
  "/actuator/env",
  "/actuator/heapdump",
];

/*
 * How a log line writes a 2xx answer, lowercased, as REFUSED_STATUS_LOG_WORDS
 * writes a 4xx: after a common log format line's request, and in a JSON
 * access log's status fields. Loose on purpose, as they are.
 */
export const SERVED_STATUS_LOG_WORDS: ReadonlyArray<string> = [
  '" 2',
  'status":2',
  'status": 2',
  'status":"2',
  'status": "2',
  'status_code":2',
  'status_code": 2',
  'status_code":"2',
  'status_code": "2',
];
