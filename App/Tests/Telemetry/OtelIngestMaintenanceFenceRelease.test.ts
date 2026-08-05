/*
 * The Queue infrastructure module pulls in BullMQ (ESM-only msgpackr) at
 * import time via the services' queue imports; nothing queue-related is
 * under test here, so the module is replaced — same idiom as
 * HostIpAddressIngest.test.ts in this directory.
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

import OtelIngestBaseService from "../../FeatureSet/Telemetry/Services/OtelIngestBaseService";
import GlobalCache from "Common/Server/Infrastructure/GlobalCache";
import CephClusterService from "Common/Server/Services/CephClusterService";
import CloudResourceService from "Common/Server/Services/CloudResourceService";
import CloudResourceInstanceService from "Common/Server/Services/CloudResourceInstanceService";
import DockerHostService from "Common/Server/Services/DockerHostService";
import DockerSwarmClusterService from "Common/Server/Services/DockerSwarmClusterService";
import HostService from "Common/Server/Services/HostService";
import IoTFleetService from "Common/Server/Services/IoTFleetService";
import KubernetesClusterService from "Common/Server/Services/KubernetesClusterService";
import LabelService from "Common/Server/Services/LabelService";
import PodmanHostService from "Common/Server/Services/PodmanHostService";
import ProxmoxClusterService from "Common/Server/Services/ProxmoxClusterService";
import RumApplicationService from "Common/Server/Services/RumApplicationService";
import RumApplicationClientService from "Common/Server/Services/RumApplicationClientService";
import ServerlessFunctionService from "Common/Server/Services/ServerlessFunctionService";
import ServerlessFunctionInstanceService from "Common/Server/Services/ServerlessFunctionInstanceService";
import ObjectID from "Common/Types/ObjectID";
import { JSONArray, JSONObject } from "Common/Types/JSON";
/*
 * `jest` is deliberately taken from the ambient global rather than from
 * "@jest/globals". App pins @types/jest 29 against jest 28, so the two spell
 * a spy differently: the global one hands back jest.SpyInstance<T, Y, C>,
 * @jest/globals hands back jest-mock 28's one-parameter SpyInstance. Mixing
 * them — an @jest/globals spy annotated with the global jest.SpiedFunction —
 * does not compile, and the annotation is worth keeping.
 */
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * Per-resource ingest maintenance (updateLastSeen + label promotion) is
 * fenced behind a 5-minute Redis key so a hundred telemetry workers do not
 * each issue the same UPDATE on the same hot row. The fence is armed on
 * ATTEMPT — inside shouldRunMaintenance, before the gated work runs.
 *
 * That ordering is deliberate and it has a sharp edge: if the gated work
 * then throws, the fence keeps suppressing every retry for the rest of the
 * window. lastSeenAt goes stale, and markDisconnected* flips the resource
 * to "disconnected" while its telemetry is still arriving — the same
 * user-visible failure as issue #3006, reached by a different route.
 *
 * Only the Kubernetes path used to release its fence on failure. Every
 * autoDiscover* now records what it armed and releases it in its catch
 * block. This suite pins that for all eleven, plus the two properties that
 * make "record what you armed" better than "clear the obvious key":
 *
 *   - a successful batch releases NOTHING, so the throttle the fence
 *     exists to provide survives, and
 *   - a fence another worker armed is never released, whatever this batch
 *     did — only fences this attempt armed itself are in play.
 *
 * The all-or-nothing edge (a method with two fences releases both when only
 * the second failed) is pinned too, as the deliberate tradeoff it is.
 *
 * All Postgres/Redis access is mocked; the attribute walk runs for real.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const RESOURCE_ID: string = "44444444-4444-4444-8444-444444444444";

const FENCE_NAMESPACE: string = "otel-maintenance-fence";

/* eslint-disable @typescript-eslint/no-explicit-any */
const baseService: Record<string, any> =
  OtelIngestBaseService as unknown as Record<string, any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

