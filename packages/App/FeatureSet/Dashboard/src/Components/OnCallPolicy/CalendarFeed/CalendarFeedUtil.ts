import { FeedStatus, FeedUrls } from "./CalendarFeedTypes";
import CalendarSubscriptionLinks, {
  GOOGLE_CALENDAR_SUBSCRIBE_URL_PREFIX,
} from "Common/Types/Calendar/CalendarSubscriptionLinks";
import OneUptimeDate from "Common/Types/Date";
import { MaterializedShiftJson } from "Common/Types/OnCallDutyPolicy/MaterializedShift";
import {
  MAX_MINUTES_BEFORE_SHIFT,
  MIN_MINUTES_BEFORE_SHIFT,
} from "Common/Models/DatabaseModels/UserOnCallShiftReminder";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * Pure helpers for the calendar-feed surfaces. Nothing here touches React, the
 * network or the clock (callers pass `now` in), which is what lets the
 * interesting decisions - which URL a button opens, what the status line says,
 * whether the "nothing has fetched this yet" hint applies - be tested without
 * mounting a page.
 */

/** Custom-route prefix, mounted like OnCallReadinessAPI (spec §2). */
export const ON_CALL_CALENDAR_API_PATH: string = "/on-call-calendar";

export const PERSONAL_FEED_CURRENT_PATH: string = `${ON_CALL_CALENDAR_API_PATH}/feed/current`;
export const PERSONAL_FEED_ROTATE_PATH: string = `${ON_CALL_CALENDAR_API_PATH}/feed/rotate`;
export const PROJECT_FEED_CURRENT_PATH: string = `${ON_CALL_CALENDAR_API_PATH}/project-feed/current`;
export const PROJECT_FEED_PUBLISH_PATH: string = `${ON_CALL_CALENDAR_API_PATH}/project-feed/publish`;
export const PROJECT_FEED_ROTATE_PATH: string = `${ON_CALL_CALENDAR_API_PATH}/project-feed/rotate`;
export const MY_SHIFTS_PATH: string = `${ON_CALL_CALENDAR_API_PATH}/my-shifts`;

type SchedulePathFunction = (scheduleId: string) => string;

export const getScheduleFeedCurrentPath: SchedulePathFunction = (
  scheduleId: string,
): string => {
  return `${ON_CALL_CALENDAR_API_PATH}/schedule-feed/${scheduleId}/current`;
};

export const getScheduleFeedPublishPath: SchedulePathFunction = (
  scheduleId: string,
): string => {
  return `${ON_CALL_CALENDAR_API_PATH}/schedule-feed/${scheduleId}/publish`;
};

export const getScheduleFeedRotatePath: SchedulePathFunction = (
  scheduleId: string,
): string => {
  return `${ON_CALL_CALENDAR_API_PATH}/schedule-feed/${scheduleId}/rotate`;
};

/*
 * Google Calendar's "add by URL" entry point. Its `cid` takes the feed's
 * webcal:// address (CalendarSubscriptionLinks explains why not https://).
 */
export const GOOGLE_CALENDAR_ADD_URL_PREFIX: string =
  GOOGLE_CALENDAR_SUBSCRIBE_URL_PREFIX;

/** Docs page describing per-client subscribe steps and troubleshooting. */
export const CALENDAR_FEED_DOCS_PATH: string = "/on-call/calendar-feeds";

/** How many days of upcoming shifts the personal page shows. */
export const UPCOMING_SHIFTS_DAYS: number = 30;

/*
 * The Upcoming shifts card's words. The title names the card the way the
 * docs and the schedule page's layer summary do; how far ahead it looks
 * and which zone its times are in are the description's, said once for
 * the whole card rather than on every row. Sentences that say "30 days"
 * are static rather than composed from UPCOMING_SHIFTS_DAYS so that each
 * is one translation key; a test pins the number to the constant.
 */
export const UPCOMING_SHIFTS_CARD_TITLE: string =
  translationKey("Upcoming shifts");

export const UPCOMING_SHIFTS_DESCRIPTION: string = translationKey(
  "Your shifts over the next 30 days. Times are in {{timezone}}.",
);

export const UPCOMING_SHIFTS_EMPTY_TITLE: string = translationKey(
  "No shifts in the next 30 days",
);

