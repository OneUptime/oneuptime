import InstrumentationTaskTrigger from "../../../Server/Utils/AI/SRE/InstrumentationTaskTrigger";
import FixRunBudget from "../../../Server/Utils/AI/CodeFix/FixRunBudget";
import ProjectService from "../../../Server/Services/ProjectService";
import CodeRepositoryService from "../../../Server/Services/CodeRepositoryService";
import AIRunService from "../../../Server/Services/AIRunService";
import Project from "../../../Models/DatabaseModels/Project";
import AIRun from "../../../Models/DatabaseModels/AIRun";
import AIRunType from "../../../Types/AI/AIRunType";
import AIRunStatus from "../../../Types/AI/AIRunStatus";
import CodeFixTaskType from "../../../Types/AI/CodeFixTaskType";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import { describe, expect, test, afterEach, beforeEach } from "@jest/globals";

/*
 * The ImproveInstrumentation trigger: an INCONCLUSIVE AI investigation
 * enqueues a CodeFix AIRun that opens an instrumentation PR — but ONLY for
 * projects that explicitly opted in for the investigation's incident or alert
 * lane (both default FALSE — G11 posture), only when a GitHub-App repo exists to open the PR
 * against, and at most one non-terminal run per incident/alert. The trigger
 * runs inside postAnalysis, so it must NEVER throw.
 */

const projectId: ObjectID = ObjectID.generate();
const incidentId: ObjectID = ObjectID.generate();
const alertId: ObjectID = ObjectID.generate();

function fakeProject(data?: {
  enableAi?: boolean;
  enableIncidentInstrumentationFixTasks?: boolean;
  enableAlertInstrumentationFixTasks?: boolean;
}): Project {
  return {
    id: projectId,
    enableAi: data?.enableAi ?? true,
    enableIncidentInstrumentationFixTasks:
      data?.enableIncidentInstrumentationFixTasks ?? true,
    enableAlertInstrumentationFixTasks:
      data?.enableAlertInstrumentationFixTasks ?? true,
  } as unknown as Project;
}

describe("InstrumentationTaskTrigger.shouldEnqueueInstrumentationTask", () => {
  test("does not enqueue when the project is missing", () => {
    expect(
      InstrumentationTaskTrigger.shouldEnqueueInstrumentationTask({
        project: null,
        incidentId,
        hasConnectedRepository: true,
        existingRun: null,
      }).enqueue,
    ).toBe(false);
  });

  test("does not enqueue when AI is disabled for the project", () => {
    expect(
      InstrumentationTaskTrigger.shouldEnqueueInstrumentationTask({
        project: fakeProject({ enableAi: false }),
        incidentId,
        hasConnectedRepository: true,
        existingRun: null,
      }).enqueue,
    ).toBe(false);
  });

  test("opt-in is strict: an unset flag (legacy row) never enqueues — default is FALSE", () => {
    const project: Project = {
      id: projectId,
      enableAi: true,
      // enableIncidentInstrumentationFixTasks deliberately absent.
    } as unknown as Project;

    const decision: ReturnType<
      typeof InstrumentationTaskTrigger.shouldEnqueueInstrumentationTask
    > = InstrumentationTaskTrigger.shouldEnqueueInstrumentationTask({
      project,
      incidentId,
      hasConnectedRepository: true,
      existingRun: null,
    });

    expect(decision.enqueue).toBe(false);
    expect(decision.reason).toMatch(/not opted in/);
  });

  test("incident and alert opt-ins are independent: incident enabled does not enable alerts", () => {
    const project: Project = fakeProject({
      enableIncidentInstrumentationFixTasks: true,
      enableAlertInstrumentationFixTasks: false,
    });

    expect(
      InstrumentationTaskTrigger.shouldEnqueueInstrumentationTask({
        project,
        incidentId,
        hasConnectedRepository: true,
        existingRun: null,
      }).enqueue,
    ).toBe(true);
    expect(
      InstrumentationTaskTrigger.shouldEnqueueInstrumentationTask({
        project,
        alertId,
        hasConnectedRepository: true,
        existingRun: null,
      }).enqueue,
    ).toBe(false);
  });

  test("incident and alert opt-ins are independent: alert enabled does not enable incidents", () => {
    const project: Project = fakeProject({
      enableIncidentInstrumentationFixTasks: false,
      enableAlertInstrumentationFixTasks: true,
    });

    expect(
      InstrumentationTaskTrigger.shouldEnqueueInstrumentationTask({
        project,
        incidentId,
        hasConnectedRepository: true,
        existingRun: null,
      }).enqueue,
    ).toBe(false);
    expect(
      InstrumentationTaskTrigger.shouldEnqueueInstrumentationTask({
        project,
        alertId,
        hasConnectedRepository: true,
        existingRun: null,
      }).enqueue,
    ).toBe(true);
  });

  test("a subjectless gate decision is rejected instead of borrowing either opt-in", () => {
    const decision: ReturnType<
      typeof InstrumentationTaskTrigger.shouldEnqueueInstrumentationTask
    > = InstrumentationTaskTrigger.shouldEnqueueInstrumentationTask({
      project: fakeProject(),
      hasConnectedRepository: true,
      existingRun: null,
    });

    expect(decision.enqueue).toBe(false);
    expect(decision.reason).toMatch(/subject/);
  });

  test("a gate carrying both subject types is rejected instead of borrowing the incident opt-in", () => {
    const decision: ReturnType<
      typeof InstrumentationTaskTrigger.shouldEnqueueInstrumentationTask
    > = InstrumentationTaskTrigger.shouldEnqueueInstrumentationTask({
      project: fakeProject(),
      incidentId,
      alertId,
      hasConnectedRepository: true,
      existingRun: null,
    });

    expect(decision.enqueue).toBe(false);
    expect(decision.reason).toMatch(/exactly one/);
  });

  test("does not enqueue without a GitHub-App-connected repository", () => {
    const decision: ReturnType<
      typeof InstrumentationTaskTrigger.shouldEnqueueInstrumentationTask
    > = InstrumentationTaskTrigger.shouldEnqueueInstrumentationTask({
      project: fakeProject(),
      incidentId,
      hasConnectedRepository: false,
      existingRun: null,
    });

    expect(decision.enqueue).toBe(false);
    expect(decision.reason).toMatch(/repository/);
  });

  test("dedupe: an existing non-terminal run for the subject blocks a second one", () => {
    const decision: ReturnType<
      typeof InstrumentationTaskTrigger.shouldEnqueueInstrumentationTask
    > = InstrumentationTaskTrigger.shouldEnqueueInstrumentationTask({
      project: fakeProject(),
      incidentId,
      hasConnectedRepository: true,
      existingRun: { id: ObjectID.generate() } as unknown as AIRun,
    });

    expect(decision.enqueue).toBe(false);
    expect(decision.reason).toMatch(/already exists/);
  });

  test("enqueues when opted in, a repository exists, and no run is live for the subject", () => {
    expect(
      InstrumentationTaskTrigger.shouldEnqueueInstrumentationTask({
        project: fakeProject(),
        incidentId,
        hasConnectedRepository: true,
        existingRun: null,
      }).enqueue,
    ).toBe(true);
  });
});

