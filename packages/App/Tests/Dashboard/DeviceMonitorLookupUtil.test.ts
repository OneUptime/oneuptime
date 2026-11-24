import { beforeEach, describe, expect, test } from "@jest/globals";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import Includes from "Common/Types/BaseDatabase/Includes";
import Search from "Common/Types/BaseDatabase/Search";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import Dictionary from "Common/Types/Dictionary";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";

/*
 * The module imports ModelAPI, API and Common/UI/Config, and each of them
 * loads Common/UI/Config, which reads `window` at import time and throws in
 * this node test environment. Mocking them keeps the import graph
 * browser-free and doubles as the seam these tests drive: API.post is the
 * server's answer to "which Network Device monitors watch this device"
 * (NetworkDeviceWatchingMonitorsAPI, issue #8101), ModelAPI.getList the
 * Monitor reads, ModelAPI.getItem the device's own row.
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
      getList: jest.fn(),
      getItem: jest.fn(),
      getCommonHeaders: jest.fn(),
    },
  };
});

jest.mock("Common/UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: jest.fn(),
    },
  };
});

import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import NetworkDeviceMonitoringMethod from "Common/Types/NetworkDevice/NetworkDeviceMonitoringMethod";
import DeviceMonitorLookupUtil, {
  DeviceBinding,
  DeviceMonitorContext,
  NETWORK_DEVICE_UNTIED_MONITORS_ROUTE,
  NETWORK_DEVICE_WATCHING_MONITORS_ROUTE,
  NO_UNTIED_MONITORS,
  UntiedMonitorsListing,
  WATCHING_MONITORS_PER_READ,
  WEB_UI_MONITOR_CANDIDATES_LIMIT,
  getUntiedMonitorsRoute,
  getWatchingMonitorsRoute,
} from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceMonitorLookupUtil";
import { UntiedMonitorMatch } from "Common/Utils/NetworkDevice/UntiedDeviceMonitor";
import { AmbiguousAddressReason } from "Common/Utils/NetworkDevice/DeviceAddressScope";

const getListMock: jest.Mock = ModelAPI.getList as unknown as jest.Mock;
const getItemMock: jest.Mock = ModelAPI.getItem as unknown as jest.Mock;
const getCommonHeadersMock: jest.Mock =
  ModelAPI.getCommonHeaders as unknown as jest.Mock;
const postMock: jest.Mock = API.post as unknown as jest.Mock;

/*
 * The project header ModelAPI stamps on every request: without it the
 * route has no project to read the device in.
 */
const TENANT_HEADERS: Dictionary<string> = {
  tenantid: "3f1b6b0e-0000-4000-8000-0000000000ff",
};

/*
 * What the lookup reads:
 *
 *  - `watchedBy`: the Network Device monitors the server says watch the
 *    device. API.post answers their ids, and the Monitor read by those ids
 *    answers the monitors themselves;
 *  - `madeForDevice`: the monitors a discovery import made for this device
 *    from a Ping, IP, Port, NTP, Website, API or SSL Certificate template
 *    (issues #5145, #9546), found by their provenance;
 *  - `tiedToDevice`: the monitors a person made and tied to this device
 *    (issue #9545), found by that tie.
 */
let watchedBy: Array<Monitor> = [];
let madeForDevice: Array<Monitor> = [];
let tiedToDevice: Array<Monitor> = [];

function isMadeForDeviceQuery(request: {
  query?: Record<string, unknown>;
}): boolean {
  return Boolean(
    request.query && "autoProvisionedNetworkDeviceId" in request.query,
  );
}

function isTiedToDeviceQuery(request: {
  query?: Record<string, unknown>;
}): boolean {
  return Boolean(request.query && "networkDeviceId" in request.query);
}

// The Monitor read of the watching monitors, by the ids the server named.
function isWatchingQuery(request: {
  query?: Record<string, unknown>;
}): boolean {
  return Boolean(request.query && "_id" in request.query);
}

function idsOf(request: { query?: Record<string, unknown> }): Array<string> {
  return ((request.query!["_id"] as Includes).values as Array<string>).map(
    (id: string): string => {
      return id.toString();
    },
  );
}

function answerWatchingIds(ids: Array<unknown>): void {
  postMock.mockResolvedValue(
    new HTTPResponse<JSONObject>(200, { monitorIds: ids } as JSONObject, {}),
  );
}

// The server names `monitors`, and the Monitor read by id answers them.
function answerWatching(monitors: Array<Monitor>): void {
  watchedBy = monitors;
  answerWatchingIds(
    monitors.map((monitor: Monitor): string => {
      return monitor._id!.toString();
    }),
  );
}

function answerLists(): void {
  getListMock.mockImplementation(
    async (request: { query?: Record<string, unknown> }) => {
      if (isMadeForDeviceQuery(request)) {
        return {
          data: madeForDevice,
          count: madeForDevice.length,
          skip: 0,
          limit: 100,
        };
      }

      if (isTiedToDeviceQuery(request)) {
        return {
          data: tiedToDevice,
          count: tiedToDevice.length,
          skip: 0,
          limit: 100,
        };
      }

      if (isWatchingQuery(request)) {
        const asked: Array<string> = idsOf(request);
        const found: Array<Monitor> = watchedBy.filter(
          (monitor: Monitor): boolean => {
            return asked.includes(monitor._id!.toString());
          },
        );
        return { data: found, count: found.length, skip: 0, limit: 100 };
      }

      return { data: [], count: 0, skip: 0, limit: 100 };
    },
  );
}

function watchingReads(): Array<{
  query: Record<string, unknown>;
  limit: number;
  skip: number;
  select: Record<string, unknown>;
  sort: Record<string, unknown>;
}> {
  return getListMock.mock.calls
    .map((call: Array<unknown>) => {
      return call[0] as {
        query: Record<string, unknown>;
        limit: number;
        skip: number;
        select: Record<string, unknown>;
        sort: Record<string, unknown>;
      };
    })
    .filter((request: { query: Record<string, unknown> }): boolean => {
      return isWatchingQuery(request);
    });
}

function resetLookup(): void {
  getListMock.mockReset();
  getItemMock.mockReset();
  postMock.mockReset();
  getCommonHeadersMock.mockReset();
  getCommonHeadersMock.mockReturnValue(TENANT_HEADERS);
  watchedBy = [];
  madeForDevice = [];
  tiedToDevice = [];
  answerWatching([]);
  answerLists();
}

const DEVICE_ID: ObjectID = new ObjectID(
  "3f1b6b0e-0000-4000-8000-0000000000aa",
);

