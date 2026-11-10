import { beforeEach, describe, expect, test } from "@jest/globals";
import Dictionary from "Common/Types/Dictionary";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import {
  DiscoveredDeviceListResponse,
  DiscoveredDeviceShow,
  DiscoveredDeviceSort,
} from "Common/Types/NetworkDevice/DiscoveredDevice";
import {
  DiscoveryImportAlerting,
  DiscoveryImportSource,
  DiscoveryImportStatus,
  DiscoveryImportView,
} from "Common/Types/NetworkDevice/DiscoveryImport";

/*
 * The Discovered Devices list's calls (issue #5775): the routes and bodies
 * the page sends, with the project's headers, what it makes of the answers,
 * and that a refusal is thrown so the page shows the server's words. Adding
 * rows to monitoring is an import with no scan, started from its own
 * route; the scans table's index of running imports leaves those out, and
 * the list's strip reads them. The browser-bound modules are mocked:
 * Common/UI/Config reads `window` at import time.
 */
jest.mock("Common/UI/Config", () => {
  const { default: MockURL } = jest.requireActual("Common/Types/API/URL") as {
    default: { fromString: (value: string) => unknown };
  };
  return {
    __esModule: true,
    APP_API_URL: MockURL.fromString("http://localhost/api"),
  };
});

jest.mock("Common/UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: jest.fn(),
    },
  };
});

jest.mock("Common/UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      get: jest.fn(),
      post: jest.fn(),
    },
  };
});

import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import {
  DISCOVERED_DEVICE_ROUTES,
  hideDiscoveredDevicesFromMap,
  listDiscoveredDevices,
  selectAllDiscoveredDevices,
  showDiscoveredDevicesOnMap,
  showEverythingOnMap,
  toListRequestBody,
} from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/DiscoveredDevices/DiscoveredDeviceApi";
import {
  DISCOVERY_IMPORT_ROUTES,
  startDiscoveredDeviceImport,
} from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/DiscoveryImport/DiscoveryImportApi";
import {
  getActiveDiscoveredDeviceImports,
  indexActiveImportsByScan,
} from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/DiscoveryImport/DiscoveryImportActive";

const postMock: jest.Mock = API.post as unknown as jest.Mock;
const getCommonHeadersMock: jest.Mock =
  ModelAPI.getCommonHeaders as unknown as jest.Mock;

const TENANT_HEADERS: Dictionary<string> = {
  tenantid: "3f1b6b0e-0000-4000-8000-0000000000aa",
};

const SITE_ID: string = "2b3c4d5e-6f70-4182-9a3b-4c5d6e7f8091";
const ID_A: string = "6d0f2b52-3c1e-4b8a-9f4e-1a2b3c4d5e6f";
const ID_B: string = "7e1a3c63-4d2f-4c9b-8a5f-2b3c4d5e6f70";
const IMPORT_ID: string = "5c6d7e8f-0a1b-4c2d-8e3f-4a5b6c7d8e9f";
const SCAN_ID: string = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";

interface CallOptions {
  url: URL;
  data?: JSONObject;
  headers: Dictionary<string>;
}

function lastCall(): CallOptions {
  const calls: Array<Array<unknown>> = postMock.mock.calls as Array<
    Array<unknown>
  >;
  return calls[calls.length - 1]![0] as CallOptions;
}

function ok(body: JSONObject): HTTPResponse<JSONObject> {
  return new HTTPResponse<JSONObject>(200, body, {});
}

function refused(status: number, message: string): HTTPErrorResponse {
  return new HTTPErrorResponse(status, { message: message }, {});
}

beforeEach(() => {
  postMock.mockReset();
  getCommonHeadersMock.mockReset();
  getCommonHeadersMock.mockReturnValue(TENANT_HEADERS);
});

describe("the routes", () => {
  test("are the list's, under the network discovered device API", () => {
    expect(DISCOVERED_DEVICE_ROUTES).toEqual({
      list: "/network-discovered-device/list",
      ids: "/network-discovered-device/ids",
      hideFromMap: "/network-discovered-device/hide-from-map",
      showOnMap: "/network-discovered-device/show-on-map",
      showEverythingOnMap: "/network-discovered-device/show-everything-on-map",
    });
    expect(DISCOVERY_IMPORT_ROUTES.startFromDiscoveredDevices).toBe(
      "/network-device-discovery-import/start-from-discovered-devices",
    );
  });
});