function stringAttribute(key: string, value: string): JSONObject {
  return { key: key, value: { stringValue: value } };
}

type FenceCase = {
  /** describe() title. */
  name: string;
  /** The autoDiscover* method under test. */
  method: string;
  /** Fence scope the method arms for the resource itself. */
  scope: string;
  /** Resource attributes that route a batch to this method. */
  attributes: JSONArray;
  /** The service call that the fence gates, and which we make fail. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  gated: { service: any; method: string };
  /**
   * The second, independently-fenced piece of work some methods do
   * (live-inventory registration), if any.
   */
  secondary?: {
    scope: string;
    /** Fence id suffix — the fence key is `${resourceId}:${suffix}`. */
    idSuffix: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    gated: { service: any; method: string };
  };
};

const FENCE_CASES: Array<FenceCase> = [
  {
    name: "autoDiscoverKubernetesCluster",
    method: "autoDiscoverKubernetesCluster",
    scope: "k8s-cluster",
    attributes: [stringAttribute("k8s.cluster.name", "prod-eu")] as JSONArray,
    gated: { service: KubernetesClusterService, method: "updateLastSeen" },
  },
  {
    name: "autoDiscoverProxmoxCluster",
    method: "autoDiscoverProxmoxCluster",
    scope: "proxmox-cluster",
    attributes: [stringAttribute("proxmox.cluster.name", "pve-1")] as JSONArray,
    gated: { service: ProxmoxClusterService, method: "updateLastSeen" },
  },
  {
    name: "autoDiscoverIoTFleet",
    method: "autoDiscoverIoTFleet",
    scope: "iot-fleet",
    attributes: [stringAttribute("iot.fleet.name", "sensors-eu")] as JSONArray,
    gated: { service: IoTFleetService, method: "updateLastSeen" },
  },
  {
    name: "autoDiscoverDockerSwarmCluster",
    method: "autoDiscoverDockerSwarmCluster",
    scope: "docker-swarm-cluster",
    attributes: [
      stringAttribute("docker.swarm.cluster.name", "swarm-1"),
    ] as JSONArray,
    gated: { service: DockerSwarmClusterService, method: "updateLastSeen" },
  },
  {
    name: "autoDiscoverCephCluster",
    method: "autoDiscoverCephCluster",
    scope: "ceph-cluster",
    attributes: [stringAttribute("ceph.cluster.name", "ceph-1")] as JSONArray,
    gated: { service: CephClusterService, method: "updateLastSeen" },
  },
  {
    name: "autoDiscoverServerless",
    method: "autoDiscoverServerless",
    scope: "serverless-function",
    attributes: [
      stringAttribute("faas.name", "checkout-handler"),
      stringAttribute("faas.instance", "instance-a"),
    ] as JSONArray,
    gated: { service: ServerlessFunctionService, method: "updateLastSeen" },
    secondary: {
      scope: "serverless-fn-instance",
      idSuffix: "instance-a",
      gated: {
        service: ServerlessFunctionInstanceService,
        method: "recordInstance",
      },
    },
  },
  {
    name: "autoDiscoverCloudResource",
    method: "autoDiscoverCloudResource",
    scope: "cloud-resource",
    attributes: [
      stringAttribute("cloud.platform", "aws_ecs"),
      stringAttribute("service.name", "checkout"),
      stringAttribute("service.instance.id", "task-a"),
    ] as JSONArray,
    gated: { service: CloudResourceService, method: "updateLastSeen" },
    secondary: {
      scope: "cloud-resource-instance",
      idSuffix: "task-a",
      gated: {
        service: CloudResourceInstanceService,
        method: "recordInstance",
      },
    },
  },
  {
    name: "autoDiscoverRum",
    method: "autoDiscoverRum",
    scope: "rum-application",
    attributes: [
      stringAttribute("browser.platform", "macOS"),
      stringAttribute("service.name", "storefront"),
    ] as JSONArray,
    gated: { service: RumApplicationService, method: "updateLastSeen" },
    secondary: {
      scope: "rum-client",
      idSuffix: "macOS",
      gated: { service: RumApplicationClientService, method: "recordClient" },
    },
  },
  {
    name: "autoDiscoverDockerHost",
    method: "autoDiscoverDockerHost",
    scope: "docker-host",
    attributes: [
      stringAttribute("container.runtime", "docker"),
      stringAttribute("host.name", "docker-host-1"),
      stringAttribute("os.type", "linux"),
    ] as JSONArray,
    gated: { service: DockerHostService, method: "updateLastSeen" },
  },
  {
    name: "autoDiscoverPodmanHost",
    method: "autoDiscoverPodmanHost",
    scope: "podman-host",
    attributes: [
      stringAttribute("container.runtime", "podman"),
      stringAttribute("host.name", "podman-host-1"),
      stringAttribute("os.type", "linux"),
    ] as JSONArray,
    gated: { service: PodmanHostService, method: "updateLastSeen" },
  },
  {
    name: "autoDiscoverHost",
    method: "autoDiscoverHost",
    scope: "host",
    attributes: [
      stringAttribute("host.name", "vm-1"),
      stringAttribute("os.type", "linux"),
    ] as JSONArray,
    gated: { service: HostService, method: "updateLastSeen" },
  },
];

