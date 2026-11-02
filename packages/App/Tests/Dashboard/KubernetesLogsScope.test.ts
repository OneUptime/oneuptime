import {
  KUBERNETES_CLUSTER_NAME_ATTRIBUTE,
  KUBERNETES_CONTAINER_NAME_ATTRIBUTE,
  KUBERNETES_LOGS_ATTRIBUTE_DISPLAY_KEYS,
  KUBERNETES_NAMESPACE_NAME_ATTRIBUTE,
  KUBERNETES_POD_NAME_ATTRIBUTE,
  KUBERNETES_WORKLOAD_LOG_ATTRIBUTES,
  buildKubernetesLogsAttributeDisplayValues,
  buildKubernetesLogsAttributeFilters,
  getKubernetesClusterDisplayName,
} from "../../FeatureSet/Dashboard/src/Components/Kubernetes/KubernetesLogsScope";
import { describe, expect, test } from "@jest/globals";

/*
 * The Kubernetes pod / container Logs tab pins attribute filters on the
 * logs viewer and shows them as locked chips. Two things went wrong there:
 *
 * - the cluster chip read the machine identifier ("Cluster: prod-eks-01")
 *   although the page had the cluster's name, and
 * - the container page passed `podName=""`, which the analytics query
 *   compiles to `attributes['resource.k8s.pod.name'] = ''` — "logs WITHOUT a
 *   pod name" — so the tab asked for rows the filelog receiver never writes
 *   and rendered an empty "Pod:" chip above the empty result.
 *
 * These pin the filter the tab sends and the chip text it asks for.
 */

describe("attribute key constants", () => {
  test("are the OTel resource keys the kubernetes-agent stamps", () => {
    expect(KUBERNETES_CLUSTER_NAME_ATTRIBUTE).toBe("resource.k8s.cluster.name");
    expect(KUBERNETES_POD_NAME_ATTRIBUTE).toBe("resource.k8s.pod.name");
    expect(KUBERNETES_CONTAINER_NAME_ATTRIBUTE).toBe(
      "resource.k8s.container.name",
    );
    expect(KUBERNETES_NAMESPACE_NAME_ATTRIBUTE).toBe(
      "resource.k8s.namespace.name",
    );
  });
});

describe("buildKubernetesLogsAttributeFilters", () => {
  test("pod page: cluster + pod + namespace", () => {
    expect(
      buildKubernetesLogsAttributeFilters({
        clusterIdentifier: "prod-eks-01",
        podName: "api-7d9f8c-abcde",
        namespace: "payments",
      }),
    ).toEqual({
      "resource.k8s.cluster.name": "prod-eks-01",
      "resource.k8s.pod.name": "api-7d9f8c-abcde",
      "resource.k8s.namespace.name": "payments",
    });
  });

  test("pod page before the pod object loads: no namespace key at all", () => {
    const filters: Record<string, string> = buildKubernetesLogsAttributeFilters(
      {
        clusterIdentifier: "prod-eks-01",
        podName: "api-7d9f8c-abcde",
        namespace: undefined,
      },
    );

    expect(filters).toEqual({
      "resource.k8s.cluster.name": "prod-eks-01",
      "resource.k8s.pod.name": "api-7d9f8c-abcde",
    });
    expect(Object.keys(filters)).not.toContain(
      KUBERNETES_NAMESPACE_NAME_ATTRIBUTE,
    );
  });

  test("regression: container page's empty podName is NOT sent as pod.name = ''", () => {
    const filters: Record<string, string> = buildKubernetesLogsAttributeFilters(
      {
        clusterIdentifier: "prod-eks-01",
        podName: "",
        containerName: "nginx",
      },
    );

    expect(filters).toEqual({
      "resource.k8s.cluster.name": "prod-eks-01",
      "resource.k8s.container.name": "nginx",
    });
    expect(
      Object.prototype.hasOwnProperty.call(
        filters,
        KUBERNETES_POD_NAME_ATTRIBUTE,
      ),
    ).toBe(false);
  });

  test("whitespace-only optional values are treated as absent", () => {
    expect(
      buildKubernetesLogsAttributeFilters({
        clusterIdentifier: "c1",
        podName: "   ",
        containerName: "\t",
        namespace: " ",
      }),
    ).toEqual({ "resource.k8s.cluster.name": "c1" });
  });

  test("undefined optional values are treated as absent", () => {
    expect(
      buildKubernetesLogsAttributeFilters({
        clusterIdentifier: "c1",
      }),
    ).toEqual({ "resource.k8s.cluster.name": "c1" });
  });

  test("all four keys when everything is present", () => {
    expect(
      buildKubernetesLogsAttributeFilters({
        clusterIdentifier: "c1",
        podName: "p1",
        containerName: "ctr",
        namespace: "ns",
      }),
    ).toEqual({
      "resource.k8s.cluster.name": "c1",
      "resource.k8s.pod.name": "p1",
      "resource.k8s.container.name": "ctr",
      "resource.k8s.namespace.name": "ns",
    });
  });

  test("filter values are the identifiers verbatim — never the cluster's display name", () => {
    const filters: Record<string, string> = buildKubernetesLogsAttributeFilters(
      {
        clusterIdentifier: "prod-eks-01",
        clusterName: "Production EKS",
        podName: "api-1",
      },
    );

    expect(filters[KUBERNETES_CLUSTER_NAME_ATTRIBUTE]).toBe("prod-eks-01");
    expect(Object.values(filters)).not.toContain("Production EKS");
  });

  test("the cluster is the scope boundary and is kept even when blank", () => {
    /*
     * Dropping it would widen the tab to every cluster running a pod of the
     * same name. An unexpected blank identifier must match nothing rather
     * than everything.
     */
    const filters: Record<string, string> = buildKubernetesLogsAttributeFilters(
      {
        clusterIdentifier: "",
        podName: "api-1",
      },
    );

    expect(
      Object.prototype.hasOwnProperty.call(
        filters,
        KUBERNETES_CLUSTER_NAME_ATTRIBUTE,
      ),
    ).toBe(true);
    expect(filters[KUBERNETES_CLUSTER_NAME_ATTRIBUTE]).toBe("");
  });

  test("never emits an empty value for an optional key", () => {
    const cases: Array<{
      podName?: string;
      containerName?: string;
      namespace?: string;
    }> = [
      {},
      { podName: "" },
      { containerName: "" },
      { namespace: "" },
      { podName: "", containerName: "c" },
      { podName: "p", containerName: "", namespace: "" },
    ];

    for (const optional of cases) {
      const filters: Record<string, string> =
        buildKubernetesLogsAttributeFilters({
          clusterIdentifier: "c1",
          ...optional,
        });

      for (const [key, value] of Object.entries(filters)) {
        if (key === KUBERNETES_CLUSTER_NAME_ATTRIBUTE) {
          continue;
        }
        expect(value.trim().length).toBeGreaterThan(0);
      }
    }
  });
});

