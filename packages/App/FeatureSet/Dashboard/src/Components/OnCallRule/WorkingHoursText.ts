import RestrictionTimes from "Common/Types/OnCallDutyPolicy/RestrictionTimes";
import WorkingHours, {
  WorkingHoursSpan,
} from "Common/Types/OnCallDutyPolicy/WorkingHours";
import OnCallRuleWhenToPage from "Common/Types/OnCallDutyPolicy/OnCallRuleWhenToPage";
import { JSONObject } from "Common/Types/JSON";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * AN ON-CALL RULE'S WORKING HOURS, IN THE READER'S WORDS.
 *
 * A rule set to "Only during working hours" says what that means in one
 * plain sentence, under the choice on its form - "Alerts that match this rule
 * outside Mon–Fri 09:00–17:00 (Europe/London) wait, and paging starts at
 * 09:00." - and in a few words on its row in the rules table: "Pages only
 * Mon–Fri 09:00–17:00 (Europe/London)". A rule that pages right away says
 * nothing: nothing about it changed.
 *
 * The hours are said on the rule's own clock - the zone they are in, named
 * after them - with the day names the Dashboard already translates, and the
 * time the way the reader's clock shows it: 09:00, or 9:00 AM.
 */

// The records an on-call rule pages for: its sentence names them.
export enum OnCallRuleRecord {
  Alert = "Alert",
  Incident = "Incident",
  AlertEpisode = "AlertEpisode",
  IncidentEpisode = "IncidentEpisode",
}

// Monday first, as WorkingHours counts the days.
export const WORKING_HOURS_DAY_SHORT_NAMES: ReadonlyArray<string> = [
  translationKey("Mon"),
  translationKey("Tue"),
  translationKey("Wed"),
  translationKey("Thu"),
  translationKey("Fri"),
  translationKey("Sat"),
  translationKey("Sun"),
];

export const WORKING_HOURS_DAY_NAMES: ReadonlyArray<string> = [
  translationKey("Monday"),
  translationKey("Tuesday"),
  translationKey("Wednesday"),
  translationKey("Thursday"),
  translationKey("Friday"),
  translationKey("Saturday"),
  translationKey("Sunday"),
];

export const WORKING_HOURS_EVERY_DAY: string = translationKey("Every day");

export interface WorkingHoursSummaryTemplates {
  // Every day of the hours begins at the same time.
  startsAt: string;
  // The days begin at different times.
  startsWhenTheyBegin: string;
}

// What happens to a match outside the hours, said for each kind of record.
export const WORKING_HOURS_SUMMARIES: Record<
  OnCallRuleRecord,
  WorkingHoursSummaryTemplates
> = {
  [OnCallRuleRecord.Alert]: {
    startsAt: translationKey(
      "Alerts that match this rule outside {{hours}} wait, and paging starts at {{time}}.",
    ),
    startsWhenTheyBegin: translationKey(
      "Alerts that match this rule outside {{hours}} wait, and paging starts when working hours begin.",
    ),
  },
  [OnCallRuleRecord.Incident]: {
    startsAt: translationKey(
      "Incidents that match this rule outside {{hours}} wait, and paging starts at {{time}}.",
    ),
    startsWhenTheyBegin: translationKey(
      "Incidents that match this rule outside {{hours}} wait, and paging starts when working hours begin.",
    ),
  },
  [OnCallRuleRecord.AlertEpisode]: {
    startsAt: translationKey(
      "Alert episodes that match this rule outside {{hours}} wait, and paging starts at {{time}}.",
    ),
    startsWhenTheyBegin: translationKey(
      "Alert episodes that match this rule outside {{hours}} wait, and paging starts when working hours begin.",
    ),
  },
  [OnCallRuleRecord.IncidentEpisode]: {
    startsAt: translationKey(
      "Incident episodes that match this rule outside {{hours}} wait, and paging starts at {{time}}.",
    ),
    startsWhenTheyBegin: translationKey(
      "Incident episodes that match this rule outside {{hours}} wait, and paging starts when working hours begin.",
    ),
  },
};

