import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import fs from "fs";
import path from "path";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Host from "../../../../Models/DatabaseModels/Host";
import Incident from "../../../../Models/DatabaseModels/Incident";
import Service from "../../../../Models/DatabaseModels/Service";
import HostService from "../../../../Server/Services/HostService";
import ServiceService from "../../../../Server/Services/ServiceService";
import AffectedResourceSearch, {
  getAffectedResourceKindService,
} from "../../../../Server/Utils/AffectedResources/AffectedResourceSearch";
import LinkedAffectedResources, {
  LinkedAffectedResource as ListedAffectedResource,
  LinkedAffectedResourceType,
} from "../../../../Server/Utils/AffectedResources/LinkedAffectedResources";
import { LinkedAffectedResource } from "../../../../Server/Utils/AI/Toolbox/AffectedResourceLinks";
import logger from "../../../../Server/Utils/Logger";
import ProductBrandingText from "../../../../Server/Utils/ProductBrandingText";
import WorkspaceAffectedResources, {
  WORKSPACE_AFFECTED_RESOURCE_KIND_LABELS,
  WORKSPACE_AFFECTED_RESOURCE_SEARCH_LIMIT_PER_KIND,
  WORKSPACE_AFFECTED_RESOURCES_FIELD,
  WORKSPACE_AFFECTED_RESOURCES_TEXT,
  WORKSPACE_MAX_AFFECTED_RESOURCES,
  WorkspaceAffectedResourceKindMatches,
  WorkspaceAffectedResourceMatch,
  WorkspaceAffectedResourcePicks,
  WorkspaceAffectedResourcesToLink,
} from "../../../../Server/Utils/Workspace/WorkspaceAffectedResources";
import {
  AI_AFFECTED_RESOURCE_KINDS,
  AiAffectedResourceKind,
  AiAffectedResourceKindInfo,
} from "../../../../Types/AI/AiAffectedResources";
import {
  AFFECTED_RESOURCE_KINDS,
  AFFECTED_RESOURCE_SEARCH_MAX_TEXT_LENGTH,
  AffectedResourceKind,
  AffectedResourceSearchRequest,
  AffectedResourceSearchResult,
} from "../../../../Types/AffectedResources/AffectedResourceSearch";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import { customDomainCaller } from "../../API/CustomDomainCallers";
import { useInMemoryTable } from "../../TestingUtils/InMemoryRepository";
import { ON_HIGHEST_PLAN } from "../../TestingUtils/RequestPlan";

