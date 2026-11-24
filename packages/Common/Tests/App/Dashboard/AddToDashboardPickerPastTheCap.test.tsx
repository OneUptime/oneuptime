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
} from "@testing-library/react";
import * as React from "react";
import type { SpyInstance } from "jest-mock";
import Permission, { UserPermission } from "../../../Types/Permission";

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (value: string): string => {
          return value;
        },
        i18n: { language: "en" },
      };
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

import AddToDashboardModal from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/AddToDashboardModal";
import CappedListServer, {
  CappedListCall,
  namesSortingFirst,
} from "./CappedListServer";
import Dashboard from "../../../Models/DatabaseModels/Dashboard";
import MultiSearch from "../../../Types/BaseDatabase/MultiSearch";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import MetricViewData from "../../../Types/Metrics/MetricViewData";
import ObjectID from "../../../Types/ObjectID";
import {
  MODEL_LIST_SERVER_SEARCH_LIMIT,
  MODEL_LIST_SEARCH_TO_FIND_MORE,
} from "../../../UI/Components/ModelList/ModelList";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import Navigation from "../../../UI/Utils/Navigation";
import ProjectUtil from "../../../UI/Utils/Project";

/*
 * METRICS EXPLORER'S "ADD TO DASHBOARD", PAST THE PROJECT'S FIRST 10,000
 * DASHBOARDS (#10764).
 *
 * The dialog's list read the project's first 10,000 dashboards and filtered
 * them in the browser, so a dashboard past them could not be picked to add
 * the chart to. The list searches the server as the person types (ModelList's
 * searchesServer), 50 by name, and says to search to find more. On a fake
 * project of 10,050 dashboards (CappedListServer), as the list route answers.
 */

const PROJECT_ID: string = "55555555-5555-4555-8555-555555555555";
const LATE_DASHBOARD_ID: string = "44444444-4444-4444-8444-444444444444";

const VIEW: MetricViewData = {
  startAndEndDate: null,
  queryConfigs: [
    {
      metricAliasData: {
        metricVariable: "a",
        title: "CPU",
        description: "",
        legend: "",
        legendUnit: "",
      },
      metricQueryData: {
        filterData: {
          metricName: "system.cpu.utilization",
          aggegationType: "Avg",
        },
      },
    },
  ],
  formulaConfigs: [],
} as unknown as MetricViewData;

let server: CappedListServer;

// The searches the list sent, in order.
function listReads(): Array<CappedListCall> {
  return server.callsFor(Dashboard);
}

function searchBox(): HTMLElement {
  return screen.getByPlaceholderText("Search...");
}

beforeEach(() => {
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
  jest.spyOn(Navigation, "navigate").mockImplementation(() => {});

  server = new CappedListServer();
  server.add(
    Dashboard,
    namesSortingFirst(10050, "AP").map(
      (name: string): Record<string, unknown> => {
        return {
          _id: ObjectID.generate().toString(),
          name,
          description: "",
        };
      },
    ),
  );
  server.add(Dashboard, [
    {
      _id: LATE_DASHBOARD_ID,
      name: "Warehouse board",
      description: "Stock and pick rates",
    },
  ]);
  server.install();
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("Add to Dashboard's list of dashboards", () => {
  test("opens on the first 50 by name - not the project's first 10,000 - and says to search for more", async () => {
    render(<AddToDashboardModal metricViewData={VIEW} onClose={() => {}} />);

    expect(await screen.findByText("AP000001")).toBeInTheDocument();

    const [first] = listReads();

    expect(first!.limit).toBe(MODEL_LIST_SERVER_SEARCH_LIMIT);
    expect(first!.sort).toEqual({ name: SortOrder.Ascending });
    expect(
      screen.getByTestId("model-list-modal-search-to-find-more"),
    ).toHaveTextContent(MODEL_LIST_SEARCH_TO_FIND_MORE);
  });

  test("a dashboard past them is found on the server by its name or description, picked, and the chart added to it", async () => {
    const getItem: SpyInstance<typeof ModelAPI.getItem> = jest
      .spyOn(ModelAPI, "getItem")
      .mockResolvedValue(
        Object.assign(new Dashboard(), {
          name: "Warehouse board",
          dashboardViewConfig: undefined,
        }) as never,
      );
    const updateById: SpyInstance<typeof ModelAPI.updateById> = jest
      .spyOn(ModelAPI, "updateById")
      .mockResolvedValue({} as never);

    render(<AddToDashboardModal metricViewData={VIEW} onClose={() => {}} />);

    await screen.findByText("AP000001");

    await act(async () => {
      fireEvent.change(searchBox(), { target: { value: "pick rates" } });
    });

    expect(await screen.findByText("Warehouse board")).toBeInTheDocument();
    expect(screen.queryByText("AP000001")).toBeNull();
    // Every match is listed: no line about more.
    expect(
      screen.queryByTestId("model-list-modal-search-to-find-more"),
    ).toBeNull();

    // Searched in its name and description, as the list route reads it.
    const searched: MultiSearch | undefined = listReads()
      .map((call: CappedListCall): unknown => {
        return Object.values(call.query).find((value: unknown) => {
          return value instanceof MultiSearch;
        });
      })
      .find((value: unknown) => {
        return Boolean(value);
      }) as MultiSearch | undefined;

    expect(searched?.fields).toEqual(["name", "description"]);

    await act(async () => {
      fireEvent.click(screen.getByText("Warehouse board"));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });

    await waitFor(() => {
      expect(updateById).toHaveBeenCalledTimes(1);
    });
    expect(String((getItem.mock.calls[0]![0] as { id: ObjectID }).id)).toBe(
      LATE_DASHBOARD_ID,
    );
  });

  test("the search box stays while the server answers, so typing is never lost", async () => {
    render(<AddToDashboardModal metricViewData={VIEW} onClose={() => {}} />);

    await screen.findByText("AP000001");

    await act(async () => {
      fireEvent.change(searchBox(), { target: { value: "ware" } });
    });

    expect(searchBox()).toHaveValue("ware");
    expect(await screen.findByText("Warehouse board")).toBeInTheDocument();
    expect(searchBox()).toHaveValue("ware");
  });

  test("clearing the search lists the first 50 again", async () => {
    render(<AddToDashboardModal metricViewData={VIEW} onClose={() => {}} />);

    await screen.findByText("AP000001");

    await act(async () => {
      fireEvent.change(searchBox(), { target: { value: "warehouse" } });
    });
    await screen.findByText("Warehouse board");

    await act(async () => {
      fireEvent.change(searchBox(), { target: { value: "" } });
    });

    expect(await screen.findByText("AP000001")).toBeInTheDocument();
    expect(screen.queryByText("Warehouse board")).toBeNull();
  });
});
