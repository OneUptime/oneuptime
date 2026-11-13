import { GuidedSetupStepProgress } from "../GuidedSetupProgress";
import {
  WEBSITE_DOWN_COPY,
  WEBSITE_DOWN_POLICY_NAME,
} from "../WebsiteDown/WebsiteDownSetup";
import {
  WhoIsToldBreak,
  WhoIsToldBreakKind,
  WhoIsToldFix,
  WhoIsToldPersonProblem,
  WhoIsToldServerChannel,
  makeWhoIsToldBreak,
} from "Common/Types/Monitor/WhoIsTold";
import { OnCallPageChannel } from "Common/Types/OnCallDutyPolicy/OnCallPageChannel";
import {
  OnCallTestPageResult,
  OnCallTestPageStatus,
} from "Common/Types/OnCallDutyPolicy/OnCallTestPage";
import { DEFAULT_ESCALATE_AFTER_IN_MINUTES } from "Common/Types/OnCallDutyPolicy/EscalationRuleDefaults";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import { formatProjectBalanceAmount } from "Common/Utils/Project/ProjectBalance";
import { getChannelName } from "../../Monitor/Overview/WhoIsToldWords";

/*
 * GUIDED SETUP: PAGE THE RIGHT PERSON, AND ESCALATE (issue #6805).
 *
 * "Phone me when it is down, and phone someone else if I do not answer"
 * crossed five products: Notification Settings (SMS and calls start off,
 * and on OneUptime Cloud the balance starts at nothing), the person's own
 * notification methods, Users, On-Call Policies and the policy's
 * Escalation Rules. Each form was short; the gaps between them were silent.
 * Here it is one page (Pages/OnCallDuty/GuidedSetup.tsx), in
 * GuidedSetupFrame:
 *
 *   1. How should we reach you? Email, SMS and calls from one number and
 *      one code, and the app. Each says what stops it on this project and
 *      this server, and the fix is in the step: an owner turns SMS and
 *      calls on there, anyone else is told who can.
 *   2. Who else is on call? A project with no policy gets "Default on-call
 *      policy", paging the people picked, with the two on-call rules that
 *      run it for every new incident and alert (#5359). A project with
 *      policies starts from one of them: the people picked join its first
 *      level, and a missing rule is added. Each person says whether a page
 *      reaches them (On-Call Readiness), with "Send setup reminder". The
 *      project's policies, and the policy's rules, are read again just
 *      before either is made, so a policy or a rule another tab or device
 *      made meanwhile is never made twice (#7252).
 *   3. What if nobody answers? Someone else after a wait, or the page
 *      again. Cloud's Free plan allows one escalation rule per policy, so
 *      there it repeats.
 *   4. Send a test page to the policy (#6811), acknowledged from the
 *      message. Then the summary, read from the records.
 *
 * This file is the setup's rules and words, React-free so tests read them;
 * OnCallSetupApi.ts reads and writes the records.
 */

export const ON_CALL_SETUP: string = "on_call";

// The docs' start-to-finish guide to this job (#6821), linked from the page.
export const ON_CALL_SETUP_GUIDE_DOCS_PATH: string = "/docs/guides/paging";

export enum OnCallSetupStep {
  ReachYou = "reach_you",
  WhoElse = "who_else",
  NoAnswer = "no_answer",
  Test = "test",
}

export const ON_CALL_SETUP_STEPS: ReadonlyArray<OnCallSetupStep> = [
  OnCallSetupStep.ReachYou,
  OnCallSetupStep.WhoElse,
  OnCallSetupStep.NoAnswer,
  OnCallSetupStep.Test,
];

// One name for the policy a guided setup makes: the website setup's.
export const ON_CALL_POLICY_NAME: string = WEBSITE_DOWN_POLICY_NAME;

/*
 * On OneUptime Cloud a phone number can't be added - its code is a text -
 * while the balance is at or below this (UserSmsService, UserCallService).
 */
export const PHONE_BALANCE_FLOOR_IN_USD_CENTS: number = 100;

// How many more times "page again" repeats the policy, to start with.
export const DEFAULT_REPEAT_TIMES: number = 2;

export { DEFAULT_ESCALATE_AFTER_IN_MINUTES };

