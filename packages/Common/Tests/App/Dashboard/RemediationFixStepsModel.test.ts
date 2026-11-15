import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  getCommandTargetLabel,
  getRemediationFixFailedCount,
  getRemediationFixSentence,
  getRemediationFixStepKey,
  getRemediationFixSteps,
  readRemediationMoment,
  RemediationFixStep,
  RemediationFixStepKind,
  RemediationFixStepSuggestion,
  sortRemediationFixesOldestFirst,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AutoRemediation/RemediationFixSteps";
import { REMEDIATION_FIX_STEP_COPY } from "../../../../App/FeatureSet/Dashboard/src/Components/AutoRemediation/RemediationStepCopy";
import {
  AiRemediationCommandExecutionStatus,
  AiRemediationCommandPolicyVerdict,
  AiRemediationPlanExecutionStatus,
  AiRemediationRollbackStatus,
} from "../../../Types/AutoRemediation/AiRemediationCommandPlan";
import AutoRemediationSuggestionStatus from "../../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import AutoRemediationSuggestionType from "../../../Types/AutoRemediation/AutoRemediationSuggestionType";
import AutoRemediationVerificationStatus from "../../../Types/AutoRemediation/AutoRemediationVerificationStatus";
import { ExternalMcpToolCallStatus } from "../../../Types/AutoRemediation/ExternalMcpToolCallPlan";
import { JSONObject } from "../../../Types/JSON";
import { KubectlCommandTier } from "../../../Types/Kubernetes/KubernetesClusterAiAccess";
import RunbookStepType from "../../../Types/Runbook/RunbookStepType";
import { createTranslator, Translator } from "../../../Types/Translator";
import { isolated, withoutIsolateMarks } from "../../Helpers/IsolateMarks";

/*
 * A FIX ON THE AI CARD'S REMEDIATION STEP, STEP BY STEP (issue #5598).
 *
 * "Ideally it should be in steps where you have step by step sections on
 * what AI did and why, and when I expand the step - it shows me more
 * context into why, commands ran, outputs." Each fix reads as the steps it
 * went through, in the order they happened - planned, approved, ran,
 * recovered or not, rolled back - each with what OneUptime AI did, when,
 * and why or what went wrong, and whether it opens to more.
 */

const AT_PLANNED: string = "2026-09-14T18:04:10.000Z";
const AT_APPROVED: string = "2026-09-14T18:05:00.000Z";
const AT_RAN: string = "2026-09-14T18:05:02.000Z";
const AT_VERIFIED: string = "2026-09-14T18:14:21.000Z";
const AT_UNDONE: string = "2026-09-14T18:14:27.000Z";

function command(sequence: number, extra?: JSONObject): JSONObject {
  return {
    sequence,
    stepType: RunbookStepType.Kubectl,
    runnerId: "0193c0de-1111-4aaa-8bbb-000000000001",
    runnerNameSnapshot: "kubernetes-agent/prod-east",
    kubernetesClusterId: "0193c0de-2222-4aaa-8bbb-000000000002",
    kubernetesClusterNameSnapshot: "prod-east",
    kubectlTier: KubectlCommandTier.SafeWrite,
    command: `kubectl rollout restart deployment/web-${sequence} -n web`,
    timeoutInMs: 60000,
    rationale: "Pods are crash-looping after a config change.",
    expectedEffect: "Fresh pods pick up the corrected config.",
    rollbackCommand: `kubectl rollout undo deployment/web-${sequence} -n web`,
    policyVerdict: AiRemediationCommandPolicyVerdict.RequiresApproval,
    ...(extra || {}),
  };
}

// A command a resource AI agent runs: on a host, a Docker host, a database server.
function resourceCommand(
  sequence: number,
  resourceType: string,
  resourceName: string,
): JSONObject {
  return {
    sequence,
    stepType: RunbookStepType.ResourceCommand,
    runnerId: "0193c0de-1111-4aaa-8bbb-000000000001",
    runnerNameSnapshot: "Host AI agent",
    resourceType,
    resourceId: "0193c0de-3333-4aaa-8bbb-000000000003",
    resourceNameSnapshot: resourceName,
    command: "systemctl restart nginx",
    timeoutInMs: 60000,
    rationale: "nginx stopped answering after a config change.",
    expectedEffect: "nginx answers again.",
    policyVerdict: AiRemediationCommandPolicyVerdict.RequiresApproval,
  };
}

function ran(
  status: AiRemediationCommandExecutionStatus,
  extra?: JSONObject,
): JSONObject {
  return {
    status,
    exitCode: status === AiRemediationCommandExecutionStatus.Failed ? 1 : 0,
    startedAt: AT_RAN,
    completedAt: AT_RAN,
    ...(extra || {}),
  };
}

function fix(
  data: Partial<RemediationFixStepSuggestion> & JSONObject,
): RemediationFixStepSuggestion {
  return {
    suggestionType: AutoRemediationSuggestionType.CommandPlan,
    createdAt: new Date(AT_PLANNED),
    ...data,
  } as unknown as RemediationFixStepSuggestion;
}

function stepsOf(
  suggestion: RemediationFixStepSuggestion,
): Array<RemediationFixStep> {
  return getRemediationFixSteps({ suggestion });
}

