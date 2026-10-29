import AffectedResourceLinks, {
  AFFECTED_RESOURCES_ARGUMENT_NAME,
  AFFECTED_RESOURCES_ARGUMENT_SCHEMA,
  AffectedResourcesToLink,
  describeLinkedResource,
  LinkedAffectedResource,
  RequestedAffectedResources,
} from "../../../../Server/Utils/AI/Toolbox/AffectedResourceLinks";
import { ToolContext } from "../../../../Server/Utils/AI/Toolbox/ToolTypes";
import HostService from "../../../../Server/Services/HostService";
import KubernetesClusterService from "../../../../Server/Services/KubernetesClusterService";
import NetworkDeviceService from "../../../../Server/Services/NetworkDeviceService";
import ServiceService from "../../../../Server/Services/ServiceService";
import StorageArrayService from "../../../../Server/Services/StorageArrayService";
import Alert from "../../../../Models/DatabaseModels/Alert";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Host from "../../../../Models/DatabaseModels/Host";
import Incident from "../../../../Models/DatabaseModels/Incident";
import KubernetesCluster from "../../../../Models/DatabaseModels/KubernetesCluster";
import NetworkDevice from "../../../../Models/DatabaseModels/NetworkDevice";
import Service from "../../../../Models/DatabaseModels/Service";
import StorageArray from "../../../../Models/DatabaseModels/StorageArray";
import AIChatPageContextType, {
  AIChatPageContext,
} from "../../../../Types/AI/AIChatPageContext";
import {
  AI_AFFECTED_RESOURCE_KINDS,
  AiAffectedResourceKind,
  AiAffectedResourceKindInfo,
  AiAffectedResourceRelation,
} from "../../../../Types/AI/AiAffectedResources";
import { AIResourceType } from "../../../../Types/AI/AIResourceContext";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * The server's half of what OneUptime AI links an incident or alert to
 * (#5293), shared by create_incident and the add_*_affected_resources
 * tools: which resources a call asks for (its own list, or the page's
 * resource when it names none), which of them it links (each read with the
 * person's own props, in the request's project, never an archived one),
 * the lists it writes (whole lists, so what a record listed already stays)
 * and the words: the approval card's line, the model's answer and the
 * widget.
 */

afterEach(() => {
  jest.restoreAllMocks();
});

const PROJECT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);
const HOST_ID: string = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OTHER_HOST_ID: string = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbc";
const CLUSTER_ID: string = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const SERVICE_ID: string = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const HELD_HOST_ID: string = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const ROUTER_ID: string = "ffffffff-ffff-4fff-8fff-ffffffffffff";

const HOST_PAGE: AIChatPageContext = {
  type: AIChatPageContextType.Resource,
  resourceType: AIResourceType.Host,
  entityId: HOST_ID,
  entityTitle: "test01",
};

function context(pageContext?: AIChatPageContext): ToolContext {
  return {
    projectId: PROJECT_ID,
    props: { userId: ObjectID.generate(), tenantId: PROJECT_ID },
    ...(pageContext ? { pageContext } : {}),
  };
}

function row<T extends BaseModel>(
  modelType: { new (): T },
  id: string,
  name: string,
  isArchived: boolean = false,
): T {
  const record: T = new modelType();
  record._id = id;
  (record as unknown as { name: string }).name = name;
  (record as unknown as { isArchived: boolean }).isArchived = isArchived;
  return record;
}

function linked(
  kind: AiAffectedResourceKind,
  id: string,
  name: string,
): LinkedAffectedResource {
  return { kind, id, name };
}

// The ids a QueryHelper.any operator was built from.
function idsInQuery(query: unknown): Array<string> {
  const operator: { objectLiteralParameters?: Record<string, unknown> } =
    (query as { _id?: { objectLiteralParameters?: Record<string, unknown> } })
      ._id || {};

  return Object.values(operator.objectLiteralParameters || {})
    .flat()
    .map((id: unknown): string => {
      return String(id).toLowerCase();
    });
}

