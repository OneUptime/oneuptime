/*
 * A Switch / Case step run by the workflow runner itself, end to end: the
 * graph as the builder saves it - nodes without their metadata, connections
 * leaving the Switch / Case by each case's id - read by the real
 * makeRunStack, its cases resolved by getComponentArguments, run by the real
 * step from the registry, and the run followed down the output it took to
 * the real Log steps behind it. Only the database is not real.
 *
 * What a run must do: follow the first case that matches, and only that one
 * (no fallthrough); follow Default when none does, and end there when Default
 * leads nowhere; record in its trace which case it took, by the name the
 * canvas gives it, and why; write a line to its log for each case it
 * checked; stop with a sentence on a case it cannot compare; warn about a
 * {{...}} in a case that resolved to nothing; and keep a secret a case is
 * compared with out of everything it keeps.
 */

import Workflow from "Common/Models/DatabaseModels/Workflow";
import WorkflowVariable from "Common/Models/DatabaseModels/WorkflowVariable";
import WorkflowLogService from "Common/Server/Services/WorkflowLogService";
import WorkflowService from "Common/Server/Services/WorkflowService";
import logger from "Common/Server/Utils/Logger";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { ComponentType, NodeType } from "Common/Types/Workflow/Component";
import ComponentID from "Common/Types/Workflow/ComponentID";
import {
  WorkflowStepStatus,
  WorkflowStepTrace,
  WorkflowStepTraceEntry,
  parseTrace,
} from "Common/Types/Workflow/StepTrace";
import WorkflowStatus from "Common/Types/Workflow/WorkflowStatus";
import RunWorkflow, {
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

const SEVERITY: string = "{{local.components.manual-1.returnValues.severity}}";

interface RecordedSpy {
  mock: { calls: Array<Array<unknown>> };
}

interface GraphNodeSpec {
  componentId: string;
  metadataId: string;
  componentType: ComponentType;
  args?: JSONObject;
}

interface GraphEdgeSpec {
  from: string;
  port: string;
  to: string;
}

/*
 * A graph as the builder saves it (Dashboard Builder.saveGraph): react-flow
 * nodes whose data has no metadata, and edges that name the output they
 * leave from in sourceHandle.
 */
const savedGraph: (
  nodes: Array<GraphNodeSpec>,
  edges: Array<GraphEdgeSpec>,
) => JSONObject = (
  nodes: Array<GraphNodeSpec>,
  edges: Array<GraphEdgeSpec>,
): JSONObject => {
  return JSON.parse(
    JSON.stringify({
      nodes: nodes.map((spec: GraphNodeSpec): JSONObject => {
        return {
          id: `canvas-${spec.componentId}`,
          type: "node",
          position: { x: 0, y: 0 },
          data: {
            id: spec.componentId,
            internalId: `runner-${spec.componentId}`,
            nodeType: NodeType.Node,
            componentType: spec.componentType,
            metadataId: spec.metadataId,
            arguments: spec.args || {},
            returnValues: {},
          },
        };
      }),
      edges: edges.map((spec: GraphEdgeSpec): JSONObject => {
        return {
          id: `${spec.from}-${spec.port}-${spec.to}`,
          source: `canvas-${spec.from}`,
          sourceHandle: spec.port,
          target: `canvas-${spec.to}`,
          targetHandle: "in",
        };
      }),
    }),
  ) as JSONObject;
};

type CaseFunction = (
  id: string,
  comparison: string,
  value?: string,
  compareAs?: string,
) => JSONObject;

const aCase: CaseFunction = (
  id: string,
  comparison: string,
  value: string = "",
  compareAs: string = "text",
): JSONObject => {
  return { id: id, comparison: comparison, value: value, compareAs: compareAs };
};

const SEVERITY_CASES: Array<JSONObject> = [
  aCase("case-1", "==", "Critical Incident"),
  aCase("case-2", "==", "Major Incident"),
];

const MANUAL: GraphNodeSpec = {
  componentId: "manual-1",
  metadataId: ComponentID.Manual,
  componentType: ComponentType.Trigger,
};

type LogNodeFunction = (componentId: string) => GraphNodeSpec;

const logNode: LogNodeFunction = (componentId: string): GraphNodeSpec => {
  return {
    componentId: componentId,
    metadataId: ComponentID.Log,
    componentType: ComponentType.Component,
    args: { value: `${componentId} ran for ${SEVERITY}` },
  };
};

type SwitchNodeFunction = (args: JSONObject) => GraphNodeSpec;

const switchNode: SwitchNodeFunction = (args: JSONObject): GraphNodeSpec => {
  return {
    componentId: "switch-1",
    metadataId: ComponentID.Switch,
    componentType: ComponentType.Component,
    args: args,
  };
};

const ROUTED_NODES: (switchArgs?: JSONObject) => Array<GraphNodeSpec> = (
  switchArgs?: JSONObject,
): Array<GraphNodeSpec> => {
  return [
    MANUAL,
    switchNode(switchArgs || { value: SEVERITY, cases: SEVERITY_CASES }),
    logNode("log-critical"),
    logNode("log-major"),
    logNode("log-other"),
  ];
};

const ROUTED_EDGES: Array<GraphEdgeSpec> = [
  { from: "manual-1", port: "success", to: "switch-1" },
  { from: "switch-1", port: "case-1", to: "log-critical" },
  { from: "switch-1", port: "case-2", to: "log-major" },
  { from: "switch-1", port: "default", to: "log-other" },
];

interface RunResult {
  persisted: JSONObject;
  trace: WorkflowStepTrace;
  logs: string;
  // Every write of the run's log row, whole: everything anyone could read.
  everything: string;
}

interface RunOptionsForTest {
  graph: JSONObject;
  severity?: string;
  variables?: Array<WorkflowVariable>;
  storageMap?: StorageMap;
}

const runGraph: (options: RunOptionsForTest) => Promise<RunResult> = async (
  options: RunOptionsForTest,
): Promise<RunResult> => {
  const runner: RunWorkflow = new RunWorkflow();

  const workflow: Workflow = new Workflow();
  workflow.id = WORKFLOW_ID;
  workflow.projectId = PROJECT_ID;
  workflow.isEnabled = true;
  workflow.name = "Route incidents by severity";
  workflow.graph = options.graph;

  jest
    .spyOn(
      WorkflowService as unknown as {
        findOneById: (query: unknown) => Promise<Workflow | null>;
      },
      "findOneById",
    )
    .mockResolvedValue(workflow);

  const updateLogSpy: RecordedSpy = jest
    .spyOn(
      WorkflowLogService as unknown as {
        updateColumnsByIdWithoutHooks: (update: unknown) => Promise<void>;
      },
      "updateColumnsByIdWithoutHooks",
    )
    .mockResolvedValue(undefined) as unknown as RecordedSpy;

  jest.spyOn(runner, "getVariables").mockResolvedValue({
    storageMap: options.storageMap || {
      local: { variables: {}, components: {} },
      global: { variables: {} },
    },
    variables: options.variables || [],
  });

  await runner.runWorkflow({
    arguments:
      options.severity === undefined ? {} : { severity: options.severity },
    workflowId: WORKFLOW_ID,
    workflowLogId: WORKFLOW_LOG_ID,
    timeout: 30_000,
  });

  const calls: Array<Array<unknown>> = updateLogSpy.mock.calls;
  const persisted: JSONObject = (
    calls[calls.length - 1]?.[0] as { data: JSONObject }
  ).data;

  return {
    persisted: persisted,
    trace: parseTrace(persisted["stepTrace"] as never),
    logs: String(persisted["logs"] || ""),
    everything: JSON.stringify(calls),
  };
};

type RanFunction = (trace: WorkflowStepTrace) => Array<string>;

// The steps that ran, in order.
const ran: RanFunction = (trace: WorkflowStepTrace): Array<string> => {
  return trace.steps.map((step: WorkflowStepTraceEntry): string => {
    return step.componentId;
  });
};

type StepOfFunction = (
  trace: WorkflowStepTrace,
  componentId: string,
) => WorkflowStepTraceEntry;

const stepOf: StepOfFunction = (
  trace: WorkflowStepTrace,
  componentId: string,
): WorkflowStepTraceEntry => {
  const found: WorkflowStepTraceEntry | undefined = trace.steps.find(
    (step: WorkflowStepTraceEntry): boolean => {
      return step.componentId === componentId;
    },
  );

  if (!found) {
    throw new Error(`${componentId} did not run.`);
  }

  return found;
};

beforeEach(() => {
  jest.spyOn(logger, "error").mockImplementation((): void => {
    return undefined;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a run follows the case that matches", () => {
  test("the first case: its output, and the steps behind it, and nothing else", async () => {
    const result: RunResult = await runGraph({
      graph: savedGraph(ROUTED_NODES(), ROUTED_EDGES),
      severity: "Critical Incident",
    });

    expect(result.persisted["workflowStatus"]).toBe(WorkflowStatus.Success);
    expect(ran(result.trace)).toEqual(["manual-1", "switch-1", "log-critical"]);
    expect(stepOf(result.trace, "log-critical").argumentValues["value"]).toBe(
      "log-critical ran for Critical Incident",
    );
  });

  test("a later case, when the ones above it do not match", async () => {
    const result: RunResult = await runGraph({
      graph: savedGraph(ROUTED_NODES(), ROUTED_EDGES),
      severity: "Major Incident",
    });

    expect(ran(result.trace)).toEqual(["manual-1", "switch-1", "log-major"]);
  });

  test("no fallthrough: two cases that match, and only the first one's steps run", async () => {
    const result: RunResult = await runGraph({
      graph: savedGraph(
        ROUTED_NODES({
          value: SEVERITY,
          cases: [
            aCase("case-1", "contains", "Incident"),
            aCase("case-2", "==", "Major Incident"),
          ],
        }),
        ROUTED_EDGES,
      ),
      severity: "Major Incident",
    });

    expect(ran(result.trace)).toEqual(["manual-1", "switch-1", "log-critical"]);
  });

  test("the order of the cases is the order they are checked in", async () => {
    const graphWith: (cases: Array<JSONObject>) => JSONObject = (
      cases: Array<JSONObject>,
    ): JSONObject => {
      return savedGraph(ROUTED_NODES({ value: SEVERITY, cases }), ROUTED_EDGES);
    };

    // A number below 300 matches both; the first listed wins either way.
    const lessThan300: JSONObject = aCase("case-1", "<", "300", "number");
    const lessThan500: JSONObject = aCase("case-2", "<", "500", "number");

    expect(
      ran(
        (
          await runGraph({
            graph: graphWith([lessThan300, lessThan500]),
            severity: "204",
          })
        ).trace,
      ),
    ).toContain("log-critical");

    expect(
      ran(
        (
          await runGraph({
            graph: graphWith([lessThan500, lessThan300]),
            severity: "204",
          })
        ).trace,
      ),
    ).toContain("log-major");
  });
});

describe("Default", () => {
  test("runs when no case matches", async () => {
    const result: RunResult = await runGraph({
      graph: savedGraph(ROUTED_NODES(), ROUTED_EDGES),
      severity: "Minor Incident",
    });

    expect(result.persisted["workflowStatus"]).toBe(WorkflowStatus.Success);
    expect(ran(result.trace)).toEqual(["manual-1", "switch-1", "log-other"]);
  });

  test("with nothing connected to it, the run ends at the step, without an error", async () => {
    const result: RunResult = await runGraph({
      graph: savedGraph(
        ROUTED_NODES(),
        ROUTED_EDGES.filter((edge: GraphEdgeSpec): boolean => {
          return edge.port !== "default";
        }),
      ),
      severity: "Minor Incident",
    });

    expect(result.persisted["workflowStatus"]).toBe(WorkflowStatus.Success);
    expect(ran(result.trace)).toEqual(["manual-1", "switch-1"]);

    const step: WorkflowStepTraceEntry = stepOf(result.trace, "switch-1");

    expect(step.status).toBe(WorkflowStepStatus.Success);
    expect(step.executedPort).toBe("default");
    // Nothing is connected to it: the Steps view says the run ended here.
    expect(step.nextSteps).toEqual([]);
  });

  test("a case with nothing connected ends the run the same way, when it is the one that matches", async () => {
    const result: RunResult = await runGraph({
      graph: savedGraph(
        ROUTED_NODES(),
        ROUTED_EDGES.filter((edge: GraphEdgeSpec): boolean => {
          return edge.port !== "case-2";
        }),
      ),
      severity: "Major Incident",
    });

    expect(result.persisted["workflowStatus"]).toBe(WorkflowStatus.Success);
    expect(ran(result.trace)).toEqual(["manual-1", "switch-1"]);
    expect(stepOf(result.trace, "switch-1").executedPort).toBe("case-2");
  });
});

describe("what the run keeps about the step", () => {
  test("the case it took, by the name the canvas gives it, where it led, and why", async () => {
    const result: RunResult = await runGraph({
      graph: savedGraph(ROUTED_NODES(), ROUTED_EDGES),
      severity: "Major Incident",
    });

    const step: WorkflowStepTraceEntry = stepOf(result.trace, "switch-1");

    expect(step).toEqual(
      expect.objectContaining({
        title: "Switch / Case",
        status: WorkflowStepStatus.Success,
        executedPort: "case-2",
        executedPortTitle: "Major Incident",
        executedPortTitleIsFromSettings: true,
        executedPortDescription:
          "Runs next when the value is equal to “Major Incident” and no case above it matches.",
        executedPortReason:
          "Case 2 matched: the value is equal to “Major Incident”. Case 1 did not.",
        nextSteps: [{ componentId: "log-major", title: "Log" }],
        returnValues: {},
        returnValueNames: [],
      }),
    );
  });

  test("Default is the step's own output, not the person's words, and why it was taken", async () => {
    const result: RunResult = await runGraph({
      graph: savedGraph(ROUTED_NODES(), ROUTED_EDGES),
      severity: "Minor Incident",
    });

    const step: WorkflowStepTraceEntry = stepOf(result.trace, "switch-1");

    expect(step.executedPort).toBe("default");
    expect(step.executedPortTitle).toBe("Default");
    expect(step.executedPortTitleIsFromSettings).toBeUndefined();
    expect(step.executedPortReason).toBe(
      "None of the 2 cases matched, so the step took Default.",
    );
  });

  test("what it received: the value to check resolved, and the cases, by their settings' names", async () => {
    const result: RunResult = await runGraph({
      graph: savedGraph(ROUTED_NODES(), ROUTED_EDGES),
      severity: "Major Incident",
    });

    const step: WorkflowStepTraceEntry = stepOf(result.trace, "switch-1");

    expect(step.argumentNames).toEqual([
      { id: "value", name: "Value to check" },
      { id: "cases", name: "Cases" },
    ]);
    expect(step.argumentValues["value"]).toBe("Major Incident");
    expect(step.argumentValues["cases"]).toEqual(SEVERITY_CASES);
    // The value to check as configured, beside what it resolved to.
    expect(step.argumentTemplates?.["value"]).toBe(SEVERITY);
  });

  test("a line in the run's log for each case checked, then why", async () => {
    const result: RunResult = await runGraph({
      graph: savedGraph(ROUTED_NODES(), ROUTED_EDGES),
      severity: "Major Incident",
    });

    expect(result.logs).toContain("Case 1 (Critical Incident): no match.");
    expect(result.logs).toContain("Case 2 (Major Incident): matched.");
    expect(result.logs).toContain(
      "Case 2 matched: the value is equal to “Major Incident”. Case 1 did not.",
    );
    expect(result.logs).toContain("Executing Port: Major Incident");
  });
});

describe("what stops a run", () => {
  test("a case whose comparison the step does not know: the step fails, saying which case", async () => {
    const result: RunResult = await runGraph({
      graph: savedGraph(
        ROUTED_NODES({
          value: SEVERITY,
          cases: [aCase("case-1", "==", "Critical Incident"), aCase("case-2", "~=")],
        }),
        ROUTED_EDGES,
      ),
      severity: "Critical Incident",
    });

    expect(result.persisted["workflowStatus"]).toBe(WorkflowStatus.Error);
    expect(ran(result.trace)).toEqual(["manual-1", "switch-1"]);

    const step: WorkflowStepTraceEntry = stepOf(result.trace, "switch-1");

    expect(step.status).toBe(WorkflowStepStatus.Error);
    expect(step.executedPort).toBeNull();
    expect(result.logs).toContain(
      'Switch / Case cannot compare case 2 with "~=". Open the step and choose a comparison for it, such as is equal to.',
    );
  });

  test("cases that are not a list: the step fails, saying so", async () => {
    const result: RunResult = await runGraph({
      graph: savedGraph(
        ROUTED_NODES({ value: SEVERITY, cases: "not a list" }),
        ROUTED_EDGES,
      ),
      severity: "Critical Incident",
    });

    expect(result.persisted["workflowStatus"]).toBe(WorkflowStatus.Error);
    expect(result.logs).toContain(
      "The cases of this Switch / Case could not be read: they are not a list.",
    );
  });
});

describe("references in the cases", () => {
  test("a case's value from a variable is resolved before it is compared, and named after the variable", async () => {
    const result: RunResult = await runGraph({
      graph: savedGraph(
        ROUTED_NODES({
          value: SEVERITY,
          cases: [
            aCase("case-1", "==", "{{local.variables.CRITICAL_NAME}}"),
            aCase("case-2", "==", "Major Incident"),
          ],
        }),
        ROUTED_EDGES,
      ),
      severity: "Sev 1",
      storageMap: {
        local: { variables: { CRITICAL_NAME: "Sev 1" }, components: {} },
        global: { variables: {} },
      },
    });

    expect(ran(result.trace)).toEqual(["manual-1", "switch-1", "log-critical"]);

    const step: WorkflowStepTraceEntry = stepOf(result.trace, "switch-1");

    expect(step.executedPortTitle).toBe("CRITICAL_NAME");
    expect(step.executedPortReason).toBe(
      "Case 1 matched: the value is equal to CRITICAL_NAME.",
    );
    // What the case was configured with, beside what it resolved to.
    expect(JSON.stringify(step.argumentTemplates?.["cases"])).toContain(
      "{{local.variables.CRITICAL_NAME}}",
    );
  });

  test("a {{...}} in a case that resolved to nothing is warned about, on the Cases setting", async () => {
    const result: RunResult = await runGraph({
      graph: savedGraph(
        ROUTED_NODES({
          value: SEVERITY,
          cases: [
            aCase("case-1", "==", "{{local.variables.NO_SUCH_VARIABLE}}"),
          ],
        }),
        ROUTED_EDGES,
      ),
      severity: "Critical Incident",
    });

    const step: WorkflowStepTraceEntry = stepOf(result.trace, "switch-1");

    expect(step.warnings).toEqual([
      expect.objectContaining({
        argumentId: "cases",
        unresolvedReferences: ["{{local.variables.NO_SUCH_VARIABLE}}"],
      }),
    ]);
    expect(result.logs).toContain(
      'Warning: {{local.variables.NO_SUCH_VARIABLE}} in "Cases" did not resolve to anything',
    );
  });

  test("a secret a case is compared with stays out of the run's log and trace", async () => {
    const SECRET: string = "s3cr3t-deploy-token-value";

    const secret: WorkflowVariable = new WorkflowVariable();
    secret.name = "DEPLOY_TOKEN";
    secret.content = SECRET;
    secret.isSecret = true;

    const result: RunResult = await runGraph({
      graph: savedGraph(
        ROUTED_NODES({
          value: SEVERITY,
          cases: [aCase("case-1", "==", "{{global.variables.DEPLOY_TOKEN}}")],
        }),
        ROUTED_EDGES,
      ),
      severity: SECRET,
      variables: [secret],
      storageMap: {
        local: { variables: {}, components: {} },
        global: { variables: { DEPLOY_TOKEN: SECRET } },
      },
    });

    // The case matched, so the secret was compared.
    expect(ran(result.trace)).toEqual(["manual-1", "switch-1", "log-critical"]);

    const step: WorkflowStepTraceEntry = stepOf(result.trace, "switch-1");

    expect(step.executedPortTitle).toBe("DEPLOY_TOKEN");
    expect(step.executedPortReason).toBe(
      "Case 1 matched: the value is equal to DEPLOY_TOKEN.",
    );
    expect(JSON.stringify(step.argumentValues)).toContain(
      WORKFLOW_LOG_REDACTED_VALUE,
    );
    expect(result.everything).not.toContain(SECRET);
  });
});