function kinds(
  steps: Array<RemediationFixStep>,
): Array<RemediationFixStepKind> {
  return steps.map((step: RemediationFixStep): RemediationFixStepKind => {
    return step.kind;
  });
}

function stepOf(
  steps: Array<RemediationFixStep>,
  kind: RemediationFixStepKind,
): RemediationFixStep {
  const found: RemediationFixStep | undefined = steps.find(
    (step: RemediationFixStep): boolean => {
      return step.kind === kind;
    },
  );

  if (!found) {
    throw new Error(`No ${kind} step in ${kinds(steps).join(", ")}`);
  }

  return found;
}

describe("a fix still being worked out, or one that found nothing", () => {
  test("a plan being composed is one moving step, a runbook being picked another; nothing opens", () => {
    const composing: Array<RemediationFixStep> = stepsOf(
      fix({ status: AutoRemediationSuggestionStatus.Planning }),
    );
    expect(kinds(composing)).toEqual(["plan"]);
    expect(composing[0]).toMatchObject({
      tone: "live",
      title: "Working out a fix…",
      summary: null,
      hasDetails: false,
    });

    const picking: Array<RemediationFixStep> = stepsOf(
      fix({
        status: AutoRemediationSuggestionStatus.Planning,
        suggestionType: AutoRemediationSuggestionType.Runbook,
      }),
    );
    expect(picking[0]).toMatchObject({
      tone: "live",
      title: "Picking a runbook…",
    });
  });

  test("no safe fix, and no runbook that applies: one step each, with why, which opens to all of the reasoning", () => {
    const noFix: Array<RemediationFixStep> = stepsOf(
      fix({
        status: AutoRemediationSuggestionStatus.NoneApplicable,
        rationaleMarkdown:
          "Raising the **memory request** again would repeat the change that was just rolled back.",
      }),
    );
    expect(kinds(noFix)).toEqual(["plan"]);
    expect(noFix[0]).toMatchObject({
      tone: "idle",
      title: "Found no safe fix",
      // The reasoning as words: its formatting marks dropped.
      summary:
        "Raising the memory request again would repeat the change that was just rolled back.",
      isSummaryWritten: true,
      hasDetails: true,
      at: new Date(AT_PLANNED),
    });

    const noRunbook: Array<RemediationFixStep> = stepsOf(
      fix({
        status: AutoRemediationSuggestionStatus.NoneApplicable,
        suggestionType: AutoRemediationSuggestionType.Runbook,
      }),
    );
    /*
     * With no reasoning it still opens: to say that no runbook ran and
     * nobody was asked to approve one (issue #6436).
     */
    expect(noRunbook[0]).toMatchObject({
      tone: "idle",
      title: "Found no runbook that applies",
      summary: null,
      hasDetails: true,
    });
  });

  test("a step's words never repeat the fact beside the fix's name", () => {
    // Those facts are "AI is composing a fix…", "No safe fix found", "No runbook applies".
    expect(REMEDIATION_FIX_STEP_COPY.composing).not.toBe(
      "AI is composing a fix…",
    );
    expect(REMEDIATION_FIX_STEP_COPY.noSafeFix).not.toBe("No safe fix found");
    expect(REMEDIATION_FIX_STEP_COPY.noRunbook).not.toBe("No runbook applies");
    expect(REMEDIATION_FIX_STEP_COPY.waitingForApproval).not.toBe(
      "Waiting for approval",
    );
    expect(REMEDIATION_FIX_STEP_COPY.waitingForSomeonesApproval).not.toBe(
      "Waiting for approval",
    );
    expect(REMEDIATION_FIX_STEP_COPY.cannotBeApproved).not.toBe(
      "Can't be approved",
    );
    expect(REMEDIATION_FIX_STEP_COPY.dismissed).not.toBe("Dismissed");
    expect(REMEDIATION_FIX_STEP_COPY.verified).not.toBe("Verified fixed");
    expect(REMEDIATION_FIX_STEP_COPY.verificationSkipped).not.toBe(
      "Verification skipped",
    );
  });
});

