import {
  KUBERNETES_CLOUD_PLATFORM_PROVIDERS,
  KUBERNETES_DISTRIBUTION_ATTRIBUTE,
  KUBERNETES_DISTRIBUTION_PROVIDERS,
  getKubernetesClusterProvider,
  getKubernetesClusterProviderLabel,
} from "../../../Types/Kubernetes/KubernetesClusterProvider";
import {
  CLOUD_PLATFORM_ALIASES,
  FAAS_CLOUD_PLATFORM_VALUES,
  MANAGED_CLOUD_PLATFORM_VALUES,
  isManagedCloudPlatform,
} from "../../../Types/Cloud/CloudPlatform";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * A Kubernetes cluster's Provider names the platform it runs on, read from
 * the telemetry it sends: OpenShift from the kubernetes-agent chart's
 * openshift preset, which stamps oneuptime.kubernetes.distribution on
 * everything its collectors send, and a managed platform (EKS, GKE, AKS, ...)
 * from the cloud.platform an application's resource detector sets.
 *
 * These pin that:
 *   - the attribute and value read here are the ones the chart stamps;
 *   - the label is the same for every record an OpenShift cluster sends,
 *     whether or not it carries the cloud, so the Provider never alternates;
 *   - anything that names no platform gives null, which ingest never writes;
 *   - values off the wire never reach Object.prototype.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../../..");
const CHART_HELPERS: string = path.join(
  REPO_ROOT,
  "HelmChart",
  "Public",
  "kubernetes-agent",
  "templates",
  "_helpers.tpl",
);

// The semantic conventions' cloud.platform values for a Kubernetes service.
const SEMCONV_KUBERNETES_PLATFORMS: Array<string> = [
  "aws_eks",
  "gcp_kubernetes_engine",
  "azure_aks",
  "alibaba_cloud_ack",
  "tencent_cloud_eks",
  "aws_openshift",
  "gcp_openshift",
  "azure_openshift",
  "ibm_cloud_openshift",
];

const OPENSHIFT_PLATFORMS: Array<string> = [
  "aws_openshift",
  "gcp_openshift",
  "azure_openshift",
  "ibm_cloud_openshift",
];

const PROTOTYPE_KEYS: Array<string> = [
  "constructor",
  "__proto__",
  "toString",
  "hasOwnProperty",
  "valueOf",
  "isPrototypeOf",
];

describe("the distribution the kubernetes-agent chart stamps", () => {
  // The body of the chart's kubernetes-agent.distributionAttribute helper.
  function distributionHelper(): string {
    const helpers: string = fs.readFileSync(CHART_HELPERS, "utf8");
    const start: number = helpers.indexOf(
      '{{- define "kubernetes-agent.distributionAttribute" -}}',
    );
    expect(start).toBeGreaterThan(-1);
    const end: number = helpers.indexOf("{{- end -}}", start);
    return helpers.slice(start, end);
  }

  test("is the attribute read here", () => {
    expect(distributionHelper()).toContain(
      `- key: ${KUBERNETES_DISTRIBUTION_ATTRIBUTE}\n`,
    );
  });

  test("names a distribution this module labels, as OpenShift", () => {
    const value: string | undefined = distributionHelper().match(
      /\n {2}value: ([^\n]+)\n/,
    )?.[1];

    expect(value).toBe("openshift");
    expect(getKubernetesClusterProvider({ distribution: value })).toBe(
      "OpenShift",
    );
  });
});

