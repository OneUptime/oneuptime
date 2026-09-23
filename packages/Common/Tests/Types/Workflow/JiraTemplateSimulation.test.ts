/*
 * End-to-end simulations of the Jira templates.
 *
 * The script tests prove that each script decides correctly given its
 * arguments. What they cannot prove is that the arguments the runner actually
 * hands a script are the ones it expects, that an If / Else reads the value the
 * script returned, that a request body is still valid JSON after substitution,
 * or that two templates chained together settle instead of echoing each other
 * forever. Those are properties of a whole graph, so this file runs whole
 * graphs.
 *
 * The interpreter below walks a built template the way RunWorkflow does: the
 * arguments are resolved by the same substitution, one step runs at a time in
 * FIFO order, and each step's return values are stored where the next step's
 * references look for them. What is real and what is faked is deliberate:
 *
 *   - Real: VMAPI substitution, the JavaScript component in the isolated-vm
 *     sandbox, the If / Else component, the Log component, and the API
 *     components themselves — sanitizeArgs, URL parsing, HTTPResponse and the
 *     choice of port included.
 *   - Faked: Jira, at API.fetch, the one function every API component sends
 *     through; the database, per step, by component id; and one DNS lookup, so
 *     the SSRF check the API components run stays offline.
 *
 * Each run returns a trace — the steps executed, every request sent to Jira,
 * every database call and every log line — and the tests assert exactly what
 * would have left the workflow.
 *
 * Every Jira template comes in an incident and an alert version, built from
 * the same builders. The scenarios are written once and run for both kinds,
 * from the table under "The two kinds"; the few ways the kinds differ (alerts
 * have no public notes, no status page and two default severities) have tests
 * of their own. A last group runs the two kinds against each other, because a
 * project can enable both sets at once and an issue linked to one kind of
 * record must never be taken for the other.
 */

import {
  ACKNOWLEDGED_STATE,
  ALERT_ACKNOWLEDGED_STATE,
  ALERT_CREATED_STATE,
  ALERT_ID,
  ALERT_NUMBER,
  ALERT_RESOLVED_STATE,
  ALERT_SEVERITIES,
  ALERT_STATES,
  CREATED_STATE,
  CRITICAL_SEVERITY_ID,
  DONE,
  EMPTY_JIRA_SEARCH,
  HIGH_ALERT_SEVERITY_ID,
  IN_PROGRESS,
  INCIDENT_ID,
  INCIDENT_NUMBER,
  INCIDENT_SEVERITIES,
  INCIDENT_STATES,
  JIRA_ISSUE_ID,
  JIRA_ISSUE_KEY,
  JIRA_SITE,
  LOW_ALERT_SEVERITY_ID,
  MAJOR_SEVERITY_ID,
  MINOR_SEVERITY_ID,
  OTHER_ALERT_ID,
  OTHER_INCIDENT_ID,
  PROJECT_ID,
  RESOLVED_CHANGELOG,
  RESOLVED_STATE,
  STARTED_CHANGELOG,
  TO_DO,
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
} from "./JiraTemplateFixtures";
import {
  JIRA_ALERT_LABEL_PREFIX,
  JIRA_INCIDENT_LABEL_PREFIX,
  JIRA_LINK_LABEL,
  JIRA_SYNCED_FROM_ONEUPTIME_MARKER,
  ONEUPTIME_SYNCED_FROM_JIRA_MARKER,
  WorkflowTemplate,
  WorkflowTemplateCategory,
  WorkflowTemplateVariable,
  buildGraphForTemplate,
  getWorkflowTemplate,
  getWorkflowTemplatesByCategory,
} from "../../../Types/Workflow/Templates";
import ComponentMetadata, {
  Argument,
  ComponentInputType,
  ComponentType,
} from "../../../Types/Workflow/Component";
import ComponentID from "../../../Types/Workflow/ComponentID";
import { JSONObject, JSONValue } from "../../../Types/JSON";
import Dictionary from "../../../Types/Dictionary";
import Exception from "../../../Types/Exception/Exception";
import ObjectID from "../../../Types/ObjectID";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import API, { APIFetchOptions } from "../../../Utils/API";
import { loadComponentsAndCategories } from "../../../UI/Components/Workflow/Utils";
import VMUtil from "../../../Server/Utils/VM/VMAPI";
import ComponentCode, {
  RunOptions,
  RunReturnType,
} from "../../../Server/Types/Workflow/ComponentCode";
import JavaScriptCode from "../../../Server/Types/Workflow/Components/JavaScript";
import IfElse from "../../../Server/Types/Workflow/Components/Conditions/IfElse";
import Log from "../../../Server/Types/Workflow/Components/Log";
import ApiGet from "../../../Server/Types/Workflow/Components/API/Get";
import ApiPost from "../../../Server/Types/Workflow/Components/API/Post";
import ApiPut from "../../../Server/Types/Workflow/Components/API/Put";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import dns from "dns";

// Every script and condition runs in a real isolate, and each one takes a moment to start.
jest.setTimeout(120000);

/* ------------------------------ Configuration ------------------------------ */

/*
 * A value that could only have come from the secret variable, so finding it
 * anywhere in a trace means the secret travelled somewhere it should not.
 */
const JIRA_TOKEN: string =
  "c2ltdWxhdGlvbkBhY21lLmV4YW1wbGU6QVRBVFQtc2ltdWxhdGVkLXNlY3JldA==";

const ONEUPTIME_URL: string = "https://oneuptime.com";

/** The id the database gives the incident the declare template creates. */
const NEW_INCIDENT_ID: string = "5d6e7f80-9a1b-4c2d-8e3f-4a5b6c7d8e9f";

/** The id the database gives the alert the create-alert template creates. */
const NEW_ALERT_ID: string = "7a8b9c0d-1e2f-4a3b-8c4d-5e6f7a8b9c0d";

/*
 * The ids the database gives a new note or timeline row. Neither is ever
 * written anywhere, so they are kept apart from every fixture id: a template
 * quoting the wrong step's id would otherwise pass by coincidence.
 */
const NEW_NOTE_ID: string = "abababab-0000-4000-8000-000000000001";

const NEW_TIMELINE_ID: string = "cdcdcdcd-0000-4000-8000-000000000001";

/*
 * The account the templates' API token belongs to. Its own edits come back
 * as webhooks too, which is what the echo suite replays.
 */
const AUTOMATION_USER: JSONObject = jiraUser(
  "OneUptime Automation",
  "712020:0e6c1b8a-automation",
);

/*
 * A header Jira sends with every delivery. Its value is looked for in the
 * output of the security suite, because a Jira user naming the webhook's
 * request headers in a comment must not get them written anywhere.
 */
const WEBHOOK_IDENTIFIER: string = "a1b2c3d4-webhook-delivery-sentinel";

/** What the create wizard would have stored for each variable a template declares. */
const VARIABLE_VALUES: Dictionary<string> = {
  jiraBaseUrl: JIRA_SITE,
  jiraBasicAuthToken: JIRA_TOKEN,
  jiraProjectKey: "OPS",
  jiraIssueType: "Task",
  oneuptimeUrl: ONEUPTIME_URL,
};

const AUTHORIZATION: Dictionary<string> = {
  Authorization: `Basic ${JIRA_TOKEN}`,
};

/* ------------------------------- The graph ------------------------------- */

/*
 * The MERGED registry, as in Templates.test.ts: the database components
 * (incident-find-one, alert-state-timeline-create-one, ...) only exist there,
 * and a node without metadata has no arguments to resolve.
 */
const registry: Array<ComponentMetadata> =
  loadComponentsAndCategories().components;

interface SimulatedNode {
  componentId: string;
  metadataId: string;
  componentType: ComponentType;
  metadata: ComponentMetadata;
  arguments: JSONObject;
}

interface SimulatedGraph {
  triggerComponentId: string;
  nodes: Dictionary<SimulatedNode>;
  /** componentId -> port id -> the component ids its edges lead to, as RunWorkflow's run stack keeps them. */
  outPorts: Dictionary<Dictionary<Array<string>>>;
}

let generatedIdCounter: number = 0;

type GenerateIdFunction = () => string;

const generateId: GenerateIdFunction = (): string => {
  generatedIdCounter++;
  return `simulated-${generatedIdCounter}`;
};

type BuildSimulatedGraphFunction = (templateId: string) => SimulatedGraph;

/*
 * Built through buildGraphForTemplate, the path the create wizard takes, so
 * the simulation runs the graph a user actually gets — not the spec behind it.
 */
const buildSimulatedGraph: BuildSimulatedGraphFunction = (
  templateId: string,
): SimulatedGraph => {
  const graph: JSONObject | null = buildGraphForTemplate(
    templateId,
    generateId,
  );

  if (!graph) {
    throw new Error(`There is no template ${templateId}.`);
  }

  const nodes: Dictionary<SimulatedNode> = {};
  const outPorts: Dictionary<Dictionary<Array<string>>> = {};
  const componentIdByNodeId: Dictionary<string> = {};

  for (const rawNode of graph["nodes"] as Array<JSONObject>) {
    const data: JSONObject = rawNode["data"] as JSONObject;
    const componentId: string = data["id"] as string;
    const metadataId: string = data["metadataId"] as string;
    const metadata: ComponentMetadata | undefined = registry.find(
      (component: ComponentMetadata) => {
        return component.id === metadataId;
      },
    );

    if (!metadata) {
      throw new Error(
        `${componentId} uses ${metadataId}, which is not a component.`,
      );
    }

    nodes[componentId] = {
      componentId: componentId,
      metadataId: metadataId,
      componentType: data["componentType"] as ComponentType,
      metadata: metadata,
      arguments: (data["arguments"] as JSONObject) || {},
    };
    outPorts[componentId] = {};
    componentIdByNodeId[rawNode["id"] as string] = componentId;
  }

  for (const edge of graph["edges"] as Array<JSONObject>) {
    const from: string = componentIdByNodeId[
      edge["source"] as string
    ] as string;
    const to: string = componentIdByNodeId[edge["target"] as string] as string;
    const port: string = edge["sourceHandle"] as string;
    const ports: Dictionary<Array<string>> = outPorts[from] as Dictionary<
      Array<string>
    >;

    ports[port] = [...(ports[port] || []), to];
  }

  const triggers: Array<SimulatedNode> = Object.values(nodes).filter(
    (node: SimulatedNode) => {
      return node.componentType === ComponentType.Trigger;
    },
  );

  if (triggers.length !== 1) {
    throw new Error(`${templateId} has ${triggers.length} triggers, not one.`);
  }

  return {
    triggerComponentId: (triggers[0] as SimulatedNode).componentId,
    nodes: nodes,
    outPorts: outPorts,
  };
};

type VariablesForFunction = (templateId: string) => Dictionary<string>;

/*
 * Only the variables the template declares, because that is all the wizard
 * creates. A reference to anything else stays unresolved, exactly as it would
 * in a real workflow.
 */
const variablesFor: VariablesForFunction = (
  templateId: string,
): Dictionary<string> => {
  const template: WorkflowTemplate | null = getWorkflowTemplate(templateId);

  if (!template) {
    throw new Error(`There is no template ${templateId}.`);
  }

  const values: Dictionary<string> = {};

  for (const variable of template.variables) {
    const value: string | undefined = VARIABLE_VALUES[variable.name];

    if (value === undefined) {
      throw new Error(`The simulation has no value for ${variable.name}.`);
    }

    values[variable.name] = value;
  }

  return values;
};

/* -------------------------- Argument resolution -------------------------- */

/** RunWorkflow's StorageMap, which lives in the App package this one cannot import. */
interface StorageMap {
  local: {
    variables: Dictionary<string>;
    components: Dictionary<{ returnValues: JSONObject }>;
  };
  global: {
    variables: Dictionary<string>;
  };
}

const PARSED_ARGUMENT_TYPES: Array<ComponentInputType> = [
  ComponentInputType.JSON,
  ComponentInputType.Query,
  ComponentInputType.Select,
];

type ResolveArgumentsFunction = (
  storageMap: StorageMap,
  node: SimulatedNode,
) => JSONObject;

/*
 * A copy of RunWorkflow.getComponentArguments
 * (packages/App/FeatureSet/Workflow/Services/RunWorkflow.ts, around line
 * 1210), kept step for step, because every property this file checks rests on
 * it: falsy values are skipped; VMAPI.replaceValueInPlace substitutes, escaping
 * for JSON only when the argument is JSON typed (an object-valued argument is
 * stringified, substituted with escaping and parsed back); and a string left
 * for a JSON, Query or Select argument is parsed, with a template that built
 * invalid JSON failing the run — and this test — the way it fails the runner.
 */
const resolveArguments: ResolveArgumentsFunction = (
  storageMap: StorageMap,
  node: SimulatedNode,
): JSONObject => {
  const resolved: JSONObject = {};

  for (const argument of node.metadata.arguments as Array<Argument>) {
    const content: JSONValue | undefined = node.arguments[argument.id];

    if (!content) {
      continue;
    }

    let value: JSONValue = VMUtil.replaceValueInPlace(
      storageMap as unknown as JSONObject,
      content as string,
      argument.type === ComponentInputType.JSON,
    ) as JSONValue;

    if (
      typeof value === "string" &&
      PARSED_ARGUMENT_TYPES.includes(argument.type)
    ) {
      try {
        value = JSON.parse(value) as JSONValue;
      } catch (error) {
        throw new Error(
          argument.isSensitive
            ? `Invalid JSON provided for sensitive argument ${argument.id} of ${node.componentId}. The value has been redacted.`
            : `Invalid JSON provided for argument ${argument.id} of ${node.componentId}. JSON parse error: ${(error as Error).message}. JSON: ${value}`,
        );
      }
    }

    resolved[argument.id] = value;
  }

  return resolved;
};

/* ------------------------------ The fakes ------------------------------ */

interface JiraRequest {
  method: string;
  url: string;
  headers: Dictionary<string>;
  body?: JSONValue | undefined;
}

interface JiraReply {
  status: number;
  /** A string is a body that is not JSON: a 204's empty one, or a plain-text 401. */
  body: JSONObject | Array<JSONObject> | string;
}

type FakeJiraFunction = (request: JiraRequest) => JiraReply;

interface DatabaseCall {
  componentId: string;
  metadataId: string;
  args: JSONObject;
}

interface DatabaseReply {
  port: "success" | "error";
  returnValues: JSONObject;
}

type DatabaseAnswer = DatabaseReply | ((call: DatabaseCall) => DatabaseReply);

/** Keyed by the step's metadata id, e.g. "incident-find-one" or "alert-find-one". */
type FakeDatabase = Dictionary<DatabaseAnswer>;

type EditCodeFunction = (code: string) => string;

interface Scenario {
  templateId: string;
  /** What the trigger hands over: { model } from a database trigger, the delivery from the webhook. */
  trigger: JSONObject;
  jira?: FakeJiraFunction | undefined;
  database?: FakeDatabase | undefined;
  /*
   * Edits a step's script before the run, keyed by component id — what a
   * user following the script's own comments would do, such as switching
   * SYNC_PRIVATE_INCIDENTS or SYNC_PRIVATE_ALERTS on.
   */
  editCode?: Dictionary<EditCodeFunction> | undefined;
}

interface SimulationTrace {
  /** The template the run was built from. */
  templateId: string;
  /** Component ids, in the order they ran. */
  executed: Array<string>;
  /** The port each step left by. */
  ports: Dictionary<string | null>;
  requests: Array<JiraRequest>;
  databaseCalls: Array<DatabaseCall>;
  /** The resolved value of every Log step. */
  logs: Array<string>;
  /** What the components themselves wrote to the run log. */
  runLog: Array<string>;
  storage: StorageMap;
}

/*
 * Jira as the network sees it. An unexpected request is answered with a 404
 * rather than thrown, because a throw inside API.fetch is caught by the API
 * component and would look like an ordinary failure; every test asserts the
 * exact list of requests instead, so a stray one shows up there.
 */
type JiraRoutesFunction = (routes: Dictionary<JiraReply>) => FakeJiraFunction;

const jiraRoutes: JiraRoutesFunction = (
  routes: Dictionary<JiraReply>,
): FakeJiraFunction => {
  return (request: JiraRequest): JiraReply => {
    const key: string = `${request.method} ${request.url.replace(JIRA_SITE, "")}`;

    return (
      routes[key] || {
        status: 404,
        body: {
          errorMessages: [`The simulation has no reply for ${key}.`],
          errors: {},
        },
      }
    );
  };
};

const NO_JIRA: FakeJiraFunction = jiraRoutes({});

type ReplyFunction = (body: JSONObject) => JiraReply;

const ok: ReplyFunction = (body: JSONObject): JiraReply => {
  return { status: 200, body: body };
};

const createdReply: ReplyFunction = (body: JSONObject): JiraReply => {
  return { status: 201, body: body };
};

const badRequest: ReplyFunction = (body: JSONObject): JiraReply => {
  return { status: 400, body: body };
};

/** Transitions, edits and label changes answer 204 with no body at all. */
const NO_CONTENT: JiraReply = { status: 204, body: "" };

/** POST /rest/api/3/issue answers with the new issue's id, key and URL, nothing else. */
const ISSUE_CREATED: JiraReply = createdReply({
  id: JIRA_ISSUE_ID,
  key: JIRA_ISSUE_KEY,
  self: `${JIRA_SITE}/rest/api/3/issue/${JIRA_ISSUE_ID}`,
});

const COMMENT_CREATED: JiraReply = createdReply({
  self: `${JIRA_SITE}/rest/api/3/issue/${JIRA_ISSUE_ID}/comment/10020`,
  id: "10020",
  created: "2026-09-23T10:12:00.000+0100",
});

const SEARCH: string = "POST /rest/api/3/search/jql";
const CREATE_ISSUE: string = "POST /rest/api/3/issue";
const TRANSITION: string = `POST /rest/api/3/issue/${JIRA_ISSUE_KEY}/transitions`;
const COMMENT: string = `POST /rest/api/3/issue/${JIRA_ISSUE_KEY}/comment`;
const EDIT_ISSUE: string = `PUT /rest/api/3/issue/${JIRA_ISSUE_KEY}`;
const GET_LABELS: string = `GET /rest/api/3/issue/${JIRA_ISSUE_KEY}?fields=labels`;

type ModelReplyFunction = (model: JSONObject | null) => DatabaseReply;

/* Find One answers "nothing matched" with a null model on its Success port, not an error. */
const found: ModelReplyFunction = (model: JSONObject | null): DatabaseReply => {
  return { port: "success", returnValues: { model: model } };
};

type ModelsReplyFunction = (models: Array<JSONObject>) => DatabaseReply;

const many: ModelsReplyFunction = (
  models: Array<JSONObject>,
): DatabaseReply => {
  return { port: "success", returnValues: { models: models } };
};

type CreatedWithIdFunction = (id: string) => DatabaseAnswer;

/* Create One hands back the saved row, which is the posted fields plus the id the database gave it. */
const createdWithId: CreatedWithIdFunction = (id: string): DatabaseAnswer => {
  return (call: DatabaseCall): DatabaseReply => {
    return {
      port: "success",
      returnValues: {
        model: { ...(call.args["json"] as JSONObject), _id: id },
      },
    };
  };
};

/* A failed database step takes its Error port with nothing in its return values; the error itself goes to the run log. */
const DATABASE_FAILURE: DatabaseReply = { port: "error", returnValues: {} };

/* ------------------------------ The runner ------------------------------ */

/* Components the simulation runs for real, the way RunWorkflow's Components registry does. */
const COMPONENT_CODE: Dictionary<ComponentCode> = {
  [ComponentID.JavaScriptCode]: new JavaScriptCode(),
  [ComponentID.IfElse]: new IfElse(),
  [ComponentID.Log]: new Log(),
  [ComponentID.ApiGet]: new ApiGet(),
  [ComponentID.ApiPost]: new ApiPost(),
  [ComponentID.ApiPut]: new ApiPut(),
};

const DATABASE_OPERATION: RegExp = /-(find-one|find-many|create-one)$/;

/** Enough of a jest spy to put the real function back. */
interface RestorableSpy {
  mockRestore: () => void;
}

type AnswerFetchFunction = (
  options: APIFetchOptions,
  scenario: Scenario,
  trace: SimulationTrace,
) => HTTPResponse<JSONObject> | HTTPErrorResponse;

