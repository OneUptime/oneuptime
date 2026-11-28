import { JSONArray, JSONObject, JSONValue } from "../../Types/JSON";
import NormalizedSecurityEvent from "../../Types/SecurityEvent/NormalizedSecurityEvent";
import OcsfSeverity, {
  OcsfSeverityId,
} from "../../Types/SecurityEvent/OcsfSeverity";
import SecurityEventRequestOutcome, {
  SECURITY_REQUEST_ATTRIBUTES,
} from "../../Types/SecurityEvent/SecurityEventRequestOutcome";
import { SECURITY_LOG_RESOURCE_ID_ATTRIBUTE } from "../../Types/SecurityCase/SecurityConnection";
import {
  SENSITIVE_FILE_SERVED_LABEL,
  WEB_ATTACK_KIND_ATTRIBUTE,
  WEB_ATTACK_LABELS,
  WEB_SENSITIVE_FILE_ANSWER_ATTRIBUTE,
  WebAttackKind,
  outcomeForSensitiveFile,
  severityForSensitiveFile,
} from "./LogParsers/WebAttackLogParser";
import { readStatusCode } from "./RequestOutcome";
import {
  SensitiveFileAnswer,
  isSensitiveFileAnswer,
  readBodySize,
  readRequestPathSegments,
} from "./SensitiveFileProbe";

/*
 * WHAT THE SAME SITE ANSWERED OTHER PATHS (#10912), AND BEFORE (#11036).
 *
 * A request for a file that holds secrets, answered with a 2xx whose type
 * nothing recorded - a common log format line records a size and no type -
 * is unconfirmed by itself (SensitiveFileProbe): the file, or the site's
 * own page for a path it does not have? What the same site answered the
 * other requests of the batch says which - a scanner asks for many paths
 * at once:
 *
 *   - a size that answered two different paths is the site's own page for
 *     paths it does not have - a single-page app answers every one of them
 *     with the same page: "/.env" and "/.git/config" both 200 and 1,789
 *     bytes are no leak;
 *   - a size no other path got, on a site that answered another of those
 *     paths "not found" (a 404 or a 410: it refuses what it does not have,
 *     so it has no page for every path), is the file itself: "/.env" 200
 *     and 412 bytes beside "/.git/config" 404 is a leak. A 403 is no such
 *     sign: a server that refuses every path that starts with a dot, in
 *     front of a single-page app, refuses them all the same;
 *   - anything else stays unconfirmed, and is no event: OneUptime says
 *     nothing it cannot tell.
 *
 * A scanner that asks for /.env alone leaves a batch that holds nothing to
 * compare it with. So the scans remember, per site, what the batches of the
 * last day said of it (SensitiveFileMemory, #11036), and a request is judged
 * by that too, exactly as by its batch:
 *
 *   - when the site last answered a request for a sensitive path "not
 *     found";
 *   - the sizes its own page was answered with;
 *   - the sizes of the answers nothing decided, and the paths that got
 *     them - a size two different paths got, a day apart or not, is its
 *     own page as much as one batch's two are;
 *   - the sizes it served a file with, and for which paths - a size a file
 *     of another path was served with is no proof of a file: the site's
 *     page may have that size since (a site that moved to a single-page
 *     app), so a request of it stays unconfirmed.
 *
 * So a lone "/.env" 200 and 412 bytes, on a site that answered "/.git/config"
 * 404 an hour ago and whose own page was never seen, is the file; the same
 * request answered with the 1,789 bytes its own page was answered with is
 * that page. And a site whose memory says nothing is judged as before, by its
 * batch alone: a day that never saw it answer "not found" never makes a
 * request of it the file.
 *
 * A site is the record the event was sent under - the host or service
 * whose logs or spans held it - and the host its URL names. A request is
 * its path, lowercased and decoded once, without its query.
 *
 * Every event this decides is said as what it is: the file is Critical and
 * its message says "Sensitive file served"; the site's own page is a probe
 * that found nothing, Low, and turned away - so is one the site answered
 * with nothing, however a trace it was followed into read its status.
 *
 * Pure: the log scan and the trace scan hand it each page of events before
 * they are stored, and store what it keeps. The memory is the scan's to read
 * and keep (Server/Utils/SecurityEvent/SensitiveFileSiteMemoryStore): one
 * read and at most one write a scan, whatever the number of sites.
 */

// What a site answered, and how much, for the requests of one batch.
interface SiteAnswers {
  // The sizes each of its unconfirmed or own-page answers had, by the paths that got each.
  pathsBySize: Map<number, Set<string>>;
  // Whether it answered a request for a sensitive path "not found".
  refusesUnknownPaths: boolean;
}

