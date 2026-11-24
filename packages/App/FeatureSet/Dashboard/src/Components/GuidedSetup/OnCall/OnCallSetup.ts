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
  OnCallTestPagePreview,
  OnCallTestPagePreviewMethod,
  OnCallTestPageResult,
  OnCallTestPageStatus,
  OnCallTestPageWarning,
  OnCallTestPageWarningCode,
} from "Common/Types/OnCallDutyPolicy/OnCallTestPage";
import { DEFAULT_ESCALATE_AFTER_IN_MINUTES } from "Common/Types/OnCallDutyPolicy/EscalationRuleDefaults";
import {
  MAX_LEVEL_WAIT_IN_MINUTES,
  MAX_POLICY_REPEAT_TIMES,
} from "Common/Utils/GuidedSetup/OnCallPolicyRecords";
import {
  PluralTemplate,
  Translator,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import { formatProjectBalanceAmount } from "Common/Utils/Project/ProjectBalance";
import { toListOrderNumber } from "Common/Utils/ListOrder";
import { getChannelName } from "../../Monitor/Overview/WhoIsToldWords";
import { CHANNEL_NAMES } from "../../OnCallTestPage/OnCallTestPageWords";
import { formatNameList } from "../../AiAccess/AiAccessModes";
import { joinList } from "Common/UI/Utils/ListSeparator";

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
 *   2. Who is paged first? A project with no policy gets "Default on-call
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
  reachOutcome: string;
  whoOutcome: string;
  noAnswerOutcome: string;
  testOutcome: string;
  reachTitle: string;
  reachHelp: string;
  emailRow: string;
  phoneRow: string;
  pushRow: string;
  emailNone: string;
  phoneNone: string;
  pushNone: string;
  pushHelp: string;
  useThisBrowser: string;
  getTheApp: string;
  appRecheckHint: string;
  browserRegistered: string;
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
  whoNextHint: string;
  inviteByEmail: string;
  inviteEmailLabel: string;
  inviteDescription: string;
  inviteSend: string;
  inviteCancel: string;
  inviteEmailError: string;
  invited: string;
  inviteNoTeam: string;
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
  policyDeleted: string;
  policyArchived: string;
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
    "Guided setup: how you are reached, who is paged first, what happens if nobody answers, and a test page, on this page.",
  ),
  /*
   * What each step sets up, beside the steps (GuidedSetupFrame, #8897): the
   * outcome the person is working towards, ticked as each step is done.
   */
  reachOutcome: translationKey(
    "A page reaches you by every method you verified.",
  ),
  whoOutcome: translationKey(
    "An on-call policy pages the right people for every new incident and alert.",
  ),
  noAnswerOutcome: translationKey(
    "If nobody answers in time, the page goes further.",
  ),
  testOutcome: translationKey(
    "A test page proves that the policy reaches people.",
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
  /*
   * Push is set up in the step itself (#7149): this browser, registered from
   * the person's click, or the app, from a code to scan. It linked to
   * Notification Methods before.
   */
  pushHelp: translationKey(
    "Get pages on your phone with the OneUptime On-Call app, or in this browser.",
  ),
  useThisBrowser: translationKey("Use this browser"),
  getTheApp: translationKey("Get the app"),
  appRecheckHint: translationKey(
    "Once the app is signed in on your phone, click Recheck.",
  ),
  // As Notification Methods says it once a browser is registered.
  browserRegistered: translationKey("Browser Registered"),
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
    "A Project Owner or someone with Manage Billing can add balance in Project Settings → Notifications → Notification Channels.",
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
  /*
   * Who the policy's first escalation rule pages, at once. It was "Who else
   * is on call?", which read as the place to add the teammate to page when
   * nobody answers: a newcomer added them here, and both were paged at the
   * same moment (#7372). That teammate is the next step's.
   */
  whoTitle: translationKey("Who is paged first?"),
  whoNextHint: translationKey(
    "Everyone here is paged at the same time. Someone to page only if nobody answers comes in the next step.",
  ),
  /*
   * Someone not in the project yet, invited from the step (#7150): the
   * Users page's Invite User, by address, on the team it starts on. Nothing
   * said depends on whether the address has an account.
   */
  inviteByEmail: translationKey("Invite by email"),
  inviteEmailLabel: translationKey("Their email address"),
  inviteDescription: translationKey(
    "We email them an invitation to this project and add them here. A page reaches them once they accept and set up how they are reached.",
  ),
  inviteSend: translationKey("Send invitation"),
  inviteCancel: translationKey("Cancel"),
  inviteEmailError: translationKey(
    "Enter an email address, such as ana@example.com.",
  ),
  invited: translationKey("{{email}} is invited and added here."),
  inviteNoTeam: translationKey(
    "No team could be picked for them here. Invite them from Users, where you choose their team.",
  ),
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
    "Setting up an on-call policy needs permission you do not have in this project. Ask a Project Owner or Project Admin to set it up; your own notification methods are ready above.",
  ),
  /*
   * Said when Save and continue finds a policy another tab or device made
   * since the step opened: the step turns to the project's policies, and
   * nothing was made twice (#7252). The website-down setup's words.
   */
  policyMadeElsewhere: WEBSITE_DOWN_COPY.policyMadeElsewhere,
  /*
   * Said when the run's policy was deleted - in another tab, or by a
   * teammate - so "Who is paged first?" opened again on making or picking
   * one (#7516), and when the page opens on a run whose policy is gone.
   */
  policyDeleted: translationKey(
    "The on-call policy this setup was using was deleted, so pick or make one again.",
  ),
  /*
   * Said when the run's policy was archived since - in another tab, or by a
   * teammate. An archived policy is still there, but pages no one, so the
   * run forgets it as it forgets a deleted one, and says which (#8432).
   */
  policyArchived: translationKey(
    "The on-call policy this setup was using was archived, so it pages no one. Pick or make one again.",
  ),
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
/*
 * WHAT THE SETUP MAKES, AS ITS PANEL LISTS IT (#10276), by the step that
 * makes it: how the person is reached (their notification methods, and a
 * phone number added here), the policy with its first escalation rule and
 * the on-call rules that run it, what happens when nobody answers, and the
 * test page.
 */
