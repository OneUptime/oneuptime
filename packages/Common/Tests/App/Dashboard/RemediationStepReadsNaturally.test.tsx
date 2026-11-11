import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, screen, within } from "@testing-library/react";
import * as React from "react";

// Only rendered when a step's reasoning is opened; keep the lazy import out.
jest.mock("../../../UI/Components/Markdown.tsx/LazyMarkdownViewer", () => {
  return {
    __esModule: true,
    default: (props: { text: string }): React.ReactElement => {
      return React.createElement(
        "div",
        { "data-testid": "markdown" },
        props.text,
      );
    },
  };
});

import RemediationStep from "../../../../App/FeatureSet/Dashboard/src/Components/AutoRemediation/RemediationStep";
import AutoRemediationDecision from "../../../Models/DatabaseModels/AutoRemediationDecision";
import AutoRemediationSuggestion from "../../../Models/DatabaseModels/AutoRemediationSuggestion";
import {
  AiRemediationCommandPolicyVerdict,
  AiRemediationPlanExecutionStatus,
} from "../../../Types/AutoRemediation/AiRemediationCommandPlan";
import AutoRemediationSuggestionStatus from "../../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import AutoRemediationSuggestionType from "../../../Types/AutoRemediation/AutoRemediationSuggestionType";
import AutoRemediationVerificationStatus from "../../../Types/AutoRemediation/AutoRemediationVerificationStatus";
import { getClusterRoundNameSnapshot } from "../../../Types/AutoRemediation/RemediationRoundName";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import { JSONObject } from "../../../Types/JSON";
import { KubectlCommandTier } from "../../../Types/Kubernetes/KubernetesClusterAiAccess";
import ObjectID from "../../../Types/ObjectID";
import RunbookStepType from "../../../Types/Runbook/RunbookStepType";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import { goTo, PROJECT_ID } from "./SideMenuHarness";

/*
 * ISSUE #6860: "Can we make this UI 10x better? Please make it natural to
 * understand."
 *
 * The issue's screenshot is an alert's Remediation step after OneUptime AI
 * tried two fixes and found neither. It read, top to bottom:
 *
 *   OneUptime AI is fixing cluster "oneuptime-test". Approvals are bypassed
 *   on this cluster, so its fixes run on their own.
 *   Rule "All alerts" matched: OneUptime AI is fixing this alert.
 *   Rule "All alerts" matched: OneUptime AI is picking the runbook that
 *   fits this alert.
 *   AI kubectl fix                                     • No safe fix found
 *   AI remediation for cluster "oneuptime-test"
 *     Found no safe fix
 *     🧠 AI — Automated Root Cause Analysis I'll verify the current state…
 *   No runbook                                       • No runbook applies
 *   Rule: All alerts
 *     Found no runbook that applies
 *     🧠 AI — Automated Root Cause Analysis **Summary** — Alert #410 is…
 *
 * Three lines in the present tense about work that had ended, each fix's
 * outcome said three times (its fact, its step, the pill), "AI" in every
 * name, and a preview of the report's heading. It now opens with what came
 * of it, in one sentence; each fix is named for what it is, from the rule
 * it came from; what the fixes say is not said again over them; and the
 * preview is the AI's answer.
 */

const ALERT_ID: ObjectID = new ObjectID("0193c0de-3333-4aaa-8bbb-000000000410");
const CLUSTER_ID: string = "0193c0de-5555-4aaa-8bbb-000000000025";
const RULE_ID: string = "0193c0de-8888-4aaa-8bbb-000000000028";
const AGENT_ID: string = "0193c0de-7777-4aaa-8bbb-000000000027";

// A round's answer as the engine posts it (buildBrandedMarkdown).
function branded(analysis: string): string {
  return [
    "## 🧠 AI — Automated Root Cause Analysis",
    "",
    analysis,
    "",
    "**Evidence checked**",
    "- **[C1]** kubectl get pods -n clickhouse — succeeded",
    "",
    "---",
    "*Investigated automatically by OneUptime AI — read-only, 1 kubectl command run on your Kubernetes clusters using gpt-test. This is an AI-generated first pass; verify before acting.*",
  ].join("\n");
}

const CLUSTER_ANSWER: string = branded(
  [
    "I'll verify the current state of the pod before deciding on a fix.",
    "",
    "**Summary** — The ClickHouse pod restarted after it ran out of memory [C1]. Restarting it again would not help.",
  ].join("\n"),
);

const RUNBOOK_ANSWER: string = branded(
  [
    "**Summary** — Alert #410 is a ClickHouse pod in CrashLoopBackOff; none of the project's runbooks addresses an out-of-memory restart.",
    "",
    "SelectedRunbook: none",
  ].join("\n"),
);

