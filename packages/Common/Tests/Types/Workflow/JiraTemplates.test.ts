/*
 * Contract tests for the Jira templates' graphs: nine that sync incidents
 * with Jira, and eight that do the same for alerts.
 *
 * Templates.test.ts already holds every template, these included, to the
 * component registry and to the builder's own linter. What it cannot know is
 * what the Jira templates promise about Jira and promise each other, and that
 * is what these pin:
 *
 *   - How they talk to Jira: one Basic auth secret, sent only as a request
 *     header, and every call under the site's /rest/api/3/.
 *   - How a record and an issue find each other. Jira holds the link, as the
 *     labels `oneuptime` and `oneuptime-incident-<id>` (an alert's,
 *     `oneuptime-alert-<id>`), and the text each side writes carries a marker
 *     the other side refuses to copy back. A label is only trusted when
 *     exactly one issue carries it, and an issue linked to one kind of record
 *     is never made into the other.
 *   - That a private incident or alert stays in OneUptime unless someone
 *     edits a script to send it, and that a record is only made from an issue
 *     Jira itself says is not linked yet.
 *   - What reaches substitution. The runtime fills an argument's references
 *     one at a time, each into the first place its {{...}} still appears, so
 *     text a Jira user wrote has to be substituted after everything else in
 *     the argument — otherwise a comment that names a later reference takes
 *     that reference's value.
 *   - That nothing is written to either side until a script has read the
 *     event and said to go ahead.
 *   - That the two sets are one design. The alert templates are the incident
 *     templates with the record's name swapped, step for step, except where
 *     an alert really is different: it has no public notes, never reaches a
 *     status page, and its root cause cannot be edited.
 *
 * The scripts are only read here. Running them is another suite's job.
 */

import {
  JIRA_ALERT_LABEL_PREFIX,
  JIRA_INCIDENT_LABEL_PREFIX,
  JIRA_LINK_LABEL,
  JIRA_SYNCED_FROM_ONEUPTIME_MARKER,
  ONEUPTIME_SYNCED_FROM_JIRA_MARKER,
  WorkflowTemplate,
  WorkflowTemplateCategories,
  WorkflowTemplateCategory,
  WorkflowTemplateVariable,
  buildGraphForTemplate,
  getTemplateGraphSpec,
  getWorkflowTemplate,
  getWorkflowTemplates,
  getWorkflowTemplatesByCategory,
} from "../../../Types/Workflow/Templates";
import ComponentMetadata, {
  Argument,
  ComponentInputType,
  ComponentType,
} from "../../../Types/Workflow/Component";
import ComponentID from "../../../Types/Workflow/ComponentID";
import {
  ConditionOperator,
  ConditionValueType,
} from "../../../Types/Workflow/Components/Condition";
import {
  ParsedReferencePath,
  ReferenceRootType,
  TemplateExpression,
  TemplateExpressionKind,
  componentReturnValueReference,
  getTemplateExpressionRegex,
  parseReferencePath,
  parseTemplateExpressions,
  variableReference,
} from "../../../Types/Workflow/TemplateSyntax";
import { JSONObject, JSONValue } from "../../../Types/JSON";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import {
  DEFAULT_LIMIT,
  LIMIT_PER_PROJECT,
} from "../../../Types/Database/LimitMax";
import { loadComponentsAndCategories } from "../../../UI/Components/Workflow/Utils";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Alert from "../../../Models/DatabaseModels/Alert";
import AlertInternalNote from "../../../Models/DatabaseModels/AlertInternalNote";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import AlertState from "../../../Models/DatabaseModels/AlertState";
import AlertStateTimeline from "../../../Models/DatabaseModels/AlertStateTimeline";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentInternalNote from "../../../Models/DatabaseModels/IncidentInternalNote";
import IncidentPublicNote from "../../../Models/DatabaseModels/IncidentPublicNote";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import IncidentStateTimeline from "../../../Models/DatabaseModels/IncidentStateTimeline";
import { describe, expect, test } from "@jest/globals";

/* ------------------------------ The kinds ------------------------------ */

/** One kind's templates, by what each does. */
interface KindTemplateIds {
  createIssue: string;
  transitionIssue: string;
  privateNoteToComment: string;
  /** Alerts have no public notes, so the alert set has nothing to copy. */
  publicNoteToComment: string | null;
  updateComment: string;
  createFromIssue: string;
  statusToState: string;
  commentToNote: string;
  issueChangesToNote: string;
}

type TemplateRole = keyof KindTemplateIds;

/** The steps whose ids name the record. */
interface KindStepIds {
  onCreate: string;
  onUpdate: string;
  prepareRecord: string;
  /** The create-from-issue template's first If / Else. */
  decideCreate: string;
  createRecord: string;
  findRecord: string;
  findRecordFailed: string;
}

/*
 * What the contracts need to know about one kind of record the templates
 * sync. Template and step ids are spelled out rather than built from the
 * noun, so renaming one fails here instead of quietly renaming the
 * expectation along with it.
 */
interface RecordKind {
  /** The record's name in ids, arguments and text. */
  noun: string;
  /** As the scripts' constants spell it: INCIDENT_LABEL_PREFIX. */
  upper: string;
  /** As the private switch spells it: SYNC_PRIVATE_INCIDENTS. */
  pluralUpper: string;
  labelPrefix: string;
  numberField: string;
  severityRelation: string;
  severityIdColumn: string;
  stateRelation: string;
  stateIdColumn: string;
  /** The column a note or a state-timeline row names its record by. */
  idColumn: string;
  /** The column a state-timeline row names its new state by. */
  timelineStateColumn: string;
  /** Where the record's page lives, under /dashboard/<project id>/. */
  dashboardPath: string;
  /** An incident is declared; an alert is created. */
  created: string;
  model: { new (): BaseModel };
  /** What a record made from a Jira issue is given beyond the essentials. */
  quietCreateFields: JSONObject;
  /** The edits the edit-comment template posts. */
  editListenOn: JSONObject;
  templates: KindTemplateIds;
  steps: KindStepIds;
}

const INCIDENT: RecordKind = {
  noun: "incident",
  upper: "INCIDENT",
  pluralUpper: "INCIDENTS",
  labelPrefix: JIRA_INCIDENT_LABEL_PREFIX,
  numberField: "incidentNumberWithPrefix",
  severityRelation: "incidentSeverity",
  severityIdColumn: "incidentSeverityId",
  stateRelation: "currentIncidentState",
  stateIdColumn: "currentIncidentStateId",
  idColumn: "incidentId",
  timelineStateColumn: "incidentStateId",
  dashboardPath: "incidents",
  created: "declared",
  model: Incident,
  // An issue's text was not written for customers, so it stays off status pages.
  quietCreateFields: {
    isVisibleOnStatusPage: false,
    shouldStatusPageSubscribersBeNotifiedOnIncidentCreated: false,
  },
  /*
   * Severity is listed under its id and its relation: the dashboard's edit
   * form sends the relation, and Listen On compares keys exactly.
   */
  editListenOn: {
    title: true,
    description: true,
    incidentSeverityId: true,
    incidentSeverity: true,
    rootCause: true,
    remediationNotes: true,
  },
  templates: {
    createIssue: "jira-create-issue-for-incident",
    transitionIssue: "jira-transition-issue-on-incident-state",
    privateNoteToComment: "jira-comment-from-incident-private-note",
    publicNoteToComment: "jira-comment-from-incident-public-note",
    updateComment: "jira-comment-on-incident-update",
    createFromIssue: "jira-declare-incident-from-issue",
    statusToState: "jira-status-to-incident-state",
    commentToNote: "jira-comment-to-incident-private-note",
    issueChangesToNote: "jira-issue-changes-to-incident-private-note",
  },
  steps: {
    onCreate: "incident-on-create-1",
    onUpdate: "incident-on-update-1",
    prepareRecord: "prepare-incident-1",
    decideCreate: "if-declare-1",
    createRecord: "create-incident-1",
    findRecord: "find-incident-1",
    findRecordFailed: "log-find-incident-failed",
  },
};

const ALERT: RecordKind = {
  noun: "alert",
  upper: "ALERT",
  pluralUpper: "ALERTS",
  labelPrefix: JIRA_ALERT_LABEL_PREFIX,
  numberField: "alertNumberWithPrefix",
  severityRelation: "alertSeverity",
  severityIdColumn: "alertSeverityId",
  stateRelation: "currentAlertState",
  stateIdColumn: "currentAlertStateId",
  idColumn: "alertId",
  timelineStateColumn: "alertStateId",
  dashboardPath: "alerts",
  created: "created",
  model: Alert,
  // An alert never reaches a status page, so there is nothing to keep it off.
  quietCreateFields: {},
  /*
   * An alert's root cause is written when the alert is created and nobody
   * can edit it afterwards, so there is no edit of it to listen for.
   */
  editListenOn: {
    title: true,
    description: true,
    alertSeverityId: true,
    alertSeverity: true,
    remediationNotes: true,
  },
  templates: {
    createIssue: "jira-create-issue-for-alert",
    transitionIssue: "jira-transition-issue-on-alert-state",
    privateNoteToComment: "jira-comment-from-alert-private-note",
    publicNoteToComment: null,
    updateComment: "jira-comment-on-alert-update",
    createFromIssue: "jira-create-alert-from-issue",
    statusToState: "jira-status-to-alert-state",
    commentToNote: "jira-comment-to-alert-private-note",
    issueChangesToNote: "jira-issue-changes-to-alert-private-note",
  },
  steps: {
    onCreate: "alert-on-create-1",
    onUpdate: "alert-on-update-1",
    prepareRecord: "prepare-alert-1",
    decideCreate: "if-create-1",
    createRecord: "create-alert-1",
    findRecord: "find-alert-1",
    findRecordFailed: "log-find-alert-failed",
  },
};

/** In picker order. */
const KINDS: Array<RecordKind> = [INCIDENT, ALERT];

/** The templates both kinds have: every one but the public-note template. */
const SHARED_ROLES: Array<TemplateRole> = [
  "createIssue",
  "transitionIssue",
  "privateNoteToComment",
  "updateComment",
  "createFromIssue",
  "statusToState",
  "commentToNote",
  "issueChangesToNote",
];

type KindIdsFunction = (kind: RecordKind) => Array<string>;

/** The OneUptime -> Jira note templates. Only incidents have public notes. */
const noteToCommentIds: KindIdsFunction = (kind: RecordKind): Array<string> => {
  const ids: KindTemplateIds = kind.templates;

  return ids.publicNoteToComment
    ? [ids.privateNoteToComment, ids.publicNoteToComment]
    : [ids.privateNoteToComment];
};

/** Every template that posts a comment to Jira. */
const commentTemplateIds: KindIdsFunction = (
  kind: RecordKind,
): Array<string> => {
  return [...noteToCommentIds(kind), kind.templates.updateComment];
};

/** OneUptime -> Jira, in picker order. */
const outboundIds: KindIdsFunction = (kind: RecordKind): Array<string> => {
  return [
    kind.templates.createIssue,
    kind.templates.transitionIssue,
    ...commentTemplateIds(kind),
  ];
};

/** Jira -> OneUptime, in picker order. Each starts from a webhook. */
const inboundIds: KindIdsFunction = (kind: RecordKind): Array<string> => {
  return [
    kind.templates.createFromIssue,
    kind.templates.statusToState,
    kind.templates.commentToNote,
    kind.templates.issueChangesToNote,
  ];
};

const templateIdsOf: KindIdsFunction = (kind: RecordKind): Array<string> => {
  return [...outboundIds(kind), ...inboundIds(kind)];
};

type KindOfFunction = (templateId: string) => RecordKind;

const kindOf: KindOfFunction = (templateId: string): RecordKind => {
  const kind: RecordKind | undefined = KINDS.find((candidate: RecordKind) => {
    return templateIdsOf(candidate).includes(templateId);
  });

  if (!kind) {
    throw new Error(`${templateId} is in neither kind's set.`);
  }

  return kind;
};

type OtherKindFunction = (kind: RecordKind) => RecordKind;

const otherKind: OtherKindFunction = (kind: RecordKind): RecordKind => {
  return kind === INCIDENT ? ALERT : INCIDENT;
};

type TemplateForFunction = (kind: RecordKind, role: TemplateRole) => string;

const templateFor: TemplateForFunction = (
  kind: RecordKind,
  role: TemplateRole,
): string => {
  const templateId: string | null = kind.templates[role];

  if (!templateId) {
    throw new Error(`The ${kind.noun} set has no ${role} template.`);
  }

  return templateId;
};

type KindEntriesFunction<T> = (kind: RecordKind) => Record<string, T>;

type PerKindFunction = <T>(
  entriesFor: KindEntriesFunction<T>,
) => Record<string, T>;

/** One table for both kinds, from what each kind's templates expect. */
const perKind: PerKindFunction = <T>(
  entriesFor: KindEntriesFunction<T>,
): Record<string, T> => {
  const table: Record<string, T> = {};

  for (const kind of KINDS) {
    Object.assign(table, entriesFor(kind));
  }

  return table;
};

/* --------------------------- The seventeen --------------------------- */

/*
 * The picker's order: the incident set, then the alert set, each with its
 * OneUptime -> Jira templates first. Spelled out, so the list a user sees is
 * pinned by more than the kind table it is checked against.
 */
const JIRA_TEMPLATE_IDS: Array<string> = [
  "jira-create-issue-for-incident",
  "jira-transition-issue-on-incident-state",
  "jira-comment-from-incident-private-note",
  "jira-comment-from-incident-public-note",
  "jira-comment-on-incident-update",
  "jira-declare-incident-from-issue",
  "jira-status-to-incident-state",
  "jira-comment-to-incident-private-note",
  "jira-issue-changes-to-incident-private-note",
  "jira-create-issue-for-alert",
  "jira-transition-issue-on-alert-state",
  "jira-comment-from-alert-private-note",
  "jira-comment-on-alert-update",
  "jira-create-alert-from-issue",
  "jira-status-to-alert-state",
  "jira-comment-to-alert-private-note",
  "jira-issue-changes-to-alert-private-note",
];

const ONEUPTIME_TO_JIRA_TEMPLATE_IDS: Array<string> =
  KINDS.flatMap(outboundIds);

const JIRA_TO_ONEUPTIME_TEMPLATE_IDS: Array<string> = KINDS.flatMap(inboundIds);

const BASE_URL: string = variableReference("jiraBaseUrl");

const AUTHORIZATION: string = `Basic ${variableReference("jiraBasicAuthToken")}`;

const API_METADATA_IDS: Array<string> = [
  ComponentID.ApiGet,
  ComponentID.ApiPost,
  ComponentID.ApiPut,
  ComponentID.ApiPatch,
  ComponentID.ApiDelete,
];

/** Where the shared helper block ends and a script's own code begins. */
const SCRIPT_BODY_MARKER: string = "\n// ---- What this step does ----\n";

const SCRIPT_HELPER_HEADER: string =
  "// ---- Shared by the Jira templates ----\n";

/** The one helper line that names both kinds, so it reads the same in every script. */
const LINKED_LABEL_PREFIXES_DECLARATION: string = `const LINKED_LABEL_PREFIXES = ${JSON.stringify(
  [JIRA_INCIDENT_LABEL_PREFIX, JIRA_ALERT_LABEL_PREFIX],
)};`;

const STARTS_WITH_A_WORD: RegExp = /^[A-Za-z]/;

/** Any Jira REST path other than v3: /rest/api/2/, /rest/api/latest/. */
const NOT_REST_V3: RegExp = /\/rest\/api\/(?!3\/)/;

/** The search endpoint Jira Cloud removed, as opposed to /search/jql. */
const REMOVED_SEARCH: RegExp = /\/rest\/api\/3\/search(?!\/jql)/;

const DATABASE_WRITE_METADATA_ID: RegExp =
  /-(create|update|delete)-(one|many)$/;

const PUBLIC_NOTE_WRITE_METADATA_ID: RegExp = /-public-note-create-/;

const NAMES_INCIDENTS: RegExp = /incident/i;

/* ---------------------------- Noun swapping ---------------------------- */

/*
 * The incident templates' words as the alert templates say them. An incident
 * is declared where an alert is created, so the verb swaps with the noun.
 */
const NOUN_SWAPS: Array<[RegExp, string]> = [
  [/incident/g, "alert"],
  [/Incident/g, "Alert"],
  [/INCIDENT/g, "ALERT"],
  [/declar/g, "creat"],
  [/Declar/g, "Creat"],
];

type SwapTextFunction = (text: string) => string;

const swapWords: SwapTextFunction = (text: string): string => {
  return NOUN_SWAPS.reduce(
    (result: string, [pattern, replacement]: [RegExp, string]): string => {
      return result.replace(pattern, replacement);
    },
    text,
  );
};

/*
 * Incident text as the alert version of it reads. The line listing both
 * kinds' label prefixes is the same in both, so it is put back after the
 * swap, which would otherwise make it name alerts twice.
 */
const asAlert: SwapTextFunction = (text: string): string => {
  return swapWords(text)
    .split(swapWords(LINKED_LABEL_PREFIXES_DECLARATION))
    .join(LINKED_LABEL_PREFIXES_DECLARATION);
};

type AsAlertValueFunction = (
  value: JSONValue | undefined,
) => JSONValue | undefined;

/** An incident argument as the alert version of it reads: keys and text alike. */
const asAlertValue: AsAlertValueFunction = (
  value: JSONValue | undefined,
): JSONValue | undefined => {
  if (typeof value === "string") {
    return asAlert(value);
  }

  if (Array.isArray(value)) {
    return value.map((entry: JSONValue): JSONValue => {
      return asAlertValue(entry) as JSONValue;
    });
  }

  if (value && typeof value === "object") {
    const swapped: JSONObject = {};

    for (const [key, entry] of Object.entries(value as JSONObject)) {
      swapped[asAlert(key)] = asAlertValue(entry) as JSONValue;
    }

    return swapped;
  }

  return value;
};

/* ------------------------------- Graphs ------------------------------- */

interface TemplateNodeSpec {
  componentId: string;
  metadataId: string;
  componentType: ComponentType;
  position: { x: number; y: number };
  args?: JSONObject | undefined;
}

interface TemplateEdgeSpec {
  fromComponentId: string;
  toComponentId: string;
  fromPort: string;
}

interface TemplateSpec {
  nodes: Array<TemplateNodeSpec>;
  edges: Array<TemplateEdgeSpec>;
}

type LookupFunction = <T>(record: Record<string, T>, key: string) => T;

/** A table lookup that fails loudly, so a missing row is never a silent pass. */
const lookup: LookupFunction = <T>(
  record: Record<string, T>,
  key: string,
): T => {
  if (!(key in record)) {
    throw new Error(`No entry for ${key}.`);
  }

  return record[key] as T;
};

type TemplateOfFunction = (templateId: string) => WorkflowTemplate;

const templateOf: TemplateOfFunction = (
  templateId: string,
): WorkflowTemplate => {
  const template: WorkflowTemplate | null = getWorkflowTemplate(templateId);

  if (!template) {
    throw new Error(`There is no template ${templateId}.`);
  }

  return template;
};

type SpecOfFunction = (templateId: string) => TemplateSpec;

const specOf: SpecOfFunction = (templateId: string): TemplateSpec => {
  const spec: unknown = getTemplateGraphSpec(templateId);

  if (!spec) {
    throw new Error(`Template ${templateId} has no graph.`);
  }

  return spec as TemplateSpec;
};

type NodeOfFunction = (
  templateId: string,
  componentId: string,
) => TemplateNodeSpec;

const nodeOf: NodeOfFunction = (
  templateId: string,
  componentId: string,
): TemplateNodeSpec => {
  const node: TemplateNodeSpec | undefined = specOf(templateId).nodes.find(
    (candidate: TemplateNodeSpec) => {
      return candidate.componentId === componentId;
    },
  );

  if (!node) {
    throw new Error(`Template ${templateId} has no step ${componentId}.`);
  }

  return node;
};

type TriggerOfFunction = (templateId: string) => TemplateNodeSpec;

const triggerOf: TriggerOfFunction = (templateId: string): TemplateNodeSpec => {
  const trigger: TemplateNodeSpec | undefined = specOf(templateId).nodes.find(
    (node: TemplateNodeSpec) => {
      return node.componentType === ComponentType.Trigger;
    },
  );

  if (!trigger) {
    throw new Error(`Template ${templateId} has no trigger.`);
  }

  return trigger;
};

type TargetsOfFunction = (
  templateId: string,
  componentId: string,
  port: string,
) => Array<string>;

/** The steps a port leads to. */
const targetsOf: TargetsOfFunction = (
  templateId: string,
  componentId: string,
  port: string,
): Array<string> => {
  return specOf(templateId)
    .edges.filter((edge: TemplateEdgeSpec) => {
      return edge.fromComponentId === componentId && edge.fromPort === port;
    })
    .map((edge: TemplateEdgeSpec) => {
      return edge.toComponentId;
    });
};

type StepsOfFunction = (
  spec: TemplateSpec,
  rename: SwapTextFunction,
) => Array<string>;

/** Each step as "<id> <metadata id> <type> at <x>,<y>", in graph order. */
const stepsOf: StepsOfFunction = (
  spec: TemplateSpec,
  rename: SwapTextFunction,
): Array<string> => {
  return spec.nodes.map((node: TemplateNodeSpec) => {
    return `${rename(node.componentId)} ${rename(node.metadataId)} ${node.componentType} at ${node.position.x},${node.position.y}`;
  });
};

/** Each edge as "from:port->to", in graph order. */
const wiringOf: StepsOfFunction = (
  spec: TemplateSpec,
  rename: SwapTextFunction,
): Array<string> => {
  return spec.edges.map((edge: TemplateEdgeSpec) => {
    return `${rename(edge.fromComponentId)}:${edge.fromPort}->${rename(edge.toComponentId)}`;
  });
};

type KeepTextFunction = SwapTextFunction;

