import MonitorService from "../../../Server/Services/MonitorService";
import { Service as NetworkDeviceServiceType } from "../../../Server/Services/NetworkDeviceService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import { beforeEach, describe, expect, test } from "@jest/globals";

/*
 * WHAT THIS FILE IS DEFENDING
 *
 * The tenancy guard on a NetworkDevice's monitor binding, on the UPDATE
 * path — and specifically that it RUNS.
 *
 * The FK behind `monitorId` only requires the Monitor row to exist, not that
 * it belongs to the device's project. onBeforeCreate checked that — but
 * only for a MONITOR-BACKED create, so an SNMP-method create (or one with
 * the method omitted) could persist another project's monitor FK unchecked
 * and read that monitor's configuration back through the relation.
 * onBeforeUpdate did not check at all: a device could be created clean and
 * then re-pointed at another project's monitor with a plain update, after
 * which refreshStampedMonitorStatus stamped that monitor's status onto the
 * device for the whole project to read. Both paths now run the same guard
 * on any binding that is supplied, whatever the method.
 *
 * onBeforeUpdate also has an early return, so a write that changes neither
 * site nor identity skips the snapshot read it does not need. A monitor
 * binding is exactly such a write — the dashboard's Device Details card
 * posts `monitor` and little else — so a guard placed below a return that
 * did not name the binding would be dead code on the only write it exists
 * for (the OID template guard was born that way; see
 * NetworkDeviceOidTemplateWriteGuards.test.ts). These tests therefore go
 * through the real hook, on a binding-only payload, in both spellings the
 * UI actually posts.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const OTHER_MONITOR_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
const DEVICE_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const SECOND_DEVICE_ID: ObjectID = new ObjectID(
  "66666666-6666-4666-8666-666666666666",
);

type DeviceServiceInternals = {
  onBeforeCreate: (
    createBy: CreateBy<NetworkDevice>,
  ) => Promise<OnCreate<NetworkDevice>>;
  onBeforeUpdate: (
    updateBy: UpdateBy<NetworkDevice>,
  ) => Promise<OnUpdate<NetworkDevice>>;
};

function buildDeviceService(): {
  service: NetworkDeviceServiceType;
  internals: DeviceServiceInternals;
} {
  const service: NetworkDeviceServiceType = new NetworkDeviceServiceType();
  return {
    service,
    internals: service as unknown as DeviceServiceInternals,
  };
}

/*
 * The device the update matches. Its projectId is what the guard scopes the
 * monitor lookup to.
 */
function matchedDevice(
  deviceId: ObjectID = DEVICE_ID,
  projectId: ObjectID = PROJECT_ID,
): NetworkDevice {
  const device: NetworkDevice = new NetworkDevice(deviceId);
  device.projectId = projectId;
  return device;
}

function monitorRow(): Monitor {
  const monitor: Monitor = new Monitor(MONITOR_ID);
  monitor.projectId = PROJECT_ID;
  return monitor;
}

/*
 * A payload that binds a monitor and NOTHING else — no site, no hostname,
 * no name, no sysName, no method. Precisely the shape that used to trip
 * onBeforeUpdate's early return.
 */
function bindingOnlyUpdate(
  spelling: "id" | "relation",
): UpdateBy<NetworkDevice> {
  const data: Record<string, unknown> =
    spelling === "id"
      ? { monitorId: MONITOR_ID }
      : { monitor: { _id: MONITOR_ID.toString() } };

  return {
    query: { _id: DEVICE_ID.toString() },
    data: data,
    props: { isRoot: true },
  } as unknown as UpdateBy<NetworkDevice>;
}

