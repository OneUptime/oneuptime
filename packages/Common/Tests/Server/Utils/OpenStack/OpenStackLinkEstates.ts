import { expect } from "@jest/globals";
import Host from "../../../../Models/DatabaseModels/Host";
import OpenStackAcrossProducts from "../../../../Server/Utils/OpenStack/OpenStackAcrossProducts";
import ObjectID from "../../../../Types/ObjectID";
import { isOpenStackInstanceId } from "../../../../Types/OpenStack/OpenStackInstanceMetrics";
import {
  OpenStackLinkedHost,
  OpenStackPlacement,
  OpenStackReachAcrossProducts,
  getOnlyOpenStackMatch,
  isOpenStackHostNameMatch,
} from "../../../../Types/OpenStack/OpenStackLinks";
import { SeededRandom, seededRandom } from "../../../Helpers/SeededRandom";

/*
 * NO LINK IS MADE ON A GUESS, WRITTEN OUT AS ESTATES.
 *
 * Each estate is some hosts, hypervisors and instances, and every link it should have. Whatever
 * isn't listed must not be there, from either end. The same table runs against a stand-in for
 * the database (OpenStackAcrossProducts.test.ts, in every CI run) and against real SQL
 * (OpenStackAcrossProductsPostgres.test.ts), because each can be wrong in its own way: the
 * logic here, and what a LIMIT or a LIKE does there.
 */

export const CLOUD_A: string = "cloud-a";
export const CLOUD_B: string = "cloud-b";
export const ARCHIVED_CLOUD: string = "cloud-archived";

export const UUID_1: string = "a1b2c3d4-0000-4000-8000-000000000001";
export const UUID_2: string = "a1b2c3d4-0000-4000-8000-000000000002";
// What a machine's own agent says when it isn't on a cloud at all.
export const MACHINE_ID: string = "0123456789abcdef0123456789abcdef";
// A real machine's DMI UUID has the shape of an instance's, and is no instance's.
export const HARDWARE_UUID: string = "4c4c4544-0042-3010-8052-b4c04f4d3232";

export interface EstateHost {
  name: string;
  hostId?: string | undefined;
  // Which cloud someone, or an earlier window, already said this host is in.
  cloud?: string | undefined;
  isArchived?: boolean | undefined;
}

export interface EstateHypervisor {
  name: string;
  cloud: string;
  region?: string | undefined;
}

export interface EstateInstance {
  id: string;
  cloud: string;
}

// [host, hypervisor or instance, cloud]
export type EstateLink = [string, string, string];

export interface LinkEstate {
  title: string;
  hosts: Array<EstateHost>;
  hypervisors: Array<EstateHypervisor>;
  instances?: Array<EstateInstance> | undefined;
  // Each host that is one machine with a hypervisor. Anything else is no link.
  machines?: Array<EstateLink> | undefined;
  // Each host that is an instance.
  guests?: Array<EstateLink> | undefined;
}

function hypervisor(name: string, cloud: string = CLOUD_A): EstateHypervisor {
  return { name, cloud };
}

function host(name: string): EstateHost {
  return { name };
}

