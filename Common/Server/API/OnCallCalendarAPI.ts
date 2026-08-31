import {
  DisableOnCallCalendarFeed,
  Host,
  HttpProtocol,
  ProvisionSsl,
  TrustedProxyHops,
} from "../EnvironmentConfig";
import OnCallCalendarFeedCache from "../Infrastructure/OnCallCalendarFeedCache";
import Semaphore, { SemaphoreMutex } from "../Infrastructure/Semaphore";
import OnCallCalendarFeedRateLimit from "../Middleware/OnCallCalendarFeedRateLimit";
import UserMiddleware from "../Middleware/UserAuthorization";
import OnCallDutyPolicyScheduleCalendarFeedService from "../Services/OnCallDutyPolicyScheduleCalendarFeedService";
import OnCallDutyPolicyScheduleService from "../Services/OnCallDutyPolicyScheduleService";
import ProjectOnCallCalendarFeedService from "../Services/ProjectOnCallCalendarFeedService";
import UserOnCallCalendarFeedService from "../Services/UserOnCallCalendarFeedService";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "../Utils/Express";
import logger from "../Utils/Logger";
import CalendarFeedToken, {
  CalendarFeedRotation,
  MintedCalendarFeedToken,
} from "../Utils/OnCall/CalendarFeedToken";
import OnCallCalendarFeedRenderer, {
  FEED_DISABLED_REASON,
  FeedRenderOutcome,
  FeedRenderRequest,
  FeedRenderStatus,
  TOKEN_ROTATED_REASON,
  UserShiftsResult,
} from "../Utils/OnCall/OnCallCalendarFeedRenderer";
import OnCallCalendarFeedUrls, {
  FeedUrls,
} from "../Utils/OnCall/OnCallCalendarFeedUrls";
import Response from "../Utils/Response";
import CommonAPI from "./CommonAPI";
import OnCallDutyPolicySchedule from "../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import OnCallDutyPolicyScheduleCalendarFeed from "../../Models/DatabaseModels/OnCallDutyPolicyScheduleCalendarFeed";
import ProjectOnCallCalendarFeed from "../../Models/DatabaseModels/ProjectOnCallCalendarFeed";
import UserOnCallCalendarFeed from "../../Models/DatabaseModels/UserOnCallCalendarFeed";
import Protocol from "../../Types/API/Protocol";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import OneUptimeDate from "../../Types/Date";
import BadDataException from "../../Types/Exception/BadDataException";
import Exception from "../../Types/Exception/Exception";
import ExceptionCode from "../../Types/Exception/ExceptionCode";
import NotFoundException from "../../Types/Exception/NotFoundException";
import ServiceUnavailableException from "../../Types/Exception/ServiceUnavailableException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import {
  DEFAULT_FUTURE_DAYS,
  DEFAULT_PAST_DAYS,
  MAX_FUTURE_DAYS,
  MAX_PAST_DAYS,
} from "../../Types/OnCallDutyPolicy/CalendarFeedWindow";
import MaterializedShiftUtil from "../../Types/OnCallDutyPolicy/MaterializedShift";
import { OnCallCalendarFeedKind } from "../../Types/OnCallDutyPolicy/OnCallCalendarFeedUtil";

/*
 * The HTTP face of the on-call calendar feeds.
 *
 * Two very different kinds of route share this router, and the difference is
 * the whole design:
 *
 * PUBLIC CAPABILITY ROUTES (no UserMiddleware). A calendar client sends no
 * cookie and no bearer token; the 43-character token in the path IS the
 * credential. UserMiddleware is deliberately absent: with no cookie it would
 * add nothing, but a browser holding an expired session cookie would be
 * answered 401 before the token was even read, and an `apikey` header -- even
 * an empty one -- would hijack the request into API-key authentication. The
 * pipeline is, in order: kill switch -> scheme guard -> rate limit -> shape
 * guard -> token lookup (current hash, then the rotated-out hash inside its
 * grace) -> the renderer, which re-derives authorisation on every fetch
 * (a valid token is not authorisation) -> response -> bookkeeping.
 *
 * ONE RESPONSE RULE, applied everywhere:
 *   unknown / malformed / expired token          -> 404, generic body
 *   disabled, rotated-out-in-grace, below plan,
 *   no eligible schedule                          -> 200, EMPTY VCALENDAR
 *   kill switch, or render cap with nothing cached -> 503 + Retry-After
 * The empty-calendar cases are 200 on purpose: a client that gets 404 keeps
 * showing the last copy it downloaded (or drops the subscription with an
 * error), whereas an empty calendar makes it clear its copy.
 *
 * SESSION ROUTES (UserMiddleware + requireUserAuthentication). The settings
 * pages and the mobile app read and rotate feeds here. /current is the ONLY
 * place the encrypted `token` column is ever read back; the public routes
 * never select it, so a rotated ENCRYPTION_SECRET can break the settings page
 * (which says "Regenerate link") but never the subscribed calendars.
 *
 * The token never reaches a log line, an error message, a span attribute or
 * a cache key. Everything that identifies a request in logs is the feed kind
 * and the row id.
 */
const router: ExpressRouter = Express.getRouter();

// -- Routes (exported so tests and the dashboard pin the same strings) ------

export const PERSONAL_FEED_ROUTE: string =
  "/on-call-calendar/user/:token/shifts.ics";
export const SCHEDULE_FEED_ROUTE: string =
  "/on-call-calendar/schedule/:token/schedule.ics";
export const PROJECT_FEED_ROUTE: string =
  "/on-call-calendar/project/:token/project.ics";

/*
 * Anything else under a token-bearing prefix: a link pasted without the
 * trailing `shifts.ics`, a typo in the filename, a client or a scanner
 * sending POST/PUT/DELETE to a feed URL. Without these the request falls
 * through to the application's own catch-alls, which answer
 * `Page not found - ${req.url}` -- the plaintext token, at ERROR level, in
 * stdout, in the master-admin support bundle's recent-log buffer and in the
 * OTel log exporter. The token is the credential; it must never be logged.
 */
export const PERSONAL_FEED_FALLBACK_ROUTE: string = "/on-call-calendar/user/*";
export const SCHEDULE_FEED_FALLBACK_ROUTE: string =
  "/on-call-calendar/schedule/*";
export const PROJECT_FEED_FALLBACK_ROUTE: string =
  "/on-call-calendar/project/*";

export const FEED_CURRENT_ROUTE: string = "/on-call-calendar/feed/current";
export const FEED_ROTATE_ROUTE: string = "/on-call-calendar/feed/rotate";

export const SCHEDULE_FEED_CURRENT_ROUTE: string =
  "/on-call-calendar/schedule-feed/:scheduleId/current";
export const SCHEDULE_FEED_PUBLISH_ROUTE: string =
  "/on-call-calendar/schedule-feed/:scheduleId/publish";
export const SCHEDULE_FEED_ROTATE_ROUTE: string =
  "/on-call-calendar/schedule-feed/:scheduleId/rotate";

export const PROJECT_FEED_CURRENT_ROUTE: string =
  "/on-call-calendar/project-feed/current";
export const PROJECT_FEED_PUBLISH_ROUTE: string =
  "/on-call-calendar/project-feed/publish";
export const PROJECT_FEED_ROTATE_ROUTE: string =
  "/on-call-calendar/project-feed/rotate";

export const MY_SHIFTS_ROUTE: string = "/on-call-calendar/my-shifts";

// -- Constants --------------------------------------------------------------

export const KILL_SWITCH_RETRY_AFTER_SECONDS: number = 3600;

/* Bookkeeping is written at most this often per feed. */
export const BOOKKEEPING_INTERVAL_MS: number = 5 * 60 * 1000;

export const MY_SHIFTS_DEFAULT_DAYS: number = 30;
export const MY_SHIFTS_MAX_DAYS: number = 120;

export const ROTATE_LOCK_NAMESPACE: string = "OnCallCalendarFeed.rotate";
export const ROTATE_LOCK_TIMEOUT_MS: number = 10000;

const STALE_WARNING_HEADER: string = '110 - "Response is Stale"';

/* The body of every 404 on the public routes. Says nothing. */
const NOT_FOUND_MESSAGE: string = "Not found.";

// -- Wire shapes ------------------------------------------------------------

export interface FeedStatusSettings {
  includeCoveringShifts?: boolean;
  includeCoverageGaps?: boolean;
  minimumGapMinutes?: number;
  pastDays: number;
  futureDays: number;
  rotateWhenMemberLeaves?: boolean;
}