// The statuses that say a site has no such path: never a 403, which a deny rule writes.
const NOT_FOUND_STATUSES: ReadonlyArray<number> = [404, 410];

function attributeText(event: NormalizedSecurityEvent, key: string): string {
  const value: unknown = event.attributes[key];

  return typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
}

// Whether an event is a request for a sensitive file, and what the site answered it.
function answerOf(event: NormalizedSecurityEvent): SensitiveFileAnswer | null {
  if (
    attributeText(event, WEB_ATTACK_KIND_ATTRIBUTE) !==
    WebAttackKind.SensitiveFile
  ) {
    return null;
  }

  const answer: string = attributeText(
    event,
    WEB_SENSITIVE_FILE_ANSWER_ATTRIBUTE,
  );

  return isSensitiveFileAnswer(answer) ? answer : null;
}

// The host a URL names, lowercased; '' for a path alone.
function hostOf(url: string): string {
  const scheme: number = url.indexOf("://");

  if (scheme === -1 || scheme > 10) {
    return "";
  }

  const rest: string = url.slice(scheme + 3);
  let end: number = rest.length;

  for (const stop of ["/", "?", "#"]) {
    const at: number = rest.indexOf(stop);

    if (at !== -1 && at < end) {
      end = at;
    }
  }

  return rest.slice(0, end).toLowerCase();
}

function urlOf(event: NormalizedSecurityEvent): string {
  return (
    attributeText(event, SECURITY_REQUEST_ATTRIBUTES.url) ||
    event.targetResource ||
    ""
  );
}

// The site an event's request was sent to: the record it came under, and its URL's host.
export function getSensitiveFileSiteKey(
  event: NormalizedSecurityEvent,
): string {
  return `${attributeText(event, SECURITY_LOG_RESOURCE_ID_ATTRIBUTE)}|${hostOf(
    urlOf(event),
  )}`;
}

// The path an event's request asked for, as it is compared: lowercased, decoded once, no query.
export function getSensitiveFileRequestPath(
  event: NormalizedSecurityEvent,
): string {
  return `/${readRequestPathSegments(urlOf(event)).join("/")}`;
}

function sizeOf(event: NormalizedSecurityEvent): number | null {
  const text: string = attributeText(
    event,
    SECURITY_REQUEST_ATTRIBUTES.responseBodySize,
  );

  return text ? readBodySize(text) : null;
}

// Whether a refusal was "not found": the site has no such path.
function isNotFound(event: NormalizedSecurityEvent): boolean {
  return NOT_FOUND_STATUSES.includes(
    readStatusCode(
      attributeText(event, SECURITY_REQUEST_ATTRIBUTES.statusCode),
    ),
  );
}

function readSiteAnswers(
  events: ReadonlyArray<NormalizedSecurityEvent>,
): Map<string, SiteAnswers> {
  const sites: Map<string, SiteAnswers> = new Map();

  for (const event of events) {
    const answer: SensitiveFileAnswer | null = answerOf(event);

    if (!answer) {
      continue;
    }

    const key: string = getSensitiveFileSiteKey(event);
    let site: SiteAnswers | undefined = sites.get(key);

    if (!site) {
      site = { pathsBySize: new Map(), refusesUnknownPaths: false };
      sites.set(key, site);
    }

    if (answer === SensitiveFileAnswer.Refused) {
      if (isNotFound(event)) {
        site.refusesUnknownPaths = true;
      }

      continue;
    }

    if (
      answer !== SensitiveFileAnswer.Unconfirmed &&
      answer !== SensitiveFileAnswer.OwnPage
    ) {
      continue;
    }

    const size: number | null = sizeOf(event);

    if (size === null || size <= 0) {
      continue;
    }

    const paths: Set<string> = site.pathsBySize.get(size) || new Set();
    paths.add(getSensitiveFileRequestPath(event));
    site.pathsBySize.set(size, paths);
  }

  return sites;
}

/*
 * ---------------------------------------------------------------------------
 * The memory of what each site answered in the last day (#11036)
 * ---------------------------------------------------------------------------
 */

// How long what a site answered is remembered: a day, as the issue put it.
export const SENSITIVE_FILE_MEMORY_IN_HOURS: number = 24;

const MEMORY_IN_MS: number = SENSITIVE_FILE_MEMORY_IN_HOURS * 60 * 60 * 1000;

/*
 * How often a fact already remembered is written again only to move its
 * time on: a site scanned every minute is written once an hour, not once a
 * scan, for what it keeps saying.
 */
export const SENSITIVE_FILE_MEMORY_REFRESH_IN_MINUTES: number = 60;

