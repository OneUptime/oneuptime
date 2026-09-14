import NetworkDeviceService from "../../../Server/Services/NetworkDeviceService";
import { Service as NetworkSiteServiceType } from "../../../Server/Services/NetworkSiteService";
import NetworkSnmpCredentialProfileService from "../../../Server/Services/NetworkSnmpCredentialProfileService";
import ProbeService from "../../../Server/Services/ProbeService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import NetworkSite from "../../../Models/DatabaseModels/NetworkSite";
import NetworkSnmpCredentialProfile from "../../../Models/DatabaseModels/NetworkSnmpCredentialProfile";
import Probe from "../../../Models/DatabaseModels/Probe";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

/*
 * WHAT THIS FILE IS DEFENDING
 *
 * A NetworkSite carries two monitoring DEFAULTS — the probe that polls the
 * devices in it, and the SNMP credential profile they are walked with — and
 * both are inherited by devices. That makes a bad value here different in
 * kind from a bad value on any other site column: it does not affect one
 * row, it reaches every device in the subtree.
 *
 *   - probeId is COPIED onto devices at write time by NetworkDeviceService,
 *     so a cross-project probe here would be stamped onto real devices and
 *     then claimed by that project's probe.
 *   - snmpCredentialProfileId is read LIVE at every poll, so a cross-project
 *     profile here puts another project's community string on this project's
 *     probe's wire, for every credential-less device in the site.
 *
 * Neither foreign key requires the referenced row to be in the same project,
 * and the site form posts the RELATION spelling rather than the FK, so both
 * spellings are checked. The update hook has an early return for writes that
 * touch neither the parent nor the type — which is exactly the shape a
 * "set the site's default probe" save takes — so, as with every other guard
 * in this codebase, the real hazard is a check that never runs.
 *
 * The last describe pins the OTHER half of the design: editing a site's
 * default probe must re-point nothing. The value is copied when a device is
 * written and never re-read, so a fan-out added here would turn one dropdown
 * change into a silent migration of a whole subtree onto a probe that may
 * have no route to it.
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
const SITE_ID: ObjectID = new ObjectID("55555555-5555-4555-8555-555555555555");
const PARENT_SITE_ID: ObjectID = new ObjectID(
  "66666666-6666-4666-8666-666666666666",
);
const ROOT_SITE_ID: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777777",
);
const ROOT_PROBE_ID: ObjectID = new ObjectID(
  "88888888-8888-4888-8888-888888888888",
);

type SiteServiceInternals = {
  onBeforeCreate: (
    createBy: CreateBy<NetworkSite>,
  ) => Promise<OnCreate<NetworkSite>>;
  onBeforeUpdate: (
    updateBy: UpdateBy<NetworkSite>,
  ) => Promise<OnUpdate<NetworkSite>>;
  onUpdateSuccess: (
    onUpdate: OnUpdate<NetworkSite>,
    updatedItemIds: Array<ObjectID>,
  ) => Promise<OnUpdate<NetworkSite>>;
};

function buildSiteService(): {
  service: NetworkSiteServiceType;
  internals: SiteServiceInternals;
} {
  const service: NetworkSiteServiceType = new NetworkSiteServiceType();
  return {
    service,
    internals: service as unknown as SiteServiceInternals,
  };
}

function matchedSite(data?: {
  id?: ObjectID | undefined;
  probeId?: ObjectID | undefined;
  parentSiteId?: ObjectID | undefined;
}): NetworkSite {
  const site: NetworkSite = new NetworkSite(data?.id || SITE_ID);
  site.projectId = PROJECT_ID;
  if (data?.probeId) {
    site.probeId = data.probeId;
  }
  if (data?.parentSiteId) {
    site.parentSiteId = data.parentSiteId;
  }
  return site;
}

function profileInProject(projectId: ObjectID): NetworkSnmpCredentialProfile {
  const profile: NetworkSnmpCredentialProfile =
    new NetworkSnmpCredentialProfile(PROFILE_ID);
  profile.projectId = projectId;
  profile.name = "Branch v2c";
  return profile;
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

/*
 * The write shape the site settings page actually posts when an operator
 * picks a default: one field, no parent, no type. This is precisely what
 * onBeforeUpdate's early return would swallow.
 */
