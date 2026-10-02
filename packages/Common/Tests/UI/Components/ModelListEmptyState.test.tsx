import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import API from "../../../UI/Utils/API/API";
import { ListResult } from "../../../UI/Utils/ModelAPI/ModelAPI";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * ModelList's empty state, and the opt-in hideEmptyState.
 *
 * An empty list shows noItemsMessage - drawn like every table's empty state
 * now, a smaller one: the model's icon, the message's first sentence as the
 * title (without its stop) and the rest as the description - and an EMPTY
 * noItemsMessage falls back to "No items found." - so a caller that explains
 * an empty list itself (the status page SSO sign-in says "single sign-on is
 * not available") cannot silence the list by passing "". hideEmptyState does
 * that: an empty list renders no message at all. It hides only the empty
 * state: a search that matches nothing and a failed load still say so.
 */

const getListMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
    },
  };
});

const OWNER_PERMISSIONS: Array<Permission> = [
  Permission.Public,
  Permission.User,
  Permission.CurrentUser,
  Permission.ProjectOwner,
];

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: () => {
        return OWNER_PERMISSIONS;
      },
      getProjectPermissions: () => {
        return {
          permissions: OWNER_PERMISSIONS.map((permission: Permission) => {
            return {
              permission,
              labelIds: [],
              _type: "UserPermission",
            } as UserPermission;
          }),
        };
      },
      getGlobalPermissions: () => {
        return { globalPermissions: OWNER_PERMISSIONS };
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: () => {
        return false;
      },
    },
  };
});

import ModelList from "../../../UI/Components/ModelList/ModelList";
import Probe from "../../../Models/DatabaseModels/Probe";

const WAIT_TIMEOUT: number = 20000;

// Titles: the sentences the list is given, drawn as headings.
const FALLBACK_MESSAGE: string = "No items found";
const NO_MATCH_MESSAGE: string = "No items match your search";
const NO_PROBES_SENTENCE: string = "No probes yet.";
const NO_PROBES: string = "No probes yet";

const listOf: (names: Array<string>) => ListResult<Probe> = (
  names: Array<string>,
): ListResult<Probe> => {
  const probes: Array<Probe> = names.map((name: string, index: number) => {
    const probe: Probe = new Probe();
    probe.id = new ObjectID(`11111111-1111-4111-8111-11111111111${index}`);
    probe.name = name;
    return probe;
  });

  return { data: probes, count: probes.length, skip: 0, limit: 10 };
};

interface ListProps {
  noItemsMessage: string;
  hideEmptyState?: boolean | undefined;
  isSearchEnabled?: boolean | undefined;
  onListLoaded?: ((list: Array<Probe>) => void) | undefined;
}

const ProbeList: React.FunctionComponent<ListProps> = (
  props: ListProps,
): React.ReactElement => {
  return (
    <ModelList<Probe>
      id="probe-list"
      modelType={Probe}
      titleField="name"
      select={{ name: true }}
      noItemsMessage={props.noItemsMessage}
      hideEmptyState={props.hideEmptyState}
      isSearchEnabled={props.isSearchEnabled}
      onListLoaded={props.onListLoaded}
    />
  );
};

/*
 * Resolves once the list has finished loading, whatever it loaded. The rows
 * and the search box appear a render later (ModelList copies the loaded list
 * into its searched list in an effect), so tests wait for those with findBy.
 */
const waitForLoad: (onListLoaded: MockFunction) => Promise<void> = async (
  onListLoaded: MockFunction,
): Promise<void> => {
  await screen.findByTestId("loaded", {}, { timeout: WAIT_TIMEOUT });
  expect(onListLoaded).toHaveBeenCalledTimes(1);
};

const renderList: (props: Omit<ListProps, "onListLoaded">) => MockFunction = (
  props: Omit<ListProps, "onListLoaded">,
): MockFunction => {
  const onListLoaded: MockFunction = getJestMockFunction();
  const Harness: React.FunctionComponent = (): React.ReactElement => {
    const [loaded, setLoaded] = React.useState<boolean>(false);

    return (
      <div>
        <ProbeList
          {...props}
          onListLoaded={(list: Array<Probe>) => {
            onListLoaded(list);
            setLoaded(true);
          }}
        />
        {loaded ? <span data-testid="loaded" /> : <></>}
      </div>
    );
  };

  render(<Harness />);
  return onListLoaded;
};