const REFRESH_IN_MS: number =
  SENSITIVE_FILE_MEMORY_REFRESH_IN_MINUTES * 60 * 1000;

/*
 * What one project's memory holds at most, each kept the most recent first:
 * the sites, and of each the sizes of its own page, its undecided answers and
 * the files it served. A scanner that sprays made-up hosts only pushes the
 * oldest sites out, whose next lone request is then judged by its batch, as
 * before - never the other way.
 */
export const MAX_REMEMBERED_SITES: number = 100;
export const MAX_REMEMBERED_OWN_PAGE_SIZES: number = 4;
export const MAX_REMEMBERED_UNDECIDED_ANSWERS: number = 6;
export const MAX_REMEMBERED_SERVED_FILES: number = 3;

/*
 * A site or a path too long to be one a person runs is not remembered: an
 * attacker writes them.
 */
export const MAX_REMEMBERED_SITE_KEY_LENGTH: number = 300;
export const MAX_REMEMBERED_PATH_LENGTH: number = 200;

/*
 * The most a kept memory weighs, in UTF-8 bytes, whatever its hosts and
 * paths: the sites past it, the least recently seen, are left out. One scan
 * reads and writes no more than this.
 */
export const MAX_SENSITIVE_FILE_MEMORY_BYTES: number = 32 * 1024;

// The shape the memory is kept in; one of another shape reads as none.
export const SENSITIVE_FILE_MEMORY_VERSION: number = 1;

// What one site answered in the last day, each fact with when it was last seen (ms).
export interface SensitiveFileSiteMemory {
  // When it last answered a request for a sensitive path "not found"; null if it did not.
  notFoundAt: number | null;
  // The sizes its own page was answered with.
  ownPageSizes: Map<number, number>;
  // The sizes of its answers nothing decided, by the paths that got each.
  undecided: Map<number, Map<string, number>>;
  // The sizes it served a file with, by the paths of those files.
  served: Map<number, Map<string, number>>;
  // When anything of it was last seen: the sites kept when there are too many.
  seenAt: number;
}

export interface SensitiveFileMemory {
  sites: Map<string, SensitiveFileSiteMemory>;
  // The scan's now, in ms: a fact older than a day before it is forgotten.
  now: number;
  // Whether a batch taught it something worth keeping since it was made.
  isChanged: boolean;
}

export function createSensitiveFileMemory(now: Date): SensitiveFileMemory {
  return { sites: new Map(), now: now.getTime(), isChanged: false };
}

function isFresh(at: number, now: number): boolean {
  return at >= now - MEMORY_IN_MS;
}

function readTime(value: JSONValue | undefined, now: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }

  // Never later than now: a clock ahead of this one keeps nothing longer.
  const at: number = Math.min(Math.trunc(value), now);

  return isFresh(at, now) ? at : null;
}

function readRememberedSize(value: JSONValue | undefined): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : null;
}

function readRememberedPath(value: JSONValue | undefined): string | null {
  return typeof value === "string" &&
    value.startsWith("/") &&
    value.length <= MAX_REMEMBERED_PATH_LENGTH
    ? value
    : null;
}

function readEntries(value: JSONValue | undefined): Array<JSONObject> {
  if (!Array.isArray(value)) {
    return [];
  }

  return (value as Array<unknown>).filter((entry: unknown): boolean => {
    return Boolean(entry) && typeof entry === "object" && !Array.isArray(entry);
  }) as Array<JSONObject>;
}

function createSiteMemory(seenAt: number): SensitiveFileSiteMemory {
  return {
    notFoundAt: null,
    ownPageSizes: new Map(),
    undecided: new Map(),
    served: new Map(),
    seenAt,
  };
}

function readPathEntries(
  value: JSONValue | undefined,
  now: number,
): Map<number, Map<string, number>> {
  const bySize: Map<number, Map<string, number>> = new Map();

  for (const entry of readEntries(value)) {
    const size: number | null = readRememberedSize(entry["size"]);
    const path: string | null = readRememberedPath(entry["path"]);
    const at: number | null = readTime(entry["at"], now);

    if (size === null || path === null || at === null) {
      continue;
    }

    const paths: Map<string, number> = bySize.get(size) || new Map();
    paths.set(path, Math.max(paths.get(path) || 0, at));
    bySize.set(size, paths);
  }

  return bySize;
}

