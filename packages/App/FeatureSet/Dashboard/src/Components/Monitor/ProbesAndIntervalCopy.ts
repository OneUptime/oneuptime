import {
  PluralTemplate,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * A monitor's Probes & Interval page, in one place.
 *
 * Create Monitor asks for a monitor's probes and its interval on one step,
 * "Probes & Interval". The monitor's own menu then split them into two pages,
 * Interval (one card with an Edit button whose dialog held one dropdown) and
 * Probes (the table), and kept how many of those probes must agree before
 * the status changes on a third, Settings, in a "Probe Agreement Settings"
 * card, two clicks from the probes it counts. The interval page also offered
 * every interval to every type, while Create offers Synthetic, Custom Code
 * and SSL monitors nothing faster than every 5 minutes.
 *
 * Now one page, Probes & Interval (MONITOR_VIEW_PROBES), has three cards:
 * - Monitoring Interval: a dropdown that saves when a new interval is picked,
 *   offered the list Create offers the type (getMonitoringIntervalOptions);
 * - Probes: the table, as before;
 * - Probe Agreement: one sentence with the number typed into it, "Change this
 *   monitor's status when [ ] probes agree", saved when the box is left. An
 *   empty box is all of them, as an empty column always was.
 * The old interval URL forwards here (MonitorsRoutes), and Settings no
 * longer has the agreement card.
 *
 * Kept free of React so the cards, the page and App/Tests read these exact
 * strings. Every sentence is wrapped in translationKey() so npm run
 * i18n:extract finds it.
 */

export const ProbesAndIntervalCopy: {
  // The page's name: its side menu entry and its breadcrumb.
  pageTitle: string;
  intervalCardTitle: string;
  intervalCardDescription: string;
  // The dropdown's own name, for screen readers.
  intervalLabel: string;
  // Shown only for a monitor that has no interval at all.
  intervalPlaceholder: string;
  agreementCardTitle: string;
  agreementCardDescription: string;
  // The number box's own name, for screen readers.
  agreementBoxLabel: string;
  // In the empty box.
  agreementBoxPlaceholder: string;
  // Under the sentence, whatever the box holds.
  agreementNote: string;
  // Under the box, for something that is not a number of probes.
  agreementInvalid: string;
  // The page of a monitor that probes do not check (reached by its URL).
  manualMonitorTitle: string;
  manualMonitorDescription: string;
  notCheckedByProbesTitle: string;
  notCheckedByProbesDescription: string;
  saving: string;
  saved: string;
} = {
  pageTitle: translationKey("Probes & Interval"),
  intervalCardTitle: translationKey("Monitoring Interval"),
  intervalCardDescription: translationKey(
    "How often each probe checks this monitor.",
  ),
  intervalLabel: translationKey("Monitoring Interval"),
  intervalPlaceholder: translationKey("Select Monitoring Interval"),
  agreementCardTitle: translationKey("Probe Agreement"),
  agreementCardDescription: translationKey(
    "A status change waits until enough probes see the same result, so one probe with network trouble cannot change it on its own.",
  ),
  agreementBoxLabel: translationKey("Probes that must agree"),
  agreementBoxPlaceholder: translationKey("all"),
  agreementNote: translationKey(
    "Leave it empty for all probes. Only probes that are on and connected take part.",
  ),
  agreementInvalid: translationKey(
    "Type a whole number of probes, or leave it empty for all probes.",
  ),
  manualMonitorTitle: translationKey("Manual monitors are not checked"),
  manualMonitorDescription: translationKey(
    "Nothing checks a manual monitor, so it has no probes or interval. You set its status yourself.",
  ),
  notCheckedByProbesTitle: translationKey(
    "This monitor is not checked by probes",
  ),
  notCheckedByProbesDescription: translationKey(
    "OneUptime evaluates this monitor from the data it receives, so it has no probes or interval to set.",
  ),
  saving: translationKey("Saving…"),
  saved: translationKey("Saved"),
};

/*
 * The agreement sentence, with the number box in {{count}}. With the box
 * empty it reads "when [all] probes agree": the plural form for any count
 * but one, which PROBE_AGREEMENT_SENTENCE_COUNT_FOR_ALL picks.
 */
export const PROBE_AGREEMENT_SENTENCE: PluralTemplate = {
  one: "Change this monitor's status when {{count}} probe agrees",
  other: "Change this monitor's status when {{count}} probes agree",
};

/*
 * The count the sentence is read with while the box is empty ("all"). Two
 * takes the general form in every Dashboard language: English, French and
 * Hindi call it "other", and Russian's "few" has no form of its own here, so
 * the general one is used (see the Locales README on plurals).
 */
export const PROBE_AGREEMENT_SENTENCE_COUNT_FOR_ALL: number = 2;

/*
 * The most a monitor can be asked to wait for: the server reads at most this
 * many probes of a monitor when it counts how many agree
 * (MonitorResourceUtil.checkProbeAgreement, LIMIT_PER_PROJECT). Any number
 * above how many probes take part already means all of them.
 */
export const MAX_PROBE_AGREEMENT: number = 10000;

const WHOLE_NUMBER: RegExp = /^\d+$/;

export type ProbeAgreementParseResult =
  | {
      isValid: true;
      // Null is all probes: what the column holds when it is empty.
      value: number | null;
    }
  | {
      isValid: false;
      // English; shown translated.
      error: string;
    };

/*
 * What the agreement box holds, as the column stores it: nothing (or only
 * spaces) is all probes, a whole number from 1 up is that many. Anything
 * else is not sent: zero would let a status change with no probe agreeing,
 * and a fraction or a word is not a number of probes.
 */
export const parseProbeAgreement: (
  text: string | null | undefined,
) => ProbeAgreementParseResult = (
  text: string | null | undefined,
): ProbeAgreementParseResult => {
  const trimmed: string = (text || "").trim();

  if (!trimmed) {
    return { isValid: true, value: null };
  }

  if (!WHOLE_NUMBER.test(trimmed)) {
    return { isValid: false, error: ProbesAndIntervalCopy.agreementInvalid };
  }

  const value: number = Number(trimmed);

  if (
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > MAX_PROBE_AGREEMENT
  ) {
    return { isValid: false, error: ProbesAndIntervalCopy.agreementInvalid };
  }

  return { isValid: true, value: value };
};

/*
 * The number the sentence's words agree with: "1 probe agrees", "3 probes
 * agree", and the general form while the box says "all".
 */
export const getProbeAgreementSentenceCount: (
  value: number | null,
) => number = (value: number | null): number => {
  return value === null ? PROBE_AGREEMENT_SENTENCE_COUNT_FOR_ALL : value;
};

/*
 * What the box shows for a stored value: the number, or nothing for all
 * probes. A value the dashboard would not have written (zero or less, from
 * the API) is shown as it is, so the page never hides what the monitor has.
 */
export const getProbeAgreementText: (
  value: number | null | undefined,
) => string = (value: number | null | undefined): string => {
  return typeof value === "number" && Number.isFinite(value)
    ? String(value)
    : "";
};

// The data-testid of the Monitoring Interval dropdown.
export const MONITORING_INTERVAL_TEST_ID: string =
  "monitor-monitoring-interval";

// The data-testid of the probe agreement number box.
export const PROBE_AGREEMENT_TEST_ID: string = "monitor-probe-agreement";

// The data-testid of the page's empty state for a monitor probes do not check.
export const NOT_CHECKED_BY_PROBES_TEST_ID: string =
  "monitor-not-checked-by-probes";

export default ProbesAndIntervalCopy;
