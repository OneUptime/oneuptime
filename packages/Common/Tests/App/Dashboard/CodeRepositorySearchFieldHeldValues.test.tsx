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
import React, { ReactElement, useState } from "react";
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

// The reader's repositories, answered by Code's routes as the server answers them.
const world: {
  repositories: Array<FakeCodeRepository>;
  reads: Array<CodeRepositoriesQuery>;
  byIdReads: Array<{ ids: Array<string>; scope?: CodeRepositoriesScope }>;
} = { repositories: [], reads: [], byIdReads: [] };

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
          world.byIdReads.push({ ids, ...(scope ? { scope } : {}) });

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

import CodeRepositorySearchField, {
  getCodeRepositoryChoiceQuery,
  toCodeRepositoryOption,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Code/CodeRepositorySearchField";
import {
  CODE_REPOSITORY_CHOICE_ASKABLE_KEY,
  CODE_REPOSITORY_CHOICE_CODE_READABLE_KEY,
  CODE_REPOSITORY_CHOICE_GROUP_KEY,
  readChoiceScope,
  readCodeRepositoryChoices,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Code/CodeRepositoryChoicesAPI";
import {
  CodeRepositoriesQuery,
  CodeRepositoriesScope,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Code/CodeApi";
import CodeRepository from "../../../Models/DatabaseModels/CodeRepository";
import { CodeRepositoryListGroup } from "../../../Types/AI/CodeTask";
import Includes from "../../../Types/BaseDatabase/Includes";
import Search from "../../../Types/BaseDatabase/Search";
import { DropdownOption } from "../../../UI/Components/Dropdown/Dropdown";
import { ListResult } from "../../../UI/Utils/ModelAPI/ModelAPI";
import {
  FakeCodeRepository,
  answerRepositoriesById,
  answerRepositoriesQuery,
  repositoriesSortingFirst,
} from "./CodeRepositoriesServer";

/*
 * THE SEARCHED REPOSITORY FIELD EVERY FIX WITH AI PICKS WITH (#10921).
 *
 * CodeRepositorySearchField searches Code's repositories on the server as
 * the person types, held to what its fix accepts, and names what it holds
 * by its id - however far past a first page it is, never as a bare id, and
 * as "No longer available" once no repository answers to it. Here, a
 * project of more than 10,000 repositories (CodeRepositoriesServer).
 */

configure({ asyncUtilTimeout: 15000 });

const WAREHOUSE_ID: string = "10921000-0000-4000-8000-00000000f0a1";
const READ_ONLY_ID: string = "10921000-0000-4000-8000-00000000f0a2";
const GONE_ID: string = "10921000-0000-4000-8000-00000000f0dd";
const FIELD_TEST_ID: string = "repository-field";

function repository(data: {
  id: string;
  name: string;
  canAsk?: boolean;
  isCodeReadable?: boolean;
}): FakeCodeRepository {
  return {
    id: data.id,
    name: data.name,
    organizationName: "harbour",
    repositoryName: data.name,
    isConnected: true,
    provider: "GitHub",
    canAsk: data.canAsk,
    isCodeReadable: data.isCodeReadable,
    stats: { working: 0, waitingForYou: 0, openPullRequests: 0, taskCount: 0 },
  };
}

beforeEach(() => {
  world.repositories = [
    ...repositoriesSortingFirst(10050),
    repository({ id: WAREHOUSE_ID, name: "warehouse-api" }),
    repository({ id: READ_ONLY_ID, name: "watchtower-billing", canAsk: false }),
  ];
  world.reads = [];
  world.byIdReads = [];
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

// A form that keeps the pick, as a dialog does, and saves it.
function Form(props: {
  initial?: string | null;
  isAskableOnly?: boolean;
  onSave?: (repositoryId: string | null) => void;
}): ReactElement {
  const [value, setValue] = useState<string | null>(props.initial ?? null);

  return (
    <div>
      <CodeRepositorySearchField
        value={value}
        isAskableOnly={props.isAskableOnly}
        dataTestId={FIELD_TEST_ID}
        onChange={setValue}
      />
      <button
        type="button"
        onClick={() => {
          props.onSave?.(value);
        }}
      >
        Save
      </button>
    </div>
  );
}

async function draw(element: ReactElement): Promise<void> {
  await act(async () => {
    render(<MemoryRouter>{element}</MemoryRouter>);
  });
}

describe("what the field holds, past a project's first 10,000 repositories", () => {
  test("a repository held past them keeps its name: read by its id, never a bare id", async () => {
    await draw(<Form initial={WAREHOUSE_ID} />);

    await waitFor(() => {
      expect(screen.getByTestId("entity-dropdown-value")).toHaveTextContent(
        "warehouse-api",
      );
    });
    /*
     * Read by its id alone - never narrowed by what the search is held to,
     * so what a field holds is named whatever it is (EntityDropdown).
     */
    expect(world.byIdReads).toEqual([{ ids: [WAREHOUSE_ID], scope: {} }]);
    expect(screen.queryByText(WAREHOUSE_ID)).toBeNull();
  });

  test("a repository held that no repository answers to any more reads No longer available, and can be taken out", async () => {
    const saved: Array<string | null> = [];

    await draw(
      <Form
        initial={GONE_ID}
        onSave={(repositoryId: string | null) => {
          saved.push(repositoryId);
        }}
      />,
    );

    const value: HTMLElement = await screen.findByText("No longer available");

    expect(value).toHaveAttribute("data-not-found", "true");
    expect(screen.queryByText(GONE_ID)).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByTestId("entity-dropdown-clear"));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });

    expect(saved).toEqual([null]);
  });

  test("a repository picked past them survives a save, and is named by its id when the field is drawn again", async () => {
    const saved: Array<string | null> = [];

    await draw(
      <Form
        isAskableOnly={true}
        onSave={(repositoryId: string | null) => {
          saved.push(repositoryId);
        }}
      />,
    );

    const field: HTMLElement = screen.getByTestId(FIELD_TEST_ID);

    await act(async () => {
      fireEvent.focus(field);
      fireEvent.change(field, { target: { value: "warehouse" } });
    });

    const option: HTMLElement = await screen.findByRole("option", {
      name: /warehouse-api/,
    });

    await act(async () => {
      fireEvent.click(option);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });

    expect(saved).toEqual([WAREHOUSE_ID]);
    // Named by the search that offered it: read by no id.
    expect(world.byIdReads).toEqual([]);

    cleanup();

    await draw(<Form initial={saved[0]!} isAskableOnly={true} />);

    await waitFor(() => {
      expect(screen.getByTestId("entity-dropdown-value")).toHaveTextContent(
        "warehouse-api",
      );
    });
    expect(world.byIdReads).toEqual([{ ids: [WAREHOUSE_ID], scope: {} }]);
  });

  test("a repository held that the search would no longer offer is still named, never read as gone", async () => {
    await draw(<Form initial={READ_ONLY_ID} isAskableOnly={true} />);

    await waitFor(() => {
      expect(screen.getByTestId("entity-dropdown-value")).toHaveTextContent(
        "watchtower-billing",
      );
    });
    expect(screen.queryByText("No longer available")).toBeNull();
  });

  test("a search held to the repositories the person may ask in never offers one they may only read", async () => {
    await draw(<Form isAskableOnly={true} />);

    const field: HTMLElement = screen.getByTestId(FIELD_TEST_ID);

    await act(async () => {
      fireEvent.focus(field);
      fireEvent.change(field, { target: { value: "wa" } });
    });

    await screen.findByRole("option", { name: /warehouse-api/ });

    expect(screen.queryByRole("option", { name: /watchtower-billing/ })).toBe(
      null,
    );
    expect(world.reads[world.reads.length - 1]).toMatchObject({
      search: "wa",
      askableOnly: true,
    });
  });

  test("held to nothing, it offers every repository the person may read", async () => {
    await draw(<Form />);

    const field: HTMLElement = screen.getByTestId(FIELD_TEST_ID);

    await act(async () => {
      fireEvent.focus(field);
      fireEvent.change(field, { target: { value: "watchtower" } });
    });

    expect(
      await screen.findByRole("option", { name: /watchtower-billing/ }),
    ).toBeInTheDocument();
    expect(world.reads[world.reads.length - 1]).not.toHaveProperty(
      "askableOnly",
    );
  });

  test("repositories a page offers first come before the search's, and typing narrows them too", async () => {
    await draw(
      <CodeRepositorySearchField
        value={null}
        options={[
          toCodeRepositoryOption({
            id: WAREHOUSE_ID,
            name: "warehouse-api",
            organizationName: "harbour",
            repositoryName: "warehouse-api",
          }),
        ]}
        dataTestId={FIELD_TEST_ID}
        onChange={() => {}}
      />,
    );

    const field: HTMLElement = screen.getByTestId(FIELD_TEST_ID);

    await act(async () => {
      fireEvent.focus(field);
    });

    await waitFor(() => {
      expect(screen.getAllByRole("option").length).toBeGreaterThan(1);
    });
    expect(screen.getAllByRole("option")[0]).toHaveTextContent("warehouse-api");
    expect(screen.getAllByRole("option")[1]).toHaveTextContent("ap-000001");

    await act(async () => {
      fireEvent.change(field, { target: { value: "ap-0000" } });
    });

    await waitFor(() => {
      expect(
        screen.queryByRole("option", { name: /warehouse-api/ }),
      ).toBeNull();
    });
  });
});

describe("what the field's search is held to, as its query says it", () => {
  test("one key for each, only when it is set", () => {
    expect(getCodeRepositoryChoiceQuery({})).toEqual({});
    expect(
      getCodeRepositoryChoiceQuery({
        group: CodeRepositoryListGroup.Connected,
        isAskableOnly: true,
        isCodeReadableOnly: true,
      }),
    ).toEqual({
      [CODE_REPOSITORY_CHOICE_GROUP_KEY]: CodeRepositoryListGroup.Connected,
      [CODE_REPOSITORY_CHOICE_ASKABLE_KEY]: true,
      [CODE_REPOSITORY_CHOICE_CODE_READABLE_KEY]: true,
    });
    expect(
      getCodeRepositoryChoiceQuery({
        isAskableOnly: false,
        isCodeReadableOnly: false,
      }),
    ).toEqual({});
  });

  test("read back only when a key says true", () => {
    expect(
      readChoiceScope({
        [CODE_REPOSITORY_CHOICE_ASKABLE_KEY]: true,
        [CODE_REPOSITORY_CHOICE_CODE_READABLE_KEY]: true,
      }),
    ).toEqual({ askableOnly: true, codeReadableOnly: true });
    expect(
      readChoiceScope({
        [CODE_REPOSITORY_CHOICE_ASKABLE_KEY]: "true",
        [CODE_REPOSITORY_CHOICE_CODE_READABLE_KEY]: 1,
      }),
    ).toEqual({});
    expect(readChoiceScope({})).toEqual({});
  });

  test("a search and a read by id carry what the picker is held to to Code's routes", async () => {
    const found: ListResult<CodeRepository> =
      await readCodeRepositoryChoices<CodeRepository>({
        modelType: CodeRepository,
        query: {
          name: new Search("warehouse"),
          [CODE_REPOSITORY_CHOICE_GROUP_KEY]: CodeRepositoryListGroup.Connected,
          [CODE_REPOSITORY_CHOICE_ASKABLE_KEY]: true,
          [CODE_REPOSITORY_CHOICE_CODE_READABLE_KEY]: true,
        } as never,
        select: {},
        sort: {},
        skip: 0,
        limit: 50,
      });

    expect(world.reads[0]).toEqual({
      search: "warehouse",
      group: CodeRepositoryListGroup.Connected,
      order: "name",
      skip: 0,
      limit: 50,
      askableOnly: true,
      codeReadableOnly: true,
    });
    expect(
      found.data.map((row: CodeRepository): string => {
        return row.name || "";
      }),
    ).toEqual(["warehouse-api"]);

    await readCodeRepositoryChoices<CodeRepository>({
      modelType: CodeRepository,
      query: {
        _id: new Includes([WAREHOUSE_ID, READ_ONLY_ID]),
        [CODE_REPOSITORY_CHOICE_ASKABLE_KEY]: true,
      } as never,
      select: {},
      sort: {},
      skip: 0,
      limit: 2,
    });

    expect(world.byIdReads).toEqual([
      { ids: [WAREHOUSE_ID, READ_ONLY_ID], scope: { askableOnly: true } },
    ]);
  });
});

describe("a repository a page knows, as the field lists it", () => {
  test("its name, with its host's organization/name under it when that says more", () => {
    const option: DropdownOption = toCodeRepositoryOption({
      id: WAREHOUSE_ID,
      name: "warehouse-api",
      organizationName: "harbour",
      repositoryName: "warehouse-api",
    });

    expect(option).toMatchObject({
      value: WAREHOUSE_ID,
      label: "warehouse-api",
      description: "harbour/warehouse-api",
      isUserContent: true,
    });
    expect(
      toCodeRepositoryOption({ id: WAREHOUSE_ID, name: "warehouse-api" }),
    ).not.toHaveProperty("description");
    // A repository with no name of its own is still named.
    expect(toCodeRepositoryOption({ id: WAREHOUSE_ID, name: "" }).label).toBe(
      WAREHOUSE_ID,
    );
  });
});
