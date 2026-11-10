/*
 * Product analytics for a RUM application (issue #6444): who uses the app -
 * active, new, returning, signed-in, anonymous, dormant and total users -
 * and how their sessions go, by device, browser, operating system, country,
 * app version and page.
 *
 * The numbers come from the sessions Session Replay records. Each session's
 * summary - never its recording - is copied, as it is written, into two
 * tables of their own (RumProductAnalyticsSessionV1 and
 * RumProductAnalyticsUserV1) that keep it for PRODUCT_ANALYTICS_RETENTION_MONTHS,
 * apart from the recording's own retention, so a month of active users or a
 * user's first visit can still be read after the recording is gone.
 *
 * A person is who Session Replay's Users page says it is: the signed-in user
 * a session named (identify()), else the browser it came from (the
 * recorder's anonymous visitor id). Two browsers of one anonymous visitor
 * are two people; a session from a recorder too old to carry either is
 * counted as a session and as nobody.
 *
 * Shared by the server (Common/Server/Utils/RumProductAnalytics) and the
 * Dashboard, so both read one set of names, limits and buckets.
 */

import {
  SESSION_REPLAY_USER_KEY_PATTERN,
  SESSION_REPLAY_VISITOR_ID_PATTERN,
} from "./SessionReplay";

/* Route prefix of the five reads (Common/Server/API/TelemetryAPI.ts). */
export const PRODUCT_ANALYTICS_ROUTE_PREFIX: string =
  "/telemetry/rum/product-analytics";

export const PRODUCT_ANALYTICS_SUMMARY_ROUTE: string = `${PRODUCT_ANALYTICS_ROUTE_PREFIX}/summary`;
export const PRODUCT_ANALYTICS_TREND_ROUTE: string = `${PRODUCT_ANALYTICS_ROUTE_PREFIX}/trend`;
export const PRODUCT_ANALYTICS_BREAKDOWN_ROUTE: string = `${PRODUCT_ANALYTICS_ROUTE_PREFIX}/breakdown`;
export const PRODUCT_ANALYTICS_PEOPLE_ROUTE: string = `${PRODUCT_ANALYTICS_ROUTE_PREFIX}/people`;
export const PRODUCT_ANALYTICS_PERSON_ROUTE: string = `${PRODUCT_ANALYTICS_ROUTE_PREFIX}/person`;

/*
 * How long a session's summary is kept, in calendar months: a month's rows
 * go on the first day of the thirteenth month after it (both tables drop
 * whole monthly partitions), so at least twelve full months are always
 * kept, and a month can be compared with the same month a year earlier
 * while it is still running. Both tables' TTLs read this.
 */
export const PRODUCT_ANALYTICS_RETENTION_MONTHS: number = 13;

/*
 * The longest range one read covers. A year and a month of days, what the
 * tables keep; the active-users trend reads 29 more days before it for the
 * first day's monthly count.
 */
export const PRODUCT_ANALYTICS_MAX_RANGE_DAYS: number = 400;

/* The windows the active-users trend counts over, in days. */
export const PRODUCT_ANALYTICS_WEEKLY_WINDOW_DAYS: number = 7;
export const PRODUCT_ANALYTICS_MONTHLY_WINDOW_DAYS: number = 30;

/*
 * A dormant user came before and has not come back for this many days. The
 * page offers these; the server refuses anything else, so a hand-written
 * call cannot ask for a window the page never draws.
 */
export const PRODUCT_ANALYTICS_DORMANT_AFTER_DAYS_OPTIONS: ReadonlyArray<number> =
  [7, 14, 30, 60, 90];
export const DEFAULT_PRODUCT_ANALYTICS_DORMANT_AFTER_DAYS: number = 30;

