/*
 * The Queue infrastructure module pulls in BullMQ (ESM-only msgpackr) at
 * import time via the services' queue imports; nothing queue-related is
 * under test here, so the module is replaced — same idiom as
 * CollectorAgentVersionIngest.test.ts in this directory.
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
import KubernetesClusterService from "Common/Server/Services/KubernetesClusterService";
import LabelService from "Common/Server/Services/LabelService";
import ObjectID from "Common/Types/ObjectID";
import { KUBERNETES_DISTRIBUTION_ATTRIBUTE } from "Common/Types/Kubernetes/KubernetesClusterProvider";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import fs from "fs";
import path from "path";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A Kubernetes cluster's Provider is what its telemetry says it runs on.
 * This walks the ingest boundary - autoDiscoverKubernetesCluster, which every
 * signal's ingest runs for a resource with a k8s.cluster.name - with the
 * attributes each sender really stamps, and checks what reaches the
 * cluster's updateLastSeen (KubernetesClusterProviderHeartbeat.test covers
 * that it lands on the row):
 *
 *   - the kubernetes-agent chart's openshift preset stamps its distribution,
 *     read here from the chart itself, not typed: "OpenShift", with or
 *     without the cloud the collector's openshift detector adds;
 *   - an application's span with a managed platform's cloud.platform: "EKS";
 *   - anything else names no platform, and nothing is sent: a cluster's
 *     Provider is never blanked by telemetry that does not know it.
 *
 * All Postgres/Redis access is mocked; the attribute walk runs for real.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const RESOURCE_ID: string = "66666666-6666-4666-8666-666666666666";
const REPO_ROOT: string = path.resolve(__dirname, "../../../..");
const CLUSTER_NAME: string = "ocp-prod";

/* eslint-disable @typescript-eslint/no-explicit-any */
const baseService: Record<string, any> =
  OtelIngestBaseService as unknown as Record<string, any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

function stringAttribute(key: string, value: string): JSONObject {
  return { key: key, value: { stringValue: value } };
}

/*
 * The distribution attribute the chart's openshift preset stamps, as
 * kubernetes-agent.distributionAttribute writes it.
 */
function chartDistributionStamp(): { key: string; value: string } {
  const helpers: string = fs.readFileSync(
    path.join(
      REPO_ROOT,
      "HelmChart",
      "Public",
      "kubernetes-agent",
      "templates",
      "_helpers.tpl",
    ),
    "utf8",
  );
  const stamp: RegExpMatchArray | null = helpers.match(
    /\{\{- define "kubernetes-agent\.distributionAttribute" -\}\}\n- key: ([^\n]+)\n {2}value: ([^\n]+)\n/,
  );
  expect(stamp).not.toBeNull();
  return { key: stamp![1]!, value: stamp![2]! };
}

function openshiftStamp(): JSONObject {
  const stamp: { key: string; value: string } = chartDistributionStamp();
  return stringAttribute(stamp.key, stamp.value);
}

// What every record a cluster's agent sends carries, whatever the preset.
const CLUSTER_IDENTITY: JSONArray = [
  stringAttribute("k8s.cluster.name", CLUSTER_NAME),
  stringAttribute("oneuptime.agent.version", "14.0.98"),
] as JSONArray;