export const ON_CALL_SETUP_COPY: {
  pageTitle: string;
  pageDescription: string;
  reachTitle: string;
  reachHelp: string;
  emailRow: string;
  phoneRow: string;
  pushRow: string;
  emailNone: string;
  phoneNone: string;
  pushNone: string;
  pushHelp: string;
  pushLink: string;
  phoneLabel: string;
  sendSmsCode: string;
  phoneError: string;
  turnOnSmsAndCalls: string;
  phoneBalance: string;
  addBalance: string;
  whoCanAddBalance: string;
  serverNoTwilio: string;
  serverNoTwilioForAdmin: string;
  setUpTwilio: string;
  notReachable: string;
  continueButton: string;
  saveButton: string;
  whoTitle: string;
  whoCreateHelp: string;
  whoExistingHelp: string;
  whoPolicyLabel: string;
  whoPeopleLabel: string;
  whoAddPeople: string;
  whoNobodyPicked: string;
  whoAddToLevel: string;
  whoAddRules: string;
  whoCannotCreate: string;
  policyMadeElsewhere: string;
  couldNotSave: string;
  whoReadinessTitle: string;
  sendReminder: string;
  reminderSent: string;
  noAnswerTitle: string;
  noAnswerHelp: string;
  noAnswerEscalate: string;
  noAnswerRepeat: string;
  noAnswerNothing: string;
  noAnswerWaitLabel: string;
  noAnswerWaitError: string;
  noAnswerSecondLevelLabel: string;
  noAnswerRepeatLabel: string;
  noAnswerRepeatError: string;
  nobodyElse: string;
  noAnswerFreePlan: string;
  noAnswerHasLevels: string;
  testTitle: string;
  testHelp: string;
  testSkip: string;
  testSendAnother: string;
  testDidNotGetIt: string;
  testDidNotGetItHelp: string;
  testMethodsLink: string;
  summaryTitle: string;
  summaryFirst: string;
  summaryNoAnswer: string;
  summaryExistingRules: string;
  summaryTested: string;
  summaryNotTested: string;
  summaryNeedsAttention: string;
  summaryNext: string;
  nextSchedule: string;
  nextScheduleNeedsPlan: string;
  nextChat: string;
  nextWorkingHours: string;
  nextReadiness: string;
  openPolicy: string;
  startOver: string;
} = {
  pageTitle: translationKey("Page the right person when something breaks"),
  pageDescription: translationKey(
    "Guided setup: how you are reached, who else is on call, what happens if nobody answers, and a test page, on this page.",
  ),
  reachTitle: translationKey("How should we reach you?"),
  reachHelp: translationKey(
    "A page goes to every method you have verified. Add your phone to be texted and called.",
  ),
  emailRow: translationKey("Email"),
  phoneRow: translationKey("SMS and phone calls"),
  pushRow: translationKey("Mobile app or browser"),
  emailNone: translationKey("No verified email address."),
  phoneNone: translationKey("No phone number yet."),
  pushNone: translationKey("Not set up."),
  pushHelp: translationKey(
    "Get the OneUptime app, or turn on notifications in this browser, from your notification methods.",
  ),
  pushLink: translationKey("Set up the app or this browser"),
  phoneLabel: translationKey("Your phone number"),
  sendSmsCode: translationKey("Text me a code"),
  phoneError: translationKey(
    "Enter the number with its country code, such as +15551234567.",
  ),
  turnOnSmsAndCalls: translationKey("Turn on SMS and phone calls"),
  phoneBalance: translationKey(
    "Texts and calls are paid from this project's balance, which is {{balance}}. Adding a number sends a text, so the balance must be more than {{floor}}.",
  ),
  addBalance: translationKey("Add balance"),
  whoCanAddBalance: translationKey(
    "A project owner or someone with Manage Billing can add balance in Project Settings → Notifications → Notification Channels.",
  ),
  serverNoTwilio: translationKey(
    "This server can't send SMS or make calls yet. Its admin sets up Twilio in the Admin Dashboard. Until then, email and the app still reach you.",
  ),
  serverNoTwilioForAdmin: translationKey(
    "This server can't send SMS or make calls yet. Set up Twilio for the server; until then, email and the app still reach you.",
  ),
  setUpTwilio: translationKey("Set up SMS and calls"),
  notReachable: translationKey(
    "Nothing can reach you yet. Verify at least one way to be reached to continue.",
  ),
  continueButton: WEBSITE_DOWN_COPY.continueButton,
  saveButton: WEBSITE_DOWN_COPY.whoSave,
  whoTitle: translationKey("Who else is on call?"),
  whoCreateHelp: translationKey(
    'This makes the on-call policy "{{policy}}". It pages these people first, for every new incident and alert in this project.',
  ),
  whoExistingHelp: translationKey(
    "This project already has on-call policies. Pick the one to set up: the people you add join its first escalation rule.",
  ),
  whoPolicyLabel: translationKey("On-call policy"),
  whoPeopleLabel: translationKey("Paged first"),
  whoAddPeople: WEBSITE_DOWN_COPY.whoAddPeople,
  whoNobodyPicked: WEBSITE_DOWN_COPY.whoNobodyPicked,
  whoAddToLevel: translationKey("Add to the first escalation rule"),
  whoAddRules: translationKey(
    "Page this policy for every new incident and alert",
  ),
  whoCannotCreate: translationKey(
    "Setting up an on-call policy needs permission you do not have in this project. Ask a project owner or admin to set it up; your own notification methods are ready above.",
  ),
  /*
   * Said when Save and continue finds a policy another tab or device made
   * since the step opened: the step turns to the project's policies, and
   * nothing was made twice (#7252). The website-down setup's words.
   */
  policyMadeElsewhere: WEBSITE_DOWN_COPY.policyMadeElsewhere,
  // The project's policies could not be read just before: nothing is made.
  couldNotSave: WEBSITE_DOWN_COPY.couldNotSave,
  whoReadinessTitle: translationKey("Can a page reach them?"),
  sendReminder: translationKey("Send setup reminder"),
  reminderSent: translationKey("Reminder sent"),
  noAnswerTitle: translationKey("What if nobody answers?"),
  noAnswerHelp: translationKey(
    "A page waits for someone to acknowledge it. If nobody does in time:",
  ),
  noAnswerEscalate: translationKey("Page someone else"),
  noAnswerRepeat: translationKey("Page the same people again"),
  noAnswerNothing: translationKey("Do nothing more"),
  noAnswerWaitLabel: translationKey("Minutes to wait"),
  noAnswerWaitError: translationKey(
    "Enter a number of minutes from 1 to 1440.",
  ),
  noAnswerSecondLevelLabel: translationKey("Paged next"),
  noAnswerRepeatLabel: translationKey("Times to page again"),
  noAnswerRepeatError: translationKey("Enter a number of times from 1 to 10."),
  nobodyElse: translationKey("Nobody else is paged."),
  noAnswerFreePlan: translationKey(
    "Paging someone else is a second escalation rule, which needs a paid plan. On the Free plan, the page can repeat instead.",
  ),
  noAnswerHasLevels: translationKey(
    "This policy already pages someone else when nobody answers.",
  ),
  testTitle: translationKey("Send a test page"),
  testHelp: translationKey(
    "Test the policy now: it pages its first escalation rule the way a real incident would, and every message says TEST. Acknowledge it from the message to finish.",
  ),
  testSkip: WEBSITE_DOWN_COPY.testSkip,
  testSendAnother: WEBSITE_DOWN_COPY.testSendAnother,
  testDidNotGetIt: WEBSITE_DOWN_COPY.testDidNotGetIt,
  testDidNotGetItHelp: WEBSITE_DOWN_COPY.testDidNotGetItHelp,
  testMethodsLink: WEBSITE_DOWN_COPY.testMethodsLink,
  summaryTitle: translationKey("Paging is set up"),
  summaryFirst: translationKey("Who is paged"),
  summaryNoAnswer: translationKey("If nobody answers"),
  summaryExistingRules: translationKey(
    'Its on-call rules decide which incidents and alerts run "{{policy}}", which pages {{people}}.',
  ),
  summaryTested: WEBSITE_DOWN_COPY.summaryTested,
  summaryNotTested: translationKey(
    "Not tested yet. Test the policy to be sure a page reaches someone.",
  ),
  summaryNeedsAttention: translationKey("Needs attention"),
  summaryNext: WEBSITE_DOWN_COPY.summaryNext,
  nextSchedule: translationKey("Take turns with an on-call schedule"),
  nextScheduleNeedsPlan: translationKey(
    "Take turns with an on-call schedule (needs the {{plan}} plan)",
  ),
  nextChat: translationKey("Connect Slack or Microsoft Teams"),
  nextWorkingHours: translationKey(
    "Page only in working hours for less urgent incidents",
  ),
  nextReadiness: translationKey("See who can be paged"),
  openPolicy: translationKey("Open the on-call policy"),
  startOver: translationKey("Set up another policy"),
};

