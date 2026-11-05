/*
 * The Queue infrastructure module pulls in BullMQ (ESM-only msgpackr) at import time via the
 * services' queue imports, and nothing queue-related is under test here.
 */
jest.mock("Common/Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    default: { addJob: jest.fn() },
    QueueName: {
      Workflow: "Workflow",
      Worker: "Worker",
      Telemetry: "Telemetry",
      Runbook: "Runbook",
    },
  };
});

/*
 * PasswordHash carries a TS5.9 diagnostic that fails any suite whose require graph reaches it,
 * and nothing password-related is under test, so it is replaced with a factory.
 */
jest.mock("Common/Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: {
      hash: jest.fn(),
      verify: jest.fn(),
      generateSalt: jest.fn(),
      needsUpgrade: jest.fn(),
      applyPepper: jest.fn(),
    },
  };
});

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import GlobalCache from "Common/Server/Infrastructure/GlobalCache";
import HostService from "Common/Server/Services/HostService";
import OpenStackAcrossProducts from "Common/Server/Utils/OpenStack/OpenStackAcrossProducts";
import ObjectID from "Common/Types/ObjectID";
import { OpenStackPlacement } from "Common/Types/OpenStack/OpenStackLinks";
import OtelIngestBaseService from "../../FeatureSet/Telemetry/Services/OtelIngestBaseService";

/*
 * Host.openStackCloudId, made at ingest the way a Proxmox guest's link is: best effort, and
 * never over a value already there. What makes a match a match is OpenStackAcrossProducts'.
 */

class Ingest extends OtelIngestBaseService {
  public static link(data: {
    projectId: ObjectID;
    hostId: ObjectID;
    hostName: string;
    hostIdAttribute: string | null;
  }): Promise<void> {
    return this.tryLinkHostToOpenStack(data);
  }

  public static place(data: {
    projectId: ObjectID;
    serviceName: string | null;
    serviceNamespace: string | null;
    hostIdAttribute: string | null;
  }): Promise<void> {
    return this.tryPlaceServiceOnOpenStack(data);
  }
}

const PROJECT_ID: ObjectID = ObjectID.generate();
const HOST_ID: ObjectID = ObjectID.generate();
const CLOUD_ID: ObjectID = ObjectID.generate();
const INSTANCE_ID: string = "a1b2c3d4-0000-4000-8000-000000000001";

const PLACEMENT: OpenStackPlacement = {
  openStackCloudId: CLOUD_ID.toString(),
  cloudName: "prod",
  kind: "instance",
  externalId: INSTANCE_ID,
  name: "web-1",
  regionName: "RegionOne",
  availabilityZone: "nova",
  hypervisorName: "compute-01",
  hypervisorExternalId: "RegionOne/compute-01",
  openStackProjectId: "p1",
  openStackProjectName: null,
  status: "ACTIVE",
};

let cache: Map<string, string>;

function link(): Promise<void> {
  return Ingest.link({
    projectId: PROJECT_ID,
    hostId: HOST_ID,
    hostName: "web-1",
    hostIdAttribute: INSTANCE_ID,
  });
}

function hostHasCloud(cloud: ObjectID | null, hostId?: string): void {
  jest.spyOn(HostService, "findOneById").mockResolvedValue({
    _id: HOST_ID.toString(),
    openStackCloudId: cloud || undefined,
    hostId,
  } as never);
}