/*
 * A Network Device monitor as the read by id answers it: the card's columns,
 * no steps - the server already said it watches the device.
 */
function networkDeviceMonitor(id: string, name: string): Monitor {
  const monitor: Monitor = new Monitor();
  monitor._id = id;
  monitor.name = name;
  monitor.monitorType = MonitorType.NetworkDevice;
  return monitor;
}

/**
 * A monitor as the BOUND-monitor read returns it: an ordinary Ping monitor
 * with no steps referencing any device. This is the shape the old lookup
 * could never find, which is what #3447 is about.
 */
function boundPingMonitor(id: string, name: string): Monitor {
  const monitor: Monitor = new Monitor();
  monitor._id = id;
  monitor.name = name;
  monitor.monitorType = MonitorType.Ping;
  return monitor;
}

/** The device read that getDeviceBinding performs. */
function deviceRow(data: {
  monitoringMethod?: string | undefined;
  monitor?: Monitor | undefined;
  name?: string | undefined;
  hostname?: string | undefined;
}): NetworkDevice {
  const device: NetworkDevice = new NetworkDevice();

  if (data.name !== undefined) {
    device.name = data.name;
  }

  if (data.hostname !== undefined) {
    device.hostname = data.hostname;
  }

  /*
   * Assigned only when present: the project compiles with
   * exactOptionalPropertyTypes, so writing an explicit `undefined` into an
   * optional property is an error rather than a no-op.
   */
  if (data.monitoringMethod !== undefined) {
    device.monitoringMethod = data.monitoringMethod;
  }

  if (data.monitor !== undefined) {
    device.monitor = data.monitor;
  }

  return device;
}

function monitorWithSteps(steps: Array<MonitorStep>): Monitor {
  const monitor: Monitor = new Monitor();
  const monitorSteps: MonitorSteps = new MonitorSteps();
  monitorSteps.data = { monitorStepsInstanceArray: steps };
  monitor.monitorSteps = monitorSteps;
  return monitor;
}

/*
 * Which Network Device monitors watch the device, as the server answers
 * (POST /network-device/:id/watching-monitors, issue #8101): the request,
 * and what is made of its answer.
 */
describe("DeviceMonitorLookupUtil.fetchWatchingMonitorIds", () => {
  beforeEach(() => {
    resetLookup();
  });

  test("asks the device's own route, with the project header", async () => {
    await DeviceMonitorLookupUtil.fetchWatchingMonitorIds(DEVICE_ID);

    expect(postMock).toHaveBeenCalledTimes(1);

    const options: {
      url: URL;
      data: JSONObject;
      headers: Dictionary<string>;
    } = postMock.mock.calls[0]![0] as {
      url: URL;
      data: JSONObject;
      headers: Dictionary<string>;
    };

    /*
     * The route the server mounts (NetworkDeviceWatchingMonitorsAPI's
     * WATCHING_MONITORS_PATH, pinned to the same string in its own test).
     */
    expect(NETWORK_DEVICE_WATCHING_MONITORS_ROUTE).toBe(
      "/network-device/:networkDeviceId/watching-monitors",
    );
    expect(getWatchingMonitorsRoute(DEVICE_ID)).toBe(
      `/network-device/${DEVICE_ID.toString()}/watching-monitors`,
    );
    expect(options.url.toString()).toBe(
      `http://localhost/api/network-device/${DEVICE_ID.toString()}/watching-monitors`,
    );
    expect(options.data).toEqual({});
    expect(options.headers).toEqual(TENANT_HEADERS);
  });

  test("answers the ids the server names, each once", async () => {
    answerWatchingIds([
      "9f1b6b0e-0000-4000-8000-00000000aa01",
      "9f1b6b0e-0000-4000-8000-00000000aa02",
      "9f1b6b0e-0000-4000-8000-00000000aa01",
    ]);

    await expect(
      DeviceMonitorLookupUtil.fetchWatchingMonitorIds(DEVICE_ID),
    ).resolves.toEqual([
      "9f1b6b0e-0000-4000-8000-00000000aa01",
      "9f1b6b0e-0000-4000-8000-00000000aa02",
    ]);
  });

  test("an entry that is not an id is dropped, never asked about", async () => {
    answerWatchingIds([
      "9f1b6b0e-0000-4000-8000-00000000aa03",
      "core-sw-01",
      "",
      42,
      null,
      { _id: "9f1b6b0e-0000-4000-8000-00000000aa04" },
    ]);

    await expect(
      DeviceMonitorLookupUtil.fetchWatchingMonitorIds(DEVICE_ID),
    ).resolves.toEqual(["9f1b6b0e-0000-4000-8000-00000000aa03"]);
  });

  test("an answer with no list names no monitor", async () => {
    for (const body of [
      {},
      { monitorIds: "not-a-list" },
      { monitorIds: null },
    ]) {
      postMock.mockResolvedValue(
        new HTTPResponse<JSONObject>(200, body as JSONObject, {}),
      );

      await expect(
        DeviceMonitorLookupUtil.fetchWatchingMonitorIds(DEVICE_ID),
      ).resolves.toEqual([]);
    }
  });

  test("a refused request is thrown, for the card to say so", async () => {
    const refusal: HTTPErrorResponse = new HTTPErrorResponse(
      404,
      { message: "This network device does not exist." },
      {},
    );
    postMock.mockResolvedValue(refusal);

    await expect(
      DeviceMonitorLookupUtil.fetchWatchingMonitorIds(DEVICE_ID),
    ).rejects.toBe(refusal);
  });
});

