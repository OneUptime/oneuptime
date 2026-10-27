import {
  SecurityConnectionCertainty,
  SecurityConnectionChangeJson,
  SecurityConnectionKind,
  SecurityConnectionRecordListJson,
} from "./SecurityConnection";

/*
 * A SECURITY CASE AS THE REST OF ONEUPTIME TELLS IT: its Story and its
 * Impact.
 *
 *   Story    what happened, in order, on one time axis: the detections that
 *            fired and the events behind them - each with how far its
 *            request got and the trace, exception and session it links to -
 *            the exceptions those requests threw, what changed on the
 *            records the case names, the incidents and alerts raised on
 *            them, and what the team and its playbooks did about it.
 *   Impact   what the case puts at risk: the records it names, what they
 *            call and what calls them on the service map, the monitors and
 *            status pages watching them, who owns them and what last
 *            changed on them, the machines its addresses talked to, and
 *            whether OneUptime has seen them reached from the internet.
 *
 * Both are read with the reader's own permissions. A source their role
 * cannot read is said to be (unreadable), and one that could not be read
 * this time too (failed) - never an empty list that looks like "nothing
 * happened". Every read is bounded, and a source that held more than is
 * shown says so (truncated).
 *
 * Free of anything server-only and of React: the server that reads a case's
 * story and the page that draws it agree on every field of this.
 */

/*
 * Where the two are read (Server/API/SecurityCaseContextAPI.ts):
 *
 *   POST /security-case-context/story   { caseId }
 *   POST /security-case-context/impact  { caseId }
 */
export const SECURITY_CASE_CONTEXT_API_PATH: string = "/security-case-context";
export const SECURITY_CASE_STORY_API_PATH: string = `${SECURITY_CASE_CONTEXT_API_PATH}/story`;
export const SECURITY_CASE_IMPACT_API_PATH: string = `${SECURITY_CASE_CONTEXT_API_PATH}/impact`;

// ---------- Story ----------

export enum SecurityCaseStoryItemKind {
  // The case was opened.
  CaseOpened = "CaseOpened",
  // One of the case's detections fired (first), and how often it did since.
  Detection = "Detection",
  // A security event naming the case's entities, or a run of alike ones.
  Events = "Events",
  // An exception a request behind the case's events threw.
  Exception = "Exception",
  // A deploy, a rollout or another change on a record the case names.
  Change = "Change",
  // An incident raised on a record the case names, or declared from it.
  Incident = "Incident",
  // An alert raised on a record the case names.
  Alert = "Alert",
  // A playbook ran on the case.
  PlaybookRun = "PlaybookRun",
  // Somebody wrote a note on the case.
  Note = "Note",
  // The case was acknowledged, contained or closed.
  Milestone = "Milestone",
}

export enum SecurityCaseStoryMilestone {
  Acknowledged = "Acknowledged",
  Contained = "Contained",
  Closed = "Closed",
}

// Where a story's items come from: each read on its own, said when it could not be.
export enum SecurityCaseStorySource {
  Detections = "Detections",
  Events = "Events",
  Exceptions = "Exceptions",
  Changes = "Changes",
  Incidents = "Incidents",
  Alerts = "Alerts",
  PlaybookRuns = "PlaybookRuns",
  Notes = "Notes",
}

/*
 * The groups the story can be narrowed to, as the page offers them: the
 * attack itself, what changed around it, what it set off, and the response.
 */
export enum SecurityCaseStoryFilter {
  All = "All",
  Attack = "Attack",
  Changes = "Changes",
  IncidentsAndAlerts = "IncidentsAndAlerts",
  Response = "Response",
}

export const SECURITY_CASE_STORY_FILTER_OF_KIND: Readonly<
  Record<SecurityCaseStoryItemKind, SecurityCaseStoryFilter>
> = {
  [SecurityCaseStoryItemKind.CaseOpened]: SecurityCaseStoryFilter.Response,
  [SecurityCaseStoryItemKind.Detection]: SecurityCaseStoryFilter.Attack,
  [SecurityCaseStoryItemKind.Events]: SecurityCaseStoryFilter.Attack,
  [SecurityCaseStoryItemKind.Exception]: SecurityCaseStoryFilter.Attack,
  [SecurityCaseStoryItemKind.Change]: SecurityCaseStoryFilter.Changes,
  [SecurityCaseStoryItemKind.Incident]:
    SecurityCaseStoryFilter.IncidentsAndAlerts,
  [SecurityCaseStoryItemKind.Alert]: SecurityCaseStoryFilter.IncidentsAndAlerts,
  [SecurityCaseStoryItemKind.PlaybookRun]: SecurityCaseStoryFilter.Response,
  [SecurityCaseStoryItemKind.Note]: SecurityCaseStoryFilter.Response,
  [SecurityCaseStoryItemKind.Milestone]: SecurityCaseStoryFilter.Response,
};