/*
 * THE RUN: what this pass through the setup made or confirmed, as
 * GuidedSetupRunStore keeps it.
 */
export enum OnCallRunValue {
  // Step 1 was confirmed while something could reach the person.
  ReachConfirmed = "reachConfirmed",
  PolicyId = "policyId",
  // The policy was the project's own: the setup did not make it.
  PolicyIsExisting = "policyIsExisting",
  NoAnswerDone = "noAnswerDone",
  TestExecutionLogId = "testExecutionLogId",
  TestSkipped = "testSkipped",
}

// What the records say about each step, read when the page opens.
export interface OnCallProgressFacts {
  isReachConfirmed: boolean;
  // The run's policy still exists.
  hasPolicy: boolean;
  isNoAnswerDone: boolean;
  testStatus: OnCallTestPageStatus | null;
  isTestSkipped: boolean;
}

export const getOnCallProgress: (
  facts: OnCallProgressFacts,
) => Array<GuidedSetupStepProgress> = (
  facts: OnCallProgressFacts,
): Array<GuidedSetupStepProgress> => {
  // Each step builds on the one before: nothing after a missing policy counts.
  const isReachDone: boolean = facts.isReachConfirmed;
  const isWhoDone: boolean = isReachDone && facts.hasPolicy;
  const isNoAnswerDone: boolean = isWhoDone && facts.isNoAnswerDone;
  const isTestDone: boolean =
    isNoAnswerDone &&
    (facts.testStatus === OnCallTestPageStatus.Acknowledged ||
      facts.isTestSkipped);

  return [
    { key: OnCallSetupStep.ReachYou, isDone: isReachDone },
    { key: OnCallSetupStep.WhoElse, isDone: isWhoDone },
    { key: OnCallSetupStep.NoAnswer, isDone: isNoAnswerDone },
    { key: OnCallSetupStep.Test, isDone: isTestDone },
  ];
};

