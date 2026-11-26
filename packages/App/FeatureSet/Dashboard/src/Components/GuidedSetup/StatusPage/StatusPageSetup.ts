import Includes from "Common/Types/BaseDatabase/Includes";
import Search from "Common/Types/BaseDatabase/Search";
import { SharedNameFacts } from "Common/Types/Database/SharedNameMarks";
import ObjectID from "Common/Types/ObjectID";
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
 *
 *      A project that has status pages this person may change is offered
 *      them first (#7517): the newest is picked, a project with several
 *      names them in a picker, and the monitors go on the one picked.
 *      Making a new page stays one click away. A busy project's list has a
 *      search, a label to narrow it by and its monitor groups, each added
 *      as one row (#7147); "Select all" picks what the list shows.
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
  pickOutcome: string;
  reviewOutcome: string;
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
  existingPageOne: string;
  existingPagesLabel: string;
  makeNewInstead: string;
  useExistingInstead: string;
  onThePage: string;
  searchPlaceholder: string;
  labelPlaceholder: string;
  labelFilterLabel: string;
  noMatch: string;
  monitorGroupKind: string;
} = {
  /*
   * What each step sets up, beside the steps (GuidedSetupFrame, #8897): the
   * outcome the person is working towards, ticked as each step is done.
   */
  pickOutcome: translationKey(
    "A status page shows your monitors, with their status and uptime.",
  ),
  reviewOutcome: translationKey("Your customers see it at its own address."),
  setupTitle: translationKey("Publish a status page"),
  setupDescription: translationKey(
    "Guided setup: name a status page, pick what it shows and see what your customers see, on this page.",
  ),
  cannotCreate: translationKey(
    "Creating a status page needs permission you do not have in this project. Ask a Project Admin to give it to you, or to set this up.",
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
  /*
   * A PROJECT THAT HAS A STATUS PAGE ALREADY (#7517): step 1 says so first
   * and goes on with it - the newcomer who made one by hand came to finish
   * it, not to start a second beside it. One page is named in the sentence
   * (set apart, STATUS_PAGE_NAME_SENTENCE); several are counted
   * (getExistingPagesLine), and picked from by name, newest first.
   */
  existingPageOne: translationKey(
    'This project already has a status page, "{{name}}". The monitors you pick are added to it.',
  ),
  // The picker of several pages: the website setup's word for one (#7053).
  existingPagesLabel: translationKey("Status page"),
  makeNewInstead: translationKey("Make a new status page instead"),
  useExistingInstead: translationKey("Add to an existing status page instead"),
  // A monitor, or monitor group, the page picked already shows.
  onThePage: translationKey("On the page"),
  /*
   * A BUSY PROJECT'S LIST (#7147): a search by name, and a label to narrow
   * it by, in the words the Dashboard's other lists use for them.
   */
  searchPlaceholder: translationKey("Search by name"),
  labelPlaceholder: translationKey("All labels"),
  labelFilterLabel: translationKey("Filter by label"),
  // A search or label that finds nothing says so, and offers nothing else.
  noMatch: translationKey("Nothing matches."),
  // A monitor group's row, beside its name: the kind of thing it puts on the page.
  monitorGroupKind: translationKey("Monitor Group"),
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
 * THE MONITORS PICKED. None to start with; "Select all" picks every one
 * the list shows, and picking keeps the order the list shows, so the page
 * lists them as the person saw them.
 */

// A label a monitor or a monitor group carries: what the list is narrowed by (#7147).
export interface StatusPageSetupLabel {
  id: string;
  name: string;
  color?: string | undefined;
  /*
   * What tells it from another label of its name (#10314): read through
   * the record's labels, which take no description, so when it was made.
   */
  sharedName?: SharedNameFacts | undefined;
}

export interface StatusPageSetupMonitor {
  id: string;
  name: string;
  // The monitor's current status ("Operational"), when it has one.
  statusName?: string | undefined;
  statusColor?: string | undefined;
  labels?: Array<StatusPageSetupLabel> | undefined;
}

/*
 * A MONITOR GROUP (#7147), put on the page as Add Multiple Monitor Groups
 * puts one (BulkAddStatusPageMonitorGroups): one row, named as the group
 * is, with the status of its monitors.
 */
export interface StatusPageSetupMonitorGroup {
  id: string;
  name: string;
  labels?: Array<StatusPageSetupLabel> | undefined;
}

/*
 * WHAT THE LIST SHOWS (#7147): the monitors and monitor groups whose name
 * holds what was typed - in any case, however the spaces run, as a name is
 * compared (getStatusPageNameIdentity) - and that carry the label picked.
 * Nothing typed and no label: everything.
 */
export interface StatusPageSetupFilter {
  search: string;
  labelId: string | null;
}

export const NO_STATUS_PAGE_SETUP_FILTER: StatusPageSetupFilter = {
  search: "",
  labelId: null,
};

export const isStatusPageSetupFiltered: (
  filter: StatusPageSetupFilter,
) => boolean = (filter: StatusPageSetupFilter): boolean => {
  return (
    getStatusPageNameIdentity(filter.search).length > 0 ||
    Boolean(filter.labelId)
  );
};

/*
 * STEP 1'S LIST IS SEARCHED ON THE SERVER (#10580): the monitors and
 * monitor groups whose name holds what was typed and that carry the label
 * picked, a page of each by name, with how many match - so a monitor is
 * found by its name however many the project has. The step used to read the
 * first 10,000 monitors by name and search those in the browser, and a
 * monitor past them was never listed.
 */

/*
 * How many of each kind one search lists, by name: typing narrows the rest.
 * More than a picker's 50, because "Select all" picks what the list shows,
 * and a status page of a few hundred kiosks is picked by its label in one
 * go; far fewer than the 10,000 the step used to draw.
 */
export const STATUS_PAGE_SETUP_PAGE_SIZE: number = 500;

// A page a search found, and how many match in all.
export interface StatusPageSetupFound<TItem> {
  items: Array<TItem>;
  count: number;
}

export const NOTHING_FOUND: StatusPageSetupFound<never> = {
  items: [],
  count: 0,
};

/*
 * The records the list has shown so far - its first page, then what its
 * searches found - each once, in the order the list first showed it: what
 * is picked is named, and put on the page in this order, whichever search
 * showed it.
 */
export const mergeSetupRecords: <TItem extends { id: string; name: string }>(
  ...lists: Array<ReadonlyArray<TItem>>
) => Array<TItem> = <TItem extends { id: string; name: string }>(
  ...lists: Array<ReadonlyArray<TItem>>
): Array<TItem> => {
  const byId: Map<string, TItem> = new Map<string, TItem>();

  for (const list of lists) {
    for (const item of list) {
      // The latest read of a record wins, where it was first listed.
      byId.set(item.id, item);
    }
  }

  return Array.from(byId.values());
};

// What a search adds to the project's own query: a name, a label.
export const getStatusPageSetupSearchQuery: (filter: StatusPageSetupFilter) => {
  name?: Search<string>;
  labels?: Includes;
} = (
  filter: StatusPageSetupFilter,
): {
  name?: Search<string>;
  labels?: Includes;
} => {
  // However the spaces run, as the list compares a name.
  const search: string = filter.search
    .normalize("NFC")
    .trim()
    .split(SPACES_BETWEEN_WORDS)
    .filter(Boolean)
    .join(" ");
  const labelId: string | null =
    filter.labelId && ObjectID.isValidUUID(filter.labelId)
      ? filter.labelId
      : null;

  return {
    ...(search ? { name: new Search<string>(search) } : {}),
    ...(labelId ? { labels: new Includes([new ObjectID(labelId)]) } : {}),
  };
};

export const matchesStatusPageSetupFilter: (data: {
  item: { name: string; labels?: Array<StatusPageSetupLabel> | undefined };
  filter: StatusPageSetupFilter;
}) => boolean = (data: {
  item: { name: string; labels?: Array<StatusPageSetupLabel> | undefined };
  filter: StatusPageSetupFilter;
}): boolean => {
  const search: string = getStatusPageNameIdentity(data.filter.search);

  if (search && !getStatusPageNameIdentity(data.item.name).includes(search)) {
    return false;
  }

  if (
    data.filter.labelId &&
    !(data.item.labels || []).some((label: StatusPageSetupLabel): boolean => {
      return label.id === data.filter.labelId;
    })
  ) {
    return false;
  }

  return true;
};

// The items of `items` the list shows, in the list's order.
export const getShownItems: <
  TItem extends {
    name: string;
    labels?: Array<StatusPageSetupLabel> | undefined;
  },
>(data: {
  items: ReadonlyArray<TItem>;
  filter: StatusPageSetupFilter;
}) => Array<TItem> = <
  TItem extends {
    name: string;
    labels?: Array<StatusPageSetupLabel> | undefined;
  },
>(data: {
  items: ReadonlyArray<TItem>;
  filter: StatusPageSetupFilter;
}): Array<TItem> => {
  return data.items.filter((item: TItem): boolean => {
    return matchesStatusPageSetupFilter({ item: item, filter: data.filter });
  });
};

/*
 * The labels the list can be narrowed by: each label a monitor or a monitor
 * group carries, once, by name. A project whose monitors carry none has no
 * label to pick, and the step draws no picker.
 */
export const getLabelsOfList: (data: {
  monitors: ReadonlyArray<StatusPageSetupMonitor>;
  monitorGroups: ReadonlyArray<StatusPageSetupMonitorGroup>;
}) => Array<StatusPageSetupLabel> = (data: {
  monitors: ReadonlyArray<StatusPageSetupMonitor>;
  monitorGroups: ReadonlyArray<StatusPageSetupMonitorGroup>;
}): Array<StatusPageSetupLabel> => {
  const byId: Map<string, StatusPageSetupLabel> = new Map<
    string,
    StatusPageSetupLabel
  >();

  for (const item of [...data.monitors, ...data.monitorGroups]) {
    for (const label of item.labels || []) {
      if (label.id && label.name && !byId.has(label.id)) {
        byId.set(label.id, label);
      }
    }
  }

  return Array.from(byId.values()).sort(
    (first: StatusPageSetupLabel, second: StatusPageSetupLabel): number => {
      return first.name.localeCompare(second.name);
    },
  );
};

/*
 * "Select all" picks what the list shows (#7147): each of `shown` not
 * picked yet, after what was picked - with a search or a label on, what it
 * hides stays as it was, picked or not. Picks of things the page already
 * shows (`onThePage`) are never made: they would be skipped.
 */
export const pickShownItems: (data: {
  picked: ReadonlyArray<string>;
  shown: ReadonlyArray<{ id: string }>;
  onThePage?: ReadonlyArray<string> | undefined;
}) => Array<string> = (data: {
  picked: ReadonlyArray<string>;
  shown: ReadonlyArray<{ id: string }>;
  onThePage?: ReadonlyArray<string> | undefined;
}): Array<string> => {
  const picked: Array<string> = [...data.picked];

  for (const item of data.shown) {
    if (
      !picked.includes(item.id) &&
      !(data.onThePage || []).includes(item.id)
    ) {
      picked.push(item.id);
    }
  }

  return picked;
};

/*
 * Opened for one monitor - the website-down setup's summary offers this
 * setup for the monitor it set up, while the project has no status page to
 * add it to (#7053) - that monitor starts ticked: the person chose to show
 * it. Nothing else is ticked, and an id that names none of the project's
 * monitors ticks nothing.
 */
export const STATUS_PAGE_SETUP_MONITOR_QUERY: string = "monitorId";

export const getMonitorPickedOnOpen: (data: {
  monitorId: string | null | undefined;
  monitors: ReadonlyArray<StatusPageSetupMonitor>;
}) => Array<string> = (data: {
  monitorId: string | null | undefined;
  monitors: ReadonlyArray<StatusPageSetupMonitor>;
}): Array<string> => {
  const found: StatusPageSetupMonitor | undefined = data.monitorId
    ? data.monitors.find((monitor: StatusPageSetupMonitor): boolean => {
        return monitor.id === data.monitorId;
      })
    : undefined;

  return found ? [found.id] : [];
};

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

// The monitor groups picked, in the order the list shows them (#7147).
export const getPickedMonitorGroups: (data: {
  monitorGroups: ReadonlyArray<StatusPageSetupMonitorGroup>;
  picked: ReadonlyArray<string>;
}) => Array<StatusPageSetupMonitorGroup> = (data: {
  monitorGroups: ReadonlyArray<StatusPageSetupMonitorGroup>;
  picked: ReadonlyArray<string>;
}): Array<StatusPageSetupMonitorGroup> => {
  return data.monitorGroups.filter(
    (group: StatusPageSetupMonitorGroup): boolean => {
      return data.picked.includes(group.id);
    },
  );
};

/*
 * THE PROJECT'S STATUS PAGES THIS PERSON MAY CHANGE (#7517), which step 1
 * offers before it makes a new one. Read newest first, archived ones left
 * out (an archived page is offline).
 */
export interface StatusPageSetupPage {
  id: string;
  name: string;
  /*
   * Its Page Title, if it has one: the name its visitors read
   * (StatusPagePublicName), which the preview of step 2 shows (#7467).
   */
  pageTitle?: string | undefined;
  // The labels it carries, by id: a grant limited to labels reaches it by them.
  labelIds?: Array<string> | undefined;
}

/*
 * Which pages a person's grants to change a status page reach, as the
 * server weighs a grant by the record it acts on: a grant with no labels
 * reaches every page; one limited to labels, the pages carrying one of
 * them; one limited to owned records, the pages the person or one of their
 * teams owns; and a block with labels takes away the pages carrying one of
 * those. Who reads a page but may not change it is never offered it: the
 * monitors would not be added.
 */
export interface StatusPageEditReach {
  isProjectWide: boolean;
  labelIds: Array<string>;
  reachesOwned: boolean;
  blockedLabelIds: Array<string>;
}

// Someone who may change no status page.
export const NO_STATUS_PAGE_EDIT_REACH: StatusPageEditReach = {
  isProjectWide: false,
  labelIds: [],
  reachesOwned: false,
  blockedLabelIds: [],
};

export const mayEditStatusPage: (data: {
  reach: StatusPageEditReach;
  labelIds: ReadonlyArray<string>;
  // The person, or one of their teams, owns the page.
  isOwned: boolean;
}) => boolean = (data: {
  reach: StatusPageEditReach;
  labelIds: ReadonlyArray<string>;
  isOwned: boolean;
}): boolean => {
  // Ids compared as the server compares them: in any case.
  const carries: (labelIds: ReadonlyArray<string>) => boolean = (
    labelIds: ReadonlyArray<string>,
  ): boolean => {
    const wanted: Array<string> = labelIds.map((labelId: string): string => {
      return labelId.toLowerCase();
    });

    return data.labelIds.some((labelId: string): boolean => {
      return wanted.includes(labelId.toLowerCase());
    });
  };

  if (carries(data.reach.blockedLabelIds)) {
    return false;
  }

  if (data.reach.isProjectWide || carries(data.reach.labelIds)) {
    return true;
  }

  return data.reach.reachesOwned && data.isOwned;
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

/*
 * Step 1's line once it is done: '"Acme Status" shows 3 monitors.' - or,
 * once the page shows a monitor group (#7147), its rows are not all
 * monitors, and the line says so: '"Acme Status" shows 13 monitors and
 * monitor groups.'
 */
export const getPickDoneLine: (data: {
  translator: Translator;
  name: string;
  monitorCount: number;
  hasMonitorGroups?: boolean | undefined;
}) => string = (data: {
  translator: Translator;
  name: string;
  monitorCount: number;
  hasMonitorGroups?: boolean | undefined;
}): string => {
  if (data.hasMonitorGroups) {
    return data.translator.translatePlural(
      {
        one: '"{{name}}" shows {{count}} monitor group.',
        other: '"{{name}}" shows {{count}} monitors and monitor groups.',
      },
      data.monitorCount,
      { name: data.name },
      STATUS_PAGE_NAME_SENTENCE,
    );
  }

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
 * The sentence step 1 opens with when the project has pages this person
 * may change: the page by its name, set apart in the sentence; several, by
 * their count.
 */
export const getExistingPagesLine: (data: {
  translator: Translator;
  pages: ReadonlyArray<StatusPageSetupPage>;
}) => string = (data: {
  translator: Translator;
  pages: ReadonlyArray<StatusPageSetupPage>;
}): string => {
  if (data.pages.length === 1) {
    return data.translator.translateTemplate(
      STATUS_PAGE_SETUP_COPY.existingPageOne,
      { name: data.pages[0]!.name },
      STATUS_PAGE_NAME_SENTENCE,
    );
  }

  return data.translator.translatePlural(
    {
      one: "This project already has {{count}} status page. The monitors you pick are added to the one you choose.",
      other:
        "This project already has {{count}} status pages. The monitors you pick are added to the one you choose.",
    },
    data.pages.length,
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