function defaultOnlyUpdate(
  data: Record<string, unknown>,
): UpdateBy<NetworkSite> {
  return {
    query: { _id: SITE_ID.toString() },
    data: data,
    props: { isRoot: true },
  } as unknown as UpdateBy<NetworkSite>;
}

function siteCreate(data: Record<string, unknown>): CreateBy<NetworkSite> {
  const site: NetworkSite = new NetworkSite();
  site.projectId = PROJECT_ID;
  site.name = "Building 4";
  Object.assign(site, data);

  return {
    data: site,
    props: { isRoot: true },
  } as CreateBy<NetworkSite>;
}

describe("a site's default probe is tenant-checked", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  /*
   * THE regression test. A probe-only payload touches neither parent nor
   * type, so if this guard drifts below the early return the hook resolves
   * cleanly and another project's probe becomes this site's default — and is
   * then copied onto every device created into the site.
   */
  test.each(["probeId", "probe"] as const)(
    "refuses a probe from another project written as %s",
    async (key: "probeId" | "probe") => {
      const { service, internals } = buildSiteService();

      jest.spyOn(service, "findBy").mockResolvedValue([matchedSite()] as never);
      stubProbeAttachability(OTHER_PROJECT_ID);

      await expect(
        internals.onBeforeUpdate(
          defaultOnlyUpdate({
            [key]: key === "probeId" ? PROBE_ID : new Probe(PROBE_ID),
          }),
        ),
      ).rejects.toThrow(/does not belong to this project/);
    },
  );

  test("allows a probe from the site's own project", async () => {
    const { service, internals } = buildSiteService();

    jest.spyOn(service, "findBy").mockResolvedValue([matchedSite()] as never);
    stubProbeAttachability(PROJECT_ID);

    await expect(
      internals.onBeforeUpdate(defaultOnlyUpdate({ probeId: PROBE_ID })),
    ).resolves.toBeDefined();
  });

  // A global probe belongs to no project and may poll for any of them.
  test("allows a global probe", async () => {
    const { service, internals } = buildSiteService();

    jest.spyOn(service, "findBy").mockResolvedValue([matchedSite()] as never);
    stubProbeAttachability(undefined);

    await expect(
      internals.onBeforeUpdate(defaultOnlyUpdate({ probeId: PROBE_ID })),
    ).resolves.toBeDefined();
  });

  // Clearing the default points at nothing, so there is nothing to check.
  test("allows the default to be cleared", async () => {
    const { service, internals } = buildSiteService();

    jest.spyOn(service, "findBy").mockResolvedValue([matchedSite()] as never);
    stubProbeAttachability(OTHER_PROJECT_ID);

    await expect(
      internals.onBeforeUpdate(defaultOnlyUpdate({ probeId: null })),
    ).resolves.toBeDefined();
  });

  test("checks the probe on create too", async () => {
    const { internals } = buildSiteService();

    stubProbeAttachability(OTHER_PROJECT_ID);

    await expect(
      internals.onBeforeCreate(siteCreate({ probeId: PROBE_ID })),
    ).rejects.toThrow(/does not belong to this project/);
  });

  test("does no probe lookup for a site update that sets no default", async () => {
    const { internals } = buildSiteService();
    stubProbeAttachability(PROJECT_ID);

    await internals.onBeforeUpdate(
      defaultOnlyUpdate({ description: "Ground floor comms room" }),
    );

    expect(ProbeService.getProbesAttachableToProject).not.toHaveBeenCalled();
  });
});