export interface FeedStatus {
  exists: boolean;
  feedId: string | null;
  isEnabled: boolean;
  needsRegeneration: boolean;
  tokenHint: string | null;
  rotatedAt: string | null;
  previousTokenExpiresAt: string | null;
  lastFetchedAt: string | null;
  lastFetchedClient: string | null;
  fetchCount: number;
  lastRenderTruncated: boolean;
  settings: FeedStatusSettings;
  urls: FeedUrls | null;
  hostWarning: string | null;
  protocolWarning: string | null;
}

export interface MyShiftsResponse {
  shifts: Array<JSONObject>;
  truncated: boolean;
  generatedAt: string;
}

/*
 * The columns every feed row shares, as the status builder reads them. The
 * three models are structurally alike here; typing the slice keeps the
 * builder free of casts.
 */
interface FeedRowLike {
  id?: ObjectID | null | undefined;
  _id?: string | undefined;
  isEnabled?: boolean | undefined;
  tokenHint?: string | undefined;
  tokenHash?: string | undefined;
  token?: string | undefined;
  rotatedAt?: Date | undefined;
  previousTokenExpiresAt?: Date | undefined;
  lastFetchedAt?: Date | undefined;
  lastFetchedClient?: string | undefined;
  fetchCount?: number | undefined;
  lastRenderTruncated?: boolean | undefined;
  pastDays?: number | undefined;
  futureDays?: number | undefined;
  includeCoveringShifts?: boolean | undefined;
  includeCoverageGaps?: boolean | undefined;
  minimumGapMinutes?: number | undefined;
  rotateWhenMemberLeaves?: boolean | undefined;
}

type AnyFeedRow =
  | UserOnCallCalendarFeed
  | OnCallDutyPolicyScheduleCalendarFeed
  | ProjectOnCallCalendarFeed;

interface TokenLookupResult<TFeed> {
  feed: TFeed;
  /* Matched the rotated-out hash, still inside its grace period. */
  viaPreviousToken: boolean;
}

/*
 * 415. ExceptionCode has no member named for it; the numeric value is what
 * res.status() needs and what the client sees.
 */
class UnsupportedMediaTypeException extends Exception {
  public constructor(message: string) {
    super(415 as ExceptionCode, message);
  }
}

/* 405, same reasoning as the 415 above. */
class MethodNotAllowedException extends Exception {
  public constructor(message: string) {
    super(405 as ExceptionCode, message);
  }
}

// -- Public-route middleware ----------------------------------------------

/*
 * Kill switch. Answered BEFORE the rate limiter so a switched-off install
 * spends no Redis round trips per poll. 503 + Retry-After: clients keep the
 * copy they have and come back later, which is the point of a switch that
 * says "not now" rather than "never".
 */
export function killSwitchMiddleware(
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
): void {
  if (DisableOnCallCalendarFeed) {
    res.set("Retry-After", String(KILL_SWITCH_RETRY_AFTER_SECONDS));
    return Response.sendErrorResponse(
      req,
      res,
      new ServiceUnavailableException(
        "On-call calendar feeds are disabled on this OneUptime instance.",
      ),
    );
  }

  return next();
}

/*
 * The X-Forwarded-Proto entry written by OUR proxy, read the way ClientIp
 * reads X-Forwarded-For: counting in from the right by TRUSTED_PROXY_HOPS,
 * never the leftmost (caller-supplied) entry. With no trusted proxies there
 * is no trustworthy header at all, and undefined is returned.
 */
export function resolveTrustedForwardedProto(
  req: ExpressRequest,
  options?: { trustedProxyHops?: number | undefined } | undefined,
): string | undefined {
  const configuredHops: number =
    options?.trustedProxyHops === undefined
      ? TrustedProxyHops
      : options.trustedProxyHops;

  const hops: number =
    Number.isFinite(configuredHops) && configuredHops > 0
      ? Math.floor(configuredHops)
      : 0;

  if (hops === 0) {
    return undefined;
  }

  const header: string | Array<string> | undefined = req.headers?.[
    "x-forwarded-proto"
  ] as string | Array<string> | undefined;

  if (header === undefined || header === null) {
    return undefined;
  }

  const raw: string = Array.isArray(header) ? header.join(",") : header;

  if (!raw.trim()) {
    return undefined;
  }

  const entries: Array<string> = raw.split(",");

  if (entries.length < hops) {
    return undefined;
  }

  const entry: string | undefined = entries[entries.length - hops];

  return entry ? entry.trim().toLowerCase() : undefined;
}

/*
 * Scheme guard. An https instance whose proxy reports the request arrived
 * over plain http answers 301 to the https URL, so a link pasted without the
 * "s" is corrected once instead of served in the clear forever. The target
 * is built from HOST, never from the request's own Host header (an open
 * redirect otherwise). Nginx only does this itself when billing is on.
 *
 * It only fires when OUR nginx terminates TLS (PROVISION_SSL=true). Every
 * proxying location in Nginx/default.conf.template sets
 * `X-Forwarded-Proto $scheme`, REPLACING whatever an outer proxy sent, so on
 * an install that terminates TLS on an external reverse proxy
 * (PROVISION_SSL=false with HTTP_PROTOCOL=https -- the topology
 * config.example.env documents) nginx always reports `http` even though the
 * client spoke https. Redirecting there would 301 to the very URL the client
 * just asked for: an endless loop, ERR_TOO_MANY_REDIRECTS in a browser and a
 * dead subscription in every calendar client. Serving the feed is the right
 * answer; the settings page still shows `protocolWarning` when the install
 * really is plain http.
 */
export function schemeGuardMiddleware(
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
): void {
  if (HttpProtocol !== Protocol.HTTPS) {
    return next();
  }

  if (!ProvisionSsl) {
    return next();
  }

  const forwardedProto: string | undefined = resolveTrustedForwardedProto(req);

  if (forwardedProto !== "http") {
    return next();
  }

  const host: string = OnCallCalendarFeedUrls.normalizeHost(Host);

  if (!host) {
    return next();
  }

  const originalUrl: string = req.originalUrl || req.url || "/";

  res.set("Cache-Control", "no-store");
  res.redirect(301, `${Protocol.HTTPS}${host}${originalUrl}`);
}

// -- Helpers ----------------------------------------------------------------

function sendNotFound(req: ExpressRequest, res: ExpressResponse): void {
  return Response.sendErrorResponse(
    req,
    res,
    new NotFoundException(NOT_FOUND_MESSAGE),
  );
}

function sendUnavailable(
  req: ExpressRequest,
  res: ExpressResponse,
  retryAfterSeconds: number,
): void {
  res.set("Retry-After", String(retryAfterSeconds));

  return Response.sendErrorResponse(
    req,
    res,
    new ServiceUnavailableException(
      "The calendar feed cannot be rendered right now. Please try again later.",
    ),
  );
}

/*
 * The answer to every near miss on a token-bearing path. It says nothing
 * about the URL it was asked for: the message is a constant, so neither the
 * response body nor the error log line sendErrorResponse writes can carry
 * the token. OPTIONS is answered the way OPTIONS should be; any other wrong
 * method gets 405 + Allow (a client can fix that); a wrong or missing
 * filename gets the same generic 404 an unknown token gets.
 */
export const FEED_ALLOWED_METHODS: string = "GET, HEAD, OPTIONS";

export function feedFallbackHandler(
  req: ExpressRequest,
  res: ExpressResponse,
): void {
  const method: string = (req.method || "GET").toUpperCase();

  if (method === "OPTIONS") {
    res.set("Allow", FEED_ALLOWED_METHODS);

    return Response.sendEmptySuccessResponse(req, res);
  }

  if (method !== "GET" && method !== "HEAD") {
    res.set("Allow", FEED_ALLOWED_METHODS);

    return Response.sendErrorResponse(
      req,
      res,
      new MethodNotAllowedException(
        "Calendar feeds are read with GET on the full feed URL.",
      ),
    );
  }

  return sendNotFound(req, res);
}

/*
 * The `?schedule=` filter of the personal feed. Absent -> no filter. Present
 * but not a UUID -> null, which the route answers 404: a URL the user
 * believed was filtered must never quietly render the whole feed.
 */
