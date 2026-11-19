import NetworkDeviceDiscoveryScanService from "../../../Server/Services/NetworkDeviceDiscoveryScanService";
import NetworkDeviceService, {
  AddressSeen,
} from "../../../Server/Services/NetworkDeviceService";
import NetworkSiteService from "../../../Server/Services/NetworkSiteService";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import NetworkDeviceDiscoveryScan, {
  DiscoveredNetworkDevice,
} from "../../../Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import NetworkSite from "../../../Models/DatabaseModels/NetworkSite";
import ObjectID from "../../../Types/ObjectID";
import FindBy from "../../../Server/Types/Database/FindBy";
import FindOneBy from "../../../Server/Types/Database/FindOneBy";
import { OnFind } from "../../../Server/Types/Database/Hooks";
import {
  AmbiguousAddressReason,
  NoDeviceReason,
  SeenDeviceReason,
  WhenReachUnknown,
} from "../../../Utils/NetworkDevice/DeviceAddressScope";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * WHY A HOST AT A SHARED ADDRESS READS ALREADY ADDED (OneUptime issue
 * #9905), and why nothing a stored row says about it is read (issue #9906).
 *
 * Two branches each have a 10.0.0.5. A scan's host is the device the scan's
 * probe sees there (issue #9677), and Review Results now says why: which of
 * the devices the probe sees and how, or why it cannot tell them apart and
 * which they are. Worked out by the real read
 * (NetworkDeviceDiscoveryScanService.onFindSuccess through
 * NetworkDeviceService.getDevicesByHostnames and the address rule); only the
 * database reads are faked - the devices at the addresses and the "is there
 * one" reads of what the probe reaches.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

const SITE_A: string = "a1000000-0000-4000-8000-000000000001";
const SITE_B: string = "b1000000-0000-4000-8000-000000000001";
const SITE_C: string = "c1000000-0000-4000-8000-000000000001";
const PROBE_A: string = "a2000000-0000-4000-8000-000000000001";
const PROBE_B: string = "b2000000-0000-4000-8000-000000000001";
const PROBE_C: string = "c2000000-0000-4000-8000-000000000001";
const PROBE_FRESH: string = "f2000000-0000-4000-8000-000000000001";

interface FakeDevice {
  id: string;
  hostname: string;
  siteId?: string | undefined;
  probeId?: string | undefined;
}

interface FakeSite {
  id: string;
  probeId?: string | undefined;
}

const BRANCH_A_ROUTER: FakeDevice = {
  id: "d0000000-0000-4000-8000-00000000000a",
  hostname: "10.0.0.5",
  siteId: SITE_A,
  probeId: PROBE_A,
};
const BRANCH_B_ROUTER: FakeDevice = {
  id: "d0000000-0000-4000-8000-00000000000b",
  hostname: "10.0.0.5",
  siteId: SITE_B,
  probeId: PROBE_B,
};
// Site C's own switch, polled by its probe: what the probe reaches.
const BRANCH_C_SWITCH: FakeDevice = {
  id: "d0000000-0000-4000-8000-0000000000c2",
  hostname: "10.0.0.2",
  siteId: SITE_C,
  probeId: PROBE_C,
};
// A printer alone at its address, in site A.
const BRANCH_A_PRINTER: FakeDevice = {
  id: "d0000000-0000-4000-8000-0000000000a9",
  hostname: "10.0.0.9",
  siteId: SITE_A,
  probeId: PROBE_A,
};

let devices: Array<FakeDevice> = [];
let sites: Array<FakeSite> = [];

interface QueryRead {
  projectId?: unknown;
  hostname?: unknown;
  probeId?: unknown;
  siteId?: unknown;
}

// The values of a QueryHelper.any condition: a Raw carrying its parameters.
function valuesOf(condition: unknown): Array<string> {
  const parameters: Record<string, unknown> =
    (condition as { objectLiteralParameters?: Record<string, unknown> })
      ?.objectLiteralParameters || {};

  return (Object.values(parameters).flat() as Array<unknown>).map(
    (value: unknown): string => {
      return String(value).toLowerCase();
    },
  );
}

function sqlOf(condition: unknown): string {
  const raw: { getSql?: (alias: string) => string } = condition as {
    getSql?: (alias: string) => string;
  };

  return raw?.getSql ? raw.getSql("column") : "";
}

function siteMatches(device: FakeDevice, condition: unknown): boolean {
  if (condition === undefined) {
    return true;
  }

  if (condition instanceof ObjectID) {
    return (device.siteId || "") === condition.toString().toLowerCase();
  }

  const sql: string = sqlOf(condition);

  if (sql.includes("IS NOT NULL")) {
    return Boolean(device.siteId);
  }

  if (sql.includes("IS NULL")) {
    return !device.siteId;
  }

  throw new Error(`An unexpected site condition: ${sql}`);
}

function toModel(device: FakeDevice): NetworkDevice {
  const model: NetworkDevice = new NetworkDevice();
  model.id = new ObjectID(device.id);
  model.hostname = device.hostname;

  if (device.siteId) {
    model.siteId = new ObjectID(device.siteId);
  }

  if (device.probeId) {
    model.probeId = new ObjectID(device.probeId);
  }

  return model;
}

beforeEach(() => {
  devices = [
    BRANCH_A_ROUTER,
    BRANCH_B_ROUTER,
    BRANCH_C_SWITCH,
    BRANCH_A_PRINTER,
  ];
  sites = [
    { id: SITE_A, probeId: PROBE_A },
    { id: SITE_B, probeId: PROBE_B },
    { id: SITE_C, probeId: PROBE_C },
  ];

  jest
    .spyOn(NetworkDeviceService, "findBy")
    .mockImplementation(
      async (data: FindBy<NetworkDevice>): Promise<Array<NetworkDevice>> => {
        const query: QueryRead = data.query as QueryRead;
        expect(query.projectId).toEqual(PROJECT_ID);
        const wanted: Array<string> = valuesOf(query.hostname);

        return devices
          .filter((device: FakeDevice): boolean => {
            return wanted.includes(device.hostname.toLowerCase());
          })
          .map(toModel);
      },
    );

  jest
    .spyOn(NetworkDeviceService, "findOneBy")
    .mockImplementation(
      async (data: FindOneBy<NetworkDevice>): Promise<NetworkDevice | null> => {
        const query: QueryRead = data.query as QueryRead;
        const probeIds: Array<string> = valuesOf(query.probeId);

        const found: FakeDevice | undefined = devices.find(
          (device: FakeDevice): boolean => {
            return (
              Boolean(device.probeId) &&
              probeIds.includes(device.probeId!) &&
              siteMatches(device, query.siteId)
            );
          },
        );

        return found ? toModel(found) : null;
      },
    );

  jest
    .spyOn(NetworkSiteService, "findOneBy")
    .mockImplementation(
      async (data: FindOneBy<NetworkSite>): Promise<NetworkSite | null> => {
        const query: QueryRead = data.query as QueryRead;
        const probeIds: Array<string> = valuesOf(query.probeId);

        const found: FakeSite | undefined = sites.find(
          (site: FakeSite): boolean => {
            return Boolean(site.probeId) && probeIds.includes(site.probeId!);
          },
        );

        if (!found) {
          return null;
        }

        const model: NetworkSite = new NetworkSite();
        model.id = new ObjectID(found.id);
        return model;
      },
    );

  jest
    .spyOn(NetworkSiteService, "resolveDefaultProbeIdForSite")
    .mockImplementation(async (siteId: ObjectID): Promise<ObjectID | null> => {
      const site: FakeSite | undefined = sites.find(
        (item: FakeSite): boolean => {
          return item.id === siteId.toString().toLowerCase();
        },
      );

      return site?.probeId ? new ObjectID(site.probeId) : null;
    });
});

afterEach(() => {
  jest.restoreAllMocks();
});

interface FindSuccessHook {
  onFindSuccess(
    onFind: OnFind<NetworkDeviceDiscoveryScan>,
    items: Array<NetworkDeviceDiscoveryScan>,
  ): Promise<OnFind<NetworkDeviceDiscoveryScan>>;
}

// A scan of these hosts by this probe, read through the service.
async function readHosts(data: {
  probeId: string | null;
  hosts: Array<DiscoveredNetworkDevice>;
}): Promise<Array<DiscoveredNetworkDevice>> {
  const scan: NetworkDeviceDiscoveryScan = new NetworkDeviceDiscoveryScan();
  scan.projectId = PROJECT_ID;
  (scan as unknown as Record<string, unknown>)["probeId"] = data.probeId
    ? new ObjectID(data.probeId)
    : null;
  scan.discoveredDevices = data.hosts;

  const onFind: OnFind<NetworkDeviceDiscoveryScan> = {
    findBy: {
      query: {},
      select: { discoveredDevices: true },
      skip: 0,
      limit: 10,
      props: { isRoot: true },
    },
    carryForward: undefined,
  };

  const result: OnFind<NetworkDeviceDiscoveryScan> = await (
    NetworkDeviceDiscoveryScanService as unknown as FindSuccessHook
  ).onFindSuccess(onFind, [scan]);

  return (result.carryForward as Array<NetworkDeviceDiscoveryScan>)[0]!
    .discoveredDevices!;
}

describe("a host at 10.0.0.5, which a device in each of two sites has", () => {
  it("site A's probe sees site A's router because it polls it", async () => {
    expect(
      await readHosts({ probeId: PROBE_A, hosts: [{ ipAddress: "10.0.0.5" }] }),
    ).toEqual([
      {
        ipAddress: "10.0.0.5",
        isAlreadyRegistered: true,
        registeredDeviceId: BRANCH_A_ROUTER.id,
        sharedAddress: {
          deviceCount: 2,
          seenReason: SeenDeviceReason.PolledByTheProbes,
        },
      },
    ]);
  });

  it("site B's probe sees site B's router the same way", async () => {
    expect(
      await readHosts({ probeId: PROBE_B, hosts: [{ ipAddress: "10.0.0.5" }] }),
    ).toEqual([
      {
        ipAddress: "10.0.0.5",
        isAlreadyRegistered: true,
        registeredDeviceId: BRANCH_B_ROUTER.id,
        sharedAddress: {
          deviceCount: 2,
          seenReason: SeenDeviceReason.PolledByTheProbes,
        },
      },
    ]);
  });

  it("a new probe that is site A's default sees site A's router as the only one in its site", async () => {
    sites = [
      { id: SITE_A, probeId: PROBE_FRESH },
      { id: SITE_B, probeId: PROBE_B },
    ];

    expect(
      await readHosts({
        probeId: PROBE_FRESH,
        hosts: [{ ipAddress: "10.0.0.5" }],
      }),
    ).toEqual([
      {
        ipAddress: "10.0.0.5",
        isAlreadyRegistered: true,
        registeredDeviceId: BRANCH_A_ROUTER.id,
        sharedAddress: {
          deviceCount: 2,
          seenReason: SeenDeviceReason.OnlyOneInTheirSites,
        },
      },
    ]);
  });

  it("a probe that is both sites' default cannot tell the two apart, and names both", async () => {
    sites = [
      { id: SITE_A, probeId: PROBE_FRESH },
      { id: SITE_B, probeId: PROBE_FRESH },
    ];

    expect(
      await readHosts({
        probeId: PROBE_FRESH,
        hosts: [{ ipAddress: "10.0.0.5" }],
      }),
    ).toEqual([
      {
        ipAddress: "10.0.0.5",
        isAlreadyRegistered: true,
        sharedAddress: {
          deviceCount: 2,
          ambiguousReason: AmbiguousAddressReason.SeveralInTheirSites,
          ambiguousDeviceIds: [BRANCH_A_ROUTER.id, BRANCH_B_ROUTER.id],
        },
      },
    ]);
  });

  it("a probe that polls both routers cannot tell them apart either", async () => {
    devices = [
      { ...BRANCH_A_ROUTER, probeId: PROBE_A },
      { ...BRANCH_B_ROUTER, probeId: PROBE_A },
    ];

    expect(
      await readHosts({ probeId: PROBE_A, hosts: [{ ipAddress: "10.0.0.5" }] }),
    ).toEqual([
      {
        ipAddress: "10.0.0.5",
        isAlreadyRegistered: true,
        sharedAddress: {
          deviceCount: 2,
          ambiguousReason: AmbiguousAddressReason.PollSeveral,
          ambiguousDeviceIds: [BRANCH_A_ROUTER.id, BRANCH_B_ROUTER.id],
        },
      },
    ]);
  });

  it("a probe nobody's site names, polling nothing, cannot know where it looks", async () => {
    expect(
      await readHosts({
        probeId: PROBE_FRESH,
        hosts: [{ ipAddress: "10.0.0.5" }],
      }),
    ).toEqual([
      {
        ipAddress: "10.0.0.5",
        isAlreadyRegistered: true,
        sharedAddress: {
          deviceCount: 2,
          ambiguousReason: AmbiguousAddressReason.ReachUnknown,
          ambiguousDeviceIds: [BRANCH_A_ROUTER.id, BRANCH_B_ROUTER.id],
        },
      },
    ]);
  });

  it("nor can a scan whose probe is gone", async () => {
    const hosts: Array<DiscoveredNetworkDevice> = await readHosts({
      probeId: null,
      hosts: [{ ipAddress: "10.0.0.5" }],
    });

    expect(hosts[0]!.isAlreadyRegistered).toBe(true);
    expect(hosts[0]!.registeredDeviceId).toBeUndefined();
    expect(hosts[0]!.sharedAddress?.ambiguousReason).toBe(
      AmbiguousAddressReason.ReachUnknown,
    );
  });

  /*
   * Site C's own 10.0.0.5 is not a device yet: the host is new to its
   * probe, whatever sites A and B have there, and it says nothing about
   * them - a scan of a busy range at shared private addresses would
   * otherwise say so on every row.
   */
  it("site C's probe sees neither: a new host, with nothing said about the others", async () => {
    expect(
      await readHosts({ probeId: PROBE_C, hosts: [{ ipAddress: "10.0.0.5" }] }),
    ).toEqual([{ ipAddress: "10.0.0.5", isAlreadyRegistered: false }]);
  });
});

describe("a host at an address one device has", () => {
  it("names its device and says nothing more", async () => {
    expect(
      await readHosts({ probeId: PROBE_A, hosts: [{ ipAddress: "10.0.0.9" }] }),
    ).toEqual([
      {
        ipAddress: "10.0.0.9",
        isAlreadyRegistered: true,
        registeredDeviceId: BRANCH_A_PRINTER.id,
      },
    ]);
  });

  it("is new when no device has the address", async () => {
    expect(
      await readHosts({
        probeId: PROBE_A,
        hosts: [{ ipAddress: "10.0.0.77" }],
      }),
    ).toEqual([{ ipAddress: "10.0.0.77", isAlreadyRegistered: false }]);
  });
});

/*
 * Nothing a stored row says about registration is read (issue #9906): the
 * read works each field out again, and drops a stored one it has no answer
 * for, so an old row, or one a modified probe wrote, never shows its copy.
 */
describe("what a stored row says about registration", () => {
  it("is replaced by what the read works out, field by field", async () => {
    expect(
      await readHosts({
        probeId: PROBE_A,
        hosts: [
          {
            ipAddress: "10.0.0.5",
            isAlreadyRegistered: false,
            registeredDeviceId: BRANCH_B_ROUTER.id,
            sharedAddress: {
              deviceCount: 9,
              ambiguousReason: AmbiguousAddressReason.ReachUnknown,
              ambiguousDeviceIds: [BRANCH_B_ROUTER.id],
            },
          },
          {
            ipAddress: "10.0.0.9",
            isAlreadyRegistered: true,
            sharedAddress: {
              deviceCount: 2,
              seenReason: SeenDeviceReason.OnlyOneAtTheAddress,
            },
          },
          {
            ipAddress: "10.0.0.77",
            isAlreadyRegistered: true,
            registeredDeviceId: BRANCH_A_PRINTER.id,
          },
        ],
      }),
    ).toEqual([
      {
        ipAddress: "10.0.0.5",
        isAlreadyRegistered: true,
        registeredDeviceId: BRANCH_A_ROUTER.id,
        sharedAddress: {
          deviceCount: 2,
          seenReason: SeenDeviceReason.PolledByTheProbes,
        },
      },
      {
        ipAddress: "10.0.0.9",
        isAlreadyRegistered: true,
        registeredDeviceId: BRANCH_A_PRINTER.id,
      },
      { ipAddress: "10.0.0.77", isAlreadyRegistered: false },
    ]);
  });

  /*
   * The project-wide rule the probe's report used to store: branch B's host
   * marked as a device because branch A has one at its address. Read from
   * site C's probe, which reaches neither, it is new.
   */
  it("an old project-wide flag on a host no device in the probe's sites has reads as new", async () => {
    const [read] = await readHosts({
      probeId: PROBE_C,
      hosts: [{ ipAddress: "10.0.0.9", isAlreadyRegistered: true }],
    });

    expect(read).toEqual({ ipAddress: "10.0.0.9", isAlreadyRegistered: false });
  });
});

describe("getDevicesByHostnames hands what it saw at each address", () => {
  it("says what the probes see at every address with a device, with every device there", async () => {
    const seenInto: Map<string, AddressSeen<NetworkDevice>> = new Map();
    const ambiguous: Set<string> = new Set<string>();

    const found: Map<string, NetworkDevice> =
      await NetworkDeviceService.getDevicesByHostnames({
        projectId: PROJECT_ID,
        hostnames: ["10.0.0.5", "10.0.0.9", "10.0.0.77"],
        select: { _id: true, hostname: true },
        props: { isRoot: true },
        seenFrom: {
          probeIds: [PROBE_C],
          whenReachUnknown: WhenReachUnknown.OnlyDeviceAnywhere,
        },
        ambiguousHostnames: ambiguous,
        seenInto: seenInto,
      });

    // Site C's probe reaches no device at either address.
    expect(found.size).toBe(0);
    expect(ambiguous.size).toBe(0);
    expect(Array.from(seenInto.keys()).sort()).toEqual([
      "10.0.0.5",
      "10.0.0.9",
    ]);
    expect(seenInto.get("10.0.0.5")!.seen).toEqual({
      kind: "none",
      reason: NoDeviceReason.NoneInTheirSites,
    });
    expect(
      seenInto
        .get("10.0.0.5")!
        .devices.map((device: NetworkDevice): string => {
          return device.id!.toString();
        })
        .sort(),
    ).toEqual([BRANCH_A_ROUTER.id, BRANCH_B_ROUTER.id]);
  });

  it("is left alone when not asked for, or when no probes are named", async () => {
    const seenInto: Map<string, AddressSeen<NetworkDevice>> = new Map();

    await NetworkDeviceService.getDevicesByHostnames({
      projectId: PROJECT_ID,
      hostnames: ["10.0.0.5"],
      select: { _id: true, hostname: true },
      props: { isRoot: true },
      seenInto: seenInto,
    });

    // Without a viewpoint there is no rule to explain.
    expect(seenInto.size).toBe(0);
  });
});
