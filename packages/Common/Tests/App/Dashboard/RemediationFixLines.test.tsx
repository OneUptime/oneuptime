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

// Only rendered when "Show reasoning" is opened; keep the lazy import out.
jest.mock("../../../UI/Components/Markdown.tsx/LazyMarkdownViewer", () => {
  return {
    __esModule: true,
    default: (): React.ReactElement => {
      return React.createElement("div", { "data-testid": "markdown" });
    },
  };
});

import RemediationStep from "../../../../App/FeatureSet/Dashboard/src/Components/AutoRemediation/RemediationStep";
import RemediationFixFact, {
  REMEDIATION_FIX_FACT_ALARMING_TEXT_CLASS_NAME,
  REMEDIATION_FIX_FACT_TEXT_CLASS_NAME,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AutoRemediation/RemediationFixFact";
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
import AutoRemediationVerificationStatus from "../../../Types/AutoRemediation/AutoRemediationVerificationStatus";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import { JSONObject } from "../../../Types/JSON";
import { KubectlCommandTier } from "../../../Types/Kubernetes/KubernetesClusterAiAccess";
import ObjectID from "../../../Types/ObjectID";
import RunbookStepType from "../../../Types/Runbook/RunbookStepType";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import { goTo, PROJECT_ID } from "./SideMenuHarness";

/*
 * A FIX ON THE AI CARD'S REMEDIATION STEP READS AS LINES (block 43's UI
 * review): "Please make the UI of this card better as well, and make it a
 * lot cleaner."
 *
 * A fix with two commands drew seven tinted pills - the fix's status, and
 * for each command its program, its tier and "needs approval" - in rows
 * that wrapped into each other on a phone, under a description that listed
 * every kind of fix there is. Now:
 *
 *   - where a fix stands, how its recovery was verified, and each command's
 *     tier, approval and outcome are words with a coloured dot
 *     (RemediationFixFact); the step's status is the card's one pill, and a
 *     failure is said in red;
 *   - a command's program is not repeated as a chip over a command that
 *     starts with it;
 *   - a fix's buttons are as wide as their words on a phone, and a fix with
 *     nothing to press draws no empty row;
 *   - a refused press says why under the buttons of the fix that was
 *     pressed, where the reader is looking.
 */

const INCIDENT_ID: ObjectID = new ObjectID(
  "0193c0de-3333-4aaa-8bbb-000000000023",
);
const CLUSTER_ID: string = "0193c0de-4444-4aaa-8bbb-000000000024";
const RUNNER_ID: string = "0193c0de-5555-4aaa-8bbb-000000000025";
const KUBECTL_FIX_ID: string = "0193c0de-6666-4aaa-8bbb-000000000026";
const RUNBOOK_FIX_ID: string = "0193c0de-6666-4aaa-8bbb-000000000027";

// A pill's shape: rounded all round, framed by a ring.
const PILL_SHAPE: RegExp = /(^|\s)rounded-full(\s|$)/;
const RING: RegExp = /(^|\s)ring-1(\s|$)/;

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
    kubectlTier: KubectlCommandTier.SafeWrite,
    command: `kubectl rollout restart deployment/web-${sequence} -n web`,
    timeoutInMs: 60000,
    rationale: "Pods hold a stale config.",
    expectedEffect: "Fresh pods pick up the corrected config.",
    policyVerdict: AiRemediationCommandPolicyVerdict.RequiresApproval,
    ...overrides,
  };
}

function kubectlFix(
  status: AutoRemediationSuggestionStatus,
  commands: Array<JSONObject>,
  extra: {
    id?: string;
    executionStatus?: AiRemediationPlanExecutionStatus;
    verificationStatus?: AutoRemediationVerificationStatus;
    verificationNote?: string;
  } = {},
): AutoRemediationSuggestion {
  return Object.assign(new AutoRemediationSuggestion(), {
    _id: extra.id || KUBECTL_FIX_ID,
    status,
    suggestionType: AutoRemediationSuggestionType.CommandPlan,
    ruleNameSnapshot: 'AI remediation for cluster "prod-east"',
    kubernetesClusterId: new ObjectID(CLUSTER_ID),
    commandPlan: {
      commands,
      ...(extra.executionStatus
        ? { executionStatus: extra.executionStatus }
        : {}),
    },
    ...(extra.verificationStatus
      ? { verificationStatus: extra.verificationStatus }
      : {}),
    ...(extra.verificationNote
      ? { verificationNote: extra.verificationNote }
      : {}),
    createdAt: new Date("2026-10-30T10:00:00Z"),
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
    createdAt: new Date("2026-10-30T09:59:00Z"),
  });
}

