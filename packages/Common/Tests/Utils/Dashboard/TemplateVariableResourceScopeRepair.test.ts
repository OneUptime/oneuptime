import { DashboardResourceScope } from "../../../Types/Dashboard/DashboardResourceScope";
import {
  DashboardTemplateType,
  getTemplateConfig,
} from "../../../Types/Dashboard/DashboardTemplates";
import { DashboardVariableType } from "../../../Types/Dashboard/DashboardVariable";
import DashboardViewConfig from "../../../Types/Dashboard/DashboardViewConfig";
import { JSONObject } from "../../../Types/JSON";
import TemplateVariableResourceScopeRepair, {
  ScopedTemplateVariableSignature,
  TemplateVariableResourceScopeRepairResult,
} from "../../../Utils/Dashboard/TemplateVariableResourceScopeRepair";
import { describe, expect, test } from "@jest/globals";

/*
 * A dashboard made from an infrastructure template before its variable
 * named a kind of resource gets the kind the template now ships it with
 * (issue #11258) - and nothing else is touched, nor any board that is not
 * the template's.
 */

// A template's board as an earlier release made it: no variable names a kind.
function boardMadeBefore(type: DashboardTemplateType): JSONObject {
  const config: DashboardViewConfig = getTemplateConfig(type)!;
  const stored: JSONObject = JSON.parse(JSON.stringify(config));

  for (const variable of (stored["variables"] || []) as Array<JSONObject>) {
    delete variable["resourceScope"];
  }

  return stored;
}

function scopesOf(config: JSONObject): Array<unknown> {
  return ((config["variables"] || []) as Array<JSONObject>).map(
    (variable: JSONObject): unknown => {
      return variable["resourceScope"];
    },
  );
}

const SCOPED_TEMPLATES: Array<[DashboardTemplateType, DashboardResourceScope]> =
  [
    [
      DashboardTemplateType.Kubernetes,
      DashboardResourceScope.KubernetesCluster,
    ],
    [
      DashboardTemplateType.KubernetesCost,
      DashboardResourceScope.KubernetesCluster,
    ],
    [DashboardTemplateType.Host, DashboardResourceScope.Host],
    [DashboardTemplateType.Proxmox, DashboardResourceScope.ProxmoxCluster],
    [DashboardTemplateType.OpenStack, DashboardResourceScope.OpenStackCloud],
    [DashboardTemplateType.VMware, DashboardResourceScope.VMwareVCenter],
    [DashboardTemplateType.XcpNg, DashboardResourceScope.XcpNgPool],
    [
      DashboardTemplateType.DockerSwarm,
      DashboardResourceScope.DockerSwarmCluster,
    ],
    [DashboardTemplateType.Ceph, DashboardResourceScope.CephCluster],
    [DashboardTemplateType.StorageArray, DashboardResourceScope.StorageArray],
  ];

