import QueueWorkflow from "../../../FeatureSet/Workflow/Services/QueueWorkflow";
import WorkflowService from "Common/Server/Services/WorkflowService";
import WorkflowLogService from "Common/Server/Services/WorkflowLogService";
import ProjectService from "Common/Server/Services/ProjectService";
import Queue from "Common/Server/Infrastructure/Queue";
import Semaphore from "Common/Server/Infrastructure/Semaphore";
import Workflow from "Common/Models/DatabaseModels/Workflow";
import WorkflowLog from "Common/Models/DatabaseModels/WorkflowLog";
import ObjectID from "Common/Types/ObjectID";
import WorkflowStatus from "Common/Types/Workflow/WorkflowStatus";
import { ExecuteWorkflowType } from "Common/Server/Types/Workflow/TriggerCode";

jest.mock("Common/Server/Services/WorkflowService", () => {
  return {
    __esModule: true,
    default: { findOneById: jest.fn(), updateOneById: jest.fn() },
  };
});
jest.mock("Common/Server/Services/WorkflowLogService", () => {
  return {
    __esModule: true,
    default: { findOneBy: jest.fn(), create: jest.fn(), countBy: jest.fn() },
  };
});
jest.mock("Common/Server/Services/ProjectService", () => {
  return { __esModule: true, default: { getCurrentPlan: jest.fn() } };
});
jest.mock("Common/Server/Services/WorkflowVariableService", () => {
  return { __esModule: true, default: { findBy: jest.fn() } };
});
jest.mock("Common/Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    default: { addJob: jest.fn() },
    QueueName: { Workflow: "Workflow" },
  };
});
jest.mock("Common/Server/Infrastructure/Semaphore", () => {
  return { __esModule: true, default: { lock: jest.fn(), release: jest.fn() } };
});

const workflowId: ObjectID = new ObjectID(
  "fe6e25f5-943a-43cf-a551-2cc4e86256c7",
);
const projectId: ObjectID = new ObjectID(
  "b4ac8f60-f4a2-4b73-82d1-2532026b4200",
);
const input: ExecuteWorkflowType = {
  workflowId,
  returnValues: { event: "issue_comment", comment: "@oneuptime incident down" },
  idempotencyKey: "github:12:delivery-1",
};