/*
 * What API.fetch resolves with on the server. Axios accepts 2xx only, and the
 * API components turn redirects off, so anything else becomes the
 * HTTPErrorResponse the API utility resolves with (never throws). A 204's
 * empty body reaches HTTPResponse as an empty string, which it stores as
 * { data: "" } — both come from the real classes here, not from a copy.
 */
const answerFetch: AnswerFetchFunction = (
  options: APIFetchOptions,
  scenario: Scenario,
  trace: SimulationTrace,
): HTTPResponse<JSONObject> | HTTPErrorResponse => {
  const request: JiraRequest = {
    method: options.method,
    url: options.url.toString(),
    headers: { ...(options.headers || {}) },
  };

  // Axios would send JSON.stringify(data); a JSON round trip is what arrives.
  if (options.data !== undefined) {
    request.body = JSON.parse(JSON.stringify(options.data)) as JSONValue;
  }

  trace.requests.push(request);

  const reply: JiraReply = (scenario.jira || NO_JIRA)(request);
  const headers: Dictionary<string> = {
    "content-type":
      typeof reply.body === "string"
        ? "text/plain;charset=UTF-8"
        : "application/json;charset=UTF-8",
  };

  if (reply.status >= 200 && reply.status < 300) {
    return new HTTPResponse<JSONObject>(
      reply.status,
      reply.body as JSONObject,
      headers,
    );
  }

  return new HTTPErrorResponse(reply.status, reply.body as JSONObject, headers);
};

interface StepResult {
  returnValues: JSONObject;
  port: string | null;
}

type ExecuteStepFunction = (data: {
  node: SimulatedNode;
  args: JSONObject;
  scenario: Scenario;
  trace: SimulationTrace;
}) => Promise<StepResult>;

const executeStep: ExecuteStepFunction = async (data: {
  node: SimulatedNode;
  args: JSONObject;
  scenario: Scenario;
  trace: SimulationTrace;
}): Promise<StepResult> => {
  const node: SimulatedNode = data.node;

  if (node.componentType === ComponentType.Trigger) {
    /*
     * A trigger hands over what the event carried: the webhook component
     * returns the request it received, and a database trigger the record.
     * Both leave by their only port ("out" and "success" respectively).
     */
    if (node.metadata.outPorts.length !== 1) {
      throw new Error(`${node.metadataId} has more than one way out.`);
    }

    return {
      returnValues: data.scenario.trigger,
      port: node.metadata.outPorts[0]!.id,
    };
  }

  if (DATABASE_OPERATION.test(node.metadataId)) {
    const call: DatabaseCall = {
      componentId: node.componentId,
      metadataId: node.metadataId,
      args: data.args,
    };

    data.trace.databaseCalls.push(call);

    const answer: DatabaseAnswer | undefined =
      data.scenario.database?.[node.metadataId];

    // Unlike Jira, the database is called by the simulation itself, so a surprise can fail loudly.
    if (!answer) {
      throw new Error(
        `The scenario did not expect ${node.componentId} (${node.metadataId}) to run. It was called with ${JSON.stringify(data.args)}`,
      );
    }

    const reply: DatabaseReply =
      typeof answer === "function" ? answer(call) : answer;

    return { returnValues: reply.returnValues, port: reply.port };
  }

  const code: ComponentCode | undefined = COMPONENT_CODE[node.metadataId];

  if (!code) {
    throw new Error(`The simulation cannot run ${node.metadataId}.`);
  }

  if (node.metadataId === ComponentID.Log) {
    data.trace.logs.push(String(data.args["value"]));
  }

  let errorMessage: string | null = null;

  const options: RunOptions = {
    log: (item: JSONValue | Error): void => {
      data.trace.runLog.push(
        typeof item === "string" ? item : JSON.stringify(item),
      );
    },
    workflowLogId: ObjectID.generate(),
    workflowId: ObjectID.generate(),
    projectId: new ObjectID(PROJECT_ID),
    // RunWorkflow stops the whole run once a component reports an error this way.
    onError: (exception: Exception): Exception => {
      errorMessage = exception.message;
      return exception;
    },
    executeWorkflow: async (): Promise<void> => {},
  };

  const result: RunReturnType = await code.run(data.args, options);

  if (errorMessage !== null) {
    throw new Error(
      `Workflow stopped because of an error in ${node.componentId}: ${errorMessage}`,
    );
  }

  return {
    returnValues: result.returnValues,
    port: result.executePort?.id || null,
  };
};

type RunTemplateFunction = (scenario: Scenario) => Promise<SimulationTrace>;

/*
 * The loop of RunWorkflow.runWorkflow in miniature: a FIFO of pending steps,
 * each run once (a second visit is the cycle error the runner raises), its
 * return values stored under local.components.<component id>, and every step
 * wired to the port it left by queued unless it already is.
 */
const runTemplate: RunTemplateFunction = async (
  scenario: Scenario,
): Promise<SimulationTrace> => {
  const graph: SimulatedGraph = buildSimulatedGraph(scenario.templateId);

  for (const componentId of Object.keys(scenario.editCode || {})) {
    const node: SimulatedNode | undefined = graph.nodes[componentId];
    const edit: EditCodeFunction = (
      scenario.editCode as Dictionary<EditCodeFunction>
    )[componentId] as EditCodeFunction;

    if (!node || typeof node.arguments["code"] !== "string") {
      throw new Error(`${scenario.templateId} has no script ${componentId}.`);
    }

    const edited: string = edit(node.arguments["code"]);

    // An edit that matched nothing would leave the test proving the unedited script.
    if (edited === node.arguments["code"]) {
      throw new Error(`The edit did not change ${componentId}'s script.`);
    }

    node.arguments["code"] = edited;
  }

  const trace: SimulationTrace = {
    templateId: scenario.templateId,
    executed: [],
    ports: {},
    requests: [],
    databaseCalls: [],
    logs: [],
    runLog: [],
    storage: {
      local: { variables: variablesFor(scenario.templateId), components: {} },
      global: { variables: {} },
    },
  };

  const fetchSpy: RestorableSpy = jest
    .spyOn(API, "fetch")
    .mockImplementation((async (
      options: APIFetchOptions,
    ): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> => {
      return answerFetch(options, scenario, trace);
    }) as never) as unknown as RestorableSpy;

  try {
    const pending: Array<string> = [graph.triggerComponentId];

    while (pending.length > 0) {
      const componentId: string = pending.shift() as string;

      if (trace.executed.includes(componentId)) {
        throw new Error(
          `Cyclic Workflow Detected. Cannot execute ${componentId} when it has already been executed.`,
        );
      }

      trace.executed.push(componentId);

      const node: SimulatedNode = graph.nodes[componentId] as SimulatedNode;
      const args: JSONObject = resolveArguments(trace.storage, node);
      const result: StepResult = await executeStep({
        node: node,
        args: args,
        scenario: scenario,
        trace: trace,
      });

      trace.storage.local.components[componentId] = {
        returnValues: result.returnValues,
      };
      trace.ports[componentId] = result.port;

      if (!result.port) {
        break;
      }

      const next: Array<string> =
        (graph.outPorts[componentId] as Dictionary<Array<string>>)[
          result.port
        ] || [];

      for (const nextComponentId of next) {
        if (!pending.includes(nextComponentId)) {
          pending.push(nextComponentId);
        }
      }
    }
  } finally {
    fetchSpy.mockRestore();
  }

  return trace;
};

/*
 * The API components resolve the Jira host before every request, to refuse
 * internal addresses. Pin the answer to a public one so the suite stays
 * offline; which addresses are refused is ApiComponentSsrf.test.ts's concern.
 */
beforeAll(() => {
  jest
    .spyOn(dns.promises, "lookup")
    .mockResolvedValue([{ address: "104.192.142.20", family: 4 }] as never);
});

afterAll(() => {
  jest.restoreAllMocks();
});

/* ------------------------------ The two kinds ------------------------------ */

/*
 * What a scenario needs to know about the record a template syncs. The
 * templates build both of their versions from a table of their own; this one
 * is written out value by value rather than read from it, so a wrong entry
 * there fails here instead of being copied into the expectation.
 */

/** Everything a scenario may set on the record a database trigger hands over. */
interface RecordModelProps {
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

type RecordModelFunction = (props?: RecordModelProps) => JSONObject;

interface RecordNoteProps {
  note?: string | undefined;
  /** null leaves the author off, as on a note a workflow wrote. */
  authorName?: string | null | undefined;
  recordId?: string | undefined;
  /** Whether the record the note is on is private. */
  isPrivate?: boolean | undefined;
}

type RecordNoteFunction = (props?: RecordNoteProps) => JSONObject;

type RecordLabelFunction = (recordId?: string) => string;

interface NoteTemplate {
  templateId: string;
  /** "private" or "public": what the comment calls the note. */
  visibility: string;
  /** Whether Jira Service Management is told to keep the comment from the customer. */
  internal: boolean;
}

interface SeverityRef {
  id: string;
  name: string;
}

interface KindTemplates {
  createIssue: string;
  transition: string;
  privateNote: string;
  updateComment: string;
  createFromIssue: string;
  statusToState: string;
  commentToNote: string;
  issueChangesToNote: string;
}

/** The component ids that carry the record's noun. The rest are the same for both kinds. */
interface KindSteps {
  onCreate: string;
  onUpdate: string;
  prepareRecord: string;
  ifCreate: string;
  createRecord: string;
  find: string;
}

/** The database components, by what they do. */
interface KindComponents {
  findOne: string;
  stateFindMany: string;
  timelineCreateOne: string;
  noteCreateOne: string;
  severityFindMany: string;
  createOne: string;
}

interface SimulatedKind {
  /** "incident" or "alert". Both take "an", which the test titles rely on. */
  noun: string;
  id: string;
  /** A record of the same kind that this project does not have. */
  otherId: string;
  /** The id the database gives the record the create-from-Jira template writes. */
  newId: string;
  number: string;
  label: RecordLabelFunction;
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
  /** The dashboard path the record's page lives under. */
  dashboardPath: string;
  /** An incident is declared; an alert is created. */
  created: string;
  Created: string;
  create: string;
  templates: KindTemplates;
  /** Every OneUptime note that goes to Jira: private and public for incidents, private for alerts. */
  noteTemplates: Array<NoteTemplate>;
  steps: KindSteps;
  components: KindComponents;
  createdState: JSONObject;
  acknowledgedState: JSONObject;
  resolvedState: JSONObject;
  states: Array<JSONObject>;
  severities: Array<JSONObject>;
  mostSevere: SeverityRef;
  /** Where a Medium priority lands: the middle of three, or the less severe of two. */
  middleSeverity: SeverityRef;
  leastSevere: SeverityRef;
  /** Written beside the essentials when a record is created from a Jira issue. */
  quietCreateFields: JSONObject;
  /** The updates the edit-comment template listens for. */
  editListenOn: JSONObject;
  /** The fixture record's own values, as its comments and issues quote them. */
  defaultTitle: string;
  defaultDescription: string;
  defaultSeverityName: string;
  defaultNoteText: string;
  model: RecordModelFunction;
  note: RecordNoteFunction;
  /** The switch every script that syncs a private record documents. */
  syncPrivate: EditCodeFunction;
}

type SyncPrivateSwitchFunction = (constant: string) => EditCodeFunction;

const syncPrivateSwitch: SyncPrivateSwitchFunction = (
  constant: string,
): EditCodeFunction => {
  return (code: string): string => {
    return code.replace(
      `const ${constant} = false;`,
      `const ${constant} = true;`,
    );
  };
};

/*
 * The incident fixture leaves isPrivate off, and the triggers select it, so a
 * scenario that sets it gets it added here.
 */
const incidentRecordModel: RecordModelFunction = (
  props?: RecordModelProps,
): JSONObject => {
  const model: JSONObject = incidentModel(props);

  if (props?.isPrivate !== undefined) {
    model["isPrivate"] = props.isPrivate;
  }

  return model;
};

/* A note on an incident; the note triggers reach through to the incident for its Private flag. */
const incidentRecordNote: RecordNoteFunction = (
  props?: RecordNoteProps,
): JSONObject => {
  const note: JSONObject = noteModel({
    note: props?.note,
    authorName: props?.authorName,
    incidentId: props?.recordId,
  });

  if (props?.isPrivate !== undefined) {
    note["incident"] = {
      ...(note["incident"] as JSONObject),
      isPrivate: props.isPrivate,
    };
  }

  return note;
};

const alertRecordNote: RecordNoteFunction = (
  props?: RecordNoteProps,
): JSONObject => {
  return alertNoteModel({
    note: props?.note,
    authorName: props?.authorName,
    alertId: props?.recordId,
    isPrivate: props?.isPrivate,
  });
};

const INCIDENT: SimulatedKind = {
  noun: "incident",
  id: INCIDENT_ID,
  otherId: OTHER_INCIDENT_ID,
  newId: NEW_INCIDENT_ID,
  number: INCIDENT_NUMBER,
  label: incidentLabel,
  labelPrefix: "oneuptime-incident-",
  numberField: "incidentNumberWithPrefix",
  severityRelation: "incidentSeverity",
  severityIdColumn: "incidentSeverityId",
  stateRelation: "currentIncidentState",
  stateIdColumn: "currentIncidentStateId",
  idColumn: "incidentId",
  timelineStateColumn: "incidentStateId",
  dashboardPath: "incidents",
  created: "declared",
  Created: "Declared",
  create: "declare",
  templates: {
    createIssue: "jira-create-issue-for-incident",
    transition: "jira-transition-issue-on-incident-state",
    privateNote: "jira-comment-from-incident-private-note",
    updateComment: "jira-comment-on-incident-update",
    createFromIssue: "jira-declare-incident-from-issue",
    statusToState: "jira-status-to-incident-state",
    commentToNote: "jira-comment-to-incident-private-note",
    issueChangesToNote: "jira-issue-changes-to-incident-private-note",
  },
  noteTemplates: [
    {
      templateId: "jira-comment-from-incident-private-note",
      visibility: "private",
      internal: true,
    },
    {
      templateId: "jira-comment-from-incident-public-note",
      visibility: "public",
      internal: false,
    },
  ],
  steps: {
    onCreate: "incident-on-create-1",
    onUpdate: "incident-on-update-1",
    prepareRecord: "prepare-incident-1",
    ifCreate: "if-declare-1",
    createRecord: "create-incident-1",
    find: "find-incident-1",
  },
  components: {
    findOne: "incident-find-one",
    stateFindMany: "incident-state-find-many",
    timelineCreateOne: "incident-state-timeline-create-one",
    noteCreateOne: "incident-internal-note-create-one",
    severityFindMany: "incident-severity-find-many",
    createOne: "incident-create-one",
  },
  createdState: CREATED_STATE,
  acknowledgedState: ACKNOWLEDGED_STATE,
  resolvedState: RESOLVED_STATE,
  states: INCIDENT_STATES,
  severities: INCIDENT_SEVERITIES,
  mostSevere: { id: CRITICAL_SEVERITY_ID, name: "Critical Incident" },
  middleSeverity: { id: MAJOR_SEVERITY_ID, name: "Major Incident" },
  leastSevere: { id: MINOR_SEVERITY_ID, name: "Minor Incident" },
  // An issue's text was not written for customers, so it stays off status pages.
  quietCreateFields: {
    isVisibleOnStatusPage: false,
    shouldStatusPageSubscribersBeNotifiedOnIncidentCreated: false,
  },
  editListenOn: {
    title: true,
    description: true,
    incidentSeverityId: true,
    incidentSeverity: true,
    rootCause: true,
    remediationNotes: true,
  },
  defaultTitle: "Checkout latency high",
  defaultDescription:
    'p99 latency on /checkout is above 2s.\nStarted after the "v4.2" deploy.',
  defaultSeverityName: "Critical Incident",
  defaultNoteText:
    "Failed over to the **secondary** database. Error rate is dropping.",
  model: incidentRecordModel,
  note: incidentRecordNote,
  syncPrivate: syncPrivateSwitch("SYNC_PRIVATE_INCIDENTS"),
};

const ALERT: SimulatedKind = {
  noun: "alert",
  id: ALERT_ID,
  otherId: OTHER_ALERT_ID,
  newId: NEW_ALERT_ID,
  number: ALERT_NUMBER,
  label: alertLabel,
  labelPrefix: "oneuptime-alert-",
  numberField: "alertNumberWithPrefix",
  severityRelation: "alertSeverity",
  severityIdColumn: "alertSeverityId",
  stateRelation: "currentAlertState",
  stateIdColumn: "currentAlertStateId",
  idColumn: "alertId",
  timelineStateColumn: "alertStateId",
  dashboardPath: "alerts",
  created: "created",
  Created: "Created",
  create: "create",
  templates: {
    createIssue: "jira-create-issue-for-alert",
    transition: "jira-transition-issue-on-alert-state",
    privateNote: "jira-comment-from-alert-private-note",
    updateComment: "jira-comment-on-alert-update",
    createFromIssue: "jira-create-alert-from-issue",
    statusToState: "jira-status-to-alert-state",
    commentToNote: "jira-comment-to-alert-private-note",
    issueChangesToNote: "jira-issue-changes-to-alert-private-note",
  },
  // Alerts have no public notes.
  noteTemplates: [
    {
      templateId: "jira-comment-from-alert-private-note",
      visibility: "private",
      internal: true,
    },
  ],
  steps: {
    onCreate: "alert-on-create-1",
    onUpdate: "alert-on-update-1",
    prepareRecord: "prepare-alert-1",
    ifCreate: "if-create-1",
    createRecord: "create-alert-1",
    find: "find-alert-1",
  },
  components: {
    findOne: "alert-find-one",
    stateFindMany: "alert-state-find-many",
    timelineCreateOne: "alert-state-timeline-create-one",
    noteCreateOne: "alert-internal-note-create-one",
    severityFindMany: "alert-severity-find-many",
    createOne: "alert-create-one",
  },
  createdState: ALERT_CREATED_STATE,
  acknowledgedState: ALERT_ACKNOWLEDGED_STATE,
  resolvedState: ALERT_RESOLVED_STATE,
  states: ALERT_STATES,
  severities: ALERT_SEVERITIES,
  mostSevere: { id: HIGH_ALERT_SEVERITY_ID, name: "High" },
  // Two severities: the middle of the range rounds to the less severe one.
  middleSeverity: { id: LOW_ALERT_SEVERITY_ID, name: "Low" },
  leastSevere: { id: LOW_ALERT_SEVERITY_ID, name: "Low" },
  // An alert never reaches a status page, so there is nothing to keep it off.
  quietCreateFields: {},
  // An alert's root cause is written at creation and cannot be edited after.
  editListenOn: {
    title: true,
    description: true,
    alertSeverityId: true,
    alertSeverity: true,
    remediationNotes: true,
  },
  defaultTitle: "Disk usage above 90% on db-1",
  defaultDescription:
    'The "db-1" volume is at 93%.\nIt grew 4% in the last hour.',
  defaultSeverityName: "High",
  defaultNoteText: "Cleared old WAL segments. Usage is back to 71%.",
  model: alertModel,
  note: alertRecordNote,
  syncPrivate: syncPrivateSwitch("SYNC_PRIVATE_ALERTS"),
};

const KINDS: Array<SimulatedKind> = [INCIDENT, ALERT];

type TemplateIdsOfFunction = (kind: SimulatedKind) => Array<string>;

/** Every template of one kind, each once. */
const templateIdsOf: TemplateIdsOfFunction = (
  kind: SimulatedKind,
): Array<string> => {
  const ids: Array<string> = [
    ...Object.values(kind.templates),
    ...kind.noteTemplates.map((noteTemplate: NoteTemplate) => {
      return noteTemplate.templateId;
    }),
  ];

  return ids.filter((id: string, index: number) => {
    return ids.indexOf(id) === index;
  });
};

/* ------------------------------ Scenario helpers ------------------------------ */

type OnRecordFunction = (model: JSONObject) => JSONObject;

/** What a database trigger hands over. */
const onRecord: OnRecordFunction = (model: JSONObject): JSONObject => {
  return { model: model };
};

type WebhookDeliveryFunction = (body: JSONObject) => JSONObject;

/** What the Webhook trigger hands over for a Jira delivery: lowercased headers, no query, the parsed body. */
const webhookDelivery: WebhookDeliveryFunction = (
  body: JSONObject,
): JSONObject => {
  return {
    "request-headers": {
      "content-type": "application/json; charset=utf-8",
      "user-agent": "Atlassian Webhook HTTP Client",
      "x-atlassian-webhook-identifier": WEBHOOK_IDENTIFIER,
      "x-atlassian-webhook-retry": "0",
    },
    "request-params": {},
    "request-body": body,
  };
};

type SearchRequestFunction = (
  kind: SimulatedKind,
  fields: Array<string>,
  expandTransitions?: boolean,
) => JiraRequest;

/*
 * The label search every OneUptime -> Jira template starts with. It asks for
 * two issues, oldest first, so a clone carrying the same label is seen and
 * refused rather than silently being "the" issue.
 */
const searchRequest: SearchRequestFunction = (
  kind: SimulatedKind,
  fields: Array<string>,
  expandTransitions?: boolean,
): JiraRequest => {
  const body: JSONObject = {
    jql: `labels = "${kind.labelPrefix}${kind.id}" ORDER BY created ASC`,
    fields: fields,
    maxResults: 2,
  };

  if (expandTransitions) {
    body["expand"] = "transitions";
  }

  return {
    method: "POST",
    url: `${JIRA_SITE}/rest/api/3/search/jql`,
    headers: AUTHORIZATION,
    body: body,
  };
};

type AdfOfFunction = (text: string) => JSONObject;

/** A comment body as the comment templates build it: one paragraph holding one text node. */
const adfOf: AdfOfFunction = (text: string): JSONObject => {
  return {
    type: "doc",
    version: 1,
    content: [{ type: "paragraph", content: [{ type: "text", text: text }] }],
  };
};

/** Marks a comment internal in Jira Service Management, so the customer never sees it. */
const INTERNAL_COMMENT_PROPERTY: JSONObject = {
  key: "sd.public.comment",
  value: { internal: true },
};

type ExpectValidAdfFunction = (document: JSONValue | undefined) => void;

/*
 * Jira's v3 API answers 400 to a document that is not a doc of paragraphs, or
 * that holds an empty text node, so a body that parses is not enough.
 */
const expectValidAdf: ExpectValidAdfFunction = (
  document: JSONValue | undefined,
): void => {
  const doc: JSONObject = document as JSONObject;

  expect(doc["type"]).toBe("doc");
  expect(doc["version"]).toBe(1);

  const paragraphs: Array<JSONObject> = doc["content"] as Array<JSONObject>;
  expect(paragraphs.length).toBeGreaterThan(0);

  for (const paragraph of paragraphs) {
    expect(paragraph["type"]).toBe("paragraph");

    const nodes: Array<JSONObject> = paragraph["content"] as Array<JSONObject>;
    expect(nodes.length).toBeGreaterThan(0);

    for (const node of nodes) {
      expect(node["type"]).toBe("text");
      expect(typeof node["text"]).toBe("string");
      expect((node["text"] as string).length).toBeGreaterThan(0);

      for (const mark of (node["marks"] as Array<JSONObject> | undefined) ||
        []) {
        expect(mark["type"]).toBe("link");
        expect(
          ((mark["attrs"] as JSONObject)["href"] as string).startsWith(
            "https://",
          ),
        ).toBe(true);
      }
    }
  }
};

type WikiTextOfFunction = (document: JSONValue | undefined) => string;

/*
 * A posted ADF document as the webhook later carries it: Jira Cloud webhooks
 * send rich text as a wiki-markup string, a paragraph per block and a link
 * as [text|href].
 */
const wikiTextOf: WikiTextOfFunction = (
  document: JSONValue | undefined,
): string => {
  const paragraphs: Array<JSONObject> = (document as JSONObject)[
    "content"
  ] as Array<JSONObject>;

  return paragraphs
    .map((paragraph: JSONObject): string => {
      return (paragraph["content"] as Array<JSONObject>)
        .map((node: JSONObject): string => {
          const marks: Array<JSONObject> =
            (node["marks"] as Array<JSONObject> | undefined) || [];
          const link: JSONObject | undefined = marks.find(
            (mark: JSONObject) => {
              return mark["type"] === "link";
            },
          );

          return link
            ? `[${node["text"] as string}|${(link["attrs"] as JSONObject)["href"] as string}]`
            : (node["text"] as string);
        })
        .join("");
    })
    .join("\n\n");
};

type RecordOfFunction = (
  kind: SimulatedKind,
  state: JSONObject,
  recordId?: string,
) => JSONObject;

/* A record as Find One returns it for the status template's select. */
const recordOf: RecordOfFunction = (
  kind: SimulatedKind,
  state: JSONObject,
  recordId?: string,
): JSONObject => {
  return {
    _id: recordId || kind.id,
    [kind.numberField]: kind.number,
    [kind.stateRelation]: {
      _id: state["_id"] as string,
      name: state["name"] as string,
      order: state["order"] as number,
    },
  };
};

type KindObjectFunction = (kind: SimulatedKind) => JSONObject;

/* A record as Find One returns it for the note templates' select. */
const linkedRecordOf: KindObjectFunction = (
  kind: SimulatedKind,
): JSONObject => {
  return { _id: kind.id, [kind.numberField]: kind.number };
};

type LinkedLabelsOfFunction = (kind: SimulatedKind) => Array<string>;

/** The labels an issue linked to the kind's fixture record carries. */
const linkedLabelsOf: LinkedLabelsOfFunction = (
  kind: SimulatedKind,
): Array<string> => {
  return [JIRA_LINK_LABEL, kind.label()];
};

type KindDatabaseFunction = (
  kind: SimulatedKind,
  record: JSONObject | null,
) => FakeDatabase;

const statusDatabase: KindDatabaseFunction = (
  kind: SimulatedKind,
  record: JSONObject | null,
): FakeDatabase => {
  return {
    [kind.components.findOne]: found(record),
    [kind.components.stateFindMany]: many(kind.states),
    [kind.components.timelineCreateOne]: createdWithId(NEW_TIMELINE_ID),
  };
};

const noteDatabase: KindDatabaseFunction = (
  kind: SimulatedKind,
  record: JSONObject | null,
): FakeDatabase => {
  return {
    [kind.components.findOne]: found(record),
    [kind.components.noteCreateOne]: createdWithId(NEW_NOTE_ID),
  };
};

type CreateDatabaseFunction = (kind: SimulatedKind) => FakeDatabase;

/** What the create-from-Jira template reads and writes. */
const createDatabase: CreateDatabaseFunction = (
  kind: SimulatedKind,
): FakeDatabase => {
  return {
    [kind.components.severityFindMany]: many(kind.severities),
    [kind.components.createOne]: createdWithId(kind.newId),
  };
};

/** The one read the Jira -> OneUptime templates make: an issue's labels, as Jira has them now. */
const GET_LABELS_REQUEST: JiraRequest = {
  method: "GET",
  url: `${JIRA_SITE}/rest/api/3/issue/${JIRA_ISSUE_KEY}?fields=labels`,
  headers: AUTHORIZATION,
};

type CreateFromIssueJiraFunction = (props?: {
  labels?: Array<string> | undefined;
  getIssue?: JiraReply | undefined;
  edit?: JiraReply | undefined;
}) => FakeJiraFunction;

/*
 * Jira as the create-from-Jira templates meet it: first asked for the issue's
 * labels, then asked to add the link labels. By default the issue has none
 * yet, as a freshly created issue does.
 */
const createFromIssueJira: CreateFromIssueJiraFunction = (props?: {
  labels?: Array<string> | undefined;
  getIssue?: JiraReply | undefined;
  edit?: JiraReply | undefined;
}): FakeJiraFunction => {
  return jiraRoutes({
    [GET_LABELS]:
      props?.getIssue || ok(jiraIssueLabelsResponse(props?.labels || [])),
    [EDIT_ISSUE]: props?.edit || NO_CONTENT,
  });
};

type LinkLabelsRequestFunction = (kind: SimulatedKind) => JiraRequest;

/*
 * The PUT that links an issue to the record just created from it. The label
 * carries the id the database gave the record — nothing else could.
 */
const linkLabelsRequest: LinkLabelsRequestFunction = (
  kind: SimulatedKind,
): JiraRequest => {
  return {
    method: "PUT",
    url: `${JIRA_SITE}/rest/api/3/issue/${JIRA_ISSUE_KEY}`,
    headers: AUTHORIZATION,
    body: {
      update: {
        labels: [
          { add: JIRA_LINK_LABEL },
          { add: `${kind.labelPrefix}${kind.newId}` },
        ],
      },
    },
  };
};

const LABEL_JQL: RegExp = /^labels = "([^"]+)" ORDER BY created ASC$/;

