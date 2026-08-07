import RemediationExecutionRunner from "../../../../Server/Utils/AI/Remediation/RemediationExecutionRunner";
import AIInvestigationEngine, {
  InvestigationRequest,
} from "../../../../Server/Utils/AI/SRE/AIInvestigationEngine";
import { ConfidenceSignal } from "../../../../Server/Utils/AI/SRE/ConfidenceSignal";
import {
  ObservabilityAssistantExtraTool,
  ObservabilityAssistantResult,
} from "../../../../Server/Utils/AI/Chat/ObservabilityAssistant";
import { ToolCallOutcome } from "../../../../Server/Utils/AI/Toolbox/Index";
import AIRunService from "../../../../Server/Services/AIRunService";
import AlertFeedService from "../../../../Server/Services/AlertFeedService";
import AlertService from "../../../../Server/Services/AlertService";
import AutoRemediationRuleService from "../../../../Server/Services/AutoRemediationRuleService";
import AutoRemediationSuggestionService from "../../../../Server/Services/AutoRemediationSuggestionService";
import IncidentFeedService from "../../../../Server/Services/IncidentFeedService";
import IncidentService from "../../../../Server/Services/IncidentService";
import ProjectService from "../../../../Server/Services/ProjectService";
import RunnerService from "../../../../Server/Services/RunnerService";
import { MAX_AUTO_EXECUTIONS_PER_RULE_PER_HOUR } from "../../../../Server/Services/AutoRemediationRuleEngineService";
import PostedRootCause from "../../../../Server/Utils/AI/SRE/PostedRootCause";
import logger from "../../../../Server/Utils/Logger";
import Alert from "../../../../Models/DatabaseModels/Alert";
import AutoRemediationRule from "../../../../Models/DatabaseModels/AutoRemediationRule";
import AutoRemediationSuggestion from "../../../../Models/DatabaseModels/AutoRemediationSuggestion";
import Incident from "../../../../Models/DatabaseModels/Incident";
import Project from "../../../../Models/DatabaseModels/Project";
import Runner from "../../../../Models/DatabaseModels/Runner";
import AIRunStatus from "../../../../Types/AI/AIRunStatus";
import AutoRemediationExecutionMode from "../../../../Types/AutoRemediation/AutoRemediationExecutionMode";
import AutoRemediationSuggestionStatus from "../../../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import AutoRemediationSuggestionType from "../../../../Types/AutoRemediation/AutoRemediationSuggestionType";
import AutoRemediationVerificationStatus from "../../../../Types/AutoRemediation/AutoRemediationVerificationStatus";
import {
  AiRemediationCommandExecutionStatus,
  AiRemediationCommandPolicyVerdict,
  AiRemediationPlanExecutionStatus,
} from "../../../../Types/AutoRemediation/AiRemediationCommandPlan";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import PositiveNumber from "../../../../Types/PositiveNumber";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * Contract under test — the RemediationExecution runner (AI-composed
 * commands, auto-remediation Phase 3):
 *
 * - it only ever executes CommandPlan suggestions, for its own project,
 *   still in Planning — everything else finalizes or completes the run
 *   without touching the suggestion again (retries are idempotent);
 * - a retried run whose earlier attempt already executed commands (the
 *   durable commandPlan record proves it) settles what happened and NEVER
 *   re-runs the agent loop;
 * - the project gates (enableAi, enableAutoRemediation, and the strict
 *   opt-in enableAiCommandExecution === true) and the rule gates
 *   (exists, enabled, aiComposesCommands) are re-checked at execution time;
 * - FullAuto requires the rule to say FullAuto AND a non-empty operator
 *   allowlist AND breaker headroom — every other combination (including a
 *   failing breaker query) fails safe to Suggest, whose tools cannot
 *   execute anything;
 * - the run rides the shared engine under the persisted budget label
 *   "AI Remediation Execution" (pinned literal — a rename would hand every
 *   project a fresh daily budget);
 * - every settle path goes through the Planning CAS, and a lost CAS never
 *   posts a feed item.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const RUN_ID: ObjectID = new ObjectID("88888888-8888-4888-8888-888888888888");
const SUGGESTION_ID: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777777",
);
const RULE_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const RUNNER_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
);
const ALERT_ID: ObjectID = new ObjectID("dddddddd-dddd-4ddd-8ddd-dddddddddddd");

