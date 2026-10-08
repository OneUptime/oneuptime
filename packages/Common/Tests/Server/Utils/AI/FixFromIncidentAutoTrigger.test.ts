import FixFromIncidentTaskTrigger, {
  AutoFixTaskGateDecision,
} from "../../../../Server/Utils/AI/SRE/FixFromIncidentTaskTrigger";
import SubjectCodeFixRun from "../../../../Server/Utils/AI/SRE/SubjectCodeFixRun";
import FixRunBudget from "../../../../Server/Utils/AI/CodeFix/FixRunBudget";
import ProjectService from "../../../../Server/Services/ProjectService";
import AIRunService from "../../../../Server/Services/AIRunService";
import Semaphore from "../../../../Server/Infrastructure/Semaphore";
import {
  getInvestigationSubjectLockKey,
  INVESTIGATION_SUBJECT_LOCK_NAMESPACE,
} from "../../../../Server/Utils/AI/SRE/InvestigationSubjectLock";
import Project from "../../../../Models/DatabaseModels/Project";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import CodeFixTaskType from "../../../../Types/AI/CodeFixTaskType";
import AIRunStatus from "../../../../Types/AI/AIRunStatus";
import AIRunCodeFixRecommendation from "../../../../Types/AI/AIRunCodeFixRecommendation";
import ObjectID from "../../../../Types/ObjectID";
import { describe, expect, test, afterEach, beforeEach } from "@jest/globals";

/*
 * The AUTOMATIC form of the FixFromIncident trigger: a durably Recommended
 * investigation (per the structured G6 signal) enqueues a fix-PR CodeFix
 * run with no human click — but ONLY for projects with the setting on for
 * the investigation's incident or alert lane AND that lane's fixing switch
 * on ("Fix new incidents automatically" or alerts): the pull request is
 * part of fixing (Types/AI/AutomaticFixSwitches). All four columns default
 * FALSE, and new projects start with them off. Only
 * when a GitHub-App repo exists to open the PR against, at most one
 * non-terminal run per subject, and inside the daily fix-run budget. It
 * runs as a post-recommendation follow-up, so it must NEVER throw,
 * and the run stays system-authored (no userId). Unlike its
 * human-triggered sibling (createFixTaskFromInvestigation, tested in
 * Tests/Server/Services/FixFromIncidentTaskTrigger.test.ts), every failed
 * gate is a quiet skip, never a thrown message.
 */

const projectId: ObjectID = ObjectID.generate();
const incidentId: ObjectID = ObjectID.generate();
const alertId: ObjectID = ObjectID.generate();
const investigationRunId: ObjectID = ObjectID.generate();
const analysisMarkdown: string = "## Frozen automatic investigation report";
const enqueueSubjectCodeFixRun: typeof SubjectCodeFixRun.enqueueSubjectCodeFixRun =
  SubjectCodeFixRun.enqueueSubjectCodeFixRun.bind(SubjectCodeFixRun);

function fakeProject(data?: {
  enableAi?: boolean;
  enableAutomaticIncidentRemediation?: boolean;
  enableAutomaticAlertRemediation?: boolean;
  enableAutomaticIncidentCodeFixes?: boolean;
  enableAutomaticAlertCodeFixes?: boolean;
}): Project {
  return {
    id: projectId,
    enableAi: data?.enableAi ?? true,
    // Fixing on: the pull requests are part of it.
    enableAutomaticIncidentRemediation:
      data?.enableAutomaticIncidentRemediation ?? true,
    enableAutomaticAlertRemediation:
      data?.enableAutomaticAlertRemediation ?? true,
    enableAutomaticIncidentCodeFixes:
      data?.enableAutomaticIncidentCodeFixes ?? true,
    enableAutomaticAlertCodeFixes: data?.enableAutomaticAlertCodeFixes ?? true,
  } as unknown as Project;
}

function fakeRun(): AIRun {
  return { id: ObjectID.generate() } as unknown as AIRun;
}

function persistedRecommendedInvestigation(
  overrides: Partial<AIRun> = {},
): AIRun {
  return {
    id: investigationRunId,
    status: AIRunStatus.Completed,
    codeFixRecommendation: AIRunCodeFixRecommendation.Recommended,
    taskContext: {
      sourceInvestigationRunId: investigationRunId.toString(),
      sourceInvestigationAnalysisMarkdown: analysisMarkdown,
    },
    ...overrides,
  } as unknown as AIRun;
}

