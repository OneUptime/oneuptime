import NetworkDeviceService from "../../../Server/Services/NetworkDeviceService";
import NetworkSiteService from "../../../Server/Services/NetworkSiteService";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import NetworkSite from "../../../Models/DatabaseModels/NetworkSite";
import ObjectID from "../../../Types/ObjectID";
import FindBy from "../../../Server/Types/Database/FindBy";
import FindOneBy from "../../../Server/Types/Database/FindOneBy";
import {
  ProbeReach,
  WhenReachUnknown,
} from "../../../Utils/NetworkDevice/DeviceAddressScope";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * THE DEVICES AT ADDRESSES, SEEN FROM A SCAN'S OR A MONITOR'S PROBES
 * (OneUptime issue #9677), through NetworkDeviceService as every path asks
 * it: Review Results, the import, auto import rules and a monitor's tie.
 *
 * Two branches each have a 10.0.0.5. Only the database reads are faked
 * here - the devices at the addresses, and the "is there one" reads of what
 * the probes reach - so the rule runs as it does on the server.
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
const BRANCH_C_SWITCH: FakeDevice = {
  id: "d0000000-0000-4000-8000-0000000000c2",
  hostname: "10.0.0.2",
  siteId: SITE_C,
  probeId: PROBE_C,
};

let devices: Array<FakeDevice> = [];
let sites: Array<FakeSite> = [];
let findBySpy: jest.SpyInstance;
let findOneBySpy: jest.SpyInstance;
let siteFindOneBySpy: jest.SpyInstance;
let defaultProbeSpy: jest.SpyInstance;

// The columns of a read's query these fakes look at.
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

// What a Raw condition says of a column, as SQL.
function sqlOf(condition: unknown): string {
  const raw: { getSql?: (alias: string) => string } = condition as {
    getSql?: (alias: string) => string;
  };

  return raw?.getSql ? raw.getSql("column") : "";
}

// Whether a device's site meets a query's siteId condition.
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
  devices = [];
  sites = [];

  // The devices at the addresses asked about.
  findBySpy = jest
    .spyOn(NetworkDeviceService, "findBy")
    .mockImplementation(
      async (data: FindBy<NetworkDevice>): Promise<Array<NetworkDevice>> => {
        const query: QueryRead = data.query as QueryRead;
        const wanted: Array<string> = valuesOf(query.hostname);

        return devices
          .filter((device: FakeDevice): boolean => {
            return wanted.includes(device.hostname.toLowerCase());
          })
          .map(toModel);
      },
    );

  // "Is there a device these probes poll, in this site / any site / none?"
  findOneBySpy = jest
    .spyOn(NetworkDeviceService, "findOneBy")
    .mockImplementation(
      async (data: FindOneBy<NetworkDevice>): Promise<NetworkDevice | null> => {
        const query: QueryRead = data.query as QueryRead;
        expect(query.projectId).toEqual(PROJECT_ID);
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

  // "Does a site name one of these probes its default probe?"
  siteFindOneBySpy = jest
    .spyOn(NetworkSiteService, "findOneBy")
    .mockImplementation(
      async (data: FindOneBy<NetworkSite>): Promise<NetworkSite | null> => {
        const query: QueryRead = data.query as QueryRead;
        expect(query.projectId).toEqual(PROJECT_ID);
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

  defaultProbeSpy = jest
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

async function seenFrom(data: {
  probeIds: Array<string>;
  hostnames?: Array<string> | undefined;
  whenReachUnknown?: WhenReachUnknown | undefined;
}): Promise<{ devices: Map<string, NetworkDevice>; ambiguous: Set<string> }> {
  const ambiguous: Set<string> = new Set<string>();

  const found: Map<string, NetworkDevice> =
    await NetworkDeviceService.getDevicesByHostnames({
      projectId: PROJECT_ID,
      hostnames: data.hostnames || ["10.0.0.5"],
      select: { name: true },
      props: { isRoot: true },
      seenFrom: {
        probeIds: data.probeIds,
        whenReachUnknown:
          data.whenReachUnknown || WhenReachUnknown.OnlyDeviceAnywhere,
      },
      ambiguousHostnames: ambiguous,
    });

  return { devices: found, ambiguous: ambiguous };
}

function idAt(
  answer: { devices: Map<string, NetworkDevice> },
  hostname: string = "10.0.0.5",
): string | undefined {
  return answer.devices.get(hostname)?.id?.toString();
}

describe("two branches with a device each at 10.0.0.5", () => {
  beforeEach(() => {
    devices = [BRANCH_A_ROUTER, BRANCH_B_ROUTER];
    sites = [
      { id: SITE_A, probeId: PROBE_A },
      { id: SITE_B, probeId: PROBE_B },
    ];
  });

  it("answers each branch's probe with its own branch's device", async () => {
    expect(idAt(await seenFrom({ probeIds: [PROBE_A] }))).toBe(
      BRANCH_A_ROUTER.id,
    );
    expect(idAt(await seenFrom({ probeIds: [PROBE_B] }))).toBe(
      BRANCH_B_ROUTER.id,
    );
  });

  it("asks nothing more when the probe polls one of the devices there", async () => {
    await seenFrom({ probeIds: [PROBE_A] });

    expect(findBySpy).toHaveBeenCalledTimes(1);
    expect(findOneBySpy).not.toHaveBeenCalled();
    expect(siteFindOneBySpy).not.toHaveBeenCalled();
  });

  it("reads what tells the devices apart beside what the caller selects", async () => {
    await seenFrom({ probeIds: [PROBE_A] });

    expect(findBySpy.mock.calls[0]![0].select).toEqual({
      name: true,
      _id: true,
      siteId: true,
      probeId: true,
      hostname: true,
    });
  });

  it("calls the address ambiguous from a probe that is neither branch's", async () => {
    const answer: {
      devices: Map<string, NetworkDevice>;
      ambiguous: Set<string>;
    } = await seenFrom({ probeIds: [PROBE_FRESH] });

    expect(answer.devices.size).toBe(0);
    expect(Array.from(answer.ambiguous)).toEqual(["10.0.0.5"]);
  });

  it("ties a monitor on a probe that is neither branch's to no device", async () => {
    const answer: {
      devices: Map<string, NetworkDevice>;
      ambiguous: Set<string>;
    } = await seenFrom({
      probeIds: [PROBE_FRESH],
      whenReachUnknown: WhenReachUnknown.OnlyDeviceInNoSite,
    });

    expect(answer.devices.size).toBe(0);
  });
});

describe("one branch's device, another branch's host at the same address", () => {
  beforeEach(() => {
    devices = [BRANCH_A_ROUTER, BRANCH_C_SWITCH];
    sites = [
      { id: SITE_A, probeId: PROBE_A },
      { id: SITE_C, probeId: PROBE_C },
    ];
  });

  it("is free to branch C's probe: the host it found is not branch A's router", async () => {
    const answer: {
      devices: Map<string, NetworkDevice>;
      ambiguous: Set<string>;
    } = await seenFrom({ probeIds: [PROBE_C] });

    expect(answer.devices.size).toBe(0);
    expect(answer.ambiguous.size).toBe(0);
  });

  it("asks only what it needs, each read held to the project and the probes", async () => {
    await seenFrom({ probeIds: [PROBE_C] });

    // In a site, in no site, and site A's own question.
    expect(findOneBySpy).toHaveBeenCalledTimes(3);

    for (const call of findOneBySpy.mock.calls) {
      expect(call[0].props).toEqual({ isRoot: true });
      expect(call[0].select).toEqual({ _id: true });
      expect(valuesOf(call[0].query.probeId)).toEqual([PROBE_C]);
    }

    expect(siteFindOneBySpy).toHaveBeenCalledTimes(1);
    expect(defaultProbeSpy).toHaveBeenCalledTimes(1);
    expect(defaultProbeSpy.mock.calls[0]![0].toString()).toBe(SITE_A);
  });

  it("is branch A's router to a second probe in branch A", async () => {
    const PROBE_A_SPARE: string = "a2000000-0000-4000-8000-000000000002";
    devices.push({
      id: "d0000000-0000-4000-8000-0000000000a3",
      hostname: "10.0.0.9",
      siteId: SITE_A,
      probeId: PROBE_A_SPARE,
    });

    expect(idAt(await seenFrom({ probeIds: [PROBE_A_SPARE] }))).toBe(
      BRANCH_A_ROUTER.id,
    );
  });

  it("is branch C's device to branch C's default probe, whoever polls it", async () => {
    const branchCRouter: FakeDevice = {
      id: "d0000000-0000-4000-8000-00000000000c",
      hostname: "10.0.0.5",
      siteId: SITE_C,
      probeId: PROBE_FRESH,
    };
    devices = [BRANCH_A_ROUTER, branchCRouter];

    expect(idAt(await seenFrom({ probeIds: [PROBE_C] }))).toBe(
      branchCRouter.id,
    );
  });

  it("stays branch A's router to a probe whose site cannot be known, as before", async () => {
    devices = [BRANCH_A_ROUTER];
    sites = [];

    expect(idAt(await seenFrom({ probeIds: [PROBE_FRESH] }))).toBe(
      BRANCH_A_ROUTER.id,
    );
  });
});

describe("a project that puts no device in a site", () => {
  const officeRouter: FakeDevice = {
    id: "e0000000-0000-4000-8000-000000000001",
    hostname: "10.0.0.5",
    probeId: PROBE_A,
  };
  const officePrinter: FakeDevice = {
    id: "e0000000-0000-4000-8000-000000000002",
    hostname: "10.0.0.7",
    probeId: PROBE_B,
  };

  it("finds the device at the address whichever of its probes looks", async () => {
    devices = [officeRouter, officePrinter];

    expect(idAt(await seenFrom({ probeIds: [PROBE_B] }))).toBe(officeRouter.id);
    expect(
      idAt(
        await seenFrom({
          probeIds: [PROBE_B],
          whenReachUnknown: WhenReachUnknown.OnlyDeviceInNoSite,
        }),
      ),
    ).toBe(officeRouter.id);
  });
});

describe("without seenFrom", () => {
  it("answers the last device read at each address, as it always has", async () => {
    devices = [BRANCH_A_ROUTER, BRANCH_B_ROUTER];

    const found: Map<string, NetworkDevice> =
      await NetworkDeviceService.getDevicesByHostnames({
        projectId: PROJECT_ID,
        hostnames: ["10.0.0.5"],
        select: { name: true },
        props: { isRoot: true },
      });

    expect(found.get("10.0.0.5")?.id?.toString()).toBe(BRANCH_B_ROUTER.id);
    expect(findBySpy.mock.calls[0]![0].select).toEqual({
      name: true,
      hostname: true,
    });
    expect(findOneBySpy).not.toHaveBeenCalled();
  });
});

describe("getAllDevicesAtHostnames", () => {
  it("lists every device at each address, in the order read", async () => {
    devices = [BRANCH_A_ROUTER, BRANCH_B_ROUTER, BRANCH_C_SWITCH];

    const found: Map<
      string,
      Array<NetworkDevice>
    > = await NetworkDeviceService.getAllDevicesAtHostnames({
      projectId: PROJECT_ID,
      hostnames: ["10.0.0.5", "10.0.0.2", "10.0.0.99"],
      select: { _id: true },
      props: { isRoot: true },
    });

    expect(
      (found.get("10.0.0.5") || []).map((device: NetworkDevice): string => {
        return device.id!.toString();
      }),
    ).toEqual([BRANCH_A_ROUTER.id, BRANCH_B_ROUTER.id]);
    expect(found.get("10.0.0.2")?.length).toBe(1);
    expect(found.has("10.0.0.99")).toBe(false);
  });
});

describe("readProbeReach", () => {
  it("asks nothing of no probes, and knows nothing of them", async () => {
    const reach: ProbeReach = await NetworkDeviceService.readProbeReach({
      projectId: PROJECT_ID,
      probeIds: [null, undefined, ""],
      siteKeys: [SITE_A],
    });

    expect(reach.isKnown).toBe(false);
    expect(findOneBySpy).not.toHaveBeenCalled();
    expect(siteFindOneBySpy).not.toHaveBeenCalled();
  });

  it("does not ask about a site when the probes poll no device in any", async () => {
    devices = [{ ...BRANCH_A_ROUTER, siteId: undefined }];

    const reach: ProbeReach = await NetworkDeviceService.readProbeReach({
      projectId: PROJECT_ID,
      probeIds: [PROBE_A],
      siteKeys: [SITE_B],
    });

    expect(reach.isKnown).toBe(true);
    expect(Array.from(reach.siteKeys)).toEqual([""]);
    // In a site, in no site: never site B's own question.
    expect(findOneBySpy).toHaveBeenCalledTimes(2);
  });
});