type LabelAwareJiraFunction = (issueLabels: Array<string>) => FakeJiraFunction;

/*
 * Jira holding one issue, OPS-17, carrying the given labels. A label search
 * finds it only when its JQL names one of them, as Jira itself would answer,
 * so a template searching by another kind's label finds nothing. Transitions
 * and comments on the issue are accepted.
 */
const labelAwareJira: LabelAwareJiraFunction = (
  issueLabels: Array<string>,
): FakeJiraFunction => {
  const otherRoutes: FakeJiraFunction = jiraRoutes({
    [TRANSITION]: NO_CONTENT,
    [COMMENT]: COMMENT_CREATED,
  });

  return (request: JiraRequest): JiraReply => {
    if (`${request.method} ${request.url.replace(JIRA_SITE, "")}` !== SEARCH) {
      return otherRoutes(request);
    }

    const match: RegExpExecArray | null = LABEL_JQL.exec(
      String((request.body as JSONObject)["jql"]),
    );

    return ok(
      match && issueLabels.includes(match[1] as string)
        ? jiraSearchResponse()
        : EMPTY_JIRA_SEARCH,
    );
  };
};

type TriggerArgumentsOfFunction = (templateId: string) => JSONObject;

/*
 * What a database trigger is configured with. The simulation hands the
 * trigger's model over as given, so a scenario that depends on a field — like
 * isPrivate — also checks that the real trigger would have selected it.
 */
const triggerArgumentsOf: TriggerArgumentsOfFunction = (
  templateId: string,
): JSONObject => {
  const graph: SimulatedGraph = buildSimulatedGraph(templateId);
  const trigger: SimulatedNode = graph.nodes[
    graph.triggerComponentId
  ] as SimulatedNode;

  return trigger.arguments;
};

const triggerSelectOf: TriggerArgumentsOfFunction = (
  templateId: string,
): JSONObject => {
  return triggerArgumentsOf(templateId)["select"] as JSONObject;
};

type FiresOnUpdateFunction = (
  templateId: string,
  updatedFields: JSONObject,
) => boolean;

/*
 * The filter OnTriggerBaseModel.initTrigger
 * (packages/Common/Server/Types/Workflow/Components/BaseModel/OnTriggerBaseModel.ts)
 * puts in front of an on-update workflow: with a Listen On set, the workflow
 * runs only when one of its keys is truthy among the fields the update
 * changed. Keys are compared exactly, so an edit form that sends a relation
 * is only heard by a Listen On naming the relation.
 */
const firesOnUpdate: FiresOnUpdateFunction = (
  templateId: string,
  updatedFields: JSONObject,
): boolean => {
  const listenOn: JSONObject | undefined = triggerArgumentsOf(templateId)[
    "listen-on"
  ] as JSONObject | undefined;

  if (
    !listenOn ||
    Object.keys(listenOn).length === 0 ||
    Object.keys(updatedFields).length === 0
  ) {
    return true;
  }

  return Object.keys(listenOn).some((key: string) => {
    return Boolean(updatedFields[key]);
  });
};

const CLONE_KEY: string = "OPS-30";

type FirstIssueOfFunction = (search: JSONObject) => JSONObject;

const firstIssueOf: FirstIssueOfFunction = (search: JSONObject): JSONObject => {
  return (search["issues"] as Array<JSONObject>)[0] as JSONObject;
};

/*
 * Cloning an issue in Jira copies its labels, so the clone claims the record
 * too. The search sorts oldest first; the original comes back first.
 */
const CLONED_SEARCH: JSONObject = jiraSearchResponse({
  issues: [
    firstIssueOf(jiraSearchResponse()),
    {
      ...firstIssueOf(jiraSearchResponse({ key: CLONE_KEY })),
      id: "10071",
      self: `${JIRA_SITE}/rest/api/3/issue/10071`,
    },
  ],
});

type KindLogFunction = (kind: SimulatedKind) => string;

const cloneSkippedLog: KindLogFunction = (kind: SimulatedKind): string => {
  return `ℹ️ More than one Jira issue is labelled ${kind.label()} (${JIRA_ISSUE_KEY}, ${CLONE_KEY}). A cloned issue copies the label: remove it from every issue except the one filed for the ${kind.noun}.`;
};

/** A OneUptime -> Jira template whose label search found nothing. */
const noLinkedIssueLog: KindLogFunction = (kind: SimulatedKind): string => {
  return `ℹ️ No Jira issue is labelled ${kind.label()}, or the Jira credentials cannot see it.`;
};

/** A Jira -> OneUptime template given an issue that carries no label of its kind. */
const notLinkedLog: KindLogFunction = (kind: SimulatedKind): string => {
  return `ℹ️ Jira issue ${JIRA_ISSUE_KEY} is not linked to an ${kind.noun}: it has no ${kind.labelPrefix}<id> label.`;
};

/** A create-from-Jira template given an issue that is already linked to anything. */
const alreadyLinkedLog: KindLogFunction = (kind: SimulatedKind): string => {
  return `ℹ️ Jira issue ${JIRA_ISSUE_KEY} is already linked to OneUptime, so no ${kind.noun} was ${kind.created}.`;
};

const NOTE_FROM_JIRA_LOG: string =
  "ℹ️ This note came from Jira, so it was not posted back.";

const COMMENT_FROM_ONEUPTIME_LOG: string =
  "ℹ️ This comment was posted by OneUptime, so it was not copied back.";

const NOTHING_WORTH_A_NOTE_LOG: string = `ℹ️ Nothing that changed on Jira issue ${JIRA_ISSUE_KEY} is worth a note.`;

type CallOfFunction = (
  trace: SimulationTrace,
  metadataId: string,
) => DatabaseCall;

const callOf: CallOfFunction = (
  trace: SimulationTrace,
  metadataId: string,
): DatabaseCall => {
  const calls: Array<DatabaseCall> = trace.databaseCalls.filter(
    (call: DatabaseCall) => {
      return call.metadataId === metadataId;
    },
  );

  expect(calls).toHaveLength(1);

  return calls[0] as DatabaseCall;
};

type JsonOfFunction = (
  trace: SimulationTrace,
  metadataId: string,
) => JSONObject;

/** The fields a create step wrote. */
const jsonOf: JsonOfFunction = (
  trace: SimulationTrace,
  metadataId: string,
): JSONObject => {
  return callOf(trace, metadataId).args["json"] as JSONObject;
};

type MetadataIdsOfFunction = (trace: SimulationTrace) => Array<string>;

const metadataIdsOf: MetadataIdsOfFunction = (
  trace: SimulationTrace,
): Array<string> => {
  return trace.databaseCalls.map((call: DatabaseCall) => {
    return call.metadataId;
  });
};

type AddedLabelsOfFunction = (trace: SimulationTrace) => Array<string>;

/** The labels a create-from-Jira template's PUT added to the issue. */
const addedLabelsOf: AddedLabelsOfFunction = (
  trace: SimulationTrace,
): Array<string> => {
  const edit: JiraRequest | undefined = trace.requests.find(
    (request: JiraRequest) => {
      return request.method === "PUT";
    },
  );

  expect(edit).toBeDefined();

  return (
    ((edit!.body as JSONObject)["update"] as JSONObject)[
      "labels"
    ] as Array<JSONObject>
  ).map((operation: JSONObject) => {
    return operation["add"] as string;
  });
};

type PostedCommentOfFunction = (trace: SimulationTrace) => JSONObject;

/** The ADF document a comment template posted. */
const postedCommentOf: PostedCommentOfFunction = (
  trace: SimulationTrace,
): JSONObject => {
  const post: JiraRequest | undefined = trace.requests.find(
    (request: JiraRequest) => {
      return request.url.endsWith("/comment");
    },
  );

  expect(post).toBeDefined();

  return (post!.body as JSONObject)["body"] as JSONObject;
};

type IssueFieldsOfFunction = (trace: SimulationTrace) => JSONObject;

/** The fields of the issue a create-issue template filed. */
const issueFieldsOf: IssueFieldsOfFunction = (
  trace: SimulationTrace,
): JSONObject => {
  return (trace.requests[0]!.body as JSONObject)["fields"] as JSONObject;
};

interface WebhookScenarioProps {
  event: JSONObject;
  /** The issue's labels as Jira's GET returns them; the kind's own link by default. */
  labels?: Array<string> | undefined;
  /** What Find One returns; the kind's fixture record by default, null for "not here". */
  record?: JSONObject | null | undefined;
}

type WebhookScenarioFunction = (
  kind: SimulatedKind,
  props: WebhookScenarioProps,
) => Scenario;

/* A Jira comment delivered to the kind's comment-to-note template. */
const commentScenario: WebhookScenarioFunction = (
  kind: SimulatedKind,
  props: WebhookScenarioProps,
): Scenario => {
  return {
    templateId: kind.templates.commentToNote,
    trigger: webhookDelivery(props.event),
    jira: jiraRoutes({
      [GET_LABELS]: ok(
        jiraIssueLabelsResponse(props.labels || linkedLabelsOf(kind)),
      ),
    }),
    database: noteDatabase(
      kind,
      props.record === undefined ? linkedRecordOf(kind) : props.record,
    ),
  };
};

/* An issue_updated delivered to the kind's issue-changes template. It asks Jira nothing. */
const issueChangesScenario: WebhookScenarioFunction = (
  kind: SimulatedKind,
  props: WebhookScenarioProps,
): Scenario => {
  return {
    templateId: kind.templates.issueChangesToNote,
    trigger: webhookDelivery(props.event),
    database: noteDatabase(
      kind,
      props.record === undefined ? linkedRecordOf(kind) : props.record,
    ),
  };
};

type RunWebhookFunction = (
  kind: SimulatedKind,
  props: WebhookScenarioProps,
) => Promise<SimulationTrace>;

/* Shared by the comment suite and the echo, cross-kind and security suites below. */
const runComment: RunWebhookFunction = async (
  kind: SimulatedKind,
  props: WebhookScenarioProps,
): Promise<SimulationTrace> => {
  return await runTemplate(commentScenario(kind, props));
};

const runIssueChanges: RunWebhookFunction = async (
  kind: SimulatedKind,
  props: WebhookScenarioProps,
): Promise<SimulationTrace> => {
  return await runTemplate(issueChangesScenario(kind, props));
};

type RunCreateFromIssueFunction = (
  kind: SimulatedKind,
  props?: {
    event?: JSONObject | undefined;
    labels?: Array<string> | undefined;
  },
) => Promise<SimulationTrace>;

/*
 * A jira:issue_created delivered to the kind's create-from-Jira template, for
 * an issue Jira says carries the given labels (none by default).
 */
const runCreateFromIssue: RunCreateFromIssueFunction = async (
  kind: SimulatedKind,
  props?: {
    event?: JSONObject | undefined;
    labels?: Array<string> | undefined;
  },
): Promise<SimulationTrace> => {
  return await runTemplate({
    templateId: kind.templates.createFromIssue,
    trigger: webhookDelivery(props?.event || jiraIssueCreatedEvent()),
    jira: createFromIssueJira({ labels: props?.labels }),
    database: createDatabase(kind),
  });
};

type RunCreateIssueFunction = (kind: SimulatedKind) => Promise<SimulationTrace>;

/* The kind's create-issue template, filing its fixture record. */
const runCreateIssue: RunCreateIssueFunction = async (
  kind: SimulatedKind,
): Promise<SimulationTrace> => {
  return await runTemplate({
    templateId: kind.templates.createIssue,
    trigger: onRecord(kind.model()),
    jira: jiraRoutes({ [CREATE_ISSUE]: ISSUE_CREATED }),
  });
};

type RunNoteToCommentFunction = (
  templateId: string,
  note: JSONObject,
) => Promise<SimulationTrace>;

