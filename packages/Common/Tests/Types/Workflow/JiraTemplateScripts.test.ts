/*
 * Runs every script the Jira templates ship through the same isolated-vm
 * sandbox the workflow runner uses, against payloads shaped like the ones
 * Jira Cloud and OneUptime really send.
 *
 * The scripts are where the Jira templates make their decisions — whether to
 * file an issue, which transition to take, whether a comment is only the echo
 * of one OneUptime posted. A wrong branch in one of them does not fail loudly:
 * the workflow still runs, logs a polite "skipped" line, and the two systems
 * quietly drift apart or start talking to themselves. So each branch is
 * pinned here by what the script returns.
 *
 * The incident and alert templates are built by the same script builders, so
 * every shared behaviour runs once per kind of record (KINDS below). Where the
 * two differ — alerts have no public notes and start with two severities, and
 * an alert is "created" where an incident is "declared" — the alerts get tests
 * of their own, spelled out word for word. The cross-kind tests pin that an
 * issue linked to one kind is never taken for the other.
 *
 * Arguments are built the way the runtime delivers them, which is not the way
 * they read in the template:
 *
 *   - A step output quoted into JSON arguments ("incident": "{{…model}}")
 *     arrives as JSON TEXT, not as an object. quoted() reproduces that.
 *   - A whole-argument reference to the webhook body (read-event-1,
 *     read-comment-1, read-changes-1) arrives as the parsed object itself.
 *   - A reference that did not resolve stays as its literal braces, and a
 *     null step output (a find-one that matched nothing) arrives as the text
 *     "null". Both have to read as "nothing here", never as a crash.
 */

import { describe, expect, jest, test } from "@jest/globals";
import { JSONObject, JSONValue } from "../../../Types/JSON";
import ComponentID from "../../../Types/Workflow/ComponentID";
import {
  JIRA_ALERT_LABEL_PREFIX,
  JIRA_INCIDENT_LABEL_PREFIX,
  JIRA_LINK_LABEL,
  JIRA_SYNCED_FROM_ONEUPTIME_MARKER,
  ONEUPTIME_SYNCED_FROM_JIRA_MARKER,
  WorkflowTemplate,
  WorkflowTemplateCategory,
  getTemplateGraphSpec,
  getWorkflowTemplatesByCategory,
} from "../../../Types/Workflow/Templates";
import {
  ACKNOWLEDGED_STATE,
  ACKNOWLEDGED_STATE_ID,
  ALERT_ACKNOWLEDGED_STATE,
  ALERT_ACKNOWLEDGED_STATE_ID,
  ALERT_CREATED_STATE,
  ALERT_ID,
  ALERT_RESOLVED_STATE,
  ALERT_RESOLVED_STATE_ID,
  ALERT_SEVERITIES,
  ALERT_STATES,
  CREATED_STATE,
  CRITICAL_SEVERITY_ID,
  DONE,
  EMPTY_JIRA_SEARCH,
  HIGH_ALERT_SEVERITY_ID,
  INCIDENT_ID,
  INCIDENT_SEVERITIES,
  INCIDENT_STATES,
  IN_PROGRESS,
  IncidentModelProps,
  JIRA_ISSUE_KEY,
  JIRA_SITE,
  JiraIssueProps,
  LOW_ALERT_SEVERITY_ID,
  MAJOR_SEVERITY_ID,
  MINOR_SEVERITY_ID,
  OTHER_ALERT_ID,
  OTHER_INCIDENT_ID,
  PROJECT_ID,
  RESOLVED_CHANGELOG,
  RESOLVED_STATE,
  RESOLVED_STATE_ID,
  STARTED_CHANGELOG,
  TO_DO,
  TRANSITIONS_FROM_TO_DO,
  alertLabel,
  alertModel,
  alertNoteModel,
  changelogItem,
  incidentLabel,
  incidentModel,
  jiraCommentEvent,
  jiraIssueCreatedEvent,
  jiraIssueLabelsResponse,
  jiraIssueUpdatedEvent,
  jiraSearchResponse,
  jiraStatus,
  jiraTransition,
  jiraUser,
  noteModel,
  quoted,
  runJiraScript,
} from "./JiraTemplateFixtures";

// The sandbox boots a fresh isolate per run, which is far slower than plain JS.
jest.setTimeout(60000);

/* ------------------------------- Helpers ------------------------------- */

type EditCodeFunction = (code: string) => string;

type RunStepFunction = (
  args: JSONValue,
  editCode?: EditCodeFunction | undefined,
) => Promise<JSONObject>;

type StepFunction = (
  templateId: string,
  componentId: string,
) => RunStepFunction;

/** Binds one template's script step, so each test only says what it feeds it. */
const step: StepFunction = (
  templateId: string,
  componentId: string,
): RunStepFunction => {
  return async (
    args: JSONValue,
    editCode?: EditCodeFunction | undefined,
  ): Promise<JSONObject> => {
    return await runJiraScript({
      templateId: templateId,
      componentId: componentId,
      args: args,
      editCode: editCode,
    });
  };
};

type ReplaceInCodeFunction = (
  search: string,
  replacement: string,
) => EditCodeFunction;

/*
 * The scripts are customised by editing one documented line. Replacing that
 * exact line also pins that it is still there to edit: runJiraScript throws
 * when an edit changes nothing.
 */
const replaceInCode: ReplaceInCodeFunction = (
  search: string,
  replacement: string,
): EditCodeFunction => {
  return (code: string): string => {
    return code.replace(search, () => {
      return replacement;
    });
  };
};

type TextOfFunction = (result: JSONObject, key: string) => string;

/** A returned string, failing with the whole result when it is not one. */
const textOf: TextOfFunction = (result: JSONObject, key: string): string => {
  const value: JSONValue | undefined = result[key];

  if (typeof value !== "string") {
    throw new Error(
      `Expected "${key}" to be text, but the script returned ${JSON.stringify(result)}.`,
    );
  }

  return value;
};

type ExpectSkippedFunction = (result: JSONObject, reason: string) => void;

/*
 * A skip is exactly { proceed: false, reason }. The reason is all the run log
 * shows, so it is pinned word for word.
 */
const expectSkipped: ExpectSkippedFunction = (
  result: JSONObject,
  reason: string,
): void => {
  expect(result).toEqual({ proceed: false, reason: reason });
};

/** Every string a result holds, however deeply nested. */
type CollectStringsFunction = (value: JSONValue | undefined) => Array<string>;

const collectStrings: CollectStringsFunction = (
  value: JSONValue | undefined,
): Array<string> => {
  if (typeof value === "string") {
    return [value];
  }

  if (Array.isArray(value)) {
    return (value as Array<JSONValue>).flatMap((entry: JSONValue) => {
      return collectStrings(entry);
    });
  }

  if (value && typeof value === "object") {
    return Object.values(value as JSONObject).flatMap((entry: JSONValue) => {
      return collectStrings(entry);
    });
  }

  return [];
};

type AsArgumentFunction = (value: JSONValue) => JSONValue;

/*
 * A step output quoted into a script's JSON arguments arrives as JSON text.
 * A string is passed through untouched, so a test can hand over the literal
 * braces of a reference that never resolved, or the text "null".
 */
const asArgument: AsArgumentFunction = (value: JSONValue): JSONValue => {
  return typeof value === "string" ? value : quoted(value);
};

type OmitFunction = (value: JSONObject, keys: Array<string>) => JSONObject;

const omit: OmitFunction = (
  value: JSONObject,
  keys: Array<string>,
): JSONObject => {
  const copy: JSONObject = { ...value };

  for (const key of keys) {
    delete copy[key];
  }

  return copy;
};

type WithChangesFunction = (
  event: JSONObject,
  changes: JSONObject,
) => JSONObject;

const withIssue: WithChangesFunction = (
  event: JSONObject,
  changes: JSONObject,
): JSONObject => {
  return { ...event, issue: { ...(event["issue"] as JSONObject), ...changes } };
};

const withIssueFields: WithChangesFunction = (
  event: JSONObject,
  changes: JSONObject,
): JSONObject => {
  const issue: JSONObject = event["issue"] as JSONObject;

  return withIssue(event, {
    fields: { ...(issue["fields"] as JSONObject), ...changes },
  });
};

const withComment: WithChangesFunction = (
  event: JSONObject,
  changes: JSONObject,
): JSONObject => {
  return {
    ...event,
    comment: { ...(event["comment"] as JSONObject), ...changes },
  };
};

type SyncPrivateSwitchFunction = (constantName: string) => EditCodeFunction;

/*
 * Every outbound script documents one line as the switch that lets private
 * records through; replacing it also pins that it is still there.
 */
const syncPrivateSwitch: SyncPrivateSwitchFunction = (
  constantName: string,
): EditCodeFunction => {
  return replaceInCode(
    `const ${constantName} = false;`,
    `const ${constantName} = true;`,
  );
};

/* ---------------------------- The two kinds ---------------------------- */

/** The ids of one kind's templates, in the order the Jira category lists them. */
interface KindTemplateIds {
  createIssue: string;
  transition: string;
  privateNote: string;
  /** Only incidents have public notes. */
  publicNote: string | undefined;
  update: string;
  createRecord: string;
  statusToState: string;
  commentToNote: string;
  changesToNote: string;
}

interface NoteTemplateCase {
  templateId: string;
  noteKind: string;
  run: RunStepFunction;
}

/** Every script step one kind's templates ship, bound and ready to run. */
interface KindSteps {
  prepareIssue: RunStepFunction;
  planTransition: RunStepFunction;
  /** The private-note template, and for incidents the public-note one. */
  noteComments: Array<NoteTemplateCase>;
  updateComment: RunStepFunction;
  prepareRecord: RunStepFunction;
  confirmUnlinked: RunStepFunction;
  readEvent: RunStepFunction;
  decideState: RunStepFunction;
  readComment: RunStepFunction;
  findLink: RunStepFunction;
  readChanges: RunStepFunction;
}

type KindStepsFunction = (
  templates: KindTemplateIds,
  prepareRecordStep: string,
) => KindSteps;

const stepsOf: KindStepsFunction = (
  templates: KindTemplateIds,
  prepareRecordStep: string,
): KindSteps => {
  // The note templates ship separate copies of the script, so each is run.
  const noteComments: Array<NoteTemplateCase> = [
    {
      templateId: templates.privateNote,
      noteKind: "private note",
      run: step(templates.privateNote, "build-comment-1"),
    },
  ];

  if (templates.publicNote) {
    noteComments.push({
      templateId: templates.publicNote,
      noteKind: "public note",
      run: step(templates.publicNote, "build-comment-1"),
    });
  }

  return {
    prepareIssue: step(templates.createIssue, "prepare-issue-1"),
    planTransition: step(templates.transition, "plan-transition-1"),
    noteComments: noteComments,
    updateComment: step(templates.update, "build-comment-1"),
    prepareRecord: step(templates.createRecord, prepareRecordStep),
    confirmUnlinked: step(templates.createRecord, "confirm-unlinked-1"),
    readEvent: step(templates.statusToState, "read-event-1"),
    decideState: step(templates.statusToState, "decide-state-1"),
    readComment: step(templates.commentToNote, "read-comment-1"),
    findLink: step(templates.commentToNote, "find-link-1"),
    readChanges: step(templates.changesToNote, "read-changes-1"),
  };
};

interface PriorityMapping {
  priority: string | null;
  severity: string;
}

// alertModel takes the same props plus isPrivate, so it fits this type too.
type RecordModelFunction = (props?: IncidentModelProps) => JSONObject;

interface RecordNoteProps {
  note?: string | undefined;
  authorName?: string | null | undefined;
}

type RecordNoteFunction = (props?: RecordNoteProps) => JSONObject;

type LabelOfFunction = (recordId?: string) => string;

/*
 * Everything the tests need to know about one kind of record. The words and
 * ids are written out rather than derived from the templates, so a builder
 * that put the wrong word into one kind's script fails here instead of the
 * table reading the template back to itself.
 */
interface RecordKind {
  /** "incident" or "alert": the name in the scripts' arguments, return keys and text. */
  noun: string;
  /** An incident is declared; an alert is created. */
  created: string;
  Created: string;
  number: string;
  id: string;
  otherId: string;
  /** The link label of the record `id`. */
  label: string;
  labelOf: LabelOfFunction;
  /** What an issue OneUptime filed or linked for the record carries. */
  linkLabels: Array<string>;
  labelPrefix: string;
  /** The same prefix as someone might type it by hand. */
  mixedCaseLabelPrefix: string;
  numberField: string;
  severityRelation: string;
  stateRelation: string;
  severityIdKey: string;
  dashboardPath: string;
  prepareRecordStep: string;
  syncPrivateName: string;
  syncPrivate: EditCodeFunction;
  createdState: JSONObject;
  acknowledgedState: JSONObject;
  resolvedState: JSONObject;
  acknowledgedStateId: string;
  resolvedStateId: string;
  /** The project's default states, in the order find-many returns them. */
  states: Array<JSONObject>;
  /** The project's default severities, deliberately out of order. */
  severities: Array<JSONObject>;
  mostSevereName: string;
  mostSevereId: string;
  leastSevereName: string;
  /** What each Jira priority lands on among the default severities. */
  priorities: Array<PriorityMapping>;
  /** The severity ids the High, Medium and Low priorities land on. */
  highMediumLowIds: Array<string>;
  model: RecordModelFunction;
  note: RecordNoteFunction;
  /** What the record and note fixtures hold, as the scripts quote them. */
  title: string;
  description: string;
  severityName: string;
  noteText: string;
  templates: KindTemplateIds;
  steps: KindSteps;
}

const incidentNote: RecordNoteFunction = (
  props?: RecordNoteProps,
): JSONObject => {
  return noteModel({ note: props?.note, authorName: props?.authorName });
};

const alertNote: RecordNoteFunction = (props?: RecordNoteProps): JSONObject => {
  return alertNoteModel({ note: props?.note, authorName: props?.authorName });
};

const INCIDENT_TEMPLATES: KindTemplateIds = {
  createIssue: "jira-create-issue-for-incident",
  transition: "jira-transition-issue-on-incident-state",
  privateNote: "jira-comment-from-incident-private-note",
  publicNote: "jira-comment-from-incident-public-note",
  update: "jira-comment-on-incident-update",
  createRecord: "jira-declare-incident-from-issue",
  statusToState: "jira-status-to-incident-state",
  commentToNote: "jira-comment-to-incident-private-note",
  changesToNote: "jira-issue-changes-to-incident-private-note",
};

const ALERT_TEMPLATES: KindTemplateIds = {
  createIssue: "jira-create-issue-for-alert",
  transition: "jira-transition-issue-on-alert-state",
  privateNote: "jira-comment-from-alert-private-note",
  // Alerts have no public notes, so there is nothing to copy.
  publicNote: undefined,
  update: "jira-comment-on-alert-update",
  createRecord: "jira-create-alert-from-issue",
  statusToState: "jira-status-to-alert-state",
  commentToNote: "jira-comment-to-alert-private-note",
  changesToNote: "jira-issue-changes-to-alert-private-note",
};

const INCIDENT: RecordKind = {
  noun: "incident",
  created: "declared",
  Created: "Declared",
  number: "INC-42",
  id: INCIDENT_ID,
  otherId: OTHER_INCIDENT_ID,
  label: incidentLabel(),
  labelOf: incidentLabel,
  linkLabels: [JIRA_LINK_LABEL, incidentLabel()],
  labelPrefix: JIRA_INCIDENT_LABEL_PREFIX,
  mixedCaseLabelPrefix: "OneUptime-Incident-",
  numberField: "incidentNumberWithPrefix",
  severityRelation: "incidentSeverity",
  stateRelation: "currentIncidentState",
  severityIdKey: "incidentSeverityId",
  dashboardPath: "incidents",
  prepareRecordStep: "prepare-incident-1",
  syncPrivateName: "SYNC_PRIVATE_INCIDENTS",
  syncPrivate: syncPrivateSwitch("SYNC_PRIVATE_INCIDENTS"),
  createdState: CREATED_STATE,
  acknowledgedState: ACKNOWLEDGED_STATE,
  resolvedState: RESOLVED_STATE,
  acknowledgedStateId: ACKNOWLEDGED_STATE_ID,
  resolvedStateId: RESOLVED_STATE_ID,
  states: INCIDENT_STATES,
  severities: INCIDENT_SEVERITIES,
  mostSevereName: "Critical Incident",
  mostSevereId: CRITICAL_SEVERITY_ID,
  leastSevereName: "Minor Incident",
  priorities: [
    { priority: "Highest", severity: "Critical Incident" },
    { priority: "High", severity: "Critical Incident" },
    { priority: "Blocker", severity: "Critical Incident" },
    { priority: "Critical", severity: "Critical Incident" },
    { priority: "HIGHEST", severity: "Critical Incident" },
    { priority: "Medium", severity: "Major Incident" },
    { priority: "Major", severity: "Major Incident" },
    { priority: "Low", severity: "Minor Incident" },
    { priority: "Lowest", severity: "Minor Incident" },
    { priority: "Minor", severity: "Minor Incident" },
    { priority: "Trivial", severity: "Minor Incident" },
    // Not listed, or no priority at all: the middle of the range.
    { priority: "P2 - Urgent-ish", severity: "Major Incident" },
    { priority: null, severity: "Major Incident" },
  ],
  highMediumLowIds: [
    CRITICAL_SEVERITY_ID,
    MAJOR_SEVERITY_ID,
    MINOR_SEVERITY_ID,
  ],
  model: incidentModel,
  note: incidentNote,
  title: "Checkout latency high",
  description:
    'p99 latency on /checkout is above 2s.\nStarted after the "v4.2" deploy.',
  severityName: "Critical Incident",
  noteText:
    "Failed over to the **secondary** database. Error rate is dropping.",
  templates: INCIDENT_TEMPLATES,
  steps: stepsOf(INCIDENT_TEMPLATES, "prepare-incident-1"),
};

const ALERT: RecordKind = {
  noun: "alert",
  created: "created",
  Created: "Created",
  number: "ALT-7",
  id: ALERT_ID,
  otherId: OTHER_ALERT_ID,
  label: alertLabel(),
  labelOf: alertLabel,
  linkLabels: [JIRA_LINK_LABEL, alertLabel()],
  labelPrefix: JIRA_ALERT_LABEL_PREFIX,
  mixedCaseLabelPrefix: "OneUptime-Alert-",
  numberField: "alertNumberWithPrefix",
  severityRelation: "alertSeverity",
  stateRelation: "currentAlertState",
  severityIdKey: "alertSeverityId",
  dashboardPath: "alerts",
  prepareRecordStep: "prepare-alert-1",
  syncPrivateName: "SYNC_PRIVATE_ALERTS",
  syncPrivate: syncPrivateSwitch("SYNC_PRIVATE_ALERTS"),
  createdState: ALERT_CREATED_STATE,
  acknowledgedState: ALERT_ACKNOWLEDGED_STATE,
  resolvedState: ALERT_RESOLVED_STATE,
  acknowledgedStateId: ALERT_ACKNOWLEDGED_STATE_ID,
  resolvedStateId: ALERT_RESOLVED_STATE_ID,
  states: ALERT_STATES,
  severities: ALERT_SEVERITIES,
  mostSevereName: "High",
  mostSevereId: HIGH_ALERT_SEVERITY_ID,
  leastSevereName: "Low",
  /*
   * Two severities have no middle: rank 1 of 0 to 2 lands halfway between
   * them, which rounds to the less severe one. So Medium, Major and every
   * priority that is not listed become Low.
   */
  priorities: [
    { priority: "Highest", severity: "High" },
    { priority: "High", severity: "High" },
    { priority: "Blocker", severity: "High" },
    { priority: "Critical", severity: "High" },
    { priority: "HIGHEST", severity: "High" },
    { priority: "Medium", severity: "Low" },
    { priority: "Major", severity: "Low" },
    { priority: "Low", severity: "Low" },
    { priority: "Lowest", severity: "Low" },
    { priority: "Minor", severity: "Low" },
    { priority: "Trivial", severity: "Low" },
    { priority: "P2 - Urgent-ish", severity: "Low" },
    { priority: null, severity: "Low" },
  ],
  highMediumLowIds: [
    HIGH_ALERT_SEVERITY_ID,
    LOW_ALERT_SEVERITY_ID,
    LOW_ALERT_SEVERITY_ID,
  ],
  model: alertModel,
  note: alertNote,
  title: "Disk usage above 90% on db-1",
  description: 'The "db-1" volume is at 93%.\nIt grew 4% in the last hour.',
  severityName: "High",
  noteText: "Cleared old WAL segments. Usage is back to 71%.",
  templates: ALERT_TEMPLATES,
  steps: stepsOf(ALERT_TEMPLATES, "prepare-alert-1"),
};

const KINDS: Array<RecordKind> = [INCIDENT, ALERT];

interface KindPair {
  kind: RecordKind;
  other: RecordKind;
}

const CROSS_KINDS: Array<KindPair> = [
  { kind: INCIDENT, other: ALERT },
  { kind: ALERT, other: INCIDENT },
];

/* ------------------------------- Fixtures ------------------------------- */

const ISSUE_LINK: string = `[${JIRA_ISSUE_KEY}](${JIRA_SITE}/browse/${JIRA_ISSUE_KEY})`;
const ONEUPTIME_URL: string = "https://oneuptime.com";

type KindTextFunction = (kind: RecordKind) => string;

/** Why the outbound scripts skip when no issue carries the record's label. */
const noIssueReason: KindTextFunction = (kind: RecordKind): string => {
  return `No Jira issue is labelled ${kind.label}, or the Jira credentials cannot see it.`;
};