describe("what a list request sends", () => {
  test("the search, the choice and the sort, always", () => {
    expect(
      toListRequestBody({
        search: "",
        show: DiscoveredDeviceShow.NotMonitored,
        sort: DiscoveredDeviceSort.LastSeen,
        sortOrder: "desc",
      }),
    ).toEqual({
      search: "",
      show: "notMonitored",
      sort: "lastSeen",
      sortOrder: "desc",
    });
  });

  test("a site, a page size and an offset only when there is one", () => {
    expect(
      toListRequestBody({
        search: "printer",
        show: DiscoveredDeviceShow.All,
        siteId: SITE_ID,
        sort: DiscoveredDeviceSort.IpAddress,
        sortOrder: "asc",
        limit: 25,
        skip: 0,
      }),
    ).toEqual({
      search: "printer",
      show: "all",
      siteId: SITE_ID,
      sort: "ipAddress",
      sortOrder: "asc",
      limit: 25,
      skip: 0,
    });
  });
});

describe("listing a page", () => {
  test("posts the request with the project's headers, and reads the rows and counts", async () => {
    postMock.mockResolvedValue(
      ok({
        rows: [
          {
            id: ID_A,
            name: "printer-2f",
            macAddress: "aa:bb:cc:00:11:22",
            ipAddress: "10.20.0.15",
            isSeenRecently: true,
            isFromController: false,
            isHidden: true,
          },
          // A row with no id names nothing a bulk action could act on.
          { name: "no id" },
        ],
        count: 41,
        counts: { all: 50, notMonitored: 41, monitored: 9, hidden: 3 },
      }),
    );

    const page: DiscoveredDeviceListResponse = await listDiscoveredDevices({
      search: "printer",
      show: DiscoveredDeviceShow.NotMonitored,
      siteId: SITE_ID,
      sort: DiscoveredDeviceSort.Name,
      sortOrder: "asc",
      limit: 25,
      skip: 25,
    });

    expect(lastCall().url.toString()).toBe(
      "http://localhost/api/network-discovered-device/list",
    );
    expect(lastCall().headers).toEqual(TENANT_HEADERS);
    expect(lastCall().data).toEqual({
      search: "printer",
      show: "notMonitored",
      siteId: SITE_ID,
      sort: "name",
      sortOrder: "asc",
      limit: 25,
      skip: 25,
    });
    expect(page.count).toBe(41);
    expect(page.counts).toEqual({
      all: 50,
      notMonitored: 41,
      monitored: 9,
      hidden: 3,
    });
    expect(page.rows).toHaveLength(1);
    expect(page.rows[0]).toMatchObject({
      id: ID_A,
      name: "printer-2f",
      ipAddress: "10.20.0.15",
      isHidden: true,
    });
  });

  test("a refusal is thrown as it came, so the page shows the server's words", async () => {
    postMock.mockResolvedValue(
      refused(400, "Search for at most 6 words at a time."),
    );

    await expect(
      listDiscoveredDevices({
        search: "a b c d e f g",
        show: DiscoveredDeviceShow.All,
        sort: DiscoveredDeviceSort.LastSeen,
        sortOrder: "desc",
        limit: 25,
        skip: 0,
      }),
    ).rejects.toBeInstanceOf(HTTPErrorResponse);
  });

  test("an empty answer is an empty page, never an error", async () => {
    postMock.mockResolvedValue(new HTTPResponse<JSONObject>(200, {}, {}));

    const page: DiscoveredDeviceListResponse = await listDiscoveredDevices({
      search: "",
      show: DiscoveredDeviceShow.All,
      sort: DiscoveredDeviceSort.LastSeen,
      sortOrder: "desc",
      limit: 25,
      skip: 0,
    });

    expect(page).toEqual({
      rows: [],
      count: 0,
      counts: { all: 0, notMonitored: 0, monitored: 0, hidden: 0 },
    });
  });
});