describe("a workload's or a node's Logs tab", () => {
  test("reads its pods' lines by the name the agent stamps on them, in its namespace", () => {
    expect(
      buildKubernetesLogsAttributeFilters({
        clusterIdentifier: "c1",
        namespace: "shop",
        workloadKind: "Deployment",
        workloadName: "checkout",
      }),
    ).toEqual({
      "resource.k8s.cluster.name": "c1",
      "resource.k8s.namespace.name": "shop",
      "resource.k8s.deployment.name": "checkout",
    });
  });

  test.each([
    ["StatefulSet", "resource.k8s.statefulset.name"],
    ["DaemonSet", "resource.k8s.daemonset.name"],
    ["Job", "resource.k8s.job.name"],
    ["CronJob", "resource.k8s.cronjob.name"],
    ["DeploymentConfig", "resource.k8s.pod.label.deploymentconfig"],
  ])("a %s filters on %s", (kind: string, attribute: string) => {
    expect(
      buildKubernetesLogsAttributeFilters({
        clusterIdentifier: "c1",
        namespace: "shop",
        workloadKind: kind,
        workloadName: "web",
      })[attribute],
    ).toBe("web");
  });

  test("a node's tab reads every line from it, with no namespace", () => {
    expect(
      buildKubernetesLogsAttributeFilters({
        clusterIdentifier: "c1",
        workloadKind: "Node",
        workloadName: "node-a",
      }),
    ).toEqual({
      "resource.k8s.cluster.name": "c1",
      "resource.k8s.node.name": "node-a",
    });
  });

  test("a kind with no attribute, or no name, adds no filter", () => {
    for (const input of [
      { workloadKind: "ReplicaSet", workloadName: "web-7d9f" },
      { workloadKind: "Deployment", workloadName: "" },
      { workloadKind: "Deployment", workloadName: "   " },
      { workloadKind: undefined, workloadName: "web" },
    ]) {
      expect(
        buildKubernetesLogsAttributeFilters({
          clusterIdentifier: "c1",
          ...input,
        }),
      ).toEqual({ "resource.k8s.cluster.name": "c1" });
    }
  });
});

