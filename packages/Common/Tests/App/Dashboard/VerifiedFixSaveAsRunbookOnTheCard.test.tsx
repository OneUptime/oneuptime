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

jest.mock("../../../UI/Components/Markdown.tsx/LazyMarkdownViewer", () => {
  return {
    __esModule: true,
    default: (): React.ReactElement => {
      return React.createElement("div", { "data-testid": "markdown" });
    },
  };
});

import RemediationStep, {
  getActionErrorTitle,
  VERIFIED_FIX_SAVED_AS_RUNBOOK,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AutoRemediation/RemediationStep";
import AutoRemediationSuggestion from "../../../Models/DatabaseModels/AutoRemediationSuggestion";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Runbook from "../../../Models/DatabaseModels/Runbook";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import {
  AiRemediationCommandExecutionStatus,
  AiRemediationCommandPlanUtil,
} from "../../../Types/AutoRemediation/AiRemediationCommandPlan";
import { AiRemediationCommandPolicyVerdict } from "../../../Types/AutoRemediation/AiRemediationCommandPolicyVerdict";
import AutoRemediationSuggestionStatus from "../../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import AutoRemediationSuggestionType from "../../../Types/AutoRemediation/AutoRemediationSuggestionType";
import AutoRemediationVerificationStatus from "../../../Types/AutoRemediation/AutoRemediationVerificationStatus";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import RunbookStepType from "../../../Types/Runbook/RunbookStepType";
import {
  VERIFIED_FIX_RUNBOOK_REFUSAL_MESSAGES,
  VerifiedFixRunbookRefusal,
} from "../../../Utils/AiRemediation/VerifiedFixRunbook";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, {
  ModelAction,
  PermissionGateOptions,
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";
import { goTo, PROJECT_ID } from "./SideMenuHarness";

/*
 * SAVE AS RUNBOOK ON A VERIFIED FIX (#6801): OneUptime AI could run a
 * runbook but never write one. A fix it ran on its own commands, once
 * verified, offers to be written down as a runbook - to someone who may
 * create runbooks - and once it is, names the runbook it was saved as, a
 * link to its steps, instead of offering it again. A fix that is not
 * verified, or that ran a runbook, offers nothing of the kind.
 */

const INCIDENT_ID: ObjectID = new ObjectID(
  "0193c0de-3333-4aaa-8bbb-000000000063",
);
const SUGGESTION_ID: string = "0193c0de-6666-4aaa-8bbb-000000000066";
const RUNBOOK_ID: string = "0193c0de-7777-4aaa-8bbb-000000000067";
const RUNNER_ID: string = "0193c0de-5555-4aaa-8bbb-000000000065";

function verifiedFix(
  overrides: Partial<Record<string, unknown>> = {},
): AutoRemediationSuggestion {
  return Object.assign(new AutoRemediationSuggestion(), {
    _id: SUGGESTION_ID,
    status: AutoRemediationSuggestionStatus.Approved,
    suggestionType: AutoRemediationSuggestionType.CommandPlan,
    ruleNameSnapshot: "Restart nginx",
    verificationStatus: AutoRemediationVerificationStatus.Verified,
    verificationCompletedAt: new Date("2026-11-15T10:05:00Z"),
    commandPlan: AiRemediationCommandPlanUtil.toJSON({
      commands: [
        {
          sequence: 1,
          stepType: RunbookStepType.Bash,
          runnerId: RUNNER_ID,
          runnerNameSnapshot: "web-1",
          command: "systemctl restart nginx",
          timeoutInMs: 30000,
          rationale: "nginx stopped answering",
          expectedEffect: "nginx answers again",
          policyVerdict: AiRemediationCommandPolicyVerdict.RequiresApproval,
          execution: {
            status: AiRemediationCommandExecutionStatus.Succeeded,
            exitCode: 0,
          },
        },
      ],
    }),
    createdAt: new Date("2026-11-15T10:00:00Z"),
    ...overrides,
  });
}

let postSpy: ReturnType<typeof jest.spyOn>;
let served: Array<AutoRemediationSuggestion> = [];
let mayCreateRunbook: boolean = true;

async function renderStep(
  rows: Array<AutoRemediationSuggestion>,
): Promise<HTMLElement> {
  served = rows;
  render(
    <RemediationStep investigationStage="reported" incidentId={INCIDENT_ID} />,
  );

  return await screen.findByTestId("remediation-fix");
}

beforeEach(() => {
  goTo(`/dashboard/${PROJECT_ID}/incidents/${INCIDENT_ID.toString()}`);
  served = [];
  mayCreateRunbook = true;
  jest.spyOn(ModelAPI, "getList").mockImplementation((async (data: {
    modelType: unknown;
  }): Promise<ListResult<AutoRemediationSuggestion>> => {
    if (data.modelType !== AutoRemediationSuggestion) {
      return { data: [], count: 0, skip: 0, limit: 5 };
    }

    return { data: served, count: served.length, skip: 0, limit: 10 };
  }) as never);
  postSpy = jest.spyOn(API, "post");
  jest.spyOn(ModelAPI, "getCommonHeaders").mockReturnValue({});

  // Creating runbooks is the reader's, as the test sets it; everything else as it is.
  const check: typeof PermissionGate.check =
    PermissionGate.check.bind(PermissionGate);
  jest
    .spyOn(PermissionGate, "check")
    .mockImplementation(
      (
        model: BaseModel,
        action: ModelAction,
        options?: PermissionGateOptions,
      ): PermissionGateResult => {
        if (model instanceof Runbook && action === ModelAction.Create) {
          return mayCreateRunbook
            ? { isAllowed: true }
            : {
                isAllowed: false,
                disabledReason: "You may not create runbooks.",
              };
        }

        return check(model, action, options);
      },
    );
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("a verified fix of OneUptime AI's own commands", () => {
  test("offers Save as Runbook, and saving it asks the server for that fix", async () => {
    postSpy.mockResolvedValue(
      new HTTPResponse<JSONObject>(
        200,
        { runbookId: RUNBOOK_ID, runbookName: "Fix: nginx down" },
        {},
      ) as never,
    );
    const fix: HTMLElement = await renderStep([verifiedFix()]);

    const button: HTMLElement = within(fix).getByTestId(
      "remediation-save-as-runbook-button",
    );
    expect(button).toHaveTextContent("Save as Runbook");

    await act(async (): Promise<void> => {
      fireEvent.click(button);
    });

    await waitFor(() => {
      expect(postSpy).toHaveBeenCalledTimes(1);
    });
    const request: JSONObject = postSpy.mock.calls[0]![0] as JSONObject;
    expect(String(request["url"])).toMatch(
      /\/auto-remediation\/save-as-runbook$/,
    );
    expect(request["data"]).toEqual({ suggestionId: SUGGESTION_ID });
  });

  test("saved already: names the runbook, linked to its steps, and offers nothing again", async () => {
    const fix: HTMLElement = await renderStep([
      verifiedFix({
        savedAsRunbookId: new ObjectID(RUNBOOK_ID),
        savedAsRunbook: Object.assign(new Runbook(), {
          _id: RUNBOOK_ID,
          name: "Fix: nginx down",
        }),
      }),
    ]);

    const saved: HTMLElement = within(fix).getByTestId(
      "remediation-saved-as-runbook",
    );
    expect(saved).toHaveTextContent(
      "This fix worked and is saved as the runbook Fix: nginx down. It stays off until someone reviews its steps and turns it on.",
    );
    expect(
      within(saved).getByTestId("remediation-saved-as-runbook-link"),
    ).toHaveAttribute(
      "href",
      expect.stringContaining(`/runbooks/${RUNBOOK_ID}`),
    );
    expect(
      within(fix).queryByTestId("remediation-save-as-runbook-button"),
    ).toBeNull();
  });

  test("for someone who may not create runbooks: no button to press", async () => {
    mayCreateRunbook = false;
    const fix: HTMLElement = await renderStep([verifiedFix()]);

    expect(
      within(fix).queryByTestId("remediation-save-as-runbook-button"),
    ).toBeNull();
  });

  test("refused: why, under the buttons, in the server's words", async () => {
    postSpy.mockResolvedValue(
      new HTTPErrorResponse(
        400,
        {
          message:
            VERIFIED_FIX_RUNBOOK_REFUSAL_MESSAGES[
              VerifiedFixRunbookRefusal.AlreadySaved
            ],
        },
        {},
      ) as never,
    );
    const fix: HTMLElement = await renderStep([verifiedFix()]);

    await act(async (): Promise<void> => {
      fireEvent.click(
        within(fix).getByTestId("remediation-save-as-runbook-button"),
      );
    });

    const notice: HTMLElement = await within(fix).findByTestId(
      "remediation-action-error",
    );
    expect(notice).toHaveTextContent("The fix was not saved as a runbook");
    expect(notice).toHaveTextContent(
      "This fix is saved as a runbook already. Open that runbook from the fix.",
    );
  });
});

describe("a fix with nothing worth writing down", () => {
  test.each([
    [
      "not verified yet",
      { verificationStatus: AutoRemediationVerificationStatus.Pending },
    ],
    [
      "whose verification failed",
      { verificationStatus: AutoRemediationVerificationStatus.Failed },
    ],
    [
      "that ran a runbook",
      {
        suggestionType: AutoRemediationSuggestionType.Runbook,
        runbookId: new ObjectID(RUNBOOK_ID),
        runbookNameSnapshot: "Restart nginx",
        runbookExecutionId: new ObjectID(
          "0193c0de-8888-4aaa-8bbb-000000000068",
        ),
        commandPlan: undefined,
      },
    ],
  ])(
    "%s offers no Save as Runbook",
    async (_what: string, overrides: Record<string, unknown>) => {
      const fix: HTMLElement = await renderStep([verifiedFix(overrides)]);

      expect(
        within(fix).queryByTestId("remediation-save-as-runbook-button"),
      ).toBeNull();
      expect(
        within(fix).queryByTestId("remediation-saved-as-runbook"),
      ).toBeNull();
    },
  );
});

describe("the words", () => {
  test("a refused save says what did not happen", () => {
    expect(getActionErrorTitle("save-as-runbook")).toBe(
      "The fix was not saved as a runbook",
    );
  });

  test("a saved fix names its runbook in the sentence, so each language can place it", () => {
    expect(VERIFIED_FIX_SAVED_AS_RUNBOOK).toContain("{{runbook}}");
  });
});