describe("which resources a call asks to link", () => {
  test("declared from a host's page without naming any: that host (issue #5293)", () => {
    const requested: RequestedAffectedResources =
      AffectedResourceLinks.getRequested({
        args: { title: "high memory usage" },
        ctx: context(HOST_PAGE),
        defaultsToPage: true,
      });

    expect(requested).toEqual({
      refs: [{ kind: AiAffectedResourceKind.Host, id: HOST_ID }],
      problems: [],
      isFromPage: true,
      isNamedByCall: false,
    });
  });

  /*
   * Issue #5341: a router's page used to be about nothing an incident could
   * hold, so an incident Ask AI declared there linked nothing.
   */
  test("declared from a network device's page without naming any: that device", () => {
    const requested: RequestedAffectedResources =
      AffectedResourceLinks.getRequested({
        args: { title: "BGP session down" },
        ctx: context({
          type: AIChatPageContextType.Resource,
          resourceType: AIResourceType.NetworkDevice,
          entityId: ROUTER_ID,
          entityTitle: "WAN-RTR-01",
        }),
        defaultsToPage: true,
      });

    expect(requested).toEqual({
      refs: [{ kind: AiAffectedResourceKind.NetworkDevice, id: ROUTER_ID }],
      problems: [],
      isFromPage: true,
      isNamedByCall: false,
    });
  });

  test("a list the call names wins over the page", () => {
    const requested: RequestedAffectedResources =
      AffectedResourceLinks.getRequested({
        args: {
          [AFFECTED_RESOURCES_ARGUMENT_NAME]: [
            { resourceType: "KubernetesCluster", resourceId: CLUSTER_ID },
          ],
        },
        ctx: context(HOST_PAGE),
        defaultsToPage: true,
      });

    expect(requested.refs).toEqual([
      { kind: AiAffectedResourceKind.KubernetesCluster, id: CLUSTER_ID },
    ]);
    expect(requested.isFromPage).toBe(false);
    expect(requested.isNamedByCall).toBe(true);
  });

  test("an empty list links nothing, even on a resource's page", () => {
    const requested: RequestedAffectedResources =
      AffectedResourceLinks.getRequested({
        args: { [AFFECTED_RESOURCES_ARGUMENT_NAME]: [] },
        ctx: context(HOST_PAGE),
        defaultsToPage: true,
      });

    expect(requested.refs).toEqual([]);
    expect(requested.isFromPage).toBe(false);
  });

  test("a tool that does not take the page's resource never does", () => {
    expect(
      AffectedResourceLinks.getRequested({
        args: {},
        ctx: context(HOST_PAGE),
        defaultsToPage: false,
      }).refs,
    ).toEqual([]);
  });

  test("a page about no resource asks for none", () => {
    for (const pageContext of [
      undefined,
      { type: AIChatPageContextType.IncidentsList },
      { type: AIChatPageContextType.Incident, entityId: HOST_ID },
      {
        type: AIChatPageContextType.Resource,
        resourceType: AIResourceType.ServerlessFunction,
        entityId: HOST_ID,
      },
    ] as Array<AIChatPageContext | undefined>) {
      expect(
        AffectedResourceLinks.getRequested({
          args: {},
          ctx: context(pageContext),
          defaultsToPage: true,
        }).refs,
      ).toEqual([]);
    }
  });

  test("the problems of a list it cannot read are handed on", () => {
    expect(
      AffectedResourceLinks.getRequested({
        args: {
          [AFFECTED_RESOURCES_ARGUMENT_NAME]: [
            { resourceType: "Host", resourceId: "test01" },
          ],
        },
        ctx: context(HOST_PAGE),
        defaultsToPage: true,
      }).problems,
    ).toEqual(["resourceId of a host must be its OneUptime ID (a UUID)."]);
  });
});

