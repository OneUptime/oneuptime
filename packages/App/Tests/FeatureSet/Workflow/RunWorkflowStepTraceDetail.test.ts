/*
 * What the runner records for the run's Steps view to read on its own.
 *
 * The maintainer could not tell from the Steps tab which port a step took,
 * while the full log said "Executing Port: No". The view can only say what the
 * trace holds, so these pin what the runner now writes there: the port by the
 * name the canvas gives it and the steps it is wired to, the arguments' names
 * and the {{...}} they were configured with, the warnings raised while a step
 * was prepared, that a run was a test of one step, and why a run stopped when
 * no step says. And, because the trace is readable by anyone who can read the
 * log, that everything new is redacted exactly like what was there before.
 */

import Workflow from "Common/Models/DatabaseModels/Workflow";
import WorkflowVariable from "Common/Models/DatabaseModels/WorkflowVariable";
import WorkflowLogService from "Common/Server/Services/WorkflowLogService";
import WorkflowService from "Common/Server/Services/WorkflowService";
import logger from "Common/Server/Utils/Logger";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import ComponentMetadata, {
  Argument,
  ComponentInputType,
  ComponentType,
  NodeDataProp,
  NodeType,
  Port,
  ReturnValue,
} from "Common/Types/Workflow/Component";
import {
  WorkflowStepStatus,
  WorkflowStepTrace,
  WorkflowStepTraceEntry,
  parseTrace,
} from "Common/Types/Workflow/StepTrace";
import WorkflowStatus from "Common/Types/Workflow/WorkflowStatus";
import QueueWorkflow from "../../../FeatureSet/Workflow/Services/QueueWorkflow";
import RunWorkflow, {
  RunStack,
  RunStackItem,
  StorageMap,
  WORKFLOW_LOG_REDACTED_VALUE,
} from "../../../FeatureSet/Workflow/Services/RunWorkflow";
import WorkflowLog from "Common/Models/DatabaseModels/WorkflowLog";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

const WORKFLOW_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const WORKFLOW_LOG_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const PROJECT_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);

const WEBHOOK_REFERENCE: string =
  "{{local.components.webhook-1.returnValues.request-body.environment}}";

interface RecordedSpy {
  mock: { calls: Array<Array<unknown>> };
}

interface NumberSpy {
  mockReturnValue: (value: number) => unknown;
}

type RunComponentImplementation = (
  args: JSONObject,
  node: NodeDataProp,
  onError: VoidFunction,
) => Promise<unknown>;

/*
 * Ports and components shaped like the real ones, but declared here: other
 * work reshapes the real If / Else's copy, and these tests are about what the
 * runner records, not about that copy.
 */
const YES_PORT: Port = {
  id: "yes",
  title: "Yes",
  description: "Runs when the condition holds.",
};

const NO_PORT: Port = {
  id: "no",
  title: "No",
  description: "Runs when the condition does not hold.",
};

const OUT_PORT: Port = {
  id: "out",
  title: "Out",
  description: "Runs after this step.",
};

const ERROR_PORT: Port = {
  id: "error",
  title: "Error",
  description: "Runs when the step fails.",
};

type ArgumentFunction = (
  id: string,
  name: string,
  options?: { type?: ComponentInputType; isSensitive?: boolean },
) => Argument;

const argument: ArgumentFunction = (
  id: string,
  name: string,
  options?: { type?: ComponentInputType; isSensitive?: boolean },
): Argument => {
  return {
    id: id,
    name: name,
    description: name,
    type: options?.type || ComponentInputType.Text,
    required: false,
    isSensitive: options?.isSensitive,
  };
};

type ReturnValueFunction = (id: string, name: string) => ReturnValue;

const returnValue: ReturnValueFunction = (
  id: string,
  name: string,
): ReturnValue => {
  return {
    id: id,
    name: name,
    description: name,
    type: ComponentInputType.Text,
    required: false,
  };
};

const IF_ELSE: ComponentMetadata = {
  id: "if-else",
  title: "If / Else",
  category: "Conditions",
  description: "Branch",
  iconProp: IconProp.Condition,
  componentType: ComponentType.Component,
  arguments: [
    argument("input-1-type", "Input 1 Type"),
    argument("input-1", "Input 1"),
    argument("operator", "Operator"),
    argument("input-2-type", "Input 2 Type"),
    argument("input-2", "Input 2"),
  ],
  returnValues: [],
  inPorts: [],
  outPorts: [YES_PORT, NO_PORT],
};

type SimpleMetadataFunction = (params: {
  id: string;
  title: string;
  args?: Array<Argument>;
  returnValues?: Array<ReturnValue>;
  outPorts?: Array<Port>;
}) => ComponentMetadata;