export function readScheduleFilter(
  req: ExpressRequest,
): ObjectID | undefined | null {
  const raw: unknown = req.query?.["schedule"];

  if (raw === undefined || raw === null) {
    return undefined;
  }

  const value: string = Array.isArray(raw) ? String(raw[0] ?? "") : String(raw);

  const trimmed: string = value.trim();

  if (!trimmed) {
    return undefined;
  }

  if (!ObjectID.isValidUUID(trimmed)) {
    return null;
  }

  return new ObjectID(trimmed);
}

/*
 * Coarse client family only, from the User-Agent. The raw string is never
 * stored: it is high-cardinality, occasionally carries device identifiers,
 * and the settings page only wants to say "Google Calendar, 12 minutes ago".
 */
export function classifyCalendarClient(
  userAgent: string | Array<string> | undefined,
): string | null {
  const raw: string = (
    Array.isArray(userAgent) ? userAgent.join(" ") : userAgent || ""
  ).trim();

  if (!raw) {
    return null;
  }

  const value: string = raw.toLowerCase();

  if (value.includes("google-calendar") || value.includes("googlecalendar")) {
    return "Google Calendar";
  }

  if (
    value.includes("outlook") ||
    value.includes("microsoft office") ||
    value.includes("exchange") ||
    value.includes("microsoft-cryptoapi")
  ) {
    return "Microsoft Outlook";
  }

  if (
    value.includes("calendaragent") ||
    value.includes("dataaccessd") ||
    value.includes("ios/") ||
    value.includes("macos/") ||
    value.includes("darwin") ||
    value.includes("ical")
  ) {
    return "Apple Calendar";
  }

  if (value.includes("thunderbird") || value.includes("lightning")) {
    return "Thunderbird";
  }

  if (value.includes("okhttp") || value.includes("android")) {
    return "Android app";
  }

  if (
    value.includes("mozilla") ||
    value.includes("chrome") ||
    value.includes("safari") ||
    value.includes("firefox") ||
    value.includes("edge")
  ) {
    return "Browser";
  }

  if (value.includes("curl") || value.includes("wget")) {
    return "Command line";
  }

  return "Other";
}

function toDate(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === "string" && value) {
    const parsed: Date = OneUptimeDate.fromString(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  return null;
}

function toIso(value: unknown): string | null {
  const date: Date | null = toDate(value);
  return date ? date.toISOString() : null;
}

/*
 * Is a previousTokenHash match still honoured? Only while
 * previousTokenExpiresAt lies in the future; a rotated-out hash past its
 * grace is indistinguishable from an unknown one (404).
 */
export function isPreviousTokenInGrace(
  feed: { previousTokenExpiresAt?: Date | undefined },
  now: Date,
): boolean {
  const expiresAt: Date | null = toDate(feed.previousTokenExpiresAt);

  if (!expiresAt) {
    return false;
  }

  return expiresAt.getTime() > now.getTime();
}

/*
 * Bookkeeping is only worth a write once in a while, and only for a real
 * fetch: a HEAD is a client checking whether anything changed, not a read.
 */
export function shouldRecordFetch(data: {
  method: string | undefined;
  lastFetchedAt: Date | undefined | null;
  now: Date;
}): boolean {
  if ((data.method || "GET").toUpperCase() !== "GET") {
    return false;
  }

  const last: Date | null = toDate(data.lastFetchedAt);

  if (!last) {
    return true;
  }

  return data.now.getTime() - last.getTime() >= BOOKKEEPING_INTERVAL_MS;
}

function readObjectIdParam(req: ExpressRequest, name: string): ObjectID {
  const raw: unknown = req.params?.[name];

  if (typeof raw !== "string" || !ObjectID.isValidUUID(raw.trim())) {
    throw new BadDataException(`${name} must be a valid id.`);
  }

  return new ObjectID(raw.trim());
}

/*
 * POST bodies on the session routes must be application/json, else 415. The
 * routes carry no payload, so this is not about parsing: a JSON content type
 * cannot be produced by a cross-site form post, which is what keeps a
 * "rotate my link" request from being triggered by a page the user did not
 * mean to visit.
 */
export function assertJsonRequest(req: ExpressRequest): void {
  const contentType: string | Array<string> | undefined = req.headers?.[
    "content-type"
  ] as string | Array<string> | undefined;

  const value: string = (
    Array.isArray(contentType) ? contentType[0] || "" : contentType || ""
  )
    .trim()
    .toLowerCase();

  if (!value.startsWith("application/json")) {
    throw new UnsupportedMediaTypeException(
      "This endpoint expects a JSON request (Content-Type: application/json).",
    );
  }
}

/*
 * Parse ?from / ?to for /my-shifts. Defaults now -> +30 d; the span is
 * capped at 120 d by moving `to` in, never by refusing the request.
 *
 * The window is then clamped into the same range the feeds themselves can
 * address -- [now - MAX_PAST_DAYS, now + MAX_FUTURE_DAYS]. Without that,
 * `?from=2500-01-01` was accepted: every distinct day-aligned window is a
 * fresh schedule-cache entry AND a fresh LayerUtil expansion that walks one
 * rotation period at a time from the layer's start to the window, which for a
 * far-future start means the full 200,000-iteration cap per restricted layer
 * -- seconds of synchronous CPU per request, holding one of the four
 * per-process render slots the public feeds share. Clamping keeps a session
 * request no more expensive than a feed poll and keeps it on the same cache
 * keys.
 */
export function readMyShiftsWindow(
  req: ExpressRequest,
  now: Date,
): { from: Date; to: Date } {
  const rawFrom: unknown = req.query?.["from"];
  const rawTo: unknown = req.query?.["to"];

  let from: Date = now;

  if (typeof rawFrom === "string" && rawFrom.trim()) {
    if (!OneUptimeDate.isValidDateString(rawFrom.trim())) {
      throw new BadDataException("from must be an ISO 8601 date.");
    }

    from = OneUptimeDate.fromString(rawFrom.trim());
  }

  let to: Date = OneUptimeDate.addRemoveDays(from, MY_SHIFTS_DEFAULT_DAYS);

  if (typeof rawTo === "string" && rawTo.trim()) {
    if (!OneUptimeDate.isValidDateString(rawTo.trim())) {
      throw new BadDataException("to must be an ISO 8601 date.");
    }

    to = OneUptimeDate.fromString(rawTo.trim());
  }

  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw new BadDataException("from and to must be ISO 8601 dates.");
  }

  if (to.getTime() <= from.getTime()) {
    throw new BadDataException("to must be after from.");
  }

  /*
   * The addressable range. It is 240 days wide, so it always leaves room for
   * a non-empty window whatever the caller asked for.
   */
  const earliestFrom: Date = OneUptimeDate.addRemoveDays(now, -MAX_PAST_DAYS);
  const latestTo: Date = OneUptimeDate.addRemoveDays(now, MAX_FUTURE_DAYS);
  const latestFrom: Date = OneUptimeDate.addRemoveDays(latestTo, -1);

  if (from.getTime() < earliestFrom.getTime()) {
    from = earliestFrom;
  }

  if (from.getTime() > latestFrom.getTime()) {
    from = latestFrom;
  }

  /*
   * `to` was validated against the RAW `from`; once `from` has moved, a `to`
   * that now lies at or before it is answered with the default span rather
   * than an empty window.
   */
  if (to.getTime() <= from.getTime()) {
    to = OneUptimeDate.addRemoveDays(from, MY_SHIFTS_DEFAULT_DAYS);
  }

  const spanCap: Date = OneUptimeDate.addRemoveDays(from, MY_SHIFTS_MAX_DAYS);

  if (to.getTime() > spanCap.getTime()) {
    to = spanCap;
  }

  if (to.getTime() > latestTo.getTime()) {
    to = latestTo;
  }

  return { from, to };
}

// -- FeedStatus -------------------------------------------------------------

function defaultSettings(kind: OnCallCalendarFeedKind): FeedStatusSettings {
  if (kind === OnCallCalendarFeedKind.Personal) {
    return {
      includeCoveringShifts: true,
      pastDays: DEFAULT_PAST_DAYS,
      futureDays: DEFAULT_FUTURE_DAYS,
    };
  }

  return {
    includeCoverageGaps: false,
    minimumGapMinutes: 60,
    pastDays: DEFAULT_PAST_DAYS,
    futureDays: DEFAULT_FUTURE_DAYS,
    rotateWhenMemberLeaves: false,
  };
}

/*
 * FeedStatus for a feed that does not exist (yet).
 */