describe("DeviceMonitorLookupUtil.getMonitorsWatchingDevice", () => {
  beforeEach(() => {
    resetLookup();
    // Default: the device has nothing bound, which is the pre-#3447 world.
    getItemMock.mockResolvedValue(deviceRow({}));
  });

  test("lists the monitors the server says watch the device", async () => {
    const watching: Monitor = networkDeviceMonitor(
      "9f1b6b0e-0000-4000-8000-00000000ab01",
      "core-sw-01 health",
    );
    answerWatching([watching]);

    const result: Array<Monitor> =
      await DeviceMonitorLookupUtil.getMonitorsWatchingDevice(DEVICE_ID);

    expect(result).toEqual([watching]);
  });

  test("reads the watching monitors by id, and the ones made for or tied to this device - never the project's every Network Device monitor", async () => {
    const watching: Monitor = networkDeviceMonitor(
      "9f1b6b0e-0000-4000-8000-00000000ab02",
      "core-sw-01 health",
    );
    answerWatching([watching]);

    await DeviceMonitorLookupUtil.getMonitorsWatchingDevice(DEVICE_ID);

    expect(getListMock).toHaveBeenCalledTimes(3);

    const queries: Array<Record<string, unknown>> = getListMock.mock.calls.map(
      (call: Array<unknown>): Record<string, unknown> => {
        return (call[0] as { query: Record<string, unknown> }).query;
      },
    );

    /*
     * THE REGRESSION (#8101): every Monitor read names the monitors it
     * wants, by id, by provenance or by the device a person tied them to.
     * The project-wide list of Network Device monitors, steps and all, is
     * gone.
     */
    for (const query of queries) {
      expect(
        "_id" in query ||
          "autoProvisionedNetworkDeviceId" in query ||
          "networkDeviceId" in query,
      ).toBe(true);
    }

    const reads: ReturnType<typeof watchingReads> = watchingReads();
    expect(reads).toHaveLength(1);
    expect(reads[0]!.query["_id"]).toBeInstanceOf(Includes);
    expect(idsOf(reads[0]!)).toEqual([watching._id!.toString()]);
    expect(reads[0]!.query["monitorType"]).toBe(MonitorType.NetworkDevice);
    expect(reads[0]!.limit).toBe(1);
    expect(reads[0]!.skip).toBe(0);
    expect(reads[0]!.sort).toEqual({ name: SortOrder.Ascending });
    // The card's columns - no step JSON any more.
    expect(reads[0]!.select["monitorSteps"]).toBeUndefined();
    expect(reads[0]!.select).toMatchObject({
      _id: true,
      name: true,
      monitorType: true,
      networkAlertPolicyId: true,
      currentMonitorStatus: { name: true, color: true },
    });

    const madeFor: Record<string, unknown> | undefined = queries.find(
      (query: Record<string, unknown>): boolean => {
        return "autoProvisionedNetworkDeviceId" in query;
      },
    );
    expect(String(madeFor!["autoProvisionedNetworkDeviceId"])).toBe(
      DEVICE_ID.toString(),
    );
    expect(madeFor!["monitorType"]).toBeInstanceOf(Includes);
    // Every kind an import makes for a device: its address, or a URL on it (#9546).
    expect((madeFor!["monitorType"] as Includes).values).toEqual([
      MonitorType.Ping,
      MonitorType.IP,
      MonitorType.Port,
      MonitorType.NTP,
      MonitorType.Website,
      MonitorType.API,
      MonitorType.SSLCertificate,
    ]);

    /*
     * A monitor a person tied to the device (issue #9545) is read by that
     * tie alone, of whatever kind: a monitor made by hand names the device
     * nowhere in its steps.
     */
    const tied: Record<string, unknown> | undefined = queries.find(
      (query: Record<string, unknown>): boolean => {
        return "networkDeviceId" in query;
      },
    );
    expect(tied).toEqual({ networkDeviceId: DEVICE_ID });
  });

  test("a monitor tied to the device is listed once, beside the ones made for it", async () => {
    const tiedMonitor: Monitor = new Monitor();
    tiedMonitor._id = "9f1b6b0e-0000-4000-8000-00000000ab31";
    tiedMonitor.name = "core-sw-01 ping (by hand)";
    tiedMonitor.monitorType = MonitorType.Ping;
    tiedMonitor.networkDeviceId = DEVICE_ID;

    answerWatching([]);
    tiedToDevice = [tiedMonitor];
    // The made-for read answers the same monitor: listed once all the same.
    madeForDevice = [tiedMonitor];

    const monitors: Array<Monitor> =
      await DeviceMonitorLookupUtil.getMonitorsWatchingDevice(DEVICE_ID);

    expect(
      monitors.map((monitor: Monitor): string => {
        return monitor._id!.toString();
      }),
    ).toEqual([tiedMonitor._id!.toString()]);
  });

  test("a device nothing watches reads no watching monitor at all", async () => {
    answerWatching([]);

    await expect(
      DeviceMonitorLookupUtil.getMonitorsWatchingDevice(DEVICE_ID),
    ).resolves.toEqual([]);

    expect(watchingReads()).toHaveLength(0);
  });

  test("a monitor that sorts past what one list page held is still found (it used to be missed past LIMIT_PER_PROJECT)", async () => {
    /*
     * The old read listed the project's Network Device monitors by name,
     * one page of LIMIT_PER_PROJECT, and kept the ones whose steps named
     * the device: a watcher whose name sorted after the first page's was
     * never seen. The server names it now, so where it would sort in the
     * project no longer matters.
     */
    const lastByName: Monitor = networkDeviceMonitor(
      "9f1b6b0e-0000-4000-8000-00000000ab03",
      "zz-last-by-name",
    );
    answerWatching([lastByName]);

    getListMock.mockImplementation(
      async (request: { query?: Record<string, unknown>; limit: number }) => {
        if (isWatchingQuery(request)) {
          return {
            data: idsOf(request).includes(lastByName._id!.toString())
              ? [lastByName]
              : [],
            count: 1,
            skip: 0,
            limit: request.limit,
          };
        }

        // A project of more Network Device monitors than a page holds.
        if (request.query?.["monitorType"] === MonitorType.NetworkDevice) {
          return {
            data: Array.from({ length: LIMIT_PER_PROJECT }, (): Monitor => {
              return networkDeviceMonitor(
                ObjectID.generate().toString(),
                "aa-earlier",
              );
            }),
            count: LIMIT_PER_PROJECT + 1,
            skip: 0,
            limit: LIMIT_PER_PROJECT,
          };
        }

        return { data: [], count: 0, skip: 0, limit: 100 };
      },
    );

    await expect(
      DeviceMonitorLookupUtil.getMonitorsWatchingDevice(DEVICE_ID),
    ).resolves.toEqual([lastByName]);
  });

  test("a device watched by more monitors than one read names is read in pieces, every one listed, in name order", async () => {
    const count: number = WATCHING_MONITORS_PER_READ + 2;
    const many: Array<Monitor> = Array.from(
      { length: count },
      (_value: unknown, index: number): Monitor => {
        // Named so that name order is the reverse of the server's order.
        return networkDeviceMonitor(
          ObjectID.generate().toString(),
          `watcher-${String(count - index).padStart(4, "0")}`,
        );
      },
    );
    answerWatching(many);

    const result: Array<Monitor> =
      await DeviceMonitorLookupUtil.getMonitorsWatchingDevice(DEVICE_ID);

    expect(
      watchingReads().map(
        (read: { query: Record<string, unknown> }): number => {
          return idsOf(read).length;
        },
      ),
    ).toEqual([WATCHING_MONITORS_PER_READ, 2]);
    expect(result).toHaveLength(count);
    expect(
      result.map((monitor: Monitor): string => {
        return monitor.name!;
      }),
    ).toEqual(
      many
        .map((monitor: Monitor): string => {
          return monitor.name!;
        })
        .sort(),
    );
  });

  test("a failed lookup is thrown, as a failed Monitor list was: the card says so rather than that nothing alerts", async () => {
    const refusal: HTTPErrorResponse = new HTTPErrorResponse(
      500,
      { message: "The server could not answer." },
      {},
    );
    postMock.mockResolvedValue(refusal);

    await expect(
      DeviceMonitorLookupUtil.getMonitorsWatchingDevice(DEVICE_ID),
    ).rejects.toBe(refusal);
  });

  test("a failed read of the watching monitors is thrown too", async () => {
    answerWatching([
      networkDeviceMonitor(
        "9f1b6b0e-0000-4000-8000-00000000ab04",
        "core-sw-01 health",
      ),
    ]);
    getListMock.mockImplementation(
      async (request: { query?: Record<string, unknown> }) => {
        if (isWatchingQuery(request)) {
          throw new Error("You do not have permission to read monitors.");
        }
        return { data: [], count: 0, skip: 0, limit: 100 };
      },
    );

    await expect(
      DeviceMonitorLookupUtil.getDeviceMonitorContext(DEVICE_ID),
    ).rejects.toThrow("You do not have permission to read monitors.");
  });
});

