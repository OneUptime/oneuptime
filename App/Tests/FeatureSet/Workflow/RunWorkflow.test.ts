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
  ReturnValue,
} from "Common/Types/Workflow/Component";
import WorkflowStatus from "Common/Types/Workflow/WorkflowStatus";
import logger from "Common/Server/Utils/Logger";
import RunWorkflow, {
  WORKFLOW_LOG_REDACTED_VALUE,
  RunStack,
  StorageMap,
  getRemainingWorkflowTimeInMs,
  redactSensitiveComponentValuesForLogs,
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
  local: {
    variables: {},
    components: {},
  },
  global: {
    variables: {},
  },
};

interface RecordedSpy {
  mock: {
    calls: Array<Array<unknown>>;
  };
}

interface NumberReturningSpy {
  mockReturnValue: (value: number) => NumberReturningSpy;
}

interface WorkflowServiceForTest {
  findOneById: (query: unknown) => Promise<Workflow | null>;
}

interface WorkflowLogServiceForTest {
  updateOneById: (update: unknown) => Promise<void>;
}

function argument(
  id: string,
  isSensitive?: boolean,
  type: ComponentInputType = ComponentInputType.AnyValue,
): Argument {
  return {
    id,
    name: id,
    description: `${id} argument`,
    required: false,
    type,
    ...(isSensitive === undefined ? {} : { isSensitive }),
  };
}

function returnValue(id: string, isSensitive?: boolean): ReturnValue {
  return {
    id,
    name: id,
    description: `${id} return value`,
    required: false,
    type: ComponentInputType.AnyValue,
    ...(isSensitive === undefined ? {} : { isSensitive }),
  };
}

function metadata(params?: {
  arguments?: Array<Argument>;
  returnValues?: Array<ReturnValue>;
}): ComponentMetadata {
  return {
    id: "TestWorkflowComponent",
    title: "Test workflow component",
    category: "Test",
    description: "Component metadata used by the workflow runner tests.",
    iconProp: IconProp.Workflow,
    componentType: ComponentType.Trigger,
    arguments: params?.arguments || [],
    returnValues: params?.returnValues || [],
    inPorts: [],
    outPorts: [],
  };
}

function node(componentMetadata: ComponentMetadata): NodeDataProp {
  return {
    error: "",
    id: "test-node",
    internalId: "test-node-internal",
    nodeType: NodeType.Node,
    metadata: componentMetadata,
    metadataId: componentMetadata.id,
    arguments: {},
    returnValues: {},
    componentType: ComponentType.Trigger,
  };
}

function workflow(): Workflow {
  const result: Workflow = new Workflow();
  result.id = WORKFLOW_ID;
  result.projectId = PROJECT_ID;
  result.isEnabled = true;
  result.graph = {
    nodes: [],
    edges: [],
  };
  return result;
}

function prepareSingleComponentRun(
  runner: RunWorkflow,
  componentNode: NodeDataProp,
): RecordedSpy {
  const workflowServiceForTest: WorkflowServiceForTest =
    WorkflowService as unknown as WorkflowServiceForTest;
  const workflowLogServiceForTest: WorkflowLogServiceForTest =
    WorkflowLogService as unknown as WorkflowLogServiceForTest;

  jest
    .spyOn(workflowServiceForTest, "findOneById")
    .mockResolvedValue(workflow());

  const updateLogSpy: RecordedSpy = jest
    .spyOn(workflowLogServiceForTest, "updateOneById")
    .mockResolvedValue(undefined) as unknown as RecordedSpy;

  const runStack: RunStack = {
    startWithComponentId: componentNode.id,
    stack: {
      [componentNode.id]: {
        node: componentNode,
        outPorts: {},
      },
    },
  };

  jest.spyOn(runner, "makeRunStack").mockResolvedValue(runStack);
  jest.spyOn(runner, "getVariables").mockResolvedValue({
    storageMap: EMPTY_STORAGE_MAP,
    variables: [],
  });

  return updateLogSpy;
}

function getLastPersistedLog(updateLogSpy: RecordedSpy): {
  logs: string;
  workflowStatus: WorkflowStatus;
} {
  const lastCallIndex: number = updateLogSpy.mock.calls.length - 1;
  const lastCall: unknown = updateLogSpy.mock.calls[lastCallIndex]?.[0];
  const data: unknown = (lastCall as { data?: unknown } | undefined)?.data;

  return data as { logs: string; workflowStatus: WorkflowStatus };
}