describe("a fix that waits for the reader", () => {
  test("its plan says how many commands run and where, then that it needs the reader's approval", () => {
    const steps: Array<RemediationFixStep> = stepsOf(
      fix({
        status: AutoRemediationSuggestionStatus.Suggested,
        rationaleMarkdown: "The 17:52 restart cut the pool.",
        commandPlan: { commands: [command(1), command(2)] },
      }),
    );

    expect(kinds(steps)).toEqual(["plan", "approval"]);
    expect(stepOf(steps, "plan")).toMatchObject({
      tone: "done",
      title: "Planned 2 commands on cluster prod-east",
      summary: "The 17:52 restart cut the pool.",
      isSummaryWritten: true,
      hasDetails: true,
      at: new Date(AT_PLANNED),
    });
    expect(stepOf(steps, "approval")).toMatchObject({
      tone: "attention",
      title: "Needs your approval",
      summary: null,
      at: null,
      hasDetails: false,
    });
  });

  test("to a reader who may not approve it, it needs approval - never theirs - with the same mark", () => {
    const suggestion: RemediationFixStepSuggestion = fix({
      status: AutoRemediationSuggestionStatus.Suggested,
      commandPlan: { commands: [command(1)] },
    });

    expect(
      stepOf(
        getRemediationFixSteps({ suggestion, mayApprove: false }),
        "approval",
      ),
    ).toMatchObject({
      tone: "attention",
      title: "Needs approval",
      summary: null,
      hasDetails: false,
    });
    // Left out, or true: the reader's own, as before.
    expect(
      stepOf(
        getRemediationFixSteps({ suggestion, mayApprove: true }),
        "approval",
      ).title,
    ).toBe("Needs your approval");
    expect(stepOf(stepsOf(suggestion), "approval").title).toBe(
      "Needs your approval",
    );
  });

  test("a plan nobody can approve says its approval is blocked, whoever reads it", () => {
    const suggestion: RemediationFixStepSuggestion = fix({
      status: AutoRemediationSuggestionStatus.Suggested,
      commandPlan: {
        commands: [
          command(1, {
            stepType: RunbookStepType.SSH,
            runnerNameSnapshot: "ops-runner",
            command: "systemctl restart web",
          }),
        ],
      },
    });

    for (const mayApprove of [true, false]) {
      expect(
        stepOf(getRemediationFixSteps({ suggestion, mayApprove }), "approval")
          .title,
      ).toBe(REMEDIATION_FIX_STEP_COPY.cannotBeApproved);
    }
  });

  test("a plan with nothing to say why still opens to its commands", () => {
    const steps: Array<RemediationFixStep> = stepsOf(
      fix({
        status: AutoRemediationSuggestionStatus.Suggested,
        commandPlan: { commands: [command(1)] },
      }),
    );

    expect(stepOf(steps, "plan")).toMatchObject({
      title: "Planned 1 command on cluster prod-east",
      summary: null,
      hasDetails: true,
    });
  });

  test("a plan holding an SSH command cannot be approved: its approval is blocked, not waited for", () => {
    const steps: Array<RemediationFixStep> = stepsOf(
      fix({
        status: AutoRemediationSuggestionStatus.Suggested,
        commandPlan: {
          commands: [
            command(1, {
              stepType: RunbookStepType.SSH,
              runnerNameSnapshot: "ops-runner",
              command: "systemctl restart web",
            }),
          ],
        },
      }),
    );

    expect(stepOf(steps, "approval")).toMatchObject({
      tone: "idle",
      title: "Approval blocked",
    });
  });

  test("a plan that cannot be read says so, and has nothing to open", () => {
    const steps: Array<RemediationFixStep> = stepsOf(
      fix({
        status: AutoRemediationSuggestionStatus.Suggested,
        commandPlan: { commands: [] },
      }),
    );

    expect(stepOf(steps, "plan")).toMatchObject({
      tone: "idle",
      title: "Planned a fix",
      summary: "The command plan could not be displayed.",
      isSummaryWritten: false,
      hasDetails: false,
    });

    const changes: Array<RemediationFixStep> = stepsOf(
      fix({
        status: AutoRemediationSuggestionStatus.Suggested,
        suggestionType: AutoRemediationSuggestionType.McpToolCalls,
        mcpToolCallPlan: "not a plan" as unknown as JSONObject,
      }),
    );
    expect(stepOf(changes, "plan").summary).toBe(
      "The changes of this fix could not be shown.",
    );
  });

  test("a runbook that waits: picked, then waiting for approval", () => {
    const steps: Array<RemediationFixStep> = stepsOf(
      fix({
        status: AutoRemediationSuggestionStatus.Suggested,
        suggestionType: AutoRemediationSuggestionType.Runbook,
        runbookNameSnapshot: "Restart checkout",
        rationaleMarkdown: "Proposed by a matching AI rule.",
      }),
    );

    expect(kinds(steps)).toEqual(["plan", "approval"]);
    expect(stepOf(steps, "plan")).toMatchObject({
      tone: "done",
      title: "Picked this runbook",
      summary: "Proposed by a matching AI rule.",
      hasDetails: true,
    });
  });

  test("changes through MCP servers not sent yet are read where they were planned", () => {
    const steps: Array<RemediationFixStep> = stepsOf(
      fix({
        status: AutoRemediationSuggestionStatus.Suggested,
        suggestionType: AutoRemediationSuggestionType.McpToolCalls,
        mcpToolCallPlan: {
          calls: [
            {
              sequence: 1,
              serverId: "s1",
              serverNameSnapshot: "AWS",
              toolName: "restart_service",
              arguments: {},
              status: ExternalMcpToolCallStatus.Proposed,
            },
          ],
        },
      }),
    );

    expect(kinds(steps)).toEqual(["plan", "approval"]);
    expect(stepOf(steps, "plan")).toMatchObject({
      title: "Planned 1 change through AWS",
      hasDetails: true,
    });
  });
});

