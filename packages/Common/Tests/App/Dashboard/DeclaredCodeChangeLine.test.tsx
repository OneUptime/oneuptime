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
import DeclaredCodeChangeLine from "../../../../App/FeatureSet/Dashboard/src/Components/AutoRemediation/DeclaredCodeChangeLine";
import {
  DECLARED_CODE_DIALOG_RAN_NOTE,
  DECLARED_CODE_DIALOG_WAITING_NOTE,
  canAskForDeclaredCodeChange,
  findDeclaredCodeChange,
  getStartingRepositoryId,
  readDeclaredCodeChanges,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AutoRemediation/DeclaredCodeChangeWords";
import { readDeclaredCodeOwner } from "../../../../App/FeatureSet/Dashboard/src/Components/AutoRemediation/DeclaredCodeChangeDialog";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import {
  AiRemediationCommand,
  AiRemediationCommandExecutionStatus,
  AiRemediationCommandPolicyVerdict,
} from "../../../Types/AutoRemediation/AiRemediationCommandPlan";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import AiResourceType from "../../../Types/ResourceAiAgent/AiResourceType";
import { ResourceCommandTier } from "../../../Types/ResourceAiAgent/ResourceAiAccess";
import RunbookStepType from "../../../Types/Runbook/RunbookStepType";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import {
  DeclaredCodeChangeState,
  DeclaredCodeKind,
  DeclaredCodeOwnerJSON,
  DeclaredCodeOwnerReason,
} from "../../../Utils/AiRemediation/DeclaredCodeChange";
import { goTo, PROJECT_ID } from "./SideMenuHarness";

/*
 * A FIX THAT LASTS, ON THE FIX'S CARD (DeclaredCodeChangeLine, and the
 * dialog it opens): under a step that changes a value of a cloud resource
 * declared as code,
 *
 *   - "Open a pull request to the code", with which code;
 *   - a dialog that asks first: the change, where the code keeps the value,
 *     the repositories with why each is offered - the likeliest chosen, one
 *     the reader may not ask in never - and what becomes of the live change;
 *   - Open pull request asks for it in the chosen repository, and the line
 *     then says where it stands: being written, open (its link), ended
 *     without one, failed (Ask again).
 *
 * Nothing is drawn under a step whose change the code does not declare.
 */

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (value: string): string => {
          return value;
        },
      };
    },
  };
});

const SUGGESTION_ID: string = "0193c0de-1111-4aaa-8bbb-000000000101";
const REPOSITORY_ID: string = "0193c0de-2222-4aaa-8bbb-000000000102";
const OTHER_REPOSITORY_ID: string = "0193c0de-3333-4aaa-8bbb-000000000103";
const TASK_ID: string = "0193c0de-4444-4aaa-8bbb-000000000104";
const ECS: string = "arn:aws:ecs:us-east-1:123456789012:service/prod/web";

const OWNER_ROUTE: string = "/auto-remediation/declared-code-owner";
const CHANGE_ROUTE: string = "/auto-remediation/declared-code-change";
const CHANGES_ROUTE: string = "/auto-remediation/declared-code-changes";

function command(
  overrides: Partial<AiRemediationCommand> = {},
): AiRemediationCommand {
  return {
    sequence: 1,
    stepType: RunbookStepType.ResourceCommand,
    runnerId: ObjectID.generate().toString(),
    runnerNameSnapshot: "Cloud AI agent",
    resourceType: AiResourceType.AwsAccount,
    resourceId: "0193c0de-5555-4aaa-8bbb-000000000105",
    resourceNameSnapshot: "prod",
    resourceCommandTier: ResourceCommandTier.SafeWrite,
    managedAsCode: "Terraform",
    command: `cloud scale-out ${ECS} --count 4`,
    timeoutInMs: 60000,
    rationale: "Too few tasks.",
    expectedEffect: "Latency falls.",
    policyVerdict: AiRemediationCommandPolicyVerdict.RequiresApproval,
    ...overrides,
  } as AiRemediationCommand;
}