// What an item opens: the ids its links are built from, each when it has one.
export interface SecurityCaseStoryLinksJson {
  detectionId?: string | undefined;
  eventUid?: string | undefined;
  traceId?: string | undefined;
  spanId?: string | undefined;
  sessionId?: string | undefined;
  // The exception's group (TelemetryException), when the reader may read it.
  exceptionId?: string | undefined;
  exceptionFingerprint?: string | undefined;
  incidentId?: string | undefined;
  alertId?: string | undefined;
  playbookRunId?: string | undefined;
  // The record a change or an incident is on.
  resource?:
    | {
        kind: SecurityConnectionKind;
        id: string;
        name: string;
      }
    | undefined;
  /*
   * The value a run of events is about - the address or user they share -
   * which the Events explorer is opened on.
   */
  observable?: string | undefined;
}

export interface SecurityCaseStoryItemJson {
  // Unique within the story, stable between reads.
  key: string;
  kind: SecurityCaseStoryItemKind;
  // ISO times. A run of events, or a detection that fired again, spans to endTime.
  time: string;
  endTime?: string | undefined;
  /*
   * What the item says, as its source wrote it: a detection's title, an
   * event's message, a change's title, a note's first line. Written by
   * people, products and attackers - drawn as text, never as markup.
   */
  title: string;
  detail?: string | undefined;
  severityName?: string | undefined;
  // How far the request behind an event got (SecurityEventRequestOutcome).
  requestOutcome?: string | undefined;
  /*
   * For a run of events, how many of them took each outcome; an event no
   * request was followed for counts under "".
   */
  outcomes?: Record<string, number> | undefined;
  // Events in a run, or the times a detection fired.
  count?: number | undefined;
  // An event's OCSF class, so a run reads "12 HTTP Activity events".
  className?: string | undefined;
  // A playbook run's status, an incident's or alert's state.
  stateName?: string | undefined;
  stateColor?: string | undefined;
  // "INC-42", "#7": how an incident or alert is numbered.
  number?: string | undefined;
  // Who did it, for a note or a playbook someone started.
  actorName?: string | undefined;
  milestone?: SecurityCaseStoryMilestone | undefined;
  links: SecurityCaseStoryLinksJson;
}

export interface SecurityCaseStoryJson {
  windowStart: string;
  windowEnd: string;
  // Oldest first: a story is read from its beginning.
  items: Array<SecurityCaseStoryItemJson>;
  // Sources that held more than the story shows.
  truncatedSources: Array<SecurityCaseStorySource>;
  // Sources the reader's role cannot read: none of them is shown.
  unreadableSources: Array<SecurityCaseStorySource>;
  // Sources that could not be read this time.
  failedSources: Array<SecurityCaseStorySource>;
}

// The most items a story holds; past it the least telling are left out first.
export const SECURITY_CASE_STORY_MAX_ITEMS: number = 300;
// The most security events read for a story, before they are run together.
export const SECURITY_CASE_STORY_MAX_EVENTS: number = 500;
// The most rows each other source reads.
export const SECURITY_CASE_STORY_MAX_DETECTIONS: number = 100;
export const SECURITY_CASE_STORY_MAX_EXCEPTIONS: number = 50;
export const SECURITY_CASE_STORY_MAX_CHANGES: number = 100;
export const SECURITY_CASE_STORY_MAX_INCIDENTS: number = 50;
export const SECURITY_CASE_STORY_MAX_ALERTS: number = 50;
export const SECURITY_CASE_STORY_MAX_PLAYBOOK_RUNS: number = 50;
export const SECURITY_CASE_STORY_MAX_NOTES: number = 50;
/*
 * Alike events closer together than this are told as one run: a scanner's
 * ninety-six probes are one line of the story, not ninety-six.
 */
export const SECURITY_CASE_STORY_RUN_GAP_IN_MINUTES: number = 30;
// The longest title or detail an item keeps.
export const SECURITY_CASE_STORY_MAX_TEXT_LENGTH: number = 300;

// ---------- Impact ----------

