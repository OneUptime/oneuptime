import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import {
  ADMIN_SERVER_SETUP_ROUTE as SERVER_SETUP_ROUTE,
  SERVER_EMAIL_COPY,
} from "../../../Utils/ServerEmail";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import IconProp from "Common/Types/Icon/IconProp";
import ProjectGoal, {
  PROJECT_GOALS,
} from "Common/Types/WelcomeChecklist/ProjectGoal";
import { WelcomeStep } from "Common/Types/WelcomeChecklist/WelcomeChecklist";
import { ADMIN_DASHBOARD_URL } from "Common/UI/Config";
import PermissionGate, {
  ModelAction,
  PermissionCheckableModel,
} from "Common/UI/Utils/PermissionGate";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import Monitor from "Common/Models/DatabaseModels/Monitor";
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
  icon: IconProp;
}

// The question's answers, in the order it lists them.
export const WELCOME_GOALS: ReadonlyArray<WelcomeGoalEntry> = [
  {
    goal: ProjectGoal.Uptime,
    title: translationKey("Know when my website or API is down"),
    icon: IconProp.AltGlobe,
  },
  {
    goal: ProjectGoal.OnCall,
    title: translationKey("Page the right person when something breaks"),
    icon: IconProp.Call,
  },
  {
    goal: ProjectGoal.StatusPage,
    title: translationKey("Tell my customers with a status page"),
    icon: IconProp.CheckCircle,
  },
  {
    goal: ProjectGoal.Telemetry,
    title: translationKey("See my logs, metrics and traces"),
    icon: IconProp.Logs,
  },
  {
    goal: ProjectGoal.Infrastructure,
    title: translationKey("Watch my servers, Kubernetes or cloud"),
    icon: IconProp.ServerStack,
  },
  {
    goal: ProjectGoal.Import,
    title: translationKey("I am moving from another tool"),
    icon: IconProp.InboxArrowDown,
  },
  {
    goal: ProjectGoal.Explore,
    title: translationKey("Just looking around"),
    icon: IconProp.Compass,
  },
];

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
  skipButton: string;
  saveButton: string;
  cancelButton: string;
} = {
  title: translationKey("What do you want to do first?"),
  description: translationKey(
    "Pick one or more, and Home sets up your first steps around them. You can change this later.",
  ),
  continueButton: translationKey("Continue"),
  skipButton: translationKey("Skip"),
  saveButton: translationKey("Save"),
  cancelButton: translationKey("Cancel"),
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
  // A page outside the Dashboard (the Admin Dashboard), opened in a new tab.
  externalUrl?: (() => URL) | undefined;
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
 * The server setup page of the Admin Dashboard (/admin/setup, #6824),
 * where a master admin sets email up and tests it: the same route the
 * Dashboard's server setup card opens (Utils/ServerEmail).
 */
export const ADMIN_SERVER_SETUP_ROUTE: string = SERVER_SETUP_ROUTE;

export const getAdminServerSetupUrl: () => URL = (): URL => {
  return URL.fromString(ADMIN_DASHBOARD_URL.toString()).addRoute(
    ADMIN_SERVER_SETUP_ROUTE,
  );
};

export const WELCOME_STEPS: ReadonlyArray<WelcomeStepEntry> = [
  {
    step: WelcomeStep.ServerEmail,
    title: translationKey("This server cannot send email yet"),
    description: translationKey(
      "Nobody gets invitations, password resets or alerts by email until you set up email in the Admin Dashboard.",
    ),
    icon: IconProp.Email,
    iconBackgroundClassName: "bg-amber-500",
    externalUrl: getAdminServerSetupUrl,
  },
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
     * Says what happens until then, too: an incident or alert nobody owns
     * is emailed to the project's owners (the Owners workers), so a new
     * project's first monitor already reaches whoever made the project.
     */
    description: translationKey(
      "Page the right person when an incident or alert opens. Done when an on-call rule runs a policy that reaches someone. Until then, the project's owners get an email.",
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
     * The guided setup (#6805): how you are reached, who else is on call,
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
      return Boolean(entry.pageMap || entry.externalUrl);
    })
  );
};