function readSiteMemory(
  value: JSONValue | undefined,
  now: number,
): SensitiveFileSiteMemory | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const body: JSONObject = value as JSONObject;
  const site: SensitiveFileSiteMemory = createSiteMemory(0);

  site.notFoundAt = readTime(body["notFoundAt"], now);

  for (const entry of readEntries(body["ownPage"])) {
    const size: number | null = readRememberedSize(entry["size"]);
    const at: number | null = readTime(entry["at"], now);

    if (size !== null && at !== null) {
      site.ownPageSizes.set(
        size,
        Math.max(site.ownPageSizes.get(size) || 0, at),
      );
    }
  }

  site.undecided = readPathEntries(body["undecided"], now);
  site.served = readPathEntries(body["served"], now);
  site.seenAt = readTime(body["seenAt"], now) || latestOf(site);

  return hasFacts(site) ? site : null;
}

// The latest time of anything a site's memory holds; 0 when it holds nothing.
function latestOf(site: SensitiveFileSiteMemory): number {
  let latest: number = site.notFoundAt || 0;

  for (const at of site.ownPageSizes.values()) {
    latest = Math.max(latest, at);
  }

  for (const bySize of [site.undecided, site.served]) {
    for (const paths of bySize.values()) {
      for (const at of paths.values()) {
        latest = Math.max(latest, at);
      }
    }
  }

  return latest;
}

function hasFacts(site: SensitiveFileSiteMemory): boolean {
  return (
    site.notFoundAt !== null ||
    site.ownPageSizes.size > 0 ||
    site.undecided.size > 0 ||
    site.served.size > 0
  );
}

/*
 * A memory as it was kept (writeSensitiveFileMemory), read defensively: a
 * shape it does not know, a fact older than a day before `now`, a size that
 * is no whole number of bytes or a path that is no path reads as nothing.
 */
export function readSensitiveFileMemory(
  value: JSONValue | null | undefined,
  now: Date,
): SensitiveFileMemory {
  const memory: SensitiveFileMemory = createSensitiveFileMemory(now);

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return memory;
  }

  const body: JSONObject = value as JSONObject;

  if (body["version"] !== SENSITIVE_FILE_MEMORY_VERSION) {
    return memory;
  }

  const sites: JSONValue | undefined = body["sites"];

  if (!sites || typeof sites !== "object" || Array.isArray(sites)) {
    return memory;
  }

  for (const [key, siteValue] of Object.entries(sites as JSONObject)) {
    if (!isRememberedSiteKey(key)) {
      continue;
    }

    const site: SensitiveFileSiteMemory | null = readSiteMemory(
      siteValue,
      memory.now,
    );

    if (site) {
      memory.sites.set(key, site);
    }
  }

  return memory;
}

/*
 * A site the memory keeps: one an event names the record of - a site with
 * no record could be any of the project's sources - and short enough.
 */
function isRememberedSiteKey(key: string): boolean {
  return key.length <= MAX_REMEMBERED_SITE_KEY_LENGTH && key.indexOf("|") > 0;
}

// The most recent entries first, then the smaller size, so a write is the same for the same memory.
function sortedEntries<T extends { size: number; at: number }>(
  entries: Array<T>,
): Array<T> {
  return entries.sort((a: T, b: T): number => {
    return b.at - a.at || a.size - b.size;
  });
}

function writePathEntries(
  bySize: Map<number, Map<string, number>>,
  now: number,
  limit: number,
): JSONArray {
  const entries: Array<{ size: number; path: string; at: number }> = [];

  for (const [size, paths] of bySize) {
    for (const [path, at] of paths) {
      if (isFresh(at, now)) {
        entries.push({ size, path, at });
      }
    }
  }

  return entries
    .sort(
      (
        a: { size: number; path: string; at: number },
        b: { size: number; path: string; at: number },
      ): number => {
        return b.at - a.at || a.size - b.size || (a.path < b.path ? -1 : 1);
      },
    )
    .slice(0, limit)
    .map((entry: { size: number; path: string; at: number }): JSONObject => {
      return { size: entry.size, path: entry.path, at: entry.at };
    });
}

function writeSiteMemory(
  site: SensitiveFileSiteMemory,
  now: number,
): JSONObject | null {
  const body: JSONObject = {};

  if (site.notFoundAt !== null && isFresh(site.notFoundAt, now)) {
    body["notFoundAt"] = site.notFoundAt;
  }

  const ownPage: JSONArray = sortedEntries(
    Array.from(site.ownPageSizes.entries())
      .filter(([, at]: [number, number]): boolean => {
        return isFresh(at, now);
      })
      .map(([size, at]: [number, number]): { size: number; at: number } => {
        return { size, at };
      }),
  )
    .slice(0, MAX_REMEMBERED_OWN_PAGE_SIZES)
    .map((entry: { size: number; at: number }): JSONObject => {
      return { size: entry.size, at: entry.at };
    });

  const undecided: JSONArray = writePathEntries(
    site.undecided,
    now,
    MAX_REMEMBERED_UNDECIDED_ANSWERS,
  );
  const served: JSONArray = writePathEntries(
    site.served,
    now,
    MAX_REMEMBERED_SERVED_FILES,
  );

  if (ownPage.length > 0) {
    body["ownPage"] = ownPage;
  }

  if (undecided.length > 0) {
    body["undecided"] = undecided;
  }

  if (served.length > 0) {
    body["served"] = served;
  }

  if (Object.keys(body).length === 0) {
    return null;
  }

  body["seenAt"] = site.seenAt;

  return body;
}

