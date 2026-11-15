import { GuidedSetupStepProgress } from "../GuidedSetupProgress";
import PageMap from "../../../Utils/PageMap";
import { PlanType } from "Common/Types/Billing/SubscriptionPlan";
import {
  getDefaultStatusPageName as getGuidedStatusPageName,
  STATUS_PAGE_NAME_MIN_LENGTH as GUIDED_STATUS_PAGE_NAME_MIN_LENGTH,
} from "Common/Utils/GuidedSetup/StatusPageRecords";
import {
  SentenceOptions,
  Translator,
  formatList,
  translationKey,
} from "Common/Types/Translator";

/*
 * GUIDED SETUP: PUBLISH A STATUS PAGE (issue #6806), drawn in
 * GuidedSetupFrame like the website-down setup (#6804):
 *
 *   1. Name it, and pick what it shows. The project's monitors are listed
 *      with none ticked - a public page shows only what someone chose -
 *      and "Select all". The page is created with the monitors picked, so
 *      it never exists empty, and the step says, above its button, that the
 *      page is public at its link from that moment: on Cloud a private page
 *      needs the Growth plan (StatusPage.isPublicStatusPage), so the setup
 *      cannot make it private first and publish it later. A project with
 *      no monitor yet is offered the website-down setup first. A name one
 *      of this person's own pages has already makes no second page: the
 *      monitors go on that page, and step 2 says so (#7252).
 *   2. This is what your customers see: the page as a list of what it
 *      shows, its link, and what appears on it by itself (incidents on
 *      these monitors, and subscribers are emailed), never (alerts), and
 *      when someone posts it (maintenance, announcements).
 *
 * Then the summary, with the optional settings (a domain of your own, a
 * logo and colours, who can subscribe, private instead of public), each
 * one line that opens the real setting and says the plan it needs on
 * Cloud, and what to do next.
 *
 * React-free, so the tests read the rules and words without a page;
 * StatusPageSetupApi.ts reads and writes the records.
 */

export const STATUS_PAGE_SETUP: string = "status_page";

/*
 * The docs' start-to-finish guide to this job (#6821), linked from the page:
 * it goes on to a domain of your own, which this setup leaves to the summary.
 */
export const STATUS_PAGE_SETUP_GUIDE_DOCS_PATH: string =
  "/docs/guides/status-page";

export enum StatusPageSetupStep {
  Pick = "pick",
  Review = "review",
}

export const STATUS_PAGE_SETUP_STEPS: ReadonlyArray<StatusPageSetupStep> = [
  StatusPageSetupStep.Pick,
  StatusPageSetupStep.Review,
];

/*
 * Create Status Page's own rule (StatusPageCreateForm): at least two
 * letters - Ask AI's publish_status_page keeps it too (Common).
 */
export const STATUS_PAGE_NAME_MIN_LENGTH: number =
  GUIDED_STATUS_PAGE_NAME_MIN_LENGTH;

