import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import fs from "fs";
import path from "path";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * THE CUSTOM PROBES LIST SAYS WHICH RELEASE EACH PROBE RUNS, AND WHICH ARE
 * OLDER THAN THE ONEUPTIME THEY REPORT TO (OneUptime issue #9815).
 *
 * Teams found out a custom probe was behind only when a feature needed the
 * newer probe. The list now has a Version column: each probe's release, and
 * "Update available: <this OneUptime's release>" under it when the probe runs
 * an older one, linked to the docs that say how to update a probe. A test
 * build of OneUptime's own release is not flagged, nor is a probe that never
 * connected, nor one built without a release. The global probes, which
 * OneUptime updates, have no such column.
 *
 * The real page, drawn with the shared table, against a stand-in API, on a
 * OneUptime that runs 17.2.0.
 */

const SERVER_VERSION: string = "17.2.0";

const getMock: MockFunction = getJestMockFunction();
const postMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
const getItemMock: MockFunction = getJestMockFunction();
const getCommonHeadersMock: MockFunction = getJestMockFunction();

/*
 * The arrow wrappers are load bearing: jest.mock is hoisted above the
 * compiled requires, so the consts above are still in their temporal dead
 * zone when the factory body runs. Dereferencing them lazily, at call time,
 * is what works.
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

// The release this OneUptime runs, as env.js hands it to the page.
jest.mock("../../../UI/Config", () => {
  return {
    ...(jest.requireActual("../../../UI/Config") as Record<string, unknown>),
    __esModule: true,
    AppVersion: "17.2.0",
  };
});

import MonitorProbesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Monitor/Settings/MonitorProbes";
import {
  PROBE_UPDATE_AVAILABLE_TEST_ID,
  PROBE_VERSION_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Probe/ProbeVersion";
import { UPDATE_A_PROBE_DOCS_PATH } from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/OneTimeCodeProbes";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Probe, {
  ProbeConnectionStatus,
} from "../../../Models/DatabaseModels/Probe";
import Route from "../../../Types/API/Route";
import Permission from "../../../Types/Permission";
import { getProjectPermissionsStorageKey } from "../../../UI/Utils/Permission";

const USER_ID: string = "aaaaaaaa-1111-4111-8111-111111111111";
const PROJECT_ID: string = "dddddddd-4444-4444-8444-444444444444";
const CONNECTED_AT: Date = new Date("2026-11-19T10:00:00.000Z");

const DASHBOARD: string = path.join(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src",
);

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
  reportedVersion?: string | undefined;
  isConnected?: boolean | undefined;
  isGlobalProbe?: boolean | undefined;
}): Probe {
  const item: Probe = new Probe();
  item._id = data.id;
  item.name = data.name;
  item.description = `${data.name} checks what is behind the firewall.`;
  item.isGlobalProbe = Boolean(data.isGlobalProbe);

  if (data.reportedVersion) {
    item.reportedVersion = data.reportedVersion;
  }

  if (data.isConnected) {
    item.connectionStatus = ProbeConnectionStatus.Connected;
    item.lastAlive = CONNECTED_AT;
  }

  return item;
}

// The project's probes, one of each kind the column tells apart.
const CUSTOM_PROBES: Array<Probe> = [
  probe({
    id: "33333333-0000-4000-8000-000000000001",
    name: "Data centre",
    reportedVersion: "17.2.0",
    isConnected: true,
  }),
  probe({
    id: "33333333-0000-4000-8000-000000000002",
    name: "Branch office",
    reportedVersion: "17.1.4",
    isConnected: true,
  }),
  probe({
    id: "33333333-0000-4000-8000-000000000003",
    name: "Office LAN",
    isConnected: true,
  }),
  probe({
    id: "33333333-0000-4000-8000-000000000004",
    name: "Staging",
    reportedVersion: "17.2.0-test",
    isConnected: true,
  }),
  probe({
    id: "33333333-0000-4000-8000-000000000005",
    name: "Built here",
    reportedVersion: "unknown",
    isConnected: true,
  }),
  probe({
    id: "33333333-0000-4000-8000-000000000006",
    name: "Never started",
  }),
];

const GLOBAL_PROBE: Probe = probe({
  id: "99999999-0000-4000-8000-000000000001",
  name: "Global probe in Frankfurt",
  reportedVersion: "16.0.0",
  isConnected: true,
  isGlobalProbe: true,
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
      ? listOf([GLOBAL_PROBE])
      : listOf(CUSTOM_PROBES);
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
    expect(screen.getByText("Never started")).toBeInTheDocument();
    expect(screen.getByText("Global probe in Frankfurt")).toBeInTheDocument();
  });
}

// The Version cell of the custom probe with this name.
function versionCellOf(name: string): HTMLElement {
  const row: HTMLElement | null = screen.getByText(name).closest("tr");

  if (!row) {
    throw new Error(`no row for ${name}`);
  }

  return within(row).getByTestId(PROBE_VERSION_TEST_ID);
}

function updateLinkIn(cell: HTMLElement): HTMLElement | null {
  return within(cell).queryByTestId(PROBE_UPDATE_AVAILABLE_TEST_ID);
}

describe("Custom Probes: each probe's release, and whether it is older than this OneUptime", () => {
  test("the custom probes have a Version column, the global probes none", async () => {
    await renderPage();

    // One Version header on the page: the custom probes'.
    expect(
      screen.getAllByRole("columnheader").filter((header: HTMLElement) => {
        return (header.textContent || "").trim() === "Version";
      }),
    ).toHaveLength(1);

    const globalRow: HTMLElement = screen
      .getByText("Global probe in Frankfurt")
      .closest("tr") as HTMLElement;

    expect(
      within(globalRow).queryByTestId(PROBE_VERSION_TEST_ID),
    ).not.toBeInTheDocument();
    expect(globalRow).not.toHaveTextContent("Update available");
  });

  test("a probe on this OneUptime's release shows it, and nothing more", async () => {
    await renderPage();

    const cell: HTMLElement = versionCellOf("Data centre");

    expect(cell).toHaveTextContent("17.2.0");
    expect(updateLinkIn(cell)).not.toBeInTheDocument();
  });

  test("a probe on an older release says an update is available, by this OneUptime's release, linked to how to update it", async () => {
    await renderPage();

    const cell: HTMLElement = versionCellOf("Branch office");
    const update: HTMLElement | null = updateLinkIn(cell);

    expect(cell).toHaveTextContent("17.1.4");
    expect(update).toHaveTextContent(`Update available: ${SERVER_VERSION}`);
    expect(update?.getAttribute("href")).toContain(UPDATE_A_PROBE_DOCS_PATH);
    expect(update?.getAttribute("target")).toBe("_blank");
  });

  test("a probe that connected and says no release is older than 17.0.1, so an update is available", async () => {
    await renderPage();

    const cell: HTMLElement = versionCellOf("Office LAN");

    expect(cell).toHaveTextContent("Older than 17.0.1");
    expect(updateLinkIn(cell)).toHaveTextContent(
      `Update available: ${SERVER_VERSION}`,
    );
  });

  test("a test build of this OneUptime's release is not flagged", async () => {
    await renderPage();

    const cell: HTMLElement = versionCellOf("Staging");

    expect(cell).toHaveTextContent("17.2.0-test");
    expect(updateLinkIn(cell)).not.toBeInTheDocument();
  });

  test("a build that is no release, and a probe that never connected, are not flagged", async () => {
    await renderPage();

    expect(versionCellOf("Built here")).toHaveTextContent("unknown");
    expect(updateLinkIn(versionCellOf("Built here"))).not.toBeInTheDocument();

    const neverStarted: HTMLElement = versionCellOf("Never started");

    expect(neverStarted).not.toHaveTextContent("Older than");
    expect(updateLinkIn(neverStarted)).not.toBeInTheDocument();
  });

  test("the list reads each probe's release with the probes, and when each was last seen", async () => {
    await renderPage();

    const customRead: any = getListMock.mock.calls
      .map((call: Array<any>) => {
        return call[0];
      })
      .find((params: any) => {
        return (
          params.modelType === Probe &&
          !params.requestOptions?.overrideRequestUrl
        );
      });

    expect(customRead.select).toEqual(
      expect.objectContaining({ reportedVersion: true, lastAlive: true }),
    );
  });
});

describe("where the column is", () => {
  const page: string = fs.readFileSync(
    path.join(DASHBOARD, "Pages/Monitor/Settings/MonitorProbes.tsx"),
    "utf8",
  );

  test("after Status, drawn by the probe's version as a cell, and not sorted as text", () => {
    const status: number = page.indexOf('title: "Status"');
    const version: number = page.indexOf('title: "Version"');
    const column: string = page.slice(
      page.lastIndexOf("{", version),
      page.indexOf("},\n            {", version),
    );

    expect(version).toBeGreaterThan(status);
    expect(page.indexOf('title: "Labels"')).toBeGreaterThan(version);
    expect(column).toContain("reportedVersion: true");
    expect(column).toContain("disableSort: true");
    expect(page.slice(version, version + 600)).toContain(
      '<ProbeVersionElement probe={item} variant="cell" />',
    );
  });
});
