import RemediationPolicy, {
  DEFAULT_DAILY_REMEDIATION_EXECUTION_LIMIT,
  PER_SUBJECT_EXECUTION_CAP,
  RemediationBudgetDecision,
  RunbookAutonomyProfile,
  SubjectAutoRemediationGrant,
} from "../../../../Server/Utils/AI/SRE/RemediationPolicy";
import ProjectService from "../../../../Server/Services/ProjectService";
import AIRemediationActionService from "../../../../Server/Services/AIRemediationActionService";
import Project from "../../../../Models/DatabaseModels/Project";
import AIRemediationActionType from "../../../../Types/AI/AIRemediationActionType";
import AIRemediationDecisionMode from "../../../../Types/AI/AIRemediationDecisionMode";
import AIRemediationIntent from "../../../../Types/AI/AIRemediationIntent";
import RunbookAgentAccessLevel from "../../../../Types/Runbook/RunbookAgentAccessLevel";
import RunbookStepType from "../../../../Types/Runbook/RunbookStepType";
import { RunbookStep } from "../../../../Types/Runbook/RunbookStep";
import ObjectID from "../../../../Types/ObjectID";
import PositiveNumber from "../../../../Types/PositiveNumber";
import { describe, expect, test, afterEach } from "@jest/globals";

/*
 * The remediation policy gate (the G1 seed of the environment-execution
 * lane). Under test: the pure decision-mode matrix (Command NEVER
 * auto-executes; runbook auto-execution requires the opt-in AND every step
 * agent known AND non-Production; HTTP steps disqualify; unknown agents fail
 * safe to Production), the daily execution budget (null is the DEFAULT cap,
 * never unlimited; 0 pauses), and the autonomy profile step classifier.
 */

const projectId: ObjectID = ObjectID.generate();

function bashStep(agentId: string): RunbookStep {
  return {
    id: `step-${agentId}`,
    order: 1,
    type: RunbookStepType.Bash,
    title: "step",
    config: { script: "echo ok", agentId },
  };
}

function step(type: RunbookStepType): RunbookStep {
  return {
    id: `step-${type}`,
    order: 1,
    type,
    title: "step",
    config: {} as never,
  };
}

describe("RemediationPolicy.getRunbookAutonomyProfile", () => {
  test("collects agent ids from Bash and JavaScript steps", () => {
    const profile: RunbookAutonomyProfile =
      RemediationPolicy.getRunbookAutonomyProfile([
        bashStep("agent-1"),
        {
          id: "js-step",
          order: 2,
          type: RunbookStepType.JavaScript,
          title: "js",
          config: { script: "1", agentId: "agent-2" },
        },
      ]);

    expect(profile.agentIds).toEqual(["agent-1", "agent-2"]);
    expect(profile.hasHttpSteps).toBe(false);
  });

  test("HttpRequest steps flag the profile", () => {
    const profile: RunbookAutonomyProfile =
      RemediationPolicy.getRunbookAutonomyProfile([
        step(RunbookStepType.HttpRequest),
      ]);

    expect(profile.hasHttpSteps).toBe(true);
  });

  test("Manual and AI steps are neutral", () => {
    const profile: RunbookAutonomyProfile =
      RemediationPolicy.getRunbookAutonomyProfile([
        step(RunbookStepType.Manual),
        step(RunbookStepType.AI),
      ]);

    expect(profile.agentIds).toEqual([]);
    expect(profile.hasHttpSteps).toBe(false);
  });

  test("an unknown step type disqualifies auto-execution (fail-safe)", () => {
    const profile: RunbookAutonomyProfile =
      RemediationPolicy.getRunbookAutonomyProfile([
        step("SomethingNew" as RunbookStepType),
      ]);

    expect(profile.hasHttpSteps).toBe(true);
  });

  test("an agent-bound step with no agentId contributes an empty id", () => {
    const profile: RunbookAutonomyProfile =
      RemediationPolicy.getRunbookAutonomyProfile([
        {
          id: "bash",
          order: 1,
          type: RunbookStepType.Bash,
          title: "bash",
          config: { script: "echo ok" } as never,
        },
      ]);

    // The empty id will never resolve to an agent → undefined → Production.
    expect(profile.agentIds).toEqual([""]);
  });
});