export const STATUS_PAGE_SETUP_COPY: {
  setupTitle: string;
  setupDescription: string;
  cannotCreate: string;
  goToStatusPages: string;
  pickTitle: string;
  nameLabel: string;
  namePlaceholder: string;
  nameError: string;
  monitorsLabel: string;
  monitorsHelp: string;
  selectAll: string;
  clearAll: string;
  noMonitors: string;
  setUpMonitor: string;
  nothingPicked: string;
  publicNotice: string;
  createButton: string;
  emptyPageHelp: string;
  addButton: string;
  continueButton: string;
  changeShown: string;
  existingStatusPage: string;
  reviewTitle: string;
  reviewHelp: string;
  linkLabel: string;
  openLink: string;
  showsLabel: string;
  incidentsAppear: string;
  alertsNever: string;
  postedByYou: string;
  reviewButton: string;
  summaryTitle: string;
  summaryAddress: string;
  summaryShows: string;
  summaryByItself: string;
  summaryOptional: string;
  summaryNext: string;
  nextAnnouncement: string;
  nextMaintenance: string;
  nextEmbed: string;
  nextStatusPage: string;
  startOver: string;
} = {
  setupTitle: translationKey("Publish a status page"),
  setupDescription: translationKey(
    "Guided setup: name a status page, pick what it shows and see what your customers see, on this page.",
  ),
  cannotCreate: translationKey(
    "Creating a status page needs permission you do not have in this project. Ask a project admin to give it to you, or to set this up.",
  ),
  goToStatusPages: translationKey("Go to Status Pages"),
  pickTitle: translationKey("Name it, and pick what it shows"),
  nameLabel: translationKey("Status page name"),
  namePlaceholder: translationKey("Acme Status"),
  nameError: translationKey("Enter a name of at least two characters."),
  monitorsLabel: translationKey("What it shows"),
  monitorsHelp: translationKey(
    "Each monitor you pick appears on the page with its current status and its uptime.",
  ),
  selectAll: translationKey("Select all"),
  clearAll: translationKey("Clear"),
  noMonitors: translationKey(
    "This project has no monitors yet, and a status page shows monitors. Set one up first, then come back here.",
  ),
  setUpMonitor: translationKey("Set up a monitor"),
  nothingPicked: translationKey("Pick at least one monitor to show."),
  publicNotice: translationKey(
    "The page is public as soon as you create it: anyone with its link sees the status of the monitors you picked.",
  ),
  createButton: translationKey("Create the status page"),
  emptyPageHelp: translationKey(
    '"{{name}}" shows nothing yet. Pick what it shows.',
  ),
  addButton: translationKey("Add to the page"),
  continueButton: translationKey("Continue"),
  changeShown: translationKey("Change what it shows"),
  /*
   * Said first in step 2 when the name typed is one of this person's own
   * status pages: the setup went on with it and made no second page with
   * the same name (#7252), in the website-down setup's words for a monitor.
   * The preview right below shows the monitors picked on it.
   */
  existingStatusPage: translationKey(
    'You already have a status page named "{{name}}", so no new one was made.',
  ),
  reviewTitle: translationKey("This is what your customers see"),
  reviewHelp: translationKey(
    "Your status page is live at this link. Here is what it shows and what appears on it.",
  ),
  linkLabel: translationKey("Public link"),
  openLink: translationKey("Open the status page"),
  showsLabel: translationKey("It shows"),
  incidentsAppear: translationKey(
    "An incident on one of these monitors appears here by itself, and subscribers are emailed.",
  ),
  alertsNever: translationKey(
    "Alerts never appear here. They are for your team.",
  ),
  postedByYou: translationKey(
    "Scheduled maintenance and announcements appear when you post them.",
  ),
  reviewButton: translationKey("Looks good"),
  summaryTitle: translationKey('"{{name}}" is live'),
  summaryAddress: translationKey("Address"),
  summaryShows: translationKey("Shows"),
  summaryByItself: translationKey("Appears by itself"),
  summaryOptional: translationKey("Make it yours (optional)"),
  summaryNext: translationKey("What's next"),
  nextAnnouncement: translationKey("Post a first announcement"),
  nextMaintenance: translationKey("Schedule a maintenance"),
  nextEmbed: translationKey("Add the status to your website"),
  nextStatusPage: translationKey("Open this status page's settings"),
  startOver: translationKey("Set up another status page"),
};

/*
 * THE NAME: the project's, to start with, so a new project's owner can
 * keep it and type nothing ("Acme Status"), in the reader's language. The
 * one copy Ask AI names a page with too (#7247): Common/Utils/GuidedSetup.
 */
export const getDefaultStatusPageName: (data: {
  translator: Translator;
  projectName: string | undefined;
}) => string = (data: {
  translator: Translator;
  projectName: string | undefined;
}): string => {
  return getGuidedStatusPageName({
    translator: data.translator,
    projectName: data.projectName,
  });
};

export const isStatusPageNameValid: (name: string) => boolean = (
  name: string,
): boolean => {
  return name.trim().length >= STATUS_PAGE_NAME_MIN_LENGTH;
};

// A run of spaces, tabs or line breaks between two words of a name.
const SPACES_BETWEEN_WORDS: RegExp = /\s+/;

/*
 * A NAME, HOWEVER IT IS TYPED (#7252): "Acme Status", " acme status " and
 * "ACME  Status" name one page, so a run the browser lost - or a second tab
 * - that types the name again goes on with the page this person already
 * made instead of making a second one. Spaces at either end, how many sit
 * between two words, and capitals are not compared; the letters and their
 * order are. Composed and decomposed accents are one letter (NFC).
 */
export const getStatusPageNameIdentity: (name: string) => string = (
  name: string,
): string => {
  return name
    .normalize("NFC")
    .trim()
    .split(SPACES_BETWEEN_WORDS)
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
};

// Whether two names name one page; a name with no letters names none.
export const isSameStatusPageName: (
  first: string,
  second: string,
) => boolean = (first: string, second: string): boolean => {
  const identity: string = getStatusPageNameIdentity(first);

  return identity.length > 0 && identity === getStatusPageNameIdentity(second);
};