describe("the page's resource, written out before approval", () => {
  test("the arguments the person approves name the page's host", () => {
    expect(
      AffectedResourceLinks.withPageResourceWrittenOut({
        args: { title: "high memory usage" },
        ctx: context(HOST_PAGE),
      }),
    ).toEqual({
      title: "high memory usage",
      [AFFECTED_RESOURCES_ARGUMENT_NAME]: [
        { resourceType: "Host", resourceId: HOST_ID },
      ],
    });
  });

  test("a telemetry service's page is written as a Service", () => {
    expect(
      AffectedResourceLinks.withPageResourceWrittenOut({
        args: {},
        ctx: context({
          type: AIChatPageContextType.TelemetryService,
          entityId: SERVICE_ID,
        }),
      }),
    ).toEqual({
      [AFFECTED_RESOURCES_ARGUMENT_NAME]: [
        { resourceType: "Service", resourceId: SERVICE_ID },
      ],
    });
  });

  test("a call's own list, or a page about no resource, is left as it is", () => {
    const named: JSONObject = {
      [AFFECTED_RESOURCES_ARGUMENT_NAME]: [],
    };

    expect(
      AffectedResourceLinks.withPageResourceWrittenOut({
        args: named,
        ctx: context(HOST_PAGE),
      }),
    ).toBe(named);

    const plain: JSONObject = { title: "x" };

    expect(
      AffectedResourceLinks.withPageResourceWrittenOut({
        args: plain,
        ctx: context(),
      }),
    ).toBe(plain);
  });
});