/*
 * THE AFFECTED RESOURCES OF AN INCIDENT DECLARED FROM SLACK OR MICROSOFT
 * TEAMS (#5303 follow-up).
 *
 * OneUptime AI investigates and fixes only what an incident is linked to,
 * and an incident declared from a chat was linked to nothing: its forms had
 * no way to name the host, cluster or database it was about. Both forms now
 * offer Affected Resources, searched as the person types; this suite pins
 * the shared half both chats read (WorkspaceAffectedResources):
 *
 *   - the kinds offered - the ones OneUptime AI links, never monitors - and
 *     their names, which are the Dashboard picker's;
 *   - a pick's value, and the picks a form submits: Slack's list, Teams'
 *     comma-separated string, each once, capped, junk counted;
 *   - whose kinds a member may read, with no database read, and whether a
 *     form offers the field at all;
 *   - the search, read as the member in the project, every kind at once;
 *   - what a submission links: each pick read again as the member, so a
 *     resource of another project, an archived one and one of a kind they
 *     may not read are never linked - on the real permission layer;
 *   - an alert's resources, as the member may view them, never its monitor;
 *   - and the words: the hint, the monitors' warning, the confirmation.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "5ac10000-0000-4000-8000-000000000001",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "5ac10000-0000-4000-8000-000000000002",
);
const HOST_ID: string = "5ac10000-0000-4000-8000-0000000000a1";
const SECOND_HOST_ID: string = "5ac10000-0000-4000-8000-0000000000a2";
const OTHER_PROJECT_HOST_ID: string = "5ac10000-0000-4000-8000-0000000000a3";
const ARCHIVED_HOST_ID: string = "5ac10000-0000-4000-8000-0000000000a4";
const SERVICE_ID: string = "5ac10000-0000-4000-8000-0000000000b1";
const CLUSTER_ID: string = "5ac10000-0000-4000-8000-0000000000c1";
const ALERT_ID: ObjectID = new ObjectID("5ac10000-0000-4000-8000-0000000000d1");

const DASHBOARD_PICKER_PATH: string = path.resolve(
  __dirname,
  "../../../../../App/FeatureSet/Dashboard/src/Components/AffectedResources/AffectedResourcesPicker.tsx",
);

// One kind's entry of the Dashboard picker's RESOURCE_CONFIG.
const PICKER_CONFIG_ENTRY: RegExp =
  /^ {2}(\w+): \{\n {4}label: "([^"\n]+)",\n {4}pluralLabel: "([^"\n]+)",/gm;

// A member of the project holding exactly `permissions`, on a plan that has everything.
function memberProps(
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  return {
    ...customDomainCaller({ permissions: permissions, projectId: PROJECT_ID }),
    ...ON_HIGHEST_PLAN,
  };
}

function match(
  kind: AiAffectedResourceKind,
  name: string,
  id?: string,
  detail?: string,
): WorkspaceAffectedResourceMatch {
  const read: WorkspaceAffectedResourceMatch = {
    kind: kind,
    id: id || ObjectID.generate().toString(),
    name: name,
  };

  if (detail) {
    read.detail = detail;
  }

  return read;
}

function group(
  kind: AiAffectedResourceKind,
  names: Array<string>,
  count?: number,
): WorkspaceAffectedResourceKindMatches {
  return {
    kind: kind,
    count: count ?? names.length,
    matches: names.map((name: string): WorkspaceAffectedResourceMatch => {
      return match(kind, name);
    }),
  };
}

function namesOf(
  matches: Array<WorkspaceAffectedResourceMatch>,
): Array<string> {
  return matches.map((item: WorkspaceAffectedResourceMatch): string => {
    return `${item.name} (${item.kind})`;
  });
}

beforeEach(() => {
  jest.spyOn(logger, "debug").mockImplementation((): void => {});
  jest
    .spyOn(ProductBrandingText, "getProductName")
    .mockReturnValue("OneUptime");
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the kinds a chat's Declare Incident form offers", () => {
  test("every kind OneUptime AI links, in its order - the Dashboard's Other Affected Resources", () => {
    expect(WorkspaceAffectedResources.getKinds()).toEqual(
      AI_AFFECTED_RESOURCE_KINDS.map(
        (info: AiAffectedResourceKindInfo): AiAffectedResourceKind => {
          return info.kind;
        },
      ),
    );
    expect(WorkspaceAffectedResources.getKinds()).toEqual([
      "Host",
      "NetworkDevice",
      "KubernetesCluster",
      "DockerHost",
      "PodmanHost",
      "ProxmoxCluster",
      "VMwareVCenter",
      "CephCluster",
      "StorageArray",
      "DockerSwarmCluster",
      "IoTFleet",
      "DatabaseServer",
      "CloudResource",
      "Service",
    ]);
  });

  test("never monitors - a monitor on a declared incident pauses its checks - nor network sites, which an incident has no list of", () => {
    const kinds: Array<string> = WorkspaceAffectedResources.getKinds();

    expect(kinds).not.toContain(AffectedResourceKind.Monitor);
    expect(kinds).not.toContain(AffectedResourceKind.NetworkSite);
  });

  test("each is a kind the one Affected Resources search answers for", () => {
    for (const kind of WorkspaceAffectedResources.getKinds()) {
      expect(AFFECTED_RESOURCE_KINDS).toContain(kind as string);
    }
  });

  test("each kind is named as the Dashboard's Affected Resources picker names it", () => {
    const source: string = fs.readFileSync(DASHBOARD_PICKER_PATH, "utf8");
    const picker: Record<string, { label: string; pluralLabel: string }> = {};

    for (const entry of source.matchAll(PICKER_CONFIG_ENTRY)) {
      picker[entry[1]!] = { label: entry[2]!, pluralLabel: entry[3]! };
    }

    for (const kind of WorkspaceAffectedResources.getKinds()) {
      expect({
        kind,
        ...WORKSPACE_AFFECTED_RESOURCE_KIND_LABELS[kind],
      }).toEqual({ kind, ...picker[kind] });
    }
  });

  test("getKindLabel and getKindPluralLabel read the same names", () => {
    expect(
      WorkspaceAffectedResources.getKindLabel(AiAffectedResourceKind.Host),
    ).toBe("Host");
    expect(
      WorkspaceAffectedResources.getKindPluralLabel(
        AiAffectedResourceKind.DatabaseServer,
      ),
    ).toBe("Databases");
    expect(
      WorkspaceAffectedResources.getKindLabel(
        AiAffectedResourceKind.VMwareVCenter,
      ),
    ).toBe("vCenter");
  });
});

describe("the form's words", () => {
  test("the field, its placeholder and why it is there", () => {
    expect(WORKSPACE_AFFECTED_RESOURCES_FIELD).toBe("affectedResources");
    expect(WORKSPACE_AFFECTED_RESOURCES_TEXT.label).toBe("Affected Resources");
    expect(WORKSPACE_AFFECTED_RESOURCES_TEXT.placeholder).toBe(
      "Search hosts, clusters, databases…",
    );
    expect(WorkspaceAffectedResources.getHint()).toBe(
      "OneUptime AI investigates what an incident is linked to, and can fix it.",
    );
  });

  test("the hint names the product by its name, which a licence can replace", () => {
    jest.spyOn(ProductBrandingText, "getProductName").mockReturnValue("Acme");

    expect(WorkspaceAffectedResources.getHint()).toBe(
      "Acme AI investigates what an incident is linked to, and can fix it.",
    );
  });

  test("the Monitors field says what a pick there does", () => {
    expect(WORKSPACE_AFFECTED_RESOURCES_TEXT.monitorsHint).toBe(
      "A monitor you pick here pauses its checks until the incident is resolved.",
    );
  });

  test("the placeholder fits a Slack select's 150 characters, the hint a Slack hint's 2,000", () => {
    expect(WORKSPACE_AFFECTED_RESOURCES_TEXT.placeholder.length).toBeLessThan(
      150,
    );
    expect(WorkspaceAffectedResources.getHint().length).toBeLessThan(2000);
    expect(WORKSPACE_AFFECTED_RESOURCES_TEXT.monitorsHint.length).toBeLessThan(
      2000,
    );
  });
});

describe("a pick's value", () => {
  test("is its kind and its id, and reads back as the same resource", () => {
    const value: string = WorkspaceAffectedResources.toValue({
      kind: AiAffectedResourceKind.KubernetesCluster,
      id: CLUSTER_ID.toUpperCase(),
    });

    expect(value).toBe(`KubernetesCluster:${CLUSTER_ID}`);
    expect(WorkspaceAffectedResources.readValue(value)).toEqual({
      kind: AiAffectedResourceKind.KubernetesCluster,
      id: CLUSTER_ID,
    });
  });

  test("fits Slack's 150-character option value for every kind", () => {
    for (const kind of WorkspaceAffectedResources.getKinds()) {
      expect(
        WorkspaceAffectedResources.toValue({ kind: kind, id: HOST_ID }).length,
      ).toBeLessThanOrEqual(150);
    }
  });

  test.each([
    ["no separator", HOST_ID],
    ["no kind", `:${HOST_ID}`],
    ["a kind that is no resource's", `Planet:${HOST_ID}`],
    ["a monitor", `Monitor:${HOST_ID}`],
    ["a network site", `NetworkSite:${HOST_ID}`],
    ["no id", "Host:"],
    ["an id that is no uuid", "Host:host-1"],
    ["a lower-cased kind", `host:${HOST_ID}`],
    ["a number", 42],
    ["nothing", undefined],
    ["an object", { kind: "Host", id: HOST_ID }],
  ])("names no resource: %s", (_what: string, value: unknown) => {
    expect(WorkspaceAffectedResources.readValue(value)).toBeNull();
  });

  test("white space around it is read past, and the id is lower-cased", () => {
    expect(
      WorkspaceAffectedResources.readValue(
        ` Service:${SERVICE_ID.toUpperCase()} `,
      ),
    ).toEqual({ kind: AiAffectedResourceKind.Service, id: SERVICE_ID });
  });
});

describe("the picks a form submits", () => {
  test("Slack's list of values, in the order picked", () => {
    expect(
      WorkspaceAffectedResources.readPicks([
        `Host:${HOST_ID}`,
        `Service:${SERVICE_ID}`,
      ]),
    ).toEqual({
      refs: [
        { kind: AiAffectedResourceKind.Host, id: HOST_ID },
        { kind: AiAffectedResourceKind.Service, id: SERVICE_ID },
      ],
      leftOutCount: 0,
    });
  });

  test("Microsoft Teams' one comma-separated string", () => {
    expect(
      WorkspaceAffectedResources.readPicks(
        `Host:${HOST_ID},KubernetesCluster:${CLUSTER_ID}`,
      ),
    ).toEqual({
      refs: [
        { kind: AiAffectedResourceKind.Host, id: HOST_ID },
        { kind: AiAffectedResourceKind.KubernetesCluster, id: CLUSTER_ID },
      ],
      leftOutCount: 0,
    });
  });

  test("nothing picked: no field at all, an empty list, an empty string", () => {
    for (const value of [undefined, null, [], "", " , "]) {
      expect(WorkspaceAffectedResources.readPicks(value)).toEqual({
        refs: [],
        leftOutCount: 0,
      });
    }
  });

  test("each resource once, however often it is named", () => {
    expect(
      WorkspaceAffectedResources.readPicks([
        `Host:${HOST_ID}`,
        `Host:${HOST_ID.toUpperCase()}`,
        ` Host:${HOST_ID}`,
      ]).refs,
    ).toEqual([{ kind: AiAffectedResourceKind.Host, id: HOST_ID }]);
  });

  test("a value that names no resource is left out, and counted", () => {
    expect(
      WorkspaceAffectedResources.readPicks([
        `Host:${HOST_ID}`,
        "Host:not-an-id",
        `Monitor:${SERVICE_ID}`,
        42,
      ]),
    ).toEqual({
      refs: [{ kind: AiAffectedResourceKind.Host, id: HOST_ID }],
      leftOutCount: 3,
    });
  });

  test(`at most ${WORKSPACE_MAX_AFFECTED_RESOURCES}: the rest are counted as left out`, () => {
    const values: Array<string> = [];

    for (let index: number = 1; index <= 53; index++) {
      values.push(
        `Host:5ac10000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      );
    }

    const picks: WorkspaceAffectedResourcePicks =
      WorkspaceAffectedResources.readPicks(values);

    expect(picks.refs).toHaveLength(WORKSPACE_MAX_AFFECTED_RESOURCES);
    expect(picks.refs[0]!.id).toBe("5ac10000-0000-4000-8000-000000000001");
    expect(picks.refs[49]!.id).toBe("5ac10000-0000-4000-8000-000000000050");
    expect(picks.leftOutCount).toBe(3);
  });
});

describe("what a person types, as it is searched", () => {
  test("trimmed, and cut to the longest text the search takes", () => {
    expect(WorkspaceAffectedResources.readSearchText("  api  ")).toBe("api");
    expect(
      WorkspaceAffectedResources.readSearchText(
        "a".repeat(AFFECTED_RESOURCE_SEARCH_MAX_TEXT_LENGTH + 50),
      ),
    ).toHaveLength(AFFECTED_RESOURCE_SEARCH_MAX_TEXT_LENGTH);
  });

  test("anything that is not text is no text", () => {
    expect(WorkspaceAffectedResources.readSearchText(undefined)).toBe("");
    expect(WorkspaceAffectedResources.readSearchText(42)).toBe("");
    expect(WorkspaceAffectedResources.readSearchText({ value: "api" })).toBe(
      "",
    );
  });
});

describe("one list across the kinds, for a chat that lists them together", () => {
  /*
   * Each kind's matches come ranked by the search already (a name that is
   * the text, then names that start with it, then the rest by name), so
   * the list keeps each kind's order and lays the kinds over each other.
   */
  test("the names that are the text first, then names that start with it, then the rest", () => {
    const ranked: Array<WorkspaceAffectedResourceMatch> =
      WorkspaceAffectedResources.rankAcrossKinds({
        groups: [
          group(AiAffectedResourceKind.Host, ["API", "api-1", "access-api"]),
          group(AiAffectedResourceKind.Service, ["api", "payments-api"]),
        ],
        text: "api",
        limit: 15,
      });

    expect(namesOf(ranked)).toEqual([
      "API (Host)",
      "api (Service)",
      "api-1 (Host)",
      "payments-api (Service)",
      "access-api (Host)",
    ]);
  });

  test("a later kind's exact name goes before an earlier kind's other matches", () => {
    const ranked: Array<WorkspaceAffectedResourceMatch> =
      WorkspaceAffectedResources.rankAcrossKinds({
        groups: [
          group(AiAffectedResourceKind.Host, ["orders-1", "orders-2"]),
          group(AiAffectedResourceKind.DatabaseServer, ["orders"]),
        ],
        text: "Orders",
        limit: 15,
      });

    expect(namesOf(ranked)).toEqual([
      "orders (DatabaseServer)",
      "orders-1 (Host)",
      "orders-2 (Host)",
    ]);
  });

  test("within a rank the kinds take turns, so one kind with many matches pushes no other off the list", () => {
    const ranked: Array<WorkspaceAffectedResourceMatch> =
      WorkspaceAffectedResources.rankAcrossKinds({
        groups: [
          group(AiAffectedResourceKind.Host, [
            "web-01",
            "web-02",
            "web-03",
            "web-04",
          ]),
          group(AiAffectedResourceKind.KubernetesCluster, ["web-prod"]),
          group(AiAffectedResourceKind.DatabaseServer, ["web-db"]),
        ],
        text: "web",
        limit: 4,
      });

    expect(namesOf(ranked)).toEqual([
      "web-01 (Host)",
      "web-prod (KubernetesCluster)",
      "web-db (DatabaseServer)",
      "web-02 (Host)",
    ]);
  });

  test("no text: suggestions, the kinds in turn, the first of each first", () => {
    const ranked: Array<WorkspaceAffectedResourceMatch> =
      WorkspaceAffectedResources.rankAcrossKinds({
        groups: [
          group(AiAffectedResourceKind.Host, ["a-host", "b-host"]),
          group(AiAffectedResourceKind.Service, ["a-service", "b-service"]),
        ],
        text: "  ",
        limit: 3,
      });

    expect(namesOf(ranked)).toEqual([
      "a-host (Host)",
      "a-service (Service)",
      "b-host (Host)",
    ]);
  });

  test("at most the limit, and none for none", () => {
    expect(
      WorkspaceAffectedResources.rankAcrossKinds({
        groups: [group(AiAffectedResourceKind.Host, ["a", "b", "c"])],
        text: "",
        limit: 2,
      }),
    ).toHaveLength(2);
    expect(
      WorkspaceAffectedResources.rankAcrossKinds({
        groups: [group(AiAffectedResourceKind.Host, ["a"])],
        text: "",
        limit: 0,
      }),
    ).toEqual([]);
    expect(
      WorkspaceAffectedResources.rankAcrossKinds({
        groups: [],
        text: "a",
        limit: 15,
      }),
    ).toEqual([]);
  });
});

