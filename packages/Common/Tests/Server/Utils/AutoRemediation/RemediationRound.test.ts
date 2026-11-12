import RemediationRound, {
  countRoundOtherChecks,
  getRoundAppliedSteps,
  getRoundChecks,
  getRoundExplanation,
  getRoundTryAgainRefusal,
  getTokenLimitRefusal,
  toLifecycleEventsJson,
  toRoundRunJson,
} from "../../../../Server/Utils/AutoRemediation/RemediationRound";
import { AutonomousBudgetStatus } from "../../../../Server/Services/AIService";
import AIInvestigationEngine from "../../../../Server/Utils/AI/SRE/AIInvestigationEngine";
import AIInvestigationQueue from "../../../../Server/Utils/AI/SRE/InvestigationQueue";
import AIRunEventService from "../../../../Server/Services/AIRunEventService";
import AIRunService from "../../../../Server/Services/AIRunService";
import AlertFeedService from "../../../../Server/Services/AlertFeedService";
import AlertService from "../../../../Server/Services/AlertService";
import AutoRemediationSuggestionService from "../../../../Server/Services/AutoRemediationSuggestionService";
import IncidentFeedService from "../../../../Server/Services/IncidentFeedService";
import IncidentService from "../../../../Server/Services/IncidentService";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import AIRunEvent from "../../../../Models/DatabaseModels/AIRunEvent";
import Alert from "../../../../Models/DatabaseModels/Alert";
import AutoRemediationSuggestion from "../../../../Models/DatabaseModels/AutoRemediationSuggestion";
import Incident from "../../../../Models/DatabaseModels/Incident";
import AIRunEventType from "../../../../Types/AI/AIRunEventType";
import AIRunStatus from "../../../../Types/AI/AIRunStatus";
import AIRunType from "../../../../Types/AI/AIRunType";
import { AIRunEventResultSummary } from "../../../../Types/AI/AIChatTypes";
import { InvestigationNotStartedCode } from "../../../../Types/AI/InvestigationNotStartedReason";
import AutoRemediationSuggestionStatus from "../../../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import AutoRemediationSuggestionType from "../../../../Types/AutoRemediation/AutoRemediationSuggestionType";
import {
  EXPLAIN_NO_FIX_TOOL_NAME,
  MAX_ROUND_CHECKS,
  REMEDIATION_ROUND_TRY_AGAIN_NOT_ALLOWED,
  REMEDIATION_ROUND_TRY_AGAIN_REFUSALS,
  RemediationRoundAppliedSteps,
  RemediationRoundCheck,
  RemediationRoundTryAgainRefusal,
} from "../../../../Types/AutoRemediation/RemediationRound";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import BadDataException from "../../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import { JSONArray, JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * A ROUND OF AN AI FIX: WHAT IT DID, AND TRYING IT AGAIN (issues #6436,
 * #6487).
 *
 * "We have things like no safe fix found, but it doesn't tell me anything
 * about why? ... What commands did you run to find a fix that wasn't
 * safe." The Remediation step reads a fix's round - its run, how its
 * attempts ended, the commands it checked with, and the AI's own
 * explanation - and a person who may change the incident or alert starts a
 * round that did not finish again. Pinned here: what leaves the server (and
 * what never does), each refusal word for word, that a round which changed
 * something is never started from the top, and that of two presses at once
 * one starts it.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "12121212-1212-4121-8121-121212121212",
);
const SUGGESTION_ID: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777777",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
);
const ALERT_ID: ObjectID = new ObjectID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
const OLD_RUN_ID: ObjectID = new ObjectID(
  "88888888-8888-4888-8888-888888888888",
);
const USER_ID: ObjectID = new ObjectID("55555555-5555-4555-8555-555555555555");
const PROVIDER_ID: ObjectID = new ObjectID(
  "66666666-6666-4666-8666-666666666666",
);
const CLUSTER_ID: ObjectID = new ObjectID(
  "99999999-9999-4999-8999-999999999999",
);
const RUNNER_ID: string = "44444444-4444-4444-8444-444444444444";

const viewerProps: DatabaseCommonInteractionProps = {
  userId: USER_ID,
  tenantId: PROJECT_ID,
  isMultiTenantRequest: false,
} as unknown as DatabaseCommonInteractionProps;

function refusalOf(refusal: RemediationRoundTryAgainRefusal): string {
  return REMEDIATION_ROUND_TRY_AGAIN_REFUSALS[refusal];
}

function fakeSuggestion(
  overrides: Partial<Record<string, unknown>> = {},
): AutoRemediationSuggestion {
  return {
    id: SUGGESTION_ID,
    _id: SUGGESTION_ID.toString(),
    projectId: PROJECT_ID,
    status: AutoRemediationSuggestionStatus.NoneApplicable,
    suggestionType: AutoRemediationSuggestionType.CommandPlan,
    aiRunId: OLD_RUN_ID,
    incidentId: INCIDENT_ID,
    kubernetesClusterId: CLUSTER_ID,
    ruleNameSnapshot: 'AI kubectl fix for cluster "prod-us"',
    rationaleMarkdown:
      "The AI fix did not finish — the planning run failed. Nothing was run or proposed.",
    ...overrides,
  } as unknown as AutoRemediationSuggestion;
}

function fakeRun(overrides: Partial<Record<string, unknown>> = {}): AIRun {
  const run: AIRun = new AIRun();
  run.id = OLD_RUN_ID;
  run.projectId = PROJECT_ID;
  run.runType = AIRunType.RemediationExecution;
  run.status = AIRunStatus.Error;
  run.llmProviderId = PROVIDER_ID;
  run.errorMessage = "The model provider did not answer in time.";
  run.createdAt = new Date("2026-11-09T10:00:00.000Z");
  run.startedAt = new Date("2026-11-09T10:00:05.000Z");
  run.completedAt = new Date("2026-11-09T10:04:00.000Z");
  Object.assign(run, overrides);
  return run;
}

let nextSequence: number = 1;

function event(data: {
  eventType: AIRunEventType;
  toolName?: string | undefined;
  toolArguments?: JSONObject | undefined;
  resultSummary?: AIRunEventResultSummary | undefined;
  citationId?: string | undefined;
  createdAt?: Date | undefined;
}): AIRunEvent {
  const runEvent: AIRunEvent = new AIRunEvent();
  runEvent.sequence = nextSequence++;
  runEvent.eventType = data.eventType;
  if (data.toolName !== undefined) {
    runEvent.toolName = data.toolName;
  }
  if (data.toolArguments !== undefined) {
    runEvent.toolArguments = data.toolArguments;
  }
  if (data.resultSummary !== undefined) {
    runEvent.resultSummary = data.resultSummary;
  }
  if (data.citationId !== undefined) {
    runEvent.citationId = data.citationId;
  }
  runEvent.createdAt =
    data.createdAt || new Date(Date.UTC(2026, 10, 9, 10, 0, nextSequence));
  return runEvent;
}

function started(
  toolName: string,
  command: string | undefined,
  rationale?: string,
): AIRunEvent {
  return event({
    eventType: AIRunEventType.ToolCallStarted,
    toolName,
    toolArguments: {
      ...(command !== undefined ? { command } : {}),
      ...(rationale !== undefined ? { rationale } : {}),
    },
  });
}

function completed(
  toolName: string,
  summary: AIRunEventResultSummary = { rowCount: 1 },
  toolArguments?: JSONObject,
): AIRunEvent {
  return event({
    eventType: AIRunEventType.ToolCallCompleted,
    toolName,
    resultSummary: summary,
    ...(toolArguments ? { toolArguments } : {}),
  });
}

function failed(toolName: string, errorMessage: string): AIRunEvent {
  return event({
    eventType: AIRunEventType.ToolCallFailed,
    toolName,
    resultSummary: { errorMessage },
  });
}

function lifecycle(eventType: AIRunEventType): AIRunEvent {
  return event({ eventType });
}