describe("a fix someone decided on", () => {
  test("dismissed: by whom and when, and nothing after it", () => {
    const steps: Array<RemediationFixStep> = stepsOf(
      fix({
        status: AutoRemediationSuggestionStatus.Dismissed,
        commandPlan: { commands: [command(1)] },
        dismissedAt: new Date(AT_APPROVED),
        dismissedByUser: { name: "Maya Chen" } as never,
      }),
    );

    expect(kinds(steps)).toEqual(["plan", "approval"]);
    expect(stepOf(steps, "approval")).toMatchObject({
      tone: "idle",
      title: "Dismissed by Maya Chen",
      at: new Date(AT_APPROVED),
    });
  });

  test("dismissed by someone the reader cannot see says what came of it", () => {
    const steps: Array<RemediationFixStep> = stepsOf(
      fix({
        status: AutoRemediationSuggestionStatus.Dismissed,
        commandPlan: { commands: [command(1)] },
      }),
    );

    expect(stepOf(steps, "approval").title).toBe("Dismissed, so nothing ran");
  });

  test("approved: by whom and when, by their email when they have no name", () => {
    const named: Array<RemediationFixStep> = stepsOf(
      fix({
        status: AutoRemediationSuggestionStatus.Approved,
        commandPlan: { commands: [command(1)] },
        approvedAt: AT_APPROVED as unknown as Date,
        approvedByUser: { name: "Maya Chen" } as never,
      }),
    );
    expect(stepOf(named, "approval")).toMatchObject({
      tone: "done",
      title: "Approved by Maya Chen",
      // A moment the API answers as text reads the same as a Date.
      at: new Date(AT_APPROVED),
    });

    const byEmail: Array<RemediationFixStep> = stepsOf(
      fix({
        status: AutoRemediationSuggestionStatus.Approved,
        commandPlan: { commands: [command(1)] },
        approvedByUser: { email: "maya@acme.example" } as never,
      }),
    );
    expect(stepOf(byEmail, "approval").title).toBe(
      "Approved by maya@acme.example",
    );

    const nobody: Array<RemediationFixStep> = stepsOf(
      fix({
        status: AutoRemediationSuggestionStatus.Approved,
        commandPlan: { commands: [command(1)] },
      }),
    );
    expect(stepOf(nobody, "approval").title).toBe("Approved");
  });

  test("a fix that ran on its own was approved automatically", () => {
    const steps: Array<RemediationFixStep> = stepsOf(
      fix({
        status: AutoRemediationSuggestionStatus.AutoExecuted,
        commandPlan: {
          commands: [
            command(1, {
              wasAutoExecuted: true,
              execution: ran(AiRemediationCommandExecutionStatus.Succeeded),
            }),
          ],
          executionStatus: AiRemediationPlanExecutionStatus.Completed,
        },
      }),
    );

    expect(kinds(steps)).toEqual(["plan", "approval", "run"]);
    expect(stepOf(steps, "approval")).toMatchObject({
      tone: "done",
      title: "Approved automatically",
      at: null,
    });
  });
});