/** Why the create-from-Jira template makes nothing of an issue that is linked. */
const alreadyLinkedReason: KindTextFunction = (kind: RecordKind): string => {
  return `Jira issue OPS-17 is already linked to OneUptime, so no ${kind.noun} was ${kind.created}.`;
};

const notReturnedReason: KindTextFunction = (kind: RecordKind): string => {
  return `Jira did not return the issue, so no ${kind.noun} was ${kind.created}.`;
};

/** Why the Jira -> OneUptime readers skip an issue with no label of their kind. */
const notLinkedReason: KindTextFunction = (kind: RecordKind): string => {
  return `Jira issue ${JIRA_ISSUE_KEY} is not linked to an ${kind.noun}: it has no ${kind.labelPrefix}<id> label.`;
};

const NOT_A_JIRA_EVENT_REASON: string =
  "The request was not a Jira webhook event, so it was ignored.";
const NO_ISSUE_KEY_REASON: string = "The event did not name a Jira issue key.";
const NOTHING_WORTH_A_NOTE_REASON: string =
  "Nothing that changed on Jira issue OPS-17 is worth a note.";

/** A second issue carrying the record's label, as a clone of OPS-17 would. */
const CLONE_ISSUE_KEY: string = "OPS-30";

type IssueKeysReasonFunction = (
  kind: RecordKind,
  keys: Array<string>,
) => string;

/** Why the outbound scripts refuse to pick one of several labelled issues. */
const moreThanOneReason: IssueKeysReasonFunction = (
  kind: RecordKind,
  keys: Array<string>,
): string => {
  return `More than one Jira issue is labelled ${kind.label} (${keys.join(", ")}). A cloned issue copies the label: remove it from every issue except the one filed for the ${kind.noun}.`;
};

type NoChoiceReasonFunction = (from: string, to: string) => string;

/** Why plan-transition-1 found nothing it may choose on its own. */
const noChoiceReason: NoChoiceReasonFunction = (
  from: string,
  to: string,
): string => {
  return `Jira issue ${JIRA_ISSUE_KEY} has no transition from ${from} to ${to} that can be chosen without naming it in STATE_TO_JIRA_STATUS.`;
};

type TiedReasonFunction = (names: Array<string>, wanted: string) => string;

/** Why plan-transition-1 will not guess between equally good statuses. */
const tiedReason: TiedReasonFunction = (
  names: Array<string>,
  wanted: string,
): string => {
  return `Jira issue ${JIRA_ISSUE_KEY} could move to ${names.join(" or ")} for ${wanted}. Name the one to use in STATE_TO_JIRA_STATUS.`;
};

type SearchWithKeysFunction = (keys: Array<JSONValue>) => JSONObject;

/*
 * A label search that matched one issue per key, in the order Jira returned
 * them. Each is the full search hit (status, transitions) the scripts read.
 */
const searchWithKeys: SearchWithKeysFunction = (
  keys: Array<JSONValue>,
): JSONObject => {
  return jiraSearchResponse({
    issues: keys.map((key: JSONValue): JSONObject => {
      const hit: JSONObject = (
        jiraSearchResponse()["issues"] as Array<JSONObject>
      )[0] as JSONObject;

      return { ...hit, key: key };
    }),
  });
};

type WithPrivacyFunction = (
  record: JSONObject,
  isPrivate: boolean | undefined,
) => JSONObject;

/*
 * The fixtures carry no isPrivate, as a trigger saved before the templates
 * selected it would not. undefined keeps it that way.
 */
const withPrivacy: WithPrivacyFunction = (
  record: JSONObject,
  isPrivate: boolean | undefined,
): JSONObject => {
  return isPrivate === undefined ? record : { ...record, isPrivate: isPrivate };
};

type NoteOnRecordFunction = (
  kind: RecordKind,
  isPrivate: boolean | undefined,
  note?: string | undefined,
) => JSONObject;

/** A note whose hydrated incident or alert is, or is not, private. */
const noteOnRecord: NoteOnRecordFunction = (
  kind: RecordKind,
  isPrivate: boolean | undefined,
  note?: string | undefined,
): JSONObject => {
  const model: JSONObject = kind.note({ note: note });

  return {
    ...model,
    [kind.noun]: withPrivacy(model[kind.noun] as JSONObject, isPrivate),
  };
};

type LinkedUpdateFunction = (
  kind: RecordKind,
  items: Array<JSONObject>,
  props?: (JiraIssueProps & { user?: JSONObject | undefined }) | undefined,
) => JSONObject;

/** A jira:issue_updated event on the issue OneUptime linked to the kind's record. */
const linkedUpdate: LinkedUpdateFunction = (
  kind: RecordKind,
  items: Array<JSONObject>,
  props?: (JiraIssueProps & { user?: JSONObject | undefined }) | undefined,
): JSONObject => {
  return jiraIssueUpdatedEvent({
    labels: kind.linkLabels,
    ...props,
    items: items,
  });
};

/*
 * What a Jira user would write to read a secret back out: a reference to the
 * Basic auth variable, plus runs of braces that a single split would only
 * half break up.
 */
const SECRET_REFERENCE: string = "{{local.variables.jiraBasicAuthToken}}";
const DEFUSED_SECRET_REFERENCE: string =
  "{ {local.variables.jiraBasicAuthToken} }";
const ADVERSARIAL_TEXT: string = `Leak ${SECRET_REFERENCE} and {{{{local.components.find-incident-1.returnValues.model}}}} {{#each x}}{{this}}{{/each}}`;

/** Keys the runtime leaves as literal braces when a step never produced them. */
const UNRESOLVED_SEARCH: string =
  "{{local.components.find-issue-1.returnValues.response-body}}";
const UNRESOLVED_STATES: string =
  "{{local.components.find-states-1.returnValues.models}}";

const unresolvedRecord: KindTextFunction = (kind: RecordKind): string => {
  return `{{local.components.find-${kind.noun}-1.returnValues.model}}`;
};

const IN_REVIEW: JSONObject = jiraStatus({
  name: "In Review",
  categoryKey: "indeterminate",
  id: "10005",
});
const SEND_FOR_REVIEW: JSONObject = jiraTransition({
  id: "51",
  name: "Send for review",
  to: IN_REVIEW,
});

const MONITORING_STATE_ID: string = "aaaaaaaa-0000-4000-8000-000000000004";

/* A custom state a project can add to either kind; the scripts read only its name and flags. */
const MONITORING_STATE: JSONObject = {
  _id: MONITORING_STATE_ID,
  name: "Monitoring",
  order: 3,
  isCreatedState: false,
  isAcknowledgedState: false,
  isResolvedState: false,
};

type StatesWithMonitoringFunction = (kind: RecordKind) => Array<JSONObject>;

/** A project that added a Monitoring state between Acknowledged and Resolved. */
const statesWithMonitoring: StatesWithMonitoringFunction = (
  kind: RecordKind,
): Array<JSONObject> => {
  return [
    { ...kind.resolvedState, order: 4 },
    MONITORING_STATE,
    kind.createdState,
    kind.acknowledgedState,
  ];
};

/*
 * Rich text in Atlassian Document Format: two paragraphs, the first with a
 * hard line break in it. Webhooks send wiki markup, but the scripts accept
 * either.
 */
const ADF_TEXT: JSONObject = {
  type: "doc",
  version: 1,
  content: [
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Customers in eu-west-1 see 502s." },
        { type: "hardBreak" },
        { type: "text", text: "Started around 09:40 UTC." },
      ],
    },
    {
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "Rolled back at 10:05.",
          marks: [{ type: "strong" }],
        },
      ],
    },
  ],
};
const ADF_AS_TEXT: string =
  "Customers in eu-west-1 see 502s.\nStarted around 09:40 UTC.\nRolled back at 10:05.";

/* Changelog items as Jira Cloud sends them, custom-field ids included. */
const PRIORITY_RAISED: JSONObject = changelogItem({
  field: "priority",
  from: "2",
  fromString: "High",
  to: "1",
  toString: "Highest",
});
const ASSIGNED: JSONObject = changelogItem({
  field: "assignee",
  from: null,
  fromString: null,
  to: "712020:0f3c5a4e-marco",
  toString: "Marco Rossi",
});
const SUMMARY_CHANGED: JSONObject = changelogItem({
  field: "summary",
  fromString: "Checkout API returns 502 for EU customers",
  toString: "Checkout API returns 502 for all customers",
});
const DESCRIPTION_CHANGED: JSONObject = changelogItem({
  field: "description",
  fromString:
    "Customers in *eu-west-1* see 502s at checkout.\nStarted around 09:40 UTC.",
  toString: "Customers in every region see 502s at checkout.",
});
// Rank is a custom field: its fieldId is the site's customfield id, not "rank".
const RANKED: JSONObject = {
  field: "Rank",
  fieldtype: "custom",
  fieldId: "customfield_10019",
  from: "",
  fromString: "",
  to: "",
  toString: "Ranked higher",
};
const TIME_LOGGED: Array<JSONObject> = [
  changelogItem({
    field: "timespent",
    fromString: null,
    to: "3600",
    toString: "3600",
  }),
  changelogItem({
    field: "WorklogId",
    fieldId: "worklogId",
    fromString: null,
    to: "10100",
    toString: "10100",
  }),
];

type LabelsChangedFunction = (
  fromString: string,
  toString: string,
) => JSONObject;

const labelsChanged: LabelsChangedFunction = (
  fromString: string,
  toString: string,
): JSONObject => {
  return changelogItem({
    field: "labels",
    fromString: fromString,
    toString: toString,
  });
};

/* ------------------------- OneUptime -> Jira ------------------------- */

type IssueArgsFunction = (
  kind: RecordKind,
  record: JSONValue,
  oneuptimeUrl?: string | undefined,
) => JSONObject;

const issueArgs: IssueArgsFunction = (
  kind: RecordKind,
  record: JSONValue,
  oneuptimeUrl?: string | undefined,
): JSONObject => {
  return {
    oneuptimeUrl: oneuptimeUrl === undefined ? ONEUPTIME_URL : oneuptimeUrl,
    [kind.noun]: asArgument(record),
  };
};

for (const kind of KINDS) {
  const prepareIssue: RunStepFunction = kind.steps.prepareIssue;
  const recordPage: string = `/dashboard/${PROJECT_ID}/${kind.dashboardPath}/${kind.id}`;

  describe(`prepare-issue-1 shapes a new ${kind.noun} into a Jira issue`, () => {
    test(`writes the summary, description, link label and link back to the ${kind.noun}`, async () => {
      const result: JSONObject = await prepareIssue(
        issueArgs(kind, kind.model()),
      );

      expect(result).toEqual({
        proceed: true,
        summary: `[OneUptime] ${kind.number}: ${kind.title}`,
        description: `${kind.number} was ${kind.created} in OneUptime.\nSeverity: ${kind.severityName}\nState: Identified\n\n${kind.description}`,
        [`${kind.noun}Label`]: kind.label,
        [`${kind.noun}Url`]: `https://oneuptime.com${recordPage}`,
      });
    });

    test("the label it writes is the one every other template searches for", async () => {
      const result: JSONObject = await prepareIssue(
        issueArgs(kind, kind.model()),
      );

      expect(textOf(result, `${kind.noun}Label`)).toBe(
        `${kind.labelPrefix}${kind.id}`,
      );
    });

    test("tidies the OneUptime URL however it was typed", async () => {
      const cases: Array<{ typed: string; base: string }> = [
        {
          typed: "https://status.acme.com///",
          base: "https://status.acme.com",
        },
        { typed: "  https://oneuptime.com/  ", base: "https://oneuptime.com" },
        {
          typed: "oneuptime.acme.internal/",
          base: "https://oneuptime.acme.internal",
        },
        { typed: "http://localhost:3002", base: "http://localhost:3002" },
        {
          typed: "HTTPS://OneUptime.Acme.com",
          base: "HTTPS://OneUptime.Acme.com",
        },
      ];

      for (const oneuptimeUrl of cases) {
        const result: JSONObject = await prepareIssue(
          issueArgs(kind, kind.model(), oneuptimeUrl.typed),
        );

        expect(textOf(result, `${kind.noun}Url`)).toBe(
          `${oneuptimeUrl.base}${recordPage}`,
        );
      }
    });

    test("folds a title with line breaks, tabs and control characters onto one line", async () => {
      const result: JSONObject = await prepareIssue(
        issueArgs(
          kind,
          kind.model({ title: "Checkout\n\tlatency\u0000 high\r\n\u0007" }),
        ),
      );

      // Jira rejects a summary with a line break in it.
      expect(textOf(result, "summary")).toBe(
        `[OneUptime] ${kind.number}: Checkout latency high`,
      );
    });

    test("caps the summary at Jira's 255 characters", async () => {
      const result: JSONObject = await prepareIssue(
        issueArgs(kind, kind.model({ title: "x".repeat(400) })),
      );
      const summary: string = textOf(result, "summary");

      expect(summary).toHaveLength(255);
      expect(summary.startsWith(`[OneUptime] ${kind.number}: xxx`)).toBe(true);
      expect(summary.endsWith("…")).toBe(true);
    });

    test(`names an untitled ${kind.noun} rather than sending an empty summary`, async () => {
      const result: JSONObject = await prepareIssue(
        issueArgs(kind, kind.model({ title: "" })),
      );

      expect(textOf(result, "summary")).toBe(
        `[OneUptime] ${kind.number}: Untitled ${kind.noun}`,
      );
    });

    test("caps the description at 30000 characters", async () => {
      const result: JSONObject = await prepareIssue(
        issueArgs(kind, kind.model({ description: "y".repeat(40000) })),
      );
      const description: string = textOf(result, "description");

      expect(description).toHaveLength(30000);
      expect(description.endsWith("…")).toBe(true);
    });

    test(`leaves the description block out when the ${kind.noun} has none`, async () => {
      const result: JSONObject = await prepareIssue(
        issueArgs(kind, kind.model({ description: null })),
      );

      expect(textOf(result, "description")).toBe(
        `${kind.number} was ${kind.created} in OneUptime.\nSeverity: ${kind.severityName}\nState: Identified`,
      );
    });

    test("leaves severity and state out when the trigger did not hydrate them", async () => {
      const result: JSONObject = await prepareIssue(
        issueArgs(
          kind,
          omit(kind.model(), [kind.severityRelation, kind.stateRelation]),
        ),
      );

      expect(textOf(result, "description")).toBe(
        `${kind.number} was ${kind.created} in OneUptime.\n\n${kind.description}`,
      );
    });

    test("defuses double braces in the title and description", async () => {
      const result: JSONObject = await prepareIssue(
        issueArgs(
          kind,
          kind.model({
            title: `Leak ${SECRET_REFERENCE}`,
            description: `See ${SECRET_REFERENCE}`,
          }),
        ),
      );

      expect(textOf(result, "summary")).toBe(
        `[OneUptime] ${kind.number}: Leak ${DEFUSED_SECRET_REFERENCE}`,
      );
      expect(textOf(result, "description")).toContain(
        `See ${DEFUSED_SECRET_REFERENCE}`,
      );
      expect(textOf(result, "summary")).not.toContain("{{");
      expect(textOf(result, "description")).not.toContain("{{");
    });

    test(`files no issue for an ${kind.noun} ${kind.created} from Jira, naming its issue`, async () => {
      const result: JSONObject = await prepareIssue(
        issueArgs(
          kind,
          kind.model({ customFields: { jiraIssueKey: "OPS-17" } }),
        ),
      );

      expectSkipped(
        result,
        `${kind.number} was ${kind.created} from Jira issue OPS-17, so no new issue was created.`,
      );
    });

    test("files an issue when custom fields are missing or hold other keys", async () => {
      for (const customFields of [null, { team: "payments" }]) {
        const result: JSONObject = await prepareIssue(
          issueArgs(kind, kind.model({ customFields: customFields })),
        );

        expect(result["proceed"]).toBe(true);
      }
    });

    test(`files no issue when the ${kind.noun} has no usable id`, async () => {
      // The label is the only link, so an issue without an id could never be found again.
      const records: Array<JSONObject> = [
        omit(kind.model(), ["_id"]),
        kind.model({ _id: kind.number }),
        { ...kind.model(), _id: { _type: "ObjectID", value: kind.id } },
      ];

      for (const record of records) {
        expectSkipped(
          await prepareIssue(issueArgs(kind, record)),
          `The trigger did not hand over an ${kind.noun} id.`,
        );
      }
    });

    test("files no issue when the trigger output never resolved", async () => {
      expectSkipped(
        await prepareIssue(
          issueArgs(
            kind,
            `{{local.components.${kind.noun}-on-create-1.returnValues.model}}`,
          ),
        ),
        `The trigger did not hand over an ${kind.noun} id.`,
      );
    });
  });
}

type TransitionArgsFunction = (
  kind: RecordKind,
  state: JSONObject,
  search: JSONValue,
) => JSONObject;

const transitionArgs: TransitionArgsFunction = (
  kind: RecordKind,
  state: JSONObject,
  search: JSONValue,
): JSONObject => {
  return {
    [kind.noun]: quoted(kind.model({ state: state })),
    search: asArgument(search),
  };
};

const MAP_MONITORING_TO_IN_REVIEW: EditCodeFunction = replaceInCode(
  "const STATE_TO_JIRA_STATUS = {};",
  "const STATE_TO_JIRA_STATUS = { Monitoring: 'in review' };",
);