// The fix whose buttons hold the given words.
function fixWith(words: string): HTMLElement {
  const fix: HTMLElement | undefined = fixElements().find(
    (element: HTMLElement): boolean => {
      return Boolean(within(element).queryByText(words));
    },
  );

  if (!fix) {
    throw new Error(`No fix shows "${words}".`);
  }

  return fix;
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
): Promise<HTMLElement> {
  served = fixes;
  await act(async () => {
    render(
      <RemediationStep
        investigationStage="reported"
        incidentId={INCIDENT_ID}
      />,
    );
  });

  return await screen.findByTestId("ai-card-step-remediation");
}

function fixElements(): Array<HTMLElement> {
  return screen.getAllByTestId("remediation-fix");
}

describe("RemediationFixFact", () => {
  test("is its words after a dot that screen readers skip, never a pill", () => {
    render(
      <RemediationFixFact
        visual={{ label: "safe change", dot: "bg-emerald-500" }}
        testId="fact"
      />,
    );

    const fact: HTMLElement = screen.getByTestId("fact");
    expect(fact).toHaveTextContent("safe change");
    expect(fact).toHaveClass(REMEDIATION_FIX_FACT_TEXT_CLASS_NAME);
    expect(fact.className).not.toMatch(PILL_SHAPE);
    expect(fact.className).not.toMatch(RING);
    expect(fact).toHaveAttribute("data-alarming", "false");

    const dot: HTMLElement = fact.querySelector("[aria-hidden='true']")!;
    expect(dot).toHaveClass("rounded-full", "bg-emerald-500", "h-1.5");
    expect(dot).toBeEmptyDOMElement();
  });

  test("a failure is said in red, and its own words can replace the visual's", () => {
    render(
      <RemediationFixFact
        visual={{ label: "Failed", dot: "bg-rose-500", isAlarming: true }}
        label="It did not run"
        testId="fact"
      />,
    );

    const fact: HTMLElement = screen.getByTestId("fact");
    expect(fact).toHaveTextContent("It did not run");
    expect(fact).toHaveClass(REMEDIATION_FIX_FACT_ALARMING_TEXT_CLASS_NAME);
    expect(fact).not.toHaveClass(REMEDIATION_FIX_FACT_TEXT_CLASS_NAME);
    expect(fact).toHaveAttribute("data-alarming", "true");
  });
});