const asItIs: KeepTextFunction = (text: string): string => {
  return text;
};

interface JiraNode {
  templateId: string;
  node: TemplateNodeSpec;
}

type NodePredicate = (node: TemplateNodeSpec) => boolean;

type JiraNodesFunction = (
  predicate?: NodePredicate | undefined,
) => Array<JiraNode>;

/** Every step in the seventeen templates, optionally only those a predicate keeps. */
const jiraNodes: JiraNodesFunction = (
  predicate?: NodePredicate | undefined,
): Array<JiraNode> => {
  return JIRA_TEMPLATE_IDS.flatMap((templateId: string) => {
    return specOf(templateId)
      .nodes.filter((node: TemplateNodeSpec) => {
        return predicate ? predicate(node) : true;
      })
      .map((node: TemplateNodeSpec) => {
        return { templateId: templateId, node: node };
      });
  });
};

const isApiNode: NodePredicate = (node: TemplateNodeSpec): boolean => {
  return API_METADATA_IDS.includes(node.metadataId);
};

const isScriptNode: NodePredicate = (node: TemplateNodeSpec): boolean => {
  return node.metadataId === ComponentID.JavaScriptCode;
};

const isIfElseNode: NodePredicate = (node: TemplateNodeSpec): boolean => {
  return node.metadataId === ComponentID.IfElse;
};

const isLogNode: NodePredicate = (node: TemplateNodeSpec): boolean => {
  return node.metadataId === ComponentID.Log;
};

/** A step backed by a OneUptime database model: its triggers, lookups and writes. */
const isDatabaseNode: NodePredicate = (node: TemplateNodeSpec): boolean => {
  return (
    node.metadataId !== ComponentID.Webhook &&
    !isApiNode(node) &&
    !isScriptNode(node) &&
    !isIfElseNode(node) &&
    !isLogNode(node)
  );
};

const isDatabaseWrite: NodePredicate = (node: TemplateNodeSpec): boolean => {
  return DATABASE_WRITE_METADATA_ID.test(node.metadataId);
};

/** A call that changes something in Jira. Searching and reading do not. */
const isJiraWrite: NodePredicate = (node: TemplateNodeSpec): boolean => {
  if (!isApiNode(node) || node.metadataId === ComponentID.ApiGet) {
    return false;
  }

  return !(
    node.metadataId === ComponentID.ApiPost &&
    textArg(node, "url").endsWith("/search/jql")
  );
};

/* ----------------------------- Arguments ----------------------------- */

type TextArgFunction = (node: TemplateNodeSpec, argumentId: string) => string;

const textArg: TextArgFunction = (
  node: TemplateNodeSpec,
  argumentId: string,
): string => {
  const value: JSONValue | undefined = node.args?.[argumentId];

  if (typeof value !== "string") {
    throw new Error(`${node.componentId}.${argumentId} is not text.`);
  }

  return value;
};

type JsonArgFunction = (
  node: TemplateNodeSpec,
  argumentId: string,
) => JSONObject;

/*
 * JSON arguments are stored as text. Every reference in them sits inside a
 * string literal, so the text parses as it is, references and all.
 */
const jsonArg: JsonArgFunction = (
  node: TemplateNodeSpec,
  argumentId: string,
): JSONObject => {
  return JSON.parse(textArg(node, argumentId)) as JSONObject;
};

type ArgumentTextFunction = (value: JSONValue | undefined) => string;

/*
 * The text the runtime substitutes into. An object-valued argument is
 * stringified first (VMAPI.replaceValueInPlace), so its references are filled
 * in the order they appear in that JSON.
 */
const argumentText: ArgumentTextFunction = (
  value: JSONValue | undefined,
): string => {
  if (typeof value === "string") {
    return value;
  }

  return JSON.stringify(value === undefined ? null : value);
};

interface StringEntry {
  path: string;
  text: string;
}

type CollectStringEntriesFunction = (
  value: JSONValue | undefined,
  path: string,
) => Array<StringEntry>;

/** Every string an argument holds, with where it sits, including inside objects. */
const collectStringEntries: CollectStringEntriesFunction = (
  value: JSONValue | undefined,
  path: string,
): Array<StringEntry> => {
  if (typeof value === "string") {
    return [{ path: path, text: value }];
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry: JSONValue, index: number) => {
      return collectStringEntries(entry, `${path}[${index}]`);
    });
  }

  if (value && typeof value === "object") {
    return Object.entries(value as JSONObject).flatMap(
      ([key, entry]: [string, JSONValue]) => {
        return collectStringEntries(entry, `${path}.${key}`);
      },
    );
  }

  return [];
};

interface Reference {
  raw: string;
  inner: string;
  parsed: ParsedReferencePath;
}

type ReferencesInFunction = (text: string) => Array<Reference>;

/** The {{...}} value references in a piece of text, in the order the runtime fills them. */
const referencesIn: ReferencesInFunction = (text: string): Array<Reference> => {
  return parseTemplateExpressions(text)
    .filter((expression: TemplateExpression) => {
      return expression.kind === TemplateExpressionKind.Reference;
    })
    .map((expression: TemplateExpression) => {
      return {
        raw: expression.raw,
        inner: expression.inner,
        parsed: parseReferencePath(expression.inner),
      };
    });
};

type WholeReferenceFunction = (value: JSONValue | undefined) => string | null;

/** The reference an argument consists of entirely, or null when it is anything more. */
const wholeReference: WholeReferenceFunction = (
  value: JSONValue | undefined,
): string | null => {
  if (typeof value !== "string") {
    return null;
  }

  const expressions: Array<TemplateExpression> =
    parseTemplateExpressions(value);

  if (expressions.length !== 1 || expressions[0]?.raw !== value) {
    return null;
  }

  return value;
};

type ScriptOutputFunction = (scriptId: string, field: string) => string;

/** {{local.components.<script>.returnValues.returnValue.<field>}} */
const scriptOutput: ScriptOutputFunction = (
  scriptId: string,
  field: string,
): string => {
  return componentReturnValueReference(scriptId, "returnValue", [field]);
};

type ProceedConditionFunction = (scriptId: string) => JSONObject;

/** The If / Else every Jira template uses to act on a script's decision. */
const proceedCondition: ProceedConditionFunction = (
  scriptId: string,
): JSONObject => {
  return {
    "input-1-type": ConditionValueType.Boolean,
    "input-1": scriptOutput(scriptId, "proceed"),
    operator: ConditionOperator.EqualTo,
    "input-2-type": ConditionValueType.Boolean,
    "input-2": true,
  };
};

/*
 * The same registry the builder loads: static components plus one set per
 * database model. Only argument metadata is read from it here — which
 * arguments are JSON, and which are kept out of the run log — and which
 * components exist at all.
 */
const registry: Array<ComponentMetadata> =
  loadComponentsAndCategories().components;

type ArgumentOfFunction = (
  metadataId: string,
  argumentId: string,
) => Argument | undefined;

const argumentOf: ArgumentOfFunction = (
  metadataId: string,
  argumentId: string,
): Argument | undefined => {
  const metadata: ComponentMetadata | undefined = registry.find(
    (component: ComponentMetadata) => {
      return component.id === metadataId;
    },
  );

  return metadata?.arguments.find((argument: Argument) => {
    return argument.id === argumentId;
  });
};

/* ---------------------------- Scripts ---------------------------- */

type ScriptCodeFunction = (templateId: string, scriptId: string) => string;

const scriptCode: ScriptCodeFunction = (
  templateId: string,
  scriptId: string,
): string => {
  const node: TemplateNodeSpec = nodeOf(templateId, scriptId);

  if (!isScriptNode(node)) {
    throw new Error(`${templateId} ${scriptId} is not a script.`);
  }

  return textArg(node, "code");
};

type ScriptBodyFunction = (code: string) => string;

/** A script's own code, after the shared helper block. */
const scriptBody: ScriptBodyFunction = (code: string): string => {
  const start: number = code.indexOf(SCRIPT_BODY_MARKER);

  if (start === -1) {
    throw new Error("The script has no helper block.");
  }

  return code.slice(start + SCRIPT_BODY_MARKER.length);
};

type HelperBlockFunction = (code: string) => string;

const helperBlock: HelperBlockFunction = (code: string): string => {
  return code.slice(0, code.indexOf(SCRIPT_BODY_MARKER));
};

type KindHelpersFunction = (kind: RecordKind) => string;

/** A kind's helper block, as its create-issue script carries it. */
const kindHelpers: KindHelpersFunction = (kind: RecordKind): string => {
  return helperBlock(scriptCode(kind.templates.createIssue, "prepare-issue-1"));
};

type HelperDefinitionFunction = (helpers: string, name: string) => string;

/** One top-level declaration in the helper block, up to the next one or the next comment. */
const helperDefinition: HelperDefinitionFunction = (
  helpers: string,
  name: string,
): string => {
  const start: number = helpers.indexOf(`\nconst ${name} = `);

  if (start === -1) {
    throw new Error(`The helper block declares no ${name}.`);
  }

  const rest: string = helpers.slice(start + 1);
  const end: number = rest.slice(1).search(/\n(const |\/\/)/);

  return end === -1 ? rest : rest.slice(0, end + 1);
};

type HelperRegexFunction = (name: string) => RegExp;

/** A regular expression the helper block declares, rebuilt so it can be tried here. */
const helperRegex: HelperRegexFunction = (name: string): RegExp => {
  const code: string = scriptCode(
    INCIDENT.templates.createIssue,
    "prepare-issue-1",
  );
  const match: RegExpMatchArray | null = code.match(
    new RegExp(`\\nconst ${name} = /(.+)/;\\n`),
  );

  if (!match || !match[1]) {
    throw new Error(`The helper block declares no ${name}.`);
  }

  return new RegExp(match[1]);
};

/*
 * Fields a Jira-reading script only ever returns after checking them: an
 * issue key that matched ISSUE_KEY, an incident or alert id that matched UUID
 * or was read off a OneUptime record, and the ids of OneUptime rows the
 * script chose. Anything else such a script returns may carry text from Jira.
 */
const CHECKED_SCRIPT_FIELDS: Array<string> = [
  "proceed",
  "issueKey",
  "incidentId",
  "alertId",
  "stateId",
  "incidentSeverityId",
  "alertSeverityId",
];

type IsFromJiraFunction = (templateId: string, reference: Reference) => boolean;

/*
 * Whether a reference's value can hold text someone in Jira wrote: anything a
 * webhook received, anything Jira answered, and whatever a script that read
 * either returns, bar the fields it checked.
 */
const isFromJira: IsFromJiraFunction = (
  templateId: string,
  reference: Reference,
): boolean => {
  if (reference.parsed.rootType !== ReferenceRootType.ComponentReturnValue) {
    return false;
  }

  const source: TemplateNodeSpec = nodeOf(
    templateId,
    reference.parsed.componentId as string,
  );

  if (source.metadataId === ComponentID.Webhook) {
    return true;
  }

  if (isApiNode(source)) {
    return reference.parsed.returnValueId !== "response-status";
  }

  if (!isScriptNode(source) || !scriptReadsJira(templateId, source)) {
    return false;
  }

  // local . components . <id> . returnValues . returnValue . <field>
  const field: string | undefined = reference.inner.split(".")[5];

  return !(
    reference.parsed.returnValueId === "returnValue" &&
    field !== undefined &&
    CHECKED_SCRIPT_FIELDS.includes(field)
  );
};

type ScriptReadsJiraFunction = (
  templateId: string,
  script: TemplateNodeSpec,
) => boolean;

const scriptReadsJira: ScriptReadsJiraFunction = (
  templateId: string,
  script: TemplateNodeSpec,
): boolean => {
  return referencesIn(argumentText(script.args?.["arguments"])).some(
    (reference: Reference) => {
      return isFromJira(templateId, reference);
    },
  );
};

type FromJiraAtFunction = (templateId: string, raw: string) => boolean;

/** isFromJira for one {{...}} reference written out in full. */
const fromJiraAt: FromJiraAtFunction = (
  templateId: string,
  raw: string,
): boolean => {
  return isFromJira(templateId, referencesIn(raw)[0] as Reference);
};

type RegistryHasFunction = (idPrefix: string) => boolean;

/** Whether the builder offers any component whose id starts this way. */
const registryHas: RegistryHasFunction = (idPrefix: string): boolean => {
  return registry.some((component: ComponentMetadata) => {
    return component.id.startsWith(idPrefix);
  });
};

/* ------------------------------ Tables ------------------------------ */

interface ExpectedGraph {
  /** componentId -> metadataId */
  nodes: Record<string, string>;
  /** "from:port->to" */
  edges: Array<string>;
}

type CommentGraphFunction = (
  triggerId: string,
  triggerMetadataId: string,
) => ExpectedGraph;

/** The OneUptime -> Jira comment templates share one shape. */
const commentGraph: CommentGraphFunction = (
  triggerId: string,
  triggerMetadataId: string,
): ExpectedGraph => {
  return {
    nodes: {
      [triggerId]: triggerMetadataId,
      "find-issue-1": ComponentID.ApiPost,
      "log-find-failed": ComponentID.Log,
      "build-comment-1": ComponentID.JavaScriptCode,
      "log-build-failed": ComponentID.Log,
      "if-post-1": ComponentID.IfElse,
      "log-skipped": ComponentID.Log,
      "post-comment-1": ComponentID.ApiPost,
      "log-posted": ComponentID.Log,
      "log-post-failed": ComponentID.Log,
    },
    edges: [
      `${triggerId}:success->find-issue-1`,
      "find-issue-1:success->build-comment-1",
      "find-issue-1:error->log-find-failed",
      "build-comment-1:success->if-post-1",
      "build-comment-1:error->log-build-failed",
      "if-post-1:yes->post-comment-1",
      "if-post-1:no->log-skipped",
      "post-comment-1:success->log-posted",
      "post-comment-1:error->log-post-failed",
    ],
  };
};

const expectedGraphs: KindEntriesFunction<ExpectedGraph> = (
  kind: RecordKind,
): Record<string, ExpectedGraph> => {
  const r: string = kind.noun;
  const ids: KindTemplateIds = kind.templates;
  const steps: KindStepIds = kind.steps;

  const graphs: Record<string, ExpectedGraph> = {
    [ids.createIssue]: {
      nodes: {
        [steps.onCreate]: `${r}-on-create`,
        "prepare-issue-1": ComponentID.JavaScriptCode,
        "log-prepare-failed": ComponentID.Log,
        "if-create-1": ComponentID.IfElse,
        "log-skipped": ComponentID.Log,
        "create-issue-1": ComponentID.ApiPost,
        "log-created": ComponentID.Log,
        "log-create-failed": ComponentID.Log,
      },
      edges: [
        `${steps.onCreate}:success->prepare-issue-1`,
        "prepare-issue-1:success->if-create-1",
        "prepare-issue-1:error->log-prepare-failed",
        "if-create-1:yes->create-issue-1",
        "if-create-1:no->log-skipped",
        "create-issue-1:success->log-created",
        "create-issue-1:error->log-create-failed",
      ],
    },
    [ids.transitionIssue]: {
      nodes: {
        [steps.onUpdate]: `${r}-on-update`,
        "find-issue-1": ComponentID.ApiPost,
        "log-find-failed": ComponentID.Log,
        "plan-transition-1": ComponentID.JavaScriptCode,
        "log-plan-failed": ComponentID.Log,
        "if-transition-1": ComponentID.IfElse,
        "log-skipped": ComponentID.Log,
        "transition-issue-1": ComponentID.ApiPost,
        "log-transitioned": ComponentID.Log,
        "log-transition-failed": ComponentID.Log,
      },
      edges: [
        `${steps.onUpdate}:success->find-issue-1`,
        "find-issue-1:success->plan-transition-1",
        "find-issue-1:error->log-find-failed",
        "plan-transition-1:success->if-transition-1",
        "plan-transition-1:error->log-plan-failed",
        "if-transition-1:yes->transition-issue-1",
        "if-transition-1:no->log-skipped",
        "transition-issue-1:success->log-transitioned",
        "transition-issue-1:error->log-transition-failed",
      ],
    },
    [ids.privateNoteToComment]: commentGraph(
      "note-on-create-1",
      `${r}-internal-note-on-create`,
    ),
    [ids.updateComment]: commentGraph(steps.onUpdate, `${r}-on-update`),
    [ids.createFromIssue]: {
      nodes: {
        "webhook-1": ComponentID.Webhook,
        "find-severities-1": `${r}-severity-find-many`,
        "log-severities-failed": ComponentID.Log,
        [steps.prepareRecord]: ComponentID.JavaScriptCode,
        "log-prepare-failed": ComponentID.Log,
        [steps.decideCreate]: ComponentID.IfElse,
        "log-skipped": ComponentID.Log,
        "get-issue-1": ComponentID.ApiGet,
        "log-get-issue-failed": ComponentID.Log,
        "confirm-unlinked-1": ComponentID.JavaScriptCode,
        "log-confirm-failed": ComponentID.Log,
        "if-unlinked-1": ComponentID.IfElse,
        "log-already-linked": ComponentID.Log,
        [steps.createRecord]: `${r}-create-one`,
        "log-create-failed": ComponentID.Log,
        "link-issue-1": ComponentID.ApiPut,
        "log-linked": ComponentID.Log,
        "log-link-failed": ComponentID.Log,
      },
      edges: [
        "webhook-1:out->find-severities-1",
        `find-severities-1:success->${steps.prepareRecord}`,
        "find-severities-1:error->log-severities-failed",
        `${steps.prepareRecord}:success->${steps.decideCreate}`,
        `${steps.prepareRecord}:error->log-prepare-failed`,
        `${steps.decideCreate}:yes->get-issue-1`,
        `${steps.decideCreate}:no->log-skipped`,
        "get-issue-1:success->confirm-unlinked-1",
        "get-issue-1:error->log-get-issue-failed",
        "confirm-unlinked-1:success->if-unlinked-1",
        "confirm-unlinked-1:error->log-confirm-failed",
        `if-unlinked-1:yes->${steps.createRecord}`,
        "if-unlinked-1:no->log-already-linked",
        `${steps.createRecord}:success->link-issue-1`,
        `${steps.createRecord}:error->log-create-failed`,
        "link-issue-1:success->log-linked",
        "link-issue-1:error->log-link-failed",
      ],
    },
    [ids.statusToState]: {
      nodes: {
        "webhook-1": ComponentID.Webhook,
        "read-event-1": ComponentID.JavaScriptCode,
        "log-read-failed": ComponentID.Log,
        "if-status-changed-1": ComponentID.IfElse,
        "log-ignored": ComponentID.Log,
        [steps.findRecord]: `${r}-find-one`,
        [steps.findRecordFailed]: ComponentID.Log,
        "find-states-1": `${r}-state-find-many`,
        "log-find-states-failed": ComponentID.Log,
        "decide-state-1": ComponentID.JavaScriptCode,
        "log-decide-failed": ComponentID.Log,
        "if-change-1": ComponentID.IfElse,
        "log-unchanged": ComponentID.Log,
        "change-state-1": `${r}-state-timeline-create-one`,
        "log-changed": ComponentID.Log,
        "log-change-failed": ComponentID.Log,
      },
      edges: [
        "webhook-1:out->read-event-1",
        "read-event-1:success->if-status-changed-1",
        "read-event-1:error->log-read-failed",
        `if-status-changed-1:yes->${steps.findRecord}`,
        "if-status-changed-1:no->log-ignored",
        `${steps.findRecord}:success->find-states-1`,
        `${steps.findRecord}:error->${steps.findRecordFailed}`,
        "find-states-1:success->decide-state-1",
        "find-states-1:error->log-find-states-failed",
        "decide-state-1:success->if-change-1",
        "decide-state-1:error->log-decide-failed",
        "if-change-1:yes->change-state-1",
        "if-change-1:no->log-unchanged",
        "change-state-1:success->log-changed",
        "change-state-1:error->log-change-failed",
      ],
    },
    [ids.commentToNote]: {
      nodes: {
        "webhook-1": ComponentID.Webhook,
        "read-comment-1": ComponentID.JavaScriptCode,
        "log-read-failed": ComponentID.Log,
        "if-comment-1": ComponentID.IfElse,
        "log-ignored": ComponentID.Log,
        "get-issue-1": ComponentID.ApiGet,
        "log-get-issue-failed": ComponentID.Log,
        "find-link-1": ComponentID.JavaScriptCode,
        "log-find-link-failed": ComponentID.Log,
        "if-linked-1": ComponentID.IfElse,
        "log-not-linked": ComponentID.Log,
        [steps.findRecord]: `${r}-find-one`,
        [steps.findRecordFailed]: ComponentID.Log,
        "if-found-1": ComponentID.IfElse,
        "log-not-found": ComponentID.Log,
        "create-note-1": `${r}-internal-note-create-one`,
        "log-noted": ComponentID.Log,
        "log-note-failed": ComponentID.Log,
      },
      edges: [
        "webhook-1:out->read-comment-1",
        "read-comment-1:success->if-comment-1",
        "read-comment-1:error->log-read-failed",
        "if-comment-1:yes->get-issue-1",
        "if-comment-1:no->log-ignored",
        "get-issue-1:success->find-link-1",
        "get-issue-1:error->log-get-issue-failed",
        "find-link-1:success->if-linked-1",
        "find-link-1:error->log-find-link-failed",
        `if-linked-1:yes->${steps.findRecord}`,
        "if-linked-1:no->log-not-linked",
        `${steps.findRecord}:success->if-found-1`,
        `${steps.findRecord}:error->${steps.findRecordFailed}`,
        "if-found-1:yes->create-note-1",
        "if-found-1:no->log-not-found",
        "create-note-1:success->log-noted",
        "create-note-1:error->log-note-failed",
      ],
    },
    [ids.issueChangesToNote]: {
      nodes: {
        "webhook-1": ComponentID.Webhook,
        "read-changes-1": ComponentID.JavaScriptCode,
        "log-read-failed": ComponentID.Log,
        "if-changed-1": ComponentID.IfElse,
        "log-ignored": ComponentID.Log,
        [steps.findRecord]: `${r}-find-one`,
        [steps.findRecordFailed]: ComponentID.Log,
        "if-found-1": ComponentID.IfElse,
        "log-not-found": ComponentID.Log,
        "create-note-1": `${r}-internal-note-create-one`,
        "log-noted": ComponentID.Log,
        "log-note-failed": ComponentID.Log,
      },
      edges: [
        "webhook-1:out->read-changes-1",
        "read-changes-1:success->if-changed-1",
        "read-changes-1:error->log-read-failed",
        `if-changed-1:yes->${steps.findRecord}`,
        "if-changed-1:no->log-ignored",
        `${steps.findRecord}:success->if-found-1`,
        `${steps.findRecord}:error->${steps.findRecordFailed}`,
        "if-found-1:yes->create-note-1",
        "if-found-1:no->log-not-found",
        "create-note-1:success->log-noted",
        "create-note-1:error->log-note-failed",
      ],
    },
  };

  if (ids.publicNoteToComment) {
    graphs[ids.publicNoteToComment] = commentGraph(
      "note-on-create-1",
      `${r}-public-note-on-create`,
    );
  }

  return graphs;
};