/*
 * The #3447 half of the lookup.
 *
 * A ping-only device imported from a discovery scan is monitor-backed: it has
 * no probe, is never walked, and its health lives entirely in the Monitor
 * bound to it through NetworkDevice.monitorId. That monitor is an ordinary
 * Ping or IP monitor, so it is NOT of type NetworkDevice and its steps say
 * nothing about the device — the project-wide Network Device query can never
 * return it. Before this, the device's own Overview said "No monitors are
 * alerting on this device yet" while the status pill two panels up was green
 * because of the very monitor the card had failed to find.
 */
describe("DeviceMonitorLookupUtil.getDeviceBinding", () => {
  beforeEach(() => {
    resetLookup();
  });

  test("returns the monitor bound to the device", async () => {
    const bound: Monitor = boundPingMonitor(
      "9f1b6b0e-0000-4000-8000-00000000ce01",
      "ping-10.246.174.13",
    );
    getItemMock.mockResolvedValue(
      deviceRow({
        monitoringMethod: NetworkDeviceMonitoringMethod.Monitor,
        monitor: bound,
      }),
    );

    await expect(
      DeviceMonitorLookupUtil.getDeviceBinding(DEVICE_ID),
    ).resolves.toEqual({
      boundMonitor: bound,
      isMonitorBacked: true,
      deviceName: "",
      deviceAddress: "",
    });
  });

  test("reads monitor-backed through the parser, so NULL means SNMP", async () => {
    getItemMock.mockResolvedValue(deviceRow({ monitoringMethod: undefined }));

    const binding: { isMonitorBacked: boolean } =
      await DeviceMonitorLookupUtil.getDeviceBinding(DEVICE_ID);

    /*
     * Every device that predates the monitoringMethod column holds NULL and
     * IS an SNMP device. Defaulting the other way would tell an entire legacy
     * fleet that nothing polls them.
     */
    expect(binding.isMonitorBacked).toBe(false);
  });

  test("a monitor-backed device with nothing bound reports no monitor", async () => {
    getItemMock.mockResolvedValue(
      deviceRow({ monitoringMethod: NetworkDeviceMonitoringMethod.Monitor }),
    );

    await expect(
      DeviceMonitorLookupUtil.getDeviceBinding(DEVICE_ID),
    ).resolves.toEqual({
      boundMonitor: null,
      isMonitorBacked: true,
      deviceName: "",
      deviceAddress: "",
    });
  });

  test("an unreadable device degrades to the pre-existing behaviour rather than throwing", async () => {
    getItemMock.mockRejectedValue(new Error("forbidden"));

    await expect(
      DeviceMonitorLookupUtil.getDeviceBinding(DEVICE_ID),
    ).resolves.toEqual({
      boundMonitor: null,
      isMonitorBacked: false,
      deviceName: "",
      deviceAddress: "",
    });
  });

  test("a device that no longer exists degrades the same way", async () => {
    getItemMock.mockResolvedValue(null);

    await expect(
      DeviceMonitorLookupUtil.getDeviceBinding(DEVICE_ID),
    ).resolves.toEqual({
      boundMonitor: null,
      isMonitorBacked: false,
      deviceName: "",
      deviceAddress: "",
    });
  });
});