function bashCommand(
  sequence: number,
  executed: boolean,
): Record<string, unknown> {
  return {
    sequence,
    stepType: "Bash",
    command: `systemctl restart web-${sequence}`,
    runnerId: RUNNER_ID,
    policyVerdict: "RequiresApproval",
    rationale: "restart the service",
    ...(executed ? { execution: { status: "Succeeded" } } : {}),
  };
}

function mcpCall(sequence: number, status: string): Record<string, unknown> {
  return {
    sequence,
    serverId: "aws",
    serverNameSnapshot: "AWS",
    toolName: "ecs_update_service",
    arguments: { service: "web" },
    status,
  };
}

const NOTHING_APPLIED: RemediationRoundAppliedSteps = {
  commandCount: 0,
  changeCount: 0,
  isRunbookStarted: false,
};

describe("getRoundAppliedSteps: what a round already did, from what it recorded before acting", () => {
  it("a round that recorded nothing applied nothing", () => {
    expect(getRoundAppliedSteps(fakeSuggestion())).toEqual(NOTHING_APPLIED);
  });

  it("counts only the commands with an execution: a command is recorded before it runs", () => {
    expect(
      getRoundAppliedSteps(
        fakeSuggestion({
          commandPlan: {
            commands: [
              bashCommand(1, true),
              bashCommand(2, false),
              bashCommand(3, true),
            ],
          },
        }),
      ),
    ).toEqual({ ...NOTHING_APPLIED, commandCount: 2 });
  });

  it("a plan that only proposes commands applied nothing", () => {
    expect(
      getRoundAppliedSteps(
        fakeSuggestion({
          commandPlan: { commands: [bashCommand(1, false)] },
        }),
      ),
    ).toEqual(NOTHING_APPLIED);
  });

  it("counts the MCP changes that were sent - running, answered or failed - never the proposed or skipped", () => {
    expect(
      getRoundAppliedSteps(
        fakeSuggestion({
          suggestionType: AutoRemediationSuggestionType.McpToolCalls,
          mcpToolCallPlan: {
            calls: [
              mcpCall(1, "Proposed"),
              mcpCall(2, "Running"),
              mcpCall(3, "Succeeded"),
              mcpCall(4, "Failed"),
              mcpCall(5, "Skipped"),
            ],
          },
        }),
      ),
    ).toEqual({ ...NOTHING_APPLIED, changeCount: 3 });
  });

  it("a runbook it started is applied", () => {
    expect(
      getRoundAppliedSteps(
        fakeSuggestion({
          suggestionType: AutoRemediationSuggestionType.Runbook,
          runbookExecutionId: OLD_RUN_ID,
        }),
      ),
    ).toEqual({ ...NOTHING_APPLIED, isRunbookStarted: true });
  });

  it("plans this build cannot read count as nothing", () => {
    expect(
      getRoundAppliedSteps(
        fakeSuggestion({
          commandPlan: { commands: "not a list" },
          mcpToolCallPlan: { calls: null },
        }),
      ),
    ).toEqual(NOTHING_APPLIED);
  });
});

describe("getRoundTryAgainRefusal: which rounds start again", () => {
  function refusal(data: {
    suggestion?: Partial<Record<string, unknown>>;
    run?: AIRunStatus | null;
    applied?: Partial<RemediationRoundAppliedSteps>;
  }): RemediationRoundTryAgainRefusal | null {
    return getRoundTryAgainRefusal({
      suggestion: fakeSuggestion(data.suggestion || {}),
      run:
        data.run === null
          ? null
          : ({ status: data.run || AIRunStatus.Error } as AIRun),
      appliedSteps: { ...NOTHING_APPLIED, ...(data.applied || {}) },
    });
  }

  it.each([AIRunStatus.Error, AIRunStatus.Stale, AIRunStatus.Cancelled])(
    "a round whose run is %s and that found no fix starts again",
    (status: AIRunStatus) => {
      expect(refusal({ run: status })).toBeNull();
    },
  );

  it("a round still marked Planning whose run is over (before the sweep settles it) starts again", () => {
    expect(
      refusal({
        suggestion: { status: AutoRemediationSuggestionStatus.Planning },
        run: AIRunStatus.Stale,
      }),
    ).toBeNull();
  });

  it("a round whose run is gone starts again", () => {
    expect(refusal({ run: null })).toBeNull();
  });

  it("a fix no AI run worked out (a runbook a rule names) has no round", () => {
    expect(
      refusal({
        suggestion: { aiRunId: undefined },
        run: AIRunStatus.Error,
      }),
    ).toBe(RemediationRoundTryAgainRefusal.NoRound);
  });

  it.each([
    AIRunStatus.Queued,
    AIRunStatus.Running,
    AIRunStatus.WaitingForApproval,
  ])(
    "a round whose run is %s is still being worked on",
    (status: AIRunStatus) => {
      expect(refusal({ run: status })).toBe(
        RemediationRoundTryAgainRefusal.StillWorking,
      );
    },
  );

  it.each([AIRunStatus.Completed, AIRunStatus.NoFixFound])(
    "a round whose run is %s finished: what it found stands",
    (status: AIRunStatus) => {
      expect(refusal({ run: status })).toBe(
        RemediationRoundTryAgainRefusal.Finished,
      );
    },
  );

  it.each([
    ["a command it ran", { commandCount: 1 }],
    ["a change it sent through an MCP server", { changeCount: 1 }],
    ["a runbook it started", { isRunbookStarted: true }],
  ])(
    "a round that recorded %s is never started again from the top",
    (_label: string, applied: Partial<RemediationRoundAppliedSteps>) => {
      expect(refusal({ run: AIRunStatus.Error, applied })).toBe(
        RemediationRoundTryAgainRefusal.PartlyApplied,
      );
      // Whatever it says now: an interrupted run settled as made, too.
      expect(
        refusal({
          suggestion: {
            status: AutoRemediationSuggestionStatus.AutoExecuted,
          },
          run: AIRunStatus.Stale,
          applied,
        }),
      ).toBe(RemediationRoundTryAgainRefusal.PartlyApplied);
      expect(refusal({ run: null, applied })).toBe(
        RemediationRoundTryAgainRefusal.PartlyApplied,
      );
    },
  );

  it.each([
    AutoRemediationSuggestionStatus.Suggested,
    AutoRemediationSuggestionStatus.Approved,
    AutoRemediationSuggestionStatus.AutoExecuted,
    AutoRemediationSuggestionStatus.Dismissed,
  ])(
    "a round that says %s got its answer, even if its run then failed",
    (status: AutoRemediationSuggestionStatus) => {
      expect(refusal({ suggestion: { status }, run: AIRunStatus.Error })).toBe(
        RemediationRoundTryAgainRefusal.Finished,
      );
    },
  );
});