export function buildAbsentFeedStatus(
  kind: OnCallCalendarFeedKind,
): FeedStatus {
  return {
    exists: false,
    feedId: null,
    isEnabled: false,
    needsRegeneration: false,
    tokenHint: null,
    rotatedAt: null,
    previousTokenExpiresAt: null,
    lastFetchedAt: null,
    lastFetchedClient: null,
    fetchCount: 0,
    lastRenderTruncated: false,
    settings: defaultSettings(kind),
    urls: null,
    hostWarning: OnCallCalendarFeedUrls.getHostWarning(),
    protocolWarning: OnCallCalendarFeedUrls.getProtocolWarning(),
  };
}

/*
 * FeedStatus for an existing row. `plaintextToken` is the token just minted
 * by a rotate/publish (known without a decrypt); otherwise `decryptedToken`
 * is what the root read handed back, verified against the stored hash. A
 * token that fails to decrypt or does not hash to tokenHash means the
 * ENCRYPTION_SECRET changed under the row: the URL cannot be shown and the
 * UI offers "Regenerate link".
 *
 * The hash the decrypted token is checked against is `verifiedTokenHash` --
 * the one readTokenForStatus read alongside the token -- falling back to the
 * row's own `tokenHash`. The status rows the routes read do NOT carry
 * tokenHash (STATUS_SELECT cannot select it: the column's read access list is
 * empty, so the non-root schedule/project reads would be refused), and
 * requiring it here is what made every /current and /publish answer
 * `needsRegeneration: true, urls: null` for a perfectly good feed.
 */
export function buildFeedStatus(data: {
  kind: OnCallCalendarFeedKind;
  feed: FeedRowLike;
  plaintextToken?: string | undefined;
  decryptedToken?: string | undefined;
  decryptFailed?: boolean | undefined;
  verifiedTokenHash?: string | undefined;
}): FeedStatus {
  const feed: FeedRowLike = data.feed;

  const expectedTokenHash: string | undefined =
    feed.tokenHash || data.verifiedTokenHash;

  let token: string | null = null;
  let needsRegeneration: boolean = false;

  if (
    data.plaintextToken &&
    CalendarFeedToken.isValidShape(data.plaintextToken)
  ) {
    token = data.plaintextToken;
  } else if (data.decryptFailed) {
    needsRegeneration = true;
  } else if (
    data.decryptedToken &&
    CalendarFeedToken.isValidShape(data.decryptedToken) &&
    expectedTokenHash &&
    CalendarFeedToken.isHashEqual(
      CalendarFeedToken.hash(data.decryptedToken),
      expectedTokenHash,
    )
  ) {
    token = data.decryptedToken;
  } else {
    needsRegeneration = true;
  }

  const settings: FeedStatusSettings =
    data.kind === OnCallCalendarFeedKind.Personal
      ? {
          includeCoveringShifts: feed.includeCoveringShifts !== false,
          pastDays: feed.pastDays ?? DEFAULT_PAST_DAYS,
          futureDays: feed.futureDays ?? DEFAULT_FUTURE_DAYS,
        }
      : {
          includeCoverageGaps: feed.includeCoverageGaps === true,
          minimumGapMinutes: feed.minimumGapMinutes ?? 60,
          pastDays: feed.pastDays ?? DEFAULT_PAST_DAYS,
          futureDays: feed.futureDays ?? DEFAULT_FUTURE_DAYS,
          rotateWhenMemberLeaves: feed.rotateWhenMemberLeaves === true,
        };

  const feedId: string | null = feed.id
    ? feed.id.toString()
    : feed._id
      ? feed._id.toString()
      : null;

  return {
    exists: true,
    feedId,
    isEnabled: feed.isEnabled !== false,
    needsRegeneration,
    tokenHint: feed.tokenHint || null,
    rotatedAt: toIso(feed.rotatedAt),
    previousTokenExpiresAt: toIso(feed.previousTokenExpiresAt),
    lastFetchedAt: toIso(feed.lastFetchedAt),
    lastFetchedClient: feed.lastFetchedClient || null,
    fetchCount: typeof feed.fetchCount === "number" ? feed.fetchCount : 0,
    lastRenderTruncated: feed.lastRenderTruncated === true,
    settings,
    urls: token
      ? OnCallCalendarFeedUrls.buildFeedUrls({ kind: data.kind, token })
      : null,
    hostWarning: OnCallCalendarFeedUrls.getHostWarning(),
    protocolWarning: OnCallCalendarFeedUrls.getProtocolWarning(),
  };
}

/*
 * The one decrypting read. Selecting `token` makes DatabaseService run
 * Encryption.decrypt on the way out; with the wrong secret that either
 * throws or yields bytes that do not hash to tokenHash. Both become
 * needsRegeneration, never a 500.
 */
async function readTokenForStatus(data: {
  kind: OnCallCalendarFeedKind;
  id: ObjectID;
}): Promise<{
  decryptedToken?: string | undefined;
  /* The tokenHash this read verified the token against. */
  verifiedTokenHash?: string | undefined;
  decryptFailed: boolean;
}> {
  try {
    let row: FeedRowLike | null = null;

    if (data.kind === OnCallCalendarFeedKind.Personal) {
      row = await UserOnCallCalendarFeedService.findOneById({
        id: data.id,
        select: { _id: true, token: true, tokenHash: true },
        props: { isRoot: true, ignoreHooks: true },
      });
    } else if (data.kind === OnCallCalendarFeedKind.Schedule) {
      row = await OnCallDutyPolicyScheduleCalendarFeedService.findOneById({
        id: data.id,
        select: { _id: true, token: true, tokenHash: true },
        props: { isRoot: true, ignoreHooks: true },
      });
    } else {
      row = await ProjectOnCallCalendarFeedService.findOneById({
        id: data.id,
        select: { _id: true, token: true, tokenHash: true },
        props: { isRoot: true, ignoreHooks: true },
      });
    }

    if (!row || !row.token) {
      return { decryptFailed: true };
    }

    if (
      !row.tokenHash ||
      !CalendarFeedToken.isValidShape(row.token) ||
      !CalendarFeedToken.isHashEqual(
        CalendarFeedToken.hash(row.token),
        row.tokenHash,
      )
    ) {
      return { decryptFailed: true };
    }

    return {
      decryptedToken: row.token,
      verifiedTokenHash: row.tokenHash,
      decryptFailed: false,
    };
  } catch (err) {
    logger.warn(
      `OnCallCalendarAPI: could not decrypt the ${data.kind} calendar feed token for feed ${data.id.toString()}; the link needs regenerating.`,
    );
    logger.warn(err);
    return { decryptFailed: true };
  }
}

async function buildStatusForRow(data: {
  kind: OnCallCalendarFeedKind;
  feed: AnyFeedRow;
  plaintextToken?: string | undefined;
}): Promise<FeedStatus> {
  if (data.plaintextToken) {
    return buildFeedStatus({
      kind: data.kind,
      feed: data.feed as FeedRowLike,
      plaintextToken: data.plaintextToken,
    });
  }

  if (!data.feed.id) {
    return buildFeedStatus({
      kind: data.kind,
      feed: data.feed as FeedRowLike,
      decryptFailed: true,
    });
  }

  const decrypted: {
    decryptedToken?: string | undefined;
    verifiedTokenHash?: string | undefined;
    decryptFailed: boolean;
  } = await readTokenForStatus({ kind: data.kind, id: data.feed.id });

  return buildFeedStatus({
    kind: data.kind,
    feed: data.feed as FeedRowLike,
    decryptedToken: decrypted.decryptedToken,
    verifiedTokenHash: decrypted.verifiedTokenHash,
    decryptFailed: decrypted.decryptFailed,
  });
}

/* The non-secret columns a status read selects (any of the three models). */
const STATUS_SELECT: {
  _id: true;
  projectId: true;
  isEnabled: true;
  tokenHint: true;
  rotatedAt: true;
  previousTokenExpiresAt: true;
  lastFetchedAt: true;
  lastFetchedClient: true;
  fetchCount: true;
  lastRenderTruncated: true;
  pastDays: true;
  futureDays: true;
} = {
  _id: true,
  projectId: true,
  isEnabled: true,
  tokenHint: true,
  rotatedAt: true,
  previousTokenExpiresAt: true,
  lastFetchedAt: true,
  lastFetchedClient: true,
  fetchCount: true,
  lastRenderTruncated: true,
  pastDays: true,
  futureDays: true,
};

