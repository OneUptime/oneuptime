/*
 * Runs a built workflow template end to end, for the template simulation
 * suites.
 *
 * The script tests prove that each script decides correctly given its
 * arguments. What they cannot prove is that the arguments the runner hands a
 * script are the ones it expects, that an If / Else reads the value the
 * script returned, that a request body is still valid JSON after
 * substitution, or that two templates chained together settle instead of
 * echoing each other forever. Those are properties of a whole graph, so this
 * runs whole graphs.
 *
 * It walks a template the way RunWorkflow does: the arguments are resolved by
 * the same substitution, one step runs at a time in FIFO order, and each
 * step's return values are stored where the next step's references look for
 * them. What is real and what is faked is deliberate:
 *
 *   - Real: VMAPI substitution, the JavaScript component in the isolated-vm
 *     sandbox, the If / Else and Switch / Case components, the Log component, the API
 *     components themselves — sanitizeArgs, URL parsing, HTTPResponse and the
 *     choice of port included — the Slack component, which posts the
 *     message's blocks through the same API.fetch, and the four Page steps:
 *     their settings read, the page they ask for and the output they take.
 *     The paging itself (OnCallPageService.page) is the suite's to stand in
 *     for: it is a database from end to end.
 *   - Faked: the other system, at API.fetch, the one function every API
 *     component and the Slack component send through; the database, per
 *     step, by component id; and one DNS lookup (stubDnsLookups), so the
 *     SSRF check the API components run stays offline.
 *   - With a world (Scenario.world, TemplateWorld): one project held in
 *     memory instead of answers per step. The database steps then run for
 *     real against its tables - Find One, Find Many, Create One, as the
 *     registry builds them - and so do Incident and Alert From Another Tool.
 *     That is how a template and the one it replaced are run against the
 *     same project (the *TemplateEquivalence suites).
 *   - Real as well: Check With JavaScript, API Get By ID and Update Zabbix
 *     Problem, the steps the simple templates are built from.
 *
 * The Jira suite keeps a copy of its own, written before this one. Not a test
 * file itself (jest only collects *.test.ts).
 */

import {
  getWorkflowTemplate,
  buildGraphForTemplate,
} from "../../../Types/Workflow/Templates";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
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
import Switch from "../../../Server/Types/Workflow/Components/Conditions/Switch";
import Log from "../../../Server/Types/Workflow/Components/Log";
import ApiGet from "../../../Server/Types/Workflow/Components/API/Get";
import ApiPost from "../../../Server/Types/Workflow/Components/API/Post";
import ApiPut from "../../../Server/Types/Workflow/Components/API/Put";
import ApiPatch from "../../../Server/Types/Workflow/Components/API/Patch";
import ApiDelete from "../../../Server/Types/Workflow/Components/API/Delete";
import SlackSendMessageToChannel from "../../../Server/Types/Workflow/Components/Slack/SendMessageToChannel";
import Page from "../../../Server/Types/Workflow/Components/OnCall/Page";
import JavaScriptCheck from "../../../Server/Types/Workflow/Components/JavaScriptCheck";
import ApiGetById from "../../../Server/Types/Workflow/Components/API/GetById";
import ZabbixUpdateProblem from "../../../Server/Types/Workflow/Components/Zabbix/UpdateProblem";
import RecordFromAnotherTool, {
  ALERT_RECORD_MODEL,
  INCIDENT_RECORD_MODEL,
} from "../../../Server/Types/Workflow/Components/FromAnotherTool/RecordFromAnotherTool";
import FindOneBaseModel from "../../../Server/Types/Workflow/Components/BaseModel/FindOneBaseModel";
import FindManyBaseModel from "../../../Server/Types/Workflow/Components/BaseModel/FindManyBaseModel";
import CreateOneBaseModel from "../../../Server/Types/Workflow/Components/BaseModel/CreateOneBaseModel";
import DatabaseService from "../../../Server/Services/DatabaseService";
import {
  ALERT_FROM_ANOTHER_TOOL,
  INCIDENT_FROM_ANOTHER_TOOL,
} from "../../../Types/Workflow/Components/FromAnotherTool";
import TemplateWorld from "./TemplateWorld";
import { isUnhandledStepFailure } from "../../../Types/Workflow/UnhandledStepFailure";
import { FakeTable } from "../../Server/Types/Workflow/Components/FromAnotherToolFakes";
import { jest } from "@jest/globals";
import dns from "dns";