// The setup reached its end: the policy works and a page was acknowledged.
export const isOnCallSetupFinished: (facts: OnCallProgressFacts) => boolean = (
  facts: OnCallProgressFacts,
): boolean => {
  return (
    facts.isReachConfirmed &&
    facts.hasPolicy &&
    facts.isNoAnswerDone &&
    facts.testStatus === OnCallTestPageStatus.Acknowledged
  );
};

/*
 * STEP 1: HOW A PAGE REACHES THE PERSON, AND WHAT STOPS IT.
 */

// A method of theirs, as On-Call Readiness reports it (always masked).
export interface ReachMethod {
  methodType: string;
  maskedIdentifier: string;
  isVerified: boolean;
}

// The readiness method types this step draws a row for.
export const EMAIL_METHOD_TYPE: string = "Email";
export const SMS_METHOD_TYPE: string = "SMS";
export const CALL_METHOD_TYPE: string = "Call";
export const PUSH_METHOD_TYPE: string = "Push";

export const getVerifiedMethodsOfType: (
  methods: ReadonlyArray<ReachMethod>,
  types: ReadonlyArray<string>,
) => Array<ReachMethod> = (
  methods: ReadonlyArray<ReachMethod>,
  types: ReadonlyArray<string>,
): Array<ReachMethod> => {
  return methods.filter((method: ReachMethod): boolean => {
    return method.isVerified && types.includes(method.methodType);
  });
};

// What decides whether a phone number can be added and paged here.
export interface PhoneChannelFacts {
  // OneUptime Cloud: SMS and calls are paid from the project's balance.
  isBillingEnabled: boolean;
  // The project's switches; null while not known (the server decides).
  isSmsOn: boolean | null;
  isCallOn: boolean | null;
  // OneUptime Cloud: the balance, in US cents; null while not known.
  balanceInUSDCents: number | null;
  /*
   * Self-hosted: whether the server can send SMS and make calls, as a
   * master admin reads it (ServerSendingStatus). Null when not known - for
   * anyone else, and on OneUptime Cloud.
   */
  serverCanSendSms: boolean | null;
  serverCanCall: boolean | null;
}