// -- Public feed lookup -----------------------------------------------------

/*
 * The columns the PUBLIC path reads. `token` is never among them: the public
 * routes must keep working after an ENCRYPTION_SECRET rotation, and a select
 * that included the encrypted column would make DatabaseService decrypt it on
 * every poll. Tests pin this.
 */
const PUBLIC_COMMON_SELECT: {
  _id: true;
  projectId: true;
  isEnabled: true;
  pastDays: true;
  futureDays: true;
  lastFetchedAt: true;
  fetchCount: true;
  previousTokenExpiresAt: true;
} = {
  _id: true,
  projectId: true,
  isEnabled: true,
  pastDays: true,
  futureDays: true,
  lastFetchedAt: true,
  fetchCount: true,
  previousTokenExpiresAt: true,
};

async function lookupPersonalFeed(
  tokenHash: string,
  now: Date,
): Promise<TokenLookupResult<UserOnCallCalendarFeed> | null> {
  const select: typeof PUBLIC_COMMON_SELECT & {
    userId: true;
    includeCoveringShifts: true;
  } = {
    ...PUBLIC_COMMON_SELECT,
    userId: true,
    includeCoveringShifts: true,
  };

  const current: UserOnCallCalendarFeed | null =
    await UserOnCallCalendarFeedService.findOneBy({
      query: { tokenHash },
      select,
      props: { isRoot: true, ignoreHooks: true },
    });

  if (current) {
    return { feed: current, viaPreviousToken: false };
  }

  const previous: UserOnCallCalendarFeed | null =
    await UserOnCallCalendarFeedService.findOneBy({
      query: { previousTokenHash: tokenHash },
      select,
      props: { isRoot: true, ignoreHooks: true },
    });

  if (!previous || !isPreviousTokenInGrace(previous, now)) {
    return null;
  }

  return { feed: previous, viaPreviousToken: true };
}

async function lookupScheduleFeed(
  tokenHash: string,
  now: Date,
): Promise<TokenLookupResult<OnCallDutyPolicyScheduleCalendarFeed> | null> {
  const select: typeof PUBLIC_COMMON_SELECT & {
    onCallDutyPolicyScheduleId: true;
    includeCoverageGaps: true;
    minimumGapMinutes: true;
  } = {
    ...PUBLIC_COMMON_SELECT,
    onCallDutyPolicyScheduleId: true,
    includeCoverageGaps: true,
    minimumGapMinutes: true,
  };

  const current: OnCallDutyPolicyScheduleCalendarFeed | null =
    await OnCallDutyPolicyScheduleCalendarFeedService.findOneBy({
      query: { tokenHash },
      select,
      props: { isRoot: true, ignoreHooks: true },
    });

  if (current) {
    return { feed: current, viaPreviousToken: false };
  }

  const previous: OnCallDutyPolicyScheduleCalendarFeed | null =
    await OnCallDutyPolicyScheduleCalendarFeedService.findOneBy({
      query: { previousTokenHash: tokenHash },
      select,
      props: { isRoot: true, ignoreHooks: true },
    });

  if (!previous || !isPreviousTokenInGrace(previous, now)) {
    return null;
  }

  return { feed: previous, viaPreviousToken: true };
}

async function lookupProjectFeed(
  tokenHash: string,
  now: Date,
): Promise<TokenLookupResult<ProjectOnCallCalendarFeed> | null> {
  const select: typeof PUBLIC_COMMON_SELECT & {
    includeCoverageGaps: true;
    minimumGapMinutes: true;
  } = {
    ...PUBLIC_COMMON_SELECT,
    includeCoverageGaps: true,
    minimumGapMinutes: true,
  };

  const current: ProjectOnCallCalendarFeed | null =
    await ProjectOnCallCalendarFeedService.findOneBy({
      query: { tokenHash },
      select,
      props: { isRoot: true, ignoreHooks: true },
    });

  if (current) {
    return { feed: current, viaPreviousToken: false };
  }

  const previous: ProjectOnCallCalendarFeed | null =
    await ProjectOnCallCalendarFeedService.findOneBy({
      query: { previousTokenHash: tokenHash },
      select,
      props: { isRoot: true, ignoreHooks: true },
    });

  if (!previous || !isPreviousTokenInGrace(previous, now)) {
    return null;
  }

  return { feed: previous, viaPreviousToken: true };
}

// -- Bookkeeping ------------------------------------------------------------

/*
 * Fire-and-forget root update after a served GET: when it was fetched, by
 * what kind of client, how many times (read-modify-write of the value the
 * lookup already read, so approximate under concurrency and deliberately
 * so), and whether the last render was cut. Never awaited by the route, never
 * allowed to throw into it.
 */
function recordFetch(data: {
  kind: OnCallCalendarFeedKind;
  feed: AnyFeedRow;
  req: ExpressRequest;
  now: Date;
  truncated: boolean;
}): void {
  if (!data.feed.id) {
    return;
  }

  if (
    !shouldRecordFetch({
      method: data.req.method,
      lastFetchedAt: data.feed.lastFetchedAt,
      now: data.now,
    })
  ) {
    return;
  }

  const client: string | null = classifyCalendarClient(
    data.req.headers?.["user-agent"] as string | Array<string> | undefined,
  );

  const previousCount: number =
    typeof data.feed.fetchCount === "number" &&
    Number.isFinite(data.feed.fetchCount)
      ? data.feed.fetchCount
      : Number(data.feed.fetchCount) || 0;

  const update: {
    lastFetchedAt: Date;
    lastFetchedClient: string;
    fetchCount: number;
    lastRenderTruncated: boolean;
  } = {
    lastFetchedAt: data.now,
    lastFetchedClient: client || "Other",
    fetchCount: previousCount + 1,
    lastRenderTruncated: data.truncated,
  };

  const id: ObjectID = data.feed.id;

  let write: Promise<unknown>;

  if (data.kind === OnCallCalendarFeedKind.Personal) {
    write = UserOnCallCalendarFeedService.updateOneById({
      id,
      data: update,
      props: { isRoot: true, ignoreHooks: true },
    });
  } else if (data.kind === OnCallCalendarFeedKind.Schedule) {
    write = OnCallDutyPolicyScheduleCalendarFeedService.updateOneById({
      id,
      data: update,
      props: { isRoot: true, ignoreHooks: true },
    });
  } else {
    write = ProjectOnCallCalendarFeedService.updateOneById({
      id,
      data: update,
      props: { isRoot: true, ignoreHooks: true },
    });
  }

  write.catch((err: unknown) => {
    logger.warn(
      `OnCallCalendarAPI: bookkeeping for the ${data.kind} calendar feed ${id.toString()} failed.`,
    );
    logger.warn(err);
  });
}

// -- Public routes ----------------------------------------------------------

/*
 * The shared tail of the three public routes, from "we have a lookup result"
 * to "bytes went out". Everything kind-specific is in the render request.
 */
async function serveFeed(data: {
  kind: OnCallCalendarFeedKind;
  req: ExpressRequest;
  res: ExpressResponse;
  lookup: TokenLookupResult<AnyFeedRow>;
  request: FeedRenderRequest;
  now: Date;
  emptyNames?:
    | {
        scheduleName?: string | undefined;
        projectName?: string | undefined;
      }
    | undefined;
}): Promise<void> {
  let outcome: FeedRenderOutcome;

  if (data.lookup.viaPreviousToken) {
    outcome = OnCallCalendarFeedRenderer.buildEmptyOutcome({
      kind: data.kind,
      reason: TOKEN_ROTATED_REASON,
      now: data.now,
    });
  } else if (data.lookup.feed.isEnabled === false) {
    outcome = OnCallCalendarFeedRenderer.buildEmptyOutcome({
      kind: data.kind,
      reason: FEED_DISABLED_REASON,
      now: data.now,
    });
  } else {
    outcome = await OnCallCalendarFeedRenderer.render(data.request);
  }

  if (outcome.status === FeedRenderStatus.Unavailable) {
    return sendUnavailable(
      data.req,
      data.res,
      outcome.retryAfterSeconds || KILL_SWITCH_RETRY_AFTER_SECONDS,
    );
  }

  if (outcome.stale) {
    data.res.set("Warning", STALE_WARNING_HEADER);
  }

  Response.sendCalendarResponse(data.req, data.res, {
    body: outcome.body,
    etag: outcome.etag,
    lastModified: outcome.lastModified,
  });

  /*
   * Only a real, current, enabled feed is worth bookkeeping. An empty
   * calendar served for a rotated-out link or a disabled feed is not a
   * fetch the settings page should count -- the two conditions above say so
   * exactly. Everything else that went out as a 200 IS a fetch, including the
   * empty calendars the renderer produces for "you are not on a schedule yet"
   * or "this project is below plan": those are precisely the users staring at
   * an empty calendar and asking "is my calendar app even reaching the
   * server?", which lastFetchedAt/lastFetchedClient exist to answer. Only an
   * Unavailable outcome is skipped, and that one already returned above
   * without sending a body.
   */
  if (!data.lookup.viaPreviousToken && data.lookup.feed.isEnabled !== false) {
    recordFetch({
      kind: data.kind,
      feed: data.lookup.feed,
      req: data.req,
      now: data.now,
      truncated: outcome.truncated || outcome.stale,
    });
  }
}