// On the rule's row in the rules table.
export const WORKING_HOURS_ROW_SUMMARY: string = translationKey(
  "Pages only {{hours}}",
);

/*
 * The dash of a range - "Mon–Fri", "09:00–17:00" - held to the words on
 * either side by word joiners, so a line never breaks inside a range:
 * "09:00–" at the end of one line and "17:00" on the next.
 */
export const WORKING_HOURS_RANGE_DASH: string = "\u2060–\u2060";

// Between 12-hour times, which carry their AM and PM: "9:00 AM – 5:00 PM".
const WORKING_HOURS_SPACED_RANGE_DASH: string = "\u00a0–\u00a0";

export interface WorkingHoursTextOptions {
  translator: Translator;
  // The reader's clock: 9:00 AM, or 09:00.
  use12HourFormat: boolean;
  /*
   * Whether the hours end with their zone: "(Europe/London)". Left out, they
   * do; a line too short for it - the folded More fields line - leaves it out.
   */
  withTimezone?: boolean | undefined;
}

export interface WorkingHoursOfRule {
  whenToPage?: OnCallRuleWhenToPage | string | null | undefined;
  workingHours?: RestrictionTimes | JSONObject | null | undefined;
  workingHoursTimezone?: string | null | undefined;
}

// "17:00" as the reader's clock shows it: "17:00", or "5:00 PM".
export const formatClock: (
  clock: string,
  options: WorkingHoursTextOptions,
) => string = (clock: string, options: WorkingHoursTextOptions): string => {
  const minuteOfDay: number | null = WorkingHours.parseClock(clock);

  if (minuteOfDay === null || !options.use12HourFormat) {
    return clock;
  }

  try {
    return new Intl.DateTimeFormat(options.translator.language || "en", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone: "UTC",
    }).format(
      new Date(
        Date.UTC(2024, 0, 1, Math.floor(minuteOfDay / 60), minuteOfDay % 60),
      ),
    );
  } catch {
    return clock;
  }
};

/*
 * The days, as few words as they take: "Mon–Fri", "Mon, Wed, Fri",
 * "Mon–Wed, Fri", "Sat, Sun", or "Every day". Days in a row - three or more -
 * are one range.
 */
export const describeDays: (
  days: ReadonlyArray<number>,
  translator: Translator,
) => string = (days: ReadonlyArray<number>, translator: Translator): string => {
  const sorted: Array<number> = Array.from(new Set(days))
    .filter((day: number): boolean => {
      return day >= 0 && day <= 6;
    })
    .sort((a: number, b: number): number => {
      return a - b;
    });

  if (sorted.length === 7) {
    return translator.translateText(WORKING_HOURS_EVERY_DAY)!;
  }

  const name: (day: number) => string = (day: number): string => {
    return translator.translateText(WORKING_HOURS_DAY_SHORT_NAMES[day]!)!;
  };

  const runs: Array<Array<number>> = [];

  for (const day of sorted) {
    const run: Array<number> | undefined = runs[runs.length - 1];

    if (run && run[run.length - 1] === day - 1) {
      run.push(day);
      continue;
    }

    runs.push([day]);
  }

  return runs
    .map((run: Array<number>): string => {
      if (run.length >= 3) {
        return `${name(run[0]!)}${WORKING_HOURS_RANGE_DASH}${name(
          run[run.length - 1]!,
        )}`;
      }

      return run.map(name).join(", ");
    })
    .join(", ");
};

// From one time to another: "09:00–17:00", or "9:00 AM – 5:00 PM".
const describeRange: (
  from: string,
  to: string,
  options: WorkingHoursTextOptions,
) => string = (
  from: string,
  to: string,
  options: WorkingHoursTextOptions,
): string => {
  const separator: string = options.use12HourFormat
    ? WORKING_HOURS_SPACED_RANGE_DASH
    : WORKING_HOURS_RANGE_DASH;

  return `${formatClock(from, options)}${separator}${formatClock(to, options)}`;
};

