import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import React from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * A data store's Settings page, its Content Scans card (OneUptime issue
 * #8322). The card's Scan Content read the kind's info alone, which said
 * OneUptime could not sample SQL Server, so a SQL Server database a probe
 * scanned read "OneUptime cannot sample this kind of store's content yet".
 * It reads the server's rule now (getDataStoreContentScanStop), as the
 * Overview does.
 *
 * Only the network and the signed-in user's permissions are stubbed.
 */

const getItemMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return getItemMock(...args);
      },
      getList: async (): Promise<unknown> => {
        return { data: [], count: 0, skip: 0, limit: 0 };
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

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<string> => {
        return ["ProjectAdmin"];
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

import DataSecurityApi from "../../../../App/FeatureSet/Dashboard/src/Components/DataSecurity/DataSecurityApi";
import DataStoreSettings from "../../../../App/FeatureSet/Dashboard/src/Pages/DataSecurity/StoreView/Settings";
import DataStore from "../../../Models/DatabaseModels/DataStore";
import Probe from "../../../Models/DatabaseModels/Probe";
import {
  DataStoreKind,
  DataStoreProvider,
} from "../../../Types/DataSecurity/DataStoreKind";
import ObjectID from "../../../Types/ObjectID";
import PermissionGate from "../../../UI/Utils/PermissionGate";

const STORE_ID: string = "9b9b9b9b-0000-4000-8000-000000000001";
const PROBE_ID: string = "9b9b9b9b-0000-4000-8000-000000000003";

let storeColumns: Record<string, unknown> = {};

function storeOf(): DataStore {
  const store: DataStore = new DataStore();
  store._id = STORE_ID;
  Object.assign(store, storeColumns);

  if (store.scanProbeId) {
    const probe: Probe = new Probe();
    probe._id = PROBE_ID;
    probe.name = "Datacenter probe";
    store.scanProbe = probe;
  }

  return store;
}

async function renderSettings(): Promise<void> {
  render(
    <MemoryRouter initialEntries={[`/data-stores/${STORE_ID}/settings`]}>
      <Routes>
        <Route
          path="/data-stores/:id/settings"
          element={
            <DataStoreSettings
              pageRoute={undefined as never}
              currentProject={null}
              hasPaymentMethod={true}
            />
          }
        />
      </Routes>
    </MemoryRouter>,
  );

  await act(async () => {
    for (let index: number = 0; index < 20; index++) {
      await Promise.resolve();
    }
  });
}

// What the Content Scans card says under Scan Content.
function scanContent(): HTMLElement {
  const fields: Array<HTMLElement> = screen
    .getAllByTestId("detail-field")
    .filter((field: HTMLElement): boolean => {
      return (
        within(field).queryByTestId("detail-label")?.textContent?.trim() ===
        "Scan Content"
      );
    });

  expect(fields).toHaveLength(1);

  return within(fields[0]!).getByTestId("detail-value");
}

function contentScansRead(): { select: Record<string, unknown> } {
  return getItemMock.mock.calls
    .map((call: Array<unknown>) => {
      return call[0] as { select: Record<string, unknown> };
    })
    .find((call: { select: Record<string, unknown> }) => {
      return Boolean(call.select["scanExclusions"]);
    })!;
}

beforeEach(() => {
  PermissionGate.clearPermissionPropsCache();
  storeColumns = {};
  getItemMock.mockReset();
  getItemMock.mockImplementation(async (): Promise<unknown> => {
    return storeOf();
  });
  // Settings' record of processing (#10375): this store is not in it.
  jest
    .spyOn(DataSecurityApi, "getRecordOfProcessing")
    .mockResolvedValue({ rows: [] });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

const UNSAMPLED: string =
  "OneUptime cannot sample this kind of store's content yet.";
const NOT_FROM_A_PROBE: string =
  "A probe scans only stores you run: PostgreSQL, MySQL, SQL Server, Elasticsearch and OpenSearch. Scan this store from OneUptime's workers in its Settings.";

describe("a data store's Settings: Scan Content", () => {
  test("the card reads what decides it: the store's kind, provider and scan probe", async () => {
    storeColumns = {
      kind: DataStoreKind.AwsS3Bucket,
      provider: DataStoreProvider.Aws,
      isContentScanEnabled: true,
    };

    await renderSettings();

    const read: { select: Record<string, unknown> } = contentScansRead();

    expect(read.select["isContentScanEnabled"]).toBe(true);
    expect(read.select["kind"]).toBe(true);
    expect(read.select["provider"]).toBe(true);
    expect(read.select["scanProbeId"]).toBe(true);
  });

  test.each([
    [
      "a SQL Server database a probe scans (#8322)",
      {
        kind: DataStoreKind.SqlServer,
        provider: DataStoreProvider.SelfManaged,
        scanProbeId: new ObjectID(PROBE_ID),
        probeConnectionVariable: "ORDERS_DB_URL",
        isContentScanEnabled: true,
      },
      "Yes",
    ],
    [
      "a SQL Server database OneUptime's workers scan (#8322)",
      {
        kind: DataStoreKind.SqlServer,
        provider: DataStoreProvider.SelfManaged,
        isContentScanEnabled: true,
      },
      "Yes",
    ],
    [
      "a SQL Server database with its switch off",
      {
        kind: DataStoreKind.SqlServer,
        provider: DataStoreProvider.SelfManaged,
        isContentScanEnabled: false,
      },
      "No",
    ],
    [
      "an S3 bucket",
      {
        kind: DataStoreKind.AwsS3Bucket,
        provider: DataStoreProvider.Aws,
        isContentScanEnabled: true,
      },
      "Yes",
    ],
    [
      "a service's logs with their switch off, which the telemetry scan now honours (#8323)",
      {
        kind: DataStoreKind.TelemetryLogs,
        provider: DataStoreProvider.OneUptime,
        isContentScanEnabled: false,
      },
      "No",
    ],
    [
      "a MongoDB database, which nothing samples",
      {
        kind: DataStoreKind.MongoDb,
        provider: DataStoreProvider.SelfManaged,
        isContentScanEnabled: true,
      },
      UNSAMPLED,
    ],
    [
      // Nothing samples it, a probe no more than a worker (#11140).
      "a MongoDB database set to scan from a probe",
      {
        kind: DataStoreKind.MongoDb,
        provider: DataStoreProvider.SelfManaged,
        scanProbeId: new ObjectID(PROBE_ID),
        isContentScanEnabled: true,
      },
      UNSAMPLED,
    ],
    [
      "an S3 bucket set to scan from a probe",
      {
        kind: DataStoreKind.AwsS3Bucket,
        provider: DataStoreProvider.Aws,
        scanProbeId: new ObjectID(PROBE_ID),
        isContentScanEnabled: true,
      },
      NOT_FROM_A_PROBE,
    ],
    [
      "a DynamoDB table, its switch off: still a kind nothing samples",
      {
        kind: DataStoreKind.AwsDynamoDbTable,
        provider: DataStoreProvider.Aws,
        isContentScanEnabled: false,
      },
      UNSAMPLED,
    ],
  ])(
    "%s",
    async (_name: string, columns: Record<string, unknown>, shown: string) => {
      storeColumns = columns;

      await renderSettings();

      expect(scanContent()).toHaveTextContent(shown);
    },
  );
});