describe("whose kinds a member may read: from their permissions alone", () => {
  test.each([
    ["a project owner", [Permission.ProjectOwner]],
    ["a project member", [Permission.ProjectMember]],
    ["a viewer", [Permission.Viewer]],
  ])("%s reads every kind", (_who: string, permissions: Array<Permission>) => {
    expect(
      WorkspaceAffectedResources.getReadableKinds(memberProps(permissions)),
    ).toEqual(WorkspaceAffectedResources.getKinds());
  });

  test("a role that may declare incidents and read no resource reads none: the form has no field", () => {
    expect(
      WorkspaceAffectedResources.getReadableKinds(
        memberProps([
          Permission.CreateProjectIncident,
          Permission.ReadProjectIncident,
        ]),
      ),
    ).toEqual([]);
  });

  test("a role that reads hosts alone reads hosts alone", () => {
    expect(
      WorkspaceAffectedResources.getReadableKinds(
        memberProps([Permission.CreateProjectIncident, Permission.ReadHost]),
      ),
    ).toEqual([AiAffectedResourceKind.Host]);
  });

  test("reading them leaves the member's props as they were: the incident is created with exactly those", () => {
    const props: DatabaseCommonInteractionProps = memberProps([
      Permission.ProjectMember,
    ]);
    const before: string = JSON.stringify(props);

    WorkspaceAffectedResources.getReadableKinds(props);

    expect(JSON.stringify(props)).toBe(before);
    expect(props.userGlobalAccessPermission).toBeUndefined();
  });
});

