import {
  KubernetesAlertTemplate,
  KubernetesAlertTemplateArgs,
  getAllKubernetesAlertTemplates,
} from "../../../Types/Monitor/KubernetesAlertTemplates";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import ObjectID from "../../../Types/ObjectID";

/*
 * Guard test for per-series alerting on the SHIPPED Kubernetes templates.
 *
 * A monitor is treated as per-series purely from configuration —
 * MonitorStep.getGroupByAttributeKeys(step).length > 0, the same answer
 * the telemetry worker uses to build the series breakdown. So a template
 * that forgets its group-by key is not a cosmetic miss: the monitor
 * created from it raises ONE alert for the whole cluster, and every other
 * unhealthy node/pod/deployment after the first dedupes silently behind
 * that alert for as long as it stays open.
 *
 * The expectation below is therefore an explicit, per-template decision
 * rather than a rule, and both directions matter:
 *
 *   - Grouped templates must carry the RIGHT key. It is the
 *     ClickHouse-stored attribute name, so it carries the `resource.`
 *     prefix that OtelMetricsIngestService stamps on OTel resource
 *     attributes. A bare `k8s.node.name` matches nothing and collapses
 *     the fleet into one mislabeled series that still renders and still
 *     alerts — a silent failure, not a loud one.
 *
 *   - Cluster-scalar templates must stay UNGROUPED. etcd leadership, API
 *     server throttling and scheduler queue depth are one value for the
 *     cluster; splitting them invents series that do not exist.
 *
 *   - The key set is also the ALERT'S VOCABULARY. Series labels are
 *     stored on the alert and rendered into its title and description
 *     (SeriesLabelDisplay / SeriesContextEnricher), so a key left out
 *     here is a fact the on-call engineer does not get. That is why the
 *     namespace-scoped objects group by namespace as well as their own
 *     name: `k8s.pod.name` alone is not a Kubernetes identity, and
 *     "Pod: checkout-7d9f-2xk" with no namespace is a `kubectl` guess.
 *
 *   - A key that only ONE side of a RATIO template carries is worse than
 *     a missing label: the two queries join by series fingerprint, so
 *     the formula silently stops producing values and the monitor stops
 *     alerting entirely. `k8s.namespace.name` is stamped directly by
 *     both kubeletstats and the k8s_cluster receiver and is safe;
 *     `k8s.node.name` on the k8s_cluster side only arrives via the
 *     best-effort k8sattributes processor and is deliberately NOT in any
 *     ratio template's key set. See buildKubernetesRatioMonitorConfig.
 */

interface TemplateGroupByCase {
  id: string;
  // [] means "deliberately whole-cluster".
  groupByKeys: Array<string>;
  why: string;
}

const EXPECTED_GROUP_BY: Array<TemplateGroupByCase> = [
  {
    id: "k8s-crashloopbackoff",
    groupByKeys: [
      "resource.k8s.namespace.name",
      "resource.k8s.pod.name",
      "resource.k8s.container.name",
    ],
    why: "restarts belong to one CONTAINER of one pod, and the alert has to name which",
  },
  {
    id: "k8s-pod-pending",
    groupByKeys: [],
    why: "cluster-wide count of unschedulable pods; pending pod names are ephemeral",
  },
  {
    id: "k8s-node-not-ready",
    groupByKeys: ["resource.k8s.node.name"],
    why: "one incident per NotReady node",
  },
  {
    id: "k8s-high-cpu",
    groupByKeys: ["resource.k8s.node.name"],
    why: "per-node CPU utilization ratio",
  },
  {
    id: "k8s-high-memory",
    groupByKeys: ["resource.k8s.node.name"],
    why: "per-node memory utilization ratio",
  },
  {
    id: "k8s-deployment-replica-mismatch",
    groupByKeys: [
      "resource.k8s.namespace.name",
      "resource.k8s.deployment.name",
    ],
    why: "a stuck rollout belongs to one Deployment object, which is namespace-scoped",
  },
  {
    id: "k8s-job-failures",
    groupByKeys: ["resource.k8s.namespace.name", "resource.k8s.job.name"],
    why: "one failing Job must not hide the next; Job names repeat across namespaces",
  },
  {
    id: "k8s-etcd-no-leader",
    groupByKeys: [],
    why: "etcd leadership is a cluster-scalar fact",
  },
  {
    id: "k8s-apiserver-throttling",
    groupByKeys: [],
    why: "control-plane aggregate; no per-instance identity on this metric",
  },
  {
    id: "k8s-scheduler-backlog",
    groupByKeys: [],
    why: "scheduler queue depth is one number for the cluster",
  },
  {
    id: "k8s-high-disk-usage",
    groupByKeys: ["resource.k8s.node.name"],
    why: "disk fills one node at a time; the fleet Avg would dilute it away",
  },
  {
    id: "k8s-daemonset-unavailable",
    groupByKeys: ["resource.k8s.namespace.name", "resource.k8s.daemonset.name"],
    why: "the incident names one DaemonSet, which is namespace-scoped",
  },
  {
    id: "k8s-node-cpu-request-utilization",
    groupByKeys: ["resource.k8s.node.name"],
    why: "per-node scheduling commitment",
  },
  {
    id: "k8s-node-memory-request-utilization",
    groupByKeys: ["resource.k8s.node.name"],
    why: "per-node scheduling commitment",
  },
  {
    id: "k8s-hpa-at-max-replicas",
    groupByKeys: ["resource.k8s.namespace.name", "resource.k8s.hpa.name"],
    why: "saturation belongs to one HPA object, which is namespace-scoped",
  },
  {
    id: "k8s-pod-memory-limit-saturation",
    groupByKeys: ["resource.k8s.namespace.name", "resource.k8s.pod.name"],
    why: "the pod about to be OOMKilled is the one to page on, and a pod name alone is not an identity",
  },
  {
    id: "k8s-pod-cpu-limit-saturation",
    groupByKeys: ["resource.k8s.namespace.name", "resource.k8s.pod.name"],
    why: "the throttled pod is the one to page on, and a pod name alone is not an identity",
  },
];

