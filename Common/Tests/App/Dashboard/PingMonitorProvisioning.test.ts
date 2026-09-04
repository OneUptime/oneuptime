import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../MockType";
import ObjectID from "../../../Types/ObjectID";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import MonitorType from "../../../Types/Monitor/MonitorType";
import {
  MonitorCriteriaSeedIds,
  PingMonitorOrigin,
} from "../../../Utils/NetworkDiscovery/PingMonitorBuilder";

/*
 * The one client-side sequence three surfaces share — create a Ping monitor
 * on a device's address, bind it, roll the monitor back if the bind fails.
 *
 * The device create form, the "Create Ping Monitor" button on a device's
 * page and the device list's bulk action all go through this. What is pinned
 * here is the contract they rely on:
 *
 *   - the monitor is created FIRST and bound SECOND (the device already
 *     exists on every path), so a device is never left pointing at nothing;
 *   - a bind failure deletes the monitor again — a monitor is billable and
 *     plan-limited, and one that reports on nothing is exactly the orphan an
 *     operator cannot see the reason for;
 *   - an EMPTY probe selection sends no `probes` key at all. `[]` is truthy
 *     and the server honours an explicit empty selection as "attach no
 *     probes", which would create a monitor nothing ever evaluates;
 *   - seed ids handed in by a bulk caller are used as-is (one resolve per
 *     run, not per device);
 *   - the success copy never claims the device was verified reachable: a
 *     fresh monitor carries the project's operational status before any
 *     probe has checked the address.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-0000-4000-8000-000000000001",
);
const DEVICE_ID: ObjectID = new ObjectID(
  "22222222-0000-4000-8000-000000000001",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "33333333-0000-4000-8000-000000000001",
);

const SEED_IDS: MonitorCriteriaSeedIds = {
  onlineMonitorStatusId: new ObjectID("44444444-0000-4000-8000-000000000001"),
  offlineMonitorStatusId: new ObjectID("44444444-0000-4000-8000-000000000002"),
  defaultIncidentSeverityId: new ObjectID(
    "55555555-0000-4000-8000-000000000001",
  ),
  defaultAlertSeverityId: new ObjectID("66666666-0000-4000-8000-000000000001"),
};

const create: MockFunction = getJestMockFunction();
const updateById: MockFunction = getJestMockFunction();
const deleteItem: MockFunction = getJestMockFunction();
const resolveSeedIds: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      create: (...args: Array<unknown>) => {
        return create(...args);
      },
      updateById: (...args: Array<unknown>) => {
        return updateById(...args);
      },
      deleteItem: (...args: Array<unknown>) => {
        return deleteItem(...args);
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/PingMonitorSeedIds",
  () => {
    return {
      __esModule: true,
      default: {
        resolve: () => {
          return resolveSeedIds();
        },
      },
    };
  },
);

let currentProjectId: ObjectID | null = PROJECT_ID;

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        return currentProjectId;
      },
    },
  };
});

import {
  bindMonitorToDevice,
  pingMonitorProvisionedMessage,
  probeMiscDataProps,
  provisionPingMonitorForDevice,
  ProvisionedPingMonitor,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/PingMonitorProvisioning";

type CreateCall = {
  model: Monitor;
  modelType: unknown;
  miscDataProps: Record<string, unknown>;
};

function lastCreateCall(): CreateCall {
  expect(create).toHaveBeenCalledTimes(1);
  return create.mock.calls[0]![0] as CreateCall;
}

describe("probeMiscDataProps", () => {
  test("an empty selection sends no probes key, so the server picks the defaults", () => {
    expect(probeMiscDataProps([])).toEqual({});
  });

  test("blank entries are dropped, and an all-blank selection counts as empty", () => {
    expect(probeMiscDataProps(["", "  "])).toEqual({});
  });

  test("a real selection is forwarded trimmed", () => {
    expect(probeMiscDataProps([" probe-1 ", "probe-2"])).toEqual({
      probes: ["probe-1", "probe-2"],
    });
  });
});

describe("pingMonitorProvisionedMessage", () => {
  test("names the monitor and says when the first real result lands", () => {
    const message: string = pingMonitorProvisionedMessage("Ping lobby-ap-01");

    expect(message).toContain("Ping lobby-ap-01");
    expect(message).toContain("raise incidents");
    expect(message.toLowerCase()).toContain("interval");
  });

  /*
   * The device is polled by its probe whether or not this monitor exists, so
   * the monitor is an alerting mechanism rather than the device's status
   * source. The message used to say the device "carries the monitor's
   * starting status", which sent the operator to watch a pill that was
   * already being written by something else — and would read Pending on a
   * device its probe had answered for.
   */
  test("does not claim the monitor supplies the device's status", () => {
    const message: string = pingMonitorProvisionedMessage("Ping lobby-ap-01");

    expect(message).toContain("still comes from its probe's poll");
    expect(message).not.toContain("carries the monitor's starting status");
  });

  test("never claims the device was verified reachable", () => {
    const message: string = pingMonitorProvisionedMessage("Ping lobby-ap-01");

    expect(message.toLowerCase()).not.toContain("verified");
    expect(message.toLowerCase()).not.toContain("is reachable");
    expect(message.toLowerCase()).not.toContain("is up");
  });
});

