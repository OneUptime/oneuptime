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
 * When the wait ends, against the reader's clock and calendar (their time
 * zone):
 *   - "today", and "tomorrow": a rule waits a day at most, so a wait that
 *     has not ended ends one or the other;
 *   - "later": further off than a rule can wait - a row written around the
 *     rules' bounds - said with its day;
 *   - "ended": the time has come. The rule-wait job takes the record within
 *     the minute, and the card shows the run once it reads it: until then
 *     OneUptime AI investigates it shortly, never "at" a time gone by.
 */
export type WaitEndKind = "today" | "tomorrow" | "later" | "ended";

export function getWaitEndKind(
  waitUntil: Date,
  now: Date = OneUptimeDate.getCurrentDate(),
): WaitEndKind {
  if (waitUntil.getTime() <= now.getTime()) {
    return "ended";
  }

  const timezone: string = OneUptimeDate.getCurrentTimezone();
  const startOfDay: (date: Date) => number = (date: Date): number => {
    return OneUptimeDate.getStartOfDay(date, timezone).getTime();
  };

  if (startOfDay(waitUntil) === startOfDay(now)) {
    return "today";
  }

  // A calendar day on: 23 or 25 hours across a clock change.
  if (
    startOfDay(waitUntil) ===
    startOfDay(OneUptimeDate.addRemoveDays(now, 1, timezone))
  ) {
    return "tomorrow";
  }

  return "later";
}

/*
 * When the wait ends, as the reader reads a clock: the time alone today or
 * tomorrow - "10:42", or "10:42 AM" for someone whose clock is 12-hour - and
 * the day with it further off ("23 Oct, 10:42"), in the reader's time zone.
 */
export function formatWaitUntil(
  waitUntil: Date,
  now: Date = OneUptimeDate.getCurrentDate(),
): string {
  const time: string = OneUptimeDate.getLocalTimeString(waitUntil, {
    use12HourFormat: OneUptimeDate.getUserPrefers12HourFormat(),
  });

  if (getWaitEndKind(waitUntil, now) === "later") {
    return `${OneUptimeDate.getDateAsLocalDayMonthString(waitUntil)}, ${time}`;
  }

  return time;
}

export interface InvestigationWaitingCopy {
  // "OneUptime AI investigates at {{time}} if this incident is still open"
  title: string;
  // The same, when the wait ends tomorrow: "... tomorrow at {{time}} ..."
  titleTomorrow: string;
  // Once the time has come, until the card reads the run that started.
  titleSoon: string;
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
    titleTomorrow: translationKey(
      "OneUptime AI investigates tomorrow at {{time}} if this incident is still open",
    ),
    titleSoon: translationKey(
      "OneUptime AI investigates shortly if this incident is still open",
    ),
    description: {
      one: "An AI rule makes OneUptime AI wait {{count}} minute, so incidents resolved by then are not investigated.",
      other:
        "An AI rule makes OneUptime AI wait {{count}} minutes, so incidents resolved by then are not investigated.",
    },
    whoCanStart: translationKey(
      "Someone who can edit this incident can start the investigation now.",
    ),
  },
  alert: {
    title: translationKey(
      "OneUptime AI investigates at {{time}} if this alert is still open",
    ),
    titleTomorrow: translationKey(
      "OneUptime AI investigates tomorrow at {{time}} if this alert is still open",
    ),
    titleSoon: translationKey(
      "OneUptime AI investigates shortly if this alert is still open",
    ),
    description: {
      one: "An AI rule makes OneUptime AI wait {{count}} minute, so alerts resolved by then are not investigated.",
      other:
        "An AI rule makes OneUptime AI wait {{count}} minutes, so alerts resolved by then are not investigated.",
    },
    whoCanStart: translationKey(
      "Someone who can edit this alert can start the investigation now.",
    ),
  },
};

export interface InvestigationWaitingTitle {
  // The English template, translated where the card draws it.
  template: string;
  // Its {{time}}; empty for the template that has none.
  time: string;
}

/*
 * The card's heading for a wait: "at 10:42" today, "tomorrow at 10:42",
 * "at 23 Oct, 10:42" further off, and "shortly" once the time has come.
 */
export function getInvestigationWaitingTitle(data: {
  subjectType: "incident" | "alert";
  waitUntil: Date;
  now?: Date | undefined;
}): InvestigationWaitingTitle {
  const copy: InvestigationWaitingCopy =
    INVESTIGATION_WAITING_COPY[data.subjectType];
  const now: Date = data.now || OneUptimeDate.getCurrentDate();
  const kind: WaitEndKind = getWaitEndKind(data.waitUntil, now);

  if (kind === "ended") {
    return { template: copy.titleSoon, time: "" };
  }

  return {
    template: kind === "tomorrow" ? copy.titleTomorrow : copy.title,
    time: formatWaitUntil(data.waitUntil, now),
  };
}

/*
 * How often the card reads the clock again while it waits, so its heading
 * turns from "at 10:42" to "shortly" when the time comes, and from
 * "tomorrow" to today at midnight, without a new answer from the server.
 */
export const INVESTIGATION_WAITING_CLOCK_TICK_MS: number = 15 * 1000;

// The card's status pill while it waits.
export const INVESTIGATION_WAITING_STATUS: string = translationKey("Waiting");

// The button that ends the wait, and what it says while it does.
export const INVESTIGATE_NOW: string = translationKey("Investigate now");

export const INVESTIGATE_NOW_FAILED: string = translationKey(
  "The investigation could not be started.",
);
