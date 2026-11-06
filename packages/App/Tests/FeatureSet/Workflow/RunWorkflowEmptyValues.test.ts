/*
 * A workflow run from end to end when a record has nothing where a setting
 * reads it (issue 5761): the graph as the builder saves it, read by the real
 * makeRunStack, the real record trigger reading the record as a Project Admin
 * would, its values resolved by getComponentArguments, and handed to the real
 * Slack, If / Else and database steps from the registry. Only the database and
 * Slack's own server are not real.
 *
 * The report: an alert raised by an SLO has no monitor, so its Slack message
 * went out with "Monitor: {{local.components...model.monitor.name}}" in it.
 *
 * What a run must do:
 *   - a value with nothing in it comes through empty, in a message;
 *   - a field its step does not pass on comes through empty too, as the builder
 *     says it is, with a warning on the step saying what to add;
 *   - a reference to something that is not there is left as written, with a
 *     warning that says which of those it is;
 *   - and a step that reads or writes records never gets an empty ID: it stops
 *     on the reference, with nothing read or written. An ID that went blank
 *     would widen a Delete Many to every alert with no monitor.
 */

import Alert from "Common/Models/DatabaseModels/Alert";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import ServiceLevelObjective from "Common/Models/DatabaseModels/ServiceLevelObjective";
import Workflow from "Common/Models/DatabaseModels/Workflow";
import AlertService from "Common/Server/Services/AlertService";
import ProjectService from "Common/Server/Services/ProjectService";
import WorkflowLogService from "Common/Server/Services/WorkflowLogService";
import WorkflowService from "Common/Server/Services/WorkflowService";
import logger from "Common/Server/Utils/Logger";
import SlackUtil from "Common/Server/Utils/Workspace/Slack/Slack";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { PlanType } from "Common/Types/Billing/SubscriptionPlan";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { ComponentType, NodeType } from "Common/Types/Workflow/Component";
import ComponentID from "Common/Types/Workflow/ComponentID";
import {
  CONDITION_ARGUMENT_IDS,
  ConditionOperator,
} from "Common/Types/Workflow/Components/Condition";
import {
  WorkflowStepTrace,
  WorkflowStepTraceEntry,
  WorkflowStepTraceWarning,
  parseTrace,
} from "Common/Types/Workflow/StepTrace";
import WorkflowStatus from "Common/Types/Workflow/WorkflowStatus";
import RunWorkflow from "../../../FeatureSet/Workflow/Services/RunWorkflow";
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
const ALERT_ID: string = "44444444-4444-4444-8444-444444444444";
const MONITOR_ID: string = "55555555-5555-4555-8555-555555555555";

const WEBHOOK_URL: string = "https://hooks.slack.com/services/T000/B000/XXXX";

const MODEL: string = "local.components.alert-on-create-1.returnValues.model";

const MONITOR_NAME: string = `{{${MODEL}.monitor.name}}`;

// The customer's message, as the issue quotes it.
const CUSTOMER_MESSAGE: string = [
  `:warning: New Alert {{${MODEL}.alertNumberWithPrefix}}`,
  `*Severity:* {{${MODEL}.alertSeverity.name}}`,
  `*Monitor:* ${MONITOR_NAME}`,
  `*Summary:* {{${MODEL}.title}}`,
].join("\n");

// What the builder saves when these are picked under Fields to pass on.
const PASSES_ON_THE_MONITOR: JSONObject = {
  _id: true,
  title: true,
  alertNumberWithPrefix: true,
  alertSeverity: { name: true },
  monitor: { name: true },
};

const LEAVES_OUT_THE_MONITOR: JSONObject = {
  _id: true,
  title: true,
  alertNumberWithPrefix: true,
  alertSeverity: { name: true },
};

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

type AlertTriggerFunction = (
  select: JSONObject,
  metadataId?: string,
) => GraphNodeSpec;

const alertTrigger: AlertTriggerFunction = (
  select: JSONObject,
  metadataId: string = "alert-on-create",
): GraphNodeSpec => {
  return {
    componentId: "alert-on-create-1",
    metadataId: metadataId,
    componentType: ComponentType.Trigger,
    args: { select: select },
  };
};

type SlackNodeFunction = (text: string) => GraphNodeSpec;

