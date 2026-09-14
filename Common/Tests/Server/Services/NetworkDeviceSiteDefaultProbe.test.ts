import { Service as NetworkDeviceServiceType } from "../../../Server/Services/NetworkDeviceService";
import NetworkSiteService from "../../../Server/Services/NetworkSiteService";
import ProbeService from "../../../Server/Services/ProbeService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import NetworkSite from "../../../Models/DatabaseModels/NetworkSite";
import Probe from "../../../Models/DatabaseModels/Probe";
import NetworkDeviceMonitoringMethod from "../../../Types/NetworkDevice/NetworkDeviceMonitoringMethod";
import ObjectID from "../../../Types/ObjectID";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

/*
 * WHAT THIS FILE IS DEFENDING
 *
 * The site's default probe, and specifically that it is COPIED AT WRITE.
 *
 * The feature exists so an operator can register a device with a name and an
 * address and nothing else: the site it lands in supplies the probe, and the
 * device polls from its first cycle instead of sitting Pending until someone
 * notices the empty field. Inheritance walks UP the hierarchy, so a Region's
 * probe covers every Market beneath it.
 *
 * Copy-at-write is the load-bearing half. Two things follow from it and both
 * are pinned below, because both are silent when they break:
 *
 *   1. A device that ALREADY has a probe keeps it. The inherited value is a
 *      convenience for an empty field, never a correction of a chosen one —
 *      a device whose operator deliberately pointed it at a probe inside its
 *      own DMZ must not be re-pointed merely because it was filed under a
 *      site.
 *   2. Editing a site's default re-points NOTHING. Nothing re-reads the site
 *      after the device is written, so a read-through default would turn one
 *      dropdown change into a silent migration of every device in the
 *      subtree onto a probe that may not even reach them. The device-list
 *      bulk "Set probe" action is the deliberate way to move a fleet.
 *
 * A monitor-backed device never inherits either: nothing polls it, so a
 * probe on the row would be a claim the product does not honour.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const REGION_SITE_ID: ObjectID = new ObjectID(
  "aaaaaaaa-0000-4000-8000-000000000001",
);
const MARKET_SITE_ID: ObjectID = new ObjectID(
  "aaaaaaaa-0000-4000-8000-000000000002",
);
const BUILDING_SITE_ID: ObjectID = new ObjectID(
  "aaaaaaaa-0000-4000-8000-000000000003",
);
const REGION_PROBE_ID: ObjectID = new ObjectID(
  "bbbbbbbb-0000-4000-8000-000000000001",
);
const DEVICE_OWN_PROBE_ID: ObjectID = new ObjectID(
  "bbbbbbbb-0000-4000-8000-000000000002",
);
const DEVICE_ID: ObjectID = new ObjectID(
  "cccccccc-0000-4000-8000-000000000001",
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

function site(data: {
  id: ObjectID;
  probeId?: ObjectID | undefined;
  parentSiteId?: ObjectID | undefined;
}): NetworkSite {
  const networkSite: NetworkSite = new NetworkSite(data.id);
  networkSite.projectId = PROJECT_ID;
  if (data.probeId) {
    networkSite.probeId = data.probeId;
  }
  if (data.parentSiteId) {
    networkSite.parentSiteId = data.parentSiteId;
  }
  return networkSite;
}

/*
 * The hierarchy every case below inherits through:
 *
 *   Region (has a probe)  ->  Market (no probe)  ->  Building (no probe)
 *
 * The device is created into, or moved to, the BUILDING — two levels down —
 * so a resolver that only looked at the site itself, or only at its direct
 * parent, finds nothing and this whole feature silently stops working for
 * every hierarchy deeper than one level.
 */
function stubGrandchildHierarchy(options?: {
  buildingProbeId?: ObjectID | undefined;
}): void {
  jest.spyOn(NetworkSiteService, "findOneById").mockResolvedValue(
    site({
      id: BUILDING_SITE_ID,
      // Has a parent, so there is a chain above it worth walking.
      parentSiteId: MARKET_SITE_ID,
      ...(options?.buildingProbeId ? { probeId: options.buildingProbeId } : {}),
    }),
  );

  // Root-first, which is the order getAncestorIds documents.
  jest
    .spyOn(NetworkSiteService, "getAncestorIds")
    .mockResolvedValue([REGION_SITE_ID, MARKET_SITE_ID]);

  jest
    .spyOn(NetworkSiteService, "findBy")
    .mockResolvedValue([
      site({ id: REGION_SITE_ID, probeId: REGION_PROBE_ID }),
      site({ id: MARKET_SITE_ID }),
    ]);
}

function stubProbeAttachability(probeProjectId: ObjectID | undefined): void {
  jest
    .spyOn(ProbeService, "getProbesAttachableToProject")
    .mockImplementation(
      async (data: {
        probeIds: Array<ObjectID>;
        projectId: ObjectID;
      }): Promise<Array<Probe>> => {
        const isAttachable: boolean =
          probeProjectId === undefined ||
          probeProjectId.toString() === data.projectId.toString();

        return isAttachable ? [new Probe(data.probeIds[0]!)] : [];
      },
    );
}