describe("redactSensitiveComponentValuesForLogs", () => {
  test("redacts only fields explicitly marked sensitive", () => {
    const values: JSONObject = {
      prompt: "private prompt",
      temperature: 0.2,
      context: { incidentId: "incident-1" },
    };

    expect(
      redactSensitiveComponentValuesForLogs(values, [
        argument("prompt", true),
        argument("temperature", false),
        argument("context"),
      ]),
    ).toEqual({
      prompt: WORKFLOW_LOG_REDACTED_VALUE,
      temperature: 0.2,
      context: { incidentId: "incident-1" },
    });
  });

  test("replaces the entire value for every supported JSON shape", () => {
    const values: JSONObject = {
      text: "secret",
      number: 42,
      boolean: false,
      object: { nested: "secret" },
      array: ["secret", { nested: true }],
      nullable: null,
    };
    const fields: Array<Argument> = Object.keys(values).map((id: string) => {
      return argument(id, true);
    });

    expect(redactSensitiveComponentValuesForLogs(values, fields)).toEqual({
      text: WORKFLOW_LOG_REDACTED_VALUE,
      number: WORKFLOW_LOG_REDACTED_VALUE,
      boolean: WORKFLOW_LOG_REDACTED_VALUE,
      object: WORKFLOW_LOG_REDACTED_VALUE,
      array: WORKFLOW_LOG_REDACTED_VALUE,
      nullable: WORKFLOW_LOG_REDACTED_VALUE,
    });
  });

  test("works with return-value metadata as well as argument metadata", () => {
    expect(
      redactSensitiveComponentValuesForLogs(
        {
          response: "model response",
          tokenCount: 15,
        },
        [returnValue("response", true), returnValue("tokenCount")],
      ),
    ).toEqual({
      response: WORKFLOW_LOG_REDACTED_VALUE,
      tokenCount: 15,
    });
  });

  test("does not mutate the values object or its nested values", () => {
    const nestedContext: JSONObject = { incidentId: "incident-1" };
    const values: JSONObject = {
      prompt: "private prompt",
      context: nestedContext,
    };

    const redacted: JSONObject = redactSensitiveComponentValuesForLogs(values, [
      argument("prompt", true),
      argument("context"),
    ]);

    expect(redacted).not.toBe(values);
    expect(values).toEqual({
      prompt: "private prompt",
      context: { incidentId: "incident-1" },
    });
    expect(redacted["context"]).toBe(nestedContext);
  });

  test("preserves values that have no corresponding metadata", () => {
    const values: JSONObject = {
      documented: "public",
      extraRuntimeValue: "also public",
    };

    expect(
      redactSensitiveComponentValuesForLogs(values, [argument("documented")]),
    ).toEqual(values);
  });

  test("does not invent keys for sensitive metadata absent from the values", () => {
    expect(
      redactSensitiveComponentValuesForLogs({ present: "public" }, [
        argument("present"),
        argument("missingSecret", true),
      ]),
    ).toEqual({ present: "public" });
  });

  test("handles empty values and metadata", () => {
    expect(redactSensitiveComponentValuesForLogs({}, [])).toEqual({});
    expect(
      redactSensitiveComponentValuesForLogs({ value: "public" }, []),
    ).toEqual({ value: "public" });
  });
});

describe("getRemainingWorkflowTimeInMs", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("returns the exact time remaining before the deadline", () => {
    expect(getRemainingWorkflowTimeInMs(2_500, 1_000)).toBe(1_500);
  });

  test("returns zero at the deadline", () => {
    expect(getRemainingWorkflowTimeInMs(1_000, 1_000)).toBe(0);
  });

  test("clamps an elapsed deadline to zero", () => {
    expect(getRemainingWorkflowTimeInMs(1_000, 2_500)).toBe(0);
  });

  test("uses the current clock when nowInMs is omitted", () => {
    jest.spyOn(Date, "now").mockReturnValue(10_000);

    expect(getRemainingWorkflowTimeInMs(10_123)).toBe(123);
  });

  test("does not round fractional remaining milliseconds", () => {
    expect(getRemainingWorkflowTimeInMs(10.75, 10.25)).toBe(0.5);
  });
});

