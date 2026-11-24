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
  configure,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";

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

/*
 * The reader's repositories, answered by Code's routes as the server
 * answers them - each read recorded, with what it was held to (#10921).
 */
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

import {
  ISSUE_FIX_REPOSITORY_PICKER_TEST_ID,
  IssueRepositoryModal,
  NO_ASKABLE_REPOSITORY,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DataSecurity/IssueModals";
import {
  CodeRepositoriesQuery,
  CodeRepositoriesScope,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Code/CodeApi";
import ObjectID from "../../../Types/ObjectID";
import {
  FakeCodeRepository,
  answerRepositoriesById,
  answerRepositoriesQuery,
  repositoriesSortingFirst,
} from "./CodeRepositoriesServer";

/*
 * FIX WITH AI'S REPOSITORY DIALOG, ON AN ISSUE'S PAGE (#10362, #10921).
 *
 * When the person may ask OneUptime AI to work in several repositories,
 * Fix with AI asks which one holds the code to change. The dialog listed
 * every one of them - complete, but one very long list in a project of
 * thousands. It searches the server now, as the other repository pickers
 * do (CodeRepositorySearchField), held to exactly what the fix accepts:
 * connected repositories the person may ask OneUptime AI to work in. A
 * telemetry issue is fixed in its service's code, so its dialog asks for
 * that repository, not infrastructure code.
 */

configure({ asyncUtilTimeout: 15000 });

const WAREHOUSE_ID: string = "10921000-0000-4000-8000-0000000000a1";
const WHARF_ID: string = "10921000-0000-4000-8000-0000000000a2";
const WATCHTOWER_ID: string = "10921000-0000-4000-8000-0000000000a3";

function repository(data: {
  id: string;
  name: string;
  isConnected?: boolean;
  canAsk?: boolean;
}): FakeCodeRepository {
  return {
    id: data.id,
    name: data.name,
    organizationName: "harbour",
    repositoryName: data.name,
    isConnected: data.isConnected !== false,
    provider: "GitHub",
    canAsk: data.canAsk,
    stats: { working: 0, waitingForYou: 0, openPullRequests: 0, taskCount: 0 },
  };
}

// More repositories than any list ever read, then three past them by name.
function manyRepositories(): Array<FakeCodeRepository> {
  return [
    ...repositoriesSortingFirst(10050),
    repository({ id: WAREHOUSE_ID, name: "warehouse-api" }),
    // Not connected: OneUptime cannot reach it, so AI cannot work in it.
    repository({ id: WHARF_ID, name: "wharf-legacy", isConnected: false }),
    // Connected, but the person may only read it.
    repository({
      id: WATCHTOWER_ID,
      name: "watchtower-billing",
      canAsk: false,
    }),
  ];
}

beforeEach(() => {
  world.repositories = manyRepositories();
  world.reads = [];
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

function renderDialog(data: {
  isTelemetry?: boolean;
  onSubmit?: (codeRepositoryId: ObjectID) => Promise<void>;
}): void {
  render(
    <MemoryRouter>
      <IssueRepositoryModal
        isTelemetry={Boolean(data.isTelemetry)}
        onClose={() => {}}
        onSubmit={
          data.onSubmit ||
          (async (): Promise<void> => {
            return undefined;
          })
        }
      />
    </MemoryRouter>,
  );
}

async function search(text: string): Promise<void> {
  const field: HTMLElement = screen.getByTestId(
    ISSUE_FIX_REPOSITORY_PICKER_TEST_ID,
  );

  await act(async () => {
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: text } });
  });
}

function lastRead(): CodeRepositoriesQuery | undefined {
  return world.reads[world.reads.length - 1];
}

function optionNames(): Array<string> {
  return screen.queryAllByRole("option").map((option: HTMLElement): string => {
    return option.textContent || "";
  });
}

describe("Fix with AI's repository dialog", () => {
  test("finds a repository past the project's first 10,000 by a search on the server", async () => {
    renderDialog({});

    await search("warehouse");

    const option: HTMLElement = await screen.findByRole("option", {
      name: /warehouse-api/,
    });

    // Its host's organization/name under it, as every repository picker shows it.
    expect(option).toHaveTextContent("harbour/warehouse-api");
    expect(lastRead()).toMatchObject({
      search: "warehouse",
      limit: 50,
      skip: 0,
    });
  });

  test("the search is held to the connected repositories the person may ask OneUptime AI to work in", async () => {
    renderDialog({});

    await search("w");

    await screen.findByRole("option", { name: /warehouse-api/ });

    expect(lastRead()).toMatchObject({
      group: "connected",
      askableOnly: true,
    });
    // A Data Security fix is not held to repositories whose code OneUptime reads.
    expect(lastRead()).not.toHaveProperty("codeReadableOnly");
    // "w" is in three names past the first 10,000: one is offered.
    expect(optionNames()).toHaveLength(1);
    expect(optionNames()[0]).toContain("warehouse-api");
  });

  test.each([
    ["one OneUptime cannot reach", "wharf"],
    ["one the person may only read", "watchtower"],
  ])(
    "%s is never offered, however it is searched for",
    async (_name: string, text: string) => {
      renderDialog({});

      await search(text);

      await waitFor(() => {
        expect(lastRead()).toMatchObject({ search: text });
      });
      expect(
        await screen.findByTestId("entity-dropdown-empty-list"),
      ).toHaveTextContent("No matching entries.");
      expect(screen.queryAllByRole("option")).toHaveLength(0);
    },
  );

  test("the repository picked - past the first 10,000 - is the one the fix is asked for in", async () => {
    const asked: Array<string> = [];

    renderDialog({
      onSubmit: async (codeRepositoryId: ObjectID): Promise<void> => {
        asked.push(codeRepositoryId.toString());
      },
    });

    await search("warehouse");

    const option: HTMLElement = await screen.findByRole("option", {
      name: /warehouse-api/,
    });

    await act(async () => {
      fireEvent.click(option);
    });

    expect(screen.getByTestId("entity-dropdown-value")).toHaveTextContent(
      "warehouse-api",
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Fix with AI" }));
    });

    await waitFor(() => {
      expect(asked).toEqual([WAREHOUSE_ID]);
    });
  });

  test("Fix with AI asks for a repository first: nothing is asked for without one", async () => {
    const asked: Array<string> = [];

    renderDialog({
      onSubmit: async (codeRepositoryId: ObjectID): Promise<void> => {
        asked.push(codeRepositoryId.toString());
      },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Fix with AI" }));
    });

    expect(asked).toEqual([]);
  });

  test("with no connected repository the person may ask in, the list says so", async () => {
    world.repositories = [
      repository({ id: WHARF_ID, name: "wharf-legacy", isConnected: false }),
      repository({
        id: WATCHTOWER_ID,
        name: "watchtower-billing",
        canAsk: false,
      }),
    ];

    renderDialog({});

    await act(async () => {
      fireEvent.focus(screen.getByTestId(ISSUE_FIX_REPOSITORY_PICKER_TEST_ID));
    });

    expect(
      await screen.findByTestId("entity-dropdown-empty-list"),
    ).toHaveTextContent(NO_ASKABLE_REPOSITORY);
    expect(NO_ASKABLE_REPOSITORY).toBe(
      "No connected repository you may ask OneUptime AI to work in.",
    );
  });

  test("opened, it lists the first page by name - never the whole list - and the field is named by its label", async () => {
    renderDialog({});

    await act(async () => {
      fireEvent.focus(screen.getByTestId(ISSUE_FIX_REPOSITORY_PICKER_TEST_ID));
    });

    await screen.findByRole("option", { name: /ap-000001/ });

    expect(screen.queryAllByRole("option")).toHaveLength(50);
    expect(lastRead()).toMatchObject({ limit: 50 });
    expect(
      screen.getByTestId(ISSUE_FIX_REPOSITORY_PICKER_TEST_ID),
    ).toHaveAccessibleName(/Repository/);
  });

  test("asks for the repository that holds the store's infrastructure code", () => {
    renderDialog({});

    expect(
      screen.getByText(
        "Pick the repository that holds this store's infrastructure code. OneUptime AI opens a pull request there.",
      ),
    ).toBeInTheDocument();
  });

  test("on a telemetry issue, asks for the repository that holds the service's code", () => {
    renderDialog({ isTelemetry: true });

    expect(
      screen.getByText(
        "Pick the repository that holds this service's code. OneUptime AI opens a pull request there.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/infrastructure code/)).not.toBeInTheDocument();
  });
});
