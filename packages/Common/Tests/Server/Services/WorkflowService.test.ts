/**
 * WorkflowService trigger denormalization tests.
 *
 * The runner never parses workflow graphs. It finds workflows by the
 * triggerId / triggerArguments columns, which are derived from the graph and
 * written onto the row. Anything that puts a graph on a workflow without
 * populating those columns produces a workflow that looks correct in the
 * builder and silently never fires.
 *
 * That is exactly what creating a workflow with a graph already attached does
 * - importing a JSON export, or duplicating an existing workflow - so the
 * create path has to denormalize the trigger just like the update path does.
 *
 * updateOneById and the outbound call to the workflow service are both spied
 * on, so no database or network is touched.
 */

import WorkflowService from "../../../Server/Services/WorkflowService";
import Workflow from "../../../Models/DatabaseModels/Workflow";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import API from "../../../Utils/API";
import { afterEach, describe, expect, test, jest } from "@jest/globals";

const WORKFLOW_ID: string = "550e8400-e29b-41d4-a716-446655440000";

function scheduleGraph(): JSONObject {
  return {
    nodes: [
      {
        id: "node-1",
        data: {
          metadataId: "Schedule",
          componentType: "Trigger",
          nodeType: "Node",
          arguments: { "schedule-cron": "0 0 * * *" },
        },
      },
      {
        id: "node-2",
        data: {
          metadataId: "Webhook",
          componentType: "Component",
          nodeType: "Node",
          arguments: {},
        },
      },
    ],
    edges: [],
  };
}

function createdWorkflow(graph: JSONObject | undefined): Workflow {
  /*
   * webhookSecretKey is set so onCreateSuccess skips its own key-generation
   * update, leaving updateOneById calls attributable to trigger derivation.
   * projectId is left undefined so the fire-and-forget label/owner rule
   * engines are skipped.
   */
  return {
    _id: WORKFLOW_ID,
    id: new ObjectID(WORKFLOW_ID),
    graph: graph,
    webhookSecretKey: "already-set",
  } as unknown as Workflow;
}

function spyOnUpdateOneById(): jest.SpyInstance {
  return jest
    .spyOn(WorkflowService, "updateOneById")
    .mockResolvedValue(undefined as never) as unknown as jest.SpyInstance;
}

function spyOnApiPost(): jest.SpyInstance {
  return jest
    .spyOn(API, "post")
    .mockResolvedValue({} as never) as unknown as jest.SpyInstance;
}

type OnCreateSuccessFunction = (
  onCreate: unknown,
  createdItem: Workflow,
) => Promise<Workflow>;

function onCreateSuccess(createdItem: Workflow): Promise<Workflow> {
  const hook: OnCreateSuccessFunction = (
    WorkflowService as unknown as { onCreateSuccess: OnCreateSuccessFunction }
  ).onCreateSuccess.bind(WorkflowService);

  return hook({ createBy: { data: createdItem }, carryForward: null }, {
    ...createdItem,
  } as Workflow);
}

type OnUpdateSuccessFunction = (
  onUpdate: unknown,
  updatedItemIds: Array<ObjectID>,
) => Promise<unknown>;

function onUpdateSuccess(graph: JSONObject | undefined): Promise<unknown> {
  const hook: OnUpdateSuccessFunction = (
    WorkflowService as unknown as { onUpdateSuccess: OnUpdateSuccessFunction }
  ).onUpdateSuccess.bind(WorkflowService);

  return hook(
    {
      updateBy: {
        query: { _id: WORKFLOW_ID },
        data: graph === undefined ? {} : { graph: graph },
      },
    },
    [new ObjectID(WORKFLOW_ID)],
  );
}

