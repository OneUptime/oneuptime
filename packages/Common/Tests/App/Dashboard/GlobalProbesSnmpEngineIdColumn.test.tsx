import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
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
 * THE GLOBAL PROBES LIST SAYS EACH ONE'S SNMPv3 ENGINE ID (OneUptime issue
 * #11173).
 *
 * A device that sends SNMPv3 informs authenticates them with the engine ID
 * of the probe it sends them to, and some devices (Cisco IOS) must be
 * given it. A project's own probe shows it on its page; a global probe has
 * no page a project opens, so the Global Probes list shows it, to copy. It
 * is the one fact of a global probe's trap receiver that belongs to no
 * project: the route hands back nothing else of the report (ProbeAPI), and
 * refuses to sort by it, so the column is not sorted on.
 *
 * The real page, drawn with the shared table, against a stand-in API.
 */

const getMock: MockFunction = getJestMockFunction();
const postMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
const getItemMock: MockFunction = getJestMockFunction();
const getCommonHeadersMock: MockFunction = getJestMockFunction();

/*
 * The arrow wrappers are load bearing: jest.mock is hoisted above the
 * compiled requires, so the consts above are still in their temporal dead
 * zone when the factory body runs.
 */
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

import MonitorProbesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Monitor/Settings/MonitorProbes";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Probe, {
  ProbeConnectionStatus,
} from "../../../Models/DatabaseModels/Probe";
import Route from "../../../Types/API/Route";
import Permission from "../../../Types/Permission";
import { SnmpTrapReceiverReport } from "../../../Types/Probe/SnmpTrapReceiver";
import { getProjectPermissionsStorageKey } from "../../../UI/Utils/Permission";

const USER_ID: string = "aaaaaaaa-1111-4111-8111-111111111111";
const PROJECT_ID: string = "dddddddd-4444-4444-8444-444444444444";

const FRANKFURT_ENGINE_ID: string = "8000B98380A1B2C3D4E5F60718293A4B";

type ListResultJSON = {
  data: Array<BaseModel>;
  count: number;
  skip: number;
  limit: number;
};

function listOf(rows: Array<BaseModel>): Promise<ListResultJSON> {
  return Promise.resolve({
    data: rows,
    count: rows.length,
    skip: 0,
    limit: 50,
  });
}

function probe(data: {
  id: string;
  name: string;
  isGlobalProbe?: boolean | undefined;
  snmpTrapReceiver?: SnmpTrapReceiverReport | undefined;
}): Probe {
  const item: Probe = new Probe();
  item._id = data.id;
  item.name = data.name;
  item.description = `${data.name} checks what is reachable from the internet.`;
  item.isGlobalProbe = Boolean(data.isGlobalProbe);
  item.connectionStatus = ProbeConnectionStatus.Connected;
  item.lastAlive = new Date("2026-11-27T10:00:00.000Z");

  if (data.snmpTrapReceiver) {
    item.snmpTrapReceiver = data.snmpTrapReceiver;
  }

  return item;
}

const GLOBAL_PROBES: Array<Probe> = [
  // What the route hands back of a listening global probe's report.
  probe({
    id: "99999999-0000-4000-8000-000000000001",
    name: "Global probe in Frankfurt",
    isGlobalProbe: true,
    snmpTrapReceiver: {
      isEnabled: true,
      port: 162,
      engineId: FRANKFURT_ENGINE_ID,
      refusals: [],
    },
  }),
  // One that has not reported its receiver yet.
  probe({
    id: "99999999-0000-4000-8000-000000000002",
    name: "Global probe in Ohio",
    isGlobalProbe: true,
  }),
  // One whose receiver is off: no engine ID takes informs.
  probe({
    id: "99999999-0000-4000-8000-000000000003",
    name: "Global probe in Mumbai",
    isGlobalProbe: true,
    snmpTrapReceiver: { isEnabled: false, refusals: [] },
  }),
];

// A project probe, whose own page has its SNMP Traps card.
const CUSTOM_PROBE: Probe = probe({
  id: "33333333-0000-4000-8000-000000000001",
  name: "Data centre",
  snmpTrapReceiver: {
    isEnabled: true,
    port: 162,
    engineId: "8000B98380FFFFFFFFFFFFFFFFFFFFFF",
    refusals: [],
  },
});

