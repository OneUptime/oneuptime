import FixFromIncidentTaskTrigger, {
  AutoFixTaskGateDecision,
} from "../../../../Server/Utils/AI/SRE/FixFromIncidentTaskTrigger";
import SubjectCodeFixRun from "../../../../Server/Utils/AI/SRE/SubjectCodeFixRun";
import FixRunBudget from "../../../../Server/Utils/AI/CodeFix/FixRunBudget";
import ProjectService from "../../../../Server/Services/ProjectService";
import Project from "../../../../Models/DatabaseModels/Project";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import CodeFixTaskType from "../../../../Types/AI/CodeFixTaskType";
import ObjectID from "../../../../Types/ObjectID";
import { describe, expect, test, afterEach, beforeEach } from "@jest/globals";

/*
 * The AUTOMATIC form of the FixFromIncident trigger: a CONFIDENT
 * investigation (per the structured G6 signal) enqueues a fix-PR CodeFix
 * run with no human click — but ONLY for projects that explicitly opted in
 * (Project.enableAutomaticCodeFixes, default FALSE — G11 posture), only
 * when a GitHub-App repo exists to open the PR against, at most one
 * non-terminal run per subject, and inside the daily fix-run budget. It
 * runs inside the investigation's postAnalysis, so it must NEVER throw,
 * and the run stays system-authored (no userId). Unlike its
 * human-triggered sibling (createFixTaskFromInvestigation, tested in
 * Tests/Server/Services/FixFromIncidentTaskTrigger.test.ts), every failed
 * gate is a quiet skip, never a thrown message.
 */

const projectId: ObjectID = ObjectID.generate();
const incidentId: ObjectID = ObjectID.generate();
const alertId: ObjectID = ObjectID.generate();

function fakeProject(data?: {
  enableAi?: boolean;
  enableAutomaticCodeFixes?: boolean;
}): Project {
  return {
    id: projectId,
    enableAi: data?.enableAi ?? true,
    enableAutomaticCodeFixes: data?.enableAutomaticCodeFixes ?? true,
  } as unknown as Project;
}

function fakeRun(): AIRun {
  return { id: ObjectID.generate() } as unknown as AIRun;
}

describe("FixFromIncidentTaskTrigger.shouldAutoEnqueueFixTask", () => {
  test("does not enqueue when the project is missing", () => {
    const decision: AutoFixTaskGateDecision =
      FixFromIncidentTaskTrigger.shouldAutoEnqueueFixTask({
        project: null,
        hasConnectedRepository: true,
        existingRun: null,
      });

    expect(decision.enqueue).toBe(false);
    expect(decision.reason).toMatch(/not found/);
  });

  test("does not enqueue when AI is disabled for the project", () => {
    const decision: AutoFixTaskGateDecision =
      FixFromIncidentTaskTrigger.shouldAutoEnqueueFixTask({
        project: fakeProject({ enableAi: false }),
        hasConnectedRepository: true,
        existingRun: null,
      });

    expect(decision.enqueue).toBe(false);
    expect(decision.reason).toMatch(/disabled/);
  });

  test("opt-in is strict: an unset flag (legacy row) never enqueues — default is FALSE", () => {
    const project: Project = {
      id: projectId,
      enableAi: true,
      // enableAutomaticCodeFixes deliberately absent.
    } as unknown as Project;

    const decision: AutoFixTaskGateDecision =
      FixFromIncidentTaskTrigger.shouldAutoEnqueueFixTask({
        project,
        hasConnectedRepository: true,
        existingRun: null,
      });

    expect(decision.enqueue).toBe(false);
    expect(decision.reason).toMatch(/not opted in/);
  });

  test("an explicit false flag never enqueues", () => {
    const decision: AutoFixTaskGateDecision =
      FixFromIncidentTaskTrigger.shouldAutoEnqueueFixTask({
        project: fakeProject({ enableAutomaticCodeFixes: false }),
        hasConnectedRepository: true,
        existingRun: null,
      });

    expect(decision.enqueue).toBe(false);
    expect(decision.reason).toMatch(/not opted in/);
  });

  test("does not enqueue without a GitHub-App-connected repository", () => {
    const decision: AutoFixTaskGateDecision =
      FixFromIncidentTaskTrigger.shouldAutoEnqueueFixTask({
        project: fakeProject(),
        hasConnectedRepository: false,
        existingRun: null,
      });

    expect(decision.enqueue).toBe(false);
    expect(decision.reason).toMatch(/repository/);
  });

  test("dedupe: an existing non-terminal run for the subject blocks a second one", () => {
    const decision: AutoFixTaskGateDecision =
      FixFromIncidentTaskTrigger.shouldAutoEnqueueFixTask({
        project: fakeProject(),
        hasConnectedRepository: true,
        existingRun: fakeRun(),
      });

    expect(decision.enqueue).toBe(false);
    expect(decision.reason).toMatch(/already exists/);
  });

  test("enqueues when opted in, a repository exists, and no run is live for the subject", () => {
    const decision: AutoFixTaskGateDecision =
      FixFromIncidentTaskTrigger.shouldAutoEnqueueFixTask({
        project: fakeProject(),
        hasConnectedRepository: true,
        existingRun: null,
      });

    expect(decision.enqueue).toBe(true);
    expect(decision.reason).toMatch(/passed/);
  });
});

