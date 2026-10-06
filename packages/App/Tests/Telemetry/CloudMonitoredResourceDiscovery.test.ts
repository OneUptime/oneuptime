/*
 * Same module replacements as the other ingest-base suites in this
 * directory (OtelIngestMaintenanceFenceRelease, OtelIngestEntityIdL1Memo):
 * the Queue module pulls in BullMQ, and PasswordHash carries a pre-existing
 * TS diagnostic; neither is under test.
 */
jest.mock("Common/Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    default: {
      addJob: jest.fn(),
    },
    QueueName: {
      Workflow: "Workflow",
      Worker: "Worker",
      Telemetry: "Telemetry",
      Runbook: "Runbook",
    },
  };
});

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

import OtelIngestBaseService from "../../FeatureSet/Telemetry/Services/OtelIngestBaseService";
import GlobalCache from "Common/Server/Infrastructure/GlobalCache";
import CloudResourceService from "Common/Server/Services/CloudResourceService";
import logger from "Common/Server/Utils/Logger";
import ObjectID from "Common/Types/ObjectID";
import {
  CloudMonitoredResource,
  buildCloudMonitoredResourceIdentifier,
  resolveCloudMonitoredResource,
} from "Common/Types/Cloud/CloudMonitoredResource";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * OtelIngestBaseService.autoDiscoverCloudMonitoredResources: the distinct
 * cloud resources one request's metric rows named, each found or created as
 * a Cloud Resource and sighted. It is held to the two rules every other
 * autoDiscover* method is held to - in suites whose harness passes one
 * resource's attributes, which this method does not take, hence a suite of
 * its own:
 *
 *   - the row id resolves through the L1 memo and Redis; only a miss reaches
 *     Postgres (OtelIngestEntityIdL1Memo's rule);
 *   - the sighting runs behind the maintenance fence, which is released when
 *     the sighting fails and kept when it succeeds, and a fence another
 *     worker holds is never released (OtelIngestMaintenanceFenceRelease's
 *     rule).
 *
 * And to its own: at most CLOUD_MONITORED_RESOURCE_MAX_LOOKUPS_PER_REQUEST
 * Postgres lookups per request, a resource that cannot be resolved (a
 * project at its budget) is not looked up again for a minute, and no
 * failure ever reaches the request.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const ROW_ID: string = "55555555-5555-4555-8555-555555555555";
const FENCE_NAMESPACE: string = "otel-maintenance-fence";
const ID_NAMESPACE: string = "cloud-monitored-resource-id";
const SUBSCRIPTION: string = "7c4a1f2e-9d3b-4e5f-8a6b-1c2d3e4f5a6b";

/* eslint-disable @typescript-eslint/no-explicit-any */
const baseService: Record<string, any> =
  OtelIngestBaseService as unknown as Record<string, any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

function vm(name: string): CloudMonitoredResource {
  const resource: CloudMonitoredResource | null =
    resolveCloudMonitoredResource({
      metricName: "azure_percentage_cpu_average",
      attributes: {
        "resource.azuremonitor.subscription_id": SUBSCRIPTION,
        "azuremonitor.resource_id": `/subscriptions/${SUBSCRIPTION}/resourceGroups/rg/providers/Microsoft.Compute/virtualMachines/${name}`,
        name: name,
        location: "westeurope",
      },
    });
  if (!resource) {
    throw new Error("fixture did not resolve");
  }
  return resource;
}

function cacheKeyOf(resource: CloudMonitoredResource): string {
  return `${PROJECT_ID.toString()}:${buildCloudMonitoredResourceIdentifier(resource)}`;
}

let fakeRedis: Map<string, string>;
let heldFences: Set<string>;
let deletedKeys: Array<string>;
let findOrCreate: jest.SpyInstance;
let sighting: jest.SpyInstance;

async function discover(
  resources: Array<CloudMonitoredResource>,
): Promise<number> {
  return (await baseService["autoDiscoverCloudMonitoredResources"]({
    projectId: PROJECT_ID,
    resources: resources,
  })) as number;
}

function idGets(): number {
  return (GlobalCache.getString as jest.Mock).mock.calls.filter(
    (call: Array<unknown>) => {
      return call[0] === ID_NAMESPACE;
    },
  ).length;
}

beforeEach(() => {
  fakeRedis = new Map<string, string>();
  heldFences = new Set<string>();
  deletedKeys = [];
  OtelIngestBaseService.clearInProcessMemos();

  jest
    .spyOn(GlobalCache, "getString")
    .mockImplementation(async (namespace: string, key: string) => {
      return fakeRedis.get(`${namespace}:${key}`) ?? null;
    });
  jest
    .spyOn(GlobalCache, "setString")
    .mockImplementation(async (namespace: string, key: string, value: string) => {
      fakeRedis.set(`${namespace}:${key}`, value);
    });
  jest
    .spyOn(GlobalCache, "setStringIfNotExists")
    .mockImplementation(async (namespace: string, key: string) => {
      if (namespace !== FENCE_NAMESPACE) {
        return true;
      }
      if (heldFences.has(key)) {
        return false;
      }
      heldFences.add(key);
      return true;
    });
  jest
    .spyOn(GlobalCache, "deleteKey")
    .mockImplementation(async (namespace: string, key: string) => {
      deletedKeys.push(`${namespace}:${key}`);
    });

  findOrCreate = jest
    .spyOn(CloudResourceService, "findOrCreateMonitoredResource")
    .mockImplementation(async () => {
      return {
        cloudResource: { _id: ROW_ID } as never,
        created: true,
      };
    });
  sighting = jest
    .spyOn(CloudResourceService, "recordMonitoredResourceSighting")
    .mockResolvedValue(undefined);
  jest.spyOn(logger, "error").mockImplementation(() => {
    return undefined;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
  OtelIngestBaseService.clearInProcessMemos();
});

describe("finding the row", () => {
  test("a new resource: one Redis GET, one find-or-create, the id cached, then sighted", async () => {
    const resource: CloudMonitoredResource = vm("vm-1");

    await expect(discover([resource])).resolves.toBe(1);

    expect(idGets()).toBe(1);
    expect(findOrCreate).toHaveBeenCalledTimes(1);
    expect(findOrCreate).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      resource: resource,
    });
    expect(fakeRedis.get(`${ID_NAMESPACE}:${cacheKeyOf(resource)}`)).toBe(
      ROW_ID,
    );
    expect(sighting).toHaveBeenCalledTimes(1);
    expect(
      (sighting.mock.calls[0]![0] as { cloudResourceId: ObjectID })
        .cloudResourceId.toString(),
    ).toBe(ROW_ID);
  });

  test("the steady state costs no Redis GET and no Postgres lookup", async () => {
    const resource: CloudMonitoredResource = vm("vm-1");
    await discover([resource]);
    const gets: number = idGets();

    await discover([resource]);
    await discover([resource]);

    expect(idGets()).toBe(gets);
    expect(findOrCreate).toHaveBeenCalledTimes(1);
  });

  test("a resource another pod resolved costs one Redis GET and no Postgres lookup", async () => {
    const resource: CloudMonitoredResource = vm("vm-1");
    fakeRedis.set(`${ID_NAMESPACE}:${cacheKeyOf(resource)}`, ROW_ID);

    await discover([resource]);

    expect(idGets()).toBe(1);
    expect(findOrCreate).not.toHaveBeenCalled();
    expect(sighting).toHaveBeenCalledTimes(1);
  });

  test("looks up at most CLOUD_MONITORED_RESOURCE_MAX_LOOKUPS_PER_REQUEST new resources per request", async () => {
    const cap: number =
      OtelIngestBaseService.CLOUD_MONITORED_RESOURCE_MAX_LOOKUPS_PER_REQUEST;
    const resources: Array<CloudMonitoredResource> = [];
    for (let index: number = 0; index < cap + 25; index++) {
      resources.push(vm(`vm-${index}`));
    }

    await expect(discover(resources)).resolves.toBe(cap);
    expect(findOrCreate).toHaveBeenCalledTimes(cap);

    // The next request picks up the rest.
    await discover(resources);
    expect(findOrCreate).toHaveBeenCalledTimes(cap + 25);
  });

  test("a resource that cannot be resolved (a project at its budget) is not looked up again for a minute", async () => {
    findOrCreate.mockResolvedValue({ cloudResource: null, created: false });
    const resource: CloudMonitoredResource = vm("vm-1");

    await expect(discover([resource])).resolves.toBe(0);
    await discover([resource]);

    expect(findOrCreate).toHaveBeenCalledTimes(1);
    expect(sighting).not.toHaveBeenCalled();
    expect(fakeRedis.size).toBe(0);
  });
});

describe("the sighting's maintenance fence", () => {
  test("is armed per resource and kept when the sighting succeeds", async () => {
    await discover([vm("vm-1")]);

    expect(heldFences.has(`cloud-monitored-resource:${ROW_ID}`)).toBe(true);
    expect(deletedKeys).toEqual([]);
  });

  test("holds the next request's sighting off inside its window", async () => {
    await discover([vm("vm-1")]);
    await discover([vm("vm-1")]);

    expect(sighting).toHaveBeenCalledTimes(1);
  });

  test("is released when the sighting fails, and the failure never reaches the request", async () => {
    sighting.mockRejectedValue(new Error("Postgres said no"));

    await expect(discover([vm("vm-1")])).resolves.toBe(1);

    expect(deletedKeys).toContain(
      `${FENCE_NAMESPACE}:cloud-monitored-resource:${ROW_ID}`,
    );
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect((logger.error as unknown as jest.Mock).mock.calls[0]![0]).toContain(
      "Postgres said no",
    );
  });

  test("a fence another worker holds is never released", async () => {
    heldFences.add(`cloud-monitored-resource:${ROW_ID}`);
    sighting.mockRejectedValue(new Error("Postgres said no"));

    await discover([vm("vm-1")]);

    expect(sighting).not.toHaveBeenCalled();
    expect(deletedKeys).toEqual([]);
  });
});

describe("failures", () => {
  test("a failing lookup costs that resource its turn, not the others", async () => {
    findOrCreate.mockImplementation(
      async (data: { resource: CloudMonitoredResource }) => {
        if (data.resource.name === "vm-2") {
          throw new Error("connection reset");
        }
        return { cloudResource: { _id: ROW_ID } as never, created: true };
      },
    );

    await expect(discover([vm("vm-1"), vm("vm-2"), vm("vm-3")])).resolves.toBe(
      2,
    );
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect((logger.error as unknown as jest.Mock).mock.calls[0]![0]).toContain(
      "1 of 3 resource(s)",
    );
  });

  test("a Redis outage is a failure per resource, logged once for the request", async () => {
    jest
      .spyOn(GlobalCache, "getString")
      .mockRejectedValue(new Error("redis down"));

    await expect(discover([vm("vm-1"), vm("vm-2")])).resolves.toBe(0);
    expect(findOrCreate).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  test("nothing to discover is free", async () => {
    await expect(discover([])).resolves.toBe(0);
    expect(GlobalCache.getString).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });
});
