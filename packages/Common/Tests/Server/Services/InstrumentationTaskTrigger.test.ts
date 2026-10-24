import InstrumentationTaskTrigger from "../../../Server/Utils/AI/SRE/InstrumentationTaskTrigger";
import RemediationRulePullRequests from "../../../Server/Utils/AI/SRE/RemediationRulePullRequests";
import FixRunBudget from "../../../Server/Utils/AI/CodeFix/FixRunBudget";
import ProjectService from "../../../Server/Services/ProjectService";
import CodeRepositoryService from "../../../Server/Services/CodeRepositoryService";
import AIRunService from "../../../Server/Services/AIRunService";
import Project from "../../../Models/DatabaseModels/Project";
import AIRun from "../../../Models/DatabaseModels/AIRun";
import AIRunType from "../../../Types/AI/AIRunType";
import AIRunStatus from "../../../Types/AI/AIRunStatus";
import CodeFixTaskType from "../../../Types/AI/CodeFixTaskType";
import {
  AutomaticFixPullRequestRules,
  RemediationRulePullRequestFacts,
} from "../../../Types/AI/AutomaticFixPullRequests";
import { EVERY_CODE_REPOSITORY } from "../../../Types/CodeRepository/CodeRepositoryAllowance";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import { describe, expect, test, afterEach, beforeEach } from "@jest/globals";

/*
 * The ImproveInstrumentation trigger: an INCONCLUSIVE AI investigation
 * enqueues a CodeFix AIRun that opens an instrumentation PR - but only while
 * the investigation's lane has "Fix new incidents automatically" (or
 * alerts) on, and the lane's auto remediation rules let it: with none,
 * every inconclusive investigation opens one; with some, only one a rule
 * with "Telemetry pull requests" on (its default) matches, in the
 * repositories those rules name (Types/AI/AutomaticFixPullRequests). Only
 * when a GitHub-App repo the rules allow exists to open the PR against,
 * and at most one non-terminal run per incident/alert. The trigger runs
 * inside postAnalysis, so it must NEVER throw.
 */

const projectId: ObjectID = ObjectID.generate();
const incidentId: ObjectID = ObjectID.generate();
const alertId: ObjectID = ObjectID.generate();
const API_REPOSITORY: string = "c1111111-1111-4111-8111-111111111111";

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

type GateDecision = ReturnType<
  typeof InstrumentationTaskTrigger.shouldEnqueueInstrumentationTask
>;

