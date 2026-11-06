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
import type { SpyInstance } from "jest-mock";
import * as React from "react";

jest.mock("../../../UI/Components/Markdown.tsx/LazyMarkdownViewer", () => {
  return {
    __esModule: true,
    default: (): React.ReactElement => {
      return React.createElement("div", { "data-testid": "markdown" });
    },
  };
});

import RemediationStep from "../../../../App/FeatureSet/Dashboard/src/Components/AutoRemediation/RemediationStep";
import {
  DECLARED_CODE_DIALOG_DISMISSED_NOTE,
  DECLARED_CODE_DIALOG_WAITING_NOTE,
  DECLARED_CODE_LASTING_NOTE,
  DECLARED_CODE_NOT_LASTING_NOTE,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AutoRemediation/DeclaredCodeChangeWords";
import AutoRemediationSuggestion from "../../../Models/DatabaseModels/AutoRemediationSuggestion";
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
import ObjectID from "../../../Types/ObjectID";
import AiResourceType from "../../../Types/ResourceAiAgent/AiResourceType";
import RunbookStepType from "../../../Types/Runbook/RunbookStepType";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import {
  RemediationCommandLines,
  findRemediationCommandLines,
  openRemediationFixes,
} from "./RemediationFixHarness";
import { goTo, PROJECT_ID } from "./SideMenuHarness";

/*
 * A FIX THAT LASTS, ON THE AI CARD (RemediationStep): where a declared
 * resource's step says so, and where its pull request is offered.
 *
 *  - a change the code declares (a scale) waits for approval: the plan's
 *    step says, in amber, that the next apply may put the old value back,
 *    and Open a pull request to the code sits right under it - with no
 *    second hint beside it, the note above says why;
 *  - once the fix ran, the pull request is under the step as it ran, and
 *    only there: with the plan step open too, it was said twice;
 *  - a restart of a declared resource sets nothing the code declares: its
 *    note says the next apply does not undo it, quietly, and nothing is
 *    offered or read;
 *  - a resource no code declares has no note at all;
 *  - the undo under the step breaks inside a long address, as the command
 *    above it does: on a phone in Persian its account id ran off the
 *    column's edge.
 */

const INCIDENT_ID: ObjectID = new ObjectID(
  "0193c0de-3333-4aaa-8bbb-000000000013",
);
const SUGGESTION_ID: string = "0193c0de-6666-4aaa-8bbb-000000000016";
const ACCOUNT_ID: string = "0193c0de-7777-4aaa-8bbb-000000000017";
const AGENT_ID: string = "0193c0de-8888-4aaa-8bbb-000000000018";
const ECS: string = "arn:aws:ecs:us-east-1:123456789012:service/prod/web";
const SCALE: string = `cloud scale-out ${ECS} --count 4`;
const RESTART: string = `cloud restart-service ${ECS}`;
const CHANGES_ROUTE: string = "/auto-remediation/declared-code-changes";
const OWNER_ROUTE: string = "/auto-remediation/declared-code-owner";

// The owner route's answer: one repository the reader may ask in.
const OWNER: JSONObject = {
  sequence: 1,
  managedAsCode: "Terraform",
  codeKind: "terraform",
  sentence: "Scale the ECS service web out to 4 tasks",
  target: { resourceType: "aws_ecs_service", attribute: "desired_count" },
  candidates: [
    {
      repositoryId: "0193c0de-2222-4aaa-8bbb-000000000102",
      name: "platform",
      fullName: "acme/platform",
      reason: "has-code-of-kind",
      matchedPaths: [],
      isBest: true,
      canAsk: true,
    },
  ],
};

function cloudCommand(overrides: JSONObject = {}): JSONObject {
  return {
    sequence: 1,
    stepType: RunbookStepType.ResourceCommand,
    runnerId: AGENT_ID,
    runnerNameSnapshot: "Cloud AI agent",
    resourceType: AiResourceType.AwsAccount,
    resourceId: ACCOUNT_ID,
    resourceNameSnapshot: "prod",
    resourceCommandTier: "SafeWrite",
    managedAsCode: "Terraform",
    command: SCALE,
    timeoutInMs: 60000,
    rationale: "Tasks are saturated.",
    expectedEffect: "Latency drops.",
    policyVerdict: AiRemediationCommandPolicyVerdict.RequiresApproval,
    ...overrides,
  };
}

function fix(
  commands: Array<JSONObject>,
  status: AutoRemediationSuggestionStatus = AutoRemediationSuggestionStatus.Suggested,
): AutoRemediationSuggestion {
  return Object.assign(new AutoRemediationSuggestion(), {
    _id: SUGGESTION_ID,
    status,
    suggestionType: AutoRemediationSuggestionType.CommandPlan,
    ruleNameSnapshot: 'AI remediation for AWS account "prod"',
    resourceType: AiResourceType.AwsAccount,
    resourceId: new ObjectID(ACCOUNT_ID),
    commandPlan: {
      commands,
      ...(status === AutoRemediationSuggestionStatus.Approved
        ? { executionStatus: AiRemediationPlanExecutionStatus.Completed }
        : {}),
    } as JSONObject,
    createdAt: new Date("2026-10-30T10:00:00Z"),
  });
}

// What ran, as the agent reported it.
const RAN: JSONObject = {
  execution: {
    status: AiRemediationCommandExecutionStatus.Succeeded,
    exitCode: 0,
    output: "desiredCount 2 -> 4",
  },
};

// jest-mock's spy, as jest.spyOn of @jest/globals makes it (compile-common's layout).
let postSpy: SpyInstance<typeof API.post>;

function readsOfChanges(): number {
  return postSpy.mock.calls.filter((call: Array<unknown>): boolean => {
    return String((call[0] as JSONObject)["url"]).endsWith(CHANGES_ROUTE);
  }).length;
}

async function renderCard(row: AutoRemediationSuggestion): Promise<void> {
  jest.spyOn(ModelAPI, "getList").mockImplementation((async (data: {
    modelType: unknown;
  }): Promise<ListResult<AutoRemediationSuggestion>> => {
    // The step reads its decisions beside its fixes: none here.
    if (data.modelType !== AutoRemediationSuggestion) {
      return { data: [], count: 0, skip: 0, limit: 5 };
    }

    return { data: [row], count: 1, skip: 0, limit: 10 };
  }) as never);

  render(
    <RemediationStep investigationStage="reported" incidentId={INCIDENT_ID} />,
  );
  // Every step of the fix opened, as a reader does.
  await openRemediationFixes();
}

beforeEach(() => {
  goTo(`/dashboard/${PROJECT_ID}/incidents/${INCIDENT_ID.toString()}`);
  jest.spyOn(ModelAPI, "getCommonHeaders").mockReturnValue({});
  postSpy = jest.spyOn(API, "post").mockImplementation((async (
    request: unknown,
  ): Promise<HTTPResponse<JSONObject>> => {
    if (String((request as JSONObject)["url"]).endsWith(OWNER_ROUTE)) {
      return new HTTPResponse<JSONObject>(200, OWNER, {});
    }

    return new HTTPResponse<JSONObject>(200, { changes: [] }, {});
  }) as never) as unknown as SpyInstance<typeof API.post>;
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("a declared resource's step, on the AI card", () => {
  test("a scale that waits for approval: the amber note, and the pull request right under it with no second hint", async () => {
    await renderCard(fix([cloudCommand()]));

    const plan: HTMLElement = (await findRemediationCommandLines(SCALE)).plan;
    const note: HTMLElement = within(plan).getByTestId(
      "remediation-command-declared",
    );

    expect(note).toHaveAttribute("data-lasting", "true");
    expect(note).toHaveTextContent(
      DECLARED_CODE_LASTING_NOTE.replace("{{owner}}", "Terraform"),
    );
    expect(note).toHaveClass("text-amber-700");

    const line: HTMLElement = await within(plan).findByTestId(
      "declared-code-change",
    );

    expect(line).toHaveAttribute("data-state", "offered");
    expect(
      within(line).getByTestId("declared-code-change-ask"),
    ).toHaveTextContent("Open a pull request to the code");
    // The note above says why: no hint beside the button.
    expect(
      within(line).queryByTestId("declared-code-change-why"),
    ).not.toBeInTheDocument();
    // The note comes first, then the button.
    expect(
      note.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getAllByTestId("declared-code-change")).toHaveLength(1);
  });

  test("the undo under the step breaks inside a long address, as the command above it does", async () => {
    const undo: string = `cloud scale-in ${ECS} --count 2`;

    await renderCard(fix([cloudCommand({ rollbackCommand: undo })]));

    const plan: HTMLElement = (await findRemediationCommandLines(SCALE)).plan;
    const line: HTMLElement = within(plan).getByTestId(
      "remediation-command-undo",
    );

    expect(line).toHaveTextContent(undo);
    // Its code: a phone in Persian ran the account id off the column's edge.
    expect(within(line).getByText(undo)).toHaveClass(
      "[overflow-wrap:anywhere]",
    );
  });

  test("once it ran: the pull request is under the step as it ran, and only there", async () => {
    await renderCard(
      fix([cloudCommand({ ...RAN })], AutoRemediationSuggestionStatus.Approved),
    );

    const lines: RemediationCommandLines =
      await findRemediationCommandLines(SCALE);

    expect(lines.run).not.toBeNull();

    const line: HTMLElement = await within(lines.run!).findByTestId(
      "declared-code-change",
    );

    // Both steps are open, and the line is drawn once: in the run.
    expect(screen.getAllByTestId("declared-code-change")).toEqual([line]);
    expect(
      within(lines.plan).queryByTestId("declared-code-change"),
    ).not.toBeInTheDocument();
    // No note above it there: the hint says why.
    expect(
      within(line).getByTestId("declared-code-change-why"),
    ).toHaveTextContent(
      "The same change in the Terraform code, so the next apply keeps it.",
    );
    // One line, one read of where its pull request stands.
    expect(readsOfChanges()).toBe(1);
  });

  test("a restart of a declared resource: the next apply does not undo it, said quietly, and nothing is offered or read", async () => {
    await renderCard(fix([cloudCommand({ command: RESTART })]));

    const plan: HTMLElement = (await findRemediationCommandLines(RESTART)).plan;
    const note: HTMLElement = within(plan).getByTestId(
      "remediation-command-declared",
    );

    expect(note).toHaveAttribute("data-lasting", "false");
    expect(note).toHaveTextContent(
      DECLARED_CODE_NOT_LASTING_NOTE.replace("{{owner}}", "Terraform"),
    );
    expect(note).not.toHaveClass("text-amber-700");
    expect(note).toHaveClass("text-gray-500");
    expect(
      screen.queryByTestId("declared-code-change"),
    ).not.toBeInTheDocument();
    expect(readsOfChanges()).toBe(0);
  });

  test.each([
    [
      AutoRemediationSuggestionStatus.Suggested,
      DECLARED_CODE_DIALOG_WAITING_NOTE,
    ],
    [
      AutoRemediationSuggestionStatus.Dismissed,
      DECLARED_CODE_DIALOG_DISMISSED_NOTE,
    ],
  ])(
    "a fix %s: the dialog says what becomes of the live change",
    async (status: AutoRemediationSuggestionStatus, note: string) => {
      await renderCard(fix([cloudCommand()], status));

      const plan: HTMLElement = (await findRemediationCommandLines(SCALE)).plan;

      await act(async () => {
        fireEvent.click(
          await within(plan).findByTestId("declared-code-change-ask"),
        );
      });

      expect(
        await screen.findByTestId("declared-code-dialog-live-change"),
      ).toHaveTextContent(note);
    },
  );

  test("a resource no code declares: no note and no pull request", async () => {
    const command: JSONObject = cloudCommand();

    delete command["managedAsCode"];

    await renderCard(fix([command]));

    const plan: HTMLElement = (await findRemediationCommandLines(SCALE)).plan;

    expect(
      within(plan).queryByTestId("remediation-command-declared"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("declared-code-change"),
    ).not.toBeInTheDocument();
    expect(readsOfChanges()).toBe(0);
  });
});
