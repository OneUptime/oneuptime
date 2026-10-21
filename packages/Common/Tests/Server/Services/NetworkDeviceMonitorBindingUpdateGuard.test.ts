import { Service as NetworkDeviceServiceType } from "../../../Server/Services/NetworkDeviceService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import { ProjectScopedReferenceException } from "../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import { beforeEach, describe, expect, test } from "@jest/globals";
import {
  ProjectDirectoryStub,
  stubProjectDirectory,
} from "../TestingUtils/ProjectDirectory";
import {
  RowsCallerMayWriteRead,
  readsOfRowsCallerMayWrite,
  stubRowsCallerMayWriteLikeFindBy,
} from "../TestingUtils/RowsCallerMayWrite";

/*
 * WHAT THIS FILE IS DEFENDING
 *
 * The tenancy guard on a NetworkDevice's monitor binding, on the UPDATE
 * path — and specifically that it RUNS.
 *
 * The FK behind `monitorId` only requires the Monitor row to exist, not that
 * it belongs to the device's project. A device created clean and then
 * re-pointed at another project's monitor with a plain update would have
 * refreshStampedMonitorStatus stamp that monitor's status onto the device for
 * the whole project to read, and a nested select through the relation reads
 * that monitor's configuration. Every write that binds a monitor - create or
 * update, whatever the monitoring method - is now checked by the generic
 * reference check (ProjectReferencesService): the monitor is read pinned to
 * the device's project, so another project's monitor reads exactly like one
 * that does not exist.
 *
 * onBeforeUpdate also has an early return, so a write that changes neither
 * site nor identity skips the snapshot read it does not need. A monitor
 * binding is exactly such a write — the dashboard's Device Details card
 * posts `monitor` and little else — so the check must run before that
 * return. These tests therefore go through the real hook, on a binding-only
 * payload, in both spellings the UI actually posts.
 *
 * The project's directory is stubbed (ProjectDirectory): MONITOR_ID is the
 * project's monitor, OTHER_MONITOR_ID belongs to another project.
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
const SECOND_OWN_MONITOR_ID: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777777",
);
const MISSING_MONITOR_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-0000000000dd",
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

  /*
   * The read of the rows a caller's update may write, which the update path
   * makes before the hooks: what the suite's read of the devices answers.
   */
  stubRowsCallerMayWriteLikeFindBy(service, jest.spyOn(service, "findBy"));

  return {
    service,
    internals: service as unknown as DeviceServiceInternals,
  };
}

/*
 * The device the update matches. Its projectId is what the check scopes the
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

/*
 * A payload that binds a monitor and NOTHING else — no site, no hostname,
 * no name, no sysName, no method. Precisely the shape that trips
 * onBeforeUpdate's early return.
 */
function bindingOnlyUpdate(
  spelling: "id" | "relation",
  monitorId: ObjectID = MONITOR_ID,
): UpdateBy<NetworkDevice> {
  const data: Record<string, unknown> =
    spelling === "id"
      ? { monitorId: monitorId }
      : { monitor: { _id: monitorId.toString() } };

  return {
    query: { _id: DEVICE_ID.toString() },
    data: data,
    props: { isRoot: true },
  } as unknown as UpdateBy<NetworkDevice>;
}

function refusalFor(monitorId: ObjectID): string {
  return `This network device references records that are not in this project: Monitor "${monitorId.toString()}". Please pick values from this project and try again.`;
}

let directory: ProjectDirectoryStub;

function monitorLookups(): Array<{ projectId: string; ids: Array<string> }> {
  return directory.recordLookups.filter(
    (lookup: { model: string }): boolean => {
      return lookup.model === "Monitor";
    },
  );
}

beforeEach(() => {
  jest.restoreAllMocks();
  directory = stubProjectDirectory({
    projectId: PROJECT_ID,
    records: {
      Monitor: [MONITOR_ID.toString(), SECOND_OWN_MONITOR_ID.toString()],
    },
  });
});