describe("InstrumentationTaskTrigger.shouldEnqueueInstrumentationTask", () => {
  test("does not enqueue when the project is missing", () => {
    expect(
      InstrumentationTaskTrigger.shouldEnqueueInstrumentationTask({
        project: null,
        incidentId,
        rules: NO_RULES,
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
        rules: NO_RULES,
        hasConnectedRepository: true,
        existingRun: null,
      }).enqueue,
    ).toBe(false);
  });

  test("the fixing switch is strict: unset (a row read without it) never enqueues", () => {
    const project: Project = {
      id: projectId,
      enableAi: true,
      // enableAutomaticIncidentRemediation deliberately absent.
    } as unknown as Project;

    const decision: GateDecision =
      InstrumentationTaskTrigger.shouldEnqueueInstrumentationTask({
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
    "%s: fixing off means no telemetry pull request, whatever the rules say",
    (
      label: string,
      subject: { incidentId?: ObjectID; alertId?: ObjectID },
      fixOff: Record<string, boolean>,
    ) => {
      for (const rules of [NO_RULES, matchingRules({})]) {
        const decision: GateDecision =
          InstrumentationTaskTrigger.shouldEnqueueInstrumentationTask({
            project: fakeProject(fixOff),
            ...subject,
            rules,
            hasConnectedRepository: true,
            existingRun: null,
          });

        expect(decision.enqueue).toBe(false);
        expect(decision.reason).toBe(
          `project has fixing new ${label}s automatically off, and its telemetry pull requests open only while it is on`,
        );
      }
    },
  );

  test("one lane's fixing does not open the other lane's telemetry pull requests", () => {
    const project: Project = fakeProject({
      enableAutomaticIncidentRemediation: false,
      enableAutomaticAlertRemediation: true,
    });

    expect(
      InstrumentationTaskTrigger.shouldEnqueueInstrumentationTask({
        project,
        incidentId,
        rules: NO_RULES,
        hasConnectedRepository: true,
        existingRun: null,
      }).enqueue,
    ).toBe(false);
    expect(
      InstrumentationTaskTrigger.shouldEnqueueInstrumentationTask({
        project,
        alertId,
        rules: NO_RULES,
        hasConnectedRepository: true,
        existingRun: null,
      }).enqueue,
    ).toBe(true);
  });

  test("with no auto remediation rule it enqueues, in any connected repository", () => {
    const decision: GateDecision =
      InstrumentationTaskTrigger.shouldEnqueueInstrumentationTask({
        project: fakeProject(),
        incidentId,
        rules: NO_RULES,
        hasConnectedRepository: true,
        existingRun: null,
      });

    expect(decision.enqueue).toBe(true);
    expect(decision.repositories).toEqual(EVERY_CODE_REPOSITORY);
  });

  test("rules that could not be read, or that do not match: nothing enqueued", () => {
    expect(
      InstrumentationTaskTrigger.shouldEnqueueInstrumentationTask({
        project: fakeProject(),
        incidentId,
        rules: null,
        hasConnectedRepository: true,
        existingRun: null,
      }).reason,
    ).toContain("could not be read");
    expect(
      InstrumentationTaskTrigger.shouldEnqueueInstrumentationTask({
        project: fakeProject(),
        incidentId,
        rules: { rulesSetUp: true, matchingRules: [] },
        hasConnectedRepository: true,
        existingRun: null,
      }).reason,
    ).toBe(
      "no auto remediation rule matches this incident, so it is not fixed",
    );
  });

  test("matching rules with telemetry pull requests off: nothing, though fix pull requests are on", () => {
    const decision: GateDecision =
      InstrumentationTaskTrigger.shouldEnqueueInstrumentationTask({
        project: fakeProject(),
        incidentId,
        rules: matchingRules({
          openCodeFixPullRequests: true,
          openTelemetryPullRequests: false,
        }),
        hasConnectedRepository: true,
        existingRun: null,
      });

    expect(decision.enqueue).toBe(false);
    expect(decision.reason).toBe(
      "the auto remediation rules that match this incident have telemetry pull requests off",
    );
  });

  test("a matching rule naming repositories: it enqueues for those only", () => {
    const decision: GateDecision =
      InstrumentationTaskTrigger.shouldEnqueueInstrumentationTask({
        project: fakeProject(),
        alertId,
        rules: matchingRules({ codeRepositories: [{ _id: API_REPOSITORY }] }),
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
    const decision: GateDecision =
      InstrumentationTaskTrigger.shouldEnqueueInstrumentationTask({
        project: fakeProject(),
        rules: NO_RULES,
        hasConnectedRepository: true,
        existingRun: null,
      });

    expect(decision.enqueue).toBe(false);
    expect(decision.reason).toMatch(/subject/);
  });

  test("a gate carrying both subject types is rejected instead of borrowing the incident lane", () => {
    const decision: GateDecision =
      InstrumentationTaskTrigger.shouldEnqueueInstrumentationTask({
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
    const decision: GateDecision =
      InstrumentationTaskTrigger.shouldEnqueueInstrumentationTask({
        project: fakeProject(),
        incidentId,
        rules: NO_RULES,
        hasConnectedRepository: false,
        existingRun: null,
      });

    expect(decision.enqueue).toBe(false);
    expect(decision.reason).toMatch(/repository/);
  });

  test("dedupe: an existing non-terminal run for the subject blocks a second one", () => {
    const decision: GateDecision =
      InstrumentationTaskTrigger.shouldEnqueueInstrumentationTask({
        project: fakeProject(),
        incidentId,
        rules: NO_RULES,
        hasConnectedRepository: true,
        existingRun: { id: ObjectID.generate() } as unknown as AIRun,
      });

    expect(decision.enqueue).toBe(false);
    expect(decision.reason).toMatch(/already exists/);
  });
});

describe("InstrumentationTaskTrigger.enqueueForInconclusiveInvestigation", () => {
  let getRules: jest.SpyInstance;

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
    // No auto remediation rule by default: every subject's PR may open.
    getRules = jest
      .spyOn(RemediationRulePullRequests, "getRulesForSignal")
      .mockResolvedValue(NO_RULES);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("over the daily fix-run budget: a logged SKIP — no rule read, no run created, nothing thrown into the investigation", async () => {
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

    // Skipped before the rules, the repo and the dedupe queries.
    expect(getRules).not.toHaveBeenCalled();
    expect(countBy).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(getBudgetStatus).toHaveBeenCalledWith(projectId, {
      incidentId,
      alertId: undefined,
    });
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
    "%s: a project with fixing off skips cheaply — no rule, budget, repository or dedupe read, no run created",
    async (
      _label: string,
      subject: { incidentId?: ObjectID; alertId?: ObjectID },
      fixOff: Record<string, boolean>,
    ) => {
      jest
        .spyOn(ProjectService, "findOneById")
        .mockResolvedValue(fakeProject(fixOff));
      const countBy: jest.SpyInstance = jest.spyOn(
        CodeRepositoryService,
        "countBy",
      );
      const findOneBy: jest.SpyInstance = jest.spyOn(AIRunService, "findOneBy");
      const create: jest.SpyInstance = jest.spyOn(AIRunService, "create");

      await InstrumentationTaskTrigger.enqueueForInconclusiveInvestigation({
        projectId,
        ...subject,
      });

      expect(getRules).not.toHaveBeenCalled();
      expect(FixRunBudget.getBudgetStatus).not.toHaveBeenCalled();
      expect(countBy).not.toHaveBeenCalled();
      expect(findOneBy).not.toHaveBeenCalled();
      expect(create).not.toHaveBeenCalled();
    },
  );

  test.each([
    ["rules that could not be read", null],
    ["rules none of which matches", { rulesSetUp: true, matchingRules: [] }],
    [
      "matching rules with telemetry pull requests off",
      matchingRules({ openTelemetryPullRequests: false }),
    ],
  ] as Array<[string, AutomaticFixPullRequestRules | null]>)(
    "%s: no repository counted, no run created",
    async (_label: string, rules: AutomaticFixPullRequestRules | null) => {
      jest
        .spyOn(ProjectService, "findOneById")
        .mockResolvedValue(fakeProject());
      getRules.mockResolvedValue(rules);
      const countBy: jest.SpyInstance = jest.spyOn(
        CodeRepositoryService,
        "countBy",
      );
      const create: jest.SpyInstance = jest.spyOn(AIRunService, "create");

      await InstrumentationTaskTrigger.enqueueForInconclusiveInvestigation({
        projectId,
        incidentId,
      });

      expect(getRules).toHaveBeenCalledWith({
        projectId,
        incidentId,
        alertId: undefined,
      });
      expect(countBy).not.toHaveBeenCalled();
      expect(create).not.toHaveBeenCalled();
    },
  );

  test("records a Queued ImproveInstrumentation CodeFix run carrying the incident subject", async () => {
    const findProject: jest.SpyInstance = jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue(fakeProject());
    const countBy: jest.SpyInstance = jest
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

    // Enable AI and the incident fixing switch - no pull request column.
    expect(findProject).toHaveBeenCalledWith(
      expect.objectContaining({
        select: {
          enableAi: true,
          enableAutomaticIncidentRemediation: true,
        },
      }),
    );
    expect(FixRunBudget.getBudgetStatus).toHaveBeenCalledWith(projectId, {
      incidentId,
      alertId: undefined,
    });

    // With no rule, any connected repository counts.
    expect(countBy.mock.calls[0]![0]).not.toHaveProperty("query._id");

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
    // Every repository: the run names none.
    expect(
      (create.mock.calls[0]![0] as { data: AIRun }).data.taskContext,
    ).toBeUndefined();
  });

  test("an alert-subject investigation matched by a rule naming a repository enqueues for that repository", async () => {
    const findProject: jest.SpyInstance = jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue(fakeProject());
    getRules.mockResolvedValue(
      matchingRules({ codeRepositories: [{ _id: API_REPOSITORY }] }),
    );
    const countBy: jest.SpyInstance = jest
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
          enableAutomaticAlertRemediation: true,
        },
      }),
    );
    expect(FixRunBudget.getBudgetStatus).toHaveBeenCalledWith(projectId, {
      incidentId: undefined,
      alertId,
    });

    // Only the rule's repository is counted.
    expect(countBy.mock.calls[0]![0]).toHaveProperty("query._id");

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          codeFixTaskType: CodeFixTaskType.ImproveInstrumentation,
          triggeredByAlertId: alertId,
          taskContext: { allowedCodeRepositoryIds: [API_REPOSITORY] },
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

  test("never throws — a failed rule read or enqueue must not fail the investigation's postAnalysis", async () => {
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

    getRules.mockRejectedValue(new Error("rules table is gone"));

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
    expect(getRules).not.toHaveBeenCalled();
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
    expect(getRules).not.toHaveBeenCalled();
  });
});

/*
 * The telemetry pull request is written with the LLM provider the rules
 * that open it pick - the first of them by name that picks one
 * (Types/AI/AutomaticFixPullRequests, Types/AI/LlmProviderChoice) - which
 * the run records (AIRun.llmProviderId) for its completions to use.
 */
describe("InstrumentationTaskTrigger and the LLM provider the rules pick", () => {
  const PICK: string = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("the gate's decision carries the opening rule's pick", () => {
    expect(
      InstrumentationTaskTrigger.shouldEnqueueInstrumentationTask({
        project: fakeProject(),
        incidentId,
        rules: matchingRules({ name: "Checkout", llmProviderId: PICK }),
        hasConnectedRepository: true,
        existingRun: null,
      }),
    ).toMatchObject({ enqueue: true, llmProviderId: PICK });

    expect(
      InstrumentationTaskTrigger.shouldEnqueueInstrumentationTask({
        project: fakeProject(),
        incidentId,
        rules: NO_RULES,
        hasConnectedRepository: true,
        existingRun: null,
      }).llmProviderId,
    ).toBe("");
  });

  test("the run it records carries the pick", async () => {
    jest.spyOn(FixRunBudget, "getBudgetStatus").mockResolvedValue({
      allowed: true,
      limit: 25,
      paused: false,
      runsToday: 0,
    });
    jest
      .spyOn(RemediationRulePullRequests, "getRulesForSignal")
      .mockResolvedValue(
        matchingRules({ name: "Checkout", llmProviderId: PICK }),
      );
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue(fakeProject());
    jest
      .spyOn(CodeRepositoryService, "countBy")
      .mockResolvedValue(new PositiveNumber(1));
    jest.spyOn(AIRunService, "findOneBy").mockResolvedValue(null);
    const create: jest.SpyInstance = jest
      .spyOn(AIRunService, "create")
      .mockResolvedValue({ id: ObjectID.generate() } as unknown as AIRun);

    await InstrumentationTaskTrigger.enqueueForInconclusiveInvestigation({
      projectId,
      incidentId,
    });

    expect(
      (create.mock.calls[0]![0] as { data: AIRun }).data.llmProviderId,
    ).toEqual(new ObjectID(PICK));
  });

  test("no rule picks one: the run picks none", async () => {
    jest.spyOn(FixRunBudget, "getBudgetStatus").mockResolvedValue({
      allowed: true,
      limit: 25,
      paused: false,
      runsToday: 0,
    });
    jest
      .spyOn(RemediationRulePullRequests, "getRulesForSignal")
      .mockResolvedValue(NO_RULES);
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue(fakeProject());
    jest
      .spyOn(CodeRepositoryService, "countBy")
      .mockResolvedValue(new PositiveNumber(1));
    jest.spyOn(AIRunService, "findOneBy").mockResolvedValue(null);
    const create: jest.SpyInstance = jest
      .spyOn(AIRunService, "create")
      .mockResolvedValue({ id: ObjectID.generate() } as unknown as AIRun);

    await InstrumentationTaskTrigger.enqueueForInconclusiveInvestigation({
      projectId,
      incidentId,
    });

    expect(
      (create.mock.calls[0]![0] as { data: AIRun }).data.llmProviderId,
    ).toBeUndefined();
  });
});