describe("RemediationPolicy.decideDecisionMode", () => {
  const profile: RunbookAutonomyProfile = {
    agentIds: ["agent-1"],
    hasHttpSteps: false,
  };

  const GRANTED: SubjectAutoRemediationGrant = {
    matched: true,
    commandsAllowed: true,
  };
  const GRANTED_NO_COMMANDS: SubjectAutoRemediationGrant = {
    matched: true,
    commandsAllowed: false,
  };
  const NO_RULE: SubjectAutoRemediationGrant = {
    matched: false,
    commandsAllowed: false,
  };

  const READ_WRITE: Array<string | undefined> = [
    RunbookAgentAccessLevel.ReadWrite,
  ];
  const READ_ONLY: Array<string | undefined> = [
    RunbookAgentAccessLevel.ReadOnly,
  ];

  describe("rule matching is the primary gate", () => {
    test("no matching rule → approval, even for a fully-granted runbook", () => {
      expect(
        RemediationPolicy.decideDecisionMode({
          actionType: AIRemediationActionType.Runbook,
          intent: AIRemediationIntent.Remediation,
          subjectGrant: NO_RULE,
          runbookProfile: profile,
          agentAccessLevels: READ_WRITE,
        }),
      ).toBe(AIRemediationDecisionMode.RequireApproval);
    });

    test("no matching rule → approval, even for a read-only diagnostic", () => {
      expect(
        RemediationPolicy.decideDecisionMode({
          actionType: AIRemediationActionType.Runbook,
          intent: AIRemediationIntent.Diagnostic,
          subjectGrant: NO_RULE,
          runbookProfile: profile,
          agentAccessLevels: READ_ONLY,
        }),
      ).toBe(AIRemediationDecisionMode.RequireApproval);
    });

    test("a matching rule + ReadWrite grant → AutoApproved", () => {
      expect(
        RemediationPolicy.decideDecisionMode({
          actionType: AIRemediationActionType.Runbook,
          intent: AIRemediationIntent.Remediation,
          subjectGrant: GRANTED,
          runbookProfile: profile,
          agentAccessLevels: READ_WRITE,
        }),
      ).toBe(AIRemediationDecisionMode.AutoApproved);
    });
  });

  describe("drafted commands need their own per-rule grant", () => {
    test("a matching rule WITHOUT the command grant → approval", () => {
      expect(
        RemediationPolicy.decideDecisionMode({
          actionType: AIRemediationActionType.Command,
          intent: AIRemediationIntent.Remediation,
          subjectGrant: GRANTED_NO_COMMANDS,
          agentAccessLevels: READ_WRITE,
        }),
      ).toBe(AIRemediationDecisionMode.RequireApproval);
    });

    test("the command grant + a ReadWrite agent → AutoApproved", () => {
      expect(
        RemediationPolicy.decideDecisionMode({
          actionType: AIRemediationActionType.Command,
          intent: AIRemediationIntent.Remediation,
          subjectGrant: GRANTED,
          agentAccessLevels: READ_WRITE,
        }),
      ).toBe(AIRemediationDecisionMode.AutoApproved);
    });

    test("the command grant does NOT bypass the agent's write grant", () => {
      expect(
        RemediationPolicy.decideDecisionMode({
          actionType: AIRemediationActionType.Command,
          intent: AIRemediationIntent.Remediation,
          subjectGrant: GRANTED,
          agentAccessLevels: READ_ONLY,
        }),
      ).toBe(AIRemediationDecisionMode.RequireApproval);
    });

    test("a command with no resolvable target agent → approval", () => {
      expect(
        RemediationPolicy.decideDecisionMode({
          actionType: AIRemediationActionType.Command,
          intent: AIRemediationIntent.Remediation,
          subjectGrant: GRANTED,
          agentAccessLevels: [],
        }),
      ).toBe(AIRemediationDecisionMode.RequireApproval);
    });
  });

  describe("writes need the per-agent ReadWrite grant; reads do not", () => {
    test("Remediation on a ReadOnly agent → approval", () => {
      expect(
        RemediationPolicy.decideDecisionMode({
          actionType: AIRemediationActionType.Runbook,
          intent: AIRemediationIntent.Remediation,
          subjectGrant: GRANTED,
          runbookProfile: profile,
          agentAccessLevels: READ_ONLY,
        }),
      ).toBe(AIRemediationDecisionMode.RequireApproval);
    });

    test("Diagnostic on a ReadOnly agent → AutoApproved (that IS read access)", () => {
      expect(
        RemediationPolicy.decideDecisionMode({
          actionType: AIRemediationActionType.Runbook,
          intent: AIRemediationIntent.Diagnostic,
          subjectGrant: GRANTED,
          runbookProfile: profile,
          agentAccessLevels: READ_ONLY,
        }),
      ).toBe(AIRemediationDecisionMode.AutoApproved);
    });

    test("an unknown/unset grant fails safe to no-write", () => {
      expect(
        RemediationPolicy.decideDecisionMode({
          actionType: AIRemediationActionType.Runbook,
          intent: AIRemediationIntent.Remediation,
          subjectGrant: GRANTED,
          runbookProfile: profile,
          agentAccessLevels: [undefined],
        }),
      ).toBe(AIRemediationDecisionMode.RequireApproval);
    });

    test("ONE ReadOnly agent among many disqualifies the whole runbook", () => {
      expect(
        RemediationPolicy.decideDecisionMode({
          actionType: AIRemediationActionType.Runbook,
          intent: AIRemediationIntent.Remediation,
          subjectGrant: GRANTED,
          runbookProfile: { agentIds: ["a", "b"], hasHttpSteps: false },
          agentAccessLevels: [
            RunbookAgentAccessLevel.ReadWrite,
            RunbookAgentAccessLevel.ReadOnly,
          ],
        }),
      ).toBe(AIRemediationDecisionMode.RequireApproval);
    });
  });

  describe("runbook shape guards still apply", () => {
    test("a missing profile requires approval", () => {
      expect(
        RemediationPolicy.decideDecisionMode({
          actionType: AIRemediationActionType.Runbook,
          intent: AIRemediationIntent.Remediation,
          subjectGrant: GRANTED,
          agentAccessLevels: READ_WRITE,
        }),
      ).toBe(AIRemediationDecisionMode.RequireApproval);
    });

    test("an HTTP step disqualifies auto-execution — a URL has no grant", () => {
      expect(
        RemediationPolicy.decideDecisionMode({
          actionType: AIRemediationActionType.Runbook,
          intent: AIRemediationIntent.Remediation,
          subjectGrant: GRANTED,
          runbookProfile: { agentIds: ["agent-1"], hasHttpSteps: true },
          agentAccessLevels: READ_WRITE,
        }),
      ).toBe(AIRemediationDecisionMode.RequireApproval);
    });

    test("a dangling agent id (fewer grants than steps) requires approval", () => {
      expect(
        RemediationPolicy.decideDecisionMode({
          actionType: AIRemediationActionType.Runbook,
          intent: AIRemediationIntent.Remediation,
          subjectGrant: GRANTED,
          runbookProfile: { agentIds: ["a", "b"], hasHttpSteps: false },
          agentAccessLevels: READ_WRITE,
        }),
      ).toBe(AIRemediationDecisionMode.RequireApproval);
    });
  });
});