const slackNode: SlackNodeFunction = (text: string): GraphNodeSpec => {
  return {
    componentId: "slack-1",
    metadataId: "slack-send-message-to-channel",
    componentType: ComponentType.Component,
    args: { text: text, "webhook-url": WEBHOOK_URL },
  };
};

type ThenFunction = (from: string, to: string, port?: string) => GraphEdgeSpec;

const then: ThenFunction = (
  from: string,
  to: string,
  port: string = "success",
): GraphEdgeSpec => {
  return { from: from, port: port, to: to };
};

interface AlertFields {
  monitor?: Monitor | null;
  serviceLevelObjectives?: Array<ServiceLevelObjective>;
}

type AlertOfFunction = (fields: AlertFields) => Alert;

// An alert as the trigger's read returns it: a NULL relation comes back null.
const alertWith: AlertOfFunction = (fields: AlertFields): Alert => {
  const alert: Alert = new Alert();

  alert._id = ALERT_ID;
  alert.title = "SLO burn rate: Overall Calendar Month — Slow burn";
  alert.alertNumberWithPrefix = "ALT-9";

  const severity: JSONObject = {
    _id: ObjectID.generate().toString(),
    name: "High",
  };

  alert.alertSeverity = severity as never;

  if (fields.monitor !== undefined) {
    alert.monitor = fields.monitor as never;
  }

  if (fields.serviceLevelObjectives) {
    alert.serviceLevelObjectives = fields.serviceLevelObjectives;
  }

  return alert;
};

const monitorNamed: (name: string) => Monitor = (name: string): Monitor => {
  const monitor: Monitor = new Monitor();

  monitor._id = MONITOR_ID;
  monitor.name = name;

  return monitor;
};

interface RunResult {
  status: WorkflowStatus;
  trace: WorkflowStepTrace;
  logs: string;
  // What Slack was sent, one message for each time it was asked.
  slackMessages: Array<string>;
}

interface RunArguments {
  nodes: Array<GraphNodeSpec>;
  edges: Array<GraphEdgeSpec>;
  // What the trigger's read finds.
  alert: Alert | null;
  runOnlyComponentId?: string;
}

const runGraph: (options: RunArguments) => Promise<RunResult> = async (
  options: RunArguments,
): Promise<RunResult> => {
  const runner: RunWorkflow = new RunWorkflow();

  const workflow: Workflow = new Workflow();
  workflow.id = WORKFLOW_ID;
  workflow.projectId = PROJECT_ID;
  workflow.isEnabled = true;
  workflow.name = "New alerts to Slack";
  workflow.graph = savedGraph(options.nodes, options.edges);

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
    storageMap: {
      local: { variables: {}, components: {} },
      global: { variables: {} },
    },
    variables: [],
  });

  jest
    .spyOn(
      AlertService as unknown as {
        findOneById: (query: unknown) => Promise<Alert | null>;
      },
      "findOneById",
    )
    .mockResolvedValue(options.alert);

  const slack: RecordedSpy = jest
    .spyOn(SlackUtil, "sendMessageToChannelViaIncomingWebhook")
    .mockResolvedValue(
      new HTTPResponse(200, {}, {}) as never,
    ) as unknown as RecordedSpy;

  await runner.runWorkflow({
    arguments: { _id: ALERT_ID, data: { _id: ALERT_ID } },
    workflowId: WORKFLOW_ID,
    workflowLogId: WORKFLOW_LOG_ID,
    timeout: 30_000,
    runOnlyComponentId: options.runOnlyComponentId,
  } as never);

  const calls: Array<Array<unknown>> = updateLogSpy.mock.calls;
  const persisted: JSONObject = (
    calls[calls.length - 1]?.[0] as { data: JSONObject }
  ).data;

  return {
    status: persisted["workflowStatus"] as WorkflowStatus,
    trace: parseTrace(persisted["stepTrace"] as never),
    logs: String(persisted["logs"] || ""),
    slackMessages: slack.mock.calls.map((call: Array<unknown>): string => {
      return (call[0] as { text: string }).text;
    }),
  };
};

type StepOfFunction = (
  result: RunResult,
  componentId: string,
) => WorkflowStepTraceEntry;