// A text's length in UTF-8 bytes, as the cache stores it.
export function getUtf8ByteLength(text: string): number {
  let bytes: number = 0;

  for (let index: number = 0; index < text.length; index++) {
    const code: number = text.charCodeAt(index);

    if (code < 0x80) {
      bytes += 1;
    } else if (code < 0x800) {
      bytes += 2;
    } else if (
      code >= 0xd800 &&
      code <= 0xdbff &&
      index + 1 < text.length &&
      text.charCodeAt(index + 1) >= 0xdc00 &&
      text.charCodeAt(index + 1) <= 0xdfff
    ) {
      // A pair of surrogates is one character of four bytes.
      bytes += 4;
      index++;
    } else {
      bytes += 3;
    }
  }

  return bytes;
}

/*
 * The memory as it is kept: the facts of the last day before its `now`, at
 * most MAX_REMEMBERED_SITES sites - the most recently seen - and of each at
 * most the caps above, the most recent first; the whole of it at most
 * MAX_SENSITIVE_FILE_MEMORY_BYTES as JSON.
 */
export function writeSensitiveFileMemory(
  memory: SensitiveFileMemory,
): JSONObject {
  const sites: JSONObject = {};
  const kept: Array<[string, SensitiveFileSiteMemory]> = Array.from(
    memory.sites.entries(),
  )
    .filter(([key]: [string, SensitiveFileSiteMemory]): boolean => {
      return isRememberedSiteKey(key);
    })
    .sort(
      (
        a: [string, SensitiveFileSiteMemory],
        b: [string, SensitiveFileSiteMemory],
      ): number => {
        return b[1].seenAt - a[1].seenAt || (a[0] < b[0] ? -1 : 1);
      },
    );

  // The envelope, then each site's `"key":{...}` and the comma between two.
  let bytes: number = getUtf8ByteLength(
    JSON.stringify({ version: SENSITIVE_FILE_MEMORY_VERSION, sites: {} }),
  );
  let count: number = 0;

  for (const [key, site] of kept) {
    if (count >= MAX_REMEMBERED_SITES) {
      break;
    }

    const body: JSONObject | null = writeSiteMemory(site, memory.now);

    if (!body) {
      continue;
    }

    const siteBytes: number =
      getUtf8ByteLength(`${JSON.stringify(key)}:${JSON.stringify(body)}`) +
      (count > 0 ? 1 : 0);

    if (bytes + siteBytes > MAX_SENSITIVE_FILE_MEMORY_BYTES) {
      break;
    }

    sites[key] = body;
    bytes += siteBytes;
    count++;
  }

  return { version: SENSITIVE_FILE_MEMORY_VERSION, sites };
}

function mergePathEntries(
  into: Map<number, Map<string, number>>,
  from: Map<number, Map<string, number>>,
): void {
  for (const [size, paths] of from) {
    const intoPaths: Map<string, number> = into.get(size) || new Map();

    for (const [path, at] of paths) {
      intoPaths.set(path, Math.max(intoPaths.get(path) || 0, at));
    }

    into.set(size, intoPaths);
  }
}

/*
 * What `from` remembers, added to `into`: each fact once, at its latest
 * time. Whether `into` has something to keep is left as it was - what was
 * kept already needs no keeping again.
 */