describe("getKubernetesClusterProvider", () => {
  describe("the openshift preset's distribution", () => {
    test("is OpenShift", () => {
      expect(getKubernetesClusterProvider({ distribution: "openshift" })).toBe(
        "OpenShift",
      );
    });

    test.each(["OpenShift", "OPENSHIFT", " openshift ", "\topenshift\n"])(
      "is OpenShift however it is spelled or padded: %j",
      (distribution: string) => {
        expect(getKubernetesClusterProvider({ distribution })).toBe(
          "OpenShift",
        );
      },
    );

    /*
     * The records an OpenShift cluster sends: the collectors' with and
     * without the cloud their openshift detector found (the profiler runs
     * no detector; a collector whose detector failed at startup sends
     * none), and an application's span whose own SDK detector named EC2
     * (the detector runs with override: false). One label for all of them.
     */
    test.each([
      [{ distribution: "openshift" }],
      [{ distribution: "openshift", cloudPlatform: "aws_openshift" }],
      [{ distribution: "openshift", cloudPlatform: "azure_openshift" }],
      [{ distribution: "openshift", cloudPlatform: "gcp_openshift" }],
      [{ distribution: "openshift", cloudPlatform: "ibm_cloud_openshift" }],
      [{ distribution: "openshift", cloudPlatform: "aws_ec2" }],
      [{ distribution: "openshift", cloudPlatform: "" }],
      [{ distribution: "openshift", cloudPlatform: null }],
    ])(
      "is the same label for every record the cluster sends: %j",
      (record: { distribution: string; cloudPlatform?: string | null }) => {
        expect(getKubernetesClusterProvider(record)).toBe("OpenShift");
      },
    );

    test("wins over any cloud.platform a record carries", () => {
      expect(
        getKubernetesClusterProvider({
          distribution: "openshift",
          cloudPlatform: "aws_eks",
        }),
      ).toBe("OpenShift");
    });
  });

  describe("a managed platform's cloud.platform", () => {
    test.each(Object.entries(KUBERNETES_CLOUD_PLATFORM_PROVIDERS))(
      "%s is %s",
      (cloudPlatform: string, label: string) => {
        expect(getKubernetesClusterProvider({ cloudPlatform })).toBe(label);
      },
    );

    test.each([
      ["aws_eks", "EKS"],
      ["gcp_kubernetes_engine", "GKE"],
      ["azure_aks", "AKS"],
      ["alibaba_cloud_ack", "ACK"],
      ["tencent_cloud_eks", "Tencent EKS"],
    ])("%s reads as %s", (cloudPlatform: string, label: string) => {
      expect(getKubernetesClusterProvider({ cloudPlatform })).toBe(label);
    });

    test.each(OPENSHIFT_PLATFORMS)(
      "%s is OpenShift, the label the preset gives the same cluster",
      (cloudPlatform: string) => {
        expect(getKubernetesClusterProvider({ cloudPlatform })).toBe(
          "OpenShift",
        );
      },
    );

    test("is read with its known aliases, as ingest normalizes them", () => {
      expect(CLOUD_PLATFORM_ALIASES["azure.aks"]).toBe("azure_aks");
      expect(getKubernetesClusterProvider({ cloudPlatform: "azure.aks" })).toBe(
        "AKS",
      );
    });

    test("is read trimmed", () => {
      expect(getKubernetesClusterProvider({ cloudPlatform: " aws_eks " })).toBe(
        "EKS",
      );
    });

    test("is used when the distribution is one this module does not know", () => {
      expect(
        getKubernetesClusterProvider({
          distribution: "rke2",
          cloudPlatform: "azure_aks",
        }),
      ).toBe("AKS");
    });
  });

  describe("names no platform", () => {
    test.each([
      [{}],
      [{ distribution: null, cloudPlatform: null }],
      [{ distribution: undefined, cloudPlatform: undefined }],
      [{ distribution: "", cloudPlatform: "" }],
      [{ distribution: "   ", cloudPlatform: "   " }],
    ])(
      "for a record that carries neither: %j",
      (record: {
        distribution?: string | null | undefined;
        cloudPlatform?: string | null | undefined;
      }) => {
        expect(getKubernetesClusterProvider(record)).toBeNull();
      },
    );

    test.each(["k3s", "rke2", "microk8s", "kind", "eks"])(
      "for a distribution it does not know, on its own: %s",
      (distribution: string) => {
        expect(getKubernetesClusterProvider({ distribution })).toBeNull();
      },
    );

    // A host's, a function's or a managed runtime's platform is no cluster's.
    test.each([
      "aws_ec2",
      "gcp_compute_engine",
      "azure_vm",
      "aws_lambda",
      "gcp_cloud_run",
      "azure_container_apps",
      "aws_ecs",
      "kubernetes",
      "openshift",
    ])(
      "for a cloud.platform that is not a Kubernetes service: %s",
      (cloudPlatform: string) => {
        expect(getKubernetesClusterProvider({ cloudPlatform })).toBeNull();
      },
    );

    test.each(PROTOTYPE_KEYS)(
      "for %s, never an Object.prototype member",
      (key: string) => {
        expect(getKubernetesClusterProvider({ distribution: key })).toBeNull();
        expect(getKubernetesClusterProvider({ cloudPlatform: key })).toBeNull();
        expect(
          getKubernetesClusterProvider({
            distribution: key,
            cloudPlatform: key,
          }),
        ).toBeNull();
      },
    );
  });

  test("always returns a string or null", () => {
    const values: Array<string | null | undefined> = [
      ...SEMCONV_KUBERNETES_PLATFORMS,
      ...PROTOTYPE_KEYS,
      "openshift",
      "",
      null,
      undefined,
    ];

    for (const distribution of values) {
      for (const cloudPlatform of values) {
        const provider: string | null = getKubernetesClusterProvider({
          distribution,
          cloudPlatform,
        });
        expect(provider === null || typeof provider === "string").toBe(true);
      }
    }
  });
});