describe("a site's default SNMP credential profile is tenant-checked", () => {
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

  test.each(["snmpCredentialProfileId", "snmpCredentialProfile"] as const)(
    "refuses a profile from another project written as %s",
    async (key: "snmpCredentialProfileId" | "snmpCredentialProfile") => {
      const { service, internals } = buildSiteService();

      jest.spyOn(service, "findBy").mockResolvedValue([matchedSite()] as never);
      profileFindSpy.mockResolvedValue(
        profileInProject(OTHER_PROJECT_ID) as never,
      );

      await expect(
        internals.onBeforeUpdate(
          defaultOnlyUpdate({
            [key]:
              key === "snmpCredentialProfileId"
                ? PROFILE_ID
                : profileInProject(PROJECT_ID),
          }),
        ),
      ).rejects.toThrow(/must belong to the same project/);
    },
  );

  test("allows a profile from the site's own project", async () => {
    const { service, internals } = buildSiteService();

    jest.spyOn(service, "findBy").mockResolvedValue([matchedSite()] as never);
    profileFindSpy.mockResolvedValue(profileInProject(PROJECT_ID) as never);

    await expect(
      internals.onBeforeUpdate(
        defaultOnlyUpdate({ snmpCredentialProfileId: PROFILE_ID }),
      ),
    ).resolves.toBeDefined();
  });

  test("refuses a profile that does not exist at all", async () => {
    const { service, internals } = buildSiteService();

    jest.spyOn(service, "findBy").mockResolvedValue([matchedSite()] as never);
    profileFindSpy.mockResolvedValue(null as never);

    await expect(
      internals.onBeforeUpdate(
        defaultOnlyUpdate({ snmpCredentialProfileId: PROFILE_ID }),
      ),
    ).rejects.toThrow(BadDataException);
  });

  test("checks the profile on create too", async () => {
    const { internals } = buildSiteService();

    profileFindSpy.mockResolvedValue(
      profileInProject(OTHER_PROJECT_ID) as never,
    );

    await expect(
      internals.onBeforeCreate(
        siteCreate({ snmpCredentialProfileId: PROFILE_ID }),
      ),
    ).rejects.toThrow(/must belong to the same project/);
  });

  test("does no profile lookup for a site update that sets no default", async () => {
    const { internals } = buildSiteService();

    await internals.onBeforeUpdate(
      defaultOnlyUpdate({ description: "Ground floor comms room" }),
    );

    expect(profileFindSpy.mock.calls).toHaveLength(0);
  });
});

/*
 * The inheritance walk itself. A device is created into the deepest site an
 * operator happens to have modelled, and the probe is almost always named
 * far above it — a Region, not a Building — so "look at the site, then at
 * each ancestor, nearest first" is the whole feature.
 */
