import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  canOfferRemediationTryAgain,
  getRemediationFixFacts,
  getRemediationStepStatus,
  isRemediationWaitingForInvestigation,
  REMEDIATION_STEP_STATUS_TEXT,
  RemediationFixFacts,
  RemediationStepStatus,
  RemediationStepStatusInput,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AutoRemediation/RemediationStepStatus";
import {
  RemediationDecision,
  RemediationDecisionLine,
  RemediationDecisionTone,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AutoRemediation/RemediationDecisionLines";
import { AIInvestigationStage } from "../../../../App/FeatureSet/Dashboard/src/Components/AI/AIInvestigationStatus";
import AutoRemediationSuggestion from "../../../Models/DatabaseModels/AutoRemediationSuggestion";
import {
  AiRemediationPlanExecutionStatus,
  AiRemediationCommandPolicyVerdict,
} from "../../../Types/AutoRemediation/AiRemediationCommandPlan";
import {
  AutoRemediationDecisionLane,
  AutoRemediationDecisionReason,
  AutoRemediationDecisionStage,
} from "../../../Types/AutoRemediation/AutoRemediationDecision";
import AutoRemediationSuggestionStatus from "../../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import AutoRemediationSuggestionType from "../../../Types/AutoRemediation/AutoRemediationSuggestionType";
import AutoRemediationVerificationStatus from "../../../Types/AutoRemediation/AutoRemediationVerificationStatus";
import {
  ExternalMcpToolCallPlanUtil,
  ExternalMcpToolCallStatus,
} from "../../../Types/AutoRemediation/ExternalMcpToolCallPlan";
import { JSONObject } from "../../../Types/JSON";
import { KubectlCommandTier } from "../../../Types/Kubernetes/KubernetesClusterAiAccess";
import RunbookStepType from "../../../Types/Runbook/RunbookStepType";
import { FinishedFixOutcome } from "../../../Utils/Suggestions/CodeFixSuggestion";
import {
  InvestigationCodeFixSuggestion,
  NO_INVESTIGATION_CODE_FIX_SUGGESTION,
} from "../../../Utils/Suggestions/InvestigationCodeFixSuggestion";
import SuggestionOffer from "../../../Utils/Suggestions/SuggestionOffer";

/*
 * THE REMEDIATION STEP'S PILL, AND WHETHER TRY AGAIN IS OFFERED (block 43).
 *
 * The AI card's second step says where fixing stands before a sentence is
 * read - "Currently, it looks like there's no remediation happening" was
 * the maintainer's - and offers Try again only when deciding again may
 * find something new. Both are read from what the step already holds: the
 * decision's lines, the fixes, where the investigation stands, and the fix
 * in the code the investigation recommends.
 */

function command(execution?: JSONObject): JSONObject {
  return {
    sequence: 1,
    stepType: RunbookStepType.Kubectl,
    runnerId: "0193c0de-1111-4aaa-8bbb-000000000001",
    runnerNameSnapshot: "kubernetes-agent/prod-east",
    kubernetesClusterId: "0193c0de-2222-4aaa-8bbb-000000000002",
    kubernetesClusterNameSnapshot: "prod-east",
    kubectlTier: KubectlCommandTier.SafeWrite,
    command: "kubectl rollout restart deployment/web -n web",
    timeoutInMs: 60000,
    rationale: "Pods are crash-looping after a config change.",
    expectedEffect: "Fresh pods pick up the corrected config.",
    policyVerdict: AiRemediationCommandPolicyVerdict.RequiresApproval,
    wasAutoExecuted: false,
    ...(execution ? { execution } : {}),
  };
}

function sshCommand(): JSONObject {
  return {
    ...command(),
    stepType: RunbookStepType.SSH,
    command: "systemctl restart web",
  };
}

function suggestion(data: {
  status: AutoRemediationSuggestionStatus;
  type?: AutoRemediationSuggestionType;
  commands?: Array<JSONObject>;
  executionStatus?: AiRemediationPlanExecutionStatus;
  verificationStatus?: AutoRemediationVerificationStatus;
  mcpCalls?: Array<ExternalMcpToolCallStatus>;
}): AutoRemediationSuggestion {
  const row: AutoRemediationSuggestion = Object.assign(
    new AutoRemediationSuggestion(),
    {
      status: data.status,
      suggestionType:
        data.type ||
        (data.commands
          ? AutoRemediationSuggestionType.CommandPlan
          : data.mcpCalls
            ? AutoRemediationSuggestionType.McpToolCalls
            : AutoRemediationSuggestionType.Runbook),
    },
  );

  if (data.commands) {
    row.commandPlan = {
      commands: data.commands,
      ...(data.executionStatus
        ? { executionStatus: data.executionStatus }
        : {}),
    };
  }

  if (data.mcpCalls) {
    row.mcpToolCallPlan = ExternalMcpToolCallPlanUtil.toJSON({
      calls: data.mcpCalls.map(
        (status: ExternalMcpToolCallStatus, index: number) => {
          return {
            sequence: index + 1,
            serverId: "0193c0de-3333-4aaa-8bbb-000000000003",
            serverNameSnapshot: "AWS",
            toolName: "restart_service",
            arguments: { service: "api" },
            status,
          };
        },
      ),
    });
  }

  if (data.verificationStatus) {
    row.verificationStatus = data.verificationStatus;
  }

  return row;
}

function facts(data: Parameters<typeof suggestion>[0]): RemediationFixFacts {
  return getRemediationFixFacts(suggestion(data));
}

function line(tone: RemediationDecisionTone): RemediationDecisionLine {
  return { key: `line-${tone}`, tone, text: `A ${tone} line.`, links: [] };
}

const EVALUATED: RemediationDecision = {
  stage: AutoRemediationDecisionStage.Evaluated,
  entries: [
    {
      lane: AutoRemediationDecisionLane.Rule,
      reason: AutoRemediationDecisionReason.NoRulesConfigured,
    },
  ],
};

const WAITING: RemediationDecision = {
  stage: AutoRemediationDecisionStage.WaitingForInvestigation,
  entries: [],
};

function decisionOf(
  reason: AutoRemediationDecisionReason,
  lane: AutoRemediationDecisionLane = AutoRemediationDecisionLane.Project,
): RemediationDecision {
  return {
    stage: AutoRemediationDecisionStage.Evaluated,
    entries: [{ lane, reason }],
  };
}

function codeFix(
  offer: SuggestionOffer,
  fixOutcome: FinishedFixOutcome | null = null,
): InvestigationCodeFixSuggestion {
  return {
    ...NO_INVESTIGATION_CODE_FIX_SUGGESTION,
    offer,
    fixOutcome,
    aiRunId:
      offer === SuggestionOffer.InProgress || offer === SuggestionOffer.Done
        ? "0193c0de-4444-4aaa-8bbb-000000000004"
        : null,
  };
}

function statusOf(
  input: Partial<RemediationStepStatusInput>,
): RemediationStepStatus {
  return getRemediationStepStatus({
    isLoaded: true,
    decision: EVALUATED,
    lines: [],
    fixes: [],
    investigationStage: "reported",
    codeFix: null,
    isOffByChoice: false,
    ...input,
  });
}

const TEXT: typeof REMEDIATION_STEP_STATUS_TEXT = REMEDIATION_STEP_STATUS_TEXT;

describe("getRemediationFixFacts: one fix as the pill reads it", () => {
  test("a fix being worked out is in progress, and has not run", () => {
    expect(
      facts({ status: AutoRemediationSuggestionStatus.Planning }),
    ).toMatchObject({ isInProgress: true, hasRun: false, hasFailed: false });
  });

  test("a runbook waiting for approval is neither moving nor run", () => {
    expect(
      facts({ status: AutoRemediationSuggestionStatus.Suggested }),
    ).toEqual({
      status: AutoRemediationSuggestionStatus.Suggested,
      isUnapprovable: false,
      isInProgress: false,
      hasRun: false,
      hasFailed: false,
      isVerified: false,
    });
  });

  test("a plan holding an SSH command waits for an approval nobody can give", () => {
    expect(
      facts({
        status: AutoRemediationSuggestionStatus.Suggested,
        commands: [command(), sshCommand()],
      }).isUnapprovable,
    ).toBe(true);
    // Once settled, it waits for nothing.
    expect(
      facts({
        status: AutoRemediationSuggestionStatus.Dismissed,
        commands: [sshCommand()],
      }).isUnapprovable,
    ).toBe(false);
  });

  test.each<
    [
      string,
      AiRemediationPlanExecutionStatus | undefined,
      Partial<RemediationFixFacts>,
    ]
  >([
    // Approved, and the sweep has not picked it up yet.
    ["not started", undefined, { isInProgress: true, hasRun: false }],
    [
      "running",
      AiRemediationPlanExecutionStatus.Running,
      { isInProgress: true, hasRun: false },
    ],
    [
      "completed",
      AiRemediationPlanExecutionStatus.Completed,
      { isInProgress: false, hasRun: true, hasFailed: false },
    ],
    [
      "failed",
      AiRemediationPlanExecutionStatus.Failed,
      { isInProgress: false, hasRun: true, hasFailed: true },
    ],
  ])(
    "an approved command plan whose run is %s",
    (
      _case: string,
      executionStatus: AiRemediationPlanExecutionStatus | undefined,
      expected: Partial<RemediationFixFacts>,
    ) => {
      expect(
        facts({
          status: AutoRemediationSuggestionStatus.Approved,
          commands: [command()],
          ...(executionStatus ? { executionStatus } : {}),
        }),
      ).toMatchObject(expected);
    },
  );

  test("a runbook that ran on its own has run", () => {
    expect(
      facts({ status: AutoRemediationSuggestionStatus.AutoExecuted }),
    ).toMatchObject({ isInProgress: false, hasRun: true });
  });

  test.each<[AutoRemediationVerificationStatus, Partial<RemediationFixFacts>]>([
    [
      AutoRemediationVerificationStatus.Pending,
      { isInProgress: true, hasRun: false },
    ],
    [
      AutoRemediationVerificationStatus.Verified,
      { isVerified: true, hasRun: true, hasFailed: false },
    ],
    [
      AutoRemediationVerificationStatus.Failed,
      { isVerified: false, hasRun: true, hasFailed: true },
    ],
  ])(
    "a fix that ran and whose recovery check is %s",
    (
      verificationStatus: AutoRemediationVerificationStatus,
      expected: Partial<RemediationFixFacts>,
    ) => {
      expect(
        facts({
          status: AutoRemediationSuggestionStatus.AutoExecuted,
          verificationStatus,
        }),
      ).toMatchObject(expected);
    },
  );

  test("a fix through MCP servers is moving while a change is on its way or not sent yet", () => {
    expect(
      facts({
        status: AutoRemediationSuggestionStatus.Approved,
        mcpCalls: [ExternalMcpToolCallStatus.Running],
      }).isInProgress,
    ).toBe(true);
    expect(
      facts({
        status: AutoRemediationSuggestionStatus.Approved,
        mcpCalls: [
          ExternalMcpToolCallStatus.Succeeded,
          ExternalMcpToolCallStatus.Proposed,
        ],
      }).isInProgress,
    ).toBe(true);
    expect(
      facts({
        status: AutoRemediationSuggestionStatus.Approved,
        mcpCalls: [ExternalMcpToolCallStatus.Succeeded],
      }),
    ).toMatchObject({ isInProgress: false, hasRun: true });
    // Waiting for approval, its proposed changes are not on their way.
    expect(
      facts({
        status: AutoRemediationSuggestionStatus.Suggested,
        mcpCalls: [ExternalMcpToolCallStatus.Proposed],
      }).isInProgress,
    ).toBe(false);
  });
});

describe("isRemediationWaitingForInvestigation", () => {
  test("a decision that waits waits; an evaluated one never does", () => {
    expect(
      isRemediationWaitingForInvestigation({
        decision: WAITING,
        investigationStage: "reported",
      }),
    ).toBe(true);
    expect(
      isRemediationWaitingForInvestigation({
        decision: EVALUATED,
        investigationStage: "underway",
      }),
    ).toBe(false);
  });

  test.each<[AIInvestigationStage, boolean]>([
    ["checking", true],
    ["underway", true],
    ["reported", false],
    ["none", false],
  ])(
    "with nothing written down yet, an investigation %s means it waits: %s",
    (investigationStage: AIInvestigationStage, expected: boolean) => {
      expect(
        isRemediationWaitingForInvestigation({
          decision: null,
          investigationStage,
        }),
      ).toBe(expected);
    },
  );
});

describe("getRemediationStepStatus: where fixing stands, in a few words", () => {
  test("still reading: checking", () => {
    expect(statusOf({ isLoaded: false })).toEqual({
      tone: "checking",
      text: TEXT.checking,
    });
  });

  test("a fix waiting for the reader's approval comes first, whatever else is going on", () => {
    expect(
      statusOf({
        fixes: [
          facts({ status: AutoRemediationSuggestionStatus.Planning }),
          facts({ status: AutoRemediationSuggestionStatus.Suggested }),
        ],
        lines: [line("attention")],
        decision: WAITING,
      }),
    ).toEqual({ tone: "attention", text: TEXT.needsApproval });
  });

  test("a plan nobody can approve asks for no approval", () => {
    expect(
      statusOf({
        fixes: [
          facts({
            status: AutoRemediationSuggestionStatus.Suggested,
            commands: [sshCommand()],
          }),
        ],
      }).text,
    ).not.toBe(TEXT.needsApproval);
  });

  test("a fix on its way, or a pull request being written: fixing", () => {
    expect(
      statusOf({
        fixes: [facts({ status: AutoRemediationSuggestionStatus.Planning })],
      }),
    ).toEqual({ tone: "live", text: TEXT.fixing });
    expect(statusOf({ codeFix: codeFix(SuggestionOffer.InProgress) })).toEqual({
      tone: "live",
      text: TEXT.fixing,
    });
  });

  test("a decision that waits for the investigation, or none while it runs: waiting", () => {
    expect(statusOf({ decision: WAITING })).toEqual({
      tone: "waiting",
      text: TEXT.waiting,
    });
    expect(
      statusOf({ decision: null, investigationStage: "underway" }),
    ).toEqual({ tone: "waiting", text: TEXT.waiting });
  });

  test.each<
    [string, Partial<RemediationStepStatusInput>, RemediationStepStatus]
  >([
    [
      "a fix the record recovered after: fixed",
      {
        fixes: [
          facts({
            status: AutoRemediationSuggestionStatus.AutoExecuted,
            verificationStatus: AutoRemediationVerificationStatus.Verified,
          }),
        ],
      },
      { tone: "done", text: TEXT.fixed },
    ],
    [
      "a fix whose run failed: didn't work",
      {
        fixes: [
          facts({
            status: AutoRemediationSuggestionStatus.Approved,
            commands: [command()],
            executionStatus: AiRemediationPlanExecutionStatus.Failed,
          }),
        ],
      },
      { tone: "failed", text: TEXT.didNotWork },
    ],
    [
      "a fix that ran, recovery not checked: applied",
      {
        fixes: [
          facts({ status: AutoRemediationSuggestionStatus.AutoExecuted }),
        ],
      },
      { tone: "done", text: TEXT.fixApplied },
    ],
    [
      "a pull request opened: opened",
      { codeFix: codeFix(SuggestionOffer.Done, FinishedFixOutcome.Fixed) },
      { tone: "done", text: TEXT.pullRequestOpened },
    ],
    [
      "a pull request waiting for an answer in Code: needs your answer",
      {
        codeFix: codeFix(
          SuggestionOffer.Done,
          FinishedFixOutcome.WaitingForYou,
        ),
      },
      { tone: "attention", text: TEXT.needsYourAnswer },
    ],
    [
      "the code read and nothing to change: no change needed",
      {
        codeFix: codeFix(
          SuggestionOffer.Done,
          FinishedFixOutcome.NothingToChange,
        ),
      },
      { tone: "idle", text: TEXT.noChangeNeeded },
    ],
    [
      "a line that needs looking at: needs attention",
      { lines: [line("info"), line("attention")] },
      { tone: "attention", text: TEXT.needsAttention },
    ],
    [
      "a pull request one setup step away: needs attention",
      { codeFix: codeFix(SuggestionOffer.SetUp) },
      { tone: "attention", text: TEXT.needsAttention },
    ],
    [
      "every fix dismissed: dismissed",
      {
        fixes: [
          facts({ status: AutoRemediationSuggestionStatus.Dismissed }),
          facts({ status: AutoRemediationSuggestionStatus.Dismissed }),
        ],
      },
      { tone: "idle", text: TEXT.dismissed },
    ],
    [
      "no runbook applied: no fix found",
      {
        fixes: [
          facts({ status: AutoRemediationSuggestionStatus.NoneApplicable }),
        ],
      },
      { tone: "idle", text: TEXT.noFixFound },
    ],
    [
      "some dismissed, some found nothing: no action taken",
      {
        fixes: [
          facts({ status: AutoRemediationSuggestionStatus.Dismissed }),
          facts({ status: AutoRemediationSuggestionStatus.NoneApplicable }),
        ],
      },
      { tone: "idle", text: TEXT.noActionTaken },
    ],
    [
      "a fix started whose row is on its way: fixing",
      { lines: [line("acted")] },
      { tone: "live", text: TEXT.fixing },
    ],
    [
      "nothing ever written down: not tried",
      { decision: null },
      { tone: "idle", text: TEXT.notTried },
    ],
    [
      "off by the project's choice: off",
      { lines: [line("info")], isOffByChoice: true },
      { tone: "idle", text: TEXT.off },
    ],
    [
      "how things stand, nothing done: no action taken",
      { lines: [line("info")] },
      { tone: "idle", text: TEXT.noActionTaken },
    ],
  ])(
    "%s",
    (
      _case: string,
      input: Partial<RemediationStepStatusInput>,
      expected: RemediationStepStatus,
    ) => {
      expect(statusOf(input)).toEqual(expected);
    },
  );

  test("a fix in progress outranks a wait, a wait outranks what was found", () => {
    expect(
      statusOf({
        decision: WAITING,
        fixes: [facts({ status: AutoRemediationSuggestionStatus.Planning })],
      }).text,
    ).toBe(TEXT.fixing);
    expect(
      statusOf({ decision: WAITING, lines: [line("attention")] }).text,
    ).toBe(TEXT.waiting);
  });

  test("every word the pill says is a key of the Dashboard's English locale", () => {
    const english: Record<string, string> = JSON.parse(
      fs.readFileSync(
        path.resolve(
          __dirname,
          "../../../../App/FeatureSet/Dashboard/src/Locales/en.json",
        ),
        "utf8",
      ),
    ) as Record<string, string>;

    for (const text of Object.values(TEXT)) {
      expect({ text, inLocale: english[text] }).toEqual({
        text,
        inLocale: text,
      });
    }
  });
});

describe("canOfferRemediationTryAgain: only when deciding again may find something new", () => {
  function offered(
    input: Partial<Parameters<typeof canOfferRemediationTryAgain>[0]>,
  ): boolean {
    return canOfferRemediationTryAgain({
      isLoaded: true,
      isRecordResolved: false,
      decision: EVALUATED,
      lines: [line("info")],
      fixes: [],
      investigationStage: "reported",
      codeFix: null,
      ...input,
    });
  }

  test("a decision that fixed nothing, on an open record: offered", () => {
    expect(offered({})).toBe(true);
    // A decision never written down is worth deciding too.
    expect(offered({ decision: null, lines: [] })).toBe(true);
  });

  test("never before the step has read, nor on a resolved record", () => {
    expect(offered({ isLoaded: false })).toBe(false);
    expect(offered({ isRecordResolved: true })).toBe(false);
  });

  test("Enable AI that was off: only once it is known to be on now", () => {
    const decision: RemediationDecision = decisionOf(
      AutoRemediationDecisionReason.EnableAiOff,
    );

    expect(offered({ decision })).toBe(false);
    expect(offered({ decision, switchesNow: { isAiOn: undefined } })).toBe(
      false,
    );
    expect(offered({ decision, switchesNow: { isAiOn: false } })).toBe(false);
    expect(offered({ decision, switchesNow: { isAiOn: true } })).toBe(true);
  });

  test("fixing that was off: only once it is known to be on now", () => {
    const decision: RemediationDecision = decisionOf(
      AutoRemediationDecisionReason.RemediationOff,
    );

    expect(offered({ decision })).toBe(false);
    expect(offered({ decision, switchesNow: { isFixingOn: false } })).toBe(
      false,
    );
    // Enable AI on says nothing about the fixing switch.
    expect(offered({ decision, switchesNow: { isAiOn: true } })).toBe(false);
    expect(offered({ decision, switchesNow: { isFixingOn: true } })).toBe(true);
  });

  test("not while fixing waits for the investigation", () => {
    expect(offered({ decision: WAITING })).toBe(false);
    expect(offered({ decision: null, investigationStage: "underway" })).toBe(
      false,
    );
  });

  test("not with a fix to show, or one that started", () => {
    expect(
      offered({
        fixes: [facts({ status: AutoRemediationSuggestionStatus.Dismissed })],
      }),
    ).toBe(false);
    expect(offered({ lines: [line("acted")] })).toBe(false);
  });

  test.each<[SuggestionOffer, boolean]>([
    [SuggestionOffer.None, true],
    [SuggestionOffer.Act, true],
    [SuggestionOffer.SetUp, true],
    [SuggestionOffer.InProgress, false],
    [SuggestionOffer.Done, false],
  ])(
    "beside a fix in the code that is %s: offered %s",
    (offer: SuggestionOffer, expected: boolean) => {
      expect(offered({ codeFix: codeFix(offer) })).toBe(expected);
    },
  );
});