describe("autoDiscoverKubernetesCluster sends the cluster's platform to updateLastSeen", () => {
  let calls: Array<Record<string, unknown>>;

  async function discover(attributes: JSONArray): Promise<void> {
    await baseService["autoDiscoverKubernetesCluster"]({
      projectId: PROJECT_ID,
      attributes: attributes,
    });
  }

  beforeEach(() => {
    calls = [];
    OtelIngestBaseService.clearInProcessMemos();

    // Every id cache is primed, so findOrCreateByClusterIdentifier never runs.
    jest.spyOn(GlobalCache, "getString").mockResolvedValue(RESOURCE_ID);
    jest.spyOn(GlobalCache, "setString").mockResolvedValue(undefined);
    jest.spyOn(baseService, "shouldRunMaintenance").mockResolvedValue(true);
    jest.spyOn(LabelService, "findOrCreateLabelsByNames").mockResolvedValue([]);
    jest
      .spyOn(KubernetesClusterService, "updateLastSeen")
      .mockImplementation(async (_id: unknown, extra?: unknown) => {
        calls.push((extra ?? {}) as Record<string, unknown>);
        return { isRowGone: false };
      });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    OtelIngestBaseService.clearInProcessMemos();
  });

  test("the chart stamps the attribute ingest reads", () => {
    expect(chartDistributionStamp().key).toBe(
      KUBERNETES_DISTRIBUTION_ATTRIBUTE,
    );
  });

  describe("on the openshift preset", () => {
    test("a collector's record without a cloud (on-premises, or the profiler's) is OpenShift", async () => {
      await discover([...CLUSTER_IDENTITY, openshiftStamp()] as JSONArray);

      expect(calls).toHaveLength(1);
      expect(calls[0]!["provider"]).toBe("OpenShift");
    });

    test.each([
      "aws_openshift",
      "azure_openshift",
      "gcp_openshift",
      "ibm_cloud_openshift",
    ])(
      "a collector's record with the cloud its openshift detector found (%s) is OpenShift too",
      async (cloudPlatform: string) => {
        await discover([
          ...CLUSTER_IDENTITY,
          openshiftStamp(),
          stringAttribute("cloud.provider", cloudPlatform.split("_")[0]!),
          stringAttribute("cloud.platform", cloudPlatform),
        ] as JSONArray);

        expect(calls[0]!["provider"]).toBe("OpenShift");
      },
    );

    test("an application's span through the agent, whose SDK named EC2, is OpenShift", async () => {
      await discover([
        ...CLUSTER_IDENTITY,
        openshiftStamp(),
        stringAttribute("service.name", "checkout"),
        stringAttribute("cloud.provider", "aws"),
        stringAttribute("cloud.platform", "aws_ec2"),
      ] as JSONArray);

      expect(calls[0]!["provider"]).toBe("OpenShift");
    });

    test("the agent version still travels with it", async () => {
      await discover([...CLUSTER_IDENTITY, openshiftStamp()] as JSONArray);

      expect(calls[0]!["agentVersion"]).toBe("14.0.98");
    });
  });

  describe("from a managed platform's cloud.platform", () => {
    test.each([
      ["aws_eks", "EKS"],
      ["gcp_kubernetes_engine", "GKE"],
      ["azure_aks", "AKS"],
      ["azure.aks", "AKS"],
    ])(
      "an application's span on %s is %s",
      async (cloudPlatform: string, provider: string) => {
        await discover([
          stringAttribute("k8s.cluster.name", CLUSTER_NAME),
          stringAttribute("service.name", "checkout"),
          stringAttribute("cloud.platform", cloudPlatform),
        ] as JSONArray);

        expect(calls).toHaveLength(1);
        expect(calls[0]!["provider"]).toBe(provider);
      },
    );
  });

  describe("names no platform, and sends none", () => {
    test("the standard preset's records", async () => {
      await discover(CLUSTER_IDENTITY);

      expect(calls).toHaveLength(1);
      expect(calls[0]!["provider"]).toBeUndefined();
      expect(calls[0]!["agentVersion"]).toBe("14.0.98");
    });

    test("a span whose cloud.platform is a host's, not a cluster's", async () => {
      await discover([
        ...CLUSTER_IDENTITY,
        stringAttribute("cloud.platform", "aws_ec2"),
      ] as JSONArray);

      expect(calls[0]!["provider"]).toBeUndefined();
    });

    test("a blank distribution", async () => {
      await discover([
        ...CLUSTER_IDENTITY,
        stringAttribute(KUBERNETES_DISTRIBUTION_ATTRIBUTE, "   "),
      ] as JSONArray);

      expect(calls[0]!["provider"]).toBeUndefined();
    });

    test("a distribution OneUptime does not know", async () => {
      await discover([
        ...CLUSTER_IDENTITY,
        stringAttribute(KUBERNETES_DISTRIBUTION_ATTRIBUTE, "rke2"),
      ] as JSONArray);

      expect(calls[0]!["provider"]).toBeUndefined();
    });

    test.each(["constructor", "__proto__", "toString"])(
      "a value that would reach Object.prototype: %s",
      async (value: string) => {
        await discover([
          ...CLUSTER_IDENTITY,
          stringAttribute(KUBERNETES_DISTRIBUTION_ATTRIBUTE, value),
          stringAttribute("cloud.platform", value),
        ] as JSONArray);

        expect(calls[0]!["provider"]).toBeUndefined();
      },
    );
  });

  test("a record without a cluster name discovers no cluster, and writes nothing", async () => {
    await discover([openshiftStamp()] as JSONArray);

    expect(calls).toHaveLength(0);
  });
});