for (const kind of KINDS) {
  const planTransition: RunStepFunction = kind.steps.planTransition;

  describe(`plan-transition-1 picks the Jira transition for the ${kind.noun}'s new state`, () => {
    test(`moves the issue of an acknowledged ${kind.noun} to In Progress`, async () => {
      const result: JSONObject = await planTransition(
        transitionArgs(kind, kind.acknowledgedState, jiraSearchResponse()),
      );

      expect(result).toEqual({
        proceed: true,
        issueKey: JIRA_ISSUE_KEY,
        transitionId: "21",
        jiraStatus: "In Progress",
        reason: `${kind.number} is Acknowledged in OneUptime.`,
      });
    });

    test(`moves the issue of a resolved ${kind.noun} to Done`, async () => {
      const result: JSONObject = await planTransition(
        transitionArgs(kind, kind.resolvedState, jiraSearchResponse()),
      );

      expect(result).toEqual({
        proceed: true,
        issueKey: JIRA_ISSUE_KEY,
        transitionId: "31",
        jiraStatus: "Done",
        reason: `${kind.number} is Resolved in OneUptime.`,
      });
    });

    test("leaves an issue alone that is already in an In Progress status", async () => {
      expectSkipped(
        await planTransition(
          transitionArgs(
            kind,
            kind.acknowledgedState,
            jiraSearchResponse({ status: IN_PROGRESS }),
          ),
        ),
        "Jira issue OPS-17 is already In Progress.",
      );
    });

    test("goes by status category, so any Done status counts as done", async () => {
      const closed: JSONObject = jiraStatus({
        name: "Closed",
        categoryKey: "done",
        id: "6",
      });

      expectSkipped(
        await planTransition(
          transitionArgs(
            kind,
            kind.resolvedState,
            jiraSearchResponse({ status: closed }),
          ),
        ),
        "Jira issue OPS-17 is already Closed.",
      );
    });

    test("does nothing for the created state", async () => {
      expectSkipped(
        await planTransition(
          transitionArgs(kind, kind.createdState, jiraSearchResponse()),
        ),
        `${kind.number} moved to Identified, which has no Jira status mapped to it.`,
      );
    });

    test("does nothing for a custom state nobody mapped", async () => {
      expectSkipped(
        await planTransition(
          transitionArgs(kind, MONITORING_STATE, jiraSearchResponse()),
        ),
        `${kind.number} moved to Monitoring, which has no Jira status mapped to it.`,
      );
    });

    test("skips, naming the label, when no issue carries it", async () => {
      for (const search of [EMPTY_JIRA_SEARCH, UNRESOLVED_SEARCH, "null"]) {
        expectSkipped(
          await planTransition(
            transitionArgs(kind, kind.acknowledgedState, search),
          ),
          noIssueReason(kind),
        );
      }
    });

    test("skips an issue whose key fails validation", async () => {
      // The key goes into the transition URL unescaped.
      for (const key of ["../../myself", "OPS 17"]) {
        expectSkipped(
          await planTransition(
            transitionArgs(
              kind,
              kind.acknowledgedState,
              jiraSearchResponse({ key: key }),
            ),
          ),
          noIssueReason(kind),
        );
      }
    });

    test("passes over a transition Jira marks unavailable", async () => {
      const working: JSONObject = jiraStatus({
        name: "Working",
        categoryKey: "indeterminate",
        id: "5",
      });
      const result: JSONObject = await planTransition(
        transitionArgs(
          kind,
          kind.acknowledgedState,
          jiraSearchResponse({
            transitions: [
              jiraTransition({
                id: "21",
                name: "Start work",
                to: IN_PROGRESS,
                isAvailable: false,
              }),
              jiraTransition({ id: "41", name: "Pick up", to: working }),
            ],
          }),
        ),
      );

      expect(result["transitionId"]).toBe("41");
      expect(result["jiraStatus"]).toBe("Working");
    });

    test("skips when the only way to the status is unavailable", async () => {
      expectSkipped(
        await planTransition(
          transitionArgs(
            kind,
            kind.acknowledgedState,
            jiraSearchResponse({
              transitions: [
                jiraTransition({ id: "11", name: "To Do", to: TO_DO }),
                jiraTransition({
                  id: "21",
                  name: "Start work",
                  to: IN_PROGRESS,
                  isAvailable: false,
                }),
              ],
            }),
          ),
        ),
        noChoiceReason("To Do", "an In Progress status"),
      );
    });

    test("prefers a transition without a screen, which never asks for fields", async () => {
      const result: JSONObject = await planTransition(
        transitionArgs(
          kind,
          kind.acknowledgedState,
          jiraSearchResponse({
            transitions: [
              jiraTransition({
                id: "21",
                name: "Start work",
                to: IN_PROGRESS,
                hasScreen: true,
              }),
              jiraTransition({
                id: "22",
                name: "Start quietly",
                to: IN_PROGRESS,
                hasScreen: false,
              }),
            ],
          }),
        ),
      );

      expect(result["transitionId"]).toBe("22");
    });

    test("still takes a transition with a screen when it is the only way there", async () => {
      const result: JSONObject = await planTransition(
        transitionArgs(
          kind,
          kind.acknowledgedState,
          jiraSearchResponse({
            transitions: [
              jiraTransition({
                id: "21",
                name: "Start work",
                to: IN_PROGRESS,
                hasScreen: true,
              }),
            ],
          }),
        ),
      );

      expect(result["transitionId"]).toBe("21");
    });

    test("matches where a transition leads, not what it is called", async () => {
      const result: JSONObject = await planTransition(
        transitionArgs(
          kind,
          kind.resolvedState,
          jiraSearchResponse({
            transitions: [
              jiraTransition({ id: "71", name: "Done", to: IN_PROGRESS }),
              jiraTransition({ id: "72", name: "Finish", to: DONE }),
            ],
          }),
        ),
      );

      expect(result["transitionId"]).toBe("72");
    });

    test("skips, naming the current status, when no transition leads to Done", async () => {
      expectSkipped(
        await planTransition(
          transitionArgs(
            kind,
            kind.resolvedState,
            jiraSearchResponse({
              transitions: [
                jiraTransition({ id: "11", name: "To Do", to: TO_DO }),
                jiraTransition({
                  id: "21",
                  name: "Start work",
                  to: IN_PROGRESS,
                }),
              ],
            }),
          ),
        ),
        noChoiceReason("To Do", "a Done status"),
      );
    });

    test("skips when the search did not expand the issue's transitions", async () => {
      expectSkipped(
        await planTransition(
          transitionArgs(kind, kind.acknowledgedState, {
            issues: [{ key: JIRA_ISSUE_KEY, fields: { status: TO_DO } }],
            isLast: true,
          }),
        ),
        noChoiceReason("To Do", "an In Progress status"),
      );
    });

    test("STATE_TO_JIRA_STATUS maps a custom state to a Jira status by name, in any case", async () => {
      const result: JSONObject = await planTransition(
        transitionArgs(
          kind,
          MONITORING_STATE,
          jiraSearchResponse({
            transitions: [...TRANSITIONS_FROM_TO_DO, SEND_FOR_REVIEW],
          }),
        ),
        MAP_MONITORING_TO_IN_REVIEW,
      );

      expect(result).toEqual({
        proceed: true,
        issueKey: JIRA_ISSUE_KEY,
        transitionId: "51",
        jiraStatus: "In Review",
        reason: `${kind.number} is Monitoring in OneUptime.`,
      });
    });

    test("a name in STATE_TO_JIRA_STATUS wins over what the state means", async () => {
      const result: JSONObject = await planTransition(
        transitionArgs(
          kind,
          kind.acknowledgedState,
          jiraSearchResponse({
            transitions: [...TRANSITIONS_FROM_TO_DO, SEND_FOR_REVIEW],
          }),
        ),
        replaceInCode(
          "const STATE_TO_JIRA_STATUS = {};",
          "const STATE_TO_JIRA_STATUS = { Acknowledged: 'In Review' };",
        ),
      );

      // Start work also leads to an In Progress-category status, but the name was asked for.
      expect(result["transitionId"]).toBe("51");
    });

    test("a mapped status the issue is already in is skipped", async () => {
      expectSkipped(
        await planTransition(
          transitionArgs(
            kind,
            MONITORING_STATE,
            jiraSearchResponse({ status: IN_REVIEW }),
          ),
          MAP_MONITORING_TO_IN_REVIEW,
        ),
        "Jira issue OPS-17 is already In Review.",
      );
    });

    test("a mapped status the issue cannot reach is skipped", async () => {
      const result: JSONObject = await planTransition(
        transitionArgs(kind, MONITORING_STATE, jiraSearchResponse()),
        MAP_MONITORING_TO_IN_REVIEW,
      );

      // The wording of this reason is pinned in the forward-only tests below.
      expect(result["proceed"]).toBe(false);
      expect(
        textOf(result, "reason").startsWith(
          "Jira issue OPS-17 has no transition from To Do to in review",
        ),
      ).toBe(true);
    });

    test("defuses the transition id and status name it hands on", async () => {
      // Both go on into the transition request and the log line.
      const result: JSONObject = await planTransition(
        transitionArgs(
          kind,
          kind.acknowledgedState,
          jiraSearchResponse({
            transitions: [
              jiraTransition({
                id: SECRET_REFERENCE,
                name: "Start work",
                to: jiraStatus({
                  name: SECRET_REFERENCE,
                  categoryKey: "indeterminate",
                  id: "3",
                }),
              }),
            ],
          }),
        ),
      );

      expect(result["transitionId"]).toBe(DEFUSED_SECRET_REFERENCE);
      expect(result["jiraStatus"]).toBe(DEFUSED_SECRET_REFERENCE);
    });
  });
}

type PlanFromFunction = (props: {
  kind: RecordKind;
  state: JSONObject;
  status?: JSONObject | undefined;
  transitions: Array<JSONObject>;
  editCode?: EditCodeFunction | undefined;
}) => Promise<JSONObject>;

/** plan-transition-1 for an issue in `status` (To Do by default) offering `transitions`. */
const planFrom: PlanFromFunction = async (props: {
  kind: RecordKind;
  state: JSONObject;
  status?: JSONObject | undefined;
  transitions: Array<JSONObject>;
  editCode?: EditCodeFunction | undefined;
}): Promise<JSONObject> => {
  return await props.kind.steps.planTransition(
    transitionArgs(
      props.kind,
      props.state,
      jiraSearchResponse({
        status: props.status,
        transitions: props.transitions,
      }),
    ),
    props.editCode,
  );
};

type NamedStatusFunction = (name: string, id: string) => JSONObject;

const doneStatus: NamedStatusFunction = (
  name: string,
  id: string,
): JSONObject => {
  return jiraStatus({ name: name, categoryKey: "done", id: id });
};

const inProgressStatus: NamedStatusFunction = (
  name: string,
  id: string,
): JSONObject => {
  return jiraStatus({ name: name, categoryKey: "indeterminate", id: id });
};

type ToStatusFunction = (
  id: string,
  status: JSONObject,
  hasScreen?: boolean | undefined,
) => JSONObject;

/* A transition named after the status it leads to: only the target is read. */
const toStatus: ToStatusFunction = (
  id: string,
  status: JSONObject,
  hasScreen?: boolean | undefined,
): JSONObject => {
  return jiraTransition({
    id: id,
    name: `Move to ${status["name"] as string}`,
    to: status,
    hasScreen: hasScreen,
  });
};

const REOPEN: JSONObject = jiraTransition({
  id: "81",
  name: "Reopen",
  to: IN_PROGRESS,
});
const BACK_TO_REVIEW: JSONObject = jiraTransition({
  id: "82",
  name: "Back to review",
  to: IN_REVIEW,
});
const STOP_WORK: JSONObject = jiraTransition({
  id: "83",
  name: "Stop work",
  to: TO_DO,
});
const FINISH: JSONObject = jiraTransition({
  id: "84",
  name: "Finish",
  to: DONE,
});

for (const kind of KINDS) {
  describe(`plan-transition-1 only moves an ${kind.noun}'s Jira issue forward`, () => {
    test(`leaves a Done issue alone when the ${kind.noun} is acknowledged`, async () => {
      // Someone closed the issue first; acknowledging the record must not reopen it.
      expectSkipped(
        await planFrom({
          kind: kind,
          state: kind.acknowledgedState,
          status: DONE,
          transitions: [REOPEN, BACK_TO_REVIEW],
        }),
        "Jira issue OPS-17 is already Done, so it was not moved back to an In Progress status.",
      );
    });

    test("goes by category, so any Done status counts as past In Progress", async () => {
      expectSkipped(
        await planFrom({
          kind: kind,
          state: kind.acknowledgedState,
          status: doneStatus("Closed", "6"),
          transitions: [REOPEN],
        }),
        "Jira issue OPS-17 is already Closed, so it was not moved back to an In Progress status.",
      );
    });

    test("leaves an issue alone that is already in any In Progress status", async () => {
      for (const status of [IN_PROGRESS, IN_REVIEW]) {
        expectSkipped(
          await planFrom({
            kind: kind,
            state: kind.acknowledgedState,
            status: status,
            transitions: [STOP_WORK, FINISH],
          }),
          `Jira issue OPS-17 is already ${status["name"] as string}.`,
        );
      }
    });

    test("resolves an issue that is In Progress", async () => {
      const result: JSONObject = await planFrom({
        kind: kind,
        state: kind.resolvedState,
        status: IN_PROGRESS,
        transitions: [STOP_WORK, FINISH],
      });

      expect(result).toEqual({
        proceed: true,
        issueKey: JIRA_ISSUE_KEY,
        transitionId: "84",
        jiraStatus: "Done",
        reason: `${kind.number} is Resolved in OneUptime.`,
      });
    });

    test("a mapped status in the same category as the issue's is still reachable", async () => {
      const result: JSONObject = await planFrom({
        kind: kind,
        state: MONITORING_STATE,
        status: IN_PROGRESS,
        transitions: [STOP_WORK, SEND_FOR_REVIEW, FINISH],
        editCode: MAP_MONITORING_TO_IN_REVIEW,
      });

      expect(result["transitionId"]).toBe("51");
      expect(result["jiraStatus"]).toBe("In Review");
    });

    test("a named mapping that would move the issue backwards is not chosen", async () => {
      const backwards: Array<{
        editCode: EditCodeFunction;
        state: JSONObject;
        status: JSONObject;
        transitions: Array<JSONObject>;
        reasonStart: string;
      }> = [
        {
          // Monitoring -> In Review on an issue someone already closed.
          editCode: MAP_MONITORING_TO_IN_REVIEW,
          state: MONITORING_STATE,
          status: DONE,
          transitions: [REOPEN, BACK_TO_REVIEW],
          reasonStart:
            "Jira issue OPS-17 is already Done, so it was not moved back to in review.",
        },
        {
          // A To Do-category name for an acknowledged record whose issue is In Progress.
          editCode: replaceInCode(
            "const STATE_TO_JIRA_STATUS = {};",
            "const STATE_TO_JIRA_STATUS = { Acknowledged: 'To Do' };",
          ),
          state: kind.acknowledgedState,
          status: IN_PROGRESS,
          transitions: [STOP_WORK, FINISH],
          reasonStart:
            "Jira issue OPS-17 is already In Progress, so it was not moved back to To Do.",
        },
      ];

      for (const candidate of backwards) {
        const result: JSONObject = await planFrom({
          kind: kind,
          state: candidate.state,
          status: candidate.status,
          transitions: candidate.transitions,
          editCode: candidate.editCode,
        });

        expect(result["proceed"]).toBe(false);
        expect(result["transitionId"]).toBeUndefined();
        expect(textOf(result, "reason").startsWith(candidate.reasonStart)).toBe(
          true,
        );
      }
    });

    test("a status the map already names is not reported as needing to be named", async () => {
      /*
       * Going by meaning, "name it in STATE_TO_JIRA_STATUS" is the way out; but
       * here the status IS named, so the reason has to say what actually
       * stopped it rather than send the reader to add a mapping they have.
       */
      const unreachable: JSONObject = await planFrom({
        kind: kind,
        state: MONITORING_STATE,
        transitions: TRANSITIONS_FROM_TO_DO,
        editCode: MAP_MONITORING_TO_IN_REVIEW,
      });
      const backwards: JSONObject = await planFrom({
        kind: kind,
        state: MONITORING_STATE,
        status: DONE,
        transitions: [BACK_TO_REVIEW],
        editCode: MAP_MONITORING_TO_IN_REVIEW,
      });

      expect(unreachable).toEqual({
        proceed: false,
        reason: `Jira issue ${JIRA_ISSUE_KEY} has no transition from To Do to in review.`,
      });
      expect(backwards).toEqual({
        proceed: false,
        reason: `Jira issue ${JIRA_ISSUE_KEY} is already Done, so it was not moved back to in review.`,
      });
    });
  });
}

/*
 * Jira Service Management's IT service desk workflow: several Done statuses,
 * one of which cancels the customer's request, and In Progress statuses that
 * mean "waiting on someone else".
 */
const WAITING_FOR_SUPPORT: JSONObject = jiraStatus({
  name: "Waiting for support",
  categoryKey: "new",
  id: "10100",
});
const JSM_RESOLVED: JSONObject = doneStatus("Resolved", "10101");
const JSM_CANCELED: JSONObject = doneStatus("Canceled", "10102");
// JSM spells it with a small p; preferred names match in any case.
const JSM_IN_PROGRESS: JSONObject = inProgressStatus("In progress", "10103");
const WAITING_FOR_CUSTOMER: JSONObject = inProgressStatus(
  "Waiting for customer",
  "10104",
);
const ESCALATED: JSONObject = inProgressStatus("Escalated", "10105");

type JsmResolveFunction = (hasScreen: boolean) => JSONObject;

const resolveThisIssue: JsmResolveFunction = (
  hasScreen: boolean,
): JSONObject => {
  return jiraTransition({
    id: "761",
    name: "Resolve this issue",
    to: JSM_RESOLVED,
    hasScreen: hasScreen,
  });
};

const cancelRequest: JsmResolveFunction = (hasScreen: boolean): JSONObject => {
  return jiraTransition({
    id: "781",
    name: "Cancel request",
    to: JSM_CANCELED,
    hasScreen: hasScreen,
  });
};

const START_JSM_WORK: JSONObject = jiraTransition({
  id: "711",
  name: "Start work",
  to: JSM_IN_PROGRESS,
  hasScreen: true,
});
const RESPOND_TO_CUSTOMER: JSONObject = jiraTransition({
  id: "721",
  name: "Respond to customer",
  to: WAITING_FOR_CUSTOMER,
});
const ESCALATE: JSONObject = jiraTransition({
  id: "731",
  name: "Escalate",
  to: ESCALATED,
});

for (const kind of KINDS) {
  describe(`plan-transition-1 chooses among several statuses by meaning for an ${kind.noun}`, () => {
    test("resolves a Jira Service Management request rather than canceling it", async () => {
      // Whichever comes first, and whichever has the screen.
      const lists: Array<Array<JSONObject>> = [
        [resolveThisIssue(true), cancelRequest(false)],
        [cancelRequest(false), resolveThisIssue(true)],
        [resolveThisIssue(false), cancelRequest(true)],
        [cancelRequest(true), resolveThisIssue(false)],
      ];

      for (const transitions of lists) {
        const result: JSONObject = await planFrom({
          kind: kind,
          state: kind.resolvedState,
          status: WAITING_FOR_SUPPORT,
          transitions: transitions,
        });

        expect(result).toEqual({
          proceed: true,
          issueKey: JIRA_ISSUE_KEY,
          transitionId: "761",
          jiraStatus: "Resolved",
          reason: `${kind.number} is Resolved in OneUptime.`,
        });
      }
    });

    test("never cancels a request on its own, even when that is the only way to Done", async () => {
      expectSkipped(
        await planFrom({
          kind: kind,
          state: kind.resolvedState,
          status: WAITING_FOR_SUPPORT,
          transitions: [cancelRequest(false)],
        }),
        noChoiceReason("Waiting for support", "a Done status"),
      );
    });

    test("cancels the request when STATE_TO_JIRA_STATUS names Canceled", async () => {
      const result: JSONObject = await planFrom({
        kind: kind,
        state: kind.resolvedState,
        status: WAITING_FOR_SUPPORT,
        transitions: [resolveThisIssue(false), cancelRequest(false)],
        editCode: replaceInCode(
          "const STATE_TO_JIRA_STATUS = {};",
          "const STATE_TO_JIRA_STATUS = { Resolved: 'Canceled' };",
        ),
      });

      expect(result["transitionId"]).toBe("781");
      expect(result["jiraStatus"]).toBe("Canceled");
    });

    test("never guesses a status that means waiting, giving up or a dead end", async () => {
      const names: Array<string> = [
        "Canceled",
        "Cancelled",
        "Declined",
        "Rejected",
        "Won't Do",
        "Won't Fix",
        "Wont Fix",
        "Duplicate",
        "Obsolete",
        "Pending",
        "Waiting for customer",
        "Escalated",
        "On Hold",
        "Blocked",
      ];

      for (const name of names) {
        expectSkipped(
          await planFrom({
            kind: kind,
            state: kind.resolvedState,
            transitions: [toStatus("91", doneStatus(name, "10200"))],
          }),
          noChoiceReason("To Do", "a Done status"),
        );
      }
    });

    test("acknowledges into In Progress, not Waiting for customer or Escalated", async () => {
      const lists: Array<Array<JSONObject>> = [
        [RESPOND_TO_CUSTOMER, ESCALATE, START_JSM_WORK],
        [START_JSM_WORK, ESCALATE, RESPOND_TO_CUSTOMER],
      ];

      for (const transitions of lists) {
        const result: JSONObject = await planFrom({
          kind: kind,
          state: kind.acknowledgedState,
          status: WAITING_FOR_SUPPORT,
          transitions: transitions,
        });

        // Start work has a screen and the others do not; the name still wins.
        expect(result["transitionId"]).toBe("711");
        expect(result["jiraStatus"]).toBe("In progress");
      }
    });

    test("does not acknowledge into Waiting for customer or Escalated when nothing else leads on", async () => {
      expectSkipped(
        await planFrom({
          kind: kind,
          state: kind.acknowledgedState,
          status: WAITING_FOR_SUPPORT,
          transitions: [RESPOND_TO_CUSTOMER, ESCALATE],
        }),
        noChoiceReason("Waiting for support", "an In Progress status"),
      );
    });

    test("takes an ordinary status name when it is the only one", async () => {
      // Neither preferred nor ruled out: fine, as long as nothing competes with it.
      const result: JSONObject = await planFrom({
        kind: kind,
        state: kind.resolvedState,
        transitions: [toStatus("92", doneStatus("Shipped", "10201"))],
      });

      expect(result["transitionId"]).toBe("92");
      expect(result["jiraStatus"]).toBe("Shipped");
    });

    test("names both statuses instead of guessing between two equally good ones", async () => {
      expectSkipped(
        await planFrom({
          kind: kind,
          state: kind.resolvedState,
          transitions: [
            toStatus("93", doneStatus("Released", "10202")),
            toStatus("94", doneStatus("Deployed", "10203")),
          ],
        }),
        tiedReason(["Released", "Deployed"], "a Done status"),
      );

      // Two preferred names tie just the same.
      expectSkipped(
        await planFrom({
          kind: kind,
          state: kind.resolvedState,
          transitions: [FINISH, toStatus("95", doneStatus("Closed", "6"))],
        }),
        tiedReason(["Done", "Closed"], "a Done status"),
      );

      expectSkipped(
        await planFrom({
          kind: kind,
          state: kind.acknowledgedState,
          transitions: [
            SEND_FOR_REVIEW,
            toStatus("96", inProgressStatus("Working", "5")),
          ],
        }),
        tiedReason(["In Review", "Working"], "an In Progress status"),
      );
    });

    test("a tie is settled by naming one of the statuses in STATE_TO_JIRA_STATUS", async () => {
      const result: JSONObject = await planFrom({
        kind: kind,
        state: kind.resolvedState,
        transitions: [
          toStatus("93", doneStatus("Released", "10202")),
          toStatus("94", doneStatus("Deployed", "10203")),
        ],
        editCode: replaceInCode(
          "const STATE_TO_JIRA_STATUS = {};",
          "const STATE_TO_JIRA_STATUS = { Resolved: 'deployed' };",
        ),
      });

      expect(result["transitionId"]).toBe("94");
      expect(result["jiraStatus"]).toBe("Deployed");
    });

    test("a preferred name beats an ordinary one, so In Progress wins over In Review", async () => {
      const result: JSONObject = await planFrom({
        kind: kind,
        state: kind.acknowledgedState,
        transitions: [SEND_FOR_REVIEW, ...TRANSITIONS_FROM_TO_DO],
      });

      expect(result["transitionId"]).toBe("21");
    });

    test("matches preferred names in any case, but only as the whole name", async () => {
      const cases: Array<{
        state: JSONObject;
        transitions: Array<JSONObject>;
        transitionId: string;
      }> = [
        {
          state: kind.resolvedState,
          transitions: [
            toStatus("97", doneStatus("Not Done", "10204")),
            toStatus("98", doneStatus("DONE", "10205")),
          ],
          transitionId: "98",
        },
        {
          state: kind.resolvedState,
          transitions: [
            toStatus("99", doneStatus("Resolved later", "10206")),
            toStatus("100", doneStatus("  resolved ", "10207")),
          ],
          transitionId: "100",
        },
        {
          state: kind.acknowledgedState,
          transitions: [
            toStatus("101", inProgressStatus("In Progress Review", "10208")),
            toStatus("102", inProgressStatus("WORK IN PROGRESS", "10209")),
          ],
          transitionId: "102",
        },
      ];

      for (const candidate of cases) {
        const result: JSONObject = await planFrom({
          kind: kind,
          state: candidate.state,
          transitions: candidate.transitions,
        });

        expect(result["transitionId"]).toBe(candidate.transitionId);
      }
    });

    test("does not treat a name that only contains a preferred word as preferred", async () => {
      // Not Done is an ordinary name, so it ties with Shipped rather than winning.
      expectSkipped(
        await planFrom({
          kind: kind,
          state: kind.resolvedState,
          transitions: [
            toStatus("97", doneStatus("Not Done", "10204")),
            toStatus("103", doneStatus("Shipped", "10201")),
          ],
        }),
        tiedReason(["Not Done", "Shipped"], "a Done status"),
      );
    });

    test("prefers a transition without a screen among those to the same status", async () => {
      const lists: Array<Array<JSONObject>> = [
        [toStatus("104", DONE, true), toStatus("105", DONE, false)],
        [toStatus("105", DONE, false), toStatus("104", DONE, true)],
      ];

      for (const transitions of lists) {
        const result: JSONObject = await planFrom({
          kind: kind,
          state: kind.resolvedState,
          transitions: transitions,
        });

        expect(result["transitionId"]).toBe("105");
      }

      // Also for an ordinary name, which is no tie with itself.
      const shipped: JSONObject = doneStatus("Shipped", "10201");
      const result: JSONObject = await planFrom({
        kind: kind,
        state: kind.resolvedState,
        transitions: [toStatus("106", shipped, true), toStatus("107", shipped)],
      });

      expect(result["transitionId"]).toBe("107");
    });

    test("statuses whose names differ only in case are one status, not a tie", async () => {
      const result: JSONObject = await planFrom({
        kind: kind,
        state: kind.resolvedState,
        transitions: [
          toStatus("108", doneStatus("Shipped", "10201"), true),
          toStatus("109", doneStatus("SHIPPED", "10210"), false),
        ],
      });

      expect(result["transitionId"]).toBe("109");
    });

    test("a better name beats a transition without a screen", async () => {
      const result: JSONObject = await planFrom({
        kind: kind,
        state: kind.resolvedState,
        transitions: [
          toStatus("110", doneStatus("Shipped", "10201"), false),
          toStatus("111", DONE, true),
        ],
      });

      expect(result["transitionId"]).toBe("111");
    });
  });
}

