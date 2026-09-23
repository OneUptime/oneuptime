/*
 * Contract tests for the nine Jira templates' graphs.
 *
 * Templates.test.ts already holds every template, these nine included, to the
 * component registry and to the builder's own linter. What it cannot know is
 * what the Jira templates promise about Jira and promise each other, and that
 * is what these pin:
 *
 *   - How they talk to Jira: one Basic auth secret, sent only as a request
 *     header, and every call under the site's /rest/api/3/.
 *   - How an incident and an issue find each other. Jira holds the link, as
 *     the labels `oneuptime` and `oneuptime-incident-<id>`, and the text each
 *     side writes carries a marker the other side refuses to copy back. A
 *     label is only trusted when exactly one issue carries it.
 *   - That a private incident stays in OneUptime unless someone edits a
 *     script to send it, and that an incident is only declared from an issue
 *     Jira itself says is not linked yet.
 *   - What reaches substitution. The runtime fills an argument's references
 *     one at a time, each into the first place its {{...}} still appears, so
 *     text a Jira user wrote has to be substituted after everything else in
 *     the argument — otherwise a comment that names a later reference takes
 *     that reference's value.
 *   - That nothing is written to either side until a script has read the
 *     event and said to go ahead.
 *
 * The scripts are only read here. Running them is another suite's job.
 */