/* The people list's page sizes. */
export const DEFAULT_PRODUCT_ANALYTICS_PEOPLE_LIMIT: number = 50;
export const MAX_PRODUCT_ANALYTICS_PEOPLE_LIMIT: number = 200;
/* Rows a list may skip: deep offsets cost a full sort each, and nobody pages that far. */
export const MAX_PRODUCT_ANALYTICS_OFFSET: number = 10000;

/* One person's sessions, newest first. */
export const DEFAULT_PRODUCT_ANALYTICS_PERSON_SESSIONS_LIMIT: number = 50;
export const MAX_PRODUCT_ANALYTICS_PERSON_SESSIONS_LIMIT: number = 200;

/* Values one breakdown answers, most users first. */
export const PRODUCT_ANALYTICS_BREAKDOWN_LIMIT: number = 50;

/* A label search: matched as written, ignoring case. */
export const PRODUCT_ANALYTICS_SEARCH_MAX_LENGTH: number = 200;

export enum ProductAnalyticsDimension {
  DeviceType = "deviceType",
  Browser = "browser",
  OperatingSystem = "operatingSystem",
  Country = "country",
  AppVersion = "appVersion",
  EntryPage = "entryPage",
  Page = "page",
}

export const PRODUCT_ANALYTICS_DIMENSIONS: ReadonlyArray<ProductAnalyticsDimension> =
  [
    ProductAnalyticsDimension.DeviceType,
    ProductAnalyticsDimension.Browser,
    ProductAnalyticsDimension.OperatingSystem,
    ProductAnalyticsDimension.Country,
    ProductAnalyticsDimension.AppVersion,
    ProductAnalyticsDimension.EntryPage,
    ProductAnalyticsDimension.Page,
  ];

/*
 * Who a people list holds. The first five are people who came in the range;
 * Dormant and All read the whole history instead.
 */
export enum ProductAnalyticsPeopleFilter {
  Active = "active",
  New = "new",
  Returning = "returning",
  SignedIn = "signed-in",
  Anonymous = "anonymous",
  Dormant = "dormant",
  All = "all",
}

export const PRODUCT_ANALYTICS_PEOPLE_FILTERS: ReadonlyArray<ProductAnalyticsPeopleFilter> =
  [
    ProductAnalyticsPeopleFilter.Active,
    ProductAnalyticsPeopleFilter.New,
    ProductAnalyticsPeopleFilter.Returning,
    ProductAnalyticsPeopleFilter.SignedIn,
    ProductAnalyticsPeopleFilter.Anonymous,
    ProductAnalyticsPeopleFilter.Dormant,
    ProductAnalyticsPeopleFilter.All,
  ];

/* Filters whose people are the ones who came in the range. */
export const PRODUCT_ANALYTICS_IN_RANGE_PEOPLE_FILTERS: ReadonlyArray<ProductAnalyticsPeopleFilter> =
  [
    ProductAnalyticsPeopleFilter.Active,
    ProductAnalyticsPeopleFilter.New,
    ProductAnalyticsPeopleFilter.Returning,
    ProductAnalyticsPeopleFilter.SignedIn,
    ProductAnalyticsPeopleFilter.Anonymous,
  ];

/*
 * The device types sessions are filed under. The browser recorder reports
 * desktop, mobile or tablet from the user agent; the mobile recorder reports
 * its platform, and a phone and a tablet are told apart by the screen's
 * shorter side (600 points and over is a tablet).
 */
export const PRODUCT_ANALYTICS_DEVICE_TYPES: ReadonlyArray<string> = [
  "desktop",
  "mobile",
  "tablet",
];

/* The shorter side, in points, from which a mobile app's screen is a tablet's. */
export const PRODUCT_ANALYTICS_TABLET_MIN_SHORT_SIDE: number = 600;

/*
 * Session length buckets, in milliseconds: [from, to). The last one is open.
 * Only finished sessions are put in one - a session still recording has no
 * length yet.
 */
export interface ProductAnalyticsSessionLengthBucket {
  key: string;
  fromMs: number;
  toMs: number | null;
}

