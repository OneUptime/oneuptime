/*
 * On Create or Update run by the workflow runner itself, end to end: the
 * graph as the builder saves it, started the way the trigger's events start
 * it (OnTriggerBaseModel.initTrigger) and the way Run Workflow does, run by
 * the real trigger from the registry and the real steps behind it. Only the
 * database is not real.
 *
 * What a run must do: hand the record on, read with its Fields to pass on,
 * and What Happened, which a later step reads like any value - a Switch /
 * Case takes a path for each answer, a message says it as it is.
 */

import Incident from "Common/Models/DatabaseModels/Incident";
import Workflow from "Common/Models/DatabaseModels/Workflow";
import WorkflowVariable from "Common/Models/DatabaseModels/WorkflowVariable";
import IncidentService from "Common/Server/Services/IncidentService";
import ProjectService from "Common/Server/Services/ProjectService";
import WorkflowLogService from "Common/Server/Services/WorkflowLogService";
import WorkflowService from "Common/Server/Services/WorkflowService";
import logger from "Common/Server/Utils/Logger";
import WorkflowPrincipal from "Common/Server/Utils/Workflow/WorkflowPrincipal";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { ComponentType, NodeType } from "Common/Types/Workflow/Component";
import ComponentID from "Common/Types/Workflow/ComponentID";
import { WHAT_HAPPENED_ID } from "Common/Types/Workflow/CreateOrUpdateTrigger";
import {
  WorkflowStepTrace,
  WorkflowStepTraceEntry,
  parseTrace,
} from "Common/Types/Workflow/StepTrace";
import WorkflowStatus from "Common/Types/Workflow/WorkflowStatus";
import RunWorkflow, {
  StorageMap,
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
  "11111111-1111-4111-8111-111111111112",
);
const WORKFLOW_LOG_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222223",
);
const PROJECT_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333334",
);
const INCIDENT_ID: string = "44444444-4444-4444-8444-444444444445";

const TRIGGER: string = "incident-on-create-or-update-1";
const WHAT_HAPPENED: string = `{{local.components.${TRIGGER}.returnValues.${WHAT_HAPPENED_ID}}}`;
const TITLE: string = `{{local.components.${TRIGGER}.returnValues.model.title}}`;

interface RecordedSpy {
  mock: { calls: Array<Array<unknown>> };
}

// The graph as the builder saves it: nodes without their metadata.
const GRAPH: JSONObject = JSON.parse(
  JSON.stringify({
    nodes: [
      {
        componentId: TRIGGER,
        metadataId: "incident-on-create-or-update",
        componentType: ComponentType.Trigger,
        args: { "listen-on": { title: true }, select: { title: true } },
      },
      {
        componentId: "switch-1",
        metadataId: ComponentID.Switch,
        componentType: ComponentType.Component,
        args: {
          value: WHAT_HAPPENED,
          cases: [
            { id: "case-1", comparison: "==", value: "created", compareAs: "" },
            { id: "case-2", comparison: "==", value: "updated", compareAs: "" },
          ],
        },
      },
      {
        componentId: "log-created",
        metadataId: ComponentID.Log,
        componentType: ComponentType.Component,
        args: { value: `New: ${TITLE} was ${WHAT_HAPPENED}` },
      },
      {
        componentId: "log-updated",
        metadataId: ComponentID.Log,
        componentType: ComponentType.Component,
        args: { value: `Changed: ${TITLE} was ${WHAT_HAPPENED}` },
      },
    ].map(
      (spec: {
        componentId: string;
        metadataId: string;
        componentType: ComponentType;
        args: JSONObject;
      }): JSONObject => {
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
            arguments: spec.args,
            returnValues: {},
          },
        };
      },
    ),
    edges: [
      [TRIGGER, "success", "switch-1"],
      ["switch-1", "case-1", "log-created"],
      ["switch-1", "case-2", "log-updated"],
    ].map((edge: Array<string>): JSONObject => {
      return {
        id: `${edge[0]}-${edge[1]}-${edge[2]}`,
        source: `canvas-${edge[0]}`,
        sourceHandle: edge[1]!,
        target: `canvas-${edge[2]}`,
        targetHandle: "in",
      };
    }),
  }),
) as JSONObject;

interface RunResult {
  persisted: JSONObject;
  trace: WorkflowStepTrace;
  logs: string;
}

let incidentRead: RecordedSpy;