describe("DeviceMonitorLookupUtil - the bound monitor joins the list", () => {
  beforeEach(() => {
    resetLookup();
    getItemMock.mockResolvedValue(deviceRow({}));
  });

  test("a bound Ping monitor is returned even though no Network Device monitor watches the device", async () => {
    const bound: Monitor = boundPingMonitor(
      "9f1b6b0e-0000-4000-8000-00000000ce02",
      "ping-core-ap",
    );
    getItemMock.mockResolvedValue(
      deviceRow({
        monitoringMethod: NetworkDeviceMonitoringMethod.Monitor,
        monitor: bound,
      }),
    );

    const result: Array<Monitor> =
      await DeviceMonitorLookupUtil.getMonitorsWatchingDevice(DEVICE_ID);

    // This is the regression: it used to be [].
    expect(result).toEqual([bound]);
  });

  test("the bound monitor leads, watchers follow", async () => {
    const bound: Monitor = boundPingMonitor(
      "9f1b6b0e-0000-4000-8000-00000000ce03",
      "ping-core-ap",
    );
    const watching: Monitor = networkDeviceMonitor(
      "9f1b6b0e-0000-4000-8000-00000000ce04",
      "core-ap health",
    );

    getItemMock.mockResolvedValue(
      deviceRow({
        monitoringMethod: NetworkDeviceMonitoringMethod.Monitor,
        monitor: bound,
      }),
    );
    answerWatching([watching]);

    const result: Array<Monitor> =
      await DeviceMonitorLookupUtil.getMonitorsWatchingDevice(DEVICE_ID);

    expect(result).toHaveLength(2);
    // The monitor deciding the device's status comes first.
    expect(result[0]).toBe(bound);
    expect(result[1]).toBe(watching);
  });

  test("a monitor that is both bound AND watching is listed once", async () => {
    const sharedId: string = "9f1b6b0e-0000-4000-8000-00000000ce05";

    const bound: Monitor = boundPingMonitor(sharedId, "dual-role");
    const watching: Monitor = networkDeviceMonitor(sharedId, "dual-role");

    getItemMock.mockResolvedValue(
      deviceRow({
        monitoringMethod: NetworkDeviceMonitoringMethod.Monitor,
        monitor: bound,
      }),
    );
    answerWatching([watching]);

    const result: Array<Monitor> =
      await DeviceMonitorLookupUtil.getMonitorsWatchingDevice(DEVICE_ID);

    /*
     * The two arrive from different requests, so they are different objects
     * with the same id. Deduping by identity would render the row twice.
     */
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(bound);
  });

  test("an SNMP device with nothing bound lists the monitors watching it, as before", async () => {
    const watching: Monitor = networkDeviceMonitor(
      "9f1b6b0e-0000-4000-8000-00000000ce07",
      "core-sw-01 health",
    );

    answerWatching([watching]);

    const result: Array<Monitor> =
      await DeviceMonitorLookupUtil.getMonitorsWatchingDevice(DEVICE_ID);

    expect(result).toEqual([watching]);
  });

  test("getDeviceMonitorContext hands the caller both answers from one device read", async () => {
    const bound: Monitor = boundPingMonitor(
      "9f1b6b0e-0000-4000-8000-00000000ce06",
      "ping-ip-phone",
    );
    getItemMock.mockResolvedValue(
      deviceRow({
        monitoringMethod: NetworkDeviceMonitoringMethod.Monitor,
        monitor: bound,
      }),
    );

    await expect(
      DeviceMonitorLookupUtil.getDeviceMonitorContext(DEVICE_ID),
    ).resolves.toEqual({
      monitors: [bound],
      isMonitorBacked: true,
      removableMonitorIds: new Set<string>(),
      untiedMonitors: NO_UNTIED_MONITORS,
    });

    /*
     * One device read, not two: the card needs the monitor AND the method,
     * and a second round trip for a boolean already on the row is waste.
     */
    expect(getItemMock).toHaveBeenCalledTimes(1);
  });
});

/*
 * Issue #5145: a discovery import can give each device a monitor from a
 * Ping, IP, Port or NTP template. That monitor checks the device's address,
 * so neither its type nor its steps name the device - its provenance does.
 * Without it on the device's page, the page would say nothing alerts on a
 * device the import just gave a paging monitor.
 */
describe("DeviceMonitorLookupUtil - the monitors a discovery import made for the device", () => {
  function addressMonitor(
    id: string,
    name: string,
    monitorType: MonitorType,
  ): Monitor {
    const monitor: Monitor = new Monitor();
    monitor._id = id;
    monitor.name = name;
    monitor.monitorType = monitorType;
    return monitor;
  }

  beforeEach(() => {
    resetLookup();
    getItemMock.mockResolvedValue(deviceRow({}));
  });

  test("a Ping monitor made for the device is listed, though nothing names the device in its steps", async () => {
    const kds: Monitor = addressMonitor(
      "9f1b6b0e-0000-4000-8000-00000000ce11",
      "WB0024KDS03",
      MonitorType.Ping,
    );
    madeForDevice = [kds];

    await expect(
      DeviceMonitorLookupUtil.getMonitorsWatchingDevice(DEVICE_ID),
    ).resolves.toEqual([kds]);
  });

  test("the bound monitor leads, the Network Device monitors follow, then the ones made for it", async () => {
    const bound: Monitor = boundPingMonitor(
      "9f1b6b0e-0000-4000-8000-00000000ce12",
      "ping-core-ap",
    );
    const watching: Monitor = networkDeviceMonitor(
      "9f1b6b0e-0000-4000-8000-00000000ce13",
      "core-ap health",
    );
    const port: Monitor = addressMonitor(
      "9f1b6b0e-0000-4000-8000-00000000ce14",
      "WB0024KDS03 - Printer port",
      MonitorType.Port,
    );

    getItemMock.mockResolvedValue(
      deviceRow({
        monitoringMethod: NetworkDeviceMonitoringMethod.Monitor,
        monitor: bound,
      }),
    );
    answerWatching([watching]);
    madeForDevice = [port];

    const result: Array<Monitor> =
      await DeviceMonitorLookupUtil.getMonitorsWatchingDevice(DEVICE_ID);

    expect(result).toEqual([bound, watching, port]);
  });

  test("a monitor that is both bound to the device and made for it is listed once", async () => {
    const sharedId: string = "9f1b6b0e-0000-4000-8000-00000000ce15";
    const bound: Monitor = boundPingMonitor(sharedId, "WB0024KDS03");

    getItemMock.mockResolvedValue(
      deviceRow({
        monitoringMethod: NetworkDeviceMonitoringMethod.Monitor,
        monitor: bound,
      }),
    );
    madeForDevice = [addressMonitor(sharedId, "WB0024KDS03", MonitorType.Ping)];

    const result: Array<Monitor> =
      await DeviceMonitorLookupUtil.getMonitorsWatchingDevice(DEVICE_ID);

    expect(result).toHaveLength(1);
    expect(result[0]).toBe(bound);
  });

  test("the device's page context carries them too", async () => {
    const ntp: Monitor = addressMonitor(
      "9f1b6b0e-0000-4000-8000-00000000ce16",
      "core-01 - Time",
      MonitorType.NTP,
    );
    madeForDevice = [ntp];

    await expect(
      DeviceMonitorLookupUtil.getDeviceMonitorContext(DEVICE_ID),
    ).resolves.toEqual({
      monitors: [ntp],
      isMonitorBacked: false,
      removableMonitorIds: new Set<string>(),
      untiedMonitors: NO_UNTIED_MONITORS,
    });
  });
});

/*
 * The device's WEB UI monitor (#5281, the follow-up of #5145): "Monitor web
 * UI" on its Monitors card makes a Website monitor of the device's
 * management page. Nothing on a Website monitor names a device, so the
 * lookup finds it by what it is - a Website monitor named after the
 * device, with a step on the device's address - reading only the Website
 * monitors whose name holds the device's, never the project's every one.
 */