const OWNER: DeclaredCodeOwnerJSON = {
  sequence: 1,
  managedAsCode: "Terraform",
  codeKind: DeclaredCodeKind.Terraform,
  sentence: "Scale the ECS service web out to 4 tasks",
  target: { resourceType: "aws_ecs_service", attribute: "desired_count" },
  candidates: [
    {
      repositoryId: REPOSITORY_ID,
      name: "platform",
      fullName: "acme/platform",
      reason: DeclaredCodeOwnerReason.HasNamedFile,
      matchedPaths: ["envs/prod/web/main.tf"],
      isBest: true,
      canAsk: true,
    },
    {
      repositoryId: OTHER_REPOSITORY_ID,
      name: "locked",
      fullName: "acme/locked",
      reason: DeclaredCodeOwnerReason.HasCodeOfKind,
      matchedPaths: [],
      isBest: false,
      canAsk: false,
    },
  ],
};

let changesAnswer: JSONObject;
let ownerAnswer: () => Promise<HTTPResponse<JSONObject> | HTTPErrorResponse>;
let postSpy: jest.SpiedFunction<typeof API.post>;

function postsTo(route: string): Array<JSONObject> {
  return postSpy.mock.calls
    .map((call: Array<unknown>): JSONObject => {
      return (call[0] || {}) as JSONObject;
    })
    .filter((request: JSONObject): boolean => {
      return String(request["url"]).endsWith(route);
    });
}

