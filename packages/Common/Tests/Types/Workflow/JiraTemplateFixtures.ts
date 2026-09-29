/*
 * Shared fixtures for the Jira template tests.
 *
 * The Jira payloads follow real Jira Cloud webhook captures (the shapes the
 * Mattermost and Zulip Jira integrations keep as test data) and Atlassian's
 * REST v3 reference, trimmed to the fields the templates touch. Three details
 * of the real payloads matter more than they look, and the builders keep them:
 *
 *   - Webhook rich text is a wiki-markup STRING (issue.fields.description,
 *     comment.body), not the Atlassian Document Format the v3 API accepts.
 *   - comment_* events carry a cut-down issue: summary, status and so on, but
 *     no labels — which is why the comment template has to fetch the issue.
 *   - A status change is not always changelog.items[0]; resolving an issue
 *     lists the resolution first.
 *
 * The OneUptime records are in the shape BaseModel.toJSON produces for a
 * database trigger: the record's own `_id` is a plain string, while foreign
 * keys, dates and names are { _type, value } wrappers.
 *
 * Not a test file itself (jest only collects *.test.ts), so the scripts,
 * contract and simulation suites can share it.
 */

import VMRunner from "../../../Server/Utils/VM/VMRunner";
import ReturnResult from "../../../Types/IsolatedVM/ReturnResult";
import { JSONObject, JSONValue } from "../../../Types/JSON";
import ComponentID from "../../../Types/Workflow/ComponentID";
import { getTemplateGraphSpec } from "../../../Types/Workflow/Templates";

export const INCIDENT_ID: string = "3f0e2a4c-5b6d-4e7f-8a9b-0c1d2e3f4a5b";
export const OTHER_INCIDENT_ID: string = "9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d";
export const PROJECT_ID: string = "11111111-2222-4333-8444-555555555555";
export const INCIDENT_NUMBER: string = "INC-42";
export const JIRA_SITE: string = "https://acme.atlassian.net";
export const JIRA_ISSUE_KEY: string = "OPS-17";
export const JIRA_ISSUE_ID: string = "10040";

export const CREATED_STATE_ID: string = "aaaaaaaa-0000-4000-8000-000000000001";
export const ACKNOWLEDGED_STATE_ID: string =
  "aaaaaaaa-0000-4000-8000-000000000002";
export const RESOLVED_STATE_ID: string = "aaaaaaaa-0000-4000-8000-000000000003";

export const CRITICAL_SEVERITY_ID: string =
  "bbbbbbbb-0000-4000-8000-000000000001";
export const MAJOR_SEVERITY_ID: string = "bbbbbbbb-0000-4000-8000-000000000002";
export const MINOR_SEVERITY_ID: string = "bbbbbbbb-0000-4000-8000-000000000003";

export type IncidentLabelFunction = (incidentId?: string) => string;

export const incidentLabel: IncidentLabelFunction = (
  incidentId?: string,
): string => {
  return `oneuptime-incident-${incidentId || INCIDENT_ID}`;
};

/* ------------------------------ Jira side ------------------------------ */

export type JiraUserFunction = (
  displayName?: string,
  accountId?: string,
) => JSONObject;

export const jiraUser: JiraUserFunction = (
  displayName?: string,
  accountId?: string,
): JSONObject => {
  const id: string = accountId || "5c5f880629be9642ba529340";

  return {
    self: `${JIRA_SITE}/rest/api/2/user?accountId=${id}`,
    accountId: id,
    displayName: displayName || "Priya Patel",
    active: true,
    timeZone: "Europe/London",
    accountType: "atlassian",
  };
};

export interface JiraStatusProps {
  name: string;
  categoryKey: "new" | "indeterminate" | "done" | "undefined";
  id?: string | undefined;
}

export type JiraStatusFunction = (props: JiraStatusProps) => JSONObject;

const STATUS_CATEGORY_IDS: Record<string, number> = {
  undefined: 1,
  new: 2,
  done: 3,
  indeterminate: 4,
};