describe("DeviceMonitorLookupUtil - the device's web UI monitor", () => {
  const DEVICE_NAME: string = "core-sw-01";
  const DEVICE_ADDRESS: string = "10.20.0.1";

  function websiteMonitor(
    id: string,
    name: string,
    destinations: Array<string>,
  ): Monitor {
    const monitor: Monitor = monitorWithSteps(
      destinations.map((destination: string): MonitorStep => {
        const step: MonitorStep = new MonitorStep();
        step.data!.monitorDestination = URL.fromString(destination);
        return step;
      }),
    );
    monitor._id = id;
    monitor.name = name;
    monitor.monitorType = MonitorType.Website;
    return monitor;
  }

  const WEB_UI: Monitor = websiteMonitor(
    "9f1b6b0e-0000-4000-8000-00000000eb01",
    "core-sw-01 web UI",
    ["https://10.20.0.1/"],
  );
  const PORTAL: Monitor = websiteMonitor(
    "9f1b6b0e-0000-4000-8000-00000000eb02",
    "core-sw-01 vendor portal",
    ["https://support.example.net/core-sw-01"],
  );

  let webUiCandidates: Array<Monitor> = [];
  let failWebUiRead: boolean = false;

  function isWebUiQuery(request: { query?: Record<string, unknown> }): boolean {
    return request.query?.["monitorType"] === MonitorType.Website;
  }

  beforeEach(() => {
    // Nothing watches the device: the server names no monitor.
    resetLookup();
    webUiCandidates = [WEB_UI, PORTAL];
    failWebUiRead = false;
    getItemMock.mockResolvedValue(
      deviceRow({ name: DEVICE_NAME, hostname: DEVICE_ADDRESS }),
    );
    getListMock.mockImplementation(
      async (request: { query?: Record<string, unknown> }) => {
        if (isWebUiQuery(request)) {
          if (failWebUiRead) {
            throw new Error("The monitors could not be read.");
          }
          return {
            data: webUiCandidates,
            count: webUiCandidates.length,
            skip: 0,
            limit: WEB_UI_MONITOR_CANDIDATES_LIMIT,
          };
        }

        if (isMadeForDeviceQuery(request)) {
          return {
            data: madeForDevice,
            count: madeForDevice.length,
            skip: 0,
            limit: 100,
          };
        }

        return { data: [], count: 0, skip: 0, limit: 100 };
      },
    );
  });

  test("the device's binding names it and the address its probe polls", async () => {
    const binding: DeviceBinding =
      await DeviceMonitorLookupUtil.getDeviceBinding(DEVICE_ID);

    expect(binding.deviceName).toBe(DEVICE_NAME);
    expect(binding.deviceAddress).toBe(DEVICE_ADDRESS);
    expect(
      (getItemMock.mock.calls[0]![0] as { select: Record<string, unknown> })
        .select,
    ).toMatchObject({ name: true, hostname: true });
  });

  test("the Website monitor named after the device, on its address, is listed - the vendor portal is not", async () => {
    await expect(
      DeviceMonitorLookupUtil.getMonitorsWatchingDevice(DEVICE_ID),
    ).resolves.toEqual([WEB_UI]);
  });

  test("it reads the Website monitors whose name holds the device's, with their steps, a handful at most", async () => {
    await DeviceMonitorLookupUtil.getMonitorsWatchingDevice(DEVICE_ID);

    const webUiRead: {
      query: Record<string, unknown>;
      limit: number;
      select: Record<string, unknown>;
    } = getListMock.mock.calls
      .map((call: Array<unknown>) => {
        return call[0] as {
          query: Record<string, unknown>;
          limit: number;
          select: Record<string, unknown>;
        };
      })
      .find((request: { query: Record<string, unknown> }): boolean => {
        return isWebUiQuery(request);
      })!;

    expect(webUiRead.query["monitorType"]).toBe(MonitorType.Website);
    expect(webUiRead.query["name"]).toBeInstanceOf(Search);
    expect((webUiRead.query["name"] as Search<string>).toString()).toBe(
      DEVICE_NAME,
    );
    expect(webUiRead.limit).toBe(WEB_UI_MONITOR_CANDIDATES_LIMIT);
    expect(WEB_UI_MONITOR_CANDIDATES_LIMIT).toBeLessThanOrEqual(50);
    expect(webUiRead.select["monitorSteps"]).toBe(true);
    expect(webUiRead.select["currentMonitorStatus"]).toEqual({
      name: true,
      color: true,
    });
  });

  test("it comes after the device's other monitors, and once", async () => {
    const port: Monitor = new Monitor();
    port._id = "9f1b6b0e-0000-4000-8000-00000000eb03";
    port.name = "core-sw-01 - SSH port";
    port.monitorType = MonitorType.Port;
    madeForDevice = [port];
    webUiCandidates = [WEB_UI, WEB_UI];

    await expect(
      DeviceMonitorLookupUtil.getMonitorsWatchingDevice(DEVICE_ID),
    ).resolves.toEqual([port, WEB_UI]);
  });

  test("a device with no name or no address has no web UI monitor to read for", async () => {
    for (const row of [
      deviceRow({ hostname: DEVICE_ADDRESS }),
      deviceRow({ name: DEVICE_NAME }),
      deviceRow({ name: "  ", hostname: DEVICE_ADDRESS }),
    ]) {
      getListMock.mockClear();
      getItemMock.mockResolvedValue(row);

      await expect(
        DeviceMonitorLookupUtil.getMonitorsWatchingDevice(DEVICE_ID),
      ).resolves.toEqual([]);

      expect(
        getListMock.mock.calls.filter((call: Array<unknown>): boolean => {
          return isWebUiQuery(call[0] as { query?: Record<string, unknown> });
        }),
      ).toHaveLength(0);
    }
  });

  test("a web UI read that fails leaves the device's other monitors listed", async () => {
    const ntp: Monitor = new Monitor();
    ntp._id = "9f1b6b0e-0000-4000-8000-00000000eb04";
    ntp.name = "core-sw-01 - Time";
    ntp.monitorType = MonitorType.NTP;
    madeForDevice = [ntp];
    failWebUiRead = true;

    await expect(
      DeviceMonitorLookupUtil.getDeviceMonitorContext(DEVICE_ID),
    ).resolves.toEqual({
      monitors: [ntp],
      isMonitorBacked: false,
      removableMonitorIds: new Set<string>(),
      untiedMonitors: NO_UNTIED_MONITORS,
    });
  });

  test("the device's page context lists it", async () => {
    await expect(
      DeviceMonitorLookupUtil.getDeviceMonitorContext(DEVICE_ID),
    ).resolves.toEqual({
      monitors: [WEB_UI],
      isMonitorBacked: false,
      removableMonitorIds: new Set<string>(),
      untiedMonitors: NO_UNTIED_MONITORS,
    });
  });
});

