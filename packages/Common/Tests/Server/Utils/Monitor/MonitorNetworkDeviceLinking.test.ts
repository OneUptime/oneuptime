/*
 * PasswordHash carries a pre-existing TS5.9 diagnostic that fails any suite
 * whose runtime require graph reaches it (DatabaseService, the base class of
 * every concrete service, imports it). Nothing password-related is under
 * test here, so the module is replaced WITH A FACTORY.
 */
jest.mock("../../../../Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: {
      hash: jest.fn(),
      verify: jest.fn(),
      generateSalt: jest.fn(),
      needsUpgrade: jest.fn(),
      applyPepper: jest.fn(),
    },
  };
});

import Alert from "../../../../Models/DatabaseModels/Alert";
import Incident from "../../../../Models/DatabaseModels/Incident";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import NetworkDevice from "../../../../Models/DatabaseModels/NetworkDevice";
import MonitorService from "../../../../Server/Services/MonitorService";
import NetworkDeviceService from "../../../../Server/Services/NetworkDeviceService";
import LinkedAffectedResources, {
  LinkedAffectedResourceType,
} from "../../../../Server/Utils/AffectedResources/LinkedAffectedResources";
import logger from "../../../../Server/Utils/Logger";
import MonitorResourceContextUtil from "../../../../Server/Utils/Monitor/MonitorResourceContext";
import MonitorStepResourceIdentity from "../../../../Server/Utils/Monitor/MonitorStepResourceIdentity";
import { SeriesResourceRefs } from "../../../../Server/Utils/Monitor/SeriesResourceLabels";
import SeriesResourceLinker, {
  SeriesResolvedResourceIds,
} from "../../../../Server/Utils/Monitor/SeriesResourceLinker";
import Includes from "../../../../Types/BaseDatabase/Includes";
import { JSONObject } from "../../../../Types/JSON";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import { MonitorStepNetworkDeviceMonitorUtil } from "../../../../Types/Monitor/MonitorStepNetworkDeviceMonitor";
import MonitorSteps from "../../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import ObjectID from "../../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * THE NETWORK DEVICES AN INCIDENT OR ALERT A MONITOR RAISES IS ABOUT
 * (issue #5341).
 *
 * Incidents and alerts can hold network devices now, so what a monitor
 * raises on a router lands on the router: on its Incidents and Alerts
 * tabs, its menu's badges and the incident's Affected Resources card. A
 * monitor reports on a device in three ways - the same three the device's
 * own Monitors page lists:
 *
 *   - a Network Device monitor names the device in its step (the picker's
 *     primary key) - read from the step config, like every other kind;
 *   - a device whose monitoring method is Monitor takes its status from a
 *     monitor (NetworkDevice.monitorId) - the monitor is bound to it;
 *   - a discovery import made the monitor for the device
 *     (Monitor.autoProvisionedNetworkDeviceId) - a Ping, IP, Port or NTP
 *     monitor of the device's address.
 *
 * Every read is held to the monitor's project, and none of them can stop
 * the record being created.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const DEVICE_ID: string = "d1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1";
const OTHER_DEVICE_ID: string = "d2d2d2d2-d2d2-4d2d-8d2d-d2d2d2d2d2d2";
const MADE_FOR_DEVICE_ID: string = "d3d3d3d3-d3d3-4d3d-8d3d-d3d3d3d3d3d3";

function monitorWithSteps(
  monitorType: MonitorType,
  stepDataList: Array<JSONObject>,
): Monitor {
  const model: Monitor = new Monitor();
  model.monitorType = monitorType;
  model.projectId = PROJECT_ID;

  const steps: MonitorSteps = new MonitorSteps();
  steps.data = {
    monitorStepsInstanceArray: stepDataList.map(
      (stepData: JSONObject): MonitorStep => {
        const step: MonitorStep = new MonitorStep();
        step.data = {
          ...step.data,
          ...stepData,
        } as MonitorStep["data"];
        return step;
      },
    ),
  };

  model.monitorSteps = steps;
  return model;
}

// A step as the monitor form saves it, with the device the picker named.
function deviceStep(networkDeviceId: unknown): JSONObject {
  return {
    networkDeviceMonitor: {
      ...MonitorStepNetworkDeviceMonitorUtil.getDefault(),
      networkDeviceId: networkDeviceId,
    },
  } as unknown as JSONObject;
}

function refsFor(monitor: Monitor): SeriesResourceRefs {
  return MonitorStepResourceIdentity.extractResourceRefsFromMonitor({
    monitor,
  });
}

function device(id: string): NetworkDevice {
  const row: NetworkDevice = new NetworkDevice();
  row._id = id;
  return row;
}

function idsOn(relation: Array<{ _id?: string | undefined }> | undefined) {
  return (relation || []).map((item: { _id?: string | undefined }): string => {
    return String(item._id);
  });
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a Network Device monitor names the device its step watches", () => {
  test("the step's device, trimmed and lower-cased", () => {
    const refs: SeriesResourceRefs = refsFor(
      monitorWithSteps(MonitorType.NetworkDevice, [
        deviceStep(`  ${DEVICE_ID.toUpperCase()} `),
      ]),
    );

    expect(refs.networkDeviceIds).toEqual([DEVICE_ID]);
    expect(MonitorStepResourceIdentity.isEmpty(refs)).toBe(false);
  });

  test("a device two steps watch is named once; two devices both", () => {
    expect(
      refsFor(
        monitorWithSteps(MonitorType.NetworkDevice, [
          deviceStep(DEVICE_ID),
          deviceStep(DEVICE_ID),
          deviceStep(OTHER_DEVICE_ID),
        ]),
      ).networkDeviceIds,
    ).toEqual([DEVICE_ID, OTHER_DEVICE_ID]);
  });

  test.each([
    ["no device picked yet", undefined],
    ["an empty id", ""],
    ["a name, not an id", "WAN-RTR-01"],
    ["a number", 42],
    ["an object", { id: DEVICE_ID }],
  ])("%s names nothing, and does not throw", (_what: string, id: unknown) => {
    expect(
      refsFor(monitorWithSteps(MonitorType.NetworkDevice, [deviceStep(id)]))
        .networkDeviceIds,
    ).toEqual([]);
  });

  test("only a Network Device monitor's step names a device", () => {
    for (const type of [
      MonitorType.Ping,
      MonitorType.Website,
      MonitorType.Port,
    ]) {
      expect(
        refsFor(monitorWithSteps(type, [deviceStep(DEVICE_ID)]))
          .networkDeviceIds,
      ).toEqual([]);
    }
  });

  test("the step's device survives a persist / rehydrate round trip", () => {
    const built: Monitor = monitorWithSteps(MonitorType.NetworkDevice, [
      deviceStep(DEVICE_ID),
    ]);
    const model: Monitor = new Monitor();
    model.monitorType = MonitorType.NetworkDevice;
    model.projectId = PROJECT_ID;
    model.monitorSteps = MonitorSteps.fromJSON(
      JSON.parse(JSON.stringify(built.monitorSteps!.toJSON())) as JSONObject,
    ) as MonitorSteps;

    expect(refsFor(model).networkDeviceIds).toEqual([DEVICE_ID]);
  });

  test("the empty refs carry an empty device list", () => {
    expect(MonitorStepResourceIdentity.emptyRefs().networkDeviceIds).toEqual(
      [],
    );
  });
});