beforeEach(() => {
  goTo(`/dashboard/${PROJECT_ID}/incidents`);
  jest.spyOn(ModelAPI, "getCommonHeaders").mockReturnValue({});
  changesAnswer = { changes: [] };
  ownerAnswer = async () => {
    return new HTTPResponse<JSONObject>(
      200,
      OWNER as unknown as JSONObject,
      {},
    );
  };
  postSpy = jest.spyOn(API, "post").mockImplementation((async (
    request: unknown,
  ): Promise<unknown> => {
    const url: string = String((request as JSONObject)["url"]);

    if (url.endsWith(OWNER_ROUTE)) {
      return await ownerAnswer();
    }

    if (url.endsWith(CHANGE_ROUTE)) {
      changesAnswer = {
        changes: [
          {
            sequence: 1,
            taskId: TASK_ID,
            repositoryName: "acme/platform",
            state: DeclaredCodeChangeState.Writing,
          },
        ],
      };
      return new HTTPResponse<JSONObject>(
        200,
        { taskId: TASK_ID, wasAlreadyAsked: false },
        {},
      );
    }

    if (url.endsWith(CHANGES_ROUTE)) {
      return new HTTPResponse<JSONObject>(200, changesAnswer, {});
    }

    return new HTTPResponse<JSONObject>(200, {}, {});
  }) as never);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function renderLine(
  step: AiRemediationCommand = command(),
): Promise<ReturnType<typeof render>> {
  let view: ReturnType<typeof render> | null = null;

  await act(async () => {
    view = render(
      <DeclaredCodeChangeLine suggestionId={SUGGESTION_ID} command={step} />,
    );
  });

  return view!;
}

async function openDialog(): Promise<HTMLElement> {
  await act(async () => {
    fireEvent.click(screen.getByTestId("declared-code-change-ask"));
  });

  return await screen.findByTestId("declared-code-dialog");
}

describe("the line under a step", () => {
  test("offers the pull request, naming the code", async () => {
    await renderLine();

    const line: HTMLElement = screen.getByTestId("declared-code-change");

    expect(line).toHaveAttribute("data-state", "offered");
    expect(line).toHaveTextContent("Open a pull request to the code");
    expect(line).toHaveTextContent(
      "The same change in the Terraform code, so the next apply keeps it.",
    );
    expect(postsTo(CHANGES_ROUTE)[0]!["data"]).toEqual({
      suggestionId: SUGGESTION_ID,
    });
  });

  test.each([
    [
      "a restart, which the code does not declare",
      command({ command: `cloud restart-service ${ECS}` }),
    ],
    ["a resource no code declares", command({ managedAsCode: undefined })],
    ["code no pull request goes to", command({ managedAsCode: "Ansible" })],
  ])(
    "draws nothing under %s, and reads nothing",
    async (_name: string, step: AiRemediationCommand) => {
      const view: ReturnType<typeof render> = await renderLine(step);

      expect(view.container).toBeEmptyDOMElement();
      expect(postsTo(CHANGES_ROUTE)).toHaveLength(0);
    },
  );

  test.each([
    [
      DeclaredCodeChangeState.Writing,
      "A pull request to the code is being written in acme/platform.",
    ],
    [
      DeclaredCodeChangeState.Ended,
      "AI opened no pull request in acme/platform: it found nothing to change, or it waits for your answer.",
    ],
    [
      DeclaredCodeChangeState.Failed,
      "The pull request to the code could not be written in acme/platform.",
    ],
  ])(
    "%s: says so, with the task's link",
    async (state: DeclaredCodeChangeState, sentence: string) => {
      changesAnswer = {
        changes: [
          {
            sequence: 1,
            taskId: TASK_ID,
            repositoryName: "acme/platform",
            state,
          },
        ],
      };

      await renderLine();

      const line: HTMLElement = screen.getByTestId("declared-code-change");

      expect(line).toHaveAttribute("data-state", state);
      expect(line).toHaveTextContent(sentence);
      expect(
        within(line).getByTestId("declared-code-change-task"),
      ).toHaveAttribute(
        "href",
        `/dashboard/${PROJECT_ID}/code/tasks/${TASK_ID}`,
      );
      expect(
        within(line).queryByTestId("declared-code-change-ask-again") !== null,
      ).toBe(state === DeclaredCodeChangeState.Failed);
    },
  );

  test("open: the pull request's link, which opens elsewhere", async () => {
    changesAnswer = {
      changes: [
        {
          sequence: 1,
          taskId: TASK_ID,
          repositoryName: "acme/platform",
          state: DeclaredCodeChangeState.Opened,
          pullRequestUrl: "https://github.com/acme/platform/pull/7",
          pullRequestNumber: 7,
        },
      ],
    };

    await renderLine();

    const link: HTMLElement = screen.getByTestId(
      "declared-code-change-pull-request",
    );

    expect(screen.getByTestId("declared-code-change")).toHaveTextContent(
      "A pull request to the code is open in acme/platform: merge it, and the next apply keeps the fix.",
    );
    expect(link).toHaveAttribute(
      "href",
      "https://github.com/acme/platform/pull/7",
    );
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link).toHaveTextContent("View pull request #7");
  });

  test("another step's pull request is not this one's", async () => {
    changesAnswer = {
      changes: [
        {
          sequence: 2,
          taskId: TASK_ID,
          repositoryName: "acme/platform",
          state: DeclaredCodeChangeState.Writing,
        },
      ],
    };

    await renderLine();

    expect(screen.getByTestId("declared-code-change")).toHaveAttribute(
      "data-state",
      "offered",
    );
  });
});

describe("the dialog that asks before opening it", () => {
  test("the change, where the code keeps it, the repositories with why, and the live change", async () => {
    await renderLine();
    const dialog: HTMLElement = await openDialog();

    expect(
      await within(dialog).findByTestId("declared-code-dialog-change"),
    ).toHaveTextContent("Scale the ECS service web out to 4 tasks");
    expect(
      within(dialog).getByTestId("declared-code-dialog-target"),
    ).toHaveTextContent(
      "Most likely the desired_count of the aws_ecs_service that declares it.",
    );

    const rows: Array<HTMLElement> = within(dialog).getAllByTestId(
      "declared-code-dialog-repository",
    );

    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("acme/platform");
    expect(rows[0]).toHaveTextContent(
      "Its Terraform code has a file named after the resource: envs/prod/web/main.tf",
    );
    // The likeliest one the reader may ask in is chosen.
    expect(within(rows[0]!).getByRole("radio")).toBeChecked();
    // One they may not ask in cannot be chosen, and says why.
    expect(within(rows[1]!).getByRole("radio")).toBeDisabled();
    expect(rows[1]).toHaveTextContent("You may not ask AI to work in it.");
    expect(
      within(dialog).getByTestId("declared-code-dialog-live-change"),
    ).toHaveTextContent(DECLARED_CODE_DIALOG_WAITING_NOTE);
    expect(postsTo(OWNER_ROUTE)[0]!["data"]).toEqual({
      suggestionId: SUGGESTION_ID,
      sequence: 1,
    });
  });

  test("a change that already ran: the pull request keeps it", async () => {
    await renderLine(
      command({
        execution: { status: AiRemediationCommandExecutionStatus.Succeeded },
      }),
    );
    const dialog: HTMLElement = await openDialog();

    expect(
      await within(dialog).findByTestId("declared-code-dialog-live-change"),
    ).toHaveTextContent(DECLARED_CODE_DIALOG_RAN_NOTE);
  });

  test("Open pull request asks in the chosen repository, and the line says it is being written", async () => {
    await renderLine();
    const dialog: HTMLElement = await openDialog();

    await within(dialog).findAllByTestId("declared-code-dialog-repository");

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Open pull request" }),
      );
    });

    expect(postsTo(CHANGE_ROUTE)[0]!["data"]).toEqual({
      suggestionId: SUGGESTION_ID,
      sequence: 1,
      codeRepositoryId: REPOSITORY_ID,
    });
    expect(screen.queryByTestId("declared-code-dialog")).toBeNull();
    expect(
      await screen.findByText(
        "A pull request to the code is being written in acme/platform.",
      ),
    ).toBeInTheDocument();
  });

  test("no repository can take it: says so, links to Code's repositories, and opens nothing", async () => {
    ownerAnswer = async () => {
      return new HTTPResponse<JSONObject>(
        200,
        { ...OWNER, candidates: [] } as unknown as JSONObject,
        {},
      );
    };

    await renderLine();
    const dialog: HTMLElement = await openDialog();

    expect(
      await within(dialog).findByTestId("declared-code-dialog-no-repository"),
    ).toHaveTextContent(
      "No repository connected to Code can take this pull request yet.",
    );
    expect(
      screen.getByRole("button", { name: "Open pull request" }),
    ).toBeDisabled();
  });

  test("a refusal reading the repositories is said", async () => {
    ownerAnswer = async () => {
      return new HTTPErrorResponse(
        400,
        { message: "This fix has no such step." },
        {},
      );
    };

    await renderLine();
    const dialog: HTMLElement = await openDialog();

    expect(
      await within(dialog).findByTestId("declared-code-dialog-load-error"),
    ).toHaveTextContent("This fix has no such step.");
  });
});