describe("RemediationPolicy.evaluateDailyBudget", () => {
  test("null means the DEFAULT cap, never unlimited", () => {
    const under: RemediationBudgetDecision =
      RemediationPolicy.evaluateDailyBudget({
        configuredLimit: null,
        executionsToday: DEFAULT_DAILY_REMEDIATION_EXECUTION_LIMIT - 1,
      });

    expect(under.allowed).toBe(true);
    expect(under.limit).toBe(DEFAULT_DAILY_REMEDIATION_EXECUTION_LIMIT);

    const at: RemediationBudgetDecision = RemediationPolicy.evaluateDailyBudget(
      {
        configuredLimit: undefined,
        executionsToday: DEFAULT_DAILY_REMEDIATION_EXECUTION_LIMIT,
      },
    );

    expect(at.allowed).toBe(false);
    expect(at.paused).toBe(false);
  });

  test("0 pauses the lane outright — even with zero executions today", () => {
    const decision: RemediationBudgetDecision =
      RemediationPolicy.evaluateDailyBudget({
        configuredLimit: 0,
        executionsToday: 0,
      });

    expect(decision.allowed).toBe(false);
    expect(decision.paused).toBe(true);
  });

  test("a negative limit reads as paused, never as unlimited", () => {
    const decision: RemediationBudgetDecision =
      RemediationPolicy.evaluateDailyBudget({
        configuredLimit: -3,
        executionsToday: 0,
      });

    expect(decision.allowed).toBe(false);
    expect(decision.paused).toBe(true);
  });

  test("a custom limit overrides the default in both directions", () => {
    expect(
      RemediationPolicy.evaluateDailyBudget({
        configuredLimit: 2,
        executionsToday: 1,
      }).allowed,
    ).toBe(true);
    expect(
      RemediationPolicy.evaluateDailyBudget({
        configuredLimit: 2,
        executionsToday: 2,
      }).allowed,
    ).toBe(false);
    expect(
      RemediationPolicy.evaluateDailyBudget({
        configuredLimit: 100,
        executionsToday: DEFAULT_DAILY_REMEDIATION_EXECUTION_LIMIT,
      }).allowed,
    ).toBe(true);
  });
});