const EXPECTED_GRAPHS: Record<string, ExpectedGraph> = perKind(expectedGraphs);

interface JiraCall {
  componentId: string;
  metadataId: string;
  url: string;
}

const REST: string = `${BASE_URL}/rest/api/3`;

const SEARCH_CALL: JiraCall = {
  componentId: "find-issue-1",
  metadataId: ComponentID.ApiPost,
  url: `${REST}/search/jql`,
};

const COMMENT_CALL: JiraCall = {
  componentId: "post-comment-1",
  metadataId: ComponentID.ApiPost,
  url: `${REST}/issue/${scriptOutput("build-comment-1", "issueKey")}/comment`,
};

/** Every call each template makes to Jira, in graph order. */
const expectedJiraCalls: KindEntriesFunction<Array<JiraCall>> = (
  kind: RecordKind,
): Record<string, Array<JiraCall>> => {
  const ids: KindTemplateIds = kind.templates;
  const prepare: string = kind.steps.prepareRecord;

  const calls: Record<string, Array<JiraCall>> = {
    [ids.createIssue]: [
      {
        componentId: "create-issue-1",
        metadataId: ComponentID.ApiPost,
        url: `${REST}/issue`,
      },
    ],
    [ids.transitionIssue]: [
      SEARCH_CALL,
      {
        componentId: "transition-issue-1",
        metadataId: ComponentID.ApiPost,
        url: `${REST}/issue/${scriptOutput("plan-transition-1", "issueKey")}/transitions`,
      },
    ],
    [ids.createFromIssue]: [
      {
        componentId: "get-issue-1",
        metadataId: ComponentID.ApiGet,
        url: `${REST}/issue/${scriptOutput(prepare, "issueKey")}?fields=labels`,
      },
      {
        componentId: "link-issue-1",
        metadataId: ComponentID.ApiPut,
        url: `${REST}/issue/${scriptOutput(prepare, "issueKey")}`,
      },
    ],
    [ids.statusToState]: [],
    [ids.commentToNote]: [
      {
        componentId: "get-issue-1",
        metadataId: ComponentID.ApiGet,
        url: `${REST}/issue/${scriptOutput("read-comment-1", "issueKey")}?fields=labels`,
      },
    ],
    [ids.issueChangesToNote]: [],
  };

  for (const templateId of commentTemplateIds(kind)) {
    calls[templateId] = [SEARCH_CALL, COMMENT_CALL];
  }

  return calls;
};

const EXPECTED_JIRA_CALLS: Record<string, Array<JiraCall>> = perKind(
  expectedJiraCalls,
);

const JIRA_CREDENTIALS: Array<string> = ["jiraBaseUrl", "jiraBasicAuthToken"];

const expectedVariables: KindEntriesFunction<Array<string>> = (
  kind: RecordKind,
): Record<string, Array<string>> => {
  const ids: KindTemplateIds = kind.templates;

  const variables: Record<string, Array<string>> = {
    [ids.createIssue]: [
      "jiraBaseUrl",
      "jiraBasicAuthToken",
      "jiraProjectKey",
      "jiraIssueType",
      "oneuptimeUrl",
    ],
    [ids.transitionIssue]: JIRA_CREDENTIALS,
    [ids.updateComment]: JIRA_CREDENTIALS,
    [ids.createFromIssue]: JIRA_CREDENTIALS,
    // Webhook in, OneUptime out: nothing to call, so nothing to configure.
    [ids.statusToState]: [],
    [ids.commentToNote]: JIRA_CREDENTIALS,
    [ids.issueChangesToNote]: [],
  };

  for (const templateId of noteToCommentIds(kind)) {
    variables[templateId] = JIRA_CREDENTIALS;
  }

  return variables;
};

const EXPECTED_VARIABLES: Record<string, Array<string>> = perKind(
  expectedVariables,
);

interface ExpectedTrigger {
  componentId: string;
  metadataId: string;
}

const WEBHOOK_TRIGGER: ExpectedTrigger = {
  componentId: "webhook-1",
  metadataId: ComponentID.Webhook,
};

const expectedTriggers: KindEntriesFunction<ExpectedTrigger> = (
  kind: RecordKind,
): Record<string, ExpectedTrigger> => {
  const r: string = kind.noun;
  const ids: KindTemplateIds = kind.templates;

  const triggers: Record<string, ExpectedTrigger> = {
    [ids.createIssue]: {
      componentId: kind.steps.onCreate,
      metadataId: `${r}-on-create`,
    },
    [ids.transitionIssue]: {
      componentId: kind.steps.onUpdate,
      metadataId: `${r}-on-update`,
    },
    [ids.privateNoteToComment]: {
      componentId: "note-on-create-1",
      metadataId: `${r}-internal-note-on-create`,
    },
    [ids.updateComment]: {
      componentId: kind.steps.onUpdate,
      metadataId: `${r}-on-update`,
    },
  };

  if (ids.publicNoteToComment) {
    triggers[ids.publicNoteToComment] = {
      componentId: "note-on-create-1",
      metadataId: `${r}-public-note-on-create`,
    };
  }

  for (const templateId of inboundIds(kind)) {
    triggers[templateId] = WEBHOOK_TRIGGER;
  }

  return triggers;
};

const EXPECTED_TRIGGERS: Record<string, ExpectedTrigger> =
  perKind(expectedTriggers);

/** What each template writes to OneUptime. */
const expectedDatabaseWrites: KindEntriesFunction<Array<string>> = (
  kind: RecordKind,
): Record<string, Array<string>> => {
  const r: string = kind.noun;
  const ids: KindTemplateIds = kind.templates;

  const writes: Record<string, Array<string>> = {
    [ids.createFromIssue]: [`${r}-create-one`],
    [ids.statusToState]: [`${r}-state-timeline-create-one`],
    [ids.commentToNote]: [`${r}-internal-note-create-one`],
    [ids.issueChangesToNote]: [`${r}-internal-note-create-one`],
  };

  for (const templateId of outboundIds(kind)) {
    writes[templateId] = [];
  }

  return writes;
};

const EXPECTED_DATABASE_WRITES: Record<string, Array<string>> = perKind(
  expectedDatabaseWrites,
);

interface WebhookSetup {
  /** The event the setup instructions tell the user to register. */
  registeredFor: string;
  /** The webhookEvent value the template's first script accepts. */
  webhookEvent: string;
  scriptId: string;
}

const webhookSetups: KindEntriesFunction<WebhookSetup> = (
  kind: RecordKind,
): Record<string, WebhookSetup> => {
  return {
    [kind.templates.createFromIssue]: {
      registeredFor: "Issue created",
      webhookEvent: "jira:issue_created",
      scriptId: kind.steps.prepareRecord,
    },
    [kind.templates.statusToState]: {
      registeredFor: "Issue updated",
      webhookEvent: "jira:issue_updated",
      scriptId: "read-event-1",
    },
    [kind.templates.commentToNote]: {
      registeredFor: "Comment created",
      webhookEvent: "comment_created",
      scriptId: "read-comment-1",
    },
    [kind.templates.issueChangesToNote]: {
      registeredFor: "Issue updated",
      webhookEvent: "jira:issue_updated",
      scriptId: "read-changes-1",
    },
  };
};

const WEBHOOK_SETUP: Record<string, WebhookSetup> = perKind(webhookSetups);

interface SearchExpectation {
  /** The label the search asks for is this prefix and the record's id. */
  labelPrefix: string;
  recordIdReference: string;
  fields: Array<string>;
  expandsTransitions: boolean;
  /** The one script handed the search's answer. */
  scriptId: string;
  /** How that script names the record to linkedIssue: the one the search asked about. */
  scriptRecordId: string;
}

/*
 * The search's JQL, oldest issue first. Two results, not one: linkedIssue has
 * to see a second labelled issue to refuse it.
 */
const SEARCH_ORDER: string = " ORDER BY created ASC";

const SEARCH_MAX_RESULTS: number = 2;

const expectedSearches: KindEntriesFunction<SearchExpectation> = (
  kind: RecordKind,
): Record<string, SearchExpectation> => {
  const r: string = kind.noun;
  const recordOnUpdate: string = componentReturnValueReference(
    kind.steps.onUpdate,
    "model",
    ["_id"],
  );

  const searches: Record<string, SearchExpectation> = {
    [kind.templates.transitionIssue]: {
      labelPrefix: kind.labelPrefix,
      recordIdReference: recordOnUpdate,
      fields: ["key", "status"],
      expandsTransitions: true,
      scriptId: "plan-transition-1",
      scriptRecordId: `asText(${r}._id)`,
    },
    [kind.templates.updateComment]: {
      labelPrefix: kind.labelPrefix,
      recordIdReference: recordOnUpdate,
      fields: ["key", "summary"],
      expandsTransitions: false,
      scriptId: "build-comment-1",
      scriptRecordId: `asText(${r}._id)`,
    },
  };

  for (const templateId of noteToCommentIds(kind)) {
    searches[templateId] = {
      labelPrefix: kind.labelPrefix,
      recordIdReference: componentReturnValueReference(
        "note-on-create-1",
        "model",
        [kind.idColumn, "value"],
      ),
      fields: ["key", "summary"],
      expandsTransitions: false,
      scriptId: "build-comment-1",
      scriptRecordId: `valueOf(note.${kind.idColumn})`,
    };
  }

  return searches;
};

const EXPECTED_SEARCHES: Record<string, SearchExpectation> =
  perKind(expectedSearches);

/*
 * The lines of the helper block that make linkedIssue safe to build a URL
 * from and safe to post to: only keys that match ISSUE_KEY survive, and an
 * issue comes back only when exactly one does.
 */
const LINKED_ISSUE_KEY_FILTER: string =
  ".filter((issue) => issue && ISSUE_KEY.test(asText(issue.key)));";

const LINKED_ISSUE_NONE: string = "if (!issues.length) return { reason: ";

const LINKED_ISSUE_SEVERAL: string = "if (issues.length > 1) {";

const LINKED_ISSUE_FOUND: string =
  "return { issue: issues[0], issueKey: asText(issues[0].key) };";

/** How a script that searched takes the one issue linkedIssue allowed, or stops. */
const LINKED_ISSUE_USE: Array<string> = [
  "const found = linkedIssue(search, ",
  "if (!found.issue) return skip(found.reason);",
  "const issueKey = found.issueKey;",
];

interface PrivateRecordCheck {
  templateId: string;
  scriptId: string;
  /** The switch that lets private records through: SYNC_PRIVATE_INCIDENTS. */
  flag: string;
  /** The key in the script's arguments the OneUptime record arrives under. */
  argumentKey: string;
  /** Where isPrivate sits in that record's select. */
  selectPath: Array<string>;
  /** The condition the script skips on. */
  condition: string;
  /** Code in the script that must only run once the private check has passed. */
  checkedBefore: Array<string>;
}

type PrivateRecordChecksFunction = (
  kind: RecordKind,
) => Array<PrivateRecordCheck>;

/*
 * Every OneUptime -> Jira script, and how it keeps a private record in
 * OneUptime. A private incident's or alert's notes and details were not
 * written for whoever can read the Jira project.
 */
const privateRecordChecks: PrivateRecordChecksFunction = (
  kind: RecordKind,
): Array<PrivateRecordCheck> => {
  const r: string = kind.noun;
  const flag: string = `SYNC_PRIVATE_${kind.pluralUpper}`;
  const onRecord: string = `${r}.isPrivate === true && !${flag}`;

  return [
    {
      templateId: kind.templates.createIssue,
      scriptId: "prepare-issue-1",
      flag: flag,
      argumentKey: r,
      selectPath: ["isPrivate"],
      condition: onRecord,
      checkedBefore: ["asText(customFields.jiraIssueKey)", "proceed: true"],
    },
    {
      templateId: kind.templates.transitionIssue,
      scriptId: "plan-transition-1",
      flag: flag,
      argumentKey: r,
      selectPath: ["isPrivate"],
      condition: onRecord,
      checkedBefore: ["linkedIssue(", "proceed: true"],
    },
    ...noteToCommentIds(kind).map((templateId: string): PrivateRecordCheck => {
      return {
        templateId: templateId,
        scriptId: "build-comment-1",
        flag: flag,
        argumentKey: "note",
        selectPath: [r, "isPrivate"],
        condition: `note.${r} && note.${r}.isPrivate === true && !${flag}`,
        // An empty note on a private record is reported as private, not as empty.
        checkedBefore: [
          "if (!text) return skip(",
          "linkedIssue(",
          "proceed: true",
        ],
      };
    }),
    {
      templateId: kind.templates.updateComment,
      scriptId: "build-comment-1",
      flag: flag,
      argumentKey: r,
      selectPath: ["isPrivate"],
      condition: onRecord,
      checkedBefore: ["linkedIssue(", "proceed: true"],
    },
  ];
};

const PRIVATE_RECORD_CHECKS: Array<PrivateRecordCheck> =
  KINDS.flatMap(privateRecordChecks);

type RouteToRecordFunction = (kind: RecordKind) => string;

/*
 * The only route from the create-from-issue template's webhook to the record
 * it creates: the event script says go, then Jira is asked for the issue's
 * labels as they are now, and a second script checks those.
 */
const routeToRecord: RouteToRecordFunction = (kind: RecordKind): string => {
  return [
    "webhook-1:out",
    "find-severities-1:success",
    `${kind.steps.prepareRecord}:success`,
    `${kind.steps.decideCreate}:yes`,
    "get-issue-1:success",
    "confirm-unlinked-1:success",
    "if-unlinked-1:yes",
    kind.steps.createRecord,
  ].join("->");
};

/** The Jira-side check every route to a write in a create-from-issue template passes through. */
const JIRA_SIDE_CHECK: string =
  "->get-issue-1:success->confirm-unlinked-1:success->if-unlinked-1:yes->";

/** Jira Service Management's mark for a comment the customer must not see. */
const INTERNAL_COMMENT_PROPERTIES: Array<JSONObject> = [
  { key: "sd.public.comment", value: { internal: true } },
];

interface RecordRead {
  templateId: string;
  scriptId: string;
  /** The key in the script's arguments the record arrives under. */
  argumentKey: string;
  /** Dotted paths the script reads off the record. */
  fields: Array<string>;
}

type RecordReadsFunction = (kind: RecordKind) => Array<RecordRead>;

/*
 * What each script reads off the OneUptime records it is handed. The generic
 * select check only sees {{...}} references; a script reads the whole record,
 * so a field it needs and the select forgot arrives as undefined and the
 * script quietly takes its fallback.
 */
const recordReads: RecordReadsFunction = (
  kind: RecordKind,
): Array<RecordRead> => {
  const r: string = kind.noun;
  const severityName: string = `${kind.severityRelation}.name`;
  const stateName: string = `${kind.stateRelation}.name`;

  return [
    {
      templateId: kind.templates.createIssue,
      scriptId: "prepare-issue-1",
      argumentKey: r,
      fields: [
        "_id",
        "projectId",
        "title",
        "description",
        kind.numberField,
        "isPrivate",
        "customFields",
        severityName,
        stateName,
      ],
    },
    {
      templateId: kind.templates.transitionIssue,
      scriptId: "plan-transition-1",
      argumentKey: r,
      fields: [
        "_id",
        kind.numberField,
        "isPrivate",
        stateName,
        `${kind.stateRelation}.isAcknowledgedState`,
        `${kind.stateRelation}.isResolvedState`,
      ],
    },
    ...noteToCommentIds(kind).map((templateId: string): RecordRead => {
      return {
        templateId: templateId,
        scriptId: "build-comment-1",
        argumentKey: "note",
        fields: [
          "note",
          kind.idColumn,
          `${r}.${kind.numberField}`,
          `${r}.isPrivate`,
          "createdByUser.name",
        ],
      };
    }),
    {
      templateId: kind.templates.updateComment,
      scriptId: "build-comment-1",
      argumentKey: r,
      fields: [
        "_id",
        kind.numberField,
        "isPrivate",
        "title",
        "description",
        "rootCause",
        "remediationNotes",
        severityName,
        stateName,
      ],
    },
    {
      templateId: kind.templates.createFromIssue,
      scriptId: kind.steps.prepareRecord,
      argumentKey: "severities",
      fields: ["_id", "name", "order"],
    },
    {
      templateId: kind.templates.statusToState,
      scriptId: "decide-state-1",
      argumentKey: r,
      fields: [
        "_id",
        kind.numberField,
        stateName,
        `${kind.stateRelation}.order`,
      ],
    },
    {
      templateId: kind.templates.statusToState,
      scriptId: "decide-state-1",
      argumentKey: "states",
      fields: [
        "_id",
        "name",
        "order",
        "isAcknowledgedState",
        "isResolvedState",
      ],
    },
  ];
};

const RECORD_READS: Array<RecordRead> = KINDS.flatMap(recordReads);

const MODEL_BY_METADATA_ID: Record<string, { new (): BaseModel }> = {
  "incident-on-create": Incident,
  "incident-on-update": Incident,
  "incident-find-one": Incident,
  "incident-create-one": Incident,
  "incident-internal-note-on-create": IncidentInternalNote,
  "incident-internal-note-create-one": IncidentInternalNote,
  "incident-public-note-on-create": IncidentPublicNote,
  "incident-severity-find-many": IncidentSeverity,
  "incident-state-find-many": IncidentState,
  "incident-state-timeline-create-one": IncidentStateTimeline,
  "alert-on-create": Alert,
  "alert-on-update": Alert,
  "alert-find-one": Alert,
  "alert-create-one": Alert,
  "alert-internal-note-on-create": AlertInternalNote,
  "alert-internal-note-create-one": AlertInternalNote,
  "alert-severity-find-many": AlertSeverity,
  "alert-state-find-many": AlertState,
  "alert-state-timeline-create-one": AlertStateTimeline,
};

/** The template fields shown to a user, compared across kinds as text. */
const TEMPLATE_TEXT_FIELDS: Array<keyof WorkflowTemplate> = [
  "name",
  "description",
  "teaches",
  "category",
  "icon",
  "workflowName",
  "workflowDescription",
];

type SelectHasFunction = (
  select: JSONValue | undefined,
  path: Array<string>,
) => boolean;

/** Whether a select names a field, explicitly — no allowance for what the runtime adds. */
const selectHas: SelectHasFunction = (
  select: JSONValue | undefined,
  path: Array<string>,
): boolean => {
  if (!select || typeof select !== "object" || Array.isArray(select)) {
    return false;
  }

  const branch: JSONValue | undefined = (select as JSONObject)[
    path[0] as string
  ];

  if (path.length === 1) {
    return branch === true;
  }

  return selectHas(branch, path.slice(1));
};

type MissingColumnsFunction = (
  model: BaseModel,
  shape: JSONObject,
  followRelations: boolean,
  path: string,
) => Array<string>;

/** Keys in a select, query or record that are not columns on the model. */
const missingColumns: MissingColumnsFunction = (
  model: BaseModel,
  shape: JSONObject,
  followRelations: boolean,
  path: string,
): Array<string> => {
  const missing: Array<string> = [];

  for (const [key, value] of Object.entries(shape)) {
    const columnPath: string = `${path}${key}`;

    if (!model.hasColumn(key)) {
      missing.push(columnPath);
      continue;
    }

    if (
      !followRelations ||
      !value ||
      typeof value !== "object" ||
      Array.isArray(value)
    ) {
      continue;
    }

    const related: { new (): BaseModel } | undefined =
      model.getTableColumnMetadata(key).modelType;

    if (!related) {
      missing.push(`${columnPath} (not a relation)`);
      continue;
    }

    missing.push(
      ...missingColumns(
        new related(),
        value as JSONObject,
        true,
        `${columnPath}.`,
      ),
    );
  }

  return missing;
};

type CanBeEditedFunction = (model: BaseModel, column: string) => boolean;

/** Whether anyone at all is allowed to change a column once the record exists. */
const canBeEdited: CanBeEditedFunction = (
  model: BaseModel,
  column: string,
): boolean => {
  const access: ColumnAccessControl | null =
    model.getColumnAccessControlFor(column);

  return Boolean(access && access.update.length > 0);
};

type UngatedNodesFunction = (templateId: string) => Array<string>;

/*
 * The steps a run can reach from the trigger without passing an If / Else's
 * Yes port — what runs whatever the event turns out to be.
 */