export enum OnCallResource {
  NotificationMethods = "notification_methods",
  PhoneNumber = "phone_number",
  OnCallPolicy = "on_call_policy",
  EscalationRule = "escalation_rule",
  OnCallRules = "on_call_rules",
  NoAnswer = "no_answer",
  TestPage = "test_page",
}

export const ON_CALL_RESOURCE_COPY: {
  notificationMethods: string;
  phoneNumber: string;
  waitingForCode: string;
  saved: string;
  whenNobodyAnswers: string;
  whoDescription: string;
  noAnswerDescription: string;
  testDescription: string;
} = {
  notificationMethods: translationKey("Notification methods"),
  phoneNumber: translationKey("Phone number"),
  waitingForCode: translationKey("Waiting for the code"),
  saved: translationKey("Saved"),
  whenNobodyAnswers: translationKey("When nobody answers"),
  // Why each step is there, under its title until it is reached.
  whoDescription: translationKey(
    "Pick who is paged first, so every incident reaches someone.",
  ),
  noAnswerDescription: translationKey(
    "Choose what happens when nobody answers the page in time.",
  ),
  testDescription: translationKey(
    "A test page proves a page reaches the people on call before a real incident does.",
  ),
};

/*
 * A phone number as the panel names it, kept with the run: its last four
 * digits, as Notification Methods shows a number ("•••0123").
 */
export const maskPhoneNumber: (phone: string) => string = (
  phone: string,
): string => {
  const digits: string = phone.replace(/\D/g, "");

  return digits.length > 4 ? `•••${digits.slice(-4)}` : phone;
};

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

/*
 * What the run keeps of its policy and of the steps built on it. When the
 * policy is gone - found so when the page opens, or deleted in another tab
 * or by a teammate while it is open (#7516) - they are forgotten together,
 * so the setup starts again at "Who is paged first?". Who is reached stays
 * confirmed: it is the person's, not the policy's.
 */
export const RUN_VALUES_OF_THE_POLICY: ReadonlyArray<OnCallRunValue> = [
  OnCallRunValue.PolicyId,
  OnCallRunValue.PolicyIsExisting,
  OnCallRunValue.NoAnswerDone,
  OnCallRunValue.TestExecutionLogId,
  OnCallRunValue.TestSkipped,
];

// The values to save to forget the run's policy (GuidedSetupRunStore.save).
export const getRunWithoutPolicy: () => Record<string, null> = (): Record<
  string,
  null