function deviceCreatedIntoBuilding(fields?: {
  probeId?: ObjectID | undefined;
  monitoringMethod?: NetworkDeviceMonitoringMethod | undefined;
}): CreateBy<NetworkDevice> {
  const device: NetworkDevice = new NetworkDevice();
  device.projectId = PROJECT_ID;
  device.hostname = "10.0.0.1";
  device.siteId = BUILDING_SITE_ID;
  if (fields?.probeId) {
    device.probeId = fields.probeId;
  }
  if (fields?.monitoringMethod) {
    device.monitoringMethod = fields.monitoringMethod;
  }

  return {
    data: device,
    props: { isRoot: true },
  } as CreateBy<NetworkDevice>;
}

// A move: the payload writes only the new site, which is what the UI posts.
function moveToBuilding(): UpdateBy<NetworkDevice> {
  return {
    query: { _id: DEVICE_ID.toString() },
    data: { siteId: BUILDING_SITE_ID },
    props: { isRoot: true },
  } as unknown as UpdateBy<NetworkDevice>;
}

/*
 * An update payload is a QueryDeepPartialEntity, so a column can legitimately
 * hold a raw SQL-expression function rather than a value. Only a real
 * ObjectID counts as "a probe was written here"; anything else is read as
 * nothing written, which is also how the hook itself reasons about it.
 */
function writtenProbeId(updateBy: UpdateBy<NetworkDevice>): string | undefined {
  const value: unknown = (updateBy.data as unknown as Record<string, unknown>)[
    "probeId"
  ];

  return value instanceof ObjectID ? value.toString() : undefined;
}

function matchedDevice(fields?: {
  probeId?: ObjectID | undefined;
  monitoringMethod?: NetworkDeviceMonitoringMethod | undefined;
}): NetworkDevice {
  const device: NetworkDevice = new NetworkDevice(DEVICE_ID);
  device.projectId = PROJECT_ID;
  if (fields?.probeId) {
    device.probeId = fields.probeId;
  }
  if (fields?.monitoringMethod) {
    device.monitoringMethod = fields.monitoringMethod;
  }
  return device;
}

describe("a device created into a site inherits the site's default probe", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    stubProbeAttachability(undefined);
  });

  test("the probe reaches a device created two levels below the site that names it", async () => {
    const { internals } = buildDeviceService();
    stubGrandchildHierarchy();

    const created: OnCreate<NetworkDevice> = await internals.onBeforeCreate(
      deviceCreatedIntoBuilding(),
    );

    expect(created.createBy.data.probeId?.toString()).toBe(
      REGION_PROBE_ID.toString(),
    );
  });

  /*
   * Nearest ancestor wins, so a Market that names its own probe overrides
   * the Region's for its own subtree. Here the site itself names one, which
   * must short-circuit the walk entirely.
   */
  test("the site's own probe wins over an ancestor's", async () => {
    const { internals } = buildDeviceService();
    stubGrandchildHierarchy({ buildingProbeId: DEVICE_OWN_PROBE_ID });

    const created: OnCreate<NetworkDevice> = await internals.onBeforeCreate(
      deviceCreatedIntoBuilding(),
    );

    expect(created.createBy.data.probeId?.toString()).toBe(
      DEVICE_OWN_PROBE_ID.toString(),
    );
    expect(NetworkSiteService.getAncestorIds).not.toHaveBeenCalled();
  });

  test("a device that names its own probe keeps it", async () => {
    const { internals } = buildDeviceService();
    stubGrandchildHierarchy();

    const created: OnCreate<NetworkDevice> = await internals.onBeforeCreate(
      deviceCreatedIntoBuilding({ probeId: DEVICE_OWN_PROBE_ID }),
    );

    expect(created.createBy.data.probeId?.toString()).toBe(
      DEVICE_OWN_PROBE_ID.toString(),
    );
  });

  /*
   * Nothing polls a monitor-backed device — its bound monitor's status is
   * its status — so stamping a probe on it would be a claim the product does
   * not honour, and claimDevicesForPolling would skip the row anyway.
   */
  test("a monitor-backed device inherits nothing", async () => {
    const { internals } = buildDeviceService();
    stubGrandchildHierarchy();

    const created: OnCreate<NetworkDevice> = await internals.onBeforeCreate(
      deviceCreatedIntoBuilding({
        monitoringMethod: NetworkDeviceMonitoringMethod.Monitor,
      }),
    );

    expect(created.createBy.data.probeId).toBeUndefined();
  });

  test("a device created with no site inherits nothing, and reads no site at all", async () => {
    const { internals } = buildDeviceService();
    stubGrandchildHierarchy();

    const device: NetworkDevice = new NetworkDevice();
    device.projectId = PROJECT_ID;
    device.hostname = "10.0.0.1";

    const created: OnCreate<NetworkDevice> = await internals.onBeforeCreate({
      data: device,
      props: { isRoot: true },
    } as CreateBy<NetworkDevice>);

    expect(created.createBy.data.probeId).toBeUndefined();
    expect(NetworkSiteService.findOneById).not.toHaveBeenCalled();
  });

  /*
   * A site row written before the probe tenancy guard existed can still name
   * a probe from another project. Copying it would be the very leak the
   * guards exist to prevent, and throwing would fail an unrelated device
   * create because of a bad row elsewhere — so the device is simply created
   * without a probe, and reads Pending until an operator picks one.
   */
  test("a site naming a probe from another project inherits nothing rather than leaking it", async () => {
    const { internals } = buildDeviceService();
    stubGrandchildHierarchy();
    stubProbeAttachability(OTHER_PROJECT_ID);

    const created: OnCreate<NetworkDevice> = await internals.onBeforeCreate(
      deviceCreatedIntoBuilding(),
    );

    expect(created.createBy.data.probeId).toBeUndefined();
  });
});