describe("a fix on the Remediation step", () => {
  test("waiting for approval: where it stands and each command's facts are words with a dot, and the step's status is the one pill", async () => {
    const step: HTMLElement = await renderStep([
      kubectlFix(AutoRemediationSuggestionStatus.Suggested, [
        kubectlCommand(1),
        kubectlCommand(2, { kubectlTier: KubectlCommandTier.RiskyWrite }),
      ]),
    ]);

    const fix: HTMLElement = fixElements()[0]!;
    const status: HTMLElement = within(fix).getByTestId(
      "remediation-fix-status",
    );
    expect(status).toHaveTextContent("Waiting for approval");
    // Beside the fix's name, among its facts.
    expect(within(fix).getByTestId("remediation-fix-facts")).toContainElement(
      status,
    );

    const commands: Array<HTMLElement> = within(fix).getAllByTestId(
      "remediation-command",
    );
    expect(commands).toHaveLength(2);
    expect(
      within(commands[0]!).getByTestId("remediation-command-tier"),
    ).toHaveTextContent("safe change");
    expect(
      within(commands[1]!).getByTestId("remediation-command-tier"),
    ).toHaveTextContent("riskier change");
    for (const command of commands) {
      expect(
        within(command).getByTestId("remediation-command-approval"),
      ).toHaveTextContent("needs approval");
    }

    /*
     * The one pill of the step is its status, beside its title: nothing in
     * its body is a pill (its mark is a ringed circle, not a pill).
     */
    const pillsIn: (root: Element) => Array<Element> = (
      root: Element,
    ): Array<Element> => {
      return Array.from(root.querySelectorAll("*")).filter(
        (element: Element): boolean => {
          const className: string = element.getAttribute("class") || "";
          return PILL_SHAPE.test(className) && RING.test(className);
        },
      );
    };
    expect(
      pillsIn(screen.getByTestId("ai-card-step-remediation-body")),
    ).toHaveLength(0);
    const statusPills: Array<Element> = pillsIn(
      screen.getByTestId("ai-card-step-remediation-status"),
    );
    expect(statusPills).toHaveLength(1);
    expect(statusPills[0]).toHaveTextContent("Needs your approval");
    expect(step).toContainElement(statusPills[0] as HTMLElement);

    // Nothing that must not be read past: no fact is said in red.
    expect(fix.querySelectorAll("[data-alarming='true']")).toHaveLength(0);
  });

  test("a command whose command starts with its program draws no chip that repeats it", async () => {
    await renderStep([
      kubectlFix(AutoRemediationSuggestionStatus.Suggested, [
        kubectlCommand(1),
      ]),
    ]);

    const command: HTMLElement = screen.getByTestId("remediation-command");
    expect(
      within(command).queryByTestId("remediation-command-program"),
    ).not.toBeInTheDocument();
    expect(
      within(command).getByText(
        "kubectl rollout restart deployment/web-1 -n web",
      ),
    ).toBeInTheDocument();
  });

  test("a command that failed, and a recovery that was not verified, are said in red", async () => {
    await renderStep([
      kubectlFix(
        AutoRemediationSuggestionStatus.Approved,
        [
          kubectlCommand(1, {
            execution: {
              status: AiRemediationCommandExecutionStatus.Failed,
              exitCode: 1,
              errorMessage: "deployments.apps 'web-1' not found",
            },
          }),
        ],
        {
          executionStatus: AiRemediationPlanExecutionStatus.Failed,
          verificationStatus: AutoRemediationVerificationStatus.Failed,
        },
      ),
    ]);

    const fix: HTMLElement = fixElements()[0]!;
    const execution: HTMLElement = within(fix).getByTestId(
      "remediation-command-execution",
    );
    expect(execution).toHaveTextContent("Failed");
    expect(execution).toHaveAttribute("data-alarming", "true");
    expect(execution).toHaveClass(
      REMEDIATION_FIX_FACT_ALARMING_TEXT_CLASS_NAME,
    );

    const verification: HTMLElement = within(fix).getByTestId(
      "remediation-fix-verification",
    );
    expect(verification).toHaveTextContent("Verification failed");
    expect(verification).toHaveAttribute("data-alarming", "true");

    // Where it stands is not a failure of its own: it was approved.
    expect(within(fix).getByTestId("remediation-fix-status")).toHaveAttribute(
      "data-alarming",
      "false",
    );
  });

  /*
   * What OneUptime AI and the agents wrote is in whatever language they
   * wrote it: on a Persian page an English sentence put its full stop at
   * the start of its line. Each reads in its own direction, and a command
   * is code, which reads left to right everywhere.
   */
  test("what OneUptime AI and the agents wrote reads in its own direction, and an undo is code", async () => {
    await renderStep([
      kubectlFix(
        AutoRemediationSuggestionStatus.Approved,
        [
          kubectlCommand(1, {
            rollbackCommand: "kubectl rollout undo deployment/web-1 -n web",
            execution: {
              status: AiRemediationCommandExecutionStatus.Failed,
              exitCode: 1,
              errorMessage: "deployments.apps 'web-1' not found",
            },
          }),
        ],
        {
          executionStatus: AiRemediationPlanExecutionStatus.Failed,
          verificationStatus: AutoRemediationVerificationStatus.Failed,
        },
      ),
    ]);

    const fix: HTMLElement = fixElements()[0]!;
    expect(
      within(fix).getByTestId("remediation-command-rationale"),
    ).toHaveAttribute("dir", "auto");
    expect(
      within(fix).getByText("deployments.apps 'web-1' not found"),
    ).toHaveAttribute("dir", "auto");
    const undo: HTMLElement = within(fix).getByText(
      "kubectl rollout undo deployment/web-1 -n web",
    );
    expect(undo.tagName).toBe("CODE");
  });

  test("a verification's note reads in its own direction", async () => {
    await renderStep([
      kubectlFix(
        AutoRemediationSuggestionStatus.Approved,
        [kubectlCommand(1)],
        {
          executionStatus: AiRemediationPlanExecutionStatus.Completed,
          verificationStatus: AutoRemediationVerificationStatus.Verified,
          verificationNote: "p95 latency was back under 500 ms.",
        },
      ),
    ]);

    const note: HTMLElement = screen.getByTestId(
      "remediation-fix-verification-note",
    );
    expect(note).toHaveTextContent("p95 latency was back under 500 ms.");
    expect(note).toHaveAttribute("dir", "auto");
  });

  test("its buttons are as wide as their words, and a fix with nothing to press draws no empty row", async () => {
    await renderStep([
      kubectlFix(AutoRemediationSuggestionStatus.Suggested, [
        kubectlCommand(1),
      ]),
      kubectlFix(
        AutoRemediationSuggestionStatus.AutoExecuted,
        [
          kubectlCommand(1, {
            wasAutoExecuted: true,
            execution: {
              status: AiRemediationCommandExecutionStatus.Succeeded,
              exitCode: 0,
            },
          }),
        ],
        {
          id: "0193c0de-6666-4aaa-8bbb-000000000028",
          executionStatus: AiRemediationPlanExecutionStatus.Completed,
        },
      ),
    ]);

    const waiting: HTMLElement = fixWith("Approve & Run");
    const ran: HTMLElement = fixWith("Auto-executed");
    const actions: HTMLElement = within(waiting).getByTestId(
      "remediation-fix-actions",
    );
    /*
     * A Button fills its row below md: the row holds each one to its own
     * width, so Approve & Run is not a bar of its own over Dismiss.
     */
    expect(actions).toHaveClass("[&>button]:w-auto");
    expect(within(actions).getByText("Approve & Run")).toBeInTheDocument();
    expect(within(actions).getByText("Dismiss")).toBeInTheDocument();

    expect(
      within(ran).queryByTestId("remediation-fix-actions"),
    ).not.toBeInTheDocument();
    expect(within(ran).getByTestId("remediation-fix-status")).toHaveTextContent(
      "Auto-executed",
    );
  });

  test("a refused approval says why under the buttons of the fix that was pressed, not over the step", async () => {
    await renderStep([
      runbookFix(AutoRemediationSuggestionStatus.Approved),
      kubectlFix(AutoRemediationSuggestionStatus.Suggested, [
        kubectlCommand(1),
      ]),
    ]);
    postSpy.mockResolvedValue(
      new HTTPErrorResponse(
        400,
        {
          message:
            'Fixes were turned off for cluster "prod-east" after this fix was proposed.',
        },
        {},
      ) as never,
    );
    jest
      .spyOn(API, "getFriendlyMessage")
      .mockReturnValue(
        'Fixes were turned off for cluster "prod-east" after this fix was proposed.',
      );

    await act(async () => {
      fireEvent.click(
        within(fixWith("Approve & Run")).getByText("Approve & Run"),
      );
    });

    const refusal: HTMLElement = await screen.findByTestId(
      "remediation-action-error",
    );
    expect(refusal).toHaveAttribute("role", "alert");
    expect(refusal).toHaveTextContent(
      "Could not save your action: the fix was not approved and nothing ran",
    );
    expect(refusal).toHaveTextContent('cluster "prod-east"');

    // Under the fix that was pressed, after its buttons.
    const pressed: HTMLElement = fixWith("Approve & Run");
    expect(pressed).toContainElement(refusal);
    expect(
      within(pressed)
        .getByTestId("remediation-fix-actions")
        .compareDocumentPosition(refusal) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // Said once, and not under the other fix.
    expect(screen.getAllByTestId("remediation-action-error")).toHaveLength(1);
    expect(fixWith("Restart checkout-api pods")).not.toContainElement(refusal);

    // Put away, it goes.
    fireEvent.click(within(refusal).getByRole("button"));
    expect(screen.queryByTestId("remediation-action-error")).toBeNull();
  });

  test("a refusal whose fix is gone from the step is said over the step", async () => {
    await renderStep([
      kubectlFix(AutoRemediationSuggestionStatus.Suggested, [
        kubectlCommand(1),
      ]),
    ]);
    postSpy.mockImplementation((async () => {
      // The fix is gone by the time the step reads its fixes again.
      served = [];
      return new HTTPErrorResponse(
        400,
        { message: "This suggestion was just actioned by someone else." },
        {},
      );
    }) as never);
    jest
      .spyOn(API, "getFriendlyMessage")
      .mockReturnValue("This suggestion was just actioned by someone else.");

    await act(async () => {
      fireEvent.click(screen.getByText("Approve & Run"));
    });

    const refusal: HTMLElement = await screen.findByTestId(
      "remediation-action-error",
    );
    expect(refusal).toHaveTextContent(
      "This suggestion was just actioned by someone else.",
    );
    expect(screen.queryAllByTestId("remediation-fix")).toHaveLength(0);
    expect(
      screen.getByTestId("ai-card-step-remediation-body"),
    ).toContainElement(refusal);
  });

  test("an approval that went through says nothing of a refusal", async () => {
    await renderStep([
      kubectlFix(AutoRemediationSuggestionStatus.Suggested, [
        kubectlCommand(1),
      ]),
    ]);
    postSpy.mockImplementation((async () => {
      served = [
        kubectlFix(AutoRemediationSuggestionStatus.Approved, [
          kubectlCommand(1, {
            execution: {
              status: AiRemediationCommandExecutionStatus.Running,
            },
          }),
        ]),
      ];
      return new HTTPResponse<JSONObject>(200, {}, {});
    }) as never);

    await act(async () => {
      fireEvent.click(screen.getByText("Approve & Run"));
    });

    expect(
      await screen.findByTestId("remediation-command-execution"),
    ).toHaveTextContent("Running…");
    expect(screen.queryByTestId("remediation-action-error")).toBeNull();
    expect(screen.getByTestId("remediation-fix-status")).toHaveTextContent(
      "Approved & started",
    );
  });
});