describe("FixFromIncidentTaskTrigger.shouldAutoEnqueueFixTask", () => {
  test("does not enqueue when the project is missing", () => {
    const decision: AutoFixTaskGateDecision =
      FixFromIncidentTaskTrigger.shouldAutoEnqueueFixTask({
        project: null,
        incidentId,
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
        incidentId,
        hasConnectedRepository: true,
        existingRun: null,
      });

    expect(decision.enqueue).toBe(false);
    expect(decision.reason).toMatch(/disabled/);
  });

  test("opt-in is strict: an unset flag (legacy row) never enqueues — the column default is FALSE", () => {
    const project: Project = {
      id: projectId,
      enableAi: true,
      enableAutomaticIncidentRemediation: true,
      // enableAutomaticIncidentCodeFixes deliberately absent.
    } as unknown as Project;

    const decision: AutoFixTaskGateDecision =
      FixFromIncidentTaskTrigger.shouldAutoEnqueueFixTask({
        project,
        incidentId,
        hasConnectedRepository: true,
        existingRun: null,
      });

    expect(decision.enqueue).toBe(false);
    expect(decision.reason).toMatch(/not opted in/);
  });

  test("the fixing switch is strict too: unset (a row read without it) never enqueues", () => {
    const project: Project = {
      id: projectId,
      enableAi: true,
      // enableAutomaticIncidentRemediation deliberately absent.
      enableAutomaticIncidentCodeFixes: true,
    } as unknown as Project;

    const decision: AutoFixTaskGateDecision =
      FixFromIncidentTaskTrigger.shouldAutoEnqueueFixTask({
        project,
        incidentId,
        hasConnectedRepository: true,
        existingRun: null,
      });

    expect(decision.enqueue).toBe(false);
    expect(decision.reason).toMatch(/fixing new incidents automatically off/);
  });

  /*
   * "It should actually be a child of 'Fix new alerts automatically'" - the
   * maintainer. With the lane's fixing switch off, its fix pull request
   * switch does nothing, however it is set.
   */
  test.each([
    ["incident", { incidentId }, { enableAutomaticIncidentRemediation: false }],
    ["alert", { alertId }, { enableAutomaticAlertRemediation: false }],
  ] as Array<
    [
      string,
      { incidentId?: ObjectID; alertId?: ObjectID },
      Record<string, boolean>,
    ]
  >)(
    "%s: fixing off means no automatic fix pull request, though its own switch is on",
    (
      label: string,
      subject: { incidentId?: ObjectID; alertId?: ObjectID },
      fixOff: Record<string, boolean>,
    ) => {
      const decision: AutoFixTaskGateDecision =
        FixFromIncidentTaskTrigger.shouldAutoEnqueueFixTask({
          project: fakeProject(fixOff),
          ...subject,
          hasConnectedRepository: true,
          existingRun: null,
        });

      expect(decision.enqueue).toBe(false);
      expect(decision.reason).toBe(
        `project has fixing new ${label}s automatically off, and its fix pull requests open only while it is on`,
      );
    },
  );

  test("fixing off wins over a missing repository and a live run: the first thing it says is fixing", () => {
    const decision: AutoFixTaskGateDecision =
      FixFromIncidentTaskTrigger.shouldAutoEnqueueFixTask({
        project: fakeProject({
          enableAutomaticIncidentRemediation: false,
          enableAutomaticIncidentCodeFixes: false,
        }),
        incidentId,
        hasConnectedRepository: false,
        existingRun: fakeRun(),
      });

    expect(decision.enqueue).toBe(false);
    expect(decision.reason).toMatch(/fixing new incidents automatically off/);
  });

  test("one lane's fixing does not open the other lane's pull requests", () => {
    const project: Project = fakeProject({
      enableAutomaticIncidentRemediation: true,
      enableAutomaticAlertRemediation: false,
    });

    expect(
      FixFromIncidentTaskTrigger.shouldAutoEnqueueFixTask({
        project,
        incidentId,
        hasConnectedRepository: true,
        existingRun: null,
      }).enqueue,
    ).toBe(true);
    expect(
      FixFromIncidentTaskTrigger.shouldAutoEnqueueFixTask({
        project,
        alertId,
        hasConnectedRepository: true,
        existingRun: null,
      }).enqueue,
    ).toBe(false);
  });

  test("an explicit false flag never enqueues", () => {
    const decision: AutoFixTaskGateDecision =
      FixFromIncidentTaskTrigger.shouldAutoEnqueueFixTask({
        project: fakeProject({ enableAutomaticIncidentCodeFixes: false }),
        incidentId,
        hasConnectedRepository: true,
        existingRun: null,
      });

    expect(decision.enqueue).toBe(false);
    expect(decision.reason).toMatch(/not opted in/);
  });

  test("incident and alert opt-ins are independent: incident enabled does not enable alerts", () => {
    const project: Project = fakeProject({
      enableAutomaticIncidentCodeFixes: true,
      enableAutomaticAlertCodeFixes: false,
    });

    expect(
      FixFromIncidentTaskTrigger.shouldAutoEnqueueFixTask({
        project,
        incidentId,
        hasConnectedRepository: true,
        existingRun: null,
      }).enqueue,
    ).toBe(true);
    expect(
      FixFromIncidentTaskTrigger.shouldAutoEnqueueFixTask({
        project,
        alertId,
        hasConnectedRepository: true,
        existingRun: null,
      }).enqueue,
    ).toBe(false);
  });

  test("incident and alert opt-ins are independent: alert enabled does not enable incidents", () => {
    const project: Project = fakeProject({
      enableAutomaticIncidentCodeFixes: false,
      enableAutomaticAlertCodeFixes: true,
    });

    expect(
      FixFromIncidentTaskTrigger.shouldAutoEnqueueFixTask({
        project,
        incidentId,
        hasConnectedRepository: true,
        existingRun: null,
      }).enqueue,
    ).toBe(false);
    expect(
      FixFromIncidentTaskTrigger.shouldAutoEnqueueFixTask({
        project,
        alertId,
        hasConnectedRepository: true,
        existingRun: null,
      }).enqueue,
    ).toBe(true);
  });

  test("a subjectless gate decision is rejected instead of borrowing either opt-in", () => {
    const decision: AutoFixTaskGateDecision =
      FixFromIncidentTaskTrigger.shouldAutoEnqueueFixTask({
        project: fakeProject(),
        hasConnectedRepository: true,
        existingRun: null,
      });

    expect(decision.enqueue).toBe(false);
    expect(decision.reason).toMatch(/subject/);
  });

  test("a gate carrying both subject types is rejected instead of borrowing the incident opt-in", () => {
    const decision: AutoFixTaskGateDecision =
      FixFromIncidentTaskTrigger.shouldAutoEnqueueFixTask({
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
    const decision: AutoFixTaskGateDecision =
      FixFromIncidentTaskTrigger.shouldAutoEnqueueFixTask({
        project: fakeProject(),
        incidentId,
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
        incidentId,
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
        incidentId,
        hasConnectedRepository: true,
        existingRun: null,
      });

    expect(decision.enqueue).toBe(true);
    expect(decision.reason).toMatch(/passed/);
  });
});

describe("FixFromIncidentTaskTrigger.autoEnqueueFromRecommendedInvestigation", () => {
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
    jest.spyOn(FixRunBudget, "assertWithinBudget").mockResolvedValue();
    jest.spyOn(Semaphore, "lock").mockResolvedValue({} as never);
    jest.spyOn(Semaphore, "release").mockResolvedValue();
    jest
      .spyOn(AIRunService, "findOneBy")
      .mockResolvedValue(persistedRecommendedInvestigation());
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("a subjectless call is an immediate no-op: no project read, no gate IO", async () => {
    const findProject: jest.SpyInstance = jest.spyOn(
      ProjectService,
      "findOneById",
    );

    await FixFromIncidentTaskTrigger.autoEnqueueFromRecommendedInvestigation({
      projectId,
      investigationRunId,
      analysisMarkdown,
    });

    expect(findProject).not.toHaveBeenCalled();
    expect(getBudgetStatus).not.toHaveBeenCalled();
    expect(hasRepository).not.toHaveBeenCalled();
    expect(findNonTerminalRun).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  test("a call carrying both subject types is an immediate no-op", async () => {
    const findProject: jest.SpyInstance = jest.spyOn(
      ProjectService,
      "findOneById",
    );

    await FixFromIncidentTaskTrigger.autoEnqueueFromRecommendedInvestigation({
      projectId,
      investigationRunId,
      analysisMarkdown,
      incidentId,
      alertId,
    });

    expect(findProject).not.toHaveBeenCalled();
    expect(getBudgetStatus).not.toHaveBeenCalled();
    expect(hasRepository).not.toHaveBeenCalled();
    expect(findNonTerminalRun).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  test.each([
    ["missing source run id", undefined, analysisMarkdown],
    ["blank analysis", investigationRunId, "   "],
  ] as Array<[string, ObjectID | undefined, string]>)(
    "%s fails closed before project or gate IO",
    async (
      _label: string,
      sourceRunId: ObjectID | undefined,
      sourceAnalysis: string,
    ) => {
      const findProject: jest.SpyInstance = jest.spyOn(
        ProjectService,
        "findOneById",
      );

      await FixFromIncidentTaskTrigger.autoEnqueueFromRecommendedInvestigation({
        projectId,
        investigationRunId: sourceRunId as ObjectID,
        analysisMarkdown: sourceAnalysis,
        incidentId,
      });

      expect(findProject).not.toHaveBeenCalled();
      expect(getBudgetStatus).not.toHaveBeenCalled();
      expect(hasRepository).not.toHaveBeenCalled();
      expect(findNonTerminalRun).not.toHaveBeenCalled();
      expect(enqueue).not.toHaveBeenCalled();
    },
  );

  test("a project with the setting off skips cheaply: BEFORE the budget, repo and dedupe queries", async () => {
    jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue(
        fakeProject({ enableAutomaticIncidentCodeFixes: false }),
      );

    await FixFromIncidentTaskTrigger.autoEnqueueFromRecommendedInvestigation({
      projectId,
      investigationRunId,
      analysisMarkdown,
      incidentId,
    });

    expect(getBudgetStatus).not.toHaveBeenCalled();
    expect(hasRepository).not.toHaveBeenCalled();
    expect(findNonTerminalRun).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  test.each([
    ["incident", { incidentId }, { enableAutomaticIncidentRemediation: false }],
    ["alert", { alertId }, { enableAutomaticAlertRemediation: false }],
  ] as Array<
    [
      string,
      { incidentId?: ObjectID; alertId?: ObjectID },
      Record<string, boolean>,
    ]
  >)(
    "%s: a project with fixing off skips cheaply — no budget, repository, dedupe or investigation read, nothing enqueued",
    async (
      _label: string,
      subject: { incidentId?: ObjectID; alertId?: ObjectID },
      fixOff: Record<string, boolean>,
    ) => {
      jest
        .spyOn(ProjectService, "findOneById")
        .mockResolvedValue(fakeProject(fixOff));
      (AIRunService.findOneBy as unknown as jest.Mock).mockClear();

      await FixFromIncidentTaskTrigger.autoEnqueueFromRecommendedInvestigation(
        {
          projectId,
          investigationRunId,
          analysisMarkdown,
          ...subject,
        },
      );

      expect(AIRunService.findOneBy).not.toHaveBeenCalled();
      expect(getBudgetStatus).not.toHaveBeenCalled();
      expect(hasRepository).not.toHaveBeenCalled();
      expect(findNonTerminalRun).not.toHaveBeenCalled();
      expect(enqueue).not.toHaveBeenCalled();
    },
  );

  test("the alert opt-in cannot enable an automatic incident code fix", async () => {
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue(
      fakeProject({
        enableAutomaticIncidentCodeFixes: false,
        enableAutomaticAlertCodeFixes: true,
      }),
    );

    await FixFromIncidentTaskTrigger.autoEnqueueFromRecommendedInvestigation({
      projectId,
      investigationRunId,
      analysisMarkdown,
      incidentId,
    });

    expect(getBudgetStatus).not.toHaveBeenCalled();
    expect(hasRepository).not.toHaveBeenCalled();
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
      FixFromIncidentTaskTrigger.autoEnqueueFromRecommendedInvestigation({
        projectId,
        investigationRunId,
        analysisMarkdown,
        incidentId,
      }),
    ).resolves.toBeUndefined();

    // Skipped before the repo/dedupe queries, and no run was enqueued.
    expect(hasRepository).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
    expect(getBudgetStatus).toHaveBeenCalledWith(projectId, {
      incidentId,
      alertId: undefined,
    });
  });

  test.each([
    ["a newer investigation", { id: ObjectID.generate() }],
    [
      "a still-Pending source",
      { codeFixRecommendation: AIRunCodeFixRecommendation.Pending },
    ],
    [
      "a mismatched durable snapshot",
      {
        taskContext: {
          sourceInvestigationRunId: investigationRunId.toString(),
          sourceInvestigationAnalysisMarkdown: "different analysis",
        },
      },
    ],
  ] as Array<[string, Partial<AIRun>]>)(
    "%s fails closed before budget, repository, dedupe, and enqueue IO",
    async (_label: string, overrides: Partial<AIRun>) => {
      jest
        .spyOn(ProjectService, "findOneById")
        .mockResolvedValue(fakeProject());
      (AIRunService.findOneBy as unknown as jest.Mock).mockResolvedValue(
        persistedRecommendedInvestigation(overrides),
      );

      await FixFromIncidentTaskTrigger.autoEnqueueFromRecommendedInvestigation({
        projectId,
        investigationRunId,
        analysisMarkdown,
        incidentId,
      });

      expect(getBudgetStatus).not.toHaveBeenCalled();
      expect(hasRepository).not.toHaveBeenCalled();
      expect(findNonTerminalRun).not.toHaveBeenCalled();
      expect(enqueue).not.toHaveBeenCalled();
    },
  );

  test("dedupe: a live FixFromIncident run for the same subject blocks the automatic enqueue", async () => {
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue(fakeProject());
    findNonTerminalRun.mockResolvedValue(fakeRun());

    await FixFromIncidentTaskTrigger.autoEnqueueFromRecommendedInvestigation({
      projectId,
      investigationRunId,
      analysisMarkdown,
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
    const findProject: jest.SpyInstance = jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue(fakeProject());

    await FixFromIncidentTaskTrigger.autoEnqueueFromRecommendedInvestigation({
      projectId,
      investigationRunId,
      analysisMarkdown,
      incidentId,
    });

    // Enable AI, the incident fixing switch and its code-fix switch.
    expect(findProject).toHaveBeenCalledWith(
      expect.objectContaining({
        select: {
          enableAi: true,
          enableAutomaticIncidentRemediation: true,
          enableAutomaticIncidentCodeFixes: true,
        },
      }),
    );
    expect(getBudgetStatus).toHaveBeenCalledWith(projectId, {
      incidentId,
      alertId: undefined,
    });

    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId,
        taskType: CodeFixTaskType.FixFromIncident,
        incidentId,
        taskContext: {
          sourceInvestigationRunId: investigationRunId.toString(),
          sourceInvestigationAnalysisMarkdown: analysisMarkdown,
        },
      }),
    );

    // System-authored: the automatic trigger must never attribute a user.
    expect(enqueue.mock.calls[0]![0]).not.toHaveProperty("userId");
  });

  test("happy path (alert): the enqueue carries the alert subject", async () => {
    const findProject: jest.SpyInstance = jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue(fakeProject());

    await FixFromIncidentTaskTrigger.autoEnqueueFromRecommendedInvestigation({
      projectId,
      investigationRunId,
      analysisMarkdown,
      alertId,
    });

    expect(findProject).toHaveBeenCalledWith(
      expect.objectContaining({
        select: {
          enableAi: true,
          enableAutomaticAlertRemediation: true,
          enableAutomaticAlertCodeFixes: true,
        },
      }),
    );
    expect(getBudgetStatus).toHaveBeenCalledWith(projectId, {
      incidentId: undefined,
      alertId,
    });

    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        taskType: CodeFixTaskType.FixFromIncident,
        alertId,
        taskContext: {
          sourceInvestigationRunId: investigationRunId.toString(),
          sourceInvestigationAnalysisMarkdown: analysisMarkdown,
        },
      }),
    );
    expect(enqueue.mock.calls[0]![0]).not.toHaveProperty("userId");
  });

  test("a newer Investigation appearing before the locked automatic insert is revalidated and blocks creation", async () => {
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue(fakeProject());
    const newerRunId: ObjectID = ObjectID.generate();
    (AIRunService.findOneBy as unknown as jest.Mock)
      .mockReset()
      .mockResolvedValueOnce(persistedRecommendedInvestigation())
      .mockResolvedValueOnce(
        persistedRecommendedInvestigation({
          id: newerRunId,
          codeFixRecommendation: AIRunCodeFixRecommendation.NotRecommended,
          taskContext: {
            sourceInvestigationRunId: newerRunId.toString(),
            sourceInvestigationAnalysisMarkdown: "newer operational analysis",
          },
        }),
      );
    enqueue.mockImplementation(enqueueSubjectCodeFixRun);
    const create: jest.SpyInstance = jest.spyOn(AIRunService, "create");

    await expect(
      FixFromIncidentTaskTrigger.autoEnqueueFromRecommendedInvestigation({
        projectId,
        investigationRunId,
        analysisMarkdown,
        incidentId,
      }),
    ).resolves.toBeUndefined();

    expect(Semaphore.lock).toHaveBeenCalledWith(
      expect.objectContaining({
        key: getInvestigationSubjectLockKey({ projectId, incidentId }),
        namespace: INVESTIGATION_SUBJECT_LOCK_NAMESPACE,
      }),
    );
    expect(Semaphore.release).toHaveBeenCalledTimes(1);
    expect(create).not.toHaveBeenCalled();
  });

  test("never throws — a failed enqueue must not fail the completed investigation", async () => {
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue(fakeProject());
    enqueue.mockRejectedValue(new Error("database is down"));

    await expect(
      FixFromIncidentTaskTrigger.autoEnqueueFromRecommendedInvestigation({
        projectId,
        investigationRunId,
        analysisMarkdown,
        incidentId,
      }),
    ).resolves.toBeUndefined();
  });
});