/*
 * The name "Set up another status page" starts with: the project's, unless
 * the page just set up has it - another page needs a name of its own, and
 * keeping that one would put the monitors picked next on the page just set
 * up (#7252). Then it starts empty.
 */
export const getStartOverStatusPageName: (data: {
  defaultName: string;
  finishedName: string | undefined;
}) => string = (data: {
  defaultName: string;
  finishedName: string | undefined;
}): string => {
  if (isSameStatusPageName(data.defaultName, data.finishedName || "")) {
    return "";
  }

  return data.defaultName;
};

/*
 * THE MONITORS PICKED. None to start with; "Select all" picks every one,
 * and picking keeps the order the list shows, so the page lists them as
 * the person saw them.
 */
export interface StatusPageSetupMonitor {
  id: string;
  name: string;
  // The monitor's current status ("Operational"), when it has one.
  statusName?: string | undefined;
  statusColor?: string | undefined;
}

export const togglePickedMonitor: (data: {
  picked: ReadonlyArray<string>;
  monitorId: string;
}) => Array<string> = (data: {
  picked: ReadonlyArray<string>;
  monitorId: string;
}): Array<string> => {
  if (data.picked.includes(data.monitorId)) {
    return data.picked.filter((id: string): boolean => {
      return id !== data.monitorId;
    });
  }

  return [...data.picked, data.monitorId];
};

export const pickAllMonitors: (
  monitors: ReadonlyArray<StatusPageSetupMonitor>,
) => Array<string> = (
  monitors: ReadonlyArray<StatusPageSetupMonitor>,
): Array<string> => {
  return monitors.map((monitor: StatusPageSetupMonitor): string => {
    return monitor.id;
  });
};

// The monitors picked, in the order the list shows them.
export const getPickedMonitors: (data: {
  monitors: ReadonlyArray<StatusPageSetupMonitor>;
  picked: ReadonlyArray<string>;
}) => Array<StatusPageSetupMonitor> = (data: {
  monitors: ReadonlyArray<StatusPageSetupMonitor>;
  picked: ReadonlyArray<string>;
}): Array<StatusPageSetupMonitor> => {
  return data.monitors.filter((monitor: StatusPageSetupMonitor): boolean => {
    return data.picked.includes(monitor.id);
  });
};

/*
 * THE RUN: what this pass through the setup made, as GuidedSetupRunStore
 * keeps it.
 */
export enum StatusPageSetupRunValue {
  StatusPageId = "statusPageId",
  // Step 2 was looked at and confirmed.
  Reviewed = "reviewed",
}

// What the records say about each step, read when the page opens.
export interface StatusPageSetupProgressFacts {
  hasStatusPage: boolean;
  // The monitors the page shows (its resources), as the server counts them.
  monitorCount: number;
  isReviewed: boolean;
}

// Step 1 is done only once the page shows something: never an empty page.
export const isPickDone: (facts: StatusPageSetupProgressFacts) => boolean = (
  facts: StatusPageSetupProgressFacts,
): boolean => {
  return facts.hasStatusPage && facts.monitorCount > 0;
};

export const getStatusPageSetupProgress: (
  facts: StatusPageSetupProgressFacts,
) => Array<GuidedSetupStepProgress> = (
  facts: StatusPageSetupProgressFacts,
): Array<GuidedSetupStepProgress> => {
  const pickDone: boolean = isPickDone(facts);

  return [
    { key: StatusPageSetupStep.Pick, isDone: pickDone },
    {
      key: StatusPageSetupStep.Review,
      isDone: pickDone && facts.isReviewed,
    },
  ];
};

// The end: a public page that shows a monitor, and the person saw what it shows.
export const isStatusPageSetupFinished: (
  facts: StatusPageSetupProgressFacts,
) => boolean = (facts: StatusPageSetupProgressFacts): boolean => {
  return isPickDone(facts) && facts.isReviewed;
};

/*
 * Every sentence the setup draws with the page's name sets the name apart
 * (the Translator's setsValuesApart): in an Arabic or Persian sentence a
 * name in Latin letters - or one that starts with a figure, "24/7 Status" -
 * keeps its place, and the count after it is not pulled into it ('"Acme
 * Status" shows 1 monitor' was drawn with the 1 before the name). Each is
 * drawn on the page and nothing else, so the isolate's marks go nowhere.
 */
export const STATUS_PAGE_NAME_SENTENCE: SentenceOptions = {
  setsValuesApart: true,
};