export const UPCOMING_SHIFTS_EMPTY_DESCRIPTION: string = translationKey(
  "When a schedule puts you on call, your shifts show up here.",
);

export const UPCOMING_SHIFTS_TRUNCATED_COPY: string = translationKey(
  "One of your schedules is too complex to compute fully; some shifts may be missing.",
);

// Said instead of the empty panel when that incomplete answer has no shifts.
export const UPCOMING_SHIFTS_TRUNCATED_EMPTY_COPY: string = translationKey(
  "No shifts could be listed for the next 30 days.",
);

/**
 * A link nobody has fetched for this long after it was minted is probably
 * unreachable from where the calendar client runs.
 */
export const NOTHING_FETCHED_HINT_AFTER_HOURS: number = 48;

/*
 * The note under the subscribe buttons: two short sentences, not a table of
 * every app's refresh interval (the docs page has that). The first is the one
 * thing people subscribing in Google Calendar need to know before they decide
 * it is broken; the second only shows on a self-hosted install, where it is
 * the usual reason a Google Calendar stays empty. Kept as constants so the
 * component, the schedule card and the tests read the same sentence.
 */
export const REFRESH_CADENCE_COPY: string = translationKey(
  "Google Calendar refreshes subscribed calendars on its own schedule, every few hours (sometimes only once a day), so changes take a while to show up there. Reminders and pages still come from OneUptime on time.",
);

export const REACHABILITY_COPY: string = translationKey(
  "Google Calendar reads this link from Google's servers, so this OneUptime server must be reachable from the internet.",
);

/*
 * Said when HOST is a private address (FeedStatus.privateHost): the one case
 * where Google Calendar is known to stay empty however the link is added.
 */
export const PRIVATE_HOST_COPY: string = translationKey(
  "Google Calendar and Outlook on the web can't reach this link: {{host}} is a private address, and they read calendars from their own servers. Apple Calendar or Outlook on a computer in your network can still subscribe.",
);

/*
 * Under the Upcoming shifts list. An escalation rule that names a person or a
 * team pages them whenever it runs: there is no start or end to list, so a
 * reader who is on a policy that way sees no row - and is told why, and what
 * it means for them, in words that need no on-call vocabulary.
 */
export const STANDING_ASSIGNMENTS_COPY: string = translationKey(
  "Only schedule shifts are listed. If an escalation policy names you or your team directly, it can page you at any time.",
);

export const SHARED_LINK_OWNERSHIP_COPY: string =
  "The shared link belongs to the project, not to whoever copied it - treat it like a password and regenerate it when someone leaves.";

export const PLANNING_NOT_AUDIT_COPY: string =
  "This calendar is for planning. For hours on call and fairness, use the On-Call Time Log report.";

/*
 * What a link's status panel says before any calendar app has read the
 * link, in its first two days: nothing is wrong yet, and the one app that
 * can take hours is named, so a reader who subscribed in Google Calendar a
 * minute ago does not conclude the link is broken.
 */
export const WAITING_FOR_FIRST_SYNC_COPY: string = translationKey(
  "No calendar app has fetched this link yet. Most apps do within minutes of subscribing; Google Calendar can take a few hours.",
);

/*
 * Two days on, still never read. The same question the status line has
 * always asked, now the status itself.
 */
export const NOTHING_FETCHED_COPY: string = translationKey(
  "Nothing has fetched this link yet. Is this server reachable from where your calendar app runs?",
);

export const PERSONAL_NEEDS_REGENERATION_COPY: string = translationKey(
  "The stored link can no longer be read, usually because the server's encryption secret changed. Subscribers keep working, but the link cannot be shown until you regenerate it.",
);

export const SHARED_NEEDS_REGENERATION_COPY: string = translationKey(
  "The stored link can no longer be read, usually because the server's encryption secret changed. Subscribers keep working, but the link cannot be shown until an editor regenerates it.",
);

/*
 * What regeneration actually does, stated the way the server behaves: a fetch
 * on the rotated-out token inside its 30-day grace is answered with an EMPTY
 * calendar (spec 2.1), not with the old shifts. Saying the old link "keeps
 * working" would tell a reader who rotated because a colleague left that the
 * leaver still sees the roster for a month - the opposite of the truth - and
 * would contradict the sentence before it.
 */
