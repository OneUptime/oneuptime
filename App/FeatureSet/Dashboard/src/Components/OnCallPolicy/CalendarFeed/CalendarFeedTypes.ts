import { JSONArray, JSONObject } from "Common/Types/JSON";
import { MaterializedShiftJson } from "Common/Types/OnCallDutyPolicy/MaterializedShift";
import {
  DEFAULT_FUTURE_DAYS,
  DEFAULT_PAST_DAYS,
} from "Common/Types/OnCallDutyPolicy/CalendarFeedWindow";

/*
 * The wire shapes of the on-call calendar API, exactly as the server sends
 * them (spec §2.2). Kept in one place so that the personal feed page, the
 * per-schedule card and the project-wide card cannot drift apart on what a
 * field is called or which ones may be null.
 *
 * Every parser below is DEFENSIVE: an absent boolean reads as false, an absent
 * string as null, an absent number as zero. The dashboard is routinely one
 * release ahead of or behind the API during a rolling upgrade, and a page that
 * throws on a missing field is a page nobody can use to find out why.
 */

export interface FeedUrls {
  /** The https URL calendar clients fetch. */
  https: string;
  /** webcal:// (or webcals:// when the API is served over https). */
  webcal: string;
  /** Google Calendar's "add by URL" deep link, already url-encoded. */
  googleAdd: string;
}

export interface FeedSettings {
  includeCoveringShifts?: boolean | undefined;
  includeCoverageGaps?: boolean | undefined;
  minimumGapMinutes?: number | undefined;
  pastDays: number;
  futureDays: number;
  rotateWhenMemberLeaves?: boolean | undefined;
}

export interface FeedStatus {
  exists: boolean;
  feedId: string | null;
  isEnabled: boolean;
  /**
   * The stored token could not be decrypted or no longer matches its hash
   * (a rotated ENCRYPTION_SECRET). The link still works for subscribers until
   * it is regenerated, but the dashboard cannot show it.
   */
  needsRegeneration: boolean;
  tokenHint: string | null;
  rotatedAt: string | null;
  previousTokenExpiresAt: string | null;
  lastFetchedAt: string | null;
  lastFetchedClient: string | null;
  fetchCount: number;
  lastRenderTruncated: boolean;
  settings: FeedSettings;
  urls: FeedUrls | null;
  hostWarning: string | null;
  protocolWarning: string | null;
}

export interface MyShiftsResponse {
  shifts: Array<MaterializedShiftJson>;
  truncated: boolean;
  generatedAt: string | null;
}

type ReadStringFunction = (value: unknown) => string | null;

const readString: ReadStringFunction = (value: unknown): string | null => {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }

  return null;
};

type ReadBooleanFunction = (value: unknown) => boolean;

const readBoolean: ReadBooleanFunction = (value: unknown): boolean => {
  return value === true;
};

type ReadNumberFunction = (value: unknown, fallback: number) => number;

const readNumber: ReadNumberFunction = (
  value: unknown,
  fallback: number,
): number => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim() !== "") {
    const parsed: number = Number(value);

    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return fallback;
};

type ReadOptionalBooleanFunction = (value: unknown) => boolean | undefined;

const readOptionalBoolean: ReadOptionalBooleanFunction = (
  value: unknown,
): boolean | undefined => {
  if (typeof value === "boolean") {
    return value;
  }

  return undefined;
};

type ReadOptionalNumberFunction = (value: unknown) => number | undefined;

const readOptionalNumber: ReadOptionalNumberFunction = (
  value: unknown,
): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  return undefined;
};

type ParseFeedUrlsFunction = (value: unknown) => FeedUrls | null;

export const parseFeedUrls: ParseFeedUrlsFunction = (
  value: unknown,
): FeedUrls | null => {
  if (!value || typeof value !== "object") {
    return null;
  }

  const json: JSONObject = value as JSONObject;
  const https: string | null = readString(json["https"]);

  /*
   * Without the https URL there is nothing to subscribe to; the other two are
   * derived from it, so a payload missing them is repaired rather than
   * rejected.
   */
  if (!https) {
    return null;
  }

  return {
    https: https,
    /*
     * The repaired scheme must match what the server would have built:
     * webcals:// for https, webcal:// for http (OnCallCalendarFeedUrls,
     * spec 2.2). Deriving webcal:// from an https link would make Apple
     * Calendar subscribe over cleartext to an https-only host.
     */
    webcal:
      readString(json["webcal"]) ||
      https.replace(/^https:/, "webcals:").replace(/^http:/, "webcal:"),
    googleAdd:
      readString(json["googleAdd"]) ||
      `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(https)}`,
  };
};

