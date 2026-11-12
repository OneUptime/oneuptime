import { DEFAULT_MONITORING_INTERVAL } from "../../../Utils/Form/Monitor/MonitoringIntervalDefault";
import { GuidedSetupStepProgress } from "../GuidedSetupProgress";
import URL from "Common/Types/API/URL";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import { MonitorStepProbeResponse } from "Common/Models/DatabaseModels/MonitorProbe";
import MonitorCriteriaInstance from "Common/Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import {
  OnCallTestPageResult,
  OnCallTestPageStatus,
} from "Common/Types/OnCallDutyPolicy/OnCallTestPage";
import ProbeMonitorResponse from "Common/Types/Probe/ProbeMonitorResponse";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";

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
 *      which opens an incident). The monitor's probes check it at once,
 *      and their first answer is said in a sentence.
 *   2. Who should be told? A project with no on-call policy gets one,
 *      paging the people picked - "You", to start with - for every new
 *      incident and alert (FirstResponders, EveryNewEventRules). A project
 *      that pages people already keeps its own policies and rules. Either
 *      way the person owns the monitor they made (the creator of an
 *      operational resource does), so they are emailed when its status
 *      changes, project owner or not.
 *   3. Send a test: a test page to themselves (#6811), acknowledged from
 *      the message. Then the summary, read from the records.
 *
 * This file is the setup's rules and words, React-free so tests read
 * them; WebsiteDownApi.ts reads and writes the records.
 */

export const WEBSITE_DOWN_SETUP: string = "website_down";

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

// The name of the policy the setup makes when the project has none.
export const WEBSITE_DOWN_POLICY_NAME: string = "Default on-call policy";

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
  whoOwnerOnlyHelp: string;
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
  checkHelp: translationKey(
    "OneUptime checks it every 5 minutes from several locations. If it does not answer, or answers with an error, an incident opens.",
  ),
  addressLabel: translationKey("Website or API address"),
  addressPlaceholder: "https://example.com",
  addressError: translationKey(
    "Enter a web address, such as https://example.com.",
  ),
  isApiLabel: translationKey("This is an API endpoint"),
  startChecking: translationKey("Start checking"),
  continueButton: translationKey("Continue"),
  cannotCreateMonitor: translationKey(
    "Creating a monitor needs permission you do not have in this project. Ask a project admin to give it to you, or to set this up.",
  ),
  whoTitle: translationKey("Who should be told?"),
  whoCreateHelp: translationKey(
    "When it goes down, OneUptime opens an incident and pages these people through their own notification rules. It starts with you, by email.",
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
  whoOwnerOnlyHelp: translationKey(
    "You own this monitor, so you are emailed when it goes down. Paging a team needs a project admin: ask one to set up an on-call policy.",
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
 * THE ADDRESS. A person types "example.com" as often as a whole URL:
 * without a scheme it is https. Only http and https are checked by a
 * Website or API monitor.
 */
export interface WebsiteAddress {
  url: string;
  host: string;
  // What the monitor is called: the host, and the path when there is one.
  monitorName: string;
}

const SCHEME: RegExp = /^[a-z][a-z0-9+.-]*:\/\//i;
const WHITESPACE: RegExp = /\s/;
export const MONITOR_NAME_MAX_LENGTH: number = 100;

export const parseWebsiteAddress: (input: string) => WebsiteAddress | null = (
  input: string,
): WebsiteAddress | null => {
  const text: string = (input || "").trim();

  if (!text || WHITESPACE.test(text)) {
    return null;
  }

  const withScheme: string = SCHEME.test(text) ? text : `https://${text}`;

  let parsed: globalThis.URL;

  try {
    parsed = new globalThis.URL(withScheme);
  } catch {
    return null;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return null;
  }

  /*
   * No user or password in it: "mailto:ana@example.com" given https:// in
   * front reads as one, and a password must not become a monitor's name.
   */
  if (parsed.username || parsed.password) {
    return null;
  }

  const host: string = parsed.hostname.toLowerCase();

  // A host is a name with a dot in it, localhost, or an IP address.
  if (
    !host ||
    (!host.includes(".") && !host.includes(":") && host !== "localhost")
  ) {
    return null;
  }

  try {
    URL.fromString(withScheme);
  } catch {
    return null;
  }

  const path: string = parsed.pathname.replace(/\/+$/, "");
  const name: string = `${host.replace(/^www\./, "")}${parsed.port ? `:${parsed.port}` : ""}${path}`;

  return {
    url: withScheme,
    host: host,
    monitorName:
      name.length > MONITOR_NAME_MAX_LENGTH
        ? name.slice(0, MONITOR_NAME_MAX_LENGTH)
        : name,
  };
};

// What a new monitor's default criteria are made with: the project's own.
export interface WebsiteMonitorSeeds {
  operationalStatusId: ObjectID;
  offlineStatusId: ObjectID;
  incidentSeverityId: ObjectID;
  alertSeverityId: ObjectID;
}

/*
 * The monitor Create Monitor would make for this address with every
 * default kept: the type's criteria, in the reader's language, and five
 * minutes. The probes are left to the server, which adds the ones a new
 * monitor starts with when the create names none.
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
  const monitorType: MonitorType = data.isApi
    ? MonitorType.API
    : MonitorType.Website;

  const monitorSteps: MonitorSteps = MonitorSteps.getDefaultMonitorSteps({
    defaultMonitorStatusId: data.seeds.operationalStatusId,
    monitorType: monitorType,
    monitorName: data.address.monitorName,
    onlineMonitorStatusId: data.seeds.operationalStatusId,
    offlineMonitorStatusId: data.seeds.offlineStatusId,
    defaultIncidentSeverityId: data.seeds.incidentSeverityId,
    defaultAlertSeverityId: data.seeds.alertSeverityId,
    translator: data.translator,
  });

  monitorSteps.data?.monitorStepsInstanceArray[0]?.setMonitorDestination(
    URL.fromString(data.address.url),
  );

  const monitor: Monitor = new Monitor();
  monitor.name = data.address.monitorName;
  monitor.monitorType = monitorType;
  monitor.monitorSteps = monitorSteps;
  monitor.monitoringInterval = DEFAULT_MONITORING_INTERVAL;

  return monitor;
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

export interface FirstCheckSentence {
  text: string;
  isDown: boolean;
  isWaiting: boolean;
}

/*
 * "example.com answered 200 in 312 ms from 2 locations." Read from the
 * probes' answers; while none has answered, what is being waited for.
 */
export const describeFirstCheck: (data: {
  translator: Translator;
  host: string;
  locationCount: number;
  answers: ReadonlyArray<FirstCheckAnswer>;
}) => FirstCheckSentence = (data: {
  translator: Translator;
  host: string;
  locationCount: number;
  answers: ReadonlyArray<FirstCheckAnswer>;
}): FirstCheckSentence => {
  const translator: Translator = data.translator;

  if (data.answers.length === 0) {
    if (data.locationCount === 0) {
      return {
        text: translator.translateTemplate(
          "No location checks {{host}} yet. Probes are added under Monitors > Settings > Probes.",
          { host: data.host },
        ),
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
      isDown: false,
      isWaiting: false,
    };
  }

  const first: FirstCheckAnswer = down[0]!;

  if (first.isOnline && typeof first.responseCode === "number") {
    return {
      text: translator.translatePlural(
        {
          one: "{{host}} answered {{code}} from {{count}} location. That counts as down, so an incident opens.",
          other:
            "{{host}} answered {{code}} from {{count}} locations. That counts as down, so an incident opens.",
        },
        down.length,
        { host: data.host, code: String(first.responseCode) },
      ),
      isDown: true,
      isWaiting: false,
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
          { host: data.host, reason: first.failureCause },
        )
      : translator.translatePlural(
          {
            one: "{{host}} did not answer from {{count}} location.",
            other: "{{host}} did not answer from {{count}} locations.",
          },
          down.length,
          { host: data.host },
        ),
    isDown: true,
    isWaiting: false,
  };
};

/*
 * WHO IS TOLD, and how the step decides it.
 */
export enum WhoIsToldMode {
  // No on-call policy or rule yet: the setup makes one, paging who is picked.
  CreatePolicy = "create_policy",
  // The project pages people already: its own policies and rules decide.
  ExistingPolicy = "existing_policy",
  // Paging cannot be set up by this person: told as the monitor's owner.
  OwnerEmailOnly = "owner_email_only",
}

export interface WhoIsToldFacts {
  // Counts of the project's on-call policies and rules; null when unknown.
  policyCount: number | null;
  incidentRuleCount: number | null;
  alertRuleCount: number | null;
  mayCreatePolicy: boolean;
  mayAddEscalationRules: boolean;
  mayAddRules: boolean;
}

export const getWhoIsToldMode: (facts: WhoIsToldFacts) => WhoIsToldMode = (
  facts: WhoIsToldFacts,
): WhoIsToldMode => {
  if (
    facts.policyCount === null ||
    facts.incidentRuleCount === null ||
    facts.alertRuleCount === null
  ) {
    return WhoIsToldMode.OwnerEmailOnly;
  }

  if (
    facts.policyCount > 0 ||
    facts.incidentRuleCount > 0 ||
    facts.alertRuleCount > 0
  ) {
    return WhoIsToldMode.ExistingPolicy;
  }

  if (
    facts.mayCreatePolicy &&
    facts.mayAddEscalationRules &&
    facts.mayAddRules
  ) {
    return WhoIsToldMode.CreatePolicy;
  }

  return WhoIsToldMode.OwnerEmailOnly;
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

  rows.push({
    key: "when_down",
    label: translator.translateText(WEBSITE_DOWN_COPY.summaryWhenDown) || "",
    text: facts.incidentSeverityName
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
        ) || "",
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
