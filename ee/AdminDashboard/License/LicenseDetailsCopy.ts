import {
  PluralTemplate,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * What the license details say (./LicenseDetails.tsx): the seat usage card
 * and the instances on the license, in the edition dialog of the Admin
 * Dashboard's header and the Dashboard's footer, and on Settings > License.
 *
 * Kept free of React so the component and its tests read the same words.
 * Every sentence is an English key of the Admin Dashboard's and the
 * Dashboard's locale files, in every language (ee/Tests/UI/License/
 * LicenseDetailsWords.test.ts): the edition dialog around these cards is in
 * the reader's language, and these cards were the one part of it still in
 * English - read right to left on an Arabic or Persian page, with their
 * full stops at the wrong end.
 *
 * Counts are whole sentences per form (PluralTemplate: `other` is the key,
 * `one` sits under the key plus "_one"), so a language words "4 seats
 * remaining" its own way.
 */
export const LicenseDetailsCopy: {
  seatsTitle: string;
  seatsDescription: string;
  limitExceeded: string;
  nearlyFull: string;
  unlimited: string;
  noSeatsRemaining: string;
  seatUsageLabel: string;
  seatsInUsePercent: string;
  everySeatInUse: string;
  overLimitEnforced: string;
  overLimit: string;
  nearlyOutOfSeats: string;
  expandLicense: string;
  requestMoreSeats: string;
  orEmailDirectly: string;
  activatedOffline: string;
  lastReportedToOneUptime: string;
  enforcesSeatLimit: string;
  boughtMoreSeats: string;
  instancesTitle: string;
  instancesDescription: string;
  unknownHost: string;
  thisInstance: string;
  running: string;
  runningUpdateAvailable: string;
  noUsageReported: string;
  lastReported: string;
  updateAvailable: string;
  instanceUsers: string;
} = {
  seatsTitle: translationKey("Licensed seats"),
  seatsDescription: translationKey(
    "Unique users across every instance on this license.",
  ),
  limitExceeded: translationKey("Limit exceeded"),
  nearlyFull: translationKey("Nearly full"),
  // After the seats in use ("37 / unlimited"), where a license sets no limit.
  unlimited: translationKey("/ unlimited"),
  noSeatsRemaining: translationKey("No seats remaining"),
  seatUsageLabel: translationKey("Licensed seat usage"),
  seatsInUsePercent: translationKey("{{percent}}% of licensed seats in use"),
  everySeatInUse: translationKey("Every licensed seat is in use"),
  overLimitEnforced: translationKey(
    "This installation is using {{used}} of {{limit}} licensed seats. New users cannot be invited, signed up or provisioned until a seat is freed up or the license is expanded.",
  ),
  overLimit: translationKey(
    "This installation is using {{used}} of {{limit}} licensed seats. Expand your license so it covers everyone on the platform.",
  ),
  nearlyOutOfSeats: translationKey(
    "You're using {{used}} of {{limit}} licensed seats. Anyone you add beyond {{limit}} puts this installation over its licensed limit — if more people are joining, it's worth talking to OneUptime about expanding now.",
  ),
  expandLicense: translationKey("Expand your license"),
  requestMoreSeats: translationKey("Request more seats"),
  orEmailDirectly: translationKey("Or email {{email}} directly."),
  activatedOffline: translationKey(
    "This installation was activated offline, so it does not report its user count to OneUptime.",
  ),
  lastReportedToOneUptime: translationKey(
    "Last reported to OneUptime on {{date}}.",
  ),
  enforcesSeatLimit: translationKey(
    "This installation enforces the seat limit: users above it cannot be invited, signed up or provisioned.",
  ),
  boughtMoreSeats: translationKey(
    "Bought more seats? Refresh the license to apply the new limit without waiting for the next daily report.",
  ),
  instancesTitle: translationKey("Instances on this license"),
  instancesDescription: translationKey(
    "Use the same license key on every instance you deploy (staging, production, and so on). Each instance reports its usage and the version it runs once a day.",
  ),
  unknownHost: translationKey("Unknown host"),
  thisInstance: translationKey("This instance"),
  running: translationKey("Running v{{version}}."),
  runningUpdateAvailable: translationKey(
    "Running v{{version}}. OneUptime v{{latest}} is available.",
  ),
  noUsageReported: translationKey("No usage reported yet."),
  lastReported: translationKey("Last reported {{date}}."),
  updateAvailable: translationKey("Update available."),
  /*
   * An instance's users, at the end of its row, the number drawn bolder
   * than the word: "Users: 7", "Benutzer: 7", "Пользователей: 7". A label
   * and its figure, so it reads the same for every count and starts with a
   * capital in every language. A key of its own: "{{count}} users" is also
   * a count inside a sentence ("3 projects, 12 users and 140 monitors" on
   * the Admin Dashboard's Backups page), worded to sit mid-sentence - in
   * Russian "пользователей: 12" - where this line begins one (#7134).
   */
  instanceUsers: translationKey("Users: {{count}}"),
};