describe("binding a device to a monitor is tenant-checked on update", () => {
  /*
   * THE regression test. The monitor is looked up INSIDE the device's
   * project, so another project's monitor is refused - not merely warned
   * about. If the check drifts back below the early return this resolves
   * cleanly and the cross-project binding is persisted.
   */
  test.each(["id", "relation"] as const)(
    "refuses a monitor from another project when the payload writes only the %s",
    async (spelling: "id" | "relation") => {
      const { service, internals } = buildDeviceService();

      jest
        .spyOn(service, "findBy")
        .mockResolvedValue([matchedDevice()] as never);

      await expect(
        internals.onBeforeUpdate(bindingOnlyUpdate(spelling, OTHER_MONITOR_ID)),
      ).rejects.toThrow(refusalFor(OTHER_MONITOR_ID));
    },
  );

  test("answers a monitor that does not exist exactly as one of another project", async () => {
    const { service, internals } = buildDeviceService();

    jest.spyOn(service, "findBy").mockResolvedValue([matchedDevice()] as never);

    await expect(
      internals.onBeforeUpdate(bindingOnlyUpdate("id", MISSING_MONITOR_ID)),
    ).rejects.toThrow(refusalFor(MISSING_MONITOR_ID));
  });

  test("scopes the lookup to the device's own project, by id", async () => {
    const { service, internals } = buildDeviceService();

    jest.spyOn(service, "findBy").mockResolvedValue([matchedDevice()] as never);

    await internals.onBeforeUpdate(bindingOnlyUpdate("id"));

    expect(monitorLookups()).toHaveLength(1);
    expect(monitorLookups()[0]!.ids).toEqual([MONITOR_ID.toString()]);
    expect(monitorLookups()[0]!.projectId).toBe(PROJECT_ID.toString());
    expect(monitorLookups()[0]!.projectId).not.toBe(
      OTHER_PROJECT_ID.toString(),
    );
  });

  test("allows a monitor from the device's own project", async () => {
    const { service, internals } = buildDeviceService();

    jest.spyOn(service, "findBy").mockResolvedValue([matchedDevice()] as never);

    await expect(
      internals.onBeforeUpdate(bindingOnlyUpdate("relation")),
    ).resolves.toBeDefined();
  });

  /*
   * The check must actually reach the database rather than being skipped. A
   * hook that returns early looks identical to a hook that passed, so assert
   * the lookup happened — and that the snapshot read the service depends on
   * did too.
   */
  test("actually looks the monitor up, rather than returning early", async () => {
    const { service, internals } = buildDeviceService();

    const findBySpy: jest.SpyInstance = jest
      .spyOn(service, "findBy")
      .mockResolvedValue([matchedDevice()] as never);

    await internals.onBeforeUpdate(bindingOnlyUpdate("id"));

    expect(findBySpy).toHaveBeenCalled();
    expect(monitorLookups().length).toBeGreaterThan(0);
  });

  /*
   * TypeORM's precedence between the `monitorId` column and the `monitor`
   * relation is not a security boundary: a payload carrying both, pointed at
   * different rows, would have one validated and the other persisted. Both
   * spellings are checked, and the contradiction is refused on every write
   * shape - even when both monitors are the project's own.
   */
  test("refuses a payload whose two spellings name different monitors", async () => {
    const { service, internals } = buildDeviceService();

    jest.spyOn(service, "findBy").mockResolvedValue([matchedDevice()] as never);

    await expect(
      internals.onBeforeUpdate({
        query: { _id: DEVICE_ID.toString() },
        data: {
          monitorId: MONITOR_ID,
          monitor: { _id: SECOND_OWN_MONITOR_ID.toString() },
        },
        props: { isRoot: true },
      } as unknown as UpdateBy<NetworkDevice>),
    ).rejects.toThrow(/Conflicting Monitor references/);
  });

  test("refuses another project's monitor in either spelling, even beside the project's own", async () => {
    const { service, internals } = buildDeviceService();

    jest.spyOn(service, "findBy").mockResolvedValue([matchedDevice()] as never);

    await expect(
      internals.onBeforeUpdate({
        query: { _id: DEVICE_ID.toString() },
        data: {
          monitorId: MONITOR_ID,
          monitor: { _id: OTHER_MONITOR_ID.toString() },
        },
        props: { isRoot: true },
      } as unknown as UpdateBy<NetworkDevice>),
    ).rejects.toThrow(refusalFor(OTHER_MONITOR_ID));
  });

  // ...and the column set alongside a null relation is the same contradiction.
  test("refuses an id in one spelling and an explicit null in the other", async () => {
    const { service, internals } = buildDeviceService();

    jest.spyOn(service, "findBy").mockResolvedValue([matchedDevice()] as never);

    await expect(
      internals.onBeforeUpdate({
        query: { _id: DEVICE_ID.toString() },
        data: { monitorId: MONITOR_ID, monitor: null },
        props: { isRoot: true },
      } as unknown as UpdateBy<NetworkDevice>),
    ).rejects.toThrow(BadDataException);
  });

  test("accepts both spellings when they agree, looking the monitor up once", async () => {
    const { service, internals } = buildDeviceService();

    jest.spyOn(service, "findBy").mockResolvedValue([matchedDevice()] as never);

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

    expect(monitorLookups()).toHaveLength(1);
    expect(monitorLookups()[0]!.ids).toEqual([MONITOR_ID.toString()]);
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

      expect(monitorLookups()).toHaveLength(0);
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

    expect(monitorLookups()).toHaveLength(0);
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

    // The monitor is PROJECT_ID's, so the other project refuses it.
    await expect(
      internals.onBeforeUpdate({
        query: {},
        data: { monitorId: MONITOR_ID },
        props: { isRoot: true },
      } as unknown as UpdateBy<NetworkDevice>),
    ).rejects.toBeInstanceOf(ProjectScopedReferenceException);

    const checkedProjects: Array<string> = monitorLookups().map(
      (lookup: { projectId: string }): string => {
        return lookup.projectId;
      },
    );

    expect(checkedProjects.sort()).toEqual(
      [PROJECT_ID.toString(), OTHER_PROJECT_ID.toString()].sort(),
    );
  });

  /*
   * The service's own snapshot is read as root, among the devices the caller
   * may write - found in the caller's project - so the projects it acts on
   * are never rows the caller cannot see.
   */
  test("reads the snapshot among the devices the caller may write, in their project", async () => {
    const { service, internals } = buildDeviceService();

    const findBySpy: jest.SpyInstance = jest
      .spyOn(service, "findBy")
      .mockResolvedValue([matchedDevice()] as never);

    await internals.onBeforeUpdate({
      query: { _id: DEVICE_ID.toString() },
      data: { monitorId: MONITOR_ID },
      props: { tenantId: PROJECT_ID },
    } as unknown as UpdateBy<NetworkDevice>);

    const writable: RowsCallerMayWriteRead =
      readsOfRowsCallerMayWrite(service)[0]!;
    expect(
      (writable.query["projectId"] as unknown as ObjectID).toString(),
    ).toBe(PROJECT_ID.toString());
    // Then those, by id, as root.
    expect(findBySpy.mock.calls[0]![0].query).toEqual({
      _id: DEVICE_ID.toString(),
    });
    expect(findBySpy.mock.calls[0]![0].props.isRoot).toBe(true);
    // The monitor was checked against the caller's project, not read again.
    expect(monitorLookups()[0]!.projectId).toBe(PROJECT_ID.toString());
  });
});