describe("whether a form offers the field", () => {
  type FindBy = (data: unknown) => Promise<Array<BaseModel>>;

  function stubFind(
    kind: AiAffectedResourceKind,
    answer: Array<BaseModel> | Error,
  ): SpyInstance<FindBy> {
    const service: { findBy: FindBy } = getAffectedResourceKindService(
      kind as unknown as AffectedResourceKind,
    ) as unknown as { findBy: FindBy };

    return jest
      .spyOn(service, "findBy")
      .mockImplementation(async (): Promise<Array<BaseModel>> => {
        if (answer instanceof Error) {
          throw answer;
        }

        return answer;
      });
  }

  function host(): Host {
    const row: Host = new Host();
    row._id = HOST_ID;
    return row;
  }

  function stubEveryKind(): Record<string, SpyInstance<FindBy>> {
    const spies: Record<string, SpyInstance<FindBy>> = {};

    for (const kind of WorkspaceAffectedResources.getKinds()) {
      spies[kind] = stubFind(kind, []);
    }

    return spies;
  }

  test("a project with a host offers it, after one read of one row: the member's own, in the project, not archived", async () => {
    const spies: Record<string, SpyInstance<FindBy>> = stubEveryKind();
    spies[AiAffectedResourceKind.Host] = stubFind(AiAffectedResourceKind.Host, [
      host(),
    ]);
    const props: DatabaseCommonInteractionProps = memberProps([
      Permission.ProjectMember,
    ]);

    await expect(
      WorkspaceAffectedResources.isOffered({
        projectId: PROJECT_ID,
        props: props,
      }),
    ).resolves.toBe(true);

    const hostReads: SpyInstance<FindBy> = spies[AiAffectedResourceKind.Host]!;
    expect(hostReads).toHaveBeenCalledTimes(1);

    const read: {
      query: Record<string, unknown>;
      limit: number;
      props: DatabaseCommonInteractionProps;
    } = hostReads.mock.calls[0]![0] as never;

    expect(read.limit).toBe(1);
    expect(read.query["projectId"]).toBe(PROJECT_ID);
    expect(read.query["isArchived"]).toBe(false);
    expect(read.query["_multiFieldSearch"]).toBeUndefined();
    // The member's own permissions, in a copy: the incident keeps its props.
    expect(read.props.userId).toEqual(props.userId);
    expect(read.props.userTenantAccessPermission).toBe(
      props.userTenantAccessPermission,
    );
    expect(read.props).not.toBe(props);

    // Found with the first kind: no other kind is read.
    for (const kind of WorkspaceAffectedResources.getKinds()) {
      if (kind !== AiAffectedResourceKind.Host) {
        expect({ kind, reads: spies[kind]!.mock.calls.length }).toEqual({
          kind,
          reads: 0,
        });
      }
    }
  });

  test("a project whose only resource is a service is read kind by kind, until the service", async () => {
    const spies: Record<string, SpyInstance<FindBy>> = stubEveryKind();
    const service: Service = new Service();
    service._id = SERVICE_ID;
    spies[AiAffectedResourceKind.Service] = stubFind(
      AiAffectedResourceKind.Service,
      [service],
    );

    await expect(
      WorkspaceAffectedResources.isOffered({
        projectId: PROJECT_ID,
        props: memberProps([Permission.ProjectMember]),
      }),
    ).resolves.toBe(true);

    for (const kind of WorkspaceAffectedResources.getKinds()) {
      expect({ kind, reads: spies[kind]!.mock.calls.length }).toEqual({
        kind,
        reads: 1,
      });
    }
  });

  test("a project with nothing to pick - monitors and nothing else - keeps its form as it was", async () => {
    stubEveryKind();

    await expect(
      WorkspaceAffectedResources.isOffered({
        projectId: PROJECT_ID,
        props: memberProps([Permission.ProjectMember]),
      }),
    ).resolves.toBe(false);
  });

  test("a member who may read no kind of resource gets no field, and nothing is read", async () => {
    const spies: Record<string, SpyInstance<FindBy>> = stubEveryKind();

    await expect(
      WorkspaceAffectedResources.isOffered({
        projectId: PROJECT_ID,
        props: memberProps([
          Permission.CreateProjectIncident,
          Permission.ReadProjectIncident,
        ]),
      }),
    ).resolves.toBe(false);

    for (const spy of Object.values(spies)) {
      expect(spy).not.toHaveBeenCalled();
    }
  });

  test("a member who reads hosts alone is asked about hosts alone", async () => {
    const spies: Record<string, SpyInstance<FindBy>> = stubEveryKind();

    await expect(
      WorkspaceAffectedResources.isOffered({
        projectId: PROJECT_ID,
        props: memberProps([
          Permission.CreateProjectIncident,
          Permission.ReadHost,
        ]),
      }),
    ).resolves.toBe(false);

    expect(spies[AiAffectedResourceKind.Host]).toHaveBeenCalledTimes(1);
    expect(spies[AiAffectedResourceKind.Service]).not.toHaveBeenCalled();
  });

  test("a kind the member is refused, or whose read fails, counts as none of it - the next kind is still asked", async () => {
    const spies: Record<string, SpyInstance<FindBy>> = stubEveryKind();
    spies[AiAffectedResourceKind.Host] = stubFind(
      AiAffectedResourceKind.Host,
      new NotAuthorizedException("You may not read hosts."),
    );
    spies[AiAffectedResourceKind.NetworkDevice] = stubFind(
      AiAffectedResourceKind.NetworkDevice,
      new Error("connection reset"),
    );
    const service: Service = new Service();
    service._id = SERVICE_ID;
    spies[AiAffectedResourceKind.Service] = stubFind(
      AiAffectedResourceKind.Service,
      [service],
    );

    await expect(
      WorkspaceAffectedResources.isOffered({
        projectId: PROJECT_ID,
        props: memberProps([Permission.ProjectMember]),
      }),
    ).resolves.toBe(true);
  });

  test("every read failing offers no field, and never throws", async () => {
    for (const kind of WorkspaceAffectedResources.getKinds()) {
      stubFind(kind, new Error("the database is gone"));
    }

    await expect(
      WorkspaceAffectedResources.isOffered({
        projectId: PROJECT_ID,
        props: memberProps([Permission.ProjectMember]),
      }),
    ).resolves.toBe(false);
  });
});