type ParseFeedSettingsFunction = (value: unknown) => FeedSettings;

export const parseFeedSettings: ParseFeedSettingsFunction = (
  value: unknown,
): FeedSettings => {
  const json: JSONObject =
    value && typeof value === "object" ? (value as JSONObject) : {};

  const settings: FeedSettings = {
    pastDays: readNumber(json["pastDays"], DEFAULT_PAST_DAYS),
    futureDays: readNumber(json["futureDays"], DEFAULT_FUTURE_DAYS),
  };

  const includeCoveringShifts: boolean | undefined = readOptionalBoolean(
    json["includeCoveringShifts"],
  );
  if (includeCoveringShifts !== undefined) {
    settings.includeCoveringShifts = includeCoveringShifts;
  }

  const includeCoverageGaps: boolean | undefined = readOptionalBoolean(
    json["includeCoverageGaps"],
  );
  if (includeCoverageGaps !== undefined) {
    settings.includeCoverageGaps = includeCoverageGaps;
  }

  const minimumGapMinutes: number | undefined = readOptionalNumber(
    json["minimumGapMinutes"],
  );
  if (minimumGapMinutes !== undefined) {
    settings.minimumGapMinutes = minimumGapMinutes;
  }

  const rotateWhenMemberLeaves: boolean | undefined = readOptionalBoolean(
    json["rotateWhenMemberLeaves"],
  );
  if (rotateWhenMemberLeaves !== undefined) {
    settings.rotateWhenMemberLeaves = rotateWhenMemberLeaves;
  }

  return settings;
};

type ParseFeedStatusFunction = (value: unknown) => FeedStatus;

export const parseFeedStatus: ParseFeedStatusFunction = (
  value: unknown,
): FeedStatus => {
  const json: JSONObject =
    value && typeof value === "object" ? (value as JSONObject) : {};

  return {
    exists: readBoolean(json["exists"]),
    feedId: readString(json["feedId"]),
    isEnabled: readBoolean(json["isEnabled"]),
    needsRegeneration: readBoolean(json["needsRegeneration"]),
    tokenHint: readString(json["tokenHint"]),
    rotatedAt: readString(json["rotatedAt"]),
    previousTokenExpiresAt: readString(json["previousTokenExpiresAt"]),
    lastFetchedAt: readString(json["lastFetchedAt"]),
    lastFetchedClient: readString(json["lastFetchedClient"]),
    fetchCount: readNumber(json["fetchCount"], 0),
    lastRenderTruncated: readBoolean(json["lastRenderTruncated"]),
    settings: parseFeedSettings(json["settings"]),
    urls: parseFeedUrls(json["urls"]),
    hostWarning: readString(json["hostWarning"]),
    protocolWarning: readString(json["protocolWarning"]),
  };
};

type IsShiftJsonFunction = (value: unknown) => value is MaterializedShiftJson;

/*
 * The minimum a shift needs to be rendered: who, where, and when. Anything
 * else is optional and read through its own guard at render time.
 */
const isShiftJson: IsShiftJsonFunction = (
  value: unknown,
): value is MaterializedShiftJson => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const json: JSONObject = value as JSONObject;

  return (
    typeof json["shiftKey"] === "string" &&
    typeof json["scheduleId"] === "string" &&
    typeof json["start"] === "string" &&
    typeof json["end"] === "string" &&
    typeof json["userId"] === "string"
  );
};

type ParseMyShiftsFunction = (value: unknown) => MyShiftsResponse;

export const parseMyShifts: ParseMyShiftsFunction = (
  value: unknown,
): MyShiftsResponse => {
  const json: JSONObject =
    value && typeof value === "object" ? (value as JSONObject) : {};

  const rawShifts: JSONArray = Array.isArray(json["shifts"])
    ? (json["shifts"] as JSONArray)
    : [];

  const shifts: Array<MaterializedShiftJson> = [];

  for (const raw of rawShifts) {
    if (isShiftJson(raw)) {
      shifts.push(raw);
    }
  }

  return {
    shifts: shifts,
    truncated: readBoolean(json["truncated"]),
    generatedAt: readString(json["generatedAt"]),
  };
};