/*
 * ISSUE #9676: the monitors the device's Monitors card can take off the
 * device are the ones a person's tie alone lists there. One made for the
 * device, bound to it, watching it, or its web UI monitor is listed for that
 * reason, and untying it would change nothing on the card.
 */
describe("DeviceMonitorLookupUtil - the monitors a person tied to the device", () => {
  beforeEach(() => {
    resetLookup();
    getItemMock.mockResolvedValue(deviceRow({}));
  });

  function tiedPing(id: string, name: string): Monitor {
    const monitor: Monitor = new Monitor();
    monitor._id = id;
    monitor.name = name;
    monitor.monitorType = MonitorType.Ping;
    monitor.networkDeviceId = DEVICE_ID;
    return monitor;
  }

  test("a monitor only a person's tie lists is one the card can remove", async () => {
    const tied: Monitor = tiedPing(
      "9F1B6B0E-0000-4000-8000-00000000AB41",
      "kiosk ping (by hand)",
    );
    tiedToDevice = [tied];

    const context: DeviceMonitorContext =
      await DeviceMonitorLookupUtil.getDeviceMonitorContext(DEVICE_ID);

    expect(context.monitors).toEqual([tied]);
    expect(Array.from(context.removableMonitorIds)).toEqual([
      "9f1b6b0e-0000-4000-8000-00000000ab41",
    ]);
  });

  test("a tied monitor listed for another reason stays: made for the device, bound to it, or watching it", async () => {
    const madeAndTied: Monitor = tiedPing(
      "9f1b6b0e-0000-4000-8000-00000000ab42",
      "made for it",
    );
    const boundAndTied: Monitor = tiedPing(
      "9f1b6b0e-0000-4000-8000-00000000ab43",
      "bound to it",
    );
    const watchingAndTied: Monitor = networkDeviceMonitor(
      "9f1b6b0e-0000-4000-8000-00000000ab44",
      "watching it",
    );
    watchingAndTied.networkDeviceId = DEVICE_ID;
    const onlyTied: Monitor = tiedPing(
      "9f1b6b0e-0000-4000-8000-00000000ab45",
      "only tied",
    );

    getItemMock.mockResolvedValue(deviceRow({ monitor: boundAndTied }));
    answerWatching([watchingAndTied]);
    madeForDevice = [madeAndTied];
    tiedToDevice = [madeAndTied, boundAndTied, watchingAndTied, onlyTied];

    const context: DeviceMonitorContext =
      await DeviceMonitorLookupUtil.getDeviceMonitorContext(DEVICE_ID);

    expect(context.monitors).toHaveLength(4);
    expect(Array.from(context.removableMonitorIds)).toEqual([
      "9f1b6b0e-0000-4000-8000-00000000ab45",
    ]);
  });

  test("the rule on its own: tied, and in no other list", () => {
    const tied: Monitor = tiedPing(
      "9f1b6b0e-0000-4000-8000-00000000ab46",
      "tied",
    );
    const webUi: Monitor = tiedPing(
      "9f1b6b0e-0000-4000-8000-00000000ab47",
      "web UI",
    );

    expect(
      Array.from(
        DeviceMonitorLookupUtil.getRemovableMonitorIds({
          tiedToDevice: [tied, webUi],
          listedForOtherReasons: [null, undefined, webUi],
        }),
      ),
    ).toEqual(["9f1b6b0e-0000-4000-8000-00000000ab46"]);
    expect(
      DeviceMonitorLookupUtil.getRemovableMonitorIds({
        tiedToDevice: [],
        listedForOtherReasons: [tied],
      }).size,
    ).toBe(0);
  });
});

/*
 * The monitors that check the device's address but are tied to no device
 * (issue #9903), as the server answers them
 * (POST /network-device/:id/untied-monitors): each with what its probes see
 * there, the other devices named as the reader may read them, and none the
 * card already lists.
 */