export const REGENERATE_WARNING_COPY: string =
  "Every app subscribed to the current link stops updating and shows an empty calendar. For 30 days the old link keeps answering with that empty calendar instead of an error, then it stops working - paste the new link into every app you subscribed with.";

/** Placeholder is the date the grace ends. */
export const PERSONAL_PREVIOUS_LINK_COPY: string =
  "Your previous link returns an empty calendar until {{date}}, then stops working.";

export const SHARED_PREVIOUS_LINK_COPY: string =
  "The previous link returns an empty calendar until {{date}}, then stops working.";

export const DISABLED_FEED_COPY: string =
  "This link is disabled. Anyone subscribed sees an empty calendar until it is enabled again.";

/*
 * The empty states, before any link exists.
 *
 * Split into a title, a one-line lead and three bullets rather than the one
 * long sentence they replaced: this is the moment the reader decides whether
 * to subscribe, and "what is in it" and "who can read it" are two different
 * questions that a single paragraph made them separate for themselves. The
 * privacy line is deliberately blunt - the URL is the credential, and a
 * reader who learns that only after pasting it into a shared calendar has
 * learned it too late.
 */
export const PERSONAL_FEED_EMPTY_TITLE: string = "No calendar link yet";

export const PERSONAL_FEED_EMPTY_DESCRIPTION: string =
  "Generate a private link, then subscribe to it from your calendar app.";

export const PERSONAL_FEED_EMPTY_POINT_SHIFTS: string =
  "Every shift you hold on this project's schedules.";

export const PERSONAL_FEED_EMPTY_POINT_COVERING: string =
  "Shifts you cover for someone else, when an override names you.";

export const PERSONAL_FEED_EMPTY_POINT_PRIVATE: string =
  "Private to you. Anyone who has the link can read your shifts, so treat it like a password.";

/** The shared feed's equivalent; its lead says who the link is for. */
export const SHARED_FEED_EMPTY_TITLE: string = "No shared link yet";

export const COVERAGE_GAPS_DESCRIPTION: string =
  "Adds an event for every stretch where the schedule intends coverage but nobody is on call. Off-hours outside every layer's active time are never counted as a gap.";

/*
 * i18n interpolation.
 *
 * `translateString` looks the whole English sentence up as a flat key, which
 * is what lets a translator reorder the words - but it takes no values, and
 * i18next leaves `{{name}}` untouched when none are passed (skipOnVariables).
 * So the placeholders are filled here, after the lookup, from whichever
 * sentence came back. Building a sentence by concatenating translated
 * fragments (`t("Last fetched") + when + t("by") + client`) instead would fix
 * English word order into every language.
 *
 * A placeholder with no value is left as-is rather than blanked, so a broken
 * translation shows `{{when}}` (visible, reportable) instead of a sentence
 * with a hole in it.
 */
const PLACEHOLDER_PATTERN: RegExp = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

export type InterpolationValues = Record<string, string | number>;

type InterpolateFunction = (
  template: string,
  values: InterpolationValues,
) => string;

export const interpolate: InterpolateFunction = (
  template: string,
  values: InterpolationValues,
): string => {
  return template.replace(
    PLACEHOLDER_PATTERN,
    (match: string, name: string): string => {
      const value: string | number | undefined = values[name];

      if (value === undefined) {
        return match;
      }

      return String(value);
    },
  );
};

export type TranslateFunction = (
  value: string | undefined,
) => string | undefined;

type TranslateAndInterpolateFunction = (
  translate: TranslateFunction | undefined,
  template: string,
  values: InterpolationValues,
) => string;

/** Look the sentence up, then fill its placeholders. */
export const translateInterpolated: TranslateAndInterpolateFunction = (
  translate: TranslateFunction | undefined,
  template: string,
  values: InterpolationValues,
): string => {
  const translated: string =
    (translate ? translate(template) : undefined) || template;

  return interpolate(translated, values);
};

type BuildGoogleAddUrlFunction = (httpsUrl: string) => string;

/*
 * Google Calendar's add-by-URL link for a feed: its webcal:// address in
 * `cid`. Given the https:// address there, Google answers "Unable to add
 * calendar. Check the URL." - which is what this used to build.
 */
