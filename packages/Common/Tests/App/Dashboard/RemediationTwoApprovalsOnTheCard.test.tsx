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

import RemediationStep from "../../../../App/FeatureSet/Dashboard/src/Components/AutoRemediation/RemediationStep";
import { REMEDIATION_TWO_APPROVALS_COPY } from "../../../../App/FeatureSet/Dashboard/src/Components/AutoRemediation/RemediationStepCopy";
import { TWO_APPROVALS_COLUMN } from "../../../../App/FeatureSet/Dashboard/src/Components/AISettings/FixApprovalsCopy";
import AutoRemediationDecision from "../../../Models/DatabaseModels/AutoRemediationDecision";
import AutoRemediationSuggestion from "../../../Models/DatabaseModels/AutoRemediationSuggestion";
import Project from "../../../Models/DatabaseModels/Project";
import User from "../../../Models/DatabaseModels/User";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { AiRemediationCommandPolicyVerdict } from "../../../Types/AutoRemediation/AiRemediationCommandPlan";
import AutoRemediationApprovalSource from "../../../Types/AutoRemediation/AutoRemediationApprovalSource";
import AutoRemediationSuggestionStatus from "../../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import AutoRemediationSuggestionType from "../../../Types/AutoRemediation/AutoRemediationSuggestionType";
import { ALREADY_APPROVED_FIRST_MESSAGE } from "../../../Types/AutoRemediation/RemediationApprovals";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import { JSONObject } from "../../../Types/JSON";
import { KubectlCommandTier } from "../../../Types/Kubernetes/KubernetesClusterAiAccess";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import RunbookStepType from "../../../Types/Runbook/RunbookStepType";
import { announceModelSwitchSaved } from "../../../UI/Components/ModelSwitch/ModelSwitchEvents";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionUtil from "../../../UI/Utils/Permission";
import ProjectUtil from "../../../UI/Utils/Project";
import UserUtil from "../../../UI/Utils/User";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";
import { openRemediationFixes } from "./RemediationFixHarness";
import { goTo, PROJECT_ID } from "./SideMenuHarness";

/*
 * TWO PEOPLE APPROVE A RISKIER FIX, ON THE AI CARD'S REMEDIATION STEP
 * (#6148's follow-up), rendered with the card's real reads stubbed:
 *
 *  - where the project asks for two (Project.requireTwoApprovalsForRiskierFixes,
 *    read only while a riskier fix waits), the first approval's press says
 *    "Approve" and that nothing runs until someone else approves it too;
 *  - pressing it records the first approval (the server's answer), and the
 *    card reads it back: the first approval as a step, "Needs a second
 *    approval", why the reader's own press would do nothing - and no Approve
 *    for them, while Dismiss fix stays;
 *  - someone else reads whose approval came first, and an "Approve & Run"
 *    that runs it;
 *  - with the rule off, the card reads as it always has (negative control);
 *  - a first approver's press the server refused says their approval was
 *    already recorded, and why, in their language.
 */

const INCIDENT_ID: ObjectID = new ObjectID(
  "0193c0de-7777-4aaa-8bbb-0000000000e1",
);
const SUGGESTION_ID: string = "0193c0de-6666-4aaa-8bbb-0000000000e2";
const MAYA: ObjectID = new ObjectID("0193c0de-aaaa-4aaa-8bbb-0000000000aa");
const SAM: ObjectID = new ObjectID("0193c0de-bbbb-4aaa-8bbb-0000000000bb");

function plan(tier: KubectlCommandTier): JSONObject {
  return {
    commands: [
      {
        sequence: 1,
        stepType: RunbookStepType.Kubectl,
        runnerId: "0193c0de-1111-4aaa-8bbb-0000000000e3",
        runnerNameSnapshot: "Kubernetes AI agent",
        kubernetesClusterId: "0193c0de-2222-4aaa-8bbb-0000000000e4",
        kubernetesClusterNameSnapshot: "prod-east",
        kubectlTier: tier,
        command:
          tier === KubectlCommandTier.RiskyWrite
            ? "kubectl scale deployment/web --replicas=0 -n web"
            : "kubectl rollout restart deployment/web -n web",
        timeoutInMs: 60000,
        rationale: "the old pods hold the bad config",
        expectedEffect: "fresh pods",
        policyVerdict: AiRemediationCommandPolicyVerdict.RequiresApproval,
      },
    ],
  };
}

function waitingFix(
  data: Record<string, unknown> = {},
): AutoRemediationSuggestion {
  return Object.assign(new AutoRemediationSuggestion(), {
    _id: SUGGESTION_ID,
    status: AutoRemediationSuggestionStatus.Suggested,
    suggestionType: AutoRemediationSuggestionType.CommandPlan,
    ruleNameSnapshot: "AI remediation for cluster prod-east",
    kubernetesClusterId: new ObjectID("0193c0de-2222-4aaa-8bbb-0000000000e4"),
    commandPlan: plan(KubectlCommandTier.RiskyWrite),
    createdAt: new Date("2026-11-06T09:00:00Z"),
    ...data,
  });
}