describe("DeviceMonitorLookupUtil - the monitors on the device's address tied to no device", () => {
  const BRANCH_A_PING: string = "9f1b6b0e-0000-4000-8000-00000000c901";
  const BOTH_BRANCHES_PING: string = "9f1b6b0e-0000-4000-8000-00000000c902";
  const BRANCH_B_ROUTER: string = "3f1b6b0e-0000-4000-8000-0000000000bb";
  const HIDDEN_ROUTER: string = "3f1b6b0e-0000-4000-8000-0000000000cc";

  // What the server answers about the device's address.
  let untiedAnswer: HTTPResponse<JSONObject> | HTTPErrorResponse;
  // The network devices the reader may read.
  let readableDevices: Array<NetworkDevice>;
  // Whether reading the devices' names fails.
  let namesFail: boolean;

  function isUntiedRequest(request: { url: URL }): boolean {
    return request.url.toString().endsWith("/untied-monitors");
  }

  function namedDevice(id: string, name: string): NetworkDevice {
    const device: NetworkDevice = new NetworkDevice();
    device._id = id;
    device.name = name;
    return device;
  }

  function deviceNameReads(): Array<unknown> {
    return getListMock.mock.calls.filter((call: Array<unknown>): boolean => {
      return (call[0] as { modelType?: unknown }).modelType === NetworkDevice;
    });
  }

  beforeEach(() => {
    resetLookup();
    getItemMock.mockResolvedValue(deviceRow({}));
    readableDevices = [namedDevice(BRANCH_B_ROUTER, "Branch B router")];
    namesFail = false;
    untiedAnswer = new HTTPResponse<JSONObject>(
      200,
      {
        monitors: [
          {
            monitorId: BRANCH_A_PING,
            name: "Branch A ping",
            monitorType: "Ping",
            match: UntiedMonitorMatch.ThisDevice,
          },
          {
            monitorId: BOTH_BRANCHES_PING,
            name: "Both branches ping",
            monitorType: "Ping",
            match: UntiedMonitorMatch.CannotTellApart,
            ambiguousReason: AmbiguousAddressReason.PollSeveral,
            otherDeviceIds: [BRANCH_B_ROUTER, HIDDEN_ROUTER],
          },
        ],
        hasMore: false,
      } as JSONObject,
      {},
    );

    postMock.mockImplementation(async (request: unknown) => {
      if (isUntiedRequest(request as { url: URL })) {
        return untiedAnswer;
      }

      return new HTTPResponse<JSONObject>(
        200,
        { monitorIds: [] } as JSONObject,
        {},
      );
    });

    const monitorLists: (request: unknown) => unknown =
      getListMock.getMockImplementation() as (request: unknown) => unknown;

    getListMock.mockImplementation(async (request: unknown) => {
      const asked: { modelType?: unknown; query?: Record<string, unknown> } =
        request as { modelType?: unknown; query?: Record<string, unknown> };

      if (asked.modelType !== NetworkDevice) {
        return monitorLists(request);
      }

      if (namesFail) {
        throw new Error("The devices could not be read.");
      }

      const ids: Array<string> = (
        (asked.query!["_id"] as Includes).values as Array<string>
      ).map((id: string): string => {
        return id.toString();
      });
      const found: Array<NetworkDevice> = readableDevices.filter(
        (device: NetworkDevice): boolean => {
          return ids.includes(device._id!.toString());
        },
      );

      return { data: found, count: found.length, skip: 0, limit: 100 };
    });
  });

  test("asks the device's own route, with the project header", async () => {
    await DeviceMonitorLookupUtil.fetchUntiedMonitors(DEVICE_ID);

    const request: { url: URL; data: JSONObject; headers: Dictionary<string> } =
      postMock.mock.calls[0]![0] as {
        url: URL;
        data: JSONObject;
        headers: Dictionary<string>;
      };

    expect(NETWORK_DEVICE_UNTIED_MONITORS_ROUTE).toBe(
      "/network-device/:networkDeviceId/untied-monitors",
    );
    expect(getUntiedMonitorsRoute(DEVICE_ID)).toBe(
      `/network-device/${DEVICE_ID.toString()}/untied-monitors`,
    );
    expect(request.url.toString()).toBe(
      `http://localhost/api${getUntiedMonitorsRoute(DEVICE_ID)}`,
    );
    expect(request.data).toEqual({});
    expect(request.headers).toEqual(TENANT_HEADERS);
  });

  test("a refused request is thrown by the fetch", async () => {
    untiedAnswer = new HTTPErrorResponse(500, {} as JSONObject, {});

    await expect(
      DeviceMonitorLookupUtil.fetchUntiedMonitors(DEVICE_ID),
    ).rejects.toBeInstanceOf(HTTPErrorResponse);
  });

  test("lists each with what its probes see, naming the other devices the reader may read", async () => {
    const listing: UntiedMonitorsListing =
      await DeviceMonitorLookupUtil.listUntiedMonitors(DEVICE_ID);

    expect(
      listing.monitors.map(
        (monitor: { name: string; match: string }): Array<string> => {
          return [monitor.name, monitor.match];
        },
      ),
    ).toEqual([
      ["Branch A ping", UntiedMonitorMatch.ThisDevice],
      ["Both branches ping", UntiedMonitorMatch.CannotTellApart],
    ]);
    // The router the reader may not read is not named.
    expect(Array.from(listing.deviceNames.entries())).toEqual([
      [BRANCH_B_ROUTER, "Branch B router"],
    ]);
    expect(listing.hasMore).toBe(false);
    expect(deviceNameReads()).toHaveLength(1);
  });

  test("reads no device names when no row names another device", async () => {
    untiedAnswer = new HTTPResponse<JSONObject>(
      200,
      {
        monitors: [
          {
            monitorId: BRANCH_A_PING,
            name: "Branch A ping",
            match: UntiedMonitorMatch.ThisDevice,
          },
        ],
        hasMore: true,
      } as JSONObject,
      {},
    );

    const listing: UntiedMonitorsListing =
      await DeviceMonitorLookupUtil.listUntiedMonitors(DEVICE_ID);

    expect(listing.monitors).toHaveLength(1);
    expect(listing.hasMore).toBe(true);
    expect(deviceNameReads()).toHaveLength(0);
  });

  test("a refused request lists none, and the device's own monitors are listed all the same", async () => {
    untiedAnswer = new HTTPErrorResponse(500, {} as JSONObject, {});
    const tied: Monitor = boundPingMonitor(
      "9f1b6b0e-0000-4000-8000-00000000c903",
      "tied ping",
    );
    tiedToDevice = [tied];

    const context: DeviceMonitorContext =
      await DeviceMonitorLookupUtil.getDeviceMonitorContext(DEVICE_ID);

    expect(context.monitors).toEqual([tied]);
    expect(context.untiedMonitors).toEqual(NO_UNTIED_MONITORS);
  });

  test("a failed read of the devices' names leaves them unnamed, the rows listed", async () => {
    namesFail = true;

    const listing: UntiedMonitorsListing =
      await DeviceMonitorLookupUtil.listUntiedMonitors(DEVICE_ID);

    expect(listing.monitors).toHaveLength(2);
    expect(listing.deviceNames.size).toBe(0);
  });

  test("the device's page context carries them, less any monitor the card lists already", async () => {
    // The monitor bound to a monitor-backed device, untied: the device's all the same.
    const bound: Monitor = boundPingMonitor(BRANCH_A_PING, "Branch A ping");
    getItemMock.mockResolvedValue(
      deviceRow({
        monitoringMethod: NetworkDeviceMonitoringMethod.Monitor,
        monitor: bound,
      }),
    );

    const context: DeviceMonitorContext =
      await DeviceMonitorLookupUtil.getDeviceMonitorContext(DEVICE_ID);

    expect(context.monitors).toEqual([bound]);
    expect(
      context.untiedMonitors.monitors.map(
        (monitor: { monitorId: string }): string => {
          return monitor.monitorId;
        },
      ),
    ).toEqual([BOTH_BRANCHES_PING]);
    expect(context.untiedMonitors.deviceNames.get(BRANCH_B_ROUTER)).toBe(
      "Branch B router",
    );
  });

  test("the rule on its own: a listed monitor is left out, by id whatever its case", () => {
    const listed: Monitor = boundPingMonitor(
      BRANCH_A_PING.toUpperCase(),
      "listed",
    );

    expect(
      DeviceMonitorLookupUtil.withoutListedMonitors({
        untied: {
          monitors: [
            {
              monitorId: BRANCH_A_PING,
              name: "Branch A ping",
              monitorType: "Ping",
              match: UntiedMonitorMatch.ThisDevice,
            },
            {
              monitorId: BOTH_BRANCHES_PING,
              name: "Both branches ping",
              monitorType: "Ping",
              match: UntiedMonitorMatch.ThisDevice,
            },
          ],
          hasMore: true,
          deviceNames: new Map<string, string>(),
        },
        listed: [listed],
      }),
    ).toEqual({
      monitors: [
        {
          monitorId: BOTH_BRANCHES_PING,
          name: "Both branches ping",
          monitorType: "Ping",
          match: UntiedMonitorMatch.ThisDevice,
        },
      ],
      hasMore: true,
      deviceNames: new Map<string, string>(),
    });
  });
});
