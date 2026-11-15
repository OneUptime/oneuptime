import { DEFAULT_MONITORING_INTERVAL } from "../../../Utils/Form/Monitor/MonitoringIntervalDefault";
import { GuidedSetupStepProgress } from "../GuidedSetupProgress";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import { MonitorStepProbeResponse } from "Common/Models/DatabaseModels/MonitorProbe";
import MonitorCriteriaInstance from "Common/Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import ObjectID from "Common/Types/ObjectID";
import {
  ACTIVE_MONITOR_PRICE_IN_USD_PER_MONTH,
  formatPriceInUSD,
} from "Common/Types/Billing/PayAsYouGoPricing";
import {
  CountedWhoIsToldFacts,
  GUIDED_SETUP_POLICY_NAME,
  WhoIsToldFacts,
  WhoIsToldMode,
  areWhoIsToldCountsKnown,
  getWhoIsToldMode,
} from "Common/Utils/GuidedSetup/OnCallPolicyRecords";
import {
  MONITOR_NAME_MAX_LENGTH,
  WebsiteAddress,
  WebsiteMonitorSeeds,
  buildWebsiteMonitor as buildGuidedWebsiteMonitor,
  getWebsiteAddressIdentity,
  isSameWebsiteAddress,
  parseWebsiteAddress,
} from "Common/Utils/GuidedSetup/WebsiteMonitorRecords";
import {
  OnCallTestPageResult,
  OnCallTestPageStatus,
} from "Common/Types/OnCallDutyPolicy/OnCallTestPage";
import ProbeMonitorResponse from "Common/Types/Probe/ProbeMonitorResponse";
import {
  composedValue,
  Translator,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import { getProbeFailureCauseText } from "Common/Utils/Monitor/ProbeFailureReading";
import {
  getProbeAgreementRequiredCount,
  getProbeAgreementSentence,
} from "Common/Utils/Monitor/ProbeAgreementRule";

/*
 * GUIDED SETUP: KNOW WHEN MY WEBSITE OR API IS DOWN (issue #6804).
 *
 * The most common reason to open OneUptime, from an address to a tested
 * notification on one page (Pages/Monitor/GuidedSetup.tsx):
 *
 *   1. What should we check? One field, the address. The name comes from
 *      the host and the type is Website - API when the person says it is
 *      an API endpoint - with Create Monitor's defaults: the probes a new
 *      monitor starts with, every five minutes, and the type's criteria
 *      (offline when it does not answer, or answers outside 200 to 399,
 *      which opens an incident once its probes agree). The monitor's probes
 *      check it at once, and their answers are said in a sentence, with
 *      what they mean under the probe agreement rule (#7410). An address
 *      one of this person's monitors already checks makes no second
 *      monitor: the setup goes on with theirs, and says so (#7059) -
 *      whatever the browser kept of the run. On Cloud's Free plan with no
 *      payment method, the step says so before Start checking, with where
 *      to add one: the server refuses the monitor without it (#7367).
 *   2. Who should be told? A project with no on-call policy gets one,
 *      paging the people picked - "You", to start with - for every new
 *      incident and alert (FirstResponders, EveryNewEventRules). A project
 *      that pages people already keeps its own policies and rules. Either
 *      way the person owns the monitor the setup goes on with, so they are
 *      emailed when its status changes: the creator of an operational
 *      resource is made its owner, and the setup makes them one when the
 *      server does not - a master admin, whom it never makes the owner of
 *      what they create (#7409). The step says so only when they are.
 *   3. Send a test: a test page to themselves (#6811), acknowledged from
 *      the message. Then the summary, read from the records.
 *
 * This file is the setup's rules and words, React-free so tests read
 * them; WebsiteDownApi.ts reads and writes the records.
 */

export const WEBSITE_DOWN_SETUP: string = "website_down";

// The docs' start-to-finish guide to this job (#6821), linked from the page.
export const WEBSITE_DOWN_SETUP_GUIDE_DOCS_PATH: string =
  "/docs/guides/website-down";

export enum WebsiteDownStep {
  Check = "check",
  WhoIsTold = "who_is_told",
  Test = "test",
}

export const WEBSITE_DOWN_STEPS: ReadonlyArray<WebsiteDownStep> = [
  WebsiteDownStep.Check,
  WebsiteDownStep.WhoIsTold,
  WebsiteDownStep.Test,
];

/*
 * The name of the policy the setup makes when the project has none: the
 * one Ask AI's set_up_paging makes too (Common/Utils/GuidedSetup).
 */
export const WEBSITE_DOWN_POLICY_NAME: string = GUIDED_SETUP_POLICY_NAME;

/*
 * The address, the monitor and who is told are built in Common, where Ask
 * AI's setup actions (#6829) build them too, so for the same answers both
 * make the same records.
 */
export {
  MONITOR_NAME_MAX_LENGTH,
  WhoIsToldMode,
  areWhoIsToldCountsKnown,
  getWebsiteAddressIdentity,
  getWhoIsToldMode,
  isSameWebsiteAddress,
  parseWebsiteAddress,
};
export type {
  CountedWhoIsToldFacts,
  WebsiteAddress,
  WebsiteMonitorSeeds,
  WhoIsToldFacts,
};

export const WEBSITE_DOWN_COPY: {
  pageTitle: string;
  pageDescription: string;
  checkTitle: string;
  checkHelp: string;
  addressLabel: string;
  addressPlaceholder: string;
  addressError: string;
  isApiLabel: string;
  startChecking: string;
  paymentNeeded: string;
  paymentNeededAskOwner: string;
  addPaymentMethod: string;
  checkPaymentAgain: string;
  existingMonitor: string;
  continueButton: string;
  cannotCreateMonitor: string;
  whoTitle: string;
  whoCreateHelp: string;
  whoCreatePolicyNote: string;
  whoPeopleLabel: string;
  whoAddPeople: string;
  whoNobodyPicked: string;
  whoSave: string;
  whoExistingHelp: string;
  whoExistingHelpNotOwner: string;
  policyMadeElsewhere: string;
  whoOwnerOnlyHelp: string;
  whoOwnerOnlyHelpNotOwner: string;
  whoOnCallRulesLink: string;
  noEmail: string;
  noEmailForAdmin: string;
  setUpEmail: string;
  testTitle: string;
  testHelp: string;
  testSkip: string;
  testSendAnother: string;
  testDidNotGetIt: string;
  testDidNotGetItHelp: string;
  testMethodsLink: string;
  summaryTitle: string;
  summaryChecked: string;
  summaryWhenDown: string;
  summaryWhoIsTold: string;
  summaryTested: string;
  summaryNotTested: string;
  summaryNext: string;
  nextStatusPage: string;
  nextPhone: string;
  nextMonitor: string;
  startOver: string;
  couldNotSave: string;
} = {
  pageTitle: translationKey("Know when my website or API is down"),
  pageDescription: translationKey(
    "Guided setup: check an address, choose who is told, and send a test, on this page.",
  ),
  checkTitle: translationKey("What should we check?"),
  /*
   * A new monitor's probes must all agree before its status changes (its
   * minimumProbeAgreement is not set: ProbeAgreementRule), so one location
   * that fails opens nothing. "Several locations" was not true of a
   * self-hosted server with one probe (#7410).
   */
  checkHelp: translationKey(
    "OneUptime checks it every 5 minutes. An incident opens when every location that checks it finds it down: no answer, or an answer with an error.",
  ),
  addressLabel: translationKey("Website or API address"),
  addressPlaceholder: "https://example.com",
  addressError: translationKey(
    "Enter a web address, such as https://example.com.",
  ),
  isApiLabel: translationKey("This is an API endpoint"),
  startChecking: translationKey("Start checking"),
  /*
   * Said before Start checking on Cloud's Free plan when the project has no
   * payment method: the server refuses every monitor but a Manual one
   * without it (PayAsYouGoBillingService.requirePayAsYouGo), and it said so
   * only once the button was pressed, in red, with no link (#7367).
   */
  paymentNeeded: translationKey(
    "This project is on the Free plan, where a monitor that checks your site is billed as you use it, at {{price}} per monitor per month. Add a payment method before you start checking.",
  ),
  // The same, for someone who may not add a payment method.
  paymentNeededAskOwner: translationKey(
    "This project is on the Free plan, where a monitor that checks your site is billed as you use it, at {{price}} per monitor per month. Ask a project owner to add a payment method before you start checking.",
  ),
  // The billing page's own button, which this link opens it at.
  addPaymentMethod: translationKey("Add Payment Method"),
  checkPaymentAgain: translationKey("Check again"),
  /*
   * Said when the address is one this person's monitor already checks: the
   * setup goes on with it, and makes no second (#7059).
   */
  existingMonitor: translationKey(
    'Your monitor "{{name}}" already checks this address, so no new monitor was made.',
  ),
  continueButton: translationKey("Continue"),
  cannotCreateMonitor: translationKey(
    "Creating a monitor needs permission you do not have in this project. Ask a project admin to give it to you, or to set this up.",
  ),
  whoTitle: translationKey("Who should be told?"),
  whoCreateHelp: translationKey(
    "When it goes down, OneUptime opens an incident and pages these people, each the way their How to Reach Me says. It starts with you, by email.",
  ),
  whoCreatePolicyNote: translationKey(
    'This makes the on-call policy "{{policy}}", which pages them for every new incident and alert in this project.',
  ),
  whoPeopleLabel: translationKey("Who is paged"),
  whoAddPeople: translationKey("Add teammates"),
  whoNobodyPicked: translationKey("Pick at least one person or team."),
  whoSave: translationKey("Save and continue"),
  whoExistingHelp: translationKey(
    "This project already pages people through its on-call policies and on-call rules, so they decide who is paged when this monitor opens an incident. You own this monitor, so you are also emailed when it goes down.",
  ),
  /*
   * The same for someone who does not own the monitor: one the setup could
   * not make them the owner of says nothing of an email (#7409).
   */
  whoExistingHelpNotOwner: translationKey(
    "This project already pages people through its on-call policies and on-call rules, so they decide who is paged when this monitor opens an incident.",
  ),
  /*
   * Said when Save and continue finds a policy another tab or device made
   * since the step opened: why the people picked are gone, and that nothing
   * was made twice (#7059).
   */
  policyMadeElsewhere: translationKey(
    "An on-call policy was added to this project while this page was open, so no new policy was made.",
  ),
  /*
   * Creating an on-call policy, its escalation rule and its two rules is not
   * an admin's alone: project members and on-call members may too. Who
   * cannot is pointed at the ones who always can, as the on-call setup's
   * whoCannotCreate does.
   */
  whoOwnerOnlyHelp: translationKey(
    "You own this monitor, so you are emailed when it goes down. Paging a team needs an on-call policy: ask a project owner or admin to set one up.",
  ),
  whoOwnerOnlyHelpNotOwner: translationKey(
    "You do not own this monitor, so you are not emailed when it goes down: add yourself on its Owners page. Paging a team needs an on-call policy: ask a project owner or admin to set one up.",
  ),
  whoOnCallRulesLink: translationKey("See the on-call rules"),
  noEmail: translationKey(
    "This server cannot send email yet, so nobody is emailed. A page can still reach you by SMS, a phone call or the mobile app once you add one to your notification methods. Ask your server's admin to set up email.",
  ),
  noEmailForAdmin: translationKey(
    "This server cannot send email yet, so nobody is emailed. A page can still reach you by SMS, a phone call or the mobile app once you add one to your notification methods, or set up email now.",
  ),
  setUpEmail: translationKey("Set up email"),
  testTitle: translationKey("Send a test"),
  testHelp: translationKey(
    "Send yourself a test page now. It goes out the way a real page would and every message says TEST. Acknowledge it from the message to finish.",
  ),
  testSkip: translationKey("Skip the test"),
  testSendAnother: translationKey("Send another test"),
  testDidNotGetIt: translationKey("I did not get it"),
  testDidNotGetItHelp: translationKey(
    "Each message above says whether it was sent, and why not. Check your spam folder, and that your email, phone number or the mobile app is added and verified in your notification methods.",
  ),
  testMethodsLink: translationKey("Open my notification methods"),
  summaryTitle: translationKey("{{name}} is set up"),
  summaryChecked: translationKey("Checked"),
  summaryWhenDown: translationKey("When it goes down"),
  summaryWhoIsTold: translationKey("Who is told"),
  summaryTested: translationKey("Tested"),
  summaryNotTested: translationKey(
    "Not tested yet. Send yourself a test page to be sure it reaches you.",
  ),
  summaryNext: translationKey("What next"),
  nextStatusPage: translationKey("Show it on a status page"),
  nextPhone: translationKey("Get paged by SMS or phone call"),
  nextMonitor: translationKey("Open the monitor"),
  startOver: translationKey("Check another address"),
  couldNotSave: translationKey(
    "That did not save. Check your connection and try again.",
  ),
};

/*
 * BEFORE START CHECKING ON CLOUD'S FREE PLAN (#7367): a project with no
 * payment method may not make a monitor that runs checks
 * (PayAsYouGoBillingService.requirePayAsYouGo), so the step says so, and
 * at what price, before the button is pressed. Who may add one is pointed
 * at the billing page; anyone else at who can.
 */
export const getPaymentNeededText: (data: {
  translator: Translator;
  mayAddPaymentMethod: boolean;
}) => string = (data: {
  translator: Translator;
  mayAddPaymentMethod: boolean;
}): string => {
  return data.translator.translateTemplate(
    data.mayAddPaymentMethod
      ? WEBSITE_DOWN_COPY.paymentNeeded
      : WEBSITE_DOWN_COPY.paymentNeededAskOwner,
    {
      price: formatPriceInUSD(ACTIVE_MONITOR_PRICE_IN_USD_PER_MONTH),
    },
  );
};

/*
 * The monitor Create Monitor would make for this address with every
 * default kept: the type's criteria, in the reader's language, and five
 * minutes (Common/Utils/GuidedSetup/WebsiteMonitorRecords). The probes are
 * left to the server, which adds the ones a new monitor starts with when
 * the create names none.
 */
export const buildWebsiteMonitor: (data: {
  address: WebsiteAddress;
  isApi: boolean;
  seeds: WebsiteMonitorSeeds;
  translator?: Translator | undefined;
}) => Monitor = (data: {
  address: WebsiteAddress;
  isApi: boolean;
  seeds: WebsiteMonitorSeeds;
  translator?: Translator | undefined;
}): Monitor => {
  return buildGuidedWebsiteMonitor({
    address: data.address,
    isApi: data.isApi,
    seeds: data.seeds,
    monitoringInterval: DEFAULT_MONITORING_INTERVAL,
    translator: data.translator,
  });
};

// The address a monitor checks, as its first step names it.
export const getMonitorAddress: (
  monitorSteps: MonitorSteps | undefined | null,
) => string = (monitorSteps: MonitorSteps | undefined | null): string => {
  const step: MonitorStep | undefined =
    monitorSteps?.data?.monitorStepsInstanceArray?.[0];
  const destination: unknown = step?.data?.monitorDestination;

  return destination ? destination.toString() : "";
};

// What the setup reads of a monitor this person made, to know if it is theirs for an address.
export interface OwnMonitorFacts {
  monitorSteps?: MonitorSteps | undefined | null;
  isArchived?: boolean | undefined;
  disableActiveMonitoring?: boolean | undefined;
}

/*
 * Whether a monitor this person made checks the address now, so the setup
 * goes on with it instead of making a second (#7059): its first step asks
 * for the same address, and it is neither archived nor turned off - one
 * that is no longer checked does not answer "is my website down?".
 */
export const isMonitorCheckingAddress: (data: {
  monitor: OwnMonitorFacts;
  address: WebsiteAddress;
}) => boolean = (data: {
  monitor: OwnMonitorFacts;
  address: WebsiteAddress;
}): boolean => {
  if (data.monitor.isArchived || data.monitor.disableActiveMonitoring) {
    return false;
  }

  return isSameWebsiteAddress(
    getMonitorAddress(data.monitor.monitorSteps),
    data.address.url,
  );
};

/*
 * The incident severity the monitor's criteria open an incident with when
 * it goes down: the first criteria that opens one.
 */
export const getIncidentSeverityId: (
  monitorSteps: MonitorSteps | undefined | null,
) => string | null = (
  monitorSteps: MonitorSteps | undefined | null,
): string | null => {
  const step: MonitorStep | undefined =
    monitorSteps?.data?.monitorStepsInstanceArray?.[0];
  const instances: Array<MonitorCriteriaInstance> =
    step?.data?.monitorCriteria?.data?.monitorCriteriaInstanceArray || [];

  for (const instance of instances) {
    if (instance.data?.isEnabled === false || !instance.data?.createIncidents) {
      continue;
    }

    const severityId: ObjectID | undefined =
      instance.data.incidents?.[0]?.incidentSeverityId;

    if (severityId) {
      return severityId.toString();
    }
  }

  return null;
};

/*
 * WHAT THE FIRST CHECK FOUND, from the monitor's probes (MonitorProbe's
 * lastMonitoringLog: each probe's latest answer, by the monitor's step).
 */
export interface FirstCheckAnswer {
  isOnline: boolean;
  responseCode?: number | undefined;
  responseTimeInMs?: number | undefined;
  failureCause?: string | undefined;
}

export const readFirstCheckAnswers: (
  logs: ReadonlyArray<MonitorStepProbeResponse | undefined | null>,
) => Array<FirstCheckAnswer> = (
  logs: ReadonlyArray<MonitorStepProbeResponse | undefined | null>,
): Array<FirstCheckAnswer> => {
  const answers: Array<FirstCheckAnswer> = [];

  for (const log of logs) {
    if (!log || typeof log !== "object") {
      continue;
    }

    const response: ProbeMonitorResponse | undefined = Object.values(log)[0];

    if (!response) {
      continue;
    }

    answers.push({
      isOnline: Boolean(response.isOnline),
      responseCode:
        typeof response.responseCode === "number"
          ? response.responseCode
          : undefined,
      responseTimeInMs:
        typeof response.responseTimeInMs === "number"
          ? response.responseTimeInMs
          : undefined,
      failureCause: response.failureCause || undefined,
    });
  }

  return answers;
};

// An answer the default criteria call down: none, or outside 200 to 399.
export const isDownAnswer: (answer: FirstCheckAnswer) => boolean = (
  answer: FirstCheckAnswer,
): boolean => {
  if (!answer.isOnline || typeof answer.responseCode !== "number") {
    return true;
  }

  return answer.responseCode < 200 || answer.responseCode > 399;
};

/*
 * WHAT THE ANSWERS MEAN, under the probe agreement rule (#7410). A
 * monitor's status changes only when its probes agree
 * (MonitorResourceUtil.checkProbeAgreement): the verdict most of its
 * enabled, connected probes reached wins, and only when at least the
 * required number reached it - all of them, unless the monitor sets a
 * minimum (ProbeAgreementRule). The server judges each time a probe
 * answers, from the answers in so far, so this reads the same answers the
 * same way. It said "an incident opens" whenever any one probe got an
 * error, though with three probes and one failing none does.
 */
export enum FirstCheckVerdict {
  // Nothing found down, or nothing answered yet.
  None = "none",
  // The locations that found it down carry the agreement: its status changes.
  Down = "down",
  // Some found it down, and the locations still to answer could carry it.
  Waiting = "waiting",
  /*
   * As many found it up as down, both enough to agree: which the server
   * takes is the order it reads its probes in, which no page can see.
   */
  Split = "split",
  // The locations that found it down cannot carry the agreement.
  StaysUp = "stays_up",
}

export interface FirstCheckCounts {
  // The enabled, connected probes: the locations whose answers count.
  activeLocationCount: number;
  answers: ReadonlyArray<FirstCheckAnswer>;
  // The monitor's own minimum; null or undefined is all of them.
  minimumProbeAgreement?: number | null | undefined;
}

export const getFirstCheckVerdict: (
  counts: FirstCheckCounts,
) => FirstCheckVerdict = (counts: FirstCheckCounts): FirstCheckVerdict => {
  const down: number = counts.answers.filter(isDownAnswer).length;
  const up: number = counts.answers.length - down;

  if (down === 0) {
    return FirstCheckVerdict.None;
  }

  // An answer always comes from a location that checks it.
  const active: number = Math.max(
    counts.activeLocationCount,
    counts.answers.length,
  );
  const required: number = getProbeAgreementRequiredCount({
    minimumProbeAgreement: counts.minimumProbeAgreement,
    activeProbeCount: active,
  });
  const pending: number = active - counts.answers.length;

  // The server takes the verdict with the most locations, when enough agree.
  if (down >= required && down > up) {
    return FirstCheckVerdict.Down;
  }

  // Could the locations still to answer make it down?
  if (pending > 0 && down + pending >= required && down + pending > up) {
    return FirstCheckVerdict.Waiting;
  }

  if (down === up && down >= required) {
    return FirstCheckVerdict.Split;
  }

  return FirstCheckVerdict.StaysUp;
};

// Every location that checks it has answered: nothing more to wait for.
export const isFirstCheckSettled: (data: {
  activeLocationCount: number;
  answers: ReadonlyArray<FirstCheckAnswer>;
}) => boolean = (data: {
  activeLocationCount: number;
  answers: ReadonlyArray<FirstCheckAnswer>;
}): boolean => {
  return (
    data.answers.length > 0 && data.answers.length >= data.activeLocationCount
  );
};

export interface FirstCheckSentence {
  // What the probes found: "example.com answered 200 in 312 ms from 2 locations."
  text: string;
  /*
   * What that means, a sentence of its own: "That counts as down, so an
   * incident opens." Null when nothing was found down. Kept apart from the
   * text, which can end with a probe's reason as it wrote it, full stop or
   * not.
   */
  verdict: string | null;
  // What the answers mean under the probe agreement rule.
  verdictKind: FirstCheckVerdict;
  // A location found it down.
  isDown: boolean;
  isWaiting: boolean;
}

/*
 * "example.com answered 200 in 312 ms from 2 locations." Read from the
 * probes' answers; until the first read returns, and while none has
 * answered, what is being waited for. A first read that has not returned
 * is not a monitor with no location: "No location checks..." flashed on
 * every new monitor while it was on its way (#7410).
 */
export const describeFirstCheck: (data: {
  translator: Translator;
  host: string;
  // False until the first read of the monitor's probes returns.
  isRead?: boolean | undefined;
  // The enabled probes: the locations the monitor is checked from.
  locationCount: number;
  // Of those, the connected ones (all of them when not given).
  activeLocationCount?: number | undefined;
  // What the connected ones answered.
  answers: ReadonlyArray<FirstCheckAnswer>;
  minimumProbeAgreement?: number | null | undefined;
  // Whether its criteria open an incident when it is down (they do by default).
  opensIncident?: boolean | undefined;
}) => FirstCheckSentence = (data: {
  translator: Translator;
  host: string;
  isRead?: boolean | undefined;
  locationCount: number;
  activeLocationCount?: number | undefined;
  answers: ReadonlyArray<FirstCheckAnswer>;
  minimumProbeAgreement?: number | null | undefined;
  opensIncident?: boolean | undefined;
}): FirstCheckSentence => {
  const translator: Translator = data.translator;

  if (data.isRead === false) {
    return {
      text: translator.translateTemplate("Checking {{host}}...", {
        host: data.host,
      }),
      verdict: null,
      verdictKind: FirstCheckVerdict.None,
      isDown: false,
      isWaiting: true,
    };
  }

  if (data.answers.length === 0) {
    if (data.locationCount === 0) {
      return {
        text: translator.translateTemplate(
          "No location checks {{host}} yet. Probes are added under Monitors > Settings > Probes.",
          { host: data.host },
        ),
        verdict: null,
        verdictKind: FirstCheckVerdict.None,
        isDown: false,
        isWaiting: false,
      };
    }

    return {
      text: translator.translatePlural(
        {
          one: "Checking {{host}} from {{count}} location...",
          other: "Checking {{host}} from {{count}} locations...",
        },
        data.locationCount,
        { host: data.host },
      ),
      verdict: null,
      verdictKind: FirstCheckVerdict.None,
      isDown: false,
      isWaiting: true,
    };
  }

  const down: Array<FirstCheckAnswer> = data.answers.filter(isDownAnswer);

  if (down.length === 0) {
    const times: Array<number> = data.answers
      .map((answer: FirstCheckAnswer): number | undefined => {
        return answer.responseTimeInMs;
      })
      .filter((time: number | undefined): time is number => {
        return typeof time === "number";
      });
    const averageMs: number = times.length
      ? Math.round(
          times.reduce((sum: number, time: number): number => {
            return sum + time;
          }, 0) / times.length,
        )
      : 0;

    return {
      text: translator.translatePlural(
        {
          one: "{{host}} answered {{code}} in {{ms}} ms from {{count}} location.",
          other:
            "{{host}} answered {{code}} in {{ms}} ms from {{count}} locations.",
        },
        data.answers.length,
        {
          host: data.host,
          code: String(data.answers[0]!.responseCode),
          ms: translator.formatNumber(averageMs),
        },
      ),
      verdict: null,
      verdictKind: FirstCheckVerdict.None,
      isDown: false,
      isWaiting: false,
    };
  }

  const activeLocationCount: number =
    data.activeLocationCount ?? data.locationCount;
  const verdict: FirstCheckVerdict = getFirstCheckVerdict({
    activeLocationCount: activeLocationCount,
    answers: data.answers,
    minimumProbeAgreement: data.minimumProbeAgreement,
  });
  const upCount: number = data.answers.length - down.length;
  const pendingCount: number = Math.max(
    activeLocationCount - data.answers.length,
    0,
  );

  let verdictText: string = "";

  if (verdict === FirstCheckVerdict.Down) {
    verdictText =
      data.opensIncident === false
        ? translator.translateText(
            "That counts as down, so its status changes to Offline.",
          ) || ""
        : translator.translateText(
            "That counts as down, so an incident opens.",
          ) || "";
  } else if (verdict === FirstCheckVerdict.Waiting) {
    verdictText = translator.translatePlural(
      {
        one: "Waiting for {{count}} more location...",
        other: "Waiting for {{count}} more locations...",
      },
      pendingCount,
    );
  } else if (verdict === FirstCheckVerdict.Split) {
    verdictText = translator.translatePlural(
      {
        one: "{{host}} was up from {{count}} location.",
        other: "{{host}} was up from {{count}} locations.",
      },
      upCount,
      { host: data.host },
    );
  } else {
    verdictText = translator.translatePlural(
      {
        one: "{{host}} was up from {{count}} location, so no incident opens.",
        other:
          "{{host}} was up from {{count}} locations, so no incident opens.",
      },
      upCount,
      { host: data.host },
    );
  }

  const first: FirstCheckAnswer = down[0]!;
  const isWaiting: boolean = verdict === FirstCheckVerdict.Waiting;

  if (first.isOnline && typeof first.responseCode === "number") {
    return {
      text: translator.translatePlural(
        {
          one: "{{host}} answered {{code}} from {{count}} location.",
          other: "{{host}} answered {{code}} from {{count}} locations.",
        },
        down.length,
        { host: data.host, code: String(first.responseCode) },
      ),
      verdict: verdictText,
      verdictKind: verdict,
      isDown: true,
      isWaiting: isWaiting,
    };
  }

  return {
    text: first.failureCause
      ? translator.translatePlural(
          {
            one: "{{host}} did not answer from {{count}} location: {{reason}}",
            other:
              "{{host}} did not answer from {{count}} locations: {{reason}}",
          },
          down.length,
          {
            host: data.host,
            /*
             * The probe's own timeout sentence in the sentence's language
             * (English inside an English sentence), any other reason as
             * written.
             */
            reason: composedValue((sentenceTranslator: Translator): string => {
              return getProbeFailureCauseText({
                translator: sentenceTranslator,
                failureCause: first.failureCause,
              });
            }),
          },
          /*
           * Drawn on the page and nothing else (the step's line and its
           * done line), so each value is set apart: a reason left in
           * English ("connect ECONNREFUSED 203.0.113.7:443.") keeps its
           * full stop and its brackets at its own end in an Arabic or
           * Persian sentence.
           */
          { setsValuesApart: true },
        )
      : translator.translatePlural(
          {
            one: "{{host}} did not answer from {{count}} location.",
            other: "{{host}} did not answer from {{count}} locations.",
          },
          down.length,
          { host: data.host },
        ),
    verdict: verdictText,
    verdictKind: verdict,
    isDown: true,
    isWaiting: isWaiting,
  };
};

/*
 * WHO IS TOLD, and how the step decides it: WhoIsToldMode and
 * getWhoIsToldMode, re-exported above from Common/Utils/GuidedSetup, where
 * Ask AI's set_up_paging decides it the same way.
 */

/*
 * What the step says when it makes no policy, read from whether the person
 * owns the monitor (#7409): "You own this monitor, so you are emailed" only
 * when they do. Null while that is still being read. A project whose
 * policies decide says so either way; someone who may not set paging up is
 * told the email is theirs, or how to make it theirs.
 */
export const getWhoIsToldHelp: (data: {
  mode: WhoIsToldMode;
  isMonitorOwner: boolean | null;
}) => string | null = (data: {
  mode: WhoIsToldMode;
  isMonitorOwner: boolean | null;
}): string | null => {
  if (data.mode === WhoIsToldMode.CreatePolicy) {
    return null;
  }

  if (data.isMonitorOwner === null) {
    return data.mode === WhoIsToldMode.ExistingPolicy
      ? WEBSITE_DOWN_COPY.whoExistingHelpNotOwner
      : null;
  }

  if (data.mode === WhoIsToldMode.ExistingPolicy) {
    return data.isMonitorOwner
      ? WEBSITE_DOWN_COPY.whoExistingHelp
      : WEBSITE_DOWN_COPY.whoExistingHelpNotOwner;
  }

  return data.isMonitorOwner
    ? WEBSITE_DOWN_COPY.whoOwnerOnlyHelp
    : WEBSITE_DOWN_COPY.whoOwnerOnlyHelpNotOwner;
};

/*
 * The step's line once it is done and no policy of this run pages anyone:
 * the project's policies, or the monitor's owner - or, for someone who
 * owns nothing here, what the server does anyway (the summary's words).
 */
export const getWhoIsToldDoneLine: (data: {
  translator: Translator;
  mode: WhoIsToldMode;
  isMonitorOwner: boolean | null;
}) => string = (data: {
  translator: Translator;
  mode: WhoIsToldMode;
  isMonitorOwner: boolean | null;
}): string => {
  if (data.mode === WhoIsToldMode.ExistingPolicy) {
    return (
      data.translator.translateText(
        "This project's on-call policies and rules decide who is paged.",
      ) || ""
    );
  }

  return data.isMonitorOwner === true
    ? data.translator.translateText(
        "You are emailed as the monitor's owner.",
      ) || ""
    : data.translator.translateText(
        "The project's owners are emailed about incidents nobody owns.",
      ) || "";
};

/*
 * THE RUN: what this pass through the setup made, as GuidedSetupRunStore
 * keeps it.
 */
export enum WebsiteDownRunValue {
  MonitorId = "monitorId",
  PolicyId = "policyId",
  // The who-is-told step was confirmed without a policy of its own.
  WhoIsToldConfirmed = "whoIsToldConfirmed",
  TestExecutionLogId = "testExecutionLogId",
  TestSkipped = "testSkipped",
}

// What the records say about each step, read when the page opens.
export interface WebsiteDownProgressFacts {
  // The run's monitor still exists.
  hasMonitor: boolean;
  // The run's policy still exists, or the step was confirmed.
  isWhoIsToldDone: boolean;
  testStatus: OnCallTestPageStatus | null;
  isTestSkipped: boolean;
}

export const isTestDone: (facts: WebsiteDownProgressFacts) => boolean = (
  facts: WebsiteDownProgressFacts,
): boolean => {
  return (
    facts.testStatus === OnCallTestPageStatus.Acknowledged ||
    facts.isTestSkipped
  );
};

export const getWebsiteDownProgress: (
  facts: WebsiteDownProgressFacts,
) => Array<GuidedSetupStepProgress> = (
  facts: WebsiteDownProgressFacts,
): Array<GuidedSetupStepProgress> => {
  // Each step builds on the one before: nothing after a missing monitor counts.
  const hasMonitor: boolean = facts.hasMonitor;
  const isWhoDone: boolean = hasMonitor && facts.isWhoIsToldDone;

  return [
    { key: WebsiteDownStep.Check, isDone: hasMonitor },
    { key: WebsiteDownStep.WhoIsTold, isDone: isWhoDone },
    { key: WebsiteDownStep.Test, isDone: isWhoDone && isTestDone(facts) },
  ];
};

// The setup reached its end: the thing works and was tested.
export const isWebsiteDownFinished: (
  facts: WebsiteDownProgressFacts,
) => boolean = (facts: WebsiteDownProgressFacts): boolean => {
  return (
    facts.hasMonitor &&
    facts.isWhoIsToldDone &&
    facts.testStatus === OnCallTestPageStatus.Acknowledged
  );
};

/*
 * THE SUMMARY: every claim read from the records.
 */
export interface WebsiteDownSummaryFacts {
  monitorName: string;
  intervalText: string;
  locationCount: number;
  /*
   * Of those, the connected ones, and the monitor's own minimum: how many
   * must find it down before its status changes (ProbeAgreementRule).
   * Not given, every location counts and all must agree.
   */
  activeLocationCount?: number | undefined;
  minimumProbeAgreement?: number | null | undefined;
  incidentSeverityName: string | null;
  mode: WhoIsToldMode;
  policyName: string | null;
  // Who the policy pages first: people's and teams' names.
  policyResponders: Array<string>;
  isMonitorOwner: boolean;
  canSendEmail: boolean;
  testResult: OnCallTestPageResult | null;
  testResultSentence: string | null;
}

export interface WebsiteDownSummaryRow {
  key: string;
  label: string;
  text: string;
}

export const getWebsiteDownSummaryRows: (
  translator: Translator,
  facts: WebsiteDownSummaryFacts,
) => Array<WebsiteDownSummaryRow> = (
  translator: Translator,
  facts: WebsiteDownSummaryFacts,
): Array<WebsiteDownSummaryRow> => {
  const rows: Array<WebsiteDownSummaryRow> = [];

  rows.push({
    key: "checked",
    label: translator.translateText(WEBSITE_DOWN_COPY.summaryChecked) || "",
    text: translator.translatePlural(
      {
        one: "{{interval}}, from {{count}} location.",
        other: "{{interval}}, from {{count}} locations.",
      },
      facts.locationCount,
      { interval: facts.intervalText },
    ),
  });

  /*
   * With more than one location, only when enough of them agree (#7410):
   * the rule as the monitor's probes card says it, so the summary and the
   * monitor's page never disagree about it.
   */
  const agreement: string | null = getProbeAgreementSentence({
    activeProbeCount: facts.activeLocationCount ?? facts.locationCount,
    minimumProbeAgreement: facts.minimumProbeAgreement,
    translator: translator,
  });

  const whenDown: string = facts.incidentSeverityName
    ? translator.translateTemplate(
        /*
         * The severity in brackets: a new project's are named "Critical
         * Incident" and the rest, so "a {{severity}} incident" doubled it.
         */
        "If it does not answer, or answers with an error, OneUptime opens an incident ({{severity}}).",
        { severity: facts.incidentSeverityName },
      )
    : translator.translateText(
        "If it does not answer, or answers with an error, its status changes to Offline.",
      ) || "";

  rows.push({
    key: "when_down",
    label: translator.translateText(WEBSITE_DOWN_COPY.summaryWhenDown) || "",
    text: agreement ? `${whenDown} ${agreement}` : whenDown,
  });

  const told: Array<string> = [];

  if (facts.mode === WhoIsToldMode.CreatePolicy && facts.policyName) {
    told.push(
      facts.policyResponders.length > 0
        ? translator.translateTemplate(
            'The on-call policy "{{policy}}" pages {{people}} for every new incident and alert.',
            {
              policy: facts.policyName,
              people: facts.policyResponders.join(", "),
            },
          )
        : translator.translateTemplate(
            'The on-call policy "{{policy}}" runs for every new incident and alert.',
            { policy: facts.policyName },
          ),
    );
  } else if (facts.mode === WhoIsToldMode.ExistingPolicy) {
    told.push(
      translator.translateText(
        "This project's on-call policies and rules decide who is paged.",
      ) || "",
    );
  }

  if (facts.isMonitorOwner) {
    told.push(
      facts.canSendEmail
        ? translator.translateText(
            "You own this monitor, so you are emailed when its status changes.",
          ) || ""
        : translator.translateText(
            "You own this monitor, but this server cannot send email yet, so nobody is emailed.",
          ) || "",
    );
  }

  rows.push({
    key: "who_is_told",
    label: translator.translateText(WEBSITE_DOWN_COPY.summaryWhoIsTold) || "",
    text:
      told.join(" ") ||
      translator.translateText(
        "The project's owners are emailed about incidents nobody owns.",
      ) ||
      "",
  });

  rows.push({
    key: "tested",
    label: translator.translateText(WEBSITE_DOWN_COPY.summaryTested) || "",
    text:
      facts.testResult?.status === OnCallTestPageStatus.Acknowledged &&
      facts.testResultSentence
        ? facts.testResultSentence
        : translator.translateText(WEBSITE_DOWN_COPY.summaryNotTested) || "",
  });

  return rows;
};