export const LINK_ESTATES: ReadonlyArray<LinkEstate> = [
  {
    title: "one host and one hypervisor of one name are one machine",
    hosts: [host("compute-01")],
    hypervisors: [hypervisor("compute-01")],
    machines: [["compute-01", "compute-01", CLOUD_A]],
  },
  {
    title:
      "Nova's full name and the agent's short one are one machine, as on every real cloud",
    hosts: [host("compute-01")],
    hypervisors: [hypervisor("compute-01.example.internal")],
    machines: [["compute-01", "compute-01.example.internal", CLOUD_A]],
  },
  {
    title: "the agent's full name and Nova's short one are one machine",
    hosts: [host("compute-01.example.internal")],
    hypervisors: [hypervisor("compute-01")],
    machines: [["compute-01.example.internal", "compute-01", CLOUD_A]],
  },
  {
    title: "a name's case says nothing",
    hosts: [host("COMPUTE-01.Example.Internal")],
    hypervisors: [hypervisor("compute-01.example.INTERNAL")],
    machines: [
      ["COMPUTE-01.Example.Internal", "compute-01.example.INTERNAL", CLOUD_A],
    ],
  },
  {
    title: "a short host that fits two hypervisors in two domains is neither's",
    hosts: [host("compute-01")],
    hypervisors: [
      hypervisor("compute-01.east.example"),
      hypervisor("compute-01.west.example"),
    ],
  },
  {
    title: "two hosts that fit one hypervisor are neither of them",
    hosts: [host("compute-01"), host("compute-01.example.internal")],
    hypervisors: [hypervisor("compute-01.example.internal")],
  },
  {
    title: "two hosts in two domains that fit a short hypervisor are neither",
    hosts: [host("compute-01.east.example"), host("compute-01.west.example")],
    hypervisors: [hypervisor("compute-01")],
  },
  {
    title: "the same name in two clouds is neither's",
    hosts: [host("compute-01")],
    hypervisors: [hypervisor("compute-01"), hypervisor("compute-01", CLOUD_B)],
  },
  {
    title: "the same name in two regions of a cloud is neither's",
    hosts: [host("compute-01")],
    hypervisors: [
      { name: "compute-01", cloud: CLOUD_A, region: "RegionOne" },
      { name: "compute-01", cloud: CLOUD_A, region: "RegionTwo" },
    ],
  },
  {
    title: "an exact match doesn't outrank a short one: that is still two",
    hosts: [host("compute-01.example.internal")],
    hypervisors: [
      hypervisor("compute-01.example.internal"),
      hypervisor("compute-01", CLOUD_B),
    ],
  },
  {
    title: "two full names in two domains are two machines, however alike",
    hosts: [host("compute-01.east.example")],
    hypervisors: [hypervisor("compute-01.west.example")],
  },
  {
    title: "each of two machines finds itself, with every name spelled out",
    hosts: [host("compute-01.east.example"), host("compute-01.west.example")],
    hypervisors: [
      hypervisor("compute-01.east.example"),
      hypervisor("compute-01.west.example"),
    ],
    machines: [
      ["compute-01.east.example", "compute-01.east.example", CLOUD_A],
      ["compute-01.west.example", "compute-01.west.example", CLOUD_A],
    ],
  },
  {
    title: "a name that only begins another is another name",
    hosts: [host("compute-1"), host("compute")],
    hypervisors: [hypervisor("compute-10.example.internal")],
  },
  {
    title: "a host's underscore is a character, and no wildcard",
    hosts: [host("web_1")],
    hypervisors: [hypervisor("webx1.example.internal")],
  },
  {
    title: "a host's percent sign is a character, and no wildcard",
    hosts: [host("web%")],
    hypervisors: [hypervisor("web-1.example.internal")],
  },
  {
    title: "an underscore that is really there still matches",
    hosts: [host("web_1")],
    hypervisors: [hypervisor("web_1.example.internal")],
    machines: [["web_1", "web_1.example.internal", CLOUD_A]],
  },
  {
    title: "a name every machine can have says nothing",
    hosts: [host("localhost")],
    hypervisors: [
      hypervisor("localhost"),
      hypervisor("localhost.localdomain", CLOUD_B),
    ],
  },
  {
    title: "an address is only ever itself",
    hosts: [host("10.0.0.1"), host("10.0.0")],
    hypervisors: [
      hypervisor("10.0.0.1"),
      hypervisor("10.0.0.1.example.internal"),
    ],
    machines: [["10.0.0.1", "10.0.0.1", CLOUD_A]],
  },
  {
    title: "an IPv6 address is only ever itself",
    hosts: [host("fe80::1")],
    hypervisors: [hypervisor("fe80::1")],
    machines: [["fe80::1", "fe80::1", CLOUD_A]],
  },
  {
    title: "a host with no hypervisor of its name is no part of a cloud",
    hosts: [host("db-01")],
    hypervisors: [hypervisor("compute-01")],
  },
  {
    title:
      "a host's chosen cloud says which of two same-named hypervisors it is",
    hosts: [{ name: "compute-01", cloud: CLOUD_B }],
    hypervisors: [hypervisor("compute-01"), hypervisor("compute-01", CLOUD_B)],
    machines: [["compute-01", "compute-01", CLOUD_B]],
  },
  {
    title: "a host someone put in another cloud is not this cloud's rival",
    hosts: [
      { name: "compute-01", cloud: CLOUD_B },
      host("compute-01.example.internal"),
    ],
    hypervisors: [hypervisor("compute-01.example.internal")],
    machines: [
      ["compute-01.example.internal", "compute-01.example.internal", CLOUD_A],
    ],
  },
  {
    title: "a host someone put in a cloud without that machine is on nothing",
    hosts: [{ name: "compute-01", cloud: CLOUD_B }],
    hypervisors: [hypervisor("compute-01")],
  },
  {
    title: "an archived host is nobody's rival, and nobody's machine",
    hosts: [
      { name: "compute-01", isArchived: true },
      host("compute-01.example.internal"),
    ],
    hypervisors: [hypervisor("compute-01.example.internal")],
    machines: [
      ["compute-01.example.internal", "compute-01.example.internal", CLOUD_A],
    ],
  },
  {
    title: "a cloud someone archived is nobody's rival",
    hosts: [host("compute-01")],
    hypervisors: [
      hypervisor("compute-01"),
      hypervisor("compute-01", ARCHIVED_CLOUD),
    ],
    machines: [["compute-01", "compute-01", CLOUD_A]],
  },
  {
    title: "a machine-id says nothing, so the name is what is asked",
    hosts: [{ name: "compute-01", hostId: MACHINE_ID }],
    hypervisors: [hypervisor("compute-01")],
    machines: [["compute-01", "compute-01", CLOUD_A]],
  },
  {
    title:
      "a real machine's UUID is no instance's, so the name is what is asked",
    hosts: [{ name: "compute-01", hostId: HARDWARE_UUID }],
    hypervisors: [hypervisor("compute-01")],
    instances: [{ id: UUID_1, cloud: CLOUD_A }],
    machines: [["compute-01", "compute-01", CLOUD_A]],
  },
  {
    title:
      "a host.id that is an instance's is that instance, whatever its name",
    hosts: [{ name: "web-1", hostId: UUID_1 }],
    hypervisors: [hypervisor("compute-01")],
    instances: [{ id: UUID_1, cloud: CLOUD_A }],
    guests: [["web-1", UUID_1, CLOUD_A]],
  },
  {
    title: "an instance's UUID in capitals is still that instance",
    hosts: [{ name: "web-1", hostId: UUID_1.toUpperCase() }],
    hypervisors: [],
    instances: [{ id: UUID_1, cloud: CLOUD_A }],
    guests: [["web-1", UUID_1, CLOUD_A]],
  },
  {
    title:
      "a guest called what a hypervisor is called is still the guest, and no machine",
    hosts: [{ name: "compute-01", hostId: UUID_1 }],
    hypervisors: [hypervisor("compute-01")],
    instances: [{ id: UUID_1, cloud: CLOUD_A }],
    guests: [["compute-01", UUID_1, CLOUD_A]],
  },
  {
    title:
      "a guest whose ID says what it is doesn't take the name from the machine it resembles",
    hosts: [
      { name: "compute-01", hostId: UUID_1 },
      host("compute-01.example.internal"),
    ],
    hypervisors: [hypervisor("compute-01.example.internal")],
    instances: [{ id: UUID_1, cloud: CLOUD_A }],
    guests: [["compute-01", UUID_1, CLOUD_A]],
    machines: [
      ["compute-01.example.internal", "compute-01.example.internal", CLOUD_A],
    ],
  },
  {
    title: "one UUID in two clouds is neither's",
    hosts: [{ name: "web-1", hostId: UUID_1 }],
    hypervisors: [],
    instances: [
      { id: UUID_1, cloud: CLOUD_A },
      { id: UUID_1, cloud: CLOUD_B },
    ],
  },
  {
    title:
      "one UUID in two clouds is still an instance: no name can make it a hypervisor",
    hosts: [{ name: "compute-01", hostId: UUID_1 }],
    hypervisors: [hypervisor("compute-01")],
    instances: [
      { id: UUID_1, cloud: CLOUD_A },
      { id: UUID_1, cloud: CLOUD_B },
    ],
  },
  {
    title: "one UUID in two clouds is whichever one someone said",
    hosts: [{ name: "web-1", hostId: UUID_2, cloud: CLOUD_B }],
    hypervisors: [],
    instances: [
      { id: UUID_2, cloud: CLOUD_A },
      { id: UUID_2, cloud: CLOUD_B },
    ],
    guests: [["web-1", UUID_2, CLOUD_B]],
  },
  {
    title: "an instance in a cloud someone archived isn't anyone's rival",
    hosts: [{ name: "web-1", hostId: UUID_1 }],
    hypervisors: [],
    instances: [
      { id: UUID_1, cloud: CLOUD_A },
      { id: UUID_1, cloud: ARCHIVED_CLOUD },
    ],
    guests: [["web-1", UUID_1, CLOUD_A]],
  },
];