describe("getRoundChecks: the commands a round ran to check, and how each went", () => {
  beforeEach(() => {
    nextSequence = 1;
  });

  it("pairs each kubectl command with its end: ran, or answered with an error", () => {
    const checks: Array<RemediationRoundCheck> = getRoundChecks({
      events: [
        lifecycle(AIRunEventType.RunStarted),
        started(
          "run_kubectl",
          "kubectl get pods -n shop",
          "See which pods are failing.",
        ),
        completed("run_kubectl", { rowCount: 1 }),
        started("run_kubectl", "kubectl describe pod web-0 -n shop"),
        // kubectl answered with an error (KubectlInvestigationToolkit).
        completed("run_kubectl", { rowCount: 0 }),
      ],
      isRunOver: true,
    });

    expect(
      checks.map((check: RemediationRoundCheck): [string, string, string] => {
        return [check.command, check.status, check.why];
      }),
    ).toEqual([
      ["kubectl get pods -n shop", "ran", "See which pods are failing."],
      ["kubectl describe pod web-0 -n shop", "failed", ""],
    ]);
    expect(checks[0]!.at).toBe(
      new Date(Date.UTC(2026, 10, 9, 10, 0, 3)).toISOString(),
    );
  });

  it("an infrastructure command that completed ran, whatever its row count", () => {
    const checks: Array<RemediationRoundCheck> = getRoundChecks({
      events: [
        started("run_infrastructure_command", "docker ps -a"),
        completed("run_infrastructure_command", { rowCount: 0 }),
      ],
      isRunOver: true,
    });

    expect(checks).toHaveLength(1);
    expect(checks[0]!.status).toBe("ran");
  });

  it("a command whose result never came back is unknown - it may have run - and says why", () => {
    const checks: Array<RemediationRoundCheck> = getRoundChecks({
      events: [
        started("run_kubectl", "kubectl get nodes"),
        failed(
          "run_kubectl",
          "kubectl result unknown: the Runner took the command but its result never came back.",
        ),
        started("run_infrastructure_command", "docker inspect web"),
        failed(
          "run_infrastructure_command",
          "infrastructure command result unknown: the agent took the command but its result never came back.",
        ),
      ],
      isRunOver: true,
    });

    expect(
      checks.map((check: RemediationRoundCheck): string => {
        return check.status;
      }),
    ).toEqual(["unknown", "unknown"]);
    expect(checks[0]!.error).toBe(
      "kubectl result unknown: the Runner took the command but its result never came back.",
    );
  });

  it("a command that could not run failed, with what went wrong", () => {
    const checks: Array<RemediationRoundCheck> = getRoundChecks({
      events: [
        started("run_kubectl", "kubectl delete pod web-0"),
        failed("run_kubectl", "This command changes the cluster; reads only."),
      ],
      isRunOver: true,
    });

    expect(checks[0]).toMatchObject({
      command: "kubectl delete pod web-0",
      status: "failed",
      error: "This command changes the cluster; reads only.",
    });
  });

  it("a command with no end is running while the run is, and stopped once it is over", () => {
    const events: Array<AIRunEvent> = [
      started("run_kubectl", "kubectl logs web-0 -n shop"),
    ];

    expect(getRoundChecks({ events, isRunOver: false })[0]!.status).toBe(
      "running",
    );
    expect(getRoundChecks({ events, isRunOver: true })[0]!.status).toBe(
      "stopped",
    );
  });

  it("a command left open when its attempt ended stopped; the next attempt's commands are listed after it", () => {
    const checks: Array<RemediationRoundCheck> = getRoundChecks({
      events: [
        lifecycle(AIRunEventType.RunStarted),
        started("run_kubectl", "kubectl get pods"),
        lifecycle(AIRunEventType.AttemptEnded),
        lifecycle(AIRunEventType.RunStarted),
        started("run_kubectl", "kubectl get pods"),
        completed("run_kubectl"),
        started("run_kubectl", "kubectl top pods"),
        lifecycle(AIRunEventType.RunFailed),
      ],
      isRunOver: true,
    });

    expect(
      checks.map((check: RemediationRoundCheck): string => {
        return `${check.command}: ${check.status}`;
      }),
    ).toEqual([
      "kubectl get pods: stopped",
      "kubectl get pods: ran",
      "kubectl top pods: stopped",
    ]);
  });

  it("a command started while another had no end leaves the other stopped", () => {
    const checks: Array<RemediationRoundCheck> = getRoundChecks({
      events: [
        started("run_kubectl", "kubectl get pods"),
        started("run_kubectl", "kubectl get events"),
        completed("run_kubectl"),
      ],
      isRunOver: true,
    });

    expect(
      checks.map((check: RemediationRoundCheck): string => {
        return check.status;
      }),
    ).toEqual(["stopped", "ran"]);
  });

  it("an end of another tool never ends the open command", () => {
    const checks: Array<RemediationRoundCheck> = getRoundChecks({
      events: [
        started("run_kubectl", "kubectl get pods"),
        completed("run_infrastructure_command"),
        failed("run_infrastructure_command", "unreachable"),
      ],
      isRunOver: false,
    });

    expect(checks[0]!.status).toBe("running");
  });

  it("lists only commands: telemetry reads, its own tools and calls without a command are left out", () => {
    const checks: Array<RemediationRoundCheck> = getRoundChecks({
      events: [
        started("query_logs", "not a command"),
        completed("query_logs"),
        started("list_cluster_access", undefined),
        completed("list_cluster_access"),
        started(EXPLAIN_NO_FIX_TOOL_NAME, undefined),
        completed(EXPLAIN_NO_FIX_TOOL_NAME),
        started("run_kubectl", undefined),
        completed("run_kubectl"),
        started("run_kubectl", "   "),
        started("run_kubectl", "kubectl get deploy"),
        completed("run_kubectl"),
      ],
      isRunOver: true,
    });

    expect(
      checks.map((check: RemediationRoundCheck): string => {
        return check.command;
      }),
    ).toEqual(["kubectl get deploy"]);
  });

  it("clips the command, its reason and its error, folding whitespace", () => {
    const checks: Array<RemediationRoundCheck> = getRoundChecks({
      events: [
        started(
          "run_kubectl",
          `kubectl get pods\n   -l ${"a".repeat(400)}`,
          `Check ${"why ".repeat(100)}`,
        ),
        failed("run_kubectl", `boom ${"x".repeat(400)}`),
      ],
      isRunOver: true,
    });

    expect(checks[0]!.command.startsWith("kubectl get pods -l aaa")).toBe(true);
    expect(checks[0]!.command.length).toBeLessThanOrEqual(300);
    expect(checks[0]!.command.endsWith("…")).toBe(true);
    expect(checks[0]!.why.length).toBeLessThanOrEqual(200);
    expect(checks[0]!.error.length).toBeLessThanOrEqual(300);
  });

  it(`lists the last ${MAX_ROUND_CHECKS} commands of a long round, in order`, () => {
    const events: Array<AIRunEvent> = [];

    for (let index: number = 1; index <= MAX_ROUND_CHECKS + 7; index++) {
      events.push(started("run_kubectl", `kubectl get pod web-${index}`));
      events.push(completed("run_kubectl"));
    }

    const checks: Array<RemediationRoundCheck> = getRoundChecks({
      events,
      isRunOver: true,
    });

    expect(checks).toHaveLength(MAX_ROUND_CHECKS);
    expect(checks[0]!.command).toBe("kubectl get pod web-8");
    expect(checks[MAX_ROUND_CHECKS - 1]!.command).toBe(
      `kubectl get pod web-${MAX_ROUND_CHECKS + 7}`,
    );
  });

  it("a round with no events checked nothing", () => {
    expect(getRoundChecks({ events: [], isRunOver: true })).toEqual([]);
  });
});

describe("countRoundOtherChecks: the telemetry a round queried", () => {
  it("counts each completed call of a tool that is not the round's own", () => {
    expect(
      countRoundOtherChecks([
        started("query_logs", undefined),
        completed("query_logs"),
        completed("query_metrics"),
        completed("query_traces", { rowCount: 0 }),
        failed("query_logs", "timed out"),
        completed("run_kubectl"),
        completed("run_infrastructure_command"),
        completed(EXPLAIN_NO_FIX_TOOL_NAME),
        completed("propose_remediation_commands"),
        completed("execute_remediation_command"),
        completed("roll_back_change"),
        completed("list_command_targets"),
        completed("list_cluster_access"),
        completed("list_infrastructure_access"),
        completed("read_tool_output"),
        lifecycle(AIRunEventType.RunCompleted),
      ]),
    ).toBe(3);
  });

  it("a completion without a tool name is no check", () => {
    expect(
      countRoundOtherChecks([
        event({ eventType: AIRunEventType.ToolCallCompleted }),
      ]),
    ).toBe(0);
  });

  /*
   * An external MCP server is another system, never the project's
   * telemetry - and a fix through MCP servers proposes and makes its
   * changes with call_mcp_tool: "It also queried the project's telemetry
   * 3 times" said that of the changes it proposed.
   */
  it("a call to the project's MCP servers is not a telemetry query", () => {
    expect(
      countRoundOtherChecks([
        completed("list_mcp_tools"),
        completed("call_mcp_tool"),
        completed("call_mcp_tool"),
        completed("query_logs"),
      ]),
    ).toBe(1);
  });
});