router.get(
  PERSONAL_FEED_ROUTE,
  killSwitchMiddleware,
  schemeGuardMiddleware,
  OnCallCalendarFeedRateLimit.getMiddleware(),
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const token: unknown = req.params?.["token"];

      if (!CalendarFeedToken.isValidShape(token)) {
        return sendNotFound(req, res);
      }

      const scheduleFilter: ObjectID | undefined | null =
        readScheduleFilter(req);

      if (scheduleFilter === null) {
        return sendNotFound(req, res);
      }

      const now: Date = OneUptimeDate.getCurrentDate();
      const tokenHash: string = CalendarFeedToken.hash(token);

      const lookup: TokenLookupResult<UserOnCallCalendarFeed> | null =
        await lookupPersonalFeed(tokenHash, now);

      if (!lookup || !lookup.feed.id || !lookup.feed.projectId) {
        return sendNotFound(req, res);
      }

      if (!lookup.feed.userId) {
        return sendNotFound(req, res);
      }

      return await serveFeed({
        kind: OnCallCalendarFeedKind.Personal,
        req,
        res,
        lookup,
        now,
        request: {
          kind: OnCallCalendarFeedKind.Personal,
          feedId: lookup.feed.id,
          projectId: lookup.feed.projectId,
          userId: lookup.feed.userId,
          tokenHash,
          includeCoveringShifts: lookup.feed.includeCoveringShifts !== false,
          pastDays: lookup.feed.pastDays ?? DEFAULT_PAST_DAYS,
          futureDays: lookup.feed.futureDays ?? DEFAULT_FUTURE_DAYS,
          scheduleFilterId: scheduleFilter,
          now,
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  SCHEDULE_FEED_ROUTE,
  killSwitchMiddleware,
  schemeGuardMiddleware,
  OnCallCalendarFeedRateLimit.getMiddleware(),
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const token: unknown = req.params?.["token"];

      if (!CalendarFeedToken.isValidShape(token)) {
        return sendNotFound(req, res);
      }

      const now: Date = OneUptimeDate.getCurrentDate();
      const tokenHash: string = CalendarFeedToken.hash(token);

      const lookup: TokenLookupResult<OnCallDutyPolicyScheduleCalendarFeed> | null =
        await lookupScheduleFeed(tokenHash, now);

      if (
        !lookup ||
        !lookup.feed.id ||
        !lookup.feed.projectId ||
        !lookup.feed.onCallDutyPolicyScheduleId
      ) {
        return sendNotFound(req, res);
      }

      return await serveFeed({
        kind: OnCallCalendarFeedKind.Schedule,
        req,
        res,
        lookup,
        now,
        request: {
          kind: OnCallCalendarFeedKind.Schedule,
          feedId: lookup.feed.id,
          projectId: lookup.feed.projectId,
          scheduleId: lookup.feed.onCallDutyPolicyScheduleId,
          tokenHash,
          includeCoverageGaps: lookup.feed.includeCoverageGaps === true,
          minimumGapMinutes: lookup.feed.minimumGapMinutes ?? 60,
          pastDays: lookup.feed.pastDays ?? DEFAULT_PAST_DAYS,
          futureDays: lookup.feed.futureDays ?? DEFAULT_FUTURE_DAYS,
          now,
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  PROJECT_FEED_ROUTE,
  killSwitchMiddleware,
  schemeGuardMiddleware,
  OnCallCalendarFeedRateLimit.getMiddleware(),
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const token: unknown = req.params?.["token"];

      if (!CalendarFeedToken.isValidShape(token)) {
        return sendNotFound(req, res);
      }

      const now: Date = OneUptimeDate.getCurrentDate();
      const tokenHash: string = CalendarFeedToken.hash(token);

      const lookup: TokenLookupResult<ProjectOnCallCalendarFeed> | null =
        await lookupProjectFeed(tokenHash, now);

      if (!lookup || !lookup.feed.id || !lookup.feed.projectId) {
        return sendNotFound(req, res);
      }

      return await serveFeed({
        kind: OnCallCalendarFeedKind.Project,
        req,
        res,
        lookup,
        now,
        request: {
          kind: OnCallCalendarFeedKind.Project,
          feedId: lookup.feed.id,
          projectId: lookup.feed.projectId,
          tokenHash,
          includeCoverageGaps: lookup.feed.includeCoverageGaps === true,
          minimumGapMinutes: lookup.feed.minimumGapMinutes ?? 60,
          pastDays: lookup.feed.pastDays ?? DEFAULT_PAST_DAYS,
          futureDays: lookup.feed.futureDays ?? DEFAULT_FUTURE_DAYS,
          now,
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

/*
 * Registered AFTER the three exact GET routes, so those still win, and
 * before the session routes, whose paths (`feed/`, `schedule-feed/`,
 * `project-feed/`, `my-shifts`) share no prefix with these.
 */
router.all(PERSONAL_FEED_FALLBACK_ROUTE, feedFallbackHandler);
router.all(SCHEDULE_FEED_FALLBACK_ROUTE, feedFallbackHandler);
router.all(PROJECT_FEED_FALLBACK_ROUTE, feedFallbackHandler);

// -- Session routes: personal feed -----------------------------------------

/*
 * The caller's own feed row in the tenant project. Root read: the row is
 * addressed by (projectId, userId) where userId is the SESSION's user, so
 * the model's CurrentUser predicate is satisfied by construction and a
 * non-root read would only add a permission round trip.
 */
async function findPersonalFeed(data: {
  projectId: ObjectID;
  userId: ObjectID;
}): Promise<UserOnCallCalendarFeed | null> {
  return await UserOnCallCalendarFeedService.findOneBy({
    query: {
      projectId: data.projectId,
      userId: data.userId,
    },
    select: {
      ...STATUS_SELECT,
      userId: true,
      includeCoveringShifts: true,
    },
    props: { isRoot: true, ignoreHooks: true },
  });
}

function requireUserId(props: DatabaseCommonInteractionProps): ObjectID {
  if (!props.userId) {
    throw new BadDataException("A logged-in user is required.");
  }

  return props.userId;
}

router.get(
  FEED_CURRENT_ROUTE,
  UserMiddleware.getUserMiddleware,
  UserMiddleware.requireUserAuthentication,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const props: DatabaseCommonInteractionProps =
        await CommonAPI.getDatabaseCommonInteractionProps(req);

      const projectId: ObjectID =
        CommonAPI.assertAuthenticatedProjectMember(props);
      const userId: ObjectID = requireUserId(props);

      const feed: UserOnCallCalendarFeed | null = await findPersonalFeed({
        projectId,
        userId,
      });

      if (!feed) {
        return Response.sendJsonObjectResponse(
          req,
          res,
          buildAbsentFeedStatus(
            OnCallCalendarFeedKind.Personal,
          ) as unknown as JSONObject,
        );
      }

      const status: FeedStatus = await buildStatusForRow({
        kind: OnCallCalendarFeedKind.Personal,
        feed,
      });

      return Response.sendJsonObjectResponse(
        req,
        res,
        status as unknown as JSONObject,
      );
    } catch (err) {
      next(err);
    }
  },
);

/*
 * Mint-or-rotate under a per-(project, user) lock. The UNIQUE(projectId,
 * userId) index is the backstop; the lock is what turns a double click into
 * one new link rather than one new link and one 500. Without Redis the lock
 * cannot be taken, and the index alone has to do -- logged, not fatal.
 */
async function withRotateLock<T>(
  key: string,
  work: () => Promise<T>,
): Promise<T> {
  let mutex: SemaphoreMutex | null = null;

  try {
    mutex = await Semaphore.lock({
      key,
      namespace: ROTATE_LOCK_NAMESPACE,
      lockTimeout: ROTATE_LOCK_TIMEOUT_MS,
    });
  } catch (err) {
    logger.warn(
      "OnCallCalendarAPI: could not take the rotate lock; relying on the unique index.",
    );
    logger.warn(err);
    mutex = null;
  }

  try {
    return await work();
  } finally {
    if (mutex) {
      try {
        await Semaphore.release(mutex);
      } catch (err) {
        logger.warn("OnCallCalendarAPI: releasing the rotate lock failed.");
        logger.warn(err);
      }
    }
  }
}

router.post(
  FEED_ROTATE_ROUTE,
  UserMiddleware.getUserMiddleware,
  UserMiddleware.requireUserAuthentication,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      assertJsonRequest(req);

      const props: DatabaseCommonInteractionProps =
        await CommonAPI.getDatabaseCommonInteractionProps(req);

      const projectId: ObjectID =
        CommonAPI.assertAuthenticatedProjectMember(props);
      const userId: ObjectID = requireUserId(props);

      const plaintextToken: string = await withRotateLock(
        `${projectId.toString()}-${userId.toString()}`,
        async (): Promise<string> => {
          const existing: UserOnCallCalendarFeed | null =
            await UserOnCallCalendarFeedService.findOneBy({
              query: { projectId, userId },
              select: { _id: true },
              props: { isRoot: true, ignoreHooks: true },
            });

          if (!existing || !existing.id) {
            const created: {
              feed: UserOnCallCalendarFeed;
              minted: MintedCalendarFeedToken;
            } = await UserOnCallCalendarFeedService.createForUser({
              projectId,
              userId,
            });

            return created.minted.token;
          }

          const rotation: CalendarFeedRotation =
            await UserOnCallCalendarFeedService.rotateTokenById({
              id: existing.id,
            });

          return rotation.token;
        },
      );

      await OnCallCalendarFeedCache.purgeForUser(
        projectId.toString(),
        userId.toString(),
      );

      const feed: UserOnCallCalendarFeed | null = await findPersonalFeed({
        projectId,
        userId,
      });

      if (!feed) {
        throw new NotFoundException("Calendar feed not found.");
      }

      const status: FeedStatus = await buildStatusForRow({
        kind: OnCallCalendarFeedKind.Personal,
        feed,
        plaintextToken,
      });

      return Response.sendJsonObjectResponse(
        req,
        res,
        status as unknown as JSONObject,
      );
    } catch (err) {
      next(err);
    }
  },
);

// -- Session routes: schedule feed -----------------------------------------

/*
 * NON-root read with the caller's props: the copied TableAccessControl and
 * the @CanAccessIfCanReadOn label scoping decide whether this caller may see
 * that the feed exists at all.
 */
async function findScheduleFeedAsCaller(data: {
  scheduleId: ObjectID;
  projectId: ObjectID;
  props: DatabaseCommonInteractionProps;
}): Promise<OnCallDutyPolicyScheduleCalendarFeed | null> {
  return await OnCallDutyPolicyScheduleCalendarFeedService.findOneBy({
    query: {
      onCallDutyPolicyScheduleId: data.scheduleId,
      projectId: data.projectId,
    },
    select: {
      ...STATUS_SELECT,
      onCallDutyPolicyScheduleId: true,
      includeCoverageGaps: true,
      minimumGapMinutes: true,
      rotateWhenMemberLeaves: true,
    },
    props: data.props,
  });
}

router.get(
  SCHEDULE_FEED_CURRENT_ROUTE,
  UserMiddleware.getUserMiddleware,
  UserMiddleware.requireUserAuthentication,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const props: DatabaseCommonInteractionProps =
        await CommonAPI.getDatabaseCommonInteractionProps(req);

      const projectId: ObjectID =
        CommonAPI.assertAuthenticatedProjectMember(props);
      const scheduleId: ObjectID = readObjectIdParam(req, "scheduleId");

      const feed: OnCallDutyPolicyScheduleCalendarFeed | null =
        await findScheduleFeedAsCaller({ scheduleId, projectId, props });

      if (!feed) {
        return Response.sendJsonObjectResponse(
          req,
          res,
          buildAbsentFeedStatus(
            OnCallCalendarFeedKind.Schedule,
          ) as unknown as JSONObject,
        );
      }

      const status: FeedStatus = await buildStatusForRow({
        kind: OnCallCalendarFeedKind.Schedule,
        feed,
      });

      return Response.sendJsonObjectResponse(
        req,
        res,
        status as unknown as JSONObject,
      );
    } catch (err) {
      next(err);
    }
  },
);

/*
 * Publish = a NON-root create with the caller's props, so DatabaseService
 * runs the schedule's Create permission check and the service hook mints the
 * token (anything the request carried is discarded). A feed that already
 * exists is re-enabled through a non-root update instead -- same permission
 * gate, and the existing link keeps working for everyone who already has it.
 */
router.post(
  SCHEDULE_FEED_PUBLISH_ROUTE,
  UserMiddleware.getUserMiddleware,
  UserMiddleware.requireUserAuthentication,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      assertJsonRequest(req);

      const props: DatabaseCommonInteractionProps =
        await CommonAPI.getDatabaseCommonInteractionProps(req);

      const projectId: ObjectID =
        CommonAPI.assertAuthenticatedProjectMember(props);
      const scheduleId: ObjectID = readObjectIdParam(req, "scheduleId");

      const existing: OnCallDutyPolicyScheduleCalendarFeed | null =
        await findScheduleFeedAsCaller({ scheduleId, projectId, props });

      if (existing && existing.id) {
        await OnCallDutyPolicyScheduleCalendarFeedService.updateOneBy({
          query: { _id: existing.id, projectId },
          data: { isEnabled: true },
          props,
        });
      } else {
        /*
         * The create alone is not enough of a gate. Its permission check
         * (CreatePermission) looks at table and column permissions and at
         * ownership; @CanAccessIfCanReadOn -- the label scoping that decides
         * WHICH schedules an editor may touch -- is only applied to query
         * operations (read/update/delete), and the service's own check runs
         * as root. So a label-restricted editor who knows a schedule's id
         * could publish a feed for a schedule outside their labels. Reading
         * the schedule with the caller's props first applies exactly the
         * scoping /current and /rotate already get.
         */
        const schedule: OnCallDutyPolicySchedule | null =
          await OnCallDutyPolicyScheduleService.findOneBy({
            query: { _id: scheduleId, projectId },
            select: { _id: true },
            props,
          });

        if (!schedule) {
          throw new NotFoundException("On-call schedule not found.");
        }

        const model: OnCallDutyPolicyScheduleCalendarFeed =
          new OnCallDutyPolicyScheduleCalendarFeed();
        model.projectId = projectId;
        model.onCallDutyPolicyScheduleId = scheduleId;

        await OnCallDutyPolicyScheduleCalendarFeedService.create({
          data: model,
          props,
        });
      }

      await OnCallCalendarFeedCache.purgeForSchedule(scheduleId.toString());

      const feed: OnCallDutyPolicyScheduleCalendarFeed | null =
        await findScheduleFeedAsCaller({ scheduleId, projectId, props });

      if (!feed) {
        throw new NotFoundException("Calendar feed not found.");
      }

      const status: FeedStatus = await buildStatusForRow({
        kind: OnCallCalendarFeedKind.Schedule,
        feed,
      });

      return Response.sendJsonObjectResponse(
        req,
        res,
        status as unknown as JSONObject,
      );
    } catch (err) {
      next(err);
    }
  },
);

/*
 * Rotate = a NON-root update of an updatable column (isEnabled, written back
 * with its current value) so the Edit permission check runs, THEN the root
 * mint. The token columns themselves are root-only on update, which is why
 * the permission probe cannot be the rotation write itself.
 */
router.post(
  SCHEDULE_FEED_ROTATE_ROUTE,
  UserMiddleware.getUserMiddleware,
  UserMiddleware.requireUserAuthentication,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      assertJsonRequest(req);

      const props: DatabaseCommonInteractionProps =
        await CommonAPI.getDatabaseCommonInteractionProps(req);

      const projectId: ObjectID =
        CommonAPI.assertAuthenticatedProjectMember(props);
      const scheduleId: ObjectID = readObjectIdParam(req, "scheduleId");

      const existing: OnCallDutyPolicyScheduleCalendarFeed | null =
        await findScheduleFeedAsCaller({ scheduleId, projectId, props });

      if (!existing || !existing.id) {
        throw new NotFoundException(
          "This schedule has no shared calendar feed yet. Publish one first.",
        );
      }

      await OnCallDutyPolicyScheduleCalendarFeedService.updateOneBy({
        query: { _id: existing.id, projectId },
        data: { isEnabled: existing.isEnabled !== false },
        props,
      });

      const rotation: CalendarFeedRotation =
        await OnCallDutyPolicyScheduleCalendarFeedService.rotateTokenById({
          id: existing.id,
        });

      await OnCallCalendarFeedCache.purgeForSchedule(scheduleId.toString());

      const feed: OnCallDutyPolicyScheduleCalendarFeed | null =
        await findScheduleFeedAsCaller({ scheduleId, projectId, props });

      if (!feed) {
        throw new NotFoundException("Calendar feed not found.");
      }

      const status: FeedStatus = await buildStatusForRow({
        kind: OnCallCalendarFeedKind.Schedule,
        feed,
        plaintextToken: rotation.token,
      });

      return Response.sendJsonObjectResponse(
        req,
        res,
        status as unknown as JSONObject,
      );
    } catch (err) {
      next(err);
    }
  },
);

