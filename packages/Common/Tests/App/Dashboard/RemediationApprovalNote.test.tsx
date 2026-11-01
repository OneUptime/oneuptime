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

// Only rendered when "Show reasoning" is opened; keep the lazy import out.
jest.mock("../../../UI/Components/Markdown.tsx/LazyMarkdownViewer", () => {
  return {
    __esModule: true,
    default: (): React.ReactElement => {
      return React.createElement("div", { "data-testid": "markdown" });
    },
  };
});

import RemediationStep, {
  REMEDIATION_APPROVAL_NOTE,
  isRemediationApprovalNoteShown,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AutoRemediation/RemediationStep";
import AutoRemediationSuggestion from "../../../Models/DatabaseModels/AutoRemediationSuggestion";
import AutoRemediationSuggestionStatus from "../../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import AutoRemediationSuggestionType from "../../../Types/AutoRemediation/AutoRemediationSuggestionType";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import AiResourceType from "../../../Types/ResourceAiAgent/AiResourceType";
import RunbookStepType from "../../../Types/Runbook/RunbookStepType";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";

/*
 * WHAT APPROVING A FIX DOES, OVER THE FIXES OF THE AI CARD'S REMEDIATION
 * STEP (block 43): "Approving runs exactly what is shown, under your name."
 *
 * It was the Remediation card's description, which also listed every kind
 * of fix there is ("Fixes OneUptime AI proposed or applied for this signal
 * - kubectl on a cluster, commands through a resource's AI agent, commands
 * on a Runner, or a runbook ...") above every fix, whatever it was. In the
 * step each fix says what it is, so only the sentence that matters before
 * the press is left, and only while a fix waits for one.
 */

const INCIDENT_ID: ObjectID = new ObjectID(
  "0193c0de-3333-4aaa-8bbb-000000000003",
);
const RESOURCE_ID: string = "0193c0de-4444-4aaa-8bbb-000000000004";
const CLUSTER_ID: string = "0193c0de-7777-4aaa-8bbb-000000000007";

// The description every fix used to sit under.
const OLD_DESCRIPTION_START: string = "Fixes OneUptime AI proposed or applied";
const OLD_DESCRIPTION_WORDS: RegExp = /for this signal/;

function command(stepType: RunbookStepType): JSONObject {
  return {
    sequence: 1,
    stepType,
    runnerId: "0193c0de-5555-4aaa-8bbb-000000000005",
    runnerNameSnapshot: "agent",
    command: "restart it",
    timeoutInMs: 30000,
    rationale: "r",
    expectedEffect: "e",
    policyVerdict: "RequiresApproval",
    // Each step type's own target, as the plan parser requires it.
    ...(stepType === RunbookStepType.ResourceCommand
      ? {
          resourceType: AiResourceType.DockerHost,
          resourceId: RESOURCE_ID,
          resourceNameSnapshot: "web-1",
        }
      : {}),
    ...(stepType === RunbookStepType.Kubectl
      ? {
          kubernetesClusterId: CLUSTER_ID,
          kubernetesClusterNameSnapshot: "prod-east",
        }
      : {}),
  };
}

function suggestion(
  overrides: Partial<Record<string, unknown>> = {},
): AutoRemediationSuggestion {
  return Object.assign(new AutoRemediationSuggestion(), {
    _id: "0193c0de-6666-4aaa-8bbb-000000000006",
    status: AutoRemediationSuggestionStatus.Suggested,
    suggestionType: AutoRemediationSuggestionType.CommandPlan,
    ruleNameSnapshot: "Restart API pods",
    commandPlan: { commands: [command(RunbookStepType.Bash)] },
    createdAt: new Date("2026-09-22T10:00:00Z"),
    ...overrides,
  });
}

function resourceRound(
  overrides: Partial<Record<string, unknown>> = {},
): AutoRemediationSuggestion {
  return suggestion({
    ruleNameSnapshot: 'AI remediation for Docker host "web-1"',
    resourceType: AiResourceType.DockerHost,
    resourceId: new ObjectID(RESOURCE_ID),
    commandPlan: { commands: [command(RunbookStepType.ResourceCommand)] },
    ...overrides,
  });
}

function clusterRound(
  overrides: Partial<Record<string, unknown>> = {},
): AutoRemediationSuggestion {
  return suggestion({
    ruleNameSnapshot: 'AI remediation for cluster "prod-east"',
    kubernetesClusterId: new ObjectID(CLUSTER_ID),
    commandPlan: { commands: [command(RunbookStepType.Kubectl)] },
    ...overrides,
  });
}

function runbookPick(
  overrides: Partial<Record<string, unknown>> = {},
): AutoRemediationSuggestion {
  return suggestion({
    suggestionType: AutoRemediationSuggestionType.Runbook,
    runbookNameSnapshot: "Restart the checkout pods",
    commandPlan: undefined,
    ...overrides,
  });
}

function mcpFix(
  overrides: Partial<Record<string, unknown>> = {},
): AutoRemediationSuggestion {
  return suggestion({
    suggestionType: AutoRemediationSuggestionType.McpToolCalls,
    commandPlan: undefined,
    mcpToolCallPlan: {
      calls: [
        {
          sequence: 1,
          serverId: "0193c0de-8888-4aaa-8bbb-000000000008",
          serverNameSnapshot: "AWS",
          toolName: "restart_service",
          arguments: {},
          status: "Proposed",
        },
      ],
    },
    ...overrides,
  });
}

// A plan composed before runbook credentials were removed: it can't be approved.
function sshPlan(): AutoRemediationSuggestion {
  return suggestion({
    commandPlan: { commands: [command(RunbookStepType.SSH)] },
  });
}

describe("isRemediationApprovalNoteShown", () => {
  test("a fix of any kind that waits for approval: kubectl, a resource's AI agent, a Runner, a runbook, MCP servers", () => {
    for (const fix of [
      clusterRound(),
      resourceRound(),
      suggestion(),
      runbookPick(),
      mcpFix(),
    ]) {
      expect(isRemediationApprovalNoteShown([fix])).toBe(true);
    }
  });

  test("nothing waits for approval: a fix being worked out, approved, run on its own, dismissed or with nothing that applies", () => {
    for (const status of [
      AutoRemediationSuggestionStatus.Planning,
      AutoRemediationSuggestionStatus.Approved,
      AutoRemediationSuggestionStatus.AutoExecuted,
      AutoRemediationSuggestionStatus.Dismissed,
      AutoRemediationSuggestionStatus.NoneApplicable,
    ]) {
      expect(
        isRemediationApprovalNoteShown([
          clusterRound({ status }),
          runbookPick({ status }),
          mcpFix({ status }),
        ]),
      ).toBe(false);
    }
    expect(isRemediationApprovalNoteShown([])).toBe(false);
  });

  test("a plan that can no longer be approved says nothing about approving", () => {
    expect(isRemediationApprovalNoteShown([sshPlan()])).toBe(false);
  });

  test("one fix waiting among others that ran is enough", () => {
    expect(
      isRemediationApprovalNoteShown([
        runbookPick({ status: AutoRemediationSuggestionStatus.Approved }),
        clusterRound(),
        mcpFix({ status: AutoRemediationSuggestionStatus.AutoExecuted }),
      ]),
    ).toBe(true);
  });
});

describe("RemediationStep: what approving does", () => {
  let getListSpy: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    getListSpy = jest.spyOn(ModelAPI, "getList");
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  async function renderStep(
    rows: Array<AutoRemediationSuggestion>,
  ): Promise<HTMLElement> {
    getListSpy.mockImplementation(
      async (): Promise<ListResult<AutoRemediationSuggestion>> => {
        return { data: rows, count: rows.length, skip: 0, limit: 10 };
      },
    );
    render(
      <RemediationStep
        investigationStage="reported"
        incidentId={INCIDENT_ID}
      />,
    );

    return await screen.findByTestId("remediation-fixes");
  }

  test("over the fixes while one waits for approval: one sentence, before the first fix", async () => {
    const fixes: HTMLElement = await renderStep([resourceRound()]);

    const note: HTMLElement = within(fixes).getByTestId(
      "remediation-approval-note",
    );
    expect(note).toHaveTextContent(REMEDIATION_APPROVAL_NOTE);
    expect(REMEDIATION_APPROVAL_NOTE).toBe(
      "Approving runs exactly what is shown, under your name.",
    );
    // It heads the fixes: the first fix follows it.
    const firstFix: HTMLElement =
      within(fixes).getAllByTestId("remediation-fix")[0]!;
    expect(
      note.compareDocumentPosition(firstFix) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(within(fixes).getByText("Approve & Run")).toBeInTheDocument();
  });

  test("no list of every kind of fix there is, whatever the fixes are", async () => {
    await renderStep([clusterRound(), resourceRound(), mcpFix()]);

    expect(
      screen.queryByText(OLD_DESCRIPTION_START, { exact: false }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(OLD_DESCRIPTION_WORDS)).not.toBeInTheDocument();
    expect(screen.getAllByTestId("remediation-approval-note")).toHaveLength(1);
  });

  test("a fix that ran on its own says nothing about approving", async () => {
    await renderStep([
      clusterRound({ status: AutoRemediationSuggestionStatus.AutoExecuted }),
    ]);

    expect(
      screen.queryByTestId("remediation-approval-note"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Approve & Run")).not.toBeInTheDocument();
  });

  test("a plan that can no longer be approved: its own note, and nothing about approving", async () => {
    await renderStep([sshPlan()]);

    expect(
      await screen.findByTestId("remediation-removed-ssh-note"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("remediation-approval-note"),
    ).not.toBeInTheDocument();
  });
});