describe("the words behind it", () => {
  test("which steps offer a pull request", () => {
    expect(canAskForDeclaredCodeChange(command())).toBe(true);
    expect(
      canAskForDeclaredCodeChange(
        command({ command: `cloud restart-service ${ECS}` }),
      ),
    ).toBe(false);
    expect(
      canAskForDeclaredCodeChange(
        command({ resourceType: AiResourceType.DockerHost }),
      ),
    ).toBe(false);
    expect(
      canAskForDeclaredCodeChange(command({ managedAsCode: undefined })),
    ).toBe(false);
  });

  test("the list's answer, read: a row of the wrong shape is left out, an address that is not a web one too", () => {
    expect(
      readDeclaredCodeChanges({
        changes: [
          {
            sequence: 1,
            taskId: TASK_ID,
            repositoryName: "acme/platform",
            state: "opened",
            pullRequestUrl: "javascript:alert(1)",
          },
          { sequence: 2, taskId: TASK_ID, state: "dancing" },
          "row",
        ],
      }),
    ).toEqual([
      {
        sequence: 1,
        taskId: TASK_ID,
        repositoryName: "acme/platform",
        state: DeclaredCodeChangeState.Opened,
      },
    ]);
    expect(readDeclaredCodeChanges(null)).toEqual([]);
    expect(findDeclaredCodeChange([], 1)).toBeNull();
  });

  test("the owner's answer, read", () => {
    expect(readDeclaredCodeOwner(OWNER)).toEqual(OWNER);
    expect(readDeclaredCodeOwner({ candidates: "none" })).toBeNull();
    expect(
      readDeclaredCodeOwner({
        ...OWNER,
        candidates: [{ repositoryId: "x", reason: "because" }],
      })?.candidates,
    ).toEqual([]);
  });

  test("the dialog starts on the best repository the reader may ask in, or none", () => {
    expect(getStartingRepositoryId(OWNER.candidates)).toBe(REPOSITORY_ID);
    expect(
      getStartingRepositoryId([{ ...OWNER.candidates[0]!, canAsk: false }]),
    ).toBeNull();
    expect(
      getStartingRepositoryId([{ ...OWNER.candidates[0]!, isBest: false }]),
    ).toBeNull();
  });
});