const simpleMetadata: SimpleMetadataFunction = (params: {
  id: string;
  title: string;
  args?: Array<Argument>;
  returnValues?: Array<ReturnValue>;
  outPorts?: Array<Port>;
}): ComponentMetadata => {
  return {
    id: params.id,
    title: params.title,
    category: "Test",
    description: params.title,
    iconProp: IconProp.Bolt,
    componentType: ComponentType.Component,
    arguments: params.args || [],
    returnValues: params.returnValues || [],
    inPorts: [],
    outPorts: params.outPorts || [OUT_PORT],
  };
};

const SLACK: ComponentMetadata = simpleMetadata({
  id: "slack-send",
  title: "Send Message to Slack",
  args: [argument("message-text", "Message Text")],
});

const LOG: ComponentMetadata = simpleMetadata({
  id: "log",
  title: "Log",
  args: [argument("value", "Value")],
});

type NodeFunction = (
  id: string,
  metadata: ComponentMetadata,
  configured?: JSONObject,
) => NodeDataProp;

const node: NodeFunction = (
  id: string,
  metadata: ComponentMetadata,
  configured?: JSONObject,
): NodeDataProp => {
  return {
    error: "",
    id: id,
    nodeType: NodeType.Node,
    metadata: metadata,
    metadataId: metadata.id,
    internalId: `internal-${id}`,
    arguments: configured || {},
    returnValues: {},
    componentType: ComponentType.Component,
  };
};

type StackFunction = (
  items: Array<{
    node: NodeDataProp;
    outPorts?: Record<string, Array<string>>;
  }>,
) => RunStack;

/** A run stack starting at the first item, wired as each item says. */
const stackOf: StackFunction = (
  items: Array<{
    node: NodeDataProp;
    outPorts?: Record<string, Array<string>>;
  }>,
): RunStack => {
  const stack: Record<string, RunStackItem> = {};

  for (const item of items) {
    stack[item.node.id] = { node: item.node, outPorts: item.outPorts || {} };
  }

  return {
    startWithComponentId: items[0]?.node.id || "",
    stack: stack,
  };
};

type StorageFunction = (
  components?: { [x: string]: { returnValues: JSONObject } } | undefined,
) => StorageMap;

const storage: StorageFunction = (
  components?: { [x: string]: { returnValues: JSONObject } } | undefined,
): StorageMap => {
  return {
    local: { variables: {}, components: components || {} },
    global: { variables: {} },
  };
};

type SecretFunction = (content: string) => WorkflowVariable;

const secretVariable: SecretFunction = (content: string): WorkflowVariable => {
  const variable: WorkflowVariable = new WorkflowVariable();
  variable.content = content;
  variable.isSecret = "true";
  return variable;
};

type PrepareFunction = (
  runner: RunWorkflow,
  params: {
    stack: RunStack;
    storageMap?: StorageMap | undefined;
    variables?: Array<WorkflowVariable> | undefined;
    run?: RunComponentImplementation | undefined;
  },
) => RecordedSpy;

const prepareRun: PrepareFunction = (
  runner: RunWorkflow,
  params: {
    stack: RunStack;
    storageMap?: StorageMap | undefined;
    variables?: Array<WorkflowVariable> | undefined;
    run?: RunComponentImplementation | undefined;
  },
): RecordedSpy => {
  const workflowRow: Workflow = new Workflow();
  workflowRow.graph = { nodes: [], edges: [] } as JSONObject;
  workflowRow.projectId = PROJECT_ID;
  workflowRow.isEnabled = true;

  jest
    .spyOn(WorkflowService as never, "findOneById")
    .mockResolvedValue(workflowRow as never);

  const updateLogSpy: RecordedSpy = jest
    .spyOn(WorkflowLogService as never, "updateColumnsByIdWithoutHooks")
    .mockResolvedValue(undefined as never) as unknown as RecordedSpy;

  jest.spyOn(runner, "makeRunStack").mockResolvedValue(params.stack as never);
  jest.spyOn(runner, "getVariables").mockResolvedValue({
    storageMap: params.storageMap || storage(),
    variables: params.variables || [],
  } as never);

  jest.spyOn(runner, "runComponent").mockImplementation(
    (params.run ||
      (async (): Promise<unknown> => {
        return { returnValues: {}, executePort: OUT_PORT };
      })) as never,
  );

  return updateLogSpy;
};

type PersistedFunction = (updateLogSpy: RecordedSpy) => JSONObject;

const lastPersisted: PersistedFunction = (
  updateLogSpy: RecordedSpy,
): JSONObject => {
  const lastCall: unknown =
    updateLogSpy.mock.calls[updateLogSpy.mock.calls.length - 1]?.[0];

  return (lastCall as { data: JSONObject }).data;
};

const lastTrace: (updateLogSpy: RecordedSpy) => WorkflowStepTrace = (
  updateLogSpy: RecordedSpy,
): WorkflowStepTrace => {
  return parseTrace(lastPersisted(updateLogSpy)["stepTrace"] as never);
};

type RunFunction = (
  runner: RunWorkflow,
  options?: { runOnlyComponentId?: string; timeout?: number },
) => Promise<void>;