const ALLOWLIST: Array<string> = ["systemctl restart *", "systemctl status *"];

function fakeSuggestion(
  overrides: Partial<Record<string, unknown>> = {},
): AutoRemediationSuggestion {
  return {
    id: SUGGESTION_ID,
    _id: SUGGESTION_ID.toString(),
    projectId: PROJECT_ID,
    status: AutoRemediationSuggestionStatus.Planning,
    suggestionType: AutoRemediationSuggestionType.CommandPlan,
    incidentId: INCIDENT_ID,
    autoRemediationRuleId: RULE_ID,
    ruleNameSnapshot: "Restart the API service",
    ...overrides,
  } as unknown as AutoRemediationSuggestion;
}

function mockSuggestion(
  overrides: Partial<Record<string, unknown>> = {},
): void {
  jest
    .spyOn(AutoRemediationSuggestionService, "findOneById")
    .mockResolvedValue(fakeSuggestion(overrides));
}

function mockRule(overrides: Partial<Record<string, unknown>> = {}): void {
  jest.spyOn(AutoRemediationRuleService, "findOneById").mockResolvedValue({
    id: RULE_ID,
    _id: RULE_ID.toString(),
    isEnabled: true,
    aiComposesCommands: true,
    executionMode: AutoRemediationExecutionMode.Suggest,
    commandAllowlist: [],
    commandRunners: [],
    ...overrides,
  } as unknown as AutoRemediationRule);
}

function mockProject(overrides: Partial<Record<string, unknown>> = {}): void {
  jest.spyOn(ProjectService, "findOneById").mockResolvedValue({
    id: PROJECT_ID,
    enableAi: true,
    enableAutoRemediation: true,
    enableAiCommandExecution: true,
    ...overrides,
  } as unknown as Project);
}

function mockIncident(): void {
  jest.spyOn(IncidentService, "findOneById").mockResolvedValue({
    id: INCIDENT_ID,
    title: "API error rate is high",
    description: "5xx spike on checkout",
    incidentNumber: 42,
  } as unknown as Incident);
}

// The default happy path up to (and including) the engine hand-off.
function mockHappyPathLoads(): void {
  mockSuggestion();
  mockRule();
  mockProject();
  mockIncident();
  /*
   * No investigation has posted an analysis unless a test says otherwise —
   * the remediation rules fire during incident creation, when the
   * investigation has only just been enqueued.
   */
  jest.spyOn(PostedRootCause, "getForSubject").mockResolvedValue(null);
}

/*
 * Capture the engine request (persona, tools, context) so the tests can
 * assert what the run would actually be allowed to do — and can drive the
 * captured tools + postAnalysis manually to exercise the settle paths.
 */
function captureRequest(): { get: () => InvestigationRequest } {
  const captured: { value: InvestigationRequest | null } = { value: null };

  jest
    .spyOn(AIInvestigationEngine, "executeRun")
    .mockImplementation(
      async (data: {
        aiRunId: ObjectID;
        projectId: ObjectID;
        attemptCount: number;
        request: InvestigationRequest;
      }): Promise<void> => {
        captured.value = data.request;
      },
    );

  return {
    get: (): InvestigationRequest => {
      expect(captured.value).not.toBeNull();
      return captured.value!;
    },
  };
}

function toolNames(request: InvestigationRequest): Array<string> {
  return (request.extraTools || []).map(
    (tool: ObservabilityAssistantExtraTool) => {
      return tool.definition.name;
    },
  );
}

function findTool(
  request: InvestigationRequest,
  name: string,
): ObservabilityAssistantExtraTool {
  const tool: ObservabilityAssistantExtraTool | undefined = (
    request.extraTools || []
  ).find((candidate: ObservabilityAssistantExtraTool) => {
    return candidate.definition.name === name;
  });
  expect(tool).toBeDefined();
  return tool!;
}

function postAnalysisArgs(analysisMarkdown: string): {
  analysisMarkdown: string;
  confidence: ConfidenceSignal;
  result: ObservabilityAssistantResult;
} {
  return {
    analysisMarkdown,
    confidence: {
      confident: true,
      source: "classification",
    } as ConfidenceSignal,
    result: {} as ObservabilityAssistantResult,
  };
}

