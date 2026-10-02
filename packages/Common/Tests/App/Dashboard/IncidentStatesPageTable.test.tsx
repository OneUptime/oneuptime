import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  configure,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

configure({ asyncUtilTimeout: 15000 });

/*
 * The Incident States settings page, rendered for real - its ModelTable and
 * BaseModelTable, with only the API stubbed - so what is pinned is what the
 * maintainer sees:
 *
 *   - one compact row per state: a grip, its colour and name, what it counts
 *     as, its description - no raw ID, no "Add New Item" between rows;
 *   - the built-in states tagged, and their Delete locked with why;
 *   - one Create button, in the card's header;
 *   - a drag the server refuses (Resolved above Acknowledged) puts the rows
 *     back and says why, in the server's words.
 */

let permissionsForTest: Array<unknown> = [];

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<unknown> => {
        return permissionsForTest;
      },
      getProjectPermissions: (): unknown => {
        return {
          _type: "UserTenantAccessPermission",
          permissions: permissionsForTest.map((permission: unknown) => {
            return {
              _type: "UserPermission",
              permission: permission,
              labelIds: [],
              isBlockPermission: false,
            };
          }),
        };
      },
      getGlobalPermissions: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return false;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, opts?: { defaultValue?: string }): string => {
          return opts?.defaultValue ?? key;
        },
      };
    },
  };
});

import IncidentStatesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/Settings/IncidentState";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import Route from "../../../Types/API/Route";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import Color from "../../../Types/Color";
import BadDataException from "../../../Types/Exception/BadDataException";
import Permission from "../../../Types/Permission";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import TableFilterUrlState from "../../../UI/Utils/TableFilterUrlState";

const SPACE: { keyCode: number; key: string } = { keyCode: 32, key: " " };
const ARROW_UP: { keyCode: number; key: string } = {
  keyCode: 38,
  key: "ArrowUp",
};

const REFUSAL: string =
  'Incidents only ever move down this list, so the resolved state ("Resolved") has to stay below the acknowledged state ("Acknowledged").';

type StateRow = {
  _id: string;
  name: string;
  description?: string;
  color: string;
  order: number;
  isCreatedState?: boolean;
  isAcknowledgedState?: boolean;
  isResolvedState?: boolean;
};

const ROWS: Array<StateRow> = [
  {
    _id: "00000000-0000-4000-8000-000000000001",
    name: "Identified",
    description: "When an incident is created, it belongs to this state",
    color: "#fd625e",
    order: 1,
    isCreatedState: true,
  },
  {
    _id: "00000000-0000-4000-8000-000000000002",
    name: "Investigating",
    description: "The team is looking into it.",
    color: "#a855f7",
    order: 2,
  },
  {
    _id: "00000000-0000-4000-8000-000000000003",
    name: "Acknowledged",
    description: "When an incident is acknowledged, it belongs to this state.",
    color: "#ffbf53",
    order: 3,
    isAcknowledgedState: true,
  },
  {
    _id: "00000000-0000-4000-8000-000000000004",
    name: "Resolved",
    description: "When an incident is resolved, it belongs to this state.",
    color: "#2ab57d",
    order: 4,
    isResolvedState: true,
  },
];

const toModel: (row: StateRow) => IncidentState = (
  row: StateRow,
): IncidentState => {
  const state: IncidentState = new IncidentState();
  state._id = row._id;
  state.name = row.name;
  state.description = row.description || "";
  state.color = new Color(row.color);
  state.order = row.order;
  state.isCreatedState = Boolean(row.isCreatedState);
  state.isAcknowledgedState = Boolean(row.isAcknowledgedState);
  state.isResolvedState = Boolean(row.isResolvedState);
  return state;
};

let updates: Array<{ id: string; data: Record<string, unknown> }> = [];
let refuseUpdates: boolean = false;

const wait: (ms: number) => Promise<void> = async (
  ms: number,
): Promise<void> => {
  await act(async () => {
    await new Promise((resolve: (value: unknown) => void) => {
      setTimeout(resolve, ms);
    });
  });
};

const press: (
  element: HTMLElement,
  key: { keyCode: number; key: string },
) => Promise<void> = async (
  element: HTMLElement,
  key: { keyCode: number; key: string },
): Promise<void> => {
  await act(async () => {
    fireEvent.keyDown(element, key);
  });
  await wait(30);
};

const renderPage: () => Promise<void> = async (): Promise<void> => {
  render(
    <IncidentStatesPage
      pageRoute={new Route("/dashboard/project/incidents/settings/state")}
      currentProject={null}
      hasPaymentMethod={true}
    />,
  );

  await waitFor(() => {
    expect(screen.getAllByTestId("drag-handle")).toHaveLength(ROWS.length);
  });
};

const rowOf: (name: string) => HTMLElement = (name: string): HTMLElement => {
  return screen
    .getAllByTestId("state-settings-name")
    .find((cell: HTMLElement) => {
      return within(cell).queryByText(name) !== null;
    })!
    .closest("tr")!;
};

const rowNames: () => Array<string> = (): Array<string> => {
  return screen
    .getAllByTestId("state-settings-name")
    .map((cell: HTMLElement) => {
      return within(cell).getByTestId("pill").textContent || "";
    });
};