const STATUS_CATEGORY_NAMES: Record<string, string> = {
  undefined: "No Category",
  new: "To Do",
  done: "Done",
  indeterminate: "In Progress",
};

export const jiraStatus: JiraStatusFunction = (
  props: JiraStatusProps,
): JSONObject => {
  const categoryId: number = STATUS_CATEGORY_IDS[props.categoryKey] as number;

  return {
    self: `${JIRA_SITE}/rest/api/2/status/${props.id || "10001"}`,
    description: "",
    name: props.name,
    id: props.id || "10001",
    statusCategory: {
      self: `${JIRA_SITE}/rest/api/2/statuscategory/${categoryId}`,
      id: categoryId,
      key: props.categoryKey,
      colorName: "blue-gray",
      name: STATUS_CATEGORY_NAMES[props.categoryKey] as string,
    },
  };
};

export const TO_DO: JSONObject = jiraStatus({
  name: "To Do",
  categoryKey: "new",
  id: "10001",
});
export const IN_PROGRESS: JSONObject = jiraStatus({
  name: "In Progress",
  categoryKey: "indeterminate",
  id: "3",
});
export const DONE: JSONObject = jiraStatus({
  name: "Done",
  categoryKey: "done",
  id: "10002",
});

export interface JiraIssueProps {
  key?: string | undefined;
  summary?: string | undefined;
  description?: JSONValue | undefined;
  labels?: Array<string> | undefined;
  priority?: string | null | undefined;
  status?: JSONObject | undefined;
  reporter?: JSONObject | undefined;
  self?: string | undefined;
}

export type JiraIssueFunction = (props?: JiraIssueProps) => JSONObject;

/** An issue as a jira:issue_* webhook carries it: the full REST v2 shape. */
export const jiraIssue: JiraIssueFunction = (
  props?: JiraIssueProps,
): JSONObject => {
  const key: string = props?.key || JIRA_ISSUE_KEY;
  const priority: string | null =
    props?.priority === undefined ? "High" : props.priority;

  return {
    id: JIRA_ISSUE_ID,
    self:
      props?.self === undefined
        ? `${JIRA_SITE}/rest/api/2/issue/${JIRA_ISSUE_ID}`
        : props.self,
    key: key,
    fields: {
      summary:
        props?.summary === undefined
          ? "Checkout API returns 502 for EU customers"
          : props.summary,
      description:
        props?.description === undefined
          ? "Customers in *eu-west-1* see 502s at checkout.\nStarted around 09:40 UTC."
          : props.description,
      labels: props?.labels || [],
      priority:
        priority === null
          ? null
          : {
              self: `${JIRA_SITE}/rest/api/2/priority/2`,
              name: priority,
              id: "2",
            },
      status: props?.status || TO_DO,
      issuetype: { id: "10001", name: "Task", subtask: false },
      project: {
        id: "10000",
        key: key.split("-")[0] as string,
        name: "Operations",
        projectTypeKey: "software",
      },
      reporter: props?.reporter || jiraUser("Priya Patel"),
      creator: props?.reporter || jiraUser("Priya Patel"),
      assignee: null,
      resolution: null,
      created: "2026-09-23T09:41:02.193+0100",
      updated: "2026-09-23T09:41:02.193+0100",
    },
  };
};

export type JiraIssueCreatedEventFunction = (
  props?: JiraIssueProps & { user?: JSONObject | undefined },
) => JSONObject;

export const jiraIssueCreatedEvent: JiraIssueCreatedEventFunction = (
  props?: JiraIssueProps & { user?: JSONObject | undefined },
): JSONObject => {
  const issue: JSONObject = jiraIssue(props);

  return {
    timestamp: 1790149262193,
    webhookEvent: "jira:issue_created",
    issue_event_type_name: "issue_created",
    user: props?.user || jiraUser("Priya Patel"),
    issue: issue,
    // Real Cloud issue_created payloads carry a changelog too.
    changelog: {
      id: "11627",
      items: [
        {
          field: "Status",
          fieldtype: "jira",
          fieldId: "status",
          to: "10001",
          toString: "To Do",
        },
      ],
    },
  };
};

