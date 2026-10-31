import { describe, expect, test } from "@jest/globals";
import {
  KubernetesAlertTemplate,
  KubernetesAlertTemplateArgs,
  getAllKubernetesAlertTemplates,
  getKubernetesAlertTemplateById,
} from "../../../Types/Monitor/KubernetesAlertTemplates";
import MonitorStepKubernetesMonitor, {
  KUBERNETES_WORKLOAD_KINDS,
  KubernetesResourceScope,
  MonitorStepKubernetesMonitorUtil,
} from "../../../Types/Monitor/MonitorStepKubernetesMonitor";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import ObjectID from "../../../Types/ObjectID";

/*
 * The kind of workload each Kubernetes template watches. The monitor form's
 * Workload Kind starts on it, so a Workload Name is read as that kind's: Job
 * Failures scoped to "nightly-export" filters on the Job's name. The field
 * used to start on Deployment for every template, and a Job Failures monitor
 * scoped to one Job read nothing until the person noticed and picked "Job".
 */

const EXPECTED_WORKLOAD_KINDS: Record<string, string> = {
  "k8s-deployment-replica-mismatch": "deployment",
  "k8s-job-failures": "job",
  "k8s-daemonset-unavailable": "daemonset",
};

// Templates with a Workload scope that watch no one kind, and why.
const WORKLOAD_SCOPED_WITHOUT_A_KIND: Record<string, string> = {
  "k8s-hpa-at-max-replicas":
    "An HPA is not one of the workload kinds; its metrics carry the HPA's own name.",
};

const ARGS: KubernetesAlertTemplateArgs = {
  clusterIdentifier: "prod",
  onlineMonitorStatusId: ObjectID.generate(),
  offlineMonitorStatusId: ObjectID.generate(),
  defaultIncidentSeverityId: ObjectID.generate(),
  defaultAlertSeverityId: ObjectID.generate(),
  monitorName: "Kubernetes",
};

function getKubernetesMonitor(
  template: KubernetesAlertTemplate,
): MonitorStepKubernetesMonitor {
  return template.getMonitorStep(ARGS).data!.kubernetesMonitor!;
}

/*
 * The workload kinds a template's queries name: a metric of the kind
 * (`k8s.job.failed_pods.increase`), or a filter or group-by key on the
 * kind's name (`resource.k8s.job.name`).
 */
function getKindsTheQueriesName(
  template: KubernetesAlertTemplate,
): Array<string> {
  const kinds: Set<string> = new Set<string>();

  for (const queryConfig of getKubernetesMonitor(template).metricViewConfig
    .queryConfigs as Array<MetricQueryConfigData>) {
    const metricName: string =
      queryConfig.metricQueryData.filterData.metricName || "";
    const keys: Array<string> = [
      ...Object.keys(queryConfig.metricQueryData.filterData.attributes || {}),
      ...(queryConfig.metricQueryData.groupByAttributeKeys || []),
    ];

    for (const kind of KUBERNETES_WORKLOAD_KINDS) {
      if (
        metricName.startsWith(`k8s.${kind.value}.`) ||
        keys.includes(`resource.k8s.${kind.value}.name`)
      ) {
        kinds.add(kind.value);
      }
    }
  }

  return Array.from(kinds);
}

const TEMPLATES: Array<KubernetesAlertTemplate> =
  getAllKubernetesAlertTemplates();

describe("Kubernetes templates name the workload kind they watch", () => {
  test("each template watches the kind expected of it, and the rest none", () => {
    const kinds: Record<string, string | undefined> = {};

    for (const template of TEMPLATES) {
      kinds[template.id] = template.workloadKind;
    }

    const expected: Record<string, string | undefined> = {};

    for (const template of TEMPLATES) {
      expected[template.id] = EXPECTED_WORKLOAD_KINDS[template.id];
    }

    expect(kinds).toEqual(expected);
    // Every expected template still exists.
    for (const id of Object.keys(EXPECTED_WORKLOAD_KINDS)) {
      expect(getKubernetesAlertTemplateById(id)).toBeDefined();
    }
  });

  test.each(TEMPLATES)(
    "$name declares the kind its queries watch",
    (template: KubernetesAlertTemplate) => {
      const kinds: Array<string> = getKindsTheQueriesName(template);

      // A template that watched two kinds would need a decision here.
      expect(kinds.length).toBeLessThanOrEqual(1);
      expect({ id: template.id, workloadKind: template.workloadKind }).toEqual({
        id: template.id,
        workloadKind: kinds[0],
      });
    },
  );

  test.each(TEMPLATES)(
    "$name: a Workload scope comes with a kind, or a reason it has none",
    (template: KubernetesAlertTemplate) => {
      if (
        getKubernetesMonitor(template).resourceScope !==
        KubernetesResourceScope.Workload
      ) {
        return;
      }

      expect({
        id: template.id,
        hasKindOrReason: Boolean(
          template.workloadKind || WORKLOAD_SCOPED_WITHOUT_A_KIND[template.id],
        ),
      }).toEqual({ id: template.id, hasKindOrReason: true });
    },
  );

  test("a template's kind is one the Workload Kind field offers, on a Workload scope", () => {
    const offered: Array<string> = KUBERNETES_WORKLOAD_KINDS.map(
      (kind: { value: string }) => {
        return kind.value;
      },
    );

    for (const template of TEMPLATES) {
      if (!template.workloadKind) {
        continue;
      }

      expect(offered).toContain(template.workloadKind);
      expect(getKubernetesMonitor(template).resourceScope).toBe(
        KubernetesResourceScope.Workload,
      );
    }
  });

  test("a Workload Name of the template's kind filters on the name its alerts are grouped by", () => {
    for (const template of TEMPLATES) {
      if (!template.workloadKind) {
        continue;
      }

      const key: string | null =
        MonitorStepKubernetesMonitorUtil.getWorkloadNameAttributeKey({
          workloadType: template.workloadKind,
          workloadName: "checkout",
        });

      for (const queryConfig of getKubernetesMonitor(template).metricViewConfig
        .queryConfigs as Array<MetricQueryConfigData>) {
        expect(queryConfig.metricQueryData.groupByAttributeKeys).toContain(key);
      }
    }
  });

  test("the reasons name only templates that exist, have a Workload scope and no kind", () => {
    for (const id of Object.keys(WORKLOAD_SCOPED_WITHOUT_A_KIND)) {
      const template: KubernetesAlertTemplate | undefined =
        getKubernetesAlertTemplateById(id);

      expect(template).toBeDefined();
      expect(template!.workloadKind).toBeUndefined();
      expect(getKubernetesMonitor(template!).resourceScope).toBe(
        KubernetesResourceScope.Workload,
      );
    }
  });
});