// Step 1's line once it is done: '"Acme Status" shows 3 monitors.'
export const getPickDoneLine: (data: {
  translator: Translator;
  name: string;
  monitorCount: number;
}) => string = (data: {
  translator: Translator;
  name: string;
  monitorCount: number;
}): string => {
  return data.translator.translatePlural(
    {
      one: '"{{name}}" shows {{count}} monitor.',
      other: '"{{name}}" shows {{count}} monitors.',
    },
    data.monitorCount,
    { name: data.name },
    STATUS_PAGE_NAME_SENTENCE,
  );
};

/*
 * What the page shows, by name, for the summary: every name up to five,
 * then "and 3 more".
 */
export const STATUS_PAGE_SHOWS_LIMIT: number = 5;

export const describeShownMonitors: (data: {
  translator: Translator;
  names: ReadonlyArray<string>;
  monitorCount: number;
}) => string = (data: {
  translator: Translator;
  names: ReadonlyArray<string>;
  monitorCount: number;
}): string => {
  const shown: Array<string> = data.names.slice(0, STATUS_PAGE_SHOWS_LIMIT);
  const list: string = formatList(shown, data.translator);
  const more: number = Math.max(data.monitorCount, shown.length) - shown.length;

  if (shown.length === 0) {
    return data.translator.translatePlural(
      { one: "{{count}} monitor", other: "{{count}} monitors" },
      data.monitorCount,
    );
  }

  if (more > 0) {
    return data.translator.translatePlural(
      {
        one: "{{names}} and {{count}} more",
        other: "{{names}} and {{count}} more",
      },
      more,
      { names: list },
    );
  }

  return list;
};

/*
 * THE OPTIONAL SETTINGS, in the summary: each one line that opens the real
 * setting, and the plan it needs on Cloud (BILLING_ENABLED) - read from the
 * columns' own plan gates (StatusPage's ColumnBillingAccessControl):
 *
 *   - a domain of your own: StatusPageDomain has no plan gate;
 *   - a logo and colours: the branding columns have none;
 *   - who can subscribe: email on every plan, SMS from Growth, Slack,
 *     Microsoft Teams and webhooks from Scale;
 *   - private instead of public: isPublicStatusPage, from Growth.
 */
export interface StatusPageSetupExtra {
  key: string;
  title: string;
  description: string;
  page: PageMap;
  // The plan it needs on Cloud; null on every plan.
  plan: PlanType | null;
  // Said on Cloud instead of the plan, when it depends on what is picked.
  cloudNote?: string | undefined;
}

export const STATUS_PAGE_SETUP_EXTRAS: ReadonlyArray<StatusPageSetupExtra> = [
  {
    key: "domain",
    title: translationKey("Your own domain"),
    description: translationKey(
      "Serve the page at an address such as status.example.com.",
    ),
    page: PageMap.STATUS_PAGE_VIEW_DOMAINS,
    plan: null,
  },
  {
    key: "branding",
    title: translationKey("Your logo and colours"),
    description: translationKey("Make the page look like your product."),
    page: PageMap.STATUS_PAGE_VIEW_BRANDING,
    plan: null,
  },
  {
    key: "subscribers",
    title: translationKey("Who can subscribe"),
    description: translationKey(
      "By email, SMS, Slack, Microsoft Teams or webhook.",
    ),
    page: PageMap.STATUS_PAGE_VIEW_SUBSCRIBER_SETTINGS,
    plan: null,
    cloudNote: translationKey(
      "Email on every plan, SMS from Growth, the rest from Scale",
    ),
  },
  {
    key: "private",
    title: translationKey("Private instead of public"),
    description: translationKey(
      "Only people you invite, or who sign in, see the page.",
    ),
    page: PageMap.STATUS_PAGE_VIEW_AUTHENTICATION_SETTINGS,
    plan: PlanType.Growth,
  },
];

// "Growth plan and above", where plans exist (Cloud); nothing elsewhere.
export const describeExtraPlan: (data: {
  translator: Translator;
  extra: StatusPageSetupExtra;
  isBillingEnabled: boolean;
}) => string | null = (data: {
  translator: Translator;
  extra: StatusPageSetupExtra;
  isBillingEnabled: boolean;
}): string | null => {
  if (!data.isBillingEnabled) {
    return null;
  }

  if (data.extra.cloudNote) {
    return data.translator.translateText(data.extra.cloudNote) || "";
  }

  if (!data.extra.plan || data.extra.plan === PlanType.Free) {
    return data.translator.translateText("Every plan") || "";
  }

  return data.translator.translateTemplate("{{plan}} plan and above", {
    plan: data.extra.plan,
  });
};