describe("provisionPingMonitorForDevice", () => {
  beforeEach(() => {
    currentProjectId = PROJECT_ID;
    create.mockReset();
    updateById.mockReset();
    deleteItem.mockReset();
    resolveSeedIds.mockReset();

    create.mockResolvedValue({ data: { id: MONITOR_ID } } as never);
    updateById.mockResolvedValue({} as never);
    deleteItem.mockResolvedValue({} as never);
    resolveSeedIds.mockResolvedValue(SEED_IDS as never);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  async function provision(overrides: {
    probeIds?: Array<string>;
    seedIds?: MonitorCriteriaSeedIds;
    origin?: PingMonitorOrigin;
    address?: string;
  }): Promise<ProvisionedPingMonitor> {
    return provisionPingMonitorForDevice({
      deviceId: DEVICE_ID,
      deviceName: "lobby-ap-01",
      address: overrides.address ?? "10.0.0.7",
      probeIds: overrides.probeIds ?? [],
      origin: overrides.origin ?? PingMonitorOrigin.DeviceCreateForm,
      seedIds: overrides.seedIds,
    });
  }

  test("creates a Ping monitor on the device's address in the current project", async () => {
    await provision({});

    const call: CreateCall = lastCreateCall();

    expect(call.modelType).toBe(Monitor);
    expect(call.model.monitorType).toBe(MonitorType.Ping);
    expect(call.model.name).toBe("Ping lobby-ap-01");
    expect(call.model.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(
      call.model.monitorSteps?.data?.monitorStepsInstanceArray[0]?.data?.monitorDestination?.toString(),
    ).toBe("10.0.0.7");
  });

  test("then binds the new monitor to the device", async () => {
    const result: ProvisionedPingMonitor = await provision({});

    expect(updateById).toHaveBeenCalledTimes(1);
    const bind: {
      modelType: unknown;
      id: ObjectID;
      data: Record<string, unknown>;
    } = updateById.mock.calls[0]![0] as {
      modelType: unknown;
      id: ObjectID;
      data: Record<string, unknown>;
    };

    expect(bind.modelType).toBe(NetworkDevice);
    expect(bind.id.toString()).toBe(DEVICE_ID.toString());
    expect(bind.data).toEqual({ monitorId: MONITOR_ID.toString() });

    expect(result.monitorId.toString()).toBe(MONITOR_ID.toString());
    expect(result.monitorName).toBe("Ping lobby-ap-01");
  });

  test("creates before it binds", async () => {
    const order: Array<string> = [];

    create.mockImplementation(async () => {
      order.push("create");
      return { data: { id: MONITOR_ID } };
    });
    updateById.mockImplementation(async () => {
      order.push("bind");
      return {};
    });

    await provision({});

    expect(order).toEqual(["create", "bind"]);
  });

  test("an empty probe selection sends no probes key", async () => {
    await provision({ probeIds: [] });

    expect(lastCreateCall().miscDataProps).toEqual({});
  });

  test("a probe selection rides in miscDataProps", async () => {
    await provision({ probeIds: ["probe-1", "probe-2"] });

    expect(lastCreateCall().miscDataProps).toEqual({
      probes: ["probe-1", "probe-2"],
    });
  });

  test("resolves the seed ids when none are handed in", async () => {
    await provision({});

    expect(resolveSeedIds).toHaveBeenCalledTimes(1);
  });

  test("uses handed-in seed ids without resolving again", async () => {
    await provision({ seedIds: SEED_IDS });

    expect(resolveSeedIds).not.toHaveBeenCalled();
  });

  test("carries the origin into the monitor's description", async () => {
    await provision({ origin: PingMonitorOrigin.BulkAction });

    expect(lastCreateCall().model.description).toContain(
      "Create Ping Monitors",
    );
  });

  test("deletes the monitor again when the bind fails, and says so", async () => {
    updateById.mockRejectedValue(new Error("Monitor not found.") as never);

    await expect(provision({})).rejects.toThrow(/removed again/);

    expect(deleteItem).toHaveBeenCalledTimes(1);
    const deletion: { modelType: unknown; id: ObjectID } = deleteItem.mock
      .calls[0]![0] as { modelType: unknown; id: ObjectID };

    expect(deletion.modelType).toBe(Monitor);
    expect(deletion.id.toString()).toBe(MONITOR_ID.toString());
  });

  test("a cleanup failure does not hide the bind failure", async () => {
    updateById.mockRejectedValue(new Error("Monitor not found.") as never);
    deleteItem.mockRejectedValue(new Error("gone already") as never);

    await expect(provision({})).rejects.toThrow(/could not be bound/);
  });

  test("a create failure propagates and binds nothing", async () => {
    create.mockRejectedValue(
      new Error("You have reached the monitor limit for your plan.") as never,
    );

    await expect(provision({})).rejects.toThrow(/monitor limit/);

    expect(updateById).not.toHaveBeenCalled();
    expect(deleteItem).not.toHaveBeenCalled();
  });

  test("a create response with no id is refused rather than bound to nothing", async () => {
    create.mockResolvedValue({ data: {} } as never);

    await expect(provision({})).rejects.toThrow(/did not return its id/);

    expect(updateById).not.toHaveBeenCalled();
  });

  test("an empty address is refused before anything is created", async () => {
    await expect(provision({ address: "   " })).rejects.toThrow();

    expect(create).not.toHaveBeenCalled();
  });

  test("refuses to run with no project selected", async () => {
    currentProjectId = null;

    await expect(provision({})).rejects.toThrow(/project/i);

    expect(create).not.toHaveBeenCalled();
  });
});

describe("bindMonitorToDevice", () => {
  beforeEach(() => {
    updateById.mockReset();
    updateById.mockResolvedValue({} as never);
  });

  test("writes the monitorId column as a string, which both server spellings accept", async () => {
    await bindMonitorToDevice({ deviceId: DEVICE_ID, monitorId: MONITOR_ID });

    const bind: { id: ObjectID; data: Record<string, unknown> } = updateById
      .mock.calls[0]![0] as { id: ObjectID; data: Record<string, unknown> };

    expect(bind.id.toString()).toBe(DEVICE_ID.toString());
    expect(bind.data).toEqual({ monitorId: MONITOR_ID.toString() });
  });
});