beforeEach(() => {
  permissionsForTest = [Permission.ProjectAdmin];
  updates = [];
  refuseUpdates = false;
  PermissionGate.clearPermissionPropsCache();
  window.history.replaceState(
    window.history.state,
    "",
    "/dashboard/project/incidents/settings/state",
  );
  TableFilterUrlState.resetClaimedKeys();
  window.localStorage.clear();

  jest.spyOn(ModelAPI, "getList").mockImplementation((async () => {
    return {
      data: ROWS.map(toModel),
      count: ROWS.length,
      skip: 0,
      limit: 50,
    } as ListResult<IncidentState>;
  }) as never);

  jest.spyOn(ModelAPI, "updateById").mockImplementation((async (args: {
    id: { toString: () => string };
    data: Record<string, unknown>;
  }) => {
    updates.push({ id: args.id.toString(), data: args.data });

    if (refuseUpdates) {
      throw new BadDataException(REFUSAL);
    }
  }) as never);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the Incident States page", () => {
  test("is one compact table: name, what it counts as, description", async () => {
    await renderPage();

    const header: HTMLElement = screen.getAllByRole("rowgroup")[0]!;

    expect(within(header).getByText("Name")).toBeInTheDocument();
    expect(within(header).getByText("Counts as")).toBeInTheDocument();
    expect(within(header).getByText("Description")).toBeInTheDocument();
  });

  test("lists the states in their order, each with a grip to drag it by", async () => {
    await renderPage();

    expect(rowNames()).toEqual([
      "Identified",
      "Investigating",
      "Acknowledged",
      "Resolved",
    ]);
    expect(
      screen.getAllByTestId("drag-handle").map((grip: HTMLElement) => {
        return grip.getAttribute("aria-label");
      }),
    ).toEqual([
      "Drag to reorder Incident State: Identified",
      "Drag to reorder Incident State: Investigating",
      "Drag to reorder Incident State: Acknowledged",
      "Drag to reorder Incident State: Resolved",
    ]);
  });

  test("says what an incident in each state counts as", async () => {
    await renderPage();

    await waitFor(() => {
      expect(
        screen
          .getAllByTestId("state-settings-counts-as")
          .map((cell: HTMLElement) => {
            return cell.textContent;
          }),
      ).toEqual([
        "Not acknowledged",
        "Not acknowledged",
        "Acknowledged",
        "Resolved",
      ]);
    });
  });

  test("tags the three built-in states, and only those", async () => {
    await renderPage();

    for (const name of ["Identified", "Acknowledged", "Resolved"]) {
      expect(
        within(rowOf(name)).getByTestId("state-settings-built-in"),
      ).toBeInTheDocument();
    }

    expect(
      within(rowOf("Investigating")).queryByTestId("state-settings-built-in"),
    ).toBeNull();
  });

  test("shows no raw ID, and no Add New Item between the rows", async () => {
    await renderPage();

    expect(screen.queryByText(/Add New/)).toBeNull();
    expect(screen.queryByText(/^ID:/)).toBeNull();
    expect(document.body.textContent).not.toContain(ROWS[0]!._id);
  });

  test("creates from one button, in the card's header", async () => {
    await renderPage();

    const create: Array<HTMLElement> = screen.getAllByRole("button", {
      name: "Create Incident State",
    });

    expect(create).toHaveLength(1);
    expect(create[0]).toHaveAttribute("data-testid", "card-button");
  });

  test("keeps Edit on the row, and Show ID and a locked Delete in its menu", async () => {
    await renderPage();

    const row: HTMLElement = rowOf("Resolved");

    expect(
      within(row).getByRole("button", { name: "Edit" }),
    ).toBeInTheDocument();

    fireEvent.click(within(row).getByTestId("row-actions-more-button"));

    const menu: HTMLElement = screen.getByRole("menu");

    expect(
      within(menu).getByRole("menuitem", { name: "Show ID" }),
    ).toBeInTheDocument();

    const deleteItem: HTMLElement = within(menu).getByRole("menuitem", {
      name: "Delete",
    });

    expect(deleteItem).toHaveAttribute("aria-disabled", "true");
    expect(
      document.getElementById(deleteItem.getAttribute("aria-describedby")!)
        ?.textContent,
    ).toBe("Built-in states can be renamed, but not deleted.");
  });

  test("a state the project added can be deleted", async () => {
    await renderPage();

    fireEvent.click(
      within(rowOf("Investigating")).getByTestId("row-actions-more-button"),
    );

    expect(
      within(screen.getByRole("menu")).getByRole("menuitem", {
        name: "Delete",
      }),
    ).not.toHaveAttribute("aria-disabled", "true");
  });

  test("a drag sends the number of the row it lands on", async () => {
    await renderPage();

    // Acknowledged dragged up onto Investigating.
    const grip: HTMLElement = screen.getAllByTestId("drag-handle")[2]!;
    grip.focus();

    await press(grip, SPACE);
    await press(grip, ARROW_UP);
    await press(grip, SPACE);
    await wait(400);

    await waitFor(() => {
      expect(updates).toEqual([{ id: ROWS[2]!._id, data: { order: 2 } }]);
    });
  });

  test("a drag the server refuses puts the rows back, and says why", async () => {
    refuseUpdates = true;

    await renderPage();

    // Resolved dragged up above Acknowledged.
    const grip: HTMLElement = screen.getAllByTestId("drag-handle")[3]!;
    grip.focus();

    await press(grip, SPACE);
    await press(grip, ARROW_UP);
    await press(grip, SPACE);
    await wait(400);

    await waitFor(() => {
      expect(screen.getByTestId("reorder-error")).toBeInTheDocument();
    });

    expect(screen.getByTestId("reorder-error")).toHaveTextContent(
      "The new order could not be saved.",
    );
    expect(screen.getByTestId("reorder-error")).toHaveTextContent(REFUSAL);
    expect(rowNames()).toEqual([
      "Identified",
      "Investigating",
      "Acknowledged",
      "Resolved",
    ]);
  });
});