/*
 * The breaks between this person's phone and a page, in #6810's words
 * (WhoIsToldBreakKind), in the order they are fixed: the server first, then
 * the project's switches, then the balance. Only what is known is said:
 * something not known is the server's to refuse, with its reason.
 */
export const getPhoneBreaks: (
  facts: PhoneChannelFacts,
) => Array<WhoIsToldBreak> = (
  facts: PhoneChannelFacts,
): Array<WhoIsToldBreak> => {
  const breaks: Array<WhoIsToldBreak> = [];

  if (!facts.isBillingEnabled) {
    if (facts.serverCanSendSms === false) {
      breaks.push(
        makeWhoIsToldBreak({
          kind: WhoIsToldBreakKind.ServerCannotSend,
          fix: WhoIsToldFix.ServerSettings,
          channel: WhoIsToldServerChannel.SMS,
        }),
      );
    }

    if (facts.serverCanCall === false) {
      breaks.push(
        makeWhoIsToldBreak({
          kind: WhoIsToldBreakKind.ServerCannotSend,
          fix: WhoIsToldFix.ServerSettings,
          channel: WhoIsToldServerChannel.Call,
        }),
      );
    }
  }

  if (facts.isSmsOn === false) {
    breaks.push(
      makeWhoIsToldBreak({
        kind: WhoIsToldBreakKind.ChannelOff,
        fix: WhoIsToldFix.ProjectNotificationSettings,
        channel: OnCallPageChannel.SMS,
      }),
    );
  }

  if (facts.isCallOn === false) {
    breaks.push(
      makeWhoIsToldBreak({
        kind: WhoIsToldBreakKind.ChannelOff,
        fix: WhoIsToldFix.ProjectNotificationSettings,
        channel: OnCallPageChannel.Call,
      }),
    );
  }

  if (isPhoneBalanceTooLow(facts)) {
    breaks.push(
      makeWhoIsToldBreak({
        kind: WhoIsToldBreakKind.NoBalance,
        fix: WhoIsToldFix.ProjectBilling,
      }),
    );
  }

  return breaks;
};

// OneUptime Cloud, and the balance is known to be too low to add a number.
export const isPhoneBalanceTooLow: (facts: PhoneChannelFacts) => boolean = (
  facts: PhoneChannelFacts,
): boolean => {
  return (
    facts.isBillingEnabled &&
    facts.balanceInUSDCents !== null &&
    facts.balanceInUSDCents <= PHONE_BALANCE_FLOOR_IN_USD_CENTS
  );
};

// The server is known not to be able to send SMS or make calls.
export const isServerWithoutTwilio: (facts: PhoneChannelFacts) => boolean = (
  facts: PhoneChannelFacts,
): boolean => {
  return (
    !facts.isBillingEnabled &&
    (facts.serverCanSendSms === false || facts.serverCanCall === false)
  );
};

/*
 * Whether the number field is offered: SMS is not known to be off, the
 * balance is not known to be too low, and the server is not known to be
 * unable to text. Calls follow SMS: a number verified by text is verified
 * for calls without a second code (UserCallService).
 */
export const canAddPhone: (facts: PhoneChannelFacts) => boolean = (
  facts: PhoneChannelFacts,
): boolean => {
  return (
    facts.isSmsOn !== false &&
    !isPhoneBalanceTooLow(facts) &&
    !(!facts.isBillingEnabled && facts.serverCanSendSms === false)
  );
};

// A number with its country code: 7 to 15 digits, a + first or not.
const PHONE_NUMBER_PATTERN: RegExp = /^\+?[0-9]{7,15}$/;

// Digits only: a whole number of minutes or times.
const WHOLE_NUMBER_PATTERN: RegExp = /^[0-9]+$/;

/*
 * A phone number as typed: digits, with a + and the country code. Spaces,
 * dashes, dots and brackets are dropped. Null when it is not a number.
 */