// -- Session routes: project feed ------------------------------------------

async function findProjectFeedAsCaller(data: {
  projectId: ObjectID;
  props: DatabaseCommonInteractionProps;
}): Promise<ProjectOnCallCalendarFeed | null> {
  return await ProjectOnCallCalendarFeedService.findOneBy({
    query: {
      projectId: data.projectId,
    },
    select: {
      ...STATUS_SELECT,
      includeCoverageGaps: true,
      minimumGapMinutes: true,
      rotateWhenMemberLeaves: true,
    },
    props: data.props,
  });
}

router.get(
  PROJECT_FEED_CURRENT_ROUTE,
  UserMiddleware.getUserMiddleware,
  UserMiddleware.requireUserAuthentication,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const props: DatabaseCommonInteractionProps =
        await CommonAPI.getDatabaseCommonInteractionProps(req);

      const projectId: ObjectID =
        CommonAPI.assertAuthenticatedProjectMember(props);

      const feed: ProjectOnCallCalendarFeed | null =
        await findProjectFeedAsCaller({ projectId, props });

      if (!feed) {
        return Response.sendJsonObjectResponse(
          req,
          res,
          buildAbsentFeedStatus(
            OnCallCalendarFeedKind.Project,
          ) as unknown as JSONObject,
        );
      }

      const status: FeedStatus = await buildStatusForRow({
        kind: OnCallCalendarFeedKind.Project,
        feed,
      });

      return Response.sendJsonObjectResponse(
        req,
        res,
        status as unknown as JSONObject,
      );
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  PROJECT_FEED_PUBLISH_ROUTE,
  UserMiddleware.getUserMiddleware,
  UserMiddleware.requireUserAuthentication,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      assertJsonRequest(req);

      const props: DatabaseCommonInteractionProps =
        await CommonAPI.getDatabaseCommonInteractionProps(req);

      const projectId: ObjectID =
        CommonAPI.assertAuthenticatedProjectMember(props);

      const existing: ProjectOnCallCalendarFeed | null =
        await findProjectFeedAsCaller({ projectId, props });

      if (existing && existing.id) {
        await ProjectOnCallCalendarFeedService.updateOneBy({
          query: { _id: existing.id, projectId },
          data: { isEnabled: true },
          props,
        });
      } else {
        const model: ProjectOnCallCalendarFeed =
          new ProjectOnCallCalendarFeed();
        model.projectId = projectId;

        await ProjectOnCallCalendarFeedService.create({
          data: model,
          props,
        });
      }

      await OnCallCalendarFeedCache.purgeForProject(projectId.toString());

      const feed: ProjectOnCallCalendarFeed | null =
        await findProjectFeedAsCaller({ projectId, props });

      if (!feed) {
        throw new NotFoundException("Calendar feed not found.");
      }

      const status: FeedStatus = await buildStatusForRow({
        kind: OnCallCalendarFeedKind.Project,
        feed,
      });

      return Response.sendJsonObjectResponse(
        req,
        res,
        status as unknown as JSONObject,
      );
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  PROJECT_FEED_ROTATE_ROUTE,
  UserMiddleware.getUserMiddleware,
  UserMiddleware.requireUserAuthentication,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      assertJsonRequest(req);

      const props: DatabaseCommonInteractionProps =
        await CommonAPI.getDatabaseCommonInteractionProps(req);

      const projectId: ObjectID =
        CommonAPI.assertAuthenticatedProjectMember(props);

      const existing: ProjectOnCallCalendarFeed | null =
        await findProjectFeedAsCaller({ projectId, props });

      if (!existing || !existing.id) {
        throw new NotFoundException(
          "This project has no shared calendar feed yet. Publish one first.",
        );
      }

      await ProjectOnCallCalendarFeedService.updateOneBy({
        query: { _id: existing.id, projectId },
        data: { isEnabled: existing.isEnabled !== false },
        props,
      });

      const rotation: CalendarFeedRotation =
        await ProjectOnCallCalendarFeedService.rotateTokenById({
          id: existing.id,
        });

      await OnCallCalendarFeedCache.purgeForProject(projectId.toString());

      const feed: ProjectOnCallCalendarFeed | null =
        await findProjectFeedAsCaller({ projectId, props });

      if (!feed) {
        throw new NotFoundException("Calendar feed not found.");
      }

      const status: FeedStatus = await buildStatusForRow({
        kind: OnCallCalendarFeedKind.Project,
        feed,
        plaintextToken: rotation.token,
      });

      return Response.sendJsonObjectResponse(
        req,
        res,
        status as unknown as JSONObject,
      );
    } catch (err) {
      next(err);
    }
  },
);

