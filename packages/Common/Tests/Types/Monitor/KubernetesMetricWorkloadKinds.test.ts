import { describe, expect, test } from "@jest/globals";
import {
  KubernetesMetricCategory,
  KubernetesMetricDefinition,
  getAllKubernetesMetrics,
  getKubernetesMetricById,
} from "../../../Types/Monitor/KubernetesMetricCatalog";
import {
  KUBERNETES_WORKLOAD_KINDS,
  KubernetesResourceScope,
  KubernetesWorkloadKind,
  MonitorStepKubernetesMonitorUtil,
} from "../../../Types/Monitor/MonitorStepKubernetesMonitor";

/*
 * The kind of workload each Kubernetes metric is about. The monitor form's
 * Custom Metric tab starts Workload Kind on it, so a Workload Name is read as
 * that kind's: Job Failed Pods scoped to "nightly-export" filters on the
 * Job's name. The field used to start on Deployment for every metric, and a
 * Job Failed Pods monitor scoped to one Job read nothing until the person
 * noticed and picked "Job".
 */

const EXPECTED_WORKLOAD_KINDS: Record<string, KubernetesWorkloadKind> = {
  "deployment-available-replicas": "deployment",
  "deployment-desired-replicas": "deployment",
  "daemonset-misscheduled-nodes": "daemonset",
  "daemonset-ready-nodes": "daemonset",
  "statefulset-ready-replicas": "statefulset",
  "job-failed-pods": "job",
  "job-failed-pods-increase": "job",
  "job-successful-pods": "job",
};

// Categories of Workload-scoped metrics that are about no one kind, and why.
const WORKLOAD_SCOPED_WITHOUT_A_KIND: Partial<
  Record<KubernetesMetricCategory, string>
> = {
  HPA: "An HPA is not one of the workload kinds; its metrics carry the HPA's own name.",
};

const METRICS: Array<KubernetesMetricDefinition> = getAllKubernetesMetrics();

const OFFERED_KINDS: Array<KubernetesWorkloadKind> =
  KUBERNETES_WORKLOAD_KINDS.map((kind: { value: KubernetesWorkloadKind }) => {
    return kind.value;
  });

// The workload kind a metric's name is for: `k8s.job.failed_pods` is a Job's.
function getKindTheNameSays(
  metric: KubernetesMetricDefinition,
): KubernetesWorkloadKind | undefined {
  return OFFERED_KINDS.find((kind: KubernetesWorkloadKind) => {
    return metric.metricName.startsWith(`k8s.${kind}.`);
  });
}

describe("Kubernetes metrics name the workload kind they are about", () => {
  test.each(Object.entries(EXPECTED_WORKLOAD_KINDS))(
    "%s is about a %s",
    (id: string, kind: KubernetesWorkloadKind) => {
      const metric: KubernetesMetricDefinition | undefined =
        getKubernetesMetricById(id);

      expect(metric).toBeDefined();
      expect(metric!.workloadKind).toBe(kind);
    },
  );

  test("every other metric has no kind", () => {
    for (const metric of METRICS) {
      if (EXPECTED_WORKLOAD_KINDS[metric.id]) {
        continue;
      }

      expect({ id: metric.id, workloadKind: metric.workloadKind }).toEqual({
        id: metric.id,
        workloadKind: undefined,
      });
    }
  });

  test("pod, container, node, control-plane and HPA metrics have no kind", () => {
    const categoriesWithoutKinds: Array<KubernetesMetricCategory> = [
      "Pod",
      "Container",
      "Node",
      "ControlPlane",
      "HPA",
    ];

    for (const metric of METRICS) {
      if (categoriesWithoutKinds.includes(metric.category)) {
        expect({ id: metric.id, workloadKind: metric.workloadKind }).toEqual({
          id: metric.id,
          workloadKind: undefined,
        });
      }
    }
  });

  test.each(METRICS)(
    "$id: a metric named for a workload kind has that kind",
    (metric: KubernetesMetricDefinition) => {
      // k8s.job.*, k8s.deployment.*, ..., k8s.cronjob.*: the kind, or none.
      expect({ id: metric.id, workloadKind: metric.workloadKind }).toEqual({
        id: metric.id,
        workloadKind: getKindTheNameSays(metric),
      });
    },
  );

  test("a metric's kind is one the Workload Kind field offers, on a Workload scope", () => {
    for (const metric of METRICS) {
      if (!metric.workloadKind) {
        continue;
      }

      expect(OFFERED_KINDS).toContain(metric.workloadKind);
      expect(metric.category).toBe("Workload");
      expect(metric.defaultResourceScope).toBe(
        KubernetesResourceScope.Workload,
      );
    }
  });

  test.each(
    METRICS.filter((metric: KubernetesMetricDefinition) => {
      return metric.defaultResourceScope === KubernetesResourceScope.Workload;
    }),
  )(
    "$id: a Workload scope comes with a kind, or a reason it has none",
    (metric: KubernetesMetricDefinition) => {
      expect({
        id: metric.id,
        hasKindOrReason: Boolean(
          metric.workloadKind ||
            WORKLOAD_SCOPED_WITHOUT_A_KIND[metric.category],
        ),
      }).toEqual({ id: metric.id, hasKindOrReason: true });
    },
  );

  test("the reasons name only categories with Workload-scoped metrics and no kind", () => {
    for (const category of Object.keys(
      WORKLOAD_SCOPED_WITHOUT_A_KIND,
    ) as Array<KubernetesMetricCategory>) {
      const metrics: Array<KubernetesMetricDefinition> = METRICS.filter(
        (metric: KubernetesMetricDefinition) => {
          return metric.category === category;
        },
      );

      expect(metrics.length).toBeGreaterThan(0);

      for (const metric of metrics) {
        expect(metric.workloadKind).toBeUndefined();
        expect(metric.defaultResourceScope).toBe(
          KubernetesResourceScope.Workload,
        );
      }
    }
  });

  test("a Workload Name of the metric's kind filters on the name its series carry", () => {
    for (const metric of METRICS) {
      if (!metric.workloadKind) {
        continue;
      }

      expect(
        MonitorStepKubernetesMonitorUtil.getWorkloadNameAttributeKey({
          workloadType: metric.workloadKind,
          workloadName: "checkout",
        }),
      ).toBe(`resource.k8s.${getKindTheNameSays(metric)}.name`);
    }
  });
});