import {
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
import {
  DEFAULT_LIMIT,
  LIMIT_PER_PROJECT,
} from "../../../Types/Database/LimitMax";
import { loadComponentsAndCategories } from "../../../UI/Components/Workflow/Utils";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentInternalNote from "../../../Models/DatabaseModels/IncidentInternalNote";
import IncidentPublicNote from "../../../Models/DatabaseModels/IncidentPublicNote";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import IncidentStateTimeline from "../../../Models/DatabaseModels/IncidentStateTimeline";
import { describe, expect, test } from "@jest/globals";

/* ------------------------------ The nine ------------------------------ */

const ONEUPTIME_TO_JIRA_TEMPLATE_IDS: Array<string> = [
  "jira-create-issue-for-incident",
  "jira-transition-issue-on-incident-state",
  "jira-comment-from-private-note",
  "jira-comment-from-public-note",
  "jira-comment-on-incident-update",
];

const JIRA_TO_ONEUPTIME_TEMPLATE_IDS: Array<string> = [
  "jira-declare-incident-from-issue",
  "jira-status-to-incident-state",
  "jira-comment-to-private-note",
  "jira-issue-changes-to-private-note",
];

const JIRA_TEMPLATE_IDS: Array<string> = [
  ...ONEUPTIME_TO_JIRA_TEMPLATE_IDS,
  ...JIRA_TO_ONEUPTIME_TEMPLATE_IDS,
];

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

const STARTS_WITH_A_WORD: RegExp = /^[A-Za-z]/;

/** Any Jira REST path other than v3: /rest/api/2/, /rest/api/latest/. */
const NOT_REST_V3: RegExp = /\/rest\/api\/(?!3\/)/;

/** The search endpoint Jira Cloud removed, as opposed to /search/jql. */
const REMOVED_SEARCH: RegExp = /\/rest\/api\/3\/search(?!\/jql)/;

const DATABASE_WRITE_METADATA_ID: RegExp =
  /-(create|update|delete)-(one|many)$/;

/* ------------------------------- Graphs ------------------------------- */

interface TemplateNodeSpec {
  componentId: string;
  metadataId: string;
  componentType: ComponentType;
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

interface JiraNode {
  templateId: string;
  node: TemplateNodeSpec;
}

type NodePredicate = (node: TemplateNodeSpec) => boolean;

type JiraNodesFunction = (
  predicate?: NodePredicate | undefined,
) => Array<JiraNode>;

/** Every step in the nine templates, optionally only those a predicate keeps. */
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
 * arguments are JSON, and which are kept out of the run log.
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

type HelperRegexFunction = (name: string) => RegExp;

/** A regular expression the helper block declares, rebuilt so it can be tried here. */
const helperRegex: HelperRegexFunction = (name: string): RegExp => {
  const code: string = scriptCode(
    "jira-create-issue-for-incident",
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
 * issue key that matched ISSUE_KEY, an incident id that matched UUID or was
 * read off a OneUptime record, and the ids of OneUptime rows the script chose.
 * Anything else such a script returns may carry text from Jira.
 */
const CHECKED_SCRIPT_FIELDS: Array<string> = [
  "proceed",
  "issueKey",
  "incidentId",
  "stateId",
  "incidentSeverityId",
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

/** The three OneUptime -> Jira comment templates share one shape. */
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

const EXPECTED_GRAPHS: Record<string, ExpectedGraph> = {
  "jira-create-issue-for-incident": {
    nodes: {
      "incident-on-create-1": "incident-on-create",
      "prepare-issue-1": ComponentID.JavaScriptCode,
      "log-prepare-failed": ComponentID.Log,
      "if-create-1": ComponentID.IfElse,
      "log-skipped": ComponentID.Log,
      "create-issue-1": ComponentID.ApiPost,
      "log-created": ComponentID.Log,
      "log-create-failed": ComponentID.Log,
    },
    edges: [
      "incident-on-create-1:success->prepare-issue-1",
      "prepare-issue-1:success->if-create-1",
      "prepare-issue-1:error->log-prepare-failed",
      "if-create-1:yes->create-issue-1",
      "if-create-1:no->log-skipped",
      "create-issue-1:success->log-created",
      "create-issue-1:error->log-create-failed",
    ],
  },
  "jira-transition-issue-on-incident-state": {
    nodes: {
      "incident-on-update-1": "incident-on-update",
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
      "incident-on-update-1:success->find-issue-1",
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
  "jira-comment-from-private-note": commentGraph(
    "note-on-create-1",
    "incident-internal-note-on-create",
  ),
  "jira-comment-from-public-note": commentGraph(
    "note-on-create-1",
    "incident-public-note-on-create",
  ),
  "jira-comment-on-incident-update": commentGraph(
    "incident-on-update-1",
    "incident-on-update",
  ),
  "jira-declare-incident-from-issue": {
    nodes: {
      "webhook-1": ComponentID.Webhook,
      "find-severities-1": "incident-severity-find-many",
      "log-severities-failed": ComponentID.Log,
      "prepare-incident-1": ComponentID.JavaScriptCode,
      "log-prepare-failed": ComponentID.Log,
      "if-declare-1": ComponentID.IfElse,
      "log-skipped": ComponentID.Log,
      "get-issue-1": ComponentID.ApiGet,
      "log-get-issue-failed": ComponentID.Log,
      "confirm-unlinked-1": ComponentID.JavaScriptCode,
      "log-confirm-failed": ComponentID.Log,
      "if-unlinked-1": ComponentID.IfElse,
      "log-already-linked": ComponentID.Log,
      "create-incident-1": "incident-create-one",
      "log-create-failed": ComponentID.Log,
      "link-issue-1": ComponentID.ApiPut,
      "log-linked": ComponentID.Log,
      "log-link-failed": ComponentID.Log,
    },
    edges: [
      "webhook-1:out->find-severities-1",
      "find-severities-1:success->prepare-incident-1",
      "find-severities-1:error->log-severities-failed",
      "prepare-incident-1:success->if-declare-1",
      "prepare-incident-1:error->log-prepare-failed",
      "if-declare-1:yes->get-issue-1",
      "if-declare-1:no->log-skipped",
      "get-issue-1:success->confirm-unlinked-1",
      "get-issue-1:error->log-get-issue-failed",
      "confirm-unlinked-1:success->if-unlinked-1",
      "confirm-unlinked-1:error->log-confirm-failed",
      "if-unlinked-1:yes->create-incident-1",
      "if-unlinked-1:no->log-already-linked",
      "create-incident-1:success->link-issue-1",
      "create-incident-1:error->log-create-failed",
      "link-issue-1:success->log-linked",
      "link-issue-1:error->log-link-failed",
    ],
  },
  "jira-status-to-incident-state": {
    nodes: {
      "webhook-1": ComponentID.Webhook,
      "read-event-1": ComponentID.JavaScriptCode,
      "log-read-failed": ComponentID.Log,
      "if-status-changed-1": ComponentID.IfElse,
      "log-ignored": ComponentID.Log,
      "find-incident-1": "incident-find-one",
      "log-find-incident-failed": ComponentID.Log,
      "find-states-1": "incident-state-find-many",
      "log-find-states-failed": ComponentID.Log,
      "decide-state-1": ComponentID.JavaScriptCode,
      "log-decide-failed": ComponentID.Log,
      "if-change-1": ComponentID.IfElse,
      "log-unchanged": ComponentID.Log,
      "change-state-1": "incident-state-timeline-create-one",
      "log-changed": ComponentID.Log,
      "log-change-failed": ComponentID.Log,
    },
    edges: [
      "webhook-1:out->read-event-1",
      "read-event-1:success->if-status-changed-1",
      "read-event-1:error->log-read-failed",
      "if-status-changed-1:yes->find-incident-1",
      "if-status-changed-1:no->log-ignored",
      "find-incident-1:success->find-states-1",
      "find-incident-1:error->log-find-incident-failed",
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
  "jira-comment-to-private-note": {
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
      "find-incident-1": "incident-find-one",
      "log-find-incident-failed": ComponentID.Log,
      "if-found-1": ComponentID.IfElse,
      "log-not-found": ComponentID.Log,
      "create-note-1": "incident-internal-note-create-one",
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
      "if-linked-1:yes->find-incident-1",
      "if-linked-1:no->log-not-linked",
      "find-incident-1:success->if-found-1",
      "find-incident-1:error->log-find-incident-failed",
      "if-found-1:yes->create-note-1",
      "if-found-1:no->log-not-found",
      "create-note-1:success->log-noted",
      "create-note-1:error->log-note-failed",
    ],
  },
  "jira-issue-changes-to-private-note": {
    nodes: {
      "webhook-1": ComponentID.Webhook,
      "read-changes-1": ComponentID.JavaScriptCode,
      "log-read-failed": ComponentID.Log,
      "if-changed-1": ComponentID.IfElse,
      "log-ignored": ComponentID.Log,
      "find-incident-1": "incident-find-one",
      "log-find-incident-failed": ComponentID.Log,
      "if-found-1": ComponentID.IfElse,
      "log-not-found": ComponentID.Log,
      "create-note-1": "incident-internal-note-create-one",
      "log-noted": ComponentID.Log,
      "log-note-failed": ComponentID.Log,
    },
    edges: [
      "webhook-1:out->read-changes-1",
      "read-changes-1:success->if-changed-1",
      "read-changes-1:error->log-read-failed",
      "if-changed-1:yes->find-incident-1",
      "if-changed-1:no->log-ignored",
      "find-incident-1:success->if-found-1",
      "find-incident-1:error->log-find-incident-failed",
      "if-found-1:yes->create-note-1",
      "if-found-1:no->log-not-found",
      "create-note-1:success->log-noted",
      "create-note-1:error->log-note-failed",
    ],
  },
};

interface JiraCall {
  componentId: string;
  metadataId: string;
  url: string;
}

const REST: string = `${BASE_URL}/rest/api/3`;

/** Every call each template makes to Jira, in graph order. */
const EXPECTED_JIRA_CALLS: Record<string, Array<JiraCall>> = {
  "jira-create-issue-for-incident": [
    {
      componentId: "create-issue-1",
      metadataId: ComponentID.ApiPost,
      url: `${REST}/issue`,
    },
  ],
  "jira-transition-issue-on-incident-state": [
    {
      componentId: "find-issue-1",
      metadataId: ComponentID.ApiPost,
      url: `${REST}/search/jql`,
    },
    {
      componentId: "transition-issue-1",
      metadataId: ComponentID.ApiPost,
      url: `${REST}/issue/${scriptOutput("plan-transition-1", "issueKey")}/transitions`,
    },
  ],
  "jira-comment-from-private-note": [
    {
      componentId: "find-issue-1",
      metadataId: ComponentID.ApiPost,
      url: `${REST}/search/jql`,
    },
    {
      componentId: "post-comment-1",
      metadataId: ComponentID.ApiPost,
      url: `${REST}/issue/${scriptOutput("build-comment-1", "issueKey")}/comment`,
    },
  ],
  "jira-comment-from-public-note": [
    {
      componentId: "find-issue-1",
      metadataId: ComponentID.ApiPost,
      url: `${REST}/search/jql`,
    },
    {
      componentId: "post-comment-1",
      metadataId: ComponentID.ApiPost,
      url: `${REST}/issue/${scriptOutput("build-comment-1", "issueKey")}/comment`,
    },
  ],
  "jira-comment-on-incident-update": [
    {
      componentId: "find-issue-1",
      metadataId: ComponentID.ApiPost,
      url: `${REST}/search/jql`,
    },
    {
      componentId: "post-comment-1",
      metadataId: ComponentID.ApiPost,
      url: `${REST}/issue/${scriptOutput("build-comment-1", "issueKey")}/comment`,
    },
  ],
  "jira-declare-incident-from-issue": [
    {
      componentId: "get-issue-1",
      metadataId: ComponentID.ApiGet,
      url: `${REST}/issue/${scriptOutput("prepare-incident-1", "issueKey")}?fields=labels`,
    },
    {
      componentId: "link-issue-1",
      metadataId: ComponentID.ApiPut,
      url: `${REST}/issue/${scriptOutput("prepare-incident-1", "issueKey")}`,
    },
  ],
  "jira-status-to-incident-state": [],
  "jira-comment-to-private-note": [
    {
      componentId: "get-issue-1",
      metadataId: ComponentID.ApiGet,
      url: `${REST}/issue/${scriptOutput("read-comment-1", "issueKey")}?fields=labels`,
    },
  ],
  "jira-issue-changes-to-private-note": [],
};

const EXPECTED_VARIABLES: Record<string, Array<string>> = {
  "jira-create-issue-for-incident": [
    "jiraBaseUrl",
    "jiraBasicAuthToken",
    "jiraProjectKey",
    "jiraIssueType",
    "oneuptimeUrl",
  ],
  "jira-transition-issue-on-incident-state": [
    "jiraBaseUrl",
    "jiraBasicAuthToken",
  ],
  "jira-comment-from-private-note": ["jiraBaseUrl", "jiraBasicAuthToken"],
  "jira-comment-from-public-note": ["jiraBaseUrl", "jiraBasicAuthToken"],
  "jira-comment-on-incident-update": ["jiraBaseUrl", "jiraBasicAuthToken"],
  "jira-declare-incident-from-issue": ["jiraBaseUrl", "jiraBasicAuthToken"],
  // Webhook in, OneUptime out: nothing to call, so nothing to configure.
  "jira-status-to-incident-state": [],
  "jira-comment-to-private-note": ["jiraBaseUrl", "jiraBasicAuthToken"],
  "jira-issue-changes-to-private-note": [],
};

interface ExpectedTrigger {
  componentId: string;
  metadataId: string;
}

const EXPECTED_TRIGGERS: Record<string, ExpectedTrigger> = {
  "jira-create-issue-for-incident": {
    componentId: "incident-on-create-1",
    metadataId: "incident-on-create",
  },
  "jira-transition-issue-on-incident-state": {
    componentId: "incident-on-update-1",
    metadataId: "incident-on-update",
  },
  "jira-comment-from-private-note": {
    componentId: "note-on-create-1",
    metadataId: "incident-internal-note-on-create",
  },
  "jira-comment-from-public-note": {
    componentId: "note-on-create-1",
    metadataId: "incident-public-note-on-create",
  },
  "jira-comment-on-incident-update": {
    componentId: "incident-on-update-1",
    metadataId: "incident-on-update",
  },
  "jira-declare-incident-from-issue": {
    componentId: "webhook-1",
    metadataId: ComponentID.Webhook,
  },
  "jira-status-to-incident-state": {
    componentId: "webhook-1",
    metadataId: ComponentID.Webhook,
  },
  "jira-comment-to-private-note": {
    componentId: "webhook-1",
    metadataId: ComponentID.Webhook,
  },
  "jira-issue-changes-to-private-note": {
    componentId: "webhook-1",
    metadataId: ComponentID.Webhook,
  },
};

/** What each template writes to OneUptime. */
const EXPECTED_DATABASE_WRITES: Record<string, Array<string>> = {
  "jira-create-issue-for-incident": [],
  "jira-transition-issue-on-incident-state": [],
  "jira-comment-from-private-note": [],
  "jira-comment-from-public-note": [],
  "jira-comment-on-incident-update": [],
  "jira-declare-incident-from-issue": ["incident-create-one"],
  "jira-status-to-incident-state": ["incident-state-timeline-create-one"],
  "jira-comment-to-private-note": ["incident-internal-note-create-one"],
  "jira-issue-changes-to-private-note": ["incident-internal-note-create-one"],
};

interface WebhookSetup {
  /** The event the setup instructions tell the user to register. */
  registeredFor: string;
  /** The webhookEvent value the template's first script accepts. */
  webhookEvent: string;
  scriptId: string;
}

const WEBHOOK_SETUP: Record<string, WebhookSetup> = {
  "jira-declare-incident-from-issue": {
    registeredFor: "Issue created",
    webhookEvent: "jira:issue_created",
    scriptId: "prepare-incident-1",
  },
  "jira-status-to-incident-state": {
    registeredFor: "Issue updated",
    webhookEvent: "jira:issue_updated",
    scriptId: "read-event-1",
  },
  "jira-comment-to-private-note": {
    registeredFor: "Comment created",
    webhookEvent: "comment_created",
    scriptId: "read-comment-1",
  },
  "jira-issue-changes-to-private-note": {
    registeredFor: "Issue updated",
    webhookEvent: "jira:issue_updated",
    scriptId: "read-changes-1",
  },
};

interface SearchExpectation {
  incidentIdReference: string;
  fields: Array<string>;
  expandsTransitions: boolean;
  /** The one script handed the search's answer. */
  scriptId: string;
  /** How that script names the incident to linkedIssue: the one the search asked about. */
  scriptIncidentId: string;
}

/*
 * The search's JQL, oldest issue first. Two results, not one: linkedIssue has
 * to see a second labelled issue to refuse it.
 */
const SEARCH_ORDER: string = " ORDER BY created ASC";

const SEARCH_MAX_RESULTS: number = 2;

const EXPECTED_SEARCHES: Record<string, SearchExpectation> = {
  "jira-transition-issue-on-incident-state": {
    incidentIdReference: componentReturnValueReference(
      "incident-on-update-1",
      "model",
      ["_id"],
    ),
    fields: ["key", "status"],
    expandsTransitions: true,
    scriptId: "plan-transition-1",
    scriptIncidentId: "asText(incident._id)",
  },
  "jira-comment-from-private-note": {
    incidentIdReference: componentReturnValueReference(
      "note-on-create-1",
      "model",
      ["incidentId", "value"],
    ),
    fields: ["key", "summary"],
    expandsTransitions: false,
    scriptId: "build-comment-1",
    scriptIncidentId: "valueOf(note.incidentId)",
  },
  "jira-comment-from-public-note": {
    incidentIdReference: componentReturnValueReference(
      "note-on-create-1",
      "model",
      ["incidentId", "value"],
    ),
    fields: ["key", "summary"],
    expandsTransitions: false,
    scriptId: "build-comment-1",
    scriptIncidentId: "valueOf(note.incidentId)",
  },
  "jira-comment-on-incident-update": {
    incidentIdReference: componentReturnValueReference(
      "incident-on-update-1",
      "model",
      ["_id"],
    ),
    fields: ["key", "summary"],
    expandsTransitions: false,
    scriptId: "build-comment-1",
    scriptIncidentId: "asText(incident._id)",
  },
};

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

interface PrivateIncidentCheck {
  templateId: string;
  scriptId: string;
  /** The key in the script's arguments the OneUptime record arrives under. */
  argumentKey: string;
  /** Where isPrivate sits in that record's select. */
  selectPath: Array<string>;
  /** The condition the script skips on. */
  condition: string;
  /** Code in the script that must only run once the private check has passed. */
  checkedBefore: Array<string>;
}

const SYNC_PRIVATE_INCIDENTS_DECLARATION: string =
  "\nconst SYNC_PRIVATE_INCIDENTS = false;\n";

/*
 * Every OneUptime -> Jira script, and how it keeps a private incident in
 * OneUptime. A private incident's notes and details were not written for
 * whoever can read the Jira project.
 */
const PRIVATE_INCIDENT_CHECKS: Array<PrivateIncidentCheck> = [
  {
    templateId: "jira-create-issue-for-incident",
    scriptId: "prepare-issue-1",
    argumentKey: "incident",
    selectPath: ["isPrivate"],
    condition: "incident.isPrivate === true && !SYNC_PRIVATE_INCIDENTS",
    checkedBefore: ["asText(customFields.jiraIssueKey)", "proceed: true"],
  },
  {
    templateId: "jira-transition-issue-on-incident-state",
    scriptId: "plan-transition-1",
    argumentKey: "incident",
    selectPath: ["isPrivate"],
    condition: "incident.isPrivate === true && !SYNC_PRIVATE_INCIDENTS",
    checkedBefore: ["linkedIssue(", "proceed: true"],
  },
  {
    templateId: "jira-comment-from-private-note",
    scriptId: "build-comment-1",
    argumentKey: "note",
    selectPath: ["incident", "isPrivate"],
    condition:
      "note.incident && note.incident.isPrivate === true && !SYNC_PRIVATE_INCIDENTS",
    // An empty note on a private incident is reported as private, not as empty.
    checkedBefore: ["if (!text) return skip(", "linkedIssue(", "proceed: true"],
  },
  {
    templateId: "jira-comment-from-public-note",
    scriptId: "build-comment-1",
    argumentKey: "note",
    selectPath: ["incident", "isPrivate"],
    condition:
      "note.incident && note.incident.isPrivate === true && !SYNC_PRIVATE_INCIDENTS",
    checkedBefore: ["if (!text) return skip(", "linkedIssue(", "proceed: true"],
  },
  {
    templateId: "jira-comment-on-incident-update",
    scriptId: "build-comment-1",
    argumentKey: "incident",
    selectPath: ["isPrivate"],
    condition: "incident.isPrivate === true && !SYNC_PRIVATE_INCIDENTS",
    checkedBefore: ["linkedIssue(", "proceed: true"],
  },
];

/*
 * The only route from the declare template's webhook to the incident it
 * creates: the event script says go, then Jira is asked for the issue's
 * labels as they are now, and a second script checks those.
 */
const DECLARE_ROUTE_TO_INCIDENT: string = [
  "webhook-1:out",
  "find-severities-1:success",
  "prepare-incident-1:success",
  "if-declare-1:yes",
  "get-issue-1:success",
  "confirm-unlinked-1:success",
  "if-unlinked-1:yes",
  "create-incident-1",
].join("->");

/** The Jira-side check every route to a write in the declare template passes through. */
const DECLARE_JIRA_SIDE_CHECK: string =
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

/*
 * What each script reads off the OneUptime records it is handed. The generic
 * select check only sees {{...}} references; a script reads the whole record,
 * so a field it needs and the select forgot arrives as undefined and the
 * script quietly takes its fallback.
 */
const RECORD_READS: Array<RecordRead> = [
  {
    templateId: "jira-create-issue-for-incident",
    scriptId: "prepare-issue-1",
    argumentKey: "incident",
    fields: [
      "_id",
      "projectId",
      "title",
      "description",
      "incidentNumberWithPrefix",
      "isPrivate",
      "customFields",
      "incidentSeverity.name",
      "currentIncidentState.name",
    ],
  },
  {
    templateId: "jira-transition-issue-on-incident-state",
    scriptId: "plan-transition-1",
    argumentKey: "incident",
    fields: [
      "_id",
      "incidentNumberWithPrefix",
      "isPrivate",
      "currentIncidentState.name",
      "currentIncidentState.isAcknowledgedState",
      "currentIncidentState.isResolvedState",
    ],
  },
  {
    templateId: "jira-comment-from-private-note",
    scriptId: "build-comment-1",
    argumentKey: "note",
    fields: [
      "note",
      "incidentId",
      "incident.incidentNumberWithPrefix",
      "incident.isPrivate",
      "createdByUser.name",
    ],
  },
  {
    templateId: "jira-comment-from-public-note",
    scriptId: "build-comment-1",
    argumentKey: "note",
    fields: [
      "note",
      "incidentId",
      "incident.incidentNumberWithPrefix",
      "incident.isPrivate",
      "createdByUser.name",
    ],
  },
  {
    templateId: "jira-comment-on-incident-update",
    scriptId: "build-comment-1",
    argumentKey: "incident",
    fields: [
      "_id",
      "incidentNumberWithPrefix",
      "isPrivate",
      "title",
      "description",
      "rootCause",
      "remediationNotes",
      "incidentSeverity.name",
      "currentIncidentState.name",
    ],
  },
  {
    templateId: "jira-declare-incident-from-issue",
    scriptId: "prepare-incident-1",
    argumentKey: "severities",
    fields: ["_id", "name", "order"],
  },
  {
    templateId: "jira-status-to-incident-state",
    scriptId: "decide-state-1",
    argumentKey: "incident",
    fields: [
      "_id",
      "incidentNumberWithPrefix",
      "currentIncidentState.name",
      "currentIncidentState.order",
    ],
  },
  {
    templateId: "jira-status-to-incident-state",
    scriptId: "decide-state-1",
    argumentKey: "states",
    fields: ["_id", "name", "order", "isAcknowledgedState", "isResolvedState"],
  },
];

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
};

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
  test("the Jira category holds exactly the nine, OneUptime -> Jira first", () => {
    expect(
      getWorkflowTemplatesByCategory(WorkflowTemplateCategory.Jira).map(
        (template: WorkflowTemplate) => {
          return template.id;
        },
      ),
    ).toEqual(JIRA_TEMPLATE_IDS);
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
   * templates with one name would give two cards one id — and nine new
   * templates are nine new chances of that.
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
   * Once created, the workflow sits in a list among everything else the
   * project has, with no category beside it.
   */
  test("the suggested workflow name says it is a Jira workflow", () => {
    for (const templateId of JIRA_TEMPLATE_IDS) {
      expect(templateOf(templateId).workflowName).toContain("Jira");
    }
  });

  test("a webhook template's setup names the Jira event its script accepts", () => {
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
   * into each wizard, so the fields must read the same everywhere.
   */
  test("a variable shared between Jira templates is the same definition everywhere", () => {
    const byName: Map<string, WorkflowTemplateVariable> = new Map();

    for (const templateId of JIRA_TEMPLATE_IDS) {
      for (const variable of templateOf(templateId).variables) {
        const first: WorkflowTemplateVariable | undefined = byName.get(
          variable.name,
        );

        if (!first) {
          byName.set(variable.name, variable);
          continue;
        }

        expect(variable).toEqual(first);
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
      "jira-create-issue-for-incident",
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
      "jira-create-issue-for-incident",
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
      "jira-create-issue-for-incident",
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

    expected.push(
      "jira-create-issue-for-incident jiraProjectKey in create-issue-1.request-body",
      "jira-create-issue-for-incident jiraIssueType in create-issue-1.request-body",
      "jira-create-issue-for-incident oneuptimeUrl in prepare-issue-1.arguments",
    );

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

    expect(checked).toBeGreaterThanOrEqual(7);
  });

  test("a script checks the issue key itself, or takes it from linkedIssue", () => {
    const checks: Record<string, string> = {};

    for (const { templateId, node } of jiraNodes(isScriptNode)) {
      const check: string = issueKeyCheck(textArg(node, "code"));

      if (check) {
        checks[`${templateId} ${node.componentId}`] = check;
      }
    }

    expect(checks).toEqual({
      "jira-transition-issue-on-incident-state plan-transition-1":
        "takes it from linkedIssue",
      "jira-comment-from-private-note build-comment-1":
        "takes it from linkedIssue",
      "jira-comment-from-public-note build-comment-1":
        "takes it from linkedIssue",
      "jira-comment-on-incident-update build-comment-1":
        "takes it from linkedIssue",
      "jira-declare-incident-from-issue prepare-incident-1": "tests the key",
      "jira-declare-incident-from-issue confirm-unlinked-1": "tests the key",
      "jira-comment-to-private-note read-comment-1": "tests the key",
      "jira-status-to-incident-state read-event-1": "tests the key",
      "jira-issue-changes-to-private-note read-changes-1": "tests the key",
    });
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
    "%s finds the issue by the incident's label, asking for its key and a second match, oldest first",
    (templateId: string) => {
      const search: SearchExpectation = lookup(EXPECTED_SEARCHES, templateId);
      const node: TemplateNodeSpec = nodeOf(templateId, "find-issue-1");
      const body: JSONObject = jsonArg(node, "request-body");

      expect(node.metadataId).toBe(ComponentID.ApiPost);
      expect(textArg(node, "url")).toBe(`${REST}/search/jql`);
      expect(body["fields"]).toContain("key");
      expect(body).toEqual({
        jql: `labels = "${JIRA_INCIDENT_LABEL_PREFIX}${search.incidentIdReference}"${SEARCH_ORDER}`,
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
   * filed for the incident before its clones, and names them the same way
   * every run.
   */
  test("every search asks for two issues, oldest first, so a second labelled issue is seen", () => {
    const searches: Array<JiraNode> = jiraNodes((node: TemplateNodeSpec) => {
      return isApiNode(node) && textArg(node, "url").endsWith("/search/jql");
    });

    expect(searches).toHaveLength(Object.keys(EXPECTED_SEARCHES).length);

    for (const { templateId, node } of searches) {
      const body: JSONObject = jsonArg(node, "request-body");
      const jql: string = String(body["jql"]);

      expect({
        at: `${templateId} ${node.componentId}`,
        byIncidentLabel: jql.startsWith(
          `labels = "${JIRA_INCIDENT_LABEL_PREFIX}`,
        ),
        oldestFirst: jql.endsWith(SEARCH_ORDER),
        orderedOnce: jql.split("ORDER BY").length - 1,
        maxResults: body["maxResults"],
      }).toEqual({
        at: `${templateId} ${node.componentId}`,
        byIncidentLabel: true,
        oldestFirst: true,
        orderedOnce: 1,
        maxResults: SEARCH_MAX_RESULTS,
      });
    }
  });

  /*
   * Asking for two only helps if the script refuses the second. Each search's
   * answer goes to one script, which takes it through linkedIssue — never
   * search.issues[0] — and names the same incident the search asked about.
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

      expect(body).toContain(
        `linkedIssue(search, ${search.scriptIncidentId});`,
      );
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
  test("linkedIssue hands back an issue only when exactly one valid issue carries the label", () => {
    const helpers: string = helperBlock(
      scriptCode("jira-create-issue-for-incident", "prepare-issue-1"),
    );
    const start: number = indexOrFail(
      helpers,
      "const linkedIssue = (search, incidentId) => {",
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
      "const label = INCIDENT_LABEL_PREFIX + incidentId;",
    );
  });

  test("every search in the Jira templates is one of those", () => {
    const searches: Array<string> = jiraNodes(isApiNode)
      .filter(({ node }: JiraNode) => {
        return textArg(node, "url").includes("/search");
      })
      .map(({ templateId, node }: JiraNode) => {
        return `${templateId} ${node.componentId}`;
      });

    expect(searches).toEqual(
      Object.keys(EXPECTED_SEARCHES).map((templateId: string) => {
        return `${templateId} find-issue-1`;
      }),
    );
  });

  /*
   * The transitions available from the issue's current status come back with
   * the search, which saves a call — and only the transition template needs
   * them, along with the status it compares against.
   */
  test("only the transition template expands transitions, and its script reads them", () => {
    const expanding: Array<string> = jiraNodes(isApiNode)
      .filter(({ node }: JiraNode) => {
        const body: JSONValue | undefined = node.args?.["request-body"];
        return typeof body === "string" && body.includes('"expand"');
      })
      .map(({ templateId, node }: JiraNode) => {
        return `${templateId} ${node.componentId}`;
      });

    expect(expanding).toEqual([
      "jira-transition-issue-on-incident-state find-issue-1",
    ]);

    const plan: string = scriptCode(
      "jira-transition-issue-on-incident-state",
      "plan-transition-1",
    );

    expect(plan).toContain("issue.transitions");
    expect(plan).toContain("issue.fields.status");
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

    expect(checked).toBeGreaterThan(20);
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

    expect(found).toEqual([
      "jira-create-issue-for-incident create-issue-1",
      "jira-comment-from-private-note post-comment-1",
      "jira-comment-from-public-note post-comment-1",
      "jira-comment-on-incident-update post-comment-1",
    ]);
  });

  test("the new issue is filed in the configured project and type, labelled with the link", () => {
    const body: JSONObject = jsonArg(
      nodeOf("jira-create-issue-for-incident", "create-issue-1"),
      "request-body",
    );

    expect(body).toEqual({
      fields: {
        project: { key: variableReference("jiraProjectKey") },
        issuetype: { name: variableReference("jiraIssueType") },
        summary: scriptOutput("prepare-issue-1", "summary"),
        labels: [
          JIRA_LINK_LABEL,
          scriptOutput("prepare-issue-1", "incidentLabel"),
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
                  text: "Open this incident in OneUptime",
                  marks: [
                    {
                      type: "link",
                      attrs: {
                        href: scriptOutput("prepare-issue-1", "incidentUrl"),
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
  });

  test.each([
    "jira-comment-from-private-note",
    "jira-comment-from-public-note",
    "jira-comment-on-incident-update",
  ])("%s posts the script's comment as one paragraph", (templateId: string) => {
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
            { type: "text", text: scriptOutput("build-comment-1", "comment") },
          ],
        },
      ],
    });
  });

  /*
   * Jira Service Management shows a comment to the customer unless it is
   * marked internal. A private note is private, a public note is not, and an
   * incident's root cause and remediation are for the team.
   */
  test.each([
    "jira-comment-from-private-note",
    "jira-comment-on-incident-update",
  ])("%s posts an internal comment", (templateId: string) => {
    const body: JSONObject = jsonArg(
      nodeOf(templateId, "post-comment-1"),
      "request-body",
    );

    expect(Object.keys(body).sort()).toEqual(["body", "properties"]);
    expect(body["properties"]).toEqual(INTERNAL_COMMENT_PROPERTIES);
  });

  test("a public note becomes an ordinary comment the customer can see", () => {
    const publicBody: JSONObject = jsonArg(
      nodeOf("jira-comment-from-public-note", "post-comment-1"),
      "request-body",
    );

    expect(Object.keys(publicBody)).toEqual(["body"]);
  });

  /*
   * The edit comment quotes the root cause and remediation notes, which are
   * no more for the customer than a private note is. So it is marked the
   * same way, and the one comment a customer may see is the public note's.
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

    expect(internal).toEqual({
      "jira-comment-from-private-note post-comment-1": true,
      "jira-comment-from-public-note post-comment-1": false,
      "jira-comment-on-incident-update post-comment-1": true,
    });
  });

  test("the incident-edit comment is the script's comment, marked internal like a private note's", () => {
    const edit: JSONObject = jsonArg(
      nodeOf("jira-comment-on-incident-update", "post-comment-1"),
      "request-body",
    );
    const privateNote: JSONObject = jsonArg(
      nodeOf("jira-comment-from-private-note", "post-comment-1"),
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
  });

  /*
   * Transitions with a screen may ask for fields; the script prefers ones
   * without, and the body sends nothing that one without a screen would
   * refuse.
   */
  test("the transition body names only the transition", () => {
    expect(
      jsonArg(
        nodeOf("jira-transition-issue-on-incident-state", "transition-issue-1"),
        "request-body",
      ),
    ).toEqual({
      transition: { id: scriptOutput("plan-transition-1", "transitionId") },
    });
  });

  /*
   * `update.labels` with `add` keeps the labels the reporter set. Setting
   * `fields.labels` would replace them with the two links.
   */
  test("the declared incident is linked back by adding labels to the issue, not replacing them", () => {
    const link: TemplateNodeSpec = nodeOf(
      "jira-declare-incident-from-issue",
      "link-issue-1",
    );
    const body: JSONObject = jsonArg(link, "request-body");

    expect(body).toEqual({
      update: {
        labels: [
          { add: JIRA_LINK_LABEL },
          {
            add: `${JIRA_INCIDENT_LABEL_PREFIX}${componentReturnValueReference(
              "create-incident-1",
              "model",
              ["_id"],
            )}`,
          },
        ],
      },
    });
    expect(body["fields"]).toBeUndefined();
  });
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
    expect(argumentsWithJiraText).toBeGreaterThan(10);
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

  test("the webhook payload and Jira's answers are what the check treats as Jira text", () => {
    // A guard on the guard: the two tests above are only as good as this.
    const declare: string = "jira-declare-incident-from-issue";

    expect(
      isFromJira(
        declare,
        referencesIn(
          componentReturnValueReference("webhook-1", "request-body"),
        )[0] as Reference,
      ),
    ).toBe(true);
    expect(
      isFromJira(
        declare,
        referencesIn(
          scriptOutput("prepare-incident-1", "title"),
        )[0] as Reference,
      ),
    ).toBe(true);
    expect(
      isFromJira(
        declare,
        referencesIn(
          scriptOutput("prepare-incident-1", "issueKey"),
        )[0] as Reference,
      ),
    ).toBe(false);
    expect(
      isFromJira(
        declare,
        referencesIn(
          componentReturnValueReference("find-severities-1", "models"),
        )[0] as Reference,
      ),
    ).toBe(false);
    for (const templateId of [
      "jira-comment-to-private-note",
      "jira-declare-incident-from-issue",
    ]) {
      expect(
        isFromJira(
          templateId,
          referencesIn(
            componentReturnValueReference("get-issue-1", "response-body"),
          )[0] as Reference,
        ),
      ).toBe(true);
    }

    // A script that read Jira's answer returns Jira text, bar what it checked.
    expect(
      isFromJira(
        declare,
        referencesIn(
          scriptOutput("confirm-unlinked-1", "reason"),
        )[0] as Reference,
      ),
    ).toBe(true);
    expect(
      isFromJira(
        declare,
        referencesIn(
          scriptOutput("confirm-unlinked-1", "proceed"),
        )[0] as Reference,
      ),
    ).toBe(false);
    expect(
      isFromJira(
        "jira-create-issue-for-incident",
        referencesIn(
          scriptOutput("prepare-issue-1", "description"),
        )[0] as Reference,
      ),
    ).toBe(false);
  });
});

describe("Jira template scripts", () => {
  const scripts: Array<JiraNode> = jiraNodes(isScriptNode);

  test("there is one per decision the templates make", () => {
    expect(
      scripts.map(({ templateId, node }: JiraNode) => {
        return `${templateId} ${node.componentId}`;
      }),
    ).toEqual([
      "jira-create-issue-for-incident prepare-issue-1",
      "jira-transition-issue-on-incident-state plan-transition-1",
      "jira-comment-from-private-note build-comment-1",
      "jira-comment-from-public-note build-comment-1",
      "jira-comment-on-incident-update build-comment-1",
      "jira-declare-incident-from-issue prepare-incident-1",
      "jira-declare-incident-from-issue confirm-unlinked-1",
      "jira-status-to-incident-state read-event-1",
      "jira-status-to-incident-state decide-state-1",
      "jira-comment-to-private-note read-comment-1",
      "jira-comment-to-private-note find-link-1",
      "jira-issue-changes-to-private-note read-changes-1",
    ]);
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

  test("every script starts with the same shared helper block", () => {
    const first: string = helperBlock(
      textArg(scripts[0]?.node as TemplateNodeSpec, "code"),
    );

    expect(first.length).toBeGreaterThan(0);

    for (const { templateId, node } of scripts) {
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
  });

  test("the helper block's markers and labels are the exported constants", () => {
    const helpers: string = helperBlock(
      scriptCode("jira-create-issue-for-incident", "prepare-issue-1"),
    );

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
      `\nconst INCIDENT_LABEL_PREFIX = ${JSON.stringify(JIRA_INCIDENT_LABEL_PREFIX)};\n`,
    );
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
  test("the link labels are valid Jira labels with a 36-character id on the end", () => {
    expect(JIRA_LINK_LABEL).toMatch(/^[a-z0-9-]+$/);
    expect(JIRA_INCIDENT_LABEL_PREFIX).toMatch(/^[a-z0-9-]+-$/);
    expect(JIRA_INCIDENT_LABEL_PREFIX.length + 36).toBeLessThanOrEqual(255);
  });

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

    expect(
      helperBlock(
        scriptCode("jira-create-issue-for-incident", "prepare-issue-1"),
      ),
    ).toContain(
      /*
       * A reason can quote Jira's text (an event name, a status name), so it
       * is defused on the way out like every other returned string.
       */
      "const skip = (reason) => ({ proceed: false, reason: defuse(asText(reason)) });",
    );
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

  test("the private-incident switch is in every OneUptime -> Jira script, and only there", () => {
    const outbound: Array<string> = jiraNodes(isScriptNode)
      .filter(({ templateId }: JiraNode) => {
        return ONEUPTIME_TO_JIRA_TEMPLATE_IDS.includes(templateId);
      })
      .map(({ templateId, node }: JiraNode) => {
        return `${templateId} ${node.componentId}`;
      });
    const withSwitch: Array<string> = jiraNodes(isScriptNode)
      .filter(({ node }: JiraNode) => {
        return textArg(node, "code").includes("SYNC_PRIVATE_INCIDENTS");
      })
      .map(({ templateId, node }: JiraNode) => {
        return `${templateId} ${node.componentId}`;
      });
    const listed: Array<string> = PRIVATE_INCIDENT_CHECKS.map(
      (check: PrivateIncidentCheck) => {
        return `${check.templateId} ${check.scriptId}`;
      },
    );

    expect(outbound).toEqual(listed);
    expect(withSwitch).toEqual(listed);
  });

  /*
   * Off by default, and one documented line to turn on: the check reads a
   * flag the trigger was asked for, skips before the script finds the issue
   * or builds anything, and the switch is read nowhere else — so setting it
   * to true lets private incidents through and changes nothing more.
   */
  test.each(
    PRIVATE_INCIDENT_CHECKS.map((check: PrivateIncidentCheck) => {
      return [`${check.templateId} ${check.scriptId}`, check];
    }) as Array<[string, PrivateIncidentCheck]>,
  )(
    "%s keeps a private incident in OneUptime unless SYNC_PRIVATE_INCIDENTS is set",
    (_label: string, check: PrivateIncidentCheck) => {
      const script: TemplateNodeSpec = nodeOf(check.templateId, check.scriptId);
      const body: string = scriptBody(textArg(script, "code"));
      const declaration: number = indexOrFail(
        body,
        SYNC_PRIVATE_INCIDENTS_DECLARATION,
      );
      const lineBefore: string =
        body.slice(0, declaration).split("\n").pop() || "";
      const guard: number = indexOrFail(
        body,
        `if (${check.condition}) {\n  return skip(`,
      );

      expect(body.split("SYNC_PRIVATE_INCIDENTS")).toHaveLength(3);
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
  test("comments written into Jira carry the OneUptime marker, and notes and reasons written from Jira carry the Jira marker", () => {
    for (const templateId of [
      "jira-comment-from-private-note",
      "jira-comment-from-public-note",
      "jira-comment-on-incident-update",
    ]) {
      expect(scriptBody(scriptCode(templateId, "build-comment-1"))).toContain(
        "FROM_ONEUPTIME + ",
      );
    }

    expect(
      jsonArg(
        nodeOf("jira-status-to-incident-state", "change-state-1"),
        "json",
      )["rootCause"],
    ).toBe(scriptOutput("decide-state-1", "rootCause"));
    expect(
      scriptBody(scriptCode("jira-status-to-incident-state", "decide-state-1")),
    ).toContain("defuse(FROM_JIRA + ");

    for (const [templateId, scriptId] of [
      ["jira-comment-to-private-note", "read-comment-1"],
      ["jira-issue-changes-to-private-note", "read-changes-1"],
    ] as Array<[string, string]>) {
      expect(jsonArg(nodeOf(templateId, "create-note-1"), "json")["note"]).toBe(
        scriptOutput(scriptId, "note"),
      );
      expect(scriptBody(scriptCode(templateId, scriptId))).toContain(
        "defuse(FROM_JIRA + ",
      );
    }
  });

  test("each direction skips text carrying the other side's marker", () => {
    for (const templateId of [
      "jira-comment-from-private-note",
      "jira-comment-from-public-note",
    ]) {
      expect(scriptBody(scriptCode(templateId, "build-comment-1"))).toContain(
        "indexOf(FROM_JIRA) !== -1",
      );
    }

    expect(
      scriptBody(scriptCode("jira-comment-to-private-note", "read-comment-1")),
    ).toContain("indexOf(FROM_ONEUPTIME) !== -1");
  });

  /*
   * The create template writes the label from the incident's id, and the
   * other templates search for exactly that label. Both go through the one
   * prefix constant.
   */
  test("the issue label is the prefix and the incident's id, wherever it is made", () => {
    const prepare: string = scriptBody(
      scriptCode("jira-create-issue-for-incident", "prepare-issue-1"),
    );

    expect(prepare).toContain("incidentLabel: INCIDENT_LABEL_PREFIX + ");
    expect(prepare).toContain("UUID.test(asText(incident._id))");

    for (const [templateId, scriptId] of [
      ["jira-status-to-incident-state", "read-event-1"],
      ["jira-issue-changes-to-private-note", "read-changes-1"],
    ] as Array<[string, string]>) {
      expect(scriptBody(scriptCode(templateId, scriptId))).toContain(
        "incidentIdFromLabels(fields.labels)",
      );
    }

    expect(
      scriptBody(scriptCode("jira-comment-to-private-note", "find-link-1")),
    ).toContain("incidentIdFromLabels(issue.fields && issue.fields.labels)");
  });

  /*
   * An incident declared from Jira already has an issue. The declare template
   * records the key in customFields.jiraIssueKey, and the create template
   * reads that same key — through a select that has to ask for customFields.
   */
  test("the create template skips incidents the declare template made, by the key it writes", () => {
    const created: JSONObject = jsonArg(
      nodeOf("jira-declare-incident-from-issue", "create-incident-1"),
      "json",
    );

    expect(created["customFields"]).toEqual({
      jiraIssueKey: scriptOutput("prepare-incident-1", "issueKey"),
    });
    expect(
      scriptBody(
        scriptCode("jira-create-issue-for-incident", "prepare-issue-1"),
      ),
    ).toContain("asText(customFields.jiraIssueKey)");
    expect(
      triggerOf("jira-create-issue-for-incident").args?.["select"],
    ).toEqual(expect.objectContaining({ customFields: true }));
  });
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
   * what stops a label naming another project's incident from being written to.
   */
  test("the only other If / Else is the found-incident check before a note is written", () => {
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

    expect(others).toEqual([
      "jira-comment-to-private-note if-found-1",
      "jira-issue-changes-to-private-note if-found-1",
    ]);

    for (const [templateId, linkingScriptId] of [
      ["jira-comment-to-private-note", "find-link-1"],
      ["jira-issue-changes-to-private-note", "read-changes-1"],
    ] as Array<[string, string]>) {
      expect(nodeOf(templateId, "if-found-1").args).toEqual({
        "input-1-type": ConditionValueType.Text,
        "input-1": componentReturnValueReference("find-incident-1", "model", [
          "_id",
        ]),
        operator: ConditionOperator.EqualTo,
        "input-2-type": ConditionValueType.Text,
        "input-2": scriptOutput(linkingScriptId, "incidentId"),
      });
      expect(targetsOf(templateId, "find-incident-1", "success")).toEqual([
        "if-found-1",
      ]);
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
   * exception is the declare template's read of this project's severities,
   * which does not depend on the payload and which the script needs to
   * choose one.
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

    expect(ungated).toEqual({
      "jira-declare-incident-from-issue": [
        "webhook-1",
        "find-severities-1",
        "prepare-incident-1",
        "if-declare-1",
      ],
      "jira-status-to-incident-state": [
        "webhook-1",
        "read-event-1",
        "if-status-changed-1",
      ],
      "jira-comment-to-private-note": [
        "webhook-1",
        "read-comment-1",
        "if-comment-1",
      ],
      "jira-issue-changes-to-private-note": [
        "webhook-1",
        "read-changes-1",
        "if-changed-1",
      ],
    });
  });

  test("the first step after the webhook reads the event, but the declare template's severity read", () => {
    for (const templateId of JIRA_TO_ONEUPTIME_TEMPLATE_IDS) {
      const first: TemplateNodeSpec = nodeOf(
        templateId,
        targetsOf(templateId, "webhook-1", "out")[0] as string,
      );

      if (templateId !== "jira-declare-incident-from-issue") {
        expect({ templateId: templateId, first: first.metadataId }).toEqual({
          templateId: templateId,
          first: ComponentID.JavaScriptCode,
        });
        continue;
      }

      expect(first.metadataId).toBe("incident-severity-find-many");
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
   * all. The declare script also needs the severities, so it quotes the body
   * — last.
   */
  test("the event script is handed the webhook body whole, or quoted last", () => {
    const body: string = componentReturnValueReference(
      "webhook-1",
      "request-body",
    );

    for (const [templateId, scriptId] of [
      ["jira-status-to-incident-state", "read-event-1"],
      ["jira-comment-to-private-note", "read-comment-1"],
      ["jira-issue-changes-to-private-note", "read-changes-1"],
    ] as Array<[string, string]>) {
      expect(nodeOf(templateId, scriptId).args?.["arguments"]).toBe(body);
    }

    const declareArguments: JSONObject = jsonArg(
      nodeOf("jira-declare-incident-from-issue", "prepare-incident-1"),
      "arguments",
    );

    expect(Object.keys(declareArguments)).toEqual(["severities", "payload"]);
    expect(declareArguments["payload"]).toBe(body);
  });
});

describe("the declare template's check with Jira", () => {
  const templateId: string = "jira-declare-incident-from-issue";

  /*
   * Anyone holding the workflow's URL can post an issue_created event for
   * any issue, labels and all, and Jira retries a delivery after the first
   * one has already labelled the issue. So the webhook's word is not taken:
   * the only route to the incident runs through Jira's own answer.
   */
  test("the only route from the webhook to the incident runs through Jira's answer and its check", () => {
    expect(routesBetween(templateId, "webhook-1", "create-incident-1")).toEqual(
      [DECLARE_ROUTE_TO_INCIDENT],
    );
  });

  test("every write the declare template makes, to either side, is behind that check", () => {
    const writes: Array<string> = specOf(templateId)
      .nodes.filter((node: TemplateNodeSpec) => {
        return isJiraWrite(node) || isDatabaseWrite(node);
      })
      .map((node: TemplateNodeSpec) => {
        return node.componentId;
      });

    expect(writes).toEqual(["create-incident-1", "link-issue-1"]);

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
          checked: route.includes(DECLARE_JIRA_SIDE_CHECK),
        }).toEqual({ write: write, route: route, checked: true });
      }
    }

    expect(routesBetween(templateId, "webhook-1", "link-issue-1")).toEqual([
      `${DECLARE_ROUTE_TO_INCIDENT}:success->link-issue-1`,
    ]);
  });

  /*
   * Removing any one step of the check must cut the webhook off from the
   * incident — the same claim as the single route above, said the way a
   * later edit that adds a shortcut edge would break it.
   */
  test("taking out any step of the check leaves no way to the incident", () => {
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
        reached.has("create-incident-1") || reached.has("link-issue-1");
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
      `${REST}/issue/${scriptOutput("prepare-incident-1", "issueKey")}?fields=labels`,
    );
    expect(get.args?.["request-headers"]).toEqual({
      Authorization: AUTHORIZATION,
    });
    expect(get.args?.["request-body"]).toBeUndefined();
  });

  /*
   * The script reads Jira's answer and nothing else — not the webhook, whose
   * labels are the ones being doubted — and only says go once the answer
   * names a real issue that carries neither link label.
   */
  test("the check reads only Jira's answer, and proceeds only for a real, unlinked issue", () => {
    const confirm: TemplateNodeSpec = nodeOf(templateId, "confirm-unlinked-1");
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
    expect(scriptBody(scriptCode(templateId, "prepare-incident-1"))).toContain(
      "if (isLinked(fields.labels)) {",
    );
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
    ).toContain("no incident was declared");
  });
});

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

  test("the transition template listens only for a change of state", () => {
    expect(
      triggerOf("jira-transition-issue-on-incident-state").args?.["listen-on"],
    ).toEqual({ currentIncidentStateId: true });
  });

  /*
   * The transition template already answers a state change. Listening on
   * state here too would post a comment for every transition as well.
   */
  test("the edit-comment template listens on the edited fields and never on state", () => {
    const listenOn: JSONValue | undefined = triggerOf(
      "jira-comment-on-incident-update",
    ).args?.["listen-on"];

    expect(listenOn).toEqual({
      title: true,
      description: true,
      incidentSeverityId: true,
      rootCause: true,
      remediationNotes: true,
    });
    expect(listenOn).not.toHaveProperty("currentIncidentStateId");
  });

  test("of all the Jira templates, only the transition template reacts to a state change", () => {
    const listening: Array<string> = JIRA_TEMPLATE_IDS.filter(
      (templateId: string) => {
        const listenOn: JSONValue | undefined =
          triggerOf(templateId).args?.["listen-on"];

        return Boolean(
          listenOn &&
            typeof listenOn === "object" &&
            (listenOn as JSONObject)["currentIncidentStateId"],
        );
      },
    );

    expect(listening).toEqual(["jira-transition-issue-on-incident-state"]);
  });

  /*
   * The update trigger hands over the record as it now stands, not what
   * changed, so a field that can set the comment off has to be in it.
   */
  test("every field the edit-comment template listens on is in the comment", () => {
    const trigger: TemplateNodeSpec = triggerOf(
      "jira-comment-on-incident-update",
    );
    const body: string = scriptBody(
      scriptCode("jira-comment-on-incident-update", "build-comment-1"),
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
        commented: body.includes(`incident.${selected}`),
      }).toEqual({ field: field, selected: true, commented: true });
    }
  });
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
   * A state change is a new timeline row, not an edit to the incident: the
   * timeline is what records it, notifies, and refuses to move an incident
   * backwards. Writing currentIncidentStateId would skip all three.
   */
  test("no Jira template sets an incident's state directly", () => {
    for (const { templateId, node } of jiraNodes(isDatabaseWrite)) {
      expect(DATABASE_WRITE_METADATA_ID.exec(node.metadataId)?.[1]).toBe(
        "create",
      );
      expect({
        at: `${templateId} ${node.componentId}`,
        setsState: Object.keys(jsonArg(node, "json")).includes(
          "currentIncidentStateId",
        ),
      }).toEqual({ at: `${templateId} ${node.componentId}`, setsState: false });
    }
  });

  /*
   * A Jira issue's text was not written for a status page, so the incident is
   * private and quiet. And the issue key is what stops the create template
   * filing the incident back into Jira as a second issue.
   */
  test("an incident declared from Jira is private, quiet, and remembers its issue", () => {
    const created: JSONObject = jsonArg(
      nodeOf("jira-declare-incident-from-issue", "create-incident-1"),
      "json",
    );

    expect(created).toEqual({
      incidentSeverityId: scriptOutput(
        "prepare-incident-1",
        "incidentSeverityId",
      ),
      customFields: {
        jiraIssueKey: scriptOutput("prepare-incident-1", "issueKey"),
      },
      isVisibleOnStatusPage: false,
      shouldStatusPageSubscribersBeNotifiedOnIncidentCreated: false,
      title: scriptOutput("prepare-incident-1", "title"),
      description: scriptOutput("prepare-incident-1", "description"),
    });
  });

  test("the declared incident's title and description, written in Jira, come last", () => {
    const text: string = textArg(
      nodeOf("jira-declare-incident-from-issue", "create-incident-1"),
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
      scriptOutput("prepare-incident-1", "title"),
      scriptOutput("prepare-incident-1", "description"),
    ]);
  });

  /*
   * The script decides from the incident OneUptime returned, and only ever
   * forward: an earlier or equal state is a skip. That is also what settles
   * the echo when the other direction already moved the issue.
   */
  test("a state change is a timeline row for the incident OneUptime found, moving forward only", () => {
    const templateId: string = "jira-status-to-incident-state";
    const decide: string = scriptBody(scriptCode(templateId, "decide-state-1"));

    expect(jsonArg(nodeOf(templateId, "change-state-1"), "json")).toEqual({
      incidentId: scriptOutput("decide-state-1", "incidentId"),
      incidentStateId: scriptOutput("decide-state-1", "stateId"),
      rootCause: scriptOutput("decide-state-1", "rootCause"),
    });
    expect(decide).toContain("incidentId: asText(incident._id)");
    expect(decide).toContain("stateId: asText(target._id)");
    expect(decide).toContain(
      "if (Number(target.order) <= Number(current.order))",
    );
  });

  test("a note from Jira is a private note on the incident OneUptime found, not the one Jira named", () => {
    for (const [templateId, scriptId] of [
      ["jira-comment-to-private-note", "read-comment-1"],
      ["jira-issue-changes-to-private-note", "read-changes-1"],
    ] as Array<[string, string]>) {
      const note: TemplateNodeSpec = nodeOf(templateId, "create-note-1");

      expect(note.metadataId).toBe("incident-internal-note-create-one");
      expect(jsonArg(note, "json")).toEqual({
        incidentId: componentReturnValueReference("find-incident-1", "model", [
          "_id",
        ]),
        note: scriptOutput(scriptId, "note"),
      });
    }

    expect(
      jiraNodes((node: TemplateNodeSpec) => {
        return node.metadataId.startsWith("incident-public-note-create");
      }),
    ).toEqual([]);
  });

  test("an incident is looked up by an id a script took from the issue's label", () => {
    for (const [templateId, scriptId] of [
      ["jira-status-to-incident-state", "read-event-1"],
      ["jira-comment-to-private-note", "find-link-1"],
      ["jira-issue-changes-to-private-note", "read-changes-1"],
    ] as Array<[string, string]>) {
      const lookupNode: TemplateNodeSpec = nodeOf(
        templateId,
        "find-incident-1",
      );

      expect(lookupNode.metadataId).toBe("incident-find-one");
      expect(lookupNode.args?.["query"]).toEqual({
        _id: scriptOutput(scriptId, "incidentId"),
      });

      const body: string = scriptBody(scriptCode(templateId, scriptId));

      expect(body).toContain("const incidentId = incidentIdFromLabels(");
      expect(body).toMatch(/incidentId: incidentId[,\s]/);
    }
  });

  /*
   * The query argument is required and cannot be left empty, and without a
   * limit Find Many returns ten rows — a project with more severities or
   * states than that would have some silently left out.
   */
  test("a Find Many asks for every row, with a limit above the default", () => {
    const findMany: Array<JiraNode> = jiraNodes((node: TemplateNodeSpec) => {
      return node.metadataId.endsWith("-find-many");
    });

    expect(findMany).toHaveLength(2);

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
