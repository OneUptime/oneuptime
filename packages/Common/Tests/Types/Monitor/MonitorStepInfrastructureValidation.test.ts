import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorType, {
  MonitorTypeHelper,
} from "../../../Types/Monitor/MonitorType";
import MonitorStepKubernetesMonitor, {
  DEFAULT_KUBERNETES_WORKLOAD_KIND,
  KUBERNETES_WORKLOAD_KINDS,
  MonitorStepKubernetesMonitorUtil,
} from "../../../Types/Monitor/MonitorStepKubernetesMonitor";
import { MonitorStepHostMonitorUtil } from "../../../Types/Monitor/MonitorStepHostMonitor";
import { getHostAlertTemplateById } from "../../../Types/Monitor/HostAlertTemplates";
import ObjectID from "../../../Types/ObjectID";
import { describe, expect, test } from "@jest/globals";

/*
 * What an infrastructure monitor's step needs before it can be saved, and
 * how a Kubernetes step's Workload Name reaches the query.
 */

function hostStep(withQuery: boolean): MonitorStep {
  if (withQuery) {
    return getHostAlertTemplateById("host-high-cpu")!.getMonitorStep({
      hostIdentifier: "web-01",
      onlineMonitorStatusId: ObjectID.generate(),
      offlineMonitorStatusId: ObjectID.generate(),
      defaultIncidentSeverityId: ObjectID.generate(),
      defaultAlertSeverityId: ObjectID.generate(),
      monitorName: "web-01",
    });
  }

  const step: MonitorStep = hostStep(true);
  step.setHostMonitor({
    ...MonitorStepHostMonitorUtil.getDefault(),
    hostIdentifier: "web-01",
  });
  return step;
}

describe("MonitorStep.getValidationError: an infrastructure monitor needs something to watch", () => {
  /*
   * Regression: a Host (or Kubernetes, Docker ...) step with its resource
   * picked but neither an alert template nor a metric was accepted, and then
   * evaluated nothing, ever.
   */
  test("a host picked but no template and no metric is refused, in words that say what to do", () => {
    expect(
      MonitorStep.getValidationError(hostStep(false), MonitorType.Host),
    ).toBe("Pick an alert template or a metric to watch");
  });

  test("a template's queries are enough", () => {
    expect(
      MonitorStep.getValidationError(hostStep(true), MonitorType.Host),
    ).toBeNull();
  });

  test("a query without a metric name does not count", () => {
    const step: MonitorStep = hostStep(true);
    const config: ReturnType<typeof MonitorStepHostMonitorUtil.getDefault> =
      step.data!.hostMonitor!;

    step.setHostMonitor({
      ...config,
      metricViewConfig: {
        queryConfigs: config.metricViewConfig.queryConfigs.map(
          (queryConfig: (typeof config.metricViewConfig.queryConfigs)[0]) => {
            return {
              ...queryConfig,
              metricQueryData: {
                ...queryConfig.metricQueryData,
                filterData: {
                  ...queryConfig.metricQueryData.filterData,
                  metricName: "  ",
                },
              },
            };
          },
        ),
        formulaConfigs: config.metricViewConfig.formulaConfigs,
      },
    });

    expect(MonitorStep.getValidationError(step, MonitorType.Host)).toBe(
      "Pick an alert template or a metric to watch",
    );
  });

  test("the rule is the infrastructure types', not a Metrics monitor's", () => {
    expect(MonitorTypeHelper.isInfrastructureMonitor(MonitorType.Metrics)).toBe(
      false,
    );

    for (const monitorType of MonitorTypeHelper.getMetricBackedMonitorTypes()) {
      expect(MonitorTypeHelper.isInfrastructureMonitor(monitorType)).toBe(
        monitorType !== MonitorType.Metrics,
      );
    }

    for (const monitorType of [
      MonitorType.Website,
      MonitorType.Logs,
      MonitorType.Server,
      MonitorType.NetworkDevice,
      undefined,
    ]) {
      expect(MonitorTypeHelper.isInfrastructureMonitor(monitorType)).toBe(
        false,
      );
    }
  });
});

describe("MonitorStepKubernetesMonitorUtil.getWorkloadNameAttributeKey", () => {
  function filters(
    resourceFilters: MonitorStepKubernetesMonitor["resourceFilters"],
  ): string | null {
    return MonitorStepKubernetesMonitorUtil.getWorkloadNameAttributeKey(
      resourceFilters,
    );
  }

  /*
   * Regression: the form asked only for the name and never set the kind,
   * and the worker applied the filter only when both were set - so a
   * monitor scoped to one workload watched every workload in the cluster.
   */
  test("a name without a kind is a Deployment's", () => {
    expect(filters({ workloadName: "checkout" })).toBe(
      "resource.k8s.deployment.name",
    );
    expect(DEFAULT_KUBERNETES_WORKLOAD_KIND).toBe("deployment");
  });

  test("every kind the form offers names its own attribute", () => {
    for (const kind of KUBERNETES_WORKLOAD_KINDS) {
      expect(
        filters({ workloadName: "checkout", workloadType: kind.value }),
      ).toBe(`resource.k8s.${kind.value}.name`);
    }
  });

  test("a kind saved in another case, or with stray characters, still names a key of letters", () => {
    expect(filters({ workloadName: "db", workloadType: "StatefulSet" })).toBe(
      "resource.k8s.statefulset.name",
    );
    expect(filters({ workloadName: "db", workloadType: "stateful-set" })).toBe(
      "resource.k8s.statefulset.name",
    );
  });

  test("no name, or a blank one, filters nothing", () => {
    expect(filters({})).toBeNull();
    expect(filters(undefined)).toBeNull();
    expect(filters({ workloadName: "   ", workloadType: "job" })).toBeNull();
  });
});