describe("what ran, and how it went", () => {
  test("approved, not started yet, and running: one moving step that opens to its commands", () => {
    for (const executionStatus of [
      undefined,
      AiRemediationPlanExecutionStatus.NotStarted,
      AiRemediationPlanExecutionStatus.Running,
    ]) {
      const steps: Array<RemediationFixStep> = stepsOf(
        fix({
          status: AutoRemediationSuggestionStatus.Approved,
          commandPlan: {
            commands: [command(1), command(2)],
            ...(executionStatus ? { executionStatus } : {}),
          },
        }),
      );

      expect(stepOf(steps, "run")).toMatchObject({
        tone: "live",
        title: "Running 2 commands…",
        summary: null,
        hasDetails: true,
      });
    }
  });

  test("every command succeeded: done, from when it started", () => {
    const steps: Array<RemediationFixStep> = stepsOf(
      fix({
        status: AutoRemediationSuggestionStatus.Approved,
        commandPlan: {
          commands: [
            command(1, {
              execution: ran(AiRemediationCommandExecutionStatus.Succeeded),
            }),
          ],
          executionStatus: AiRemediationPlanExecutionStatus.Completed,
          executionStartedAt: AT_RAN,
        },
      }),
    );

    expect(stepOf(steps, "run")).toMatchObject({
      tone: "done",
      title: "Ran 1 command",
      summary: null,
      at: new Date(AT_RAN),
    });
  });

  test("its one command failed: the error under it, in the agent's own words", () => {
    const steps: Array<RemediationFixStep> = stepsOf(
      fix({
        status: AutoRemediationSuggestionStatus.Approved,
        commandPlan: {
          commands: [
            command(1, {
              execution: ran(AiRemediationCommandExecutionStatus.Failed, {
                errorMessage: "deployments.apps 'web-1' not found",
              }),
            }),
          ],
          executionStatus: AiRemediationPlanExecutionStatus.Failed,
        },
      }),
    );

    expect(stepOf(steps, "run")).toMatchObject({
      tone: "failed",
      title: "The command failed",
      summary: "deployments.apps 'web-1' not found",
      isSummaryWritten: true,
    });
  });

  test("one of several failed: how many of how many", () => {
    const steps: Array<RemediationFixStep> = stepsOf(
      fix({
        status: AutoRemediationSuggestionStatus.Approved,
        commandPlan: {
          commands: [
            command(1, {
              execution: ran(AiRemediationCommandExecutionStatus.Succeeded),
            }),
            command(2, {
              execution: ran(AiRemediationCommandExecutionStatus.Failed),
            }),
            command(3, {
              execution: ran(AiRemediationCommandExecutionStatus.Skipped),
            }),
          ],
          executionStatus: AiRemediationPlanExecutionStatus.Failed,
        },
      }),
    );

    expect(stepOf(steps, "run")).toMatchObject({
      tone: "failed",
      title: "1 of 3 commands failed",
      summary: null,
    });
  });

  test("changes through MCP servers: being made, made, or how many failed and why", () => {
    const call: (
      sequence: number,
      status: ExternalMcpToolCallStatus,
      extra?: JSONObject,
    ) => JSONObject = (
      sequence: number,
      status: ExternalMcpToolCallStatus,
      extra?: JSONObject,
    ): JSONObject => {
      return {
        sequence,
        serverId: `s${sequence}`,
        serverNameSnapshot: "AWS",
        toolName: "restart_service",
        arguments: {},
        status,
        startedAt: AT_RAN,
        ...(extra || {}),
      };
    };
    const mcpFix: (calls: Array<JSONObject>) => Array<RemediationFixStep> = (
      calls: Array<JSONObject>,
    ): Array<RemediationFixStep> => {
      return stepsOf(
        fix({
          status: AutoRemediationSuggestionStatus.AutoExecuted,
          suggestionType: AutoRemediationSuggestionType.McpToolCalls,
          mcpToolCallPlan: { calls },
        }),
      );
    };

    expect(
      stepOf(
        mcpFix([
          call(1, ExternalMcpToolCallStatus.Succeeded),
          call(2, ExternalMcpToolCallStatus.Running),
        ]),
        "run",
      ),
    ).toMatchObject({ tone: "live", title: "Making 2 changes…" });

    const made: Array<RemediationFixStep> = mcpFix([
      call(1, ExternalMcpToolCallStatus.Succeeded),
      call(2, ExternalMcpToolCallStatus.Succeeded),
    ]);
    expect(stepOf(made, "run")).toMatchObject({
      tone: "done",
      title: "Made 2 changes",
      at: new Date(AT_RAN),
      hasDetails: true,
    });
    // What ran is read where it ran, not twice.
    expect(stepOf(made, "plan").hasDetails).toBe(false);

    expect(
      stepOf(
        mcpFix([
          call(1, ExternalMcpToolCallStatus.Succeeded),
          call(2, ExternalMcpToolCallStatus.Failed, {
            errorMessage: "quota exceeded",
          }),
        ]),
        "run",
      ),
    ).toMatchObject({
      tone: "failed",
      title: "1 of 2 changes failed",
      summary: "quota exceeded",
    });

    expect(
      stepOf(mcpFix([call(1, ExternalMcpToolCallStatus.Failed)]), "run").title,
    ).toBe("The change failed");
  });

  test("a runbook that was approved was started, with nothing more to open here", () => {
    const steps: Array<RemediationFixStep> = stepsOf(
      fix({
        status: AutoRemediationSuggestionStatus.Approved,
        suggestionType: AutoRemediationSuggestionType.Runbook,
        runbookNameSnapshot: "Restart checkout",
        approvedAt: new Date(AT_APPROVED),
      }),
    );

    expect(kinds(steps)).toEqual(["plan", "approval", "run"]);
    expect(stepOf(steps, "run")).toMatchObject({
      tone: "done",
      title: "Started the runbook",
      at: new Date(AT_APPROVED),
      hasDetails: false,
    });
  });
});

describe("whether it recovered", () => {
  function verified(
    status: AutoRemediationVerificationStatus,
    extra?: JSONObject,
  ): RemediationFixStep {
    return stepOf(
      stepsOf(
        fix({
          status: AutoRemediationSuggestionStatus.Approved,
          suggestionType: AutoRemediationSuggestionType.Runbook,
          verificationStatus: status,
          ...(extra || {}),
        }),
      ),
      "verify",
    );
  }

  test("being watched: for how long", () => {
    expect(
      verified(AutoRemediationVerificationStatus.Pending, {
        verificationWindowMinutes: 10,
      }),
    ).toMatchObject({
      tone: "live",
      title: "Watching for recovery…",
      summary: "OneUptime checks for up to 10 minutes whether it recovers.",
      isSummaryWritten: false,
      at: null,
    });
    expect(
      verified(AutoRemediationVerificationStatus.Pending, {
        verificationWindowMinutes: 1,
      }).summary,
    ).toBe("OneUptime checks for up to 1 minute whether it recovers.");
    expect(verified(AutoRemediationVerificationStatus.Pending).summary).toBe(
      null,
    );
  });

  test("recovered, did not, or not checked: the verifier's own words under it, and when", () => {
    expect(
      verified(AutoRemediationVerificationStatus.Verified, {
        verificationNote: "p95 latency was back under 500 ms.",
        verificationCompletedAt: new Date(AT_VERIFIED),
      }),
    ).toMatchObject({
      tone: "done",
      title: "Recovered",
      summary: "p95 latency was back under 500 ms.",
      isSummaryWritten: true,
      at: new Date(AT_VERIFIED),
      hasDetails: false,
    });
    expect(
      verified(AutoRemediationVerificationStatus.Failed, {
        verificationNote: "The service did not recover in time.",
      }),
    ).toMatchObject({ tone: "failed", title: "Did not recover" });
    expect(verified(AutoRemediationVerificationStatus.Skipped)).toMatchObject({
      tone: "idle",
      title: "Recovery not checked",
      summary: null,
    });
  });

  test("nothing verified, no step for it", () => {
    expect(
      kinds(
        stepsOf(
          fix({
            status: AutoRemediationSuggestionStatus.Approved,
            suggestionType: AutoRemediationSuggestionType.Runbook,
          }),
        ),
      ),
    ).toEqual(["plan", "approval", "run"]);
  });
});