type NoteArgsFunction = (note: JSONValue, search?: JSONValue) => JSONObject;

const noteArgs: NoteArgsFunction = (
  note: JSONValue,
  search?: JSONValue,
): JSONObject => {
  return {
    note: asArgument(note),
    search: asArgument(search === undefined ? jiraSearchResponse() : search),
  };
};

for (const kind of KINDS) {
  for (const noteTemplate of kind.steps.noteComments) {
    describe(`build-comment-1 in ${noteTemplate.templateId} turns a note into a Jira comment`, () => {
      const run: RunStepFunction = noteTemplate.run;

      test(`posts the note under a heading naming the note, the ${kind.noun} and the author`, async () => {
        const result: JSONObject = await run(noteArgs(kind.note()));

        expect(result).toEqual({
          proceed: true,
          issueKey: JIRA_ISSUE_KEY,
          comment: `Synced from OneUptime: ${noteTemplate.noteKind} on ${kind.number} by Jane Doe.\n\n${kind.noteText}`,
        });
        // The reverse template drops any comment carrying this marker.
        expect(
          textOf(result, "comment").startsWith(
            `${JIRA_SYNCED_FROM_ONEUPTIME_MARKER}: `,
          ),
        ).toBe(true);
      });

      test("leaves the author out when the note has none", async () => {
        const result: JSONObject = await run(
          noteArgs(kind.note({ authorName: null })),
        );

        expect(
          textOf(result, "comment").startsWith(
            `Synced from OneUptime: ${noteTemplate.noteKind} on ${kind.number}.\n\n`,
          ),
        ).toBe(true);
      });

      test(`says 'the ${kind.noun}' when the note's ${kind.noun} was not hydrated`, async () => {
        const result: JSONObject = await run(
          noteArgs(omit(kind.note(), [kind.noun])),
        );

        expect(
          textOf(result, "comment").startsWith(
            `Synced from OneUptime: ${noteTemplate.noteKind} on the ${kind.noun} by Jane Doe.`,
          ),
        ).toBe(true);
      });

      test("keeps the note's line breaks and drops its control characters", async () => {
        const result: JSONObject = await run(
          noteArgs(kind.note({ note: "Line\u0000 one\r\nLine two" })),
        );

        expect(
          textOf(result, "comment").endsWith("\n\nLine one\nLine two"),
        ).toBe(true);
      });

      test("does not post a note that came from Jira back to it", async () => {
        // A note the reverse templates wrote, and one that quotes such a note.
        const notes: Array<string> = [
          `${ONEUPTIME_SYNCED_FROM_JIRA_MARKER}: Marco Rossi commented on ${ISSUE_LINK}.\n\nRolled back.`,
          `Forwarding this: ${ONEUPTIME_SYNCED_FROM_JIRA_MARKER}: Marco Rossi commented.`,
        ];

        for (const note of notes) {
          expectSkipped(
            await run(noteArgs(kind.note({ note: note }))),
            "This note came from Jira, so it was not posted back.",
          );
        }
      });

      test("does not post an empty note", async () => {
        for (const note of ["", "  \n\t ", "\u0000\u0007"]) {
          expectSkipped(
            await run(noteArgs(kind.note({ note: note }))),
            "The note is empty, so there is nothing to post.",
          );
        }
      });

      test("skips, naming the label, when no issue is linked", async () => {
        for (const search of [EMPTY_JIRA_SEARCH, UNRESOLVED_SEARCH, "null"]) {
          expectSkipped(
            await run(noteArgs(kind.note(), search)),
            noIssueReason(kind),
          );
        }
      });

      test("caps the comment at 30000 characters", async () => {
        const result: JSONObject = await run(
          noteArgs(kind.note({ note: "z".repeat(40000) })),
        );
        const comment: string = textOf(result, "comment");

        expect(comment).toHaveLength(30000);
        expect(comment.startsWith("Synced from OneUptime: ")).toBe(true);
        expect(comment.endsWith("…")).toBe(true);
      });

      test("defuses double braces in the note and the author's name", async () => {
        const result: JSONObject = await run(
          noteArgs(
            kind.note({
              note: `Rotate ${SECRET_REFERENCE} now`,
              authorName: SECRET_REFERENCE,
            }),
          ),
        );
        const comment: string = textOf(result, "comment");

        expect(comment).toContain(`Rotate ${DEFUSED_SECRET_REFERENCE} now`);
        expect(comment).not.toContain("{{");
      });
    });
  }
}

type UpdateArgsFunction = (
  kind: RecordKind,
  record: JSONValue,
  search?: JSONValue,
) => JSONObject;

const updateArgs: UpdateArgsFunction = (
  kind: RecordKind,
  record: JSONValue,
  search?: JSONValue,
): JSONObject => {
  return {
    [kind.noun]: asArgument(record),
    search: asArgument(search === undefined ? jiraSearchResponse() : search),
  };
};

for (const kind of KINDS) {
  const updateComment: RunStepFunction = kind.steps.updateComment;

  describe(`build-comment-1 in ${kind.templates.update} describes the ${kind.noun} as it stands`, () => {
    test("lists every field worth knowing about, in order", async () => {
      const result: JSONObject = await updateComment(
        updateArgs(
          kind,
          kind.model({
            rootCause: "A bad config push.",
            remediationNotes: "Rolled back the config.",
          }),
        ),
      );

      expect(result).toEqual({
        proceed: true,
        issueKey: JIRA_ISSUE_KEY,
        comment: `Synced from OneUptime: ${kind.number} was updated.\nTitle: ${kind.title}\nSeverity: ${kind.severityName}\nState: Identified\nRoot cause: A bad config push.\nRemediation: Rolled back the config.\nDescription: ${kind.description}`,
      });
    });

    test("lists only the fields that hold something", async () => {
      const result: JSONObject = await updateComment(
        updateArgs(
          kind,
          kind.model({
            description: null,
            rootCause: "   \n",
            remediationNotes: null,
          }),
        ),
      );

      expect(textOf(result, "comment")).toBe(
        `Synced from OneUptime: ${kind.number} was updated.\nTitle: ${kind.title}\nSeverity: ${kind.severityName}\nState: Identified`,
      );
    });

    test("is just the heading when nothing is filled in", async () => {
      const result: JSONObject = await updateComment(
        updateArgs(
          kind,
          omit(kind.model({ title: "", description: null }), [
            kind.severityRelation,
            kind.stateRelation,
          ]),
        ),
      );

      expect(textOf(result, "comment")).toBe(
        `Synced from OneUptime: ${kind.number} was updated.`,
      );
    });

    test("caps each field on its own line", async () => {
      const result: JSONObject = await updateComment(
        updateArgs(
          kind,
          kind.model({ title: "t".repeat(800), rootCause: "r".repeat(8000) }),
        ),
      );
      const lines: Array<string> = textOf(result, "comment").split("\n");

      expect(lines).toContain(`Title: ${"t".repeat(499)}…`);
      expect(lines).toContain(`Root cause: ${"r".repeat(4999)}…`);
    });

    test("stays within Jira's 30000 characters with every field at its longest", async () => {
      const huge: string = "w".repeat(20000);
      const result: JSONObject = await updateComment(
        updateArgs(
          kind,
          kind.model({
            title: huge,
            description: huge,
            rootCause: huge,
            remediationNotes: huge,
            severity: huge,
            state: { ...kind.createdState, name: huge },
          }),
        ),
      );

      expect(textOf(result, "comment").length).toBeLessThanOrEqual(30000);
    });

    test("skips, naming the label, when no issue is linked", async () => {
      for (const search of [EMPTY_JIRA_SEARCH, UNRESOLVED_SEARCH, "null"]) {
        expectSkipped(
          await updateComment(updateArgs(kind, kind.model(), search)),
          noIssueReason(kind),
        );
      }
    });

    test(`defuses double braces in the ${kind.noun}'s text`, async () => {
      const result: JSONObject = await updateComment(
        updateArgs(
          kind,
          kind.model({
            title: `Leak ${SECRET_REFERENCE}`,
            rootCause: SECRET_REFERENCE,
          }),
        ),
      );
      const comment: string = textOf(result, "comment");

      expect(comment).toContain(`Title: Leak ${DEFUSED_SECRET_REFERENCE}`);
      expect(comment).not.toContain("{{");
    });
  });
}

/* ----------------- Shared by the OneUptime -> Jira scripts ----------------- */

type WithSearchFunction = (search: JSONValue) => Promise<JSONObject>;

interface LinkedIssueCase {
  templateId: string;
  componentId: string;
  /** Runs the step for a public record that would otherwise proceed. */
  withSearch: WithSearchFunction;
}

type LinkedIssueCasesFunction = (kind: RecordKind) => Array<LinkedIssueCase>;

/* Every script of a kind that acts on the issue a label search found. */
const linkedIssueCases: LinkedIssueCasesFunction = (
  kind: RecordKind,
): Array<LinkedIssueCase> => {
  return [
    {
      templateId: kind.templates.transition,
      componentId: "plan-transition-1",
      withSearch: async (search: JSONValue): Promise<JSONObject> => {
        return await kind.steps.planTransition(
          transitionArgs(kind, kind.acknowledgedState, search),
        );
      },
    },
    ...kind.steps.noteComments.map(
      (noteTemplate: NoteTemplateCase): LinkedIssueCase => {
        return {
          templateId: noteTemplate.templateId,
          componentId: "build-comment-1",
          withSearch: async (search: JSONValue): Promise<JSONObject> => {
            return await noteTemplate.run(noteArgs(kind.note(), search));
          },
        };
      },
    ),
    {
      templateId: kind.templates.update,
      componentId: "build-comment-1",
      withSearch: async (search: JSONValue): Promise<JSONObject> => {
        return await kind.steps.updateComment(
          updateArgs(kind, kind.model(), search),
        );
      },
    },
  ];
};

/*
 * The search asks Jira for two issues so a second one can be seen: a clone
 * copies the label, and "the first match" could then be the clone — with
 * private notes posted to it.
 */
for (const kind of KINDS) {
  describe(`the outbound scripts act only on the one issue carrying the ${kind.noun}'s label`, () => {
    for (const linked of linkedIssueCases(kind)) {
      const name: string = `${linked.componentId} in ${linked.templateId}`;

      test(`${name} uses the one issue the search found`, async () => {
        const result: JSONObject = await linked.withSearch(
          searchWithKeys([JIRA_ISSUE_KEY]),
        );

        expect(result["proceed"]).toBe(true);
        expect(result["issueKey"]).toBe(JIRA_ISSUE_KEY);
      });

      test(`${name} skips, naming the label, when the search found none`, async () => {
        const searches: Array<JSONValue> = [
          EMPTY_JIRA_SEARCH,
          searchWithKeys([]),
          { issues: null, isLast: true },
          // What Jira sends back for a malformed query or a token it rejected.
          { errorMessages: ["Field 'labels' does not exist."], errors: {} },
          UNRESOLVED_SEARCH,
          "null",
        ];

        for (const search of searches) {
          expectSkipped(await linked.withSearch(search), noIssueReason(kind));
        }
      });

      test(`${name} refuses to choose between two labelled issues, naming both`, async () => {
        expectSkipped(
          await linked.withSearch(
            searchWithKeys([JIRA_ISSUE_KEY, CLONE_ISSUE_KEY]),
          ),
          moreThanOneReason(kind, [JIRA_ISSUE_KEY, CLONE_ISSUE_KEY]),
        );
      });

      test(`${name} names every labelled issue, in the order Jira found them`, async () => {
        const keys: Array<string> = [CLONE_ISSUE_KEY, JIRA_ISSUE_KEY, "SUP-3"];

        expectSkipped(
          await linked.withSearch(searchWithKeys(keys)),
          moreThanOneReason(kind, keys),
        );
      });

      test(`${name} leaves out results without a valid key before counting`, async () => {
        // The one valid issue comes last, so the step cannot just be taking the first.
        const oneValid: JSONObject = searchWithKeys([
          "../../myself",
          "OPS 30",
          17,
          null,
          JIRA_ISSUE_KEY,
        ]);
        const result: JSONObject = await linked.withSearch({
          ...oneValid,
          issues: [
            null,
            "OPS-30",
            ...(oneValid["issues"] as Array<JSONObject>),
          ] as Array<JSONValue>,
        });

        expect(result["proceed"]).toBe(true);
        expect(result["issueKey"]).toBe(JIRA_ISSUE_KEY);

        // With no valid key left, it is as if nothing matched.
        expectSkipped(
          await linked.withSearch(searchWithKeys(["../../myself", "OPS 30"])),
          noIssueReason(kind),
        );
      });
    }

    test("plan-transition-1 reads the status and transitions of the issue it kept", async () => {
      // Read off the invalid hit, the issue would already be In Progress, or move by 21.
      const result: JSONObject = await kind.steps.planTransition(
        transitionArgs(
          kind,
          kind.acknowledgedState,
          jiraSearchResponse({
            issues: [
              {
                key: "../../myself",
                fields: { status: IN_PROGRESS },
                transitions: TRANSITIONS_FROM_TO_DO,
              },
              {
                key: JIRA_ISSUE_KEY,
                fields: { status: TO_DO },
                transitions: [STOP_WORK, REOPEN],
              },
            ],
          }),
        ),
      );

      expect(result["transitionId"]).toBe("81");
    });
  });
}

type PrivacyRunFunction = (
  isPrivate: boolean | undefined,
  editCode?: EditCodeFunction | undefined,
) => Promise<JSONObject>;

interface PrivateRecordCase {
  templateId: string;
  componentId: string;
  /** Runs the step on a record that is otherwise ready to sync. */
  run: PrivacyRunFunction;
  reason: string;
}

type PrivateRecordCasesFunction = (
  kind: RecordKind,
) => Array<PrivateRecordCase>;

const privateRecordCases: PrivateRecordCasesFunction = (
  kind: RecordKind,
): Array<PrivateRecordCase> => {
  return [
    {
      templateId: kind.templates.createIssue,
      componentId: "prepare-issue-1",
      run: async (
        isPrivate: boolean | undefined,
        editCode?: EditCodeFunction | undefined,
      ): Promise<JSONObject> => {
        return await kind.steps.prepareIssue(
          issueArgs(kind, withPrivacy(kind.model(), isPrivate)),
          editCode,
        );
      },
      reason: `${kind.number} is a private ${kind.noun}, so no Jira issue was created.`,
    },
    {
      templateId: kind.templates.transition,
      componentId: "plan-transition-1",
      run: async (
        isPrivate: boolean | undefined,
        editCode?: EditCodeFunction | undefined,
      ): Promise<JSONObject> => {
        return await kind.steps.planTransition(
          {
            [kind.noun]: quoted(
              withPrivacy(
                kind.model({ state: kind.acknowledgedState }),
                isPrivate,
              ),
            ),
            search: quoted(jiraSearchResponse()),
          },
          editCode,
        );
      },
      reason: `${kind.number} is a private ${kind.noun}, so its Jira issue was not moved.`,
    },
    ...kind.steps.noteComments.map(
      (noteTemplate: NoteTemplateCase): PrivateRecordCase => {
        return {
          templateId: noteTemplate.templateId,
          componentId: "build-comment-1",
          run: async (
            isPrivate: boolean | undefined,
            editCode?: EditCodeFunction | undefined,
          ): Promise<JSONObject> => {
            return await noteTemplate.run(
              noteArgs(noteOnRecord(kind, isPrivate)),
              editCode,
            );
          },
          reason: `The note is on ${kind.number}, a private ${kind.noun}, so it was not posted to Jira.`,
        };
      },
    ),
    {
      templateId: kind.templates.update,
      componentId: "build-comment-1",
      run: async (
        isPrivate: boolean | undefined,
        editCode?: EditCodeFunction | undefined,
      ): Promise<JSONObject> => {
        return await kind.steps.updateComment(
          updateArgs(kind, withPrivacy(kind.model(), isPrivate)),
          editCode,
        );
      },
      reason: `${kind.number} is a private ${kind.noun}, so its changes were not posted to Jira.`,
    },
  ];
};

for (const kind of KINDS) {
  describe(`the outbound scripts keep private ${kind.noun}s in OneUptime`, () => {
    for (const privacy of privateRecordCases(kind)) {
      const name: string = `${privacy.componentId} in ${privacy.templateId}`;

      test(`${name} skips a private ${kind.noun}`, async () => {
        expectSkipped(await privacy.run(true), privacy.reason);
      });

      test(`${name} syncs a private ${kind.noun} once ${kind.syncPrivateName} is true`, async () => {
        const result: JSONObject = await privacy.run(true, kind.syncPrivate);

        expect(result["proceed"]).toBe(true);
        expect(result["reason"]).not.toBe(privacy.reason);
      });

      test(`${name} syncs an ${kind.noun} that is not private, or does not say`, async () => {
        // A select that leaves isPrivate out hands over no flag at all.
        for (const isPrivate of [false, undefined]) {
          const result: JSONObject = await privacy.run(isPrivate);

          expect({ isPrivate: isPrivate, proceed: result["proceed"] }).toEqual({
            isPrivate: isPrivate,
            proceed: true,
          });
        }
      });
    }

    test("the private check comes before the linked-issue lookup", async () => {
      // Nothing about the Jira side is worth reporting for a record that stays in OneUptime.
      const privateRecord: JSONObject = withPrivacy(kind.model(), true);

      expectSkipped(
        await kind.steps.updateComment(
          updateArgs(kind, privateRecord, EMPTY_JIRA_SEARCH),
        ),
        `${kind.number} is a private ${kind.noun}, so its changes were not posted to Jira.`,
      );
      expectSkipped(
        await kind.steps.planTransition({
          [kind.noun]: quoted(
            withPrivacy(kind.model({ state: kind.createdState }), true),
          ),
          search: quoted(searchWithKeys([JIRA_ISSUE_KEY, CLONE_ISSUE_KEY])),
        }),
        `${kind.number} is a private ${kind.noun}, so its Jira issue was not moved.`,
      );
    });

    test(`prepare-issue-1 checks privacy before the Jira issue key an ${kind.noun} was ${kind.created} with`, async () => {
      expectSkipped(
        await kind.steps.prepareIssue(
          issueArgs(
            kind,
            withPrivacy(
              kind.model({ customFields: { jiraIssueKey: JIRA_ISSUE_KEY } }),
              true,
            ),
          ),
        ),
        `${kind.number} is a private ${kind.noun}, so no Jira issue was created.`,
      );
    });

    for (const noteTemplate of kind.steps.noteComments) {
      test(`build-comment-1 in ${noteTemplate.templateId} checks privacy before the note's text or the search`, async () => {
        const notes: Array<string> = [
          "",
          `${ONEUPTIME_SYNCED_FROM_JIRA_MARKER}: Marco Rossi commented.`,
          "Failed over.",
        ];

        for (const note of notes) {
          expectSkipped(
            await noteTemplate.run(
              noteArgs(noteOnRecord(kind, true, note), EMPTY_JIRA_SEARCH),
            ),
            `The note is on ${kind.number}, a private ${kind.noun}, so it was not posted to Jira.`,
          );
        }
      });

      test(`build-comment-1 in ${noteTemplate.templateId} still skips an empty note once private ${kind.noun}s sync`, async () => {
        expectSkipped(
          await noteTemplate.run(
            noteArgs(noteOnRecord(kind, true, "  ")),
            kind.syncPrivate,
          ),
          "The note is empty, so there is nothing to post.",
        );
      });
    }
  });
}

/* ------------------------- Jira -> OneUptime ------------------------- */

type RecordArgsFunction = (
  kind: RecordKind,
  payload: JSONValue,
  severities?: JSONValue,
) => JSONObject;

