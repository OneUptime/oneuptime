import { Service as NetworkDeviceServiceType } from "../../../Server/Services/NetworkDeviceService";
import NetworkSnmpCredentialProfileService from "../../../Server/Services/NetworkSnmpCredentialProfileService";
import ProbeService from "../../../Server/Services/ProbeService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import NetworkSnmpCredentialProfile from "../../../Models/DatabaseModels/NetworkSnmpCredentialProfile";
import Probe from "../../../Models/DatabaseModels/Probe";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import { EntityManager } from "typeorm";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

/*
 * WHAT THIS FILE IS DEFENDING
 *
 * The two references that make device polling a tenancy boundary:
 *
 *   probeId  - WHO reaches into the customer's network for this device. A
 *              probe that can claim a device reads its hostname and its SNMP
 *              credentials, walks it, and reports status back.
 *   snmpCredentialProfileId - WHAT is put on the wire when it gets there.
 *
 * Neither foreign key requires the referenced row to belong to the device's
 * project, and both ids arrive from the browser (the create form, the
 * settings page, the device-list bulk actions). So each has to be checked at
 * the point it is written, on BOTH hooks — a device created clean and then
 * re-pointed with a plain update is the same breach as one created that way.
 *
 * The failure this file exists to catch is not "the check is wrong". It is
 * "the check never runs". onBeforeUpdate returns early for any write that
 * touches neither site nor identity, and assigning a probe or a profile is
 * exactly such a write — the shape the settings form actually posts — so a
 * guard placed below that return is dead code on the only path it exists
 * for. Nothing fails; the guard is simply skipped, which is the worst shape
 * a security check can take. Every update case below therefore goes through
 * the real hook on a payload that trips the early return, in both spellings
 * the UI posts.
 *
 * The last describe covers the DB backstop: rows written before these guards
 * existed are still on disk, so the claim query must refuse them too.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const PROBE_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const PROFILE_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const DEVICE_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
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

// The device the update matches; its projectId is what the guards compare against.
function matchedDevice(): NetworkDevice {
  const device: NetworkDevice = new NetworkDevice(DEVICE_ID);
  device.projectId = PROJECT_ID;
  return device;
}

function probeInProject(projectId: ObjectID | undefined): Probe {
  const probe: Probe = new Probe(PROBE_ID);
  if (projectId) {
    probe.projectId = projectId;
  }
  return probe;
}

function profileInProject(projectId: ObjectID): NetworkSnmpCredentialProfile {
  const profile: NetworkSnmpCredentialProfile =
    new NetworkSnmpCredentialProfile(PROFILE_ID);
  profile.projectId = projectId;
  profile.name = "Branch v2c";
  return profile;
}

/*
 * A payload that assigns ONLY a probe (or only a profile) — no site, no
 * hostname, no name, no sysName. This is what the settings page and the bulk
 * actions post, and it is precisely the shape that trips onBeforeUpdate's
 * early return.
 */
function probeOnlyUpdate(spelling: "id" | "relation"): UpdateBy<NetworkDevice> {
  return {
    query: { _id: DEVICE_ID.toString() },
    data:
      spelling === "id"
        ? { probeId: PROBE_ID }
        : { probe: probeInProject(PROJECT_ID) },
    props: { isRoot: true },
  } as unknown as UpdateBy<NetworkDevice>;
}

function profileOnlyUpdate(
  spelling: "id" | "relation",
): UpdateBy<NetworkDevice> {
  return {
    query: { _id: DEVICE_ID.toString() },
    data:
      spelling === "id"
        ? { snmpCredentialProfileId: PROFILE_ID }
        : { snmpCredentialProfile: profileInProject(PROJECT_ID) },
    props: { isRoot: true },
  } as unknown as UpdateBy<NetworkDevice>;
}

/*
 * The real predicate, stubbed at its own boundary: a probe is attachable
 * when it is global (no project of its own) or belongs to the project. That
 * rule lives in ProbeService and is tested there; what matters here is that
 * the device service asks.
 */