beforeEach(() => {
  cache = new Map();
  jest.spyOn(GlobalCache, "getString").mockImplementation((async (
    _namespace: string,
    key: string,
  ) => {
    return cache.get(key) || null;
  }) as never);
  jest.spyOn(GlobalCache, "setString").mockImplementation((async (
    _namespace: string,
    key: string,
    value: string,
  ) => {
    cache.set(key, value);
  }) as never);
  jest
    .spyOn(OpenStackAcrossProducts, "getPlacementOfHost")
    .mockResolvedValue(PLACEMENT as never);
  jest
    .spyOn(OpenStackAcrossProducts, "reconcilePlacementInTopology")
    .mockResolvedValue(undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a host's link to its cloud", () => {
  test("is made when exactly one part of a cloud matches", async () => {
    hostHasCloud(null);
    const findCloud: unknown = jest
      .spyOn(OpenStackAcrossProducts, "findCloudOfHost")
      .mockResolvedValue(CLOUD_ID as never);
    const update: unknown = jest
      .spyOn(HostService, "updateOneById")
      .mockResolvedValue(undefined as never);

    await link();

    expect(findCloud).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      hostIdAttribute: INSTANCE_ID,
      hostIdentifier: "web-1",
    });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: HOST_ID,
        data: { openStackCloudId: CLOUD_ID },
      }),
    );
  });

  test("a batch that doesn't say host.id is still from the host that said it before", async () => {
    hostHasCloud(null, INSTANCE_ID);
    const findCloud: unknown = jest
      .spyOn(OpenStackAcrossProducts, "findCloudOfHost")
      .mockResolvedValue(CLOUD_ID as never);
    jest
      .spyOn(HostService, "updateOneById")
      .mockResolvedValue(undefined as never);

    await Ingest.link({
      projectId: PROJECT_ID,
      hostId: HOST_ID,
      hostName: "web-1",
      hostIdAttribute: null,
    });

    expect(findCloud).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      hostIdAttribute: INSTANCE_ID,
      hostIdentifier: "web-1",
    });
  });

  test("is never written over: a cloud already there stays", async () => {
    hostHasCloud(ObjectID.generate());
    const findCloud: unknown = jest.spyOn(
      OpenStackAcrossProducts,
      "findCloudOfHost",
    );
    const update: unknown = jest.spyOn(HostService, "updateOneById");

    await link();

    expect(findCloud).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  test("is left alone when two parts match, and tried again next window", async () => {
    hostHasCloud(null);
    jest
      .spyOn(OpenStackAcrossProducts, "findCloudOfHost")
      .mockResolvedValue(null as never);
    const update: unknown = jest.spyOn(HostService, "updateOneById");

    await link();

    expect(update).not.toHaveBeenCalled();
    // No record of having tried: a miss may be an inventory not scraped yet.
    expect(cache.size).toBe(0);
  });

  test("is only worked out once a day once it stands", async () => {
    hostHasCloud(CLOUD_ID);
    const findHost: unknown = HostService.findOneById;

    await link();
    await link();

    expect(findHost).toHaveBeenCalledTimes(1);
  });

  test("tells Topology where the host's services run", async () => {
    hostHasCloud(CLOUD_ID);
    await link();
    expect(
      OpenStackAcrossProducts.reconcilePlacementInTopology,
    ).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      host: { hostIdentifier: "web-1" },
      placement: PLACEMENT,
    });
  });

  test("tells Topology again every window, or a short time range would lose it", async () => {
    hostHasCloud(CLOUD_ID);

    await link();
    await link();
    await link();

    expect(
      OpenStackAcrossProducts.reconcilePlacementInTopology,
    ).toHaveBeenCalledTimes(3);
  });

  test("says nothing to Topology about a host that isn't part of a cloud", async () => {
    hostHasCloud(null);
    jest
      .spyOn(OpenStackAcrossProducts, "findCloudOfHost")
      .mockResolvedValue(null as never);

    await link();

    expect(OpenStackAcrossProducts.getPlacementOfHost).not.toHaveBeenCalled();
    expect(
      OpenStackAcrossProducts.reconcilePlacementInTopology,
    ).not.toHaveBeenCalled();
  });

  test("never gets in the way of discovering the host", async () => {
    jest
      .spyOn(HostService, "findOneById")
      .mockRejectedValue(new Error("database is gone") as never);
    await expect(link()).resolves.toBeUndefined();
  });
});

type PlacementFields = {
  serviceName?: string | null;
  hostIdAttribute?: string | null;
};

describe("a service whose own telemetry names its instance", () => {
  function place(fields?: PlacementFields): Promise<void> {
    return Ingest.place({
      projectId: PROJECT_ID,
      serviceName: "api",
      serviceNamespace: "shop",
      hostIdAttribute: INSTANCE_ID,
      ...fields,
    });
  }

  function reconcile(): unknown {
    return jest
      .spyOn(OpenStackAcrossProducts, "reconcileServiceOnInstance")
      .mockResolvedValue(undefined as never);
  }

  test("is told to Topology, with the namespace that is part of who it is", async () => {
    jest
      .spyOn(GlobalCache, "setStringIfNotExists")
      .mockResolvedValue(true as never);
    const told: unknown = reconcile();
    await place();
    expect(told).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      instanceId: INSTANCE_ID,
      serviceName: "api",
      serviceNamespace: "shop",
    });
  });

  test("is told once a window, however many batches say it", async () => {
    jest
      .spyOn(GlobalCache, "setStringIfNotExists")
      .mockResolvedValue(false as never);
    const told: unknown = reconcile();
    await place({ serviceName: "fenced" });
    expect(told).not.toHaveBeenCalled();
  });

  test.each([
    [
      "a host.id that is a machine-id",
      { hostIdAttribute: "0123456789abcdef0123456789abcdef" },
    ],
    ["no host.id", { hostIdAttribute: null }],
    ["no service", { serviceName: null }],
  ])(
    "%s costs nothing, not even a fence",
    async (_name: string, fields: PlacementFields) => {
      const fence: unknown = jest.spyOn(GlobalCache, "setStringIfNotExists");
      const told: unknown = reconcile();
      await place(fields);
      expect(fence).not.toHaveBeenCalled();
      expect(told).not.toHaveBeenCalled();
    },
  );

  test("never gets in the way of ingest", async () => {
    jest
      .spyOn(GlobalCache, "setStringIfNotExists")
      .mockResolvedValue(true as never);
    jest
      .spyOn(OpenStackAcrossProducts, "reconcileServiceOnInstance")
      .mockRejectedValue(new Error("database is gone") as never);
    await expect(place({ serviceName: "fails" })).resolves.toBeUndefined();
  });
});
