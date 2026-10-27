/*
 * The Queue infrastructure module pulls in BullMQ (ESM-only msgpackr) at
 * import time via the services' queue imports; nothing queue-related is
 * under test here, so the module is replaced — same idiom as
 * OtelIngestMaintenanceFenceRelease.test.ts in this directory.
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

/*
 * PasswordHash carries a pre-existing TS5.9 diagnostic that fails any suite
 * whose runtime require graph reaches it (DatabaseService, the base class
 * of every concrete service, imports it). Nothing password-related is under
 * test here, so the module is replaced WITH A FACTORY — an automock would
 * still require (and type-check) the real file.
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

import OtelIngestBaseService from "../../FeatureSet/Telemetry/Services/OtelIngestBaseService";
import GlobalCache from "Common/Server/Infrastructure/GlobalCache";
import logger from "Common/Server/Utils/Logger";
import Telemetry from "Common/Server/Utils/Telemetry";
import {
  CloudMonitoredResource,
  resolveCloudMonitoredResource,
} from "Common/Types/Cloud/CloudMonitoredResource";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  SpanStatusCode,
  clearExportedSpans,
  getExportedSpanNames,
  getExportedSpans,
  inRequestSpan,
  startExportingSpans,
  stopExportingSpans,
} from "Common/Tests/Helpers/ExportedSpans";
/*
 * `jest` is the ambient global, as in OtelIngestMaintenanceFenceRelease:
 * App pins @types/jest 29 against jest 28, and the two spell a spy
 * differently.
 */
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";

/*
 * AN autoDiscover* METHOD IS TRACED ONLY FOR THE BLOCKS IT DISCOVERS.
 *
 * Ingest asks every autoDiscover* method about every resource block, and
 * most blocks carry nothing a given method discovers: no k8s.cluster.name,
 * no managed cloud.platform, no browser.* or device.*. Each method used to
 * open a span all the same, and ~99.7% of the CloudResource, Rum and
 * Serverless spans in sampled telemetry job traces ended in under 50 µs -
 * about 25 spans of a ~120-span job. Now the check runs before any span,
 * and only a block it matches enters the discovery, whose span keeps the
 * method's name.
 *
 * Every resource id cache is primed and every maintenance fence is held by
 * another worker, so a matched discovery resolves its row without Postgres
 * and stops there.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const RESOURCE_ID: string = "55555555-5555-4555-8555-555555555555";
const FENCE_NAMESPACE: string = "otel-maintenance-fence";
const SUBSCRIPTION: string = "7c4a1f2e-9d3b-4e5f-8a6b-1c2d3e4f5a6b";

/* eslint-disable @typescript-eslint/no-explicit-any */
const baseService: Record<string, any> =
  OtelIngestBaseService as unknown as Record<string, any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

function stringAttribute(key: string, value: string): JSONObject {
  return { key: key, value: { stringValue: value } };
}

function spanOf(method: string): string {
  return `OtelIngestBaseService.${method}`;
}

// An application's block: nothing any autoDiscover* method discovers.
const APPLICATION_BLOCK: JSONArray = [
  stringAttribute("service.name", "checkout"),
  stringAttribute("telemetry.sdk.language", "nodejs"),
];

type DiscoveryCase = {
  method: string;
  // Resource attributes that carry what the method discovers.
  attributes: JSONArray;
};

