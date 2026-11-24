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
  MonitorCheckingFacts,
  WebsiteAddress,
  WebsiteMonitorSeeds,
  buildWebsiteMonitor as buildGuidedWebsiteMonitor,
  getMonitorAddress,
  getWebsiteAddressIdentity,
  isMonitorCheckingAddress,
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
  PluralTemplate,
  Translator,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import PageMap from "../../../Utils/PageMap";
import { getProbeFailureCauseText } from "Common/Utils/Monitor/ProbeFailureReading";
import { joinSentences } from "Common/UI/Components/DeleteConfirmation/DeleteConsequences";
import { recordNameInSentence } from "Common/Utils/DefaultRecordNames";
import { StateListType } from "Common/Utils/StateOrder";
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
 *      which opens an incident once its probes agree). The step says from
 *      how many locations before anything is made: the probes a new monitor
 *      starts with (#7461). The monitor's probes check it at once, and
 *      their answers are said in a sentence, with what they mean under the
 *      probe agreement rule (#7410). An address one of this person's
 *      monitors already checks makes no second monitor: the setup goes on
 *      with theirs, and says so (#7059) - whatever the browser kept of the
 *      run. An address a teammate's monitor checks - or one the API,
 *      Terraform or an import made - is said too, before anything is made,
 *      with the way to open it or to make one's own (#7254): only a monitor
 *      the person may read, and never taken over. On Cloud's Free plan with
 *      no payment method, the step says so before Start checking, with
 *      where to add one: the server refuses the monitor without it (#7367).
 *   2. Who should be told? A project with no on-call policy gets one,
 *      paging the people picked - "You", to start with - for every new
 *      incident and alert (FirstResponders, EveryNewEventRules). A project
 *      that pages people already keeps its own policies and rules. Either
 *      way the person owns the monitor the setup goes on with, so they are
 *      emailed when its status changes: the creator of an operational
 *      resource is made its owner, and the setup makes them one when the
 *      server does not - a master admin, whom it never makes the owner of
 *      what they create (#7409). The step says so only when they are. Its
 *      "How to Reach Me" opens the person's own, in a new tab (#7757).
 *   3. Send a test: a test page to themselves (#6811), acknowledged from
 *      the message.
 *   4. Show it to customers? Optional (#7053): for someone who may put a
 *      monitor on a status page, in a project that has one, the monitor is
 *      added to the page picked, or "Not now". A project with no status
 *      page yet is offered the status page guided setup in the summary
 *      instead, so a newcomer's job is not one step longer.
 *
 * Then the summary, read from the records, and what to do next: the on-call
 * guided setup for paging by SMS or phone, for whoever may use it (#7370).
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
  // Optional, and only where it can be done (#7053): getWebsiteDownProgress.
  StatusPage = "status_page",
}

// The steps every run walks.
export const WEBSITE_DOWN_STEPS: ReadonlyArray<WebsiteDownStep> = [
  WebsiteDownStep.Check,
  WebsiteDownStep.WhoIsTold,
  WebsiteDownStep.Test,
];

/*
 * The step a run walks after them where it can be done (#7053): someone
 * who may put a monitor on a status page, in a project with a status page
 * to put it on.
 */
export const WEBSITE_DOWN_OPTIONAL_STEPS: ReadonlyArray<WebsiteDownStep> = [
  WebsiteDownStep.StatusPage,
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
  getMonitorAddress,
  getWebsiteAddressIdentity,
  getWhoIsToldMode,
  isMonitorCheckingAddress,
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
  checkOutcome: string;
  whoOutcome: string;
  testOutcome: string;
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
  otherMonitor: string;
  otherMonitorMadeBy: string;
  otherMonitorChoice: string;
  createOwnMonitor: string;
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
  policyDeleted: string;
  policyArchived: string;
  whoOwnerOnlyHelp: string;
  whoOwnerOnlyHelpNotOwner: string;
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
  statusPageTitle: string;
  statusPageOutcome: string;
  statusPageHelp: string;
  statusPageLabel: string;
  statusPageAdd: string;
  statusPageNotNow: string;
  statusPageShown: string;
  summaryTitle: string;
  summaryChecked: string;
  summaryWhenDown: string;
  summaryWhoIsTold: string;
  summaryTested: string;
  summaryNotTested: string;
  summaryNext: string;
  nextStatusPage: string;
  nextOpenStatusPage: string;
  nextPhone: string;
  nextMonitor: string;
  startOver: string;
  couldNotSave: string;
  createMonitorOffer: string;
  guidedSetup: string;
} = {
  pageTitle: translationKey("Know when my website or API is down"),
  pageDescription: translationKey(
    "Guided setup: check an address, choose who is told, and send a test, on this page.",
  ),
  /*
   * What each step sets up, beside the steps (GuidedSetupFrame, #8897): the
   * outcome the person is working towards, ticked as each step is done.
   */
  checkOutcome: translationKey(
    "OneUptime checks your website or API around the clock.",
  ),
  whoOutcome: translationKey("The right people are told when it goes down."),
  testOutcome: translationKey("A test page proves that a page reaches them."),
  checkTitle: translationKey("What should we check?"),
  /*
   * A new monitor's probes must all agree before its status changes (its
   * minimumProbeAgreement is not set: ProbeAgreementRule), so one location
   * that fails opens nothing. "Several locations" was not true of a
   * self-hosted server with one probe (#7410, #7461). Said when how many
   * locations would check it cannot be read; CHECK_HELP_FROM_LOCATIONS
   * says the number when it can. {{monitor}} and {{incident}} are the
   * Glossary's words, marked where the setup first uses them (#7057).
   */
  checkHelp: translationKey(
    "OneUptime makes a {{monitor}} that checks it every 5 minutes. An {{incident}} opens when every location that checks it finds it down: no answer, or an answer with an error.",
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
    "This project is on the Free plan, where a monitor that checks your site is billed as you use it, at {{price}} per monitor per month. Ask a Project Owner to add a payment method before you start checking.",
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
  /*
   * Said, before anything is made, when a monitor this person may read but
   * did not make checks the address: a teammate's, or one the API,
   * Terraform or an import made (#7254). It is never taken over - step 2
   * and the test would change what it does for whoever made it (#7190) -
   * so the person opens it, or makes their own. Who made it is said when
   * the records name a person.
   */
  otherMonitor: translationKey(
    'The monitor "{{name}}" already checks this address.',
  ),
  otherMonitorMadeBy: translationKey(
    'The monitor "{{name}}" already checks this address. {{person}} made it.',
  ),
  otherMonitorChoice: translationKey(
    "Open it to see who it tells, or create your own to go on with this setup.",
  ),
  createOwnMonitor: translationKey("Create my own monitor"),
  continueButton: translationKey("Continue"),
  cannotCreateMonitor: translationKey(
    "Creating a monitor needs permission you do not have in this project. Ask a Project Admin to give it to you, or to set this up.",
  ),
  whoTitle: translationKey("Who should be told?"),
  /*
   * {{howToReachMe}} is a link to the person's own How to Reach Me, in a
   * new tab so the setup keeps its place (#7757): it was named as a place
   * nobody could find.
   */
  whoCreateHelp: translationKey(
    "When it goes down, OneUptime opens an incident and pages these people, each the way their {{howToReachMe}} says. It starts with you, by email.",
  ),
  // {{onCallPolicy}} is the Glossary's word (#7057).
  whoCreatePolicyNote: translationKey(
    'This makes the {{onCallPolicy}} "{{policy}}", which pages them for every new incident and alert in this project.',
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
   * Said when the on-call policy this setup made was deleted - in another
   * tab, or by a teammate - so "Who should be told?" opened again (#8235),
   * and when the page opens on a run whose policy is gone. The setup only
   * ever makes its policy, never picks one, so it says to choose who is
   * told: making a policy again, or the project's own deciding.
   */
  policyDeleted: translationKey(
    "The on-call policy this setup made was deleted, so choose who is told again.",
  ),
  /*
   * Said when the on-call policy this setup made was archived since - in
   * another tab, or by a teammate - so "Who should be told?" opened again
   * (#8432), and when the page opens on a run whose policy is archived. An
   * archived policy is still there, but pages no one.
   */
  policyArchived: translationKey(
    "The on-call policy this setup made was archived, so it pages no one. Choose who is told again.",
  ),
  /*
   * Creating an on-call policy, its escalation rule and its two rules is not
   * an admin's alone: project members and on-call members may too. Who
   * cannot is pointed at the ones who always can, as the on-call setup's
   * whoCannotCreate does.
   */
  whoOwnerOnlyHelp: translationKey(
    "You own this monitor, so you are emailed when it goes down. Paging a team needs an on-call policy: ask a Project Owner or Project Admin to set one up.",
  ),
  whoOwnerOnlyHelpNotOwner: translationKey(
    "You do not own this monitor, so you are not emailed when it goes down: add yourself on its Owners page. Paging a team needs an on-call policy: ask a Project Owner or Project Admin to set one up.",
  ),
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
  /*
   * STEP 4, SHOW IT TO CUSTOMERS? (#7053): optional, and only where it can
   * be done - someone who may put a monitor on a status page, in a project
   * with a status page to put it on.
   */
  statusPageTitle: translationKey("Show it to customers?"),
  statusPageOutcome: translationKey("Your customers see it on a status page."),
  statusPageHelp: translationKey(
    'Add "{{name}}" to a status page, so your customers see when it is down.',
  ),
  statusPageLabel: translationKey("Status page"),
  statusPageAdd: translationKey("Add to status page"),
  // The telemetry setup's word for a step left for later.
  statusPageNotNow: translationKey("Not now"),
  statusPageShown: translationKey(
    '"{{statusPage}}" shows it to your customers.',
  ),
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
  // The status page setup's own words for its public link.
  nextOpenStatusPage: translationKey("Open the status page"),
  nextPhone: translationKey("Get paged by SMS or phone call"),
  nextMonitor: translationKey("Open the monitor"),
  startOver: translationKey("Check another address"),
  couldNotSave: translationKey(
    "That did not save. Check your connection and try again.",
  ),
  /*
   * Create Monitor, with Website or API picked (#7054): the whole job is
   * one guided setup away, for whoever may create a monitor.
   */
  createMonitorOffer: translationKey(
    "Only need to know when it is down? The guided setup checks the address, picks who is told and sends you a test, on one page.",
  ),
  // The setup page's breadcrumb, as a product's onboarding names its setup.
  guidedSetup: translationKey("Guided setup"),
};

/*
 * WHAT THE SETUP MAKES, AS ITS PANEL LISTS IT (#10276): each record by the
 * step that makes it, with how it is getting on (GuidedSetupResources).
 * Step 2 makes the project's first on-call policy in one request, with its
 * first escalation rule and the two on-call rules that run it for every new
 * incident and alert (OnCallDutyPolicyService.create), so the three are
 * made, or fail, together. A project that pages people already makes none:
 * its own policies are in use.
 */
export enum WebsiteDownResource {
  Monitor = "monitor",
  OnCallPolicy = "on_call_policy",
  EscalationRule = "escalation_rule",
  OnCallRules = "on_call_rules",
  ExistingPolicies = "existing_policies",
  TestPage = "test_page",
  StatusPage = "status_page",
}

export const WEBSITE_DOWN_RESOURCE_COPY: {
  monitor: string;
  onCallPolicy: string;
  escalationRule: string;
  onCallRules: string;
  existingPolicies: string;
  testPage: string;
  statusPage: string;
  sent: string;
  acknowledged: string;
  escalationRuleDetail: string;
  onCallRulesDetail: string;
  existingPoliciesDetail: string;
  whoDescription: string;
  testDescription: string;
  statusPageDescription: string;
} = {
  monitor: translationKey("Monitor"),
  onCallPolicy: translationKey("On-call policy"),
  escalationRule: translationKey("Escalation rule"),
  onCallRules: translationKey("On-call rules"),
  existingPolicies: translationKey("Your on-call policies"),
  testPage: translationKey("Test page"),
  statusPage: translationKey("Status page"),
  sent: translationKey("Sent"),
  acknowledged: translationKey("Acknowledged"),
  escalationRuleDetail: translationKey("Pages {{people}} first."),
  onCallRulesDetail: translationKey(
    "Run the policy for every new incident and alert.",
  ),
  existingPoliciesDetail: translationKey(
    "The project's own policies and rules decide who is paged.",
  ),
  // Why each step is there, under its title until it is reached.
  whoDescription: translationKey(
    "Pick who is paged when it goes down, so nobody has to keep watching it.",
  ),
  testDescription: translationKey(
    "A test page proves an alert reaches you before a real outage does.",
  ),
  statusPageDescription: translationKey(
    "Your customers see that it is up, or that you are on it.",
  ),
};

/*
 * STEP 1'S HELP, WITH HOW MANY LOCATIONS (#7461): the probes a new monitor
 * starts with (MonitorProbeSelectionUtil, as Create Monitor reads them),
 * read before it is made. All of them must find it down before an incident
 * opens: a new monitor sets no minimum (ProbeAgreementRule).
 */
export const CHECK_HELP_FROM_LOCATIONS: PluralTemplate = {
  one: "OneUptime makes a {{monitor}} that checks it every 5 minutes from {{count}} location. An {{incident}} opens when that location finds it down: no answer, or an answer with an error.",
  other:
    "OneUptime makes a {{monitor}} that checks it every 5 minutes from {{count}} locations. An {{incident}} opens when all of them find it down: no answer, or an answer with an error.",
};

/*
 * Which of the two step 1 says: the number when it is known and there is a
 * location to say; the sentence with no number otherwise - a read that
 * failed, or a project whose new monitors start with no probe (the first
 * check then says where probes are added).
 */
export const getCheckHelpTemplate: (locationCount: number | null) => {
  template: string | PluralTemplate;
  count?: number | undefined;
} = (
  locationCount: number | null,
): { template: string | PluralTemplate; count?: number | undefined } => {
  if (typeof locationCount === "number" && locationCount > 0) {
    return { template: CHECK_HELP_FROM_LOCATIONS, count: locationCount };
  }

  return { template: WEBSITE_DOWN_COPY.checkHelp };
};

/*
 * The Glossary's words in the setup's sentences (#7057), each a key of its
 * own, worded for the middle of a sentence, as the slots they fill.
 */
export const WEBSITE_DOWN_TERMS: {
  monitor: string;
  incident: string;
  onCallPolicy: string;
  howToReachMe: string;
} = {
  monitor: translationKey("monitor"),
  incident: translationKey("incident"),
  onCallPolicy: translationKey("on-call policy"),
  // A page's name, and the link to it (#7757).
  howToReachMe: translationKey("How to Reach Me"),
};

/*
 * WHEN A MONITOR THIS PERSON DID NOT MAKE CHECKS THE ADDRESS (#7254): its
 * name, set apart from the words so a right-to-left sentence keeps it in
 * order, and who made it when the records name someone.
 */
export const getOtherMonitorSentence: (data: {
  translator: Translator;
  monitorName: string;
  creatorName: string;
}) => string = (data: {
  translator: Translator;
  monitorName: string;
  creatorName: string;
}): string => {
  const creator: string = data.creatorName.trim();

  return creator
    ? data.translator.translateTemplate(
        WEBSITE_DOWN_COPY.otherMonitorMadeBy,
        { name: data.monitorName, person: creator },
        { setsValuesApart: true },
      )
    : data.translator.translateTemplate(
        WEBSITE_DOWN_COPY.otherMonitor,
        { name: data.monitorName },
        { setsValuesApart: true },
      );
};

/*
 * WHERE "GET PAGED BY SMS OR PHONE CALL" LEADS (#7370): the on-call guided
 * setup, which turns SMS and calls on, adds balance on Cloud and verifies
 * the number on one page - for whoever may use it, by the rule On-Call's
 * own "Guided setup" button follows (creating an on-call policy). Anyone
 * else adds a number on Notification Methods, as before.
 */
export const getPagedByPhonePage: (mayUseOnCallSetup: boolean) => PageMap = (
  mayUseOnCallSetup: boolean,
): PageMap => {
  return mayUseOnCallSetup
    ? PageMap.ON_CALL_DUTY_GUIDED_SETUP
    : PageMap.USER_SETTINGS_NOTIFICATION_METHODS;
};

/*
 * STEP 4 (#7053): what it offers, read before the steps are drawn.
 */
export interface WebsiteDownStatusPageChoice {
  id: string;
  name: string;
}

// Whether the run walks step 4: a status page to add it to, and permission.
export const hasStatusPageStep: (data: {
  mayAddToStatusPage: boolean;
  statusPages: ReadonlyArray<WebsiteDownStatusPageChoice>;
}) => boolean = (data: {
  mayAddToStatusPage: boolean;
  statusPages: ReadonlyArray<WebsiteDownStatusPageChoice>;
}): boolean => {
  return data.mayAddToStatusPage && data.statusPages.length > 0;
};

/*
 * Whether the summary offers the status page guided setup, with this
 * monitor ticked (StatusPageGuidedSetup reads `monitorId`): while the run
 * has no step 4 - no status page yet - and only to whoever may make one.
 * Optional, as everything under "What next" is.
 */
export const isStatusPageSetupOffered: (data: {
  hasStatusPageStep: boolean;
  mayCreateStatusPage: boolean;
}) => boolean = (data: {
  hasStatusPageStep: boolean;
  mayCreateStatusPage: boolean;
}): boolean => {
  return !data.hasStatusPageStep && data.mayCreateStatusPage;
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

/*
 * What the setup reads of a monitor, to know whether it checks an address
 * now (#7059): the rule is Common's, where Ask AI's set_up_website_monitoring
 * asks it too (#7292), so neither makes a second monitor for one address.
 */
export type OwnMonitorFacts = MonitorCheckingFacts;

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
        "Project Owners are emailed about incidents nobody owns.",
      ) || "";
};

/*
 * THE RUN: what this pass through the setup made, as GuidedSetupRunStore
 * keeps it.
 */
export enum WebsiteDownRunValue {
  /*
   * What step 1 was asked to check, kept when Start checking is pressed
   * (#7253): another device opens step 1 with it typed, and the panel names
   * the monitor being made, or the one that failed.
   */
  Address = "address",
  IsApi = "isApi",
  MonitorId = "monitorId",
  // The run went on with a monitor of the person's own, made before it.
  MonitorIsExisting = "monitorIsExisting",
  PolicyId = "policyId",
  // The who-is-told step was confirmed without a policy of its own.
  WhoIsToldConfirmed = "whoIsToldConfirmed",
  TestExecutionLogId = "testExecutionLogId",
  TestSkipped = "testSkipped",
  // Step 4 (#7053): the status page the run put the monitor on, or "Not now".
  StatusPageId = "statusPageId",
  StatusPageSkipped = "statusPageSkipped",
}

// What the records say about each step, read when the page opens.
export interface WebsiteDownProgressFacts {
  // The run's monitor still exists.
  hasMonitor: boolean;
  // The run's policy still exists, or the step was confirmed.
  isWhoIsToldDone: boolean;
  testStatus: OnCallTestPageStatus | null;
  isTestSkipped: boolean;
  // The run walks step 4 (hasStatusPageStep). Left out, it does not.
  hasStatusPageStep?: boolean | undefined;
  // A status page shows the monitor, read from the records.
  isOnStatusPage?: boolean | undefined;
  isStatusPageSkipped?: boolean | undefined;
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
  const isTestStepDone: boolean = isWhoDone && isTestDone(facts);

  const steps: Array<GuidedSetupStepProgress> = [
    { key: WebsiteDownStep.Check, isDone: hasMonitor },
    { key: WebsiteDownStep.WhoIsTold, isDone: isWhoDone },
    { key: WebsiteDownStep.Test, isDone: isTestStepDone },
  ];

  /*
   * Step 4 last, and only where it can be done (#7053): done once a status
   * page shows the monitor, or the person said "Not now".
   */
  if (facts.hasStatusPageStep) {
    steps.push({
      key: WebsiteDownStep.StatusPage,
      isDone:
        isTestStepDone &&
        (Boolean(facts.isOnStatusPage) || Boolean(facts.isStatusPageSkipped)),
    });
  }

  return steps;
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
  /*
   * Who the monitor tells, in When this goes down's words, for a project
   * whose own policies and rules decide who is paged (#7055): its owners
   * and who it pages (getWhoIsToldToldSentences). Not given, or empty, the
   * summary says the project's rules decide.
   */
  whoIsToldSentences?: Array<string> | null | undefined;
  canSendEmail: boolean;
  testResult: OnCallTestPageResult | null;
  testResultSentence: string | null;
  // The status page that shows the monitor (#7053); not given, none.
  statusPageName?: string | null | undefined;
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
         * Its name is read by its list (Common/Utils/DefaultRecordNames):
         * "Critical Incident" in the reader's words, a project's own as
         * written, set apart so a right-to-left page keeps it in order.
         */
        "If it does not answer, or answers with an error, OneUptime opens an incident ({{severity}}).",
        {
          severity: recordNameInSentence(
            StateListType.IncidentSeverity,
            facts.incidentSeverityName,
          ),
        },
        { setsValuesApart: true },
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
    // Who they page for this monitor, as its overview says it (#7055).
    told.push(
      facts.whoIsToldSentences && facts.whoIsToldSentences.length > 0
        ? joinSentences(facts.whoIsToldSentences)
        : translator.translateText(
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
        "Project Owners are emailed about incidents nobody owns.",
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

  // Only what the records say: a status page that shows it (#7053).
  if (facts.statusPageName) {
    rows.push({
      key: "status_page",
      label: translator.translateText(WEBSITE_DOWN_COPY.statusPageLabel) || "",
      text: getStatusPageShownSentence(translator, facts.statusPageName),
    });
  }

  return rows;
};

// '"Acme Status" shows it to your customers.', the page's name set apart.
export const getStatusPageShownSentence: (
  translator: Translator,
  statusPageName: string,
) => string = (translator: Translator, statusPageName: string): string => {
  return translator.translateTemplate(
    WEBSITE_DOWN_COPY.statusPageShown,
    { statusPage: statusPageName },
    { setsValuesApart: true },
  );
};
