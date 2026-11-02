import { beforeEach, describe, expect, test } from "@jest/globals";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import Includes from "Common/Types/BaseDatabase/Includes";
import Search from "Common/Types/BaseDatabase/Search";
import URL from "Common/Types/API/URL";

/*
 * DeviceMonitorLookupUtil.monitorWatchesDevice is pure, but the module also
 * imports ModelAPI (for getMonitorsWatchingDevice), and ModelAPI transitively
 * loads Common/UI/Config, which reads `window` at import time and throws in
 * this node test environment. Mocking the ModelAPI module keeps the import
 * graph browser-free and doubles as the seam for testing the client-side
 * filtering that getMonitorsWatchingDevice layers on top of the API call.
 */
jest.mock("Common/UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: jest.fn(),
      getItem: jest.fn(),
    },
  };
});

import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import NetworkDeviceMonitoringMethod from "Common/Types/NetworkDevice/NetworkDeviceMonitoringMethod";
import DeviceMonitorLookupUtil, {
  DeviceBinding,
  WEB_UI_MONITOR_CANDIDATES_LIMIT,
} from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceMonitorLookupUtil";

const getListMock: jest.Mock = ModelAPI.getList as unknown as jest.Mock;
const getItemMock: jest.Mock = ModelAPI.getItem as unknown as jest.Mock;

/*
 * The two lists the lookup reads: the project's Network Device monitors
 * (filtered by their steps), and the monitors a discovery import made for
 * this device from a Ping, IP, Port or NTP template (issue #5145), found by
 * their provenance. A test sets the first; the second is madeForDevice.
 */
let madeForDevice: Array<Monitor> = [];

function isMadeForDeviceQuery(request: {
  query?: Record<string, unknown>;
}): boolean {
  return Boolean(
    request.query && "autoProvisionedNetworkDeviceId" in request.query,
  );
}

function answerNetworkDeviceMonitors(result: {
  data: Array<Monitor>;
  count: number;
  skip: number;
  limit: number;
}): void {
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

      return result;
    },
  );
}

const DEVICE_ID: ObjectID = new ObjectID(
  "3f1b6b0e-0000-4000-8000-0000000000aa",
);
const OTHER_DEVICE_ID: ObjectID = new ObjectID(
  "3f1b6b0e-0000-4000-8000-0000000000bb",
);

function stepWatching(networkDeviceId: string | undefined): MonitorStep {
  const step: MonitorStep = new MonitorStep();
  step.data!.networkDeviceMonitor = {
    networkDeviceId: networkDeviceId,
    monitorInterfaces: true,
    oids: [],
  };
  return step;
}

function stepWithoutDeviceMonitor(): MonitorStep {
  // A fresh step: data exists but networkDeviceMonitor is undefined.
  return new MonitorStep();
}

