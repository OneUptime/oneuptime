import MonitorStep from "Common/Types/Monitor/MonitorStep";
import ObjectID from "Common/Types/ObjectID";
import Dictionary from "Common/Types/Dictionary";
import MonitorStepKubernetesMonitor, {
  KubernetesResourceScope,
} from "Common/Types/Monitor/MonitorStepKubernetesMonitor";
import { getKubernetesAlertTemplateById } from "Common/Types/Monitor/KubernetesAlertTemplates";
import { describe, expect, test, beforeEach, afterEach } from "@jest/globals";

/*
 * A Kubernetes monitor scoped to one workload. The form asked only for the
 * Workload Name and never set its kind, and this worker added the filter
 * only when both were set - so a monitor scoped to "checkout" read every
 * workload in the cluster. A name now always reaches the query, as the
 * kind's attribute (a Deployment's when the step names no kind).
 */

// The worker transitively loads the native `isolated-vm` addon; stub it.
jest.mock("Common/Server/Utils/VM/VMRunner", () => {
  return { __esModule: true, default: {} };
});

jest.mock("Common/Server/Services/MetricService", () => {
  return {
    __esModule: true,
    default: { aggregateBy: jest.fn(), findBy: jest.fn() },
  };
});

jest.mock("Common/Server/Services/MetricTypeService", () => {
  return { __esModule: true, default: { findBy: jest.fn() } };
});

import MetricService from "Common/Server/Services/MetricService";
import MetricTypeService from "Common/Server/Services/MetricTypeService";
import { monitorKubernetes } from "../../../../FeatureSet/Workers/Jobs/TelemetryMonitor/MonitorTelemetryMonitor";

const metricAggregateBy: jest.Mock =
  MetricService.aggregateBy as unknown as jest.Mock;
const metricFindBy: jest.Mock = MetricService.findBy as unknown as jest.Mock;
const metricTypeFindBy: jest.Mock =
  MetricTypeService.findBy as unknown as jest.Mock;

const monitorId: ObjectID = ObjectID.generate();
const projectId: ObjectID = ObjectID.generate();

interface QueryArgs {
  query: { name: string; attributes?: Dictionary<string> };
}

function workloadStep(
  resourceFilters: MonitorStepKubernetesMonitor["resourceFilters"],
): MonitorStep {
  const step: MonitorStep = getKubernetesAlertTemplateById(
    "k8s-crashloopbackoff",
  )!.getMonitorStep({
    clusterIdentifier: "prod",
    onlineMonitorStatusId: ObjectID.generate(),
    offlineMonitorStatusId: ObjectID.generate(),
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
    monitorName: "checkout",
  });

  step.setKubernetesMonitor({
    ...step.data!.kubernetesMonitor!,
    resourceScope: KubernetesResourceScope.Workload,
    resourceFilters: resourceFilters,
  });

  return step;
}

// The attributes of every query the worker ran, aggregated or raw.
function queriedAttributes(): Array<Dictionary<string> | undefined> {
  return [...metricAggregateBy.mock.calls, ...metricFindBy.mock.calls].map(
    (call: Array<unknown>) => {
      return (call[0] as QueryArgs).query.attributes;
    },
  );
}

beforeEach(() => {
  metricAggregateBy.mockReset().mockResolvedValue({ data: [] });
  metricFindBy.mockReset().mockResolvedValue([]);
  metricTypeFindBy.mockReset().mockResolvedValue([]);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("monitorKubernetes: a Workload Name always scopes the query", () => {
  test("a name without a kind is read as a Deployment's", async () => {
    await monitorKubernetes({
      monitorStep: workloadStep({ workloadName: "checkout" }),
      monitorId,
      projectId,
    });

    const attributes: Array<Dictionary<string> | undefined> =
      queriedAttributes();

    expect(attributes.length).toBeGreaterThan(0);

    for (const queried of attributes) {
      expect(queried?.["resource.k8s.cluster.name"]).toBe("prod");
      expect(queried?.["resource.k8s.deployment.name"]).toBe("checkout");
    }
  });

  test("a StatefulSet's name is matched on the StatefulSet attribute", async () => {
    await monitorKubernetes({
      monitorStep: workloadStep({
        workloadName: "postgres",
        workloadType: "statefulset",
      }),
      monitorId,
      projectId,
    });

    for (const queried of queriedAttributes()) {
      expect(queried?.["resource.k8s.statefulset.name"]).toBe("postgres");
      expect(queried?.["resource.k8s.deployment.name"]).toBeUndefined();
    }
  });

  test("no name: the cluster alone scopes the query", async () => {
    await monitorKubernetes({
      monitorStep: workloadStep({}),
      monitorId,
      projectId,
    });

    for (const queried of queriedAttributes()) {
      expect(
        Object.keys(queried || {}).filter((key: string) => {
          return key.startsWith("resource.k8s.") && key.endsWith(".name");
        }),
      ).toEqual(["resource.k8s.cluster.name"]);
    }
  });
});