function firstApprovedBy(
  userId: ObjectID,
  name: string,
): Record<string, unknown> {
  const user: User = new User();
  user.name = new Name(name);

  return {
    firstApprovedByUserId: userId,
    firstApprovedByUser: user,
    firstApprovedAt: new Date("2026-11-06T09:02:00Z"),
    firstApprovedFrom: AutoRemediationApprovalSource.Slack,
  };
}

let served: Array<AutoRemediationSuggestion> = [];
let isRuleOn: boolean = true;
let getItemSpy: ReturnType<typeof jest.spyOn>;
let postSpy: ReturnType<typeof jest.spyOn>;

interface PostRequest {
  url: { toString: () => string };
  data: JSONObject;
}

// The reads of the project's two-approvals rule the card made.
function ruleReads(): number {
  return getItemSpy.mock.calls.filter((call: Array<unknown>): boolean => {
    const select: Record<string, unknown> =
      (call[0] as { select?: Record<string, unknown> }).select || {};
    return Boolean(select[TWO_APPROVALS_COLUMN]);
  }).length;
}

function renderStep(): void {
  render(
    <RemediationStep incidentId={INCIDENT_ID} investigationStage="reported" />,
  );
}

function approvalStep(): HTMLElement {
  const step: HTMLElement | undefined = screen
    .getAllByTestId("remediation-fix-step")
    .find((each: HTMLElement): boolean => {
      return each.getAttribute("data-step") === "approval";
    });

  if (!step) {
    throw new Error("The fix has no approval step.");
  }

  return step;
}

function stepKinds(): Array<string> {
  return screen
    .getAllByTestId("remediation-fix-step")
    .map((step: HTMLElement): string => {
      return step.getAttribute("data-step") || "";
    });
}

function approveButton(): HTMLElement | null {
  return screen.queryByTestId("remediation-approve-button");
}