describe("ModelList empty state", () => {
  beforeEach(() => {
    getListMock.mockReset();
    getListMock.mockImplementation(() => {
      return Promise.resolve(listOf([]));
    });
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  it("an empty list shows noItemsMessage by default", async () => {
    await waitForLoad(renderList({ noItemsMessage: NO_PROBES_SENTENCE }));

    expect(screen.getByText(NO_PROBES)).toBeInTheDocument();
  });

  it("an empty noItemsMessage falls back to 'No items found.' (why hideEmptyState exists)", async () => {
    await waitForLoad(renderList({ noItemsMessage: "" }));

    expect(screen.getByText(FALLBACK_MESSAGE)).toBeInTheDocument();
  });

  it("hideEmptyState: an empty list shows no message at all", async () => {
    const onListLoaded: MockFunction = renderList({
      noItemsMessage: NO_PROBES_SENTENCE,
      hideEmptyState: true,
    });
    await waitForLoad(onListLoaded);

    expect(screen.queryByText(NO_PROBES)).not.toBeInTheDocument();
    expect(screen.queryByText(FALLBACK_MESSAGE)).not.toBeInTheDocument();
    // The caller still learns the list is empty, to explain it itself.
    expect(onListLoaded.mock.calls[0]?.[0]).toEqual([]);
  });

  it("hideEmptyState with an empty noItemsMessage shows no fallback either", async () => {
    await waitForLoad(renderList({ noItemsMessage: "", hideEmptyState: true }));

    expect(screen.queryByText(FALLBACK_MESSAGE)).not.toBeInTheDocument();
  });

  it("hideEmptyState=false behaves like the default", async () => {
    await waitForLoad(
      renderList({ noItemsMessage: NO_PROBES_SENTENCE, hideEmptyState: false }),
    );

    expect(screen.getByText(NO_PROBES)).toBeInTheDocument();
  });

  it("hideEmptyState still lists the items of a non-empty list", async () => {
    getListMock.mockImplementation(() => {
      return Promise.resolve(listOf(["WBHQ", "Frankfurt"]));
    });

    await waitForLoad(
      renderList({ noItemsMessage: NO_PROBES_SENTENCE, hideEmptyState: true }),
    );

    expect(
      await screen.findByText("WBHQ", {}, { timeout: WAIT_TIMEOUT }),
    ).toBeInTheDocument();
    expect(screen.getByText("Frankfurt")).toBeInTheDocument();
    expect(screen.queryByText(NO_PROBES)).not.toBeInTheDocument();
  });

  it("hideEmptyState does not hide a search that matches nothing", async () => {
    getListMock.mockImplementation(() => {
      return Promise.resolve(listOf(["wbhq"]));
    });

    await waitForLoad(
      renderList({
        noItemsMessage: NO_PROBES_SENTENCE,
        hideEmptyState: true,
        isSearchEnabled: true,
      }),
    );

    expect(
      await screen.findByText("wbhq", {}, { timeout: WAIT_TIMEOUT }),
    ).toBeInTheDocument();

    fireEvent.change(
      await screen.findByPlaceholderText(
        "Search...",
        {},
        { timeout: WAIT_TIMEOUT },
      ),
      {
        target: { value: "frankfurt" },
      },
    );

    expect(
      await screen.findByText(NO_MATCH_MESSAGE, {}, { timeout: WAIT_TIMEOUT }),
    ).toBeInTheDocument();
    expect(screen.queryByText("wbhq")).not.toBeInTheDocument();
  });

  it("hideEmptyState does not hide a failed load", async () => {
    getListMock.mockImplementation(() => {
      return Promise.reject(new Error("boom"));
    });
    jest
      .spyOn(API, "getFriendlyMessage")
      .mockReturnValue("Could not load the probes.");

    renderList({ noItemsMessage: NO_PROBES_SENTENCE, hideEmptyState: true });

    expect(
      await screen.findByText(
        "Could not load the probes.",
        {},
        { timeout: WAIT_TIMEOUT },
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(NO_PROBES)).not.toBeInTheDocument();
  });

  it("is drawn as a compact empty state, with the model's icon", async () => {
    await waitForLoad(renderList({ noItemsMessage: NO_PROBES_SENTENCE }));

    const state: HTMLElement = screen.getByTestId("probe-list-no-items");

    expect(state).toHaveAttribute("data-empty-state-kind", "empty");
    expect(state.className).toContain("py-8");
    expect(state.querySelector("[data-icon]")).toHaveAttribute(
      "data-icon",
      new Probe().icon as string,
    );
    expect(screen.getByTestId("probe-list-no-items-title").tagName).toBe("H3");
  });

  it("a message of two sentences is a title and a description", async () => {
    await waitForLoad(
      renderList({
        noItemsMessage: "No dashboards found. Create a dashboard first.",
      }),
    );

    expect(screen.getByTestId("probe-list-no-items-title")).toHaveTextContent(
      /^No dashboards found$/,
    );
    expect(
      screen.getByTestId("probe-list-no-items-description"),
    ).toHaveTextContent("Create a dashboard first.");
  });

  it("a search that matches nothing is drawn as filtered", async () => {
    getListMock.mockImplementation(() => {
      return Promise.resolve(listOf(["wbhq"]));
    });

    await waitForLoad(
      renderList({ noItemsMessage: NO_PROBES_SENTENCE, isSearchEnabled: true }),
    );

    fireEvent.change(
      await screen.findByPlaceholderText(
        "Search...",
        {},
        { timeout: WAIT_TIMEOUT },
      ),
      { target: { value: "frankfurt" } },
    );

    expect(
      await screen.findByTestId(
        "probe-list-no-items",
        {},
        { timeout: WAIT_TIMEOUT },
      ),
    ).toHaveAttribute("data-empty-state-kind", "filtered");
  });

  it("a failed load says what failed, why, and tries again", async () => {
    let failures: number = 1;

    getListMock.mockImplementation(() => {
      if (failures > 0) {
        failures--;
        return Promise.reject(new Error("boom"));
      }
      return Promise.resolve(listOf(["wbhq"]));
    });
    jest
      .spyOn(API, "getFriendlyMessage")
      .mockReturnValue("Could not load the probes.");

    renderList({ noItemsMessage: NO_PROBES_SENTENCE });

    const error: HTMLElement = await screen.findByTestId(
      "probe-list-load-error",
      {},
      { timeout: WAIT_TIMEOUT },
    );

    expect(error).toHaveAttribute("data-empty-state-kind", "error");
    expect(error).toHaveTextContent("Couldn't load probes");

    fireEvent.click(screen.getByTestId("refresh-button"));

    expect(
      await screen.findByText("wbhq", {}, { timeout: WAIT_TIMEOUT }),
    ).toBeInTheDocument();
    expect(getListMock).toHaveBeenCalledTimes(2);
  });
});