describe("GitHub delivery workflow scheduling persistence", () => {
  let logs: Map<string, WorkflowLog>;
  let workflow: Workflow;
  beforeEach(() => {
    jest.clearAllMocks();
    logs = new Map();
    workflow = new Workflow();
    workflow.id = workflowId;
    workflow.projectId = projectId;
    workflow.isEnabled = true;
    jest.mocked(WorkflowService.findOneById).mockResolvedValue(workflow);
    jest
      .mocked(ProjectService.getCurrentPlan)
      .mockResolvedValue({ plan: null, isSubscriptionUnpaid: false });
    jest
      .mocked(WorkflowLogService.findOneBy)
      .mockImplementation(
        async (data: Parameters<typeof WorkflowLogService.findOneBy>[0]) => {
          return logs.get(data.query._id as string) || null;
        },
      );
    jest
      .mocked(WorkflowLogService.create)
      .mockImplementation(
        async (data: Parameters<typeof WorkflowLogService.create>[0]) => {
          if (!data.data.id) {
            data.data.id = ObjectID.generate();
          }
          logs.set(data.data.id!.toString(), data.data);
          return data.data;
        },
      );
    jest.mocked(Queue.addJob).mockResolvedValue({} as never);
    jest.mocked(Semaphore.lock).mockResolvedValue({} as never);
    jest.mocked(Semaphore.release).mockResolvedValue(undefined);
  });

  test("same delivery persists one run and adds with duplicate-safe queue behavior", async () => {
    await QueueWorkflow.addWorkflowToQueue(input);
    await QueueWorkflow.addWorkflowToQueue(input);
    expect(WorkflowLogService.create).toHaveBeenCalledTimes(1);
    expect(logs.size).toBe(1);
    const calls: unknown[][] = jest.mocked(Queue.addJob).mock.calls;
    expect(calls[0]![1]).toBe(calls[1]![1]);
    expect(calls[0]![4]).toEqual(
      expect.objectContaining({ skipExistenceCheck: true }),
    );
    expect(calls[0]![3]).toEqual(
      expect.objectContaining({
        workflowLogId: calls[0]![1],
        data: input.returnValues,
      }),
    );
  });
  test("queue outage after log creation can be retried using the same persisted run", async () => {
    jest
      .mocked(Queue.addJob)
      .mockRejectedValueOnce(new Error("queue unavailable"));
    await expect(QueueWorkflow.addWorkflowToQueue(input)).rejects.toThrow(
      "queue unavailable",
    );
    expect(logs.size).toBe(1);
    await QueueWorkflow.addWorkflowToQueue(input);
    expect(WorkflowLogService.create).toHaveBeenCalledTimes(1);
    expect(Queue.addJob).toHaveBeenCalledTimes(2);
    expect(Semaphore.release).toHaveBeenCalledTimes(2);
  });
  test.each([
    WorkflowStatus.Running,
    WorkflowStatus.Waiting,
    WorkflowStatus.Success,
    WorkflowStatus.Error,
    WorkflowStatus.Timeout,
    WorkflowStatus.WorkflowCountExceeded,
  ])(
    "redelivery does not re-run a %s workflow",
    async (status: WorkflowStatus) => {
      await QueueWorkflow.addWorkflowToQueue(input);
      logs.values().next().value!.workflowStatus = status;
      jest.mocked(Queue.addJob).mockClear();
      await QueueWorkflow.addWorkflowToQueue(input);
      expect(Queue.addJob).not.toHaveBeenCalled();
      expect(WorkflowLogService.create).toHaveBeenCalledTimes(1);
    },
  );
  test("different workflows and different deliveries use different stable IDs", () => {
    const id: ObjectID = QueueWorkflow.getDeliveryRunId(workflowId, "first");
    expect(ObjectID.isValidUUID(id.toString())).toBe(true);
    expect(id.toString()).toBe(
      QueueWorkflow.getDeliveryRunId(workflowId, "first").toString(),
    );
    expect(id.toString()).not.toBe(
      QueueWorkflow.getDeliveryRunId(workflowId, "second").toString(),
    );
    expect(id.toString()).not.toBe(
      QueueWorkflow.getDeliveryRunId(projectId, "first").toString(),
    );
  });
  test("new deliveries still require an enabled workflow", async () => {
    workflow.isEnabled = false;
    await expect(QueueWorkflow.addWorkflowToQueue(input)).rejects.toThrow(
      "not enabled",
    );
    expect(Queue.addJob).not.toHaveBeenCalled();
    expect(Semaphore.release).toHaveBeenCalledTimes(1);
  });
  test("new deliveries still enforce subscription gates", async () => {
    jest
      .mocked(ProjectService.getCurrentPlan)
      .mockResolvedValue({ plan: null, isSubscriptionUnpaid: true });
    await QueueWorkflow.addWorkflowToQueue(input);
    expect(Queue.addJob).not.toHaveBeenCalled();
    expect(WorkflowLogService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          workflowStatus: WorkflowStatus.WorkflowCountExceeded,
        }),
      }),
    );
  });
  test("log-storage failure never queues untracked work", async () => {
    jest
      .mocked(WorkflowLogService.create)
      .mockRejectedValueOnce(new Error("database unavailable"));
    await expect(QueueWorkflow.addWorkflowToQueue(input)).rejects.toThrow(
      "database unavailable",
    );
    expect(Queue.addJob).not.toHaveBeenCalled();
    expect(Semaphore.release).toHaveBeenCalledTimes(1);
  });
  test("ordinary workflow runs still create separate log IDs", async () => {
    const ordinary: ExecuteWorkflowType = { workflowId, returnValues: {} };
    await QueueWorkflow.addWorkflowToQueue(ordinary);
    await QueueWorkflow.addWorkflowToQueue(ordinary);
    expect(WorkflowLogService.create).toHaveBeenCalledTimes(2);
    expect(logs.size).toBe(2);
    expect(Semaphore.lock).not.toHaveBeenCalled();
  });
  test("rejects delivery keys for repeatable schedules and individual step runs", async () => {
    await expect(
      QueueWorkflow.addWorkflowToQueue(input, "* * * * *"),
    ).rejects.toThrow("immediate");
    await expect(
      QueueWorkflow.addWorkflowToQueue({
        ...input,
        runOnlyComponentId: "step-1",
      }),
    ).rejects.toThrow("immediate");
    expect(Queue.addJob).not.toHaveBeenCalled();
  });
});