/*
 * The create path, for every method. A guard that only ran inside the
 * monitor-backed branch of onBeforeCreate let `{ monitoringMethod: "SNMP",
 * monitorId: <other project's> }` — or the method simply omitted, which
 * parses as SNMP — persist a foreign FK. A nested select through the
 * relation then reads that monitor's configuration.
 */
describe("binding a device to a monitor is tenant-checked on create", () => {
  type Spelling = "id" | "relation";

  const METHODS: Array<[string, string | undefined]> = [
    ["SNMP", "SNMP"],
    ["no method at all", undefined],
    ["Monitor", "Monitor"],
  ];

  function creatingDevice(data: {
    method: string | undefined;
    spelling: Spelling | null;
    monitorId?: ObjectID | undefined;
  }): CreateBy<NetworkDevice> {
    const monitorId: ObjectID = data.monitorId || OTHER_MONITOR_ID;
    const payload: Record<string, unknown> = {
      projectId: PROJECT_ID,
      name: "lobby-ap-01",
      hostname: "10.0.0.7",
    };

    if (data.method !== undefined) {
      payload["monitoringMethod"] = data.method;
    }

    if (data.spelling === "id") {
      payload["monitorId"] = monitorId;
    } else if (data.spelling === "relation") {
      payload["monitor"] = { _id: monitorId.toString() };
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

          await expect(
            internals.onBeforeCreate(
              creatingDevice({ method: method, spelling: spelling }),
            ),
          ).rejects.toThrow(refusalFor(OTHER_MONITOR_ID));
        },
      );

      test.each(["id", "relation"] as Array<Spelling>)(
        "looks the monitor up inside the device's own project when bound by %s",
        async (spelling: Spelling) => {
          const { internals } = buildDeviceService();

          await internals.onBeforeCreate(
            creatingDevice({
              method: method,
              spelling: spelling,
              monitorId: MONITOR_ID,
            }),
          );

          expect(monitorLookups()).toHaveLength(1);
          expect(monitorLookups()[0]!.ids).toEqual([MONITOR_ID.toString()]);
          expect(monitorLookups()[0]!.projectId).toBe(PROJECT_ID.toString());
          expect(monitorLookups()[0]!.projectId).not.toBe(
            OTHER_PROJECT_ID.toString(),
          );
        },
      );

      test("makes no lookup when no binding is supplied", async () => {
        const { internals } = buildDeviceService();

        await internals.onBeforeCreate(
          creatingDevice({ method: method, spelling: null }),
        );

        expect(monitorLookups()).toHaveLength(0);
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
