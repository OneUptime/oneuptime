import { describe, expect, test } from "@jest/globals";
import {
  EVENT_OVERLAY_SCOPE_QUERY_LIMIT,
  EventOverlayScope,
  getEventOverlayScope,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/EventOverlayScope";
import EqualTo from "../../../Types/BaseDatabase/EqualTo";
import Includes from "../../../Types/BaseDatabase/Includes";
import IncludesNone from "../../../Types/BaseDatabase/IncludesNone";
import NotEqual from "../../../Types/BaseDatabase/NotEqual";
import Search from "../../../Types/BaseDatabase/Search";
import Wildcard from "../../../Types/BaseDatabase/Wildcard";
import ObjectID from "../../../Types/ObjectID";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import ServiceType from "../../../Types/Telemetry/ServiceType";

const RESOURCE_A: string = "11111111-1111-4111-8111-111111111111";
const RESOURCE_B: string = "22222222-2222-4222-8222-222222222222";

function config(
  attributes: Record<string, unknown> = {},
): MetricQueryConfigData {
  return {
    metricQueryData: { filterData: { metricName: "cpu", attributes } },
  } as MetricQueryConfigData;
}

function scope(attributes: Record<string, unknown>): EventOverlayScope {
  return getEventOverlayScope([config(attributes)]);
}

function expectSuppressed(result: EventOverlayScope): void {
  expect(result.incidentQueries).toEqual([]);
  expect(result.alertQueries).toEqual([]);
}

const ID_RELATIONS: Array<[string, string]> = [
  ["monitorId", "monitors"],
  ["monitorIds", "monitors"],
  ["sloId", "serviceLevelObjectives"],
  ["serviceLevelObjectiveId", "serviceLevelObjectives"],
  ["serviceLevelObjectiveIds", "serviceLevelObjectives"],
  ["hostId", "hosts"],
  ["hostIds", "hosts"],
  ["dockerHostId", "dockerHosts"],
  ["dockerHostIds", "dockerHosts"],
  ["podmanHostId", "podmanHosts"],
  ["podmanHostIds", "podmanHosts"],
  ["kubernetesClusterId", "kubernetesClusters"],
  ["kubernetesClusterIds", "kubernetesClusters"],
  ["kubernetesResourceId", "kubernetesResources"],
  ["kubernetesResourceIds", "kubernetesResources"],
  ["kubernetesContainerId", "kubernetesContainers"],
  ["kubernetesContainerIds", "kubernetesContainers"],
  ["dockerResourceId", "dockerResources"],
  ["dockerResourceIds", "dockerResources"],
  ["podmanResourceId", "podmanResources"],
  ["podmanResourceIds", "podmanResources"],
  ["proxmoxClusterId", "proxmoxClusters"],
  ["proxmoxClusterIds", "proxmoxClusters"],
  ["vmwareVCenterId", "vmwareVCenters"],
  ["vmwareVCenterIds", "vmwareVCenters"],
  ["cephClusterId", "cephClusters"],
  ["cephClusterIds", "cephClusters"],
  ["dockerSwarmClusterId", "dockerSwarmClusters"],
  ["dockerSwarmClusterIds", "dockerSwarmClusters"],
  ["iotFleetId", "iotFleets"],
  ["iotFleetIds", "iotFleets"],
  ["databaseServerId", "databaseServers"],
  ["databaseServerIds", "databaseServers"],
  ["serviceId", "services"],
  ["serviceIds", "services"],
  ["services", "services"],
];

const NAME_RELATIONS: Array<[string, string, string]> = [
  ["host.name", "hosts", "hostIdentifier"],
  ["oneuptime.host.name", "hosts", "hostIdentifier"],
  ["oneuptime.docker.host.name", "dockerHosts", "hostIdentifier"],
  ["oneuptime.podman.host.name", "podmanHosts", "hostIdentifier"],
  ["k8s.cluster.name", "kubernetesClusters", "clusterIdentifier"],
  [
    "oneuptime.kubernetes.cluster.name",
    "kubernetesClusters",
    "clusterIdentifier",
  ],
  ["proxmox.cluster.name", "proxmoxClusters", "name"],
  ["vmware.vcenter.name", "vmwareVCenters", "name"],
  ["ceph.cluster.name", "cephClusters", "name"],
  ["docker.swarm.cluster.name", "dockerSwarmClusters", "name"],
  ["iot.fleet.name", "iotFleets", "name"],
  // Not oneuptime.database.server.name: see "database overlays match by id".
  ["service.name", "services", "name"],
  ["oneuptime.service.name", "services", "name"],
];

describe("event overlay resource scope", () => {
  test.each(ID_RELATIONS)(
    "filters both event types by %s",
    (key: string, relation: string) => {
      const result: EventOverlayScope = scope({ [key]: RESOURCE_A });
      expect(result.incidentQueries).toEqual([
        { [relation]: { _id: RESOURCE_A } },
      ]);
      expect(result.alertQueries).toEqual([
        relation === "monitors"
          ? { monitorId: RESOURCE_A }
          : { [relation]: { _id: RESOURCE_A } },
      ]);
      expect(result.changeEventQueries).toEqual([
        relation === "services"
          ? { primaryEntityId: RESOURCE_A }
          : { attributes: { [key]: RESOURCE_A } },
      ]);
    },
  );

  test.each(ID_RELATIONS)(
    "expands %s memberships without dropping the scope",
    (key: string, relation: string) => {
      const result: EventOverlayScope = scope({
        [key]: new Includes([RESOURCE_B, RESOURCE_A, RESOURCE_A]),
      });
      expect(result.incidentQueries).toEqual([
        { [relation]: { _id: RESOURCE_A } },
        { [relation]: { _id: RESOURCE_B } },
      ]);
      expect(result.alertQueries).toEqual(
        relation === "monitors"
          ? [{ monitorId: RESOURCE_A }, { monitorId: RESOURCE_B }]
          : [
              { [relation]: { _id: RESOURCE_A } },
              { [relation]: { _id: RESOURCE_B } },
            ],
      );
    },
  );

  for (const prefix of ["", "resource."]) {
    test.each(NAME_RELATIONS)(
      `maps ${prefix}%s to its exact resource relation`,
      (key: string, relation: string, column: string) => {
        const result: EventOverlayScope = scope({
          [`${prefix}${key}`]: "production",
        });
        expect(result.incidentQueries).toEqual([
          { [relation]: { [column]: "production" } },
        ]);
        expect(result.alertQueries).toEqual(result.incidentQueries);
        expect(result.changeEventQueries).toEqual([
          { attributes: { [`${prefix}${key}`]: "production" } },
        ]);
      },
    );

    test.each([
      ["oneuptime.host.id", "hosts"],
      ["oneuptime.docker.host.id", "dockerHosts"],
      ["oneuptime.podman.host.id", "podmanHosts"],
      ["oneuptime.kubernetes.cluster.id", "kubernetesClusters"],
      ["oneuptime.database.server.id", "databaseServers"],
      ["oneuptime.service.id", "services"],
    ])(`uses stamped ${prefix}%s ids`, (key: string, relation: string) => {
      expect(
        scope({ [`${prefix}${key}`]: RESOURCE_A }).incidentQueries,
      ).toEqual([{ [relation]: { _id: RESOURCE_A } }]);
    });
  }

  test.each(["monitorIds", "serviceLevelObjectiveIds"])(
    "recognizes the generated %s Search(UUID) metric filter",
    (key: string) => {
      expect(scope({ [key]: new Search(RESOURCE_A) })).toEqual(
        scope({ [key]: RESOURCE_A }),
      );
      expect(scope({ [key]: new Search(RESOURCE_A).toJSON() })).toEqual(
        scope({ [key]: RESOURCE_A }),
      );
      expectSuppressed(scope({ [key]: new Search(RESOURCE_A.slice(0, 8)) }));
    },
  );

  test("accepts equality, ObjectID and serialized membership values", () => {
    expect(scope({ monitorId: new ObjectID(RESOURCE_A) })).toEqual(
      scope({ monitorId: RESOURCE_A }),
    );
    expect(scope({ monitorId: new EqualTo(RESOURCE_A) })).toEqual(
      scope({ monitorId: RESOURCE_A }),
    );
    expect(
      scope({ monitorId: new Includes([RESOURCE_A, RESOURCE_B]).toJSON() }),
    ).toEqual(scope({ monitorId: [RESOURCE_A, RESOURCE_B] }));
    expect(
      scope({ "resource.host.name": new EqualTo("production").toJSON() }),
    ).toEqual(scope({ "resource.host.name": "production" }));
  });

  test.each([
    undefined,
    null,
    "",
    "   ",
    "not-a-uuid",
    new Includes([]),
    new NotEqual(RESOURCE_A),
    new IncludesNone([RESOURCE_A]),
    new Search("prod"),
    new Wildcard(["prod*"]),
  ])(
    "fails closed for invalid or non-exact resource identity %p",
    (value: unknown) => {
      const result: EventOverlayScope = scope({ monitorId: value });
      expectSuppressed(result);
      expect(result.changeEventQueries).toEqual([]);
    },
  );

  test.each([
    new Search("prod"),
    new NotEqual("prod"),
    new IncludesNone(["prod"]),
    new Wildcard(["prod*"]),
    new Includes([]),
    "",
    null,
  ])("does not broaden a resource name filter %p", (value: unknown) => {
    expectSuppressed(scope({ "resource.host.name": value }));
  });

  test("keeps names with quotes or punctuation as plain predicate values", () => {
    const name: string = "host' OR 1=1 -- / East";
    expect(scope({ "resource.host.name": name }).incidentQueries).toEqual([
      { hosts: { hostIdentifier: name } },
    ]);
  });

  test.each([
    [ServiceType.Monitor, "monitors"],
    [ServiceType.ServiceLevelObjective, "serviceLevelObjectives"],
    [ServiceType.Host, "hosts"],
    [ServiceType.DockerHost, "dockerHosts"],
    [ServiceType.PodmanHost, "podmanHosts"],
    [ServiceType.KubernetesCluster, "kubernetesClusters"],
    [ServiceType.ProxmoxCluster, "proxmoxClusters"],
    [ServiceType.VMwareVCenter, "vmwareVCenters"],
    [ServiceType.CephCluster, "cephClusters"],
    [ServiceType.DockerSwarmCluster, "dockerSwarmClusters"],
    [ServiceType.IoTDevice, "iotFleets"],
    [ServiceType.DatabaseServer, "databaseServers"],
    [ServiceType.OpenTelemetry, "services"],
  ])(
    "scopes polymorphic primaryEntityId of type %s",
    (type: ServiceType, relation: string) => {
      const result: EventOverlayScope = scope({
        primaryEntityId: RESOURCE_A,
        primaryEntityType: type,
      });
      expect(result.incidentQueries).toEqual([
        { [relation]: { _id: RESOURCE_A } },
      ]);
      expect(result.alertQueries).toEqual([
        type === ServiceType.Monitor
          ? { monitorId: RESOURCE_A }
          : { [relation]: { _id: RESOURCE_A } },
      ]);
      expect(result.changeEventQueries).toEqual(
        type === ServiceType.OpenTelemetry
          ? [{ primaryEntityId: RESOURCE_A }]
          : [],
      );
    },
  );

  test.each([
    ServiceType.NetworkDevice,
    ServiceType.ServerlessFunction,
    ServiceType.CloudResource,
    ServiceType.RealUserMonitor,
    ServiceType.Unknown,
    ServiceType.ScheduledMaintenance,
    undefined,
  ])(
    "does not treat primary type %s as a telemetry Service",
    (type: ServiceType | undefined) => {
      const result: EventOverlayScope = scope({
        primaryEntityId: RESOURCE_A,
        primaryEntityType: type,
      });
      expectSuppressed(result);
      expect(result.changeEventQueries).toEqual([]);
    },
  );

  test.each([
    "networkDeviceId",
    "serverlessFunctionId",
    "cloudResourceId",
    "rumApplicationId",
    "iotDeviceId",
    "entityIds",
    "entityKeys",
    "monitorGroupId",
  ])(
    "does not load unrelated incidents for unsupported %s scope",
    (key: string) => {
      expectSuppressed(scope({ [key]: RESOURCE_A }));
      expectSuppressed(
        scope({ [key]: RESOURCE_A, "resource.host.name": "prod" }),
      );
    },
  );

  test("reads analytics identity fields alongside the attribute filter grammar", () => {
    const query: MetricQueryConfigData = config();
    Object.assign(query.metricQueryData.filterData, {
      primaryEntityId: RESOURCE_A,
      primaryEntityType: ServiceType.Monitor,
    });
    expect(getEventOverlayScope([query]).incidentQueries).toEqual([
      { monitors: { _id: RESOURCE_A } },
    ]);
  });

  test("shows only the requested incident or alert for event-id metrics", () => {
    expect(scope({ incidentId: RESOURCE_A }).incidentQueries).toEqual([
      { _id: RESOURCE_A },
    ]);
    expect(scope({ incidentId: RESOURCE_A }).alertQueries).toEqual([]);
    expect(scope({ alertId: RESOURCE_A }).alertQueries).toEqual([
      { _id: RESOURCE_A },
    ]);
    expect(scope({ alertId: RESOURCE_A }).incidentQueries).toEqual([]);
    expect(
      scope({
        primaryEntityId: RESOURCE_A,
        primaryEntityType: ServiceType.Incident,
      }).incidentQueries,
    ).toEqual([{ _id: RESOURCE_A }]);
    expect(
      scope({
        primaryEntityId: RESOURCE_A,
        primaryEntityType: ServiceType.Alert,
      }).alertQueries,
    ).toEqual([{ _id: RESOURCE_A }]);
  });

  test("keeps multiple resource dimensions conjunctive", () => {
    const result: EventOverlayScope = scope({
      monitorId: RESOURCE_A,
      "resource.host.name": "prod",
      "resource.service.name": "api",
    });
    expect(result.incidentQueries).toEqual([
      {
        monitors: { _id: RESOURCE_A },
        hosts: { hostIdentifier: "prod" },
        services: { name: "api" },
      },
    ]);
    expect(result.alertQueries).toEqual([
      {
        monitorId: RESOURCE_A,
        hosts: { hostIdentifier: "prod" },
        services: { name: "api" },
      },
    ]);
  });

  test("keeps an exact service namespace", () => {
    expect(
      scope({
        "resource.service.name": "api",
        "resource.service.namespace": "prod",
      }).incidentQueries,
    ).toEqual([{ services: { name: "api", serviceNamespace: "prod" } }]);
  });

  test.each([
    ["docker", "dockerHosts"],
    ["podman", "podmanHosts"],
  ])(
    "uses %s host identity without linking ordinary Hosts",
    (runtime: string, relation: string) => {
      expect(
        scope({
          "resource.host.name": "prod",
          "resource.container.runtime": runtime,
        }).incidentQueries,
      ).toEqual([{ [relation]: { hostIdentifier: "prod" } }]);
    },
  );

  test.each([
    ["docker", "dockerResources", "dockerHosts"],
    ["podman", "podmanResources", "podmanHosts"],
  ])(
    "narrows %s container charts",
    (runtime: string, relation: string, parent: string) => {
      expect(
        scope({
          "resource.host.name": "prod",
          "resource.container.runtime": runtime,
          "resource.container.name": "web",
        }).incidentQueries,
      ).toEqual([
        {
          [relation]: {
            name: "web",
            kind: "Container",
            [parent === "dockerHosts" ? "dockerHost" : "podmanHost"]: {
              hostIdentifier: "prod",
            },
          },
        },
      ]);
      expect(
        scope({
          "resource.host.name": "prod",
          "resource.container.runtime": runtime,
          "resource.container.id": "container-sha",
        }).alertQueries,
      ).toEqual([
        {
          [relation]: {
            containerId: "container-sha",
            kind: "Container",
            [parent === "dockerHosts" ? "dockerHost" : "podmanHost"]: {
              hostIdentifier: "prod",
            },
          },
        },
      ]);
    },
  );

  test("does not guess a container runtime", () => {
    expectSuppressed(
      scope({ "resource.host.name": "prod", "resource.container.name": "web" }),
    );
    expectSuppressed(
      scope({
        "resource.host.name": "prod",
        "resource.container.runtime": new Includes(["docker", "podman"]),
      }),
    );
  });

  test.each([
    ["node", "Node"],
    ["pod", "Pod"],
    ["deployment", "Deployment"],
    ["statefulset", "StatefulSet"],
    ["daemonset", "DaemonSet"],
    ["job", "Job"],
    ["cronjob", "CronJob"],
    ["namespace", "Namespace"],
    ["replicaset", "ReplicaSet"],
    ["service", "Service"],
    ["persistentvolume", "PersistentVolume"],
    ["persistentvolumeclaim", "PersistentVolumeClaim"],
  ])(
    "narrows Kubernetes %s charts to the matching resource kind",
    (key: string, kind: string) => {
      const result: EventOverlayScope = scope({
        "resource.k8s.cluster.name": "prod",
        [`resource.k8s.${key}.name`]: "web",
      });
      expect(result.incidentQueries).toEqual([
        {
          kubernetesResources: {
            name: "web",
            kind,
            kubernetesCluster: { clusterIdentifier: "prod" },
          },
        },
      ]);
      expect(result.alertQueries).toEqual(result.incidentQueries);
    },
  );

  test("uses namespace membership of the named workload", () => {
    expect(
      scope({
        "resource.k8s.cluster.name": "prod",
        "resource.k8s.pod.name": "web",
        "resource.k8s.namespace.name": "team-a",
      }).incidentQueries,
    ).toEqual([
      {
        kubernetesResources: {
          name: "web",
          kind: "Pod",
          namespaceKey: "team-a",
          kubernetesCluster: { clusterIdentifier: "prod" },
        },
      },
    ]);
  });

  test("scopes Kubernetes container identity and namespace", () => {
    expect(
      scope({
        "resource.k8s.cluster.name": "prod",
        "resource.k8s.container.name": "web",
        "resource.k8s.namespace.name": "team-a",
      }).incidentQueries,
    ).toEqual([
      {
        kubernetesContainers: {
          name: "web",
          podNamespaceKey: "team-a",
          kubernetesCluster: { clusterIdentifier: "prod" },
        },
      },
    ]);
  });

  test("matches a container's own pod and cluster without requiring extra event links", () => {
    expect(
      scope({
        "resource.k8s.cluster.name": "prod",
        "resource.k8s.container.name": "web",
        "resource.k8s.pod.name": "web-123",
        "resource.k8s.namespace.name": "team-a",
      }).incidentQueries,
    ).toEqual([
      {
        kubernetesContainers: {
          name: "web",
          podName: "web-123",
          podNamespaceKey: "team-a",
          kubernetesCluster: { clusterIdentifier: "prod" },
        },
      },
    ]);
  });

  test("keeps generic Kubernetes container name and namespace on the same child", () => {
    expect(
      scope({
        "resource.k8s.cluster.name": "prod",
        "resource.container.name": "web",
        "resource.k8s.pod.name": "web-123",
        "resource.k8s.namespace.name": "team-a",
      }).incidentQueries,
    ).toEqual([
      {
        kubernetesContainers: {
          name: "web",
          podName: "web-123",
          podNamespaceKey: "team-a",
          kubernetesCluster: { clusterIdentifier: "prod" },
        },
      },
    ]);
  });

  test("does not invent a change-event attribute value for an unresolved entity scope object", () => {
    const result: EventOverlayScope = scope({
      entityScope: { entityKeys: ["opaque-key"] },
    });
    expectSuppressed(result);
    expect(result.changeEventQueries).toEqual([]);
  });

  test.each([
    "serviceId",
    "serviceIds",
    "services",
    "oneuptime.service.id",
    "resource.oneuptime.service.id",
  ])("loads service deployments by primary entity for %s", (key: string) => {
    expect(scope({ [key]: RESOURCE_A }).changeEventQueries).toEqual([
      { primaryEntityId: RESOURCE_A },
    ]);
  });

  test("keeps explicit event scope when row navigation lacks chart attributes", () => {
    const query: MetricQueryConfigData = config();
    query.eventScope = {
      primaryEntityId: new Includes([RESOURCE_A]),
      primaryEntityType: ServiceType.RealUserMonitor,
    };
    expectSuppressed(getEventOverlayScope([query]));
    query.eventScope = { entityKeys: new Includes(["opaque-key"]) };
    expectSuppressed(getEventOverlayScope([query]));
  });

  test("explicit event scope overrides duplicate chart identities while retaining independent filters", () => {
    const query: MetricQueryConfigData = config({
      monitorId: RESOURCE_B,
      "resource.service.name": "api",
    });
    query.eventScope = { monitorId: RESOURCE_A };
    expect(getEventOverlayScope([query]).incidentQueries).toEqual([
      { monitors: { _id: RESOURCE_A }, services: { name: "api" } },
    ]);
  });

  test("explicit polymorphic identity overrides an analytics filter with the same key", () => {
    const query: MetricQueryConfigData = config();
    Object.assign(query.metricQueryData.filterData, {
      primaryEntityId: RESOURCE_B,
      primaryEntityType: ServiceType.OpenTelemetry,
    });
    query.eventScope = {
      primaryEntityId: RESOURCE_A,
      primaryEntityType: ServiceType.Monitor,
    };
    expect(getEventOverlayScope([query]).incidentQueries).toEqual([
      { monitors: { _id: RESOURCE_A } },
    ]);
  });

  test("declared but empty event scope does not become project-wide", () => {
    const query: MetricQueryConfigData = config();
    query.eventScope = {};
    expect(getEventOverlayScope([query])).toEqual({
      incidentQueries: [],
      alertQueries: [],
      changeEventQueries: [],
    });
  });

  test("matches the parent id of an explicitly scoped child resource", () => {
    expect(
      scope({ dockerResourceId: RESOURCE_B, dockerHostId: RESOURCE_A })
        .incidentQueries,
    ).toEqual([
      { dockerResources: { _id: RESOURCE_B, dockerHost: { _id: RESOURCE_A } } },
    ]);
    expect(
      scope({
        kubernetesResourceId: RESOURCE_B,
        kubernetesClusterId: RESOURCE_A,
      }).incidentQueries,
    ).toEqual([
      {
        kubernetesResources: {
          _id: RESOURCE_B,
          kubernetesCluster: { _id: RESOURCE_A },
        },
      },
    ]);
  });

  test("suppresses unrelated events for the actual cloud environment telemetry attributes", () => {
    const attributes: Record<string, string> = {
      "resource.cloud.platform": "aws_ec2",
      "resource.cloud.account.id": "123",
      "resource.cloud.region": "eu-west-1",
    };
    expectSuppressed(scope(attributes));
    expect(scope(attributes).changeEventQueries).toEqual([{ attributes }]);
  });

  test("a runtime-only chart does not imply project-wide incidents", () => {
    expectSuppressed(scope({ "resource.container.runtime": "docker" }));
    expect(
      scope({ "resource.container.runtime": "docker" }).changeEventQueries,
    ).toEqual([{ attributes: { "resource.container.runtime": "docker" } }]);
  });

  test.each([
    ["resource.proxmox.cluster.name", "proxmoxClusters", "id", "qemu/101"],
    ["resource.iot.fleet.name", "iotFleets", "id", "device-101"],
    ["resource.ceph.cluster.name", "cephClusters", "ceph_daemon", "osd.3"],
    ["resource.ceph.cluster.name", "cephClusters", "pool_id", "3"],
    [
      "resource.vmware.vcenter.name",
      "vmwareVCenters",
      "resource.vcenter.vm.id",
      "vm-101",
    ],
    [
      "resource.vmware.vcenter.name",
      "vmwareVCenters",
      "resource.vcenter.host.name",
      "esxi-1",
    ],
    [
      "resource.vmware.vcenter.name",
      "vmwareVCenters",
      "resource.vcenter.datastore.name",
      "datastore-1",
    ],
    [
      "resource.vmware.vcenter.name",
      "vmwareVCenters",
      "resource.vcenter.cluster.name",
      "cluster-1",
    ],
  ])(
    "narrows %s descendant %s by the breaching-series identity",
    (key: string, relation: string, childKey: string, value: string) => {
      const result: EventOverlayScope = scope({
        [key]: "prod",
        [childKey]: value,
      });
      expect(result.incidentQueries).toEqual([
        { [relation]: { name: "prod" }, seriesLabels: { [childKey]: value } },
      ]);
      expect(result.alertQueries).toEqual(result.incidentQueries);
    },
  );

  test("retains project-wide events only for genuinely unscoped metrics", () => {
    const unscoped: EventOverlayScope = {
      incidentQueries: [{}],
      alertQueries: [{}],
      changeEventQueries: [{}],
    };
    expect(getEventOverlayScope(undefined)).toEqual(unscoped);
    expect(getEventOverlayScope([])).toEqual(unscoped);
    expect(scope({ projectId: RESOURCE_A, probeId: RESOURCE_B })).toEqual(
      unscoped,
    );
    expect(scope({ "http.method": "GET" })).toEqual(unscoped);
  });

  test("deduplicates repeated resource queries and canonicalizes the refresh identity", () => {
    const first: MetricQueryConfigData = config({
      "resource.service.name": "api",
      monitorId: RESOURCE_A,
    });
    const second: MetricQueryConfigData = config({ monitorId: RESOURCE_B });
    const reversed: MetricQueryConfigData = config({
      monitorId: RESOURCE_A,
      "resource.service.name": "api",
    });
    expect(JSON.stringify(getEventOverlayScope([first, second, first]))).toBe(
      JSON.stringify(getEventOverlayScope([second, reversed])),
    );
    expect(
      getEventOverlayScope([
        config({ monitorId: RESOURCE_A }),
        config({ monitorId: RESOURCE_A }),
      ]).incidentQueries,
    ).toHaveLength(1);
  });

  test("adding a blank draft does not broaden a selected monitor's events", () => {
    const selected: MetricQueryConfigData = config({ monitorId: RESOURCE_A });
    const draft: MetricQueryConfigData = config();
    draft.metricQueryData.filterData.metricName = "";
    expect(getEventOverlayScope([selected, draft])).toEqual(
      getEventOverlayScope([selected]),
    );
    expect(getEventOverlayScope([draft, selected])).toEqual(
      getEventOverlayScope([selected]),
    );
  });

  test("a view containing only unnamed drafts requests no event sources", () => {
    const blank: MetricQueryConfigData = config();
    blank.metricQueryData.filterData.metricName = "";
    const whitespace: MetricQueryConfigData = config({ "http.method": "GET" });
    whitespace.metricQueryData.filterData.metricName = "   ";
    const missingName: MetricQueryConfigData = {
      metricQueryData: { filterData: {} },
    };
    expect(getEventOverlayScope([blank, whitespace, missingName])).toEqual({
      incidentQueries: [],
      alertQueries: [],
      changeEventQueries: [],
    });
  });

  test("unrecognized explicit event metadata never becomes project-wide", () => {
    const query: MetricQueryConfigData = config();
    query.eventScope = { "custom.inventory.identity": "specific-resource" };
    expect(getEventOverlayScope([query])).toEqual({
      incidentQueries: [],
      alertQueries: [],
      changeEventQueries: [],
    });
    query.metricQueryData.filterData.metricName = "";
    expect(getEventOverlayScope([query])).toEqual({
      incidentQueries: [],
      alertQueries: [],
      changeEventQueries: [],
    });
  });

  test("keeps meaningful scope-only contexts without a metric name", () => {
    const query: MetricQueryConfigData = {
      metricQueryData: {
        filterData: { attributes: { monitorId: RESOURCE_A } },
      },
    };
    expect(getEventOverlayScope([query])).toEqual(
      scope({ monitorId: RESOURCE_A }),
    );
    query.metricQueryData.filterData.metricName = "";
    expect(getEventOverlayScope([query])).toEqual(
      scope({ monitorId: RESOURCE_A }),
    );
  });

  test("keeps explicitly declared metadata on an unnamed query", () => {
    const query: MetricQueryConfigData = {
      metricQueryData: { filterData: {} },
      eventScope: { monitorId: RESOURCE_A },
    };
    expect(getEventOverlayScope([query])).toEqual(
      scope({ monitorId: RESOURCE_A }),
    );
    query.eventScope = {};
    expect(getEventOverlayScope([query])).toEqual({
      incidentQueries: [],
      alertQueries: [],
      changeEventQueries: [],
    });
  });

  test("does not broaden when query memberships exceed the bounded request budget", () => {
    const values: Array<string> = Array.from(
      { length: EVENT_OVERLAY_SCOPE_QUERY_LIMIT + 1 },
      (_: unknown, index: number): string => {
        return `host-${index}`;
      },
    );
    expectSuppressed(scope({ "resource.host.name": new Includes(values) }));
    expectSuppressed(
      getEventOverlayScope(
        values.map((value: string): MetricQueryConfigData => {
          return config({ "resource.host.name": value });
        }),
      ),
    );
  });

  test("does not broaden inconsistent filters for one resource", () => {
    expectSuppressed(scope({ monitorId: RESOURCE_A, monitorIds: RESOURCE_B }));
    expectSuppressed(
      scope({ "host.name": "one", "resource.host.name": "two" }),
    );
  });

  test("does not mutate query configs or their operator values", () => {
    const membership: Includes = new Includes([RESOURCE_B, RESOURCE_A]);
    const query: MetricQueryConfigData = config({
      "resource.host.name": membership,
    });
    const before: string = JSON.stringify(query);
    getEventOverlayScope([query]);
    expect(JSON.stringify(query)).toBe(before);
    expect(membership.values).toEqual([RESOURCE_B, RESOURCE_A]);
  });
});

/*
 * Ingest stamps `oneuptime.database.server.name` from the batch ("PostgreSQL
 * orders-db.internal:5432", or "Database" for a batch linked by id alone),
 * never from the row: a database created or renamed by hand ("Orders DB")
 * or detected as a workload has another name, and names are not unique. So
 * database overlays match by id only.
 */
describe("database overlays match by id, never by the stamped display name", () => {
  const STAMPED_NAME: string = "PostgreSQL orders-db.internal:5432";

  test.each(["", "resource."])(
    "a %soneuptime.database.server.name filter alone overlays no incident or alert",
    (prefix: string) => {
      const result: EventOverlayScope = scope({
        [`${prefix}oneuptime.database.server.name`]: STAMPED_NAME,
      });

      // Never matched against DatabaseServer.name…
      expect(JSON.stringify(result.incidentQueries)).not.toContain(
        "databaseServers",
      );
      // …and never widened to every incident in the project.
      expectSuppressed(result);
      // Change events carry attributes, so they still match the exact value.
      expect(result.changeEventQueries).toEqual([
        {
          attributes: {
            [`${prefix}oneuptime.database.server.name`]: STAMPED_NAME,
          },
        },
      ]);
    },
  );

  test("the literal fallback name 'Database' never selects a row named 'Database'", () => {
    const result: EventOverlayScope = scope({
      "oneuptime.database.server.name": "Database",
    });

    expectSuppressed(result);
  });

  test.each([
    ["oneuptime.database.server.id"],
    ["resource.oneuptime.database.server.id"],
    ["databaseServerId"],
  ])(
    "with %s next to it, the id alone scopes — a name that differs from the row's cannot drop the overlays",
    (idKey: string) => {
      const result: EventOverlayScope = scope({
        [idKey]: RESOURCE_A,
        "oneuptime.database.server.name": STAMPED_NAME,
      });

      expect(result.incidentQueries).toEqual([
        { databaseServers: { _id: RESOURCE_A } },
      ]);
      expect(result.alertQueries).toEqual([
        { databaseServers: { _id: RESOURCE_A } },
      ]);
      expect(result.changeEventQueries).toEqual([
        { attributes: { [idKey]: RESOURCE_A } },
      ]);
    },
  );

  test("a polymorphic DatabaseServer primary entity scopes by id; the name is ignored", () => {
    const result: EventOverlayScope = getEventOverlayScope([
      {
        metricQueryData: {
          filterData: {
            metricName: "postgresql.backends",
            primaryEntityType: ServiceType.DatabaseServer,
            primaryEntityId: RESOURCE_A,
            attributes: {
              "resource.oneuptime.database.server.name": STAMPED_NAME,
            },
          },
        },
      } as unknown as MetricQueryConfigData,
    ]);

    expect(result.incidentQueries).toEqual([
      { databaseServers: { _id: RESOURCE_A } },
    ]);
    expect(result.alertQueries).toEqual([
      { databaseServers: { _id: RESOURCE_A } },
    ]);
  });

  test("a primary entity of ANOTHER type does not excuse a database name", () => {
    const result: EventOverlayScope = getEventOverlayScope([
      {
        metricQueryData: {
          filterData: {
            metricName: "postgresql.backends",
            primaryEntityType: ServiceType.Host,
            primaryEntityId: RESOURCE_A,
            attributes: { "oneuptime.database.server.name": STAMPED_NAME },
          },
        },
      } as unknown as MetricQueryConfigData,
    ]);

    expectSuppressed(result);
  });

  test("an event scope naming only the database's display name overlays nothing", () => {
    const query: MetricQueryConfigData = config();
    query.eventScope = { "oneuptime.database.server.name": STAMPED_NAME };

    const result: EventOverlayScope = getEventOverlayScope([query]);

    expectSuppressed(result);
  });

  test("an event scope with the database's id and name is scoped by the id", () => {
    const query: MetricQueryConfigData = config();
    query.eventScope = {
      "oneuptime.database.server.id": RESOURCE_A,
      "oneuptime.database.server.name": STAMPED_NAME,
    };

    const result: EventOverlayScope = getEventOverlayScope([query]);

    expect(result.incidentQueries).toEqual([
      { databaseServers: { _id: RESOURCE_A } },
    ]);
  });

  test("a membership of display names is refused like a single one", () => {
    expectSuppressed(
      scope({
        "oneuptime.database.server.name": new Includes([
          STAMPED_NAME,
          "Redis cache.internal:6379",
        ]),
      }),
    );
  });
});