describe("which of them are linked: each read as the person, in the project", () => {
  test("reads each kind once, in the request's project, with the person's own props", async () => {
    const ctx: ToolContext = context();
    const hosts: jest.SpyInstance = jest
      .spyOn(HostService, "findBy")
      .mockResolvedValue([
        row(Host, HOST_ID, "test01"),
        row(Host, OTHER_HOST_ID, "test02"),
      ] as never);
    const clusters: jest.SpyInstance = jest
      .spyOn(KubernetesClusterService, "findBy")
      .mockResolvedValue([row(KubernetesCluster, CLUSTER_ID, "prod")] as never);

    const result: {
      linked: Array<LinkedAffectedResource>;
      notLinked: Array<string>;
    } = await AffectedResourceLinks.resolve({
      refs: [
        { kind: AiAffectedResourceKind.KubernetesCluster, id: CLUSTER_ID },
        { kind: AiAffectedResourceKind.Host, id: HOST_ID },
        { kind: AiAffectedResourceKind.Host, id: OTHER_HOST_ID },
      ],
      ctx,
    });

    expect(hosts).toHaveBeenCalledTimes(1);
    expect(clusters).toHaveBeenCalledTimes(1);

    const hostRead: {
      query: JSONObject;
      select: JSONObject;
      props: unknown;
      limit: number;
    } = hosts.mock.calls[0]![0] as {
      query: JSONObject;
      select: JSONObject;
      props: unknown;
      limit: number;
    };

    // The person's own props: what they may not view, they cannot link.
    expect(hostRead.props).toBe(ctx.props);
    // Only the project's own: an ID of another project's host links nothing.
    expect(hostRead.query["projectId"]).toBe(PROJECT_ID);
    expect(idsInQuery(hostRead.query).sort()).toEqual(
      [HOST_ID, OTHER_HOST_ID].sort(),
    );
    expect(hostRead.select).toEqual({
      _id: true,
      name: true,
      isArchived: true,
    });
    expect(hostRead.limit).toBe(2);

    // In the order the Affected Resources card lists kinds: hosts first.
    expect(result).toEqual({
      linked: [
        linked(AiAffectedResourceKind.Host, HOST_ID, "test01"),
        linked(AiAffectedResourceKind.Host, OTHER_HOST_ID, "test02"),
        linked(AiAffectedResourceKind.KubernetesCluster, CLUSTER_ID, "prod"),
      ],
      notLinked: [],
    });
  });

  test("a network device is read through its own service, as the person, in the project", async () => {
    const ctx: ToolContext = context();
    const devices: jest.SpyInstance = jest
      .spyOn(NetworkDeviceService, "findBy")
      .mockResolvedValue([
        row(NetworkDevice, ROUTER_ID, "WAN-RTR-01"),
      ] as never);

    const result: {
      linked: Array<LinkedAffectedResource>;
      notLinked: Array<string>;
    } = await AffectedResourceLinks.resolve({
      refs: [{ kind: AiAffectedResourceKind.NetworkDevice, id: ROUTER_ID }],
      ctx,
    });

    const read: { query: JSONObject; props: unknown } = devices.mock
      .calls[0]![0] as { query: JSONObject; props: unknown };

    expect(read.props).toBe(ctx.props);
    expect(read.query["projectId"]).toBe(PROJECT_ID);
    expect(idsInQuery(read.query)).toEqual([ROUTER_ID]);
    expect(result).toEqual({
      linked: [
        linked(AiAffectedResourceKind.NetworkDevice, ROUTER_ID, "WAN-RTR-01"),
      ],
      notLinked: [],
    });
  });

  test("a kind no ID was asked for is never read", async () => {
    const hosts: jest.SpyInstance = jest
      .spyOn(HostService, "findBy")
      .mockResolvedValue([] as never);
    const clusters: jest.SpyInstance = jest.spyOn(
      KubernetesClusterService,
      "findBy",
    );

    await AffectedResourceLinks.resolve({
      refs: [{ kind: AiAffectedResourceKind.Host, id: HOST_ID }],
      ctx: context(),
    });

    expect(hosts).toHaveBeenCalledTimes(1);
    expect(clusters).not.toHaveBeenCalled();
  });

  test("one the person may not view - or of another project, or gone - is left out, saying so", async () => {
    jest.spyOn(HostService, "findBy").mockResolvedValue([] as never);

    const result: {
      linked: Array<LinkedAffectedResource>;
      notLinked: Array<string>;
    } = await AffectedResourceLinks.resolve({
      refs: [{ kind: AiAffectedResourceKind.Host, id: HOST_ID }],
      ctx: context(),
    });

    expect(result.linked).toEqual([]);
    expect(result.notLinked).toEqual([
      `No host with ID ${HOST_ID} that the current user may view exists in this project, so it was not linked.`,
    ]);
  });

  test("an archived one is left out, with what to do", async () => {
    jest
      .spyOn(HostService, "findBy")
      .mockResolvedValue([row(Host, HOST_ID, "old-box", true)] as never);

    const result: {
      linked: Array<LinkedAffectedResource>;
      notLinked: Array<string>;
    } = await AffectedResourceLinks.resolve({
      refs: [{ kind: AiAffectedResourceKind.Host, id: HOST_ID }],
      ctx: context(),
    });

    expect(result.linked).toEqual([]);
    expect(result.notLinked).toEqual([
      'host "old-box" is archived, so it was not linked. Unarchive it in OneUptime to link it.',
    ]);
  });

  test("every resource of a kind the person may not read at all is left out, and the others are still linked", async () => {
    jest
      .spyOn(HostService, "findBy")
      .mockRejectedValue(
        new NotAuthorizedException("You do not have permission to read hosts"),
      );
    jest
      .spyOn(ServiceService, "findBy")
      .mockResolvedValue([row(Service, SERVICE_ID, "checkout")] as never);

    const result: {
      linked: Array<LinkedAffectedResource>;
      notLinked: Array<string>;
    } = await AffectedResourceLinks.resolve({
      refs: [
        { kind: AiAffectedResourceKind.Host, id: HOST_ID },
        { kind: AiAffectedResourceKind.Host, id: OTHER_HOST_ID },
        { kind: AiAffectedResourceKind.Service, id: SERVICE_ID },
      ],
      ctx: context(),
    });

    expect(result.linked).toEqual([
      linked(AiAffectedResourceKind.Service, SERVICE_ID, "checkout"),
    ]);
    expect(result.notLinked).toEqual([
      "2 hosts named could not be read for the current user (they may not view hosts), so they were not linked.",
    ]);
  });

  test("a resource with no name is named by its kind", async () => {
    jest
      .spyOn(StorageArrayService, "findBy")
      .mockResolvedValue([row(StorageArray, HOST_ID, "")] as never);

    const result: {
      linked: Array<LinkedAffectedResource>;
      notLinked: Array<string>;
    } = await AffectedResourceLinks.resolve({
      refs: [{ kind: AiAffectedResourceKind.StorageArray, id: HOST_ID }],
      ctx: context(),
    });

    expect(result.linked).toEqual([
      linked(AiAffectedResourceKind.StorageArray, HOST_ID, "the storage array"),
    ]);
  });

  test("resolveForCall puts the argument's own problems first", async () => {
    jest
      .spyOn(HostService, "findBy")
      .mockResolvedValue([row(Host, HOST_ID, "test01")] as never);

    const toLink: AffectedResourcesToLink =
      await AffectedResourceLinks.resolveForCall({
        args: {
          [AFFECTED_RESOURCES_ARGUMENT_NAME]: [
            { resourceType: "Monitor", resourceId: HOST_ID },
            { resourceType: "Host", resourceId: HOST_ID },
          ],
        },
        ctx: context(),
        defaultsToPage: true,
      });

    expect(toLink.linked).toEqual([
      linked(AiAffectedResourceKind.Host, HOST_ID, "test01"),
    ]);
    expect(toLink.notLinked).toHaveLength(1);
    expect(toLink.notLinked[0]).toContain('"Monitor" cannot be linked');
    expect(toLink.isFromPage).toBe(false);
  });
});