function malformedStep(): MonitorStep {
  // A step whose data never hydrated — the util must tolerate it.
  const step: MonitorStep = new MonitorStep();
  step.data = undefined;
  return step;
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

describe("DeviceMonitorLookupUtil.monitorWatchesDevice", () => {
  test("matches a monitor whose step references the device", () => {
    const monitor: Monitor = monitorWithSteps([
      stepWatching(DEVICE_ID.toString()),
    ]);

    expect(
      DeviceMonitorLookupUtil.monitorWatchesDevice(monitor, DEVICE_ID),
    ).toBe(true);
  });

  test("rejects a monitor watching a different device", () => {
    const monitor: Monitor = monitorWithSteps([
      stepWatching(OTHER_DEVICE_ID.toString()),
    ]);

    expect(
      DeviceMonitorLookupUtil.monitorWatchesDevice(monitor, DEVICE_ID),
    ).toBe(false);
  });

  test("matches when any one of several steps references the device", () => {
    const monitor: Monitor = monitorWithSteps([
      stepWatching(OTHER_DEVICE_ID.toString()),
      stepWatching(DEVICE_ID.toString()),
    ]);

    expect(
      DeviceMonitorLookupUtil.monitorWatchesDevice(monitor, DEVICE_ID),
    ).toBe(true);
  });

  test("rejects a monitor with no monitorSteps at all", () => {
    const monitor: Monitor = new Monitor();

    expect(
      DeviceMonitorLookupUtil.monitorWatchesDevice(monitor, DEVICE_ID),
    ).toBe(false);
  });

  test("rejects a monitor whose monitorSteps never hydrated data", () => {
    const monitor: Monitor = new Monitor();
    const monitorSteps: MonitorSteps = new MonitorSteps();
    monitorSteps.data = undefined;
    monitor.monitorSteps = monitorSteps;

    expect(
      DeviceMonitorLookupUtil.monitorWatchesDevice(monitor, DEVICE_ID),
    ).toBe(false);
  });

  test("rejects an empty steps array", () => {
    expect(
      DeviceMonitorLookupUtil.monitorWatchesDevice(
        monitorWithSteps([]),
        DEVICE_ID,
      ),
    ).toBe(false);
  });

  test("tolerates a step with no data (does not throw, does not match)", () => {
    expect(
      DeviceMonitorLookupUtil.monitorWatchesDevice(
        monitorWithSteps([malformedStep()]),
        DEVICE_ID,
      ),
    ).toBe(false);
  });

  test("tolerates a step without a networkDeviceMonitor section", () => {
    expect(
      DeviceMonitorLookupUtil.monitorWatchesDevice(
        monitorWithSteps([stepWithoutDeviceMonitor()]),
        DEVICE_ID,
      ),
    ).toBe(false);
  });

  test("a networkDeviceMonitor with no device id does not match", () => {
    expect(
      DeviceMonitorLookupUtil.monitorWatchesDevice(
        monitorWithSteps([stepWatching(undefined)]),
        DEVICE_ID,
      ),
    ).toBe(false);
  });

  test("still finds the match after malformed sibling steps", () => {
    const monitor: Monitor = monitorWithSteps([
      malformedStep(),
      stepWithoutDeviceMonitor(),
      stepWatching(DEVICE_ID.toString()),
    ]);

    expect(
      DeviceMonitorLookupUtil.monitorWatchesDevice(monitor, DEVICE_ID),
    ).toBe(true);
  });
});

describe("DeviceMonitorLookupUtil.getMonitorsWatchingDevice", () => {
  beforeEach(() => {
    getListMock.mockReset();
    madeForDevice = [];
    getItemMock.mockReset();
    // Default: the device has nothing bound, which is the pre-#3447 world.
    getItemMock.mockResolvedValue(deviceRow({}));
  });

  test("filters the fetched list down to monitors watching the device", async () => {
    const watching: Monitor = monitorWithSteps([
      stepWatching(DEVICE_ID.toString()),
    ]);
    const other: Monitor = monitorWithSteps([
      stepWatching(OTHER_DEVICE_ID.toString()),
    ]);
    const malformed: Monitor = monitorWithSteps([malformedStep()]);

    answerNetworkDeviceMonitors({
      data: [watching, other, malformed],
      count: 3,
      skip: 0,
      limit: 100,
    });

    const result: Array<Monitor> =
      await DeviceMonitorLookupUtil.getMonitorsWatchingDevice(DEVICE_ID);

    expect(result).toHaveLength(1);
    expect(result[0]).toBe(watching);
  });

  test("reads the Network Device monitors, and the ones made for this device, nothing else", async () => {
    answerNetworkDeviceMonitors({ data: [], count: 0, skip: 0, limit: 100 });

    await DeviceMonitorLookupUtil.getMonitorsWatchingDevice(DEVICE_ID);

    expect(getListMock).toHaveBeenCalledTimes(2);

    const queries: Array<Record<string, unknown>> = getListMock.mock.calls.map(
      (call: Array<unknown>): Record<string, unknown> => {
        return (call[0] as { query: Record<string, unknown> }).query;
      },
    );

    const watchers: Record<string, unknown> | undefined = queries.find(
      (query: Record<string, unknown>): boolean => {
        return !("autoProvisionedNetworkDeviceId" in query);
      },
    );
    expect(watchers).toEqual({ monitorType: MonitorType.NetworkDevice });

    const madeFor: Record<string, unknown> | undefined = queries.find(
      (query: Record<string, unknown>): boolean => {
        return "autoProvisionedNetworkDeviceId" in query;
      },
    );
    expect(String(madeFor!["autoProvisionedNetworkDeviceId"])).toBe(
      DEVICE_ID.toString(),
    );
    expect(madeFor!["monitorType"]).toBeInstanceOf(Includes);
    expect((madeFor!["monitorType"] as Includes).values).toEqual([
      MonitorType.Ping,
      MonitorType.IP,
      MonitorType.Port,
      MonitorType.NTP,
    ]);
  });

  test("returns an empty array when nothing in the project watches the device", async () => {
    answerNetworkDeviceMonitors({
      data: [monitorWithSteps([stepWatching(OTHER_DEVICE_ID.toString())])],
      count: 1,
      skip: 0,
      limit: 100,
    });

    await expect(
      DeviceMonitorLookupUtil.getMonitorsWatchingDevice(DEVICE_ID),
    ).resolves.toEqual([]);
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
    getListMock.mockReset();
    madeForDevice = [];
    getItemMock.mockReset();
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
    getListMock.mockReset();
    madeForDevice = [];
    getItemMock.mockReset();
    answerNetworkDeviceMonitors({ data: [], count: 0, skip: 0, limit: 100 });
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
    const watching: Monitor = monitorWithSteps([
      stepWatching(DEVICE_ID.toString()),
    ]);
    watching._id = "9f1b6b0e-0000-4000-8000-00000000ce04";

    getItemMock.mockResolvedValue(
      deviceRow({
        monitoringMethod: NetworkDeviceMonitoringMethod.Monitor,
        monitor: bound,
      }),
    );
    answerNetworkDeviceMonitors({
      data: [watching],
      count: 1,
      skip: 0,
      limit: 100,
    });

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
    const watching: Monitor = monitorWithSteps([
      stepWatching(DEVICE_ID.toString()),
    ]);
    watching._id = sharedId;

    getItemMock.mockResolvedValue(
      deviceRow({
        monitoringMethod: NetworkDeviceMonitoringMethod.Monitor,
        monitor: bound,
      }),
    );
    answerNetworkDeviceMonitors({
      data: [watching],
      count: 1,
      skip: 0,
      limit: 100,
    });

    const result: Array<Monitor> =
      await DeviceMonitorLookupUtil.getMonitorsWatchingDevice(DEVICE_ID);

    /*
     * The two arrive from different requests, so they are different objects
     * with the same id. Deduping by identity would render the row twice.
     */
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(bound);
  });

  test("an SNMP device with nothing bound behaves exactly as before", async () => {
    const watching: Monitor = monitorWithSteps([
      stepWatching(DEVICE_ID.toString()),
    ]);
    const other: Monitor = monitorWithSteps([
      stepWatching(OTHER_DEVICE_ID.toString()),
    ]);

    answerNetworkDeviceMonitors({
      data: [watching, other],
      count: 2,
      skip: 0,
      limit: 100,
    });

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
    getListMock.mockReset();
    getItemMock.mockReset();
    madeForDevice = [];
    getItemMock.mockResolvedValue(deviceRow({}));
    answerNetworkDeviceMonitors({ data: [], count: 0, skip: 0, limit: 100 });
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
    const watching: Monitor = monitorWithSteps([
      stepWatching(DEVICE_ID.toString()),
    ]);
    watching._id = "9f1b6b0e-0000-4000-8000-00000000ce13";
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
    answerNetworkDeviceMonitors({
      data: [watching],
      count: 1,
      skip: 0,
      limit: 100,
    });
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
    ).resolves.toEqual({ monitors: [ntp], isMonitorBacked: false });
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
    getListMock.mockReset();
    getItemMock.mockReset();
    madeForDevice = [];
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
    ).resolves.toEqual({ monitors: [ntp], isMonitorBacked: false });
  });

  test("the device's page context lists it", async () => {
    await expect(
      DeviceMonitorLookupUtil.getDeviceMonitorContext(DEVICE_ID),
    ).resolves.toEqual({ monitors: [WEB_UI], isMonitorBacked: false });
  });
});