/*
 * More matches than any read holds, because that is where a LIMIT with a filter after it would
 * cut one of two and leave what looks like the only one.
 */
function getManyDomainsEstate(data: {
  hostName: string;
  duplicateIn?: string | undefined;
  machines: Array<EstateLink>;
}): LinkEstate {
  const hypervisors: Array<EstateHypervisor> = [];
  for (let domain: number = 0; domain < 30; domain++) {
    hypervisors.push(hypervisor(`compute-01.d${domain}.example`));
  }
  if (data.duplicateIn) {
    hypervisors.push(hypervisor("compute-01.d7.example", data.duplicateIn));
  }
  return {
    title: `${data.hostName} among thirty domains${data.duplicateIn ? ", one of them twice" : ""}`,
    hosts: [host(data.hostName)],
    hypervisors,
    machines: data.machines,
  };
}

/*
 * More hosts of a name than a read holds, most of them guests whose own ID rules them out. The
 * ones a read left out could be rivals, so nobody is the machine: no link on a guess.
 */
export function getTooManyHostsEstate(): LinkEstate {
  const hosts: Array<EstateHost> = [];
  for (let domain: number = 0; domain < 60; domain++) {
    hosts.push({ name: `compute-01.g${domain}.example`, hostId: UUID_1 });
  }
  return {
    title: "a hypervisor's name that sixty guests' short names fit",
    hosts: [...hosts, host("compute-01")],
    hypervisors: [hypervisor("compute-01")],
    instances: [{ id: UUID_1, cloud: CLOUD_A }],
    guests: hosts.map((one: EstateHost): EstateLink => {
      return [one.name, UUID_1, CLOUD_A];
    }),
  };
}