export const parsePhoneNumber: (input: string) => string | null = (
  input: string,
): string | null => {
  const text: string = (input || "").trim().replace(/[\s\-().]/g, "");

  if (!PHONE_NUMBER_PATTERN.test(text)) {
    return null;
  }

  return text.startsWith("+") ? text : `+${text}`;
};

// "0.00 USD", as the balance pages show an amount.
export const formatUsdCents: (cents: number) => string = (
  cents: number,
): string => {
  return formatProjectBalanceAmount(cents);
};

/*
 * STEP 2: WHO IS PAGED FIRST, AND WHETHER IT REACHES THEM.
 */

// One escalation rule of a policy, with who it pages, by name.
export interface PolicyLevel {
  id: string;
  order: number;
  escalateAfterInMinutes: number;
  userIds: Array<string>;
  // People's, teams' and schedules' names, in that order.
  names: Array<string>;
  responderCount: number;
}

export interface OnCallPolicyRecord {
  id: string;
  name: string;
  levels: Array<PolicyLevel>;
  repeatTimes: number;
  // Enabled on-call rules that name this policy.
  incidentRuleCount: number;
  alertRuleCount: number;
}

// A responder, as On-Call Readiness reports them.
export interface ResponderReach {
  userId: string;
  name: string;
  isReachable: boolean;
  // Verified methods' types: "Email", "SMS", "Call", "Push", ...
  channels: Array<string>;
}

// The people a level names, as On-Call Readiness reports them.
export const getFirstLevelPeople: (data: {
  level: PolicyLevel;
  responders: ReadonlyArray<ResponderReach>;
}) => Array<ResponderReach> = (data: {
  level: PolicyLevel;
  responders: ReadonlyArray<ResponderReach>;
}): Array<ResponderReach> => {
  return data.responders.filter((person: ResponderReach): boolean => {
    return data.level.userIds.includes(person.userId);
  });
};

/*
 * The breaks between the policy and the people it pages: nothing runs it,
 * a first level nobody is on, and each person a page can't reach.
 */
export const getPolicyBreaks: (data: {
  policy: OnCallPolicyRecord;
  responders: ReadonlyArray<ResponderReach>;
}) => Array<WhoIsToldBreak> = (data: {
  policy: OnCallPolicyRecord;
  responders: ReadonlyArray<ResponderReach>;
}): Array<WhoIsToldBreak> => {
  const breaks: Array<WhoIsToldBreak> = [];
  const policy: OnCallPolicyRecord = data.policy;

  if (policy.incidentRuleCount === 0 && policy.alertRuleCount === 0) {
    breaks.push(
      makeWhoIsToldBreak({
        kind: WhoIsToldBreakKind.NobodyPaged,
        fix: WhoIsToldFix.IncidentOnCallRules,
        policyId: policy.id,
        policyName: policy.name,
      }),
    );
  } else if (policy.alertRuleCount === 0) {
    breaks.push(
      makeWhoIsToldBreak({
        kind: WhoIsToldBreakKind.OnlyIncidentsHaveRules,
        fix: WhoIsToldFix.AlertOnCallRules,
        policyId: policy.id,
        policyName: policy.name,
      }),
    );
  }

  const first: PolicyLevel | undefined = policy.levels[0];

  if (!first) {
    breaks.push(
      makeWhoIsToldBreak({
        kind: WhoIsToldBreakKind.PolicyHasNoLevels,
        fix: WhoIsToldFix.OnCallPolicy,
        policyId: policy.id,
        policyName: policy.name,
      }),
    );

    return breaks;
  }

  /*
   * On-Call Readiness answers for everyone the policy pages, on every
   * level: the first level is the people named on it. A level that also
   * names a team or a schedule reaches people it does not list, so it is
   * said to reach nobody only when it names people alone and none of them
   * can be reached.
   */
  const firstLevelPeople: Array<ResponderReach> = getFirstLevelPeople({
    level: first,
    responders: data.responders,
  });
  const namesPeopleOnly: boolean =
    first.userIds.length > 0 && first.userIds.length === first.responderCount;
  const reachesNobody: boolean =
    first.responderCount === 0 ||
    (namesPeopleOnly &&
      !firstLevelPeople.some((person: ResponderReach): boolean => {
        return person.isReachable;
      }));

  if (reachesNobody) {
    breaks.push(
      makeWhoIsToldBreak({
        kind: WhoIsToldBreakKind.PolicyReachesNobody,
        fix: WhoIsToldFix.OnCallPolicy,
        policyId: policy.id,
        policyName: policy.name,
      }),
    );
  }

  for (const person of data.responders) {
    if (!person.isReachable) {
      breaks.push(
        makeWhoIsToldBreak({
          kind: WhoIsToldBreakKind.PersonUnreachable,
          fix: WhoIsToldFix.OnCallReadiness,
          policyId: policy.id,
          policyName: policy.name,
          userId: person.userId,
          userName: person.name,
          problem: WhoIsToldPersonProblem.NoVerifiedMethod,
        }),
      );
    }
  }

  return breaks;
};