describe("getRoundExplanation: why the AI found no fix, in its own words", () => {
  it("reads the arguments of its last explain_no_fix call that went through", () => {
    expect(
      getRoundExplanation([
        completed(
          EXPLAIN_NO_FIX_TOOL_NAME,
          { rowCount: 0 },
          { reason: "An earlier try." },
        ),
        completed(
          EXPLAIN_NO_FIX_TOOL_NAME,
          { rowCount: 1 },
          {
            reason:
              "The pods are OOM-killed; raising the limit changes the Deployment, which only a person may approve here.",
            ruledOutFixes: [
              {
                fix: "Raise the memory limit of deployment web to 1Gi",
                commands: [
                  "kubectl set resources deployment web --limits=memory=1Gi",
                ],
                whyNot: "Not allowed here: it changes the Deployment.",
              },
            ],
          },
        ),
        failed(EXPLAIN_NO_FIX_TOOL_NAME, "needs a reason"),
      ]),
    ).toEqual({
      reason:
        "The pods are OOM-killed; raising the limit changes the Deployment, which only a person may approve here.",
      ruledOutFixes: [
        {
          fix: "Raise the memory limit of deployment web to 1Gi",
          commands: [
            "kubectl set resources deployment web --limits=memory=1Gi",
          ],
          whyNot: "Not allowed here: it changes the Deployment.",
        },
      ],
    });
  });

  it("skips a call whose arguments say nothing, back to one that does", () => {
    expect(
      getRoundExplanation([
        completed(
          EXPLAIN_NO_FIX_TOOL_NAME,
          { rowCount: 0 },
          { reason: "No runbook fits a full disk." },
        ),
        completed(EXPLAIN_NO_FIX_TOOL_NAME, { rowCount: 0 }, { reason: "  " }),
      ]),
    ).toEqual({ reason: "No runbook fits a full disk.", ruledOutFixes: [] });
  });

  it("a round that never explained has no explanation", () => {
    expect(
      getRoundExplanation([
        completed("query_logs", { rowCount: 3 }, { reason: "not this" }),
      ]),
    ).toBeNull();
    expect(getRoundExplanation([])).toBeNull();
  });
});

describe("toLifecycleEventsJson / toRoundRunJson: what leaves the server", () => {
  it("sends only how attempts went: never a tool, its arguments or its citation", () => {
    const sent: JSONArray = toLifecycleEventsJson([
      lifecycle(AIRunEventType.RunStarted),
      event({
        eventType: AIRunEventType.ToolCallStarted,
        toolName: "run_kubectl",
        toolArguments: { command: "kubectl get secret db -o yaml" },
        citationId: "c1",
      }),
      event({
        eventType: AIRunEventType.AttemptEnded,
        toolName: "run_kubectl",
        toolArguments: { command: "kubectl get secret db -o yaml" },
        citationId: "c2",
        resultSummary: {
          errorMessage: "The model provider did not answer in time.",
          rowCount: 7,
          bytesSentToLlm: 1234,
        },
      }),
      lifecycle(AIRunEventType.RunFailed),
    ]);

    expect(sent).toHaveLength(3);
    expect(
      sent.map((item: JSONObject | unknown): unknown => {
        return (item as JSONObject)["eventType"];
      }),
    ).toEqual([
      AIRunEventType.RunStarted,
      AIRunEventType.AttemptEnded,
      AIRunEventType.RunFailed,
    ]);

    const attemptEnded: JSONObject = sent[1] as JSONObject;
    expect(attemptEnded["toolName"]).toBeUndefined();
    expect(attemptEnded["toolArguments"]).toBeUndefined();
    expect(attemptEnded["citationId"]).toBeUndefined();
    expect(attemptEnded["resultSummary"]).toEqual({
      errorMessage: "The model provider did not answer in time.",
    });
    expect(JSON.stringify(sent)).not.toContain("kubectl get secret");
  });

  it("sends the run's status, times and error - not its provider, project or kind", () => {
    const sent: JSONObject = toRoundRunJson(fakeRun());

    expect(sent["status"]).toBe(AIRunStatus.Error);
    expect(sent["errorMessage"]).toBe(
      "The model provider did not answer in time.",
    );
    expect(sent["completedAt"]).toBeDefined();
    expect(sent["llmProviderId"]).toBeUndefined();
    expect(sent["projectId"]).toBeUndefined();
    expect(sent["runType"]).toBeUndefined();
    expect(JSON.stringify(sent)).not.toContain(PROVIDER_ID.toString());
  });
});

/*
 * The services the round's read and its Try again use, mocked at their
 * edges.
 */
interface RoundMocks {
  findSuggestion: jest.SpyInstance;
  findRun: jest.SpyInstance;
  findEvents: jest.SpyInstance;
  incidentResolved: jest.SpyInstance;
  alertResolved: jest.SpyInstance;
  incidentUpdatable: jest.SpyInstance;
  alertUpdatable: jest.SpyInstance;
  disabledReason: jest.SpyInstance;
  enqueue: jest.SpyInstance;
  roundRunChange: jest.SpyInstance;
  incidentFeed: jest.SpyInstance;
  alertFeed: jest.SpyInstance;
}

function mockRound(data: {
  suggestion?: AutoRemediationSuggestion | null;
  // What the person's own read finds: by default the suggestion, in the project.
  readable?: { id?: ObjectID; projectId?: ObjectID } | null;
  run?: AIRun | null;
  events?: Array<AIRunEvent>;
}): RoundMocks {
  const suggestion: AutoRemediationSuggestion | null =
    data.suggestion === undefined ? fakeSuggestion() : data.suggestion;
  const readable: { id?: ObjectID; projectId?: ObjectID } | null =
    data.readable === undefined
      ? suggestion
        ? { id: SUGGESTION_ID, projectId: PROJECT_ID }
        : null
      : data.readable;

  return {
    findSuggestion: jest
      .spyOn(AutoRemediationSuggestionService, "findOneById")
      .mockImplementation(
        async (args: {
          props: DatabaseCommonInteractionProps;
        }): Promise<AutoRemediationSuggestion | null> => {
          return args.props.isRoot
            ? suggestion
            : (readable as unknown as AutoRemediationSuggestion | null);
        },
      ),
    findRun: jest
      .spyOn(AIRunService, "findOneById")
      .mockResolvedValue(data.run === undefined ? fakeRun() : data.run),
    // The newest first, as the read asks for them.
    findEvents: jest
      .spyOn(AIRunEventService, "findBy")
      .mockResolvedValue([...(data.events || [])].reverse()),
    incidentResolved: jest
      .spyOn(IncidentService, "isIncidentResolved")
      .mockResolvedValue(false),
    alertResolved: jest
      .spyOn(AlertService, "isAlertResolved")
      .mockResolvedValue(false),
    incidentUpdatable: jest
      .spyOn(IncidentService, "findOneUpdatableById")
      .mockResolvedValue({ id: INCIDENT_ID } as unknown as Incident),
    alertUpdatable: jest
      .spyOn(AlertService, "findOneUpdatableById")
      .mockResolvedValue({ id: ALERT_ID } as unknown as Alert),
    disabledReason: jest
      .spyOn(AIInvestigationEngine, "getDisabledReasonForSubject")
      .mockResolvedValue(null),
    enqueue: jest
      .spyOn(AIInvestigationQueue, "enqueue")
      .mockImplementation(
        async (args: {
          runId?: ObjectID | undefined;
          admitInsideSubjectLock?: (() => Promise<boolean>) | undefined;
        }): Promise<ObjectID | null> => {
          // The queue asks right before it creates the run, as it does for real.
          if (
            args.admitInsideSubjectLock &&
            !(await args.admitInsideSubjectLock())
          ) {
            return null;
          }
          return args.runId || ObjectID.generate();
        },
      ),
    roundRunChange: jest
      .spyOn(AutoRemediationSuggestionService, "attemptRoundRunChange")
      .mockResolvedValue(1),
    incidentFeed: jest
      .spyOn(IncidentFeedService, "createIncidentFeedItem")
      .mockResolvedValue(undefined as never),
    alertFeed: jest
      .spyOn(AlertFeedService, "createAlertFeedItem")
      .mockResolvedValue(undefined as never),
  };
}