export const MANY_DOMAINS_ESTATES: ReadonlyArray<LinkEstate> = [
  getManyDomainsEstate({
    hostName: "compute-01.d7.example",
    machines: [["compute-01.d7.example", "compute-01.d7.example", CLOUD_A]],
  }),
  getManyDomainsEstate({
    hostName: "compute-01.d7.example",
    duplicateIn: CLOUD_B,
    machines: [],
  }),
  getManyDomainsEstate({ hostName: "compute-01", machines: [] }),
];

/*
 * The rule as a test reads it, for estates nobody wrote out. It is written from what the issue
 * says rather than from the code, and the suites also check what it can't get wrong itself: a
 * host has one link at most, a hypervisor has one link at most, and each end says the same.
 */
export function getExpectedLinks(estate: LinkEstate): {
  machines: Array<EstateLink>;
  guests: Array<EstateLink>;
} {
  const isCloudLive: (cloud: string) => boolean = (cloud: string): boolean => {
    return cloud !== ARCHIVED_CLOUD;
  };
  const instances: Array<EstateInstance> = estate.instances || [];
  const liveHosts: Array<EstateHost> = estate.hosts.filter(
    (candidate: EstateHost): boolean => {
      return !candidate.isArchived;
    },
  );
  const instancesOf: (candidate: EstateHost) => Array<EstateInstance> = (
    candidate: EstateHost,
  ): Array<EstateInstance> => {
    const id: string = (candidate.hostId || "").toLowerCase();
    return !isOpenStackInstanceId(id)
      ? []
      : instances.filter((instance: EstateInstance): boolean => {
          return (
            instance.id === id &&
            (candidate.cloud
              ? instance.cloud === candidate.cloud
              : isCloudLive(instance.cloud))
          );
        });
  };
  // Whether any live cloud holds this UUID, which is what says a host is no machine.
  const isClaimed: (candidate: EstateHost) => boolean = (
    candidate: EstateHost,
  ): boolean => {
    const id: string = (candidate.hostId || "").toLowerCase();
    return (
      isOpenStackInstanceId(id) &&
      instances.some((instance: EstateInstance): boolean => {
        return instance.id === id && isCloudLive(instance.cloud);
      })
    );
  };

  const machines: Array<EstateLink> = [];
  const guests: Array<EstateLink> = [];
  for (const candidate of liveHosts) {
    const mine: Array<EstateInstance> = instancesOf(candidate);
    if (mine.length > 0) {
      const instance: EstateInstance | null = getOnlyOpenStackMatch(mine);
      if (instance) {
        guests.push([candidate.name, instance.id, instance.cloud]);
      }
      continue;
    }
    const part: EstateHypervisor | null = getOnlyOpenStackMatch(
      estate.hypervisors.filter((one: EstateHypervisor): boolean => {
        return (
          isOpenStackHostNameMatch(candidate.name, one.name) &&
          (candidate.cloud
            ? one.cloud === candidate.cloud
            : isCloudLive(one.cloud))
        );
      }),
    );
    if (!part) {
      continue;
    }
    const hasRival: boolean = liveHosts.some((other: EstateHost): boolean => {
      return (
        other.name !== candidate.name &&
        isOpenStackHostNameMatch(other.name, part.name) &&
        !isClaimed(other) &&
        (!other.cloud || other.cloud === part.cloud)
      );
    });
    if (!hasRival) {
      machines.push([candidate.name, part.name, part.cloud]);
    }
  }
  return { machines, guests };
}