describe("InstrumentationTaskTrigger.enqueueForInconclusiveInvestigation", () => {
  beforeEach(() => {
    /*
     * The daily fix-run budget defaults to allowed; its own decision matrix
     * lives in FixRunBudget.test.ts. Mocking getBudgetStatus covers both
     * the trigger's pre-check and assertWithinBudget inside the enqueue.
     */
    jest.spyOn(FixRunBudget, "getBudgetStatus").mockResolvedValue({
      allowed: true,
      limit: 25,
      paused: false,
      runsToday: 0,
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("over the daily fix-run budget: a logged SKIP — no run created, nothing thrown into the investigation", async () => {
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue(fakeProject());
    const getBudgetStatus: jest.SpyInstance = jest
      .spyOn(FixRunBudget, "getBudgetStatus")
      .mockResolvedValue({
        allowed: false,
        limit: 25,
        paused: false,
        runsToday: 25,
      });
    const countBy: jest.SpyInstance = jest.spyOn(
      CodeRepositoryService,
      "countBy",
    );
    const create: jest.SpyInstance = jest.spyOn(AIRunService, "create");

    await expect(
      InstrumentationTaskTrigger.enqueueForInconclusiveInvestigation({
        projectId,
        incidentId,
      }),
    ).resolves.toBeUndefined();

    // Skipped before the repo/dedupe queries, and no run was created.
    expect(countBy).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(getBudgetStatus).toHaveBeenCalledWith(projectId, {
      incidentId,
      alertId: undefined,
    });
  });

  test("a not-opted-in project skips cheaply: no repo count, no dedupe query, no run created", async () => {
    jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue(
        fakeProject({ enableIncidentInstrumentationFixTasks: false }),
      );
    const countBy: jest.SpyInstance = jest.spyOn(
      CodeRepositoryService,
      "countBy",
    );
    const findOneBy: jest.SpyInstance = jest.spyOn(AIRunService, "findOneBy");
    const create: jest.SpyInstance = jest.spyOn(AIRunService, "create");

    await InstrumentationTaskTrigger.enqueueForInconclusiveInvestigation({
      projectId,
      incidentId,
    });

    expect(countBy).not.toHaveBeenCalled();
    expect(findOneBy).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  test("the alert opt-in cannot enable an incident instrumentation task", async () => {
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue(
      fakeProject({
        enableIncidentInstrumentationFixTasks: false,
        enableAlertInstrumentationFixTasks: true,
      }),
    );
    const countBy: jest.SpyInstance = jest.spyOn(
      CodeRepositoryService,
      "countBy",
    );

    await InstrumentationTaskTrigger.enqueueForInconclusiveInvestigation({
      projectId,
      incidentId,
    });

    expect(countBy).not.toHaveBeenCalled();
  });

  test("records a Queued ImproveInstrumentation CodeFix run carrying the incident subject", async () => {
    const findProject: jest.SpyInstance = jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue(fakeProject());
    jest
      .spyOn(CodeRepositoryService, "countBy")
      .mockResolvedValue(new PositiveNumber(1));
    const findOneBy: jest.SpyInstance = jest
      .spyOn(AIRunService, "findOneBy")
      .mockResolvedValue(null);
    const create: jest.SpyInstance = jest
      .spyOn(AIRunService, "create")
      .mockResolvedValue({ id: ObjectID.generate() } as unknown as AIRun);

    await InstrumentationTaskTrigger.enqueueForInconclusiveInvestigation({
      projectId,
      incidentId,
    });

    expect(findProject).toHaveBeenCalledWith(
      expect.objectContaining({
        select: {
          enableAi: true,
          enableIncidentInstrumentationFixTasks: true,
        },
      }),
    );
    expect(FixRunBudget.getBudgetStatus).toHaveBeenCalledWith(projectId, {
      incidentId,
      alertId: undefined,
    });

    // The dedupe guard queries per (subject, ImproveInstrumentation).
    expect(findOneBy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({
          runType: AIRunType.CodeFix,
          codeFixTaskType: CodeFixTaskType.ImproveInstrumentation,
          triggeredByIncidentId: incidentId,
        }),
      }),
    );

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          projectId: projectId,
          runType: AIRunType.CodeFix,
          codeFixTaskType: CodeFixTaskType.ImproveInstrumentation,
          status: AIRunStatus.Queued,
          triggeredByIncidentId: incidentId,
        }),
        props: expect.objectContaining({ isRoot: true }),
      }),
    );
  });

  test("an alert-subject investigation enqueues with triggeredByAlertId", async () => {
    const findProject: jest.SpyInstance = jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue(fakeProject());
    jest
      .spyOn(CodeRepositoryService, "countBy")
      .mockResolvedValue(new PositiveNumber(1));
    jest.spyOn(AIRunService, "findOneBy").mockResolvedValue(null);
    const create: jest.SpyInstance = jest
      .spyOn(AIRunService, "create")
      .mockResolvedValue({ id: ObjectID.generate() } as unknown as AIRun);

    await InstrumentationTaskTrigger.enqueueForInconclusiveInvestigation({
      projectId,
      alertId,
    });

    expect(findProject).toHaveBeenCalledWith(
      expect.objectContaining({
        select: {
          enableAi: true,
          enableAlertInstrumentationFixTasks: true,
        },
      }),
    );
    expect(FixRunBudget.getBudgetStatus).toHaveBeenCalledWith(projectId, {
      incidentId: undefined,
      alertId,
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          codeFixTaskType: CodeFixTaskType.ImproveInstrumentation,
          triggeredByAlertId: alertId,
        }),
      }),
    );
  });

  test("dedupe: a live ImproveInstrumentation run for the same subject blocks creation", async () => {
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue(fakeProject());
    jest
      .spyOn(CodeRepositoryService, "countBy")
      .mockResolvedValue(new PositiveNumber(1));
    jest
      .spyOn(AIRunService, "findOneBy")
      .mockResolvedValue({ id: ObjectID.generate() } as unknown as AIRun);
    const create: jest.SpyInstance = jest.spyOn(AIRunService, "create");

    await InstrumentationTaskTrigger.enqueueForInconclusiveInvestigation({
      projectId,
      incidentId,
    });

    expect(create).not.toHaveBeenCalled();
  });

  test("no GitHub-App repository means no run", async () => {
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue(fakeProject());
    jest
      .spyOn(CodeRepositoryService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
    jest.spyOn(AIRunService, "findOneBy").mockResolvedValue(null);
    const create: jest.SpyInstance = jest.spyOn(AIRunService, "create");

    await InstrumentationTaskTrigger.enqueueForInconclusiveInvestigation({
      projectId,
      incidentId,
    });

    expect(create).not.toHaveBeenCalled();
  });

  test("never throws — a failed enqueue must not fail the investigation's postAnalysis", async () => {
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue(fakeProject());
    jest
      .spyOn(CodeRepositoryService, "countBy")
      .mockResolvedValue(new PositiveNumber(1));
    jest.spyOn(AIRunService, "findOneBy").mockResolvedValue(null);
    jest
      .spyOn(AIRunService, "create")
      .mockRejectedValue(new Error("database is down"));

    await expect(
      InstrumentationTaskTrigger.enqueueForInconclusiveInvestigation({
        projectId,
        incidentId,
      }),
    ).resolves.toBeUndefined();
  });

  test("a subjectless call is a no-op", async () => {
    const findProject: jest.SpyInstance = jest.spyOn(
      ProjectService,
      "findOneById",
    );

    await InstrumentationTaskTrigger.enqueueForInconclusiveInvestigation({
      projectId,
    });

    expect(findProject).not.toHaveBeenCalled();
  });

  test("a call carrying both subject types is a no-op", async () => {
    const findProject: jest.SpyInstance = jest.spyOn(
      ProjectService,
      "findOneById",
    );

    await InstrumentationTaskTrigger.enqueueForInconclusiveInvestigation({
      projectId,
      incidentId,
      alertId,
    });

    expect(findProject).not.toHaveBeenCalled();
  });
});
