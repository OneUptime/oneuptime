import DockerHostOwnerTeamService from "../../../../Server/Services/DockerHostOwnerTeamService";
import DockerHostOwnerUserService from "../../../../Server/Services/DockerHostOwnerUserService";
import HostOwnerTeamService from "../../../../Server/Services/HostOwnerTeamService";
import HostOwnerUserService from "../../../../Server/Services/HostOwnerUserService";
import KubernetesClusterOwnerTeamService from "../../../../Server/Services/KubernetesClusterOwnerTeamService";
import KubernetesClusterOwnerUserService from "../../../../Server/Services/KubernetesClusterOwnerUserService";
import MonitorOwnerTeamService from "../../../../Server/Services/MonitorOwnerTeamService";
import MonitorOwnerUserService from "../../../../Server/Services/MonitorOwnerUserService";
import PodmanHostOwnerTeamService from "../../../../Server/Services/PodmanHostOwnerTeamService";
import PodmanHostOwnerUserService from "../../../../Server/Services/PodmanHostOwnerUserService";
import ServiceOwnerTeamService from "../../../../Server/Services/ServiceOwnerTeamService";
import ServiceOwnerUserService from "../../../../Server/Services/ServiceOwnerUserService";
import InheritedOwners, {
  InheritableResources,
} from "../../../../Server/Utils/Rules/InheritedOwners";
import {
  OwnerIdSets,
  OwnerRuleInheritSource,
} from "../../../../Server/Utils/Rules/OwnerRulePlan";
import ObjectID from "../../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

/*
 * Contract under test - who owns an event's resources, for the owner rules
 * that inherit from them (Server/Utils/Rules/InheritedOwners).
 *
 * The incident and alert owner rule engines - and the create form's preview
 * of them - read the owners of the event's monitors, hosts, Kubernetes
 * clusters, Docker and Podman hosts and services here: only for the sources
 * a matched rule inherits from, only when the event has such a resource,
 * once per evaluation, as OneUptime (the rules are the project's own
 * configuration).
 */

type AnyService = Record<string, (...args: Array<any>) => any>;

interface Source {
  source: OwnerRuleInheritSource;
  key: keyof InheritableResources;
  idColumn: string;
  userService: AnyService;
  teamService: AnyService;
}

const SOURCES: Array<Source> = [
  {
    source: "monitors",
    key: "monitorIds",
    idColumn: "monitorId",
    userService: MonitorOwnerUserService as unknown as AnyService,
    teamService: MonitorOwnerTeamService as unknown as AnyService,
  },
  {
    source: "hosts",
    key: "hostIds",
    idColumn: "hostId",
    userService: HostOwnerUserService as unknown as AnyService,
    teamService: HostOwnerTeamService as unknown as AnyService,
  },
  {
    source: "kubernetesClusters",
    key: "kubernetesClusterIds",
    idColumn: "kubernetesClusterId",
    userService: KubernetesClusterOwnerUserService as unknown as AnyService,
    teamService: KubernetesClusterOwnerTeamService as unknown as AnyService,
  },
  {
    source: "dockerHosts",
    key: "dockerHostIds",
    idColumn: "dockerHostId",
    userService: DockerHostOwnerUserService as unknown as AnyService,
    teamService: DockerHostOwnerTeamService as unknown as AnyService,
  },
  {
    source: "podmanHosts",
    key: "podmanHostIds",
    idColumn: "podmanHostId",
    userService: PodmanHostOwnerUserService as unknown as AnyService,
    teamService: PodmanHostOwnerTeamService as unknown as AnyService,
  },
  {
    source: "services",
    key: "serviceIds",
    idColumn: "serviceId",
    userService: ServiceOwnerUserService as unknown as AnyService,
    teamService: ServiceOwnerTeamService as unknown as AnyService,
  },
];

const RESOURCE_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);
const OWNER_USER: ObjectID = new ObjectID(
  "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
);
const OWNER_TEAM: ObjectID = new ObjectID(
  "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
);

function noResources(): InheritableResources {
  return {
    monitorIds: [],
    hostIds: [],
    kubernetesClusterIds: [],
    dockerHostIds: [],
    podmanHostIds: [],
    serviceIds: [],
  };
}

// Every owner service answers with one owner, and records what it was asked.
const reads: Map<AnyService, Array<Record<string, any>>> = new Map();

type AnswerFunction = (
  service: AnyService,
  row: Record<string, unknown>,
) => (args: Record<string, any>) => Promise<Array<Record<string, unknown>>>;

