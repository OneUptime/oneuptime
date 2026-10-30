/*
 * A step that fails with nothing connected to its Error output fails the run
 * (Types/Workflow/UnhandledStepFailure).
 *
 * The templates used to put a Log on almost every Error output, because a run
 * whose step failed and led nowhere ended as a Success, and its log said
 * nothing. The run says it now, once: it ends as Error, the failed step is
 * marked in its trace with nothing after it, and its log ends with one line
 * naming the step. A step whose Error output is connected is handled, and a
 * run that goes on there ends as it always did - so the workflows already
 * made from the old templates, with a Log on every Error output, run exactly
 * as before.
 *
 * What these pin: the rule (only the Error output, only when nothing is
 * connected there, the No of an If / Else and a Default never), that the rest
 * of the run still runs, one line for every failure, a run that slept
 * keeping what failed before it slept, and a single step tested on its own.
 */

import Workflow from "Common/Models/DatabaseModels/Workflow";
import WorkflowLog from "Common/Models/DatabaseModels/WorkflowLog";
import WorkflowLogService from "Common/Server/Services/WorkflowLogService";
import WorkflowService from "Common/Server/Services/WorkflowService";
import ProjectService from "Common/Server/Services/ProjectService";
import logger from "Common/Server/Utils/Logger";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import ComponentMetadata, {
  ComponentType,
  NodeDataProp,
  NodeType,
  Port,
} from "Common/Types/Workflow/Component";
import {
  WorkflowStepStatus,
  WorkflowStepTrace,
  WorkflowStepTraceEntry,
  parseTrace,
} from "Common/Types/Workflow/StepTrace";
import {
  STEP_ERROR_PORT_ID,
  getUnhandledStepFailureLogLine,
} from "Common/Types/Workflow/UnhandledStepFailure";
import WorkflowStatus from "Common/Types/Workflow/WorkflowStatus";
import QueueWorkflow from "../../../FeatureSet/Workflow/Services/QueueWorkflow";
import RunWorkflow, {
  RunStack,
  RunStackItem,
} from "../../../FeatureSet/Workflow/Services/RunWorkflow";
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

interface RecordedSpy {
  mock: { calls: Array<Array<unknown>> };
}

const SUCCESS_PORT: Port = {
  id: "success",
  title: "Success",
  description: "Runs when the step works.",
};

const ERROR_PORT: Port = {
  id: STEP_ERROR_PORT_ID,
  title: "Error",
  description: "Runs when the step fails.",
};

const NO_PORT: Port = {
  id: "no",
  title: "No",
  description: "Runs when the condition does not hold.",
};

const DEFAULT_PORT: Port = {
  id: "default",
  title: "Default",
  description: "Runs when no case matches.",
};

const OUT_PORT: Port = {
  id: "out",
  title: "Out",
  description: "Runs after this step.",
};

type MetadataFunction = (id: string, title: string) => ComponentMetadata;

const metadata: MetadataFunction = (
  id: string,
  title: string,
): ComponentMetadata => {
  return {
    id: id,
    title: title,
    category: "Test",
    description: title,
    iconProp: IconProp.Bolt,
    componentType: ComponentType.Component,
    arguments: [],
    returnValues: [],
    inPorts: [],
    outPorts: [SUCCESS_PORT, ERROR_PORT],
  };
};

const API_GET: ComponentMetadata = metadata("api-get", "API GET");
const SLACK: ComponentMetadata = metadata(
  "slack-send-message-to-channel",
  "Send Message to Slack",
);
const LOG: ComponentMetadata = metadata("log", "Log");
const IF_ELSE: ComponentMetadata = metadata("if-else", "If / Else");
const SWITCH: ComponentMetadata = metadata("switch", "Switch / Case");
const SLEEP: ComponentMetadata = metadata("sleep", "Sleep");

type NodeFunction = (id: string, meta: ComponentMetadata) => NodeDataProp;