describe("binding a device to a monitor is tenant-checked on update", () => {
  /*
   * Typed loosely: jest.spyOn's SpiedFunction and this repo's @types/jest
   * disagree about the optionality of mock.lastCall, and these assertions
   * only need mockResolvedValue and the recorded calls.
   */
  let monitorFindSpy: {
    mockResolvedValue: (value: never) => unknown;
    mock: { calls: Array<Array<unknown>> };
  };

  beforeEach(() => {
    jest.restoreAllMocks();
    monitorFindSpy = jest.spyOn(
      MonitorService,
      "findOneBy",
    ) as unknown as typeof monitorFindSpy;
  });

  /*
   * THE regression test. The guard looks the monitor up INSIDE the device's
   * project, so another project's monitor comes back as "not found" — and
   * the write must be refused, not merely warned about. If the guard drifts
   * back below the early return this resolves cleanly and the cross-project
   * binding is persisted.
   */
  test.each(["id", "relation"] as const)(
    "refuses a monitor from another project when the payload writes only the %s",
    async (spelling: "id" | "relation") => {
      const { service, internals } = buildDeviceService();

      jest
        .spyOn(service, "findBy")
        .mockResolvedValue([matchedDevice()] as never);
      // What a project-scoped lookup returns for a foreign monitor.
      monitorFindSpy.mockResolvedValue(null as never);

      await expect(
        internals.onBeforeUpdate(bindingOnlyUpdate(spelling)),
      ).rejects.toThrow("Monitor not found.");
    },
  );

  test("scopes the lookup to the device's own project, by id", async () => {
    const { service, internals } = buildDeviceService();

    jest.spyOn(service, "findBy").mockResolvedValue([matchedDevice()] as never);
    monitorFindSpy.mockResolvedValue(monitorRow() as never);

    await internals.onBeforeUpdate(bindingOnlyUpdate("id"));

    expect(monitorFindSpy.mock.calls).toHaveLength(1);
    const query: Record<string, unknown> = (
      monitorFindSpy.mock.calls[0]![0] as { query: Record<string, unknown> }
    ).query;
    expect((query["_id"] as ObjectID).toString()).toBe(MONITOR_ID.toString());
    expect((query["projectId"] as ObjectID).toString()).toBe(
      PROJECT_ID.toString(),
    );
    expect((query["projectId"] as ObjectID).toString()).not.toBe(
      OTHER_PROJECT_ID.toString(),
    );
  });

  test("allows a monitor from the device's own project", async () => {
    const { service, internals } = buildDeviceService();

    jest.spyOn(service, "findBy").mockResolvedValue([matchedDevice()] as never);
    monitorFindSpy.mockResolvedValue(monitorRow() as never);

    await expect(
      internals.onBeforeUpdate(bindingOnlyUpdate("relation")),
    ).resolves.toBeDefined();
  });

  /*
   * The guard must actually reach the database rather than being skipped. A
   * hook that returns early looks identical to a hook that passed, so assert
   * the lookup happened — and that the snapshot read it depends on did too.
   */
  test("actually looks the monitor up, rather than returning early", async () => {
    const { service, internals } = buildDeviceService();

    const findBySpy: jest.SpyInstance = jest
      .spyOn(service, "findBy")
      .mockResolvedValue([matchedDevice()] as never);
    monitorFindSpy.mockResolvedValue(monitorRow() as never);

    await internals.onBeforeUpdate(bindingOnlyUpdate("id"));

    expect(findBySpy).toHaveBeenCalledTimes(1);
    expect(monitorFindSpy.mock.calls.length).toBeGreaterThan(0);
  });

  /*
   * TypeORM's precedence between the `monitorId` column and the `monitor`
   * relation is not a security boundary: a payload carrying both, pointed at
   * different rows, would have one validated and the other persisted. The
   * hook refuses the contradiction before any lookup, and before the
   * snapshot read, so it is refused on every write shape.
   */
  test("refuses a payload whose two spellings name different monitors", async () => {
    const { service, internals } = buildDeviceService();

    const findBySpy: jest.SpyInstance = jest
      .spyOn(service, "findBy")
      .mockResolvedValue([matchedDevice()] as never);
    monitorFindSpy.mockResolvedValue(monitorRow() as never);

    await expect(
      internals.onBeforeUpdate({
        query: { _id: DEVICE_ID.toString() },
        data: {
          monitorId: MONITOR_ID,
          monitor: { _id: OTHER_MONITOR_ID.toString() },
        },
        props: { isRoot: true },
      } as unknown as UpdateBy<NetworkDevice>),
    ).rejects.toThrow(/Conflicting Monitor references/);

    expect(monitorFindSpy.mock.calls).toHaveLength(0);
    expect(findBySpy).not.toHaveBeenCalled();
  });

  // ...and the column set alongside a null relation is the same contradiction.
  test("refuses an id in one spelling and an explicit null in the other", async () => {
    const { internals } = buildDeviceService();

    await expect(
      internals.onBeforeUpdate({
        query: { _id: DEVICE_ID.toString() },
        data: { monitorId: MONITOR_ID, monitor: null },
        props: { isRoot: true },
      } as unknown as UpdateBy<NetworkDevice>),
    ).rejects.toThrow(BadDataException);

    expect(monitorFindSpy.mock.calls).toHaveLength(0);
  });

  test("accepts both spellings when they agree", async () => {
    const { service, internals } = buildDeviceService();

    jest.spyOn(service, "findBy").mockResolvedValue([matchedDevice()] as never);
    monitorFindSpy.mockResolvedValue(monitorRow() as never);

    await expect(
      internals.onBeforeUpdate({
        query: { _id: DEVICE_ID.toString() },
        data: {
          monitorId: MONITOR_ID,
          monitor: { _id: MONITOR_ID.toString() },
        },
        props: { isRoot: true },
      } as unknown as UpdateBy<NetworkDevice>),
    ).resolves.toBeDefined();

    expect(monitorFindSpy.mock.calls).toHaveLength(1);
  });

  /*
   * Unbinding names no monitor, so there is nothing to check and nothing to
   * read: the write must cost no extra query.
   */
  test.each([
    ["monitorId", { monitorId: null }],
    ["monitor", { monitor: null }],
  ])(
    "does no lookup for an unbind written as %s: null",
    async (_label: string, data: Record<string, unknown>) => {
      const { service, internals } = buildDeviceService();

      const findBySpy: jest.SpyInstance = jest.spyOn(service, "findBy");

      await expect(
        internals.onBeforeUpdate({
          query: { _id: DEVICE_ID.toString() },
          data: data,
          props: { isRoot: true },
        } as unknown as UpdateBy<NetworkDevice>),
      ).resolves.toBeDefined();

      expect(monitorFindSpy.mock.calls).toHaveLength(0);
      expect(findBySpy).not.toHaveBeenCalled();
    },
  );

  test("does no lookup for an update that never mentions the monitor", async () => {
    const { internals } = buildDeviceService();

    await internals.onBeforeUpdate({
      query: { _id: DEVICE_ID.toString() },
      data: { pollingIntervalInMinutes: 10 },
      props: { isRoot: true },
    } as unknown as UpdateBy<NetworkDevice>);

    expect(monitorFindSpy.mock.calls).toHaveLength(0);
  });

  /*
   * A root caller's updateBy can span devices from more than one project.
   * Each project gets its own check — a monitor that belongs to one of them
   * does not belong to the other — and each only once.
   */
  test("checks once per distinct project in the matched set", async () => {
    const { service, internals } = buildDeviceService();

    jest
      .spyOn(service, "findBy")
      .mockResolvedValue([
        matchedDevice(DEVICE_ID, PROJECT_ID),
        matchedDevice(SECOND_DEVICE_ID, PROJECT_ID),
        matchedDevice(ObjectID.generate(), OTHER_PROJECT_ID),
      ] as never);
    monitorFindSpy.mockResolvedValue(monitorRow() as never);

    await internals.onBeforeUpdate({
      query: {},
      data: { monitorId: MONITOR_ID },
      props: { isRoot: true },
    } as unknown as UpdateBy<NetworkDevice>);

    const checkedProjects: Array<string> = monitorFindSpy.mock.calls.map(
      (callArgs: Array<unknown>) => {
        return (
          (callArgs[0] as { query: { projectId: ObjectID } }).query
            .projectId as ObjectID
        ).toString();
      },
    );

    expect(checkedProjects.sort()).toEqual(
      [PROJECT_ID.toString(), OTHER_PROJECT_ID.toString()].sort(),
    );
  });

  /*
   * onBeforeUpdate runs before DatabaseService permission-checks the query,
   * so the snapshot it reads as root has to be re-scoped to the caller's
   * tenant — otherwise the projects it checks against could be rows the
   * caller cannot see.
   */
  test("scopes the snapshot read to the caller's tenant", async () => {
    const { service, internals } = buildDeviceService();

    const findBySpy: jest.SpyInstance = jest
      .spyOn(service, "findBy")
      .mockResolvedValue([matchedDevice()] as never);
    monitorFindSpy.mockResolvedValue(monitorRow() as never);

    await internals.onBeforeUpdate({
      query: { _id: DEVICE_ID.toString() },
      data: { monitorId: MONITOR_ID },
      props: { tenantId: PROJECT_ID },
    } as unknown as UpdateBy<NetworkDevice>);

    const snapshotQuery: Record<string, unknown> = findBySpy.mock.calls[0]![0]
      .query as unknown as Record<string, unknown>;
    expect((snapshotQuery["projectId"] as ObjectID).toString()).toBe(
      PROJECT_ID.toString(),
    );
    expect(findBySpy.mock.calls[0]![0].props.isRoot).toBe(true);
  });
});