describe("the search, as the member", () => {
  type Search = typeof AffectedResourceSearch.search;

  function stubSearch(
    result: AffectedResourceSearchResult,
  ): SpyInstance<Search> {
    return jest
      .spyOn(AffectedResourceSearch, "search")
      .mockResolvedValue(result);
  }

  function requestOf(spy: SpyInstance<Search>): AffectedResourceSearchRequest {
    return (spy.mock.calls[0]![0] as { request: AffectedResourceSearchRequest })
      .request;
  }

  test("asks the one search for every kind offered, in the member's project, with their props - never monitors", async () => {
    const spy: SpyInstance<Search> = stubSearch({
      kinds: [],
      counts: [],
      unreadableKinds: [],
    });
    const props: DatabaseCommonInteractionProps = memberProps([
      Permission.ProjectMember,
    ]);

    await WorkspaceAffectedResources.search({
      projectId: PROJECT_ID,
      props: props,
      text: "  api  ",
    });

    expect(spy).toHaveBeenCalledTimes(1);

    const call: {
      projectId: ObjectID;
      props: DatabaseCommonInteractionProps;
    } = spy.mock.calls[0]![0] as never;

    expect(call.projectId).toBe(PROJECT_ID);
    expect(call.props.userId).toEqual(props.userId);
    expect(call.props.userTenantAccessPermission).toBe(
      props.userTenantAccessPermission,
    );
    expect(requestOf(spy)).toEqual({
      search: "api",
      kinds: WorkspaceAffectedResources.getKinds(),
      limitPerKind: WORKSPACE_AFFECTED_RESOURCE_SEARCH_LIMIT_PER_KIND,
      countKinds: [],
    });
    expect(requestOf(spy).kinds).not.toContain(AffectedResourceKind.Monitor);
  });

  test("the limit per kind is held between 1 and the search's own most", async () => {
    const spy: SpyInstance<Search> = stubSearch({
      kinds: [],
      counts: [],
      unreadableKinds: [],
    });

    for (const [asked, read] of [
      [0, WORKSPACE_AFFECTED_RESOURCE_SEARCH_LIMIT_PER_KIND],
      [-4, 1],
      [3.7, 3],
      [1000, 50],
    ] as Array<[number, number]>) {
      spy.mockClear();
      await WorkspaceAffectedResources.search({
        projectId: PROJECT_ID,
        props: memberProps([Permission.ProjectMember]),
        text: "",
        limitPerKind: asked,
      });

      expect({ asked, read: requestOf(spy).limitPerKind }).toEqual({
        asked,
        read,
      });
    }
  });

  test("its answer, kind by kind: the kinds with matches, each match with its id lower-cased, a count never below what is listed", async () => {
    stubSearch({
      kinds: [
        {
          kind: AffectedResourceKind.Host,
          count: 12,
          matches: [
            { _id: HOST_ID.toUpperCase(), name: " api-1 " },
            { _id: SECOND_HOST_ID, name: "api-2" },
          ],
        },
        {
          kind: AffectedResourceKind.NetworkDevice,
          count: 0,
          matches: [
            {
              _id: "5ac10000-0000-4000-8000-0000000000e1",
              name: "core-sw-01",
              detail: "10.0.4.1",
            },
          ],
        },
        { kind: AffectedResourceKind.Service, count: 0, matches: [] },
      ],
      counts: [],
      unreadableKinds: [AffectedResourceKind.DatabaseServer],
    });

    const groups: Array<WorkspaceAffectedResourceKindMatches> =
      await WorkspaceAffectedResources.search({
        projectId: PROJECT_ID,
        props: memberProps([Permission.ProjectMember]),
        text: "api",
      });

    expect(groups).toEqual([
      {
        kind: AiAffectedResourceKind.Host,
        count: 12,
        matches: [
          { kind: AiAffectedResourceKind.Host, id: HOST_ID, name: "api-1" },
          {
            kind: AiAffectedResourceKind.Host,
            id: SECOND_HOST_ID,
            name: "api-2",
          },
        ],
      },
      {
        kind: AiAffectedResourceKind.NetworkDevice,
        count: 1,
        matches: [
          {
            kind: AiAffectedResourceKind.NetworkDevice,
            id: "5ac10000-0000-4000-8000-0000000000e1",
            name: "core-sw-01",
            detail: "10.0.4.1",
          },
        ],
      },
    ]);
  });

  test("a match with no name or no id is not listed; a kind the forms do not offer is never listed", async () => {
    stubSearch({
      kinds: [
        {
          kind: AffectedResourceKind.Host,
          count: 3,
          matches: [
            { _id: HOST_ID, name: "  " },
            { _id: "not-an-id", name: "api-9" },
            { _id: SECOND_HOST_ID, name: "api-2" },
          ],
        },
        {
          kind: AffectedResourceKind.Monitor,
          count: 1,
          matches: [{ _id: SERVICE_ID, name: "Checkout API" }],
        },
      ],
      counts: [],
      unreadableKinds: [],
    });

    const groups: Array<WorkspaceAffectedResourceKindMatches> =
      await WorkspaceAffectedResources.search({
        projectId: PROJECT_ID,
        props: memberProps([Permission.ProjectMember]),
        text: "api",
      });

    expect(groups).toEqual([
      {
        kind: AiAffectedResourceKind.Host,
        count: 3,
        matches: [
          {
            kind: AiAffectedResourceKind.Host,
            id: SECOND_HOST_ID,
            name: "api-2",
          },
        ],
      },
    ]);
  });
});