const node: NodeFunction = (
  id: string,
  meta: ComponentMetadata,
): NodeDataProp => {
  return {
    error: "",
    id: id,
    nodeType: NodeType.Node,
    metadata: meta,
    metadataId: meta.id,
    internalId: `internal-${id}`,
    arguments: {},
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

type RunComponentImplementation = (
  args: JSONObject,
  componentNode: NodeDataProp,
) => Promise<unknown>;

// Each step leaves by the port given for it; a step not listed by Success.
const takePorts: (
  ports: Record<string, Port>,
  extra?: Record<string, JSONObject>,
) => RunComponentImplementation = (
  ports: Record<string, Port>,
  extra?: Record<string, JSONObject>,
): RunComponentImplementation => {
  return async (
    _args: JSONObject,
    componentNode: NodeDataProp,
  ): Promise<unknown> => {
    return {
      returnValues: {},
      executePort: ports[componentNode.id] || SUCCESS_PORT,
      ...(extra?.[componentNode.id] || {}),
    };
  };
};

type PrepareFunction = (
  runner: RunWorkflow,
  stack: RunStack,
  run: RunComponentImplementation,
) => RecordedSpy;

const prepareRun: PrepareFunction = (
  runner: RunWorkflow,
  stack: RunStack,
  run: RunComponentImplementation,
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

  jest.spyOn(runner, "makeRunStack").mockResolvedValue(stack as never);
  jest.spyOn(runner, "getVariables").mockResolvedValue({
    storageMap: {
      local: { variables: {}, components: {} },
      global: { variables: {} },
    },
    variables: [],
  } as never);
  jest.spyOn(runner, "runComponent").mockImplementation(run as never);

  return updateLogSpy;
};

const lastPersisted: (updateLogSpy: RecordedSpy) => JSONObject = (
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

const ran: (trace: WorkflowStepTrace) => Array<string> = (
  trace: WorkflowStepTrace,
): Array<string> => {
  return trace.steps.map((step: WorkflowStepTraceEntry): string => {
    return step.componentId;
  });
};

const lastLogLine: (updateLogSpy: RecordedSpy) => string = (
  updateLogSpy: RecordedSpy,
): string => {
  const lines: Array<string> = String(lastPersisted(updateLogSpy)["logs"] || "")
    .split("\n")
    .filter((line: string): boolean => {
      return line.trim() !== "";
    });

  return lines[lines.length - 1] || "";
};

const run: (
  runner: RunWorkflow,
  options?: { runOnlyComponentId?: string; isResume?: boolean },
) => Promise<void> = async (
  runner: RunWorkflow,
  options?: { runOnlyComponentId?: string; isResume?: boolean },
): Promise<void> => {
  await runner.runWorkflow({
    arguments: {},
    workflowId: WORKFLOW_ID,
    workflowLogId: WORKFLOW_LOG_ID,
    timeout: 5000,
    ...(options?.runOnlyComponentId
      ? { runOnlyComponentId: options.runOnlyComponentId }
      : {}),
    ...(options?.isResume ? { isResume: true } : {}),
  });
};

describe("a step that fails with nothing connected to its Error output", () => {
  beforeEach(() => {
    jest.spyOn(ProjectService, "isProjectBlocked").mockResolvedValue(false);
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("fails the run, and its log ends by naming the step", async () => {
    const runner: RunWorkflow = new RunWorkflow();
    const updateLogSpy: RecordedSpy = prepareRun(
      runner,
      stackOf([{ node: node("api-get-1", API_GET) }]),
      takePorts({ "api-get-1": ERROR_PORT }),
    );

    await run(runner);

    expect(lastPersisted(updateLogSpy)["workflowStatus"]).toBe(
      WorkflowStatus.Error,
    );
    expect(lastLogLine(updateLogSpy)).toContain(
      getUnhandledStepFailureLogLine([
        { componentId: "api-get-1", title: "API GET" },
      ]),
    );
    expect(lastLogLine(updateLogSpy)).toContain(
      "The run failed: step api-get-1 (API GET) failed, and nothing is connected to its Error output.",
    );
  });

  test("marks that step failed in the run's Steps, with nothing after it", async () => {
    const runner: RunWorkflow = new RunWorkflow();
    const updateLogSpy: RecordedSpy = prepareRun(
      runner,
      stackOf([{ node: node("api-get-1", API_GET) }]),
      takePorts({ "api-get-1": ERROR_PORT }),
    );

    await run(runner);

    const step: WorkflowStepTraceEntry = lastTrace(updateLogSpy)
      .steps[0] as WorkflowStepTraceEntry;

    expect(step.status).toBe(WorkflowStepStatus.Error);
    expect(step.executedPort).toBe(STEP_ERROR_PORT_ID);
    expect(step.nextSteps).toEqual([]);
  });

  test("is handled by a step connected there: the run goes on and ends as a Success", async () => {
    const runner: RunWorkflow = new RunWorkflow();
    const updateLogSpy: RecordedSpy = prepareRun(
      runner,
      stackOf([
        {
          node: node("api-get-1", API_GET),
          outPorts: { error: ["log-failed"] },
        },
        { node: node("log-failed", LOG) },
      ]),
      takePorts({ "api-get-1": ERROR_PORT, "log-failed": OUT_PORT }),
    );

    await run(runner);

    expect(lastPersisted(updateLogSpy)["workflowStatus"]).toBe(
      WorkflowStatus.Success,
    );
    expect(ran(lastTrace(updateLogSpy))).toEqual(["api-get-1", "log-failed"]);
    expect(String(lastPersisted(updateLogSpy)["logs"])).not.toContain(
      "The run failed",
    );
  });

  test("a step connected only to Success does not handle its failure", async () => {
    const runner: RunWorkflow = new RunWorkflow();
    const updateLogSpy: RecordedSpy = prepareRun(
      runner,
      stackOf([
        {
          node: node("api-get-1", API_GET),
          outPorts: { success: ["slack-1"] },
        },
        { node: node("slack-1", SLACK) },
      ]),
      takePorts({ "api-get-1": ERROR_PORT }),
    );

    await run(runner);

    expect(lastPersisted(updateLogSpy)["workflowStatus"]).toBe(
      WorkflowStatus.Error,
    );
    // Success leads to Slack, but the step left by Error: Slack never ran.
    expect(ran(lastTrace(updateLogSpy))).toEqual(["api-get-1"]);
  });

  test("a step that works ends the run as a Success, with no line about failures", async () => {
    const runner: RunWorkflow = new RunWorkflow();
    const updateLogSpy: RecordedSpy = prepareRun(
      runner,
      stackOf([
        {
          node: node("api-get-1", API_GET),
          outPorts: { success: ["slack-1"] },
        },
        { node: node("slack-1", SLACK) },
      ]),
      takePorts({}),
    );

    await run(runner);

    expect(lastPersisted(updateLogSpy)["workflowStatus"]).toBe(
      WorkflowStatus.Success,
    );
    expect(String(lastPersisted(updateLogSpy)["logs"])).not.toContain(
      "The run failed",
    );
  });

  test.each([
    ["the No of an If / Else", "if-else-1", IF_ELSE, NO_PORT],
    ["a Switch / Case's Default", "switch-1", SWITCH, DEFAULT_PORT],
  ])(
    "%s with nothing connected is not a failure",
    async (
      _name: string,
      componentId: string,
      meta: ComponentMetadata,
      port: Port,
    ) => {
      const runner: RunWorkflow = new RunWorkflow();
      const updateLogSpy: RecordedSpy = prepareRun(
        runner,
        stackOf([{ node: node(componentId, meta) }]),
        takePorts({ [componentId]: port }),
      );

      await run(runner);

      expect(lastPersisted(updateLogSpy)["workflowStatus"]).toBe(
        WorkflowStatus.Success,
      );
    },
  );

  test("the rest of the run still runs before it is marked failed", async () => {
    const runner: RunWorkflow = new RunWorkflow();
    const updateLogSpy: RecordedSpy = prepareRun(
      runner,
      stackOf([
        { node: node("api-get-1", API_GET), outPorts: { success: ["a", "b"] } },
        { node: node("a", SLACK) },
        { node: node("b", LOG), outPorts: { success: ["c"] } },
        { node: node("c", SLACK) },
      ]),
      // "a" fails unhandled; "b" and the step after it still run.
      takePorts({ a: ERROR_PORT }),
    );

    await run(runner);

    expect(ran(lastTrace(updateLogSpy))).toEqual(["api-get-1", "a", "b", "c"]);
    expect(lastPersisted(updateLogSpy)["workflowStatus"]).toBe(
      WorkflowStatus.Error,
    );
    expect(lastLogLine(updateLogSpy)).toContain(
      "step a (Send Message to Slack)",
    );
  });

  test("names every step that failed unhandled, in one line, in the order they ran", async () => {
    const runner: RunWorkflow = new RunWorkflow();
    const updateLogSpy: RecordedSpy = prepareRun(
      runner,
      stackOf([
        { node: node("api-get-1", API_GET), outPorts: { success: ["a", "b"] } },
        { node: node("a", SLACK) },
        { node: node("b", LOG) },
      ]),
      takePorts({ a: ERROR_PORT, b: ERROR_PORT }),
    );

    await run(runner);

    const line: string = lastLogLine(updateLogSpy);

    expect(line).toContain(
      getUnhandledStepFailureLogLine([
        { componentId: "a", title: "Send Message to Slack" },
        { componentId: "b", title: "Log" },
      ]),
    );
    expect(
      String(lastPersisted(updateLogSpy)["logs"]).split("The run failed")
        .length - 1,
    ).toBe(1);
  });

  test("a single step tested on its own fails the run when it fails, whatever its Error output leads to in the workflow", async () => {
    const runner: RunWorkflow = new RunWorkflow();
    const updateLogSpy: RecordedSpy = prepareRun(
      runner,
      stackOf([
        {
          node: node("api-get-1", API_GET),
          outPorts: { error: ["log-failed"] },
        },
        { node: node("log-failed", LOG) },
      ]),
      takePorts({ "api-get-1": ERROR_PORT }),
    );

    await run(runner, { runOnlyComponentId: "api-get-1" });

    expect(ran(lastTrace(updateLogSpy))).toEqual(["api-get-1"]);
    expect(lastPersisted(updateLogSpy)["workflowStatus"]).toBe(
      WorkflowStatus.Error,
    );
  });

  describe("a run that sleeps", () => {
    test("keeps a failure from before it slept in its resume data", async () => {
      jest
        .spyOn(QueueWorkflow, "addResumeJobToQueue")
        .mockResolvedValue(undefined as never);

      const runner: RunWorkflow = new RunWorkflow();
      const updateLogSpy: RecordedSpy = prepareRun(
        runner,
        stackOf([
          {
            node: node("api-get-1", API_GET),
            outPorts: { success: ["a", "sleep-1"] },
          },
          { node: node("a", SLACK) },
          { node: node("sleep-1", SLEEP), outPorts: { out: ["log-1"] } },
          { node: node("log-1", LOG) },
        ]),
        takePorts(
          { a: ERROR_PORT, "sleep-1": OUT_PORT },
          { "sleep-1": { suspendForMs: 60000 } },
        ),
      );

      await run(runner);

      const persisted: JSONObject = lastPersisted(updateLogSpy);

      expect(persisted["workflowStatus"]).toBe(WorkflowStatus.Waiting);
      expect(
        (persisted["resumeData"] as JSONObject)["unhandledStepFailures"],
      ).toEqual([{ componentId: "a", title: "Send Message to Slack" }]);
    });

    test("ends as failed when it wakes, though the steps after the Sleep work", async () => {
      const storedLog: WorkflowLog = new WorkflowLog();
      storedLog.logs = "earlier lines";
      storedLog.stepTrace = { steps: [] } as unknown as JSONObject;
      storedLog.resumeData = {
        pendingStack: ["log-1"],
        executedComponents: ["api-get-1", "a", "sleep-1"],
        componentReturnValues: {},
        unhandledStepFailures: [
          { componentId: "a", title: "Send Message to Slack" },
        ],
      } as JSONObject;

      jest
        .spyOn(WorkflowLogService as never, "findOneById")
        .mockResolvedValue(storedLog as never);

      const runner: RunWorkflow = new RunWorkflow();
      const updateLogSpy: RecordedSpy = prepareRun(
        runner,
        stackOf([
          { node: node("sleep-1", SLEEP), outPorts: { out: ["log-1"] } },
          { node: node("log-1", LOG) },
        ]),
        takePorts({ "log-1": OUT_PORT }),
      );

      await run(runner, { isResume: true });

      expect(lastPersisted(updateLogSpy)["workflowStatus"]).toBe(
        WorkflowStatus.Error,
      );
      expect(lastLogLine(updateLogSpy)).toContain(
        "step a (Send Message to Slack)",
      );
    });

    test("a run that slept before failures were kept wakes as it did", async () => {
      const storedLog: WorkflowLog = new WorkflowLog();
      storedLog.logs = "earlier lines";
      storedLog.stepTrace = { steps: [] } as unknown as JSONObject;
      storedLog.resumeData = {
        pendingStack: ["log-1"],
        executedComponents: ["sleep-1"],
        componentReturnValues: {},
      } as JSONObject;

      jest
        .spyOn(WorkflowLogService as never, "findOneById")
        .mockResolvedValue(storedLog as never);

      const runner: RunWorkflow = new RunWorkflow();
      const updateLogSpy: RecordedSpy = prepareRun(
        runner,
        stackOf([
          { node: node("sleep-1", SLEEP), outPorts: { out: ["log-1"] } },
          { node: node("log-1", LOG) },
        ]),
        takePorts({ "log-1": OUT_PORT }),
      );

      await run(runner, { isResume: true });

      expect(lastPersisted(updateLogSpy)["workflowStatus"]).toBe(
        WorkflowStatus.Success,
      );
    });
  });
});