describe("RemediationPolicy.describe* rejections", () => {
  test("paused rejection names the setting and the 0 value", () => {
    const message: string = RemediationPolicy.describeDailyBudgetRejection(
      RemediationPolicy.evaluateDailyBudget({
        configuredLimit: 0,
        executionsToday: 0,
      }),
    );

    expect(message).toMatch(/Daily AI Remediation Execution Limit/);
    expect(message).toMatch(/0/);
  });

  test("over-budget rejection names the counts and the default", () => {
    const message: string = RemediationPolicy.describeDailyBudgetRejection(
      RemediationPolicy.evaluateDailyBudget({
        configuredLimit: 10,
        executionsToday: 10,
      }),
    );

    expect(message).toMatch(/10 of 10/);
    expect(message).toMatch(
      new RegExp(String(DEFAULT_DAILY_REMEDIATION_EXECUTION_LIMIT)),
    );
  });

  test("subject-cap rejection names the cap", () => {
    expect(RemediationPolicy.describeSubjectCapRejection()).toMatch(
      new RegExp(String(PER_SUBJECT_EXECUTION_CAP)),
    );
  });
});

describe("RemediationPolicy.isLaneEnabledForProject (IO wiring)", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("enabled only when enableAi !== false AND enableAiRemediation === true", async () => {
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue({
      id: projectId,
      enableAi: true,
      enableAiRemediation: true,
    } as unknown as Project);

    expect(await RemediationPolicy.isLaneEnabledForProject(projectId)).toBe(
      true,
    );
  });

  test("the enableAi master switch kills the lane", async () => {
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue({
      id: projectId,
      enableAi: false,
      enableAiRemediation: true,
    } as unknown as Project);

    expect(await RemediationPolicy.isLaneEnabledForProject(projectId)).toBe(
      false,
    );
  });

  test("unset enableAiRemediation (legacy rows) reads as disabled", async () => {
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue({
      id: projectId,
    } as unknown as Project);

    expect(await RemediationPolicy.isLaneEnabledForProject(projectId)).toBe(
      false,
    );
  });

  test("a missing project reads as disabled", async () => {
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue(null);

    expect(await RemediationPolicy.isLaneEnabledForProject(projectId)).toBe(
      false,
    );
  });
});

describe("RemediationPolicy.getDailyExecutionBudget (IO wiring)", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("counts executions dispatched since UTC midnight by executedAt", async () => {
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue({
      id: projectId,
      aiDailyRemediationExecutionLimit: 5,
    } as unknown as Project);

    const countBy: jest.SpyInstance = jest
      .spyOn(AIRemediationActionService, "countBy")
      .mockResolvedValue(new PositiveNumber(2));

    const decision: RemediationBudgetDecision =
      await RemediationPolicy.getDailyExecutionBudget(projectId);

    expect(decision).toEqual({
      allowed: true,
      limit: 5,
      paused: false,
      executionsToday: 2,
    });

    expect(countBy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({
          projectId,
          // executedAt >= UTC midnight rides in a QueryHelper find operator.
          executedAt: expect.anything(),
        }),
        props: expect.objectContaining({ isRoot: true }),
      }),
    );
  });

  test("a paused project (limit 0) short-circuits without the count query", async () => {
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue({
      id: projectId,
      aiDailyRemediationExecutionLimit: 0,
    } as unknown as Project);

    const countBy: jest.SpyInstance = jest.spyOn(
      AIRemediationActionService,
      "countBy",
    );

    const decision: RemediationBudgetDecision =
      await RemediationPolicy.getDailyExecutionBudget(projectId);

    expect(decision.paused).toBe(true);
    expect(countBy).not.toHaveBeenCalled();
  });

  test("a missing project row falls back to the default cap (fail-safe)", async () => {
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue(null);
    jest
      .spyOn(AIRemediationActionService, "countBy")
      .mockResolvedValue(
        new PositiveNumber(DEFAULT_DAILY_REMEDIATION_EXECUTION_LIMIT),
      );

    const decision: RemediationBudgetDecision =
      await RemediationPolicy.getDailyExecutionBudget(projectId);

    expect(decision.limit).toBe(DEFAULT_DAILY_REMEDIATION_EXECUTION_LIMIT);
    expect(decision.allowed).toBe(false);
  });
});

describe("RemediationPolicy.getSubjectExecutionCount", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("no subject means zero without a query", async () => {
    const countBy: jest.SpyInstance = jest.spyOn(
      AIRemediationActionService,
      "countBy",
    );

    expect(
      await RemediationPolicy.getSubjectExecutionCount({ projectId }),
    ).toBe(0);
    expect(countBy).not.toHaveBeenCalled();
  });

  test("counts executed statuses for the incident subject", async () => {
    const countBy: jest.SpyInstance = jest
      .spyOn(AIRemediationActionService, "countBy")
      .mockResolvedValue(new PositiveNumber(3));

    const incidentId: ObjectID = ObjectID.generate();

    expect(
      await RemediationPolicy.getSubjectExecutionCount({
        projectId,
        incidentId,
      }),
    ).toBe(3);

    expect(countBy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({
          projectId,
          incidentId,
          status: expect.anything(),
        }),
        props: expect.objectContaining({ isRoot: true }),
      }),
    );
  });
});