export interface JiraChangelogItem {
  field: string;
  fieldId?: string | undefined;
  from?: string | null | undefined;
  fromString: string | null;
  to?: string | null | undefined;
  toString: string | null;
}

export type ChangelogItemFunction = (item: JiraChangelogItem) => JSONObject;

export const changelogItem: ChangelogItemFunction = (
  item: JiraChangelogItem,
): JSONObject => {
  return {
    field: item.field,
    fieldtype: "jira",
    fieldId: item.fieldId === undefined ? item.field : item.fieldId,
    from: item.from === undefined ? null : item.from,
    fromString: item.fromString,
    to: item.to === undefined ? null : item.to,
    toString: item.toString,
  } as unknown as JSONObject;
};

/** The two items Jira sends when an issue is resolved — resolution first. */
export const RESOLVED_CHANGELOG: Array<JSONObject> = [
  changelogItem({
    field: "resolution",
    fromString: null,
    to: "10000",
    toString: "Done",
  }),
  changelogItem({
    field: "status",
    from: "3",
    fromString: "In Progress",
    to: "10002",
    toString: "Done",
  }),
];

export const STARTED_CHANGELOG: Array<JSONObject> = [
  changelogItem({
    field: "status",
    from: "10001",
    fromString: "To Do",
    to: "3",
    toString: "In Progress",
  }),
];

export type JiraIssueUpdatedEventFunction = (
  props: JiraIssueProps & {
    items: Array<JSONObject>;
    user?: JSONObject | undefined;
    issueEventTypeName?: string | undefined;
  },
) => JSONObject;

export const jiraIssueUpdatedEvent: JiraIssueUpdatedEventFunction = (
  props: JiraIssueProps & {
    items: Array<JSONObject>;
    user?: JSONObject | undefined;
    issueEventTypeName?: string | undefined;
  },
): JSONObject => {
  return {
    timestamp: 1790149340507,
    webhookEvent: "jira:issue_updated",
    issue_event_type_name: props.issueEventTypeName || "issue_generic",
    user: props.user || jiraUser("Priya Patel"),
    issue: jiraIssue(props),
    changelog: { id: "10228", items: props.items },
  };
};

export interface JiraCommentProps {
  body?: JSONValue | undefined;
  author?: JSONObject | undefined;
  issueKey?: string | undefined;
  webhookEvent?: string | undefined;
  commentId?: string | undefined;
}

export type JiraCommentEventFunction = (props?: JiraCommentProps) => JSONObject;

/*
 * A comment_created webhook: no top-level `user`, no issue_event_type_name,
 * and an issue carrying only summary, type, project, assignee, priority and
 * status — no labels.
 */
export const jiraCommentEvent: JiraCommentEventFunction = (
  props?: JiraCommentProps,
): JSONObject => {
  const author: JSONObject = props?.author || jiraUser("Marco Rossi");
  const key: string = props?.issueKey || JIRA_ISSUE_KEY;
  const commentId: string = props?.commentId || "10019";

  return {
    timestamp: 1790149278321,
    webhookEvent: props?.webhookEvent || "comment_created",
    comment: {
      self: `${JIRA_SITE}/rest/api/2/issue/${JIRA_ISSUE_ID}/comment/${commentId}`,
      id: commentId,
      author: author,
      body:
        props?.body === undefined
          ? "Rolled back the *eu-west-1* deploy. Watching the error rate."
          : props.body,
      updateAuthor: author,
      created: "2026-09-23T10:11:18.321+0100",
      updated: "2026-09-23T10:11:18.321+0100",
      jsdPublic: true,
    },
    issue: {
      id: JIRA_ISSUE_ID,
      self: `${JIRA_SITE}/rest/api/2/issue/${JIRA_ISSUE_ID}`,
      key: key,
      fields: {
        summary: "Checkout API returns 502 for EU customers",
        issuetype: { id: "10001", name: "Task" },
        project: { id: "10000", key: key.split("-")[0] as string },
        assignee: null,
        priority: { id: "2", name: "High" },
        status: TO_DO,
      },
    },
  };
};