export function mergeSensitiveFileMemory(
  into: SensitiveFileMemory,
  from: SensitiveFileMemory,
): void {
  for (const [key, site] of from.sites) {
    const intoSite: SensitiveFileSiteMemory | undefined = into.sites.get(key);

    if (!intoSite) {
      into.sites.set(key, {
        notFoundAt: site.notFoundAt,
        ownPageSizes: new Map(site.ownPageSizes),
        undecided: new Map(
          Array.from(site.undecided.entries()).map(
            ([size, paths]: [number, Map<string, number>]): [
              number,
              Map<string, number>,
            ] => {
              return [size, new Map(paths)];
            },
          ),
        ),
        served: new Map(
          Array.from(site.served.entries()).map(
            ([size, paths]: [number, Map<string, number>]): [
              number,
              Map<string, number>,
            ] => {
              return [size, new Map(paths)];
            },
          ),
        ),
        seenAt: site.seenAt,
      });
      continue;
    }

    if (
      site.notFoundAt !== null &&
      (intoSite.notFoundAt === null || site.notFoundAt > intoSite.notFoundAt)
    ) {
      intoSite.notFoundAt = site.notFoundAt;
    }

    for (const [size, at] of site.ownPageSizes) {
      intoSite.ownPageSizes.set(
        size,
        Math.max(intoSite.ownPageSizes.get(size) || 0, at),
      );
    }

    mergePathEntries(intoSite.undecided, site.undecided);
    mergePathEntries(intoSite.served, site.served);
    intoSite.seenAt = Math.max(intoSite.seenAt, site.seenAt);
  }
}

/*
 * Whether judging these events reads the memory: only a request whose answer
 * nothing recorded asks what its site answered before.
 */
export function isSensitiveFileMemoryNeeded(
  events: ReadonlyArray<NormalizedSecurityEvent>,
): boolean {
  return events.some((event: NormalizedSecurityEvent): boolean => {
    return answerOf(event) === SensitiveFileAnswer.Unconfirmed;
  });
}

// When an event happened, as the memory keeps it: never later than its now.
function timeOf(event: NormalizedSecurityEvent, now: number): number {
  const time: number =
    event.time instanceof Date ? event.time.getTime() : Number.NaN;

  return Number.isFinite(time) ? Math.min(time, now) : now;
}

/*
 * A fact's time moved on: whether it is worth writing again - a fact new to
 * the memory, or one last written more than the refresh ago.
 */
function moveOn(previous: number | undefined, at: number): boolean {
  return previous === undefined || at - previous >= REFRESH_IN_MS;
}

function rememberPath(data: {
  bySize: Map<number, Map<string, number>>;
  size: number;
  path: string;
  at: number;
}): boolean {
  const paths: Map<string, number> = data.bySize.get(data.size) || new Map();
  const previous: number | undefined = paths.get(data.path);

  if (previous !== undefined && previous >= data.at) {
    return false;
  }

  paths.set(data.path, data.at);
  data.bySize.set(data.size, paths);

  return moveOn(previous, data.at);
}

/*
 * What a judged batch says of each of its sites, added to the memory: a "not
 * found", the size of its own page, a file it served, and an answer nothing
 * decided - which becomes its own page's size once another path got it too.
 */
function rememberSensitiveFileAnswers(
  memory: SensitiveFileMemory,
  events: ReadonlyArray<NormalizedSecurityEvent>,
): void {
  for (const event of events) {
    const answer: SensitiveFileAnswer | null = answerOf(event);

    if (!answer) {
      continue;
    }

    const key: string = getSensitiveFileSiteKey(event);

    if (!isRememberedSiteKey(key)) {
      continue;
    }

    const at: number = timeOf(event, memory.now);

    if (!isFresh(at, memory.now)) {
      continue;
    }

    const fact: RememberedFact | null = readFact(event, answer);

    if (!fact) {
      continue;
    }

    let site: SensitiveFileSiteMemory | undefined = memory.sites.get(key);

    if (!site) {
      site = createSiteMemory(at);
      memory.sites.set(key, site);
    }

    site.seenAt = Math.max(site.seenAt, at);

    if (rememberFact(site, fact, at)) {
      memory.isChanged = true;
    }
  }
}

// What one answer says of its site, as the memory keeps it.
type RememberedFact =
  | { kind: "not-found" }
  | { kind: "own-page"; size: number }
  | { kind: "served" | "undecided"; size: number; path: string };

/*
 * The fact an answer adds, or null: a "not found" (never a 403), the size of
 * the site's own page, a file it served, an answer nothing decided - each
 * of a size of bytes, and a path short enough to be one a person runs. An
 * answer with nothing in it says nothing of the site.
 */
function readFact(
  event: NormalizedSecurityEvent,
  answer: SensitiveFileAnswer,
): RememberedFact | null {
  if (answer === SensitiveFileAnswer.Refused) {
    return isNotFound(event) ? { kind: "not-found" } : null;
  }

  const size: number | null = sizeOf(event);

  if (answer === SensitiveFileAnswer.Empty || size === null || size <= 0) {
    return null;
  }

  if (answer === SensitiveFileAnswer.OwnPage) {
    return { kind: "own-page", size };
  }

  const path: string = getSensitiveFileRequestPath(event);

  if (path.length > MAX_REMEMBERED_PATH_LENGTH) {
    return null;
  }

  return {
    kind: answer === SensitiveFileAnswer.File ? "served" : "undecided",
    size,
    path,
  };
}