// A commandPlan column value proving an earlier attempt already executed.
function interruptedPlanJson(): JSONObject {
  return {
    commands: [
      {
        sequence: 1,
        stepType: "Bash",
        runnerId: RUNNER_ID.toString(),
        runnerNameSnapshot: "prod-runner",
        command: "systemctl restart api",
        timeoutInMs: 60000,
        rationale: "Restart the crashed service.",
        expectedEffect: "The service comes back.",
        policyVerdict: AiRemediationCommandPolicyVerdict.AutoApproved,
        wasAutoExecuted: true,
        execution: {
          status: AiRemediationCommandExecutionStatus.Succeeded,
          exitCode: 0,
        },
      },
    ],
  };
}

async function run(): Promise<void> {
  await RemediationExecutionRunner.executeRemediation({
    aiRunId: RUN_ID,
    projectId: PROJECT_ID,
    suggestionId: SUGGESTION_ID,
    attemptCount: 1,
  });
}

describe("RemediationExecutionRunner.executeRemediation", () => {
  let runCas: jest.SpyInstance;
  let suggestionCas: jest.SpyInstance;
  let incidentFeed: jest.SpyInstance;

  beforeEach(() => {
    runCas = jest
      .spyOn(AIRunService, "attemptStatusTransition")
      .mockResolvedValue(1 as never);
    suggestionCas = jest
      .spyOn(AutoRemediationSuggestionService, "attemptStatusTransition")
      .mockResolvedValue(1 as never);
    incidentFeed = jest
      .spyOn(IncidentFeedService, "createIncidentFeedItem")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(AlertFeedService, "createAlertFeedItem")
      .mockResolvedValue(undefined as never);
    jest.spyOn(logger, "debug").mockImplementation((): void => {
      return undefined;
    });
    jest.spyOn(logger, "warn").mockImplementation((): void => {
      return undefined;
    });
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("guard rails before anything runs", () => {
    it("finalizes the run as a permanent error when the suggestion was deleted", async () => {
      jest
        .spyOn(AutoRemediationSuggestionService, "findOneById")
        .mockResolvedValue(null);
      const executeRun: jest.SpyInstance = jest
        .spyOn(AIInvestigationEngine, "executeRun")
        .mockResolvedValue(undefined as never);

      await run();

      expect(executeRun).not.toHaveBeenCalled();
      expect(suggestionCas).not.toHaveBeenCalled();
      expect(incidentFeed).not.toHaveBeenCalled();
      expect(runCas).toHaveBeenCalledWith(
        expect.objectContaining({
          aiRunId: RUN_ID,
          fromStatus: AIRunStatus.Running,
          set: expect.objectContaining({
            status: AIRunStatus.Error,
            errorMessage: expect.stringContaining("not found"),
          }),
        }),
      );
    });

    it("finalizes the run as an error on a cross-project suggestion", async () => {
      mockSuggestion({
        projectId: new ObjectID("99999999-9999-4999-8999-999999999999"),
      });
      const executeRun: jest.SpyInstance = jest
        .spyOn(AIInvestigationEngine, "executeRun")
        .mockResolvedValue(undefined as never);

      await run();

      expect(executeRun).not.toHaveBeenCalled();
      expect(suggestionCas).not.toHaveBeenCalled();
      expect(runCas).toHaveBeenCalledWith(
        expect.objectContaining({
          set: expect.objectContaining({
            status: AIRunStatus.Error,
            errorMessage: expect.stringContaining(
              "does not belong to this run's project",
            ),
          }),
        }),
      );
    });

    it("finalizes the run as an error for a Runbook suggestion — wrong lane", async () => {
      mockSuggestion({
        suggestionType: AutoRemediationSuggestionType.Runbook,
      });
      const executeRun: jest.SpyInstance = jest
        .spyOn(AIInvestigationEngine, "executeRun")
        .mockResolvedValue(undefined as never);

      await run();

      expect(executeRun).not.toHaveBeenCalled();
      expect(runCas).toHaveBeenCalledWith(
        expect.objectContaining({
          set: expect.objectContaining({
            status: AIRunStatus.Error,
            errorMessage: expect.stringContaining("only executes CommandPlan"),
          }),
        }),
      );
    });

    it("is idempotent on retry: a suggestion no longer Planning completes the run without writes", async () => {
      mockSuggestion({
        status: AutoRemediationSuggestionStatus.Suggested,
      });
      const executeRun: jest.SpyInstance = jest
        .spyOn(AIInvestigationEngine, "executeRun")
        .mockResolvedValue(undefined as never);

      await run();

      expect(executeRun).not.toHaveBeenCalled();
      expect(suggestionCas).not.toHaveBeenCalled();
      expect(incidentFeed).not.toHaveBeenCalled();
      expect(runCas).toHaveBeenCalledWith(
        expect.objectContaining({
          aiRunId: RUN_ID,
          fromStatus: AIRunStatus.Running,
          set: expect.objectContaining({ status: AIRunStatus.Completed }),
        }),
      );
    });
  });

  describe("interrupted execution (persisted side effects from an earlier attempt)", () => {
    it("settles AutoExecuted with a verification window and never re-runs the agent", async () => {
      mockSuggestion({ commandPlan: interruptedPlanJson() });
      const executeRun: jest.SpyInstance = jest
        .spyOn(AIInvestigationEngine, "executeRun")
        .mockResolvedValue(undefined as never);

      await run();

      // Side-effect safety: the loop must NEVER run again.
      expect(executeRun).not.toHaveBeenCalled();

      expect(suggestionCas).toHaveBeenCalledWith(
        expect.objectContaining({
          suggestionId: SUGGESTION_ID,
          fromStatus: AutoRemediationSuggestionStatus.Planning,
          set: expect.objectContaining({
            status: AutoRemediationSuggestionStatus.AutoExecuted,
            verificationStatus: AutoRemediationVerificationStatus.Pending,
            verificationDeadlineAt: expect.any(Date),
            rationaleMarkdown: expect.stringContaining("interrupted"),
            commandPlan: expect.objectContaining({
              executionStatus: AiRemediationPlanExecutionStatus.Failed,
            }),
          }),
        }),
      );

      // The interruption is loud: humans must review what actually ran.
      expect(incidentFeed).toHaveBeenCalledWith(
        expect.objectContaining({
          incidentId: INCIDENT_ID,
          projectId: PROJECT_ID,
          feedInfoInMarkdown: expect.stringContaining("interrupted"),
          workspaceNotification: expect.objectContaining({
            sendWorkspaceNotification: true,
          }),
        }),
      );

      expect(runCas).toHaveBeenCalledWith(
        expect.objectContaining({
          set: expect.objectContaining({ status: AIRunStatus.Completed }),
        }),
      );
    });
  });

  describe("project gates re-checked at execution time", () => {
    function expectSettledNoneApplicable(rationaleFragment: string): void {
      expect(suggestionCas).toHaveBeenCalledWith(
        expect.objectContaining({
          suggestionId: SUGGESTION_ID,
          fromStatus: AutoRemediationSuggestionStatus.Planning,
          set: expect.objectContaining({
            status: AutoRemediationSuggestionStatus.NoneApplicable,
            rationaleMarkdown: expect.stringContaining(rationaleFragment),
          }),
        }),
      );
    }

    it("settles NoneApplicable when AI was disabled for the project", async () => {
      mockSuggestion();
      mockProject({ enableAi: false });
      const executeRun: jest.SpyInstance = jest
        .spyOn(AIInvestigationEngine, "executeRun")
        .mockResolvedValue(undefined as never);

      await run();

      expect(executeRun).not.toHaveBeenCalled();
      expectSettledNoneApplicable("AI or auto-remediation was disabled");
    });

    it("settles NoneApplicable when auto-remediation was disabled", async () => {
      mockSuggestion();
      mockProject({ enableAutoRemediation: false });
      const executeRun: jest.SpyInstance = jest
        .spyOn(AIInvestigationEngine, "executeRun")
        .mockResolvedValue(undefined as never);

      await run();

      expect(executeRun).not.toHaveBeenCalled();
      expectSettledNoneApplicable("AI or auto-remediation was disabled");
    });

    it("settles NoneApplicable when AI command execution is not explicitly opted in (=== true)", async () => {
      mockSuggestion();
      // undefined, not false — the opt-in must be an explicit true.
      mockProject({ enableAiCommandExecution: undefined });
      const executeRun: jest.SpyInstance = jest
        .spyOn(AIInvestigationEngine, "executeRun")
        .mockResolvedValue(undefined as never);

      await run();

      expect(executeRun).not.toHaveBeenCalled();
      expectSettledNoneApplicable("AI command execution is not enabled");
    });
  });

  describe("rule gates re-checked at execution time", () => {
    async function expectNoneApplicableWithoutEngine(): Promise<void> {
      const executeRun: jest.SpyInstance = jest
        .spyOn(AIInvestigationEngine, "executeRun")
        .mockResolvedValue(undefined as never);

      await run();

      expect(executeRun).not.toHaveBeenCalled();
      expect(suggestionCas).toHaveBeenCalledWith(
        expect.objectContaining({
          fromStatus: AutoRemediationSuggestionStatus.Planning,
          set: expect.objectContaining({
            status: AutoRemediationSuggestionStatus.NoneApplicable,
            rationaleMarkdown: expect.stringContaining(
              "deleted, disabled, or no longer composes commands",
            ),
          }),
        }),
      );
    }

    it("settles NoneApplicable when the rule was deleted", async () => {
      mockSuggestion();
      mockProject();
      jest
        .spyOn(AutoRemediationRuleService, "findOneById")
        .mockResolvedValue(null);

      await expectNoneApplicableWithoutEngine();
    });

    it("settles NoneApplicable when the rule was disabled", async () => {
      mockSuggestion();
      mockProject();
      mockRule({ isEnabled: false });

      await expectNoneApplicableWithoutEngine();
    });

    it("settles NoneApplicable when the rule no longer composes commands", async () => {
      mockSuggestion();
      mockProject();
      mockRule({ aiComposesCommands: false });

      await expectNoneApplicableWithoutEngine();
    });
  });

  describe("mode resolution — what the run is allowed to do", () => {
    it("runs Suggest with the propose tools and the approval-framed persona", async () => {
      mockHappyPathLoads();
      const request: { get: () => InvestigationRequest } = captureRequest();

      await run();

      expect(toolNames(request.get())).toEqual([
        "list_command_targets",
        "propose_remediation_commands",
      ]);
      // The persona must make clear NOTHING executes without a human.
      expect(request.get().personaOverride).toContain(
        "a human will approve with one click",
      );
      // Persisted budget-ledger string — pinned as a literal on purpose.
      expect(request.get().feature).toBe("AI Remediation Execution");
      expect(request.get().incidentId).toBe(INCIDENT_ID);
      expect(request.get().alertId).toBeUndefined();
    });

    it("runs FullAuto with the execute tool and the allowlist in context when every condition holds", async () => {
      mockHappyPathLoads();
      mockRule({
        executionMode: AutoRemediationExecutionMode.FullAuto,
        commandAllowlist: ALLOWLIST,
      });
      jest
        .spyOn(AutoRemediationSuggestionService, "countBy")
        .mockResolvedValue(new PositiveNumber(0));
      const request: { get: () => InvestigationRequest } = captureRequest();

      await run();

      expect(toolNames(request.get())).toEqual([
        "list_command_targets",
        "execute_remediation_command",
      ]);
      expect(request.get().personaOverride).toContain(
        "FullAuto command execution",
      );
      expect(request.get().contextSummary).toContain(
        "# Commands you may auto-execute",
      );
      expect(request.get().contextSummary).toContain("systemctl restart *");
    });

    it("downgrades FullAuto to Suggest when the allowlist is empty — without even querying the breaker", async () => {
      mockHappyPathLoads();
      mockRule({
        executionMode: AutoRemediationExecutionMode.FullAuto,
        commandAllowlist: [],
      });
      const countBy: jest.SpyInstance = jest
        .spyOn(AutoRemediationSuggestionService, "countBy")
        .mockResolvedValue(new PositiveNumber(0));
      const request: { get: () => InvestigationRequest } = captureRequest();

      await run();

      expect(countBy).not.toHaveBeenCalled();
      expect(toolNames(request.get())).toContain(
        "propose_remediation_commands",
      );
      expect(toolNames(request.get())).not.toContain(
        "execute_remediation_command",
      );
    });

    it("downgrades to Suggest when the hourly circuit breaker is at its limit", async () => {
      mockHappyPathLoads();
      mockRule({
        executionMode: AutoRemediationExecutionMode.FullAuto,
        commandAllowlist: ALLOWLIST,
      });
      jest
        .spyOn(AutoRemediationSuggestionService, "countBy")
        .mockResolvedValue(
          new PositiveNumber(MAX_AUTO_EXECUTIONS_PER_RULE_PER_HOUR),
        );
      const request: { get: () => InvestigationRequest } = captureRequest();

      await run();

      expect(toolNames(request.get())).not.toContain(
        "execute_remediation_command",
      );
    });

    it("fails safe to Suggest when the breaker query itself throws", async () => {
      mockHappyPathLoads();
      mockRule({
        executionMode: AutoRemediationExecutionMode.FullAuto,
        commandAllowlist: ALLOWLIST,
      });
      jest
        .spyOn(AutoRemediationSuggestionService, "countBy")
        .mockRejectedValue(new Error("db down"));
      const request: { get: () => InvestigationRequest } = captureRequest();

      await run();

      expect(toolNames(request.get())).not.toContain(
        "execute_remediation_command",
      );
      expect(toolNames(request.get())).toContain(
        "propose_remediation_commands",
      );
    });
  });

  describe("settle after the run (Suggest mode, driven through the captured tools)", () => {
    it("settles NoneApplicable with the analysis as rationale when the model proposes nothing", async () => {
      mockHappyPathLoads();
      jest
        .spyOn(AIInvestigationEngine, "executeRun")
        .mockImplementation(
          async (data: {
            aiRunId: ObjectID;
            projectId: ObjectID;
            attemptCount: number;
            request: InvestigationRequest;
          }): Promise<void> => {
            await data.request.postAnalysis(
              postAnalysisArgs("No safe command plan exists for this signal."),
            );
          },
        );

      await run();

      expect(suggestionCas).toHaveBeenCalledWith(
        expect.objectContaining({
          suggestionId: SUGGESTION_ID,
          fromStatus: AutoRemediationSuggestionStatus.Planning,
          set: expect.objectContaining({
            status: AutoRemediationSuggestionStatus.NoneApplicable,
            rationaleMarkdown: expect.stringContaining(
              "No safe command plan exists",
            ),
          }),
        }),
      );
      // NoneApplicable is quiet — no workspace ping.
      expect(incidentFeed).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceNotification: expect.objectContaining({
            sendWorkspaceNotification: false,
          }),
        }),
      );
    });

    it("settles Suggested with the recorded plan when the model proposes valid commands", async () => {
      mockHappyPathLoads();
      // The propose tool validates the Runner reference for real.
      jest.spyOn(RunnerService, "findOneBy").mockResolvedValue({
        id: RUNNER_ID,
        _id: RUNNER_ID.toString(),
        name: "prod-runner",
      } as unknown as Runner);

      jest
        .spyOn(AIInvestigationEngine, "executeRun")
        .mockImplementation(
          async (data: {
            aiRunId: ObjectID;
            projectId: ObjectID;
            attemptCount: number;
            request: InvestigationRequest;
          }): Promise<void> => {
            const propose: ObservabilityAssistantExtraTool = findTool(
              data.request,
              "propose_remediation_commands",
            );
            const outcome: ToolCallOutcome = await propose.execute({
              commands: [
                {
                  runnerId: RUNNER_ID.toString(),
                  stepType: "Bash",
                  command: "systemctl restart api",
                  rationale: "The api service is crash-looping.",
                  expectedEffect: "The service restarts and 5xx stops.",
                },
              ],
            });
            expect(outcome.success).toBe(true);
            await data.request.postAnalysis(
              postAnalysisArgs("Restarting the api service fixes the cause."),
            );
          },
        );

      await run();

      expect(suggestionCas).toHaveBeenCalledWith(
        expect.objectContaining({
          suggestionId: SUGGESTION_ID,
          fromStatus: AutoRemediationSuggestionStatus.Planning,
          set: expect.objectContaining({
            status: AutoRemediationSuggestionStatus.Suggested,
            rationaleMarkdown: expect.stringContaining(
              "Restarting the api service",
            ),
            commandPlan: expect.objectContaining({
              executionStatus: AiRemediationPlanExecutionStatus.NotStarted,
              commands: [
                expect.objectContaining({
                  sequence: 1,
                  command: "systemctl restart api",
                  runnerId: RUNNER_ID.toString(),
                  runnerNameSnapshot: "prod-runner",
                  policyVerdict:
                    AiRemediationCommandPolicyVerdict.RequiresApproval,
                }),
              ],
            }),
          }),
        }),
      );

      // A plan awaiting approval pings the workspace.
      expect(incidentFeed).toHaveBeenCalledWith(
        expect.objectContaining({
          incidentId: INCIDENT_ID,
          workspaceNotification: expect.objectContaining({
            sendWorkspaceNotification: true,
          }),
        }),
      );
    });

    it("skips the feed item when the settle CAS loses the race", async () => {
      mockHappyPathLoads();
      jest
        .spyOn(AutoRemediationSuggestionService, "attemptStatusTransition")
        .mockResolvedValue(0 as never);
      jest
        .spyOn(AIInvestigationEngine, "executeRun")
        .mockImplementation(
          async (data: {
            aiRunId: ObjectID;
            projectId: ObjectID;
            attemptCount: number;
            request: InvestigationRequest;
          }): Promise<void> => {
            await data.request.postAnalysis(postAnalysisArgs("Nothing safe."));
          },
        );

      await run();

      expect(incidentFeed).not.toHaveBeenCalled();
    });
  });

  describe("engine context — the brief the model reasons from", () => {
    it("frames the incident text as untrusted data", async () => {
      mockHappyPathLoads();
      const request: { get: () => InvestigationRequest } = captureRequest();

      await run();

      expect(request.get().contextSummary).toContain(
        '<untrusted_context source="incident_text">',
      );
      expect(request.get().contextSummary).toContain("API error rate is high");
      expect(request.get().contextSummary).toContain(
        "Matched auto-remediation rule: Restart the API service",
      );
    });

    it("includes the posted root cause analysis, framed as untrusted, when one exists", async () => {
      mockHappyPathLoads();
      jest
        .spyOn(PostedRootCause, "getForSubject")
        .mockResolvedValue(
          "The checkout pods are OOMKilled after the 14:02 deploy.",
        );
      const request: { get: () => InvestigationRequest } = captureRequest();

      await run();

      expect(request.get().contextSummary).toContain(
        "Root cause analysis already posted for this signal",
      );
      expect(request.get().contextSummary).toContain(
        "OOMKilled after the 14:02 deploy",
      );
      expect(request.get().contextSummary).toContain(
        '<untrusted_context source="investigation_analysis">',
      );
    });

    it("briefs an alert-based suggestion from the alert and settles onto the alert feed", async () => {
      mockSuggestion({ incidentId: undefined, alertId: ALERT_ID });
      mockRule();
      mockProject();
      jest.spyOn(PostedRootCause, "getForSubject").mockResolvedValue(null);
      jest.spyOn(AlertService, "findOneById").mockResolvedValue({
        id: ALERT_ID,
        title: "Disk almost full on db-1",
        alertNumber: 7,
      } as unknown as Alert);
      const alertFeed: jest.SpyInstance = jest
        .spyOn(AlertFeedService, "createAlertFeedItem")
        .mockResolvedValue(undefined as never);

      let captured: InvestigationRequest | null = null;
      jest
        .spyOn(AIInvestigationEngine, "executeRun")
        .mockImplementation(
          async (data: {
            aiRunId: ObjectID;
            projectId: ObjectID;
            attemptCount: number;
            request: InvestigationRequest;
          }): Promise<void> => {
            captured = data.request;
            await data.request.postAnalysis(
              postAnalysisArgs("Nothing safe to run."),
            );
          },
        );

      await run();

      expect(captured!.contextSummary).toContain(
        '<untrusted_context source="alert_text">',
      );
      expect(captured!.contextSummary).toContain("Disk almost full on db-1");
      expect(captured!.incidentId).toBeUndefined();
      expect(captured!.alertId).toBe(ALERT_ID);
      expect(incidentFeed).not.toHaveBeenCalled();
      expect(alertFeed).toHaveBeenCalledWith(
        expect.objectContaining({
          alertId: ALERT_ID,
          projectId: PROJECT_ID,
        }),
      );
    });

    it("degrades gracefully when the posted-analysis lookup fails — the run still executes", async () => {
      mockHappyPathLoads();
      jest
        .spyOn(PostedRootCause, "getForSubject")
        .mockRejectedValue(new Error("feed unavailable"));
      const request: { get: () => InvestigationRequest } = captureRequest();

      await run();

      // A missing analysis must never strand the suggestion in Planning.
      expect(request.get().contextSummary).toContain("API error rate is high");
      expect(request.get().contextSummary).not.toContain(
        "investigation_analysis",
      );
    });
  });
});