function stubProbeAttachability(probeProjectId: ObjectID | undefined): {
  mock: { calls: Array<Array<unknown>> };
} {
  const spy: unknown = jest
    .spyOn(ProbeService, "getProbesAttachableToProject")
    .mockImplementation(
      async (data: {
        probeIds: Array<ObjectID>;
        projectId: ObjectID;
      }): Promise<Array<Probe>> => {
        const isAttachable: boolean =
          probeProjectId === undefined ||
          probeProjectId.toString() === data.projectId.toString();

        return isAttachable ? [probeInProject(probeProjectId)] : [];
      },
    );

  return spy as { mock: { calls: Array<Array<unknown>> } };
}

describe("assigning a probe to a device is tenant-checked", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  /*
   * THE regression test. If the guard drifts back below the early return,
   * this resolves cleanly and another project's probe is persisted onto the
   * device — and that probe claims it on its next poll. The assertion has to
   * be that the hook REJECTS, not merely that some code path exists.
   */
  test.each(["id", "relation"] as const)(
    "refuses a probe from another project when the payload writes only the %s",
    async (spelling: "id" | "relation") => {
      const { service, internals } = buildDeviceService();

      jest
        .spyOn(service, "findBy")
        .mockResolvedValue([matchedDevice()] as never);
      stubProbeAttachability(OTHER_PROJECT_ID);

      await expect(
        internals.onBeforeUpdate(probeOnlyUpdate(spelling)),
      ).rejects.toThrow(/does not belong to this project/);
    },
  );

  test("allows a probe from the device's own project", async () => {
    const { service, internals } = buildDeviceService();

    jest.spyOn(service, "findBy").mockResolvedValue([matchedDevice()] as never);
    stubProbeAttachability(PROJECT_ID);

    await expect(
      internals.onBeforeUpdate(probeOnlyUpdate("id")),
    ).resolves.toBeDefined();
  });

  /*
   * A global probe has no project at all. Refusing it would break the
   * default deployment, where the only probe there is is global.
   */
  test("allows a global probe, which belongs to no project", async () => {
    const { service, internals } = buildDeviceService();

    jest.spyOn(service, "findBy").mockResolvedValue([matchedDevice()] as never);
    stubProbeAttachability(undefined);

    await expect(
      internals.onBeforeUpdate(probeOnlyUpdate("id")),
    ).resolves.toBeDefined();
  });

  /*
   * A hook that returned early looks identical to a hook that passed, so the
   * lookup itself is asserted: the guard must actually reach ProbeService.
   */
  test("actually asks ProbeService, rather than returning early", async () => {
    const { service, internals } = buildDeviceService();

    jest.spyOn(service, "findBy").mockResolvedValue([matchedDevice()] as never);
    const probeLookup: { mock: { calls: Array<Array<unknown>> } } =
      stubProbeAttachability(PROJECT_ID);

    await internals.onBeforeUpdate(probeOnlyUpdate("id"));

    expect(probeLookup.mock.calls.length).toBeGreaterThan(0);
  });

  test("checks the probe on create too", async () => {
    const { internals } = buildDeviceService();

    stubProbeAttachability(OTHER_PROJECT_ID);

    const device: NetworkDevice = new NetworkDevice();
    device.projectId = PROJECT_ID;
    device.probeId = PROBE_ID;

    await expect(
      internals.onBeforeCreate({
        data: device,
        props: { isRoot: true },
      } as CreateBy<NetworkDevice>),
    ).rejects.toThrow(/does not belong to this project/);
  });

  /*
   * DatabaseService stamps the tenant column AFTER onBeforeCreate runs, so a
   * device created from the dashboard reaches the hook with projectId unset
   * and only props.tenantId to go on. Reading only data.projectId would skip
   * this guard for every UI create — i.e. for the only path a browser can
   * take.
   */
  test("checks the probe on a dashboard create, where the tenant is only on props", async () => {
    const { internals } = buildDeviceService();

    stubProbeAttachability(OTHER_PROJECT_ID);

    const device: NetworkDevice = new NetworkDevice();
    device.probeId = PROBE_ID;

    await expect(
      internals.onBeforeCreate({
        data: device,
        props: { tenantId: PROJECT_ID },
      } as CreateBy<NetworkDevice>),
    ).rejects.toThrow(/does not belong to this project/);
  });

  /*
   * TypeORM's precedence between the FK column and the relation object is not
   * a security boundary: whichever one is validated, the OTHER may be the one
   * persisted. The contradiction is refused rather than picked from.
   */
  test("refuses a payload that points probeId and probe at different rows", async () => {
    const { service, internals } = buildDeviceService();

    jest.spyOn(service, "findBy").mockResolvedValue([matchedDevice()] as never);
    stubProbeAttachability(PROJECT_ID);

    const conflicting: UpdateBy<NetworkDevice> = {
      query: { _id: DEVICE_ID.toString() },
      data: {
        probeId: PROBE_ID,
        probe: new Probe(new ObjectID("66666666-6666-4666-8666-666666666666")),
      },
      props: { isRoot: true },
    } as unknown as UpdateBy<NetworkDevice>;

    await expect(internals.onBeforeUpdate(conflicting)).rejects.toThrow(
      /Conflicting Probe references/,
    );
  });

  test("does no probe lookup for an update that assigns none", async () => {
    const { internals } = buildDeviceService();
    const probeLookup: { mock: { calls: Array<Array<unknown>> } } =
      stubProbeAttachability(PROJECT_ID);

    await internals.onBeforeUpdate({
      query: { _id: DEVICE_ID.toString() },
      data: { pollingIntervalInMinutes: 10 },
      props: { isRoot: true },
    } as unknown as UpdateBy<NetworkDevice>);

    expect(probeLookup.mock.calls).toHaveLength(0);
  });
});