describe("FixFromIncidentTaskTrigger.autoEnqueueFromConfidentInvestigation", () => {
  let getBudgetStatus: jest.SpyInstance;
  let hasRepository: jest.SpyInstance;
  let findNonTerminalRun: jest.SpyInstance;
  let enqueue: jest.SpyInstance;

  beforeEach(() => {
    /*
     * The daily fix-run budget defaults to allowed; its own decision matrix
     * lives in FixRunBudget.test.ts.
     */
    getBudgetStatus = jest
      .spyOn(FixRunBudget, "getBudgetStatus")
      .mockResolvedValue({
        allowed: true,
        limit: 25,
        paused: false,
        runsToday: 0,
      });
    hasRepository = jest
      .spyOn(SubjectCodeFixRun, "hasGitHubAppConnectedRepository")
      .mockResolvedValue(true);
    findNonTerminalRun = jest
      .spyOn(SubjectCodeFixRun, "findNonTerminalRunForSubject")
      .mockResolvedValue(null);
    enqueue = jest
      .spyOn(SubjectCodeFixRun, "enqueueSubjectCodeFixRun")
      .mockResolvedValue(fakeRun());
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("a subjectless call is an immediate no-op: no project read, no gate IO", async () => {
    const findProject: jest.SpyInstance = jest.spyOn(
      ProjectService,
      "findOneById",
    );

    await FixFromIncidentTaskTrigger.autoEnqueueFromConfidentInvestigation({
      projectId,
    });

    expect(findProject).not.toHaveBeenCalled();
    expect(getBudgetStatus).not.toHaveBeenCalled();
    expect(hasRepository).not.toHaveBeenCalled();
    expect(findNonTerminalRun).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  test("a not-opted-in project (default) skips cheaply: BEFORE the budget, repo and dedupe queries", async () => {
    jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue(fakeProject({ enableAutomaticCodeFixes: false }));

    await FixFromIncidentTaskTrigger.autoEnqueueFromConfidentInvestigation({
      projectId,
      incidentId,
    });

    expect(getBudgetStatus).not.toHaveBeenCalled();
    expect(hasRepository).not.toHaveBeenCalled();
    expect(findNonTerminalRun).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  test("over the daily fix-run budget: a quiet SKIP — nothing enqueued, nothing thrown into the investigation", async () => {
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue(fakeProject());
    getBudgetStatus.mockResolvedValue({
      allowed: false,
      limit: 25,
      paused: false,
      runsToday: 25,
    });

    await expect(
      FixFromIncidentTaskTrigger.autoEnqueueFromConfidentInvestigation({
        projectId,
        incidentId,
      }),
    ).resolves.toBeUndefined();

    // Skipped before the repo/dedupe queries, and no run was enqueued.
    expect(hasRepository).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  test("dedupe: a live FixFromIncident run for the same subject blocks the automatic enqueue", async () => {
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue(fakeProject());
    findNonTerminalRun.mockResolvedValue(fakeRun());

    await FixFromIncidentTaskTrigger.autoEnqueueFromConfidentInvestigation({
      projectId,
      incidentId,
    });

    // The dedupe guard queries per (subject, FixFromIncident).
    expect(findNonTerminalRun).toHaveBeenCalledWith(
      expect.objectContaining({
        taskType: CodeFixTaskType.FixFromIncident,
        incidentId,
      }),
    );
    expect(enqueue).not.toHaveBeenCalled();
  });

  test("happy path (incident): enqueues a FixFromIncident run for the incident with NO user attribution", async () => {
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue(fakeProject());

    await FixFromIncidentTaskTrigger.autoEnqueueFromConfidentInvestigation({
      projectId,
      incidentId,
    });

    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId,
        taskType: CodeFixTaskType.FixFromIncident,
        incidentId,
      }),
    );

    // System-authored: the automatic trigger must never attribute a user.
    expect(enqueue.mock.calls[0]![0]).not.toHaveProperty("userId");
  });

  test("happy path (alert): the enqueue carries the alert subject", async () => {
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue(fakeProject());

    await FixFromIncidentTaskTrigger.autoEnqueueFromConfidentInvestigation({
      projectId,
      alertId,
    });

    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        taskType: CodeFixTaskType.FixFromIncident,
        alertId,
      }),
    );
    expect(enqueue.mock.calls[0]![0]).not.toHaveProperty("userId");
  });

  test("never throws — a failed enqueue must not fail the investigation's postAnalysis", async () => {
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue(fakeProject());
    enqueue.mockRejectedValue(new Error("database is down"));

    await expect(
      FixFromIncidentTaskTrigger.autoEnqueueFromConfidentInvestigation({
        projectId,
        incidentId,
      }),
    ).resolves.toBeUndefined();
  });
});