const ungatedNodes: UngatedNodesFunction = (
  templateId: string,
): Array<string> => {
  const spec: TemplateSpec = specOf(templateId);
  const start: string = triggerOf(templateId).componentId;
  const reached: Set<string> = new Set([start]);
  const queue: Array<string> = [start];

  while (queue.length > 0) {
    const current: string = queue.shift() as string;
    const currentIsIfElse: boolean = isIfElseNode(nodeOf(templateId, current));

    for (const edge of spec.edges) {
      if (edge.fromComponentId !== current) {
        continue;
      }

      if (currentIsIfElse && edge.fromPort === "yes") {
        continue;
      }

      if (!reached.has(edge.toComponentId)) {
        reached.add(edge.toComponentId);
        queue.push(edge.toComponentId);
      }
    }
  }

  return spec.nodes
    .map((node: TemplateNodeSpec) => {
      return node.componentId;
    })
    .filter((componentId: string) => {
      return reached.has(componentId);
    });
};

interface PartialRoute {
  at: string;
  route: string;
  visited: Set<string>;
}

type RoutesBetweenFunction = (
  templateId: string,
  from: string,
  to: string,
) => Array<string>;

/*
 * Every route a run can take from one step to another, written
 * "step:port->step:port->…->step". Reachability alone would say a write is
 * behind a check; listing the routes says there is no second way round it.
 */
const routesBetween: RoutesBetweenFunction = (
  templateId: string,
  from: string,
  to: string,
): Array<string> => {
  const spec: TemplateSpec = specOf(templateId);
  const routes: Array<string> = [];
  const pending: Array<PartialRoute> = [
    { at: from, route: from, visited: new Set([from]) },
  ];

  while (pending.length > 0) {
    const current: PartialRoute = pending.pop() as PartialRoute;

    if (current.at === to) {
      routes.push(current.route);
      continue;
    }

    for (const edge of spec.edges) {
      if (
        edge.fromComponentId !== current.at ||
        current.visited.has(edge.toComponentId)
      ) {
        continue;
      }

      pending.push({
        at: edge.toComponentId,
        route: `${current.route}:${edge.fromPort}->${edge.toComponentId}`,
        visited: new Set([...current.visited, edge.toComponentId]),
      });
    }
  }

  return routes.sort();
};

type IssueKeyCheckFunction = (code: string) => string;

/*
 * How a script makes sure the issueKey it returns is a bare key: it tests the
 * key itself, or takes it from linkedIssue, which drops every issue whose key
 * does not match ISSUE_KEY. An empty string means neither.
 */
const issueKeyCheck: IssueKeyCheckFunction = (code: string): string => {
  const body: string = scriptBody(code);

  if (!body.includes("issueKey: issueKey")) {
    return "";
  }

  if (body.includes("if (!ISSUE_KEY.test(issueKey)) return skip(")) {
    return "tests the key";
  }

  const usesLinkedIssue: boolean = LINKED_ISSUE_USE.every((line: string) => {
    return body.includes(line);
  });

  if (usesLinkedIssue && helperBlock(code).includes(LINKED_ISSUE_KEY_FILTER)) {
    return "takes it from linkedIssue";
  }

  return "";
};

type IndexOrFailFunction = (text: string, part: string) => number;

/** Where a piece of code first appears, failing loudly when it does not. */
const indexOrFail: IndexOrFailFunction = (
  text: string,
  part: string,
): number => {
  const index: number = text.indexOf(part);

  if (index === -1) {
    throw new Error(`The script has no ${part}`);
  }

  return index;
};

type AdfDocumentsInFunction = (
  value: JSONValue | undefined,
) => Array<JSONObject>;

/** Every Atlassian Document Format document inside a parsed request body. */
const adfDocumentsIn: AdfDocumentsInFunction = (
  value: JSONValue | undefined,
): Array<JSONObject> => {
  if (Array.isArray(value)) {
    return value.flatMap((entry: JSONValue) => {
      return adfDocumentsIn(entry);
    });
  }

  if (!value || typeof value !== "object") {
    return [];
  }

  if ((value as JSONObject)["type"] === "doc") {
    return [value as JSONObject];
  }

  return Object.values(value as JSONObject).flatMap((entry: JSONValue) => {
    return adfDocumentsIn(entry);
  });
};

type AdfProblemsFunction = (document: JSONObject) => Array<string>;

/*
 * What Jira would reject in a document, or what could come out empty. Each
 * paragraph holds one text node, and a text node must not be empty, so its
 * text is either fixed words or one reference the step before guarantees.
 */
const adfProblems: AdfProblemsFunction = (
  document: JSONObject,
): Array<string> => {
  const problems: Array<string> = [];

  if (
    document["type"] !== "doc" ||
    document["version"] !== 1 ||
    Object.keys(document).length !== 3
  ) {
    problems.push(
      "the document is not exactly { type: doc, version: 1, content }",
    );
  }

  const paragraphs: JSONValue | undefined = document["content"];

  if (!Array.isArray(paragraphs) || paragraphs.length === 0) {
    return [...problems, "the document has no paragraphs"];
  }

  paragraphs.forEach((paragraph: JSONValue, index: number) => {
    const at: string = `paragraph ${index}`;
    const block: JSONObject = (paragraph || {}) as JSONObject;
    const content: JSONValue | undefined = block["content"];

    if (block["type"] !== "paragraph") {
      problems.push(`${at} is not a paragraph`);
    }

    if (!Array.isArray(content) || content.length !== 1) {
      problems.push(`${at} does not hold exactly one node`);
      return;
    }

    const node: JSONObject = (content[0] || {}) as JSONObject;
    const text: JSONValue | undefined = node["text"];

    if (node["type"] !== "text") {
      problems.push(`${at} holds a ${String(node["type"])} node, not text`);
    }

    const extraKeys: Array<string> = Object.keys(node).filter((key: string) => {
      return !["type", "text", "marks"].includes(key);
    });

    if (extraKeys.length > 0) {
      problems.push(`${at} has unexpected keys ${extraKeys.join(", ")}`);
    }

    if (typeof text !== "string" || text.length === 0) {
      problems.push(`${at} has no text`);
    } else if (!wholeReference(text) && !STARTS_WITH_A_WORD.test(text)) {
      problems.push(`${at} neither is one reference nor starts with words`);
    }

    if (node["marks"] === undefined) {
      return;
    }

    const marks: JSONValue = node["marks"];

    if (!Array.isArray(marks) || marks.length === 0) {
      problems.push(`${at} has an empty marks list`);
      return;
    }

    for (const mark of marks) {
      const markObject: JSONObject = (mark || {}) as JSONObject;
      const attrs: JSONObject = (markObject["attrs"] || {}) as JSONObject;

      if (markObject["type"] !== "link") {
        problems.push(`${at} has a ${String(markObject["type"])} mark`);
      }

      const href: JSONValue | undefined = attrs["href"];

      if (typeof href !== "string" || href.length === 0) {
        problems.push(`${at} has a link with no href`);
      }
    }
  });

  return problems;
};

let idCounter: number = 0;

type GenerateIdFunction = () => string;

const generateId: GenerateIdFunction = (): string => {
  idCounter++;
  return `jira-generated-${idCounter}`;
};

/* ============================== Tests ============================== */

describe("Jira templates in the picker", () => {
  test("the Jira category holds exactly the seventeen: incidents, then alerts, OneUptime -> Jira first in each", () => {
    expect(
      getWorkflowTemplatesByCategory(WorkflowTemplateCategory.Jira).map(
        (template: WorkflowTemplate) => {
          return template.id;
        },
      ),
    ).toEqual(JIRA_TEMPLATE_IDS);

    // The kind table the rest of the file reads is the same seventeen, in order.
    expect(KINDS.flatMap(templateIdsOf)).toEqual(JIRA_TEMPLATE_IDS);
    expect(templateIdsOf(INCIDENT)).toHaveLength(9);
    expect(templateIdsOf(ALERT)).toHaveLength(8);
  });

  test("a template is in the Jira category exactly when its id says jira-", () => {
    for (const template of getWorkflowTemplates()) {
      expect({
        id: template.id,
        inJiraCategory: template.category === WorkflowTemplateCategory.Jira,
      }).toEqual({
        id: template.id,
        inJiraCategory: template.id.startsWith("jira-"),
      });
    }
  });

  test("Jira sits immediately before Integrations", () => {
    const jiraIndex: number = WorkflowTemplateCategories.indexOf(
      WorkflowTemplateCategory.Jira,
    );

    expect(jiraIndex).toBeGreaterThan(-1);
    expect(
      WorkflowTemplateCategories.indexOf(WorkflowTemplateCategory.Integrations),
    ).toBe(jiraIndex + 1);
  });

  /*
   * The picker's card test id is `workflow-template-card-<name>`, so two
   * templates with one name would give two cards one id — and seventeen Jira
   * templates, most of them in pairs, are plenty of chances of that.
   */
  test("no two templates share a name", () => {
    const seen: Set<string> = new Set();
    const duplicates: Array<string> = [];

    for (const template of getWorkflowTemplates()) {
      if (seen.has(template.name)) {
        duplicates.push(template.name);
      }

      seen.add(template.name);
    }

    expect(duplicates).toEqual([]);
  });

  /*
   * With an incident and an alert version of nearly every template side by
   * side, a card, a test id or a workflow in a list that did not say which
   * record it syncs would be a coin toss. The note templates' ids used to
   * name no record at all; they name theirs now.
   */
  test("each Jira template's id, name and suggested workflow name say which kind of record it is for", () => {
    for (const kind of KINDS) {
      const other: string = otherKind(kind).noun;
      const ownWord: RegExp = new RegExp(`\\b${kind.noun}\\b`);

      for (const templateId of templateIdsOf(kind)) {
        const template: WorkflowTemplate = templateOf(templateId);

        expect({
          templateId: templateId,
          idNamesIt: new RegExp(`-${kind.noun}(-|$)`).test(templateId),
          nameNamesIt: ownWord.test(template.name),
          workflowNameNamesIt: ownWord.test(template.workflowName),
          namesTheOther: [templateId, template.name, template.workflowName]
            .join(" ")
            .toLowerCase()
            .includes(other),
        }).toEqual({
          templateId: templateId,
          idNamesIt: true,
          nameNamesIt: true,
          workflowNameNamesIt: true,
          namesTheOther: false,
        });
      }
    }

    for (const oldId of [
      "jira-comment-from-private-note",
      "jira-comment-from-public-note",
      "jira-comment-to-private-note",
      "jira-issue-changes-to-private-note",
    ]) {
      expect({ oldId: oldId, template: getWorkflowTemplate(oldId) }).toEqual({
        oldId: oldId,
        template: null,
      });
    }
  });

  /*
   * Once created, the workflow sits in a list among everything else the
   * project has, with no category beside it.
   */
  test("the suggested workflow name says it is a Jira workflow", () => {
    for (const templateId of JIRA_TEMPLATE_IDS) {
      expect(templateOf(templateId).workflowName).toContain("Jira");
    }
  });

  // A team that takes both sets ends up with every one of these in one list.
  test("no two Jira templates suggest the same workflow name", () => {
    const names: Array<string> = JIRA_TEMPLATE_IDS.map((templateId: string) => {
      return templateOf(templateId).workflowName;
    });

    expect(new Set(names).size).toBe(names.length);
  });

  test("a webhook template's setup names the Jira event its script accepts", () => {
    expect(Object.keys(WEBHOOK_SETUP).sort()).toEqual(
      [...JIRA_TO_ONEUPTIME_TEMPLATE_IDS].sort(),
    );

    for (const templateId of JIRA_TO_ONEUPTIME_TEMPLATE_IDS) {
      const setup: WebhookSetup = lookup(WEBHOOK_SETUP, templateId);
      const description: string = templateOf(templateId).workflowDescription;

      expect(description).toContain("Webhook trigger");
      expect(description).toContain(`for the ${setup.registeredFor} event`);
      expect(scriptCode(templateId, setup.scriptId)).toContain(
        `'${setup.webhookEvent}'`,
      );
    }
  });
});

describe("Jira template variables", () => {
  test("each template asks for exactly the configuration it uses", () => {
    const asked: Record<string, Array<string>> = {};

    for (const templateId of JIRA_TEMPLATE_IDS) {
      asked[templateId] = templateOf(templateId).variables.map(
        (variable: WorkflowTemplateVariable) => {
          return variable.name;
        },
      );
    }

    expect(asked).toEqual(EXPECTED_VARIABLES);
  });

  test("a template asks for Jira credentials exactly when it calls Jira", () => {
    for (const templateId of JIRA_TEMPLATE_IDS) {
      const names: Array<string> = templateOf(templateId).variables.map(
        (variable: WorkflowTemplateVariable) => {
          return variable.name;
        },
      );

      expect({
        templateId: templateId,
        asksForSite: names.includes("jiraBaseUrl"),
        asksForToken: names.includes("jiraBasicAuthToken"),
      }).toEqual({
        templateId: templateId,
        asksForSite: specOf(templateId).nodes.some(isApiNode),
        asksForToken: specOf(templateId).nodes.some(isApiNode),
      });
    }
  });

  /*
   * A team that sets up several Jira templates types the same site and token
   * into each wizard, so the fields must read the same everywhere. The one
   * exception is the OneUptime URL's help text, which names the record the
   * issue links back to; its name, and with it the stored value, is shared.
   */
  test("a variable shared between Jira templates is the same definition everywhere, but for the words naming the record", () => {
    const byName: Map<string, WorkflowTemplateVariable> = new Map();

    for (const templateId of JIRA_TEMPLATE_IDS) {
      for (const variable of templateOf(templateId).variables) {
        const comparable: WorkflowTemplateVariable =
          variable.name === "oneuptimeUrl"
            ? {
                ...variable,
                description: variable.description
                  .split(kindOf(templateId).noun)
                  .join("<record>"),
              }
            : variable;
        const first: WorkflowTemplateVariable | undefined = byName.get(
          variable.name,
        );

        if (!first) {
          byName.set(variable.name, comparable);
          continue;
        }

        expect(comparable).toEqual(first);
      }
    }

    expect(Array.from(byName.keys()).sort()).toEqual(
      [
        "jiraBaseUrl",
        "jiraBasicAuthToken",
        "jiraIssueType",
        "jiraProjectKey",
        "oneuptimeUrl",
      ].sort(),
    );
  });

  test.each(KINDS)(
    "$noun: the OneUptime URL's help says the issue links back to the $noun",
    (kind: RecordKind) => {
      const url: WorkflowTemplateVariable | undefined = templateOf(
        kind.templates.createIssue,
      ).variables.find((variable: WorkflowTemplateVariable) => {
        return variable.name === "oneuptimeUrl";
      });

      expect(url?.description).toContain(
        `link the Jira issue back to the ${kind.noun}`,
      );
      expect(url?.description).not.toContain(otherKind(kind).noun);
    },
  );

  test("every Jira variable is required, and only the API token is secret", () => {
    for (const templateId of JIRA_TEMPLATE_IDS) {
      for (const variable of templateOf(templateId).variables) {
        expect({
          name: variable.name,
          required: variable.required,
          isSecret: variable.isSecret,
        }).toEqual({
          name: variable.name,
          required: true,
          isSecret: variable.name === "jiraBasicAuthToken",
        });
      }
    }
  });

  /*
   * Every call is written as {{jiraBaseUrl}}/rest/api/3/..., so a trailing
   * slash doubles up and a missing scheme is not a URL at all.
   */
  test("the site URL asks for https and no trailing slash", () => {
    const siteUrl: WorkflowTemplateVariable = templateOf(
      INCIDENT.templates.createIssue,
    ).variables.find((variable: WorkflowTemplateVariable) => {
      return variable.name === "jiraBaseUrl";
    }) as WorkflowTemplateVariable;

    expect(siteUrl.description).toContain("https://");
    expect(siteUrl.description).toContain("no trailing slash");
    expect(siteUrl.placeholder).toMatch(/^https:\/\/\S+[^/]$/);
  });

  /*
   * Jira takes the token as HTTP Basic auth, and a workflow cannot encode it
   * without a script that would log the result — so the field holds the
   * base64 of email:token already, and its example has to look like one.
   */
  test("the API token's placeholder is the base64 of email:token the field expects", () => {
    const token: WorkflowTemplateVariable = templateOf(
      INCIDENT.templates.createIssue,
    ).variables.find((variable: WorkflowTemplateVariable) => {
      return variable.name === "jiraBasicAuthToken";
    }) as WorkflowTemplateVariable;

    const decoded: string = Buffer.from(token.placeholder, "base64").toString(
      "utf8",
    );

    expect(Buffer.from(decoded, "utf8").toString("base64")).toBe(
      token.placeholder,
    );
    expect(decoded).toMatch(/^[^\s:@]+@[^\s:]+:\S+$/);
    expect(token.title).toContain("base64");
    expect(token.description).toContain("base64");
  });

  /*
   * `echo` would encode a trailing newline into the credential, and GNU
   * base64 wraps long output onto a second line; either gives Jira a header
   * it cannot read. And every comment, transition and label is made as the
   * token's user, whose access is also what the searches can see — so the
   * token belongs to a user of its own.
   */
  test("the API token's instructions encode exactly email:token, for a dedicated user", () => {
    const token: WorkflowTemplateVariable = templateOf(
      INCIDENT.templates.createIssue,
    ).variables.find((variable: WorkflowTemplateVariable) => {
      return variable.name === "jiraBasicAuthToken";
    }) as WorkflowTemplateVariable;

    expect(token.description).toContain(
      "printf '%s' 'you@example.com:API_TOKEN' | base64 | tr -d '\\n'",
    );
    expect(token.description).not.toMatch(/\becho\b/);
    expect(token.description).toContain("for a dedicated Jira user");
  });

  /*
   * The site and the token belong to the Jira calls and nowhere else; the
   * project, issue type and OneUptime address only to the step that files the
   * issue.
   */
  test("each variable is referenced only where it belongs", () => {
    const found: Array<string> = [];
    const expected: Array<string> = [];

    for (const { templateId, node } of jiraNodes()) {
      for (const [argumentId, value] of Object.entries(node.args || {})) {
        const names: Set<string> = new Set();

        for (const reference of referencesIn(argumentText(value))) {
          if (reference.parsed.rootType === ReferenceRootType.LocalVariable) {
            names.add(reference.parsed.variableName as string);
          }
        }

        for (const name of names) {
          found.push(
            `${templateId} ${name} in ${node.componentId}.${argumentId}`,
          );
        }
      }

      if (isApiNode(node)) {
        expected.push(
          `${templateId} jiraBaseUrl in ${node.componentId}.url`,
          `${templateId} jiraBasicAuthToken in ${node.componentId}.request-headers`,
        );
      }
    }

    for (const kind of KINDS) {
      const templateId: string = kind.templates.createIssue;

      expected.push(
        `${templateId} jiraProjectKey in create-issue-1.request-body`,
        `${templateId} jiraIssueType in create-issue-1.request-body`,
        `${templateId} oneuptimeUrl in prepare-issue-1.arguments`,
      );
    }

    expect(found.sort()).toEqual(expected.sort());
  });
});

describe("the Jira API token", () => {
  /*
   * The variable is marked secret, which redacts its literal value from run
   * logs — but anything computed from it (a script's return value, a URL, a
   * log line quoting it) would not be. So it may appear in exactly one shape,
   * in exactly one place. Scripts and their arguments are walked too.
   */
  test("appears only as the Authorization header of a Jira call", () => {
    const found: Array<string> = [];
    const expected: Array<string> = [];

    for (const { templateId, node } of jiraNodes()) {
      for (const entry of collectStringEntries(node.args, "")) {
        if (entry.text.includes("jiraBasicAuthToken")) {
          found.push(
            `${templateId} ${node.componentId}${entry.path} = ${entry.text}`,
          );
        }
      }

      if (isApiNode(node)) {
        expected.push(
          `${templateId} ${node.componentId}.request-headers.Authorization = ${AUTHORIZATION}`,
        );
      }
    }

    expect(found.sort()).toEqual(expected.sort());
    expect(expected.length).toBeGreaterThan(0);
  });

  /*
   * An object, not JSON text: an object-valued argument is substituted with
   * JSON escaping and handed back as an object. And the headers argument is
   * marked sensitive, which is what keeps the resolved header out of the run
   * log — the template leans on that, so it is pinned here.
   */
  test("every Jira call sends the same Basic auth header, on an argument the run log redacts", () => {
    for (const { templateId, node } of jiraNodes(isApiNode)) {
      expect({
        at: `${templateId} ${node.componentId}`,
        headers: node.args?.["request-headers"],
        sensitive: argumentOf(node.metadataId, "request-headers")?.isSensitive,
      }).toEqual({
        at: `${templateId} ${node.componentId}`,
        headers: { Authorization: AUTHORIZATION },
        sensitive: true,
      });
    }
  });
});

