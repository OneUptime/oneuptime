// UX rule: Docs/ux/README.md#numbers-dates-and-plurals
import { describe, expect, test } from "@jest/globals";
import AIAgentRunLimitsHelper, {
  DEFAULT_AI_RUN_TIME_LIMIT_IN_MINUTES,
} from "../../Types/AI/AIAgentRunLimits";
import {
  NO_BREAK_SPACE,
  withDurationWordsHeld,
} from "../../Types/NoBreakSpaces";
import { DISCOVERY_IMPORT_POLLING_INTERVAL_REFUSAL } from "../../Types/NetworkDevice/DiscoveryImport";
import { getCallAnsweredAndLastedMessage } from "../../Types/OnCallDutyPolicy/OnCallSentLine";
import { ON_CALL_TEST_PAGE_ENDED_UNANSWERED_MESSAGE } from "../../Types/OnCallDutyPolicy/OnCallTestPage";
import { PacketCaptureLimitsUtil } from "../../Types/PacketCapture/PacketCaptureLimits";
import {
  AGENT_CLAIM_TIMEOUT_BOUNDS,
  getTimeoutValidationError,
} from "../../Types/Runbook/RunbookStepTimeout";
import {
  describeRowsKeptOnDelete,
  getRowsKeptOnDelete,
  KEPT_STATUS_HISTORY_DAYS,
  RowsKeptOnDelete,
} from "../../Types/StateTimeline/RowsKeptOnDelete";
import { Translator } from "../../Types/Translator";
import CertificateReissueUtil from "../../Utils/CertificateReissue";
import { describeCronSchedule } from "../../Utils/CronScheduleText";
import CronTab from "../../Utils/CronTab";
import {
  getSloAllowedDowntime,
  SloAllowedDowntime,
} from "../../Utils/Slo/SloProjection";
import {
  dashboardTranslator,
  readDashboardLocale,
} from "../Helpers/DashboardLocales";
import { getPollingIntervalLabel } from "../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/DiscoveryImport/PollingIntervalLabels";
import { validateCustomLeadMinutes } from "../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/CalendarFeed/CalendarFeedUtil";
import { validateRescanInterval } from "../../../App/FeatureSet/Dashboard/src/Pages/NetworkDevice/DiscoveryScanFormValidation";

/*
 * A DURATION'S NUMBER STAYS ON THE LINE OF ITS WORD, IN A SENTENCE (#8695).
 *
 * #8669 held the English durations OneUptime writes on their own ("5 hours
 * ago"). A sentence built in code still parted them: "Rescan Interval must
 * be at least 15 minutes.", "Every 6 hours", a guide's "the last 10
 * minutes" - a narrow form could end a line with "15" and start the next
 * with "minutes.". A page's sentence joins its figure to a duration's word
 * with a no-break space now, a word chosen by its count too ("1 hour", "2
 * hours"). Text that is no page's - an API's refusal, a message stored with
 * its record - keeps its plain space, so what is stored and matched by its
 * English still matches.
 */

const NB: string = NO_BREAK_SPACE;

// The scan form's Rescan Interval, recurring, as the form hands it in.
const rescanInterval: (minutes: string) => string | null = (
  minutes: string,
): string | null => {
  return validateRescanInterval({
    isRecurring: true,
    rescanIntervalInMinutes: minutes,
  } as unknown as Parameters<typeof validateRescanInterval>[0]);
};

// Whether `text` has a plain space right after `figure`, before more words.
const breaksAfter: (text: string, figure: string) => boolean = (
  text: string,
  figure: string,
): boolean => {
  return new RegExp(`(?<![\\d.,])${figure} \\S`, "u").test(text);
};

describe("a cron schedule's words", () => {
  test("CronTab's English holds each figure to its word", () => {
    expect(CronTab.getHumanReadableDescription("*/5 * * * *")).toBe(
      `Every 5${NB}minutes`,
    );
    expect(CronTab.getHumanReadableDescription("0 */6 * * *")).toBe(
      `Every 6${NB}hours`,
    );
    expect(CronTab.getHumanReadableDescription("15 */6 * * *")).toBe(
      `Every 6${NB}hours at minute 15`,
    );
    expect(
      CronTab.getHumanReadableDescription("0 9 1 */3 *")?.startsWith(
        `Every 3${NB}months on the`,
      ),
    ).toBe(true);
    // Negative control: one of a unit says no number.
    expect(CronTab.getHumanReadableDescription("0 * * * *")).toBe(
      "Every hour, on the hour",
    );
  });

  test("in English, the schedule a translator words is CronTab's word for word", () => {
    for (const expression of [
      "*/5 * * * *",
      "0 */6 * * *",
      "15 */6 * * *",
      "0 9 1 */3 *",
      "30 9 * * 1,5",
    ]) {
      expect(describeCronSchedule(expression, dashboardTranslator("en"))).toBe(
        CronTab.getHumanReadableDescription(expression),
      );
    }

    expect(describeCronSchedule("*/5 * * * *")).toBe(`Every 5${NB}minutes`);
  });

  test("negative control: a language's own words are the Translator's, as it writes them", () => {
    const german: Translator = dashboardTranslator("de");

    expect(describeCronSchedule("*/5 * * * *", german)).toBe(
      german.translatePlural(
        { one: "Every {{count}} minute", other: "Every {{count}} minutes" },
        5,
      ),
    );
  });
});

