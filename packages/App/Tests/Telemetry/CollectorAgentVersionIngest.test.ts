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
import OtelMetricsIngestService from "../../FeatureSet/Telemetry/Services/OtelMetricsIngestService";
import GlobalCache from "Common/Server/Infrastructure/GlobalCache";
import CephClusterService from "Common/Server/Services/CephClusterService";
import DockerSwarmClusterService from "Common/Server/Services/DockerSwarmClusterService";
import HostService from "Common/Server/Services/HostService";
import LabelService from "Common/Server/Services/LabelService";
import ProxmoxClusterService from "Common/Server/Services/ProxmoxClusterService";
import VMwareVCenterService from "Common/Server/Services/VMwareVCenterService";
import Host from "Common/Models/DatabaseModels/Host";
import ObjectID from "Common/Types/ObjectID";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * Hosts, Proxmox, Ceph and VMware show an agent version, with a sign when a
 * newer one is out, only if the server stores the oneuptime.agent.version
 * their collectors now stamp. This walks the ingest boundary with the
 * attributes those collectors really send - read from the agents' own
 * configs, not typed here - and checks the version reaches each resource's
 * updateLastSeen (the write ResourceHeartbeat gates; VMwareVCenterService.
 * test and CollectorAgentVersionHeartbeat.test cover that it lands on the
 * row). The Docker Swarm agent, which stamped its version first, is the
 * reference the others follow.
 *
 * An agent installed before the pin stamps nothing, and the version must
 * then stay unset - never blank, never a made-up value - so the page reads
 * "Not reported", not "outdated".
 *
 * All Postgres/Redis access is mocked; the attribute walk runs for real.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const RESOURCE_ID: string = "55555555-5555-4555-8555-555555555555";
const REPO_ROOT: string = path.resolve(__dirname, "../../../..");

/* eslint-disable @typescript-eslint/no-explicit-any */
const baseService: Record<string, any> =
  OtelIngestBaseService as unknown as Record<string, any>;
const metricsService: Record<string, any> =
  OtelMetricsIngestService as unknown as Record<string, any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

function stringAttribute(key: string, value: string): JSONObject {
  return { key: key, value: { stringValue: value } };
}

// The oneuptime.agent.version an agent's shipped config stamps.
function stampOf(agentDir: string): string {
  const config: {
    processors: {
      resource: { attributes: Array<{ key: string; value?: string }> };
    };
  } = yaml.load(
    fs.readFileSync(
      path.join(REPO_ROOT, "agents", agentDir, "otel-collector-config.yaml"),
      "utf8",
    ),
  ) as {
    processors: {
      resource: { attributes: Array<{ key: string; value?: string }> };
    };
  };
  const stamp: { key: string; value?: string } | undefined =
    config.processors.resource.attributes.find(
      (attribute: { key: string }): boolean => {
        return attribute.key === "oneuptime.agent.version";
      },
    );
  expect(stamp?.value).toMatch(/^\d+\.\d+\.\d+$/);
  return stamp!.value as string;
}

type DiscoverCase = {
  name: string;
  method: string;
  // The identity attributes the agent's config stamps (or the host sends).
  identity: JSONArray;
  // The service whose updateLastSeen carries the version.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  service: any;
  // The version the agent's files stamp.
  version: () => string;
};

const CASES: Array<DiscoverCase> = [
  {
    name: "a Proxmox cluster",
    method: "autoDiscoverProxmoxCluster",
    identity: [stringAttribute("proxmox.cluster.name", "pve-prod")] as JSONArray,
    service: ProxmoxClusterService,
    version: (): string => {
      return stampOf("ProxmoxAgent");
    },
  },
  {
    name: "a Ceph cluster",
    method: "autoDiscoverCephCluster",
    identity: [stringAttribute("ceph.cluster.name", "ceph-prod")] as JSONArray,
    service: CephClusterService,
    version: (): string => {
      return stampOf("CephAgent");
    },
  },
  {
    name: "a vCenter",
    method: "autoDiscoverVMwareVCenter",
    identity: [
      stringAttribute("vmware.vcenter.name", "vcsa-prod"),
    ] as JSONArray,
    service: VMwareVCenterService,
    version: (): string => {
      return stampOf("VMwareAgent");
    },
  },
  {
    // The reference: the first collector agent that stamped its version.
    name: "a Docker Swarm cluster",
    method: "autoDiscoverDockerSwarmCluster",
    identity: [
      stringAttribute("docker.swarm.cluster.name", "swarm-prod"),
    ] as JSONArray,
    service: DockerSwarmClusterService,
    version: (): string => {
      return "0.161.0";
    },
  },
  {
    name: "a host",
    method: "autoDiscoverHost",
    identity: [
      stringAttribute("host.name", "web-01"),
      stringAttribute("os.type", "linux"),
    ] as JSONArray,
    service: HostService,
    version: (): string => {
      return "0.161.0";
    },
  },
];

