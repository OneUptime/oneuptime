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
} from "@testing-library/react";
import React, { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import Permission from "../../../Types/Permission";
import Route from "../../../Types/API/Route";
import { JSONObject } from "../../../Types/JSON";

/*
 * The quick actions, end to end on the pages that answer them.
 *
 * "Add Device" and "Discover Devices" on the Network Overview (and "Add a
 * device" on an empty topology) open their forms straight away: they link
 * to the list page with ?open=add-device or ?open=discover-devices, and the
 * page opens its create form as soon as its table is drawn. The action is
 * read once and then taken off the address, so a refresh or a shared link
 * does not open the form again.
 *
 * And an empty device list offers the other way in beside Add Device:
 * Discover Devices, which opens the scan form.
 *
 * ModelTable is replaced by a recorder that draws only what this file is
 * about: whether the page asked for its create form, and the empty state's
 * actions.
 */

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";

type RecordedTableProps = {
  showCreateForm?: boolean | undefined;
  createVerb?: string | undefined;
  singularName?: string | undefined;
  emptyState?:
    | {
        actions?:
          | Array<{
              title: string;
              onClick: () => void;
              dataTestId?: string | undefined;
            }>
          | undefined;
      }
    | undefined;
};

let mockTableProps: Array<RecordedTableProps> = [];

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: RecordedTableProps): ReactElement => {
      mockTableProps.push(props);

      return (
        <div data-testid="model-table">
          {props.showCreateForm ? (
            <div data-testid="create-form-opened">
              {`${props.createVerb} New ${props.singularName}`}
            </div>
          ) : (
            <></>
          )}
          {(props.emptyState?.actions || []).map(
            (action: {
              title: string;
              onClick: () => void;
              dataTestId?: string | undefined;
            }): ReactElement => {
              return (
                <button
                  key={action.title}
                  type="button"
                  data-testid={action.dataTestId}
                  onClick={action.onClick}
                >
                  {action.title}
                </button>
              );
            },
          )}
        </div>
      );
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      count: async (): Promise<number> => {
        return 0;
      },
      getItem: async (): Promise<null> => {
        return null;
      },
      getList: async (): Promise<{
        data: Array<unknown>;
        count: number;
        skip: number;
        limit: number;
      }> => {
        return { data: [], count: 0, skip: 0, limit: 0 };
      },
      getCommonHeaders: (): JSONObject => {
        return {};
      },
    },
  };
});

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<Permission> => {
        return [Permission.ProjectOwner, Permission.User, Permission.Public];
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): { globalPermissions: Array<Permission> } => {
        return {
          globalPermissions: [
            Permission.ProjectOwner,
            Permission.User,
            Permission.Public,
          ],
        };
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

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): unknown => {
        const ObjectIDClass: any = jest.requireActual(
          "../../../Types/ObjectID",
        ) as any;
        return new ObjectIDClass.default(
          "11111111-1111-4111-8111-111111111111",
        );
      },
    },
  };
});

