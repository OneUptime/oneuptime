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
import React from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * A data store's Overview, with the store, its probe and the project's
 * Data Security settings as the server answers them (OneUptime issue
 * #8042). "Next Content Scan" read nextContentScanAt as a date, and for a
 * store nothing may scan the probe's claim moves that a quarter of an hour
 * on, again and again: the page said "in 17 minutes" for a scan that never
 * came. Scan Now said a scan had started for such a store.
 *
 * Only the network and the signed-in user's permissions are stubbed.
 */

const getItemMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
const scanNowMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return getItemMock(...args);
      },
      getList: (...args: Array<unknown>): unknown => {
        return getListMock(...args);
      },
      count: async (): Promise<number> => {
        return 0;
      },
      getCommonHeaders: (): Record<string, string> => {
        return {};
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/DataSecurity/DataSecurityApi",
  () => {
    return {
      __esModule: true,
      default: {
        scanNow: (...args: Array<unknown>): unknown => {
          return scanNowMock(...args);
        },
        checkNow: async (): Promise<void> => {
          return undefined;
        },
      },
    };
  },
);

let permissionsForTest: Array<string> = [];

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<string> => {
        return permissionsForTest;
      },
      getProjectPermissions: (): null => {
        return null;
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

import DataStoreOverview from "../../../../App/FeatureSet/Dashboard/src/Pages/DataSecurity/StoreView/Overview";
import DataSecuritySetting from "../../../Models/DatabaseModels/DataSecuritySetting";
import DataStore from "../../../Models/DatabaseModels/DataStore";
import Probe, {
  ProbeConnectionStatus,
} from "../../../Models/DatabaseModels/Probe";
import OneUptimeDate from "../../../Types/Date";
import {
  DataStoreKind,
  DataStoreProvider,
} from "../../../Types/DataSecurity/DataStoreKind";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import PermissionGate from "../../../UI/Utils/PermissionGate";

const STORE_ID: string = "8a8a8a8a-0000-4000-8000-000000000001";
const PROJECT_ID: string = "8a8a8a8a-0000-4000-8000-000000000002";
const PROBE_ID: string = "8a8a8a8a-0000-4000-8000-000000000003";
const MINUTE_IN_MS: number = 60 * 1000;

let storeColumns: Record<string, unknown> = {};
let probeRead: Probe | null = null;
let settingRead: DataSecuritySetting | null = null;
let isSettingReadRefused: boolean = false;

function storeOf(): DataStore {
  const store: DataStore = new DataStore();
  store._id = STORE_ID;
  Object.assign(store, storeColumns);
  return store;
}

function probeOf(overrides: Partial<Probe> = {}): Probe {
  const probe: Probe = new Probe();
  probe._id = PROBE_ID;
  probe.name = "Datacenter probe";
  probe.isGlobalProbe = false;
  probe.projectId = new ObjectID(PROJECT_ID);
  probe.connectionStatus = ProbeConnectionStatus.Connected;
  Object.assign(probe, overrides);
  return probe;
}

function settingOf(
  overrides: Partial<DataSecuritySetting>,
): DataSecuritySetting {
  const setting: DataSecuritySetting = new DataSecuritySetting();
  setting._id = "8a8a8a8a-0000-4000-8000-000000000004";
  setting.projectId = new ObjectID(PROJECT_ID);
  Object.assign(setting, overrides);
  return setting;
}

// A PostgreSQL database the project's own probe scans, due in half an hour.
const PROBE_STORE: Record<string, unknown> = {
  name: "orders-db",
  kind: DataStoreKind.PostgreSql,
  provider: DataStoreProvider.SelfManaged,
  projectId: new ObjectID(PROJECT_ID),
  isContentScanEnabled: true,
  isArchived: false,
  scanProbeId: new ObjectID(PROBE_ID),
  probeConnectionVariable: "ORDERS_DB_URL",
  findingCount: 0,
  openIssueCount: 0,
  riskScore: 0,
};

async function flush(): Promise<void> {
  await act(async () => {
    for (let index: number = 0; index < 20; index++) {
      await Promise.resolve();
    }
  });
}

async function renderOverview(): Promise<void> {
  render(
    <MemoryRouter initialEntries={[`/data-stores/${STORE_ID}`]}>
      <Routes>
        <Route
          path="/data-stores/:id"
          element={
            <DataStoreOverview
              pageRoute={undefined as never}
              currentProject={null}
              hasPaymentMethod={true}
            />
          }
        />
      </Routes>
    </MemoryRouter>,
  );
  await flush();
}

function nextScanField(): HTMLElement {
  return screen.getByTestId("data-store-next-content-scan");
}

function scanNowButton(): HTMLElement {
  return screen.getByRole("button", { name: /Scan Now/ });
}

beforeEach(() => {
  permissionsForTest = [Permission.ProjectAdmin];
  PermissionGate.clearPermissionPropsCache();
  storeColumns = {
    ...PROBE_STORE,
    nextContentScanAt: new Date(Date.now() + 30 * MINUTE_IN_MS),
  };
  probeRead = probeOf();
  settingRead = null;
  isSettingReadRefused = false;

  getItemMock.mockReset();
  getItemMock.mockImplementation(async (data: unknown): Promise<unknown> => {
    const modelType: unknown = (data as { modelType: unknown }).modelType;

    if (modelType === Probe) {
      return probeRead;
    }

    return storeOf();
  });

  getListMock.mockReset();
  getListMock.mockImplementation(async (data: unknown): Promise<unknown> => {
    const modelType: unknown = (data as { modelType: unknown }).modelType;

    if (modelType === DataSecuritySetting) {
      if (isSettingReadRefused) {
        throw new Error("You may not read Data Security's settings.");
      }

      return {
        data: settingRead ? [settingRead] : [],
        count: settingRead ? 1 : 0,
        skip: 0,
        limit: 1,
      };
    }

    return { data: [], count: 0, skip: 0, limit: 0 };
  });

  scanNowMock.mockReset();
  scanNowMock.mockImplementation(async (): Promise<void> => {
    return undefined;
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("a data store's Overview: Next Content Scan", () => {
  test("due later, with the project's own connected probe: the time it is due", async () => {
    await renderOverview();

    const dueAt: Date = storeColumns["nextContentScanAt"] as Date;

    expect(nextScanField().querySelector("time")).toHaveAttribute(
      "dateTime",
      dueAt.toISOString(),
    );
    expect(nextScanField()).toHaveTextContent(
      OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(dueAt, false),
    );
    expect(scanNowButton()).not.toBeDisabled();
  });

  test("it reads what decides it: the store's columns, its probe and the project's settings", async () => {
    await renderOverview();

    const storeRead: { select: Record<string, unknown> } =
      getItemMock.mock.calls
        .map((call: Array<unknown>) => {
          return call[0] as {
            modelType: unknown;
            select: Record<string, unknown>;
          };
        })
        .find((call: { modelType: unknown }) => {
          return call.modelType === DataStore;
        })!;

    for (const column of [
      "projectId",
      "kind",
      "provider",
      "isContentScanEnabled",
      "isArchived",
      "scanProbeId",
      "probeConnectionVariable",
      "nextContentScanAt",
    ]) {
      expect(storeRead.select[column]).toBe(true);
    }

    expect(
      getItemMock.mock.calls.some((call: Array<unknown>) => {
        return (call[0] as { modelType: unknown }).modelType === Probe;
      }),
    ).toBe(true);
    expect(
      getListMock.mock.calls.some((call: Array<unknown>) => {
        return (
          (call[0] as { modelType: unknown }).modelType === DataSecuritySetting
        );
      }),
    ).toBe(true);
  });

  test("content scanning off for the store, due again in 17 minutes as the set-aside leaves it: Off, and no time", async () => {
    const setAsideUntil: Date = new Date(Date.now() + 17 * MINUTE_IN_MS);

    storeColumns = {
      ...PROBE_STORE,
      isContentScanEnabled: false,
      nextContentScanAt: setAsideUntil,
    };

    await renderOverview();

    expect(nextScanField().querySelector("time")).toBeNull();
    expect(nextScanField()).toHaveTextContent("Off");
    expect(nextScanField()).toHaveTextContent(
      "Content scanning is off for this store. Turn it on in its Settings.",
    );
    expect(nextScanField()).not.toHaveTextContent(
      OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
        setAsideUntil,
        false,
      ),
    );
    expect(scanNowButton()).toBeDisabled();
  });

  test("never scanned and nothing will scan it: What's Inside says why, not 'not scanned yet'", async () => {
    storeColumns = {
      ...PROBE_STORE,
      isArchived: true,
      nextContentScanAt: new Date(Date.now() + 17 * MINUTE_IN_MS),
    };

    await renderOverview();

    expect(
      screen.queryByText("Its content has not been scanned yet."),
    ).toBeNull();
    expect(
      screen.getAllByText(
        "A store that is no longer found is not scanned. It is scanned again once it is found.",
      ).length,
    ).toBeGreaterThan(0);
  });

  test("never scanned, with a probe able to take it: due now, and 'not scanned yet'", async () => {
    storeColumns = { ...PROBE_STORE, nextContentScanAt: undefined };

    await renderOverview();

    expect(nextScanField()).toHaveTextContent("Due now");
    expect(
      screen.getByText("Its content has not been scanned yet."),
    ).toBeInTheDocument();
  });

  test("overdue, with a probe able to take it: overdue, and which probe to check", async () => {
    storeColumns = {
      ...PROBE_STORE,
      nextContentScanAt: new Date(Date.now() - 180 * MINUTE_IN_MS),
    };

    await renderOverview();

    expect(nextScanField()).toHaveTextContent("Overdue");
    expect(nextScanField()).toHaveTextContent(
      "Check that Datacenter probe is connected and up to date.",
    );
    expect(scanNowButton()).not.toBeDisabled();
  });

  test("content scanning off for the project: Off, from the project's settings", async () => {
    settingRead = settingOf({ isContentScanEnabled: false });

    await renderOverview();

    expect(nextScanField()).toHaveTextContent("Off");
    expect(nextScanField()).toHaveTextContent(
      "Content scanning is off for this project. Turn it on in Data Security's Settings.",
    );
    expect(scanNowButton()).toBeDisabled();
  });

  test("settings the reader may not read: the defaults, and the page still loads", async () => {
    isSettingReadRefused = true;

    await renderOverview();

    expect(nextScanField().querySelector("time")).not.toBeNull();
  });

  test("a probe the project's probes do not hold: not scanned, and why", async () => {
    probeRead = null;

    await renderOverview();

    expect(nextScanField()).toHaveTextContent("Not scanned");
    expect(nextScanField()).toHaveTextContent(
      "Only a probe of this project's own scans a store. Pick one in its Settings.",
    );
    expect(scanNowButton()).toBeDisabled();
  });

  test("a reader who may not read probes: nothing is said of the probe", async () => {
    permissionsForTest = [Permission.SecurityViewer];
    PermissionGate.clearPermissionPropsCache();
    probeRead = null;

    await renderOverview();

    expect(
      getItemMock.mock.calls.some((call: Array<unknown>) => {
        return (call[0] as { modelType: unknown }).modelType === Probe;
      }),
    ).toBe(false);
    expect(nextScanField().querySelector("time")).not.toBeNull();
  });

  test("a disconnected probe: waiting, the probe named", async () => {
    probeRead = probeOf({
      connectionStatus: ProbeConnectionStatus.Disconnected,
    });

    await renderOverview();

    expect(nextScanField()).toHaveTextContent("Waiting");
    expect(nextScanField()).toHaveTextContent(
      "Nothing scans this store while Datacenter probe is disconnected.",
    );
  });

  test("no connection variable: not scanned, and what to set", async () => {
    storeColumns = { ...PROBE_STORE, probeConnectionVariable: undefined };

    await renderOverview();

    expect(nextScanField()).toHaveTextContent("Not scanned");
    expect(scanNowButton()).toBeDisabled();
  });

  test("Scan Now on a probe's store says the probe scans it when it next asks for work", async () => {
    await renderOverview();

    await act(async () => {
      fireEvent.click(scanNowButton());
    });
    await flush();

    expect(scanNowMock).toHaveBeenCalledTimes(1);
    expect(
      screen.getByText(
        "The next time Datacenter probe asks for work, it scans this store's content. What it finds shows on What's Inside when it is done.",
      ),
    ).toBeInTheDocument();
  });

  test("Scan Now on a store OneUptime's workers scan says a scan started", async () => {
    storeColumns = {
      name: "exports",
      kind: DataStoreKind.AwsS3Bucket,
      provider: DataStoreProvider.Aws,
      projectId: new ObjectID(PROJECT_ID),
      isContentScanEnabled: true,
      isArchived: false,
      nextContentScanAt: new Date(Date.now() + 30 * MINUTE_IN_MS),
    };

    await renderOverview();

    expect(
      getItemMock.mock.calls.some((call: Array<unknown>) => {
        return (call[0] as { modelType: unknown }).modelType === Probe;
      }),
    ).toBe(false);

    await act(async () => {
      fireEvent.click(scanNowButton());
    });
    await flush();

    expect(
      screen.getByText(
        "A scan of this store's content has started. What it finds shows on What's Inside when it is done.",
      ),
    ).toBeInTheDocument();
  });
});