describe.each(FENCE_CASES)(
  "$name maintenance fence",
  ({ method, scope, attributes, gated, secondary }: FenceCase) => {
    let deletedKeys: Array<string>;
    /** Fence keys (scope:id) that are already held when the batch arrives. */
    let heldFences: Set<string>;

    const fenceKey: string = `${FENCE_NAMESPACE}:${scope}:${RESOURCE_ID}`;

    beforeEach(() => {
      deletedKeys = [];
      heldFences = new Set<string>();

      /*
       * Every resource-id cache is primed, so findOrCreate* never runs and
       * each method goes straight to its fence check. The fence namespace
       * answers from heldFences, so a test can decide whether this batch
       * arms the fence or finds it already held.
       */
      jest
        .spyOn(GlobalCache, "getString")
        .mockImplementation(async (namespace: string, key: string) => {
          if (namespace === FENCE_NAMESPACE) {
            return heldFences.has(key) ? "1" : null;
          }
          return RESOURCE_ID;
        });
      jest.spyOn(GlobalCache, "setString").mockResolvedValue(undefined);
      jest
        .spyOn(GlobalCache, "deleteKey")
        .mockImplementation(async (namespace: string, key: string) => {
          deletedKeys.push(`${namespace}:${key}`);
        });

      // Label promotion is not what is under test.
      jest
        .spyOn(LabelService, "findOrCreateLabelsByNames")
        .mockResolvedValue([]);
      jest
        .spyOn(baseService, "tryLinkHostToProxmoxGuest")
        .mockResolvedValue(undefined);

      // Both gated calls succeed unless a test says otherwise.
      jest.spyOn(gated.service, gated.method).mockResolvedValue(undefined);
      if (secondary) {
        jest
          .spyOn(secondary.gated.service, secondary.gated.method)
          .mockResolvedValue(undefined);
      }
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    async function run(): Promise<unknown> {
      return baseService[method]({
        projectId: PROJECT_ID,
        attributes: attributes,
      });
    }

    test("releases the fence when the gated work throws", async () => {
      jest
        .spyOn(gated.service, gated.method)
        .mockRejectedValue(new Error("Postgres said no"));

      await run();

      expect(deletedKeys).toContain(fenceKey);
    });

    test("swallows the failure — one bad batch must not break ingest", async () => {
      jest
        .spyOn(gated.service, gated.method)
        .mockRejectedValue(new Error("Postgres said no"));

      await expect(run()).resolves.toBeNull();
    });

    test("keeps the fence when the gated work succeeds", async () => {
      await run();

      /*
       * Releasing here would throw away the throttle the fence exists to
       * provide and put the per-batch UPDATE storm straight back.
       */
      expect(deletedKeys).not.toContain(fenceKey);
    });

    test("does not release a fence that was already held by another worker", async () => {
      heldFences.add(`${scope}:${RESOURCE_ID}`);
      jest
        .spyOn(gated.service, gated.method)
        .mockRejectedValue(new Error("Postgres said no"));

      await run();

      /*
       * The gated work is skipped in this window, so nothing this batch did
       * can justify clearing another worker's fence.
       */
      expect(deletedKeys).not.toContain(fenceKey);
    });

    if (secondary) {
      const secondaryKey: string = `${FENCE_NAMESPACE}:${secondary.scope}:${RESOURCE_ID}:${secondary.idSuffix}`;

      test("releases the inventory fence when the inventory write throws", async () => {
        jest
          .spyOn(secondary.gated.service, secondary.gated.method)
          .mockRejectedValue(new Error("Postgres said no"));

        await run();

        expect(deletedKeys).toContain(secondaryKey);
      });

      test("a failing inventory write also releases the resource fence", async () => {
        jest
          .spyOn(secondary.gated.service, secondary.gated.method)
          .mockRejectedValue(new Error("Postgres said no"));

        await run();

        /*
         * Release is all-or-nothing within one attempt, so the resource
         * fence goes too even though updateLastSeen succeeded under it.
         * Deliberate: updateLastSeen and attachLabels each carry their own
         * 60-second throttle, so redoing them next batch costs at most one
         * extra UPDATE per minute. Pinned so the tradeoff stays a decision
         * rather than something that quietly changes.
         */
        expect(deletedKeys).toContain(fenceKey);
      });

      test("a failing resource write does not release the inventory fence", async () => {
        jest
          .spyOn(gated.service, gated.method)
          .mockRejectedValue(new Error("Postgres said no"));

        await run();

        // The inventory fence was never armed — the method threw before it.
        expect(deletedKeys).not.toContain(secondaryKey);
      });
    }
  },
);

describe("releaseMaintenanceFences", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("clears every fence it is handed", async () => {
    const deletedKeys: Array<string> = [];
    jest
      .spyOn(GlobalCache, "deleteKey")
      .mockImplementation(async (namespace: string, key: string) => {
        deletedKeys.push(`${namespace}:${key}`);
      });

    await baseService["releaseMaintenanceFences"]([
      { scope: "host", id: "a" },
      { scope: "docker-host", id: "b" },
    ]);

    expect(deletedKeys).toEqual([
      `${FENCE_NAMESPACE}:host:a`,
      `${FENCE_NAMESPACE}:docker-host:b`,
    ]);
  });

  test("is a no-op when nothing was armed", async () => {
    const deleteKey: jest.SpiedFunction<typeof GlobalCache.deleteKey> = jest
      .spyOn(GlobalCache, "deleteKey")
      .mockResolvedValue(undefined);

    await baseService["releaseMaintenanceFences"]([]);

    expect(deleteKey).not.toHaveBeenCalled();
  });

  test("survives a cache outage — the fence TTL expires it anyway", async () => {
    jest
      .spyOn(GlobalCache, "deleteKey")
      .mockRejectedValue(new Error("redis down"));

    await expect(
      baseService["releaseMaintenanceFences"]([{ scope: "host", id: "a" }]),
    ).resolves.toBeUndefined();
  });
});

describe("maintenance fence release coverage", () => {
  test("every autoDiscover* method is covered", () => {
    /*
     * A twelfth resource type with an updateLastSeen behind a fence belongs
     * in FENCE_CASES — an autoDiscover* that only logs in its catch block
     * is exactly the bug this suite exists to catch.
     */
    const covered: Array<string> = FENCE_CASES.map((c: FenceCase) => {
      return c.method;
    });

    const declared: Array<string> = Object.getOwnPropertyNames(
      OtelIngestBaseService,
    ).filter((property: string) => {
      return property.startsWith("autoDiscover");
    });

    expect(declared.length).toBeGreaterThan(0);
    expect(covered.sort()).toEqual(declared.sort());
  });
});