const stepOf: StepOfFunction = (
  result: RunResult,
  componentId: string,
): WorkflowStepTraceEntry => {
  const found: WorkflowStepTraceEntry | undefined = result.trace.steps.find(
    (step: WorkflowStepTraceEntry): boolean => {
      return step.componentId === componentId;
    },
  );

  if (!found) {
    throw new Error(`${componentId} did not run.`);
  }

  return found;
};

const warningsOn: (
  result: RunResult,
  componentId: string,
) => Array<WorkflowStepTraceWarning> = (
  result: RunResult,
  componentId: string,
): Array<WorkflowStepTraceWarning> => {
  return stepOf(result, componentId).warnings || [];
};

const ran: (result: RunResult) => Array<string> = (
  result: RunResult,
): Array<string> => {
  return result.trace.steps.map((step: WorkflowStepTraceEntry): string => {
    return step.componentId;
  });
};

beforeEach(() => {
  jest.spyOn(ProjectService, "isProjectBlocked").mockResolvedValue(false);
  jest.spyOn(ProjectService, "getCurrentPlan").mockResolvedValue({
    plan: PlanType.Enterprise,
    isSubscriptionUnpaid: false,
  } as never);
  jest.spyOn(logger, "error").mockImplementation((): void => {
    return undefined;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the message issue 5761 reported", () => {
  test("an alert raised by an SLO: the message reads, with no monitor to name", async () => {
    const result: RunResult = await runGraph({
      nodes: [alertTrigger(PASSES_ON_THE_MONITOR), slackNode(CUSTOMER_MESSAGE)],
      edges: [then("alert-on-create-1", "slack-1")],
      alert: alertWith({ monitor: null }),
    });

    expect(result.status).toBe(WorkflowStatus.Success);
    expect(result.slackMessages).toEqual([
      ":warning: New Alert ALT-9\n*Severity:* High\n*Monitor:* \n*Summary:* SLO burn rate: Overall Calendar Month — Slow burn",
    ]);
  });

  test("nothing is wrong with the workflow, so the step warns of nothing", async () => {
    const result: RunResult = await runGraph({
      nodes: [alertTrigger(PASSES_ON_THE_MONITOR), slackNode(CUSTOMER_MESSAGE)],
      edges: [then("alert-on-create-1", "slack-1")],
      alert: alertWith({ monitor: null }),
    });

    expect(warningsOn(result, "slack-1")).toEqual([]);
    expect(result.logs).not.toContain("Warning:");
  });

  test("the full log says why the message has a gap in it", async () => {
    const result: RunResult = await runGraph({
      nodes: [alertTrigger(PASSES_ON_THE_MONITOR), slackNode(CUSTOMER_MESSAGE)],
      edges: [then("alert-on-create-1", "slack-1")],
      alert: alertWith({ monitor: null }),
    });

    expect(result.logs).toContain(
      `${MONITOR_NAME} in "Message Text" has no value in this run, so it came through empty.`,
    );
  });

  test("the trigger's own step shows the alert has no monitor", async () => {
    const result: RunResult = await runGraph({
      nodes: [alertTrigger(PASSES_ON_THE_MONITOR), slackNode(CUSTOMER_MESSAGE)],
      edges: [then("alert-on-create-1", "slack-1")],
      alert: alertWith({ monitor: null }),
    });

    expect(
      (stepOf(result, "alert-on-create-1").returnValues["model"] as JSONObject)[
        "monitor"
      ],
    ).toBeNull();
  });

  test("the step still shows what the setting was, next to what it came to", async () => {
    const result: RunResult = await runGraph({
      nodes: [alertTrigger(PASSES_ON_THE_MONITOR), slackNode(CUSTOMER_MESSAGE)],
      edges: [then("alert-on-create-1", "slack-1")],
      alert: alertWith({ monitor: null }),
    });

    const step: WorkflowStepTraceEntry = stepOf(result, "slack-1");

    expect(step.argumentTemplates?.["text"]).toBe(CUSTOMER_MESSAGE);
    expect(step.argumentValues["text"]).toContain("*Monitor:* \n");
  });

  test("an alert raised by a monitor names it, with nothing to say", async () => {
    const result: RunResult = await runGraph({
      nodes: [alertTrigger(PASSES_ON_THE_MONITOR), slackNode(CUSTOMER_MESSAGE)],
      edges: [then("alert-on-create-1", "slack-1")],
      alert: alertWith({ monitor: monitorNamed("Checkout API") }),
    });

    expect(result.slackMessages[0]).toContain("*Monitor:* Checkout API\n");
    expect(warningsOn(result, "slack-1")).toEqual([]);
    expect(result.logs).not.toContain("came through empty");
  });

  test.each([
    ["On Update", "alert-on-update"],
    ["On Create or Update", "alert-on-create-or-update"],
  ])("%s, as the issue's other workflow", async (_name: string, id: string) => {
    const result: RunResult = await runGraph({
      nodes: [
        alertTrigger(PASSES_ON_THE_MONITOR, id),
        slackNode(`Monitor: [${MONITOR_NAME}]`),
      ],
      edges: [then("alert-on-create-1", "slack-1")],
      alert: alertWith({ monitor: null }),
    });

    expect(result.slackMessages).toEqual(["Monitor: []"]);
  });
});

describe("a related record asked for without naming any of its fields", () => {
  /*
   * A read of {"monitor": true} returns the monitor's ID and not its name
   * (SelectUtil.sanitizeSelect; RecordFieldsWithNoValuePostgres reads it for
   * real), which is what the trigger's read hands over here.
   */
  const monitorWithOnlyItsId: () => Monitor = (): Monitor => {
    const monitor: Monitor = new Monitor();

    monitor._id = MONITOR_ID;

    return monitor;
  };

  test("its name comes through empty, with a warning saying what to add", async () => {
    const result: RunResult = await runGraph({
      nodes: [
        alertTrigger({ _id: true, monitor: true }),
        slackNode(`*Monitor:* ${MONITOR_NAME}`),
      ],
      edges: [then("alert-on-create-1", "slack-1")],
      alert: alertWith({ monitor: monitorWithOnlyItsId() }),
    });

    expect(result.status).toBe(WorkflowStatus.Success);
    expect(result.slackMessages).toEqual(["*Monitor:* "]);
    expect(warningsOn(result, "slack-1")).toEqual([
      {
        message: `${MONITOR_NAME} in "Message Text" came through empty: "On Create Alert" does not pass on monitor.name. Add it to that step's Fields to pass on.`,
        argumentId: "text",
        unresolvedReferences: [MONITOR_NAME],
      },
    ]);
  });

  test("its ID is there, with nothing to warn of", async () => {
    const result: RunResult = await runGraph({
      nodes: [
        alertTrigger({ _id: true, monitor: true }),
        slackNode(`*Monitor:* {{${MODEL}.monitor._id}}`),
      ],
      edges: [then("alert-on-create-1", "slack-1")],
      alert: alertWith({ monitor: monitorWithOnlyItsId() }),
    });

    expect(result.slackMessages).toEqual([`*Monitor:* ${MONITOR_ID}`]);
    expect(warningsOn(result, "slack-1")).toEqual([]);
  });
});

/*
 * With nothing else in the message there is no message. Slack is not sent a
 * blank; the step stops, and the run says both what came through empty and why
 * it stopped.
 */
describe("a message that is nothing but a field with nothing in it", () => {
  test("has nothing to send, and the run says so", async () => {
    const result: RunResult = await runGraph({
      nodes: [alertTrigger(PASSES_ON_THE_MONITOR), slackNode(MONITOR_NAME)],
      edges: [then("alert-on-create-1", "slack-1")],
      alert: alertWith({ monitor: null }),
    });

    expect(result.slackMessages).toEqual([]);
    expect(result.status).toBe(WorkflowStatus.Error);
    expect(result.logs).toContain(
      `${MONITOR_NAME} in "Message Text" has no value in this run, so it came through empty.`,
    );
    expect(result.logs).toContain("Slack message not found");
  });

  test("still goes out for an alert that has the field", async () => {
    const result: RunResult = await runGraph({
      nodes: [alertTrigger(PASSES_ON_THE_MONITOR), slackNode(MONITOR_NAME)],
      edges: [then("alert-on-create-1", "slack-1")],
      alert: alertWith({ monitor: monitorNamed("Checkout API") }),
    });

    expect(result.status).toBe(WorkflowStatus.Success);
    expect(result.slackMessages).toEqual(["Checkout API"]);
  });
});

describe("a field its step does not pass on", () => {
  test("comes through empty, as the builder and the docs say it does", async () => {
    const result: RunResult = await runGraph({
      nodes: [
        alertTrigger(LEAVES_OUT_THE_MONITOR),
        slackNode(CUSTOMER_MESSAGE),
      ],
      edges: [then("alert-on-create-1", "slack-1")],
      alert: alertWith({}),
    });

    expect(result.status).toBe(WorkflowStatus.Success);
    expect(result.slackMessages[0]).toContain("*Monitor:* \n");
    expect(result.slackMessages[0]).not.toContain("{{");
  });

  test("warns on the step, naming what to add and where", async () => {
    const result: RunResult = await runGraph({
      nodes: [
        alertTrigger(LEAVES_OUT_THE_MONITOR),
        slackNode(CUSTOMER_MESSAGE),
      ],
      edges: [then("alert-on-create-1", "slack-1")],
      alert: alertWith({}),
    });

    expect(warningsOn(result, "slack-1")).toEqual([
      {
        message: `${MONITOR_NAME} in "Message Text" came through empty: "On Create Alert" does not pass on monitor.name. Add it to that step's Fields to pass on.`,
        argumentId: "text",
        unresolvedReferences: [MONITOR_NAME],
      },
    ]);
    expect(result.logs).toContain(
      `Warning: ${MONITOR_NAME} in "Message Text" came through empty:`,
    );
  });

  test("warns once for a reference the message reads twice", async () => {
    const result: RunResult = await runGraph({
      nodes: [
        alertTrigger(LEAVES_OUT_THE_MONITOR),
        slackNode(`${MONITOR_NAME} and ${MONITOR_NAME}`),
      ],
      edges: [then("alert-on-create-1", "slack-1")],
      alert: alertWith({}),
    });

    expect(warningsOn(result, "slack-1")).toHaveLength(1);
  });

  test("warns even when this alert would have had nothing there", async () => {
    const result: RunResult = await runGraph({
      nodes: [
        alertTrigger({ monitor: { name: true } }),
        slackNode(`[{{${MODEL}.monitor.description}}]`),
      ],
      edges: [then("alert-on-create-1", "slack-1")],
      alert: alertWith({ monitor: null }),
    });

    expect(result.slackMessages).toEqual(["[]"]);
    expect(warningsOn(result, "slack-1")[0]?.message).toContain(
      "does not pass on monitor.description",
    );
  });

  test("On Delete has no field to add, and says why", async () => {
    const result: RunResult = await runGraph({
      nodes: [
        {
          componentId: "alert-on-create-1",
          metadataId: "alert-on-delete",
          componentType: ComponentType.Trigger,
        },
        slackNode(`Gone: [{{${MODEL}.title}}] ({{${MODEL}._id}})`),
      ],
      edges: [then("alert-on-create-1", "slack-1")],
      alert: null,
    });

    expect(result.slackMessages).toEqual([`Gone: [] (${ALERT_ID})`]);
    expect(warningsOn(result, "slack-1")[0]?.message).toContain(
      "passes on only the ID: the record is already gone.",
    );
  });
});

describe("a reference to something that is not there", () => {
  test("a mistyped field is left as written, and the warning names it", async () => {
    const reference: string = `{{${MODEL}.monitorr.name}}`;

    const result: RunResult = await runGraph({
      nodes: [
        alertTrigger(PASSES_ON_THE_MONITOR),
        slackNode(`Monitor: ${reference}`),
      ],
      edges: [then("alert-on-create-1", "slack-1")],
      alert: alertWith({ monitor: null }),
    });

    expect(result.slackMessages).toEqual([`Monitor: ${reference}`]);
    expect(warningsOn(result, "slack-1")).toEqual([
      {
        message: `${reference} in "Message Text" did not resolve to anything and was left as literal text. "On Create Alert" returns no field called monitorr.name. Check its spelling.`,
        argumentId: "text",
        unresolvedReferences: [reference],
      },
    ]);
  });

  test("a mistyped step is left as written, and says to check it", async () => {
    const reference: string =
      "{{local.components.alert-on-creat-1.returnValues.model.title}}";

    const result: RunResult = await runGraph({
      nodes: [
        alertTrigger(PASSES_ON_THE_MONITOR),
        slackNode(`Title: ${reference}`),
      ],
      edges: [then("alert-on-create-1", "slack-1")],
      alert: alertWith({ monitor: null }),
    });

    expect(result.slackMessages).toEqual([`Title: ${reference}`]);
    expect(warningsOn(result, "slack-1")[0]?.message).toContain(
      "Check the step id and the return value name.",
    );
  });

  test("a step tested on its own has nothing before it, and says so", async () => {
    const result: RunResult = await runGraph({
      nodes: [
        alertTrigger(PASSES_ON_THE_MONITOR),
        slackNode(`[${MONITOR_NAME}]`),
      ],
      edges: [then("alert-on-create-1", "slack-1")],
      alert: alertWith({ monitor: null }),
      runOnlyComponentId: "slack-1",
    });

    expect(ran(result)).toEqual(["slack-1"]);
    expect(result.slackMessages).toEqual([`[${MONITOR_NAME}]`]);
    expect(warningsOn(result, "slack-1")[0]?.unresolvedReferences).toEqual([
      MONITOR_NAME,
    ]);
  });
});

describe("other values a record has nothing in", () => {
  test("a field that is NULL is nothing, never the word null", async () => {
    const result: RunResult = await runGraph({
      nodes: [
        alertTrigger({ title: true, description: true }),
        slackNode(`Details: [{{${MODEL}.description}}]`),
      ],
      edges: [then("alert-on-create-1", "slack-1")],
      alert: ((): Alert => {
        const alert: Alert = alertWith({});

        alert.description = null as never;

        return alert;
      })(),
    });

    expect(result.slackMessages).toEqual(["Details: []"]);
    expect(result.logs).not.toContain("Warning:");
  });

  test("a custom field this alert does not hold is nothing", async () => {
    const result: RunResult = await runGraph({
      nodes: [
        alertTrigger({ customFields: true }),
        slackNode(`Impact: [{{${MODEL}.customFields.Impact}}]`),
      ],
      edges: [then("alert-on-create-1", "slack-1")],
      alert: ((): Alert => {
        const alert: Alert = alertWith({});

        alert.customFields = { Region: "eu" };

        return alert;
      })(),
    });

    expect(result.slackMessages).toEqual(["Impact: []"]);
    expect(result.logs).not.toContain("Warning:");
  });

  test("a custom field it does hold is read", async () => {
    const result: RunResult = await runGraph({
      nodes: [
        alertTrigger({ customFields: true }),
        slackNode(`Region: [{{${MODEL}.customFields.Region}}]`),
      ],
      edges: [then("alert-on-create-1", "slack-1")],
      alert: ((): Alert => {
        const alert: Alert = alertWith({});

        alert.customFields = { Region: "eu" };

        return alert;
      })(),
    });

    expect(result.slackMessages).toEqual(["Region: [eu]"]);
  });

  test("a related list with no items: its first is nothing, and a loop writes nothing", async () => {
    const result: RunResult = await runGraph({
      nodes: [
        alertTrigger({ serviceLevelObjectives: { name: true } }),
        slackNode(
          `First: [{{${MODEL}.serviceLevelObjectives[0].name}}] All: [{{#each ${MODEL}.serviceLevelObjectives}}{{name}},{{/each}}]`,
        ),
      ],
      edges: [then("alert-on-create-1", "slack-1")],
      alert: alertWith({ serviceLevelObjectives: [] }),
    });

    expect(result.slackMessages).toEqual(["First: [] All: []"]);
  });

  // How a message names what an alert from an SLO is about (the docs say so).
  test("the SLO of an alert raised by one is read by its name", async () => {
    const slo: ServiceLevelObjective = new ServiceLevelObjective();

    slo._id = ObjectID.generate().toString();
    slo.name = "Overall Calendar Month";

    const result: RunResult = await runGraph({
      nodes: [
        alertTrigger({
          monitor: { name: true },
          serviceLevelObjectives: { name: true },
        }),
        slackNode(
          `Monitor: [${MONITOR_NAME}] SLO: [{{#each ${MODEL}.serviceLevelObjectives}}{{name}}{{/each}}]`,
        ),
      ],
      edges: [then("alert-on-create-1", "slack-1")],
      alert: alertWith({ monitor: null, serviceLevelObjectives: [slo] }),
    });

    expect(result.slackMessages).toEqual([
      "Monitor: [] SLO: [Overall Calendar Month]",
    ]);
  });
});

describe("If / Else asks the record what it has", () => {
  const ifMonitorIsEmpty: GraphNodeSpec = {
    componentId: "if-1",
    metadataId: ComponentID.IfElse,
    componentType: ComponentType.Component,
    args: {
      [CONDITION_ARGUMENT_IDS.valueToCheck]: MONITOR_NAME,
      [CONDITION_ARGUMENT_IDS.comparison]: ConditionOperator.IsEmpty,
    },
  };

  const NODES: Array<GraphNodeSpec> = [
    alertTrigger(PASSES_ON_THE_MONITOR),
    ifMonitorIsEmpty,
    { ...slackNode("From an SLO"), componentId: "slack-yes" },
    { ...slackNode(`From ${MONITOR_NAME}`), componentId: "slack-no" },
  ];

  const EDGES: Array<GraphEdgeSpec> = [
    then("alert-on-create-1", "if-1"),
    then("if-1", "slack-yes", "yes"),
    then("if-1", "slack-no", "no"),
  ];

  test("an alert with no monitor takes Yes, with nothing to warn of", async () => {
    const result: RunResult = await runGraph({
      nodes: NODES,
      edges: EDGES,
      alert: alertWith({ monitor: null }),
    });

    expect(result.slackMessages).toEqual(["From an SLO"]);
    expect(warningsOn(result, "if-1")).toEqual([]);
  });

  test("an alert with one takes No, and names it", async () => {
    const result: RunResult = await runGraph({
      nodes: NODES,
      edges: EDGES,
      alert: alertWith({ monitor: monitorNamed("Checkout API") }),
    });

    expect(result.slackMessages).toEqual(["From Checkout API"]);
  });
});

/*
 * What must not change. A reference left in a step that reads or writes records
 * is what stops that step: blank, it would read or write the wrong records.
 */
describe("a step that reads or writes records never gets an empty ID", () => {
  type ServiceSpies = {
    findBy: RecordedSpy;
    deleteBy: RecordedSpy;
    updateBy: RecordedSpy;
    create: RecordedSpy;
  };

  const spyOnWrites: () => ServiceSpies = (): ServiceSpies => {
    return {
      findBy: jest
        .spyOn(AlertService, "findBy")
        .mockResolvedValue([] as never) as unknown as RecordedSpy,
      deleteBy: jest
        .spyOn(AlertService, "deleteBy")
        .mockResolvedValue(0 as never) as unknown as RecordedSpy,
      updateBy: jest
        .spyOn(AlertService, "updateBy")
        .mockResolvedValue(0 as never) as unknown as RecordedSpy,
      create: jest
        .spyOn(AlertService, "create")
        .mockResolvedValue(new Alert() as never) as unknown as RecordedSpy,
    };
  };

  const MONITOR_ID_REFERENCE: string = `{{${MODEL}.monitor._id}}`;

  test.each([
    [
      "Delete Many",
      "alert-delete-many",
      { query: { monitorId: MONITOR_ID_REFERENCE } },
    ],
    [
      "Delete One",
      "alert-delete-one",
      { query: { monitorId: MONITOR_ID_REFERENCE } },
    ],
    [
      "Find Many",
      "alert-find-many",
      { query: { monitorId: MONITOR_ID_REFERENCE }, select: { _id: true } },
    ],
    [
      "Find One",
      "alert-find-one",
      { query: { monitorId: MONITOR_ID_REFERENCE }, select: { _id: true } },
    ],
    [
      "Update Many, by its Query",
      "alert-update-many",
      { query: { monitorId: MONITOR_ID_REFERENCE }, data: { title: "x" } },
    ],
    [
      "Update One, by what it writes",
      "alert-update-one",
      { query: { _id: ALERT_ID }, data: { monitorId: MONITOR_ID_REFERENCE } },
    ],
    [
      "Create One, by what it writes",
      "alert-create-one",
      { json: { title: "x", monitorId: MONITOR_ID_REFERENCE } },
    ],
  ])(
    "%s stops on the reference to the monitor an alert does not have",
    async (_name: string, metadataId: string, args: JSONObject) => {
      const spies: ServiceSpies = spyOnWrites();

      const result: RunResult = await runGraph({
        nodes: [
          alertTrigger(PASSES_ON_THE_MONITOR),
          {
            componentId: "records-1",
            metadataId: metadataId,
            componentType: ComponentType.Component,
            args: args,
          },
        ],
        edges: [then("alert-on-create-1", "records-1")],
        alert: alertWith({ monitor: null }),
      });

      const step: WorkflowStepTraceEntry = stepOf(result, "records-1");

      expect(step.executedPort).toBe("error");
      expect(step.executedPortReason).toContain(
        "The step stopped before reading or writing anything:",
      );
      expect(step.executedPortReason).toContain(MONITOR_ID_REFERENCE);
      expect(spies.findBy).not.toHaveBeenCalled();
      expect(spies.deleteBy).not.toHaveBeenCalled();
      expect(spies.updateBy).not.toHaveBeenCalled();
      expect(spies.create).not.toHaveBeenCalled();
    },
  );

  // Without quotes, as a value on its own: it never becomes {"monitorId": null}.
  test("Delete Many with the reference on its own stops the run, deleting nothing", async () => {
    const spies: ServiceSpies = spyOnWrites();

    const result: RunResult = await runGraph({
      nodes: [
        alertTrigger(PASSES_ON_THE_MONITOR),
        {
          componentId: "delete-1",
          metadataId: "alert-delete-many",
          componentType: ComponentType.Component,
          args: { query: `{"monitorId": ${MONITOR_ID_REFERENCE}}` },
        },
      ],
      edges: [then("alert-on-create-1", "delete-1")],
      alert: alertWith({ monitor: null }),
    });

    expect(result.status).toBe(WorkflowStatus.Error);
    expect(spies.deleteBy).not.toHaveBeenCalled();
    expect(spies.findBy).not.toHaveBeenCalled();
  });

  test("a warning on such a step says the field is what is missing", async () => {
    const reference: string = `{{${MODEL}.monitorId}}`;
    const spies: ServiceSpies = spyOnWrites();

    const result: RunResult = await runGraph({
      nodes: [
        alertTrigger(PASSES_ON_THE_MONITOR),
        {
          componentId: "delete-1",
          metadataId: "alert-delete-many",
          componentType: ComponentType.Component,
          args: { query: { monitorId: reference } },
        },
      ],
      edges: [then("alert-on-create-1", "delete-1")],
      alert: alertWith({ monitor: null }),
    });

    expect(warningsOn(result, "delete-1")[0]?.message).toContain(
      '"On Create Alert" does not pass on monitorId. Add it to that step\'s Fields to pass on.',
    );
    expect(spies.deleteBy).not.toHaveBeenCalled();
  });

  /*
   * A URL keeps a reference as written too. A custom field this alert does not
   * hold is passed on, so there is nothing to add: the warning must not say so.
   */
  test("a URL with a custom field the alert does not hold says what is missing", async () => {
    const reference: string = `{{${MODEL}.customFields.Impact}}`;

    const result: RunResult = await runGraph({
      nodes: [
        alertTrigger({ customFields: true }),
        {
          ...slackNode("Hello"),
          args: { text: "Hello", "webhook-url": `${WEBHOOK_URL}/${reference}` },
        },
      ],
      edges: [then("alert-on-create-1", "slack-1")],
      alert: ((): Alert => {
        const alert: Alert = alertWith({});

        alert.customFields = { Region: "eu" };

        return alert;
      })(),
    });

    const warning: WorkflowStepTraceWarning | undefined = warningsOn(
      result,
      "slack-1",
    )[0];

    expect(warning?.argumentId).toBe("webhook-url");
    expect(warning?.message).toContain("left as literal text");
    expect(warning?.message).toContain(
      'The record "On Create Alert" returned holds no customFields.Impact.',
    );
    expect(warning?.message).not.toContain("Fields to pass on");
  });

  test("a step that found its monitor uses its ID", async () => {
    const spies: ServiceSpies = spyOnWrites();

    const result: RunResult = await runGraph({
      nodes: [
        alertTrigger(PASSES_ON_THE_MONITOR),
        {
          componentId: "find-1",
          metadataId: "alert-find-many",
          componentType: ComponentType.Component,
          args: {
            query: { monitorId: MONITOR_ID_REFERENCE },
            select: { _id: true },
          },
        },
      ],
      edges: [then("alert-on-create-1", "find-1")],
      alert: alertWith({ monitor: monitorNamed("Checkout API") }),
    });

    expect(stepOf(result, "find-1").executedPort).toBe("success");
    expect(spies.findBy).toHaveBeenCalledTimes(1);
  });
});
