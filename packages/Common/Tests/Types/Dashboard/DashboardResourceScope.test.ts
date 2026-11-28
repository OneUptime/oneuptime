import IsNull from "../../../Types/BaseDatabase/IsNull";
import NotNull from "../../../Types/BaseDatabase/NotNull";
import {
  DASHBOARD_RESOURCE_SCOPES,
  DashboardResourceScope,
  getDashboardResourceScopeAttributes,
  getDashboardResourceScopeIdentityKey,
  isDashboardResourceScope,
} from "../../../Types/Dashboard/DashboardResourceScope";
import { NOT_A_HOST_RESOURCE_ATTRIBUTE_KEYS } from "../../../Utils/Telemetry/HostResource";
import { describe, expect, test } from "@jest/globals";

/*
 * What each kind of resource a dashboard variable picks among reads
 * (issue #11258): its identity present, and for hosts, none of what rules
 * a host out - the rule the ingest registers a Host by (#11257).
 */

describe("DashboardResourceScope", () => {
  test("every kind is a name this build knows, and nothing else is", () => {
    for (const scope of DASHBOARD_RESOURCE_SCOPES) {
      expect(isDashboardResourceScope(scope)).toBe(true);
    }

    for (const value of [
      undefined,
      null,
      "",
      "Kubernetes",
      "host",
      42,
      {},
      "__proto__",
    ]) {
      expect(isDashboardResourceScope(value)).toBe(false);
    }
  });

  test.each([
    [DashboardResourceScope.KubernetesCluster, "resource.k8s.cluster.name"],
    [DashboardResourceScope.Host, "resource.host.name"],
    [
      DashboardResourceScope.DockerSwarmCluster,
      "resource.docker.swarm.cluster.name",
    ],
    [DashboardResourceScope.ProxmoxCluster, "resource.proxmox.cluster.name"],
    [DashboardResourceScope.OpenStackCloud, "resource.openstack.cloud.name"],
    [DashboardResourceScope.VMwareVCenter, "resource.vmware.vcenter.name"],
    [DashboardResourceScope.XcpNgPool, "resource.xcp_ng.pool.id"],
    [DashboardResourceScope.CephCluster, "resource.ceph.cluster.name"],
    [DashboardResourceScope.StorageArray, "resource.storage.array.name"],
  ])(
    "%s is told by %s being there",
    (scope: DashboardResourceScope, identityKey: string) => {
      expect(getDashboardResourceScopeIdentityKey(scope)).toBe(identityKey);

      const attributes: Record<string, IsNull | NotNull> =
        getDashboardResourceScopeAttributes(scope);

      expect(attributes[identityKey]).toBeInstanceOf(NotNull);
    },
  );

  test("only hosts are also told by what they lack", () => {
    for (const scope of DASHBOARD_RESOURCE_SCOPES) {
      const attributes: Record<string, IsNull | NotNull> =
        getDashboardResourceScopeAttributes(scope);

      if (scope === DashboardResourceScope.Host) {
        expect(Object.keys(attributes)).toEqual([
          "resource.host.name",
          ...NOT_A_HOST_RESOURCE_ATTRIBUTE_KEYS.map((key: string) => {
            return `resource.${key}`;
          }),
        ]);

        for (const key of NOT_A_HOST_RESOURCE_ATTRIBUTE_KEYS) {
          expect(attributes[`resource.${key}`]).toBeInstanceOf(IsNull);
        }
        continue;
      }

      expect(Object.keys(attributes)).toHaveLength(1);
    }
  });

  test("hosts leave out Kubernetes, container engines, containers and apps' SDKs", () => {
    const attributes: Record<string, IsNull | NotNull> =
      getDashboardResourceScopeAttributes(DashboardResourceScope.Host);

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

  test("hands out fresh operators each time", () => {
    const first: Record<string, IsNull | NotNull> =
      getDashboardResourceScopeAttributes(DashboardResourceScope.Host);
    const second: Record<string, IsNull | NotNull> =
      getDashboardResourceScopeAttributes(DashboardResourceScope.Host);

    expect(first).not.toBe(second);
    expect(first["resource.host.name"]).not.toBe(second["resource.host.name"]);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  test("its operators travel as the serialized shape the servers read", () => {
    expect(
      JSON.parse(
        JSON.stringify(
          getDashboardResourceScopeAttributes(
            DashboardResourceScope.KubernetesCluster,
          ),
        ),
      ),
    ).toEqual({
      "resource.k8s.cluster.name": { _type: "NotNull", value: null },
    });
  });
});
