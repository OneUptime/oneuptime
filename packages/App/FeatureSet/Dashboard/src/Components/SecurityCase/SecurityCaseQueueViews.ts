import PageMap from "../../Utils/PageMap";
import SecurityCase from "Common/Models/DatabaseModels/SecurityCase";
import Includes from "Common/Types/BaseDatabase/Includes";
import IsNull from "Common/Types/BaseDatabase/IsNull";
import Query from "Common/Types/BaseDatabase/Query";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import SecurityCaseStatuses from "Common/Utils/SecurityCase/SecurityCaseStatuses";
import {
  PluralTemplate,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * The questions an analyst asks of the case queue, each a page of its own
 * under Security Cases in the side menu. Open Cases is where a shift
 * starts; Assigned to Me and Unassigned split it between "what am I on" and
 * "what has nobody picked up"; Closed Cases is the record of what was
 * decided; All Cases is every case, to search.
 *
 * They were views along the top of one queue, switched by buttons. Each is
 * now a page with its own address, its own name in the menu, the
 * breadcrumbs and Search, and a list that fits its question: the columns
 * and filters that mean something for those cases, sorted the way they are
 * read, and an empty state that says what an empty list means.
 *
 * Open and closed are what the project's own statuses count as
 * (Security Events > Settings > Case Statuses): every status above its
 * closed status is open, the closed status and every one after it closed
 * (Common/Utils/SecurityCase/SecurityCaseStatuses). So the lists ask for the
 * project's statuses first, and a status renamed or added counts at once.
 *
 * React-free so each page's query and list are pinned in a plain test.
 */

export type SecurityCaseQueueViewKey =
  | "open"
  | "mine"
  | "unassigned"
  | "closed"
  | "all";

// The case list's columns, in the order they are drawn.
export type SecurityCaseQueueColumn =
  | "case"
  | "priority"
  | "status"
  | "verdict"
  | "assignee"
  | "team"
  | "labels"
  | "lastDetection"
  | "closed";

/*
 * The case list's filters, in the order they are offered. AI Verdict - what
 * OneUptime AI's triage read each case as - is offered only while the
 * project's AI is on (withoutAiFilters).
 */
export type SecurityCaseQueueFilter =
  | "title"
  | "priority"
  | "status"
  | "verdict"
  | "aiVerdict"
  | "labels"
  | "opened"
  | "closed";

// The filters that read what OneUptime AI wrote on a case.
export const SECURITY_CASE_AI_FILTERS: ReadonlyArray<SecurityCaseQueueFilter> =
  ["aiVerdict"];

// A list's filters as drawn: with the AI ones only while AI is on.
export function getSecurityCaseQueueFilters(
  view: SecurityCaseQueueView,
  isAiOffered: boolean,
): Array<SecurityCaseQueueFilter> {
  return view.filters.filter((filter: SecurityCaseQueueFilter): boolean => {
    return isAiOffered || !SECURITY_CASE_AI_FILTERS.includes(filter);
  });
}

export type SecurityCaseQueueSort = "lastDetectedAt" | "closedAt";

export interface SecurityCaseQueueView {
  key: SecurityCaseQueueViewKey;
  // The page, and its entry in the side menu.
  page: PageMap;
  // The page's name: its menu entry, card title, breadcrumb and Search.
  title: string;
  // What the list holds, under the card's title.
  description: string;
  // What an empty list says: a headline, then what it means.
  emptyMessage: string;
  icon: IconProp;
  /*
   * An empty list here is good news - nothing open, nothing left for
   * nobody - drawn with a green check, as Active Incidents is, and with no
   * Open button under it: opening a case is not the answer to "all clear".
   */
  isEmptyGoodNews: boolean;
  /*
   * Whether the page offers Open Security Case: the lists a case opened by
   * hand lands in (it opens unassigned). Assigned to Me, Unassigned and
   * Closed Cases are lists to work, not to add to.
   */
  canOpenCase: boolean;
  /*
   * Whether Assign to Me is among the actions on the cases selected: the
   * lists cases are taken on from. Not Assigned to Me, where every case is
   * yours already, nor Closed Cases, where nobody works a case any more.
   */
  canAssignToMe: boolean;
  /*
   * Whether Assign to Someone Else is among the actions on the cases
   * selected: every list cases are worked from, Assigned to Me among them -
   * handing your cases on is what it is for there. Not Closed Cases, where
   * nobody works a case any more.
   */
  canAssignToSomeoneElse: boolean;
  columns: ReadonlyArray<SecurityCaseQueueColumn>;
  /*
   * Columns the list draws only once someone turns them on: the labels,
   * and the time the list is sorted by, which each case's line under its
   * title already says (getSecurityCaseRowMoment).
   */
  hiddenColumns: ReadonlyArray<SecurityCaseQueueColumn>;
  filters: ReadonlyArray<SecurityCaseQueueFilter>;
  sortBy: SecurityCaseQueueSort;
}

// What an open case's list draws.
const OPEN_COLUMNS: ReadonlyArray<SecurityCaseQueueColumn> = [
  "case",
  "priority",
  "status",
  "assignee",
  "labels",
  "lastDetection",
];

/*
 * No open case has a verdict yet: an open list is filtered by where it
 * stands instead - and by what OneUptime AI read it as, to pick up the
 * likely malicious first.
 */
const OPEN_FILTERS: ReadonlyArray<SecurityCaseQueueFilter> = [
  "title",
  "priority",
  "status",
  "aiVerdict",
  "labels",
  "opened",
];

const withoutColumn: (
  columns: ReadonlyArray<SecurityCaseQueueColumn>,
  column: SecurityCaseQueueColumn,
) => Array<SecurityCaseQueueColumn> = (
  columns: ReadonlyArray<SecurityCaseQueueColumn>,
  column: SecurityCaseQueueColumn,
): Array<SecurityCaseQueueColumn> => {
  return columns.filter((candidate: SecurityCaseQueueColumn): boolean => {
    return candidate !== column;
  });
};

export const SECURITY_CASE_QUEUE_VIEWS: ReadonlyArray<SecurityCaseQueueView> = [
  {
    key: "open",
    page: PageMap.SECURITY_CASES,
    title: translationKey("Open Cases"),
    description: translationKey(
      "Every case that is not closed yet, the latest detection first. Pick one up, work it, and close it with a verdict.",
    ),
    emptyMessage: translationKey(
      "No open cases. New ones appear here as detections fire.",
    ),
    icon: IconProp.ShieldExclamation,
    isEmptyGoodNews: true,
    canOpenCase: true,
    canAssignToMe: true,
    canAssignToSomeoneElse: true,
    columns: OPEN_COLUMNS,
    hiddenColumns: ["labels", "lastDetection"],
    filters: OPEN_FILTERS,
    sortBy: "lastDetectedAt",
  },
  {
    key: "mine",
    page: PageMap.SECURITY_CASES_ASSIGNED_TO_ME,
    title: translationKey("Assigned to Me"),
    description: translationKey(
      "The open cases assigned to you, the latest detection first.",
    ),
    emptyMessage: translationKey(
      "No open cases are assigned to you. Pick up one that nobody has taken yet.",
    ),
    icon: IconProp.User,
    isEmptyGoodNews: false,
    canOpenCase: false,
    canAssignToMe: false,
    canAssignToSomeoneElse: true,
    // Every case here is yours: no Assignee column saying so on each row.
    columns: withoutColumn(OPEN_COLUMNS, "assignee"),
    hiddenColumns: ["labels", "lastDetection"],
    filters: OPEN_FILTERS,
    sortBy: "lastDetectedAt",
  },
  {
    key: "unassigned",
    page: PageMap.SECURITY_CASES_UNASSIGNED,
    title: translationKey("Unassigned"),
    description: translationKey(
      "Open cases nobody has picked up yet. Assign one to yourself to take it on.",
    ),
    emptyMessage: translationKey("Every open case has someone on it."),
    // The tray of cases waiting to be picked up; a team draws as UserGroup.
    icon: IconProp.Inbox,
    isEmptyGoodNews: true,
    canOpenCase: false,
    // Taking a case on is what this page is for.
    canAssignToMe: true,
    canAssignToSomeoneElse: true,
    /*
     * No case here has a person on it, so an Assignee column would say
     * Unassigned on every row. A case handed to a team waits here too, and
     * its Team says which team.
     */
    columns: ["case", "priority", "status", "team", "labels", "lastDetection"],
    hiddenColumns: ["labels", "lastDetection"],
    filters: OPEN_FILTERS,
    sortBy: "lastDetectedAt",
  },
  {
    /*
     * The record of what was decided: each case by its verdict and when it
     * closed, the latest first. Every case here is Closed, so there is no
     * Status to show or to filter by.
     */
    key: "closed",
    page: PageMap.SECURITY_CASES_CLOSED,
    title: translationKey("Closed Cases"),
    description: translationKey(
      "Cases closed with a verdict, the most recently closed first.",
    ),
    emptyMessage: translationKey(
      "No closed cases yet. A case moves here when it is closed with a verdict.",
    ),
    icon: IconProp.CheckCircle,
    isEmptyGoodNews: false,
    canOpenCase: false,
    canAssignToMe: false,
    canAssignToSomeoneElse: false,
    columns: ["case", "priority", "verdict", "assignee", "labels", "closed"],
    hiddenColumns: ["labels", "closed"],
    filters: [
      "title",
      "priority",
      "verdict",
      "aiVerdict",
      "labels",
      "opened",
      "closed",
    ],
    sortBy: "closedAt",
  },
  {
    key: "all",
    page: PageMap.SECURITY_CASES_ALL,
    title: translationKey("All Cases"),
    description: translationKey(
      "Every case, open or closed. A case groups the detections about one user, host or address as they fire.",
    ),
    emptyMessage: translationKey(
      "No cases yet. Cases open as detections fire, or open one yourself.",
    ),
    icon: IconProp.RectangleStack,
    isEmptyGoodNews: false,
    canOpenCase: true,
    canAssignToMe: true,
    canAssignToSomeoneElse: true,
    columns: [
      "case",
      "priority",
      "status",
      "verdict",
      "assignee",
      "labels",
      "lastDetection",
    ],
    hiddenColumns: ["verdict", "labels", "lastDetection"],
    filters: [
      "title",
      "priority",
      "status",
      "verdict",
      "aiVerdict",
      "labels",
      "opened",
    ],
    sortBy: "lastDetectedAt",
  },
];

/*
 * What a case's line under its title says of its detections, ending with
 * the time its list is sorted by: when the last one fired, or - on Closed
 * Cases - when the case closed. That time was a column of its own, which
 * ran the queue past its card at 1280 beside the side menu in German,
 * French, Dutch, Norwegian, Swedish and Russian, the rows' last values under
 * the sticky View and ⋯, and which a phone never showed. The column is
 * still there to turn on (hiddenColumns), and still what the list sorts by.
 */
export const SECURITY_CASE_DETECTIONS: PluralTemplate = {
  one: "{{count}} detection",
  other: "{{count}} detections",
};

export const SECURITY_CASE_DETECTIONS_THE_LAST: PluralTemplate = {
  one: "{{count}} detection, {{time}}",
  other: "{{count}} detections, the last {{time}}",
};

export const SECURITY_CASE_DETECTIONS_CLOSED: PluralTemplate = {
  one: "{{count}} detection, closed {{time}}",
  other: "{{count}} detections, closed {{time}}",
};

export interface SecurityCaseRowMoment {
  // The sentence, with {{count}} and - when there is a time - {{time}}.
  template: PluralTemplate;
  // The moment {{time}} stands for: undefined when the case has none.
  time: Date | undefined;
}

/*
 * Which sentence a case's line uses on a list sorted by `sortBy`, and the
 * moment in it. A case with no such moment (opened by hand, nothing
 * detected yet) says how many detections it holds, and nothing more.
 */
export function getSecurityCaseRowMoment(
  sortBy: SecurityCaseQueueSort,
  securityCase: {
    lastDetectedAt?: Date | undefined;
    closedAt?: Date | undefined;
  },
): SecurityCaseRowMoment {
  const time: Date | undefined =
    sortBy === "closedAt" ? securityCase.closedAt : securityCase.lastDetectedAt;

  if (!time) {
    return { template: SECURITY_CASE_DETECTIONS, time: undefined };
  }

  return {
    template:
      sortBy === "closedAt"
        ? SECURITY_CASE_DETECTIONS_CLOSED
        : SECURITY_CASE_DETECTIONS_THE_LAST,
    time: time,
  };
}

// A space a line never breaks at.
export const SECURITY_CASE_NO_BREAK_SPACE: string = String.fromCharCode(0xa0);

/*
 * The time in a case's line, kept whole where the line wraps: in a column
 * beside the side menu the line broke inside it - "vor 5 / Stunden" in
 * German, "31 / минуту назад" in Russian, "9 minutes / ago" on a phone -
 * a number at the end of one line and its unit at the start of the next.
 * Written with spaces no line breaks at, the line wraps before the time or
 * after it, never inside it.
 */
export function keepSecurityCaseTimeWhole(time: string): string {
  return time.split(" ").join(SECURITY_CASE_NO_BREAK_SPACE);
}

export const SECURITY_CASE_QUEUE_VIEW_KEYS: ReadonlyArray<SecurityCaseQueueViewKey> =
  SECURITY_CASE_QUEUE_VIEWS.map(
    (view: SecurityCaseQueueView): SecurityCaseQueueViewKey => {
      return view.key;
    },
  );

// A view by its key; Open Cases for anything else.
export function getSecurityCaseQueueView(
  key: SecurityCaseQueueViewKey | undefined,
): SecurityCaseQueueView {
  return (
    SECURITY_CASE_QUEUE_VIEWS.find((view: SecurityCaseQueueView): boolean => {
      return view.key === key;
    }) || SECURITY_CASE_QUEUE_VIEWS[0]!
  );
}

// The view a page lists, if the page is one of the case queue's.
export function getSecurityCaseQueueViewForPage(
  page: PageMap | undefined,
): SecurityCaseQueueView | undefined {
  return SECURITY_CASE_QUEUE_VIEWS.find(
    (view: SecurityCaseQueueView): boolean => {
      return view.page === page;
    },
  );
}

/*
 * Who "me" is, for Assigned to Me: the person signed in. Nobody signed in -
 * no id, or an empty one - reads as nobody's cases, not everybody's.
 */
export function getSecurityCaseAssigneeForMe(
  currentUserId: ObjectID | undefined,
): ObjectID {
  if (!currentUserId || !currentUserId.toString()) {
    return ObjectID.getZeroObjectID();
  }

  return currentUserId;
}

/*
 * A page's query: its cases, by the project's statuses (`statuses`, models
 * or their JSON) - the open ones, the closed ones, or any.
 */
export function getSecurityCaseQueueQuery(
  view: SecurityCaseQueueViewKey,
  currentUserId: ObjectID | undefined,
  statuses: ReadonlyArray<unknown>,
): Query<SecurityCase> {
  const open: Query<SecurityCase> = {
    securityCaseStatusId: new Includes(
      SecurityCaseStatuses.getOpenStatusIds(statuses),
    ),
  } as Query<SecurityCase>;

  switch (view) {
    case "open":
      return open;
    case "mine":
      return {
        ...open,
        assignedToUserId: getSecurityCaseAssigneeForMe(currentUserId),
      } as Query<SecurityCase>;
    case "unassigned":
      return {
        ...open,
        assignedToUserId: new IsNull(),
      } as Query<SecurityCase>;
    case "closed":
      return {
        securityCaseStatusId: new Includes(
          SecurityCaseStatuses.getClosedStatusIds(statuses),
        ),
      } as Query<SecurityCase>;
    case "all":
    default:
      return {};
  }
}

/*
 * The statuses a list's Status filter offers, in the project's order: an
 * open list only the open ones, so it never offers a closed one, which would
 * empty it.
 */
export function getSecurityCaseQueueStatusOptions<T>(
  view: SecurityCaseQueueViewKey,
  statuses: ReadonlyArray<T>,
): Array<T> {
  if (view === "open" || view === "mine" || view === "unassigned") {
    return SecurityCaseStatuses.getOpenStatuses(statuses);
  }

  return SecurityCaseStatuses.sort(statuses);
}