describe("what a submission links: every pick read again as the member, on the real permission layer", () => {
  beforeEach(() => {
    useInMemoryTable(HostService, [
      {
        _id: HOST_ID,
        projectId: PROJECT_ID.toString(),
        name: "api-1",
        hostIdentifier: "api-1",
        isArchived: false,
        version: 1,
      },
      {
        _id: OTHER_PROJECT_HOST_ID,
        projectId: OTHER_PROJECT_ID.toString(),
        name: "their-box",
        hostIdentifier: "their-box",
        isArchived: false,
        version: 1,
      },
      {
        _id: ARCHIVED_HOST_ID,
        projectId: PROJECT_ID.toString(),
        name: "old-box",
        hostIdentifier: "old-box",
        isArchived: true,
        version: 1,
      },
    ]);
    useInMemoryTable(ServiceService, [
      {
        _id: SERVICE_ID,
        projectId: PROJECT_ID.toString(),
        name: "checkout",
        isArchived: false,
        version: 1,
      },
    ]);
  });

  async function readPicked(
    permissions: Array<Permission>,
    values: Array<string>,
  ): Promise<WorkspaceAffectedResourcesToLink> {
    return await WorkspaceAffectedResources.readPicked({
      projectId: PROJECT_ID,
      props: memberProps(permissions),
      picks: WorkspaceAffectedResources.readPicks(values),
    });
  }

  test("one pick: the project's host, by its name", async () => {
    await expect(
      readPicked([Permission.ProjectMember], [`Host:${HOST_ID}`]),
    ).resolves.toEqual({
      linked: [
        { kind: AiAffectedResourceKind.Host, id: HOST_ID, name: "api-1" },
      ],
      notLinkedCount: 0,
    });
  });

  test("many picks of several kinds, each linked", async () => {
    const toLink: WorkspaceAffectedResourcesToLink = await readPicked(
      [Permission.ProjectMember],
      [`Service:${SERVICE_ID}`, `Host:${HOST_ID}`],
    );

    expect(toLink.notLinkedCount).toBe(0);
    expect(toLink.linked).toEqual(
      expect.arrayContaining([
        { kind: AiAffectedResourceKind.Host, id: HOST_ID, name: "api-1" },
        {
          kind: AiAffectedResourceKind.Service,
          id: SERVICE_ID,
          name: "checkout",
        },
      ]),
    );
    expect(toLink.linked).toHaveLength(2);
  });

  test("another project's host - a tampered value - and an archived one are never linked, only counted", async () => {
    await expect(
      readPicked(
        [Permission.ProjectOwner],
        [
          `Host:${OTHER_PROJECT_HOST_ID}`,
          `Host:${ARCHIVED_HOST_ID}`,
          `Host:${HOST_ID}`,
        ],
      ),
    ).resolves.toEqual({
      linked: [
        { kind: AiAffectedResourceKind.Host, id: HOST_ID, name: "api-1" },
      ],
      notLinkedCount: 2,
    });
  });

  test("a member whose role reads no hosts links none of them", async () => {
    await expect(
      readPicked(
        [Permission.CreateProjectIncident, Permission.ReadService],
        [`Host:${HOST_ID}`, `Service:${SERVICE_ID}`],
      ),
    ).resolves.toEqual({
      linked: [
        {
          kind: AiAffectedResourceKind.Service,
          id: SERVICE_ID,
          name: "checkout",
        },
      ],
      notLinkedCount: 1,
    });
  });

  test("no picks: nothing read, nothing linked", async () => {
    await expect(readPicked([Permission.ProjectMember], [])).resolves.toEqual({
      linked: [],
      notLinkedCount: 0,
    });
  });

  test("values that name no resource are counted with the picks not linked", async () => {
    await expect(
      readPicked(
        [Permission.ProjectMember],
        ["Host:nope", `Monitor:${HOST_ID}`, `Host:${HOST_ID}`],
      ),
    ).resolves.toEqual({
      linked: [
        { kind: AiAffectedResourceKind.Host, id: HOST_ID, name: "api-1" },
      ],
      notLinkedCount: 2,
    });
  });

  test("reading them leaves the member's props as they were", async () => {
    const props: DatabaseCommonInteractionProps = memberProps([
      Permission.ProjectMember,
    ]);
    const before: string = JSON.stringify(props);

    await WorkspaceAffectedResources.readPicked({
      projectId: PROJECT_ID,
      props: props,
      picks: WorkspaceAffectedResources.readPicks([`Host:${HOST_ID}`]),
    });

    expect(JSON.stringify(props)).toBe(before);
  });
});