describe("RunWorkflow sensitive logging and deadlines", () => {
  beforeEach(() => {
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("passes sensitive inputs to the component but redacts inputs and outputs from persisted logs", async () => {
    const componentMetadata: ComponentMetadata = metadata({
      arguments: [
        argument("prompt", true),
        argument("context", true),
        argument("temperature"),
      ],
      returnValues: [
        returnValue("response", true),
        returnValue("provider"),
        returnValue("tokenCount"),
      ],
    });
    const componentNode: NodeDataProp = node(componentMetadata);
    componentNode.arguments = {
      prompt: "summarize private incident INC-123",
      context: { customerEmail: "private@example.com" },
      temperature: 0.2,
    };

    const runner: RunWorkflow = new RunWorkflow();
    const updateLogSpy: RecordedSpy = prepareSingleComponentRun(
      runner,
      componentNode,
    );

    const returnValues: JSONObject = {
      response: "private model response",
      provider: "OpenAI",
      tokenCount: 27,
    };
    const runComponentSpy: RecordedSpy = jest
      .spyOn(runner, "runComponent")
      .mockResolvedValue({ returnValues }) as unknown as RecordedSpy;

    await runner.runWorkflow({
      arguments: {},
      workflowId: WORKFLOW_ID,
      workflowLogId: WORKFLOW_LOG_ID,
      timeout: 5_000,
    });

    expect(runComponentSpy).toHaveBeenCalledWith(
      {
        prompt: "summarize private incident INC-123",
        context: { customerEmail: "private@example.com" },
        temperature: 0.2,
      },
      componentNode,
      expect.any(Function),
    );
    expect(returnValues).toEqual({
      response: "private model response",
      provider: "OpenAI",
      tokenCount: 27,
    });

    const persisted: { logs: string; workflowStatus: WorkflowStatus } =
      getLastPersistedLog(updateLogSpy);

    expect(persisted.workflowStatus).toBe(WorkflowStatus.Success);
    expect(persisted.logs).toContain(WORKFLOW_LOG_REDACTED_VALUE);
    expect(persisted.logs).toContain('"temperature":0.2');
    expect(persisted.logs).toContain('"provider":"OpenAI"');
    expect(persisted.logs).toContain('"tokenCount":27');
    expect(persisted.logs).not.toContain("INC-123");
    expect(persisted.logs).not.toContain("private@example.com");
    expect(persisted.logs).not.toContain("private model response");
  });

  test("does not persist raw values or parser details when sensitive JSON is invalid", async () => {
    const componentMetadata: ComponentMetadata = metadata({
      arguments: [
        argument("context", true, ComponentInputType.JSON),
        argument("label"),
      ],
    });
    const componentNode: NodeDataProp = node(componentMetadata);
    componentNode.arguments = {
      context: '{"apiKey":"super-secret-key"',
      label: "public label",
    };

    const runner: RunWorkflow = new RunWorkflow();
    const updateLogSpy: RecordedSpy = prepareSingleComponentRun(
      runner,
      componentNode,
    );
    const runComponentSpy: RecordedSpy = jest.spyOn(
      runner,
      "runComponent",
    ) as unknown as RecordedSpy;

    await runner.runWorkflow({
      arguments: {},
      workflowId: WORKFLOW_ID,
      workflowLogId: WORKFLOW_LOG_ID,
      timeout: 5_000,
    });

    const persisted: { logs: string; workflowStatus: WorkflowStatus } =
      getLastPersistedLog(updateLogSpy);

    expect(runComponentSpy.mock.calls).toHaveLength(0);
    expect(persisted.workflowStatus).toBe(WorkflowStatus.Error);
    expect(persisted.logs).toContain("Invalid JSON");
    expect(persisted.logs).toContain("context");
    expect(persisted.logs).not.toContain("super-secret-key");
    expect(persisted.logs).not.toContain("apiKey");
    expect(persisted.logs).not.toContain("JSON parse error");
    expect(persisted.logs).not.toContain("Unexpected");
  });

  test("marks the run timed out when a component returns after its deadline", async () => {
    const startedAtInMs: number = Date.parse("2026-07-14T12:00:00.000Z");
    const dateNowSpy: NumberReturningSpy = jest
      .spyOn(Date, "now")
      .mockReturnValue(startedAtInMs) as unknown as NumberReturningSpy;

    const componentNode: NodeDataProp = node(metadata());
    const runner: RunWorkflow = new RunWorkflow();
    const updateLogSpy: RecordedSpy = prepareSingleComponentRun(
      runner,
      componentNode,
    );

    jest
      .spyOn(runner, "runComponent")
      .mockImplementation(async (): Promise<{ returnValues: JSONObject }> => {
        dateNowSpy.mockReturnValue(startedAtInMs + 101);
        return { returnValues: { value: "completed too late" } };
      });

    await runner.runWorkflow({
      arguments: {},
      workflowId: WORKFLOW_ID,
      workflowLogId: WORKFLOW_LOG_ID,
      timeout: 100,
    });

    const persisted: { logs: string; workflowStatus: WorkflowStatus } =
      getLastPersistedLog(updateLogSpy);

    expect(persisted.workflowStatus).toBe(WorkflowStatus.Timeout);
    expect(persisted.logs).toContain("Workflow Timed out.");
    expect(persisted.logs).not.toContain("completed too late");
  });

  test("does not start a component when no execution time remains", async () => {
    jest.spyOn(Date, "now").mockReturnValue(1_000);

    const componentNode: NodeDataProp = node(metadata());
    const runner: RunWorkflow = new RunWorkflow();
    const updateLogSpy: RecordedSpy = prepareSingleComponentRun(
      runner,
      componentNode,
    );
    const runComponentSpy: RecordedSpy = jest.spyOn(
      runner,
      "runComponent",
    ) as unknown as RecordedSpy;

    await runner.runWorkflow({
      arguments: {},
      workflowId: WORKFLOW_ID,
      workflowLogId: WORKFLOW_LOG_ID,
      timeout: 0,
    });

    const persisted: { logs: string; workflowStatus: WorkflowStatus } =
      getLastPersistedLog(updateLogSpy);

    expect(runComponentSpy.mock.calls).toHaveLength(0);
    expect(persisted.workflowStatus).toBe(WorkflowStatus.Timeout);
    expect(persisted.logs).toContain("Workflow Timed out.");
    expect(persisted.logs).not.toContain("Executing Component");
  });
});
