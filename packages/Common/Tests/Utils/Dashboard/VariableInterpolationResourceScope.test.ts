import Includes from "../../../Types/BaseDatabase/Includes";
import IsNull from "../../../Types/BaseDatabase/IsNull";
import NotNull from "../../../Types/BaseDatabase/NotNull";
import { DashboardResourceScope } from "../../../Types/Dashboard/DashboardResourceScope";
import DashboardVariable, {
  DashboardVariableType,
} from "../../../Types/Dashboard/DashboardVariable";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import DashboardVariableInterpolation from "../../../Utils/Dashboard/VariableInterpolation";
import { describe, expect, test } from "@jest/globals";

/*
 * A variable that picks among one kind of resource keeps every widget to
 * that kind (issue #11258): "All" is all of the kind, never the whole
 * project, and a pick narrows within it. A variable that names no kind
 * reads as it always has.
 */

function variable(data: Partial<DashboardVariable>): DashboardVariable {
  return {
    id: data.id || "v1",
    name: data.name || "cluster",
    type: data.type || DashboardVariableType.TelemetryAttribute,
    attributeKey: data.attributeKey ?? "resource.k8s.cluster.name",
    ...data,
  } as DashboardVariable;
}

const KUBERNETES_CLUSTER: DashboardVariable = variable({
  resourceScope: DashboardResourceScope.KubernetesCluster,
});

const HOST: DashboardVariable = variable({
  id: "host",
  name: "host",
  attributeKey: "resource.host.name",
  isMultiSelect: true,
  resourceScope: DashboardResourceScope.Host,
});