describe("the label tables", () => {
  test("cover exactly the semantic conventions' Kubernetes platforms", () => {
    expect(Object.keys(KUBERNETES_CLOUD_PLATFORM_PROVIDERS).sort()).toEqual(
      [...SEMCONV_KUBERNETES_PLATFORMS].sort(),
    );
  });

  /*
   * Ingest files a managed platform's telemetry under a Cloud Environment,
   * and a FaaS platform's under Serverless; a Kubernetes platform's goes to
   * its cluster by k8s.cluster.name. A key in both tables would land in two.
   */
  test("name no managed or serverless platform", () => {
    for (const platform of Object.keys(KUBERNETES_CLOUD_PLATFORM_PROVIDERS)) {
      expect({ platform, managed: isManagedCloudPlatform(platform) }).toEqual({
        platform,
        managed: false,
      });
      expect(MANAGED_CLOUD_PLATFORM_VALUES.has(platform)).toBe(false);
      expect(FAAS_CLOUD_PLATFORM_VALUES.has(platform)).toBe(false);
    }
  });

  test("key the distributions in lowercase, as they are read", () => {
    for (const distribution of Object.keys(KUBERNETES_DISTRIBUTION_PROVIDERS)) {
      expect(distribution).toBe(distribution.toLowerCase().trim());
    }
  });

  test("give every OpenShift the one label", () => {
    const labels: Set<string> = new Set([
      KUBERNETES_DISTRIBUTION_PROVIDERS["openshift"] as string,
      ...OPENSHIFT_PLATFORMS.map((platform: string): string => {
        return KUBERNETES_CLOUD_PLATFORM_PROVIDERS[platform] as string;
      }),
    ]);

    expect([...labels]).toEqual(["OpenShift"]);
  });

  test("give short labels that fit a table column", () => {
    for (const label of [
      ...Object.values(KUBERNETES_DISTRIBUTION_PROVIDERS),
      ...Object.values(KUBERNETES_CLOUD_PLATFORM_PROVIDERS),
    ]) {
      expect(label.length).toBeGreaterThan(0);
      expect(label.length).toBeLessThanOrEqual(20);
      expect(label).toBe(label.trim());
    }
  });
});

describe("getKubernetesClusterProviderLabel", () => {
  test.each(["OpenShift", "EKS", "GKE", "AKS", "self-managed"])(
    "shows a stored platform as it is: %s",
    (provider: string) => {
      expect(getKubernetesClusterProviderLabel(provider)).toBe(provider);
    },
  );

  test("trims what it shows", () => {
    expect(getKubernetesClusterProviderLabel("  OpenShift ")).toBe("OpenShift");
  });

  // The column's default, before any telemetry named the platform.
  test.each(["unknown", "Unknown", "UNKNOWN", " unknown "])(
    "shows nothing for the column's default: %j",
    (provider: string) => {
      expect(getKubernetesClusterProviderLabel(provider)).toBeNull();
    },
  );

  test.each([null, undefined, "", "   "])(
    "shows nothing when nothing is stored: %j",
    (provider: string | null | undefined) => {
      expect(getKubernetesClusterProviderLabel(provider)).toBeNull();
    },
  );

  test("shows every label getKubernetesClusterProvider can store", () => {
    for (const label of [
      ...Object.values(KUBERNETES_DISTRIBUTION_PROVIDERS),
      ...Object.values(KUBERNETES_CLOUD_PLATFORM_PROVIDERS),
    ]) {
      expect(getKubernetesClusterProviderLabel(label)).toBe(label);
    }
  });
});
