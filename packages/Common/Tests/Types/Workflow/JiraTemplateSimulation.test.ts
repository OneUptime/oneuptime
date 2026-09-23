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
 */

import {
  ACKNOWLEDGED_STATE,
  CREATED_STATE,
  CRITICAL_SEVERITY_ID,
  DONE,
  EMPTY_JIRA_SEARCH,
  IN_PROGRESS,
  INCIDENT_ID,
  INCIDENT_NUMBER,
  INCIDENT_SEVERITIES,
  INCIDENT_STATES,
  IncidentModelProps,
  JIRA_ISSUE_ID,
  JIRA_ISSUE_KEY,
  JIRA_SITE,
  MINOR_SEVERITY_ID,
  OTHER_INCIDENT_ID,
  PROJECT_ID,
  RESOLVED_CHANGELOG,
  RESOLVED_STATE,
  RESOLVED_STATE_ID,
  ACKNOWLEDGED_STATE_ID,
  STARTED_CHANGELOG,
  TO_DO,
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
  JIRA_INCIDENT_LABEL_PREFIX,
  JIRA_LINK_LABEL,
  JIRA_SYNCED_FROM_ONEUPTIME_MARKER,
  ONEUPTIME_SYNCED_FROM_JIRA_MARKER,
  WorkflowTemplate,
  buildGraphForTemplate,
  getWorkflowTemplate,
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

const NEW_NOTE_ID: string = "dddddddd-0000-4000-8000-000000000001";

const NEW_TIMELINE_ID: string = "eeeeeeee-0000-4000-8000-000000000001";

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
 * (incident-find-one, incident-state-timeline-create-one, ...) only exist
 * there, and a node without metadata has no arguments to resolve.
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

/** Keyed by the step's metadata id, e.g. "incident-find-one". */
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
   * SYNC_PRIVATE_INCIDENTS on.
   */
  editCode?: Dictionary<EditCodeFunction> | undefined;
}

interface SimulationTrace {
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
  fields: Array<string>,
  expandTransitions?: boolean,
) => JiraRequest;

/*
 * The label search every OneUptime -> Jira template starts with. It asks for
 * two issues, oldest first, so a clone carrying the same label is seen and
 * refused rather than silently being "the" issue.
 */
