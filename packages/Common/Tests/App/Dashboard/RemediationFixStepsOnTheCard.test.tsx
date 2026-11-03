import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import * as React from "react";

// The reasoning's Markdown, as one element the suites can find.
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
import AutoRemediationSuggestion from "../../../Models/DatabaseModels/AutoRemediationSuggestion";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import {
  AiRemediationCommandExecutionStatus,
  AiRemediationCommandPolicyVerdict,
  AiRemediationPlanExecutionStatus,
  AiRemediationRollbackStatus,
} from "../../../Types/AutoRemediation/AiRemediationCommandPlan";
import AutoRemediationSuggestionStatus from "../../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import AutoRemediationSuggestionType from "../../../Types/AutoRemediation/AutoRemediationSuggestionType";
import AutoRemediationVerificationStatus from "../../../Types/AutoRemediation/AutoRemediationVerificationStatus";
import {
  ExternalMcpToolCall,
  ExternalMcpToolCallPlanUtil,
  ExternalMcpToolCallStatus,
} from "../../../Types/AutoRemediation/ExternalMcpToolCallPlan";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import { JSONObject } from "../../../Types/JSON";
import { KubectlCommandTier } from "../../../Types/Kubernetes/KubernetesClusterAiAccess";
import ObjectID from "../../../Types/ObjectID";
import RunbookStepType from "../../../Types/Runbook/RunbookStepType";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import { goTo, PROJECT_ID } from "./SideMenuHarness";

/*
 * A FIX, STEP BY STEP, ON THE AI CARD'S REMEDIATION STEP (issue #5598).
 *
 * "It is currently extremely complicated to understand what's going on.
 * Ideally it should be in steps where you have step by step sections on
 * what AI did and why, and when I expand the step - it shows me more
 * context into why, commands ran, outputs." A fix drew its facts, its
 * verification's note, its reasoning and every command with its policy
 * facts, exit code, output, undo and undo's outcome as one block. Now it
 * reads as the steps it went through, oldest fix first, each one line - a
 * mark, what OneUptime AI did, when, and why or what went wrong - and each
 * step with more to read opens on its own press: the plan to the reasoning
 * and each command, the run to each command's output, the rollback to each
 * undo. A fix that waits for approval is still approved with its commands
 * in sight: Review and approve opens its plan, with Approve & Run under it.
 */

const INCIDENT_ID: ObjectID = new ObjectID(
  "0193c0de-3333-4aaa-8bbb-000000000053",
);
const CLUSTER_ID: string = "0193c0de-4444-4aaa-8bbb-000000000054";
const RUNNER_ID: string = "0193c0de-5555-4aaa-8bbb-000000000056";
const KUBECTL_FIX_ID: string = "0193c0de-6666-4aaa-8bbb-000000000057";
const MCP_FIX_ID: string = "0193c0de-6666-4aaa-8bbb-000000000059";
const RUNBOOK_FIX_ID: string = "0193c0de-6666-4aaa-8bbb-000000000060";

const AT_RAN: string = "2026-10-30T10:00:05.000Z";
const AT_UNDONE: string = "2026-10-30T10:10:07.000Z";

function kubectlCommand(
  sequence: number,
  overrides: Partial<JSONObject> = {},
): JSONObject {
  return {
    sequence,
    stepType: RunbookStepType.Kubectl,
    runnerId: RUNNER_ID,
    runnerNameSnapshot: "kubernetes-agent/prod-east",
    kubernetesClusterId: CLUSTER_ID,
    kubernetesClusterNameSnapshot: "prod-east",
    kubectlTier:
      sequence === 1
        ? KubectlCommandTier.SafeWrite
        : KubectlCommandTier.RiskyWrite,
    command: `kubectl rollout restart deployment/web-${sequence} -n web`,
    timeoutInMs: 60000,
    rationale: "Pods hold a stale config.",
    expectedEffect: "Fresh pods pick up the corrected config.",
    rollbackCommand: `kubectl rollout undo deployment/web-${sequence} -n web`,
    policyVerdict: AiRemediationCommandPolicyVerdict.RequiresApproval,
    ...overrides,
  };
}