describe("the step's device is looked up by id, in the monitor's project", () => {
  test("a device of the project is linked; one the lookup does not find is not", async () => {
    const findBy: jest.Mock = jest
      .spyOn(NetworkDeviceService, "findBy")
      .mockResolvedValue([device(DEVICE_ID)]) as unknown as jest.Mock;

    const refs: SeriesResourceRefs = MonitorStepResourceIdentity.emptyRefs();
    refs.networkDeviceIds = [DEVICE_ID, OTHER_DEVICE_ID];

    const resolved: SeriesResolvedResourceIds =
      await SeriesResourceLinker.resolveResourceRefs({
        refs,
        projectId: PROJECT_ID,
        nameMatch: "caseInsensitive",
      });

    expect(resolved.networkDeviceIds).toEqual([DEVICE_ID]);
    expect(findBy).toHaveBeenCalledTimes(1);

    const query: JSONObject = (
      findBy.mock.calls[0]![0] as { query: JSONObject }
    ).query;

    expect(query["projectId"]).toBe(PROJECT_ID);
    expect(
      ((query["_id"] as Includes).values as Array<string>).map(String),
    ).toEqual([DEVICE_ID, OTHER_DEVICE_ID]);
    // Never by a name: a device is only ever named by its id here.
    expect(Object.keys(query).sort()).toEqual(["_id", "projectId"]);
  });

  test("no device named asks nothing", async () => {
    const findBy: jest.Mock = jest
      .spyOn(NetworkDeviceService, "findBy")
      .mockResolvedValue([]) as unknown as jest.Mock;

    await SeriesResourceLinker.resolveResourceRefs({
      refs: MonitorStepResourceIdentity.emptyRefs(),
      projectId: PROJECT_ID,
      nameMatch: "caseInsensitive",
    });

    expect(findBy).not.toHaveBeenCalled();
  });

  test("the resolved devices go on the incident and the alert, beside any already there, once each", () => {
    for (const record of [new Incident(), new Alert()]) {
      record.networkDevices = [device(OTHER_DEVICE_ID)];

      SeriesResourceLinker.attachResolvedResources({
        model: record,
        resolved: {
          ...MonitorResourceContextUtil.emptyContext(),
          networkDeviceIds: [DEVICE_ID, OTHER_DEVICE_ID],
        },
      });

      expect(idsOn(record.networkDevices)).toEqual([
        OTHER_DEVICE_ID,
        DEVICE_ID,
      ]);
      expect(record.networkDevices![1]).toBeInstanceOf(NetworkDevice);
    }
  });

  test("nothing resolved leaves the list untouched", () => {
    const incident: Incident = new Incident();

    SeriesResourceLinker.attachResolvedResources({
      model: incident,
      resolved: MonitorResourceContextUtil.emptyContext(),
    });

    expect(incident.networkDevices).toBeUndefined();
  });
});