const searchRequest: SearchRequestFunction = (
  fields: Array<string>,
  expandTransitions?: boolean,
): JiraRequest => {
  const body: JSONObject = {
    jql: `labels = "${JIRA_INCIDENT_LABEL_PREFIX}${INCIDENT_ID}" ORDER BY created ASC`,
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

type IncidentRecordFunction = (
  state: JSONObject,
  incidentId?: string,
) => JSONObject;

/* An incident as Find One returns it for the status template's select. */
const incidentRecord: IncidentRecordFunction = (
  state: JSONObject,
  incidentId?: string,
): JSONObject => {
  return {
    _id: incidentId || INCIDENT_ID,
    incidentNumberWithPrefix: INCIDENT_NUMBER,
    currentIncidentState: {
      _id: state["_id"] as string,
      name: state["name"] as string,
      order: state["order"] as number,
    },
  };
};

type StatusDatabaseFunction = (incident: JSONObject | null) => FakeDatabase;

const statusDatabase: StatusDatabaseFunction = (
  incident: JSONObject | null,
): FakeDatabase => {
  return {
    "incident-find-one": found(incident),
    "incident-state-find-many": many(INCIDENT_STATES),
    "incident-state-timeline-create-one": createdWithId(NEW_TIMELINE_ID),
  };
};

type NoteDatabaseFunction = (incident: JSONObject | null) => FakeDatabase;

const noteDatabase: NoteDatabaseFunction = (
  incident: JSONObject | null,
): FakeDatabase => {
  return {
    "incident-find-one": found(incident),
    "incident-internal-note-create-one": createdWithId(NEW_NOTE_ID),
  };
};

const LINKED_INCIDENT: JSONObject = {
  _id: INCIDENT_ID,
  incidentNumberWithPrefix: INCIDENT_NUMBER,
};

const LINKED_LABELS: Array<string> = [JIRA_LINK_LABEL, incidentLabel()];

const DECLARE_DATABASE: FakeDatabase = {
  "incident-severity-find-many": many(INCIDENT_SEVERITIES),
  "incident-create-one": createdWithId(NEW_INCIDENT_ID),
};

/** The one read the Jira -> OneUptime templates make: an issue's labels, as Jira has them now. */
const GET_LABELS_REQUEST: JiraRequest = {
  method: "GET",
  url: `${JIRA_SITE}/rest/api/3/issue/${JIRA_ISSUE_KEY}?fields=labels`,
  headers: AUTHORIZATION,
};

type DeclareJiraFunction = (props?: {
  labels?: Array<string> | undefined;
  getIssue?: JiraReply | undefined;
  edit?: JiraReply | undefined;
}) => FakeJiraFunction;

/*
 * Jira as the declare template meets it: first asked for the issue's labels,
 * then asked to add the link labels. By default the issue has none yet, as a
 * freshly created issue does.
 */
const declareJira: DeclareJiraFunction = (props?: {
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

type PrivateIncidentModelFunction = (props?: IncidentModelProps) => JSONObject;

/* The fixtures' incident, marked private the way the triggers now select it. */
const privateIncidentModel: PrivateIncidentModelFunction = (
  props?: IncidentModelProps,
): JSONObject => {
  return { ...incidentModel(props), isPrivate: true };
};

type PrivateNoteModelFunction = () => JSONObject;

/* A note on a private incident: the note triggers select incident.isPrivate for this. */
const privateNoteModel: PrivateNoteModelFunction = (): JSONObject => {
  const note: JSONObject = noteModel();

  return {
    ...note,
    incident: { ...(note["incident"] as JSONObject), isPrivate: true },
  };
};

/** Every script that syncs a private incident documents this switch. */
const SYNC_PRIVATE_INCIDENTS: EditCodeFunction = (code: string): string => {
  return code.replace(
    "const SYNC_PRIVATE_INCIDENTS = false;",
    "const SYNC_PRIVATE_INCIDENTS = true;",
  );
};

type TriggerSelectOfFunction = (templateId: string) => JSONObject;

/*
 * What a database trigger asks the database for. The simulation hands the
 * trigger's model over as given, so a scenario that depends on a field — like
 * isPrivate — also checks that the real trigger would have selected it.
 */
const triggerSelectOf: TriggerSelectOfFunction = (
  templateId: string,
): JSONObject => {
  const graph: SimulatedGraph = buildSimulatedGraph(templateId);
  const trigger: SimulatedNode = graph.nodes[
    graph.triggerComponentId
  ] as SimulatedNode;

  return trigger.arguments["select"] as JSONObject;
};

const CLONE_KEY: string = "OPS-30";

type FirstIssueOfFunction = (search: JSONObject) => JSONObject;

const firstIssueOf: FirstIssueOfFunction = (search: JSONObject): JSONObject => {
  return (search["issues"] as Array<JSONObject>)[0] as JSONObject;
};

/*
 * Cloning an issue in Jira copies its labels, so the clone claims the
 * incident too. The search sorts oldest first; the original comes back first.
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

const CLONE_SKIPPED_LOG: string = `ℹ️ More than one Jira issue is labelled ${incidentLabel()} (${JIRA_ISSUE_KEY}, ${CLONE_KEY}). A cloned issue copies the label: remove it from every issue except the one filed for the incident.`;

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

/* ------------------------------- OneUptime -> Jira ------------------------------- */

const EXPECTED_ISSUE_DESCRIPTION: string = [
  `${INCIDENT_NUMBER} was declared in OneUptime.`,
  "Severity: Critical Incident",
  "State: Identified",
  "",
  'p99 latency on /checkout is above 2s.\nStarted after the "v4.2" deploy.',
].join("\n");

const INCIDENT_URL: string = `${ONEUPTIME_URL}/dashboard/${PROJECT_ID}/incidents/${INCIDENT_ID}`;

describe("simulated: create a Jira issue when an incident is declared", () => {
  const TEMPLATE: string = "jira-create-issue-for-incident";

  test("files one labelled issue, with a readable ADF description that links back to the incident", async () => {
    const trace: SimulationTrace = await runTemplate({
      templateId: TEMPLATE,
      trigger: onRecord(incidentModel()),
      jira: jiraRoutes({ [CREATE_ISSUE]: ISSUE_CREATED }),
    });

    expect(trace.executed).toEqual([
      "incident-on-create-1",
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
            summary: `[OneUptime] ${INCIDENT_NUMBER}: Checkout latency high`,
            labels: [JIRA_LINK_LABEL, incidentLabel()],
            description: {
              type: "doc",
              version: 1,
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: EXPECTED_ISSUE_DESCRIPTION }],
                },
                {
                  type: "paragraph",
                  content: [
                    {
                      type: "text",
                      text: "Open this incident in OneUptime",
                      marks: [{ type: "link", attrs: { href: INCIDENT_URL } }],
                    },
                  ],
                },
              ],
            },
          },
        },
      },
    ]);

    const fields: JSONObject = (trace.requests[0]!.body as JSONObject)[
      "fields"
    ] as JSONObject;
    expectValidAdf(fields["description"]);

    expect(trace.logs).toEqual([
      `✅ Created Jira issue ${JIRA_ISSUE_KEY} for ${INCIDENT_NUMBER}.`,
    ]);
    expect(trace.databaseCalls).toEqual([]);
  });

  test("an incident declared from Jira is skipped before anything is sent", async () => {
    const trace: SimulationTrace = await runTemplate({
      templateId: TEMPLATE,
      trigger: onRecord(
        incidentModel({ customFields: { jiraIssueKey: "OPS-9" } }),
      ),
      jira: jiraRoutes({ [CREATE_ISSUE]: ISSUE_CREATED }),
    });

    expect(trace.requests).toEqual([]);
    expect(trace.ports["if-create-1"]).toBe("no");
    expect(trace.logs).toEqual([
      `ℹ️ ${INCIDENT_NUMBER} was declared from Jira issue OPS-9, so no new issue was created.`,
    ]);
  });

  test("a private incident stays in OneUptime: no request of any kind reaches Jira", async () => {
    // The trigger has to ask for the flag, or the script would never see it.
    expect(triggerSelectOf(TEMPLATE)["isPrivate"]).toBe(true);

    const trace: SimulationTrace = await runTemplate({
      templateId: TEMPLATE,
      trigger: onRecord(privateIncidentModel()),
      jira: jiraRoutes({ [CREATE_ISSUE]: ISSUE_CREATED }),
    });

    expect(trace.executed).toEqual([
      "incident-on-create-1",
      "prepare-issue-1",
      "if-create-1",
      "log-skipped",
    ]);
    expect(trace.requests).toEqual([]);
    expect(trace.logs).toEqual([
      `ℹ️ ${INCIDENT_NUMBER} is a private incident, so no Jira issue was created.`,
    ]);
  });

  test("switching SYNC_PRIVATE_INCIDENTS on files the private incident after all", async () => {
    const trace: SimulationTrace = await runTemplate({
      templateId: TEMPLATE,
      trigger: onRecord(privateIncidentModel()),
      jira: jiraRoutes({ [CREATE_ISSUE]: ISSUE_CREATED }),
      editCode: { "prepare-issue-1": SYNC_PRIVATE_INCIDENTS },
    });

    expect(trace.requests).toHaveLength(1);
    expect(
      ((trace.requests[0]!.body as JSONObject)["fields"] as JSONObject)[
        "labels"
      ],
    ).toEqual([JIRA_LINK_LABEL, incidentLabel()]);
    expect(trace.logs).toEqual([
      `✅ Created Jira issue ${JIRA_ISSUE_KEY} for ${INCIDENT_NUMBER}.`,
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
      trigger: onRecord(incidentModel()),
      jira: jiraRoutes({ [CREATE_ISSUE]: badRequest(rejection) }),
    });

    expect(trace.requests).toHaveLength(1);
    expect(trace.ports["create-issue-1"]).toBe("error");

    /*
     * Jira's error body has none of the keys HTTPErrorResponse reads a message
     * from, so the error value is the generic one — which is why the log also
     * carries the body itself.
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
        incidentModel({
          title: title,
          description: 'Path "C:\\logs\\app.log"\r\n\ttab {{x}} $& $1',
        }),
      ),
      jira: jiraRoutes({ [CREATE_ISSUE]: ISSUE_CREATED }),
    });

    // Reaching Jira at all means the body survived substitution and JSON.parse.
    expect(trace.requests).toHaveLength(1);

    const fields: JSONObject = (trace.requests[0]!.body as JSONObject)[
      "fields"
    ] as JSONObject;

    expect(fields["summary"]).toBe(
      `[OneUptime] ${INCIDENT_NUMBER}: Disk "full" on C:\\data\\{ {local.variables.jiraBasicAuthToken} } {shard}\\`,
    );
    expect(fields["summary"]).not.toMatch(/[\r\n]/);

    const description: string = (
      (
        (
          (fields["description"] as JSONObject)["content"] as Array<JSONObject>
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
      `✅ Created Jira issue ${JIRA_ISSUE_KEY} for ${INCIDENT_NUMBER}.`,
    ]);
  });
});

describe("simulated: move the Jira issue when the incident is acknowledged or resolved", () => {
  const TEMPLATE: string = "jira-transition-issue-on-incident-state";

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
      trigger: onRecord(incidentModel({ state: state })),
      jira: jiraRoutes({ [SEARCH]: search, [TRANSITION]: NO_CONTENT }),
    });
  };

  test("acknowledged: finds the issue by label, then moves it to In Progress", async () => {
    const trace: SimulationTrace = await runTransition(
      ACKNOWLEDGED_STATE,
      ok(jiraSearchResponse()),
    );

    expect(trace.executed).toEqual([
      "incident-on-update-1",
      "find-issue-1",
      "plan-transition-1",
      "if-transition-1",
      "transition-issue-1",
      "log-transitioned",
    ]);
    expect(trace.requests).toEqual([
      searchRequest(["key", "status"], true),
      {
        method: "POST",
        url: `${JIRA_SITE}/rest/api/3/issue/${JIRA_ISSUE_KEY}/transitions`,
        headers: AUTHORIZATION,
        body: { transition: { id: "21" } },
      },
    ]);

    // The 204 Jira answers with is a success, empty body and all.
    expect(trace.ports["transition-issue-1"]).toBe("success");
    expect(
      trace.storage.local.components["transition-issue-1"]!.returnValues[
        "response-body"
      ],
    ).toEqual({ data: "" });
    expect(trace.logs).toEqual([
      `✅ Moved Jira issue ${JIRA_ISSUE_KEY} to In Progress. ${INCIDENT_NUMBER} is Acknowledged in OneUptime.`,
    ]);
  });

  test("resolved: moves the issue to Done with the Close transition", async () => {
    const trace: SimulationTrace = await runTransition(
      RESOLVED_STATE,
      ok(jiraSearchResponse()),
    );

    expect(trace.requests).toHaveLength(2);
    expect(trace.requests[1]!.body).toEqual({ transition: { id: "31" } });
    expect(trace.logs).toEqual([
      `✅ Moved Jira issue ${JIRA_ISSUE_KEY} to Done. ${INCIDENT_NUMBER} is Resolved in OneUptime.`,
    ]);
  });

  test("an issue that is already Done is left alone after the search", async () => {
    const trace: SimulationTrace = await runTransition(
      RESOLVED_STATE,
      ok(
        jiraSearchResponse({
          status: DONE,
          transitions: [
            jiraTransition({ id: "11", name: "Reopen", to: TO_DO }),
            jiraTransition({ id: "21", name: "Start work", to: IN_PROGRESS }),
          ],
        }),
      ),
    );

    expect(trace.requests).toEqual([searchRequest(["key", "status"], true)]);
    expect(trace.logs).toEqual([
      `ℹ️ Jira issue ${JIRA_ISSUE_KEY} is already Done.`,
    ]);
  });

  /*
   * Someone closed the issue in Jira before anyone acknowledged the incident.
   * Acknowledging it afterwards must not reopen the issue, even though a
   * transition back to In Progress is on offer.
   */
  test("acknowledging an incident whose issue is already Done posts no transition", async () => {
    const trace: SimulationTrace = await runTransition(
      ACKNOWLEDGED_STATE,
      ok(
        jiraSearchResponse({
          status: DONE,
          transitions: [
            jiraTransition({ id: "11", name: "Reopen", to: TO_DO }),
            jiraTransition({ id: "21", name: "Start work", to: IN_PROGRESS }),
          ],
        }),
      ),
    );

    expect(trace.requests).toEqual([searchRequest(["key", "status"], true)]);
    expect(trace.ports["if-transition-1"]).toBe("no");
    expect(trace.logs).toEqual([
      `ℹ️ Jira issue ${JIRA_ISSUE_KEY} is already Done, so it was not moved back to an In Progress status.`,
    ]);
  });

  /*
   * Jira Service Management's service request workflow, as its transitions
   * endpoint lists them. Canceled is a Done status too, and it is the one
   * without a screen, so "any Done status, screenless first" would cancel
   * the customer's request instead of resolving it.
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

  test("Jira Service Management: resolving picks Resolved, not the screenless Canceled", async () => {
    const trace: SimulationTrace = await runTransition(
      RESOLVED_STATE,
      ok(
        jiraSearchResponse({
          status: JSM_WAITING_FOR_SUPPORT,
          transitions: JSM_TRANSITIONS,
        }),
      ),
    );

    expect(trace.requests).toEqual([
      searchRequest(["key", "status"], true),
      {
        method: "POST",
        url: `${JIRA_SITE}/rest/api/3/issue/${JIRA_ISSUE_KEY}/transitions`,
        headers: AUTHORIZATION,
        body: { transition: { id: "761" } },
      },
    ]);
    expect(trace.logs).toEqual([
      `✅ Moved Jira issue ${JIRA_ISSUE_KEY} to Resolved. ${INCIDENT_NUMBER} is Resolved in OneUptime.`,
    ]);
  });

  test("Jira Service Management: acknowledging picks Work in progress, never Escalated or Waiting for customer", async () => {
    const trace: SimulationTrace = await runTransition(
      ACKNOWLEDGED_STATE,
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
      `✅ Moved Jira issue ${JIRA_ISSUE_KEY} to Work in progress. ${INCIDENT_NUMBER} is Acknowledged in OneUptime.`,
    ]);
  });

  test("two Done statuses that fit equally well move nothing, and the skip names both", async () => {
    const trace: SimulationTrace = await runTransition(
      RESOLVED_STATE,
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

    expect(trace.requests).toEqual([searchRequest(["key", "status"], true)]);
    expect(trace.logs).toEqual([
      `ℹ️ Jira issue ${JIRA_ISSUE_KEY} could move to Released or Deployed for a Done status. Name the one to use in STATE_TO_JIRA_STATUS.`,
    ]);
  });

  test("two issues carry the incident's label (a clone): no transition, and the skip names both", async () => {
    const trace: SimulationTrace = await runTransition(
      RESOLVED_STATE,
      ok(CLONED_SEARCH),
    );

    expect(trace.requests).toEqual([searchRequest(["key", "status"], true)]);
    expect(trace.logs).toEqual([CLONE_SKIPPED_LOG]);
  });

  test("a private incident's issue is not moved", async () => {
    expect(triggerSelectOf(TEMPLATE)["isPrivate"]).toBe(true);

    const trace: SimulationTrace = await runTemplate({
      templateId: TEMPLATE,
      trigger: onRecord(privateIncidentModel({ state: RESOLVED_STATE })),
      jira: jiraRoutes({
        [SEARCH]: ok(jiraSearchResponse()),
        [TRANSITION]: NO_CONTENT,
      }),
    });

    expect(trace.requests).toEqual([searchRequest(["key", "status"], true)]);
    expect(trace.logs).toEqual([
      `ℹ️ ${INCIDENT_NUMBER} is a private incident, so its Jira issue was not moved.`,
    ]);
  });

  test("no linked issue: only the search is sent, and the skip says why", async () => {
    const trace: SimulationTrace = await runTransition(
      ACKNOWLEDGED_STATE,
      ok(EMPTY_JIRA_SEARCH),
    );

    expect(trace.requests).toEqual([searchRequest(["key", "status"], true)]);
    expect(trace.logs).toEqual([
      `ℹ️ No Jira issue is labelled ${incidentLabel()}, or the Jira credentials cannot see it.`,
    ]);
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
      `ℹ️ ${INCIDENT_NUMBER} moved to Monitoring, which has no Jira status mapped to it.`,
    ]);
  });

  test("a 401 with a plain-text body reaches the failure log", async () => {
    const trace: SimulationTrace = await runTransition(ACKNOWLEDGED_STATE, {
      status: 401,
      body: "Client must be authenticated to access this resource.",
    });

    expect(trace.executed).toEqual([
      "incident-on-update-1",
      "find-issue-1",
      "log-find-failed",
    ]);
    expect(trace.requests).toHaveLength(1);
    expect(trace.logs).toEqual([
      `❌ Could not search Jira for the incident's issue: Client must be authenticated to access this resource.\nJira said: ${JSON.stringify(
        { data: "Client must be authenticated to access this resource." },
        null,
        2,
      )}`,
    ]);
  });
});

describe("simulated: copy notes to the Jira issue", () => {
  const PRIVATE: string = "jira-comment-from-private-note";
  const PUBLIC: string = "jira-comment-from-public-note";
  const NOTE_TEXT: string =
    "Failed over to the **secondary** database. Error rate is dropping.";

  type RunNoteFunction = (
    templateId: string,
    note: JSONObject,
  ) => Promise<SimulationTrace>;

  const runNote: RunNoteFunction = async (
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

  test("a private note becomes an internal comment on the linked issue", async () => {
    const trace: SimulationTrace = await runNote(PRIVATE, noteModel());

    expect(trace.executed).toEqual([
      "note-on-create-1",
      "find-issue-1",
      "build-comment-1",
      "if-post-1",
      "post-comment-1",
      "log-posted",
    ]);
    expect(trace.requests).toEqual([
      searchRequest(["key", "summary"]),
      {
        method: "POST",
        url: `${JIRA_SITE}/rest/api/3/issue/${JIRA_ISSUE_KEY}/comment`,
        headers: AUTHORIZATION,
        body: {
          body: adfOf(
            `${JIRA_SYNCED_FROM_ONEUPTIME_MARKER}: private note on ${INCIDENT_NUMBER} by Jane Doe.\n\n${NOTE_TEXT}`,
          ),
          // Without this, Jira Service Management shows the comment to the customer.
          properties: [{ key: "sd.public.comment", value: { internal: true } }],
        },
      },
    ]);
    expectValidAdf((trace.requests[1]!.body as JSONObject)["body"]);
    expect(trace.logs).toEqual([
      `✅ Posted the note to Jira issue ${JIRA_ISSUE_KEY}.`,
    ]);
  });

  test("a public note becomes an ordinary comment, with no internal property", async () => {
    const trace: SimulationTrace = await runNote(PUBLIC, noteModel());

    expect(trace.requests).toHaveLength(2);
    expect(trace.requests[1]!.body).toEqual({
      body: adfOf(
        `${JIRA_SYNCED_FROM_ONEUPTIME_MARKER}: public note on ${INCIDENT_NUMBER} by Jane Doe.\n\n${NOTE_TEXT}`,
      ),
    });
    expect(trace.logs).toEqual([
      `✅ Posted the note to Jira issue ${JIRA_ISSUE_KEY}.`,
    ]);
  });

  test.each([PRIVATE, PUBLIC])(
    "%s: a note that came from Jira is not posted back",
    async (templateId: string) => {
      const trace: SimulationTrace = await runNote(
        templateId,
        noteModel({
          note: `${ONEUPTIME_SYNCED_FROM_JIRA_MARKER}: Marco Rossi commented on [OPS-17](${JIRA_SITE}/browse/OPS-17).\n\nRolled back.`,
          authorName: null,
        }),
      );

      expect(trace.requests).toEqual([searchRequest(["key", "summary"])]);
      expect(trace.logs).toEqual([
        "ℹ️ This note came from Jira, so it was not posted back.",
      ]);
    },
  );

  test("an incident without a linked issue gets no comment", async () => {
    const trace: SimulationTrace = await runTemplate({
      templateId: PRIVATE,
      trigger: onRecord(noteModel()),
      jira: jiraRoutes({ [SEARCH]: ok(EMPTY_JIRA_SEARCH) }),
    });

    expect(trace.requests).toHaveLength(1);
    expect(trace.logs).toEqual([
      `ℹ️ No Jira issue is labelled ${incidentLabel()}, or the Jira credentials cannot see it.`,
    ]);
  });

  test.each([PRIVATE, PUBLIC])(
    "%s: a note on a private incident posts no comment",
    async (templateId: string) => {
      // The note trigger has to reach through to the incident for the flag.
      expect(triggerSelectOf(templateId)["incident"]).toEqual({
        incidentNumberWithPrefix: true,
        isPrivate: true,
      });

      const trace: SimulationTrace = await runNote(
        templateId,
        privateNoteModel(),
      );

      expect(trace.requests).toEqual([searchRequest(["key", "summary"])]);
      expect(trace.ports["if-post-1"]).toBe("no");
      expect(trace.logs).toEqual([
        `ℹ️ The note is on ${INCIDENT_NUMBER}, a private incident, so it was not posted to Jira.`,
      ]);
    },
  );

  test("switching SYNC_PRIVATE_INCIDENTS on posts the private incident's note after all", async () => {
    const trace: SimulationTrace = await runTemplate({
      templateId: PRIVATE,
      trigger: onRecord(privateNoteModel()),
      jira: jiraRoutes({
        [SEARCH]: ok(jiraSearchResponse()),
        [COMMENT]: COMMENT_CREATED,
      }),
      editCode: { "build-comment-1": SYNC_PRIVATE_INCIDENTS },
    });

    expect(trace.requests).toHaveLength(2);
    expect(trace.requests[1]!.url).toBe(
      `${JIRA_SITE}/rest/api/3/issue/${JIRA_ISSUE_KEY}/comment`,
    );
    expect(trace.logs).toEqual([
      `✅ Posted the note to Jira issue ${JIRA_ISSUE_KEY}.`,
    ]);
  });

  test.each([PRIVATE, PUBLIC])(
    "%s: two issues carrying the incident's label (a clone) get no comment, and the skip names both",
    async (templateId: string) => {
      const trace: SimulationTrace = await runTemplate({
        templateId: templateId,
        trigger: onRecord(noteModel()),
        jira: jiraRoutes({
          [SEARCH]: ok(CLONED_SEARCH),
          [COMMENT]: COMMENT_CREATED,
        }),
      });

      expect(trace.requests).toEqual([searchRequest(["key", "summary"])]);
      expect(trace.logs).toEqual([CLONE_SKIPPED_LOG]);
    },
  );
});

describe("simulated: comment on the Jira issue when the incident is edited", () => {
  const TEMPLATE: string = "jira-comment-on-incident-update";

  test("an internal comment lists the incident's current title, severity, state, root cause and remediation", async () => {
    const trace: SimulationTrace = await runTemplate({
      templateId: TEMPLATE,
      trigger: onRecord(
        incidentModel({
          title: "Checkout latency high in eu-west-1",
          severity: "Major Incident",
          state: ACKNOWLEDGED_STATE,
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
      searchRequest(["key", "summary"]),
      {
        method: "POST",
        url: `${JIRA_SITE}/rest/api/3/issue/${JIRA_ISSUE_KEY}/comment`,
        headers: AUTHORIZATION,
        body: {
          body: adfOf(
            [
              `${JIRA_SYNCED_FROM_ONEUPTIME_MARKER}: ${INCIDENT_NUMBER} was updated.`,
              "Title: Checkout latency high in eu-west-1",
              "Severity: Major Incident",
              "State: Acknowledged",
              "Root cause: A bad deploy of the payments service.",
              "Remediation: Rolled back to v4.1.",
              'Description: p99 latency on /checkout is above 2s.\nStarted after the "v4.2" deploy.',
            ].join("\n"),
          ),
          // A root cause is for the team: internal in Jira Service Management.
          properties: [{ key: "sd.public.comment", value: { internal: true } }],
        },
      },
    ]);
    expectValidAdf((trace.requests[1]!.body as JSONObject)["body"]);
    expect(trace.logs).toEqual([
      `✅ Posted the incident's changes to Jira issue ${JIRA_ISSUE_KEY}.`,
    ]);
  });

  test("a private incident's changes are not posted", async () => {
    expect(triggerSelectOf(TEMPLATE)["isPrivate"]).toBe(true);

    const trace: SimulationTrace = await runTemplate({
      templateId: TEMPLATE,
      trigger: onRecord(
        privateIncidentModel({
          rootCause: "A bad deploy of the payments service.",
        }),
      ),
      jira: jiraRoutes({
        [SEARCH]: ok(jiraSearchResponse()),
        [COMMENT]: COMMENT_CREATED,
      }),
    });

    expect(trace.requests).toEqual([searchRequest(["key", "summary"])]);
    expect(trace.logs).toEqual([
      `ℹ️ ${INCIDENT_NUMBER} is a private incident, so its changes were not posted to Jira.`,
    ]);
  });

  test("two issues carrying the incident's label (a clone) get no comment", async () => {
    const trace: SimulationTrace = await runTemplate({
      templateId: TEMPLATE,
      trigger: onRecord(incidentModel()),
      jira: jiraRoutes({
        [SEARCH]: ok(CLONED_SEARCH),
        [COMMENT]: COMMENT_CREATED,
      }),
    });

    expect(trace.requests).toEqual([searchRequest(["key", "summary"])]);
    expect(trace.logs).toEqual([CLONE_SKIPPED_LOG]);
  });
});

/* ------------------------------- Jira -> OneUptime ------------------------------- */

const EXPECTED_DECLARED_DESCRIPTION: string = [
  `Declared from Jira issue [${JIRA_ISSUE_KEY}](${JIRA_SITE}/browse/${JIRA_ISSUE_KEY}).`,
  "Priority: High",
  "Reported by: Priya Patel",
  "",
  "Customers in *eu-west-1* see 502s at checkout.\nStarted around 09:40 UTC.",
].join("\n");

const LINK_LABELS_REQUEST: JiraRequest = {
  method: "PUT",
  url: `${JIRA_SITE}/rest/api/3/issue/${JIRA_ISSUE_KEY}`,
  headers: AUTHORIZATION,
  body: {
    update: {
      labels: [
        { add: JIRA_LINK_LABEL },
        { add: `${JIRA_INCIDENT_LABEL_PREFIX}${NEW_INCIDENT_ID}` },
      ],
    },
  },
};

describe("simulated: declare an incident when a Jira issue is created", () => {
  const TEMPLATE: string = "jira-declare-incident-from-issue";

  type RunDeclareFunction = (props: {
    event: JSONObject;
    database?: FakeDatabase | undefined;
    /** The issue's labels as Jira's GET returns them; none by default. */
    labels?: Array<string> | undefined;
    getIssue?: JiraReply | undefined;
    edit?: JiraReply | undefined;
  }) => Promise<SimulationTrace>;

  const runDeclare: RunDeclareFunction = async (props: {
    event: JSONObject;
    database?: FakeDatabase | undefined;
    labels?: Array<string> | undefined;
    getIssue?: JiraReply | undefined;
    edit?: JiraReply | undefined;
  }): Promise<SimulationTrace> => {
    return await runTemplate({
      templateId: TEMPLATE,
      trigger: webhookDelivery(props.event),
      jira: declareJira({
        labels: props.labels,
        getIssue: props.getIssue,
        edit: props.edit,
      }),
      database: props.database || DECLARE_DATABASE,
    });
  };

  test("declares a private, quiet incident at the severity the priority maps to, then labels the issue with its id", async () => {
    const trace: SimulationTrace = await runDeclare({
      event: jiraIssueCreatedEvent(),
    });

    expect(trace.executed).toEqual([
      "webhook-1",
      "find-severities-1",
      "prepare-incident-1",
      "if-declare-1",
      "get-issue-1",
      "confirm-unlinked-1",
      "if-unlinked-1",
      "create-incident-1",
      "link-issue-1",
      "log-linked",
    ]);

    expect(trace.databaseCalls).toEqual([
      {
        componentId: "find-severities-1",
        metadataId: "incident-severity-find-many",
        args: {
          query: { _id: { _type: "NotNull", value: null } },
          select: { _id: true, name: true, order: true },
          limit: 50,
        },
      },
      {
        componentId: "create-incident-1",
        metadataId: "incident-create-one",
        args: {
          json: {
            // High is the most severe priority band, and severities are ordered 1 = most severe.
            incidentSeverityId: CRITICAL_SEVERITY_ID,
            customFields: { jiraIssueKey: JIRA_ISSUE_KEY },
            isVisibleOnStatusPage: false,
            shouldStatusPageSubscribersBeNotifiedOnIncidentCreated: false,
            title: "Checkout API returns 502 for EU customers",
            description: EXPECTED_DECLARED_DESCRIPTION,
          },
        },
      },
    ]);

    /*
     * Jira is asked for the issue's labels before anything is written, and
     * the label added afterwards carries the id the database just gave the
     * incident — nothing else could.
     */
    expect(trace.requests).toEqual([GET_LABELS_REQUEST, LINK_LABELS_REQUEST]);
    expect(trace.logs).toEqual([
      `✅ Declared an incident with severity Critical Incident for Jira issue ${JIRA_ISSUE_KEY}, and labelled the issue to link them.`,
    ]);
  });

  test("a Low priority lands on the least severe severity", async () => {
    const trace: SimulationTrace = await runDeclare({
      event: jiraIssueCreatedEvent({ priority: "Low" }),
    });

    expect(jsonOf(trace, "incident-create-one")["incidentSeverityId"]).toBe(
      MINOR_SEVERITY_ID,
    );
    expect(trace.logs[0]).toContain("with severity Minor Incident");
  });

  test("an issue whose payload shows it linked declares nothing, and Jira is not even asked", async () => {
    const trace: SimulationTrace = await runDeclare({
      event: jiraIssueCreatedEvent({ labels: LINKED_LABELS }),
    });

    expect(metadataIdsOf(trace)).toEqual(["incident-severity-find-many"]);
    expect(trace.requests).toEqual([]);
    expect(trace.logs).toEqual([
      `ℹ️ Jira issue ${JIRA_ISSUE_KEY} is already linked to OneUptime, so no incident was declared.`,
    ]);
  });

  /*
   * The payload is only the sender's word. Anyone holding the workflow's URL
   * can post an issue_created that shows no labels, and a delivery Jira
   * retries still carries the labels the issue had before the first delivery
   * linked it. What Jira returns now is what decides.
   */
  test.each([
    ["linked to this incident", LINKED_LABELS],
    ["claimed by another incident", [incidentLabel(OTHER_INCIDENT_ID)]],
    ["carrying only the oneuptime label", [JIRA_LINK_LABEL]],
  ])(
    "a payload showing no labels, for an issue Jira says is %s, declares nothing",
    async (_description: string, labels: Array<string>) => {
      const trace: SimulationTrace = await runDeclare({
        event: jiraIssueCreatedEvent(),
        labels: labels,
      });

      expect(trace.executed).toEqual([
        "webhook-1",
        "find-severities-1",
        "prepare-incident-1",
        "if-declare-1",
        "get-issue-1",
        "confirm-unlinked-1",
        "if-unlinked-1",
        "log-already-linked",
      ]);
      // No incident is written, and the issue's labels are not touched.
      expect(metadataIdsOf(trace)).toEqual(["incident-severity-find-many"]);
      expect(trace.requests).toEqual([GET_LABELS_REQUEST]);
      expect(trace.logs).toEqual([
        `ℹ️ Jira issue ${JIRA_ISSUE_KEY} is already linked to OneUptime, so no incident was declared.`,
      ]);
    },
  );

  test("an issue Jira will not return (a forged key, or credentials that cannot see it) declares nothing", async () => {
    const notFound: JSONObject = {
      errorMessages: [
        "Issue does not exist or you do not have permission to see it.",
      ],
      errors: {},
    };

    const trace: SimulationTrace = await runDeclare({
      event: jiraIssueCreatedEvent(),
      getIssue: { status: 404, body: notFound },
    });

    expect(trace.executed).toEqual([
      "webhook-1",
      "find-severities-1",
      "prepare-incident-1",
      "if-declare-1",
      "get-issue-1",
      "log-get-issue-failed",
    ]);
    expect(metadataIdsOf(trace)).toEqual(["incident-severity-find-many"]);
    expect(trace.requests).toEqual([GET_LABELS_REQUEST]);
    expect(trace.logs).toEqual([
      `❌ Could not read Jira issue ${JIRA_ISSUE_KEY}, so no incident was declared: Server Error.\nJira said: ${JSON.stringify(notFound, null, 2)}`,
    ]);
  });

  test("a success that is not the issue (a proxy's page) declares nothing", async () => {
    const trace: SimulationTrace = await runDeclare({
      event: jiraIssueCreatedEvent(),
      getIssue: { status: 200, body: "<html><body>Sign in</body></html>" },
    });

    expect(trace.ports["get-issue-1"]).toBe("success");
    expect(trace.ports["if-unlinked-1"]).toBe("no");
    expect(metadataIdsOf(trace)).toEqual(["incident-severity-find-many"]);
    expect(trace.requests).toEqual([GET_LABELS_REQUEST]);
    expect(trace.logs).toEqual([
      "ℹ️ Jira did not return the issue, so no incident was declared.",
    ]);
  });

  test("an issue_updated delivery to this webhook declares nothing", async () => {
    const trace: SimulationTrace = await runDeclare({
      event: jiraIssueUpdatedEvent({ items: STARTED_CHANGELOG }),
    });

    expect(metadataIdsOf(trace)).toEqual(["incident-severity-find-many"]);
    expect(trace.requests).toEqual([]);
    expect(trace.logs).toEqual([
      "ℹ️ Ignored a jira:issue_updated event: this workflow only handles jira:issue_created.",
    ]);
  });

  test("a failed create is logged, and the issue is not labelled with an id that does not exist", async () => {
    const trace: SimulationTrace = await runDeclare({
      event: jiraIssueCreatedEvent(),
      database: {
        ...DECLARE_DATABASE,
        "incident-create-one": DATABASE_FAILURE,
      },
    });

    // Only the read that came before the create; no label edit follows it.
    expect(trace.requests).toEqual([GET_LABELS_REQUEST]);
    expect(trace.logs).toEqual([
      `❌ Could not declare the incident for Jira issue ${JIRA_ISSUE_KEY}. The database error is in the run log above.`,
    ]);
  });

  test("Jira refusing the labels ends on the warning, since the incident does exist", async () => {
    const rejection: JSONObject = {
      errorMessages: [],
      errors: {
        labels:
          "Field 'labels' cannot be set. It is not on the appropriate screen, or unknown.",
      },
    };

    const trace: SimulationTrace = await runDeclare({
      event: jiraIssueCreatedEvent(),
      edit: badRequest(rejection),
    });

    expect(trace.requests).toEqual([GET_LABELS_REQUEST, LINK_LABELS_REQUEST]);
    expect(trace.logs).toEqual([
      `⚠️ The incident was declared, but Jira did not accept the link labels, so the other Jira templates cannot find it: Server Error.\nJira said: ${JSON.stringify(rejection, null, 2)}`,
    ]);
  });
});

describe("simulated: acknowledge or resolve the incident when its Jira issue moves", () => {
  const TEMPLATE: string = "jira-status-to-incident-state";

  type RunStatusFunction = (props: {
    event: JSONObject;
    incident: JSONObject | null;
  }) => Promise<SimulationTrace>;

  const runStatus: RunStatusFunction = async (props: {
    event: JSONObject;
    incident: JSONObject | null;
  }): Promise<SimulationTrace> => {
    return await runTemplate({
      templateId: TEMPLATE,
      trigger: webhookDelivery(props.event),
      database: statusDatabase(props.incident),
    });
  };

  const RESOLVED_EVENT: JSONObject = jiraIssueUpdatedEvent({
    items: RESOLVED_CHANGELOG,
    labels: LINKED_LABELS,
    status: DONE,
  });

  test("Done resolves an acknowledged incident with a new timeline row", async () => {
    const trace: SimulationTrace = await runStatus({
      event: RESOLVED_EVENT,
      incident: incidentRecord(ACKNOWLEDGED_STATE),
    });

    expect(trace.executed).toEqual([
      "webhook-1",
      "read-event-1",
      "if-status-changed-1",
      "find-incident-1",
      "find-states-1",
      "decide-state-1",
      "if-change-1",
      "change-state-1",
      "log-changed",
    ]);

    expect(callOf(trace, "incident-find-one").args).toEqual({
      query: { _id: INCIDENT_ID },
      select: {
        _id: true,
        incidentNumberWithPrefix: true,
        currentIncidentState: { _id: true, name: true, order: true },
      },
    });

    // A timeline row, never an edit to the incident: the timeline is what notifies and refuses to go backwards.
    expect(metadataIdsOf(trace)).toEqual([
      "incident-find-one",
      "incident-state-find-many",
      "incident-state-timeline-create-one",
    ]);
    expect(jsonOf(trace, "incident-state-timeline-create-one")).toEqual({
      incidentId: INCIDENT_ID,
      incidentStateId: RESOLVED_STATE_ID,
      rootCause: `${ONEUPTIME_SYNCED_FROM_JIRA_MARKER}: issue ${JIRA_ISSUE_KEY} moved to Done by Priya Patel.`,
    });
    expect(trace.requests).toEqual([]);
    expect(trace.logs).toEqual([
      `✅ Moved ${INCIDENT_NUMBER} to Resolved because Jira issue ${JIRA_ISSUE_KEY} is now Done.`,
    ]);
  });

  test("In Progress acknowledges a new incident", async () => {
    const trace: SimulationTrace = await runStatus({
      event: jiraIssueUpdatedEvent({
        items: STARTED_CHANGELOG,
        labels: LINKED_LABELS,
        status: IN_PROGRESS,
      }),
      incident: incidentRecord(CREATED_STATE),
    });

    expect(
      jsonOf(trace, "incident-state-timeline-create-one")["incidentStateId"],
    ).toBe(ACKNOWLEDGED_STATE_ID);
    expect(trace.logs).toEqual([
      `✅ Moved ${INCIDENT_NUMBER} to Acknowledged because Jira issue ${JIRA_ISSUE_KEY} is now In Progress.`,
    ]);
  });

  test("an incident that is already resolved is not moved again", async () => {
    const trace: SimulationTrace = await runStatus({
      event: RESOLVED_EVENT,
      incident: incidentRecord(RESOLVED_STATE),
    });

    expect(metadataIdsOf(trace)).toEqual([
      "incident-find-one",
      "incident-state-find-many",
    ]);
    expect(trace.logs).toEqual([
      `ℹ️ ${INCIDENT_NUMBER} is already Resolved, so Jira issue ${JIRA_ISSUE_KEY} moving to Done changes nothing.`,
    ]);
  });

  test("moving the issue back to To Do never moves the incident backwards", async () => {
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
        labels: LINKED_LABELS,
        status: TO_DO,
      }),
      incident: incidentRecord(ACKNOWLEDGED_STATE),
    });

    expect(metadataIdsOf(trace)).not.toContain(
      "incident-state-timeline-create-one",
    );
    expect(trace.logs).toEqual([
      `ℹ️ Jira issue ${JIRA_ISSUE_KEY} moved to To Do, which does not map to a OneUptime state.`,
    ]);
  });

  test("an issue with no incident label touches nothing in the database", async () => {
    const trace: SimulationTrace = await runStatus({
      event: jiraIssueUpdatedEvent({ items: RESOLVED_CHANGELOG, status: DONE }),
      incident: incidentRecord(ACKNOWLEDGED_STATE),
    });

    expect(trace.databaseCalls).toEqual([]);
    expect(trace.logs).toEqual([
      `ℹ️ Jira issue ${JIRA_ISSUE_KEY} is not linked to an incident: it has no ${JIRA_INCIDENT_LABEL_PREFIX}<id> label.`,
    ]);
  });

  test("a label naming an incident this project does not have changes nothing", async () => {
    const trace: SimulationTrace = await runStatus({
      event: RESOLVED_EVENT,
      incident: null,
    });

    expect(metadataIdsOf(trace)).toEqual([
      "incident-find-one",
      "incident-state-find-many",
    ]);
    expect(trace.logs).toEqual([
      `ℹ️ No incident with id ${INCIDENT_ID} exists in this project.`,
    ]);
  });
});