// Names picked to collide: short and long forms of a few machines, in a few domains and cases.
const NAME_PARTS: ReadonlyArray<string> = ["compute-01", "compute-1", "web_1"];
const DOMAINS: ReadonlyArray<string> = [
  "",
  ".east.example",
  ".west.example",
  ".EAST.example",
];

export function getRandomLinkEstates(data: {
  seed: number;
  count: number;
}): Array<LinkEstate> {
  const random: SeededRandom = seededRandom(data.seed);
  const pick: <T>(items: ReadonlyArray<T>) => T = <T>(
    items: ReadonlyArray<T>,
  ): T => {
    return items[random(items.length)] as T;
  };
  const drawName: () => string = (): string => {
    return `${pick(NAME_PARTS)}${pick(DOMAINS)}`;
  };
  const estates: Array<LinkEstate> = [];
  for (let index: number = 0; index < data.count; index++) {
    // One row per name, in any case: a project's hosts are unique by name.
    const hosts: Map<string, EstateHost> = new Map();
    for (let count: number = random(5); count >= 0; count--) {
      const name: string = drawName();
      hosts.set(name.toLowerCase(), {
        name,
        ...(random() < 0.2 ? { hostId: pick([UUID_1, UUID_2]) } : {}),
        ...(random() < 0.15 ? { cloud: pick([CLOUD_A, CLOUD_B]) } : {}),
      });
    }
    // One row per name in a cloud, in any one spelling: its ID is made from its name.
    const hypervisors: Map<string, EstateHypervisor> = new Map();
    for (let count: number = random(4); count > 0; count--) {
      const drawn: EstateHypervisor = hypervisor(
        drawName(),
        pick([CLOUD_A, CLOUD_A, CLOUD_B, ARCHIVED_CLOUD]),
      );
      hypervisors.set(`${drawn.cloud}/${drawn.name}`, drawn);
    }
    const instances: Array<EstateInstance> = [];
    for (const id of [UUID_1, UUID_2]) {
      for (const cloud of [CLOUD_A, CLOUD_B]) {
        if (random() < 0.3) {
          instances.push({ id, cloud });
        }
      }
    }
    const estate: LinkEstate = {
      title: `drawn estate ${index}`,
      hosts: Array.from(hosts.values()),
      hypervisors: Array.from(hypervisors.values()),
      instances,
    };
    estates.push({ ...estate, ...getExpectedLinks(estate) });
  }
  return estates;
}