export const buildGoogleAddUrl: BuildGoogleAddUrlFunction = (
  httpsUrl: string,
): string => {
  return CalendarSubscriptionLinks.buildGoogleCalendarUrl(httpsUrl);
};

type AddScheduleFilterFunction = (url: string, scheduleId: string) => string;

/*
 * Appends `?schedule=<id>` to a feed URL, respecting a query string that is
 * already there. Only the personal feed understands the filter (spec §2.1);
 * the shared feeds are per schedule or per project by construction.
 */
export const addScheduleFilter: AddScheduleFilterFunction = (
  url: string,
  scheduleId: string,
): string => {
  const separator: string = url.includes("?") ? "&" : "?";
  return `${url}${separator}schedule=${encodeURIComponent(scheduleId)}`;
};

type ApplyScheduleFilterFunction = (
  urls: FeedUrls,
  scheduleId: string | null | undefined,
) => FeedUrls;

/*
 * The links of a feed, narrowed to one schedule. All three come from the
 * narrowed https address, so the filter reaches the webcal link and Google's
 * `cid` exactly as it reaches the address itself.
 */
export const applyScheduleFilter: ApplyScheduleFilterFunction = (
  urls: FeedUrls,
  scheduleId: string | null | undefined,
): FeedUrls => {
  if (!scheduleId) {
    return urls;
  }

  return CalendarSubscriptionLinks.build(
    addScheduleFilter(urls.https, scheduleId),
  );
};

type GetRotatedDaysAgoFunction = (
  rotatedAt: string | null | undefined,
  now: Date,
) => number | null;

export const getRotatedDaysAgo: GetRotatedDaysAgoFunction = (
  rotatedAt: string | null | undefined,
  now: Date,
): number | null => {
  if (!rotatedAt) {
    return null;
  }

  const rotated: Date = OneUptimeDate.fromString(rotatedAt);

  if (Number.isNaN(rotated.getTime())) {
    return null;
  }

  const days: number = Math.floor(
    (now.getTime() - rotated.getTime()) / (24 * 60 * 60 * 1000),
  );

  return days < 0 ? 0 : days;
};

type ShouldShowNothingFetchedHintFunction = (
  status: FeedStatus,
  now: Date,
) => boolean;

/*
 * "Nothing has fetched this link yet" is only worth saying once enough time
 * has passed for the slowest client (Google, up to 24 h) to have tried at
 * least twice. Before that it reads as an accusation about a link the reader
 * pasted five minutes ago.
 */
export const shouldShowNothingFetchedHint: ShouldShowNothingFetchedHintFunction =
  (status: FeedStatus, now: Date): boolean => {
    if (!status.exists || !status.isEnabled || status.fetchCount > 0) {
      return false;
    }

    if (status.lastFetchedAt) {
      return false;
    }

    if (!status.rotatedAt) {
      return false;
    }

    const rotated: Date = OneUptimeDate.fromString(status.rotatedAt);

    if (Number.isNaN(rotated.getTime())) {
      return false;
    }

    const hours: number =
      (now.getTime() - rotated.getTime()) / (60 * 60 * 1000);

    return hours >= NOTHING_FETCHED_HINT_AFTER_HOURS;
  };

/*
 * Where a link stands, as the status panel's pill names it. One value per
 * question a reader comes back with - is it on, has my calendar app read it,
 * can it still be shown - in the order the panel asks them: a link that
 * cannot be read or is off says so before anything about fetches.
 *
 * The labels are the mobile app's, where the two say the same thing
 * (OnCallCalendarFeedScreen's status pill): "Active", "Waiting for first
 * sync", "Needs regeneration". A disabled link is "Disabled", as the web's
 * own Disable / Enable say.
 */
export enum FeedHealth {
  // Read by a calendar app at least once, and on.
  Active = "active",
  // On, and not read yet: made less than two days ago.
  WaitingForFirstSync = "waiting-for-first-sync",
  // On, and not read in the two days since it was made.
  NotFetched = "not-fetched",
  // Off: subscribers are served an empty calendar.
  Disabled = "disabled",
  // The stored link cannot be decrypted, so it cannot be shown.
  NeedsRegeneration = "needs-regeneration",
}