function buildArgs(): KubernetesAlertTemplateArgs {
  return {
    clusterIdentifier: "prod-cluster",
    onlineMonitorStatusId: ObjectID.generate(),
    offlineMonitorStatusId: ObjectID.generate(),
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
    monitorName: "Test Monitor",
  };
}

describe("KubernetesAlertTemplates - per-series group-by keys", () => {
  test("every shipped template has a declared group-by expectation", () => {
    const shippedIds: Array<string> = getAllKubernetesAlertTemplates()
      .map((t: KubernetesAlertTemplate) => {
        return t.id;
      })
      .sort();

    const expectedIds: Array<string> = EXPECTED_GROUP_BY.map(
      (tc: TemplateGroupByCase) => {
        return tc.id;
      },
    ).sort();

    /*
     * A new template added without a decision here would otherwise ship
     * ungrouped by default and quietly alert once for a whole fleet.
     */
    expect(shippedIds).toEqual(expectedIds);
  });

  test.each(EXPECTED_GROUP_BY)(
    "$id groups by $groupByKeys ($why)",
    (tc: TemplateGroupByCase) => {
      const template: KubernetesAlertTemplate | undefined =
        getAllKubernetesAlertTemplates().find((t: KubernetesAlertTemplate) => {
          return t.id === tc.id;
        });
      expect(template).toBeDefined();

      const step: MonitorStep = template!.getMonitorStep(buildArgs());

      expect(MonitorStep.getGroupByAttributeKeys(step)).toEqual(tc.groupByKeys);

      /*
       * getGroupByAttributeKeys unions across queryConfigs, so a ratio
       * template whose two queries disagreed would still look grouped
       * here while its formula series failed to join. Assert the key set
       * on EVERY query instead.
       */
      for (const queryConfig of (step.data?.kubernetesMonitor?.metricViewConfig
        ?.queryConfigs || []) as Array<any>) {
        expect(queryConfig.metricQueryData.groupByAttributeKeys || []).toEqual(
          tc.groupByKeys,
        );
      }
    },
  );

  test.each(
    EXPECTED_GROUP_BY.filter((tc: TemplateGroupByCase) => {
      return tc.groupByKeys.length > 0;
    }),
  )(
    "$id groups by a resource-prefixed attribute key",
    (tc: TemplateGroupByCase) => {
      for (const key of tc.groupByKeys) {
        /*
         * The `resource.` prefix is load-bearing: OTel resource
         * attributes are stored prefixed, so a bare `k8s.pod.name` would
         * match nothing and every pod would collapse into one series.
         */
        expect(key.startsWith("resource.k8s.")).toBe(true);
      }
    },
  );

  /*
   * Kubernetes object names are unique per (namespace, kind), not
   * globally. A template that groups by a namespace-scoped object's name
   * alone therefore does two wrong things at once: two same-named
   * objects in different namespaces collapse into one series (so the
   * second one's breach is silenced behind the first one's open alert),
   * and the alert it does raise cannot be acted on without guessing the
   * namespace.
   */
  const NAMESPACE_SCOPED_OBJECT_KEYS: Array<string> = [
    "resource.k8s.pod.name",
    "resource.k8s.container.name",
    "resource.k8s.deployment.name",
    "resource.k8s.statefulset.name",
    "resource.k8s.daemonset.name",
    "resource.k8s.job.name",
    "resource.k8s.cronjob.name",
    "resource.k8s.hpa.name",
  ];

  test.each(
    EXPECTED_GROUP_BY.filter((tc: TemplateGroupByCase) => {
      return tc.groupByKeys.some((key: string) => {
        return NAMESPACE_SCOPED_OBJECT_KEYS.includes(key);
      });
    }),
  )(
    "$id groups a namespace-scoped object and therefore also by namespace",
    (tc: TemplateGroupByCase) => {
      expect(tc.groupByKeys).toContain("resource.k8s.namespace.name");
    },
  );

  test("every query of a template shares one group-by key set", () => {
    /*
     * Ratio templates join their two queries by series fingerprint,
     * which is computed from this key set. Two queries with different
     * key sets produce fingerprints that never meet, the formula
     * evaluates against an empty operand, and the monitor stops
     * alerting without any error anywhere.
     */
    for (const template of getAllKubernetesAlertTemplates()) {
      const step: MonitorStep = template.getMonitorStep(buildArgs());

      const keySets: Array<string> = (
        (step.data?.kubernetesMonitor?.metricViewConfig?.queryConfigs ||
          []) as Array<any>
      ).map((queryConfig: any) => {
        return JSON.stringify(
          queryConfig.metricQueryData.groupByAttributeKeys || [],
        );
      });

      expect(new Set(keySets).size).toBeLessThanOrEqual(1);
    }
  });

  test("grouped templates are the majority of the shipped set", () => {
    const grouped: number = EXPECTED_GROUP_BY.filter(
      (tc: TemplateGroupByCase) => {
        return tc.groupByKeys.length > 0;
      },
    ).length;

    /*
     * Not a style rule — a regression tripwire. This file shipped with
     * only the four ratio templates grouped; if a refactor drops the
     * group-by plumbing from buildKubernetesMonitorConfig, every
     * single-query template silently reverts to whole-cluster alerting
     * and this count falls back toward four.
     */
    expect(grouped).toBe(13);
    expect(EXPECTED_GROUP_BY.length - grouped).toBe(4);
  });
});