/* The Jira payload goes last, as it does in the template. */
const recordArgs: RecordArgsFunction = (
  kind: RecordKind,
  payload: JSONValue,
  severities?: JSONValue,
): JSONObject => {
  return {
    severities: asArgument(
      severities === undefined ? kind.severities : severities,
    ),
    payload: asArgument(payload),
  };
};

type SeverityListFunction = (count: number) => Array<JSONObject>;

/** A project's severities, most severe first: SEV1, SEV2, ... */
const severityList: SeverityListFunction = (
  count: number,
): Array<JSONObject> => {
  return Array.from(
    { length: count },
    (_value: unknown, index: number): JSONObject => {
      return {
        _id: `dddddddd-0000-4000-8000-00000000000${index + 1}`,
        name: `SEV${index + 1}`,
        order: index + 1,
      };
    },
  );
};

type ChosenSeverityFunction = (
  kind: RecordKind,
  priority: string | null,
  severities?: JSONValue,
  editCode?: EditCodeFunction | undefined,
) => Promise<string>;

/** The severity name an issue with this priority becomes an incident or alert with. */
const chosenSeverity: ChosenSeverityFunction = async (
  kind: RecordKind,
  priority: string | null,
  severities?: JSONValue,
  editCode?: EditCodeFunction | undefined,
): Promise<string> => {
  const result: JSONObject = await kind.steps.prepareRecord(
    recordArgs(kind, jiraIssueCreatedEvent({ priority: priority }), severities),
    editCode,
  );

  return textOf(result, "severityName");
};

for (const kind of KINDS) {
  const prepareRecord: RunStepFunction = kind.steps.prepareRecord;

  describe(`${kind.prepareRecordStep} turns a new Jira issue into an ${kind.noun}`, () => {
    test(`makes the issue an ${kind.noun} with a severity from its priority and a link back`, async () => {
      const result: JSONObject = await prepareRecord(
        recordArgs(kind, jiraIssueCreatedEvent()),
      );

      expect(result).toEqual({
        proceed: true,
        issueKey: JIRA_ISSUE_KEY,
        severityName: kind.mostSevereName,
        [kind.severityIdKey]: kind.mostSevereId,
        title: "Checkout API returns 502 for EU customers",
        description: `${kind.Created} from Jira issue ${ISSUE_LINK}.\nPriority: High\nReported by: Priya Patel\n\nCustomers in *eu-west-1* see 502s at checkout.\nStarted around 09:40 UTC.`,
      });
    });

    test("ignores every event but jira:issue_created", async () => {
      expectSkipped(
        await prepareRecord(
          recordArgs(kind, jiraIssueUpdatedEvent({ items: STARTED_CHANGELOG })),
        ),
        "Ignored a jira:issue_updated event: this workflow only handles jira:issue_created.",
      );
      expectSkipped(
        await prepareRecord(recordArgs(kind, jiraCommentEvent())),
        "Ignored a comment_created event: this workflow only handles jira:issue_created.",
      );
    });

    test("ignores a request that is not a Jira event at all", async () => {
      // A GET hands over an empty body; a ping from a load balancer may not even be JSON.
      for (const payload of [{}, "ping", "null"]) {
        expectSkipped(
          await prepareRecord(recordArgs(kind, payload)),
          NOT_A_JIRA_EVENT_REASON,
        );
      }
    });

    test(`makes no ${kind.noun} of an issue OneUptime filed or already linked`, async () => {
      const labelSets: Array<Array<string>> = [
        kind.linkLabels,
        [JIRA_LINK_LABEL],
        ["ONEUPTIME"],
        [`${kind.mixedCaseLabelPrefix}${kind.otherId.toUpperCase()}`],
        ["backend", `${kind.labelPrefix}not-even-an-id`],
      ];

      for (const labels of labelSets) {
        expectSkipped(
          await prepareRecord(
            recordArgs(kind, jiraIssueCreatedEvent({ labels: labels })),
          ),
          alreadyLinkedReason(kind),
        );
      }
    });

    test("does not mistake other labels that start with oneuptime for a link", async () => {
      const result: JSONObject = await prepareRecord(
        recordArgs(
          kind,
          jiraIssueCreatedEvent({ labels: ["oneuptime-team", "backend"] }),
        ),
      );

      expect(result["proceed"]).toBe(true);
    });

    test("skips an event whose issue key is not a Jira key", async () => {
      // The key ends up in a PUT URL, unescaped.
      for (const key of ["../../myself", "OPS 1", "", "17", "OPS-17/comment"]) {
        expectSkipped(
          await prepareRecord(
            recordArgs(kind, withIssue(jiraIssueCreatedEvent(), { key: key })),
          ),
          NO_ISSUE_KEY_REASON,
        );
      }
    });

    test(`maps Jira priorities onto the default ${kind.severities.length} ${kind.noun} severities`, async () => {
      for (const mapping of kind.priorities) {
        expect({
          priority: mapping.priority,
          severity: await chosenSeverity(kind, mapping.priority),
        }).toEqual(mapping);
      }
    });

    test("hands on the chosen severity's id", async () => {
      const ids: Array<string> = [];

      for (const priority of ["High", "Medium", "Low"]) {
        const result: JSONObject = await prepareRecord(
          recordArgs(kind, jiraIssueCreatedEvent({ priority: priority })),
        );
        ids.push(textOf(result, kind.severityIdKey));
      }

      expect(ids).toEqual(kind.highMediumLowIds);
    });

    test("spreads the priorities across five severities", async () => {
      expect(await chosenSeverity(kind, "High", severityList(5))).toBe("SEV1");
      expect(await chosenSeverity(kind, "Medium", severityList(5))).toBe(
        "SEV3",
      );
      expect(await chosenSeverity(kind, "Low", severityList(5))).toBe("SEV5");
    });

    test("spreads the priorities across two severities", async () => {
      expect(await chosenSeverity(kind, "High", severityList(2))).toBe("SEV1");
      expect(await chosenSeverity(kind, "Medium", severityList(2))).toBe(
        "SEV2",
      );
      expect(await chosenSeverity(kind, "Low", severityList(2))).toBe("SEV2");
    });

    test("maps every priority to the only severity there is", async () => {
      for (const priority of ["Highest", "Medium", "Lowest", null]) {
        expect(await chosenSeverity(kind, priority, severityList(1))).toBe(
          "SEV1",
        );
      }
    });

    test("orders severities by their order field, not by how find-many returns them", async () => {
      const reversed: Array<JSONObject> = [...severityList(5)].reverse();

      expect(await chosenSeverity(kind, "Highest", reversed)).toBe("SEV1");
      expect(await chosenSeverity(kind, "Lowest", reversed)).toBe("SEV5");
    });

    test("ignores severity rows without an id", async () => {
      expect(
        await chosenSeverity(kind, "Highest", [
          { name: "Ghost", order: 0 },
          ...kind.severities,
        ]),
      ).toBe(kind.mostSevereName);
    });

    test(`makes no ${kind.noun} when the project has no severities to choose from`, async () => {
      for (const severities of [
        [],
        "null",
        "{{local.components.find-severities-1.returnValues.models}}",
      ]) {
        expectSkipped(
          await prepareRecord(
            recordArgs(kind, jiraIssueCreatedEvent(), severities as JSONValue),
          ),
          `This project has no ${kind.noun} severities to choose from.`,
        );
      }
    });

    test("takes the title from the summary, on one line", async () => {
      const result: JSONObject = await prepareRecord(
        recordArgs(
          kind,
          jiraIssueCreatedEvent({ summary: "Checkout\nAPI\t502\u0000s  " }),
        ),
      );

      expect(result["title"]).toBe("Checkout API 502s");
    });

    test("caps the title at 500 characters", async () => {
      const result: JSONObject = await prepareRecord(
        recordArgs(kind, jiraIssueCreatedEvent({ summary: "s".repeat(700) })),
      );
      const title: string = textOf(result, "title");

      expect(title).toHaveLength(500);
      expect(title.endsWith("…")).toBe(true);
    });

    test("names the issue when it has no summary", async () => {
      const result: JSONObject = await prepareRecord(
        recordArgs(kind, jiraIssueCreatedEvent({ summary: "" })),
      );

      expect(result["title"]).toBe("Jira issue OPS-17");
    });

    test("writes the key without a link when the issue has no REST URL to read the site from", async () => {
      const result: JSONObject = await prepareRecord(
        recordArgs(kind, jiraIssueCreatedEvent({ self: "" })),
      );

      expect(
        textOf(result, "description").startsWith(
          `${kind.Created} from Jira issue OPS-17.\n`,
        ),
      ).toBe(true);
    });

    test("leaves the priority line out when the issue has no priority", async () => {
      const result: JSONObject = await prepareRecord(
        recordArgs(kind, jiraIssueCreatedEvent({ priority: null })),
      );

      expect(textOf(result, "description")).not.toContain("Priority:");
    });

    test("names the event's user when the issue has no reporter", async () => {
      const result: JSONObject = await prepareRecord(
        recordArgs(
          kind,
          withIssueFields(
            jiraIssueCreatedEvent({ user: jiraUser("Sam Ortiz") }),
            { reporter: null },
          ),
        ),
      );

      expect(textOf(result, "description")).toContain(
        "\nReported by: Sam Ortiz\n",
      );
    });

    test("flattens a description in Atlassian Document Format to text", async () => {
      const result: JSONObject = await prepareRecord(
        recordArgs(kind, jiraIssueCreatedEvent({ description: ADF_TEXT })),
      );

      expect(textOf(result, "description").endsWith(`\n\n${ADF_AS_TEXT}`)).toBe(
        true,
      );
    });

    test("caps the description at 20000 characters", async () => {
      const result: JSONObject = await prepareRecord(
        recordArgs(
          kind,
          jiraIssueCreatedEvent({ description: "d".repeat(25000) }),
        ),
      );

      expect(textOf(result, "description")).toHaveLength(20000);
    });

    test("defuses double braces in the summary, description and reporter", async () => {
      const result: JSONObject = await prepareRecord(
        recordArgs(
          kind,
          jiraIssueCreatedEvent({
            summary: `Leak ${SECRET_REFERENCE}`,
            description: `Body ${SECRET_REFERENCE}`,
            reporter: jiraUser(SECRET_REFERENCE),
          }),
        ),
      );

      expect(result["title"]).toBe(`Leak ${DEFUSED_SECRET_REFERENCE}`);
      expect(textOf(result, "description")).toContain(
        `Body ${DEFUSED_SECRET_REFERENCE}`,
      );
      expect(textOf(result, "description")).not.toContain("{{");
    });

    test("reads a request body that arrived as JSON text", async () => {
      // A manual run hands the body over as a string, quoted like any other.
      const fromText: JSONObject = await prepareRecord(
        recordArgs(kind, JSON.stringify(jiraIssueCreatedEvent())),
      );
      const fromObject: JSONObject = await prepareRecord(
        recordArgs(kind, jiraIssueCreatedEvent()),
      );

      expect(fromText).toEqual(fromObject);
    });

    test("PRIORITY_RANK can be edited to move a priority", async () => {
      expect(
        await chosenSeverity(
          kind,
          "High",
          kind.severities,
          replaceInCode("high: 0,", "high: 2,"),
        ),
      ).toBe(kind.leastSevereName);
    });

    test("PRIORITY_RANK can be extended, and ranks outside 0 to 2 are clamped", async () => {
      const addPriorities: EditCodeFunction = replaceInCode(
        "trivial: 2 }",
        "trivial: 2, p1: 0, sev0: -5, sev9: 9 }",
      );

      expect(
        await chosenSeverity(kind, "P1", kind.severities, addPriorities),
      ).toBe(kind.mostSevereName);
      expect(
        await chosenSeverity(kind, "SEV0", kind.severities, addPriorities),
      ).toBe(kind.mostSevereName);
      expect(
        await chosenSeverity(kind, "SEV9", kind.severities, addPriorities),
      ).toBe(kind.leastSevereName);
    });
  });
}

type ConfirmArgsFunction = (issue: JSONValue) => JSONObject;

/* get-issue-1's response body, quoted into the arguments as JSON text. */
const confirmArgs: ConfirmArgsFunction = (issue: JSONValue): JSONObject => {
  return { issue: asArgument(issue) };
};

/*
 * The create template's second look, at the issue as Jira has it. The
 * webhook's own labels were already checked by the prepare step, but anyone
 * with the workflow's URL can write a webhook, and a delivery Jira retries
 * arrives after the first one labelled the issue.
 */
for (const kind of KINDS) {
  const confirmUnlinked: RunStepFunction = kind.steps.confirmUnlinked;

  describe(`confirm-unlinked-1 in ${kind.templates.createRecord} makes no ${kind.noun} of an issue Jira says is linked`, () => {
    test("lets an unlabelled issue through, under the key Jira returned", async () => {
      const result: JSONObject = await confirmUnlinked(
        confirmArgs(jiraIssueLabelsResponse([])),
      );

      expect(result).toEqual({ proceed: true, issueKey: JIRA_ISSUE_KEY });
    });

    test("lets an issue through whose labels only look like the link labels", async () => {
      const labelSets: Array<Array<string>> = [
        ["backend", "sev1"],
        ["oneuptime-team", `${kind.noun}-review`],
        [`x-${kind.label}`, `${JIRA_LINK_LABEL}s`],
      ];

      for (const labels of labelSets) {
        expect(
          await confirmUnlinked(confirmArgs(jiraIssueLabelsResponse(labels))),
        ).toEqual({ proceed: true, issueKey: JIRA_ISSUE_KEY });
      }
    });

    test("makes nothing of an issue carrying the link labels", async () => {
      expectSkipped(
        await confirmUnlinked(
          confirmArgs(jiraIssueLabelsResponse(kind.linkLabels)),
        ),
        alreadyLinkedReason(kind),
      );
    });

    test("makes nothing of an issue carrying just the bare oneuptime label, in any case", async () => {
      for (const label of [JIRA_LINK_LABEL, "ONEUPTIME", "OneUptime"]) {
        expectSkipped(
          await confirmUnlinked(
            confirmArgs(jiraIssueLabelsResponse(["backend", label])),
          ),
          alreadyLinkedReason(kind),
        );
      }
    });

    test(`makes nothing of an issue with any ${kind.labelPrefix} label, whatever the id`, async () => {
      // Linked to another record, or labelled by hand: either way it is not free to take.
      const labels: Array<string> = [
        kind.labelOf(kind.otherId),
        `${kind.mixedCaseLabelPrefix}${kind.otherId.toUpperCase()}`,
        `${kind.labelPrefix}42`,
        `${kind.labelPrefix}not-even-an-id`,
        kind.labelPrefix,
      ];

      for (const label of labels) {
        expectSkipped(
          await confirmUnlinked(confirmArgs(jiraIssueLabelsResponse([label]))),
          alreadyLinkedReason(kind),
        );
      }
    });

    test("goes by Jira's labels, not the webhook's", async () => {
      // A forged event for an issue OneUptime filed: the event claims no labels, Jira says otherwise.
      const event: JSONObject = jiraIssueCreatedEvent({ labels: [] });
      const prepared: JSONObject = await kind.steps.prepareRecord(
        recordArgs(kind, event),
      );

      expect(prepared["proceed"]).toBe(true);
      expectSkipped(
        await confirmUnlinked(
          confirmArgs(jiraIssueLabelsResponse(kind.linkLabels)),
        ),
        alreadyLinkedReason(kind),
      );
    });

    test("treats a response without labels as unlabelled", async () => {
      // Jira sends labels: [] for an issue with none; a response that leaves them out names no link either.
      const responses: Array<JSONValue> = [
        { key: JIRA_ISSUE_KEY },
        { key: JIRA_ISSUE_KEY, fields: {} },
        { key: JIRA_ISSUE_KEY, fields: null },
        { key: JIRA_ISSUE_KEY, fields: { labels: null } },
      ];

      for (const issue of responses) {
        expect(await confirmUnlinked(confirmArgs(issue))).toEqual({
          proceed: true,
          issueKey: JIRA_ISSUE_KEY,
        });
      }
    });

    test("makes nothing when Jira did not return an issue", async () => {
      const responses: Array<JSONValue> = [
        // What Jira answers for an unknown key, or one the token cannot see.
        {
          errorMessages: [
            "Issue does not exist or you do not have permission to see it.",
          ],
          errors: {},
        },
        { ...jiraIssueLabelsResponse([]), key: "../../myself" },
        { ...jiraIssueLabelsResponse([]), key: "OPS 17" },
        { ...jiraIssueLabelsResponse([]), key: 17 },
        {},
        [],
        "null",
        "Not Found",
        "{{local.components.get-issue-1.returnValues.response-body}}",
      ];

      for (const issue of responses) {
        expectSkipped(
          await confirmUnlinked(confirmArgs(issue)),
          notReturnedReason(kind),
        );
      }
    });

    test("reads the response whether it arrives as JSON text or as an object", async () => {
      const response: JSONObject = jiraIssueLabelsResponse(kind.linkLabels);

      expect(await confirmUnlinked({ issue: response })).toEqual(
        await confirmUnlinked(confirmArgs(response)),
      );
    });
  });
}

for (const kind of KINDS) {
  const readEvent: RunStepFunction = kind.steps.readEvent;
  const idKey: string = `${kind.noun}Id`;

  describe(`read-event-1 in ${kind.templates.statusToState} keeps only status changes on linked issues`, () => {
    test("reads a resolved issue, whose status item comes after the resolution", async () => {
      const result: JSONObject = await readEvent(
        linkedUpdate(kind, RESOLVED_CHANGELOG, { status: DONE }),
      );

      expect(result).toEqual({
        proceed: true,
        [idKey]: kind.id,
        issueKey: JIRA_ISSUE_KEY,
        jiraStatus: "Done",
        jiraStatusCategory: "done",
        changedBy: "Priya Patel",
      });
    });

    test("reads work starting on an issue", async () => {
      const result: JSONObject = await readEvent(
        linkedUpdate(kind, STARTED_CHANGELOG, {
          status: IN_PROGRESS,
          user: jiraUser("Marco Rossi"),
        }),
      );

      expect(result).toEqual({
        proceed: true,
        [idKey]: kind.id,
        issueKey: JIRA_ISSUE_KEY,
        jiraStatus: "In Progress",
        jiraStatusCategory: "indeterminate",
        changedBy: "Marco Rossi",
      });
    });

    test("recognises a status item that only names the field, capitalised", async () => {
      const result: JSONObject = await readEvent(
        linkedUpdate(
          kind,
          [
            {
              field: "Status",
              fieldtype: "jira",
              from: "10001",
              fromString: "To Do",
              to: "3",
              toString: "In Progress",
            },
          ],
          { status: IN_PROGRESS },
        ),
      );

      expect(result["proceed"]).toBe(true);
    });

    test("skips a change that did not touch the status", async () => {
      expectSkipped(
        await readEvent(linkedUpdate(kind, [PRIORITY_RAISED, ASSIGNED])),
        "Jira issue OPS-17 changed, but its status did not.",
      );
    });

    test("skips an event whose changelog is missing or malformed", async () => {
      const event: JSONObject = linkedUpdate(kind, STARTED_CHANGELOG);
      const events: Array<JSONObject> = [
        omit(event, ["changelog"]),
        { ...event, changelog: { id: "10228", items: "status" } },
        { ...event, changelog: null },
      ];

      for (const candidate of events) {
        expectSkipped(
          await readEvent(candidate),
          "Jira issue OPS-17 changed, but its status did not.",
        );
      }
    });

    test("ignores every event but jira:issue_updated", async () => {
      // issue_created carries a status changelog too, and still is not a status change.
      expectSkipped(
        await readEvent(jiraIssueCreatedEvent({ labels: kind.linkLabels })),
        "Ignored a jira:issue_created event: this workflow only handles jira:issue_updated.",
      );
      expectSkipped(
        await readEvent(jiraCommentEvent()),
        "Ignored a comment_created event: this workflow only handles jira:issue_updated.",
      );
      expectSkipped(await readEvent({}), NOT_A_JIRA_EVENT_REASON);
    });

    test(`skips an issue that is not linked to an ${kind.noun}`, async () => {
      for (const labels of [[], [JIRA_LINK_LABEL], ["backend"]]) {
        expectSkipped(
          await readEvent(
            jiraIssueUpdatedEvent({ items: STARTED_CHANGELOG, labels: labels }),
          ),
          notLinkedReason(kind),
        );
      }
    });

    test("skips a link label whose id is not a UUID", async () => {
      const labelSets: Array<Array<string>> = [
        [JIRA_LINK_LABEL, `${kind.labelPrefix}42`],
        [JIRA_LINK_LABEL, `${kind.label}-old`],
        [JIRA_LINK_LABEL, `x-${kind.label}`],
      ];

      for (const labels of labelSets) {
        expectSkipped(
          await readEvent(
            jiraIssueUpdatedEvent({ items: STARTED_CHANGELOG, labels: labels }),
          ),
          notLinkedReason(kind),
        );
      }
    });

    test("reads a link label in any case and hands the id on lowercased", async () => {
      // Labels are lowercased before matching, so the id always reaches find-one as stored.
      const result: JSONObject = await readEvent(
        jiraIssueUpdatedEvent({
          items: STARTED_CHANGELOG,
          labels: [`${kind.mixedCaseLabelPrefix}${kind.id.toUpperCase()}`],
        }),
      );

      expect(result[idKey]).toBe(kind.id);
    });

    test("takes the first valid link label", async () => {
      const result: JSONObject = await readEvent(
        jiraIssueUpdatedEvent({
          items: STARTED_CHANGELOG,
          labels: [
            `${kind.labelPrefix}garbage`,
            kind.labelOf(kind.otherId),
            kind.label,
          ],
        }),
      );

      expect(result[idKey]).toBe(kind.otherId);
    });

    test("skips an event whose issue key is not a Jira key", async () => {
      expectSkipped(
        await readEvent(
          withIssue(linkedUpdate(kind, STARTED_CHANGELOG), {
            key: "../../myself",
          }),
        ),
        NO_ISSUE_KEY_REASON,
      );
    });

    test("leaves changedBy empty when the event names no user", async () => {
      const result: JSONObject = await readEvent(
        omit(linkedUpdate(kind, STARTED_CHANGELOG, { status: IN_PROGRESS }), [
          "user",
        ]),
      );

      expect(result["proceed"]).toBe(true);
      expect(result["changedBy"]).toBe("");
    });

    test("reads a body that arrived as JSON text", async () => {
      // The runtime parses a JSON argument before the script runs; the script does not rely on it.
      const event: JSONObject = linkedUpdate(kind, RESOLVED_CHANGELOG, {
        status: DONE,
      });

      expect(await readEvent(JSON.stringify(event))).toEqual(
        await readEvent(event),
      );
    });
  });
}