export const FEED_HEALTH_LABELS: Record<FeedHealth, string> = {
  [FeedHealth.Active]: translationKey("Active"),
  [FeedHealth.WaitingForFirstSync]: translationKey("Waiting for first sync"),
  [FeedHealth.NotFetched]: translationKey("Not fetched yet"),
  [FeedHealth.Disabled]: translationKey("Disabled"),
  [FeedHealth.NeedsRegeneration]: translationKey("Needs regeneration"),
};

type GetFeedHealthFunction = (status: FeedStatus, now: Date) => FeedHealth;

export const getFeedHealth: GetFeedHealthFunction = (
  status: FeedStatus,
  now: Date,
): FeedHealth => {
  if (status.needsRegeneration) {
    return FeedHealth.NeedsRegeneration;
  }

  if (!status.isEnabled) {
    return FeedHealth.Disabled;
  }

  if (status.lastFetchedAt || status.fetchCount > 0) {
    return FeedHealth.Active;
  }

  if (shouldShowNothingFetchedHint(status, now)) {
    return FeedHealth.NotFetched;
  }

  return FeedHealth.WaitingForFirstSync;
};

/*
 * The client the server names when it cannot tell which app fetched the link
 * (classifyCalendarClient). "Last fetched 5 minutes ago by Other" says
 * nothing a plain "Last fetched 5 minutes ago" does not.
 */
export const UNKNOWN_CALENDAR_CLIENT: string = "Other";

// The app the server says last read the link, or null when it cannot say.
export const getFeedClientName: (
  client: string | null | undefined,
) => string | null = (client: string | null | undefined): string | null => {
  const name: string = (client || "").trim();

  if (!name || name === UNKNOWN_CALENDAR_CLIENT) {
    return null;
  }

  return name;
};

// Google Calendar, as classifyCalendarClient names it.
export const GOOGLE_CALENDAR_CLIENT: string = "Google Calendar";

/*
 * The refresh note is for people whose link Google Calendar reads: it is the
 * one app that takes hours, and the one people decide is broken. A reader on
 * Apple Calendar is not told about Google's schedule.
 */
export const isFetchedByGoogleCalendar: (status: FeedStatus) => boolean = (
  status: FeedStatus,
): boolean => {
  return getFeedClientName(status.lastFetchedClient) === GOOGLE_CALENDAR_CLIENT;
};

/*
 * The link as the page shows it while it is hidden: the host it lives on,
 * then dots where the secret is, ending in the same four characters the
 * status names ("link ending in …k3Qx"). The host is not the secret - the
 * token is - and showing it lets a self-hosted reader see at a glance which
 * server their calendar app will be pointed at. Nothing of the token but
 * those four characters, which the page already shows, is ever in it, and
 * the scheme is left off so more of the host fits.
 */
const MASK_LENGTH: number = 10;
export const MASK_CHARACTER: string = "•";

/*
 * The two halves are drawn apart: the address may be cut short on a narrow
 * screen, the dots and the four characters never are - they are what tells
 * one link from another.
 */
export interface MaskedFeedLink {
  // "oneuptime.example.com/", or "" when the link cannot be parsed.
  address: string;
  // "••••••••••k3Qx".
  secret: string;
}

export const maskFeedLink: (
  httpsUrl: string,
  tokenHint: string | null | undefined,
) => MaskedFeedLink = (
  httpsUrl: string,
  tokenHint: string | null | undefined,
): MaskedFeedLink => {
  const dots: string = MASK_CHARACTER.repeat(MASK_LENGTH);
  const hint: string = (tokenHint || "").trim();
  const secret: string = `${dots}${hint}`;

  try {
    const host: string = new URL(httpsUrl).host;

    if (!host) {
      return { address: "", secret: secret };
    }

    return { address: `${host}/`, secret: secret };
  } catch {
    return { address: "", secret: secret };
  }
};

export interface ReminderPreset {
  minutes: number;
  label: string;
}

/** The chips on "Remind me before shifts", in display order. */
export const REMINDER_PRESETS: Array<ReminderPreset> = [
  { minutes: 7 * 24 * 60, label: "1 week" },
  { minutes: 24 * 60, label: "1 day" },
  { minutes: 60, label: "1 hour" },
  { minutes: 15, label: "15 min" },
];