const run: RunFunction = async (
  runner: RunWorkflow,
  options?: { runOnlyComponentId?: string; timeout?: number },
): Promise<void> => {
  await runner.runWorkflow({
    arguments: {},
    workflowId: WORKFLOW_ID,
    workflowLogId: WORKFLOW_LOG_ID,
    timeout: options?.timeout ?? 5000,
    ...(options?.runOnlyComponentId
      ? { runOnlyComponentId: options.runOnlyComponentId }
      : {}),
  });
};

/** Each node takes the port given for it, and returns nothing. */
const takePorts: (
  ports: Record<string, Port | undefined>,
) => RunComponentImplementation = (
  ports: Record<string, Port | undefined>,
): RunComponentImplementation => {
  return async (
    _args: JSONObject,
    componentNode: NodeDataProp,
  ): Promise<unknown> => {
    return { returnValues: {}, executePort: ports[componentNode.id] };
  };
};

const stepOf: (
  trace: WorkflowStepTrace,
  componentId: string,
) => WorkflowStepTraceEntry = (
  trace: WorkflowStepTrace,
  componentId: string,
): WorkflowStepTraceEntry => {
  const step: WorkflowStepTraceEntry | undefined = trace.steps.find(
    (candidate: WorkflowStepTraceEntry) => {
      return candidate.componentId === componentId;
    },
  );

  if (!step) {
    throw new Error(`No step ${componentId} in the trace.`);
  }

  return step;
};