describe.each(CASES)(
  "$name: the version the collector stamps reaches updateLastSeen",
  ({ method, identity, service, version }: DiscoverCase) => {
    let calls: Array<Record<string, unknown>>;

    beforeEach(() => {
      calls = [];
      OtelIngestBaseService.clearInProcessMemos();

      // Every id cache is primed, so findOrCreate* never runs.
      jest.spyOn(GlobalCache, "getString").mockResolvedValue(RESOURCE_ID);
      jest.spyOn(GlobalCache, "setString").mockResolvedValue(undefined);
      jest.spyOn(baseService, "shouldRunMaintenance").mockResolvedValue(true);
      jest
        .spyOn(baseService, "tryLinkHostToProxmoxGuest")
        .mockResolvedValue(undefined);
      jest
        .spyOn(LabelService, "findOrCreateLabelsByNames")
        .mockResolvedValue([]);
      jest
        .spyOn(service, "updateLastSeen")
        .mockImplementation(async (_id: unknown, extra?: unknown) => {
          calls.push((extra ?? {}) as Record<string, unknown>);
        });
    });

    afterEach(() => {
      jest.restoreAllMocks();
      OtelIngestBaseService.clearInProcessMemos();
    });

    test("a collector on the pinned files: its stamp is stored as the agent version", async () => {
      const stamped: string = version();
      await baseService[method]({
        projectId: PROJECT_ID,
        attributes: [
          ...identity,
          stringAttribute("oneuptime.agent.version", stamped),
        ] as JSONArray,
      });

      expect(calls).toHaveLength(1);
      expect(calls[0]!["agentVersion"]).toBe(stamped);
    });

    test("an older collector: its own version is stored, as it reports it", async () => {
      await baseService[method]({
        projectId: PROJECT_ID,
        attributes: [
          ...identity,
          stringAttribute("oneuptime.agent.version", "0.154.0"),
        ] as JSONArray,
      });

      expect(calls[0]!["agentVersion"]).toBe("0.154.0");
    });

    test("an install from before the pin stamps nothing: the version stays unset, never blank", async () => {
      await baseService[method]({
        projectId: PROJECT_ID,
        attributes: identity,
      });

      expect(calls).toHaveLength(1);
      expect(calls[0]!["agentVersion"]).toBeUndefined();
    });

    test("a blank stamp is not a version", async () => {
      await baseService[method]({
        projectId: PROJECT_ID,
        attributes: [
          ...identity,
          stringAttribute("oneuptime.agent.version", ""),
        ] as JSONArray,
      });

      expect(calls[0]!["agentVersion"]).toBeUndefined();
    });
  },
);

/*
 * Host metrics take a batch-level path first (runBatchHostEnrichment): one
 * merged UPDATE per host for the whole batch. It carries the version too,
 * so a new or upgraded collector's version shows with its first batch, and
 * the batch path and the per-resource maintenance path report the same
 * facts - their heartbeat fingerprints agree instead of taking turns.
 */
describe("runBatchHostEnrichment carries the host collector's version", () => {
  const HOST_ROW_ID: ObjectID = ObjectID.generate();
  let calls: Array<Record<string, unknown>>;

  function hostResource(extra: Array<JSONObject>): JSONObject {
    return {
      resource: {
        attributes: [
          stringAttribute("host.name", "web-01"),
          stringAttribute("os.type", "linux"),
          ...extra,
        ],
      },
      scopeMetrics: [],
    };
  }

  beforeEach(() => {
    calls = [];
    const host: Host = new Host();
    host._id = HOST_ROW_ID.toString();
    host.projectId = PROJECT_ID;
    host.hostIdentifier = "web-01";

    jest
      .spyOn(HostService, "findOrCreateByHostIdentifier")
      .mockResolvedValue(host);
    jest
      .spyOn(HostService, "updateLastSeen")
      .mockImplementation(async (_id: ObjectID, extra?: unknown) => {
        calls.push((extra ?? {}) as Record<string, unknown>);
      });
    jest.spyOn(HostService, "attachLabels").mockResolvedValue(undefined);
    jest
      .spyOn(LabelService, "findOrCreateLabelsByNames")
      .mockResolvedValue([]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("the stamp on the batch's resources is written with the host's other facts", async () => {
    await metricsService["runBatchHostEnrichment"]({
      projectId: PROJECT_ID,
      resourceMetrics: [
        hostResource([stringAttribute("oneuptime.agent.version", "0.161.0")]),
      ] as JSONArray,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      osType: "linux",
      agentVersion: "0.161.0",
    });
  });

  test("one write per host, with the version from whichever scraper's resource carries it", async () => {
    await metricsService["runBatchHostEnrichment"]({
      projectId: PROJECT_ID,
      resourceMetrics: [
        hostResource([]),
        hostResource([stringAttribute("oneuptime.agent.version", "0.161.0")]),
        hostResource([]),
      ] as JSONArray,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]!["agentVersion"]).toBe("0.161.0");
  });

  test("a collector that stamps nothing leaves the version unset", async () => {
    await metricsService["runBatchHostEnrichment"]({
      projectId: PROJECT_ID,
      resourceMetrics: [hostResource([])] as JSONArray,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]!["agentVersion"]).toBeUndefined();
  });

  test("a Kubernetes node's resource is still no host, whatever version it stamps", async () => {
    await metricsService["runBatchHostEnrichment"]({
      projectId: PROJECT_ID,
      resourceMetrics: [
        hostResource([
          stringAttribute("k8s.node.name", "worker-1"),
          stringAttribute("oneuptime.agent.version", "14.0.14"),
        ]),
      ] as JSONArray,
    });

    expect(calls).toHaveLength(0);
  });
});