/*
 * Unit sentences for a lead time that is not one of the presets. Whole
 * sentences with a {{count}} placeholder rather than a number glued to a
 * translated unit word, so a language that puts the unit first (or inflects
 * it) can say so - and so the locale validator can check the placeholder.
 *
 * Only the plural forms exist because a count of one is unreachable here:
 * 1 week, 1 day and 1 hour are all presets, and one minute is below the
 * 15-minute floor the service enforces.
 */
export const LEAD_TIME_WEEKS_COPY: string = "{{count}} weeks";
export const LEAD_TIME_DAYS_COPY: string = "{{count}} days";
export const LEAD_TIME_HOURS_COPY: string = "{{count}} hours";
export const LEAD_TIME_MINUTES_COPY: string = "{{count}} minutes";

type FormatLeadTimeFunction = (
  minutes: number,
  translate?: TranslateFunction | undefined,
) => string;

/*
 * Human form of a lead time: exact multiples collapse to the larger unit,
 * anything else stays in minutes so that "90 minutes" is not rendered as
 * "1 hour".
 *
 * `translate` is optional so the function stays pure and testable in English;
 * the chip passes the page's translator so a custom reminder is not the one
 * label on the card left in English.
 */
export const formatLeadTime: FormatLeadTimeFunction = (
  minutes: number,
  translate?: TranslateFunction | undefined,
): string => {
  const preset: ReminderPreset | undefined = REMINDER_PRESETS.find(
    (candidate: ReminderPreset): boolean => {
      return candidate.minutes === minutes;
    },
  );

  if (preset) {
    return (translate ? translate(preset.label) : undefined) || preset.label;
  }

  if (minutes % (7 * 24 * 60) === 0) {
    return translateInterpolated(translate, LEAD_TIME_WEEKS_COPY, {
      count: minutes / (7 * 24 * 60),
    });
  }

  if (minutes % (24 * 60) === 0) {
    return translateInterpolated(translate, LEAD_TIME_DAYS_COPY, {
      count: minutes / (24 * 60),
    });
  }

  if (minutes % 60 === 0) {
    return translateInterpolated(translate, LEAD_TIME_HOURS_COPY, {
      count: minutes / 60,
    });
  }

  return translateInterpolated(translate, LEAD_TIME_MINUTES_COPY, {
    count: minutes,
  });
};

export interface LeadTimeValidation {
  minutes: number | null;
  error: string | null;
}

type ValidateCustomLeadMinutesFunction = (value: string) => LeadTimeValidation;

/*
 * The same bounds the service enforces (15 minutes ... 2 weeks), checked in the
 * browser so the modal can say what is wrong instead of relaying a 400.
 */
export const validateCustomLeadMinutes: ValidateCustomLeadMinutesFunction = (
  value: string,
): LeadTimeValidation => {
  const trimmed: string = value.trim();

  if (trimmed === "") {
    return { minutes: null, error: "Enter how many minutes before the shift." };
  }

  const minutes: number = Number(trimmed);

  if (!Number.isInteger(minutes)) {
    return { minutes: null, error: "Enter a whole number of minutes." };
  }

  if (
    minutes < MIN_MINUTES_BEFORE_SHIFT ||
    minutes > MAX_MINUTES_BEFORE_SHIFT
  ) {
    return {
      minutes: null,
      error: `Reminders can be sent between ${MIN_MINUTES_BEFORE_SHIFT} minutes and ${MAX_MINUTES_BEFORE_SHIFT / (24 * 60)} days before a shift.`,
    };
  }

  return { minutes: minutes, error: null };
};

type IsCoveringShiftFunction = (shift: MaterializedShiftJson) => boolean;

/** A shift the reader holds because of an override that names them. */
export const isCoveringShift: IsCoveringShiftFunction = (
  shift: MaterializedShiftJson,
): boolean => {
  return Boolean(
    shift.override && shift.override.originalUserId !== shift.userId,
  );
};

export interface UpcomingShiftsWindow {
  from: Date;
  to: Date;
}

type GetUpcomingShiftsWindowFunction = (now: Date) => UpcomingShiftsWindow;

export const getUpcomingShiftsWindow: GetUpcomingShiftsWindowFunction = (
  now: Date,
): UpcomingShiftsWindow => {
  return {
    from: now,
    to: new Date(now.getTime() + UPCOMING_SHIFTS_DAYS * 24 * 60 * 60 * 1000),
  };
};