export interface EstateIds {
  projectId: ObjectID;
  cloudIds: Map<string, ObjectID>;
  hostIds: Map<string, ObjectID>;
  // Writes the cloud ingest found onto a host's row, as the ingest does.
  stamp: (hostName: string, cloudId: ObjectID) => Promise<void>;
}

function linkOfHost(
  links: Array<EstateLink> | undefined,
  hostName: string,
): EstateLink | undefined {
  return (links || []).find((link: EstateLink): boolean => {
    return link[0] === hostName;
  });
}

/*
 * The whole of it, from every end: what ingest stamps, what a host's page says, what a
 * hypervisor's page says, and what each of their blast radiuses names.
 */
export async function expectEstateToLinkAsWritten(
  estate: LinkEstate,
  ids: EstateIds,
): Promise<void> {
  const cloudId: (name: string) => ObjectID = (name: string): ObjectID => {
    return ids.cloudIds.get(name) as ObjectID;
  };
  const describeIt: (what: string) => string = (what: string): string => {
    return `${estate.title}: ${what}`;
  };

  // What ingest does for each host that has no cloud yet.
  for (const one of estate.hosts) {
    if (one.isArchived) {
      continue;
    }
    const expected: EstateLink | undefined =
      linkOfHost(estate.machines, one.name) ||
      linkOfHost(estate.guests, one.name);
    if (one.cloud) {
      continue;
    }
    const found: ObjectID | null =
      await OpenStackAcrossProducts.findCloudOfHost({
        projectId: ids.projectId,
        hostIdAttribute: one.hostId,
        hostIdentifier: one.name,
      });
    expect({
      at: describeIt(`the cloud ingest finds for ${one.name}`),
      cloud: found?.toString() || null,
    }).toEqual({
      at: describeIt(`the cloud ingest finds for ${one.name}`),
      cloud: expected ? cloudId(expected[2]).toString() : null,
    });
    if (found) {
      await ids.stamp(one.name, found);
    }
  }

  // What a host's own page says.
  for (const one of estate.hosts) {
    const placement: OpenStackPlacement | null =
      await OpenStackAcrossProducts.getPlacementOfHost({
        projectId: ids.projectId,
        hostId: ids.hostIds.get(one.name) as ObjectID,
      });
    const machine: EstateLink | undefined = linkOfHost(
      estate.machines,
      one.name,
    );
    const guest: EstateLink | undefined = linkOfHost(estate.guests, one.name);
    expect({
      at: describeIt(`what ${one.name}'s page says`),
      placement: placement
        ? [
            placement.kind,
            placement.kind === "hypervisor"
              ? placement.hypervisorName
              : placement.externalId,
            placement.openStackCloudId,
          ]
        : null,
    }).toEqual({
      at: describeIt(`what ${one.name}'s page says`),
      placement: machine
        ? ["hypervisor", machine[1], cloudId(machine[2]).toString()]
        : guest
          ? ["instance", guest[1], cloudId(guest[2]).toString()]
          : null,
    });
  }

  // What a hypervisor's page says, and who its blast radius names as its own machine.
  for (const one of estate.hypervisors) {
    if (one.cloud === ARCHIVED_CLOUD) {
      continue;
    }
    const expected: Array<string> = (estate.machines || [])
      .filter((link: EstateLink): boolean => {
        return link[1] === one.name && link[2] === one.cloud;
      })
      .map((link: EstateLink): string => {
        return link[0].toLowerCase();
      });
    const found: Host | null = await OpenStackAcrossProducts.getHostOfMachine({
      projectId: ids.projectId,
      machineName: one.name,
      openStackCloudId: cloudId(one.cloud),
    });
    expect({
      at: describeIt(`the host ${one.name}'s page in ${one.cloud} links to`),
      hosts: found ? [(found.hostIdentifier || "").toLowerCase()] : [],
    }).toEqual({
      at: describeIt(`the host ${one.name}'s page in ${one.cloud} links to`),
      hosts: expected,
    });

    const reach: OpenStackReachAcrossProducts =
      await OpenStackAcrossProducts.getReachOfHypervisor({
        projectId: ids.projectId,
        openStackCloudId: cloudId(one.cloud),
        hypervisorName: one.name,
        regionName: one.region || null,
      });
    expect({
      at: describeIt(`what ${one.name} in ${one.cloud} calls its own machine`),
      hosts: reach.hosts
        .filter((linked: OpenStackLinkedHost): boolean => {
          return linked.isHypervisor;
        })
        .map((linked: OpenStackLinkedHost): string => {
          return linked.name.toLowerCase();
        }),
    }).toEqual({
      at: describeIt(`what ${one.name} in ${one.cloud} calls its own machine`),
      hosts: expected,
    });
  }

  // What an instance's page says it also is.
  for (const instance of estate.instances || []) {
    if (instance.cloud === ARCHIVED_CLOUD) {
      continue;
    }
    const reach: OpenStackReachAcrossProducts =
      await OpenStackAcrossProducts.getReachOfInstance({
        projectId: ids.projectId,
        openStackCloudId: cloudId(instance.cloud),
        instanceId: instance.id,
      });
    const expected: Array<string> = (estate.guests || [])
      .filter((link: EstateLink): boolean => {
        return link[1] === instance.id && link[2] === instance.cloud;
      })
      .map((link: EstateLink): string => {
        return link[0].toLowerCase();
      });
    const at: string = describeIt(
      `the hosts ${instance.id} in ${instance.cloud} says it is`,
    );
    // Counted in full and named up to a limit, so every one named has to be one of them.
    expect({ at, count: reach.hostCount }).toEqual({
      at,
      count: expected.length,
    });
    for (const linked of reach.hosts) {
      expect({
        at,
        host: expected.includes(linked.name.toLowerCase()),
      }).toEqual({ at, host: true });
    }
  }
}

/*
 * What the rule can't get wrong whatever an estate holds: nothing is two things, and no
 * hypervisor is two machines. A test of the expected links themselves.
 */
export function expectLinksToBeOneToOne(estate: LinkEstate): void {
  const hostsSeen: Set<string> = new Set();
  const hypervisorsSeen: Set<string> = new Set();
  for (const [hostName, name, cloud] of estate.machines || []) {
    expect(hostsSeen.has(hostName)).toBe(false);
    hostsSeen.add(hostName);
    const key: string = `${cloud}/${name}`;
    expect(hypervisorsSeen.has(key)).toBe(false);
    hypervisorsSeen.add(key);
  }
  for (const [hostName] of estate.guests || []) {
    expect(hostsSeen.has(hostName)).toBe(false);
    hostsSeen.add(hostName);
  }
}
