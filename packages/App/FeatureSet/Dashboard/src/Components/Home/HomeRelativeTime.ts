/*
 * "2 hours ago", "in 3 days", "vor 2 Stunden", "dans 3 jours" - the times
 * Home puts next to an incident, a maintenance window or the last refresh.
 *
 * Intl.RelativeTimeFormat already knows every locale's words and plural
 * rules, so these need no translation keys; a hand-written
 * "{{count}} hours ago" would need three forms for Russian alone. A runtime
 * without it, or a language tag it rejects, falls back to English rather
 * than failing the card it is drawn in.
 *
 * Pure: `now` is handed in, so the wording can be tested without waiting.
 */

export interface RelativeTimeParts {
  // Negative for the past, positive for the future: format(-2, "hour").
  value: number;
  unit: Intl.RelativeTimeFormatUnit;
}

const SECOND_IN_MS: number = 1000;
const MINUTE_IN_SECONDS: number = 60;
const HOUR_IN_SECONDS: number = 60 * MINUTE_IN_SECONDS;
const DAY_IN_SECONDS: number = 24 * HOUR_IN_SECONDS;
const MONTH_IN_SECONDS: number = 30 * DAY_IN_SECONDS;
const YEAR_IN_SECONDS: number = 365 * DAY_IN_SECONDS;

// Under this, a time is "now": a readout counting seconds is noise.
export const JUST_NOW_THRESHOLD_IN_SECONDS: number = 45;

export const getRelativeTimeParts: (data: {
  date: Date;
  now: Date;
}) => RelativeTimeParts = (data: {
  date: Date;
  now: Date;
}): RelativeTimeParts => {
  const milliseconds: number = data.date.getTime() - data.now.getTime();

  if (!Number.isFinite(milliseconds)) {
    return { value: 0, unit: "second" };
  }

  const seconds: number = milliseconds / SECOND_IN_MS;
  const sign: number = seconds < 0 ? -1 : 1;
  const magnitude: number = Math.abs(seconds);

  if (magnitude < JUST_NOW_THRESHOLD_IN_SECONDS) {
    // numeric: "auto" writes 0 seconds as "now".
    return { value: 0, unit: "second" };
  }

  if (magnitude < HOUR_IN_SECONDS) {
    return {
      value: sign * Math.max(1, Math.round(magnitude / MINUTE_IN_SECONDS)),
      unit: "minute",
    };
  }

  if (magnitude < DAY_IN_SECONDS) {
    return {
      value: sign * Math.max(1, Math.floor(magnitude / HOUR_IN_SECONDS)),
      unit: "hour",
    };
  }

  if (magnitude < MONTH_IN_SECONDS) {
    return {
      value: sign * Math.max(1, Math.floor(magnitude / DAY_IN_SECONDS)),
      unit: "day",
    };
  }

  if (magnitude < YEAR_IN_SECONDS) {
    return {
      value: sign * Math.max(1, Math.floor(magnitude / MONTH_IN_SECONDS)),
      unit: "month",
    };
  }

  return {
    value: sign * Math.max(1, Math.floor(magnitude / YEAR_IN_SECONDS)),
    unit: "year",
  };
};

const formatInEnglish: (parts: RelativeTimeParts) => string = (
  parts: RelativeTimeParts,
): string => {
  const magnitude: number = Math.abs(parts.value);

  if (magnitude === 0) {
    return "now";
  }

  const unit: string = magnitude === 1 ? parts.unit : `${parts.unit}s`;

  return parts.value < 0
    ? `${magnitude} ${unit} ago`
    : `in ${magnitude} ${unit}`;
};

export const formatRelativeTime: (data: {
  date: Date;
  now: Date;
  language?: string | undefined;
}) => string = (data: {
  date: Date;
  now: Date;
  language?: string | undefined;
}): string => {
  const parts: RelativeTimeParts = getRelativeTimeParts({
    date: data.date,
    now: data.now,
  });

  try {
    return new Intl.RelativeTimeFormat(data.language || "en", {
      numeric: "auto",
    }).format(parts.value, parts.unit);
  } catch {
    return formatInEnglish(parts);
  }
};

// Whether a time is close enough to now to say "just now" instead.
export const isJustNow: (data: { date: Date; now: Date }) => boolean = (data: {
  date: Date;
  now: Date;
}): boolean => {
  return getRelativeTimeParts(data).value === 0;
};

/*
 * A date read off the API: a Date, or its string form. Anything that is not
 * a real moment in time reads as undefined, so a card never prints "NaN".
 */
export const toDate: (value: unknown) => Date | undefined = (
  value: unknown,
): Date | undefined => {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }

  const date: Date =
    value instanceof Date ? value : new Date(value as string | number);

  return Number.isFinite(date.getTime()) ? date : undefined;
};