// Where an impact's facts come from: each read on its own, said when it could not be.
export enum SecurityCaseImpactSource {
  Records = "Records",
  Dependencies = "Dependencies",
  Monitors = "Monitors",
  StatusPages = "StatusPages",
  Owners = "Owners",
  Changes = "Changes",
  NetworkFlows = "NetworkFlows",
  Events = "Events",
}

// One thing a record calls, is called by or runs on, on the service map.
export interface SecurityCaseImpactPeerJson {
  key: string;
  name: string;
  type: string;
  callCount: number | null;
  errorCount: number | null;
}

export interface SecurityCaseImpactOwnersJson {
  teams: Array<{ id: string; name: string }>;
  users: Array<{ id: string; name: string }>;
}

/*
 * One record the case names, with what is at risk through it. Each fact is
 * null when it is not known: the record has no place on the service map,
 * the reader's role cannot read that kind of fact, or it could not be read.
 */
export interface SecurityCaseImpactRecordJson {
  kind: SecurityConnectionKind;
  id: string;
  name: string;
  certainty: SecurityConnectionCertainty;
  inventoryItemId?: string | undefined;
  calls: Array<SecurityCaseImpactPeerJson> | null;
  calledBy: Array<SecurityCaseImpactPeerJson> | null;
  runsOn: Array<SecurityCaseImpactPeerJson> | null;
  monitors: SecurityConnectionRecordListJson | null;
  owners: SecurityCaseImpactOwnersJson | null;
  /*
   * What last changed on it before the case's first detection - the deploy
   * an attack may have found - or, with none before, the first after.
   */
  lastChange:
    | (SecurityConnectionChangeJson & {
        version?: string | undefined;
        isBeforeFirstDetection: boolean;
      })
    | null;
}

// A status page that shows a monitor watching one of the case's records.
export interface SecurityCaseImpactStatusPageJson {
  id: string;
  name: string;
  monitorIds: Array<string>;
}

// A machine one of the case's addresses exchanged traffic with, from network flows.
export interface SecurityCaseFlowPeerJson {
  caseAddress: string;
  peerAddress: string;
  // "out": the case's address sent it; "in": it received it.
  direction: "out" | "in";
  bytes: number;
  packets: number;
  lastSeen: string | null;
}

export enum SecurityCaseInternetExposure {
  // OneUptime has seen it reached, or reachable, from the internet.
  Yes = "Yes",
  // Nothing OneUptime holds says either way.
  Unknown = "Unknown",
}

export enum SecurityCaseExposureEvidenceKind {
  // A request from a public address reached the app (its trace says so).
  PublicRequestReachedApp = "PublicRequestReachedApp",
  // The record reports a public address of its own.
  PublicAddress = "PublicAddress",
}

export interface SecurityCaseExposureEvidenceJson {
  kind: SecurityCaseExposureEvidenceKind;
  address: string;
  // The record it is about, when it names one.
  recordName?: string | undefined;
  time?: string | undefined;
  requestOutcome?: string | undefined;
}

export interface SecurityCaseImpactJson {
  windowStart: string;
  windowEnd: string;
  firstDetectedAt: string | null;
  records: Array<SecurityCaseImpactRecordJson>;
  // More records are connected than are listed.
  hasMoreRecords: boolean;
  statusPages: Array<SecurityCaseImpactStatusPageJson> | null;
  flowPeers: Array<SecurityCaseFlowPeerJson> | null;
  internet: {
    exposure: SecurityCaseInternetExposure;
    evidence: Array<SecurityCaseExposureEvidenceJson>;
  };
  unreadableSources: Array<SecurityCaseImpactSource>;
  failedSources: Array<SecurityCaseImpactSource>;
}

// The most peers of each kind listed for one record.
export const SECURITY_CASE_IMPACT_MAX_PEERS: number = 8;
// The most flow peers listed for the case's addresses together.
export const SECURITY_CASE_IMPACT_MAX_FLOW_PEERS: number = 10;
// The most of the case's addresses whose flows are read.
export const SECURITY_CASE_IMPACT_MAX_FLOW_ADDRESSES: number = 10;
export const SECURITY_CASE_IMPACT_MAX_STATUS_PAGES: number = 10;
// The most owners of each kind listed for one record.
export const SECURITY_CASE_IMPACT_MAX_OWNERS: number = 10;
// The most pieces of evidence the internet verdict lists.
export const SECURITY_CASE_IMPACT_MAX_EVIDENCE: number = 5;
/*
 * How far back the service map is read for a record's calls: the week a
 * service talks to everything it normally does.
 */
export const SECURITY_CASE_IMPACT_DEPENDENCY_WINDOW_IN_DAYS: number = 7;