const DISCOVERY_CASES: Array<DiscoveryCase> = [
  {
    method: "autoDiscoverKubernetesCluster",
    attributes: [stringAttribute("k8s.cluster.name", "prod-eu")],
  },
  {
    method: "autoDiscoverProxmoxCluster",
    attributes: [stringAttribute("proxmox.cluster.name", "pve-1")],
  },
  {
    method: "autoDiscoverVMwareVCenter",
    attributes: [stringAttribute("vmware.vcenter.name", "vcsa-prod")],
  },
  {
    method: "autoDiscoverIoTFleet",
    attributes: [stringAttribute("iot.fleet.name", "sensors-eu")],
  },
  {
    method: "autoDiscoverDockerSwarmCluster",
    attributes: [stringAttribute("docker.swarm.cluster.name", "swarm-1")],
  },
  {
    method: "autoDiscoverCephCluster",
    attributes: [stringAttribute("ceph.cluster.name", "ceph-1")],
  },
  {
    method: "autoDiscoverStorageArray",
    attributes: [stringAttribute("storage.array.name", "pure-prod-01")],
  },
  {
    method: "autoDiscoverServerless",
    attributes: [stringAttribute("faas.name", "checkout-handler")],
  },
  {
    method: "autoDiscoverCloudResource",
    attributes: [
      stringAttribute("cloud.platform", "aws_ecs"),
      stringAttribute("service.name", "checkout"),
    ],
  },
  {
    method: "autoDiscoverDatabaseServer",
    attributes: [
      stringAttribute("db.system.name", "postgresql"),
      stringAttribute("server.address", "orders-db.example.com"),
    ],
  },
  {
    method: "autoDiscoverRum",
    attributes: [
      stringAttribute("browser.platform", "macOS"),
      stringAttribute("service.name", "storefront"),
    ],
  },
  {
    method: "autoDiscoverDockerHost",
    attributes: [
      stringAttribute("container.runtime", "docker"),
      stringAttribute("host.name", "docker-host-1"),
    ],
  },
  {
    method: "autoDiscoverPodmanHost",
    attributes: [
      stringAttribute("container.runtime", "podman"),
      stringAttribute("host.name", "podman-host-1"),
    ],
  },
  {
    method: "autoDiscoverHost",
    attributes: [
      stringAttribute("host.name", "vm-1"),
      stringAttribute("os.type", "linux"),
    ],
  },
];

function monitoredVm(name: string): CloudMonitoredResource {
  const resource: CloudMonitoredResource | null = resolveCloudMonitoredResource(
    {
      metricName: "azure_percentage_cpu_average",
      attributes: {
        "resource.azuremonitor.subscription_id": SUBSCRIPTION,
        "azuremonitor.resource_id": `/subscriptions/${SUBSCRIPTION}/resourceGroups/rg/providers/Microsoft.Compute/virtualMachines/${name}`,
        name: name,
        location: "westeurope",
      },
    },
  );
  if (!resource) {
    throw new Error("fixture did not resolve");
  }
  return resource;
}

beforeAll(() => {
  startExportingSpans();
});

afterAll(() => {
  stopExportingSpans();
});

