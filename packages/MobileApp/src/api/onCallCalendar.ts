import type { AxiosError, AxiosResponse } from "axios";
import apiClient from "./client";
import { toPlainText } from "../utils/text";
import type {
  MyOnCallShift,
  MyOnCallShiftOverride,
  MyOnCallShiftPolicy,
  MyOnCallShiftPolicyVariant,
  MyOnCallShiftsResponse,
  OnCallCalendarFeedSettings,
  OnCallCalendarFeedStatus,
  OnCallCalendarFeedUrls,
} from "./types";

/*
 * The calendar-feed routes: a per-project personal feed the user subscribes
 * to from a calendar app, the shared per-schedule feed an editor publishes for
 * the whole team, and `/my-shifts` - the server's own expansion of every
 * schedule the signed-in user is on.
 *
 * Every route lives under one prefix. The public `.ics` routes (the ones a
 * calendar app polls, with the secret token in the path) are NOT called from
 * here: the app never sees the token, only the URLs the server has already
 * built around it and the last four characters as a hint.
 *
 * The normalisers below are defensive on purpose. These are custom routes
 * that ship with a specific server version; a handset talking to an older or
 * newer server than the one this code was written against should degrade to
 * "field missing", never to a crash in a render.
 */

export const ON_CALL_CALENDAR_API_PATH: string = "/api/on-call-calendar";

/** The CRUD resource behind the personal feed's enable / disable switch. */
export const USER_ON_CALL_CALENDAR_FEED_API_PATH: string =
  "/api/user-on-call-calendar-feed";

function toStringOrNull(value: unknown): string | null {
  const text: string = toPlainText(value);
  return text ? text : null;
}

function toBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") {
    return value;
  }

  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  return fallback;
}

function toNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim() !== "") {
    const parsed: number = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  return fallback;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function toFeedUrls(raw: unknown): OnCallCalendarFeedUrls | null {
  const urls: Record<string, unknown> | null = asRecord(raw);

  if (!urls) {
    return null;
  }

  const https: string = toPlainText(urls["https"]);

  /*
   * The https link is the one every other link is derived from. Without it
   * there is nothing to subscribe to, so the whole block reads as absent
   * rather than as a set of empty strings a button could be wired to.
   */
  if (!https) {
    return null;
  }

  return {
    https,
    webcal: toPlainText(urls["webcal"]) || https,
    googleAdd: toPlainText(urls["googleAdd"]) || "",
  };
}

function toFeedSettings(raw: unknown): OnCallCalendarFeedSettings {
  const settings: Record<string, unknown> | null = asRecord(raw);

  const result: OnCallCalendarFeedSettings = {
    pastDays: toNumber(settings?.["pastDays"], 2),
    futureDays: toNumber(settings?.["futureDays"], 90),
  };

  if (typeof settings?.["includeCoveringShifts"] === "boolean") {
    result.includeCoveringShifts = settings["includeCoveringShifts"];
  }

  if (typeof settings?.["includeCoverageGaps"] === "boolean") {
    result.includeCoverageGaps = settings["includeCoverageGaps"];
  }

  if (typeof settings?.["minimumGapMinutes"] === "number") {
    result.minimumGapMinutes = settings["minimumGapMinutes"];
  }

  if (typeof settings?.["rotateWhenMemberLeaves"] === "boolean") {
    result.rotateWhenMemberLeaves = settings["rotateWhenMemberLeaves"];
  }

  return result;
}

/**
 * Normalises a `FeedStatus` payload. Missing fields fall back to the "no feed
 * yet" reading, so a truncated or partial response can only ever make the
 * screen offer to generate a link - never claim one exists that does not.
 */
export function toOnCallCalendarFeedStatus(
  raw: unknown,
): OnCallCalendarFeedStatus {
  const status: Record<string, unknown> | null = asRecord(raw);

  return {
    exists: toBoolean(status?.["exists"], false),
    feedId: toStringOrNull(status?.["feedId"]),
    isEnabled: toBoolean(status?.["isEnabled"], false),
    needsRegeneration: toBoolean(status?.["needsRegeneration"], false),
    tokenHint: toStringOrNull(status?.["tokenHint"]),
    rotatedAt: toStringOrNull(status?.["rotatedAt"]),
    previousTokenExpiresAt: toStringOrNull(status?.["previousTokenExpiresAt"]),
    lastFetchedAt: toStringOrNull(status?.["lastFetchedAt"]),
    lastFetchedClient: toStringOrNull(status?.["lastFetchedClient"]),
    fetchCount: toNumber(status?.["fetchCount"], 0),
    lastRenderTruncated: toBoolean(status?.["lastRenderTruncated"], false),
    settings: toFeedSettings(status?.["settings"]),
    urls: toFeedUrls(status?.["urls"]),
    hostWarning: toStringOrNull(status?.["hostWarning"]),
    protocolWarning: toStringOrNull(status?.["protocolWarning"]),
  };
}

function toOverride(raw: unknown): MyOnCallShiftOverride | null {
  const override: Record<string, unknown> | null = asRecord(raw);

  if (!override) {
    return null;
  }

  const originalUserId: string = toPlainText(override["originalUserId"]);

  if (!originalUserId) {
    return null;
  }

  const result: MyOnCallShiftOverride = {
    originalUserId,
    originalUserName:
      toPlainText(override["originalUserName"]) || "Unnamed user",
    overrideStartsAt: toPlainText(override["overrideStartsAt"]),
    overrideEndsAt: toPlainText(override["overrideEndsAt"]),
  };

  const policyId: string = toPlainText(override["onCallDutyPolicyId"]);

  if (policyId) {
    result.onCallDutyPolicyId = policyId;
  }

  return result;
}

function toPolicyVariant(raw: unknown): MyOnCallShiftPolicyVariant | null {
  const variant: Record<string, unknown> | null = asRecord(raw);

  if (!variant) {
    return null;
  }

  const policyId: string = toPlainText(variant["policyId"]);

  if (!policyId) {
    return null;
  }

  return {
    policyId,
    policyName: toPlainText(variant["policyName"]) || "Unnamed policy",
    globalUserId: toPlainText(variant["globalUserId"]),
  };
}

function toPolicies(raw: unknown): MyOnCallShiftPolicy[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const policies: MyOnCallShiftPolicy[] = [];

  raw.forEach((entry: unknown) => {
    const policy: Record<string, unknown> | null = asRecord(entry);

    if (!policy) {
      return;
    }

    const policyId: string = toPlainText(policy["policyId"]);

    if (!policyId) {
      return;
    }

    policies.push({
      policyId,
      policyName: toPlainText(policy["policyName"]) || "Unnamed policy",
      ruleId: toPlainText(policy["ruleId"]),
      ruleName: toPlainText(policy["ruleName"]),
      ruleOrder: toNumber(policy["ruleOrder"], 0),
    });
  });

  return policies;
}

/**
 * Normalises one `MaterializedShiftJson`. Returns null for anything that
 * cannot be placed on a timeline - a shift with no key, no schedule or an
 * unparseable window would render as a card with nothing on it.
 */
export function toMyOnCallShift(raw: unknown): MyOnCallShift | null {
  const shift: Record<string, unknown> | null = asRecord(raw);

  if (!shift) {
    return null;
  }

  const shiftKey: string = toPlainText(shift["shiftKey"]);
  const scheduleId: string = toPlainText(shift["scheduleId"]);
  const start: string = toPlainText(shift["start"]);
  const end: string = toPlainText(shift["end"]);

  if (!shiftKey || !scheduleId || !start || !end) {
    return null;
  }

  if (
    !Number.isFinite(new Date(start).getTime()) ||
    !Number.isFinite(new Date(end).getTime())
  ) {
    return null;
  }

  const result: MyOnCallShift = {
    shiftKey,
    contentHash: toPlainText(shift["contentHash"]),
    projectId: toPlainText(shift["projectId"]),
    scheduleId,
    scheduleName: toPlainText(shift["scheduleName"]) || "Unnamed schedule",
    scheduleTimezone: toStringOrNull(shift["scheduleTimezone"]),
    userId: toPlainText(shift["userId"]),
    userName: toPlainText(shift["userName"]) || "Unnamed user",
    start,
    end,
    coverageSeconds: toNumber(shift["coverageSeconds"], 0),
    policies: toPolicies(shift["policies"]),
    isPast: toBoolean(shift["isPast"], false),
    lastModifiedAt: toPlainText(shift["lastModifiedAt"]),
    shiftConfigVersion: toNumber(shift["shiftConfigVersion"], 0),
  };

  const projectName: string = toPlainText(shift["projectName"]);

  if (projectName) {
    result.projectName = projectName;
  }

  const layerId: string = toPlainText(shift["layerId"]);

  if (layerId) {
    result.layerId = layerId;
  }

  const layerName: string = toPlainText(shift["layerName"]);

  if (layerName) {
    result.layerName = layerName;
  }

  const override: MyOnCallShiftOverride | null = toOverride(shift["override"]);

  if (override) {
    result.override = override;
  }

  const policyVariantOf: MyOnCallShiftPolicyVariant | null = toPolicyVariant(
    shift["policyVariantOf"],
  );

  if (policyVariantOf) {
    result.policyVariantOf = policyVariantOf;
  }

  return result;
}

export function toMyOnCallShiftsResponse(raw: unknown): MyOnCallShiftsResponse {
  const body: Record<string, unknown> | null = asRecord(raw);
  const rows: Array<unknown> = Array.isArray(body?.["shifts"])
    ? (body?.["shifts"] as Array<unknown>)
    : [];

  const shifts: MyOnCallShift[] = [];

  rows.forEach((row: unknown) => {
    const shift: MyOnCallShift | null = toMyOnCallShift(row);

    if (shift) {
      shifts.push(shift);
    }
  });

  return {
    shifts,
    truncated: toBoolean(body?.["truncated"], false),
    generatedAt: toPlainText(body?.["generatedAt"]),
  };
}

/**
 * The signed-in user's personal feed for one project. Feeds are per project:
 * the same person has one link per project they are on call in.
 */
export async function fetchPersonalCalendarFeed(
  projectId: string,
): Promise<OnCallCalendarFeedStatus> {
  const response: AxiosResponse = await apiClient.get(
    `${ON_CALL_CALENDAR_API_PATH}/feed/current`,
    {
      headers: { tenantid: projectId },
    },
  );

  return toOnCallCalendarFeedStatus(response.data);
}

/**
 * Mints the personal feed link for a project, or replaces the existing one.
 *
 * Rotating is not undoable: every calendar app subscribed with the old link
 * keeps working for thirty days and then shows an empty calendar. The screen
 * confirms before calling this for an existing feed; a first "Generate" needs
 * no confirmation because there is nothing to lose.
 *
 * The body is an empty JSON object rather than nothing at all - the server
 * answers 415 to a POST that is not `application/json`.
 */
export async function rotatePersonalCalendarFeed(
  projectId: string,
): Promise<OnCallCalendarFeedStatus> {
  const response: AxiosResponse = await apiClient.post(
    `${ON_CALL_CALENDAR_API_PATH}/feed/rotate`,
    {},
    {
      headers: { tenantid: projectId },
    },
  );

  return toOnCallCalendarFeedStatus(response.data);
}

/**
 * Turns a personal feed off (subscribers see an empty calendar) or back on.
 * Goes through the generic CRUD route because that is the only route that
 * writes the flag; the token columns are unreadable there by design.
 */
export async function setPersonalCalendarFeedEnabled(
  projectId: string,
  feedId: string,
  isEnabled: boolean,
): Promise<void> {
  await apiClient.put(
    `${USER_ON_CALL_CALENDAR_FEED_API_PATH}/${feedId}`,
    {
      data: { isEnabled },
    },
    {
      headers: { tenantid: projectId },
    },
  );
}

/**
 * The shared, project-owned feed for one schedule - everyone's shifts. Any
 * reader of the schedule may fetch the link; only editors can publish or
 * rotate it, and they do that on the web.
 */
export async function fetchScheduleCalendarFeed(
  projectId: string,
  scheduleId: string,
): Promise<OnCallCalendarFeedStatus> {
  const response: AxiosResponse = await apiClient.get(
    `${ON_CALL_CALENDAR_API_PATH}/schedule-feed/${encodeURIComponent(
      scheduleId,
    )}/current`,
    {
      headers: { tenantid: projectId },
    },
  );

  return toOnCallCalendarFeedStatus(response.data);
}

export interface MyShiftsWindow {
  from: Date;
  to: Date;
}

/**
 * Every shift the signed-in user holds inside the window, across every
 * project they are rostered in.
 *
 * Deliberately sent WITHOUT a tenant header: with one, the server scopes the
 * answer to that project; without one it walks every project the caller has
 * layer-user rows in, which is the cross-project view the on-call tab shows.
 * Pass `projectId` only when a single project's shifts are wanted.
 */
export async function fetchMyShifts(
  window: MyShiftsWindow,
  projectId?: string,
): Promise<MyOnCallShiftsResponse> {
  const response: AxiosResponse = await apiClient.get(
    `${ON_CALL_CALENDAR_API_PATH}/my-shifts`,
    {
      params: {
        from: window.from.toISOString(),
        to: window.to.toISOString(),
      },
      ...(projectId ? { headers: { tenantid: projectId } } : {}),
    },
  );

  return toMyOnCallShiftsResponse(response.data);
}

/**
 * The HTTP status behind a failed request, or null for anything that never
 * reached the server (timeouts, DNS, a bad certificate).
 */
export function getHttpStatus(err: unknown): number | null {
  if (!err || typeof err !== "object") {
    return null;
  }

  const candidate: AxiosError = err as AxiosError;

  if (candidate.isAxiosError !== true) {
    return null;
  }

  const status: unknown = candidate.response?.status;

  return typeof status === "number" ? status : null;
}

/**
 * True when the route itself does not exist - the answer an OneUptime server
 * from before calendar feeds gives to every URL under the prefix. During a
 * rolling upgrade old pods answer this way until they are replaced, so the
 * app hides the feature rather than showing a broken screen.
 */
export function isRouteMissingError(err: unknown): boolean {
  return getHttpStatus(err) === 404;
}

/**
 * True when the project this request named enforces SSO and the handset has
 * not completed it (`ExceptionCode.SsoAuthorizationException`, HTTP 406). The
 * API client has already recorded the refusal against the project by the time
 * this is asked; the caller's job is to say so instead of showing the request
 * as a generic failure with a Retry button that cannot help.
 */
export function isSsoRequiredError(err: unknown): boolean {
  return getHttpStatus(err) === 406;
}

/**
 * True when the server declined to render right now (kill switch, or the
 * per-process render cap with nothing cached). The caller is expected to fall
 * back to what it already has rather than retry in a loop.
 */
export function isServiceUnavailableError(err: unknown): boolean {
  return getHttpStatus(err) === 503;
}