describe("resolveDefaultProbeIdForSite walks up the hierarchy", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  test("the site's own probe short-circuits the walk", async () => {
    const { service } = buildSiteService();

    jest
      .spyOn(service, "findOneById")
      .mockResolvedValue(matchedSite({ probeId: PROBE_ID }));
    const ancestorSpy: unknown = jest.spyOn(service, "getAncestorIds");

    const resolved: ObjectID | null =
      await service.resolveDefaultProbeIdForSite(SITE_ID);

    expect(resolved?.toString()).toBe(PROBE_ID.toString());
    // Not merely an optimisation: the nearest definition must win.
    expect(ancestorSpy).not.toHaveBeenCalled();
  });

  test("a grandchild with no probe inherits the root's", async () => {
    const { service } = buildSiteService();

    jest
      .spyOn(service, "findOneById")
      .mockResolvedValue(matchedSite({ parentSiteId: PARENT_SITE_ID }));
    // Root-first, as getAncestorIds documents.
    jest
      .spyOn(service, "getAncestorIds")
      .mockResolvedValue([ROOT_SITE_ID, PARENT_SITE_ID]);
    jest
      .spyOn(service, "findBy")
      .mockResolvedValue([
        matchedSite({ id: ROOT_SITE_ID, probeId: ROOT_PROBE_ID }),
        matchedSite({ id: PARENT_SITE_ID }),
      ] as never);

    const resolved: ObjectID | null =
      await service.resolveDefaultProbeIdForSite(SITE_ID);

    expect(resolved?.toString()).toBe(ROOT_PROBE_ID.toString());
  });

  /*
   * The nearest ancestor wins, which is what lets a Market override its
   * Region for its own subtree. getAncestorIds returns root-first, so a walk
   * that forgot to reverse would return the ROOT's probe here and quietly
   * ignore every override in the tree.
   */
  test("the nearest ancestor with a probe wins over a more distant one", async () => {
    const { service } = buildSiteService();

    jest
      .spyOn(service, "findOneById")
      .mockResolvedValue(matchedSite({ parentSiteId: PARENT_SITE_ID }));
    jest
      .spyOn(service, "getAncestorIds")
      .mockResolvedValue([ROOT_SITE_ID, PARENT_SITE_ID]);
    jest
      .spyOn(service, "findBy")
      .mockResolvedValue([
        matchedSite({ id: ROOT_SITE_ID, probeId: ROOT_PROBE_ID }),
        matchedSite({ id: PARENT_SITE_ID, probeId: PROBE_ID }),
      ] as never);

    const resolved: ObjectID | null =
      await service.resolveDefaultProbeIdForSite(SITE_ID);

    expect(resolved?.toString()).toBe(PROBE_ID.toString());
  });

  test("a chain with no probe anywhere resolves to nothing", async () => {
    const { service } = buildSiteService();

    jest
      .spyOn(service, "findOneById")
      .mockResolvedValue(matchedSite({ parentSiteId: PARENT_SITE_ID }));
    jest
      .spyOn(service, "getAncestorIds")
      .mockResolvedValue([ROOT_SITE_ID, PARENT_SITE_ID]);
    jest
      .spyOn(service, "findBy")
      .mockResolvedValue([
        matchedSite({ id: ROOT_SITE_ID }),
        matchedSite({ id: PARENT_SITE_ID }),
      ] as never);

    expect(await service.resolveDefaultProbeIdForSite(SITE_ID)).toBeNull();
  });

  /*
   * A root site has nothing above it, and getAncestorIds is not a free read:
   * it resolves — and for a stale row REBUILDS AND PERSISTS — the
   * materialized path. This runs on the device create path, where most sites
   * are roots, so a device write must not be paying for hierarchy
   * maintenance it cannot possibly use.
   */
  test("a root site with no probe resolves to nothing without walking anything", async () => {
    const { service } = buildSiteService();

    jest.spyOn(service, "findOneById").mockResolvedValue(matchedSite());
    const ancestorSpy: unknown = jest.spyOn(service, "getAncestorIds");

    expect(await service.resolveDefaultProbeIdForSite(SITE_ID)).toBeNull();
    expect(ancestorSpy).not.toHaveBeenCalled();
  });

  test("a site that no longer exists resolves to nothing rather than throwing", async () => {
    const { service } = buildSiteService();

    jest.spyOn(service, "findOneById").mockResolvedValue(null);

    expect(await service.resolveDefaultProbeIdForSite(SITE_ID)).toBeNull();
  });
});

/*
 * COPY AT WRITE, from the site's side.
 *
 * The device service reads a site's default exactly once — when a device is
 * created into or moved to the site — and stamps the answer on the device.
 * Nothing re-reads it. So changing a site's default is a decision about
 * FUTURE devices, and this is the test that says so: if someone later adds a
 * "keep devices in sync" fan-out here, a single dropdown change would
 * re-point a whole subtree onto a probe that may not reach it, and the
 * operator would have had no way to know that is what they were asking for.
 */
describe("editing a site's default probe re-points no existing device", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  test("neither site hook writes to NetworkDevice", async () => {
    const { service, internals } = buildSiteService();

    jest.spyOn(service, "findBy").mockResolvedValue([matchedSite()] as never);
    stubProbeAttachability(PROJECT_ID);

    const deviceUpdateBy: unknown = jest
      .spyOn(NetworkDeviceService, "updateBy")
      .mockResolvedValue(0);
    const deviceUpdateOneBy: unknown = jest
      .spyOn(NetworkDeviceService, "updateOneBy")
      .mockResolvedValue(0);
    const deviceUpdateOneById: unknown = jest
      .spyOn(NetworkDeviceService, "updateOneById")
      .mockResolvedValue(0);

    const update: UpdateBy<NetworkSite> = defaultOnlyUpdate({
      probeId: PROBE_ID,
    });
    const onUpdate: OnUpdate<NetworkSite> =
      await internals.onBeforeUpdate(update);
    await internals.onUpdateSuccess(onUpdate, [SITE_ID]);

    expect(deviceUpdateBy).not.toHaveBeenCalled();
    expect(deviceUpdateOneBy).not.toHaveBeenCalled();
    expect(deviceUpdateOneById).not.toHaveBeenCalled();
  });
});