describe("RunWorkflow step trace, as the Steps view reads it", () => {
  beforeEach(() => {
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("which port a step took", () => {
    test("records the port's name and description, not only its id", async () => {
      const runner: RunWorkflow = new RunWorkflow();
      const updateLogSpy: RecordedSpy = prepareRun(runner, {
        stack: stackOf([{ node: node("if-else-1", IF_ELSE) }]),
        run: takePorts({ "if-else-1": NO_PORT }),
      });

      await run(runner);

      const step: WorkflowStepTraceEntry = stepOf(
        lastTrace(updateLogSpy),
        "if-else-1",
      );

      expect(step.executedPort).toBe("no");
      expect(step.executedPortTitle).toBe("No");
      expect(step.executedPortDescription).toBe(
        "Runs when the condition does not hold.",
      );
    });

    test("falls back to the id for a port with no title", async () => {
      const runner: RunWorkflow = new RunWorkflow();
      const updateLogSpy: RecordedSpy = prepareRun(runner, {
        stack: stackOf([{ node: node("if-else-1", IF_ELSE) }]),
        run: takePorts({
          "if-else-1": { id: "maybe", title: "", description: "" },
        }),
      });

      await run(runner);

      const step: WorkflowStepTraceEntry = stepOf(
        lastTrace(updateLogSpy),
        "if-else-1",
      );

      expect(step.executedPortTitle).toBe("maybe");
      expect(step.executedPortDescription).toBeUndefined();
    });

    test("records the steps the port is wired to, in the canvas's order", async () => {
      const runner: RunWorkflow = new RunWorkflow();
      const updateLogSpy: RecordedSpy = prepareRun(runner, {
        stack: stackOf([
          {
            node: node("if-else-1", IF_ELSE),
            outPorts: { yes: ["slack-1", "log-1"], no: ["log-2"] },
          },
          { node: node("slack-1", SLACK) },
          { node: node("log-1", LOG) },
          { node: node("log-2", LOG) },
        ]),
        run: takePorts({
          "if-else-1": YES_PORT,
          "slack-1": OUT_PORT,
          "log-1": OUT_PORT,
        }),
      });

      await run(runner);

      const trace: WorkflowStepTrace = lastTrace(updateLogSpy);

      expect(
        trace.steps.map((step: WorkflowStepTraceEntry) => {
          return step.componentId;
        }),
      ).toEqual(["if-else-1", "slack-1", "log-1"]);
      expect(stepOf(trace, "if-else-1").nextSteps).toEqual([
        { componentId: "slack-1", title: "Send Message to Slack" },
        { componentId: "log-1", title: "Log" },
      ]);
    });

    /*
     * "Nothing is connected" and "not recorded" must read differently, so an
     * unconnected port is an empty list, not a missing one.
     */
    test("records an empty list when nothing is connected to the port", async () => {
      const runner: RunWorkflow = new RunWorkflow();
      const updateLogSpy: RecordedSpy = prepareRun(runner, {
        stack: stackOf([
          {
            node: node("if-else-1", IF_ELSE),
            outPorts: { yes: ["log-1"] },
          },
          { node: node("log-1", LOG) },
        ]),
        run: takePorts({ "if-else-1": NO_PORT }),
      });

      await run(runner);

      const trace: WorkflowStepTrace = lastTrace(updateLogSpy);

      expect(trace.steps).toHaveLength(1);
      expect(stepOf(trace, "if-else-1").nextSteps).toEqual([]);
    });

    test("records no port details for a step that took no port", async () => {
      const runner: RunWorkflow = new RunWorkflow();
      const updateLogSpy: RecordedSpy = prepareRun(runner, {
        stack: stackOf([{ node: node("log-1", LOG) }]),
        run: takePorts({}),
      });

      await run(runner);

      const step: WorkflowStepTraceEntry = stepOf(
        lastTrace(updateLogSpy),
        "log-1",
      );

      expect(step.executedPort).toBeNull();
      expect(step.executedPortTitle).toBeUndefined();
      expect(step.nextSteps).toBeUndefined();
    });

    test("a step wired to the same step twice names it once", async () => {
      const runner: RunWorkflow = new RunWorkflow();
      const updateLogSpy: RecordedSpy = prepareRun(runner, {
        stack: stackOf([
          {
            node: node("if-else-1", IF_ELSE),
            outPorts: { yes: ["log-1", "log-1"] },
          },
          { node: node("log-1", LOG) },
        ]),
        run: takePorts({ "if-else-1": YES_PORT }),
      });

      await run(runner);

      expect(stepOf(lastTrace(updateLogSpy), "if-else-1").nextSteps).toEqual([
        { componentId: "log-1", title: "Log" },
      ]);
    });
  });

  describe("a test of one step", () => {
    const wiredStack: () => RunStack = (): RunStack => {
      return stackOf([
        { node: node("webhook-1", LOG), outPorts: { out: ["if-else-1"] } },
        {
          node: node("if-else-1", IF_ELSE),
          outPorts: { yes: ["slack-1"] },
        },
        { node: node("slack-1", SLACK) },
      ]);
    };

    /*
     * The maintainer's run: "Run this step" on an If / Else. Nothing after it
     * runs, but the trace still names what it is wired to, so the view can
     * say what would have run next.
     */
    test("still names the steps the port is wired to, and runs none of them", async () => {
      const runner: RunWorkflow = new RunWorkflow();
      const updateLogSpy: RecordedSpy = prepareRun(runner, {
        stack: wiredStack(),
        run: takePorts({ "if-else-1": YES_PORT, "slack-1": OUT_PORT }),
      });

      await run(runner, { runOnlyComponentId: "if-else-1" });

      const trace: WorkflowStepTrace = lastTrace(updateLogSpy);

      expect(trace.steps).toHaveLength(1);
      expect(stepOf(trace, "if-else-1").nextSteps).toEqual([
        { componentId: "slack-1", title: "Send Message to Slack" },
      ]);
      expect(
        (runner.runComponent as unknown as RecordedSpy).mock.calls,
      ).toHaveLength(1);
    });

    test("is marked as a test of that step", async () => {
      const runner: RunWorkflow = new RunWorkflow();
      const updateLogSpy: RecordedSpy = prepareRun(runner, {
        stack: wiredStack(),
        run: takePorts({ "if-else-1": NO_PORT }),
      });

      await run(runner, { runOnlyComponentId: "if-else-1" });

      expect(lastTrace(updateLogSpy).singleStepComponentId).toBe("if-else-1");
    });

    test("a whole run is not", async () => {
      const runner: RunWorkflow = new RunWorkflow();
      const updateLogSpy: RecordedSpy = prepareRun(runner, {
        stack: wiredStack(),
        run: takePorts({
          "webhook-1": OUT_PORT,
          "if-else-1": NO_PORT,
        }),
      });

      await run(runner);

      expect(lastTrace(updateLogSpy).singleStepComponentId).toBeUndefined();
    });
  });

  describe("what a step received", () => {
    /*
     * If / Else wraps its inputs in quotes while it works, and the trace used
     * to be read after it had: the Steps view showed "production" in quotes
     * the full log did not have.
     */
    test("records the arguments as the step received them, not as the component rewrote them", async () => {
      const runner: RunWorkflow = new RunWorkflow();
      const updateLogSpy: RecordedSpy = prepareRun(runner, {
        stack: stackOf([
          {
            node: node("if-else-1", IF_ELSE, {
              "input-1": "production",
              operator: "==",
              "input-2": "production",
            }),
          },
        ]),
        run: async (args: JSONObject): Promise<unknown> => {
          args["input-1"] = JSON.stringify(args["input-1"]);
          args["input-2"] = JSON.stringify(args["input-2"]);
          args["added-by-the-component"] = true;
          return { returnValues: {}, executePort: YES_PORT };
        },
      });

      await run(runner);

      expect(
        stepOf(lastTrace(updateLogSpy), "if-else-1").argumentValues,
      ).toEqual({
        "input-1": "production",
        operator: "==",
        "input-2": "production",
      });
    });

    test("still hands the component the arguments to work on", async () => {
      const received: Array<JSONObject> = [];
      const runner: RunWorkflow = new RunWorkflow();

      prepareRun(runner, {
        stack: stackOf([{ node: node("log-1", LOG, { value: "hello" }) }]),
        run: async (args: JSONObject): Promise<unknown> => {
          received.push(args);
          return { returnValues: {}, executePort: OUT_PORT };
        },
      });

      await run(runner);

      expect(received).toEqual([{ value: "hello" }]);
    });

    test("names the arguments and return values in their settings' order", async () => {
      const component: ComponentMetadata = simpleMetadata({
        id: "api-get",
        title: "API Get",
        args: [argument("url", "URL"), argument("headers", "Headers")],
        returnValues: [
          returnValue("response-status", "Response Status"),
          returnValue("response-body", "Response Body"),
        ],
      });

      const runner: RunWorkflow = new RunWorkflow();
      const updateLogSpy: RecordedSpy = prepareRun(runner, {
        stack: stackOf([{ node: node("api-get-1", component) }]),
      });

      await run(runner);

      const step: WorkflowStepTraceEntry = stepOf(
        lastTrace(updateLogSpy),
        "api-get-1",
      );

      expect(step.argumentNames).toEqual([
        { id: "url", name: "URL" },
        { id: "headers", name: "Headers" },
      ]);
      expect(step.returnValueNames).toEqual([
        { id: "response-status", name: "Response Status" },
        { id: "response-body", name: "Response Body" },
      ]);
    });

    test("records that a component returns nothing as an empty list", async () => {
      const runner: RunWorkflow = new RunWorkflow();
      const updateLogSpy: RecordedSpy = prepareRun(runner, {
        stack: stackOf([{ node: node("if-else-1", IF_ELSE) }]),
        run: takePorts({ "if-else-1": YES_PORT }),
      });

      await run(runner);

      expect(
        stepOf(lastTrace(updateLogSpy), "if-else-1").returnValueNames,
      ).toEqual([]);
    });

    test("keeps the {{...}} an argument was configured with, beside what it resolved to", async () => {
      const runner: RunWorkflow = new RunWorkflow();
      const updateLogSpy: RecordedSpy = prepareRun(runner, {
        stack: stackOf([
          {
            node: node("if-else-1", IF_ELSE, {
              "input-1": WEBHOOK_REFERENCE,
              operator: "==",
              "input-2": "production",
            }),
          },
        ]),
        storageMap: storage({
          "webhook-1": {
            returnValues: { "request-body": { environment: "production" } },
          },
        }),
        run: takePorts({ "if-else-1": YES_PORT }),
      });

      await run(runner);

      const step: WorkflowStepTraceEntry = stepOf(
        lastTrace(updateLogSpy),
        "if-else-1",
      );

      expect(step.argumentValues["input-1"]).toBe("production");
      // Only the argument that referred to something.
      expect(step.argumentTemplates).toEqual({
        "input-1": WEBHOOK_REFERENCE,
      });
    });

    test("keeps a reference that sits inside a structured value", async () => {
      const component: ComponentMetadata = simpleMetadata({
        id: "api-get",
        title: "API Get",
        args: [
          argument("headers", "Headers", {
            type: ComponentInputType.StringDictionary,
          }),
        ],
      });

      const runner: RunWorkflow = new RunWorkflow();
      const updateLogSpy: RecordedSpy = prepareRun(runner, {
        stack: stackOf([
          {
            node: node("api-get-1", component, {
              headers: { "X-Environment": WEBHOOK_REFERENCE },
            }),
          },
        ]),
      });

      await run(runner);

      expect(
        stepOf(lastTrace(updateLogSpy), "api-get-1").argumentTemplates,
      ).toEqual({ headers: { "X-Environment": WEBHOOK_REFERENCE } });
    });

    test("records no templates for a step configured with plain values", async () => {
      const runner: RunWorkflow = new RunWorkflow();
      const updateLogSpy: RecordedSpy = prepareRun(runner, {
        stack: stackOf([{ node: node("log-1", LOG, { value: "hello" }) }]),
      });

      await run(runner);

      expect(
        stepOf(lastTrace(updateLogSpy), "log-1").argumentTemplates,
      ).toBeUndefined();
    });

    /*
     * A sensitive argument's configured value may be a literal secret with a
     * reference beside it. The trace hides its value; it must not show its
     * configuration instead.
     */
    test("never keeps the configuration of a sensitive argument", async () => {
      const component: ComponentMetadata = simpleMetadata({
        id: "api-get",
        title: "API Get",
        args: [
          argument("authorization", "Authorization", { isSensitive: true }),
          argument("url", "URL"),
        ],
      });

      const runner: RunWorkflow = new RunWorkflow();
      const updateLogSpy: RecordedSpy = prepareRun(runner, {
        stack: stackOf([
          {
            node: node("api-get-1", component, {
              authorization: "Bearer sk_live_literal {{local.variables.x}}",
              url: "https://example.com/{{local.variables.path}}",
            }),
          },
        ]),
      });

      await run(runner);

      const persisted: string = JSON.stringify(
        lastPersisted(updateLogSpy)["stepTrace"],
      );
      const step: WorkflowStepTraceEntry = stepOf(
        lastTrace(updateLogSpy),
        "api-get-1",
      );

      expect(step.argumentTemplates).toEqual({
        url: "https://example.com/{{local.variables.path}}",
      });
      expect(persisted).not.toContain("sk_live_literal");
    });

    test("scrubs secret variable values out of a configured template", async () => {
      const runner: RunWorkflow = new RunWorkflow();
      const updateLogSpy: RecordedSpy = prepareRun(runner, {
        stack: stackOf([
          {
            node: node("log-1", LOG, {
              value: "token hunter2 for {{local.variables.user}}",
            }),
          },
        ]),
        variables: [secretVariable("hunter2")],
      });

      await run(runner);

      const step: WorkflowStepTraceEntry = stepOf(
        lastTrace(updateLogSpy),
        "log-1",
      );

      expect(step.argumentTemplates).toEqual({
        value: `token ${WORKFLOW_LOG_REDACTED_VALUE} for {{local.variables.user}}`,
      });
      expect(JSON.stringify(lastPersisted(updateLogSpy))).not.toContain(
        "hunter2",
      );
    });
  });

  describe("warnings", () => {
    /*
     * The other half of the report: the unresolved {{...}} was only in the
     * full log. It is still there, word for word, and now on the step too.
     */
    test("puts a reference that resolved to nothing on the step, naming the argument", async () => {
      const runner: RunWorkflow = new RunWorkflow();
      const updateLogSpy: RecordedSpy = prepareRun(runner, {
        stack: stackOf([
          {
            node: node("if-else-1", IF_ELSE, {
              "input-1": WEBHOOK_REFERENCE,
              operator: "==",
              "input-2": "production",
            }),
          },
        ]),
        run: takePorts({ "if-else-1": NO_PORT }),
      });

      await run(runner);

      const step: WorkflowStepTraceEntry = stepOf(
        lastTrace(updateLogSpy),
        "if-else-1",
      );
      const expectedMessage: string = `${WEBHOOK_REFERENCE} in "Input 1" did not resolve to anything and was left as literal text. Check the step id and the return value name.`;

      expect(step.warnings).toEqual([
        {
          message: expectedMessage,
          argumentId: "input-1",
          unresolvedReferences: [WEBHOOK_REFERENCE],
        },
      ]);
      expect(lastPersisted(updateLogSpy)["logs"] as string).toContain(
        `Warning: ${expectedMessage}`,
      );
    });

    test("keeps each step's warnings to that step", async () => {
      const runner: RunWorkflow = new RunWorkflow();
      const updateLogSpy: RecordedSpy = prepareRun(runner, {
        stack: stackOf([
          {
            node: node("log-1", LOG, { value: "{{local.variables.missing}}" }),
            outPorts: { out: ["log-2"] },
          },
          { node: node("log-2", LOG, { value: "fine" }) },
        ]),
      });

      await run(runner);

      const trace: WorkflowStepTrace = lastTrace(updateLogSpy);

      expect(stepOf(trace, "log-1").warnings).toHaveLength(1);
      expect(stepOf(trace, "log-2").warnings).toBeUndefined();
    });

    test("records no warnings for a step that had none", async () => {
      const runner: RunWorkflow = new RunWorkflow();
      const updateLogSpy: RecordedSpy = prepareRun(runner, {
        stack: stackOf([{ node: node("log-1", LOG, { value: "fine" }) }]),
      });

      await run(runner);

      expect(stepOf(lastTrace(updateLogSpy), "log-1").warnings).toBeUndefined();
    });

    test("scrubs secret variable values out of a warning", async () => {
      const runner: RunWorkflow = new RunWorkflow();
      const updateLogSpy: RecordedSpy = prepareRun(runner, {
        stack: stackOf([
          {
            node: node("log-1", LOG, {
              value: "{{local.variables.hunter2-token}}",
            }),
          },
        ]),
        variables: [secretVariable("hunter2")],
      });

      await run(runner);

      const step: WorkflowStepTraceEntry = stepOf(
        lastTrace(updateLogSpy),
        "log-1",
      );

      expect(step.warnings?.[0]?.message).toContain(
        `{{local.variables.${WORKFLOW_LOG_REDACTED_VALUE}-token}}`,
      );
      expect(step.warnings?.[0]?.unresolvedReferences).toEqual([
        `{{local.variables.${WORKFLOW_LOG_REDACTED_VALUE}-token}}`,
      ]);
      expect(JSON.stringify(lastPersisted(updateLogSpy))).not.toContain(
        "hunter2",
      );
    });
  });

  describe("a run that sleeps", () => {
    const SLEEP: ComponentMetadata = simpleMetadata({
      id: "sleep",
      title: "Sleep",
    });

    /*
     * While a run sleeps, the step after the Sleep has not run yet. Without
     * this the Steps view could only say it "did not run", which reads like a
     * run that broke.
     */
    test("says when a sleeping run carries on", async () => {
      const resumeJob: RecordedSpy = jest
        .spyOn(QueueWorkflow, "addResumeJobToQueue")
        .mockResolvedValue(undefined as never) as unknown as RecordedSpy;

      const runner: RunWorkflow = new RunWorkflow();
      const updateLogSpy: RecordedSpy = prepareRun(runner, {
        stack: stackOf([
          { node: node("sleep-1", SLEEP), outPorts: { out: ["log-1"] } },
          { node: node("log-1", LOG) },
        ]),
        run: async (): Promise<unknown> => {
          return {
            returnValues: {},
            executePort: OUT_PORT,
            suspendForMs: 60000,
          };
        },
      });

      const before: number = Date.now();

      await run(runner);

      const persisted: JSONObject = lastPersisted(updateLogSpy);
      const trace: WorkflowStepTrace = lastTrace(updateLogSpy);

      expect(resumeJob.mock.calls).toHaveLength(1);
      expect(persisted["workflowStatus"]).toBe(WorkflowStatus.Waiting);
      expect(trace.steps).toHaveLength(1);
      expect(stepOf(trace, "sleep-1").nextSteps).toEqual([
        { componentId: "log-1", title: "Log" },
      ]);

      const resumesAt: number = Date.parse(trace.resumesAt as string);

      expect(resumesAt).toBeGreaterThanOrEqual(before + 60000);
      expect(resumesAt).toBeLessThan(before + 62000);
    });

    test("forgets it once the run carries on", async () => {
      const storedTrace: WorkflowStepTrace = {
        steps: [
          {
            componentId: "sleep-1",
            metadataId: "sleep",
            title: "Sleep",
            status: WorkflowStepStatus.Success,
            startedAt: "2026-10-01T10:00:00.000Z",
            completedAt: "2026-10-01T10:00:00.010Z",
            durationInMs: 10,
            argumentValues: {},
            returnValues: {},
            executedPort: "out",
            executedPortTitle: "Out",
            nextSteps: [{ componentId: "log-1", title: "Log" }],
          },
        ],
        resumesAt: "2026-10-01T10:01:00.000Z",
      };

      const storedLog: WorkflowLog = new WorkflowLog();
      storedLog.logs = "earlier lines";
      storedLog.stepTrace = storedTrace as unknown as JSONObject;
      storedLog.resumeData = {
        pendingStack: ["log-1"],
        executedComponents: ["sleep-1"],
        componentReturnValues: {},
      } as JSONObject;

      jest
        .spyOn(WorkflowLogService as never, "findOneById")
        .mockResolvedValue(storedLog as never);

      const runner: RunWorkflow = new RunWorkflow();
      const updateLogSpy: RecordedSpy = prepareRun(runner, {
        stack: stackOf([
          { node: node("sleep-1", SLEEP), outPorts: { out: ["log-1"] } },
          { node: node("log-1", LOG) },
        ]),
        run: takePorts({ "log-1": OUT_PORT }),
      });

      await runner.runWorkflow({
        arguments: {},
        workflowId: WORKFLOW_ID,
        workflowLogId: WORKFLOW_LOG_ID,
        timeout: 5000,
        isResume: true,
      });

      const trace: WorkflowStepTrace = lastTrace(updateLogSpy);

      expect(lastPersisted(updateLogSpy)["workflowStatus"]).toBe(
        WorkflowStatus.Success,
      );
      expect(
        trace.steps.map((step: WorkflowStepTraceEntry) => {
          return step.componentId;
        }),
      ).toEqual(["sleep-1", "log-1"]);
      expect(trace.resumesAt).toBeUndefined();
    });
  });

  describe("why a run stopped", () => {
    /*
     * An argument that does not parse used to stop the run before anything
     * was recorded, so the trace ended on the step before, which had worked.
     */
    test("records an argument that cannot be read as the step that failed", async () => {
      const component: ComponentMetadata = simpleMetadata({
        id: "create-incident",
        title: "Create Incident",
        args: [argument("json", "JSON", { type: ComponentInputType.JSON })],
      });

      const runner: RunWorkflow = new RunWorkflow();
      const updateLogSpy: RecordedSpy = prepareRun(runner, {
        stack: stackOf([
          { node: node("log-1", LOG), outPorts: { out: ["create-1"] } },
          { node: node("create-1", component, { json: '{"title": "Down"' }) },
        ]),
      });

      await run(runner);

      const trace: WorkflowStepTrace = lastTrace(updateLogSpy);
      const failed: WorkflowStepTraceEntry = stepOf(trace, "create-1");

      expect(trace.steps).toHaveLength(2);
      expect(failed.status).toBe(WorkflowStepStatus.Error);
      expect(failed.errorMessage).toContain(
        "Invalid JSON provided for argument json",
      );
      expect(failed.executedPort).toBeNull();
      // The step says why; the run does not say it again.
      expect(trace.runErrorMessage).toBeUndefined();
      expect(lastPersisted(updateLogSpy)["workflowStatus"]).toBe(
        WorkflowStatus.Error,
      );
      // Only the first step's component ran.
      expect(
        (runner.runComponent as unknown as RecordedSpy).mock.calls,
      ).toHaveLength(1);
    });

    test("records why the run stopped when it timed out between steps", async () => {
      const startedAtInMs: number = Date.parse("2026-10-01T10:00:00.000Z");
      const dateNowSpy: NumberSpy = jest
        .spyOn(Date, "now")
        .mockReturnValue(startedAtInMs) as unknown as NumberSpy;

      const runner: RunWorkflow = new RunWorkflow();
      const updateLogSpy: RecordedSpy = prepareRun(runner, {
        stack: stackOf([
          { node: node("log-1", LOG), outPorts: { out: ["log-2"] } },
          { node: node("log-2", LOG) },
        ]),
        run: async (): Promise<unknown> => {
          dateNowSpy.mockReturnValue(startedAtInMs + 101);
          return { returnValues: {}, executePort: OUT_PORT };
        },
      });

      await run(runner, { timeout: 100 });

      const trace: WorkflowStepTrace = lastTrace(updateLogSpy);

      expect(lastPersisted(updateLogSpy)["workflowStatus"]).toBe(
        WorkflowStatus.Timeout,
      );
      expect(trace.steps).toHaveLength(1);
      expect(stepOf(trace, "log-1").status).toBe(WorkflowStepStatus.Success);
      expect(trace.runErrorMessage).toBe(
        "Workflow execution time was more than 100ms and workflow timed-out.",
      );
    });

    test("records why a run with nothing to run stopped", async () => {
      const runner: RunWorkflow = new RunWorkflow();
      const updateLogSpy: RecordedSpy = prepareRun(runner, {
        stack: { startWithComponentId: "", stack: {} },
      });

      await run(runner);

      const trace: WorkflowStepTrace = lastTrace(updateLogSpy);

      expect(trace.steps).toEqual([]);
      expect(trace.runErrorMessage).toContain(
        "This workflow has no components to execute.",
      );
    });

    test("does not repeat a failed step's own error as the run's", async () => {
      const runner: RunWorkflow = new RunWorkflow();
      const updateLogSpy: RecordedSpy = prepareRun(runner, {
        stack: stackOf([{ node: node("log-1", LOG) }]),
        run: async (): Promise<unknown> => {
          throw new Error("component exploded");
        },
      });

      await run(runner);

      const trace: WorkflowStepTrace = lastTrace(updateLogSpy);

      expect(stepOf(trace, "log-1").errorMessage).toContain(
        "component exploded",
      );
      expect(trace.runErrorMessage).toBeUndefined();
    });

    test("does not repeat an error a component reported itself", async () => {
      const runner: RunWorkflow = new RunWorkflow();
      const updateLogSpy: RecordedSpy = prepareRun(runner, {
        stack: stackOf([{ node: node("log-1", LOG) }]),
        run: async (
          _args: JSONObject,
          _node: NodeDataProp,
          onError: VoidFunction,
        ): Promise<unknown> => {
          onError();
          return { returnValues: {}, executePort: ERROR_PORT };
        },
      });

      await run(runner);

      const trace: WorkflowStepTrace = lastTrace(updateLogSpy);

      expect(stepOf(trace, "log-1").errorMessage).toBe(
        "The component reported an error.",
      );
      expect(trace.runErrorMessage).toBeUndefined();
    });

    test("leaves a run that finished without a stop reason", async () => {
      const runner: RunWorkflow = new RunWorkflow();
      const updateLogSpy: RecordedSpy = prepareRun(runner, {
        stack: stackOf([{ node: node("log-1", LOG) }]),
      });

      await run(runner);

      expect(lastTrace(updateLogSpy).runErrorMessage).toBeUndefined();
      expect(lastPersisted(updateLogSpy)["workflowStatus"]).toBe(
        WorkflowStatus.Success,
      );
    });

    /*
     * The stop reason is text the run persists, like the log line it repeats,
     * so it is scrubbed the same way. (A step id is an identifier the trace
     * keeps as it is - componentId always has been - which is why the secret
     * here only stands in for text that could carry one.)
     */
    test("scrubs secret variable values out of the stop reason", async () => {
      const runner: RunWorkflow = new RunWorkflow();
      const updateLogSpy: RecordedSpy = prepareRun(runner, {
        // Wired to a step that is not in the graph.
        stack: stackOf([
          { node: node("log-1", LOG), outPorts: { out: ["hunter2-step"] } },
        ]),
        variables: [secretVariable("hunter2")],
      });

      await run(runner);

      const trace: WorkflowStepTrace = lastTrace(updateLogSpy);

      expect(trace.runErrorMessage).toBe(
        `Component with ID ${WORKFLOW_LOG_REDACTED_VALUE}-step not found.`,
      );
      expect(lastPersisted(updateLogSpy)["logs"] as string).not.toContain(
        "hunter2",
      );
    });
  });
});
