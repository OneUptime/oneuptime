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
import type { SpyInstance } from "jest-mock";
import * as React from "react";
import DeclaredCodeChangeDialog, {
  readDeclaredCodeOwner,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AutoRemediation/DeclaredCodeChangeDialog";
import {
  CodeRepositoriesQuery,
  CodeRepositoriesScope,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Code/CodeApi";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import {
  AiRemediationCommand,
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
  DeclaredCodeKind,
  DeclaredCodeOwnerJSON,
  DeclaredCodeOwnerReason,
} from "../../../Utils/AiRemediation/DeclaredCodeChange";
import {
  FakeCodeRepository,
  answerRepositoriesById,
  answerRepositoriesQuery,
  repositoriesSortingFirst,
} from "./CodeRepositoriesServer";
import { goTo, PROJECT_ID } from "./SideMenuHarness";

/*
 * ANY REPOSITORY CAN TAKE A DECLARED RESOURCE'S PULL REQUEST, HOWEVER MANY
 * THE PROJECT HAS (#11076).
 *
 * The dialog that asks before opening a pull request to the code that
 * declares a cloud resource listed every repository the project connected,
 * each a row with a radio - nothing pointing to most of them, each asked
 * about one at a time on the server. It lists the few something points to
 * now (a tag, a file named after the resource, code of its kind, being the
 * only one), and finds any other with a search on the server: Code's own,
 * held to the connected repositories the reader may ask OneUptime AI to
 * work in (CodeRepositorySearchField).
 *
 * The project here has 10,050 connected repositories named to sort first,
 * and three past them.
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

const world: {
  repositories: Array<FakeCodeRepository>;
  reads: Array<CodeRepositoriesQuery>;
} = { repositories: [], reads: [] };

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Code/CodeApi",
  () => {
    return {
      __esModule: true,
      default: {
        getRepositories: async (query: CodeRepositoriesQuery) => {
          world.reads.push(query);

          return answerRepositoriesQuery({
            repositories: world.repositories,
            query,
          });
        },
        getRepositoriesById: async (
          ids: Array<string>,
          scope?: CodeRepositoriesScope,
        ) => {
          return answerRepositoriesById({
            repositories: world.repositories,
            ids,
            scope,
          });
        },
      },
    };
  },
);

const SUGGESTION_ID: string = "11076000-1111-4aaa-8bbb-000000000101";
const PLATFORM_ID: string = "11076000-2222-4aaa-8bbb-000000000102";
const LOCKED_ID: string = "11076000-3333-4aaa-8bbb-000000000103";
// Past the project's first 10,050 by name.
const WAYPOINT_ID: string = "11076000-4444-4aaa-8bbb-000000000104";
const WHARF_ID: string = "11076000-5555-4aaa-8bbb-000000000105";
const WATCHTOWER_ID: string = "11076000-6666-4aaa-8bbb-000000000106";
const TASK_ID: string = "11076000-7777-4aaa-8bbb-000000000107";

const OWNER_ROUTE: string = "/auto-remediation/declared-code-owner";
const CHANGE_ROUTE: string = "/auto-remediation/declared-code-change";

function repository(data: {
  id: string;
  name: string;
  isConnected?: boolean;
  canAsk?: boolean;
}): FakeCodeRepository {
  return {
    id: data.id,
    name: data.name,
    organizationName: "acme",
    repositoryName: data.name,
    isConnected: data.isConnected !== false,
    provider: "GitHub",
    canAsk: data.canAsk,
    stats: { working: 0, waitingForYou: 0, openPullRequests: 0, taskCount: 0 },
  } as FakeCodeRepository;
}

const OWNER: DeclaredCodeOwnerJSON = {
  sequence: 1,
  managedAsCode: "Terraform",
  codeKind: DeclaredCodeKind.Terraform,
  sentence: "Scale the ECS service web out to 4 tasks",
  target: { resourceType: "aws_ecs_service", attribute: "desired_count" },
  candidates: [
    {
      repositoryId: PLATFORM_ID,
      name: "platform",
      fullName: "acme/platform",
      reason: DeclaredCodeOwnerReason.HasNamedFile,
      matchedPaths: ["envs/prod/web/main.tf"],
      isBest: true,
      canAsk: true,
    },
    {
      repositoryId: LOCKED_ID,
      name: "locked",
      fullName: "acme/locked",
      reason: DeclaredCodeOwnerReason.HasCodeOfKind,
      matchedPaths: [],
      isBest: false,
      canAsk: false,
    },
  ],
  hasRepository: true,
};

function command(): AiRemediationCommand {
  return {
    sequence: 1,
    stepType: RunbookStepType.ResourceCommand,
    runnerId: ObjectID.generate().toString(),
    runnerNameSnapshot: "Cloud AI agent",
    resourceType: AiResourceType.AwsAccount,
    resourceId: "11076000-8888-4aaa-8bbb-000000000108",
    resourceNameSnapshot: "prod",
    resourceCommandTier: ResourceCommandTier.SafeWrite,
    managedAsCode: "Terraform",
    command:
      "cloud scale-out arn:aws:ecs:us-east-1:123456789012:service/prod/web --count 4",
    timeoutInMs: 60000,
    rationale: "Too few tasks.",
    expectedEffect: "Latency falls.",
    policyVerdict: AiRemediationCommandPolicyVerdict.RequiresApproval,
  } as AiRemediationCommand;
}

let ownerAnswer: DeclaredCodeOwnerJSON | Record<string, unknown> = OWNER;
let postSpy: SpyInstance<typeof API.post>;
let asked: Array<string> = [];

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
  world.repositories = [
    ...repositoriesSortingFirst(10050),
    repository({ id: PLATFORM_ID, name: "platform" }),
    repository({ id: LOCKED_ID, name: "locked", canAsk: false }),
    repository({ id: WAYPOINT_ID, name: "waypoint-infra" }),
    // Not connected: no fix works in it.
    repository({ id: WHARF_ID, name: "wharf-infra", isConnected: false }),
    // Connected, but the reader may not ask AI in it.
    repository({ id: WATCHTOWER_ID, name: "watchtower-infra", canAsk: false }),
  ];
  world.reads = [];
  ownerAnswer = OWNER;
  asked = [];

  postSpy = jest.spyOn(API, "post").mockImplementation((async (
    request: unknown,
  ): Promise<unknown> => {
    const url: string = String((request as JSONObject)["url"]);

    if (url.endsWith(OWNER_ROUTE)) {
      return new HTTPResponse<JSONObject>(
        200,
        ownerAnswer as unknown as JSONObject,
        {},
      );
    }

    if (url.endsWith(CHANGE_ROUTE)) {
      return new HTTPResponse<JSONObject>(
        200,
        { taskId: TASK_ID, wasAlreadyAsked: false },
        {},
      );
    }

    return new HTTPErrorResponse(404, { message: "Not found" }, {});
  }) as never) as unknown as SpyInstance<typeof API.post>;
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function openDialog(): Promise<HTMLElement> {
  await act(async () => {
    render(
      <DeclaredCodeChangeDialog
        suggestionId={SUGGESTION_ID}
        command={command()}
        onClose={() => {}}
        onAsked={(taskId: string) => {
          asked.push(taskId);
        }}
      />,
    );
  });

  return await screen.findByTestId("declared-code-dialog");
}

async function search(text: string): Promise<void> {
  const field: HTMLElement = await screen.findByTestId(
    "declared-code-dialog-search",
  );

  await act(async () => {
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: text } });
  });
}

async function pick(name: RegExp): Promise<void> {
  const option: HTMLElement = await screen.findByRole("option", { name });

  await act(async () => {
    fireEvent.click(option);
  });
}

function hasOption(name: string): boolean {
  return screen.queryAllByRole("option").some((option: HTMLElement) => {
    return (option.textContent || "").includes(name);
  });
}

function openButton(): HTMLElement {
  return screen.getByRole("button", { name: "Open pull request" });
}

describe("the repositories the declared code's pull request can go to (#11076)", () => {
  test("the ones something points to are listed with why, the likeliest chosen - and any other is searched for", async () => {
    const dialog: HTMLElement = await openDialog();

    const rows: Array<HTMLElement> = await within(dialog).findAllByTestId(
      "declared-code-dialog-repository",
    );
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByRole("radio")).toBeChecked();
    expect(within(rows[1]!).getByRole("radio")).toBeDisabled();

    // Under them, the search for any other, named for what it is.
    const another: HTMLElement = within(dialog).getByTestId(
      "declared-code-dialog-another",
    );
    expect(another).toHaveTextContent("Another repository");
    expect(
      within(another).getByTestId("declared-code-dialog-search"),
    ).toHaveAccessibleName("Another repository");
    expect(openButton()).not.toBeDisabled();
  });

  test("the search is Code's, on the server, held to the connected repositories the reader may ask AI in", async () => {
    await openDialog();

    await search("infra");
    await screen.findByRole("option", { name: /waypoint-infra/ });

    expect(world.reads[world.reads.length - 1]).toMatchObject({
      search: "infra",
      group: "connected",
      askableOnly: true,
    });
    // Not connected, or not theirs to ask in: never offered.
    expect(hasOption("wharf-infra")).toBe(false);
    expect(hasOption("watchtower-infra")).toBe(false);
  });

  test("a repository past the project's first 10,000 is found, picked, and the pull request opened in it", async () => {
    const dialog: HTMLElement = await openDialog();

    await search("waypoint");
    await pick(/waypoint-infra/);

    // Picked from the search, no row above is the choice any more.
    for (const row of within(dialog).getAllByTestId(
      "declared-code-dialog-repository",
    )) {
      expect(within(row).getByRole("radio")).not.toBeChecked();
    }

    await act(async () => {
      fireEvent.click(openButton());
    });

    expect(postsTo(CHANGE_ROUTE)[0]!["data"]).toEqual({
      suggestionId: SUGGESTION_ID,
      sequence: 1,
      codeRepositoryId: WAYPOINT_ID,
    });
    expect(asked).toEqual([TASK_ID]);
  });

  test("a row chosen again after a search is the choice: the pull request goes there", async () => {
    const dialog: HTMLElement = await openDialog();

    await search("waypoint");
    await pick(/waypoint-infra/);

    const rows: Array<HTMLElement> = within(dialog).getAllByTestId(
      "declared-code-dialog-repository",
    );

    await act(async () => {
      fireEvent.click(within(rows[0]!).getByRole("radio"));
    });

    expect(within(rows[0]!).getByRole("radio")).toBeChecked();

    await act(async () => {
      fireEvent.click(openButton());
    });

    expect(postsTo(CHANGE_ROUTE)[0]!["data"]).toMatchObject({
      codeRepositoryId: PLATFORM_ID,
    });
  });

  test("nothing points to any repository: the search alone, named Repository, and nothing opens until one is picked", async () => {
    ownerAnswer = { ...OWNER, candidates: [], hasRepository: true };

    const dialog: HTMLElement = await openDialog();

    const field: HTMLElement = await within(dialog).findByTestId(
      "declared-code-dialog-search",
    );
    expect(field).toHaveAccessibleName("Repository");
    expect(
      within(dialog).queryByTestId("declared-code-dialog-repository"),
    ).toBeNull();
    expect(
      within(dialog).queryByTestId("declared-code-dialog-no-repository"),
    ).toBeNull();
    expect(openButton()).toBeDisabled();

    await search("waypoint");
    await pick(/waypoint-infra/);

    await waitFor(() => {
      expect(openButton()).not.toBeDisabled();
    });
  });

  test("no repository the reader may read is connected: the way to connect one, and no search", async () => {
    ownerAnswer = { ...OWNER, candidates: [], hasRepository: false };

    const dialog: HTMLElement = await openDialog();

    expect(
      await within(dialog).findByTestId("declared-code-dialog-no-repository"),
    ).toHaveTextContent(
      "No repository connected to Code can take this pull request yet.",
    );
    expect(
      within(dialog).queryByTestId("declared-code-dialog-search"),
    ).toBeNull();
    expect(openButton()).toBeDisabled();
  });

  test("the only offered repository is one the reader may not ask in: none is chosen, and the search finds another", async () => {
    ownerAnswer = {
      ...OWNER,
      candidates: [{ ...OWNER.candidates[1]!, isBest: true }],
    };

    const dialog: HTMLElement = await openDialog();

    const row: HTMLElement = await within(dialog).findByTestId(
      "declared-code-dialog-repository",
    );
    expect(within(row).getByRole("radio")).not.toBeChecked();
    expect(openButton()).toBeDisabled();

    await search("waypoint");
    await pick(/waypoint-infra/);

    await waitFor(() => {
      expect(openButton()).not.toBeDisabled();
    });
  });
});

describe("the owner's answer, read (#11076)", () => {
  test("whether there is a repository to search for, as the server says it", () => {
    expect(
      readDeclaredCodeOwner({ ...OWNER, candidates: [], hasRepository: true })
        ?.hasRepository,
    ).toBe(true);
    expect(
      readDeclaredCodeOwner({ ...OWNER, candidates: [], hasRepository: false })
        ?.hasRepository,
    ).toBe(false);
  });

  test("an older server's answer listed every repository: a list says there is one, none that there is none", () => {
    const older: Record<string, unknown> = { ...OWNER };
    delete older["hasRepository"];

    expect(readDeclaredCodeOwner(older)?.hasRepository).toBe(true);
    expect(
      readDeclaredCodeOwner({ ...older, candidates: [] })?.hasRepository,
    ).toBe(false);
  });
});