const describeSpan: (
  span: WorkingHoursSpan,
  options: WorkingHoursTextOptions,
) => string = (
  span: WorkingHoursSpan,
  options: WorkingHoursTextOptions,
): string => {
  if (span.endsDaysLater <= 1) {
    return `${describeDays(span.days, options.translator)} ${describeRange(
      span.from,
      span.to,
      options,
    )}`;
  }

  // Hours over several days say where each begins and ends: "Fri 17:00 – Mon 09:00".
  return span.days
    .map((day: number): string => {
      const endDay: number = (day + span.endsDaysLater) % 7;

      return `${describeDays([day], options.translator)} ${formatClock(
        span.from,
        options,
      )} – ${describeDays([endDay], options.translator)} ${formatClock(
        span.to,
        options,
      )}`;
    })
    .join(", ");
};

/*
 * The hours and their zone: "Mon–Fri 09:00–17:00 (Europe/London)". Null when
 * they never open, or are in no zone OneUptime knows.
 */
export const describeWorkingHours: (
  rule: WorkingHoursOfRule,
  options: WorkingHoursTextOptions,
) => string | null = (
  rule: WorkingHoursOfRule,
  options: WorkingHoursTextOptions,
): string | null => {
  const timezone: string | null | undefined = rule.workingHoursTimezone;

  if (
    WorkingHours.getProblem({ hours: rule.workingHours, timezone: timezone })
  ) {
    return null;
  }

  const spans: Array<WorkingHoursSpan> = WorkingHours.getSpans({
    hours: rule.workingHours,
    timezone: timezone,
  });

  if (spans.length === 0) {
    return null;
  }

  const hours: string = spans
    .map((span: WorkingHoursSpan): string => {
      return describeSpan(span, options);
    })
    .join("; ");

  return options.withTimezone === false
    ? hours
    : `${hours} (${timezone!.trim()})`;
};

/*
 * What the rule does with a match outside its hours, in one sentence - or
 * null for a rule that pages right away, or whose hours never open.
 */
export const getWorkingHoursSummary: (
  rule: WorkingHoursOfRule,
  record: OnCallRuleRecord,
  options: WorkingHoursTextOptions,
) => string | null = (
  rule: WorkingHoursOfRule,
  record: OnCallRuleRecord,
  options: WorkingHoursTextOptions,
): string | null => {
  if (rule.whenToPage !== OnCallRuleWhenToPage.WorkingHours) {
    return null;
  }

  const hours: string | null = describeWorkingHours(rule, options);

  if (!hours) {
    return null;
  }

  const templates: WorkingHoursSummaryTemplates =
    WORKING_HOURS_SUMMARIES[record];
  const start: string | null = WorkingHours.getStartTime({
    hours: rule.workingHours,
    timezone: rule.workingHoursTimezone,
  });

  if (!start) {
    return options.translator.translateTemplate(templates.startsWhenTheyBegin, {
      hours: hours,
    });
  }

  return options.translator.translateTemplate(templates.startsAt, {
    hours: hours,
    time: formatClock(start, options),
  });
};

/*
 * The rule's row: "Pages only Mon–Fri 09:00–17:00 (Europe/London)" - or
 * null for a rule that pages right away, or whose hours never open.
 */
export const getWorkingHoursRowSummary: (
  rule: WorkingHoursOfRule,
  options: WorkingHoursTextOptions,
) => string | null = (
  rule: WorkingHoursOfRule,
  options: WorkingHoursTextOptions,
): string | null => {
  if (rule.whenToPage !== OnCallRuleWhenToPage.WorkingHours) {
    return null;
  }

  const hours: string | null = describeWorkingHours(rule, options);

  return hours
    ? options.translator.translateTemplate(WORKING_HOURS_ROW_SUMMARY, {
        hours: hours,
      })
    : null;
};