describe("assigning an SNMP credential profile to a device is tenant-checked", () => {
  let profileFindSpy: {
    mockResolvedValue: (value: never) => unknown;
    mock: { calls: Array<Array<unknown>> };
  };

  beforeEach(() => {
    jest.restoreAllMocks();
    profileFindSpy = jest.spyOn(
      NetworkSnmpCredentialProfileService,
      "findOneById",
    ) as unknown as typeof profileFindSpy;
  });

  /*
   * The same early-return hazard as the probe, and a worse consequence: a
   * profile is read LIVE at poll time, so a cross-project reference puts
   * another project's community string on this project's probe's wire.
   */
  test.each(["id", "relation"] as const)(
    "refuses a profile from another project when the payload writes only the %s",
    async (spelling: "id" | "relation") => {
      const { service, internals } = buildDeviceService();

      jest
        .spyOn(service, "findBy")
        .mockResolvedValue([matchedDevice()] as never);
      profileFindSpy.mockResolvedValue(
        profileInProject(OTHER_PROJECT_ID) as never,
      );

      await expect(
        internals.onBeforeUpdate(profileOnlyUpdate(spelling)),
      ).rejects.toThrow(/must belong to the same project/);
    },
  );

  test("allows a profile from the device's own project", async () => {
    const { service, internals } = buildDeviceService();

    jest.spyOn(service, "findBy").mockResolvedValue([matchedDevice()] as never);
    profileFindSpy.mockResolvedValue(profileInProject(PROJECT_ID) as never);

    await expect(
      internals.onBeforeUpdate(profileOnlyUpdate("id")),
    ).resolves.toBeDefined();
  });

  test("actually looks the profile up, rather than returning early", async () => {
    const { service, internals } = buildDeviceService();

    jest.spyOn(service, "findBy").mockResolvedValue([matchedDevice()] as never);
    profileFindSpy.mockResolvedValue(profileInProject(PROJECT_ID) as never);

    await internals.onBeforeUpdate(profileOnlyUpdate("id"));

    expect(profileFindSpy.mock.calls.length).toBeGreaterThan(0);
  });

  test("refuses a profile that does not exist at all", async () => {
    const { service, internals } = buildDeviceService();

    jest.spyOn(service, "findBy").mockResolvedValue([matchedDevice()] as never);
    profileFindSpy.mockResolvedValue(null as never);

    await expect(
      internals.onBeforeUpdate(profileOnlyUpdate("id")),
    ).rejects.toThrow(BadDataException);
  });

  test("checks the profile on create too", async () => {
    const { internals } = buildDeviceService();

    profileFindSpy.mockResolvedValue(
      profileInProject(OTHER_PROJECT_ID) as never,
    );

    const device: NetworkDevice = new NetworkDevice();
    device.projectId = PROJECT_ID;
    device.snmpCredentialProfileId = PROFILE_ID;

    await expect(
      internals.onBeforeCreate({
        data: device,
        props: { isRoot: true },
      } as CreateBy<NetworkDevice>),
    ).rejects.toThrow(/must belong to the same project/);
  });

  test("refuses a payload that points the two profile spellings at different rows", async () => {
    const { service, internals } = buildDeviceService();

    jest.spyOn(service, "findBy").mockResolvedValue([matchedDevice()] as never);
    profileFindSpy.mockResolvedValue(profileInProject(PROJECT_ID) as never);

    const conflicting: UpdateBy<NetworkDevice> = {
      query: { _id: DEVICE_ID.toString() },
      data: {
        snmpCredentialProfileId: PROFILE_ID,
        snmpCredentialProfile: new NetworkSnmpCredentialProfile(
          new ObjectID("77777777-7777-4777-8777-777777777777"),
        ),
      },
      props: { isRoot: true },
    } as unknown as UpdateBy<NetworkDevice>;

    await expect(internals.onBeforeUpdate(conflicting)).rejects.toThrow(
      /Conflicting SNMP Credential Profile references/,
    );
  });

  test("does no profile lookup for an update that assigns none", async () => {
    const { internals } = buildDeviceService();

    await internals.onBeforeUpdate({
      query: { _id: DEVICE_ID.toString() },
      data: { pollingIntervalInMinutes: 10 },
      props: { isRoot: true },
    } as unknown as UpdateBy<NetworkDevice>);

    expect(profileFindSpy.mock.calls).toHaveLength(0);
  });
});