function ran(
  status: AiRemediationCommandExecutionStatus,
  extra: JSONObject = {},
): JSONObject {
  return {
    status,
    exitCode: status === AiRemediationCommandExecutionStatus.Failed ? 1 : 0,
    startedAt: AT_RAN,
    completedAt: "2026-10-30T10:00:08.000Z",
    ...extra,
  };
}

function kubectlFix(
  status: AutoRemediationSuggestionStatus,
  plan: JSONObject,
  extra: Partial<JSONObject> = {},
): AutoRemediationSuggestion {
  return Object.assign(new AutoRemediationSuggestion(), {
    _id: KUBECTL_FIX_ID,
    status,
    suggestionType: AutoRemediationSuggestionType.CommandPlan,
    ruleNameSnapshot: 'AI remediation for cluster "prod-east"',
    kubernetesClusterId: new ObjectID(CLUSTER_ID),
    rationaleMarkdown: "The 17:52 release left the pods a stale config.",
    commandPlan: plan,
    createdAt: new Date("2026-10-30T10:00:00Z"),
    ...extra,
  });
}

// A kubectl fix that ran on its own, did not work, and was rolled back.
function rolledBackFix(): AutoRemediationSuggestion {
  return kubectlFix(
    AutoRemediationSuggestionStatus.AutoExecuted,
    {
      commands: [
        kubectlCommand(1, {
          wasAutoExecuted: true,
          execution: ran(AiRemediationCommandExecutionStatus.Succeeded, {
            output: "deployment.apps/web-1 restarted",
          }),
          rollbackExecution: ran(
            AiRemediationCommandExecutionStatus.Succeeded,
            {
              output: "deployment.apps/web-1 rolled back",
              startedAt: AT_UNDONE,
              completedAt: AT_UNDONE,
            },
          ),
        }),
      ],
      executionStatus: AiRemediationPlanExecutionStatus.Completed,
      executionStartedAt: AT_RAN,
      rollbackStatus: AiRemediationRollbackStatus.Completed,
    },
    {
      verificationStatus: AutoRemediationVerificationStatus.Failed,
      verificationNote:
        "The service did not recover within the verification window.",
      verificationCompletedAt: new Date("2026-10-30T10:10:05Z"),
    },
  );
}

function mcpCall(
  sequence: number,
  status: ExternalMcpToolCallStatus,
  serverNameSnapshot: string,
): ExternalMcpToolCall {
  return {
    sequence,
    serverId: `server-${serverNameSnapshot}`,
    serverNameSnapshot,
    toolName: "set_flag",
    arguments: { flag: "checkout-db-pool-v2", enabled: false },
    status,
    wasMadeWithoutAsking: true,
    startedAt: AT_RAN,
    ...(status === ExternalMcpToolCallStatus.Failed
      ? { errorMessage: "The server did not answer within 30 seconds." }
      : { resultText: "checkout-db-pool-v2 is off." }),
  };
}

function mcpFix(calls: Array<ExternalMcpToolCall>): AutoRemediationSuggestion {
  return Object.assign(new AutoRemediationSuggestion(), {
    _id: MCP_FIX_ID,
    status: AutoRemediationSuggestionStatus.AutoExecuted,
    suggestionType: AutoRemediationSuggestionType.McpToolCalls,
    ruleNameSnapshot: "Checkout fixes",
    mcpToolCallPlan: ExternalMcpToolCallPlanUtil.toJSON({ calls }),
    createdAt: new Date("2026-10-30T09:59:00Z"),
  });
}

function runbookFix(
  status: AutoRemediationSuggestionStatus,
): AutoRemediationSuggestion {
  return Object.assign(new AutoRemediationSuggestion(), {
    _id: RUNBOOK_FIX_ID,
    status,
    suggestionType: AutoRemediationSuggestionType.Runbook,
    ruleNameSnapshot: "Checkout fixes",
    runbookNameSnapshot: "Restart checkout-api pods",
    rationaleMarkdown: "The runbook restarts the pods that hold the pool.",
    createdAt: new Date("2026-10-30T09:58:00Z"),
  });
}

let served: Array<AutoRemediationSuggestion> = [];
let postSpy: ReturnType<typeof jest.spyOn>;

