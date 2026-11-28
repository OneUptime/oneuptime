import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import DashboardBaseComponent from "../../../Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import {
  DashboardResourceScope,
  getDashboardResourceScopeAttributes,
} from "../../../Types/Dashboard/DashboardResourceScope";
import {
  DashboardTemplate,
  DashboardTemplateType,
  DashboardTemplates,
  getTemplateConfig,
} from "../../../Types/Dashboard/DashboardTemplates";
import DashboardVariable, {
  DashboardVariableType,
} from "../../../Types/Dashboard/DashboardVariable";
import DashboardViewConfig from "../../../Types/Dashboard/DashboardViewConfig";
import { describe, expect, test } from "@jest/globals";

/*
 * Every infrastructure template's own variable names the kind of resource
 * it picks among (issue #11258), so its board reads that kind's telemetry
 * and nothing else - with nothing picked as with a pick. Templates that are
 * not one kind of resource's name none.
 */

const EXPECTED: Record<string, DashboardResourceScope | null> = {
  [DashboardTemplateType.Kubernetes]: DashboardResourceScope.KubernetesCluster,
  [DashboardTemplateType.KubernetesCost]:
    DashboardResourceScope.KubernetesCluster,
  [DashboardTemplateType.Host]: DashboardResourceScope.Host,
  [DashboardTemplateType.Proxmox]: DashboardResourceScope.ProxmoxCluster,
  [DashboardTemplateType.VMware]: DashboardResourceScope.VMwareVCenter,
  [DashboardTemplateType.XcpNg]: DashboardResourceScope.XcpNgPool,
  [DashboardTemplateType.OpenStack]: DashboardResourceScope.OpenStackCloud,
  [DashboardTemplateType.Ceph]: DashboardResourceScope.CephCluster,
  [DashboardTemplateType.StorageArray]: DashboardResourceScope.StorageArray,
  [DashboardTemplateType.DockerSwarm]:
    DashboardResourceScope.DockerSwarmCluster,
  // The project-wide and OneUptime's own data: no one kind of resource.
  [DashboardTemplateType.Monitor]: null,
  [DashboardTemplateType.Incident]: null,
  [DashboardTemplateType.Alert]: null,
  [DashboardTemplateType.Metrics]: null,
  [DashboardTemplateType.Rum]: null,
  [DashboardTemplateType.Slo]: null,
  [DashboardTemplateType.Network]: null,
};

function scopedVariables(
  config: DashboardViewConfig,
): Array<DashboardVariable> {
  return (config.variables || []).filter((variable: DashboardVariable) => {
    return Boolean(variable.resourceScope);
  });
}

describe("each template's resource kind", () => {
  test("every template is listed here", () => {
    for (const template of DashboardTemplates as Array<DashboardTemplate>) {
      if (template.type === DashboardTemplateType.Blank) {
        continue;
      }
      expect(Object.keys(EXPECTED)).toContain(template.type);
    }
  });

  test.each(Object.entries(EXPECTED))(
    "%s: its own variable names %s",
    (type: string, scope: DashboardResourceScope | null) => {
      const config: DashboardViewConfig = getTemplateConfig(
        type as DashboardTemplateType,
      )!;
      const scoped: Array<DashboardVariable> = scopedVariables(config);

      if (!scope) {
        expect(scoped).toEqual([]);
        return;
      }

      // One variable names the kind; any other narrows within it.
      expect(scoped).toHaveLength(1);
      expect(scoped[0]!.resourceScope).toBe(scope);
      expect(scoped[0]!.type).toBe(DashboardVariableType.TelemetryAttribute);

      /*
       * The kind is the variable's own: its attribute is the kind's
       * identity - or, for XCP-ng, the pool's name, the pool being its id.
       */
      const scopeKeys: Array<string> = Object.keys(
        getDashboardResourceScopeAttributes(scope),
      );
      if (type === DashboardTemplateType.XcpNg) {
        expect(scoped[0]!.attributeKey).toBe("resource.xcp_ng.pool.name");
        expect(scopeKeys[0]).toBe("resource.xcp_ng.pool.id");
      } else {
        expect(scopeKeys[0]).toBe(scoped[0]!.attributeKey);
      }
    },
  );

  test("a namespace or region narrows within the kind and names none", () => {
    const kubernetes: DashboardViewConfig = getTemplateConfig(
      DashboardTemplateType.Kubernetes,
    )!;
    const namespace: DashboardVariable | undefined = (
      kubernetes.variables || []
    ).find((variable: DashboardVariable) => {
      return variable.name === "namespace";
    });
    expect(namespace!.resourceScope).toBeUndefined();

    const openStack: DashboardViewConfig = getTemplateConfig(
      DashboardTemplateType.OpenStack,
    )!;
    const region: DashboardVariable | undefined = (
      openStack.variables || []
    ).find((variable: DashboardVariable) => {
      return variable.name === "region";
    });
    expect(region!.resourceScope).toBeUndefined();
  });
});

describe("the Monitor template", () => {
  test("has no log stream: monitors write no logs, so it only ever read the whole project", () => {
    const config: DashboardViewConfig = getTemplateConfig(
      DashboardTemplateType.Monitor,
    )!;

    expect(
      config.components.some((component: DashboardBaseComponent) => {
        return component.componentType === DashboardComponentType.LogStream;
      }),
    ).toBe(false);
  });

  test("gives the response time table the row the stream had", () => {
    const config: DashboardViewConfig = getTemplateConfig(
      DashboardTemplateType.Monitor,
    )!;
    const table: DashboardBaseComponent | undefined = config.components.find(
      (component: DashboardBaseComponent) => {
        return component.componentType === DashboardComponentType.Table;
      },
    );

    expect(table!.widthInDashboardUnits).toBe(12);
    expect(table!.leftInDashboardUnits).toBe(0);
  });
});

describe("the Hosts template's charts by host", () => {
  test("group by the key its Host variable names hosts by: a resource attribute's stored key, which every host's row carries", () => {
    const config: DashboardViewConfig = getTemplateConfig(
      DashboardTemplateType.Host,
    )!;
    const hostKey: string | undefined = (config.variables || []).find(
      (variable: DashboardVariable) => {
        return variable.name === "host";
      },
    )?.attributeKey;

    expect(hostKey).toBe("resource.host.name");

    const groupings: Array<Array<string>> = config.components.flatMap(
      (component: DashboardBaseComponent): Array<Array<string>> => {
        const args: {
          metricQueryConfig?: {
            metricQueryData?: { groupByAttributeKeys?: Array<string> };
          };
        } = (component.arguments || {}) as unknown as {
          metricQueryConfig?: {
            metricQueryData?: { groupByAttributeKeys?: Array<string> };
          };
        };
        const keys: Array<string> =
          args.metricQueryConfig?.metricQueryData?.groupByAttributeKeys || [];

        return keys.length > 0 ? [keys] : [];
      },
    );

    // Every "by Host" chart, never a bare host.name that no row carries.
    expect(groupings.length).toBeGreaterThanOrEqual(6);

    for (const keys of groupings) {
      expect(keys).toEqual([hostKey]);
    }
  });
});