async function read(
  suggestionId: unknown = SUGGESTION_ID.toString(),
): Promise<JSONObject> {
  return await RemediationRound.readForViewer({
    suggestionId,
    tenantId: PROJECT_ID,
    viewerProps,
  });
}

async function tryAgain(
  suggestionId: unknown = SUGGESTION_ID.toString(),
): Promise<ObjectID> {
  return await RemediationRound.tryAgain({
    suggestionId,
    tenantId: PROJECT_ID,
    viewerProps,
    userId: USER_ID,
  });
}

describe("RemediationRound.readForViewer: the round, for whoever may read the fix", () => {
  beforeEach(() => {
    nextSequence = 1;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it.each([
    ["no id", undefined],
    ["an empty id", "  "],
    ["an id that is no UUID", "not-a-fix"],
    ["an id that is no string", 42],
  ])(
    "refuses %s before reading anything",
    async (_label: string, suggestionId: unknown) => {
      const mocks: RoundMocks = mockRound({});

      await expect(
        RemediationRound.readForViewer({
          suggestionId,
          tenantId: PROJECT_ID,
          viewerProps,
        }),
      ).rejects.toThrow("suggestionId must be a fix's ID.");
      await expect(
        RemediationRound.tryAgain({
          suggestionId,
          tenantId: PROJECT_ID,
          viewerProps,
          userId: USER_ID,
        }),
      ).rejects.toBeInstanceOf(BadDataException);
      expect(mocks.findSuggestion).not.toHaveBeenCalled();
      expect(mocks.enqueue).not.toHaveBeenCalled();
    },
  );

  it("reads the fix under the person's own permissions first, then as root", async () => {
    const mocks: RoundMocks = mockRound({});

    await read();

    expect(mocks.findSuggestion).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        id: SUGGESTION_ID,
        props: viewerProps,
      }),
    );
    expect(mocks.findSuggestion).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        id: SUGGESTION_ID,
        props: { isRoot: true },
      }),
    );
  });

  it.each([
    ["a fix the person cannot read", null],
    [
      "a fix of another project they belong to",
      { id: SUGGESTION_ID, projectId: OTHER_PROJECT_ID },
    ],
  ])(
    "%s reads as not found, and nothing else is read",
    async (
      _label: string,
      readable: { id?: ObjectID; projectId?: ObjectID } | null,
    ) => {
      const mocks: RoundMocks = mockRound({ readable });

      await expect(read()).rejects.toThrow(
        "Auto-remediation suggestion not found (or you do not have access to it).",
      );
      expect(mocks.findSuggestion).toHaveBeenCalledTimes(1);
      expect(mocks.findRun).not.toHaveBeenCalled();
      expect(mocks.findEvents).not.toHaveBeenCalled();
    },
  );

  it("says how the round went: its run, its attempts, its checks, its explanation", async () => {
    const mocks: RoundMocks = mockRound({
      events: [
        lifecycle(AIRunEventType.RunStarted),
        started("query_logs", undefined),
        completed("query_logs"),
        started(
          "run_kubectl",
          "kubectl get pods -n shop",
          "Find the failing pods.",
        ),
        completed("run_kubectl"),
        started(EXPLAIN_NO_FIX_TOOL_NAME, undefined),
        completed(
          EXPLAIN_NO_FIX_TOOL_NAME,
          { rowCount: 1 },
          {
            reason: "Every pod is Pending: the cluster has no free memory.",
            ruledOutFixes: [
              {
                fix: "Scale the web deployment down to 1",
                commands: ["kubectl scale deploy web --replicas=1"],
                whyNot: "Not safe: it drops capacity during an outage.",
              },
            ],
          },
        ),
        event({
          eventType: AIRunEventType.RunFailed,
          resultSummary: {
            errorMessage: "The model provider did not answer in time.",
          },
        }),
        // Not a round event: never read into the step.
        event({ eventType: AIRunEventType.ProgressLog }),
      ],
    });

    const round: JSONObject = await read();

    expect((round["run"] as JSONObject)["status"]).toBe(AIRunStatus.Error);
    expect((round["run"] as JSONObject)["llmProviderId"]).toBeUndefined();
    expect(
      (round["events"] as JSONArray).map((item: unknown): unknown => {
        return (item as JSONObject)["eventType"];
      }),
    ).toEqual([AIRunEventType.RunStarted, AIRunEventType.RunFailed]);
    expect(round["checks"]).toEqual([
      expect.objectContaining({
        command: "kubectl get pods -n shop",
        why: "Find the failing pods.",
        status: "ran",
      }),
    ]);
    expect(round["otherCheckCount"]).toBe(1);
    expect(round["explanation"]).toEqual({
      reason: "Every pod is Pending: the cluster has no free memory.",
      ruledOutFixes: [
        {
          fix: "Scale the web deployment down to 1",
          commands: ["kubectl scale deploy web --replicas=1"],
          whyNot: "Not safe: it drops capacity during an outage.",
        },
      ],
    });
    expect(round["appliedSteps"]).toEqual(NOTHING_APPLIED);
    expect(round["mayTryAgain"]).toBe(true);

    // The newest events of the round's own run, in the project, put back in order.
    expect(mocks.findEvents).toHaveBeenCalledWith(
      expect.objectContaining({
        query: { aiRunId: OLD_RUN_ID, projectId: PROJECT_ID },
        sort: { sequence: SortOrder.Descending },
        limit: 500,
        props: { isRoot: true },
      }),
    );
    expect(mocks.findRun).toHaveBeenCalledWith(
      expect.objectContaining({ id: OLD_RUN_ID, props: { isRoot: true } }),
    );
  });

  it("a round's checks and explanation never carry a tool's raw arguments", async () => {
    mockRound({
      events: [
        event({
          eventType: AIRunEventType.ToolCallStarted,
          toolName: "query_logs",
          toolArguments: { query: "password=hunter2" },
        }),
        completed("query_logs"),
      ],
    });

    const round: JSONObject = await read();

    expect(JSON.stringify(round)).not.toContain("hunter2");
  });

  it("a run of another project is no run of this round", async () => {
    const mocks: RoundMocks = mockRound({
      run: fakeRun({ projectId: OTHER_PROJECT_ID }),
    });

    const round: JSONObject = await read();

    expect(round["run"]).toBeNull();
    expect(round["events"]).toEqual([]);
    expect(mocks.findEvents).not.toHaveBeenCalled();
  });

  it("a fix no AI run worked out has no round, and is not tried again", async () => {
    const mocks: RoundMocks = mockRound({
      suggestion: fakeSuggestion({
        aiRunId: undefined,
        suggestionType: AutoRemediationSuggestionType.Runbook,
      }),
    });

    const round: JSONObject = await read();

    expect(mocks.findRun).not.toHaveBeenCalled();
    expect(round["run"]).toBeNull();
    expect(round["checks"]).toEqual([]);
    expect(round["explanation"]).toBeNull();
    expect(round["mayTryAgain"]).toBe(false);
  });

  it("a run still going lists its open command as running, and is not tried again", async () => {
    mockRound({
      run: fakeRun({ status: AIRunStatus.Running, completedAt: undefined }),
      events: [
        lifecycle(AIRunEventType.RunStarted),
        started("run_kubectl", "kubectl get events -n shop"),
      ],
    });

    const round: JSONObject = await read();

    expect((round["checks"] as JSONArray)[0]).toMatchObject({
      status: "running",
    });
    expect(round["mayTryAgain"]).toBe(false);
  });

  it("a round whose run is gone lists nothing open and may be tried again", async () => {
    mockRound({ run: null });

    const round: JSONObject = await read();

    expect(round["run"]).toBeNull();
    expect(round["mayTryAgain"]).toBe(true);
  });

  it("a round that made a change says so, and is not tried again", async () => {
    mockRound({
      suggestion: fakeSuggestion({
        commandPlan: { commands: [bashCommand(1, true)] },
      }),
    });

    const round: JSONObject = await read();

    expect(round["appliedSteps"]).toEqual({
      ...NOTHING_APPLIED,
      commandCount: 1,
    });
    expect(round["mayTryAgain"]).toBe(false);
  });

  it("a resolved incident's round is not tried again", async () => {
    const mocks: RoundMocks = mockRound({});
    mocks.incidentResolved.mockResolvedValue(true);

    expect((await read())["mayTryAgain"]).toBe(false);
    expect(mocks.incidentResolved).toHaveBeenCalledWith({
      incidentId: INCIDENT_ID,
    });
  });

  it("a person who may read the fix but not change the incident may not try it again", async () => {
    const mocks: RoundMocks = mockRound({});
    mocks.incidentUpdatable.mockResolvedValue(null);

    const round: JSONObject = await read();

    expect(round["mayTryAgain"]).toBe(false);
    // ...and still reads the whole round.
    expect(round["run"]).not.toBeNull();
    expect(mocks.incidentUpdatable).toHaveBeenCalledWith(
      expect.objectContaining({ id: INCIDENT_ID, props: viewerProps }),
    );
  });

  it("a permission check that throws reads as not allowed", async () => {
    const mocks: RoundMocks = mockRound({});
    mocks.incidentUpdatable.mockRejectedValue(new Error("no permission"));

    expect((await read())["mayTryAgain"]).toBe(false);
  });

  it("an alert's round is held to the alert", async () => {
    const mocks: RoundMocks = mockRound({
      suggestion: fakeSuggestion({ incidentId: undefined, alertId: ALERT_ID }),
    });
    mocks.alertUpdatable.mockResolvedValue(null);

    expect((await read())["mayTryAgain"]).toBe(false);
    expect(mocks.alertUpdatable).toHaveBeenCalledWith(
      expect.objectContaining({ id: ALERT_ID, props: viewerProps }),
    );
    expect(mocks.alertResolved).toHaveBeenCalledWith({ alertId: ALERT_ID });
    expect(mocks.incidentUpdatable).not.toHaveBeenCalled();
  });
});