> => {
  const values: Record<string, null> = {};

  for (const value of RUN_VALUES_OF_THE_POLICY) {
    values[value] = null;
  }

  return values;
};

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
   * Self-hosted: whether an SMS or a call can go anywhere - the project's
   * own Twilio config, or the server's account or gateway - as any member
   * of the project reads it (GET /project-can-send, #7151), or a master
   * admin's sending status while that is not read. Null when not known;
   * always yes on OneUptime Cloud.
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

/*
 * One escalation rule of a policy, with who it pages, by name. A policy's
 * levels are in the order the policy pages them, and the setup knows a
 * level by its place among them.
 */
export interface PolicyLevel {
  id: string;
  /*
   * The rule's number as it is saved, or null when it has none: never one
   * made up for it, which could be another rule's (issue #9655).
   */
  order: number | null;
  escalateAfterInMinutes: number;
  userIds: Array<string>;
  // People's, teams' and schedules' names, in that order.
  names: Array<string>;
  responderCount: number;
}

// An escalation rule as the setup reads it.
export interface PolicyLevelRule {
  id?: { toString: () => string } | null | undefined;
  order?: number | null | undefined;
  escalateAfterInMinutes?: number | null | undefined;
}

/*
 * A policy's levels, from its escalation rules as the API reads them: in
 * the policy's order (by number, a rule without one last), each with no one
 * on it yet. A rule numbered 0, or with no number, keeps that: it used to
 * be given its place in the read plus one, which could be another rule's.
 */
export const toPolicyLevels: (
  rules: ReadonlyArray<PolicyLevelRule>,
) => Array<PolicyLevel> = (
  rules: ReadonlyArray<PolicyLevelRule>,
): Array<PolicyLevel> => {
  return rules
    .filter((rule: PolicyLevelRule): boolean => {
      return Boolean(rule.id);
    })
    .map((rule: PolicyLevelRule): PolicyLevel => {
      return {
        id: rule.id!.toString(),
        order: toListOrderNumber(rule.order),
        escalateAfterInMinutes:
          typeof rule.escalateAfterInMinutes === "number"
            ? rule.escalateAfterInMinutes
            : DEFAULT_ESCALATE_AFTER_IN_MINUTES,
        userIds: [],
        names: [],
        responderCount: 0,
      };
    });
};

export interface OnCallPolicyRecord {
  id: string;
  name: string;
  levels: Array<PolicyLevel>;
  repeatTimes: number;
  // Enabled on-call rules that name this policy.
  incidentRuleCount: number;
  alertRuleCount: number;
  /*
   * Archived since the run set it up - in another tab, or by a teammate:
   * it pages no one, so the run forgets it (#8432). Unset is in service.
   */
  isArchived?: boolean | undefined;
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
 * The minutes a level waits: a whole number from 1 to a day, as Ask AI's
 * set_up_paging takes it too (Common's OnCallPolicyRecords). Null when the
 * text is not one.
 */
export const MAX_WAIT_IN_MINUTES: number = MAX_LEVEL_WAIT_IN_MINUTES;

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
export const MAX_REPEAT_TIMES: number = MAX_POLICY_REPEAT_TIMES;

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
  /*
   * The order a page reaches each person, by user id (getReachOrders), when
   * it was read: the first row says it (#7154). Absent, it names how.
   */
  reachOrders?: ReachOrders | null | undefined;
}

export interface OnCallSummaryRow {
  key: string;
  label: string;
  text: string;
}

/*
 * THE ORDER A PAGE REACHES A PERSON (#7154): "SMS at once, then phone
 * call after 5 minutes". It is each person's own How to Reach Me for the
 * test's first severity, as the test page's preview reads it on the server
 * (OnCallTestPageApi.preview, sortRulesAsAPageReachesThem): the same rules,
 * the same order, the same fallback - never worked out a second time here.
 */
export interface ReachStep {
  channel: string;
  notifyAfterMinutes: number;
}

// The steps a page takes to each person a policy's first level pages, by user id.
export type ReachOrders = Record<string, Array<ReachStep>>;

export const REACH_AT_ONCE: string = translationKey("{{methods}} at once");

export const REACH_AFTER: PluralTemplate = {
  one: "{{methods}} after {{count}} minute",
  other: "{{methods}} after {{count}} minutes",
};

export const REACH_THEN: string = translationKey("{{first}}, then {{next}}");

/*
 * The steps of a test page's preview that would reach each person: a
 * method that is verified, on a channel the project has not turned off. A
 * person who opted out of the severity is reached by nothing.
 */
export const getReachOrders: (preview: OnCallTestPagePreview) => ReachOrders = (
  preview: OnCallTestPagePreview,
): ReachOrders => {
  const orders: ReachOrders = {};

  for (const person of preview.people || []) {
    const channelsOff: Array<string> = (person.warningCodes || [])
      .filter((warning: OnCallTestPageWarning): boolean => {
        return (
          warning.code === OnCallTestPageWarningCode.ChannelOff &&
          Boolean(warning.channel)
        );
      })
      .map((warning: OnCallTestPageWarning): string => {
        return String(warning.channel);
      });

    orders[person.userId] = person.isOptedOut
      ? []
      : (person.methods || [])
          .filter((method: OnCallTestPagePreviewMethod): boolean => {
            return (
              method.isVerified && !channelsOff.includes(String(method.channel))
            );
          })
          .map((method: OnCallTestPagePreviewMethod): ReachStep => {
            return {
              channel: String(method.channel),
              notifyAfterMinutes: Math.max(
                0,
                Number(method.notifyAfterMinutes) || 0,
              ),
            };
          });
  }

  return orders;
};

/*
 * The steps gathered by when they are taken, soonest first: methods with
 * the same wait are taken together, each named once.
 */
export const groupReachSteps: (
  steps: ReadonlyArray<ReachStep>,
) => Array<{ notifyAfterMinutes: number; channels: Array<string> }> = (
  steps: ReadonlyArray<ReachStep>,
): Array<{ notifyAfterMinutes: number; channels: Array<string> }> => {
  const groups: Array<{ notifyAfterMinutes: number; channels: Array<string> }> =
    [];

  const ordered: Array<ReachStep> = steps
    .map(
      (step: ReachStep, index: number): { step: ReachStep; index: number } => {
        return { step: step, index: index };
      },
    )
    .sort(
      (
        a: { step: ReachStep; index: number },
        b: { step: ReachStep; index: number },
      ): number => {
        return (
          a.step.notifyAfterMinutes - b.step.notifyAfterMinutes ||
          a.index - b.index
        );
      },
    )
    .map((entry: { step: ReachStep; index: number }): ReachStep => {
      return entry.step;
    });

  for (const step of ordered) {
    const last:
      | { notifyAfterMinutes: number; channels: Array<string> }
      | undefined = groups[groups.length - 1];

    if (last && last.notifyAfterMinutes === step.notifyAfterMinutes) {
      if (!last.channels.includes(step.channel)) {
        last.channels.push(step.channel);
      }

      continue;
    }

    groups.push({
      notifyAfterMinutes: step.notifyAfterMinutes,
      channels: [step.channel],
    });
  }

  return groups;
};

// "SMS and email": the channels of one step, cased for the middle of a sentence.
const describeReachChannels: (
  translator: Translator,
  channels: ReadonlyArray<string>,
) => string = (
  translator: Translator,
  channels: ReadonlyArray<string>,
): string => {
  return formatNameList(
    channels.map((channel: string): string => {
      const name: string =
        CHANNEL_NAMES[channel as OnCallPageChannel] || channel;

      return translator.translateTerm(name, { inSentence: true }) || name;
    }),
    "and",
    translator,
  );
};

/*
 * "SMS at once, then phone call after 5 minutes", or "" for no steps: the
 * order a page reaches a person, in the reader's language.
 */
export const describeReachOrder: (
  translator: Translator,
  steps: ReadonlyArray<ReachStep>,
) => string = (
  translator: Translator,
  steps: ReadonlyArray<ReachStep>,
): string => {
  let text: string = "";

  for (const group of groupReachSteps(steps)) {
    const methods: string = describeReachChannels(translator, group.channels);
    const groupText: string =
      group.notifyAfterMinutes === 0
        ? translator.translateTemplate(REACH_AT_ONCE, { methods: methods })
        : translator.translatePlural(REACH_AFTER, group.notifyAfterMinutes, {
            methods: methods,
          });

    text = text
      ? translator.translateTemplate(REACH_THEN, {
          first: text,
          next: groupText,
        })
      : groupText;
  }

  return text;
};

/*
 * "Ana Lopez (Email, SMS)": a person and how a page reaches them - or, with
 * the order a page takes (#7154), "Ana Lopez (SMS at once, then phone call
 * after 5 minutes)".
 */
export const describeResponder: (
  translator: Translator,
  person: ResponderReach,
  steps?: ReadonlyArray<ReachStep> | undefined,
) => string = (
  translator: Translator,
  person: ResponderReach,
  steps?: ReadonlyArray<ReachStep> | undefined,
): string => {
  if (!person.isReachable || person.channels.length === 0) {
    return translator.translateTemplate("{{name}} (not reachable yet)", {
      name: person.name,
    });
  }

  const order: string = steps ? describeReachOrder(translator, steps) : "";

  // The channels' names, joined with the reader's comma ("، " in Persian).
  return translator.translateTemplate("{{name}} ({{channels}})", {
    name: person.name,
    channels:
      order ||
      joinList(
        person.channels.map((channel: string): string => {
          return getChannelName(channel as OnCallPageChannel, translator);
        }),
      ),
  });
};

// Who the first level pages, each with how, or its names when not known.
export const describeFirstLevel: (
  translator: Translator,
  data: {
    level: PolicyLevel | undefined;
    responders: ReadonlyArray<ResponderReach>;
    reachOrders?: ReachOrders | null | undefined;
  },
) => string = (
  translator: Translator,
  data: {
    level: PolicyLevel | undefined;
    responders: ReadonlyArray<ResponderReach>;
    reachOrders?: ReachOrders | null | undefined;
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
    parts.push(
      describeResponder(translator, person, data.reachOrders?.[person.userId]),
    );
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
    reachOrders: facts.reachOrders,
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
