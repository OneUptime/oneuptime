import OneUptimeDate from "Common/Types/Date";
import {
  PluralTemplate,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * The AI Investigation card while an investigation rule makes OneUptime AI
 * wait before it investigates the incident or alert (issue #5074): what the
 * panel's payload says of it (waitingInvestigation), and the words. The
 * card draws it with InvestigationWaiting.
 *
 * React-free on purpose: App's tests read it without the page.
 */

export interface WaitingInvestigationState {
  // When the wait ends: OneUptime AI investigates then, if it is still open.
  waitUntil: Date;
  // The wait, in minutes, from when the incident or alert was created.
  waitMinutes: number;
  // Whether this reader may start the investigation now (may change it).
  canStartNow: boolean;
}

/*
 * The payload's waitingInvestigation, or null: absent (an API replica that
 * predates waits, or nothing waits), malformed, or without a time that
 * reads as one.
 */
export function parseWaitingInvestigation(
  value: unknown,
): WaitingInvestigationState | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  const record: Record<string, unknown> = value as Record<string, unknown>;
  const waitUntil: unknown = record["waitUntil"];
  const waitMinutes: unknown = record["waitMinutes"];

  if (
    typeof waitUntil !== "string" ||
    !Number.isFinite(Date.parse(waitUntil))
  ) {
    return null;
  }

  if (
    typeof waitMinutes !== "number" ||
    !Number.isFinite(waitMinutes) ||
    waitMinutes < 1
  ) {
    return null;
  }

  return {
    waitUntil: new Date(waitUntil),
    waitMinutes: Math.floor(waitMinutes),
    canStartNow: record["canStartNow"] === true,
  };
}

/*
 * When the wait ends, as the reader reads a clock: the time alone today -
 * "10:42", or "10:42 AM" for someone whose clock is 12-hour - and the day
 * with it otherwise ("21 Oct, 10:42"), in the reader's time zone.
 */
export function formatWaitUntil(
  waitUntil: Date,
  now: Date = new Date(),
): string {
  const isToday: boolean =
    OneUptimeDate.getDateAsLocalDayMonthString(waitUntil) ===
      OneUptimeDate.getDateAsLocalDayMonthString(now) &&
    Math.abs(waitUntil.getTime() - now.getTime()) < 24 * 60 * 60 * 1000;

  const time: string = OneUptimeDate.getLocalTimeString(waitUntil, {
    use12HourFormat: OneUptimeDate.getUserPrefers12HourFormat(),
  });

  if (isToday) {
    return time;
  }

  return `${OneUptimeDate.getDateAsLocalDayMonthString(waitUntil)}, ${time}`;
}

export interface InvestigationWaitingCopy {
  // "OneUptime AI investigates at {{time}} if this incident is still open"
  title: string;
  // Why: the rule's wait, a plural sentence.
  description: PluralTemplate;
  // Under the button, for a reader who may not start it.
  whoCanStart: string;
}

export const INVESTIGATION_WAITING_COPY: Record<
  "incident" | "alert",
  InvestigationWaitingCopy
> = {
  incident: {
    title: translationKey(
      "OneUptime AI investigates at {{time}} if this incident is still open",
    ),
    description: {
      one: "An investigation rule makes OneUptime AI wait {{count}} minute, so incidents resolved by then are not investigated.",
      other:
        "An investigation rule makes OneUptime AI wait {{count}} minutes, so incidents resolved by then are not investigated.",
    },
    whoCanStart: translationKey(
      "Someone who can edit this incident can start the investigation now.",
    ),
  },
  alert: {
    title: translationKey(
      "OneUptime AI investigates at {{time}} if this alert is still open",
    ),
    description: {
      one: "An investigation rule makes OneUptime AI wait {{count}} minute, so alerts resolved by then are not investigated.",
      other:
        "An investigation rule makes OneUptime AI wait {{count}} minutes, so alerts resolved by then are not investigated.",
    },
    whoCanStart: translationKey(
      "Someone who can edit this alert can start the investigation now.",
    ),
  },
};

// The card's status pill while it waits.
export const INVESTIGATION_WAITING_STATUS: string = translationKey("Waiting");

// The button that ends the wait, and what it says while it does.
export const INVESTIGATE_NOW: string = translationKey("Investigate now");

export const INVESTIGATE_NOW_FAILED: string = translationKey(
  "The investigation could not be started.",
);