describe("TemplateVariableResourceScopeRepair.repair", () => {
  test.each(SCOPED_TEMPLATES)(
    "a %s board made before names its variable's kind, %s, as the template now does",
    (type: DashboardTemplateType, scope: DashboardResourceScope) => {
      const stored: JSONObject = boardMadeBefore(type);
      const result: TemplateVariableResourceScopeRepairResult | null =
        TemplateVariableResourceScopeRepair.repair(stored);

      expect(result).not.toBeNull();
      expect(result!.scopedVariableCount).toBe(1);
      expect(scopesOf(result!.config)).toEqual(
        scopesOf(
          JSON.parse(JSON.stringify(getTemplateConfig(type))) as JSONObject,
        ),
      );
      expect(scopesOf(result!.config)).toContain(scope);
    },
  );

  test("only the variable is named: picks, labels and every widget stay as they were", () => {
    const stored: JSONObject = boardMadeBefore(DashboardTemplateType.Host);
    const variables: Array<JSONObject> = stored[
      "variables"
    ] as Array<JSONObject>;
    variables[0]!["selectedValues"] = ["db-01"];
    variables[0]!["label"] = "Server";

    const result: TemplateVariableResourceScopeRepairResult =
      TemplateVariableResourceScopeRepair.repair(stored)!;

    const repaired: JSONObject = JSON.parse(JSON.stringify(result.config));
    delete (repaired["variables"] as Array<JSONObject>)[0]!["resourceScope"];
    expect(repaired).toEqual(stored);
    expect(
      (result.config["variables"] as Array<JSONObject>)[0]!["selectedValues"],
    ).toEqual(["db-01"]);
  });

  test("a board that lost all the template's widgets is not the template's", () => {
    const stored: JSONObject = boardMadeBefore(
      DashboardTemplateType.DockerSwarm,
    );
    stored["components"] = [];

    expect(TemplateVariableResourceScopeRepair.repair(stored)).toBeNull();
  });

  test("a board of someone's own with a variable named like the template's is left alone", () => {
    const stored: JSONObject = {
      _type: "DashboardViewConfig",
      heightInDashboardUnits: 10,
      components: [
        {
          componentType: "Chart",
          arguments: {
            chartTitle: "Docker CPU",
            metricQueryConfig: {
              metricQueryData: {
                filterData: { metricName: "container.cpu.utilization" },
              },
            },
          },
        },
      ],
      variables: [
        {
          id: "v",
          name: "cluster",
          type: DashboardVariableType.TelemetryAttribute,
          attributeKey: "resource.k8s.cluster.name",
        },
      ],
    };

    expect(TemplateVariableResourceScopeRepair.repair(stored)).toBeNull();
  });

  test("a template widget renamed or set to another metric no longer proves the board", () => {
    const stored: JSONObject = boardMadeBefore(
      DashboardTemplateType.DockerSwarm,
    );

    for (const component of stored["components"] as Array<JSONObject>) {
      const args: JSONObject = (component["arguments"] || {}) as JSONObject;
      for (const key of ["title", "chartTitle", "gaugeTitle", "tableTitle"]) {
        if (typeof args[key] === "string") {
          args[key] = `${args[key] as string} (mine)`;
        }
      }
    }

    expect(TemplateVariableResourceScopeRepair.repair(stored)).toBeNull();
  });

  test("a variable that already names a kind keeps it, so a second run changes nothing", () => {
    const stored: JSONObject = boardMadeBefore(
      DashboardTemplateType.Kubernetes,
    );
    const once: TemplateVariableResourceScopeRepairResult =
      TemplateVariableResourceScopeRepair.repair(stored)!;

    expect(TemplateVariableResourceScopeRepair.repair(once.config)).toBeNull();

    const chosen: JSONObject = boardMadeBefore(
      DashboardTemplateType.Kubernetes,
    );
    (chosen["variables"] as Array<JSONObject>)[0]!["resourceScope"] =
      DashboardResourceScope.Host;
    expect(TemplateVariableResourceScopeRepair.repair(chosen)).toBeNull();
  });

  test("a variable the user renamed or rebound is theirs", () => {
    const renamed: JSONObject = boardMadeBefore(
      DashboardTemplateType.Kubernetes,
    );
    (renamed["variables"] as Array<JSONObject>)[0]!["name"] = "k8s";
    // Its namespace variable names no kind in the template either.
    expect(TemplateVariableResourceScopeRepair.repair(renamed)).toBeNull();

    const rebound: JSONObject = boardMadeBefore(
      DashboardTemplateType.Kubernetes,
    );
    (rebound["variables"] as Array<JSONObject>)[0]!["attributeKey"] =
      "resource.k8s.namespace.name";
    expect(TemplateVariableResourceScopeRepair.repair(rebound)).toBeNull();
  });

  test("never changes what it is handed", () => {
    const stored: JSONObject = boardMadeBefore(DashboardTemplateType.Host);
    const before: string = JSON.stringify(stored);

    TemplateVariableResourceScopeRepair.repair(stored);

    expect(JSON.stringify(stored)).toBe(before);
  });

  test("reads nothing it cannot: no config, no components, no variables", () => {
    expect(TemplateVariableResourceScopeRepair.repair(undefined)).toBeNull();
    expect(TemplateVariableResourceScopeRepair.repair("text")).toBeNull();
    expect(
      TemplateVariableResourceScopeRepair.repair({ components: [] }),
    ).toBeNull();
    expect(
      TemplateVariableResourceScopeRepair.repair({ variables: [] }),
    ).toBeNull();
  });

  test("a Monitor or Metrics board names no kind: those templates are not one kind's", () => {
    for (const type of [
      DashboardTemplateType.Monitor,
      DashboardTemplateType.Metrics,
      DashboardTemplateType.Rum,
      DashboardTemplateType.Network,
      DashboardTemplateType.Slo,
    ]) {
      expect(
        TemplateVariableResourceScopeRepair.repair(boardMadeBefore(type)),
      ).toBeNull();
    }
  });
});

describe("TemplateVariableResourceScopeRepair's candidates", () => {
  test("one signature per template variable, Kubernetes and its Cost board sharing theirs", () => {
    const signatures: Array<ScopedTemplateVariableSignature> =
      TemplateVariableResourceScopeRepair.getScopedTemplateVariables();

    expect(
      signatures.map((signature: ScopedTemplateVariableSignature) => {
        return `${signature.name}|${signature.attributeKey}|${signature.resourceScope}`;
      }),
    ).toEqual([
      "cluster|resource.k8s.cluster.name|KubernetesCluster",
      "host|resource.host.name|Host",
      "cluster|resource.proxmox.cluster.name|ProxmoxCluster",
      "vcenter|resource.vmware.vcenter.name|VMwareVCenter",
      "pool|resource.xcp_ng.pool.name|XcpNgPool",
      "cloud|resource.openstack.cloud.name|OpenStackCloud",
      "cluster|resource.ceph.cluster.name|CephCluster",
      "array|resource.storage.array.name|StorageArray",
      "cluster|resource.docker.swarm.cluster.name|DockerSwarmCluster",
    ]);
  });

  test("each is found by jsonb containment of the variable alone", () => {
    expect(
      TemplateVariableResourceScopeRepair.getContainment({
        name: "host",
        attributeKey: "resource.host.name",
        resourceScope: DashboardResourceScope.Host,
      }),
    ).toEqual({
      variables: [
        {
          type: DashboardVariableType.TelemetryAttribute,
          name: "host",
          attributeKey: "resource.host.name",
        },
      ],
    });
  });
});