export interface JiraTransition {
  id: string;
  name: string;
  to: JSONObject;
  hasScreen?: boolean | undefined;
  isAvailable?: boolean | undefined;
}

export type JiraTransitionFunction = (transition: JiraTransition) => JSONObject;

export const jiraTransition: JiraTransitionFunction = (
  transition: JiraTransition,
): JSONObject => {
  return {
    id: transition.id,
    name: transition.name,
    to: transition.to,
    hasScreen:
      transition.hasScreen === undefined ? false : transition.hasScreen,
    isGlobal: true,
    isInitial: false,
    isAvailable:
      transition.isAvailable === undefined ? true : transition.isAvailable,
    isConditional: false,
    isLooped: false,
  };
};

/** The transitions a simple software project offers from To Do. */
export const TRANSITIONS_FROM_TO_DO: Array<JSONObject> = [
  jiraTransition({ id: "11", name: "To Do", to: TO_DO }),
  jiraTransition({ id: "21", name: "Start work", to: IN_PROGRESS }),
  jiraTransition({ id: "31", name: "Close", to: DONE }),
];

export interface JiraSearchProps {
  issues?: Array<JSONObject> | undefined;
  status?: JSONObject | undefined;
  transitions?: Array<JSONObject> | undefined;
  key?: string | undefined;
}

export type JiraSearchResponseFunction = (
  props?: JiraSearchProps,
) => JSONObject;

/*
 * A POST /rest/api/3/search/jql response. There is no `total` and no
 * `startAt` on this endpoint; `isLast` and an optional `nextPageToken`
 * replace them.
 */
export const jiraSearchResponse: JiraSearchResponseFunction = (
  props?: JiraSearchProps,
): JSONObject => {
  if (props?.issues) {
    return { issues: props.issues, isLast: true };
  }

  const key: string = props?.key || JIRA_ISSUE_KEY;

  return {
    issues: [
      {
        expand:
          "renderedFields,names,schema,operations,editmeta,changelog,versionedRepresentations",
        id: JIRA_ISSUE_ID,
        self: `${JIRA_SITE}/rest/api/3/issue/${JIRA_ISSUE_ID}`,
        key: key,
        fields: {
          summary: "Checkout API returns 502 for EU customers",
          status: props?.status || TO_DO,
        },
        transitions: props?.transitions || TRANSITIONS_FROM_TO_DO,
      },
    ],
    isLast: true,
  };
};

/** What an empty result, or a search made with credentials Jira ignored, looks like. */
export const EMPTY_JIRA_SEARCH: JSONObject = { issues: [], isLast: true };

export type JiraIssueLabelsResponseFunction = (
  labels: Array<string>,
) => JSONObject;

/** GET /rest/api/3/issue/{key}?fields=labels */
export const jiraIssueLabelsResponse: JiraIssueLabelsResponseFunction = (
  labels: Array<string>,
): JSONObject => {
  return {
    expand:
      "renderedFields,names,schema,operations,editmeta,changelog,versionedRepresentations",
    id: JIRA_ISSUE_ID,
    self: `${JIRA_SITE}/rest/api/3/issue/${JIRA_ISSUE_ID}`,
    key: JIRA_ISSUE_KEY,
    fields: { labels: labels },
  };
};

/* ---------------------------- OneUptime side ---------------------------- */

export type ObjectIdJsonFunction = (value: string) => JSONObject;

export const objectIdJson: ObjectIdJsonFunction = (
  value: string,
): JSONObject => {
  return { _type: "ObjectID", value: value };
};

export interface IncidentModelProps {
  _id?: string | undefined;
  title?: string | undefined;
  description?: string | null | undefined;
  customFields?: JSONObject | null | undefined;
  state?: JSONObject | undefined;
  severity?: string | undefined;
  rootCause?: string | null | undefined;
  remediationNotes?: string | null | undefined;
}