describe("KUBERNETES_LOGS_ATTRIBUTE_DISPLAY_KEYS", () => {
  test("labels every key the filter can send", () => {
    expect(KUBERNETES_LOGS_ATTRIBUTE_DISPLAY_KEYS).toEqual({
      "resource.k8s.cluster.name": "Cluster",
      "resource.k8s.pod.name": "Pod",
      "resource.k8s.container.name": "Container",
      "resource.k8s.namespace.name": "Namespace",
      // A workload's chip reads its kind, as kubectl writes it.
      "resource.k8s.deployment.name": "Deployment",
      "resource.k8s.statefulset.name": "StatefulSet",
      "resource.k8s.daemonset.name": "DaemonSet",
      "resource.k8s.job.name": "Job",
      "resource.k8s.cronjob.name": "CronJob",
      "resource.k8s.pod.label.deploymentconfig": "DeploymentConfig",
      "resource.k8s.node.name": "Node",
    });

    const allKeys: Array<string> = [
      ...Object.keys(
        buildKubernetesLogsAttributeFilters({
          clusterIdentifier: "c",
          podName: "p",
          containerName: "ctr",
          namespace: "ns",
        }),
      ),
      ...Object.values(KUBERNETES_WORKLOAD_LOG_ATTRIBUTES),
    ];

    for (const key of allKeys) {
      expect(KUBERNETES_LOGS_ATTRIBUTE_DISPLAY_KEYS[key]).toBeTruthy();
      expect(KUBERNETES_LOGS_ATTRIBUTE_DISPLAY_KEYS[key]).not.toMatch(
        /^resource\./,
      );
    }
  });
});

describe("getKubernetesClusterDisplayName", () => {
  test("prefers the cluster's name", () => {
    expect(
      getKubernetesClusterDisplayName({
        clusterIdentifier: "prod-eks-01",
        clusterName: "Production EKS",
      }),
    ).toBe("Production EKS");
  });

  test("trims the name", () => {
    expect(
      getKubernetesClusterDisplayName({
        clusterIdentifier: "prod-eks-01",
        clusterName: "  Production EKS  ",
      }),
    ).toBe("Production EKS");
  });

  test("falls back to the identifier when the name is missing or blank", () => {
    expect(
      getKubernetesClusterDisplayName({ clusterIdentifier: "prod-eks-01" }),
    ).toBe("prod-eks-01");
    expect(
      getKubernetesClusterDisplayName({
        clusterIdentifier: "prod-eks-01",
        clusterName: "",
      }),
    ).toBe("prod-eks-01");
    expect(
      getKubernetesClusterDisplayName({
        clusterIdentifier: "prod-eks-01",
        clusterName: "   ",
      }),
    ).toBe("prod-eks-01");
  });

  test("is empty when neither is known", () => {
    expect(getKubernetesClusterDisplayName({})).toBe("");
    expect(
      getKubernetesClusterDisplayName({
        clusterIdentifier: "",
        clusterName: "",
      }),
    ).toBe("");
  });
});

describe("buildKubernetesLogsAttributeDisplayValues", () => {
  test("the cluster chip reads the cluster's name", () => {
    expect(
      buildKubernetesLogsAttributeDisplayValues({
        clusterIdentifier: "prod-eks-01",
        clusterName: "Production EKS",
        podName: "api-1",
      }),
    ).toEqual({ "resource.k8s.cluster.name": "Production EKS" });
  });

  test("falls back to the identifier before the name is known", () => {
    expect(
      buildKubernetesLogsAttributeDisplayValues({
        clusterIdentifier: "prod-eks-01",
      }),
    ).toEqual({ "resource.k8s.cluster.name": "prod-eks-01" });
  });

  test("does not override pod, container or namespace values — they already are names", () => {
    const displayValues: Record<string, string> =
      buildKubernetesLogsAttributeDisplayValues({
        clusterIdentifier: "c1",
        clusterName: "Cluster One",
        podName: "api-1",
        containerName: "nginx",
        namespace: "payments",
      });

    expect(Object.keys(displayValues)).toEqual([
      KUBERNETES_CLUSTER_NAME_ATTRIBUTE,
    ]);
  });

  test("returns no override when there is nothing to show", () => {
    expect(
      buildKubernetesLogsAttributeDisplayValues({
        clusterIdentifier: "",
        clusterName: undefined,
      }),
    ).toEqual({});
  });

  test("every override is keyed by a key the filter actually sends", () => {
    const input: {
      clusterIdentifier: string;
      clusterName: string;
      containerName: string;
      podName: string;
    } = {
      clusterIdentifier: "c1",
      clusterName: "Cluster One",
      containerName: "nginx",
      podName: "",
    };

    const filterKeys: Array<string> = Object.keys(
      buildKubernetesLogsAttributeFilters(input),
    );

    for (const key of Object.keys(
      buildKubernetesLogsAttributeDisplayValues(input),
    )) {
      expect(filterKeys).toContain(key);
    }
  });
});
