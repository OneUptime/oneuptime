/*
 * The runner's side of the step trace: that a run records what each step did,
 * that the trace is persisted with the run's final status, and — the part that
 * matters most — that it redacts exactly what the text log redacts. The trace
 * is readable by anyone who can read the log, so a secret hidden from one and
 * not the other would be a leak dressed up as a feature.
 */

import Workflow from "Common/Models/DatabaseModels/Workflow";
import WorkflowLogService from "Common/Server/Services/WorkflowLogService";
import WorkflowService from "Common/Server/Services/WorkflowService";
import { JSONObject } from "Common/Types/JSON";
import IconProp from "Common/Types/Icon/IconProp";
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
import WorkflowStatus from "Common/Types/Workflow/WorkflowStatus";
import {
  WorkflowStepStatus,
  WorkflowStepTrace,
  WorkflowStepTraceEntry,
  parseTrace,
} from "Common/Types/Workflow/StepTrace";
import logger from "Common/Server/Utils/Logger";
import RunWorkflow, {
  RunStack,
  StorageMap,
  WORKFLOW_LOG_REDACTED_VALUE,
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

const EMPTY_STORAGE_MAP: StorageMap = {
  local: { variables: {}, components: {} },
  global: { variables: {} },
};

interface RecordedSpy {
  mock: { calls: Array<Array<unknown>> };
}

type ArgumentFunction = (id: string, isSensitive?: boolean) => Argument;

const argument: ArgumentFunction = (
  id: string,
  isSensitive?: boolean,
): Argument => {
  return {
    id: id,
    name: id,
    description: id,
    type: ComponentInputType.Text,
    required: false,
    isSensitive: isSensitive,
  };
};

type ReturnValueFunction = (id: string, isSensitive?: boolean) => ReturnValue;

const returnValue: ReturnValueFunction = (
  id: string,
  isSensitive?: boolean,
): ReturnValue => {
  return {
    id: id,
    name: id,
    description: id,
    type: ComponentInputType.Text,
    required: false,
    isSensitive: isSensitive,
  };
};

const SUCCESS_PORT: Port = {
  id: "success",
  title: "Success",
  description: "Success",
};

/*
 * The port a database component takes when it catches its own error. Its id is
 * the contract: BaseModelComponents build every find/create/update component
 * with an out port literally called "error", and the runner recognises a
 * failure by that id.
 */
const ERROR_PORT: Port = {
  id: "error",
  title: "Error",
  description: "Error",
};

type MetadataFunction = (params: {
  args?: Array<Argument> | undefined;
  returnValues?: Array<ReturnValue> | undefined;
}) => ComponentMetadata;

const metadata: MetadataFunction = (params: {
  args?: Array<Argument> | undefined;
  returnValues?: Array<ReturnValue> | undefined;
}): ComponentMetadata => {
  return {
    id: "test-component",
    title: "Test Component",
    category: "Test",
    description: "For tests",
    iconProp: IconProp.Bolt,
    componentType: ComponentType.Component,
    arguments: params.args || [],
    returnValues: params.returnValues || [],
    inPorts: [],
    // Both ports, like every database component declares.
    outPorts: [SUCCESS_PORT, ERROR_PORT],
  };
};

type NodeFunction = (componentMetadata: ComponentMetadata) => NodeDataProp;

const node: NodeFunction = (
  componentMetadata: ComponentMetadata,
): NodeDataProp => {
  return {
    error: "",
    id: "test-component-1",
    nodeType: NodeType.Node,
    metadata: componentMetadata,
    metadataId: componentMetadata.id,
    internalId: "internal-1",
    arguments: {},
    returnValues: {},
    componentType: ComponentType.Component,
  };
};

type PrepareFunction = (
  runner: RunWorkflow,
  componentNode: NodeDataProp,
) => RecordedSpy;

const prepareSingleComponentRun: PrepareFunction = (
  runner: RunWorkflow,
  componentNode: NodeDataProp,
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

  const runStack: RunStack = {
    startWithComponentId: componentNode.id,
    stack: { [componentNode.id]: { node: componentNode, outPorts: {} } },
  };

  jest.spyOn(runner, "makeRunStack").mockResolvedValue(runStack as never);
  jest.spyOn(runner, "getVariables").mockResolvedValue({
    storageMap: EMPTY_STORAGE_MAP,
    variables: [],
  } as never);

  return updateLogSpy;
};

type LastTraceFunction = (updateLogSpy: RecordedSpy) => WorkflowStepTrace;

const lastPersistedTrace: LastTraceFunction = (
  updateLogSpy: RecordedSpy,
): WorkflowStepTrace => {
  const lastCall: unknown =
    updateLogSpy.mock.calls[updateLogSpy.mock.calls.length - 1]?.[0];
  const data: JSONObject = (lastCall as { data: JSONObject }).data;

  return parseTrace(data["stepTrace"] as never);
};

describe("RunWorkflow step trace", () => {
  beforeEach(() => {
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("records the step that ran, with its component and port", async () => {
    const componentNode: NodeDataProp = node(
      metadata({ args: [argument("message")] }),
    );
    componentNode.arguments = { message: "hello" };

    const runner: RunWorkflow = new RunWorkflow();
    const updateLogSpy: RecordedSpy = prepareSingleComponentRun(
      runner,
      componentNode,
    );

    jest.spyOn(runner, "runComponent").mockResolvedValue({
      returnValues: { result: "done" },
      executePort: SUCCESS_PORT,
    } as never);

    await runner.runWorkflow({
      arguments: {},
      workflowId: WORKFLOW_ID,
      workflowLogId: WORKFLOW_LOG_ID,
      timeout: 5000,
    });

    const trace: WorkflowStepTrace = lastPersistedTrace(updateLogSpy);
    const step: WorkflowStepTraceEntry = trace
      .steps[0] as WorkflowStepTraceEntry;

    expect(trace.steps).toHaveLength(1);
    expect(step.componentId).toBe("test-component-1");
    expect(step.metadataId).toBe("test-component");
    expect(step.title).toBe("Test Component");
    expect(step.status).toBe(WorkflowStepStatus.Success);
    expect(step.executedPort).toBe("success");
    expect(step.argumentValues).toEqual({ message: "hello" });
    expect(step.returnValues).toEqual({ result: "done" });
  });

  test("records timing that is present and not negative", async () => {
    const componentNode: NodeDataProp = node(metadata({}));

    const runner: RunWorkflow = new RunWorkflow();
    const updateLogSpy: RecordedSpy = prepareSingleComponentRun(
      runner,
      componentNode,
    );

    jest
      .spyOn(runner, "runComponent")
      .mockResolvedValue({ returnValues: {} } as never);

    await runner.runWorkflow({
      arguments: {},
      workflowId: WORKFLOW_ID,
      workflowLogId: WORKFLOW_LOG_ID,
      timeout: 5000,
    });

    const step: WorkflowStepTraceEntry = lastPersistedTrace(updateLogSpy)
      .steps[0] as WorkflowStepTraceEntry;

    expect(step.durationInMs).toBeGreaterThanOrEqual(0);
    expect(Date.parse(step.startedAt)).not.toBeNaN();
    expect(Date.parse(step.completedAt)).not.toBeNaN();
  });

  /*
   * The trace carries the same values the text log does and is readable by the
   * same people, so it has to hide the same things.
   */
  test("redacts sensitive arguments exactly as the log does", async () => {
    const componentNode: NodeDataProp = node(
      metadata({
        args: [argument("apiKey", true), argument("url")],
        returnValues: [returnValue("token", true), returnValue("status")],
      }),
    );
    componentNode.arguments = {
      apiKey: "super-secret",
      url: "https://example.com",
    };

    const runner: RunWorkflow = new RunWorkflow();
    const updateLogSpy: RecordedSpy = prepareSingleComponentRun(
      runner,
      componentNode,
    );

    jest.spyOn(runner, "runComponent").mockResolvedValue({
      returnValues: { token: "secret-token", status: 200 },
      executePort: SUCCESS_PORT,
    } as never);

    await runner.runWorkflow({
      arguments: {},
      workflowId: WORKFLOW_ID,
      workflowLogId: WORKFLOW_LOG_ID,
      timeout: 5000,
    });

    const step: WorkflowStepTraceEntry = lastPersistedTrace(updateLogSpy)
      .steps[0] as WorkflowStepTraceEntry;

    expect(step.argumentValues["apiKey"]).toBe(WORKFLOW_LOG_REDACTED_VALUE);
    expect(step.argumentValues["url"]).toBe("https://example.com");
    expect(step.returnValues["token"]).toBe(WORKFLOW_LOG_REDACTED_VALUE);
    expect(step.returnValues["status"]).toBe(200);
  });

  test("the secret never appears anywhere in the persisted trace", async () => {
    const componentNode: NodeDataProp = node(
      metadata({ args: [argument("apiKey", true)] }),
    );
    componentNode.arguments = { apiKey: "super-secret-value" };

    const runner: RunWorkflow = new RunWorkflow();
    const updateLogSpy: RecordedSpy = prepareSingleComponentRun(
      runner,
      componentNode,
    );

    jest
      .spyOn(runner, "runComponent")
      .mockResolvedValue({ returnValues: {} } as never);

    await runner.runWorkflow({
      arguments: {},
      workflowId: WORKFLOW_ID,
      workflowLogId: WORKFLOW_LOG_ID,
      timeout: 5000,
    });

    const serialized: string = JSON.stringify(lastPersistedTrace(updateLogSpy));

    expect(serialized).not.toContain("super-secret-value");
  });

  /*
   * The step that broke the run is the one worth reading, so it has to be in
   * the trace even though the failure aborts the loop.
   */
  test("records the failing step when a component throws", async () => {
    const componentNode: NodeDataProp = node(metadata({}));

    const runner: RunWorkflow = new RunWorkflow();
    const updateLogSpy: RecordedSpy = prepareSingleComponentRun(
      runner,
      componentNode,
    );

    jest
      .spyOn(runner, "runComponent")
      .mockRejectedValue(new Error("component exploded") as never);

    await runner.runWorkflow({
      arguments: {},
      workflowId: WORKFLOW_ID,
      workflowLogId: WORKFLOW_LOG_ID,
      timeout: 5000,
    });

    const trace: WorkflowStepTrace = lastPersistedTrace(updateLogSpy);
    const step: WorkflowStepTraceEntry = trace
      .steps[0] as WorkflowStepTraceEntry;

    expect(trace.steps).toHaveLength(1);
    expect(step.status).toBe(WorkflowStepStatus.Error);
    expect(step.errorMessage).toContain("component exploded");
  });

  /*
   * The failure a builder is most likely to be staring at never threw and never
   * called options.onError. Every database component catches its own error,
   * logs it, and returns { executePort: errorPort } — FindOneBaseModel does it
   * in the catch at the end of run(), and its siblings copy it. So the runner
   * saw no errorMessage, and the step that failed was recorded green: the trace
   * showed a check mark over the exact row that had gone wrong.
   */
  test("records a step that left by the error port as a failure, with nothing thrown", async () => {
    const componentNode: NodeDataProp = node(metadata({}));

    const runner: RunWorkflow = new RunWorkflow();
    const updateLogSpy: RecordedSpy = prepareSingleComponentRun(
      runner,
      componentNode,
    );

    jest.spyOn(runner, "runComponent").mockResolvedValue({
      returnValues: {},
      executePort: ERROR_PORT,
    } as never);

    await runner.runWorkflow({
      arguments: {},
      workflowId: WORKFLOW_ID,
      workflowLogId: WORKFLOW_LOG_ID,
      timeout: 5000,
    });

    const step: WorkflowStepTraceEntry = lastPersistedTrace(updateLogSpy)
      .steps[0] as WorkflowStepTraceEntry;

    expect(step.status).toBe(WorkflowStepStatus.Error);
    /*
     * No message, on purpose: the status has to come from the port alone, since
     * a component that returns its error port supplies nothing else.
     */
    expect(step.errorMessage).toBeUndefined();
  });

  test("still records which port the failed step left by", async () => {
    const componentNode: NodeDataProp = node(metadata({}));

    const runner: RunWorkflow = new RunWorkflow();
    const updateLogSpy: RecordedSpy = prepareSingleComponentRun(
      runner,
      componentNode,
    );

    jest.spyOn(runner, "runComponent").mockResolvedValue({
      returnValues: { model: null },
      executePort: ERROR_PORT,
    } as never);

    await runner.runWorkflow({
      arguments: {},
      workflowId: WORKFLOW_ID,
      workflowLogId: WORKFLOW_LOG_ID,
      timeout: 5000,
    });

    const step: WorkflowStepTraceEntry = lastPersistedTrace(updateLogSpy)
      .steps[0] as WorkflowStepTraceEntry;

    expect(step.executedPort).toBe("error");
    expect(step.returnValues).toEqual({ model: null });
  });

  test("a step that left by the success port is still a success", async () => {
    const componentNode: NodeDataProp = node(metadata({}));

    const runner: RunWorkflow = new RunWorkflow();
    const updateLogSpy: RecordedSpy = prepareSingleComponentRun(
      runner,
      componentNode,
    );

    jest.spyOn(runner, "runComponent").mockResolvedValue({
      returnValues: {},
      executePort: SUCCESS_PORT,
    } as never);

    await runner.runWorkflow({
      arguments: {},
      workflowId: WORKFLOW_ID,
      workflowLogId: WORKFLOW_LOG_ID,
      timeout: 5000,
    });

    const step: WorkflowStepTraceEntry = lastPersistedTrace(updateLogSpy)
      .steps[0] as WorkflowStepTraceEntry;

    expect(step.status).toBe(WorkflowStepStatus.Success);
    expect(step.executedPort).toBe("success");
    expect(step.errorMessage).toBeUndefined();
  });

  /*
   * The other half of the pair: a component that reports through
   * options.onError and then leaves by a port that is not "error". The message
   * still decides, so the port check can only ever add failures, never hide
   * one.
   */
  test("records a step with an error message as a failure whatever port it left by", async () => {
    const componentNode: NodeDataProp = node(metadata({}));

    const runner: RunWorkflow = new RunWorkflow();
    const updateLogSpy: RecordedSpy = prepareSingleComponentRun(
      runner,
      componentNode,
    );

    jest.spyOn(runner, "runComponent").mockImplementation((async (
      _args: JSONObject,
      _componentToRun: NodeDataProp,
      onError: VoidFunction,
    ): Promise<unknown> => {
      onError();

      return { returnValues: {}, executePort: SUCCESS_PORT };
    }) as never);

    await runner.runWorkflow({
      arguments: {},
      workflowId: WORKFLOW_ID,
      workflowLogId: WORKFLOW_LOG_ID,
      timeout: 5000,
    });

    const step: WorkflowStepTraceEntry = lastPersistedTrace(updateLogSpy)
      .steps[0] as WorkflowStepTraceEntry;

    expect(step.status).toBe(WorkflowStepStatus.Error);
    expect(step.executedPort).toBe("success");
    expect(step.errorMessage).toBe("The component reported an error.");
  });

  /*
   * A throw never reaches a port at all, so the trace has to say so rather than
   * leaving the last port it happened to know about.
   */
  test("records no port for a step that threw", async () => {
    const componentNode: NodeDataProp = node(metadata({}));

    const runner: RunWorkflow = new RunWorkflow();
    const updateLogSpy: RecordedSpy = prepareSingleComponentRun(
      runner,
      componentNode,
    );

    jest
      .spyOn(runner, "runComponent")
      .mockRejectedValue(new Error("component exploded") as never);

    await runner.runWorkflow({
      arguments: {},
      workflowId: WORKFLOW_ID,
      workflowLogId: WORKFLOW_LOG_ID,
      timeout: 5000,
    });

    const step: WorkflowStepTraceEntry = lastPersistedTrace(updateLogSpy)
      .steps[0] as WorkflowStepTraceEntry;

    expect(step.status).toBe(WorkflowStepStatus.Error);
    expect(step.errorMessage).toContain("component exploded");
    expect(step.executedPort).toBeNull();
  });

  test("persists the trace alongside the run's final status", async () => {
    const componentNode: NodeDataProp = node(metadata({}));

    const runner: RunWorkflow = new RunWorkflow();
    const updateLogSpy: RecordedSpy = prepareSingleComponentRun(
      runner,
      componentNode,
    );

    jest
      .spyOn(runner, "runComponent")
      .mockResolvedValue({ returnValues: {} } as never);

    await runner.runWorkflow({
      arguments: {},
      workflowId: WORKFLOW_ID,
      workflowLogId: WORKFLOW_LOG_ID,
      timeout: 5000,
    });

    const lastCall: unknown =
      updateLogSpy.mock.calls[updateLogSpy.mock.calls.length - 1]?.[0];
    const data: JSONObject = (lastCall as { data: JSONObject }).data;

    expect(data["workflowStatus"]).toBe(WorkflowStatus.Success);
    expect(data["stepTrace"]).toBeDefined();
  });
});