describe("what was rolled back", () => {
  function rolledBack(plan: JSONObject): Array<RemediationFixStep> {
    return stepsOf(
      fix({
        status: AutoRemediationSuggestionStatus.AutoExecuted,
        verificationStatus: AutoRemediationVerificationStatus.Failed,
        commandPlan: {
          executionStatus: AiRemediationPlanExecutionStatus.Completed,
          ...plan,
        },
      }),
    );
  }

  test("the whole story of a fix that did not work, in the order it happened", () => {
    const steps: Array<RemediationFixStep> = rolledBack({
      commands: [
        command(1, {
          wasAutoExecuted: true,
          execution: ran(AiRemediationCommandExecutionStatus.Succeeded),
          rollbackExecution: ran(
            AiRemediationCommandExecutionStatus.Succeeded,
            { startedAt: AT_UNDONE, completedAt: AT_UNDONE },
          ),
        }),
      ],
      rollbackStatus: AiRemediationRollbackStatus.Completed,
    });

    expect(kinds(steps)).toEqual([
      "plan",
      "approval",
      "run",
      "verify",
      "rollback",
    ]);
    expect(stepOf(steps, "rollback")).toMatchObject({
      tone: "done",
      title: "Rolled back 1 command",
      summary: null,
      at: new Date(AT_UNDONE),
      hasDetails: true,
    });
  });

  test("a rollback that failed - or left an undo for a person - says to undo it by hand", () => {
    const failed: RemediationFixStep = stepOf(
      rolledBack({
        commands: [
          command(1, {
            execution: ran(AiRemediationCommandExecutionStatus.Succeeded),
            rollbackExecution: ran(AiRemediationCommandExecutionStatus.Failed),
          }),
        ],
        rollbackStatus: AiRemediationRollbackStatus.Failed,
      }),
      "rollback",
    );
    expect(failed).toMatchObject({
      tone: "failed",
      title: "Rollback failed",
      summary: "Undo the change by hand if it is still needed.",
      isSummaryWritten: false,
      hasDetails: true,
    });

    // Recorded "completed" before resumed rollbacks carried a skipped undo forward.
    const leftForAPerson: RemediationFixStep = stepOf(
      rolledBack({
        commands: [
          command(1, {
            execution: ran(AiRemediationCommandExecutionStatus.Succeeded),
            rollbackExecution: ran(AiRemediationCommandExecutionStatus.Skipped),
          }),
        ],
        rollbackStatus: AiRemediationRollbackStatus.Completed,
      }),
      "rollback",
    );
    expect(leftForAPerson.title).toBe("Rollback failed");
  });

  test("nothing to roll back: what it changed is still in place, and why", () => {
    const noUndo: RemediationFixStep = stepOf(
      rolledBack({
        commands: [
          command(1, {
            rollbackCommand: undefined,
            execution: ran(AiRemediationCommandExecutionStatus.Succeeded),
          }),
        ],
        rollbackStatus: AiRemediationRollbackStatus.NotApplicable,
      }),
      "rollback",
    );
    expect(noUndo).toMatchObject({
      tone: "idle",
      title: "Not rolled back",
      summary: "None of its commands has an undo.",
      hasDetails: false,
    });

    const putBack: RemediationFixStep = stepOf(
      rolledBack({
        commands: [
          command(1, {
            execution: ran(AiRemediationCommandExecutionStatus.Succeeded),
            revertWatch: {
              kind: "deployment",
              name: "web-1",
              namespace: "web",
              fields: [{ path: "spec.replicas", before: "4", after: "8" }],
              capturedAt: AT_RAN,
              putBackAt: AT_VERIFIED,
              putBackFields: ["spec.replicas"],
            },
          }),
        ],
        rollbackStatus: AiRemediationRollbackStatus.NotApplicable,
      }),
      "rollback",
    );
    expect(putBack.summary).toBe(
      "The cluster had already put back what it changed.",
    );
  });

  test("a rollback under way moves; one not started, or not needed, is no step", () => {
    expect(
      stepOf(
        rolledBack({
          commands: [
            command(1, {
              execution: ran(AiRemediationCommandExecutionStatus.Succeeded),
            }),
          ],
          rollbackHeartbeatAt: AT_UNDONE,
        }),
        "rollback",
      ),
    ).toMatchObject({ tone: "live", title: "Rolling back…" });

    expect(
      stepOf(
        rolledBack({
          commands: [
            command(1, {
              execution: ran(AiRemediationCommandExecutionStatus.Succeeded),
              rollbackExecution: {
                status: AiRemediationCommandExecutionStatus.Running,
              },
            }),
          ],
          rollbackStatus: AiRemediationRollbackStatus.NotAttempted,
        }),
        "rollback",
      ).tone,
    ).toBe("live");

    expect(
      kinds(
        rolledBack({
          commands: [
            command(1, {
              execution: ran(AiRemediationCommandExecutionStatus.Succeeded),
            }),
          ],
          rollbackStatus: AiRemediationRollbackStatus.NotAttempted,
        }),
      ),
    ).not.toContain("rollback");
  });
});