const runWith: (startedWith: JSONObject) => Promise<RunResult> = async (
  startedWith: JSONObject,
): Promise<RunResult> => {
  const runner: RunWorkflow = new RunWorkflow();

  const workflow: Workflow = new Workflow();
  workflow.id = WORKFLOW_ID;
  workflow.projectId = PROJECT_ID;
  workflow.isEnabled = true;
  workflow.name = "Keep incidents in step";
  workflow.graph = GRAPH;

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

  const storageMap: StorageMap = {
    local: { variables: {}, components: {} },
    global: { variables: {} },
  };

  jest.spyOn(runner, "getVariables").mockResolvedValue({
    storageMap: storageMap,
    variables: [] as Array<WorkflowVariable>,
  });

  await runner.runWorkflow({
    arguments: startedWith,
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
  };
};

const ran: (trace: WorkflowStepTrace) => Array<string> = (
  trace: WorkflowStepTrace,
): Array<string> => {
  return trace.steps.map((step: WorkflowStepTraceEntry): string => {
    return step.componentId;
  });
};

const stepOf: (
  trace: WorkflowStepTrace,
  componentId: string,
) => WorkflowStepTraceEntry = (
  trace: WorkflowStepTrace,
  componentId: string,
): WorkflowStepTraceEntry => {
  return trace.steps.find((step: WorkflowStepTraceEntry): boolean => {
    return step.componentId === componentId;
  })!;
};

beforeEach(() => {
  jest.spyOn(ProjectService, "isProjectBlocked").mockResolvedValue(false);
  jest.spyOn(logger, "error").mockImplementation((): void => {
    return undefined;
  });
  jest.spyOn(WorkflowPrincipal, "getProps").mockResolvedValue({
    tenantId: PROJECT_ID,
  } as never);

  const incident: Incident = new Incident();
  incident._id = INCIDENT_ID;
  incident.title = "Database is down";

  incidentRead = jest
    .spyOn(IncidentService, "findOneById")
    .mockResolvedValue(incident) as unknown as RecordedSpy;
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a run of On Create or Update", () => {
  test("started by a create: the record, created, and the path for a new one", async () => {
    // What initTrigger starts it with for an On Create event.
    const result: RunResult = await runWith({
      data: { _id: INCIDENT_ID },
      [WHAT_HAPPENED_ID]: "created",
    });

    expect(result.persisted["workflowStatus"]).toBe(WorkflowStatus.Success);
    expect(ran(result.trace)).toEqual([TRIGGER, "switch-1", "log-created"]);
    expect(stepOf(result.trace, "log-created").argumentValues["value"]).toBe(
      "New: Database is down was created",
    );

    // The record was read with its Fields to pass on, as On Update reads it.
    const read: { id: ObjectID; select: JSONObject } = incidentRead.mock
      .calls[0]![0] as { id: ObjectID; select: JSONObject };

    expect(read.id.toString()).toBe(INCIDENT_ID);
    expect(read.select).toEqual({ _id: true, title: true });
  });

  test("started by an update: updated, and the path for a change", async () => {
    // What initTrigger starts it with for an On Update event.
    const result: RunResult = await runWith({
      data: {
        _id: INCIDENT_ID,
        miscData: { updatedFields: { title: "Database is down" } },
      },
      [WHAT_HAPPENED_ID]: "updated",
    });

    expect(ran(result.trace)).toEqual([TRIGGER, "switch-1", "log-updated"]);
    expect(stepOf(result.trace, "log-updated").argumentValues["value"]).toBe(
      "Changed: Database is down was updated",
    );
  });

  test("the trigger's own trace says what it handed on: the record and What Happened", async () => {
    const result: RunResult = await runWith({
      data: { _id: INCIDENT_ID },
      [WHAT_HAPPENED_ID]: "updated",
    });

    const trigger: WorkflowStepTraceEntry = stepOf(result.trace, TRIGGER);

    expect(trigger.returnValues[WHAT_HAPPENED_ID]).toBe("updated");
    expect(
      (trigger.returnValues["model"] as JSONObject | undefined)?.["title"],
    ).toBe("Database is down");
  });

  test("started from Run Workflow, as updated: the same path an update takes", async () => {
    const result: RunResult = await runWith({
      _id: INCIDENT_ID,
      select: { title: true },
      [WHAT_HAPPENED_ID]: "updated",
    });

    expect(ran(result.trace)).toEqual([TRIGGER, "switch-1", "log-updated"]);
  });

  test("started from Run Workflow with nothing asked: as created", async () => {
    const result: RunResult = await runWith({
      _id: INCIDENT_ID,
      select: { title: true },
    });

    expect(ran(result.trace)).toEqual([TRIGGER, "switch-1", "log-created"]);
  });

  test("asked something else, the run stops at the trigger and says why", async () => {
    const result: RunResult = await runWith({
      _id: INCIDENT_ID,
      [WHAT_HAPPENED_ID]: "deleted",
    });

    expect(result.persisted["workflowStatus"]).toBe(WorkflowStatus.Error);
    expect(ran(result.trace)).toEqual([TRIGGER]);
    expect(result.logs).toContain(
      'What Happened must be "created" or "updated", not "deleted".',
    );
    expect(incidentRead.mock.calls).toHaveLength(0);
  });
});