export type IncidentModelFunction = (props?: IncidentModelProps) => JSONObject;

export const CREATED_STATE: JSONObject = {
  _id: CREATED_STATE_ID,
  name: "Identified",
  order: 1,
  isCreatedState: true,
  isAcknowledgedState: false,
  isResolvedState: false,
};

export const ACKNOWLEDGED_STATE: JSONObject = {
  _id: ACKNOWLEDGED_STATE_ID,
  name: "Acknowledged",
  order: 2,
  isCreatedState: false,
  isAcknowledgedState: true,
  isResolvedState: false,
};

export const RESOLVED_STATE: JSONObject = {
  _id: RESOLVED_STATE_ID,
  name: "Resolved",
  order: 3,
  isCreatedState: false,
  isAcknowledgedState: false,
  isResolvedState: true,
};

/** A project's default incident states, in the order find-many returns them. */
export const INCIDENT_STATES: Array<JSONObject> = [
  RESOLVED_STATE,
  CREATED_STATE,
  ACKNOWLEDGED_STATE,
];

/** A project's default incident severities, deliberately out of order. */
export const INCIDENT_SEVERITIES: Array<JSONObject> = [
  { _id: MINOR_SEVERITY_ID, name: "Minor Incident", order: 3 },
  { _id: CRITICAL_SEVERITY_ID, name: "Critical Incident", order: 1 },
  { _id: MAJOR_SEVERITY_ID, name: "Major Incident", order: 2 },
];

/** An Incident as the on-create / on-update triggers hand it over. */
export const incidentModel: IncidentModelFunction = (
  props?: IncidentModelProps,
): JSONObject => {
  const model: JSONObject = {
    _id: props?._id || INCIDENT_ID,
    projectId: objectIdJson(PROJECT_ID),
    title: props?.title === undefined ? "Checkout latency high" : props.title,
    description:
      props?.description === undefined
        ? 'p99 latency on /checkout is above 2s.\nStarted after the "v4.2" deploy.'
        : props.description,
    incidentNumber: 42,
    incidentNumberWithPrefix: INCIDENT_NUMBER,
    customFields: props?.customFields === undefined ? {} : props.customFields,
    incidentSeverity: { name: props?.severity || "Critical Incident" },
    currentIncidentState: props?.state || CREATED_STATE,
    currentIncidentStateId: objectIdJson(
      ((props?.state || CREATED_STATE)["_id"] as string) || CREATED_STATE_ID,
    ),
    declaredAt: { _type: "DateTime", value: "2026-09-23T08:40:00.000Z" },
  };

  if (props?.rootCause !== undefined) {
    model["rootCause"] = props.rootCause;
  }

  if (props?.remediationNotes !== undefined) {
    model["remediationNotes"] = props.remediationNotes;
  }

  return model;
};

export interface NoteModelProps {
  note?: string | undefined;
  authorName?: string | null | undefined;
  incidentId?: string | undefined;
}

export type NoteModelFunction = (props?: NoteModelProps) => JSONObject;

/** An IncidentInternalNote / IncidentPublicNote as its on-create trigger hands it over. */
export const noteModel: NoteModelFunction = (
  props?: NoteModelProps,
): JSONObject => {
  const model: JSONObject = {
    _id: "cccccccc-0000-4000-8000-000000000001",
    note:
      props?.note === undefined
        ? "Failed over to the **secondary** database. Error rate is dropping."
        : props.note,
    incidentId: objectIdJson(props?.incidentId || INCIDENT_ID),
    incident: { incidentNumberWithPrefix: INCIDENT_NUMBER },
  };

  if (props?.authorName !== null) {
    model["createdByUser"] = {
      name: { _type: "Name", value: props?.authorName || "Jane Doe" },
    };
  }

  return model;
};

/* ------------------------------ Alerts ------------------------------ */

