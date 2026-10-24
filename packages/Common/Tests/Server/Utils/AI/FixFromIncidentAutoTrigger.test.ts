import FixFromIncidentTaskTrigger, {
  AutoFixTaskGateDecision,
} from "../../../../Server/Utils/AI/SRE/FixFromIncidentTaskTrigger";
import SubjectCodeFixRun from "../../../../Server/Utils/AI/SRE/SubjectCodeFixRun";
import RemediationRulePullRequests from "../../../../Server/Utils/AI/SRE/RemediationRulePullRequests";
import FixRunBudget from "../../../../Server/Utils/AI/CodeFix/FixRunBudget";
import CodeFixRunRepository from "../../../../Server/Utils/AI/CodeFix/CodeFixRunRepository";
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
import {
  AutomaticFixPullRequestRules,
  RemediationRulePullRequestFacts,
} from "../../../../Types/AI/AutomaticFixPullRequests";
import { EVERY_CODE_REPOSITORY } from "../../../../Types/CodeRepository/CodeRepositoryAllowance";
import ObjectID from "../../../../Types/ObjectID";
import { describe, expect, test, afterEach, beforeEach } from "@jest/globals";

/*
 * The AUTOMATIC form of the FixFromIncident trigger: a durably Recommended
 * investigation (per the structured G6 signal) enqueues a fix-PR CodeFix
 * run with no human click - but only while the investigation's lane has
 * "Fix new incidents automatically" (or alerts) on, and the lane's auto
 * remediation rules let it: with none, every investigation that qualifies
 * opens one; with some, only one a rule with "Fix pull requests" on (its
 * default) matches, and only in the repositories those rules name
 * (Types/AI/AutomaticFixPullRequests). The maintainer: "Both of these
 * toggles should be inside of Remediation Rule, inside of More, and they
 * should be checked by default ... If there are no rules, by the way, this
 * should happen by default."
 *
 * Only when a GitHub-App repo the rules allow exists to open the PR
 * against, at most one non-terminal run per subject, and inside the daily
 * fix-run budget. It runs as a post-recommendation follow-up, so it must
 * NEVER throw, and the run stays system-authored (no userId). Unlike its
 * human-triggered sibling (createFixTaskFromInvestigation, tested in
 * Tests/Server/Services/FixFromIncidentTaskTrigger.test.ts), every failed
 * gate is a quiet skip, never a thrown message.
 */

const projectId: ObjectID = ObjectID.generate();
const incidentId: ObjectID = ObjectID.generate();
const alertId: ObjectID = ObjectID.generate();
const investigationRunId: ObjectID = ObjectID.generate();
const analysisMarkdown: string = "## Frozen automatic investigation report";
const API_REPOSITORY: string = "c1111111-1111-4111-8111-111111111111";
const WEB_REPOSITORY: string = "c2222222-2222-4222-8222-222222222222";
const enqueueSubjectCodeFixRun: typeof SubjectCodeFixRun.enqueueSubjectCodeFixRun =
  SubjectCodeFixRun.enqueueSubjectCodeFixRun.bind(SubjectCodeFixRun);

function fakeProject(data?: {
  enableAi?: boolean;
  enableAutomaticIncidentRemediation?: boolean;
  enableAutomaticAlertRemediation?: boolean;
}): Project {
  return {
    id: projectId,
    enableAi: data?.enableAi ?? true,
    // Fixing on: the pull requests are part of it.
    enableAutomaticIncidentRemediation:
      data?.enableAutomaticIncidentRemediation ?? true,
    enableAutomaticAlertRemediation:
      data?.enableAutomaticAlertRemediation ?? true,
  } as unknown as Project;
}

function fakeRun(): AIRun {
  return { id: ObjectID.generate() } as unknown as AIRun;
}

const NO_RULES: AutomaticFixPullRequestRules = {
  rulesSetUp: false,
  matchingRules: [],
};