/*
 * The create path, for every method. The guard used to live inside the
 * monitor-backed branch of onBeforeCreate, so `{ monitoringMethod: "SNMP",
 * monitorId: <other project's> }` — or the method simply omitted, which
 * parses as SNMP — sailed through and persisted a foreign FK. A nested
 * select through the relation then reads that monitor's configuration.
 */
describe("binding a device to a monitor is tenant-checked on create", () => {
  let monitorFindSpy: {
    mockResolvedValue: (value: never) => unknown;
    mock: { calls: Array<Array<unknown>> };
  };

  beforeEach(() => {
    jest.restoreAllMocks();
    monitorFindSpy = jest.spyOn(
      MonitorService,
      "findOneBy",
    ) as unknown as typeof monitorFindSpy;
  });

  type Spelling = "id" | "relation";

  const METHODS: Array<[string, string | undefined]> = [
    ["SNMP", "SNMP"],
    ["no method at all", undefined],
    ["Monitor", "Monitor"],
  ];

  function creatingDevice(data: {
    method: string | undefined;
    spelling: Spelling | null;
  }): CreateBy<NetworkDevice> {
    const payload: Record<string, unknown> = {
      projectId: PROJECT_ID,
      name: "lobby-ap-01",
      hostname: "10.0.0.7",
    };

    if (data.method !== undefined) {
      payload["monitoringMethod"] = data.method;
    }

    if (data.spelling === "id") {
      payload["monitorId"] = OTHER_MONITOR_ID;
    } else if (data.spelling === "relation") {
      payload["monitor"] = { _id: OTHER_MONITOR_ID.toString() };
    }

    return {
      data: payload,
      props: { isRoot: true },
    } as unknown as CreateBy<NetworkDevice>;
  }

  describe.each(METHODS)(
    "with %s",
    (_label: string, method: string | undefined) => {
      test.each(["id", "relation"] as Array<Spelling>)(
        "refuses another project's monitor bound by %s",
        async (spelling: Spelling) => {
          const { internals } = buildDeviceService();
          monitorFindSpy.mockResolvedValue(null as never);

          await expect(
            internals.onBeforeCreate(
              creatingDevice({ method: method, spelling: spelling }),
            ),
          ).rejects.toThrow(new BadDataException("Monitor not found."));
        },
      );

      test.each(["id", "relation"] as Array<Spelling>)(
        "looks the monitor up inside the device's own project when bound by %s",
        async (spelling: Spelling) => {
          const { internals } = buildDeviceService();
          monitorFindSpy.mockResolvedValue(monitorRow() as never);

          await internals.onBeforeCreate(
            creatingDevice({ method: method, spelling: spelling }),
          );

          expect(monitorFindSpy.mock.calls).toHaveLength(1);
          const query: Record<string, unknown> = (
            monitorFindSpy.mock.calls[0]![0] as {
              query: Record<string, unknown>;
            }
          ).query;

          expect(String(query["_id"])).toBe(OTHER_MONITOR_ID.toString());
          expect(String(query["projectId"])).toBe(PROJECT_ID.toString());
          expect(String(query["projectId"])).not.toBe(
            OTHER_PROJECT_ID.toString(),
          );
        },
      );

      test("makes no lookup when no binding is supplied", async () => {
        const { internals } = buildDeviceService();

        await internals.onBeforeCreate(
          creatingDevice({ method: method, spelling: null }),
        );

        expect(monitorFindSpy.mock.calls).toHaveLength(0);
      });
    },
  );

  /*
   * The half that did not move: a monitor-backed create still turns polling
   * off, and an SNMP create still leaves it alone.
   */
  test("still switches polling off for a monitor-backed create", async () => {
    const { internals } = buildDeviceService();

    const result: OnCreate<NetworkDevice> = await internals.onBeforeCreate(
      creatingDevice({ method: "Monitor", spelling: null }),
    );

    expect(result.createBy.data.isPollingEnabled).toBe(false);
  });

  test("leaves polling alone for an SNMP create", async () => {
    const { internals } = buildDeviceService();

    const result: OnCreate<NetworkDevice> = await internals.onBeforeCreate(
      creatingDevice({ method: "SNMP", spelling: null }),
    );

    expect(result.createBy.data.isPollingEnabled).toBeUndefined();
  });
});