describe("the new incident's lists", () => {
  test("each resource in its kind's list, as an incident declared in the Dashboard holds it", () => {
    const incident: Incident = new Incident();
    const linked: Array<LinkedAffectedResource> = [
      { kind: AiAffectedResourceKind.Host, id: HOST_ID, name: "api-1" },
      { kind: AiAffectedResourceKind.Host, id: SECOND_HOST_ID, name: "api-2" },
      {
        kind: AiAffectedResourceKind.KubernetesCluster,
        id: CLUSTER_ID,
        name: "prod",
      },
    ];

    WorkspaceAffectedResources.setOnIncident(incident, linked);

    expect(
      (incident.hosts || []).map((row: Host): string => {
        return row.id!.toString();
      }),
    ).toEqual([HOST_ID, SECOND_HOST_ID]);
    expect(
      (incident.kubernetesClusters || []).map((row: BaseModel): string => {
        return row.id!.toString();
      }),
    ).toEqual([CLUSTER_ID]);
    // Never the monitors: a monitor on a declared incident pauses its checks.
    expect(incident.monitors).toBeUndefined();
    expect(incident.services).toBeUndefined();
  });

  test("nothing linked: no list is written", () => {
    const incident: Incident = new Incident();

    WorkspaceAffectedResources.setOnIncident(incident, []);

    for (const info of AI_AFFECTED_RESOURCE_KINDS) {
      expect({
        relation: info.relation,
        value: (incident as unknown as Record<string, unknown>)[info.relation],
      }).toEqual({ relation: info.relation, value: undefined });
    }
  });
});