describe("the plan's sentence and the fix's failures", () => {
  function plan(commands: Array<JSONObject>): JSONObject {
    return { commands };
  }

  test("names each place its commands run once, in the order they run", () => {
    expect(
      getRemediationFixSentence({
        plan: { commands: [command(1)] } as never,
        mcpPlan: null,
      }),
    ).toBe("Planned 1 command on cluster prod-east");
    expect(
      getRemediationFixSentence({
        plan: plan([
          command(1),
          command(2, { kubernetesClusterNameSnapshot: "prod-west" }),
          command(3),
        ]) as never,
        mcpPlan: null,
      }),
    ).toBe("Planned 3 commands on cluster prod-east and cluster prod-west");
  });

  /*
   * A resource command names its kind as the middle of a sentence says it,
   * as a kubectl command's "cluster prod-east" does (#7862): never a
   * label's "Host web-1", nor "Database server web-1".
   */
  test("names a resource command's place as a sentence says it", () => {
    expect(
      getRemediationFixSentence({
        plan: plan([
          resourceCommand(1, "Host", "web-1"),
          resourceCommand(2, "Host", "web-1"),
        ]) as never,
        mcpPlan: null,
      }),
    ).toBe("Planned 2 commands on host web-1");
    expect(
      getRemediationFixSentence({
        plan: plan([
          resourceCommand(1, "Host", "web-1"),
          resourceCommand(2, "DatabaseServer", "orders-db"),
          resourceCommand(3, "DockerHost", "build-1"),
        ]) as never,
        mcpPlan: null,
      }),
    ).toBe(
      "Planned 3 commands on host web-1, database server orders-db and Docker host build-1",
    );
    // A kind this build does not know is a resource.
    expect(
      getRemediationFixSentence({
        plan: plan([resourceCommand(1, "Spaceship", "enterprise")]) as never,
        mcpPlan: null,
      }),
    ).toBe("Planned 1 command on resource enterprise");
  });

  test("nothing to say for a runbook, or a plan or list of changes with nothing in it", () => {
    expect(getRemediationFixSentence({ plan: null, mcpPlan: null })).toBe(null);
    expect(
      getRemediationFixSentence({
        plan: plan([]) as never,
        mcpPlan: { calls: [] },
      }),
    ).toBe(null);
  });

  test("counts a command whose undo failed among the failures, once", () => {
    expect(
      getRemediationFixFailedCount({
        plan: plan([
          command(1, {
            execution: ran(AiRemediationCommandExecutionStatus.Failed),
            rollbackExecution: ran(AiRemediationCommandExecutionStatus.Failed),
          }),
          command(2, {
            execution: ran(AiRemediationCommandExecutionStatus.Skipped),
          }),
        ]) as never,
        mcpPlan: null,
      }),
    ).toBe(1);
  });
});

describe("the fixes in the order OneUptime AI tried them", () => {
  test("oldest first; fixes of the same moment keep the server's order", () => {
    const fixes: Array<{ id: string; createdAt: Date }> = [
      { id: "round-2", createdAt: new Date("2026-09-14T18:15:02.000Z") },
      { id: "runbook", createdAt: new Date("2026-09-14T18:04:30.000Z") },
      { id: "first", createdAt: new Date(AT_PLANNED) },
      { id: "same-a", createdAt: new Date(AT_PLANNED) },
    ];

    expect(
      sortRemediationFixesOldestFirst(fixes).map(
        (entry: { id: string }): string => {
          return entry.id;
        },
      ),
    ).toEqual(["first", "same-a", "runbook", "round-2"]);
  });

  test("a step's key is its fix's and its own", () => {
    expect(getRemediationFixStepKey("fix-1", "run")).toBe("fix-1:step:run");
    expect(getRemediationFixStepKey("fix-1", "run")).not.toBe(
      getRemediationFixStepKey("fix-2", "run"),
    );
  });

  test("a moment is a Date, the API's text of one, or nothing", () => {
    expect(readRemediationMoment(AT_RAN)).toEqual(new Date(AT_RAN));
    expect(readRemediationMoment(new Date(AT_RAN))).toEqual(new Date(AT_RAN));
    expect(readRemediationMoment("not a date")).toBe(null);
    expect(readRemediationMoment(undefined)).toBe(null);
    expect(readRemediationMoment("")).toBe(null);
  });
});

/*
 * In the reader's language: every step's words are looked up whole, from
 * the shipped locale files, so a fix reads in one language - and a name in
 * Latin letters in a Persian sentence is set apart, so the list keeps its
 * order right to left.
 */
