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
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
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

import RemediationSuggestionCard, {
  CommandApprovalPillKind,
  getActionErrorTitle,
  getCommandApprovalPillKind,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AutoRemediation/RemediationSuggestionCard";
import AutoRemediationSuggestion from "../../../Models/DatabaseModels/AutoRemediationSuggestion";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import {
  AiRemediationCommandExecutionStatus,
  AiRemediationCommandPolicyVerdict,
  AiRemediationPlanExecutionStatus,
} from "../../../Types/AutoRemediation/AiRemediationCommandPlan";
import AutoRemediationSuggestionStatus from "../../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import AutoRemediationSuggestionType from "../../../Types/AutoRemediation/AutoRemediationSuggestionType";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import { JSONObject } from "../../../Types/JSON";
import { KubectlCommandTier } from "../../../Types/Kubernetes/KubernetesClusterAiAccess";
import ObjectID from "../../../Types/ObjectID";
import RunbookStepType from "../../../Types/Runbook/RunbookStepType";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";

/*
 * The per-command approval pill on the remediation card. The server stores
 * a policy verdict on every command as information for the approval card
 * and assigns AutoApproved to every SafeWrite kubectl command whatever the
 * cluster's remediation mode. So in a RequireApproval cluster a plan that
 * is waiting for a human is full of "AutoApproved" commands — and a green
 * "auto-approved" pill next to a `kubectl rollout restart` under an
 * "Approve & Run" button read as "this already ran". The pill must follow
 * what actually happened to the command, never the verdict alone.
 */

const INCIDENT_ID: ObjectID = new ObjectID(
  "0193c0de-3333-4aaa-8bbb-000000000003",
);
const CLUSTER_ID: string = "0193c0de-4444-4aaa-8bbb-000000000004";
const RUNNER_ID: string = "0193c0de-5555-4aaa-8bbb-000000000005";

const ALL_STATUSES: Array<AutoRemediationSuggestionStatus> = Object.values(
  AutoRemediationSuggestionStatus,
);

interface CommandOverrides {
  policyVerdict?: AiRemediationCommandPolicyVerdict | undefined;
  wasAutoExecuted?: boolean | undefined;
  execution?: JSONObject | undefined;
}

function kubectlCommand(overrides: CommandOverrides = {}): JSONObject {
  return {
    sequence: 1,
    stepType: RunbookStepType.Kubectl,
    runnerId: RUNNER_ID,
    runnerNameSnapshot: "kubernetes-agent/prod-east",
    kubernetesClusterId: CLUSTER_ID,
    kubernetesClusterNameSnapshot: "prod-east",
    kubectlTier: KubectlCommandTier.SafeWrite,
    command: "kubectl rollout restart deployment/web -n web",
    timeoutInMs: 60000,
    rationale: "Pods are crash-looping after a config change.",
    expectedEffect: "Fresh pods pick up the corrected config.",
    policyVerdict:
      overrides.policyVerdict ?? AiRemediationCommandPolicyVerdict.AutoApproved,
    wasAutoExecuted: overrides.wasAutoExecuted ?? false,
    ...(overrides.execution ? { execution: overrides.execution } : {}),
  };
}

function suggestion(
  status: AutoRemediationSuggestionStatus,
  commands: Array<JSONObject>,
  executionStatus?: AiRemediationPlanExecutionStatus | undefined,
): AutoRemediationSuggestion {
  const plan: JSONObject = { commands };
  if (executionStatus) {
    plan["executionStatus"] = executionStatus;
  }

  return Object.assign(new AutoRemediationSuggestion(), {
    _id: "0193c0de-6666-4aaa-8bbb-000000000006",
    status,
    suggestionType: AutoRemediationSuggestionType.CommandPlan,
    ruleNameSnapshot: "AI remediation for cluster",
    kubernetesClusterId: new ObjectID(CLUSTER_ID),
    commandPlan: plan,
    createdAt: new Date("2026-09-22T10:00:00Z"),
  });
}

let getListSpy: ReturnType<typeof jest.spyOn>;

function serve(row: AutoRemediationSuggestion): void {
  getListSpy.mockImplementation(
    async (): Promise<ListResult<AutoRemediationSuggestion>> => {
      return { data: [row], count: 1, skip: 0, limit: 10 };
    },
  );
}

async function renderCard(
  row: AutoRemediationSuggestion,
): Promise<HTMLElement> {
  serve(row);
  render(<RemediationSuggestionCard incidentId={INCIDENT_ID} />);
  const command: HTMLElement = await screen.findByText(
    "kubectl rollout restart deployment/web -n web",
  );
  const commandRow: HTMLElement | null = command.closest("li");

  if (!commandRow) {
    throw new Error("The command is not rendered inside a command row.");
  }

  return commandRow;
}

beforeEach(() => {
  getListSpy = jest.spyOn(ModelAPI, "getList");
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("getCommandApprovalPillKind", () => {
  test("a command a run executed inline ran without approval, whatever the plan says now", () => {
    for (const status of ALL_STATUSES) {
      expect(
        getCommandApprovalPillKind({ wasAutoExecuted: true }, status),
      ).toBe(CommandApprovalPillKind.RanWithoutApproval);
    }
  });

  test("every command of an unattended plan ran without approval", () => {
    expect(
      getCommandApprovalPillKind(
        { wasAutoExecuted: false },
        AutoRemediationSuggestionStatus.AutoExecuted,
      ),
    ).toBe(CommandApprovalPillKind.RanWithoutApproval);
    expect(
      getCommandApprovalPillKind(
        {},
        AutoRemediationSuggestionStatus.AutoExecuted,
      ),
    ).toBe(CommandApprovalPillKind.RanWithoutApproval);
  });

  /*
   * The finding: a plan waiting for a human. The stored verdict is
   * deliberately not an input, so an AutoApproved SafeWrite command in a
   * RequireApproval cluster reads "needs approval" like the rest of the plan.
   */
  test("every command of a plan waiting for approval needs approval", () => {
    expect(
      getCommandApprovalPillKind(
        { wasAutoExecuted: false },
        AutoRemediationSuggestionStatus.Suggested,
      ),
    ).toBe(CommandApprovalPillKind.NeedsApproval);
    expect(
      getCommandApprovalPillKind(
        { wasAutoExecuted: false },
        AutoRemediationSuggestionStatus.Planning,
      ),
    ).toBe(CommandApprovalPillKind.NeedsApproval);
  });

  test("a human-approved, dismissed or inapplicable plan gets no approval pill", () => {
    for (const status of [
      AutoRemediationSuggestionStatus.Approved,
      AutoRemediationSuggestionStatus.Dismissed,
      AutoRemediationSuggestionStatus.NoneApplicable,
    ]) {
      expect(
        getCommandApprovalPillKind({ wasAutoExecuted: false }, status),
      ).toBe(null);
    }
  });

  test("covers every suggestion status", () => {
    for (const status of ALL_STATUSES) {
      const kind: CommandApprovalPillKind | null = getCommandApprovalPillKind(
        {},
        status,
      );
      expect([
        CommandApprovalPillKind.RanWithoutApproval,
        CommandApprovalPillKind.NeedsApproval,
        null,
      ]).toContain(kind);
    }
  });
});

describe("RemediationSuggestionCard approval pill", () => {
  test("a kubectl plan waiting for approval never shows 'auto-approved'", async () => {
    const row: HTMLElement = await renderCard(
      suggestion(AutoRemediationSuggestionStatus.Suggested, [
        kubectlCommand({
          policyVerdict: AiRemediationCommandPolicyVerdict.AutoApproved,
        }),
      ]),
    );

    expect(within(row).queryByText("auto-approved")).not.toBeInTheDocument();
    expect(within(row).getByText("needs approval")).toBeInTheDocument();
    // The tier is still shown: it is the honest policy information.
    expect(within(row).getByText("safe change")).toBeInTheDocument();
    expect(screen.getByText("Waiting for approval")).toBeInTheDocument();
    expect(screen.getByText("Approve & Run")).toBeInTheDocument();
  });

  test("a riskier command in a plan waiting for approval also needs approval", async () => {
    const row: HTMLElement = await renderCard(
      suggestion(AutoRemediationSuggestionStatus.Suggested, [
        kubectlCommand({
          policyVerdict: AiRemediationCommandPolicyVerdict.RequiresApproval,
        }),
      ]),
    );

    expect(within(row).getByText("needs approval")).toBeInTheDocument();
    expect(within(row).queryByText("auto-approved")).not.toBeInTheDocument();
  });

  test("a command that ran unattended is labelled auto-approved", async () => {
    const row: HTMLElement = await renderCard(
      suggestion(
        AutoRemediationSuggestionStatus.AutoExecuted,
        [
          kubectlCommand({
            wasAutoExecuted: true,
            execution: {
              status: AiRemediationCommandExecutionStatus.Succeeded,
              exitCode: 0,
            },
          }),
        ],
        AiRemediationPlanExecutionStatus.Completed,
      ),
    );

    expect(within(row).getByText("auto-approved")).toBeInTheDocument();
    expect(within(row).queryByText("needs approval")).not.toBeInTheDocument();
    expect(within(row).getByText("Succeeded")).toBeInTheDocument();
    expect(screen.queryByText("Approve & Run")).not.toBeInTheDocument();
  });

  test("a plan a human approved shows the outcome, not a stale verdict", async () => {
    const row: HTMLElement = await renderCard(
      suggestion(
        AutoRemediationSuggestionStatus.Approved,
        [
          kubectlCommand({
            policyVerdict: AiRemediationCommandPolicyVerdict.AutoApproved,
            execution: {
              status: AiRemediationCommandExecutionStatus.Running,
            },
          }),
        ],
        AiRemediationPlanExecutionStatus.Running,
      ),
    );

    expect(within(row).queryByText("auto-approved")).not.toBeInTheDocument();
    expect(within(row).queryByText("needs approval")).not.toBeInTheDocument();
    expect(within(row).getByText("Running…")).toBeInTheDocument();
    expect(screen.getByText("Approved & started")).toBeInTheDocument();
  });

  test("a dismissed plan carries no approval pill", async () => {
    const row: HTMLElement = await renderCard(
      suggestion(AutoRemediationSuggestionStatus.Dismissed, [
        kubectlCommand({
          policyVerdict: AiRemediationCommandPolicyVerdict.RequiresApproval,
        }),
      ]),
    );

    expect(within(row).queryByText("auto-approved")).not.toBeInTheDocument();
    expect(within(row).queryByText("needs approval")).not.toBeInTheDocument();
    expect(screen.getByText("Dismissed")).toBeInTheDocument();
  });
});

/*
 * Approving a kubectl plan runs it on a cluster under the approver's name.
 * Two things went unpinned: a double click posted the approval twice (the
 * button is only disabled once React re-renders, and both clicks of a
 * double click land before that), and the server's approval-time refusal
 * — the cluster's remediation switched off, or its Runner or credential
 * changed, since the plan was composed — has to reach the reader intact.
 */
describe("RemediationSuggestionCard Approve & Run", () => {
  const APPROVE_ROUTE: string = "/auto-remediation/approve";
  const DISMISS_ROUTE: string = "/auto-remediation/dismiss";
  const SUGGESTION_ID: string = "0193c0de-6666-4aaa-8bbb-000000000006";
  const REFUSAL: string =
    "Cluster \"prod-east\" (command 1) no longer allows AI remediation: AI remediation is off — Turn it on on the cluster's AI page. Fix that on the cluster's AI page and approve again, or dismiss the suggestion.";

  let postSpy: ReturnType<typeof jest.spyOn>;

  type Answer = (value: HTTPResponse<JSONObject> | HTTPErrorResponse) => void;

  // Holds every action request open until the test answers it.
  function deferActions(): Array<Answer> {
    const answers: Array<Answer> = [];
    postSpy.mockImplementation(
      (): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> => {
        return new Promise((resolve: Answer) => {
          answers.push(resolve);
        });
      },
    );
    return answers;
  }

  function actionPosts(route: string): Array<JSONObject> {
    return postSpy.mock.calls
      .map((call: Array<unknown>): JSONObject => {
        return (call[0] || {}) as JSONObject;
      })
      .filter((request: JSONObject): boolean => {
        return String(request["url"]).endsWith(route);
      });
  }

  async function renderWaitingPlan(): Promise<HTMLElement> {
    await renderCard(
      suggestion(AutoRemediationSuggestionStatus.Suggested, [
        kubectlCommand({
          policyVerdict: AiRemediationCommandPolicyVerdict.RequiresApproval,
        }),
      ]),
    );
    return screen.getByTestId("remediation-approve-button");
  }

  beforeEach(() => {
    postSpy = jest.spyOn(API, "post");
    jest.spyOn(ModelAPI, "getCommonHeaders").mockReturnValue({});
  });

  test("a double click posts the approval once", async () => {
    const answers: Array<Answer> = deferActions();
    const button: HTMLElement = await renderWaitingPlan();

    // Both clicks land before React re-renders the button as disabled.
    act(() => {
      button.click();
      button.click();
    });

    expect(actionPosts(APPROVE_ROUTE)).toHaveLength(1);
    expect(actionPosts(APPROVE_ROUTE)[0]!["data"]).toEqual({
      suggestionId: SUGGESTION_ID,
    });
    expect(screen.getByTestId("remediation-approve-button")).toBeDisabled();
    // Dismiss is locked too while the approval is in flight.
    expect(screen.getByText("Dismiss").closest("button")).toBeDisabled();

    await act(async () => {
      answers[0]!(new HTTPResponse<JSONObject>(200, {}, {}));
    });

    await waitFor(() => {
      expect(getListSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
    expect(actionPosts(APPROVE_ROUTE)).toHaveLength(1);
  });

  test("a refused approval shows the server's reason, says nothing ran, and reloads", async () => {
    const answers: Array<Answer> = deferActions();
    const button: HTMLElement = await renderWaitingPlan();
    const listCallsBefore: number = getListSpy.mock.calls.length;

    act(() => {
      button.click();
    });

    await act(async () => {
      answers[0]!(new HTTPErrorResponse(400, { error: REFUSAL }, {}));
    });

    const alert: HTMLElement = await screen.findByTestId(
      "remediation-action-error",
    );
    expect(alert).toHaveTextContent(REFUSAL);
    expect(alert).toHaveTextContent("the fix was not approved and nothing ran");

    await waitFor(() => {
      expect(getListSpy.mock.calls.length).toBeGreaterThan(listCallsBefore);
    });

    // The guard is released: the operator can fix the cluster and retry.
    expect(screen.getByTestId("remediation-approve-button")).not.toBeDisabled();
    act(() => {
      screen.getByTestId("remediation-approve-button").click();
    });
    expect(actionPosts(APPROVE_ROUTE)).toHaveLength(2);
    // A new attempt clears the old refusal.
    expect(
      screen.queryByTestId("remediation-action-error"),
    ).not.toBeInTheDocument();
  });

  test("a refused dismissal names the dismissal", async () => {
    const answers: Array<Answer> = deferActions();
    await renderWaitingPlan();

    act(() => {
      (screen.getByText("Dismiss").closest("button") as HTMLElement).click();
    });
    expect(actionPosts(DISMISS_ROUTE)).toHaveLength(1);

    await act(async () => {
      answers[0]!(
        new HTTPErrorResponse(422, { error: "You cannot dismiss this." }, {}),
      );
    });

    const alert: HTMLElement = await screen.findByTestId(
      "remediation-action-error",
    );
    expect(alert).toHaveTextContent("You cannot dismiss this.");
    expect(alert).toHaveTextContent("the suggestion was not dismissed");
    expect(alert).not.toHaveTextContent("nothing ran");
  });

  test("the refusal headline follows the action", () => {
    expect(getActionErrorTitle("approve")).toMatch(/not approved/);
    expect(getActionErrorTitle("approve")).toMatch(/nothing ran/);
    expect(getActionErrorTitle("dismiss")).toMatch(/not dismissed/);
    expect(getActionErrorTitle(null)).toBe("Could not save your action");
  });

  /*
   * The finding (dashboard-ai-page-5): the server also refuses an
   * approval that lost to someone else's — "Only suggested remediations
   * can be approved — this one is Approved", "This suggestion was just
   * actioned by someone else" — and then the plan WAS approved and is
   * running. The headline must follow what the reloaded suggestion says.
   */
  test("the refusal headline follows what the reloaded suggestion says happened", () => {
    for (const status of [
      AutoRemediationSuggestionStatus.Approved,
      AutoRemediationSuggestionStatus.AutoExecuted,
    ]) {
      const title: string = getActionErrorTitle("approve", status);
      expect(title).not.toMatch(/nothing ran/);
      expect(title).not.toMatch(/not approved/);
      expect(title).toMatch(/already/);
    }

    // Still waiting, dismissed or inapplicable: nothing ran.
    for (const status of [
      AutoRemediationSuggestionStatus.Suggested,
      AutoRemediationSuggestionStatus.Dismissed,
      AutoRemediationSuggestionStatus.NoneApplicable,
      undefined,
    ]) {
      expect(getActionErrorTitle("approve", status)).toBe(
        "Could not save your action: the fix was not approved and nothing ran",
      );
    }

    expect(
      getActionErrorTitle("dismiss", AutoRemediationSuggestionStatus.Approved),
    ).toMatch(/not dismissed — this fix had already started/);
  });

  test("an approval refused because a teammate already approved does not say nothing ran", async () => {
    const answers: Array<Answer> = deferActions();
    const button: HTMLElement = await renderWaitingPlan();

    // By the time the click is refused, a teammate's approval is running.
    serve(
      suggestion(
        AutoRemediationSuggestionStatus.Approved,
        [
          kubectlCommand({
            execution: { status: AiRemediationCommandExecutionStatus.Running },
          }),
        ],
        AiRemediationPlanExecutionStatus.Running,
      ),
    );

    act(() => {
      button.click();
    });

    await act(async () => {
      answers[0]!(
        new HTTPErrorResponse(
          400,
          {
            error:
              "Only suggested remediations can be approved — this one is Approved.",
          },
          {},
        ),
      );
    });

    const alert: HTMLElement = await screen.findByTestId(
      "remediation-action-error",
    );
    expect(alert).toHaveTextContent("this one is Approved");
    expect(alert).toHaveTextContent("this fix had already been approved");
    expect(alert).not.toHaveTextContent("nothing ran");
    expect(alert).not.toHaveTextContent("not approved");
    // The reloaded plan is what the alert points at.
    expect(screen.getByText("Approved & started")).toBeInTheDocument();
    expect(
      screen.queryByTestId("remediation-approve-button"),
    ).not.toBeInTheDocument();
  });

  /*
   * The guard used to be released before the reload, so for one round
   * trip "Approve & Run" was enabled over the stale "Suggested" row and a
   * second click posted again.
   */
  test("a click while the post-approval reload is in flight does not post again", async () => {
    const answers: Array<Answer> = deferActions();
    const button: HTMLElement = await renderWaitingPlan();

    let answerReload: (
      value: ListResult<AutoRemediationSuggestion>,
    ) => void = (): void => {
      // replaced below
    };
    getListSpy.mockImplementation(
      (): Promise<ListResult<AutoRemediationSuggestion>> => {
        return new Promise(
          (resolve: (value: ListResult<AutoRemediationSuggestion>) => void) => {
            answerReload = resolve;
          },
        );
      },
    );
    const listCallsBefore: number = getListSpy.mock.calls.length;

    act(() => {
      button.click();
    });
    await act(async () => {
      answers[0]!(new HTTPResponse<JSONObject>(200, {}, {}));
    });

    // The approval landed; its reload has not.
    await waitFor(() => {
      expect(getListSpy.mock.calls.length).toBeGreaterThan(listCallsBefore);
    });
    expect(screen.getByTestId("remediation-approve-button")).toBeDisabled();
    act(() => {
      screen.getByTestId("remediation-approve-button").click();
    });
    expect(actionPosts(APPROVE_ROUTE)).toHaveLength(1);

    await act(async () => {
      answerReload({
        data: [
          suggestion(
            AutoRemediationSuggestionStatus.Approved,
            [kubectlCommand()],
            AiRemediationPlanExecutionStatus.Running,
          ),
        ],
        count: 1,
        skip: 0,
        limit: 10,
      });
    });

    expect(await screen.findByText("Approved & started")).toBeInTheDocument();
    expect(
      screen.queryByTestId("remediation-approve-button"),
    ).not.toBeInTheDocument();
    expect(actionPosts(APPROVE_ROUTE)).toHaveLength(1);
  });
});

/*
 * Known follow-up 15: plan.rollbackStatus said how the rollback as a
 * whole ended, but not what happened to each undo; the per-command
 * rollbackExecution records were never shown.
 */
describe("RemediationSuggestionCard rollback outcomes", () => {
  function rolledBackPlan(
    rollbackExecution: JSONObject | undefined,
  ): AutoRemediationSuggestion {
    const command: JSONObject = {
      ...kubectlCommand({
        wasAutoExecuted: true,
        execution: {
          status: AiRemediationCommandExecutionStatus.Succeeded,
          exitCode: 0,
        },
      }),
      rollbackCommand: "kubectl rollout undo deployment/web -n web",
      ...(rollbackExecution ? { rollbackExecution } : {}),
    };

    return Object.assign(new AutoRemediationSuggestion(), {
      _id: "0193c0de-6666-4aaa-8bbb-000000000006",
      status: AutoRemediationSuggestionStatus.AutoExecuted,
      suggestionType: AutoRemediationSuggestionType.CommandPlan,
      ruleNameSnapshot: "AI remediation for cluster",
      kubernetesClusterId: new ObjectID(CLUSTER_ID),
      commandPlan: {
        commands: [command],
        executionStatus: AiRemediationPlanExecutionStatus.Completed,
        rollbackStatus: "Failed",
      },
      createdAt: new Date("2026-09-22T10:00:00Z"),
    });
  }

  test("shows each undo's status, exit code, error and output", async () => {
    const row: HTMLElement = await renderCard(
      rolledBackPlan({
        status: AiRemediationCommandExecutionStatus.Failed,
        exitCode: 1,
        errorMessage: "error: no rollout history found",
        output: "rollout undo output",
      }),
    );

    const outcome: HTMLElement = within(row).getByTestId(
      "remediation-rollback-outcome",
    );
    expect(outcome).toHaveTextContent("Rollback result");
    expect(within(outcome).getByText("Failed")).toBeInTheDocument();
    expect(outcome).toHaveTextContent("Exit code: 1");
    expect(outcome).toHaveTextContent("error: no rollout history found");
    expect(outcome).not.toHaveTextContent("rollout undo output");

    act(() => {
      within(outcome).getByText("Show output").click();
    });
    expect(outcome).toHaveTextContent("rollout undo output");
    // The command's own output toggle is separate.
    expect(screen.getByText("Rollback status: Failed")).toBeInTheDocument();
  });

  test("says a skipped undo did not run", async () => {
    const row: HTMLElement = await renderCard(
      rolledBackPlan({ status: AiRemediationCommandExecutionStatus.Skipped }),
    );

    const outcome: HTMLElement = within(row).getByTestId(
      "remediation-rollback-outcome",
    );
    expect(within(outcome).getByText("Skipped")).toBeInTheDocument();
    expect(outcome).toHaveTextContent("The undo did not run");
  });

  test("shows nothing for a command whose undo never ran", async () => {
    const row: HTMLElement = await renderCard(rolledBackPlan(undefined));

    expect(
      within(row).queryByTestId("remediation-rollback-outcome"),
    ).not.toBeInTheDocument();
    // The rollback command itself is still listed.
    expect(row).toHaveTextContent("kubectl rollout undo deployment/web -n web");
  });
});