describe("an alert's resources, for a form declared in its channel", () => {
  type ReadForAlert = typeof LinkedAffectedResources.readForAlert;

  beforeEach(() => {
    useInMemoryTable(HostService, [
      {
        _id: HOST_ID,
        projectId: PROJECT_ID.toString(),
        name: "api-1",
        hostIdentifier: "api-1",
        isArchived: false,
        version: 1,
      },
      {
        _id: ARCHIVED_HOST_ID,
        projectId: PROJECT_ID.toString(),
        name: "old-box",
        hostIdentifier: "old-box",
        isArchived: true,
        version: 1,
      },
    ]);
    useInMemoryTable(ServiceService, [
      {
        _id: SERVICE_ID,
        projectId: PROJECT_ID.toString(),
        name: "checkout",
        isArchived: false,
        version: 1,
      },
    ]);
  });

  function stubListed(
    listed: Array<ListedAffectedResource> | Error,
  ): SpyInstance<ReadForAlert> {
    return jest
      .spyOn(LinkedAffectedResources, "readForAlert")
      .mockImplementation(async (): Promise<Array<ListedAffectedResource>> => {
        if (listed instanceof Error) {
          throw listed;
        }

        return listed;
      });
  }

  test("what the alert lists that the member may view - never its monitor, its SLO or a network site", async () => {
    const spy: SpyInstance<ReadForAlert> = stubListed([
      {
        type: LinkedAffectedResourceType.Monitor,
        id: "5ac10000-0000-4000-8000-0000000000f1",
        name: "Checkout API",
      },
      { type: LinkedAffectedResourceType.Host, id: HOST_ID, name: "api-1" },
      {
        type: LinkedAffectedResourceType.Host,
        id: ARCHIVED_HOST_ID,
        name: "old-box",
      },
      {
        type: LinkedAffectedResourceType.Service,
        id: SERVICE_ID,
        name: "checkout",
      },
      {
        type: LinkedAffectedResourceType.NetworkSite,
        id: "5ac10000-0000-4000-8000-0000000000f2",
        name: "Frankfurt",
      },
      {
        type: LinkedAffectedResourceType.ServiceLevelObjective,
        id: "5ac10000-0000-4000-8000-0000000000f3",
        name: "Checkout SLO",
      },
    ]);

    const resources: Array<LinkedAffectedResource> =
      await WorkspaceAffectedResources.readAlertResources({
        projectId: PROJECT_ID,
        alertId: ALERT_ID,
        props: memberProps([Permission.ProjectMember]),
      });

    expect(resources).toEqual([
      { kind: AiAffectedResourceKind.Host, id: HOST_ID, name: "api-1" },
      {
        kind: AiAffectedResourceKind.Service,
        id: SERVICE_ID,
        name: "checkout",
      },
    ]);
    // Which ones the alert lists is read as OneUptime, held to its project.
    expect(spy.mock.calls[0]![0]).toEqual(
      expect.objectContaining({ projectId: PROJECT_ID, alertId: ALERT_ID }),
    );
  });

  test("a member who reads no hosts is shown none of the alert's hosts", async () => {
    stubListed([
      { type: LinkedAffectedResourceType.Host, id: HOST_ID, name: "api-1" },
    ]);

    await expect(
      WorkspaceAffectedResources.readAlertResources({
        projectId: PROJECT_ID,
        alertId: ALERT_ID,
        props: memberProps([
          Permission.CreateProjectIncident,
          Permission.ReadAlert,
        ]),
      }),
    ).resolves.toEqual([]);
  });

  test("an alert linked to nothing, or a read that fails: none, and it never throws", async () => {
    stubListed([]);

    await expect(
      WorkspaceAffectedResources.readAlertResources({
        projectId: PROJECT_ID,
        alertId: ALERT_ID,
        props: memberProps([Permission.ProjectMember]),
      }),
    ).resolves.toEqual([]);

    stubListed(new Error("connection reset"));

    await expect(
      WorkspaceAffectedResources.readAlertResources({
        projectId: PROJECT_ID,
        alertId: ALERT_ID,
        props: memberProps([Permission.ProjectMember]),
      }),
    ).resolves.toEqual([]);
  });
});

describe("the confirmation's words", () => {
  const API_HOST: LinkedAffectedResource = {
    kind: AiAffectedResourceKind.Host,
    id: HOST_ID,
    name: "api-1",
  };
  const PROD: LinkedAffectedResource = {
    kind: AiAffectedResourceKind.KubernetesCluster,
    id: CLUSTER_ID,
    name: "prod",
  };
  const ORDERS: LinkedAffectedResource = {
    kind: AiAffectedResourceKind.DatabaseServer,
    id: SERVICE_ID,
    name: "orders",
  };

  test("nothing linked: no line", () => {
    expect(WorkspaceAffectedResources.getLinkedLine({ linked: [] })).toBeNull();
  });

  test("one resource, by its name and its kind", () => {
    expect(
      WorkspaceAffectedResources.getLinkedLine({
        linked: [API_HOST],
      })?.toString(),
    ).toBe("Linked to **api-1** (Host).");
  });

  test("two, then many", () => {
    expect(
      WorkspaceAffectedResources.getLinkedLine({
        linked: [API_HOST, PROD],
      })?.toString(),
    ).toBe("Linked to **api-1** (Host) and **prod** (Kubernetes Cluster).");
    expect(
      WorkspaceAffectedResources.getLinkedLine({
        linked: [API_HOST, PROD, ORDERS],
      })?.toString(),
    ).toBe(
      "Linked to **api-1** (Host), **prod** (Kubernetes Cluster) and **orders** (Database).",
    );
  });

  test("the alert it was declared from comes last, linked to itself", () => {
    expect(
      WorkspaceAffectedResources.getLinkedLine({
        linked: [API_HOST],
        alert: {
          label: "Alert ALT-3",
          link: "https://oneuptime.test/dashboard/p/alerts/a",
        },
      })?.toString(),
    ).toBe(
      "Linked to **api-1** (Host) and **[Alert ALT-3](https://oneuptime.test/dashboard/p/alerts/a)**.",
    );
    expect(
      WorkspaceAffectedResources.getLinkedLine({
        linked: [],
        alert: { label: "Alert ALT-3", link: null },
      })?.toString(),
    ).toBe("Linked to **Alert ALT-3**.");
  });

  test("a name is text: Markdown in it, or a link, is never read as Markdown", () => {
    const line: string =
      WorkspaceAffectedResources.getLinkedLine({
        linked: [
          {
            kind: AiAffectedResourceKind.Host,
            id: HOST_ID,
            name: "**boss** [click](https://evil.example)",
          },
        ],
      })?.toString() || "";

    expect(line).toBe(
      "Linked to **\\*\\*boss\\*\\* \\[click\\](https://evil.example)** (Host).",
    );
    expect(line).not.toContain("**boss**");
    expect(line).not.toContain("[click](");
  });

  test("what was picked and not linked: one, many, none", () => {
    expect(WorkspaceAffectedResources.getNotLinkedLine(0)).toBeNull();
    expect(WorkspaceAffectedResources.getNotLinkedLine(1)).toBe(
      "1 resource you picked was not linked: it was deleted or archived, or you may no longer view it.",
    );
    expect(WorkspaceAffectedResources.getNotLinkedLine(3)).toBe(
      "3 resources you picked were not linked: they were deleted or archived, or you may no longer view them.",
    );
  });
});