describe("in the reader's language", () => {
  const LOCALES_DIR: string = path.resolve(
    __dirname,
    "../../../../App/FeatureSet/Dashboard/src/Locales",
  );

  function translatorFor(language: string): {
    translator: Translator;
    words: Record<string, string>;
  } {
    const words: Record<string, string> = JSON.parse(
      fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
    ) as Record<string, string>;

    return {
      words,
      translator: createTranslator((text: string): string | undefined => {
        return words[text];
      }, language),
    };
  }

  function rolledBackFix(): RemediationFixStepSuggestion {
    return fix({
      status: AutoRemediationSuggestionStatus.AutoExecuted,
      verificationStatus: AutoRemediationVerificationStatus.Failed,
      commandPlan: {
        commands: [
          command(1, {
            wasAutoExecuted: true,
            execution: ran(AiRemediationCommandExecutionStatus.Succeeded),
            rollbackExecution: ran(
              AiRemediationCommandExecutionStatus.Succeeded,
            ),
          }),
          command(2, {
            wasAutoExecuted: true,
            execution: ran(AiRemediationCommandExecutionStatus.Succeeded),
            rollbackExecution: ran(
              AiRemediationCommandExecutionStatus.Succeeded,
            ),
          }),
        ],
        executionStatus: AiRemediationPlanExecutionStatus.Completed,
        rollbackStatus: AiRemediationRollbackStatus.Completed,
      },
    });
  }

  test("a fix that did not work reads in Japanese, step by step", () => {
    const { translator, words } = translatorFor("ja");
    const titles: Array<string> = getRemediationFixSteps({
      suggestion: rolledBackFix(),
      translator,
    }).map((step: RemediationFixStep): string => {
      return step.title;
    });

    expect(titles).toEqual([
      words["Planned {{count}} commands on {{targets}}"]!.replace(
        "{{count}}",
        "2",
      ).replace(
        "{{targets}}",
        words["cluster {{name}}"]!.replace("{{name}}", "prod-east"),
      ),
      words["Approved automatically"],
      words["Ran {{count}} commands"]!.replace("{{count}}", "2"),
      words["Did not recover"],
      words["Rolled back {{count}} commands"]!.replace("{{count}}", "2"),
    ]);
    // Not one English word left in them.
    for (const title of titles) {
      expect(title).not.toMatch(/Planned|Approved|Ran|recover|Rolled/);
    }
  });

  /*
   * A resource command's kind in the reader's words, as the middle of a
   * sentence says it (#7862): "sur hôte web-1", never "sur Hôte web-1", and
   * a database server never "Database server" in English. German keeps its
   * nouns' capital.
   */
  test.each([
    [
      "fr",
      "2 commandes prévues sur hôte web-1 et serveur de base de données orders-db",
    ],
    ["da", "Planlagde 2 kommandoer på vært web-1 og databaseserver orders-db"],
    ["de", "2 Befehle auf Host web-1 und Datenbankserver orders-db geplant"],
    [
      "ru",
      "Запланировано команд: 2 (хост web-1 и сервер баз данных orders-db)",
    ],
  ])(
    "in %s, a resource command's place reads %s",
    (language: string, expected: string) => {
      const { translator } = translatorFor(language);

      expect(
        withoutIsolateMarks(
          getRemediationFixSentence({
            plan: {
              commands: [
                resourceCommand(1, "Host", "web-1"),
                resourceCommand(2, "DatabaseServer", "orders-db"),
              ],
            } as never,
            mcpPlan: null,
            translator,
          })!,
        ),
      ).toBe(expected);
    },
  );

  /*
   * The kind goes in as a term for the middle of a sentence: worded with a
   * label's capital, it still reads in lower case in the plan's sentence
   * and on the command's row.
   */
  test("a kind worded with a label's capital reads lower case in the sentence and on the row", () => {
    const { words } = translatorFor("fr");
    const asLabel: Translator = createTranslator(
      (text: string): string | undefined => {
        return text === "host" ? "Hôte" : words[text];
      },
      "fr",
    );

    expect(
      withoutIsolateMarks(
        getRemediationFixSentence({
          plan: { commands: [resourceCommand(1, "Host", "web-1")] } as never,
          mcpPlan: null,
          translator: asLabel,
        })!,
      ),
    ).toBe("1 commande prévue sur hôte web-1");
    expect(
      getCommandTargetLabel(
        resourceCommand(1, "Host", "web-1") as never,
        asLabel,
      ),
    ).toBe("hôte web-1");
  });

  test("in Persian, each server is set apart, so the plan's list reads in its order right to left", () => {
    const { translator, words } = translatorFor("fa");
    const call: (sequence: number, server: string) => JSONObject = (
      sequence: number,
      server: string,
    ): JSONObject => {
      return {
        sequence,
        serverId: `s${sequence}`,
        serverNameSnapshot: server,
        toolName: "set_flag",
        arguments: {},
        status: ExternalMcpToolCallStatus.Succeeded,
      };
    };
    const sentence: string = getRemediationFixSentence({
      plan: null,
      mcpPlan: {
        calls: [call(1, "Feature flags"), call(2, "Status page")],
      } as never,
      translator,
    })!;

    expect(words["{{items}} and {{last}}"]).toBe("{{items}} و {{last}}");
    expect(withoutIsolateMarks(sentence)).toBe(
      words["Planned {{count}} changes through {{servers}}"]!.replace(
        "{{count}}",
        "۲",
      ).replace("{{servers}}", "Feature flags و Status page"),
    );
    const first: number = sentence.indexOf(isolated("Feature flags"));
    const and: number = sentence.indexOf(" و ");
    const second: number = sentence.indexOf(isolated("Status page"));
    expect(first).toBeGreaterThan(-1);
    expect(and).toBeGreaterThan(first);
    expect(second).toBeGreaterThan(and);
  });
});