function serialized(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

describe("applyToAttributes with a variable that names its kind", () => {
  test('"All" of Kubernetes clusters reads every cluster, not the project', () => {
    const attributes: Record<string, unknown> =
      DashboardVariableInterpolation.applyToAttributes({}, [
        KUBERNETES_CLUSTER,
      ]);

    expect(attributes["resource.k8s.cluster.name"]).toBeInstanceOf(NotNull);
    expect(Object.keys(attributes)).toEqual(["resource.k8s.cluster.name"]);
  });

  test('"All" stays all of the kind with no attributes handed in at all', () => {
    const attributes: Record<string, unknown> =
      DashboardVariableInterpolation.applyToAttributes(undefined, [
        KUBERNETES_CLUSTER,
      ]);

    expect(attributes["resource.k8s.cluster.name"]).toBeInstanceOf(NotNull);
  });

  test("a picked cluster narrows to it", () => {
    const attributes: Record<string, unknown> =
      DashboardVariableInterpolation.applyToAttributes({}, [
        { ...KUBERNETES_CLUSTER, selectedValue: "prod" },
      ]);

    expect(attributes).toEqual({ "resource.k8s.cluster.name": "prod" });
  });

  test('"All" hosts are a host\'s own telemetry: a host name, none of what rules a host out', () => {
    const attributes: Record<string, unknown> =
      DashboardVariableInterpolation.applyToAttributes({}, [HOST]);

    expect(attributes["resource.host.name"]).toBeInstanceOf(NotNull);
    for (const key of [
      "resource.k8s.cluster.name",
      "resource.k8s.node.name",
      "resource.k8s.pod.name",
      "resource.container.runtime",
      "resource.container.id",
      "resource.telemetry.sdk.name",
      "resource.telemetry.sdk.language",
    ]) {
      expect(attributes[key]).toBeInstanceOf(IsNull);
    }
  });

  test("picked hosts narrow to them, still leaving out a Docker host or a pod of the same name", () => {
    const attributes: Record<string, unknown> =
      DashboardVariableInterpolation.applyToAttributes({}, [
        { ...HOST, selectedValues: ["db-01", "db-02"] },
      ]);

    expect(attributes["resource.host.name"]).toBeInstanceOf(Includes);
    expect((attributes["resource.host.name"] as Includes).values).toEqual([
      "db-01",
      "db-02",
    ]);
    expect(attributes["resource.container.runtime"]).toBeInstanceOf(IsNull);
    expect(attributes["resource.telemetry.sdk.name"]).toBeInstanceOf(IsNull);
  });

  test("a filter the widget sets on a key the kind names is the widget's", () => {
    const attributes: Record<string, unknown> =
      DashboardVariableInterpolation.applyToAttributes(
        { "resource.container.runtime": "docker", "http.route": "/orders" },
        [HOST],
      );

    expect(attributes["resource.container.runtime"]).toBe("docker");
    expect(attributes["http.route"]).toBe("/orders");
    expect(attributes["resource.container.id"]).toBeInstanceOf(IsNull);
  });

  test("the variable's own key follows the variable, as it always has", () => {
    const attributes: Record<string, unknown> =
      DashboardVariableInterpolation.applyToAttributes(
        { "resource.k8s.cluster.name": "staging" },
        [KUBERNETES_CLUSTER],
      );

    // "All": the widget's own cluster gives way to every cluster.
    expect(attributes["resource.k8s.cluster.name"]).toBeInstanceOf(NotNull);
  });

  test("the kind of a variable on another key is kept to as well", () => {
    // The XCP-ng pool variable picks by name; a pool is told by its id.
    const pool: DashboardVariable = variable({
      id: "pool",
      name: "pool",
      attributeKey: "resource.xcp_ng.pool.name",
      resourceScope: DashboardResourceScope.XcpNgPool,
    });

    expect(
      serialized(DashboardVariableInterpolation.applyToAttributes({}, [pool])),
    ).toEqual({
      "resource.xcp_ng.pool.id": { _type: "NotNull", value: null },
    });

    expect(
      serialized(
        DashboardVariableInterpolation.applyToAttributes({}, [
          { ...pool, selectedValue: "Lab" },
        ]),
      ),
    ).toEqual({
      "resource.xcp_ng.pool.id": { _type: "NotNull", value: null },
      "resource.xcp_ng.pool.name": "Lab",
    });
  });

  test("a narrowing variable beside the kind's narrows within it", () => {
    const namespace: DashboardVariable = variable({
      id: "ns",
      name: "namespace",
      attributeKey: "resource.k8s.namespace.name",
      isMultiSelect: true,
    });

    const all: Record<string, unknown> =
      DashboardVariableInterpolation.applyToAttributes({}, [
        KUBERNETES_CLUSTER,
        namespace,
      ]);
    expect(Object.keys(all)).toEqual(["resource.k8s.cluster.name"]);

    const picked: Record<string, unknown> =
      DashboardVariableInterpolation.applyToAttributes({}, [
        KUBERNETES_CLUSTER,
        { ...namespace, selectedValues: ["shop"] },
      ]);
    expect(picked["resource.k8s.cluster.name"]).toBeInstanceOf(NotNull);
    expect((picked["resource.k8s.namespace.name"] as Includes).values).toEqual([
      "shop",
    ]);
  });
});

describe("applyToAttributes with variables that name no kind", () => {
  test('"All" still filters nothing', () => {
    const source: Record<string, unknown> = {};

    expect(
      DashboardVariableInterpolation.applyToAttributes(source, [
        variable({ resourceScope: undefined }),
      ]),
    ).toBe(source);
  });

  test("a kind this build does not know scopes nothing", () => {
    const source: Record<string, unknown> = {};

    expect(
      DashboardVariableInterpolation.applyToAttributes(source, [
        variable({
          resourceScope: "MainframeLpar" as unknown as DashboardResourceScope,
        }),
      ]),
    ).toBe(source);
  });

  test("only a Telemetry Attribute variable has a kind", () => {
    expect(
      DashboardVariableInterpolation.getResourceScope(
        variable({
          type: DashboardVariableType.CustomList,
          resourceScope: DashboardResourceScope.Host,
        }),
      ),
    ).toBeUndefined();
    expect(
      DashboardVariableInterpolation.getResourceScope(KUBERNETES_CLUSTER),
    ).toBe(DashboardResourceScope.KubernetesCluster);
  });
});

describe("applyToQueryConfig with a variable that names its kind", () => {
  function chartQuery(metricName: string): MetricQueryConfigData {
    return {
      metricAliasData: {
        metricVariable: "a",
        title: undefined,
        description: undefined,
        legend: undefined,
        legendUnit: undefined,
      },
      metricQueryData: {
        filterData: {
          metricName: metricName,
          aggegationType: "Avg",
        } as unknown as MetricQueryConfigData["metricQueryData"]["filterData"],
      },
    } as unknown as MetricQueryConfigData;
  }

  test("a Hosts tile reads a host's own system.* metrics only", () => {
    const query: MetricQueryConfigData =
      DashboardVariableInterpolation.applyToQueryConfig(
        chartQuery("system.cpu.utilization"),
        [HOST],
      );

    const attributes: Record<string, unknown> = query.metricQueryData.filterData
      .attributes as unknown as Record<string, unknown>;

    expect(attributes["resource.host.name"]).toBeInstanceOf(NotNull);
    expect(attributes["resource.k8s.cluster.name"]).toBeInstanceOf(IsNull);
  });

  test("a chart's fallback reads the same kind", () => {
    const withFallback: MetricQueryConfigData = {
      ...chartQuery("k8s.container.restarts.increase"),
      fallback: { queryConfig: chartQuery("k8s.container.restarts") },
    } as unknown as MetricQueryConfigData;

    const query: MetricQueryConfigData =
      DashboardVariableInterpolation.applyToQueryConfig(withFallback, [
        KUBERNETES_CLUSTER,
      ]);

    const fallbackAttributes: Record<string, unknown> = query.fallback!
      .queryConfig!.metricQueryData.filterData.attributes as unknown as Record<
      string,
      unknown
    >;
    expect(fallbackAttributes["resource.k8s.cluster.name"]).toBeInstanceOf(
      NotNull,
    );
  });
});