export const PRODUCT_ANALYTICS_SESSION_LENGTH_BUCKETS: ReadonlyArray<ProductAnalyticsSessionLengthBucket> =
  [
    { key: "under-10s", fromMs: 0, toMs: 10000 },
    { key: "10s-30s", fromMs: 10000, toMs: 30000 },
    { key: "30s-1m", fromMs: 30000, toMs: 60000 },
    { key: "1m-3m", fromMs: 60000, toMs: 180000 },
    { key: "3m-10m", fromMs: 180000, toMs: 600000 },
    { key: "10m-30m", fromMs: 600000, toMs: 1800000 },
    { key: "30m-plus", fromMs: 1800000, toMs: null },
  ];

export type ProductAnalyticsPersonKind = "identified" | "visitor";

/*
 * A person's key: "u:" and the HMAC of the signed-in user's reference (64
 * hex), or "v:" and the browser's visitor id (32 hex). The same prefixes as
 * Session Replay's Users page, so the two name a person alike. Any other
 * shape can name nobody the tables hold, so it is refused rather than read.
 */
export const PRODUCT_ANALYTICS_IDENTIFIED_PREFIX: string = "u:";
export const PRODUCT_ANALYTICS_VISITOR_PREFIX: string = "v:";

export function isProductAnalyticsPersonKey(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }

  if (value.startsWith(PRODUCT_ANALYTICS_IDENTIFIED_PREFIX)) {
    return SESSION_REPLAY_USER_KEY_PATTERN.test(
      value.slice(PRODUCT_ANALYTICS_IDENTIFIED_PREFIX.length),
    );
  }

  if (value.startsWith(PRODUCT_ANALYTICS_VISITOR_PREFIX)) {
    return SESSION_REPLAY_VISITOR_ID_PATTERN.test(
      value.slice(PRODUCT_ANALYTICS_VISITOR_PREFIX.length),
    );
  }

  return false;
}

export function readProductAnalyticsPersonKind(
  personKey: string,
): ProductAnalyticsPersonKind {
  return personKey.startsWith(PRODUCT_ANALYTICS_IDENTIFIED_PREFIX)
    ? "identified"
    : "visitor";
}

/*
 * A person's key as one address segment: the colon swapped for a dash, so a
 * link never carries a character a router or a proxy treats specially.
 */
export function toProductAnalyticsPersonSegment(personKey: string): string {
  return personKey.replace(":", "-");
}

export function fromProductAnalyticsPersonSegment(
  segment: string,
): string | null {
  const personKey: string = segment.replace("-", ":");

  return isProductAnalyticsPersonKey(personKey) ? personKey : null;
}

/*
 * The IANA time zone days are counted in, as the runtime spells it
 * ("america/new_york" comes back "America/New_York", the spelling the
 * database knows), or null for anything that is not a zone. The shape is
 * checked first, so nothing else reaches the runtime's parser.
 */
const TIME_ZONE_SHAPE: RegExp =
  /^[A-Za-z][A-Za-z0-9_+-]{0,40}(?:\/[A-Za-z0-9_+-]{1,40}){0,2}$/;

export const DEFAULT_PRODUCT_ANALYTICS_TIME_ZONE: string = "UTC";

export function toProductAnalyticsTimeZone(value: unknown): string | null {
  if (typeof value !== "string" || !TIME_ZONE_SHAPE.test(value)) {
    return null;
  }

  try {
    const resolved: string = new Intl.DateTimeFormat("en-US", {
      timeZone: value,
    }).resolvedOptions().timeZone;

    return TIME_ZONE_SHAPE.test(resolved) ? resolved : null;
  } catch {
    return null;
  }
}

/* ---- Wire shapes. Numbers are plain numbers; times are unix milliseconds. ---- */