/*
 * The DB backstop.
 *
 * The write guards above are the half that gives an operator an error at the
 * point of the mistake. This is the half that makes a row written BEFORE
 * they existed unpollable rather than merely unwritable — without it, a
 * device already pointed at another project's probe keeps being claimed by
 * it forever, because nothing ever rewrites that row.
 *
 * Asserted against the SQL text because the predicate cannot be exercised
 * without a live Postgres, and its absence is otherwise completely invisible:
 * the query still runs, still returns rows, and simply hands out devices it
 * should not.
 */
describe("the polling claim query refuses a probe from another project", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  async function capturedClaimSql(): Promise<string> {
    const { service } = buildDeviceService();
    const statements: Array<string> = [];

    jest
      .spyOn(service, "executeTransaction")
      .mockImplementation(
        async <TResult>(
          runInTransaction: (entityManager: EntityManager) => Promise<TResult>,
        ): Promise<TResult> => {
          const entityManager: {
            query: (sql: string) => Promise<Array<never>>;
          } = {
            query: async (sql: string): Promise<Array<never>> => {
              statements.push(sql);
              return [];
            },
          };

          return await runInTransaction(
            entityManager as unknown as EntityManager,
          );
        },
      );

    await service.claimDevicesForPolling({ probeId: PROBE_ID, limit: 10 });

    return statements.join("\n").replace(/\s+/g, " ");
  }

  test("joins Probe and requires it to be global or in the device's project", async () => {
    const sql: string = await capturedClaimSql();

    expect(sql).toContain('INNER JOIN "Probe" pr ON nd."probeId" = pr."_id"');
    expect(sql).toContain(
      'AND (pr."isGlobalProbe" = true OR pr."projectId" = nd."projectId")',
    );
  });

  /*
   * The row lock must stay on the device rows alone. Widening it to the
   * joined tables would take FOR UPDATE locks on Probe and Project rows that
   * every other probe's claim also touches, turning SKIP LOCKED contention
   * between unrelated probes into serialisation across the whole fleet.
   */
  test("still locks only the device rows", async () => {
    const sql: string = await capturedClaimSql();

    expect(sql).toContain("FOR UPDATE OF nd SKIP LOCKED");
  });
});
