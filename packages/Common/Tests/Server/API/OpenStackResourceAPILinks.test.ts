import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import Host from "../../../Models/DatabaseModels/Host";
import OpenStackResourceAPI from "../../../Server/API/OpenStackResourceAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import CephClusterService from "../../../Server/Services/CephClusterService";
import HostService from "../../../Server/Services/HostService";
import KubernetesClusterService from "../../../Server/Services/KubernetesClusterService";
import OpenStackCloudService from "../../../Server/Services/OpenStackCloudService";
import ServiceService from "../../../Server/Services/ServiceService";
import ModelPermission from "../../../Server/Types/Database/Permissions/Index";
import OpenStackAcrossProducts from "../../../Server/Utils/OpenStack/OpenStackAcrossProducts";
import Response from "../../../Server/Utils/Response";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  OPENSTACK_CEPH_STATUS_FACT,
  OpenStackPlacement,
  OpenStackReachAcrossProducts,
} from "../../../Types/OpenStack/OpenStackLinks";

/*
 * The doors in front of the joins. A join is worked out across the whole project, because a link
 * made on a guess is what it exists to refuse, so what it may say is decided here, as the caller:
 * someone who can read a cloud sees of another product only what that product would show them.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const CLOUD_ID: ObjectID = ObjectID.generate();
const HOST_ID: ObjectID = ObjectID.generate();
const PROPS: JSONObject = { userId: "someone" };

interface LinksApi {
  getHostOfMachine: (req: unknown, res: unknown) => Promise<void>;
  getPlacementOfHost: (req: unknown, res: unknown) => Promise<void>;
  getReachOfInstance: (req: unknown, res: unknown) => Promise<void>;
  getStoragePoolCeph: (req: unknown, res: unknown) => Promise<void>;
  confirmStoragePoolCeph: (req: unknown, res: unknown) => Promise<void>;
  keepCephStatusCallerMayRead: (data: {
    rows: Array<JSONObject>;
    props: unknown;
  }) => Promise<void>;
  resolveCloudForRequest: () => Promise<unknown>;
}

function api(): LinksApi {
  // Not constructed: its constructor registers routes, and these call one handler.
  const links: LinksApi = Object.create(
    OpenStackResourceAPI.prototype,
  ) as LinksApi;
  links.resolveCloudForRequest = async (): Promise<unknown> => {
    return { projectId: PROJECT_ID, openStackCloudId: CLOUD_ID };
  };
  return links;
}

function hostOf(fields: Partial<Host> = {}): Host {
  return Object.assign(new Host(), {
    _id: HOST_ID.toString(),
    name: "compute-01",
    hostIdentifier: "compute-01",
    ...fields,
  });
}

const PLACEMENT: OpenStackPlacement = {
  openStackCloudId: CLOUD_ID.toString(),
  cloudName: "prod",
  kind: "instance",
  externalId: "a1b2c3d4-0000-4000-8000-000000000001",
  name: "web-1",
  regionName: "RegionOne",
  availabilityZone: "nova",
  hypervisorName: "compute-01",
  hypervisorExternalId: "RegionOne/compute-01",
  openStackProjectId: "p1",
  openStackProjectName: null,
  status: "ACTIVE",
};

let sent: Array<JSONObject>;

beforeEach(() => {
  sent = [];
  jest.spyOn(Response, "sendJsonObjectResponse").mockImplementation(((
    _req: unknown,
    _res: unknown,
    body: JSONObject,
  ) => {
    sent.push(body);
  }) as never);
  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockResolvedValue(PROPS as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function idsReadBy(
  service: { findBy: unknown },
  ids: Array<string>,
): jest.SpiedFunction<() => Promise<unknown>> {
  return jest.spyOn(service as never, "findBy" as never).mockResolvedValue(
    ids.map((id: string) => {
      return { id: new ObjectID(id) };
    }) as never,
  ) as never;
}

describe("the host that is a machine", () => {
  const request: JSONObject = {
    params: { resourceId: PROJECT_ID.toString() },
    body: { machineName: "compute-01" },
  };

  test("is said to someone who can read it", async () => {
    jest
      .spyOn(OpenStackAcrossProducts, "getHostOfMachine")
      .mockResolvedValue(hostOf() as never);
    const read: unknown = jest
      .spyOn(HostService, "findOneById")
      .mockResolvedValue(hostOf() as never);

    await api().getHostOfMachine(request, {});

    expect(sent[0]!["host"]).toEqual({
      _id: HOST_ID.toString(),
      name: "compute-01",
      hostIdentifier: "compute-01",
    });
    // Read as the caller, and not as the join that found it.
    expect(read).toHaveBeenCalledWith(
      expect.objectContaining({ id: HOST_ID, props: PROPS }),
    );
  });

  test("is no answer at all to someone who can't", async () => {
    jest
      .spyOn(OpenStackAcrossProducts, "getHostOfMachine")
      .mockResolvedValue(hostOf() as never);
    jest
      .spyOn(HostService, "findOneById")
      .mockRejectedValue(new NotAuthorizedException("No") as never);

    await api().getHostOfMachine(request, {});

    expect(sent[0]).toEqual({ host: null });
  });

  test("is none when the join found none, and reads nothing else", async () => {
    jest
      .spyOn(OpenStackAcrossProducts, "getHostOfMachine")
      .mockResolvedValue(null as never);
    const read: unknown = jest.spyOn(HostService, "findOneById");

    await api().getHostOfMachine(request, {});

    expect(sent[0]).toEqual({ host: null });
    expect(read).not.toHaveBeenCalled();
  });

  test.each<[string, JSONObject]>([
    [
      "a project that isn't an ID",
      { params: { resourceId: "x" }, body: { machineName: "compute-01" } },
    ],
    ["no machine", { params: { resourceId: PROJECT_ID.toString() }, body: {} }],
  ])("%s is refused before anything is read", async (_name: string, req: JSONObject) => {
    const join: unknown = jest.spyOn(
      OpenStackAcrossProducts,
      "getHostOfMachine",
    );
    await expect(api().getHostOfMachine(req, {})).rejects.toThrow(
      BadDataException,
    );
    expect(join).not.toHaveBeenCalled();
  });
});

describe("where a host sits in a cloud", () => {
  const request: JSONObject = { params: { resourceId: HOST_ID.toString() } };

  beforeEach(() => {
    jest
      .spyOn(HostService, "findOneById")
      .mockResolvedValue(hostOf({ projectId: PROJECT_ID }) as never);
    jest
      .spyOn(OpenStackAcrossProducts, "getPlacementOfHost")
      .mockResolvedValue(PLACEMENT as never);
  });

  test("is said to someone who can read the cloud", async () => {
    jest
      .spyOn(OpenStackCloudService, "findOneById")
      .mockResolvedValue({ _id: CLOUD_ID.toString() } as never);
    await api().getPlacementOfHost(request, {});
    expect(sent[0]!["placement"]).toEqual(PLACEMENT);
  });

  test("reads as a host on no cloud to someone who can only read the host", async () => {
    jest
      .spyOn(OpenStackCloudService, "findOneById")
      .mockRejectedValue(new NotAuthorizedException("No") as never);
    await api().getPlacementOfHost(request, {});
    expect(sent[0]).toEqual({ placement: null });
  });

  test("a host the caller can't read is not found, whatever it is", async () => {
    jest.spyOn(HostService, "findOneById").mockResolvedValue(null as never);
    const join: unknown = OpenStackAcrossProducts.getPlacementOfHost;
    await expect(api().getPlacementOfHost(request, {})).rejects.toThrow(
      NotFoundException,
    );
    expect(join).not.toHaveBeenCalled();
  });
});

describe("what an instance reaches", () => {
  const SEEN_HOST: string = ObjectID.generate().toString();
  const HIDDEN_HOST: string = ObjectID.generate().toString();
  const SEEN_SERVICE: string = ObjectID.generate().toString();
  const HIDDEN_SERVICE: string = ObjectID.generate().toString();
  const SEEN_CLUSTER: string = ObjectID.generate().toString();
  const HIDDEN_CLUSTER: string = ObjectID.generate().toString();

  const REACH: OpenStackReachAcrossProducts = {
    hostCount: 2,
    hosts: [
      { id: SEEN_HOST, name: "seen", isHypervisor: false },
      { id: HIDDEN_HOST, name: "hidden", isHypervisor: false },
    ],
    kubernetesNodeCount: 3,
    kubernetesNodes: [
      {
        clusterId: SEEN_CLUSTER,
        clusterName: "seen",
        nodeName: "node-1",
        instanceId: PLACEMENT.externalId,
      },
      {
        clusterId: HIDDEN_CLUSTER,
        clusterName: "hidden",
        nodeName: "node-2",
        instanceId: PLACEMENT.externalId,
      },
    ],
    kubernetesClusters: [
      { id: SEEN_CLUSTER, name: "seen", nodeCount: 1 },
      { id: HIDDEN_CLUSTER, name: "hidden", nodeCount: 2 },
    ],
    serviceCount: 2,
    services: [
      { id: SEEN_SERVICE, name: "seen" },
      { id: HIDDEN_SERVICE, name: "hidden" },
    ],
  };

  beforeEach(() => {
    jest
      .spyOn(OpenStackAcrossProducts, "getReachOfInstance")
      .mockResolvedValue(REACH as never);
  });

  test("is only what each product would show the caller, and is counted that way", async () => {
    idsReadBy(HostService, [SEEN_HOST]);
    idsReadBy(ServiceService, [SEEN_SERVICE]);
    idsReadBy(KubernetesClusterService, [SEEN_CLUSTER]);

    await api().getReachOfInstance(
      { params: {}, body: { instanceId: PLACEMENT.externalId } },
      {},
    );

    expect(sent[0]).toEqual({
      hostCount: 1,
      hosts: [REACH.hosts[0]],
      kubernetesNodeCount: 1,
      kubernetesNodes: [REACH.kubernetesNodes[0]],
      kubernetesClusters: [REACH.kubernetesClusters[0]],
      serviceCount: 1,
      services: [REACH.services[0]],
    });
  });

  test("a product the caller can't read at all is left out, and the card still answers", async () => {
    jest
      .spyOn(HostService, "findBy")
      .mockRejectedValue(new NotAuthorizedException("No") as never);
    jest
      .spyOn(ServiceService, "findBy")
      .mockRejectedValue(new NotAuthorizedException("No") as never);
    jest
      .spyOn(KubernetesClusterService, "findBy")
      .mockRejectedValue(new NotAuthorizedException("No") as never);

    await api().getReachOfInstance(
      { params: {}, body: { instanceId: PLACEMENT.externalId } },
      {},
    );

    expect(sent[0]).toEqual({
      hostCount: 0,
      hosts: [],
      kubernetesNodeCount: 0,
      kubernetesNodes: [],
      kubernetesClusters: [],
      serviceCount: 0,
      services: [],
    });
  });
});

describe("a pool and Ceph", () => {
  const SEEN: string = ObjectID.generate().toString();
  const HIDDEN: string = ObjectID.generate().toString();

  function poolLinkedTo(clusterId: string): void {
    jest
      .spyOn(OpenStackAcrossProducts, "getStoragePoolCephLink")
      .mockResolvedValue({
        link: {
          state: "confirmed",
          clusterId,
          clusterName: clusterId === SEEN ? "seen" : "hidden",
          cephPoolName: "volumes",
        },
        clusters: [
          { id: SEEN, name: "seen" },
          { id: HIDDEN, name: "hidden" },
        ],
        health: 2,
        capacityUsedPercent: 91,
      } as never);
  }

  const request: JSONObject = {
    params: {},
    body: { externalId: "RegionOne/rbd-pool" },
  };

  test("a cluster the caller can read is named, with its health", async () => {
    poolLinkedTo(SEEN);
    idsReadBy(CephClusterService, [SEEN]);
    await api().getStoragePoolCeph(request, {});
    expect(sent[0]).toEqual({
      link: {
        state: "confirmed",
        clusterId: SEEN,
        clusterName: "seen",
        cephPoolName: "volumes",
      },
      clusters: [{ id: SEEN, name: "seen" }],
      health: 2,
      capacityUsedPercent: 91,
    });
  });

  test("a cluster the caller can't read is neither named nor described", async () => {
    poolLinkedTo(HIDDEN);
    idsReadBy(CephClusterService, [SEEN]);
    await api().getStoragePoolCeph(request, {});
    expect(sent[0]).toEqual({
      link: {
        state: "unknown",
        clusterId: null,
        clusterName: null,
        cephPoolName: null,
      },
      clusters: [{ id: SEEN, name: "seen" }],
      health: null,
      capacityUsedPercent: null,
    });
  });

  test("someone who can read no Ceph at all reads as there being none", async () => {
    poolLinkedTo(HIDDEN);
    jest
      .spyOn(CephClusterService, "findBy")
      .mockRejectedValue(new NotAuthorizedException("No") as never);
    await api().getStoragePoolCeph(request, {});
    expect((sent[0]!["link"] as JSONObject)["state"]).toBe("no-clusters");
    expect(sent[0]!["clusters"]).toEqual([]);
  });

  test("a pool not in this cloud is not found", async () => {
    jest
      .spyOn(OpenStackAcrossProducts, "getStoragePoolCephLink")
      .mockResolvedValue(null as never);
    await expect(api().getStoragePoolCeph(request, {})).rejects.toThrow(
      NotFoundException,
    );
  });

  test("Needs attention only names the trouble of a cluster the caller can read", async () => {
    idsReadBy(CephClusterService, [SEEN]);
    const seen: JSONObject = {
      kind: "StoragePool",
      facts: {
        cephFsid: "kept",
        [OPENSTACK_CEPH_STATUS_FACT]: {
          clusterId: SEEN,
          clusterName: "seen",
          healthStatus: 2,
        },
      },
    };
    const hidden: JSONObject = {
      kind: "StoragePool",
      facts: {
        cephFsid: "kept",
        [OPENSTACK_CEPH_STATUS_FACT]: {
          clusterId: HIDDEN,
          clusterName: "hidden",
          healthStatus: 2,
        },
      },
    };
    await api().keepCephStatusCallerMayRead({
      rows: [seen, hidden, { kind: "Instance" }],
      props: PROPS,
    });
    expect(
      (seen["facts"] as JSONObject)[OPENSTACK_CEPH_STATUS_FACT],
    ).toBeTruthy();
    expect(hidden["facts"]).toEqual({ cephFsid: "kept" });
  });

  test("saying what a pool is on takes the permission to change the cloud", async () => {
    jest
      .spyOn(ModelPermission, "checkUpdateQueryPermissions")
      .mockRejectedValue(new NotAuthorizedException("No") as never);
    const confirm: unknown = jest.spyOn(
      OpenStackAcrossProducts,
      "confirmStoragePoolCephLink",
    );
    await expect(
      api().confirmStoragePoolCeph(
        { params: {}, body: { externalId: "p", isNotCeph: true } },
        {},
      ),
    ).rejects.toThrow(NotAuthorizedException);
    expect(confirm).not.toHaveBeenCalled();
  });

  test.each<[string, JSONObject]>([
    ["no answer", { externalId: "p" }],
    ["a cluster that isn't an ID", { externalId: "p", cephClusterId: "x" }],
  ])("%s is refused before anything is written", async (_name: string, body: JSONObject) => {
    jest
      .spyOn(ModelPermission, "checkUpdateQueryPermissions")
      .mockResolvedValue(undefined as never);
    const confirm: unknown = jest.spyOn(
      OpenStackAcrossProducts,
      "confirmStoragePoolCephLink",
    );
    await expect(
      api().confirmStoragePoolCeph({ params: {}, body }, {}),
    ).rejects.toThrow(BadDataException);
    expect(confirm).not.toHaveBeenCalled();
  });

  test("a cluster in another project is not found, and nothing is said about why", async () => {
    jest
      .spyOn(ModelPermission, "checkUpdateQueryPermissions")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(OpenStackAcrossProducts, "confirmStoragePoolCephLink")
      .mockResolvedValue(false as never);
    await expect(
      api().confirmStoragePoolCeph(
        {
          params: {},
          body: { externalId: "p", cephClusterId: SEEN },
        },
        {},
      ),
    ).rejects.toThrow(NotFoundException);
  });
});
