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
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * THE ADDRESSES ONEUPTIME KNOWS A CUSTOM PROBE BY, ON ITS PAGE (OneUptime
 * issue #10634).
 *
 * OneUptime knows each project probe by the address it checks in from
 * (Probe.egressIpAddress, #10338) and by the addresses it lists when it
 * checks in (Probe.interfaceIpAddresses, #10429) - the blocklist never
 * blocks them, and Security Events sets the probe's own polling aside by
 * them - but nothing on the probe's page showed either. Now its Probe
 * Status card does, read-only, each with a line saying what it is used for,
 * to whoever may read the probe (PROBE_READERS), and nothing for a probe
 * that has not checked in.
 *
 * The real page, drawn against a stand-in API.
 */

const getMock: MockFunction = getJestMockFunction();
const postMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
const getItemMock: MockFunction = getJestMockFunction();
const getCommonHeadersMock: MockFunction = getJestMockFunction();

// The arrow wrappers are load bearing: jest.mock is hoisted above the consts.
jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      get: (...args: Array<any>) => {
        return getMock(...args);
      },
      post: (...args: Array<any>) => {
        return postMock(...args);
      },
      getFriendlyMessage: (error: unknown) => {
        return error instanceof Error ? error.message : "Something went wrong";
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: (...args: Array<any>) => {
        return getCommonHeadersMock(...args);
      },
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
      getItem: (...args: Array<any>) => {
        return getItemMock(...args);
      },
      count: () => {
        return Promise.resolve(0);
      },
    },
  };
});

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: { defaultValue?: string }): string => {
          return options?.defaultValue ?? key;
        },
      };
    },
  };
});

import MonitorProbeViewPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Monitor/Settings/MonitorProbeView";
import ProbeAddresses, {
  PROBE_ADDRESS_TEST_ID,
  PROBE_ADDRESSES_TEST_ID,
  readProbeAddresses,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Probe/ProbeAddresses";
import { PROBE_ADDRESSES_COPY } from "../../../../App/FeatureSet/Dashboard/src/Components/Probe/ProbeAddressesCopy";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Probe, {
  ProbeConnectionStatus,
} from "../../../Models/DatabaseModels/Probe";
import Route from "../../../Types/API/Route";
import Permission from "../../../Types/Permission";
import { getProjectPermissionsStorageKey } from "../../../UI/Utils/Permission";

const USER_ID: string = "aaaaaaaa-1111-4111-8111-111111111111";
const PROJECT_ID: string = "dddddddd-4444-4444-8444-444444444444";
const PROBE_ID: string = "33333333-0000-4000-8000-000000000001";

// Its NAT's address, as OneUptime sees it check in.
const CHECK_IN_ADDRESS: string = "198.51.100.20";
// Its node's address, its pod's, and its node's IPv6 address.
const INTERFACE_ADDRESSES: string = "10.0.0.4, 10.244.1.7, fd00::4";

type ListResultJSON = {
  data: Array<BaseModel>;
  count: number;
  skip: number;
  limit: number;
};

function listOf(rows: Array<BaseModel>): Promise<ListResultJSON> {
  return Promise.resolve({ data: rows, count: rows.length, skip: 0, limit: 10 });
}

function probe(data: {
  hasCheckedIn: boolean;
  egressIpAddress?: string | undefined;
  interfaceIpAddresses?: string | undefined;
}): Probe {
  const item: Probe = new Probe();
  item._id = PROBE_ID;
  item.name = "Office probe";
  item.description = "Checks what is behind the office firewall.";
  item.shouldAutoEnableProbeOnNewMonitors = false;

  if (data.hasCheckedIn) {
    item.connectionStatus = ProbeConnectionStatus.Connected;
    item.lastAlive = new Date("2026-11-24T10:00:00.000Z");
    item.reportedVersion = "17.2.0";
  }

  if (data.egressIpAddress) {
    item.egressIpAddress = data.egressIpAddress;
  }

  if (data.interfaceIpAddresses) {
    item.interfaceIpAddresses = data.interfaceIpAddresses;
  }

  return item;
}

const signInWith: (data: {
  permissions: Array<Permission>;
  isMasterAdmin?: boolean;
}) => void = (data: {
  permissions: Array<Permission>;
  isMasterAdmin?: boolean;
}): void => {
  localStorage.setItem("user_id", USER_ID);
  localStorage.setItem(
    "is_master_admin",
    data.isMasterAdmin ? "true" : "false",
  );
  sessionStorage.setItem("current_project_id", PROJECT_ID);
  localStorage.setItem(
    getProjectPermissionsStorageKey(PROJECT_ID)!,
    JSON.stringify({
      projectId: PROJECT_ID,
      permissions: data.permissions.map((permission: Permission) => {
        return { permission };
      }),
    }),
  );
};

beforeEach(() => {
  window.history.pushState(
    {},
    "",
    `/dashboard/${PROJECT_ID}/monitors/settings/probes/${PROBE_ID}`,
  );
  getCommonHeadersMock.mockReturnValue({});
  getListMock.mockImplementation((): Promise<ListResultJSON> => {
    return listOf([]);
  });
  getMock.mockResolvedValue({ data: {} } as never);
  postMock.mockResolvedValue({ data: {} } as never);
});

afterEach(() => {
  cleanup();
  getMock.mockReset();
  postMock.mockReset();
  getListMock.mockReset();
  getItemMock.mockReset();
  getCommonHeadersMock.mockReset();
  localStorage.clear();
  sessionStorage.clear();
});

async function renderPage(shown: Probe): Promise<void> {
  getItemMock.mockImplementation((params: any): Promise<Probe | null> => {
    return Promise.resolve(params.modelType === Probe ? shown : null);
  });

  render(
    <MemoryRouter>
      <MonitorProbeViewPage
        pageRoute={new Route("/dashboard/settings/probes/view")}
        currentProject={null}
        hasPaymentMethod={true}
      />
    </MemoryRouter>,
  );

  // The Probe Status card has drawn its probe.
  await waitFor(() => {
    expect(screen.getAllByText("Last Ping Time").length).toBeGreaterThan(0);
  });
}

// What the card's selects asked the API for, across every read of a Probe.
function selectedColumns(): Array<string> {
  return getItemMock.mock.calls.flatMap((call: Array<any>): Array<string> => {
    const params: any = call[0];
    return params?.modelType === Probe ? Object.keys(params.select || {}) : [];
  });
}

describe("the probe's page: the addresses OneUptime knows it by", () => {
  test("a probe that has checked in: where it checks in from, and the addresses it lists, each with what it is used for", async () => {
    signInWith({ permissions: [Permission.ProjectOwner] });

    await renderPage(
      probe({
        hasCheckedIn: true,
        egressIpAddress: CHECK_IN_ADDRESS,
        interfaceIpAddresses: INTERFACE_ADDRESSES,
      }),
    );

    await waitFor(() => {
      expect(
        screen.getByText(PROBE_ADDRESSES_COPY.checkInTitle),
      ).toBeInTheDocument();
    });

    expect(
      screen.getByText(PROBE_ADDRESSES_COPY.interfacesTitle),
    ).toBeInTheDocument();
    expect(
      screen.getByText(PROBE_ADDRESSES_COPY.checkInDescription),
    ).toBeInTheDocument();
    expect(
      screen.getByText(PROBE_ADDRESSES_COPY.interfacesDescription),
    ).toBeInTheDocument();

    const lists: Array<HTMLElement> = screen.getAllByTestId(
      PROBE_ADDRESSES_TEST_ID,
    );

    expect(
      lists.map((list: HTMLElement): Array<string> => {
        return within(list)
          .getAllByTestId(PROBE_ADDRESS_TEST_ID)
          .map((item: HTMLElement): string => {
            return item.textContent || "";
          });
      }),
    ).toEqual([[CHECK_IN_ADDRESS], ["10.0.0.4", "10.244.1.7", "fd00::4"]]);

    // An address reads left to right in every language.
    for (const item of screen.getAllByTestId(PROBE_ADDRESS_TEST_ID)) {
      expect(item).toHaveAttribute("dir", "ltr");
    }

    expect(selectedColumns()).toEqual(
      expect.arrayContaining(["egressIpAddress", "interfaceIpAddresses"]),
    );
  });

  test("a probe that has not checked in: nothing, not even the two titles", async () => {
    signInWith({ permissions: [Permission.ProjectOwner] });

    await renderPage(probe({ hasCheckedIn: false }));

    expect(
      screen.queryByText(PROBE_ADDRESSES_COPY.checkInTitle),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(PROBE_ADDRESSES_COPY.interfacesTitle),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId(PROBE_ADDRESSES_TEST_ID)).toBeNull();
  });

  test("a probe older than the address list: where it checks in from, and no empty list", async () => {
    signInWith({ permissions: [Permission.ProjectOwner] });

    await renderPage(
      probe({ hasCheckedIn: true, egressIpAddress: CHECK_IN_ADDRESS }),
    );

    await waitFor(() => {
      expect(
        screen.getByText(PROBE_ADDRESSES_COPY.checkInTitle),
      ).toBeInTheDocument();
    });

    expect(
      screen.queryByText(PROBE_ADDRESSES_COPY.interfacesTitle),
    ).not.toBeInTheDocument();
  });

  test("a member who may pick probes but not read them is never shown, nor sent, either address", async () => {
    signInWith({ permissions: [Permission.CreateProjectMonitor] });

    await renderPage(
      probe({
        hasCheckedIn: true,
        egressIpAddress: CHECK_IN_ADDRESS,
        interfaceIpAddresses: INTERFACE_ADDRESSES,
      }),
    );

    expect(
      screen.queryByText(PROBE_ADDRESSES_COPY.checkInTitle),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(PROBE_ADDRESSES_COPY.interfacesTitle),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(CHECK_IN_ADDRESS)).toBeNull();
    expect(selectedColumns()).not.toContain("egressIpAddress");
    expect(selectedColumns()).not.toContain("interfaceIpAddresses");
  });

  test("every reader the probe's readers name sees them: a Monitor Viewer, a Settings Viewer, Read Project Probe", async () => {
    for (const permission of [
      Permission.MonitorViewer,
      Permission.SettingsViewer,
      Permission.ReadProjectProbe,
    ]) {
      signInWith({ permissions: [permission] });

      await renderPage(
        probe({
          hasCheckedIn: true,
          egressIpAddress: CHECK_IN_ADDRESS,
          interfaceIpAddresses: INTERFACE_ADDRESSES,
        }),
      );

      await waitFor(() => {
        expect(
          screen.getByText(PROBE_ADDRESSES_COPY.checkInTitle),
        ).toBeInTheDocument();
      });

      cleanup();
      getItemMock.mockReset();
      localStorage.clear();
      sessionStorage.clear();
    }
  });
});

describe("how an address is shown", () => {
  test("the column's text, each address read as the server reads it", () => {
    expect(
      readProbeAddresses("10.0.0.4,127.0.0.1, not-an-address ,fe80::1", true),
    ).toEqual(["10.0.0.4"]);
    expect(readProbeAddresses(" 198.51.100.20 ", false)).toEqual([
      "198.51.100.20",
    ]);
    expect(readProbeAddresses("2001:DB8:0:0:0:0:0:5", false)).toEqual([
      "2001:db8::5",
    ]);
  });

  test("nothing at all for nothing, or for what is no address", () => {
    for (const value of [null, undefined, "", "   ", "not-an-address"]) {
      expect(readProbeAddresses(value, false)).toEqual([]);
      expect(readProbeAddresses(value, true)).toEqual([]);
    }

    render(<ProbeAddresses value="" />);

    expect(screen.queryByTestId(PROBE_ADDRESSES_TEST_ID)).toBeNull();
  });

  test("each address on its own, in the order OneUptime keeps them", () => {
    render(<ProbeAddresses value={INTERFACE_ADDRESSES} isList={true} />);

    expect(
      screen.getAllByTestId(PROBE_ADDRESS_TEST_ID).map(
        (item: HTMLElement): string => {
          return item.textContent || "";
        },
      ),
    ).toEqual(["10.0.0.4", "10.244.1.7", "fd00::4"]);
  });
});