/*
 * The alert side of the same fixtures. An alert has everything the
 * templates read off an incident — a numbered prefix, a severity, a state,
 * custom fields, a Private flag, private notes — but no public notes and no
 * status page, and a project starts with two alert severities rather than
 * three.
 */

export const ALERT_ID: string = "5d6e7f80-1a2b-4c3d-8e4f-5a6b7c8d9e0f";
export const OTHER_ALERT_ID: string = "0f1e2d3c-4b5a-4968-8776-655443322110";
export const ALERT_NUMBER: string = "ALT-7";

export const ALERT_CREATED_STATE_ID: string =
  "dddddddd-0000-4000-8000-000000000001";
export const ALERT_ACKNOWLEDGED_STATE_ID: string =
  "dddddddd-0000-4000-8000-000000000002";
export const ALERT_RESOLVED_STATE_ID: string =
  "dddddddd-0000-4000-8000-000000000003";

export const HIGH_ALERT_SEVERITY_ID: string =
  "eeeeeeee-0000-4000-8000-000000000001";
export const LOW_ALERT_SEVERITY_ID: string =
  "eeeeeeee-0000-4000-8000-000000000002";

export type AlertLabelFunction = (alertId?: string) => string;

export const alertLabel: AlertLabelFunction = (alertId?: string): string => {
  return `oneuptime-alert-${alertId || ALERT_ID}`;
};

// The default alert states carry the same names and flags as incident ones.
export const ALERT_CREATED_STATE: JSONObject = {
  ...CREATED_STATE,
  _id: ALERT_CREATED_STATE_ID,
};

export const ALERT_ACKNOWLEDGED_STATE: JSONObject = {
  ...ACKNOWLEDGED_STATE,
  _id: ALERT_ACKNOWLEDGED_STATE_ID,
};

export const ALERT_RESOLVED_STATE: JSONObject = {
  ...RESOLVED_STATE,
  _id: ALERT_RESOLVED_STATE_ID,
};

/** A project's default alert states, in the order find-many returns them. */
export const ALERT_STATES: Array<JSONObject> = [
  ALERT_RESOLVED_STATE,
  ALERT_CREATED_STATE,
  ALERT_ACKNOWLEDGED_STATE,
];

/** A project's two default alert severities, deliberately out of order. */
export const ALERT_SEVERITIES: Array<JSONObject> = [
  { _id: LOW_ALERT_SEVERITY_ID, name: "Low", order: 2 },
  { _id: HIGH_ALERT_SEVERITY_ID, name: "High", order: 1 },
];

export interface AlertModelProps {
  _id?: string | undefined;
  title?: string | undefined;
  description?: string | null | undefined;
  customFields?: JSONObject | null | undefined;
  state?: JSONObject | undefined;
  severity?: string | undefined;
  rootCause?: string | null | undefined;
  remediationNotes?: string | null | undefined;
  isPrivate?: boolean | undefined;
}

export type AlertModelFunction = (props?: AlertModelProps) => JSONObject;

/** An Alert as the on-create / on-update triggers hand it over. */
export const alertModel: AlertModelFunction = (
  props?: AlertModelProps,
): JSONObject => {
  const state: JSONObject = props?.state || ALERT_CREATED_STATE;
  const model: JSONObject = {
    _id: props?._id || ALERT_ID,
    projectId: objectIdJson(PROJECT_ID),
    title:
      props?.title === undefined ? "Disk usage above 90% on db-1" : props.title,
    description:
      props?.description === undefined
        ? 'The "db-1" volume is at 93%.\nIt grew 4% in the last hour.'
        : props.description,
    alertNumber: 7,
    alertNumberWithPrefix: ALERT_NUMBER,
    customFields: props?.customFields === undefined ? {} : props.customFields,
    alertSeverity: { name: props?.severity || "High" },
    currentAlertState: state,
    currentAlertStateId: objectIdJson(
      (state["_id"] as string) || ALERT_CREATED_STATE_ID,
    ),
  };

  if (props?.rootCause !== undefined) {
    model["rootCause"] = props.rootCause;
  }

  if (props?.remediationNotes !== undefined) {
    model["remediationNotes"] = props.remediationNotes;
  }

  if (props?.isPrivate !== undefined) {
    model["isPrivate"] = props.isPrivate;
  }

  return model;
};