interface StatusEventProps {
  jiraStatus?: string | undefined;
  jiraStatusCategory?: string | undefined;
  changedBy?: string | undefined;
}

type StatusEventFunction = (
  kind: RecordKind,
  props?: StatusEventProps | undefined,
) => JSONObject;

/** What read-event-1 hands on: Done, moved by Priya Patel, unless told otherwise. */
const statusEvent: StatusEventFunction = (
  kind: RecordKind,
  props?: StatusEventProps | undefined,
): JSONObject => {
  return {
    proceed: true,
    [`${kind.noun}Id`]: kind.id,
    issueKey: JIRA_ISSUE_KEY,
    jiraStatus: props?.jiraStatus === undefined ? "Done" : props.jiraStatus,
    jiraStatusCategory:
      props?.jiraStatusCategory === undefined
        ? "done"
        : props.jiraStatusCategory,
    changedBy: props?.changedBy === undefined ? "Priya Patel" : props.changedBy,
  };
};

type KindEventFunction = (kind: RecordKind) => JSONObject;

const inProgressEvent: KindEventFunction = (kind: RecordKind): JSONObject => {
  return statusEvent(kind, {
    jiraStatus: "In Progress",
    jiraStatusCategory: "indeterminate",
  });
};

type DecideArgsFunction = (
  kind: RecordKind,
  event: JSONValue,
  record?: JSONValue,
  states?: JSONValue,
) => JSONObject;

const decideArgs: DecideArgsFunction = (
  kind: RecordKind,
  event: JSONValue,
  record?: JSONValue,
  states?: JSONValue,
): JSONObject => {
  return {
    [kind.noun]: asArgument(record === undefined ? kind.model() : record),
    states: asArgument(states === undefined ? kind.states : states),
    event: asArgument(event),
  };
};

for (const kind of KINDS) {
  const decideState: RunStepFunction = kind.steps.decideState;

  describe(`decide-state-1 maps the Jira status onto an ${kind.noun} state`, () => {
    test(`resolves the ${kind.noun} when the issue reaches a Done status`, async () => {
      const result: JSONObject = await decideState(
        decideArgs(kind, statusEvent(kind)),
      );

      expect(result).toEqual({
        proceed: true,
        [`${kind.noun}Id`]: kind.id,
        stateId: kind.resolvedStateId,
        stateName: "Resolved",
        rootCause:
          "Synced from Jira: issue OPS-17 moved to Done by Priya Patel.",
      });
      // The note templates skip text carrying this marker.
      expect(
        textOf(result, "rootCause").startsWith(
          `${ONEUPTIME_SYNCED_FROM_JIRA_MARKER}: `,
        ),
      ).toBe(true);
    });

    test(`acknowledges the ${kind.noun} when work starts on the issue`, async () => {
      const result: JSONObject = await decideState(
        decideArgs(kind, inProgressEvent(kind)),
      );

      expect(result["stateId"]).toBe(kind.acknowledgedStateId);
      expect(result["rootCause"]).toBe(
        "Synced from Jira: issue OPS-17 moved to In Progress by Priya Patel.",
      );
    });

    test("does nothing when the issue moves back to To Do", async () => {
      expectSkipped(
        await decideState(
          decideArgs(
            kind,
            statusEvent(kind, {
              jiraStatus: "To Do",
              jiraStatusCategory: "new",
            }),
          ),
        ),
        "Jira issue OPS-17 moved to To Do, which does not map to a OneUptime state.",
      );
    });

    test(`does not move the ${kind.noun} to the state it is already in`, async () => {
      expectSkipped(
        await decideState(
          decideArgs(
            kind,
            inProgressEvent(kind),
            kind.model({ state: kind.acknowledgedState }),
          ),
        ),
        `${kind.number} is already Acknowledged, so Jira issue OPS-17 moving to In Progress changes nothing.`,
      );
    });

    test(`never moves the ${kind.noun} backwards`, async () => {
      expectSkipped(
        await decideState(
          decideArgs(
            kind,
            inProgressEvent(kind),
            kind.model({ state: kind.resolvedState }),
          ),
        ),
        `${kind.number} is already Resolved, so Jira issue OPS-17 moving to In Progress changes nothing.`,
      );
    });

    test("settles the echo of a transition OneUptime made itself", async () => {
      // The OneUptime-to-Jira template moved the issue to Done because the record resolved.
      expectSkipped(
        await decideState(
          decideArgs(
            kind,
            statusEvent(kind),
            kind.model({ state: kind.resolvedState }),
          ),
        ),
        `${kind.number} is already Resolved, so Jira issue OPS-17 moving to Done changes nothing.`,
      );
    });

    test(`skips, naming the id, when no ${kind.noun} was found`, async () => {
      for (const record of ["null", unresolvedRecord(kind)]) {
        expectSkipped(
          await decideState(decideArgs(kind, statusEvent(kind), record)),
          `No ${kind.noun} with id ${kind.id} exists in this project.`,
        );
      }
    });

    test(`skips when the ${kind.noun}'s states could not be read`, async () => {
      for (const states of ["null", UNRESOLVED_STATES, []]) {
        expectSkipped(
          await decideState(
            decideArgs(
              kind,
              statusEvent(kind),
              kind.model(),
              states as JSONValue,
            ),
          ),
          "Jira issue OPS-17 moved to Done, which does not map to a OneUptime state.",
        );
      }
    });

    test("finds the state by its flag whatever order the states arrive in", async () => {
      for (const states of [
        kind.states,
        [...kind.states].reverse(),
        statesWithMonitoring(kind),
      ]) {
        const result: JSONObject = await decideState(
          decideArgs(kind, inProgressEvent(kind), kind.model(), states),
        );

        expect(result["stateId"]).toBe(kind.acknowledgedStateId);
      }
    });

    test("a status named in JIRA_STATUS_TO_STATE wins over its category", async () => {
      const result: JSONObject = await decideState(
        decideArgs(
          kind,
          statusEvent(kind),
          kind.model(),
          statesWithMonitoring(kind),
        ),
        replaceInCode(
          "const JIRA_STATUS_TO_STATE = {};",
          "const JIRA_STATUS_TO_STATE = { Done: 'monitoring' };",
        ),
      );

      // Done would otherwise resolve the record; the name asks for Monitoring instead.
      expect(result["stateId"]).toBe(MONITORING_STATE_ID);
      expect(result["stateName"]).toBe("Monitoring");
    });

    test("a status named in JIRA_STATUS_TO_STATE does not fall back to its category", async () => {
      expectSkipped(
        await decideState(
          decideArgs(
            kind,
            statusEvent(kind, {
              jiraStatus: "In Review",
              jiraStatusCategory: "indeterminate",
            }),
          ),
          replaceInCode(
            "const JIRA_STATUS_TO_STATE = {};",
            "const JIRA_STATUS_TO_STATE = { 'In Review': 'Verifying' };",
          ),
        ),
        "Jira issue OPS-17 moved to In Review, which does not map to a OneUptime state.",
      );
    });

    test("leaves the actor out of the root cause when Jira named none", async () => {
      const result: JSONObject = await decideState(
        decideArgs(kind, statusEvent(kind, { changedBy: "" })),
      );

      expect(result["rootCause"]).toBe(
        "Synced from Jira: issue OPS-17 moved to Done.",
      );
    });

    test("caps the root cause at 1000 characters and defuses double braces in it", async () => {
      const longName: JSONObject = await decideState(
        decideArgs(kind, statusEvent(kind, { changedBy: "c".repeat(2000) })),
      );
      const braces: JSONObject = await decideState(
        decideArgs(
          kind,
          statusEvent(kind, {
            jiraStatus: SECRET_REFERENCE,
            changedBy: SECRET_REFERENCE,
          }),
        ),
      );

      expect(textOf(longName, "rootCause")).toHaveLength(1000);
      expect(textOf(braces, "rootCause")).toContain(DEFUSED_SECRET_REFERENCE);
      expect(textOf(braces, "rootCause")).not.toContain("{{");
    });

    test("accepts read-event-1's real output", async () => {
      const event: JSONObject = await kind.steps.readEvent(
        linkedUpdate(kind, RESOLVED_CHANGELOG, { status: DONE }),
      );
      const result: JSONObject = await decideState(decideArgs(kind, event));

      expect(result["stateId"]).toBe(kind.resolvedStateId);
    });
  });
}

for (const kind of KINDS) {
  const readComment: RunStepFunction = kind.steps.readComment;

  describe(`read-comment-1 in ${kind.templates.commentToNote} turns a Jira comment into the text of a note`, () => {
    test("writes the note under a heading naming the author and linking the issue", async () => {
      const result: JSONObject = await readComment(jiraCommentEvent());

      expect(result).toEqual({
        proceed: true,
        issueKey: JIRA_ISSUE_KEY,
        note: `Synced from Jira: Marco Rossi commented on ${ISSUE_LINK}.\n\nRolled back the *eu-west-1* deploy. Watching the error rate.`,
      });
      // The note templates skip notes carrying this marker.
      expect(
        textOf(result, "note").startsWith(
          `${ONEUPTIME_SYNCED_FROM_JIRA_MARKER}: `,
        ),
      ).toBe(true);
    });

    test("ignores an edited comment by default", async () => {
      expectSkipped(
        await readComment(
          jiraCommentEvent({ webhookEvent: "comment_updated" }),
        ),
        "Ignored a comment_updated event: this workflow only handles comment_created.",
      );
    });

    test("copies edits once comment_updated is added to EVENTS", async () => {
      const addUpdates: EditCodeFunction = replaceInCode(
        "const EVENTS = ['comment_created'];",
        "const EVENTS = ['comment_created', 'comment_updated'];",
      );

      const updated: JSONObject = await readComment(
        jiraCommentEvent({ webhookEvent: "comment_updated" }),
        addUpdates,
      );

      expect(updated["proceed"]).toBe(true);
      expectSkipped(
        await readComment(
          jiraCommentEvent({ webhookEvent: "comment_deleted" }),
          addUpdates,
        ),
        "Ignored a comment_deleted event: this workflow only handles comment_created, comment_updated.",
      );
    });

    test("does not copy back a comment OneUptime posted", async () => {
      // One OneUptime wrote, and one that quotes it further down.
      const bodies: Array<string> = [
        `${JIRA_SYNCED_FROM_ONEUPTIME_MARKER}: private note on ${kind.number} by Jane Doe.\n\nFailed over.`,
        `Agreed with this:\n\n> ${JIRA_SYNCED_FROM_ONEUPTIME_MARKER}: ${kind.number} was updated.`,
      ];

      for (const body of bodies) {
        expectSkipped(
          await readComment(jiraCommentEvent({ body: body })),
          "This comment was posted by OneUptime, so it was not copied back.",
        );
      }
    });

    test("skips an empty comment", async () => {
      for (const body of ["", "  \n\t ", null]) {
        expectSkipped(
          await readComment(jiraCommentEvent({ body: body as JSONValue })),
          "The comment on Jira issue OPS-17 is empty.",
        );
      }
    });

    test("flattens a comment in Atlassian Document Format to text", async () => {
      const result: JSONObject = await readComment(
        jiraCommentEvent({ body: ADF_TEXT }),
      );

      expect(textOf(result, "note").endsWith(`.\n\n${ADF_AS_TEXT}`)).toBe(true);
    });

    test("says Someone commented when the comment has no author", async () => {
      const event: JSONObject = jiraCommentEvent();
      const result: JSONObject = await readComment({
        ...event,
        comment: omit(event["comment"] as JSONObject, ["author"]),
      });

      expect(
        textOf(result, "note").startsWith(
          `Synced from Jira: Someone commented on ${ISSUE_LINK}.`,
        ),
      ).toBe(true);
    });

    test("defuses double braces in the comment and its author's name", async () => {
      const result: JSONObject = await readComment(
        jiraCommentEvent({
          body: `Here it is: ${SECRET_REFERENCE}`,
          author: jiraUser(SECRET_REFERENCE),
        }),
      );
      const note: string = textOf(result, "note");

      expect(note).toContain(`Here it is: ${DEFUSED_SECRET_REFERENCE}`);
      expect(note).not.toContain("{{");
    });

    test("caps the note at 30000 characters", async () => {
      const result: JSONObject = await readComment(
        jiraCommentEvent({ body: "b".repeat(40000) }),
      );

      expect(textOf(result, "note")).toHaveLength(30000);
    });

    test("skips a comment whose issue key is not a Jira key", async () => {
      expectSkipped(
        await readComment(jiraCommentEvent({ issueKey: "../../myself" })),
        NO_ISSUE_KEY_REASON,
      );
    });

    test("ignores a request that is not a Jira event", async () => {
      expectSkipped(await readComment({}), NOT_A_JIRA_EVENT_REASON);
    });

    test("keeps the comment's author on one line", async () => {
      const result: JSONObject = await readComment(
        withComment(jiraCommentEvent(), { author: jiraUser("Marco\nRossi\t") }),
      );

      expect(
        textOf(result, "note").startsWith(
          "Synced from Jira: Marco Rossi commented",
        ),
      ).toBe(true);
    });
  });
}

/* What read-comment-1 hands on when it proceeds. */
const COMMENT_STEP_OUTPUT: JSONObject = {
  proceed: true,
  issueKey: JIRA_ISSUE_KEY,
  note: `Synced from Jira: Marco Rossi commented on ${ISSUE_LINK}.\n\nRolled back.`,
};

type FindLinkArgsFunction = (
  issue: JSONValue,
  comment?: JSONValue,
) => JSONObject;

const findLinkArgs: FindLinkArgsFunction = (
  issue: JSONValue,
  comment?: JSONValue,
): JSONObject => {
  return {
    comment: asArgument(comment === undefined ? COMMENT_STEP_OUTPUT : comment),
    issue: asArgument(issue),
  };
};

for (const kind of KINDS) {
  const findLink: RunStepFunction = kind.steps.findLink;
  const linked: JSONObject = { proceed: true, [`${kind.noun}Id`]: kind.id };

  describe(`find-link-1 in ${kind.templates.commentToNote} reads the ${kind.noun} id off the issue's labels`, () => {
    test(`finds the ${kind.noun} from the issue's link label`, async () => {
      const result: JSONObject = await findLink(
        findLinkArgs(jiraIssueLabelsResponse(kind.linkLabels)),
      );

      expect(result).toEqual(linked);
    });

    test("hands the id on lowercased", async () => {
      const result: JSONObject = await findLink(
        findLinkArgs(
          jiraIssueLabelsResponse([
            `${kind.labelPrefix.toUpperCase()}${kind.id.toUpperCase()}`,
          ]),
        ),
      );

      expect(result[`${kind.noun}Id`]).toBe(kind.id);
    });

    test("skips, naming the issue, when no label links it", async () => {
      const labelSets: Array<Array<string>> = [
        [],
        [JIRA_LINK_LABEL],
        [kind.labelPrefix, `${kind.labelPrefix}42`, `${kind.noun}-${kind.id}`],
      ];

      for (const labels of labelSets) {
        expectSkipped(
          await findLink(findLinkArgs(jiraIssueLabelsResponse(labels))),
          notLinkedReason(kind),
        );
      }
    });

    test("skips when the issue response has no fields or never resolved", async () => {
      const responses: Array<JSONValue> = [
        { key: JIRA_ISSUE_KEY },
        "{{local.components.get-issue-1.returnValues.response-body}}",
        "null",
      ];

      for (const issue of responses) {
        expectSkipped(
          await findLink(findLinkArgs(issue)),
          notLinkedReason(kind),
        );
      }
    });

    test("accepts read-comment-1's real output", async () => {
      const comment: JSONObject =
        await kind.steps.readComment(jiraCommentEvent());
      const result: JSONObject = await findLink(
        findLinkArgs(jiraIssueLabelsResponse(kind.linkLabels), comment),
      );

      expect(result).toEqual(linked);
    });
  });
}

for (const kind of KINDS) {
  const readChanges: RunStepFunction = kind.steps.readChanges;

  describe(`read-changes-1 in ${kind.templates.changesToNote} lists what changed on a linked issue`, () => {
    test("notes a priority change", async () => {
      const result: JSONObject = await readChanges(
        linkedUpdate(kind, [PRIORITY_RAISED]),
      );

      expect(result).toEqual({
        proceed: true,
        [`${kind.noun}Id`]: kind.id,
        issueKey: JIRA_ISSUE_KEY,
        note: `Synced from Jira: Priya Patel updated ${ISSUE_LINK}.\n\n- priority: High → Highest`,
      });
    });

    test("notes assignee, summary and description changes, one line each", async () => {
      const result: JSONObject = await readChanges(
        linkedUpdate(kind, [ASSIGNED, SUMMARY_CHANGED, DESCRIPTION_CHANGED]),
      );

      expect(textOf(result, "note").split("\n\n")[1]).toBe(
        [
          "- assignee: (empty) → Marco Rossi",
          "- summary: Checkout API returns 502 for EU customers → Checkout API returns 502 for all customers",
          "- description: Customers in *eu-west-1* see 502s at checkout. Started around 09:40 UTC. → Customers in every region see 502s at checkout.",
        ].join("\n"),
      );
    });

    test("shows a cleared value as (empty)", async () => {
      const result: JSONObject = await readChanges(
        linkedUpdate(kind, [
          changelogItem({
            field: "assignee",
            from: "712020:0f3c5a4e-marco",
            fromString: "Marco Rossi",
            to: null,
            toString: null,
          }),
        ]),
      );

      expect(textOf(result, "note")).toContain(
        "\n- assignee: Marco Rossi → (empty)",
      );
    });

    test("caps a long value at 300 characters", async () => {
      const result: JSONObject = await readChanges(
        linkedUpdate(kind, [
          changelogItem({
            field: "summary",
            fromString: "Short",
            toString: "s".repeat(500),
          }),
        ]),
      );

      expect(textOf(result, "note")).toContain(
        `- summary: Short → ${"s".repeat(299)}…`,
      );
      expect(textOf(result, "note")).not.toContain("s".repeat(300));
    });

    test("names a field by its id when the item has no name", async () => {
      const result: JSONObject = await readChanges(
        linkedUpdate(kind, [
          changelogItem({
            field: "",
            fieldId: "customfield_10050",
            fromString: "a",
            toString: "b",
          }),
        ]),
      );

      expect(textOf(result, "note")).toContain("\n- customfield_10050: a → b");
    });

    test("leaves status, resolution and time tracking to the status template", async () => {
      expectSkipped(
        await readChanges(
          linkedUpdate(kind, [...RESOLVED_CHANGELOG, ...TIME_LOGGED], {
            status: DONE,
          }),
        ),
        NOTHING_WORTH_A_NOTE_REASON,
      );
    });

    test("ignores the Rank change from dragging the issue on a board", async () => {
      expectSkipped(
        await readChanges(linkedUpdate(kind, [RANKED])),
        NOTHING_WORTH_A_NOTE_REASON,
      );
    });

    test("ignores a field by its display name, whatever custom field id the site gave it", async () => {
      // Every Jira site numbers its custom fields differently; only the name is stable.
      const items: Array<JSONObject> = [
        RANKED,
        { ...RANKED, field: "RANK", fieldId: "customfield_10500" },
        { ...RANKED, field: "rank", fieldId: "customfield_12345" },
      ];

      for (const item of items) {
        expectSkipped(
          await readChanges(linkedUpdate(kind, [item])),
          NOTHING_WORTH_A_NOTE_REASON,
        );
      }
    });

    test("ignores a field by its id, whatever it is called", async () => {
      // Jira Cloud names some fields differently from their ids, and translates the names.
      const items: Array<JSONObject> = [
        changelogItem({
          field: "Time Spent",
          fieldId: "timespent",
          fromString: null,
          toString: "3600",
        }),
        changelogItem({
          field: "Last Viewed",
          fieldId: "lastViewed",
          fromString: null,
          toString: "2026-09-23",
        }),
        changelogItem({
          field: "Statut",
          fieldId: "status",
          fromString: "À faire",
          toString: "En cours",
        }),
      ];

      for (const item of items) {
        expectSkipped(
          await readChanges(linkedUpdate(kind, [item])),
          NOTHING_WORTH_A_NOTE_REASON,
        );
      }
    });

    test("still notes a custom field that is not ignored, next to an ignored one", async () => {
      const result: JSONObject = await readChanges(
        linkedUpdate(kind, [
          RANKED,
          changelogItem({
            field: "Story Points",
            fieldId: "customfield_10016",
            fromString: "3",
            toString: "5",
          }),
        ]),
      );

      expect(textOf(result, "note").split("\n\n")[1]).toBe(
        "- Story Points: 3 → 5",
      );
    });

    test(`ignores the ${kind.labelPrefix} link labels the create template adds`, async () => {
      // Its label PUT arrives back here as a labels change on a freshly linked issue.
      for (const item of [
        labelsChanged("", `${JIRA_LINK_LABEL} ${kind.label}`),
        labelsChanged("backend", `backend ${JIRA_LINK_LABEL} ${kind.label}`),
      ]) {
        expectSkipped(
          await readChanges(linkedUpdate(kind, [item])),
          NOTHING_WORTH_A_NOTE_REASON,
        );
      }
    });

    test("reports a labels change that adds another label next to the link", async () => {
      const result: JSONObject = await readChanges(
        linkedUpdate(kind, [
          labelsChanged("", `${JIRA_LINK_LABEL} ${kind.label} sev1`),
        ]),
      );

      expect(textOf(result, "note")).toContain(
        `\n- labels: (empty) → ${JIRA_LINK_LABEL} ${kind.label} sev1`,
      );
    });

    test("lists the noteworthy changes and drops the rest", async () => {
      const result: JSONObject = await readChanges(
        linkedUpdate(kind, [...RESOLVED_CHANGELOG, PRIORITY_RAISED], {
          status: DONE,
        }),
      );

      expect(textOf(result, "note").split("\n\n")[1]).toBe(
        "- priority: High → Highest",
      );
    });

    test("skips when there is no changelog", async () => {
      expectSkipped(
        await readChanges(
          omit(linkedUpdate(kind, [PRIORITY_RAISED]), ["changelog"]),
        ),
        NOTHING_WORTH_A_NOTE_REASON,
      );
    });

    test(`skips an issue that is not linked to an ${kind.noun}`, async () => {
      expectSkipped(
        await readChanges(
          jiraIssueUpdatedEvent({ items: [PRIORITY_RAISED], labels: [] }),
        ),
        notLinkedReason(kind),
      );
    });

    test("ignores every event but jira:issue_updated", async () => {
      expectSkipped(
        await readChanges(jiraIssueCreatedEvent({ labels: kind.linkLabels })),
        "Ignored a jira:issue_created event: this workflow only handles jira:issue_updated.",
      );
      expectSkipped(
        await readChanges(jiraCommentEvent()),
        "Ignored a comment_created event: this workflow only handles jira:issue_updated.",
      );
      expectSkipped(await readChanges({}), NOT_A_JIRA_EVENT_REASON);
    });

    test("skips an event whose issue key is not a Jira key", async () => {
      expectSkipped(
        await readChanges(
          withIssue(linkedUpdate(kind, [PRIORITY_RAISED]), { key: "OPS 17" }),
        ),
        NO_ISSUE_KEY_REASON,
      );
    });

    test("says Someone updated the issue when the event names no user", async () => {
      const result: JSONObject = await readChanges(
        omit(linkedUpdate(kind, [PRIORITY_RAISED]), ["user"]),
      );

      expect(
        textOf(result, "note").startsWith(
          `Synced from Jira: Someone updated ${ISSUE_LINK}.`,
        ),
      ).toBe(true);
    });

    test("defuses double braces in changed values", async () => {
      const result: JSONObject = await readChanges(
        linkedUpdate(kind, [
          changelogItem({
            field: "summary",
            fromString: "Old",
            toString: SECRET_REFERENCE,
          }),
        ]),
      );
      const note: string = textOf(result, "note");

      expect(note).toContain(`- summary: Old → ${DEFUSED_SECRET_REFERENCE}`);
      expect(note).not.toContain("{{");
    });
  });
}