export interface ProductAnalyticsPeriodDto {
  activeUsers: number;
  signedInUsers: number;
  anonymousUsers: number;
  newUsers: number;
  returningUsers: number;
  sessions: number;
  /* Sessions in which the user was signed in: the app's sign-ins. */
  signedInSessions: number;
  /* Sessions the recorder finished; the lengths below count only these. */
  finishedSessions: number;
  medianSessionMs: number;
  averagePagesPerSession: number;
  errorSessions: number;
  frustratedSessions: number;
  /* Finished sessions per PRODUCT_ANALYTICS_SESSION_LENGTH_BUCKETS entry, in order. */
  sessionLengths: Array<number>;
}

export interface ProductAnalyticsSummaryDto {
  current: ProductAnalyticsPeriodDto;
  /* The range of the same length just before the one asked for. */
  previous: ProductAnalyticsPeriodDto;
  previousStartTime: number;
  previousEndTime: number;
  /* Everyone the kept history holds, and those of them not seen lately. */
  totalUsers: number;
  dormantUsers: number;
  dormantAfterDays: number;
  /* When the first session the tables still keep started; null when none is kept. */
  dataStartedAt: number | null;
}

export interface ProductAnalyticsTrendDayDto {
  /* The day in the reader's time zone, as YYYY-MM-DD. */
  day: string;
  activeUsers: number;
  weeklyActiveUsers: number;
  monthlyActiveUsers: number;
  newUsers: number;
  returningUsers: number;
  sessions: number;
  desktopSessions: number;
  mobileSessions: number;
  tabletSessions: number;
  otherSessions: number;
}

export interface ProductAnalyticsTrendDto {
  timeZone: string;
  days: Array<ProductAnalyticsTrendDayDto>;
}

export interface ProductAnalyticsBreakdownRowDto {
  /* "" when the sessions did not report one. */
  value: string;
  users: number;
  sessions: number;
}

export interface ProductAnalyticsBreakdownDto {
  dimension: ProductAnalyticsDimension;
  rows: Array<ProductAnalyticsBreakdownRowDto>;
  /* True when more values exist than PRODUCT_ANALYTICS_BREAKDOWN_LIMIT. */
  hasMore: boolean;
  totalUsers: number;
  totalSessions: number;
}

export interface ProductAnalyticsPersonDto {
  personKey: string;
  kind: ProductAnalyticsPersonKind;
  identifiedUserKey: string;
  visitorId: string;
  /*
   * The signed-in user's readable reference, from the newest of their
   * recordings still kept, and only for a reader allowed to see who end
   * users are (the permission Session Replay names them under). Absent for
   * any other reader; "" when no kept recording names them (the
   * application does not capture identity, or the recordings are gone).
   */
  identifiedUserLabel?: string | undefined;
  firstSeenAt: number;
  lastSeenAt: number;
  sessionsInRange: number;
  totalSessions: number;
  deviceType: string;
  countryCode: string;
  /* First seen inside the range asked for. */
  isNew: boolean;
}

export interface ProductAnalyticsPeopleDto {
  people: Array<ProductAnalyticsPersonDto>;
  hasMore: boolean;
  /* Whether labels were in the answer at all: absent means hidden, not anonymous. */
  includesLabels: boolean;
}

export interface ProductAnalyticsPersonSessionDto {
  sessionId: string;
  startedAt: number;
  durationMs: number;
  pageCount: number;
  entryPage: string;
  pages: Array<string>;
  deviceType: string;
  browserName: string;
  osName: string;
  countryCode: string;
  appVersion: string;
  errorCount: number;
  frustrationCount: number;
  isFinished: boolean;
  /* The recording itself is still kept, so the session can be watched. */
  isReplayKept: boolean;
}

export interface ProductAnalyticsPersonDetailDto {
  person: ProductAnalyticsPersonDto | null;
  sessions: Array<ProductAnalyticsPersonSessionDto>;
  hasMore: boolean;
  includesLabels: boolean;
}