const answerWith: AnswerFunction = (
  service: AnyService,
  row: Record<string, unknown>,
): ((args: Record<string, any>) => Promise<Array<Record<string, unknown>>>) => {
  return async (
    args: Record<string, any>,
  ): Promise<Array<Record<string, unknown>>> => {
    reads.get(service)!.push(args);
    return [row];
  };
};

beforeEach(() => {
  reads.clear();

  for (const source of SOURCES) {
    for (const [service, row] of [
      [source.userService, { userId: OWNER_USER }],
      [source.teamService, { teamId: OWNER_TEAM }],
    ] as Array<[AnyService, Record<string, unknown>]>) {
      reads.set(service, []);
      jest
        .spyOn(service, "findBy")
        .mockImplementation(answerWith(service, row) as never);
    }
  }
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("InheritedOwners.idsOf", () => {
  it("reads the ids of the related rows the event was handed, each once", () => {
    const other: ObjectID = new ObjectID(
      "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    );

    expect(
      InheritedOwners.idsOf([
        { id: RESOURCE_ID },
        null,
        { id: other },
        { id: new ObjectID(RESOURCE_ID.toString()) },
        {},
      ]).map((id: ObjectID): string => {
        return id.toString();
      }),
    ).toEqual([RESOURCE_ID.toString(), other.toString()]);
    expect(InheritedOwners.idsOf(undefined)).toEqual([]);
  });
});

describe.each(SOURCES)("InheritedOwners.read - $source", (source: Source) => {
  it("reads the owners of the event's resources of this kind, as OneUptime", async () => {
    const inherited: Map<OwnerRuleInheritSource, OwnerIdSets> =
      await InheritedOwners.read({
        sources: new Set([source.source]),
        resources: { ...noResources(), [source.key]: [RESOURCE_ID] },
      });

    expect(Array.from(inherited.keys())).toEqual([source.source]);
    expect(Array.from(inherited.get(source.source)!.userIds)).toEqual([
      OWNER_USER.toString(),
    ]);
    expect(Array.from(inherited.get(source.source)!.teamIds)).toEqual([
      OWNER_TEAM.toString(),
    ]);

    for (const service of [source.userService, source.teamService]) {
      const asked: Array<Record<string, any>> = reads.get(service)!;

      expect(asked).toHaveLength(1);
      expect(asked[0]!["props"]).toEqual({ isRoot: true });
      expect(Object.keys(asked[0]!["query"])).toEqual([source.idColumn]);
      expect(JSON.stringify(asked[0]!["query"][source.idColumn])).toContain(
        RESOURCE_ID.toString(),
      );
    }
  });

  it("reads nothing when no matched rule inherits from it", async () => {
    const inherited: Map<OwnerRuleInheritSource, OwnerIdSets> =
      await InheritedOwners.read({
        sources: new Set(),
        resources: { ...noResources(), [source.key]: [RESOURCE_ID] },
      });

    expect(inherited.size).toBe(0);
    expect(reads.get(source.userService)).toEqual([]);
    expect(reads.get(source.teamService)).toEqual([]);
  });

  it("reads nothing when the event has no such resource", async () => {
    const inherited: Map<OwnerRuleInheritSource, OwnerIdSets> =
      await InheritedOwners.read({
        sources: new Set([source.source]),
        resources: noResources(),
      });

    expect(inherited.size).toBe(0);
    expect(reads.get(source.userService)).toEqual([]);
    expect(reads.get(source.teamService)).toEqual([]);
  });
});

describe("InheritedOwners.read - several sources", () => {
  it("reads only the ones asked for", async () => {
    const everything: InheritableResources = {
      monitorIds: [RESOURCE_ID],
      hostIds: [RESOURCE_ID],
      kubernetesClusterIds: [RESOURCE_ID],
      dockerHostIds: [RESOURCE_ID],
      podmanHostIds: [RESOURCE_ID],
      serviceIds: [RESOURCE_ID],
    };

    const inherited: Map<OwnerRuleInheritSource, OwnerIdSets> =
      await InheritedOwners.read({
        sources: new Set<OwnerRuleInheritSource>(["hosts", "services"]),
        resources: everything,
      });

    expect(Array.from(inherited.keys()).sort()).toEqual(["hosts", "services"]);

    const servicesRead: Array<string> = SOURCES.filter(
      (source: Source): boolean => {
        return reads.get(source.userService)!.length > 0;
      },
    ).map((source: Source): string => {
      return source.source;
    });

    expect(servicesRead).toEqual(["hosts", "services"]);
  });
});