jest.mock("../../../../App/FeatureSet/Dashboard/src/Utils/Probe", () => {
  return {
    __esModule: true,
    default: {
      getAllProbes: async (): Promise<Array<unknown>> => {
        return [];
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/useResourceOwners",
  () => {
    const actual: Record<string, unknown> = jest.requireActual(
      "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/useResourceOwners",
    ) as Record<string, unknown>;

    return {
      ...actual,
      __esModule: true,
      default: () => {
        return {
          filterBar: null,
          emptyState: {},
          mergeFiltersIntoQuery: (
            base: Record<string, unknown> | undefined,
          ) => {
            return base || {};
          },
          hasActiveFilters: false,
          facetSelections: {},
          facetOperators: {},
          setFacetSelection: () => {},
          clearAllFacets: () => {},
          facetSaveState: {},
          restoreFacetState: () => {},
        };
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceSummaryCards",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);

import NetworkDevicesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/NetworkDevice/Devices";
import DiscoveryPage from "../../../../App/FeatureSet/Dashboard/src/Pages/NetworkDevice/Discovery";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import Navigation from "../../../UI/Utils/Navigation";

const DEVICES_PATH: string = `/dashboard/${PROJECT_ID}/network-devices`;
const DISCOVERY_PATH: string = `/dashboard/${PROJECT_ID}/network-devices/discovery`;

let navigateSpy: ReturnType<typeof jest.spyOn>;

async function flush(): Promise<void> {
  for (let i: number = 0; i < 5; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function renderAt(
  address: string,
  Page: React.FunctionComponent<PageComponentProps>,
): Promise<void> {
  window.history.replaceState(null, "", address);

  const props: PageComponentProps = {
    pageRoute: new Route(address),
  } as unknown as PageComponentProps;

  render(
    <MemoryRouter>
      <Page {...props} />
    </MemoryRouter>,
  );

  await flush();
  await screen.findByTestId("model-table");
}

function lastTableProps(): RecordedTableProps {
  const props: RecordedTableProps | undefined =
    mockTableProps[mockTableProps.length - 1];

  if (!props) {
    throw new Error("The page drew no table.");
  }

  return props;
}

function navigatedTo(): Array<string> {
  return navigateSpy.mock.calls.map((call: Array<unknown>): string => {
    return String(call[0]);
  });
}

beforeEach(() => {
  mockTableProps = [];
  navigateSpy = jest.spyOn(Navigation, "navigate").mockImplementation(() => {
    return undefined;
  });
});

afterEach(() => {
  cleanup();
  navigateSpy.mockRestore();
  window.history.replaceState(null, "", "/");
});

describe("Devices, opened with ?open=add-device", () => {
  test("opens the Add Device form as soon as the list is drawn", async () => {
    await renderAt(`${DEVICES_PATH}?open=add-device`, NetworkDevicesPage);

    expect(screen.getByTestId("create-form-opened")).toHaveTextContent(
      "Add New Device",
    );
    expect(lastTableProps().showCreateForm).toBe(true);
  });

  test("takes the action off the address, so a refresh does not open it again", async () => {
    await renderAt(`${DEVICES_PATH}?open=add-device`, NetworkDevicesPage);

    expect(window.location.pathname).toBe(DEVICES_PATH);
    expect(window.location.search).toBe("");
  });

  test("keeps the rest of the address as it was", async () => {
    await renderAt(
      `${DEVICES_PATH}?status=down&open=add-device`,
      NetworkDevicesPage,
    );

    expect(screen.getByTestId("create-form-opened")).toBeInTheDocument();
    expect(window.location.search).toBe("?status=down");
  });

  test("the address it leaves behind opens nothing", async () => {
    await renderAt(`${DEVICES_PATH}?open=add-device`, NetworkDevicesPage);
    const leftBehind: string =
      window.location.pathname + window.location.search;
    cleanup();
    mockTableProps = [];

    await renderAt(leftBehind, NetworkDevicesPage);

    expect(screen.queryByTestId("create-form-opened")).toBeNull();
  });
});

describe("Devices, opened without it", () => {
  test("does not open the form", async () => {
    await renderAt(DEVICES_PATH, NetworkDevicesPage);

    expect(screen.queryByTestId("create-form-opened")).toBeNull();
    expect(Boolean(lastTableProps().showCreateForm)).toBe(false);
  });

  test("another page's action is not this page's", async () => {
    await renderAt(`${DEVICES_PATH}?open=discover-devices`, NetworkDevicesPage);

    expect(screen.queryByTestId("create-form-opened")).toBeNull();
    // Not its to clear either: the address is left alone.
    expect(window.location.search).toBe("?open=discover-devices");
  });

  test("an empty list offers Discover Devices beside Add Device, and it opens the scan form", async () => {
    await renderAt(DEVICES_PATH, NetworkDevicesPage);

    fireEvent.click(screen.getByTestId("network-devices-empty-discover"));

    expect(navigatedTo()).toEqual([`${DISCOVERY_PATH}?open=discover-devices`]);
  });

  test("the list's create button reads Add Device", async () => {
    await renderAt(DEVICES_PATH, NetworkDevicesPage);

    expect(lastTableProps().createVerb).toBe("Add");
    expect(lastTableProps().singularName).toBe("Device");
  });
});

describe("Discovery, opened with ?open=discover-devices", () => {
  test("opens the Start Scan form as soon as the list is drawn", async () => {
    await renderAt(`${DISCOVERY_PATH}?open=discover-devices`, DiscoveryPage);

    expect(screen.getByTestId("create-form-opened")).toHaveTextContent(
      "Start New Scan",
    );
  });

  test("takes the action off the address", async () => {
    await renderAt(`${DISCOVERY_PATH}?open=discover-devices`, DiscoveryPage);

    expect(window.location.pathname).toBe(DISCOVERY_PATH);
    expect(window.location.search).toBe("");
  });

  test("does not open the form without it", async () => {
    await renderAt(DISCOVERY_PATH, DiscoveryPage);

    expect(screen.queryByTestId("create-form-opened")).toBeNull();
  });

  test("does not answer the Add Device action", async () => {
    await renderAt(`${DISCOVERY_PATH}?open=add-device`, DiscoveryPage);

    expect(screen.queryByTestId("create-form-opened")).toBeNull();
  });
});