describe("the devices a monitor reports on without its steps naming them", () => {
  let findBy: jest.Mock;
  let findMonitor: jest.Mock;
  let bound: Array<NetworkDevice>;
  let madeFor: Array<NetworkDevice>;

  function websiteMonitor(
    autoProvisionedNetworkDeviceId?: string | undefined,
  ): Monitor {
    const model: Monitor = new Monitor();
    model._id = MONITOR_ID.toString();
    model.projectId = PROJECT_ID;
    model.monitorType = MonitorType.Ping;

    if (autoProvisionedNetworkDeviceId) {
      model.autoProvisionedNetworkDeviceId = new ObjectID(
        autoProvisionedNetworkDeviceId,
      );
    }

    return model;
  }

  function deviceQueries(): Array<JSONObject> {
    return findBy.mock.calls.map((call: Array<unknown>): JSONObject => {
      return (call[0] as { query: JSONObject }).query;
    });
  }

  beforeEach(() => {
    bound = [];
    madeFor = [];

    jest
      .spyOn(LinkedAffectedResources, "readForMonitors")
      .mockResolvedValue([]);

    findBy = jest
      .spyOn(NetworkDeviceService, "findBy")
      .mockImplementation(
        async (data: unknown): Promise<Array<NetworkDevice>> => {
          const query: JSONObject = (data as { query: JSONObject }).query;
          return query["monitorId"] ? bound : madeFor;
        },
      ) as unknown as jest.Mock;

    findMonitor = jest
      .spyOn(MonitorService, "findOneBy")
      .mockResolvedValue(null) as unknown as jest.Mock;
  });

  async function read(monitor: Monitor): Promise<SeriesResolvedResourceIds> {
    return MonitorResourceContextUtil.resolveLinkedResourcesForMonitor({
      monitor,
    });
  }

  test("the device bound to the monitor - it takes its status from it", async () => {
    bound = [device(DEVICE_ID.toUpperCase())];

    const resolved: SeriesResolvedResourceIds = await read(websiteMonitor());

    expect(resolved.networkDeviceIds).toEqual([DEVICE_ID]);

    const query: JSONObject = deviceQueries()[0]!;

    expect(query["projectId"]).toBe(PROJECT_ID);
    expect(String(query["monitorId"])).toBe(MONITOR_ID.toString());

    const call: JSONObject = findBy.mock.calls[0]![0] as JSONObject;

    expect(call["limit"]).toBe(10);
    expect(call["select"]).toEqual({ _id: true });
  });

  test("the device a discovery import made the monitor for, read in the monitor's project", async () => {
    madeFor = [device(MADE_FOR_DEVICE_ID)];

    const resolved: SeriesResolvedResourceIds = await read(
      websiteMonitor(MADE_FOR_DEVICE_ID),
    );

    expect(resolved.networkDeviceIds).toEqual([MADE_FOR_DEVICE_ID]);

    const madeForQuery: JSONObject | undefined = deviceQueries().find(
      (query: JSONObject): boolean => {
        return Boolean(query["_id"]);
      },
    );

    expect(madeForQuery).toBeDefined();
    expect(madeForQuery!["projectId"]).toBe(PROJECT_ID);
    expect(String(madeForQuery!["_id"])).toBe(MADE_FOR_DEVICE_ID);
    // Loaded on the monitor already: not read again.
    expect(findMonitor).not.toHaveBeenCalled();
  });

  test("a monitor read without the column has it read off its row, in its project", async () => {
    const row: Monitor = new Monitor();
    row.autoProvisionedNetworkDeviceId = new ObjectID(MADE_FOR_DEVICE_ID);
    findMonitor.mockResolvedValue(row);
    madeFor = [device(MADE_FOR_DEVICE_ID)];

    const resolved: SeriesResolvedResourceIds = await read(websiteMonitor());

    expect(resolved.networkDeviceIds).toEqual([MADE_FOR_DEVICE_ID]);

    const lookup: {
      query: JSONObject;
      select: JSONObject;
    } = findMonitor.mock.calls[0]![0] as {
      query: JSONObject;
      select: JSONObject;
    };

    expect(String(lookup.query["_id"])).toBe(MONITOR_ID.toString());
    expect(lookup.query["projectId"]).toBe(PROJECT_ID);
    expect(lookup.select).toEqual({
      _id: true,
      autoProvisionedNetworkDeviceId: true,
    });
  });

  test("a device both bound to the monitor and made for it is listed once", async () => {
    bound = [device(DEVICE_ID)];
    madeFor = [device(DEVICE_ID)];

    const resolved: SeriesResolvedResourceIds = await read(
      websiteMonitor(DEVICE_ID),
    );

    expect(resolved.networkDeviceIds).toEqual([DEVICE_ID]);
  });

  test("a monitor made for no device asks only which device is bound to it", async () => {
    await read(websiteMonitor());

    expect(findBy).toHaveBeenCalledTimes(1);
    expect(deviceQueries()[0]!["monitorId"]).toBeDefined();
  });

  test("a device linked to the monitor by hand lands in the same list", async () => {
    jest.spyOn(LinkedAffectedResources, "readForMonitors").mockResolvedValue([
      {
        type: LinkedAffectedResourceType.NetworkDevice,
        id: OTHER_DEVICE_ID,
        name: "core-sw-01",
      },
    ]);
    bound = [device(DEVICE_ID)];

    const resolved: SeriesResolvedResourceIds = await read(websiteMonitor());

    expect(resolved.networkDeviceIds).toEqual([OTHER_DEVICE_ID, DEVICE_ID]);
  });

  test("a device read that fails costs the devices, never the resources linked by hand", async () => {
    jest.spyOn(LinkedAffectedResources, "readForMonitors").mockResolvedValue([
      {
        type: LinkedAffectedResourceType.Host,
        id: "h-1",
        name: "web-01",
      },
    ]);
    findBy.mockRejectedValue(new Error("connection reset"));
    const errorLog: jest.Mock = jest
      .spyOn(logger, "error")
      .mockImplementation((): void => {
        return undefined;
      }) as unknown as jest.Mock;

    const resolved: SeriesResolvedResourceIds = await read(websiteMonitor());

    expect(resolved.hostIds).toEqual(["h-1"]);
    expect(resolved.networkDeviceIds).toEqual([]);
    expect(String(errorLog.mock.calls[0]![0])).toContain("network devices");
  });

  test("a monitor without an id or a project reads nothing", async () => {
    const monitor: Monitor = new Monitor();
    monitor.projectId = PROJECT_ID;

    expect((await read(monitor)).networkDeviceIds).toEqual([]);
    expect(findBy).not.toHaveBeenCalled();
    expect(findMonitor).not.toHaveBeenCalled();
  });
});