beforeEach(() => {
  goTo(`/dashboard/${PROJECT_ID}/incidents/${INCIDENT_ID.toString()}`);
  served = [waitingFix()];
  isRuleOn = true;

  jest.spyOn(ModelAPI, "getList").mockImplementation((async (data: {
    modelType: { new (): unknown };
  }): Promise<
    ListResult<AutoRemediationDecision | AutoRemediationSuggestion>
  > => {
    if (data.modelType === AutoRemediationDecision) {
      return { data: [], count: 0, skip: 0, limit: 5 };
    }

    return { data: served, count: served.length, skip: 0, limit: 10 };
  }) as never);
  getItemSpy = jest
    .spyOn(ModelAPI, "getItem")
    .mockImplementation((async (): Promise<Project> => {
      return Object.assign(new Project(), {
        requireTwoApprovalsForRiskierFixes: isRuleOn,
      }) as Project;
    }) as never);
  postSpy = jest.spyOn(API, "post");
  jest.spyOn(ModelAPI, "getCommonHeaders").mockReturnValue({});
  jest
    .spyOn(PermissionUtil, "getAllPermissions")
    .mockReturnValue([Permission.ProjectOwner]);
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
  jest.spyOn(UserUtil, "getUserId").mockReturnValue(MAYA);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("a riskier fix nobody approved yet, where two people must approve it", () => {
  test("its press says Approve, and that nothing runs until someone else approves it too", async () => {
    renderStep();
    await openRemediationFixes();

    // Once the project's rule is read: the first approval runs nothing.
    await waitFor(() => {
      expect(approveButton()).not.toHaveTextContent("Run");
    });
    expect(approveButton()).toHaveTextContent("Approve");
    expect(screen.getByTestId("remediation-approval-note")).toHaveTextContent(
      REMEDIATION_TWO_APPROVALS_COPY.firstApprovalNote,
    );
    expect(
      within(approvalStep()).getByTestId("remediation-fix-step-summary"),
    ).toHaveTextContent(
      "Two people must approve this riskier fix. Yours is the first.",
    );
    expect(ruleReads()).toBe(1);
  });

  test("pressing it records the first approval; the card then says a second is needed, and offers its first approver no Approve", async () => {
    postSpy.mockImplementation((async (request: PostRequest) => {
      if (request.url.toString().includes("/auto-remediation/approve")) {
        // The server recorded Maya's approval as the first of two.
        served = [waitingFix(firstApprovedBy(MAYA, "Maya Chen"))];
        return new HTTPResponse<JSONObject>(
          200,
          {
            suggestionId: SUGGESTION_ID,
            status: AutoRemediationSuggestionStatus.Suggested,
            isWaitingForSecondApproval: true,
          },
          {},
        );
      }

      throw new Error(`unexpected ${request.url.toString()}`);
    }) as never);

    renderStep();
    await openRemediationFixes();
    await waitFor(() => {
      expect(approveButton()).not.toBeNull();
    });

    await act(async (): Promise<void> => {
      fireEvent.click(approveButton()!);
    });

    await waitFor(() => {
      expect(stepKinds()).toContain("firstApproval");
    });

    expect(
      (postSpy.mock.calls[0]![0] as PostRequest).data["suggestionId"],
    ).toBe(SUGGESTION_ID);
    expect(withoutIsolateMarks(approvalStep().textContent || "")).toContain(
      "Needs a second approval",
    );
    expect(
      within(approvalStep()).getByTestId("remediation-fix-step-summary"),
    ).toHaveTextContent(
      "You approved it first. It runs once someone else approves it too.",
    );
    // Nothing more for Maya to approve; Dismiss fix is still hers.
    expect(approveButton()).toBeNull();
    expect(screen.getByTestId("remediation-dismiss-button")).toBeVisible();
    expect(screen.getByTestId("remediation-fix-status")).toHaveTextContent(
      "Waiting for a second approval",
    );
    expect(
      screen.getByTestId("ai-card-step-remediation-pill"),
    ).toHaveTextContent("Needs a second approval");
    // No refusal: the press did what it says.
    expect(screen.queryByTestId("remediation-action-error")).toBeNull();
  });
});

describe("a riskier fix someone else approved first", () => {
  test("the steps say whose approval came first, and the reader's Approve & Run runs it", async () => {
    served = [waitingFix(firstApprovedBy(MAYA, "Maya Chen"))];
    jest.spyOn(UserUtil, "getUserId").mockReturnValue(SAM);

    renderStep();
    await openRemediationFixes();

    await waitFor(() => {
      expect(approveButton()).toHaveTextContent("Approve & Run");
    });
    expect(stepKinds()).toEqual(
      expect.arrayContaining(["plan", "firstApproval", "approval"]),
    );
    const first: HTMLElement = screen
      .getAllByTestId("remediation-fix-step")
      .find((each: HTMLElement): boolean => {
        return each.getAttribute("data-step") === "firstApproval";
      })!;
    expect(withoutIsolateMarks(first.textContent || "")).toContain(
      "Approved by Maya Chen in Slack",
    );
    expect(
      within(approvalStep()).getByTestId("remediation-fix-step-summary"),
    ).toHaveTextContent(
      "Two people must approve this riskier fix. Your approval runs it.",
    );
    expect(screen.getByTestId("remediation-approval-note")).toHaveTextContent(
      "Approving runs exactly what is shown, under your name.",
    );
    expect(
      screen.getByTestId("ai-card-step-remediation-pill"),
    ).toHaveTextContent("Needs your approval");
  });
});

describe("as it always was", () => {
  test("with the rule off, a riskier fix's press runs it, and nothing is said of two (negative control)", async () => {
    isRuleOn = false;

    renderStep();
    await openRemediationFixes();

    await waitFor(() => {
      expect(approveButton()).toHaveTextContent("Approve & Run");
    });
    expect(screen.getByTestId("remediation-approval-note")).toHaveTextContent(
      "Approving runs exactly what is shown, under your name.",
    );
    expect(document.body).not.toHaveTextContent("Two people must approve");
  });

  test("a fix of safe changes never asks whether two must approve it", async () => {
    served = [waitingFix({ commandPlan: plan(KubectlCommandTier.SafeWrite) })];

    renderStep();
    await openRemediationFixes();

    await waitFor(() => {
      expect(approveButton()).toHaveTextContent("Approve & Run");
    });
    expect(ruleReads()).toBe(0);
  });

  test("the rule turned on while the card is open is followed at once", async () => {
    isRuleOn = false;

    renderStep();
    await openRemediationFixes();
    await waitFor(() => {
      expect(approveButton()).toHaveTextContent("Approve & Run");
    });

    await act(async (): Promise<void> => {
      announceModelSwitchSaved({
        modelType: Project,
        modelId: new ObjectID(PROJECT_ID),
        column: TWO_APPROVALS_COLUMN,
        value: true,
      });
    });

    await waitFor(() => {
      expect(approveButton()).not.toHaveTextContent("Run");
    });
  });
});

describe("a first approver's press the server refused", () => {
  test("says their approval was already recorded, and why", async () => {
    postSpy.mockImplementation((async () => {
      // Approved from Slack meanwhile: the card's press comes second.
      served = [waitingFix(firstApprovedBy(MAYA, "Maya Chen"))];
      return new HTTPErrorResponse(
        400,
        { message: ALREADY_APPROVED_FIRST_MESSAGE },
        {},
      );
    }) as never);

    renderStep();
    await openRemediationFixes();
    await waitFor(() => {
      expect(approveButton()).not.toBeNull();
    });

    await act(async (): Promise<void> => {
      fireEvent.click(approveButton()!);
    });

    const error: HTMLElement = await screen.findByTestId(
      "remediation-action-error",
    );
    expect(error).toHaveTextContent(
      REMEDIATION_TWO_APPROVALS_COPY.alreadyApprovedTitle,
    );
    expect(error).toHaveTextContent(ALREADY_APPROVED_FIRST_MESSAGE);
  });
});