const SCREENSHOT_DECISION: JSONObject = {
  stage: "Evaluated",
  createdAt: new Date("2026-11-10T09:00:00Z"),
  entries: [
    {
      lane: "KubernetesCluster",
      reason: "ClusterRoundStarted",
      kubernetesClusterId: CLUSTER_ID,
      kubernetesClusterName: "oneuptime-test",
      remediationMode: "BypassApproval",
    },
    {
      lane: "Rule",
      reason: "RuleMatchedAiFix",
      ruleId: RULE_ID,
      ruleName: "All alerts",
    },
    {
      lane: "Rule",
      reason: "RuleAiPickingRunbook",
      ruleId: RULE_ID,
      ruleName: "All alerts",
    },
  ],
};

function kubectlCommand(): JSONObject {
  return {
    sequence: 1,
    stepType: RunbookStepType.Kubectl,
    runnerId: AGENT_ID,
    runnerNameSnapshot: "Kubernetes AI agent",
    kubernetesClusterId: CLUSTER_ID,
    kubernetesClusterNameSnapshot: "oneuptime-test",
    kubectlTier: KubectlCommandTier.SafeWrite,
    command: "kubectl rollout restart statefulset/clickhouse -n clickhouse",
    timeoutInMs: 60000,
    rationale: "The pod holds a stale config.",
    expectedEffect: "A fresh pod picks it up.",
    policyVerdict: AiRemediationCommandPolicyVerdict.AutoApproved,
  };
}

function clusterRound(
  status: AutoRemediationSuggestionStatus,
  extra: Partial<Record<string, unknown>> = {},
): AutoRemediationSuggestion {
  return Object.assign(new AutoRemediationSuggestion(), {
    _id: "0193c0de-6666-4aaa-8bbb-000000000061",
    status,
    suggestionType: AutoRemediationSuggestionType.CommandPlan,
    kubernetesClusterId: new ObjectID(CLUSTER_ID),
    ruleNameSnapshot: getClusterRoundNameSnapshot("oneuptime-test", 1),
    rationaleMarkdown: CLUSTER_ANSWER,
    commandPlan: { commands: [] } as JSONObject,
    createdAt: new Date("2026-11-10T09:00:01Z"),
    ...extra,
  });
}

function rulesRunbookPick(
  status: AutoRemediationSuggestionStatus,
): AutoRemediationSuggestion {
  return Object.assign(new AutoRemediationSuggestion(), {
    _id: "0193c0de-6666-4aaa-8bbb-000000000062",
    status,
    suggestionType: AutoRemediationSuggestionType.Runbook,
    autoRemediationRuleId: new ObjectID(RULE_ID),
    ruleNameSnapshot: "All alerts",
    rationaleMarkdown: RUNBOOK_ANSWER,
    createdAt: new Date("2026-11-10T09:00:02Z"),
  });
}

function serve(
  suggestions: Array<AutoRemediationSuggestion>,
  decisions: Array<JSONObject> = [SCREENSHOT_DECISION],
): void {
  jest.spyOn(ModelAPI, "getList").mockImplementation((async (data: {
    modelType: { new (): unknown };
  }): Promise<
    ListResult<AutoRemediationDecision | AutoRemediationSuggestion>
  > => {
    if (data.modelType === AutoRemediationDecision) {
      const rows: Array<AutoRemediationDecision> = decisions.map(
        (row: JSONObject) => {
          return Object.assign(new AutoRemediationDecision(), row);
        },
      );
      return { data: rows, count: rows.length, skip: 0, limit: 5 };
    }

    return {
      data: suggestions,
      count: suggestions.length,
      skip: 0,
      limit: 10,
    };
  }) as never);
}

async function renderAlertStep(): Promise<HTMLElement> {
  render(<RemediationStep investigationStage="reported" alertId={ALERT_ID} />);
  await screen.findAllByTestId("remediation-fix");

  return screen.getByTestId("ai-card-step-remediation");
}

function fixes(): Array<HTMLElement> {
  return screen.getAllByTestId("remediation-fix");
}

function titleOf(fix: HTMLElement): string {
  return within(fix).getByTestId("remediation-fix-title").textContent || "";
}

function sourceOf(fix: HTMLElement): string {
  return within(fix).getByTestId("remediation-fix-source").textContent || "";
}

