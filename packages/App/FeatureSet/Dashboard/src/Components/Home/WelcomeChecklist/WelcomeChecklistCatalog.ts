import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import { SERVER_EMAIL_COPY } from "../../../Utils/ServerEmail";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import ProjectGoal, {
  PROJECT_GOALS,
} from "Common/Types/WelcomeChecklist/ProjectGoal";
import { WelcomeStep } from "Common/Types/WelcomeChecklist/WelcomeChecklist";
import {
  GuidedSetupEntryPoint,
  withGuidedSetupEntryPoint,
} from "Common/UI/Utils/GuidedSetupEvents";
import PermissionGate, {
  ModelAction,
  PermissionCheckableModel,
} from "Common/UI/Utils/PermissionGate";
import {
  PluralTemplate,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";

/*
 * THE WELCOME CHECKLIST'S WORDS AND PAGES (issue #6803).
 *
 * Which steps a project gets, and when each is done, is the server's
 * (Common/Types/WelcomeChecklist); this file says, for each step, what the
 * card calls it and where it leads, and for each goal what the question
 * calls it. React-free, so the tests read every word.
 *
 * A step opens today's page for the job. A guided setup (#6804, #6805,
 * #6806) takes a step over by setting its `guidedSetupPage`: one line, and
 * the step opens the setup instead, for everyone who may use it.
 */

export interface WelcomeGoalEntry {
  goal: ProjectGoal;
  title: string;
  /*
   * What the person has once the goal's steps are done, in one line under
   * its title on the question's card (#8897): the outcome, not the steps.
   */
  outcome: string;
  icon: IconProp;
  // The disc behind the card's icon: the colour of the goal's first step.
  iconBackgroundClassName: string;
}

/*
 * The question's answers, in the order it lists them. The last, "Just
 * looking around", is not a card beside the others but the way out of the
 * question (#8897): it is the goal of someone who has none yet, so it is
 * offered under them, as one link (WELCOME_JUST_LOOKING_GOAL).
 */
export const WELCOME_GOALS: ReadonlyArray<WelcomeGoalEntry> = [
  {
    goal: ProjectGoal.Uptime,
    title: translationKey("Know when my website or API is down"),
    outcome: translationKey(
      "OneUptime checks it around the clock and tells you the moment it goes down.",
    ),
    icon: IconProp.AltGlobe,
    iconBackgroundClassName: "bg-indigo-500",
  },
  {
    goal: ProjectGoal.OnCall,
    title: translationKey("Page the right person when something breaks"),
    outcome: translationKey(
      "Whoever is on call is paged, and the page goes further if nobody answers.",
    ),
    icon: IconProp.Call,
    iconBackgroundClassName: "bg-rose-500",
  },
  {
    goal: ProjectGoal.StatusPage,
    title: translationKey("Tell my customers with a status page"),
    outcome: translationKey(
      "A public page shows your customers what is up, what is down and what is planned.",
    ),
    icon: IconProp.CheckCircle,
    iconBackgroundClassName: "bg-emerald-500",
  },
  {
    goal: ProjectGoal.Telemetry,
    title: translationKey("See my logs, metrics and traces"),
    outcome: translationKey(
      "Your app sends them with OpenTelemetry, and you search and alert on them here.",
    ),
    icon: IconProp.Logs,
    iconBackgroundClassName: "bg-violet-500",
  },
  {
    goal: ProjectGoal.Infrastructure,
    title: translationKey("Watch my servers, Kubernetes or cloud"),
    outcome: translationKey(
      "See the health of every server, cluster and cloud account in one place.",
    ),
    icon: IconProp.ServerStack,
    iconBackgroundClassName: "bg-cyan-600",
  },
  {
    goal: ProjectGoal.Import,
    title: translationKey("I am moving from another tool"),
    outcome: translationKey(
      "Bring your schedules, escalation policies and monitors over from the tool you use today.",
    ),
    icon: IconProp.InboxArrowDown,
    iconBackgroundClassName: "bg-sky-500",
  },
  {
    goal: ProjectGoal.Explore,
    title: translationKey("Just looking around"),
    outcome: translationKey(
      "Go straight to Home, and come back to this checklist whenever you like.",
    ),
    icon: IconProp.Compass,
    iconBackgroundClassName: "bg-gray-500",
  },
];

/*
 * The goal of someone who has none yet: the question's way out, a link
 * under the cards. It is kept as the project's goal, and hides the
 * checklist for the person who chose it, so they land on the rest of Home
 * at once - with the line that shows the checklist again.
 */
export const WELCOME_JUST_LOOKING_GOAL: ProjectGoal = ProjectGoal.Explore;

// The question's cards: every goal but the way out.
export const WELCOME_GOAL_CARDS: ReadonlyArray<WelcomeGoalEntry> =
  WELCOME_GOALS.filter((entry: WelcomeGoalEntry): boolean => {
    return entry.goal !== WELCOME_JUST_LOOKING_GOAL;
  });

export const getWelcomeGoalEntry: (goal: ProjectGoal) => WelcomeGoalEntry = (
  goal: ProjectGoal,
): WelcomeGoalEntry => {
  return WELCOME_GOALS.find((entry: WelcomeGoalEntry): boolean => {
    return entry.goal === goal;
  })!;
};

export const WELCOME_QUESTION_COPY: {
  title: string;
  description: string;
  continueButton: string;
  saveButton: string;
  cancelButton: string;
  stepsToSetUp: PluralTemplate;
  pickHint: string;
} = {
  title: translationKey("What do you want to do first?"),
  description: translationKey(
    "Pick one or more, and Home sets up your first steps around them. You can change this later.",
  ),
  continueButton: translationKey("Continue"),
  saveButton: translationKey("Save"),
  cancelButton: translationKey("Cancel"),
  /*
   * What the goals picked so far bring, said while the person picks, with
   * about how long they take (WELCOME_MINUTES_COPY): the cost of a choice,
   * before it is made. Not "plan", which is the subscription's word here.
   */
  stepsToSetUp: {
    one: "{{count}} step to set up",
    other: "{{count}} steps to set up",
  },
  // Beside Continue while nothing is picked: why it cannot be pressed yet.
  pickHint: translationKey("Pick at least one to continue."),
};

/*
 * The greeting both views of the checklist open with: the person's first
 * name when the Dashboard knows it, and the card's own title when it does
 * not (WELCOME_CHECKLIST_COPY.title).
 */
export const WELCOME_GREETING_WITH_NAME: string = translationKey(
  "Welcome to OneUptime, {{name}} 👋",
);

/*
 * About how long, in minutes, beside a step and for a plan: always "about",
 * as WELCOME_STEP_MINUTES are estimates.
 */
export const WELCOME_MINUTES_COPY: {
  about: PluralTemplate;
  left: PluralTemplate;
} = {
  about: {
    one: "About {{count}} minute",
    other: "About {{count}} minutes",
  },
  left: {
    one: "About {{count}} minute left",
    other: "About {{count}} minutes left",
  },
};

export const WELCOME_CHECKLIST_COPY: {
  title: string;
  description: string;
  hideButton: string;
  progressSuffix: string;
  nextBadge: string;
  done: string;
  goalsLabel: string;
  changeGoals: string;
  chooseGoals: string;
  needsPlan: string;
  needsPlanDescription: string;
  hiddenLine: string;
  showButton: string;
  howItWorksButton: string;
  couldNotSave: string;
  startButton: string;
} = {
  title: "Welcome to OneUptime 👋",
  description: translationKey(
    "Each step ticks itself off once it works, and everyone setting up this project sees the same list.",
  ),
  hideButton: translationKey("Hide"),
  progressSuffix: translationKey("steps completed"),
  // Not "Next", which reads as a button ("Weiter") in some languages.
  nextBadge: translationKey("Next step"),
  done: translationKey("Done"),
  goalsLabel: translationKey("Your goals:"),
  changeGoals: translationKey("Change"),
  chooseGoals: translationKey("Choose your goals"),
  needsPlan: translationKey("Needs the {{plan}} plan"),
  needsPlanDescription: translationKey(
    "The {{currentPlan}} plan has one person. Upgrade to the {{plan}} plan to invite your team.",
  ),
  hiddenLine: translationKey("You hid the Welcome checklist."),
  showButton: translationKey("Show it"),
  howItWorksButton: translationKey("How OneUptime works"),
  couldNotSave: translationKey(
    "That did not save. Check your connection and try again.",
  ),
  // The next step's own button, in its row (#8897).
  startButton: translationKey("Start"),
};

/*
 * WHY A STEP IS NOT DONE ALTHOUGH ITS RECORD EXISTS (#6938): the
 * checklist's own sentence, for an invitation nobody accepted. Every other
 * break is a Setup health finding, said in its words.
 */
export const WELCOME_GAP_COPY: {
  invitationNotAccepted: string;
} = {
  invitationNotAccepted: translationKey(
    "An invitation to this project hasn't been accepted yet.",
  ),
};

/*
 * WHAT ELSE TO SET UP (#7986): the card Home draws once the goals' steps are
 * done, while core steps no goal brought are left - and, while only email
 * pages the person, the way to their phone and the app (#9442).
 */
export const WELCOME_MORE_COPY: {
  title: string;
  description: string;
  phoneTitle: string;
  phoneDescription: string;
} = {
  title: translationKey("More to set up"),
  description: translationKey(
    "Your first steps are done. Set up more whenever you like: each one ticks itself off once it works.",
  ),
  // The website setup's own link to the on-call guided setup, in its words.
  phoneTitle: translationKey("Get paged by SMS or phone call"),
  phoneDescription: translationKey(
    "Only email can page you now. Add your phone or the mobile app, and send yourself a test page.",
  ),
};

/*
 * Whether this person is offered "Get paged by SMS or phone call" (#9442):
 * whoever may use the on-call guided setup, by the rule On-Call's own
 * "Guided setup" button and the website setup's summary follow - one who
 * may create an on-call policy (WebsiteDownApi's mayUseOnCallSetup).
 */
export const mayUseOnCallGuidedSetup: () => boolean = (): boolean => {
  return PermissionGate.check(new OnCallDutyPolicy(), ModelAction.Create)
    .isAllowed;
};

/*
 * Where "Get paged by SMS or phone call" leads from Home (#9442): the
 * on-call guided setup, which adds a phone and the app and ends in a test
 * page, saying it was opened from Home.
 */
export const getPagedByPhoneRoute: () => Route = (): Route => {
  return new Route(
    withGuidedSetupEntryPoint(
      RouteUtil.populateRouteParams(
        RouteMap[PageMap.ON_CALL_DUTY_GUIDED_SETUP] as Route,
      ).toString(),
      GuidedSetupEntryPoint.Home,
    ),
  );
};

/*
 * The next-step line on the page a step's record lands on (WelcomeNextStep):
 * what was done, and what is next.
 */
export const WELCOME_NEXT_STEP_COPY: {
  next: string;
  lastStep: string;
  backToSetup: string;
  dismiss: string;
} = {
  next: translationKey("Next: {{step}}."),
  lastStep: translationKey("That was the last step."),
  backToSetup: translationKey("Back to setup"),
  dismiss: translationKey("Dismiss"),
};

export interface WelcomeStepEntry {
  step: WelcomeStep;
  title: string;
  description: string;
  /*
   * What the step says instead while the server cannot send email, when
   * its description promises one (Utils/ServerEmail): to a master admin,
   * who can set email up, and to anybody else.
   */
  descriptionWithoutEmail?:
    | {
        forAdmin: string;
        forOthers: string;
      }
    | undefined;
  icon: IconProp;
  iconBackgroundClassName: string;
  // Today's page for the job, open to everyone who may read it.
  pageMap?: PageMap | undefined;
  // A query the page reads, such as where it was opened from.
  pageQuery?: Record<string, string> | undefined;
  /*
   * A page of its own that creates what the step asks for. Only someone who
   * may create that model is sent there: a create form they cannot submit
   * would only fail at the end (issue #3306). Everyone else lands on
   * `pageMap`, whose create button is shown disabled, with the reason.
   */
  createPage?:
    | {
        pageMap: PageMap;
        modelType: { new (): PermissionCheckableModel };
      }
    | undefined;
  /*
   * The guided setup that does the whole job on one page, once it exists
   * (#6804 for monitors and who is told, #6805 for paging, #6806 for status
   * pages and telemetry). Set it, and the step opens it instead of today's
   * page.
   */
  guidedSetupPage?: PageMap | undefined;
  /*
   * What the guided setup's first step creates, for a step with no create
   * page of its own (a status page): only someone who may create it is sent
   * to the setup, and everyone else lands on `pageMap`. A step with a
   * create page is gated by that page's model instead.
   */
  guidedSetupModelType?: { new (): PermissionCheckableModel } | undefined;
  /*
   * Where the step's record lands once it is created, for the one quiet
   * line that says what is next there (WelcomeNextStep), and what that line
   * says was done. Only for steps that open a plain page: a guided setup
   * says what is next by itself.
   */
  landing?:
    | {
        pageMap: PageMap;
        doneText: string;
      }
    | undefined;
}

/*
 * The server's own setup (email, HTTPS, who can sign up) is no step: its
 * master admins see the Server setup card above the checklist
 * (Components/ServerSetup/ServerSetupCard), so Home asks for it once
 * (#7018).
 */
export const WELCOME_STEPS: ReadonlyArray<WelcomeStepEntry> = [
  {
    step: WelcomeStep.Import,
    title: translationKey("Import from your current tool"),
    description: translationKey(
      "Bring your on-call schedules, escalation policies and monitors over from the tool you use today. Done when an import finishes.",
    ),
    icon: IconProp.InboxArrowDown,
    iconBackgroundClassName: "bg-sky-500",
    // Where the importer says it was opened from (importer/opened's `from`).
    pageMap: PageMap.SETTINGS_IMPORT_FROM_TOOL,
    pageQuery: { from: "welcome" },
  },
  {
    step: WelcomeStep.Monitor,
    title: translationKey("Create your first monitor"),
    description: translationKey(
      "Check a website, an API or a server around the clock. Done when its first check comes in.",
    ),
    icon: IconProp.AltGlobe,
    iconBackgroundClassName: "bg-indigo-500",
    pageMap: PageMap.MONITORS,
    // The step says "create", so it opens the form, not the (empty) list.
    createPage: {
      pageMap: PageMap.MONITOR_CREATE,
      modelType: Monitor,
    },
    /*
     * The guided setup (#6804): an address, who is told and a test page on
     * one page, for whoever may create a monitor. It says what is next
     * itself, so the step has no landing line.
     */
    guidedSetupPage: PageMap.MONITOR_GUIDED_SETUP,
  },
  {
    step: WelcomeStep.Infrastructure,
    title: translationKey("Connect a server or cluster"),
    description: translationKey(
      "Install the agent on a server, or connect Kubernetes or a cloud account. Done when its first metrics arrive.",
    ),
    icon: IconProp.ServerStack,
    iconBackgroundClassName: "bg-cyan-600",
    pageMap: PageMap.HOSTS,
  },
  {
    step: WelcomeStep.Telemetry,
    title: translationKey("Send your first logs, metrics or traces"),
    description: translationKey(
      "Point OpenTelemetry at OneUptime from your app. Done when the first data arrives.",
    ),
    icon: IconProp.Logs,
    iconBackgroundClassName: "bg-violet-500",
    pageMap: PageMap.LOGS,
    /*
     * The guided setup (#6806): the OpenTelemetry guide, the wait for the
     * first data, and recommended alerts on the service that reported, on
     * one page. It says what is next itself.
     */
    guidedSetupPage: PageMap.SERVICES_GUIDED_SETUP,
  },
  {
    step: WelcomeStep.OnCall,
    title: translationKey("Set up an on-call policy"),
    /*
     * It ends in a test page (#6937): its guided setup's last step sends
     * one, and the step ticks once it is acknowledged - so that is what it
     * says. A policy that already pages someone when something breaks
     * ticks it too, as Home's docs say. It says what happens until then:
     * an incident or alert nobody owns is emailed to the project's owners
     * (the Owners workers), so a new project's first monitor already
     * reaches whoever made the project.
     */
    description: translationKey(
      "Page the right person when an incident or alert opens. Done when a test page is acknowledged. Until then, the Project Owners get an email.",
    ),
    // A server that cannot send email emails nobody: said, with the fix.
    descriptionWithoutEmail: {
      forAdmin: SERVER_EMAIL_COPY.onCallStepDescriptionForAdmin,
      forOthers: SERVER_EMAIL_COPY.onCallStepDescription,
    },
    icon: IconProp.Call,
    iconBackgroundClassName: "bg-rose-500",
    pageMap: PageMap.ON_CALL_DUTY,
    /*
     * The guided setup (#6805): how you are reached, who is paged first,
     * what if nobody answers and a test page, on one page. It says what is
     * next itself, so the step has no landing line.
     */
    guidedSetupPage: PageMap.ON_CALL_DUTY_GUIDED_SETUP,
  },
  {
    step: WelcomeStep.StatusPage,
    title: translationKey("Publish a status page"),
    description: translationKey(
      "Keep customers in the loop on uptime, incidents and maintenance. Done when the page shows a monitor.",
    ),
    icon: IconProp.CheckCircle,
    iconBackgroundClassName: "bg-emerald-500",
    pageMap: PageMap.STATUS_PAGES,
    /*
     * The guided setup (#6806): a name, the monitors it shows and what
     * customers see, on one page. It cannot finish with an empty page, and
     * says what is next itself, so the step has no landing line. Only
     * someone who may create a status page is sent there; everyone else
     * lands on the list, whose create button says why it is off.
     */
    guidedSetupPage: PageMap.STATUS_PAGES_GUIDED_SETUP,
    guidedSetupModelType: StatusPage,
  },
  {
    step: WelcomeStep.Team,
    title: translationKey("Invite your team"),
    description: translationKey(
      "Bring teammates in so the right people respond when something breaks. Done when someone accepts your invitation.",
    ),
    icon: IconProp.Team,
    iconBackgroundClassName: "bg-amber-500",
    /*
     * Users, not Teams: the Teams page lists the three built-in teams and
     * offers "Create Team", with no way to invite anyone. "Invite User" is on
     * the Users page.
     */
    pageMap: PageMap.USERS,
  },
];

export const getWelcomeStepEntry: (step: WelcomeStep) => WelcomeStepEntry = (
  step: WelcomeStep,
): WelcomeStepEntry => {
  return WELCOME_STEPS.find((entry: WelcomeStepEntry): boolean => {
    return entry.step === step;
  })!;
};

// Billing, where a step the plan holds back leads.
export const WELCOME_PLAN_PAGE: PageMap = PageMap.SETTINGS_BILLING;

/*
 * Where a step leads, decided at the click, not at the first paint: the
 * permission snapshot that says whether a create form is open to this user
 * can arrive after it.
 *
 *   1. its guided setup, once one exists - for someone who may create
 *      what the step asks for, when it has a create page: a setup whose
 *      first save they cannot make would only fail at its first step;
 *   2. its create form, for someone who may create what it asks for;
 *   3. today's page.
 */
export const getWelcomeStepPage: (entry: WelcomeStepEntry) => PageMap | null = (
  entry: WelcomeStepEntry,
): PageMap | null => {
  const mayCreate: boolean = Boolean(
    entry.createPage &&
      PermissionGate.check(new entry.createPage.modelType(), ModelAction.Create)
        .isAllowed,
  );

  // The model the setup's first step creates: its create page's, or its own.
  const setupModelType: { new (): PermissionCheckableModel } | undefined =
    entry.createPage?.modelType || entry.guidedSetupModelType;
  const maySetUp: boolean = setupModelType
    ? entry.createPage
      ? mayCreate
      : PermissionGate.check(new setupModelType(), ModelAction.Create).isAllowed
    : true;

  if (entry.guidedSetupPage && maySetUp) {
    return entry.guidedSetupPage;
  }

  if (entry.createPage && mayCreate) {
    return entry.createPage.pageMap;
  }

  return entry.pageMap || null;
};

// The address a step leads to, with its query; null for an external page.
export const getWelcomeStepRoute: (entry: WelcomeStepEntry) => Route | null = (
  entry: WelcomeStepEntry,
): Route | null => {
  const page: PageMap | null = getWelcomeStepPage(entry);

  if (!page) {
    return null;
  }

  const route: Route = RouteUtil.populateRouteParams(RouteMap[page] as Route);

  if (!entry.pageQuery || page === entry.guidedSetupPage) {
    return route;
  }

  const query: string = new URLSearchParams(entry.pageQuery).toString();

  return new Route(`${route.toString()}?${query}`);
};

// Every goal has its words, and every step its words and a place to go.
export const isCatalogComplete: () => boolean = (): boolean => {
  return (
    PROJECT_GOALS.every((goal: ProjectGoal): boolean => {
      return Boolean(getWelcomeGoalEntry(goal));
    }) &&
    WELCOME_STEPS.every((entry: WelcomeStepEntry): boolean => {
      return Boolean(entry.pageMap);
    })
  );
};