describe("calls to Jira", () => {
  test("each template makes exactly the Jira calls it documents, with the right method and path", () => {
    const calls: Record<string, Array<JiraCall>> = {};

    for (const templateId of JIRA_TEMPLATE_IDS) {
      calls[templateId] = specOf(templateId)
        .nodes.filter(isApiNode)
        .map((node: TemplateNodeSpec): JiraCall => {
          return {
            componentId: node.componentId,
            metadataId: node.metadataId,
            url: textArg(node, "url"),
          };
        });
    }

    expect(calls).toEqual(EXPECTED_JIRA_CALLS);
  });

  test("every call goes to the configured site's REST v3 API, and the site is only ever the start of a URL", () => {
    for (const { templateId, node } of jiraNodes()) {
      for (const entry of collectStringEntries(node.args, "")) {
        if (!entry.text.includes(BASE_URL)) {
          continue;
        }

        expect({
          at: `${templateId} ${node.componentId}${entry.path}`,
          isApiUrl: isApiNode(node) && entry.path === ".url",
          startsAtRestV3: entry.text.startsWith(`${REST}/`),
          timesUsed: entry.text.split(BASE_URL).length - 1,
        }).toEqual({
          at: `${templateId} ${node.componentId}${entry.path}`,
          isApiUrl: true,
          startsAtRestV3: true,
          timesUsed: 1,
        });
      }
    }
  });

  /*
   * REST v2 takes plain-text rich text where v3 takes Atlassian Document
   * Format, and GET/POST /rest/api/3/search has been removed from Jira Cloud;
   * /search/jql replaced it.
   */
  test("nothing uses REST v2, latest, or the removed search endpoint", () => {
    const offenders: Array<string> = [];

    for (const { templateId, node } of jiraNodes()) {
      for (const entry of collectStringEntries(node.args, "")) {
        if (NOT_REST_V3.test(entry.text) || REMOVED_SEARCH.test(entry.text)) {
          offenders.push(`${templateId} ${node.componentId}${entry.path}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  /*
   * References are not URL-encoded when they are substituted, so whatever
   * lands in a URL's path must already be safe there. The only thing that
   * does is an issue key a script matched against ISSUE_KEY before returning
   * — itself, or through linkedIssue, which keeps only matching keys.
   */
  test("the only thing substituted into a URL after the site is an issue key a script checked", () => {
    let checked: number = 0;

    for (const { templateId, node } of jiraNodes(isApiNode)) {
      const references: Array<Reference> = referencesIn(textArg(node, "url"));

      expect(references[0]?.raw).toBe(BASE_URL);

      for (const reference of references.slice(1)) {
        const source: TemplateNodeSpec = nodeOf(
          templateId,
          reference.parsed.componentId as string,
        );
        const at: string = `${templateId} ${node.componentId}`;

        expect({
          at: at,
          reference: reference.raw,
          fromScript: isScriptNode(source),
        }).toEqual({
          at: at,
          reference: scriptOutput(source.componentId, "issueKey"),
          fromScript: true,
        });

        expect({
          at: at,
          keyChecked: issueKeyCheck(textArg(source, "code")) !== "",
        }).toEqual({ at: at, keyChecked: true });
        checked++;
      }
    }

    // Seven calls in the incident set, and six in the alert set.
    expect(checked).toBe(13);
  });

  test("a script checks the issue key itself, or takes it from linkedIssue", () => {
    const checks: Record<string, string> = {};

    for (const { templateId, node } of jiraNodes(isScriptNode)) {
      const check: string = issueKeyCheck(textArg(node, "code"));

      if (check) {
        checks[`${templateId} ${node.componentId}`] = check;
      }
    }

    expect(checks).toEqual(
      perKind((kind: RecordKind): Record<string, string> => {
        const ids: KindTemplateIds = kind.templates;
        const expected: Record<string, string> = {
          [`${ids.transitionIssue} plan-transition-1`]:
            "takes it from linkedIssue",
          [`${ids.createFromIssue} ${kind.steps.prepareRecord}`]:
            "tests the key",
          [`${ids.createFromIssue} confirm-unlinked-1`]: "tests the key",
          [`${ids.commentToNote} read-comment-1`]: "tests the key",
          [`${ids.statusToState} read-event-1`]: "tests the key",
          [`${ids.issueChangesToNote} read-changes-1`]: "tests the key",
        };

        for (const templateId of commentTemplateIds(kind)) {
          expected[`${templateId} build-comment-1`] =
            "takes it from linkedIssue";
        }

        return expected;
      }),
    );
  });

  test("ISSUE_KEY only accepts a bare issue key, so a key cannot steer a URL", () => {
    const issueKey: RegExp = helperRegex("ISSUE_KEY");

    for (const key of ["OPS-17", "ABC_2-9", "a-1"]) {
      expect({ key: key, accepted: issueKey.test(key) }).toEqual({
        key: key,
        accepted: true,
      });
    }

    for (const key of [
      "OPS-17/comment",
      "OPS-17?fields=labels",
      "OPS-17#top",
      "../OPS-17",
      "OPS-17\n",
      "OPS 17",
      "OPS-",
      "-17",
      "17-OPS",
      "OPS-1.2",
      `OPS-1${variableReference("jiraBasicAuthToken")}`,
    ]) {
      expect({ key: key, accepted: issueKey.test(key) }).toEqual({
        key: key,
        accepted: false,
      });
    }
  });

  test("UUID only accepts a lower-case id, so a label cannot smuggle anything into a lookup", () => {
    const uuid: RegExp = helperRegex("UUID");

    expect(uuid.test("3f0e2a4c-5b6d-4e7f-8a9b-0c1d2e3f4a5b")).toBe(true);

    for (const id of [
      "3F0E2A4C-5B6D-4E7F-8A9B-0C1D2E3F4A5B",
      "3f0e2a4c-5b6d-4e7f-8a9b-0c1d2e3f4a5b ",
      "3f0e2a4c-5b6d-4e7f-8a9b-0c1d2e3f4a5b}}",
      "3f0e2a4c5b6d4e7f8a9b0c1d2e3f4a5b",
      "../3f0e2a4c-5b6d-4e7f-8a9b-0c1d2e3f4a5b",
    ]) {
      expect({ id: id, accepted: uuid.test(id) }).toEqual({
        id: id,
        accepted: false,
      });
    }
  });

  test("a GET sends no body", () => {
    for (const { node } of jiraNodes((candidate: TemplateNodeSpec) => {
      return candidate.metadataId === ComponentID.ApiGet;
    })) {
      expect(node.args?.["request-body"]).toBeUndefined();
    }
  });

  /*
   * /search/jql returns ids only unless `fields` is given — not even the key.
   * A label is meant to name one issue, but a clone copies it, so the search
   * asks for a second result for the script to refuse. The search is POSTed
   * because references are not URL-encoded and JQL is full of spaces, quotes
   * and equals signs.
   */
  test.each(Object.keys(EXPECTED_SEARCHES))(
    "%s finds the issue by its record's label, asking for its key and a second match, oldest first",
    (templateId: string) => {
      const search: SearchExpectation = lookup(EXPECTED_SEARCHES, templateId);
      const node: TemplateNodeSpec = nodeOf(templateId, "find-issue-1");
      const body: JSONObject = jsonArg(node, "request-body");

      expect(node.metadataId).toBe(ComponentID.ApiPost);
      expect(textArg(node, "url")).toBe(`${REST}/search/jql`);
      expect(body["fields"]).toContain("key");
      expect(body).toEqual({
        jql: `labels = "${search.labelPrefix}${search.recordIdReference}"${SEARCH_ORDER}`,
        fields: search.fields,
        maxResults: SEARCH_MAX_RESULTS,
        ...(search.expandsTransitions ? { expand: "transitions" } : {}),
      });
    },
  );

  /*
   * With maxResults 1 a second labelled issue would never be seen, and the
   * run would post to whichever one Jira happened to list. Two is enough to
   * know there is more than one; more would only make the response bigger.
   * Oldest first keeps the answer stable, so the refusal names the issue
   * filed for the record before its clones, and names them the same way
   * every run. And a search only ever asks for its own kind's label: an
   * alert's issue is never an incident's.
   */
  test("every search asks for its own kind's label, two issues, oldest first", () => {
    const searches: Array<JiraNode> = jiraNodes((node: TemplateNodeSpec) => {
      return isApiNode(node) && textArg(node, "url").endsWith("/search/jql");
    });

    expect(searches).toHaveLength(Object.keys(EXPECTED_SEARCHES).length);

    for (const { templateId, node } of searches) {
      const kind: RecordKind = kindOf(templateId);
      const body: JSONObject = jsonArg(node, "request-body");
      const jql: string = String(body["jql"]);

      expect({
        at: `${templateId} ${node.componentId}`,
        byOwnLabel: jql.startsWith(`labels = "${kind.labelPrefix}`),
        namesOtherKind: jql.includes(otherKind(kind).labelPrefix),
        oldestFirst: jql.endsWith(SEARCH_ORDER),
        orderedOnce: jql.split("ORDER BY").length - 1,
        maxResults: body["maxResults"],
      }).toEqual({
        at: `${templateId} ${node.componentId}`,
        byOwnLabel: true,
        namesOtherKind: false,
        oldestFirst: true,
        orderedOnce: 1,
        maxResults: SEARCH_MAX_RESULTS,
      });
    }
  });

  /*
   * Asking for two only helps if the script refuses the second. Each search's
   * answer goes to one script, which takes it through linkedIssue — never
   * search.issues[0] — and names the same record the search asked about.
   */
  test.each(Object.keys(EXPECTED_SEARCHES))(
    "%s hands the search to one script, which takes the issue through linkedIssue",
    (templateId: string) => {
      const search: SearchExpectation = lookup(EXPECTED_SEARCHES, templateId);
      const answer: string = componentReturnValueReference(
        "find-issue-1",
        "response-body",
      );
      const readers: Array<string> = specOf(templateId)
        .nodes.filter((node: TemplateNodeSpec) => {
          return (
            !isLogNode(node) &&
            referencesIn(argumentText(node.args)).some(
              (reference: Reference) => {
                return reference.raw === answer;
              },
            )
          );
        })
        .map((node: TemplateNodeSpec) => {
          return node.componentId;
        });

      expect(readers).toEqual([search.scriptId]);

      const script: TemplateNodeSpec = nodeOf(templateId, search.scriptId);
      const body: string = scriptBody(textArg(script, "code"));

      expect(jsonArg(script, "arguments")["search"]).toBe(answer);
      expect(body).toContain("const search = readJson(args.search) || {};");

      for (const line of LINKED_ISSUE_USE) {
        expect(body).toContain(line);
      }

      expect(body).toContain(`linkedIssue(search, ${search.scriptRecordId});`);
      expect(body.split("linkedIssue(")).toHaveLength(2);
      expect(body).not.toMatch(/search\.issues|\.issues\[/);
      // The rest of the script reads the issue linkedIssue chose.
      expect(body).not.toMatch(/\bissues\b/);
    },
  );

  /*
   * The helper every searching script leans on. It hands back an issue only
   * when exactly one issue with a valid key carries the label, and only ever
   * a key that matched ISSUE_KEY — which is what lets that key go into a URL.
   */
  test.each(KINDS)(
    "$noun: linkedIssue hands back an issue only when exactly one valid issue carries the $noun's label",
    (kind: RecordKind) => {
      const helpers: string = kindHelpers(kind);
      const start: number = indexOrFail(
        helpers,
        `const linkedIssue = (search, ${kind.noun}Id) => {`,
      );
      const linkedIssue: string = helpers.slice(start);
      const filter: number = indexOrFail(linkedIssue, LINKED_ISSUE_KEY_FILTER);
      const none: number = indexOrFail(linkedIssue, LINKED_ISSUE_NONE);
      const several: number = indexOrFail(linkedIssue, LINKED_ISSUE_SEVERAL);
      const found: number = indexOrFail(linkedIssue, LINKED_ISSUE_FOUND);

      // Invalid keys are dropped before counting, and the one issue comes last.
      expect(filter).toBeLessThan(none);
      expect(none).toBeLessThan(several);
      expect(several).toBeLessThan(found);
      expect(linkedIssue.split("return { issue:")).toHaveLength(2);
      expect(linkedIssue).toContain(
        `const label = ${kind.upper}_LABEL_PREFIX + ${kind.noun}Id;`,
      );
    },
  );

  test("every search in the Jira templates is one of those", () => {
    const searches: Array<string> = jiraNodes(isApiNode)
      .filter(({ node }: JiraNode) => {
        return textArg(node, "url").includes("/search");
      })
      .map(({ templateId, node }: JiraNode) => {
        return `${templateId} ${node.componentId}`;
      });

    expect(searches.sort()).toEqual(
      Object.keys(EXPECTED_SEARCHES)
        .map((templateId: string) => {
          return `${templateId} find-issue-1`;
        })
        .sort(),
    );
  });

  /*
   * The transitions available from the issue's current status come back with
   * the search, which saves a call — and only the transition templates need
   * them, along with the status they compare against.
   */
  test("only the transition templates expand transitions, and their scripts read them", () => {
    const expanding: Array<string> = jiraNodes(isApiNode)
      .filter(({ node }: JiraNode) => {
        const body: JSONValue | undefined = node.args?.["request-body"];
        return typeof body === "string" && body.includes('"expand"');
      })
      .map(({ templateId, node }: JiraNode) => {
        return `${templateId} ${node.componentId}`;
      });

    expect(expanding).toEqual(
      KINDS.map((kind: RecordKind) => {
        return `${kind.templates.transitionIssue} find-issue-1`;
      }),
    );

    for (const kind of KINDS) {
      const plan: string = scriptCode(
        kind.templates.transitionIssue,
        "plan-transition-1",
      );

      expect(plan).toContain("issue.transitions");
      expect(plan).toContain("issue.fields.status");
    }
  });
});

describe("request bodies and other JSON arguments", () => {
  /*
   * RunWorkflow.getComponentArguments JSON.parses a JSON argument after
   * substitution and throws on anything else. Masking each reference with a
   * bare word — legal only inside a string literal — checks both that the
   * text is strict JSON and that every reference sits inside a string, where
   * the runtime escapes what it substitutes.
   */
  test("every JSON argument is strict JSON, with every reference inside a string", () => {
    let checked: number = 0;

    for (const { templateId, node } of jiraNodes()) {
      for (const [argumentId, value] of Object.entries(node.args || {})) {
        if (
          argumentOf(node.metadataId, argumentId)?.type !==
          ComponentInputType.JSON
        ) {
          continue;
        }

        const at: string = `${templateId} ${node.componentId}.${argumentId}`;

        expect({ at: at, type: typeof value }).toEqual({
          at: at,
          type: "string",
        });

        // A whole-argument reference is handed over as the object it names.
        if (wholeReference(value)) {
          continue;
        }

        const masked: string = (value as string).replace(
          getTemplateExpressionRegex(),
          "__reference__",
        );
        let error: string = "";

        try {
          JSON.parse(masked);
        } catch (err: unknown) {
          error = err instanceof Error ? err.message : String(err);
        }

        expect({ at: at, error: error }).toEqual({ at: at, error: "" });
        checked++;
      }
    }

    expect(checked).toBeGreaterThan(40);
  });

  test("every Atlassian Document Format body is a doc of single-text paragraphs", () => {
    const found: Array<string> = [];

    for (const { templateId, node } of jiraNodes(isApiNode)) {
      if (node.args?.["request-body"] === undefined) {
        continue;
      }

      for (const document of adfDocumentsIn(jsonArg(node, "request-body"))) {
        const at: string = `${templateId} ${node.componentId}`;

        found.push(at);
        expect({ at: at, problems: adfProblems(document) }).toEqual({
          at: at,
          problems: [],
        });
      }
    }

    expect(found).toEqual(
      KINDS.flatMap((kind: RecordKind) => {
        return [
          `${kind.templates.createIssue} create-issue-1`,
          ...commentTemplateIds(kind).map((templateId: string) => {
            return `${templateId} post-comment-1`;
          }),
        ];
      }),
    );
  });

  test.each(KINDS)(
    "$noun: the new issue is filed in the configured project and type, labelled with the link",
    (kind: RecordKind) => {
      const r: string = kind.noun;
      const body: JSONObject = jsonArg(
        nodeOf(kind.templates.createIssue, "create-issue-1"),
        "request-body",
      );

      expect(body).toEqual({
        fields: {
          project: { key: variableReference("jiraProjectKey") },
          issuetype: { name: variableReference("jiraIssueType") },
          summary: scriptOutput("prepare-issue-1", "summary"),
          labels: [
            JIRA_LINK_LABEL,
            scriptOutput("prepare-issue-1", `${r}Label`),
          ],
          description: {
            type: "doc",
            version: 1,
            content: [
              {
                type: "paragraph",
                content: [
                  {
                    type: "text",
                    text: scriptOutput("prepare-issue-1", "description"),
                  },
                ],
              },
              {
                type: "paragraph",
                content: [
                  {
                    type: "text",
                    text: `Open this ${r} in OneUptime`,
                    marks: [
                      {
                        type: "link",
                        attrs: {
                          href: scriptOutput("prepare-issue-1", `${r}Url`),
                        },
                      },
                    ],
                  },
                ],
              },
            ],
          },
        },
      });
    },
  );

  test.each(KINDS.flatMap(commentTemplateIds))(
    "%s posts the script's comment as one paragraph",
    (templateId: string) => {
      const body: JSONObject = jsonArg(
        nodeOf(templateId, "post-comment-1"),
        "request-body",
      );

      expect(body["body"]).toEqual({
        type: "doc",
        version: 1,
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: scriptOutput("build-comment-1", "comment"),
              },
            ],
          },
        ],
      });
    },
  );

  /*
   * Jira Service Management shows a comment to the customer unless it is
   * marked internal. A private note is private, a public note is not, and a
   * record's root cause and remediation are for the team.
   */
  test.each(
    KINDS.flatMap((kind: RecordKind) => {
      return [
        kind.templates.privateNoteToComment,
        kind.templates.updateComment,
      ];
    }),
  )("%s posts an internal comment", (templateId: string) => {
    const body: JSONObject = jsonArg(
      nodeOf(templateId, "post-comment-1"),
      "request-body",
    );

    expect(Object.keys(body).sort()).toEqual(["body", "properties"]);
    expect(body["properties"]).toEqual(INTERNAL_COMMENT_PROPERTIES);
  });

  test("a public note becomes an ordinary comment the customer can see", () => {
    const publicBody: JSONObject = jsonArg(
      nodeOf(
        INCIDENT.templates.publicNoteToComment as string,
        "post-comment-1",
      ),
      "request-body",
    );

    expect(Object.keys(publicBody)).toEqual(["body"]);
  });

  /*
   * The edit comment quotes the root cause and remediation notes, which are
   * no more for the customer than a private note is. So it is marked the
   * same way, and the one comment a customer may see is an incident public
   * note's. Alerts have no public notes, so every alert comment is internal.
   */
  test("every comment OneUptime posts to Jira is internal, but a public note's", () => {
    const internal: Record<string, boolean> = {};

    for (const { templateId, node } of jiraNodes(isApiNode)) {
      if (!textArg(node, "url").endsWith("/comment")) {
        continue;
      }

      const properties: JSONValue | undefined = jsonArg(node, "request-body")[
        "properties"
      ];

      if (properties !== undefined) {
        expect({
          at: `${templateId} ${node.componentId}`,
          properties: properties,
        }).toEqual({
          at: `${templateId} ${node.componentId}`,
          properties: INTERNAL_COMMENT_PROPERTIES,
        });
      }

      internal[`${templateId} ${node.componentId}`] = properties !== undefined;
    }

    expect(internal).toEqual(
      perKind((kind: RecordKind): Record<string, boolean> => {
        const expected: Record<string, boolean> = {};

        for (const templateId of commentTemplateIds(kind)) {
          expected[`${templateId} post-comment-1`] =
            templateId !== kind.templates.publicNoteToComment;
        }

        return expected;
      }),
    );
  });

  test.each(KINDS)(
    "$noun: the edit comment is the script's comment, marked internal like a private note's",
    (kind: RecordKind) => {
      const edit: JSONObject = jsonArg(
        nodeOf(kind.templates.updateComment, "post-comment-1"),
        "request-body",
      );
      const privateNote: JSONObject = jsonArg(
        nodeOf(kind.templates.privateNoteToComment, "post-comment-1"),
        "request-body",
      );

      expect(edit).toEqual({
        body: {
          type: "doc",
          version: 1,
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: scriptOutput("build-comment-1", "comment"),
                },
              ],
            },
          ],
        },
        properties: INTERNAL_COMMENT_PROPERTIES,
      });
      expect(edit).toEqual(privateNote);
    },
  );

  /*
   * Transitions with a screen may ask for fields; the script prefers ones
   * without, and the body sends nothing that one without a screen would
   * refuse.
   */
  test.each(KINDS)(
    "$noun: the transition body names only the transition",
    (kind: RecordKind) => {
      expect(
        jsonArg(
          nodeOf(kind.templates.transitionIssue, "transition-issue-1"),
          "request-body",
        ),
      ).toEqual({
        transition: { id: scriptOutput("plan-transition-1", "transitionId") },
      });
    },
  );

  /*
   * `update.labels` with `add` keeps the labels the reporter set. Setting
   * `fields.labels` would replace them with the two links.
   */
  test.each(KINDS)(
    "$noun: a $noun made from Jira is linked back by adding labels to the issue, not replacing them",
    (kind: RecordKind) => {
      const link: TemplateNodeSpec = nodeOf(
        kind.templates.createFromIssue,
        "link-issue-1",
      );
      const body: JSONObject = jsonArg(link, "request-body");

      expect(body).toEqual({
        update: {
          labels: [
            { add: JIRA_LINK_LABEL },
            {
              add: `${kind.labelPrefix}${componentReturnValueReference(
                kind.steps.createRecord,
                "model",
                ["_id"],
              )}`,
            },
          ],
        },
      });
      expect(body["fields"]).toBeUndefined();
    },
  );
});