beforeEach(() => {
  goTo(`/dashboard/${PROJECT_ID}/alerts/${ALERT_ID.toString()}`);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the issue's screenshot: two fixes tried, neither found", () => {
  beforeEach(() => {
    serve([
      // The server answers newest first.
      rulesRunbookPick(AutoRemediationSuggestionStatus.NoneApplicable),
      clusterRound(AutoRemediationSuggestionStatus.NoneApplicable),
    ]);
  });

  test("opens with what came of it, in one sentence, before anything else", async () => {
    const step: HTMLElement = await renderAlertStep();
    const summary: HTMLElement = screen.getByTestId("remediation-step-summary");

    expect(summary).toHaveTextContent(
      /^OneUptime AI found no fix for this alert, so nothing was changed\.$/,
    );
    expect(summary).toHaveAttribute("data-summary", "noFix");
    expect(
      summary.compareDocumentPosition(screen.getByTestId("remediation-fixes")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // The pill beside the step's title says the same, in its few words.
    expect(
      within(step).getByTestId("ai-card-step-remediation-pill"),
    ).toHaveTextContent("No fix found");
  });

  test("says nothing over the fixes that the fixes say themselves", async () => {
    const step: HTMLElement = await renderAlertStep();

    expect(screen.queryByTestId("remediation-decision")).toBeNull();
    expect(step).not.toHaveTextContent("is fixing cluster");
    expect(step).not.toHaveTextContent("Approvals are bypassed");
    expect(step).not.toHaveTextContent('Rule "All alerts" matched');
  });

  test("names each fix for what it is, from the rule it came from", async () => {
    await renderAlertStep();

    const [round, pick] = fixes();

    expect(titleOf(round!)).toBe('Fix on cluster "oneuptime-test"');
    expect(sourceOf(round!)).toBe('From AI rule "All alerts"');
    expect(titleOf(pick!)).toBe("Runbook");
    expect(sourceOf(pick!)).toBe('From AI rule "All alerts"');

    for (const fix of fixes()) {
      expect(titleOf(fix)).not.toMatch(/\bAI\b|kubectl|No runbook/);
      expect(sourceOf(fix)).not.toMatch(/^Rule:|AI remediation/);
    }
  });

  test("says each outcome once: on the fix's one step, not again beside its name", async () => {
    await renderAlertStep();

    for (const fix of fixes()) {
      expect(within(fix).queryByTestId("remediation-fix-facts")).toBeNull();
      expect(within(fix).queryByTestId("remediation-fix-status")).toBeNull();
      expect(within(fix).getAllByTestId("remediation-fix-step")).toHaveLength(
        1,
      );
    }

    const [round, pick] = fixes();
    expect(
      within(round!).getByTestId("remediation-fix-step-title"),
    ).toHaveTextContent("Found no safe fix");
    expect(
      within(pick!).getByTestId("remediation-fix-step-title"),
    ).toHaveTextContent("Found no runbook that applies");
  });

  test("previews the AI's answer, never the report's heading, its evidence list or its footer", async () => {
    const step: HTMLElement = await renderAlertStep();
    const previews: Array<string> = screen
      .getAllByTestId("remediation-fix-step-summary")
      .map((element: HTMLElement): string => {
        return element.textContent || "";
      });

    expect(previews).toHaveLength(2);
    expect(previews[0]).toMatch(
      /^The ClickHouse pod restarted after it ran out of memory\./,
    );
    expect(previews[1]).toMatch(
      /^Alert #410 is a ClickHouse pod in CrashLoopBackOff/,
    );

    for (const junk of [
      "🧠",
      "Automated Root Cause Analysis",
      "Investigated automatically",
      "read-only",
      "Evidence checked",
      "SelectedRunbook",
      "[C1]",
      "I'll verify",
    ]) {
      expect(step).not.toHaveTextContent(junk);
    }
  });
});

describe("the same alert, once a fix ran", () => {
  test("a fix that ran and recovered the alert says so first, and its steps keep where it stands", async () => {
    serve([
      clusterRound(AutoRemediationSuggestionStatus.AutoExecuted, {
        commandPlan: {
          executionStatus: AiRemediationPlanExecutionStatus.Completed,
          commands: [kubectlCommand()],
        } as JSONObject,
        verificationStatus: AutoRemediationVerificationStatus.Verified,
      }),
    ]);

    await renderAlertStep();

    expect(screen.getByTestId("remediation-step-summary")).toHaveTextContent(
      "A fix ran, and this alert recovered.",
    );
    expect(titleOf(fixes()[0]!)).toBe('Fix on cluster "oneuptime-test"');
    // A fix of more than one step says where it stands beside its name.
    expect(
      within(fixes()[0]!).getAllByTestId("remediation-fix-step").length,
    ).toBeGreaterThan(1);
    expect(
      within(fixes()[0]!).getByTestId("remediation-fix-facts"),
    ).toBeInTheDocument();
  });

  test("a fix waiting for the reader says what to do first, with the step's pill", async () => {
    serve([
      clusterRound(AutoRemediationSuggestionStatus.Suggested, {
        commandPlan: { commands: [kubectlCommand()] } as JSONObject,
      }),
    ]);

    const step: HTMLElement = await renderAlertStep();

    expect(screen.getByTestId("remediation-step-summary")).toHaveTextContent(
      "A fix is ready for this alert. It runs once you approve it.",
    );
    expect(
      within(step).getByTestId("ai-card-step-remediation-pill"),
    ).toHaveTextContent("Needs your approval");
  });

  test("a decision with no fix has no summary: its lines say why", async () => {
    serve(
      [],
      [
        {
          stage: "Evaluated",
          createdAt: new Date("2026-11-10T09:00:00Z"),
          entries: [{ lane: "Rule", reason: "NoRulesConfigured" }],
        },
      ],
    );

    render(
      <RemediationStep investigationStage="reported" alertId={ALERT_ID} />,
    );

    await screen.findByTestId("remediation-decision");
    expect(screen.queryByTestId("remediation-step-summary")).toBeNull();
  });
});