/* ------------------------------- The graph ------------------------------- */

/*
 * The MERGED registry: the database components (incident-find-one,
 * alert-state-timeline-create-one, ...) only exist there, and a node without
 * metadata has no arguments to resolve.
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
  /** componentId -> port id -> the component ids its edges lead to. */
  outPorts: Dictionary<Dictionary<Array<string>>>;
}

let generatedIdCounter: number = 0;

type GenerateIdFunction = () => string;

const generateId: GenerateIdFunction = (): string => {
  generatedIdCounter++;
  return `simulated-${generatedIdCounter}`;
};

type BuildSimulatedGraphFunction = (
  templateId: string,
  builtGraph?: JSONObject | undefined,
) => SimulatedGraph;

/*
 * Built through buildGraphForTemplate, the path the create wizard takes, so
 * the simulation runs the graph a user actually gets — not the spec behind it.
 * Or, for a workflow made some other way (a Huntress connection moved to a
 * workflow), the graph that was built for it.
 */
const buildSimulatedGraph: BuildSimulatedGraphFunction = (
  templateId: string,
  builtGraph?: JSONObject | undefined,
): SimulatedGraph => {
  const graph: JSONObject | null =
    builtGraph || buildGraphForTemplate(templateId, generateId);

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

/* -------------------------- Argument resolution -------------------------- */

/** RunWorkflow's StorageMap, which lives in the App package. */
export interface StorageMap {
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
 * A copy of RunWorkflow.getComponentArguments, kept step for step: falsy
 * values are skipped; VMAPI.replaceValueInPlace substitutes, writing each
 * value as JSON for a JSON, Query or Select argument - escaped inside quotes,
 * the value itself on its own - (an object-valued argument is stringified,
 * substituted with escaping and parsed back); and a string left for one of
 * those three is parsed, with a template that built invalid JSON failing the
 * run — and the test — the way it fails the runner.
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
      PARSED_ARGUMENT_TYPES.includes(argument.type),
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

export interface SimulatedRequest {
  method: string;
  url: string;
  headers: Dictionary<string>;
  body?: JSONValue | undefined;
}

export interface SimulatedReply {
  status: number;
  /** A string is a body that is not JSON: a 204's empty one, or a plain-text error. */
  body: JSONObject | Array<JSONObject> | string;
  headers?: Dictionary<string> | undefined;
}

export type FakeHttpFunction = (request: SimulatedRequest) => SimulatedReply;

export interface DatabaseCall {
  componentId: string;
  metadataId: string;
  args: JSONObject;
}

export interface DatabaseReply {
  port: "success" | "error";
  returnValues: JSONObject;
}

export type DatabaseAnswer =
  | DatabaseReply
  | ((call: DatabaseCall) => DatabaseReply);

/** Keyed by the step's metadata id, e.g. "incident-find-one" or "alert-find-one". */
export type FakeDatabase = Dictionary<DatabaseAnswer>;

export type EditCodeFunction = (code: string) => string;

export interface Scenario {
  templateId: string;
  /** What the trigger hands over: { model } from a database trigger, the delivery from the webhook. */
  trigger: JSONObject;
  /** The workflow's variables, by name, as the run resolves them. */
  variables: Dictionary<string>;
  http?: FakeHttpFunction | undefined;
  database?: FakeDatabase | undefined;
  /*
   * Edits a step's script before the run, keyed by component id — what a
   * user following the script's own comments would do.
   */
  editCode?: Dictionary<EditCodeFunction> | undefined;
  /*
   * Settings filled in before the run, keyed by component id — what the
   * person who created the workflow picks in the builder, such as who a
   * Page step pages. Laid over what the template set.
   */
  settings?: Dictionary<JSONObject> | undefined;
  /*
   * A graph built some other way than from the template, such as a Huntress
   * connection's (Templates.buildHuntressIncidentWorkflowGraph with its
   * settings): run in place of the template's. templateId still names it.
   */
  graph?: JSONObject | undefined;
  /*
   * One project held in memory: the database steps run for real against
   * it, and so do Incident and Alert From Another Tool, instead of the
   * answers in `database`.
   */
  world?: TemplateWorld | undefined;
}

export interface SimulationTrace {
  templateId: string;
  /** Component ids, in the order they ran. */
  executed: Array<string>;
  /** The port each step left by. */
  ports: Dictionary<string | null>;
  requests: Array<SimulatedRequest>;
  databaseCalls: Array<DatabaseCall>;
  /** The resolved value of every Log step. */
  logs: Array<string>;
  /** What the components themselves wrote to the run log. */
  runLog: Array<string>;
  /*
   * The steps that failed with nothing connected to their Error output,
   * which fail the run (UnhandledStepFailure), in the order they ran.
   */
  failedSteps: Array<string>;
  // Why each of them failed, as its Steps entry says it: by component id.
  portReasons: Dictionary<string>;
  storage: StorageMap;
}

/* Find One answers "nothing matched" with a null model on its Success port, not an error. */
export const found: (model: JSONObject | null) => DatabaseReply = (
  model: JSONObject | null,
): DatabaseReply => {
  return { port: "success", returnValues: { model: model } };
};

export const many: (models: Array<JSONObject>) => DatabaseReply = (
  models: Array<JSONObject>,
): DatabaseReply => {
  return { port: "success", returnValues: { models: models } };
};

/* Create One hands back the saved row: the posted fields plus the id the database gave it. */
export const createdWithId: (id: string) => DatabaseAnswer = (
  id: string,
): DatabaseAnswer => {
  return (call: DatabaseCall): DatabaseReply => {
    return {
      port: "success",
      returnValues: {
        model: { ...(call.args["json"] as JSONObject), _id: id },
      },
    };
  };
};

/* A failed database step takes its Error port with nothing in its return values. */
export const DATABASE_FAILURE: DatabaseReply = {
  port: "error",
  returnValues: {},
};

/* ------------------------------ The runner ------------------------------ */

/* Components the simulation runs for real, the way RunWorkflow's Components registry does. */
const COMPONENT_CODE: Dictionary<ComponentCode> = {
  [ComponentID.JavaScriptCode]: new JavaScriptCode(),
  [ComponentID.IfElse]: new IfElse(),
  [ComponentID.Switch]: new Switch(),
  [ComponentID.Log]: new Log(),
  [ComponentID.ApiGet]: new ApiGet(),
  [ComponentID.ApiPost]: new ApiPost(),
  [ComponentID.ApiPut]: new ApiPut(),
  [ComponentID.ApiPatch]: new ApiPatch(),
  [ComponentID.ApiDelete]: new ApiDelete(),
  [ComponentID.SlackSendMessageToChannel]: new SlackSendMessageToChannel(),
  [ComponentID.PageUsers]: new Page(ComponentID.PageUsers),
  [ComponentID.PageTeam]: new Page(ComponentID.PageTeam),
  [ComponentID.PageOnCall]: new Page(ComponentID.PageOnCall),
  [ComponentID.PageOnCallPolicy]: new Page(ComponentID.PageOnCallPolicy),
  [ComponentID.JavaScriptCheck]: new JavaScriptCheck(),
  [ComponentID.ApiGetById]: new ApiGetById(),
  [ComponentID.ZabbixUpdateProblem]: new ZabbixUpdateProblem(),
};

type WorldStepFunction = (
  metadataId: string,
  world: TemplateWorld,
) => ComponentCode | null;

/*
 * A step that works with the world's records, built as the registry builds
 * it (Server/Types/Workflow/Components/Index.ts) but on the world's tables:
 * a database step of one of its tables, or a From Another Tool step.
 */
const worldStep: WorldStepFunction = (
  metadataId: string,
  world: TemplateWorld,
): ComponentCode | null => {
  if (metadataId === ComponentID.IncidentFromAnotherTool) {
    return new RecordFromAnotherTool({
      kind: INCIDENT_FROM_ANOTHER_TOOL,
      services: world.servicesFor(metadataId),
      model: INCIDENT_RECORD_MODEL,
    });
  }

  if (metadataId === ComponentID.AlertFromAnotherTool) {
    return new RecordFromAnotherTool({
      kind: ALERT_FROM_ANOTHER_TOOL,
      services: world.servicesFor(metadataId),
      model: ALERT_RECORD_MODEL,
    });
  }

  const operation: RegExpExecArray | null = DATABASE_OPERATION.exec(metadataId);

  if (!operation) {
    return null;
  }

  const table: FakeTable | null = world.tableFor(
    metadataId.slice(0, operation.index),
  );

  if (!table) {
    throw new Error(`The world has no table for ${metadataId}.`);
  }

  const service: DatabaseService<BaseModel> =
    table as unknown as DatabaseService<BaseModel>;

  if (operation[1] === "find-one") {
    return new FindOneBaseModel(service);
  }

  if (operation[1] === "find-many") {
    return new FindManyBaseModel(service);
  }

  return new CreateOneBaseModel(service);
};

const DATABASE_OPERATION: RegExp = /-(find-one|find-many|create-one)$/;

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-2222-4333-8444-555555555555",
);

// The project every simulated workflow runs in, and the workflow it runs as.
export const SIMULATED_PROJECT_ID: ObjectID = PROJECT_ID;
export const SIMULATED_WORKFLOW_ID: ObjectID = new ObjectID(
  "22222222-3333-4444-8555-666666666666",
);
export const SIMULATED_WORKFLOW_NAME: string = "Simulated workflow";

/** Enough of a jest spy to put the real function back. */
interface RestorableSpy {
  mockRestore: () => void;
}

const NOT_FOUND: FakeHttpFunction = (
  request: SimulatedRequest,
): SimulatedReply => {
  return {
    status: 404,
    body: {
      error: {
        code: "0x80060888",
        message: `The simulation has no reply for ${request.method} ${request.url}.`,
      },
    },
  };
};

type AnswerFetchFunction = (
  options: APIFetchOptions,
  scenario: Scenario,
  trace: SimulationTrace,
) => HTTPResponse<JSONObject> | HTTPErrorResponse;

/*
 * What API.fetch resolves with on the server. Axios accepts 2xx only, and the
 * API components turn redirects off, so anything else becomes the
 * HTTPErrorResponse the API utility resolves with (never throws). A 204's
 * empty body reaches HTTPResponse as an empty string — both come from the
 * real classes here, not from a copy.
 */
const answerFetch: AnswerFetchFunction = (
  options: APIFetchOptions,
  scenario: Scenario,
  trace: SimulationTrace,
): HTTPResponse<JSONObject> | HTTPErrorResponse => {
  const request: SimulatedRequest = {
    method: options.method,
    url: options.url.toString(),
    headers: { ...(options.headers || {}) },
  };

  // Axios would send JSON.stringify(data); a JSON round trip is what arrives.
  if (options.data !== undefined) {
    request.body = JSON.parse(JSON.stringify(options.data)) as JSONValue;
  }

  trace.requests.push(request);

  const reply: SimulatedReply = (scenario.http || NOT_FOUND)(request);
  const headers: Dictionary<string> = {
    "content-type":
      typeof reply.body === "string"
        ? "text/plain;charset=UTF-8"
        : "application/json; odata.metadata=minimal",
    ...(reply.headers || {}),
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
  reason?: string | undefined;
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
     * Both leave by their only port.
     */
    if (node.metadata.outPorts.length !== 1) {
      throw new Error(`${node.metadataId} has more than one way out.`);
    }

    return {
      returnValues: data.scenario.trigger,
      port: node.metadata.outPorts[0]!.id,
    };
  }

  const inWorld: ComponentCode | null = data.scenario.world
    ? worldStep(node.metadataId, data.scenario.world)
    : null;

  if (DATABASE_OPERATION.test(node.metadataId) && !inWorld) {
    const call: DatabaseCall = {
      componentId: node.componentId,
      metadataId: node.metadataId,
      args: data.args,
    };

    data.trace.databaseCalls.push(call);

    const answer: DatabaseAnswer | undefined =
      data.scenario.database?.[node.metadataId];

    // The database is called by the simulation itself, so a surprise can fail loudly.
    if (!answer) {
      throw new Error(
        `The scenario did not expect ${node.componentId} (${node.metadataId}) to run. It was called with ${JSON.stringify(data.args)}`,
      );
    }

    const reply: DatabaseReply =
      typeof answer === "function" ? answer(call) : answer;

    return { returnValues: reply.returnValues, port: reply.port };
  }

  if (inWorld && DATABASE_OPERATION.test(node.metadataId)) {
    data.trace.databaseCalls.push({
      componentId: node.componentId,
      metadataId: node.metadataId,
      args: data.args,
    });
  }

  const code: ComponentCode | undefined =
    inWorld || COMPONENT_CODE[node.metadataId];

  if (!code) {
    throw new Error(`The simulation cannot run ${node.metadataId}.`);
  }

  if (node.metadataId === ComponentID.Log) {
    data.trace.logs.push(String(data.args["value"]));
  }

  let errorMessage: string | null = null;

  const options: RunOptions = {
    // As the runner hands them: the step's settings before substitution.
    configuredArguments: node.arguments,
    log: (item: JSONValue | Error): void => {
      data.trace.runLog.push(
        typeof item === "string" ? item : JSON.stringify(item),
      );
    },
    workflowLogId: ObjectID.generate(),
    workflowId: SIMULATED_WORKFLOW_ID,
    workflowName: SIMULATED_WORKFLOW_NAME,
    projectId: PROJECT_ID,
    getRemainingExecutionTimeInMs: (): number => {
      return 60000;
    },
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
    reason: result.executePortReason,
  };
};

export type RunTemplateFunction = (
  scenario: Scenario,
) => Promise<SimulationTrace>;

/*
 * The loop of RunWorkflow.runWorkflow in miniature: a FIFO of pending steps,
 * each run once (a second visit is the cycle error the runner raises), its
 * return values stored under local.components.<component id>, and every step
 * wired to the port it left by queued unless it already is.
 */
export const runTemplate: RunTemplateFunction = async (
  scenario: Scenario,
): Promise<SimulationTrace> => {
  if (!scenario.graph && !getWorkflowTemplate(scenario.templateId)) {
    throw new Error(`There is no template ${scenario.templateId}.`);
  }

  const graph: SimulatedGraph = buildSimulatedGraph(
    scenario.templateId,
    scenario.graph,
  );

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

  for (const componentId of Object.keys(scenario.settings || {})) {
    const node: SimulatedNode | undefined = graph.nodes[componentId];

    // A setting for a step the template does not have would prove nothing.
    if (!node) {
      throw new Error(`${scenario.templateId} has no step ${componentId}.`);
    }

    node.arguments = {
      ...node.arguments,
      ...(JSON.parse(
        JSON.stringify(
          (scenario.settings as Dictionary<JSONObject>)[componentId],
        ),
      ) as JSONObject),
    };
  }

  const trace: SimulationTrace = {
    templateId: scenario.templateId,
    executed: [],
    ports: {},
    requests: [],
    databaseCalls: [],
    logs: [],
    runLog: [],
    failedSteps: [],
    portReasons: {},
    storage: {
      local: { variables: { ...scenario.variables }, components: {} },
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

      if (result.reason) {
        trace.portReasons[componentId] = result.reason;
      }

      if (!result.port) {
        break;
      }

      const next: Array<string> =
        (graph.outPorts[componentId] as Dictionary<Array<string>>)[
          result.port
        ] || [];

      if (
        isUnhandledStepFailure({
          portId: result.port,
          connectedComponentIds: next,
        })
      ) {
        trace.failedSteps.push(componentId);
      }

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
 * The API components resolve the target host before every request, to
 * refuse internal addresses. Pin the answer to a public one so a suite stays
 * offline; which addresses are refused is ApiComponentSsrf.test.ts's concern.
 * Call it from beforeAll, and restore the mocks in afterAll.
 */
export const stubDnsLookups: (address: string) => void = (
  address: string,
): void => {
  jest
    .spyOn(dns.promises, "lookup")
    .mockResolvedValue([{ address: address, family: 4 }] as never);
};