describe("selecting every matching row", () => {
  test("posts the search without a page, and reads the named rows once each", async () => {
    postMock.mockResolvedValue(
      ok({
        devices: [
          { id: ID_A, name: "printer-2f", ipAddress: "10.20.0.15" },
          { id: ID_A, name: "printer-2f again" },
          { id: ID_B, name: "camera-lobby", isMonitored: true },
        ],
        count: 2,
      }),
    );

    const selected: Awaited<ReturnType<typeof selectAllDiscoveredDevices>> =
      await selectAllDiscoveredDevices({
        search: "",
        show: DiscoveredDeviceShow.All,
        sort: DiscoveredDeviceSort.LastSeen,
        sortOrder: "desc",
      });

    expect(lastCall().url.toString()).toBe(
      "http://localhost/api/network-discovered-device/ids",
    );
    expect(lastCall().data).toEqual({
      search: "",
      show: "all",
      sort: "lastSeen",
      sortOrder: "desc",
    });
    expect(selected).toEqual({
      devices: [
        { id: ID_A, name: "printer-2f", ipAddress: "10.20.0.15" },
        { id: ID_B, name: "camera-lobby", isMonitored: true },
      ],
      count: 2,
    });
  });
});

describe("hiding and showing on the map", () => {
  test("Hide from map posts the selected ids and reads what was done to each", async () => {
    postMock.mockResolvedValue(
      ok({
        changedIds: [ID_A],
        unchangedIds: [],
        monitoredIds: [ID_B],
        notFoundIds: [],
      }),
    );

    expect(await hideDiscoveredDevicesFromMap([ID_A, ID_B])).toEqual({
      changedIds: [ID_A],
      unchangedIds: [],
      monitoredIds: [ID_B],
      notFoundIds: [],
    });
    expect(lastCall().url.toString()).toBe(
      "http://localhost/api/network-discovered-device/hide-from-map",
    );
    expect(lastCall().data).toEqual({ endpointIds: [ID_A, ID_B] });
    expect(lastCall().headers).toEqual(TENANT_HEADERS);
  });

  test("Show on map posts the selected ids, and an answer that names nothing names nothing", async () => {
    postMock.mockResolvedValue(ok({ changedIds: "not a list" }));

    expect(await showDiscoveredDevicesOnMap([ID_A])).toEqual({
      changedIds: [],
      unchangedIds: [],
      monitoredIds: [],
      notFoundIds: [],
    });
    expect(lastCall().url.toString()).toBe(
      "http://localhost/api/network-discovered-device/show-on-map",
    );
    expect(lastCall().data).toEqual({ endpointIds: [ID_A] });
  });

  test("a refused hide is thrown", async () => {
    postMock.mockResolvedValue(
      refused(403, "You may not hide nodes from the topology map."),
    );

    await expect(hideDiscoveredDevicesFromMap([ID_A])).rejects.toMatchObject({
      message: "You may not hide nodes from the topology map.",
    });
  });

  test("the map's Show them is one request, answered with how many came back", async () => {
    postMock.mockResolvedValue(ok({ changed: 1204 }));

    expect(await showEverythingOnMap()).toBe(1204);
    expect(lastCall().url.toString()).toBe(
      "http://localhost/api/network-discovered-device/show-everything-on-map",
    );
    expect(lastCall().data).toEqual({});
    expect(postMock).toHaveBeenCalledTimes(1);
  });

  test("an answer with no count, or a nonsense one, is none", async () => {
    for (const changed of [undefined, "many", -3, Number.NaN]) {
      postMock.mockResolvedValue(
        ok(changed === undefined ? {} : { changed: changed as never }),
      );
      expect(await showEverythingOnMap()).toBe(0);
    }

    postMock.mockResolvedValue(ok({ changed: 2.7 }));
    expect(await showEverythingOnMap()).toBe(2);
  });
});