/* A note-to-comment template, meeting a linked issue that accepts the comment. */
const runNoteToComment: RunNoteToCommentFunction = async (
  templateId: string,
  note: JSONObject,
): Promise<SimulationTrace> => {
  return await runTemplate({
    templateId: templateId,
    trigger: onRecord(note),
    jira: jiraRoutes({
      [SEARCH]: ok(jiraSearchResponse()),
      [COMMENT]: COMMENT_CREATED,
    }),
  });
};

/* ------------------------------- The table itself ------------------------------- */

describe("simulated: every Jira template is simulated", () => {
  test("the two kinds between them name every Jira template, and nothing else", () => {
    const simulated: Array<string> = [
      ...templateIdsOf(INCIDENT),
      ...templateIdsOf(ALERT),
    ].sort();
    const jira: Array<string> = getWorkflowTemplatesByCategory(
      WorkflowTemplateCategory.Jira,
    )
      .map((template: WorkflowTemplate) => {
        return template.id;
      })
      .sort();

    expect(simulated).toEqual(jira);
    expect(templateIdsOf(INCIDENT)).toHaveLength(9);
    expect(templateIdsOf(ALERT)).toHaveLength(8);
  });

  test("the label prefixes this file writes out are the ones the templates export", () => {
    expect(INCIDENT.labelPrefix).toBe(JIRA_INCIDENT_LABEL_PREFIX);
    expect(ALERT.labelPrefix).toBe(JIRA_ALERT_LABEL_PREFIX);
    expect(INCIDENT.label()).toBe(
      `${JIRA_INCIDENT_LABEL_PREFIX}${INCIDENT_ID}`,
    );
    expect(ALERT.label()).toBe(`${JIRA_ALERT_LABEL_PREFIX}${ALERT_ID}`);
  });
});

/* ------------------------------- OneUptime -> Jira ------------------------------- */

type ExpectedTextFunction = (kind: SimulatedKind) => string;

const expectedIssueDescription: ExpectedTextFunction = (
  kind: SimulatedKind,
): string => {
  return [
    `${kind.number} was ${kind.created} in OneUptime.`,
    `Severity: ${kind.defaultSeverityName}`,
    `State: ${kind.createdState["name"] as string}`,
    "",
    kind.defaultDescription,
  ].join("\n");
};

/** The record's page in the dashboard, which the issue links back to. */
const recordUrlOf: ExpectedTextFunction = (kind: SimulatedKind): string => {
  return `${ONEUPTIME_URL}/dashboard/${PROJECT_ID}/${kind.dashboardPath}/${kind.id}`;
};