describe("the lists written", () => {
  test("a new incident gets each resource in its kind's list", () => {
    const incident: Incident = new Incident();

    AffectedResourceLinks.setOnRecord(incident, [
      linked(AiAffectedResourceKind.Host, HOST_ID, "test01"),
      linked(AiAffectedResourceKind.Host, OTHER_HOST_ID, "test02"),
      linked(AiAffectedResourceKind.KubernetesCluster, CLUSTER_ID, "prod"),
    ]);

    expect(
      (incident.hosts || []).map((host: Host): string => {
        return host.id!.toString();
      }),
    ).toEqual([HOST_ID, OTHER_HOST_ID]);
    expect(incident.hosts![0]).toBeInstanceOf(Host);
    expect(
      (incident.kubernetesClusters || []).map(
        (cluster: KubernetesCluster): string => {
          return cluster.id!.toString();
        },
      ),
    ).toEqual([CLUSTER_ID]);
    // No list it does not name is written, not even an empty one.
    expect(incident.dockerHosts).toBeUndefined();
    expect(incident.services).toBeUndefined();
    expect(incident.monitors).toBeUndefined();
  });

  test("a network device goes in the record's network devices list", () => {
    for (const record of [new Incident(), new Alert()]) {
      AffectedResourceLinks.setOnRecord(record, [
        linked(AiAffectedResourceKind.NetworkDevice, ROUTER_ID, "WAN-RTR-01"),
      ]);

      expect(record.networkDevices![0]).toBeInstanceOf(NetworkDevice);
      expect(record.networkDevices![0]!.id!.toString()).toBe(ROUTER_ID);
      expect(record.hosts).toBeUndefined();
    }
  });

  test("an alert takes the same lists", () => {
    const alert: Alert = new Alert();

    AffectedResourceLinks.setOnRecord(alert, [
      linked(AiAffectedResourceKind.Service, SERVICE_ID, "checkout"),
    ]);

    expect(alert.services![0]!.id!.toString()).toBe(SERVICE_ID);
  });

  test("nothing linked writes no list at all", () => {
    const incident: Incident = new Incident();

    AffectedResourceLinks.setOnRecord(incident, []);

    for (const info of AI_AFFECTED_RESOURCE_KINDS) {
      expect(
        (incident as unknown as Record<string, unknown>)[info.relation],
      ).toBeUndefined();
    }
  });

  test("an existing record keeps what it lists, the new ones added after", () => {
    const result: {
      lists: Partial<Record<AiAffectedResourceRelation, Array<BaseModel>>>;
      added: Array<LinkedAffectedResource>;
      alreadyLinked: Array<LinkedAffectedResource>;
    } = AffectedResourceLinks.getListsWithAdded({
      // HELD_HOST_ID may be a host the person cannot view: it stays.
      held: { hosts: [HELD_HOST_ID.toUpperCase()] },
      linked: [linked(AiAffectedResourceKind.Host, HOST_ID, "test01")],
    });

    expect(
      (result.lists.hosts || []).map((host: BaseModel): string => {
        return host.id!.toString();
      }),
    ).toEqual([HELD_HOST_ID, HOST_ID]);
    expect(result.added).toEqual([
      linked(AiAffectedResourceKind.Host, HOST_ID, "test01"),
    ]);
    expect(result.alreadyLinked).toEqual([]);
  });

  test("one listed already is not added again, and a kind that gains nothing is not written", () => {
    const result: {
      lists: Partial<Record<AiAffectedResourceRelation, Array<BaseModel>>>;
      added: Array<LinkedAffectedResource>;
      alreadyLinked: Array<LinkedAffectedResource>;
    } = AffectedResourceLinks.getListsWithAdded({
      held: { hosts: [HOST_ID], kubernetesClusters: [] },
      linked: [
        linked(AiAffectedResourceKind.Host, HOST_ID, "test01"),
        linked(AiAffectedResourceKind.KubernetesCluster, CLUSTER_ID, "prod"),
      ],
    });

    expect(Object.keys(result.lists)).toEqual(["kubernetesClusters"]);
    expect(result.added).toEqual([
      linked(AiAffectedResourceKind.KubernetesCluster, CLUSTER_ID, "prod"),
    ]);
    expect(result.alreadyLinked).toEqual([
      linked(AiAffectedResourceKind.Host, HOST_ID, "test01"),
    ]);
  });

  test("the lists to read before adding are the kinds being added", () => {
    expect(
      AffectedResourceLinks.getRelationsOf([
        linked(AiAffectedResourceKind.Service, SERVICE_ID, "checkout"),
        linked(AiAffectedResourceKind.Host, HOST_ID, "test01"),
        linked(AiAffectedResourceKind.Host, OTHER_HOST_ID, "test02"),
      ]),
    ).toEqual(["hosts", "services"]);
  });

  test("the IDs a record holds are read from its lists, model or plain row", () => {
    const incident: Incident = new Incident();
    const host: Host = new Host();
    host.id = new ObjectID(HOST_ID);
    incident.hosts = [host];
    (incident as unknown as Record<string, unknown>)["services"] = [
      { _id: SERVICE_ID },
    ];

    expect(
      AffectedResourceLinks.readHeldIds(incident, [
        "hosts",
        "services",
        "kubernetesClusters",
      ]),
    ).toEqual({
      hosts: [HOST_ID],
      services: [SERVICE_ID],
      kubernetesClusters: [],
    });
    expect(AffectedResourceLinks.readHeldIds(null, ["hosts"])).toEqual({
      hosts: [],
    });
  });
});