describe("a page's sentence holds its figure to its duration's word", () => {
  test("a form's refusals", () => {
    expect(rescanInterval("5")).toBe(
      `Rescan Interval must be at least 15${NB}minutes.`,
    );
    expect(getTimeoutValidationError("0.5", AGENT_CLAIM_TIMEOUT_BOUNDS)).toBe(
      `Minimum is 1${NB}second.`,
    );
    expect(
      getTimeoutValidationError("999999", AGENT_CLAIM_TIMEOUT_BOUNDS),
    ).toBe(`Maximum is 3600${NB}seconds (60${NB}minutes).`);
    expect(getTimeoutValidationError("0", AGENT_CLAIM_TIMEOUT_BOUNDS)).toBe(
      `Timeout must be greater than 0${NB}seconds.`,
    );
    // Negative control: a refusal with no figure.
    expect(rescanInterval("abc")).toBe(
      "Rescan Interval must be a whole number of minutes.",
    );
  });

  test("a certificate's reissue cooldown, as the domain table draws it", () => {
    const requested: Date = new Date("2026-01-01T00:00:00.000Z");
    const message: string = CertificateReissueUtil.getCooldownMessage(
      requested,
      new Date("2026-01-01T01:30:00.000Z"),
    );

    expect(message).toContain(`in the last 24${NB}hours.`);
    expect(message).toContain(`once every 24${NB}hours.`);
    expect(message).toContain(`try again in 22${NB}hours 30${NB}minutes.`);
    expect(breaksAfter(message, "24")).toBe(false);
    // A word chosen by its count: one of it.
    expect(
      CertificateReissueUtil.getCooldownMessage(
        requested,
        new Date("2026-01-01T22:59:00.000Z"),
      ),
    ).toContain(`try again in 1${NB}hour 1${NB}minute.`);
  });

  test("an AI lane's time limit, a polling interval and an SLO's window", () => {
    expect(AIAgentRunLimitsHelper.describeTimeLimit(null)).toContain(
      `${DEFAULT_AI_RUN_TIME_LIMIT_IN_MINUTES}${NB}minutes unless`,
    );
    expect(AIAgentRunLimitsHelper.describeTimeLimit(30)).toBe(
      `Stops investigating after 30${NB}minutes and reports what it found.`,
    );
    expect(AIAgentRunLimitsHelper.describeTimeLimit(1)).toBe(
      `Stops investigating after 1${NB}minute and reports what it found.`,
    );
    expect(getPollingIntervalLabel(45)).toBe(`Every 45${NB}minutes`);
    // A choice is a translation key, looked up by its English.
    expect(getPollingIntervalLabel(5)).toBe("Every 5 minutes");

    const downtime: SloAllowedDowntime | null = getSloAllowedDowntime({
      targetPercentage: 99.9,
      windowDays: 30,
      now: new Date("2026-01-15T00:00:00.000Z"),
    });

    expect(downtime?.periodText).toBe(`per rolling 30${NB}days`);
  });

  test("a reminder's refusal keeps its key's English, and the card holds what it draws", () => {
    const error: string = validateCustomLeadMinutes("5").error as string;
    const key: string =
      "Reminders can be sent between 15 minutes and 14 days before a shift.";

    // Looked up whole: the key must still match the locale's.
    expect(error).toBe(key);
    expect(readDashboardLocale("en")[key]).toBe(key);
    expect(readDashboardLocale("de")[key]).toBeDefined();
    expect(withDurationWordsHeld(error)).toBe(
      `Reminders can be sent between 15${NB}minutes and 14${NB}days before a shift.`,
    );
  });
});

describe("negative control: text that is no page's keeps its plain space", () => {
  test("an API's refusal and the messages stored with a record", () => {
    expect(DISCOVERY_IMPORT_POLLING_INTERVAL_REFUSAL).toContain(" minutes.");
    expect(DISCOVERY_IMPORT_POLLING_INTERVAL_REFUSAL).not.toContain(NB);
    // What a delete keeps: the line a workflow run's log stores, word for word.
    const kept: RowsKeptOnDelete | null = getRowsKeptOnDelete(
      "MonitorStatusTimeline",
    );

    expect(kept).not.toBeNull();
    expect(describeRowsKeptOnDelete(kept!)).toContain(
      `the last ${KEPT_STATUS_HISTORY_DAYS} days`,
    );
    // The line the probe logs when captures are on, as the docs quote it.
    expect(PacketCaptureLimitsUtil.describeDuration(90)).toBe(
      "1 minute 30 seconds",
    );
    expect(getCallAnsweredAndLastedMessage(42)).toBe(
      "The call was answered and lasted 42 seconds.",
    );
    expect(ON_CALL_TEST_PAGE_ENDED_UNANSWERED_MESSAGE).not.toContain(NB);
    expect(ON_CALL_TEST_PAGE_ENDED_UNANSWERED_MESSAGE).toMatch(
      /within \d+ minutes\.$/,
    );
  });
});