export interface AlertNoteModelProps {
  note?: string | undefined;
  authorName?: string | null | undefined;
  alertId?: string | undefined;
  isPrivate?: boolean | undefined;
}

export type AlertNoteModelFunction = (
  props?: AlertNoteModelProps,
) => JSONObject;

/** An AlertInternalNote as its on-create trigger hands it over. */
export const alertNoteModel: AlertNoteModelFunction = (
  props?: AlertNoteModelProps,
): JSONObject => {
  const alert: JSONObject = { alertNumberWithPrefix: ALERT_NUMBER };

  if (props?.isPrivate !== undefined) {
    alert["isPrivate"] = props.isPrivate;
  }

  const model: JSONObject = {
    _id: "ffffffff-0000-4000-8000-000000000001",
    note:
      props?.note === undefined
        ? "Cleared old WAL segments. Usage is back to 71%."
        : props.note,
    alertId: objectIdJson(props?.alertId || ALERT_ID),
    alert: alert,
  };

  if (props?.authorName !== null) {
    model["createdByUser"] = {
      name: { _type: "Name", value: props?.authorName || "Jane Doe" },
    };
  }

  return model;
};

/* ------------------------------- Scripts ------------------------------- */

export type ScriptOfFunction = (
  templateId: string,
  componentId: string,
) => string;

/** The JavaScript a template ships for one of its steps. */
export const scriptOf: ScriptOfFunction = (
  templateId: string,
  componentId: string,
): string => {
  const spec: { nodes: Array<JSONObject> } | null = getTemplateGraphSpec(
    templateId,
  ) as unknown as { nodes: Array<JSONObject> } | null;

  const node: JSONObject | undefined = spec?.nodes.find(
    (candidate: JSONObject) => {
      return (
        candidate["componentId"] === componentId &&
        candidate["metadataId"] === ComponentID.JavaScriptCode
      );
    },
  );

  if (!node) {
    throw new Error(
      `Template ${templateId} has no script step ${componentId}.`,
    );
  }

  return (node["args"] as JSONObject)["code"] as string;
};

export type RunScriptFunction = (data: {
  templateId: string;
  componentId: string;
  args: JSONValue;
  /** Lets a test exercise the customization hooks the scripts document. */
  editCode?: ((code: string) => string) | undefined;
}) => Promise<JSONObject>;

/*
 * Runs a template's script in the same isolated-vm sandbox the workflow
 * runner uses, so a global the sandbox does not have (btoa, URL, Buffer)
 * fails here exactly as it would in production. A script that throws fails
 * the test rather than quietly returning nothing.
 */
export const runJiraScript: RunScriptFunction = async (data: {
  templateId: string;
  componentId: string;
  args: JSONValue;
  editCode?: ((code: string) => string) | undefined;
}): Promise<JSONObject> => {
  let code: string = scriptOf(data.templateId, data.componentId);

  if (data.editCode) {
    const edited: string = data.editCode(code);

    if (edited === code) {
      throw new Error("editCode did not change the script.");
    }

    code = edited;
  }

  const result: ReturnResult = await VMRunner.runCodeInSandbox({
    code: code,
    options: { args: data.args as JSONObject, timeout: 5000 },
  });

  if (result.scriptError) {
    throw result.scriptError;
  }

  return result.returnValue as JSONObject;
};

export type QuotedFunction = (value: JSONValue) => string;

/*
 * What a script receives for a step output quoted into its JSON arguments,
 * e.g. {"incident": "{{local.components.x.returnValues.model}}"}: the runtime
 * pretty-prints the object and substitutes it as a JSON string.
 */
export const quoted: QuotedFunction = (value: JSONValue): string => {
  return JSON.stringify(value, null, 2);
};
