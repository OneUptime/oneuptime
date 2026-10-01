/*
 * The runner keeps, beside a returned value too big to keep whole, a cut-down
 * copy of the same shape (WorkflowStepTraceEntry.returnValueSamples). The
 * builder's value picker lists the fields of a large webhook body from it.
 *
 * It is persisted with the run and read by anyone who can read the run, so
 * it must hide everything the rest of the trace hides.
 */

import Workflow from "Common/Models/DatabaseModels/Workflow";
import WorkflowVariable from "Common/Models/DatabaseModels/WorkflowVariable";
import WorkflowLogService from "Common/Server/Services/WorkflowLogService";
import WorkflowService from "Common/Server/Services/WorkflowService";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import ComponentMetadata, {
  ComponentInputType,
  ComponentType,
  NodeDataProp,
  NodeType,
  Port,
  ReturnValue,
} from "Common/Types/Workflow/Component";
import {
  MAX_TRACE_VALUE_LENGTH,
  TRUNCATED_VALUE_SUFFIX,
  WorkflowStepStatus,
  WorkflowStepTrace,
  WorkflowStepTraceEntry,
  parseTrace,
} from "Common/Types/Workflow/StepTrace";
import {
  StepSample,
  StepSampleField,
  collectStepSamples,
} from "Common/Types/Workflow/StepSamples";
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

const OUT_PORT: Port = { id: "out", title: "Out", description: "Out" };

type ReturnValueFunction = (id: string, isSensitive?: boolean) => ReturnValue;

const returnValue: ReturnValueFunction = (
  id: string,
  isSensitive?: boolean,
): ReturnValue => {
  return {
    id: id,
    name: id,
    description: id,
    type: ComponentInputType.JSON,
    required: false,
    isSensitive: isSensitive,
  };
};

type NodeFunction = (returnValues: Array<ReturnValue>) => NodeDataProp;

const node: NodeFunction = (returnValues: Array<ReturnValue>): NodeDataProp => {
  const metadata: ComponentMetadata = {
    id: "webhook",
    title: "Webhook",
    category: "Webhook",
    description: "For tests",
    iconProp: IconProp.Bolt,
    componentType: ComponentType.Trigger,
    arguments: [],
    returnValues: returnValues,
    inPorts: [],
    outPorts: [OUT_PORT],
  };

  return {
    error: "",
    id: "webhook-1",
    nodeType: NodeType.Node,
    metadata: metadata,
    metadataId: metadata.id,
    internalId: "internal-1",
    arguments: {},
    returnValues: {},
    componentType: ComponentType.Trigger,
  };
};

type PrepareFunction = (
  runner: RunWorkflow,
  componentNode: NodeDataProp,
  variables?: Array<WorkflowVariable>,
) => RecordedSpy;

const prepareRun: PrepareFunction = (
  runner: RunWorkflow,
  componentNode: NodeDataProp,
  variables: Array<WorkflowVariable> = [],
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
    variables: variables,
  } as never);

  return updateLogSpy;
};

type LastEntryFunction = (updateLogSpy: RecordedSpy) => WorkflowStepTraceEntry;

const lastEntry: LastEntryFunction = (
  updateLogSpy: RecordedSpy,
): WorkflowStepTraceEntry => {
  const lastCall: unknown =
    updateLogSpy.mock.calls[updateLogSpy.mock.calls.length - 1]?.[0];
  const data: JSONObject = (lastCall as { data: JSONObject }).data;
  const trace: WorkflowStepTrace = parseTrace(data["stepTrace"] as never);

  return trace.steps[0] as WorkflowStepTraceEntry;
};

type BigBodyFunction = () => JSONObject;

// A webhook body well over the trace's limit, like a real event.
const bigBody: BigBodyFunction = (): JSONObject => {
  const commits: JSONArray = [];

  for (let index: number = 0; index < 50; index++) {
    commits.push({
      id: `commit-${index}`,
      message: "m".repeat(150),
      author: { name: "Ada", email: "ada@example.com" },
    });
  }

  return {
    ref: "refs/heads/main",
    repository: { full_name: "acme/api", default_branch: "main" },
    commits: commits,
  };
};

type RunWithFunction = (data: {
  returnValues: JSONObject;
  metadata: Array<ReturnValue>;
  variables?: Array<WorkflowVariable> | undefined;
}) => Promise<WorkflowStepTraceEntry>;

const runWith: RunWithFunction = async (data: {
  returnValues: JSONObject;
  metadata: Array<ReturnValue>;
  variables?: Array<WorkflowVariable> | undefined;
}): Promise<WorkflowStepTraceEntry> => {
  const componentNode: NodeDataProp = node(data.metadata);
  const runner: RunWorkflow = new RunWorkflow();
  const updateLogSpy: RecordedSpy = prepareRun(
    runner,
    componentNode,
    data.variables,
  );

  jest.spyOn(runner, "runComponent").mockResolvedValue({
    returnValues: data.returnValues,
    executePort: OUT_PORT,
  } as never);

  await runner.runWorkflow({
    arguments: {},
    workflowId: WORKFLOW_ID,
    workflowLogId: WORKFLOW_LOG_ID,
    timeout: 5000,
  });

  return lastEntry(updateLogSpy);
};