describe("RemediationRound.tryAgain: a round that did not finish starts again", () => {
  beforeEach(() => {
    nextSequence = 1;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("starts it with a new run named on the round before the run exists, as the person's", async () => {
    const mocks: RoundMocks = mockRound({});

    const newRunId: ObjectID = await tryAgain();

    expect(mocks.enqueue).toHaveBeenCalledTimes(1);
    const queued: Record<string, unknown> = mocks.enqueue.mock
      .calls[0]![0] as Record<string, unknown>;
    expect(queued).toMatchObject({
      projectId: PROJECT_ID,
      subjectIncidentId: INCIDENT_ID,
      subjectAutoRemediationSuggestionId: SUGGESTION_ID,
      // The round's own kind of run, with the provider its last run used.
      remediationRunType: AIRunType.RemediationExecution,
      llmProviderId: PROVIDER_ID,
      runId: newRunId,
    });
    expect(queued).not.toHaveProperty("subjectAlertId");

    // One conditional write names it: the round as it was read, its last run's plan gone.
    expect(mocks.roundRunChange).toHaveBeenCalledTimes(1);
    expect(mocks.roundRunChange).toHaveBeenCalledWith({
      suggestionId: SUGGESTION_ID,
      fromStatus: AutoRemediationSuggestionStatus.NoneApplicable,
      fromAiRunId: OLD_RUN_ID,
      set: {
        status: AutoRemediationSuggestionStatus.Planning,
        aiRunId: newRunId.toString(),
        commandPlan: null,
        mcpToolCallPlan: null,
        rationaleMarkdown: null,
      },
    });
  });

  it("says on the incident's feed who started it again", async () => {
    const mocks: RoundMocks = mockRound({});

    await tryAgain();

    expect(mocks.incidentFeed).toHaveBeenCalledWith(
      expect.objectContaining({
        incidentId: INCIDENT_ID,
        projectId: PROJECT_ID,
        userId: USER_ID,
        feedInfoInMarkdown:
          '⚡ Asked OneUptime AI to try **AI kubectl fix for cluster "prod-us"** again: it stopped before it found a fix.',
        workspaceNotification: expect.objectContaining({
          sendWorkspaceNotification: false,
        }),
      }),
    );
  });

  it("a rule's round is named by its rule on the feed", async () => {
    const mocks: RoundMocks = mockRound({
      suggestion: fakeSuggestion({
        kubernetesClusterId: undefined,
        ruleNameSnapshot: "Restart API pods",
      }),
    });

    await tryAgain();

    expect(
      (mocks.incidentFeed.mock.calls[0]![0] as { feedInfoInMarkdown: string })
        .feedInfoInMarkdown,
    ).toBe(
      '⚡ Asked OneUptime AI to try **AI rule "Restart API pods"** again: it stopped before it found a fix.',
    );
  });

  /*
   * In the words the Remediation step said it with: a runbook pick stopped
   * before it picked a runbook, never "its last round did not finish".
   */
  it("a runbook pick says it stopped before it picked a runbook", async () => {
    const mocks: RoundMocks = mockRound({
      suggestion: fakeSuggestion({
        kubernetesClusterId: undefined,
        suggestionType: AutoRemediationSuggestionType.Runbook,
        ruleNameSnapshot: "Checkout runbooks",
      }),
      run: fakeRun({ runType: AIRunType.RemediationPlan }),
    });

    await tryAgain();

    const markdown: string = (
      mocks.incidentFeed.mock.calls[0]![0] as { feedInfoInMarkdown: string }
    ).feedInfoInMarkdown;
    expect(markdown).toBe(
      '⚡ Asked OneUptime AI to try **AI rule "Checkout runbooks"** again: it stopped before it picked a runbook.',
    );
    expect(markdown).not.toMatch(/round/);
  });

  it("a feed that cannot be written never fails the press", async () => {
    const mocks: RoundMocks = mockRound({});
    mocks.incidentFeed.mockRejectedValue(new Error("feed is down"));

    await expect(tryAgain()).resolves.toBeInstanceOf(ObjectID);
  });

  it("an alert's round starts again as the alert's, gated on the alert lane", async () => {
    const mocks: RoundMocks = mockRound({
      suggestion: fakeSuggestion({ incidentId: undefined, alertId: ALERT_ID }),
    });

    await tryAgain();

    expect(mocks.enqueue.mock.calls[0]![0]).toMatchObject({
      subjectAlertId: ALERT_ID,
    });
    expect(mocks.enqueue.mock.calls[0]![0]).not.toHaveProperty(
      "subjectIncidentId",
    );
    expect(mocks.disabledReason).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: PROJECT_ID, subjectType: "Alert" }),
    );
    expect(mocks.alertFeed).toHaveBeenCalledWith(
      expect.objectContaining({ alertId: ALERT_ID, userId: USER_ID }),
    );
    expect(mocks.incidentFeed).not.toHaveBeenCalled();
  });

  it("the gate asks about the provider the round's last run used", async () => {
    const mocks: RoundMocks = mockRound({});

    await tryAgain();

    const gate: {
      subjectType: string;
      getRuleLlmProviderId: () => Promise<ObjectID | undefined>;
    } = mocks.disabledReason.mock.calls[0]![0] as {
      subjectType: string;
      getRuleLlmProviderId: () => Promise<ObjectID | undefined>;
    };
    expect(gate.subjectType).toBe("Incident");
    await expect(gate.getRuleLlmProviderId()).resolves.toBe(PROVIDER_ID);
  });

  it.each([
    [
      "a planning run",
      AIRunType.RemediationPlan,
      AutoRemediationSuggestionType.CommandPlan,
      AIRunType.RemediationPlan,
    ],
    [
      "a command run",
      AIRunType.RemediationExecution,
      AutoRemediationSuggestionType.CommandPlan,
      AIRunType.RemediationExecution,
    ],
  ])(
    "a round whose last run was %s starts the same kind of run",
    async (
      _label: string,
      runType: AIRunType,
      suggestionType: AutoRemediationSuggestionType,
      expected: AIRunType,
    ) => {
      const mocks: RoundMocks = mockRound({
        suggestion: fakeSuggestion({ suggestionType }),
        run: fakeRun({ runType }),
      });

      await tryAgain();

      expect(mocks.enqueue.mock.calls[0]![0]).toMatchObject({
        remediationRunType: expected,
      });
    },
  );

  it.each([
    [AutoRemediationSuggestionType.CommandPlan, AIRunType.RemediationExecution],
    [
      AutoRemediationSuggestionType.McpToolCalls,
      AIRunType.RemediationExecution,
    ],
    [AutoRemediationSuggestionType.Runbook, AIRunType.RemediationPlan],
    [undefined, AIRunType.RemediationPlan],
  ])(
    "a %s round whose run is gone starts the run its kind takes",
    async (
      suggestionType: AutoRemediationSuggestionType | undefined,
      expected: AIRunType,
    ) => {
      const mocks: RoundMocks = mockRound({
        suggestion: fakeSuggestion({ suggestionType }),
        run: null,
      });

      await tryAgain();

      expect(mocks.enqueue.mock.calls[0]![0]).toMatchObject({
        remediationRunType: expected,
        llmProviderId: undefined,
      });
    },
  );

  it("a round the sweep has not settled yet starts again from Planning", async () => {
    const mocks: RoundMocks = mockRound({
      suggestion: fakeSuggestion({
        status: AutoRemediationSuggestionStatus.Planning,
      }),
      run: fakeRun({ status: AIRunStatus.Stale }),
    });

    await tryAgain();

    expect(mocks.roundRunChange).toHaveBeenCalledWith(
      expect.objectContaining({
        fromStatus: AutoRemediationSuggestionStatus.Planning,
        fromAiRunId: OLD_RUN_ID,
      }),
    );
  });

  describe("who may", () => {
    it.each([
      ["incident", {}, REMEDIATION_ROUND_TRY_AGAIN_NOT_ALLOWED.incident],
      [
        "alert",
        { incidentId: undefined, alertId: ALERT_ID },
        REMEDIATION_ROUND_TRY_AGAIN_NOT_ALLOWED.alert,
      ],
    ])(
      "a person who may not change the %s is refused, in words that say so, and nothing starts",
      async (
        _kind: string,
        overrides: Partial<Record<string, unknown>>,
        words: string,
      ) => {
        const mocks: RoundMocks = mockRound({
          suggestion: fakeSuggestion(overrides),
        });
        mocks.incidentUpdatable.mockResolvedValue(null);
        mocks.alertUpdatable.mockResolvedValue(null);

        const press: Promise<ObjectID> = tryAgain();

        await expect(press).rejects.toBeInstanceOf(NotAuthorizedException);
        await expect(press).rejects.toThrow(words);
        expect(mocks.enqueue).not.toHaveBeenCalled();
        expect(mocks.roundRunChange).not.toHaveBeenCalled();
      },
    );

    it("the words are the investigation's, for this fix", () => {
      expect(REMEDIATION_ROUND_TRY_AGAIN_NOT_ALLOWED).toEqual({
        incident:
          "You do not have permission to change this incident, so you cannot ask OneUptime AI to try this fix again.",
        alert:
          "You do not have permission to change this alert, so you cannot ask OneUptime AI to try this fix again.",
      });
    });

    it("a fix of another project is not found, and nothing starts", async () => {
      const mocks: RoundMocks = mockRound({
        readable: { id: SUGGESTION_ID, projectId: OTHER_PROJECT_ID },
      });

      await expect(tryAgain()).rejects.toThrow(
        "Auto-remediation suggestion not found (or you do not have access to it).",
      );
      expect(mocks.enqueue).not.toHaveBeenCalled();
    });

    it("a bad id is refused before anything is read", async () => {
      const mocks: RoundMocks = mockRound({});

      await expect(tryAgain("x")).rejects.toThrow(
        "suggestionId must be a fix's ID.",
      );
      expect(mocks.findSuggestion).not.toHaveBeenCalled();
    });
  });

  describe("refusals, word for word, and nothing starts", () => {
    async function expectRefused(
      mocks: RoundMocks,
      refusal: RemediationRoundTryAgainRefusal,
    ): Promise<void> {
      const press: Promise<ObjectID> = tryAgain();

      await expect(press).rejects.toBeInstanceOf(BadDataException);
      await expect(press).rejects.toThrow(refusalOf(refusal));
      expect(mocks.roundRunChange).not.toHaveBeenCalled();
      expect(mocks.incidentFeed).not.toHaveBeenCalled();
    }

    it("a fix no AI run worked out", async () => {
      const mocks: RoundMocks = mockRound({
        suggestion: fakeSuggestion({ aiRunId: undefined }),
      });

      await expectRefused(mocks, RemediationRoundTryAgainRefusal.NoRound);
      expect(mocks.enqueue).not.toHaveBeenCalled();
    });

    it("a round still being worked on", async () => {
      const mocks: RoundMocks = mockRound({
        run: fakeRun({ status: AIRunStatus.Queued }),
      });

      await expectRefused(mocks, RemediationRoundTryAgainRefusal.StillWorking);
      expect(mocks.enqueue).not.toHaveBeenCalled();
    });

    it("a round that finished", async () => {
      const mocks: RoundMocks = mockRound({
        run: fakeRun({ status: AIRunStatus.Completed }),
      });

      await expectRefused(mocks, RemediationRoundTryAgainRefusal.Finished);
      expect(mocks.enqueue).not.toHaveBeenCalled();
    });

    it("a round that made a change before it stopped", async () => {
      const mocks: RoundMocks = mockRound({
        suggestion: fakeSuggestion({
          status: AutoRemediationSuggestionStatus.AutoExecuted,
          commandPlan: {
            commands: [bashCommand(1, true), bashCommand(2, false)],
          },
        }),
        run: fakeRun({ status: AIRunStatus.Stale }),
      });

      await expectRefused(mocks, RemediationRoundTryAgainRefusal.PartlyApplied);
      expect(mocks.enqueue).not.toHaveBeenCalled();
    });

    it("a resolved incident", async () => {
      const mocks: RoundMocks = mockRound({});
      mocks.incidentResolved.mockResolvedValue(true);

      await expectRefused(
        mocks,
        RemediationRoundTryAgainRefusal.IncidentResolved,
      );
      expect(mocks.enqueue).not.toHaveBeenCalled();
    });

    it("a resolved alert", async () => {
      const mocks: RoundMocks = mockRound({
        suggestion: fakeSuggestion({
          incidentId: undefined,
          alertId: ALERT_ID,
        }),
      });
      mocks.alertResolved.mockResolvedValue(true);

      const press: Promise<ObjectID> = tryAgain();

      await expect(press).rejects.toThrow(
        refusalOf(RemediationRoundTryAgainRefusal.AlertResolved),
      );
      expect(mocks.enqueue).not.toHaveBeenCalled();
    });

    it.each([
      ["ai_disabled", RemediationRoundTryAgainRefusal.AiOff],
      ["provider_missing", RemediationRoundTryAgainRefusal.NoProvider],
      [
        "insufficient_ai_balance",
        RemediationRoundTryAgainRefusal.CreditsUsedUp,
      ],
      [
        "project_daily_limit_reached",
        RemediationRoundTryAgainRefusal.LimitReached,
      ],
    ])(
      "%s: what stops any AI run of the project, with who can change it",
      async (code: string, refusal: RemediationRoundTryAgainRefusal) => {
        const mocks: RoundMocks = mockRound({});
        mocks.disabledReason.mockResolvedValue(
          code as InvestigationNotStartedCode,
        );

        await expectRefused(mocks, refusal);
        expect(mocks.enqueue).not.toHaveBeenCalled();
      },
    );

    it("a lane's own switch does not stop a person's Try again", async () => {
      const mocks: RoundMocks = mockRound({});
      mocks.disabledReason.mockResolvedValue(
        "automatic_investigation_disabled",
      );

      await expect(tryAgain()).resolves.toBeInstanceOf(ObjectID);
      expect(mocks.enqueue).toHaveBeenCalledTimes(1);
    });
  });

  describe("two presses, and a queue that does not take it", () => {
    it("of two presses at once one starts it: the other is told someone just did", async () => {
      const mocks: RoundMocks = mockRound({});
      // The other press's write named its run first.
      mocks.roundRunChange.mockResolvedValue(0);

      await expect(tryAgain()).rejects.toThrow(
        refusalOf(RemediationRoundTryAgainRefusal.AlreadyStarted),
      );
      // Nothing to put back: this press changed nothing.
      expect(mocks.roundRunChange).toHaveBeenCalledTimes(1);
      expect(mocks.incidentFeed).not.toHaveBeenCalled();
    });

    it("a round named but never created is put back as it was", async () => {
      const mocks: RoundMocks = mockRound({
        suggestion: fakeSuggestion({
          commandPlan: { commands: [bashCommand(1, false)] },
          rationaleMarkdown: "Proposed a restart.",
        }),
      });
      // Admitted, then the run's create failed.
      mocks.enqueue.mockImplementation(
        async (args: {
          admitInsideSubjectLock?: (() => Promise<boolean>) | undefined;
          onNotEnqueued?:
            | ((code: InvestigationNotStartedCode) => Promise<void>)
            | undefined;
        }): Promise<ObjectID | null> => {
          await args.admitInsideSubjectLock?.();
          await args.onNotEnqueued?.("enqueue_failed");
          return null;
        },
      );

      await expect(tryAgain()).rejects.toThrow(
        refusalOf(RemediationRoundTryAgainRefusal.NotStarted),
      );

      expect(mocks.roundRunChange).toHaveBeenCalledTimes(2);
      const named: { set: { aiRunId: string } } = mocks.roundRunChange.mock
        .calls[0]![0] as { set: { aiRunId: string } };
      expect(mocks.roundRunChange).toHaveBeenNthCalledWith(2, {
        suggestionId: SUGGESTION_ID,
        // Only while it is still the round this press named.
        fromStatus: AutoRemediationSuggestionStatus.Planning,
        fromAiRunId: new ObjectID(named.set.aiRunId),
        set: {
          status: AutoRemediationSuggestionStatus.NoneApplicable,
          aiRunId: OLD_RUN_ID.toString(),
          commandPlan: { commands: [bashCommand(1, false)] },
          mcpToolCallPlan: null,
          rationaleMarkdown: "Proposed a restart.",
        },
      });
      expect(mocks.incidentFeed).not.toHaveBeenCalled();
    });

    it.each([
      [
        "project_daily_limit_reached",
        RemediationRoundTryAgainRefusal.LimitReached,
      ],
      /*
       * The incident's own daily AI token limit, which the queue read
       * without handing it over: used up, the only other way it stops.
       */
      [
        "daily_budget_exhausted",
        RemediationRoundTryAgainRefusal.IncidentTokenLimitUsedUp,
      ],
      ["budget_check_failed", RemediationRoundTryAgainRefusal.NotStarted],
    ])(
      "a queue that skips it (%s) says why, and nothing was named",
      async (code: string, refusal: RemediationRoundTryAgainRefusal) => {
        const mocks: RoundMocks = mockRound({});
        mocks.enqueue.mockImplementation(
          async (args: {
            onNotEnqueued?:
              | ((code: InvestigationNotStartedCode) => Promise<void>)
              | undefined;
          }): Promise<ObjectID | null> => {
            await args.onNotEnqueued?.(code as InvestigationNotStartedCode);
            return null;
          },
        );

        await expect(tryAgain()).rejects.toThrow(refusalOf(refusal));
        expect(mocks.roundRunChange).not.toHaveBeenCalled();
      },
    );

    /*
     * #7157: the record's own daily AI token limit, set to 0 (or below),
     * pauses its automatic AI work until someone raises it: the refusal
     * says so, and names the limit of the record the fix is for. Only a
     * limit today's work used up says midnight.
     */
    it.each([
      {
        record: "incident",
        limitInTokens: 0,
        usedTokensToday: 0,
        refusal: RemediationRoundTryAgainRefusal.IncidentTokenLimitPaused,
      },
      {
        record: "incident",
        limitInTokens: -10,
        usedTokensToday: 0,
        refusal: RemediationRoundTryAgainRefusal.IncidentTokenLimitPaused,
      },
      {
        record: "incident",
        limitInTokens: 1000,
        usedTokensToday: 1200,
        refusal: RemediationRoundTryAgainRefusal.IncidentTokenLimitUsedUp,
      },
      {
        record: "alert",
        limitInTokens: 0,
        usedTokensToday: 0,
        refusal: RemediationRoundTryAgainRefusal.AlertTokenLimitPaused,
      },
      {
        record: "alert",
        limitInTokens: -1,
        usedTokensToday: 0,
        refusal: RemediationRoundTryAgainRefusal.AlertTokenLimitPaused,
      },
      {
        record: "alert",
        limitInTokens: 1000,
        usedTokensToday: 1000,
        refusal: RemediationRoundTryAgainRefusal.AlertTokenLimitUsedUp,
      },
    ])(
      "an $record's daily AI token limit of $limitInTokens: $refusal",
      async (data: {
        record: string;
        limitInTokens: number;
        usedTokensToday: number;
        refusal: RemediationRoundTryAgainRefusal;
      }) => {
        const mocks: RoundMocks = mockRound(
          data.record === "alert"
            ? {
                suggestion: fakeSuggestion({
                  incidentId: undefined,
                  alertId: ALERT_ID,
                }),
              }
            : {},
        );
        mocks.enqueue.mockImplementation(
          async (args: {
            onNotEnqueued?:
              | ((
                  code: InvestigationNotStartedCode,
                  budget?: AutonomousBudgetStatus,
                ) => Promise<void>)
              | undefined;
          }): Promise<ObjectID | null> => {
            await args.onNotEnqueued?.("daily_budget_exhausted", {
              exhausted: true,
              limitInTokens: data.limitInTokens,
              usedTokensToday: data.usedTokensToday,
            });
            return null;
          },
        );

        await expect(tryAgain()).rejects.toThrow(refusalOf(data.refusal));
        expect(refusalOf(data.refusal).includes("midnight")).toBe(
          data.limitInTokens > 0,
        );
        expect(mocks.roundRunChange).not.toHaveBeenCalled();
      },
    );

    it("the token limit refusal reads the record and the limit, and a budget not handed over as used up", () => {
      expect(getTokenLimitRefusal("incident", null)).toBe(
        RemediationRoundTryAgainRefusal.IncidentTokenLimitUsedUp,
      );
      expect(getTokenLimitRefusal("alert", undefined)).toBe(
        RemediationRoundTryAgainRefusal.AlertTokenLimitUsedUp,
      );
      expect(
        getTokenLimitRefusal("incident", {
          exhausted: true,
          limitInTokens: 0,
          usedTokensToday: 0,
        }),
      ).toBe(RemediationRoundTryAgainRefusal.IncidentTokenLimitPaused);
      expect(
        getTokenLimitRefusal("alert", {
          exhausted: true,
          limitInTokens: -3,
          usedTokensToday: 0,
        }),
      ).toBe(RemediationRoundTryAgainRefusal.AlertTokenLimitPaused);
      expect(
        getTokenLimitRefusal("alert", {
          exhausted: true,
          limitInTokens: 1,
          usedTokensToday: 1,
        }),
      ).toBe(RemediationRoundTryAgainRefusal.AlertTokenLimitUsedUp);
    });
  });
});