describe("text from Jira at substitution", () => {
  /*
   * VMAPI.replaceValueInPlace collects an argument's references first, then
   * replaces each one's FIRST occurrence in the text as it stands. If Jira
   * text is substituted early and names a later reference, that later
   * replacement lands inside the Jira text, and the real placeholder is left
   * as literal braces. Substituted last, Jira text has nothing left to take.
   *
   * Log lines are left out: all a reordering can do there is move text within
   * one log line, and none of them quotes a variable (pinned below).
   */
  test("in every argument, references to Jira text come after every other reference", () => {
    const offenders: Array<string> = [];
    let argumentsWithJiraText: number = 0;

    for (const { templateId, node } of jiraNodes()) {
      if (isLogNode(node)) {
        continue;
      }

      for (const [argumentId, value] of Object.entries(node.args || {})) {
        const references: Array<Reference> = referencesIn(argumentText(value));
        const fromJira: Array<boolean> = references.map(
          (reference: Reference) => {
            return isFromJira(templateId, reference);
          },
        );
        const firstFromJira: number = fromJira.indexOf(true);

        if (firstFromJira === -1) {
          continue;
        }

        argumentsWithJiraText++;

        references.forEach((reference: Reference, index: number) => {
          if (index > firstFromJira && !fromJira[index]) {
            offenders.push(
              `${templateId} ${node.componentId}.${argumentId}: ${reference.raw} is filled after Jira text`,
            );
          }
        });
      }
    }

    expect(offenders).toEqual([]);
    expect(argumentsWithJiraText).toBeGreaterThan(20);
  });

  /*
   * Only references already in an argument are ever filled in, so text from
   * Jira can reach a variable only if the same argument names one. None does,
   * log lines included.
   */
  test("no argument that quotes Jira text also quotes a variable", () => {
    const offenders: Array<string> = [];

    for (const { templateId, node } of jiraNodes()) {
      for (const [argumentId, value] of Object.entries(node.args || {})) {
        const references: Array<Reference> = referencesIn(argumentText(value));

        const quotesJira: boolean = references.some((reference: Reference) => {
          return isFromJira(templateId, reference);
        });
        const quotesVariable: boolean = references.some(
          (reference: Reference) => {
            return (
              reference.parsed.rootType === ReferenceRootType.LocalVariable
            );
          },
        );

        if (quotesJira && quotesVariable) {
          offenders.push(`${templateId} ${node.componentId}.${argumentId}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  test.each(KINDS)(
    "$noun: the webhook payload and Jira's answers are what the check treats as Jira text",
    (kind: RecordKind) => {
      // A guard on the guard: the two tests above are only as good as this.
      const create: string = kind.templates.createFromIssue;
      const prepare: string = kind.steps.prepareRecord;

      expect(
        fromJiraAt(
          create,
          componentReturnValueReference("webhook-1", "request-body"),
        ),
      ).toBe(true);
      expect(fromJiraAt(create, scriptOutput(prepare, "title"))).toBe(true);
      expect(fromJiraAt(create, scriptOutput(prepare, "issueKey"))).toBe(false);
      // The severity id the script chose is a OneUptime row's, not Jira text.
      expect(
        fromJiraAt(create, scriptOutput(prepare, kind.severityIdColumn)),
      ).toBe(false);
      expect(
        fromJiraAt(
          create,
          componentReturnValueReference("find-severities-1", "models"),
        ),
      ).toBe(false);

      for (const templateId of [kind.templates.commentToNote, create]) {
        expect(
          fromJiraAt(
            templateId,
            componentReturnValueReference("get-issue-1", "response-body"),
          ),
        ).toBe(true);
      }

      // A script that read Jira's answer returns Jira text, bar what it checked.
      expect(
        fromJiraAt(create, scriptOutput("confirm-unlinked-1", "reason")),
      ).toBe(true);
      expect(
        fromJiraAt(create, scriptOutput("confirm-unlinked-1", "proceed")),
      ).toBe(false);
      expect(
        fromJiraAt(
          kind.templates.statusToState,
          scriptOutput("read-event-1", `${kind.noun}Id`),
        ),
      ).toBe(false);
      expect(
        fromJiraAt(
          kind.templates.createIssue,
          scriptOutput("prepare-issue-1", "description"),
        ),
      ).toBe(false);
    },
  );
});

describe("Jira template scripts", () => {
  const scripts: Array<JiraNode> = jiraNodes(isScriptNode);

  test("there is one per decision the templates make", () => {
    expect(
      scripts.map(({ templateId, node }: JiraNode) => {
        return `${templateId} ${node.componentId}`;
      }),
    ).toEqual(
      KINDS.flatMap((kind: RecordKind) => {
        const ids: KindTemplateIds = kind.templates;

        return [
          `${ids.createIssue} prepare-issue-1`,
          `${ids.transitionIssue} plan-transition-1`,
          ...commentTemplateIds(kind).map((templateId: string) => {
            return `${templateId} build-comment-1`;
          }),
          `${ids.createFromIssue} ${kind.steps.prepareRecord}`,
          `${ids.createFromIssue} confirm-unlinked-1`,
          `${ids.statusToState} read-event-1`,
          `${ids.statusToState} decide-state-1`,
          `${ids.commentToNote} read-comment-1`,
          `${ids.commentToNote} find-link-1`,
          `${ids.issueChangesToNote} read-changes-1`,
        ];
      }),
    );
  });

  /*
   * A script is an argument like any other, so a {{...}} in its source would
   * be substituted before it runs.
   */
  test("no script contains a double brace, so nothing in its source is substituted", () => {
    for (const { templateId, node } of scripts) {
      const code: string = textArg(node, "code");

      expect({
        at: `${templateId} ${node.componentId}`,
        hasDoubleBrace: code.includes("{{"),
        expressions: parseTemplateExpressions(code).length,
      }).toEqual({
        at: `${templateId} ${node.componentId}`,
        hasDoubleBrace: false,
        expressions: 0,
      });
    }
  });

  test.each(KINDS)(
    "$noun: every script starts with the $noun set's shared helper block",
    (kind: RecordKind) => {
      const own: Array<JiraNode> = scripts.filter(
        ({ templateId }: JiraNode) => {
          return kindOf(templateId) === kind;
        },
      );
      const first: string = kindHelpers(kind);

      expect(first.length).toBeGreaterThan(0);
      expect(own.length).toBeGreaterThan(0);

      for (const { templateId, node } of own) {
        const code: string = textArg(node, "code");

        expect(code.startsWith(SCRIPT_HELPER_HEADER)).toBe(true);
        expect(code.split(SCRIPT_BODY_MARKER)).toHaveLength(2);
        expect({
          at: `${templateId} ${node.componentId}`,
          sameHelpers: helperBlock(code) === first,
        }).toEqual({
          at: `${templateId} ${node.componentId}`,
          sameHelpers: true,
        });
      }
    },
  );

  /*
   * One helper block, written once for both kinds: the alert version is the
   * incident version with the record's name swapped, and nothing else — bar
   * the line listing every kind's label prefix, which is identical in both.
   */
  test("the alert set's helper block is the incident set's, with the record's name swapped", () => {
    expect(kindHelpers(ALERT)).toBe(asAlert(kindHelpers(INCIDENT)));
    expect(kindHelpers(ALERT)).not.toBe(kindHelpers(INCIDENT));
  });

  test.each(KINDS)(
    "$noun: the helper block's markers and labels are the exported constants",
    (kind: RecordKind) => {
      const helpers: string = kindHelpers(kind);

      expect(helpers).toContain(
        `\nconst FROM_ONEUPTIME = ${JSON.stringify(JIRA_SYNCED_FROM_ONEUPTIME_MARKER)};\n`,
      );
      expect(helpers).toContain(
        `\nconst FROM_JIRA = ${JSON.stringify(ONEUPTIME_SYNCED_FROM_JIRA_MARKER)};\n`,
      );
      expect(helpers).toContain(
        `\nconst LINK_LABEL = ${JSON.stringify(JIRA_LINK_LABEL)};\n`,
      );
      expect(helpers).toContain(
        `\nconst ${kind.upper}_LABEL_PREFIX = ${JSON.stringify(kind.labelPrefix)};\n`,
      );
      expect(helpers).toContain(
        `\nconst LINKED_LABEL_PREFIXES = ${JSON.stringify([
          JIRA_INCIDENT_LABEL_PREFIX,
          JIRA_ALERT_LABEL_PREFIX,
        ])};\n`,
      );
    },
  );

  /*
   * Each script finds its own kind's record by its own kind's label, and
   * counts an issue carrying either kind's label as already linked — which is
   * what keeps an issue filed for an alert from also becoming an incident.
   */
  test("every script's helper block declares its own kind's label prefix, and lists both kinds' as linked", () => {
    for (const { templateId, node } of scripts) {
      const kind: RecordKind = kindOf(templateId);
      const helpers: string = helperBlock(textArg(node, "code"));
      const at: string = `${templateId} ${node.componentId}`;

      expect({
        at: at,
        ownPrefix: helpers.includes(
          `\nconst ${kind.upper}_LABEL_PREFIX = ${JSON.stringify(kind.labelPrefix)};\n`,
        ),
        otherPrefix: helpers.includes(`${otherKind(kind).upper}_LABEL_PREFIX`),
        linkedPrefixes: helpers.includes(
          `\n${LINKED_LABEL_PREFIXES_DECLARATION}\n`,
        ),
      }).toEqual({
        at: at,
        ownPrefix: true,
        otherPrefix: false,
        linkedPrefixes: true,
      });
    }
  });

  /*
   * The values are part of the contract with data already in people's Jira
   * sites: an issue labelled by one release has to be found by the next.
   */
  test("the markers and labels have the values issues are already labelled with", () => {
    expect(JIRA_SYNCED_FROM_ONEUPTIME_MARKER).toBe("Synced from OneUptime");
    expect(ONEUPTIME_SYNCED_FROM_JIRA_MARKER).toBe("Synced from Jira");
    expect(JIRA_LINK_LABEL).toBe("oneuptime");
    expect(JIRA_INCIDENT_LABEL_PREFIX).toBe("oneuptime-incident-");
    expect(JIRA_ALERT_LABEL_PREFIX).toBe("oneuptime-alert-");
  });

  /*
   * Each direction skips text that carries the other side's marker. A marker
   * that contained the other would make a side skip its own writes.
   */
  test("each side's marker is one the other side cannot mistake for its own", () => {
    expect(JIRA_SYNCED_FROM_ONEUPTIME_MARKER).not.toContain(
      ONEUPTIME_SYNCED_FROM_JIRA_MARKER,
    );
    expect(ONEUPTIME_SYNCED_FROM_JIRA_MARKER).not.toContain(
      JIRA_SYNCED_FROM_ONEUPTIME_MARKER,
    );
  });

  // Jira labels cannot hold spaces and stop at 255 characters.
  test.each(KINDS)(
    "$noun: the link labels are valid Jira labels with a 36-character id on the end",
    (kind: RecordKind) => {
      expect(JIRA_LINK_LABEL).toMatch(/^[a-z0-9-]+$/);
      expect(kind.labelPrefix).toMatch(/^[a-z0-9-]+-$/);
      expect(kind.labelPrefix.length + 36).toBeLessThanOrEqual(255);
    },
  );

  test("every script reads exactly the arguments it is given", () => {
    for (const { templateId, node } of scripts) {
      const body: string = scriptBody(textArg(node, "code"));
      const read: Array<string> = Array.from(
        new Set(
          (body.match(/\bargs\.[A-Za-z_$][\w$]*/g) || []).map(
            (match: string) => {
              return match.slice("args.".length);
            },
          ),
        ),
      ).sort();
      const at: string = `${templateId} ${node.componentId}`;
      const argumentsValue: JSONValue | undefined = node.args?.["arguments"];

      // Handed the whole webhook body, the script reads it as `args` itself.
      if (wholeReference(argumentsValue)) {
        expect({
          at: at,
          read: read,
          readsWhole: body.includes("readJson(args)"),
        }).toEqual({
          at: at,
          read: [],
          readsWhole: true,
        });
        continue;
      }

      const given: JSONObject = jsonArg(node, "arguments");

      expect({ at: at, read: read }).toEqual({
        at: at,
        read: Object.keys(given).sort(),
      });

      for (const [key, value] of Object.entries(given)) {
        expect({
          at: `${at} ${key}`,
          whole: Boolean(wholeReference(value)),
        }).toEqual({
          at: `${at} ${key}`,
          whole: true,
        });
      }
    }
  });

  test("every script can decide either way", () => {
    for (const { templateId, node } of scripts) {
      const body: string = scriptBody(textArg(node, "code"));

      expect({
        at: `${templateId} ${node.componentId}`,
        canProceed: body.includes("proceed: true"),
        canSkip: body.includes("return skip("),
      }).toEqual({
        at: `${templateId} ${node.componentId}`,
        canProceed: true,
        canSkip: true,
      });
    }

    for (const kind of KINDS) {
      expect(kindHelpers(kind)).toContain(
        /*
         * A reason can quote Jira's text (an event name, a status name), so it
         * is defused on the way out like every other returned string.
         */
        "const skip = (reason) => ({ proceed: false, reason: defuse(asText(reason)) });",
      );
    }
  });

  test.each(
    RECORD_READS.map((read: RecordRead) => {
      return [`${read.templateId} ${read.scriptId} ${read.argumentKey}`, read];
    }) as Array<[string, RecordRead]>,
  )(
    "%s: every field the script reads was asked for in the record's select",
    (_label: string, read: RecordRead) => {
      const script: TemplateNodeSpec = nodeOf(read.templateId, read.scriptId);
      // The whole script: helpers read fields too, e.g. displayName reads name.
      const code: string = textArg(script, "code");
      const reference: string | null = wholeReference(
        jsonArg(script, "arguments")[read.argumentKey],
      );

      expect(reference).not.toBeNull();

      const parsed: ParsedReferencePath = parseReferencePath(
        (reference as string).slice(2, -2),
      );
      const source: TemplateNodeSpec = nodeOf(
        read.templateId,
        parsed.componentId as string,
      );

      expect(["model", "models"]).toContain(parsed.returnValueId);

      for (const field of read.fields) {
        const path: Array<string> = field.split(".");

        expect({
          field: field,
          selected: selectHas(source.args?.["select"], path),
          readByScript: path.every((segment: string) => {
            return new RegExp(`\\b${segment}\\b`).test(code);
          }),
        }).toEqual({ field: field, selected: true, readByScript: true });
      }
    },
  );

  /*
   * Each kind has its own switch — SYNC_PRIVATE_INCIDENTS, SYNC_PRIVATE_ALERTS
   * — in each of its OneUptime -> Jira scripts, and in no other script.
   */
  test("each kind's private switch is in every one of its OneUptime -> Jira scripts, and only there", () => {
    const switches: Record<string, Array<string>> = {};
    const expected: Record<string, Array<string>> = {};

    for (const { templateId, node } of scripts) {
      const at: string = `${templateId} ${node.componentId}`;

      switches[at] = Array.from(
        new Set(textArg(node, "code").match(/\bSYNC_PRIVATE_[A-Z_]+\b/g) || []),
      );
      expected[at] = ONEUPTIME_TO_JIRA_TEMPLATE_IDS.includes(templateId)
        ? [`SYNC_PRIVATE_${kindOf(templateId).pluralUpper}`]
        : [];
    }

    expect(switches).toEqual(expected);
    expect(
      PRIVATE_RECORD_CHECKS.map((check: PrivateRecordCheck) => {
        return `${check.templateId} ${check.scriptId}`;
      }),
    ).toEqual(
      scripts
        .filter(({ templateId }: JiraNode) => {
          return ONEUPTIME_TO_JIRA_TEMPLATE_IDS.includes(templateId);
        })
        .map(({ templateId, node }: JiraNode) => {
          return `${templateId} ${node.componentId}`;
        }),
    );
  });

  /*
   * Off by default, and one documented line to turn on: the check reads a
   * flag the trigger was asked for, skips before the script finds the issue
   * or builds anything, and the switch is read nowhere else — so setting it
   * to true lets private records through and changes nothing more.
   */
  test.each(
    PRIVATE_RECORD_CHECKS.map((check: PrivateRecordCheck) => {
      return [`${check.templateId} ${check.scriptId}`, check];
    }) as Array<[string, PrivateRecordCheck]>,
  )(
    "%s keeps a private record in OneUptime unless its switch is set",
    (_label: string, check: PrivateRecordCheck) => {
      const script: TemplateNodeSpec = nodeOf(check.templateId, check.scriptId);
      const body: string = scriptBody(textArg(script, "code"));
      const declaration: number = indexOrFail(
        body,
        `\nconst ${check.flag} = false;\n`,
      );
      const lineBefore: string =
        body.slice(0, declaration).split("\n").pop() || "";
      const guard: number = indexOrFail(
        body,
        `if (${check.condition}) {\n  return skip(`,
      );

      expect(body.split(check.flag)).toHaveLength(3);
      expect(lineBefore).toMatch(/^\/\/ .*[Pp]rivate.*Set this to true/);
      expect(declaration).toBeLessThan(guard);

      for (const later of check.checkedBefore) {
        expect({
          code: later,
          afterTheCheck: guard < indexOrFail(body, later),
        }).toEqual({ code: later, afterTheCheck: true });
      }

      // The flag it reads was asked for on the record the script is handed.
      const reference: string | null = wholeReference(
        jsonArg(script, "arguments")[check.argumentKey],
      );

      expect(reference).not.toBeNull();

      const source: TemplateNodeSpec = nodeOf(
        check.templateId,
        parseReferencePath((reference as string).slice(2, -2))
          .componentId as string,
      );

      expect(source.componentId).toBe(triggerOf(check.templateId).componentId);
      expect(selectHas(source.args?.["select"], check.selectPath)).toBe(true);
    },
  );

  /*
   * Every write in one direction is an event in the other. Text each side
   * writes starts with its marker, and the template going the other way skips
   * text that carries it — this pins the stamping and the skipping, per step.
   */
  test.each(KINDS)(
    "$noun: comments written into Jira carry the OneUptime marker, and notes and reasons written from Jira carry the Jira marker",
    (kind: RecordKind) => {
      for (const templateId of commentTemplateIds(kind)) {
        expect(scriptBody(scriptCode(templateId, "build-comment-1"))).toContain(
          "FROM_ONEUPTIME + ",
        );
      }

      expect(
        jsonArg(nodeOf(kind.templates.statusToState, "change-state-1"), "json")[
          "rootCause"
        ],
      ).toBe(scriptOutput("decide-state-1", "rootCause"));
      expect(
        scriptBody(scriptCode(kind.templates.statusToState, "decide-state-1")),
      ).toContain("defuse(FROM_JIRA + ");

      for (const [templateId, scriptId] of [
        [kind.templates.commentToNote, "read-comment-1"],
        [kind.templates.issueChangesToNote, "read-changes-1"],
      ] as Array<[string, string]>) {
        expect(
          jsonArg(nodeOf(templateId, "create-note-1"), "json")["note"],
        ).toBe(scriptOutput(scriptId, "note"));
        expect(scriptBody(scriptCode(templateId, scriptId))).toContain(
          "defuse(FROM_JIRA + ",
        );
      }
    },
  );

  test.each(KINDS)(
    "$noun: each direction skips text carrying the other side's marker",
    (kind: RecordKind) => {
      for (const templateId of noteToCommentIds(kind)) {
        expect(scriptBody(scriptCode(templateId, "build-comment-1"))).toContain(
          "indexOf(FROM_JIRA) !== -1",
        );
      }

      expect(
        scriptBody(scriptCode(kind.templates.commentToNote, "read-comment-1")),
      ).toContain("indexOf(FROM_ONEUPTIME) !== -1");
    },
  );

  /*
   * The create template writes the label from the record's id, and the other
   * templates search for exactly that label. Both go through the one prefix
   * constant.
   */
  test.each(KINDS)(
    "$noun: the issue label is the prefix and the $noun's id, wherever it is made",
    (kind: RecordKind) => {
      const r: string = kind.noun;
      const prepare: string = scriptBody(
        scriptCode(kind.templates.createIssue, "prepare-issue-1"),
      );

      expect(prepare).toContain(`${r}Label: ${kind.upper}_LABEL_PREFIX + `);
      expect(prepare).toContain(`UUID.test(asText(${r}._id))`);

      for (const [templateId, scriptId] of [
        [kind.templates.statusToState, "read-event-1"],
        [kind.templates.issueChangesToNote, "read-changes-1"],
      ] as Array<[string, string]>) {
        expect(scriptBody(scriptCode(templateId, scriptId))).toContain(
          `${r}IdFromLabels(fields.labels)`,
        );
      }

      expect(
        scriptBody(scriptCode(kind.templates.commentToNote, "find-link-1")),
      ).toContain(`${r}IdFromLabels(issue.fields && issue.fields.labels)`);
    },
  );

  /*
   * The issue's link back goes to the record's own page on the dashboard:
   * /incidents/ for an incident, /alerts/ for an alert. The project id it
   * needs is asked for in the trigger's select (see the record reads above).
   */
  test.each(KINDS)(
    "$noun: the issue links back to the $noun's page on the dashboard",
    (kind: RecordKind) => {
      const r: string = kind.noun;
      const prepare: string = scriptBody(
        scriptCode(kind.templates.createIssue, "prepare-issue-1"),
      );

      expect(prepare).toContain(
        `${r}Url: oneUptimeUrl + '/dashboard/' + valueOf(${r}.projectId) + '/${kind.dashboardPath}/' + asText(${r}._id),`,
      );
      expect(prepare).not.toContain(`'/${otherKind(kind).dashboardPath}/'`);
    },
  );

  /*
   * A record made from Jira already has an issue. The create-from-issue
   * template records the key in customFields.jiraIssueKey, and the create
   * template reads that same key — through a select that has to ask for
   * customFields.
   */
  test.each(KINDS)(
    "$noun: the create template skips a $noun made from Jira, by the key it was made with",
    (kind: RecordKind) => {
      const created: JSONObject = jsonArg(
        nodeOf(kind.templates.createFromIssue, kind.steps.createRecord),
        "json",
      );

      expect(created["customFields"]).toEqual({
        jiraIssueKey: scriptOutput(kind.steps.prepareRecord, "issueKey"),
      });
      expect(
        scriptBody(scriptCode(kind.templates.createIssue, "prepare-issue-1")),
      ).toContain("asText(customFields.jiraIssueKey)");
      expect(triggerOf(kind.templates.createIssue).args?.["select"]).toEqual(
        expect.objectContaining({ customFields: true }),
      );
    },
  );
});

describe("Jira template branching", () => {
  test("every script is followed by an If / Else on its own proceed flag", () => {
    for (const { templateId, node } of jiraNodes(isScriptNode)) {
      const next: Array<string> = targetsOf(
        templateId,
        node.componentId,
        "success",
      );

      expect({
        at: `${templateId} ${node.componentId}`,
        next: next.length,
      }).toEqual({
        at: `${templateId} ${node.componentId}`,
        next: 1,
      });

      const decision: TemplateNodeSpec = nodeOf(templateId, next[0] as string);

      expect({
        at: `${templateId} ${decision.componentId}`,
        metadataId: decision.metadataId,
        args: decision.args,
      }).toEqual({
        at: `${templateId} ${decision.componentId}`,
        metadataId: ComponentID.IfElse,
        args: proceedCondition(node.componentId),
      });
    }
  });

  /*
   * Find One answers "nothing matched" on its Success port with a null model,
   * so the found check is the one If / Else that does not act on a script. It
   * compares the id OneUptime returned with the one the label named, which is
   * what stops a label naming another project's record from being written to.
   */
  test("the only other If / Else is the found-record check before a note is written", () => {
    const others: Array<string> = [];

    for (const { templateId, node } of jiraNodes(isIfElseNode)) {
      const isProceedCheck: boolean = jiraNodes(isScriptNode).some(
        ({ templateId: scriptTemplateId, node: script }: JiraNode) => {
          return (
            scriptTemplateId === templateId &&
            targetsOf(templateId, script.componentId, "success").includes(
              node.componentId,
            )
          );
        },
      );

      if (!isProceedCheck) {
        others.push(`${templateId} ${node.componentId}`);
      }
    }

    expect(others).toEqual(
      KINDS.flatMap((kind: RecordKind) => {
        return [
          `${kind.templates.commentToNote} if-found-1`,
          `${kind.templates.issueChangesToNote} if-found-1`,
        ];
      }),
    );

    for (const kind of KINDS) {
      const find: string = kind.steps.findRecord;

      for (const [templateId, linkingScriptId] of [
        [kind.templates.commentToNote, "find-link-1"],
        [kind.templates.issueChangesToNote, "read-changes-1"],
      ] as Array<[string, string]>) {
        expect(nodeOf(templateId, "if-found-1").args).toEqual({
          "input-1-type": ConditionValueType.Text,
          "input-1": componentReturnValueReference(find, "model", ["_id"]),
          operator: ConditionOperator.EqualTo,
          "input-2-type": ConditionValueType.Text,
          "input-2": scriptOutput(linkingScriptId, `${kind.noun}Id`),
        });
        expect(targetsOf(templateId, find, "success")).toEqual(["if-found-1"]);
        expect(targetsOf(templateId, "if-found-1", "yes")).toEqual([
          "create-note-1",
        ]);
        expect(
          isLogNode(
            nodeOf(
              templateId,
              targetsOf(templateId, "if-found-1", "no")[0] as string,
            ),
          ),
        ).toBe(true);
      }
    }
  });

  test("a skipped run logs the script's reason", () => {
    for (const { templateId, node } of jiraNodes(isScriptNode)) {
      const decision: string = targetsOf(
        templateId,
        node.componentId,
        "success",
      )[0] as string;
      const skipped: Array<string> = targetsOf(templateId, decision, "no");

      expect(skipped).toHaveLength(1);

      const log: TemplateNodeSpec = nodeOf(templateId, skipped[0] as string);

      expect({
        at: `${templateId} ${log.componentId}`,
        isLog: isLogNode(log),
        value: log.args?.["value"],
      }).toEqual({
        at: `${templateId} ${log.componentId}`,
        isLog: true,
        value: `ℹ️ ${scriptOutput(node.componentId, "reason")}`,
      });
    }
  });

  test("a failed script logs the script's error", () => {
    for (const { templateId, node } of jiraNodes(isScriptNode)) {
      const failed: Array<string> = targetsOf(
        templateId,
        node.componentId,
        "error",
      );

      expect(failed).toHaveLength(1);

      const log: TemplateNodeSpec = nodeOf(templateId, failed[0] as string);

      expect(isLogNode(log)).toBe(true);
      expect(textArg(log, "value")).toContain(
        componentReturnValueReference(node.componentId, "error"),
      );
    }
  });

  /*
   * For a Jira error body the API step's `error` is only "Server Error." —
   * what went wrong is in the response body, so a failure log needs both.
   */
  test("a failed Jira call logs the error and what Jira said", () => {
    for (const { templateId, node } of jiraNodes(isApiNode)) {
      const failed: Array<string> = targetsOf(
        templateId,
        node.componentId,
        "error",
      );

      expect(failed).toHaveLength(1);

      const log: TemplateNodeSpec = nodeOf(templateId, failed[0] as string);
      const value: string = textArg(log, "value");

      expect(isLogNode(log)).toBe(true);
      expect(value).toContain(
        componentReturnValueReference(node.componentId, "error"),
      );
      expect(value).toContain(
        componentReturnValueReference(node.componentId, "response-body"),
      );
    }
  });

  /*
   * A database step that fails returns nothing on its Error port — the error
   * goes to the run log — so its failure log can only point there.
   */
  test("a failed database step's log points at the run log instead of quoting the step", () => {
    for (const { templateId, node } of jiraNodes(
      (candidate: TemplateNodeSpec) => {
        return (
          isDatabaseNode(candidate) &&
          candidate.componentType !== ComponentType.Trigger
        );
      },
    )) {
      const failed: Array<string> = targetsOf(
        templateId,
        node.componentId,
        "error",
      );

      expect(failed).toHaveLength(1);

      const log: TemplateNodeSpec = nodeOf(templateId, failed[0] as string);
      const value: string = textArg(log, "value");

      expect(isLogNode(log)).toBe(true);
      expect(value).toContain("run log");
      expect(value).not.toContain(`local.components.${node.componentId}.`);
    }
  });

  /*
   * What runs regardless of the event can read, but must not change either
   * side: every write to Jira or to OneUptime waits behind an If / Else.
   */
  test("nothing writes to Jira or OneUptime before an If / Else says yes", () => {
    const writes: Array<string> = [];
    const ungatedWrites: Array<string> = [];

    for (const templateId of JIRA_TEMPLATE_IDS) {
      const ungated: Array<string> = ungatedNodes(templateId);

      for (const node of specOf(templateId).nodes) {
        if (!isJiraWrite(node) && !isDatabaseWrite(node)) {
          continue;
        }

        writes.push(`${templateId} ${node.componentId}`);

        if (ungated.includes(node.componentId)) {
          ungatedWrites.push(`${templateId} ${node.componentId}`);
        }
      }
    }

    expect(ungatedWrites).toEqual([]);
    // Every template writes somewhere, so the check above had something to check.
    expect(writes.length).toBeGreaterThanOrEqual(JIRA_TEMPLATE_IDS.length);
  });

  test.each(JIRA_TEMPLATE_IDS)(
    "%s is wired exactly as documented",
    (templateId: string) => {
      const expected: ExpectedGraph = lookup(EXPECTED_GRAPHS, templateId);
      const spec: TemplateSpec = specOf(templateId);
      const nodes: Record<string, string> = {};

      for (const node of spec.nodes) {
        nodes[node.componentId] = node.metadataId;
      }

      expect(nodes).toEqual(expected.nodes);
      expect(
        spec.edges
          .map((edge: TemplateEdgeSpec) => {
            return `${edge.fromComponentId}:${edge.fromPort}->${edge.toComponentId}`;
          })
          .sort(),
      ).toEqual([...expected.edges].sort());
    },
  );

  test("the documented graphs cover exactly the seventeen", () => {
    expect(Object.keys(EXPECTED_GRAPHS).sort()).toEqual(
      [...JIRA_TEMPLATE_IDS].sort(),
    );
  });
});

describe("Jira webhook templates", () => {
  test("each leaves the webhook by its out port, into exactly one step", () => {
    for (const templateId of JIRA_TO_ONEUPTIME_TEMPLATE_IDS) {
      const ports: Array<string> = specOf(templateId)
        .edges.filter((edge: TemplateEdgeSpec) => {
          return edge.fromComponentId === "webhook-1";
        })
        .map((edge: TemplateEdgeSpec) => {
          return edge.fromPort;
        });

      expect({ templateId: templateId, ports: ports }).toEqual({
        templateId: templateId,
        ports: ["out"],
      });
    }
  });

  /*
   * Anyone who has the URL can post to a webhook. So before anything talks to
   * Jira or the database, a script reads the event and decides. The one
   * exception is the create-from-issue template's read of this project's
   * severities, which does not depend on the payload and which the script
   * needs to choose one.
   */
  test("nothing touches Jira or the database before a script has read the event, but the severity read", () => {
    const ungated: Record<string, Array<string>> = {};

    for (const templateId of JIRA_TO_ONEUPTIME_TEMPLATE_IDS) {
      ungated[templateId] = ungatedNodes(templateId).filter(
        (componentId: string) => {
          return !isLogNode(nodeOf(templateId, componentId));
        },
      );
    }

    expect(ungated).toEqual(
      perKind((kind: RecordKind): Record<string, Array<string>> => {
        return {
          [kind.templates.createFromIssue]: [
            "webhook-1",
            "find-severities-1",
            kind.steps.prepareRecord,
            kind.steps.decideCreate,
          ],
          [kind.templates.statusToState]: [
            "webhook-1",
            "read-event-1",
            "if-status-changed-1",
          ],
          [kind.templates.commentToNote]: [
            "webhook-1",
            "read-comment-1",
            "if-comment-1",
          ],
          [kind.templates.issueChangesToNote]: [
            "webhook-1",
            "read-changes-1",
            "if-changed-1",
          ],
        };
      }),
    );
  });

  test("the first step after the webhook reads the event, but the create-from-issue template's severity read", () => {
    for (const templateId of JIRA_TO_ONEUPTIME_TEMPLATE_IDS) {
      const kind: RecordKind = kindOf(templateId);
      const first: TemplateNodeSpec = nodeOf(
        templateId,
        targetsOf(templateId, "webhook-1", "out")[0] as string,
      );

      if (templateId !== kind.templates.createFromIssue) {
        expect({ templateId: templateId, first: first.metadataId }).toEqual({
          templateId: templateId,
          first: ComponentID.JavaScriptCode,
        });
        continue;
      }

      expect(first.metadataId).toBe(`${kind.noun}-severity-find-many`);
      expect(referencesIn(argumentText(first.args))).toEqual([]);
      expect(
        nodeOf(
          templateId,
          targetsOf(templateId, first.componentId, "success")[0] as string,
        ).metadataId,
      ).toBe(ComponentID.JavaScriptCode);
    }
  });

  /*
   * A whole-argument reference to the request body hands the script the
   * parsed object itself, so no Jira text is substituted into JSON text at
   * all. The create-from-issue script also needs the severities, so it quotes
   * the body — last.
   */
  test.each(KINDS)(
    "$noun: the event script is handed the webhook body whole, or quoted last",
    (kind: RecordKind) => {
      const body: string = componentReturnValueReference(
        "webhook-1",
        "request-body",
      );

      for (const [templateId, scriptId] of [
        [kind.templates.statusToState, "read-event-1"],
        [kind.templates.commentToNote, "read-comment-1"],
        [kind.templates.issueChangesToNote, "read-changes-1"],
      ] as Array<[string, string]>) {
        expect(nodeOf(templateId, scriptId).args?.["arguments"]).toBe(body);
      }

      const createArguments: JSONObject = jsonArg(
        nodeOf(kind.templates.createFromIssue, kind.steps.prepareRecord),
        "arguments",
      );

      expect(Object.keys(createArguments)).toEqual(["severities", "payload"]);
      expect(createArguments["payload"]).toBe(body);
    },
  );
});

describe.each(KINDS)(
  "the $noun create-from-issue template's check with Jira",
  (kind: RecordKind) => {
    const templateId: string = kind.templates.createFromIssue;
    const create: string = kind.steps.createRecord;

    /*
     * Anyone holding the workflow's URL can post an issue_created event for
     * any issue, labels and all, and Jira retries a delivery after the first
     * one has already labelled the issue. So the webhook's word is not taken:
     * the only route to the record runs through Jira's own answer.
     */
    test("the only route from the webhook to the record runs through Jira's answer and its check", () => {
      expect(routesBetween(templateId, "webhook-1", create)).toEqual([
        routeToRecord(kind),
      ]);
    });

    test("every write the template makes, to either side, is behind that check", () => {
      const writes: Array<string> = specOf(templateId)
        .nodes.filter((node: TemplateNodeSpec) => {
          return isJiraWrite(node) || isDatabaseWrite(node);
        })
        .map((node: TemplateNodeSpec) => {
          return node.componentId;
        });

      expect(writes).toEqual([create, "link-issue-1"]);

      for (const write of writes) {
        const routes: Array<string> = routesBetween(
          templateId,
          "webhook-1",
          write,
        );

        expect(routes.length).toBeGreaterThan(0);

        for (const route of routes) {
          expect({
            write: write,
            route: route,
            checked: route.includes(JIRA_SIDE_CHECK),
          }).toEqual({ write: write, route: route, checked: true });
        }
      }

      expect(routesBetween(templateId, "webhook-1", "link-issue-1")).toEqual([
        `${routeToRecord(kind)}:success->link-issue-1`,
      ]);
    });

    /*
     * Removing any one step of the check must cut the webhook off from the
     * record — the same claim as the single route above, said the way a later
     * edit that adds a shortcut edge would break it.
     */
    test("taking out any step of the check leaves no way to the record", () => {
      const spec: TemplateSpec = specOf(templateId);
      const reachesWrites: Record<string, boolean> = {};

      // The step off the route is the control: without it the walk proves nothing.
      for (const removed of [
        "log-skipped",
        "get-issue-1",
        "confirm-unlinked-1",
        "if-unlinked-1",
      ]) {
        const reached: Set<string> = new Set(["webhook-1"]);
        const queue: Array<string> = ["webhook-1"];

        while (queue.length > 0) {
          const current: string = queue.shift() as string;

          for (const edge of spec.edges) {
            if (
              edge.fromComponentId === current &&
              edge.toComponentId !== removed &&
              !reached.has(edge.toComponentId)
            ) {
              reached.add(edge.toComponentId);
              queue.push(edge.toComponentId);
            }
          }
        }

        reachesWrites[removed] =
          reached.has(create) || reached.has("link-issue-1");
      }

      expect(reachesWrites).toEqual({
        "log-skipped": true,
        "get-issue-1": false,
        "confirm-unlinked-1": false,
        "if-unlinked-1": false,
      });
    });

    test("the check asks Jira for the labels of the issue the event script checked", () => {
      const get: TemplateNodeSpec = nodeOf(templateId, "get-issue-1");

      expect(get.metadataId).toBe(ComponentID.ApiGet);
      expect(textArg(get, "url")).toBe(
        `${REST}/issue/${scriptOutput(kind.steps.prepareRecord, "issueKey")}?fields=labels`,
      );
      expect(get.args?.["request-headers"]).toEqual({
        Authorization: AUTHORIZATION,
      });
      expect(get.args?.["request-body"]).toBeUndefined();
    });

    /*
     * The script reads Jira's answer and nothing else — not the webhook, whose
     * labels are the ones being doubted — and only says go once the answer
     * names a real issue that carries no link label of either kind.
     */
    test("the check reads only Jira's answer, and proceeds only for a real, unlinked issue", () => {
      const confirm: TemplateNodeSpec = nodeOf(
        templateId,
        "confirm-unlinked-1",
      );
      const body: string = scriptBody(textArg(confirm, "code"));

      expect(jsonArg(confirm, "arguments")).toEqual({
        issue: componentReturnValueReference("get-issue-1", "response-body"),
      });
      expect(body).toContain("const issue = readJson(args.issue) || {};");
      expect(body).toContain("const issueKey = asText(issue.key);");

      const keyChecked: number = indexOrFail(
        body,
        "if (!ISSUE_KEY.test(issueKey)) return skip(",
      );
      const labelsChecked: number = indexOrFail(
        body,
        "if (isLinked(issue.fields && issue.fields.labels)) {\n  return skip(",
      );
      const proceeds: number = indexOrFail(body, "proceed: true");

      expect(keyChecked).toBeLessThan(labelsChecked);
      expect(labelsChecked).toBeLessThan(proceeds);
      expect(body.split("proceed: true")).toHaveLength(2);

      // The same helper decides "linked" on both sides of the check.
      expect(
        scriptBody(scriptCode(templateId, kind.steps.prepareRecord)),
      ).toContain("if (isLinked(fields.labels)) {");
      expect(nodeOf(templateId, "if-unlinked-1").args).toEqual(
        proceedCondition("confirm-unlinked-1"),
      );
    });

    /*
     * A check that cannot be made is a no: an issue Jira will not return, a
     * script that throws, or labels that say the issue is linked all end in a
     * log and nothing else.
     */
    test("when Jira cannot be asked, or says the issue is linked, the run ends in a log", () => {
      for (const [from, port] of [
        ["get-issue-1", "error"],
        ["confirm-unlinked-1", "error"],
        ["if-unlinked-1", "no"],
      ] as Array<[string, string]>) {
        const next: Array<string> = targetsOf(templateId, from, port);

        expect(next).toHaveLength(1);

        const log: TemplateNodeSpec = nodeOf(templateId, next[0] as string);

        expect({
          at: `${from}:${port}`,
          isLog: isLogNode(log),
          leadsOn: specOf(templateId).edges.some((edge: TemplateEdgeSpec) => {
            return edge.fromComponentId === log.componentId;
          }),
        }).toEqual({ at: `${from}:${port}`, isLog: true, leadsOn: false });
      }

      expect(textArg(nodeOf(templateId, "log-already-linked"), "value")).toBe(
        `ℹ️ ${scriptOutput("confirm-unlinked-1", "reason")}`,
      );
      expect(
        textArg(nodeOf(templateId, "log-get-issue-failed"), "value"),
      ).toContain(`no ${kind.noun} was ${kind.created}`);
    });
  },
);

describe("Jira template triggers", () => {
  test("each template starts from the trigger it documents", () => {
    const triggers: Record<string, ExpectedTrigger> = {};

    for (const templateId of JIRA_TEMPLATE_IDS) {
      const trigger: TemplateNodeSpec = triggerOf(templateId);

      triggers[templateId] = {
        componentId: trigger.componentId,
        metadataId: trigger.metadataId,
      };
    }

    expect(triggers).toEqual(EXPECTED_TRIGGERS);
  });

  test.each(KINDS)(
    "$noun: the transition template listens only for a change of state",
    (kind: RecordKind) => {
      expect(
        triggerOf(kind.templates.transitionIssue).args?.["listen-on"],
      ).toEqual({ [kind.stateIdColumn]: true });
    },
  );

  /*
   * The transition template already answers a state change. Listening on
   * state here too would post a comment for every transition as well.
   */
  test.each(KINDS)(
    "$noun: the edit-comment template listens on the edited fields and never on state",
    (kind: RecordKind) => {
      const listenOn: JSONValue | undefined = triggerOf(
        kind.templates.updateComment,
      ).args?.["listen-on"];

      expect(listenOn).toEqual(kind.editListenOn);
      expect(listenOn).not.toHaveProperty(kind.stateIdColumn);
      expect(listenOn).not.toHaveProperty(kind.stateRelation);
    },
  );

  /*
   * The dashboard's edit form sends the severity as its relation, and Listen
   * On compares the keys it is sent exactly — so listening on the id alone
   * would miss a severity changed in the dashboard.
   */
  test.each(KINDS)(
    "$noun: the edit-comment template listens on the severity's relation as well as its id",
    (kind: RecordKind) => {
      const listenOn: JSONValue | undefined = triggerOf(
        kind.templates.updateComment,
      ).args?.["listen-on"];

      expect(listenOn).toHaveProperty(kind.severityIdColumn, true);
      expect(listenOn).toHaveProperty(kind.severityRelation, true);
    },
  );

  /*
   * Listening for an edit nobody is allowed to make is dead weight, and not
   * listening for one somebody can make is a comment that never comes. The
   * alert's root cause is the case in point: it is set when the alert is
   * created and never again, so the alert version leaves it out.
   */
  test.each(KINDS)(
    "$noun: a field the edit comment shows is listened on exactly when someone can edit it",
    (kind: RecordKind) => {
      const listenOn: JSONObject = triggerOf(kind.templates.updateComment)
        .args?.["listen-on"] as JSONObject;
      const model: BaseModel = new kind.model();

      for (const field of [
        "title",
        "description",
        kind.severityIdColumn,
        kind.severityRelation,
        "rootCause",
        "remediationNotes",
      ]) {
        expect({ field: field, listened: listenOn[field] === true }).toEqual({
          field: field,
          listened: canBeEdited(model, field),
        });
      }
    },
  );

  test("an alert's root cause is still in the edit comment, though nothing listens for it", () => {
    const templateId: string = ALERT.templates.updateComment;
    const trigger: TemplateNodeSpec = triggerOf(templateId);

    expect(canBeEdited(new Alert(), "rootCause")).toBe(false);
    expect(trigger.args?.["listen-on"]).not.toHaveProperty("rootCause");
    expect(selectHas(trigger.args?.["select"], ["rootCause"])).toBe(true);
    expect(scriptBody(scriptCode(templateId, "build-comment-1"))).toContain(
      "add('Root cause', alert.rootCause, 5000);",
    );

    // An incident's root cause can be edited, so there it is listened for.
    expect(canBeEdited(new Incident(), "rootCause")).toBe(true);
    expect(
      triggerOf(INCIDENT.templates.updateComment).args?.["listen-on"],
    ).toHaveProperty("rootCause", true);
  });

  /*
   * The card and the created workflow's description tell the user which
   * edits post a comment, so they list exactly the fields listened for.
   */
  test.each(KINDS)(
    "$noun: the edit-comment template's descriptions name exactly the edits it listens for",
    (kind: RecordKind) => {
      const template: WorkflowTemplate = templateOf(
        kind.templates.updateComment,
      );
      const listenOn: JSONObject = triggerOf(kind.templates.updateComment)
        .args?.["listen-on"] as JSONObject;
      const fieldsByWord: Record<string, Array<string>> = {
        title: ["title"],
        severity: [kind.severityIdColumn, kind.severityRelation],
        description: ["description"],
        "root cause": ["rootCause"],
        "remediation notes": ["remediationNotes"],
      };

      for (const [word, fields] of Object.entries(fieldsByWord)) {
        const listened: boolean = fields.some((field: string) => {
          return listenOn[field] === true;
        });

        expect({
          word: word,
          inDescription: template.description.includes(word),
          inWorkflowDescription: template.workflowDescription.includes(word),
        }).toEqual({
          word: word,
          inDescription: listened,
          inWorkflowDescription: listened,
        });
      }

      // And nothing is listened for that the descriptions have no word for.
      expect(Object.keys(listenOn).sort()).toEqual(
        Object.values(fieldsByWord)
          .flat()
          .filter((field: string) => {
            return listenOn[field] === true;
          })
          .sort(),
      );
    },
  );

  test("of all the Jira templates, only the transition templates react to a state change", () => {
    const stateColumns: Array<string> = KINDS.map((kind: RecordKind) => {
      return kind.stateIdColumn;
    });
    const listening: Array<string> = JIRA_TEMPLATE_IDS.filter(
      (templateId: string) => {
        const listenOn: JSONValue | undefined =
          triggerOf(templateId).args?.["listen-on"];

        return Boolean(
          listenOn &&
            typeof listenOn === "object" &&
            stateColumns.some((column: string) => {
              return (listenOn as JSONObject)[column];
            }),
        );
      },
    );

    expect(listening).toEqual(
      KINDS.map((kind: RecordKind) => {
        return kind.templates.transitionIssue;
      }),
    );
  });

  /*
   * The update trigger hands over the record as it now stands, not what
   * changed, so a field that can set the comment off has to be in it.
   */
  test.each(KINDS)(
    "$noun: every field the edit-comment template listens on is in the comment",
    (kind: RecordKind) => {
      const trigger: TemplateNodeSpec = triggerOf(kind.templates.updateComment);
      const body: string = scriptBody(
        scriptCode(kind.templates.updateComment, "build-comment-1"),
      );

      for (const field of Object.keys(
        trigger.args?.["listen-on"] as JSONObject,
      )) {
        const selected: string = field.endsWith("Id")
          ? field.slice(0, -2)
          : field;

        expect({
          field: field,
          selected: Boolean((trigger.args?.["select"] as JSONObject)[selected]),
          commented: body.includes(`${kind.noun}.${selected}`),
        }).toEqual({ field: field, selected: true, commented: true });
      }
    },
  );
});

describe("what the Jira templates write to OneUptime", () => {
  /*
   * Notes from Jira are private notes: a Jira comment was not written for a
   * status page. And nothing is ever updated or deleted.
   */
  test("each template creates only the records it documents, and never updates or deletes", () => {
    const writes: Record<string, Array<string>> = {};

    for (const templateId of JIRA_TEMPLATE_IDS) {
      writes[templateId] = specOf(templateId)
        .nodes.filter(isDatabaseWrite)
        .map((node: TemplateNodeSpec) => {
          return node.metadataId;
        });
    }

    expect(writes).toEqual(EXPECTED_DATABASE_WRITES);
  });

  /*
   * A state change is a new timeline row, not an edit to the record: the
   * timeline is what records it, notifies, and refuses to move a record
   * backwards. Writing the current-state column would skip all three.
   */
  test("no Jira template sets a record's state directly", () => {
    const stateColumns: Array<string> = KINDS.map((kind: RecordKind) => {
      return kind.stateIdColumn;
    });

    for (const { templateId, node } of jiraNodes(isDatabaseWrite)) {
      expect(DATABASE_WRITE_METADATA_ID.exec(node.metadataId)?.[1]).toBe(
        "create",
      );
      expect({
        at: `${templateId} ${node.componentId}`,
        setsState: Object.keys(jsonArg(node, "json")).some((key: string) => {
          return stateColumns.includes(key);
        }),
      }).toEqual({ at: `${templateId} ${node.componentId}`, setsState: false });
    }
  });

  /*
   * The issue key is what stops the create template filing the record back
   * into Jira as a second issue. A Jira issue's text was not written for a
   * status page, so an incident is kept off them; an alert never reaches one.
   */
  test.each(KINDS)(
    "$noun: a $noun made from Jira remembers its issue, and stays off status pages",
    (kind: RecordKind) => {
      const prepare: string = kind.steps.prepareRecord;
      const created: JSONObject = jsonArg(
        nodeOf(kind.templates.createFromIssue, kind.steps.createRecord),
        "json",
      );

      expect(created).toEqual({
        [kind.severityIdColumn]: scriptOutput(prepare, kind.severityIdColumn),
        customFields: {
          jiraIssueKey: scriptOutput(prepare, "issueKey"),
        },
        ...kind.quietCreateFields,
        title: scriptOutput(prepare, "title"),
        description: scriptOutput(prepare, "description"),
      });
    },
  );

  test("an alert made from Jira carries no status-page fields, which only an incident has", () => {
    const created: JSONObject = jsonArg(
      nodeOf(ALERT.templates.createFromIssue, ALERT.steps.createRecord),
      "json",
    );

    expect(Object.keys(created)).toEqual([
      "alertSeverityId",
      "customFields",
      "title",
      "description",
    ]);

    // The incident's quiet fields are incident columns: an alert has nowhere to put them.
    expect(Object.keys(INCIDENT.quietCreateFields).length).toBeGreaterThan(0);

    for (const column of Object.keys(INCIDENT.quietCreateFields)) {
      expect({
        column: column,
        onIncident: new Incident().hasColumn(column),
        onAlert: new Alert().hasColumn(column),
      }).toEqual({ column: column, onIncident: true, onAlert: false });
    }
  });

  test.each(KINDS)(
    "$noun: the title and description of a $noun made from Jira, written in Jira, come last",
    (kind: RecordKind) => {
      const text: string = textArg(
        nodeOf(kind.templates.createFromIssue, kind.steps.createRecord),
        "json",
      );

      expect(Object.keys(JSON.parse(text) as JSONObject).slice(-2)).toEqual([
        "title",
        "description",
      ]);
      expect(
        referencesIn(text)
          .slice(-2)
          .map((reference: Reference) => {
            return reference.raw;
          }),
      ).toEqual([
        scriptOutput(kind.steps.prepareRecord, "title"),
        scriptOutput(kind.steps.prepareRecord, "description"),
      ]);
    },
  );

  /*
   * The script decides from the record OneUptime returned, and only ever
   * forward: an earlier or equal state is a skip. That is also what settles
   * the echo when the other direction already moved the issue.
   */
  test.each(KINDS)(
    "$noun: a state change is a timeline row for the $noun OneUptime found, moving forward only",
    (kind: RecordKind) => {
      const r: string = kind.noun;
      const templateId: string = kind.templates.statusToState;
      const decide: string = scriptBody(
        scriptCode(templateId, "decide-state-1"),
      );

      expect(jsonArg(nodeOf(templateId, "change-state-1"), "json")).toEqual({
        [kind.idColumn]: scriptOutput("decide-state-1", `${r}Id`),
        [kind.timelineStateColumn]: scriptOutput("decide-state-1", "stateId"),
        rootCause: scriptOutput("decide-state-1", "rootCause"),
      });
      expect(decide).toContain(`${r}Id: asText(${r}._id)`);
      expect(decide).toContain("stateId: asText(target._id)");
      expect(decide).toContain(
        "if (Number(target.order) <= Number(current.order))",
      );
    },
  );

  test.each(KINDS)(
    "$noun: a note from Jira is a private note on the $noun OneUptime found, not the one Jira named",
    (kind: RecordKind) => {
      for (const [templateId, scriptId] of [
        [kind.templates.commentToNote, "read-comment-1"],
        [kind.templates.issueChangesToNote, "read-changes-1"],
      ] as Array<[string, string]>) {
        const note: TemplateNodeSpec = nodeOf(templateId, "create-note-1");

        expect(note.metadataId).toBe(`${kind.noun}-internal-note-create-one`);
        expect(jsonArg(note, "json")).toEqual({
          [kind.idColumn]: componentReturnValueReference(
            kind.steps.findRecord,
            "model",
            ["_id"],
          ),
          note: scriptOutput(scriptId, "note"),
        });
      }
    },
  );

  test("no Jira template writes a public note", () => {
    expect(
      jiraNodes((node: TemplateNodeSpec) => {
        return PUBLIC_NOTE_WRITE_METADATA_ID.test(node.metadataId);
      }),
    ).toEqual([]);
  });

  test.each(KINDS)(
    "$noun: a $noun is looked up by an id a script took from the issue's label",
    (kind: RecordKind) => {
      const r: string = kind.noun;

      for (const [templateId, scriptId] of [
        [kind.templates.statusToState, "read-event-1"],
        [kind.templates.commentToNote, "find-link-1"],
        [kind.templates.issueChangesToNote, "read-changes-1"],
      ] as Array<[string, string]>) {
        const lookupNode: TemplateNodeSpec = nodeOf(
          templateId,
          kind.steps.findRecord,
        );

        expect(lookupNode.metadataId).toBe(`${r}-find-one`);
        expect(lookupNode.args?.["query"]).toEqual({
          _id: scriptOutput(scriptId, `${r}Id`),
        });

        const body: string = scriptBody(scriptCode(templateId, scriptId));

        expect(body).toContain(`const ${r}Id = ${r}IdFromLabels(`);
        expect(body).toMatch(new RegExp(`${r}Id: ${r}Id[,\\s]`));
      }
    },
  );

  /*
   * The query argument is required and cannot be left empty, and without a
   * limit Find Many returns ten rows — a project with more severities or
   * states than that would have some silently left out.
   */
  test("a Find Many asks for every row, with a limit above the default", () => {
    const findMany: Array<JiraNode> = jiraNodes((node: TemplateNodeSpec) => {
      return node.metadataId.endsWith("-find-many");
    });

    // Severities and states, for each kind.
    expect(findMany).toHaveLength(KINDS.length * 2);

    for (const { templateId, node } of findMany) {
      const query: JSONValue | undefined = node.args?.["query"];
      const limit: JSONValue | undefined = node.args?.["limit"];

      expect({
        at: `${templateId} ${node.componentId}`,
        query: query,
        limitIsWhole: Number.isInteger(limit),
        aboveDefault: typeof limit === "number" && limit > DEFAULT_LIMIT,
        withinCap: typeof limit === "number" && limit <= LIMIT_PER_PROJECT,
      }).toEqual({
        at: `${templateId} ${node.componentId}`,
        query: { _id: { _type: "NotNull", value: null } },
        limitIsWhole: true,
        aboveDefault: true,
        withinCap: true,
      });
    }
  });

  /*
   * A select naming a column the model does not have throws at run time, and
   * a create naming one drops it or throws. Relations in a select are
   * followed into the related model.
   */
  test("every column a Jira template selects, listens on, queries or writes exists", () => {
    const missing: Array<string> = [];

    for (const { templateId, node } of jiraNodes(isDatabaseNode)) {
      const modelType: { new (): BaseModel } = lookup(
        MODEL_BY_METADATA_ID,
        node.metadataId,
      );
      const model: BaseModel = new modelType();
      const at: string = `${templateId} ${node.componentId}`;

      for (const [argumentId, followRelations] of [
        ["select", true],
        ["listen-on", false],
        ["query", false],
      ] as Array<[string, boolean]>) {
        const value: JSONValue | undefined = node.args?.[argumentId];

        if (value && typeof value === "object") {
          missing.push(
            ...missingColumns(
              model,
              value as JSONObject,
              followRelations,
              `${at} ${argumentId}: `,
            ),
          );
        }
      }

      if (typeof node.args?.["json"] === "string") {
        missing.push(
          ...missingColumns(
            model,
            jsonArg(node, "json"),
            false,
            `${at} json: `,
          ),
        );
      }
    }

    expect(missing).toEqual([]);
  });
});

describe("the incident and alert sets side by side", () => {
  /*
   * The alert set is the incident set with the record's name swapped — an
   * incident is declared, an alert created — minus the public-note template,
   * because alerts have no public notes.
   */
  test("the alert set's ids are the incident set's with the record's name swapped, but the public-note template's", () => {
    expect(templateIdsOf(ALERT)).toEqual(
      templateIdsOf(INCIDENT)
        .filter((templateId: string) => {
          return templateId !== INCIDENT.templates.publicNoteToComment;
        })
        .map(asAlert),
    );
    expect(
      SHARED_ROLES.map((role: TemplateRole) => {
        return templateFor(ALERT, role);
      }),
    ).toEqual(templateIdsOf(ALERT));
  });

  test.each(SHARED_ROLES)(
    "%s: the alert version has the incident version's steps, in the same places, wired the same way",
    (role: TemplateRole) => {
      const incidentSpec: TemplateSpec = specOf(templateFor(INCIDENT, role));
      const alertSpec: TemplateSpec = specOf(templateFor(ALERT, role));

      expect(alertSpec.nodes).toHaveLength(incidentSpec.nodes.length);
      expect(alertSpec.edges).toHaveLength(incidentSpec.edges.length);
      expect({
        steps: stepsOf(alertSpec, asItIs),
        wiring: wiringOf(alertSpec, asItIs),
      }).toEqual({
        steps: stepsOf(incidentSpec, asAlert),
        wiring: wiringOf(incidentSpec, asAlert),
      });
    },
  );

  /*
   * Everything else — every name, description, argument and script — reads
   * the same once the incident's words are swapped for the alert's, but in
   * the few places an alert really is different. The tests elsewhere pin
   * what each of those says.
   */
  test("the alert templates say what the incident templates say, but where an alert differs", () => {
    const differences: Array<string> = [];

    for (const role of SHARED_ROLES) {
      const incidentId: string = templateFor(INCIDENT, role);
      const alertId: string = templateFor(ALERT, role);
      const incidentTemplate: WorkflowTemplate = templateOf(incidentId);
      const alertTemplate: WorkflowTemplate = templateOf(alertId);

      for (const field of TEMPLATE_TEXT_FIELDS) {
        if (
          asAlert(String(incidentTemplate[field])) !==
          String(alertTemplate[field])
        ) {
          differences.push(`${alertId} ${field}`);
        }
      }

      const incidentNodes: Array<TemplateNodeSpec> = specOf(incidentId).nodes;

      specOf(alertId).nodes.forEach(
        (alertNode: TemplateNodeSpec, index: number) => {
          const incidentArgs: JSONObject =
            incidentNodes[index]?.args || ({} as JSONObject);
          const alertArgs: JSONObject = alertNode.args || {};
          const argumentIds: Set<string> = new Set([
            ...Object.keys(incidentArgs),
            ...Object.keys(alertArgs),
          ]);

          for (const argumentId of argumentIds) {
            if (
              JSON.stringify(asAlertValue(incidentArgs[argumentId])) !==
              JSON.stringify(alertArgs[argumentId])
            ) {
              differences.push(
                `${alertId} ${alertNode.componentId}.${argumentId}`,
              );
            }
          }
        },
      );
    }

    expect(differences).toEqual([
      // An alert's root cause cannot be edited: not listened for, nor said to be.
      `${ALERT.templates.updateComment} description`,
      `${ALERT.templates.updateComment} workflowDescription`,
      `${ALERT.templates.updateComment} ${ALERT.steps.onUpdate}.listen-on`,
      // An alert never reaches a status page, so there is nothing to keep it off.
      `${ALERT.templates.createFromIssue} workflowDescription`,
      `${ALERT.templates.createFromIssue} ${ALERT.steps.createRecord}.json`,
    ]);
  });

  test("only the incident made from Jira is kept off status pages, and only its description says so", () => {
    expect(
      templateOf(INCIDENT.templates.createFromIssue).workflowDescription,
    ).toContain("kept off status pages");
    expect(
      templateOf(ALERT.templates.createFromIssue).workflowDescription,
    ).not.toMatch(/status page/i);
  });

  /*
   * Not an omission: there is no alert public-note component to trigger on,
   * as there is for incidents.
   */
  test("alerts have no public notes, so no alert template copies one", () => {
    expect(registryHas("incident-public-note-")).toBe(true);
    expect(registryHas("alert-public-note-")).toBe(false);
    expect(ALERT.templates.publicNoteToComment).toBeNull();
    expect(
      getWorkflowTemplate("jira-comment-from-alert-public-note"),
    ).toBeNull();
    expect(
      jiraNodes((node: TemplateNodeSpec) => {
        return node.metadataId.includes("public-note");
      }).map(({ templateId, node }: JiraNode) => {
        return `${templateId} ${node.componentId}`;
      }),
    ).toEqual([`${INCIDENT.templates.publicNoteToComment} note-on-create-1`]);
  });

  /*
   * Both kinds' create-from-issue templates listen to the same Jira events.
   * An issue OneUptime filed for an alert carries oneuptime-alert-<id>, so
   * unless the incident template counts that label as linked too, the issue
   * would also become an incident — and the other way round.
   */
  test("an issue linked to either kind counts as linked, so neither create-from-issue template takes the other's issue", () => {
    for (const kind of KINDS) {
      const templateId: string = kind.templates.createFromIssue;

      for (const scriptId of [kind.steps.prepareRecord, "confirm-unlinked-1"]) {
        const code: string = scriptCode(templateId, scriptId);
        const isLinked: string = helperDefinition(
          helperBlock(code),
          "isLinked",
        );

        expect(helperBlock(code)).toContain(
          `\n${LINKED_LABEL_PREFIXES_DECLARATION}\n`,
        );
        expect(isLinked).toContain("text === LINK_LABEL");
        expect(isLinked).toContain(
          "LINKED_LABEL_PREFIXES.some((prefix) => text.indexOf(prefix) === 0)",
        );
      }

      expect(
        scriptBody(scriptCode(templateId, kind.steps.prepareRecord)),
      ).toContain("if (isLinked(fields.labels)) {");
      expect(
        scriptBody(scriptCode(templateId, "confirm-unlinked-1")),
      ).toContain("if (isLinked(issue.fields && issue.fields.labels)) {");
    }

    // The declaration lists exactly the two prefixes, as the exports spell them.
    expect(
      JSON.parse(
        LINKED_LABEL_PREFIXES_DECLARATION.slice(
          LINKED_LABEL_PREFIXES_DECLARATION.indexOf("["),
          -1,
        ),
      ),
    ).toEqual(["oneuptime-incident-", "oneuptime-alert-"]);
  });

  /*
   * A kind finds its record only by its own label, matched at the start. If
   * one prefix began with the other, an alert's label would read as an
   * incident's id (or the reverse) and a lookup would go to the wrong table.
   */
  test("a label of one kind is never read as the other's", () => {
    expect(JIRA_ALERT_LABEL_PREFIX.startsWith(JIRA_INCIDENT_LABEL_PREFIX)).toBe(
      false,
    );
    expect(JIRA_INCIDENT_LABEL_PREFIX.startsWith(JIRA_ALERT_LABEL_PREFIX)).toBe(
      false,
    );

    for (const kind of KINDS) {
      const other: RecordKind = otherKind(kind);
      const helpers: string = kindHelpers(kind);
      const idFromLabels: string = helperDefinition(
        helpers,
        `${kind.noun}IdFromLabels`,
      );

      expect(idFromLabels).toContain(
        `text.indexOf(${kind.upper}_LABEL_PREFIX) === 0 && UUID.test(id)`,
      );
      expect(idFromLabels).not.toContain("LINKED_LABEL_PREFIXES");
      expect(helpers).not.toContain(`${other.noun}IdFromLabels`);
      expect(helpers).not.toContain(`${other.upper}_LABEL_PREFIX`);
    }
  });

  test("an alert's issue is searched for by its oneuptime-alert- label", () => {
    const searching: Array<string> = outboundIds(ALERT).filter(
      (templateId: string) => {
        return templateId in EXPECTED_SEARCHES;
      },
    );

    expect(searching).toEqual([
      ALERT.templates.transitionIssue,
      ALERT.templates.privateNoteToComment,
      ALERT.templates.updateComment,
    ]);

    for (const templateId of searching) {
      const jql: string = String(
        jsonArg(nodeOf(templateId, "find-issue-1"), "request-body")["jql"],
      );

      expect(jql.startsWith('labels = "oneuptime-alert-{{')).toBe(true);
      expect(jql).not.toContain("incident");
    }
  });

  test("an alert's scripts carry the alert's own private switch", () => {
    for (const templateId of outboundIds(ALERT)) {
      for (const { node } of jiraNodes(isScriptNode).filter(
        (entry: JiraNode) => {
          return entry.templateId === templateId;
        },
      )) {
        const body: string = scriptBody(textArg(node, "code"));

        expect({
          at: `${templateId} ${node.componentId}`,
          declares: body.includes("\nconst SYNC_PRIVATE_ALERTS = false;\n"),
          mentionsIncidents: NAMES_INCIDENTS.test(body),
        }).toEqual({
          at: `${templateId} ${node.componentId}`,
          declares: true,
          mentionsIncidents: false,
        });
      }
    }
  });
});

describe("built Jira graphs", () => {
  /*
   * Building deep-copies each node's arguments through JSON. Anything that
   * does not survive that trip — an undefined value, a non-JSON object —
   * would be in the definition these tests read but not in the workflow a
   * user actually gets.
   */
  test("each is built with every step's arguments exactly as defined", () => {
    for (const templateId of JIRA_TEMPLATE_IDS) {
      const graph: JSONObject = buildGraphForTemplate(
        templateId,
        generateId,
      ) as JSONObject;
      const built: Array<JSONObject> = (
        graph["nodes"] as Array<JSONObject>
      ).map((node: JSONObject) => {
        return node["data"] as JSONObject;
      });

      expect({
        templateId: templateId,
        steps: built.map((data: JSONObject) => {
          return { id: data["id"], arguments: data["arguments"] };
        }),
      }).toStrictEqual({
        templateId: templateId,
        steps: specOf(templateId).nodes.map((node: TemplateNodeSpec) => {
          return { id: node.componentId, arguments: node.args || {} };
        }),
      });
    }
  });
});