// A fact added to a site's memory; whether it is worth writing again.
function rememberFact(
  site: SensitiveFileSiteMemory,
  fact: RememberedFact,
  at: number,
): boolean {
  if (fact.kind === "not-found") {
    const previous: number | null = site.notFoundAt;

    if (previous !== null && previous >= at) {
      return false;
    }

    site.notFoundAt = at;

    return moveOn(previous === null ? undefined : previous, at);
  }

  if (fact.kind === "own-page") {
    return rememberOwnPageSize(site, fact.size, at);
  }

  if (fact.kind === "served") {
    return rememberPath({
      bySize: site.served,
      size: fact.size,
      path: fact.path,
      at,
    });
  }

  const isNew: boolean = rememberPath({
    bySize: site.undecided,
    size: fact.size,
    path: fact.path,
    at,
  });

  // Another path got this size too, a day apart or not: its own page.
  if ((site.undecided.get(fact.size)?.size || 0) >= 2) {
    return rememberOwnPageSize(site, fact.size, at) || isNew;
  }

  return isNew;
}

function rememberOwnPageSize(
  site: SensitiveFileSiteMemory,
  size: number,
  at: number,
): boolean {
  const previous: number | undefined = site.ownPageSizes.get(size);

  if (previous !== undefined && previous >= at) {
    return false;
  }

  site.ownPageSizes.set(size, at);

  return moveOn(previous, at);
}

// What a site's memory says, for one request: only what is fresh at the memory's now.
interface RememberedAnswers {
  notFound: boolean;
  ownPageSizes: Set<number>;
  // The undecided answers' paths, by size.
  undecidedPathsBySize: Map<number, Set<string>>;
  // The served files' paths, by size.
  servedPathsBySize: Map<number, Set<string>>;
}

function freshPaths(
  bySize: Map<number, Map<string, number>>,
  now: number,
): Map<number, Set<string>> {
  const fresh: Map<number, Set<string>> = new Map();

  for (const [size, paths] of bySize) {
    for (const [path, at] of paths) {
      if (isFresh(at, now)) {
        const set: Set<string> = fresh.get(size) || new Set();
        set.add(path);
        fresh.set(size, set);
      }
    }
  }

  return fresh;
}

function readRemembered(
  memory: SensitiveFileMemory | undefined,
  key: string,
): RememberedAnswers | null {
  const site: SensitiveFileSiteMemory | undefined = memory?.sites.get(key);

  if (!memory || !site || !isRememberedSiteKey(key)) {
    return null;
  }

  const ownPageSizes: Set<number> = new Set();

  for (const [size, at] of site.ownPageSizes) {
    if (isFresh(at, memory.now)) {
      ownPageSizes.add(size);
    }
  }

  return {
    notFound: site.notFoundAt !== null && isFresh(site.notFoundAt, memory.now),
    ownPageSizes,
    undecidedPathsBySize: freshPaths(site.undecided, memory.now),
    servedPathsBySize: freshPaths(site.served, memory.now),
  };
}

/*
 * The sizes a site's own page was answered with: a size two different paths
 * got - in the batch, or once in the batch and once before, or twice before -
 * and each size the memory already holds as its own page.
 */
function ownPageSizesOf(
  site: SiteAnswers | undefined,
  remembered: RememberedAnswers | null,
): Set<number> {
  const sizes: Set<number> = new Set(remembered?.ownPageSizes || []);
  const pathsBySize: Map<number, Set<string>> = new Map();

  for (const source of [site?.pathsBySize, remembered?.undecidedPathsBySize]) {
    for (const [size, paths] of source || new Map<number, Set<string>>()) {
      const all: Set<string> = pathsBySize.get(size) || new Set();

      for (const path of paths) {
        all.add(path);
      }

      pathsBySize.set(size, all);
    }
  }

  for (const [size, paths] of pathsBySize) {
    if (paths.size >= 2) {
      sizes.add(size);
    }
  }

  return sizes;
}

/*
 * What an unconfirmed answer was, by what its site answered the batch's
 * other requests and, for a day, the batches before; Unconfirmed when
 * neither says.
 */