describe("adding rows to monitoring", () => {
  test("posts the rows and the settings to the list's own import route", async () => {
    postMock.mockResolvedValue(
      ok({
        // The server writes an import with no scan as an empty scan id.
        import: {
          id: IMPORT_ID,
          scanId: "",
          source: DiscoveryImportSource.DiscoveredDevices,
          status: DiscoveryImportStatus.Queued,
          settings: {
            pollingIntervalInMinutes: 5,
            applyVendorTemplates: true,
            alerting: DiscoveryImportAlerting.None,
          },
          progress: { hosts: 2, hostsDone: 0, devicesCreated: 0 },
          createdAt: "2026-11-09T09:00:00.000Z",
          isMine: true,
        },
      }),
    );

    const view: DiscoveryImportView = await startDiscoveredDeviceImport({
      endpointIds: [ID_A, ID_B],
      settings: {
        pollingIntervalInMinutes: 5,
        applyVendorTemplates: true,
        alerting: DiscoveryImportAlerting.None,
      },
    });

    expect(lastCall().url.toString()).toBe(
      "http://localhost/api/network-device-discovery-import/start-from-discovered-devices",
    );
    expect(lastCall().headers).toEqual(TENANT_HEADERS);
    expect(lastCall().data).toEqual({
      endpointIds: [ID_A, ID_B],
      settings: {
        pollingIntervalInMinutes: 5,
        applyVendorTemplates: true,
        alerting: DiscoveryImportAlerting.None,
      },
    });
    expect(view.id).toBe(IMPORT_ID);
    expect(view.scanId).toBe("");
    expect(view.source).toBe(DiscoveryImportSource.DiscoveredDevices);
    expect(view.progress.hosts).toBe(2);
  });

  test("a refusal - a duplicate, say - is thrown with the server's words", async () => {
    postMock.mockResolvedValue(
      refused(
        400,
        "Every selected device is monitored already: there is nothing to add.",
      ),
    );

    await expect(
      startDiscoveredDeviceImport({
        endpointIds: [ID_A],
        settings: {
          pollingIntervalInMinutes: 5,
          applyVendorTemplates: true,
          alerting: DiscoveryImportAlerting.None,
        },
      }),
    ).rejects.toMatchObject({
      message:
        "Every selected device is monitored already: there is nothing to add.",
    });
  });
});

describe("the running imports each page reads", () => {
  function view(overrides: Partial<DiscoveryImportView>): DiscoveryImportView {
    return {
      id: IMPORT_ID,
      status: DiscoveryImportStatus.Running,
      settings: {
        pollingIntervalInMinutes: 5,
        applyVendorTemplates: true,
        alerting: DiscoveryImportAlerting.None,
      },
      progress: { hosts: 2, hostsDone: 1, devicesCreated: 1 },
      createdAt: "2026-11-09T09:00:00.000Z",
      isMine: true,
      ...overrides,
    } as DiscoveryImportView;
  }

  const fromList: DiscoveryImportView = view({
    id: "a1",
    scanId: "",
    source: DiscoveryImportSource.DiscoveredDevices,
  });
  const fromListDone: DiscoveryImportView = view({
    id: "a2",
    scanId: "",
    source: DiscoveryImportSource.DiscoveredDevices,
    status: DiscoveryImportStatus.Completed,
  });
  const fromScan: DiscoveryImportView = view({ id: "s1", scanId: SCAN_ID });

  test("the scans table indexes only the imports of a scan", () => {
    const byScanId: Map<string, DiscoveryImportView> = indexActiveImportsByScan(
      [fromList, fromScan],
    );

    expect(Array.from(byScanId.keys())).toEqual([SCAN_ID]);
    expect(byScanId.get(SCAN_ID)?.id).toBe("s1");
  });

  test("the Discovered Devices list reads the active imports with no scan, oldest first", () => {
    const second: DiscoveryImportView = view({
      id: "a3",
      scanId: "",
      source: DiscoveryImportSource.DiscoveredDevices,
      status: DiscoveryImportStatus.Queued,
    });

    expect(
      getActiveDiscoveredDeviceImports([
        fromList,
        fromScan,
        fromListDone,
        second,
      ]).map((active: DiscoveryImportView): string => {
        return active.id;
      }),
    ).toEqual(["a1", "a3"]);
  });
});