beforeEach(() => {
  goTo(`/dashboard/${PROJECT_ID}/incidents/${INCIDENT_ID.toString()}`);
  served = [];
  jest.spyOn(ModelAPI, "getList").mockImplementation((async (data: {
    modelType: unknown;
  }): Promise<ListResult<AutoRemediationSuggestion>> => {
    // The step reads its decisions beside its fixes: none here.
    if (data.modelType !== AutoRemediationSuggestion) {
      return { data: [], count: 0, skip: 0, limit: 5 };
    }

    return { data: served, count: served.length, skip: 0, limit: 10 };
  }) as never);
  jest.spyOn(ModelAPI, "getCommonHeaders").mockReturnValue({});
  postSpy = jest.spyOn(API, "post");
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function renderStep(
  fixes: Array<AutoRemediationSuggestion>,
): Promise<Array<HTMLElement>> {
  served = fixes;
  await act(async () => {
    render(
      <RemediationStep
        investigationStage="reported"
        incidentId={INCIDENT_ID}
      />,
    );
  });

  return await screen.findAllByTestId("remediation-fix");
}

function stepsOf(fix: HTMLElement): Array<HTMLElement> {
  return within(fix).getAllByTestId("remediation-fix-step");
}

function stepOf(fix: HTMLElement, kind: string): HTMLElement {
  const step: HTMLElement | undefined = stepsOf(fix).find(
    (element: HTMLElement): boolean => {
      return element.getAttribute("data-step") === kind;
    },
  );

  if (!step) {
    throw new Error(`The fix has no ${kind} step.`);
  }

  return step;
}

function titleOf(step: HTMLElement): string {
  return (
    within(step).getByTestId("remediation-fix-step-title").textContent || ""
  );
}

function toggleOf(step: HTMLElement): HTMLElement {
  return within(step).getByTestId("remediation-fix-step-toggle");
}

function detailsOf(step: HTMLElement): HTMLElement | null {
  return within(step).queryByTestId("remediation-fix-step-details");
}

describe("a fix reads as the steps it went through", () => {
  test("one that did not work: planned, approved automatically, ran, did not recover, rolled back - in that order, a line each, nothing open", async () => {
    const [fix] = await renderStep([rolledBackFix()]);

    expect(
      stepsOf(fix!).map((step: HTMLElement): string | null => {
        return step.getAttribute("data-step");
      }),
    ).toEqual(["plan", "approval", "run", "verify", "rollback"]);
    expect(stepsOf(fix!).map(titleOf)).toEqual([
      "Planned 1 command on cluster prod-east",
      "Approved automatically",
      "Ran 1 command",
      "Did not recover",
      "Rolled back 1 command",
    ]);
    expect(
      stepsOf(fix!).map((step: HTMLElement): string | null => {
        return step.getAttribute("data-tone");
      }),
    ).toEqual(["done", "done", "done", "failed", "done"]);

    // Why it did not recover, in the verifier's own words and direction.
    const note: HTMLElement = within(stepOf(fix!, "verify")).getByTestId(
      "remediation-fix-verification-note",
    );
    expect(note).toHaveTextContent(
      "The service did not recover within the verification window.",
    );
    expect(note).toHaveAttribute("dir", "auto");

    // When each happened, as a moment a machine can read too.
    expect(
      within(stepOf(fix!, "run")).getByTestId("remediation-fix-step-time"),
    ).toHaveAttribute("dateTime", AT_RAN);
    expect(
      within(stepOf(fix!, "rollback")).getByTestId("remediation-fix-step-time"),
    ).toHaveAttribute("dateTime", AT_UNDONE);

    // Nothing open yet: no command, no output.
    expect(
      within(fix!).queryByTestId("remediation-fix-step-details"),
    ).toBeNull();
    expect(
      within(fix!).queryByText(
        "kubectl rollout restart deployment/web-1 -n web",
      ),
    ).toBeNull();

    // Where it stands is still said beside its name.
    expect(
      within(fix!).getByTestId("remediation-fix-status"),
    ).toHaveTextContent("Auto-executed");
    expect(
      within(fix!).getByTestId("remediation-fix-verification"),
    ).toHaveTextContent("Verification failed");
  });

  test("each step opens on its own press, its whole line the press, and the keyboard stays on it", async () => {
    const [fix] = await renderStep([rolledBackFix()]);
    const run: HTMLElement = stepOf(fix!, "run");
    const toggle: HTMLElement = toggleOf(run);

    expect(toggle.tagName).toBe("BUTTON");
    expect(toggle).toHaveAttribute("type", "button");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).not.toHaveAttribute("aria-controls");
    expect(within(toggle).getByText("Ran 1 command")).toBeInTheDocument();

    toggle.focus();
    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(document.activeElement).toBe(toggle);
    const details: HTMLElement = detailsOf(run)!;
    expect(details).not.toBeNull();
    expect(details.id).not.toBe("");
    expect(toggle.getAttribute("aria-controls")).toBe(details.id);
    expect(document.getElementById(details.id)).toBe(details);

    // Only it: the plan and the rollback stay closed.
    expect(detailsOf(stepOf(fix!, "plan"))).toBeNull();
    expect(detailsOf(stepOf(fix!, "rollback"))).toBeNull();

    // A step with nothing more to read has no press.
    expect(
      within(stepOf(fix!, "approval")).queryByTestId(
        "remediation-fix-step-toggle",
      ),
    ).toBeNull();
    expect(
      within(stepOf(fix!, "verify")).queryByTestId(
        "remediation-fix-step-toggle",
      ),
    ).toBeNull();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(detailsOf(run)).toBeNull();
  });

  test("the plan opens to the reasoning, then each command in the order it runs, with why, what it should do and its undo", async () => {
    const [fix] = await renderStep([
      kubectlFix(AutoRemediationSuggestionStatus.Suggested, {
        commands: [kubectlCommand(1), kubectlCommand(2)],
      }),
    ]);
    const plan: HTMLElement = stepOf(fix!, "plan");

    // Closed, the start of why: the reasoning in its own direction.
    const summary: HTMLElement = within(plan).getByTestId(
      "remediation-fix-step-summary",
    );
    expect(summary).toHaveTextContent(
      "The 17:52 release left the pods a stale config.",
    );
    expect(summary).toHaveAttribute("dir", "auto");

    fireEvent.click(toggleOf(plan));
    const details: HTMLElement = detailsOf(plan)!;

    // Open, all of it - once: the summary gives way to it.
    expect(
      within(plan).queryByTestId("remediation-fix-step-summary"),
    ).toBeNull();
    const reasoning: HTMLElement = within(details).getByTestId(
      "remediation-fix-reasoning",
    );
    expect(reasoning).toHaveAttribute("dir", "auto");

    const commands: Array<HTMLElement> = within(details).getAllByTestId(
      "remediation-command",
    );
    expect(commands).toHaveLength(2);
    expect(
      reasoning.compareDocumentPosition(commands[0]!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      within(commands[0]!).getByTestId("remediation-command-tier"),
    ).toHaveTextContent("safe change");
    expect(
      within(commands[1]!).getByTestId("remediation-command-tier"),
    ).toHaveTextContent("riskier change");
    expect(
      within(commands[0]!).getByTestId("remediation-command-approval"),
    ).toHaveTextContent("needs approval");
    expect(
      within(commands[0]!).getByText(
        "kubectl rollout restart deployment/web-1 -n web",
      ),
    ).toBeInTheDocument();
    expect(
      within(commands[0]!).getByTestId("remediation-command-rationale"),
    ).toHaveAttribute("dir", "auto");
    expect(
      within(commands[0]!).getByTestId("remediation-command-expected-effect"),
    ).toHaveTextContent(
      "Expected effect: Fresh pods pick up the corrected config.",
    );
    // Its undo is code, which reads left to right in every language.
    expect(
      within(commands[0]!).getByText(
        "kubectl rollout undo deployment/web-1 -n web",
      ).tagName,
    ).toBe("CODE");
  });

  test("the run opens to each command as it ran: how it went, how long it took, its exit code and its output", async () => {
    const [fix] = await renderStep([rolledBackFix()]);
    const run: HTMLElement = stepOf(fix!, "run");

    fireEvent.click(toggleOf(run));

    const command: HTMLElement = within(detailsOf(run)!).getByTestId(
      "remediation-command-run",
    );
    expect(command.tagName).toBe("LI");
    expect(command).toHaveAttribute("data-status", "Succeeded");
    expect(
      within(command).getByTestId("remediation-command-execution"),
    ).toHaveTextContent("Succeeded");
    expect(
      within(command).getByTestId("remediation-command-duration"),
    ).toHaveTextContent("3s");
    // The command and what it printed, as a terminal shows them.
    const transcript: HTMLElement = within(command).getByTestId(
      "remediation-command-transcript",
    );
    expect(transcript.tagName).toBe("PRE");
    expect(
      within(transcript).getByTestId("remediation-command-line"),
    ).toHaveTextContent("kubectl rollout restart deployment/web-1 -n web");
    expect(
      within(transcript).getByTestId("remediation-command-output"),
    ).toHaveTextContent("deployment.apps/web-1 restarted");
    expect(
      within(command).getByTestId("remediation-command-exit-code"),
    ).toHaveTextContent("Exit code: 0");
  });

  test("a command that failed: the error under the run while it is closed, and with its command once it is open", async () => {
    const [fix] = await renderStep([
      kubectlFix(AutoRemediationSuggestionStatus.Approved, {
        commands: [
          kubectlCommand(1, {
            execution: ran(AiRemediationCommandExecutionStatus.Failed, {
              errorMessage: "deployments.apps 'web-1' not found",
            }),
          }),
        ],
        executionStatus: AiRemediationPlanExecutionStatus.Failed,
      }),
    ]);
    const run: HTMLElement = stepOf(fix!, "run");

    expect(run).toHaveAttribute("data-tone", "failed");
    expect(titleOf(run)).toBe("The command failed");
    const summary: HTMLElement = within(run).getByTestId(
      "remediation-fix-step-summary",
    );
    expect(summary).toHaveTextContent("deployments.apps 'web-1' not found");
    expect(summary).toHaveAttribute("dir", "auto");
    // And in red beside where the fix stands.
    expect(
      within(fix!).getByTestId("remediation-fix-failed-count"),
    ).toHaveTextContent(/^1 failed$/);

    fireEvent.click(toggleOf(run));

    // Said once: in the open step, with the command it came from.
    expect(
      screen.getAllByText("deployments.apps 'web-1' not found"),
    ).toHaveLength(1);
    const error: HTMLElement = within(detailsOf(run)!).getByTestId(
      "remediation-command-error",
    );
    expect(error).toHaveTextContent("deployments.apps 'web-1' not found");
    expect(error).toHaveAttribute("dir", "auto");
    expect(
      within(detailsOf(run)!).getByTestId("remediation-command-execution"),
    ).toHaveAttribute("data-alarming", "true");
  });

  test("the rollback opens to each undo as it ran", async () => {
    const [fix] = await renderStep([rolledBackFix()]);
    const rollback: HTMLElement = stepOf(fix!, "rollback");

    fireEvent.click(toggleOf(rollback));

    const undo: HTMLElement = within(detailsOf(rollback)!).getByTestId(
      "remediation-rollback-outcome",
    );
    expect(
      within(undo).getByTestId("remediation-rollback-execution"),
    ).toHaveTextContent("Succeeded");
    expect(
      within(undo).getByTestId("remediation-command-line"),
    ).toHaveTextContent("kubectl rollout undo deployment/web-1 -n web");
    expect(
      within(undo).getByTestId("remediation-command-output"),
    ).toHaveTextContent("deployment.apps/web-1 rolled back");
  });

  test("the fixes read in the order OneUptime AI tried them, oldest first", async () => {
    await renderStep([
      // The server answers newest first.
      rolledBackFix(),
      mcpFix([
        mcpCall(1, ExternalMcpToolCallStatus.Succeeded, "Feature flags"),
      ]),
      runbookFix(AutoRemediationSuggestionStatus.Approved),
    ]);

    expect(
      screen
        .getAllByTestId("remediation-fix")
        .map((fix: HTMLElement): string => {
          return within(fix).getByTestId("remediation-fix-title")
            .textContent as string;
        }),
    ).toEqual([
      "Restart checkout-api pods",
      "AI fix through MCP servers",
      "AI kubectl fix",
    ]);
  });
});

describe("a fix that waits for approval", () => {
  function waitingFix(): AutoRemediationSuggestion {
    return kubectlFix(AutoRemediationSuggestionStatus.Suggested, {
      commands: [kubectlCommand(1), kubectlCommand(2)],
    });
  }

  test("its plan, then Needs your approval with Review and approve: no command, Approve & Run, dry run or Dismiss in sight", async () => {
    const [fix] = await renderStep([waitingFix()]);

    expect(stepsOf(fix!).map(titleOf)).toEqual([
      "Planned 2 commands on cluster prod-east",
      "Needs your approval",
    ]);
    expect(stepOf(fix!, "approval")).toHaveAttribute("data-tone", "attention");
    expect(
      within(fix!).getByTestId("remediation-fix-status"),
    ).toHaveTextContent("Waiting for approval");

    const review: HTMLElement = within(fix!).getByTestId(
      "remediation-fix-details-toggle",
    );
    expect(review).toHaveTextContent(/^Review and approve$/);
    expect(review).toHaveAttribute("aria-expanded", "false");
    expect(review).not.toHaveAttribute("aria-controls");
    // Under the step it is about: the approval.
    expect(stepOf(fix!, "approval")).toContainElement(review);

    // The plan's own press, and Review and approve: nothing else to press.
    expect(within(fix!).getAllByRole("button")).toEqual([
      toggleOf(stepOf(fix!, "plan")),
      review,
    ]);
    expect(within(fix!).queryAllByTestId("remediation-command")).toHaveLength(
      0,
    );
    expect(within(fix!).queryByTestId("remediation-approve-button")).toBeNull();
    expect(within(fix!).queryByTestId("remediation-dry-run-button")).toBeNull();
    expect(within(fix!).queryByText("Dismiss")).toBeNull();
    expect(within(fix!).queryByTestId("remediation-approval-note")).toBeNull();
  });

  test("Review and approve opens the plan - its reasoning, its commands - with Approve & Run and Dismiss under it; Hide details closes it, and the keyboard stays on the press", async () => {
    const [fix] = await renderStep([waitingFix()]);
    const review: HTMLElement = within(fix!).getByTestId(
      "remediation-fix-details-toggle",
    );
    const plan: HTMLElement = stepOf(fix!, "plan");

    review.focus();
    fireEvent.click(review);

    expect(review).toHaveAttribute("aria-expanded", "true");
    expect(review).toHaveTextContent(/^Hide details$/);
    expect(document.activeElement).toBe(review);
    // It opened the plan step: its own press says so too.
    expect(toggleOf(plan)).toHaveAttribute("aria-expanded", "true");
    const details: HTMLElement = detailsOf(plan)!;
    expect(review.getAttribute("aria-controls")).toBe(details.id);
    expect(within(details).getAllByTestId("remediation-command")).toHaveLength(
      2,
    );
    expect(
      within(details).getByTestId("remediation-fix-reasoning"),
    ).toBeInTheDocument();

    // What approving does, right over Approve & Run, under what it runs.
    const note: HTMLElement = within(fix!).getByTestId(
      "remediation-approval-note",
    );
    expect(note).toHaveTextContent(
      "Approving runs exactly what is shown, under your name.",
    );
    const actions: HTMLElement = within(fix!).getByTestId(
      "remediation-fix-actions",
    );
    expect(note.nextElementSibling).toBe(actions);
    expect(
      details.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      within(actions).getByTestId("remediation-approve-button"),
    ).toBeInTheDocument();
    expect(within(actions).getByText("Dismiss")).toBeInTheDocument();

    fireEvent.click(review);
    expect(review).toHaveAttribute("aria-expanded", "false");
    expect(review).toHaveTextContent(/^Review and approve$/);
    expect(document.activeElement).toBe(review);
    expect(detailsOf(plan)).toBeNull();
    expect(within(fix!).queryByTestId("remediation-approve-button")).toBeNull();
    expect(within(fix!).queryByText("Dismiss")).toBeNull();
  });

  test("the plan's own press opens it the same way, Approve & Run with it", async () => {
    const [fix] = await renderStep([waitingFix()]);

    fireEvent.click(toggleOf(stepOf(fix!, "plan")));

    expect(
      within(fix!).getByTestId("remediation-fix-details-toggle"),
    ).toHaveAttribute("aria-expanded", "true");
    expect(
      within(fix!).getByTestId("remediation-approve-button"),
    ).toBeInTheDocument();
  });

  test("approved: who approved it, and its run opens as it appears, so the reader watches it run", async () => {
    await renderStep([waitingFix()]);
    postSpy.mockImplementation((async () => {
      served = [
        kubectlFix(
          AutoRemediationSuggestionStatus.Approved,
          {
            commands: [
              kubectlCommand(1, {
                execution: {
                  status: AiRemediationCommandExecutionStatus.Running,
                },
              }),
              kubectlCommand(2),
            ],
            executionStatus: AiRemediationPlanExecutionStatus.Running,
          },
          {
            approvedAt: new Date("2026-10-30T10:01:00Z"),
            approvedByUser: { name: "Maya Chen" },
          },
        ),
      ];
      return new HTTPResponse<JSONObject>(200, {}, {});
    }) as never);

    fireEvent.click(screen.getByRole("button", { name: "Review and approve" }));
    await act(async () => {
      fireEvent.click(screen.getByTestId("remediation-approve-button"));
    });

    expect(postSpy).toHaveBeenCalledTimes(1);
    const fix: HTMLElement = screen.getByTestId("remediation-fix");
    expect(titleOf(stepOf(fix, "approval"))).toBe("Approved by Maya Chen");
    const run: HTMLElement = stepOf(fix, "run");
    expect(run).toHaveAttribute("data-tone", "live");
    expect(titleOf(run)).toBe("Running 2 commands…");
    expect(toggleOf(run)).toHaveAttribute("aria-expanded", "true");
    expect(
      within(detailsOf(run)!).getAllByTestId(
        "remediation-command-execution",
      )[0],
    ).toHaveTextContent("Running…");
    expect(screen.getByTestId("remediation-fix-status")).toHaveTextContent(
      "Approved & started",
    );
    // Nothing left to approve, and nothing that offers to.
    expect(screen.queryByTestId("remediation-approve-button")).toBeNull();
    expect(screen.queryByTestId("remediation-fix-details-toggle")).toBeNull();
  });

  test("dismissed: by whom, nothing runs, and nothing is left to press but the plan", async () => {
    await renderStep([waitingFix()]);
    postSpy.mockImplementation((async () => {
      served = [
        kubectlFix(
          AutoRemediationSuggestionStatus.Dismissed,
          { commands: [kubectlCommand(1), kubectlCommand(2)] },
          { dismissedByUser: { name: "Maya Chen" } },
        ),
      ];
      return new HTTPResponse<JSONObject>(200, {}, {});
    }) as never);

    fireEvent.click(screen.getByRole("button", { name: "Review and approve" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    });

    const request: { url: { toString: () => string } } = postSpy.mock
      .calls[0]![0] as never;
    expect(
      new URL(request.url.toString()).pathname.split("/").slice(-2),
    ).toEqual(["auto-remediation", "dismiss"]);
    const fix: HTMLElement = screen.getByTestId("remediation-fix");
    expect(stepsOf(fix).map(titleOf)).toEqual([
      "Planned 2 commands on cluster prod-east",
      "Dismissed by Maya Chen",
    ]);
    expect(screen.queryByTestId("remediation-fix-actions")).toBeNull();
    expect(screen.queryByTestId("remediation-approval-note")).toBeNull();
    expect(screen.queryByTestId("remediation-fix-details-toggle")).toBeNull();
  });

  test("a plan that can no longer be approved: its approval blocked, why, and Dismiss in sight", async () => {
    const [fix] = await renderStep([
      kubectlFix(AutoRemediationSuggestionStatus.Suggested, {
        commands: [
          {
            sequence: 1,
            stepType: RunbookStepType.SSH,
            runnerId: RUNNER_ID,
            runnerNameSnapshot: "ops-runner",
            command: "systemctl restart nginx",
            timeoutInMs: 60000,
            rationale: "nginx holds old upstreams.",
            expectedEffect: "nginx reads the new upstreams.",
            policyVerdict: AiRemediationCommandPolicyVerdict.RequiresApproval,
          },
        ],
      }),
    ]);
    const approval: HTMLElement = stepOf(fix!, "approval");

    expect(titleOf(approval)).toBe("Approval blocked");
    expect(
      within(approval).getByTestId("remediation-removed-ssh-note"),
    ).toHaveTextContent(
      "This plan can't be approved: OneUptime AI no longer runs SSH commands.",
    );
    expect(within(approval).getByText("Dismiss")).toBeInTheDocument();
    expect(within(fix!).queryByText("Approve & Run")).toBeNull();
    expect(
      within(fix!).queryByTestId("remediation-fix-details-toggle"),
    ).toBeNull();
    expect(within(fix!).queryByTestId("remediation-approval-note")).toBeNull();
  });

  test("a runbook that waits keeps Approve & Run in sight: what it runs is its name", async () => {
    const [fix] = await renderStep([
      runbookFix(AutoRemediationSuggestionStatus.Suggested),
    ]);

    expect(stepsOf(fix!).map(titleOf)).toEqual([
      "Picked this runbook",
      "Needs your approval",
    ]);
    expect(
      within(fix!).queryByTestId("remediation-fix-details-toggle"),
    ).toBeNull();
    const note: HTMLElement = within(stepOf(fix!, "approval")).getByTestId(
      "remediation-approval-note",
    );
    expect(note.nextElementSibling).toBe(
      within(fix!).getByTestId("remediation-fix-actions"),
    );

    // Its reasoning is the plan step's to open.
    fireEvent.click(toggleOf(stepOf(fix!, "plan")));
    expect(
      within(detailsOf(stepOf(fix!, "plan"))!).getByTestId(
        "remediation-fix-reasoning",
      ),
    ).toHaveTextContent("The runbook restarts the pods that hold the pool.");
  });

  test("a fix still being worked out is one moving step, and Dismiss", async () => {
    const [fix] = await renderStep([
      kubectlFix(AutoRemediationSuggestionStatus.Planning, { commands: [] }),
    ]);

    expect(stepsOf(fix!)).toHaveLength(1);
    expect(stepOf(fix!, "plan")).toHaveAttribute("data-tone", "live");
    expect(titleOf(stepOf(fix!, "plan"))).toBe("Working out a fix…");
    expect(
      within(fix!).queryByTestId("remediation-fix-step-toggle"),
    ).toBeNull();
    expect(within(fix!).getByText("Dismiss")).toBeInTheDocument();
  });

  test("a plan that cannot be read says so, once, and opens to its reasoning alone", async () => {
    const [fix] = await renderStep([
      kubectlFix(AutoRemediationSuggestionStatus.Suggested, { commands: [] }),
    ]);
    const plan: HTMLElement = stepOf(fix!, "plan");

    expect(titleOf(plan)).toBe("Planned a fix");
    expect(
      screen.getAllByText("The command plan could not be displayed."),
    ).toHaveLength(1);

    fireEvent.click(toggleOf(plan));
    expect(
      within(detailsOf(plan)!).getByTestId("remediation-fix-reasoning"),
    ).toBeInTheDocument();
    expect(within(fix!).queryAllByTestId("remediation-command")).toHaveLength(
      0,
    );
    // Nothing to review, so nothing to open it with.
    expect(
      within(fix!).queryByTestId("remediation-fix-details-toggle"),
    ).toBeNull();
  });
});

describe("a fix through MCP servers", () => {
  test("made without asking: how many changes and through which servers, each change and what its server answered once open, the failure in red", async () => {
    const [fix] = await renderStep([
      mcpFix([
        mcpCall(1, ExternalMcpToolCallStatus.Succeeded, "Feature flags"),
        mcpCall(2, ExternalMcpToolCallStatus.Failed, "Status page"),
        mcpCall(3, ExternalMcpToolCallStatus.Skipped, "Feature flags"),
      ]),
    ]);

    expect(titleOf(stepOf(fix!, "plan"))).toBe(
      "Planned 3 changes through Feature flags and Status page",
    );
    const run: HTMLElement = stepOf(fix!, "run");
    expect(titleOf(run)).toBe("1 of 3 changes failed");
    expect(
      within(run).getByTestId("remediation-fix-step-summary"),
    ).toHaveTextContent("The server did not answer within 30 seconds.");
    expect(
      within(fix!).getByTestId("remediation-fix-failed-count"),
    ).toHaveTextContent(/^1 failed$/);
    expect(
      within(fix!).queryAllByTestId("remediation-mcp-tool-call"),
    ).toHaveLength(0);

    fireEvent.click(toggleOf(run));

    const calls: Array<HTMLElement> = within(detailsOf(run)!).getAllByTestId(
      "remediation-mcp-tool-call",
    );
    expect(calls).toHaveLength(3);
    expect(calls[1]).toHaveAttribute("data-status", "Failed");
    // What ran is read where it ran: the plan has nothing more to open.
    expect(
      within(stepOf(fix!, "plan")).queryByTestId("remediation-fix-step-toggle"),
    ).toBeNull();
  });
});