const EXPECTED_COMMENT_NOTE: string = `${ONEUPTIME_SYNCED_FROM_JIRA_MARKER}: Marco Rossi commented on [${JIRA_ISSUE_KEY}](${JIRA_SITE}/browse/${JIRA_ISSUE_KEY}).\n\nRolled back the *eu-west-1* deploy. Watching the error rate.`;

type RunCommentFunction = (props: {
  event: JSONObject;
  labels?: Array<string> | undefined;
  incident?: JSONObject | null | undefined;
}) => Promise<SimulationTrace>;

/* Shared by the comment suite and the echo and security suites below. */
const runComment: RunCommentFunction = async (props: {
  event: JSONObject;
  labels?: Array<string> | undefined;
  incident?: JSONObject | null | undefined;
}): Promise<SimulationTrace> => {
  return await runTemplate({
    templateId: "jira-comment-to-private-note",
    trigger: webhookDelivery(props.event),
    jira: jiraRoutes({
      [GET_LABELS]: ok(jiraIssueLabelsResponse(props.labels || LINKED_LABELS)),
    }),
    database: noteDatabase(
      props.incident === undefined ? LINKED_INCIDENT : props.incident,
    ),
  });
};

describe("simulated: add Jira comments to the incident as private notes", () => {
  test("reads the link off the issue, checks the incident is here, and writes the note", async () => {
    const trace: SimulationTrace = await runComment({
      event: jiraCommentEvent(),
    });

    expect(trace.executed).toEqual([
      "webhook-1",
      "read-comment-1",
      "if-comment-1",
      "get-issue-1",
      "find-link-1",
      "if-linked-1",
      "find-incident-1",
      "if-found-1",
      "create-note-1",
      "log-noted",
    ]);

    // Comment webhooks carry no labels, so the issue is fetched for them.
    expect(trace.requests).toEqual([GET_LABELS_REQUEST]);

    expect(trace.databaseCalls).toEqual([
      {
        componentId: "find-incident-1",
        metadataId: "incident-find-one",
        args: {
          query: { _id: INCIDENT_ID },
          select: { _id: true, incidentNumberWithPrefix: true },
        },
      },
      {
        componentId: "create-note-1",
        metadataId: "incident-internal-note-create-one",
        args: {
          json: { incidentId: INCIDENT_ID, note: EXPECTED_COMMENT_NOTE },
        },
      },
    ]);
    expect(trace.logs).toEqual([
      `✅ Added the Jira comment on ${JIRA_ISSUE_KEY} to ${INCIDENT_NUMBER} as a private note.`,
    ]);
  });

  test("a comment OneUptime posted is not copied back, and Jira is not even asked about it", async () => {
    const trace: SimulationTrace = await runComment({
      event: jiraCommentEvent({
        body: `${JIRA_SYNCED_FROM_ONEUPTIME_MARKER}: private note on ${INCIDENT_NUMBER} by Jane Doe.\n\nFailed over.`,
        author: AUTOMATION_USER,
      }),
    });

    expect(trace.requests).toEqual([]);
    expect(trace.databaseCalls).toEqual([]);
    expect(trace.logs).toEqual([
      "ℹ️ This comment was posted by OneUptime, so it was not copied back.",
    ]);
  });

  test("an issue without the labels is only looked at", async () => {
    const trace: SimulationTrace = await runComment({
      event: jiraCommentEvent(),
      labels: [],
    });

    expect(trace.requests).toHaveLength(1);
    expect(trace.requests[0]!.method).toBe("GET");
    expect(trace.databaseCalls).toEqual([]);
    expect(trace.logs).toEqual([
      `ℹ️ Jira issue ${JIRA_ISSUE_KEY} is not linked to an incident: it has no ${JIRA_INCIDENT_LABEL_PREFIX}<id> label.`,
    ]);
  });

  test("a label naming an incident in another project writes no note", async () => {
    const trace: SimulationTrace = await runComment({
      event: jiraCommentEvent(),
      labels: [JIRA_LINK_LABEL, incidentLabel(OTHER_INCIDENT_ID)],
      incident: null,
    });

    expect(callOf(trace, "incident-find-one").args["query"]).toEqual({
      _id: OTHER_INCIDENT_ID,
    });
    expect(trace.ports["if-found-1"]).toBe("no");
    expect(metadataIdsOf(trace)).toEqual(["incident-find-one"]);
    expect(trace.logs).toEqual([
      `ℹ️ Jira issue ${JIRA_ISSUE_KEY} names incident ${OTHER_INCIDENT_ID}, which is not in this project.`,
    ]);
  });
});