describe("a device moved into a site inherits that site's default probe", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    stubProbeAttachability(undefined);
  });

  test("a probe-less device picks up the ancestor site's probe on the move", async () => {
    const { service, internals } = buildDeviceService();
    stubGrandchildHierarchy();
    jest.spyOn(service, "findBy").mockResolvedValue([matchedDevice()] as never);

    const updated: OnUpdate<NetworkDevice> =
      await internals.onBeforeUpdate(moveToBuilding());

    expect(writtenProbeId(updated.updateBy)).toBe(REGION_PROBE_ID.toString());
  });

  /*
   * The rule that keeps an operator's choice: a device already pointed at a
   * probe is not re-pointed by being filed under a site. If this ever fails,
   * every "organise the estate" bulk move quietly migrates devices onto a
   * probe that may have no route to them.
   */
  test("a device that already has a probe is untouched by the site default", async () => {
    const { service, internals } = buildDeviceService();
    stubGrandchildHierarchy();
    jest
      .spyOn(service, "findBy")
      .mockResolvedValue([
        matchedDevice({ probeId: DEVICE_OWN_PROBE_ID }),
      ] as never);

    const updated: OnUpdate<NetworkDevice> =
      await internals.onBeforeUpdate(moveToBuilding());

    expect(writtenProbeId(updated.updateBy)).toBeUndefined();
  });

  /*
   * One payload writes ONE probeId to every row it matches, so a batch that
   * mixes devices with and without a probe cannot be served correctly. It
   * skips the whole batch rather than re-pointing the half that already had
   * one.
   */
  test("a bulk move skips the inheritance entirely when any matched device already has a probe", async () => {
    const { service, internals } = buildDeviceService();
    stubGrandchildHierarchy();
    jest
      .spyOn(service, "findBy")
      .mockResolvedValue([
        matchedDevice(),
        matchedDevice({ probeId: DEVICE_OWN_PROBE_ID }),
      ] as never);

    const updated: OnUpdate<NetworkDevice> =
      await internals.onBeforeUpdate(moveToBuilding());

    expect(writtenProbeId(updated.updateBy)).toBeUndefined();
  });

  test("a move that also assigns a probe keeps the caller's choice", async () => {
    const { service, internals } = buildDeviceService();
    stubGrandchildHierarchy();
    jest.spyOn(service, "findBy").mockResolvedValue([matchedDevice()] as never);

    const updated: OnUpdate<NetworkDevice> = await internals.onBeforeUpdate({
      query: { _id: DEVICE_ID.toString() },
      data: { siteId: BUILDING_SITE_ID, probeId: DEVICE_OWN_PROBE_ID },
      props: { isRoot: true },
    } as unknown as UpdateBy<NetworkDevice>);

    expect(writtenProbeId(updated.updateBy)).toBe(
      DEVICE_OWN_PROBE_ID.toString(),
    );
  });

  test("a monitor-backed device moved into the site inherits nothing", async () => {
    const { service, internals } = buildDeviceService();
    stubGrandchildHierarchy();
    jest.spyOn(service, "findBy").mockResolvedValue([
      matchedDevice({
        monitoringMethod: NetworkDeviceMonitoringMethod.Monitor,
      }),
    ] as never);

    const updated: OnUpdate<NetworkDevice> =
      await internals.onBeforeUpdate(moveToBuilding());

    expect(writtenProbeId(updated.updateBy)).toBeUndefined();
  });

  /*
   * COPY AT WRITE, stated as a test. Any update that does not move the device
   * must not consult the site — this is what makes editing a site's default
   * probe a decision about future devices only. A device write that renames
   * the device is the cheapest way to prove the site is never read.
   */
  test("an update that does not move the device never reads the site's probe", async () => {
    const { service, internals } = buildDeviceService();
    stubGrandchildHierarchy();
    jest.spyOn(service, "findBy").mockResolvedValue([matchedDevice()] as never);

    const updated: OnUpdate<NetworkDevice> = await internals.onBeforeUpdate({
      query: { _id: DEVICE_ID.toString() },
      data: { name: "core-sw-01" },
      props: { isRoot: true },
    } as unknown as UpdateBy<NetworkDevice>);

    expect(writtenProbeId(updated.updateBy)).toBeUndefined();
    expect(NetworkSiteService.findOneById).not.toHaveBeenCalled();
  });
});
