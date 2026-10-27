import { formatNameList } from "../../AiAccess/AiAccessModes";
import {
  PluralTemplate,
  Translator,
  composedValue,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import {
  getFeedDayKey,
  getFeedLocale,
  getFeedZoneName,
} from "Common/UI/Components/Feed/FeedTime";
import OneUptimeDate from "Common/Types/Date";
import {
  RUNBOOK_SCHEDULE_DAY_ORDER,
  RUNBOOK_SCHEDULE_HOUR_INTERVALS,
  RUNBOOK_SCHEDULE_MINUTE_INTERVALS,
  RUNBOOK_SCHEDULE_WEEKDAYS,
  RunbookScheduleChoice,
  RunbookScheduleMissedRunPolicy,
  RunbookScheduleOverlapPolicy,
  RunbookScheduleProblem,
  RunbookScheduleProblemCode,
  RunbookScheduleRepeat,
} from "Common/Types/Runbook/RunbookSchedule";
import RunbookTriggerType from "Common/Types/Runbook/RunbookTriggerType";

/*
 * A RUNBOOK'S TRIGGERS PAGE, in words: a schedule card, a webhook card, and
 * how a run says what started it on the Executions lists and its own page.
 *
 * Kept free of React so the components, App/Tests and the docs suites read
 * these exact strings. Every sentence is a whole translationKey() - a
 * language words it as a whole - and the schedule's sentence is built from
 * one per kind of schedule, with only numbers, times and day names put in.
 */

export const RunbookTriggersCopy: {
  readonly pageTitle: string;
  readonly scheduleCardTitle: string;
  readonly scheduleCardDescription: string;
  readonly scheduleEmptyTitle: string;
  readonly scheduleEmptyDescription: string;
  readonly learnMoreSchedule: string;
  readonly setUpScheduleButton: string;
  readonly editScheduleButton: string;
  readonly scheduleSwitchTitle: string;
  readonly scheduleSwitchOff: string;
  readonly nextRunsTitle: string;
  readonly noNextRun: string;
  readonly overlapTitle: string;
  readonly missedRunsTitle: string;
  readonly lastScheduledRunTitle: string;
  readonly noScheduledRunYet: string;
  readonly viewRun: string;
  readonly waitingRun: string;
  readonly runbookOffSchedule: string;
  readonly noStepsSchedule: string;
  readonly settingsPage: string;
  readonly stepsPage: string;
  readonly scheduleLocked: string;
  readonly dialogSetUpTitle: string;
  readonly dialogEditTitle: string;
  readonly dialogDescription: string;
  readonly dialogSubmit: string;
  readonly whenItRunsTitle: string;
  readonly repeatLabel: string;
  readonly everyLabel: string;
  readonly atLabel: string;
  readonly atMinuteLabel: string;
  readonly onDaysLabel: string;
  readonly cronLabel: string;
  readonly cronHint: string;
  readonly weekdaysShortcut: string;
  readonly everyDayShortcut: string;
  readonly timezoneTitle: string;
  readonly overlapFieldDescription: string;
  readonly missedFieldDescription: string;
  readonly previewNextRuns: string;
  readonly webhookCardTitle: string;
  readonly webhookCardDescription: string;
  readonly webhookSwitchTitle: string;
  readonly webhookSwitchOn: string;
  readonly webhookSwitchOff: string;
  readonly webhookUrlTitle: string;
  readonly copyUrl: string;
  readonly copyUrlTitle: string;
  readonly copied: string;
  readonly show: string;
  readonly hide: string;
  readonly showTitle: string;
  readonly hideTitle: string;
  readonly maskedForScreenReaders: string;
  readonly tryIt: string;
  readonly copyExample: string;
  readonly copyExampleTitle: string;
  readonly inputsTitle: string;
  readonly inputsSentence: string;
  readonly keepPrivate: string;
  readonly keepPrivateCanReset: string;
  readonly resetUrl: string;
  readonly resetConfirmTitle: string;
  readonly resetConfirmDescription: string;
  readonly resetDone: string;
  readonly urlHidden: string;
  readonly urlLoading: string;
  readonly urlLoadFailed: string;
  readonly runbookOffWebhook: string;
  readonly noStepsWebhook: string;
  readonly learnMore: string;
  readonly testButton: string;
  readonly testTitle: string;
  readonly testDescription: string;
  readonly testBodyTitle: string;
  readonly testSubmit: string;
  readonly testStarted: string;
  readonly testViewRun: string;
  readonly testBodyNotJson: string;
  readonly triggerLocked: string;
} = {
  pageTitle: translationKey("Triggers"),

  scheduleCardTitle: translationKey("Schedule"),
  scheduleCardDescription: translationKey(
    "Run this runbook on its own at set times.",
  ),
  scheduleEmptyTitle: translationKey("No schedule yet"),
  scheduleEmptyDescription: translationKey(
    "Run it every few minutes, every day, or on the days of the week you pick.",
  ),
  learnMoreSchedule: translationKey("How schedules work"),
  setUpScheduleButton: translationKey("Set Up Schedule"),
  editScheduleButton: translationKey("Edit Schedule"),
  scheduleSwitchTitle: translationKey("Run on this schedule"),
  scheduleSwitchOff: translationKey(
    "Paused. Nothing runs on this schedule until you turn it on.",
  ),
  nextRunsTitle: translationKey("Next runs"),
  noNextRun: translationKey("This schedule has no run in the coming years."),
  overlapTitle: translationKey("If a run is still going"),
  missedRunsTitle: translationKey("If OneUptime missed a time"),
  lastScheduledRunTitle: translationKey("Last scheduled run"),
  noScheduledRunYet: translationKey("None yet."),
  viewRun: translationKey("View run"),
  waitingRun: translationKey(
    "A scheduled run is waiting for the run in progress to end.",
  ),
  /*
   * {{settings}} and {{steps}} are links to the runbook's own Settings and
   * Steps pages (Settings sits in a folded section of the runbook's menu).
   */
  runbookOffSchedule: translationKey(
    "This runbook is turned off, so its schedule starts nothing. Turn it on under {{settings}}.",
  ),
  noStepsSchedule: translationKey(
    "This runbook has no steps yet, so its schedule starts nothing. Add steps under {{steps}}.",
  ),
  // The pages the notes link to, named as the runbook's menu names them.
  settingsPage: translationKey("Settings"),
  stepsPage: translationKey("Steps"),
  scheduleLocked: translationKey(
    "Setting up a schedule takes permission to edit this runbook and to run it.",
  ),

  dialogSetUpTitle: translationKey("Set Up Schedule"),
  dialogEditTitle: translationKey("Edit Schedule"),
  dialogDescription: translationKey("Pick when this runbook runs on its own."),
  dialogSubmit: translationKey("Save Schedule"),
  whenItRunsTitle: translationKey("When it runs"),
  repeatLabel: translationKey("Repeat"),
  everyLabel: translationKey("Every"),
  /*
   * Labels of their own: "At" and "On" are also the Dashboard's words for a
   * date and a switch that is on, and some languages word them that way.
   */
  atLabel: translationKey("Time of day"),
  atMinuteLabel: translationKey("Minutes past the hour"),
  onDaysLabel: translationKey("On these days"),
  cronLabel: translationKey("Cron expression"),
  // {{example}} is a cron expression, drawn as code on one line.
  cronHint: translationKey(
    "Five fields: minute, hour, day of month, month and day of week. For example, {{example}} runs at 09:00 on weekdays.",
  ),
  weekdaysShortcut: translationKey("Weekdays"),
  everyDayShortcut: translationKey("Every day"),
  timezoneTitle: translationKey("Time zone"),
  overlapFieldDescription: translationKey(
    "A run is still going while it is queued, running, or waiting for someone to complete or approve a step - however it started.",
  ),
  missedFieldDescription: translationKey(
    "When OneUptime was down or being upgraded at a scheduled time.",
  ),
  previewNextRuns: translationKey("Next runs"),

  webhookCardTitle: translationKey("Webhook"),
  webhookCardDescription: translationKey(
    "Start this runbook from another tool - an alerting system, a CI pipeline or a script - by sending a POST request to a URL.",
  ),
  webhookSwitchTitle: translationKey("Run when this URL is called"),
  webhookSwitchOn: translationKey(
    "Each POST request to the URL below starts a run.",
  ),
  webhookSwitchOff: translationKey(
    "Turn it on to get a URL that starts this runbook.",
  ),
  webhookUrlTitle: translationKey("Webhook URL"),
  copyUrl: translationKey("Copy URL"),
  copyUrlTitle: translationKey("Copy the webhook URL"),
  copied: translationKey("Copied!"),
  show: translationKey("Show"),
  hide: translationKey("Hide"),
  showTitle: translationKey("Show the full URL"),
  hideTitle: translationKey("Hide the secret key"),
  maskedForScreenReaders: translationKey("secret key hidden"),
  tryIt: translationKey("Try it"),
  copyExample: translationKey("Copy"),
  copyExampleTitle: translationKey("Copy the example request"),
  inputsTitle: translationKey("Values you send"),
  inputsSentence: translationKey(
    "The JSON body's top-level values reach the steps as data, never as script text: a Bash step reads {{bash}}, a JavaScript step reads {{javascript}}.",
  ),
  keepPrivate: translationKey(
    "Anyone with this URL can start the runbook, so keep it private.",
  ),
  keepPrivateCanReset: translationKey(
    "Anyone with this URL can start the runbook, so keep it private. If it leaks, reset it.",
  ),
  resetUrl: translationKey("Reset URL"),
  resetConfirmTitle: translationKey("Reset the webhook URL?"),
  resetConfirmDescription: translationKey(
    "The runbook gets a new URL, and the current one stops working at once. Anything that still calls it will fail until you give it the new URL.",
  ),
  resetDone: translationKey(
    "URL reset. The old one no longer works, so copy this one into anything that should start the runbook.",
  ),
  urlHidden: translationKey(
    "The webhook URL holds this runbook's secret key, so only people who may edit and run this runbook can see it. Ask one of them for it.",
  ),
  urlLoading: translationKey("Loading the URL…"),
  urlLoadFailed: translationKey("The URL could not be loaded."),
  runbookOffWebhook: translationKey(
    "This runbook is turned off, so calls to this URL are refused. Turn it on under {{settings}}.",
  ),
  noStepsWebhook: translationKey(
    "This runbook has no steps yet, so calls to this URL are refused. Add steps under {{steps}}.",
  ),
  learnMore: translationKey("How to call it"),
  testButton: translationKey("Send Test Request"),
  testTitle: translationKey("Send a test request"),
  testDescription: translationKey(
    "Sends a POST request with this body to the webhook URL, as another tool would. It starts a real run of the runbook.",
  ),
  testBodyTitle: translationKey("Request body (JSON)"),
  testSubmit: translationKey("Send Request"),
  testStarted: translationKey("The webhook started a run."),
  testViewRun: translationKey("View the run"),
  testBodyNotJson: translationKey(
    'Write the body as a JSON object, such as {"host": "web-1"}.',
  ),
  triggerLocked: translationKey(
    "Setting up a webhook takes permission to edit this runbook and to run it.",
  ),
};

// The cron expression the hint gives as an example: the same in every language.
export const CRON_HINT_EXAMPLE: string = "0 9 * * 1-5";

// The choices the schedule dialog's Repeat menu offers, in its order.
export const REPEAT_LABELS: Readonly<Record<RunbookScheduleRepeat, string>> = {
  [RunbookScheduleRepeat.Minutes]: translationKey("Every few minutes"),
  [RunbookScheduleRepeat.Hours]: translationKey("Every few hours"),
  [RunbookScheduleRepeat.Daily]: translationKey("Every day"),
  [RunbookScheduleRepeat.Weekly]: translationKey("On days of the week"),
  [RunbookScheduleRepeat.Cron]: translationKey("Custom (cron expression)"),
};

export const OVERLAP_LABELS: Readonly<
  Record<RunbookScheduleOverlapPolicy, string>
> = {
  [RunbookScheduleOverlapPolicy.Skip]: translationKey("Skip that time"),
  /*
   * "after", not "once": beside "Run once when OneUptime is back", "Run once
   * it ends" read as a run that happens one time.
   */
  [RunbookScheduleOverlapPolicy.RunAfter]: translationKey("Run after it ends"),
};

export const MISSED_RUN_LABELS: Readonly<
  Record<RunbookScheduleMissedRunPolicy, string>
> = {
  [RunbookScheduleMissedRunPolicy.RunOnce]: translationKey(
    "Run once when OneUptime is back",
  ),
  [RunbookScheduleMissedRunPolicy.Skip]: translationKey(
    "Skip the missed times",
  ),
};

/*
 * What the dialog's folded More options say while folded, one sentence for
 * each setting as it is set.
 */
export const OVERLAP_SUMMARIES: Readonly<
  Record<RunbookScheduleOverlapPolicy, string>
> = {
  [RunbookScheduleOverlapPolicy.Skip]: translationKey(
    "A time that comes while a run is still going is skipped.",
  ),
  [RunbookScheduleOverlapPolicy.RunAfter]: translationKey(
    "A time that comes while a run is still going runs after that run ends.",
  ),
};

export const MISSED_RUN_SUMMARIES: Readonly<
  Record<RunbookScheduleMissedRunPolicy, string>
> = {
  [RunbookScheduleMissedRunPolicy.RunOnce]: translationKey(
    "Times OneUptime missed run once when it is back.",
  ),
  [RunbookScheduleMissedRunPolicy.Skip]: translationKey(
    "Times OneUptime missed are skipped.",
  ),
};

// The days, as the dialog's day buttons and the schedule's sentence name them.
export const DAY_NAMES: ReadonlyArray<string> = [
  translationKey("Sunday"),
  translationKey("Monday"),
  translationKey("Tuesday"),
  translationKey("Wednesday"),
  translationKey("Thursday"),
  translationKey("Friday"),
  translationKey("Saturday"),
];

export const DAY_SHORT_NAMES: ReadonlyArray<string> = [
  translationKey("Sun"),
  translationKey("Mon"),
  translationKey("Tue"),
  translationKey("Wed"),
  translationKey("Thu"),
  translationKey("Fri"),
  translationKey("Sat"),
];

// The schedule, in a sentence of its own for each kind.
export const SCHEDULE_SENTENCES: {
  readonly everyMinutes: PluralTemplate;
  readonly everyHoursOnTheHour: PluralTemplate;
  readonly everyHoursAtMinute: PluralTemplate;
  readonly everyDay: string;
  readonly everyWeekday: string;
  readonly everyDays: string;
  readonly cron: string;
} = {
  everyMinutes: {
    one: "Runs every minute",
    other: "Runs every {{count}} minutes",
  },
  everyHoursOnTheHour: {
    one: "Runs every hour, on the hour",
    other: "Runs every {{count}} hours, on the hour",
  },
  everyHoursAtMinute: {
    one: "Runs every hour at :{{minute}}",
    other: "Runs every {{count}} hours at :{{minute}}",
  },
  everyDay: translationKey("Runs every day at {{time}}"),
  everyWeekday: translationKey("Runs every weekday at {{time}}"),
  everyDays: translationKey("Runs every {{days}} at {{time}}"),
  cron: translationKey("Runs on the cron schedule {{cron}}"),
};

/*
 * A fixed English string in the reader's language, as a string: the
 * translator gives undefined only for undefined, and these never are.
 */
export function translateCopy(translator: Translator, text: string): string {
  return translator.translateText(text) || text;
}

/*
 * What is wrong with a schedule, in the reader's language: the sentence the
 * server refuses a save with (Types/Runbook/RunbookSchedule), one template
 * for each kind of problem, filled with the problem's values. The cron
 * parser's own reason stays as it wrote it.
 */
export const SCHEDULE_PROBLEM_TEMPLATES: Readonly<
  Record<RunbookScheduleProblemCode, string>
> = {
  [RunbookScheduleProblemCode.CronMissing]: translationKey(
    'Enter a cron expression, such as "0 9 * * 1-5" (09:00 on weekdays).',
  ),
  [RunbookScheduleProblemCode.CronTooLong]: translationKey(
    "A cron expression is at most {{maxLength}} characters long.",
  ),
  [RunbookScheduleProblemCode.CronFieldCount]: translationKey(
    "A runbook schedule has five fields - minute, hour, day of month, month and day of week - and this one has {{count}}. Runbooks run at most once a minute, so there is no seconds field.",
  ),
  [RunbookScheduleProblemCode.CronInvalid]: translationKey(
    "This cron expression cannot be read. {{reason}}",
  ),
  [RunbookScheduleProblemCode.CronNeverRuns]: translationKey(
    "This schedule never runs: no date matches it, such as the 31st of February.",
  ),
  [RunbookScheduleProblemCode.MinuteInterval]: translationKey(
    "Pick how many minutes apart the runs are: {{choices}}.",
  ),
  [RunbookScheduleProblemCode.HourInterval]: translationKey(
    "Pick how many hours apart the runs are: {{choices}}.",
  ),
  [RunbookScheduleProblemCode.MinutePastHour]: translationKey(
    "Pick the minute past the hour, from 0 to 59.",
  ),
  [RunbookScheduleProblemCode.TimeOfDay]: translationKey(
    "Pick the time of day the runbook runs at.",
  ),
  [RunbookScheduleProblemCode.NoDays]: translationKey("Pick at least one day."),
  [RunbookScheduleProblemCode.NoRepeat]: translationKey(
    "Pick how often the runbook runs.",
  ),
};

export function getScheduleProblemText(
  translator: Translator,
  problem: RunbookScheduleProblem,
): string {
  const template: string | undefined = SCHEDULE_PROBLEM_TEMPLATES[problem.code];

  return template
    ? translator.translateTemplate(template, problem.values)
    : problem.message;
}

// How many runs ahead the card and the dialog show.
export const NEXT_RUNS_SHOWN: number = 3;

/*
 * Where the cards' docs links open: headings of the docs page on triggers.
 * Written whole, so App's DocsLinksResolve holds each to a heading that page
 * has.
 */
export const RunbookTriggersDocs: {
  readonly schedule: string;
  readonly webhook: string;
} = {
  schedule: "/docs/runbooks/triggers#run-on-a-schedule",
  webhook: "/docs/runbooks/triggers#call-the-webhook",
};

// The test ids the page's tests and the E2E specs find things by.
export const RunbookTriggersTestIds: {
  readonly scheduleCard: string;
  readonly scheduleEmpty: string;
  readonly scheduleSwitch: string;
  readonly scheduleDetails: string;
  readonly nextRuns: string;
  readonly scheduleField: string;
  readonly schedulePreview: string;
  readonly webhookCard: string;
  readonly webhookSwitch: string;
  readonly webhookUrl: string;
  readonly webhookCurl: string;
  readonly webhookVisibility: string;
  readonly webhookReset: string;
  readonly webhookResetDone: string;
  readonly webhookHidden: string;
  readonly webhookTest: string;
  readonly webhookTestResult: string;
  readonly note: string;
} = {
  scheduleCard: "runbook-schedule-card",
  scheduleEmpty: "runbook-schedule-empty",
  scheduleSwitch: "runbook-schedule-switch",
  scheduleDetails: "runbook-schedule-details",
  nextRuns: "runbook-schedule-next-runs",
  scheduleField: "runbook-schedule-field",
  schedulePreview: "runbook-schedule-preview",
  webhookCard: "runbook-webhook-card",
  webhookSwitch: "runbook-webhook-switch",
  webhookUrl: "runbook-webhook-url",
  webhookCurl: "runbook-webhook-curl",
  webhookVisibility: "runbook-webhook-url-visibility",
  webhookReset: "runbook-webhook-reset-url",
  webhookResetDone: "runbook-webhook-url-reset-done",
  webhookHidden: "runbook-webhook-url-hidden",
  webhookTest: "runbook-webhook-test",
  webhookTestResult: "runbook-webhook-test-result",
  note: "runbook-trigger-note",
};

const pad: (value: number) => string = (value: number): string => {
  return value < 10 ? `0${value}` : `${value}`;
};

/*
 * A wall-clock time the way the reader reads times: 09:00, or 9:00 AM for
 * someone who prefers a 12-hour clock.
 */
export function formatScheduleTime(
  hour: number,
  minute: number,
  use12HourFormat: boolean = OneUptimeDate.getUserPrefers12HourFormat(),
): string {
  if (!use12HourFormat) {
    return `${pad(hour)}:${pad(minute)}`;
  }

  const suffix: string = hour < 12 ? "AM" : "PM";
  const twelve: number = hour % 12 === 0 ? 12 : hour % 12;

  return `${twelve}:${pad(minute)} ${suffix}`;
}

function sameDays(
  days: ReadonlyArray<number>,
  expected: ReadonlyArray<number>,
): boolean {
  const sorted: Array<number> = [...new Set(days)].sort();

  return (
    sorted.length === expected.length &&
    [...expected].sort().every((day: number, index: number) => {
      return sorted[index] === day;
    })
  );
}

/*
 * The schedule in a sentence: "Runs every weekday at 09:00", "Runs every
 * 15 minutes", "Runs on the cron schedule 0 9 1 * *". Day names, the list
 * of days and the sentence are all in the reader's language.
 */
export function getScheduleSentence(
  translator: Translator,
  choice: RunbookScheduleChoice,
  use12HourFormat?: boolean,
): string {
  const time: string = formatScheduleTime(
    choice.hour,
    choice.minute,
    use12HourFormat,
  );

  switch (choice.repeat) {
    case RunbookScheduleRepeat.Minutes:
      return translator.translatePlural(
        SCHEDULE_SENTENCES.everyMinutes,
        choice.every,
      );
    case RunbookScheduleRepeat.Hours:
      if (choice.minute === 0) {
        return translator.translatePlural(
          SCHEDULE_SENTENCES.everyHoursOnTheHour,
          choice.every,
        );
      }

      return translator.translatePlural(
        SCHEDULE_SENTENCES.everyHoursAtMinute,
        choice.every,
        { minute: pad(choice.minute) },
      );
    case RunbookScheduleRepeat.Daily:
      return translator.translateTemplate(SCHEDULE_SENTENCES.everyDay, {
        time,
      });
    case RunbookScheduleRepeat.Weekly: {
      if (sameDays(choice.days, [0, 1, 2, 3, 4, 5, 6])) {
        return translator.translateTemplate(SCHEDULE_SENTENCES.everyDay, {
          time,
        });
      }

      if (sameDays(choice.days, RUNBOOK_SCHEDULE_WEEKDAYS)) {
        return translator.translateTemplate(SCHEDULE_SENTENCES.everyWeekday, {
          time,
        });
      }

      const ordered: Array<number> = RUNBOOK_SCHEDULE_DAY_ORDER.filter(
        (day: number) => {
          return choice.days.includes(day);
        },
      );

      return translator.translateTemplate(SCHEDULE_SENTENCES.everyDays, {
        days: composedValue((sentence: Translator): string => {
          return formatNameList(
            ordered.map((day: number) => {
              return translateCopy(sentence, DAY_NAMES[day]!);
            }),
            "and",
            sentence,
          );
        }),
        time,
      });
    }
    case RunbookScheduleRepeat.Cron:
    default:
      return translator.translateTemplate(SCHEDULE_SENTENCES.cron, {
        cron: choice.cron,
      });
  }
}

// How the "every N" choices are labelled.
export const EVERY_MINUTES_LABEL: PluralTemplate = {
  one: "{{count}} minute",
  other: "{{count}} minutes",
};

export const EVERY_HOURS_LABEL: PluralTemplate = {
  one: "{{count}} hour",
  other: "{{count}} hours",
};

// The "every N" choices, labelled in the reader's language.
export function getEveryOptions(
  translator: Translator,
  repeat: RunbookScheduleRepeat,
): Array<{ value: number; label: string }> {
  const values: ReadonlyArray<number> =
    repeat === RunbookScheduleRepeat.Hours
      ? RUNBOOK_SCHEDULE_HOUR_INTERVALS
      : RUNBOOK_SCHEDULE_MINUTE_INTERVALS;

  return values.map((value: number) => {
    return {
      value,
      label: translator.translatePlural(
        repeat === RunbookScheduleRepeat.Hours
          ? EVERY_HOURS_LABEL
          : EVERY_MINUTES_LABEL,
        value,
      ),
    };
  });
}

/*
 * The minutes past the hour "every few hours" offers: every five, and the
 * one a schedule already has when it is not one of them.
 */
export function getMinuteOptions(current: number): Array<number> {
  const minutes: Array<number> = [];

  for (let minute: number = 0; minute < 60; minute += 5) {
    minutes.push(minute);
  }

  if (!minutes.includes(current) && current >= 0 && current <= 59) {
    minutes.push(current);
    minutes.sort((a: number, b: number) => {
      return a - b;
    });
  }

  return minutes;
}

/*
 * What started a run, by name: the Executions lists' "Triggered by" filter,
 * and the label over a scheduled or webhook run's details.
 */
export const TRIGGER_NAMES: Readonly<Record<RunbookTriggerType, string>> = {
  [RunbookTriggerType.Manual]: translationKey("A person"),
  [RunbookTriggerType.Rule]: translationKey("Runbook rule"),
  [RunbookTriggerType.AutoRemediation]: translationKey("Auto-remediation"),
  [RunbookTriggerType.AI]: translationKey("OneUptime AI"),
  [RunbookTriggerType.Schedule]: translationKey("Schedule"),
  [RunbookTriggerType.Webhook]: translationKey("Webhook"),
};

export const TriggerDetailCopy: {
  readonly scheduledFor: string;
  readonly catchUp: string;
  readonly waited: string;
  readonly fromAddress: string;
  readonly inputsCardTitle: string;
  readonly inputsCardDescription: string;
  readonly copyInputsTitle: string;
} = {
  scheduledFor: translationKey("Due at {{time}}"),
  catchUp: translationKey("Catch-up for times OneUptime missed"),
  waited: translationKey("Waited for the previous run to end"),
  fromAddress: translationKey("From {{address}}"),
  inputsCardTitle: translationKey("Inputs"),
  // {{bash}} and {{javascript}} are drawn as code.
  inputsCardDescription: translationKey(
    "The values the webhook call sent. The steps read them as data: a Bash step as environment variables such as {{bash}}, a JavaScript step as {{javascript}}.",
  ),
  copyInputsTitle: translationKey("Copy the inputs"),
};

/*
 * When a run is, for the schedule's Next runs and its last run: on the
 * given zone's clock, in the reader's language, with the zone's name -
 * "Fri, Oct 16, 09:00 BST", "Fr., 16. Okt., 09:00 BST" - and the year only
 * when it is not this one. Gregorian calendar in every language, and the
 * language's own digits, as the feeds write times (FeedTime.getFeedLocale).
 * With how far
 * off it is, in the reader's language too: "in 23 hours", "vor 2 Tagen".
 */
export interface RunTimeText {
  when: string;
  relative: string;
}

/*
 * The parts of Intl.RelativeTimeFormat used here, typed structurally:
 * Common's test programs compile against the ES2017 library, which does not
 * declare it (FeedTime does the same).
 */
type RelativeUnit = "second" | "minute" | "hour" | "day" | "month" | "year";

type RelativeTimeFormatConstructor = new (
  locale: string,
  options: { numeric: "auto" | "always" },
) => { format: (value: number, unit: RelativeUnit) => string };

const MINUTE_IN_MS: number = 60 * 1000;
const HOUR_IN_MS: number = 60 * MINUTE_IN_MS;
const DAY_IN_MS: number = 24 * HOUR_IN_MS;

// Calendar days from one instant's day to another's, on a zone's clock.
const getCalendarDaysBetween: (data: {
  from: Date;
  to: Date;
  timezone: string;
}) => number = (data: { from: Date; to: Date; timezone: string }): number => {
  const dayNumber: (date: Date) => number = (date: Date): number => {
    const [year, month, day]: Array<number> = getFeedDayKey(date, data.timezone)
      .split("-")
      .map(Number) as Array<number>;

    return Date.UTC(year!, month! - 1, day!) / DAY_IN_MS;
  };

  return Math.round(dayNumber(data.to) - dayNumber(data.from));
};

/*
 * "in 25 minutes", "in 5 hours", "in 4 days", "2 hours ago", and "now"
 * under a minute. A day away or more is counted in calendar days on the
 * zone's clock, as people count them: on a Thursday, Monday's run is "in 4
 * days" whatever the hour. Counted ("in 1 day"), never "tomorrow".
 */
export function formatRunRelativeTime(data: {
  date: Date;
  now: Date;
  language: string;
  timezone: string;
}): string {
  const difference: number = data.date.getTime() - data.now.getTime();
  const magnitude: number = Math.abs(difference);
  const sign: number = difference < 0 ? -1 : 1;

  let value: number = 0;
  let unit: RelativeUnit = "second";

  if (magnitude >= DAY_IN_MS) {
    let days: number = sign;

    try {
      days = getCalendarDaysBetween({
        from: data.now,
        to: data.date,
        timezone: data.timezone,
      });
    } catch {
      days = sign * Math.round(magnitude / DAY_IN_MS);
    }

    value = Math.max(1, Math.abs(days));
    unit = "day";
  } else if (magnitude >= HOUR_IN_MS) {
    // Never "in 24 hours": from a day on, it says days.
    value = Math.min(23, Math.round(magnitude / HOUR_IN_MS));
    unit = "hour";
  } else if (magnitude >= MINUTE_IN_MS) {
    // Never "in 60 minutes": from an hour on, it says hours.
    value = Math.min(59, Math.round(magnitude / MINUTE_IN_MS));
    unit = "minute";
  }

  const RelativeTimeFormat: RelativeTimeFormatConstructor | undefined = (
    Intl as unknown as {
      RelativeTimeFormat?: RelativeTimeFormatConstructor | undefined;
    }
  ).RelativeTimeFormat;

  try {
    if (RelativeTimeFormat) {
      return new RelativeTimeFormat(getFeedLocale(data.language), {
        numeric: value === 0 ? "auto" : "always",
      }).format(sign * value, unit);
    }
  } catch {
    // An unknown language: English, below.
  }

  if (value === 0) {
    return "now";
  }

  const units: string = value === 1 ? unit : `${unit}s`;

  return sign < 0 ? `${value} ${units} ago` : `in ${value} ${units}`;
}

export function formatRunTime(data: {
  date: Date;
  timezone: string;
  language: string;
  now: Date;
  use12HourClock?: boolean | undefined;
}): RunTimeText {
  const use12HourClock: boolean =
    data.use12HourClock ?? OneUptimeDate.getUserPrefers12HourFormat();

  const yearIn: (date: Date) => string = (date: Date): string => {
    try {
      return new Intl.DateTimeFormat("en", {
        year: "numeric",
        timeZone: data.timezone,
      }).format(date);
    } catch {
      return String(date.getUTCFullYear());
    }
  };

  let when: string;

  try {
    when = new Intl.DateTimeFormat(getFeedLocale(data.language), {
      weekday: "short",
      month: "short",
      day: "numeric",
      ...(yearIn(data.date) !== yearIn(data.now) ? { year: "numeric" } : {}),
      hour: use12HourClock ? "numeric" : "2-digit",
      minute: "2-digit",
      hour12: use12HourClock,
      timeZone: data.timezone,
    }).format(data.date);

    const zone: string = getFeedZoneName(data.date, data.timezone);

    if (zone) {
      when = `${when} ${zone}`;
    }
  } catch {
    // A zone Intl does not know: the product's own English format.
    when = OneUptimeDate.getDateAsFormattedStringInTimezone({
      date: data.date,
      timezone: data.timezone,
      showWeekday: true,
    });
  }

  return {
    when,
    relative: formatRunRelativeTime({
      date: data.date,
      now: data.now,
      language: data.language,
      timezone: data.timezone,
    }),
  };
}