// -- Session route: /my-shifts ---------------------------------------------

/*
 * The caller's own upcoming shifts as JSON. Scoped to the tenant project
 * when a `tenantid` header is present (the dashboard), to every project the
 * caller is rostered in otherwise (the mobile app). Same resolver and
 * schedule-level cache as the feeds; the per-process render cap applies, and
 * a capped request is a 503 the mobile app answers by falling back to its
 * roster-derived list.
 */
router.get(
  MY_SHIFTS_ROUTE,
  UserMiddleware.getUserMiddleware,
  UserMiddleware.requireUserAuthentication,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const props: DatabaseCommonInteractionProps =
        await CommonAPI.getDatabaseCommonInteractionProps(req);

      const userId: ObjectID = requireUserId(props);

      let projectIds: Array<ObjectID> | undefined = undefined;

      if (props.tenantId) {
        projectIds = [CommonAPI.assertAuthenticatedProjectMember(props)];
      }

      const now: Date = OneUptimeDate.getCurrentDate();
      const window: { from: Date; to: Date } = readMyShiftsWindow(req, now);

      /*
       * Session renders leave slots free for the public feeds. /my-shifts is
       * called by a logged-in client that can retry and that falls back to
       * its roster list; a calendar client that gets a 503 shows a stale or
       * empty calendar to somebody who may be on call. With the default
       * concurrency of 4 this route may hold at most 2 slots at once.
       */
      if (
        !OnCallCalendarFeedCache.tryAcquireRenderSlot({
          leaveFreeSlots: Math.floor(
            OnCallCalendarFeedCache.getRenderConcurrency() / 2,
          ),
        })
      ) {
        return sendUnavailable(req, res, 60);
      }

      let result: UserShiftsResult;

      try {
        result = await OnCallCalendarFeedRenderer.materializeUserShifts({
          userId,
          projectIds,
          from: window.from,
          to: window.to,
          now,
        });
      } finally {
        OnCallCalendarFeedCache.releaseRenderSlot();
      }

      const payload: MyShiftsResponse = {
        shifts: MaterializedShiftUtil.toJSONArray(
          result.shifts,
        ) as unknown as Array<JSONObject>,
        truncated: result.truncated,
        generatedAt: result.generatedAt.toISOString(),
      };

      return Response.sendJsonObjectResponse(
        req,
        res,
        payload as unknown as JSONObject,
      );
    } catch (err) {
      next(err);
    }
  },
);

export default router;