/*
 * After the seats in use: "37 / 50 seats". The slash is the sentence's, so
 * a language that counts its nouns another way says it its own way ("37 из
 * 50" in Russian, "37 من أصل 50" in Arabic) under the card's title.
 */
export const SEAT_LIMIT: PluralTemplate = {
  one: translationKey("/ {{count}} seat"),
  other: translationKey("/ {{count}} seats"),
};

export const SEATS_REMAINING: PluralTemplate = {
  one: translationKey("{{count}} seat remaining"),
  other: translationKey("{{count}} seats remaining"),
};

export const USERS_OVER_LIMIT: PluralTemplate = {
  one: translationKey("{{count}} over limit"),
  other: translationKey("{{count}} over limit"),
};

export const USERS_OVER_LICENSED_SEATS: PluralTemplate = {
  one: translationKey("{{count}} user over your licensed seats"),
  other: translationKey("{{count}} users over your licensed seats"),
};

export const SEATS_LEFT: PluralTemplate = {
  one: translationKey("Only {{count}} seat left on your license"),
  other: translationKey("Only {{count}} seats left on your license"),
};

// The hours are the daily report's: an hour count, in the reader's digits.
export const FIRST_REPORT_WITHIN: PluralTemplate = {
  one: translationKey(
    "User count has not been reported to OneUptime yet. The first report will be sent within {{count}} hour.",
  ),
  other: translationKey(
    "User count has not been reported to OneUptime yet. The first report will be sent within {{count}} hours.",
  ),
};

export const INSTANCES: PluralTemplate = {
  one: translationKey("{{count}} instance"),
  other: translationKey("{{count}} instances"),
};

// Shown only with two instances or more; the one form is a language's own.
export const SEATS_COUNTED_UNIQUELY: PluralTemplate = {
  one: translationKey(
    "Seats are counted uniquely across the {{count}} instance that shares this license — the same person on multiple instances uses one seat.",
  ),
  other: translationKey(
    "Seats are counted uniquely across all {{count}} instances that share this license — the same person on multiple instances uses one seat.",
  ),
};

export const PER_INSTANCE_COUNTS: PluralTemplate = {
  one: translationKey(
    "Per-instance counts can therefore add up to more than the {{count}} unique user counted above.",
  ),
  other: translationKey(
    "Per-instance counts can therefore add up to more than the {{count}} unique users counted above.",
  ),
};

export const LICENSE_DETAILS_PLURALS: ReadonlyArray<PluralTemplate> = [
  SEAT_LIMIT,
  SEATS_REMAINING,
  USERS_OVER_LIMIT,
  USERS_OVER_LICENSED_SEATS,
  SEATS_LEFT,
  FIRST_REPORT_WITHIN,
  INSTANCES,
  SEATS_COUNTED_UNIQUELY,
  PER_INSTANCE_COUNTS,
];

// A new installation's first daily usage report goes out within a day.
export const FIRST_REPORT_WITHIN_HOURS: number = 24;