// Which on-call rules the setup still has to add for the policy to run.
export const getMissingRuleKinds: (policy: OnCallPolicyRecord) => {
  incident: boolean;
  alert: boolean;
} = (
  policy: OnCallPolicyRecord,
): {
  incident: boolean;
  alert: boolean;
} => {
  return {
    incident: policy.incidentRuleCount === 0,
    alert: policy.alertRuleCount === 0,
  };
};

/*
 * STEP 3: WHAT IF NOBODY ANSWERS.
 */
export enum NoAnswerChoice {
  Escalate = "escalate",
  Repeat = "repeat",
  Nothing = "nothing",
}

/*
 * The minutes a level waits: a whole number from 1 to a day. Null when the
 * text is not one.
 */
export const MAX_WAIT_IN_MINUTES: number = 24 * 60;

export const parseWaitMinutes: (input: string) => number | null = (
  input: string,
): number | null => {
  const text: string = (input || "").trim();

  if (!WHOLE_NUMBER_PATTERN.test(text)) {
    return null;
  }

  const minutes: number = Number(text);

  return minutes >= 1 && minutes <= MAX_WAIT_IN_MINUTES ? minutes : null;
};

// How many more times the page starts again: a whole number from 1 to 10.
export const MAX_REPEAT_TIMES: number = 10;

export const parseRepeatTimes: (input: string) => number | null = (
  input: string,
): number | null => {
  const text: string = (input || "").trim();

  if (!WHOLE_NUMBER_PATTERN.test(text)) {
    return null;
  }

  const times: number = Number(text);

  return times >= 1 && times <= MAX_REPEAT_TIMES ? times : null;
};

/*
 * The choice the step starts on: someone else when a second escalation rule
 * may be added, the same people again when it may not (Cloud's Free plan).
 */
export const getDefaultNoAnswerChoice: (data: {
  maySecondLevel: boolean;
}) => NoAnswerChoice = (data: { maySecondLevel: boolean }): NoAnswerChoice => {
  return data.maySecondLevel ? NoAnswerChoice.Escalate : NoAnswerChoice.Repeat;
};

/*
 * THE SUMMARY: every claim read from the records.
 */
export interface OnCallSummaryFacts {
  policy: OnCallPolicyRecord;
  responders: ReadonlyArray<ResponderReach>;
  breaks: ReadonlyArray<WhoIsToldBreak>;
  testResultSentence: string | null;
  testResult: OnCallTestPageResult | null;
  /*
   * The setup made this policy, with the rules that run it for every new
   * incident and alert. A policy the project had is run by its own rules,
   * which may match only some incidents: the summary says so, not "any".
   */
  isCatchAll: boolean;
}

export interface OnCallSummaryRow {
  key: string;
  label: string;
  text: string;
}

// "Ana Lopez (Email, SMS)": a person and how a page reaches them.
export const describeResponder: (
  translator: Translator,
  person: ResponderReach,
) => string = (translator: Translator, person: ResponderReach): string => {
  if (!person.isReachable || person.channels.length === 0) {
    return translator.translateTemplate("{{name}} (not reachable yet)", {
      name: person.name,
    });
  }

  return translator.translateTemplate("{{name}} ({{channels}})", {
    name: person.name,
    channels: person.channels
      .map((channel: string): string => {
        return getChannelName(channel as OnCallPageChannel, translator);
      })
      .join(", "),
  });
};