describe("RunWorkflow: a cut-down copy of a value too big to keep", () => {
  beforeEach(() => {
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("is kept beside the cut-off text, with the value's shape, within the limit", async () => {
    const step: WorkflowStepTraceEntry = await runWith({
      returnValues: {
        "request-body": bigBody(),
        "request-headers": { host: "example.com" },
      },
      metadata: [returnValue("request-body"), returnValue("request-headers")],
    });

    // What the Steps view shows: the value cut off, as text.
    expect(
      (step.returnValues["request-body"] as string).endsWith(
        TRUNCATED_VALUE_SUFFIX,
      ),
    ).toBe(true);

    const sample: JSONObject = step.returnValueSamples?.[
      "request-body"
    ] as JSONObject;

    expect(sample).toBeDefined();
    expect(JSON.stringify(sample).length).toBeLessThanOrEqual(
      MAX_TRACE_VALUE_LENGTH,
    );
    expect(sample["ref"]).toBe("refs/heads/main");
    expect((sample["repository"] as JSONObject)["full_name"]).toBe("acme/api");
    expect(((sample["commits"] as JSONArray)[0] as JSONObject)["id"]).toBe(
      "commit-0",
    );

    // A value that fitted is in returnValues whole, and needs no copy.
    expect(step.returnValueSamples?.["request-headers"]).toBeUndefined();
  });

  test("is not kept when every value fits", async () => {
    const step: WorkflowStepTraceEntry = await runWith({
      returnValues: { "request-body": { small: true } },
      metadata: [returnValue("request-body")],
    });

    expect(step.returnValueSamples).toBeUndefined();
    expect(step.status).toBe(WorkflowStepStatus.Success);
  });

  test("lets the picker list the fields of the large body", async () => {
    const step: WorkflowStepTraceEntry = await runWith({
      returnValues: { "request-body": bigBody() },
      metadata: [returnValue("request-body")],
    });

    const samples: Array<StepSample> = collectStepSamples([
      {
        createdAt: "2026-10-01T12:00:00.000Z",
        stepTrace: { steps: [step] } as unknown as JSONObject,
      },
    ]);
    const paths: Array<string> = samples[0]!.returnValues[
      "request-body"
    ]!.fields.map((field: StepSampleField) => {
      return field.path;
    });

    expect(paths).toEqual(
      expect.arrayContaining([
        "ref",
        "repository.full_name",
        "commits[0].id",
        "commits[0].author.name",
      ]),
    );
  });

  test("a sensitive return value is redacted in it as everywhere else", async () => {
    const step: WorkflowStepTraceEntry = await runWith({
      returnValues: {
        "request-body": { ...bigBody(), token: "super-secret-token" },
      },
      metadata: [returnValue("request-body", true)],
    });

    expect(step.returnValues["request-body"]).toBe(WORKFLOW_LOG_REDACTED_VALUE);
    expect(step.returnValueSamples).toBeUndefined();
    expect(JSON.stringify(step)).not.toContain("super-secret-token");
  });

  test("a secret variable's value never reaches it", async () => {
    const secret: WorkflowVariable = new WorkflowVariable();
    secret.content = "s3cr3t-variable-value";
    secret.isSecret = "true";

    const body: JSONObject = bigBody();
    body["echoed"] = "the key was s3cr3t-variable-value";
    body["s3cr3t-variable-value"] = "used as a key";

    const step: WorkflowStepTraceEntry = await runWith({
      returnValues: { "request-body": body },
      metadata: [returnValue("request-body")],
      variables: [secret],
    });

    expect(step.returnValueSamples?.["request-body"]).toBeDefined();
    expect(JSON.stringify(step.returnValueSamples)).not.toContain(
      "s3cr3t-variable-value",
    );
    expect(JSON.stringify(step)).not.toContain("s3cr3t-variable-value");
  });

  test("the second redaction pass before the trace is saved covers it too", () => {
    const secret: WorkflowVariable = new WorkflowVariable();
    secret.content = "restored-secret";
    secret.isSecret = "true";

    const runner: RunWorkflow = new RunWorkflow();
    const trace: WorkflowStepTrace = {
      steps: [
        {
          componentId: "webhook-1",
          metadataId: "webhook",
          title: "Webhook",
          status: WorkflowStepStatus.Success,
          startedAt: "2026-10-01T12:00:00.000Z",
          completedAt: "2026-10-01T12:00:00.100Z",
          durationInMs: 100,
          argumentValues: {},
          returnValues: {},
          executedPort: "out",
          // As restored from a run that slept, written by an older build.
          returnValueSamples: {
            "request-body": { leaked: "restored-secret" },
          },
        },
      ],
    };

    (runner as unknown as { stepTrace: WorkflowStepTrace }).stepTrace = trace;

    runner.cleanLogs([secret]);

    const cleaned: WorkflowStepTrace = (
      runner as unknown as { stepTrace: WorkflowStepTrace }
    ).stepTrace;

    expect(JSON.stringify(cleaned)).not.toContain("restored-secret");
    expect(
      (cleaned.steps[0]!.returnValueSamples!["request-body"] as JSONObject)[
        "leaked"
      ],
    ).toBe(WORKFLOW_LOG_REDACTED_VALUE);
  });
});