function matchingRules(
  ...rules: Array<Partial<RemediationRulePullRequestFacts>>
): AutomaticFixPullRequestRules {
  return {
    rulesSetUp: true,
    matchingRules: rules.map(
      (
        facts: Partial<RemediationRulePullRequestFacts>,
      ): RemediationRulePullRequestFacts => {
        return {
          openCodeFixPullRequests: true,
          openTelemetryPullRequests: true,
          ...facts,
        };
      },
    ),
  };
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
        rules: NO_RULES,
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
        rules: NO_RULES,
        hasConnectedRepository: true,
        existingRun: null,
      });

    expect(decision.enqueue).toBe(false);
    expect(decision.reason).toMatch(/disabled/);
  });

  test("the fixing switch is strict: unset (a row read without it) never enqueues", () => {
    const project: Project = {
      id: projectId,
      enableAi: true,
      // enableAutomaticIncidentRemediation deliberately absent.
    } as unknown as Project;

    const decision: AutoFixTaskGateDecision =
      FixFromIncidentTaskTrigger.shouldAutoEnqueueFixTask({
        project,
        incidentId,
        rules: NO_RULES,
        hasConnectedRepository: true,
        existingRun: null,
      });

    expect(decision.enqueue).toBe(false);
    expect(decision.reason).toMatch(/fixing new incidents automatically off/);
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
    "%s: fixing off means no automatic fix pull request, whatever the rules say",
    (
      label: string,
      subject: { incidentId?: ObjectID; alertId?: ObjectID },
      fixOff: Record<string, boolean>,
    ) => {
      for (const rules of [NO_RULES, matchingRules({})]) {
        const decision: AutoFixTaskGateDecision =
          FixFromIncidentTaskTrigger.shouldAutoEnqueueFixTask({
            project: fakeProject(fixOff),
            ...subject,
            rules,
            hasConnectedRepository: true,
            existingRun: null,
          });

        expect(decision.enqueue).toBe(false);
        expect(decision.reason).toBe(
          `project has fixing new ${label}s automatically off, and its fix pull requests open only while it is on`,
        );
      }
    },
  );

  test("fixing off wins over a missing repository and a live run: the first thing it says is fixing", () => {
    const decision: AutoFixTaskGateDecision =
      FixFromIncidentTaskTrigger.shouldAutoEnqueueFixTask({
        project: fakeProject({ enableAutomaticIncidentRemediation: false }),
        incidentId,
        rules: matchingRules({ openCodeFixPullRequests: false }),
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
        rules: NO_RULES,
        hasConnectedRepository: true,
        existingRun: null,
      }).enqueue,
    ).toBe(true);
    expect(
      FixFromIncidentTaskTrigger.shouldAutoEnqueueFixTask({
        project,
        alertId,
        rules: NO_RULES,
        hasConnectedRepository: true,
        existingRun: null,
      }).enqueue,
    ).toBe(false);
  });

  test("with no AI rule, it enqueues - in any connected repository", () => {
    const decision: AutoFixTaskGateDecision =
      FixFromIncidentTaskTrigger.shouldAutoEnqueueFixTask({
        project: fakeProject(),
        incidentId,
        rules: NO_RULES,
        hasConnectedRepository: true,
        existingRun: null,
      });

    expect(decision.enqueue).toBe(true);
    expect(decision.repositories).toEqual(EVERY_CODE_REPOSITORY);
  });

  test("rules not read yet ask only the project's switches", () => {
    expect(
      FixFromIncidentTaskTrigger.shouldAutoEnqueueFixTask({
        project: fakeProject(),
        incidentId,
        hasConnectedRepository: true,
        existingRun: null,
      }).enqueue,
    ).toBe(true);
  });

  test("rules that could not be read: nothing enqueued", () => {
    const decision: AutoFixTaskGateDecision =
      FixFromIncidentTaskTrigger.shouldAutoEnqueueFixTask({
        project: fakeProject(),
        incidentId,
        rules: null,
        hasConnectedRepository: true,
        existingRun: null,
      });

    expect(decision.enqueue).toBe(false);
    expect(decision.reason).toContain("could not be read");
  });

  test("rules set up and none matching the incident: it is not fixed, so no pull request", () => {
    const decision: AutoFixTaskGateDecision =
      FixFromIncidentTaskTrigger.shouldAutoEnqueueFixTask({
        project: fakeProject(),
        incidentId,
        rules: { rulesSetUp: true, matchingRules: [] },
        hasConnectedRepository: true,
        existingRun: null,
      });

    expect(decision.enqueue).toBe(false);
    expect(decision.reason).toBe(
      "no AI rule that fixes matches this incident, so it is not fixed",
    );
  });

  test("matching rules with fix pull requests off: nothing, though telemetry pull requests are on", () => {
    const decision: AutoFixTaskGateDecision =
      FixFromIncidentTaskTrigger.shouldAutoEnqueueFixTask({
        project: fakeProject(),
        alertId,
        rules: matchingRules({
          openCodeFixPullRequests: false,
          openTelemetryPullRequests: true,
        }),
        hasConnectedRepository: true,
        existingRun: null,
      });

    expect(decision.enqueue).toBe(false);
    expect(decision.reason).toBe(
      "the AI rules that match this alert have fix pull requests off",
    );
  });

  test("a matching rule that names repositories: it enqueues for those only", () => {
    const decision: AutoFixTaskGateDecision =
      FixFromIncidentTaskTrigger.shouldAutoEnqueueFixTask({
        project: fakeProject(),
        incidentId,
        rules: matchingRules(
          { codeRepositories: [{ _id: API_REPOSITORY }] },
          {
            openCodeFixPullRequests: false,
            codeRepositories: [{ _id: WEB_REPOSITORY }],
          },
        ),
        hasConnectedRepository: true,
        existingRun: null,
      });

    expect(decision.enqueue).toBe(true);
    expect(decision.repositories).toEqual({
      isEveryRepository: false,
      repositoryIds: [API_REPOSITORY],
    });
  });

  test("a subjectless gate decision is rejected instead of borrowing either lane", () => {
    const decision: AutoFixTaskGateDecision =
      FixFromIncidentTaskTrigger.shouldAutoEnqueueFixTask({
        project: fakeProject(),
        rules: NO_RULES,
        hasConnectedRepository: true,
        existingRun: null,
      });

    expect(decision.enqueue).toBe(false);
    expect(decision.reason).toMatch(/subject/);
  });

  test("a gate carrying both subject types is rejected instead of borrowing the incident lane", () => {
    const decision: AutoFixTaskGateDecision =
      FixFromIncidentTaskTrigger.shouldAutoEnqueueFixTask({
        project: fakeProject(),
        incidentId,
        alertId,
        rules: NO_RULES,
        hasConnectedRepository: true,
        existingRun: null,
      });

    expect(decision.enqueue).toBe(false);
    expect(decision.reason).toMatch(/exactly one/);
  });

  test("does not enqueue without a connected repository the rules allow", () => {
    const decision: AutoFixTaskGateDecision =
      FixFromIncidentTaskTrigger.shouldAutoEnqueueFixTask({
        project: fakeProject(),
        incidentId,
        rules: NO_RULES,
        hasConnectedRepository: false,
        existingRun: null,
      });

    expect(decision.enqueue).toBe(false);
    expect(decision.reason).toBe(
      "project has no connected repository the AI rules allow",
    );
  });

  test("dedupe: an existing non-terminal run for the subject blocks a second one", () => {
    const decision: AutoFixTaskGateDecision =
      FixFromIncidentTaskTrigger.shouldAutoEnqueueFixTask({
        project: fakeProject(),
        incidentId,
        rules: NO_RULES,
        hasConnectedRepository: true,
        existingRun: fakeRun(),
      });

    expect(decision.enqueue).toBe(false);
    expect(decision.reason).toMatch(/already exists/);
  });

  test("enqueues when fixing is on, the rules allow it, a repository exists, and no run is live", () => {
    const decision: AutoFixTaskGateDecision =
      FixFromIncidentTaskTrigger.shouldAutoEnqueueFixTask({
        project: fakeProject(),
        incidentId,
        rules: matchingRules({}),
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
  let getRules: jest.SpyInstance;

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
      .spyOn(SubjectCodeFixRun, "hasConnectedRepository")
      .mockResolvedValue(true);
    findNonTerminalRun = jest
      .spyOn(SubjectCodeFixRun, "findNonTerminalRunForSubject")
      .mockResolvedValue(null);
    enqueue = jest
      .spyOn(SubjectCodeFixRun, "enqueueSubjectCodeFixRun")
      .mockResolvedValue(fakeRun());
    // No AI rule by default: every subject's PR may open.
    getRules = jest
      .spyOn(RemediationRulePullRequests, "getRulesForSignal")
      .mockResolvedValue(NO_RULES);
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
    expect(getRules).not.toHaveBeenCalled();
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
    expect(getRules).not.toHaveBeenCalled();
    expect(getBudgetStatus).not.toHaveBeenCalled();
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
      expect(getRules).not.toHaveBeenCalled();
      expect(getBudgetStatus).not.toHaveBeenCalled();
      expect(hasRepository).not.toHaveBeenCalled();
      expect(findNonTerminalRun).not.toHaveBeenCalled();
      expect(enqueue).not.toHaveBeenCalled();
    },
  );

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
    "%s: a project with fixing off skips cheaply — no rule, budget, repository, dedupe or investigation read, nothing enqueued",
    async (
      _label: string,
      subject: { incidentId?: ObjectID; alertId?: ObjectID },
      fixOff: Record<string, boolean>,
    ) => {
      jest
        .spyOn(ProjectService, "findOneById")
        .mockResolvedValue(fakeProject(fixOff));
      (AIRunService.findOneBy as unknown as jest.Mock).mockClear();

      await FixFromIncidentTaskTrigger.autoEnqueueFromRecommendedInvestigation({
        projectId,
        investigationRunId,
        analysisMarkdown,
        ...subject,
      });

      expect(AIRunService.findOneBy).not.toHaveBeenCalled();
      expect(getRules).not.toHaveBeenCalled();
      expect(getBudgetStatus).not.toHaveBeenCalled();
      expect(hasRepository).not.toHaveBeenCalled();
      expect(findNonTerminalRun).not.toHaveBeenCalled();
      expect(enqueue).not.toHaveBeenCalled();
    },
  );

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

    // Skipped before the rules, the repo and the dedupe queries.
    expect(getRules).not.toHaveBeenCalled();
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
    "%s fails closed before budget, rule, repository, dedupe, and enqueue IO",
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
      expect(getRules).not.toHaveBeenCalled();
      expect(hasRepository).not.toHaveBeenCalled();
      expect(findNonTerminalRun).not.toHaveBeenCalled();
      expect(enqueue).not.toHaveBeenCalled();
    },
  );

  test.each([
    ["rules that could not be read", null],
    ["rules none of which matches", { rulesSetUp: true, matchingRules: [] }],
    [
      "matching rules with fix pull requests off",
      matchingRules({ openCodeFixPullRequests: false }),
    ],
  ] as Array<[string, AutomaticFixPullRequestRules | null]>)(
    "%s: nothing enqueued, and no repository counted",
    async (_label: string, rules: AutomaticFixPullRequestRules | null) => {
      jest
        .spyOn(ProjectService, "findOneById")
        .mockResolvedValue(fakeProject());
      getRules.mockResolvedValue(rules);

      await FixFromIncidentTaskTrigger.autoEnqueueFromRecommendedInvestigation({
        projectId,
        investigationRunId,
        analysisMarkdown,
        incidentId,
      });

      expect(getRules).toHaveBeenCalledWith({
        projectId,
        incidentId,
        alertId: undefined,
      });
      expect(hasRepository).not.toHaveBeenCalled();
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

  test("no repository the rules allow is connected: nothing enqueued", async () => {
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue(fakeProject());
    getRules.mockResolvedValue(
      matchingRules({ codeRepositories: [{ _id: API_REPOSITORY }] }),
    );
    hasRepository.mockResolvedValue(false);

    await FixFromIncidentTaskTrigger.autoEnqueueFromRecommendedInvestigation({
      projectId,
      investigationRunId,
      analysisMarkdown,
      incidentId,
    });

    // The repositories counted are the ones the rules allow.
    expect(hasRepository).toHaveBeenCalledWith(projectId, {
      isEveryRepository: false,
      repositoryIds: [API_REPOSITORY],
    });
    expect(enqueue).not.toHaveBeenCalled();
  });

  test("happy path (incident, no rule): enqueues a FixFromIncident run in any repository, with NO user attribution", async () => {
    const findProject: jest.SpyInstance = jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue(fakeProject());

    await FixFromIncidentTaskTrigger.autoEnqueueFromRecommendedInvestigation({
      projectId,
      investigationRunId,
      analysisMarkdown,
      incidentId,
    });

    // Enable AI and the incident fixing switch - no pull request column.
    expect(findProject).toHaveBeenCalledWith(
      expect.objectContaining({
        select: {
          enableAi: true,
          enableAutomaticIncidentRemediation: true,
        },
      }),
    );
    expect(getBudgetStatus).toHaveBeenCalledWith(projectId, {
      incidentId,
      alertId: undefined,
    });
    expect(hasRepository).toHaveBeenCalledWith(
      projectId,
      EVERY_CODE_REPOSITORY,
    );

    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId,
        taskType: CodeFixTaskType.FixFromIncident,
        incidentId,
        // Every repository: the run names none.
        taskContext: {
          sourceInvestigationRunId: investigationRunId.toString(),
          sourceInvestigationAnalysisMarkdown: analysisMarkdown,
        },
      }),
    );

    // System-authored: the automatic trigger must never attribute a user.
    expect(enqueue.mock.calls[0]![0]).not.toHaveProperty("userId");
  });

  test("happy path (alert, a rule naming repositories): the run carries the alert and the rule's repositories", async () => {
    const findProject: jest.SpyInstance = jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue(fakeProject());
    getRules.mockResolvedValue(
      matchingRules({
        codeRepositories: [{ _id: API_REPOSITORY }, { _id: WEB_REPOSITORY }],
      }),
    );

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
        },
      }),
    );
    expect(getRules).toHaveBeenCalledWith({
      projectId,
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
          allowedCodeRepositoryIds: [API_REPOSITORY, WEB_REPOSITORY],
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

  test("never throws — a failed rule read or enqueue must not fail the completed investigation", async () => {
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

    getRules.mockRejectedValue(new Error("rules table is gone"));

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

/*
 * The fix pull request is written with the LLM provider the rules that
 * open it pick - the first of them by name that picks one - which the run
 * records (AIRun.llmProviderId) for its completions to use.
 */
describe("FixFromIncidentTaskTrigger and the LLM provider the rules pick", () => {
  const PICK: string = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
  const OTHER: string = "cccccccc-cccc-4ccc-8ccc-ccccccccccc2";

  beforeEach(() => {
    jest.spyOn(FixRunBudget, "getBudgetStatus").mockResolvedValue({
      allowed: true,
      limit: 25,
      paused: false,
      runsToday: 0,
    });
    jest
      .spyOn(SubjectCodeFixRun, "hasConnectedRepository")
      .mockResolvedValue(true);
    jest
      .spyOn(SubjectCodeFixRun, "findNonTerminalRunForSubject")
      .mockResolvedValue(null);
    jest.spyOn(FixRunBudget, "assertWithinBudget").mockResolvedValue();
    jest.spyOn(Semaphore, "lock").mockResolvedValue({} as never);
    jest.spyOn(Semaphore, "release").mockResolvedValue();
    jest
      .spyOn(AIRunService, "findOneBy")
      .mockResolvedValue(persistedRecommendedInvestigation());
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue(fakeProject());
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("the gate's decision carries the opening rules' pick, the first by name", () => {
    expect(
      FixFromIncidentTaskTrigger.shouldAutoEnqueueFixTask({
        project: fakeProject(),
        incidentId,
        rules: matchingRules(
          { name: "Zeta", llmProviderId: OTHER },
          { name: "Alpha", llmProviderId: PICK },
        ),
        hasConnectedRepository: true,
        existingRun: null,
      }),
    ).toMatchObject({ enqueue: true, llmProviderId: PICK });
  });

  test("a rule with fix pull requests off picks nothing for them", () => {
    expect(
      FixFromIncidentTaskTrigger.shouldAutoEnqueueFixTask({
        project: fakeProject(),
        incidentId,
        rules: matchingRules(
          { name: "A", llmProviderId: OTHER, openCodeFixPullRequests: false },
          { name: "B", llmProviderId: PICK },
        ),
        hasConnectedRepository: true,
        existingRun: null,
      }).llmProviderId,
    ).toBe(PICK);
  });

  test("the run it enqueues records the pick", async () => {
    jest
      .spyOn(RemediationRulePullRequests, "getRulesForSignal")
      .mockResolvedValue(
        matchingRules({ name: "Checkout", llmProviderId: PICK }),
      );
    const enqueue: jest.SpyInstance = jest
      .spyOn(SubjectCodeFixRun, "enqueueSubjectCodeFixRun")
      .mockResolvedValue(fakeRun());

    await FixFromIncidentTaskTrigger.autoEnqueueFromRecommendedInvestigation({
      projectId,
      investigationRunId,
      analysisMarkdown,
      incidentId,
    });

    expect(
      (enqueue.mock.calls[0]![0] as { llmProviderId?: ObjectID }).llmProviderId,
    ).toEqual(new ObjectID(PICK));
  });

  test("no rule: the run picks none", async () => {
    jest
      .spyOn(RemediationRulePullRequests, "getRulesForSignal")
      .mockResolvedValue(NO_RULES);
    const enqueue: jest.SpyInstance = jest
      .spyOn(SubjectCodeFixRun, "enqueueSubjectCodeFixRun")
      .mockResolvedValue(fakeRun());

    await FixFromIncidentTaskTrigger.autoEnqueueFromRecommendedInvestigation({
      projectId,
      investigationRunId,
      analysisMarkdown,
      incidentId,
    });

    expect(
      (enqueue.mock.calls[0]![0] as { llmProviderId?: ObjectID }).llmProviderId,
    ).toBeUndefined();
  });

  test("SubjectCodeFixRun records the pick on the run it creates", async () => {
    jest
      .spyOn(CodeFixRunRepository, "resolveForNewRun")
      .mockResolvedValue(null);
    const create: jest.SpyInstance = jest
      .spyOn(AIRunService, "create")
      .mockResolvedValue(fakeRun());

    await enqueueSubjectCodeFixRun({
      projectId,
      taskType: CodeFixTaskType.ImproveInstrumentation,
      incidentId,
      llmProviderId: new ObjectID(PICK),
    });

    expect(
      (create.mock.calls[0]![0] as { data: AIRun }).data.llmProviderId,
    ).toEqual(new ObjectID(PICK));
  });

  test("toRunLlmProviderId: a pick as a run records it, none for none", () => {
    expect(SubjectCodeFixRun.toRunLlmProviderId(PICK)).toEqual(
      new ObjectID(PICK),
    );
    expect(SubjectCodeFixRun.toRunLlmProviderId("")).toBeUndefined();
    expect(SubjectCodeFixRun.toRunLlmProviderId(undefined)).toBeUndefined();
    expect(SubjectCodeFixRun.toRunLlmProviderId("not-an-id")).toBeUndefined();
  });
});