beforeEach(() => {
  clearExportedSpans();
  OtelIngestBaseService.clearInProcessMemos();
  jest.spyOn(Telemetry, "isSpanExportEnabled").mockReturnValue(true);
  jest.spyOn(logger, "error").mockImplementation(() => {
    return undefined;
  });

  jest
    .spyOn(GlobalCache, "getString")
    .mockImplementation(async (namespace: string): Promise<string | null> => {
      return namespace === FENCE_NAMESPACE ? null : RESOURCE_ID;
    });
  jest.spyOn(GlobalCache, "setString").mockResolvedValue(undefined);
  jest.spyOn(GlobalCache, "setStringIfNotExists").mockResolvedValue(false);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a block without what the method discovers", () => {
  test.each(DISCOVERY_CASES)(
    "$method: no span, and no cache or database call",
    async ({ method }: DiscoveryCase) => {
      const discovered: unknown = await inRequestSpan(() => {
        return baseService[method]({
          projectId: PROJECT_ID,
          attributes: APPLICATION_BLOCK,
        });
      });

      expect(discovered).toBeNull();
      expect(getExportedSpanNames()).toEqual(["request"]);
      expect(GlobalCache.getString).not.toHaveBeenCalled();
    },
  );

  test("autoDiscoverHost: a Kubernetes pod's block with a host.name gets no span", async () => {
    const discovered: unknown = await inRequestSpan(() => {
      return baseService["autoDiscoverHost"]({
        projectId: PROJECT_ID,
        attributes: [
          stringAttribute("host.name", "checkout-7d9f8"),
          stringAttribute("os.type", "linux"),
          stringAttribute("k8s.pod.name", "checkout-7d9f8"),
        ],
      });
    });

    expect(discovered).toBeNull();
    expect(getExportedSpanNames()).toEqual(["request"]);
  });

  test("autoDiscoverHost: a block already resolved to a Kubernetes cluster gets no span", async () => {
    const discovered: unknown = await inRequestSpan(() => {
      return baseService["autoDiscoverHost"]({
        projectId: PROJECT_ID,
        attributes: [
          stringAttribute("host.name", "node-1"),
          stringAttribute("os.type", "linux"),
        ],
        kubernetesClusterId: ObjectID.generate(),
      });
    });

    expect(discovered).toBeNull();
    expect(getExportedSpanNames()).toEqual(["request"]);
  });

  test("autoDiscoverCloudMonitoredResources: a request that names no cloud resource gets no span", async () => {
    const sighted: unknown = await inRequestSpan(() => {
      return baseService["autoDiscoverCloudMonitoredResources"]({
        projectId: PROJECT_ID,
        resources: [],
      });
    });

    expect(sighted).toBe(0);
    expect(getExportedSpanNames()).toEqual(["request"]);
  });
});

describe("a block the method discovers", () => {
  test.each(DISCOVERY_CASES)(
    "$method: the discovery keeps its span",
    async ({ method, attributes }: DiscoveryCase) => {
      const discovered: unknown = await inRequestSpan(() => {
        return baseService[method]({
          projectId: PROJECT_ID,
          attributes: attributes,
        });
      });

      expect(String(discovered)).toBe(RESOURCE_ID);
      expect(getExportedSpanNames()).toEqual([spanOf(method), "request"]);
    },
  );

  test("autoDiscoverCloudMonitoredResources: a request that names a cloud resource keeps the span", async () => {
    const sighted: unknown = await inRequestSpan(() => {
      return baseService["autoDiscoverCloudMonitoredResources"]({
        projectId: PROJECT_ID,
        resources: [monitoredVm("web-1")],
      });
    });

    expect(sighted).toBe(1);
    expect(getExportedSpanNames()).toEqual([
      spanOf("autoDiscoverCloudMonitoredResources"),
      "request",
    ]);
  });
});

describe("failures are handled as before", () => {
  test("a malformed attribute entry is logged as the discovery's failure, with no span", async () => {
    const discovered: unknown = await inRequestSpan(() => {
      return baseService["autoDiscoverKubernetesCluster"]({
        projectId: PROJECT_ID,
        attributes: [
          null as unknown as JSONObject,
          stringAttribute("k8s.cluster.name", "prod-eu"),
        ],
      });
    });

    expect(discovered).toBeNull();
    expect(getExportedSpanNames()).toEqual(["request"]);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("Error auto-discovering Kubernetes cluster: "),
    );
  });

  test("a discovery whose work fails keeps its span, marked OK as before", async () => {
    jest.spyOn(GlobalCache, "getString").mockRejectedValue(new Error("down"));

    const discovered: unknown = await inRequestSpan(() => {
      return baseService["autoDiscoverKubernetesCluster"]({
        projectId: PROJECT_ID,
        attributes: [stringAttribute("k8s.cluster.name", "prod-eu")],
      });
    });

    expect(discovered).toBeNull();
    expect(getExportedSpanNames()).toEqual([
      spanOf("autoDiscoverKubernetesCluster"),
      "request",
    ]);
    // OK: the method swallows the failure, as it always has.
    expect(getExportedSpans()[0]!.status.code).toBe(SpanStatusCode.OK);
    expect(logger.error).toHaveBeenCalledWith(
      "Error auto-discovering Kubernetes cluster: down",
    );
  });
});