function decideUnconfirmed(data: {
  event: NormalizedSecurityEvent;
  site: SiteAnswers | undefined;
  remembered: RememberedAnswers | null;
}): SensitiveFileAnswer {
  const size: number | null = sizeOf(data.event);

  if ((!data.site && !data.remembered) || size === null || size <= 0) {
    return SensitiveFileAnswer.Unconfirmed;
  }

  const ownPageSizes: Set<number> = ownPageSizesOf(data.site, data.remembered);

  if (ownPageSizes.has(size)) {
    return SensitiveFileAnswer.OwnPage;
  }

  const refusesUnknownPaths: boolean =
    Boolean(data.site?.refusesUnknownPaths) ||
    Boolean(data.remembered?.notFound);

  if (!refusesUnknownPaths || ownPageSizes.size > 0) {
    return SensitiveFileAnswer.Unconfirmed;
  }

  // A file of another path was served with this size: no proof of this one.
  const path: string = getSensitiveFileRequestPath(data.event);
  const servedPaths: Set<string> | undefined =
    data.remembered?.servedPathsBySize.get(size);

  if (
    servedPaths &&
    Array.from(servedPaths).some((served: string): boolean => {
      return served !== path;
    })
  ) {
    return SensitiveFileAnswer.Unconfirmed;
  }

  return SensitiveFileAnswer.File;
}

// An event said as the answer it was decided to be.
function sayAnswer(
  event: NormalizedSecurityEvent,
  answer: SensitiveFileAnswer,
): void {
  event.attributes[WEB_SENSITIVE_FILE_ANSWER_ATTRIBUTE] = answer;

  const severity: OcsfSeverity = severityForSensitiveFile(answer);
  event.severityName = severity;
  event.severityId = OcsfSeverityId[severity];

  if (answer === SensitiveFileAnswer.File) {
    const probeLabel: string = WEB_ATTACK_LABELS[WebAttackKind.SensitiveFile];

    if (event.message.startsWith(probeLabel)) {
      event.message = `${SENSITIVE_FILE_SERVED_LABEL}${event.message.slice(probeLabel.length)}`;
    }
  }
}

/*
 * A turned-away outcome for an answer that found nothing (outcomeForSensitiveFile)
 * - unless the request's trace showed it broke something, which outranks it.
 */
function sayOutcome(
  event: NormalizedSecurityEvent,
  answer: SensitiveFileAnswer,
): void {
  if (
    event.requestOutcome === SecurityEventRequestOutcome.Errored ||
    event.requestOutcome === SecurityEventRequestOutcome.ReachedDatabase
  ) {
    return;
  }

  const outcome: SecurityEventRequestOutcome | undefined =
    outcomeForSensitiveFile(answer, event.requestOutcome);

  if (outcome) {
    event.requestOutcome = outcome;
  }
}

/*
 * Each request for a sensitive file that found nothing said as turned
 * away again, once its trace was followed (#10912): a follow-up reads a
 * 2xx as reaching the app, and a single-page app's page for /.env reached
 * nothing.
 */
export function keepSensitiveFileOutcomes(
  events: ReadonlyArray<NormalizedSecurityEvent>,
): void {
  for (const event of events) {
    const answer: SensitiveFileAnswer | null = answerOf(event);

    if (answer) {
      sayOutcome(event, answer);
    }
  }
}

/*
 * The events of a batch to store (#10912): every event but a request for a
 * file that holds secrets whose answer nothing decides - each unconfirmed
 * one decided by what its site answered the batch's other requests, and,
 * with the scan's memory (#11036), the batches of the last day - and said as
 * what it is. With a memory, what the batch says of each site is added to
 * it once the batch is judged, the requests left out included.
 */
export function judgeSensitiveFileAnswers(
  events: Array<NormalizedSecurityEvent>,
  memory?: SensitiveFileMemory | undefined,
): Array<NormalizedSecurityEvent> {
  if (
    !events.some((event: NormalizedSecurityEvent): boolean => {
      return answerOf(event) !== null;
    })
  ) {
    return events;
  }

  const sites: Map<string, SiteAnswers> = readSiteAnswers(events);
  const kept: Array<NormalizedSecurityEvent> = [];

  for (const event of events) {
    let answer: SensitiveFileAnswer | null = answerOf(event);

    if (answer === SensitiveFileAnswer.Unconfirmed) {
      const key: string = getSensitiveFileSiteKey(event);

      answer = decideUnconfirmed({
        event,
        site: sites.get(key),
        remembered: readRemembered(memory, key),
      });

      if (answer === SensitiveFileAnswer.Unconfirmed) {
        // Nothing says what was sent: no event.
        continue;
      }

      sayAnswer(event, answer);
    }

    if (answer) {
      sayOutcome(event, answer);
    }

    kept.push(event);
  }

  if (memory) {
    rememberSensitiveFileAnswers(memory, events);
  }

  return kept;
}