// Who the first level pages, each with how, or its names when not known.
export const describeFirstLevel: (
  translator: Translator,
  data: {
    level: PolicyLevel | undefined;
    responders: ReadonlyArray<ResponderReach>;
  },
) => string = (
  translator: Translator,
  data: {
    level: PolicyLevel | undefined;
    responders: ReadonlyArray<ResponderReach>;
  },
): string => {
  if (!data.level) {
    return "";
  }

  const parts: Array<string> = [];
  const described: Set<string> = new Set<string>();

  // Only the first level's people: a later level is said on its own row.
  for (const person of getFirstLevelPeople({
    level: data.level,
    responders: data.responders,
  })) {
    parts.push(describeResponder(translator, person));
    described.add(person.name);
  }

  // Teams and schedules are named as they are; people already described are not.
  for (const name of data.level.names) {
    if (!described.has(name)) {
      parts.push(name);
    }
  }

  return parts.join(", ");
};

export const getOnCallSummaryRows: (
  translator: Translator,
  facts: OnCallSummaryFacts,
) => Array<OnCallSummaryRow> = (
  translator: Translator,
  facts: OnCallSummaryFacts,
): Array<OnCallSummaryRow> => {
  const rows: Array<OnCallSummaryRow> = [];
  const policy: OnCallPolicyRecord = facts.policy;
  const first: PolicyLevel | undefined = policy.levels[0];
  const second: PolicyLevel | undefined = policy.levels[1];
  const people: string = describeFirstLevel(translator, {
    level: first,
    responders: facts.responders,
  });

  let firstText: string;

  if (!first || !people) {
    firstText =
      translator.translateTemplate(
        'The on-call policy "{{policy}}" pages nobody yet.',
        { policy: policy.name },
      ) || "";
  } else if (
    !facts.isCatchAll &&
    (policy.incidentRuleCount > 0 || policy.alertRuleCount > 0)
  ) {
    firstText = translator.translateTemplate(
      ON_CALL_SETUP_COPY.summaryExistingRules,
      { policy: policy.name, people: people },
    );
  } else if (policy.incidentRuleCount > 0 && policy.alertRuleCount > 0) {
    firstText = translator.translateTemplate(
      'Any new incident or alert runs "{{policy}}", which pages {{people}}.',
      { policy: policy.name, people: people },
    );
  } else if (policy.incidentRuleCount > 0) {
    firstText = translator.translateTemplate(
      'Any new incident runs "{{policy}}", which pages {{people}}. Alerts page nobody.',
      { policy: policy.name, people: people },
    );
  } else {
    firstText = translator.translateTemplate(
      '"{{policy}}" pages {{people}}, once an on-call rule runs it.',
      { policy: policy.name, people: people },
    );
  }

  rows.push({
    key: "first",
    label: translator.translateText(ON_CALL_SETUP_COPY.summaryFirst) || "",
    text: firstText,
  });

  let noAnswerText: string;

  if (first && second && second.names.length > 0) {
    noAnswerText = translator.translatePlural(
      {
        one: "If nobody acknowledges within {{count}} minute, {{people}} is paged.",
        other:
          "If nobody acknowledges within {{count}} minutes, {{people}} is paged.",
      },
      first.escalateAfterInMinutes,
      { people: second.names.join(", ") },
    );
  } else if (first && policy.repeatTimes > 0) {
    noAnswerText = translator.translatePlural(
      {
        one: "If nobody acknowledges within {{count}} minute, the page starts again ({{times}} more times at most).",
        other:
          "If nobody acknowledges within {{count}} minutes, the page starts again ({{times}} more times at most).",
      },
      first.escalateAfterInMinutes,
      { times: translator.formatNumber(policy.repeatTimes) },
    );
  } else {
    noAnswerText =
      translator.translateText(ON_CALL_SETUP_COPY.nobodyElse) ||
      ON_CALL_SETUP_COPY.nobodyElse;
  }

  rows.push({
    key: "no_answer",
    label: translator.translateText(ON_CALL_SETUP_COPY.summaryNoAnswer) || "",
    text: noAnswerText,
  });

  rows.push({
    key: "tested",
    label: translator.translateText(ON_CALL_SETUP_COPY.summaryTested) || "",
    text:
      facts.testResult?.status === OnCallTestPageStatus.Acknowledged &&
      facts.testResultSentence
        ? facts.testResultSentence
        : translator.translateText(ON_CALL_SETUP_COPY.summaryNotTested) || "",
  });

  return rows;
};