/* ------------------------------ Across kinds ------------------------------ */

/*
 * One Jira issue belongs to one record. The create-from-Jira templates count
 * either kind's label as "already linked", so an issue filed for an alert is
 * never also made an incident, nor the other way round. The readers take only
 * their own kind's label, so an alert's issue moving, or being commented on,
 * never touches an incident.
 */
for (const pair of CROSS_KINDS) {
  const kind: RecordKind = pair.kind;
  const other: RecordKind = pair.other;
  const idKey: string = `${kind.noun}Id`;

  // The ways an issue can say it belongs to the other kind.
  const otherLabelSets: Array<Array<string>> = [
    other.linkLabels,
    [other.label],
    [`${other.mixedCaseLabelPrefix}${other.id.toUpperCase()}`],
    ["backend", `${other.labelPrefix}not-even-an-id`],
  ];

  describe(`an issue linked to an ${other.noun} is never taken for an ${kind.noun}`, () => {
    test(`${kind.prepareRecordStep} makes no ${kind.noun} of an issue labelled ${other.labelPrefix}<id>`, async () => {
      for (const labels of otherLabelSets) {
        expectSkipped(
          await kind.steps.prepareRecord(
            recordArgs(kind, jiraIssueCreatedEvent({ labels: labels })),
          ),
          alreadyLinkedReason(kind),
        );
      }
    });

    test(`confirm-unlinked-1 in ${kind.templates.createRecord} makes no ${kind.noun} of an issue Jira says is linked to an ${other.noun}`, async () => {
      for (const labels of otherLabelSets) {
        expectSkipped(
          await kind.steps.confirmUnlinked(
            confirmArgs(jiraIssueLabelsResponse(labels)),
          ),
          alreadyLinkedReason(kind),
        );
      }
    });

    test(`read-event-1 in ${kind.templates.statusToState} says the ${other.noun}'s issue is not linked to an ${kind.noun}`, async () => {
      expectSkipped(
        await kind.steps.readEvent(
          jiraIssueUpdatedEvent({
            items: STARTED_CHANGELOG,
            labels: other.linkLabels,
            status: IN_PROGRESS,
          }),
        ),
        notLinkedReason(kind),
      );
    });

    test(`find-link-1 in ${kind.templates.commentToNote} says the ${other.noun}'s issue is not linked to an ${kind.noun}`, async () => {
      expectSkipped(
        await kind.steps.findLink(
          findLinkArgs(jiraIssueLabelsResponse(other.linkLabels)),
        ),
        notLinkedReason(kind),
      );
    });

    test(`read-changes-1 in ${kind.templates.changesToNote} says the ${other.noun}'s issue is not linked to an ${kind.noun}`, async () => {
      expectSkipped(
        await kind.steps.readChanges(
          jiraIssueUpdatedEvent({
            items: [PRIORITY_RAISED],
            labels: other.linkLabels,
          }),
        ),
        notLinkedReason(kind),
      );
    });

    test(`read-changes-1 in ${kind.templates.changesToNote} ignores a labels change that only adds ${other.labelPrefix} labels`, async () => {
      /*
       * Every link label counts as linking, whichever kind it names: adding
       * one is how an issue gets linked, not a change worth a note.
       */
      const labelsBefore: string = `${JIRA_LINK_LABEL} ${kind.label}`;

      for (const added of [
        other.label,
        `${other.label} ${other.labelOf(other.otherId)}`,
      ]) {
        expectSkipped(
          await kind.steps.readChanges(
            linkedUpdate(
              kind,
              [labelsChanged(labelsBefore, `${labelsBefore} ${added}`)],
              { labels: [...kind.linkLabels, ...added.split(" ")] },
            ),
          ),
          NOTHING_WORTH_A_NOTE_REASON,
        );
      }
    });

    test(`the ${kind.noun} readers take the ${kind.noun}'s id, never the ${other.noun}'s, from an issue carrying both labels`, async () => {
      // The other kind's label comes first, so a loose prefix match would take its id.
      const labels: Array<string> = [JIRA_LINK_LABEL, other.label, kind.label];
      const results: Array<JSONObject> = [
        await kind.steps.readEvent(
          jiraIssueUpdatedEvent({
            items: STARTED_CHANGELOG,
            labels: labels,
            status: IN_PROGRESS,
          }),
        ),
        await kind.steps.findLink(
          findLinkArgs(jiraIssueLabelsResponse(labels)),
        ),
        await kind.steps.readChanges(
          jiraIssueUpdatedEvent({ items: [PRIORITY_RAISED], labels: labels }),
        ),
      ];

      for (const result of results) {
        expect(result["proceed"]).toBe(true);
        expect(result[idKey]).toBe(kind.id);
        expect(result[`${other.noun}Id`]).toBeUndefined();
      }
    });
  });
}

/* ------------------------------ Alerts only ------------------------------ */

type AlertSeverityForFunction = (priority: string | null) => Promise<string>;

/*
 * The tests above build their expectations from KINDS. These spell the alert
 * versions out word for word, so a wrong word could not pass by being
 * repeated in the table, and they cover where an alert is not an incident.
 */
describe("the alert scripts speak of alerts", () => {
  test("prepare-issue-1 files an alert under an oneuptime-alert- label, linking to its page under /alerts/", async () => {
    const result: JSONObject = await ALERT.steps.prepareIssue({
      oneuptimeUrl: ONEUPTIME_URL,
      alert: quoted(alertModel()),
    });

    expect(result).toEqual({
      proceed: true,
      summary: "[OneUptime] ALT-7: Disk usage above 90% on db-1",
      description:
        'ALT-7 was created in OneUptime.\nSeverity: High\nState: Identified\n\nThe "db-1" volume is at 93%.\nIt grew 4% in the last hour.',
      alertLabel: `oneuptime-alert-${ALERT_ID}`,
      alertUrl: `https://oneuptime.com/dashboard/${PROJECT_ID}/alerts/${ALERT_ID}`,
    });
    expect(textOf(result, "alertLabel")).toBe(
      `${JIRA_ALERT_LABEL_PREFIX}${ALERT_ID}`,
    );
  });

  test("prepare-issue-1 keeps a private alert in OneUptime until SYNC_PRIVATE_ALERTS is true", async () => {
    const args: JSONObject = {
      oneuptimeUrl: ONEUPTIME_URL,
      alert: quoted(alertModel({ isPrivate: true })),
    };

    expectSkipped(
      await ALERT.steps.prepareIssue(args),
      "ALT-7 is a private alert, so no Jira issue was created.",
    );

    const synced: JSONObject = await ALERT.steps.prepareIssue(
      args,
      replaceInCode(
        "const SYNC_PRIVATE_ALERTS = false;",
        "const SYNC_PRIVATE_ALERTS = true;",
      ),
    );

    expect(synced["proceed"]).toBe(true);
    expect(synced["alertLabel"]).toBe(`oneuptime-alert-${ALERT_ID}`);
  });

  test("prepare-issue-1 files no second issue for an alert created from Jira", async () => {
    expectSkipped(
      await ALERT.steps.prepareIssue({
        oneuptimeUrl: ONEUPTIME_URL,
        alert: quoted(alertModel({ customFields: { jiraIssueKey: "OPS-17" } })),
      }),
      "ALT-7 was created from Jira issue OPS-17, so no new issue was created.",
    );
  });

  test("plan-transition-1 moves an acknowledged alert's issue to In Progress", async () => {
    const result: JSONObject = await ALERT.steps.planTransition({
      alert: quoted(alertModel({ state: ALERT_ACKNOWLEDGED_STATE })),
      search: quoted(jiraSearchResponse()),
    });

    expect(result).toEqual({
      proceed: true,
      issueKey: JIRA_ISSUE_KEY,
      transitionId: "21",
      jiraStatus: "In Progress",
      reason: "ALT-7 is Acknowledged in OneUptime.",
    });
  });

  test("plan-transition-1 names the alert's label when no issue carries it", async () => {
    expectSkipped(
      await ALERT.steps.planTransition({
        alert: quoted(alertModel({ state: ALERT_ACKNOWLEDGED_STATE })),
        search: quoted(EMPTY_JIRA_SEARCH),
      }),
      `No Jira issue is labelled oneuptime-alert-${ALERT_ID}, or the Jira credentials cannot see it.`,
    );
  });

  test("build-comment-1 posts a private note on an alert under the alert's number", async () => {
    const result: JSONObject = await step(
      "jira-comment-from-alert-private-note",
      "build-comment-1",
    )({
      note: quoted(alertNoteModel()),
      search: quoted(jiraSearchResponse()),
    });

    expect(result).toEqual({
      proceed: true,
      issueKey: JIRA_ISSUE_KEY,
      comment:
        "Synced from OneUptime: private note on ALT-7 by Jane Doe.\n\nCleared old WAL segments. Usage is back to 71%.",
    });
  });

  test("build-comment-1 keeps a note on a private alert in OneUptime", async () => {
    expectSkipped(
      await step(
        "jira-comment-from-alert-private-note",
        "build-comment-1",
      )({
        note: quoted(alertNoteModel({ isPrivate: true })),
        search: quoted(jiraSearchResponse()),
      }),
      "The note is on ALT-7, a private alert, so it was not posted to Jira.",
    );
  });

  test("build-comment-1 in jira-comment-on-alert-update still shows the root cause the trigger does not listen on", async () => {
    // An alert's root cause is written when it is created and cannot be edited, but it is still worth reading.
    const result: JSONObject = await ALERT.steps.updateComment({
      alert: quoted(
        alertModel({
          rootCause: "The WAL archiver was stuck.",
          remediationNotes: "Restarted the archiver.",
        }),
      ),
      search: quoted(jiraSearchResponse()),
    });

    expect(result).toEqual({
      proceed: true,
      issueKey: JIRA_ISSUE_KEY,
      comment:
        'Synced from OneUptime: ALT-7 was updated.\nTitle: Disk usage above 90% on db-1\nSeverity: High\nState: Identified\nRoot cause: The WAL archiver was stuck.\nRemediation: Restarted the archiver.\nDescription: The "db-1" volume is at 93%.\nIt grew 4% in the last hour.',
    });
  });

  test("prepare-alert-1 hands on only what an alert is created with", async () => {
    // No status-page fields: an alert never reaches a status page.
    const result: JSONObject = await ALERT.steps.prepareRecord({
      severities: quoted(ALERT_SEVERITIES),
      payload: quoted(jiraIssueCreatedEvent()),
    });

    expect(result).toEqual({
      proceed: true,
      issueKey: JIRA_ISSUE_KEY,
      severityName: "High",
      alertSeverityId: HIGH_ALERT_SEVERITY_ID,
      title: "Checkout API returns 502 for EU customers",
      description: `Created from Jira issue ${ISSUE_LINK}.\nPriority: High\nReported by: Priya Patel\n\nCustomers in *eu-west-1* see 502s at checkout.\nStarted around 09:40 UTC.`,
    });
  });

  test("prepare-alert-1 sends Medium, and every priority it does not know, to Low", async () => {
    /*
     * With the two default alert severities there is no middle one: rank 1
     * lands halfway and rounds to the less severe. An incident project's
     * three severities would give Medium the middle one instead.
     */
    const severityFor: AlertSeverityForFunction = async (
      priority: string | null,
    ): Promise<string> => {
      const result: JSONObject = await ALERT.steps.prepareRecord({
        severities: quoted(ALERT_SEVERITIES),
        payload: quoted(jiraIssueCreatedEvent({ priority: priority })),
      });

      return `${textOf(result, "severityName")} ${textOf(result, "alertSeverityId")}`;
    };

    for (const priority of ["Highest", "High", "Blocker", "Critical"]) {
      expect(await severityFor(priority)).toBe(
        `High ${HIGH_ALERT_SEVERITY_ID}`,
      );
    }

    for (const priority of [
      "Medium",
      "Major",
      "P2 - Urgent-ish",
      null,
      "Low",
      "Lowest",
    ]) {
      expect(await severityFor(priority)).toBe(`Low ${LOW_ALERT_SEVERITY_ID}`);
    }
  });

  test("prepare-alert-1 and confirm-unlinked-1 say no alert was created", async () => {
    expectSkipped(
      await ALERT.steps.prepareRecord({
        severities: quoted(ALERT_SEVERITIES),
        payload: quoted(
          jiraIssueCreatedEvent({
            labels: [JIRA_LINK_LABEL, `oneuptime-alert-${ALERT_ID}`],
          }),
        ),
      }),
      "Jira issue OPS-17 is already linked to OneUptime, so no alert was created.",
    );
    expectSkipped(
      await ALERT.steps.prepareRecord({
        severities: "[]",
        payload: quoted(jiraIssueCreatedEvent()),
      }),
      "This project has no alert severities to choose from.",
    );
    expectSkipped(
      await ALERT.steps.confirmUnlinked({
        issue: quoted(jiraIssueLabelsResponse([`oneuptime-alert-${ALERT_ID}`])),
      }),
      "Jira issue OPS-17 is already linked to OneUptime, so no alert was created.",
    );
    expectSkipped(
      await ALERT.steps.confirmUnlinked({ issue: "null" }),
      "Jira did not return the issue, so no alert was created.",
    );
  });

  test("the alert readers take the alert id from an oneuptime-alert- label", async () => {
    const labels: Array<string> = [
      JIRA_LINK_LABEL,
      `oneuptime-alert-${ALERT_ID}`,
    ];

    expect(
      await ALERT.steps.readEvent(
        jiraIssueUpdatedEvent({
          items: STARTED_CHANGELOG,
          labels: labels,
          status: IN_PROGRESS,
        }),
      ),
    ).toEqual({
      proceed: true,
      alertId: ALERT_ID,
      issueKey: JIRA_ISSUE_KEY,
      jiraStatus: "In Progress",
      jiraStatusCategory: "indeterminate",
      changedBy: "Priya Patel",
    });
    expect(
      await ALERT.steps.findLink(findLinkArgs(jiraIssueLabelsResponse(labels))),
    ).toEqual({ proceed: true, alertId: ALERT_ID });
    expect(
      (
        await ALERT.steps.readChanges(
          jiraIssueUpdatedEvent({ items: [PRIORITY_RAISED], labels: labels }),
        )
      )["alertId"],
    ).toBe(ALERT_ID);
  });

  test("the alert readers name the oneuptime-alert- label an unlinked issue lacks", async () => {
    const reason: string =
      "Jira issue OPS-17 is not linked to an alert: it has no oneuptime-alert-<id> label.";

    expectSkipped(
      await ALERT.steps.readEvent(
        jiraIssueUpdatedEvent({ items: STARTED_CHANGELOG, labels: [] }),
      ),
      reason,
    );
    expectSkipped(
      await ALERT.steps.findLink(findLinkArgs(jiraIssueLabelsResponse([]))),
      reason,
    );
    expectSkipped(
      await ALERT.steps.readChanges(
        jiraIssueUpdatedEvent({ items: [PRIORITY_RAISED], labels: [] }),
      ),
      reason,
    );
  });

  test("decide-state-1 resolves the alert, or names the alert it could not find", async () => {
    const event: JSONObject = {
      proceed: true,
      alertId: ALERT_ID,
      issueKey: JIRA_ISSUE_KEY,
      jiraStatus: "Done",
      jiraStatusCategory: "done",
      changedBy: "Priya Patel",
    };

    expect(
      await ALERT.steps.decideState({
        alert: quoted(alertModel()),
        states: quoted(ALERT_STATES),
        event: quoted(event),
      }),
    ).toEqual({
      proceed: true,
      alertId: ALERT_ID,
      stateId: ALERT_RESOLVED_STATE_ID,
      stateName: "Resolved",
      rootCause: "Synced from Jira: issue OPS-17 moved to Done by Priya Patel.",
    });
    expectSkipped(
      await ALERT.steps.decideState({
        alert: "null",
        states: quoted(ALERT_STATES),
        event: quoted(event),
      }),
      `No alert with id ${ALERT_ID} exists in this project.`,
    );
    expectSkipped(
      await ALERT.steps.decideState({
        alert: quoted(alertModel({ state: ALERT_RESOLVED_STATE })),
        states: quoted(ALERT_STATES),
        event: quoted(event),
      }),
      "ALT-7 is already Resolved, so Jira issue OPS-17 moving to Done changes nothing.",
    );
  });
});

/* ---------------------------- Every script ---------------------------- */

interface ScriptStep {
  templateId: string;
  componentId: string;
  /*
   * The names in the step's JSON arguments, in the order the template writes
   * them. Empty for the steps whose whole argument is the webhook body.
   */
  argumentNames: Array<string>;
}

type ScriptStepsOfFunction = (kind: RecordKind) => Array<ScriptStep>;

/** Every script step one kind's templates ship, and the arguments each takes. */
const scriptStepsOf: ScriptStepsOfFunction = (
  kind: RecordKind,
): Array<ScriptStep> => {
  return [
    {
      templateId: kind.templates.createIssue,
      componentId: "prepare-issue-1",
      argumentNames: ["oneuptimeUrl", kind.noun],
    },
    {
      templateId: kind.templates.transition,
      componentId: "plan-transition-1",
      argumentNames: [kind.noun, "search"],
    },
    ...kind.steps.noteComments.map(
      (noteTemplate: NoteTemplateCase): ScriptStep => {
        return {
          templateId: noteTemplate.templateId,
          componentId: "build-comment-1",
          argumentNames: ["note", "search"],
        };
      },
    ),
    {
      templateId: kind.templates.update,
      componentId: "build-comment-1",
      argumentNames: [kind.noun, "search"],
    },
    {
      templateId: kind.templates.createRecord,
      componentId: kind.prepareRecordStep,
      argumentNames: ["severities", "payload"],
    },
    {
      templateId: kind.templates.createRecord,
      componentId: "confirm-unlinked-1",
      argumentNames: ["issue"],
    },
    {
      templateId: kind.templates.statusToState,
      componentId: "read-event-1",
      argumentNames: [],
    },
    {
      templateId: kind.templates.statusToState,
      componentId: "decide-state-1",
      argumentNames: [kind.noun, "states", "event"],
    },
    {
      templateId: kind.templates.commentToNote,
      componentId: "read-comment-1",
      argumentNames: [],
    },
    {
      templateId: kind.templates.commentToNote,
      componentId: "find-link-1",
      argumentNames: ["comment", "issue"],
    },
    {
      templateId: kind.templates.changesToNote,
      componentId: "read-changes-1",
      argumentNames: [],
    },
  ];
};