const signInAsOwner: () => void = (): void => {
  localStorage.setItem("user_id", USER_ID);
  localStorage.setItem("is_master_admin", "true");
  sessionStorage.setItem("current_project_id", PROJECT_ID);
  localStorage.setItem(
    getProjectPermissionsStorageKey(PROJECT_ID)!,
    JSON.stringify({
      projectId: PROJECT_ID,
      permissions: [{ permission: Permission.ProjectOwner }],
    }),
  );
};

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

async function renderPage(): Promise<void> {
  signInAsOwner();
  getCommonHeadersMock.mockReturnValue({});
  getListMock.mockImplementation((params: any): Promise<ListResultJSON> => {
    if (params.modelType !== Probe) {
      return listOf([]);
    }

    // The global probes are read from an endpoint of their own.
    return params.requestOptions?.overrideRequestUrl
      ? listOf(GLOBAL_PROBES)
      : listOf([CUSTOM_PROBE]);
  });
  // The "Global Probes on New Monitors" switch under the tables reads the project.
  getItemMock.mockResolvedValue(null as never);

  render(
    <MemoryRouter>
      <MonitorProbesPage
        pageRoute={new Route("/dashboard/settings/probes")}
        currentProject={null}
        hasPaymentMethod={true}
      />
    </MemoryRouter>,
  );

  await waitFor(() => {
    expect(screen.getByText("Global probe in Frankfurt")).toBeInTheDocument();
    expect(screen.getByText("Data centre")).toBeInTheDocument();
  });
}

function rowOf(name: string): HTMLElement {
  const row: HTMLElement | null = screen.getByText(name).closest("tr");

  if (!row) {
    throw new Error(`no row for ${name}`);
  }

  return row;
}

function engineIdHeaders(): Array<HTMLElement> {
  return screen
    .getAllByRole("columnheader")
    .filter((header: HTMLElement): boolean => {
      return (header.textContent || "").trim() === "SNMPv3 Engine ID";
    });
}

describe("Global Probes: each one's SNMPv3 engine ID", () => {
  test("the global probes have an SNMPv3 Engine ID column, the custom probes none", async () => {
    await renderPage();

    expect(engineIdHeaders()).toHaveLength(1);
    expect(
      within(rowOf("Data centre")).queryByTestId("global-probe-snmp-engine-id"),
    ).not.toBeInTheDocument();
  });

  test("a listening global probe's engine ID is shown, to copy", async () => {
    await renderPage();

    const row: HTMLElement = rowOf("Global probe in Frankfurt");

    expect(
      within(row).getByTestId("global-probe-snmp-engine-id"),
    ).toHaveTextContent(FRANKFURT_ENGINE_ID);
    expect(within(row).getByRole("button", { name: /Copy/ })).toBeVisible();
  });

  test("one that has not reported, or whose receiver is off, shows the empty mark", async () => {
    await renderPage();

    for (const name of ["Global probe in Ohio", "Global probe in Mumbai"]) {
      const row: HTMLElement = rowOf(name);

      expect(
        within(row).queryByTestId("global-probe-snmp-engine-id"),
      ).not.toBeInTheDocument();
      expect(within(row).getByTestId("table-empty-value")).toBeVisible();
    }
  });

  test("the global probes are read with their receiver report", async () => {
    await renderPage();

    const globalRead: any = getListMock.mock.calls
      .map((call: Array<any>) => {
        return call[0];
      })
      .find((params: any) => {
        return (
          params.modelType === Probe &&
          Boolean(params.requestOptions?.overrideRequestUrl)
        );
      });

    expect(globalRead.select).toEqual(
      expect.objectContaining({ snmpTrapReceiver: true }),
    );
    expect(String(globalRead.requestOptions.overrideRequestUrl)).toContain(
      "/probe/global-probes",
    );
  });

  test("is not sorted on: the route refuses to sort by the report", async () => {
    await renderPage();

    const [header] = engineIdHeaders();

    expect(header).not.toHaveAttribute("aria-sort");
    // Name is: a sortable column says so.
    expect(
      screen
        .getAllByRole("columnheader")
        .find((candidate: HTMLElement): boolean => {
          return (candidate.textContent || "").trim() === "Name";
        }),
    ).toHaveAttribute("aria-sort");
  });
});