type RunIssueChangesFunction = (props: {
  event: JSONObject;
  incident?: JSONObject | null | undefined;
}) => Promise<SimulationTrace>;

const runIssueChanges: RunIssueChangesFunction = async (props: {
  event: JSONObject;
  incident?: JSONObject | null | undefined;
}): Promise<SimulationTrace> => {
  return await runTemplate({
    templateId: "jira-issue-changes-to-private-note",
    trigger: webhookDelivery(props.event),
    database: noteDatabase(
      props.incident === undefined ? LINKED_INCIDENT : props.incident,
    ),
  });
};

describe("simulated: add Jira issue changes to the incident as private notes", () => {
  test("a priority change is noted on the linked incident", async () => {
    const trace: SimulationTrace = await runIssueChanges({
      event: jiraIssueUpdatedEvent({
        labels: LINKED_LABELS,
        items: [
          changelogItem({
            field: "priority",
            from: "3",
            fromString: "Medium",
            to: "1",
            toString: "Highest",
          }),
        ],
      }),
    });

    expect(trace.executed).toEqual([
      "webhook-1",
      "read-changes-1",
      "if-changed-1",
      "find-incident-1",
      "if-found-1",
      "create-note-1",
      "log-noted",
    ]);
    expect(callOf(trace, "incident-find-one").args["query"]).toEqual({
      _id: INCIDENT_ID,
    });
    expect(jsonOf(trace, "incident-internal-note-create-one")).toEqual({
      incidentId: INCIDENT_ID,
      note: `${ONEUPTIME_SYNCED_FROM_JIRA_MARKER}: Priya Patel updated [${JIRA_ISSUE_KEY}](${JIRA_SITE}/browse/${JIRA_ISSUE_KEY}).\n\n- priority: Medium → Highest`,
    });
    expect(trace.requests).toEqual([]);
    expect(trace.logs).toEqual([
      `✅ Noted the changes to Jira issue ${JIRA_ISSUE_KEY} on ${INCIDENT_NUMBER}.`,
    ]);
  });

  test("adding only the link labels is not worth a note", async () => {
    const trace: SimulationTrace = await runIssueChanges({
      event: jiraIssueUpdatedEvent({
        labels: LINKED_LABELS,
        items: [
          changelogItem({
            field: "labels",
            fromString: "",
            toString: LINKED_LABELS.join(" "),
          }),
        ],
      }),
    });

    expect(trace.databaseCalls).toEqual([]);
    expect(trace.logs).toEqual([
      `ℹ️ Nothing that changed on Jira issue ${JIRA_ISSUE_KEY} is worth a note.`,
    ]);
  });

  test("a status change is left to the status template", async () => {
    const trace: SimulationTrace = await runIssueChanges({
      event: jiraIssueUpdatedEvent({
        labels: LINKED_LABELS,
        items: RESOLVED_CHANGELOG,
        status: DONE,
      }),
    });

    expect(trace.databaseCalls).toEqual([]);
    expect(trace.logs).toEqual([
      `ℹ️ Nothing that changed on Jira issue ${JIRA_ISSUE_KEY} is worth a note.`,
    ]);
  });

  // Dragging an issue on a board changes Rank, which Jira reports under its custom field id.
  test("a Rank change, sent as customfield_10019, is not worth a note", async () => {
    const trace: SimulationTrace = await runIssueChanges({
      event: jiraIssueUpdatedEvent({
        labels: LINKED_LABELS,
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
    expect(trace.logs).toEqual([
      `ℹ️ Nothing that changed on Jira issue ${JIRA_ISSUE_KEY} is worth a note.`,
    ]);
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
describe("simulated: the templates do not echo each other", () => {
  type RunCreateIssueFunction = () => Promise<SimulationTrace>;

  const runCreateIssue: RunCreateIssueFunction =
    async (): Promise<SimulationTrace> => {
      return await runTemplate({
        templateId: "jira-create-issue-for-incident",
        trigger: onRecord(incidentModel()),
        jira: jiraRoutes({ [CREATE_ISSUE]: ISSUE_CREATED }),
      });
    };

  type RunDeclareFunction = () => Promise<SimulationTrace>;

  const runDeclare: RunDeclareFunction = async (): Promise<SimulationTrace> => {
    return await runTemplate({
      templateId: "jira-declare-incident-from-issue",
      trigger: webhookDelivery(jiraIssueCreatedEvent()),
      jira: declareJira(),
      database: DECLARE_DATABASE,
    });
  };

  type AddedLabelsOfFunction = (trace: SimulationTrace) => Array<string>;

  /** The labels the declare template's PUT added to the issue. */
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

  type RunNoteToCommentFunction = (
    templateId: string,
    note: JSONObject,
  ) => Promise<SimulationTrace>;

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

  test("(a) the issue OneUptime files comes back as issue_created, and declares no second incident", async () => {
    const created: SimulationTrace = await runCreateIssue();
    const fields: JSONObject = (created.requests[0]!.body as JSONObject)[
      "fields"
    ] as JSONObject;

    const echo: SimulationTrace = await runTemplate({
      templateId: "jira-declare-incident-from-issue",
      trigger: webhookDelivery(
        jiraIssueCreatedEvent({
          summary: fields["summary"] as string,
          labels: fields["labels"] as Array<string>,
          description: wikiTextOf(fields["description"]),
          reporter: AUTOMATION_USER,
          user: AUTOMATION_USER,
        }),
      ),
      jira: declareJira({ labels: fields["labels"] as Array<string> }),
      database: DECLARE_DATABASE,
    });

    // The payload's own labels stop it, before Jira is asked anything.
    expect(echo.ports["if-declare-1"]).toBe("no");
    expect(metadataIdsOf(echo)).not.toContain("incident-create-one");
    expect(echo.requests).toEqual([]);
    expect(echo.logs).toEqual([
      `ℹ️ Jira issue ${JIRA_ISSUE_KEY} is already linked to OneUptime, so no incident was declared.`,
    ]);
  });

  /*
   * The same echo when the payload does not show the labels — a delivery
   * built before they were set, or one somebody forged. The labels OneUptime
   * filed the issue with are still what Jira returns, and they stop it.
   */
  test("(a') the same issue_created without its labels in the payload is stopped by the labels Jira returns", async () => {
    const created: SimulationTrace = await runCreateIssue();
    const fields: JSONObject = (created.requests[0]!.body as JSONObject)[
      "fields"
    ] as JSONObject;

    const echo: SimulationTrace = await runTemplate({
      templateId: "jira-declare-incident-from-issue",
      trigger: webhookDelivery(
        jiraIssueCreatedEvent({
          summary: fields["summary"] as string,
          labels: [],
          description: wikiTextOf(fields["description"]),
          reporter: AUTOMATION_USER,
          user: AUTOMATION_USER,
        }),
      ),
      jira: declareJira({ labels: fields["labels"] as Array<string> }),
      database: DECLARE_DATABASE,
    });

    expect(echo.ports["if-declare-1"]).toBe("yes");
    expect(echo.ports["if-unlinked-1"]).toBe("no");
    expect(metadataIdsOf(echo)).toEqual(["incident-severity-find-many"]);
    expect(echo.requests).toEqual([GET_LABELS_REQUEST]);
    expect(echo.logs).toEqual([
      `ℹ️ Jira issue ${JIRA_ISSUE_KEY} is already linked to OneUptime, so no incident was declared.`,
    ]);
  });

  test("(b) the incident declared from Jira comes back through incident-on-create, and files no second issue", async () => {
    const declared: SimulationTrace = await runDeclare();
    const json: JSONObject = jsonOf(declared, "incident-create-one");

    const echo: SimulationTrace = await runTemplate({
      templateId: "jira-create-issue-for-incident",
      trigger: onRecord(
        incidentModel({
          _id: NEW_INCIDENT_ID,
          title: json["title"] as string,
          description: json["description"] as string,
          customFields: json["customFields"] as JSONObject,
        }),
      ),
      jira: jiraRoutes({ [CREATE_ISSUE]: ISSUE_CREATED }),
    });

    expect(echo.requests).toEqual([]);
    expect(echo.logs).toEqual([
      `ℹ️ ${INCIDENT_NUMBER} was declared from Jira issue ${JIRA_ISSUE_KEY}, so no new issue was created.`,
    ]);
  });

  test.each([
    ["jira-comment-from-private-note"],
    ["jira-comment-from-public-note"],
  ])(
    "(c) %s: the comment it posts comes back as comment_created, and writes no note",
    async (templateId: string) => {
      const posted: SimulationTrace = await runNoteToComment(
        templateId,
        noteModel(),
      );
      const comment: JSONObject = postedCommentOf(posted);

      // As the webhook really carries it (wiki markup), and as ADF, in case a site sends that.
      for (const body of [wikiTextOf(comment), comment]) {
        const echo: SimulationTrace = await runComment({
          event: jiraCommentEvent({ body: body, author: AUTOMATION_USER }),
        });

        expect(echo.requests).toEqual([]);
        expect(echo.databaseCalls).toEqual([]);
        expect(echo.logs).toEqual([
          "ℹ️ This comment was posted by OneUptime, so it was not copied back.",
        ]);
      }
    },
  );

  test("(d) the note a Jira comment becomes fires the private note trigger, and posts no comment back", async () => {
    const noted: SimulationTrace = await runComment({
      event: jiraCommentEvent(),
    });
    const note: JSONObject = jsonOf(noted, "incident-internal-note-create-one");

    const echo: SimulationTrace = await runNoteToComment(
      "jira-comment-from-private-note",
      noteModel({ note: note["note"] as string, authorName: null }),
    );

    expect(echo.requests).toEqual([searchRequest(["key", "summary"])]);
    expect(echo.logs).toEqual([
      "ℹ️ This note came from Jira, so it was not posted back.",
    ]);
  });

  test("(e) the note an issue change becomes posts no comment back", async () => {
    const noted: SimulationTrace = await runIssueChanges({
      event: jiraIssueUpdatedEvent({
        labels: LINKED_LABELS,
        items: [
          changelogItem({
            field: "assignee",
            fromString: null,
            toString: "Marco Rossi",
          }),
        ],
      }),
    });
    const note: JSONObject = jsonOf(noted, "incident-internal-note-create-one");

    const echo: SimulationTrace = await runNoteToComment(
      "jira-comment-from-private-note",
      noteModel({ note: note["note"] as string, authorName: null }),
    );

    expect(echo.requests).toEqual([searchRequest(["key", "summary"])]);
    expect(echo.logs).toEqual([
      "ℹ️ This note came from Jira, so it was not posted back.",
    ]);
  });

  test("(f) the comment an incident edit posts comes back as comment_created, and writes no note", async () => {
    const posted: SimulationTrace = await runTemplate({
      templateId: "jira-comment-on-incident-update",
      trigger: onRecord(
        incidentModel({ rootCause: "A bad deploy of the payments service." }),
      ),
      jira: jiraRoutes({
        [SEARCH]: ok(jiraSearchResponse()),
        [COMMENT]: COMMENT_CREATED,
      }),
    });

    const echo: SimulationTrace = await runComment({
      event: jiraCommentEvent({
        body: wikiTextOf(postedCommentOf(posted)),
        author: AUTOMATION_USER,
      }),
    });

    expect(echo.requests).toEqual([]);
    expect(echo.databaseCalls).toEqual([]);
    expect(echo.logs).toEqual([
      "ℹ️ This comment was posted by OneUptime, so it was not copied back.",
    ]);
  });

  test("(g) resolving in OneUptime moves the issue to Done, and the issue_updated that follows changes nothing", async () => {
    const transitioned: SimulationTrace = await runTemplate({
      templateId: "jira-transition-issue-on-incident-state",
      trigger: onRecord(incidentModel({ state: RESOLVED_STATE })),
      jira: jiraRoutes({
        [SEARCH]: ok(jiraSearchResponse()),
        [TRANSITION]: NO_CONTENT,
      }),
    });

    // Where the transition it chose leads is the issue's new status.
    const transitionId: string = (
      (transitioned.requests[1]!.body as JSONObject)["transition"] as JSONObject
    )["id"] as string;
    const taken: JSONObject | undefined = (
      (jiraSearchResponse()["issues"] as Array<JSONObject>)[0]![
        "transitions"
      ] as Array<JSONObject>
    ).find((transition: JSONObject) => {
      return transition["id"] === transitionId;
    });

    expect(taken).toBeDefined();
    expect(taken!["to"]).toEqual(DONE);

    const event: JSONObject = jiraIssueUpdatedEvent({
      items: RESOLVED_CHANGELOG,
      labels: LINKED_LABELS,
      status: taken!["to"] as JSONObject,
      user: AUTOMATION_USER,
    });

    const status: SimulationTrace = await runTemplate({
      templateId: "jira-status-to-incident-state",
      trigger: webhookDelivery(event),
      database: statusDatabase(incidentRecord(RESOLVED_STATE)),
    });

    expect(metadataIdsOf(status)).not.toContain(
      "incident-state-timeline-create-one",
    );
    expect(status.logs).toEqual([
      `ℹ️ ${INCIDENT_NUMBER} is already Resolved, so Jira issue ${JIRA_ISSUE_KEY} moving to Done changes nothing.`,
    ]);

    // The same delivery reaches the issue-changes template, which leaves status to the one above.
    const changes: SimulationTrace = await runIssueChanges({ event: event });

    expect(changes.databaseCalls).toEqual([]);
  });

  test("(h) resolving from Jira fires incident-on-update, which finds the issue already Done and moves nothing", async () => {
    const resolved: SimulationTrace = await runTemplate({
      templateId: "jira-status-to-incident-state",
      trigger: webhookDelivery(
        jiraIssueUpdatedEvent({
          items: RESOLVED_CHANGELOG,
          labels: LINKED_LABELS,
          status: DONE,
        }),
      ),
      database: statusDatabase(incidentRecord(ACKNOWLEDGED_STATE)),
    });

    const row: JSONObject = jsonOf(
      resolved,
      "incident-state-timeline-create-one",
    );
    const newState: JSONObject | undefined = INCIDENT_STATES.find(
      (state: JSONObject) => {
        return state["_id"] === row["incidentStateId"];
      },
    );

    expect(newState).toBeDefined();

    const echo: SimulationTrace = await runTemplate({
      templateId: "jira-transition-issue-on-incident-state",
      trigger: onRecord(
        incidentModel({
          _id: row["incidentId"] as string,
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

    expect(echo.requests).toEqual([searchRequest(["key", "status"], true)]);
    expect(echo.logs).toEqual([
      `ℹ️ Jira issue ${JIRA_ISSUE_KEY} is already Done.`,
    ]);
  });

  test("(i) the link labels the declare template adds come back as issue_updated, and write nothing", async () => {
    const declared: SimulationTrace = await runDeclare();
    const added: Array<string> = addedLabelsOf(declared);

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

    const changes: SimulationTrace = await runIssueChanges({ event: event });

    expect(changes.databaseCalls).toEqual([]);
    expect(changes.logs).toEqual([
      `ℹ️ Nothing that changed on Jira issue ${JIRA_ISSUE_KEY} is worth a note.`,
    ]);

    const status: SimulationTrace = await runTemplate({
      templateId: "jira-status-to-incident-state",
      trigger: webhookDelivery(event),
      database: statusDatabase(incidentRecord(ACKNOWLEDGED_STATE)),
    });

    expect(status.databaseCalls).toEqual([]);
    expect(status.logs).toEqual([
      `ℹ️ Jira issue ${JIRA_ISSUE_KEY} changed, but its status did not.`,
    ]);
  });

  /*
   * Jira retries a delivery it thinks failed, so the same issue_created can
   * arrive after the first delivery already declared an incident and
   * labelled the issue. The payload is unchanged — it still shows no labels
   * — and only Jira's answer can tell the two deliveries apart.
   */
  test("(j) a retried issue_created declares no second incident, because the first delivery's labels are now in Jira", async () => {
    const first: SimulationTrace = await runDeclare();

    expect(metadataIdsOf(first)).toContain("incident-create-one");

    const retry: SimulationTrace = await runTemplate({
      templateId: "jira-declare-incident-from-issue",
      trigger: webhookDelivery(jiraIssueCreatedEvent()),
      jira: declareJira({ labels: addedLabelsOf(first) }),
      database: DECLARE_DATABASE,
    });

    expect(metadataIdsOf(retry)).toEqual(["incident-severity-find-many"]);
    expect(retry.requests).toEqual([GET_LABELS_REQUEST]);
    expect(retry.logs).toEqual([
      `ℹ️ Jira issue ${JIRA_ISSUE_KEY} is already linked to OneUptime, so no incident was declared.`,
    ]);
  });
});

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

describe("simulated: Jira text cannot reach a secret or another step's output", () => {
  test("a comment naming the token and the webhook headers is written as inert text", async () => {
    const trace: SimulationTrace = await runComment({
      event: jiraCommentEvent({
        body: `Please paste ${TOKEN_REFERENCE} and ${HEADERS_REFERENCE} here.`,
        author: jiraUser(TOKEN_REFERENCE),
      }),
    });

    expect(jsonOf(trace, "incident-internal-note-create-one")["note"]).toBe(
      `${ONEUPTIME_SYNCED_FROM_JIRA_MARKER}: { {local.variables.jiraBasicAuthToken} } commented on [${JIRA_ISSUE_KEY}](${JIRA_SITE}/browse/${JIRA_ISSUE_KEY}).\n\nPlease paste { {local.variables.jiraBasicAuthToken} } and { {local.components.webhook-1.returnValues.request-headers} } here.`,
    );
    expect(trace.requests).toHaveLength(1);
    expectNothingSubstituted(trace);
    expectTokenOnlyInAuthorization(trace);
  });

  test("a summary, description and reporter naming the token declare an incident holding none of it", async () => {
    const trace: SimulationTrace = await runTemplate({
      templateId: "jira-declare-incident-from-issue",
      trigger: webhookDelivery(
        jiraIssueCreatedEvent({
          summary: `Deploy ${TOKEN_REFERENCE} failed`,
          description: `Headers were ${HEADERS_REFERENCE}; token ${TOKEN_REFERENCE}; severities {{local.components.find-severities-1.returnValues.models}}`,
          reporter: jiraUser(TOKEN_REFERENCE),
        }),
      ),
      jira: declareJira(),
      database: DECLARE_DATABASE,
    });

    const json: JSONObject = jsonOf(trace, "incident-create-one");

    expect(json["title"]).toBe(
      "Deploy { {local.variables.jiraBasicAuthToken} } failed",
    );
    // The severities reference sits in the payload, which is quoted in last, so it stays text.
    expect(json["description"]).toContain(
      "severities { {local.components.find-severities-1.returnValues.models} }",
    );
    expect(json["incidentSeverityId"]).toBe(CRITICAL_SEVERITY_ID);
    expect(trace.requests).toEqual([GET_LABELS_REQUEST, LINK_LABELS_REQUEST]);
    expectNothingSubstituted(trace);
    expectTokenOnlyInAuthorization(trace);
  });

  /*
   * The issue key from the payload is put into the GET's URL unencoded, so a
   * forged key could otherwise point the credentials at any Jira endpoint.
   */
  test.each([
    ["OPS-17/../../../myself"],
    ["OPS-17?expand=renderedFields#"],
    ["../../../rest/api/3/user/search?query=a"],
  ])(
    "a forged issue key %s sends no request with the credentials",
    async (issueKey: string) => {
      const trace: SimulationTrace = await runTemplate({
        templateId: "jira-declare-incident-from-issue",
        trigger: webhookDelivery(jiraIssueCreatedEvent({ key: issueKey })),
        jira: declareJira(),
        database: DECLARE_DATABASE,
      });

      expect(trace.requests).toEqual([]);
      expect(metadataIdsOf(trace)).toEqual(["incident-severity-find-many"]);
      expect(trace.logs).toEqual([
        "ℹ️ The event did not name a Jira issue key.",
      ]);
    },
  );

  /*
   * A skip reason is logged by substituting it into a Log step, so it is held
   * to the same rule as any other text from Jira: here a status name, which
   * Jira admins choose.
   */
  test("a Jira status named like a reference is quoted inertly in the reason a transition was skipped", async () => {
    const trace: SimulationTrace = await runTemplate({
      templateId: "jira-transition-issue-on-incident-state",
      trigger: onRecord(incidentModel({ state: RESOLVED_STATE })),
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

    expect(trace.requests).toEqual([searchRequest(["key", "status"], true)]);
    expect(trace.logs).toEqual([
      `ℹ️ Jira issue ${JIRA_ISSUE_KEY} has no transition from { {local.variables.jiraBasicAuthToken} } to a Done status that can be chosen without naming it in STATE_TO_JIRA_STATUS.`,
    ]);
    expectNothingSubstituted(trace);
    expectTokenOnlyInAuthorization(trace);
  });

  // The transition's id is Jira's text too, and it is quoted into the request body.
  test("a transition id named like a reference is sent as inert text", async () => {
    const trace: SimulationTrace = await runTemplate({
      templateId: "jira-transition-issue-on-incident-state",
      trigger: onRecord(incidentModel({ state: RESOLVED_STATE })),
      jira: jiraRoutes({
        [SEARCH]: ok(
          jiraSearchResponse({
            transitions: [
              jiraTransition({ id: TOKEN_REFERENCE, name: "Close", to: DONE }),
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
    const trace: SimulationTrace = await runIssueChanges({
      event: jiraIssueUpdatedEvent({
        labels: LINKED_LABELS,
        user: jiraUser(HEADERS_REFERENCE),
        items: [
          changelogItem({
            field: "summary",
            fromString: "Checkout API returns 502",
            toString: `Leak ${TOKEN_REFERENCE} and {{local.components.find-incident-1.returnValues.model}}`,
          }),
        ],
      }),
    });

    const note: string = jsonOf(trace, "incident-internal-note-create-one")[
      "note"
    ] as string;

    expect(note).toContain(
      "- summary: Checkout API returns 502 → Leak { {local.variables.jiraBasicAuthToken} } and { {local.components.find-incident-1.returnValues.model} }",
    );
    expectNothingSubstituted(trace);
  });

  /*
   * Jira users choose their own display names, and the status template quotes
   * the event its first script returns — which carries that name — into the
   * next script's arguments BEFORE the incident and the states. A name that is
   * a reference to one of those later values would be substituted in its
   * place, leaving the real reference unresolved. The helper block's rule —
   * text from the other system is defused before it is returned — is what is
   * supposed to prevent that.
   */
  test.each([
    ["{{local.components.find-states-1.returnValues.models}}"],
    ["{{local.components.find-incident-1.returnValues.model}}"],
  ])(
    "a Jira user named %s still resolves the incident",
    async (displayName: string) => {
      const trace: SimulationTrace = await runTemplate({
        templateId: "jira-status-to-incident-state",
        trigger: webhookDelivery(
          jiraIssueUpdatedEvent({
            items: RESOLVED_CHANGELOG,
            labels: LINKED_LABELS,
            status: DONE,
            user: jiraUser(displayName),
          }),
        ),
        database: statusDatabase(incidentRecord(ACKNOWLEDGED_STATE)),
      });

      expect(trace.logs).toEqual([
        `✅ Moved ${INCIDENT_NUMBER} to Resolved because Jira issue ${JIRA_ISSUE_KEY} is now Done.`,
      ]);
      expect(jsonOf(trace, "incident-state-timeline-create-one")).toEqual({
        incidentId: INCIDENT_ID,
        incidentStateId: RESOLVED_STATE_ID,
        rootCause: `${ONEUPTIME_SYNCED_FROM_JIRA_MARKER}: issue ${JIRA_ISSUE_KEY} moved to Done by ${displayName.split("{{").join("{ {").split("}}").join("} }")}.`,
      });
      expectNothingSubstituted(trace);
    },
  );

  /*
   * The same rule for the other direction: the transition template returns
   * the name of the status it moves the issue to, and the success log quotes
   * that name before the script's own reason.
   */
  test("a Jira status named like a reference is logged as text, not substituted", async () => {
    const trickStatus: JSONObject = jiraStatus({
      name: "{{local.components.plan-transition-1.returnValues.returnValue.reason}}",
      categoryKey: "done",
      id: "10099",
    });

    const trace: SimulationTrace = await runTemplate({
      templateId: "jira-transition-issue-on-incident-state",
      trigger: onRecord(incidentModel({ state: RESOLVED_STATE })),
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
      `✅ Moved Jira issue ${JIRA_ISSUE_KEY} to { {local.components.plan-transition-1.returnValues.returnValue.reason} }. ${INCIDENT_NUMBER} is Resolved in OneUptime.`,
    ]);
  });

  test("OneUptime text naming the token is posted to Jira as inert text", async () => {
    const trace: SimulationTrace = await runTemplate({
      templateId: "jira-comment-from-private-note",
      trigger: onRecord(
        noteModel({ note: `Rotate ${TOKEN_REFERENCE} after this.` }),
      ),
      jira: jiraRoutes({
        [SEARCH]: ok(jiraSearchResponse()),
        [COMMENT]: COMMENT_CREATED,
      }),
    });

    expect(trace.requests).toHaveLength(2);
    expect(JSON.stringify(trace.requests[1]!.body)).toContain(
      "Rotate { {local.variables.jiraBasicAuthToken} } after this.",
    );
    expectNothingSubstituted(trace);
    expectTokenOnlyInAuthorization(trace);
  });

  /*
   * Every path that talks to Jira, run once each: the token must ride in the
   * Authorization header of every request, as Basic auth, and turn up nowhere
   * else — including in failure logs that print Jira's response.
   */
  test("the token is in every request's Authorization header and nowhere else in any trace", async () => {
    const traces: Array<SimulationTrace> = [
      await runTemplate({
        templateId: "jira-create-issue-for-incident",
        trigger: onRecord(incidentModel()),
        jira: jiraRoutes({ [CREATE_ISSUE]: ISSUE_CREATED }),
      }),
      await runTemplate({
        templateId: "jira-create-issue-for-incident",
        trigger: onRecord(incidentModel()),
        jira: jiraRoutes({
          [CREATE_ISSUE]: badRequest({
            errorMessages: ["Unauthorized"],
            errors: {},
          }),
        }),
      }),
      await runTemplate({
        templateId: "jira-transition-issue-on-incident-state",
        trigger: onRecord(incidentModel({ state: ACKNOWLEDGED_STATE })),
        jira: jiraRoutes({
          [SEARCH]: ok(jiraSearchResponse()),
          [TRANSITION]: NO_CONTENT,
        }),
      }),
      await runTemplate({
        templateId: "jira-transition-issue-on-incident-state",
        trigger: onRecord(incidentModel({ state: ACKNOWLEDGED_STATE })),
        jira: jiraRoutes({
          [SEARCH]: { status: 401, body: "Unauthorized" },
        }),
      }),
      await runTemplate({
        templateId: "jira-comment-from-private-note",
        trigger: onRecord(noteModel()),
        jira: jiraRoutes({
          [SEARCH]: ok(jiraSearchResponse()),
          [COMMENT]: COMMENT_CREATED,
        }),
      }),
      await runTemplate({
        templateId: "jira-comment-from-public-note",
        trigger: onRecord(noteModel()),
        jira: jiraRoutes({
          [SEARCH]: ok(jiraSearchResponse()),
          [COMMENT]: { status: 403, body: { errorMessages: ["Forbidden"] } },
        }),
      }),
      await runTemplate({
        templateId: "jira-comment-on-incident-update",
        trigger: onRecord(incidentModel()),
        jira: jiraRoutes({
          [SEARCH]: ok(jiraSearchResponse()),
          [COMMENT]: COMMENT_CREATED,
        }),
      }),
      await runTemplate({
        templateId: "jira-declare-incident-from-issue",
        trigger: webhookDelivery(jiraIssueCreatedEvent()),
        jira: declareJira(),
        database: DECLARE_DATABASE,
      }),
      await runTemplate({
        templateId: "jira-declare-incident-from-issue",
        trigger: webhookDelivery(jiraIssueCreatedEvent()),
        jira: declareJira({ labels: LINKED_LABELS }),
        database: DECLARE_DATABASE,
      }),
      await runTemplate({
        templateId: "jira-declare-incident-from-issue",
        trigger: webhookDelivery(jiraIssueCreatedEvent()),
        jira: declareJira({
          getIssue: {
            status: 404,
            body: { errorMessages: ["Issue does not exist"], errors: {} },
          },
        }),
        database: DECLARE_DATABASE,
      }),
      await runTemplate({
        templateId: "jira-declare-incident-from-issue",
        trigger: webhookDelivery(jiraIssueCreatedEvent()),
        jira: declareJira({
          edit: badRequest({ errorMessages: [], errors: { labels: "No." } }),
        }),
        database: DECLARE_DATABASE,
      }),
      await runComment({ event: jiraCommentEvent() }),
      await runTemplate({
        templateId: "jira-comment-to-private-note",
        trigger: webhookDelivery(jiraCommentEvent()),
        jira: jiraRoutes({
          [GET_LABELS]: {
            status: 404,
            body: { errorMessages: ["Issue does not exist"] },
          },
        }),
      }),
    ];

    const requestCount: number = traces.reduce(
      (count: number, trace: SimulationTrace) => {
        return count + trace.requests.length;
      },
      0,
    );

    // Every template that talks to Jira is represented, successes and failures both.
    expect(requestCount).toBe(19);

    // ...and so is every Jira endpoint any of them calls, the declare template's GET included.
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
      expect(trace.requests.length).toBeGreaterThan(0);
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
});