const JIRA_SCRIPT_STEPS: Array<ScriptStep> = KINDS.flatMap(scriptStepsOf);

type TemplateIdsOfFunction = (kind: RecordKind) => Array<string>;

/* One kind's template ids, in the order the category lists them. */
const templateIdsOf: TemplateIdsOfFunction = (
  kind: RecordKind,
): Array<string> => {
  return Object.values(kind.templates).filter(
    (templateId: string | undefined): templateId is string => {
      return templateId !== undefined;
    },
  );
};

type ArgumentNamesOfFunction = (node: JSONObject) => Array<string>;

/* The keys of a script step's JSON arguments, or none for a bare reference. */
const argumentNamesOf: ArgumentNamesOfFunction = (
  node: JSONObject,
): Array<string> => {
  const text: string = (node["args"] as JSONObject)["arguments"] as string;

  if (text.trim().startsWith("{{")) {
    return [];
  }

  return Object.keys(JSON.parse(text) as JSONObject);
};

type EveryArgumentFunction = (
  scriptStep: ScriptStep,
  value: string,
) => JSONObject;

/** The step's arguments with every one of them set to the same text. */
const everyArgument: EveryArgumentFunction = (
  scriptStep: ScriptStep,
  value: string,
): JSONObject => {
  const args: JSONObject = {};

  for (const name of scriptStep.argumentNames) {
    args[name] = value;
  }

  return args;
};

type NothingUsableFunction = (scriptStep: ScriptStep) => Array<JSONValue>;

/*
 * Every way a script can be handed nothing: no arguments at all, null (which
 * the sandbox turns into {}), and each argument as the text "null", as the
 * literal braces of a reference that never resolved, or as an empty object.
 */
const nothingUsable: NothingUsableFunction = (
  scriptStep: ScriptStep,
): Array<JSONValue> => {
  if (scriptStep.argumentNames.length === 0) {
    return [
      {},
      null,
      "null",
      "{{local.components.webhook-1.returnValues.request-body}}",
      [],
    ];
  }

  return [
    {},
    null,
    everyArgument(scriptStep, "null"),
    everyArgument(
      scriptStep,
      "{{local.components.missing-step-1.returnValues.value}}",
    ),
    everyArgument(scriptStep, "{}"),
  ];
};

type SignaturesOfFunction = (steps: Array<ScriptStep>) => Array<string>;

/*
 * One line per step: where it is and which arguments it takes. The order of
 * the arguments is the template's business (untrusted text goes last), so
 * only the set of names is compared.
 */
const signaturesOf: SignaturesOfFunction = (
  steps: Array<ScriptStep>,
): Array<string> => {
  return steps
    .map((scriptStep: ScriptStep): string => {
      const names: Array<string> = [...scriptStep.argumentNames].sort();

      return `${scriptStep.templateId}/${scriptStep.componentId}(${names.join(",")})`;
    })
    .sort();
};

describe("every Jira script", () => {
  test("is covered here, with the arguments its template really passes", () => {
    const jiraTemplates: Array<WorkflowTemplate> =
      getWorkflowTemplatesByCategory(WorkflowTemplateCategory.Jira);
    const shipped: Array<ScriptStep> = [];

    for (const template of jiraTemplates) {
      const nodes: Array<JSONObject> = (
        getTemplateGraphSpec(template.id) as unknown as {
          nodes: Array<JSONObject>;
        }
      ).nodes;

      for (const node of nodes) {
        if (node["metadataId"] !== ComponentID.JavaScriptCode) {
          continue;
        }

        shipped.push({
          templateId: template.id,
          componentId: node["componentId"] as string,
          argumentNames: argumentNamesOf(node),
        });
      }
    }

    // Nine incident templates, then eight alert ones: alerts have no public notes.
    expect(jiraTemplates).toHaveLength(17);
    expect(
      jiraTemplates.map((template: WorkflowTemplate): string => {
        return template.id;
      }),
    ).toEqual(KINDS.flatMap(templateIdsOf));
    expect(signaturesOf(shipped)).toEqual(signaturesOf(JIRA_SCRIPT_STEPS));
  });

  test("no alert template copies public notes, because alerts have none", () => {
    expect(ALERT.steps.noteComments).toHaveLength(1);
    expect(
      getTemplateGraphSpec("jira-comment-from-alert-public-note"),
    ).toBeNull();
  });

  for (const scriptStep of JIRA_SCRIPT_STEPS) {
    test(`${scriptStep.componentId} in ${scriptStep.templateId} skips quietly when handed nothing usable`, async () => {
      for (const args of nothingUsable(scriptStep)) {
        const result: JSONObject = await runJiraScript({
          templateId: scriptStep.templateId,
          componentId: scriptStep.componentId,
          args: args,
        });

        expect({ args: args, proceed: result["proceed"] }).toEqual({
          args: args,
          proceed: false,
        });
        expect(textOf(result, "reason").length).toBeGreaterThan(0);
      }
    });
  }
});

interface AdversarialCase {
  templateId: string;
  componentId: string;
  /** Arguments that reach the proceed branch with hostile text in every free-text field. */
  args: JSONValue;
}

type AdversarialCasesFunction = (kind: RecordKind) => Array<AdversarialCase>;

const adversarialProceeding: AdversarialCasesFunction = (
  kind: RecordKind,
): Array<AdversarialCase> => {
  return [
    {
      templateId: kind.templates.createIssue,
      componentId: "prepare-issue-1",
      args: issueArgs(
        kind,
        kind.model({
          title: ADVERSARIAL_TEXT,
          description: ADVERSARIAL_TEXT,
          severity: ADVERSARIAL_TEXT,
          state: { ...kind.createdState, name: ADVERSARIAL_TEXT },
        }),
      ),
    },
    {
      templateId: kind.templates.transition,
      componentId: "plan-transition-1",
      // Jira project admins name statuses and transitions.
      args: transitionArgs(
        kind,
        kind.acknowledgedState,
        jiraSearchResponse({
          transitions: [
            jiraTransition({
              id: "21",
              name: ADVERSARIAL_TEXT,
              to: jiraStatus({
                name: ADVERSARIAL_TEXT,
                categoryKey: "indeterminate",
                id: "3",
              }),
            }),
          ],
        }),
      ),
    },
    ...kind.steps.noteComments.map(
      (noteTemplate: NoteTemplateCase): AdversarialCase => {
        return {
          templateId: noteTemplate.templateId,
          componentId: "build-comment-1",
          args: noteArgs(
            kind.note({ note: ADVERSARIAL_TEXT, authorName: ADVERSARIAL_TEXT }),
          ),
        };
      },
    ),
    {
      templateId: kind.templates.update,
      componentId: "build-comment-1",
      args: updateArgs(
        kind,
        kind.model({
          title: ADVERSARIAL_TEXT,
          description: ADVERSARIAL_TEXT,
          rootCause: ADVERSARIAL_TEXT,
          remediationNotes: ADVERSARIAL_TEXT,
        }),
      ),
    },
    {
      templateId: kind.templates.createRecord,
      componentId: kind.prepareRecordStep,
      args: recordArgs(
        kind,
        jiraIssueCreatedEvent({
          summary: ADVERSARIAL_TEXT,
          description: ADVERSARIAL_TEXT,
          priority: ADVERSARIAL_TEXT,
          reporter: jiraUser(ADVERSARIAL_TEXT),
        }),
      ),
    },
    {
      templateId: kind.templates.createRecord,
      componentId: "confirm-unlinked-1",
      // Labels are free text anyone who can edit the issue writes.
      args: confirmArgs(jiraIssueLabelsResponse([ADVERSARIAL_TEXT, "backend"])),
    },
    {
      templateId: kind.templates.statusToState,
      componentId: "read-event-1",
      args: linkedUpdate(kind, STARTED_CHANGELOG, {
        status: jiraStatus({
          name: ADVERSARIAL_TEXT,
          categoryKey: "indeterminate",
        }),
        user: jiraUser(ADVERSARIAL_TEXT),
      }),
    },
    {
      templateId: kind.templates.statusToState,
      componentId: "decide-state-1",
      args: decideArgs(
        kind,
        statusEvent(kind, {
          jiraStatus: ADVERSARIAL_TEXT,
          changedBy: ADVERSARIAL_TEXT,
        }),
      ),
    },
    {
      templateId: kind.templates.commentToNote,
      componentId: "read-comment-1",
      args: jiraCommentEvent({
        body: ADVERSARIAL_TEXT,
        author: jiraUser(ADVERSARIAL_TEXT),
      }),
    },
    {
      templateId: kind.templates.commentToNote,
      componentId: "find-link-1",
      args: findLinkArgs(
        jiraIssueLabelsResponse([ADVERSARIAL_TEXT, ...kind.linkLabels]),
        { ...COMMENT_STEP_OUTPUT, note: ADVERSARIAL_TEXT },
      ),
    },
    {
      templateId: kind.templates.changesToNote,
      componentId: "read-changes-1",
      args: linkedUpdate(
        kind,
        [
          changelogItem({
            field: "summary",
            fromString: ADVERSARIAL_TEXT,
            toString: ADVERSARIAL_TEXT,
          }),
          changelogItem({
            field: ADVERSARIAL_TEXT,
            fieldId: "customfield_10050",
            fromString: ADVERSARIAL_TEXT,
            toString: ADVERSARIAL_TEXT,
          }),
        ],
        { user: jiraUser(ADVERSARIAL_TEXT) },
      ),
    },
  ];
};

type StringsWithBracesFunction = (result: JSONObject) => Array<string>;

const stringsWithBraces: StringsWithBracesFunction = (
  result: JSONObject,
): Array<string> => {
  return collectStrings(result).filter((text: string) => {
    return text.includes("{{");
  });
};

/*
 * A later step quotes these return values into its own arguments, where a
 * {{...}} left in them could be read as a reference — a Jira user could name
 * the secret Basic auth variable and have it filled in. So no string any
 * script returns may carry double braces, whatever it was fed.
 */
for (const kind of KINDS) {
  describe(`no ${kind.noun} Jira script hands on double braces`, () => {
    for (const adversarial of adversarialProceeding(kind)) {
      test(`${adversarial.componentId} in ${adversarial.templateId}, when it proceeds`, async () => {
        const result: JSONObject = await runJiraScript({
          templateId: adversarial.templateId,
          componentId: adversarial.componentId,
          args: adversarial.args,
        });

        expect(result["proceed"]).toBe(true);
        expect(stringsWithBraces(result)).toEqual([]);
      });
    }

    test("in the reasons the webhook scripts give for skipping", async () => {
      /*
       * A reason is a return value like any other: the Log step quotes it. And
       * webhookEvent is whatever the caller of the webhook URL says it is.
       */
      const cases: Array<AdversarialCase> = [
        {
          templateId: kind.templates.createRecord,
          componentId: kind.prepareRecordStep,
          args: recordArgs(kind, {
            ...jiraIssueCreatedEvent(),
            webhookEvent: ADVERSARIAL_TEXT,
          }),
        },
        {
          templateId: kind.templates.createRecord,
          componentId: "confirm-unlinked-1",
          args: confirmArgs({
            ...jiraIssueLabelsResponse(kind.linkLabels),
            key: ADVERSARIAL_TEXT,
          }),
        },
        {
          templateId: kind.templates.createRecord,
          componentId: "confirm-unlinked-1",
          args: confirmArgs(
            jiraIssueLabelsResponse([ADVERSARIAL_TEXT, ...kind.linkLabels]),
          ),
        },
        {
          templateId: kind.templates.statusToState,
          componentId: "read-event-1",
          args: {
            ...linkedUpdate(kind, STARTED_CHANGELOG),
            webhookEvent: ADVERSARIAL_TEXT,
          },
        },
        {
          templateId: kind.templates.commentToNote,
          componentId: "read-comment-1",
          args: jiraCommentEvent({ webhookEvent: ADVERSARIAL_TEXT }),
        },
        {
          templateId: kind.templates.changesToNote,
          componentId: "read-changes-1",
          args: {
            ...linkedUpdate(kind, [PRIORITY_RAISED]),
            webhookEvent: ADVERSARIAL_TEXT,
          },
        },
      ];
      const offenders: Array<string> = [];

      for (const adversarial of cases) {
        const result: JSONObject = await runJiraScript({
          templateId: adversarial.templateId,
          componentId: adversarial.componentId,
          args: adversarial.args,
        });

        expect(result["proceed"]).toBe(false);

        if (stringsWithBraces(result).length > 0) {
          offenders.push(
            `${adversarial.componentId}: ${textOf(result, "reason")}`,
          );
        }
      }

      expect(offenders).toEqual([]);
    });

    test("in the reasons plan-transition-1 gives for skipping", async () => {
      const hostileStatus: JSONObject = jiraStatus({
        name: ADVERSARIAL_TEXT,
        categoryKey: "new",
        id: "10001",
      });
      const reasons: Array<string> = [];

      // "is already <status>" and "has no transition from <status>" both quote a name Jira admins chose.
      for (const search of [
        jiraSearchResponse({
          status: {
            ...hostileStatus,
            statusCategory: IN_PROGRESS["statusCategory"] as JSONObject,
          },
        }),
        jiraSearchResponse({ status: hostileStatus, transitions: [] }),
        // "is already <status>, so it was not moved back".
        jiraSearchResponse({
          status: {
            ...hostileStatus,
            statusCategory: DONE["statusCategory"] as JSONObject,
          },
        }),
        // "could move to <status> or <status>".
        jiraSearchResponse({
          transitions: [
            toStatus("21", inProgressStatus(ADVERSARIAL_TEXT, "3")),
            toStatus("22", inProgressStatus(`${ADVERSARIAL_TEXT}!`, "4")),
          ],
        }),
      ]) {
        const result: JSONObject = await kind.steps.planTransition(
          transitionArgs(kind, kind.acknowledgedState, search),
        );

        expect(result["proceed"]).toBe(false);
        reasons.push(textOf(result, "reason"));
      }

      expect(reasons[2]).toContain("so it was not moved back to");
      expect(reasons[3]).toContain(
        "Name the one to use in STATE_TO_JIRA_STATUS",
      );

      expect(
        reasons.filter((reason: string) => {
          return reason.includes("{{");
        }),
      ).toEqual([]);
    });

    test("in the reasons the outbound scripts give for skipping", async () => {
      /*
       * The record number's prefix is a project setting, and a private
       * record's reason quotes it. skip() defuses every reason regardless.
       */
      const hostileRecord: JSONObject = {
        ...kind.model({ state: kind.acknowledgedState }),
        [kind.numberField]: ADVERSARIAL_TEXT,
        isPrivate: true,
      };
      const hostileNote: JSONObject = {
        ...kind.note(),
        [kind.noun]: { [kind.numberField]: ADVERSARIAL_TEXT, isPrivate: true },
      };
      const results: Array<JSONObject> = [
        await kind.steps.prepareIssue(issueArgs(kind, hostileRecord)),
        await kind.steps.planTransition({
          [kind.noun]: quoted(hostileRecord),
          search: quoted(jiraSearchResponse()),
        }),
        await kind.steps.updateComment(updateArgs(kind, hostileRecord)),
        // Not private: the number reaches "moved to <state>, which has no Jira status".
        await kind.steps.planTransition({
          [kind.noun]: quoted({
            ...kind.model({
              state: { ...MONITORING_STATE, name: ADVERSARIAL_TEXT },
            }),
            [kind.numberField]: ADVERSARIAL_TEXT,
          }),
          search: quoted(jiraSearchResponse()),
        }),
      ];

      for (const noteTemplate of kind.steps.noteComments) {
        results.push(await noteTemplate.run(noteArgs(hostileNote)));
      }

      for (const result of results) {
        expect(result["proceed"]).toBe(false);
        expect(textOf(result, "reason")).toContain("{ {local.variables");
        expect(stringsWithBraces(result)).toEqual([]);
      }
    });

    test("from a hostile status change carried all the way through the status template", async () => {
      // read-event-1's output is what decide-state-1 quotes; its skip reason must be clean too.
      const event: JSONObject = await kind.steps.readEvent(
        linkedUpdate(kind, STARTED_CHANGELOG, {
          status: jiraStatus({ name: ADVERSARIAL_TEXT, categoryKey: "new" }),
          user: jiraUser(ADVERSARIAL_TEXT),
        }),
      );
      const decision: JSONObject = await kind.steps.decideState(
        decideArgs(kind, event),
      );

      expect(stringsWithBraces(event)).toEqual([]);
      expect(decision["proceed"]).toBe(false);
      expect(stringsWithBraces(decision)).toEqual([]);
    });
  });
}

/*
 * A project's default number prefix is "#", which says nothing about what it
 * numbers: an incident and an alert can both be #12 in one Jira project. So a
 * bare number is written with its record's name in front, and a number that
 * already carries a prefix of its own is written as it is.
 */
type RecordNameFunction = (kind: RecordKind) => string;

const recordName: RecordNameFunction = (kind: RecordKind): string => {
  return kind.noun === "incident" ? "Incident" : "Alert";
};

type BareNumberedFunction = (
  kind: RecordKind,
  props?: IncidentModelProps,
) => JSONObject;

const bareNumbered: BareNumberedFunction = (
  kind: RecordKind,
  props?: IncidentModelProps,
): JSONObject => {
  return { ...kind.model(props), [kind.numberField]: "#12" };
};

for (const kind of KINDS) {
  const name: string = `${recordName(kind)} #12`;

  describe(`a bare number is written as "${name}"`, () => {
    test("in the new issue's summary and description", async () => {
      const result: JSONObject = await kind.steps.prepareIssue(
        issueArgs(kind, bareNumbered(kind)),
      );

      expect(textOf(result, "summary")).toBe(
        `[OneUptime] ${name}: ${kind.title}`,
      );
      expect(textOf(result, "description").split("\n")[0]).toBe(
        `${name} was ${kind.created} in OneUptime.`,
      );
    });

    test("in the transition's reason", async () => {
      const result: JSONObject = await kind.steps.planTransition({
        [kind.noun]: quoted(
          bareNumbered(kind, { state: kind.acknowledgedState }),
        ),
        search: asArgument(jiraSearchResponse()),
      });

      expect(textOf(result, "reason")).toBe(
        `${name} is Acknowledged in OneUptime.`,
      );
    });

    test("in the edit comment's heading", async () => {
      const result: JSONObject = await kind.steps.updateComment(
        updateArgs(kind, bareNumbered(kind)),
      );

      expect(textOf(result, "comment").split("\n")[0]).toBe(
        `${JIRA_SYNCED_FROM_ONEUPTIME_MARKER}: ${name} was updated.`,
      );
    });

    test("in every note comment's heading", async () => {
      for (const noteTemplate of kind.steps.noteComments) {
        const note: JSONObject = kind.note();
        const record: JSONObject = note[kind.noun] as JSONObject;

        note[kind.noun] = { ...record, [kind.numberField]: "#12" };

        const result: JSONObject = await noteTemplate.run(noteArgs(note));

        expect(textOf(result, "comment").split("\n")[0]).toBe(
          `${JIRA_SYNCED_FROM_ONEUPTIME_MARKER}: ${noteTemplate.noteKind} on ${name} by Jane Doe.`,
        );
      }
    });

    test(`but a prefix of its own, such as ${kind.number}, is left as it is`, async () => {
      const result: JSONObject = await kind.steps.prepareIssue(
        issueArgs(kind, kind.model()),
      );

      expect(textOf(result, "summary")).toBe(
        `[OneUptime] ${kind.number}: ${kind.title}`,
      );
    });
  });

  /*
   * A monitor fills in the root cause and remediation notes when it raises the
   * record, and they are often what explains it. An alert's root cause cannot
   * be edited later, so the new issue is the one place Jira would see it.
   */
  describe(`prepare-issue-1 carries the ${kind.noun}'s root cause and remediation into the issue`, () => {
    test("adds each as its own paragraph when it is set", async () => {
      const result: JSONObject = await kind.steps.prepareIssue(
        issueArgs(
          kind,
          kind.model({
            rootCause: "**Created because** p99 latency > 2s for 5 minutes.",
            remediationNotes: "Roll back the last deploy.",
          }),
        ),
      );

      expect(textOf(result, "description")).toBe(
        [
          `${kind.number} was ${kind.created} in OneUptime.`,
          `Severity: ${kind.severityName}`,
          "State: Identified",
          "",
          kind.description,
          "",
          "Root cause:",
          "**Created because** p99 latency > 2s for 5 minutes.",
          "",
          "Remediation:",
          "Roll back the last deploy.",
        ].join("\n"),
      );
    });

    test("leaves them out when they are empty or missing", async () => {
      for (const props of [
        {},
        { rootCause: null, remediationNotes: null },
        { rootCause: "  ", remediationNotes: "" },
      ] as Array<IncidentModelProps>) {
        const result: JSONObject = await kind.steps.prepareIssue(
          issueArgs(kind, kind.model(props)),
        );

        expect(textOf(result, "description")).not.toContain("Root cause:");
        expect(textOf(result, "description")).not.toContain("Remediation:");
      }
    });

    test("caps a long root cause, and defuses its double braces", async () => {
      const result: JSONObject = await kind.steps.prepareIssue(
        issueArgs(
          kind,
          kind.model({
            rootCause:
              "{{local.variables.jiraBasicAuthToken}} " + "r".repeat(9000),
          }),
        ),
      );
      const rootCause: string = textOf(result, "description").split(
        "Root cause:\n",
      )[1] as string;

      // Capped at 5000, then defused, which puts a space inside each brace pair.
      expect(rootCause.endsWith("…")).toBe(true);
      expect(rootCause.length).toBeLessThanOrEqual(5000 + 2);
      expect(rootCause).not.toContain("{{");
    });
  });
}