describe("WorkflowService trigger denormalization on create", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("writes the trigger from the graph when a workflow is created with one", async () => {
    const updateSpy: jest.SpyInstance = spyOnUpdateOneById();
    spyOnApiPost();

    await onCreateSuccess(createdWorkflow(scheduleGraph()));

    expect(updateSpy).toHaveBeenCalledTimes(1);

    const updateArgs: JSONObject = updateSpy.mock.calls[0]![0] as JSONObject;
    const data: JSONObject = updateArgs["data"] as JSONObject;

    expect(data["triggerId"]).toBe("Schedule");
    expect(data["triggerArguments"]).toEqual({ "schedule-cron": "0 0 * * *" });

    // must not recurse back through the hooks it is running inside of.
    expect(updateArgs["props"]).toEqual({ isRoot: true, ignoreHooks: true });
  });

  test("notifies the workflow service so schedule triggers get registered", async () => {
    spyOnUpdateOneById();
    const postSpy: jest.SpyInstance = spyOnApiPost();

    await onCreateSuccess(createdWorkflow(scheduleGraph()));

    expect(postSpy).toHaveBeenCalledTimes(1);

    const postArgs: JSONObject = postSpy.mock.calls[0]![0] as JSONObject;

    expect(postArgs["url"]!.toString()).toContain(
      `/workflow/update/${WORKFLOW_ID}`,
    );
  });

  test("clears the trigger when the graph has no trigger node", async () => {
    const updateSpy: jest.SpyInstance = spyOnUpdateOneById();
    spyOnApiPost();

    await onCreateSuccess(
      createdWorkflow({
        nodes: [
          {
            id: "node-1",
            data: {
              metadataId: "Webhook",
              componentType: "Component",
              nodeType: "Node",
              arguments: {},
            },
          },
        ],
        edges: [],
      }),
    );

    const data: JSONObject = (updateSpy.mock.calls[0]![0] as JSONObject)[
      "data"
    ] as JSONObject;

    expect(data["triggerId"]).toBeNull();
    expect(data["triggerArguments"]).toEqual({});
  });

  test("does no trigger work for a workflow created without a graph", async () => {
    const updateSpy: jest.SpyInstance = spyOnUpdateOneById();
    const postSpy: jest.SpyInstance = spyOnApiPost();

    await onCreateSuccess(createdWorkflow(undefined));

    expect(updateSpy).not.toHaveBeenCalled();
    expect(postSpy).not.toHaveBeenCalled();
  });

  test("does not fail the create when the workflow service is unreachable", async () => {
    const updateSpy: jest.SpyInstance = spyOnUpdateOneById();

    jest
      .spyOn(API, "post")
      .mockRejectedValue(new Error("connect ECONNREFUSED") as never);

    /*
     * The row and its trigger are already persisted at this point, so a
     * workflow service outage must not turn a successful import into an error.
     */
    await expect(
      onCreateSuccess(createdWorkflow(scheduleGraph())),
    ).resolves.toBeDefined();

    expect(updateSpy).toHaveBeenCalledTimes(1);
  });

  test("derives the trigger for a genuinely imported workflow, which has no webhook secret yet", async () => {
    const updateSpy: jest.SpyInstance = spyOnUpdateOneById();
    spyOnApiPost();

    /*
     * webhookSecretKey carries create: [] access control, so it is stripped
     * from export files and an imported workflow reaches this hook without
     * one. That means two updates run in sequence - key generation, then
     * trigger derivation - and the trigger write must still happen.
     */
    const imported: Workflow = {
      _id: WORKFLOW_ID,
      id: new ObjectID(WORKFLOW_ID),
      graph: scheduleGraph(),
    } as unknown as Workflow;

    await onCreateSuccess(imported);

    expect(updateSpy).toHaveBeenCalledTimes(2);

    const secretUpdate: JSONObject = (
      updateSpy.mock.calls[0]![0] as JSONObject
    )["data"] as JSONObject;
    const triggerUpdate: JSONObject = (
      updateSpy.mock.calls[1]![0] as JSONObject
    )["data"] as JSONObject;

    expect(secretUpdate["webhookSecretKey"]).toBeDefined();
    expect(triggerUpdate["triggerId"]).toBe("Schedule");
  });

  test("writes no trigger for a graph that carries no nodes key", async () => {
    const updateSpy: jest.SpyInstance = spyOnUpdateOneById();
    spyOnApiPost();

    await onCreateSuccess(createdWorkflow({ edges: [] }));

    expect(updateSpy).not.toHaveBeenCalled();
  });
});

describe("WorkflowService trigger denormalization on update", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("writes the trigger when a saved graph carries one", async () => {
    const updateSpy: jest.SpyInstance = spyOnUpdateOneById();
    spyOnApiPost();

    await onUpdateSuccess(scheduleGraph());

    expect(updateSpy).toHaveBeenCalledTimes(1);

    const data: JSONObject = (updateSpy.mock.calls[0]![0] as JSONObject)[
      "data"
    ] as JSONObject;

    expect(data["triggerId"]).toBe("Schedule");
    expect(data["triggerArguments"]).toEqual({ "schedule-cron": "0 0 * * *" });
  });

  test("clears the trigger when the trigger node is removed in the builder", async () => {
    const updateSpy: jest.SpyInstance = spyOnUpdateOneById();
    spyOnApiPost();

    await onUpdateSuccess({ nodes: [], edges: [] });

    const data: JSONObject = (updateSpy.mock.calls[0]![0] as JSONObject)[
      "data"
    ] as JSONObject;

    expect(data["triggerId"]).toBeNull();
    expect(data["triggerArguments"]).toEqual({});
  });

  test("touches no trigger columns when an update does not carry the graph", async () => {
    const updateSpy: jest.SpyInstance = spyOnUpdateOneById();
    spyOnApiPost();

    // e.g. renaming a workflow must leave its trigger alone.
    await onUpdateSuccess(undefined);

    expect(updateSpy).not.toHaveBeenCalled();
  });

  test("always notifies the workflow service so trigger changes take effect", async () => {
    spyOnUpdateOneById();
    const postSpy: jest.SpyInstance = spyOnApiPost();

    await onUpdateSuccess(scheduleGraph());

    expect(postSpy).toHaveBeenCalledTimes(1);
    expect(
      (postSpy.mock.calls[0]![0] as JSONObject)["url"]!.toString(),
    ).toContain(`/workflow/update/${WORKFLOW_ID}`);
  });
});