describe.each(KINDS)(
  "simulated: create a Jira issue when an $noun is $created",
  (kind: SimulatedKind) => {
    const TEMPLATE: string = kind.templates.createIssue;

    test(`files one labelled issue, with a readable ADF description that links back to the ${kind.noun}`, async () => {
      const trace: SimulationTrace = await runTemplate({
        templateId: TEMPLATE,
        trigger: onRecord(kind.model()),
        jira: jiraRoutes({ [CREATE_ISSUE]: ISSUE_CREATED }),
      });

      expect(trace.executed).toEqual([
        kind.steps.onCreate,
        "prepare-issue-1",
        "if-create-1",
        "create-issue-1",
        "log-created",
      ]);

      expect(trace.requests).toEqual([
        {
          method: "POST",
          url: `${JIRA_SITE}/rest/api/3/issue`,
          headers: AUTHORIZATION,
          body: {
            fields: {
              project: { key: "OPS" },
              issuetype: { name: "Task" },
              summary: `[OneUptime] ${kind.number}: ${kind.defaultTitle}`,
              labels: [JIRA_LINK_LABEL, kind.label()],
              description: {
                type: "doc",
                version: 1,
                content: [
                  {
                    type: "paragraph",
                    content: [
                      { type: "text", text: expectedIssueDescription(kind) },
                    ],
                  },
                  {
                    type: "paragraph",
                    content: [
                      {
                        type: "text",
                        text: `Open this ${kind.noun} in OneUptime`,
                        marks: [
                          {
                            type: "link",
                            attrs: { href: recordUrlOf(kind) },
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            },
          },
        },
      ]);

      expectValidAdf(issueFieldsOf(trace)["description"]);

      expect(trace.logs).toEqual([
        `✅ Created Jira issue ${JIRA_ISSUE_KEY} for ${kind.number}.`,
      ]);
      expect(trace.databaseCalls).toEqual([]);
    });

    test(`an ${kind.noun} ${kind.created} from Jira is skipped before anything is sent`, async () => {
      const trace: SimulationTrace = await runTemplate({
        templateId: TEMPLATE,
        trigger: onRecord(
          kind.model({ customFields: { jiraIssueKey: "OPS-9" } }),
        ),
        jira: jiraRoutes({ [CREATE_ISSUE]: ISSUE_CREATED }),
      });

      expect(trace.requests).toEqual([]);
      expect(trace.ports["if-create-1"]).toBe("no");
      expect(trace.logs).toEqual([
        `ℹ️ ${kind.number} was ${kind.created} from Jira issue OPS-9, so no new issue was created.`,
      ]);
    });

    test(`a private ${kind.noun} stays in OneUptime: no request of any kind reaches Jira`, async () => {
      // The trigger has to ask for the flag, or the script would never see it.
      expect(triggerSelectOf(TEMPLATE)["isPrivate"]).toBe(true);

      const trace: SimulationTrace = await runTemplate({
        templateId: TEMPLATE,
        trigger: onRecord(kind.model({ isPrivate: true })),
        jira: jiraRoutes({ [CREATE_ISSUE]: ISSUE_CREATED }),
      });

      expect(trace.executed).toEqual([
        kind.steps.onCreate,
        "prepare-issue-1",
        "if-create-1",
        "log-skipped",
      ]);
      expect(trace.requests).toEqual([]);
      expect(trace.logs).toEqual([
        `ℹ️ ${kind.number} is a private ${kind.noun}, so no Jira issue was created.`,
      ]);
    });

    test(`switching the script's SYNC_PRIVATE switch on files the private ${kind.noun} after all`, async () => {
      const trace: SimulationTrace = await runTemplate({
        templateId: TEMPLATE,
        trigger: onRecord(kind.model({ isPrivate: true })),
        jira: jiraRoutes({ [CREATE_ISSUE]: ISSUE_CREATED }),
        editCode: { "prepare-issue-1": kind.syncPrivate },
      });

      expect(trace.requests).toHaveLength(1);
      expect(issueFieldsOf(trace)["labels"]).toEqual([
        JIRA_LINK_LABEL,
        kind.label(),
      ]);
      expect(trace.logs).toEqual([
        `✅ Created Jira issue ${JIRA_ISSUE_KEY} for ${kind.number}.`,
      ]);
    });

    test("Jira's 400 reaches the failure log with the field errors it named", async () => {
      const rejection: JSONObject = {
        errorMessages: [],
        errors: {
          summary: "You must specify a summary of the issue.",
          issuetype: "Specify an issue type",
        },
      };

      const trace: SimulationTrace = await runTemplate({
        templateId: TEMPLATE,
        trigger: onRecord(kind.model()),
        jira: jiraRoutes({ [CREATE_ISSUE]: badRequest(rejection) }),
      });

      expect(trace.requests).toHaveLength(1);
      expect(trace.ports["create-issue-1"]).toBe("error");

      /*
       * Jira's error body has none of the keys HTTPErrorResponse reads a
       * message from, so the error value is the generic one — which is why
       * the log also carries the body itself.
       */
      expect(trace.logs).toEqual([
        `❌ Jira did not create the issue: Server Error.\nJira said: ${JSON.stringify(rejection, null, 2)}`,
      ]);
      expect(trace.logs[0]).toContain(
        '"summary": "You must specify a summary of the issue."',
      );
    });

    test("a title full of quotes, line breaks, backslashes and braces still sends valid JSON and a one-line summary", async () => {
      const title: string =
        'Disk "full" on\n  C:\\data\\{{local.variables.jiraBasicAuthToken}} {shard}\\';

      const trace: SimulationTrace = await runTemplate({
        templateId: TEMPLATE,
        trigger: onRecord(
          kind.model({
            title: title,
            description: 'Path "C:\\logs\\app.log"\r\n\ttab {{x}} $& $1',
          }),
        ),
        jira: jiraRoutes({ [CREATE_ISSUE]: ISSUE_CREATED }),
      });

      // Reaching Jira at all means the body survived substitution and JSON.parse.
      expect(trace.requests).toHaveLength(1);

      const fields: JSONObject = issueFieldsOf(trace);

      expect(fields["summary"]).toBe(
        `[OneUptime] ${kind.number}: Disk "full" on C:\\data\\{ {local.variables.jiraBasicAuthToken} } {shard}\\`,
      );
      expect(fields["summary"]).not.toMatch(/[\r\n]/);

      const description: string = (
        (
          (
            (fields["description"] as JSONObject)[
              "content"
            ] as Array<JSONObject>
          )[0]!["content"] as Array<JSONObject>
        )[0] as JSONObject
      )["text"] as string;

      // The carriage return is dropped, the tab kept, and "$&" is not read as a replacement pattern.
      expect(description).toContain(
        'Path "C:\\logs\\app.log"\n\ttab { {x} } $& $1',
      );
      expectValidAdf(fields["description"]);
      expect(JSON.stringify(trace.requests[0]!.body)).not.toContain(JIRA_TOKEN);
      expect(trace.logs).toEqual([
        `✅ Created Jira issue ${JIRA_ISSUE_KEY} for ${kind.number}.`,
      ]);
    });
  },
);

/*
 * Jira Service Management's service request workflow, as its transitions
 * endpoint lists them. Canceled is a Done status too, and it is the one
 * without a screen, so "any Done status, screenless first" would cancel the
 * customer's request instead of resolving it.
 */
const JSM_WAITING_FOR_SUPPORT: JSONObject = jiraStatus({
  name: "Waiting for support",
  categoryKey: "new",
  id: "10100",
});

const JSM_TRANSITIONS: Array<JSONObject> = [
  jiraTransition({
    id: "851",
    name: "Respond to customer",
    to: jiraStatus({
      name: "Waiting for customer",
      categoryKey: "indeterminate",
      id: "10101",
    }),
  }),
  jiraTransition({
    id: "871",
    name: "Escalate",
    to: jiraStatus({
      name: "Escalated",
      categoryKey: "indeterminate",
      id: "10102",
    }),
  }),
  jiraTransition({
    id: "881",
    name: "Start work",
    to: jiraStatus({
      name: "Work in progress",
      categoryKey: "indeterminate",
      id: "10103",
    }),
  }),
  jiraTransition({
    id: "761",
    name: "Resolve this issue",
    hasScreen: true,
    to: jiraStatus({ name: "Resolved", categoryKey: "done", id: "10104" }),
  }),
  jiraTransition({
    id: "901",
    name: "Cancel request",
    to: jiraStatus({ name: "Canceled", categoryKey: "done", id: "10105" }),
  }),
];

/** An issue someone already closed, from which only moving back is on offer. */
const DONE_SEARCH: JSONObject = jiraSearchResponse({
  status: DONE,
  transitions: [
    jiraTransition({ id: "11", name: "Reopen", to: TO_DO }),
    jiraTransition({ id: "21", name: "Start work", to: IN_PROGRESS }),
  ],
});

type TransitionRequestFunction = (transitionId: string) => JiraRequest;

const transitionRequest: TransitionRequestFunction = (
  transitionId: string,
): JiraRequest => {
  return {
    method: "POST",
    url: `${JIRA_SITE}/rest/api/3/issue/${JIRA_ISSUE_KEY}/transitions`,
    headers: AUTHORIZATION,
    body: { transition: { id: transitionId } },
  };
};

describe.each(KINDS)(
  "simulated: move the Jira issue when the $noun is acknowledged or resolved",
  (kind: SimulatedKind) => {
    const TEMPLATE: string = kind.templates.transition;

    type RunTransitionFunction = (
      state: JSONObject,
      search: JiraReply,
    ) => Promise<SimulationTrace>;

    const runTransition: RunTransitionFunction = async (
      state: JSONObject,
      search: JiraReply,
    ): Promise<SimulationTrace> => {
      return await runTemplate({
        templateId: TEMPLATE,
        trigger: onRecord(kind.model({ state: state })),
        jira: jiraRoutes({ [SEARCH]: search, [TRANSITION]: NO_CONTENT }),
      });
    };

    test("acknowledged: finds the issue by label, then moves it to In Progress", async () => {
      const trace: SimulationTrace = await runTransition(
        kind.acknowledgedState,
        ok(jiraSearchResponse()),
      );

      expect(trace.executed).toEqual([
        kind.steps.onUpdate,
        "find-issue-1",
        "plan-transition-1",
        "if-transition-1",
        "transition-issue-1",
        "log-transitioned",
      ]);
      expect(trace.requests).toEqual([
        searchRequest(kind, ["key", "status"], true),
        transitionRequest("21"),
      ]);

      // The 204 Jira answers with is a success, empty body and all.
      expect(trace.ports["transition-issue-1"]).toBe("success");
      expect(
        trace.storage.local.components["transition-issue-1"]!.returnValues[
          "response-body"
        ],
      ).toEqual({ data: "" });
      expect(trace.logs).toEqual([
        `✅ Moved Jira issue ${JIRA_ISSUE_KEY} to In Progress. ${kind.number} is Acknowledged in OneUptime.`,
      ]);
    });

    test("resolved: moves the issue to Done with the Close transition", async () => {
      const trace: SimulationTrace = await runTransition(
        kind.resolvedState,
        ok(jiraSearchResponse()),
      );

      expect(trace.requests).toHaveLength(2);
      expect(trace.requests[1]!.body).toEqual({ transition: { id: "31" } });
      expect(trace.logs).toEqual([
        `✅ Moved Jira issue ${JIRA_ISSUE_KEY} to Done. ${kind.number} is Resolved in OneUptime.`,
      ]);
    });

    test("an issue that is already Done is left alone after the search", async () => {
      const trace: SimulationTrace = await runTransition(
        kind.resolvedState,
        ok(DONE_SEARCH),
      );

      expect(trace.requests).toEqual([
        searchRequest(kind, ["key", "status"], true),
      ]);
      expect(trace.logs).toEqual([
        `ℹ️ Jira issue ${JIRA_ISSUE_KEY} is already Done.`,
      ]);
    });

    /*
     * Someone closed the issue in Jira before anyone acknowledged the record.
     * Acknowledging it afterwards must not reopen the issue, even though a
     * transition back to In Progress is on offer.
     */
    test(`acknowledging an ${kind.noun} whose issue is already Done posts no transition`, async () => {
      const trace: SimulationTrace = await runTransition(
        kind.acknowledgedState,
        ok(DONE_SEARCH),
      );

      expect(trace.requests).toEqual([
        searchRequest(kind, ["key", "status"], true),
      ]);
      expect(trace.ports["if-transition-1"]).toBe("no");
      expect(trace.logs).toEqual([
        `ℹ️ Jira issue ${JIRA_ISSUE_KEY} is already Done, so it was not moved back to an In Progress status.`,
      ]);
    });

    test("Jira Service Management: resolving picks Resolved, not the screenless Canceled", async () => {
      const trace: SimulationTrace = await runTransition(
        kind.resolvedState,
        ok(
          jiraSearchResponse({
            status: JSM_WAITING_FOR_SUPPORT,
            transitions: JSM_TRANSITIONS,
          }),
        ),
      );

      expect(trace.requests).toEqual([
        searchRequest(kind, ["key", "status"], true),
        transitionRequest("761"),
      ]);
      expect(trace.logs).toEqual([
        `✅ Moved Jira issue ${JIRA_ISSUE_KEY} to Resolved. ${kind.number} is Resolved in OneUptime.`,
      ]);
    });

    test("Jira Service Management: acknowledging picks Work in progress, never Escalated or Waiting for customer", async () => {
      const trace: SimulationTrace = await runTransition(
        kind.acknowledgedState,
        ok(
          jiraSearchResponse({
            status: JSM_WAITING_FOR_SUPPORT,
            transitions: JSM_TRANSITIONS,
          }),
        ),
      );

      expect(trace.requests).toHaveLength(2);
      expect(trace.requests[1]!.body).toEqual({ transition: { id: "881" } });
      expect(trace.logs).toEqual([
        `✅ Moved Jira issue ${JIRA_ISSUE_KEY} to Work in progress. ${kind.number} is Acknowledged in OneUptime.`,
      ]);
    });

    test("two Done statuses that fit equally well move nothing, and the skip names both", async () => {
      const trace: SimulationTrace = await runTransition(
        kind.resolvedState,
        ok(
          jiraSearchResponse({
            status: IN_PROGRESS,
            transitions: [
              jiraTransition({
                id: "51",
                name: "Release",
                to: jiraStatus({
                  name: "Released",
                  categoryKey: "done",
                  id: "10200",
                }),
              }),
              jiraTransition({
                id: "61",
                name: "Deploy",
                to: jiraStatus({
                  name: "Deployed",
                  categoryKey: "done",
                  id: "10201",
                }),
              }),
            ],
          }),
        ),
      );

      expect(trace.requests).toEqual([
        searchRequest(kind, ["key", "status"], true),
      ]);
      expect(trace.logs).toEqual([
        `ℹ️ Jira issue ${JIRA_ISSUE_KEY} could move to Released or Deployed for a Done status. Name the one to use in STATE_TO_JIRA_STATUS.`,
      ]);
    });

    test(`two issues carry the ${kind.noun}'s label (a clone): no transition, and the skip names both`, async () => {
      const trace: SimulationTrace = await runTransition(
        kind.resolvedState,
        ok(CLONED_SEARCH),
      );

      expect(trace.requests).toEqual([
        searchRequest(kind, ["key", "status"], true),
      ]);
      expect(trace.logs).toEqual([cloneSkippedLog(kind)]);
    });

    test(`a private ${kind.noun}'s issue is not moved`, async () => {
      expect(triggerSelectOf(TEMPLATE)["isPrivate"]).toBe(true);

      const trace: SimulationTrace = await runTemplate({
        templateId: TEMPLATE,
        trigger: onRecord(
          kind.model({ state: kind.resolvedState, isPrivate: true }),
        ),
        jira: jiraRoutes({
          [SEARCH]: ok(jiraSearchResponse()),
          [TRANSITION]: NO_CONTENT,
        }),
      });

      expect(trace.requests).toEqual([
        searchRequest(kind, ["key", "status"], true),
      ]);
      expect(trace.logs).toEqual([
        `ℹ️ ${kind.number} is a private ${kind.noun}, so its Jira issue was not moved.`,
      ]);
    });

    test("no linked issue: only the search is sent, and the skip says why", async () => {
      const trace: SimulationTrace = await runTransition(
        kind.acknowledgedState,
        ok(EMPTY_JIRA_SEARCH),
      );

      expect(trace.requests).toEqual([
        searchRequest(kind, ["key", "status"], true),
      ]);
      expect(trace.logs).toEqual([noLinkedIssueLog(kind)]);
    });

    test("a state with no Jira status mapped to it moves nothing", async () => {
      const trace: SimulationTrace = await runTransition(
        {
          _id: "aaaaaaaa-0000-4000-8000-000000000009",
          name: "Monitoring",
          order: 3,
          isAcknowledgedState: false,
          isResolvedState: false,
        },
        ok(jiraSearchResponse()),
      );

      expect(trace.requests).toHaveLength(1);
      expect(trace.logs).toEqual([
        `ℹ️ ${kind.number} moved to Monitoring, which has no Jira status mapped to it.`,
      ]);
    });

    test("a 401 with a plain-text body reaches the failure log", async () => {
      const trace: SimulationTrace = await runTransition(
        kind.acknowledgedState,
        {
          status: 401,
          body: "Client must be authenticated to access this resource.",
        },
      );

      expect(trace.executed).toEqual([
        kind.steps.onUpdate,
        "find-issue-1",
        "log-find-failed",
      ]);
      expect(trace.requests).toHaveLength(1);
      expect(trace.logs).toEqual([
        `❌ Could not search Jira for the ${kind.noun}'s issue: Client must be authenticated to access this resource.\nJira said: ${JSON.stringify(
          { data: "Client must be authenticated to access this resource." },
          null,
          2,
        )}`,
      ]);
    });
  },
);

describe.each(KINDS)(
  "simulated: copy $noun notes to the Jira issue",
  (kind: SimulatedKind) => {
    test.each(kind.noteTemplates)(
      "$templateId: a $visibility note becomes a comment on the linked issue, internal only when the note is private",
      async (noteTemplate: NoteTemplate) => {
        const trace: SimulationTrace = await runNoteToComment(
          noteTemplate.templateId,
          kind.note(),
        );

        const body: JSONObject = {
          body: adfOf(
            `${JIRA_SYNCED_FROM_ONEUPTIME_MARKER}: ${noteTemplate.visibility} note on ${kind.number} by Jane Doe.\n\n${kind.defaultNoteText}`,
          ),
        };

        // Without the property, Jira Service Management shows the comment to the customer.
        if (noteTemplate.internal) {
          body["properties"] = [INTERNAL_COMMENT_PROPERTY];
        }

        expect(trace.executed).toEqual([
          "note-on-create-1",
          "find-issue-1",
          "build-comment-1",
          "if-post-1",
          "post-comment-1",
          "log-posted",
        ]);
        expect(trace.requests).toEqual([
          searchRequest(kind, ["key", "summary"]),
          {
            method: "POST",
            url: `${JIRA_SITE}/rest/api/3/issue/${JIRA_ISSUE_KEY}/comment`,
            headers: AUTHORIZATION,
            body: body,
          },
        ]);
        expectValidAdf((trace.requests[1]!.body as JSONObject)["body"]);
        expect(trace.logs).toEqual([
          `✅ Posted the note to Jira issue ${JIRA_ISSUE_KEY}.`,
        ]);
      },
    );

    test.each(kind.noteTemplates)(
      "$templateId: a note that came from Jira is not posted back",
      async (noteTemplate: NoteTemplate) => {
        const trace: SimulationTrace = await runNoteToComment(
          noteTemplate.templateId,
          kind.note({
            note: `${ONEUPTIME_SYNCED_FROM_JIRA_MARKER}: Marco Rossi commented on [OPS-17](${JIRA_SITE}/browse/OPS-17).\n\nRolled back.`,
            authorName: null,
          }),
        );

        expect(trace.requests).toEqual([
          searchRequest(kind, ["key", "summary"]),
        ]);
        expect(trace.logs).toEqual([NOTE_FROM_JIRA_LOG]);
      },
    );

    test.each(kind.noteTemplates)(
      "$templateId: a note on a record without a linked issue gets no comment",
      async (noteTemplate: NoteTemplate) => {
        const trace: SimulationTrace = await runTemplate({
          templateId: noteTemplate.templateId,
          trigger: onRecord(kind.note()),
          jira: jiraRoutes({ [SEARCH]: ok(EMPTY_JIRA_SEARCH) }),
        });

        expect(trace.requests).toHaveLength(1);
        expect(trace.logs).toEqual([noLinkedIssueLog(kind)]);
      },
    );

    test.each(kind.noteTemplates)(
      "$templateId: a note on a private record posts no comment",
      async (noteTemplate: NoteTemplate) => {
        // The note trigger has to reach through to the record for the flag.
        expect(triggerSelectOf(noteTemplate.templateId)[kind.noun]).toEqual({
          [kind.numberField]: true,
          isPrivate: true,
        });

        const trace: SimulationTrace = await runNoteToComment(
          noteTemplate.templateId,
          kind.note({ isPrivate: true }),
        );

        expect(trace.requests).toEqual([
          searchRequest(kind, ["key", "summary"]),
        ]);
        expect(trace.ports["if-post-1"]).toBe("no");
        expect(trace.logs).toEqual([
          `ℹ️ The note is on ${kind.number}, a private ${kind.noun}, so it was not posted to Jira.`,
        ]);
      },
    );

    test(`switching the script's SYNC_PRIVATE switch on posts the private ${kind.noun}'s note after all`, async () => {
      const trace: SimulationTrace = await runTemplate({
        templateId: kind.templates.privateNote,
        trigger: onRecord(kind.note({ isPrivate: true })),
        jira: jiraRoutes({
          [SEARCH]: ok(jiraSearchResponse()),
          [COMMENT]: COMMENT_CREATED,
        }),
        editCode: { "build-comment-1": kind.syncPrivate },
      });

      expect(trace.requests).toHaveLength(2);
      expect(trace.requests[1]!.url).toBe(
        `${JIRA_SITE}/rest/api/3/issue/${JIRA_ISSUE_KEY}/comment`,
      );
      expect(trace.logs).toEqual([
        `✅ Posted the note to Jira issue ${JIRA_ISSUE_KEY}.`,
      ]);
    });

    test.each(kind.noteTemplates)(
      "$templateId: two issues carrying the record's label (a clone) get no comment, and the skip names both",
      async (noteTemplate: NoteTemplate) => {
        const trace: SimulationTrace = await runTemplate({
          templateId: noteTemplate.templateId,
          trigger: onRecord(kind.note()),
          jira: jiraRoutes({
            [SEARCH]: ok(CLONED_SEARCH),
            [COMMENT]: COMMENT_CREATED,
          }),
        });

        expect(trace.requests).toEqual([
          searchRequest(kind, ["key", "summary"]),
        ]);
        expect(trace.logs).toEqual([cloneSkippedLog(kind)]);
      },
    );
  },
);

describe.each(KINDS)(
  "simulated: comment on the Jira issue when the $noun is edited",
  (kind: SimulatedKind) => {
    const TEMPLATE: string = kind.templates.updateComment;

    test(`an internal comment lists the ${kind.noun}'s current title, severity, state, root cause and remediation`, async () => {
      // The comment quotes the root cause, so the trigger has to select it.
      expect(triggerSelectOf(TEMPLATE)["rootCause"]).toBe(true);

      const trace: SimulationTrace = await runTemplate({
        templateId: TEMPLATE,
        trigger: onRecord(
          kind.model({
            title: "Checkout latency high in eu-west-1",
            severity: kind.middleSeverity.name,
            state: kind.acknowledgedState,
            rootCause: "A bad deploy of the payments service.",
            remediationNotes: "Rolled back to v4.1.",
          }),
        ),
        jira: jiraRoutes({
          [SEARCH]: ok(jiraSearchResponse()),
          [COMMENT]: COMMENT_CREATED,
        }),
      });

      expect(trace.requests).toEqual([
        searchRequest(kind, ["key", "summary"]),
        {
          method: "POST",
          url: `${JIRA_SITE}/rest/api/3/issue/${JIRA_ISSUE_KEY}/comment`,
          headers: AUTHORIZATION,
          body: {
            body: adfOf(
              [
                `${JIRA_SYNCED_FROM_ONEUPTIME_MARKER}: ${kind.number} was updated.`,
                "Title: Checkout latency high in eu-west-1",
                `Severity: ${kind.middleSeverity.name}`,
                "State: Acknowledged",
                "Root cause: A bad deploy of the payments service.",
                "Remediation: Rolled back to v4.1.",
                `Description: ${kind.defaultDescription}`,
              ].join("\n"),
            ),
            // A root cause is for the team: internal in Jira Service Management.
            properties: [INTERNAL_COMMENT_PROPERTY],
          },
        },
      ]);
      expectValidAdf((trace.requests[1]!.body as JSONObject)["body"]);
      expect(trace.logs).toEqual([
        `✅ Posted the ${kind.noun}'s changes to Jira issue ${JIRA_ISSUE_KEY}.`,
      ]);
    });

    test(`a private ${kind.noun}'s changes are not posted`, async () => {
      expect(triggerSelectOf(TEMPLATE)["isPrivate"]).toBe(true);

      const trace: SimulationTrace = await runTemplate({
        templateId: TEMPLATE,
        trigger: onRecord(
          kind.model({
            rootCause: "A bad deploy of the payments service.",
            isPrivate: true,
          }),
        ),
        jira: jiraRoutes({
          [SEARCH]: ok(jiraSearchResponse()),
          [COMMENT]: COMMENT_CREATED,
        }),
      });

      expect(trace.requests).toEqual([searchRequest(kind, ["key", "summary"])]);
      expect(trace.logs).toEqual([
        `ℹ️ ${kind.number} is a private ${kind.noun}, so its changes were not posted to Jira.`,
      ]);
    });

    test(`two issues carrying the ${kind.noun}'s label (a clone) get no comment`, async () => {
      const trace: SimulationTrace = await runTemplate({
        templateId: TEMPLATE,
        trigger: onRecord(kind.model()),
        jira: jiraRoutes({
          [SEARCH]: ok(CLONED_SEARCH),
          [COMMENT]: COMMENT_CREATED,
        }),
      });

      expect(trace.requests).toEqual([searchRequest(kind, ["key", "summary"])]);
      expect(trace.logs).toEqual([cloneSkippedLog(kind)]);
    });

    /*
     * Which updates reach the graph at all. The dashboard's edit form sends a
     * changed severity under its relation's key, and Listen On compares keys
     * exactly, so the relation has to be listed beside the id column.
     */
    test("it runs for the edits the comment reports, the severity under either key, and never for a state change", () => {
      expect(triggerArgumentsOf(TEMPLATE)["listen-on"]).toEqual(
        kind.editListenOn,
      );

      for (const key of Object.keys(kind.editListenOn)) {
        expect(firesOnUpdate(TEMPLATE, { [key]: "changed" })).toBe(true);
      }

      expect(
        firesOnUpdate(TEMPLATE, {
          [kind.severityRelation]: { _id: kind.middleSeverity.id },
        }),
      ).toBe(true);
      expect(
        firesOnUpdate(TEMPLATE, {
          [kind.severityIdColumn]: kind.middleSeverity.id,
        }),
      ).toBe(true);

      // A state change is the transition template's, which listens for nothing else.
      const stateChange: JSONObject = {
        [kind.stateIdColumn]: kind.resolvedState["_id"] as string,
      };

      expect(firesOnUpdate(TEMPLATE, stateChange)).toBe(false);
      expect(firesOnUpdate(kind.templates.transition, stateChange)).toBe(true);
      expect(firesOnUpdate(kind.templates.transition, { title: "New" })).toBe(
        false,
      );
    });
  },
);

/* ------------------------------- Jira -> OneUptime ------------------------------- */

const expectedCreatedDescription: ExpectedTextFunction = (
  kind: SimulatedKind,
): string => {
  return [
    `${kind.Created} from Jira issue [${JIRA_ISSUE_KEY}](${JIRA_SITE}/browse/${JIRA_ISSUE_KEY}).`,
    "Priority: High",
    "Reported by: Priya Patel",
    "",
    "Customers in *eu-west-1* see 502s at checkout.\nStarted around 09:40 UTC.",
  ].join("\n");
};

describe.each(KINDS)(
  "simulated: $create an $noun when a Jira issue is created",
  (kind: SimulatedKind) => {
    const TEMPLATE: string = kind.templates.createFromIssue;

    type RunCreateFunction = (props: {
      event: JSONObject;
      database?: FakeDatabase | undefined;
      /** The issue's labels as Jira's GET returns them; none by default. */
      labels?: Array<string> | undefined;
      getIssue?: JiraReply | undefined;
      edit?: JiraReply | undefined;
    }) => Promise<SimulationTrace>;

    const runCreate: RunCreateFunction = async (props: {
      event: JSONObject;
      database?: FakeDatabase | undefined;
      labels?: Array<string> | undefined;
      getIssue?: JiraReply | undefined;
      edit?: JiraReply | undefined;
    }): Promise<SimulationTrace> => {
      return await runTemplate({
        templateId: TEMPLATE,
        trigger: webhookDelivery(props.event),
        jira: createFromIssueJira({
          labels: props.labels,
          getIssue: props.getIssue,
          edit: props.edit,
        }),
        database: props.database || createDatabase(kind),
      });
    };

    test(`${kind.create}s an ${kind.noun} at the severity the priority maps to, then labels the issue with its id`, async () => {
      const trace: SimulationTrace = await runCreate({
        event: jiraIssueCreatedEvent(),
      });

      expect(trace.executed).toEqual([
        "webhook-1",
        "find-severities-1",
        kind.steps.prepareRecord,
        kind.steps.ifCreate,
        "get-issue-1",
        "confirm-unlinked-1",
        "if-unlinked-1",
        kind.steps.createRecord,
        "link-issue-1",
        "log-linked",
      ]);

      expect(trace.databaseCalls).toEqual([
        {
          componentId: "find-severities-1",
          metadataId: kind.components.severityFindMany,
          args: {
            query: { _id: { _type: "NotNull", value: null } },
            select: { _id: true, name: true, order: true },
            limit: 50,
          },
        },
        {
          componentId: kind.steps.createRecord,
          metadataId: kind.components.createOne,
          args: {
            json: {
              // High is the most severe priority band, and severities are ordered 1 = most severe.
              [kind.severityIdColumn]: kind.mostSevere.id,
              customFields: { jiraIssueKey: JIRA_ISSUE_KEY },
              ...kind.quietCreateFields,
              title: "Checkout API returns 502 for EU customers",
              description: expectedCreatedDescription(kind),
            },
          },
        },
      ]);

      /*
       * Jira is asked for the issue's labels before anything is written, and
       * the label added afterwards carries the id the database just gave the
       * record — nothing else could.
       */
      expect(trace.requests).toEqual([
        GET_LABELS_REQUEST,
        linkLabelsRequest(kind),
      ]);
      expect(trace.logs).toEqual([
        `✅ ${kind.Created} an ${kind.noun} with severity ${kind.mostSevere.name} for Jira issue ${JIRA_ISSUE_KEY}, and labelled the issue to link them.`,
      ]);
    });

    test("a Low priority lands on the least severe severity", async () => {
      const trace: SimulationTrace = await runCreate({
        event: jiraIssueCreatedEvent({ priority: "Low" }),
      });

      expect(
        jsonOf(trace, kind.components.createOne)[kind.severityIdColumn],
      ).toBe(kind.leastSevere.id);
      expect(trace.logs[0]).toContain(`with severity ${kind.leastSevere.name}`);
    });

    test(`a Medium priority lands in the middle of the range: ${kind.middleSeverity.name}`, async () => {
      const trace: SimulationTrace = await runCreate({
        event: jiraIssueCreatedEvent({ priority: "Medium" }),
      });

      expect(
        jsonOf(trace, kind.components.createOne)[kind.severityIdColumn],
      ).toBe(kind.middleSeverity.id);
      expect(trace.logs[0]).toContain(
        `with severity ${kind.middleSeverity.name}`,
      );
    });

    test(`an issue whose payload shows it linked ${kind.create}s nothing, and Jira is not even asked`, async () => {
      const trace: SimulationTrace = await runCreate({
        event: jiraIssueCreatedEvent({ labels: linkedLabelsOf(kind) }),
      });

      expect(metadataIdsOf(trace)).toEqual([kind.components.severityFindMany]);
      expect(trace.requests).toEqual([]);
      expect(trace.logs).toEqual([alreadyLinkedLog(kind)]);
    });

    /*
     * The payload is only the sender's word. Anyone holding the workflow's
     * URL can post an issue_created that shows no labels, and a delivery Jira
     * retries still carries the labels the issue had before the first
     * delivery linked it. What Jira returns now is what decides.
     */
    test.each([
      [`linked to this ${kind.noun}`, linkedLabelsOf(kind)],
      [`claimed by another ${kind.noun}`, [kind.label(kind.otherId)]],
      ["carrying only the oneuptime label", [JIRA_LINK_LABEL]],
    ])(
      `a payload showing no labels, for an issue Jira says is %s, ${kind.create}s nothing`,
      async (_description: string, labels: Array<string>) => {
        const trace: SimulationTrace = await runCreate({
          event: jiraIssueCreatedEvent(),
          labels: labels,
        });

        expect(trace.executed).toEqual([
          "webhook-1",
          "find-severities-1",
          kind.steps.prepareRecord,
          kind.steps.ifCreate,
          "get-issue-1",
          "confirm-unlinked-1",
          "if-unlinked-1",
          "log-already-linked",
        ]);
        // No record is written, and the issue's labels are not touched.
        expect(metadataIdsOf(trace)).toEqual([
          kind.components.severityFindMany,
        ]);
        expect(trace.requests).toEqual([GET_LABELS_REQUEST]);
        expect(trace.logs).toEqual([alreadyLinkedLog(kind)]);
      },
    );

    test(`an issue Jira will not return (a forged key, or credentials that cannot see it) ${kind.create}s nothing`, async () => {
      const notFound: JSONObject = {
        errorMessages: [
          "Issue does not exist or you do not have permission to see it.",
        ],
        errors: {},
      };

      const trace: SimulationTrace = await runCreate({
        event: jiraIssueCreatedEvent(),
        getIssue: { status: 404, body: notFound },
      });

      expect(trace.executed).toEqual([
        "webhook-1",
        "find-severities-1",
        kind.steps.prepareRecord,
        kind.steps.ifCreate,
        "get-issue-1",
        "log-get-issue-failed",
      ]);
      expect(metadataIdsOf(trace)).toEqual([kind.components.severityFindMany]);
      expect(trace.requests).toEqual([GET_LABELS_REQUEST]);
      expect(trace.logs).toEqual([
        `❌ Could not read Jira issue ${JIRA_ISSUE_KEY}, so no ${kind.noun} was ${kind.created}: Server Error.\nJira said: ${JSON.stringify(notFound, null, 2)}`,
      ]);
    });

    test(`a success that is not the issue (a proxy's page) ${kind.create}s nothing`, async () => {
      const trace: SimulationTrace = await runCreate({
        event: jiraIssueCreatedEvent(),
        getIssue: { status: 200, body: "<html><body>Sign in</body></html>" },
      });

      expect(trace.ports["get-issue-1"]).toBe("success");
      expect(trace.ports["if-unlinked-1"]).toBe("no");
      expect(metadataIdsOf(trace)).toEqual([kind.components.severityFindMany]);
      expect(trace.requests).toEqual([GET_LABELS_REQUEST]);
      expect(trace.logs).toEqual([
        `ℹ️ Jira did not return the issue, so no ${kind.noun} was ${kind.created}.`,
      ]);
    });

    test(`an issue_updated delivery to this webhook ${kind.create}s nothing`, async () => {
      const trace: SimulationTrace = await runCreate({
        event: jiraIssueUpdatedEvent({ items: STARTED_CHANGELOG }),
      });

      expect(metadataIdsOf(trace)).toEqual([kind.components.severityFindMany]);
      expect(trace.requests).toEqual([]);
      expect(trace.logs).toEqual([
        "ℹ️ Ignored a jira:issue_updated event: this workflow only handles jira:issue_created.",
      ]);
    });

    test("a failed create is logged, and the issue is not labelled with an id that does not exist", async () => {
      const trace: SimulationTrace = await runCreate({
        event: jiraIssueCreatedEvent(),
        database: {
          ...createDatabase(kind),
          [kind.components.createOne]: DATABASE_FAILURE,
        },
      });

      // Only the read that came before the create; no label edit follows it.
      expect(trace.requests).toEqual([GET_LABELS_REQUEST]);
      expect(trace.logs).toEqual([
        `❌ Could not ${kind.create} the ${kind.noun} for Jira issue ${JIRA_ISSUE_KEY}. The database error is in the run log above.`,
      ]);
    });

    test(`Jira refusing the labels ends on the warning, since the ${kind.noun} does exist`, async () => {
      const rejection: JSONObject = {
        errorMessages: [],
        errors: {
          labels:
            "Field 'labels' cannot be set. It is not on the appropriate screen, or unknown.",
        },
      };

      const trace: SimulationTrace = await runCreate({
        event: jiraIssueCreatedEvent(),
        edit: badRequest(rejection),
      });

      expect(trace.requests).toEqual([
        GET_LABELS_REQUEST,
        linkLabelsRequest(kind),
      ]);
      expect(trace.logs).toEqual([
        `⚠️ The ${kind.noun} was ${kind.created}, but Jira did not accept the link labels, so the other Jira templates cannot find it: Server Error.\nJira said: ${JSON.stringify(rejection, null, 2)}`,
      ]);
    });
  },
);

describe.each(KINDS)(
  "simulated: acknowledge or resolve the $noun when its Jira issue moves",
  (kind: SimulatedKind) => {
    const TEMPLATE: string = kind.templates.statusToState;

    type RunStatusFunction = (props: {
      event: JSONObject;
      record: JSONObject | null;
    }) => Promise<SimulationTrace>;

    const runStatus: RunStatusFunction = async (props: {
      event: JSONObject;
      record: JSONObject | null;
    }): Promise<SimulationTrace> => {
      return await runTemplate({
        templateId: TEMPLATE,
        trigger: webhookDelivery(props.event),
        database: statusDatabase(kind, props.record),
      });
    };

    const RESOLVED_EVENT: JSONObject = jiraIssueUpdatedEvent({
      items: RESOLVED_CHANGELOG,
      labels: linkedLabelsOf(kind),
      status: DONE,
    });

    test(`Done resolves an acknowledged ${kind.noun} with a new timeline row`, async () => {
      const trace: SimulationTrace = await runStatus({
        event: RESOLVED_EVENT,
        record: recordOf(kind, kind.acknowledgedState),
      });

      expect(trace.executed).toEqual([
        "webhook-1",
        "read-event-1",
        "if-status-changed-1",
        kind.steps.find,
        "find-states-1",
        "decide-state-1",
        "if-change-1",
        "change-state-1",
        "log-changed",
      ]);

      expect(callOf(trace, kind.components.findOne).args).toEqual({
        query: { _id: kind.id },
        select: {
          _id: true,
          [kind.numberField]: true,
          [kind.stateRelation]: { _id: true, name: true, order: true },
        },
      });

      // A timeline row, never an edit to the record: the timeline is what notifies and refuses to go backwards.
      expect(metadataIdsOf(trace)).toEqual([
        kind.components.findOne,
        kind.components.stateFindMany,
        kind.components.timelineCreateOne,
      ]);
      expect(jsonOf(trace, kind.components.timelineCreateOne)).toEqual({
        [kind.idColumn]: kind.id,
        [kind.timelineStateColumn]: kind.resolvedState["_id"] as string,
        rootCause: `${ONEUPTIME_SYNCED_FROM_JIRA_MARKER}: issue ${JIRA_ISSUE_KEY} moved to Done by Priya Patel.`,
      });
      expect(trace.requests).toEqual([]);
      expect(trace.logs).toEqual([
        `✅ Moved ${kind.number} to Resolved because Jira issue ${JIRA_ISSUE_KEY} is now Done.`,
      ]);
    });

    test(`In Progress acknowledges a new ${kind.noun}`, async () => {
      const trace: SimulationTrace = await runStatus({
        event: jiraIssueUpdatedEvent({
          items: STARTED_CHANGELOG,
          labels: linkedLabelsOf(kind),
          status: IN_PROGRESS,
        }),
        record: recordOf(kind, kind.createdState),
      });

      expect(
        jsonOf(trace, kind.components.timelineCreateOne)[
          kind.timelineStateColumn
        ],
      ).toBe(kind.acknowledgedState["_id"]);
      expect(trace.logs).toEqual([
        `✅ Moved ${kind.number} to Acknowledged because Jira issue ${JIRA_ISSUE_KEY} is now In Progress.`,
      ]);
    });

    test(`an ${kind.noun} that is already resolved is not moved again`, async () => {
      const trace: SimulationTrace = await runStatus({
        event: RESOLVED_EVENT,
        record: recordOf(kind, kind.resolvedState),
      });

      expect(metadataIdsOf(trace)).toEqual([
        kind.components.findOne,
        kind.components.stateFindMany,
      ]);
      expect(trace.logs).toEqual([
        `ℹ️ ${kind.number} is already Resolved, so Jira issue ${JIRA_ISSUE_KEY} moving to Done changes nothing.`,
      ]);
    });

    test(`moving the issue back to To Do never moves the ${kind.noun} backwards`, async () => {
      const trace: SimulationTrace = await runStatus({
        event: jiraIssueUpdatedEvent({
          items: [
            changelogItem({
              field: "status",
              from: "3",
              fromString: "In Progress",
              to: "10001",
              toString: "To Do",
            }),
          ],
          labels: linkedLabelsOf(kind),
          status: TO_DO,
        }),
        record: recordOf(kind, kind.acknowledgedState),
      });

      expect(metadataIdsOf(trace)).not.toContain(
        kind.components.timelineCreateOne,
      );
      expect(trace.logs).toEqual([
        `ℹ️ Jira issue ${JIRA_ISSUE_KEY} moved to To Do, which does not map to a OneUptime state.`,
      ]);
    });

    test(`an issue with no ${kind.noun} label touches nothing in the database`, async () => {
      const trace: SimulationTrace = await runStatus({
        event: jiraIssueUpdatedEvent({
          items: RESOLVED_CHANGELOG,
          status: DONE,
        }),
        record: recordOf(kind, kind.acknowledgedState),
      });

      expect(trace.databaseCalls).toEqual([]);
      expect(trace.logs).toEqual([notLinkedLog(kind)]);
    });

    test(`a label naming an ${kind.noun} this project does not have changes nothing`, async () => {
      const trace: SimulationTrace = await runStatus({
        event: RESOLVED_EVENT,
        record: null,
      });

      expect(metadataIdsOf(trace)).toEqual([
        kind.components.findOne,
        kind.components.stateFindMany,
      ]);
      expect(trace.logs).toEqual([
        `ℹ️ No ${kind.noun} with id ${kind.id} exists in this project.`,
      ]);
    });
  },
);

const EXPECTED_COMMENT_NOTE: string = `${ONEUPTIME_SYNCED_FROM_JIRA_MARKER}: Marco Rossi commented on [${JIRA_ISSUE_KEY}](${JIRA_SITE}/browse/${JIRA_ISSUE_KEY}).\n\nRolled back the *eu-west-1* deploy. Watching the error rate.`;

describe.each(KINDS)(
  "simulated: add Jira comments to the $noun as private notes",
  (kind: SimulatedKind) => {
    test(`reads the link off the issue, checks the ${kind.noun} is here, and writes the note`, async () => {
      const trace: SimulationTrace = await runComment(kind, {
        event: jiraCommentEvent(),
      });

      expect(trace.executed).toEqual([
        "webhook-1",
        "read-comment-1",
        "if-comment-1",
        "get-issue-1",
        "find-link-1",
        "if-linked-1",
        kind.steps.find,
        "if-found-1",
        "create-note-1",
        "log-noted",
      ]);

      // Comment webhooks carry no labels, so the issue is fetched for them.
      expect(trace.requests).toEqual([GET_LABELS_REQUEST]);

      expect(trace.databaseCalls).toEqual([
        {
          componentId: kind.steps.find,
          metadataId: kind.components.findOne,
          args: {
            query: { _id: kind.id },
            select: { _id: true, [kind.numberField]: true },
          },
        },
        {
          componentId: "create-note-1",
          metadataId: kind.components.noteCreateOne,
          args: {
            json: { [kind.idColumn]: kind.id, note: EXPECTED_COMMENT_NOTE },
          },
        },
      ]);
      expect(trace.logs).toEqual([
        `✅ Added the Jira comment on ${JIRA_ISSUE_KEY} to ${kind.number} as a private note.`,
      ]);
    });

    test("a comment OneUptime posted is not copied back, and Jira is not even asked about it", async () => {
      const trace: SimulationTrace = await runComment(kind, {
        event: jiraCommentEvent({
          body: `${JIRA_SYNCED_FROM_ONEUPTIME_MARKER}: private note on ${kind.number} by Jane Doe.\n\nFailed over.`,
          author: AUTOMATION_USER,
        }),
      });

      expect(trace.requests).toEqual([]);
      expect(trace.databaseCalls).toEqual([]);
      expect(trace.logs).toEqual([COMMENT_FROM_ONEUPTIME_LOG]);
    });

    test("an issue without the labels is only looked at", async () => {
      const trace: SimulationTrace = await runComment(kind, {
        event: jiraCommentEvent(),
        labels: [],
      });

      expect(trace.requests).toEqual([GET_LABELS_REQUEST]);
      expect(trace.databaseCalls).toEqual([]);
      expect(trace.logs).toEqual([notLinkedLog(kind)]);
    });

    test(`a label naming an ${kind.noun} in another project writes no note`, async () => {
      const trace: SimulationTrace = await runComment(kind, {
        event: jiraCommentEvent(),
        labels: [JIRA_LINK_LABEL, kind.label(kind.otherId)],
        record: null,
      });

      expect(callOf(trace, kind.components.findOne).args["query"]).toEqual({
        _id: kind.otherId,
      });
      expect(trace.ports["if-found-1"]).toBe("no");
      expect(metadataIdsOf(trace)).toEqual([kind.components.findOne]);
      expect(trace.logs).toEqual([
        `ℹ️ Jira issue ${JIRA_ISSUE_KEY} names ${kind.noun} ${kind.otherId}, which is not in this project.`,
      ]);
    });
  },
);

/** A priority change on an issue carrying the given labels. */
type PriorityChangeFunction = (labels: Array<string>) => JSONObject;

const priorityChange: PriorityChangeFunction = (
  labels: Array<string>,
): JSONObject => {
  return jiraIssueUpdatedEvent({
    labels: labels,
    items: [
      changelogItem({
        field: "priority",
        from: "3",
        fromString: "Medium",
        to: "1",
        toString: "Highest",
      }),
    ],
  });
};

describe.each(KINDS)(
  "simulated: add Jira issue changes to the $noun as private notes",
  (kind: SimulatedKind) => {
    test(`a priority change is noted on the linked ${kind.noun}`, async () => {
      const trace: SimulationTrace = await runIssueChanges(kind, {
        event: priorityChange(linkedLabelsOf(kind)),
      });

      expect(trace.executed).toEqual([
        "webhook-1",
        "read-changes-1",
        "if-changed-1",
        kind.steps.find,
        "if-found-1",
        "create-note-1",
        "log-noted",
      ]);
      expect(callOf(trace, kind.components.findOne).args).toEqual({
        query: { _id: kind.id },
        select: { _id: true, [kind.numberField]: true },
      });
      expect(jsonOf(trace, kind.components.noteCreateOne)).toEqual({
        [kind.idColumn]: kind.id,
        note: `${ONEUPTIME_SYNCED_FROM_JIRA_MARKER}: Priya Patel updated [${JIRA_ISSUE_KEY}](${JIRA_SITE}/browse/${JIRA_ISSUE_KEY}).\n\n- priority: Medium → Highest`,
      });
      expect(trace.requests).toEqual([]);
      expect(trace.logs).toEqual([
        `✅ Noted the changes to Jira issue ${JIRA_ISSUE_KEY} on ${kind.number}.`,
      ]);
    });

    test("adding only the link labels is not worth a note", async () => {
      const trace: SimulationTrace = await runIssueChanges(kind, {
        event: jiraIssueUpdatedEvent({
          labels: linkedLabelsOf(kind),
          items: [
            changelogItem({
              field: "labels",
              fromString: "",
              toString: linkedLabelsOf(kind).join(" "),
            }),
          ],
        }),
      });

      expect(trace.databaseCalls).toEqual([]);
      expect(trace.logs).toEqual([NOTHING_WORTH_A_NOTE_LOG]);
    });

    test("a status change is left to the status template", async () => {
      const trace: SimulationTrace = await runIssueChanges(kind, {
        event: jiraIssueUpdatedEvent({
          labels: linkedLabelsOf(kind),
          items: RESOLVED_CHANGELOG,
          status: DONE,
        }),
      });

      expect(trace.databaseCalls).toEqual([]);
      expect(trace.logs).toEqual([NOTHING_WORTH_A_NOTE_LOG]);
    });

    // Dragging an issue on a board changes Rank, which Jira reports under its custom field id.
    test("a Rank change, sent as customfield_10019, is not worth a note", async () => {
      const trace: SimulationTrace = await runIssueChanges(kind, {
        event: jiraIssueUpdatedEvent({
          labels: linkedLabelsOf(kind),
          items: [
            changelogItem({
              field: "Rank",
              fieldId: "customfield_10019",
              fromString: "",
              toString: "Ranked higher",
            }),
          ],
        }),
      });

      expect(trace.databaseCalls).toEqual([]);
      expect(trace.logs).toEqual([NOTHING_WORTH_A_NOTE_LOG]);
    });

    test(`a label naming an ${kind.noun} in another project writes no note`, async () => {
      const trace: SimulationTrace = await runIssueChanges(kind, {
        event: priorityChange([JIRA_LINK_LABEL, kind.label(kind.otherId)]),
        record: null,
      });

      expect(callOf(trace, kind.components.findOne).args["query"]).toEqual({
        _id: kind.otherId,
      });
      expect(metadataIdsOf(trace)).toEqual([kind.components.findOne]);
      expect(trace.logs).toEqual([
        `ℹ️ Jira issue ${JIRA_ISSUE_KEY} names ${kind.noun} ${kind.otherId}, which is not in this project.`,
      ]);
    });
  },
);

/* ------------------------------- What differs for alerts ------------------------------- */

/*
 * The alert templates are the incident ones with the nouns swapped, except
 * where an alert is a different thing. Each difference is checked here with
 * the values written out, so it cannot pass by both sides of the kind table
 * being wrong the same way.
 */
describe("simulated: what differs for alerts", () => {
  test("alerts have no public notes, so there is no template to post one", () => {
    expect(
      getWorkflowTemplate("jira-comment-from-alert-public-note"),
    ).toBeNull();
    expect(
      buildGraphForTemplate("jira-comment-from-alert-public-note", generateId),
    ).toBeNull();
    expect(
      ALERT.noteTemplates.map((noteTemplate: NoteTemplate) => {
        return noteTemplate.templateId;
      }),
    ).toEqual(["jira-comment-from-alert-private-note"]);
  });

  test("an alert's issue is labelled oneuptime-alert-<id> and links to the alert's page under /alerts/", async () => {
    const trace: SimulationTrace = await runCreateIssue(ALERT);
    const fields: JSONObject = issueFieldsOf(trace);

    expect(fields["labels"]).toEqual([
      "oneuptime",
      `oneuptime-alert-${ALERT_ID}`,
    ]);
    expect(JSON.stringify(fields["description"])).toContain(
      `"href":"https://oneuptime.com/dashboard/${PROJECT_ID}/alerts/${ALERT_ID}"`,
    );
    expect(JSON.stringify(fields)).not.toContain("incident");
  });

  test("the alert templates search Jira for oneuptime-alert-<id>, never for an incident label", async () => {
    const jira: FakeJiraFunction = jiraRoutes({
      [SEARCH]: ok(jiraSearchResponse()),
      [TRANSITION]: NO_CONTENT,
      [COMMENT]: COMMENT_CREATED,
    });

    const traces: Array<SimulationTrace> = [
      await runTemplate({
        templateId: "jira-transition-issue-on-alert-state",
        trigger: onRecord(alertModel({ state: ALERT_RESOLVED_STATE })),
        jira: jira,
      }),
      await runTemplate({
        templateId: "jira-comment-from-alert-private-note",
        trigger: onRecord(alertNoteModel()),
        jira: jira,
      }),
      await runTemplate({
        templateId: "jira-comment-on-alert-update",
        trigger: onRecord(alertModel()),
        jira: jira,
      }),
    ];

    for (const trace of traces) {
      expect(
        ((trace.requests[0]!.body as JSONObject)["jql"] as string).startsWith(
          `labels = "oneuptime-alert-${ALERT_ID}"`,
        ),
      ).toBe(true);
      expect(trace.requests).toHaveLength(2);
    }
  });

  test("an alert created from Jira is written with no status-page fields, which an incident is kept off with", async () => {
    const alert: SimulationTrace = await runCreateFromIssue(ALERT);
    const incident: SimulationTrace = await runCreateFromIssue(INCIDENT);

    expect(Object.keys(jsonOf(alert, "alert-create-one")).sort()).toEqual([
      "alertSeverityId",
      "customFields",
      "description",
      "title",
    ]);
    expect(jsonOf(alert, "alert-create-one")["description"]).toContain(
      "Created from Jira issue",
    );
    expect(jsonOf(incident, "incident-create-one")).toMatchObject({
      isVisibleOnStatusPage: false,
      shouldStatusPageSubscribersBeNotifiedOnIncidentCreated: false,
    });
    expect(alert.logs).toEqual([
      `✅ Created an alert with severity High for Jira issue ${JIRA_ISSUE_KEY}, and labelled the issue to link them.`,
    ]);
    expect(alert.requests[1]).toEqual({
      method: "PUT",
      url: `${JIRA_SITE}/rest/api/3/issue/${JIRA_ISSUE_KEY}`,
      headers: AUTHORIZATION,
      body: {
        update: {
          labels: [
            { add: "oneuptime" },
            { add: `oneuptime-alert-${NEW_ALERT_ID}` },
          ],
        },
      },
    });
  });

  /*
   * A project starts with two alert severities, High and Low, against three
   * incident ones. The priority bands are spread over whatever is there, so
   * the middle band rounds down to Low rather than landing on a severity
   * that does not exist.
   */
  test.each([
    ["Highest", HIGH_ALERT_SEVERITY_ID, "High"],
    ["High", HIGH_ALERT_SEVERITY_ID, "High"],
    ["Medium", LOW_ALERT_SEVERITY_ID, "Low"],
    ["Low", LOW_ALERT_SEVERITY_ID, "Low"],
    ["Lowest", LOW_ALERT_SEVERITY_ID, "Low"],
  ])(
    "with the two default alert severities, a %s priority creates a %s-severity alert",
    async (priority: string, severityId: string, severityName: string) => {
      const trace: SimulationTrace = await runCreateFromIssue(ALERT, {
        event: jiraIssueCreatedEvent({ priority: priority }),
      });

      expect(jsonOf(trace, "alert-create-one")["alertSeverityId"]).toBe(
        severityId,
      );
      expect(trace.logs[0]).toContain(`with severity ${severityName} `);
    },
  );

  /*
   * An alert's root cause is written when the alert is created and cannot be
   * edited afterwards, so the edit-comment template does not listen for it —
   * but the comment it posts for any other edit still shows it.
   */
  test("an alert's root cause is not listened on, and the comment still shows it", async () => {
    const TEMPLATE: string = "jira-comment-on-alert-update";

    expect(firesOnUpdate(TEMPLATE, { rootCause: "Changed" })).toBe(false);
    expect(
      firesOnUpdate("jira-comment-on-incident-update", {
        rootCause: "Changed",
      }),
    ).toBe(true);

    // The dashboard's edit form sends the relation, which is heard.
    expect(
      firesOnUpdate(TEMPLATE, {
        alertSeverity: { _id: LOW_ALERT_SEVERITY_ID },
      }),
    ).toBe(true);

    const trace: SimulationTrace = await runTemplate({
      templateId: TEMPLATE,
      trigger: onRecord(
        alertModel({
          severity: "Low",
          rootCause: "The WAL archiver stopped.",
        }),
      ),
      jira: jiraRoutes({
        [SEARCH]: ok(jiraSearchResponse()),
        [COMMENT]: COMMENT_CREATED,
      }),
    });

    expect(wikiTextOf(postedCommentOf(trace))).toContain(
      "Severity: Low\nState: Identified\nRoot cause: The WAL archiver stopped.",
    );
  });
});

/* ------------------------------- Echo loops ------------------------------- */

/*
 * Every write in one direction is an event in the other. Each test here takes
 * what one template ACTUALLY sent — the request body or database payload from
 * its trace, not a hand-written stand-in — replays it as the event the other
 * side would raise, and checks the loop stops there. A template whose output
 * drifted away from what the other side recognises would fail here even while
 * every single-template test still passed.
 */
describe.each(KINDS)(
  "simulated: the $noun templates do not echo each other",
  (kind: SimulatedKind) => {
    test(`(a) the issue OneUptime files comes back as issue_created, and ${kind.create}s no second ${kind.noun}`, async () => {
      const created: SimulationTrace = await runCreateIssue(kind);
      const fields: JSONObject = issueFieldsOf(created);

      const echo: SimulationTrace = await runTemplate({
        templateId: kind.templates.createFromIssue,
        trigger: webhookDelivery(
          jiraIssueCreatedEvent({
            summary: fields["summary"] as string,
            labels: fields["labels"] as Array<string>,
            description: wikiTextOf(fields["description"]),
            reporter: AUTOMATION_USER,
            user: AUTOMATION_USER,
          }),
        ),
        jira: createFromIssueJira({
          labels: fields["labels"] as Array<string>,
        }),
        database: createDatabase(kind),
      });

      // The payload's own labels stop it, before Jira is asked anything.
      expect(echo.ports[kind.steps.ifCreate]).toBe("no");
      expect(metadataIdsOf(echo)).not.toContain(kind.components.createOne);
      expect(echo.requests).toEqual([]);
      expect(echo.logs).toEqual([alreadyLinkedLog(kind)]);
    });

    /*
     * The same echo when the payload does not show the labels — a delivery
     * built before they were set, or one somebody forged. The labels OneUptime
     * filed the issue with are still what Jira returns, and they stop it.
     */
    test("(a') the same issue_created without its labels in the payload is stopped by the labels Jira returns", async () => {
      const created: SimulationTrace = await runCreateIssue(kind);
      const fields: JSONObject = issueFieldsOf(created);

      const echo: SimulationTrace = await runTemplate({
        templateId: kind.templates.createFromIssue,
        trigger: webhookDelivery(
          jiraIssueCreatedEvent({
            summary: fields["summary"] as string,
            labels: [],
            description: wikiTextOf(fields["description"]),
            reporter: AUTOMATION_USER,
            user: AUTOMATION_USER,
          }),
        ),
        jira: createFromIssueJira({
          labels: fields["labels"] as Array<string>,
        }),
        database: createDatabase(kind),
      });

      expect(echo.ports[kind.steps.ifCreate]).toBe("yes");
      expect(echo.ports["if-unlinked-1"]).toBe("no");
      expect(metadataIdsOf(echo)).toEqual([kind.components.severityFindMany]);
      expect(echo.requests).toEqual([GET_LABELS_REQUEST]);
      expect(echo.logs).toEqual([alreadyLinkedLog(kind)]);
    });

    test(`(b) the ${kind.noun} ${kind.created} from Jira comes back through ${kind.noun}-on-create, and files no second issue`, async () => {
      const createdFromJira: SimulationTrace = await runCreateFromIssue(kind);
      const json: JSONObject = jsonOf(
        createdFromJira,
        kind.components.createOne,
      );

      const echo: SimulationTrace = await runTemplate({
        templateId: kind.templates.createIssue,
        trigger: onRecord(
          kind.model({
            _id: kind.newId,
            title: json["title"] as string,
            description: json["description"] as string,
            customFields: json["customFields"] as JSONObject,
          }),
        ),
        jira: jiraRoutes({ [CREATE_ISSUE]: ISSUE_CREATED }),
      });

      expect(echo.requests).toEqual([]);
      expect(echo.logs).toEqual([
        `ℹ️ ${kind.number} was ${kind.created} from Jira issue ${JIRA_ISSUE_KEY}, so no new issue was created.`,
      ]);
    });

    test.each(kind.noteTemplates)(
      "(c) $templateId: the comment it posts comes back as comment_created, and writes no note",
      async (noteTemplate: NoteTemplate) => {
        const posted: SimulationTrace = await runNoteToComment(
          noteTemplate.templateId,
          kind.note(),
        );
        const comment: JSONObject = postedCommentOf(posted);

        // As the webhook really carries it (wiki markup), and as ADF, in case a site sends that.
        for (const body of [wikiTextOf(comment), comment]) {
          const echo: SimulationTrace = await runComment(kind, {
            event: jiraCommentEvent({ body: body, author: AUTOMATION_USER }),
          });

          expect(echo.requests).toEqual([]);
          expect(echo.databaseCalls).toEqual([]);
          expect(echo.logs).toEqual([COMMENT_FROM_ONEUPTIME_LOG]);
        }
      },
    );

    test("(d) the note a Jira comment becomes fires the private note trigger, and posts no comment back", async () => {
      const noted: SimulationTrace = await runComment(kind, {
        event: jiraCommentEvent(),
      });
      const note: JSONObject = jsonOf(noted, kind.components.noteCreateOne);

      const echo: SimulationTrace = await runNoteToComment(
        kind.templates.privateNote,
        kind.note({ note: note["note"] as string, authorName: null }),
      );

      expect(echo.requests).toEqual([searchRequest(kind, ["key", "summary"])]);
      expect(echo.logs).toEqual([NOTE_FROM_JIRA_LOG]);
    });

    test("(e) the note an issue change becomes posts no comment back", async () => {
      const noted: SimulationTrace = await runIssueChanges(kind, {
        event: jiraIssueUpdatedEvent({
          labels: linkedLabelsOf(kind),
          items: [
            changelogItem({
              field: "assignee",
              fromString: null,
              toString: "Marco Rossi",
            }),
          ],
        }),
      });
      const note: JSONObject = jsonOf(noted, kind.components.noteCreateOne);

      const echo: SimulationTrace = await runNoteToComment(
        kind.templates.privateNote,
        kind.note({ note: note["note"] as string, authorName: null }),
      );

      expect(echo.requests).toEqual([searchRequest(kind, ["key", "summary"])]);
      expect(echo.logs).toEqual([NOTE_FROM_JIRA_LOG]);
    });

    test(`(f) the comment an ${kind.noun} edit posts comes back as comment_created, and writes no note`, async () => {
      const posted: SimulationTrace = await runTemplate({
        templateId: kind.templates.updateComment,
        trigger: onRecord(
          kind.model({ rootCause: "A bad deploy of the payments service." }),
        ),
        jira: jiraRoutes({
          [SEARCH]: ok(jiraSearchResponse()),
          [COMMENT]: COMMENT_CREATED,
        }),
      });

      const echo: SimulationTrace = await runComment(kind, {
        event: jiraCommentEvent({
          body: wikiTextOf(postedCommentOf(posted)),
          author: AUTOMATION_USER,
        }),
      });

      expect(echo.requests).toEqual([]);
      expect(echo.databaseCalls).toEqual([]);
      expect(echo.logs).toEqual([COMMENT_FROM_ONEUPTIME_LOG]);
    });

    test("(g) resolving in OneUptime moves the issue to Done, and the issue_updated that follows changes nothing", async () => {
      const transitioned: SimulationTrace = await runTemplate({
        templateId: kind.templates.transition,
        trigger: onRecord(kind.model({ state: kind.resolvedState })),
        jira: jiraRoutes({
          [SEARCH]: ok(jiraSearchResponse()),
          [TRANSITION]: NO_CONTENT,
        }),
      });

      // Where the transition it chose leads is the issue's new status.
      const transitionId: string = (
        (transitioned.requests[1]!.body as JSONObject)[
          "transition"
        ] as JSONObject
      )["id"] as string;
      const taken: JSONObject | undefined = (
        firstIssueOf(jiraSearchResponse())["transitions"] as Array<JSONObject>
      ).find((transition: JSONObject) => {
        return transition["id"] === transitionId;
      });

      expect(taken).toBeDefined();
      expect(taken!["to"]).toEqual(DONE);

      const event: JSONObject = jiraIssueUpdatedEvent({
        items: RESOLVED_CHANGELOG,
        labels: linkedLabelsOf(kind),
        status: taken!["to"] as JSONObject,
        user: AUTOMATION_USER,
      });

      const status: SimulationTrace = await runTemplate({
        templateId: kind.templates.statusToState,
        trigger: webhookDelivery(event),
        database: statusDatabase(kind, recordOf(kind, kind.resolvedState)),
      });

      expect(metadataIdsOf(status)).not.toContain(
        kind.components.timelineCreateOne,
      );
      expect(status.logs).toEqual([
        `ℹ️ ${kind.number} is already Resolved, so Jira issue ${JIRA_ISSUE_KEY} moving to Done changes nothing.`,
      ]);

      // The same delivery reaches the issue-changes template, which leaves status to the one above.
      const changes: SimulationTrace = await runIssueChanges(kind, {
        event: event,
      });

      expect(changes.databaseCalls).toEqual([]);
    });

    test(`(h) resolving from Jira fires ${kind.noun}-on-update, which finds the issue already Done and moves nothing`, async () => {
      const resolved: SimulationTrace = await runTemplate({
        templateId: kind.templates.statusToState,
        trigger: webhookDelivery(
          jiraIssueUpdatedEvent({
            items: RESOLVED_CHANGELOG,
            labels: linkedLabelsOf(kind),
            status: DONE,
          }),
        ),
        database: statusDatabase(kind, recordOf(kind, kind.acknowledgedState)),
      });

      const row: JSONObject = jsonOf(
        resolved,
        kind.components.timelineCreateOne,
      );
      const newState: JSONObject | undefined = kind.states.find(
        (state: JSONObject) => {
          return state["_id"] === row[kind.timelineStateColumn];
        },
      );

      expect(newState).toBeDefined();

      const echo: SimulationTrace = await runTemplate({
        templateId: kind.templates.transition,
        trigger: onRecord(
          kind.model({
            _id: row[kind.idColumn] as string,
            state: newState as JSONObject,
          }),
        ),
        jira: jiraRoutes({
          [SEARCH]: ok(
            jiraSearchResponse({
              status: DONE,
              transitions: [
                jiraTransition({ id: "11", name: "Reopen", to: TO_DO }),
              ],
            }),
          ),
          [TRANSITION]: NO_CONTENT,
        }),
      });

      expect(echo.requests).toEqual([
        searchRequest(kind, ["key", "status"], true),
      ]);
      expect(echo.logs).toEqual([
        `ℹ️ Jira issue ${JIRA_ISSUE_KEY} is already Done.`,
      ]);
    });

    test(`(i) the link labels the create-from-Jira template adds come back as issue_updated, and write nothing`, async () => {
      const createdFromJira: SimulationTrace = await runCreateFromIssue(kind);
      const added: Array<string> = addedLabelsOf(createdFromJira);

      const event: JSONObject = jiraIssueUpdatedEvent({
        labels: added,
        items: [
          changelogItem({
            field: "labels",
            fromString: "",
            toString: added.join(" "),
          }),
        ],
        user: AUTOMATION_USER,
      });

      const changes: SimulationTrace = await runIssueChanges(kind, {
        event: event,
      });

      expect(changes.databaseCalls).toEqual([]);
      expect(changes.logs).toEqual([NOTHING_WORTH_A_NOTE_LOG]);

      const status: SimulationTrace = await runTemplate({
        templateId: kind.templates.statusToState,
        trigger: webhookDelivery(event),
        database: statusDatabase(kind, recordOf(kind, kind.acknowledgedState)),
      });

      expect(status.databaseCalls).toEqual([]);
      expect(status.logs).toEqual([
        `ℹ️ Jira issue ${JIRA_ISSUE_KEY} changed, but its status did not.`,
      ]);
    });

    /*
     * Jira retries a delivery it thinks failed, so the same issue_created can
     * arrive after the first delivery already created a record and labelled
     * the issue. The payload is unchanged — it still shows no labels — and
     * only Jira's answer can tell the two deliveries apart.
     */
    test(`(j) a retried issue_created ${kind.create}s no second ${kind.noun}, because the first delivery's labels are now in Jira`, async () => {
      const first: SimulationTrace = await runCreateFromIssue(kind);

      expect(metadataIdsOf(first)).toContain(kind.components.createOne);

      const retry: SimulationTrace = await runCreateFromIssue(kind, {
        labels: addedLabelsOf(first),
      });

      expect(metadataIdsOf(retry)).toEqual([kind.components.severityFindMany]);
      expect(retry.requests).toEqual([GET_LABELS_REQUEST]);
      expect(retry.logs).toEqual([alreadyLinkedLog(kind)]);
    });
  },
);

/* ------------------------------- Across kinds ------------------------------- */

interface KindPair {
  /** The kind of record the issue is linked to. */
  linked: SimulatedKind;
  /** The kind whose templates must leave the issue alone. */
  other: SimulatedKind;
}

const KIND_PAIRS: Array<KindPair> = [
  { linked: INCIDENT, other: ALERT },
  { linked: ALERT, other: INCIDENT },
];

/*
 * A project can enable the incident and the alert templates side by side,
 * and then every Jira webhook reaches both sets. An issue linked to one kind
 * of record must never become, change, or collect notes on a record of the
 * other kind. Each test sends the same event to both kinds' templates, and the
 * linked kind acting on it is what shows the event was a real one.
 */
describe.each(KIND_PAIRS)(
  "simulated: an issue linked to an $linked.noun is left alone by the $other.noun templates",
  (pair: KindPair) => {
    const linked: SimulatedKind = pair.linked;
    const other: SimulatedKind = pair.other;

    test(`the issue the ${linked.noun} template files comes back as issue_created, and the ${other.noun} template ${other.create}s nothing`, async () => {
      const created: SimulationTrace = await runCreateIssue(linked);
      const fields: JSONObject = issueFieldsOf(created);

      expect(fields["labels"]).toEqual(linkedLabelsOf(linked));

      const echo: SimulationTrace = await runTemplate({
        templateId: other.templates.createFromIssue,
        trigger: webhookDelivery(
          jiraIssueCreatedEvent({
            summary: fields["summary"] as string,
            labels: fields["labels"] as Array<string>,
            description: wikiTextOf(fields["description"]),
            reporter: AUTOMATION_USER,
            user: AUTOMATION_USER,
          }),
        ),
        jira: createFromIssueJira({
          labels: fields["labels"] as Array<string>,
        }),
        database: createDatabase(other),
      });

      expect(echo.ports[other.steps.ifCreate]).toBe("no");
      expect(metadataIdsOf(echo)).toEqual([other.components.severityFindMany]);
      expect(echo.requests).toEqual([]);
      expect(echo.logs).toEqual([alreadyLinkedLog(other)]);
    });

    /*
     * The bare oneuptime label is enough on its own to stop a create, so the
     * tests above would pass even if only it counted. Without it — someone
     * tidied the labels away — the record's own label still has to count as
     * a link, whichever kind of record it names.
     */
    test.each([
      ["in the payload", true],
      ["only in Jira", false],
    ])(
      `an issue carrying only the ${linked.noun}'s own label (%s) ${other.create}s no ${other.noun}`,
      async (_where: string, inPayload: boolean) => {
        const labels: Array<string> = [linked.label()];

        const trace: SimulationTrace = await runCreateFromIssue(other, {
          event: jiraIssueCreatedEvent({ labels: inPayload ? labels : [] }),
          labels: labels,
        });

        expect(trace.ports[other.steps.ifCreate]).toBe(
          inPayload ? "no" : "yes",
        );
        expect(metadataIdsOf(trace)).toEqual([
          other.components.severityFindMany,
        ]);
        expect(trace.requests).toEqual(inPayload ? [] : [GET_LABELS_REQUEST]);
        expect(trace.logs).toEqual([alreadyLinkedLog(other)]);
      },
    );

    /*
     * Both create-from-Jira templates registered for the Issue created event:
     * each receives the same delivery. Once the first has created its record
     * and labelled the issue, the second's check with Jira has to refuse it.
     */
    test.each([
      ["both link labels", false],
      [`only the ${linked.noun}'s own label`, true],
    ])(
      `when the ${linked.noun} template has already linked the issue, the ${other.noun} template's check with Jira refuses an issue carrying %s`,
      async (_carrying: string, dropLinkLabel: boolean) => {
        const first: SimulationTrace = await runCreateFromIssue(linked);

        expect(metadataIdsOf(first)).toEqual([
          linked.components.severityFindMany,
          linked.components.createOne,
        ]);

        const added: Array<string> = addedLabelsOf(first);

        expect(added).toEqual([
          JIRA_LINK_LABEL,
          `${linked.labelPrefix}${linked.newId}`,
        ]);

        // The same delivery, which still shows no labels, reaches the other kind's template.
        const second: SimulationTrace = await runCreateFromIssue(other, {
          labels: dropLinkLabel
            ? added.filter((label: string) => {
                return label !== JIRA_LINK_LABEL;
              })
            : added,
        });

        expect(second.executed).toEqual([
          "webhook-1",
          "find-severities-1",
          other.steps.prepareRecord,
          other.steps.ifCreate,
          "get-issue-1",
          "confirm-unlinked-1",
          "if-unlinked-1",
          "log-already-linked",
        ]);
        expect(metadataIdsOf(second)).toEqual([
          other.components.severityFindMany,
        ]);
        expect(second.requests).toEqual([GET_LABELS_REQUEST]);
        expect(second.logs).toEqual([alreadyLinkedLog(other)]);
      },
    );

    test(`a status change on the ${linked.noun}'s issue moves the ${linked.noun}, and no ${other.noun}`, async () => {
      const event: JSONObject = jiraIssueUpdatedEvent({
        items: RESOLVED_CHANGELOG,
        labels: linkedLabelsOf(linked),
        status: DONE,
      });

      const otherTrace: SimulationTrace = await runTemplate({
        templateId: other.templates.statusToState,
        trigger: webhookDelivery(event),
        database: statusDatabase(
          other,
          recordOf(other, other.acknowledgedState),
        ),
      });

      expect(otherTrace.executed).toEqual([
        "webhook-1",
        "read-event-1",
        "if-status-changed-1",
        "log-ignored",
      ]);
      expect(otherTrace.databaseCalls).toEqual([]);
      expect(otherTrace.logs).toEqual([notLinkedLog(other)]);

      const linkedTrace: SimulationTrace = await runTemplate({
        templateId: linked.templates.statusToState,
        trigger: webhookDelivery(event),
        database: statusDatabase(
          linked,
          recordOf(linked, linked.acknowledgedState),
        ),
      });

      expect(
        jsonOf(linkedTrace, linked.components.timelineCreateOne),
      ).toMatchObject({
        [linked.idColumn]: linked.id,
        [linked.timelineStateColumn]: linked.resolvedState["_id"] as string,
      });
    });

    test(`a comment on the ${linked.noun}'s issue is noted on the ${linked.noun}, and on no ${other.noun}`, async () => {
      const otherTrace: SimulationTrace = await runComment(other, {
        event: jiraCommentEvent(),
        labels: linkedLabelsOf(linked),
      });

      expect(otherTrace.requests).toEqual([GET_LABELS_REQUEST]);
      expect(otherTrace.databaseCalls).toEqual([]);
      expect(otherTrace.logs).toEqual([notLinkedLog(other)]);

      const linkedTrace: SimulationTrace = await runComment(linked, {
        event: jiraCommentEvent(),
        labels: linkedLabelsOf(linked),
      });

      expect(jsonOf(linkedTrace, linked.components.noteCreateOne)).toEqual({
        [linked.idColumn]: linked.id,
        note: EXPECTED_COMMENT_NOTE,
      });
    });

    test(`an edit to the ${linked.noun}'s issue is noted on the ${linked.noun}, and on no ${other.noun}`, async () => {
      const event: JSONObject = priorityChange(linkedLabelsOf(linked));

      const otherTrace: SimulationTrace = await runIssueChanges(other, {
        event: event,
      });

      expect(otherTrace.databaseCalls).toEqual([]);
      expect(otherTrace.logs).toEqual([notLinkedLog(other)]);

      const linkedTrace: SimulationTrace = await runIssueChanges(linked, {
        event: event,
      });

      expect(
        jsonOf(linkedTrace, linked.components.noteCreateOne)[linked.idColumn],
      ).toBe(linked.id);
    });

    test(`a comment the ${linked.noun}'s note template posts comes back, and is copied to no ${other.noun} either`, async () => {
      const posted: SimulationTrace = await runNoteToComment(
        linked.templates.privateNote,
        linked.note(),
      );

      // Stopped by its marker before the other template even asks Jira which record it is on.
      const echo: SimulationTrace = await runComment(other, {
        event: jiraCommentEvent({
          body: wikiTextOf(postedCommentOf(posted)),
          author: AUTOMATION_USER,
        }),
        labels: linkedLabelsOf(linked),
      });

      expect(echo.requests).toEqual([]);
      expect(echo.databaseCalls).toEqual([]);
      expect(echo.logs).toEqual([COMMENT_FROM_ONEUPTIME_LOG]);
    });

    /*
     * The other direction. Jira here answers a label search the way Jira
     * does, so an issue is found only by the label it carries: the other
     * kind's transitions, notes and edits search by their own label, find
     * nothing, and post nothing to the linked kind's issue.
     */
    test(`the ${other.noun} templates' searches do not find the ${linked.noun}'s issue, so nothing is posted to it`, async () => {
      const jira: FakeJiraFunction = labelAwareJira(linkedLabelsOf(linked));

      const transition: SimulationTrace = await runTemplate({
        templateId: other.templates.transition,
        trigger: onRecord(other.model({ state: other.resolvedState })),
        jira: jira,
      });
      const note: SimulationTrace = await runTemplate({
        templateId: other.templates.privateNote,
        trigger: onRecord(other.note()),
        jira: jira,
      });
      const edit: SimulationTrace = await runTemplate({
        templateId: other.templates.updateComment,
        trigger: onRecord(other.model()),
        jira: jira,
      });

      expect(transition.requests).toEqual([
        searchRequest(other, ["key", "status"], true),
      ]);
      expect(note.requests).toEqual([searchRequest(other, ["key", "summary"])]);
      expect(edit.requests).toEqual([searchRequest(other, ["key", "summary"])]);

      for (const trace of [transition, note, edit]) {
        expect(trace.logs).toEqual([noLinkedIssueLog(other)]);
      }

      // The same Jira answers the linked kind's search, so it was the label that decided.
      const linkedTransition: SimulationTrace = await runTemplate({
        templateId: linked.templates.transition,
        trigger: onRecord(linked.model({ state: linked.resolvedState })),
        jira: jira,
      });

      expect(linkedTransition.requests).toEqual([
        searchRequest(linked, ["key", "status"], true),
        transitionRequest("31"),
      ]);
    });
  },
);

/* ------------------------------- Security ------------------------------- */

const TOKEN_REFERENCE: string = "{{local.variables.jiraBasicAuthToken}}";
const HEADERS_REFERENCE: string =
  "{{local.components.webhook-1.returnValues.request-headers}}";

type ExpectNothingSubstitutedFunction = (trace: SimulationTrace) => void;

/*
 * What leaves the workflow — URLs, request bodies, database payloads — holds
 * no reference still waiting to be resolved, no secret, and none of the
 * webhook's own headers.
 */
const expectNothingSubstituted: ExpectNothingSubstitutedFunction = (
  trace: SimulationTrace,
): void => {
  const outgoing: Array<string> = [
    ...trace.requests.map((request: JiraRequest) => {
      return request.url + JSON.stringify(request.body ?? null);
    }),
    ...trace.databaseCalls.map((call: DatabaseCall) => {
      return JSON.stringify(call.args);
    }),
  ];

  for (const text of outgoing) {
    expect(text).not.toContain("{{");
    expect(text).not.toContain(JIRA_TOKEN);
    expect(text).not.toContain(WEBHOOK_IDENTIFIER);
  }
};

type ExpectTokenOnlyInAuthorizationFunction = (trace: SimulationTrace) => void;

/*
 * The secret has exactly one place to be: the Authorization header of a
 * request to Jira. Anywhere else in the trace — a URL, a body, a database
 * payload, a log line, a step's return value — is somewhere the run log or a
 * third party would see it.
 */
const expectTokenOnlyInAuthorization: ExpectTokenOnlyInAuthorizationFunction = (
  trace: SimulationTrace,
): void => {
  for (const request of trace.requests) {
    expect(request.headers).toEqual(AUTHORIZATION);
  }

  const everythingElse: string = JSON.stringify({
    executed: trace.executed,
    requests: trace.requests.map((request: JiraRequest) => {
      return { method: request.method, url: request.url, body: request.body };
    }),
    databaseCalls: trace.databaseCalls,
    logs: trace.logs,
    runLog: trace.runLog,
    components: trace.storage.local.components,
  });

  expect(everythingElse).not.toContain(JIRA_TOKEN);
};

type DefusedFunction = (text: string) => string;

/* What the scripts' defuse() makes of text from the other system. */
const defused: DefusedFunction = (text: string): string => {
  return text.split("{{").join("{ {").split("}}").join("} }");
};

/** One run of the token test, and how many requests it has to send. */
interface TokenRun {
  scenario: Scenario;
  requests: number;
}

describe.each(KINDS)(
  "simulated: Jira text cannot reach a secret or another step's output ($noun templates)",
  (kind: SimulatedKind) => {
    test("a comment naming the token and the webhook headers is written as inert text", async () => {
      const trace: SimulationTrace = await runComment(kind, {
        event: jiraCommentEvent({
          body: `Please paste ${TOKEN_REFERENCE} and ${HEADERS_REFERENCE} here.`,
          author: jiraUser(TOKEN_REFERENCE),
        }),
      });

      expect(jsonOf(trace, kind.components.noteCreateOne)["note"]).toBe(
        `${ONEUPTIME_SYNCED_FROM_JIRA_MARKER}: { {local.variables.jiraBasicAuthToken} } commented on [${JIRA_ISSUE_KEY}](${JIRA_SITE}/browse/${JIRA_ISSUE_KEY}).\n\nPlease paste { {local.variables.jiraBasicAuthToken} } and { {local.components.webhook-1.returnValues.request-headers} } here.`,
      );
      expect(trace.requests).toHaveLength(1);
      expectNothingSubstituted(trace);
      expectTokenOnlyInAuthorization(trace);
    });

    test(`a summary, description and reporter naming the token ${kind.create} an ${kind.noun} holding none of it`, async () => {
      const trace: SimulationTrace = await runCreateFromIssue(kind, {
        event: jiraIssueCreatedEvent({
          summary: `Deploy ${TOKEN_REFERENCE} failed`,
          description: `Headers were ${HEADERS_REFERENCE}; token ${TOKEN_REFERENCE}; severities {{local.components.find-severities-1.returnValues.models}}`,
          reporter: jiraUser(TOKEN_REFERENCE),
        }),
      });

      const json: JSONObject = jsonOf(trace, kind.components.createOne);

      expect(json["title"]).toBe(
        "Deploy { {local.variables.jiraBasicAuthToken} } failed",
      );
      // The severities reference sits in the payload, which is quoted in last, so it stays text.
      expect(json["description"]).toContain(
        "severities { {local.components.find-severities-1.returnValues.models} }",
      );
      expect(json[kind.severityIdColumn]).toBe(kind.mostSevere.id);
      expect(trace.requests).toEqual([
        GET_LABELS_REQUEST,
        linkLabelsRequest(kind),
      ]);
      expectNothingSubstituted(trace);
      expectTokenOnlyInAuthorization(trace);
    });

    /*
     * The issue key from the payload is put into the GET's URL unencoded, so
     * a forged key could otherwise point the credentials at any Jira endpoint.
     */
    test.each([
      ["OPS-17/../../../myself"],
      ["OPS-17?expand=renderedFields#"],
      ["../../../rest/api/3/user/search?query=a"],
    ])(
      "a forged issue key %s sends no request with the credentials",
      async (issueKey: string) => {
        const trace: SimulationTrace = await runCreateFromIssue(kind, {
          event: jiraIssueCreatedEvent({ key: issueKey }),
        });

        expect(trace.requests).toEqual([]);
        expect(metadataIdsOf(trace)).toEqual([
          kind.components.severityFindMany,
        ]);
        expect(trace.logs).toEqual([
          "ℹ️ The event did not name a Jira issue key.",
        ]);
      },
    );

    /*
     * A skip reason is logged by substituting it into a Log step, so it is
     * held to the same rule as any other text from Jira: here a status name,
     * which Jira admins choose.
     */
    test("a Jira status named like a reference is quoted inertly in the reason a transition was skipped", async () => {
      const trace: SimulationTrace = await runTemplate({
        templateId: kind.templates.transition,
        trigger: onRecord(kind.model({ state: kind.resolvedState })),
        jira: jiraRoutes({
          [SEARCH]: ok(
            jiraSearchResponse({
              status: jiraStatus({
                name: TOKEN_REFERENCE,
                categoryKey: "indeterminate",
                id: "10300",
              }),
              transitions: [],
            }),
          ),
          [TRANSITION]: NO_CONTENT,
        }),
      });

      expect(trace.requests).toEqual([
        searchRequest(kind, ["key", "status"], true),
      ]);
      expect(trace.logs).toEqual([
        `ℹ️ Jira issue ${JIRA_ISSUE_KEY} has no transition from { {local.variables.jiraBasicAuthToken} } to a Done status that can be chosen without naming it in STATE_TO_JIRA_STATUS.`,
      ]);
      expectNothingSubstituted(trace);
      expectTokenOnlyInAuthorization(trace);
    });

    // The transition's id is Jira's text too, and it is quoted into the request body.
    test("a transition id named like a reference is sent as inert text", async () => {
      const trace: SimulationTrace = await runTemplate({
        templateId: kind.templates.transition,
        trigger: onRecord(kind.model({ state: kind.resolvedState })),
        jira: jiraRoutes({
          [SEARCH]: ok(
            jiraSearchResponse({
              transitions: [
                jiraTransition({
                  id: TOKEN_REFERENCE,
                  name: "Close",
                  to: DONE,
                }),
              ],
            }),
          ),
          [TRANSITION]: NO_CONTENT,
        }),
      });

      expect(trace.requests).toHaveLength(2);
      expect(trace.requests[1]!.body).toEqual({
        transition: { id: "{ {local.variables.jiraBasicAuthToken} }" },
      });
      expectNothingSubstituted(trace);
      expectTokenOnlyInAuthorization(trace);
    });

    test("a changelog naming references is noted as inert text", async () => {
      const trace: SimulationTrace = await runIssueChanges(kind, {
        event: jiraIssueUpdatedEvent({
          labels: linkedLabelsOf(kind),
          user: jiraUser(HEADERS_REFERENCE),
          items: [
            changelogItem({
              field: "summary",
              fromString: "Checkout API returns 502",
              toString: `Leak ${TOKEN_REFERENCE} and {{local.components.${kind.steps.find}.returnValues.model}}`,
            }),
          ],
        }),
      });

      const note: string = jsonOf(trace, kind.components.noteCreateOne)[
        "note"
      ] as string;

      expect(note).toContain(
        `- summary: Checkout API returns 502 → Leak { {local.variables.jiraBasicAuthToken} } and { {local.components.${kind.steps.find}.returnValues.model} }`,
      );
      expectNothingSubstituted(trace);
    });

    /*
     * Jira users choose their own display names, and the status template
     * quotes the event its first script returns — which carries that name —
     * into the next script's arguments BEFORE the record and the states. A
     * name that is a reference to one of those later values would be
     * substituted in its place, leaving the real reference unresolved. The
     * helper block's rule — text from the other system is defused before it
     * is returned — is what is supposed to prevent that.
     */
    test.each([
      ["{{local.components.find-states-1.returnValues.models}}"],
      [`{{local.components.${kind.steps.find}.returnValues.model}}`],
    ])(
      `a Jira user named %s still resolves the ${kind.noun}`,
      async (displayName: string) => {
        const trace: SimulationTrace = await runTemplate({
          templateId: kind.templates.statusToState,
          trigger: webhookDelivery(
            jiraIssueUpdatedEvent({
              items: RESOLVED_CHANGELOG,
              labels: linkedLabelsOf(kind),
              status: DONE,
              user: jiraUser(displayName),
            }),
          ),
          database: statusDatabase(
            kind,
            recordOf(kind, kind.acknowledgedState),
          ),
        });

        expect(trace.logs).toEqual([
          `✅ Moved ${kind.number} to Resolved because Jira issue ${JIRA_ISSUE_KEY} is now Done.`,
        ]);
        expect(jsonOf(trace, kind.components.timelineCreateOne)).toEqual({
          [kind.idColumn]: kind.id,
          [kind.timelineStateColumn]: kind.resolvedState["_id"] as string,
          rootCause: `${ONEUPTIME_SYNCED_FROM_JIRA_MARKER}: issue ${JIRA_ISSUE_KEY} moved to Done by ${defused(displayName)}.`,
        });
        expectNothingSubstituted(trace);
      },
    );

    /*
     * The same rule for the other direction: the transition template returns
     * the name of the status it moves the issue to, and the success log
     * quotes that name before the script's own reason.
     */
    test("a Jira status named like a reference is logged as text, not substituted", async () => {
      const trickStatus: JSONObject = jiraStatus({
        name: "{{local.components.plan-transition-1.returnValues.returnValue.reason}}",
        categoryKey: "done",
        id: "10099",
      });

      const trace: SimulationTrace = await runTemplate({
        templateId: kind.templates.transition,
        trigger: onRecord(kind.model({ state: kind.resolvedState })),
        jira: jiraRoutes({
          [SEARCH]: ok(
            jiraSearchResponse({
              transitions: [
                jiraTransition({ id: "41", name: "Close", to: trickStatus }),
              ],
            }),
          ),
          [TRANSITION]: NO_CONTENT,
        }),
      });

      expect(trace.requests[1]!.body).toEqual({ transition: { id: "41" } });
      expect(trace.logs).toEqual([
        `✅ Moved Jira issue ${JIRA_ISSUE_KEY} to { {local.components.plan-transition-1.returnValues.returnValue.reason} }. ${kind.number} is Resolved in OneUptime.`,
      ]);
    });

    test.each(kind.noteTemplates)(
      "$templateId: OneUptime text naming the token is posted to Jira as inert text",
      async (noteTemplate: NoteTemplate) => {
        const trace: SimulationTrace = await runNoteToComment(
          noteTemplate.templateId,
          kind.note({ note: `Rotate ${TOKEN_REFERENCE} after this.` }),
        );

        expect(trace.requests).toHaveLength(2);
        expect(JSON.stringify(trace.requests[1]!.body)).toContain(
          "Rotate { {local.variables.jiraBasicAuthToken} } after this.",
        );
        expectNothingSubstituted(trace);
        expectTokenOnlyInAuthorization(trace);
      },
    );

    test("an edited title naming the token is posted to Jira as inert text", async () => {
      const trace: SimulationTrace = await runTemplate({
        templateId: kind.templates.updateComment,
        trigger: onRecord(
          kind.model({ title: `Rotate ${TOKEN_REFERENCE} after this` }),
        ),
        jira: jiraRoutes({
          [SEARCH]: ok(jiraSearchResponse()),
          [COMMENT]: COMMENT_CREATED,
        }),
      });

      expect(trace.requests).toHaveLength(2);
      expect(wikiTextOf(postedCommentOf(trace))).toContain(
        "Title: Rotate { {local.variables.jiraBasicAuthToken} } after this",
      );
      expectNothingSubstituted(trace);
      expectTokenOnlyInAuthorization(trace);
    });

    /*
     * Every path that talks to Jira, run once each: the token must ride in
     * the Authorization header of every request, as Basic auth, and turn up
     * nowhere else — including in failure logs that print Jira's response.
     */
    test("the token is in every request's Authorization header and nowhere else in any trace", async () => {
      const runs: Array<TokenRun> = [
        {
          requests: 1,
          scenario: {
            templateId: kind.templates.createIssue,
            trigger: onRecord(kind.model()),
            jira: jiraRoutes({ [CREATE_ISSUE]: ISSUE_CREATED }),
          },
        },
        {
          requests: 1,
          scenario: {
            templateId: kind.templates.createIssue,
            trigger: onRecord(kind.model()),
            jira: jiraRoutes({
              [CREATE_ISSUE]: badRequest({
                errorMessages: ["Unauthorized"],
                errors: {},
              }),
            }),
          },
        },
        {
          requests: 2,
          scenario: {
            templateId: kind.templates.transition,
            trigger: onRecord(kind.model({ state: kind.acknowledgedState })),
            jira: jiraRoutes({
              [SEARCH]: ok(jiraSearchResponse()),
              [TRANSITION]: NO_CONTENT,
            }),
          },
        },
        {
          requests: 1,
          scenario: {
            templateId: kind.templates.transition,
            trigger: onRecord(kind.model({ state: kind.acknowledgedState })),
            jira: jiraRoutes({
              [SEARCH]: { status: 401, body: "Unauthorized" },
            }),
          },
        },
        ...kind.noteTemplates.flatMap(
          (noteTemplate: NoteTemplate): Array<TokenRun> => {
            return [
              {
                requests: 2,
                scenario: {
                  templateId: noteTemplate.templateId,
                  trigger: onRecord(kind.note()),
                  jira: jiraRoutes({
                    [SEARCH]: ok(jiraSearchResponse()),
                    [COMMENT]: COMMENT_CREATED,
                  }),
                },
              },
              {
                requests: 2,
                scenario: {
                  templateId: noteTemplate.templateId,
                  trigger: onRecord(kind.note()),
                  jira: jiraRoutes({
                    [SEARCH]: ok(jiraSearchResponse()),
                    [COMMENT]: {
                      status: 403,
                      body: { errorMessages: ["Forbidden"] },
                    },
                  }),
                },
              },
            ];
          },
        ),
        {
          requests: 2,
          scenario: {
            templateId: kind.templates.updateComment,
            trigger: onRecord(kind.model()),
            jira: jiraRoutes({
              [SEARCH]: ok(jiraSearchResponse()),
              [COMMENT]: COMMENT_CREATED,
            }),
          },
        },
        {
          requests: 2,
          scenario: {
            templateId: kind.templates.createFromIssue,
            trigger: webhookDelivery(jiraIssueCreatedEvent()),
            jira: createFromIssueJira(),
            database: createDatabase(kind),
          },
        },
        {
          requests: 1,
          scenario: {
            templateId: kind.templates.createFromIssue,
            trigger: webhookDelivery(jiraIssueCreatedEvent()),
            jira: createFromIssueJira({ labels: linkedLabelsOf(kind) }),
            database: createDatabase(kind),
          },
        },
        {
          requests: 1,
          scenario: {
            templateId: kind.templates.createFromIssue,
            trigger: webhookDelivery(jiraIssueCreatedEvent()),
            jira: createFromIssueJira({
              getIssue: {
                status: 404,
                body: { errorMessages: ["Issue does not exist"], errors: {} },
              },
            }),
            database: createDatabase(kind),
          },
        },
        {
          requests: 2,
          scenario: {
            templateId: kind.templates.createFromIssue,
            trigger: webhookDelivery(jiraIssueCreatedEvent()),
            jira: createFromIssueJira({
              edit: badRequest({
                errorMessages: [],
                errors: { labels: "No." },
              }),
            }),
            database: createDatabase(kind),
          },
        },
        {
          requests: 1,
          scenario: commentScenario(kind, { event: jiraCommentEvent() }),
        },
        {
          requests: 1,
          scenario: {
            templateId: kind.templates.commentToNote,
            trigger: webhookDelivery(jiraCommentEvent()),
            jira: jiraRoutes({
              [GET_LABELS]: {
                status: 404,
                body: { errorMessages: ["Issue does not exist"] },
              },
            }),
          },
        },
      ];

      const traces: Array<SimulationTrace> = [];

      for (const run of runs) {
        const trace: SimulationTrace = await runTemplate(run.scenario);

        // A run that sent fewer requests than it should would test less than it claims.
        expect(trace.requests).toHaveLength(run.requests);
        traces.push(trace);
      }

      // Every template of this kind that holds the token is represented...
      const covered: Array<string> = traces
        .map((trace: SimulationTrace) => {
          return trace.templateId;
        })
        .filter((templateId: string, index: number, all: Array<string>) => {
          return all.indexOf(templateId) === index;
        })
        .sort();
      const holdingTheToken: Array<string> = templateIdsOf(kind)
        .filter((templateId: string) => {
          return getWorkflowTemplate(templateId)!.variables.some(
            (variable: WorkflowTemplateVariable) => {
              return variable.name === "jiraBasicAuthToken";
            },
          );
        })
        .sort();

      expect(covered).toEqual(holdingTheToken);

      // ...and so is every Jira endpoint any of them calls, the create-from-Jira template's GET included.
      const routes: Array<string> = traces
        .flatMap((trace: SimulationTrace) => {
          return trace.requests.map((request: JiraRequest) => {
            return `${request.method} ${request.url.replace(JIRA_SITE, "")}`;
          });
        })
        .filter((route: string, index: number, all: Array<string>) => {
          return all.indexOf(route) === index;
        })
        .sort();

      expect(routes).toEqual(
        [
          CREATE_ISSUE,
          SEARCH,
          TRANSITION,
          COMMENT,
          EDIT_ISSUE,
          GET_LABELS,
        ].sort(),
      );

      for (const trace of traces) {
        expectTokenOnlyInAuthorization(trace);
        expectNothingSubstituted(trace);

        // A read carries no body for the credentials to be copied into.
        for (const request of trace.requests) {
          if (request.method === "GET") {
            expect(request.body).toBeUndefined();
          }
        }
      }
    });
  },
);