describe("the words", () => {
  test("a resource is its kind and its name", () => {
    expect(
      describeLinkedResource(
        linked(AiAffectedResourceKind.Host, HOST_ID, "test01"),
      ),
    ).toBe('host "test01"');
    expect(
      describeLinkedResource(
        linked(AiAffectedResourceKind.KubernetesCluster, CLUSTER_ID, "prod"),
      ),
    ).toBe('Kubernetes cluster "prod"');
  });

  test("the approval card names what an action links", () => {
    expect(
      AffectedResourceLinks.describeForPerson({
        linked: [linked(AiAffectedResourceKind.Host, HOST_ID, "test01")],
        hasNotLinked: false,
        verb: "Linked to",
      }),
    ).toBe('Linked to host "test01".');

    expect(
      AffectedResourceLinks.describeForPerson({
        linked: [
          linked(AiAffectedResourceKind.Host, HOST_ID, "test01"),
          linked(AiAffectedResourceKind.Service, SERVICE_ID, "checkout"),
        ],
        hasNotLinked: true,
        verb: "Adds",
      }),
    ).toBe(
      'Adds host "test01", service "checkout". Some of the other resources named will not be linked.',
    );

    expect(
      AffectedResourceLinks.describeForPerson({
        linked: [],
        hasNotLinked: true,
        verb: "Linked to",
      }),
    ).toBe("The resources named will not be linked.");

    // Nothing named: no line at all.
    expect(
      AffectedResourceLinks.describeForPerson({
        linked: [],
        hasNotLinked: false,
        verb: "Linked to",
      }),
    ).toBeUndefined();
  });

  test("a name is quoted, so it can never read as part of the sentence", () => {
    expect(
      describeLinkedResource(
        linked(AiAffectedResourceKind.Host, HOST_ID, 'a" and host "b'),
      ),
    ).toBe('host "a\\" and host \\"b"');
  });

  test("the model is told what was linked, and each thing that was not and why", () => {
    expect(
      AffectedResourceLinks.describeForModel({
        linked: [linked(AiAffectedResourceKind.Host, HOST_ID, "test01")],
        notLinked: ["host x is archived."],
        verb: "Linked to",
      }),
    ).toBe('Linked to: host "test01".\nNot linked: host x is archived.');

    expect(
      AffectedResourceLinks.describeForModel({
        linked: [],
        notLinked: [],
        verb: "Linked to",
      }),
    ).toBe("");
  });

  test("the widget lists the names, kind first", () => {
    expect(
      AffectedResourceLinks.describeForWidget([
        linked(AiAffectedResourceKind.Host, HOST_ID, "test01"),
        linked(AiAffectedResourceKind.DatabaseServer, CLUSTER_ID, "pg-main"),
      ]),
    ).toBe('host "test01", database server "pg-main"');
  });

  test("a network device is named by its kind and its name", () => {
    expect(
      describeLinkedResource(
        linked(AiAffectedResourceKind.NetworkDevice, ROUTER_ID, "WAN-RTR-01"),
      ),
    ).toBe('network device "WAN-RTR-01"');
  });

  test("a network device is linked, never fixed: no agent runs on a router", () => {
    expect(
      AffectedResourceLinks.hasFixableResource([
        linked(AiAffectedResourceKind.NetworkDevice, ROUTER_ID, "WAN-RTR-01"),
      ]),
    ).toBe(false);
  });

  test("a fix acts on clusters and resources with an AI agent, not on services", () => {
    expect(
      AffectedResourceLinks.hasFixableResource([
        linked(AiAffectedResourceKind.Service, SERVICE_ID, "checkout"),
      ]),
    ).toBe(false);
    expect(
      AffectedResourceLinks.hasFixableResource([
        linked(AiAffectedResourceKind.Service, SERVICE_ID, "checkout"),
        linked(AiAffectedResourceKind.Host, HOST_ID, "test01"),
      ]),
    ).toBe(true);
  });
});

describe("the argument's schema", () => {
  test("offers exactly the kinds that can be linked, each with a resourceId", () => {
    const items: JSONObject = AFFECTED_RESOURCES_ARGUMENT_SCHEMA[
      "items"
    ] as JSONObject;
    const properties: JSONObject = items["properties"] as JSONObject;

    expect(AFFECTED_RESOURCES_ARGUMENT_SCHEMA["type"]).toBe("array");
    expect((properties["resourceType"] as JSONObject)["enum"]).toEqual(
      AI_AFFECTED_RESOURCE_KINDS.map(
        (info: AiAffectedResourceKindInfo): string => {
          return info.kind;
        },
      ),
    );
    expect(items["required"]).toEqual(["resourceType", "resourceId"]);
    // The model is told where the IDs come from.
    expect(AFFECTED_RESOURCES_ARGUMENT_SCHEMA["description"]).toContain(
      "query_telemetry_resources",
    );
  });
});
